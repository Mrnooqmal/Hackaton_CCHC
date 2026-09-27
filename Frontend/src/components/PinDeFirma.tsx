import { useState } from 'react';
import { LuKeyRound, LuShieldCheck, LuShieldAlert, LuCircleAlert, LuCheck } from 'react-icons/lu';
import { Modal } from './ui';
import PinInput from './PinInput';
import { personasApi } from '../api/personas.api';

/**
 * Estado del PIN de firma de una persona, y las dos acciones sobre él que hace
 * otra persona: restablecerlo y asistir en la configuración del nuevo.
 *
 * Las reglas las decide el backend (`PersonaService.restablecerPin` y
 * `setPin`); esta pantalla solo evita ofrecer lo que igual se rechazaría:
 *   - quien restableció no puede asistir en el PIN nuevo;
 *   - en el asistido, el PIN lo teclea el trabajador y nunca se muestra: sin
 *     botón "Mostrar", sin guardarlo más allá de confirmarlo.
 */

export interface PinRestablecido {
    por: string;
    nombre?: string | null;
    en: string;
}

interface Props {
    tenantId: string;
    persona: {
        personaId: string;
        nombre?: string;
        pinConfigurado?: boolean;
        pinRestablecido?: PinRestablecido | null;
    };
    /** personaId de quien está mirando la ficha (la sesión). */
    actorPersonaId?: string;
    puedeRestablecer: boolean;
    /** Permiso de enrolar (`personas.crear`): el mismo que exige el backend para asistir. */
    puedeAsistir: boolean;
    onCambio: () => void;
}

type Resultado = Awaited<ReturnType<typeof personasApi.restablecerPin>>['data'];

const MOTIVO_MIN = 10;
const MOTIVO_MAX = 500;

const fechaHora = (iso: string) => new Date(iso).toLocaleString('es-CL', {
    day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
});

