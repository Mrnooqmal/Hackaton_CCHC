import { useState, useEffect, useRef } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { onboardingApi } from '../api/onboarding.api';
import type { LicenciaValida } from '../api/onboarding.api';
import {
    FiArrowRight, FiArrowLeft, FiCheck, FiCheckCircle, FiLock, FiEye, FiEyeOff, FiMail,
    FiUpload, FiPlus, FiX,
} from 'react-icons/fi';
import { LuLink2Off } from 'react-icons/lu';
import '../css/AuthCard.css';
import { SUGGESTED_COLORS, MAX_LOGO_BYTES, compressLogo, monograma } from '../utils/identidadEmpresa';
import { DEFAULT_PRIMARY_COLOR } from '../context/BrandContext';

/**
 * Alta de una empresa con el enlace de activación.
 *
 * Ruta pública: quien llega acá todavía no tiene sesión y no puede tenerla,
 * porque su empresa no existe. La credencial es el token del enlace.
 *
 * El correo del administrador NO se edita: viene fijado en la licencia. Si se
 * pudiera cambiar, una invitación emitida para una empresa serviría para dar de
 * alta a cualquier otra.
 *
 * Cuatro pasos cortos en la misma tarjeta del login: quién administra, la
 * empresa, su identidad visual (opcional) y las credenciales. Nada se envía
 * hasta el último; volver atrás conserva lo escrito.
 */

// ── RUT ────────────────────────────────────────────────────
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

// Quien administra la empresa firma por ella: tiene que ser mayor de edad
// (el servidor aplica la misma regla).
const EDAD_MINIMA = 18;
const hoyMenos = (anios: number) => {
    const d = new Date();
    d.setFullYear(d.getFullYear() - anios);
    return d.toISOString().slice(0, 10);
};
const FECHA_MAXIMA = hoyMenos(EDAD_MINIMA);
const FECHA_MINIMA = hoyMenos(110);
const fechaOk = (f: string) => /^\d{4}-\d{2}-\d{2}$/.test(f) && f <= FECHA_MAXIMA && f >= FECHA_MINIMA;

const COLOR_HEX = /^#[0-9a-fA-F]{6}$/;

const fechaLarga = (iso: string) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('es-CL', { day: 'numeric', month: 'long' });
};

type Paso = 'datos' | 'empresa' | 'identidad' | 'acceso';
const PASOS: { id: Paso; label: string }[] = [
    { id: 'datos', label: 'Tus datos' },
    { id: 'empresa', label: 'Empresa' },
    { id: 'identidad', label: 'Identidad' },
    { id: 'acceso', label: 'Acceso' },
];

/** La tarjeta del login, con su logo. Fuera del componente: si se declarara
 *  adentro, React la montaría de nuevo en cada tecla y los campos perderían el foco. */
function Tarjeta({ children }: { children: React.ReactNode }) {
    return (
        <div className="lp-root">
            <div className="lp-bg" aria-hidden="true" />
            <main className="lp-card">
                <div className="lp-head">
                    <div className="lp-logo" aria-label="Build and Serve">
                        <span className="lp-logo-build">Build</span>
                        <span className="lp-logo-amp">&amp;</span>
                        <span className="lp-logo-serve">Serve</span>
                    </div>
                    <div className="lp-divider" aria-hidden="true" />
                </div>
                {children}
            </main>
        </div>
    );
}

