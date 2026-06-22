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
    branding?: { logoUrl?: string | null; colorPrimario?: string | null } | null;
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

export interface PersonaDesvinculacion {
    fechaDesvinculacion: string;
    desvinculadoPor: string | null;
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
    // Resueltos por el backend desde la def. de roles del tenant (GET /personas).
    rolNombre?: string;
    rolTipo?: 'admin' | 'jefe_obra' | 'prevencionista' | 'supervisor' | 'trabajador' | null;
    cargo: string;
    estado: 'pendiente' | 'activo' | 'inactivo' | 'suspendido' | 'desvinculado';
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
    creadoPor?: string | null;
    desvinculacion?: PersonaDesvinculacion | null;
    createdAt: string;
    updatedAt: string;
}
