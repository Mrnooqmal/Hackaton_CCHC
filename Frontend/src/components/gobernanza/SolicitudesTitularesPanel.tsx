import { useCallback, useEffect, useMemo, useState } from 'react';
import { FiPlus, FiAlertTriangle, FiLock, FiClock, FiFileText, FiDownload, FiUserCheck } from 'react-icons/fi';
import { AlertBanner, Badge, Modal, Select } from '../ui';
import type { BadgeVariant } from '../ui/Badge';
import { personasApi } from '../../api/personas.api';
import type { PersonaResponse } from '../../api/types';
import {
    gobernanzaApi, lotesApi, DERECHO_LABEL, RESULTADO_LABEL, DERECHOS_QUE_BLOQUEAN, ETAPA_LABEL, METODO_LABEL, CAMPO_LABEL, descargarJson,
    type Solicitud, type EventoHistorial, type Derecho, type Resultado, type MetodoVerificacion, type CampoRectificable, type Etapa,
} from '../../api/gobernanza.api';

/**
 * Solicitudes de los titulares (Ley 21.719).
 *
 * La constructora es la responsable del tratamiento de los datos de sus
 * trabajadores: acá registra cada solicitud con el canal por el que llegó, la
 * prorroga si hace falta y la responde. Las reglas las aplica el backend; esta
 * pantalla evita ofrecer lo que igual se rechazaría:
 *   - la fecha de recepción se ingresa una vez y no se puede corregir después;
 *   - la prórroga solo se ofrece mientras el primer plazo no vence;
 *   - rectificar, suprimir u oponerse bloquean el tratamiento en el acto.
 * El historial de cada solicitud solo crece: es lo que se muestra en una
 * fiscalización.
 */

const TZ = 'America/Santiago';
const fechaHora = (iso?: string | null) => (iso ? new Date(iso).toLocaleString('es-CL', { timeZone: TZ, dateStyle: 'medium', timeStyle: 'short' }) : '—');
const fecha = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString('es-CL', { timeZone: TZ, dateStyle: 'medium' }) : '—');
const DIA = 86400000;
const diasHasta = (iso: string) => Math.ceil((new Date(iso).getTime() - Date.now()) / DIA);

