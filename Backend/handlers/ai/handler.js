const { success, error } = require('../../lib/utils/response');
const gemini = require('../../lib/ai/gemini');

/**
 * POST /ai/transcribe - Transcribir audio a texto usando Gemini
 *
 * Único uso de IA que quedó en la plataforma: dictar el relato al reportar un
 * incidente. El asistente de IA (chat, MIPER, matriz de riesgo, plan de
 * prevención, charla diaria, análisis de incidentes) se descartó.
 */
module.exports.transcribeAudio = async (event) => {
    try {
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
