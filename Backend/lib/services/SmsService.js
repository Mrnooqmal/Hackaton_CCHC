/**
 * SmsService
 *
 * Envío de SMS transaccionales vía AWS SNS (publicación directa a número, sin topic).
 *
 * Política de envío (definida en InboxRepository): NO todas las notificaciones
 * llegan al teléfono. Solo se envían por SMS los mensajes que provienen de otro
 * usuario de la plataforma (no los automáticos del sistema) y los que están
 * marcados como prioritarios (high/urgent). Además el destinatario debe haber
 * autorizado las notificaciones por SMS (persona.notificacionesSms === true) y
 * tener un teléfono válido.
 */

const { SNSClient, PublishCommand } = require('@aws-sdk/client-sns');

const snsClient = new SNSClient({});

// Interruptor global. En sandbox de SNS solo se puede enviar a números
// verificados; permite apagar el envío sin tocar código (SMS_ENABLED=false).
const SMS_ENABLED = (process.env.SMS_ENABLED || 'true') !== 'false';
// Sender ID alfanumérico (soportado en Chile; ignorado por AWS en países que no
// lo permiten, como EE.UU., donde se usa un número largo).
const SMS_SENDER_ID = process.env.SMS_SENDER_ID || 'BuildServe';

/**
 * Normaliza un teléfono chileno a formato E.164 (+569XXXXXXXX).
 * Acepta los formatos que guarda la plataforma: "+56 9 1234 5678", "912345678",
 * "56912345678", etc. Devuelve null si no se puede normalizar a un móvil válido.
 */
function toE164Chile(raw) {
    if (!raw) return null;
    const digits = String(raw).replace(/\D/g, '');

    // Ya trae código de país: 56 + 9 + 8 dígitos = 11 dígitos.
    if (digits.length === 11 && digits.startsWith('569')) {
        return `+${digits}`;
    }
    // Móvil local: 9 + 8 dígitos = 9 dígitos.
    if (digits.length === 9 && digits.startsWith('9')) {
        return `+56${digits}`;
    }
    // 8 dígitos sin el 9 inicial (poco común): se asume móvil.
    if (digits.length === 8) {
        return `+569${digits}`;
    }
    return null;
}

/**
 * Envía un SMS a un número en E.164. No lanza: ante cualquier error devuelve
 * { sent: false }, porque el SMS es una notificación best-effort y nunca debe
 * romper el flujo principal (creación del mensaje en el inbox).
 */
async function sendSms(phoneE164, message) {
    if (!SMS_ENABLED) {
        return { sent: false, reason: 'sms_disabled' };
    }
    if (!phoneE164) {
        return { sent: false, reason: 'no_phone' };
    }
    if (!message) {
        return { sent: false, reason: 'no_message' };
    }

    try {
        await snsClient.send(new PublishCommand({
            PhoneNumber: phoneE164,
            Message: message,
            MessageAttributes: {
                // Transactional: mayor prioridad de entrega que Promotional.
                'AWS.SNS.SMS.SMSType': { DataType: 'String', StringValue: 'Transactional' },
                'AWS.SNS.SMS.SenderID': { DataType: 'String', StringValue: SMS_SENDER_ID },
            },
        }));
        console.log(`SMS enviado a ${phoneE164}`);
        return { sent: true, phone: phoneE164 };
    } catch (err) {
        console.error(`Error enviando SMS a ${phoneE164}:`, err);
        return { sent: false, error: err.message };
    }
}

module.exports = { sendSms, toE164Chile };
