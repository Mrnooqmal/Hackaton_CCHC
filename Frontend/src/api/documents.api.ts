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

export interface DocumentDifusion {
    fecha: string;
    version: number | null;
    /** `automatica`: la escribió el EventBus al publicar una versión.
     *  `manual`: la declaró alguien con destinatario tipificado y medio.
     *  Los documentos anteriores al Art. 57 no la traen: por eso es opcional. */
    origen?: 'automatica' | 'manual';
    // ── Solo en las manuales ──
    destinatarioTipo?: string;
    medio?: 'Correo' | 'Entrega' | 'Plataforma' | 'Otro';
    evidenciaDocumentoId?: string | null;
    observacion?: string | null;
    registradoPor?: string | null;
    registradoEn?: string;
    // ── Solo en las automáticas ──
    motivo?: string | null;
    publicadaPor?: string | null;
    destinatarios?: {
        /** Roles de gestión (admin, jefe de obra, supervisor, prevencionista). */
        mando: string[];
        /** Integrantes de órganos vigentes: comité paritario, delegado, DPR. */
        representantes: string[];
        /** Firmantes de la versión anterior, convocados a re-firmar. */
        firmantes: string[];
    };
    totales?: { mando: number; representantes: number; firmantes: number };
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
    /** Fase del ciclo Deming a la que pertenece el documento de obra
     *  ('plan' | 'hacer' | 'verificar' | 'actuar'). El backend la persiste
     *  (documents/handler.js), y sin ella un mismo `tipo` que existe en dos
     *  fases —PLAN_EMERGENCIAS— se da por cumplido en la fase equivocada.
     *  Los documentos antiguos no la tienen: por eso es opcional. */
    fase?: string | null;
    /** Período al que corresponde el documento ('2026'). Solo lo usan los que se
     *  exigen una vez por período: programa de trabajo del CPHS (ítem 38) y
     *  registros e indicadores de SST (ítems 46 y 47). */
    periodo?: string | null;
    /** Constancia de difusión: a quién se informó cada versión y cuándo. La
     *  escribe el EventBus al publicar (Art. 7 inc. 9, Art. 8 inc. 3, Art. 57
     *  inc. 2); el fiscalizador pide la prueba, no la capacidad de notificar. */
    difusiones?: DocumentDifusion[];
    /** Desde cuándo rige el documento. El Art. 57 inc. 2 mide la anticipación
     *  del envío contra ESTA fecha, no contra la de subida: subir el archivo no
     *  es informarlo. Solo la usan los documentos que entran en vigencia. */
    fechaEntradaVigencia?: string | null;
    firmas: DocumentSignature[];
    asignaciones: DocumentAssignment[];
    estado: string;
    /** Fecha del hecho que el documento acredita, distinta de `createdAt`: un acta
     *  de un simulacro de marzo subida en septiembre acredita marzo, y es contra
     *  esta fecha que se mide la vigencia anual (Art. 19). */
    fecha?: string | null;
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

// FUF 51 / Art. 57 inc. 5: registro de quién participó en la revisión del
// documento (Reglamento Interno, MIPER, procedimientos) que originó una versión.
export type EntidadRevision = 'DEPTO_PREVENCION' | 'COMITE_PARITARIO' | 'DELEGADO_SST' | 'SINDICATO';

export interface ParticipantesRevision {
    entidades: EntidadRevision[];   // órganos que participaron en la revisión
    detalle?: string;               // nombres de asistentes / referencia al acta
    fechaRevision?: string;         // fecha de la reunión de revisión (YYYY-MM-DD)
}

export interface DocumentVersion {
    version: number;
    s3Key?: string | null;
    archivoNombre?: string | null;
    publicadaPor?: string | null;
    publicadaPorNombre?: string | null;
    publicadaEn?: string | null;
    motivo?: string | null;
    participantes?: ParticipantesRevision | null;
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
    participantesRevision?: ParticipantesRevision | null;
    // Versión que el cliente cree vigente (control de concurrencia optimista).
    versionEsperada?: number;
}

/** Constancia de envío declarada (Art. 57 inc. 2 y equivalentes). */
export interface DifusionManualData {
    destinatarioTipo: string;
    medio: 'Correo' | 'Entrega' | 'Plataforma' | 'Otro';
    fecha?: string;
    evidenciaDocumentoId?: string | null;
    observacion?: string | null;
    registradoPor?: string;
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
    periodo?: string;
    fecha?: string;
    obraId?: string;
    createdBy?: string;
    creatorName?: string;
}

/**
 * Quién está preguntando. Sale de la sesión guardada y no de un parámetro, para
 * que ninguna pantalla pueda olvidarlo: son unas veinte llamadas y basta una sin
 * identificar para que a alguien le desaparezcan sus propios exámenes.
 */
function solicitanteActual(): string | null {
    try {
        return localStorage.getItem('persona_id');
    } catch {
        return null;
    }
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
    /** Publica una versión nueva de un documento corporativo (Reglamento, Política).
     *  No lleva documentId: versiona todas las copias por persona a la vez y emite
     *  una sola notificación (Art. 57 inc. 5 — FUF 51). */
    nuevaVersionCorporativa: (data: {
        tenantId: string;
        tipo: 'REGLAMENTO_INTERNO' | 'POLITICA_SSO';
        s3Key: string;
        archivoNombre?: string;
        motivo: string;
        notasCambio?: string;
        publicadaPor?: string;
        publicadaPorNombre?: string;
        participantesRevision?: ParticipantesRevision | null;
    }) => apiRequest<{ message: string; copiasActualizadas: number; firmantesConvocados: number }>(
        '/documents/corporativo/nueva-version',
        { method: 'POST', body: JSON.stringify(data) },
    ),

    /**
     * Lista documentos del tenant.
     *
     * Se adjunta SIEMPRE el `solicitanteId` de quien pregunta: los documentos con
     * información de salud (vigilancia, exámenes, restricciones) solo los ve quien
     * tiene el permiso de vigilancia o la persona a la que se refieren. Si no va
     * identificado, el servidor los oculta — la falla segura es que falten
     * documentos, nunca que se filtren datos de salud.
     */
    list: (params?: DocumentListParams) => {
        const query = new URLSearchParams({
            ...(params as Record<string, string>),
            ...(solicitanteActual() ? { solicitanteId: solicitanteActual() as string } : {}),
        }).toString();
        return apiRequest<DocumentListResponse>(`/documents${query ? `?${query}` : ''}`);
    },

    get: (id: string) =>
        apiRequest<Document>(`/documents/${id}`),

    /** Elimina un documento. El backend lo rechaza si ya tiene firmas. */
    remove: (id: string, actorId?: string) =>
        apiRequest<{ documentId: string }>(
            `/documents/${id}${actorId ? `?actorId=${encodeURIComponent(actorId)}` : ''}`,
            { method: 'DELETE' },
        ),

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

    /** Registra un envío declarado. Se suma al mismo array `difusiones[]` que
     *  escribe el sistema al publicar una versión: una sola constancia. */
    registrarDifusion: (id: string, data: DifusionManualData) =>
        apiRequest<{ message: string; documento: Document }>(`/documents/${id}/difusion`, {
            method: 'POST', body: JSON.stringify(data),
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