import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { authApi } from '../api/client';
import { FiLock, FiCheckCircle } from 'react-icons/fi';

export default function ChangePassword() {
    const { user, logout } = useAuth();
    const navigate = useNavigate();
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState(false);
    const [formData, setFormData] = useState({
        passwordActual: '',
        passwordNuevo: '',
        confirmarPassword: ''
    });

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        if (formData.passwordNuevo !== formData.confirmarPassword) {
            setError('Las contraseñas no coinciden');
            return;
        }

        if (formData.passwordNuevo.length < 6) {
            setError('La contraseña debe tener al menos 6 caracteres');
            return;
        }

        setLoading(true);
        setError('');

        try {
            const response = await authApi.changePassword({
                userId: user?.userId || '',
                ...formData
            });

            if (response.success) {
                setSuccess(true);

                // Si el usuario no está habilitado, redirigir al enrolamiento (sin logout)
                if (!user?.habilitado) {
                    setTimeout(() => {
                        navigate('/enroll-me', { replace: true });
                    }, 1500);
                } else {
                    // Si ya está habilitado, hacer logout para que inicie con la nueva contraseña
                    setTimeout(async () => {
                        await logout();
                        navigate('/login', { replace: true });
                    }, 2000);
                }
            } else {
                setError(response.error || 'Error al cambiar la contraseña');
            }
        } catch (err) {
            setError('Error de conexión con el servidor');
        } finally {
            setLoading(false);
        }
    };

    if (success) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-surface-base p-4">
                <div className="card max-w-md w-full text-center">
                    <div className="flex justify-center mb-4 text-success-500">
                        <FiCheckCircle size={64} />
                    </div>
                    <h2 className="text-2xl font-bold mb-2">¡Contraseña Actualizada!</h2>
                    <p className="text-text-muted mb-6">
                        {user?.habilitado
                            ? 'Su contraseña ha sido cambiada exitosamente. Será redirigido al login para ingresar nuevamente.'
                            : 'Su contraseña ha sido cambiada exitosamente. Ahora procederemos con su enrolamiento de firma digital.'}
                    </p>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen flex items-center justify-center bg-surface-base p-4">
            <div className="card max-w-md w-full">
                <div className="flex justify-center mb-6">
                    <div className="avatar avatar-lg bg-primary-500">
                        <FiLock size={32} />
                    </div>
                </div>
                <h2 className="text-center text-2xl font-bold text-text-primary">
                    Cambio de Contraseña
                </h2>
                <p className="mt-2 text-center text-sm text-text-muted mb-8">
                    {user?.passwordTemporal
                        ? 'Su contraseña actual es temporal. Por seguridad, debe crear una nueva.'
                        : 'Actualice su contraseña de acceso.'}
                </p>

                <form className="space-y-4" onSubmit={handleSubmit}>
                    <div className="form-group">
                        <label className="form-label">Contraseña Actual</label>
                        <input
                            type="password"
                            className="form-input"
                            value={formData.passwordActual}
                            onChange={(e) => setFormData({ ...formData, passwordActual: e.target.value })}
                            required
                        />
                    </div>

                    <div className="form-group">
                        <label className="form-label">Nueva Contraseña</label>
                        <input
                            type="password"
                            className="form-input"
                            value={formData.passwordNuevo}
                            onChange={(e) => setFormData({ ...formData, passwordNuevo: e.target.value })}
                            placeholder="Mínimo 6 caracteres"
                            required
                        />
                    </div>

                    <div className="form-group">
                        <label className="form-label">Confirmar Nueva Contraseña</label>
                        <input
                            type="password"
                            className="form-input"
                            value={formData.confirmarPassword}
                            onChange={(e) => setFormData({ ...formData, confirmarPassword: e.target.value })}
                            required
                        />
                    </div>

                    {error && (
                        <div className="p-3 bg-danger-500/10 border border-danger-500/20 rounded text-danger-500 text-sm">
                            {error}
                        </div>
                    )}

                    <div className="pt-4 space-y-3">
                        <button
                            type="submit"
                            className="btn btn-primary w-full"
                            disabled={loading}
                        >
                            {loading ? 'Cambiando...' : 'Cambiar Contraseña'}
                        </button>

                        <button
                            type="button"
                            onClick={() => logout()}
                            className="btn btn-ghost w-full"
                        >
                            Cerrar Sesión
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
