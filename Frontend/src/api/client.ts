const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

interface ApiResponse<T> {
    success: boolean;
    data?: T;
    error?: string;
}

export async function apiRequest<T>(
    endpoint: string,
    options: RequestInit = {}
): Promise<ApiResponse<T>> {
    try {
        const token = localStorage.getItem('auth_token');
        const tenantId = localStorage.getItem('tenant_id');
        
        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            ...(options.headers as Record<string, string> || {}),
        };

        if (token && !headers['Authorization']) {
            headers['Authorization'] = `Bearer ${token}`;
        }

        let finalEndpoint = endpoint;
        // Si hay tenantId y la ruta no es de auth (login/refresh) ni de tenants (onboarding)
        if (tenantId && !endpoint.startsWith('/auth') && !endpoint.startsWith('/tenants') && !endpoint.includes('tenantId=')) {
            finalEndpoint = endpoint.includes('?') 
                ? `${endpoint}&tenantId=${tenantId}` 
                : `${endpoint}?tenantId=${tenantId}`;
        }

        const response = await fetch(`${API_BASE_URL}${finalEndpoint}`, {
            ...options,
            headers,
        });

        const data = await response.json();
        return data;
    } catch (error) {
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Error desconocido',
        };
    }
}

// Workers API (Legacy mapping to Personas)
export const workersApi = {
    list: async (empresaId?: string) => {
        const tenantId = empresaId || localStorage.getItem('tenant_id');
        const res = await apiRequest<{ total: number; personas: any[] }>(`/personas?tenantId=${tenantId}`);
        if (res.success && res.data) {
            // Map Personas to legacy Worker structure expected by components
            const mapped = res.data.personas.map(p => ({
                ...p,
                workerId: p.personaId,
                empresaId: p.tenantId
            }));
            return { success: true, data: mapped as unknown as Worker[] };
        }
        return res as any;
    },

    get: async (id: string) => {
        const res = await personasApi.get(id);
        if (res.success && res.data) {
            return { success: true, data: { ...res.data, workerId: res.data.personaId, empresaId: res.data.tenantId } as unknown as Worker };
        }
        return res as any;
    },

    getByRut: async (rut: string) => {
        const tenantId = localStorage.getItem('tenant_id') || '';
        const res = await personasApi.getByRut(tenantId, rut);
        if (res.success && res.data) {
            return { success: true, data: { ...res.data, workerId: res.data.personaId, empresaId: res.data.tenantId } as unknown as Worker };
        }
        return res as any;
    },

    create: (worker: CreateWorkerData) =>
        apiRequest<Worker>('/personas', {
            method: 'POST',
            body: JSON.stringify(worker),
        }),

    update: (id: string, data: Partial<Worker>) => {
        const tenantId = localStorage.getItem('tenant_id') || '';
        return personasApi.update(tenantId, id, data as any);
    },

    sign: (id: string, signData: SignData) =>
        apiRequest<SignatureResult>(`/signatures/worker/${id}`, {
            method: 'POST',
            body: JSON.stringify(signData),
        }),

    setPin: (id: string, pin: string, pinActual?: string) => {
        const tenantId = localStorage.getItem('tenant_id') || '';
        return personasApi.setPin(tenantId, id, pin, pinActual);
    },

    completeEnrollment: (id: string, pin: string) => {
        const tenantId = localStorage.getItem('tenant_id') || '';
        return personasApi.completarEnrolamiento(tenantId, id, pin);
    },
};

