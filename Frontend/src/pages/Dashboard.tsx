import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import ObraProgressCard from '../components/ObraProgressCard';
import {
    FiFileText,
    FiCalendar,
    FiAlertTriangle,
    FiPlus,
    FiArrowRight,
    FiCheckSquare,
    FiAlertCircle,
    FiEdit3,
    FiBell,
} from 'react-icons/fi';
import { workersApi, activitiesApi, surveysApi, inboxApi, documentsApi, incidentsApi, signatureRequestsApi } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useObraContext } from '../context/ObraContext';
import type { Worker, Activity, SignatureRequest } from '../api/client';
import { DS44_ONBOARDING_ITEMS, DS44_PLAN_DOCS } from '../utils/ds44';
import { PageHeader } from '../components/ui';

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
                // Roles de gestión: cada uno tiene su dashboard. Cualquier otro rol
                // (trabajador, colaborador, o roles personalizados del tenant) cae al
                // dashboard de trabajador. Sin este fallback, un rol no contemplado
                // dejaba el spinner colgado para siempre (no corría ningún loader).
                const rol = (user.rol as string) || '';
                if (rol === 'prevencionista') {
                    await loadPrevencionistaDashboard();
                } else if (rol === 'jefe_obra') {
                    await loadJefeObraDashboard();
                } else if (rol === 'supervisor') {
                    await loadSupervisorDashboard();
                } else if (rol === 'admin') {
                    await loadAdminDashboard();
                } else {
                    await loadWorkerDashboard();
                }
            } catch (error) {
                console.error('Error loading dashboard:', error);
            } finally {
                // Garantiza que el spinner siempre se cierre, pase lo que pase.
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
                const key = `${worker.personaId}:${item.tipo}`;
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
                        signatureRequestsApi.list({ tenantId, obraId: obra.obraId })
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

        // Check enrollment status (sync — no API needed)
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

        // UI visible de inmediato; encuestas e inbox cargan en background
        setLoading(false);

        const [surveysResult, inboxResult] = await Promise.allSettled([
            surveysApi.list(),
            (user?.personaId || user?.userId) ? inboxApi.getUnreadCount((user?.personaId || user?.userId)!) : Promise.resolve(null)
        ]);

        if (surveysResult.status === 'fulfilled') {
            const surveysRes = surveysResult.value;
            if (surveysRes?.success && surveysRes.data?.surveys && user?.personaId) {
                const mySurveys = surveysRes.data.surveys.filter(s =>
                    s.recipients?.some(r => r.workerId === user.personaId && r.estado !== 'respondida')
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
                    s.recipients?.some(r => r.workerId === user.personaId && r.estado === 'respondida')
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
        // Fase 1 — crítico: trabajadores para mostrar el stat principal de inmediato
        const workersRes = await workersApi.list({ obraId: selectedObraId || undefined }).catch(() => null);
        if (workersRes?.success && workersRes.data) {
            setWorkers(workersRes.data);
            const unenrolled = workersRes.data.filter((w: any) => !w.habilitado).length;
            setStats(s => ({ ...s, totalWorkers: workersRes.data?.length || 0, pendingSignatures: unenrolled }));
        }
        setLoading(false);

        // Fase 2 — background paralelo: resto de stats
        const [ownPendingResult, sigStatsResult, docsResult, incidentsResult, activitiesResult] = await Promise.allSettled([
            user?.personaId ? signatureRequestsApi.getPendingByWorker(user.personaId) : Promise.resolve(null),
            signatureRequestsApi.getStats(),
            documentsApi.list({ obraId: selectedObraId || undefined }),
            incidentsApi.list(),
            activitiesApi.list({ obraId: selectedObraId || undefined })
        ]);

        const nextStats: DashboardStats = {};

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
        // Fase 1 — crítico: trabajadores
        const workersRes = await workersApi.list({ obraId: selectedObraId || undefined }).catch(() => null);
        if (workersRes?.success && workersRes.data) {
            setWorkers(workersRes.data);
            const unenrolled = workersRes.data.filter((w: any) => !w.habilitado).length;
            setStats(s => ({ ...s, totalWorkers: workersRes.data?.length || 0, pendingSignatures: unenrolled }));
        }
        setLoading(false);

        // Fase 2 — background paralelo
        const [docsResult, incidentsResult, activitiesResult, sigStatsResult] = await Promise.allSettled([
            documentsApi.list({ obraId: selectedObraId || undefined }),
            incidentsApi.list(),
            activitiesApi.list({ obraId: selectedObraId || undefined }),
            signatureRequestsApi.getStats()
        ]);

        const nextStats: DashboardStats = {};

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
        // Fase 1 — crítico: trabajadores
        const workersRes = await workersApi.list({ obraId: selectedObraId || undefined }).catch(() => null);
        if (workersRes?.success && workersRes.data) {
            setWorkers(workersRes.data);
            setStats(s => ({ ...s, totalWorkers: workersRes.data?.length || 0 }));
        }
        setLoading(false);

        // Fase 2 — background paralelo
        const [activitiesResult, incidentsResult] = await Promise.allSettled([
            activitiesApi.list({ obraId: selectedObraId || undefined }),
            incidentsApi.list()
        ]);

        const nextStats: DashboardStats = {};

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
        // Fase 1 — crítico: trabajadores
        const workersRes = await workersApi.list({ obraId: selectedObraId || undefined }).catch(() => null);
        if (workersRes?.success && workersRes.data) {
            setWorkers(workersRes.data);
            setStats(s => ({ ...s, totalWorkers: workersRes.data?.length || 0 }));
        }
        setLoading(false);

        // Fase 2 — background paralelo
        const [activitiesResult, docsResult, incidentsResult] = await Promise.allSettled([
            activitiesApi.list({ obraId: selectedObraId || undefined }),
            documentsApi.list({ obraId: selectedObraId || undefined }),
            incidentsApi.list()
        ]);

        const nextStats: DashboardStats = {};

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
                <style>{`
                    .spinner {
                        width: 40px; height: 40px;
                        border: 3px solid var(--surface-border);
                        border-top-color: var(--primary-500);
                        border-radius: 50%;
                        animation: spin 0.8s linear infinite;
                    }
                    @keyframes spin { to { transform: rotate(360deg); } }
                `}</style>
            </div>
        );
    }

    const scopeLabel = selectedObra
        ? [selectedObra.codigo, selectedObra.nombre].filter(Boolean).join(' · ')
        : user?.rol === 'admin' ? 'Vista empresa' : '';

    return (
        <>
            <div className="page-content">
                <PageHeader
                    title={`Hola, ${user?.nombre}`}
                    scope={scopeLabel ? { label: scopeLabel } : undefined}
                />

                {/* TRABAJADOR VIEW */}
                {user?.rol === 'trabajador' && (
                    <div className="dash-role-view">
                        {getUrgentTasks().length > 0 && (
                            <div className="alert alert-warning">
                                <FiAlertCircle />
                                <div>
                                    <strong>Requieren tu atención urgente</strong>
                                    <div className="text-sm mt-1">{getUrgentTasks().length} tarea(s) pendiente(s)</div>
                                </div>
                            </div>
                        )}

                        <div className="dash-metrics">
                            <div className="dash-metric">
                                <span className="dash-metric-value">{progressPercentage}%</span>
                                <span className="dash-metric-label">completado</span>
                            </div>
                            <div className="dash-metric-sep" />
                            <div className="dash-metric">
                                <span className="dash-metric-value">{pendings.length}</span>
                                <span className="dash-metric-label">pendientes</span>
                            </div>
                            {(stats.unreadMessages ?? 0) > 0 && (
                                <>
                                    <div className="dash-metric-sep" />
                                    <div className="dash-metric">
                                        <Link to="/inbox" className="dash-metric-link">
                                            <FiBell size={14} /> {stats.unreadMessages} sin leer
                                        </Link>
                                    </div>
                                </>
                            )}
                        </div>

                        {pendings.length === 0 ? (
                            <div className="empty-state">
                                <FiCheckSquare size={48} className="empty-state-icon" style={{ color: 'var(--success-500)' }} />
                                <h3 className="empty-state-title">¡Todo al día!</h3>
                                <p className="empty-state-description">No tienes tareas pendientes en este momento.</p>
                            </div>
                        ) : (
                            <div>
                                <h2 className="dash-section-title" style={{ marginBottom: 'var(--space-3)' }}>Mis pendientes</h2>
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
                            </div>
                        )}
                    </div>
                )}

                {/* PREVENCIONISTA VIEW */}
                {user?.rol === 'prevencionista' && (
                    <div className="dash-role-view">
                        <div className="dash-metrics">
                            <div className="dash-metric">
                                <span className="dash-metric-value">{stats.totalWorkers || 0}</span>
                                <span className="dash-metric-label">trabajadores</span>
                            </div>
                            <div className="dash-metric-sep" />
                            <div className="dash-metric">
                                <span className="dash-metric-value" style={{ color: (stats.workersPendingSignatures || 0) > 0 ? 'var(--warning-600)' : undefined }}>
                                    {stats.workersPendingSignatures || 0}
                                </span>
                                <span className="dash-metric-label">firmas pendientes</span>
                            </div>
                            <div className="dash-metric-sep" />
                            <div className="dash-metric">
                                <span className="dash-metric-value">{stats.activitiesToday || 0}</span>
                                <span className="dash-metric-label">actividades hoy</span>
                            </div>
                            {(stats.pendingIncidents || 0) > 0 && (
                                <>
                                    <div className="dash-metric-sep" />
                                    <div className="dash-metric">
                                        <span className="dash-metric-value" style={{ color: 'var(--danger-500)' }}>{stats.pendingIncidents}</span>
                                        <span className="dash-metric-label">incidentes</span>
                                    </div>
                                </>
                            )}
                        </div>

                        {(stats.workersPendingSignatures || 0) > 0 && (
                            <div className="dash-action-banner">
                                <div className="dash-action-banner-body">
                                    <FiEdit3 size={20} />
                                    <div>
                                        <div className="dash-action-banner-count">{stats.workersPendingSignatures}</div>
                                        <div className="dash-action-banner-label">firmas de trabajadores pendientes</div>
                                    </div>
                                </div>
                                <Link to="/signature-requests" className="btn btn-secondary btn-sm">
                                    Ver solicitudes <FiArrowRight />
                                </Link>
                            </div>
                        )}

                        {selectedObra && selectedObraProgress && (
                            <div>
                                <h2 className="dash-section-title" style={{ marginBottom: 'var(--space-3)' }}>DS44 · {selectedObra.nombre}</h2>
                                <ObraProgressCard
                                    obra={selectedObra}
                                    progress={selectedObraProgress}
                                    managePath={hasPermission('gestionar_obras') ? `/obras/${selectedObra.obraId}` : undefined}
                                />
                            </div>
                        )}

                        <div>
                            <div className="dash-section-header">
                                <h2 className="dash-section-title">Actividades recientes</h2>
                                <Link to="/activities" className="btn btn-primary btn-sm"><FiPlus /> Nueva</Link>
                            </div>
                            {recentActivities.length === 0 ? (
                                <div className="empty-state" style={{ padding: 'var(--space-6) 0' }}>
                                    <FiCalendar size={36} className="mb-3 opacity-20" />
                                    <p>No hay actividades recientes</p>
                                </div>
                            ) : (
                                <div className="dash-list">
                                    {recentActivities.map(activity => (
                                        <div key={activity.activityId} className="dash-list-row">
                                            <div className="flex items-center gap-3">
                                                <div className="avatar avatar-sm" style={{ background: 'var(--primary-500)' }}><FiCalendar /></div>
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
                    </div>
                )}

                {/* JEFE DE OBRA VIEW */}
                {(user?.rol as string) === 'jefe_obra' && (
                    <div className="dash-role-view">
                        <div className="dash-metrics">
                            <div className="dash-metric">
                                <span className="dash-metric-value">{stats.totalWorkers || 0}</span>
                                <span className="dash-metric-label">trabajadores</span>
                            </div>
                            <div className="dash-metric-sep" />
                            <div className="dash-metric">
                                <span className="dash-metric-value" style={{ color: (stats.workersPendingSignatures || 0) > 0 ? 'var(--warning-600)' : undefined }}>
                                    {stats.workersPendingSignatures || 0}
                                </span>
                                <span className="dash-metric-label">firmas pendientes</span>
                            </div>
                            <div className="dash-metric-sep" />
                            <div className="dash-metric">
                                <span className="dash-metric-value">{stats.activitiesToday || 0}</span>
                                <span className="dash-metric-label">actividades hoy</span>
                            </div>
                            {(stats.pendingIncidents || 0) > 0 && (
                                <>
                                    <div className="dash-metric-sep" />
                                    <div className="dash-metric">
                                        <span className="dash-metric-value" style={{ color: 'var(--danger-500)' }}>{stats.pendingIncidents}</span>
                                        <span className="dash-metric-label">incidentes</span>
                                    </div>
                                </>
                            )}
                        </div>

                        {(stats.workersPendingSignatures || 0) > 0 && (
                            <div className="dash-action-banner">
                                <div className="dash-action-banner-body">
                                    <FiEdit3 size={20} />
                                    <div>
                                        <div className="dash-action-banner-count">{stats.workersPendingSignatures}</div>
                                        <div className="dash-action-banner-label">firmas de trabajadores pendientes</div>
                                    </div>
                                </div>
                                <Link to="/signature-requests" className="btn btn-secondary btn-sm">
                                    Ver solicitudes <FiArrowRight />
                                </Link>
                            </div>
                        )}

                        {selectedObra && selectedObraProgress && (
                            <div>
                                <h2 className="dash-section-title" style={{ marginBottom: 'var(--space-3)' }}>DS44 · {selectedObra.nombre}</h2>
                                <ObraProgressCard
                                    obra={selectedObra}
                                    progress={selectedObraProgress}
                                    managePath={hasPermission('gestionar_obras') ? `/obras/${selectedObra.obraId}` : undefined}
                                />
                            </div>
                        )}

                        <div>
                            <div className="dash-section-header">
                                <h2 className="dash-section-title">Actividades recientes</h2>
                                <Link to="/activities" className="btn btn-primary btn-sm"><FiPlus /> Nueva</Link>
                            </div>
                            {recentActivities.length === 0 ? (
                                <div className="empty-state" style={{ padding: 'var(--space-6) 0' }}>
                                    <FiCalendar size={36} className="mb-3 opacity-20" />
                                    <p>No hay actividades recientes</p>
                                </div>
                            ) : (
                                <div className="dash-list">
                                    {recentActivities.map(activity => (
                                        <div key={activity.activityId} className="dash-list-row">
                                            <div className="flex items-center gap-3">
                                                <div className="avatar avatar-sm" style={{ background: 'var(--primary-500)' }}><FiCalendar /></div>
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
                    </div>
                )}

                {/* SUPERVISOR VIEW */}
                {(user?.rol as any) === 'supervisor' && (
                    <div className="dash-role-view">
                        <div className="dash-metrics">
                            <div className="dash-metric">
                                <span className="dash-metric-value">{stats.totalWorkers || 0}</span>
                                <span className="dash-metric-label">trabajadores</span>
                            </div>
                            <div className="dash-metric-sep" />
                            <div className="dash-metric">
                                <span className="dash-metric-value">{stats.activitiesToday || 0}</span>
                                <span className="dash-metric-label">actividades hoy</span>
                            </div>
                            {(stats.pendingIncidents || 0) > 0 && (
                                <>
                                    <div className="dash-metric-sep" />
                                    <div className="dash-metric">
                                        <span className="dash-metric-value" style={{ color: 'var(--danger-500)' }}>{stats.pendingIncidents}</span>
                                        <span className="dash-metric-label">incidentes</span>
                                    </div>
                                </>
                            )}
                        </div>

                        <div>
                            <div className="dash-section-header">
                                <h2 className="dash-section-title">Actividades recientes</h2>
                                <Link to="/activities" className="btn btn-primary btn-sm"><FiPlus /> Nueva</Link>
                            </div>
                            {recentActivities.length === 0 ? (
                                <div className="empty-state" style={{ padding: 'var(--space-6) 0' }}>
                                    <FiCalendar size={36} className="mb-3 opacity-20" />
                                    <p>No hay actividades recientes</p>
                                </div>
                            ) : (
                                <div className="dash-list">
                                    {recentActivities.map(activity => (
                                        <div key={activity.activityId} className="dash-list-row">
                                            <div className="flex items-center gap-3">
                                                <div className="avatar avatar-sm" style={{ background: 'var(--primary-500)' }}><FiCalendar /></div>
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
                    </div>
                )}

                {/* ADMIN VIEW */}
                {user?.rol === 'admin' && (
                    <div className="dash-role-view">
                        <div className="dash-metrics">
                            <div className="dash-metric">
                                <span className="dash-metric-value">{stats.totalWorkers || 0}</span>
                                <span className="dash-metric-label">trabajadores</span>
                            </div>
                            <div className="dash-metric-sep" />
                            <div className="dash-metric">
                                <span className="dash-metric-value">{stats.activitiesToday || 0}</span>
                                <span className="dash-metric-label">actividades</span>
                            </div>
                            <div className="dash-metric-sep" />
                            <div className="dash-metric">
                                <span className="dash-metric-value">{stats.totalDocuments || 0}</span>
                                <span className="dash-metric-label">documentos</span>
                            </div>
                            {(stats.pendingIncidents || 0) > 0 && (
                                <>
                                    <div className="dash-metric-sep" />
                                    <div className="dash-metric">
                                        <span className="dash-metric-value" style={{ color: 'var(--danger-500)' }}>{stats.pendingIncidents}</span>
                                        <span className="dash-metric-label">incidentes</span>
                                    </div>
                                </>
                            )}
                        </div>

                        <div>
                            <div className="dash-section-header">
                                <h2 className="dash-section-title">Obras</h2>
                                <Link to="/obras" className="btn btn-secondary btn-sm">Ver todas</Link>
                            </div>

                            {obras.length === 0 ? (
                                <div className="empty-state">
                                    <FiAlertTriangle size={48} className="empty-state-icon" style={{ color: 'var(--warning-500)' }} />
                                    <h3 className="empty-state-title">No tienes obras creadas</h3>
                                    <p className="empty-state-description">
                                        1. Crea tu primera Obra.<br />
                                        2. Enrola trabajadores y asígnalos.<br />
                                        3. Sube los documentos para comenzar.
                                    </p>
                                    <Link to="/obras" className="btn btn-primary mt-4"><FiPlus /> Crear Obra</Link>
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
                    </div>
                )}
            </div>

            <style>{`
                .dash-role-view {
                    display: flex;
                    flex-direction: column;
                    gap: var(--space-6);
                }
                .dash-metrics {
                    display: flex;
                    align-items: center;
                    gap: var(--space-5);
                    padding: var(--space-4) 0;
                    border-bottom: 1px solid var(--surface-border);
                }
                .dash-metric {
                    display: flex;
                    flex-direction: column;
                    gap: 2px;
                }
                .dash-metric-value {
                    font-size: var(--text-2xl);
                    font-weight: 700;
                    color: var(--text-primary);
                    line-height: 1;
                }
                .dash-metric-label {
                    font-size: var(--text-xs);
                    color: var(--text-secondary);
                    text-transform: uppercase;
                    letter-spacing: 0.05em;
                }
                .dash-metric-link {
                    display: flex;
                    align-items: center;
                    gap: var(--space-1);
                    font-size: var(--text-sm);
                    color: var(--accent);
                    font-weight: 500;
                    text-decoration: none;
                }
                .dash-metric-link:hover { text-decoration: underline; }
                .dash-metric-sep {
                    width: 1px;
                    height: 32px;
                    background: var(--surface-border);
                    flex-shrink: 0;
                }
                .dash-section-header {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    margin-bottom: var(--space-4);
                }
                .dash-section-title {
                    font-size: var(--text-sm);
                    font-weight: 700;
                    text-transform: uppercase;
                    letter-spacing: 0.06em;
                    color: var(--text-secondary);
                    margin: 0;
                }
                .dash-action-banner {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    gap: var(--space-4);
                    padding: var(--space-4) var(--space-5);
                    background: rgba(234, 179, 8, 0.06);
                    border: 1px solid rgba(234, 179, 8, 0.22);
                    border-radius: var(--radius-md);
                }
                .dash-action-banner-body {
                    display: flex;
                    align-items: center;
                    gap: var(--space-3);
                    color: var(--warning-600);
                }
                .dash-action-banner-count {
                    font-size: var(--text-2xl);
                    font-weight: 700;
                    color: var(--warning-600);
                    line-height: 1;
                }
                .dash-action-banner-label {
                    font-size: var(--text-sm);
                    color: var(--text-secondary);
                }
                .dash-list {
                    display: flex;
                    flex-direction: column;
                    gap: 1px;
                    border: 1px solid var(--surface-border);
                    border-radius: var(--radius-md);
                    overflow: hidden;
                }
                .dash-list-row {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    padding: var(--space-3) var(--space-4);
                    background: var(--surface-card);
                    transition: background 0.15s;
                }
                .dash-list-row:hover { background: var(--surface-elevated); }
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
                .priority-high { background: var(--danger-500) !important; }
                .priority-normal { background: var(--primary-500) !important; }
                .priority-low { background: var(--gray-500) !important; }
            `}</style>
        </>
    );
}
