import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { FiArrowRight, FiUser, FiLock } from 'react-icons/fi';

export default function Login() {
    const { login, error: authError } = useAuth();
    const navigate = useNavigate();
    const location = useLocation();

    const [rut, setRut] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const from = (location.state as any)?.from?.pathname || '/';

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!rut) { setError('El RUT es requerido'); return; }
        if (!password) { setError('La contraseña es requerida'); return; }
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
        <div className="lp-root">
            {/* Fondo fotografía */}
            <div className="lp-bg" aria-hidden="true" />

            {/* Card centrado */}
            <div className="lp-card" role="main">
                {/* Logo */}
                <div className="lp-logo" aria-label="Build and Serve">
                    <span className="lp-logo-build">Build</span>
                    <span className="lp-logo-amp">&amp;</span>
                    <span className="lp-logo-serve">Serve</span>
                </div>

                <div className="lp-divider" aria-hidden="true" />

                <h1 className="lp-title">Iniciar sesión</h1>

                <form className="lp-form" onSubmit={handleLogin} noValidate>
                    <div className="lp-field">
                        <label className="lp-label" htmlFor="lp-rut">RUT</label>
                        <div className="lp-input-wrap">
                            <span className="lp-input-icon"><FiUser size={14} /></span>
                            <input
                                id="lp-rut"
                                type="text"
                                className="lp-input"
                                placeholder="12.345.678-9"
                                value={rut}
                                onChange={(e) => setRut(e.target.value)}
                                autoComplete="username"
                                autoFocus
                            />
                        </div>
                    </div>

                    <div className="lp-field">
                        <label className="lp-label" htmlFor="lp-password">Contraseña</label>
                        <div className="lp-input-wrap">
                            <span className="lp-input-icon"><FiLock size={14} /></span>
                            <input
                                id="lp-password"
                                type="password"
                                className="lp-input"
                                placeholder="••••••••"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                autoComplete="current-password"
                            />
                        </div>
                    </div>

                    {error && <p className="lp-error" role="alert">{error}</p>}

                    <p className="lp-register-hint">
                        ¿No perteneces a una empresa?{' '}
                        <a href="/onboarding" className="lp-register-link">
                            Registra tu empresa
                        </a>
                    </p>

                    <button type="submit" className="lp-submit" disabled={loading}>
                        {loading ? (
                            <div className="lp-spinner" />
                        ) : (
                            <>
                                <span>Ingresar</span>
                                <FiArrowRight size={15} />
                            </>
                        )}
                    </button>
                </form>
            </div>

            <style>{`
                /* ── Root — ocupa toda la pantalla ── */
                .lp-root {
                    min-height: 100vh;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    padding: 24px 16px;
                    position: relative;
                    overflow: hidden;
                }

                /* ── Fotografía de fondo ── */
                .lp-bg {
                    position: absolute;
                    inset: 0;
                    background: url('/fondoLogin.png') center center / cover no-repeat;
                    z-index: 0;
                }

                /* ── Card ── */
                .lp-card {
                    position: relative;
                    z-index: 1;
                    width: 100%;
                    max-width: 440px;
                    background: #ffffff;
                    border-radius: 16px;
                    padding: 48px 48px 44px;
                    box-shadow:
                        0 2px 4px rgba(0,0,0,0.08),
                        0 8px 24px rgba(0,0,0,0.18),
                        0 32px 64px rgba(0,0,0,0.28);
                    animation: lp-rise 0.45s cubic-bezier(0.22, 1, 0.36, 1) both;
                    box-sizing: border-box;
                }

                @keyframes lp-rise {
                    from { opacity: 0; transform: translateY(20px) scale(0.98); }
                    to   { opacity: 1; transform: translateY(0) scale(1); }
                }

                /* ── Logo ── */
                .lp-logo {
                    display: flex;
                    align-items: baseline;
                    justify-content: center;
                    gap: 6px;
                    font-family: 'Lora', Georgia, serif;
                    font-size: 2.25rem;
                    font-weight: 600;
                    line-height: 1;
                    letter-spacing: -0.01em;
                    margin-bottom: 20px;
                }

                .lp-logo-build { color: #003b75; }
                .lp-logo-amp   { color: #df3601; font-weight: 500; }
                .lp-logo-serve { color: #006edc; }

                /* ── Divisor ── */
                .lp-divider {
                    height: 1px;
                    background: #e8edf3;
                    margin-bottom: 24px;
                }

                /* ── Título ── */
                .lp-title {
                    font-size: 22px;
                    font-weight: 700;
                    color: #0f172a;
                    margin: 0 0 24px 0;
                    letter-spacing: -0.02em;
                }

                /* ── Formulario ── */
                .lp-form {
                    display: flex;
                    flex-direction: column;
                    gap: 14px;
                }

                .lp-field {
                    display: flex;
                    flex-direction: column;
                    gap: 5px;
                }

                .lp-label {
                    font-size: 11px;
                    font-weight: 700;
                    color: #64748b;
                    letter-spacing: 0.06em;
                    text-transform: uppercase;
                }

                .lp-input-wrap {
                    position: relative;
                }

                .lp-input-icon {
                    position: absolute;
                    left: 11px;
                    top: 50%;
                    transform: translateY(-50%);
                    color: #94a3b8;
                    display: flex;
                    align-items: center;
                    pointer-events: none;
                    z-index: 1;
                }

                .lp-input {
                    width: 100%;
                    height: 40px;
                    padding: 0 12px 0 34px;
                    background: #f8fafc;
                    border: 1px solid #e2e8f0;
                    border-radius: 8px;
                    color: #0f172a;
                    font-size: 13.5px;
                    font-family: inherit;
                    transition: border-color 0.15s ease, box-shadow 0.15s ease, background 0.15s ease;
                    outline: none;
                    box-sizing: border-box;
                }

                .lp-input::placeholder { color: #b0bec5; }

                .lp-input:focus {
                    border-color: #006edc;
                    background: #fff;
                    box-shadow: 0 0 0 3px rgba(0, 110, 220, 0.12);
                }

                /* ── Error ── */
                .lp-error {
                    font-size: 12px;
                    color: #df3601;
                    font-weight: 500;
                    margin: 0;
                    padding: 8px 10px;
                    background: rgba(223, 54, 1, 0.06);
                    border-radius: 6px;
                    border-left: 2px solid #df3601;
                }

                /* ── Registro ── */
                .lp-register-hint {
                    font-size: 12px;
                    color: #94a3b8;
                    margin: 0;
                    line-height: 1.4;
                }

                .lp-register-link {
                    color: #006edc;
                    font-weight: 500;
                    text-decoration: none;
                    transition: color 0.15s ease;
                }

                .lp-register-link:hover {
                    color: #0052a3;
                    text-decoration: underline;
                }

                /* ── Botón ── */
                .lp-submit {
                    margin-top: 4px;
                    width: 100%;
                    height: 42px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    gap: 8px;
                    background: #002855;
                    color: #fff;
                    border: none;
                    border-radius: 8px;
                    font-size: 13.5px;
                    font-weight: 600;
                    font-family: inherit;
                    cursor: pointer;
                    letter-spacing: 0.02em;
                    transition: background 0.15s ease, transform 0.12s ease, box-shadow 0.15s ease;
                }

                .lp-submit:not(:disabled):hover {
                    background: #006edc;
                    transform: translateY(-1px);
                    box-shadow: 0 6px 20px rgba(0, 110, 220, 0.3);
                }

                .lp-submit:not(:disabled):active {
                    transform: translateY(0);
                    box-shadow: none;
                }

                .lp-submit:disabled {
                    opacity: 0.6;
                    cursor: not-allowed;
                }

                /* ── Spinner ── */
                .lp-spinner {
                    width: 17px;
                    height: 17px;
                    border: 2px solid rgba(255,255,255,0.3);
                    border-top-color: #fff;
                    border-radius: 50%;
                    animation: lp-spin 0.7s linear infinite;
                }

                @keyframes lp-spin { to { transform: rotate(360deg); } }

                /* ── Responsive ── */
                @media (max-width: 500px) {
                    .lp-root { padding: 16px 12px; align-items: flex-start; padding-top: 40px; }
                    .lp-card { padding: 36px 28px 32px; border-radius: 12px; }
                    .lp-logo { font-size: 1.9rem; }
                    .lp-title { font-size: 20px; }
                }
            `}</style>
        </div>
    );
}
