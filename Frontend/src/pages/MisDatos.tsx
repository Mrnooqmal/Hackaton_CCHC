import { useCallback, useEffect, useState } from 'react';
import { FiShield, FiDownload, FiEdit3, FiCheck, FiX, FiClock } from 'react-icons/fi';
import { useAuth } from '../context/AuthContext';
import { PageHeader, AlertBanner, Badge, Select } from '../components/ui';
import type { BadgeVariant } from '../components/ui';
import {
    privacidadApi, descargarJson, DERECHO_LABEL, RESULTADO_LABEL, ETAPA_LABEL, CAMPO_LABEL,
    type FinalidadConsentimiento, type EventoConsentimiento, type MiSolicitud, type CampoRectificable, type Etapa,
} from '../api/gobernanza.api';

/**
 * Mis datos y privacidad (Ley 21.719): lo que cada persona hace sobre SUS
 * datos, sin pasar por nadie.
 *
 *   - Consentimientos: una decisión por finalidad, con el texto completo a la
 *     vista. Nada viene marcado. Revocar es un clic, igual que otorgar.
 *   - Descargar mis datos: copia en JSON. Pide volver a escribir la contraseña.
 *   - Solicitudes: rectificación, supresión, oposición o bloqueo, y el estado
 *     de cada una.
 *
 * Las reglas las aplica el backend (handlers/gobernanza/titular.js); esta
 * pantalla solo evita ofrecer lo que igual se rechazaría.
 */

type Pestana = 'consentimientos' | 'descarga' | 'solicitudes';
const TZ = 'America/Santiago';
const fechaHora = (iso?: string | null) => (iso ? new Date(iso).toLocaleString('es-CL', { timeZone: TZ, dateStyle: 'medium', timeStyle: 'short' }) : '');
const fecha = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString('es-CL', { timeZone: TZ, dateStyle: 'medium' }) : '');
const ETAPA_VARIANTE: Record<Etapa, BadgeVariant> = { recibida: 'warning', verificada: 'info', respondida: 'secondary', cerrada: 'success' };

export default function MisDatos() {
    const [pestana, setPestana] = useState<Pestana>('consentimientos');
    return (
        <div className="page-content md-pagina">
            <PageHeader
                title="Mis datos y privacidad"
                description="Decide qué autorizas, descarga una copia de tus datos y pide corregirlos o suprimirlos. Tu empleador es el responsable de tus datos; Build & Serve los trata por encargo."
                tabs={[
                    { id: 'consentimientos', label: 'Consentimientos', icon: <FiShield size={14} /> },
                    { id: 'descarga', label: 'Descargar mis datos', icon: <FiDownload size={14} /> },
                    { id: 'solicitudes', label: 'Solicitudes', icon: <FiEdit3 size={14} /> },
                ]}
                activeTab={pestana}
                onTabChange={(id) => setPestana(id as Pestana)}
                tabsLabel="Secciones de mis datos"
            />
            {pestana === 'consentimientos' && <Consentimientos />}
            {pestana === 'descarga' && <Descarga />}
            {pestana === 'solicitudes' && <Solicitudes />}
            <style>{estilos}</style>
        </div>
    );
}

// ── Consentimientos ───────────────────────────────────────────────────────────

