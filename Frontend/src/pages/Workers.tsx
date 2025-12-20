import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Header from '../components/Header';
import { FiPlus, FiSearch, FiEdit2, FiTrash2, FiEye } from 'react-icons/fi';
import { workersApi, type Worker } from '../api/client';

export default function Workers() {
    const [workers, setWorkers] = useState<Worker[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');

    useEffect(() => {
        loadWorkers();
    }, []);

    const loadWorkers = async () => {
        try {
            const response = await workersApi.list();
            if (response.success && response.data) {
                setWorkers(response.data);
            }
        } catch (error) {
            console.error('Error loading workers:', error);
        } finally {
            setLoading(false);
        }
    };

    const filteredWorkers = workers.filter((worker) => {
        const search = searchTerm.toLowerCase();
        return (
            worker.nombre.toLowerCase().includes(search) ||
            worker.rut.toLowerCase().includes(search) ||
            worker.cargo.toLowerCase().includes(search)
        );
    });

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
                {/* Actions bar */}
                <div className="card mb-6">
                    <div className="flex items-center justify-between">
                        <div style={{ position: 'relative', flex: 1, maxWidth: '400px' }}>
                            <input
                                type="text"
                                placeholder="Buscar por nombre, RUT o cargo..."
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

                        <Link to="/workers/enroll" className="btn btn-primary">
                            <FiPlus />
                            Enrolar Trabajador
                        </Link>
                    </div>
                </div>

                {/* Workers list */}
                {filteredWorkers.length === 0 ? (
                    <div className="card">
                        <div className="empty-state">
                            <div className="empty-state-icon">👷</div>
                            <h3 className="empty-state-title">
                                {searchTerm ? 'Sin resultados' : 'Sin trabajadores'}
                            </h3>
                            <p className="empty-state-description">
                                {searchTerm
                                    ? 'No se encontraron trabajadores con esos criterios de búsqueda.'
                                    : 'Comienza enrolando tu primer trabajador para gestionar sus documentos y firmas.'}
                            </p>
                            {!searchTerm && (
                                <Link to="/workers/enroll" className="btn btn-primary">
                                    <FiPlus />
                                    Enrolar Trabajador
                                </Link>
                            )}
                        </div>
                    </div>
                ) : (
                    <div className="card">
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
                                        <th>Email</th>
                                        <th>Fecha Enrolamiento</th>
                                        <th>Estado</th>
                                        <th>Acciones</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {filteredWorkers.map((worker) => (
                                        <tr key={worker.workerId}>
                                            <td>
                                                <div className="flex items-center gap-3">
                                                    <div className="avatar avatar-sm">
                                                        {worker.nombre.charAt(0)}
                                                    </div>
                                                    <div>
                                                        <div className="font-bold">{worker.nombre} {worker.apellido}</div>
                                                        {worker.telefono && (
                                                            <div className="text-sm text-muted">{worker.telefono}</div>
                                                        )}
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
                                            <td>{worker.cargo}</td>
                                            <td>
                                                {worker.email || <span className="text-muted">-</span>}
                                            </td>
                                            <td>
                                                {new Date(worker.fechaEnrolamiento).toLocaleDateString('es-CL')}
                                            </td>
                                            <td>
                                                <span className={`badge badge-${worker.estado === 'activo' ? 'success' : 'neutral'}`}>
                                                    {worker.estado}
                                                </span>
                                            </td>
                                            <td>
                                                <div className="flex gap-2">
                                                    <button className="btn btn-ghost btn-sm" title="Ver detalles">
                                                        <FiEye />
                                                    </button>
                                                    <button className="btn btn-ghost btn-sm" title="Editar">
                                                        <FiEdit2 />
                                                    </button>
                                                    <button className="btn btn-ghost btn-sm" title="Eliminar" style={{ color: 'var(--danger-500)' }}>
                                                        <FiTrash2 />
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}
            </div>
        </>
    );
}
