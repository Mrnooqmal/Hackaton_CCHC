import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Header from '../components/Header';
import {
    LuChevronLeft,
    LuUser,
    LuMail,
    LuIdCard,
    LuTrendingUp,
    LuFileText,
    LuCircleCheck,
    LuCircleAlert,
    LuDownload,
    LuClock,
    LuBriefcase,
    LuShield,
    LuUsers
} from 'react-icons/lu';
import {
    workersApi,
    signaturesApi,
    type Worker as ApiWorker,
    type DigitalSignature,
    REQUEST_TYPES
} from '../api/client';
import { useAuth } from '../context/AuthContext';

interface WorkerStats {
    totalFirmas: number;
    firmasUltimos30Dias: number;
    documentosFirmados: number;
    actividadesAsistidas: number;
}

// Extender la interfaz Worker para incluir rol (que viene del backend para usuarios legacy)
interface WorkerWithRole extends ApiWorker {
    rol?: 'admin' | 'prevencionista' | 'trabajador';
}

const getSigIcon = (sig: DigitalSignature) => {
    const type = (sig as any).requestTipo || sig.tipoFirma;
    switch (type) {
        case 'enrolamiento': return <LuShield size={12} />;
        case 'documento': return <LuFileText size={12} />;
        case 'actividad':
        case 'capacitacion':
        case 'CHARLA_5MIN':
        case 'INDUCCION':
            return <LuUsers size={12} />;
        case 'ENTREGA_EPP':
            return <LuShield size={12} />;
        default:
            return <LuFileText size={12} />;
    }
};