function Consentimientos() {
    const [finalidades, setFinalidades] = useState<FinalidadConsentimiento[]>([]);
    const [bases, setBases] = useState<{ tratamiento: string; base: string }[]>([]);
    const [historial, setHistorial] = useState<EventoConsentimiento[]>([]);
    const [cargando, setCargando] = useState(true);
    const [error, setError] = useState('');

    const cargar = useCallback(async () => {
        const r = await privacidadApi.consentimientos().catch(() => null);
        if (r?.success && r.data) {
            setFinalidades(r.data.finalidades);
            setBases(r.data.basesSinConsentimiento);
            setHistorial(r.data.historial);
        } else setError(r?.error || 'No se pudieron cargar tus consentimientos.');
        setCargando(false);
    }, []);
    useEffect(() => { cargar(); }, [cargar]);

    const nombreDe = (id: string) => finalidades.find((f) => f.finalidad === id)?.nombre || id;

    if (cargando) return <div className="md-centro"><div className="spinner" /></div>;
    return (
        <div className="md-cuerpo">
            {error && <AlertBanner variant="error" message={error} onDismiss={() => setError('')} />}
            <p className="md-intro">
                Cada autorización es independiente: aceptar una no habilita ninguna otra, y puedes revocarla cuando quieras
                con un clic. Revocar no afecta lo que se hizo antes con tu autorización.
            </p>
            {finalidades.map((f) => <TarjetaConsentimiento key={f.finalidad} f={f} onCambio={cargar} onError={setError} />)}

            <section className="md-seccion">
                <h3 className="md-subtitulo">Lo que no depende de tu consentimiento</h3>
                <p className="md-hint">Estos datos se tratan porque la ley o tu contrato de trabajo lo exigen. Por eso no se te pregunta, pero sí se te informa.</p>
                <ul className="md-bases">
                    {bases.map((b) => <li key={b.tratamiento}><strong>{b.tratamiento}.</strong> {b.base}</li>)}
                </ul>
            </section>

            <section className="md-seccion">
                <h3 className="md-subtitulo">Historial de tus decisiones</h3>
                {historial.length === 0 ? <p className="md-hint">Todavía no has tomado ninguna decisión.</p> : (
                    <ol className="md-historial">
                        {historial.map((h) => (
                            <li key={`${h.en}-${h.finalidad}-${h.tipo}`}>
                                {h.tipo === 'consentimiento_otorgado' ? <FiCheck aria-hidden /> : <FiX aria-hidden />}
                                <span>{h.tipo === 'consentimiento_otorgado' ? 'Otorgaste' : 'Revocaste'} <strong>{nombreDe(h.finalidad)}</strong> (texto {h.version})</span>
                                <time dateTime={h.en}>{fechaHora(h.en)}</time>
                            </li>
                        ))}
                    </ol>
                )}
            </section>
        </div>
    );
}

function TarjetaConsentimiento({ f, onCambio, onError }: { f: FinalidadConsentimiento; onCambio: () => void; onError: (m: string) => void }) {
    // Nada viene marcado: el silencio no es consentimiento.
    const [leido, setLeido] = useState(false);
    const [enviando, setEnviando] = useState(false);
    const decidir = async (accion: 'otorgar' | 'revocar') => {
        setEnviando(true);
        const r = await (accion === 'otorgar' ? privacidadApi.otorgar(f.finalidad, f.version) : privacidadApi.revocar(f.finalidad)).catch(() => null);
        setEnviando(false);
        setLeido(false);
        if (r?.success) onCambio(); else onError(r?.error || 'No se pudo guardar tu decisión.');
    };
    const estado = f.vigente
        ? <Badge variant="success">Autorizado desde el {fecha(f.otorgadoEl)}</Badge>
        : f.requiereRenovar
            ? <Badge variant="warning">El texto cambió: vuelve a decidir</Badge>
            : f.estado === 'revocado'
                ? <Badge variant="neutral">Revocado el {fecha(f.revocadoEl)}</Badge>
                : <Badge variant="neutral">Sin autorizar</Badge>;
    return (
        <section className="md-tarjeta" aria-labelledby={`md-${f.finalidad}`}>
            <div className="md-tarjeta-cabeza">
                <h3 id={`md-${f.finalidad}`} className="md-subtitulo">{f.nombre}</h3>
                {estado}
            </div>
            <p className="md-hint"><strong>Qué datos:</strong> {f.dato}</p>
            <blockquote className="md-texto">
                {f.texto}
                <span className="md-version">Texto {f.version}</span>
            </blockquote>
            <p className="md-hint"><strong>Si lo revocas:</strong> {f.efectoRevocacion}</p>
            <div className="md-acciones">
                {f.vigente ? (
                    <button className="btn btn-secondary btn-sm" disabled={enviando} onClick={() => decidir('revocar')}>
                        {enviando ? 'Guardando…' : 'Revocar autorización'}
                    </button>
                ) : (
                    <>
                        <label className="md-check">
                            <input type="checkbox" checked={leido} onChange={(e) => setLeido(e.target.checked)} />
                            Leí el texto y autorizo este tratamiento
                        </label>
                        <button className="btn btn-primary btn-sm" disabled={!leido || enviando} onClick={() => decidir('otorgar')}>
                            {enviando ? 'Guardando…' : 'Autorizar'}
                        </button>
                    </>
                )}
            </div>
        </section>
    );
}

