/**
 * Rebotes y quejas de SES (conjunto de configuración del ambiente → SNS → acá).
 *
 * Marca la dirección para no volver a escribirle (`lib/correo.js` consulta la
 * marca antes de cada envío):
 *  - rebote PERMANENTE (la dirección no existe, el dominio no recibe);
 *  - queja (la persona marcó el correo como spam);
 *  - rechazo de SES (el mensaje no salió: p. ej. virus).
 * Un rebote TRANSITORIO (casilla llena, servidor caído) no marca: se resuelve
 * solo, y marcarlo dejaría a alguien sin su correo de restablecimiento.
 *
 * Se guarda el HMAC de la dirección, nunca la dirección: la tabla responde
 * "¿está suprimida esta?", no "¿cuáles están suprimidas?". Tampoco va a los
 * logs.
 */

const { UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient } = require('../../lib/clients/dynamodb');
const { hmacCorreo } = require('../../lib/cifradoCampo');

/** Direcciones a marcar en un evento de SES, con su motivo. Pura. */
function aMarcar(evento) {
    const tipo = evento.eventType || evento.notificationType;
    if (tipo === 'Bounce') {
        if (evento.bounce?.bounceType !== 'Permanent') return [];
        return (evento.bounce.bouncedRecipients || []).map((r) => ({
            correo: r.emailAddress, motivo: 'rebote', detalle: evento.bounce.bounceSubType || null,
        }));
    }
    if (tipo === 'Complaint') {
        return (evento.complaint?.complainedRecipients || []).map((r) => ({
            correo: r.emailAddress, motivo: 'queja', detalle: evento.complaint.complaintFeedbackType || null,
        }));
    }
    if (tipo === 'Reject') {
        return (evento.mail?.destination || []).map((correo) => ({ correo, motivo: 'rechazo', detalle: evento.reject?.reason || null }));
    }
    return [];
}

/** La marca vence a los dos años (TTL): las casillas se reciclan, y si vuelve a
 *  rebotar se marca de nuevo. Cada evento nuevo renueva el plazo. */
const VIGENCIA_SEGUNDOS = 2 * 365 * 24 * 3600;

async function marcar({ correo, motivo, detalle }, en) {
    await docClient.send(new UpdateCommand({
        TableName: process.env.CORREOS_SUPRIMIDOS_TABLE,
        Key: { correoHmac: await hmacCorreo(correo) },
        // `motivo` es el primero; `ultimoMotivo`, el más reciente.
        UpdateExpression: 'SET motivo = if_not_exists(motivo, :m), ultimoMotivo = :m, detalle = :d, ultimoEn = :en, desde = if_not_exists(desde, :en), expira = :exp ADD eventos :uno',
        ExpressionAttributeValues: { ':m': motivo, ':d': detalle, ':en': en, ':exp': Math.floor(Date.now() / 1000) + VIGENCIA_SEGUNDOS, ':uno': 1 },
    }));
}

module.exports.handler = async (event) => {
    let marcadas = 0;
    for (const record of event.Records || []) {
        let evento;
        try {
            evento = JSON.parse(record.Sns?.Message || '{}');
        } catch {
            console.error('CORREO_EVENTO_ILEGIBLE');
            continue;
        }
        const en = evento.mail?.timestamp || new Date().toISOString();
        for (const m of aMarcar(evento)) {
            if (!m.correo) continue;
            await marcar(m, en);
            marcadas++;
            // Motivo y dominio (para diagnosticar entregas), nunca la dirección.
            console.log('CORREO_SUPRIMIDO', m.motivo, m.detalle || '-', String(m.correo).split('@')[1] || '-');
        }
    }
    return { marcadas };
};

module.exports._interno = { aMarcar };
