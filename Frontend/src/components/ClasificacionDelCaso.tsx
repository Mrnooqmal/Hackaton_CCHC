import { useState } from 'react';
import { FiCheck } from 'react-icons/fi';
import { incidentsApi, type ClasificarData, type Incident } from '../api/client';
import { useToast } from '../context/ToastContext';
import { Select, SegmentedControl } from './ui';
import SelectorResponsable from './SelectorResponsable';
import { fechaLocal } from '../utils/prescripciones';
import { esHallazgo } from '../utils/casos';

type Tipo = Incident['tipo'];
type Gravedad = 'leve' | 'grave' | 'fatal';

const TIPOS: { value: Tipo; label: string }[] = [
    { value: 'condicion_subestandar', label: 'Hallazgo: condición subestándar' },
    { value: 'accion_subestandar', label: 'Hallazgo: acción subestándar' },
    { value: 'incidente', label: 'Incidente (sin lesión, pudo ser grave)' },
    { value: 'accidente', label: 'Accidente (hubo lesión)' },
];

const GRAVEDADES: { value: Gravedad; label: string }[] = [
    { value: 'leve', label: 'Leve' },
    { value: 'grave', label: 'Grave' },
    { value: 'fatal', label: 'Fatal' },
];

const SI_NO = [{ value: 'si', label: 'Sí' }, { value: 'no', label: 'No' }];

interface Props {
    incidente: Incident;
    /** Se llama cuando el servidor guardó la clasificación, para que la pantalla recargue el caso. */
    onCambio: () => void;
}

/**
 * Clasificación del caso (fase 3): el prevencionista confirma qué es lo que se
 * reportó. Se monta solo para quien tiene `incidentes.calificar_accidente` y
 * mientras el caso esté abierto (el padre decide); el servidor lo exige igual.
 *
 * Un incidente responde las dos preguntas de la guía de Mutual: si alguna es "sí",
 * es de alto potencial y exige informe de investigación. En un hallazgo se puede
 * dejar además quién lo corrige y en qué plazo. Se puede volver a clasificar
 * mientras el caso siga abierto; el servidor guarda la clasificación anterior.
 */
