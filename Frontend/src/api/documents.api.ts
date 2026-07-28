import { apiRequest } from './client';

export interface DocumentSignature {
    token: string;
    workerId: string;
    nombre: string;
    rut: string;
    tipoFirma: string;
    fecha: string;
    horario: string;
    timestamp: string;
}

export interface DocumentAssignment {
    workerId: string;
    nombre?: string;
    rut?: string;
    fechaAsignacion: string;
    fechaLimite?: string;
    estado: string;
    notificado: boolean;
    fechaFirma?: string;
}

export interface Document {
    documentId: string;
    tipo: string;
    tipoDescripcion: string;
    titulo: string;
    contenido?: string;
    descripcion?: string;
    empresaId: string;
    relatorId?: string;
    s3Key?: string;
    archivoUrl?: string;
    archivoNombre?: string;
    firmas: DocumentSignature[];
    asignaciones: DocumentAssignment[];
    estado: string;
    version: number;
    // Historial de versiones de un procedimiento (snapshot inmutable por versión).
    versiones?: DocumentVersion[];
    ultimoMotivoVersion?: string | null;
    notasCambio?: string | null;
    ultimaPublicacionPor?: string | null;
    ultimaPublicacionNombre?: string | null;
    createdAt: string;
    updatedAt: string;
}

export interface DocumentVersion {
    version: number;
    s3Key?: string | null;
    archivoNombre?: string | null;
    publicadaPor?: string | null;
    publicadaPorNombre?: string | null;
    publicadaEn?: string | null;
    motivo?: string | null;
    firmasArchivadas?: DocumentSignature[];
    asignacionesArchivadas?: DocumentAssignment[];
}

export interface NuevaVersionData {
    s3Key: string;
    archivoNombre?: string;
    motivo: string;
    notasCambio?: string;
    publicadaPor?: string;
    publicadaPorNombre?: string;
    // Versión que el cliente cree vigente (control de concurrencia optimista).
    versionEsperada?: number;
}

export interface CreateDocumentData {
    tipo: string;
    titulo: string;
    contenido?: string;
    descripcion?: string;
    empresaId?: string;
    relatorId?: string;
    archivoUrl?: string;
    archivoNombre?: string;
    createdBy?: string;
    creatorName?: string;
}

export interface DocumentListParams {
    empresaId?: string;
    obraId?: string;
    tipo?: string;
    estado?: string;
    clasificacion?: string;
    // personaId: devuelve solo documentos de onboarding con asignación pendiente
    // para esa persona y con archivo cargado (listos para que ella los firme).
    pendienteDe?: string;
    // personaId: TODOS los documentos donde la persona tiene asignación (firmada o
    // pendiente) — para calcular su cumplimiento personal.
    asignadoA?: string;
}

export interface DocumentListResponse {
    documents: Document[];
    types: Record<string, string>;
}

export interface AssignDocumentData {
    workerIds: string[];
    personaIds?: string[];
    fechaLimite?: string;
    notificar?: boolean;
    assignedBy?: string;
    assignerName?: string;
}

export interface AssignResult {
    message: string;
    asignaciones: DocumentAssignment[];
}

export interface SignDocumentData {
    personaId: string;
    // 'documento' (firma del asignado) | 'relator' (firma cruzada, requiere permiso firmar_relator)
    tipoFirma: string;
    pin?: string;
    // Modalidad informativa de la capacitacion (solo firma de relator CAPACITACION_SST)
    modalidad?: string;
}

export interface BulkSignData {
    workerIds: string[];
    tipoFirma?: string;
    relatorId?: string;
}

export interface BulkSignResult {
    message: string;
    firmas: DocumentSignature[];
}

export interface DownloadFirmadoResult {
    // 'listo': ya hay URL descargable. 'generando': el PDF estampado se está
    // regenerando en segundo plano (hubo firmas nuevas desde la última vez);
    // reintentar en unos segundos.
    estado: 'listo' | 'generando';
    url?: string;
    firmasCount: number;
}

export const documentsApi = {
    list: (params?: DocumentListParams) => {
        const query = new URLSearchParams(params as Record<string, string>).toString();
        return apiRequest<DocumentListResponse>(`/documents${query ? `?${query}` : ''}`);
    },

    get: (id: string) =>
        apiRequest<Document>(`/documents/${id}`),

    update: (id: string, data: Partial<Document>) =>
        apiRequest<Document>(`/documents/${id}`, {
            method: 'PUT',
            body: JSON.stringify(data),
        }),

    // Publica una nueva versión de un procedimiento: archiva la anterior, resetea
    // las firmas (re-firma obligatoria) y notifica a la línea de mando.
    nuevaVersion: (id: string, data: NuevaVersionData) =>
        apiRequest<Document>(`/documents/${id}/nueva-version`, {
            method: 'POST',
            body: JSON.stringify(data),
        }),

    create: (doc: CreateDocumentData) =>
        apiRequest<Document>('/documents', {
            method: 'POST',
            body: JSON.stringify(doc),
        }),

    assign: (id: string, data: AssignDocumentData) =>
        apiRequest<AssignResult>(`/documents/${id}/assign`, {
            method: 'POST',
            body: JSON.stringify(data),
        }),

    sign: (id: string, data: SignDocumentData) =>
        apiRequest<{ message: string; signature: DocumentSignature }>(`/documents/${id}/sign`, {
            method: 'POST',
            body: JSON.stringify(data),
        }),

    signBulk: (id: string, data: BulkSignData) =>
        apiRequest<BulkSignResult>(`/documents/${id}/sign-bulk`, {
            method: 'POST',
            body: JSON.stringify(data),
        }),

    // Firma asistida: un admin/jefe_obra/supervisor/prevencionista inicia la firma
    // y el TRABAJADOR teclea su PIN. La firma queda con personaId del trabajador y
    // metadata.asistidoPor para trazabilidad.
    signAssisted: (
        id: string,
        data: {
            firmanteId: string;
            asistidoPor: string;
            metodo?: 'PIN' | 'PRESENCIAL';
            pin?: string;
            firmaManuscrita?: string;
        }
    ) =>
        apiRequest<{ message: string; firma: DocumentSignature; signatureId: string; token: string }>(
            `/documents/${id}/sign-assisted`,
            {
                method: 'POST',
                body: JSON.stringify(data),
            }
        ),

    // PDF con el anexo de firmas estampado (legal). Puede responder
    // estado:'generando' si se acaba de encolar la regeneración: usar
    // waitForDocumentoFirmado para reintentar automáticamente.
    downloadFirmado: (id: string) =>
        apiRequest<DownloadFirmadoResult>(`/documents/${id}/download-firmado`),
};

/**
 * Pide la descarga del PDF firmado y reintenta mientras el backend responda
 * 'generando' (el estampado se procesa async, serializado por documento para
 * no perder firmas si varias personas firman/descargan a la vez). Devuelve
 * la URL lista o null si se agotan los intentos.
 */
export async function waitForDocumentoFirmado(
    id: string,
    { maxAttempts = 15, intervalMs = 2000 }: { maxAttempts?: number; intervalMs?: number } = {}
): Promise<string | null> {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const res = await documentsApi.downloadFirmado(id);
        if (res.success && res.data?.estado === 'listo' && res.data.url) {
            return res.data.url;
        }
        if (!res.success) return null;
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
    return null;
}