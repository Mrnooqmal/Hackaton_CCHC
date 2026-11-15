import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { LARGO_PIN } from '../../utils/pin';
import {
    FiAlertCircle, FiArrowRight, FiCheck, FiDelete, FiEdit3, FiEye, FiEyeOff,
    FiFileText, FiLock, FiPause, FiPlay,
} from 'react-icons/fi';
import { Modal } from '../ui';
import { LecturaActivaContext, type LecturaActiva } from '../lecturaActiva';

/**
 * El modal de "Mis firmas", compartido (también firma encuestas).
 *
 * Se lee como una secuencia de tres pasos: 1) revisar lo que se firma (lo
 * arma quien lo usa, por `children`), 2) declarar que se revisó y 3) el PIN.
 * La declaración era un checkbox suelto al pie de la columna y se pasaba por
 * alto; ahora es un paso con su número, y el PIN se habilita al marcarla.
 * El aviso de que no se puede deshacer va en el pie, junto al botón que firma.
 *
 * En el celular (≤ 640 px) es pantalla completa en dos fases, sin scroll:
 *   - Revisar: lo que se firma y la declaración; "Continuar a firmar".
 *   - Firmar: lo revisado se pliega a una línea y aparece el PIN con teclado
 *     propio. El teclado del sistema tapaba media pantalla y empujaba el botón
 *     de firmar fuera de la vista.
 * Diseño: canvas "BuildAndServe — diseños de interfaz", artboards FirmaV2*.
 */

export interface FichaFirmaItem {
    label: string;
    valor: ReactNode;
    full?: boolean;
}

/** Ficha de datos en dos columnas: lo que se firma, o una firma ya hecha. */
export function FichaFirma({ items }: { items: FichaFirmaItem[] }) {
    return (
        <dl className="msig-ficha">
            {items.map((it) => (
                <div key={it.label} className={it.full ? 'msig-ficha-item msig-ficha-item--full' : 'msig-ficha-item'}>
                    <dt>{it.label}</dt>
                    <dd>{it.valor}</dd>
                </div>
            ))}
        </dl>
    );
}

export interface FirmaModalProps {
    isOpen: boolean;
    onClose: () => void;
    /** Recibe el PIN de 4 dígitos ya ingresado y la declaración marcada. */
    onConfirm: (pin: string) => void | Promise<void>;
    firmando: boolean;
    error?: string;
    titulo?: string;
    subtitulo?: string;
    icono?: ReactNode;
    declaracion?: string;
    /** Reemplaza el aviso por omisión (p. ej. para decir que se firma sin red). */
    aviso?: ReactNode;
    /** Paso 1: qué se está firmando. */
    children: ReactNode;
}

export default function FirmaModal(props: FirmaModalProps) {
    // Montado solo mientras está abierto: cada vez que se abre parte sin PIN y
    // sin la declaración marcada, sin tener que limpiarlos a mano.
    return props.isOpen ? <FirmaModalAbierto {...props} /> : null;
}

const CONSULTA_MOVIL = '(max-width: 640px)';

/** El teclado propio solo va donde la pantalla es de celular. */
function useEsMovil() {
    const [movil, setMovil] = useState(() => typeof window !== 'undefined' && window.matchMedia(CONSULTA_MOVIL).matches);
    useEffect(() => {
        const mq = window.matchMedia(CONSULTA_MOVIL);
        const cambio = () => setMovil(mq.matches);
        mq.addEventListener('change', cambio);
        return () => mq.removeEventListener('change', cambio);
    }, []);
    return movil;
}

type EstadoPaso = 'hecho' | 'actual' | 'pendiente';

function PasoTitulo({ n, estado, id, children, extra, ocultableEnMovil }: {
    n: number;
    estado: EstadoPaso;
    id: string;
    children: ReactNode;
    extra?: ReactNode;
    ocultableEnMovil?: boolean;
}) {
    return (
        <div className={`fm-paso-titulo${ocultableEnMovil ? ' fm-paso-titulo--ocultable' : ''}`}>
            <span className={`fm-marca fm-marca--${estado}`} aria-hidden="true">
                {estado === 'hecho' ? <FiCheck size={13} strokeWidth={3.2} /> : n}
            </span>
            <h3 id={id}>{children}</h3>
            {extra}
        </div>
    );
}

