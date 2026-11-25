import { useState } from 'react';
import { LuKeyRound, LuCircleAlert, LuCheck, LuMail, LuCopy } from 'react-icons/lu';
import { Modal } from './ui';
import { personasApi } from '../api/personas.api';
import { estadoAcceso, fechaCorta, horaCorta, reactivable, textoEstadoAcceso, type DatosAcceso } from '../utils/accesoPersona';

interface PersonaAcceso extends DatosAcceso {
    personaId: string;
    nombre?: string;
    rut?: string;
    email?: string | null;
}

interface ModalProps {
    tenantId: string;
    persona: PersonaAcceso | null;
    onCerrar: (huboCambio: boolean) => void;
}

export function ModalActivacion({ tenantId, persona, onCerrar }: ModalProps) {
    const [paso, setPaso] = useState<'confirmar' | 'mostrar'>('confirmar');
    const [enviando, setEnviando] = useState(false);
    const [error, setError] = useState('');
    const [temporal, setTemporal] = useState<{ password: string; vence: string } | null>(null);

    const nombre = persona?.nombre || 'la persona';

    const cerrar = () => {
        if (enviando) return;
        const hubo = Boolean(temporal);
        setTemporal(null);
        setPaso('confirmar');
        setError('');
        onCerrar(hubo);
    };

    const activar = async () => {
        if (!persona) return;
        setEnviando(true);
        setError('');
        try {
            const r = await personasApi.activarAcceso(tenantId, persona.personaId);
            if (r.success && r.data) {
                setTemporal({ password: r.data.password, vence: r.data.vence });
                setPaso('mostrar');
            } else {
                setError(r.error || 'No se pudo activar el acceso.');
            }
        } catch {
            setError('Error de conexión con el servidor.');
        } finally {
            setEnviando(false);
        }
    };

    return (
        <Modal
            isOpen={Boolean(persona)}
            onClose={cerrar}
            title={paso === 'mostrar' ? `Contraseña temporal de ${nombre}` : `Activar el acceso de ${nombre}`}
            size="md"
            footer={
                <div className="acceso-web__pie">
                    {paso === 'mostrar' ? (
                        <button className="btn btn-primary" onClick={cerrar}>Listo, ya entró</button>
                    ) : (
                        <>
                            <button className="btn btn-secondary" onClick={cerrar} disabled={enviando}>Cancelar</button>
                            <button className="btn btn-primary" onClick={activar} disabled={enviando}>
                                {enviando ? 'Activando…' : `${nombre} está aquí: activar`}
                            </button>
                        </>
                    )}
                </div>
            }
        >
            {paso === 'mostrar' && temporal ? (
                <div className="acceso-web__mostrar">
                    <p className="acceso-web__texto">Díctasela o muéstrale la pantalla. Se ve una sola vez.</p>
                    <div className="acceso-web__clave" aria-label="Contraseña temporal">{temporal.password}</div>
                    <p className="acceso-web__vence">Vence a las {horaCorta(temporal.vence)}.</p>
                    <ol className="acceso-web__pasos">
                        <li>En su teléfono, abre <strong>buildandserve.cl</strong>.</li>
                        <li>Entra con su RUT{persona?.rut ? ` (${persona.rut})` : ''} y esta contraseña, con los guiones.</li>
                        <li>Elige su propia contraseña y crea su PIN de firma.</li>
                    </ol>
                </div>
            ) : (
                <div className="acceso-web__form">
                    {error && (
                        <div className="acceso-web__error" role="alert">
                            <LuCircleAlert size={15} aria-hidden /><span>{error}</span>
                        </div>
                    )}
                    <ul className="acceso-web__consecuencias">
                        <li>Se genera una contraseña temporal que vence en 2 horas.</li>
                        {persona?.credencialInicial && <li>Los cuatro primeros dígitos de su RUT dejan de servir.</li>}
                        <li>{nombre} tiene que entrar ahora, desde su teléfono, y elegir su propia contraseña.</li>
                        <li>Queda registrado que tú activaste su acceso, y recibe un aviso con tu nombre.</li>
                        <li>Actívalo solo con {nombre} presente: quien tenga la temporal puede entrar como {nombre}.</li>
                    </ul>
                </div>
            )}
        </Modal>
    );
}

const MOTIVO_MIN = 10;
const MOTIVO_MAX = 120;

interface ModalRestablecerProps {
    tenantId: string;
    persona: PersonaAcceso | null;
    onCerrar: (huboCambio: boolean) => void;
}

