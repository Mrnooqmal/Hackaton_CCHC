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
    workerId: string;
    nombre: string;
    apellido?: string;
    rut: string;
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
        ruts?: string[];
    };
    preguntas: SurveyQuestion[];
    recipients: SurveyRecipient[];
    stats?: SurveyStats;
    createdAt?: string;
    updatedAt?: string;
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
        return apiRequest<{ total: number; surveys: Survey[] }>(`/surveys${query ? `?${query}` : ''}`);
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
