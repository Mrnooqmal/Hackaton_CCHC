import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { purgarAlmacenOfflineAntiguo } from '../services/purgaOffline';
import { borrarPreguntasEnCache } from '../utils/encuestas';
import { borrarTodosLosVales } from '../utils/colaFirmas';
import { borrarCopias } from '../utils/copiaLocal';
import { guardarSesionLocal, leerSesionLocal, borrarSesionLocal } from '../utils/sesionLocal';
import { guardarLlaveSobre } from '../utils/sobreFirma';
import { EVENTO_SESION_CAIDA, authApi, type User, type SessionInfo, type LoginSuccess } from '../api/client';

export interface TenantOpcion { tenantId: string; tenantNombre: string; rol: string }

type LoginResult = {
    success: boolean;
    error?: string;
    requiresChangePassword?: boolean;
    requiresEnrollment?: boolean;
    // Presente cuando el RUT pertenece a varias empresas: hay que llamar a
    // completarLoginConTenant con el tenantId elegido antes de tener sesión.
    requiresTenantSelection?: boolean;
    selectionToken?: string;
    opciones?: TenantOpcion[];
};

interface AuthContextType {
    user: User | null;
    session: SessionInfo | null;
    loading: boolean;
    error: string | null;
    sessionExpired: boolean;
    clearSessionExpired: () => void;
    login: (rut: string, password: string) => Promise<LoginResult>;
    completarLoginConTenant: (selectionToken: string, tenantId: string) => Promise<LoginResult>;
    logout: () => Promise<void>;
    updateUser: (userData: Partial<User>) => void;
    reemplazarSesion: (data: Pick<LoginSuccess, 'token' | 'sessionId' | 'expiresAt' | 'user'>) => void;
    hasPermission: (permission: string) => boolean;
}

/**
 * Borra del dispositivo la sesión, y según el caso, los vales.
 *
 * - **Siempre** se borra la sesión (token, empresa, persona).
 * - **Nunca** se borra la cola de firmas tomadas sin red (utils/colaFirmas): son
 *   actos que ya ocurrieron en terreno. Antes se borraba al caer la sesión, y un
 *   turno largo sin señal —la sesión dura 6 horas— perdía todas las firmas. La
 *   cola es por empresa: la sincroniza la próxima sesión de esa empresa.
 * - Los **vales** y las preguntas de encuestas guardadas para responder sin red
 *   se borran solo con un "Cerrar sesión" explícito (`cierreExplicito`). Al
 *   vencer la sesión o ante un 401 se conservan: el supervisor que vuelve a
 *   entrar a mitad de turno no pierde los vales de su cuadrilla. Al cerrar
 *   sesión a propósito, el equipo puede pasar a otras manos, y los vales son
 *   credenciales de un solo uso a nombre de quienes los desbloquearon.
 *
 * La base del modo sin conexión anterior, que guardaba PIN en claro, se purga
 * siempre.
 */
