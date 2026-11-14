const { success, error, headers } = require('../../lib/utils/response');
const transcribe = require('../../lib/ai/transcribe');
const { conSesion } = require('../../lib/auth/sesion');
const { PersonaService } = require('../../lib/services/PersonaService');
const { consentimientoVigente } = require('../../lib/gobernanza/consentimiento');

/**
 * Dictado del relato al reportar un incidente (Amazon Transcribe). Único uso de
 * IA que quedó en la plataforma: el asistente de IA (chat, MIPER, matriz de
 * riesgo, plan de prevención, charla diaria, análisis de incidentes) se
 * descartó.
 *
 * Va en dos pasos porque Transcribe tarda más de lo que aguanta una petición
 * (ver lib/ai/transcribe.js):
 *
 *   POST /ai/transcribe          → { jobId }
 *   GET  /ai/transcribe/{jobId}  → { estado: 'en_proceso' | 'listo' | 'fallido', text? }
 */

// Base64 de ~4 MB de audio. A 32 kbps, que es lo que pide el navegador, son
// más de 15 minutos: el tope solo frena un envío que no viene de la pantalla.
// Lambda rechaza igual un cuerpo de más de 6 MB, pero con un error opaco.
const MAX_AUDIO_BASE64 = 5_500_000;

/** 403 con `codigo`: el navegador ofrece ir a Mis datos y privacidad. */
const sinConsentimiento = () => ({
    statusCode: 403,
    headers,
    body: JSON.stringify({
        success: false,
        codigo: 'SIN_CONSENTIMIENTO',
        error: 'Para dictar por voz, primero otorga tu consentimiento en Mis datos y privacidad. También puedes escribir el relato.',
    }),
});

module.exports.iniciar = async (event) => {
    try {
        // Cada llamada le cuesta a la plataforma: con la contraseña inicial sin
        // cambiar no se usa, como todo lo demás.
        const ses = conSesion(event);
        if (!ses.ok) return ses.respuesta;

        // El audio sale a un tercero (AWS, fuera de Chile): solo con el
        // consentimiento vigente de quien dicta (finalidad `dictado_voz_ia`).
        const persona = await new PersonaService().getById(ses.sesion.personaId);
        if (!consentimientoVigente(persona, 'dictado_voz_ia')) return sinConsentimiento();

        const body = JSON.parse(event.body || '{}');
        const { audio, mimeType } = body;

        if (!audio || typeof audio !== 'string') {
            return error('Se requiere el audio en base64');
        }
        if (audio.length > MAX_AUDIO_BASE64) {
            return error('El audio es demasiado largo. Dicta el relato en partes más cortas.', 413);
        }
        if (!transcribe.formatoDe(mimeType)) {
            return error('Formato de audio no soportado');
        }

        const jobId = await transcribe.iniciar({
            tenantId: ses.sesion.tenantId,
            personaId: ses.sesion.personaId,
            audioBase64: audio,
            mimeType,
        });
        return success({ jobId }, 202);
    } catch (err) {
        console.error('Error iniciando transcripción:', err);
        return error('No se pudo transcribir el audio.', 500);
    }
};

module.exports.consultar = async (event) => {
    try {
        const ses = conSesion(event);
        if (!ses.ok) return ses.respuesta;

        const r = await transcribe.consultar({
            tenantId: ses.sesion.tenantId,
            personaId: ses.sesion.personaId,
            jobId: event.pathParameters?.jobId,
        });
        if (!r) return error('Transcripción no encontrada', 404);
        return success(r.estado === 'listo' ? { estado: r.estado, text: r.texto } : { estado: r.estado });
    } catch (err) {
        console.error('Error consultando transcripción:', err);
        return error('No se pudo transcribir el audio.', 500);
    }
};

const RUTAS_AI = {
    'POST /ai/transcribe': module.exports.iniciar,
    'GET /ai/transcribe/{jobId}': module.exports.consultar,
};
module.exports.enrutar = async (event, contexto) => {
    const atender = RUTAS_AI[event?.routeKey];
    if (!atender) return error('Ruta no encontrada', 404);
    return atender(event, contexto);
};
module.exports.RUTAS = RUTAS_AI;
