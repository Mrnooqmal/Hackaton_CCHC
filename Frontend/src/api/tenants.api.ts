import { apiRequest } from './client';

// ========================================
// TENANT TYPES
// ========================================
export interface TenantSettings {
    maxWorkers?: number;
    dataRetentionDays?: number;
    twoFactorEnabled?: boolean;
    modulosActivos?: string[];
}

export interface TenantReglas {
    fasesObligatorias?: string[];
    limiteObras?: number;
    requiereFirmaPin?: boolean;
}

export interface TenantPreferencias {
    timezone?: string;
    idioma?: string;
    formatoFecha?: string;
    colorPrimario?: string;
    colorSecundario?: string;
    logoUrl?: string | null;
}

export interface TenantRole {
    id: string;
    nombre: string;
    descripcion?: string;
    permisos?: string[];
}

export interface Tenant {
    tenantId: string;
    slug: string;
    nombre: string;
    rutEmpresa: string;
    email: string;
    telefono: string;
    plan: 'starter' | 'professional' | 'enterprise';
    tamano: 'micro' | 'pequena' | 'mediana' | 'grande';
    cantidadTrabajadores: number;
    estado: 'setup' | 'activo' | 'suspendido';
    adminPersonaId: string | null;
    settings: TenantSettings;
    reglas: TenantReglas;
    preferencias: TenantPreferencias;
    roles: TenantRole[];
    createdAt: string;
    updatedAt: string;
}

export interface TenantSetupData {
    nombre: string;
    rutEmpresa: string;
    cantidadTrabajadores: number;
    email?: string;
    telefono?: string;
    plan?: 'starter' | 'professional' | 'enterprise';
    settings?: Partial<TenantSettings>;
    reglas?: Partial<TenantReglas>;
    preferencias?: Partial<TenantPreferencias>;
    roles?: TenantRole[];
    admin?: {
        rut: string;
        nombre: string;
        apellidoPaterno?: string;
        apellidoMaterno?: string;
        fechaNacimiento?: string;
        email: string;
    };
}

export interface TenantSetupResponse {
    message: string;
    tenant: Tenant;
    admin: {
        personaId: string;
        rut: string;
        nombre: string;
        apellido: string;
        email: string;
        rol: string;
        estado: string;
    } | null;
}

// ========================================
// TENANTS API
// ========================================
export const tenantsApi = {
    validate: (params: { nombre?: string; rutEmpresa?: string }) => {
        const qs = new URLSearchParams();
        if (params.nombre) qs.set('nombre', params.nombre);
        if (params.rutEmpresa) qs.set('rutEmpresa', params.rutEmpresa);
        return apiRequest<{ conflictos: Record<string, string>; valido: boolean }>(`/tenants/validate?${qs}`);
    },

    setup: (data: TenantSetupData) =>
        apiRequest<TenantSetupResponse>('/tenants/setup', {
            method: 'POST',
            body: JSON.stringify(data),
        }),

    list: (estado?: string) => {
        const query = estado ? `?estado=${estado}` : '';
        return apiRequest<{ total: number; tenants: Tenant[] }>(`/tenants${query}`);
    },

    get: (id: string) =>
        apiRequest<Tenant>(`/tenants/${id}`),

    update: (id: string, data: Partial<Tenant>) =>
        apiRequest<{ message: string; tenant: Tenant }>(`/tenants/${id}`, {
            method: 'PUT',
            body: JSON.stringify(data),
        }),
};