// Users API (Legacy mapping to Personas)
export const usersApi = {
    create: (user: CreateUserData) => {
        const tenantId = user.empresaId || localStorage.getItem('tenant_id') || '';
        return apiRequest<User>(`/personas?tenantId=${tenantId}`, {
            method: 'POST',
            body: JSON.stringify({
                ...user,
                tieneAccesoWeb: true
            }),
        });
    },

    list: async (params?: UserListParams) => {
        const tenantId = params?.empresaId || localStorage.getItem('tenant_id') || '';
        const res = await personasApi.list(tenantId, params as any);
        if (res.success && res.data) {
            const mapped = res.data.personas.map(p => ({
                ...p,
                userId: p.personaId,
                empresaId: p.tenantId
            }));
            return { success: true, data: { total: res.data.total, users: mapped as unknown as User[], roles: {} } };
        }
        return res as any;
    },

    get: async (id: string) => {
        const res = await personasApi.get(id);
        if (res.success && res.data) {
            return { success: true, data: { ...res.data, userId: res.data.personaId, empresaId: res.data.tenantId } as unknown as User };
        }
        return res as any;
    },

    getByRut: async (rut: string) => {
        const tenantId = localStorage.getItem('tenant_id') || '';
        const res = await personasApi.getByRut(tenantId, rut);
        if (res.success && res.data) {
            return { success: true, data: { ...res.data, userId: res.data.personaId, empresaId: res.data.tenantId } as unknown as User };
        }
        return res as any;
    },

    update: (id: string, data: Partial<User>) => {
        const tenantId = localStorage.getItem('tenant_id') || '';
        return personasApi.update(tenantId, id, data as any);
    },

    resetPassword: (id: string) => {
        const tenantId = localStorage.getItem('tenant_id') || '';
        // NOTA: resetPassword endpoint podría requerir mapeo especial, por ahora lo pasamos a un update genérico o endpoint si existe
        return apiRequest<{ message: string; passwordTemporal: string }>(`/personas/${id}/reset-password?tenantId=${tenantId}`, {
            method: 'POST',
        });
    },

    setPin: (id: string, pin: string) => {
        const tenantId = localStorage.getItem('tenant_id') || '';
        return personasApi.setPin(tenantId, id, pin);
    },

    completeEnrollment: (id: string, pin: string) => {
        const tenantId = localStorage.getItem('tenant_id') || '';
        return personasApi.completarEnrolamiento(tenantId, id, pin);
    },
};

// Auth API
export const authApi = {
    login: (rut: string, password: string) =>
        apiRequest<LoginResponse>('/auth/login', {
            method: 'POST',
            body: JSON.stringify({ rut, password }),
        }),

    changePassword: (data: ChangePasswordData) =>
        apiRequest<{ message: string }>('/auth/change-password', {
            method: 'POST',
            body: JSON.stringify(data),
        }),

    logout: (sessionId: string) =>
        apiRequest<{ message: string }>('/auth/logout', {
            method: 'POST',
            body: JSON.stringify({ sessionId }),
        }),

    me: (token: string) =>
        apiRequest<{ user: User; session: SessionInfo }>('/auth/me', {
            method: 'GET',
            headers: { Authorization: `Bearer ${token}` },
        }),

    validateToken: (token: string) =>
        apiRequest<{ valid: boolean; userId?: string; expiresAt?: string }>('/auth/validate-token', {
            method: 'POST',
            body: JSON.stringify({ token }),
        }),
};

// Documents API
export const documentsApi = {
    list: (params?: DocumentListParams) => {
        const query = new URLSearchParams(params as Record<string, string>).toString();
        return apiRequest<DocumentListResponse>(`/documents${query ? `?${query}` : ''}`);
    },

    get: (id: string) =>
        apiRequest<Document>(`/documents/${id}`),

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
        apiRequest<SignatureResult>(`/documents/${id}/sign`, {
            method: 'POST',
            body: JSON.stringify(data),
        }),

    signBulk: (id: string, data: BulkSignData) =>
        apiRequest<BulkSignResult>(`/documents/${id}/sign-bulk`, {
            method: 'POST',
            body: JSON.stringify(data),
        }),
};

// Activities API
export const activitiesApi = {
    list: (params?: ActivityListParams) => {
        const query = new URLSearchParams(params as Record<string, string>).toString();
        return apiRequest<ActivityListResponse>(`/activities${query ? `?${query}` : ''}`);
    },

    get: (id: string) =>
        apiRequest<Activity>(`/activities/${id}`),

    create: (activity: CreateActivityData) =>
        apiRequest<Activity>('/activities', {
            method: 'POST',
            body: JSON.stringify(activity),
        }),

    registerAttendance: (id: string, data: AttendanceData) =>
        apiRequest<AttendanceResult>(`/activities/${id}/attendance`, {
            method: 'POST',
            body: JSON.stringify(data),
        }),

    getStats: (params?: StatsParams) => {
        const query = new URLSearchParams(params as Record<string, string>).toString();
        return apiRequest<ActivityStats>(`/activities/stats${query ? `?${query}` : ''}`);
    },
};

// Types
export interface Worker {
    workerId: string;
    rut: string;
    nombre: string;
    apellido?: string;
    email?: string;
    telefono?: string;
    cargo: string;
    empresaId: string;
    fechaEnrolamiento: string;
    signatureToken: string;
    estado: 'activo' | 'inactivo';
    habilitado: boolean;
    pinHash?: string;
    pinCreatedAt?: string;
    firmaEnrolamiento?: {
        token: string;
        fecha: string;
        horario: string;
        timestamp: string;
    };
    firmas?: Signature[];
    createdAt: string;
    updatedAt: string;
}

