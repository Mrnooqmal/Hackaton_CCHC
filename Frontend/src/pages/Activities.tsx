import { useState, useEffect } from 'react';
import Header from '../components/Header';
import {
    FiPlus,
    FiUsers,
    FiCheck,
    FiMessageSquare,
    FiAlertTriangle,
    FiBook,
    FiAward,
    FiSearch,
    FiCalendar,
    FiFileText,
    FiFilter
} from 'react-icons/fi';
import { activitiesApi, workersApi, type Activity, type Worker } from '../api/client';
import SignatureModal from '../components/SignatureModal';
import { useAuth } from '../context/AuthContext';

const ACTIVITY_TYPES: Record<string, { label: string; color: string; icon: React.ReactElement }> = {
    CHARLA_5MIN: { label: 'Charla 5 Minutos', color: 'var(--primary-500)', icon: <FiMessageSquare /> },
    ART: { label: 'Análisis de Riesgos', color: 'var(--warning-500)', icon: <FiAlertTriangle /> },
    CAPACITACION: { label: 'Capacitación', color: 'var(--info-500)', icon: <FiBook /> },
    INDUCCION: { label: 'Inducción', color: 'var(--success-500)', icon: <FiAward /> },
    INSPECCION: { label: 'Inspección', color: 'var(--accent-500)', icon: <FiSearch /> },
};

