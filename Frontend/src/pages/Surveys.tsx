import { useEffect, useMemo, useState } from 'react';
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
    FiTrash2,
    FiSend
} from 'react-icons/fi';

interface QuestionDraft {
    id: string;
    titulo: string;
    descripcion: string;
    tipo: SurveyQuestionType;
    opcionesText: string;
    escalaMax: number;
    required: boolean;
}

const makeId = () => Math.random().toString(36).substring(2, 10);

const defaultQuestion = (): QuestionDraft => ({
    id: makeId(),
    titulo: '',
    descripcion: '',
    tipo: 'multiple',
    opcionesText: 'Sí\nNo',
    escalaMax: 5,
    required: true,
});

export default function Surveys() {
    const [surveys, setSurveys] = useState<Survey[]>([]);
    const [workers, setWorkers] = useState<Worker[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [showModal, setShowModal] = useState(false);
    const [creating, setCreating] = useState(false);

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
                ? question.opcionesText.split('\n').map((opt) => opt.trim()).filter(Boolean)
                : undefined,
            escalaMax: question.tipo === 'escala' ? Number(question.escalaMax || 5) : undefined,
            required: question.required,
        }));
    };

    const handleCreateSurvey = async (event: React.FormEvent) => {
        event.preventDefault();
        setError('');

        const preguntas = buildQuestionsPayload();
        const hasEmptyQuestion = preguntas.some((q) => !q.titulo || (q.tipo === 'multiple' && (!q.opciones || q.opciones.length < 2)));
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

                        <form onSubmit={handleCreateSurvey}>
                            <div className="modal-body" style={{ maxHeight: '70vh', overflowY: 'auto' }}>
                                {error && (
                                    <div className="alert alert-danger">
                                        <FiAlertCircle size={20} />
                                        <div>{error}</div>
                                    </div>
                                )}

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
                                        placeholder="Objetivo de la encuesta"
                                    />
                                </div>

                                <div className="form-group">
                                    <label className="form-label">Audiencia destino *</label>
                                    <div className="flex gap-3" style={{ flexWrap: 'wrap' }}>
                                        {(['todos', 'cargo', 'personalizado'] as SurveyAudienceType[]).map((option) => (
                                            <label key={option} className="flex items-center gap-2" style={{ cursor: 'pointer' }}>
                                                <input
                                                    type="radio"
                                                    name="audience"
                                                    checked={form.audienceType === option}
                                                    onChange={() => setForm({ ...form, audienceType: option })}
                                                />
                                                <span style={{ textTransform: 'capitalize' }}>{option}</span>
                                            </label>
                                        ))}
                                    </div>
                                </div>

                                {form.audienceType === 'cargo' && (
                                    <div className="form-group">
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
                                    <div className="form-group">
                                        <label className="form-label">Seleccionar por RUT *</label>
                                        <div className="flex gap-2" style={{ flexWrap: 'wrap' }}>
                                            <select
                                                className="form-input"
                                                value={form.selectedWorkerId}
                                                onChange={(e) => setForm({ ...form, selectedWorkerId: e.target.value })}
                                                style={{ minWidth: '260px' }}
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
                                        <div className="flex gap-2" style={{ flexWrap: 'wrap', marginTop: 'var(--space-3)' }}>
                                            {form.selectedRuts.map((rut) => (
                                                <span key={rut} className="badge badge-neutral" style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                                                    {rut}
                                                    <button type="button" className="btn btn-ghost btn-icon" onClick={() => handleRemoveRut(rut)}>
                                                        <FiTrash2 />
                                                    </button>
                                                </span>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                <div className="form-group">
                                    <div className="flex items-center justify-between mb-3">
                                        <label className="form-label">Preguntas *</label>
                                        <button type="button" className="btn btn-secondary btn-sm" onClick={addQuestion}>
                                            <FiPlus />
                                            Agregar pregunta
                                        </button>
                                    </div>

                                    <div className="flex flex-col gap-4">
                                        {questions.map((question, index) => (
                                            <div key={question.id} className="card" style={{ padding: 'var(--space-4)' }}>
                                                <div className="flex items-center justify-between mb-3">
                                                    <h4 className="font-bold">Pregunta {index + 1}</h4>
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
                                                    placeholder="Descripción u orientación (opcional)"
                                                />

                                                <div className="flex gap-3 mb-3" style={{ flexWrap: 'wrap' }}>
                                                    <select
                                                        className="form-input form-select"
                                                        value={question.tipo}
                                                        onChange={(e) => updateQuestion(question.id, { tipo: e.target.value as SurveyQuestionType })}
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
                                                        Requerida
                                                    </label>
                                                </div>

                                                {question.tipo === 'multiple' && (
                                                    <div className="form-group">
                                                        <label className="form-label">Opciones (una por línea)</label>
                                                        <textarea
                                                            className="form-input"
                                                            value={question.opcionesText}
                                                            onChange={(e) => updateQuestion(question.id, { opcionesText: e.target.value })}
                                                            rows={3}
                                                        />
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
                                                    </div>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                </div>
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
        </>
    );
}
