import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { FiShield, FiArrowRight, FiUser } from 'react-icons/fi';

export default function Login() {
    const { login, error: authError } = useAuth();
    const navigate = useNavigate();
    const location = useLocation();

    const [rut, setRut] = useState('');
    const [password, setPassword] = useState('');
    const [step, setStep] = useState<'rut' | 'password'>('rut');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const from = (location.state as any)?.from?.pathname || '/';

    const handleRutSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!rut) {
            setError('RUT o Usuario es requerido');
            return;
        }
        setError('');
        setStep('password');
    };

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError('');

        const result = await login(rut, password);

        if (result.success) {
            if (result.requiresChangePassword) {
                navigate('/change-password');
            } else if (result.requiresEnrollment) {
                navigate('/enroll-me');
            } else {
                navigate(from, { replace: true });
            }
        } else {
            setError(authError || 'Credenciales inválidas');
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen flex flex-col justify-center py-12 sm:px-6 lg:px-8 bg-surface-base">
            <div className="sm:mx-auto sm:w-full sm:max-w-md">
                <div className="flex justify-center mb-6">
                    <div className="avatar avatar-lg bg-primary-500">
                        <FiShield size={32} />
                    </div>
                </div>
                <h2 className="text-center text-3xl font-extrabold text-text-primary">
                    PrevenciónApp
                </h2>
                <p className="mt-2 text-center text-sm text-text-muted">
                    Sistema de Firma Digital y Gestión Preventiva
                </p>
            </div>

            <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
                <div className="card">
                    {step === 'rut' ? (
                        <form className="space-y-6" onSubmit={handleRutSubmit}>
                            <div className="form-group">
                                <label className="form-label">
                                    RUT o Usuario
                                </label>
                                <div className="relative">
                                    <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-text-muted">
                                        <FiUser />
                                    </span>
                                    <input
                                        type="text"
                                        className="form-input pl-10"
                                        placeholder="12.345.678-9"
                                        value={rut}
                                        onChange={(e) => setRut(e.target.value)}
                                        autoFocus
                                        required
                                    />
                                </div>
                                {error && <p className="mt-2 text-sm text-danger-500">{error}</p>}
                            </div>

                            <div>
                                <button
                                    type="submit"
                                    className="btn btn-primary w-full"
                                >
                                    Siguiente
                                    <FiArrowRight className="ml-2" />
                                </button>
                            </div>
                        </form>
                    ) : (
                        <form className="space-y-6" onSubmit={handleLogin}>
                            <div className="flex items-center justify-between">
                                <button
                                    type="button"
                                    onClick={() => setStep('rut')}
                                    className="text-sm text-primary-500 hover:text-primary-600"
                                >
                                    ← Cambiar RUT
                                </button>
                                <span className="text-sm text-text-muted font-mono">{rut}</span>
                            </div>

                            <div className="form-group">
                                <label className="form-label">Contraseña</label>
                                <input
                                    type="password"
                                    className="form-input"
                                    placeholder="********"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    autoFocus
                                    required
                                />
                                {error && <p className="mt-2 text-sm text-danger-500">{error}</p>}
                            </div>

                            <button
                                type="submit"
                                className="btn btn-primary w-full"
                                disabled={loading}
                            >
                                {loading ? <div className="spinner mx-auto" /> : 'Iniciar Sesión'}
                            </button>
                        </form>
                    )}
                </div>
            </div>
        </div>
    );
}
