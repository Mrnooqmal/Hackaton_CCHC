import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Header from '../components/Header';
import {
    FiUsers,
    FiFileText,
    FiCalendar,
    FiAlertTriangle,
    FiTrendingUp,
    FiCheck,
    FiClock,
    FiPlus,
    FiArrowRight,
    FiCheckSquare,
    FiAlertCircle,
    FiEdit3,
    FiShield,
    FiBell
} from 'react-icons/fi';
import { workersApi, activitiesApi, surveysApi, inboxApi, signaturesApi } from '../api/client';
import { useAuth } from '../context/AuthContext';
import type { Worker, Activity, DigitalSignature } from '../api/client';

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
    activitiesToday?: number;
    pendingIncidents?: number;
    unreadMessages?: number;
    pendingSurveys?: number;
}

export default function Dashboard() {
    const { user } = useAuth();
    const navigate = useNavigate();
    const [workers, setWorkers] = useState<Worker[]>([]);
    const [stats, setStats] = useState<DashboardStats>({});
    const [pendings, setPendings] = useState<PendingTask[]>([]);
    const [recentActivities, setRecentActivities] = useState<Activity[]>([]);
    const [loading, setLoading] = useState(true);
    const [progressPercentage, setProgressPercentage] = useState(0);

    useEffect(() => {
        loadDashboardData();
    }, [user]);

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

        // Load pending surveys
        try {
            const surveysRes = await surveysApi.list();
            if (surveysRes.success && surveysRes.data?.surveys && user?.workerId) {
                const mySurveys = surveysRes.data.surveys.filter(s =>
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

                const completedSurveys = surveysRes.data.surveys.filter(s =>
                    s.recipients?.some(r => r.workerId === user.workerId && r.estado === 'respondida')
                ).length;

                completedCount += completedSurveys;
            }
        } catch (err) {
            console.error('Error loading surveys:', err);
        }

        // Load inbox unread
        try {
            if (user.userId) {
                const inboxRes = await inboxApi.getUnreadCount(user.userId);
                if (inboxRes.success && inboxRes.data) {
                    setStats(s => ({ ...s, unreadMessages: inboxRes.data?.unreadCount || 0 }));
                }
            }
        } catch (err) {
            console.error('Error loading inbox:', err);
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
        // Load workers stats
        try {
            const workersRes = await workersApi.list();
            if (workersRes.success && workersRes.data) {
                setWorkers(workersRes.data);
                const unenrolled = workersRes.data.filter(w => !w.habilitado).length;
                setStats(s => ({ ...s, totalWorkers: workersRes.data?.length || 0, pendingSignatures: unenrolled }));
            }
        } catch (err) {
            console.error('Error loading workers:', err);
        }

        // Load recent activities
        try {
            const activitiesRes = await activitiesApi.list();
            if (activitiesRes.success && activitiesRes.data) {
                const recent = activitiesRes.data.activities.slice(0, 5);
                setRecentActivities(recent);

                const today = new Date().toISOString().split('T')[0];
                const todayActivities = activitiesRes.data.activities.filter(a =>
                    a.fecha === today
                ).length;
                setStats(s => ({ ...s, activitiesToday: todayActivities }));
            }
        } catch (err) {
            console.error('Error loading activities:', err);
        }
    };

    const loadAdminDashboard = async () => {
        // Load global stats
        try {
            const workersRes = await workersApi.list();
            if (workersRes.success && workersRes.data) {
                setWorkers(workersRes.data);
                setStats(s => ({ ...s, totalWorkers: workersRes.data?.length || 0 }));
            }
        } catch (err) {
            console.error('Error loading workers:', err);
        }

        // Load activities
        try {
            const activitiesRes = await activitiesApi.list();
            if (activitiesRes.success && activitiesRes.data) {
                setStats(s => ({ ...s, activitiesToday: activitiesRes.data?.activities.length || 0 }));
            }
        } catch (err) {
            console.error('Error loading activities:', err);
        }
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
                                    <span className="text-xs text-muted">Firmas Pendientes</span>
                                </div>
                                <div className="stat-value">{stats.pendingSignatures || 0}</div>
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
                                <div className="stat-value">-</div>
                            </div>

                            <div className="card stat-card">
                                <div className="flex items-center gap-3 mb-1">
                                    <div className="avatar avatar-sm" style={{ background: 'var(--danger-500)' }}>
                                        <FiAlertTriangle />
                                    </div>
                                    <span className="text-xs text-muted">Incidentes</span>
                                </div>
                                <div className="stat-value">-</div>
                            </div>
                        </div>

                        {/* Recent Workers */}
                        <div className="card">
                            <div className="card-header">
                                <div>
                                    <h2 className="card-title">Trabajadores Recientes</h2>
                                    <p className="card-subtitle">Últimos trabajadores enrolados</p>
                                </div>
                                <Link to="/workers" className="btn btn-secondary btn-sm">
                                    Ver todos
                                </Link>
                            </div>

                            {workers.length === 0 ? (
                                <div className="empty-state">
                                    <FiUsers size={48} className="empty-state-icon" />
                                    <h3 className="empty-state-title">Sin trabajadores</h3>
                                    <p className="empty-state-description">
                                        Comienza enrolando tu primer trabajador.
                                    </p>
                                    <Link to="/workers/enroll" className="btn btn-primary">
                                        <FiPlus /> Enrolar Trabajador
                                    </Link>
                                </div>
                            ) : (
                                <>
                                    <div className="scroll-hint">
                                        <FiArrowRight />
                                        <span>Desliza para ver más</span>
                                    </div>
                                    <div className="table-container">
                                        <table className="table">
                                            <thead>
                                                <tr>
                                                    <th>Trabajador</th>
                                                    <th>RUT</th>
                                                    <th>Cargo</th>
                                                    <th>Fecha Enrolamiento</th>
                                                    <th>Estado</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {workers.slice(0, 5).map((worker) => (
                                                    <tr key={worker.workerId}>
                                                        <td>
                                                            <div className="flex items-center gap-3">
                                                                <div className="avatar avatar-sm">
                                                                    {worker.nombre.charAt(0)}
                                                                </div>
                                                                <span className="font-bold">{worker.nombre} {worker.apellido}</span>
                                                            </div>
                                                        </td>
                                                        <td>{worker.rut}</td>
                                                        <td>{worker.cargo}</td>
                                                        <td>{new Date(worker.fechaEnrolamiento).toLocaleDateString('es-CL')}</td>
                                                        <td>
                                                            <span className={`badge badge-${worker.habilitado ? 'success' : 'warning'}`}>
                                                                {worker.habilitado ? 'Habilitado' : 'Pendiente'}
                                                            </span>
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </>
                            )}
                        </div>
                    </>
                )}
            </div>

            <style>{`
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