export default function Onboarding() {
    const [searchParams] = useSearchParams();
    const navigate = useNavigate();
    const token = searchParams.get('token') || '';

    const [licencia, setLicencia] = useState<LicenciaValida | null>(null);
    const [validando, setValidando] = useState(true);
    const [enlaceInvalido, setEnlaceInvalido] = useState(false);
    const [paso, setPaso] = useState<Paso>('datos');
    const [enviando, setEnviando] = useState(false);
    const [error, setError] = useState('');
    const [listo, setListo] = useState(false);
    const [ver, setVer] = useState({ password: false, confirmar: false });

    const [empresa, setEmpresa] = useState({ nombre: '', rutEmpresa: '' });
    const [admin, setAdmin] = useState({
        nombre: '', apellidoPaterno: '', apellidoMaterno: '', rut: '', fechaNacimiento: '',
        password: '', confirmarPassword: '',
    });
    const [color, setColor] = useState(DEFAULT_PRIMARY_COLOR);
    const [logo, setLogo] = useState<string | null>(null);
    const [logoError, setLogoError] = useState('');
    const logoInput = useRef<HTMLInputElement>(null);

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

    const datosOk = admin.nombre.trim().length >= 2
        && admin.apellidoPaterno.trim().length >= 2
        && rutValido(admin.rut)
        && fechaOk(admin.fechaNacimiento);
    const empresaOk = empresa.nombre.trim().length >= 3 && rutValido(empresa.rutEmpresa);
    const colorOk = COLOR_HEX.test(color);
    const requisitos = [
        { label: `${MIN_PASSWORD} caracteres o más`, ok: admin.password.length >= MIN_PASSWORD },
        { label: 'Una letra', ok: /[a-zA-Z]/.test(admin.password) },
        { label: 'Un número', ok: /[0-9]/.test(admin.password) },
        { label: 'Coinciden', ok: !!admin.password && admin.password === admin.confirmarPassword },
    ];
    const accesoOk = passwordOk(admin.password) && admin.password === admin.confirmarPassword;

    const indice = PASOS.findIndex((p) => p.id === paso);
    const irA = (p: Paso) => { setError(''); setPaso(p); };

    const onLogo = (file: File | undefined) => {
        if (!file) return;
        if (!file.type.startsWith('image/')) { setLogoError('El logo debe ser una imagen (PNG, JPG, SVG o WebP).'); return; }
        if (file.size > MAX_LOGO_BYTES) { setLogoError('El logo no puede pesar más de 2 MB.'); return; }
        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                setLogo(await compressLogo(e.target?.result as string));
                setLogoError('');
            } catch {
                setLogoError('No se pudo leer la imagen. Prueba con otra.');
            }
        };
        reader.readAsDataURL(file);
    };

    const enviar = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!datosOk || !empresaOk || !accesoOk || enviando) return;
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
                    fechaNacimiento: admin.fechaNacimiento,
                    password: admin.password,
                    confirmarPassword: admin.confirmarPassword,
                },
                identidad: {
                    ...(colorOk ? { colorPrimario: color } : {}),
                    ...(logo ? { logoBase64: logo } : {}),
                },
            });
            if (res.success) {
                setListo(true);
                setTimeout(() => navigate('/login', { replace: true }), 4000);
            } else {
                setError(res.error || 'No se pudo completar el alta');
            }
        } catch {
            setError('Error de conexión con el servidor');
        } finally {
            setEnviando(false);
        }
    };

    // ── Estados sin formulario ────────────────────────────────────────────────
    if (validando) {
        return (
            <Tarjeta>
                <div className="lp-body onb-estado" role="status">
                    <div className="onb-spinner" />
                    <p className="lp-hint">Validando el enlace de activación…</p>
                </div>
            </Tarjeta>
        );
    }

    if (enlaceInvalido || !licencia) {
        return (
            <Tarjeta>
                <div className="lp-body onb-resultado">
                    <span className="onb-resultado-icono onb-resultado-icono--error"><LuLink2Off size={28} /></span>
                    <h1 className="lp-title">Enlace inválido o vencido</h1>
                    <p className="lp-hint">Este enlace de activación ya no sirve. Pide uno nuevo a quien te lo envió.</p>
                    <ul className="onb-caja onb-motivos">
                        <li>Venció antes de usarse.</li>
                        <li>Ya se usó para crear la empresa: si fuiste tú, inicia sesión.</li>
                        <li>Fue anulado por quien lo envió.</li>
                    </ul>
                </div>
                <Link to="/login" className="onb-btn-secundario">Ir al inicio de sesión</Link>
            </Tarjeta>
        );
    }

    if (listo) {
        return (
            <Tarjeta>
                <div className="lp-body onb-resultado">
                    <span className="onb-resultado-icono onb-resultado-icono--ok"><FiCheckCircle size={28} /></span>
                    <h1 className="lp-title">Empresa creada</h1>
                    <p className="lp-hint">Ya puedes entrar con tu RUT y la contraseña que acabas de elegir.</p>
                    <div className="onb-caja onb-resumen">
                        {logo ? (
                            <img src={logo} alt="" className="onb-resumen-logo" />
                        ) : (
                            <span className="onb-mono" style={{ background: color }} aria-hidden="true">{monograma(empresa.nombre)}</span>
                        )}
                        <span className="onb-resumen-info">
                            <span className="onb-resumen-nombre">{empresa.nombre.trim()}</span>
                            <span className="onb-resumen-meta">
                                Administra: {[admin.nombre.trim(), admin.apellidoPaterno.trim()].join(' ')}
                            </span>
                        </span>
                    </div>
                </div>
                <Link to="/login" replace className="lp-submit onb-link-btn">
                    <span>Iniciar sesión</span>
                    <FiArrowRight size={15} />
                </Link>
                <p className="onb-nota">Te llevamos al inicio de sesión en unos segundos…</p>
            </Tarjeta>
        );
    }

    // ── Formulario en cuatro pasos ────────────────────────────────────────────
    const Stepper = (
        <ol className="onb-steps" aria-label="Pasos para activar la empresa">
            {PASOS.map((p, i) => {
                const estado = i < indice ? 'hecho' : i === indice ? 'actual' : 'pendiente';
                return (
                    <li key={p.id} className={`onb-step onb-step--${estado}`} aria-current={estado === 'actual' ? 'step' : undefined}>
                        <span className="onb-step-bar" />
                        <span className="onb-step-label">
                            {estado === 'hecho'
                                ? <FiCheck size={12} strokeWidth={3} aria-label="completado" />
                                : <span className="onb-step-num">{i + 1}.</span>}
                            {p.label}
                        </span>
                    </li>
                );
            })}
        </ol>
    );

    const Pie = (
        <div className="lp-foot">
            {paso === 'datos' ? (
                <Link to="/login" className="lp-foot-link">¿Ya tienes cuenta? Inicia sesión</Link>
            ) : (
                <button type="button" className="lp-foot-link" disabled={enviando}
                    onClick={() => irA(PASOS[indice - 1].id)}>
                    <FiArrowLeft size={14} /> Volver
                </button>
            )}
            <span className="lp-foot-meta">Paso {indice + 1} de {PASOS.length}</span>
        </div>
    );

    const nombreEmpresa = empresa.nombre.trim() || 'Tu empresa';

    return (
        <Tarjeta>
            <div className="lp-body">
                {Stepper}

                {paso === 'datos' && (
                    <>
                        <h1 className="lp-title">Activa tu empresa</h1>
                        <p className="lp-hint">Primero, tus datos: serás quien administre la empresa.</p>
                        <div className="onb-invitacion">
                            <FiMail size={15} aria-hidden="true" />
                            <span>
                                Invitación para <strong>{licencia.email}</strong>
                                {fechaLarga(licencia.expiraEn) && <> · vence el {fechaLarga(licencia.expiraEn)}</>}
                            </span>
                        </div>
                        <form className="lp-form onb-form" noValidate
                            onSubmit={(e) => { e.preventDefault(); if (datosOk) irA('empresa'); }}>
                            <div className="lp-field">
                                <label className="lp-label" htmlFor="onb-nombres">Nombres</label>
                                <input id="onb-nombres" className="lp-input lp-input--plain" type="text" autoFocus
                                    autoComplete="given-name"
                                    value={admin.nombre}
                                    onChange={(e) => setAdmin({ ...admin, nombre: e.target.value })} />
                            </div>
                            <div className="onb-row">
                                <div className="lp-field">
                                    <label className="lp-label" htmlFor="onb-apellido1">Apellido paterno</label>
                                    <input id="onb-apellido1" className="lp-input lp-input--plain" type="text"
                                        autoComplete="family-name"
                                        value={admin.apellidoPaterno}
                                        onChange={(e) => setAdmin({ ...admin, apellidoPaterno: e.target.value })} />
                                </div>
                                <div className="lp-field">
                                    <label className="lp-label" htmlFor="onb-apellido2">
                                        Apellido materno <span className="onb-opcional">· opcional</span>
                                    </label>
                                    <input id="onb-apellido2" className="lp-input lp-input--plain" type="text"
                                        value={admin.apellidoMaterno}
                                        onChange={(e) => setAdmin({ ...admin, apellidoMaterno: e.target.value })} />
                                </div>
                            </div>
                            {/* RUT y fecha son cortos: van lado a lado también en móvil */}
                            <div className="onb-row onb-row--siempre">
                                <div className="lp-field">
                                    <label className="lp-label" htmlFor="onb-rut">Tu RUT</label>
                                    <input id="onb-rut" className="lp-input lp-input--plain" type="text"
                                        value={admin.rut}
                                        onChange={(e) => setAdmin({ ...admin, rut: rutFormat(e.target.value) })}
                                        placeholder="15.111.222-6" />
                                </div>
                                <div className="lp-field">
                                    <label className="lp-label" htmlFor="onb-nacimiento">
                                        <span className="onb-label-largo">Fecha de nacimiento</span>
                                        <span className="onb-label-corto">Nacimiento</span>
                                    </label>
                                    <input id="onb-nacimiento" className="lp-input lp-input--plain" type="date"
                                        autoComplete="bday"
                                        min={FECHA_MINIMA} max={FECHA_MAXIMA}
                                        value={admin.fechaNacimiento}
                                        onChange={(e) => setAdmin({ ...admin, fechaNacimiento: e.target.value })} />
                                </div>
                            </div>
                            {admin.rut && !rutValido(admin.rut) && (
                                <span className="onb-field-hint onb-field-hint--error">El RUT no es válido</span>
                            )}
                            {admin.fechaNacimiento && !fechaOk(admin.fechaNacimiento) && (
                                <span className="onb-field-hint onb-field-hint--error">
                                    Quien administra la empresa debe tener al menos {EDAD_MINIMA} años
                                </span>
                            )}
                            <button type="submit" className="lp-submit" disabled={!datosOk}>
                                <span>Continuar</span><FiArrowRight size={15} />
                            </button>
                        </form>
                    </>
                )}

                {paso === 'empresa' && (
                    <>
                        <h1 className="lp-title">Tu empresa</h1>
                        <p className="lp-hint">Los datos de la empresa que vas a administrar.</p>
                        <form className="lp-form onb-form" noValidate
                            onSubmit={(e) => { e.preventDefault(); if (empresaOk) irA('identidad'); }}>
                            <div className="lp-field">
                                <label className="lp-label" htmlFor="onb-razon">Razón social</label>
                                <input id="onb-razon" className="lp-input lp-input--plain" type="text" autoFocus
                                    autoComplete="organization"
                                    value={empresa.nombre}
                                    onChange={(e) => setEmpresa({ ...empresa, nombre: e.target.value })}
                                    placeholder="Constructora Ejemplo SpA" />
                                {empresa.nombre && empresa.nombre.trim().length < 3 && (
                                    <span className="onb-field-hint">Escribe el nombre completo de la empresa</span>
                                )}
                            </div>
                            <div className="lp-field">
                                <label className="lp-label" htmlFor="onb-rut-empresa">RUT de la empresa</label>
                                <input id="onb-rut-empresa" className="lp-input lp-input--plain" type="text"
                                    value={empresa.rutEmpresa}
                                    onChange={(e) => setEmpresa({ ...empresa, rutEmpresa: rutFormat(e.target.value) })}
                                    placeholder="76.111.999-0" />
                                {empresa.rutEmpresa && !rutValido(empresa.rutEmpresa) && (
                                    <span className="onb-field-hint onb-field-hint--error">El RUT no es válido</span>
                                )}
                            </div>
                            <button type="submit" className="lp-submit" disabled={!empresaOk}>
                                <span>Continuar</span><FiArrowRight size={15} />
                            </button>
                        </form>
                    </>
                )}

                {paso === 'identidad' && (
                    <>
                        <h1 className="lp-title">Identidad de la empresa</h1>
                        <p className="lp-hint">Así verá la plataforma todo tu equipo. Puedes cambiarlo después en Mi empresa.</p>
                        <form className="lp-form onb-form" noValidate
                            onSubmit={(e) => { e.preventDefault(); if (colorOk) irA('acceso'); }}>
                            <div className="lp-field">
                                <span className="lp-label" id="onb-logo-label">
                                    Logo <span className="onb-opcional">· opcional</span>
                                </span>
                                {logo ? (
                                    <div className="onb-logo onb-logo--listo">
                                        <img src={logo} alt="Logo de la empresa" className="onb-logo-img" />
                                        <span className="onb-logo-info">
                                            <span className="onb-logo-titulo">Logo cargado</span>
                                            <button type="button" className="onb-logo-accion" onClick={() => logoInput.current?.click()}>
                                                Cambiar
                                            </button>
                                        </span>
                                        <button type="button" className="onb-logo-quitar" aria-label="Quitar logo"
                                            onClick={() => { setLogo(null); if (logoInput.current) logoInput.current.value = ''; }}>
                                            <FiX size={16} />
                                        </button>
                                    </div>
                                ) : (
                                    <button type="button" className="onb-logo" aria-labelledby="onb-logo-label"
                                        onClick={() => logoInput.current?.click()}
                                        onDragOver={(e) => e.preventDefault()}
                                        onDrop={(e) => { e.preventDefault(); onLogo(e.dataTransfer.files?.[0]); }}>
                                        <span className="onb-logo-icono"><FiUpload size={20} /></span>
                                        <span className="onb-logo-info">
                                            <span className="onb-logo-titulo onb-logo-titulo--accion">Sube el logo de la empresa</span>
                                            <span className="onb-logo-sub">PNG, JPG o SVG, hasta 2 MB. Si no subes uno, se muestra el nombre.</span>
                                        </span>
                                    </button>
                                )}
                                <input ref={logoInput} type="file" accept="image/*" hidden
                                    onChange={(e) => onLogo(e.target.files?.[0])} />
                                {logoError && <span className="onb-field-hint onb-field-hint--error">{logoError}</span>}
                            </div>

                            <fieldset className="onb-colores">
                                <legend className="lp-label">Color principal</legend>
                                <div className="onb-swatches">
                                    {SUGGESTED_COLORS.map((c) => {
                                        const activo = color.toLowerCase() === c.hex;
                                        return (
                                            <button key={c.hex} type="button" className={`onb-swatch${activo ? ' onb-swatch--activo' : ''}`}
                                                style={{ background: c.hex, ['--sw' as string]: c.hex }}
                                                aria-label={c.label} aria-pressed={activo}
                                                onClick={() => setColor(c.hex)}>
                                                {activo && <FiCheck size={15} strokeWidth={3} />}
                                            </button>
                                        );
                                    })}
                                    {/* Otro color: el selector nativo, dentro del mismo cuadrado */}
                                    {(() => {
                                        const propio = !SUGGESTED_COLORS.some((c) => c.hex === color.toLowerCase());
                                        return (
                                            <label className={`onb-swatch onb-swatch--otro${propio ? ' onb-swatch--activo' : ''}`}
                                                style={propio ? { background: color, ['--sw' as string]: color } : undefined}
                                                title="Elegir otro color">
                                                {propio ? <FiCheck size={15} strokeWidth={3} /> : <FiPlus size={15} />}
                                                <input type="color" aria-label="Elegir otro color" value={colorOk ? color : DEFAULT_PRIMARY_COLOR}
                                                    onChange={(e) => setColor(e.target.value)} />
                                            </label>
                                        );
                                    })()}
                                </div>
                            </fieldset>

                            <div className="lp-field">
                                <span className="lp-label">Vista previa</span>
                                <div className="onb-preview" aria-hidden="true" style={{ ['--marca' as string]: color }}>
                                    <div className="onb-preview-top">
                                        <span className="onb-preview-marca">
                                            {logo
                                                ? <img src={logo} alt="" className="onb-preview-logo" />
                                                : <><span className="onb-preview-mono">{monograma(nombreEmpresa)}</span>{nombreEmpresa}</>}
                                        </span>
                                        <span className="onb-preview-btn">Nueva actividad</span>
                                    </div>
                                    <div className="onb-preview-tabs">
                                        <span className="onb-preview-tab onb-preview-tab--activa">Inicio</span>
                                        <span className="onb-preview-tab">Personas</span>
                                        <span className="onb-preview-tab">Actividades</span>
                                    </div>
                                </div>
                            </div>

                            <button type="submit" className="lp-submit" disabled={!colorOk}>
                                <span>Continuar</span><FiArrowRight size={15} />
                            </button>
                        </form>
                    </>
                )}

                {paso === 'acceso' && (
                    <>
                        <h1 className="lp-title">Tu acceso</h1>
                        <p className="lp-hint">Entrarás con tu RUT y la contraseña que elijas aquí.</p>
                        <form className="lp-form onb-form" onSubmit={enviar} noValidate>
                            <div className="lp-field">
                                <label className="lp-label" htmlFor="onb-correo">Correo</label>
                                <div className="lp-input-wrap">
                                    <span className="lp-input-icon"><FiMail size={15} /></span>
                                    <input id="onb-correo" className="lp-input onb-input-fijo" type="email" readOnly
                                        value={licencia.email} />
                                    <span className="onb-input-candado"><FiLock size={15} /></span>
                                </div>
                                <span className="onb-field-hint">Es el correo de la invitación; no se puede cambiar.</span>
                            </div>
                            {/* Oculto: le dice al gestor de contraseñas con qué usuario guardarla */}
                            <input type="text" autoComplete="username" value={admin.rut} readOnly hidden />
                            <div className="onb-row">
                                <div className="lp-field">
                                    <label className="lp-label" htmlFor="onb-password">Contraseña</label>
                                    <div className="lp-input-wrap">
                                        <span className="lp-input-icon"><FiLock size={15} /></span>
                                        <input id="onb-password" className="lp-input lp-input--password" autoFocus
                                            type={ver.password ? 'text' : 'password'} autoComplete="new-password"
                                            value={admin.password}
                                            onChange={(e) => setAdmin({ ...admin, password: e.target.value })} />
                                        <button type="button" className="lp-eye-btn"
                                            onClick={() => setVer({ ...ver, password: !ver.password })}
                                            aria-label={ver.password ? 'Ocultar contraseña' : 'Mostrar contraseña'}>
                                            {ver.password ? <FiEyeOff size={15} /> : <FiEye size={15} />}
                                        </button>
                                    </div>
                                </div>
                                <div className="lp-field">
                                    <label className="lp-label" htmlFor="onb-password2">Repite la contraseña</label>
                                    <div className="lp-input-wrap">
                                        <span className="lp-input-icon"><FiLock size={15} /></span>
                                        <input id="onb-password2" className="lp-input lp-input--password"
                                            type={ver.confirmar ? 'text' : 'password'} autoComplete="new-password"
                                            value={admin.confirmarPassword}
                                            onChange={(e) => setAdmin({ ...admin, confirmarPassword: e.target.value })} />
                                        <button type="button" className="lp-eye-btn"
                                            onClick={() => setVer({ ...ver, confirmar: !ver.confirmar })}
                                            aria-label={ver.confirmar ? 'Ocultar contraseña' : 'Mostrar contraseña'}>
                                            {ver.confirmar ? <FiEyeOff size={15} /> : <FiEye size={15} />}
                                        </button>
                                    </div>
                                </div>
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

                            {error && <p className="lp-error" role="alert">{error}</p>}

                            <button type="submit" className="lp-submit" disabled={!accesoOk || enviando}>
                                {enviando ? <div className="lp-spinner" /> : <><span>Crear empresa</span><FiCheck size={15} /></>}
                            </button>
                        </form>
                    </>
                )}
            </div>
            {Pie}
        </Tarjeta>
    );
}

