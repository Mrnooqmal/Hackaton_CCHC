import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { surveysApi, workersApi, type SurveyListItem } from '../api/client';
import {
    FiPlus,
    FiCheckCircle,
    FiAlertCircle,
    FiChevronRight,
    FiClipboard,
    FiSearch,
    FiWifiOff,
} from 'react-icons/fi';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { PERMISSIONS } from '../permissions';
import { useOfflineSignature } from '../hooks/useOfflineSignature';
import { PageHeader, SegmentedControl } from '../components/ui';
import { SurveyStatTileSkeleton, SurveyRowSectionSkeleton, SurveyCardSkeleton } from '../components/surveys/SurveysSkeleton';
import { antiguedadAsignacion, etiquetaAudiencia, fechaCorta, guardarPreguntasEnCache, leerPreguntasEnCache, porcentaje } from '../utils/encuestas';

type Pestana = 'created' | 'assigned';

const coincideBusqueda = (survey: SurveyListItem, busqueda: string) => {
    const q = busqueda.trim().toLowerCase();
    if (!q) return true;
    return survey.titulo.toLowerCase().includes(q) || (survey.descripcion || '').toLowerCase().includes(q);
};

/**
 * Encuestas: las que gestiono y las que me asignaron.
 *
 * "Mis encuestas asignadas" sale de `miAsignacion`, que el backend calcula por
 * persona. Antes se buscaba a la persona en `survey.recipients`, que el listado
 * dejó de traer el 23 de septiembre de 2026 (el índice no proyecta el RUT de
 * los destinatarios): desde ahí a nadie le aparecía nada. Y además solo se
 * buscaba para los roles `trabajador` y `prevencionista`, así que un admin al
 * que se le asignaba una encuesta nunca la veía. Ahora a cualquiera con sesión
 * le aparece lo que tenga asignado.
 */
