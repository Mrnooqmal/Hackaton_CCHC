import { useCallback, useEffect, useMemo, useState } from 'react';
import { FiTrash2, FiAlertTriangle, FiCheck, FiRefreshCw } from 'react-icons/fi';
import { AlertBanner, Badge, Modal } from '../ui';
import type { BadgeVariant } from '../ui/Badge';
import { useAuth } from '../../context/AuthContext';
import { personasApi } from '../../api/personas.api';
import type { PersonaResponse } from '../../api/types';
import { lotesApi, type LoteResumen, type LoteDetalle, type EstadoLote } from '../../api/gobernanza.api';

/**
 * Lotes de supresión (Ley 21.719): la única forma de borrar datos personales.
 *
 * Quien aprueba ve EXACTAMENTE qué se va a suprimir —cada operación y cada
 * versión de cada archivo— y aprueba eso: la pantalla envía la huella de lo que
 * muestra. Otra persona lo ejecuta. Si los datos cambian en el medio, el
 * backend lo detecta y hay que proponer y aprobar de nuevo.
 */

const TZ = 'America/Santiago';
const fechaHora = (iso?: string) => (iso ? new Date(iso).toLocaleString('es-CL', { timeZone: TZ, dateStyle: 'medium', timeStyle: 'short' }) : '—');

const ESTADO: Record<EstadoLote, { texto: string; variante: BadgeVariant }> = {
    propuesto: { texto: 'Por aprobar', variante: 'warning' },
    aprobado: { texto: 'Aprobado, por ejecutar', variante: 'info' },
    desactualizado: { texto: 'Desactualizado', variante: 'neutral' },
    ejecutando: { texto: 'Ejecutándose', variante: 'info' },
    ejecutado: { texto: 'Ejecutado', variante: 'success' },
    ejecutado_con_errores: { texto: 'Ejecutado con errores', variante: 'danger' },
};

const ACCION: Record<string, string> = { suprimir: 'Suprimir', anonimizar: 'Anonimizar (se conserva el hecho)', quitar_campos: 'Quitar campos' };

