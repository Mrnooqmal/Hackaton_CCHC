import { apiRequest } from './client';

/**
 * Transcripción de audio a texto (Gemini). Único uso de IA que quedó en la
 * plataforma: dictar el relato al reportar un incidente. El resto del
 * asistente de IA se descartó como proyecto.
 */
export const aiApi = {
    transcribeAudio: (audio: string, mimeType: string) =>
        apiRequest<{ text: string }>('/ai/transcribe', {
            method: 'POST',
            body: JSON.stringify({ audio, mimeType }),
        }),
};
