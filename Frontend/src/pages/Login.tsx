import { useState } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { useAuth, type TenantOpcion } from '../context/AuthContext';
import TarjetaAcceso from '../components/TarjetaAcceso';
import { monograma, colorMonograma } from '../utils/identidadEmpresa';
import { FiArrowRight, FiArrowLeft, FiUser, FiLock, FiEye, FiEyeOff, FiChevronRight } from 'react-icons/fi';

// Nombre legible del rol que la persona tiene en cada empresa.
const ROL_LABEL: Record<string, string> = {
    admin: 'Administrador',
    jefe_obra: 'Jefe de Obra',
    supervisor: 'Supervisor',
    prevencionista: 'Prevencionista',
    trabajador: 'Trabajador',
};

export default function Login() {
    const { login, completarLoginConTenant } = useAuth();

    // Un fallo de red o del servidor no es "credenciales inválidas" (H-18). Antes
    // se leía el error del contexto, que en este render todavía no se había
    // actualizado, y siempre caía en el texto por omisión.
    const mensajeDeIngreso = (r: { error?: string; sinRed?: boolean; reintentable?: boolean }, porOmision: string) =>
        r.sinRed
            ? 'No pudimos conectarnos con el servidor. Revisa tu conexión e inténtalo de nuevo.'
            : r.reintentable
                ? (r.error || 'El servidor no pudo responder. Vuelve a intentarlo en un momento.')
                : (r.error || porOmision);
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

    const pedido = (location.state as any)?.from?.pathname || '/';
    const de = ((location.state as any)?.de as string | null | undefined) || null;

    const continuarPostLogin = (result: { requiresChangePassword?: boolean; requiresEnrollment?: boolean }) => {
        // La ruta pendiente es de quien tenía la sesión: si entra otra persona
        // (equipo compartido de la obra), va al inicio y no a la pantalla del
        // anterior, que quizás no puede ver (H-17).
        let quien: string | null = null;
        try { quien = localStorage.getItem('persona_id'); } catch { /* sin almacenamiento */ }
        const from = de && quien && de !== quien ? '/' : pedido;
        try { if (quien) localStorage.setItem('ultima_persona', quien); } catch { /* sin almacenamiento */ }
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
            setError(mensajeDeIngreso(result, 'Credenciales inválidas'));
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
            setError(mensajeDeIngreso(result, 'No se pudo completar el ingreso. Intenta nuevamente.'));
            setSeleccion(null);
            setLoading(false);
        }
    };

    return (
        // Tarjeta: mismo ancho en todos los pasos. El ingreso mide lo que su
        // formulario; elegir empresa usa el alto fijo del flujo y, si hay muchas,
        // es la lista la que hace scroll.
        <TarjetaAcceso fija={Boolean(seleccion)}>

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
                        </div>
                    </>
                )}
        </TarjetaAcceso>
    );
}
