import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    LuArrowRight, LuDownload, LuEye, LuFilePen, LuFileText, LuInfo, LuSearch, LuSend, LuSignature, LuUpload, LuUserCheck, LuUsers, LuX,
} from 'react-icons/lu';
import { Drawer } from '../ui';
import DistribucionPanel from '../DistribucionPanel';
import IconoEstado from './IconoEstado';
import { estructuraApi } from '../../api/estructura.api';
import { documentsApi, type Document, type DocumentAssignment, type DocumentSignature } from '../../api/documents.api';
import { uploadsApi } from '../../api/uploads.api';
import { agruparPorSeccion, itemFuf } from '../../utils/fuf';
import { ETIQUETA_ESTADO, etiquetaRequisito, coincideFiltro, FILTROS_ESTADO, type FiltroEstado } from '../../utils/etiquetaEstado';
import { workersApi } from '../../api/workers.api';
import CargaEvidencia, { type PersonaFirmante } from './CargaEvidencia';
import NuevaVersion from './NuevaVersion';
import { esVersionable } from '../../utils/versionarDocumento';
import { requiereFirmaRepresentante, ROL_REPRESENTANTE } from '../../utils/firmaRepresentante';
import type { CompletitudAmbito, EstadoRequisito, RequisitoFuf } from '../../utils/completitud';
import type { Ambito } from '../../utils/estructuraPreventiva';
import '../../css/obra.css';
import '../../css/repositorio-ds44.css';

/** Documento tal como llega del listado: trae campos que el tipo base no declara. */
type DocRepo = Document & {
    obraId?: string | null;
    fechaCaducidad?: string | null;
    creatorName?: string | null;
    tipoDescripcion?: string;
};

export interface RepositorioDs44Props {
    tenantId: string;
    ambito: Ambito;
    obraId?: string | null;
    onVerDocumento: (doc: Document) => void;
    onDescargarDocumento: (doc: Document) => void;
}

type Filtro = FiltroEstado;
const FILTROS = FILTROS_ESTADO;
const ORDEN: Record<EstadoRequisito, number> = { Vencido: 0, Pendiente: 1, Parcial: 2, Cumplido: 3, NoAplica: 4, FueraDeAlcance: 5 };

/** Documentos visibles por ítem antes de "Ver los N": los registros por persona son decenas. */
const LIMITE_DOCS = 3;

/** Módulos que resuelven un requisito que no se acredita con un archivo. */
const RUTA_MODULO: Record<string, string> = { prescripciones: '/prescripciones', actividades: '/activities' };

const DESTINATARIO_LABEL: Record<string, string> = {
    PersonaTrabajadora: 'Personas trabajadoras',
    ComiteParitario: 'Comité Paritario',
    DelegadoSST: 'Delegado de SST',
    OrganizacionSindical: 'Organizaciones sindicales',
    LineaMando: 'Línea de mando',
    DepartamentoPrevencion: 'Departamento de Prevención',
};

