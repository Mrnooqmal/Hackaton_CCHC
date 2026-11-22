import { useState, useRef, useEffect } from 'react';
import { mensajeDeError } from '../api/client';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { personasApi } from '../api/client';
import PinCasillas from '../components/PinCasillas';
import AvisoPrivacidad from '../components/gobernanza/AvisoPrivacidad';
import { privacidadApi, type FinalidadConsentimiento } from '../api/gobernanza.api';
import { LARGO_PIN } from '../utils/pin';
import {
    FiAlertCircle, FiArrowLeft, FiArrowRight, FiCamera, FiCheck, FiClock, FiEdit2, FiEye, FiEyeOff,
    FiChevronRight, FiKey, FiLogOut, FiShield, FiX,
} from 'react-icons/fi';
import '../css/AuthCard.css';
import { useBloqueoAyuda } from '../ayuda/useBloqueoAyuda';
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

type EnrollmentStep = 'welcome' | 'aviso' | 'current-pin' | 'create-pin' | 'confirm-pin' | 'profile' | 'success';

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
function Tarjeta({ children, fija = false }: { children: React.ReactNode; fija?: boolean }) {
    return (
        <div className="lp-root">
            <div className="lp-bg" aria-hidden="true" />
            <main className={`lp-card${fija ? ' lp-card--fija enr-card-aviso' : ''}`}>
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
    // Enrolamiento y cambio de PIN: flujo de firma, sin recorridos encima.
    useBloqueoAyuda(true);

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
    const [profileSaving, setProfileSaving] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // La foto de perfil depende del consentimiento `foto_perfil` (Ley 21.719):
    // sin él, el servidor rechaza la foto. Se trae el texto vigente para
    // mostrarlo aquí mismo; la casilla parte sin marcar (el silencio no es
    // consentimiento).
    const [consentFoto, setConsentFoto] = useState<FinalidadConsentimiento | null>(null);
    const [autorizaFoto, setAutorizaFoto] = useState(false);
    useEffect(() => {
        if (currentStep !== 'profile' || consentFoto) return;
        privacidadApi.consentimientos().then((r) => {
            const f = r.success ? r.data?.finalidades.find((x) => x.finalidad === 'foto_perfil') : undefined;
            if (f) setConsentFoto(f);
        }).catch(() => { /* se reintenta al guardar */ });
    }, [currentStep, consentFoto]);
    const fotoRequiereConsentimiento = !!fotoPerfil && !consentFoto?.vigente;

    const irA = (paso: EnrollmentStep) => {
        setError('');
        setNoCoincide(false);
        setVerPin(false);
        setCurrentStep(paso);
        window.scrollTo(0, 0);
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
            const mensaje = mensajeDeError(err, 'Error desconocido');
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
        if (skip) { irA('success'); return; }

        const targetId = (user as any)?.personaId || user?.userId;
        const targetTenant = (user as any)?.tenantId || (user as any)?.empresaId;
        if (!targetId || !targetTenant) { irA('success'); return; }

        if (fotoRequiereConsentimiento && !autorizaFoto) {
            setError('Para guardar tu foto, marca la autorización. Si prefieres no darla, quita la foto.');
            return;
        }

        setError('');
        setProfileSaving(true);
        try {
            // 1. Consentimiento antes que la foto: el servidor exige que esté vigente.
            if (fotoRequiereConsentimiento) {
                let f = consentFoto;
                if (!f) {
                    const r = await privacidadApi.consentimientos();
                    f = (r.success && r.data?.finalidades.find((x) => x.finalidad === 'foto_perfil')) || null;
                    if (!f) throw new Error(r.error || 'No se pudo cargar el texto de autorización de la foto.');
                    setConsentFoto(f);
                }
                if (!f.vigente) {
                    const r = await privacidadApi.otorgar('foto_perfil', f.version);
                    if (!r.success || !r.data) throw new Error(r.error || 'No se pudo guardar tu autorización para la foto.');
                    setConsentFoto(r.data);
                }
            }

            // 2. Perfil.
            const updates: Record<string, any> = {};
            if (fotoPerfil) updates.fotoPerfil = fotoPerfil;

            if (Object.keys(updates).length > 0) {
                const r = await personasApi.update(targetTenant, targetId, updates);
                if (!r.success) throw new Error(r.error || 'No se pudo guardar tu perfil.');
                updateUser({ fotoPerfil: fotoPerfil || undefined });
            }
            irA('success');
        } catch (err) {
            // Se queda en el paso: puede reintentar u omitir. Antes el error se
            // ocultaba y el perfil quedaba sin guardar sin que la persona lo supiera.
            setError(mensajeDeError(err, 'No se pudo guardar tu perfil.'));
        } finally {
            setProfileSaving(false);
        }
    };

    // ── Datos para la credencial ──────────────────────────────────────────────
    const nombreCompleto = [user?.nombre, user?.apellidoPaterno || user?.apellido].filter(Boolean).join(' ');
    const empresa = user?.empresaNombre || '';
    const rolLabel = ROL_LABEL[user?.rol as string] ?? (user?.rol || '');
    const logoEmpresa = user?.branding?.logoOscuroUrl || user?.branding?.logoUrl || null; // la credencial es navy

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
        <Tarjeta fija={currentStep === 'aviso'}>
            <div className="lp-body">
                {currentStep !== 'aviso' && Stepper}

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
                                    {Array.from({ length: LARGO_PIN }, (_, i) => <span key={i} />)}
                                </span>
                            </div>
                        </div>

                        <ul className="enr-datos">
                            <li><FiKey size={17} /><strong>{LARGO_PIN} dígitos</strong><span>que solo tú eliges</span></li>
                            <li><FiShield size={17} /><strong>Cifrada</strong><span>nadie más puede verla</span></li>
                            <li><FiClock size={17} /><strong>1 minuto</strong><span>y queda lista</span></li>
                        </ul>

                        {/* Deber de información (Ley 21.719): antes de crear la firma. */}
                        <button type="button" className="enr-aviso-enlace" onClick={() => irA('aviso')}>
                            <FiShield size={15} />
                            <span>Cómo se tratan tus datos</span>
                            <FiChevronRight size={15} />
                        </button>

                        <button type="button" className="lp-submit enr-accion" onClick={() => irA('create-pin')}>
                            <span>Comenzar</span><FiArrowRight size={15} />
                        </button>
                    </>
                )}

                {/* ── Aviso de privacidad completo; vuelve a la bienvenida ── */}
                {currentStep === 'aviso' && (
                    <>
                        <h1 className="lp-title">Cómo se tratan tus datos</h1>
                        <p className="lp-hint">Lo que tu empresa hace con tus datos personales y cuáles son tus derechos.</p>
                        <div className="enr-aviso" role="region" aria-label="Aviso de privacidad" tabIndex={0}>
                            <AvisoPrivacidad />
                        </div>
                    </>
                )}

                {/* ── PIN actual (solo al cambiar uno existente) ── */}
                {currentStep === 'current-pin' && (
                    <form noValidate onSubmit={(e) => { e.preventDefault(); if (pinActual.length === LARGO_PIN) irA('create-pin'); }}>
                        <h1 className="lp-title">Ingresa tu PIN actual</h1>
                        <p className="lp-hint">Para cambiarlo, primero confirma que eres tú.</p>
                        <PinCasillas id="enr-pin-actual" value={pinActual} onChange={setPinActual}
                            visible={verPin} autoFocus ariaLabel="PIN actual" />
                        {MostrarPin}
                        {ErrorServidor}
                        <button type="submit" className="lp-submit enr-accion" disabled={pinActual.length < LARGO_PIN}>
                            <span>Continuar</span><FiArrowRight size={15} />
                        </button>
                    </form>
                )}

                {/* ── Elegir PIN ── */}
                {currentStep === 'create-pin' && (
                    <form noValidate onSubmit={(e) => { e.preventDefault(); if (pin.length === LARGO_PIN) { setPinConfirmacion(''); irA('confirm-pin'); } }}>
                        <h1 className="lp-title">{isChangePin ? 'Elige tu nuevo PIN' : 'Elige tu PIN'}</h1>
                        <p className="lp-hint">
                            {isChangePin ? `${LARGO_PIN} dígitos, distintos al PIN actual.` : `${LARGO_PIN} dígitos que recuerdes. Lo usarás cada vez que firmes.`}
                        </p>
                        <PinCasillas id="enr-pin" value={pin} onChange={setPin} visible={verPin} autoFocus
                            ariaLabel={`Nuevo PIN de ${LARGO_PIN} dígitos`} />
                        {MostrarPin}
                        <p className="enr-consejo"><FiShield size={14} /> Evita 1234, 0000 o tu año de nacimiento.</p>
                        {ErrorServidor}
                        <button type="submit" className="lp-submit enr-accion" disabled={pin.length < LARGO_PIN}>
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
                            visible={verPin} error={noCoincide && pinConfirmacion.length === LARGO_PIN} disabled={procesando}
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
                                    <button type="button" className="enr-foto-quitar" onClick={() => { setFotoPerfil(null); setAutorizaFoto(false); setError(''); }}>
                                        <FiX size={13} /> Quitar
                                    </button>
                                ) : (
                                    <span className="enr-foto-sub">Una foto de tu cara, con buena luz. JPG o PNG.</span>
                                )}
                            </span>
                            <input ref={fileInputRef} type="file" accept="image/*" hidden onChange={handleImageChange} />
                        </div>

                        {fotoRequiereConsentimiento && (
                            <div className="enr-consent">
                                <p className="enr-consent-texto">
                                    {consentFoto?.texto ?? 'Cargando el texto de autorización…'}
                                </p>
                                <label className="enr-consent-check">
                                    <input type="checkbox" className="checkbox-input custom-checkbox"
                                        checked={autorizaFoto} disabled={!consentFoto}
                                        onChange={(e) => { setAutorizaFoto(e.target.checked); setError(''); }} />
                                    <span>Leí el texto y autorizo que se muestre mi foto de perfil</span>
                                </label>
                                <p className="enr-consent-nota">Puedes revocarlo cuando quieras en Mis datos y privacidad.</p>
                            </div>
                        )}

                        {ErrorServidor}

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
            {currentStep === 'aviso' && (
                <div className="lp-foot">
                    <Volver onClick={() => irA('welcome')} />
                </div>
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
