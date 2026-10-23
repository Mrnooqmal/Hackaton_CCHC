import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    FiAlertTriangle, FiCheck, FiClipboard, FiClock, FiInfo, FiPaperclip, FiPlus,
} from 'react-icons/fi';
import { AlertBanner, EmptyState, PageHeader, PrescripcionesSkeleton, SearchInput, Select } from '../components/ui';
import { ChipEstado } from '../components/prescripciones/PrescripcionUi';
import { useVistaDocumento } from '../hooks/useVistaDocumento';
import { useAuth } from '../context/AuthContext';
import { useObraContext } from '../context/ObraContext';
import { useToast } from '../context/ToastContext';
import {
    estructuraApi, ORIGEN_PRESCRIPCION_LABEL,
    type EstadoPrescripcion, type OrigenPrescripcion, type Prescripcion,
} from '../api/estructura.api';
import { describirCumplimiento, describirPlazo, fechaDe, fmt, ordenarPorUrgencia } from '../utils/prescripciones';
import '../css/prescripciones.css';

/**
 * Prescripciones de medidas — DS 44 Art. 70 (ítem 58 del FUF).
 *
 * La norma obliga a IMPLEMENTAR lo que ordenen los fiscalizadores, el Organismo
 * Administrador, el Departamento de Prevención o el comité. Recibir la
 * prescripción no cierra nada, así que esta pantalla es de seguimiento: lo que
 * importa de un vistazo es qué está vencido.
 *
 * Decisiones de interfaz (canvas: PrescripcionesLista / PrescripcionesVacio):
 *   - El filtro por estado son pestañas en el encabezado, como en Mi empresa.
 *   - El estado NO se elige. Se deriva del plazo y de la evidencia, igual que en
 *     el backend; el bloque "Cómo se lleva" lo explica de entrada.
 *   - Registrar y cerrar una medida son pantallas completas, no paneles.
 *   - Vacío no es un error: sin prescripciones el ítem 58 está cumplido.
 */

const ORIGENES: OrigenPrescripcion[] = [
    'OrganismoFiscalizador', 'OrganismoAdministrador', 'DepartamentoPrevencion', 'ComiteParitario',
];

type Filtro = 'todas' | EstadoPrescripcion;

const CLAVE_COMO = 'prescripciones.comoFunciona.oculto';
const leerOculto = () => { try { return localStorage.getItem(CLAVE_COMO) === '1'; } catch { return false; } };
const guardarOculto = (v: boolean) => { try { localStorage.setItem(CLAVE_COMO, v ? '1' : '0'); } catch { /* sin almacenamiento */ } };

function ComoFunciona({ onOcultar }: { onOcultar: () => void }) {
    return (
        <section className="pr-como" aria-label="Cómo se lleva una prescripción">
            <div className="pr-como-head">
                <span className="pr-como-titulo">Cómo se lleva una prescripción</span>
                <span className="pr-como-sub">El estado no se elige: lo definen el plazo y la evidencia</span>
                <button type="button" className="pr-como-ocultar" onClick={onOcultar}>Ocultar</button>
            </div>
            <ol className="pr-pasos">
                <li className="pr-paso">
                    <span className="pr-paso-num">1</span>
                    <span className="pr-paso-texto">
                        <span className="pr-paso-titulo">Registra la orden</span>
                        <span className="pr-paso-desc">Quién la dio, qué pide, su fecha y su plazo, con el documento que la origina.</span>
                    </span>
                </li>
                <li className="pr-paso">
                    <span className="pr-paso-num">2</span>
                    <span className="pr-paso-texto">
                        <span className="pr-paso-titulo">Implementa dentro del plazo</span>
                        <span className="pr-paso-desc">
                            Mientras tanto queda <b>Pendiente</b>. Si el plazo pasa, cambia sola a{' '}
                            <b style={{ color: 'var(--danger-alerta)' }}>Vencida</b>.
                        </span>
                    </span>
                </li>
                <li className="pr-paso">
                    <span className="pr-paso-num">3</span>
                    <span className="pr-paso-texto">
                        <span className="pr-paso-titulo">Adjunta la evidencia</span>
                        <span className="pr-paso-desc">
                            Con fecha y respaldo pasa a <b style={{ color: 'var(--success-apagado)' }}>Implementada</b>.
                            Sin evidencia no se puede cerrar.
                        </span>
                    </span>
                </li>
            </ol>
        </section>
    );
}