const limpiarDatosLocales = ({ cierreExplicito }: { cierreExplicito: boolean }) => {
    localStorage.removeItem('auth_token');
    localStorage.removeItem('session_id');
    localStorage.removeItem('tenant_id');
    localStorage.removeItem('persona_id');
    borrarSesionLocal();
    // Progreso de recorridos guiados sin enviar: se va siempre, también al vencer
    // la sesión. Es un dato personal (D-33) y perderlo solo hace que una ayuda
    // vuelva a aparecer.
    localStorage.removeItem('recorridosPendientes');
    if (cierreExplicito) {
        borrarTodosLosVales();
        borrarPreguntasEnCache();
        // Las copias para firmar sin red (actividades del día, documentos
        // pendientes): como los vales, se quedan al vencer la sesión y se van
        // al cerrarla a propósito.
        borrarCopias();
    }
    purgarAlmacenOfflineAntiguo();
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [user, setUser] = useState<User | null>(null);
    const [session, setSession] = useState<SessionInfo | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [sessionExpired, setSessionExpired] = useState(false);
    const [sinConfirmar, setSinConfirmar] = useState(false);
    const expiryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const clearSessionExpired = useCallback(() => setSessionExpired(false), []);

    // Una sesión vencida la puede descubrir el reloj (scheduleAutoLogout) o el
    // primer 401 que devuelva la API, que es lo que pasa cuando la sesión se cerró
    // desde otro dispositivo o el token dejó de existir antes de tiempo. Los dos
    // caminos terminan igual: se limpia el dispositivo y se muestra el aviso.
    useEffect(() => {
        const alCaerLaSesion = () => {
            limpiarDatosLocales({ cierreExplicito: false });
            setUser(null);
            setSession(null);
            setSessionExpired(true);
        };
        window.addEventListener(EVENTO_SESION_CAIDA, alCaerLaSesion);
        return () => window.removeEventListener(EVENTO_SESION_CAIDA, alCaerLaSesion);
    }, []);

    // Al cumplirse la hora se pregunta al servidor: sin red nunca se cierra la
    // sesión. Antes el reloj la cerraba solo, en plena obra y en modo avión, y la
    // persona no podía volver a entrar ni firmar hasta tener señal.
    const scheduleAutoLogout = useCallback((expiresAt: string) => {
        if (expiryTimerRef.current) clearTimeout(expiryTimerRef.current);
        const ms = Math.max(new Date(expiresAt).getTime() - Date.now(), 0);
        expiryTimerRef.current = setTimeout(async () => {
            const token = localStorage.getItem('auth_token');
            const r = token ? await authApi.me(token) : null;
            if (r && (r.sinRed || r.reintentable)) {
                scheduleAutoLogout(new Date(Date.now() + 60000).toISOString());
                return;
            }
            if (r?.success && r.data?.session?.expiresAt && new Date(r.data.session.expiresAt).getTime() > Date.now()) {
                scheduleAutoLogout(r.data.session.expiresAt);
                return;
            }
            limpiarDatosLocales({ cierreExplicito: false });
            setUser(null);
            setSession(null);
            setSessionExpired(true);
        }, ms);
    }, []);

    const checkAuth = useCallback(async () => {
        const token = localStorage.getItem('auth_token');
        if (!token) {
            setLoading(false);
            return;
        }

        try {
            const response = await authApi.me(token);
            if (response.success && response.data) {
                const userData = response.data.user;
                const enrichedUser = {
                    ...userData,
                    personaId: (userData as any).personaId,
                    tenantId: (userData as any).tenantId || (response.data as any).tenantId,
                };
                setUser(enrichedUser);
                guardarSesionLocal(enrichedUser);
                guardarLlaveSobre((userData as any).llaveSobreFirma);
                setSinConfirmar(false);
                setSession(response.data.session);
                if (response.data.session?.expiresAt) {
                    scheduleAutoLogout(response.data.session.expiresAt);
                }
                // Ensure tenant_id is set in localStorage
                if (enrichedUser.tenantId) {
                    localStorage.setItem('tenant_id', enrichedUser.tenantId);
                }
                // La capa de API lo adjunta a las consultas de documentos: sin saber
                // quién pregunta, el servidor oculta los documentos de salud.
                if (enrichedUser.personaId) {
                    localStorage.setItem('persona_id', enrichedUser.personaId);
                }
            } else if (response.sinRed || response.reintentable) {
                // Sin red, o el servidor no pudo responder: la sesión no terminó,
                // solo no se pudo preguntar. Se sigue con la copia local y se
                // vuelve a preguntar (ver el efecto de abajo).
                const copia = leerSesionLocal<User>();
                if (copia) setUser(copia);
                setSinConfirmar(true);
            } else {
                borrarSesionLocal();
                localStorage.removeItem('auth_token');
                localStorage.removeItem('session_id');
                localStorage.removeItem('tenant_id');
        localStorage.removeItem('persona_id');
            localStorage.removeItem('persona_id');
            }
        } catch (err) {
            console.error('Error checking auth:', err);
        } finally {
            setLoading(false);
        }
    }, [scheduleAutoLogout]);

    useEffect(() => {
        checkAuth();
    }, [checkAuth]);

    // Se entró con la copia local: al volver la señal se confirma con el servidor.
    useEffect(() => {
        if (!sinConfirmar) return undefined;
        const id = window.setInterval(checkAuth, 60000);
        window.addEventListener('online', checkAuth);
        return () => {
            window.clearInterval(id);
            window.removeEventListener('online', checkAuth);
        };
    }, [sinConfirmar, checkAuth]);

    // Aplica una sesión ya creada por el backend (login directo o tras elegir
    // empresa): guarda localStorage + estado de React. Compartido por login()
    // (caso de una sola empresa) y completarLoginConTenant().
    const aplicarSesion = (data: Pick<LoginSuccess, 'token' | 'sessionId' | 'expiresAt' | 'user'>) => {
        const { token, sessionId, user: userData, expiresAt } = data;

        localStorage.setItem('auth_token', token);
        localStorage.setItem('session_id', sessionId);
        if ((data as any).tenantId) {
            localStorage.setItem('tenant_id', (data as any).tenantId);
        } else if ((userData as any).empresaId) {
            localStorage.setItem('tenant_id', (userData as any).empresaId);
        } else if ((userData as any).tenantId) {
            localStorage.setItem('tenant_id', (userData as any).tenantId);
        }

        const enrichedUser = {
            ...userData,
            personaId: (userData as any).personaId,
            tenantId: (userData as any).tenantId,
        };
        if (enrichedUser.personaId) {
            localStorage.setItem('persona_id', enrichedUser.personaId);
        }

        setUser(enrichedUser);
        guardarSesionLocal(enrichedUser);
        guardarLlaveSobre((userData as any).llaveSobreFirma);
        setSession({
            sessionId,
            expiresAt,
            lastActivity: new Date().toISOString()
        });
        scheduleAutoLogout(expiresAt);
    };

    const login = async (rut: string, password: string): Promise<LoginResult> => {
        setError(null);
        try {
            const response = await authApi.login(rut, password);
            if (response.success && response.data) {
                if ('requiereSeleccionTenant' in response.data) {
                    const { selectionToken, opciones } = response.data;
                    return { success: true, requiresTenantSelection: true, selectionToken, opciones };
                }

                const { requiereCambioPassword, requiereEnrolamiento } = response.data;
                aplicarSesion(response.data);

                return {
                    success: true,
                    requiresChangePassword: requiereCambioPassword,
                    requiresEnrollment: requiereEnrolamiento
                };
            } else {
                const msg = response.error || 'Error al iniciar sesión';
                setError(msg);
                return { success: false, error: msg };
            }
        } catch (err) {
            const msg = 'Error de conexión';
            setError(msg);
            return { success: false, error: msg };
        }
    };

    const completarLoginConTenant = async (selectionToken: string, tenantId: string): Promise<LoginResult> => {
        setError(null);
        try {
            const response = await authApi.selectTenant(selectionToken, tenantId);
            if (response.success && response.data) {
                const { requiereCambioPassword, requiereEnrolamiento } = response.data;
                aplicarSesion(response.data);
                return {
                    success: true,
                    requiresChangePassword: requiereCambioPassword,
                    requiresEnrollment: requiereEnrolamiento
                };
            }
            const msg = response.error || 'Error al iniciar sesión';
            setError(msg);
            return { success: false, error: msg };
        } catch (err) {
            const msg = 'Error de conexión';
            setError(msg);
            return { success: false, error: msg };
        }
    };

    const logout = async () => {
        if (expiryTimerRef.current) {
            clearTimeout(expiryTimerRef.current);
            expiryTimerRef.current = null;
        }
        const sessionId = localStorage.getItem('session_id');
        if (sessionId) {
            await authApi.logout(sessionId);
        }
        limpiarDatosLocales({ cierreExplicito: true });
        setUser(null);
        setSession(null);
    };

    const updateUser = (userData: Partial<User>) => {
        if (user) {
            setUser({ ...user, ...userData });
            guardarSesionLocal({ ...user, ...userData });
        }
    };

    const hasPermission = (permission: string) => {
        if (!user) return false;
        if (user.rol === 'admin') return true; // Admin tiene todos los permisos
        // Algunos usuarios (como los recién creados vía curl) podrían no tener permisos definidos explícitamente todavía
        return (user as any).permisos?.includes(permission) || false;
    };

    return (
        <AuthContext.Provider value={{ user, session, loading, error, sessionExpired, clearSessionExpired, login, completarLoginConTenant, logout, updateUser, reemplazarSesion: aplicarSesion, hasPermission }}>
            {children}
        </AuthContext.Provider>
    );
};

export const useAuth = () => {
    const context = useContext(AuthContext);
    if (context === undefined) {
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return context;
};
