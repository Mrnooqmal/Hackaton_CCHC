import { apiRequest } from './client';

/** El servidor rechazó el dictado porque falta el consentimiento `dictado_voz_ia`. */
export const SIN_CONSENTIMIENTO_DICTADO = 'SIN_CONSENTIMIENTO';

type EstadoTranscripcion =
    | { estado: 'en_proceso' }
    | { estado: 'listo'; text: string }
    | { estado: 'fallido' };

type ResultadoDictado = { success: boolean; data?: { text: string }; error?: string; codigo?: string };

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Transcripción de audio a texto (Amazon Transcribe). Único uso de IA que quedó
 * en la plataforma: dictar el relato al reportar un incidente. El resto del
 * asistente de IA se descartó como proyecto.
 *
 * Son dos pasos (iniciar y consultar) porque Transcribe tarda más de lo que
 * aguanta una petición; `transcribeAudio` los junta para la pantalla.
 */
export const aiApi = {
    iniciarTranscripcion: (audio: string, mimeType: string) =>
        apiRequest<{ jobId: string }>('/ai/transcribe', {
            method: 'POST',
            body: JSON.stringify({ audio, mimeType }),
        }),

    consultarTranscripcion: (jobId: string) =>
        apiRequest<EstadoTranscripcion>(`/ai/transcribe/${encodeURIComponent(jobId)}`),

    /** Inicia y pregunta cada 1,5 s hasta tener texto (máx. ~2 min). */
    transcribeAudio: async (audio: string, mimeType: string): Promise<ResultadoDictado> => {
        const inicio = await aiApi.iniciarTranscripcion(audio, mimeType);
        if (!inicio.success || !inicio.data) return { success: false, error: inicio.error, codigo: inicio.codigo };

        for (let intento = 0; intento < 80; intento++) {
            await esperar(1500);
            const r = await aiApi.consultarTranscripcion(inicio.data.jobId);
            // Una falla pasajera (sin señal un momento, un 5xx) no corta el dictado.
            if (!r.success && (r.reintentable || r.sinRed)) continue;
            if (!r.success || !r.data) return { success: false, error: r.error || 'No se pudo transcribir el audio.' };
            if (r.data.estado === 'listo') return { success: true, data: { text: r.data.text } };
            if (r.data.estado === 'fallido') return { success: false, error: 'No se pudo transcribir el audio. Intenta de nuevo o escribe el relato.' };
        }
        return { success: false, error: 'La transcripción está tardando demasiado. Intenta de nuevo o escribe el relato.' };
    },
};
