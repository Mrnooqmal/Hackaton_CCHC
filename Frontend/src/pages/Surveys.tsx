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
    type CreateSurveyQuestion
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
    FiX
} from 'react-icons/fi';

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
    const [surveys, setSurveys] = useState<Survey[]>([]);
    const [workers, setWorkers] = useState<Worker[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [showModal, setShowModal] = useState(false);
    const [creating, setCreating] = useState(false);
    const [selectedSurvey, setSelectedSurvey] = useState<Survey | null>(null);

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

    const loadData = async () => {
        setLoading(true);
        setError('');
        try {
            const [surveysRes, workersRes] = await Promise.all([
                surveysApi.list(),
                workersApi.list(),
            ]);

            if (surveysRes.success && surveysRes.data) {
                setSurveys(surveysRes.data.surveys || []);
            } else {
                setError(surveysRes.error || 'No fue posible cargar las encuestas');
            }

            if (workersRes.success && workersRes.data) {
                setWorkers(workersRes.data);
            }
        } catch (err) {
            console.error(err);
            setError('Error de conexión al cargar encuestas');
        } finally {
            setLoading(false);
        }
    };

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
        const payload = {
            titulo: form.titulo,
            descripcion: form.descripcion,
            preguntas,
            audienceType: form.audienceType,
            cargoDestino: form.audienceType === 'cargo' ? form.cargoDestino : undefined,
            ruts: form.audienceType === 'personalizado' ? form.selectedRuts : undefined,
        };

        const response = await surveysApi.create(payload);
        setCreating(false);

        if (!response.success || !response.data) {
            setError(response.error || 'No fue posible crear la encuesta');
            return;
        }

        setSurveys((prev) => [response.data, ...prev]);
        setShowModal(false);
        resetForm();
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

    const formatDateTime = (value?: string | null) => {
        if (!value) return '—';
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return value;
        return date.toLocaleString('es-CL', {
            dateStyle: 'medium',
            timeStyle: 'short',
        });
    };

    const detailStats = selectedSurvey ? getRecipientStats(selectedSurvey) : null;
    const detailCompletion = detailStats && detailStats.totalRecipients > 0
        ? Math.round((detailStats.respondedCount / detailStats.totalRecipients) * 100)
        : 0;

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

            <div className="page-content">
                <div className="flex items-center justify-between mb-6">
                    <div>
                        <h2 className="text-xl font-bold">Diseña y distribuye encuestas</h2>
                        <p className="text-muted">Selecciona a quién va dirigida cada encuesta y monitorea la participación</p>
                    </div>
                    <button className="btn btn-primary" onClick={() => setShowModal(true)}>
                        <FiPlus />
                        Nueva Encuesta
                    </button>
                </div>

                {error && (
                    <div className="alert alert-danger">
                        <FiAlertCircle size={20} />
                        <div>{error}</div>
                    </div>
                )}

                <div className="grid grid-cols-3 mb-6">
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

                {surveys.length === 0 ? (
                    <div className="card">
                        <div className="empty-state">
                            <div className="empty-state-icon">📝</div>
                            <h3 className="empty-state-title">Aún no hay encuestas</h3>
                            <p className="empty-state-description">Crea tu primera encuesta para recopilar feedback de los trabajadores.</p>
                            <button className="btn btn-primary" onClick={() => setShowModal(true)}>
                                <FiPlus />
                                Crear Encuesta
                            </button>
                        </div>
                    </div>
                ) : (
                    <div className="grid grid-cols-2">
                        {surveys.map((survey) => (
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

                                <div className="flex items-center gap-3 mb-4">
                                    <FiTarget style={{ color: 'var(--text-muted)' }} />
                                    <span className="text-sm">{formatAudience(survey)}</span>
                                </div>

                                <div className="grid grid-cols-3 mb-4" style={{ gap: 'var(--space-3)' }}>
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
                                </div>

                                <div className="flex flex-wrap gap-2">
                                    {(survey.recipients || []).slice(0, 6).map((recipient) => (
                                        <span
                                            key={recipient.workerId}
                                            className={`badge ${recipient.estado === 'respondida' ? 'badge-success' : 'badge-neutral'}`}
                                        >
                                            {recipient.nombre} - {recipient.estado}
                                        </span>
                                    ))}
                                    {(survey.recipients || []).length > 6 && (
                                        <span className="text-sm text-muted">+{(survey.recipients || []).length - 6} más</span>
                                    )}
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
            </div>

            {showModal && (
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
                                                        <td>{formatDateTime(recipient.respondedAt)}</td>
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
        </>
    );
}
