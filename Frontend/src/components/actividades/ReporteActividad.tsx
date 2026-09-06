import { FiClock } from 'react-icons/fi';
import type { Activity, Worker } from '../../api/client';
import { construirFilasAsistencia } from '../../utils/reporteActividad';

interface Props {
    activity: Activity;
    workers: Worker[];
}

/**
 * Lista de asistencia de la actividad: convocados × firmas.
 * Es la única representación de los asistentes en el detalle — el resumen vive
 * en la cabecera del modal y la descarga del acta, en su pie.
 */
export default function ReporteActividad({ activity, workers }: Props) {
    const { filas } = construirFilasAsistencia(activity, workers);

    if (filas.length === 0) {
        return <p className="ad-empty">Nadie fue convocado y todavía no hay firmas registradas.</p>;
    }

    return (
        <ul className="ad-lista">
            {filas.map((f) => (
                <li key={f.personaId} className={`ad-persona${f.asistio ? ' firmo' : ''}`}>
                    <span className="ad-persona-avatar" aria-hidden="true">{f.nombre.charAt(0)}</span>
                    <span className="ad-persona-id">
                        <span className="ad-persona-nombre">
                            {f.nombre}
                            {!f.convocado && <span className="ad-persona-tag">No convocado</span>}
                        </span>
                        {f.cargo && <span className="ad-persona-cargo">{f.cargo}</span>}
                    </span>
                    {f.asistio ? (
                        <span className="ad-firma">
                            <span className="ad-firma-hora">{f.hora || 'Firmada'}</span>
                            {f.atraso && (
                                <span
                                    className="ad-firma-atraso"
                                    title={`Firmó ${f.minutosAtraso} minutos después de la hora de inicio`}
                                >
                                    <FiClock size={10} aria-hidden="true" /> {f.minutosAtraso}′ tarde
                                </span>
                            )}
                        </span>
                    ) : (
                        <span className="ad-sin-firma">Sin firmar</span>
                    )}
                </li>
            ))}
        </ul>
    );
}
