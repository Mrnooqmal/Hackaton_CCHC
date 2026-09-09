import { apiRequest, apiBaseUrl } from './client';

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
    /** Expediente consolidado (Art. 72 inc. 1) para poner a disposición del
     *  fiscalizador / Organismo Administrador. Descarga el HTML autenticado y lo
     *  abre en una pestaña nueva (desde ahí se imprime o guarda como PDF). */
    abrirExpediente: async (
        id: string,
        tenantId: string,
        periodo?: { desde?: string; hasta?: string },
    ): Promise<{ ok: boolean; error?: string }> => {
        const q = new URLSearchParams({ tenantId });
        if (periodo?.desde) q.set('desde', periodo.desde);
        if (periodo?.hasta) q.set('hasta', periodo.hasta);
        const token = localStorage.getItem('auth_token');
        try {
            const res = await fetch(`${apiBaseUrl}/obras/${id}/expediente?${q}`, {
                headers: token ? { Authorization: `Bearer ${token}` } : undefined,
            });
            if (!res.ok) return { ok: false, error: 'No se pudo generar el expediente.' };
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const win = window.open(url, '_blank');
            if (!win) return { ok: false, error: 'El navegador bloqueó la ventana. Habilita las ventanas emergentes.' };
            // Se libera después para no romper la carga de la pestaña recién abierta.
            setTimeout(() => URL.revokeObjectURL(url), 60000);
            return { ok: true };
        } catch {
            return { ok: false, error: 'Error de conexión al generar el expediente.' };
        }
    },
    // Read-model consolidado de la Fase CHECK (indicadores, investigaciones,
    // vigilancia y actividades del periodo). No firma nada.
    getCheckConsolidado: (id: string, periodo?: { desde?: string; hasta?: string }) => {
        const q = new URLSearchParams();
        if (periodo?.desde) q.set('desde', periodo.desde);
        if (periodo?.hasta) q.set('hasta', periodo.hasta);
        const qs = q.toString();
        return apiRequest<any>(`/obras/${id}/check/consolidado${qs ? `?${qs}` : ''}`);
    },
    // Read-model de medidas correctivas (Art. 71) de la obra, aplanadas desde las
    // investigaciones de incidentes. Insumo de la Fase ACT.
    getMedidasCorrectivas: (id: string, estado?: string) => {
        const qs = estado ? `?estado=${encodeURIComponent(estado)}` : '';
        return apiRequest<{ medidas: any[]; resumen: { total: number; pendientes: number; enProceso: number; completadas: number; verificadas: number; vencidas: number } }>(
            `/obras/${id}/medidas-correctivas${qs}`
        );
    },
    // Genera y firma el Informe de Investigación (Art. 71) de un incidente y cierra
    // la investigación. Devuelve el documento firmado con hash verificable.
    cerrarInvestigacion: (
        obraId: string,
        incidentId: string,
        data: { firmante: { personaId: string; pin?: string }; metodo?: 'PIN' | 'PRESENCIAL'; firmaManuscrita?: string }
    ) =>
        apiRequest<{ documentId: string; token: string; hash: string; s3Key: string | null }>(
            `/obras/${obraId}/investigaciones/${incidentId}/cerrar`,
            { method: 'POST', body: JSON.stringify(data) }
        ),
};
