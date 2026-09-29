import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { FiAlertCircle, FiCheckCircle, FiEdit3, FiLock } from 'react-icons/fi';
import { surveysApi, type Survey, type SurveyQuestion, type SurveyRecipient } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { PERMISSIONS } from '../permissions';
import { PageHeader } from '../components/ui';
import { SurveyDetalleSkeleton } from '../components/surveys/SurveysSkeleton';
import { etiquetaAudiencia, etiquetaTipoPregunta, fechaCorta, fechaHora, porcentaje } from '../utils/encuestas';

const idDe = (r: SurveyRecipient) => r.personaId || r.workerId;

/**
 * Detalle de una encuesta.
 *
 * Se pide a `GET /surveys/{id}`: el listado no trae ni las preguntas ni a los
 * destinatarios. Antes el detalle se armaba con la fila del listado, y por eso
 * salía "No hay preguntas registradas".
 *
 * Lo que se ve lo decide el backend: quien gestiona recibe a todos los
 * destinatarios (y las respuestas, salvo las de la ficha de salud sin permiso de
 * vigilancia); un destinatario recibe solo su propia fila.
 */
export default function SurveyDetalle() {
    const { surveyId = '' } = useParams();
    const { user, hasPermission } = useAuth();
    const [survey, setSurvey] = useState<Survey | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    useEffect(() => {
        let cancelado = false;
        surveysApi.get(surveyId).then((res) => {
            if (cancelado) return;
            if (res.success && res.data) setSurvey(res.data);
            else setError(res.error || 'No encontramos esta encuesta.');
        }).catch(() => {
            if (!cancelado) setError('Error de conexión al cargar la encuesta.');
        }).finally(() => {
            if (!cancelado) setLoading(false);
        });
        return () => { cancelado = true; };
    }, [surveyId]);

    const recipients = useMemo(() => survey?.recipients || [], [survey]);
    const mio = recipients.find((r) => idDe(r) === user?.personaId) || null;
    // El mismo criterio con que el backend decide mandar a todos los destinatarios.
    const gestiona = Boolean(survey) && (hasPermission(PERMISSIONS.ENCUESTAS_CREAR) || survey?.createdBy === user?.personaId);
    const conRespuestas = recipients.some((r) => idDe(r) !== user?.personaId && Array.isArray(r.responses));

    const resultados = useMemo(
        () => (survey?.preguntas || []).map((p) => resumirPregunta(p, survey?.recipients || [])),
        [survey]
    );

    if (loading) {
        return (
            <div className="page-content">
                <PageHeader banner title="Encuesta" />
                <SurveyDetalleSkeleton />
            </div>
        );
    }

    if (!survey) {
        return (
            <div className="page-content">
                <PageHeader banner title="Encuesta" />
                <div className="alert alert-danger">
                    <FiAlertCircle size={20} />
                    <div>{error}</div>
                </div>
            </div>
        );
    }

    const total = survey.stats?.totalRecipients ?? recipients.length;
    const respondidas = survey.stats?.responded ?? recipients.filter((r) => r.estado === 'respondida').length;
    const pct = porcentaje(respondidas, total);
    const colorAvance = pct >= 100 ? 'var(--success-apagado)' : 'var(--accent)';
    const completada = survey.estado === 'completada';
    const preguntas = survey.preguntas || [];
    const respuestaPropia = (questionId: string) =>
        mio?.responses?.find((r) => r.questionId === questionId)?.value;

    return (
        <div className="page-content">
            <PageHeader
                banner
                title={survey.titulo}
                description={survey.descripcion || undefined}
                actions={mio ? (
                    <Link to={`/surveys/${survey.surveyId}/responder`} className="btn btn-primary">
                        {mio.estado === 'respondida' ? <><FiEdit3 /> Actualizar respuesta</> : <><FiLock /> Responder ahora</>}
                    </Link>
                ) : undefined}
            />

            <div className="survey-detail">
                <div className="survey-detail-meta">
                    <span className={`badge ${completada ? 'badge-neutral' : 'badge-accent'}`}>{completada ? 'Completada' : 'Activa'}</span>
                    {survey.esFichaSalud && <span className="badge badge-salud">Ficha de salud</span>}
                    <span>{survey.esFichaSalud ? 'Creación automática' : `Creada el ${fechaCorta(survey.createdAt)}`}</span>
                    <span>Audiencia: {etiquetaAudiencia(survey)}</span>
                </div>

                {mio && (
                    <div className={`survey-detail-mine ${mio.estado === 'respondida' ? 'is-done' : ''}`}>
                        {mio.estado === 'respondida' ? <FiCheckCircle size={18} /> : <FiAlertCircle size={18} />}
                        <span>
                            {mio.estado === 'respondida'
                                ? `Respondiste esta encuesta el ${fechaHora(mio.respondedAt)}.`
                                : 'Tienes esta encuesta pendiente. Se responde y se firma con tu PIN.'}
                        </span>
                    </div>
                )}

                {gestiona && (
                    <div className="survey-stats survey-stats--4">
                        <div className="survey-stat-tile">
                            <span className="survey-stat-tile-label">Destinatarios</span>
                            <span className="survey-stat-tile-value">{total}</span>
                        </div>
                        <div className="survey-stat-tile">
                            <span className="survey-stat-tile-label">Respondidas</span>
                            <span className="survey-stat-tile-value">{respondidas}</span>
                        </div>
                        <div className="survey-stat-tile">
                            <span className="survey-stat-tile-label">Pendientes</span>
                            <span className="survey-stat-tile-value">{Math.max(total - respondidas, 0)}</span>
                        </div>
                        <div className="survey-stat-tile">
                            <span className="survey-stat-tile-label">Tasa de respuesta</span>
                            <span className="survey-stat-tile-value" style={{ color: colorAvance }}>{pct}%</span>
                            <div className="progress">
                                <div className="progress-bar" style={{ width: `${pct}%`, background: colorAvance }} />
                            </div>
                        </div>
                    </div>
                )}

                <section className="survey-detail-section" aria-label="Preguntas">
                    <div className="survey-created-header">
                        <span>Preguntas</span>
                        <small>{preguntas.length} en total · tal como las recibe el trabajador</small>
                    </div>
                    {preguntas.length === 0 ? (
                        <p className="text-sm text-muted">Esta encuesta no tiene preguntas registradas.</p>
                    ) : (
                        <ol className="survey-question-list">
                            {preguntas.map((pregunta, i) => {
                                const propia = respuestaPropia(pregunta.questionId);
                                const resultado = resultados[i];
                                return (
                                    <li key={pregunta.questionId} className="card survey-question-card">
                                        <div className="survey-question-header">
                                            <span className="survey-question-badge">Pregunta {i + 1}</span>
                                            <span className="badge badge-neutral">{etiquetaTipoPregunta(pregunta.tipo)}</span>
                                            {pregunta.required && <span className="badge badge-secondary">Obligatoria</span>}
                                        </div>
                                        <h4 className="survey-question-title">{pregunta.titulo}</h4>
                                        {pregunta.descripcion && <p className="text-sm text-muted">{pregunta.descripcion}</p>}

                                        {pregunta.tipo === 'multiple' && (
                                            <div className="option-pill-group">
                                                {(pregunta.opciones || []).map((op) => (
                                                    <span key={op} className={`option-pill ${propia === op ? 'is-mine' : ''}`}>{op}</span>
                                                ))}
                                            </div>
                                        )}
                                        {pregunta.tipo === 'escala' && (
                                            <p className="text-sm text-muted">Escala de 1 a {pregunta.escalaMax || 5}</p>
                                        )}

                                        {propia !== undefined && (
                                            <p className="survey-answer-mine">Tu respuesta: <strong>{String(propia)}</strong></p>
                                        )}

                                        {gestiona && conRespuestas && resultado && (
                                            <ResultadoPregunta pregunta={pregunta} resultado={resultado} />
                                        )}
                                    </li>
                                );
                            })}
                        </ol>
                    )}
                    {gestiona && !conRespuestas && survey.esFichaSalud && (
                        <p className="survey-detail-note">
                            <FiLock size={14} /> Las respuestas de la ficha de salud solo las ve quien tiene el permiso de vigilancia de la salud.
                        </p>
                    )}
                </section>

                {gestiona && (
                    <section className="survey-detail-section" aria-label="Destinatarios">
                        <div className="survey-created-header">
                            <span>Destinatarios</span>
                            <small>{respondidas} respondieron · {Math.max(total - respondidas, 0)} pendientes</small>
                        </div>
                        <div className="table-container">
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
                                    {recipients.map((r) => (
                                        <tr key={idDe(r)}>
                                            <td>{`${r.nombre} ${r.apellido || ''}`.trim()}</td>
                                            <td>{r.rut || '—'}</td>
                                            <td>{r.cargo || 'Sin cargo'}</td>
                                            <td>
                                                <span className={`badge ${r.estado === 'respondida' ? 'badge-neutral' : 'badge-accent'}`}>
                                                    {r.estado === 'respondida' ? 'Respondida' : 'Pendiente'}
                                                </span>
                                            </td>
                                            <td>{r.respondedAt ? fechaHora(r.respondedAt) : '—'}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </section>
                )}
            </div>
        </div>
    );
}

interface Resultado {
    contestaron: number;
    conteo: Record<string, number>;
    promedio: number | null;
    abiertas: string[];
}

/** Lo que respondieron todos a una pregunta, agregado. */
function resumirPregunta(pregunta: SurveyQuestion, recipients: SurveyRecipient[]): Resultado {
    const valores = recipients
        .map((r) => r.responses?.find((a) => a.questionId === pregunta.questionId)?.value)
        .filter((v): v is string | number | string[] => v !== undefined && v !== null && v !== '');
    const conteo: Record<string, number> = {};
    valores.forEach((v) => {
        const clave = String(Array.isArray(v) ? v[0] : v);
        conteo[clave] = (conteo[clave] || 0) + 1;
    });
    const numeros = valores.map(Number).filter((n) => Number.isFinite(n));
    return {
        contestaron: valores.length,
        conteo,
        promedio: pregunta.tipo === 'escala' && numeros.length > 0
            ? Math.round((numeros.reduce((a, b) => a + b, 0) / numeros.length) * 10) / 10
            : null,
        abiertas: pregunta.tipo === 'abierta' ? valores.map(String) : [],
    };
}

function ResultadoPregunta({ pregunta, resultado }: { pregunta: SurveyQuestion; resultado: Resultado }) {
    if (resultado.contestaron === 0) {
        return <p className="survey-result-empty">Todavía nadie responde esta pregunta.</p>;
    }
    if (pregunta.tipo === 'multiple') {
        return (
            <div className="survey-result">
                {(pregunta.opciones || []).map((op) => {
                    const n = resultado.conteo[op] || 0;
                    const pct = porcentaje(n, resultado.contestaron);
                    return (
                        <div key={op} className="survey-result-row">
                            <span className="survey-result-label">{op}</span>
                            <span className="survey-result-bar"><span style={{ width: `${pct}%` }} /></span>
                            <span className="survey-result-value">{n} · {pct}%</span>
                        </div>
                    );
                })}
            </div>
        );
    }
    if (pregunta.tipo === 'escala') {
        return (
            <p className="survey-result-summary">
                Promedio <strong>{resultado.promedio}</strong> de {pregunta.escalaMax || 5} · {resultado.contestaron} respuesta{resultado.contestaron === 1 ? '' : 's'}
            </p>
        );
    }
    return (
        <ul className="survey-result-open">
            {resultado.abiertas.map((texto, i) => <li key={i}>{texto}</li>)}
        </ul>
    );
}
