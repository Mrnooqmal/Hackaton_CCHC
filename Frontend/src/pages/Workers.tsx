import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Header from '../components/Header';
import {
    LuPlus, LuSearch, LuEye, LuArrowRight, LuUsers, LuShield
} from 'react-icons/lu';
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
    const navigate = useNavigate();
    const { user: currentUser } = useAuth();
    const [workers, setWorkers] = useState<WorkerWithRole[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');

    // Solo admin y prevencionista pueden ver esta página
    const canViewWorkers = currentUser?.rol === 'admin' || currentUser?.rol === 'prevencionista';

    useEffect(() => {
        loadWorkers();
    }, []);

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

    const openWorkerDetails = (worker: WorkerWithRole) => {
        navigate(`/workers/${worker.rut}`);
    };

    const filteredWorkers = workers.filter((worker) => {
        const search = searchTerm.toLowerCase().replace(/[.-]/g, '');
        const workerRutNorm = worker.rut.toLowerCase().replace(/[.-]/g, '');
        const workerNameNorm = worker.nombre.toLowerCase();
        const workerApellidoNorm = (worker.apellido || '').toLowerCase();

        return (
            workerNameNorm.includes(searchTerm.toLowerCase()) ||
            workerRutNorm.includes(search) ||
            workerApellidoNorm.includes(searchTerm.toLowerCase())
        );
    });

    if (!canViewWorkers) {
        return (
            <>
                <Header title="Trabajadores" />
                <div className="page-content">
                    <div className="card">
                        <div className="empty-state">
                            <div className="empty-state-icon">
                                <LuShield size={48} className="text-danger-500" />
                            </div>
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
            <Header title="Trabajadores" />

            <div className="page-content">
                <div className="page-header">
                    <div className="page-header-info">
                        <h2 className="page-header-title">
                            <LuUsers className="text-primary-500" />
                            Registro de Trabajadores
                        </h2>
                        <p className="page-header-description">Listado completo de personal, estados de habilitación y documentos asociados.</p>
                    </div>
                </div>

                {/* Actions bar */}
                <div className="card mb-6">
                    <div className="flex items-center justify-between workers-actions-bar">
                        <div style={{ position: 'relative', flex: 1, maxWidth: '400px' }}>
                            <input
                                type="text"
                                placeholder="Buscar por nombre o RUT..."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                className="form-input"
                                style={{ paddingLeft: '40px' }}
                            />
                            <LuSearch
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
                                <LuPlus />
                                Enrolar Trabajador
                            </Link>
                        </div>
                    </div>
                </div>

                <div className="card">
                    {filteredWorkers.length === 0 ? (
                        <div className="empty-state">
                            <div className="empty-state-icon">
                                <LuUsers size={48} className="text-muted opacity-20" />
                            </div>
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

                            <div className="scroll-hint">
                                <LuArrowRight />
                                <span>Desliza para ver más</span>
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
                                                style={{ cursor: 'pointer' }}
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
                                                        <LuEye />
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
        </>
    );
}
