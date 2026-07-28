import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { authApi, type User, type SessionInfo, type LoginSuccess } from '../api/client';

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
    hasPermission: (permission: string) => boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [user, setUser] = useState<User | null>(null);
    const [session, setSession] = useState<SessionInfo | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [sessionExpired, setSessionExpired] = useState(false);
    const expiryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const clearSessionExpired = useCallback(() => setSessionExpired(false), []);

    const scheduleAutoLogout = useCallback((expiresAt: string) => {
        if (expiryTimerRef.current) clearTimeout(expiryTimerRef.current);
        const ms = new Date(expiresAt).getTime() - Date.now();
        if (ms <= 0) return;
        expiryTimerRef.current = setTimeout(() => {
            localStorage.removeItem('auth_token');
            localStorage.removeItem('session_id');
            localStorage.removeItem('tenant_id');
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
                setSession(response.data.session);
                if (response.data.session?.expiresAt) {
                    scheduleAutoLogout(response.data.session.expiresAt);
                }
                // Ensure tenant_id is set in localStorage
                if (enrichedUser.tenantId) {
                    localStorage.setItem('tenant_id', enrichedUser.tenantId);
                }
            } else {
                localStorage.removeItem('auth_token');
                localStorage.removeItem('session_id');
                localStorage.removeItem('tenant_id');
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

    // Aplica una sesión ya creada por el backend (login directo o tras elegir
    // empresa): guarda localStorage + estado de React. Compartido por login()
    // (caso de una sola empresa) y completarLoginConTenant().
    const aplicarSesion = (data: LoginSuccess) => {
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

        setUser(enrichedUser);
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
        localStorage.removeItem('auth_token');
        localStorage.removeItem('session_id');
        localStorage.removeItem('tenant_id');
        setUser(null);
        setSession(null);
    };

    const updateUser = (userData: Partial<User>) => {
        if (user) {
            setUser({ ...user, ...userData });
        }
    };

    const hasPermission = (permission: string) => {
        if (!user) return false;
        if (user.rol === 'admin') return true; // Admin tiene todos los permisos
        // Algunos usuarios (como los recién creados vía curl) podrían no tener permisos definidos explícitamente todavía
        return (user as any).permisos?.includes(permission) || false;
    };

    return (
        <AuthContext.Provider value={{ user, session, loading, error, sessionExpired, clearSessionExpired, login, completarLoginConTenant, logout, updateUser, hasPermission }}>
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
