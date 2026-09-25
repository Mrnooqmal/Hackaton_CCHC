const { v4: uuidv4 } = require('uuid');
const { PutCommand, GetCommand, QueryCommand, ScanCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient } = require('../../lib/clients/dynamodb');
const { success, error, created } = require('../../lib/utils/response');
const { validateRequired } = require('../../lib/utils/validation');
const { ensureDefaultHealthSurvey } = require('../../lib/health/healthSurvey');
const { PersonaService } = require('../../lib/services/PersonaService');
const { eventBus } = require('../../lib/events/EventBus');
const { FirmaService } = require('../../lib/services/FirmaService');
const { conSesion, sesionPuede } = require('../../lib/auth/sesion');
const { PERMISSIONS } = require('../../lib/permissions');
const { cifrarConLlaveDatos } = require('../../lib/cifradoCampo');
const {
    llaveDe: llaveDeArreglos,
    llaveSaludDe,
    construirDestinatario,
    cifrarRespuestas,
    descifrarEncuestaDeTenant,
    descifrarEncuestasDeTenant,
} = require('../../lib/arregloSensible');

/** Encuesta de la empresa de la sesión, o null. La tabla se indexa por surveyId. */
const encuestaDelTenant = async (surveyId, sesion) => {
    const res = await docClient.send(new GetCommand({
        TableName: TABLE_NAME,
        Key: { surveyId },
    }));
    const encuesta = res.Item;
    return encuesta && encuesta.tenantId === sesion.tenantId ? encuesta : null;
};

const TABLE_NAME = process.env.SURVEYS_TABLE || 'Surveys';

const QUESTION_TYPES = ['multiple', 'escala', 'abierta'];

const normalizeRut = (rut = '') => rut.replace(/[^0-9kK]/g, '').toUpperCase();

/**
 * Obtiene todos los trabajadores.
 * Usa PersonaService si está habilitado, sino usa el método legacy.
 */
const scanAllWorkers = async (tenantId) => {
    if (!tenantId) return [];
    const personaService = new PersonaService();
    // Toda la organización = todas las personas vinculadas (excluye solo las
    // desvinculadas, que listByTenant ya filtra). Antes pedía estado 'activo', pero
    // las personas recién creadas están 'pendiente' hasta enrolarse, así que una
    // encuesta "para todos" no encontraba a nadie.
    const personas = await personaService.listByTenant(tenantId);
    return personas.map(p => ({
        workerId: p.personaId,
        personaId: p.personaId,
        nombre: p.nombre,
        apellido: p.apellido || '',
        rut: p.rut,
        cargo: p.cargo,
        tenantId: p.tenantId,
        habilitado: p.habilitado
    }));
};

const buildRecipients = (workers, audience, llave, llaveSalud) => {
    let targetWorkers = workers;

    if (audience.tipo === 'cargo') {
        targetWorkers = workers.filter((w) => w.cargo?.toLowerCase() === (audience.cargo || '').toLowerCase());
    }

    if (audience.tipo === 'personalizado') {
        const rutSet = new Set((audience.ruts || []).map(normalizeRut));
        targetWorkers = workers.filter((w) => rutSet.has(normalizeRut(w.rut)));
    }

    const uniqueWorkers = new Map();
    targetWorkers.forEach((worker) => {
        if (worker && worker.workerId && !uniqueWorkers.has(worker.workerId)) {
            uniqueWorkers.set(worker.workerId, worker);
        }
    });

    return Array.from(uniqueWorkers.values())
        .map((worker) => construirDestinatario(worker, {}, llave, llaveSalud));
};

const calculateStats = (recipients = []) => {
    const responded = recipients.filter((r) => r.estado === 'respondida').length;
    const total = recipients.length;
    const pending = total - responded;

    return {
        totalRecipients: total,
        responded,
        pending,
        completionRate: total > 0 ? Math.round((responded / total) * 100) : 0,
    };
};

