import { apiRequest } from './client';

// Ausencia / permiso del día de una persona (control de asistencia §6).
export interface Ausencia {
    tenantId: string;
    sk: string;
    obraId: string;
    fecha: string;
    personaId: string;
    personaNombre: string;
    cargo: string;
    motivo: string;
    motivoLabel: string;
    observacion?: string;
    registradoPor?: string | null;
    registradoPorNombre?: string | null;
    createdAt: string;
    updatedAt: string;
}

export interface AusenciaListResponse {
    ausencias: Ausencia[];
    motivos: Record<string, string>;
}

export interface CreateAusenciaData {
    tenantId: string;
    obraId: string;
    fecha: string;
    personaId: string;
    motivo: string;
    observacion?: string;
    solicitanteId?: string;
}

export interface AusenciaKey {
    tenantId: string;
    obraId: string;
    fecha: string;
    personaId: string;
}

export const ausenciasApi = {
    list: (params: { tenantId: string; obraId: string; fecha?: string; fechaDesde?: string; fechaHasta?: string }) => {
        const query = new URLSearchParams(params as Record<string, string>).toString();
        return apiRequest<AusenciaListResponse>(`/ausencias?${query}`);
    },

    create: (data: CreateAusenciaData) =>
        apiRequest<Ausencia>('/ausencias', { method: 'POST', body: JSON.stringify(data) }),

    remove: (params: AusenciaKey) => {
        const query = new URLSearchParams(params as unknown as Record<string, string>).toString();
        return apiRequest<{ removed: boolean }>(`/ausencias?${query}`, { method: 'DELETE' });
    },
};
