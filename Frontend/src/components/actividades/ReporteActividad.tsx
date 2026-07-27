import { FiDownload, FiUsers } from 'react-icons/fi';
import type { Activity, Worker, CatalogosActividad, PermisosTrabajoDef } from '../../api/client';
import { construirFilasAsistencia, abrirReporteImpresion } from '../../utils/reporteActividad';

interface Props {
    activity: Activity;
    workers: Worker[];
    catalogos: CatalogosActividad | null;
    permisosDef: PermisosTrabajoDef;
}

export default function ReporteActividad({ activity, workers, catalogos, permisosDef }: Props) {
    const filas = construirFilasAsistencia(activity, workers);

    return (
        <div>
            <div className="flex items-center justify-between" style={{ marginBottom: 'var(--space-2)' }}>
                <div className="text-xs text-muted flex items-center gap-1">
                    <FiUsers /> Reporte de asistencia — {filas.asistieron} participante(s)
                    {filas.requeridos > 0 && ` de ${filas.requeridos} convocado(s) (${filas.porcentaje}%)`}
                </div>
                <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => abrirReporteImpresion(activity, filas, catalogos, permisosDef)}
                >
                    <FiDownload size={14} /> Descargar reporte
                </button>
            </div>
            {filas.filas.length === 0 ? (
                <div className="text-sm text-muted">Sin convocados ni asistencias registradas.</div>
            ) : (
                <div className="table-container">
                    <table className="table">
                        <thead><tr><th>Nombre</th><th>Cargo</th><th>Asistió</th><th>Hora firma</th></tr></thead>
                        <tbody>
                            {filas.filas.map((f) => (
                                <tr key={f.personaId}>
                                    <td>{f.nombre}{!f.convocado && <span className="text-xs text-muted"> (no convocado)</span>}</td>
                                    <td>{f.cargo}</td>
                                    <td>
                                        <span className={`badge badge-sm ${f.asistio ? 'badge-success' : 'badge-danger'}`}>
                                            {f.asistio ? 'Sí' : 'No'}
                                        </span>
                                        {f.atraso && (
                                            <span className="badge badge-sm badge-warning" style={{ marginLeft: 'var(--space-1)' }} title={`Firmó ${f.minutosAtraso} min después de la hora programada`}>
                                                Atraso {f.minutosAtraso}′
                                            </span>
                                        )}
                                    </td>
                                    <td>{f.hora || '—'}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}