// ── Descarga ──────────────────────────────────────────────────────────────────

function Descarga() {
    const [password, setPassword] = useState('');
    const [enviando, setEnviando] = useState(false);
    const [error, setError] = useState('');
    const [listo, setListo] = useState('');
    const descargar = async () => {
        setEnviando(true);
        setError('');
        setListo('');
        const r = await privacidadApi.exportar(password).catch(() => null);
        setEnviando(false);
        setPassword('');
        if (r?.success && r.data) {
            descargarJson(r.data, `mis-datos-${new Date().toISOString().slice(0, 10)}.json`);
            setListo('Se descargó el archivo. Guárdalo en un lugar seguro: contiene tus datos personales.');
        } else setError(r?.error || 'No se pudo generar la copia.');
    };
    return (
        <div className="md-cuerpo">
            <section className="md-tarjeta">
                <h3 className="md-subtitulo">Copia de tus datos</h3>
                <p className="md-hint">
                    Recibes un archivo JSON con tu ficha, tus documentos y firmas, tus capacitaciones, tus encuestas, los incidentes
                    en que apareces, tus consentimientos y tus solicitudes. Sirve para revisarlos o para llevarlos a otro empleador.
                    No incluye datos de otras personas ni información interna de seguridad.
                </p>
                <p className="md-hint">Por tu seguridad, vuelve a escribir tu contraseña. Puedes descargar hasta tres copias al día.</p>
                {error && <AlertBanner variant="error" message={error} onDismiss={() => setError('')} />}
                {listo && <AlertBanner variant="success" message={listo} onDismiss={() => setListo('')} />}
                <div className="md-fila">
                    <input className="form-input" type="password" autoComplete="current-password" placeholder="Tu contraseña"
                        aria-label="Tu contraseña" value={password} onChange={(e) => setPassword(e.target.value)} />
                    <button className="btn btn-primary" disabled={!password || enviando} onClick={descargar}>
                        <FiDownload size={14} /> {enviando ? 'Generando…' : 'Descargar'}
                    </button>
                </div>
            </section>
        </div>
    );
}

// ── Solicitudes ───────────────────────────────────────────────────────────────

type DerechoAutoservicio = 'rectificacion' | 'supresion' | 'oposicion' | 'bloqueo';
const EXPLICACION: Record<DerechoAutoservicio, string> = {
    rectificacion: 'Corrige tu nombre, apellidos, RUT o fecha de nacimiento si están mal. Tu teléfono y correo los corriges directamente en Configuración.',
    supresion: 'Pide eliminar tus datos. Lo voluntario se suprime; lo que la ley obliga a conservar (por ejemplo, tus firmas de documentos del DS 44) se guarda bloqueado hasta que venza su plazo, y se te informa hasta cuándo.',
    oposicion: 'Pide que dejen de tratar tus datos para una finalidad determinada, en los casos que la ley lo permite.',
    bloqueo: 'Pide suspender temporalmente el uso de tus datos mientras se aclara algo.',
};
const CAMPOS: CampoRectificable[] = ['nombre', 'apellidoPaterno', 'apellidoMaterno', 'rut', 'fechaNacimiento'];

