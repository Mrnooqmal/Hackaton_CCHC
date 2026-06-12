import { apiRequest } from './client';
import type { PersonaResponse } from './types';

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

    resetPassword: (tenantId: string, id: string) =>
        apiRequest<{ message: string; passwordTemporal: string; personaId: string }>(`/personas/${id}/reset-password?tenantId=${tenantId}`, {
            method: 'POST',
        }),

    // Historial dinamico de entregas/reposiciones de EPP (Art. 13)
    getHistorialEpp: (tenantId: string, personaId: string) =>
        apiRequest<{ entregas: any[]; total: number }>(`/personas/${personaId}/historial-epp?tenantId=${tenantId}`),

    // Crear entrega/reposicion de EPP (solo instancia superior)
    crearEntregaEpp: (tenantId: string, personaId: string, data: {
        creadorId: string;
        obraId?: string | null;
        itemsEntregados: Array<{ descripcion: string; cantidad: number; talla?: string | null; fechaVencimiento?: string | null }>;
        esReposicion?: boolean;
        motivoReposicion?: string | null;
        capacitacion?: { completada: boolean; duracionRealMinutos?: number | null; relatorId?: string | null };
    }) =>
        apiRequest<{ message: string; entrega: any }>(`/personas/${personaId}/epp?tenantId=${tenantId}`, {
            method: 'POST',
            body: JSON.stringify(data),
        }),

    // Validar una entrega de EPP (instancia superior)
    validarEntregaEpp: (tenantId: string, personaId: string, data: { entregaDocumentId: string; validadorId: string; observacion?: string | null }) =>
        apiRequest<{ message: string; entrega: any }>(`/personas/${personaId}/epp/validar?tenantId=${tenantId}`, {
            method: 'POST',
            body: JSON.stringify(data),
        }),

    bulkUpload: (tenantId: string, data: { fileBase64: string; fileName: string; sendWelcomeEmail?: boolean; obraId?: string }) =>
        apiRequest<{ mensaje: string; resultados: any }>(`/personas/carga-masiva?tenantId=${tenantId}`, {
            method: 'POST',
            body: JSON.stringify(data),
        }),
};
