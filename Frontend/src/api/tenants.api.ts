import { apiRequest } from './client';
import type { Ds44KitItem } from '../utils/ds44';

// Cargo editable del catálogo del tenant (constructor de cargos). Lleva su kit
// de onboarding embebido. Se persiste en Tenant.reglas.cargos.
export interface TenantCargo {
    codigo: string;
    label: string;
    legacy?: boolean;
    seed?: boolean;          // proviene de la semilla EBCO (no editado aún)
    kit: Ds44KitItem[];
}

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
    // La empresa parte con tamaño 1 (solo el administrador) y crece automáticamente
    // al registrar trabajadores. El backend lo fuerza a 1 en el setup.
    cantidadTrabajadores?: number;
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

    // Catálogo de cargos del tenant. `sembrado: true` ⇒ aún es la semilla EBCO
    // (no persistida); el constructor la guarda con saveCargos.
    getCargos: (id: string) =>
        apiRequest<{ cargos: TenantCargo[]; sembrado: boolean }>(`/tenants/${id}/cargos`),

    saveCargos: (id: string, cargos: TenantCargo[]) =>
        apiRequest<{ message: string; cargos: TenantCargo[] }>(`/tenants/${id}/cargos`, {
            method: 'PUT',
            body: JSON.stringify({ cargos }),
        }),
};
