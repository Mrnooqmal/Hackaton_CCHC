import { apiRequest } from './client';
import type { User } from './client';

export interface LoginSuccess {
    token: string;
    sessionId: string;
    expiresAt: string;
    user: User;
    requiereCambioPassword: boolean;
    requiereEnrolamiento: boolean;
}

// Cuando el RUT pertenece a más de una empresa: no crea sesión todavía, hay
// que elegir empresa vía authApi.selectTenant.
export interface LoginRequiereSeleccion {
    requiereSeleccionTenant: true;
    selectionToken: string;
    opciones: { tenantId: string; tenantNombre: string; rol: string }[];
}

export type LoginResponse = LoginSuccess | LoginRequiereSeleccion;

export interface ChangePasswordData {
    personaId: string;
    passwordActual: string;
    passwordNuevo: string;
    confirmarPassword: string;
}

export interface SessionInfo {
    sessionId: string;
    expiresAt: string;
    lastActivity: string;
}

export interface ResetPasswordData {
    personaId: string;
    token: string;
    passwordNuevo: string;
    confirmarPassword: string;
}

export const authApi = {
    login: (rut: string, password: string) =>
        apiRequest<LoginResponse>('/auth/login', {
            method: 'POST',
            body: JSON.stringify({ rut, password }),
        }),

    // Segundo paso del login cuando el RUT pertenece a varias empresas.
    selectTenant: (selectionToken: string, tenantId: string) =>
        apiRequest<LoginSuccess>('/auth/select-tenant', {
            method: 'POST',
            body: JSON.stringify({ selectionToken, tenantId }),
        }),

    changePassword: (data: ChangePasswordData) =>
        apiRequest<{ message: string }>('/auth/change-password', {
            method: 'POST',
            body: JSON.stringify(data),
        }),

    // Solicitar recuperación de contraseña. Respuesta siempre genérica (anti-enumeración).
    forgotPassword: (rut: string) =>
        apiRequest<{ message: string }>('/auth/forgot-password', {
            method: 'POST',
            body: JSON.stringify({ rut }),
        }),

    // Restablecer contraseña con el token recibido por correo.
    resetPassword: (data: ResetPasswordData) =>
        apiRequest<{ message: string }>('/auth/reset-password', {
            method: 'POST',
            body: JSON.stringify(data),
        }),

    logout: (sessionId: string) =>
        apiRequest<{ message: string }>('/auth/logout', {
            method: 'POST',
            body: JSON.stringify({ sessionId }),
        }),

    me: (token: string) =>
        apiRequest<{ user: User; session: SessionInfo }>('/auth/me', {
            method: 'GET',
            headers: { Authorization: `Bearer ${token}` },
        }),

    validateToken: (token: string) =>
        apiRequest<{ valid: boolean; userId?: string; expiresAt?: string }>('/auth/validate-token', {
            method: 'POST',
            body: JSON.stringify({ token }),
        }),
};
