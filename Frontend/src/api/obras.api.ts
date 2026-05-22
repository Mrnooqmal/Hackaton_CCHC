import { apiRequest } from './client';

// ========================================
// OBRAS API
// ========================================
export const obrasApi = {
    list: (tenantId?: string) => {
        const id = tenantId || localStorage.getItem('tenant_id') || '';
        return apiRequest<any[]>(`/obras?tenantId=${id}`);
    },
    create: (data: any) =>
        apiRequest<any>('/obras', {
            method: 'POST',
            body: JSON.stringify(data),
        }),
    update: (id: string, data: any) =>
        apiRequest<any>(`/obras/${id}`, {
            method: 'PUT',
            body: JSON.stringify(data),
        }),
    getById: (id: string) =>
        apiRequest<any>(`/obras/${id}`),
    avanzarFaseDeming: (id: string) =>
        apiRequest<any>(`/obras/${id}/avanzar-fase-deming`, {
            method: 'POST',
        }),
};
