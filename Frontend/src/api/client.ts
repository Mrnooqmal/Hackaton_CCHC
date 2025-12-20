const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

interface ApiResponse<T> {
    success: boolean;
    data?: T;
    error?: string;
}

async function apiRequest<T>(
    endpoint: string,
    options: RequestInit = {}
): Promise<ApiResponse<T>> {
    try {
        const response = await fetch(`${API_BASE_URL}${endpoint}`, {
            headers: {
                'Content-Type': 'application/json',
                ...options.headers,
            },
            ...options,
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

// Workers API
export const workersApi = {
    list: (empresaId?: string) =>
        apiRequest<Worker[]>(`/workers${empresaId ? `?empresaId=${empresaId}` : ''}`),

    get: (id: string) =>
        apiRequest<Worker>(`/workers/${id}`),

    getByRut: (rut: string) =>
        apiRequest<Worker>(`/workers/rut/${encodeURIComponent(rut)}`),

    create: (worker: CreateWorkerData) =>
        apiRequest<Worker>('/workers', {
            method: 'POST',
            body: JSON.stringify(worker),
        }),

    update: (id: string, data: Partial<Worker>) =>
        apiRequest<Worker>(`/workers/${id}`, {
            method: 'PUT',
            body: JSON.stringify(data),
        }),

    sign: (id: string, signData: SignData) =>
        apiRequest<SignatureResult>(`/workers/${id}/sign`, {
            method: 'POST',
            body: JSON.stringify(signData),
        }),

    setPin: (id: string, pin: string, pinActual?: string) =>
        apiRequest<{ message: string; pinCreatedAt: string }>(`/workers/${id}/set-pin`, {
            method: 'POST',
            body: JSON.stringify({ pin, pinActual }),
        }),

    completeEnrollment: (id: string, pin: string) =>
        apiRequest<EnrollmentResult>(`/workers/${id}/complete-enrollment`, {
            method: 'POST',
            body: JSON.stringify({ pin }),
        }),
};

// Users API
export const usersApi = {
    create: (user: CreateUserData) =>
        apiRequest<User>('/users', {
            method: 'POST',
            body: JSON.stringify(user),
        }),

    list: (params?: UserListParams) => {
        const query = new URLSearchParams(params as Record<string, string>).toString();
        return apiRequest<{ total: number; users: User[]; roles: Record<string, any> }>(`/users${query ? `?${query}` : ''}`);
    },

    get: (id: string) =>
        apiRequest<User>(`/users/${id}`),

    getByRut: (rut: string) =>
        apiRequest<User>(`/users/rut/${encodeURIComponent(rut)}`),

    update: (id: string, data: Partial<User>) =>
        apiRequest<User>(`/users/${id}`, {
            method: 'PUT',
            body: JSON.stringify(data),
        }),

    resetPassword: (id: string) =>
        apiRequest<{ message: string; passwordTemporal: string }>(`/users/${id}/reset-password`, {
            method: 'POST',
        }),

    setPin: (id: string, pin: string) =>
        apiRequest<{ message: string; pinCreatedAt: string }>(`/users/${id}/set-pin`, {
            method: 'POST',
            body: JSON.stringify({ pin }),
        }),

    completeEnrollment: (id: string, pin: string) =>
        apiRequest<EnrollmentResult>(`/users/${id}/complete-enrollment`, {
            method: 'POST',
            body: JSON.stringify({ pin }),
        }),
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
    userId: string;
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
    tipoFirma: 'enrolamiento' | 'documento' | 'actividad' | 'capacitacion';
    referenciaId?: string;
    referenciaTipo?: string;
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
    fechaAsignacion: string;
    fechaLimite?: string;
    estado: string;
    notificado: boolean;
}

export interface CreateDocumentData {
    tipo: string;
    titulo: string;
    contenido?: string;
    descripcion?: string;
    empresaId?: string;
    relatorId?: string;
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
}

export interface AssignResult {
    message: string;
    asignaciones: DocumentAssignment[];
}

export interface SignDocumentData {
    workerId: string;
    tipoFirma: string;
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
    tema: string;
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
    tema: string;
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
}

export interface UpdateSurveyResponsePayload {
    estado: 'pendiente' | 'respondida';
    responses?: SurveyAnswer[];
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
    createdAt: string;
    updatedAt: string;
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
};
