import { apiRequest } from './client';

export type SurveyAudienceType = 'todos' | 'cargo' | 'personalizado';
export type SurveyQuestionType = 'multiple' | 'escala' | 'abierta';

export interface SurveyQuestion {
    questionId: string;
    titulo: string;
    descripcion?: string;
    tipo: SurveyQuestionType;
    opciones?: string[];
    escalaMax?: number;
    required: boolean;
}

export interface CreateSurveyQuestion {
    titulo: string;
    descripcion?: string;
    tipo: SurveyQuestionType;
    opciones?: string[];
    escalaMax?: number;
    required?: boolean;
}

export interface SurveyAnswer {
    questionId: string;
    value: string | string[] | number;
    comentario?: string;
}

export interface SurveyRecipient {
    personaId?: string;
    workerId: string;
    nombre: string;
    apellido?: string;
    rut?: string;
    cargo: string;
    estado: 'pendiente' | 'respondida';
    respondedAt?: string | null;
    responses?: SurveyAnswer[];
}

export interface SurveyStats {
    totalRecipients: number;
    responded: number;
    pending: number;
    completionRate: number;
}

export interface Survey {
    surveyId: string;
    titulo: string;
    descripcion: string;
    empresaId: string;
    estado: string;
    createdBy?: string;
    audience: {
        tipo: SurveyAudienceType;
        cargo?: string | null;
        // Cuántas personas se eligieron a mano. Los RUT en sí no se guardan: la
        // audiencia ya está resuelta en `recipients`.
        totalRuts?: number;
    };
    kitItemKey?: string | null;
    // Solo en el detalle (`GET /surveys/{id}`). El listado no los trae: se sirve
    // de un índice que a propósito no proyecta ni las preguntas ni a los
    // destinatarios (ahí viven el RUT y las respuestas). En el detalle, quien no
    // gestiona la encuesta recibe solo su propia fila en `recipients`.
    preguntas?: SurveyQuestion[];
    recipients?: SurveyRecipient[];
    stats?: SurveyStats;
    createdAt?: string;
    updatedAt?: string;
    /** La Ficha Básica de Salud: sus respuestas son datos de salud. */
    esFichaSalud?: boolean;
}

/** Lo que el listado dice de cada encuesta, para quien la mira. */
export interface SurveyListItem extends Survey {
    totalPreguntas: number;
    /** La asignación de quien consulta, o null si no es destinatario. */
    miAsignacion: { estado: 'pendiente' | 'respondida'; respondedAt: string | null } | null;
    /** Solo en encuestas del kit y con permiso para ver fichas de personas. */
    avanceKit?: { asignados: string[]; respondidos: string[] };
}

export interface CreateSurveyPayload {
    titulo: string;
    descripcion?: string;
    preguntas: CreateSurveyQuestion[];
    audienceType?: SurveyAudienceType;
    cargoDestino?: string;
    ruts?: string[];
    empresaId?: string;
    estado?: string;
    createdBy?: string;
}

export interface UpdateSurveyResponsePayload {
    estado: 'pendiente' | 'respondida';
    responses?: SurveyAnswer[];
    pin?: string;
}

export const surveysApi = {
    list: (params?: { empresaId?: string; obraId?: string }) => {
        const queryParams = new URLSearchParams();
        if (params?.empresaId) queryParams.append('empresaId', params.empresaId);
        if (params?.obraId) queryParams.append('obraId', params.obraId);
        const query = queryParams.toString();
        return apiRequest<{ total: number; surveys: SurveyListItem[] }>(`/surveys${query ? `?${query}` : ''}`);
    },

    get: (surveyId: string) =>
        apiRequest<Survey>(`/surveys/${surveyId}`),

    create: (payload: CreateSurveyPayload) =>
        apiRequest<Survey>('/surveys', {
            method: 'POST',
            body: JSON.stringify(payload),
        }),

    updateResponseStatus: (surveyId: string, workerId: string, data: UpdateSurveyResponsePayload) =>
        apiRequest<{ message: string; recipient: SurveyRecipient; survey: Survey }>(
            `/surveys/${surveyId}/responses/${workerId}`,
            {
                method: 'POST',
                body: JSON.stringify(data),
            }
        ),
};
