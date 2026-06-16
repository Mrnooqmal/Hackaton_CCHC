// Shared Types

// Roles alineados con el modelo backend (Persona.js ROLES)
export type PersonaRol = 'admin' | 'jefe_obra' | 'supervisor' | 'prevencionista' | 'trabajador';

export interface User {
    personaId: string;
    tenantId: string;
    rut: string;
    nombre: string;
    apellidoPaterno: string;
    apellidoMaterno: string;
    apellido: string;
    rol: PersonaRol;
    permisos?: string[];
    email?: string;
    telefono?: string;
    fotoPerfil?: string;
    notificacionesSms?: boolean;
    // 'suspendido' se mantiene mientras la UI lo ofrezca; el backend trabaja con
    // 'pendiente' | 'activo' | 'inactivo'. Confirmar efecto normativo (duda experto #9).
    estado: 'pendiente' | 'activo' | 'inactivo' | 'suspendido';
    habilitado: boolean;
    passwordTemporal?: boolean;
    ultimoAcceso?: string;
    creadoPor?: string;
    // alias legacy - retirar junto con personaAlias.js (backend) cuando la UI use solo personaId/tenantId
    /** @deprecated usar personaId */ userId?: string;
    /** @deprecated usar personaId */ workerId?: string;
    /** @deprecated usar tenantId */ empresaId?: string;
}

export interface Ds44OnboardingOverrides {
    [obraId: string]: {
        items?: Record<string, { doneAt: string; doneBy?: string; source?: string }>;
        updatedAt?: string;
    };
}

export interface PersonaResponse {
    personaId: string;
    tenantId: string;
    rut: string;
    nombre: string;
    apellido: string;
    email: string;
    telefono?: string;
    fotoPerfil?: string;
    notificacionesSms?: boolean;
    fechaNacimiento?: string;
    rol: string;
    cargo: string;
    estado: string;
    tieneAccesoWeb: boolean;
    habilitado: boolean;
    pinConfigurado: boolean;
    enrolado: boolean;
    permisos: string[];
    obraIds: string[];
    contactoEmergencia?: { nombre?: string; telefono?: string; relacion?: string };
    nivelEscolar?: string;
    cursos?: Array<{ nombre: string; institucion?: string; fecha?: string; vencimiento?: string }>;
    onboardingDS44?: Ds44OnboardingOverrides;
    createdAt: string;
    updatedAt: string;
}