const sanitizeQuestions = (questions = []) => {
    if (!Array.isArray(questions) || questions.length === 0) {
        throw new Error('Se requiere al menos una pregunta');
    }

    return questions.map((question, index) => {
        const validation = validateRequired(question, ['titulo', 'tipo']);
        if (!validation.valid) {
            throw new Error(`Pregunta ${index + 1}: faltan campos ${validation.missing.join(', ')}`);
        }

        if (!QUESTION_TYPES.includes(question.tipo)) {
            throw new Error(`Tipo de pregunta inválido. Tipos permitidos: ${QUESTION_TYPES.join(', ')}`);
        }

        if (question.tipo === 'multiple') {
            if (!Array.isArray(question.opciones) || question.opciones.length < 2) {
                throw new Error(`Pregunta ${index + 1}: se requieren al menos 2 opciones para selección múltiple`);
            }
        }

        if (question.tipo === 'escala') {
            if (!question.escalaMax || Number(question.escalaMax) < 1) {
                throw new Error(`Pregunta ${index + 1}: escala debe ser un número mayor o igual a 1`);
            }
        }

        return {
            questionId: question.questionId || uuidv4(),
            titulo: question.titulo,
            descripcion: question.descripcion || '',
            tipo: question.tipo,
            opciones: question.tipo === 'multiple' ? question.opciones : undefined,
            escalaMax: question.tipo === 'escala' ? Number(question.escalaMax) : undefined,
            required: question.required !== false,
        };
    });
};

/**
 * POST /surveys - Crear una nueva encuesta
 */
module.exports.create = async (event) => {
    try {
        const ses = conSesion(event);
        if (!ses.ok) return ses.respuesta;
        const sesion = ses.sesion;
        if (!sesionPuede(sesion, PERMISSIONS.ENCUESTAS_CREAR)) {
            return error('No tienes permiso para crear encuestas', 403);
        }

        const body = JSON.parse(event.body || '{}');
        const validation = validateRequired(body, ['titulo', 'preguntas']);
        if (!validation.valid) {
            return error(`Campos requeridos faltantes: ${validation.missing.join(', ')}`);
        }

        const audienceType = body.audienceType || 'todos';
        if (!['todos', 'cargo', 'personalizado'].includes(audienceType)) {
            return error('Tipo de audiencia inválido');
        }

        if (audienceType === 'cargo' && !body.cargoDestino) {
            return error('Debe indicar el cargo destino para la audiencia por cargo');
        }

        if (audienceType === 'personalizado' && (!Array.isArray(body.ruts) || body.ruts.length === 0)) {
            return error('Debe indicar al menos un RUT para la audiencia personalizada');
        }

        // La empresa sale de la sesión: con `?tenantId=` o `tenantId` en el cuerpo
        // se creaba una encuesta dentro de otra empresa, dirigida a su personal
        // (y la audiencia se resuelve leyendo su nómina completa).
        const tenantId = sesion.tenantId;
        const [llaveArreglos, llaveSalud] = await Promise.all([
            llaveDeArreglos(tenantId), llaveSaludDe(tenantId),
        ]);
        const workers = await scanAllWorkers(tenantId);
        const recipients = buildRecipients(workers, {
            tipo: audienceType,
            cargo: body.cargoDestino,
            ruts: body.ruts,
        }, llaveArreglos, llaveSalud);

        if (recipients.length === 0) {
            return error('No se encontraron trabajadores para la audiencia seleccionada');
        }

        const preguntas = sanitizeQuestions(body.preguntas);
        const now = new Date().toISOString();
        const survey = {
            surveyId: uuidv4(),
            titulo: body.titulo,
            descripcion: body.descripcion || '',
            tenantId,
            obraId: body.obraId || null,
            estado: body.estado || 'activa',
            createdBy: sesion.personaId,
            audience: {
                tipo: audienceType,
                cargo: body.cargoDestino || null,
                // Los RUT de la audiencia van cifrados uno a uno: la pantalla solo
                // usa `ruts.length` —nunca los valores— así que el conteo se
                // conserva y el contenido no queda en claro. Es una copia
                // redundante de lo que ya está en `recipients[]`; se cifra en vez
                // de borrarse para no cambiarle la forma al cliente en este mismo
                // cambio.
                ruts: (body.ruts || []).map((r) => cifrarConLlaveDatos(r, llaveArreglos)),
            },
            // Vínculo con el ítem del kit de onboarding (trazabilidad): al responder,
            // se cierra ese ítem para la persona.
            kitItemKey: body.kitItemKey || null,
            preguntas,
            recipients,
            stats: calculateStats(recipients),
            createdAt: now,
            updatedAt: now,
        };

        await docClient.send(new PutCommand({
            TableName: TABLE_NAME,
            Item: survey,
        }));

        // NEW: Emit event for automatic notifications
        try {
            // Use userIds for inbox delivery (inbox queries by userId, not workerId)
            const userIds = recipients.map(r => r.personaId || r.workerId);
            await eventBus.emit('survey.assigned', {
                surveyId: survey.surveyId,
                userIds,
                assignedBy: sesion.personaId,
                creatorName: body.creatorName || 'Gestor SST',
                surveyName: survey.titulo,
                dueDate: body.dueDate || null,
                recipientCount: userIds.length
            });
        } catch (eventError) {
            console.error('Error emitting survey.assigned event:', eventError);
            // Continue even if notification fails
        }

        return created(survey);
    } catch (err) {
        console.error('Error creating survey:', err);
        return error(err.message || 'Error interno al crear encuesta', 500);
    }
};