export default function ClasificacionDelCaso({ incidente, onCambio }: Props) {
    const { toast } = useToast();
    const previo = incidente.triaje;
    const yaClasificado = Boolean(previo);

    const [tipo, setTipo] = useState<Tipo>(previo?.tipo ?? incidente.tipo);
    const [gravedad, setGravedad] = useState<Gravedad>(previo?.gravedad ?? incidente.gravedad ?? 'leve');
    // Sin respuesta previa, vacío: las dos preguntas hay que contestarlas a conciencia.
    const [danoMayor, setDanoMayor] = useState<string>(previo?.danoMayor == null ? '' : previo.danoMayor ? 'si' : 'no');
    const [granSusto, setGranSusto] = useState<string>(previo?.granSusto == null ? '' : previo.granSusto ? 'si' : 'no');
    const [responsableId, setResponsableId] = useState(incidente.gobernanza?.responsableId ?? '');
    const [plazo, setPlazo] = useState(incidente.gobernanza?.plazoRespuestaISO ? String(incidente.gobernanza.plazoRespuestaISO).slice(0, 10) : '');
    const [guardando, setGuardando] = useState(false);
    const [error, setError] = useState('');

    const hallazgo = esHallazgo({ tipo });
    const incidentePeligroso = tipo === 'incidente';

    const guardar = async (e: React.FormEvent) => {
        e.preventDefault();
        if (guardando) return;
        if (incidentePeligroso && (!danoMayor || !granSusto)) {
            setError('Responde las dos preguntas para saber si el incidente es de alto potencial.');
            return;
        }
        const datos: ClasificarData = { tipo };
        if (!hallazgo) datos.gravedad = gravedad;
        if (incidentePeligroso) { datos.danoMayor = danoMayor === 'si'; datos.granSusto = granSusto === 'si'; }
        if (hallazgo) {
            if (responsableId) datos.responsableId = responsableId;
            if (plazo) datos.plazoRespuestaISO = plazo;
        }
        setError('');
        setGuardando(true);
        try {
            const res = await incidentsApi.clasificar(incidente.incidentId, datos);
            if (!res.success) { setError(res.error || 'No se pudo clasificar el caso.'); return; }
            toast.success('Caso clasificado');
            onCambio();
        } catch {
            setError('Error de conexión al clasificar el caso. Intenta de nuevo.');
        } finally {
            setGuardando(false);
        }
    };

    return (
        <section className="inc-ficha-card" aria-label="Clasificación del caso">
            <div>
                <h2 className="inc-papeles-titulo">{yaClasificado ? 'Clasificación del caso' : 'Clasificar el reporte'}</h2>
                <p className="inc-ficha-texto inc-papeles-ayuda">
                    {yaClasificado
                        ? 'Ya está clasificado. Puedes cambiarlo mientras el caso siga abierto; queda registro de la clasificación anterior.'
                        : 'Confirma qué es lo que se reportó. De esto depende qué papeles exige el caso.'}
                </p>
            </div>

            <form className="inc-papeles-form inc-clasificar-form" onSubmit={guardar}>
                <div className="form-group">
                    <label className="form-label">Qué es</label>
                    <Select
                        ariaLabel="Tipo de caso"
                        value={tipo}
                        onChange={(v) => setTipo(v as Tipo)}
                        options={TIPOS}
                        disabled={guardando}
                    />
                </div>

                {!hallazgo && (
                    <div className="form-group">
                        <label className="form-label">Gravedad</label>
                        <SegmentedControl
                            ariaLabel="Gravedad"
                            value={gravedad}
                            onChange={(v) => setGravedad(v as Gravedad)}
                            options={GRAVEDADES}
                            disabled={guardando}
                        />
                    </div>
                )}

                {incidentePeligroso && (
                    <>
                        <div className="form-group">
                            <label className="form-label">Si alguna condición hubiera sido distinta, ¿esto pudo causar un daño mayor o la muerte?</label>
                            <SegmentedControl ariaLabel="Pudo causar un daño mayor o la muerte" value={danoMayor} onChange={setDanoMayor} options={SI_NO} disabled={guardando} fullWidth={false} />
                        </div>
                        <div className="form-group">
                            <label className="form-label">¿Generó un gran susto en quienes lo presenciaron?</label>
                            <SegmentedControl ariaLabel="Generó un gran susto en los testigos" value={granSusto} onChange={setGranSusto} options={SI_NO} disabled={guardando} fullWidth={false} />
                        </div>
                        <p className="inc-ficha-texto inc-papeles-ayuda">
                            Si alguna respuesta es sí, el incidente es de alto potencial y exige un informe de investigación.
                        </p>
                    </>
                )}

                {hallazgo && (
                    <div className="inc-papeles-campos">
                        <div className="form-group">
                            <label className="form-label">Quién lo corrige (opcional)</label>
                            <SelectorResponsable value={responsableId} onChange={setResponsableId} disabled={guardando} />
                        </div>
                        <div className="form-group">
                            <label className="form-label" htmlFor="clasificar-plazo">Plazo para corregirlo (opcional)</label>
                            <input
                                id="clasificar-plazo"
                                className="form-input"
                                type="date"
                                min={fechaLocal()}
                                value={plazo}
                                disabled={guardando}
                                onChange={(e) => setPlazo(e.target.value)}
                            />
                        </div>
                    </div>
                )}

                {error && <div className="alert alert-danger" role="alert"><div>{error}</div></div>}
                <div>
                    <button type="submit" className="btn btn-primary" disabled={guardando}>
                        <FiCheck size={16} /> {guardando ? 'Guardando…' : yaClasificado ? 'Guardar cambios' : 'Clasificar'}
                    </button>
                </div>
            </form>
        </section>
    );
}
