import { useState } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { useAuth, type TenantOpcion } from '../context/AuthContext';
import { FiArrowRight, FiArrowLeft, FiUser, FiLock, FiEye, FiEyeOff, FiChevronRight } from 'react-icons/fi';

// Nombre legible del rol que la persona tiene en cada empresa.
const ROL_LABEL: Record<string, string> = {
    admin: 'Administrador',
    jefe_obra: 'Jefe de Obra',
    supervisor: 'Supervisor',
    prevencionista: 'Prevencionista',
    trabajador: 'Trabajador',
};

// Cada empresa se reconoce por un monograma de color estable (derivado de su
// id): el login todavía no conoce su logo, pero sí puede distinguirlas.
const MONOGRAMA_COLORES = ['#003b75', '#0f766e', '#9a3412', '#5b21b6', '#1e40af', '#166534'];
const SUFIJOS_SOCIETARIOS = new Set(['spa', 'ltda', 'sa', 's.a.', 'eirl', 'limitada']);

function monograma(nombre: string): string {
    const palabras = nombre.split(/\s+/).filter((w) => w && !SUFIJOS_SOCIETARIOS.has(w.toLowerCase()));
    return (palabras.slice(0, 2).map((w) => w[0]).join('') || nombre.slice(0, 2)).toUpperCase();
}

function colorMonograma(id: string): string {
    let h = 0;
    for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
    return MONOGRAMA_COLORES[h % MONOGRAMA_COLORES.length];
}