export default function WorkerDetail() {
    const { rut } = useParams<{ rut: string }>();
    const navigate = useNavigate();

    const [worker, setWorker] = useState<WorkerWithRole | null>(null);
    const [stats, setStats] = useState<WorkerStats | null>(null);
    const [signatures, setSignatures] = useState<DigitalSignature[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');


    const normalizeRut = (r: string) => r.replace(/[.-]/g, '').toLowerCase();

    useEffect(() => {
        if (rut) {
            loadWorkerData();
        }
    }, [rut]);

    const loadWorkerData = async () => {
        if (!rut) return;
        setLoading(true);
        setError('');
        try {
            // First find the worker in the list to get full details
            const workersRes = await workersApi.list();
            const normalizedTargetRut = normalizeRut(rut);
            const foundWorker = workersRes.data?.find(w => normalizeRut(w.rut) === normalizedTargetRut) as WorkerWithRole;

            if (!foundWorker) {
                setError('Trabajador no encontrado');
                setLoading(false);
                return;
            }
            setWorker(foundWorker);

            // Load signatures and calculate stats
            const signaturesRes = await signaturesApi.getByWorker(foundWorker.workerId);

            if (signaturesRes.success && signaturesRes.data) {
                const firmas = signaturesRes.data.firmas || [];
                setSignatures(firmas);

                // Calculate statistics manually
                const now = new Date();
                const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

                setStats({
                    totalFirmas: firmas.length,
                    firmasUltimos30Dias: firmas.filter(f => new Date(f.timestamp) > thirtyDaysAgo).length,
                    documentosFirmados: firmas.filter(f => (f as any).requestTipo === 'documento' || f.tipoFirma === 'documento').length,
                    actividadesAsistidas: firmas.filter(f =>
                        ['actividad', 'capacitacion', 'CHARLA_5MIN', 'INDUCCION', 'ENTREGA_EPP', 'ART', 'PROCEDIMIENTO', 'INSPECCION', 'REGLAMENTO']
                            .includes((f as any).requestTipo || f.tipoFirma || '')
                    ).length
                });
            }

        } catch (err) {
            console.error('Error loading worker details:', err);
            setError('Error al cargar la información del trabajador');
        } finally {
            setLoading(false);
        }
    };

    const downloadReport = () => {
        if (!worker || !stats) return;

        const reportContent = `
REPORTE DE TRABAJADOR: ${worker.nombre} ${worker.apellido || ''}
RUT: ${worker.rut}
Fecha: ${new Date().toLocaleDateString('es-CL')}
--------------------------------------------------

DETALLES
- Cargo: ${worker.cargo || 'N/A'}
- Email: ${worker.email || 'N/A'}
- Estado: ${worker.habilitado ? 'Habilitado' : 'Pendiente'}

ESTADÍSTICAS
- Total Firmas: ${stats.totalFirmas}
- Firmas (30 días): ${stats.firmasUltimos30Dias}
- Documentos: ${stats.documentosFirmados}
- Actividades: ${stats.actividadesAsistidas}

HISTORIAL RECIENTE
${signatures.slice(0, 10).map(s => `- ${s.fecha} ${s.horario}: ${s.tipoFirma} (${s.estado})`).join('\n')}

Generado por PrevencionApp
        `.trim();

        const blob = new Blob([reportContent], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `Reporte_${worker.rut}.txt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center" style={{ height: '100vh' }}>
                <div className="spinner" />
            </div>
        );
    }

    if (error || !worker) {
        return (
            <div className="page-content">
                <div className="card text-center p-12">
                    <LuCircleAlert size={48} className="text-danger-500 mb-4 mx-auto" />
                    <h2 className="text-xl font-bold mb-2">{error || 'Trabajador no encontrado'}</h2>
                    <button className="btn btn-primary" onClick={() => navigate('/workers')}>
                        Volver al listado
                    </button>
                </div>
            </div>
        );
    }

    return (
        <>
            <Header title={`Detalle: ${worker.nombre}`} />

            <div className="page-content">
                <div className="page-header">
                    <div className="page-header-info">
                        <button
                            className="btn btn-ghost btn-sm mb-2"
                            onClick={() => navigate('/workers')}
                            style={{ marginLeft: '-12px' }}
                        >
                            <LuChevronLeft className="mr-1" /> Volver a Trabajadores
                        </button>
                        <h2 className="page-header-title">
                            <LuUser className="text-primary-500" />
                            {worker.nombre} {worker.apellido}
                        </h2>
                        <p className="page-header-description">Vista detallada de perfil, estadísticas y cumplimiento.</p>
                    </div>
                    <div className="page-header-actions">
                        <button className="btn btn-secondary" onClick={downloadReport}>
                            <LuDownload className="mr-2" /> Exportar Reporte
                        </button>
                    </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6" style={{ gridTemplateRows: 'auto auto' }}>
                    {/* Columna Izquierda - Info del Trabajador */}
                    <div className="lg:col-span-1 lg:row-span-2">
                        <div className="card p-6 h-fit">
                            <div className="flex flex-col items-center text-center mb-6">
                                <div
                                    className="avatar mb-4"
                                    style={{ width: 80, height: 80, fontSize: '2rem', background: 'var(--primary-100)', color: 'var(--primary-600)' }}
                                >
                                    {worker.nombre.charAt(0)}
                                </div>
                                <h3 className="text-lg font-bold mb-1">{worker.nombre} {worker.apellido}</h3>
                                <div className={`badge mt-2 mb-3 badge-${worker.habilitado ? 'success' : 'warning'}`}>
                                    {worker.habilitado ? 'Habilitado' : 'Pendiente Enrolamiento'}
                                </div>
                            </div>

                            <div className="worker-info-list mt-2">
                                <div className="info-item">
                                    <LuIdCard className="icon" size={18} />
                                    <div className="content">
                                        <label>RUT</label>
                                        <span>{worker.rut}</span>
                                    </div>
                                </div>
                                <div className="info-item">
                                    <LuBriefcase className="icon" size={18} />
                                    <div className="content">
                                        <label>Cargo</label>
                                        <span>{worker.cargo || 'No asignado'}</span>
                                    </div>
                                </div>
                                <div className="info-item">
                                    <LuShield className="icon" size={18} />
                                    <div className="content">
                                        <label>Rol</label>
                                        <span>{worker.rol === 'admin' ? 'Administrador' : (worker.rol === 'prevencionista' ? 'Prevencionista' : 'Trabajador')}</span>
                                    </div>
                                </div>
                                <div className="info-item">
                                    <LuMail className="icon" size={18} />
                                    <div className="content">
                                        <label>Correo</label>
                                        <span>{worker.email || 'Sin correo registrado'}</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Resumen de Actividad - Ahora en la primera fila, segunda columna */}
                    {stats && (
                        <div className="lg:col-span-2">
                            <div className="card p-6">
                                <h4 className="text-sm font-bold uppercase tracking-wider text-muted mb-5 flex items-center gap-2">
                                    <LuTrendingUp size={16} /> Resumen de Actividad
                                </h4>
                                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                                    <div className="detail-stat-box">
                                        <div className="val">{stats.totalFirmas}</div>
                                        <div className="lab">Firmas Totales</div>
                                    </div>
                                    <div className="detail-stat-box">
                                        <div className="val">{stats.firmasUltimos30Dias}</div>
                                        <div className="lab">Últimos 30 días</div>
                                    </div>
                                    <div className="detail-stat-box">
                                        <div className="val">{stats.documentosFirmados}</div>
                                        <div className="lab">Docs. Firmados</div>
                                    </div>
                                    <div className="detail-stat-box">
                                        <div className="val">{stats.actividadesAsistidas}</div>
                                        <div className="lab">Asistencias</div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Historial de Cumplimiento - Segunda fila, segunda columna */}
                    <div className="lg:col-span-2">
                        <div className="card p-0 overflow-hidden h-full">
                            <div className="p-5 border-bottom flex items-center justify-between bg-surface-elevated">
                                <h3 className="font-bold flex items-center gap-2 m-0">
                                    <LuFileText className="text-primary-500" />
                                    Historial de Cumplimiento
                                </h3>
                                <span className="badge badge-secondary">{signatures.length} Registros</span>
                            </div>

                            <div className="signatures-timeline" style={{ maxHeight: '400px', overflowY: 'auto' }}>
                                {signatures.length === 0 ? (
                                    <div className="text-center text-muted" style={{ padding: '60px 48px' }}>
                                        <LuClock size={40} className="mb-3 mx-auto opacity-20" />
                                        <p style={{ marginTop: '8px' }}>No se registran actividades o firmas aún.</p>
                                    </div>
                                ) : (
                                    <div className="table-container">
                                        <table className="table">
                                            <thead>
                                                <tr>
                                                    <th style={{ width: '20%' }}>Tipo</th>
                                                    <th style={{ width: '40%' }}>Documento / Actividad</th>
                                                    <th style={{ width: '20%' }}>Fecha</th>
                                                    <th style={{ width: '20%' }}>Estado</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {signatures.map((sig, i) => (
                                                    <tr key={i}>
                                                        <td>
                                                            <div className="flex items-center gap-2">
                                                                <div
                                                                    className="avatar avatar-sm"
                                                                    style={{
                                                                        background: sig.tipoFirma === 'enrolamiento' ? 'var(--success-100)' : 'var(--primary-100)',
                                                                        color: sig.tipoFirma === 'enrolamiento' ? 'var(--success-600)' : 'var(--primary-600)'
                                                                    }}
                                                                >
                                                                    {getSigIcon(sig)}
                                                                </div>
                                                                <span className="text-xs font-semibold">
                                                                    {REQUEST_TYPES[(sig as any).requestTipo]?.label || sig.tipoFirma?.replace('_', ' ')}
                                                                </span>
                                                            </div>
                                                        </td>
                                                        <td>
                                                            <div className="font-medium text-sm">
                                                                {(sig as any).requestTitulo || (sig.metadata as any)?.titulo || (sig.metadata as any)?.documentoNombre || 'Registro de Sistema'}
                                                            </div>
                                                        </td>
                                                        <td>
                                                            <div className="text-sm">{sig.fecha}</div>
                                                            <div className="text-xs text-muted">{sig.horario}</div>
                                                        </td>
                                                        <td>
                                                            <span className={`badge badge-sm badge-${sig.estado === 'valida' ? 'success' : 'warning'}`}>
                                                                {sig.estado === 'valida' ? <LuCircleCheck className="mr-1" /> : null}
                                                                {sig.estado === 'valida' ? 'Válida' : sig.estado}
                                                            </span>
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <style>{`
                .page-content {
                    padding-bottom: var(--space-6);
                }
                
                .worker-info-list {
                    display: flex;
                    flex-direction: column;
                    gap: var(--space-4);
                }
                
                .info-item {
                    display: flex;
                    gap: var(--space-3);
                    align-items: flex-start;
                    padding: var(--space-1) 0;
                }
                
                .info-item .icon {
                    margin-top: 2px;
                    color: var(--text-muted);
                    flex-shrink: 0;
                }
                
                .info-item .content {
                    display: flex;
                    flex-direction: column;
                    flex: 1;
                }
                
                .info-item label {
                    font-size: 10px;
                    text-transform: uppercase;
                    letter-spacing: 0.05em;
                    color: var(--text-muted);
                    font-weight: 700;
                    margin-bottom: 2px;
                }
                
                .info-item span {
                    font-size: var(--text-sm);
                    color: var(--text-primary);
                    font-weight: 500;
                    word-break: break-word;
                }
                
                .detail-stat-box {
                    background: var(--surface-elevated);
                    border: 1px solid var(--surface-border);
                    border-radius: var(--radius-md);
                    padding: var(--space-4);
                    text-align: center;
                    transition: transform 0.2s, box-shadow 0.2s;
                }
                
                .detail-stat-box:hover {
                    transform: translateY(-2px);
                    box-shadow: var(--shadow-md);
                }
                
                .detail-stat-box .val {
                    font-size: var(--text-xl);
                    font-weight: 800;
                    color: var(--primary-500);
                    line-height: 1.2;
                    margin-bottom: var(--space-1);
                }
                
                .detail-stat-box .lab {
                    font-size: 10px;
                    text-transform: uppercase;
                    color: var(--text-muted);
                    font-weight: 600;
                    letter-spacing: 0.05em;
                }
                
                .border-bottom {
                    border-bottom: 1px solid var(--surface-border);
                }
                
                .signatures-timeline {
                    position: relative;
                }
                
                .table-container {
                    overflow-x: auto;
                }
                
                .table {
                    width: 100%;
                    min-width: 600px;
                }
                
                .table th {
                    position: sticky;
                    top: 0;
                    background: var(--surface-card);
                    z-index: 1;
                    padding: var(--space-3) var(--space-4);
                    font-size: var(--text-xs);
                    text-transform: uppercase;
                    letter-spacing: 0.05em;
                    color: var(--text-muted);
                    font-weight: 700;
                    border-bottom: 1px solid var(--surface-border);
                }
                
                .table td {
                    padding: var(--space-4);
                    border-bottom: 1px solid var(--surface-border);
                    vertical-align: middle;
                }
                
                .table tbody tr {
                    transition: background-color 0.2s;
                }
                
                .table tbody tr:hover {
                    background-color: var(--surface-hover);
                }
                
                /* Responsive adjustments */
                @media (max-width: 1024px) {
                    .detail-stat-box .val {
                        font-size: var(--text-lg);
                    }
                    
                    .grid.grid-cols-1.lg\\:grid-cols-3 {
                        display: flex;
                        flex-direction: column;
                        gap: var(--space-4);
                    }
                    
                    .lg\\:col-span-1,
                    .lg\\:col-span-2 {
                        width: 100%;
                    }
                }
                
                @media (max-width: 768px) {
                    .detail-stat-box {
                        padding: var(--space-3);
                    }
                    
                    .detail-stat-box .val {
                        font-size: var(--text-base);
                    }
                    
                    .detail-stat-box .lab {
                        font-size: 9px;
                    }
                    
                    .page-header {
                        flex-direction: column;
                        align-items: flex-start;
                        gap: var(--space-3);
                    }
                    
                    .page-header-actions {
                        width: 100%;
                    }
                    
                    .page-header-actions .btn {
                        width: 100%;
                    }
                    
                    .table th,
                    .table td {
                        padding: var(--space-3) var(--space-2);
                    }
                }
                
                @media (max-width: 640px) {
                    .card {
                        padding: var(--space-4);
                    }
                    
                    .info-item {
                        flex-direction: column;
                        gap: var(--space-1);
                    }
                    
                    .info-item .icon {
                        align-self: flex-start;
                    }
                    
                    .grid.grid-cols-2.lg\\:grid-cols-4 {
                        grid-template-columns: repeat(2, 1fr);
                        gap: var(--space-3);
                    }
                }
                
                @media (max-width: 480px) {
                    .grid.grid-cols-2.lg\\:grid-cols-4 {
                        grid-template-columns: 1fr;
                    }
                    
                    .detail-stat-box {
                        padding: var(--space-3);
                    }
                }
            `}</style>
        </>
    );
}