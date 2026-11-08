import { apiRequest } from './client';

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

export interface DigitalSignature {
    signatureId: string;
    token: string;
    personaId: string;
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
    personaId: string;
    workerId?: string;
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

export interface FirmaEnRevision {
    signatureId: string;
    personaId: string;
    personaNombre?: string;
    tipoFirma?: string;
    referenciaId?: string;
    referenciaTipo?: string;
    obraId?: string | null;
    timestamp?: string;
    motivoRevision?: string;
    offline?: {
        valeEmitidoEn?: string;
        valeExpiraEn?: string;
        valeEmitidoPor?: string | null;
        firmadaSinConexionEn?: string | null;
        sincronizadaEn?: string;
        valeAnuladoEn?: string | null;
        valeVencido?: boolean;
        personaDesvinculada?: boolean;
    } | null;
}

export interface ValesResponse {
    vales: string[];
    personaId: string;
    /** Obra del turno: el vale sirve para esa obra y para lo que no tiene obra. */
    obraId: string;
    expiraEn: string;
    vigenciaHoras: number;
    mensaje: string;
}

export const signaturesApi = {
    /**
     * Habilita la firma sin conexión para una persona: valida su PIN (con red) y
     * devuelve vales de un solo uso. El PIN no se guarda en el dispositivo; los
     * vales sí, y no sirven para nada más que firmar en nombre de esa persona
     * durante su vigencia.
     */
    emitirVales: (data: { personaId?: string; obraId: string; pin: string; cantidad?: number; deviceId?: string }) =>
        apiRequest<ValesResponse>('/firmas/vales', {
            method: 'POST',
            body: JSON.stringify(data),
        }),

    /**
     * Firmas sin conexión que esperan confirmación (vale vencido, o persona
     * desvinculada antes de sincronizar). Exige `firmas.crear`.
     */
    enRevision: () =>
        apiRequest<{ total: number; firmas: FirmaEnRevision[] }>('/signatures/revision'),

    /** Confirma o rechaza una firma sincronizada con un vale vencido. */
    revisar: (id: string, data: { decision: 'confirmada' | 'rechazada'; motivo?: string }) =>
        apiRequest<{ message: string; signatureId: string }>(`/signatures/${id}/revision`, {
            method: 'PUT',
            body: JSON.stringify(data),
        }),

    create: (data: CreateSignatureData) =>
        apiRequest<SignatureCreateResult>('/signatures', {
            method: 'POST',
            body: JSON.stringify(data),
        }),

    get: (id: string) =>
        apiRequest<DigitalSignature>(`/signatures/${id}`),

    getByWorker: (personaId: string) =>
        apiRequest<{ personaId: string; totalFirmas: number; firmas: DigitalSignature[] }>(
            `/signatures/worker/${personaId}`
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
