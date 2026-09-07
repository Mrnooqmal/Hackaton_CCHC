import { useRef, useState } from 'react';
import { FiUploadCloud, FiFileText, FiDownload, FiTrash2, FiAlertTriangle } from 'react-icons/fi';
import type { Activity } from '../../api/client';
import type { EvaluacionRespaldo } from '../../api/activities.api';
import { uploadsApi } from '../../api/uploads.api';
import { estadoEvaluacion } from '../../utils/reporteActividad';

interface Props {
    activity: Activity;
    tenantId?: string;
    /** Solo el relator/responsables o quien puede crear actividades adjunta o quita. */
    puedeGestionar: boolean;
    guardando: boolean;
    /** null = quitar el respaldo. */
    onGuardar: (respaldo: EvaluacionRespaldo | null) => void;
}

const fechaCorta = (iso?: string | null) => {
    if (!iso) return null;
    const d = new Date(iso);
    return isNaN(d.getTime()) ? null : d.toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric' });
};

/**
 * Respaldo documental de la evaluación de aprendizaje (Art. 13.4 / 16).
 *
 * La plataforma NO toma la evaluación: la rinde y la corrige el relator fuera del
 * sistema. Acá se custodia UN SOLO documento con las evaluaciones de la
 * capacitación, igual que se custodian la MIPER o el PTP — el sistema no lo lee,
 * solo deja constancia de que existe, quién lo subió y cuándo.
 *
 * Por eso no hay notas por persona: quién aprobó se lee en el documento.
 */
export default function EvaluacionActividad({ activity, tenantId, puedeGestionar, guardando, onGuardar }: Props) {
    const estado = estadoEvaluacion(activity);
    const inputRef = useRef<HTMLInputElement>(null);
    const [subiendo, setSubiendo] = useState(false);
    const [error, setError] = useState('');

    if (!estado) return null;

    const ocupado = subiendo || guardando;

    const subir = async (file: File) => {
        setSubiendo(true);
        setError('');
        try {
            const res = await uploadsApi.uploadFile(file, 'evaluaciones', tenantId, tenantId);
            if (res.success && res.data) {
                onGuardar({
                    fileKey: res.data.url,
                    nombre: res.data.nombre,
                    tipo: res.data.tipo,
                    tamano: res.data.tamaño,
                });
            } else {
                setError(res.error || 'No se pudo subir el documento.');
            }
        } catch {
            setError('Error de conexión al subir el documento.');
        } finally {
            setSubiendo(false);
            if (inputRef.current) inputRef.current.value = '';
        }
    };

    const descargar = async () => {
        if (!estado.fileKey) return;
        setError('');
        const res = await uploadsApi.getDownloadUrl(estado.fileKey);
        if (res.success && res.data) window.open(res.data.downloadUrl, '_blank', 'noopener');
        else setError('No se pudo abrir el documento.');
    };

    return (
        <div className="ev">
            <p className="ev-resumen">
                <span className="ev-resumen-dato">
                    Evaluación exigida · nota mínima <b>{estado.notaMinima}%</b>
                </span>
                <span className={`ev-estado${estado.tieneRespaldo ? ' ok' : ''}`}>
                    {estado.tieneRespaldo ? 'Respaldo cargado' : 'Sin respaldo'}
                </span>
            </p>

            {estado.tieneRespaldo ? (
                <div className="ev-archivo">
                    <FiFileText size={16} aria-hidden="true" className="ev-archivo-icono" />
                    <span className="ev-archivo-id">
                        <span className="ev-archivo-nombre">{estado.nombreArchivo}</span>
                        {fechaCorta(estado.subidoEn) && (
                            <span className="ev-archivo-meta">Cargado el {fechaCorta(estado.subidoEn)}</span>
                        )}
                    </span>
                    <button className="btn btn-ghost btn-sm" onClick={descargar} disabled={ocupado}>
                        <FiDownload size={14} /> Ver
                    </button>
                    {puedeGestionar && (
                        <>
                            <button className="btn btn-ghost btn-sm" onClick={() => inputRef.current?.click()} disabled={ocupado}>
                                <FiUploadCloud size={14} /> Reemplazar
                            </button>
                            <button
                                className="btn btn-ghost btn-sm ev-quitar"
                                onClick={() => onGuardar(null)}
                                disabled={ocupado}
                                title="Quitar el respaldo de esta capacitación"
                            >
                                <FiTrash2 size={14} />
                            </button>
                        </>
                    )}
                </div>
            ) : (
                <div className="ev-vacio">
                    <p className="ad-empty">
                        Falta el documento con las evaluaciones de esta capacitación.
                        {' '}El DS 44 (Art. 13.4) exige registrarlas, no solo la asistencia.
                    </p>
                    {puedeGestionar && (
                        <button className="btn btn-secondary btn-sm" onClick={() => inputRef.current?.click()} disabled={ocupado}>
                            <FiUploadCloud size={14} /> {subiendo ? 'Subiendo…' : 'Subir evaluaciones'}
                        </button>
                    )}
                </div>
            )}

            {error && <span className="ev-error"><FiAlertTriangle size={12} /> {error}</span>}

            <input
                ref={inputRef}
                type="file"
                hidden
                accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,.xls,.xlsx"
                onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) subir(file);
                }}
            />
        </div>
    );
}