// User & Auth Types
export interface User {
    userId: string;
    personaId?: string;
    tenantId?: string;
    rut: string;
    nombre: string;
    apellido: string;
    rol: 'admin' | 'prevencionista' | 'trabajador';
    email?: string;
    estado: 'pendiente' | 'activo' | 'suspendido';
    habilitado: boolean;
    passwordTemporal?: boolean;
    ultimoAcceso?: string;
    creadoPor?: string;
    workerId?: string;
    empresaId?: string;
}

export interface LoginResponse {
    token: string;
    sessionId: string;
    expiresAt: string;
    user: User;
    requiereCambioPassword: boolean;
    requiereEnrolamiento: boolean;
}

export interface CreateUserData {
    rut: string;
    nombre: string;
    apellido: string;
    rol: string;
    email?: string;
    cargo?: string;
    empresaId?: string;
}

export interface UserListParams {
    empresaId?: string;
    rol?: string;
    estado?: string;
}

export interface LoginResponse {
    token: string;
    sessionId: string;
    expiresAt: string;
    user: User;
    requiereCambioPassword: boolean;
    requiereEnrolamiento: boolean;
}

export interface ChangePasswordData {
    personaId: string;
    passwordActual: string;
    passwordNuevo: string;
    confirmarPassword: string;
}

export interface SessionInfo {
    sessionId: string;
    expiresAt: string;
    lastActivity: string;
}

export interface CreateWorkerData {
    rut: string;
    nombre: string;
    apellido?: string;
    email?: string;
    telefono?: string;
    cargo: string;
    empresaId?: string;
}

export interface SignData {
    tipo?: string;
    documentoId?: string;
}

export interface Signature {
    token: string;
    nombre: string;
    rut: string;
    fecha: string;
    horario: string;
    tipo: string;
    documentoId?: string;
    timestamp: string;
}

export interface SignatureResult {
    message: string;
    signature: Signature;
}

export interface EnrollmentResult {
    message: string;
    workerId: string;
    habilitado: boolean;
    firma: {
        token: string;
        fecha: string;
        horario: string;
    };
}

// Signatures API
export interface DigitalSignature {
    signatureId: string;
    token: string;
    workerId: string;
    workerRut: string;
    workerNombre: string;
    tipoFirma: 'enrolamiento' | 'documento' | 'actividad' | 'capacitacion';
    referenciaId?: string;
    referenciaTipo?: string;
    fecha: string;
    horario: string;
    timestamp: string;
    ipAddress: string;
    userAgent: string;
    metodoValidacion: string;
    estado: 'valida' | 'disputada' | 'revocada';
    disputaInfo?: {
        motivo: string;
        reportadoPor: string;
        fechaReporte: string;
        resolucion?: string;
        resueltoPor?: string;
        fechaResolucion?: string;
    };
    metadata?: Record<string, unknown>;
    empresaId: string;
    createdAt: string;
}

export interface CreateSignatureData {
    workerId: string;
    pin: string;
    tipoFirma?: 'enrolamiento' | 'documento' | 'actividad' | 'capacitacion';
    referenciaId?: string;
    referenciaTipo?: string;
    requestId?: string;
    metadata?: Record<string, unknown>;
}

export interface SignatureCreateResult {
    message: string;
    signature: {
        signatureId: string;
        token: string;
        workerNombre: string;
        workerRut: string;
        fecha: string;
        horario: string;
        tipoFirma: string;
        estado: string;
    };
}

export interface DisputeData {
    motivo: string;
    reportadoPor: string;
}

export interface ResolveDisputeData {
    resolucion: string;
    resueltoPor: string;
    nuevoEstado: 'valida' | 'revocada';
}

export const signaturesApi = {
    create: (data: CreateSignatureData) =>
        apiRequest<SignatureCreateResult>('/signatures', {
            method: 'POST',
            body: JSON.stringify(data),
        }),

    get: (id: string) =>
        apiRequest<DigitalSignature>(`/signatures/${id}`),

    getByWorker: (workerId: string) =>
        apiRequest<{ workerId: string; totalFirmas: number; firmas: DigitalSignature[] }>(
            `/signatures/worker/${workerId}`
        ),

    dispute: (id: string, data: DisputeData) =>
        apiRequest<{ message: string; signatureId: string; disputaInfo: DisputeData }>(
            `/signatures/${id}/dispute`,
            {
                method: 'POST',
                body: JSON.stringify(data),
            }
        ),

    resolve: (id: string, data: ResolveDisputeData) =>
        apiRequest<{ message: string; signatureId: string; nuevoEstado: string }>(
            `/signatures/${id}/resolve`,
            {
                method: 'PUT',
                body: JSON.stringify(data),
            }
        ),

    listDisputes: (empresaId?: string) =>
        apiRequest<{ totalDisputas: number; disputas: DigitalSignature[] }>(
            `/signatures/disputes${empresaId ? `?empresaId=${empresaId}` : ''}`
        ),
};

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
    createdAt: string;
    updatedAt: string;
}

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
    tipo?: string;
    estado?: string;
}

