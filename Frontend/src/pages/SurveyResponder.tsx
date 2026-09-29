import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { FiAlertCircle, FiLock, FiWifiOff } from 'react-icons/fi';
import { surveysApi, type SurveyQuestion } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { useOfflineSignature } from '../hooks/useOfflineSignature';
import SignatureModal from '../components/SignatureModal';
import { FormPage, PageHeader } from '../components/ui';
import { SurveyResponderSkeleton } from '../components/surveys/SurveysSkeleton';
import {
    armarRespuestas,
    etiquetaTipoPregunta,
    guardarPreguntasEnCache,
    leerPreguntasEnCache,
    obligatoriasSinResponder,
    valoresIniciales,
    type EncuestaEnCache,
    type ValoresRespuesta,
} from '../utils/encuestas';

/**
 * Responder una encuesta asignada y firmarla con el PIN.
 *
 * Sin red, la respuesta queda en el equipo con un vale de un solo uso y se
 * sincroniza al volver la conexión (`useOfflineSignature`). Para poder mostrar
 * las preguntas sin red, se usan las que se guardaron la última vez que se
 * vieron con conexión.
 */
export default function SurveyResponder() {
    const { surveyId = '' } = useParams();
    const navigate = useNavigate();
    const { user } = useAuth();
    const { toast } = useToast();
    const { isOnline, signSurvey } = useOfflineSignature();

    const [encuesta, setEncuesta] = useState<EncuestaEnCache | null>(null);
    const [workerId, setWorkerId] = useState<string | null>(null);
    const [yaRespondida, setYaRespondida] = useState(false);
    const [valores, setValores] = useState<ValoresRespuesta>({});
    const [loading, setLoading] = useState(true);
    const [errorCarga, setErrorCarga] = useState('');
    const [faltantes, setFaltantes] = useState<Set<string>>(new Set());
    const [firmando, setFirmando] = useState(false);
    const [mostrarFirma, setMostrarFirma] = useState(false);
    const [errorFirma, setErrorFirma] = useState('');

    useEffect(() => {
        let cancelado = false;
        const desdeCache = () => {
            const cache = leerPreguntasEnCache(surveyId);
            if (cache && user?.personaId) {
                setEncuesta(cache);
                setWorkerId(user.personaId);
                return true;
            }
            return false;
        };

        surveysApi.get(surveyId).then((res) => {
            if (cancelado) return;
            if (!res.success || !res.data) {
                if (!desdeCache()) setErrorCarga(res.error || 'No encontramos esta encuesta.');
                return;
            }
            const mio = (res.data.recipients || []).find((r) => (r.personaId || r.workerId) === user?.personaId);
            if (!mio) {
                setErrorCarga('Esta encuesta no está asignada a ti.');
                return;
            }
            guardarPreguntasEnCache(res.data);
            setEncuesta({
                surveyId: res.data.surveyId,
                titulo: res.data.titulo,
                descripcion: res.data.descripcion,
                preguntas: res.data.preguntas || [],
                esFichaSalud: res.data.esFichaSalud,
            });
            setWorkerId(mio.workerId || mio.personaId || null);
            setYaRespondida(mio.estado === 'respondida');
            setValores(valoresIniciales(mio.responses));
        }).catch(() => {
            if (!cancelado && !desdeCache()) setErrorCarga('Sin conexión y sin una copia guardada de esta encuesta.');
        }).finally(() => {
            if (!cancelado) setLoading(false);
        });
        return () => { cancelado = true; };
    }, [surveyId, user?.personaId]);

    const cambiar = (questionId: string, valor: string | number) => {
        setValores((prev) => ({ ...prev, [questionId]: valor }));
        setFaltantes((prev) => {
            if (!prev.has(questionId)) return prev;
            const nuevo = new Set(prev);
            nuevo.delete(questionId);
            return nuevo;
        });
    };

    const pedirFirma = (e: React.FormEvent) => {
        e.preventDefault();
        if (!encuesta) return;
        const sinResponder = obligatoriasSinResponder(encuesta.preguntas, valores);
        if (sinResponder.length > 0) {
            setFaltantes(new Set(sinResponder.map((p) => p.questionId)));
            document.getElementById(`pregunta-${sinResponder[0].questionId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            return;
        }
        setErrorFirma('');
        setMostrarFirma(true);
    };

    const firmar = async (pin: string) => {
        if (!encuesta || !workerId) return;
        setFirmando(true);
        setErrorFirma('');
        try {
            const resultado = await signSurvey(
                encuesta.surveyId,
                encuesta.titulo,
                workerId,
                user?.nombre || 'Trabajador',
                armarRespuestas(encuesta.preguntas, valores),
                pin
            );
            if (!resultado.success) {
                setErrorFirma(resultado.error || 'No fue posible enviar tus respuestas.');
                return;
            }
            setMostrarFirma(false);
            if (resultado.offline) {
                toast.info('Respuesta guardada en este equipo. Se envía sola cuando vuelva la conexión.');
            } else {
                toast.success('Encuesta respondida y firmada');
                window.dispatchEvent(new CustomEvent('surveyResponded'));
            }
            navigate('/surveys', { state: { pestana: 'assigned' } });
        } catch (err) {
            console.error('Error enviando respuestas de encuesta', err);
            setErrorFirma('Ocurrió un error al enviar tus respuestas. Intenta nuevamente.');
        } finally {
            setFirmando(false);
        }
    };

    const migas = [{ label: 'Encuestas', to: '/surveys' }];

    if (loading) {
        return (
            <div className="page-content">
                <PageHeader banner title="Responder encuesta" breadcrumb={migas} />
                <SurveyResponderSkeleton />
            </div>
        );
    }

    if (!encuesta) {
        return (
            <div className="page-content">
                <PageHeader banner title="Responder encuesta" breadcrumb={migas} />
                <div className="alert alert-danger">
                    <FiAlertCircle size={20} />
                    <div>{errorCarga} <Link to="/surveys">Volver a Encuestas</Link></div>
                </div>
            </div>
        );
    }

    return (
        <>
            <div className="page-content">
                <PageHeader
                    banner
                    title={encuesta.titulo}
                    breadcrumb={[...migas, { label: 'Detalle', to: `/surveys/${encuesta.surveyId}` }]}
                    description={encuesta.descripcion || 'Responde cada pregunta y firma con tu PIN al final.'}
                />
            </div>

            <FormPage
                maxWidth={760}
                onSubmit={pedirFirma}
                header={<></>}
                actions={
                    <>
                        <span className={`survey-respond-note ${faltantes.size > 0 ? 'is-error' : ''}`}>
                            {faltantes.size > 0
                                ? `Faltan ${faltantes.size} pregunta${faltantes.size === 1 ? '' : 's'} obligatoria${faltantes.size === 1 ? '' : 's'}.`
                                : !isOnline
                                    ? <><FiWifiOff size={13} /> Sin conexión: se guarda en este equipo y se envía sola.</>
                                    : yaRespondida
                                        ? 'Ya respondiste: al firmar, reemplazas tu respuesta anterior.'
                                        : 'Tus respuestas se firman con tu PIN.'}
                        </span>
                        <button type="button" className="btn btn-secondary" onClick={() => navigate(-1)}>
                            Cancelar
                        </button>
                        <button type="submit" className="btn btn-primary" disabled={firmando}>
                            <FiLock /> Firmar y enviar
                        </button>
                    </>
                }
            >
                <ol className="survey-respond-list">
                    {encuesta.preguntas.map((pregunta, i) => (
                        <li
                            key={pregunta.questionId}
                            id={`pregunta-${pregunta.questionId}`}
                            className={`card survey-respond-card ${faltantes.has(pregunta.questionId) ? 'is-missing' : ''}`}
                        >
                            <div className="survey-question-header">
                                <span className="survey-question-badge">Pregunta {i + 1}</span>
                                <span className="badge badge-neutral">{etiquetaTipoPregunta(pregunta.tipo)}</span>
                                {pregunta.required && <span className="badge badge-secondary">Obligatoria</span>}
                            </div>
                            <h3 className="survey-question-title">{pregunta.titulo}</h3>
                            {pregunta.descripcion && <p className="text-sm text-muted">{pregunta.descripcion}</p>}
                            <CampoRespuesta pregunta={pregunta} valor={valores[pregunta.questionId]} onChange={cambiar} />
                            {faltantes.has(pregunta.questionId) && (
                                <p className="survey-respond-missing">Esta pregunta es obligatoria.</p>
                            )}
                        </li>
                    ))}
                </ol>
            </FormPage>

            <SignatureModal
                isOpen={mostrarFirma}
                onClose={() => setMostrarFirma(false)}
                onConfirm={firmar}
                type="survey"
                title="Firmar encuesta"
                itemName={encuesta.titulo}
                description="Al firmar, confirmas que respondiste esta encuesta de manera veraz."
                loading={firmando}
                error={errorFirma}
            />
        </>
    );
}

function CampoRespuesta({ pregunta, valor, onChange }: {
    pregunta: SurveyQuestion;
    valor: string | number | undefined;
    onChange: (questionId: string, valor: string | number) => void;
}) {
    if (pregunta.tipo === 'multiple' || pregunta.tipo === 'escala') {
        const opciones: Array<string | number> = pregunta.tipo === 'multiple'
            ? (pregunta.opciones || [])
            : Array.from({ length: pregunta.escalaMax || 5 }, (_, i) => i + 1);
        return (
            <div className="option-pill-group" role="radiogroup" aria-label={pregunta.titulo}>
                {opciones.map((op) => (
                    <button
                        type="button"
                        key={op}
                        role="radio"
                        aria-checked={valor === op}
                        className={`option-pill selectable ${valor === op ? 'active' : ''}`}
                        onClick={() => onChange(pregunta.questionId, op)}
                    >
                        {op}
                    </button>
                ))}
            </div>
        );
    }
    return (
        <textarea
            className="form-input"
            rows={3}
            value={typeof valor === 'string' ? valor : ''}
            onChange={(e) => onChange(pregunta.questionId, e.target.value)}
            placeholder="Escribe tu respuesta…"
            aria-label={pregunta.titulo}
        />
    );
}
