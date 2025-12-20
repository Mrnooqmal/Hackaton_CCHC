import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

interface ProtectedRouteProps {
    children: React.ReactNode;
    requiredPermission?: string;
    requiredRole?: 'admin' | 'prevencionista' | 'trabajador';
}

export const ProtectedRoute: React.FC<ProtectedRouteProps> = ({
    children,
    requiredPermission,
    requiredRole
}) => {
    const { user, loading, hasPermission } = useAuth();
    const location = useLocation();

    if (loading) {
        return (
            <div className="flex items-center justify-center h-screen">
                <div className="spinner-lg" />
            </div>
        );
    }

    if (!user) {
        // Redirigir a login pero guardar la ubicación a la que intentaba acceder
        return <Navigate to="/login" state={{ from: location }} replace />;
    }

    // 1. Verificar si requiere cambio de contraseña (temporal)
    if (user.passwordTemporal) {
        if (location.pathname !== '/change-password') {
            return <Navigate to="/change-password" replace />;
        }
        return <>{children}</>;
    }

    // 2. Verificar si requiere enrolamiento (firma inicial)
    if (!user.habilitado) {
        if (location.pathname !== '/enroll-me') {
            return <Navigate to="/enroll-me" replace />;
        }
        return <>{children}</>;
    }

    // Verificar rol si es necesario
    if (requiredRole && user.rol !== requiredRole && user.rol !== 'admin') {
        return <Navigate to="/unauthorized" replace />;
    }

    // Verificar permiso si es necesario
    if (requiredPermission && !hasPermission(requiredPermission)) {
        return <Navigate to="/unauthorized" replace />;
    }

    return <>{children}</>;
};
