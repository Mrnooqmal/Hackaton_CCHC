import { apiRequest } from './client';

export interface SignatureRequestType {
    label: string;
    icon: string;
    requiresDoc: boolean;
}

export interface DocumentoAdjunto {
    nombre: string;
    url: string;  // S3 key
    tipo: string; // MIME type
    tamaño: number;
    subidoEn?: string;
}

export interface TrabajadorEnSolicitud {
    workerId: string;
    nombre: string;
    rut: string;
    cargo: string;
    firmado: boolean;
    signatureId: string | null;
    fechaFirma: string | null;
}

export interface SignatureRequest {
    requestId: string;
    tipo: string;
    tipoInfo: SignatureRequestType;
    titulo: string;
    descripcion: string;
    documentos: DocumentoAdjunto[];
    tieneDocumentos: boolean;
    solicitanteId: string;
    solicitanteNombre: string;
    solicitanteRut: string;
    trabajadores: TrabajadorEnSolicitud[];
    totalRequeridos: number;
    totalFirmados: number;
    fechaCreacion: string;
    fechaLimite: string | null;
    fechaCompletado: string | null;
    ubicacion: string | null;
    obraId?: string | null;
    empresaId: string;
    estado: 'pendiente' | 'en_proceso' | 'completada' | 'cancelada' | 'vencida';
    motivoCancelacion?: string;
    createdAt: string;
    updatedAt: string;
}

export interface CreateSignatureRequestData {
    tipo: string;
    titulo: string;
    descripcion?: string;
    documentos?: DocumentoAdjunto[];
    trabajadoresIds: string[];
    solicitanteId: string;
    fechaLimite?: string;
    ubicacion?: string;
    empresaId?: string;
    obraId?: string;
    referenciaId?: string;
    referenciaTipo?: string;
    documentId?: string;
}

export interface DisputeInfo {
    motivo: string;
    reportadoPor: string;
    fechaReporte: string;
    resolucion?: string;
    resueltoPor?: string;
    fechaResolucion?: string;
}

// New Signature Types for Signature Requests
export interface NewSignature {
    signatureId: string;
    token: string;
    requestId: string | null;
    requestTitulo: string;
    requestTipo: string;
    workerId: string;
    workerRut: string;
    workerNombre: string;
    workerCargo: string;
    solicitanteId: string | null;
    solicitanteNombre: string;
    fecha: string;
    horario: string;
    timestamp: string;
    ipAddress: string;
    userAgent: string;
    metodoValidacion: string;
    documentosFirmados: DocumentoAdjunto[];
    estado: 'valida' | 'disputada' | 'revocada' | 'pendiente';
    disputaInfo?: DisputeInfo;
    empresaId: string;
    createdAt: string;
}

export interface CreateNewSignatureData {
    workerId: string;
    pin: string;
    requestId: string;
    metadata?: {
        geolocation?: { lat: number; lng: number };
        deviceId?: string;
    };
}

// Stats Types
export interface SignatureRequestStats {
    total: number;
    pendientes: number;
    enProceso: number;
    completadas: number;
    canceladas: number;
    vencidas: number;
    totalFirmasRequeridas: number;
    totalFirmasObtenidas: number;
    porTipo: Record<string, {
        label: string;
        icon: string;
        total: number;
        completadas: number;
    }>;
}

export const REQUEST_TYPES: Record<string, SignatureRequestType> = {
    CHARLA_5MIN: { label: 'Charla de 5 Minutos', icon: '💬', requiresDoc: false },
    CAPACITACION: { label: 'Capacitación', icon: '📚', requiresDoc: true },
    INDUCCION: { label: 'Inducción', icon: '🎓', requiresDoc: true },
    ENTREGA_EPP: { label: 'Entrega de EPP', icon: '🦺', requiresDoc: true },
    ART: { label: 'Análisis de Riesgos en Terreno', icon: '⚠️', requiresDoc: true },
    PROCEDIMIENTO: { label: 'Procedimiento de Trabajo', icon: '📋', requiresDoc: true },
    INSPECCION: { label: 'Inspección de Seguridad', icon: '🔍', requiresDoc: false },
    REGLAMENTO: { label: 'Reglamento Interno', icon: '📖', requiresDoc: true },
    DOCUMENTO: { label: 'Documento DS44', icon: '📄', requiresDoc: true },
    OTRO: { label: 'Otro', icon: '📝', requiresDoc: false },
};

// ========================================
// API: SIGNATURE REQUESTS (Solicitudes de Firma)
// ========================================
export const signatureRequestsApi = {
    create: (data: CreateSignatureRequestData) =>
        apiRequest<SignatureRequest>('/signature-requests', {
            method: 'POST',
            body: JSON.stringify(data),
        }),

    list: (params?: { empresaId?: string; estado?: string; solicitanteId?: string; tipo?: string; obraId?: string }) => {
        const query = params ? new URLSearchParams(params as Record<string, string>).toString() : '';
        return apiRequest<{ requests: SignatureRequest[]; total: number; types: Record<string, SignatureRequestType> }>(
            `/signature-requests${query ? `?${query}` : ''}`
        );
    },

    get: (id: string) =>
        apiRequest<SignatureRequest & { firmasDetalle: NewSignature[] }>(`/signature-requests/${id}`),

    getPendingByWorker: (workerId: string) =>
        apiRequest<{ pendientes: SignatureRequest[]; total: number }>(`/signature-requests/pending/${workerId}`),

    getHistoryByWorker: (workerId: string) =>
        apiRequest<{ historial: { firma: NewSignature; solicitud: SignatureRequest | null }[]; totalFirmas: number }>(
            `/signature-requests/history/${workerId}`
        ),

    cancel: (id: string, motivo?: string) =>
        apiRequest<{ message: string }>(`/signature-requests/${id}/cancel`, {
            method: 'POST',
            body: JSON.stringify({ motivo }),
        }),

    getStats: (params?: { empresaId?: string; solicitanteId?: string }) => {
        const query = params ? new URLSearchParams(params as Record<string, string>).toString() : '';
        return apiRequest<SignatureRequestStats>(`/signature-requests/stats${query ? `?${query}` : ''}`);
    },
};