export function ModalRestablecer({ tenantId, persona, onCerrar }: ModalRestablecerProps) {
    const [motivo, setMotivo] = useState('');
    const [enviando, setEnviando] = useState(false);
    const [error, setError] = useState('');
    const [copiada, setCopiada] = useState(false);
    const [hecho, setHecho] = useState<{ password: string; vence: string; sesionesCerradas: boolean; correo: string } | null>(null);

    const nombre = persona?.nombre || 'la persona';
    const largo = motivo.trim().length;
    const motivoValido = largo >= MOTIVO_MIN && largo <= MOTIVO_MAX;

    const cerrar = () => {
        if (enviando) return;
        const hubo = Boolean(hecho);
        setHecho(null);
        setMotivo('');
        setError('');
        setCopiada(false);
        onCerrar(hubo);
    };

    const restablecer = async () => {
        if (!persona || !motivoValido) return;
        setEnviando(true);
        setError('');
        try {
            const r = await personasApi.restablecerContrasena(tenantId, persona.personaId, motivo.trim());
            if (r.success && r.data) setHecho(r.data);
            else setError(r.error || 'No se pudo restablecer la contraseña.');
        } catch {
            setError('Error de conexión con el servidor.');
        } finally {
            setEnviando(false);
        }
    };

    const copiar = async () => {
        if (!hecho) return;
        try {
            await navigator.clipboard.writeText(hecho.password);
            setCopiada(true);
        } catch {
            setCopiada(false);
        }
    };

    return (
        <Modal
            isOpen={Boolean(persona)}
            onClose={cerrar}
            title={hecho ? `Contraseña temporal de ${nombre}` : `Restablecer la contraseña de ${nombre}`}
            size="md"
            footer={
                <div className="acceso-web__pie">
                    {hecho ? (
                        <button className="btn btn-primary" onClick={cerrar}>Ya la entregué</button>
                    ) : (
                        <>
                            <button className="btn btn-secondary" onClick={cerrar} disabled={enviando}>Cancelar</button>
                            <button className="btn btn-primary" onClick={restablecer} disabled={enviando || !motivoValido}>
                                {enviando ? 'Restableciendo…' : 'Restablecer contraseña'}
                            </button>
                        </>
                    )}
                </div>
            }
        >
            {hecho ? (
                <div className="acceso-web__mostrar">
                    <p className="acceso-web__texto">Entrégasela en persona o por teléfono, después de verificar que es {nombre}. Se ve una sola vez.</p>
                    <div className="acceso-web__clave" aria-label="Contraseña temporal">{hecho.password}</div>
                    <button type="button" className="btn btn-secondary btn-sm acceso-web__copiar" onClick={copiar}>
                        <LuCopy size={14} aria-hidden /> {copiada ? 'Copiada' : 'Copiar'}
                    </button>
                    <p className="acceso-web__vence">Vence el {fechaCorta(hecho.vence)} a las {horaCorta(hecho.vence)}.</p>
                    {!hecho.sesionesCerradas && (
                        <div className="acceso-web__error" role="alert">
                            <LuCircleAlert size={15} aria-hidden />
                            <span>No pudimos cerrar las sesiones abiertas de {nombre}. Restablécela de nuevo en unos minutos.</span>
                        </div>
                    )}
                    <ol className="acceso-web__pasos">
                        <li>Entra con su RUT{persona?.rut ? ` (${persona.rut})` : ''} y esta contraseña, con los guiones.</li>
                        <li>Elige su propia contraseña. Su PIN de firma no cambia.</li>
                    </ol>
                </div>
            ) : (
                <div className="acceso-web__form">
                    {error && (
                        <div className="acceso-web__error" role="alert">
                            <LuCircleAlert size={15} aria-hidden /><span>{error}</span>
                        </div>
                    )}
                    <ul className="acceso-web__consecuencias">
                        <li>Su contraseña actual deja de servir y se cierran sus sesiones abiertas en esta empresa.</li>
                        <li>Se genera una contraseña temporal que vence en 72 horas, y solo sirve en esta empresa.</li>
                        <li>Queda registrado que tú la restableciste, con el motivo, y {nombre} recibe un aviso con tu nombre.</li>
                        <li>Hazlo solo si verificaste que es {nombre} quien lo pide.</li>
                    </ul>
                    <label className="acceso-web__motivo">
                        <span>Motivo (queda en la auditoría; sin RUT ni correos)</span>
                        <textarea
                            className="form-input"
                            rows={3}
                            maxLength={MOTIVO_MAX}
                            value={motivo}
                            onChange={(e) => setMotivo(e.target.value)}
                            placeholder="Por ejemplo: olvidó su contraseña y no tiene correo"
                        />
                        <span className="acceso-web__contador">{largo}/{MOTIVO_MAX}{largo > 0 && largo < MOTIVO_MIN ? ` (mínimo ${MOTIVO_MIN})` : ''}</span>
                    </label>
                </div>
            )}
        </Modal>
    );
}