export default function Surveys() {
    const navigate = useNavigate();
    const location = useLocation();
    const { user, hasPermission } = useAuth();
    const { toast } = useToast();
    const { isOnline, pendingCount, syncPendingSignatures } = useOfflineSignature();
    const canManageSurveys = hasPermission(PERMISSIONS.ENCUESTAS_CREAR);
    const [surveys, setSurveys] = useState<SurveyListItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    // Al volver de responder, se cae en "Mis encuestas asignadas".
    const [activeTab, setActiveTab] = useState<Pestana>(
        (location.state as { pestana?: Pestana } | null)?.pestana || 'created'
    );
    const [showOnlyMine, setShowOnlyMine] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    // Solo para "de N en la obra" en la tarjeta de resumen del gestor.
    const [totalWorkers, setTotalWorkers] = useState(0);

    const loadData = async () => {
        setLoading(true);
        setError('');
        try {
            const res = await surveysApi.list();
            if (res.success && res.data) {
                setSurveys(res.data.surveys || []);
                precargarPendientes(res.data.surveys || []);
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

    // Las preguntas de lo pendiente se guardan ahora, con red, para poder
    // responder en terreno sin ella. Son pocas y solo las que faltan.
    const precargarPendientes = (lista: SurveyListItem[]) => {
        if (!navigator.onLine) return;
        lista
            .filter((s) => s.miAsignacion?.estado === 'pendiente' && !leerPreguntasEnCache(s.surveyId))
            .forEach((s) => {
                surveysApi.get(s.surveyId)
                    .then((res) => { if (res.success && res.data) guardarPreguntasEnCache(res.data); })
                    .catch(() => {});
            });
    };

    // Carga inicial; después se recarga a mano (al sincronizar lo pendiente).
    useEffect(() => {
        loadData();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        if (!canManageSurveys) return;
        workersApi.list().then((res) => {
            if (res.success && res.data) setTotalWorkers(res.data.length);
        }).catch(() => {});
    }, [canManageSurveys]);

    // Al volver la conexión, sube lo respondido sin red.
    useEffect(() => {
        if (isOnline && pendingCount > 0) {
            syncPendingSignatures().then((result) => {
                if (result.synced > 0) {
                    toast.success(`${result.synced} firma(s) sincronizada(s)`);
                    loadData();
                }
            });
        }
    }, [isOnline]);

    const coincide = (survey: SurveyListItem) => coincideBusqueda(survey, searchQuery);

    const mySurveys = useMemo(
        () => surveys.filter((s) => s.createdBy === user?.personaId),
        [surveys, user?.personaId]
    );

    const createdVisible = useMemo(
        () => (showOnlyMine ? mySurveys : surveys).filter((s) => coincideBusqueda(s, searchQuery)),
        [showOnlyMine, mySurveys, surveys, searchQuery]
    );

    const asignadas = useMemo(() => surveys.filter((s) => s.miAsignacion), [surveys]);
    const pendientesTotal = asignadas.filter((s) => s.miAsignacion?.estado !== 'respondida').length;

    const globalStats = useMemo(() => {
        const destinatarios = surveys.reduce((acc, s) => acc + (s.stats?.totalRecipients || 0), 0);
        const respondidas = surveys.reduce((acc, s) => acc + (s.stats?.responded || 0), 0);
        return {
            total: surveys.length,
            activas: surveys.filter((s) => s.estado !== 'completada').length,
            destinatarios,
            tasa: porcentaje(respondidas, destinatarios),
        };
    }, [surveys]);

    // Quien no gestiona encuestas no tiene pestañas: solo ve lo suyo.
    const pestana: Pestana = canManageSurveys ? activeTab : 'assigned';

    const renderFilaAsignada = (survey: SurveyListItem) => {
        const respondida = survey.miAsignacion?.estado === 'respondida';
        const meta = respondida
            ? `Respondida el ${fechaCorta(survey.miAsignacion?.respondedAt)}`
            : survey.esFichaSalud
                ? 'Asignada automáticamente al ingresar a la obra'
                : `Asignada el ${fechaCorta(survey.createdAt)}`;
        const chip = respondida ? 'Respondida' : antiguedadAsignacion(survey.createdAt);
        return (
            <li key={survey.surveyId}>
                <Link
                    to={respondida ? `/surveys/${survey.surveyId}` : `/surveys/${survey.surveyId}/responder`}
                    className="survey-row"
                    aria-label={respondida ? `Ver ${survey.titulo}` : `Responder ${survey.titulo}`}
                >
                    <span className="survey-row-icon" aria-hidden="true">
                        {respondida ? <FiCheckCircle size={16} /> : <FiClipboard size={16} />}
                    </span>
                    <span className="survey-row-main">
                        <span className="survey-row-title">{survey.titulo}</span>
                        <span className="survey-row-meta">
                            {survey.totalPreguntas} pregunta{survey.totalPreguntas === 1 ? '' : 's'} · {meta}
                        </span>
                    </span>
                    <span className={`badge ${respondida ? 'badge-neutral' : chip === 'Nueva' ? 'badge-accent' : 'badge-warning'}`}>
                        {chip}
                    </span>
                    <FiChevronRight size={16} className="survey-row-chevron" aria-hidden="true" />
                </Link>
            </li>
        );
    };

    const renderAsignadas = () => {
        if (loading) {
            return <SurveyRowSectionSkeleton rows={3} />;
        }

        const visibles = asignadas.filter(coincide);
        if (visibles.length === 0) {
            const porBusqueda = searchQuery.trim() !== '' && asignadas.length > 0;
            return (
                <div className="card">
                    <div className="empty-state">
                        <div className="empty-state-icon">{porBusqueda ? <FiSearch /> : <FiCheckCircle />}</div>
                        <h3 className="empty-state-title">{porBusqueda ? 'Ninguna encuesta coincide' : 'Estás al día'}</h3>
                        <p className="empty-state-description">
                            {porBusqueda
                                ? `No encontramos encuestas que coincidan con «${searchQuery}».`
                                : 'No tienes encuestas asignadas. Cuando te asignen una, te llega un aviso a la bandeja y aparece aquí.'}
                        </p>
                    </div>
                </div>
            );
        }

        const pendientes = visibles.filter((s) => s.miAsignacion?.estado !== 'respondida');
        const respondidas = visibles.filter((s) => s.miAsignacion?.estado === 'respondida');
        return (
            <div className="survey-assigned">
                {pendientes.length > 0 && (
                    <section className="survey-row-section" aria-label="Pendientes">
                        <div className="survey-row-section-header">
                            <h2>Pendientes</h2>
                            <span>{pendientes.length} por responder</span>
                        </div>
                        <ul className="survey-row-list">{pendientes.map(renderFilaAsignada)}</ul>
                    </section>
                )}
                {respondidas.length > 0 && (
                    <section className="survey-row-section" aria-label="Respondidas">
                        <div className="survey-row-section-header">
                            <h2>Respondidas</h2>
                            <span>{respondidas.length} en total</span>
                        </div>
                        <ul className="survey-row-list">{respondidas.map(renderFilaAsignada)}</ul>
                    </section>
                )}
            </div>
        );
    };

    const renderTarjeta = (survey: SurveyListItem) => {
        const total = survey.stats?.totalRecipients || 0;
        const responded = survey.stats?.responded || 0;
        const pct = porcentaje(responded, total);
        const completada = survey.estado === 'completada';
        const colorAvance = pct >= 100 ? 'var(--success-apagado)' : 'var(--accent)';
        return (
            <article key={survey.surveyId} className="card survey-card">
                <div className="survey-card-head">
                    <div className="survey-card-title">
                        <h3>{survey.titulo}</h3>
                        {survey.esFichaSalud && <span className="badge badge-salud">Ficha de salud</span>}
                    </div>
                    <span className={`badge ${completada ? 'badge-neutral' : 'badge-accent'}`}>
                        {completada ? 'Completada' : 'Activa'}
                    </span>
                </div>
                <p className="survey-card-desc">{survey.descripcion || 'Sin descripción'}</p>
                <span className="survey-card-meta">
                    {survey.esFichaSalud ? 'Creación automática' : `Creada el ${fechaCorta(survey.createdAt)}`}
                    {' · '}Audiencia: {etiquetaAudiencia(survey)}
                </span>
                <div className="survey-card-metrics">
                    <span><strong>{survey.totalPreguntas}</strong><small>Preguntas</small></span>
                    <span><strong>{total}</strong><small>Destinatarios</small></span>
                    <span><strong>{responded}</strong><small>Respondidas</small></span>
                    <span><strong style={{ color: colorAvance }}>{pct}%</strong><small>Respuesta</small></span>
                </div>
                <div className="progress survey-card-progress">
                    <div className="progress-bar" style={{ width: `${pct}%`, background: colorAvance }} />
                </div>
                <Link to={`/surveys/${survey.surveyId}`} className="btn btn-secondary survey-card-cta">
                    Ver detalles
                </Link>
            </article>
        );
    };

    const renderCreadas = () => (
        <>
            <div className="survey-stats">
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
                            <span className="survey-stat-tile-value">{globalStats.total}</span>
                            <span className="survey-stat-tile-sub">{globalStats.activas} activa{globalStats.activas === 1 ? '' : 's'} ahora</span>
                        </div>
                        <div className="survey-stat-tile">
                            <span className="survey-stat-tile-label">Trabajadores alcanzados</span>
                            <span className="survey-stat-tile-value">{globalStats.destinatarios}</span>
                            <span className="survey-stat-tile-sub">de {totalWorkers} en la obra</span>
                        </div>
                        <div className="survey-stat-tile">
                            <span className="survey-stat-tile-label">Tasa de respuesta</span>
                            <span className="survey-stat-tile-value">{globalStats.tasa}%</span>
                            <div className="progress">
                                <div className="progress-bar" style={{ width: `${globalStats.tasa}%` }} />
                            </div>
                        </div>
                    </>
                )}
            </div>

            <section className="survey-created" aria-label="Encuestas creadas">
                <div className="survey-created-header">
                    <span>Encuestas creadas</span>
                    <small>Ordenadas por fecha de creación</small>
                </div>
                {loading ? (
                    <div className="survey-card-grid">
                        <SurveyCardSkeleton i={0} />
                        <SurveyCardSkeleton i={1} />
                    </div>
                ) : createdVisible.length === 0 ? (
                    <div className="card">
                        <div className="empty-state">
                            <div className="empty-state-icon">{searchQuery.trim() ? <FiSearch /> : <FiClipboard />}</div>
                            <h3 className="empty-state-title">
                                {searchQuery.trim() ? 'Ninguna encuesta coincide' : showOnlyMine ? 'No has creado encuestas' : 'Aún no hay encuestas'}
                            </h3>
                            <p className="empty-state-description">
                                {searchQuery.trim()
                                    ? `No encontramos encuestas que coincidan con «${searchQuery}».`
                                    : 'Crea una encuesta para recoger la opinión de los trabajadores de la obra.'}
                            </p>
                            {!searchQuery.trim() && (
                                <button className="btn btn-primary" onClick={() => navigate('/surveys/nueva')}>
                                    <FiPlus /> Nueva encuesta
                                </button>
                            )}
                        </div>
                    </div>
                ) : (
                    <div className="survey-card-grid">{createdVisible.map(renderTarjeta)}</div>
                )}
            </section>
        </>
    );

    return (
        <div className="page-content">
            <PageHeader
                banner
                title="Encuestas"
                description="Charlas de opinión, evaluaciones y fichas de salud respondidas por los trabajadores de la obra."
                tabs={canManageSurveys ? [
                    {
                        id: 'created', label: 'Encuestas creadas',
                        badge: surveys.length > 0 ? surveys.length : undefined,
                    },
                    {
                        id: 'assigned', label: 'Mis encuestas asignadas',
                        badge: pendientesTotal > 0 ? pendientesTotal : undefined,
                    },
                ] : undefined}
                activeTab={pestana}
                onTabChange={(id) => { setActiveTab(id as Pestana); setSearchQuery(''); }}
                tabsLabel="Vista de las encuestas"
                actions={canManageSurveys ? (
                    <button className="btn btn-primary" onClick={() => navigate('/surveys/nueva')}>
                        <FiPlus /> Nueva encuesta
                    </button>
                ) : undefined}
            />

            {(!isOnline || pendingCount > 0) && (
                <div className="survey-offline-banner">
                    <span className="survey-offline-banner-icon" aria-hidden="true">
                        <FiWifiOff size={17} />
                    </span>
                    <span className="survey-offline-banner-text">
                        {!isOnline && 'Sin conexión — las respuestas quedan guardadas en este dispositivo. '}
                        {pendingCount > 0 && <><strong>{pendingCount} encuesta{pendingCount === 1 ? '' : 's'}</strong> por sincronizar.</>}
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

            <div className="tbar">
                <div className="tbar-search">
                    <FiSearch size={15} />
                    <input
                        type="search"
                        placeholder={pestana === 'created' ? 'Buscar encuestas…' : 'Buscar en tus encuestas asignadas…'}
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                    />
                </div>
                {pestana === 'created' && (
                    <SegmentedControl
                        ariaLabel="Mostrar"
                        value={showOnlyMine ? 'mias' : 'todas'}
                        onChange={(v) => setShowOnlyMine(v === 'mias')}
                        options={[
                            { value: 'todas', label: `Todas · ${surveys.length}` },
                            { value: 'mias', label: `Creadas por mí · ${mySurveys.length}` },
                        ]}
                    />
                )}
            </div>

            {pestana === 'created' ? renderCreadas() : renderAsignadas()}
        </div>
    );
}