export default function Prescripciones() {
    const { user } = useAuth();
    const { selectedObraId, selectedObra } = useObraContext();
    const { toast } = useToast();
    const navigate = useNavigate();
    const tenantId = user?.tenantId;

    const [lista, setLista] = useState<Prescripcion[]>([]);
    const [cargando, setCargando] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [filtro, setFiltro] = useState<Filtro>('todas');
    const [busqueda, setBusqueda] = useState('');
    const [origen, setOrigen] = useState<'' | OrigenPrescripcion>('');
    const [comoOculto, setComoOculto] = useState(leerOculto);

    const { abrir: abrirDocumento, visor } = useVistaDocumento(useCallback((m: string) => toast.error(m), [toast]));

    // Registrar y cerrar viven en sus propias pantallas: al volver, la página se
    // monta de nuevo y recarga. No hace falta recargar desde acá.
    useEffect(() => {
        if (!tenantId) return;
        let vigente = true;
        estructuraApi.listarPrescripciones(tenantId, selectedObraId).then((res) => {
            if (!vigente) return;
            if (res.success && res.data) { setLista(res.data.prescripciones); setError(null); }
            else setError(res.error || 'No se pudieron cargar las prescripciones.');
            setCargando(false);
        });
        return () => { vigente = false; };
    }, [tenantId, selectedObraId]);

    const conteos = useMemo(() => ({
        todas: lista.length,
        Vencida: lista.filter((p) => p.estado === 'Vencida').length,
        Pendiente: lista.filter((p) => p.estado === 'Pendiente').length,
        Implementada: lista.filter((p) => p.estado === 'Implementada').length,
    }), [lista]);

    const visibles = useMemo(() => {
        const q = busqueda.trim().toLowerCase();
        return ordenarPorUrgencia(lista.filter((p) =>
            (filtro === 'todas' || p.estado === filtro)
            && (!origen || p.origen === origen)
            && (!q || p.descripcion.toLowerCase().includes(q))
        ));
    }, [lista, filtro, origen, busqueda]);

    const irANueva = () => navigate('/prescripciones/nueva');
    const irAImplementar = (p: Prescripcion) =>
        navigate(`/prescripciones/${p.prescripcionId}/implementar`, { state: { prescripcion: p } });

    const ocultarComo = (v: boolean) => { setComoOculto(v); guardarOculto(v); };

    // El ítem 58 se cumple cuando no hay ninguna, o todas están implementadas
    // (evaluarItem58 en Backend/lib/completitud-documental.js).
    const notaItem58 = conteos.todas === 0 ? null
        : conteos.Implementada === conteos.todas
            ? 'El ítem 58 del FUF está cumplido: todas las prescripciones están implementadas con evidencia.'
            : `El ítem 58 del FUF se cumple cuando todas están implementadas con evidencia. Hoy: ${conteos.Implementada} de ${conteos.todas}${conteos.Vencida > 0 ? `, y figura vencido por ${conteos.Vencida === 1 ? 'la que está' : `las ${conteos.Vencida}`} fuera de plazo` : ''}.`;

    const sinRegistros = !cargando && !error && lista.length === 0;
    const recuento = (n: number) => (cargando ? <span className="pr-recuento-cargando" aria-hidden="true" /> : n);

    return (
        <div className="page-content">
            <PageHeader
                banner
                title="Prescripciones de medidas"
                description={`Medidas que fiscalizadores, el Organismo Administrador, Prevención o el Comité Paritario ordenaron implementar${selectedObra?.nombre ? ` en ${selectedObra.nombre}` : ''}. DS 44 · Art. 70 · ítem 58 del FUF.`}
                actions={
                    <button className="btn btn-primary" type="button" onClick={irANueva}>
                        <FiPlus size={15} /> Registrar prescripción
                    </button>
                }
                // Las pestañas están desde el primer render: mientras carga, el
                // recuento es un hueco del mismo ancho, así nada se corre al
                // llegar los datos. Solo se quitan si no hay ninguna (el vacío).
                tabs={!sinRegistros ? [
                    { id: 'todas', label: 'Todas', icon: <FiClipboard size={15} />, badge: recuento(conteos.todas) },
                    { id: 'Vencida', label: 'Vencidas', icon: <FiAlertTriangle size={15} />, badge: recuento(conteos.Vencida), badgeTone: !cargando && conteos.Vencida > 0 ? 'alerta' : undefined },
                    { id: 'Pendiente', label: 'Pendientes', icon: <FiClock size={15} />, badge: recuento(conteos.Pendiente) },
                    { id: 'Implementada', label: 'Implementadas', icon: <FiCheck size={15} />, badge: recuento(conteos.Implementada) },
                ] : undefined}
                activeTab={filtro}
                onTabChange={(id) => setFiltro(id as Filtro)}
                tabsLabel="Filtrar prescripciones por estado"
            />

            {error && <AlertBanner variant="error" message={error} onDismiss={() => setError(null)} />}

            {/* Sin registros, el estado vacío ya explica el módulo. */}
            {!sinRegistros && (comoOculto ? (
                <button type="button" className="pr-como-mostrar" onClick={() => ocultarComo(false)}>
                    <FiInfo size={14} /> Cómo se lleva una prescripción
                </button>
            ) : (
                <ComoFunciona onOcultar={() => ocultarComo(true)} />
            ))}

            {sinRegistros ? (
                <div className="pr-vacio">
                    <span className="pr-vacio-icono pr-tinte-exito"><FiClipboard size={28} /></span>
                    <div className="pr-vacio-texto">
                        <h2>Sin prescripciones registradas</h2>
                        <p>
                            Mientras no haya ninguna, el ítem 58 del formulario está cumplido. Cuando recibas una orden
                            de implementar una medida, regístrala acá para hacerle seguimiento hasta cerrarla con evidencia.
                        </p>
                    </div>
                    <div className="pr-origenes">
                        <span className="form-label" style={{ margin: 0 }}>Quiénes pueden ordenarlas</span>
                        <div className="pr-origenes-chips">
                            {ORIGENES.map((o) => <span key={o}>{ORIGEN_PRESCRIPCION_LABEL[o]}</span>)}
                        </div>
                    </div>
                    <button className="btn btn-primary" type="button" onClick={irANueva}>
                        <FiPlus size={15} /> Registrar la primera
                    </button>
                </div>
            ) : (
                <>
                    {/* Las vencidas son lo primero que revisa un fiscalizador en una
                        segunda visita: se avisan arriba, con el atajo al filtro. */}
                    {conteos.Vencida > 0 && filtro !== 'Vencida' && (
                        <div className="pr-aviso" role="status">
                            <span className="pr-aviso-icono"><FiAlertTriangle size={17} /></span>
                            <span className="pr-aviso-cuerpo">
                                <span>
                                    <span className="pr-aviso-titulo">
                                        {conteos.Vencida === 1
                                            ? '1 medida con el plazo vencido sin implementar.'
                                            : `${conteos.Vencida} medidas con el plazo vencido sin implementar.`}
                                    </span>{' '}
                                    <span className="pr-aviso-detalle">
                                        Registrar la implementación ahora deja constancia de la fecha real, aunque sea tarde.
                                    </span>
                                </span>
                            </span>
                            <button type="button" className="pr-aviso-accion" onClick={() => setFiltro('Vencida')}>
                                Ver vencidas
                            </button>
                        </div>
                    )}

                    {(cargando || lista.length > 0) && (
                        <div className="pr-toolbar">
                            <SearchInput value={busqueda} onChange={setBusqueda} placeholder="Buscar por medida…" maxWidth="320px" />
                            <Select
                                ariaLabel="Filtrar por origen"
                                value={origen}
                                onChange={(v) => setOrigen(v as '' | OrigenPrescripcion)}
                                options={[
                                    { value: '', label: 'Origen: Todos' },
                                    ...ORIGENES.map((o) => ({ value: o, label: ORIGEN_PRESCRIPCION_LABEL[o] })),
                                ]}
                            />
                            <span className="pr-toolbar-nota">Ordenadas por urgencia</span>
                        </div>
                    )}

                    {cargando ? (
                        <PrescripcionesSkeleton />
                    ) : visibles.length === 0 && lista.length > 0 ? (
                        <EmptyState
                            icon={<FiClock size={34} />}
                            title="Nada que mostrar con estos filtros"
                            description="Cambia la pestaña, el origen o la búsqueda para ver el resto de las prescripciones."
                        />
                    ) : (
                        <div className="pr-lista">
                            {visibles.map((p) => <FilaPrescripcion
                                key={p.prescripcionId}
                                p={p}
                                onImplementar={() => irAImplementar(p)}
                                onVerDocumento={abrirDocumento}
                            />)}
                        </div>
                    )}

                    {notaItem58 && !cargando && (
                        <div className="pr-pie">
                            <FiInfo size={14} style={{ flexShrink: 0 }} />
                            {notaItem58}
                        </div>
                    )}
                </>
            )}

            {visor}
        </div>
    );
}

