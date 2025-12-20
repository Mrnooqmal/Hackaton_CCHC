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
