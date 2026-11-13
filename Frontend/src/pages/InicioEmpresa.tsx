import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    FiActivity, FiAlertOctagon, FiAlertTriangle, FiCheckSquare, FiClock,
    FiPackage, FiRefreshCw, FiTrendingUp,
} from 'react-icons/fi';
import { useAuth } from '../context/AuthContext';
import { useObraContext } from '../context/ObraContext';
import { PageHeader, StatCard, Badge } from '../components/ui';
import { mensajeDeError } from '../api/client';
import { estructuraApi, type AvanceAmbito, type Prescripcion } from '../api/estructura.api';
import { documentsApi } from '../api/documents.api';
import { incidentsApi, type IncidentStats } from '../api/incidents.api';
import { tenantsApi } from '../api/tenants.api';
import { colorProgreso } from '../utils/completitud';
import {
    calcularBrechas, calcularPorVencer, calcularTotales, consolidar, consolidarSiniestralidad,
    diasDeAtraso, motivoDominante, obraActiva, obrasBajo, obrasEnRiesgo, promediarPorcentajes,
    resumenEpp, resumenPrescripciones, UMBRAL_SISTEMICO,
    type Brecha, type DocumentoEntrada, type ItemEpp, type ObraConAvance, type ObraEnRiesgo,
    type PorVencer, type ResumenPrescripciones,
} from '../utils/panoramaEmpresa';
import { PanoramaEmpresaSkeleton } from '../components/inicio/PanoramaSkeleton';

/**
 * Inicio de la gestión de empresa.
 *
 * El menú de empresa declaraba un "Inicio" que no existía: `/` renderizaba el
 * inicio de obra, pensado para quien está en terreno, así que al entrar a
 * administrar la empresa lo primero que se veía eran los ajustes. Esta pantalla
 * ocupa ese lugar.
 *
 * ── Para quién, y por qué eso cambia el diseño ───────────────────────────────
 *
 * El inicio de obra se achicó a propósito (ver pages/Dashboard.tsx): su usuario
 * necesita saber qué firma hoy, y una grilla de métricas no se accionaba. Acá el
 * usuario es otro: administra varias obras y su trabajo ES mirar el conjunto.
 * Por eso vuelven los indicadores. Pero la lección se respeta: **cada cifra
 * lleva a algún lado**. Una brecha se abre en la obra que la tiene; nada es
 * decorativo.
 *
 * El orden es por lo que exige actuar, no por lo que es fácil de graficar:
 * primero lo que se repite entre obras, después cada obra, después el detalle.
 *
 * El cumplimiento no se calcula acá (ver utils/panoramaEmpresa.ts): lo entrega
 * el motor del servidor, y este archivo solo lo suma y lo pinta.
 */
