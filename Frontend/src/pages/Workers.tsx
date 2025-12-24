import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Header from '../components/Header';
import {
    FiPlus, FiSearch, FiEye, FiX, FiFileText,
    FiDownload, FiUser, FiTrendingUp
} from 'react-icons/fi';
import { workersApi, signaturesApi, type Worker, type DigitalSignature, REQUEST_TYPES } from '../api/client';
import { useAuth } from '../context/AuthContext';

interface WorkerStats {
    totalFirmas: number;
    firmasUltimos30Dias: number;
    documentosFirmados: number;
    actividadesAsistidas: number;
}

// Extender la interfaz Worker para incluir rol (que viene del backend para usuarios legacy)
interface WorkerWithRole extends Worker {
    rol?: 'admin' | 'prevencionista' | 'trabajador';
}

export default function Workers() {
    const { user: currentUser } = useAuth();
    const [workers, setWorkers] = useState<WorkerWithRole[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');

    // Panel de detalles
    const [selectedWorker, setSelectedWorker] = useState<WorkerWithRole | null>(null);
    const [workerSignatures, setWorkerSignatures] = useState<DigitalSignature[]>([]);
    const [loadingDetails, setLoadingDetails] = useState(false);
    const [workerStats, setWorkerStats] = useState<WorkerStats | null>(null);

    // Solo admin y prevencionista pueden ver esta página
    const canViewWorkers = currentUser?.rol === 'admin' || currentUser?.rol === 'prevencionista';

    useEffect(() => {
        loadWorkers();
    }, []);

    useEffect(() => {
        if (selectedWorker) {
            document.body.style.overflow = 'hidden';
        } else {
            document.body.style.overflow = '';
        }

        return () => {
            document.body.style.overflow = '';
        };
    }, [selectedWorker]);

    const loadWorkers = async () => {
        try {
            // Usar workersApi.list que consolida workers nuevos y usuarios legacy
            const response = await workersApi.list();

            if (response.success && response.data) {
                const allWorkers = response.data as WorkerWithRole[];
                // Ordenar por nombre
                allWorkers.sort((a, b) => a.nombre.localeCompare(b.nombre));
                setWorkers(allWorkers);
            }
        } catch (error) {
            console.error('Error loading workers:', error);
        } finally {
            setLoading(false);
        }
    };

    const openWorkerDetails = async (worker: WorkerWithRole) => {
        setSelectedWorker(worker);
        setLoadingDetails(true);

        try {
            // Obtener historial de firmas
            // workersApi devuelve siempre workerId
            const signaturesRes = await signaturesApi.getByWorker(worker.workerId);
            if (signaturesRes.success && signaturesRes.data) {
                const firmas = signaturesRes.data.firmas || [];
                setWorkerSignatures(firmas);

                // Calcular estadísticas
                const now = new Date();
                const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

                setWorkerStats({
                    totalFirmas: firmas.length,
                    firmasUltimos30Dias: firmas.filter(f => new Date(f.timestamp) > thirtyDaysAgo).length,
                    documentosFirmados: firmas.filter(f => (f as any).requestTipo === 'documento' || f.tipoFirma === 'documento').length,
                    actividadesAsistidas: firmas.filter(f =>
                        ['actividad', 'capacitacion', 'CHARLA_5MIN', 'INDUCCION', 'ENTREGA_EPP', 'ART', 'PROCEDIMIENTO', 'INSPECCION', 'REGLAMENTO']
                            .includes((f as any).requestTipo || f.tipoFirma || '')
                    ).length
                });
            }
        } catch (error) {
            console.error('Error loading worker details:', error);
        } finally {
            setLoadingDetails(false);
        }
    };

    const downloadWorkerReport = () => {
        if (!selectedWorker || !workerStats) return;

        // Generar reporte en formato texto (simplificado para hackathon)
        const reportContent = `
REPORTE DE TRABAJADOR
=====================
Fecha de generación: ${new Date().toLocaleDateString('es-CL')}

DATOS PERSONALES
----------------
Nombre: ${selectedWorker.nombre} ${selectedWorker.apellido}
RUT: ${selectedWorker.rut}
Email: ${selectedWorker.email || 'No registrado'}
Estado: ${selectedWorker.estado}
Habilitado: ${selectedWorker.habilitado ? 'Sí' : 'No'}

ESTADÍSTICAS DE FIRMAS
----------------------
Total de firmas: ${workerStats.totalFirmas}
Firmas últimos 30 días: ${workerStats.firmasUltimos30Dias}
Documentos firmados: ${workerStats.documentosFirmados}
Actividades asistidas: ${workerStats.actividadesAsistidas}

HISTORIAL DE FIRMAS
-------------------
${workerSignatures.map(f =>
            `- ${f.fecha} ${f.horario}: ${(f.metadata as any)?.titulo || (f.metadata as any)?.documentoNombre || f.tipoFirma} (Token: ${f.token.substring(0, 8)}...)`
        ).join('\n')}

---
Generado por PrevencionApp
        `.trim();

        const blob = new Blob([reportContent], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `reporte_${selectedWorker.rut.replace(/\./g, '')}_${new Date().toISOString().split('T')[0]}.txt`;
        a.click();
        URL.revokeObjectURL(url);
    };

    const filteredWorkers = workers.filter((worker) => {
        const search = searchTerm.toLowerCase();
        return (
            worker.nombre.toLowerCase().includes(search) ||
            worker.rut.toLowerCase().includes(search) ||
            (worker.apellido || '').toLowerCase().includes(search)
        );
    });

    if (!canViewWorkers) {
        return (
            <>
                <Header title="Trabajadores" />
                <div className="page-content">
                    <div className="card">
                        <div className="empty-state">
                            <div className="empty-state-icon">🔒</div>
                            <h3 className="empty-state-title">Acceso Restringido</h3>
                            <p className="empty-state-description">
                                Solo administradores y prevencionistas pueden ver esta sección.
                            </p>
                        </div>
                    </div>
                </div>
            </>
        );
    }

    if (loading) {
        return (
            <div className="flex items-center justify-center" style={{ height: '100vh' }}>
                <div className="spinner" />
            </div>
        );
    }

    return (
        <>
            <Header title="Dashboard de Trabajadores" />

            <div className="page-content">
                {/* Actions bar */}
                <div className="card mb-6">
                    <div className="flex items-center justify-between">
                        <div style={{ position: 'relative', flex: 1, maxWidth: '400px' }}>
                            <input
                                type="text"
                                placeholder="Buscar por nombre o RUT..."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                className="form-input"
                                style={{ paddingLeft: '40px' }}
                            />
                            <FiSearch
                                style={{
                                    position: 'absolute',
                                    left: '12px',
                                    top: '50%',
                                    transform: 'translateY(-50%)',
                                    color: 'var(--text-muted)'
                                }}
                            />
                        </div>

                        <div className="flex gap-2">
                            <Link to="/workers/enroll" className="btn btn-primary">
                                <FiPlus />
                                Enrolar Trabajador
                            </Link>
                        </div>
                    </div>
                </div>

                <div className="card">
                    {filteredWorkers.length === 0 ? (
                        <div className="empty-state">
                            <div className="empty-state-icon">👷</div>
                            <h3 className="empty-state-title">
                                {searchTerm ? 'Sin resultados' : 'Sin trabajadores'}
                            </h3>
                            <p className="empty-state-description">
                                {searchTerm
                                    ? 'No se encontraron trabajadores con esos criterios de búsqueda.'
                                    : 'No hay usuarios con rol trabajador registrados.'}
                            </p>
                        </div>
                    ) : (
                        <>
                            <div className="card-header">
                                <div>
                                    <h2 className="card-title">Lista de Trabajadores</h2>
                                    <p className="card-subtitle">{filteredWorkers.length} trabajadores registrados</p>
                                </div>
                            </div>

                            <div className="table-container">
                                <table className="table">
                                    <thead>
                                        <tr>
                                            <th>Trabajador</th>
                                            <th>RUT</th>
                                            <th>Cargo</th>
                                            <th>Rol</th>
                                            <th>Email</th>
                                            <th>Estado</th>
                                            <th>Acciones</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {filteredWorkers.map((worker) => (
                                            <tr
                                                key={worker.workerId}
                                                style={{
                                                    cursor: 'pointer',
                                                    background: selectedWorker?.workerId === worker.workerId
                                                        ? 'var(--surface-elevated)'
                                                        : undefined
                                                }}
                                                onClick={() => openWorkerDetails(worker)}
                                            >
                                                <td>
                                                    <div className="flex items-center gap-3">
                                                        <div className="avatar avatar-sm">
                                                            {worker.nombre.charAt(0)}
                                                        </div>
                                                        <div>
                                                            <div className="font-bold">{worker.nombre} {worker.apellido}</div>
                                                        </div>
                                                    </div>
                                                </td>
                                                <td>
                                                    <code style={{
                                                        background: 'var(--surface-elevated)',
                                                        padding: '2px 8px',
                                                        borderRadius: 'var(--radius-sm)',
                                                        fontSize: 'var(--text-sm)'
                                                    }}>
                                                        {worker.rut}
                                                    </code>
                                                </td>
                                                <td>
                                                    <div className="font-medium text-sm">{worker.cargo}</div>
                                                </td>
                                                <td>
                                                    <span className={`badge badge-${worker.rol === 'prevencionista' ? 'info' : 'secondary'}`}>
                                                        {worker.rol === 'prevencionista' ? 'Prevencionista' : (worker.rol === 'admin' ? 'Admin' : 'Trabajador')}
                                                    </span>
                                                </td>
                                                <td>
                                                    {worker.email || <span className="text-muted">-</span>}
                                                </td>
                                                <td>
                                                    <span className={`badge badge-${worker.habilitado ? 'success' : 'warning'}`}>
                                                        {worker.habilitado ? 'Habilitado' : 'Pendiente'}
                                                    </span>
                                                </td>
                                                <td>
                                                    <button
                                                        className="btn btn-ghost btn-sm"
                                                        title="Ver detalles"
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            openWorkerDetails(worker);
                                                        }}
                                                    >
                                                        <FiEye />
                                                    </button>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </>
                    )}
                </div>
            </div>

            {selectedWorker && (
                <div
                    className="worker-details-overlay"
                    role="dialog"
                    aria-modal="true"
                    aria-label="Detalles del trabajador"
                    onClick={() => setSelectedWorker(null)}
                >
                    <div
                        className="worker-details-panel"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="worker-details-header">
                            <div className="flex items-center gap-3">
                                <div className="avatar" style={{ width: 56, height: 56, fontSize: '1.5rem' }}>
                                    {selectedWorker.nombre.charAt(0)}
                                </div>
                                <div>
                                    <h3 className="card-title mb-1">{selectedWorker.nombre} {selectedWorker.apellido}</h3>
                                    <p className="text-muted text-sm">{selectedWorker.rut}</p>
                                </div>
                            </div>
                            <button
                                className="btn btn-ghost btn-sm"
                                aria-label="Cerrar detalles"
                                onClick={() => setSelectedWorker(null)}
                            >
                                <FiX />
                            </button>
                        </div>

                        {loadingDetails ? (
                            <div className="worker-details-loading">
                                <div className="spinner" />
                            </div>
                        ) : (
                            <>
                                <section className="worker-details-section">
                                    <div className="flex items-center gap-2 mb-2">
                                        <FiUser size={14} className="text-muted" />
                                        <span className="text-sm">Estado:</span>
                                        <span className={`badge badge-sm badge-${selectedWorker.habilitado ? 'success' : 'warning'}`}>
                                            {selectedWorker.habilitado ? 'Habilitado' : 'Pendiente Enrolamiento'}
                                        </span>
                                    </div>
                                    {selectedWorker.email && (
                                        <div className="text-sm text-muted">
                                            📧 {selectedWorker.email}
                                        </div>
                                    )}
                                </section>

                                {workerStats && (
                                    <section className="worker-details-section">
                                        <h4 className="section-title">
                                            <FiTrendingUp /> Estadísticas
                                        </h4>
                                        <div className="grid grid-cols-2 gap-3">
                                            <div className="stat-box">
                                                <div className="stat-value">{workerStats.totalFirmas}</div>
                                                <div className="stat-label">Total Firmas</div>
                                            </div>
                                            <div className="stat-box">
                                                <div className="stat-value">{workerStats.firmasUltimos30Dias}</div>
                                                <div className="stat-label">Últimos 30 días</div>
                                            </div>
                                            <div className="stat-box">
                                                <div className="stat-value">{workerStats.documentosFirmados}</div>
                                                <div className="stat-label">Documentos</div>
                                            </div>
                                            <div className="stat-box">
                                                <div className="stat-value">{workerStats.actividadesAsistidas}</div>
                                                <div className="stat-label">Actividades</div>
                                            </div>
                                        </div>
                                    </section>
                                )}

                                <section className="worker-details-section">
                                    <div className="worker-details-section-header">
                                        <h4 className="section-title">
                                            <FiFileText /> Historial de Firmas
                                        </h4>
                                        {workerSignatures.length > 0 && (
                                            <span
                                                className="badge"
                                                style={{
                                                    background: 'var(--primary-100)',
                                                    color: 'var(--primary-700)',
                                                    fontSize: '11px'
                                                }}
                                            >
                                                {workerSignatures.length} firma{workerSignatures.length !== 1 ? 's' : ''}
                                            </span>
                                        )}
                                    </div>
                                    {workerSignatures.length === 0 ? (
                                        <div className="worker-details-empty">
                                            <div className="worker-details-empty-icon">📝</div>
                                            <p className="text-muted text-sm">
                                                Este trabajador aún no tiene firmas registradas
                                            </p>
                                        </div>
                                    ) : (
                                        <div className="worker-signatures-list">
                                            {workerSignatures.map((sig, index) => (
                                                <div key={index} className="signature-item-expanded">
                                                    <div className="flex items-start gap-3">
                                                        <div
                                                            className="avatar avatar-sm"
                                                            style={{
                                                                background: sig.tipoFirma === 'enrolamiento'
                                                                    ? 'var(--success-100)'
                                                                    : 'var(--primary-100)',
                                                                color: sig.tipoFirma === 'enrolamiento'
                                                                    ? 'var(--success-600)'
                                                                    : 'var(--primary-600)',
                                                                fontSize: '1rem',
                                                                flexShrink: 0
                                                            }}
                                                        >
                                                            {REQUEST_TYPES[(sig as any).requestTipo]?.icon || (sig.tipoFirma === 'enrolamiento' ? '🔑' : '📝')}
                                                        </div>
                                                        <div style={{ flex: 1, minWidth: 0 }}>
                                                            <div className="text-sm font-medium signature-title">
                                                                {(sig as any).requestTitulo || (sig.metadata as any)?.titulo || (sig.metadata as any)?.documentoNombre || (sig.tipoFirma === 'enrolamiento' ? 'Enrolamiento Digital' : sig.tipoFirma?.replace('_', ' ') || 'Documento sin título')}
                                                            </div>
                                                            <div className="flex items-center gap-2 flex-wrap">
                                                                <span className="badge signature-type">
                                                                    {REQUEST_TYPES[(sig as any).requestTipo]?.label || sig.tipoFirma || 'Firma'}
                                                                </span>
                                                                <span className="text-xs text-muted">
                                                                    {sig.fecha} • {sig.horario}
                                                                </span>
                                                            </div>
                                                        </div>
                                                        <div style={{ flexShrink: 0 }}>
                                                            <span
                                                                className="badge"
                                                                style={{
                                                                    background: sig.estado === 'valida' ? 'var(--success-100)' : 'var(--warning-100)',
                                                                    color: sig.estado === 'valida' ? 'var(--success-700)' : 'var(--warning-700)',
                                                                    fontSize: '10px'
                                                                }}
                                                            >
                                                                {sig.estado === 'valida' ? '✓ Válida' : sig.estado}
                                                            </span>
                                                        </div>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </section>

                                <div className="worker-details-actions">
                                    <button
                                        className="btn btn-secondary btn-sm w-full"
                                        onClick={downloadWorkerReport}
                                        disabled={!workerStats}
                                    >
                                        <FiDownload />
                                        Descargar Reporte
                                    </button>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            )}

            <style>{`
                .stat-box {
                    background: var(--surface-elevated);
                    padding: var(--space-3);
                    border-radius: var(--radius-md);
                    text-align: center;
                }
                .stat-value {
                    font-size: var(--text-xl);
                    font-weight: 700;
                    color: var(--primary-500);
                }
                .stat-label {
                    font-size: 10px;
                    color: var(--text-muted);
                    text-transform: uppercase;
                }
                .signature-item {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    padding: var(--space-2);
                    background: var(--surface-elevated);
                    border-radius: var(--radius-sm);
                }
                .badge-sm {
                    font-size: 10px;
                    padding: 1px 6px;
                }
                .worker-details-overlay {
                    position: fixed;
                    inset: 0;
                    background: rgba(8, 12, 20, 0.68);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    padding: var(--space-6);
                    z-index: 50;
                    backdrop-filter: blur(6px);
                }
                .worker-details-panel {
                    background: var(--surface-base);
                    width: min(480px, 100%);
                    max-height: 90vh;
                    border-radius: var(--radius-lg);
                    border: 1px solid var(--surface-border);
                    box-shadow: 0 25px 60px rgba(4, 9, 20, 0.35);
                    display: flex;
                    flex-direction: column;
                    overflow-y: auto;
                }
                .worker-details-header {
                    padding: var(--space-5);
                    border-bottom: 1px solid var(--surface-border);
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    gap: var(--space-4);
                }
                .worker-details-loading {
                    padding: var(--space-8);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                }
                .worker-details-section {
                    padding: var(--space-4);
                    border-bottom: 1px solid var(--surface-border);
                }
                .worker-details-section-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    gap: var(--space-3);
                    margin-bottom: var(--space-2);
                }
                .section-title {
                    display: flex;
                    align-items: center;
                    gap: var(--space-2);
                    font-size: var(--text-sm);
                    font-weight: 700;
                    margin: 0;
                }
                .worker-details-empty {
                    text-align: center;
                    padding: var(--space-5);
                    background: var(--surface-elevated);
                    border-radius: var(--radius-md);
                }
                .worker-details-empty-icon {
                    font-size: 2rem;
                    margin-bottom: var(--space-2);
                }
                .worker-signatures-list {
                    max-height: 320px;
                    overflow-y: auto;
                    padding-right: var(--space-1);
                    display: flex;
                    flex-direction: column;
                    gap: var(--space-2);
                }
                .signature-item-expanded {
                    padding: var(--space-3);
                    background: var(--surface-elevated);
                    border-radius: var(--radius-md);
                    border: 1px solid var(--surface-border);
                }
                .signature-title {
                    margin-bottom: 2px;
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                }
                .signature-type {
                    background: var(--surface-hover);
                    color: var(--text-secondary);
                    font-size: 10px;
                    padding: 2px 6px;
                }
                .worker-details-actions {
                    padding: var(--space-4);
                }
                @media (max-width: 768px) {
                    .worker-details-overlay {
                        padding: var(--space-4);
                    }
                    .worker-details-panel {
                        width: 100%;
                        max-height: 100vh;
                    }
                }
            `}</style>
        </>
    );
}
