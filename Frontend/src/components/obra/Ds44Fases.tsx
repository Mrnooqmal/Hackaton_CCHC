import { useCallback, useMemo, useState } from 'react';
import {
    LuArrowRight, LuCalendar, LuChevronRight, LuEye, LuSend, LuSignature, LuUpload, LuUserCheck, LuUsers,
} from 'react-icons/lu';
import { Drawer } from '../ui';
import DistribucionPanel from '../DistribucionPanel';
import { requisitosDeFase, resumenDeFase, type FaseDeming } from '../FufPorFase';
import { itemFuf } from '../../utils/fuf';
import { PREGUNTA_CONDICION, type CompletitudAmbito, type RequisitoFuf, type EstadoRequisito } from '../../utils/completitud';
import CargaEvidencia, { type PersonaFirmante } from './CargaEvidencia';
import { documentsApi } from '../../api/documents.api';
import { ETIQUETA_ESTADO as ETIQUETA } from '../../utils/etiquetaEstado';
import IconoEstado from './IconoEstado';
import type { Document } from '../../api/documents.api';

export interface ModuloFase {
    key: string;
    nombre: string;
    /** Una línea: para qué sirve. Sin esto el enlace no se entiende. */
    que: string;
    estado?: string | null;
    /** Contenido que se abre en un panel lateral, sin salir de la obra. */
    contenido?: React.ReactNode;
    /** Alternativa a `contenido`: el módulo vive en otra pantalla. */
    onAbrir?: () => void;
}

export interface Ds44FasesProps {
    tenantId: string;
    obraId: string;
    completitud: CompletitudAmbito | null;
    documentos: Document[];
    fase: FaseDeming;
    onFase: (f: FaseDeming) => void;
    modulos: Record<FaseDeming, ModuloFase[]>;
    /** Personas de la obra, para elegir quiénes firman lo que se carga. */
    personas: PersonaFirmante[];
    onRecargar: () => void | Promise<void>;
    onVerDocumento: (doc: Document) => void;
    onAgendarActividad: (criterio: { subtipo?: string; titulo?: string; tipos?: string[] }) => void;
    onIrAModulo: (modulo: string) => void;
    onDeclarar: (campo: 'faenaCompartida' | 'tieneMaquinaria' | 'agentesFQB', valor: boolean) => Promise<void> | void;
}

const FASES: Array<{ key: FaseDeming; nombre: string }> = [
    { key: 'plan', nombre: 'Planificar' },
    { key: 'hacer', nombre: 'Hacer' },
    { key: 'verificar', nombre: 'Verificar' },
    { key: 'actuar', nombre: 'Actuar' },
];


type Filtro = 'todos' | 'Vencido' | 'Pendiente' | 'Parcial' | 'Cumplido';
const FILTROS: Array<{ key: Filtro; label: string }> = [
    { key: 'todos', label: 'Todos' },
    { key: 'Vencido', label: 'Vencido' },
    { key: 'Pendiente', label: 'Pendiente' },
    { key: 'Parcial', label: 'Incompleto' },
    { key: 'Cumplido', label: 'Completado' },
];

/** Lo urgente primero; lo que no aplica, al final. */
const ORDEN: Record<EstadoRequisito, number> = { Vencido: 0, Pendiente: 1, Parcial: 2, Cumplido: 3, NoAplica: 4, FueraDeAlcance: 5 };

/**
 * Tema de cada ítem, para agrupar las listas largas.
 *
 * No son las secciones del FUF: éstas mezclan, por ejemplo, el EPP con el
 * Programa de Trabajo Preventivo (sección 3). Se agrupa por lo que la persona
 * reconoce en terreno; el número del FUF sigue en cada fila.
 */
