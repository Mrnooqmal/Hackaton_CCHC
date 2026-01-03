const { v4: uuidv4 } = require('uuid');
const { PutCommand, GetCommand, ScanCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient } = require('../lib/dynamodb');
const { success, error, created } = require('../lib/response');
const { validateRequired } = require('../lib/validation');
const { ensureDefaultHealthSurvey } = require('../lib/healthSurvey');
// NEW: Import PersonaService for unified worker access
const { PersonaService } = require('../lib/services/PersonaService');

const TABLE_NAME = process.env.SURVEYS_TABLE || 'Surveys';
const WORKERS_TABLE = process.env.WORKERS_TABLE || 'Workers';

// Feature flag: set to true to use new PersonaService
const USE_PERSONA_SERVICE = process.env.USE_PERSONA_SERVICE === 'true';

const QUESTION_TYPES = ['multiple', 'escala', 'abierta'];

const normalizeRut = (rut = '') => rut.replace(/[^0-9kK]/g, '').toUpperCase();

/**
 * Obtiene todos los trabajadores.
 * Usa PersonaService si está habilitado, sino usa el método legacy.
 */
const scanAllWorkers = async () => {
    if (USE_PERSONA_SERVICE) {
        // NEW: Use PersonaService for unified worker listing
        const personas = await PersonaService.listar({ includeUsers: true });
        // Convert Persona to worker format for compatibility
        return personas.map(p => ({
            workerId: p.workerId || p.userId,
            nombre: p.nombre,
            apellido: p.apellido || '',
            rut: p.rut,
            cargo: p.cargo,
            empresaId: p.empresaId,
            habilitado: p.habilitado
        }));
    }

    // LEGACY: Direct table scan
    const workers = [];
    let ExclusiveStartKey;

    do {
        const response = await docClient.send(
            new ScanCommand({
                TableName: WORKERS_TABLE,
                ExclusiveStartKey,
            })
        );

        workers.push(...(response.Items || []));
        ExclusiveStartKey = response.LastEvaluatedKey;
    } while (ExclusiveStartKey);

    return workers;
};

const buildRecipients = (workers, audience) => {
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

    return Array.from(uniqueWorkers.values()).map((worker) => ({
        workerId: worker.workerId,
        nombre: worker.nombre,
        apellido: worker.apellido || '',
        rut: worker.rut,
        cargo: worker.cargo,
        estado: 'pendiente',
        respondedAt: null,
        responses: [],
    }));
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

        const workers = await scanAllWorkers();
        const recipients = buildRecipients(workers, {
            tipo: audienceType,
            cargo: body.cargoDestino,
            ruts: body.ruts,
        });

        if (recipients.length === 0) {
            return error('No se encontraron trabajadores para la audiencia seleccionada');
        }

        const preguntas = sanitizeQuestions(body.preguntas);
        const now = new Date().toISOString();
        const survey = {
            surveyId: uuidv4(),
            titulo: body.titulo,
            descripcion: body.descripcion || '',
            empresaId: body.empresaId || 'default',
            estado: body.estado || 'activa',
            audience: {
                tipo: audienceType,
                cargo: body.cargoDestino || null,
                ruts: body.ruts || [],
            },
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
        const { empresaId } = event.queryStringParameters || {};

        await ensureDefaultHealthSurvey();

        const response = await docClient.send(new ScanCommand({
            TableName: TABLE_NAME,
        }));

        let items = response.Items || [];
        if (empresaId) {
            items = items.filter((survey) => survey.empresaId === empresaId);
        }

        // Ordenar por fecha de creación descendente
        items.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

        return success({
            total: items.length,
            surveys: items,
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
        const { id } = event.pathParameters || {};
        if (!id) {
            return error('ID de encuesta requerido');
        }

        const response = await docClient.send(new GetCommand({
            TableName: TABLE_NAME,
            Key: { surveyId: id },
        }));

        if (!response.Item) {
            return error('Encuesta no encontrada', 404);
        }

        return success(response.Item);
    } catch (err) {
        console.error('Error getting survey:', err);
        return error(err.message || 'Error interno al obtener encuesta', 500);
    }
};

/**
 * POST /surveys/{id}/responses/{workerId} - Actualizar estado/respuestas de un trabajador
 */
module.exports.updateResponseStatus = async (event) => {
    try {
        const { id, workerId } = event.pathParameters || {};
        if (!id || !workerId) {
            return error('ID de encuesta y de trabajador son requeridos');
        }

        const body = JSON.parse(event.body || '{}');
        const status = body.estado || 'respondida';
        if (!['pendiente', 'respondida'].includes(status)) {
            return error('Estado inválido');
        }

        const surveyResult = await docClient.send(new GetCommand({
            TableName: TABLE_NAME,
            Key: { surveyId: id },
        }));

        if (!surveyResult.Item) {
            return error('Encuesta no encontrada', 404);
        }

        const survey = surveyResult.Item;
        const recipients = survey.recipients || [];
        const index = recipients.findIndex((r) => r.workerId === workerId);

        if (index === -1) {
            return error('Trabajador no está asignado a esta encuesta', 404);
        }

        const now = new Date().toISOString();
        const recipient = {
            ...recipients[index],
            estado: status,
            respondedAt: status === 'respondida' ? now : null,
            responses: Array.isArray(body.responses) ? body.responses : recipients[index].responses || [],
        };

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

        return success({
            message: 'Estado actualizado',
            recipient,
            survey: updatedSurvey,
        });
    } catch (err) {
        console.error('Error updating survey response:', err);
        return error(err.message || 'Error interno al actualizar respuesta', 500);
    }
};
