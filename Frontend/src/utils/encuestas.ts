/**
 * Lo que comparten las pantallas de Encuestas: el listado, el detalle y la de
 * responder. Formatos de texto y el armado de la respuesta que se firma.
 */
import type { Survey, SurveyAnswer, SurveyQuestion, SurveyQuestionType } from '../api/client';

export const etiquetaTipoPregunta = (tipo: SurveyQuestionType): string => {
    switch (tipo) {
        case 'multiple': return 'Selección múltiple';
        case 'escala': return 'Escala 1–N';
        case 'abierta': return 'Pregunta abierta';
        default: return tipo;
    }
};

export const etiquetaAudiencia = (survey: Survey): string => {
    if (survey.esFichaSalud) return 'Trabajadores nuevos';
    if (survey.audience?.tipo === 'cargo') return `Cargo: ${survey.audience.cargo}`;
    if (survey.audience?.tipo === 'personalizado') return `Lista personalizada (${survey.audience.totalRuts ?? 0})`;
    return 'Todos los trabajadores';
};

/** "20 sep": la fecha que se lee en tarjetas y filas. */
export const fechaCorta = (valor?: string | null): string => {
    if (!valor) return '—';
    const fecha = new Date(valor);
    if (Number.isNaN(fecha.getTime())) return '—';
    return fecha.toLocaleDateString('es-CL', { day: 'numeric', month: 'short', timeZone: 'America/Santiago' }).replace('.', '');
};

export const fechaHora = (valor?: string | null): string => {
    if (!valor) return '—';
    const fecha = new Date(valor);
    if (Number.isNaN(fecha.getTime())) return '—';
    return fecha.toLocaleString('es-CL', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Santiago' });
};

/** "Nueva" el primer día; después, cuántos días lleva esperando respuesta. */
export const antiguedadAsignacion = (desde?: string | null, ahora = new Date()): string => {
    if (!desde) return 'Nueva';
    const dias = Math.floor((ahora.getTime() - new Date(desde).getTime()) / 86_400_000);
    if (!Number.isFinite(dias) || dias < 1) return 'Nueva';
    return dias === 1 ? '1 día' : `${dias} días`;
};

export const porcentaje = (parte: number, total: number): number =>
    total > 0 ? Math.round((parte / total) * 100) : 0;

export type ValoresRespuesta = Record<string, string | number>;

/** Valores del formulario a partir de lo que la persona ya respondió. */
export const valoresIniciales = (respuestas: SurveyAnswer[] = []): ValoresRespuesta => {
    const valores: ValoresRespuesta = {};
    respuestas.forEach((r) => {
        if (!r?.questionId) return;
        if (Array.isArray(r.value)) {
            if (r.value.length > 0) valores[r.questionId] = r.value[0];
        } else if (r.value !== undefined && r.value !== null) {
            valores[r.questionId] = r.value;
        }
    });
    return valores;
};

const vacio = (pregunta: SurveyQuestion, valor: string | number | undefined): boolean => {
    if (valor === undefined || valor === null) return true;
    if (pregunta.tipo === 'escala') return Number.isNaN(Number(valor));
    return String(valor).trim() === '';
};

/** Preguntas obligatorias sin responder, en orden. */
export const obligatoriasSinResponder = (preguntas: SurveyQuestion[], valores: ValoresRespuesta): SurveyQuestion[] =>
    preguntas.filter((p) => p.required && vacio(p, valores[p.questionId]));

/** La respuesta que se firma: solo lo contestado, con la escala como número. */
export const armarRespuestas = (preguntas: SurveyQuestion[], valores: ValoresRespuesta): SurveyAnswer[] =>
    preguntas.flatMap((p) => {
        const valor = valores[p.questionId];
        if (vacio(p, valor)) return [];
        if (p.tipo === 'escala') return [{ questionId: p.questionId, value: Number(valor) }];
        return [{ questionId: p.questionId, value: typeof valor === 'string' ? valor.trim() : valor }];
    });

// ─── Responder sin conexión ─────────────────────────────────────────────────
//
// Responder sin red ya funcionaba (vale de un solo uso, `useOfflineSignature`),
// pero la pantalla de responder necesita las preguntas, y sin red no se pueden
// pedir. Se guardan al verlas con red: título y preguntas, nada más. Nunca las
// respuestas ni a los destinatarios, que en la ficha de salud son datos de salud.

const CLAVE_CACHE = (surveyId: string) => `encuesta-preguntas:${surveyId}`;

export interface EncuestaEnCache {
    surveyId: string;
    titulo: string;
    descripcion?: string;
    preguntas: SurveyQuestion[];
    esFichaSalud?: boolean;
}

export const guardarPreguntasEnCache = (survey: Survey): void => {
    if (!survey.preguntas?.length) return;
    const copia: EncuestaEnCache = {
        surveyId: survey.surveyId,
        titulo: survey.titulo,
        descripcion: survey.descripcion,
        preguntas: survey.preguntas,
        esFichaSalud: survey.esFichaSalud,
    };
    try {
        localStorage.setItem(CLAVE_CACHE(survey.surveyId), JSON.stringify(copia));
    } catch {
        /* almacenamiento lleno o bloqueado: sin red no se podrá responder esta */
    }
};

export const leerPreguntasEnCache = (surveyId: string): EncuestaEnCache | null => {
    try {
        const crudo = localStorage.getItem(CLAVE_CACHE(surveyId));
        return crudo ? JSON.parse(crudo) as EncuestaEnCache : null;
    } catch {
        return null;
    }
};

export const borrarPreguntasEnCache = (): void => {
    try {
        Object.keys(localStorage)
            .filter((k) => k.startsWith('encuesta-preguntas:'))
            .forEach((k) => localStorage.removeItem(k));
    } catch {
        /* sin acceso al almacenamiento: no hay nada que borrar */
    }
};
