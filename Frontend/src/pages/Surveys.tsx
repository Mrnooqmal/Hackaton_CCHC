import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    surveysApi,
    workersApi,
    type Survey,
    type SurveyQuestionType,
    type Worker,
    type SurveyRecipient,
    type SurveyAnswer
} from '../api/client';
import {
    FiPlus,
    FiCheckCircle,
    FiAlertCircle,
    FiBarChart2,
    FiUserCheck,
    FiUserX,
    FiClipboard,
    FiLock,
    FiSearch,
    FiWifiOff
} from 'react-icons/fi';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { PERMISSIONS } from '../permissions';
import SignatureModal from '../components/SignatureModal';
import { useOfflineSignature } from '../hooks/useOfflineSignature';
import { Modal, PageHeader } from '../components/ui';
import { SurveyStatTileSkeleton, SurveyRowSectionSkeleton, SurveyCardSkeleton } from '../components/surveys/SurveysSkeleton';

export default function Surveys() {
    const navigate = useNavigate();
    const { user, hasPermission } = useAuth();
    const { toast } = useToast();
    const { isOnline, pendingCount, signSurvey, syncPendingSignatures } = useOfflineSignature();
    const canManageSurveys = hasPermission(PERMISSIONS.ENCUESTAS_CREAR);
    const canRespondSurveys = user?.rol === 'trabajador' || user?.rol === 'prevencionista';
    const [surveys, setSurveys] = useState<Survey[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [selectedSurvey, setSelectedSurvey] = useState<Survey | null>(null);
    const [currentWorker, setCurrentWorker] = useState<Worker | null>(null);
    const [responseModal, setResponseModal] = useState<{ survey: Survey; recipient: SurveyRecipient } | null>(null);
    const [responseValues, setResponseValues] = useState<Record<string, string | number>>({});
    const [responding, setResponding] = useState(false);
    const [responseError, setResponseError] = useState('');
    const [activeTab, setActiveTab] = useState<'assigned' | 'created'>('assigned');
    // El recuento de la pestaña "Mis encuestas" es solo lo pendiente, no el
    // total: es la cifra que le importa a quien la mira (cuánto le falta).
    const [showOnlyMine, setShowOnlyMine] = useState(false); // Filter for 'Encuestas Creadas' tab
    const [searchQuery, setSearchQuery] = useState(''); // Search filter for surveys
    const [showSignatureModal, setShowSignatureModal] = useState(false); // Signature modal for survey response
    // Solo para la cifra de contexto "de N en la obra" en la tarjeta de
    // resumen; el gestor es el único que ve esa tarjeta.
    const [totalWorkers, setTotalWorkers] = useState(0);

    useEffect(() => {
        loadData();
    }, []);

    useEffect(() => {
        if (!canManageSurveys) return;
        workersApi.list().then((res) => {
            if (res.success && res.data) setTotalWorkers(res.data.length);
        }).catch(() => {});
    }, [canManageSurveys]);

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
        setLoading(true);
        setError('');
        try {
            const res = await surveysApi.list();
            if (res.success && res.data) {
                setSurveys(res.data.surveys || []);
            } else {
                setError(res.error || 'No fue posible cargar las encuestas');
            }
        } catch (err) {
            console.error(err);
            setError('Error de conexión al cargar encuestas');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        let cancelled = false;

        const fetchWorkerProfile = async () => {
            if (!user?.rut || !canRespondSurveys) {
                if (!cancelled) setCurrentWorker(null);
                return;
            }

            try {
                const response = await workersApi.getByRut(user.rut);
                if (!cancelled) {
                    if (response.success && response.data) {
                        setCurrentWorker(response.data);
                    } else {
                        setCurrentWorker(null);
                    }
                }
            } catch (err) {
                console.error('No fue posible obtener el perfil del trabajador', err);
                if (!cancelled) {
                    setCurrentWorker(null);
                }
            }
        };

        fetchWorkerProfile();

        return () => {
            cancelled = true;
        };
    }, [user?.rut, canRespondSurveys]);

    const globalStats = useMemo(() => {
        const totals = surveys.reduce(
            (acc, survey) => {
                const stats = survey.stats || {
                    totalRecipients: survey.recipients?.length || 0,
                    responded: survey.recipients?.filter((r) => r.estado === 'respondida').length || 0,
                };
                return {
                    surveys: acc.surveys + 1,
                    recipients: acc.recipients + (stats.totalRecipients || 0),
                    responded: acc.responded + (stats.responded || 0),
                };
            },
            { surveys: 0, recipients: 0, responded: 0 }
        );

        const completion = totals.recipients > 0
            ? Math.round((totals.responded / totals.recipients) * 100)
            : 0;

        return {
            totalSurveys: totals.surveys,
            totalRecipients: totals.recipients,
            completion,
        };
    }, [surveys]);

    const activeSurveysCount = useMemo(
        () => surveys.filter((s) => s.estado !== 'completada').length,
        [surveys]
    );

    const assignedSurveys = useMemo(() => {
        if (!currentWorker) return [] as Array<{ survey: Survey; recipient: SurveyRecipient }>;
        return surveys.reduce<Array<{ survey: Survey; recipient: SurveyRecipient }>>((acc, survey) => {
            const recipient = survey.recipients?.find((r) => r.workerId === currentWorker.personaId);
            if (recipient) {
                acc.push({ survey, recipient });
            }
            return acc;
        }, []);
    }, [surveys, currentWorker]);

    // Filter surveys created by the current user
    const mySurveys = useMemo(() => {
        const uid = user?.personaId || user?.userId;
        if (!uid) return surveys;
        return surveys.filter((survey) => survey.createdBy === uid);
    }, [surveys, user?.personaId, user?.userId]);

    // Get filtered surveys based on active tab, filter, and search
    const formatDateTime = (value?: string | null) => {
        if (!value) return '—';
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return value;
        return date.toLocaleString('es-CL', {
            dateStyle: 'medium',
            timeStyle: 'short',
        });
    };

    const filteredSurveys = useMemo(() => {
        let result = showOnlyMine ? mySurveys : surveys;

        // Apply search filter
        if (searchQuery.trim()) {
            const query = searchQuery.toLowerCase();
            result = result.filter(survey =>
                survey.titulo.toLowerCase().includes(query) ||
                (survey.descripcion && survey.descripcion.toLowerCase().includes(query))
            );
        }

        return result;
    }, [showOnlyMine, mySurveys, surveys, searchQuery]);

    const assignedPendingCount = useMemo(
        () => assignedSurveys.filter(s => s.recipient.estado === 'pendiente').length,
        [assignedSurveys]
    );

    // Filtered assigned surveys for "Mis Encuestas" tab search
    const filteredAssignedSurveys = useMemo(() => {
        if (!searchQuery.trim()) return assignedSurveys;

        const query = searchQuery.toLowerCase();
        return assignedSurveys.filter(({ survey }) =>
            survey.titulo.toLowerCase().includes(query) ||
            (survey.descripcion && survey.descripcion.toLowerCase().includes(query))
        );
    }, [assignedSurveys, searchQuery]);

    const formatAudience = (survey: Survey) => {
        if (survey.audience?.tipo === 'cargo') {
            return `Cargo: ${survey.audience.cargo}`;
        }
        if (survey.audience?.tipo === 'personalizado') {
            return `${survey.audience.totalRuts ?? 0} trabajador(es)`;
        }
        return 'Todos los trabajadores';
    };

    const formatQuestionType = (tipo: SurveyQuestionType) => {
        switch (tipo) {
            case 'multiple':
                return 'Selección múltiple';
            case 'escala':
                return 'Escala';
            case 'abierta':
                return 'Respuesta abierta';
            default:
                return tipo;
        }
    };

    const getRecipientStats = (survey: Survey) => {
        const totalRecipients = survey.stats?.totalRecipients ?? survey.recipients?.length ?? 0;
        const respondedFromStats = survey.stats?.responded;
        const respondedFallback = survey.recipients?.filter((recipient) => recipient.estado === 'respondida').length ?? 0;
        const respondedCount = respondedFromStats ?? respondedFallback;
        const pendingCount = Math.max(totalRecipients - respondedCount, 0);
        return { totalRecipients, respondedCount, pendingCount };
    };

    const detailStats = selectedSurvey ? getRecipientStats(selectedSurvey) : null;
    const detailCompletion = detailStats && detailStats.totalRecipients > 0
        ? Math.round((detailStats.respondedCount / detailStats.totalRecipients) * 100)
        : 0;

    const openResponseModal = (survey: Survey, recipient: SurveyRecipient) => {
        const initialValues: Record<string, string | number> = {};
        (recipient.responses || []).forEach((answer) => {
            if (!answer || !answer.questionId) return;
            if (Array.isArray(answer.value)) {
                if (answer.value.length > 0) {
                    initialValues[answer.questionId] = answer.value[0];
                }
            } else if (answer.value !== undefined && answer.value !== null) {
                initialValues[answer.questionId] = answer.value;
            }
        });

        setResponseModal({ survey, recipient });
        setResponseValues(initialValues);
        setResponseError('');
    };

    const closeResponseModal = () => {
        setResponseModal(null);
        setResponseValues({});
        setResponding(false);
        setResponseError('');
    };

    const handleResponseChange = (questionId: string, value: string | number) => {
        setResponseValues((prev) => ({
            ...prev,
            [questionId]: value,
        }));
    };

    const handleSubmitResponse = async (pin: string) => {
        if (!responseModal) return;
        const { survey, recipient } = responseModal;

        const missingRequired = survey.preguntas.some((question) => {
            if (!question.required) return false;
            const value = responseValues[question.questionId];
            if (question.tipo === 'escala') {
                return value === undefined || value === null || Number.isNaN(Number(value));
            }
            return value === undefined || value === null || String(value).trim() === '';
        });

        if (missingRequired) {
            setResponseError('Responde todas las preguntas marcadas como obligatorias.');
            return;
        }

        setResponding(true);
        setResponseError('');

        const responsesPayload = survey.preguntas.reduce<SurveyAnswer[]>((acc, question) => {
            const rawValue = responseValues[question.questionId];
            if (rawValue === undefined || rawValue === null) {
                return acc;
            }

            if (question.tipo === 'escala') {
                const numericValue = typeof rawValue === 'number' ? rawValue : Number(rawValue);
                if (!Number.isNaN(numericValue)) {
                    acc.push({
                        questionId: question.questionId,
                        value: numericValue,
                    });
                }
                return acc;
            }

            if (typeof rawValue === 'string') {
                const trimmedValue = rawValue.trim();
                if (trimmedValue) {
                    acc.push({
                        questionId: question.questionId,
                        value: trimmedValue,
                    });
                }
                return acc;
            }

            acc.push({
                questionId: question.questionId,
                value: rawValue,
            });
            return acc;
        }, []);

        try {
            const result = await signSurvey(
                survey.surveyId,
                survey.titulo,
                recipient.workerId,
                user?.nombre || 'Trabajador',
                responsesPayload,
                pin
            );

            if (!result.success) {
                setResponseError(result.error || 'No fue posible enviar tus respuestas.');
                return;
            }

            if (result.offline) {
                toast.info('Respuesta guardada localmente. Se sincronizará cuando vuelva la conexión.');
                setShowSignatureModal(false);
                closeResponseModal();
                return;
            }

            // If online, we get the updated survey from the response (in a real scenario, signSurvey should return data)
            // But since we are using a hook that abstracts API calls, we'll just reload data if online
            toast.success('Encuesta respondida exitosamente');
            setShowSignatureModal(false);
            closeResponseModal();
            loadData();
            // Dispatch event to refresh sidebar pending count
            window.dispatchEvent(new CustomEvent('surveyResponded'));
        } catch (err) {
            console.error('Error enviando respuestas de encuesta', err);
            setResponseError('Ocurrió un error al enviar tus respuestas. Intenta nuevamente.');
        } finally {
            setResponding(false);
        }
    };

    const renderResponseField = (question: Survey['preguntas'][number]) => {
        const value = responseValues[question.questionId];

        if (question.tipo === 'multiple') {
            return (
                <div className="option-pill-group">
                    {(question.opciones || []).map((option) => (
                        <button
                            type="button"
                            key={option}
                            className={`option-pill selectable ${value === option ? 'active' : ''}`}
                            onClick={() => handleResponseChange(question.questionId, option)}
                        >
                            {option}
                        </button>
                    ))}
                </div>
            );
        }

        if (question.tipo === 'escala') {
            const max = question.escalaMax || 5;
            const values = Array.from({ length: max }, (_, index) => index + 1);
            return (
                <div className="option-pill-group">
                    {values.map((option) => (
                        <button
                            type="button"
                            key={option}
                            className={`option-pill selectable ${value === option ? 'active' : ''}`}
                            onClick={() => handleResponseChange(question.questionId, option)}
                        >
                            {option}
                        </button>
                    ))}
                </div>
            );
        }

        return (
            <textarea
                className="form-input"
                rows={3}
                value={typeof value === 'string' ? value : ''}
                onChange={(e) => handleResponseChange(question.questionId, e.target.value)}
                placeholder="Comparte tu respuesta"
            />
        );
    };

    // Compartida entre la vista de trabajador (sin pestañas) y la pestaña
    // "Mis encuestas" del gestor: mismo contenido en ambos casos. Dos
    // contenedores (Pendientes / Respondidas), cada fila clicable entera
    // (abre el detalle) con su acción principal a la derecha.
    const renderSurveyRow = ({ survey, recipient }: { survey: Survey; recipient: SurveyRecipient }) => (
        <li key={survey.surveyId}>
            <div
                className="survey-row"
                role="button"
                tabIndex={0}
                aria-label={`Ver detalle de ${survey.titulo}`}
                onClick={() => setSelectedSurvey(survey)}
                onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedSurvey(survey); }
                }}
            >
                <span className="survey-row-icon" aria-hidden="true"><FiClipboard size={16} /></span>
                <div className="survey-row-main">
                    <h3 className="survey-row-title">{survey.titulo}</h3>
                    <p className="survey-row-meta">
                        {survey.preguntas?.length || 0} preguntas
                        {recipient.estado === 'respondida' && ` · Respondida el ${formatDateTime(recipient.respondedAt)}`}
                    </p>
                </div>
                <div className="survey-row-actions" onClick={(e) => e.stopPropagation()}>
                    <button
                        className="btn btn-primary btn-sm"
                        type="button"
                        onClick={() => openResponseModal(survey, recipient)}
                    >
                        {recipient.estado === 'respondida' ? 'Actualizar respuesta' : 'Responder ahora'}
                    </button>
                </div>
            </div>
        </li>
    );

    const renderAssignedSection = (className = '') => {
        if (loading) {
            return (
                <div className={className} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
                    <SurveyRowSectionSkeleton rows={3} />
                </div>
            );
        }

        if (!currentWorker) {
            return (
                <div className={`card ${className}`}>
                    <div className="empty-state">
                        <div className="empty-state-icon"><FiUserX /></div>
                        <h3 className="empty-state-title">No encontramos tu perfil de trabajador</h3>
                        <p className="empty-state-description">
                            Tu cuenta no está vinculada a una persona de esta obra, así que no podemos mostrarte
                            encuestas asignadas. Pide a tu administrador o prevencionista que revise tu perfil.
                        </p>
                    </div>
                </div>
            );
        }

        if (filteredAssignedSurveys.length === 0) {
            const sinResultadosDeBusqueda = searchQuery.trim() !== '' && assignedSurveys.length > 0;
            return (
                <div className={`card ${className}`}>
                    <div className="empty-state">
                        <div className="empty-state-icon">{sinResultadosDeBusqueda ? <FiSearch /> : <FiCheckCircle />}</div>
                        <h3 className="empty-state-title">
                            {sinResultadosDeBusqueda ? 'Ninguna encuesta coincide' : 'Estás al día'}
                        </h3>
                        <p className="empty-state-description">
                            {sinResultadosDeBusqueda
                                ? `No encontramos encuestas que coincidan con «${searchQuery}».`
                                : 'No tienes encuestas pendientes por responder. Cuando te asignen una nueva, aparecerá aquí.'}
                        </p>
                    </div>
                </div>
            );
        }

        const pendientes = filteredAssignedSurveys.filter(({ recipient }) => recipient.estado === 'pendiente');
        const respondidas = filteredAssignedSurveys.filter(({ recipient }) => recipient.estado === 'respondida');

        return (
            <div className={className} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
                {pendientes.length > 0 && (
                    <section className="survey-row-section">
                        <div className="survey-row-section-header">
                            <h2>Pendientes</h2>
                            <span>{pendientes.length} por responder</span>
                        </div>
                        <ul className="survey-row-list">{pendientes.map(renderSurveyRow)}</ul>
                    </section>
                )}
                {respondidas.length > 0 && (
                    <section className="survey-row-section">
                        <div className="survey-row-section-header">
                            <h2>Respondidas</h2>
                            <span>{respondidas.length} en total</span>
                        </div>
                        <ul className="survey-row-list">{respondidas.map(renderSurveyRow)}</ul>
                    </section>
                )}
            </div>
        );
    };

    return (
        <>
            <div className="page-content">
                {/* Mis encuestas / Encuestas creadas son dos vistas de lo mismo,
                    no un filtro: van en el encabezado, como en Actividades y en
                    el repositorio de documentos. Quien solo responde encuestas
                    (sin gestionarlas) no tiene nada que alternar. */}
                <PageHeader
                    banner
                    title="Encuestas"
                    description="Charlas de opinión, evaluaciones y fichas de salud respondidas por los trabajadores de la obra."
                    tabs={canManageSurveys ? [
                        {
                            id: 'assigned', label: 'Mis encuestas', icon: <FiUserCheck size={15} />,
                            badge: assignedPendingCount > 0 ? assignedPendingCount : undefined,
                        },
                        {
                            id: 'created', label: 'Encuestas creadas', icon: <FiBarChart2 size={15} />,
                            badge: surveys.length > 0 ? surveys.length : undefined,
                        },
                    ] : undefined}
                    activeTab={activeTab}
                    onTabChange={(id) => setActiveTab(id as 'assigned' | 'created')}
                    tabsLabel="Vista de las encuestas"
                    actions={
                        canManageSurveys ? (
                            <button className="btn btn-primary" onClick={() => navigate('/surveys/nueva')}>
                                <FiPlus /> Nueva encuesta
                            </button>
                        ) : undefined
                    }
                />

                {/* Offline Banner */}
                {(!isOnline || pendingCount > 0) && (
                    <div className="survey-offline-banner">
                        <span className="survey-offline-banner-icon" aria-hidden="true">
                            <FiWifiOff size={17} />
                        </span>
                        <span className="survey-offline-banner-text">
                            {!isOnline ? (
                                <>
                                    Sin conexión — las respuestas quedan guardadas en este dispositivo.
                                    {pendingCount > 0 && <> <strong>{pendingCount} encuesta{pendingCount === 1 ? '' : 's'}</strong> por sincronizar.</>}
                                </>
                            ) : (
                                <><strong>{pendingCount} encuesta{pendingCount === 1 ? '' : 's'}</strong> por sincronizar.</>
                            )}
                        </span>
                        {isOnline && pendingCount > 0 && (
                            <button className="btn btn-secondary btn-sm" onClick={() => syncPendingSignatures()}>
                                Sincronizar ahora
                            </button>
                        )}
                    </div>
                )}
                {error && (
                    <div className="alert alert-danger">
                        <FiAlertCircle size={20} />
                        <div>{error}</div>
                    </div>
                )}
                {/* Section for workers only - prevencionistas have tabs */}
                {canRespondSurveys && !canManageSurveys && renderAssignedSection()}

                {canManageSurveys && (
                    <>
                        {/* Toolbar: búsqueda, y el toggle "Mostrar" en la misma línea
                            cuando corresponde (solo tiene sentido en "Encuestas creadas"). */}
                        <div className="tbar">
                            <div className="tbar-search">
                                <FiSearch size={15} />
                                <input
                                    type="text"
                                    placeholder="Buscar encuestas…"
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                />
                            </div>
                            {activeTab === 'created' && (
                                <div className="flex items-center gap-3">
                                    <span className="text-sm text-muted">Mostrar:</span>
                                    <div
                                        className="flex gap-1"
                                        style={{
                                            background: 'var(--surface-elevated)',
                                            padding: '4px',
                                            borderRadius: 'var(--radius-lg)',
                                            border: '1px solid var(--surface-border)',
                                        }}
                                    >
                                        <button
                                            className={`btn btn-sm ${!showOnlyMine ? 'btn-primary' : 'btn-ghost'}`}
                                            onClick={() => setShowOnlyMine(false)}
                                            style={{ padding: '6px 12px', fontSize: 'var(--text-sm)' }}
                                        >
                                            Todas ({surveys.length})
                                        </button>
                                        <button
                                            className={`btn btn-sm ${showOnlyMine ? 'btn-primary' : 'btn-ghost'}`}
                                            onClick={() => setShowOnlyMine(true)}
                                            style={{ padding: '6px 12px', fontSize: 'var(--text-sm)' }}
                                        >
                                            Creadas por mí ({mySurveys.length})
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Tab Content: Mis Encuestas (Assigned to me) */}
                        {activeTab === 'assigned' && renderAssignedSection('mb-6')}

                        {/* Tab Content: Encuestas Creadas (Management) */}
                        {activeTab === 'created' && (
                            <>

                                <div className="grid grid-cols-3 gap-4 mb-6">
                                    {loading ? (
                                        <>
                                            <SurveyStatTileSkeleton />
                                            <SurveyStatTileSkeleton />
                                            <SurveyStatTileSkeleton />
                                        </>
                                    ) : (
                                        <>
                                            <div className="survey-stat-tile">
                                                <span className="survey-stat-tile-label">Encuestas creadas</span>
                                                <span className="survey-stat-tile-value">{globalStats.totalSurveys}</span>
                                                <span className="survey-stat-tile-sub">{activeSurveysCount} activa{activeSurveysCount === 1 ? '' : 's'} ahora</span>
                                            </div>
                                            <div className="survey-stat-tile">
                                                <span className="survey-stat-tile-label">Trabajadores alcanzados</span>
                                                <span className="survey-stat-tile-value">{globalStats.totalRecipients}</span>
                                                <span className="survey-stat-tile-sub">de {totalWorkers} en la obra</span>
                                            </div>
                                            <div className="survey-stat-tile">
                                                <span className="survey-stat-tile-label">Tasa de respuesta</span>
                                                <span className="survey-stat-tile-value">{globalStats.completion}%</span>
                                                <div className="progress">
                                                    <div className="progress-bar" style={{ width: `${globalStats.completion}%` }} />
                                                </div>
                                            </div>
                                        </>
                                    )}
                                </div>

                                {loading ? (
                                    <div className="grid grid-cols-2" style={{ gap: 'var(--space-4)' }}>
                                        <SurveyCardSkeleton i={0} />
                                        <SurveyCardSkeleton i={1} />
                                    </div>
                                ) : filteredSurveys.length === 0 ? (
                                    <div className="card">
                                        <div className="empty-state">
                                            <div className="empty-state-icon"><FiClipboard /></div>
                                            <h3 className="empty-state-title">{showOnlyMine ? 'No has creado encuestas' : 'Aún no hay encuestas'}</h3>
                                            <p className="empty-state-description">{showOnlyMine ? 'Las encuestas que crees aparecerán aquí.' : 'Crea tu primera encuesta para recopilar feedback de los trabajadores.'}</p>
                                            <button className="btn btn-primary" onClick={() => navigate('/surveys/nueva')}>
                                                <FiPlus />
                                                Crear Encuesta
                                            </button>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="grid grid-cols-2" style={{ gap: 'var(--space-4)' }}>
                                        {filteredSurveys.map((survey) => {
                                            const total = survey.stats?.totalRecipients || survey.recipients?.length || 0;
                                            const responded = survey.stats?.responded || 0;
                                            const pct = total > 0 ? Math.round((responded / total) * 100) : 0;
                                            const isCompletada = survey.estado === 'completada';
                                            const progressColor = pct >= 100 ? 'var(--success-apagado)' : 'var(--accent)';
                                            return (
                                                <div key={survey.surveyId} className="card" style={{ gap: 'var(--space-3)' }}>
                                                    <div className="flex items-start justify-between gap-3">
                                                        <h3 className="card-title" style={{ margin: 0 }}>{survey.titulo}</h3>
                                                        <span className={`badge ${isCompletada ? 'badge-neutral' : 'badge-accent'}`} style={{ flexShrink: 0 }}>
                                                            {isCompletada ? 'Completada' : 'Activa'}
                                                        </span>
                                                    </div>

                                                    <p className="text-sm text-muted" style={{ margin: 0 }}>{survey.descripcion || 'Sin descripción'}</p>

                                                    <span className="text-xs text-muted">
                                                        Creada el {formatDateTime(survey.createdAt)} · Audiencia: {formatAudience(survey)}
                                                    </span>

                                                    <div
                                                        className="grid grid-cols-4"
                                                        style={{ gap: 'var(--space-2)', padding: 'var(--space-3) 0', borderTop: '1px solid #22303f', borderBottom: '1px solid #22303f' }}
                                                    >
                                                        <div>
                                                            <div className="font-bold">{survey.preguntas?.length || 0}</div>
                                                            <div className="text-xs text-muted">Preguntas</div>
                                                        </div>
                                                        <div>
                                                            <div className="font-bold">{total}</div>
                                                            <div className="text-xs text-muted">Destinatarios</div>
                                                        </div>
                                                        <div>
                                                            <div className="font-bold">{responded}</div>
                                                            <div className="text-xs text-muted">Respondidas</div>
                                                        </div>
                                                        <div>
                                                            <div className="font-bold" style={{ color: progressColor }}>{pct}%</div>
                                                            <div className="text-xs text-muted">Respuesta</div>
                                                        </div>
                                                    </div>

                                                    <div className="progress">
                                                        <div className="progress-bar" style={{ width: `${pct}%`, background: progressColor }} />
                                                    </div>

                                                    <button
                                                        className="btn btn-secondary"
                                                        style={{ width: '100%', justifyContent: 'center' }}
                                                        onClick={() => setSelectedSurvey(survey)}
                                                    >
                                                        Ver detalles
                                                    </button>
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </>
                        )}
                    </>
                )}
                <Modal
                    isOpen={!!responseModal}
                    onClose={closeResponseModal}
                    title="Responder encuesta"
                    subtitle={responseModal?.survey.titulo}
                    size="lg"
                    preventClose={responding}
                    footer={
                        <>
                            <button className="btn btn-secondary" onClick={closeResponseModal}>
                                Cancelar
                            </button>
                            <button
                                className="btn btn-primary"
                                onClick={() => setShowSignatureModal(true)}
                                disabled={responding}
                            >
                                <FiLock />
                                Firmar y Enviar
                            </button>
                        </>
                    }
                >
                    <div className="modal-body" style={{ padding: 0 }}>
                                {responseError && (
                                    <div className="alert alert-danger">
                                        <FiAlertCircle size={20} />
                                        <div>{responseError}</div>
                                    </div>
                                )}

                                <section className="survey-section">
                                    <div className="survey-section-header">
                                        <div>
                                            <p className="survey-section-eyebrow">Preguntas asignadas</p>
                                            <h3>Comparte tu opinión</h3>
                                            <p className="survey-section-description">
                                                Responde cada ítem y envía el formulario cuando estés listo.
                                            </p>
                                        </div>
                                    </div>

                                    <div className="response-question-list">
                                        {responseModal?.survey.preguntas.map((question) => (
                                            <div key={question.questionId} className="response-question">
                                                <div className="response-question-header">
                                                    <div>
                                                        <h4>{question.titulo}</h4>
                                                        {question.descripcion && (
                                                            <p className="text-sm text-muted">{question.descripcion}</p>
                                                        )}
                                                    </div>
                                                    {question.required && <span className="badge badge-danger">Obligatoria</span>}
                                                </div>
                                                {renderResponseField(question)}
                                            </div>
                                        ))}
                                    </div>
                                </section>
                            </div>
                </Modal>

                <Modal
                    isOpen={!!selectedSurvey}
                    onClose={() => setSelectedSurvey(null)}
                    title="Detalles de la encuesta"
                    subtitle={selectedSurvey?.titulo}
                    size="xl"
                    footer={
                        <button className="btn btn-secondary" onClick={() => setSelectedSurvey(null)}>
                            Cerrar
                        </button>
                    }
                >
                    {selectedSurvey && (() => {
                        const isCompletada = selectedSurvey.estado === 'completada';
                        const progressColor = detailCompletion >= 100 ? 'var(--success-apagado)' : 'var(--accent)';
                        return (
                        <div className="modal-body" style={{ padding: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
                            <div className="card" style={{ gap: 'var(--space-2)' }}>
                                <div className="flex items-start justify-between gap-3">
                                    <h3 className="card-title" style={{ margin: 0 }}>{selectedSurvey.titulo}</h3>
                                    <span className={`badge ${isCompletada ? 'badge-neutral' : 'badge-accent'}`} style={{ flexShrink: 0 }}>
                                        {isCompletada ? 'Completada' : 'Activa'}
                                    </span>
                                </div>
                                <p className="text-sm text-muted" style={{ margin: 0 }}>
                                    {selectedSurvey.descripcion || 'Sin descripción disponible'}
                                </p>
                                <span className="text-xs text-muted">
                                    Creada el {formatDateTime(selectedSurvey.createdAt)} · Audiencia: {formatAudience(selectedSurvey)}
                                </span>
                            </div>

                            <div className="grid grid-cols-4 gap-4">
                                <div className="survey-stat-tile">
                                    <span className="survey-stat-tile-label">Destinatarios</span>
                                    <span className="survey-stat-tile-value">{detailStats?.totalRecipients ?? 0}</span>
                                </div>
                                <div className="survey-stat-tile">
                                    <span className="survey-stat-tile-label">Respondidas</span>
                                    <span className="survey-stat-tile-value">{detailStats?.respondedCount ?? 0}</span>
                                </div>
                                <div className="survey-stat-tile">
                                    <span className="survey-stat-tile-label">Pendientes</span>
                                    <span className="survey-stat-tile-value">{detailStats?.pendingCount ?? 0}</span>
                                </div>
                                <div className="survey-stat-tile">
                                    <span className="survey-stat-tile-label">Progreso</span>
                                    <span className="survey-stat-tile-value">{detailCompletion}%</span>
                                    <div className="progress">
                                        <div className="progress-bar" style={{ width: `${detailCompletion}%`, background: progressColor }} />
                                    </div>
                                </div>
                            </div>

                            <section style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, paddingBottom: 'var(--space-3)', borderBottom: '1px solid var(--surface-border)' }}>
                                    <h3 style={{ margin: 0, fontSize: 'var(--text-base)', fontWeight: 700 }}>Preguntas</h3>
                                    <p className="text-sm text-muted" style={{ margin: 0 }}>Tal como las recibió el trabajador.</p>
                                </div>
                                {selectedSurvey.preguntas?.length ? (
                                    <div className="survey-question-list">
                                        {selectedSurvey.preguntas.map((question, index) => (
                                            <div key={question.questionId || `${question.titulo}-${index}`} className="card survey-question-card">
                                                <div className="survey-question-header">
                                                    <span className="survey-question-badge">Pregunta {index + 1}</span>
                                                    <span className="badge badge-neutral">{formatQuestionType(question.tipo)}</span>
                                                </div>
                                                <h4 className="font-semibold mb-2">{question.titulo}</h4>
                                                {question.descripcion && (
                                                    <p className="text-sm text-muted mb-3">{question.descripcion}</p>
                                                )}
                                                {question.tipo === 'multiple' && question.opciones && (
                                                    <div>
                                                        <p className="text-sm font-semibold mb-2">Opciones</p>
                                                        <div className="option-pill-group">
                                                            {question.opciones.map((opcion) => (
                                                                <span key={opcion} className="option-pill">
                                                                    {opcion}
                                                                </span>
                                                            ))}
                                                        </div>
                                                    </div>
                                                )}
                                                {question.tipo === 'escala' && (
                                                    <p className="text-sm text-muted">Escala máxima: {question.escalaMax || 5}</p>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <p className="text-muted text-sm">No hay preguntas registradas.</p>
                                )}
                            </section>

                            <section style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, paddingBottom: 'var(--space-3)', borderBottom: '1px solid var(--surface-border)' }}>
                                    <h3 style={{ margin: 0, fontSize: 'var(--text-base)', fontWeight: 700 }}>Destinatarios</h3>
                                    <p className="text-sm text-muted" style={{ margin: 0 }}>
                                        {detailStats
                                            ? `${detailStats.respondedCount} respondieron · ${detailStats.pendingCount} pendientes`
                                            : 'Sin destinatarios registrados'}
                                    </p>
                                </div>

                                {selectedSurvey.recipients?.length ? (
                                    <div className="table-container" style={{ maxHeight: '300px', overflowY: 'auto' }}>
                                        <table className="table">
                                            <thead>
                                                <tr>
                                                    <th>Trabajador</th>
                                                    <th>RUT</th>
                                                    <th>Cargo</th>
                                                    <th>Estado</th>
                                                    <th>Asignada</th>
                                                    <th>Respondió</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {selectedSurvey.recipients.map((recipient) => (
                                                    <tr key={recipient.workerId}>
                                                        <td>{recipient.nombre}</td>
                                                        <td>{recipient.rut}</td>
                                                        <td>{recipient.cargo || 'Sin cargo'}</td>
                                                        <td>
                                                            <span className={`badge ${recipient.estado === 'respondida' ? 'badge-neutral' : 'badge-accent'}`}>
                                                                {recipient.estado === 'respondida' ? 'Respondida' : 'Pendiente'}
                                                            </span>
                                                        </td>
                                                        <td>{formatDateTime(recipient.respondedAt ? recipient.respondedAt : selectedSurvey.createdAt)}</td>
                                                        <td>{recipient.respondedAt ? formatDateTime(recipient.respondedAt) : '—'}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                ) : (
                                    <p className="text-muted text-sm">No hay trabajadores asignados.</p>
                                )}
                            </section>
                        </div>
                        );
                    })()}
                </Modal>
            </div>

            {/* Signature Modal for Survey Response */}
            <SignatureModal
                isOpen={showSignatureModal}
                onClose={() => setShowSignatureModal(false)}
                onConfirm={handleSubmitResponse}
                type="survey"
                title="Firmar Encuesta"
                itemName={responseModal?.survey.titulo}
                description="Al firmar, confirmas que has respondido esta encuesta de manera veraz y consciente."
                loading={responding}
                error={responseError}
            />
        </>
    );
}
