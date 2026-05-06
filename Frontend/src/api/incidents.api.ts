import { apiRequest } from './client';

export interface IncidentLocation {
    lat: number;
    lng: number;
    accuracy?: number;
    source?: 'geolocalizacion' | 'manual';
    timestamp?: number;
}

export interface IncidentEvidencePreview {
    key: string;
    url?: string;
}

export interface Incident {
    incidentId: string;
    tipo: 'accidente' | 'incidente' | 'condicion_subestandar';
    centroTrabajo: string;
    trabajador: {
        nombre: string;
        rut: string;
        genero: string;
        cargo: string;
    };
    fecha: string;
    hora: string;
    descripcion: string;
    gravedad: 'leve' | 'grave' | 'fatal';
    diasPerdidos?: number;
    evidencias: string[];
    documentos?: {
        diat?: string;
        diep?: string;
    };
    investigaciones: {
        prevencionista?: Investigation;
        jefeDirecto?: Investigation;
        comiteParitario?: Investigation;
    };
    estado: 'reportado' | 'en_investigacion' | 'cerrado';
    reportadoPor: string;
    empresaId: string;
    viewedBy?: string[];
    createdAt: string;
    updatedAt: string;
    evidencePreviews?: IncidentEvidencePreview[];
    ubicacion?: IncidentLocation;
}

export interface Investigation {
    investigador: string;
    rolInvestigador: 'prevencionista' | 'jefe_directo' | 'comite_paritario';
    fecha: string;
    hallazgos: string;
    recomendaciones: string;
    medidas: string[];
    estado: 'pendiente' | 'completada';
}

export interface CreateIncidentData {
    tipo: 'accidente' | 'incidente' | 'condicion_subestandar';
    centroTrabajo: string;
    trabajador: {
        nombre: string;
        rut: string;
        genero: string;
        cargo: string;
    };
    fecha?: string;
    hora?: string;
    descripcion: string;
    gravedad?: 'leve' | 'grave' | 'fatal';
    diasPerdidos?: number;
    evidencias?: string[];
    reportadoPor?: string;
    empresaId?: string;
    clasificacion?: 'hallazgo' | 'incidente';
    tipoHallazgo?: 'accion' | 'condicion';
    etapaConstructiva?: string;
    ubicacion?: IncidentLocation;
}

export interface UpdateIncidentData {
    estado?: 'reportado' | 'en_investigacion' | 'cerrado';
    investigacionPrevencionista?: Omit<Investigation, 'fecha'>;
    investigacionJefeDirecto?: Omit<Investigation, 'fecha'>;
    investigacionComiteParitario?: Omit<Investigation, 'fecha'>;
    diasPerdidos?: number;
    documentos?: {
        diat?: string;
        diep?: string;
    };
    evidencias?: string[];
    ubicacion?: IncidentLocation;
}

export interface AddInvestigationData {
    tipo: 'prevencionista' | 'jefe_directo' | 'comite_paritario';
    hallazgos: string;
    recomendaciones: string;
    medidas: string[];
}

export interface UploadDocumentData {
    fileName: string;
    fileType: string;
    documentType: 'diat' | 'diep';
}

export interface DocumentReference {
    documentType: 'diat' | 'diep';
    s3Key: string;
    fileName: string;
    uploadedBy: string;
    uploadedAt: string;
    url?: string;
}

export interface QuickReportData {
    qrToken: string;
    tipo: 'accidente' | 'incidente' | 'condicion_subestandar';
    clasificacion: 'hallazgo' | 'incidente';
    tipoHallazgo: 'accion' | 'condicion';
    etapaConstructiva: string;
    centroTrabajo: string;
    descripcion: string;
    reportadoPor: string;
    evidencias?: File[];
    firmaConfirmacion: {
        nombre: string;
        timestamp: string;
    };
    ubicacion?: IncidentLocation;
}

export interface QRReportResponse {
    success: boolean;
    incidentId?: string;
    message?: string;
    error?: string;
}