/**
 * GET /surveys - Listar encuestas
 */
module.exports.list = async (event) => {
    try {
        const ses = conSesion(event);
        if (!ses.ok) return ses.respuesta;
        const tenantId = ses.sesion.tenantId;

        await ensureDefaultHealthSurvey();

        const result = await docClient.send(new QueryCommand({
            TableName: TABLE_NAME,
            IndexName: 'tenantId-index',
            KeyConditionExpression: 'tenantId = :tenantId',
            ExpressionAttributeValues: { ':tenantId': tenantId }
        }));

        const items = (result.Items || []).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

        return success({
            total: items.length,
            surveys: await descifrarEncuestasDeTenant(items, tenantId),
        });
    } catch (err) {
        console.error('Error listing surveys:', err);
        return error(err.message || 'Error interno al listar encuestas', 500);
    }
};

/**
 * GET /surveys/{id} - Obtener detalle de encuesta
 */
module.exports.get = async (event) => {
    try {
        const ses = conSesion(event);
        if (!ses.ok) return ses.respuesta;

        const { id } = event.pathParameters || {};
        if (!id) {
            return error('ID de encuesta requerido');
        }

        // Las respuestas viajan dentro de la encuesta, y la encuesta de salud
        // pre-ocupacional las trae de todo el personal: sin comprobar empresa, un
        // surveyId era la ficha de salud declarada de una nómina ajena.
        const encuesta = await encuestaDelTenant(id, ses.sesion);
        if (!encuesta) {
            return error('Encuesta no encontrada', 404);
        }

        return success(await descifrarEncuestaDeTenant(encuesta, ses.sesion.tenantId));
    } catch (err) {
        console.error('Error getting survey:', err);
        return error(err.message || 'Error interno al obtener encuesta', 500);
    }
};

/**
 * POST /surveys/{id}/responses/{workerId} - Actualizar estado/respuestas de un trabajador
 * AHORA REQUIERE FIRMA DIGITAL (PIN) para cumplimiento según DS 44
 */