interface Props {
    tenantId: string;
    persona: PersonaAcceso;
    puedeActivar: boolean;
    puedeRestablecer?: boolean;
    esLaMisma: boolean;
    onCambio: () => void;
}

export default function AccesoPlataforma({ tenantId, persona, puedeActivar, puedeRestablecer = false, esLaMisma, onCambio }: Props) {
    const [abierto, setAbierto] = useState(false);
    const [restableciendo, setRestableciendo] = useState(false);
    const [enlace, setEnlace] = useState<{ estado: 'enviando' | 'enviado' | 'error'; texto?: string } | null>(null);
    const [reactivacion, setReactivacion] = useState<{ estado: 'confirmar' | 'enviando' | 'hecho' | 'error'; texto?: string } | null>(null);
    const estado = estadoAcceso(persona);
    const activable = estado !== 'sin-acceso' && estado !== 'activo' && estado !== 'restablecida-vigente' && estado !== 'restablecida-vencida';
    const restablecible = estado === 'activo' || estado === 'restablecida-vigente' || estado === 'restablecida-vencida';

    const reactivar = async () => {
        setReactivacion({ estado: 'enviando' });
        try {
            const r = await personasApi.reactivarInicial(tenantId, persona.personaId);
            if (r.success && r.data) {
                setReactivacion({ estado: 'hecho', texto: `Puede entrar con los cuatro primeros dígitos de su RUT hasta el ${fechaCorta(r.data.vence)}.` });
                onCambio();
            } else {
                setReactivacion({ estado: 'error', texto: r.error || 'No se pudo reactivar su acceso inicial.' });
            }
        } catch {
            setReactivacion({ estado: 'error', texto: 'Error de conexión con el servidor.' });
        }
    };

    const enviarEnlace = async () => {
        setEnlace({ estado: 'enviando' });
        try {
            const r = await personasApi.enviarActivacion(tenantId, persona.personaId);
            if (r.success && r.data?.correo === 'enviado') setEnlace({ estado: 'enviado' });
            else setEnlace({ estado: 'error', texto: r.error || 'No se pudo enviar el enlace a su correo. Activa su acceso en terreno.' });
        } catch {
            setEnlace({ estado: 'error', texto: 'Error de conexión con el servidor.' });
        }
    };

    return (
        <section className="acceso-web" aria-labelledby="acceso-web-titulo">
            <div className="acceso-web__cabecera">
                <h3 id="acceso-web-titulo">Acceso a la plataforma</h3>
                <span>Con su RUT y su contraseña</span>
            </div>
            <div className="acceso-web__caja">
                <p className={`acceso-web__estado${estado === 'activo' ? ' acceso-web__estado--ok' : ''}`}>
                    {estado === 'activo' ? <LuCheck size={15} aria-hidden /> : <LuKeyRound size={15} aria-hidden />}
                    <span>{textoEstadoAcceso(persona)}</span>
                </p>
                {activable && puedeActivar && !esLaMisma && (
                    <div className="acceso-web__acciones">
                        <button type="button" className="btn btn-primary btn-sm" onClick={() => setAbierto(true)}>
                            {estado === 'temporal-vigente' || estado === 'temporal-vencida' ? 'Activar de nuevo' : 'Activar acceso'}
                        </button>
                        {reactivable(estado) && (
                            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setReactivacion({ estado: 'confirmar' })} disabled={reactivacion?.estado === 'enviando'}>
                                {reactivacion?.estado === 'enviando' ? 'Reactivando…' : 'Reactivar acceso inicial'}
                            </button>
                        )}
                        {persona.email && (
                            <button type="button" className="btn btn-secondary btn-sm" onClick={enviarEnlace} disabled={enlace?.estado === 'enviando'}>
                                <LuMail size={14} aria-hidden /> {enlace?.estado === 'enviando' ? 'Enviando…' : 'Enviar enlace a su correo'}
                            </button>
                        )}
                    </div>
                )}
                {restablecible && puedeRestablecer && !esLaMisma && (
                    <div className="acceso-web__acciones">
                        <button type="button" className="btn btn-secondary btn-sm" onClick={() => setRestableciendo(true)}>
                            <LuKeyRound size={14} aria-hidden /> Restablecer contraseña
                        </button>
                    </div>
                )}
                {reactivacion?.estado === 'confirmar' && (
                    <div className="acceso-web__confirmar" role="group" aria-label="Confirmar reactivación">
                        <p className="acceso-web__nota">
                            Durante 7 días podrá entrar con los cuatro primeros dígitos de su RUT, y cualquiera que conozca su RUT también.
                            Queda registrado que tú lo reactivaste, y recibe un aviso con tu nombre.
                        </p>
                        <div className="acceso-web__acciones">
                            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setReactivacion(null)}>Cancelar</button>
                            <button type="button" className="btn btn-primary btn-sm" onClick={reactivar}>Reactivar por 7 días</button>
                        </div>
                    </div>
                )}
                {reactivacion?.estado === 'hecho' && <p className="acceso-web__nota">{reactivacion.texto}</p>}
                {reactivacion?.estado === 'error' && (
                    <p className="acceso-web__nota acceso-web__nota--error" role="alert">{reactivacion.texto}</p>
                )}
                {enlace?.estado === 'enviado' && (
                    <p className="acceso-web__nota">Enviamos a su correo un enlace para que elija su contraseña. Vence en 72 horas.</p>
                )}
                {enlace?.estado === 'error' && (
                    <p className="acceso-web__nota acceso-web__nota--error" role="alert">{enlace.texto}</p>
                )}
            </div>

            <ModalActivacion
                tenantId={tenantId}
                persona={abierto ? persona : null}
                onCerrar={(hubo) => { setAbierto(false); if (hubo) onCambio(); }}
            />

            <ModalRestablecer
                tenantId={tenantId}
                persona={restableciendo ? persona : null}
                onCerrar={(hubo) => { setRestableciendo(false); if (hubo) onCambio(); }}
            />

            <style>{ESTILOS_ACCESO}</style>
        </section>
    );
}

