import { useState, useRef, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { personasApi } from '../api/client';
import PinCasillas from '../components/PinCasillas';
import {
    FiAlertCircle, FiArrowLeft, FiArrowRight, FiCamera, FiCheck, FiClock, FiEdit2, FiEye, FiEyeOff,
    FiKey, FiLogOut, FiPhone, FiShield, FiX,
} from 'react-icons/fi';
import '../css/AuthCard.css';
import { monograma } from '../utils/identidadEmpresa';

/**
 * Enrolamiento: la persona crea su firma digital (PIN de 4 dígitos) y,
 * opcionalmente, completa su perfil. Es obligatorio en el primer ingreso, así
 * que va en la tarjeta del login, a pantalla completa.
 *
 * También sirve para cambiar el PIN desde Configuración (`state.changePin`):
 * entonces pide el PIN actual —si lo hay—, el nuevo y su confirmación, y omite
 * la bienvenida y el perfil.
 */

type EnrollmentStep = 'welcome' | 'current-pin' | 'create-pin' | 'confirm-pin' | 'profile' | 'success';

const ROL_LABEL: Record<string, string> = {
    admin: 'Administrador',
    jefe_obra: 'Jefe de Obra',
    supervisor: 'Supervisor',
    prevencionista: 'Prevencionista',
    trabajador: 'Trabajador',
};

function resizeImageToBase64(file: File, maxSize = 256): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                const scale = Math.min(maxSize / img.width, maxSize / img.height, 1);
                canvas.width = img.width * scale;
                canvas.height = img.height * scale;
                const ctx = canvas.getContext('2d')!;
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                resolve(canvas.toDataURL('image/jpeg', 0.82));
            };
            img.onerror = reject;
            img.src = e.target!.result as string;
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

/** La tarjeta del login. Fuera del componente para no remontarla en cada tecla. */
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

