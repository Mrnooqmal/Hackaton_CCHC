const { v4: uuidv4 } = require('uuid');
const { PutCommand, GetCommand, QueryCommand, UpdateCommand, BatchGetCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient } = require('../../lib/clients/dynamodb');
const { success, error, created } = require('../../lib/utils/response');
const { validateRequired } = require('../../lib/utils/validation');
const { ensureDefaultHealthSurvey, idEncuestaSalud } = require('../../lib/health/healthSurvey');
const { PersonaService } = require('../../lib/services/PersonaService');
const { TenantService } = require('../../lib/services/TenantService');
const { eventBus } = require('../../lib/events/EventBus');
const { FirmaService } = require('../../lib/services/FirmaService');
const { conSesion, sesionPuede } = require('../../lib/auth/sesion');
const { PERMISSIONS } = require('../../lib/permissions');
const {
    llaveDe: llaveDeArreglos,
    llaveSaludDe,
    construirDestinatario,
    cifrarRespuestas,
    descifrarEncuestaDeTenant,
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

/** Id del destinatario: `personaId` desde el modelo unificado, `workerId` antes. */
const idDestinatario = (r) => r?.personaId || r?.workerId || null;

/** La Ficha Básica de Salud de la empresa: sus respuestas son datos de salud. */
const esFichaSalud = (encuesta) => encuesta?.surveyId === idEncuestaSalud(encuesta?.tenantId);

/**
 * Preguntas y destinatarios de cada encuesta, leídos de la TABLA.
 *
 * El listado sale de `tenantId-index`, que a propósito no proyecta ninguno de
 * los dos: `recipients` lleva el RUT y las respuestas (D-8). Cambiar la
 * proyección obligaría a recrear el índice, y además volvería a copiar esos
 * datos. Se leen por clave, en lotes de 100 (el máximo de BatchGet), y lo que
 * DynamoDB deja sin procesar se reintenta.
 */
const leerContenido = async (surveyIds) => {
    const porId = new Map();
    for (let i = 0; i < surveyIds.length; i += 100) {
        let pendientes = { [TABLE_NAME]: {
            Keys: surveyIds.slice(i, i + 100).map((surveyId) => ({ surveyId })),
            ProjectionExpression: 'surveyId, preguntas, recipients',
        } };
        for (let intento = 0; pendientes && intento < 5; intento++) {
            const res = await docClient.send(new BatchGetCommand({ RequestItems: pendientes }));
            (res.Responses?.[TABLE_NAME] || []).forEach((item) => porId.set(item.surveyId, item));
            pendientes = res.UnprocessedKeys && Object.keys(res.UnprocessedKeys).length > 0
                ? res.UnprocessedKeys
                : null;
        }
    }
    return porId;
};

/**
 * Lo que el listado dice de una encuesta, para quien pregunta.
 *
 * Nunca incluye `recipients`: de ahí solo sale la asignación propia y, para
 * los ítems del kit y a quien puede ver fichas de personas, quiénes están
 * asignados y quiénes respondieron (identificadores y estado, nada más).
 */
const resumenParaListado = (encuesta, contenido, sesion) => {
    const destinatarios = contenido?.recipients || [];
    const mio = destinatarios.find((r) => idDestinatario(r) === sesion.personaId);
    const resumen = {
        ...encuesta,
        totalPreguntas: (contenido?.preguntas || []).length,
        esFichaSalud: esFichaSalud(encuesta),
        miAsignacion: mio ? { estado: mio.estado || 'pendiente', respondedAt: mio.respondedAt || null } : null,
    };
    if (encuesta.kitItemKey && sesionPuede(sesion, PERMISSIONS.PERSONAS_DETALLE)) {
        resumen.avanceKit = {
            asignados: destinatarios.map(idDestinatario).filter(Boolean),
            respondidos: destinatarios.filter((r) => r.estado === 'respondida').map(idDestinatario).filter(Boolean),
        };
    }
    return resumen;
};

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
                // Solo el número. Los RUT se usan para resolver la audiencia y
                // ahí terminan: quién quedó dentro ya está en `recipients`, y la
                // pantalla solo muestra "N trabajador(es)". Un dato cifrado que
                // nadie descifra nunca no se protege, solo se conserva — y además
                // `audience` va proyectado en `tenantId-index`.
                totalRuts: (body.ruts || []).length,
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

        // Aviso en la bandeja de cada destinatario. El remitente sale de la
        // sesión: con `creatorName` en el cuerpo, cualquiera con permiso de crear
        // encuestas firmaba el aviso a nombre de quien quisiera.
        try {
            const creador = workers.find((w) => w.personaId === sesion.personaId);
            const userIds = recipients.map(idDestinatario);
            await eventBus.emit('survey.assigned', {
                surveyId: survey.surveyId,
                userIds,
                assignedBy: sesion.personaId,
                creatorName: creador ? `${creador.nombre} ${creador.apellido}`.trim() : 'Gestor SST',
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

        // La ficha de salud de ESTA empresa, y solo si la empresa decidió
        // encenderla (Mi Empresa → Ficha de salud). Antes se creaba sola la
        // primera vez que alguien abría Encuestas: recolectar datos de salud de
        // todo el plantel como efecto secundario de abrir una pantalla. Apagada
        // no se borra nada; solo deja de crearse y de sincronizarse.
        if (await new TenantService().fichaSaludHabilitada(tenantId)) {
            await ensureDefaultHealthSurvey(tenantId);
        }

        const result = await docClient.send(new QueryCommand({
            TableName: TABLE_NAME,
            IndexName: 'tenantId-index',
            KeyConditionExpression: 'tenantId = :tenantId',
            ExpressionAttributeValues: { ':tenantId': tenantId }
        }));

        const items = (result.Items || []).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        // Si algún día la proyección vuelve a traer `recipients`, esto sigue sin
        // mandarlos: el listado nunca los expone, así que tampoco los descifra.
        const visibles = items.map(({ recipients, preguntas, ...resto }) => resto);
        const contenido = await leerContenido(visibles.map((e) => e.surveyId));

        return success({
            total: visibles.length,
            surveys: visibles.map((e) => resumenParaListado(e, contenido.get(e.surveyId), ses.sesion)),
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
        const sesion = ses.sesion;
        const encuesta = await encuestaDelTenant(id, sesion);
        if (!encuesta) {
            return error('Encuesta no encontrada', 404);
        }

        // Tampoco basta con ser de la empresa: el detalle trae las respuestas de
        // cada destinatario. Quien la gestiona ve a todos; un destinatario, solo
        // lo suyo; cualquier otro, nada — 404, como si no existiera.
        const gestiona = encuesta.createdBy === sesion.personaId
            || sesionPuede(sesion, PERMISSIONS.ENCUESTAS_CREAR);
        const esDestinatario = (encuesta.recipients || []).some((r) => idDestinatario(r) === sesion.personaId);
        if (!gestiona && !esDestinatario) {
            return error('Encuesta no encontrada', 404);
        }

        const visible = await descifrarEncuestaDeTenant(encuesta, sesion.tenantId);
        const propio = (r) => idDestinatario(r) === sesion.personaId;
        let recipients = visible.recipients || [];
        if (!gestiona) {
            recipients = recipients.filter(propio);
        } else if (esFichaSalud(encuesta) && !sesionPuede(sesion, PERMISSIONS.PERSONA_VIGILANCIA_SALUD)) {
            // Gestionar encuestas no es ver datos de salud: quién respondió sí,
            // qué declaró no. La propia persona siempre ve lo suyo (5.3).
            recipients = recipients.map((r) => {
                if (propio(r)) return r;
                const { responses, ...sinRespuestas } = r;
                return sinRespuestas;
            });
        }

        return success({
            ...visible,
            recipients,
            esFichaSalud: esFichaSalud(encuesta),
            stats: visible.stats || calculateStats(visible.recipients || []),
        });
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
                console.error('Error validando firma:', firmaError.message);
                // 400, como documentos y actividades. Era 401, y el cliente lee un
                // 401 como sesión vencida: un PIN mal tecleado al responder una
                // encuesta cerraba la sesión de la persona.
                return error(firmaError.message || 'Error al validar PIN', 400);
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

        // Quien responde recibe lo suyo, no la encuesta completa: devolvía
        // descifradas las respuestas de todos los destinatarios, incluida la
        // ficha de salud de cada compañero.
        const visible = await descifrarEncuestaDeTenant(updatedSurvey, survey.tenantId);
        return success({
            message: 'Encuesta respondida y firmada exitosamente',
            recipient: visible.recipients[index],
            survey: { ...visible, recipients: [visible.recipients[index]] },
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
