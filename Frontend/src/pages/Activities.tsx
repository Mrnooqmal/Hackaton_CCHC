import { useState, useEffect } from 'react';
import Header from '../components/Header';
import SignaturePad from '../components/SignaturePad';
import {
    FiPlus,
    FiCalendar,
    FiUsers,
    FiCheck,
    FiClock,
    FiMessageSquare
} from 'react-icons/fi';
import { activitiesApi, workersApi, type Activity, type Worker } from '../api/client';

const ACTIVITY_TYPES: Record<string, { label: string; color: string; icon: string }> = {
    CHARLA_5MIN: { label: 'Charla 5 Minutos', color: 'var(--primary-500)', icon: '💬' },
    ART: { label: 'Análisis de Riesgos', color: 'var(--warning-500)', icon: '⚠️' },
    CAPACITACION: { label: 'Capacitación', color: 'var(--info-500)', icon: '📚' },
    INDUCCION: { label: 'Inducción', color: 'var(--success-500)', icon: '🎓' },
    INSPECCION: { label: 'Inspección', color: 'var(--accent-500)', icon: '🔍' },
};

export default function Activities() {
    const [activities, setActivities] = useState<Activity[]>([]);
    const [workers, setWorkers] = useState<Worker[]>([]);
    const [loading, setLoading] = useState(true);
    const [showModal, setShowModal] = useState(false);
    const [showAttendanceModal, setShowAttendanceModal] = useState(false);
    const [selectedActivity, setSelectedActivity] = useState<Activity | null>(null);
    const [selectedWorkers, setSelectedWorkers] = useState<string[]>([]);

    const [newActivity, setNewActivity] = useState({
        tipo: 'CHARLA_5MIN',
        tema: '',
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
                setNewActivity({ tipo: 'CHARLA_5MIN', tema: '', descripcion: '', relatorId: '' });
            }
        } catch (error) {
            console.error('Error creating activity:', error);
        }
    };

    const handleRegisterAttendance = async () => {
        if (!selectedActivity || selectedWorkers.length === 0) return;

        try {
            const response = await activitiesApi.registerAttendance(selectedActivity.activityId, {
                workerIds: selectedWorkers,
                incluirFirmaRelator: true
            });

            if (response.success) {
                loadData();
                setShowAttendanceModal(false);
                setSelectedActivity(null);
                setSelectedWorkers([]);
            }
        } catch (error) {
            console.error('Error registering attendance:', error);
        }
    };

    const openAttendanceModal = (activity: Activity) => {
        setSelectedActivity(activity);
        setShowAttendanceModal(true);
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

    return (
        <>
            <Header title="Actividades" />

            <div className="page-content">
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
                            <div className="empty-state-icon">📅</div>
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
                                    icon: '📋'
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
                                                <div className="font-bold">{activity.tema}</div>
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
                                                <button
                                                    className="btn btn-primary btn-sm"
                                                    onClick={() => openAttendanceModal(activity)}
                                                >
                                                    <FiCheck />
                                                    Registrar Asistencia
                                                </button>
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
                                {activities.slice(0, 10).map((activity) => {
                                    const typeInfo = ACTIVITY_TYPES[activity.tipo] || {
                                        label: activity.tipo,
                                        color: 'var(--gray-500)'
                                    };

                                    return (
                                        <tr key={activity.activityId}>
                                            <td>
                                                <div className="font-bold">{activity.tema}</div>
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
                                        <label className="form-label">Tema *</label>
                                        <input
                                            type="text"
                                            value={newActivity.tema}
                                            onChange={(e) => setNewActivity({ ...newActivity, tema: e.target.value })}
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
                                    <p className="text-sm text-muted">{selectedActivity.tema}</p>
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
                                    onClick={handleRegisterAttendance}
                                >
                                    <FiCheck />
                                    Registrar {selectedWorkers.length} Asistencia(s)
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </>
    );
}
