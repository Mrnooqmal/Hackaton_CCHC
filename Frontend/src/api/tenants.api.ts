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

/**
 * Representante legal de la empresa (DS 44 Art. 8 inc. 1): aprueba el Programa
 * de Trabajo Preventivo y firma la Política SST. Es uno solo por empresa, por eso
 * vive en el tenant y no en la obra.
 */
export interface RepresentanteLegal {
    personaId: string;
    nombre: string | null;
    rut?: string | null;
}

/** Registro mínimo de una organización sindical: solo lo necesario para saber
 *  a quién informar (Art. 57 inc. 2). No es un módulo sindical. */
export interface OrganizacionSindical {
    id: string;
    nombre: string;
    contacto?: string | null;
}

export interface TenantReglas {
    fasesObligatorias?: string[];
    limiteObras?: number;
    requiereFirmaPin?: boolean;
    representanteLegal?: RepresentanteLegal | null;
    /** Destinatarias del Reglamento Interno (Art. 57 inc. 2). */
    organizacionesSindicales?: OrganizacionSindical[];
    /** Declaración de que no hay ninguna. Sin esto el destinatario quedaría
     *  Pendiente para siempre en una empresa sin sindicatos, que es un
     *  incumplimiento imposible de cerrar. */
    sinOrganizacionesSindicales?: { declarado: boolean; fecha: string; personaId: string | null } | null;
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
    // Esencia estable del rol (admin|jefe_obra|prevencionista|supervisor|trabajador).
    // Los roles con `tipo` son los mínimos protegidos: solo el nombre es editable.
    tipo?: string | null;
    nombre: string;
    descripcion?: string;
    permisos?: string[];
}

/** Una decisión sobre la Ficha Básica de Salud: quién, cuándo y en qué sentido.
 *  El backend la toma de la sesión; el cliente nunca la escribe. */
export interface FichaSaludEvento {
    habilitada: boolean;
    personaId: string;
    nombre: string | null;
    en: string;
}

export interface Tenant {
    tenantId: string;
    slug: string;
    nombre: string;
    rutEmpresa: string;
    tamano: 'micro' | 'pequena' | 'mediana' | 'grande';
    cantidadTrabajadores: number;
    estado: 'setup' | 'activo' | 'suspendido';
    adminPersonaId: string | null;
    fichaSaludHabilitada?: boolean;
    fichaSaludHistorial?: FichaSaludEvento[];
    settings: TenantSettings;
    reglas: TenantReglas;
    preferencias: TenantPreferencias;
    roles: TenantRole[];
    createdAt: string;
    updatedAt: string;
}

export interface CatalogoItem { codigo: string; label: string; }

export interface CatalogosActividad {
    temas: CatalogoItem[];
    recursos: CatalogoItem[];
    riesgos: CatalogoItem[];
    medidas: CatalogoItem[];
}

export type PermisosTrabajoDef = Record<string, { label: string; checklist: { key: string; label: string }[] }>;

// ========================================
// TENANTS API
// ========================================
export const tenantsApi = {
    // El alta de empresas no se hace desde la aplicación: la ejecuta el operador
    // de la plataforma con Backend/scripts/crear-empresa.js. Acá no hay `setup`
    // ni comprobación previa de disponibilidad porque esos endpoints ya no existen.

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

    // Designa al representante legal (Mi Empresa › Identidad). El backend mergea
    // `reglas` con las existentes, así que enviar solo este campo no pisa el resto.
    updateRepresentanteLegal: (id: string, representanteLegal: RepresentanteLegal | null) =>
        apiRequest<{ message: string; tenant: Tenant; firmasRepresentante?: { documentos: number; asignados: number } | null }>(`/tenants/${id}`, {
            method: 'PUT',
            body: JSON.stringify({ reglas: { representanteLegal } }),
        }),

    // Guarda la definición de roles del tenant (Mi Empresa › Roles y permisos).
    /** Mergea solo estas dos reglas; `updateConfig` conserva el resto. */
    updateOrganizacionesSindicales: (
        id: string,
        organizacionesSindicales: OrganizacionSindical[],
        sinOrganizacionesSindicales: TenantReglas['sinOrganizacionesSindicales'],
    ) =>
        apiRequest<Tenant>(`/tenants/${id}`, {
            method: 'PUT',
            body: JSON.stringify({ reglas: { organizacionesSindicales, sinOrganizacionesSindicales } }),
        }),

    // Enciende o apaga la Ficha Básica de Salud (Mi Empresa › Ficha de salud).
    // Ruta propia: quién y cuándo los registra el backend desde la sesión.
    setFichaSalud: (id: string, habilitada: boolean) =>
        apiRequest<{ cambio: boolean; tenant: Tenant }>(`/tenants/${id}/ficha-salud`, {
            method: 'PUT',
            body: JSON.stringify({ habilitada }),
        }),

    updateRoles: (id: string, roles: TenantRole[]) =>
        apiRequest<{ message: string; tenant: Tenant }>(`/tenants/${id}`, {
            method: 'PUT',
            body: JSON.stringify({ roles }),
        }),

    // Guarda la identidad de la empresa (nombre, color principal, logo). El logo
    // viaja como data URL en logoBase64; el backend lo sube a S3 y persiste logoKey.
    // logoBase64 === '' elimina el logo actual; undefined lo deja sin cambios.
    updateBranding: (id: string, data: { nombre?: string; colorPrimario?: string; logoBase64?: string }) => {
        const preferencias: Record<string, unknown> = {};
        if (data.colorPrimario !== undefined) preferencias.colorPrimario = data.colorPrimario;
        if (data.logoBase64) preferencias.logoBase64 = data.logoBase64;
        else if (data.logoBase64 === '') preferencias.logoKey = null;
        return apiRequest<{ message: string; tenant: Tenant }>(`/tenants/${id}`, {
            method: 'PUT',
            body: JSON.stringify({
                ...(data.nombre !== undefined ? { nombre: data.nombre } : {}),
                preferencias,
            }),
        });
    },

    // Catálogo de cargos del tenant. `sembrado: true` ⇒ aún es la semilla EBCO
    // (no persistida); el constructor la guarda con saveCargos.
    getCargos: (id: string) =>
        apiRequest<{ cargos: TenantCargo[]; sembrado: boolean }>(`/tenants/${id}/cargos`),

    saveCargos: (id: string, cargos: TenantCargo[]) =>
        apiRequest<{ message: string; cargos: TenantCargo[]; documentosSincronizados?: number }>(`/tenants/${id}/cargos`, {
            method: 'PUT',
            body: JSON.stringify({ cargos }),
        }),

    // Catálogos de planificación diaria (temas/recursos/riesgos/medidas).
    // Devuelve la semilla de fábrica si el tenant no los ha personalizado.
    getCatalogosActividad: (id: string) =>
        apiRequest<{ catalogos: CatalogosActividad; permisosTrabajoDef: PermisosTrabajoDef; sembrado: boolean }>(`/tenants/${id}/catalogos-actividad`),

    saveCatalogosActividad: (id: string, catalogos: CatalogosActividad) =>
        apiRequest<{ message: string; catalogos: CatalogosActividad }>(`/tenants/${id}/catalogos-actividad`, {
            method: 'PUT',
            body: JSON.stringify({ catalogos }),
        }),
};
