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

// Gobernanza de hallazgos (reunion 2026-06-10): responsable, plazo y cierre verificado.
export interface HallazgoGobernanza {
    responsableId: string | null;
    responsableNombre: string | null;
    plazoRespuestaISO: string | null;
    estadoCierre: 'abierto' | 'en_proceso' | 'cerrado';
    verificadoPor: string | null;
    fechaVerificacion: string | null;
    comentarioCierre: string | null;
}

// Reporte flash: datos minimos al momento del registro, editable en investigacion.
// esFlash y segunInformacionDisponible son inmutables (trazabilidad).
export interface ReporteFlash {
    esFlash: boolean;
    segunInformacionDisponible: boolean;
    afectados: { nombre: string; rut: string | null; cargo: string | null }[];
    descripcionBreve: string;
    severidad: 'leve' | 'grave' | 'fatal';
    evidencias: string[];
    ubicacionReferencia: string;
    creadoEn: string;
    editadoEn: string | null;
}

export interface Incident {
    incidentId: string;
    obraId?: string;
    tenantId?: string;
    tipo: 'accidente' | 'incidente' | 'condicion_subestandar' | 'accion_subestandar';
    clasificacion?: 'hallazgo' | 'incidente';
    gobernanza?: HallazgoGobernanza | null;
    reporteFlash?: ReporteFlash | null;
    centroTrabajo: string;
    etapaConstructiva?: string;
    trabajador: {
        nombre: string;
        rut: string;
        genero: string;
        cargo: string;
    };
    realizadoPor?: {
        personaId: string | null;
        nombre: string;
        rut?: string;
        cargo: string;
    };
    fecha: string;
    hora: string;
    descripcion: string;
    gravedad: 'leve' | 'grave' | 'fatal';
    diasPerdidos?: number;
    evidencias: string[];
    investigaciones: {
        prevencionista?: Investigation;
        jefeDirecto?: Investigation;
        comiteParitario?: Investigation;
    };
    estado: 'reportado' | 'en_investigacion' | 'cerrado';
    reportadoPor: string;
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
    tipo: 'accidente' | 'incidente' | 'condicion_subestandar' | 'accion_subestandar';
    obraId?: string;
    centroTrabajo: string;
    // Quien reporta (el backend valida rol para clasificacion 'incidente')
    solicitanteId?: string;
    // Reporte flash (solo clasificacion 'incidente')
    esFlash?: boolean;
    afectados?: { nombre: string; rut?: string | null; cargo?: string | null }[];
    descripcionBreve?: string;
    ubicacionReferencia?: string;
    // Gobernanza inicial del hallazgo
    responsableId?: string;
    responsableNombre?: string;
    plazoRespuestaISO?: string;
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
    tenantId?: string;
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
    tenantId?: string;
    obraId?: string;
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
    tenantId?: string;
    obraId?: string;
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

    getAnalytics: (params?: { tenantId?: string; obraId?: string; fechaInicio?: string; fechaFin?: string }) => {
        const query = new URLSearchParams(params as Record<string, string>).toString();
        return apiRequest<AnalyticsData>(`/incidents/analytics${query ? `?${query}` : ''}`);
    },

    // Gobernanza de hallazgos: asignar responsable/plazo y verificar cierre (supervisor+).
    updateGobernanza: (id: string, data: Partial<HallazgoGobernanza> & { actorId: string }) =>
        apiRequest<{ incident: Incident; gobernanza: HallazgoGobernanza }>(`/incidents/${id}/gobernanza`, {
            method: 'PUT',
            body: JSON.stringify(data),
        }),

    // Completa/corrige el reporte flash con la informacion de la investigacion (supervisor+).
    completarFlash: (id: string, data: Partial<CreateIncidentData> & { actorId: string }) =>
        apiRequest<{ incident: Incident }>(`/incidents/${id}/flash-completar`, {
            method: 'PUT',
            body: JSON.stringify(data),
        }),

    // Seguimiento del estado de una medida correctiva (Art. 71): pendiente ->
    // en_proceso -> completada -> verificada. Insumo de la Fase ACT.
    updateMedidaEstado: (incidentId: string, numero: string | number, estado: 'pendiente' | 'en_proceso' | 'completada' | 'verificada') =>
        apiRequest<{ incident: Incident; medidas: any[] }>(`/incidents/${incidentId}/medidas/${encodeURIComponent(String(numero))}`, {
            method: 'PUT',
            body: JSON.stringify({ estado }),
        }),

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

    marcarAccidente: (id: string, actorId: string) =>
        apiRequest<Incident>(`/incidents/${id}/calificar-accidente`, {
            method: 'PUT',
            body: JSON.stringify({ actorId }),
        }),
};