function FilaPrescripcion({ p, onImplementar, onVerDocumento }: {
    p: Prescripcion;
    onImplementar: () => void;
    onVerDocumento: (documentId: string, nombre?: string) => void;
}) {
    const plazo = fechaDe(p.plazoImplementacion);
    const icono = p.estado === 'Vencida' ? 'pr-tinte-alerta' : p.estado === 'Implementada' ? 'pr-tinte-exito' : 'pr-tinte-neutro';

    let detallePlazo: React.ReactNode;
    if (p.estado === 'Implementada') {
        const cumplimiento = describirCumplimiento(fechaDe(p.fechaImplementacion), plazo || null);
        detallePlazo = <span>Implementada el {fmt(p.fechaImplementacion)}{cumplimiento ? ` · ${cumplimiento}` : ''}</span>;
    } else if (plazo) {
        detallePlazo = (
            <span className={p.estado === 'Vencida' ? 'pr-fila-meta--alerta' : 'pr-fila-meta--fuerte'}>
                Plazo {fmt(p.plazoImplementacion)} · {describirPlazo(plazo)}
            </span>
        );
    } else {
        detallePlazo = <span>Sin plazo · queda pendiente, pero no vence</span>;
    }

    return (
        <div className={`pr-fila${p.estado === 'Implementada' ? ' pr-fila--implementada' : ''}`}>
            <span className={`pr-fila-icono ${icono}`}>
                {p.estado === 'Vencida' ? <FiAlertTriangle size={18} /> : p.estado === 'Implementada' ? <FiCheck size={18} /> : <FiClipboard size={18} />}
            </span>
            <div className="pr-fila-cuerpo">
                <div className="pr-eyebrow">
                    {ORIGEN_PRESCRIPCION_LABEL[p.origen]}
                    <span className="pr-dot">·</span>
                    Prescrita el {fmt(p.fechaPrescripcion)}
                </div>
                <h3 className="pr-fila-titulo">{p.descripcion}</h3>
                <div className="pr-fila-meta">
                    {detallePlazo}
                    <span className="pr-dot">·</span>
                    {p.estado === 'Implementada' && p.evidenciaImplementacionDocumentoId ? (
                        <button type="button" className="pr-enlace" onClick={() => onVerDocumento(p.evidenciaImplementacionDocumentoId!, 'Evidencia')}>
                            <FiPaperclip size={12} /> Ver evidencia
                        </button>
                    ) : p.documentoPrescripcionId ? (
                        <button type="button" className="pr-enlace" onClick={() => onVerDocumento(p.documentoPrescripcionId!, 'Documento de la prescripción')}>
                            <FiPaperclip size={12} /> Ver documento
                        </button>
                    ) : (
                        <span>Sin documento adjunto</span>
                    )}
                </div>
            </div>
            <ChipEstado estado={p.estado} />
            <div className="pr-fila-accion">
                {p.estado !== 'Implementada' && (
                    <button className="btn btn-secondary btn-sm" type="button" onClick={onImplementar}>
                        Registrar implementación
                    </button>
                )}
            </div>
        </div>
    );
}