const TEMA: Record<number, string> = {
    1: 'Sistema de gestión',
    2: 'MIPER y mapa de riesgos', 3: 'MIPER y mapa de riesgos', 4: 'MIPER y mapa de riesgos',
    5: 'MIPER y mapa de riesgos', 6: 'MIPER y mapa de riesgos', 7: 'MIPER y mapa de riesgos', 53: 'MIPER y mapa de riesgos',
    8: 'Programa de Trabajo Preventivo', 9: 'Programa de Trabajo Preventivo', 10: 'Programa de Trabajo Preventivo',
    11: 'Programa de Trabajo Preventivo', 20: 'Programa de Trabajo Preventivo',
    12: 'Equipos y EPP', 13: 'Equipos y EPP', 14: 'Equipos y EPP', 15: 'Equipos y EPP',
    16: 'Equipos y EPP', 17: 'Equipos y EPP', 18: 'Equipos y EPP', 19: 'Equipos y EPP',
    21: 'Información y capacitación', 22: 'Información y capacitación', 23: 'Información y capacitación',
    24: 'Información y capacitación', 25: 'Información y capacitación',
    26: 'Emergencias', 27: 'Emergencias', 28: 'Emergencias', 29: 'Emergencias',
    30: 'Comité Paritario y delegado', 31: 'Comité Paritario y delegado', 32: 'Comité Paritario y delegado',
    33: 'Comité Paritario y delegado', 34: 'Comité Paritario y delegado', 35: 'Comité Paritario y delegado',
    36: 'Comité Paritario y delegado', 37: 'Comité Paritario y delegado', 38: 'Comité Paritario y delegado',
    39: 'Comité Paritario y delegado', 40: 'Comité Paritario y delegado',
    41: 'Departamento de Prevención', 42: 'Departamento de Prevención', 43: 'Departamento de Prevención',
    44: 'Departamento de Prevención', 45: 'Departamento de Prevención', 46: 'Departamento de Prevención',
    47: 'Departamento de Prevención', 48: 'Departamento de Prevención',
    49: 'Reglamento Interno', 50: 'Reglamento Interno', 51: 'Reglamento Interno', 52: 'Reglamento Interno',
    54: 'Vigilancia', 55: 'Vigilancia', 56: 'Vigilancia', 57: 'Vigilancia',
    58: 'Prescripciones', 59: 'Investigación de accidentes', 60: 'Registro documental',
    61: 'Gestión de cambios', 62: 'Procedimientos', 63: 'Registros de la entidad',
    64: 'Registros de la entidad', 65: 'Procedimientos', 66: 'Investigación de accidentes',
};

/** Con más requisitos que esto, la fase se agrupa por tema. */
const LIMITE_LISTA_PLANA = 6;

const esEstadoExigible = (e: EstadoRequisito) => e !== 'NoAplica' && e !== 'FueraDeAlcance';


/**
 * Cumplimiento DS 44 de la obra, fase por fase.
 *
 * Las fases son una forma de ordenar, no una secuencia: se pueden trabajar en
 * paralelo, así que ninguna se marca como "la actual". Todo sale del motor de
 * completitud —la misma evaluación del repositorio y del export—; este
 * componente solo decide cómo mostrarlo.
 */
