import { useState, useEffect } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { onboardingApi } from '../api/onboarding.api';
import type { LicenciaValida } from '../api/onboarding.api';
import {
    FiArrowRight, FiArrowLeft, FiCheckCircle, FiAlertCircle, FiLock, FiEye, FiEyeOff, FiMail,
} from 'react-icons/fi';

/**
 * Alta de una empresa con el enlace de activación.
 *
 * Ruta pública: quien llega acá todavía no tiene sesión y no puede tenerla,
 * porque su empresa no existe. La credencial es el token del enlace.
 *
 * El correo del administrador NO se edita: viene fijado en la licencia. Si se
 * pudiera cambiar, una invitación emitida para una empresa serviría para dar de
 * alta a cualquier otra.
 */

// ── RUT ──────────────────────────────────────────────────────────────────────

const rutFormat = (raw: string): string => {
    const limpio = raw.replace(/[^0-9kK]/g, '').toUpperCase();
    if (limpio.length < 2) return limpio;
    const cuerpo = limpio.slice(0, -1);
    const dv = limpio.slice(-1);
    return cuerpo.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + '-' + dv;
};

const rutValido = (rut: string): boolean => {
    const limpio = rut.replace(/[^0-9kK]/g, '').toUpperCase();
    if (limpio.length < 2) return false;
    const cuerpo = limpio.slice(0, -1);
    const dv = limpio.slice(-1);
    let suma = 0;
    let mult = 2;
    for (let i = cuerpo.length - 1; i >= 0; i--) {
        suma += parseInt(cuerpo[i], 10) * mult;
        mult = mult === 7 ? 2 : mult + 1;
    }
    const resto = 11 - (suma % 11);
    return dv === (resto === 11 ? '0' : resto === 10 ? 'K' : String(resto));
};

// La misma política que aplica el servidor. Repetirla acá no la reemplaza: sirve
// para no hacer viajar un formulario que ya se sabe que va a ser rechazado.
const MIN_PASSWORD = 8;
const passwordOk = (p: string) => p.length >= MIN_PASSWORD && /[a-zA-Z]/.test(p) && /[0-9]/.test(p);

type Paso = 'empresa' | 'administrador';

