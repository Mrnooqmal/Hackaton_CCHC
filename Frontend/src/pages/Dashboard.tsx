import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Header from '../components/Header';
import {
    FiUsers,
    FiFileText,
    FiCalendar,
    FiAlertTriangle,
    FiPlus,
    FiArrowRight,
    FiCheckSquare,
    FiAlertCircle,
    FiEdit3,
    FiShield,
    FiBell
} from 'react-icons/fi';
import { workersApi, activitiesApi, surveysApi, inboxApi, documentsApi, incidentsApi, signatureRequestsApi } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useObraContext } from '../context/ObraContext';
import type { Worker, Activity } from '../api/client';

interface PendingTask {
    id: string;
    type: 'document' | 'activity' | 'survey' | 'signature';
    title: string;
    description: string;
    dueDate?: string;
    priority: 'high' | 'normal' | 'low';
    urgent?: boolean;
}

interface DashboardStats {
    totalWorkers?: number;
    pendingSignatures?: number;
    ownPendingSignatures?: number;
    workersPendingSignatures?: number;
    activitiesToday?: number;
    pendingIncidents?: number;
    unreadMessages?: number;
    pendingSurveys?: number;
    totalDocuments?: number;
}

export default function Dashboard() {
    const { user } = useAuth();
    const { obras, selectedObraId } = useObraContext();
    const navigate = useNavigate();
    const [workers, setWorkers] = useState<Worker[]>([]);
    const [stats, setStats] = useState<DashboardStats>({});
    const [pendings, setPendings] = useState<PendingTask[]>([]);
    const [recentActivities, setRecentActivities] = useState<Activity[]>([]);
    const [loading, setLoading] = useState(true);
    const [progressPercentage, setProgressPercentage] = useState(0);

    useEffect(() => {
        loadDashboardData();
    }, [user, selectedObraId]);

    const loadDashboardData = async () => {
        if (!user) return;

        setLoading(true);
        try {
            // Load data based on role
            if (user.rol === 'trabajador') {
                await loadWorkerDashboard();
            } else if (user.rol === 'prevencionista') {
                await loadPrevencionistaDashboard();
            } else if (user.rol === 'admin') {
                await loadAdminDashboard();
            }
        } catch (error) {
            console.error('Error loading dashboard:', error);
        } finally {
            setLoading(false);
        }
    };

    const loadWorkerDashboard = async () => {
        const pendingTasks: PendingTask[] = [];
        let completedCount = 0;
        let totalRequiredCount = 7; // Base requirements

        // Check enrollment status
        if (user?.habilitado) {
            completedCount++;
        } else {
            pendingTasks.push({
                id: 'enroll',
                type: 'signature',
                title: 'Completar Enrolamiento',
                description: 'Crea tu PIN de firma digital',
                priority: 'high',
                urgent: true
            });
        }

        const [surveysRes, inboxRes] = await Promise.allSettled([
            surveysApi.list(),
            user?.userId ? inboxApi.getUnreadCount(user.userId) : Promise.resolve(null),
        ]);

        if (surveysRes.status === 'fulfilled') {
            const data = surveysRes.value;
            if (data?.success && data.data?.surveys && user?.workerId) {
                const mySurveys = data.data.surveys.filter(s =>
                    s.recipients?.some(r => r.workerId === user.workerId && r.estado !== 'respondida')
                );

                mySurveys.forEach(survey => {
                    pendingTasks.push({
                        id: survey.surveyId,
                        type: 'survey',
                        title: `Encuesta: ${survey.titulo}`,
                        description: survey.descripcion || 'Responde esta encuesta',
                        priority: 'normal'
                    });
                });

                const completedSurveys = data.data.surveys.filter(s =>
                    s.recipients?.some(r => r.workerId === user.workerId && r.estado === 'respondida')
                ).length;

                completedCount += completedSurveys;
            }
        } else {
            console.error('Error loading surveys:', surveysRes.reason);
        }

        if (inboxRes.status === 'fulfilled') {
            const data = inboxRes.value;
            if (data?.success && data.data) {
                setStats(s => ({ ...s, unreadMessages: data.data?.unreadCount || 0 }));
            }
        } else if (inboxRes.status === 'rejected') {
            console.error('Error loading inbox:', inboxRes.reason);
        }

        // Calculate progress
        const progress = totalRequiredCount > 0 ? Math.round((completedCount / totalRequiredCount) * 100) : 0;
        setProgressPercentage(progress);

        // Sort by urgency and priority
        pendingTasks.sort((a, b) => {
            if (a.urgent && !b.urgent) return -1;
            if (!a.urgent && b.urgent) return 1;
            const priorityOrder = { high: 0, normal: 1, low: 2 };
            return priorityOrder[a.priority] - priorityOrder[b.priority];
        });

        setPendings(pendingTasks);
        setStats(s => ({ ...s, pendingSurveys: pendingTasks.filter(p => p.type === 'survey').length }));
    };

    const loadPrevencionistaDashboard = async () => {
        const [workersRes, ownPendingRes, sigStatsRes, docsRes, incidentsRes, activitiesRes] = await Promise.allSettled([
            workersApi.list({ obraId: selectedObraId || undefined }),
            user?.workerId ? signatureRequestsApi.getPendingByWorker(user.workerId) : Promise.resolve(null),
            signatureRequestsApi.getStats(),
            documentsApi.list({ obraId: selectedObraId || undefined }),
            incidentsApi.list(),
            activitiesApi.list({ obraId: selectedObraId || undefined }),
        ]);

        const nextStats: DashboardStats = {};

        if (workersRes.status === 'fulfilled') {
            const data = workersRes.value;
            if (data?.success && data.data) {
                setWorkers(data.data);
                const unenrolled = data.data.filter((w: any) => !w.habilitado).length;
                nextStats.totalWorkers = data.data?.length || 0;
                nextStats.pendingSignatures = unenrolled;
            }
        } else {
            console.error('Error loading workers:', workersRes.reason);
        }

        if (ownPendingRes.status === 'fulfilled') {
            const data = ownPendingRes.value;
            if (data?.success && data.data) {
                nextStats.ownPendingSignatures = data.data?.total || 0;
            }
        } else if (ownPendingRes.status === 'rejected') {
            console.error('Error loading own pending signatures:', ownPendingRes.reason);
        }

        if (sigStatsRes.status === 'fulfilled') {
            const data = sigStatsRes.value;
            if (data?.success && data.data) {
                const totalPendingFirmas = data.data.totalFirmasRequeridas - data.data.totalFirmasObtenidas;
                nextStats.workersPendingSignatures = Math.max(0, totalPendingFirmas);
            }
        } else {
            console.error('Error loading workers pending signatures:', sigStatsRes.reason);
        }

        if (docsRes.status === 'fulfilled') {
            const data = docsRes.value;
            if (data?.success && data.data) {
                nextStats.totalDocuments = data.data?.documents.length || 0;
            }
        } else {
            console.error('Error loading documents:', docsRes.reason);
        }

        if (incidentsRes.status === 'fulfilled') {
            const data = incidentsRes.value;
            if (data?.success && data.data) {
                const pending = data.data.filter(i => i.estado === 'reportado' || i.estado === 'en_investigacion').length;
                nextStats.pendingIncidents = pending;
            }
        } else {
            console.error('Error loading incidents:', incidentsRes.reason);
        }

        if (activitiesRes.status === 'fulfilled') {
            const data = activitiesRes.value;
            if (data?.success && data.data) {
                const recent = data.data.activities.slice(0, 5);
                setRecentActivities(recent);

                const today = new Date().toISOString().split('T')[0];
                const todayActivities = data.data.activities.filter(a => a.fecha === today).length;
                nextStats.activitiesToday = todayActivities;
            }
        } else {
            console.error('Error loading activities:', activitiesRes.reason);
        }

        setStats(s => ({ ...s, ...nextStats }));
    };

    const loadAdminDashboard = async () => {
        const [workersRes, activitiesRes, docsRes, incidentsRes] = await Promise.allSettled([
            workersApi.list({ obraId: selectedObraId || undefined }),
            activitiesApi.list({ obraId: selectedObraId || undefined }),
            documentsApi.list({ obraId: selectedObraId || undefined }),
            incidentsApi.list(),
        ]);

        const nextStats: DashboardStats = {};

        if (workersRes.status === 'fulfilled') {
            const data = workersRes.value;
            if (data?.success && data.data) {
                setWorkers(data.data);
                nextStats.totalWorkers = data.data?.length || 0;
            }
        } else {
            console.error('Error loading workers:', workersRes.reason);
        }

        if (activitiesRes.status === 'fulfilled') {
            const data = activitiesRes.value;
            if (data?.success && data.data) {
                nextStats.activitiesToday = data.data?.activities.length || 0;
            }
        } else {
            console.error('Error loading activities:', activitiesRes.reason);
        }

        if (docsRes.status === 'fulfilled') {
            const data = docsRes.value;
            if (data?.success && data.data) {
                nextStats.totalDocuments = data.data?.documents.length || 0;
            }
        } else {
            console.error('Error loading documents:', docsRes.reason);
        }

        if (incidentsRes.status === 'fulfilled') {
            const data = incidentsRes.value;
            if (data?.success && data.data) {
                nextStats.pendingIncidents = data.data?.length || 0;
            }
        } else {
            console.error('Error loading incidents:', incidentsRes.reason);
        }

        setStats(s => ({ ...s, ...nextStats }));
    };

    const getUrgentTasks = () => pendings.filter(p => p.urgent || p.priority === 'high');

    if (loading) {
        return (
            <div className="flex items-center justify-center" style={{ height: '100vh' }}>
                <div className="spinner" />
            </div>
        );
    }

    return (
        <>
            <Header title="Dashboard" />

            <div className="page-content">
                {/* Welcome Header */}
                <div className="mb-6">
                    <h1 className="text-2xl font-bold mb-1">
                        Bienvenido, {user?.nombre} {user?.apellido}
                    </h1>
                    <p className="text-muted flex items-center gap-2">
                        <FiShield size={16} />
                        {user?.rol === 'admin' && 'Administrador'}
                        {user?.rol === 'prevencionista' && 'Prevencionista'}
                        {user?.rol === 'trabajador' && 'Trabajador'}
                    </p>
                </div>

                {/* TRABAJADOR VIEW */}
                {user?.rol === 'trabajador' && (
                    <>
                        {/* Urgent Tasks Alert */}
                        {getUrgentTasks().length > 0 && (
                            <div className="alert alert-warning mb-6">
                                <FiAlertCircle />
                                <div>
                                    <strong>Requieren tu atención urgente</strong>
                                    <div className="text-sm mt-1">
                                        {getUrgentTasks().length} tarea(s) pendiente(s)
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Progress Card */}
                        <div className="card mb-6">
                            <h3 className="card-title mb-4">Tu Progreso de Cumplimiento</h3>
                            <div className="flex items-center gap-4">
                                <div className="progress-ring">
                                    <svg width="120" height="120">
                                        <circle
                                            cx="60"
                                            cy="60"
                                            r="54"
                                            fill="none"
                                            stroke="var(--surface-border)"
                                            strokeWidth="8"
                                        />
                                        <circle
                                            cx="60"
                                            cy="60"
                                            r="54"
                                            fill="none"
                                            stroke="var(--primary-500)"
                                            strokeWidth="8"
                                            strokeDasharray={`${progressPercentage * 3.39} 339`}
                                            strokeLinecap="round"
                                            transform="rotate(-90 60 60)"
                                        />
                                        <text
                                            x="60"
                                            y="60"
                                            textAnchor="middle"
                                            dy="7"
                                            fontSize="24"
                                            fontWeight="bold"
                                            fill="var(--text-primary)"
                                        >
                                            {progressPercentage}%
                                        </text>
                                    </svg>
                                </div>
                                <div className="flex-1">
                                    <div className="text-lg font-bold mb-2">
                                        {progressPercentage}% Completado
                                    </div>
                                    <div className="progress">
                                        <div
                                            className="progress-bar"
                                            style={{ width: `${progressPercentage}%` }}
                                        />
                                    </div>
                                    <div className="text-sm text-muted mt-2">
                                        {pendings.length} tarea(s) pendiente(s)
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Pending Tasks */}
                        <div className="card">
                            <div className="card-header">
                                <h3 className="card-title">Mis Pendientes</h3>
                                {stats.unreadMessages! > 0 && (
                                    <Link to="/inbox" className="btn btn-sm btn-secondary">
                                        <FiBell /> {stats.unreadMessages} Notificaciones
                                    </Link>
                                )}
                            </div>
                            {pendings.length === 0 ? (
                                <div className="empty-state">
                                    <FiCheckSquare size={48} className="empty-state-icon" style={{ color: 'var(--success-500)' }} />
                                    <h3 className="empty-state-title">¡Todo al día!</h3>
                                    <p className="empty-state-description">
                                        No tienes tareas pendientes en este momento.
                                    </p>
                                </div>
                            ) : (
                                <div className="flex flex-col gap-3">
                                    {pendings.map(task => (
                                        <div
                                            key={task.id}
                                            className={`pending-task-card ${task.urgent ? 'urgent' : ''}`}
                                            onClick={() => {
                                                if (task.type === 'survey') navigate('/surveys');
                                                else if (task.type === 'signature') navigate('/enroll-me');
                                            }}
                                        >
                                            <div className="flex items-start gap-3">
                                                <div className={`avatar avatar-sm priority-${task.priority}`}>
                                                    {task.type === 'survey' && <FiFileText />}
                                                    {task.type === 'signature' && <FiEdit3 />}
                                                    {task.type === 'activity' && <FiCalendar />}
                                                    {task.type === 'document' && <FiCheckSquare />}
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <div className="font-bold">{task.title}</div>
                                                    <div className="text-sm text-muted">{task.description}</div>
                                                </div>
                                                <FiArrowRight className="text-muted flex-shrink-0" />
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </>
                )}

                {/* PREVENCIONISTA VIEW */}
                {user?.rol === 'prevencionista' && (
                    <>
                        {/* Stats Grid */}
                        <div className="grid grid-cols-4 mb-6">
                            <div className="card stat-card">
                                <div className="flex items-center gap-3 mb-1">
                                    <div className="avatar avatar-sm" style={{ background: 'var(--primary-500)' }}>
                                        <FiUsers />
                                    </div>
                                    <span className="text-xs text-muted">Trabajadores</span>
                                </div>
                                <div className="stat-value">{stats.totalWorkers || 0}</div>
                                <div className="stat-change">
                                    {stats.pendingSignatures || 0} sin enrolar
                                </div>
                            </div>

                            <div className="card stat-card">
                                <div className="flex items-center gap-3 mb-1">
                                    <div className="avatar avatar-sm" style={{ background: 'var(--success-500)' }}>
                                        <FiCalendar />
                                    </div>
                                    <span className="text-xs text-muted">Actividades Hoy</span>
                                </div>
                                <div className="stat-value">{stats.activitiesToday || 0}</div>
                            </div>

                            <div className="card stat-card">
                                <div className="flex items-center gap-3 mb-1">
                                    <div className="avatar avatar-sm" style={{ background: 'var(--warning-500)' }}>
                                        <FiEdit3 />
                                    </div>
                                    <span className="text-xs text-muted">Mis Firmas Pendientes</span>
                                </div>
                                <div className="stat-value">{stats.ownPendingSignatures || 0}</div>
                                <div className="stat-change" style={{ color: 'var(--warning-500)' }}>
                                    Tus propias firmas
                                </div>
                            </div>

                            <div className="card stat-card">
                                <div className="flex items-center gap-3 mb-1">
                                    <div className="avatar avatar-sm" style={{ background: 'var(--danger-500)' }}>
                                        <FiAlertTriangle />
                                    </div>
                                    <span className="text-xs text-muted">Incidentes</span>
                                </div>
                                <div className="stat-value">{stats.pendingIncidents || 0}</div>
                            </div>
                        </div>

                        {/* Workers Signatures Banner */}
                        <div className="card mb-6" style={{
                            background: 'linear-gradient(135deg, rgba(234, 179, 8, 0.08), rgba(234, 179, 8, 0.02))',
                            border: '1px solid rgba(234, 179, 8, 0.25)',
                            padding: 'var(--space-5)',
                        }}>
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-4">
                                    <div className="avatar" style={{
                                        background: 'linear-gradient(135deg, var(--warning-500), var(--warning-600))',
                                        width: '52px',
                                        height: '52px',
                                        boxShadow: '0 4px 12px rgba(234, 179, 8, 0.3)',
                                    }}>
                                        <FiEdit3 size={22} />
                                    </div>
                                    <div>
                                        <div className="text-sm text-muted" style={{ marginBottom: '4px' }}>Firmas Pendientes de Trabajadores</div>
                                        <div style={{ fontSize: 'var(--text-2xl)', fontWeight: 700, color: 'var(--warning-600)' }}>
                                            {stats.workersPendingSignatures || 0}
                                        </div>
                                        <div className="text-sm text-muted" style={{ marginTop: '2px' }}>firmas pendientes en total de todos los trabajadores asignados</div>
                                    </div>
                                </div>
                                <Link to="/signature-requests" className="btn btn-secondary btn-sm" style={{ flexShrink: 0 }}>
                                    Ver Solicitudes <FiArrowRight />
                                </Link>
                            </div>
                        </div>

                        {/* Actions Grid */}
                        <div className="dashboard-main-grid">
                            {/* Recent Activities */}
                            <div className="card">
                                <div className="card-header">
                                    <div>
                                        <h2 className="card-title">Actividades Recientes</h2>
                                        <p className="card-subtitle">Últimas actividades creadas</p>
                                    </div>
                                    <Link to="/activities" className="btn btn-primary btn-sm">
                                        <FiPlus /> Nueva
                                    </Link>
                                </div>

                                {recentActivities.length === 0 ? (
                                    <div className="empty-state">
                                        <FiCalendar size={36} className="mb-3 opacity-20" />
                                        <p>No hay actividades recientes</p>
                                    </div>
                                ) : (
                                    <div className="flex flex-col gap-3">
                                        {recentActivities.map((activity) => (
                                            <div
                                                key={activity.activityId}
                                                className="flex items-center justify-between"
                                                style={{
                                                    padding: 'var(--space-3)',
                                                    background: 'var(--surface-elevated)',
                                                    borderRadius: 'var(--radius-md)'
                                                }}
                                            >
                                                <div className="flex items-center gap-3">
                                                    <div className="avatar avatar-sm" style={{ background: 'var(--primary-500)' }}>
                                                        <FiCalendar />
                                                    </div>
                                                    <div>
                                                        <div className="font-bold">{activity.titulo}</div>
                                                        <div className="text-sm text-muted">{activity.fecha}</div>
                                                    </div>
                                                </div>
                                                <span className="badge badge-secondary">
                                                    {activity.tipo}
                                                </span>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>

                            {/* Quick Actions */}
                            <div className="card">
                                <h2 className="card-title mb-4">Acciones Rápidas</h2>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                                    <Link to="/workers/enroll" className="btn btn-primary" style={{ width: '100%', justifyContent: 'flex-start' }}>
                                        <FiUsers /> Enrolar Trabajador
                                    </Link>
                                    <Link to="/activities" className="btn btn-secondary" style={{ width: '100%', justifyContent: 'flex-start' }}>
                                        <FiCalendar /> Nueva Actividad
                                    </Link>
                                    <Link to="/signature-requests" className="btn btn-secondary" style={{ width: '100%', justifyContent: 'flex-start' }}>
                                        <FiEdit3 /> Solicitud de Firma
                                    </Link>
                                    <Link to="/incidents" className="btn btn-secondary" style={{ width: '100%', justifyContent: 'flex-start' }}>
                                        <FiAlertTriangle /> Ver Incidentes
                                    </Link>
                                </div>
                            </div>
                        </div>
                    </>
                )}

                {/* ADMIN VIEW */}
                {user?.rol === 'admin' && (
                    <>
                        <div className="grid grid-cols-4 mb-6">
                            <div className="card stat-card">
                                <div className="flex items-center gap-3 mb-1">
                                    <div className="avatar avatar-sm" style={{ background: 'var(--primary-500)' }}>
                                        <FiUsers />
                                    </div>
                                    <span className="text-xs text-muted">Trabajadores</span>
                                </div>
                                <div className="stat-value">{stats.totalWorkers || 0}</div>
                            </div>

                            <div className="card stat-card">
                                <div className="flex items-center gap-3 mb-1">
                                    <div className="avatar avatar-sm" style={{ background: 'var(--success-500)' }}>
                                        <FiCalendar />
                                    </div>
                                    <span className="text-xs text-muted">Actividades</span>
                                </div>
                                <div className="stat-value">{stats.activitiesToday || 0}</div>
                            </div>

                            <div className="card stat-card">
                                <div className="flex items-center gap-3 mb-1">
                                    <div className="avatar avatar-sm" style={{ background: 'var(--info-500)' }}>
                                        <FiFileText />
                                    </div>
                                    <span className="text-xs text-muted">Documentos</span>
                                </div>
                                <div className="stat-value">{stats.totalDocuments || 0}</div>
                            </div>

                            <div className="card stat-card">
                                <div className="flex items-center gap-3 mb-1">
                                    <div className="avatar avatar-sm" style={{ background: 'var(--danger-500)' }}>
                                        <FiAlertTriangle />
                                    </div>
                                    <span className="text-xs text-muted">Incidentes</span>
                                </div>
                                <div className="stat-value">{stats.pendingIncidents || 0}</div>
                            </div>
                        </div>

                        {/* Obras Cards instead of Recent Workers */}
                        <div className="card">
                            <div className="card-header">
                                <div>
                                    <h2 className="card-title">Resumen de Obras</h2>
                                    <p className="card-subtitle">
                                        {selectedObraId ? 'Detalles de la obra seleccionada' : 'Tus obras activas en la plataforma'}
                                    </p>
                                </div>
                                <Link to="/obras" className="btn btn-secondary btn-sm">
                                    Ver todas las obras
                                </Link>
                            </div>

                            {obras.length === 0 ? (
                                <div className="empty-state">
                                    <FiAlertTriangle size={48} className="empty-state-icon" style={{ color: 'var(--warning-500)' }} />
                                    <h3 className="empty-state-title">No tienes obras creadas</h3>
                                    <p className="empty-state-description">
                                        1. Crea tu primera Obra.<br/>
                                        2. Enrola trabajadores y asígnalos.<br/>
                                        3. Sube los documentos para comenzar.
                                    </p>
                                    <Link to="/obras" className="btn btn-primary mt-4">
                                        <FiPlus /> Crear Obra
                                    </Link>
                                </div>
                            ) : (
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 'var(--space-4)' }}>
                                    {(selectedObraId ? obras.filter(o => o.obraId === selectedObraId) : obras).map((obra) => {
                                        const totalDocs = obra.fasesConfig?.[obra.etapaActual]?.length || 0;
                                        // Mock compliance logic for now
                                        const completedDocs = Math.floor(Math.random() * (totalDocs + 1)); 
                                        const progress = totalDocs > 0 ? Math.round((completedDocs / totalDocs) * 100) : 100;
                                        
                                        return (
                                            <div key={obra.obraId} className="card" style={{ padding: 'var(--space-4)', border: '1px solid var(--surface-border)' }}>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 'var(--space-3)' }}>
                                                    <div>
                                                        <h3 className="font-bold text-lg">{obra.nombre}</h3>
                                                        <span className="badge badge-secondary">{obra.etapaActual}</span>
                                                    </div>
                                                    <span className={`badge badge-${obra.estado === 'activa' ? 'success' : 'warning'}`}>
                                                        {obra.estado}
                                                    </span>
                                                </div>
                                                <div style={{ marginBottom: 'var(--space-4)' }}>
                                                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 'var(--space-1)' }}>
                                                        <span className="text-sm text-muted">Cumplimiento Fase Actual</span>
                                                        <span className="text-sm font-bold">{progress}%</span>
                                                    </div>
                                                    <div className="progress">
                                                        <div className="progress-bar" style={{ width: `${progress}%`, background: progress === 100 ? 'var(--success-500)' : 'var(--primary-500)' }} />
                                                    </div>
                                                    <div className="text-xs text-muted mt-1">
                                                        {completedDocs} de {totalDocs} documentos normativos listos
                                                    </div>
                                                </div>
                                                <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                                                    <Link to={`/obras/${obra.obraId}`} className="btn btn-secondary btn-sm" style={{ flex: 1, justifyContent: 'center' }}>
                                                        Gestionar Obra
                                                    </Link>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    </>
                )}
            </div>

            <style>{`
                .spinner {
                    width: 40px;
                    height: 40px;
                    border: 3px solid var(--surface-border);
                    border-top-color: var(--primary-500);
                    border-radius: 50%;
                    animation: spin 0.8s linear infinite;
                }

                @keyframes spin {
                    to { transform: rotate(360deg); }
                }

                .pending-task-card {
                    padding: var(--space-4);
                    background: var(--surface-elevated);
                    border-radius: var(--radius-md);
                    border: 1px solid var(--surface-border);
                    cursor: pointer;
                    transition: all 0.2s;
                }
                
                .pending-task-card:hover {
                    background: var(--surface-hover);
                    transform: translateY(-2px);
                    box-shadow: var(--shadow-md);
                }
                
                .pending-task-card.urgent {
                    border-left: 4px solid var(--danger-500);
                    background: rgba(var(--danger-rgb), 0.05);
                }
                
                .priority-high {
                    background: var(--danger-500) !important;
                }
                
                .priority-normal {
                    background: var(--primary-500) !important;
                }
                
                .priority-low {
                    background: var(--gray-500) !important;
                }
                
                .progress-ring {
                    flex-shrink: 0;
                }
            `}</style>
        </>
    );
}
