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
import { marcarSenal } from '../utils/conexion';


const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';
export const apiBaseUrl = API_BASE_URL;

interface ApiResponse<T> {
    success: boolean;
    data?: T;
    error?: string;
    /**
     * El servidor no rechazó la petición por su contenido: estaba saturado (429,
     * límite de tasa) o falló algo pasajero (5xx). Reintentar puede funcionar.
     * La cola de firmas sin conexión NO descarta lo que vuelve así.
     */
    reintentable?: boolean;
    /** No hubo respuesta: no hay señal. `error` trae un mensaje simple, sin nada técnico. */
    sinRed?: boolean;
}

/** Lo que se le dice a una persona cuando no hay señal. */
export const SIN_SENAL = 'No hay señal. Esto se carga cuando vuelva la conexión.';

/** ¿Este error es de red (un `fetch` que no llegó a ninguna parte)? */
export const esErrorDeRed = (e: unknown): boolean => e instanceof TypeError
    || /failed to fetch|networkerror|load failed|network request failed/i.test(e instanceof Error ? e.message : String(e ?? ''));

/** El mensaje de un error para mostrarlo: nunca "Failed to fetch". */
export const mensajeDeError = (e: unknown, porOmision: string): string => {
    if (esErrorDeRed(e)) return SIN_SENAL;
    return e instanceof Error && e.message ? e.message : porOmision;
};

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
        // Respondió el servidor (con lo que sea): hay señal (utils/conexion).
        marcarSenal(true);

        // 401 = la sesión no existe o venció. Se excluyen las rutas de `/auth`,
        // donde un 401 significa "credenciales incorrectas" y no "se te cayó la
        // sesión": avisar ahí mandaría al usuario a la pantalla de sesión expirada
        // por escribir mal su contraseña.
        if (response.status === 401 && !endpoint.startsWith('/auth')) {
            avisarSesionCaida();
            // Reintentable: una firma sin conexión que se estaba enviando sigue en
            // la cola, y la manda la próxima sesión de la empresa.
            return { success: false, reintentable: true, error: 'Tu sesión expiró. Vuelve a iniciar sesión.' };
        }

        // Límite de tasa de la API (429) o una falla pasajera del servidor (5xx).
        // API Gateway responde el 429 con `{ message }`, sin `success`: sin esto,
        // la pantalla mostraba un error vacío.
        // Un 423 (PIN bloqueado por un rato) también: la firma espera en la cola.
        if (response.status === 423) {
            const cuerpo = await response.json().catch(() => null);
            return { success: false, reintentable: true, error: cuerpo?.error || 'El PIN está bloqueado por un rato. Inténtalo de nuevo más tarde.' };
        }
        if (response.status === 429 || response.status >= 500) {
            const cuerpo = await response.json().catch(() => null);
            return {
                success: false,
                reintentable: true,
                error: response.status === 429
                    ? 'Hay muchas solicitudes en este momento. Espera unos segundos y vuelve a intentarlo.'
                    : (cuerpo?.error || 'El servidor no pudo responder. Vuelve a intentarlo en un momento.'),
            };
        }

        const data = await response.json();
        return data;
    } catch (error) {
        // `fetch` lanza solo cuando no hubo respuesta. Una respuesta que no es JSON
        // tampoco se muestra tal cual.
        if (esErrorDeRed(error)) marcarSenal(false);
        return esErrorDeRed(error)
            ? { success: false, sinRed: true, error: SIN_SENAL }
            : { success: false, reintentable: true, error: 'El servidor no pudo responder. Vuelve a intentarlo en un momento.' };
    }
}