export default function InicioEmpresa() {
    const { user } = useAuth();
    const { obras: obrasContexto, isLoadingObras } = useObraContext();
    const navigate = useNavigate();
    const tenantId = user?.tenantId || null;

    const [avances, setAvances] = useState<Record<string, AvanceAmbito> | null>(null);
    const [documentos, setDocumentos] = useState<DocumentoEntrada[] | null>(null);
    const [prescripciones, setPrescripciones] = useState<Prescripcion[]>([]);
    const [stats, setStats] = useState<Record<string, IncidentStats>>({});
    const [tamanoEntidad, setTamanoEntidad] = useState(0);
    const [cargando, setCargando] = useState(true);
    const [fallo, setFallo] = useState<string | null>(null);

    const cargar = useCallback(async () => {
        if (!tenantId) return;
        setCargando(true);
        setFallo(null);
        try {
            // Cuatro llamadas de empresa, no una por obra: el resumen del motor y
            // las prescripciones ya vienen de toda la empresa.
            const [resumen, docs, presc, tenant] = await Promise.all([
                estructuraApi.resumenCompletitud(tenantId),
                documentsApi.list(),
                estructuraApi.listarPrescripciones(tenantId),
                // El tamaño de la entidad decide la exigibilidad de los órganos
                // (comité paritario, DPR). Hoy ninguna condición de los
                // PROCEDIMIENTOS depende de él, pero se pide igual: si mañana se
                // agrega un procedimiento con condición por dotación, pasar cero
                // lo declararía "no aplica" en silencio.
                tenantsApi.get(tenantId),
            ]);
            setAvances(resumen?.data?.obras || {});
            setDocumentos((docs?.data?.documents || []) as DocumentoEntrada[]);
            setPrescripciones(presc?.data?.prescripciones || []);
            setTamanoEntidad(tenant?.data?.cantidadTrabajadores || 0);

            // La siniestralidad sí es por obra: el endpoint calcula sobre una.
            //
            // La masa laboral se MANDA. Sin ella el servidor usa un valor por
            // omisión (cien por obra), y las tasas salen calculadas sobre una
            // base inventada: con seis obras daba masa 600 donde las dotaciones
            // declaradas suman 355, o sea tasas casi a la mitad de lo real.
            // Donde no haya dotación declarada se deja que el servidor decida, y
            // la pantalla avisa que la base está incompleta.
            const obrasActivas = (obrasContexto || []).filter(obraActiva);
            const porObra = await Promise.all(obrasActivas.map(async (o) => {
                const dotacion = typeof o.dotacionDeclarada === 'number' && o.dotacionDeclarada > 0
                    ? o.dotacionDeclarada
                    : undefined;
                const r = await incidentsApi.getStats({ tenantId, obraId: o.obraId, masaLaboral: dotacion });
                return [o.obraId, r?.data] as const;
            }));
            setStats(Object.fromEntries(porObra.filter(([, v]) => Boolean(v)) as Array<[string, IncidentStats]>));
        } catch (err) {
            // Siempre `mensajeDeError`, nunca el texto crudo del error: sin red
            // ese texto es "Failed to fetch", que no le dice nada a nadie en una
            // faena. El cliente lo traduce a su aviso de sin señal.
            setFallo(mensajeDeError(err, 'No se pudo cargar el panorama.'));
        } finally {
            setCargando(false);
        }
    }, [tenantId, obrasContexto]);

    useEffect(() => { void cargar(); }, [cargar]);

    const obras = useMemo<ObraConAvance[]>(() => {
        const activas = (obrasContexto || []).filter(obraActiva);
        return activas
            .map((o) => ({ ...o, avance: avances?.[o.obraId] || null }))
            .sort((a, b) => (a.avance?.progreso ?? 101) - (b.avance?.progreso ?? 101));
    }, [obrasContexto, avances]);

    const nombreDe = useCallback(
        (obraId: string | null) => obras.find((o) => o.obraId === obraId)?.nombre || 'Sin obra',
        [obras],
    );

    const consolidado = useMemo(() => consolidar(obras.map((o) => o.avance)), [obras]);
    const promedio = useMemo(() => promediarPorcentajes(obras.map((o) => o.avance)), [obras]);
    const brechas = useMemo(
        () => calcularBrechas(obras, documentos || [], tamanoEntidad),
        [obras, documentos, tamanoEntidad],
    );
    const siniestralidad = useMemo(
        () => consolidarSiniestralidad(obras.map((o) => stats[o.obraId] || null)),
        [obras, stats],
    );
    const enRiesgo = useMemo(() => obrasEnRiesgo(obras, stats), [obras, stats]);
    const presc = useMemo(() => resumenPrescripciones(prescripciones), [prescripciones]);
    const epp = useMemo(() => resumenEpp(documentos || []), [documentos]);
    const porVencer = useMemo(() => calcularPorVencer(documentos || [], 90), [documentos]);
    const totales = useMemo(() => calcularTotales(documentos || []), [documentos]);

    const exigibles = brechas.filter((b) => b.certeza === 'exigible');
    const esperando = cargando || isLoadingObras;

    if (esperando && !documentos) {
        return (
            <div className="page">
                <PageHeader title="Panorama de la empresa" description="Cumplimiento del DS 44 en todas las obras." />
                <PanoramaEmpresaSkeleton />
            </div>
        );
    }

    return (
        <div className="page">
            <PageHeader
                title="Panorama de la empresa"
                description={
                    obras.length
                        ? `Cumplimiento del DS 44 en ${obras.length} ${obras.length === 1 ? 'obra activa' : 'obras activas'}, y las brechas que se repiten entre ellas.`
                        : 'Cumplimiento del DS 44 en las obras de la empresa.'
                }
                actions={
                    <button type="button" className="btn btn-secondary" onClick={() => void cargar()} disabled={esperando}>
                        <FiRefreshCw className={esperando ? 'pan-girando' : undefined} /> Actualizar
                    </button>
                }
            />

            {fallo && (
                <div className="alert alert-danger" role="alert">
                    <FiAlertTriangle aria-hidden="true" /> {fallo}
                </div>
            )}

            {!obras.length && !esperando && (
                <div className="card">
                    <p className="text-secondary" style={{ margin: 0 }}>
                        Todavía no hay obras activas. Cuando crees la primera, acá vas a ver su cumplimiento;
                        con dos o más, además las brechas que tengan en común.
                    </p>
                </div>
            )}

            {Boolean(obras.length) && (
                <>
                    <div className="stats-grid-4">
                        <StatCard
                            icon={<FiCheckSquare />}
                            value={`${consolidado.progreso}%`}
                            label="Cumplimiento FUF"
                            color="var(--primary-600)"
                        />
                        <StatCard
                            icon={<FiAlertTriangle />}
                            value={exigibles.length}
                            label="Exigidos y ausentes"
                            color="var(--danger-500)"
                        />
                        <StatCard
                            icon={<FiAlertOctagon />}
                            value={presc.vencidas.length}
                            label="Medidas vencidas"
                            color="var(--danger-500)"
                        />
                        <StatCard
                            icon={<FiActivity />}
                            value={siniestralidad.numeroAccidentes}
                            label="Accidentes"
                            color="var(--primary-800)"
                        />
                    </div>

                    <p className="pan-metodo">
                        {consolidado.cumplidos} de {consolidado.exigibles} ítems exigibles.
                        {consolidado.excluidos > 0 && ` ${consolidado.excluidos} no aplican a estas obras y quedan fuera del cálculo.`}
                        {promedio !== consolidado.progreso && ` Es la suma de los ítems, no el promedio de los porcentajes de cada obra, que daría ${promedio}%.`}
                        {` En el repositorio hay ${totales.sinRespaldo} documentos sin archivo y ${totales.firmasPendientes} esperando firma.`}
                    </p>

                    <PanelSiniestralidad
                        datos={siniestralidad}
                        obras={obras.length}
                        sinDotacion={obras.filter((o) => typeof o.dotacionDeclarada !== 'number' || o.dotacionDeclarada <= 0).length}
                    />

                    <div className="pan-grid">
                        <PanelBrechas brechas={brechas} obras={obras} nombreDe={nombreDe} onAbrirObra={(id) => navigate(`/obras/${id}`)} />
                        <PanelRiesgo items={enRiesgo} onAbrirObra={(id) => navigate(`/obras/${id}`)} />
                    </div>

                    <div className="pan-grid pan-grid--invertida">
                        <PanelPrescripciones resumen={presc} nombreDe={nombreDe} />
                        <PanelObras obras={obras} onAbrirObra={(id) => navigate(`/obras/${id}`)} />
                    </div>

                    <div className="pan-grid pan-grid--invertida">
                        <PanelPorVencer items={porVencer} nombreDe={nombreDe} />
                        <PanelEpp items={epp} />
                    </div>
                </>
            )}
        </div>
    );
}

