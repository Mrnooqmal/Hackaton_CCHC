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
