import { useEffect, useMemo, useState } from 'react';
import type { IconType } from 'react-icons';
import Header from '../components/Header';
import {
    surveysApi,
    workersApi,
    type Survey,
    type SurveyAudienceType,
    type SurveyQuestionType,
    type Worker,
    type CreateSurveyQuestion,
    type SurveyRecipient,
    type SurveyAnswer
} from '../api/client';
import {
    FiPlus,
    FiUsers,
    FiTarget,
    FiCheckCircle,
    FiAlertCircle,
    FiBarChart2,
    FiSend,
    FiEye,
    FiUserCheck,
    FiClipboard,
    FiList,
    FiX,
    FiFileText,
    FiLock,
    FiSearch,
    FiCalendar
} from 'react-icons/fi';
import { useAuth } from '../context/AuthContext';
import SignatureModal from '../components/SignatureModal';
import { useOfflineSignature } from '../hooks/useOfflineSignature';

interface QuestionDraft {
    id: string;
    titulo: string;
    descripcion: string;
    tipo: SurveyQuestionType;
    opciones: string[];
    newOption: string;
    escalaMax: number;
    required: boolean;
}

interface AudienceOption {
    value: SurveyAudienceType;
    label: string;
    description: string;
    icon: IconType;
}

const makeId = () => Math.random().toString(36).substring(2, 10);

const defaultQuestion = (): QuestionDraft => ({
    id: makeId(),
    titulo: '',
    descripcion: '',
    tipo: 'multiple',
    opciones: ['Sí', 'No'],
    newOption: '',
    escalaMax: 5,
    required: true,
});

const audienceOptions: AudienceOption[] = [
    {
        value: 'todos',
        label: 'Toda la organización',
        description: 'Comunica el mensaje a cada trabajador activo',
        icon: FiUsers,
    },
    {
        value: 'cargo',
        label: 'Por cargo',
        description: 'Enfoca la encuesta en perfiles o mandos específicos',
        icon: FiTarget,
    },
    {
        value: 'personalizado',
        label: 'Lista personalizada',
        description: 'Selecciona manualmente quienes deben responder',
        icon: FiUserCheck,
    },
];

