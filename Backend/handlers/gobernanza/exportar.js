/**
 * Reúne los datos de un titular para exportarlos (acceso y portabilidad). Lo
 * usan el autoservicio (`titular.js`) y la respuesta a una solicitud llegada
 * por otro canal (`derechos.js`). Qué entra y qué no lo decide la función pura
 * `lib/gobernanza/exportacion.js`; acá solo se lee.
 *
 * Lee las mismas fuentes del inventario que la retención (`cargarEmpresa`), así
 * que una tabla nueva con datos de personas aparece en las dos o en ninguna.
 */

const { QueryCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient } = require('../../lib/clients/dynamodb');
const { construirExportacion } = require('../../lib/gobernanza/exportacion');
const { descifrarEncuestaDeTenant } = require('../../lib/arregloSensible');
const { _interno: { cargarEmpresa } } = require('./retencion');

const T = (env) => process.env[env];

async function todo(params) {
    const items = [];
    let desde;
    do {
        const r = await docClient.send(new QueryCommand({ ...params, ExclusiveStartKey: desde }));
        items.push(...(r.Items || []));
        desde = r.LastEvaluatedKey;
    } while (desde);
    return items;
}

const consentimientosDe = (tenantId, personaId) => todo({
    TableName: T('GOBERNANZA_TABLE'), KeyConditionExpression: 'tenantId = :t AND begins_with(sk, :p)',
    ExpressionAttributeValues: { ':t': tenantId, ':p': `CONSENT#${personaId}#` },
});

const historialConsentimientosDe = (tenantId, personaId) => todo({
    TableName: T('GOBERNANZA_HISTORIAL_TABLE'), KeyConditionExpression: 'tenantId = :t AND begins_with(sk, :p)',
    ExpressionAttributeValues: { ':t': tenantId, ':p': `CONS#${personaId}#` },
});

async function solicitudesDe(tenantId, personaId) {
    const items = await todo({
        TableName: T('GOBERNANZA_TABLE'), KeyConditionExpression: 'tenantId = :t AND begins_with(sk, :p)',
        ExpressionAttributeValues: { ':t': tenantId, ':p': 'SOLICITUD#' },
    });
    return items.filter((s) => s.personaId === personaId);
}

/**
 * @param {string} tenantId
 * @param {import('../../lib/models/Persona').Persona} persona  ya descifrada (PersonaService)
 */
async function exportarTitular(tenantId, persona, { ahora = new Date() } = {}) {
    const yo = persona.personaId;
    const [registros, bandeja, consentimientos, historialConsentimientos, solicitudes] = await Promise.all([
        cargarEmpresa(tenantId),
        todo({ TableName: T('INBOX_TABLE'), KeyConditionExpression: 'recipientId = :r', ExpressionAttributeValues: { ':r': yo } }),
        consentimientosDe(tenantId, yo),
        historialConsentimientosDe(tenantId, yo),
        solicitudesDe(tenantId, yo),
    ]);

    // Respuestas propias de cada encuesta, descifradas; solo las del titular.
    const respuestasEncuestas = new Map();
    for (const e of registros.SURVEYS_TABLE || []) {
        const propia = (e.recipients || []).find((r) => (r.personaId || r.workerId) === yo);
        if (!propia || (propia.responsesCifradas === undefined && !propia.responses)) continue;
        const visible = await descifrarEncuestaDeTenant({ ...e, recipients: [propia] }, tenantId);
        respuestasEncuestas.set(e.surveyId, visible.recipients?.[0]?.responses || null);
    }

    // La persona afectada de un incidente se vincula por el HMAC de su RUT.
    const incidentesAfectado = new Set((registros.INCIDENTS_TABLE || [])
        .filter((i) => persona._rutHmac && i.afectadoRutHmac === persona._rutHmac)
        .map((i) => i.incidentId));

    return construirExportacion({
        persona, registros, bandeja, consentimientos, historialConsentimientos, solicitudes,
        respuestasEncuestas, incidentesAfectado, ahora,
    });
}

module.exports = { exportarTitular, consentimientosDe, historialConsentimientosDe, solicitudesDe, todo };
