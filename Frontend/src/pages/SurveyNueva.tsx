import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { FiPlus, FiX, FiTrash2 } from 'react-icons/fi';
import {
    surveysApi,
    workersApi,
    inboxApi,
    type SurveyAudienceType,
    type SurveyQuestionType,
    type Worker,
    type CreateSurveyQuestion,
} from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { FormPage, FieldSection, PageHeader, Select } from '../components/ui';
import WorkerPicker from '../components/actividades/WorkerPicker';

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
        description: 'Todos los trabajadores activos en esta obra.',
    },
    {
        value: 'cargo',
        label: 'Por cargo',
        description: 'Llega a todas las personas con el cargo elegido.',
    },
    {
        value: 'personalizado',
        label: 'Lista personalizada',
        description: 'Selecciona manualmente quiénes deben responder.',
    },
];

export default function SurveyNueva() {
    const navigate = useNavigate();
    const location = useLocation();
    const { user } = useAuth();
    const { toast } = useToast();

    const [workers, setWorkers] = useState<Worker[]>([]);
    const [creating, setCreating] = useState(false);
    const [error, setError] = useState('');

    const [form, setForm] = useState({
        titulo: '',
        descripcion: '',
        audienceType: 'todos' as SurveyAudienceType,
        cargoDestino: '',
        selectedPersonaIds: [] as string[],
        // Vínculo con un ítem de onboarding (si se asignó desde el Equipo).
        kitItemKey: '' as string,
    });
    const [questions, setQuestions] = useState<QuestionDraft[]>([defaultQuestion()]);
    const [audienceSearch, setAudienceSearch] = useState('');

    // Prefill desde el Equipo de la obra: "Asignar encuesta" precargada a una
    // persona (llega por RUT); resolverlo a personaId necesita la planilla
    // cargada, así que va junto con esa carga, no en un efecto aparte.
    useEffect(() => {
        workersApi.list().then((res) => {
            if (!res.success || !res.data) return;
            const data: Worker[] = res.data;
            setWorkers(data);

            const prefill = (location.state as any)?.prefill;
            if (!prefill?.rut) return;
            const match = data.find((w) => w.rut === prefill.rut);
            setForm((prev) => ({
                ...prev,
                audienceType: 'personalizado',
                selectedPersonaIds: match ? [match.personaId] : prev.selectedPersonaIds,
                titulo: prefill.titulo ? `Encuesta: ${prefill.titulo}` : prev.titulo,
                kitItemKey: prefill.kitItemKey || '',
            }));
            window.history.replaceState({}, ''); // evita reaplicar el prefill al volver
        }).catch(() => {});
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const toggleAudiencePersona = (personaId: string) => {
        setForm((prev) => ({
            ...prev,
            selectedPersonaIds: prev.selectedPersonaIds.includes(personaId)
                ? prev.selectedPersonaIds.filter((id) => id !== personaId)
                : [...prev.selectedPersonaIds, personaId],
        }));
    };

    const cargoOptions = useMemo(() => {
        const cargos = new Set<string>();
        workers.forEach((worker) => {
            if (worker.cargo) cargos.add(worker.cargo);
        });
        return Array.from(cargos).sort();
    }, [workers]);

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

    const buildQuestionsPayload = (): CreateSurveyQuestion[] => {
        return questions.map((question) => ({
            titulo: question.titulo,
            descripcion: question.descripcion,
            tipo: question.tipo,
            opciones: question.tipo === 'multiple' ? question.opciones : undefined,
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
            setError('Selecciona un cargo destino');
            return;
        }
        if (form.audienceType === 'personalizado' && form.selectedPersonaIds.length === 0) {
            setError('Selecciona al menos una persona para la audiencia personalizada');
            return;
        }

        const selectedRuts = workers
            .filter((w) => form.selectedPersonaIds.includes(w.personaId))
            .map((w) => w.rut);

        setCreating(true);
        const payload: any = {
            titulo: form.titulo,
            descripcion: form.descripcion,
            preguntas,
            // El backend lee estos campos a nivel raíz (no anidados en `audience`).
            audienceType: form.audienceType,
            cargoDestino: form.audienceType === 'cargo' ? form.cargoDestino : undefined,
            ruts: form.audienceType === 'personalizado' ? selectedRuts : undefined,
            kitItemKey: form.kitItemKey || undefined,
            createdBy: user?.personaId || user?.userId,
            creatorName: user ? `${user.nombre} ${user.apellido || ''}`.trim() : undefined,
        };

        try {
            const response = await surveysApi.create(payload);
            if (response.success && response.data) {
                try {
                    const recipientsRes = await inboxApi.getRecipients(user?.personaId || user?.userId || '', user?.tenantId || user?.empresaId || '');
                    if (recipientsRes.success && recipientsRes.data) {
                        const allRecipients = recipientsRes.data.recipients;
                        let assignedRuts: string[] = [];

                        if (form.audienceType === 'todos') {
                            assignedRuts = workers.filter((w) => w.habilitado).map((w) => w.rut);
                        } else if (form.audienceType === 'cargo' && form.cargoDestino) {
                            assignedRuts = workers.filter((w) => w.habilitado && w.cargo === form.cargoDestino).map((w) => w.rut);
                        } else if (form.audienceType === 'personalizado') {
                            assignedRuts = selectedRuts;
                        }

                        const recipientUserIds = allRecipients.filter((r) => assignedRuts.includes(r.rut)).map((r) => r.userId);

                        if (recipientUserIds.length > 0) {
                            await inboxApi.send({
                                senderId: user?.personaId || user?.userId || 'system',
                                senderName: user ? `${user.nombre} ${user.apellido || ''}`.trim() : 'PrevencionApp',
                                senderRol: 'system',
                                recipientIds: recipientUserIds,
                                type: 'task',
                                priority: 'normal',
                                subject: `Nueva encuesta asignada: ${response.data.titulo}`,
                                content: `Se te ha asignado la encuesta "${response.data.titulo}". Por favor responde a la brevedad.`,
                                linkedEntity: { type: 'survey', id: response.data.surveyId },
                            });
                        }
                    }
                } catch (notifErr) {
                    console.error('Error mandando notificación desde frontend', notifErr);
                }

                toast.success('Encuesta creada correctamente');
                window.dispatchEvent(new CustomEvent('surveyResponded'));
                navigate('/surveys');
            } else {
                setError(response.error || 'No fue posible crear la encuesta.');
            }
        } catch (err) {
            console.error('Error creando encuesta', err);
            setError('Ocurrió un error al crear la encuesta. Intenta nuevamente.');
        } finally {
            setCreating(false);
        }
    };

    return (
        <>
            <div className="page-content">
                <PageHeader
                    banner
                    title="Nueva encuesta"
                    description="Queda visible para sus destinatarios apenas se crea."
                />
            </div>

            <FormPage
                maxWidth={960}
                onSubmit={handleCreateSurvey}
                header={<></>}
                actions={
                    <>
                        {error ? (
                            <span style={{ marginRight: 'auto', fontSize: 'var(--text-sm)', color: 'var(--danger-600)' }}>
                                {error}
                            </span>
                        ) : (
                            <span style={{ marginRight: 'auto', fontSize: '12px', color: 'var(--text-muted)' }}>
                                Se notifica a cada destinatario en su bandeja al crearse.
                            </span>
                        )}
                        <button type="button" className="btn btn-secondary" onClick={() => navigate('/surveys')}>
                            Cancelar
                        </button>
                        <button type="submit" className="btn btn-primary" disabled={creating}>
                            {creating ? 'Creando…' : 'Crear encuesta'}
                        </button>
                    </>
                }
            >
                <FieldSection title="Información general" inline cols={3}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)', gridColumn: '1 / -1' }}>
                        <label className="form-label">Título <span style={{ color: 'var(--accent-text)' }}>*</span></label>
                        <input
                            className="form-input"
                            value={form.titulo}
                            onChange={(e) => setForm((prev) => ({ ...prev, titulo: e.target.value }))}
                            placeholder="Ej: Charla de percepción de riesgos"
                        />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)', gridColumn: '1 / -1' }}>
                        <label className="form-label">Descripción</label>
                        <textarea
                            className="form-input"
                            rows={3}
                            value={form.descripcion}
                            onChange={(e) => setForm((prev) => ({ ...prev, descripcion: e.target.value }))}
                            placeholder="Comparte el objetivo, duración estimada o beneficios."
                        />
                    </div>
                </FieldSection>

                <FieldSection title="Audiencia destino" inline description="Elige a quién le llega esta encuesta">
                    <div style={{ gridColumn: '1 / -1' }}>
                        <div className="audience-options">
                            {audienceOptions.map((option) => {
                                const isActive = form.audienceType === option.value;
                                return (
                                    <label key={option.value} className={`audience-card ${isActive ? 'active' : ''}`}>
                                        <input
                                            type="radio"
                                            name="audience"
                                            className="radio-input custom-radio"
                                            checked={isActive}
                                            onChange={() => setForm((prev) => ({ ...prev, audienceType: option.value }))}
                                        />
                                        <div>
                                            <p className="audience-label">{option.label}</p>
                                            <p className="audience-description">{option.description}</p>
                                        </div>
                                    </label>
                                );
                            })}
                        </div>

                        {form.audienceType === 'cargo' && (
                            <div className="form-group" style={{ marginTop: 'var(--space-4)', maxWidth: 340 }}>
                                <label className="form-label">Cargo destino <span style={{ color: 'var(--accent-text)' }}>*</span></label>
                                <Select
                                    ariaLabel="Cargo destino"
                                    placeholder="Selecciona un cargo"
                                    searchable
                                    value={form.cargoDestino}
                                    onChange={(v) => setForm((prev) => ({ ...prev, cargoDestino: v }))}
                                    options={cargoOptions.map((cargo) => ({ value: cargo, label: cargo }))}
                                />
                            </div>
                        )}

                        {form.audienceType === 'personalizado' && (
                            <div style={{ marginTop: 'var(--space-4)' }}>
                                <WorkerPicker
                                    label="Trabajadores seleccionados"
                                    variant="flat"
                                    workers={workers}
                                    selected={form.selectedPersonaIds}
                                    onToggle={toggleAudiencePersona}
                                    search={audienceSearch}
                                    onSearchChange={setAudienceSearch}
                                    maxHeight={260}
                                    emptyMessage="No hay trabajadores para elegir."
                                />
                            </div>
                        )}
                    </div>
                </FieldSection>

                <FieldSection title="Preguntas" inline description="Al menos una pregunta, con su tipo de respuesta">
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', gridColumn: '1 / -1' }}>
                        {questions.map((question, index) => (
                            <div key={question.id} className="card survey-question-card">
                                <div className="survey-question-header">
                                    <span className="survey-question-badge">Pregunta {index + 1}</span>
                                    {questions.length > 1 && (
                                        <button
                                            type="button"
                                            className="btn btn-ghost btn-sm"
                                            aria-label="Eliminar pregunta"
                                            onClick={() => removeQuestion(question.id)}
                                        >
                                            <FiTrash2 size={14} />
                                        </button>
                                    )}
                                </div>

                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 'var(--space-4)' }}>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)', gridColumn: '1 / -1' }}>
                                        <label className="form-label">Título de la pregunta <span style={{ color: 'var(--accent-text)' }}>*</span></label>
                                        <input
                                            className="form-input"
                                            value={question.titulo}
                                            onChange={(e) => updateQuestion(question.id, { titulo: e.target.value })}
                                            placeholder="Texto de la pregunta"
                                        />
                                    </div>

                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)', gridColumn: '1 / -1' }}>
                                        <label className="form-label">Descripción</label>
                                        <textarea
                                            className="form-input"
                                            value={question.descripcion}
                                            onChange={(e) => updateQuestion(question.id, { descripcion: e.target.value })}
                                            rows={2}
                                            placeholder="Agrega contexto, instrucciones o ejemplos (opcional)"
                                        />
                                    </div>

                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
                                        <label className="form-label">Tipo de respuesta</label>
                                        <Select
                                            ariaLabel="Tipo de pregunta"
                                            value={question.tipo}
                                            onChange={(v) => handleQuestionTypeChange(question.id, v as SurveyQuestionType)}
                                            options={[
                                                { value: 'multiple', label: 'Selección múltiple' },
                                                { value: 'escala', label: 'Escala (1 a N)' },
                                                { value: 'abierta', label: 'Pregunta abierta' },
                                            ]}
                                        />
                                    </div>

                                    {question.tipo === 'escala' && (
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
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

                                    <label
                                        className="flex items-center gap-2"
                                        style={{ cursor: 'pointer', alignSelf: 'center', gridColumn: question.tipo === 'escala' ? '3 / 4' : '2 / 4' }}
                                    >
                                        <input
                                            type="checkbox"
                                            className="checkbox-input custom-checkbox"
                                            checked={question.required}
                                            onChange={(e) => updateQuestion(question.id, { required: e.target.checked })}
                                        />
                                        Pregunta obligatoria
                                    </label>

                                    {question.tipo === 'multiple' && (
                                        <div style={{ gridColumn: '1 / -1' }}>
                                            <label className="form-label">Opciones de respuesta</label>
                                            <div className="option-input-row" style={{ marginTop: 'var(--space-1)' }}>
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

                                    {question.tipo === 'abierta' && (
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)', gridColumn: '1 / -1' }}>
                                            <label className="form-label">Vista previa para el trabajador</label>
                                            <textarea
                                                className="form-input"
                                                rows={2}
                                                disabled
                                                placeholder="Respuesta libre del trabajador…"
                                                style={{ resize: 'none', color: 'var(--text-muted)' }}
                                            />
                                        </div>
                                    )}
                                </div>
                            </div>
                        ))}

                        <button
                            type="button"
                            onClick={addQuestion}
                            style={{
                                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 'var(--space-2)',
                                padding: 'var(--space-3)', background: 'none', border: '1.5px dashed #38465a',
                                borderRadius: 'var(--radius-md)', color: 'var(--text-secondary)',
                                fontSize: 'var(--text-sm)', fontWeight: 500, cursor: 'pointer',
                            }}
                        >
                            <FiPlus size={15} />
                            Agregar pregunta
                        </button>
                    </div>
                </FieldSection>
            </FormPage>
        </>
    );
}
