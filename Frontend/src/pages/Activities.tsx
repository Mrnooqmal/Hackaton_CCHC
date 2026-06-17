import { useState, useEffect } from 'react';
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
import { Modal, Select } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { useObraContext } from '../context/ObraContext';
import { PERMISSIONS } from '../permissions';
import { useToast } from '../context/ToastContext';
import { useOfflineSignature } from '../hooks/useOfflineSignature';

const ACTIVITY_TYPES: Record<string, { label: string; color: string; icon: React.ReactElement }> = {
    CHARLA_5MIN: { label: 'Charla 5 Minutos', color: 'var(--primary-500)', icon: <FiMessageSquare /> },
    ART: { label: 'Análisis de Riesgos', color: 'var(--warning-500)', icon: <FiAlertTriangle /> },
    CAPACITACION: { label: 'Capacitación', color: 'var(--info-500)', icon: <FiBook /> },
    INDUCCION: { label: 'Inducción', color: 'var(--success-500)', icon: <FiAward /> },
    INSPECCION: { label: 'Inspección', color: 'var(--accent-500)', icon: <FiSearch /> },
};

// Subtipos de CAPACITACION segun el DS44 (deben coincidir con CAPACITACION_SUBTIPOS del backend).
const CAPACITACION_SUBTIPOS: Record<string, string> = {
    PRL_8H: 'Prevención de Riesgos Laborales (8h) — Art. 16',
    EPP: 'Uso y mantención de EPP — Art. 13',
    CPHS_ORIENTACION: 'Orientación CPHS (8h) — Art. 32',
    CPHS_20H: 'Curso 20h CPHS — Art. 32',
    DELEGADO: 'Capacitación Delegado SST — Art. 66',
    ENCARGADO: 'Encargado Gestión del Riesgo — Art. 65',
    OTRA: 'Otra capacitación',
};