export default function LotesSupresionPanel() {
    const [lotes, setLotes] = useState<LoteResumen[]>([]);
    const [personas, setPersonas] = useState<PersonaResponse[]>([]);
    const [cargando, setCargando] = useState(true);
    const [error, setError] = useState('');
    const [proponiendo, setProponiendo] = useState(false);
    const [abierto, setAbierto] = useState<string | null>(null);
    const tenantId = localStorage.getItem('tenant_id') || '';

    const cargar = useCallback(async () => {
        setCargando(true);
        const [l, p] = await Promise.all([lotesApi.listar().catch(() => null), personasApi.list(tenantId, { incluirBloqueadas: true }).catch(() => null)]);
        if (l?.success && l.data) setLotes(l.data.lotes); else setError(l?.error || 'No se pudieron cargar los lotes.');
        if (p?.success && p.data) setPersonas(p.data.personas);
        setCargando(false);
    }, [tenantId]);
    useEffect(() => { cargar(); }, [cargar]);

    const nombreDe = useMemo(() => {
        const m = new Map(personas.map((p) => [p.personaId, [p.nombre, p.apellido].filter(Boolean).join(' ')]));
        return (id?: string) => (id ? m.get(id) || 'persona no identificada' : '—');
    }, [personas]);

    const proponerRetencion = async () => {
        setProponiendo(true);
        setError('');
        const r = await lotesApi.proponerRetencion().catch(() => null);
        setProponiendo(false);
        if (r?.success && r.data) { await cargar(); setAbierto(r.data.loteId); } else setError(r?.error || 'No se pudo proponer el lote.');
    };

    return (
        <div className="me-panel">
            {error && <AlertBanner variant={error.includes('No hay nada') ? 'info' : 'error'} message={error} onDismiss={() => setError('')} />}
            <section className="me-section">
                <div className="me-section-head">
                    <h3 className="me-section-title">Supresiones</h3>
                    <p className="me-section-hint">
                        Borrar datos personales exige dos personas: una aprueba el lote viendo exactamente qué se
                        suprime, y otra lo ejecuta. Es irreversible, incluidos los archivos y todas sus versiones.
                    </p>
                </div>
                <div className="me-section-body lt-barra">
                    <button className="btn btn-secondary btn-sm" disabled={proponiendo} onClick={proponerRetencion}>
                        <FiRefreshCw size={14} /> {proponiendo ? 'Calculando…' : 'Proponer lote de plazos vencidos'}
                    </button>
                    <span className="me-field-hint">Las supresiones pedidas por un titular se proponen desde su solicitud.</span>
                </div>
            </section>

            <section className="me-section">
                <div className="me-section-body">
                    {cargando ? (
                        <div style={{ display: 'flex', justifyContent: 'center', padding: 24 }}><div className="spinner" /></div>
                    ) : lotes.length === 0 ? (
                        <p className="me-field-hint">No hay lotes de supresión.</p>
                    ) : (
                        <ul className="lt-lista">
                            {lotes.map((l) => (
                                <li key={l.loteId}>
                                    <button className="lt-fila" onClick={() => setAbierto(l.loteId)}>
                                        <span className="lt-titulo">{l.ambito.origen === 'retencion' ? 'Plazos de conservación vencidos' : 'Solicitud de supresión de un titular'}</span>
                                        <span className="lt-meta">
                                            <Badge variant={ESTADO[l.estado]?.variante || 'neutral'}>{ESTADO[l.estado]?.texto || l.estado}</Badge>
                                            <span>{l.operaciones} operaciones · {l.archivos} archivos · {l.personas} personas</span>
                                        </span>
                                        <span className="lt-fechas">Propuesto {fechaHora(l.propuestoEl)}{l.aprobadoPor ? ` · aprobado por ${l.aprobadoPor.nombre || 'sin nombre'}` : ''}{l.ejecutadoPor ? ` · ejecutado por ${l.ejecutadoPor.nombre || 'sin nombre'}` : ''}</span>
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            </section>

            {abierto && <DetalleLote loteId={abierto} nombreDe={nombreDe} onCerrar={() => setAbierto(null)} onCambio={cargar} />}
            <style>{estilos}</style>
        </div>
    );
}

function DetalleLote({ loteId, nombreDe, onCerrar, onCambio }: {
    loteId: string;
    nombreDe: (id?: string) => string;
    onCerrar: () => void;
    onCambio: () => void;
}) {
    const { user } = useAuth();
    const yo = (user as any)?.personaId as string | undefined;
    const [l, setL] = useState<LoteDetalle | null>(null);
    const [error, setError] = useState('');
    const [confirmando, setConfirmando] = useState<'aprobar' | 'ejecutar' | null>(null);
    const [texto, setTexto] = useState('');
    const [enviando, setEnviando] = useState(false);

    const cargar = useCallback(async () => {
        const r = await lotesApi.detalle(loteId).catch(() => null);
        if (r?.success && r.data) setL(r.data); else setError(r?.error || 'No se pudo cargar el lote.');
    }, [loteId]);
    useEffect(() => { cargar(); }, [cargar]);

    const personaDeOp = (clave: Record<string, string>) => {
        const sk = clave.SK || '';
        return sk.startsWith('PERSONA#') ? nombreDe(sk.slice(8)) : null;
    };

    const actuar = async () => {
        if (!l || !confirmando) return;
        setEnviando(true);
        setError('');
        const r = await (confirmando === 'aprobar' ? lotesApi.aprobar(l.loteId, l.huella) : lotesApi.ejecutar(l.loteId, l.huella)).catch(() => null);
        setEnviando(false);
        setConfirmando(null);
        setTexto('');
        if (!r?.success) setError(r?.error || 'No se pudo completar la acción.');
        await cargar();
        onCambio();
    };

    const aprobadoPorMi = l?.aprobadoPor?.personaId === yo;
    const frase = confirmando === 'ejecutar' ? 'SUPRIMIR' : 'APROBAR';

    return (
        <Modal isOpen onClose={onCerrar} title="Lote de supresión" icon={<FiTrash2 size={20} />} size="lg">
            {error && <AlertBanner variant="error" message={error} onDismiss={() => setError('')} />}
            {!l ? (
                <div style={{ display: 'flex', justifyContent: 'center', padding: 24 }}><div className="spinner" /></div>
            ) : (
                <div className="lt-detalle">
                    <div className="lt-meta">
                        <Badge variant={ESTADO[l.estado]?.variante || 'neutral'}>{ESTADO[l.estado]?.texto || l.estado}</Badge>
                        {l.vigente === false && (
                            <span className="lt-desactualizado"><FiAlertTriangle size={14} aria-hidden /> Los datos cambiaron desde que se propuso: no se puede aprobar ni ejecutar. Propón uno nuevo.</span>
                        )}
                    </div>
                    <p className="me-field-hint">
                        Propuesto {fechaHora(l.propuestoEl)} por {l.propuestoPor?.nombre || 'el sistema'}
                        {l.aprobadoPor && <> · aprobado {fechaHora(l.aprobadoEl)} por {l.aprobadoPor.nombre || 'sin nombre'}</>}
                        {l.ejecutadoPor && <> · ejecutado por {l.ejecutadoPor.nombre || 'sin nombre'}</>}
                    </p>

                    <h4 className="lt-subtitulo">Personas afectadas</h4>
                    <p className="lt-texto">{l.contenido.personas.map(nombreDe).join(', ') || '—'}</p>

                    <h4 className="lt-subtitulo">Qué se suprime ({l.contenido.operaciones.length})</h4>
                    <ol className="lt-ops">
                        {l.contenido.operaciones.map((op, i) => (
                            <li key={i}>
                                <strong>{ACCION[op.accion] || op.accion}</strong> · {op.que || op.tabla}
                                {personaDeOp(op.clave) && <> de {personaDeOp(op.clave)}</>}
                                {op.campos && <span className="lt-campos"> — campos: {op.campos.join(', ')}</span>}
                                {op.traza && <span className="lt-campos"> — y su parte sensible (RUT, IP)</span>}
                                <code className="lt-clave">{Object.values(op.clave).join(' / ')}</code>
                            </li>
                        ))}
                    </ol>

                    {l.contenido.archivos.length > 0 && (
                        <>
                            <h4 className="lt-subtitulo">Archivos ({l.contenido.archivos.length}), con todas sus versiones</h4>
                            <ul className="lt-ops">
                                {l.contenido.archivos.map((a) => (
                                    <li key={a.key}><code className="lt-clave">{a.key}</code> · {a.versiones.length} versión(es)</li>
                                ))}
                            </ul>
                        </>
                    )}
                    <p className="me-field-hint">Huella del contenido: <code>{l.huella.slice(0, 16)}…</code> Se aprueba y ejecuta exactamente este contenido.</p>

                    {l.vigente !== false && l.estado === 'propuesto' && (
                        <div className="lt-acciones">
                            <button className="btn btn-primary btn-sm" onClick={() => setConfirmando('aprobar')}><FiCheck size={14} /> Aprobar este contenido</button>
                        </div>
                    )}
                    {l.vigente !== false && l.estado === 'aprobado' && (
                        <div className="lt-acciones">
                            {aprobadoPorMi ? (
                                <span className="me-field-hint">Aprobaste este lote: lo tiene que ejecutar otra persona.</span>
                            ) : (
                                <button className="btn btn-danger btn-sm" onClick={() => setConfirmando('ejecutar')}><FiTrash2 size={14} /> Ejecutar la supresión</button>
                            )}
                        </div>
                    )}
                    {confirmando && (
                        <div className="lt-confirmar">
                            <p className="lt-texto">
                                {confirmando === 'aprobar'
                                    ? 'Apruebas suprimir exactamente lo listado arriba. Otra persona tendrá que ejecutarlo.'
                                    : 'Se borra definitivamente lo listado arriba, incluidos los archivos y sus versiones. No se puede deshacer.'}
                                {' '}Escribe <strong>{frase}</strong> para confirmar.
                            </p>
                            <input className="form-input" value={texto} onChange={(e) => setTexto(e.target.value)} aria-label="Confirmación" autoFocus />
                            <div className="lt-acciones">
                                <button className="btn btn-secondary btn-sm" disabled={enviando} onClick={() => { setConfirmando(null); setTexto(''); }}>Cancelar</button>
                                <button className={`btn btn-sm ${confirmando === 'ejecutar' ? 'btn-danger' : 'btn-primary'}`} disabled={enviando || texto.trim() !== frase} onClick={actuar}>
                                    {enviando ? 'Procesando…' : confirmando === 'aprobar' ? 'Aprobar' : 'Suprimir'}
                                </button>
                            </div>
                        </div>
                    )}
                    {l.resultado && (
                        <p className="lt-texto">Resultado: {l.resultado.operaciones} operaciones y {l.resultado.versiones} versiones de archivos suprimidas{l.resultado.errores.length ? `, ${l.resultado.errores.length} con error` : ''}.</p>
                    )}
                </div>
            )}
        </Modal>
    );
}

const estilos = `
    .lt-barra { display: flex; flex-wrap: wrap; gap: var(--space-3); align-items: center; }
    .lt-lista { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--space-2); }
    .lt-fila { width: 100%; text-align: left; display: grid; gap: 6px; padding: var(--space-3) var(--space-4);
        border: 1px solid var(--surface-border); border-radius: var(--radius-md); background: var(--surface-card, transparent); cursor: pointer; color: var(--text-primary); }
    .lt-fila:hover { background: var(--surface-hover, rgba(0,0,0,0.03)); }
    .lt-fila:focus-visible { outline: 2px solid var(--primary-500); outline-offset: 2px; }
    .lt-titulo { font-weight: 600; }
    .lt-meta { display: flex; flex-wrap: wrap; gap: var(--space-2); align-items: center; font-size: 0.84rem; color: var(--text-secondary); }
    .lt-fechas { font-size: 0.8rem; color: var(--text-secondary); }
    .lt-detalle { display: flex; flex-direction: column; gap: var(--space-2); }
    .lt-desactualizado { display: inline-flex; gap: 6px; align-items: center; color: var(--warning-800, #92400e); }
    .lt-subtitulo { margin: var(--space-3) 0 0; font-size: 0.95rem; }
    .lt-texto { margin: 0; font-size: 0.9rem; line-height: 1.55; max-width: 72ch; }
    .lt-ops { margin: 0; padding-left: 1.2rem; display: flex; flex-direction: column; gap: 6px; font-size: 0.86rem; line-height: 1.5; }
    .lt-campos { color: var(--text-secondary); }
    .lt-clave { display: block; font-size: 0.75rem; color: var(--text-secondary); word-break: break-all; }
    .lt-acciones { display: flex; flex-wrap: wrap; gap: var(--space-2); justify-content: flex-end; align-items: center; margin-top: var(--space-2); }
    .lt-confirmar { display: flex; flex-direction: column; gap: var(--space-2); padding: var(--space-3); border: 1px solid var(--surface-border); border-radius: var(--radius-md); }
`;
