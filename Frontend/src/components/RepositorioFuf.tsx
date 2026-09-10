import { useCallback, useEffect, useMemo, useState } from 'react';
import { FiAlertTriangle, FiChevronDown, FiChevronRight, FiExternalLink, FiFileText, FiSend } from 'react-icons/fi';
import { Badge, Drawer } from './ui';
import DistribucionPanel from './DistribucionPanel';
import { estructuraApi } from '../api/estructura.api';
import { documentsApi, type Document } from '../api/documents.api';
import { agruparPorSeccion } from '../utils/fuf';
import {
    ESTADO_LABEL, ESTADO_VARIANTE, colorProgreso,
    type CompletitudAmbito, type RequisitoFuf,
} from '../utils/completitud';
import type { Ambito } from '../utils/estructuraPreventiva';

/**
 * Repositorio DS 44 seccionado como el Formulario Único de Fiscalización.
 *
 * PRINCIPIO (sección D.2 del encargo): esto es una VISTA, no un almacén paralelo.
 *   - Los documentos siguen viviendo en su módulo dueño. Acá se indexan y se
 *     agrupan por sección e ítem; no se copian ni se duplican registros.
 *   - El estado de cada ítem se lee de `completitudAmbito`, la MISMA función que
 *     alimenta el panel y el export. Si el repositorio y el panel pudieran
 *     discrepar, estaría mal implementado: acá no se calcula nada.
 *   - Las secciones salen del catálogo único (`utils/fuf.ts`), no de una lista
 *     propia.
 *
 * Las secciones sin requisitos evaluados se muestran igual, declaradas como no
 * cubiertas todavía: un formulario al que le faltan secciones no se puede
 * recorrer junto al fiscalizador.
 */

export interface RepositorioFufProps {
    tenantId: string;
    ambito: Ambito;
    obraId?: string | null;
    /** Abre el documento en el visor del repositorio. */
    onVerDocumento?: (doc: Document) => void;
}

