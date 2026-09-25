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
/**
 * La Ficha Básica de Salud es UNA POR EMPRESA.
 *
 * Hasta el 24 de septiembre de 2026 era un registro único y global
 * (`surveyId: 'default-health-survey'`, `tenantId: 'default'`): la única
 * excepción a la partición por empresa en todo el sistema, y justo en el módulo
 * que guarda datos médicos. En la práctica estaba muerta —ningún tenant se
 * llama 'default', así que ni el listado ni el detalle la alcanzaban— pero
 * `ensureDefaultHealthSurvey` la mantenía, y cualquier escritor que le pasara
 * una persona real habría cruzado fichas de salud entre empresas.
 *
 * Se arregló estando vacía, que es cuando cuesta cero. Con fichas dentro habría
 * sido una migración de datos médicos cruzados.
 */
const idEncuestaSalud = (tenantId) => `default-health-survey#${tenantId}`;

const HEALTH_SURVEY_TEMPLATE = {
    titulo: 'Ficha Básica de Salud',
    descripcion: 'Cuestionario inicial para conocer antecedentes de salud relevantes de cada colaborador.',
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

const fetchAllPersonas = async (tenantId) => {
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

const getDefaultSurvey = async (tenantId) => {
    const response = await docClient.send(new GetCommand({
        TableName: SURVEYS_TABLE,
        Key: { surveyId: idEncuestaSalud(tenantId) },
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

const ensureDefaultHealthSurvey = async (tenantId) => {
    // Sin empresa no hay encuesta. El valor por defecto que había acá
    // ('default') era el origen del registro global: cualquier llamador que se
    // olvidara del tenant terminaba escribiendo en el mismo sitio que todos los
    // demás, sin que nada fallara.
    if (!tenantId) throw new Error('ensureDefaultHealthSurvey requiere tenantId');

    const personas = await fetchAllPersonas(tenantId);
    const existingSurvey = await getDefaultSurvey(tenantId);
    const now = new Date().toISOString();

    const [llave, llaveSalud] = await Promise.all([
        llaveDeArreglos(tenantId), llaveSaludDe(tenantId),
    ]);

    if (!existingSurvey) {
        const recipients = personas.map((p) => buildRecipient(p, llave, llaveSalud));
        const stats = calculateStats(recipients);
        const survey = {
            ...HEALTH_SURVEY_TEMPLATE,
            surveyId: idEncuestaSalud(tenantId),
            tenantId,
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
    idEncuestaSalud,
    HEALTH_SURVEY_TEMPLATE,
    ensureDefaultHealthSurvey,
};