export const ESTILOS_ACCESO = `
    .acceso-web { display: flex; flex-direction: column; min-width: 0; }
    .acceso-web__cabecera {
        display: flex; align-items: center; flex-wrap: wrap; gap: 4px 10px; min-height: 42px;
        padding-bottom: 9px; margin-bottom: 14px; border-bottom: 1px solid var(--surface-border);
    }
    .acceso-web__cabecera h3 { font-size: 14px; font-weight: 600; margin: 0; color: var(--text-primary); }
    .acceso-web__cabecera span { font-size: 11.5px; color: var(--text-secondary); }
    .acceso-web__caja { display: flex; flex-direction: column; gap: 12px; padding: 16px; border: 1px solid var(--surface-border); border-radius: 12px; }
    .acceso-web__estado { display: flex; align-items: flex-start; gap: 8px; margin: 0; font-size: 13.5px; color: var(--text-secondary); line-height: 1.5; }
    .acceso-web__estado svg { flex-shrink: 0; margin-top: 3px; }
    .acceso-web__estado--ok { color: var(--text-primary); font-weight: 500; }
    .acceso-web__estado--ok svg { color: var(--success-apagado); }
    .acceso-web__acciones { display: flex; flex-wrap: wrap; gap: var(--space-2); }
    .acceso-web__confirmar { display: flex; flex-direction: column; gap: var(--space-2); }
    .acceso-web__motivo { display: flex; flex-direction: column; gap: 6px; font-size: 0.85rem; color: var(--text-secondary); }
    .acceso-web__contador { align-self: flex-end; font-size: 0.75rem; }
    .acceso-web__copiar { align-self: center; }
    .acceso-web__nota { margin: 0; font-size: 0.82rem; color: var(--text-secondary); line-height: 1.5; }
    .acceso-web__nota--error { color: var(--danger-600, #b91c1c); }
    .acceso-web__pie { display: flex; justify-content: flex-end; gap: var(--space-2); width: 100%; flex-wrap: wrap; }
    .acceso-web__form, .acceso-web__mostrar { display: flex; flex-direction: column; gap: var(--space-3); }
    .acceso-web__texto { margin: 0; font-size: 0.9rem; color: var(--text-primary); }
    .acceso-web__clave {
        font-family: 'Courier New', Courier, monospace; font-size: clamp(1.6rem, 7vw, 2.4rem); font-weight: 700;
        letter-spacing: 0.08em; text-align: center; padding: 18px 12px; border-radius: 12px;
        background: var(--surface-2, rgba(0,0,0,0.04)); color: var(--text-primary); user-select: all; word-break: break-all;
    }
    .acceso-web__vence { margin: 0; text-align: center; font-size: 0.9rem; color: var(--text-secondary); }
    .acceso-web__pasos, .acceso-web__consecuencias { margin: 0; padding-left: 1.2rem; font-size: 0.88rem; line-height: 1.6; color: var(--text-primary); }
    .acceso-web__error {
        display: flex; align-items: center; gap: 8px; padding: 10px 14px; border-radius: var(--radius-md);
        background: rgba(239, 68, 68, 0.08); border: 1px solid rgba(239, 68, 68, 0.25);
        color: var(--danger-600, #b91c1c); font-size: 0.82rem;
    }
`;
