import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { authApi } from '../api/client';
import { FiLock, FiEye, FiEyeOff, FiCheck, FiCheckCircle, FiArrowLeft, FiArrowRight, FiArrowUp } from 'react-icons/fi';
import { LuLink2Off } from 'react-icons/lu';
import TarjetaAcceso from '../components/TarjetaAcceso';
import '../css/cambio-password.css';

// Misma regla que valida el backend (POST /auth/reset-password).
const MIN_PASSWORD = 6;

type Campo = 'passwordNuevo' | 'confirmarPassword';

const Volver = () => (
    <div className="lp-foot">
        <Link to="/login" className="lp-foot-link"><FiArrowLeft size={14} /> Volver al inicio de sesión</Link>
    </div>
);

/**
 * Restablecer la contraseña desde el enlace del correo, o activar la cuenta
 * (`?activar=1`). Misma tarjeta y mismos campos que el login y el primer
 * ingreso (ChangePassword).
 */
export default function ResetPassword() {
    const [searchParams] = useSearchParams();
    const navigate = useNavigate();
    const personaId = searchParams.get('pid') || '';
    const token = searchParams.get('token') || '';
    const activar = searchParams.get('activar') === '1';
    const linkValido = !!personaId && !!token;

    const [form, setForm] = useState({ passwordNuevo: '', confirmarPassword: '' });
    const [show, setShow] = useState({ passwordNuevo: false, confirmarPassword: false });
    const [capsLock, setCapsLock] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [done, setDone] = useState(false);

    const minLen = form.passwordNuevo.length >= MIN_PASSWORD;
    const match = form.passwordNuevo === form.confirmarPassword && form.confirmarPassword !== '';
    const canSubmit = linkValido && minLen && match;
    const requisitos = [
        { label: `${MIN_PASSWORD} caracteres o más`, ok: minLen },
        { label: 'Coinciden', ok: match },
    ];

    const handleCaps = (e: React.KeyboardEvent) => setCapsLock(e.getModifierState('CapsLock'));

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!canSubmit || loading) return;
        setLoading(true); setError('');
        try {
            const res = await authApi.resetPassword({
                personaId, token,
                passwordNuevo: form.passwordNuevo,
                confirmarPassword: form.confirmarPassword,
            });
            if (res.success) {
                setDone(true);
                setTimeout(() => navigate('/login', { replace: true }), 2200);
            } else {
                setError(res.error || 'No se pudo restablecer la contraseña');
            }
        } catch {
            setError('Error de conexión con el servidor');
        } finally {
            setLoading(false);
        }
    };

    if (!linkValido) {
        return (
            <TarjetaAcceso>
                <div className="lp-body onb-resultado">
                    <span className="onb-resultado-icono onb-resultado-icono--error"><LuLink2Off size={26} /></span>
                    <h1 className="lp-title">Enlace inválido</h1>
                    <p className="lp-hint">
                        {activar
                            ? 'El enlace de activación está incompleto o es inválido. Pide a tu empresa que active tu acceso.'
                            : 'El enlace de recuperación está incompleto o es inválido. Solicita uno nuevo.'}
                    </p>
                </div>
                {!activar && <Link to="/recuperar-clave" className="onb-btn-secundario">Solicitar nuevo enlace</Link>}
                <Volver />
            </TarjetaAcceso>
        );
    }

    if (done) {
        return (
            <TarjetaAcceso>
                <div className="lp-body onb-resultado" role="status">
                    <span className="onb-resultado-icono onb-resultado-icono--ok"><FiCheckCircle size={26} /></span>
                    <h1 className="lp-title">{activar ? '¡Cuenta activada!' : '¡Contraseña restablecida!'}</h1>
                    <p className="lp-hint">Redirigiendo al inicio de sesión…</p>
                </div>
                <Volver />
            </TarjetaAcceso>
        );
    }

    const campo = (id: string, c: Campo, label: string, autoFocus = false) => (
        <div className="lp-field">
            <label className="lp-label" htmlFor={id}>{label}</label>
            <div className="lp-input-wrap">
                <span className="lp-input-icon"><FiLock size={15} /></span>
                <input
                    id={id}
                    className="lp-input lp-input--password"
                    type={show[c] ? 'text' : 'password'}
                    value={form[c]}
                    onChange={(e) => { setForm((f) => ({ ...f, [c]: e.target.value })); if (error) setError(''); }}
                    onKeyDown={handleCaps}
                    onKeyUp={handleCaps}
                    onBlur={() => setCapsLock(false)}
                    autoComplete="new-password"
                    autoFocus={autoFocus}
                />
                <button
                    type="button"
                    className="lp-eye-btn"
                    onClick={() => setShow((s) => ({ ...s, [c]: !s[c] }))}
                    aria-label={show[c] ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                >
                    {show[c] ? <FiEyeOff size={15} /> : <FiEye size={15} />}
                </button>
            </div>
        </div>
    );

    return (
        <TarjetaAcceso>
            <div className="lp-body">
                <h1 className="lp-title">{activar ? 'Activa tu cuenta' : 'Nueva contraseña'}</h1>
                <p className="lp-hint">
                    {activar
                        ? 'Elige tu contraseña. Después entras con tu RUT y esta contraseña.'
                        : 'Crea una contraseña nueva y segura para tu cuenta.'}
                </p>

                <form className="lp-form onb-form" onSubmit={handleSubmit} noValidate>
                    <div className="onb-row">
                        {campo('rp-nueva', 'passwordNuevo', 'Contraseña', true)}
                        {campo('rp-repetir', 'confirmarPassword', 'Repite la contraseña')}
                    </div>
                    <ul className="onb-requisitos" aria-label="Requisitos de la contraseña">
                        {requisitos.map((r) => (
                            <li key={r.label} className={r.ok ? 'onb-req onb-req--ok' : 'onb-req'}>
                                {r.ok ? <FiCheck size={11} strokeWidth={3} /> : <span className="onb-req-punto" />}
                                {r.label}
                                <span className="sr-only">{r.ok ? ' (cumplido)' : ' (pendiente)'}</span>
                            </li>
                        ))}
                    </ul>
                    {capsLock && (
                        <span className="cpw-mayus" role="status"><FiArrowUp size={11} strokeWidth={2.6} /> Bloq Mayús activado</span>
                    )}

                    {error && <p className="lp-error" role="alert">{error}</p>}

                    <button type="submit" className="lp-submit" disabled={!canSubmit || loading}>
                        {loading ? <div className="lp-spinner" /> : (
                            <><span>{activar ? 'Activar mi cuenta' : 'Restablecer contraseña'}</span><FiArrowRight size={15} /></>
                        )}
                    </button>
                </form>
            </div>
            <Volver />
        </TarjetaAcceso>
    );
}
