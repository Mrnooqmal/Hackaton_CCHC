import { useEffect, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { FiAlertCircle, FiArrowRight, FiCheckCircle, FiCircle, FiClock, FiImage } from 'react-icons/fi';
import { incidentsApi, type Incident } from '../api/client';
import { useObraContext } from '../context/ObraContext';
import { PageHeader, AlertBanner, LoadingSpinner } from '../components/ui';
import { incidenteCerrado } from '../utils/incidentes';
import { plural } from '../utils/plural';

/** Lo que deja `IncidentReportar` al navegar acá después de enviar. */
interface EstadoNavegacion {
    recienReportado?: boolean;
    fotosSinAdjuntar?: number;
}

const ETIQUETA_TIPO: Record<Incident['tipo'], string> = {
    accidente: 'Accidente',
    incidente: 'Incidente',
    condicion_subestandar: 'Condición subestándar',
    accion_subestandar: 'Acción subestándar',
};

const esHallazgo = (inc: Incident) =>
    inc.clasificacion === 'hallazgo' || inc.tipo === 'condicion_subestandar' || inc.tipo === 'accion_subestandar';

type Etapa = 'recibido' | 'en_curso' | 'cerrado';

/**
 * En qué va el caso, con los estados que ya existen: un hallazgo avanza por
 * `gobernanza.estadoCierre` (abierto → en_proceso → cerrado) y un incidente por
 * `estado` (reportado → en_investigacion → cerrado). Cerrado se decide con
 * `incidenteCerrado`, el mismo criterio que los contadores.
 */
const etapaDe = (inc: Incident): Etapa => {
    if (incidenteCerrado(inc)) return 'cerrado';
    if (esHallazgo(inc)) return inc.gobernanza?.estadoCierre === 'en_proceso' ? 'en_curso' : 'recibido';
    return inc.estado === 'en_investigacion' ? 'en_curso' : 'recibido';
};

const ETIQUETA_ETAPA: Record<'hallazgo' | 'incidente', Record<Etapa, string>> = {
    hallazgo: { recibido: 'Abierto', en_curso: 'En proceso', cerrado: 'Cerrado' },
    incidente: { recibido: 'Reportado', en_curso: 'En investigación', cerrado: 'Cerrado' },
};

// "Qué sigue" en palabras de terreno: quien reporta no necesita saber qué es la
// gobernanza ni el ciclo de investigación, solo qué pasa con lo que avisó.
const QUE_SIGUE: Record<'hallazgo' | 'incidente', Record<Etapa, string>> = {
    hallazgo: {
        recibido: 'Tu reporte fue recibido. Prevención de riesgos lo va a revisar y asignar a alguien para corregirlo.',
        en_curso: 'Ya hay una persona a cargo de corregir lo que reportaste.',
        cerrado: 'Lo que reportaste fue corregido y revisado. Gracias por avisar.',
    },
    incidente: {
        recibido: 'Tu reporte fue recibido. Prevención de riesgos lo va a revisar y va a iniciar la investigación.',
        en_curso: 'Prevención de riesgos está investigando lo ocurrido para definir medidas que eviten que se repita.',
        cerrado: 'La investigación terminó y el caso está cerrado.',
    },
};

const IconoEtapa = ({ etapa }: { etapa: Etapa }) => {
    if (etapa === 'cerrado') return <FiCheckCircle size={11} />;
    if (etapa === 'en_curso') return <FiClock size={11} />;
    return <FiCircle size={10} />;
};

const fechaHora = (inc: Incident) => {
    // `fecha` es AAAA-MM-DD sin zona: con `new Date('2026-11-15')` se leería como
    // UTC y en Chile mostraría el día anterior.
    const [a, m, d] = String(inc.fecha || '').split('-').map(Number);
    const dia = a && m && d
        ? new Date(a, m - 1, d).toLocaleDateString('es-CL', { day: 'numeric', month: 'long', year: 'numeric' })
        : inc.fecha;
    const hora = inc.hora ? String(inc.hora).slice(0, 5) : '';
    return hora ? `${dia}, ${hora}` : dia;
};

/**
 * Detalle de un reporte (fase 1 del rediseño de incidentes).
 *
 * Es adonde llega quien acaba de reportar: antes el formulario volvía al
 * listado y la persona no veía ni su reporte ni qué pasaba con él. Es una página
 * aparte y no otro modal de `Incidents.tsx`, que ya pasa las 1.800 líneas.
 *
 * Lo que se puede leer lo decide el backend (`GET /incidents/{id}`): sin
 * `incidentes.historial`, cada persona solo ve lo que reportó; lo demás, y lo
 * de otra empresa, responde 404 igual que si no existiera.
 */
export default function IncidentDetalle() {
    const { id = '' } = useParams();
    const location = useLocation();
    const navegacion = (location.state || {}) as EstadoNavegacion;
    const { obras } = useObraContext();

    // Lo cargado queda junto al id que se pidió: "cargando" es que todavía no
    // llegó la respuesta de ESTE id, sin un setState síncrono dentro del efecto.
    const [cargado, setCargado] = useState<{ id: string; incidente: Incident | null; error: string } | null>(null);
    const [avisoFotos, setAvisoFotos] = useState((navegacion.fotosSinAdjuntar ?? 0) > 0);

    useEffect(() => {
        let cancelado = false;
        incidentsApi.get(id).then((res) => {
            if (cancelado) return;
            if (res.success && res.data) setCargado({ id, incidente: res.data, error: '' });
            else setCargado({ id, incidente: null, error: res.error || 'No encontramos este reporte.' });
        }).catch(() => {
            if (!cancelado) setCargado({ id, incidente: null, error: 'Error de conexión al cargar el reporte.' });
        });
        return () => { cancelado = true; };
    }, [id]);

    const actual = cargado && cargado.id === id ? cargado : null;
    const loading = actual === null;
    const incidente = actual?.incidente ?? null;
    const error = actual?.error ?? '';
    const breadcrumb = [{ label: 'Incidentes', to: '/incidents' }];

    if (loading) {
        return (
            <div className="page-content">
                <PageHeader banner title="Reporte" breadcrumb={breadcrumb} />
                <LoadingSpinner label="Cargando reporte…" />
            </div>
        );
    }

    if (!incidente) {
        return (
            <div className="page-content">
                <PageHeader banner title="Reporte" breadcrumb={breadcrumb} />
                <div className="alert alert-danger">
                    <FiAlertCircle size={20} />
                    <div>{error}</div>
                </div>
            </div>
        );
    }

    const clase = esHallazgo(incidente) ? 'hallazgo' : 'incidente';
    const etapa = etapaDe(incidente);
    const obra = obras.find((o) => o.obraId === incidente.obraId);
    // Las fotos llegan con URL firmada en `evidencePreviews`; sin URL (no se pudo
    // firmar) se muestra el recuadro vacío, como en el listado.
    const fotos = incidente.evidencePreviews?.length
        ? incidente.evidencePreviews
        : (incidente.evidencias || []).map((key) => ({ key, url: undefined as string | undefined }));
    const comentarioCierre = clase === 'hallazgo' && etapa === 'cerrado' ? incidente.gobernanza?.comentarioCierre : null;

    return (
        <div className="page-content">
            <PageHeader
                banner
                breadcrumb={breadcrumb}
                title={navegacion.recienReportado
                    ? (clase === 'hallazgo' ? 'Hallazgo reportado' : 'Incidente reportado')
                    : (clase === 'hallazgo' ? 'Detalle del hallazgo' : 'Detalle del incidente')}
                actions={
                    <Link to="/incidents/reportar" state={{ clasificacion: clase }} className="btn btn-secondary">
                        Reportar otro
                    </Link>
                }
            />

            <div className="inc-ficha">
                {avisoFotos && (
                    <AlertBanner
                        variant="warning"
                        autoDismissMs={0}
                        onDismiss={() => setAvisoFotos(false)}
                        message={`Tu reporte quedó creado, pero ${plural(navegacion.fotosSinAdjuntar ?? 0, 'foto no se adjuntó', 'fotos no se adjuntaron')}. Avisa a prevención de riesgos si son importantes para el caso.`}
                    />
                )}

                <section className="inc-ficha-sigue" aria-label="Qué sigue">
                    <span className="inc-ficha-sigue-icono"><FiArrowRight size={16} /></span>
                    <div>
                        <div className="inc-ficha-label">Qué sigue</div>
                        <p>{QUE_SIGUE[clase][etapa]}</p>
                        {comentarioCierre && <p className="inc-ficha-sigue-nota">Comentario de cierre: {comentarioCierre}</p>}
                    </div>
                </section>

                <section className="inc-ficha-card">
                    <div className="inc-ficha-cabecera">
                        <span className={`badge ${etapa === 'cerrado' ? 'badge-neutral' : etapa === 'en_curso' ? 'badge-secondary' : 'badge-accent'}`}>
                            <IconoEtapa etapa={etapa} /> {ETIQUETA_ETAPA[clase][etapa]}
                        </span>
                        <span className="badge badge-neutral">{ETIQUETA_TIPO[incidente.tipo] || incidente.tipo}</span>
                        {clase === 'incidente' && incidente.gravedad && incidente.gravedad !== 'leve' && (
                            <span className={`badge ${incidente.gravedad === 'fatal' ? 'inc-ficha-badge-critico' : 'inc-ficha-badge-alerta'}`}>
                                {incidente.gravedad === 'fatal' ? 'Fatal' : 'Grave'}
                            </span>
                        )}
                    </div>

                    <dl className="inc-ficha-datos">
                        <div>
                            <dt className="inc-ficha-label">Fecha y hora</dt>
                            <dd>{fechaHora(incidente)}</dd>
                        </div>
                        <div>
                            <dt className="inc-ficha-label">Obra</dt>
                            <dd>{obra?.nombre || 'Sin obra'}</dd>
                        </div>
                        {incidente.etapaConstructiva && (
                            <div>
                                <dt className="inc-ficha-label">Etapa constructiva</dt>
                                <dd>{incidente.etapaConstructiva}</dd>
                            </div>
                        )}
                    </dl>

                    <div>
                        <div className="inc-ficha-label">Descripción</div>
                        <p className="inc-ficha-texto">{incidente.descripcion || 'Sin descripción registrada.'}</p>
                    </div>

                    <div>
                        <div className="inc-ficha-label">Medidas inmediatas</div>
                        {incidente.medidasInmediatas
                            ? <p className="inc-ficha-texto">{incidente.medidasInmediatas}</p>
                            : <p className="inc-ficha-texto inc-ficha-vacio">No se registraron medidas inmediatas.</p>}
                    </div>

                    <div>
                        <div className="inc-ficha-label">
                            Fotos{fotos.length > 0 ? ` · ${plural(fotos.length, 'archivo', 'archivos')}` : ''}
                        </div>
                        {fotos.length === 0 ? (
                            <p className="inc-ficha-texto inc-ficha-vacio">Sin fotos adjuntas.</p>
                        ) : (
                            <div className="inc-ficha-fotos">
                                {fotos.map((foto, i) => (
                                    foto.url ? (
                                        <a key={foto.key} href={foto.url} target="_blank" rel="noopener noreferrer" className="inc-ficha-foto" title="Ver foto">
                                            <img src={foto.url} alt={`Foto ${i + 1} del reporte`} loading="lazy" />
                                        </a>
                                    ) : (
                                        <div key={foto.key} className="inc-ficha-foto inc-ficha-foto-vacia" title="Foto no disponible">
                                            <FiImage size={22} />
                                        </div>
                                    )
                                ))}
                            </div>
                        )}
                    </div>
                </section>
            </div>
        </div>
    );
}
