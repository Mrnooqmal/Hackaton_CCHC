import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { authApi, type User, type SessionInfo } from '../api/client';

interface AuthContextType {
    user: User | null;
    session: SessionInfo | null;
    loading: boolean;
    error: string | null;
    login: (rut: string, password: string) => Promise<{ success: boolean; requiresChangePassword?: boolean; requiresEnrollment?: boolean }>;
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

    const checkAuth = useCallback(async () => {
        const token = localStorage.getItem('auth_token');
        if (!token) {
            setLoading(false);
            return;
        }

        try {
            const response = await authApi.me(token);
            if (response.success && response.data) {
                setUser(response.data.user);
                setSession(response.data.session);
            } else {
                localStorage.removeItem('auth_token');
                localStorage.removeItem('session_id');
            }
        } catch (err) {
            console.error('Error checking auth:', err);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        checkAuth();
    }, [checkAuth]);

    const login = async (rut: string, password: string) => {
        setError(null);
        try {
            const response = await authApi.login(rut, password);
            if (response.success && response.data) {
                const { token, sessionId, user: userData, expiresAt, requiereCambioPassword, requiereEnrolamiento } = response.data;

                localStorage.setItem('auth_token', token);
                localStorage.setItem('session_id', sessionId);

                setUser(userData);
                setSession({
                    sessionId,
                    expiresAt,
                    lastActivity: new Date().toISOString()
                });

                return {
                    success: true,
                    requiresChangePassword: requiereCambioPassword,
                    requiresEnrollment: requiereEnrolamiento
                };
            } else {
                setError(response.error || 'Error al iniciar sesión');
                return { success: false };
            }
        } catch (err) {
            setError('Error de conexión');
            return { success: false };
        }
    };

    const logout = async () => {
        const sessionId = localStorage.getItem('session_id');
        if (sessionId) {
            await authApi.logout(sessionId);
        }
        localStorage.removeItem('auth_token');
        localStorage.removeItem('session_id');
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
        <AuthContext.Provider value={{ user, session, loading, error, login, logout, updateUser, hasPermission }}>
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
