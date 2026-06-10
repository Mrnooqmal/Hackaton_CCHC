import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { FiArrowRight, FiUser, FiLock, FiEye, FiEyeOff } from 'react-icons/fi';

export default function Login() {
    const { login } = useAuth();
    const navigate = useNavigate();
    const location = useLocation();

    const [rut, setRut] = useState('');
    const [password, setPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [loading, setLoading] = useState(false);
    const [slowHint, setSlowHint] = useState(false);
    const [error, setError] = useState('');

    const from = (location.state as any)?.from?.pathname || '/';

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!rut.trim()) { setError('El RUT es requerido'); return; }
        if (!password)   { setError('La contraseña es requerida'); return; }
        setLoading(true);
        setError('');
        setSlowHint(false);
        // Aviso de cold-start: si tarda más de ~1.2s mostramos un microcopy.
        const slowTimer = setTimeout(() => setSlowHint(true), 1200);

        const result = await login(rut.trim(), password);
        clearTimeout(slowTimer);

        if (result.success) {
            if (result.requiresChangePassword) navigate('/change-password');
            else if (result.requiresEnrollment) navigate('/enroll-me');
            else navigate(from, { replace: true });
        } else {
            // Usar el error del intento actual (no el estado del contexto, que llega un render tarde).
            setError(result.error || 'RUT o contraseña incorrectos');
            setLoading(false);
            setSlowHint(false);
        }
    };

    return (
        <div className="lp-page">
            {/* Fondo */}
            <div className="lp-bg-glow" />

            <div className="lp-wrapper">
                <div className="lp-card">
                    <div className="lp-accent-bar" />

                    {/* Logo */}
                    <div className="lp-logo-area">
                        <div className="sidebar-logo-text lp-wordmark">
                            <span className="sidebar-logo-primary">Build</span>
                            <span className="sidebar-logo-amp">&amp;</span>
                            <span className="sidebar-logo-secondary">Serve</span>
                        </div>
                        <p className="lp-tagline">Gestión preventiva y firma digital para la construcción</p>
                    </div>

                    {/* Formulario */}
                    <form onSubmit={handleLogin} noValidate>
                        <div className="lp-field">
                            <label className="lp-label" htmlFor="lp-rut">RUT</label>
                            <div className="lp-input-wrap">
                                <FiUser className="lp-icon" size={15} />
                                <input
                                    id="lp-rut"
                                    type="text"
                                    className={`lp-input${error ? ' lp-input-err' : ''}`}
                                    placeholder="12.345.678-9"
                                    value={rut}
                                    onChange={(e) => { setRut(e.target.value); setError(''); }}
                                    autoFocus
                                    disabled={loading}
                                    autoComplete="username"
                                />
                            </div>
                        </div>

                        <div className="lp-field">
                            <label className="lp-label" htmlFor="lp-password">Contraseña</label>
                            <div className="lp-input-wrap">
                                <FiLock className="lp-icon" size={15} />
                                <input
                                    id="lp-password"
                                    type={showPassword ? 'text' : 'password'}
                                    className={`lp-input lp-input-pr${error ? ' lp-input-err' : ''}`}
                                    placeholder="••••••••"
                                    value={password}
                                    onChange={(e) => { setPassword(e.target.value); setError(''); }}
                                    disabled={loading}
                                    autoComplete="current-password"
                                />
                                <button type="button" className="lp-eye" tabIndex={-1}
                                    onClick={() => setShowPassword(v => !v)}>
                                    {showPassword ? <FiEyeOff size={15} /> : <FiEye size={15} />}
                                </button>
                            </div>
                        </div>

                        {error && <p className="lp-error">{error}</p>}

                        <button type="submit" className="lp-btn" disabled={loading}>
                            {loading
                                ? <span className="spinner" style={{ margin: '0 auto' }} />
                                : <><span>Iniciar sesión</span><FiArrowRight size={15} /></>
                            }
                        </button>

                        {loading && slowHint && (
                            <p className="lp-slow-hint">Esto puede tardar unos segundos la primera vez…</p>
                        )}
                    </form>

                    <div className="lp-sep" />

                    <a href="/onboarding" className="lp-register">
                        ¿No perteneces a ninguna empresa?&nbsp;<span>Registra tu empresa</span>
                    </a>
                </div>
            </div>

            <style>{`
                .lp-page {
                    min-height: 100vh;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    padding: var(--space-4);
                    background:
                        radial-gradient(ellipse 80% 60% at 50% -10%, rgba(76,175,80,0.18) 0%, transparent 70%),
                        radial-gradient(ellipse 60% 50% at 80% 100%, rgba(59,130,246,0.10) 0%, transparent 60%),
                        linear-gradient(160deg, #0c110c 0%, #090d09 50%, #0a0c12 100%);
                    position: relative;
                    overflow: hidden;
                }

                /* Halo verde sutil detrás de la card */
                .lp-bg-glow {
                    position: absolute;
                    width: 600px; height: 600px;
                    border-radius: 50%;
                    background: radial-gradient(circle, rgba(76,175,80,0.12) 0%, transparent 65%);
                    top: 50%; left: 50%;
                    transform: translate(-50%, -50%);
                    pointer-events: none;
                }

                .lp-wrapper {
                    position: relative;
                    z-index: 1;
                    width: 100%;
                    max-width: 440px;
                    animation: lp-in 0.4s ease-out both;
                }

                @keyframes lp-in {
                    from { opacity: 0; transform: translateY(18px); }
                    to   { opacity: 1; transform: translateY(0); }
                }

                /* ── Card ── */
                .lp-card {
                    position: relative;
                    background: rgba(22, 24, 22, 0.88);
                    backdrop-filter: blur(20px);
                    border: 1px solid rgba(255,255,255,0.08);
                    border-radius: 18px;
                    padding: 40px 40px 36px;
                    box-shadow:
                        0 0 0 1px rgba(255,255,255,0.04) inset,
                        0 20px 56px rgba(0,0,0,0.55),
                        0 0 80px rgba(76,175,80,0.06);
                    overflow: hidden;
                }

                /* Franja verde superior */
                .lp-accent-bar {
                    position: absolute;
                    top: 0; left: 0; right: 0;
                    height: 3px;
                    background: linear-gradient(90deg, var(--primary-600) 0%, var(--primary-400) 55%, transparent 100%);
                }

                /* ── Logo / wordmark ── */
                .lp-logo-area {
                    text-align: center;
                    margin-bottom: 36px;
                }

                .lp-wordmark {
                    font-size: clamp(1.9rem, 5vw, 2.4rem) !important;
                    justify-content: center;
                    margin-bottom: var(--space-2);
                }

                .lp-tagline {
                    font-size: 0.82rem;
                    color: var(--text-muted);
                    margin: 0;
                    letter-spacing: 0.01em;
                }

                /* ── Fields ── */
                .lp-field { margin-bottom: var(--space-4); }

                .lp-label {
                    display: block;
                    font-size: 0.8rem;
                    font-weight: 500;
                    color: var(--text-secondary);
                    margin-bottom: var(--space-2);
                    letter-spacing: 0.02em;
                }

                .lp-input-wrap { position: relative; }

                .lp-icon {
                    position: absolute;
                    left: 13px; top: 50%;
                    transform: translateY(-50%);
                    color: var(--text-muted);
                    pointer-events: none;
                    z-index: 1;
                }

                .lp-input {
                    width: 100%;
                    padding: 11px 14px 11px 38px;
                    background: rgba(255,255,255,0.04);
                    border: 1px solid rgba(255,255,255,0.1);
                    border-radius: 10px;
                    color: var(--text-primary);
                    font-size: 0.93rem;
                    font-family: var(--font-sans);
                    outline: none;
                    transition: border-color 150ms, box-shadow 150ms, background 150ms;
                    box-sizing: border-box;
                }

                .lp-input::placeholder { color: rgba(160,160,160,0.45); }

                .lp-input:focus {
                    border-color: var(--primary-500);
                    background: rgba(76,175,80,0.04);
                    box-shadow: 0 0 0 3px rgba(76,175,80,0.14);
                }

                .lp-input:disabled { opacity: 0.45; cursor: not-allowed; }
                .lp-input-err { border-color: rgba(239,68,68,0.55) !important; box-shadow: 0 0 0 3px rgba(239,68,68,0.1) !important; }
                .lp-input-pr { padding-right: 40px; }

                .lp-eye {
                    position: absolute; right: 12px; top: 50%;
                    transform: translateY(-50%);
                    background: none; border: none;
                    color: var(--text-muted); cursor: pointer;
                    display: flex; align-items: center; padding: 2px;
                    transition: color 150ms;
                }
                .lp-eye:hover { color: var(--text-primary); }

                /* ── Error ── */
                .lp-error {
                    font-size: 0.83rem;
                    color: #f07070;
                    margin: calc(var(--space-1) * -1) 0 var(--space-3);
                    padding: var(--space-2) var(--space-3);
                    background: rgba(239,68,68,0.08);
                    border: 1px solid rgba(239,68,68,0.18);
                    border-radius: 8px;
                }

                .lp-slow-hint {
                    text-align: center;
                    font-size: 0.8rem;
                    color: var(--text-muted);
                    margin: var(--space-3) 0 0;
                    animation: lp-in 0.3s ease-out both;
                }

                /* ── Submit ── */
                .lp-btn {
                    width: 100%;
                    margin-top: var(--space-2);
                    padding: 12px 20px;
                    display: flex; align-items: center; justify-content: center;
                    gap: var(--space-2);
                    background: var(--primary-600);
                    color: #fff;
                    border: none;
                    border-radius: 10px;
                    font-size: 0.93rem;
                    font-weight: 600;
                    font-family: var(--font-sans);
                    cursor: pointer;
                    letter-spacing: 0.015em;
                    transition: background 150ms, transform 150ms, box-shadow 150ms;
                }

                .lp-btn:hover:not(:disabled) {
                    background: var(--primary-500);
                    transform: translateY(-1px);
                    box-shadow: 0 8px 22px rgba(76,175,80,0.3);
                }

                .lp-btn:active:not(:disabled) { transform: translateY(0); }
                .lp-btn:disabled { opacity: 0.5; cursor: not-allowed; }

                /* ── Separator + register ── */
                .lp-sep {
                    height: 1px;
                    background: rgba(255,255,255,0.07);
                    margin: 28px 0 20px;
                }

                .lp-register {
                    display: block;
                    text-align: center;
                    font-size: 0.84rem;
                    color: var(--text-muted);
                    text-decoration: none;
                    transition: color 150ms;
                }

                .lp-register span {
                    color: var(--primary-400);
                    font-weight: 500;
                    transition: color 150ms;
                }

                .lp-register:hover { color: var(--text-secondary); }
                .lp-register:hover span { color: var(--primary-300); }

                @media (max-width: 480px) {
                    .lp-card { padding: 32px 24px 28px; }
                }
            `}</style>
        </div>
    );
}
