import { apiRequest } from './client';
import { personasApi } from './personas.api';
import type { Ds44OnboardingOverrides } from './types';
import type { SignData, Signature, SignatureResult } from './signatures.api';

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
    onboardingDS44?: Ds44OnboardingOverrides;
    firmas?: Signature[];
    createdAt: string;
    updatedAt: string;
}

export interface CreateWorkerData {
    rut: string;
    nombre: string;
    apellido?: string;
    email?: string;
    telefono?: string;
    cargo: string;
    empresaId?: string;
    obraIds?: string[];
}

// Workers API (Legacy mapping to Personas)
export const workersApi = {
    list: async (params?: { empresaId?: string; obraId?: string }) => {
        const tenantId = params?.empresaId || localStorage.getItem('tenant_id');
        let query = `/personas?tenantId=${tenantId}`;
        if (params?.obraId) {
            query += `&obraId=${params.obraId}`;
        }
        const res = await apiRequest<{ total: number; personas: any[] }>(query);
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