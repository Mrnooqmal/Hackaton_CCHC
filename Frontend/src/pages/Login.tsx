import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { FiShield, FiArrowRight, FiUser, FiLock } from 'react-icons/fi';

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
        <div className="login-page">
            {/* Fondo animado con gradientes */}
            <div className="login-bg">
                <div className="login-bg-gradient login-bg-gradient-1"></div>
                <div className="login-bg-gradient login-bg-gradient-2"></div>
                <div className="login-bg-gradient login-bg-gradient-3"></div>
            </div>

            <div className="login-content">
                <div className="login-header">
                    <div className="login-brand">
                        <div className="login-logo">
                            <div className="login-logo-icon">
                                <FiShield size={40} />
                            </div>
                            <div className="login-logo-shine"></div>
                        </div>
                        <div className="login-wordmark sidebar-logo-text" aria-label="Build and Serve">
                            <span className="sidebar-logo-primary">Build</span>
                            <span className="sidebar-logo-amp">&</span>
                            <span className="sidebar-logo-secondary">Serve</span>
                        </div>
                    </div>
                    <p className="login-subtitle">Sistema de Firma Digital y Gestión Preventiva</p>
                </div>

                <div className="login-card">
                    <div className="login-card-glow"></div>

                    {step === 'rut' ? (
                        <form className="login-form" onSubmit={handleRutSubmit}>
                            <div className="form-group">
                                <label className="form-label">
                                    RUT o Usuario
                                </label>
                                <div className="input-wrapper">
                                    <span className="input-icon">
                                        <FiUser />
                                    </span>
                                    <input
                                        type="text"
                                        className="form-input with-icon"
                                        placeholder="12.345.678-9"
                                        value={rut}
                                        onChange={(e) => setRut(e.target.value)}
                                        autoFocus
                                        required
                                    />
                                </div>
                                {error && <p className="form-error">{error}</p>}
                            </div>

                            <button
                                type="submit"
                                className="btn btn-primary btn-lg w-full login-btn"
                            >
                                <span>Siguiente</span>
                                <FiArrowRight className="ml-2" />
                            </button>
                        </form>
                    ) : (
                        <form className="login-form login-form-slide-in" onSubmit={handleLogin}>
                            <div className="login-back-btn-wrapper">
                                <button
                                    type="button"
                                    onClick={() => setStep('rut')}
                                    className="login-back-btn"
                                >
                                    ← Cambiar RUT
                                </button>
                                <span className="login-rut-display">{rut}</span>
                            </div>

                            <div className="form-group">
                                <label className="form-label">Contraseña</label>
                                <div className="input-wrapper">
                                    <span className="input-icon">
                                        <FiLock />
                                    </span>
                                    <input
                                        type="password"
                                        className="form-input with-icon"
                                        placeholder="••••••••"
                                        value={password}
                                        onChange={(e) => setPassword(e.target.value)}
                                        autoFocus
                                        required
                                    />
                                </div>
                                {error && <p className="form-error">{error}</p>}
                            </div>

                            <button
                                type="submit"
                                className="btn btn-primary btn-lg w-full login-btn"
                                disabled={loading}
                            >
                                {loading ? (
                                    <div className="spinner mx-auto" />
                                ) : (
                                    <>
                                        <span>Iniciar Sesión</span>
                                        <FiArrowRight className="ml-2" />
                                    </>
                                )}
                            </button>
                        </form>
                    )}
                </div>

                <div className="login-footer">
                    <p className="login-footer-text">
                        Powered by <span className="text-primary-400">The Code Cookers</span>
                    </p>
                    <p className="login-footer-link">
                        <a href="/register-admin" className="login-admin-link">
                            Crear primer administrador
                        </a>
                    </p>
                </div>
            </div>

            <style>{`
                .login-page {
                    min-height: 100vh;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    position: relative;
                    overflow: hidden;
                    background: var(--surface-bg);
                    padding: var(--space-4);
                }

                /* Fondo animado con gradientes */
                .login-bg {
                    position: absolute;
                    inset: 0;
                    z-index: 0;
                    overflow: hidden;
                }

                .login-bg-gradient {
                    position: absolute;
                    border-radius: 50%;
                    filter: blur(100px);
                    opacity: 0.3;
                    animation: float 20s ease-in-out infinite;
                }

                .login-bg-gradient-1 {
                    width: 600px;
                    height: 600px;
                    background: linear-gradient(135deg, var(--primary-600), var(--primary-400));
                    top: -200px;
                    left: -200px;
                    animation-delay: 0s;
                }

                .login-bg-gradient-2 {
                    width: 500px;
                    height: 500px;
                    background: linear-gradient(135deg, var(--accent-500), var(--accent-700));
                    bottom: -150px;
                    right: -150px;
                    animation-delay: -7s;
                }

                .login-bg-gradient-3 {
                    width: 400px;
                    height: 400px;
                    background: linear-gradient(135deg, var(--primary-500), var(--info-500));
                    top: 50%;
                    left: 50%;
                    transform: translate(-50%, -50%);
                    animation-delay: -14s;
                }

                @keyframes float {
                    0%, 100% {
                        transform: translate(0, 0) scale(1);
                    }
                    33% {
                        transform: translate(50px, -50px) scale(1.1);
                    }
                    66% {
                        transform: translate(-30px, 30px) scale(0.9);
                    }
                }

                .login-content {
                    position: relative;
                    z-index: 1;
                    width: 100%;
                    max-width: 440px;
                    animation: fadeInUp 0.6s ease-out;
                }

                @keyframes fadeInUp {
                    from {
                        opacity: 0;
                        transform: translateY(30px);
                    }
                    to {
                        opacity: 1;
                        transform: translateY(0);
                    }
                }

                .login-header {
                    text-align: center;
                    margin-bottom: var(--space-8);
                }

                .login-brand {
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    gap: var(--space-4);
                    margin-bottom: var(--space-4);
                }

                .login-brand .login-logo {
                    margin-bottom: 0;
                }

                .login-wordmark {
                    font-size: clamp(2.25rem, 4vw, 3rem);
                    letter-spacing: 0.12em;
                    text-shadow: 0 15px 40px rgba(0, 0, 0, 0.45);
                }

                .login-wordmark .sidebar-logo-secondary {
                    background: var(--gradient-accent);
                    -webkit-background-clip: text;
                    background-clip: text;
                }

                .login-logo {
                    position: relative;
                    width: 88px;
                    height: 88px;
                    margin: 0 auto var(--space-5);
                }

                .login-logo-icon {
                    position: relative;
                    width: 100%;
                    height: 100%;
                    background: linear-gradient(135deg, var(--primary-500), var(--primary-700));
                    border-radius: var(--radius-xl);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    color: white;
                    box-shadow: 
                        0 10px 30px rgba(76, 175, 80, 0.3),
                        0 0 0 1px rgba(255, 255, 255, 0.1) inset;
                    animation: pulse 3s ease-in-out infinite;
                }

                .login-logo-shine {
                    position: absolute;
                    top: 0;
                    left: 0;
                    right: 0;
                    bottom: 0;
                    background: linear-gradient(135deg, transparent 0%, rgba(255, 255, 255, 0.2) 50%, transparent 100%);
                    border-radius: var(--radius-xl);
                    animation: shine 3s ease-in-out infinite;
                }

                @keyframes pulse {
                    0%, 100% {
                        box-shadow: 
                            0 10px 30px rgba(76, 175, 80, 0.3),
                            0 0 0 1px rgba(255, 255, 255, 0.1) inset;
                    }
                    50% {
                        box-shadow: 
                            0 15px 40px rgba(76, 175, 80, 0.5),
                            0 0 0 1px rgba(255, 255, 255, 0.2) inset;
                    }
                }

                @keyframes shine {
                    0% {
                        transform: translateX(-100%) rotate(45deg);
                    }
                    50%, 100% {
                        transform: translateX(200%) rotate(45deg);
                    }
                }

                .login-title {
                    font-size: var(--text-4xl);
                    font-weight: 800;
                    background: linear-gradient(135deg, var(--text-primary), var(--primary-400));
                    -webkit-background-clip: text;
                    -webkit-text-fill-color: transparent;
                    background-clip: text;
                    margin-bottom: var(--space-2);
                    letter-spacing: -0.02em;
                }

                .login-subtitle {
                    font-size: var(--text-sm);
                    color: var(--text-muted);
                    font-weight: 500;
                }

                /* Card con glassmorphism */
                .login-card {
                    position: relative;
                    background: rgba(26, 26, 26, 0.7);
                    backdrop-filter: blur(20px);
                    border: 1px solid rgba(255, 255, 255, 0.1);
                    border-radius: var(--radius-xl);
                    padding: var(--space-8);
                    box-shadow: 
                        0 20px 60px rgba(0, 0, 0, 0.5),
                        0 0 0 1px rgba(255, 255, 255, 0.05) inset;
                    overflow: hidden;
                }

                .login-card-glow {
                    position: absolute;
                    top: -50%;
                    left: -50%;
                    width: 200%;
                    height: 200%;
                    background: radial-gradient(circle, rgba(76, 175, 80, 0.1) 0%, transparent 70%);
                    pointer-events: none;
                }

                .login-form {
                    position: relative;
                    z-index: 1;
                }

                .login-form-slide-in {
                    animation: slideIn 0.3s ease-out;
                }

                @keyframes slideIn {
                    from {
                        opacity: 0;
                        transform: translateX(20px);
                    }
                    to {
                        opacity: 1;
                        transform: translateX(0);
                    }
                }

                .login-back-btn-wrapper {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    margin-bottom: var(--space-6);
                    padding-bottom: var(--space-4);
                    border-bottom: 1px solid var(--surface-border);
                }

                .login-back-btn {
                    background: none;
                    border: none;
                    color: var(--primary-400);
                    font-size: var(--text-sm);
                    font-weight: 500;
                    cursor: pointer;
                    transition: all var(--transition-fast);
                    padding: var(--space-2);
                    margin-left: calc(var(--space-2) * -1);
                }

                .login-back-btn:hover {
                    color: var(--primary-300);
                    transform: translateX(-2px);
                }

                .login-rut-display {
                    font-family: var(--font-mono);
                    font-size: var(--text-sm);
                    color: var(--text-muted);
                    font-weight: 600;
                }

                .input-wrapper {
                    position: relative;
                }

                .input-icon {
                    position: absolute;
                    left: var(--space-4);
                    top: 50%;
                    transform: translateY(-50%);
                    color: var(--text-muted);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    pointer-events: none;
                    z-index: 1;
                }

                .form-input.with-icon {
                    padding-left: calc(var(--space-4) * 2.5);
                }

                .login-btn {
                    margin-top: var(--space-6);
                    position: relative;
                    overflow: hidden;
                }

                .login-btn:not(:disabled):hover {
                    transform: translateY(-2px);
                    box-shadow: 0 15px 40px rgba(76, 175, 80, 0.4);
                }

                .login-btn:not(:disabled):active {
                    transform: translateY(0);
                }

                .login-footer {
                    margin-top: var(--space-6);
                    text-align: center;
                }

                .login-footer-text {
                    font-size: var(--text-xs);
                    color: var(--text-muted);
                    font-weight: 500;
                    margin-bottom: var(--space-2);
                }

                .login-footer-link {
                    margin-top: var(--space-3);
                }

                .login-admin-link {
                    font-size: var(--text-sm);
                    color: var(--primary-400);
                    text-decoration: none;
                    font-weight: 500;
                    transition: all var(--transition-fast);
                    padding: var(--space-2) var(--space-4);
                    border-radius: var(--radius-md);
                    display: inline-block;
                }

                .login-admin-link:hover {
                    color: var(--primary-300);
                    background: rgba(76, 175, 80, 0.1);
                }

                .w-full {
                    width: 100%;
                }

                .ml-2 {
                    margin-left: var(--space-2);
                }

                .mx-auto {
                    margin-left: auto;
                    margin-right: auto;
                }

                /* Responsive */
                @media (max-width: 480px) {
                    .login-title {
                        font-size: var(--text-3xl);
                    }
                    
                    .login-card {
                        padding: var(--space-6);
                    }
                }
            `}</style>
        </div>
    );
}
