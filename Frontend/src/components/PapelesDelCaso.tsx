import { useEffect, useMemo, useRef, useState } from 'react';
import { FiCheckCircle, FiCircle, FiDownload, FiLock, FiUploadCloud } from 'react-icons/fi';
import { incidentsApi, type Incident, type PapelDelCaso } from '../api/client';
import { useToast } from '../context/ToastContext';
import { Select, Badge, LoadingSpinner } from './ui';
import { fechaLocal } from '../utils/prescripciones';
import {
    ORDEN_TIPOS_PAPEL, TIPOS_PAPEL, MIME_PAPELES, MAX_BYTES_PAPEL, MAX_PAPELES_POR_CASO,
    avanceDelCaso, papelesRequeridos, etiquetaTipoPapel, type TipoPapel,
} from '../utils/casos';
import { plural } from '../utils/plural';

const MB = 1024 * 1024;

const tamanoLegible = (bytes: number) => (bytes >= MB ? `${(bytes / MB).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

/** AAAA-MM-DD sin zona: con `new Date('2026-11-15')` se leería como UTC y en Chile mostraría el día anterior. */
const fechaCorta = (aaaammdd: string) => {
    const [a, m, d] = aaaammdd.split('-').map(Number);
    return a && m && d ? new Date(a, m - 1, d).toLocaleDateString('es-CL', { day: 'numeric', month: 'short', year: 'numeric' }) : aaaammdd;
};

interface Props {
    incidente: Incident;
    /**
     * `incidentes.reportar`: quien gestiona incidentes puede subir papeles. También en un caso
     * cerrado: completar el respaldo documental de un caso cerrado (por ejemplo, el informe de
     * investigación de un accidente anterior al rediseño) es justo lo que pide el repositorio.
     */
    puedeSubir: boolean;
    /** Se llama después de subir un papel: lo que sigue en el caso puede haber cambiado. */
    onCambio?: () => void;
}

/**
 * "Papeles del caso" (fase 2 del rediseño): los papeles que el tipo de caso
 * exige y cuáles faltan, el avance, y los archivos subidos con su descarga.
 *
 * La plataforma es un repositorio: guarda la DIAT y la DIEP como archivos y no
 * las envía a nadie ni lee su contenido. Esta sección solo se monta para quien
 * tiene `incidentes.historial` (el padre decide): el trabajador que ve su propio
 * reporte no la recibe, y el servidor también se lo niega.
 *
 * Las reglas de qué se exige vienen de `utils/casos`, espejo de `lib/casos.js`.
 */
export default function PapelesDelCaso({ incidente, puedeSubir, onCambio }: Props) {
    const { toast } = useToast();
    const id = incidente.incidentId;

    // Lo cargado queda junto al id y a la recarga que se pidió (como en el detalle).
    const [recarga, setRecarga] = useState(0);
    const [cargado, setCargado] = useState<{ clave: string; archivos: PapelDelCaso[]; error: string } | null>(null);
    const clave = `${id}:${recarga}`;

    const [tipo, setTipo] = useState<TipoPapel | ''>('');
    const [archivo, setArchivo] = useState<File | null>(null);
    const [fechaDocumento, setFechaDocumento] = useState('');
    const [subiendo, setSubiendo] = useState(false);
    const [errorSubida, setErrorSubida] = useState('');
    const inputArchivo = useRef<HTMLInputElement>(null);

    useEffect(() => {
        let cancelado = false;
        incidentsApi.getDocuments(id).then((res) => {
            if (cancelado) return;
            if (res.success && res.data) setCargado({ clave, archivos: res.data.archivos, error: '' });
            else setCargado({ clave, archivos: [], error: res.error || 'No se pudieron cargar los papeles del caso.' });
        }).catch(() => {
            if (!cancelado) setCargado({ clave, archivos: [], error: 'Error de conexión al cargar los papeles del caso.' });
        });
        return () => { cancelado = true; };
    }, [id, clave]);

    const actual = cargado && cargado.clave === clave ? cargado : null;
    const archivos = useMemo(() => actual?.archivos ?? [], [actual]);

    // Lo exigido se calcula con las mismas reglas que el servidor, sobre el
    // incidente y los archivos que acaban de llegar.
    const requeridos = useMemo(() => papelesRequeridos({ ...incidente, papeles: archivos }), [incidente, archivos]);
    const avance = useMemo(() => avanceDelCaso({ ...incidente, papeles: archivos }), [incidente, archivos]);

    const subir = async (e: React.FormEvent) => {
        e.preventDefault();
        if (subiendo) return;
        if (!tipo) { setErrorSubida('Elige qué papel vas a subir.'); return; }
        if (!archivo) { setErrorSubida('Elige el archivo.'); return; }
        if (!MIME_PAPELES.includes(archivo.type)) { setErrorSubida('Solo se aceptan archivos PDF o imágenes (JPG, PNG o WebP).'); return; }
        if (archivo.size > MAX_BYTES_PAPEL) { setErrorSubida(`El archivo debe pesar hasta ${MAX_BYTES_PAPEL / MB} MB.`); return; }
        if (archivos.length >= MAX_PAPELES_POR_CASO) { setErrorSubida(`El caso admite hasta ${MAX_PAPELES_POR_CASO} archivos.`); return; }
        setErrorSubida('');
        setSubiendo(true);
        try {
            // 1. URL de subida. El servidor todavía no registra nada.
            const url = await incidentsApi.pedirSubidaPapel(id, { archivo, tipo });
            if (!url.success || !url.data) { setErrorSubida(url.error || 'No se pudo preparar la subida.'); return; }
            // 2. El archivo va directo a S3. `fetch` no lanza con un 4xx/5xx: se mira `ok`.
            const subida = await fetch(url.data.uploadUrl, { method: 'PUT', body: archivo, headers: url.data.uploadHeaders });
            if (!subida.ok) { setErrorSubida('No se pudo subir el archivo. Intenta de nuevo.'); return; }
            // 3. Confirmar: el servidor comprueba que llegó y recién ahí lo registra.
            const confirmado = await incidentsApi.confirmarPapel(id, {
                s3Key: url.data.s3Key,
                fileName: archivo.name,
                ...(fechaDocumento ? { fechaDocumento } : {}),
            });
            if (!confirmado.success) { setErrorSubida(confirmado.error || 'El archivo se subió, pero no se pudo registrar. Intenta de nuevo.'); return; }
            toast.success('Papel agregado al caso');
            setArchivo(null);
            setFechaDocumento('');
            if (inputArchivo.current) inputArchivo.current.value = '';
            setRecarga((n) => n + 1);
            onCambio?.();
        } catch {
            setErrorSubida('Error de conexión al subir el archivo. Intenta de nuevo.');
        } finally {
            setSubiendo(false);
        }
    };

    return (
        <section className="inc-ficha-card" aria-label="Papeles del caso">
            <div>
                <h2 className="inc-papeles-titulo">Papeles del caso</h2>
                <p className="inc-ficha-texto inc-papeles-ayuda">
                    Acá se guardan los documentos de este caso. La plataforma no envía la DIAT ni la DIEP a nadie: se adjuntan como archivo.
                </p>
            </div>

            {actual === null ? (
                <LoadingSpinner label="Cargando papeles…" />
            ) : actual.error ? (
                <div className="alert alert-danger"><div>{actual.error}</div></div>
            ) : (
                <>
                    <div>
                        <div className="inc-ficha-label">
                            {avance.total === 0
                                ? 'Este caso no exige papeles'
                                : `Lo que exige este caso · ${avance.cumplidos} de ${plural(avance.total, 'papel', 'papeles')}`}
                        </div>
                        {avance.total > 0 && (
                            <div className="inc-papeles-barra" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={avance.porcentaje} aria-label="Avance de los papeles del caso">
                                <span style={{ width: `${avance.porcentaje}%` }} />
                            </div>
                        )}
                        <ul className="inc-papeles-lista">
                            {requeridos.map((r) => (
                                <li key={r.clave} className="inc-papeles-fila">
                                    <span className={r.cumplido ? 'inc-papeles-ok' : 'inc-papeles-falta'}>
                                        {r.cumplido ? <FiCheckCircle size={16} /> : <FiCircle size={16} />}
                                    </span>
                                    <span className="inc-papeles-nombre">{r.etiqueta}</span>
                                    <Badge variant={r.cumplido ? 'success' : 'warning'} size="sm">{r.cumplido ? 'Cumplido' : 'Falta'}</Badge>
                                    {puedeSubir && !r.cumplido && r.tipoDocumento && (
                                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setTipo(r.tipoDocumento as TipoPapel)}>
                                            Subir
                                        </button>
                                    )}
                                </li>
                            ))}
                        </ul>
                    </div>

                    <div>
                        <div className="inc-ficha-label">
                            Archivos subidos{archivos.length > 0 ? ` · ${plural(archivos.length, 'archivo', 'archivos')}` : ''}
                        </div>
                        {archivos.length === 0 ? (
                            <p className="inc-ficha-texto inc-ficha-vacio">Todavía no se subió ningún archivo.</p>
                        ) : (
                            <ul className="inc-papeles-lista">
                                {archivos.map((p) => (
                                    <li key={p.papelId} className="inc-papeles-fila">
                                        <div className="inc-papeles-nombre">
                                            <div>{etiquetaTipoPapel(p.tipo)}</div>
                                            <div className="inc-papeles-meta">
                                                {p.nombreArchivo || 'Sin nombre'}{p.tamano ? ` · ${tamanoLegible(p.tamano)}` : ''}
                                                {p.fechaDocumento ? ` · documento del ${fechaCorta(p.fechaDocumento)}` : ''}
                                                {p.subidoEn ? ` · subido el ${new Date(p.subidoEn).toLocaleDateString('es-CL')}` : ''}
                                            </div>
                                        </div>
                                        {p.contieneSalud && (
                                            <span title="Contiene datos de salud: quién lo descarga queda registrado">
                                                <Badge variant="info" size="sm"><FiLock size={11} /> Datos de salud</Badge>
                                            </span>
                                        )}
                                        <a href={p.url} target="_blank" rel="noopener noreferrer" className="btn btn-secondary btn-sm">
                                            <FiDownload size={14} /> Descargar
                                        </a>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>

                    {puedeSubir && (
                        <form className="inc-papeles-form" onSubmit={subir}>
                            <div className="inc-ficha-label">Subir un papel</div>
                            <div className="inc-papeles-campos">
                                <div className="form-group">
                                    <label className="form-label">Papel</label>
                                    <Select
                                        ariaLabel="Tipo de papel"
                                        value={tipo}
                                        onChange={(v) => setTipo(v as TipoPapel)}
                                        placeholder="Elige el tipo…"
                                        options={ORDEN_TIPOS_PAPEL.map((t) => ({ value: t, label: TIPOS_PAPEL[t].etiqueta }))}
                                        disabled={subiendo}
                                    />
                                </div>
                                <div className="form-group">
                                    <label className="form-label" htmlFor="papel-archivo">Archivo (PDF o imagen, hasta {MAX_BYTES_PAPEL / MB} MB)</label>
                                    <input
                                        id="papel-archivo"
                                        ref={inputArchivo}
                                        className="form-input"
                                        type="file"
                                        accept={MIME_PAPELES.join(',')}
                                        disabled={subiendo}
                                        onChange={(e) => setArchivo(e.target.files?.[0] ?? null)}
                                    />
                                </div>
                                <div className="form-group">
                                    <label className="form-label" htmlFor="papel-fecha">Fecha del documento (opcional)</label>
                                    <input
                                        id="papel-fecha"
                                        className="form-input"
                                        type="date"
                                        max={fechaLocal()}
                                        value={fechaDocumento}
                                        disabled={subiendo}
                                        onChange={(e) => setFechaDocumento(e.target.value)}
                                    />
                                </div>
                            </div>
                            {tipo && TIPOS_PAPEL[tipo].salud && (
                                <p className="inc-ficha-texto inc-papeles-ayuda">
                                    Este documento trae datos de salud. Solo lo ve quien tiene acceso al historial de incidentes y cada descarga queda registrada.
                                </p>
                            )}
                            {errorSubida && <div className="alert alert-danger" role="alert"><div>{errorSubida}</div></div>}
                            <div>
                                <button type="submit" className="btn btn-primary" disabled={subiendo}>
                                    <FiUploadCloud size={16} /> {subiendo ? 'Subiendo…' : 'Subir papel'}
                                </button>
                            </div>
                        </form>
                    )}
                </>
            )}
        </section>
    );
}
