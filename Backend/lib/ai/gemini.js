/**
 * Google Gemini Client
 *
 * Quedó reducido a la transcripción de audio, que es el único uso de IA vigente
 * (dictar el relato al reportar un incidente). Las funciones de generación
 * —MIPER, matriz de riesgo, plan de prevención, charla diaria, chat y análisis
 * de incidentes— se retiraron junto con el asistente de IA, que se descartó.
 */

const { GoogleGenerativeAI } = require("@google/generative-ai");

// Se requiere la variable de entorno GEMINI_API_KEY
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const DEFAULT_MODEL_ID = process.env.GEMINI_MODEL_ID || 'gemini-2.0-flash';

/**
 * Transcribe un archivo de audio usando Gemini (multimodal)
 * @param {string} audioBase64 - Audio en base64 (sin prefijo data:audio/...)
 * @param {string} mimeType - Tipo MIME del audio (ej: audio/mp3, audio/webm)
 */
async function transcribeAudio(audioBase64, mimeType = 'audio/webm') {
    const model = genAI.getGenerativeModel({ model: DEFAULT_MODEL_ID });

    const prompt = `Transcribe el siguiente audio exactamente como se escucha.
    Si hay pausas largas o ruido, ignóralo.
    Solo el texto hablado. Si no hay voz, responde con string vacío.
    Idioma: Español (Chile).`;

    const audioParts = [
        {
            inlineData: {
                data: audioBase64,
                mimeType: mimeType
            }
        }
    ];

    try {
        const result = await model.generateContent([prompt, ...audioParts]);
        const response = await result.response;
        return response.text().trim();
    } catch (error) {
        console.error('[Gemini] Transcribe failed:', error);
        throw error;
    }
}

module.exports = {
    transcribeAudio,
    DEFAULT_MODEL_ID
};
