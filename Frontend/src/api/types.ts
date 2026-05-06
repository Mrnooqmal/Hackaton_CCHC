// Shared Types
export interface User {
    userId: string;
    personaId?: string;
    tenantId?: string;
    rut: string;
    nombre: string;
    apellido: string;
    rol: 'admin' | 'prevencionista' | 'trabajador';
    email?: string;
    estado: 'pendiente' | 'activo' | 'suspendido';
    habilitado: boolean;
    passwordTemporal?: boolean;
    ultimoAcceso?: string;
    creadoPor?: string;
    workerId?: string;
    empresaId?: string;
}

export interface PersonaResponse {
    personaId: string;
    tenantId: string;
    rut: string;
    nombre: string;
    apellido: string;
    email: string;
    rol: string;
    cargo: string;
    estado: string;
    tieneAccesoWeb: boolean;
    habilitado: boolean;
    pinConfigurado: boolean;
    enrolado: boolean;
    permisos: string[];
    obraIds: string[];
    createdAt: string;
    updatedAt: string;
}