module.exports.updateResponseStatus = async (event) => {
    try {
        const ses = conSesion(event);
        if (!ses.ok) return ses.respuesta;
        const sesion = ses.sesion;

        const { id, workerId } = event.pathParameters || {};
        if (!id || !workerId) {
            return error('ID de encuesta y de trabajador son requeridos');
        }

        const body = JSON.parse(event.body || '{}');
        const status = body.estado || 'respondida';
        if (!['pendiente', 'respondida'].includes(status)) {
            return error('Estado inválido');
        }

        // La respuesta se firma: con PIN en línea, o con un vale de un solo uso
        // cuando la encuesta se respondió sin red (ver ValeFirmaService).
        const pin = body.pin;
        const vale = body.vale || null;
        if (status === 'respondida' && !pin && !vale) {
            return error('Se requiere PIN para firmar la respuesta de la encuesta');
        }

        // Cada quien responde por sí mismo. Responder por otro es el equivalente a
        // la firma asistida (el trabajador teclea su PIN en el dispositivo de quien
        // asiste) y exige ese permiso.
        if (workerId !== sesion.personaId && !sesionPuede(sesion, PERMISSIONS.OBRA_FIRMA_ASISTIDA)) {
            return error('No tienes permiso para responder por otra persona', 403);
        }

        const survey = await encuestaDelTenant(id, sesion);
        if (!survey) {
            return error('Encuesta no encontrada', 404);
        }
        const recipients = survey.recipients || [];
        const index = recipients.findIndex((r) => r.workerId === workerId);

        if (index === -1) {
            return error('Trabajador no está asignado a esta encuesta', 404);
        }

        const now = new Date().toISOString();
        const llaveSalud = await llaveSaludDe(survey.tenantId);
        let signatureData = null;

        // NUEVO: Validar PIN y crear firma digital
        if (status === 'respondida') {
            try {
                // Obtener contexto de la request
                const contexto = {
                    ipAddress: event.requestContext?.http?.sourceIp ||
                        event.requestContext?.identity?.sourceIp || 'unknown',
                    userAgent: event.headers?.['user-agent'] || 'unknown'
                };

                // Crear firma digital usando FirmaService
                signatureData = await FirmaService.crear({
                    personaId: workerId,
                    tenantId: survey.tenantId,
                    obraId: survey.obraId || null,
                    metodo: vale ? 'VALE' : 'PIN',
                    credencial: vale
                        ? { vale, deviceId: body.deviceId || null, timestampLocal: body.timestampLocal || null }
                        : pin,
                    tipoFirma: 'encuesta',
                    referenciaId: id,
                    referenciaTipo: 'survey',
                    contexto,
                    metadata: {
                        surveyTitulo: survey.titulo,
                        totalPreguntas: survey.preguntas?.length || 0,
                        totalRespuestas: body.responses?.length || 0
                    }
                });

                console.log(`✅ Firma digital creada para encuesta ${id}, trabajador ${workerId}`);
            } catch (firmaError) {
                if (firmaError.codigo === 'PIN_BLOQUEADO') return error(firmaError.message, 423);
                console.error('Error validando firma:', firmaError);
                return error(firmaError.message || 'Error al validar PIN', 401);
            }
        }

        // Las respuestas se guardan cifradas SIEMPRE, con la llave de salud de la
        // empresa. `recipients[index]` viene tal cual de la tabla (sin descifrar),
        // así que lo que se conserva al no responder ya es el sobre.
        const respuestasNuevas = Array.isArray(body.responses) ? body.responses : null;
        const recipient = {
            ...recipients[index],
            estado: status,
            respondedAt: status === 'respondida' ? now : null,
            responsesCifradas: respuestasNuevas !== null
                ? cifrarRespuestas(respuestasNuevas, llaveSalud)
                : recipients[index].responsesCifradas
                    ?? cifrarRespuestas(recipients[index].responses || [], llaveSalud),
            // NUEVO: Incluir datos de la firma digital
            firma: signatureData ? {
                signatureId: signatureData.signatureId,
                token: signatureData.token,
                fecha: signatureData.fecha,
                timestamp: signatureData.timestamp,
                metodo: 'PIN'
            } : null
        };

        // Una ficha vieja traía `responses` en claro: el spread lo habría dejado
        // al lado del sobre nuevo, que es la peor de las dos opciones.
        delete recipient.responses;
        recipients[index] = recipient;

        const stats = calculateStats(recipients);
        const updatedSurvey = {
            ...survey,
            recipients,
            stats,
            updatedAt: now,
            estado: stats.pending === 0 ? 'completada' : survey.estado,
        };

        await docClient.send(new UpdateCommand({
            TableName: TABLE_NAME,
            Key: { surveyId: id },
            UpdateExpression: 'SET recipients = :recipients, stats = :stats, updatedAt = :updatedAt, estado = :estado',
            ExpressionAttributeValues: {
                ':recipients': updatedSurvey.recipients,
                ':stats': updatedSurvey.stats,
                ':updatedAt': updatedSurvey.updatedAt,
                ':estado': updatedSurvey.estado,
            },
        }));

        const visible = await descifrarEncuestaDeTenant(updatedSurvey, survey.tenantId);
        return success({
            message: 'Encuesta respondida y firmada exitosamente',
            recipient: visible.recipients[index],
            survey: visible,
            firma: signatureData ? {
                signatureId: signatureData.signatureId,
                token: signatureData.token,
                verificacionUrl: `/signatures/verify/${signatureData.token}`
            } : null
        });
    } catch (err) {
        console.error('Error updating survey response:', err);
        return error(err.message || 'Error interno al actualizar respuesta', 500);
    };
}
