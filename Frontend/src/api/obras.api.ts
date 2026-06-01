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
    // Genera y firma el Registro AT/EP (Arts. 71-72) como snapshot inmutable.
    // El backend consolida incidentes + actividades + indicadores, firma via
    // FirmaService y persiste el documento REGISTRO_AT_EP con hash verificable.
    generarRegistroATEP: (
        id: string,
        data: {
            periodo?: { desde?: string; hasta?: string };
            firmante: { personaId: string; pin?: string };
            metodo?: 'PIN' | 'PRESENCIAL';
            firmaManuscrita?: string;
            masaLaboral?: number;
        }
    ) =>
        apiRequest<{ documentId: string; token: string; hash: string; snapshot: any; s3Key: string | null }>(
            `/obras/${id}/registros/at-ep`,
            {
                method: 'POST',
                body: JSON.stringify(data),
            }
        ),
    // Read-model consolidado de la Fase CHECK (indicadores, investigaciones,
    // vigilancia y actividades del periodo). No firma nada.
    getCheckConsolidado: (id: string, periodo?: { desde?: string; hasta?: string }) => {
        const q = new URLSearchParams();
        if (periodo?.desde) q.set('desde', periodo.desde);
        if (periodo?.hasta) q.set('hasta', periodo.hasta);
        const qs = q.toString();
        return apiRequest<any>(`/obras/${id}/check/consolidado${qs ? `?${qs}` : ''}`);
    },
};