/** Valor para <input type="datetime-local"> en la hora del navegador. */
const aInputLocal = (d: Date) => {
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

const EVENTO_LABEL: Record<EventoHistorial['tipo'], string> = {
    solicitud: 'Solicitud registrada',
    bloqueo: 'Datos bloqueados',
    prorroga: 'Plazo prorrogado',
    respuesta: 'Respuesta',
    desbloqueo: 'Bloqueo levantado',
    supresion: 'Supresión ejecutada',
    alerta: 'Aviso de plazo',
    verificacion: 'Identidad verificada',
    ejecucion: 'Ejecutada',
};

const ETAPA_VARIANTE: Record<Etapa, BadgeVariant> = { recibida: 'warning', verificada: 'info', respondida: 'secondary', cerrada: 'success' };
/** Métodos que registra quien gestiona (el de sesión y contraseña lo pone el sistema). */
const METODOS_GESTION: MetodoVerificacion[] = ['presencial_cedula', 'correo_registrado', 'otro'];

const ALERTA_LABEL: Record<string, string> = {
    por_vencer: 'Plazo por vencer',
    vencida: 'Plazo vencido',
    prorroga_posible: 'Última oportunidad para prorrogar',
    bloqueo_pendiente: 'Bloqueo pendiente',
};

function Plazo({ s }: { s: Solicitud }) {
    if (s.estado === 'resuelta') {
        const dentro = s.respuesta?.dentroDePlazo;
        return <Badge variant={dentro ? 'success' : 'danger'}>{dentro ? 'Respondida en plazo' : 'Respondida fuera de plazo'}</Badge>;
    }
    const d = diasHasta(s.plazoVigente);
    const variante: BadgeVariant = d < 0 ? 'danger' : d <= 5 ? 'warning' : 'neutral';
    const texto = d < 0 ? `Vencida hace ${-d} día${-d === 1 ? '' : 's'}` : d === 0 ? 'Vence hoy' : `Quedan ${d} día${d === 1 ? '' : 's'}`;
    return <Badge variant={variante}>{texto}</Badge>;
}

export default function SolicitudesTitularesPanel({ puedeSuprimir = false }: { puedeSuprimir?: boolean }) {
    const [solicitudes, setSolicitudes] = useState<Solicitud[]>([]);
    const [personas, setPersonas] = useState<PersonaResponse[]>([]);
    const [filtro, setFiltro] = useState<'abierta' | 'resuelta' | 'todas'>('abierta');
    const [cargando, setCargando] = useState(true);
    const [error, setError] = useState('');
    const [registrando, setRegistrando] = useState(false);
    const [abierta, setAbierta] = useState<string | null>(null);

    const tenantId = localStorage.getItem('tenant_id') || '';

    const cargar = useCallback(async () => {
        setCargando(true);
        setError('');
        try {
            const [s, p] = await Promise.all([
                gobernanzaApi.listar(filtro === 'todas' ? undefined : filtro),
                personasApi.list(tenantId, { incluirBloqueadas: true }),
            ]);
            if (s.success && s.data) setSolicitudes(s.data.solicitudes);
            else setError(s.error || 'No se pudieron cargar las solicitudes.');
            if (p.success && p.data) setPersonas(p.data.personas);
        } catch {
            setError('Error de conexión al cargar las solicitudes.');
        } finally {
            setCargando(false);
        }
    }, [filtro, tenantId]);

    useEffect(() => { cargar(); }, [cargar]);

    const nombreDe = useMemo(() => {
        const m = new Map(personas.map((p) => [p.personaId, [p.nombre, p.apellido].filter(Boolean).join(' ')]));
        return (id: string) => m.get(id) || 'Persona no encontrada';
    }, [personas]);

    return (
        <div className="me-panel">
            {error && <AlertBanner variant="error" message={error} onDismiss={() => setError('')} />}

            <section className="me-section">
                <div className="me-section-head">
                    <h3 className="me-section-title">Solicitudes de los titulares</h3>
                    <p className="me-section-hint">
                        Acceso, rectificación, supresión, oposición y portabilidad de datos personales
                        (Ley 21.719). La empresa responde dentro de 30 días desde que llega la solicitud;
                        rectificar, suprimir u oponerse bloquea el tratamiento de los datos hasta resolver.
                    </p>
                </div>
                <div className="me-section-body st-barra">
                    <div className="st-filtros" role="tablist" aria-label="Filtrar solicitudes">
                        {(['abierta', 'resuelta', 'todas'] as const).map((f) => (
                            <button key={f} role="tab" aria-selected={filtro === f}
                                className={`btn btn-sm ${filtro === f ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setFiltro(f)}>
                                {f === 'abierta' ? 'Abiertas' : f === 'resuelta' ? 'Resueltas' : 'Todas'}
                            </button>
                        ))}
                    </div>
                    <button className="btn btn-primary btn-sm" onClick={() => setRegistrando(true)}>
                        <FiPlus size={14} /> Registrar solicitud
                    </button>
                </div>
            </section>

            <section className="me-section">
                <div className="me-section-body">
                    {cargando ? (
                        <div style={{ display: 'flex', justifyContent: 'center', padding: 24 }}><div className="spinner" /></div>
                    ) : solicitudes.length === 0 ? (
                        <p className="me-field-hint">
                            {filtro === 'abierta' ? 'No hay solicitudes abiertas.' : 'No hay solicitudes en esta vista.'}
                        </p>
                    ) : (
                        <ul className="st-lista">
                            {solicitudes.map((s) => (
                                <li key={s.solicitudId}>
                                    <button className="st-fila" onClick={() => setAbierta(s.solicitudId)}>
                                        <span className="st-titular">{nombreDe(s.personaId)}</span>
                                        <span className="st-meta">
                                            <Badge variant="info">{DERECHO_LABEL[s.derecho]}</Badge>
                                            {s.etapa && <Badge variant={ETAPA_VARIANTE[s.etapa]}>{ETAPA_LABEL[s.etapa]}</Badge>}
                                            {s.bloqueo?.exigido && s.estado === 'abierta' && (
                                                <Badge variant="secondary"><FiLock size={11} /> Datos bloqueados</Badge>
                                            )}
                                            <Plazo s={s} />
                                        </span>
                                        <span className="st-fechas">Recibida {fecha(s.recibidaEl)} · por {s.canal}</span>
                                        {s.alertas.length > 0 && s.estado === 'abierta' && (
                                            <span className="st-alertas">
                                                <FiAlertTriangle size={13} aria-hidden /> {s.alertas.map((a) => ALERTA_LABEL[a.tipo]).join(' · ')}
                                            </span>
                                        )}
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            </section>

            {registrando && (
                <RegistrarSolicitud
                    personas={personas}
                    onCerrar={() => setRegistrando(false)}
                    onRegistrada={() => { setRegistrando(false); setFiltro('abierta'); cargar(); }}
                />
            )}
            {abierta && (
                <DetalleSolicitud
                    solicitudId={abierta}
                    titular={nombreDe}
                    puedeSuprimir={puedeSuprimir}
                    onCerrar={() => setAbierta(null)}
                    onCambio={cargar}
                />
            )}

            <style>{estilos}</style>
        </div>
    );
}

// ── Registrar ─────────────────────────────────────────────────────────────────

function RegistrarSolicitud({ personas, onCerrar, onRegistrada }: {
    personas: PersonaResponse[];
    onCerrar: () => void;
    onRegistrada: () => void;
}) {
    const ahora = useMemo(() => new Date(), []);
    const [personaId, setPersonaId] = useState('');
    const [derecho, setDerecho] = useState<Derecho | ''>('');
    const [canal, setCanal] = useState('');
    const [recibida, setRecibida] = useState(aInputLocal(ahora));
    const [detalle, setDetalle] = useState('');
    const [metodo, setMetodo] = useState<MetodoVerificacion | ''>('');
    const [observacion, setObservacion] = useState('');
    const [enviando, setEnviando] = useState(false);
    const [error, setError] = useState('');

    const bloquea = derecho !== '' && DERECHOS_QUE_BLOQUEAN.includes(derecho);
    const valido = personaId && derecho && canal.trim().length >= 3 && recibida && new Date(recibida) <= new Date();

    const registrar = async () => {
        setEnviando(true);
        setError('');
        try {
            const r = await gobernanzaApi.registrar({
                personaId, derecho: derecho as Derecho, canal: canal.trim(),
                recibidaEl: new Date(recibida).toISOString(), detalle: detalle.trim() || undefined,
                verificacion: metodo ? { metodo, observacion: observacion.trim() || undefined } : undefined,
            });
            if (r.success) onRegistrada();
            else setError(r.error || 'No se pudo registrar la solicitud.');
        } catch {
            setError('Error de conexión al registrar la solicitud.');
        } finally {
            setEnviando(false);
        }
    };

    return (
        <Modal
            isOpen
            onClose={() => !enviando && onCerrar()}
            title="Registrar solicitud de un titular"
            icon={<FiFileText size={20} />}
            size="md"
            footer={
                <>
                    <button className="btn btn-secondary" disabled={enviando} onClick={onCerrar}>Cancelar</button>
                    <button className="btn btn-primary" disabled={enviando || !valido} onClick={registrar}>
                        {enviando ? 'Registrando…' : 'Registrar'}
                    </button>
                </>
            }
        >
            <div className="st-form">
                {error && <AlertBanner variant="error" message={error} onDismiss={() => setError('')} />}
                <label className="form-label" htmlFor="st-persona">Titular</label>
                <Select
                    id="st-persona"
                    value={personaId}
                    onChange={setPersonaId}
                    searchable
                    placeholder="Buscar persona"
                    options={personas.map((p) => ({ value: p.personaId, label: `${[p.nombre, p.apellido].filter(Boolean).join(' ')} · ${p.rut}` }))}
                />
                <label className="form-label" htmlFor="st-derecho">Qué pide</label>
                <Select
                    id="st-derecho"
                    value={derecho}
                    onChange={(v) => setDerecho(v as Derecho)}
                    placeholder="Derecho que ejerce"
                    options={(Object.keys(DERECHO_LABEL) as Derecho[]).map((d) => ({ value: d, label: DERECHO_LABEL[d] }))}
                />
                <label className="form-label" htmlFor="st-canal">Por dónde llegó</label>
                <input id="st-canal" className="form-input" value={canal} onChange={(e) => setCanal(e.target.value)}
                    maxLength={120} placeholder="Ej.: correo a rrhh@empresa.cl, carta en oficina central, en persona en obra" />
                <label className="form-label" htmlFor="st-recibida">Cuándo llegó</label>
                <input id="st-recibida" type="datetime-local" className="form-input" value={recibida}
                    max={aInputLocal(new Date())} onChange={(e) => setRecibida(e.target.value)} />
                <p className="me-field-hint">
                    El plazo de respuesta parte cuando llegó la solicitud, no cuando se registra.
                    Esta fecha no se puede corregir después.
                </p>
                <label className="form-label" htmlFor="st-detalle">Detalle (opcional)</label>
                <textarea id="st-detalle" className="form-input" rows={3} maxLength={2000} value={detalle}
                    onChange={(e) => setDetalle(e.target.value)} placeholder="Qué pide, en sus palabras" />
                <label className="form-label" htmlFor="st-metodo">Cómo se verificó su identidad (si ya se hizo)</label>
                <Select id="st-metodo" value={metodo} onChange={(v) => setMetodo(v as MetodoVerificacion)} placeholder="Todavía no se verifica"
                    options={METODOS_GESTION.map((m) => ({ value: m, label: METODO_LABEL[m] }))} />
                {metodo === 'otro' && (
                    <input className="form-input" value={observacion} maxLength={300} onChange={(e) => setObservacion(e.target.value)}
                        placeholder="Cómo se verificó. Sin números de documento." />
                )}
                <p className="me-field-hint">
                    No se puede acoger una solicitud sin verificar antes la identidad de quien la presenta.
                    Se registra el método, nunca el número ni una copia del documento.
                </p>
                {bloquea && (
                    <div className="st-aviso">
                        <FiLock size={15} aria-hidden />
                        <span>
                            Al registrarla, los datos de esta persona quedan bloqueados: sale de los listados,
                            no se la convoca ni se le avisa, y no puede firmar hasta que se responda. Los datos no se borran.
                        </span>
                    </div>
                )}
            </div>
        </Modal>
    );
}

// ── Detalle, prórroga y respuesta ─────────────────────────────────────────────

function DetalleSolicitud({ solicitudId, titular, puedeSuprimir, onCerrar, onCambio }: {
    solicitudId: string;
    titular: (id: string) => string;
    puedeSuprimir: boolean;
    onCerrar: () => void;
    onCambio: () => void;
}) {
    const [s, setS] = useState<(Solicitud & { historial: EventoHistorial[]; cambiosPropuestos: Partial<Record<CampoRectificable, string>> | null }) | null>(null);
    const [error, setError] = useState('');
    const [accion, setAccion] = useState<'prorroga' | 'respuesta' | 'verificacion' | null>(null);
    const [exportando, setExportando] = useState(false);

    const cargar = useCallback(async () => {
        const r = await gobernanzaApi.detalle(solicitudId).catch(() => null);
        if (r?.success && r.data) setS(r.data);
        else setError(r?.error || 'No se pudo cargar la solicitud.');
    }, [solicitudId]);
    useEffect(() => { cargar(); }, [cargar]);

    const listo = () => { setAccion(null); cargar(); onCambio(); };
    const [propuesto, setPropuesto] = useState('');
    const proponerLote = async () => {
        setError('');
        const r = await lotesApi.proponerSolicitud(solicitudId).catch(() => null);
        if (r?.success) setPropuesto('Lote de supresión propuesto. Apruébalo y ejecútalo en Supresiones (dos personas).');
        else setError(r?.error || 'No se pudo proponer el lote.');
    };
    const exportar = async () => {
        setExportando(true);
        setError('');
        const r = await gobernanzaApi.exportar(solicitudId).catch(() => null);
        setExportando(false);
        if (r?.success && r.data) {
            descargarJson(r.data, `datos-titular-${solicitudId.slice(0, 8)}.json`);
            cargar();
            onCambio();
        } else setError(r?.error || 'No se pudo generar la copia.');
    };
    const exportable = s && ['acceso', 'portabilidad'].includes(s.derecho) && s.estado === 'abierta' && s.verificacion;
    const suprimible = s && s.derecho === 'supresion' && s.estado === 'resuelta' && s.respuesta?.resultado !== 'rechazada' && !s.ejecucion;
    const puedeProrrogar = s && s.estado === 'abierta' && !s.prorroga && new Date() <= new Date(s.venceEl);

    return (
        <Modal isOpen onClose={onCerrar} title={s ? `${DERECHO_LABEL[s.derecho]} · ${titular(s.personaId)}` : 'Solicitud'} size="lg">
            {error && <AlertBanner variant="error" message={error} onDismiss={() => setError('')} />}
            {!s ? (
                <div style={{ display: 'flex', justifyContent: 'center', padding: 24 }}><div className="spinner" /></div>
            ) : (
                <div className="st-detalle">
                    <dl className="st-datos">
                        <div><dt>Recibida</dt><dd>{fechaHora(s.recibidaEl)}</dd></div>
                        <div><dt>Canal</dt><dd>{s.canal}</dd></div>
                        <div><dt>Registrada</dt><dd>{fechaHora(s.registradaEl)} por {s.registradaPor.nombre || 'sin nombre'}</dd></div>
                        <div><dt>Plazo de respuesta</dt><dd>{fecha(s.plazoVigente)} {s.prorroga ? '(prorrogado)' : ''} <Plazo s={s} /></dd></div>
                        <div><dt>Etapa</dt><dd><Badge variant={ETAPA_VARIANTE[s.etapa]}>{ETAPA_LABEL[s.etapa]}</Badge></dd></div>
                        <div><dt>Identidad</dt><dd>{s.verificacion
                            ? <><FiUserCheck size={13} aria-hidden /> {METODO_LABEL[s.verificacion.metodo]}, {fechaHora(s.verificacion.verificadaEl)}{s.verificacion.observacion ? `. ${s.verificacion.observacion}` : ''}</>
                            : 'Sin verificar'}</dd></div>
                        {s.bloqueo?.exigido && (
                            <div><dt>Bloqueo</dt><dd>{s.bloqueo.aplicadoEl ? `Aplicado el ${fechaHora(s.bloqueo.aplicadoEl)}` : 'Pendiente'}</dd></div>
                        )}
                        {s.detalle && <div className="st-ancho"><dt>Detalle</dt><dd>{s.detalle}</dd></div>}
                        {s.cambiosPropuestos && (
                            <div className="st-ancho"><dt>Corrección que pide</dt><dd>
                                <ul className="st-cambios">
                                    {(Object.keys(s.cambiosPropuestos) as CampoRectificable[]).map((c) => (
                                        <li key={c}><strong>{CAMPO_LABEL[c]}:</strong> {s.cambiosPropuestos![c]}</li>
                                    ))}
                                </ul>
                                <span className="me-field-hint">Se aplica al acoger. Los valores propuestos se borran de la solicitud al responder.</span>
                            </dd></div>
                        )}
                        {s.ejecucion && <div><dt>Ejecutada</dt><dd>{fechaHora(s.ejecucion.en)} por {s.ejecucion.por?.nombre || 'sin nombre'}</dd></div>}
                        {s.respuesta && (
                            <div className="st-ancho"><dt>Respuesta</dt><dd>
                                <strong>{RESULTADO_LABEL[s.respuesta.resultado]}</strong>, {fechaHora(s.respuesta.respondidaEl)} por {s.respuesta.por.nombre || 'sin nombre'}.
                                <br />{s.respuesta.fundamento}
                            </dd></div>
                        )}
                    </dl>

                    {s.estado === 'abierta' && !accion && (
                        <div className="st-acciones">
                            {puedeProrrogar ? (
                                <button className="btn btn-secondary btn-sm" onClick={() => setAccion('prorroga')}>
                                    <FiClock size={14} /> Registrar prórroga
                                </button>
                            ) : !s.prorroga && (
                                <span className="me-field-hint">El primer plazo venció: ya no se puede prorrogar.</span>
                            )}
                            {!s.verificacion && (
                                <button className="btn btn-secondary btn-sm" onClick={() => setAccion('verificacion')}>
                                    <FiUserCheck size={14} /> Registrar verificación
                                </button>
                            )}
                            {exportable && (
                                <button className="btn btn-secondary btn-sm" disabled={exportando} onClick={exportar}>
                                    <FiDownload size={14} /> {exportando ? 'Generando…' : 'Descargar copia de sus datos'}
                                </button>
                            )}
                            <button className="btn btn-primary btn-sm" onClick={() => setAccion('respuesta')}>Responder</button>
                        </div>
                    )}
                    {accion === 'verificacion' && <FormVerificacion s={s} onCancelar={() => setAccion(null)} onListo={listo} />}
                    {suprimible && puedeSuprimir && !propuesto && (
                        <div className="st-acciones">
                            <button className="btn btn-secondary btn-sm" onClick={proponerLote}>Proponer lote de supresión</button>
                        </div>
                    )}
                    {propuesto && <AlertBanner variant="success" message={propuesto} onDismiss={() => setPropuesto('')} />}
                    {accion === 'prorroga' && <FormProrroga s={s} onCancelar={() => setAccion(null)} onListo={listo} />}
                    {accion === 'respuesta' && <FormRespuesta s={s} cambios={s.cambiosPropuestos} onCancelar={() => setAccion(null)} onListo={listo} />}

                    <h4 className="st-subtitulo">Historial</h4>
                    <p className="me-field-hint">Cada paso queda registrado y no se puede editar ni borrar.</p>
                    <ol className="st-historial">
                        {s.historial.map((e) => (
                            <li key={e.sk}>
                                <span className="st-ev-tipo">{EVENTO_LABEL[e.tipo] || e.tipo}</span>
                                <time dateTime={e.en}>{fechaHora(e.en)}</time>
                                <span className="st-ev-quien">{'sistema' in e.por ? 'Sistema' : e.por.nombre || 'sin nombre'}</span>
                                {e.tipo === 'prorroga' && <span className="st-ev-detalle">Comunicada {fecha(String(e.datos.comunicadaEl))}. {String(e.datos.motivo || '')}</span>}
                                {e.tipo === 'respuesta' && <span className="st-ev-detalle">{RESULTADO_LABEL[e.datos.resultado as Resultado]}{e.datos.dentroDePlazo ? '' : ' (fuera de plazo)'}</span>}
                                {e.tipo === 'alerta' && <span className="st-ev-detalle">{ALERTA_LABEL[String(e.datos.tipo)] || String(e.datos.tipo)}</span>}
                                {e.tipo === 'verificacion' && <span className="st-ev-detalle">{METODO_LABEL[e.datos.metodo as MetodoVerificacion] || String(e.datos.metodo)}</span>}
                                {e.tipo === 'ejecucion' && Array.isArray(e.datos.campos) && <span className="st-ev-detalle">Campos corregidos: {(e.datos.campos as CampoRectificable[]).map((c) => CAMPO_LABEL[c] || c).join(', ')}</span>}
                            </li>
                        ))}
                    </ol>
                </div>
            )}
        </Modal>
    );
}

function FormProrroga({ s, onCancelar, onListo }: { s: Solicitud; onCancelar: () => void; onListo: () => void }) {
    const [comunicada, setComunicada] = useState(aInputLocal(new Date()));
    const [motivo, setMotivo] = useState('');
    const [medio, setMedio] = useState('');
    const [enviando, setEnviando] = useState(false);
    const [error, setError] = useState('');
    const enviar = async () => {
        setEnviando(true);
        setError('');
        const r = await gobernanzaApi.prorrogar(s.solicitudId, { comunicadaEl: new Date(comunicada).toISOString(), motivo: motivo.trim(), medio: medio.trim() || undefined }).catch(() => null);
        setEnviando(false);
        if (r?.success) onListo(); else setError(r?.error || 'No se pudo registrar la prórroga.');
    };
    return (
        <div className="st-form st-subform">
            {error && <AlertBanner variant="error" message={error} onDismiss={() => setError('')} />}
            <p className="me-field-hint">
                La prórroga suma 30 días y se usa una sola vez. Solo vale si se le comunicó al titular antes del
                {' '}{fecha(s.venceEl)}.
            </p>
            <label className="form-label" htmlFor="st-comunicada">Cuándo se le comunicó</label>
            <input id="st-comunicada" type="datetime-local" className="form-input" value={comunicada}
                max={aInputLocal(new Date())} onChange={(e) => setComunicada(e.target.value)} />
            <label className="form-label" htmlFor="st-medio">Por qué medio</label>
            <input id="st-medio" className="form-input" value={medio} maxLength={120} onChange={(e) => setMedio(e.target.value)} placeholder="Ej.: correo" />
            <label className="form-label" htmlFor="st-motivo">Motivo</label>
            <textarea id="st-motivo" className="form-input" rows={2} maxLength={1000} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
            <div className="st-acciones">
                <button className="btn btn-secondary btn-sm" disabled={enviando} onClick={onCancelar}>Cancelar</button>
                <button className="btn btn-primary btn-sm" disabled={enviando || motivo.trim().length < 10} onClick={enviar}>
                    {enviando ? 'Guardando…' : 'Registrar prórroga'}
                </button>
            </div>
        </div>
    );
}

function FormVerificacion({ s, onCancelar, onListo }: { s: Solicitud; onCancelar: () => void; onListo: () => void }) {
    const [metodo, setMetodo] = useState<MetodoVerificacion | ''>('');
    const [observacion, setObservacion] = useState('');
    const [enviando, setEnviando] = useState(false);
    const [error, setError] = useState('');
    const enviar = async () => {
        setEnviando(true);
        setError('');
        const r = await gobernanzaApi.verificar(s.solicitudId, { metodo: metodo as MetodoVerificacion, observacion: observacion.trim() || undefined }).catch(() => null);
        setEnviando(false);
        if (r?.success) onListo(); else setError(r?.error || 'No se pudo registrar la verificación.');
    };
    return (
        <div className="st-form st-subform">
            {error && <AlertBanner variant="error" message={error} onDismiss={() => setError('')} />}
            <p className="me-field-hint">Pide lo mínimo para saber que es el titular. Se registra el método, nunca el número de documento.</p>
            <label className="form-label" htmlFor="st-metodo-v">Cómo se verificó</label>
            <Select id="st-metodo-v" value={metodo} onChange={(v) => setMetodo(v as MetodoVerificacion)} placeholder="Método"
                options={METODOS_GESTION.map((m) => ({ value: m, label: METODO_LABEL[m] }))} />
            {metodo === 'otro' && (
                <input className="form-input" value={observacion} maxLength={300} onChange={(e) => setObservacion(e.target.value)}
                    placeholder="Describe cómo, sin números de documento" />
            )}
            <div className="st-acciones">
                <button className="btn btn-secondary btn-sm" disabled={enviando} onClick={onCancelar}>Cancelar</button>
                <button className="btn btn-primary btn-sm" disabled={enviando || !metodo || (metodo === 'otro' && observacion.trim().length < 10)} onClick={enviar}>
                    {enviando ? 'Guardando…' : 'Registrar verificación'}
                </button>
            </div>
        </div>
    );
}

function FormRespuesta({ s, cambios, onCancelar, onListo }: {
    s: Solicitud;
    cambios: Partial<Record<CampoRectificable, string>> | null;
    onCancelar: () => void;
    onListo: () => void;
}) {
    const [resultado, setResultado] = useState<Resultado | ''>('');
    const [fundamento, setFundamento] = useState('');
    const [medio, setMedio] = useState('');
    const campos = cambios ? (Object.keys(cambios) as CampoRectificable[]) : [];
    const [aceptados, setAceptados] = useState<CampoRectificable[]>(campos);
    const [enviando, setEnviando] = useState(false);
    const [error, setError] = useState('');
    const rectifica = s.derecho === 'rectificacion' && campos.length > 0 && resultado !== '' && resultado !== 'rechazada';
    const enviar = async () => {
        setEnviando(true);
        setError('');
        const r = await gobernanzaApi.responder(s.solicitudId, {
            resultado: resultado as Resultado, fundamento: fundamento.trim(), medio: medio.trim() || undefined,
            ...(rectifica ? { camposAceptados: aceptados } : {}),
        }).catch(() => null);
        setEnviando(false);
        if (r?.success) onListo(); else setError(r?.error || 'No se pudo registrar la respuesta.');
    };
    const suprimeYAcoge = s.derecho === 'supresion' && resultado !== '' && resultado !== 'rechazada';
    return (
        <div className="st-form st-subform">
            {error && <AlertBanner variant="error" message={error} onDismiss={() => setError('')} />}
            <label className="form-label" htmlFor="st-resultado">Resultado</label>
            <Select id="st-resultado" value={resultado} onChange={(v) => setResultado(v as Resultado)} placeholder="Resultado"
                options={(Object.keys(RESULTADO_LABEL) as Resultado[])
                    .filter((r) => r === 'rechazada' || s.verificacion)
                    .map((r) => ({ value: r, label: RESULTADO_LABEL[r] }))} />
            {!s.verificacion && (
                <p className="me-field-hint">Sin la identidad verificada solo se puede rechazar (por ejemplo, porque no fue posible verificarla).</p>
            )}
            {rectifica && (
                <fieldset className="st-campos">
                    <legend className="form-label">Qué se corrige</legend>
                    {campos.map((c) => (
                        <label key={c} className="st-check">
                            <input type="checkbox" checked={aceptados.includes(c)}
                                onChange={(e) => setAceptados((a) => (e.target.checked ? [...a, c] : a.filter((x) => x !== c)))} />
                            {CAMPO_LABEL[c]}: {cambios![c]}
                        </label>
                    ))}
                </fieldset>
            )}
            <label className="form-label" htmlFor="st-fundamento">Qué se hizo y con qué fundamento</label>
            <textarea id="st-fundamento" className="form-input" rows={4} maxLength={4000} value={fundamento} onChange={(e) => setFundamento(e.target.value)}
                placeholder="Es lo que se le comunica al titular. Si se conserva algo, di hasta cuándo y por qué." />
            <label className="form-label" htmlFor="st-medio-r">Por qué medio se le comunicó</label>
            <input id="st-medio-r" className="form-input" value={medio} maxLength={120} onChange={(e) => setMedio(e.target.value)} placeholder="Ej.: correo" />
            {suprimeYAcoge && (
                <div className="st-aviso">
                    <FiLock size={15} aria-hidden />
                    <span>Los datos siguen bloqueados hasta que se ejecute la supresión, en un lote aprobado por dos personas.</span>
                </div>
            )}
            <div className="st-acciones">
                <button className="btn btn-secondary btn-sm" disabled={enviando} onClick={onCancelar}>Cancelar</button>
                <button className="btn btn-primary btn-sm" disabled={enviando || !resultado || fundamento.trim().length < 20 || (rectifica && aceptados.length === 0)} onClick={enviar}>
                    {enviando ? 'Guardando…' : 'Registrar respuesta'}
                </button>
            </div>
        </div>
    );
}

const estilos = `
    .st-barra { display: flex; flex-wrap: wrap; gap: var(--space-3); justify-content: space-between; align-items: center; }
    .st-filtros { display: flex; gap: var(--space-2); flex-wrap: wrap; }
    .st-lista { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--space-2); }
    .st-fila {
        width: 100%; text-align: left; display: grid; gap: 6px; padding: var(--space-3) var(--space-4);
        border: 1px solid var(--surface-border); border-radius: var(--radius-md); background: var(--surface-card, transparent);
        cursor: pointer; color: var(--text-primary);
    }
    .st-fila:hover { background: var(--surface-hover, rgba(0,0,0,0.03)); }
    .st-fila:focus-visible { outline: 2px solid var(--primary-500); outline-offset: 2px; }
    .st-titular { font-weight: 600; font-size: 0.95rem; }
    .st-meta { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
    .st-fechas { font-size: 0.8rem; color: var(--text-secondary); }
    .st-alertas { display: flex; gap: 6px; align-items: center; font-size: 0.8rem; color: var(--warning-800, #92400e); }
    .st-form { display: flex; flex-direction: column; gap: var(--space-2); }
    .st-subform { padding: var(--space-3); border: 1px solid var(--surface-border); border-radius: var(--radius-md); margin: var(--space-3) 0; }
    .st-aviso { display: flex; gap: 8px; align-items: flex-start; padding: 10px 12px; border-radius: var(--radius-md);
        background: rgba(245, 158, 11, 0.08); border: 1px solid rgba(245, 158, 11, 0.3); font-size: 0.84rem; line-height: 1.5; }
    .st-aviso svg { flex-shrink: 0; margin-top: 3px; }
    .st-detalle { display: flex; flex-direction: column; gap: var(--space-3); }
    .st-datos { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: var(--space-3); margin: 0; }
    .st-datos dt { font-size: 0.75rem; color: var(--text-secondary); margin-bottom: 2px; }
    .st-datos dd { margin: 0; font-size: 0.9rem; line-height: 1.5; }
    .st-datos .st-ancho { grid-column: 1 / -1; }
    .st-acciones { display: flex; flex-wrap: wrap; gap: var(--space-2); justify-content: flex-end; align-items: center; }
    .st-subtitulo { margin: var(--space-2) 0 0; font-size: 0.95rem; }
    .st-historial { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--space-2); }
    .st-historial li { display: grid; grid-template-columns: minmax(160px, 1fr) auto; gap: 2px var(--space-3);
        padding: var(--space-2) 0; border-bottom: 1px solid var(--surface-border); font-size: 0.86rem; }
    .st-ev-tipo { font-weight: 600; }
    .st-historial time, .st-ev-quien { color: var(--text-secondary); }
    .st-ev-detalle { grid-column: 1 / -1; color: var(--text-secondary); }
    @media (max-width: 600px) { .st-historial li { grid-template-columns: 1fr; } }
    .st-cambios { margin: 0 0 4px; padding-left: 18px; }
    .st-campos { border: 1px solid var(--surface-border); border-radius: var(--radius-md); padding: var(--space-2) var(--space-3); margin: 0; display: flex; flex-direction: column; gap: 6px; }
    .st-check { display: flex; gap: 8px; align-items: center; font-size: 0.88rem; }
`;