function FirmaModalAbierto({
    onClose,
    onConfirm,
    firmando,
    error,
    titulo = 'Firmar documento',
    subtitulo,
    icono = <FiEdit3 size={22} />,
    declaracion = 'Declaro haber leído conscientemente la solicitud de firma',
    aviso,
    children,
}: FirmaModalProps) {
    const esMovil = useEsMovil();
    const [fase, setFase] = useState<'revisar' | 'firmar'>('revisar');
    const [pin, setPin] = useState('');
    const [declarado, setDeclarado] = useState(false);
    const [mostrar, setMostrar] = useState(false);
    const [revisado, setRevisado] = useState(false);
    const [audio, setAudio] = useState<HTMLAudioElement | null>(null);
    const [audioSonando, setAudioSonando] = useState(false);

    // PIN rechazado: se limpia para volver a escribirlo.
    useEffect(() => { if (error) setPin(''); }, [error]);

    const lectura = useMemo<LecturaActiva>(() => ({
        registrar: (a) => setAudio((previo) => {
            if (previo && previo !== a) previo.pause();
            return a;
        }),
        soltar: (a) => setAudio((previo) => (previo === a ? null : previo)),
        alRevisar: () => setRevisado(true),
    }), []);

    useEffect(() => {
        if (!audio) { setAudioSonando(false); return; }
        const sincronizar = () => setAudioSonando(!audio.paused);
        sincronizar();
        audio.addEventListener('play', sincronizar);
        audio.addEventListener('pause', sincronizar);
        audio.addEventListener('ended', sincronizar);
        return () => {
            audio.removeEventListener('play', sincronizar);
            audio.removeEventListener('pause', sincronizar);
            audio.removeEventListener('ended', sincronizar);
        };
    }, [audio]);

    const pinCompleto = pin.length === LARGO_PIN;
    const listo = declarado && pinCompleto;

    const paso1: EstadoPaso = revisado || declarado ? 'hecho' : 'actual';
    const paso2: EstadoPaso = declarado ? 'hecho' : 'actual';
    const paso3: EstadoPaso = listo ? 'hecho' : declarado ? 'actual' : 'pendiente';

    const avisoTexto = aviso ?? <>Tu firma queda registrada con fecha, hora e identidad verificada. <strong>No se puede deshacer.</strong></>;

    return (
        <LecturaActivaContext.Provider value={lectura}>
            <Modal
                isOpen
                onClose={onClose}
                title={titulo}
                subtitle={subtitulo}
                icon={icono}
                size="lg"
                className="fm-modal"
                preventClose={firmando}
                footer={
                    <div className="fm-pie" data-fase={fase}>
                        <p className="fm-aviso">
                            <span className="fm-aviso-icono"><FiLock size={15} /></span>
                            <span>{avisoTexto}</span>
                        </p>
                        <p className="fm-ayuda-continuar" aria-live="polite">
                            {declarado ? `Siguiente: tu PIN de ${LARGO_PIN} dígitos` : 'Marca la declaración para continuar'}
                        </p>
                        <div className="fm-acciones">
                            <button type="button" className="btn btn-secondary fm-cancelar" onClick={onClose} disabled={firmando}>
                                Cancelar
                            </button>
                            <button
                                type="button"
                                className="btn btn-primary fm-continuar"
                                onClick={() => setFase('firmar')}
                                disabled={!declarado}
                            >
                                Continuar a firmar <FiArrowRight size={17} />
                            </button>
                            <button
                                type="button"
                                className="btn btn-primary fm-confirmar"
                                onClick={() => onConfirm(pin)}
                                disabled={firmando || !listo}
                            >
                                {firmando
                                    ? <><div className="spinner" style={{ width: '16px', height: '16px' }} /> Firmando...</>
                                    : <><FiEdit3 size={17} /> Confirmar firma</>}
                            </button>
                        </div>
                    </div>
                }
            >
                <div className="fm" data-fase={fase}>
                    {/* Avance en dos tramos: solo en el celular */}
                    <ol className="fm-tramos" aria-label="Pasos para firmar">
                        <li className={fase === 'revisar' ? 'is-actual' : 'is-hecho'} aria-current={fase === 'revisar' ? 'step' : undefined}>
                            <span className="fm-tramo-barra" />
                            <span className="fm-tramo-texto">1 · Revisar</span>
                        </li>
                        <li className={fase === 'firmar' ? 'is-actual' : undefined} aria-current={fase === 'firmar' ? 'step' : undefined}>
                            <span className="fm-tramo-barra" />
                            <span className="fm-tramo-texto">2 · Firmar</span>
                        </li>
                    </ol>

                    {/* PASO 1 · qué se firma */}
                    <section className="fm-col-revisar" aria-labelledby="fm-p1">
                        <PasoTitulo n={1} estado={paso1} id="fm-p1" ocultableEnMovil>Revisa lo que vas a firmar</PasoTitulo>
                        <div className="fm-contenido">{children}</div>
                    </section>

                    <div className="fm-col-firmar">
                        {/* PASO 2 · declaración */}
                        <section className="fm-paso-declarar" aria-labelledby="fm-p2">
                            <PasoTitulo n={2} estado={paso2} id="fm-p2" ocultableEnMovil>Confirma que lo revisaste</PasoTitulo>
                            <label className={`fm-declaracion${declarado ? ' is-marcada' : ''}`}>
                                <input
                                    type="checkbox"
                                    checked={declarado}
                                    onChange={(e) => setDeclarado(e.target.checked)}
                                    disabled={firmando}
                                />
                                <span className="fm-declaracion-caja" aria-hidden="true">
                                    {declarado && <FiCheck size={15} strokeWidth={3.4} />}
                                </span>
                                <span>{declaracion}</span>
                            </label>
                        </section>

                        {/* PASO 3 · PIN */}
                        <section className="fm-paso-pin" aria-labelledby="fm-p3">
                            {/* Celular: lo revisado, plegado */}
                            <div className="fm-resumen">
                                <span className="fm-resumen-icono"><FiFileText size={16} /></span>
                                <div className="fm-resumen-texto">
                                    <span className="fm-resumen-titulo">{subtitulo || titulo}</span>
                                    <span className="fm-resumen-estado">
                                        <span className="fm-resumen-ok"><FiCheck size={12} strokeWidth={3} /> Declaración aceptada</span>
                                        <button type="button" onClick={() => setFase('revisar')} disabled={firmando}>Revisar de nuevo</button>
                                    </span>
                                </div>
                                {audio && (
                                    <button
                                        type="button"
                                        className="fm-resumen-play"
                                        onClick={() => (audio.paused ? audio.play().catch(() => undefined) : audio.pause())}
                                        aria-label={audioSonando ? 'Pausar lectura' : 'Seguir escuchando'}
                                    >
                                        {audioSonando ? <FiPause size={16} fill="currentColor" /> : <FiPlay size={16} fill="currentColor" style={{ marginLeft: 2 }} />}
                                    </button>
                                )}
                            </div>

                            <PasoTitulo
                                n={3}
                                estado={paso3}
                                id="fm-p3"
                                extra={
                                    <button
                                        type="button"
                                        className="fm-mostrar"
                                        onClick={() => setMostrar((m) => !m)}
                                        disabled={!declarado}
                                        aria-pressed={mostrar}
                                    >
                                        {mostrar ? <FiEyeOff size={15} /> : <FiEye size={15} />}
                                        {mostrar ? 'Ocultar' : 'Mostrar'}
                                    </button>
                                }
                            >
                                <span className="fm-solo-escritorio">Firma con tu PIN</span>
                                <span className="fm-solo-movil">Ingresa tu PIN de firma</span>
                            </PasoTitulo>

                            <PinFirma
                                pin={pin}
                                onChange={setPin}
                                bloqueado={!declarado || firmando}
                                esperaDeclaracion={!declarado}
                                mostrar={mostrar}
                                conTeclado={esMovil}
                                activo={!esMovil || fase === 'firmar'}
                                error={error}
                            />
                        </section>
                    </div>
                </div>
            </Modal>
        </LecturaActivaContext.Provider>
    );
}