export default function Activities() {
    const { user, hasPermission } = useAuth();
    const canCrearActividad = hasPermission(PERMISSIONS.ACTIVIDADES_CREAR);
    const { isOnline, pendingCount, signActivity, syncPendingSignatures } = useOfflineSignature();
    const { toast } = useToast();
    const { selectedObraId, obras } = useObraContext();
    const selectedObra = obras.find(o => o.obraId === selectedObraId) ?? null;
    const [activities, setActivities] = useState<Activity[]>([]);
    const [workers, setWorkers] = useState<Worker[]>([]);
    const [loading, setLoading] = useState(true);
    const [showModal, setShowModal] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [showAttendanceModal, setShowAttendanceModal] = useState(false);
    const [selectedActivity, setSelectedActivity] = useState<Activity | null>(null);
    const [showDetailModal, setShowDetailModal] = useState(false);
    const [detailActivity, setDetailActivity] = useState<Activity | null>(null);
    const [selectedWorkers, setSelectedWorkers] = useState<string[]>([]);
    const [searchTerm, setSearchTerm] = useState('');
    const [filterType, setFilterType] = useState('');
    const [showSignatureModal, setShowSignatureModal] = useState(false);
    const [signatureError, setSignatureError] = useState('');
    const [showSelfSignModal, setShowSelfSignModal] = useState(false);
    const [selfSignActivity, setSelfSignActivity] = useState<Activity | null>(null);

    // Check if user is a worker (can self-sign)
    const canSelfSign = user?.rol === 'trabajador' && user?.personaId;
    // Check if user can manage (prevencionista/admin)
    const canManage = canCrearActividad;

    const emptyActivity = {
        tipo: 'CHARLA_5MIN',
        subtipo: '',
        titulo: '',
        descripcion: '',
        relatorId: '',
        fecha: new Date().toISOString().split('T')[0],
        horaInicio: new Date().toTimeString().slice(0, 5),
        horaFin: '',
        ubicacion: '',
        asistentesRequeridos: [] as string[],
    };
    const [newActivity, setNewActivity] = useState(emptyActivity);

    useEffect(() => {
        loadData();
    }, [selectedObraId]);

    // Sync pending offline signatures when online
    useEffect(() => {
        if (isOnline && pendingCount > 0) {
            syncPendingSignatures().then(result => {
                if (result.synced > 0) {
                    toast.success(`${result.synced} firma(s) sincronizada(s)`);
                    loadData();
                }
            });
        }
    }, [isOnline]);

    const loadData = async () => {
        // Sin obra seleccionada no se carga nada: la vista muestra el estado vacío.
        if (!selectedObraId) {
            setActivities([]);
            setWorkers([]);
            setLoading(false);
            return;
        }
        setLoading(true);
        try {
            const [activitiesRes, workersRes] = await Promise.all([
                activitiesApi.list({ obraId: selectedObraId }),
                workersApi.list({ obraId: selectedObraId })
            ]);

            if (activitiesRes.success && activitiesRes.data) {
                // Aislamiento por obra: aunque el backend devuelva de más (registros
                // legacy sin obraId), solo mostramos los de la obra activa.
                setActivities(activitiesRes.data.activities.filter(a => a.obraId === selectedObraId));
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
        if (submitting) return;
        if (!selectedObraId) {
            toast.error('Seleccione una obra antes de crear una actividad');
            return;
        }

        setSubmitting(true);
        try {
            const payload: any = { ...newActivity, obraId: selectedObraId };
            // El subtipo solo aplica a capacitaciones.
            if (payload.tipo !== 'CAPACITACION') delete payload.subtipo;
            // Campos opcionales vacíos no se envían.
            if (!payload.horaFin) delete payload.horaFin;
            if (!payload.ubicacion) delete payload.ubicacion;
            const response = await activitiesApi.create(payload);
            if (response.success && response.data) {
                setActivities([response.data, ...activities]);
                setShowModal(false);
                setNewActivity(emptyActivity);
                toast.success('Actividad creada correctamente');
            } else {
                toast.error(response.error || 'Error al crear la actividad');
            }
        } catch (error) {
            console.error('Error creating activity:', error);
            toast.error('Error al crear la actividad');
        } finally {
            setSubmitting(false);
        }
    };

    const handleRegisterAttendance = async (pin: string) => {
        if (!selectedActivity || selectedWorkers.length === 0) return;
        setSignatureError('');

        // Offline-first: if no connection, save each worker's attendance locally
        if (!navigator.onLine) {
            for (const workerId of selectedWorkers) {
                const worker = workers.find(w => w.personaId === workerId);
                await signActivity(
                    selectedActivity.activityId,
                    selectedActivity.titulo,
                    workerId,
                    worker ? `${worker.nombre} ${worker.apellido || ''}`.trim() : 'Trabajador',
                    pin
                );
            }
            setShowSignatureModal(false);
            setShowAttendanceModal(false);
            setSelectedActivity(null);
            setSelectedWorkers([]);
            toast.info(`${selectedWorkers.length} asistencia(s) guardada(s) localmente. Se sincronizaran cuando vuelva la conexion.`);
            return;
        }

        try {
            const response = await activitiesApi.registerAttendance(selectedActivity.activityId, {
                workerIds: selectedWorkers,
                incluirFirmaRelator: true,
                pin: pin,
            });

            if (response.success) {
                setShowSignatureModal(false);
                loadData();
                setShowAttendanceModal(false);
                setSelectedActivity(null);
                setSelectedWorkers([]);
                toast.success(`Asistencia registrada para ${selectedWorkers.length} trabajador(es)`);
            } else {
                // Check if it's a network error disguised as API error
                const errMsg = (response.error || '').toLowerCase();
                if (errMsg.includes('fetch') || errMsg.includes('network')) {
                    for (const workerId of selectedWorkers) {
                        const worker = workers.find(w => w.personaId === workerId);
                        await signActivity(
                            selectedActivity.activityId,
                            selectedActivity.titulo,
                            workerId,
                            worker ? `${worker.nombre} ${worker.apellido || ''}`.trim() : 'Trabajador',
                            pin
                        );
                    }
                    setShowSignatureModal(false);
                    setShowAttendanceModal(false);
                    setSelectedActivity(null);
                    setSelectedWorkers([]);
                    toast.info(`${selectedWorkers.length} asistencia(s) guardada(s) localmente. Se sincronizaran cuando vuelva la conexion.`);
                } else {
                    setSignatureError(response.error || 'Error al registrar asistencia');
                }
            }
        } catch (error: any) {
            // Network error - fallback to offline storage
            const msg = (error?.message || '').toLowerCase();
            if (msg.includes('fetch') || msg.includes('network') || !navigator.onLine) {
                for (const workerId of selectedWorkers) {
                    const worker = workers.find(w => w.personaId === workerId);
                    await signActivity(
                        selectedActivity.activityId,
                        selectedActivity.titulo,
                        workerId,
                        worker ? `${worker.nombre} ${worker.apellido || ''}`.trim() : 'Trabajador',
                        pin
                    );
                }
                setShowSignatureModal(false);
                setShowAttendanceModal(false);
                setSelectedActivity(null);
                setSelectedWorkers([]);
                toast.info(`${selectedWorkers.length} asistencia(s) guardada(s) localmente. Se sincronizaran cuando vuelva la conexion.`);
            } else {
                console.error('Error registering attendance:', error);
                setSignatureError(error.message || 'Error al registrar asistencia');
            }
        }
    };

    const openAttendanceModal = (activity: Activity) => {
        setSelectedActivity(activity);
        setShowAttendanceModal(true);
    };

    const openDetailModal = (activity: Activity) => {
        setDetailActivity(activity);
        setShowDetailModal(true);
    };

    const toggleRequiredAttendee = (personaId: string) => {
        setNewActivity(prev => ({
            ...prev,
            asistentesRequeridos: prev.asistentesRequeridos.includes(personaId)
                ? prev.asistentesRequeridos.filter(id => id !== personaId)
                : [...prev.asistentesRequeridos, personaId],
        }));
    };

    // Self-sign handler for workers
    const handleSelfSign = async (pin: string) => {
        if (!selfSignActivity || !user?.personaId) return;
        setSignatureError('');
        try {
            const result = await signActivity(
                selfSignActivity.activityId,
                selfSignActivity.titulo,
                user.personaId,
                user.nombre || 'Trabajador',
                pin
            );

            if (result.success) {
                setShowSelfSignModal(false);
                setSelfSignActivity(null);
                if (result.offline) {
                    toast.info('Asistencia guardada localmente. Se sincronizara cuando vuelva la conexion.');
                } else {
                    toast.success('Tu asistencia ha sido registrada exitosamente');
                    loadData();
                }
            } else {
                setSignatureError(result.error || 'Error al registrar tu asistencia');
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
            setSelectedWorkers(workers.map(w => w.personaId));
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center" style={{ height: '100vh' }}>
                <div className="spinner" />
            </div>
        );
    }

    const today = new Date().toISOString().split('T')[0];

    const matchesFilters = (a: Activity) => {
        const matchesSearch = searchTerm.trim() === '' ||
            a.titulo.toLowerCase().includes(searchTerm.toLowerCase()) ||
            (a.descripcion && a.descripcion.toLowerCase().includes(searchTerm.toLowerCase()));
        const matchesType = filterType === '' || a.tipo === filterType;
        return matchesSearch && matchesType;
    };

    const todayActivities = activities.filter(a => a.fecha === today && matchesFilters(a));
    const filteredActivities = activities.filter(matchesFilters);

    return (
        <>



            <div className="page-content">
                <div className="page-header">
                    <div className="page-header-info">
                        <h2 className="page-header-title">
                            <FiCalendar className="text-primary-500" />
                            Registro de Actividades y Capacitación
                        </h2>
                        <p className="page-header-description">
                            {selectedObra
                                ? `Obra: ${selectedObra.nombre}`
                                : 'Gestión de charlas de 5 minutos, inducciones, ART y capacitación técnica.'}
                        </p>
                    </div>
                </div>

                {/* Gate: obra requerida */}
                {!selectedObraId && (
                    <div className="empty-state" style={{ padding: 'var(--space-16) var(--space-6)' }}>
                        <div className="empty-state-icon">
                            <FiCalendar size={48} style={{ color: 'var(--text-muted)' }} />
                        </div>
                        <h3 className="empty-state-title">Seleccione una obra para ver sus actividades</h3>
                        <p className="empty-state-description">
                            Use el selector de obra en la barra superior para elegir la obra de la que
                            desea ver o registrar actividades.
                        </p>
                    </div>
                )}

                {/* Contenido — solo visible cuando hay obra seleccionada */}
                {selectedObraId && <>

                {/* Offline Banner */}
                {(!isOnline || pendingCount > 0) && (
                    <div
                        className="mb-4 p-3 rounded-lg flex items-center justify-between"
                        style={{
                            background: !isOnline ? 'rgba(245, 158, 11, 0.1)' : 'rgba(59, 130, 246, 0.1)',
                            border: `1px solid ${!isOnline ? '#f59e0b' : '#3b82f6'}`,
                            color: !isOnline ? '#b45309' : '#1d4ed8'
                        }}
                    >
                        <div className="flex items-center gap-2">
                            {!isOnline ? (
                                <>
                                    <FiAlertTriangle size={18} />
                                    <span className="font-medium">Sin conexión - Tu asistencia se guardará localmente</span>
                                </>
                            ) : (
                                <>
                                    <FiCheck size={18} />
                                    <span className="font-medium">{pendingCount} registro(s) pendiente(s) de sincronizar</span>
                                </>
                            )}
                        </div>
                        {isOnline && pendingCount > 0 && (
                            <button
                                className="btn btn-sm"
                                style={{
                                    background: '#3b82f6',
                                    color: 'white',
                                    border: 'none',
                                    padding: 'var(--space-1) var(--space-3)',
                                    borderRadius: 'var(--radius-md)'
                                }}
                                onClick={() => syncPendingSignatures()}
                            >
                                Sincronizar ahora
                            </button>
                        )}
                    </div>
                )}

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
                    <div style={{ minWidth: '200px' }}>
                        <Select
                            ariaLabel="Filtrar por tipo"
                            leadingIcon={<FiFilter size={18} />}
                            value={filterType}
                            onChange={setFilterType}
                            options={[
                                { value: '', label: 'Todos los tipos' },
                                ...Object.entries(ACTIVITY_TYPES).map(([key, { label }]) => ({ value: key, label })),
                            ]}
                        />
                    </div>
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
                        {canCrearActividad && (
                            <button className="btn btn-primary" onClick={() => setShowModal(true)}>
                                <FiPlus />
                                Nueva Actividad
                            </button>
                        )}
                    </div>

                    {todayActivities.length === 0 ? (
                        <div className="empty-state" style={{ padding: 'var(--space-8)' }}>
                            <div className="empty-state-icon"><FiCalendar size={48} style={{ color: 'var(--text-muted)' }} /></div>
                            <h3 className="empty-state-title">Sin actividades hoy</h3>
                            <p className="empty-state-description">
                                Registra la primera actividad del día, como la charla de 5 minutos.
                            </p>
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
                                                    {typeInfo.label}
                                                    {activity.subtipo && ` · ${activity.subtipoDescripcion || CAPACITACION_SUBTIPOS[activity.subtipo] || activity.subtipo}`}
                                                    {' • '}{activity.horaInicio}
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
                                                    {canSelfSign && !activity.asistentes.some(a => a.workerId === user?.personaId) && (
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
                                    <th>Fecha</th>
                                    <th>Hora</th>
                                    <th>Actividad</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filteredActivities.length === 0 ? (
                                    <tr>
                                        <td colSpan={3}>
                                            <div className="text-sm text-muted" style={{ padding: 'var(--space-4)', textAlign: 'center' }}>
                                                No hay actividades registradas para esta obra.
                                            </div>
                                        </td>
                                    </tr>
                                ) : filteredActivities.slice(0, 10).map((activity) => (
                                    <tr
                                        key={activity.activityId}
                                        style={{ cursor: 'pointer' }}
                                        onClick={() => openDetailModal(activity)}
                                    >
                                        <td>{new Date(activity.fecha).toLocaleDateString('es-CL')}</td>
                                        <td>
                                            {activity.horaInicio}
                                            {activity.horaFin && ` - ${activity.horaFin}`}
                                        </td>
                                        <td>
                                            <div className="font-bold">{activity.titulo}</div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>

                </>}

                {/* Create Activity Modal */}
                <Modal
                    isOpen={showModal}
                    onClose={() => !submitting && setShowModal(false)}
                    preventClose={submitting}
                    title="Nueva Actividad"
                    footer={
                        <>
                            <button type="button" className="btn btn-secondary" disabled={submitting} onClick={() => setShowModal(false)}>Cancelar</button>
                            <button type="submit" form="create-activity-form" className="btn btn-primary" disabled={submitting}>
                                {submitting ? 'Creando…' : 'Crear Actividad'}
                            </button>
                        </>
                    }
                >
                    <form id="create-activity-form" onSubmit={handleCreateActivity}>
                        <div className="form-group">
                            <label className="form-label">Tipo de Actividad *</label>
                            <Select
                                ariaLabel="Tipo de actividad"
                                value={newActivity.tipo}
                                onChange={(v) => setNewActivity({ ...newActivity, tipo: v })}
                                options={Object.entries(ACTIVITY_TYPES).map(([key, { label, icon }]) => ({
                                    value: key,
                                    label,
                                    icon,
                                }))}
                            />
                        </div>

                        {newActivity.tipo === 'CAPACITACION' && (
                            <div className="form-group">
                                <label className="form-label">Tipo de capacitación (DS44) *</label>
                                <Select
                                    ariaLabel="Tipo de capacitación DS44"
                                    placeholder="Seleccione el tipo de capacitación"
                                    searchable
                                    value={newActivity.subtipo}
                                    onChange={(v) => setNewActivity({ ...newActivity, subtipo: v })}
                                    options={Object.entries(CAPACITACION_SUBTIPOS).map(([key, label]) => ({
                                        value: key,
                                        label,
                                    }))}
                                />
                            </div>
                        )}

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
                            <Select
                                ariaLabel="Relator"
                                placeholder="Seleccione un relator"
                                searchable
                                value={newActivity.relatorId}
                                onChange={(v) => setNewActivity({ ...newActivity, relatorId: v })}
                                options={workers.map((worker) => ({
                                    value: worker.personaId,
                                    label: `${worker.nombre} ${worker.apellido}`,
                                    description: worker.cargo,
                                }))}
                            />
                        </div>

                        <div className="form-group">
                            <label className="form-label">Fecha *</label>
                            <input
                                type="date"
                                value={newActivity.fecha}
                                onChange={(e) => setNewActivity({ ...newActivity, fecha: e.target.value })}
                                className="form-input"
                                required
                            />
                        </div>

                        <div className="grid grid-cols-2" style={{ gap: 'var(--space-4)' }}>
                            <div className="form-group">
                                <label className="form-label">Hora inicio *</label>
                                <input
                                    type="time"
                                    value={newActivity.horaInicio}
                                    onChange={(e) => setNewActivity({ ...newActivity, horaInicio: e.target.value })}
                                    className="form-input"
                                    required
                                />
                            </div>
                            <div className="form-group">
                                <label className="form-label">Hora fin</label>
                                <input
                                    type="time"
                                    value={newActivity.horaFin}
                                    onChange={(e) => setNewActivity({ ...newActivity, horaFin: e.target.value })}
                                    className="form-input"
                                />
                            </div>
                        </div>

                        <div className="form-group">
                            <label className="form-label">Ubicación</label>
                            <input
                                type="text"
                                value={newActivity.ubicacion}
                                onChange={(e) => setNewActivity({ ...newActivity, ubicacion: e.target.value })}
                                className="form-input"
                                placeholder="Ej: Frente de obra, sala de charlas..."
                            />
                        </div>

                        <div className="form-group">
                            <label className="form-label">
                                Asistentes requeridos
                                {newActivity.asistentesRequeridos.length > 0 && ` (${newActivity.asistentesRequeridos.length})`}
                            </label>
                            {workers.length === 0 ? (
                                <div className="text-sm text-muted">No hay trabajadores asignados a esta obra.</div>
                            ) : (
                                <div className="flex flex-col gap-2" style={{ maxHeight: '220px', overflowY: 'auto' }}>
                                    {workers.map((worker) => {
                                        const isSelected = newActivity.asistentesRequeridos.includes(worker.personaId);
                                        return (
                                            <div
                                                key={worker.personaId}
                                                className="flex items-center justify-between cursor-pointer"
                                                style={{
                                                    padding: 'var(--space-2) var(--space-3)',
                                                    background: isSelected ? 'rgba(76, 175, 80, 0.1)' : 'var(--surface-elevated)',
                                                    borderRadius: 'var(--radius-md)',
                                                    border: isSelected ? '1px solid var(--primary-500)' : '1px solid transparent',
                                                }}
                                                onClick={() => toggleRequiredAttendee(worker.personaId)}
                                            >
                                                <div className="flex items-center gap-3">
                                                    <div className="avatar avatar-sm">{worker.nombre.charAt(0)}</div>
                                                    <div>
                                                        <div className="font-bold">{worker.nombre} {worker.apellido}</div>
                                                        <div className="text-sm text-muted">{worker.cargo}</div>
                                                    </div>
                                                </div>
                                                <div style={{ width: '22px', height: '22px', borderRadius: '4px', border: '2px solid var(--surface-border)', background: isSelected ? 'var(--primary-500)' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                                    {isSelected && <FiCheck style={{ color: 'white' }} />}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    </form>
                </Modal>

                {/* Attendance Modal */}
                <Modal
                    isOpen={showAttendanceModal && !!selectedActivity}
                    onClose={() => setShowAttendanceModal(false)}
                    title="Registrar Asistencia"
                    subtitle={selectedActivity?.titulo}
                    size="lg"
                    footer={
                        <>
                            <button type="button" className="btn btn-secondary" onClick={() => setShowAttendanceModal(false)}>Cancelar</button>
                            <button
                                className="btn btn-primary"
                                disabled={selectedWorkers.length === 0}
                                onClick={() => setShowSignatureModal(true)}
                            >
                                <FiCheck />
                                Firmar y Registrar {selectedWorkers.length} Asistencia(s)
                            </button>
                        </>
                    }
                >
                    {selectedActivity && (
                        <>
                            <div className="flex justify-between items-center mb-4">
                                <span className="font-bold">Seleccionar Trabajadores</span>
                                <button className="btn btn-secondary btn-sm" onClick={selectAllWorkers}>
                                    {selectedWorkers.length === workers.length ? 'Deseleccionar todos' : 'Seleccionar todos'}
                                </button>
                            </div>

                            <div className="flex flex-col gap-2" style={{ maxHeight: '300px', overflowY: 'auto' }}>
                                {workers.map((worker) => {
                                    const isSelected = selectedWorkers.includes(worker.personaId);
                                    const alreadyAttended = selectedActivity.asistentes.some(a => a.workerId === worker.personaId);
                                    return (
                                        <div
                                            key={worker.personaId}
                                            className={`flex items-center justify-between ${alreadyAttended ? '' : 'cursor-pointer'}`}
                                            style={{
                                                padding: 'var(--space-3)',
                                                background: isSelected ? 'rgba(76, 175, 80, 0.1)' : 'var(--surface-elevated)',
                                                borderRadius: 'var(--radius-md)',
                                                border: isSelected ? '1px solid var(--primary-500)' : '1px solid transparent',
                                                opacity: alreadyAttended ? 0.5 : 1
                                            }}
                                            onClick={() => !alreadyAttended && toggleWorkerSelection(worker.personaId)}
                                        >
                                            <div className="flex items-center gap-3">
                                                <div className="avatar avatar-sm">{worker.nombre.charAt(0)}</div>
                                                <div>
                                                    <div className="font-bold">{worker.nombre} {worker.apellido}</div>
                                                    <div className="text-sm text-muted">{worker.cargo}</div>
                                                </div>
                                            </div>
                                            {alreadyAttended ? (
                                                <span className="badge badge-success">Ya registrado</span>
                                            ) : (
                                                <div style={{ width: '24px', height: '24px', borderRadius: '4px', border: '2px solid var(--surface-border)', background: isSelected ? 'var(--primary-500)' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
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
                        </>
                    )}
                </Modal>

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

                {/* Activity Detail Modal */}
                <Modal
                    isOpen={showDetailModal && !!detailActivity}
                    onClose={() => setShowDetailModal(false)}
                    title="Detalle de la Actividad"
                    subtitle={detailActivity?.titulo}
                    size="lg"
                >
                    {detailActivity && (() => {
                        const typeInfo = ACTIVITY_TYPES[detailActivity.tipo] || {
                            label: detailActivity.tipoDescripcion || detailActivity.tipo,
                            color: 'var(--gray-500)',
                            icon: <FiFileText />,
                        };
                        const requeridos = (detailActivity.asistentesRequeridos || [])
                            .map(id => workers.find(w => w.personaId === id))
                            .filter(Boolean) as Worker[];

                        return (
                            <div className="flex flex-col gap-4">
                                <div className="flex items-center gap-3">
                                    <div className="avatar" style={{ background: typeInfo.color, fontSize: '1.2rem' }}>
                                        {typeInfo.icon}
                                    </div>
                                    <div>
                                        <div className="font-bold">{detailActivity.titulo}</div>
                                        <div className="text-sm text-muted">
                                            {typeInfo.label}
                                            {detailActivity.subtipo && ` · ${detailActivity.subtipoDescripcion || CAPACITACION_SUBTIPOS[detailActivity.subtipo] || detailActivity.subtipo}`}
                                        </div>
                                    </div>
                                </div>

                                <div className="grid grid-cols-2" style={{ gap: 'var(--space-3)' }}>
                                    <div>
                                        <div className="text-xs text-muted">Fecha</div>
                                        <div className="font-bold">{new Date(detailActivity.fecha).toLocaleDateString('es-CL')}</div>
                                    </div>
                                    <div>
                                        <div className="text-xs text-muted">Horario</div>
                                        <div className="font-bold">
                                            {detailActivity.horaInicio}
                                            {detailActivity.horaFin && ` - ${detailActivity.horaFin}`}
                                        </div>
                                    </div>
                                    <div>
                                        <div className="text-xs text-muted">Estado</div>
                                        <span className={`badge badge-${detailActivity.estado === 'completada' ? 'success' :
                                            detailActivity.estado === 'cancelada' ? 'danger' :
                                                detailActivity.estado === 'programada' ? 'neutral' : 'warning'}`}>
                                            {detailActivity.estado}
                                        </span>
                                    </div>
                                    {detailActivity.ubicacion && (
                                        <div>
                                            <div className="text-xs text-muted">Ubicación</div>
                                            <div className="font-bold">{detailActivity.ubicacion}</div>
                                        </div>
                                    )}
                                </div>

                                {detailActivity.descripcion && (
                                    <div>
                                        <div className="text-xs text-muted">Descripción</div>
                                        <div>{detailActivity.descripcion}</div>
                                    </div>
                                )}

                                {requeridos.length > 0 && (
                                    <div>
                                        <div className="text-xs text-muted mb-2">Asistentes requeridos ({requeridos.length})</div>
                                        <div className="flex flex-col gap-2">
                                            {requeridos.map(w => (
                                                <div key={w.personaId} className="flex items-center gap-3">
                                                    <div className="avatar avatar-sm">{w.nombre.charAt(0)}</div>
                                                    <div>
                                                        <div className="font-bold">{w.nombre} {w.apellido}</div>
                                                        <div className="text-sm text-muted">{w.cargo}</div>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                <div>
                                    <div className="text-xs text-muted mb-2 flex items-center gap-1">
                                        <FiUsers /> Asistencia registrada ({detailActivity.asistentes.length})
                                    </div>
                                    {detailActivity.asistentes.length === 0 ? (
                                        <div className="text-sm text-muted">Aún no hay asistencias firmadas.</div>
                                    ) : (
                                        <div className="flex flex-col gap-2">
                                            {detailActivity.asistentes.map((a, i) => (
                                                <div key={(a as any).workerId || (a as any).personaId || i} className="flex items-center justify-between">
                                                    <div className="flex items-center gap-3">
                                                        <div className="avatar avatar-sm">{a.nombre.charAt(0)}</div>
                                                        <div>
                                                            <div className="font-bold">{a.nombre}</div>
                                                            <div className="text-sm text-muted">{a.cargo || a.rut}</div>
                                                        </div>
                                                    </div>
                                                    <span className="badge badge-success">Firmado</span>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>
                        );
                    })()}
                </Modal>
            </div>
        </>
    );
}