export interface DocumentListResponse {
    documents: Document[];
    types: Record<string, string>;
}

export interface AssignDocumentData {
    workerIds: string[];
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
    workerId: string;
    tipoFirma: string;
    pin?: string;
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

export interface Activity {
    activityId: string;
    tipo: string;
    tipoDescripcion: string;
    titulo: string;
    descripcion?: string;
    fecha: string;
    horaInicio: string;
    horaFin?: string;
    relatorId: string;
    empresaId: string;
    ubicacion?: string;
    asistentes: Attendee[];
    firmaRelator?: Signature;
    estado: 'programada' | 'en_curso' | 'completada' | 'cancelada';
    createdAt: string;
    updatedAt: string;
}

export interface Attendee {
    workerId: string;
    nombre: string;
    rut: string;
    cargo: string;
    firma: {
        token: string;
        fecha: string;
        horario: string;
        timestamp: string;
    };
}

export interface CreateActivityData {
    tipo: string;
    titulo: string;
    descripcion?: string;
    fecha?: string;
    horaInicio?: string;
    relatorId: string;
    empresaId?: string;
    ubicacion?: string;
}

export interface ActivityListParams {
    empresaId?: string;
    tipo?: string;
    estado?: string;
    fecha?: string;
    relatorId?: string;
}

export interface ActivityListResponse {
    activities: Activity[];
    types: Record<string, string>;
}

export interface AttendanceData {
    workerId?: string;
    workerIds?: string[];
    incluirFirmaRelator?: boolean;
    pin?: string; // PIN for digital signature
}

export interface AttendanceResult {
    message: string;
    totalAsistentes: number;
    nuevosAsistentes: Attendee[];
    firmaRelator?: Signature;
}

export interface StatsParams {
    empresaId?: string;
    fechaInicio?: string;
    fechaFin?: string;
}

export interface ActivityStats {
    total: number;
    completadas: number;
    programadas: number;
    canceladas: number;
    porTipo: Record<string, { nombre: string; total: number; completadas: number }>;
    totalAsistentes: number;
    promedioAsistentesPorActividad: number;
    porcentajeCumplimiento: number;
}

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
    createdBy?: string; // userId of the creator
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
    pin?: string; // PIN for digital signature (required when estado is 'respondida')
}

