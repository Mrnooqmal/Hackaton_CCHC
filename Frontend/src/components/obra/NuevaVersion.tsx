import { useEffect, useMemo, useRef, useState } from 'react';
import { LuPaperclip, LuSearch, LuUpload } from 'react-icons/lu';
import { Drawer } from '../ui';
import { documentsApi, type Document, type DocumentAssignment, type EntidadRevision } from '../../api/documents.api';
import { uploadsApi } from '../../api/uploads.api';
import { workersApi, type Worker } from '../../api/workers.api';
import { useAuth } from '../../context/AuthContext';
import { publicarNuevaVersion, ENTIDADES_REVISION } from '../../utils/versionarDocumento';
import { caducidadPorDefecto } from '../../utils/vigenciaDocumento';
import { hoyISO } from '../../utils/seguimientoActividad';

export interface NuevaVersionProps {
    tenantId: string;
    obraId?: string | null;
    /** Documento vigente que se revisa. Debe ser de un tipo versionable. */
    documento: Document;
    onCerrar: () => void;
    onListo: () => void | Promise<void>;
}

// El mismo tope que aplica el backend (handlers/uploads).
const MAX_BYTES = 10 * 1024 * 1024;

const nombreDe = (p: { nombre?: string; apellido?: string }) => `${p.nombre || ''} ${p.apellido || ''}`.trim() || 'Persona sin nombre';
const idDe = (x: { personaId?: string; workerId?: string }) => x.personaId || x.workerId || '';
const firmo = (a: DocumentAssignment) => a.estado === 'firmado' || Boolean(a.fechaFirma);
const fechaHora = (iso?: string | null) =>
    iso ? new Date(iso).toLocaleString('es-CL', { timeZone: 'America/Santiago', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';

/**
 * Publicación de una versión nueva de un documento versionable (MIPER,
 * Reglamento Interno, procedimientos).
 *
 * Es lo que renueva la revisión anual de los ítems 6 y 51: el motor mide la
 * antigüedad desde la última versión y, en el 51, exige los órganos que
 * participaron. La versión anterior queda en el historial y se avisa a la línea
 * de mando.
 *
 * Los firmantes se revisan acá, en el mismo paso: se ve quién firmó la versión
 * vigente y quién no, y se decide quién firma la nueva. Por defecto son los
 * mismos; se puede quitar a alguien (lo que firmó queda en el historial) o
 * agregar a cualquier persona de la empresa, no solo a las de la obra.
 */
export default function NuevaVersion({ tenantId, obraId = null, documento, onCerrar, onListo }: NuevaVersionProps) {
    const { user } = useAuth();
    const inputArchivo = useRef<HTMLInputElement | null>(null);
    // El listado puede venir sin `versiones` ni la versión al día: se relee el
    // documento para que `versionEsperada` calce y el backend no responda 409.
    const [doc, setDoc] = useState<Document>(documento);
    const [archivo, setArchivo] = useState<File | null>(null);
    const [motivo, setMotivo] = useState('');
    const [fechaRevision, setFechaRevision] = useState(hoyISO());
    const [participantes, setParticipantes] = useState<EntidadRevision[]>([]);
    const [detalle, setDetalle] = useState('');
    const [conCaducidad, setConCaducidad] = useState(true);
    const [caducidad, setCaducidad] = useState(caducidadPorDefecto());
    const [guardando, setGuardando] = useState(false);
    const [error, setError] = useState<string | null>(null);
    // Quiénes firman la versión nueva. Arranca con los de la vigente.
    const [firmantes, setFirmantes] = useState<Set<string>>(
        () => new Set((documento.asignaciones || []).map(idDe).filter(Boolean)));
    const [personas, setPersonas] = useState<Worker[]>([]);
    const [buscar, setBuscar] = useState('');
    const [soloObra, setSoloObra] = useState(Boolean(obraId));

    useEffect(() => {
        let vivo = true;
        documentsApi.get(documento.documentId)
            .then((res) => {
                if (!vivo || !res.success || !res.data) return;
                setDoc(res.data);
                // Los del documento releído mandan: el listado podía venir atrasado.
                setFirmantes(new Set((res.data.asignaciones || []).map(idDe).filter(Boolean)));
            })
            .catch(() => undefined);
        // Toda la empresa: quien firma puede no estar asignado a la obra (el
        // prevencionista de la empresa, un jefe de obra de otra faena).
        workersApi.list()
            .then((res) => {
                if (vivo && res.success && Array.isArray(res.data)) setPersonas((res.data as Worker[]).filter((p: Worker) => p.estado !== 'inactivo'));
            })
            .catch(() => undefined);
        return () => { vivo = false; };
    }, [documento.documentId]);

    const version = doc.version || 1;
    const asignaciones = useMemo(() => doc.asignaciones || [], [doc.asignaciones]);

    // Los firmantes de la vigente, con su firma si la hay: primero quien falta.
    const anteriores = useMemo(() => {
        const firmas = new Map((doc.firmas || []).map((f) => [idDe(f), f]));
        return asignaciones
            .map((a) => {
                const firma = firmas.get(idDe(a));
                return {
                    id: idDe(a), nombre: a.nombre || firma?.nombre || 'Persona sin nombre', firmo: firmo(a),
                    detalle: firmo(a)
                        ? `Firmó la v${version} el ${[fechaHora(firma?.timestamp || a.fechaFirma), firma?.tipoFirma].filter(Boolean).join(' · ')}`
                        : `No ha firmado la v${version}`,
                };
            })
            .filter((a) => a.id)
            .sort((a, b) => Number(a.firmo) - Number(b.firmo));
    }, [asignaciones, doc.firmas, version]);

    const idsAnteriores = useMemo(() => new Set(anteriores.map((a) => a.id)), [anteriores]);
    const candidatos = useMemo(() => {
        const q = buscar.trim().toLowerCase();
        return personas
            .filter((p) => !idsAnteriores.has(p.personaId))
            .filter((p) => !soloObra || !obraId || (p.obraIds || []).includes(obraId))
            .filter((p) => !q || `${nombreDe(p)} ${p.cargo || ''}`.toLowerCase().includes(q))
            .sort((a, b) => nombreDe(a).localeCompare(nombreDe(b)));
    }, [personas, idsAnteriores, soloObra, obraId, buscar]);
    const agregados = [...firmantes].filter((id) => !idsAnteriores.has(id)).length;
    const quitados = anteriores.filter((a) => !firmantes.has(a.id)).length;

    const alternarFirmante = (id: string) => setFirmantes((prev) => {
        const s = new Set(prev);
        if (s.has(id)) s.delete(id); else s.add(id);
        return s;
    });

    const elegir = (f: File | null | undefined) => {
        if (!f) return;
        if (f.size > MAX_BYTES) { setError('El archivo pesa más de 10 MB.'); return; }
        setError(null);
        setArchivo(f);
    };

    const alternar = (id: EntidadRevision) => setParticipantes((prev) =>
        (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

    const publicar = async () => {
        setError(null);
        if (!archivo) { setError('Selecciona el archivo de la nueva versión.'); return; }
        if (!motivo.trim()) { setError('Indica el motivo de la revisión.'); return; }
        setGuardando(true);
        try {
            const subida = await uploadsApi.uploadFile(archivo, 'documentos', tenantId, tenantId);
            if (!subida.success || !subida.data) throw new Error(subida.error || 'No se pudo subir el archivo.');

            const fechaLimite = conCaducidad ? caducidad : null;
            const r = await publicarNuevaVersion({
                documentId: doc.documentId,
                versionActual: version,
                s3Key: subida.data.url,
                archivoNombre: archivo.name,
                motivo,
                participantesRevision: participantes.length
                    ? { entidades: participantes, detalle: detalle.trim() || undefined, fechaRevision }
                    : undefined,
                titulo: doc.titulo,
                asignaciones,
                firmantes: [...firmantes],
                autorId: user?.personaId,
                autorNombre: user ? `${user.nombre} ${user.apellido || ''}`.trim() : undefined,
                tenantId,
                obraId: obraId || undefined,
                fechaLimite,
                tamanoArchivo: archivo.size,
            });
            if (!r.ok) throw new Error(r.error || 'No se pudo publicar la nueva versión.');

            // La vigencia de la versión nueva corre desde hoy, no desde la anterior.
            await documentsApi.update(doc.documentId, { fechaCaducidad: fechaLimite } as Partial<Document>);
            await onListo();
            onCerrar();
        } catch (e) {
            setError(e instanceof Error ? e.message : 'No se pudo publicar la nueva versión.');
        } finally {
            setGuardando(false);
        }
    };

    return (
        <Drawer
            isOpen
            onClose={guardando ? () => undefined : onCerrar}
            title="Publicar nueva versión"
            subtitle={doc.titulo}
            width={520}
            footer={(
                <>
                    <button type="button" className="btn btn-ghost" onClick={onCerrar} disabled={guardando}>Cancelar</button>
                    <button type="button" className="btn btn-primary" onClick={publicar} disabled={guardando}>
                        {guardando ? 'Publicando…' : `Publicar v${version + 1}`}
                    </button>
                </>
            )}
        >
            <div className="ce">
                <p className="dp-nota" style={{ margin: 0 }}>
                    Versión vigente: <strong>v{version}</strong>. La v{version + 1} la reemplaza, la anterior queda en el
                    historial con sus firmas y se avisa a la línea de mando.
                </p>

                <section className="dp-bloque" aria-label="Archivo">
                    <span className="ob-rotulo">Archivo de la nueva versión</span>
                    <input
                        ref={inputArchivo} type="file" accept="application/pdf,image/*" style={{ display: 'none' }}
                        onChange={(e) => { elegir(e.target.files?.[0]); e.target.value = ''; }}
                    />
                    {archivo ? (
                        <div className="ce-archivo">
                            <LuPaperclip size={16} aria-hidden="true" />
                            <span className="ce-archivo__texto">
                                <span className="ce-archivo__nombre">{archivo.name}</span>
                                <span className="ce-archivo__peso">{(archivo.size / 1024 / 1024).toFixed(2)} MB</span>
                            </span>
                            <button type="button" className="ob-btn" onClick={() => inputArchivo.current?.click()}>Cambiar</button>
                        </div>
                    ) : (
                        <button type="button" className="ce-zona" onClick={() => inputArchivo.current?.click()}>
                            <LuUpload size={22} aria-hidden="true" />
                            <span className="ce-zona__titulo">Selecciona el archivo</span>
                            <span className="ce-zona__nota">PDF o imagen, hasta 10 MB</span>
                        </button>
                    )}
                </section>

                <section className="dp-bloque" aria-label="Revisión">
                    <span className="ob-rotulo">Revisión</span>
                    <label className="dp-campo dp-campo--ancho">
                        <span className="form-label">Motivo *</span>
                        <textarea className="form-input" rows={2} maxLength={300} value={motivo}
                            placeholder="Ej: revisión anual, o se incorporó el riesgo de sílice tras el cambio de faena"
                            onChange={(e) => setMotivo(e.target.value)} />
                    </label>
                    <div className="dp-campos">
                        <label className="dp-campo dp-campo--fecha">
                            <span className="form-label">Fecha de la revisión</span>
                            <input type="date" className="form-input" max={hoyISO()} value={fechaRevision}
                                onChange={(e) => setFechaRevision(e.target.value)} />
                        </label>
                        <div className="dp-campo dp-campo--fecha">
                            <label className="ce-check">
                                <input type="checkbox" checked={conCaducidad} onChange={(e) => setConCaducidad(e.target.checked)} />
                                <span className="form-label" style={{ margin: 0 }}>Caduca el</span>
                            </label>
                            <input type="date" className="form-input" min={fechaRevision} value={caducidad} disabled={!conCaducidad}
                                onChange={(e) => setCaducidad(e.target.value)} aria-label="Fecha de caducidad" />
                        </div>
                    </div>
                </section>

                <section className="dp-bloque" aria-label="Participantes de la revisión">
                    <span className="ob-rotulo">Participantes de la revisión</span>
                    <p className="dp-nota" style={{ margin: 0 }}>
                        Quiénes participaron (Art. 57 inc. 5). Para el Reglamento Interno, sin participantes la revisión queda incompleta (FUF 51).
                    </p>
                    <div className="ce-firmantes" role="group" aria-label="Participantes de la revisión">
                        {ENTIDADES_REVISION.map((ent) => (
                            <label key={ent.id} className="ce-firmante">
                                <input type="checkbox" checked={participantes.includes(ent.id)} onChange={() => alternar(ent.id)} />
                                <span>{ent.label}</span>
                            </label>
                        ))}
                    </div>
                    <textarea className="form-input" rows={2} maxLength={300} value={detalle}
                        placeholder="Nombres de los participantes o referencia al acta de la reunión (opcional)"
                        onChange={(e) => setDetalle(e.target.value)} />
                </section>

                <section className="dp-bloque" aria-label="Firmantes">
                    <span className="ce-firmantes__cabeza">
                        <span className="ob-rotulo">Firmantes</span>
                        <span className="dp-nota">
                            {firmantes.size} firmarán la v{version + 1}
                            {(agregados > 0 || quitados > 0) && ` (${[agregados && `${agregados} agregada(s)`, quitados && `${quitados} quitada(s)`].filter(Boolean).join(', ')})`}
                        </span>
                    </span>

                    <span className="form-label" style={{ margin: 0 }}>Firmantes de la v{version}</span>
                    {anteriores.length === 0 ? (
                        <p className="dp-nota" style={{ margin: 0 }}>La versión vigente no tiene firmantes asignados.</p>
                    ) : (
                        <div className="ce-firmantes" role="group" aria-label={`Firmantes de la v${version}`}>
                            {anteriores.map((a) => (
                                <label key={a.id} className="ce-firmante">
                                    <input type="checkbox" checked={firmantes.has(a.id)} onChange={() => alternarFirmante(a.id)}
                                        aria-label={`${a.nombre} firma la v${version + 1}`} />
                                    <span className="ce-firmante__texto">
                                        <span style={firmantes.has(a.id) ? undefined : { textDecoration: 'line-through', color: 'var(--text-muted)' }}>{a.nombre}</span>
                                        <span className="ce-firmante__cargo">{a.detalle}</span>
                                    </span>
                                    <span className={`ob-etiqueta ob-etiqueta--${a.firmo ? 'Cumplido' : 'Pendiente'}`} style={{ marginLeft: 'auto' }}>
                                        {a.firmo ? 'Firmó' : 'Pendiente'}
                                    </span>
                                </label>
                            ))}
                        </div>
                    )}
                    <p className="dp-nota" style={{ margin: 0 }}>
                        Desmarca a quien no debe firmar la versión nueva. Lo que firmó de la v{version} queda en el historial.
                    </p>

                    <span className="ce-firmantes__cabeza" style={{ marginTop: 6 }}>
                        <span className="form-label" style={{ margin: 0 }}>Agregar firmantes</span>
                        {obraId && (
                            <label className="ce-check">
                                <input type="checkbox" checked={soloObra} onChange={(e) => setSoloObra(e.target.checked)} />
                                <span className="dp-nota">Solo personas de esta obra</span>
                            </label>
                        )}
                    </span>
                    <label className="rd-buscar" style={{ margin: 0 }}>
                        <LuSearch size={14} aria-hidden="true" />
                        <input type="search" placeholder="Buscar por nombre o cargo" aria-label="Buscar persona"
                            value={buscar} onChange={(e) => setBuscar(e.target.value)} />
                    </label>
                    <div className="ce-firmantes ce-firmantes--acotada" role="group" aria-label="Agregar firmantes">
                        {candidatos.map((p) => (
                            <label key={p.personaId} className="ce-firmante">
                                <input type="checkbox" checked={firmantes.has(p.personaId)} onChange={() => alternarFirmante(p.personaId)} />
                                <span className="ce-firmante__texto">
                                    <span>{nombreDe(p)}</span>
                                    {p.cargo && <span className="ce-firmante__cargo">{p.cargo}</span>}
                                </span>
                            </label>
                        ))}
                        {candidatos.length === 0 && (
                            <p className="dp-nota" style={{ padding: '12px' }}>
                                {buscar ? 'Nadie coincide con la búsqueda.' : soloObra && obraId ? 'No hay más personas en esta obra. Desmarca el filtro para ver toda la empresa.' : 'No hay más personas en la empresa.'}
                            </p>
                        )}
                    </div>
                    <p className="dp-nota" style={{ margin: 0 }}>Cada firmante recibe la v{version + 1} en "Mis firmas" y la firma con su PIN.</p>
                </section>

                {error && <div className="ds44-alert ds44-alert-danger" style={{ fontSize: '0.85rem' }}>{error}</div>}
            </div>
        </Drawer>
    );
}