export default function Activities() {
    const { user } = useAuth();
    const [activities, setActivities] = useState<Activity[]>([]);
    const [workers, setWorkers] = useState<Worker[]>([]);
    const [loading, setLoading] = useState(true);
    const [showModal, setShowModal] = useState(false);
    const [showAttendanceModal, setShowAttendanceModal] = useState(false);
    const [selectedActivity, setSelectedActivity] = useState<Activity | null>(null);
    const [selectedWorkers, setSelectedWorkers] = useState<string[]>([]);
    const [searchTerm, setSearchTerm] = useState('');
    const [filterType, setFilterType] = useState('');
    const [showSignatureModal, setShowSignatureModal] = useState(false);
    const [signatureError, setSignatureError] = useState('');
    const [showSelfSignModal, setShowSelfSignModal] = useState(false);
    const [selfSignActivity, setSelfSignActivity] = useState<Activity | null>(null);
    const [notification, setNotification] = useState<{ message: string; type: 'success' | 'error' | 'info' | 'warning' } | null>(null);

    const showNotification = (message: string, type: 'success' | 'error' | 'info' | 'warning' = 'info') => {
        setNotification({ message, type });
        setTimeout(() => setNotification(null), 5000);
    };

    // Check if user is a worker (can self-sign)
    const canSelfSign = user?.rol === 'trabajador' && user?.workerId;
    // Check if user can manage (prevencionista/admin)
    const canManage = user?.rol === 'admin' || user?.rol === 'prevencionista';

    const [newActivity, setNewActivity] = useState({
        tipo: 'CHARLA_5MIN',
        titulo: '',
        descripcion: '',
        relatorId: '',
    });

    useEffect(() => {
        loadData();
    }, []);

    const loadData = async () => {
        try {
            const [activitiesRes, workersRes] = await Promise.all([
                activitiesApi.list(),
                workersApi.list()
            ]);

            if (activitiesRes.success && activitiesRes.data) {
                setActivities(activitiesRes.data.activities);
            }
            if (workersRes.success && workersRes.data) {
                setWorkers(workersRes.data);
            }
        } catch (error) {
            console.error('Error loading data:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleCreateActivity = async (e: React.FormEvent) => {
        e.preventDefault();

        try {
            const response = await activitiesApi.create(newActivity);
            if (response.success && response.data) {
                setActivities([response.data, ...activities]);
                setShowModal(false);
                setNewActivity({ tipo: 'CHARLA_5MIN', titulo: '', descripcion: '', relatorId: '' });
            }
        } catch (error) {
            console.error('Error creating activity:', error);
        }
    };

    const handleRegisterAttendance = async (pin: string) => {
        if (!selectedActivity || selectedWorkers.length === 0) return;
        setSignatureError('');

        try {
            const response = await activitiesApi.registerAttendance(selectedActivity.activityId, {
                workerIds: selectedWorkers,
                incluirFirmaRelator: true,
                pin: pin, // Include PIN for digital signature
            });

            if (response.success) {
                setShowSignatureModal(false);
                loadData();
                setShowAttendanceModal(false);
                setSelectedActivity(null);
                setSelectedWorkers([]);
                showNotification(`Asistencia registrada para ${selectedWorkers.length} trabajador(es)`, 'success');
            } else {
                setSignatureError(response.error || 'Error al registrar asistencia');
            }
        } catch (error: any) {
            console.error('Error registering attendance:', error);
            setSignatureError(error.message || 'Error al registrar asistencia');
        }
    };

    const openAttendanceModal = (activity: Activity) => {
        setSelectedActivity(activity);
        setShowAttendanceModal(true);
    };

    // Self-sign handler for workers
    const handleSelfSign = async (pin: string) => {
        if (!selfSignActivity || !user?.workerId) return;
        setSignatureError('');

        try {
            const response = await activitiesApi.registerAttendance(selfSignActivity.activityId, {
                workerIds: [user.workerId],
                incluirFirmaRelator: false,
                pin: pin,
            });

            if (response.success) {
                setShowSelfSignModal(false);
                loadData();
                setSelfSignActivity(null);
                showNotification('Tu asistencia ha sido registrada exitosamente', 'success');
            } else {
                setSignatureError(response.error || 'Error al registrar tu asistencia');
            }
        } catch (error: any) {
            console.error('Error self-signing:', error);
            setSignatureError(error.message || 'Error al registrar tu asistencia');
        }
    };

    const openSelfSignModal = (activity: Activity) => {
        setSelfSignActivity(activity);
        setShowSelfSignModal(true);
    };

    const toggleWorkerSelection = (workerId: string) => {
        setSelectedWorkers(prev =>
            prev.includes(workerId)
                ? prev.filter(id => id !== workerId)
                : [...prev, workerId]
        );
    };

    const selectAllWorkers = () => {
        if (selectedWorkers.length === workers.length) {
            setSelectedWorkers([]);
        } else {
            setSelectedWorkers(workers.map(w => w.workerId));
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center" style={{ height: '100vh' }}>
                <div className="spinner" />
            </div>
        );
    }

    const todayActivities = activities.filter(a =>
        a.fecha === new Date().toISOString().split('T')[0]
    );

    // Filter activities based on search and type
    const filteredActivities = activities.filter(a => {
        const matchesSearch = searchTerm.trim() === '' ||
            a.titulo.toLowerCase().includes(searchTerm.toLowerCase()) ||
            (a.descripcion && a.descripcion.toLowerCase().includes(searchTerm.toLowerCase()));
        const matchesType = filterType === '' || a.tipo === filterType;
        return matchesSearch && matchesType;
    });

    return (
        <>
            <Header title="Actividades" />

            {/* Toast Notification */}
            {notification && (
                <div
                    style={{
                        position: 'fixed',
                        top: '80px',
                        right: '20px',
                        padding: 'var(--space-4) var(--space-5)',
                        borderRadius: 'var(--radius-lg)',
                        background: notification.type === 'success' ? 'var(--success-500)' :
                            notification.type === 'error' ? 'var(--danger-500)' :
                                notification.type === 'warning' ? 'var(--warning-500)' : 'var(--info-500)',
                        color: 'white',
                        boxShadow: 'var(--shadow-lg)',
                        zIndex: 9999,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 'var(--space-3)',
                        animation: 'slideIn 0.3s ease-out',
                        maxWidth: '400px',
                    }}
                >
                    {notification.type === 'success' && <FiCheck size={20} />}
                    {notification.type === 'error' && <FiAlertTriangle size={20} />}
                    <span>{notification.message}</span>
                    <button
                        onClick={() => setNotification(null)}
                        style={{ marginLeft: 'auto', background: 'transparent', border: 'none', color: 'white', cursor: 'pointer' }}
                    >
                        ✕
                    </button>
                </div>
            )}

            <div className="page-content">
                <div className="page-header">
                    <div className="page-header-info">
                        <h2 className="page-header-title">
                            <FiCalendar className="text-primary-500" />
                            Registro de Actividades y Capacitación
                        </h2>
                        <p className="page-header-description">
                            Gestión de charlas de 5 minutos, inducciones, ART y capacitación técnica.
                        </p>
                    </div>
                </div>

                {/* Search Bar */}
                <div className="flex gap-3 mb-6" style={{ flexWrap: 'wrap' }}>
                    <div className="flex items-center gap-2" style={{ flex: 1, minWidth: '200px', background: 'var(--surface-elevated)', border: '1px solid var(--surface-border)', borderRadius: 'var(--radius-lg)', padding: '10px 16px' }}>
                        <FiSearch style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                        <input
                            type="text"
                            placeholder="Buscar actividades..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="form-control"
                            style={{ border: 'none', background: 'transparent', padding: 0, boxShadow: 'none', color: 'var(--text-primary)' }}
                        />
                    </div>
                    <div style={{ position: 'relative', minWidth: '200px' }}>
                        <select
                            value={filterType}
                            onChange={(e) => setFilterType(e.target.value)}
                            className="form-input"
                            style={{
                                paddingLeft: '48px',
                                paddingRight: '16px',
                                height: '44px',
                                borderRadius: '12px',
                                cursor: 'pointer',
                                appearance: 'none',
                                background: 'var(--surface-elevated)',
                                border: '1px solid var(--surface-border)',
                                color: 'var(--text-primary)',
                                fontWeight: 500,
                            }}
                        >
                            <option value="">Todos los tipos</option>
                            {Object.entries(ACTIVITY_TYPES).map(([key, { label }]) => (
                                <option key={key} value={key}>{label}</option>
                            ))}
                        </select>
                        <FiFilter
                            size={18}
                            style={{
                                position: 'absolute',
                                left: '16px',
                                top: '50%',
                                transform: 'translateY(-50%)',
                                color: 'var(--text-muted)',
                                pointerEvents: 'none',
                            }}
                        />
                    </div>
                </div>

                {/* Quick Actions */}
                <div className="grid grid-cols-4 mb-6">
                    {Object.entries(ACTIVITY_TYPES).slice(0, 4).map(([key, { label, color, icon }]) => (
                        <div
                            key={key}
                            className="card"
                            style={{ cursor: 'pointer' }}
                            onClick={() => {
                                setNewActivity({ ...newActivity, tipo: key });
                                setShowModal(true);
                            }}
                        >
                            <div className="flex items-center gap-3">
                                <div className="avatar" style={{ background: color, fontSize: '1.5rem' }}>
                                    {icon}
                                </div>
                                <div>
                                    <div className="font-bold">{label}</div>
                                    <div className="text-sm text-muted">Crear nueva</div>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>

                {/* Today's Activities */}
                <div className="card mb-6">
                    <div className="card-header">
                        <div>
                            <h2 className="card-title">Actividades de Hoy</h2>
                            <p className="card-subtitle">
                                {new Date().toLocaleDateString('es-CL', {
                                    weekday: 'long',
                                    year: 'numeric',
                                    month: 'long',
                                    day: 'numeric'
                                })}
                            </p>
                        </div>
                        <button className="btn btn-primary" onClick={() => setShowModal(true)}>
                            <FiPlus />
                            Nueva Actividad
                        </button>
                    </div>

                    {todayActivities.length === 0 ? (
                        <div className="empty-state" style={{ padding: 'var(--space-8)' }}>
                            <div className="empty-state-icon"><FiCalendar size={48} style={{ color: 'var(--text-muted)' }} /></div>
                            <h3 className="empty-state-title">Sin actividades hoy</h3>
                            <p className="empty-state-description">
                                Registra la primera actividad del día, como la charla de 5 minutos.
                            </p>
                            <button
                                className="btn btn-primary"
                                onClick={() => {
                                    setNewActivity({ ...newActivity, tipo: 'CHARLA_5MIN' });
                                    setShowModal(true);
                                }}
                            >
                                <FiMessageSquare />
                                Registrar Charla 5 Min
                            </button>
                        </div>
                    ) : (
                        <div className="flex flex-col gap-3">
                            {todayActivities.map((activity) => {
                                const typeInfo = ACTIVITY_TYPES[activity.tipo] || {
                                    label: activity.tipo,
                                    color: 'var(--gray-500)',
                                    icon: <FiFileText />
                                };

                                return (
                                    <div
                                        key={activity.activityId}
                                        className="flex items-center justify-between"
                                        style={{
                                            padding: 'var(--space-4)',
                                            background: 'var(--surface-elevated)',
                                            borderRadius: 'var(--radius-md)',
                                            border: '1px solid var(--surface-border)'
                                        }}
                                    >
                                        <div className="flex items-center gap-4">
                                            <div
                                                className="avatar"
                                                style={{ background: typeInfo.color, fontSize: '1.2rem' }}
                                            >
                                                {typeInfo.icon}
                                            </div>
                                            <div>
                                                <div className="font-bold">{activity.titulo}</div>
                                                <div className="text-sm text-muted">
                                                    {typeInfo.label} • {activity.horaInicio}
                                                    {activity.horaFin && ` - ${activity.horaFin}`}
                                                </div>
                                            </div>
                                        </div>

                                        <div className="flex items-center gap-4">
                                            <div className="flex items-center gap-2">
                                                <FiUsers />
                                                <span>{activity.asistentes.length} asistentes</span>
                                            </div>

                                            <span className={`badge badge-${activity.estado === 'completada' ? 'success' :
                                                activity.estado === 'programada' ? 'neutral' : 'warning'
                                                }`}>
                                                {activity.estado === 'completada' ? 'Completada' :
                                                    activity.estado === 'programada' ? 'Programada' : 'En curso'}
                                            </span>

                                            {activity.estado !== 'completada' && (
                                                <div className="flex items-center gap-2">
                                                    {/* Worker self-sign button */}
                                                    {canSelfSign && !activity.asistentes.some(a => a.workerId === user?.workerId) && (
                                                        <button
                                                            className="btn btn-secondary btn-sm"
                                                            onClick={() => openSelfSignModal(activity)}
                                                        >
                                                            <FiCheck />
                                                            Registrar mi asistencia
                                                        </button>
                                                    )}
                                                    {/* Manager mass attendance button */}
                                                    {canManage && (
                                                        <button
                                                            className="btn btn-primary btn-sm"
                                                            onClick={() => openAttendanceModal(activity)}
                                                        >
                                                            <FiCheck />
                                                            Registrar Asistencia
                                                        </button>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>

                {/* All Activities */}
                <div className="card">
                    <div className="card-header">
                        <h2 className="card-title">Historial de Actividades</h2>
                    </div>

                    <div className="table-container">
                        <table className="table">
                            <thead>
                                <tr>
                                    <th>Actividad</th>
                                    <th>Tipo</th>
                                    <th>Fecha</th>
                                    <th>Hora</th>
                                    <th>Asistentes</th>
                                    <th>Estado</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filteredActivities.slice(0, 10).map((activity) => {
                                    const typeInfo = ACTIVITY_TYPES[activity.tipo] || {
                                        label: activity.tipo,
                                        color: 'var(--gray-500)'
                                    };

                                    return (
                                        <tr key={activity.activityId}>
                                            <td>
                                                <div className="font-bold">{activity.titulo}</div>
                                                {activity.descripcion && (
                                                    <div className="text-sm text-muted">{activity.descripcion}</div>
                                                )}
                                            </td>
                                            <td>
                                                <span
                                                    className="badge"
                                                    style={{ background: `${typeInfo.color}20`, color: typeInfo.color }}
                                                >
                                                    {typeInfo.label}
                                                </span>
                                            </td>
                                            <td>{new Date(activity.fecha).toLocaleDateString('es-CL')}</td>
                                            <td>{activity.horaInicio}</td>
                                            <td>
                                                <div className="flex items-center gap-1">
                                                    <FiUsers />
                                                    {activity.asistentes.length}
                                                </div>
                                            </td>
                                            <td>
                                                <span className={`badge badge-${activity.estado === 'completada' ? 'success' :
                                                    activity.estado === 'cancelada' ? 'danger' : 'warning'
                                                    }`}>
                                                    {activity.estado}
                                                </span>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>

                {/* Create Activity Modal */}
                {showModal && (
                    <div className="modal-overlay" onClick={() => setShowModal(false)}>
                        <div className="modal" onClick={(e) => e.stopPropagation()}>
                            <div className="modal-header">
                                <h2 className="modal-title">Nueva Actividad</h2>
                                <button
                                    className="btn btn-ghost btn-icon"
                                    onClick={() => setShowModal(false)}
                                >
                                    ✕
                                </button>
                            </div>

                            <form onSubmit={handleCreateActivity}>
                                <div className="modal-body">
                                    <div className="form-group">
                                        <label className="form-label">Tipo de Actividad *</label>
                                        <select
                                            value={newActivity.tipo}
                                            onChange={(e) => setNewActivity({ ...newActivity, tipo: e.target.value })}
                                            className="form-input form-select"
                                            required
                                        >
                                            {Object.entries(ACTIVITY_TYPES).map(([key, { label }]) => (
                                                <option key={key} value={key}>{label}</option>
                                            ))}
                                        </select>
                                    </div>

                                    <div className="form-group">
                                        <label className="form-label">Título *</label>
                                        <input
                                            type="text"
                                            value={newActivity.titulo}
                                            onChange={(e) => setNewActivity({ ...newActivity, titulo: e.target.value })}
                                            className="form-input"
                                            placeholder="Ej: Uso correcto de EPP"
                                            required
                                        />
                                    </div>

                                    <div className="form-group">
                                        <label className="form-label">Descripción</label>
                                        <textarea
                                            value={newActivity.descripcion}
                                            onChange={(e) => setNewActivity({ ...newActivity, descripcion: e.target.value })}
                                            className="form-input"
                                            rows={3}
                                            placeholder="Descripción de la actividad..."
                                            style={{ resize: 'vertical' }}
                                        />
                                    </div>

                                    <div className="form-group">
                                        <label className="form-label">Relator *</label>
                                        <select
                                            value={newActivity.relatorId}
                                            onChange={(e) => setNewActivity({ ...newActivity, relatorId: e.target.value })}
                                            className="form-input form-select"
                                            required
                                        >
                                            <option value="">Seleccione un relator</option>
                                            {workers.map((worker) => (
                                                <option key={worker.workerId} value={worker.workerId}>
                                                    {worker.nombre} {worker.apellido} - {worker.cargo}
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                </div>

                                <div className="modal-footer">
                                    <button
                                        type="button"
                                        className="btn btn-secondary"
                                        onClick={() => setShowModal(false)}
                                    >
                                        Cancelar
                                    </button>
                                    <button type="submit" className="btn btn-primary">
                                        Crear Actividad
                                    </button>
                                </div>
                            </form>
                        </div>
                    </div>
                )}

                {/* Attendance Modal */}
                {showAttendanceModal && selectedActivity && (
                    <div className="modal-overlay" onClick={() => setShowAttendanceModal(false)}>
                        <div
                            className="modal"
                            onClick={(e) => e.stopPropagation()}
                            style={{ maxWidth: '700px' }}
                        >
                            <div className="modal-header">
                                <div>
                                    <h2 className="modal-title">Registrar Asistencia</h2>
                                    <p className="text-sm text-muted">{selectedActivity.titulo}</p>
                                </div>
                                <button
                                    className="btn btn-ghost btn-icon"
                                    onClick={() => setShowAttendanceModal(false)}
                                >
                                    ✕
                                </button>
                            </div>

                            <div className="modal-body">
                                <div className="flex justify-between items-center mb-4">
                                    <span className="font-bold">Seleccionar Trabajadores</span>
                                    <button
                                        className="btn btn-secondary btn-sm"
                                        onClick={selectAllWorkers}
                                    >
                                        {selectedWorkers.length === workers.length ? 'Deseleccionar todos' : 'Seleccionar todos'}
                                    </button>
                                </div>

                                <div
                                    className="flex flex-col gap-2"
                                    style={{ maxHeight: '300px', overflowY: 'auto' }}
                                >
                                    {workers.map((worker) => {
                                        const isSelected = selectedWorkers.includes(worker.workerId);
                                        const alreadyAttended = selectedActivity.asistentes
                                            .some(a => a.workerId === worker.workerId);

                                        return (
                                            <div
                                                key={worker.workerId}
                                                className={`flex items-center justify-between ${alreadyAttended ? '' : 'cursor-pointer'}`}
                                                style={{
                                                    padding: 'var(--space-3)',
                                                    background: isSelected ? 'rgba(76, 175, 80, 0.1)' : 'var(--surface-elevated)',
                                                    borderRadius: 'var(--radius-md)',
                                                    border: isSelected ? '1px solid var(--primary-500)' : '1px solid transparent',
                                                    opacity: alreadyAttended ? 0.5 : 1
                                                }}
                                                onClick={() => !alreadyAttended && toggleWorkerSelection(worker.workerId)}
                                            >
                                                <div className="flex items-center gap-3">
                                                    <div className="avatar avatar-sm">
                                                        {worker.nombre.charAt(0)}
                                                    </div>
                                                    <div>
                                                        <div className="font-bold">{worker.nombre} {worker.apellido}</div>
                                                        <div className="text-sm text-muted">{worker.cargo}</div>
                                                    </div>
                                                </div>

                                                {alreadyAttended ? (
                                                    <span className="badge badge-success">Ya registrado</span>
                                                ) : (
                                                    <div
                                                        style={{
                                                            width: '24px',
                                                            height: '24px',
                                                            borderRadius: '4px',
                                                            border: '2px solid var(--surface-border)',
                                                            background: isSelected ? 'var(--primary-500)' : 'transparent',
                                                            display: 'flex',
                                                            alignItems: 'center',
                                                            justifyContent: 'center'
                                                        }}
                                                    >
                                                        {isSelected && <FiCheck style={{ color: 'white' }} />}
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>

                                {selectedWorkers.length > 0 && (
                                    <div className="mt-6">
                                        <div className="alert alert-info">
                                            <strong>{selectedWorkers.length}</strong> trabajador(es) seleccionado(s) para firma masiva.
                                        </div>
                                    </div>
                                )}
                            </div>

                            <div className="modal-footer">
                                <button
                                    type="button"
                                    className="btn btn-secondary"
                                    onClick={() => setShowAttendanceModal(false)}
                                >
                                    Cancelar
                                </button>
                                <button
                                    className="btn btn-primary"
                                    disabled={selectedWorkers.length === 0}
                                    onClick={() => setShowSignatureModal(true)}
                                >
                                    <FiCheck />
                                    Firmar y Registrar {selectedWorkers.length} Asistencia(s)
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {/* Signature Modal for Attendance Registration */}
                <SignatureModal
                    isOpen={showSignatureModal}
                    onClose={() => setShowSignatureModal(false)}
                    onConfirm={handleRegisterAttendance}
                    type="activity"
                    title="Firmar Asistencia"
                    itemName={selectedActivity?.titulo}
                    description={`Registrarás la asistencia de ${selectedWorkers.length} trabajador(es) a esta actividad.`}
                    error={signatureError}
                />

                {/* Self-Sign Modal for Workers */}
                <SignatureModal
                    isOpen={showSelfSignModal}
                    onClose={() => setShowSelfSignModal(false)}
                    onConfirm={handleSelfSign}
                    type="activity"
                    title="Registrar mi asistencia"
                    itemName={selfSignActivity?.titulo}
                    description="Confirma tu asistencia a esta actividad con tu firma digital."
                    error={signatureError}
                />
            </div>
        </>
    );
}