export default function Ds44Fases({
    tenantId, obraId, completitud, documentos, fase, onFase, modulos, personas,
    onRecargar, onVerDocumento, onAgendarActividad, onIrAModulo, onDeclarar,
}: Ds44FasesProps) {
    const [filtro, setFiltro] = useState<Filtro>('todos');
    // `undefined` = aún no elige: se abre el primer grupo con algo por resolver.
    const [grupoAbierto, setGrupoAbierto] = useState<string | null | undefined>(undefined);
    // Se guarda con su fase: si algo dentro del panel cambia de fase ("Revisar
    // documento" lleva a Planificar), el panel de la fase anterior no queda encima.
    const [moduloAbierto, setModuloAbierto] = useState<{ key: string; fase: FaseDeming } | null>(null);
    const [remisionDe, setRemisionDe] = useState<string | null>(null);
    // Formulario de carga (archivo, fecha, caducidad y firmantes) o de firmantes
    // de un documento ya cargado.
    const [carga, setCarga] = useState<{ modo: 'cargar' | 'firmantes'; r: RequisitoFuf; documentId?: string } | null>(null);
    const [declarando, setDeclarando] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    const cambiarFase = (f: FaseDeming) => {
        onFase(f);
        setModuloAbierto(null);
        setFiltro('todos');
        setGrupoAbierto(undefined);
    };

    const porFase = useMemo(() => {
        const m = {} as Record<FaseDeming, RequisitoFuf[]>;
        FASES.forEach((f) => { m[f.key] = requisitosDeFase(completitud, f.key); });
        return m;
    }, [completitud]);

    const requisitos = useMemo(() => porFase[fase] || [], [porFase, fase]);
    const visibles = useMemo(
        () => requisitos
            .filter((r) => filtro === 'todos' || r.estado === filtro)
            .slice()
            .sort((a, b) => (ORDEN[a.estado] - ORDEN[b.estado]) || ((a.item || 0) - (b.item || 0))),
        [requisitos, filtro]
    );

    const agrupar = requisitos.length > LIMITE_LISTA_PLANA && visibles.length > LIMITE_LISTA_PLANA;
    const grupos = useMemo(() => {
        if (!agrupar) return [];
        const nombres: string[] = [];
        requisitos
            .slice().sort((a, b) => (a.item || 0) - (b.item || 0))
            .forEach((r) => {
                const g = TEMA[r.item || 0] || 'Otros requisitos';
                if (!nombres.includes(g)) nombres.push(g);
            });
        return nombres
            .map((nombre) => ({
                nombre,
                todos: requisitos.filter((r) => (TEMA[r.item || 0] || 'Otros requisitos') === nombre),
                filas: visibles.filter((r) => (TEMA[r.item || 0] || 'Otros requisitos') === nombre),
            }))
            .filter((g) => g.filas.length > 0);
    }, [agrupar, requisitos, visibles]);

    const abierto = grupoAbierto === undefined
        ? (grupos.find((g) => g.todos.some((r) => esEstadoExigible(r.estado) && r.estado !== 'Cumplido')) || grupos[0])?.nombre ?? null
        : grupoAbierto;

    const evidenciaDe = useCallback((r: RequisitoFuf): Document[] => {
        const tipos = new Set(r.tipos || []);
        if (tipos.size === 0) return [];
        return documentos.filter((d) => tipos.has(d.tipo) && (d.s3Key || d.archivoUrl));
    }, [documentos]);


    const declarar = async (r: RequisitoFuf, valor: boolean) => {
        const campo = r.condicion ? PREGUNTA_CONDICION[r.condicion]?.campo : null;
        if (!campo) return;
        setDeclarando(r.id);
        try {
            await onDeclarar(campo, valor);
            await onRecargar();
        } finally {
            setDeclarando(null);
        }
    };

    const reqRemision = remisionDe ? requisitos.find((r) => r.id === remisionDe) || null : null;

    // Pedir la firma = asignarle el documento: le llega a "Mis firmas" y al inbox,
    // y cuando firma, el motor lo da por aprobado con la firma real.
    const [solicitando, setSolicitando] = useState<string | null>(null);
    // Recordar reusa la misma llamada: a quien ya tiene la firma pendiente el
    // backend no la duplica, solo le vuelve a avisar.
    const solicitarFirma = async (r: RequisitoFuf, documentId: string, personaIds: string[]) => {
        setSolicitando(r.id);
        setError(null);
        try {
            const res = await documentsApi.assign(documentId, { workerIds: personaIds, personaIds, notificar: true });
            if (!res.success) throw new Error(res.error || 'No se pudo solicitar la firma.');
            await onRecargar();
        } catch (e) {
            setError(e instanceof Error ? e.message : 'No se pudo solicitar la firma.');
        } finally {
            setSolicitando(null);
        }
    };

    /**
     * Una sola acción por fila, siempre del mismo vocabulario: Cargar, Registrar,
     * Agendar o Ver. La fila decide cuál según cómo se acredita el requisito.
     */
    const accionDe = (r: RequisitoFuf) => {
        if (!esEstadoExigible(r.estado)) return null;
        const evidencia = evidenciaDe(r);

        if (r.aplicabilidad === 'verificar' && r.condicion && PREGUNTA_CONDICION[r.condicion]) {
            return (
                <>
                    <button type="button" className="ob-btn ob-btn--corto" disabled={declarando !== null} onClick={() => declarar(r, true)}>Sí</button>
                    <button type="button" className="ob-btn ob-btn--corto" disabled={declarando !== null} onClick={() => declarar(r, false)}>No</button>
                </>
            );
        }
        if (r.distribucion && r.estado !== 'Cumplido') {
            return <button type="button" className="ob-btn ob-btn--fila" onClick={() => setRemisionDe(r.id)}><LuSend size={14} /> Registrar</button>;
        }
        if (r.estado === 'Cumplido' && evidencia.length > 0) {
            return <button type="button" className="ob-btn ob-btn--fila" onClick={() => onVerDocumento(evidencia[0])}><LuEye size={14} /> Ver</button>;
        }
        if (r.accion?.tipo === 'designar_representante') {
            return (
                <button type="button" className="ob-btn ob-btn--fila" title="Se designa en Mi Empresa → Identidad" onClick={() => onIrAModulo('representante')}>
                    <LuUserCheck size={14} /> Designar
                </button>
            );
        }
        if (r.accion?.tipo === 'asignar_firmantes') {
            const { documentId } = r.accion;
            return (
                <button type="button" className="ob-btn ob-btn--fila" title="Elegir quiénes firman el documento ya cargado"
                    onClick={() => setCarga({ modo: 'firmantes', r, documentId })}>
                    <LuUsers size={14} /> Firmantes
                </button>
            );
        }
        if (r.accion?.tipo === 'solicitar_firma') {
            const { documentId, personaId, solicitada } = r.accion;
            return (
                <button type="button" className="ob-btn ob-btn--fila" disabled={solicitando !== null}
                    title={solicitada ? 'Vuelve a notificarle que tiene la firma pendiente' : 'Le asigna el documento para que lo firme'}
                    onClick={() => solicitarFirma(r, documentId, [personaId])}>
                    <LuSignature size={14} /> {solicitando === r.id ? 'Enviando…' : solicitada ? 'Recordar' : 'Solicitar'}
                </button>
            );
        }
        if (r.accion?.tipo === 'recordar_firmas') {
            const { documentId, personaIds } = r.accion;
            return (
                <button type="button" className="ob-btn ob-btn--fila" disabled={solicitando !== null || personaIds.length === 0}
                    title="Vuelve a notificar a quienes todavía no firman"
                    onClick={() => solicitarFirma(r, documentId, personaIds)}>
                    <LuSignature size={14} /> {solicitando === r.id ? 'Enviando…' : 'Recordar'}
                </button>
            );
        }
        if (r.cargar) {
            return (
                <button type="button" className="ob-btn ob-btn--fila"
                    title={r.cargar.que ? `Cargar ${r.cargar.que}` : 'Cargar documento'}
                    onClick={() => setCarga({ modo: 'cargar', r })}>
                    <LuUpload size={14} /> Cargar
                </button>
            );
        }
        if (r.modulo) {
            // La estructura preventiva se gestiona en su panel, que ya está en la
            // columna de módulos: se abre ahí mismo en vez de salir de la obra.
            // Primero en la fase actual: el panel solo se muestra si es de la fase
            // en pantalla, y la estructura aparece en más de una.
            const enFase = (f: FaseDeming) => (modulos[f] || []).some((m) => m.key === 'estructura' && m.contenido);
            const faseDelPanel = r.modulo !== 'estructura' ? null
                : enFase(fase) ? fase : FASES.map((f) => f.key).find(enFase) || null;
            const panel = faseDelPanel ? { key: 'estructura', fase: faseDelPanel } : null;
            return (
                <button type="button" className="ob-btn ob-btn--fila"
                    onClick={() => {
                        if (!panel) { onIrAModulo(r.modulo as string); return; }
                        if (panel.fase !== fase) onFase(panel.fase);
                        setModuloAbierto(panel);
                    }}>
                    <LuEye size={14} /> Ver
                </button>
            );
        }
        return null;
    };

    const fila = (r: RequisitoFuf) => {
        const item = r.item != null ? itemFuf(r.item) : null;
        // Lo que está fuera del formulario se nombra por su artículo: un número de
        // ítem inventado engañaría al fiscalizador.
        const codigo = item?.fueraDelFormulario
            ? item.articulo
            : `FUF ${r.item}${item?.articulo ? ` · ${item.articulo}` : ''}`;
        const evidencia = evidenciaDe(r);
        // Vía alternativa de las capacitaciones: agendarla en la plataforma. La
        // principal es cargar el registro del hecho (lista de asistencia o
        // certificado), que es lo que llega cuando la dicta un externo.
        const puedeAgendar = Boolean(r.acreditacion && r.estado !== 'Cumplido');
        // Qué falta, dicho en palabras: sin esto "Incompleto" no explicaba nada.
        const queFalta = r.accion?.falta || r.cargar?.que;
        // Un requisito cumplido puede tener firmas pendientes que la norma no exige
        // para darlo por cumplido: se informa sin llamarlo "falta".
        const recordar = r.accion?.tipo === 'recordar_firmas' ? r.accion : null;
        const falta = r.estado !== 'Cumplido' && queFalta ? `Falta ${queFalta}.`
            : recordar ? `Queda pendiente ${recordar.falta} (${recordar.total - recordar.pendientes} de ${recordar.total} firmaron).` : null;
        return (
            <div key={r.id} className="ob-fila">
                <span className="ob-fila__icono"><IconoEstado estado={r.estado} /></span>
                <div className="ob-fila__texto">
                    <span className="ob-fila__titulo">{r.titulo}</span>
                    <span className="ob-fila__meta">{codigo}{(r.justificacion || r.detalle) ? ` · ${r.justificacion || r.detalle}` : ''}</span>
                    {falta && <span className="ob-fila__falta">{falta}</span>}
                    {puedeAgendar && (
                        <button type="button" className="ob-fila__alterna" onClick={() => onAgendarActividad(r.acreditacion!.criterio)}>
                            <LuCalendar size={12} /> o agéndala en la plataforma
                        </button>
                    )}
                    {r.estado === 'Cumplido' && recordar && recordar.personaIds.length > 0 && (
                        <button type="button" className="ob-fila__alterna" disabled={solicitando !== null}
                            onClick={() => solicitarFirma(r, recordar.documentId, recordar.personaIds)}>
                            <LuSignature size={12} /> {solicitando === r.id ? 'Enviando…' : 'Recordar a quienes no han firmado'}
                        </button>
                    )}
                    {r.estado !== 'Cumplido' && evidencia.length > 0 && (
                        <button type="button" className="ob-fila__alterna" onClick={() => onVerDocumento(evidencia[0])}>
                            Ver documento cargado
                        </button>
                    )}
                </div>
                <span className={`ob-etiqueta ob-etiqueta--${r.estado}`}>{ETIQUETA[r.estado]}</span>
                <div className="ob-fila__acciones">{accionDe(r)}</div>
            </div>
        );
    };

    const resumenTotal = completitud?.resumen;
    const conteo = (k: Filtro) => (k === 'todos' ? requisitos.length : requisitos.filter((r) => r.estado === k).length);
    const nombreFase = FASES.find((f) => f.key === fase)?.nombre || '';
    const modulosFase = modulos[fase] || [];
    // Se lee de la lista vigente y no de una copia: así el panel refleja lo que
    // cambie mientras está abierto.
    const moduloVigente = moduloAbierto && moduloAbierto.fase === fase
        ? modulosFase.find((m) => m.key === moduloAbierto.key) || null
        : null;

    return (
        <div className="ob-ds44">
            <section className="ob-ds44__avance" aria-label="Avance del DS 44">
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <span className="ob-rotulo">Avance DS 44 de la obra</span>
                    <span className="ob-cifra">{resumenTotal ? `${resumenTotal.progreso}%` : '—'}</span>
                </div>
                <div className="ob-fases" role="tablist" aria-label="Fases del DS 44">
                    {FASES.map((f) => {
                        const r = resumenDeFase(porFase[f.key] || []);
                        const completa = r.exigibles > 0 && r.progreso === 100;
                        return (
                            <button key={f.key} type="button" role="tab" className="ob-fase"
                                aria-selected={f.key === fase} onClick={() => cambiarFase(f.key)}>
                                <span className="ob-fase__cabeza"><span>{f.nombre}</span><span className="ob-fase__pct">{r.progreso}%</span></span>
                                <span className={`ob-barra${completa ? ' ob-barra--completa' : ''}`}><span style={{ width: `${r.progreso}%` }} /></span>
                                <span className="ob-fase__cuenta">{r.cumplidos} de {r.exigibles} completados</span>
                            </button>
                        );
                    })}
                </div>
            </section>

            <div className="ob-ds44__cuerpo">
                <section aria-label={`Requisitos de ${nombreFase}`} style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
                    <div className="ob-ds44__encabezado">
                        <h2 className="ob-h2">Requisitos de {nombreFase}</h2>
                        <div className="ob-filtros" role="group" aria-label="Filtrar por estado">
                            {FILTROS.map((f) => (
                                <button key={f.key} type="button" className="ob-filtro" aria-pressed={filtro === f.key}
                                    onClick={() => { setFiltro(f.key); setGrupoAbierto(undefined); }}>
                                    {f.label}<span className="ob-filtro__n">{conteo(f.key)}</span>
                                </button>
                            ))}
                        </div>
                    </div>

                    {error && <div className="ds44-alert ds44-alert-danger" style={{ fontSize: '0.85rem' }}>{error}</div>}

                    <div className="ob-lista">
                        {!completitud && <div className="ob-lista__vacia">Cargando los requisitos…</div>}
                        {completitud && visibles.length === 0 && (
                            <div className="ob-lista__vacia">No hay requisitos con este estado en {nombreFase}.</div>
                        )}
                        {completitud && visibles.length > 0 && !agrupar && visibles.map(fila)}
                        {completitud && agrupar && grupos.map((g) => {
                            const r = resumenDeFase(g.todos);
                            const vencidos = g.todos.filter((x) => x.estado === 'Vencido').length;
                            const porResolver = g.todos.filter((x) => x.estado === 'Pendiente' || x.estado === 'Parcial').length;
                            const esAbierto = g.nombre === abierto;
                            return (
                                <div key={g.nombre}>
                                    <button type="button" className="ob-grupo__cabeza" aria-expanded={esAbierto}
                                        onClick={() => setGrupoAbierto(esAbierto ? null : g.nombre)}>
                                        <LuChevronRight size={16} className="ob-grupo__chevron" aria-hidden="true" />
                                        <span className="ob-grupo__nombre">{g.nombre}</span>
                                        {vencidos > 0 && <span className="ob-etiqueta ob-etiqueta--Vencido">{vencidos} vencido{vencidos === 1 ? '' : 's'}</span>}
                                        {vencidos === 0 && porResolver > 0 && (
                                            <span className="ob-etiqueta ob-etiqueta--Pendiente">{porResolver} pendiente{porResolver === 1 ? '' : 's'}</span>
                                        )}
                                        <span className="ob-grupo__cuenta">{r.cumplidos} de {r.exigibles} completados</span>
                                        <span className={`ob-barra ob-grupo__barra${r.exigibles > 0 && r.progreso === 100 ? ' ob-barra--completa' : ''}`}>
                                            <span style={{ width: `${r.progreso}%` }} />
                                        </span>
                                    </button>
                                    {esAbierto && <div className="ob-grupo__filas">{g.filas.map(fila)}</div>}
                                </div>
                            );
                        })}
                    </div>
                </section>

                {modulosFase.length > 0 && (
                    <aside className="ob-modulos" aria-label={`Módulos de ${nombreFase}`}>
                        <h2 className="ob-h2" style={{ fontSize: '0.9375rem', marginBottom: 4 }}>Módulos de {nombreFase}</h2>
                        <p className="ob-modulos__intro">Donde se registra el trabajo del día a día que después acredita los requisitos.</p>
                        {modulosFase.map((m) => (
                            <button key={m.key} type="button" className="ob-modulo"
                                onClick={() => (m.contenido ? setModuloAbierto({ key: m.key, fase }) : m.onAbrir?.())}>
                                <span className="ob-modulo__nombre">{m.nombre}</span>
                                <LuArrowRight size={16} color="var(--accent-text)" aria-hidden="true" />
                                <span className="ob-modulo__que">{m.que}</span>
                                <span />
                                {m.estado && <span className="ob-modulo__estado">{m.estado}</span>}
                            </button>
                        ))}
                    </aside>
                )}
            </div>

            {moduloVigente && (
                <Drawer isOpen onClose={() => setModuloAbierto(null)} title={moduloVigente.nombre} subtitle={moduloVigente.que} width={640}>
                    {moduloVigente.contenido}
                </Drawer>
            )}

            {carga && (
                <CargaEvidencia
                    modo={carga.modo}
                    tenantId={tenantId}
                    obraId={obraId}
                    titulo={carga.r.titulo}
                    que={carga.modo === 'cargar' ? carga.r.cargar?.que : carga.r.accion?.falta}
                    tipo={carga.r.cargar?.tipo}
                    documentId={carga.documentId}
                    personas={personas}
                    onCerrar={() => setCarga(null)}
                    onListo={onRecargar}
                />
            )}

            {reqRemision?.distribucion && (
                <Drawer isOpen onClose={() => setRemisionDe(null)} title="Constancias de envío"
                    subtitle={`FUF ${reqRemision.item} · ${reqRemision.distribucion.titulo || reqRemision.titulo}`} width={560}>
                    <DistribucionPanel distribucion={reqRemision.distribucion} tenantId={tenantId} obraId={obraId} onCambio={onRecargar} />
                </Drawer>
            )}
        </div>
    );
}
