import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Header from '../components/Header';
import {
    FiPlus, FiSearch, FiEye, FiX, FiFileText, FiActivity,
    FiCheckCircle, FiClock, FiDownload, FiUser, FiCalendar,
    FiTrendingUp
} from 'react-icons/fi';
import { usersApi, signaturesApi, type User, type DigitalSignature } from '../api/client';
import { useAuth } from '../context/AuthContext';

interface WorkerStats {
    totalFirmas: number;
    firmasUltimos30Dias: number;
    documentosFirmados: number;
    actividadesAsistidas: number;
}

export default function Workers() {
    const { user: currentUser } = useAuth();
    const [workers, setWorkers] = useState<User[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');

    // Panel de detalles
    const [selectedWorker, setSelectedWorker] = useState<User | null>(null);
    const [workerSignatures, setWorkerSignatures] = useState<DigitalSignature[]>([]);
    const [loadingDetails, setLoadingDetails] = useState(false);
    const [workerStats, setWorkerStats] = useState<WorkerStats | null>(null);

    // Solo admin y prevencionista pueden ver esta página
    const canViewWorkers = currentUser?.rol === 'admin' || currentUser?.rol === 'prevencionista';

    useEffect(() => {
        loadWorkers();
    }, []);

    const loadWorkers = async () => {
        try {
            // Cargar usuarios con rol trabajador
            const response = await usersApi.list({ rol: 'trabajador' });
            if (response.success && response.data) {
                setWorkers(response.data.users);
            }
        } catch (error) {
            console.error('Error loading workers:', error);
        } finally {
            setLoading(false);
        }
    };

    const openWorkerDetails = async (worker: User) => {
        setSelectedWorker(worker);
        setLoadingDetails(true);

        try {
            // Obtener historial de firmas
            const signaturesRes = await signaturesApi.getByWorker(worker.userId);
            if (signaturesRes.success && signaturesRes.data) {
                const firmas = signaturesRes.data.firmas || [];
                setWorkerSignatures(firmas);

                // Calcular estadísticas
                const now = new Date();
                const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

                setWorkerStats({
                    totalFirmas: firmas.length,
                    firmasUltimos30Dias: firmas.filter(f => new Date(f.timestamp) > thirtyDaysAgo).length,
                    documentosFirmados: firmas.filter(f => f.tipoFirma === 'documento').length,
                    actividadesAsistidas: firmas.filter(f => f.tipoFirma === 'actividad' || f.tipoFirma === 'capacitacion').length
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
            `- ${f.fecha} ${f.horario}: ${f.tipoFirma} (Token: ${f.token.substring(0, 8)}...)`
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

                <div className="grid" style={{ gridTemplateColumns: selectedWorker ? '1fr 400px' : '1fr', gap: 'var(--space-6)' }}>
                    {/* Workers list */}
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
                                                <th>Email</th>
                                                <th>Estado</th>
                                                <th>Acciones</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {filteredWorkers.map((worker) => (
                                                <tr
                                                    key={worker.userId}
                                                    style={{
                                                        cursor: 'pointer',
                                                        background: selectedWorker?.userId === worker.userId
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

                    {/* Panel de detalles */}
                    {selectedWorker && (
                        <div className="card" style={{ position: 'sticky', top: 'var(--space-4)', alignSelf: 'start' }}>
                            <div className="card-header">
                                <div className="flex items-center gap-3">
                                    <div className="avatar" style={{ width: 48, height: 48, fontSize: '1.2rem' }}>
                                        {selectedWorker.nombre.charAt(0)}
                                    </div>
                                    <div>
                                        <h3 className="card-title">{selectedWorker.nombre} {selectedWorker.apellido}</h3>
                                        <p className="text-muted text-sm">{selectedWorker.rut}</p>
                                    </div>
                                </div>
                                <button
                                    className="btn btn-ghost btn-sm"
                                    onClick={() => setSelectedWorker(null)}
                                >
                                    <FiX />
                                </button>
                            </div>

                            {loadingDetails ? (
                                <div className="flex items-center justify-center" style={{ padding: 'var(--space-8)' }}>
                                    <div className="spinner" />
                                </div>
                            ) : (
                                <>
                                    {/* Info básica */}
                                    <div style={{ padding: 'var(--space-4)', borderBottom: '1px solid var(--surface-border)' }}>
                                        <div className="flex items-center gap-2 mb-2">
                                            <FiUser size={14} className="text-muted" />
                                            <span className="text-sm">Estado: </span>
                                            <span className={`badge badge-sm badge-${selectedWorker.habilitado ? 'success' : 'warning'}`}>
                                                {selectedWorker.habilitado ? 'Habilitado' : 'Pendiente Enrolamiento'}
                                            </span>
                                        </div>
                                        {selectedWorker.email && (
                                            <div className="text-sm text-muted">
                                                📧 {selectedWorker.email}
                                            </div>
                                        )}
                                    </div>

                                    {/* Estadísticas */}
                                    {workerStats && (
                                        <div style={{ padding: 'var(--space-4)', borderBottom: '1px solid var(--surface-border)' }}>
                                            <h4 className="text-sm font-bold mb-3" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
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
                                        </div>
                                    )}

                                    {/* Historial de firmas recientes */}
                                    <div style={{ padding: 'var(--space-4)', borderBottom: '1px solid var(--surface-border)' }}>
                                        <h4 className="text-sm font-bold mb-3" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                            <FiFileText /> Firmas Recientes
                                        </h4>
                                        {workerSignatures.length === 0 ? (
                                            <p className="text-muted text-sm">Sin firmas registradas</p>
                                        ) : (
                                            <div className="flex flex-col gap-2">
                                                {workerSignatures.slice(0, 5).map((sig, index) => (
                                                    <div key={index} className="signature-item">
                                                        <div className="flex items-center gap-2">
                                                            {sig.estado === 'valida' ? (
                                                                <FiCheckCircle style={{ color: 'var(--success-500)' }} />
                                                            ) : (
                                                                <FiClock style={{ color: 'var(--warning-500)' }} />
                                                            )}
                                                            <span className="text-sm capitalize">{sig.tipoFirma}</span>
                                                        </div>
                                                        <div className="text-xs text-muted">
                                                            {sig.fecha} {sig.horario}
                                                        </div>
                                                    </div>
                                                ))}
                                                {workerSignatures.length > 5 && (
                                                    <p className="text-muted text-xs text-center">
                                                        +{workerSignatures.length - 5} firmas más
                                                    </p>
                                                )}
                                            </div>
                                        )}
                                    </div>

                                    {/* Acciones */}
                                    <div style={{ padding: 'var(--space-4)' }}>
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
                    )}
                </div>
            </div>

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
            `}</style>
        </>
    );
}
