export type * from './types';
export * from './auth.api';
export * from './personas.api';
export * from './users.api';
export * from './workers.api';
export * from './signatures.api';
export * from './documents.api';
export * from './signatureRequests.api';
export * from './activities.api';
export * from './surveys.api';
export * from './incidents.api';
export * from './uploads.api';
export * from './ai.api';
export * from './inbox.api';
export * from './tenants.api';
export * from './obras.api';
export * from './suggestions.api';
export * from './ausencias.api';
export * from './estructura.api';
export * from './onboarding.api';
//export type { User, PersonaResponse } from './types';


const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';
export const apiBaseUrl = API_BASE_URL;

interface ApiResponse<T> {
    success: boolean;
    data?: T;
    error?: string;
}

/**
 * Aviso de sesión caída.
 *
 * El cliente no puede navegar por su cuenta (no conoce el router) ni tocar el
 * contexto de autenticación (lo cargaría en ciclo), así que anuncia el hecho y
 * `AuthContext` decide qué hacer. Sin esto, una sesión vencida se veía como un
 * error genérico en medio de la pantalla: el 401 llegaba como un cuerpo que la
 * aplicación no sabía leer.
 */
export const EVENTO_SESION_CAIDA = 'sesion-caida';

const avisarSesionCaida = () => {
    try {
        window.dispatchEvent(new CustomEvent(EVENTO_SESION_CAIDA));
    } catch {
        /* entorno sin window (pruebas) */
    }
};

export async function apiRequest<T>(
    endpoint: string,
    options: RequestInit = {}
): Promise<ApiResponse<T>> {
    try {
        const token = localStorage.getItem('auth_token');
        const tenantId = localStorage.getItem('tenant_id');
        
        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            ...(options.headers as Record<string, string> || {}),
        };

        if (token && !headers['Authorization']) {
            headers['Authorization'] = `Bearer ${token}`;
        }

        let finalEndpoint = endpoint;
        // Si hay tenantId y la ruta no es de auth (login/refresh) ni de tenants (onboarding)
        if (tenantId && !endpoint.startsWith('/auth') && !endpoint.startsWith('/tenants') && !endpoint.includes('tenantId=')) {
            finalEndpoint = endpoint.includes('?') 
                ? `${endpoint}&tenantId=${tenantId}` 
                : `${endpoint}?tenantId=${tenantId}`;
        }

        const response = await fetch(`${API_BASE_URL}${finalEndpoint}`, {
            ...options,
            headers,
        });

        // 401 = la sesión no existe o venció. Se excluyen las rutas de `/auth`,
        // donde un 401 significa "credenciales incorrectas" y no "se te cayó la
        // sesión": avisar ahí mandaría al usuario a la pantalla de sesión expirada
        // por escribir mal su contraseña.
        if (response.status === 401 && !endpoint.startsWith('/auth')) {
            avisarSesionCaida();
            return { success: false, error: 'Tu sesión expiró. Vuelve a iniciar sesión.' };
        }

        const data = await response.json();
        return data;
    } catch (error) {
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Error desconocido',
        };
    }
}

