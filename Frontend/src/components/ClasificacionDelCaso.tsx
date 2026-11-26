import { useState } from 'react';
import { FiCheck } from 'react-icons/fi';
import { incidentsApi, type ClasificarData, type Incident } from '../api/client';
import { useToast } from '../context/ToastContext';
import { Select, SegmentedControl } from './ui';
import SelectorResponsable from './SelectorResponsable';
import { esHallazgo, GRAVEDADES, TIPOS_HALLAZGO, TIPOS_INCIDENTE } from '../utils/casos';

type Tipo = Incident['tipo'];
type Gravedad = 'leve' | 'grave' | 'fatal';

// Los valores salen de `utils/casos` (las listas que valida el servidor); acá solo se les pone el texto.
const ETIQUETA_TIPO: Record<string, string> = {
    condicion_subestandar: 'Hallazgo: condición subestándar',
    accion_subestandar: 'Hallazgo: acción subestándar',
    incidente: 'Incidente (sin lesión, pudo ser grave)',
    accidente: 'Accidente (hubo lesión)',
};
const ETIQUETA_GRAVEDAD: Record<string, string> = { leve: 'Leve', grave: 'Grave', fatal: 'Fatal' };

const OPCIONES_TIPO: { value: Tipo; label: string }[] = [...TIPOS_HALLAZGO, ...TIPOS_INCIDENTE]
    .map((v) => ({ value: v as Tipo, label: ETIQUETA_TIPO[v] ?? v }));
const OPCIONES_GRAVEDAD: { value: Gravedad; label: string }[] = GRAVEDADES
    .map((v) => ({ value: v as Gravedad, label: ETIQUETA_GRAVEDAD[v] ?? v }));

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

    // Un caso antiguo puede traer un tipo o una gravedad que ya no está entre las opciones
    // (el servidor responde 400 si se envían). Si el valor no está en la lista, se parte
    // vacío, y hay que elegir: antes el selector no mostraba nada y enviaba el valor viejo.
    const tipoGuardado = previo?.tipo ?? incidente.tipo;
    const gravedadGuardada = previo?.gravedad ?? incidente.gravedad;
    const [tipo, setTipo] = useState<Tipo | ''>(OPCIONES_TIPO.some((t) => t.value === tipoGuardado) ? tipoGuardado : '');
    const [gravedad, setGravedad] = useState<Gravedad | ''>(OPCIONES_GRAVEDAD.some((g) => g.value === gravedadGuardada) ? (gravedadGuardada as Gravedad) : '');
    // Sin respuesta previa, vacío: las dos preguntas hay que contestarlas a conciencia.
    const [danoMayor, setDanoMayor] = useState<string>(previo?.danoMayor == null ? '' : previo.danoMayor ? 'si' : 'no');
    const [granSusto, setGranSusto] = useState<string>(previo?.granSusto == null ? '' : previo.granSusto ? 'si' : 'no');
    const [responsableId, setResponsableId] = useState(incidente.gobernanza?.responsableId ?? '');
    const [plazo, setPlazo] = useState(incidente.gobernanza?.plazoRespuestaISO ? String(incidente.gobernanza.plazoRespuestaISO).slice(0, 10) : '');
    const [guardando, setGuardando] = useState(false);
    const [error, setError] = useState('');

    const hallazgo = tipo !== '' && esHallazgo({ tipo });
    const incidentePeligroso = tipo === 'incidente';

    const guardar = async (e: React.FormEvent) => {
        e.preventDefault();
        if (guardando) return;
        if (!tipo) {
            setError('Elige qué es lo que se reportó.');
            return;
        }
        if (!hallazgo && !gravedad) {
            setError('Elige la gravedad.');
            return;
        }
        if (incidentePeligroso && (!danoMayor || !granSusto)) {
            setError('Responde las dos preguntas para saber si el incidente es de alto potencial.');
            return;
        }
        const datos: ClasificarData = { tipo };
        if (!hallazgo && gravedad) datos.gravedad = gravedad;
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
                        placeholder="Elegir…"
                        value={tipo}
                        onChange={(v) => setTipo(v as Tipo)}
                        options={OPCIONES_TIPO}
                        disabled={guardando}
                    />
                </div>

                {tipo !== '' && !hallazgo && (
                    <div className="form-group">
                        <label className="form-label">Gravedad</label>
                        <SegmentedControl
                            ariaLabel="Gravedad"
                            value={gravedad}
                            onChange={(v) => setGravedad(v as Gravedad)}
                            options={OPCIONES_GRAVEDAD}
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
                            <SelectorResponsable value={responsableId} onChange={setResponsableId} disabled={guardando} nombreActual={responsableId === incidente.gobernanza?.responsableId ? incidente.gobernanza?.responsableNombre : undefined} />
                        </div>
                        <div className="form-group">
                            <label className="form-label" htmlFor="clasificar-plazo">Plazo para corregirlo (opcional)</label>
                            {/* Sin `min`: el servidor acepta un plazo ya vencido (un hallazgo se puede registrar tarde), y con
                                `min` el navegador impedía reclasificar un hallazgo cuyo plazo precargado ya pasó. */}
                            <input
                                id="clasificar-plazo"
                                className="form-input"
                                type="date"
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