export interface AnalyticsData {
    periodo: string;
    distribucionPorTipo: {
        accidentes: number;
        incidentes: number;
        condicionesSubestandar: number;
    };
    distribucionPorGravedad: {
        leve: number;
        grave: number;
        fatal: number;
    };
    tendencias: Array<{
        mes: string;
        total: number;
        accidentes: number;
        incidentes: number;
    }>;
    porCentroTrabajo: Array<{
        centro: string;
        total: number;
        tasa: number;
    }>;
}

export interface IncidentListParams {
    empresaId?: string;
    tipo?: string;
    estado?: string;
    fechaInicio?: string;
    fechaFin?: string;
}

export interface UploadEvidenceData {
    fileName: string;
    fileType: string;
    incidentId?: string;
}

export interface UploadEvidenceResponse {
    uploadUrl: string;
    s3Key: string;
    fileUrl: string;
}

export interface IncidentStats {
    mes: string;
    masaLaboral: number;
    numeroAccidentes: number;
    diasPerdidos: number;
    tasaAccidentabilidad: number;
    siniestralidad: number;
    tasaFrecuencia: number;
    porTipo: {
        accidentes: number;
        incidentes: number;
        condicionesSubestandar: number;
    };
    porGravedad: {
        leve: number;
        grave: number;
        fatal: number;
    };
    totalIncidentes: number;
}

export interface IncidentStatsParams {
    empresaId?: string;
    mes?: string;
    masaLaboral?: number;
}

export const incidentsApi = {
    create: (data: CreateIncidentData) =>
        apiRequest<Incident>('/incidents', {
            method: 'POST',
            body: JSON.stringify(data),
        }),

    list: (params?: IncidentListParams) => {
        const query = new URLSearchParams(params as Record<string, string>).toString();
        return apiRequest<Incident[]>(`/incidents${query ? `?${query}` : ''}`);
    },

    get: (id: string) =>
        apiRequest<Incident>(`/incidents/${id}`),

    update: (id: string, data: UpdateIncidentData) =>
        apiRequest<Incident>(`/incidents/${id}`, {
            method: 'PUT',
            body: JSON.stringify(data),
        }),

    uploadEvidence: (data: UploadEvidenceData) =>
        apiRequest<UploadEvidenceResponse>('/incidents/upload-evidence', {
            method: 'POST',
            body: JSON.stringify(data),
        }),

    getStats: (params?: IncidentStatsParams) => {
        const query = params ? new URLSearchParams(params as any).toString() : '';
        return apiRequest<IncidentStats>(`/incidents/stats${query ? `?${query}` : ''}`);
    },

    addInvestigation: (incidentId: string, data: AddInvestigationData) =>
        apiRequest<{ message: string; investigation: Investigation }>(`/incidents/${incidentId}/investigations`, {
            method: 'POST',
            body: JSON.stringify(data),
        }),

    uploadDocument: (incidentId: string, data: UploadDocumentData) =>
        apiRequest<{ uploadUrl: string; s3Key: string }>(`/incidents/${incidentId}/documents`, {
            method: 'POST',
            body: JSON.stringify(data),
        }),

    getDocuments: (incidentId: string) =>
        apiRequest<{ documents: DocumentReference[] }>(`/incidents/${incidentId}/documents`),

    getAnalytics: (params?: { empresaId?: string; fechaInicio?: string; fechaFin?: string }) => {
        const query = new URLSearchParams(params as Record<string, string>).toString();
        return apiRequest<AnalyticsData>(`/incidents/analytics${query ? `?${query}` : ''}`);
    },

    quickReport: (data: QuickReportData) =>
        apiRequest<QRReportResponse>('/incidents/quick-report', {
            method: 'POST',
            body: JSON.stringify(data),
        }),

    markAsViewed: (id: string, userId: string) =>
        apiRequest<{ success: true }>(`/incidents/${id}/viewed`, {
            method: 'POST',
            body: JSON.stringify({ userId }),
        }),
};