export default function PinDeFirma({ tenantId, persona, actorPersonaId, puedeRestablecer, puedeAsistir, onCambio }: Props) {
    const nombre = persona.nombre || 'la persona';
    const restablecido = persona.pinRestablecido || null;
    const esLaMisma = !!actorPersonaId && actorPersonaId === persona.personaId;
    const restablecioYo = !!restablecido && restablecido.por === actorPersonaId;

    // ── Restablecer ──
    const [restOpen, setRestOpen] = useState(false);
    const [motivo, setMotivo] = useState('');
    const [restEnviando, setRestEnviando] = useState(false);
    const [restError, setRestError] = useState('');
    const [resultado, setResultado] = useState<Resultado | null>(null);

    const abrirRestablecer = () => {
        setMotivo(''); setRestError(''); setResultado(null); setRestOpen(true);
    };
    const cerrarRestablecer = () => {
        if (restEnviando) return;
        setRestOpen(false);
        if (resultado) onCambio();
    };
    const restablecer = async () => {
        setRestEnviando(true);
        setRestError('');
        try {
            const r = await personasApi.restablecerPin(tenantId, persona.personaId, motivo.trim());
            if (r.success && r.data) setResultado(r.data);
            else setRestError(r.error || 'No se pudo restablecer el PIN.');
        } catch {
            setRestError('Error de conexión con el servidor.');
        } finally {
            setRestEnviando(false);
        }
    };

    // ── Asistir en el PIN nuevo ──
    const [asisOpen, setAsisOpen] = useState(false);
    const [paso, setPaso] = useState<'entregar' | 'crear' | 'confirmar' | 'listo'>('entregar');
    const [pinNuevo, setPinNuevo] = useState('');
    const [asisError, setAsisError] = useState('');
    const [asisEnviando, setAsisEnviando] = useState(false);

    const abrirAsistir = () => {
        setPaso('entregar'); setPinNuevo(''); setAsisError(''); setAsisOpen(true);
    };
    const cerrarAsistir = () => {
        if (asisEnviando) return;
        setPinNuevo('');
        setAsisOpen(false);
        if (paso === 'listo') onCambio();
    };
    const confirmar = async (pin: string) => {
        if (pin !== pinNuevo) {
            setPinNuevo('');
            setAsisError('Los PIN no coinciden. Que lo escriba de nuevo.');
            setPaso('crear');
            return;
        }
        setAsisEnviando(true);
        setAsisError('');
        try {
            const r = await personasApi.setPin(tenantId, persona.personaId, pin);
            setPinNuevo('');   // no queda en memoria más de lo necesario
            if (r.success) setPaso('listo');
            else { setAsisError(r.error || 'No se pudo configurar el PIN.'); setPaso('crear'); }
        } catch {
            setPinNuevo('');
            setAsisError('Error de conexión con el servidor.');
            setPaso('crear');
        } finally {
            setAsisEnviando(false);
        }
    };

    const motivoValido = motivo.trim().length >= MOTIVO_MIN && motivo.trim().length <= MOTIVO_MAX;

    return (
        <section className="pin-firma" aria-labelledby="pin-firma-titulo">
            <div className="pin-firma__cabecera">
                <LuKeyRound size={16} aria-hidden />
                <h3 id="pin-firma-titulo">PIN de firma</h3>
            </div>

            {persona.pinConfigurado ? (
                <p className="pin-firma__estado pin-firma__estado--ok">
                    <LuShieldCheck size={15} aria-hidden /> Configurado.
                </p>
            ) : restablecido ? (
                <p className="pin-firma__estado pin-firma__estado--pendiente">
                    <LuShieldAlert size={15} aria-hidden />
                    <span>
                        Restablecido por {restablecido.nombre || 'otra persona'} el {fechaHora(restablecido.en)}.
                        {' '}No puede firmar hasta que configure uno nuevo.
                    </span>
                </p>
            ) : (
                <p className="pin-firma__estado">Sin configurar. Se crea al enrolar a la persona.</p>
            )}

            <div className="pin-firma__acciones">
                {persona.pinConfigurado && puedeRestablecer && (
                    <button type="button" className="btn btn-secondary btn-sm" onClick={abrirRestablecer}>
                        Restablecer PIN
                    </button>
                )}
                {!persona.pinConfigurado && restablecido && puedeAsistir && !esLaMisma && (
                    restablecioYo ? (
                        <p className="pin-firma__nota">
                            Como restableciste este PIN, el nuevo lo configura otra persona con permiso de
                            enrolar, o {nombre} desde su propia cuenta.
                        </p>
                    ) : (
                        <button type="button" className="btn btn-primary btn-sm" onClick={abrirAsistir}>
                            Configurar PIN nuevo con {nombre}
                        </button>
                    )
                )}
            </div>

            {/* Restablecer */}
            <Modal
                isOpen={restOpen}
                onClose={cerrarRestablecer}
                title={resultado ? 'PIN restablecido' : 'Restablecer PIN de firma'}
                subtitle={resultado ? undefined : `El PIN actual de ${nombre} dejará de servir.`}
                size="md"
                footer={
                    <div className="pin-firma__pie">
                        {resultado ? (
                            <button className="btn btn-primary" onClick={cerrarRestablecer}>Cerrar</button>
                        ) : (
                            <>
                                <button className="btn btn-secondary" onClick={cerrarRestablecer} disabled={restEnviando}>Cancelar</button>
                                <button className="btn btn-danger" onClick={restablecer} disabled={restEnviando || !motivoValido}>
                                    {restEnviando ? 'Restableciendo…' : 'Restablecer'}
                                </button>
                            </>
                        )}
                    </div>
                }
            >
                {resultado ? (
                    <ul className="pin-firma__resultado">
                        <li><LuCheck size={15} aria-hidden /> {nombre} recibió el aviso en su bandeja.</li>
                        {resultado.avisoCorreo === 'enviado' && <li><LuCheck size={15} aria-hidden /> También se le avisó por correo.</li>}
                        {resultado.avisoCorreo === 'sin-correo' && <li className="pin-firma__neutro">No tiene correo registrado: el aviso quedó solo en la bandeja.</li>}
                        {resultado.avisoCorreo === 'fallido' && (
                            <li className="pin-firma__alerta"><LuCircleAlert size={15} aria-hidden /> No se pudo enviar el correo. Avísale por otro medio.</li>
                        )}
                        {resultado.valesSinAnular === null ? (
                            <li className="pin-firma__alerta"><LuCircleAlert size={15} aria-hidden /> No se pudo revisar si tenía vales para firmar sin conexión. Hay que revisarlo.</li>
                        ) : resultado.valesSinAnular > 0 ? (
                            <li className="pin-firma__alerta"><LuCircleAlert size={15} aria-hidden /> {resultado.valesSinAnular} vales para firmar sin conexión no se pudieron anular. Hay que revisarlo.</li>
                        ) : resultado.valesAnulados > 0 ? (
                            <li><LuCheck size={15} aria-hidden /> Se anularon {resultado.valesAnulados} vales para firmar sin conexión.</li>
                        ) : null}
                        <li className="pin-firma__neutro">
                            El PIN nuevo lo configura {nombre} desde su cuenta, o en terreno con ayuda de otra
                            persona con permiso de enrolar. Tú no puedes asistir en ese paso.
                        </li>
                    </ul>
                ) : (
                    <div className="pin-firma__form">
                        {restError && (
                            <div className="pin-firma__error" role="alert">
                                <LuCircleAlert size={15} aria-hidden /><span>{restError}</span>
                            </div>
                        )}
                        <ul className="pin-firma__consecuencias">
                            <li>{nombre} no podrá firmar hasta configurar un PIN nuevo.</li>
                            <li>Sus vales para firmar sin conexión quedan anulados.</li>
                            <li>Recibe un aviso en su bandeja, y por correo si tiene, con tu nombre y el motivo.</li>
                            <li>Tú no podrás asistir en la configuración del PIN nuevo: la hace otra persona o {nombre}.</li>
                        </ul>
                        <label className="form-label" htmlFor="pin-motivo">Motivo</label>
                        <textarea
                            id="pin-motivo"
                            className="form-input"
                            rows={3}
                            maxLength={MOTIVO_MAX}
                            value={motivo}
                            onChange={(e) => setMotivo(e.target.value)}
                            placeholder="Ej.: lo olvidó y lo pidió en persona en la obra"
                            autoFocus
                        />
                        <span className="pin-firma__contador">
                            {motivo.trim().length < MOTIVO_MIN
                                ? `Al menos ${MOTIVO_MIN} caracteres`
                                : `${motivo.trim().length} / ${MOTIVO_MAX}`}
                        </span>
                    </div>
                )}
            </Modal>

            {/* Asistir */}
            <Modal
                isOpen={asisOpen}
                onClose={cerrarAsistir}
                title={paso === 'listo' ? 'PIN configurado' : `PIN nuevo de ${nombre}`}
                size="md"
                footer={
                    <div className="pin-firma__pie">
                        {paso === 'entregar' && (
                            <>
                                <button className="btn btn-secondary" onClick={cerrarAsistir}>Cancelar</button>
                                <button className="btn btn-primary" onClick={() => setPaso('crear')}>{nombre} tiene el equipo</button>
                            </>
                        )}
                        {(paso === 'crear' || paso === 'confirmar') && (
                            <button className="btn btn-secondary" onClick={cerrarAsistir} disabled={asisEnviando}>Cancelar</button>
                        )}
                        {paso === 'listo' && <button className="btn btn-primary" onClick={cerrarAsistir}>Cerrar</button>}
                    </div>
                }
            >
                {paso === 'entregar' && (
                    <div className="pin-firma__form">
                        <p className="pin-firma__texto">
                            Entrega el equipo a {nombre}. El PIN nuevo lo escribe solo esa persona: no lo mires
                            ni lo dictes. En ningún momento se muestra en pantalla.
                        </p>
                    </div>
                )}
                {paso === 'crear' && (
                    <PinInput
                        key="crear"
                        mode="create"
                        showToggle={false}
                        title="Escribe tu PIN nuevo"
                        subtitle="Cuatro dígitos que solo tú conozcas"
                        error={asisError}
                        onComplete={(pin) => { setPinNuevo(pin); setAsisError(''); setPaso('confirmar'); }}
                    />
                )}
                {paso === 'confirmar' && (
                    <PinInput
                        key="confirmar"
                        mode="confirm"
                        showToggle={false}
                        title="Escríbelo otra vez"
                        subtitle="Para confirmar que es el que quisiste"
                        disabled={asisEnviando}
                        onComplete={confirmar}
                    />
                )}
                {paso === 'listo' && (
                    <p className="pin-firma__texto">
                        {nombre} ya tiene PIN nuevo y puede volver a firmar. Quedó registrado que lo configuró
                        con tu asistencia.
                    </p>
                )}
            </Modal>

            <style>{`
                .pin-firma { display: flex; flex-direction: column; gap: var(--space-2); padding-top: var(--space-4); border-top: 1px solid var(--surface-border); }
                .pin-firma__cabecera { display: flex; align-items: center; gap: 8px; color: var(--text-primary); }
                .pin-firma__cabecera h3 { font-size: 0.95rem; font-weight: 600; margin: 0; }
                .pin-firma__estado { display: flex; align-items: flex-start; gap: 8px; margin: 0; font-size: 0.86rem; color: var(--text-secondary); line-height: 1.5; }
                .pin-firma__estado svg { flex-shrink: 0; margin-top: 3px; }
                .pin-firma__estado--ok { color: var(--success-700, #15803d); }
                .pin-firma__estado--pendiente { color: var(--warning-800, #92400e); }
                .pin-firma__acciones { display: flex; flex-wrap: wrap; gap: var(--space-2); }
                .pin-firma__nota { margin: 0; font-size: 0.82rem; color: var(--text-secondary); line-height: 1.5; max-width: 65ch; }
                .pin-firma__pie { display: flex; justify-content: flex-end; gap: var(--space-2); width: 100%; }
                .pin-firma__form { display: flex; flex-direction: column; gap: var(--space-2); }
                .pin-firma__texto { margin: 0; font-size: 0.9rem; line-height: 1.55; color: var(--text-primary); max-width: 65ch; }
                .pin-firma__consecuencias { margin: 0 0 var(--space-2); padding-left: 1.1rem; font-size: 0.86rem; line-height: 1.55; color: var(--text-primary); }
                .pin-firma__contador { font-size: 0.76rem; color: var(--text-secondary); align-self: flex-end; }
                .pin-firma__error {
                    display: flex; align-items: center; gap: 8px; padding: 10px 14px; border-radius: var(--radius-md);
                    background: rgba(239, 68, 68, 0.08); border: 1px solid rgba(239, 68, 68, 0.25);
                    color: var(--danger-600, #b91c1c); font-size: 0.82rem;
                }
                .pin-firma__resultado { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--space-2); font-size: 0.88rem; line-height: 1.5; }
                .pin-firma__resultado li { display: flex; align-items: flex-start; gap: 8px; }
                .pin-firma__resultado svg { flex-shrink: 0; margin-top: 3px; color: var(--success-700, #15803d); }
                .pin-firma__resultado .pin-firma__alerta { color: var(--danger-600, #b91c1c); }
                .pin-firma__resultado .pin-firma__alerta svg { color: inherit; }
                .pin-firma__resultado .pin-firma__neutro { color: var(--text-secondary); }
            `}</style>
        </section>
    );
}
