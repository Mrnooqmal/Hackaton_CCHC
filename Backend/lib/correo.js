/**
 * Envío de correo: el ÚNICO punto por el que la plataforma escribe a alguien.
 *
 *  - Remitente `no-responder@buildandserve.cl` (dominio verificado en SES, con
 *    DKIM, MAIL FROM `mail.buildandserve.cl` y DMARC). Las respuestas van a
 *    `contacto@buildandserve.cl`, que reenvía Cloudflare.
 *  - Todo envío va con el conjunto de configuración del ambiente: SES publica
 *    rebotes y quejas en SNS, y `handlers/correo/eventos.js` marca la dirección.
 *  - Antes de enviar se consulta esa marca: a una dirección que rebotó de forma
 *    permanente o que se quejó NO se le vuelve a escribir. SES además tiene su
 *    propia lista de supresión de cuenta (BOUNCE, COMPLAINT); esta es la nuestra,
 *    que sabemos leer y que sobrevive a un cambio de cuenta.
 *
 * La marca se guarda por HMAC del correo, no en claro (`hmacCorreo`).
 */

const { SESClient, SendEmailCommand } = require('@aws-sdk/client-ses');
const { GetCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient } = require('./clients/dynamodb');
const { hmacCorreo } = require('./cifradoCampo');

const ses = new SESClient({ region: 'us-east-1' });

const REMITENTE = () => process.env.SES_SENDER_EMAIL || 'no-responder@buildandserve.cl';
const RESPONDER_A = () => process.env.SES_REPLY_TO || 'contacto@buildandserve.cl';
const NOMBRE = 'Build & Serve';

/** ¿La dirección está suprimida por un rebote permanente o una queja? */
async function estaSuprimida(correo) {
    const r = await docClient.send(new GetCommand({
        TableName: process.env.CORREOS_SUPRIMIDOS_TABLE,
        Key: { correoHmac: await hmacCorreo(correo) },
    }));
    return r.Item ? r.Item.motivo : null;
}

/**
 * Envía un correo a UNA dirección.
 * @returns {Promise<{enviado: true, messageId: string} | {enviado: false, suprimida: string}>}
 * Los errores de SES se propagan: cada llamador decide qué responder.
 */
async function enviarCorreo({ para, asunto, html, texto }) {
    const motivo = await estaSuprimida(para);
    if (motivo) return { enviado: false, suprimida: motivo };
    const r = await ses.send(new SendEmailCommand({
        Source: `${NOMBRE} <${REMITENTE()}>`,
        ReplyToAddresses: [RESPONDER_A()],
        Destination: { ToAddresses: [para] },
        ConfigurationSetName: process.env.SES_CONFIGURATION_SET || undefined,
        Message: {
            Subject: { Data: asunto, Charset: 'UTF-8' },
            Body: {
                ...(html ? { Html: { Data: html, Charset: 'UTF-8' } } : {}),
                ...(texto ? { Text: { Data: texto, Charset: 'UTF-8' } } : {}),
            },
        },
    }));
    return { enviado: true, messageId: r.MessageId };
}

module.exports = { enviarCorreo, estaSuprimida, _ses: ses };
