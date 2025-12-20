const { PutCommand, GetCommand, UpdateCommand, ScanCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient } = require('./dynamodb');

const SURVEYS_TABLE = process.env.SURVEYS_TABLE || 'Surveys';
const WORKERS_TABLE = process.env.WORKERS_TABLE || 'Workers';
const DEFAULT_SURVEY_ID = 'default-health-survey';

const HEALTH_SURVEY_TEMPLATE = {
    surveyId: DEFAULT_SURVEY_ID,
    titulo: 'Ficha Básica de Salud',
    descripcion: 'Cuestionario inicial para conocer antecedentes de salud relevantes de cada colaborador.',
    empresaId: 'default',
    estado: 'activa',
    audience: { tipo: 'todos' },
    preguntas: [
        {
            questionId: 'health-01',
            titulo: '¿Tiene alergias?',
            descripcion: 'Selecciona la opción que corresponda.',
            tipo: 'multiple',
            opciones: ['Sí', 'No'],
            required: true,
        },
        {
            questionId: 'health-02',
            titulo: 'Si responde sí, ¿cuáles alergias presenta?',
            descripcion: 'Incluye medicamentos, alimentos u otros desencadenantes.',
            tipo: 'abierta',
            required: false,
        },
        {
            questionId: 'health-03',
            titulo: '¿Es diabético/a?',
            descripcion: 'Indica si tiene diagnóstico de diabetes.',
            tipo: 'multiple',
            opciones: ['Sí', 'No'],
            required: true,
        },
        {
            questionId: 'health-04',
            titulo: '¿Tiene problemas crónicos a la espalda?',
            descripcion: 'Considera lesiones, diagnósticos o dolores recurrentes.',
            tipo: 'multiple',
            opciones: ['Sí', 'No'],
            required: true,
        },
        {
            questionId: 'health-05',
            titulo: 'Otros antecedentes médicos relevantes',
            descripcion: 'Describe cualquier condición o restricción que debamos considerar.',
            tipo: 'abierta',
            required: false,
        },
    ],
    isDefault: true,
    defaultCategory: 'salud',
};

const buildRecipient = (worker) => ({
    workerId: worker.workerId,
    nombre: worker.nombre,
    apellido: worker.apellido || '',
    rut: worker.rut,
    cargo: worker.cargo,
    estado: 'pendiente',
    respondedAt: null,
    responses: [],
});

const calculateStats = (recipients = []) => {
    const responded = recipients.filter((recipient) => recipient.estado === 'respondida').length;
    const total = recipients.length;
    const pending = total - responded;

    return {
        totalRecipients: total,
        responded,
        pending,
        completionRate: total > 0 ? Math.round((responded / total) * 100) : 0,
    };
};

const fetchAllWorkers = async () => {
    const workers = [];
    let ExclusiveStartKey;

    do {
        const response = await docClient.send(new ScanCommand({
            TableName: WORKERS_TABLE,
            ExclusiveStartKey,
        }));

        workers.push(...(response.Items || []));
        ExclusiveStartKey = response.LastEvaluatedKey;
    } while (ExclusiveStartKey);

    return workers;
};

const mergeRecipients = (currentRecipients = [], workers = []) => {
    const recipientsByWorker = new Map();
    let changed = false;

    currentRecipients.forEach((recipient) => {
        recipientsByWorker.set(recipient.workerId, recipient);
    });

    workers.forEach((worker) => {
        if (!worker || !worker.workerId) {
            return;
        }

        const existing = recipientsByWorker.get(worker.workerId);
        if (!existing) {
            recipientsByWorker.set(worker.workerId, buildRecipient(worker));
            changed = true;
            return;
        }

        const normalizedApellido = worker.apellido || '';
        const requiresUpdate =
            existing.nombre !== worker.nombre ||
            (existing.apellido || '') !== normalizedApellido ||
            existing.rut !== worker.rut ||
            existing.cargo !== worker.cargo;

        if (requiresUpdate) {
            recipientsByWorker.set(worker.workerId, {
                ...existing,
                nombre: worker.nombre,
                apellido: normalizedApellido,
                rut: worker.rut,
                cargo: worker.cargo,
            });
            changed = true;
        }
    });

    return {
        recipients: Array.from(recipientsByWorker.values()),
        changed,
    };
};

const getDefaultSurvey = async () => {
    const response = await docClient.send(new GetCommand({
        TableName: SURVEYS_TABLE,
        Key: { surveyId: DEFAULT_SURVEY_ID },
    }));

    return response.Item || null;
};

const persistSurvey = async (survey) => {
    await docClient.send(new PutCommand({
        TableName: SURVEYS_TABLE,
        Item: survey,
    }));
};

const updateSurveyRecipients = async (surveyId, recipients) => {
    const stats = calculateStats(recipients);
    const now = new Date().toISOString();
    const estado = stats.pending === 0 ? 'completada' : 'activa';

    await docClient.send(new UpdateCommand({
        TableName: SURVEYS_TABLE,
        Key: { surveyId },
        UpdateExpression: 'SET recipients = :recipients, stats = :stats, updatedAt = :updatedAt, estado = :estado',
        ExpressionAttributeValues: {
            ':recipients': recipients,
            ':stats': stats,
            ':updatedAt': now,
            ':estado': estado,
        },
    }));

    return {
        stats,
        updatedAt: now,
        estado,
    };
};

const ensureDefaultHealthSurvey = async () => {
    const workers = await fetchAllWorkers();
    const existingSurvey = await getDefaultSurvey();
    const now = new Date().toISOString();

    if (!existingSurvey) {
        const recipients = workers.map(buildRecipient);
        const stats = calculateStats(recipients);
        const survey = {
            ...HEALTH_SURVEY_TEMPLATE,
            recipients,
            stats,
            createdAt: now,
            updatedAt: now,
        };
        await persistSurvey(survey);
        return survey;
    }

    const { recipients, changed } = mergeRecipients(existingSurvey.recipients, workers);
    if (!changed) {
        return existingSurvey;
    }

    const meta = await updateSurveyRecipients(existingSurvey.surveyId, recipients);
    return {
        ...existingSurvey,
        recipients,
        stats: meta.stats,
        updatedAt: meta.updatedAt,
        estado: meta.estado,
    };
};

const assignWorkerToHealthSurvey = async (worker) => {
    if (!worker || !worker.workerId) {
        return;
    }

    let survey = await getDefaultSurvey();
    if (!survey) {
        survey = await ensureDefaultHealthSurvey();
    }

    const recipients = survey.recipients || [];
    const index = recipients.findIndex((recipient) => recipient.workerId === worker.workerId);

    if (index === -1) {
        recipients.push(buildRecipient(worker));
    } else {
        const existing = recipients[index];
        recipients[index] = {
            ...existing,
            nombre: worker.nombre,
            apellido: worker.apellido || '',
            rut: worker.rut,
            cargo: worker.cargo,
        };
    }

    const meta = await updateSurveyRecipients(survey.surveyId, recipients);

    return {
        ...survey,
        recipients,
        stats: meta.stats,
        updatedAt: meta.updatedAt,
        estado: meta.estado,
    };
};

module.exports = {
    DEFAULT_SURVEY_ID,
    HEALTH_SURVEY_TEMPLATE,
    ensureDefaultHealthSurvey,
    assignWorkerToHealthSurvey,
};