export default function EnrollMe() {
    const { user, updateUser, logout } = useAuth();
    const navigate = useNavigate();
    const location = useLocation();

    // Modo "cambio de PIN": el usuario ya está enrolado y sólo quiere actualizar su PIN.
    // Llega desde Configuración → "Cambiar PIN". Omite la bienvenida y el paso de perfil.
    const isChangePin = Boolean((location.state as any)?.changePin);
    // Cambiar un PIN existente exige el actual (lo verifica el servidor, con
    // límite de intentos). Sin PIN —porque se lo restablecieron— se crea directo.
    const tienePin = Boolean((user as any)?.pinConfigurado);
    const pasoInicialCambio: EnrollmentStep = tienePin ? 'current-pin' : 'create-pin';

    const [currentStep, setCurrentStep] = useState<EnrollmentStep>(isChangePin ? pasoInicialCambio : 'welcome');
    const [pin, setPin] = useState('');
    const [pinConfirmacion, setPinConfirmacion] = useState('');
    const [pinActual, setPinActual] = useState('');
    const [verPin, setVerPin] = useState(false);
    const [error, setError] = useState('');
    const [noCoincide, setNoCoincide] = useState(false);
    const [procesando, setProcesando] = useState(false);
    const [enrollmentData, setEnrollmentData] = useState<any>(null);

    // Si el usuario ya está enrolado (ej. recargó en el paso de perfil), saltar directo ahí.
    // En modo cambio de PIN NO redirigimos: el usuario debe poder fijar un nuevo PIN.
    useEffect(() => {
        if (!isChangePin && (user as any)?.habilitado === true) {
            setCurrentStep('profile');
        }
    }, [user, isChangePin]);

    // Profile step state
    const [fotoPerfil, setFotoPerfil] = useState<string | null>(null);
    const [telefono, setTelefono] = useState('');
    const [profileSaving, setProfileSaving] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const irA = (paso: EnrollmentStep) => {
        setError('');
        setNoCoincide(false);
        setVerPin(false);
        setCurrentStep(paso);
    };

    const handleTelefonoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const digits = e.target.value.replace(/\D/g, '').slice(0, 9);
        let fmt = digits;
        if (digits.length > 5) fmt = digits[0] + ' ' + digits.slice(1, 5) + ' ' + digits.slice(5);
        else if (digits.length > 1) fmt = digits[0] + ' ' + digits.slice(1);
        setTelefono(fmt);
    };

    // Tras un PIN que no coincide, las casillas muestran el error un momento y
    // se vacían solas para reintentar. Mientras tanto se ignora lo que se escriba.
    const reintentando = useRef(false);

    const confirmarPin = async (confirmedPin: string) => {
        if (confirmedPin !== pin) {
            setNoCoincide(true);
            reintentando.current = true;
            setTimeout(() => {
                reintentando.current = false;
                setPinConfirmacion('');
            }, 750);
            return;
        }

        setError('');
        setNoCoincide(false);
        setProcesando(true);

        try {
            const targetId = (user as any)?.personaId || user?.userId;
            const targetTenant = (user as any)?.tenantId || (user as any)?.empresaId;

            if (!targetId || !targetTenant) throw new Error('Usuario o Tenant no encontrado en la sesión');

            const setPinResponse = await personasApi.setPin(targetTenant, targetId, pin, isChangePin && pinActual ? pinActual : undefined);
            setPinActual('');
            if (!setPinResponse.success) throw new Error(setPinResponse.error || 'Error al configurar el PIN');

            // Modo cambio de PIN: el usuario ya estaba enrolado. Omitimos el paso de
            // perfil y completarEnrolamiento; vamos directo a la confirmación de éxito.
            if (isChangePin) {
                setPin('');
                updateUser({ pinConfigurado: true, pinRestablecido: null } as any);
                irA('success');
                setTimeout(() => navigate('/configuracion', { replace: true }), 3000);
                return;
            }

            const enrollResponse = await personasApi.completarEnrolamiento(targetTenant, targetId, pin);
            if (!enrollResponse.success || !enrollResponse.data) throw new Error(enrollResponse.error || 'Error al completar el enrolamiento');

            updateUser({ habilitado: true });
            setEnrollmentData(enrollResponse.data);
            irA('profile');
        } catch (err) {
            console.error('Error en enrolamiento:', err);
            const mensaje = err instanceof Error ? err.message : 'Error desconocido';
            // En cambio de PIN se vuelve a empezar: el PIN actual ya se usó (y pudo
            // ser el incorrecto), así que se pide de nuevo si corresponde.
            setPinActual('');
            setPinConfirmacion('');
            if (isChangePin) {
                setPin('');
                irA(pasoInicialCambio);
            }
            setError(mensaje);
        } finally {
            setProcesando(false);
        }
    };

    const handleImageChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        try {
            const base64 = await resizeImageToBase64(file, 256);
            setFotoPerfil(base64);
        } catch {
            // silently ignore resize errors
        }
    };

    const saveProfileAndContinue = async (skip = false) => {
        setProfileSaving(true);
        try {
            const targetId = (user as any)?.personaId || user?.userId;
            const targetTenant = (user as any)?.tenantId || (user as any)?.empresaId;

            if (targetId && targetTenant && !skip) {
                const updates: Record<string, any> = {};
                if (fotoPerfil) updates.fotoPerfil = fotoPerfil;
                const telefonoFull = telefono.replace(/\D/g, '').length >= 9
                    ? `+56 ${telefono}`
                    : '';
                if (telefonoFull) updates.telefono = telefonoFull;

                if (Object.keys(updates).length > 0) {
                    await personasApi.update(targetTenant, targetId, updates);
                    updateUser({ fotoPerfil: fotoPerfil || undefined, telefono: telefonoFull || undefined });
                }
            }
        } catch {
            // non-blocking — profile update failure shouldn't block enrollment
        } finally {
            setProfileSaving(false);
            irA('success');
        }
    };

    // ── Datos para la credencial ──────────────────────────────────────────────
    const nombreCompleto = [user?.nombre, user?.apellidoPaterno || user?.apellido].filter(Boolean).join(' ');
    const empresa = user?.empresaNombre || '';
    const rolLabel = ROL_LABEL[user?.rol as string] ?? (user?.rol || '');
    const logoEmpresa = user?.branding?.logoUrl || null;

    // ── Pasos ─────────────────────────────────────────────────────────────────
    const pasos: { id: EnrollmentStep; label: string }[] = isChangePin
        ? [
            ...(tienePin ? [{ id: 'current-pin' as const, label: 'PIN actual' }] : []),
            { id: 'create-pin', label: 'Nuevo PIN' },
            { id: 'confirm-pin', label: 'Confirmar' },
        ]
        : [
            { id: 'welcome', label: 'Bienvenida' },
            { id: 'create-pin', label: 'Tu PIN' },
            { id: 'confirm-pin', label: 'Confirmar' },
            { id: 'profile', label: 'Perfil' },
        ];
    const indice = pasos.findIndex((p) => p.id === currentStep);

    const Stepper = (
        <ol className="onb-steps" style={{ gridTemplateColumns: `repeat(${pasos.length}, minmax(0, 1fr))` }}
            aria-label={isChangePin ? 'Pasos para cambiar el PIN' : 'Pasos del enrolamiento'}>
            {pasos.map((p, i) => {
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

    const Pie = ({ izquierda }: { izquierda: React.ReactNode }) => (
        <div className="lp-foot">
            {izquierda}
            <span className="lp-foot-meta">Paso {indice + 1} de {pasos.length}</span>
        </div>
    );

    const Volver = ({ onClick, texto = 'Volver' }: { onClick: () => void; texto?: string }) => (
        <button type="button" className="lp-foot-link" onClick={onClick} disabled={procesando}>
            <FiArrowLeft size={14} /> {texto}
        </button>
    );

    const MostrarPin = (
        <button type="button" className="enr-mostrar" onClick={() => setVerPin((v) => !v)} aria-pressed={verPin}>
            {verPin ? <FiEyeOff size={14} /> : <FiEye size={14} />} {verPin ? 'Ocultar PIN' : 'Mostrar PIN'}
        </button>
    );

    const ErrorServidor = error ? <p className="lp-error enr-error-servidor" role="alert">{error}</p> : null;

    // ── Éxito ─────────────────────────────────────────────────────────────────
    if (currentStep === 'success') {
        const firma = enrollmentData?.firma;
        return (
            <Tarjeta>
                <div className="lp-body onb-resultado">
                    <span className="onb-resultado-icono onb-resultado-icono--ok"><FiEdit2 size={26} /></span>
                    <h1 className="lp-title">{isChangePin ? 'PIN actualizado' : 'Tu firma está lista'}</h1>
                    <p className="lp-hint">
                        {isChangePin
                            ? 'Desde ahora firmas con tu nuevo PIN. Te llevamos a Configuración…'
                            : 'Desde ahora puedes firmar charlas, entregas de EPP y documentos con tu PIN.'}
                    </p>
                    {firma && (
                        <dl className="onb-caja enr-firma">
                            <div><dt>Firmante</dt><dd>{nombreCompleto}{user?.rut ? ` · ${user.rut}` : ''}</dd></div>
                            {firma.fecha && <div><dt>Fecha</dt><dd>{firma.fecha}</dd></div>}
                            {firma.horario && <div><dt>Hora</dt><dd>{firma.horario}</dd></div>}
                            {firma.token && <div><dt>Código</dt><dd className="enr-firma-codigo">{firma.token}</dd></div>}
                        </dl>
                    )}
                </div>
                <button type="button" className="lp-submit onb-link-btn enr-final"
                    onClick={() => navigate(isChangePin ? '/configuracion' : '/', { replace: true })}>
                    <span>{isChangePin ? 'Volver a Configuración' : 'Ir al inicio'}</span>
                    <FiArrowRight size={15} />
                </button>
            </Tarjeta>
        );
    }

    return (
        <Tarjeta>
            <div className="lp-body">
                {Stepper}

                {/* ── Bienvenida: la credencial que se va a crear ── */}
                {currentStep === 'welcome' && (
                    <>
                        <h1 className="lp-title">Crea tu firma digital</h1>
                        <p className="lp-hint">
                            Hola{user?.nombre ? `, ${user.nombre}` : ''}. Con tu firma apruebas charlas, entregas de EPP y documentos en la obra.
                        </p>

                        <div className="enr-credencial" role="img"
                            aria-label={`Tu credencial de firma digital${empresa ? ` en ${empresa}` : ''}`}>
                            <div className="enr-credencial-top">
                                <span className="enr-credencial-empresa">
                                    {logoEmpresa ? (
                                        <img src={logoEmpresa} alt="" className="enr-credencial-logo" />
                                    ) : empresa ? (
                                        <span className="enr-credencial-mono">{monograma(empresa)}</span>
                                    ) : null}
                                    {empresa && <span className="enr-credencial-empresa-nombre">{empresa}</span>}
                                </span>
                                <span className="enr-credencial-sello"><FiEdit2 size={11} /> Firma digital</span>
                            </div>
                            <div className="enr-credencial-persona">
                                <span className="enr-credencial-nombre">{nombreCompleto}</span>
                                <span className="enr-credencial-meta">
                                    {[user?.rut ? `RUT ${user.rut}` : null, rolLabel || null].filter(Boolean).join(' · ')}
                                </span>
                            </div>
                            <div className="enr-credencial-pin">
                                <span className="enr-credencial-pin-label">PIN de firma</span>
                                <span className="enr-credencial-slots" aria-hidden="true">
                                    <span /><span /><span /><span />
                                </span>
                            </div>
                        </div>

                        <ul className="enr-datos">
                            <li><FiKey size={17} /><strong>4 dígitos</strong><span>que solo tú eliges</span></li>
                            <li><FiShield size={17} /><strong>Cifrada</strong><span>nadie más puede verla</span></li>
                            <li><FiClock size={17} /><strong>1 minuto</strong><span>y queda lista</span></li>
                        </ul>

                        <button type="button" className="lp-submit enr-accion" onClick={() => irA('create-pin')}>
                            <span>Comenzar</span><FiArrowRight size={15} />
                        </button>
                    </>
                )}

                {/* ── PIN actual (solo al cambiar uno existente) ── */}
                {currentStep === 'current-pin' && (
                    <form noValidate onSubmit={(e) => { e.preventDefault(); if (pinActual.length === 4) irA('create-pin'); }}>
                        <h1 className="lp-title">Ingresa tu PIN actual</h1>
                        <p className="lp-hint">Para cambiarlo, primero confirma que eres tú.</p>
                        <PinCasillas id="enr-pin-actual" value={pinActual} onChange={setPinActual}
                            visible={verPin} autoFocus ariaLabel="PIN actual" />
                        {MostrarPin}
                        {ErrorServidor}
                        <button type="submit" className="lp-submit enr-accion" disabled={pinActual.length < 4}>
                            <span>Continuar</span><FiArrowRight size={15} />
                        </button>
                    </form>
                )}

                {/* ── Elegir PIN ── */}
                {currentStep === 'create-pin' && (
                    <form noValidate onSubmit={(e) => { e.preventDefault(); if (pin.length === 4) { setPinConfirmacion(''); irA('confirm-pin'); } }}>
                        <h1 className="lp-title">{isChangePin ? 'Elige tu nuevo PIN' : 'Elige tu PIN'}</h1>
                        <p className="lp-hint">
                            {isChangePin ? '4 dígitos, distintos al PIN actual.' : '4 dígitos que recuerdes. Lo usarás cada vez que firmes.'}
                        </p>
                        <PinCasillas id="enr-pin" value={pin} onChange={setPin} visible={verPin} autoFocus
                            ariaLabel="Nuevo PIN de 4 dígitos" />
                        {MostrarPin}
                        <p className="enr-consejo"><FiShield size={14} /> Evita 1234, 0000 o tu año de nacimiento.</p>
                        {ErrorServidor}
                        <button type="submit" className="lp-submit enr-accion" disabled={pin.length < 4}>
                            <span>Continuar</span><FiArrowRight size={15} />
                        </button>
                    </form>
                )}

                {/* ── Repetir PIN: se revisa al escribir el cuarto dígito ── */}
                {currentStep === 'confirm-pin' && (
                    <>
                        <h1 className="lp-title">Repite tu PIN</h1>
                        <p className="lp-hint">Para asegurarnos de que lo recuerdas.</p>
                        <PinCasillas id="enr-pin-confirmar" value={pinConfirmacion} autoFocus
                            onChange={(v) => { if (!reintentando.current) setPinConfirmacion(v); }}
                            onComplete={(v) => { if (!reintentando.current) confirmarPin(v); }}
                            visible={verPin} error={noCoincide && pinConfirmacion.length === 4} disabled={procesando}
                            ariaLabel="Repite tu PIN" />
                        {noCoincide ? (
                            <>
                                {/* El aviso queda mientras se reintenta; las casillas ya se vaciaron solas */}
                                <p className="enr-no-coincide" role="alert">
                                    <FiAlertCircle size={15} /> No coincide. Inténtalo de nuevo.
                                </p>
                                <button type="button" className="enr-link enr-otro-pin"
                                    onClick={() => { setPin(''); setPinConfirmacion(''); irA('create-pin'); }}>
                                    Elegir otro PIN
                                </button>
                            </>
                        ) : procesando ? (
                            <p className="enr-procesando" role="status">
                                <span className="onb-spinner" /> {isChangePin ? 'Actualizando tu PIN…' : 'Creando tu firma digital…'}
                            </p>
                        ) : (
                            <>
                                {MostrarPin}
                                {ErrorServidor}
                            </>
                        )}
                    </>
                )}

                {/* ── Perfil (opcional) ── */}
                {currentStep === 'profile' && (
                    <form noValidate onSubmit={(e) => { e.preventDefault(); saveProfileAndContinue(false); }}>
                        <h1 className="lp-title">Completa tu perfil</h1>
                        <p className="lp-hint">Así te reconocen en las cuadrillas y te pueden contactar en obra. Puedes hacerlo después.</p>

                        <div className="enr-foto">
                            <button type="button" className={`enr-foto-circulo${fotoPerfil ? ' enr-foto-circulo--lista' : ''}`}
                                onClick={() => fileInputRef.current?.click()}
                                aria-label={fotoPerfil ? 'Cambiar foto de perfil' : 'Subir foto de perfil'}>
                                {fotoPerfil ? <img src={fotoPerfil} alt="" /> : <FiCamera size={24} />}
                            </button>
                            <span className="enr-foto-info">
                                <button type="button" className="enr-link enr-foto-accion" onClick={() => fileInputRef.current?.click()}>
                                    {fotoPerfil ? 'Cambiar foto' : 'Subir una foto'}
                                </button>
                                {fotoPerfil ? (
                                    <button type="button" className="enr-foto-quitar" onClick={() => setFotoPerfil(null)}>
                                        <FiX size={13} /> Quitar
                                    </button>
                                ) : (
                                    <span className="enr-foto-sub">Una foto de tu cara, con buena luz. JPG o PNG.</span>
                                )}
                            </span>
                            <input ref={fileInputRef} type="file" accept="image/*" hidden onChange={handleImageChange} />
                        </div>

                        <div className="lp-field enr-telefono">
                            <label className="lp-label" htmlFor="enr-telefono">Teléfono móvil</label>
                            <div className="enr-telefono-campo">
                                <span className="enr-telefono-prefijo"><FiPhone size={14} /> +56</span>
                                <input id="enr-telefono" type="tel" inputMode="tel" autoComplete="tel-national"
                                    placeholder="9 1234 5678" value={telefono} onChange={handleTelefonoChange} />
                            </div>
                        </div>

                        <button type="submit" className="lp-submit enr-accion" disabled={profileSaving}>
                            {profileSaving ? <div className="lp-spinner" /> : <><span>Guardar y terminar</span><FiCheck size={15} /></>}
                        </button>
                        <button type="button" className="enr-omitir" disabled={profileSaving}
                            onClick={() => saveProfileAndContinue(true)}>
                            Omitir por ahora
                        </button>
                    </form>
                )}
            </div>

            {currentStep === 'welcome' && (
                <Pie izquierda={
                    <button type="button" className="lp-foot-link enr-salir" onClick={() => logout()}>
                        <FiLogOut size={14} /> Cerrar sesión
                    </button>
                } />
            )}
            {currentStep === 'current-pin' && (
                <Pie izquierda={<Volver texto="Cancelar" onClick={() => navigate('/configuracion')} />} />
            )}
            {currentStep === 'create-pin' && (
                <Pie izquierda={<Volver
                    texto={isChangePin && !tienePin ? 'Cancelar' : 'Volver'}
                    onClick={() => isChangePin
                        ? (tienePin ? irA('current-pin') : navigate('/configuracion'))
                        : irA('welcome')} />} />
            )}
            {currentStep === 'confirm-pin' && (
                <Pie izquierda={<Volver onClick={() => { setPinConfirmacion(''); irA('create-pin'); }} />} />
            )}
            {currentStep === 'profile' && (
                <Pie izquierda={<span className="enr-firma-creada"><FiCheck size={14} strokeWidth={2.5} /> Firma digital creada</span>} />
            )}
        </Tarjeta>
    );
}