/* ─── Brechas entre obras ──────────────────────────────────────────────────── */

function PanelBrechas({ brechas, obras, nombreDe, onAbrirObra }: {
    brechas: Brecha[];
    obras: ObraConAvance[];
    nombreDe: (id: string | null) => string;
    onAbrirObra: (id: string) => void;
}) {
    const [abierta, setAbierta] = useState<string | null>(null);
    const cuantasExigibles = brechas.filter((b) => b.certeza === 'exigible').length;

    return (
        <section className="card">
            <div className="card-header">
                <div>
                    <h2 className="card-title">Brechas que se repiten</h2>
                    <p className="card-subtitle">
                        Un documento que falta en varias obras no es un descuido de una obra: es una práctica de la empresa.
                    </p>
                </div>
                {Boolean(cuantasExigibles) && <Badge variant="danger">{cuantasExigibles} exigidas</Badge>}
            </div>

            {!brechas.length ? (
                <p className="text-secondary" style={{ margin: 0 }}>
                    {obras.length < 2
                        ? 'Con una sola obra no hay nada que comparar.'
                        : 'Todas las obras acreditan los mismos tipos de documento. No hay brecha común.'}
                </p>
            ) : (
                <>
                    {brechas.map((b) => {
                        const estaAbierta = abierta === b.tipo;
                        return (
                            <div key={b.tipo} className="pan-brecha">
                                <button
                                    type="button"
                                    className="pan-brecha-fila"
                                    aria-expanded={estaAbierta}
                                    onClick={() => setAbierta(estaAbierta ? null : b.tipo)}
                                >
                                    <span className="pan-brecha-texto">
                                        <span className="pan-brecha-nombre">{b.etiqueta}</span>
                                        <span className="pan-brecha-meta">
                                            {b.certeza === 'exigible' ? (
                                                <>
                                                    <span className="pan-brecha-sistemica">exigido · {b.articulo}</span>
                                                    {b.sistemica ? ' · práctica de empresa' : ''}
                                                </>
                                            ) : (
                                                <>
                                                    comparado con las demás
                                                    {b.sistemica ? ' · práctica de empresa' : ''}
                                                </>
                                            )}
                                        </span>
                                    </span>
                                    <span className="pan-brecha-barra" aria-hidden="true">
                                        {obras.map((o) => (
                                            <span
                                                key={o.obraId}
                                                className={`pan-celda ${b.obrasSinEl.includes(o.obraId) ? 'pan-celda--falta' : 'pan-celda--tiene'}`}
                                            />
                                        ))}
                                    </span>
                                    <span className="pan-brecha-conteo">
                                        falta en <b>{b.faltaEn}</b> de {b.deUnTotalDe}
                                    </span>
                                </button>
                                {estaAbierta && (
                                    <ul className="pan-brecha-detalle">
                                        {b.obrasSinEl.map((id) => (
                                            <li key={id}>
                                                <button type="button" className="pan-enlace" onClick={() => onAbrirObra(id)}>
                                                    {nombreDe(id)}
                                                </button>
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </div>
                        );
                    })}

                    <div className="pan-leyenda">
                        <span><i className="pan-muestra pan-muestra--falta" /> Falta en la obra</span>
                        <span><i className="pan-muestra pan-muestra--tiene" /> Acreditado</span>
                        <span>Desde {UMBRAL_SISTEMICO} obras se marca como práctica de empresa.</span>
                    </div>
                    <p className="pan-nota">
                        <strong>Exigido</strong> quiere decir que el DS 44 lo pide a esa obra según sus
                        condiciones —faena compartida, maquinaria, agentes físicos, químicos o biológicos—
                        y no está: se puede afirmar. <strong>Comparado</strong> quiere decir que otras obras
                        lo acreditan y esta no, sin saber si le aplica: es una señal, no un incumplimiento.
                    </p>
                </>
            )}
        </section>
    );
}

/* ─── Cumplimiento por obra ────────────────────────────────────────────────── */

function PanelObras({ obras, onAbrirObra }: { obras: ObraConAvance[]; onAbrirObra: (id: string) => void }) {
    const bajo = obrasBajo(obras);
    return (
        <section className="card">
            <div className="card-header">
                <div>
                    <h2 className="card-title">Cumplimiento por obra</h2>
                    <p className="card-subtitle">Sobre lo exigible a cada una según su dotación. Las más atrasadas primero.</p>
                </div>
                {Boolean(bajo) && <Badge variant="danger">{bajo} bajo 50%</Badge>}
            </div>

            {obras.map((o) => {
                const a = o.avance;
                return (
                    <button key={o.obraId} type="button" className="pan-obra-fila" onClick={() => onAbrirObra(o.obraId)}>
                        <span className="pan-obra-texto">
                            <span className="pan-obra-nombre">{o.nombre}</span>
                            <span className="pan-obra-meta">
                                {typeof o.dotacionDeclarada === 'number' ? `${o.dotacionDeclarada} personas` : 'sin dotación declarada'}
                                {a ? ` · ${a.cumplidos}/${a.exigibles} ítems` : ' · sin datos de cumplimiento'}
                                {o.comuna ? ` · ${o.comuna}` : ''}
                            </span>
                        </span>
                        <span className="progress">
                            <span
                                className="progress-bar"
                                style={{ width: `${a?.progreso ?? 0}%`, background: colorProgreso(a?.progreso ?? 0) }}
                            />
                        </span>
                        <span className="pan-obra-pct" style={{ color: a ? colorProgreso(a.progreso) : 'var(--text-muted)' }}>
                            {a ? `${a.progreso}%` : '—'}
                        </span>
                    </button>
                );
            })}
        </section>
    );
}

/* ─── Por vencer ───────────────────────────────────────────────────────────── */

function PanelPorVencer({ items, nombreDe }: { items: PorVencer[]; nombreDe: (id: string | null) => string }) {
    return (
        <section className="card">
            <div className="card-header">
                <div>
                    <h2 className="card-title">Por vencer</h2>
                    <p className="card-subtitle">Próximos 90 días, en todas las obras.</p>
                </div>
            </div>
            {!items.length ? (
                <p className="text-secondary" style={{ margin: 0 }}>
                    Nada vence en los próximos 90 días. Solo se cuentan los documentos que llevan fecha de caducidad.
                </p>
            ) : (
                <div className="pan-lista">
                    {items.slice(0, 8).map((d) => (
                        <div key={d.documentId} className="pan-item">
                            <span className="pan-item-texto">
                                <span className="pan-item-nombre">{d.titulo}</span>
                                <span className="pan-item-meta">{nombreDe(d.obraId)}</span>
                            </span>
                            <Badge variant={d.dias < 0 ? 'danger' : d.dias <= 30 ? 'danger' : d.dias <= 60 ? 'warning' : 'info'}>
                                {d.dias < 0 ? `vencido hace ${Math.abs(d.dias)} d` : `${d.dias} días`}
                            </Badge>
                        </div>
                    ))}
                </div>
            )}
        </section>
    );
}

/* ─── EPP ──────────────────────────────────────────────────────────────────── */

const MOTIVO_TEXTO: Record<string, string> = {
    desgaste: 'por desgaste',
    perdida: 'por pérdida',
    accidente: 'por accidente',
    cambio_talla: 'por cambio de talla',
    otro: 'por otro motivo',
};

function PanelEpp({ items }: { items: ItemEpp[] }) {
    return (
        <section className="card">
            <div className="card-header">
                <div>
                    <h2 className="card-title">Reposiciones de EPP</h2>
                    <p className="card-subtitle">
                        Lo que se repone seguido, y por qué. Un elemento que se repone por desgaste apunta al proveedor, no al uso.
                    </p>
                </div>
                <FiPackage aria-hidden="true" className="pan-card-icono" />
            </div>
            {!items.length ? (
                <p className="text-secondary" style={{ margin: 0 }}>
                    Todavía no hay entregas de EPP registradas con el detalle de los elementos.
                </p>
            ) : (
                <div className="pan-lista">
                    {items.slice(0, 8).map((it) => {
                        const dominante = motivoDominante(it);
                        return (
                            <div key={it.descripcion} className="pan-item">
                                <span className="pan-item-texto">
                                    <span className="pan-item-nombre">{it.descripcion}</span>
                                    <span className="pan-item-meta">
                                        {it.reposiciones
                                            ? `${it.reposiciones} ${it.reposiciones === 1 ? 'reposición' : 'reposiciones'}${dominante ? `, ${dominante.porcentaje}% ${MOTIVO_TEXTO[dominante.motivo] || dominante.motivo}` : ''}`
                                            : 'sin reposiciones'}
                                        {` · ${it.obras} ${it.obras === 1 ? 'obra' : 'obras'}`}
                                    </span>
                                </span>
                                <span className="pan-item-cifra" style={{ color: it.reposiciones ? 'var(--danger-500)' : 'var(--text-primary)' }}>
                                    {it.entregas}
                                </span>
                            </div>
                        );
                    })}
                </div>
            )}
            <div className="pan-leyenda">
                <span><FiClock aria-hidden="true" /> La cifra es el total de entregas del elemento.</span>
            </div>
        </section>
    );
}

/* ─── Siniestralidad (Arts. 73-75) ─────────────────────────────────────────── */

/**
 * Los tres indicadores legales, consolidados.
 *
 * Van arriba y en su propia banda porque son los únicos números del panel con
 * consecuencia económica directa: la siniestralidad determina la cotización
 * adicional del seguro de la Ley 16.744. Un gerente los reconoce de inmediato;
 * el resto del panel le explica por qué están así.
 */
function PanelSiniestralidad({ datos, obras, sinDotacion }: {
    datos: IncidentStats;
    obras: number;
    /** Obras sin dotación declarada: su masa laboral la pone el servidor por
     *  omisión, así que las tasas quedan calculadas sobre una base incompleta y
     *  eso se dice, en vez de presentarlas como exactas. */
    sinDotacion: number;
}) {
    const { porGravedad } = datos;
    const hayFatal = porGravedad.fatal > 0;
    return (
        <section className="card pan-sin">
            <div className="card-header">
                <div>
                    <h2 className="card-title">Siniestralidad</h2>
                    <p className="card-subtitle">
                        Arts. 73-75 · {obras} {obras === 1 ? 'obra' : 'obras'} · masa laboral {datos.masaLaboral}
                    </p>
                </div>
                {hayFatal
                    ? <Badge variant="danger">{porGravedad.fatal} fatal{porGravedad.fatal === 1 ? '' : 'es'}</Badge>
                    : porGravedad.grave > 0 && <Badge variant="warning">{porGravedad.grave} graves</Badge>}
            </div>

            <div className="pan-sin-cifras">
                <div className="pan-sin-cifra">
                    <span className="pan-sin-valor">{datos.numeroAccidentes}</span>
                    <span className="pan-sin-rotulo">Accidentes</span>
                </div>
                <div className="pan-sin-cifra">
                    <span className="pan-sin-valor">{datos.diasPerdidos}</span>
                    <span className="pan-sin-rotulo">Días perdidos</span>
                </div>
                <div className="pan-sin-cifra">
                    <span className="pan-sin-valor">{datos.tasaAccidentabilidad}</span>
                    <span className="pan-sin-rotulo">T. accidentabilidad</span>
                </div>
                <div className="pan-sin-cifra">
                    <span className="pan-sin-valor">{datos.siniestralidad}</span>
                    <span className="pan-sin-rotulo">Siniestralidad</span>
                </div>
                <div className="pan-sin-cifra">
                    <span className="pan-sin-valor">{datos.tasaFrecuencia}</span>
                    <span className="pan-sin-rotulo">T. frecuencia</span>
                </div>
            </div>

            <p className="pan-nota">
                Las tasas se recalculan sobre los totales de todas las obras, no se promedian:
                promediarlas le daría a una obra de doce personas el mismo peso que a una de ciento treinta.
                Leves {porGravedad.leve} · graves {porGravedad.grave} · fatales {porGravedad.fatal}.
                {sinDotacion > 0 && ` ${sinDotacion} ${sinDotacion === 1 ? 'obra no declara' : 'obras no declaran'} su dotación, así que su masa laboral es la que asume el servidor y las tasas quedan aproximadas.`}
            </p>
        </section>
    );
}

/* ─── Obras donde el papeleo no evita accidentes ───────────────────────────── */

function PanelRiesgo({ items, onAbrirObra }: { items: ObraEnRiesgo[]; onAbrirObra: (id: string) => void }) {
    return (
        <section className="card">
            <div className="card-header">
                <div>
                    <h2 className="card-title">Cumple y accidenta</h2>
                    <p className="card-subtitle">
                        Obras con accidentes, ordenadas por gravedad. Un buen porcentaje acá significa
                        que el problema no es documental.
                    </p>
                </div>
                <FiTrendingUp aria-hidden="true" className="pan-card-icono" />
            </div>
            {!items.length ? (
                <p className="text-secondary" style={{ margin: 0 }}>
                    Ninguna obra registra accidentes en el periodo. Nada que contrastar.
                </p>
            ) : (
                <div className="pan-lista">
                    {items.map((o) => (
                        <div key={o.obraId} className="pan-item">
                            <button type="button" className="pan-enlace pan-item-texto" onClick={() => onAbrirObra(o.obraId)}>
                                <span className="pan-item-nombre">{o.nombre}</span>
                                <span className="pan-item-meta">
                                    {o.accidentes} {o.accidentes === 1 ? 'accidente' : 'accidentes'}
                                    {o.diasPerdidos > 0 ? ` · ${o.diasPerdidos} días perdidos` : ''}
                                    {o.fatales > 0 ? ` · ${o.fatales} fatal${o.fatales === 1 ? '' : 'es'}` : ''}
                                </span>
                            </button>
                            <span
                                className="pan-item-cifra"
                                style={{ color: o.progreso === null ? 'var(--text-muted)' : colorProgreso(o.progreso) }}
                            >
                                {o.progreso === null ? '—' : `${o.progreso}%`}
                            </span>
                        </div>
                    ))}
                </div>
            )}
        </section>
    );
}

/* ─── Prescripciones (Art. 70) ─────────────────────────────────────────────── */

const ORIGEN_CORTO: Record<string, string> = {
    OrganismoFiscalizador: 'Fiscalizador',
    OrganismoAdministrador: 'Organismo Administrador',
    DepartamentoPrevencion: 'Departamento de Prevención',
    ComiteParitario: 'Comité paritario',
};

function PanelPrescripciones({ resumen, nombreDe }: {
    resumen: ResumenPrescripciones;
    nombreDe: (id: string | null) => string;
}) {
    return (
        <section className="card">
            <div className="card-header">
                <div>
                    <h2 className="card-title">Medidas prescritas vencidas</h2>
                    <p className="card-subtitle">
                        Art. 70 · plazo cumplido y sin implementar. Es lo único del panel que ya
                        es incumplimiento ante quien lo prescribió.
                    </p>
                </div>
                {Boolean(resumen.vencidas.length) && (
                    <Badge variant="danger">{resumen.obrasAfectadas} {resumen.obrasAfectadas === 1 ? 'obra' : 'obras'}</Badge>
                )}
            </div>
            {!resumen.vencidas.length ? (
                <p className="text-secondary" style={{ margin: 0 }}>
                    {resumen.total === 0
                        ? 'No hay medidas prescritas registradas.'
                        : `Ninguna de las ${resumen.total} medidas registradas está vencida. ${resumen.pendientes} en plazo, ${resumen.implementadas} implementadas.`}
                </p>
            ) : (
                <div className="pan-lista">
                    {resumen.vencidas.slice(0, 8).map((pr) => {
                        const atraso = diasDeAtraso(pr);
                        return (
                            <div key={pr.prescripcionId} className="pan-item">
                                <span className="pan-item-texto">
                                    <span className="pan-item-nombre">{pr.descripcion}</span>
                                    <span className="pan-item-meta">
                                        {ORIGEN_CORTO[pr.origen] || pr.origen} · {nombreDe(pr.obraId)}
                                    </span>
                                </span>
                                <Badge variant="danger">
                                    {atraso === null ? 'vencida' : `${atraso} d de atraso`}
                                </Badge>
                            </div>
                        );
                    })}
                </div>
            )}
        </section>
    );
}
