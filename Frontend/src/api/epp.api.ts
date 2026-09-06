import { apiRequest } from './client';

/** Tipo del documento de certificación: el DS44 acepta cualquiera de los dos. */
export type CertificadoTipo = 'certificado_calidad' | 'registro_isp';

export const CERTIFICADO_TIPO_LABEL: Record<CertificadoTipo, string> = {
    certificado_calidad: 'Certificado de calidad',
    registro_isp: 'Registro en el ISP',
};

export interface EppAdjunto {
    fileKey: string;
    nombre: string;
    tipo?: string | null;
    subidoEn?: string;
}

export interface EppElemento {
    tenantId: string;
    eppId: string;
    nombre: string;
    descripcion: string | null;
    /** Certificado de calidad o registro ISP (Art. 13 DS44). */
    certificado: EppAdjunto | null;
    certificadoTipo: CertificadoTipo | null;
    /** Uso, mantenimiento, reposición o recambio del elemento. */
    instructivo: EppAdjunto | null;
    activo: boolean;
    /** Derivados por el backend: no se envían al guardar. */
    completo: boolean;
    faltantes: ('certificado' | 'instructivo')[];
    createdAt: string;
    updatedAt: string;
}

export interface EppInput {
    nombre: string;
    descripcion?: string | null;
    certificado?: EppAdjunto | null;
    certificadoTipo?: CertificadoTipo | null;
    instructivo?: EppAdjunto | null;
    activo?: boolean;
}

/** Texto listo para mostrar de lo que le falta a un elemento. */
export const faltantesLabel = (faltantes: EppElemento['faltantes']): string => {
    const nombres = faltantes.map((f) => (f === 'certificado' ? 'certificado' : 'instructivo de uso'));
    if (nombres.length === 0) return '';
    if (nombres.length === 1) return `Falta el ${nombres[0]}`;
    return `Faltan el ${nombres[0]} y el ${nombres[1]}`;
};

export const eppApi = {
    list: (tenantId: string) =>
        apiRequest<{ epp: EppElemento[] }>(`/tenants/${tenantId}/epp`),

    create: (tenantId: string, data: EppInput) =>
        apiRequest<{ message: string; epp: EppElemento }>(`/tenants/${tenantId}/epp`, {
            method: 'POST',
            body: JSON.stringify(data),
        }),

    update: (tenantId: string, eppId: string, data: EppInput) =>
        apiRequest<{ message: string; epp: EppElemento }>(`/tenants/${tenantId}/epp/${eppId}`, {
            method: 'PUT',
            body: JSON.stringify(data),
        }),

    remove: (tenantId: string, eppId: string) =>
        apiRequest<{ message: string; eppId: string }>(`/tenants/${tenantId}/epp/${eppId}`, {
            method: 'DELETE',
        }),
};