export default function Login() {
    const { login, completarLoginConTenant, error: authError } = useAuth();
    const navigate = useNavigate();
    const location = useLocation();

    const [rut, setRut] = useState('');
    const [password, setPassword] = useState('');

    const rutFormat = (raw: string) => {
        const clean = raw.replace(/[^0-9kK]/g, '').toUpperCase();
        if (clean.length < 2) return clean;
        const body = clean.slice(0, -1);
        const dv   = clean.slice(-1);
        return body.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + '-' + dv;
    };
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [showPassword, setShowPassword] = useState(false);

    // Cuando el RUT pertenece a varias empresas: se pide elegir cuál antes de
    // completar el login (sin volver a pedir la contraseña).
    const [seleccion, setSeleccion] = useState<{ selectionToken: string; opciones: TenantOpcion[] } | null>(null);

    const from = (location.state as any)?.from?.pathname || '/';

    const continuarPostLogin = (result: { requiresChangePassword?: boolean; requiresEnrollment?: boolean }) => {
        if (result.requiresChangePassword) {
            navigate('/change-password');
        } else if (result.requiresEnrollment) {
            navigate('/enroll-me');
        } else {
            navigate(from, { replace: true });
        }
    };

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!rut) { setError('El RUT es requerido'); return; }
        if (!password) { setError('La contraseña es requerida'); return; }
        setLoading(true);
        setError('');

        const result = await login(rut, password);

        if (result.success) {
            if (result.requiresTenantSelection && result.selectionToken && result.opciones) {
                setSeleccion({ selectionToken: result.selectionToken, opciones: result.opciones });
                setLoading(false);
                return;
            }
            continuarPostLogin(result);
        } else {
            setError(authError || 'Credenciales inválidas');
            setLoading(false);
        }
    };

    const handleSeleccionarTenant = async (tenantId: string) => {
        if (!seleccion) return;
        setLoading(true);
        setError('');
        const result = await completarLoginConTenant(seleccion.selectionToken, tenantId);
        if (result.success) {
            continuarPostLogin(result);
        } else {
            setError(authError || 'No se pudo completar el ingreso. Intenta nuevamente.');
            setSeleccion(null);
            setLoading(false);
        }
    };

    return (
        <div className="lp-root">
            {/* Fondo fotografía */}
            <div className="lp-bg" aria-hidden="true" />

            {/* Tarjeta: mismo ancho en todos los pasos. El ingreso mide lo que su
                formulario; elegir empresa usa el alto fijo del flujo (lp-card--fija)
                y, si hay muchas, es la lista la que hace scroll. */}
            <main className={`lp-card${seleccion ? ' lp-card--fija' : ''}`}>
                <div className="lp-head">
                    <div className="lp-logo" aria-label="Build and Serve">
                        <span className="lp-logo-build">Build</span>
                        <span className="lp-logo-amp">&amp;</span>
                        <span className="lp-logo-serve">Serve</span>
                    </div>
                    <div className="lp-divider" aria-hidden="true" />
                </div>

                {seleccion ? (
                    <>
                        <div className="lp-body">
                            <h1 className="lp-title">Elige tu empresa</h1>
                            <p className="lp-hint">Tu cuenta pertenece a más de una empresa. ¿Con cuál entras hoy?</p>
                            <div className="lp-tenant-list">
                                {seleccion.opciones.map((op) => (
                                    <button
                                        key={op.tenantId}
                                        type="button"
                                        className="lp-tenant-option"
                                        disabled={loading}
                                        onClick={() => handleSeleccionarTenant(op.tenantId)}
                                    >
                                        <span
                                            className="lp-tenant-mono"
                                            style={{ background: colorMonograma(op.tenantId) }}
                                            aria-hidden="true"
                                        >
                                            {monograma(op.tenantNombre)}
                                        </span>
                                        <span className="lp-tenant-info">
                                            <span className="lp-tenant-nombre">{op.tenantNombre}</span>
                                            <span className="lp-tenant-rol">{ROL_LABEL[op.rol] ?? op.rol}</span>
                                        </span>
                                        <FiChevronRight size={17} className="lp-caret" />
                                    </button>
                                ))}
                            </div>
                            {error && <p className="lp-error" role="alert">{error}</p>}
                        </div>
                        <div className="lp-foot">
                            <button type="button" className="lp-foot-link" disabled={loading} onClick={() => { setSeleccion(null); setError(''); }}>
                                <FiArrowLeft size={14} /> Volver
                            </button>
                            <span className="lp-foot-meta">RUT {rut}</span>
                        </div>
                    </>
                ) : (
                    <>
                        <div className="lp-body">
                            <h1 className="lp-title">Iniciar sesión</h1>

                            <form className="lp-form" onSubmit={handleLogin} noValidate>
                                <div className="lp-field">
                                    <label className="lp-label" htmlFor="lp-rut">RUT</label>
                                    <div className="lp-input-wrap">
                                        <span className="lp-input-icon"><FiUser size={15} /></span>
                                        <input
                                            id="lp-rut"
                                            type="text"
                                            inputMode="text"
                                            className="lp-input"
                                            placeholder="12.345.678-9"
                                            value={rut}
                                            onChange={(e) => setRut(rutFormat(e.target.value))}
                                            autoComplete="username"
                                            autoFocus
                                        />
                                    </div>
                                </div>

                                <div className="lp-field">
                                    <label className="lp-label" htmlFor="lp-password">Contraseña</label>
                                    <div className="lp-input-wrap">
                                        <span className="lp-input-icon"><FiLock size={15} /></span>
                                        <input
                                            id="lp-password"
                                            type={showPassword ? 'text' : 'password'}
                                            className="lp-input lp-input--password"
                                            placeholder="••••••••"
                                            value={password}
                                            onChange={(e) => setPassword(e.target.value)}
                                            autoComplete="current-password"
                                        />
                                        <button
                                            type="button"
                                            className="lp-eye-btn"
                                            onClick={() => setShowPassword(v => !v)}
                                            aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                                        >
                                            {showPassword ? <FiEyeOff size={15} /> : <FiEye size={15} />}
                                        </button>
                                    </div>
                                </div>

                                {error && <p className="lp-error" role="alert">{error}</p>}

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
                        <div className="lp-foot">
                            <Link to="/recuperar-clave" className="lp-foot-link">¿Olvidaste tu contraseña?</Link>
                            <span className="lp-foot-meta lp-foot-org">Cámara Chilena de la Construcción</span>
                        </div>
                    </>
                )}
            </main>

            <style>{`
                /* ── Root — ocupa toda la pantalla ── */
                .lp-root {
                    min-height: 100vh;
                    min-height: 100dvh;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    padding: 24px 16px;
                    box-sizing: border-box;
                    position: relative;
                    overflow: hidden;
                    font-family: var(--font-ui);
                }

                /* ── Fotografía de fondo ── */
                .lp-bg {
                    position: absolute;
                    inset: 0;
                    background: #1c2b3d url('/fondoLogin.png') center center / cover no-repeat;
                    z-index: 0;
                }

                /* ── Tarjeta: 520 de ancho en todos los pasos ── */
                .lp-card {
                    position: relative;
                    z-index: 1;
                    width: 100%;
                    max-width: 520px;
                    display: flex;
                    flex-direction: column;
                    background: #ffffff;
                    color: #0f172a;
                    border-radius: 16px;
                    padding: 40px 40px 12px;
                    box-shadow:
                        0 2px 4px rgba(0,0,0,0.08),
                        0 8px 24px rgba(0,0,0,0.18),
                        0 32px 64px rgba(0,0,0,0.28);
                    animation: lp-rise 0.45s cubic-bezier(0.22, 1, 0.36, 1) both;
                    box-sizing: border-box;
                }

                /* Pasos con lista: alto fijo del flujo, sin pasarse de la pantalla */
                .lp-card--fija { height: min(580px, calc(100dvh - 48px)); }

                @keyframes lp-rise {
                    from { opacity: 0; transform: translateY(20px) scale(0.98); }
                    to   { opacity: 1; transform: translateY(0) scale(1); }
                }

                .lp-head {
                    display: flex;
                    flex-direction: column;
                    gap: 20px;
                    flex-shrink: 0;
                }

                .lp-logo {
                    display: flex;
                    align-items: baseline;
                    justify-content: center;
                    gap: 6px;
                    font-family: var(--font-display);
                    font-size: 34px;
                    font-weight: 600;
                    line-height: 1;
                    letter-spacing: -0.01em;
                }

                .lp-logo-build { color: #003b75; }
                .lp-logo-amp   { color: #df3601; font-weight: 500; }
                .lp-logo-serve { color: #006edc; }

                .lp-divider { height: 1px; background: #e8edf3; }

                /* ── Cuerpo: lo único que cambia entre pasos ── */
                .lp-body {
                    display: flex;
                    flex-direction: column;
                    padding-top: 22px;
                }

                .lp-card--fija .lp-body { flex: 1; min-height: 0; }

                .lp-title {
                    font-size: 22px;
                    font-weight: 700;
                    color: #0f172a;
                    margin: 0;
                    letter-spacing: -0.02em;
                }

                .lp-hint {
                    font-size: 13px;
                    color: #64748b;
                    margin: 6px 0 0;
                    line-height: 1.5;
                }

                /* ── Formulario ── */
                .lp-form {
                    display: flex;
                    flex-direction: column;
                    gap: 14px;
                    margin-top: 22px;
                }

                .lp-field { display: flex; flex-direction: column; gap: 6px; }

                .lp-label {
                    font-size: 11px;
                    font-weight: 700;
                    color: #64748b;
                    letter-spacing: 0.06em;
                    text-transform: uppercase;
                }

                .lp-input-wrap { position: relative; }

                .lp-input-icon {
                    position: absolute;
                    left: 13px;
                    top: 50%;
                    transform: translateY(-50%);
                    color: #64748b;
                    display: flex;
                    pointer-events: none;
                    z-index: 1;
                }

                .lp-input {
                    width: 100%;
                    height: 44px;
                    padding: 0 12px 0 38px;
                    background: #f8fafc;
                    border: 1px solid #e2e8f0;
                    border-radius: 8px;
                    color: #0f172a;
                    font-size: 14px;
                    font-family: inherit;
                    transition: border-color 0.15s ease, box-shadow 0.15s ease, background 0.15s ease;
                    outline: none;
                    box-sizing: border-box;
                }

                .lp-input--password { padding-right: 44px; }
                .lp-input::placeholder { color: #94a3b8; }

                .lp-input:focus {
                    border-color: #006edc;
                    background: #fff;
                    box-shadow: 0 0 0 3px rgba(0, 110, 220, 0.12);
                }

                .lp-eye-btn {
                    position: absolute;
                    right: 4px;
                    top: 4px;
                    width: 36px;
                    height: 36px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    background: none;
                    border: none;
                    border-radius: 6px;
                    cursor: pointer;
                    color: #64748b;
                    transition: color 0.15s ease;
                }

                .lp-eye-btn:hover { color: #006edc; }

                /* ── Error ── */
                .lp-error {
                    font-size: 12px;
                    color: #c2410c;
                    font-weight: 500;
                    margin: 0;
                    padding: 8px 10px;
                    background: rgba(223, 54, 1, 0.06);
                    border-radius: 6px;
                }

                .lp-tenant-list + .lp-error { margin-top: 12px; }

                /* ── Botón ── */
                .lp-submit {
                    margin-top: 8px;
                    width: 100%;
                    height: 46px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    gap: 8px;
                    background: #002855;
                    color: #fff;
                    border: none;
                    border-radius: 8px;
                    font-size: 14px;
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

                .lp-submit:not(:disabled):active { transform: translateY(0); box-shadow: none; }
                .lp-submit:disabled { opacity: 0.6; cursor: not-allowed; }

                .lp-spinner {
                    width: 17px;
                    height: 17px;
                    border: 2px solid rgba(255,255,255,0.3);
                    border-top-color: #fff;
                    border-radius: 50%;
                    animation: lp-spin 0.7s linear infinite;
                }

                @keyframes lp-spin { to { transform: rotate(360deg); } }

                /* ── Selección de empresa ── */
                .lp-tenant-list {
                    display: flex;
                    flex-direction: column;
                    gap: 10px;
                    margin: 20px -4px 0;
                    padding: 2px 4px 4px;
                    overflow-y: auto;
                    min-height: 0;
                }

                .lp-tenant-option {
                    display: flex;
                    align-items: center;
                    gap: 14px;
                    width: 100%;
                    min-height: 68px;
                    flex-shrink: 0;
                    padding: 12px 14px;
                    background: #f8fafc;
                    border: 1px solid #e2e8f0;
                    border-radius: 12px;
                    cursor: pointer;
                    text-align: left;
                    font-family: inherit;
                    color: #0f172a;
                    transition: border-color 0.15s ease, background 0.15s ease, box-shadow 0.15s ease;
                }

                .lp-tenant-option:not(:disabled):hover,
                .lp-tenant-option:focus-visible {
                    outline: none;
                    border-color: #006edc;
                    background: #fff;
                    box-shadow: 0 4px 14px rgba(0, 110, 220, 0.14);
                }

                .lp-tenant-option:disabled { opacity: 0.6; cursor: not-allowed; }

                .lp-tenant-mono {
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    width: 42px;
                    height: 42px;
                    flex-shrink: 0;
                    border-radius: 10px;
                    color: #fff;
                    font-size: 14px;
                    font-weight: 700;
                    letter-spacing: 0.04em;
                }

                .lp-tenant-info {
                    flex: 1;
                    min-width: 0;
                    display: flex;
                    flex-direction: column;
                    gap: 4px;
                }

                .lp-tenant-nombre {
                    font-size: 14.5px;
                    font-weight: 600;
                    color: #0f172a;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                }

                .lp-tenant-rol {
                    align-self: flex-start;
                    padding: 2px 8px;
                    border-radius: 999px;
                    background: #eef2f7;
                    font-size: 11.5px;
                    font-weight: 500;
                    color: #475569;
                }

                .lp-caret { flex-shrink: 0; color: #64748b; transition: color 0.15s ease; }
                .lp-tenant-option:hover .lp-caret,
                .lp-tenant-option:focus-visible .lp-caret { color: #006edc; }

                /* ── Pie: una acción a cada lado, en el mismo lugar en cada paso ── */
                .lp-foot {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    gap: 12px;
                    flex-shrink: 0;
                    min-height: 52px;
                    margin-top: 16px;
                    border-top: 1px solid #e8edf3;
                }

                .lp-foot-link {
                    display: inline-flex;
                    align-items: center;
                    gap: 6px;
                    min-height: 44px;
                    padding: 0;
                    background: none;
                    border: none;
                    font-family: inherit;
                    font-size: 13px;
                    font-weight: 500;
                    color: #006edc;
                    text-decoration: none;
                    cursor: pointer;
                }

                .lp-foot-link:hover { color: #0052a3; text-decoration: underline; }
                .lp-foot-link:disabled { opacity: 0.6; cursor: not-allowed; }

                .lp-foot-meta {
                    font-size: 12px;
                    color: #64748b;
                    text-align: right;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                    min-width: 0;
                }

                /* ── Móvil ── */
                @media (max-width: 560px) {
                    .lp-root { padding: 16px; }
                    .lp-card { padding: 30px 22px 8px; border-radius: 12px; }
                    .lp-card--fija { height: min(640px, calc(100dvh - 32px)); }
                    .lp-logo { font-size: 30px; }
                    .lp-title { font-size: 20px; }
                    /* 16px evita que iOS haga zoom al enfocar el campo */
                    .lp-input { font-size: 16px; }
                }

                /* En pantallas angostas el nombre de la Cámara no cabe junto al enlace */
                @media (max-width: 400px) {
                    .lp-foot-org { display: none; }
                }

                @media (prefers-reduced-motion: reduce) {
                    .lp-card { animation: none; }
                }
            `}</style>
        </div>
    );
}