function PinFirma({ pin, onChange, bloqueado, esperaDeclaracion, mostrar, conTeclado, activo, error }: {
    pin: string;
    onChange: (pin: string) => void;
    bloqueado: boolean;
    esperaDeclaracion: boolean;
    mostrar: boolean;
    conTeclado: boolean;
    activo: boolean;
    error?: string;
}) {
    const inputRef = useRef<HTMLInputElement>(null);
    const [foco, setFoco] = useState(false);

    // Escritorio: al marcar la declaración el cursor salta al PIN.
    useEffect(() => {
        if (!bloqueado && activo && !conTeclado) inputRef.current?.focus();
    }, [bloqueado, activo, conTeclado]);

    const n = pin.length;
    const tecla = (d: string) => { if (!bloqueado && n < LARGO_PIN) onChange(pin + d); };

    return (
        <div className={`fm-pin${bloqueado ? ' is-bloqueado' : ''}`}>
            <div className="fm-pin-cajas">
                {Array.from({ length: LARGO_PIN }, (_, i) => {
                    const llena = i < n;
                    const actual = !bloqueado && i === n && (conTeclado || foco);
                    return (
                        <span
                            key={i}
                            className={`fm-pin-caja${llena ? ' is-llena' : ''}${actual ? ' is-actual' : ''}${error ? ' is-error' : ''}`}
                            aria-hidden="true"
                        >
                            {llena && (mostrar ? pin[i] : <span className="fm-pin-punto" />)}
                        </span>
                    );
                })}
                {!conTeclado && (
                    <input
                        ref={inputRef}
                        type={mostrar ? 'text' : 'password'}
                        inputMode="numeric"
                        autoComplete="off"
                        maxLength={LARGO_PIN}
                        value={pin}
                        onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, LARGO_PIN))}
                        onFocus={() => setFoco(true)}
                        onBlur={() => setFoco(false)}
                        disabled={bloqueado}
                        aria-label={`PIN de firma, ${LARGO_PIN} dígitos`}
                        className="fm-pin-input"
                    />
                )}
                {conTeclado && (
                    <span className="fm-sr" aria-live="polite">{n} de {LARGO_PIN} dígitos ingresados</span>
                )}
            </div>

            {error ? (
                <p className="fm-pin-error" role="alert"><FiAlertCircle size={14} /> {error}</p>
            ) : esperaDeclaracion ? (
                <p className="fm-pin-ayuda"><FiLock size={13} /> Se habilita al marcar la declaración</p>
            ) : (
                <p className="fm-pin-ayuda fm-solo-escritorio">{n === LARGO_PIN ? 'PIN completo' : `Escribe los ${LARGO_PIN} dígitos de tu PIN`}</p>
            )}

            {conTeclado && (
                <div className="fm-teclado">
                    {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
                        <button key={d} type="button" className="fm-tecla" onClick={() => tecla(d)} disabled={bloqueado}>{d}</button>
                    ))}
                    <span />
                    <button type="button" className="fm-tecla" onClick={() => tecla('0')} disabled={bloqueado}>0</button>
                    <button
                        type="button"
                        className="fm-tecla fm-tecla--borrar"
                        onClick={() => onChange(pin.slice(0, -1))}
                        disabled={bloqueado || n === 0}
                        aria-label="Borrar último dígito"
                    >
                        <FiDelete size={22} />
                    </button>
                </div>
            )}
        </div>
    );
}