export default function Onboarding() {
    const [searchParams] = useSearchParams();
    const navigate = useNavigate();
    const token = searchParams.get('token') || '';

    const [licencia, setLicencia] = useState<LicenciaValida | null>(null);
    const [validando, setValidando] = useState(true);
    const [enlaceInvalido, setEnlaceInvalido] = useState(false);

    const [paso, setPaso] = useState<Paso>('empresa');
    const [enviando, setEnviando] = useState(false);
    const [error, setError] = useState('');
    const [listo, setListo] = useState(false);
    const [ver, setVer] = useState({ password: false, confirmar: false });

    const [empresa, setEmpresa] = useState({ nombre: '', rutEmpresa: '' });
    const [admin, setAdmin] = useState({
        nombre: '', apellidoPaterno: '', apellidoMaterno: '', rut: '',
        password: '', confirmarPassword: '',
    });

    useEffect(() => {
        let vigente = true;
        if (!token) { setValidando(false); setEnlaceInvalido(true); return; }

        (async () => {
            try {
                const res = await onboardingApi.validarLicencia(token);
                if (!vigente) return;
                if (res.success && res.data) {
                    setLicencia(res.data);
                    setEmpresa({
                        nombre: res.data.prellenado.nombre || '',
                        rutEmpresa: res.data.prellenado.rutEmpresa || '',
                    });
                } else {
                    setEnlaceInvalido(true);
                }
            } catch {
                if (vigente) setEnlaceInvalido(true);
            } finally {
                if (vigente) setValidando(false);
            }
        })();

        return () => { vigente = false; };
    }, [token]);

    const empresaOk = empresa.nombre.trim().length >= 3 && rutValido(empresa.rutEmpresa);
    const adminOk = admin.nombre.trim().length >= 2
        && admin.apellidoPaterno.trim().length >= 2
        && rutValido(admin.rut)
        && passwordOk(admin.password)
        && admin.password === admin.confirmarPassword;

    const enviar = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!adminOk || enviando) return;
        setEnviando(true); setError('');
        try {
            const res = await onboardingApi.completar({
                token,
                empresa: { nombre: empresa.nombre.trim(), rutEmpresa: empresa.rutEmpresa },
                admin: {
                    rut: admin.rut,
                    nombre: admin.nombre.trim(),
                    apellidoPaterno: admin.apellidoPaterno.trim(),
                    apellidoMaterno: admin.apellidoMaterno.trim(),
                    password: admin.password,
                    confirmarPassword: admin.confirmarPassword,
                },
            });
            if (res.success) {
                setListo(true);
                setTimeout(() => navigate('/login', { replace: true }), 3000);
            } else {
                setError(res.error || 'No se pudo completar el alta');
            }
        } catch {
            setError('Error de conexión con el servidor');
        } finally {
            setEnviando(false);
        }
    };

    const Marca = (
        <div className="auth-simple-logo" aria-label="Build and Serve">
            <span style={{ color: 'var(--text-primary)' }}>Build</span>
            <span style={{ color: 'var(--danger-500, #df3601)' }}>&amp;</span>
            <span style={{ color: 'var(--text-primary)' }}>Serve</span>
        </div>
    );

    if (validando) {
        return (
            <div className="auth-simple-page">
                <div className="auth-simple-card" role="main">
                    {Marca}
                    <p className="auth-simple-sub" style={{ textAlign: 'center' }}>Comprobando el enlace…</p>
                </div>
            </div>
        );
    }

    if (enlaceInvalido || !licencia) {
        return (
            <div className="auth-simple-page">
                <div className="auth-simple-card" role="main">
                    {Marca}
                    <div className="auth-simple-success">
                        <FiAlertCircle size={40} style={{ color: 'var(--danger-500, #ef4444)', marginBottom: 12 }} />
                        <h1 className="auth-simple-title">Enlace inválido o vencido</h1>
                        <p className="auth-simple-sub">
                            Este enlace de activación ya no sirve. Puede haber vencido, haberse usado
                            para crear la empresa o haber sido anulado. Pide uno nuevo a quien te lo envió.
                        </p>
                        <Link to="/login" className="btn btn-secondary" style={{ width: '100%', justifyContent: 'center' }}>
                            Ir al inicio de sesión
                        </Link>
                    </div>
                </div>
            </div>
        );
    }

    if (listo) {
        return (
            <div className="auth-simple-page">
                <div className="auth-simple-card" role="main">
                    {Marca}
                    <div className="auth-simple-success">
                        <FiCheckCircle size={40} className="auth-simple-success-icon" />
                        <h1 className="auth-simple-title">Empresa creada</h1>
                        <p className="auth-simple-sub">
                            Ya puedes entrar con tu RUT y la contraseña que acabas de elegir.
                            Te llevamos al inicio de sesión…
                        </p>
                        <Link to="/login" className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }}>
                            Iniciar sesión
                        </Link>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="auth-simple-page">
            <div className="auth-simple-card" role="main" style={{ maxWidth: 520 }}>
                {Marca}

                <h1 className="auth-simple-title">Activa tu empresa</h1>
                <p className="auth-simple-sub">
                    {paso === 'empresa'
                        ? 'Primero, los datos de la empresa que vas a administrar.'
                        : 'Ahora tus datos y la contraseña con la que vas a entrar.'}
                </p>

                <div style={{
                    display: 'flex', gap: 8, margin: '0 0 20px', fontSize: 'var(--text-xs)',
                    color: 'var(--text-muted)', alignItems: 'center', justifyContent: 'center',
                }}>
                    <span style={{ fontWeight: paso === 'empresa' ? 700 : 400, color: paso === 'empresa' ? 'var(--text-primary)' : undefined }}>
                        1. Empresa
                    </span>
                    <span aria-hidden="true">·</span>
                    <span style={{ fontWeight: paso === 'administrador' ? 700 : 400, color: paso === 'administrador' ? 'var(--text-primary)' : undefined }}>
                        2. Administrador
                    </span>
                </div>

                {paso === 'empresa' ? (
                    <form onSubmit={(e) => { e.preventDefault(); if (empresaOk) setPaso('administrador'); }} noValidate>
                        <div className="form-group">
                            <label className="form-label" htmlFor="onb-nombre">Razón social</label>
                            <input
                                id="onb-nombre" className="form-input" type="text" autoFocus
                                value={empresa.nombre}
                                onChange={(e) => setEmpresa({ ...empresa, nombre: e.target.value })}
                                placeholder="Constructora Ejemplo SpA"
                            />
                            {empresa.nombre && empresa.nombre.trim().length < 3 && (
                                <span className="auth-simple-hint">Escribe el nombre completo de la empresa</span>
                            )}
                        </div>

                        <div className="form-group">
                            <label className="form-label" htmlFor="onb-rut-empresa">RUT de la empresa</label>
                            <input
                                id="onb-rut-empresa" className="form-input" type="text" inputMode="text"
                                value={empresa.rutEmpresa}
                                onChange={(e) => setEmpresa({ ...empresa, rutEmpresa: rutFormat(e.target.value) })}
                                placeholder="76.111.999-0"
                            />
                            {empresa.rutEmpresa && !rutValido(empresa.rutEmpresa) && (
                                <span className="auth-simple-hint">El RUT no es válido</span>
                            )}
                        </div>

                        <button type="submit" className="btn btn-primary" disabled={!empresaOk}
                            style={{ width: '100%', justifyContent: 'center', marginTop: 4 }}>
                            Continuar <FiArrowRight size={15} />
                        </button>
                    </form>
                ) : (
                    <form onSubmit={enviar} noValidate>
                        <div className="form-group">
                            <label className="form-label" htmlFor="onb-correo">Tu correo</label>
                            <div className="auth-simple-input-wrap">
                                <FiMail size={14} className="auth-simple-input-icon" />
                                <input
                                    id="onb-correo" className="form-input" type="email" disabled
                                    style={{ paddingLeft: 34 }} value={licencia.email}
                                />
                            </div>
                            <span className="auth-simple-hint">
                                Es el correo al que llegó la invitación y no se puede cambiar acá.
                            </span>
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
                            <div className="form-group">
                                <label className="form-label" htmlFor="onb-nombres">Nombres</label>
                                <input id="onb-nombres" className="form-input" type="text" autoFocus
                                    value={admin.nombre}
                                    onChange={(e) => setAdmin({ ...admin, nombre: e.target.value })} />
                            </div>
                            <div className="form-group">
                                <label className="form-label" htmlFor="onb-rut">Tu RUT</label>
                                <input id="onb-rut" className="form-input" type="text"
                                    value={admin.rut}
                                    onChange={(e) => setAdmin({ ...admin, rut: rutFormat(e.target.value) })}
                                    placeholder="15.111.222-6" />
                            </div>
                            <div className="form-group">
                                <label className="form-label" htmlFor="onb-apellido1">Apellido paterno</label>
                                <input id="onb-apellido1" className="form-input" type="text"
                                    value={admin.apellidoPaterno}
                                    onChange={(e) => setAdmin({ ...admin, apellidoPaterno: e.target.value })} />
                            </div>
                            <div className="form-group">
                                <label className="form-label" htmlFor="onb-apellido2">Apellido materno</label>
                                <input id="onb-apellido2" className="form-input" type="text"
                                    value={admin.apellidoMaterno}
                                    onChange={(e) => setAdmin({ ...admin, apellidoMaterno: e.target.value })} />
                            </div>
                        </div>
                        {admin.rut && !rutValido(admin.rut) && (
                            <span className="auth-simple-hint">El RUT no es válido</span>
                        )}

                        <div className="form-group">
                            <label className="form-label" htmlFor="onb-password">Contraseña</label>
                            <div className="auth-simple-input-wrap">
                                <FiLock size={14} className="auth-simple-input-icon" />
                                <input
                                    id="onb-password" className="form-input"
                                    type={ver.password ? 'text' : 'password'}
                                    style={{ paddingLeft: 34, paddingRight: 38 }}
                                    value={admin.password} autoComplete="new-password"
                                    onChange={(e) => setAdmin({ ...admin, password: e.target.value })}
                                />
                                <button type="button" className="auth-simple-eye" tabIndex={-1}
                                    aria-label={ver.password ? 'Ocultar' : 'Mostrar'}
                                    onClick={() => setVer((v) => ({ ...v, password: !v.password }))}>
                                    {ver.password ? <FiEyeOff size={15} /> : <FiEye size={15} />}
                                </button>
                            </div>
                            <span className="auth-simple-hint">
                                Al menos {MIN_PASSWORD} caracteres, con letras y números.
                            </span>
                        </div>

                        <div className="form-group">
                            <label className="form-label" htmlFor="onb-password2">Repite la contraseña</label>
                            <div className="auth-simple-input-wrap">
                                <FiLock size={14} className="auth-simple-input-icon" />
                                <input
                                    id="onb-password2" className="form-input"
                                    type={ver.confirmar ? 'text' : 'password'}
                                    style={{ paddingLeft: 34, paddingRight: 38 }}
                                    value={admin.confirmarPassword} autoComplete="new-password"
                                    onChange={(e) => setAdmin({ ...admin, confirmarPassword: e.target.value })}
                                />
                                <button type="button" className="auth-simple-eye" tabIndex={-1}
                                    aria-label={ver.confirmar ? 'Ocultar' : 'Mostrar'}
                                    onClick={() => setVer((v) => ({ ...v, confirmar: !v.confirmar }))}>
                                    {ver.confirmar ? <FiEyeOff size={15} /> : <FiEye size={15} />}
                                </button>
                            </div>
                            {admin.confirmarPassword && admin.password !== admin.confirmarPassword && (
                                <span className="auth-simple-hint">Las contraseñas no coinciden</span>
                            )}
                        </div>

                        {error && <p className="auth-simple-error" role="alert">{error}</p>}

                        <div style={{ display: 'flex', gap: 'var(--space-3)', marginTop: 4 }}>
                            <button type="button" className="btn btn-secondary" disabled={enviando}
                                onClick={() => { setError(''); setPaso('empresa'); }}
                                style={{ justifyContent: 'center' }}>
                                <FiArrowLeft size={15} /> Atrás
                            </button>
                            <button type="submit" className="btn btn-primary" disabled={!adminOk || enviando}
                                style={{ flex: 1, justifyContent: 'center' }}>
                                {enviando ? 'Creando la empresa…' : 'Crear empresa'}
                            </button>
                        </div>
                    </form>
                )}
            </div>
        </div>
    );
}