function Solicitudes() {
    const { user } = useAuth();
    const [lista, setLista] = useState<MiSolicitud[]>([]);
    const [derecho, setDerecho] = useState<DerechoAutoservicio | ''>('');
    const [cambios, setCambios] = useState<Partial<Record<CampoRectificable, string>>>({});
    const [detalle, setDetalle] = useState('');
    const [password, setPassword] = useState('');
    const [enviando, setEnviando] = useState(false);
    const [error, setError] = useState('');
    const [listo, setListo] = useState('');

    const cargar = useCallback(async () => {
        const r = await privacidadApi.solicitudes().catch(() => null);
        if (r?.success && r.data) setLista(r.data.solicitudes);
    }, []);
    useEffect(() => { cargar(); }, [cargar]);

    const actual: Partial<Record<CampoRectificable, string>> = {
        nombre: user?.nombre, apellidoPaterno: user?.apellidoPaterno, apellidoMaterno: user?.apellidoMaterno, rut: user?.rut,
    };
    const pedidos = Object.fromEntries(Object.entries(cambios).filter(([, v]) => v && v.trim())) as Partial<Record<CampoRectificable, string>>;
    const valido = derecho && password && (derecho !== 'rectificacion' || Object.keys(pedidos).length > 0);

    const enviar = async () => {
        if (!derecho) return;
        setEnviando(true);
        setError('');
        const r = await privacidadApi.solicitar({ derecho, detalle: detalle.trim() || undefined, cambios: derecho === 'rectificacion' ? pedidos : undefined, password }).catch(() => null);
        setEnviando(false);
        setPassword('');
        if (r?.success) {
            setListo('Tu solicitud quedó registrada. Tu empleador tiene 30 días para responderte; verás aquí cada paso.');
            setDerecho('');
            setCambios({});
            setDetalle('');
            cargar();
        } else setError(r?.error || 'No se pudo registrar tu solicitud.');
    };

    return (
        <div className="md-cuerpo">
            <section className="md-tarjeta">
                <h3 className="md-subtitulo">Nueva solicitud</h3>
                {error && <AlertBanner variant="error" message={error} onDismiss={() => setError('')} />}
                {listo && <AlertBanner variant="success" message={listo} onDismiss={() => setListo('')} />}
                <label className="form-label" htmlFor="md-derecho">Qué quieres pedir</label>
                <Select id="md-derecho" value={derecho} onChange={(v) => { setDerecho(v as DerechoAutoservicio); setListo(''); }} placeholder="Elige una opción"
                    options={(Object.keys(EXPLICACION) as DerechoAutoservicio[]).map((d) => ({ value: d, label: DERECHO_LABEL[d] }))} />
                {derecho && <p className="md-hint">{EXPLICACION[derecho]}</p>}
                {derecho && derecho !== 'rectificacion' && (
                    <p className="md-aviso"><FiClock aria-hidden /> Mientras se resuelve, tus datos quedan bloqueados: no se usan para nada nuevo, pero no se borran.</p>
                )}
                {derecho === 'rectificacion' && (
                    <div className="md-rejilla">
                        {CAMPOS.map((c) => (
                            <label key={c} className="md-campo">
                                <span className="form-label">{CAMPO_LABEL[c]}</span>
                                <input className="form-input" type={c === 'fechaNacimiento' ? 'date' : 'text'} value={cambios[c] || ''}
                                    placeholder={actual[c] ? `Hoy: ${actual[c]}` : 'Deja vacío si está bien'}
                                    onChange={(e) => setCambios((x) => ({ ...x, [c]: e.target.value }))} />
                            </label>
                        ))}
                        <p className="md-hint md-ancho">Escribe solo lo que hay que corregir, con el valor correcto.</p>
                    </div>
                )}
                {derecho && (
                    <>
                        <label className="form-label" htmlFor="md-detalle">Detalle (opcional)</label>
                        <textarea id="md-detalle" className="form-input" rows={3} maxLength={2000} value={detalle} onChange={(e) => setDetalle(e.target.value)} />
                        <label className="form-label" htmlFor="md-pass">Vuelve a escribir tu contraseña</label>
                        <div className="md-fila">
                            <input id="md-pass" className="form-input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
                            <button className="btn btn-primary" disabled={!valido || enviando} onClick={enviar}>{enviando ? 'Enviando…' : 'Enviar solicitud'}</button>
                        </div>
                    </>
                )}
            </section>

            <section className="md-seccion">
                <h3 className="md-subtitulo">Tus solicitudes</h3>
                {lista.length === 0 ? <p className="md-hint">No has hecho solicitudes.</p> : (
                    <ul className="md-lista">
                        {lista.map((s) => (
                            <li key={s.solicitudId} className="md-tarjeta">
                                <div className="md-tarjeta-cabeza">
                                    <strong>{DERECHO_LABEL[s.derecho]}</strong>
                                    <Badge variant={ETAPA_VARIANTE[s.etapa]}>{ETAPA_LABEL[s.etapa]}</Badge>
                                </div>
                                <span className="md-hint">
                                    Recibida el {fechaHora(s.recibidaEl)}
                                    {s.estado === 'abierta' ? ` · respuesta a más tardar el ${fecha(s.plazoVigente)}` : ''}
                                    {s.camposPedidos ? ` · ${s.camposPedidos.map((c) => CAMPO_LABEL[c]).join(', ')}` : ''}
                                </span>
                                {s.respuesta && (
                                    <p className="md-respuesta"><strong>{RESULTADO_LABEL[s.respuesta.resultado]}</strong> el {fecha(s.respuesta.respondidaEl)}. {s.respuesta.fundamento}</p>
                                )}
                            </li>
                        ))}
                    </ul>
                )}
            </section>
        </div>
    );
}