export const surveysApi = {
    list: (params?: { empresaId?: string }) => {
        const query = params?.empresaId ? `?empresaId=${params.empresaId}` : '';
        return apiRequest<{ total: number; surveys: Survey[] }>(`/surveys${query}`);
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

// Incidents API Types
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
    // Campos adicionales para reportes QR
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

// Nuevas interfaces para Fase 4

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

// Incidents API
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

    // Nuevos endpoints para Fase 4

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

// ========================================
// SIGNATURE REQUESTS TYPES
// ========================================

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

export interface DisputeInfo {
    motivo: string;
    reportadoPor: string;
    fechaReporte: string;
    resolucion?: string;
    resueltoPor?: string;
    fechaResolucion?: string;
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

// Upload Types
export interface UploadUrlResponse {
    uploadUrl: string;
    fileKey: string;
    expiresIn: number;
    bucket: string;
}

export interface ConfirmUploadResponse {
    confirmed: boolean;
    documento: DocumentoAdjunto;
    downloadUrl: string;
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

// ========================================
// API: SIGNATURE REQUESTS (Solicitudes de Firma)
// ========================================
export const signatureRequestsApi = {
    create: (data: CreateSignatureRequestData) =>
        apiRequest<SignatureRequest>('/signature-requests', {
            method: 'POST',
            body: JSON.stringify(data),
        }),

    list: (params?: { empresaId?: string; estado?: string; solicitanteId?: string; tipo?: string }) => {
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

// ========================================
// API: UPLOADS (Subida de archivos a S3)
// ========================================
export const uploadsApi = {
    getUploadUrl: (data: { fileName: string; fileType: string; fileSize: number; categoria?: string; empresaId?: string }) =>
        apiRequest<UploadUrlResponse>('/uploads/presigned-url', {
            method: 'POST',
            body: JSON.stringify(data),
        }),

    getDownloadUrl: (fileKey: string) =>
        apiRequest<{ downloadUrl: string; expiresIn: number }>('/uploads/download-url', {
            method: 'POST',
            body: JSON.stringify({ fileKey }),
        }),

    confirmUpload: (data: { fileKey: string; fileName: string; fileType: string; fileSize: number }) =>
        apiRequest<ConfirmUploadResponse>('/uploads/confirm', {
            method: 'POST',
            body: JSON.stringify(data),
        }),

    deleteFile: (fileKey: string) =>
        apiRequest<{ deleted: boolean; fileKey: string }>(`/uploads/${encodeURIComponent(fileKey)}`, {
            method: 'DELETE',
        }),

    getBatchDownloadUrls: (fileKeys: string[]) =>
        apiRequest<{ urls: { fileKey: string; downloadUrl: string | null; error: string | null }[]; expiresIn: number }>(
            '/uploads/batch-download-urls',
            {
                method: 'POST',
                body: JSON.stringify({ fileKeys }),
            }
        ),

    // Helper para subir archivo completo
    uploadFile: async (file: File, categoria?: string, empresaId?: string): Promise<ApiResponse<DocumentoAdjunto>> => {
        try {
            // 1. Obtener URL presigned
            const urlResponse = await uploadsApi.getUploadUrl({
                fileName: file.name,
                fileType: file.type,
                fileSize: file.size,
                categoria,
                empresaId,
            });

            if (!urlResponse.success || !urlResponse.data) {
                return { success: false, error: urlResponse.error || 'Error al obtener URL de subida' };
            }

            // 2. Subir archivo a S3
            const uploadResult = await fetch(urlResponse.data.uploadUrl, {
                method: 'PUT',
                body: file,
                headers: {
                    'Content-Type': file.type,
                },
            });

            if (!uploadResult.ok) {
                return { success: false, error: 'Error al subir archivo a S3' };
            }

            // 3. Confirmar subida
            const confirmResponse = await uploadsApi.confirmUpload({
                fileKey: urlResponse.data.fileKey,
                fileName: file.name,
                fileType: file.type,
                fileSize: file.size,
            });

            if (!confirmResponse.success || !confirmResponse.data) {
                return { success: false, error: confirmResponse.error || 'Error al confirmar subida' };
            }

            return {
                success: true,
                data: confirmResponse.data.documento,
            };
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Error desconocido al subir archivo',
            };
        }
    },
};

// ========================================
// REQUEST TYPES (Constantes)
// ========================================
export const REQUEST_TYPES: Record<string, SignatureRequestType> = {
    CHARLA_5MIN: { label: 'Charla de 5 Minutos', icon: '💬', requiresDoc: false },
    CAPACITACION: { label: 'Capacitación', icon: '📚', requiresDoc: true },
    INDUCCION: { label: 'Inducción', icon: '🎓', requiresDoc: true },
    ENTREGA_EPP: { label: 'Entrega de EPP', icon: '🦺', requiresDoc: true },
    ART: { label: 'Análisis de Riesgos en Terreno', icon: '⚠️', requiresDoc: true },
    PROCEDIMIENTO: { label: 'Procedimiento de Trabajo', icon: '📋', requiresDoc: true },
    INSPECCION: { label: 'Inspección de Seguridad', icon: '🔍', requiresDoc: false },
    REGLAMENTO: { label: 'Reglamento Interno', icon: '📖', requiresDoc: true },
    OTRO: { label: 'Otro', icon: '📝', requiresDoc: false },
};

// ========================================
// INBOX TYPES
// ========================================
export type MessageType = 'message' | 'notification' | 'alert' | 'task';
export type MessagePriority = 'normal' | 'high' | 'urgent';

export interface InboxMessage {
    recipientId: string;
    messageId: string;
    senderId: string;
    senderName: string;
    senderRol: string;
    type: MessageType;
    priority: MessagePriority;
    subject: string;
    content: string;
    read: boolean;
    readAt: string | null;
    archivedByRecipient: boolean;
    linkedEntity?: {
        type: 'activity' | 'document' | 'incident' | 'survey' | 'signature-request';
        id: string;
        title?: string;
    };
    createdAt: string;
    updatedAt: string;
}

export interface SendMessageData {
    senderId: string;
    senderName: string;
    senderRol: string;
    recipientIds: string[];
    type?: MessageType;
    priority?: MessagePriority;
    subject: string;
    content: string;
    linkedEntity?: InboxMessage['linkedEntity'];
}

export interface InboxRecipient {
    userId: string;
    nombre: string;
    apellido: string;
    nombreCompleto: string;
    rut: string;
    rol: string;
    cargo: string;
    email?: string;
}

// ========================================
// INBOX API
// ========================================
export const inboxApi = {
    send: (data: SendMessageData) =>
        apiRequest<{ message: string; messageId: string; count: number }>('/inbox/send', {
            method: 'POST',
            body: JSON.stringify(data),
        }),

    getInbox: (userId: string, filter?: 'all' | 'unread' | 'archived', limit?: number) => {
        const params = new URLSearchParams({ userId });
        if (filter) params.append('filter', filter);
        if (limit) params.append('limit', limit.toString());
        return apiRequest<{ messages: InboxMessage[]; count: number }>(`/inbox?${params}`);
    },

    getSent: (userId: string, limit?: number) => {
        const params = new URLSearchParams({ userId });
        if (limit) params.append('limit', limit.toString());
        return apiRequest<{ messages: InboxMessage[]; count: number }>(`/inbox/sent?${params}`);
    },

    getMessage: (messageId: string, userId: string) =>
        apiRequest<InboxMessage>(`/inbox/${messageId}?userId=${userId}`),

    markAsRead: (messageId: string, userId: string) =>
        apiRequest<{ message: string }>(`/inbox/${messageId}/read`, {
            method: 'PUT',
            body: JSON.stringify({ userId }),
        }),

    markAllAsRead: (userId: string) =>
        apiRequest<{ message: string; count: number }>('/inbox/read-all', {
            method: 'PUT',
            body: JSON.stringify({ userId }),
        }),

    archive: (messageId: string, userId: string) =>
        apiRequest<{ message: string }>(`/inbox/${messageId}/archive`, {
            method: 'PUT',
            body: JSON.stringify({ userId }),
        }),

    delete: (messageId: string, userId: string) =>
        apiRequest<{ message: string }>(`/inbox/${messageId}?userId=${userId}`, {
            method: 'DELETE',
        }),

    getUnreadCount: (userId: string) =>
        apiRequest<{ unreadCount: number; userId: string }>(`/inbox/unread-count?userId=${userId}`),

    getRecipients: (userId: string, empresaId?: string) => {
        const params = new URLSearchParams({ userId });
        if (empresaId) params.append('empresaId', empresaId);
        return apiRequest<{
            recipients: InboxRecipient[];
            grouped: Record<string, InboxRecipient[]>;
            total: number;
        }>(`/inbox/recipients?${params}`);
    },
};

// ========================================
// AI TYPES
// ========================================
export interface MIPERPeligro {
    id: number;
    peligro: string;
    riesgo: string;
    actividad: string;
    probabilidad: 'A' | 'M' | 'B';
    consecuencia: '1' | '2' | '3' | '4';
    nivelRiesgo: 'Crítico' | 'Alto' | 'Medio' | 'Bajo';
    medidasControl: string[];
    epp: string[];
    responsable: string;
    verificacion: string;
}

export interface MIPERResult {
    cargo: string;
    fecha: string;
    actividades: string[];
    peligros: MIPERPeligro[];
    resumen: {
        totalPeligros: number;
        criticos: number;
        altos: number;
        medios: number;
        bajos: number;
    };
    recomendacionesPrioritarias: string[];
    _fallback?: boolean;
}

export interface RiskMatrixRiesgo {
    id: number;
    peligro: string;
    riesgo: string;
    probabilidad: 'Alta' | 'Media' | 'Baja';
    consecuencia: 'Grave' | 'Moderada' | 'Leve';
    nivelRiesgo: 'Crítico' | 'Alto' | 'Medio' | 'Bajo';
    medidasExistentes: string[];
    medidasAdicionales: string[];
    responsable: string;
    plazo: string;
}

export interface RiskMatrixResult {
    titulo: string;
    fecha: string;
    riesgos: RiskMatrixRiesgo[];
    recomendaciones: string[];
    _fallback?: boolean;
}

export interface PreventionPlanResult {
    titulo: string;
    periodo: string;
    objetivos: string[];
    actividades: { actividad: string; frecuencia: string; responsable: string }[];
    capacitaciones: string[];
    inspecciones?: { tipo: string; frecuencia: string; responsable: string }[];
    epp?: string[];
    indicadores: { nombre: string; meta: string; formula: string }[];
    procedimientosEmergencia?: string[];
    cronograma?: { semana: number; actividades: string[] }[];
    _fallback?: boolean;
}

export interface IncidentAnalysisResult {
    resumenIncidente: string;
    arbolDeCausas: {
        hecho: string;
        causasInmediatas: {
            actosSubestandar: string[];
            condicionesSubestandar: string[];
        };
        causasBasicas: {
            factoresPersonales: string[];
            factoresTrabajo: string[];
        };
        faltaControl: string[];
    };
    clasificacion: {
        tipo: string;
        gravedad: string;
        potencial: string;
    };
    accionesCorrectivas: { accion: string; responsable: string; plazo: string; prioridad: string }[];
    accionesPreventivas: { accion: string; responsable: string; plazo: string }[];
    leccionesAprendidas: string[];
    capacitacionRequerida: string[];
    _fallback?: boolean;
}

export interface ExtractedIncident {
    tipo: 'incidente' | 'accidente' | 'condicion_subestandar';
    centroTrabajo: string;
    trabajador: {
        nombre: string;
        rut: string;
    };
    descripcion: string;
    gravedad: 'leve' | 'grave' | 'fatal';
    medidasInmediatas: string[];
    _source?: string;
}

export interface DailyTalkResult {
    titulo: string;
    duracion: string;
    contenido: {
        introduccion: string;
        puntosClaves: string[];
        ejemplos: string[];
        buenasPracticas?: string[];
        conclusion: string;
        preguntas: string[];
    };
    materialesApoyo?: string[];
    normativaRelacionada?: string[];
    _fallback?: boolean;
}

export interface ChatResponse {
    respuesta: string;
    timestamp: string;
    _fallback?: boolean;
}

// ========================================
// AI API
// ========================================
export const aiApi = {
    chat: (mensaje: string, contexto?: object) =>
        apiRequest<ChatResponse>('/ai/chat', {
            method: 'POST',
            body: JSON.stringify({ mensaje, contexto }),
        }),

    generateMIPER: (cargo: string, actividades: string[] = [], contexto?: string, empresaId?: string) =>
        apiRequest<MIPERResult>('/ai/miper', {
            method: 'POST',
            body: JSON.stringify({ cargo, actividades, contexto, empresaId }),
        }),

    generateRiskMatrix: (actividad: string, descripcion?: string, ubicacion?: string) =>
        apiRequest<RiskMatrixResult>('/ai/risk-matrix', {
            method: 'POST',
            body: JSON.stringify({ actividad, descripcion, ubicacion }),
        }),

    generatePreventionPlan: (obra: string, riesgos: string[] = [], duracion?: string) =>
        apiRequest<PreventionPlanResult>('/ai/prevention-plan', {
            method: 'POST',
            body: JSON.stringify({ obra, riesgos, duracion }),
        }),

    generateDailyTalk: (tema: string, contexto?: string) =>
        apiRequest<DailyTalkResult>('/ai/daily-talk', {
            method: 'POST',
            body: JSON.stringify({ tema, contexto }),
        }),

    analyzeIncident: (descripcion: string, contexto?: { tipo?: string; gravedad?: string; area?: string }) =>
        apiRequest<IncidentAnalysisResult>('/ai/analyze-incident', {
            method: 'POST',
            body: JSON.stringify({ descripcion, ...contexto }),
        }),

    extractIncident: (texto: string) =>
        apiRequest<ExtractedIncident>('/ai/extract-incident', {
            method: 'POST',
            body: JSON.stringify({ texto }),
        }),

    transcribeAudio: (audio: string, mimeType: string) =>
        apiRequest<{ text: string }>('/ai/transcribe', {
            method: 'POST',
            body: JSON.stringify({ audio, mimeType }),
        }),
};

// ========================================
// TENANT TYPES
// ========================================
export interface TenantSettings {
    maxWorkers?: number;
    dataRetentionDays?: number;
    twoFactorEnabled?: boolean;
    modulosActivos?: string[];
}

export interface TenantReglas {
    fasesObligatorias?: string[];
    limiteObras?: number;
    requiereFirmaPin?: boolean;
}

export interface TenantPreferencias {
    timezone?: string;
    idioma?: string;
    formatoFecha?: string;
    colorPrimario?: string;
    colorSecundario?: string;
    logoUrl?: string | null;
}

export interface Tenant {
    tenantId: string;
    slug: string;
    nombre: string;
    rutEmpresa: string;
    email: string;
    telefono: string;
    plan: 'starter' | 'professional' | 'enterprise';
    tamano: 'micro' | 'pequena' | 'mediana' | 'grande';
    cantidadTrabajadores: number;
    estado: 'setup' | 'activo' | 'suspendido';
    adminPersonaId: string | null;
    settings: TenantSettings;
    reglas: TenantReglas;
    preferencias: TenantPreferencias;
    createdAt: string;
    updatedAt: string;
}

export interface TenantSetupData {
    nombre: string;
    rutEmpresa: string;
    cantidadTrabajadores: number;
    email?: string;
    telefono?: string;
    plan?: 'starter' | 'professional' | 'enterprise';
    settings?: Partial<TenantSettings>;
    reglas?: Partial<TenantReglas>;
    preferencias?: Partial<TenantPreferencias>;
    admin?: {
        rut: string;
        nombre: string;
        apellido?: string;
        email: string;
    };
}

export interface TenantSetupResponse {
    message: string;
    tenant: Tenant;
    admin: {
        personaId: string;
        rut: string;
        nombre: string;
        apellido: string;
        email: string;
        rol: string;
        estado: string;
    } | null;
}

export interface PersonaResponse {
    personaId: string;
    tenantId: string;
    rut: string;
    nombre: string;
    apellido: string;
    email: string;
    rol: string;
    cargo: string;
    estado: string;
    tieneAccesoWeb: boolean;
    habilitado: boolean;
    pinConfigurado: boolean;
    enrolado: boolean;
    permisos: string[];
    obraIds: string[];
    createdAt: string;
    updatedAt: string;
}

// ========================================
// TENANTS API
// ========================================
export const tenantsApi = {
    setup: (data: TenantSetupData) =>
        apiRequest<TenantSetupResponse>('/tenants/setup', {
            method: 'POST',
            body: JSON.stringify(data),
        }),

    list: (estado?: string) => {
        const query = estado ? `?estado=${estado}` : '';
        return apiRequest<{ total: number; tenants: Tenant[] }>(`/tenants${query}`);
    },

    get: (id: string) =>
        apiRequest<Tenant>(`/tenants/${id}`),

    update: (id: string, data: Partial<Tenant>) =>
        apiRequest<{ message: string; tenant: Tenant }>(`/tenants/${id}`, {
            method: 'PUT',
            body: JSON.stringify(data),
        }),
};

// ========================================
// PERSONAS API (Multi-tenant)
// ========================================
export const personasApi = {
    create: (tenantId: string, data: {
        rut: string;
        nombre: string;
        apellido?: string;
        email?: string;
        telefono?: string;
        rol: string;
        cargo?: string;
        tieneAccesoWeb?: boolean;
        obraIds?: string[];
    }) =>
        apiRequest<{ message: string; persona: PersonaResponse; passwordTemporal?: string; emailNotificado: boolean }>(
            `/personas?tenantId=${tenantId}`, {
            method: 'POST',
            body: JSON.stringify(data),
        }),

    list: (tenantId: string, filters?: { rol?: string; estado?: string; obraId?: string }) => {
        const params = new URLSearchParams({ tenantId });
        if (filters?.rol) params.append('rol', filters.rol);
        if (filters?.estado) params.append('estado', filters.estado);
        if (filters?.obraId) params.append('obraId', filters.obraId);
        return apiRequest<{ total: number; personas: PersonaResponse[] }>(`/personas?${params}`);
    },

    get: (id: string) =>
        apiRequest<PersonaResponse>(`/personas/${id}`),

    getByRut: (tenantId: string, rut: string) =>
        apiRequest<PersonaResponse>(`/personas/by-rut/${encodeURIComponent(rut)}?tenantId=${tenantId}`),

    update: (tenantId: string, id: string, data: Partial<PersonaResponse>) =>
        apiRequest<{ message: string; persona: PersonaResponse }>(`/personas/${id}?tenantId=${tenantId}`, {
            method: 'PUT',
            body: JSON.stringify(data),
        }),

    setPin: (tenantId: string, id: string, pin: string, pinActual?: string) =>
        apiRequest<{ message: string; pinCreatedAt: string }>(`/personas/${id}/set-pin?tenantId=${tenantId}`, {
            method: 'POST',
            body: JSON.stringify({ pin, pinActual }),
        }),

    completarEnrolamiento: (tenantId: string, id: string, pin: string) =>
        apiRequest<{ message: string; personaId: string; habilitado: boolean; firmaEnrolamiento: any }>(`/personas/${id}/enrolamiento?tenantId=${tenantId}`, {
            method: 'POST',
            body: JSON.stringify({ pin }),
        }),
};