export default function Surveys() {
    const { user } = useAuth();
    const { isOnline, pendingCount, signSurvey, syncPendingSignatures } = useOfflineSignature();
    const canManageSurveys = user?.rol === 'admin' || user?.rol === 'prevencionista';
    const canRespondSurveys = user?.rol === 'trabajador' || user?.rol === 'prevencionista';
    const [surveys, setSurveys] = useState<Survey[]>([]);
    const [workers, setWorkers] = useState<Worker[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [showModal, setShowModal] = useState(false);
    const [creating, setCreating] = useState(false);
    const [selectedSurvey, setSelectedSurvey] = useState<Survey | null>(null);
    const [currentWorker, setCurrentWorker] = useState<Worker | null>(null);
    const [responseModal, setResponseModal] = useState<{ survey: Survey; recipient: SurveyRecipient } | null>(null);
    const [responseValues, setResponseValues] = useState<Record<string, string | number>>({});
    const [responding, setResponding] = useState(false);
    const [responseError, setResponseError] = useState('');
    const [notification, setNotification] = useState<{ message: string; type: 'success' | 'error' | 'info' | 'warning' } | null>(null);
    const [activeTab, setActiveTab] = useState<'assigned' | 'created'>('assigned');
    const [showOnlyMine, setShowOnlyMine] = useState(false); // Filter for 'Encuestas Creadas' tab
    const [searchQuery, setSearchQuery] = useState(''); // Search filter for surveys
    const [showSignatureModal, setShowSignatureModal] = useState(false); // Signature modal for survey response

    const [form, setForm] = useState({
        titulo: '',
        descripcion: '',
        audienceType: 'todos' as SurveyAudienceType,
        cargoDestino: '',
        selectedRuts: [] as string[],
        selectedWorkerId: '',
    });

    const [questions, setQuestions] = useState<QuestionDraft[]>([defaultQuestion()]);

    useEffect(() => {
        loadData();
    }, []);

    // Sync pending offline signatures when online
    useEffect(() => {
        if (isOnline && pendingCount > 0) {
            syncPendingSignatures().then(result => {
                if (result.synced > 0) {
                    showNotification(`✅ ${result.synced} firma(s) sincronizada(s)`, 'success');
                    loadData();
                }
            });
        }
    }, [isOnline, pendingCount, syncPendingSignatures]);

    const showNotification = (message: string, type: 'success' | 'error' | 'info' | 'warning' = 'info') => {
        setNotification({ message, type });
        setTimeout(() => setNotification(null), 5000);
    };

    const loadData = async () => {
        setLoading(true);
        setError('');
        try {
            const surveysPromise = surveysApi.list();
            const workersPromise = canManageSurveys
                ? workersApi.list()
                : Promise.resolve({ success: true, data: [] as Worker[] });

            const [surveysRes, workersRes] = await Promise.all([surveysPromise, workersPromise]);

            if (surveysRes.success && surveysRes.data) {
                setSurveys(surveysRes.data.surveys || []);
            } else {
                setError(surveysRes.error || 'No fue posible cargar las encuestas');
            }

            if (canManageSurveys && workersRes.success && workersRes.data) {
                setWorkers(workersRes.data);
            } else if (!canManageSurveys) {
                setWorkers([]);
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

    const cargoOptions = useMemo(() => {
        const cargos = new Set<string>();
        workers.forEach((worker) => {
            if (worker.cargo) cargos.add(worker.cargo);
        });
        return Array.from(cargos).sort();
    }, [workers]);

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

    const assignedSurveys = useMemo(() => {
        if (!currentWorker) return [] as Array<{ survey: Survey; recipient: SurveyRecipient }>;
        return surveys.reduce<Array<{ survey: Survey; recipient: SurveyRecipient }>>((acc, survey) => {
            const recipient = survey.recipients?.find((r) => r.workerId === currentWorker.workerId);
            if (recipient) {
                acc.push({ survey, recipient });
            }
            return acc;
        }, []);
    }, [surveys, currentWorker]);

    // Filter surveys created by the current user
    const mySurveys = useMemo(() => {
        if (!user?.userId) return surveys;
        return surveys.filter((survey) => survey.createdBy === user.userId);
    }, [surveys, user?.userId]);

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

    // Filtered assigned surveys for "Mis Encuestas" tab search
    const filteredAssignedSurveys = useMemo(() => {
        if (!searchQuery.trim()) return assignedSurveys;

        const query = searchQuery.toLowerCase();
        return assignedSurveys.filter(({ survey }) =>
            survey.titulo.toLowerCase().includes(query) ||
            (survey.descripcion && survey.descripcion.toLowerCase().includes(query))
        );
    }, [assignedSurveys, searchQuery]);

    const updateQuestion = (id: string, changes: Partial<QuestionDraft>) => {
        setQuestions((prev) => prev.map((q) => (q.id === id ? { ...q, ...changes } : q)));
    };

    const addQuestion = () => setQuestions((prev) => [...prev, defaultQuestion()]);

    const removeQuestion = (id: string) => {
        setQuestions((prev) => (prev.length > 1 ? prev.filter((q) => q.id !== id) : prev));
    };

    const handleQuestionTypeChange = (id: string, tipo: SurveyQuestionType) => {
        setQuestions((prev) => prev.map((question) => {
            if (question.id !== id) return question;
            const isMultiple = tipo === 'multiple';
            return {
                ...question,
                tipo,
                opciones: isMultiple
                    ? (question.opciones.length > 0 ? question.opciones : ['Opción 1', 'Opción 2'])
                    : [],
                newOption: '',
            };
        }));
    };

    const updateNewOptionValue = (id: string, value: string) => {
        setQuestions((prev) => prev.map((question) => (
            question.id === id ? { ...question, newOption: value } : question
        )));
    };

    const addOptionToQuestion = (id: string) => {
        setQuestions((prev) => prev.map((question) => {
            if (question.id !== id) return question;
            const value = question.newOption.trim();
            if (!value || question.opciones.includes(value)) {
                return question;
            }
            return {
                ...question,
                opciones: [...question.opciones, value],
                newOption: '',
            };
        }));
    };

    const removeOptionFromQuestion = (id: string, option: string) => {
        setQuestions((prev) => prev.map((question) => (
            question.id === id
                ? { ...question, opciones: question.opciones.filter((opt) => opt !== option) }
                : question
        )));
    };

    const resetForm = () => {
        setForm({
            titulo: '',
            descripcion: '',
            audienceType: 'todos',
            cargoDestino: '',
            selectedRuts: [],
            selectedWorkerId: '',
        });
        setQuestions([defaultQuestion()]);
    };

    const handleAddRut = () => {
        if (!form.selectedWorkerId) return;
        const worker = workers.find((w) => w.workerId === form.selectedWorkerId);
        if (!worker) return;
        if (form.selectedRuts.includes(worker.rut)) return;
        setForm((prev) => ({
            ...prev,
            selectedRuts: [...prev.selectedRuts, worker.rut],
            selectedWorkerId: '',
        }));
    };

    const handleRemoveRut = (rut: string) => {
        setForm((prev) => ({
            ...prev,
            selectedRuts: prev.selectedRuts.filter((value) => value !== rut),
        }));
    };

    const buildQuestionsPayload = (): CreateSurveyQuestion[] => {
        return questions.map((question) => ({
            titulo: question.titulo,
            descripcion: question.descripcion,
            tipo: question.tipo,
            opciones: question.tipo === 'multiple'
                ? question.opciones
                : undefined,
            escalaMax: question.tipo === 'escala' ? Number(question.escalaMax || 5) : undefined,
            required: question.required,
        }));
    };

    const handleCreateSurvey = async (event: React.FormEvent) => {
        event.preventDefault();
        setError('');

        const hasEmptyQuestion = questions.some((q) => !q.titulo.trim() || (q.tipo === 'multiple' && q.opciones.length < 2));
        const preguntas = buildQuestionsPayload();
        if (!form.titulo.trim()) {
            setError('El título es obligatorio');
            return;
        }
        if (hasEmptyQuestion) {
            setError('Todas las preguntas deben tener título y opciones válidas');
            return;
        }
        if (form.audienceType === 'cargo' && !form.cargoDestino) {
            setError('Seleccione un cargo destino');
            return;
        }
        if (form.audienceType === 'personalizado' && form.selectedRuts.length === 0) {
            setError('Agregue al menos un RUT para la audiencia personalizada');
            return;
        }

        setCreating(true);
        const payload: any = {
            titulo: form.titulo,
            descripcion: form.descripcion,
            preguntas,
            audience: {
                tipo: form.audienceType,
                cargo: form.audienceType === 'cargo' ? form.cargoDestino : undefined,
                ruts: form.audienceType === 'personalizado' ? form.selectedRuts : undefined,
            },
            createdBy: user?.userId,
            creatorName: user ? `${user.nombre} ${user.apellido || ''}`.trim() : undefined,
        };

        try {
            const response = await surveysApi.create(payload);
            setCreating(false);

            if (response.success && response.data) {
                setSurveys([response.data, ...surveys]);
                setShowModal(false);
                resetForm();
                showNotification('Encuesta creada exitosamente', 'success');
            } else {
                showNotification(response.error || 'No fue posible crear la encuesta.', 'error');
            }
        } catch (err) {
            console.error('Error creando encuesta', err);
            showNotification('Ocurrió un error al crear la encuesta. Intenta nuevamente.', 'error');
        } finally {
            setCreating(false);
            // Refresh data to ensure createdBy is populated from server
            loadData();
            // Dispatch event to refresh sidebar counts
            window.dispatchEvent(new CustomEvent('surveyResponded'));
        }
    };

    const formatAudience = (survey: Survey) => {
        if (survey.audience?.tipo === 'cargo') {
            return `Cargo: ${survey.audience.cargo}`;
        }
        if (survey.audience?.tipo === 'personalizado') {
            return `${survey.audience.ruts?.length || 0} trabajador(es)`;
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
                user.nombre || 'Trabajador',
                responsesPayload,
                pin
            );

            if (!result.success) {
                setResponseError(result.error || 'No fue posible enviar tus respuestas.');
                return;
            }

            if (result.offline) {
                showNotification('📴 Respuesta guardada localmente. Se sincronizará cuando vuelva la conexión.', 'info');
                setShowSignatureModal(false);
                closeResponseModal();
                return;
            }

            // If online, we get the updated survey from the response (in a real scenario, signSurvey should return data)
            // But since we are using a hook that abstracts API calls, we'll just reload data if online
            showNotification('Encuesta respondida exitosamente', 'success');
            setShowSignatureModal(false);
            closeResponseModal();
            loadData();
            // Refresh data to update pending counts
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

    if (loading) {
        return (
            <div className="flex items-center justify-center" style={{ height: '100vh' }}>
                <div className="spinner" />
            </div>
        );
    }

    return (
        <>
            <Header title="Encuestas" />

            {notification && (
                <div className={`notification notification-${notification.type}`} style={{
                    position: 'fixed',
                    top: '20px',
                    right: '20px',
                    zIndex: 10000,
                    padding: 'var(--space-4) var(--space-6)',
                    borderRadius: 'var(--radius-lg)',
                    background: notification.type === 'error' ? 'var(--danger-500)' :
                        notification.type === 'success' ? 'var(--success-500)' :
                            notification.type === 'warning' ? 'var(--warning-500)' : 'var(--primary-500)',
                    color: 'white',
                    boxShadow: 'var(--shadow-lg)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 'var(--space-3)',
                    animation: 'slideIn 0.3s ease-out'
                }}>
                    {notification.type === 'error' && <FiAlertCircle />}
                    {notification.type === 'success' && <FiCheckCircle />}
                    <span>{notification.message}</span>
                </div>
            )}

            <div className="page-content">
                <div className="page-header">
                    <div className="page-header-info">
                        <h2 className="page-header-title">
                            <FiFileText className="text-primary-500" />
                            {canManageSurveys ? 'Diseña y distribuye encuestas' : 'Responde tus encuestas asignadas'}
                        </h2>
                        <p className="page-header-description">
                            Implementa diagnósticos de seguridad, encuestas de clima y evaluaciones rápidas.
                        </p>
                    </div>
                    {canManageSurveys && (
                        <div className="page-header-actions">
                            <button
                                className="btn btn-primary"
                                onClick={() => {
                                    setForm({
                                        titulo: '',
                                        descripcion: '',
                                        audienceType: 'todos',
                                        cargoDestino: '',
                                        selectedRuts: [],
                                        selectedWorkerId: '',
                                    });
                                    setQuestions([defaultQuestion()]);
                                    setShowModal(true);
                                }}
                            >
                                <FiPlus className="mr-2" />
                                Nueva Encuesta
                            </button>
                        </div>
                    )}
                </div>

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
                                    <FiAlertCircle size={18} />
                                    <span className="font-medium">Sin conexión - Tus respuestas se guardarán localmente</span>
                                </>
                            ) : (
                                <>
                                    <FiCheckCircle size={18} />
                                    <span className="font-medium">{pendingCount} encuesta(s) pendiente(s) de sincronizar</span>
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
                {error && (
                    <div className="alert alert-danger">
                        <FiAlertCircle size={20} />
                        <div>{error}</div>
                    </div>
                )}
                {/* Section for workers only - prevencionistas have tabs */}
                {canRespondSurveys && !canManageSurveys && (
                    <section className="survey-section assigned-section">
                        <div className="survey-section-header">
                            <div>
                                <p className="survey-section-eyebrow">Mis encuestas</p>
                                <h3>Seguimiento personal</h3>
                                <p className="survey-section-description">
                                    {filteredAssignedSurveys.length > 0
                                        ? 'Selecciona una encuesta para revisarla o responder.'
                                        : 'Aún no tienes encuestas asignadas.'}
                                </p>
                            </div>
                        </div>

                        {!currentWorker && (
                            <p className="text-muted text-sm">
                                No encontramos un registro de trabajador asociado a tu cuenta. Contacta a tu administrador si debes recibir encuestas.
                            </p>
                        )}

                        {currentWorker && filteredAssignedSurveys.length === 0 && (
                            <p className="text-muted text-sm">No tienes encuestas asignadas por ahora.</p>
                        )}

                        {currentWorker && filteredAssignedSurveys.length > 0 && (
                            <div className="assigned-grid">
                                {filteredAssignedSurveys.map(({ survey, recipient }) => (
                                    <div key={survey.surveyId} className={`assigned-card ${recipient.estado}`}>
                                        <div className="assigned-card-header">
                                            <div>
                                                <h4>{survey.titulo}</h4>
                                                <p className="text-sm text-muted">{survey.descripcion || 'Sin descripción'}</p>
                                            </div>
                                            <span className={`badge ${recipient.estado === 'respondida' ? 'badge-success' : 'badge-warning'}`}>
                                                {recipient.estado === 'respondida' ? 'Respondida' : 'Pendiente'}
                                            </span>
                                        </div>
                                        <div className="assigned-card-meta">
                                            <span>{survey.preguntas?.length || 0} preguntas</span>
                                            <span>
                                                {recipient.estado === 'respondida'
                                                    ? `Respondida el ${formatDateTime(recipient.respondedAt)}`
                                                    : 'Aún pendiente'}
                                            </span>
                                        </div>
                                        <div className="assigned-card-actions">
                                            <button
                                                className="btn btn-secondary"
                                                type="button"
                                                onClick={() => setSelectedSurvey(survey)}
                                            >
                                                <FiEye />
                                                Ver detalles
                                            </button>
                                            <button
                                                className="btn btn-primary"
                                                type="button"
                                                onClick={() => openResponseModal(survey, recipient)}
                                            >
                                                {recipient.estado === 'respondida' ? 'Actualizar respuesta' : 'Responder ahora'}
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </section>
                )}

                {canManageSurveys && (
                    <>
                        {/* Search Bar */}
                        <div className="flex gap-3 mb-4" style={{ alignItems: 'center' }}>
                            <div className="flex items-center gap-2" style={{ flex: 1, background: 'var(--surface-elevated)', border: '1px solid var(--surface-border)', borderRadius: 'var(--radius-lg)', padding: '10px 16px' }}>
                                <FiSearch style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                                <input
                                    type="text"
                                    placeholder="Buscar encuestas..."
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    className="form-control"
                                    style={{ border: 'none', background: 'transparent', padding: 0, boxShadow: 'none', color: 'var(--text-primary)' }}
                                />
                            </div>
                        </div>

                        {/* Tabs for Prevencionistas */}
                        <div
                            className="flex gap-3 mb-6"
                            style={{
                                background: 'var(--surface-elevated)',
                                padding: 'var(--space-2)',
                                borderRadius: 'var(--radius-xl)',
                                border: '1px solid var(--surface-border)',
                                flexWrap: 'wrap',
                                overflow: 'hidden',
                            }}
                        >
                            <button
                                className="flex items-center gap-3"
                                onClick={() => setActiveTab('assigned')}
                                style={{
                                    flex: 1,
                                    minWidth: '140px',
                                    padding: 'var(--space-4)',
                                    borderRadius: 'var(--radius-lg)',
                                    border: activeTab === 'assigned' ? '1px solid var(--warning-400)' : '1px solid transparent',
                                    background: activeTab === 'assigned'
                                        ? 'linear-gradient(135deg, rgba(255, 193, 7, 0.15), rgba(255, 193, 7, 0.05))'
                                        : 'transparent',
                                    cursor: 'pointer',
                                    transition: 'all var(--transition-fast)',
                                    boxShadow: activeTab === 'assigned' ? 'var(--shadow-md)' : 'none',
                                }}
                            >
                                <div
                                    className="avatar"
                                    style={{
                                        background: activeTab === 'assigned' ? 'var(--warning-500)' : 'var(--surface-hover)',
                                        color: activeTab === 'assigned' ? 'white' : 'var(--text-muted)',
                                    }}
                                >
                                    <FiUserCheck size={20} />
                                </div>
                                <div style={{ textAlign: 'left' }}>
                                    <div
                                        style={{
                                            fontWeight: 600,
                                            color: activeTab === 'assigned' ? '#b45309' : 'var(--text-secondary)',
                                            fontSize: 'var(--text-base)',
                                        }}
                                    >
                                        Mis Encuestas
                                    </div>
                                    <div
                                        style={{
                                            fontSize: 'var(--text-sm)',
                                            color: activeTab === 'assigned' ? '#d97706' : 'var(--text-muted)',
                                        }}
                                    >
                                        Seguimiento personal
                                    </div>
                                </div>
                                {filteredAssignedSurveys.filter(s => s.recipient.estado === 'pendiente').length > 0 && (
                                    <span
                                        className="badge"
                                        style={{
                                            marginLeft: 'auto',
                                            background: 'var(--warning-500)',
                                            color: 'white',
                                            fontWeight: 600,
                                            minWidth: '28px',
                                            height: '28px',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            borderRadius: 'var(--radius-full)',
                                        }}
                                    >
                                        {assignedSurveys.filter(s => s.recipient.estado === 'pendiente').length}
                                    </span>
                                )}
                            </button>

                            <button
                                className="flex items-center gap-3"
                                onClick={() => setActiveTab('created')}
                                style={{
                                    flex: 1,
                                    minWidth: '140px',
                                    padding: 'var(--space-4)',
                                    borderRadius: 'var(--radius-lg)',
                                    border: activeTab === 'created' ? '1px solid var(--primary-400)' : '1px solid transparent',
                                    background: activeTab === 'created'
                                        ? 'linear-gradient(135deg, rgba(76, 175, 80, 0.15), rgba(76, 175, 80, 0.05))'
                                        : 'transparent',
                                    cursor: 'pointer',
                                    transition: 'all var(--transition-fast)',
                                    boxShadow: activeTab === 'created' ? 'var(--shadow-md)' : 'none',
                                }}
                            >
                                <div
                                    className="avatar"
                                    style={{
                                        background: activeTab === 'created' ? 'var(--primary-500)' : 'var(--surface-hover)',
                                        color: activeTab === 'created' ? 'white' : 'var(--text-muted)',
                                    }}
                                >
                                    <FiBarChart2 size={20} />
                                </div>
                                <div style={{ textAlign: 'left' }}>
                                    <div
                                        style={{
                                            fontWeight: 600,
                                            color: activeTab === 'created' ? 'var(--primary-700)' : 'var(--text-secondary)',
                                            fontSize: 'var(--text-base)',
                                        }}
                                    >
                                        Encuestas Creadas
                                    </div>
                                    <div
                                        style={{
                                            fontSize: 'var(--text-sm)',
                                            color: activeTab === 'created' ? 'var(--primary-600)' : 'var(--text-muted)',
                                        }}
                                    >
                                        {surveys.length} encuesta{surveys.length !== 1 ? 's' : ''}
                                    </div>
                                </div>
                                {surveys.length > 0 && (
                                    <span
                                        className="badge"
                                        style={{
                                            marginLeft: 'auto',
                                            background: 'var(--primary-500)',
                                            color: 'white',
                                            fontWeight: 600,
                                            minWidth: '28px',
                                            height: '28px',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            borderRadius: 'var(--radius-full)',
                                        }}
                                    >
                                        {surveys.length}
                                    </span>
                                )}
                            </button>
                        </div>

                        {/* Tab Content: Mis Encuestas (Assigned to me) */}
                        {activeTab === 'assigned' && (
                            <section className="survey-section assigned-section mb-6">
                                <div className="survey-section-header">
                                    <div>
                                        <p className="survey-section-eyebrow">Mis encuestas</p>
                                        <h3>Seguimiento personal</h3>
                                        <p className="survey-section-description">
                                            {filteredAssignedSurveys.length > 0
                                                ? 'Selecciona una encuesta para revisarla o responder.'
                                                : 'Aún no tienes encuestas asignadas.'}
                                        </p>
                                    </div>
                                </div>

                                {!currentWorker && (
                                    <p className="text-muted text-sm">
                                        No encontramos un registro de trabajador asociado a tu cuenta. Contacta a tu administrador si debes recibir encuestas.
                                    </p>
                                )}

                                {currentWorker && filteredAssignedSurveys.length === 0 && (
                                    <p className="text-muted text-sm">No tienes encuestas asignadas por ahora.</p>
                                )}

                                {currentWorker && filteredAssignedSurveys.length > 0 && (
                                    <div className="assigned-grid">
                                        {filteredAssignedSurveys.map(({ survey, recipient }) => (
                                            <div key={survey.surveyId} className={`assigned-card ${recipient.estado}`}>
                                                <div className="assigned-card-header">
                                                    <div>
                                                        <h4>{survey.titulo}</h4>
                                                        <p className="text-sm text-muted">{survey.descripcion || 'Sin descripción'}</p>
                                                    </div>
                                                    <span className={`badge ${recipient.estado === 'respondida' ? 'badge-success' : 'badge-warning'}`}>
                                                        {recipient.estado === 'respondida' ? 'Respondida' : 'Pendiente'}
                                                    </span>
                                                </div>
                                                <div className="assigned-card-meta">
                                                    <span>{survey.preguntas?.length || 0} preguntas</span>
                                                    <span>
                                                        {recipient.estado === 'respondida'
                                                            ? `Respondida el ${formatDateTime(recipient.respondedAt)}`
                                                            : 'Aún pendiente'}
                                                    </span>
                                                </div>
                                                <div className="assigned-card-actions">
                                                    <button
                                                        className="btn btn-secondary"
                                                        type="button"
                                                        onClick={() => setSelectedSurvey(survey)}
                                                    >
                                                        <FiEye />
                                                        Ver detalles
                                                    </button>
                                                    <button
                                                        className="btn btn-primary"
                                                        type="button"
                                                        onClick={() => openResponseModal(survey, recipient)}
                                                    >
                                                        {recipient.estado === 'respondida' ? 'Actualizar respuesta' : 'Responder ahora'}
                                                    </button>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </section>
                        )}

                        {/* Tab Content: Encuestas Creadas (Management) */}
                        {activeTab === 'created' && (
                            <>
                                {/* Filter Toggle */}
                                <div className="flex items-center justify-end gap-3 mb-4">
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

                                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                                    <div className="card">
                                        <div className="flex items-center gap-3">
                                            <div className="avatar" style={{ background: 'var(--primary-500)' }}>
                                                <FiBarChart2 />
                                            </div>
                                            <div>
                                                <div className="stat-value" style={{ fontSize: '2rem' }}>{globalStats.totalSurveys}</div>
                                                <div className="text-muted text-sm">Encuestas creadas</div>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="card">
                                        <div className="flex items-center gap-3">
                                            <div className="avatar" style={{ background: 'var(--info-500)' }}>
                                                <FiUsers />
                                            </div>
                                            <div>
                                                <div className="stat-value" style={{ fontSize: '2rem' }}>{globalStats.totalRecipients}</div>
                                                <div className="text-muted text-sm">Trabajadores alcanzados</div>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="card">
                                        <div className="flex items-center gap-3">
                                            <div className="avatar" style={{ background: 'var(--success-500)' }}>
                                                <FiCheckCircle />
                                            </div>
                                            <div>
                                                <div className="stat-value" style={{ fontSize: '2rem' }}>{globalStats.completion}%</div>
                                                <div className="text-muted text-sm">Tasa de respuesta</div>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                {filteredSurveys.length === 0 ? (
                                    <div className="card">
                                        <div className="empty-state">
                                            <div className="empty-state-icon"><FiClipboard /></div>
                                            <h3 className="empty-state-title">{showOnlyMine ? 'No has creado encuestas' : 'Aún no hay encuestas'}</h3>
                                            <p className="empty-state-description">{showOnlyMine ? 'Las encuestas que crees aparecerán aquí.' : 'Crea tu primera encuesta para recopilar feedback de los trabajadores.'}</p>
                                            <button className="btn btn-primary" onClick={() => setShowModal(true)}>
                                                <FiPlus />
                                                Crear Encuesta
                                            </button>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="grid grid-cols-1 md:grid-cols-2" style={{ gap: 'var(--space-4)' }}>
                                        {filteredSurveys.map((survey) => (
                                            <div key={survey.surveyId} className="card">
                                                <div className="card-header">
                                                    <div>
                                                        <h3 className="card-title">{survey.titulo}</h3>
                                                        <p className="card-subtitle">{survey.descripcion || 'Sin descripción'}</p>
                                                    </div>
                                                    <span className={`badge ${survey.estado === 'completada' ? 'badge-success' : 'badge-neutral'}`}>
                                                        {survey.estado}
                                                    </span>
                                                </div>

                                                <div className="flex items-center gap-2 text-xs text-muted">
                                                    <FiCalendar size={14} />
                                                    <span>Creada el {formatDateTime(survey.createdAt)}</span>
                                                </div>

                                                <div className="flex items-center gap-3 mb-4">
                                                    <FiTarget style={{ color: 'var(--text-muted)' }} />
                                                    <span className="text-sm">{formatAudience(survey)}</span>
                                                </div>

                                                <div className="grid grid-cols-4 mb-4" style={{ gap: 'var(--space-3)' }}>
                                                    <div>
                                                        <div className="text-sm text-muted">Preguntas</div>
                                                        <div className="font-bold">{survey.preguntas?.length || 0}</div>
                                                    </div>
                                                    <div>
                                                        <div className="text-sm text-muted">Destinatarios</div>
                                                        <div className="font-bold">{survey.stats?.totalRecipients || survey.recipients?.length || 0}</div>
                                                    </div>
                                                    <div>
                                                        <div className="text-sm text-muted">Respondidas</div>
                                                        <div className="font-bold" style={{ color: 'var(--success-500)' }}>{survey.stats?.responded || 0}</div>
                                                    </div>
                                                    <div>
                                                        <div className="text-sm text-muted">% Respuesta</div>
                                                        <div className="font-bold" style={{ color: 'var(--primary-500)' }}>
                                                            {(() => {
                                                                const total = survey.stats?.totalRecipients || survey.recipients?.length || 0;
                                                                const responded = survey.stats?.responded || 0;
                                                                return total > 0 ? Math.round((responded / total) * 100) : 0;
                                                            })()}%
                                                        </div>
                                                    </div>
                                                </div>

                                                <div className="recipients-summary">
                                                    <div
                                                        className="flex items-center gap-2 text-sm"
                                                        style={{
                                                            padding: 'var(--space-2) var(--space-3)',
                                                            background: 'var(--surface-elevated)',
                                                            borderRadius: 'var(--radius-md)',
                                                            border: '1px solid var(--surface-border)'
                                                        }}
                                                    >
                                                        <FiUsers size={16} style={{ color: 'var(--primary-500)' }} />
                                                        <span style={{ color: 'var(--text-primary)' }}>
                                                            {survey.audience.tipo === 'todos' ? (
                                                                <>Todos los trabajadores ({survey.recipients?.length || 0})</>
                                                            ) : (
                                                                <>{survey.recipients?.length || 0} trabajadores asignados</>
                                                            )}
                                                        </span>
                                                        <span style={{
                                                            marginLeft: 'auto',
                                                            color: 'var(--success-500)',
                                                            fontWeight: 600
                                                        }}>
                                                            {survey.recipients?.filter(r => r.estado === 'respondida').length || 0} respondidas
                                                        </span>
                                                    </div>
                                                </div>

                                                <div className="flex justify-end mt-4">
                                                    <button
                                                        className="btn btn-secondary"
                                                        onClick={() => setSelectedSurvey(survey)}
                                                    >
                                                        <FiEye />
                                                        Ver detalles
                                                    </button>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </>
                        )}
                    </>
                )}
                {canManageSurveys && showModal && (
                    <div className="modal-overlay">
                        <div className="modal" style={{ maxWidth: '900px' }}>
                            <div className="modal-header">
                                <h2 className="modal-title">Nueva Encuesta</h2>
                                <button className="btn btn-ghost btn-icon" onClick={() => { setShowModal(false); resetForm(); }}>
                                    ✕
                                </button>
                            </div>

                            <form className="modal-form" onSubmit={handleCreateSurvey}>
                                <div className="modal-body">
                                    <div className="survey-hero">
                                        <div className="survey-hero-icon">
                                            <FiClipboard size={24} />
                                        </div>
                                        <div>
                                            <p className="survey-hero-eyebrow">Nueva encuesta</p>
                                            <h3>Conecta con tus equipos</h3>
                                            <p>Personaliza cada paso y haz que la experiencia de responder sea memorable.</p>
                                        </div>
                                    </div>

                                    {error && (
                                        <div className="alert alert-danger">
                                            <FiAlertCircle size={20} />
                                            <div>{error}</div>
                                        </div>
                                    )}

                                    <section className="survey-section">
                                        <div className="survey-section-header">
                                            <div>
                                                <p className="survey-section-eyebrow">Paso 1</p>
                                                <h3>Información general</h3>
                                                <p className="survey-section-description">Define el propósito y el tono para que los colaboradores entiendan el contexto.</p>
                                            </div>
                                        </div>
                                        <div className="survey-field-grid">
                                            <div className="form-group">
                                                <label className="form-label">Título *</label>
                                                <input
                                                    className="form-input"
                                                    value={form.titulo}
                                                    onChange={(e) => setForm({ ...form, titulo: e.target.value })}
                                                    placeholder="Ej: Encuesta de clima laboral"
                                                    required
                                                />
                                            </div>
                                            <div className="form-group">
                                                <label className="form-label">Descripción</label>
                                                <textarea
                                                    className="form-input"
                                                    value={form.descripcion}
                                                    onChange={(e) => setForm({ ...form, descripcion: e.target.value })}
                                                    rows={3}
                                                    placeholder="Comparte el objetivo, duración estimada o beneficios."
                                                />
                                            </div>
                                        </div>
                                    </section>

                                    <section className="survey-section">
                                        <div className="survey-section-header">
                                            <div>
                                                <p className="survey-section-eyebrow">Paso 2</p>
                                                <h3>Audiencia destino</h3>
                                                <p className="survey-section-description">Selecciona quiénes recibirán la encuesta para mantenerla relevante.</p>
                                            </div>
                                        </div>
                                        <div className="audience-options">
                                            {audienceOptions.map((option) => {
                                                const Icon = option.icon;
                                                const isActive = form.audienceType === option.value;
                                                return (
                                                    <label key={option.value} className={`audience-card ${isActive ? 'active' : ''}`}>
                                                        <input
                                                            type="radio"
                                                            name="audience"
                                                            style={{ position: 'absolute', opacity: 0, pointerEvents: 'none' }}
                                                            checked={isActive}
                                                            onChange={() => setForm({ ...form, audienceType: option.value })}
                                                        />
                                                        <span className="audience-icon">
                                                            <Icon />
                                                        </span>
                                                        <div>
                                                            <p className="audience-label">{option.label}</p>
                                                            <p className="audience-description">{option.description}</p>
                                                        </div>
                                                    </label>
                                                );
                                            })}
                                        </div>

                                        {form.audienceType === 'cargo' && (
                                            <div className="form-group" style={{ marginTop: 'var(--space-4)' }}>
                                                <label className="form-label">Cargo destino *</label>
                                                <select
                                                    className="form-input form-select"
                                                    value={form.cargoDestino}
                                                    onChange={(e) => setForm({ ...form, cargoDestino: e.target.value })}
                                                    required
                                                >
                                                    <option value="">Seleccione un cargo</option>
                                                    {cargoOptions.map((cargo) => (
                                                        <option key={cargo} value={cargo}>{cargo}</option>
                                                    ))}
                                                </select>
                                            </div>
                                        )}

                                        {form.audienceType === 'personalizado' && (
                                            <div className="form-group" style={{ marginTop: 'var(--space-4)' }}>
                                                <label className="form-label">Seleccionar por RUT *</label>
                                                <div className="option-input-row">
                                                    <select
                                                        className="form-input"
                                                        value={form.selectedWorkerId}
                                                        onChange={(e) => setForm({ ...form, selectedWorkerId: e.target.value })}
                                                        style={{ minWidth: '240px' }}
                                                    >
                                                        <option value="">Seleccionar trabajador</option>
                                                        {workers.map((worker) => (
                                                            <option key={worker.workerId} value={worker.workerId}>
                                                                {worker.nombre} {worker.apellido} - {worker.rut}
                                                            </option>
                                                        ))}
                                                    </select>
                                                    <button type="button" className="btn btn-secondary" onClick={handleAddRut}>
                                                        <FiPlus />
                                                        Agregar
                                                    </button>
                                                </div>
                                                {form.selectedRuts.length > 0 && (
                                                    <div className="option-pill-group">
                                                        {form.selectedRuts.map((rut) => (
                                                            <span key={rut} className="option-pill">
                                                                {rut}
                                                                <button type="button" onClick={() => handleRemoveRut(rut)}>
                                                                    <FiX />
                                                                </button>
                                                            </span>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                    </section>

                                    <section className="survey-section">
                                        <div className="survey-section-header">
                                            <div>
                                                <p className="survey-section-eyebrow">Paso 3</p>
                                                <h3>Diseña las preguntas</h3>
                                                <p className="survey-section-description">Alterna tipos de pregunta y define si cada una será obligatoria.</p>
                                            </div>
                                            <button type="button" className="btn btn-secondary btn-sm" onClick={addQuestion}>
                                                <FiPlus />
                                                Agregar pregunta
                                            </button>
                                        </div>

                                        <div className="flex flex-col gap-4">
                                            {questions.map((question, index) => (
                                                <div key={question.id} className="card survey-question-card">
                                                    <div className="survey-question-header">
                                                        <span className="survey-question-badge">
                                                            <FiList size={16} />
                                                            Pregunta {index + 1}
                                                        </span>
                                                        {questions.length > 1 && (
                                                            <button type="button" className="btn btn-ghost btn-sm" onClick={() => removeQuestion(question.id)}>
                                                                Eliminar
                                                            </button>
                                                        )}
                                                    </div>

                                                    <input
                                                        className="form-input mb-3"
                                                        value={question.titulo}
                                                        onChange={(e) => updateQuestion(question.id, { titulo: e.target.value })}
                                                        placeholder="Texto de la pregunta"
                                                        required
                                                    />

                                                    <textarea
                                                        className="form-input mb-3"
                                                        value={question.descripcion}
                                                        onChange={(e) => updateQuestion(question.id, { descripcion: e.target.value })}
                                                        rows={2}
                                                        placeholder="Agrega contexto, instrucciones o ejemplos (opcional)"
                                                    />

                                                    <div className="flex gap-3 mb-3" style={{ flexWrap: 'wrap' }}>
                                                        <select
                                                            className="form-input form-select"
                                                            value={question.tipo}
                                                            onChange={(e) => handleQuestionTypeChange(question.id, e.target.value as SurveyQuestionType)}
                                                            style={{ minWidth: '220px' }}
                                                        >
                                                            <option value="multiple">Selección múltiple</option>
                                                            <option value="escala">Escala (1 a N)</option>
                                                            <option value="abierta">Pregunta abierta</option>
                                                        </select>

                                                        <label className="flex items-center gap-2" style={{ cursor: 'pointer' }}>
                                                            <input
                                                                type="checkbox"
                                                                checked={question.required}
                                                                onChange={(e) => updateQuestion(question.id, { required: e.target.checked })}
                                                            />
                                                            Pregunta obligatoria
                                                        </label>
                                                    </div>

                                                    {question.tipo === 'multiple' && (
                                                        <div className="option-builder">
                                                            <label className="form-label">Opciones de respuesta</label>
                                                            <div className="option-input-row">
                                                                <input
                                                                    className="form-input"
                                                                    value={question.newOption}
                                                                    onChange={(e) => updateNewOptionValue(question.id, e.target.value)}
                                                                    placeholder="Ej: Siempre"
                                                                />
                                                                <button
                                                                    type="button"
                                                                    className="btn btn-secondary"
                                                                    onClick={() => addOptionToQuestion(question.id)}
                                                                    disabled={!question.newOption.trim()}
                                                                >
                                                                    <FiPlus />
                                                                    Agregar opción
                                                                </button>
                                                            </div>
                                                            {question.opciones.length > 0 && (
                                                                <div className="option-pill-group">
                                                                    {question.opciones.map((option) => (
                                                                        <span key={option} className="option-pill">
                                                                            {option}
                                                                            <button type="button" onClick={() => removeOptionFromQuestion(question.id, option)}>
                                                                                <FiX />
                                                                            </button>
                                                                        </span>
                                                                    ))}
                                                                </div>
                                                            )}
                                                        </div>
                                                    )}

                                                    {question.tipo === 'escala' && (
                                                        <div className="form-group">
                                                            <label className="form-label">Valor máximo</label>
                                                            <input
                                                                type="number"
                                                                min={1}
                                                                className="form-input"
                                                                value={question.escalaMax}
                                                                onChange={(e) => updateQuestion(question.id, { escalaMax: Number(e.target.value) })}
                                                            />
                                                            <p className="form-hint">Los colaboradores evaluarán en un rango de 1 a este valor.</p>
                                                        </div>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    </section>
                                </div>

                                <div className="modal-footer">
                                    <button type="button" className="btn btn-secondary" onClick={() => { setShowModal(false); resetForm(); }}>
                                        Cancelar
                                    </button>
                                    <button type="submit" className="btn btn-primary" disabled={creating}>
                                        {creating ? (
                                            <div className="spinner" />
                                        ) : (
                                            <>
                                                <FiSend />
                                                Crear y enviar
                                            </>
                                        )}
                                    </button>
                                </div>
                            </form>
                        </div>
                    </div>
                )}

                {responseModal && (
                    <div className="modal-overlay">
                        <div className="modal" style={{ maxWidth: '720px' }}>
                            <div className="modal-header">
                                <div>
                                    <h2 className="modal-title">Responder encuesta</h2>
                                    <p className="text-muted text-sm">{responseModal.survey.titulo}</p>
                                </div>
                                <button className="btn btn-ghost btn-icon" onClick={closeResponseModal}>
                                    ✕
                                </button>
                            </div>

                            <div className="modal-body">
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
                                        {responseModal.survey.preguntas.map((question) => (
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

                            <div className="modal-footer">
                                <button className="btn" onClick={closeResponseModal}>
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
                            </div>
                        </div>
                    </div>
                )}

                {selectedSurvey && (
                    <div className="modal-overlay">
                        <div className="modal" style={{ maxWidth: '900px' }}>
                            <div className="modal-header">
                                <div>
                                    <h2 className="modal-title">Detalles de la encuesta</h2>
                                    <p className="text-muted text-sm">{selectedSurvey.titulo}</p>
                                </div>
                                <button className="btn btn-ghost btn-icon" onClick={() => setSelectedSurvey(null)}>
                                    ✕
                                </button>
                            </div>

                            <div className="modal-body">
                                <div className="survey-detail-hero">
                                    <div>
                                        <p className="survey-section-eyebrow">Encuesta {selectedSurvey.estado}</p>
                                        <h3>{selectedSurvey.titulo}</h3>
                                        <p className="survey-section-description">
                                            {selectedSurvey.descripcion || 'Sin descripción disponible'}
                                        </p>
                                    </div>
                                    <div className="survey-detail-meta">
                                        <span className="badge badge-neutral">{formatAudience(selectedSurvey)}</span>
                                        <span className="badge badge-neutral">Creada: {formatDateTime(selectedSurvey.createdAt)}</span>
                                    </div>
                                </div>

                                <div className="survey-stats-grid">
                                    <div className="survey-stat-card">
                                        <div className="survey-stat-icon">
                                            <FiUsers />
                                        </div>
                                        <div>
                                            <p className="survey-stat-label">Destinatarios</p>
                                            <p className="survey-stat-value">{detailStats?.totalRecipients ?? 0}</p>
                                        </div>
                                    </div>
                                    <div className="survey-stat-card">
                                        <div className="survey-stat-icon" style={{ background: 'rgba(34, 197, 94, 0.15)', color: 'var(--success-500)' }}>
                                            <FiCheckCircle />
                                        </div>
                                        <div>
                                            <p className="survey-stat-label">Respondidas</p>
                                            <p className="survey-stat-value">{detailStats?.respondedCount ?? 0}</p>
                                        </div>
                                    </div>
                                    <div className="survey-stat-card">
                                        <div className="survey-stat-icon" style={{ background: 'rgba(234, 179, 8, 0.15)', color: 'var(--warning-500)' }}>
                                            <FiAlertCircle />
                                        </div>
                                        <div>
                                            <p className="survey-stat-label">Pendientes</p>
                                            <p className="survey-stat-value">{detailStats?.pendingCount ?? 0}</p>
                                        </div>
                                    </div>
                                    <div className="survey-stat-card">
                                        <div className="survey-stat-icon" style={{ background: 'rgba(59, 130, 246, 0.15)', color: 'var(--info-500)' }}>
                                            <FiBarChart2 />
                                        </div>
                                        <div>
                                            <p className="survey-stat-label">Progreso</p>
                                            <p className="survey-stat-value">{detailCompletion}%</p>
                                        </div>
                                    </div>
                                </div>

                                <section className="survey-section">
                                    <div className="survey-section-header">
                                        <div>
                                            <p className="survey-section-eyebrow">Bloque de preguntas</p>
                                            <h3>Preguntas enviadas</h3>
                                            <p className="survey-section-description">Visualiza el detalle de cada ítem tal como lo recibió el colaborador.</p>
                                        </div>
                                    </div>
                                    {selectedSurvey.preguntas?.length ? (
                                        <div className="survey-question-list">
                                            {selectedSurvey.preguntas.map((question, index) => (
                                                <div key={question.questionId || `${question.titulo}-${index}`} className="card survey-question-card">
                                                    <div className="survey-question-header">
                                                        <span className="survey-question-badge">
                                                            <FiList size={16} />
                                                            Pregunta {index + 1}
                                                        </span>
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

                                <section className="survey-section">
                                    <div className="survey-section-header">
                                        <div>
                                            <p className="survey-section-eyebrow">Destinatarios</p>
                                            <h3>Estado de respuestas</h3>
                                            <p className="survey-section-description">
                                                {detailStats
                                                    ? `${detailStats.respondedCount} respondieron · ${detailStats.pendingCount} pendientes`
                                                    : 'Sin destinatarios registrados'}
                                            </p>
                                        </div>
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
                                                                <span className={`badge ${recipient.estado === 'respondida' ? 'badge-success' : 'badge-neutral'}`}>
                                                                    {recipient.estado}
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

                            <div className="modal-footer">
                                <button className="btn" onClick={() => setSelectedSurvey(null)}>
                                    Cerrar
                                </button>
                            </div>
                        </div>
                    </div>
                )}
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
            <style>{`
                @keyframes slideIn {
                    from { transform: translateX(100%); opacity: 0; }
                    to { transform: translateX(0); opacity: 1; }
                }

                .notification {
                    transition: all 0.3s ease;
                }

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

                .survey-card {
                    padding: var(--space-6);
                    background: var(--surface-elevated);
                    border-radius: var(--radius-lg);
                    border: 1px solid var(--surface-border);
                    transition: all 0.3s ease;
                    display: flex;
                    flex-direction: column;
                    gap: var(--space-4);
                }

                .survey-card:hover {
                    transform: translateY(-4px);
                    box-shadow: var(--shadow-lg);
                    border-color: var(--primary-500);
                }
            `}</style>
        </>
    );
}
