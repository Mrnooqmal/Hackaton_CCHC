const { PutCommand, GetCommand, UpdateCommand, ScanCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient } = require('../clients/dynamodb');
const { cifrarConLlaveDatos } = require('../cifradoCampo');

const SURVEYS_TABLE = process.env.SURVEYS_TABLE || 'Surveys';
const { PersonaService } = require('../services/PersonaService');
const {
    llaveDe: llaveDeArreglos,
    llaveSaludDe,
    construirDestinatario,
    descifrarEncuesta,
} = require('../arregloSensible');
const DEFAULT_SURVEY_ID = 'default-health-survey';

const HEALTH_SURVEY_TEMPLATE = {
    surveyId: DEFAULT_SURVEY_ID,
    titulo: 'Ficha Básica de Salud',
    descripcion: 'Cuestionario inicial para conocer antecedentes de salud relevantes de cada colaborador.',
    tenantId: 'default',
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

const buildRecipient = (persona, llave, llaveSalud) =>
    construirDestinatario(persona, {}, llave, llaveSalud);

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

const fetchAllPersonas = async (tenantId = 'default') => {
    const personaService = new PersonaService();
    return personaService.listByTenant(tenantId);
};

/**
 * Mezcla la nómina actual con los destinatarios ya guardados.
 *
 * El RUT guardado es un sobre, así que para saber si cambió hay que descifrar
 * el existente y comparar en claro: comparar sobres daría SIEMPRE distinto
 * —cada cifrado del mismo valor es diferente a propósito— y esta función
 * reescribiría la encuesta entera en cada llamada.
 */
const mergeRecipients = (currentRecipients = [], items = [], llave, llaveSalud) => {
    const recipientsByWorker = new Map();
    let changed = false;

    // Vista en claro, solo para comparar; lo que se guarda sigue siendo el sobre.
    const enClaro = new Map(
        descifrarEncuesta({ recipients: currentRecipients }, llave, llaveSalud)
            .recipients.map((r) => [r.personaId || r.workerId, r])
    );

    currentRecipients.forEach((recipient) => {
        recipientsByWorker.set(recipient.personaId || recipient.workerId, recipient);
    });

    items.forEach((persona) => {
        if (!persona || !persona.personaId) {
            return;
        }

        const existing = recipientsByWorker.get(persona.personaId);
        if (!existing) {
            recipientsByWorker.set(persona.personaId, buildRecipient(persona, llave, llaveSalud));
            changed = true;
            return;
        }

        const visible = enClaro.get(persona.personaId) || {};
        const normalizedApellido = persona.apellido || '';
        const requiresUpdate =
            existing.nombre !== persona.nombre ||
            (existing.apellido || '') !== normalizedApellido ||
            visible.rut !== persona.rut ||
            existing.cargo !== persona.cargo;

        if (requiresUpdate) {
            const { rut: _rut, ...sinRutEnClaro } = existing;
            recipientsByWorker.set(persona.personaId, {
                ...sinRutEnClaro,
                nombre: persona.nombre,
                apellido: normalizedApellido,
                rutCifrado: cifrarConLlaveDatos(persona.rut ?? null, llave),
                cargo: persona.cargo,
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

const ensureDefaultHealthSurvey = async (tenantId = 'default') => {
    const personas = await fetchAllPersonas(tenantId);
    const existingSurvey = await getDefaultSurvey();
    const now = new Date().toISOString();

    // La encuesta por defecto vive bajo `tenantId: 'default'`, así que esa es la
    // empresa cuya llave la cifra — igual que cualquier otra encuesta usa la de
    // la suya. Ver la nota sobre este registro global en la cabecera.
    const empresaDeLaEncuesta = HEALTH_SURVEY_TEMPLATE.tenantId;
    const [llave, llaveSalud] = await Promise.all([
        llaveDeArreglos(empresaDeLaEncuesta), llaveSaludDe(empresaDeLaEncuesta),
    ]);

    if (!existingSurvey) {
        const recipients = personas.map((p) => buildRecipient(p, llave, llaveSalud));
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

    const { recipients, changed } = mergeRecipients(existingSurvey.recipients, personas, llave, llaveSalud);
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

/**
 * `assignWorkerToHealthSurvey` se eliminó el 24 de septiembre de 2026, al cifrar
 * las respuestas de encuesta. No tenía ningún llamador, y era la vía por la que
 * una persona de CUALQUIER empresa terminaba dentro de `default-health-survey`,
 * que es un registro único y global (`tenantId: 'default'`). Con su propio
 * `rut: persona.rut` en claro, además. Dejarla puesta era dejar armado un
 * cruce de datos entre empresas esperando un llamador.
 */

module.exports = {
    DEFAULT_SURVEY_ID,
    HEALTH_SURVEY_TEMPLATE,
    ensureDefaultHealthSurvey,
};
