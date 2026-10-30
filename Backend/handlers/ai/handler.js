const { success, error } = require('../../lib/utils/response');
const gemini = require('../../lib/ai/gemini');
const { conSesion } = require('../../lib/auth/sesion');
const { PersonaService } = require('../../lib/services/PersonaService');
const { consentimientoVigente } = require('../../lib/gobernanza/consentimiento');

/**
 * POST /ai/transcribe - Transcribir audio a texto usando Gemini
 *
 * Único uso de IA que quedó en la plataforma: dictar el relato al reportar un
 * incidente. El asistente de IA (chat, MIPER, matriz de riesgo, plan de
 * prevención, charla diaria, análisis de incidentes) se descartó.
 */
module.exports.transcribeAudio = async (event) => {
    try {
        const ses = conSesion(event);
        if (!ses.ok) return ses.respuesta;
        // El audio sale a un tercero (Google) fuera de Chile: solo con el
        // consentimiento vigente de quien dicta (finalidad `dictado_voz_ia`).
        const persona = await new PersonaService().getById(ses.sesion.personaId);
        if (!consentimientoVigente(persona, 'dictado_voz_ia')) {
            return error('Para dictar por voz, primero otorga tu consentimiento en Mis datos y privacidad. También puedes escribir el relato.', 403);
        }
        const body = JSON.parse(event.body || '{}');
        const { audio, mimeType } = body;

        if (!audio) {
            return error('Se requiere el audio en base64');
        }

        const text = await gemini.transcribeAudio(audio, mimeType);
        return success({ text });
    } catch (err) {
        console.error('Error transcribing audio:', err);
        return error(err.message, 500);
    }
};