export default function RepositorioFuf({ tenantId, ambito, obraId = null, onVerDocumento }: RepositorioFufProps) {
    const [data, setData] = useState<CompletitudAmbito | null>(null);
    const [documentos, setDocumentos] = useState<Document[]>([]);
    const [cargando, setCargando] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [abiertas, setAbiertas] = useState<Set<number>>(new Set());
    // Requisito cuya remisión se está gestionando. Se guarda el ítem y no el
    // objeto: al recargar hay que reabrir el panel con los datos frescos, y un
    // objeto guardado quedaría mostrando el estado anterior al registro.
    const [gestionando, setGestionando] = useState<number | null>(null);

    /**
     * `refresco` recarga sin levantar el estado de carga. Importa: el panel de
     * remisión vive en un Drawer dentro de este componente, y mostrar el
     * "Cargando…" lo desmontaría y volvería a montar tras cada constancia
     * registrada, con el panel parpadeando en medio de la tarea.
     */
    const cargar = useCallback(async (refresco = false) => {
        if (!tenantId) return;
        if (!refresco) setCargando(true);
        setError(null);
        const [comp, docs] = await Promise.all([
            estructuraApi.completitud(tenantId, ambito, obraId),
            documentsApi.list(obraId ? ({ obraId } as any) : ({} as any)).catch(() => null),
        ]);
        if (comp.success && comp.data) {
            setData(comp.data);
            // Se abren las secciones con algo que resolver: es lo que el usuario
            // vino a ver, y abrir las quince de golpe no ayuda a nadie.
            setAbiertas(new Set(
                agruparPorSeccion(comp.data.requisitos)
                    .filter((s) => s.items.some((i) => i.requisitos.some(
                        (r) => r.estado !== 'Cumplido' && r.estado !== 'NoAplica' && r.estado !== 'FueraDeAlcance')))
                    .map((s) => s.seccion)
            ));
        } else {
            setError(comp.error || 'No se pudo cargar el cumplimiento.');
        }
        const lista = (docs as any)?.data?.documents || [];
        setDocumentos(Array.isArray(lista) ? lista : []);
        setCargando(false);
    }, [tenantId, ambito, obraId]);

    useEffect(() => { void cargar(); }, [cargar]);

    const secciones = useMemo(() => {
        if (!data) return [];
        // Los ítems que la plataforma no cubre no se pintan. No es lo mismo que
        // "Sin cubrir": aquéllos se acreditan fuera del sistema y no hay nada que
        // el usuario pueda hacer acá, así que la fila solo sería ruido.
        const noCubiertos = new Set(data.itemsNoCubiertos || []);
        return agruparPorSeccion(data.requisitos).map((s) => ({
            ...s,
            items: s.items.filter((i) => !noCubiertos.has(i.numero)),
        }));
    }, [data]);

    /** Se resuelve desde `data` en cada render: tras registrar un envío el panel
     *  abierto tiene que mostrar el estado nuevo, no el que tenía al abrirse. */
    const reqGestionado = useMemo(
        () => (gestionando == null ? null : data?.requisitos.find((r) => r.item === gestionando) || null),
        [data, gestionando]
    );

    /** Documentos que sostienen un requisito, según los tipos que su definición declara. */
    const evidenciaDe = useCallback((reqs: RequisitoFuf[]): Document[] => {
        const tipos = new Set(reqs.flatMap((r) => r.tipos || []));
        if (tipos.size === 0) return [];
        return documentos.filter((d) => tipos.has(d.tipo) && (d.s3Key || d.archivoUrl));
    }, [documentos]);

    const alternar = (n: number) => setAbiertas((prev) => {
        const s = new Set(prev);
        if (s.has(n)) s.delete(n); else s.add(n);
        return s;
    });

    if (cargando) return <div className="text-muted" style={{ fontSize: '0.85rem' }}>Cargando el formulario…</div>;
    if (error) {
        return (
            <div className="ds44-alert ds44-alert-danger" style={{ fontSize: '0.85rem' }}>
                <span className="ds44-alert-icon"><FiAlertTriangle size={14} /></span>
                <span>{error}</span>
            </div>
        );
    }
    if (!data) return null;

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            <div className="text-muted" style={{ fontSize: '0.78rem', marginBottom: 'var(--space-1)' }}>
                Los documentos se gestionan en su módulo: acá se muestran agrupados por sección
                del formulario, con el estado que calcula el panel de cumplimiento.
            </div>

            {secciones.map((s) => {
                const reqsSeccion = s.items.flatMap((i) => i.requisitos);
                const evaluados = reqsSeccion.length;
                const exigibles = reqsSeccion.filter(
                    (r) => r.estado !== 'NoAplica' && r.estado !== 'FueraDeAlcance').length;
                const cumplidos = reqsSeccion.filter((r) => r.estado === 'Cumplido').length;
                const progreso = exigibles > 0 ? Math.round((cumplidos / exigibles) * 100) : 0;
                const abierta = abiertas.has(s.seccion);

                return (
                    <div key={s.seccion} className="card" style={{ padding: 'var(--space-3)' }}>
                        <button
                            type="button"
                            onClick={() => alternar(s.seccion)}
                            aria-expanded={abierta}
                            style={{
                                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                width: '100%', background: 'none', border: 'none', padding: 0,
                                cursor: 'pointer', gap: 'var(--space-2)', textAlign: 'left',
                            }}
                        >
                            <span style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0 }}>
                                {abierta ? <FiChevronDown size={15} /> : <FiChevronRight size={15} />}
                                <span className="font-medium" style={{ fontSize: '0.9rem' }}>
                                    <span className="text-muted">{s.seccion}. </span>{s.nombre}
                                </span>
                            </span>
                            <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexShrink: 0 }}>
                                <span className="text-muted" style={{ fontSize: '0.75rem' }}>
                                    {s.items.length} ítem{s.items.length === 1 ? '' : 's'}
                                </span>
                                {evaluados > 0 ? (
                                    <span style={{ fontWeight: 700, fontSize: '0.85rem', color: colorProgreso(progreso) }}>
                                        {progreso}%
                                    </span>
                                ) : (
                                    <Badge variant="neutral">Sin cubrir</Badge>
                                )}
                            </span>
                        </button>

                        {abierta && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', marginTop: 'var(--space-3)' }}>
                                {s.items.map((item) => {
                                    const reqs = item.requisitos;
                                    const evidencia = evidenciaDe(reqs);
                                    const estado = reqs[0]?.estado;
                                    return (
                                        <div key={item.numero} className="ds44-doc-row" style={{ alignItems: 'flex-start' }}>
                                            <div style={{ minWidth: 0 }}>
                                                <div className="font-medium" style={{ fontSize: '0.86rem' }}>
                                                    <span className="text-muted">FUF {item.numero} · </span>{item.texto}
                                                </div>
                                                <div className="text-muted" style={{ fontSize: '0.76rem' }}>
                                                    {item.articulo} · Fase {item.fase}
                                                    {reqs[0]?.justificacion || reqs[0]?.detalle
                                                        ? ` · ${reqs[0].justificacion || reqs[0].detalle}`
                                                        : ''}
                                                </div>

                                                {/* La evidencia enlaza al documento en su módulo dueño;
                                                    el repositorio no guarda copias. */}
                                                {evidencia.length > 0 && (
                                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '6px' }}>
                                                        {evidencia.map((d) => (
                                                            <button
                                                                key={d.documentId}
                                                                type="button"
                                                                className="btn btn-ghost btn-sm"
                                                                style={{ fontSize: '0.75rem' }}
                                                                onClick={() => onVerDocumento?.(d)}
                                                            >
                                                                <FiFileText size={12} /> {d.archivoNombre || d.titulo}
                                                            </button>
                                                        ))}
                                                    </div>
                                                )}
                                                {reqs.length > 0 && evidencia.length === 0 && (reqs[0]?.tipos?.length || 0) > 0 && (
                                                    <div className="text-muted" style={{ fontSize: '0.74rem', marginTop: '4px' }}>
                                                        Sin documentos cargados para este ítem.
                                                    </div>
                                                )}
                                                {reqs[0]?.modulo && (
                                                    <div className="text-muted" style={{ fontSize: '0.74rem', marginTop: '4px' }}>
                                                        <FiExternalLink size={11} /> Se resuelve en el módulo de {reqs[0].modulo}.
                                                    </div>
                                                )}

                                                {/* Literales de la norma dentro de un mismo ítem: el 1
                                                    es una fila del formulario pero cinco obligaciones, y
                                                    un badge único no dice cuál falta. */}
                                                {reqs[0]?.subrequisitos && reqs[0].subrequisitos.length > 0 && (
                                                    <ul style={{
                                                        listStyle: 'none', margin: '8px 0 0', padding: 0,
                                                        display: 'flex', flexDirection: 'column', gap: '6px',
                                                    }}>
                                                        {reqs[0].subrequisitos.map((sub) => (
                                                            <li key={sub.clave} style={{
                                                                display: 'flex', alignItems: 'flex-start',
                                                                gap: 'var(--space-2)', flexWrap: 'wrap',
                                                            }}>
                                                                <span style={{ minWidth: 0, flex: '1 1 220px' }}>
                                                                    <span style={{ fontSize: '0.79rem', color: 'var(--text-primary)' }}>
                                                                        {sub.titulo}
                                                                    </span>
                                                                    {sub.detalle && (
                                                                        <span style={{ display: 'block', fontSize: '0.73rem', color: 'var(--text-secondary)' }}>
                                                                            {sub.detalle}
                                                                        </span>
                                                                    )}
                                                                </span>
                                                                <Badge variant={ESTADO_VARIANTE[sub.estado]}>
                                                                    {ESTADO_LABEL[sub.estado]}
                                                                </Badge>
                                                            </li>
                                                        ))}
                                                    </ul>
                                                )}

                                                {/* Cualquier requisito que se acredite informando trae su
                                                    desglose. El repositorio no sabe cuál es: cuando otro ítem
                                                    devuelva su bloque `distribucion`, hereda esto sin cambios. */}
                                                {reqs[0]?.distribucion && (
                                                    <button
                                                        type="button"
                                                        className="btn btn-secondary btn-sm"
                                                        style={{ marginTop: '8px', fontSize: '0.75rem' }}
                                                        onClick={() => setGestionando(item.numero)}
                                                    >
                                                        <FiSend size={12} /> Gestionar remisión
                                                        {reqs[0].distribucion.resultado.exigibles > 0 && (
                                                            <span style={{ color: 'var(--text-secondary)' }}>
                                                                {' '}({reqs[0].distribucion.resultado.enviados}/{reqs[0].distribucion.resultado.exigibles})
                                                            </span>
                                                        )}
                                                    </button>
                                                )}
                                            </div>
                                            <Badge variant={estado ? ESTADO_VARIANTE[estado] : 'neutral'}>
                                                {estado ? ESTADO_LABEL[estado] : 'Sin cubrir'}
                                            </Badge>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                );
            })}

            {reqGestionado?.distribucion && (
                <Drawer
                    isOpen
                    onClose={() => setGestionando(null)}
                    title="Constancias de envío"
                    subtitle={`FUF ${reqGestionado.item} · ${reqGestionado.distribucion.titulo || reqGestionado.titulo}`}
                    width={560}
                >
                    <DistribucionPanel
                        distribucion={reqGestionado.distribucion}
                        tenantId={tenantId}
                        obraId={obraId}
                        onCambio={() => cargar(true)}
                    />
                </Drawer>
            )}
        </div>
    );
}
