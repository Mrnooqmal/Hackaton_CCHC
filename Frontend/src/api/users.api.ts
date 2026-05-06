import { apiRequest } from './client';
import { personasApi } from './personas.api';
import type { User } from './client';

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
    obraId?: string;
    rol?: string;
    estado?: string;
}

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