const estilos = `
    .md-cuerpo { display: flex; flex-direction: column; gap: var(--space-4, 16px); max-width: 860px; margin-top: var(--space-4, 16px); }
    .md-centro { display: flex; justify-content: center; padding: 32px; }
    .md-intro { margin: 0; color: var(--text-secondary); line-height: 1.55; }
    .md-tarjeta { border: 1px solid var(--surface-border); border-radius: var(--radius-md, 10px); padding: var(--space-4, 16px);
        background: var(--surface-elevated, transparent); display: flex; flex-direction: column; gap: var(--space-2, 8px); list-style: none; }
    .md-tarjeta-cabeza { display: flex; flex-wrap: wrap; gap: 8px; justify-content: space-between; align-items: center; }
    .md-subtitulo { margin: 0; font-size: 1rem; }
    .md-hint { margin: 0; font-size: 0.86rem; color: var(--text-secondary); line-height: 1.55; }
    .md-texto { margin: 0; padding: 12px 14px; border-left: 3px solid var(--accent, #2563eb); background: var(--surface-hover, rgba(0,0,0,0.03));
        font-size: 0.9rem; line-height: 1.6; display: flex; flex-direction: column; gap: 6px; }
    .md-version { font-size: 0.75rem; color: var(--text-secondary); }
    .md-acciones { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; justify-content: flex-end; }
    .md-check { display: flex; gap: 8px; align-items: center; font-size: 0.88rem; margin-right: auto; }
    .md-seccion { display: flex; flex-direction: column; gap: 8px; }
    .md-bases { margin: 0; padding-left: 18px; font-size: 0.88rem; line-height: 1.6; }
    .md-historial, .md-lista { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
    .md-historial li { display: grid; grid-template-columns: auto 1fr auto; gap: 8px; align-items: center; font-size: 0.88rem;
        padding: 6px 0; border-bottom: 1px solid var(--surface-border); }
    .md-historial time { color: var(--text-secondary); font-size: 0.8rem; }
    .md-fila { display: flex; gap: 8px; flex-wrap: wrap; }
    .md-fila .form-input { flex: 1; min-width: 180px; }
    .md-rejilla { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 10px; }
    .md-campo { display: flex; flex-direction: column; gap: 4px; }
    .md-ancho { grid-column: 1 / -1; }
    .md-aviso { margin: 0; display: flex; gap: 8px; align-items: center; font-size: 0.85rem; padding: 8px 10px; border-radius: 8px;
        background: rgba(245, 158, 11, 0.08); border: 1px solid rgba(245, 158, 11, 0.3); }
    .md-respuesta { margin: 0; font-size: 0.88rem; line-height: 1.55; }
    @media (max-width: 600px) { .md-historial li { grid-template-columns: auto 1fr; } .md-historial time { grid-column: 2; } }
`;
