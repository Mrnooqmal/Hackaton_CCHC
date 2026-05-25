import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Header from '../components/Header';
import ObraProgressCard from '../components/ObraProgressCard';
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
    FiBell,
    FiMapPin
} from 'react-icons/fi';
import { workersApi, activitiesApi, surveysApi, inboxApi, documentsApi, incidentsApi, signatureRequestsApi } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useObraContext } from '../context/ObraContext';
import type { Worker, Activity, SignatureRequest } from '../api/client';
import { DS44_ONBOARDING_ITEMS, DS44_PLAN_DOCS } from '../utils/ds44';

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
    const { user, hasPermission } = useAuth();
    const { obras, selectedObraId } = useObraContext();
    const navigate = useNavigate();
    const [, setWorkers] = useState<Worker[]>([]);
    const [stats, setStats] = useState<DashboardStats>({});
    const [pendings, setPendings] = useState<PendingTask[]>([]);
    const [recentActivities, setRecentActivities] = useState<Activity[]>([]);
    const [loading, setLoading] = useState(true);
    const [progressPercentage, setProgressPercentage] = useState(0);
    const [obraProgress, setObraProgress] = useState<Record<string, { uploaded: number; total: number; progress: number; label?: string }>>({});
    const selectedObra = selectedObraId ? obras.find(o => o.obraId === selectedObraId) : null;
    const selectedObraProgress = selectedObra ? obraProgress[selectedObra.obraId] : null;

    useEffect(() => {
        const activeRef = { current: true };
        const loadDashboardData = async () => {
            if (!user) return;

            setLoading(true);
            try {
                if (user.rol === 'trabajador') {
                    await loadWorkerDashboard();
                } else if (user.rol === 'prevencionista') {
                    await loadPrevencionistaDashboard();
                } else if ((user.rol as string) === 'jefe_obra') {
                    await loadJefeObraDashboard();
                } else if ((user.rol as string) === 'supervisor') {
                    await loadSupervisorDashboard();
                } else if (user.rol === 'admin') {
                    await loadAdminDashboard();
                }
            } catch (error) {
                console.error('Error loading dashboard:', error);
            } finally {
                if (activeRef.current) {
                    setLoading(false);
                }
            }
        };

        loadDashboardData();
        return () => {
            activeRef.current = false;
        };
    }, [user, selectedObraId]);

    const buildDocStatusMap = (docs: any[]) => {
        const status = new Map<string, boolean>();
        docs.forEach((doc) => {
            const tipo = doc.tipo;
            (doc.asignaciones || []).forEach((asig: any) => {
                const personaId = asig.personaId || asig.workerId;
                if (!personaId || !tipo) return;
                const key = `${personaId}:${tipo}`;
                if (asig.estado === 'firmado') {
                    status.set(key, true);
                } else if (!status.has(key)) {
                    status.set(key, false);
                }
            });
        });
        return status;
    };

    const buildSignatureStatusMap = (requests: SignatureRequest[]) => {
        const status = new Map<string, boolean>();
        requests.forEach((request) => {
            (request.trabajadores || []).forEach((trabajador) => {
                const workerId = trabajador.workerId;
                if (!workerId || !request.tipo) return;
                const key = `${workerId}:${request.tipo}`;
                if (trabajador.firmado) {
                    status.set(key, true);
                } else if (!status.has(key)) {
                    status.set(key, false);
                }
            });
        });
        return status;
    };

    const computeOnboardingProgress = (
        workers: Worker[],
        docs: any[],
        requests: SignatureRequest[]
    ) => {
        if (!workers.length) {
            return { uploaded: 0, total: 0, progress: 0, label: 'tareas de onboarding completadas' };
        }

        const docStatus = buildDocStatusMap(docs);
        const requestStatus = buildSignatureStatusMap(requests);

        let total = 0;
        let completed = 0;

        workers.forEach((worker) => {
            DS44_ONBOARDING_ITEMS.forEach((item) => {
                if (item.kind === 'persona') {
                    const vigilancia = (worker as any).vigilanciaSalud?.enVigilancia;
                    if (!vigilancia) {
                        return;
                    }
                    total += 1;
                    if (item.key === 'VIGILANCIA_SALUD') {
                        completed += 1;
                    } else if (item.key === 'EXAMEN_OCUPACIONAL') {
                        const fecha = (worker as any).vigilanciaSalud?.fechaUltimoExamen;
                        if (fecha) completed += 1;
                    }
                    return;
                }

                total += 1;
                const key = `${worker.workerId}:${item.tipo}`;
                if (item.kind === 'document') {
                    if (docStatus.get(key)) completed += 1;
                } else if (item.kind === 'signature') {
                    if (requestStatus.get(key)) completed += 1;
                }
            });
        });

        const progress = total > 0 ? Math.round((completed / total) * 100) : 0;
        return { uploaded: completed, total, progress, label: 'tareas de onboarding completadas' };
    };

    const loadDs44Progress = async (targetObras: typeof obras) => {
        if (targetObras.length === 0) {
            setObraProgress({});
            return;
        }

        const progressMap: Record<string, { uploaded: number; total: number; progress: number; label?: string }> = {};

        await Promise.all(targetObras.map(async (obra) => {
            try {
                const faseDeming = obra.faseDeming || 'plan';
                if (faseDeming === 'plan') {
                    const docsObraRes = await documentsApi.list({ obraId: obra.obraId, clasificacion: 'obra' } as any);
                    const docsObra = docsObraRes.success && docsObraRes.data ? docsObraRes.data.documents || [] : [];
                    const ds44Total = DS44_PLAN_DOCS.length;
                    const ds44Uploaded = DS44_PLAN_DOCS.filter(req => {
                        const existing = docsObra.find((doc: any) => req.tipos.includes(doc.tipo));
                        return Boolean(existing?.s3Key || existing?.archivoUrl);
                    }).length;
                    const progress = ds44Total > 0 ? Math.round((ds44Uploaded / ds44Total) * 100) : 0;
                    progressMap[obra.obraId] = {
                        uploaded: ds44Uploaded,
                        total: ds44Total,
                        progress,
                        label: 'documentos planificados listos'
                    };
                    return;
                }

                if (faseDeming === 'hacer') {
                    const tenantId = obra.tenantId || localStorage.getItem('tenant_id') || '';
                    const [workersRes, docsDiarioRes, requestsRes] = await Promise.all([
                        workersApi.list({ obraId: obra.obraId }),
                        documentsApi.list({ obraId: obra.obraId, clasificacion: 'diario' } as any),
                        signatureRequestsApi.list({ empresaId: tenantId, obraId: obra.obraId })
                    ]);

                    const workers = workersRes.success && workersRes.data ? (workersRes.data as Worker[]) : [];
                    const docsDiario = docsDiarioRes.success && docsDiarioRes.data ? docsDiarioRes.data.documents || [] : [];
                    const requests = requestsRes.success && requestsRes.data ? requestsRes.data.requests || [] : [];

                    progressMap[obra.obraId] = computeOnboardingProgress(workers, docsDiario, requests);
                    return;
                }

                if (faseDeming === 'verificar') {
                    const hasEval = Boolean((obra as any).cumplimientoDS44?.check?.ultimaEvaluacion);
                    const total = 1;
                    const uploaded = hasEval ? 1 : 0;
                    const progress = Math.round((uploaded / total) * 100);
                    progressMap[obra.obraId] = {
                        uploaded,
                        total,
                        progress,
                        label: 'evaluacion anual completada'
                    };
                    return;
                }

                progressMap[obra.obraId] = {
                    uploaded: 0,
                    total: 0,
                    progress: 0,
                    label: 'tareas DS44 completadas'
                };
            } catch (err) {
                console.error(`Error loading DS44 docs for obra ${obra.obraId}:`, err);
                progressMap[obra.obraId] = { uploaded: 0, total: DS44_PLAN_DOCS.length, progress: 0 };
            }
        }));

        setObraProgress(progressMap);
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

        const [surveysResult, inboxResult] = await Promise.allSettled([
            surveysApi.list(),
            user?.userId ? inboxApi.getUnreadCount(user.userId) : Promise.resolve(null)
        ]);

        if (surveysResult.status === 'fulfilled') {
            const surveysRes = surveysResult.value;
            if (surveysRes?.success && surveysRes.data?.surveys && user?.workerId) {
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
        } else {
            console.error('Error loading surveys:', surveysResult.reason);
        }

        if (inboxResult.status === 'fulfilled') {
            const inboxRes = inboxResult.value;
            if (inboxRes?.success && inboxRes.data) {
                setStats(s => ({ ...s, unreadMessages: inboxRes.data?.unreadCount || 0 }));
            }
        } else if (inboxResult.reason) {
            console.error('Error loading inbox:', inboxResult.reason);
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
        const [workersResult, ownPendingResult, sigStatsResult, docsResult, incidentsResult, activitiesResult] = await Promise.allSettled([
            workersApi.list({ obraId: selectedObraId || undefined }),
            user?.workerId ? signatureRequestsApi.getPendingByWorker(user.workerId) : Promise.resolve(null),
            signatureRequestsApi.getStats(),
            documentsApi.list({ obraId: selectedObraId || undefined }),
            incidentsApi.list(),
            activitiesApi.list({ obraId: selectedObraId || undefined })
        ]);

        const nextStats: DashboardStats = {};

        if (workersResult.status === 'fulfilled') {
            const workersRes = workersResult.value;
            if (workersRes.success && workersRes.data) {
                setWorkers(workersRes.data);
                const unenrolled = workersRes.data.filter((w: any) => !w.habilitado).length;
                nextStats.totalWorkers = workersRes.data?.length || 0;
                nextStats.pendingSignatures = unenrolled;
            }
        } else {
            console.error('Error loading workers:', workersResult.reason);
        }

        if (ownPendingResult.status === 'fulfilled') {
            const ownPendingRes = ownPendingResult.value;
            if (ownPendingRes?.success && ownPendingRes.data) {
                nextStats.ownPendingSignatures = ownPendingRes.data?.total || 0;
            }
        } else if (ownPendingResult.reason) {
            console.error('Error loading own pending signatures:', ownPendingResult.reason);
        }

        if (sigStatsResult.status === 'fulfilled') {
            const sigStatsRes = sigStatsResult.value;
            if (sigStatsRes.success && sigStatsRes.data) {
                const totalPendingFirmas = sigStatsRes.data.totalFirmasRequeridas - sigStatsRes.data.totalFirmasObtenidas;
                nextStats.workersPendingSignatures = Math.max(0, totalPendingFirmas);
            }
        } else {
            console.error('Error loading workers pending signatures:', sigStatsResult.reason);
        }

        if (docsResult.status === 'fulfilled') {
            const docsRes = docsResult.value;
            if (docsRes.success && docsRes.data) {
                nextStats.totalDocuments = docsRes.data?.documents.length || 0;
            }
        } else {
            console.error('Error loading documents:', docsResult.reason);
        }

        if (incidentsResult.status === 'fulfilled') {
            const incidentsRes = incidentsResult.value;
            if (incidentsRes.success && incidentsRes.data) {
                nextStats.pendingIncidents = incidentsRes.data.filter(i => i.estado === 'reportado' || i.estado === 'en_investigacion').length;
            }
        } else {
            console.error('Error loading incidents:', incidentsResult.reason);
        }

        if (activitiesResult.status === 'fulfilled') {
            const activitiesRes = activitiesResult.value;
            if (activitiesRes.success && activitiesRes.data) {
                const recent = activitiesRes.data.activities.slice(0, 5);
                setRecentActivities(recent);

                const today = new Date().toISOString().split('T')[0];
                nextStats.activitiesToday = activitiesRes.data.activities.filter(a => a.fecha === today).length;
            }
        } else {
            console.error('Error loading activities:', activitiesResult.reason);
        }

        setStats(s => ({ ...s, ...nextStats }));

        if (selectedObraId) {
            const obra = obras.find(o => o.obraId === selectedObraId);
            if (obra) {
                void loadDs44Progress([obra]);
            }
        }
    };

    const loadJefeObraDashboard = async () => {
        const [workersResult, docsResult, incidentsResult, activitiesResult, sigStatsResult] = await Promise.allSettled([
            workersApi.list({ obraId: selectedObraId || undefined }),
            documentsApi.list({ obraId: selectedObraId || undefined }),
            incidentsApi.list(),
            activitiesApi.list({ obraId: selectedObraId || undefined }),
            signatureRequestsApi.getStats()
        ]);

        const nextStats: DashboardStats = {};

        if (workersResult.status === 'fulfilled') {
            const workersRes = workersResult.value;
            if (workersRes.success && workersRes.data) {
                setWorkers(workersRes.data);
                const unenrolled = workersRes.data.filter((w: any) => !w.habilitado).length;
                nextStats.totalWorkers = workersRes.data?.length || 0;
                nextStats.pendingSignatures = unenrolled;
            }
        } else {
            console.error('Error loading workers:', workersResult.reason);
        }

        if (docsResult.status === 'fulfilled') {
            const docsRes = docsResult.value;
            if (docsRes.success && docsRes.data) {
                nextStats.totalDocuments = docsRes.data?.documents.length || 0;
            }
        } else {
            console.error('Error loading documents:', docsResult.reason);
        }

        if (incidentsResult.status === 'fulfilled') {
            const incidentsRes = incidentsResult.value;
            if (incidentsRes.success && incidentsRes.data) {
                nextStats.pendingIncidents = incidentsRes.data.filter(i => i.estado === 'reportado' || i.estado === 'en_investigacion').length;
            }
        } else {
            console.error('Error loading incidents:', incidentsResult.reason);
        }

        if (activitiesResult.status === 'fulfilled') {
            const activitiesRes = activitiesResult.value;
            if (activitiesRes.success && activitiesRes.data) {
                const recent = activitiesRes.data.activities.slice(0, 5);
                setRecentActivities(recent);
                const today = new Date().toISOString().split('T')[0];
                nextStats.activitiesToday = activitiesRes.data.activities.filter(a => a.fecha === today).length;
            }
        } else {
            console.error('Error loading activities:', activitiesResult.reason);
        }

        if (sigStatsResult.status === 'fulfilled') {
            const sigStatsRes = sigStatsResult.value;
            if (sigStatsRes.success && sigStatsRes.data) {
                const totalPendingFirmas = sigStatsRes.data.totalFirmasRequeridas - sigStatsRes.data.totalFirmasObtenidas;
                nextStats.workersPendingSignatures = Math.max(0, totalPendingFirmas);
            }
        } else {
            console.error('Error loading signature stats:', sigStatsResult.reason);
        }

        setStats(s => ({ ...s, ...nextStats }));

        if (selectedObraId) {
            const obra = obras.find(o => o.obraId === selectedObraId);
            if (obra) {
                void loadDs44Progress([obra]);
            }
        } else {
            void loadDs44Progress(obras);
        }
    };

    const loadSupervisorDashboard = async () => {
        const [workersResult, activitiesResult, incidentsResult] = await Promise.allSettled([
            workersApi.list({ obraId: selectedObraId || undefined }),
            activitiesApi.list({ obraId: selectedObraId || undefined }),
            incidentsApi.list()
        ]);

        const nextStats: DashboardStats = {};

        if (workersResult.status === 'fulfilled') {
            const workersRes = workersResult.value;
            if (workersRes.success && workersRes.data) {
                setWorkers(workersRes.data);
                nextStats.totalWorkers = workersRes.data?.length || 0;
            }
        } else {
            console.error('Error loading workers:', workersResult.reason);
        }

        if (activitiesResult.status === 'fulfilled') {
            const activitiesRes = activitiesResult.value;
            if (activitiesRes.success && activitiesRes.data) {
                const recent = activitiesRes.data.activities.slice(0, 5);
                setRecentActivities(recent);
                const today = new Date().toISOString().split('T')[0];
                nextStats.activitiesToday = activitiesRes.data.activities.filter(a => a.fecha === today).length;
            }
        } else {
            console.error('Error loading activities:', activitiesResult.reason);
        }

        if (incidentsResult.status === 'fulfilled') {
            const incidentsRes = incidentsResult.value;
            if (incidentsRes.success && incidentsRes.data) {
                nextStats.pendingIncidents = incidentsRes.data.filter(i => i.estado === 'reportado' || i.estado === 'en_investigacion').length;
            }
        } else {
            console.error('Error loading incidents:', incidentsResult.reason);
        }

        setStats(s => ({ ...s, ...nextStats }));
    };

    const loadAdminDashboard = async () => {
        const [workersResult, activitiesResult, docsResult, incidentsResult] = await Promise.allSettled([
            workersApi.list({ obraId: selectedObraId || undefined }),
            activitiesApi.list({ obraId: selectedObraId || undefined }),
            documentsApi.list({ obraId: selectedObraId || undefined }),
            incidentsApi.list()
        ]);

        const nextStats: DashboardStats = {};

        if (workersResult.status === 'fulfilled') {
            const workersRes = workersResult.value;
            if (workersRes.success && workersRes.data) {
                setWorkers(workersRes.data);
                nextStats.totalWorkers = workersRes.data?.length || 0;
            }
        } else {
            console.error('Error loading workers:', workersResult.reason);
        }

        if (activitiesResult.status === 'fulfilled') {
            const activitiesRes = activitiesResult.value;
            if (activitiesRes.success && activitiesRes.data) {
                nextStats.activitiesToday = activitiesRes.data?.activities.length || 0;
            }
        } else {
            console.error('Error loading activities:', activitiesResult.reason);
        }

        if (docsResult.status === 'fulfilled') {
            const docsRes = docsResult.value;
            if (docsRes.success && docsRes.data) {
                nextStats.totalDocuments = docsRes.data?.documents.length || 0;
            }
        } else {
            console.error('Error loading documents:', docsResult.reason);
        }

        if (incidentsResult.status === 'fulfilled') {
            const incidentsRes = incidentsResult.value;
            if (incidentsRes.success && incidentsRes.data) {
                nextStats.pendingIncidents = incidentsRes.data?.length || 0;
            }
        } else {
            console.error('Error loading incidents:', incidentsResult.reason);
        }

        setStats(s => ({ ...s, ...nextStats }));

        const obrasToCheck = selectedObraId ? obras.filter(o => o.obraId === selectedObraId) : obras;
        void loadDs44Progress(obrasToCheck);
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
                    <div className="flex items-center gap-3 text-muted flex-wrap">
                        <span className="flex items-center gap-1.5 text-sm font-medium">
                            <FiShield size={14} />
                            {user?.rol === 'admin' && 'Administrador'}
                            {(user?.rol as string) === 'jefe_obra' && 'Jefe de Obra'}
                            {user?.rol === 'prevencionista' && 'Prevencionista'}
                            {(user?.rol as string) === 'supervisor' && 'Supervisor'}
                            {user?.rol === 'trabajador' && 'Trabajador'}
                        </span>
                        {['jefe_obra', 'supervisor', 'prevencionista'].includes(user?.rol || '') && (
                            <>
                                <span className="text-gray-400">•</span>
                                <span className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-primary-500/10 text-primary-500 text-xs font-semibold border border-primary-500/20">
                                    <FiMapPin size={12} />
                                    {selectedObraId ? obras.find(o => o.obraId === selectedObraId)?.nombre : 'Seleccionar Obra'}
                                </span>
                            </>
                        )}
                    </div>
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

                        {selectedObra && selectedObraProgress && (
                            <div className="mb-6">
                                <h3 className="text-sm font-bold uppercase tracking-wider text-muted mb-4">Progreso de Fase (DS44)</h3>
                                <ObraProgressCard
                                    obra={selectedObra}
                                    progress={selectedObraProgress}
                                    managePath={hasPermission('gestionar_obras') ? `/obras/${selectedObra.obraId}` : undefined}
                                />
                            </div>
                        )}

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

                {/* JEFE DE OBRA VIEW */}
                {(user?.rol as string) === 'jefe_obra' && (
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

                        {selectedObra && selectedObraProgress && (
                            <div className="mb-6">
                                <h3 className="text-sm font-bold uppercase tracking-wider text-muted mb-4">Progreso de Fase (DS44)</h3>
                                <ObraProgressCard
                                    obra={selectedObra}
                                    progress={selectedObraProgress}
                                    managePath={hasPermission('gestionar_obras') ? `/obras/${selectedObra.obraId}` : undefined}
                                />
                            </div>
                        )}

                        {/* Firmas Pendientes Banner */}
                        {(stats.workersPendingSignatures || 0) > 0 && (
                            <div className="card mb-6" style={{
                                background: 'linear-gradient(135deg, rgba(234, 179, 8, 0.08), rgba(234, 179, 8, 0.02))',
                                border: '1px solid rgba(234, 179, 8, 0.25)',
                                padding: 'var(--space-5)',
                            }}>
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-4">
                                        <div className="avatar" style={{
                                            background: 'linear-gradient(135deg, var(--warning-500), var(--warning-600))',
                                            width: '52px', height: '52px',
                                            boxShadow: '0 4px 12px rgba(234, 179, 8, 0.3)',
                                        }}>
                                            <FiEdit3 size={22} />
                                        </div>
                                        <div>
                                            <div className="text-sm text-muted" style={{ marginBottom: '4px' }}>Firmas Pendientes de Trabajadores</div>
                                            <div style={{ fontSize: 'var(--text-2xl)', fontWeight: 700, color: 'var(--warning-600)' }}>
                                                {stats.workersPendingSignatures || 0}
                                            </div>
                                        </div>
                                    </div>
                                    <Link to="/signature-requests" className="btn btn-secondary btn-sm" style={{ flexShrink: 0 }}>
                                        Ver Solicitudes <FiArrowRight />
                                    </Link>
                                </div>
                            </div>
                        )}

                        {/* Removed redundant Obras list since selected via dropdown / navbar */}

                        {/* Main grid: Activities + Quick Actions */}
                        <div className="dashboard-main-grid">
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
                                                <span className="badge badge-secondary">{activity.tipo}</span>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>

                            <div className="card">
                                <h2 className="card-title mb-4">Acciones Rápidas</h2>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                                    <Link to="/personas" className="btn btn-primary" style={{ width: '100%', justifyContent: 'flex-start' }}>
                                        <FiUsers /> Equipo de Obra
                                    </Link>
                                    <Link to="/documents" className="btn btn-secondary" style={{ width: '100%', justifyContent: 'flex-start' }}>
                                        <FiFileText /> Documentos
                                    </Link>
                                    <Link to="/activities" className="btn btn-secondary" style={{ width: '100%', justifyContent: 'flex-start' }}>
                                        <FiCalendar /> Actividades
                                    </Link>
                                    <Link to="/signature-requests" className="btn btn-secondary" style={{ width: '100%', justifyContent: 'flex-start' }}>
                                        <FiEdit3 /> Firma Electrónica
                                    </Link>
                                    <Link to="/incidents" className="btn btn-secondary" style={{ width: '100%', justifyContent: 'flex-start' }}>
                                        <FiAlertTriangle /> Incidentes
                                    </Link>
                                </div>
                            </div>
                        </div>
                    </>
                )}

                {/* SUPERVISOR VIEW */}
                {(user?.rol as any) === 'supervisor' && (
                    <>
                        <div className="grid grid-cols-3 mb-6">
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
                                    <span className="text-xs text-muted">Actividades Hoy</span>
                                </div>
                                <div className="stat-value">{stats.activitiesToday || 0}</div>
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

                        <div className="dashboard-main-grid">
                            <div className="card">
                                <div className="card-header">
                                    <div>
                                        <h2 className="card-title">Actividades Recientes</h2>
                                        <p className="card-subtitle">Últimas actividades de tu equipo</p>
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
                                                <span className="badge badge-secondary">{activity.tipo}</span>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>

                            <div className="card">
                                <h2 className="card-title mb-4">Acciones Rápidas</h2>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                                    <Link to="/personas" className="btn btn-primary" style={{ width: '100%', justifyContent: 'flex-start' }}>
                                        <FiUsers /> Mi Equipo
                                    </Link>
                                    <Link to="/activities" className="btn btn-secondary" style={{ width: '100%', justifyContent: 'flex-start' }}>
                                        <FiCalendar /> Actividades
                                    </Link>
                                    <Link to="/incidents" className="btn btn-secondary" style={{ width: '100%', justifyContent: 'flex-start' }}>
                                        <FiAlertTriangle /> Incidentes
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
                                        const obraStats = obraProgress[obra.obraId] || { uploaded: 0, total: DS44_PLAN_DOCS.length, progress: 0 };
                                        return (
                                            <ObraProgressCard
                                                key={obra.obraId}
                                                obra={obra}
                                                progress={obraStats}
                                                managePath={hasPermission('gestionar_obras') ? `/obras/${obra.obraId}` : undefined}
                                            />
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