const fecha = (iso?: string | null) =>
    iso ? new Date(iso).toLocaleDateString('es-CL', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
const fechaHora = (iso?: string | null) =>
    iso ? new Date(iso).toLocaleString('es-CL', { timeZone: 'America/Santiago', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
const fechaDelDoc = (d: DocRepo) => d.fecha || d.updatedAt || d.createdAt || '';
const tieneArchivo = (d: DocRepo) => Boolean(d.s3Key || d.archivoUrl);
const vencido = (d: DocRepo) => Boolean(d.fechaCaducidad && new Date(d.fechaCaducidad).getTime() < Date.now());
/** "Ana Rojas", "Ana Rojas y Juan Pérez", "Ana Rojas, Juan Pérez y 3 personas más". */
const listarNombres = (n: string[]) => (n.length <= 1 ? n[0] || ''
    : n.length === 2 ? `${n[0]} y ${n[1]}`
        : n.length === 3 ? `${n[0]}, ${n[1]} y ${n[2]}`
            : `${n[0]}, ${n[1]} y ${n.length - 2} personas más`);
const firmo = (a: DocumentAssignment) => a.estado === 'firmado' || Boolean(a.fechaFirma);
/** El backend identifica por `personaId`; `workerId` solo viene en documentos antiguos. */
const idPersona = (x: { personaId?: string; workerId?: string }) => x.personaId || x.workerId || '';

/** Firmas del documento: las asignaciones mandan; sin asignaciones, las firmas registradas. */
function conteoFirmas(d: DocRepo) {
    const asig = d.asignaciones || [];
    if (asig.length > 0) return { firmadas: asig.filter(firmo).length, total: asig.length };
    const firmas = d.firmas || [];
    return { firmadas: firmas.length, total: firmas.length };
}

const iniciales = (nombre?: string | null) =>
    (nombre || '?').split(/[\s,]+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase();

/**
 * Carpeta DS 44 del repositorio: el formulario seccionado, para gestionar los
 * documentos que acreditan cada ítem.
 *
 * Tres paneles con alto propio (la página no crece): las secciones del FUF, los
 * requisitos de la sección con sus documentos, y la ficha del documento, que se
 * abre y se cierra. El estado lo calcula el motor de completitud —el mismo del
 * panel y del export—; acá no se evalúa nada.
 */
export default function RepositorioDs44({
    tenantId, ambito, obraId = null, onVerDocumento, onDescargarDocumento,
}: RepositorioDs44Props) {
    const navigate = useNavigate();
    const [data, setData] = useState<CompletitudAmbito | null>(null);
    const [documentos, setDocumentos] = useState<DocRepo[]>([]);
    const [cargando, setCargando] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const [seccion, setSeccion] = useState<number | null>(null);
    const [filtro, setFiltro] = useState<Filtro>('todos');
    const [busqueda, setBusqueda] = useState('');
    const [expandidos, setExpandidos] = useState<Set<string>>(new Set());
    const [ficha, setFicha] = useState<{ documentId: string; reqId: string } | null>(null);
    const [verFirmantes, setVerFirmantes] = useState(false);
    const [remisionDe, setRemisionDe] = useState<string | null>(null);
    const [subiendo, setSubiendo] = useState<string | null>(null);
    const [exportando, setExportando] = useState(false);
    const [carga, setCarga] = useState<{ modo: 'cargar' | 'firmantes'; r: RequisitoFuf; documentId?: string } | null>(null);
    // Documento del que se publica una versión nueva (revisión de la MIPER, del Reglamento…).
    const [versionDe, setVersionDe] = useState<DocRepo | null>(null);
    // Personas del ámbito, para elegir quiénes firman lo que se carga.
    const [personas, setPersonas] = useState<PersonaFirmante[]>([]);
    useEffect(() => {
        let vivo = true;
        workersApi.list(ambito === 'obra' && obraId ? { obraId } : undefined)
            .then((res) => {
                if (!vivo || !res.success || !Array.isArray(res.data)) return;
                setPersonas((res.data as Array<PersonaFirmante & { estado?: string }>).filter((p) => p.estado !== 'inactivo'));
            })
            .catch(() => undefined);
        return () => { vivo = false; };
    }, [ambito, obraId]);

    const cargar = useCallback(async (refresco = false) => {
        if (!tenantId) return;
        if (!refresco) setCargando(true);
        setError(null);
        const [comp, docs] = await Promise.all([
            estructuraApi.completitud(tenantId, ambito, obraId),
            // Todos los del tenant y se acotan acá: el Reglamento Interno no tiene
            // obra y acredita igual dentro de ella, y filtrar por obra en la API
            // lo dejaba fuera.
            documentsApi.list().catch(() => null),
        ]);
        if (comp.success && comp.data) setData(comp.data);
        else setError(comp.error || 'No se pudo cargar el cumplimiento.');
        const lista = ((docs as { data?: { documents?: DocRepo[] } } | null)?.data?.documents) || [];
        setDocumentos(Array.isArray(lista) ? lista : []);
        setCargando(false);
    }, [tenantId, ambito, obraId]);

    useEffect(() => { void cargar(); }, [cargar]);

    /** Mismo criterio que el motor: la obra ve lo suyo y lo de la empresa; la empresa, solo lo suyo. */
    const docsDelAmbito = useMemo(
        () => documentos.filter((d) => tieneArchivo(d) && (ambito === 'obra' ? (!d.obraId || d.obraId === obraId) : !d.obraId)),
        [documentos, ambito, obraId]
    );

    const docsDe = useCallback((r: RequisitoFuf) => {
        const tipos = new Set(r.tipos || []);
        if (tipos.size === 0) return [];
        return docsDelAmbito
            .filter((d) => tipos.has(d.tipo))
            .sort((a, b) => String(fechaDelDoc(b)).localeCompare(String(fechaDelDoc(a))));
    }, [docsDelAmbito]);

    const secciones = useMemo(() => {
        if (!data) return [];
        const noCubiertos = new Set(data.itemsNoCubiertos || []);
        return agruparPorSeccion(data.requisitos).map((s) => {
            const reqs = s.items.filter((i) => !noCubiertos.has(i.numero)).flatMap((i) => i.requisitos);
            const exigibles = reqs.filter((r) => r.estado !== 'NoAplica' && r.estado !== 'FueraDeAlcance');
            const cumplidos = exigibles.filter((r) => r.estado === 'Cumplido').length;
            const puntos = exigibles.reduce((n, r) => n + (r.estado === 'Cumplido' ? 1 : r.estado === 'Parcial' ? 0.5 : 0), 0);
            return {
                numero: s.seccion, nombre: s.nombre, requisitos: reqs,
                exigibles: exigibles.length, cumplidos,
                progreso: exigibles.length ? Math.round((puntos / exigibles.length) * 100) : 0,
                hayVencido: reqs.some((r) => r.estado === 'Vencido'),
            };
        });
    }, [data]);

    // Se abre en la primera sección con algo por resolver: es donde hay trabajo.
    const seccionActual = seccion
        ?? secciones.find((s) => s.requisitos.some((r) => r.estado !== 'Cumplido' && r.estado !== 'NoAplica'))?.numero
        ?? secciones.find((s) => s.requisitos.length > 0)?.numero
        ?? 1;
    const sec = secciones.find((s) => s.numero === seccionActual);

    const q = busqueda.trim().toLowerCase();
    const coincide = useCallback((r: RequisitoFuf) => {
        if (!q) return true;
        const texto = `fuf ${r.item} ${r.titulo}`.toLowerCase();
        return texto.includes(q) || docsDe(r).some((d) => `${d.titulo} ${d.archivoNombre || ''}`.toLowerCase().includes(q));
    }, [q, docsDe]);

    // Al buscar se recorre todo el formulario: buscar es no saber en qué sección está.
    const requisitos = useMemo(() => {
        const base = q ? secciones.flatMap((s) => s.requisitos) : (sec?.requisitos || []);
        return base
            .filter((r) => coincideFiltro(r, filtro) && coincide(r))
            .slice()
            .sort((a, b) => (ORDEN[a.estado] - ORDEN[b.estado]) || ((a.item || 0) - (b.item || 0)));
    }, [q, secciones, sec, filtro, coincide]);

    const baseConteo = q ? secciones.flatMap((s) => s.requisitos).filter(coincide) : (sec?.requisitos || []);
    const conteo = (k: Filtro) => baseConteo.filter((r) => coincideFiltro(r, k)).length;

    const docFicha = ficha ? docsDelAmbito.find((d) => d.documentId === ficha.documentId) || null : null;
    const reqFicha = ficha ? (data?.requisitos || []).find((r) => r.id === ficha.reqId) || null : null;
    const reqRemision = remisionDe ? (data?.requisitos || []).find((r) => r.id === remisionDe) || null : null;

    const abrirFicha = (d: DocRepo, r: RequisitoFuf) => {
        setFicha({ documentId: d.documentId, reqId: r.id });
        setVerFirmantes(false);
    };


    const descargarVersion = async (s3Key?: string | null) => {
        if (!s3Key) return;
        // La pestaña se abre en el clic: abrirla después del await la bloquea el navegador.
        const win = window.open('', '_blank');
        const res = await uploadsApi.getDownloadUrl(s3Key);
        if (res.success && res.data?.downloadUrl && win) win.location.href = res.data.downloadUrl;
        else { win?.close(); alert('No se pudo descargar esta versión.'); }
    };

    const exportar = async () => {
        setExportando(true);
        const res = await estructuraApi.abrirExport(tenantId, ambito, obraId);
        setExportando(false);
        if (!res.ok) alert(res.error || 'No se pudo generar el reporte del FUF.');
    };

    if (cargando) return <div className="text-muted" style={{ fontSize: '0.85rem' }}>Cargando el formulario…</div>;
    if (error || !data) return <div className="ds44-alert ds44-alert-danger" style={{ fontSize: '0.85rem' }}>{error || 'Sin datos.'}</div>;

    const codigoDe = (r: RequisitoFuf) => {
        const item = r.item != null ? itemFuf(r.item) : null;
        return item?.fueraDelFormulario ? item.articulo : `FUF ${r.item}${item?.articulo ? ` · ${item.articulo}` : ''}`;
    };

    // La estructura preventiva se gestiona en la obra (su panel) o en Mi Empresa.
    const rutaModulo = (modulo: string) => (modulo === 'estructura'
        ? (ambito === 'obra' && obraId ? `/obras/${obraId}` : '/mi-empresa')
        : RUTA_MODULO[modulo] || null);

    // Recordar reusa la misma llamada: a quien ya tiene la firma pendiente el
    // backend no la duplica, solo le vuelve a avisar.
    const solicitarFirma = async (r: RequisitoFuf, documentId: string, personaIds: string[]) => {
        setSubiendo(r.id);
        try {
            const res = await documentsApi.assign(documentId, { workerIds: personaIds, personaIds, notificar: true });
            if (!res.success) throw new Error(res.error || 'No se pudo solicitar la firma.');
            await cargar(true);
        } catch (e) {
            alert(e instanceof Error ? e.message : 'No se pudo solicitar la firma.');
        } finally {
            setSubiendo(null);
        }
    };

    /** Vigente del requisito si se renueva publicando una versión; mismo criterio que el motor. */
    const versionableDe = (r: RequisitoFuf): DocRepo | null => {
        const vigente = docsDe(r).slice().sort((a, b) => ((b.version || 0) - (a.version || 0))
            || String(fechaDelDoc(b)).localeCompare(String(fechaDelDoc(a))))[0];
        return vigente && esVersionable(vigente.tipo) ? vigente : null;
    };

    const accionesItem = (r: RequisitoFuf) => {
        if (r.estado === 'NoAplica' || r.estado === 'FueraDeAlcance') return null;
        const accion = r.accion;
        // Una revisión vencida (ítems 6 y 51) se renueva con una versión nueva del mismo documento.
        const versionable = r.estado === 'Vencido' ? versionableDe(r) : null;
        return (
            <span className="rd-iconos">
                {versionable && (
                    <button type="button" className="rd-icono" aria-label="Publicar nueva versión" title="Publicar nueva versión"
                        onClick={() => setVersionDe(versionable)}>
                        <LuFilePen size={16} />
                    </button>
                )}
                {accion?.tipo === 'designar_representante' && (
                    <button type="button" className="rd-icono" aria-label="Designar representante legal" title="Designar representante legal (Mi Empresa → Identidad)"
                        onClick={() => navigate('/mi-empresa')}>
                        <LuUserCheck size={16} />
                    </button>
                )}
                {accion?.tipo === 'solicitar_firma' && (
                    <button type="button" className="rd-icono" disabled={subiendo !== null}
                        aria-label={accion.solicitada ? 'Recordar la firma pendiente' : 'Solicitar la firma'}
                        title={accion.solicitada ? 'Recordar la firma pendiente' : 'Solicitar la firma al representante legal'}
                        onClick={() => solicitarFirma(r, accion.documentId, [accion.personaId])}>
                        <LuSignature size={16} />
                    </button>
                )}
                {accion?.tipo === 'recordar_firmas' && accion.personaIds.length > 0 && (
                    <button type="button" className="rd-icono" disabled={subiendo !== null}
                        aria-label="Recordar a quienes no han firmado" title="Recordar a quienes no han firmado"
                        onClick={() => solicitarFirma(r, accion.documentId, accion.personaIds)}>
                        <LuSignature size={16} />
                    </button>
                )}
                {r.distribucion && r.estado !== 'Cumplido' && (
                    <button type="button" className="rd-icono" aria-label="Registrar envío" title="Registrar envío" onClick={() => setRemisionDe(r.id)}>
                        <LuSend size={16} />
                    </button>
                )}
                {r.modulo && rutaModulo(r.modulo) && r.estado !== 'Cumplido' && (
                    <button type="button" className="rd-icono" aria-label="Ir al módulo" title="Ir al módulo" onClick={() => navigate(rutaModulo(r.modulo as string) as string)}>
                        <LuArrowRight size={16} />
                    </button>
                )}
                {accion?.tipo === 'asignar_firmantes' && (
                    <button type="button" className="rd-icono" aria-label="Elegir quiénes firman" title="Elegir quiénes firman el documento cargado"
                        onClick={() => setCarga({ modo: 'firmantes', r, documentId: accion.documentId })}>
                        <LuUsers size={16} />
                    </button>
                )}
                {r.cargar && (
                    <button type="button" className="rd-icono"
                        aria-label={`Cargar ${r.cargar.que || 'documento'}`} title={`Cargar ${r.cargar.que || 'documento'}`}
                        onClick={() => setCarga({ modo: 'cargar', r })}>
                        <LuUpload size={16} />
                    </button>
                )}
            </span>
        );
    };

    const filaDoc = (d: DocRepo, r: RequisitoFuf) => {
        const f = conteoFirmas(d);
        // De quién falta la firma, por documento: el conteo solo no dice a quién pedirla.
        const sinFirmar = (d.asignaciones || []).filter((a) => !firmo(a)).map((a) => a.nombre || 'una persona sin nombre');
        const partes = [`v${d.version || 1}`, fecha(fechaDelDoc(d))];
        if (f.total > 0) partes.push(`${f.firmadas}/${f.total} firmas`);
        const aviso = vencido(d)
            ? { texto: 'Vencido', clase: 'vencido' }
            : f.total > 0 && f.firmadas < f.total
                ? { texto: 'Firmas pendientes', clase: 'firmas' }
                : ambito === 'obra' && !d.obraId ? { texto: 'De la empresa', clase: 'empresa' } : null;
        const sel = ficha?.documentId === d.documentId && ficha?.reqId === r.id;
        return (
            <div key={d.documentId} className={`rd-doc${sel ? ' rd-doc--sel' : ''}`}>
                <button type="button" className="rd-doc__abrir" onClick={() => abrirFicha(d, r)}>
                    <LuFileText size={18} aria-hidden="true" />
                    <span className="rd-doc__texto">
                        <span className="rd-doc__nombre">{d.titulo || d.archivoNombre}</span>
                        <span className="rd-doc__meta">{partes.join(' · ')}</span>
                        {sinFirmar.length > 0 && !vencido(d) && (
                            <span className="rd-doc__falta">Falta la firma de {listarNombres(sinFirmar)}.</span>
                        )}
                    </span>
                </button>
                {aviso && <span className={`rd-aviso rd-aviso--${aviso.clase}`}>{aviso.texto}</span>}
                <span className="rd-iconos">
                    <button type="button" className="rd-icono" aria-label="Ver archivo" title="Ver archivo" onClick={() => onVerDocumento(d)}><LuEye size={16} /></button>
                    <button type="button" className="rd-icono" aria-label="Descargar archivo" title="Descargar archivo" onClick={() => onDescargarDocumento(d)}><LuDownload size={16} /></button>
                    <button type="button" className="rd-icono" aria-label="Ver detalles" title="Ver detalles" onClick={() => abrirFicha(d, r)}><LuInfo size={16} /></button>
                </span>
            </div>
        );
    };

    const item = (r: RequisitoFuf) => {
        const docs = docsDe(r);
        const clave = r.id;
        const abierto = expandidos.has(clave) || Boolean(q);
        const visibles = abierto ? docs : docs.slice(0, LIMITE_DOCS);
        return (
            <div key={r.id} className="rd-item">
                <div className="rd-item__fila">
                    <span style={{ display: 'inline-flex', justifyContent: 'center' }}><IconoEstado estado={r.estado} /></span>
                    <span className="ob-fila__texto">
                        <span className="ob-fila__titulo">{r.titulo}</span>
                        <span className="ob-fila__meta">{codigoDe(r)}{(r.justificacion || r.detalle) ? ` · ${r.justificacion || r.detalle}` : ''}</span>
                        {r.estado !== 'Cumplido' && (r.accion?.falta || r.cargar?.que) && (
                            <span className="ob-fila__falta">Falta {r.accion?.falta || r.cargar?.que}.</span>
                        )}
                    </span>
                    <span className={`ob-etiqueta ob-etiqueta--${r.estado}`}>{etiquetaRequisito(r)}</span>
                    {accionesItem(r) || <span />}
                </div>
                {/* El ítem 1 es una fila del formulario pero cinco obligaciones (Art. 22). */}
                {r.subrequisitos && r.subrequisitos.length > 0 && (
                    <ul className="rd-subreq">
                        {r.subrequisitos.map((s) => (
                            <li key={s.clave}><span>{s.titulo}</span><span>{ETIQUETA_ESTADO[s.estado]}</span></li>
                        ))}
                    </ul>
                )}
                {docs.length > 0 && (
                    <div className="rd-docs">
                        {visibles.map((d) => filaDoc(d, r))}
                        {docs.length > LIMITE_DOCS && !q && (
                            <button type="button" className="rd-mas" onClick={() => setExpandidos((prev) => {
                                const s = new Set(prev);
                                if (s.has(clave)) s.delete(clave); else s.add(clave);
                                return s;
                            })}>
                                {abierto ? `Mostrar solo los ${LIMITE_DOCS} más recientes` : `Ver los ${docs.length} documentos`}
                            </button>
                        )}
                    </div>
                )}
            </div>
        );
    };

    const fichaDoc = () => {
        if (!docFicha) return null;
        const d = docFicha;
        const f = conteoFirmas(d);
        const firmasPorPersona = new Map<string, DocumentSignature>((d.firmas || []).map((x) => [idPersona(x), x]));
        const firmantes = (d.asignaciones || []).length > 0
            ? (d.asignaciones || []).map((a) => {
                const firma = firmasPorPersona.get(idPersona(a));
                return {
                    id: idPersona(a), nombre: a.nombre || firma?.nombre || 'Persona sin nombre', firmo: firmo(a),
                    rol: (a as { rol?: string }).rol === ROL_REPRESENTANTE ? 'Representante legal' : null,
                    detalle: firmo(a)
                        ? [fechaHora(firma?.timestamp || a.fechaFirma), firma?.tipoFirma].filter(Boolean).join(' · ')
                        : a.fechaLimite ? `Plazo: ${fecha(a.fechaLimite)}` : 'Sin firmar',
                };
            })
            : (d.firmas || []).map((x) => ({ id: idPersona(x), nombre: x.nombre, firmo: true, rol: null as string | null, detalle: [fechaHora(x.timestamp), x.tipoFirma].filter(Boolean).join(' · ') }));
        // Primero quien falta: es lo que se necesita para gestionar.
        firmantes.sort((a, b) => Number(a.firmo) - Number(b.firmo));
        // Un documento que firma el representante legal nunca "no requiere firma":
        // si todavía no tiene la asignación es porque falta designarlo.
        const deRepresentante = requiereFirmaRepresentante(d.tipo);
        const sinRepresentante = deRepresentante && f.total === 0;

        const difusiones = (d.difusiones || []).slice().sort((a, b) => String(b.fecha).localeCompare(String(a.fecha))).slice(0, 6)
            .flatMap((x) => (x.origen === 'manual'
                ? [{ a: DESTINATARIO_LABEL[x.destinatarioTipo || ''] || x.destinatarioTipo || 'Destinatario', f: fecha(x.fecha) }]
                : [
                    ...(x.totales?.mando ? [{ a: `Línea de mando (${x.totales.mando})`, f: fecha(x.fecha) }] : []),
                    ...(x.totales?.representantes ? [{ a: `Representantes (${x.totales.representantes})`, f: fecha(x.fecha) }] : []),
                    ...(x.totales?.firmantes ? [{ a: `Firmantes previos (${x.totales.firmantes})`, f: fecha(x.fecha) }] : []),
                ]));

        const pct = f.total ? Math.round((f.firmadas / f.total) * 100) : 0;
        const versiones = (d.versiones || []).slice().sort((a, b) => b.version - a.version);

        return (
            <aside className="rd-ficha" aria-label="Detalle del documento">
                <div className="rd-ficha__cabeza">
                    <span className="ob-rotulo">Documento</span>
                    <button type="button" className="rd-icono" style={{ border: 'none', background: 'none' }} aria-label="Cerrar el panel del documento" onClick={() => setFicha(null)}>
                        <LuX size={18} />
                    </button>
                </div>

                <div className="rd-ficha__bloque">
                    <span className="ob-rotulo">{d.tipoDescripcion || d.tipo}</span>
                    <h3 className="rd-ficha__titulo">{d.titulo}</h3>
                    {d.archivoNombre && <span className="rd-ficha__archivo">{d.archivoNombre}</span>}
                    <div className="rd-ficha__acciones">
                        <button type="button" className="ob-btn" onClick={() => onVerDocumento(d)}><LuEye size={15} /> Ver</button>
                        <button type="button" className="ob-btn" onClick={() => onDescargarDocumento(d)}><LuDownload size={15} /> Descargar</button>
                    </div>
                </div>

                <div className="rd-ficha__bloque" style={{ gap: 4 }}>
                    <span className="ob-rotulo" style={{ marginBottom: 6 }}>Detalles</span>
                    {reqFicha && <div className="rd-dato"><span>Acredita</span><span>{codigoDe(reqFicha)} · {reqFicha.titulo}</span></div>}
                    {reqFicha?.bloque && <div className="rd-dato"><span>Sección</span><span>{reqFicha.bloque}</span></div>}
                    <div className="rd-dato"><span>Fecha del hecho</span><span>{fecha(d.fecha || d.createdAt)}</span></div>
                    <div className={`rd-dato${vencido(d) ? ' rd-dato--alerta' : ''}`}>
                        <span>Vigencia</span>
                        <span>{d.fechaCaducidad ? `${vencido(d) ? 'Venció el' : 'Hasta el'} ${fecha(d.fechaCaducidad)}` : 'Sin caducidad'}</span>
                    </div>
                    <div className="rd-dato"><span>Versión</span><span>v{d.version || 1}</span></div>
                    <div className="rd-dato"><span>Subido</span><span>{fecha(d.createdAt)}{d.creatorName ? ` por ${d.creatorName}` : ''}</span></div>
                    {d.ultimaPublicacionNombre && (
                        <div className="rd-dato"><span>Última versión</span><span>{fecha(d.updatedAt)} por {d.ultimaPublicacionNombre}</span></div>
                    )}
                    <div className="rd-dato"><span>Ámbito</span><span>{d.obraId ? 'Esta obra' : 'Empresa'}</span></div>
                </div>

                <div className="rd-ficha__bloque">
                    <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                        <span className="ob-rotulo">Firmas</span>
                        <span style={{ fontSize: '0.8125rem', fontWeight: 500 }}>
                            {f.total > 0 ? `${f.firmadas} de ${f.total}` : sinRepresentante ? 'Pendiente' : 'No requiere firma'}
                        </span>
                    </span>
                    {deRepresentante && (
                        <span style={{ fontSize: '0.75rem', color: sinRepresentante ? 'var(--ob-par)' : 'var(--text-secondary)', fontWeight: sinRepresentante ? 500 : 400 }}>
                            {sinRepresentante
                                ? 'Requiere la firma del representante legal, y la empresa no tiene uno designado. Al designarlo en Mi Empresa → Identidad se le pide la firma.'
                                : 'Lo aprueba el representante legal con su firma (Art. 8).'}
                        </span>
                    )}
                    {sinRepresentante && (
                        <button type="button" className="ob-btn" onClick={() => navigate('/mi-empresa')}>
                            <LuUserCheck size={15} /> Designar representante legal
                        </button>
                    )}
                    {f.total > 0 && (
                        <>
                            <span className={`ob-barra${pct === 100 ? ' ob-barra--completa' : ''}`}>
                                <span style={{ width: `${pct}%`, background: pct === 100 ? undefined : 'var(--ob-par-fill)' }} />
                            </span>
                            <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                                {f.firmadas === f.total ? 'Todas las personas asignadas firmaron.' : `${f.total - f.firmadas} persona(s) todavía no firman.`}
                            </span>
                            <button type="button" className="ob-btn" aria-expanded={verFirmantes} onClick={() => setVerFirmantes((v) => !v)}>
                                <LuUsers size={15} /> {verFirmantes ? 'Ocultar firmantes' : 'Ver quién firmó'}
                            </button>
                            {verFirmantes && (
                                <div className="rd-firmantes">
                                    {firmantes.map((p) => (
                                        <div key={p.id} className={`rd-firmante${p.firmo ? ' rd-firmante--firmo' : ''}`}>
                                            <span className="rd-firmante__avatar">{iniciales(p.nombre)}</span>
                                            <span className="rd-firmante__texto">
                                                <span className="rd-firmante__nombre">{p.nombre}</span>
                                                {(p.rol || p.firmo) && (
                                                    <span className="rd-firmante__sub">{[p.rol, p.firmo ? p.detalle : null].filter(Boolean).join(' · ')}</span>
                                                )}
                                            </span>
                                            {!p.firmo && <span className="ob-etiqueta ob-etiqueta--Pendiente">Pendiente</span>}
                                        </div>
                                    ))}
                                </div>
                            )}
                        </>
                    )}
                </div>

                {difusiones.length > 0 && (
                    <div className="rd-ficha__bloque" style={{ gap: 8 }}>
                        <span className="ob-rotulo">Difusión</span>
                        {difusiones.map((x, i) => (
                            <div key={`${x.a}-${i}`} className="rd-fila-simple"><span>{x.a}</span><span>{x.f}</span></div>
                        ))}
                    </div>
                )}

                <div className="rd-ficha__bloque">
                    <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                        <span className="ob-rotulo">Versiones</span>
                        {esVersionable(d.tipo) && (
                            <button type="button" className="ob-btn" onClick={() => setVersionDe(d)}>
                                <LuFilePen size={15} /> Nueva versión
                            </button>
                        )}
                    </span>
                    <div className="rd-version rd-version--actual">
                        <span className="rd-version__n">v{d.version || 1}</span>
                        <span className="rd-version__texto">
                            <span>{d.ultimoMotivoVersion || 'Versión vigente'}</span>
                            <span>{fecha(d.updatedAt || d.createdAt)}</span>
                        </span>
                        <button type="button" className="rd-icono" style={{ border: 'none', background: 'none' }} aria-label={`Descargar versión ${d.version || 1}`} onClick={() => onDescargarDocumento(d)}>
                            <LuDownload size={15} />
                        </button>
                    </div>
                    {versiones.map((v) => (
                        <div key={v.version} className="rd-version">
                            <span className="rd-version__n">v{v.version}</span>
                            <span className="rd-version__texto">
                                <span>{v.motivo || 'Sin motivo registrado'}</span>
                                <span>{[v.publicadaPorNombre, fecha(v.publicadaEn)].filter(Boolean).join(' · ')}</span>
                            </span>
                            <button type="button" className="rd-icono" style={{ border: 'none', background: 'none' }} disabled={!v.s3Key}
                                aria-label={`Descargar versión ${v.version}`} onClick={() => descargarVersion(v.s3Key)}>
                                <LuDownload size={15} />
                            </button>
                        </div>
                    ))}
                </div>
            </aside>
        );
    };

    const resumen = data.resumen;

    return (
        <div>
            <div className="rd-barra">
                <div className="rd-avance">
                    <span className="rd-avance__texto"><span>{resumen.cumplidos} de {resumen.exigibles} completados</span><strong>{resumen.progreso}%</strong></span>
                    <span className={`ob-barra${resumen.progreso === 100 ? ' ob-barra--completa' : ''}`}><span style={{ width: `${resumen.progreso}%` }} /></span>
                </div>
                <div style={{ flexGrow: 1 }} />
                <button type="button" className="ob-btn" disabled={exportando} onClick={exportar} title="Abre el reporte imprimible del FUF en una pestaña nueva">
                    <LuDownload size={15} /> {exportando ? 'Generando…' : 'Exportar FUF'}
                </button>
            </div>

            <div className={`rd-marco${docFicha ? ' rd-marco--con-ficha' : ''}`}>
                <nav className="rd-secciones" aria-label="Secciones del FUF">
                    <label className="rd-buscar">
                        <LuSearch size={15} aria-hidden="true" />
                        <input type="search" placeholder="Buscar documento o ítem" aria-label="Buscar documento o ítem"
                            value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
                    </label>
                    {secciones.map((s) => (
                        <button key={s.numero} type="button"
                            className={`rd-seccion${s.requisitos.length === 0 ? ' rd-seccion--vacia' : ''}`}
                            aria-current={!q && s.numero === seccionActual}
                            onClick={() => { setSeccion(s.numero); setFiltro('todos'); setBusqueda(''); }}>
                            <span className="rd-seccion__num">{s.numero}</span>
                            <span className="rd-seccion__cuerpo">
                                <span className="rd-seccion__nombre">{s.nombre}</span>
                                {s.requisitos.length > 0 ? (
                                    <span className="rd-seccion__avance">
                                        <span className={`ob-barra${s.progreso === 100 ? ' ob-barra--completa' : ''}`}><span style={{ width: `${s.progreso}%` }} /></span>
                                        <span className="rd-seccion__cuenta">{s.cumplidos} de {s.exigibles}</span>
                                    </span>
                                ) : (
                                    <span className="rd-seccion__vacia">Sin requisitos en este ámbito</span>
                                )}
                            </span>
                            {s.hayVencido && <span className="rd-seccion__alerta" title="Tiene requisitos vencidos" />}
                        </button>
                    ))}
                </nav>

                <section className="rd-lista-panel" aria-label={q ? 'Resultados de la búsqueda' : sec?.nombre}>
                    <div className="rd-encabezado">
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                            <span className="ob-rotulo">{q ? 'Búsqueda' : `Sección ${seccionActual}`}</span>
                            <h2 className="ob-h2">{q ? `Resultados para “${busqueda.trim()}”` : sec?.nombre}</h2>
                        </div>
                        <div className="ob-filtros" role="group" aria-label="Filtrar por estado">
                            {FILTROS.map((f) => (
                                <button key={f.key} type="button" className="ob-filtro" aria-pressed={filtro === f.key} onClick={() => setFiltro(f.key)}>
                                    {f.label}<span className="ob-filtro__n">{conteo(f.key)}</span>
                                </button>
                            ))}
                        </div>
                    </div>
                    <div className="ob-lista">
                        {requisitos.length > 0
                            ? requisitos.map(item)
                            : (
                                <div className="ob-lista__vacia">
                                    {q ? 'Ningún ítem ni documento coincide con la búsqueda.'
                                        : (sec?.requisitos.length || 0) === 0 ? 'Esta sección no tiene requisitos exigibles en este ámbito.'
                                            : 'No hay requisitos con este estado en la sección.'}
                                </div>
                            )}
                    </div>
                </section>

                {fichaDoc()}
            </div>

            {carga && (
                <CargaEvidencia
                    modo={carga.modo}
                    tenantId={tenantId}
                    obraId={ambito === 'obra' ? obraId : null}
                    titulo={carga.r.titulo}
                    que={carga.modo === 'cargar' ? carga.r.cargar?.que : carga.r.accion?.falta}
                    tipo={carga.r.cargar?.tipo}
                    documentId={carga.documentId}
                    personas={personas}
                    onCerrar={() => setCarga(null)}
                    onListo={() => cargar(true)}
                />
            )}

            {versionDe && (
                <NuevaVersion
                    tenantId={tenantId}
                    obraId={ambito === 'obra' ? obraId : null}
                    documento={versionDe}
                    onCerrar={() => setVersionDe(null)}
                    onListo={() => cargar(true)}
                />
            )}

            {reqRemision?.distribucion && (
                <Drawer isOpen onClose={() => setRemisionDe(null)} title="Constancias de envío"
                    subtitle={`FUF ${reqRemision.item} · ${reqRemision.distribucion.titulo || reqRemision.titulo}`} width={560}>
                    <DistribucionPanel distribucion={reqRemision.distribucion} tenantId={tenantId} obraId={obraId} onCambio={() => cargar(true)} />
                </Drawer>
            )}
        </div>
    );
}
