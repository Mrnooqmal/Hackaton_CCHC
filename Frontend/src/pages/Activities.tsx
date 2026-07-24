import { useState, useEffect } from 'react';
import {
    FiPlus,
    FiUsers,
    FiCheck,
    FiMessageSquare,
    FiAlertTriangle,
    FiBook,
    FiAward,
    FiSearch,
    FiCalendar,
    FiClock,
    FiFileText,
    FiFilter
} from 'react-icons/fi';
import {
    activitiesApi,
    workersApi,
    tenantsApi,
    type Activity,
    type Worker,
    type CatalogosActividad,
    type PermisosTrabajoDef,
    type PlanificacionActividad,
    type PermisoTrabajo,
} from '../api/client';
import SignatureModal from '../components/SignatureModal';
import PlanificacionDiariaForm from '../components/actividades/PlanificacionDiariaForm';
import PermisosTrabajoForm from '../components/actividades/PermisosTrabajoForm';
import ReporteActividad from '../components/actividades/ReporteActividad';
import { Modal, Select, PageHeader } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { useObraContext } from '../context/ObraContext';
import { PERMISSIONS } from '../permissions';
import { useToast } from '../context/ToastContext';
import { useOfflineSignature } from '../hooks/useOfflineSignature';
import { useLocation } from 'react-router-dom';

const ACTIVITY_TYPES: Record<string, { label: string; color: string; icon: React.ReactElement }> = {
    CHARLA_5MIN: { label: 'Charla 5 Minutos', color: 'var(--primary-500)', icon: <FiMessageSquare /> },
    ART: { label: 'Análisis de Riesgos', color: 'var(--warning-500)', icon: <FiAlertTriangle /> },
    CAPACITACION: { label: 'Capacitación', color: 'var(--info-500)', icon: <FiBook /> },
    INDUCCION: { label: 'Inducción', color: 'var(--success-500)', icon: <FiAward /> },
    INSPECCION: { label: 'Inspección', color: 'var(--accent-500)', icon: <FiSearch /> },
    REUNION_COMITE: { label: 'Reunión Comité Paritario', color: 'var(--secondary-500, #7c3aed)', icon: <FiUsers /> },
    SIMULACRO: { label: 'Simulacro de Emergencia', color: 'var(--danger-500, #dc2626)', icon: <FiAlertTriangle /> },
};

// Subtipos de CAPACITACION segun el DS44 (deben coincidir con CAPACITACION_SUBTIPOS del backend).
const CAPACITACION_SUBTIPOS: Record<string, string> = {
    PRL_8H: 'Prevención de Riesgos Laborales (8h) — Art. 16',
    EPP: 'Uso y mantención de EPP — Art. 13',
    CPHS_ORIENTACION: 'Orientación CPHS (8h) — Art. 32',
    CPHS_20H: 'Curso 20h CPHS — Art. 32',
    DELEGADO: 'Capacitación Delegado SST — Art. 66',
    ENCARGADO: 'Encargado Gestión del Riesgo — Art. 65',
    OTRA: 'Otra capacitación',
};

// Opciones de periodicidad para actividades recurrentes.
const FRECUENCIA_OPCIONES: Record<'unica' | 'diaria' | 'semanal' | 'mensual', string> = {
    unica: 'Una vez (sin repetir)',
    diaria: 'Diaria',
    semanal: 'Semanal',
    mensual: 'Mensual',
};
const labelFrecuencia = (f: 'unica' | 'diaria' | 'semanal' | 'mensual') => FRECUENCIA_OPCIONES[f].toLowerCase();

export default function Activities() {
    const { user, hasPermission } = useAuth();
    const canCrearActividad = hasPermission(PERMISSIONS.ACTIVIDADES_CREAR);
    const { isOnline, pendingCount, signActivity, syncPendingSignatures } = useOfflineSignature();
    const { toast } = useToast();
    const { selectedObraId, obras } = useObraContext();
    const selectedObra = obras.find(o => o.obraId === selectedObraId) ?? null;
    const [activities, setActivities] = useState<Activity[]>([]);
    const [workers, setWorkers] = useState<Worker[]>([]);
    const [loading, setLoading] = useState(true);
    const [showModal, setShowModal] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [showAttendanceModal, setShowAttendanceModal] = useState(false);
    const [selectedActivity, setSelectedActivity] = useState<Activity | null>(null);
    const [showDetailModal, setShowDetailModal] = useState(false);
    const [detailActivity, setDetailActivity] = useState<Activity | null>(null);
    const [selectedWorkers, setSelectedWorkers] = useState<string[]>([]);
    // Filtrado de asistentes por relator: por defecto la charla muestra solo el
    // grupo del relator (su cuadrilla / las cuadrillas de sus supervisores). El
    // toggle permite expandir a toda la obra por si algún vínculo no está cargado.
    const [verTodaLaObra, setVerTodaLaObra] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const [filterType, setFilterType] = useState('');
    const [showSignatureModal, setShowSignatureModal] = useState(false);
    const [signatureError, setSignatureError] = useState('');
    // Firma asistida SECUENCIAL: cada trabajador firma con su propio PIN, uno a uno.
    const [signingIndex, setSigningIndex] = useState(0);
    const [signingResults, setSigningResults] = useState<{ signed: number; skipped: number }>({ signed: 0, skipped: 0 });
    const [showSelfSignModal, setShowSelfSignModal] = useState(false);
    const [selfSignActivity, setSelfSignActivity] = useState<Activity | null>(null);
    const [catalogos, setCatalogos] = useState<CatalogosActividad | null>(null);
    const [permisosDef, setPermisosDef] = useState<PermisosTrabajoDef>({});
    const [showEditModal, setShowEditModal] = useState(false);
    const [editActivity, setEditActivity] = useState<Activity | null>(null);
    const [editDraft, setEditDraft] = useState<{ planificacion: PlanificacionActividad; permisosTrabajo: PermisoTrabajo[] }>({ planificacion: {}, permisosTrabajo: [] });
    const [editSaving, setEditSaving] = useState(false);

    // Check if user is a worker (can self-sign)
    const canSelfSign = user?.rol === 'trabajador' && user?.personaId;
    // Check if user can manage (prevencionista/admin)
    const canManage = canCrearActividad;

    const emptyActivity = {
        tipo: 'CHARLA_5MIN',
        subtipo: '',
        titulo: '',
        descripcion: '',
        relatorId: '',
        fecha: new Date().toISOString().split('T')[0],
        horaInicio: new Date().toTimeString().slice(0, 5),
        horaFin: '',
        ubicacion: '',
        asistentesRequeridos: [] as string[],
        // Periodicidad: 'unica' (sin repetición) o repetir hasta una fecha.
        frecuencia: 'unica' as 'unica' | 'diaria' | 'semanal' | 'mensual',
        repetirHasta: '',
        // Vínculo con un ítem de onboarding (si se agendó desde el Equipo).
        kitItemKey: '' as string,
        planificacion: { observaciones: '' } as PlanificacionActividad,
        permisosTrabajo: [] as PermisoTrabajo[],
    };
    const [newActivity, setNewActivity] = useState(emptyActivity);
    const location = useLocation();

    useEffect(() => {
        loadData();
    }, [selectedObraId]);

    // Catálogos de planificación diaria (temas/recursos/riesgos/medidas) y
    // definición de permisos de trabajo del tenant, para el formulario de creación.
    useEffect(() => {
        if (!user?.tenantId) return;
        tenantsApi.getCatalogosActividad(user.tenantId).then((res) => {
            if (res.success && res.data) {
                setCatalogos(res.data.catalogos);
                setPermisosDef(res.data.permisosTrabajoDef);
            }
        }).catch(() => {
            toast.error('No se pudieron cargar los catálogos de actividades. Recarga la página para crear charlas o ART.');
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [user?.tenantId]);

    // Prefill desde el Equipo de la obra: "Agendar" una capacitación para una persona.
    useEffect(() => {
        const prefill = (location.state as any)?.prefill;
        if (!prefill || !prefill.personaId) return;
        setNewActivity({
            ...emptyActivity,
            tipo: 'CAPACITACION',
            subtipo: prefill.subtipo || 'OTRA',
            titulo: prefill.titulo || '',
            asistentesRequeridos: [prefill.personaId],
            kitItemKey: prefill.kitItemKey || '',
        });
        setShowModal(true);
        window.history.replaceState({}, ''); // evita reabrir al volver
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Sync pending offline signatures when online
    useEffect(() => {
        if (isOnline && pendingCount > 0) {
            syncPendingSignatures().then(result => {
                if (result.synced > 0) {
                    toast.success(`${result.synced} firma(s) sincronizada(s)`);
                    loadData();
                }
            });
        }
    }, [isOnline]);

    const loadData = async () => {
        // Sin obra seleccionada no se carga nada: la vista muestra el estado vacío.
        if (!selectedObraId) {
            setActivities([]);
            setWorkers([]);
            setLoading(false);
            return;
        }
        setLoading(true);
        try {
            const [activitiesRes, workersRes] = await Promise.all([
                activitiesApi.list({ obraId: selectedObraId }),
                workersApi.list({ obraId: selectedObraId })
            ]);

            if (activitiesRes.success && activitiesRes.data) {
                // Aislamiento por obra: aunque el backend devuelva de más (registros
                // legacy sin obraId), solo mostramos los de la obra activa.
                setActivities(activitiesRes.data.activities.filter(a => a.obraId === selectedObraId));
            }
            if (workersRes.success && workersRes.data) {
                setWorkers(workersRes.data);
            }
        } catch (error) {
            console.error('Error loading data:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleCreateActivity = async (e: React.FormEvent) => {
        e.preventDefault();
        if (submitting) return;
        if (!selectedObraId) {
            toast.error('Seleccione una obra antes de crear una actividad');
            return;
        }
        if (['CHARLA_5MIN', 'ART'].includes(newActivity.tipo) && !catalogos) {
            toast.error('No se pudieron cargar los catálogos de actividades. Recarga la página para crear charlas o ART.');
            return;
        }

        setSubmitting(true);
        try {
            const payload: any = { ...newActivity, obraId: selectedObraId };
            // El subtipo solo aplica a capacitaciones.
            if (payload.tipo !== 'CAPACITACION') delete payload.subtipo;
            // Campos opcionales vacíos no se envían.
            if (!payload.horaFin) delete payload.horaFin;
            if (!payload.ubicacion) delete payload.ubicacion;
            // Periodicidad: validar que la repetición tenga fecha de término.
            if (payload.frecuencia === 'unica') {
                delete payload.frecuencia;
                delete payload.repetirHasta;
            } else if (!payload.repetirHasta) {
                toast.error('Indica hasta qué fecha se debe repetir la actividad');
                setSubmitting(false);
                return;
            } else if (payload.repetirHasta < payload.fecha) {
                toast.error('La fecha de término debe ser posterior a la fecha de inicio');
                setSubmitting(false);
                return;
            }
            // La planificación completa solo aplica a charlas/ART; para el resto
            // solo viajan las observaciones (si las hay).
            if (!['CHARLA_5MIN', 'ART'].includes(payload.tipo)) {
                const obs = payload.planificacion?.observaciones?.trim();
                payload.planificacion = obs ? { observaciones: obs } : undefined;
                payload.permisosTrabajo = undefined;
            }
            const response = await activitiesApi.create(payload);
            if (response.success && response.data) {
                const data = response.data as any;
                if (data?.serie) {
                    // Serie recurrente: recargamos para traer todas las ocurrencias de la obra.
                    await loadData();
                    toast.success(`${data.count} actividades creadas (serie ${labelFrecuencia(newActivity.frecuencia)})`);
                } else {
                    setActivities([data, ...activities]);
                    toast.success('Actividad creada correctamente');
                }
                setShowModal(false);
                setNewActivity(emptyActivity);
            } else {
                toast.error(response.error || 'Error al crear la actividad');
            }
        } catch (error) {
            console.error('Error creating activity:', error);
            toast.error('Error al crear la actividad');
        } finally {
            setSubmitting(false);
        }
    };

    // Inicia la firma asistida SECUENCIAL: empieza por el primer trabajador.
    const startSequentialSigning = () => {
        if (selectedWorkers.length === 0) return;
        setSignatureError('');
        setSigningIndex(0);
        setSigningResults({ signed: 0, skipped: 0 });
        setShowSignatureModal(true);
    };

    // Cierra el flujo secuencial y muestra el resumen.
    const finishSequentialSigning = (signed: number, skipped: number) => {
        setShowSignatureModal(false);
        setShowAttendanceModal(false);
        setSelectedActivity(null);
        setSelectedWorkers([]);
        setSigningIndex(0);
        loadData();
        if (signed > 0 && skipped === 0) toast.success(`Asistencia registrada para ${signed} trabajador(es)`);
        else if (signed > 0 && skipped > 0) toast.success(`${signed} firmada(s), ${skipped} omitida(s)`);
        else toast.info('No se registró ninguna asistencia');
    };

    // Avanza al siguiente trabajador o termina si era el último.
    const advanceSigning = (signedDelta: number, skippedDelta: number) => {
        const nextIndex = signingIndex + 1;
        const signed = signingResults.signed + signedDelta;
        const skipped = signingResults.skipped + skippedDelta;
        setSigningResults({ signed, skipped });
        if (nextIndex >= selectedWorkers.length) {
            finishSequentialSigning(signed, skipped);
        } else {
            setSignatureError('');
            setSigningIndex(nextIndex);
        }
    };

    // Firma del trabajador actual con SU PIN. Si falla, lanza para que el modal
    // muestre el error y el mismo trabajador reintente (no avanza).
    const handleSignCurrentWorker = async (pin: string) => {
        if (!selectedActivity) return;
        const workerId = selectedWorkers[signingIndex];
        const worker = workers.find(w => w.personaId === workerId);
        const nombre = worker ? `${worker.nombre} ${worker.apellido || ''}`.trim() : 'Trabajador';
        setSignatureError('');

        // Offline-first: guarda localmente con el PIN de este trabajador.
        if (!navigator.onLine) {
            await signActivity(selectedActivity.activityId, selectedActivity.titulo, workerId, nombre, pin);
            advanceSigning(1, 0);
            return;
        }

        const response = await activitiesApi.registerAttendance(selectedActivity.activityId, {
            workerIds: [workerId],
            // La firma del relator se incluye solo en la primera firma de la sesión.
            incluirFirmaRelator: signingIndex === 0,
            pin,
        });

        if (response.success) {
            advanceSigning(1, 0);
            return;
        }

        // Error de red → cae a offline para este trabajador.
        const errMsg = (response.error || '').toLowerCase();
        if (errMsg.includes('fetch') || errMsg.includes('network')) {
            await signActivity(selectedActivity.activityId, selectedActivity.titulo, workerId, nombre, pin);
            advanceSigning(1, 0);
            return;
        }

        // PIN incorrecto u otro error de validación → lanza para reintento del mismo.
        throw new Error(response.error || `PIN incorrecto para ${nombre}. Inténtalo de nuevo.`);
    };

    // Salta al trabajador actual (ej. ausente o no recuerda su PIN).
    const handleSkipCurrentWorker = () => advanceSigning(0, 1);

    const openAttendanceModal = (activity: Activity) => {
        setSelectedActivity(activity);
        setVerTodaLaObra(false);
        setShowAttendanceModal(true);
    };

    const openDetailModal = (activity: Activity) => {
        setDetailActivity(activity);
        setShowDetailModal(true);
    };

    const handleSaveRegistro = async () => {
        if (!editActivity || editSaving) return;
        setEditSaving(true);
        try {
            const res = await activitiesApi.patch(editActivity.activityId, {
                ...editDraft,
                solicitanteId: user?.personaId,
            });
            if (res.success && res.data) {
                setActivities((prev) => prev.map((a) => a.activityId === res.data!.activityId ? res.data! : a));
                setShowEditModal(false);
                toast.success('Registro actualizado');
            } else {
                toast.error(res.error || 'Error al guardar el registro');
            }
        } finally {
            setEditSaving(false);
        }
    };

    const toggleRequiredAttendee = (personaId: string) => {
        setNewActivity(prev => ({
            ...prev,
            asistentesRequeridos: prev.asistentesRequeridos.includes(personaId)
                ? prev.asistentesRequeridos.filter(id => id !== personaId)
                : [...prev.asistentesRequeridos, personaId],
        }));
    };

    // Self-sign handler for workers
    const handleSelfSign = async (pin: string) => {
        if (!selfSignActivity || !user?.personaId) return;
        setSignatureError('');
        try {
            const result = await signActivity(
                selfSignActivity.activityId,
                selfSignActivity.titulo,
                user.personaId,
                user.nombre || 'Trabajador',
                pin
            );

            if (result.success) {
                setShowSelfSignModal(false);
                setSelfSignActivity(null);
                if (result.offline) {
                    toast.info('Asistencia guardada localmente. Se sincronizara cuando vuelva la conexion.');
                } else {
                    toast.success('Tu asistencia ha sido registrada exitosamente');
                    loadData();
                }
            } else {
                setSignatureError(result.error || 'Error al registrar tu asistencia');
            }
        } catch (error: any) {
            console.error('Error self-signing:', error);
            setSignatureError(error.message || 'Error al registrar tu asistencia');
        }
    };

    const openSelfSignModal = (activity: Activity) => {
        setSelfSignActivity(activity);
        setShowSelfSignModal(true);
    };

    const toggleWorkerSelection = (workerId: string) => {
        setSelectedWorkers(prev =>
            prev.includes(workerId)
                ? prev.filter(id => id !== workerId)
                : [...prev, workerId]
        );
    };

    // Trabajadores visibles para un relator: si es supervisor, su cuadrilla; si es
    // prevencionista, los supervisores a su cargo y las cuadrillas de ellos. Si el
    // relator está por encima de la cadena (jefe de obra / admin) o no hay vínculos
    // cargados, `scoped` es false y se muestra toda la obra.
    const scopeWorkersFor = (relatorId: string): { list: Worker[]; scoped: boolean } => {
        if (!relatorId) return { list: workers, scoped: false };
        const asigOf = (w: Worker) => (w.asignaciones || []).find(a => a.obraId === selectedObraId);
        const supsDelPrev = new Set(
            workers.filter(w => asigOf(w)?.prevencionistaPersonaId === relatorId).map(w => w.personaId)
        );
        const list = workers.filter(w => {
            const a = asigOf(w);
            if (!a) return false;
            if (a.supervisorPersonaId === relatorId) return true;                 // cuadrilla del supervisor-relator
            if (supsDelPrev.has(w.personaId)) return true;                        // supervisores del prevencionista-relator
            if (a.supervisorPersonaId && supsDelPrev.has(a.supervisorPersonaId)) return true; // sus trabajadores
            return false;
        });
        return list.length ? { list, scoped: true } : { list: workers, scoped: false };
    };

    // Lista efectiva de asistentes para un relator, respetando el toggle "ver toda
    // la obra". Compartida por el form de creación y el modal de asistencia.
    const visibleWorkersFor = (relatorId: string): { list: Worker[]; scoped: boolean } => {
        const s = scopeWorkersFor(relatorId);
        if (verTodaLaObra || !s.scoped) return { list: workers, scoped: s.scoped };
        return s;
    };

    const selectAllWorkers = () => {
        const visible = visibleWorkersFor(selectedActivity?.relatorId || '').list;
        const visibleIds = visible.map(w => w.personaId);
        const allSelected = visibleIds.every(id => selectedWorkers.includes(id));
        if (allSelected) {
            setSelectedWorkers(prev => prev.filter(id => !visibleIds.includes(id)));
        } else {
            setSelectedWorkers(prev => Array.from(new Set([...prev, ...visibleIds])));
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center" style={{ height: '100vh' }}>
                <div className="spinner" />
            </div>
        );
    }

    const today = new Date().toISOString().split('T')[0];

    const matchesFilters = (a: Activity) => {
        const matchesSearch = searchTerm.trim() === '' ||
            a.titulo.toLowerCase().includes(searchTerm.toLowerCase()) ||
            (a.descripcion && a.descripcion.toLowerCase().includes(searchTerm.toLowerCase()));
        const matchesType = filterType === '' || a.tipo === filterType;
        return matchesSearch && matchesType;
    };

    const todayActivities = activities.filter(a => a.fecha === today && matchesFilters(a));
    // "Historial" = solo actividades que YA pasaron (fecha anterior a hoy). Las de hoy
    // van en su propia sección y las futuras son recordatorios (no historial).
    const filteredActivities = activities.filter(a => a.fecha < today && matchesFilters(a));
    const upcomingActivities = activities.filter(a => a.fecha > today && matchesFilters(a));

    // Una actividad solo es FIRMABLE cuando ya empezó (fecha+hora de inicio <= ahora).
    // Antes de eso es un recordatorio de asistencia, no se puede firmar todavía.
    const haComenzado = (a: Activity): boolean => {
        if (a.fecha < today) return true;
        if (a.fecha > today) return false;
        const inicio = (a.horaInicio || '00:00').slice(0, 5);
        const ahora = new Date().toTimeString().slice(0, 5);
        return ahora >= inicio;
    };

    return (
        <>



            <div className="page-content">
                <PageHeader
                    banner
                    scope={{ label: selectedObra?.nombre ? `Obra · ${selectedObra.nombre}` : 'Actividades' }}
                    title="Actividades y capacitación"
                    description="Charlas de 5 minutos, inducciones, ART y capacitación técnica, con asistencia y firma de los participantes."
                    actions={
                        canCrearActividad ? (
                            <button
                                className="btn btn-save"
                                disabled={!selectedObraId}
                                title={!selectedObraId ? 'Selecciona una obra en la barra superior para crear una actividad' : undefined}
                                onClick={() => { setVerTodaLaObra(false); setShowModal(true); }}
                            >
                                <FiPlus /> Nueva actividad
                            </button>
                        ) : undefined
                    }
                />

                {/* Gate: obra requerida */}
                {!selectedObraId && (
                    <div className="empty-state" style={{ padding: 'var(--space-16) var(--space-6)' }}>
                        <div className="empty-state-icon">
                            <FiCalendar size={48} style={{ color: 'var(--text-muted)' }} />
                        </div>
                        <h3 className="empty-state-title">Seleccione una obra para ver sus actividades</h3>
                        <p className="empty-state-description">
                            Use el selector de obra en la barra superior para elegir la obra de la que
                            desea ver o registrar actividades.
                        </p>
                    </div>
                )}

                {/* Contenido — solo visible cuando hay obra seleccionada */}
                {selectedObraId && <>

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
                                    <FiAlertTriangle size={18} />
                                    <span className="font-medium">Sin conexión - Tu asistencia se guardará localmente</span>
                                </>
                            ) : (
                                <>
                                    <FiCheck size={18} />
                                    <span className="font-medium">{pendingCount} registro(s) pendiente(s) de sincronizar</span>
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

                {/* Toolbar: búsqueda + filtro */}
                <div className="tbar">
                    <div className="tbar-search">
                        <FiSearch size={15} />
                        <input
                            type="text"
                            placeholder="Buscar actividades…"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                        />
                    </div>
                    <div style={{ minWidth: '210px' }}>
                        <Select
                            ariaLabel="Filtrar por tipo"
                            leadingIcon={<FiFilter size={18} />}
                            value={filterType}
                            onChange={setFilterType}
                            options={[
                                { value: '', label: 'Todos los tipos' },
                                ...Object.entries(ACTIVITY_TYPES).map(([key, { label }]) => ({ value: key, label })),
                            ]}
                        />
                    </div>
                </div>

                {/* Today's Activities */}
                <div className="card mb-6">
                    <div className="card-header">
                        <div>
                            <h2 className="card-title">Actividades de Hoy</h2>
                            <p className="card-subtitle">
                                {new Date().toLocaleDateString('es-CL', {
                                    weekday: 'long',
                                    year: 'numeric',
                                    month: 'long',
                                    day: 'numeric'
                                })}
                                {upcomingActivities.length > 0 && (
                                    <span style={{ marginLeft: 8, color: 'var(--text-muted)' }}>
                                        · {upcomingActivities.length} programada(s) próximamente
                                    </span>
                                )}
                            </p>
                        </div>
                    </div>

                    {todayActivities.length === 0 ? (
                        <div className="empty-state" style={{ padding: 'var(--space-8)' }}>
                            <div className="empty-state-icon"><FiCalendar size={48} style={{ color: 'var(--text-muted)' }} /></div>
                            <h3 className="empty-state-title">Sin actividades hoy</h3>
                            <p className="empty-state-description">
                                Registra la primera actividad del día, como la charla de 5 minutos.
                            </p>
                        </div>
                    ) : (
                        <div className="flex flex-col gap-3">
                            <style>{`
                                .activity-today-card { transition: background 0.12s, border-color 0.12s; }
                                .activity-today-card:hover { background: var(--surface-hover) !important; border-color: var(--accent) !important; }
                                .activity-today-card:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
                            `}</style>
                            {todayActivities.map((activity) => {
                                const typeInfo = ACTIVITY_TYPES[activity.tipo] || {
                                    label: activity.tipo,
                                    color: 'var(--gray-500)',
                                    icon: <FiFileText />
                                };

                                return (
                                    <div
                                        key={activity.activityId}
                                        className="activity-today-card flex items-center justify-between"
                                        role="button"
                                        tabIndex={0}
                                        title="Ver detalle y asistentes"
                                        onClick={() => openDetailModal(activity)}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter' || e.key === ' ') {
                                                e.preventDefault();
                                                openDetailModal(activity);
                                            }
                                        }}
                                        style={{
                                            padding: 'var(--space-4)',
                                            background: 'var(--surface-elevated)',
                                            borderRadius: 'var(--radius-md)',
                                            border: '1px solid var(--surface-border)',
                                            cursor: 'pointer'
                                        }}
                                    >
                                        <div className="flex items-center gap-4">
                                            <div
                                                className="avatar"
                                                style={{ background: typeInfo.color, fontSize: '1.2rem' }}
                                            >
                                                {typeInfo.icon}
                                            </div>
                                            <div>
                                                <div className="font-bold">{activity.titulo}</div>
                                                <div className="text-sm text-muted">
                                                    {typeInfo.label}
                                                    {activity.subtipo && ` · ${activity.subtipoDescripcion || CAPACITACION_SUBTIPOS[activity.subtipo] || activity.subtipo}`}
                                                    {' • '}{activity.horaInicio}
                                                    {activity.horaFin && ` - ${activity.horaFin}`}
                                                </div>
                                            </div>
                                        </div>

                                        <div className="flex items-center gap-4">
                                            <div className="flex items-center gap-2">
                                                <FiUsers />
                                                <span>{activity.asistentes.length} asistentes</span>
                                            </div>

                                            <span className={`badge badge-${activity.estado === 'completada' ? 'success' :
                                                activity.estado === 'programada' ? 'neutral' : 'warning'
                                                }`}>
                                                {activity.estado === 'completada' ? 'Completada' :
                                                    activity.estado === 'programada' ? 'Programada' : 'En curso'}
                                            </span>

                                            {activity.estado !== 'completada' && (
                                                haComenzado(activity) ? (
                                                    <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                                                        {/* Worker self-sign button */}
                                                        {canSelfSign && !activity.asistentes.some(a => a.workerId === user?.personaId || (a as any).personaId === user?.personaId) && (
                                                            <button
                                                                className="btn btn-secondary btn-sm"
                                                                onClick={() => openSelfSignModal(activity)}
                                                            >
                                                                <FiCheck />
                                                                Registrar mi asistencia
                                                            </button>
                                                        )}
                                                        {/* Manager mass attendance button */}
                                                        {canManage && (
                                                            <button
                                                                className="btn btn-primary btn-sm"
                                                                onClick={() => openAttendanceModal(activity)}
                                                            >
                                                                <FiCheck />
                                                                Registrar Asistencia
                                                            </button>
                                                        )}
                                                    </div>
                                                ) : (
                                                    <span className="text-xs text-muted" title={`Disponible para firmar a las ${(activity.horaInicio || '').slice(0,5)}`}>
                                                        <FiClock size={12} style={{ verticalAlign: 'middle', marginRight: 4 }} />
                                                        Aún no comienza · firma disponible desde {(activity.horaInicio || '').slice(0, 5)}
                                                    </span>
                                                )
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>

                {/* All Activities */}
                <div className="card">
                    <div className="card-header">
                        <h2 className="card-title">Historial de Actividades</h2>
                    </div>

                    <div className="table-container">
                        <table className="table">
                            <thead>
                                <tr>
                                    <th>Fecha</th>
                                    <th>Hora</th>
                                    <th>Actividad</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filteredActivities.length === 0 ? (
                                    <tr>
                                        <td colSpan={3}>
                                            <div className="text-sm text-muted" style={{ padding: 'var(--space-4)', textAlign: 'center' }}>
                                                No hay actividades registradas para esta obra.
                                            </div>
                                        </td>
                                    </tr>
                                ) : filteredActivities.slice(0, 10).map((activity) => (
                                    <tr
                                        key={activity.activityId}
                                        style={{ cursor: 'pointer' }}
                                        onClick={() => openDetailModal(activity)}
                                    >
                                        <td>{new Date(activity.fecha).toLocaleDateString('es-CL')}</td>
                                        <td>
                                            {activity.horaInicio}
                                            {activity.horaFin && ` - ${activity.horaFin}`}
                                        </td>
                                        <td>
                                            <div className="font-bold">{activity.titulo}</div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>

                </>}

                {/* Create Activity Modal */}
                <Modal
                    isOpen={showModal}
                    onClose={() => !submitting && setShowModal(false)}
                    preventClose={submitting}
                    title="Nueva Actividad"
                    footer={
                        <>
                            <button type="button" className="btn btn-secondary" disabled={submitting} onClick={() => setShowModal(false)}>Cancelar</button>
                            <button type="submit" form="create-activity-form" className="btn btn-primary" disabled={submitting}>
                                {submitting ? 'Creando…' : 'Crear Actividad'}
                            </button>
                        </>
                    }
                >
                    <form id="create-activity-form" onSubmit={handleCreateActivity}>
                        <div className="form-group">
                            <label className="form-label">Tipo de Actividad *</label>
                            <Select
                                ariaLabel="Tipo de actividad"
                                value={newActivity.tipo}
                                onChange={(v) => setNewActivity({ ...newActivity, tipo: v })}
                                options={Object.entries(ACTIVITY_TYPES).map(([key, { label, icon }]) => ({
                                    value: key,
                                    label,
                                    icon,
                                }))}
                            />
                        </div>

                        {newActivity.tipo === 'CAPACITACION' && (
                            <div className="form-group">
                                <label className="form-label">Tipo de capacitación (DS44) *</label>
                                <Select
                                    ariaLabel="Tipo de capacitación DS44"
                                    placeholder="Seleccione el tipo de capacitación"
                                    searchable
                                    value={newActivity.subtipo}
                                    onChange={(v) => setNewActivity({ ...newActivity, subtipo: v })}
                                    options={Object.entries(CAPACITACION_SUBTIPOS).map(([key, label]) => ({
                                        value: key,
                                        label,
                                    }))}
                                />
                            </div>
                        )}

                        <div className="form-group">
                            <label className="form-label">Título *</label>
                            <input
                                type="text"
                                value={newActivity.titulo}
                                onChange={(e) => setNewActivity({ ...newActivity, titulo: e.target.value })}
                                className="form-input"
                                placeholder="Ej: Uso correcto de EPP"
                                required
                            />
                        </div>

                        <div className="form-group">
                            <label className="form-label">Descripción</label>
                            <textarea
                                value={newActivity.descripcion}
                                onChange={(e) => setNewActivity({ ...newActivity, descripcion: e.target.value })}
                                className="form-input"
                                rows={3}
                                placeholder="Descripción de la actividad..."
                                style={{ resize: 'vertical' }}
                            />
                        </div>

                        <div className="form-group">
                            <label className="form-label">Relator *</label>
                            <Select
                                ariaLabel="Relator"
                                placeholder="Seleccione un relator"
                                searchable
                                value={newActivity.relatorId}
                                onChange={(v) => setNewActivity({ ...newActivity, relatorId: v })}
                                options={workers.map((worker) => ({
                                    value: worker.personaId,
                                    label: `${worker.nombre} ${worker.apellido}`,
                                    description: worker.cargo,
                                }))}
                            />
                        </div>

                        <div className="form-group">
                            <label className="form-label">{newActivity.frecuencia === 'unica' ? 'Fecha *' : 'Fecha de inicio *'}</label>
                            <input
                                type="date"
                                value={newActivity.fecha}
                                onChange={(e) => setNewActivity({ ...newActivity, fecha: e.target.value })}
                                className="form-input"
                                required
                            />
                        </div>

                        <div className="grid grid-cols-2" style={{ gap: 'var(--space-4)' }}>
                            <div className="form-group">
                                <label className="form-label">Periodicidad</label>
                                <Select
                                    ariaLabel="Periodicidad"
                                    value={newActivity.frecuencia}
                                    onChange={(v) => setNewActivity({ ...newActivity, frecuencia: v as typeof newActivity.frecuencia })}
                                    options={Object.entries(FRECUENCIA_OPCIONES).map(([value, label]) => ({ value, label }))}
                                />
                            </div>
                            {newActivity.frecuencia !== 'unica' && (
                                <div className="form-group">
                                    <label className="form-label">Repetir hasta *</label>
                                    <input
                                        type="date"
                                        value={newActivity.repetirHasta}
                                        min={newActivity.fecha}
                                        onChange={(e) => setNewActivity({ ...newActivity, repetirHasta: e.target.value })}
                                        className="form-input"
                                        required
                                    />
                                </div>
                            )}
                        </div>

                        {newActivity.frecuencia !== 'unica' && (
                            <div className="form-group" style={{ marginTop: 'calc(-1 * var(--space-2))' }}>
                                <p className="text-xs text-muted" style={{ margin: 0 }}>
                                    Se creará una actividad {labelFrecuencia(newActivity.frecuencia)} a las {newActivity.horaInicio || '—'} desde {newActivity.fecha || '—'}{newActivity.repetirHasta ? ` hasta ${newActivity.repetirHasta}` : ''}.
                                </p>
                            </div>
                        )}

                        <div className="grid grid-cols-2" style={{ gap: 'var(--space-4)' }}>
                            <div className="form-group">
                                <label className="form-label">Hora inicio *</label>
                                <input
                                    type="time"
                                    value={newActivity.horaInicio}
                                    onChange={(e) => setNewActivity({ ...newActivity, horaInicio: e.target.value })}
                                    className="form-input"
                                    required
                                />
                            </div>
                            <div className="form-group">
                                <label className="form-label">Hora fin</label>
                                <input
                                    type="time"
                                    value={newActivity.horaFin}
                                    onChange={(e) => setNewActivity({ ...newActivity, horaFin: e.target.value })}
                                    className="form-input"
                                />
                            </div>
                        </div>

                        <div className="form-group">
                            <label className="form-label">Ubicación</label>
                            <input
                                type="text"
                                value={newActivity.ubicacion}
                                onChange={(e) => setNewActivity({ ...newActivity, ubicacion: e.target.value })}
                                className="form-input"
                                placeholder="Ej: Frente de obra, sala de charlas..."
                            />
                        </div>

                        {catalogos && (
                            <PlanificacionDiariaForm
                                value={newActivity.planificacion}
                                onChange={(planificacion) => setNewActivity({ ...newActivity, planificacion })}
                                catalogos={catalogos}
                                tipoActividad={newActivity.tipo}
                            />
                        )}

                        {['CHARLA_5MIN', 'ART'].includes(newActivity.tipo) && Object.keys(permisosDef).length > 0 && (
                            <PermisosTrabajoForm
                                value={newActivity.permisosTrabajo}
                                onChange={(permisosTrabajo) => setNewActivity({ ...newActivity, permisosTrabajo })}
                                permisosDef={permisosDef}
                                workers={workers}
                            />
                        )}

                        <div className="form-group">
                            <div className="flex items-center justify-between" style={{ marginBottom: 'var(--space-1)' }}>
                                <label className="form-label" style={{ margin: 0 }}>
                                    Asistentes requeridos
                                    {newActivity.asistentesRequeridos.length > 0 && ` (${newActivity.asistentesRequeridos.length})`}
                                </label>
                                {scopeWorkersFor(newActivity.relatorId).scoped && (
                                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setVerTodaLaObra(v => !v)}>
                                        {verTodaLaObra ? 'Ver solo mi grupo' : 'Ver toda la obra'}
                                    </button>
                                )}
                            </div>
                            {(() => {
                                const visibles = visibleWorkersFor(newActivity.relatorId).list;
                                return workers.length === 0 ? (
                                <div className="text-sm text-muted">No hay trabajadores asignados a esta obra.</div>
                            ) : visibles.length === 0 ? (
                                <div className="text-sm text-muted">Este relator no tiene trabajadores en su grupo. Usa "Ver toda la obra" para elegir de todos modos.</div>
                            ) : (
                                <div className="flex flex-col gap-2" style={{ maxHeight: '220px', overflowY: 'auto' }}>
                                    {visibles.map((worker) => {
                                        const isSelected = newActivity.asistentesRequeridos.includes(worker.personaId);
                                        return (
                                            <div
                                                key={worker.personaId}
                                                className="flex items-center justify-between cursor-pointer"
                                                style={{
                                                    padding: 'var(--space-2) var(--space-3)',
                                                    background: isSelected ? 'rgba(76, 175, 80, 0.1)' : 'var(--surface-elevated)',
                                                    borderRadius: 'var(--radius-md)',
                                                    border: isSelected ? '1px solid var(--primary-500)' : '1px solid transparent',
                                                }}
                                                onClick={() => toggleRequiredAttendee(worker.personaId)}
                                            >
                                                <div className="flex items-center gap-3">
                                                    <div className="avatar avatar-sm">{worker.nombre.charAt(0)}</div>
                                                    <div>
                                                        <div className="font-bold">{worker.nombre} {worker.apellido}</div>
                                                        <div className="text-sm text-muted">{worker.cargo}</div>
                                                    </div>
                                                </div>
                                                <div style={{ width: '22px', height: '22px', borderRadius: '4px', border: '2px solid var(--surface-border)', background: isSelected ? 'var(--primary-500)' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                                    {isSelected && <FiCheck style={{ color: 'white' }} />}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            );
                            })()}
                        </div>
                    </form>
                </Modal>

                {/* Attendance Modal */}
                <Modal
                    isOpen={showAttendanceModal && !!selectedActivity}
                    onClose={() => setShowAttendanceModal(false)}
                    title="Registrar Asistencia"
                    subtitle={selectedActivity?.titulo}
                    size="lg"
                    footer={
                        <>
                            <button type="button" className="btn btn-secondary" onClick={() => setShowAttendanceModal(false)}>Cancelar</button>
                            <button
                                className="btn btn-primary"
                                disabled={selectedWorkers.length === 0}
                                onClick={startSequentialSigning}
                            >
                                <FiCheck />
                                Firmar {selectedWorkers.length} Asistencia(s) con PIN
                            </button>
                        </>
                    }
                >
                    {selectedActivity && (() => {
                        const visiblesAsist = visibleWorkersFor(selectedActivity.relatorId).list;
                        const hayScope = scopeWorkersFor(selectedActivity.relatorId).scoped;
                        const visiblesIds = visiblesAsist.map(w => w.personaId);
                        const todosVisiblesSel = visiblesIds.length > 0 && visiblesIds.every(id => selectedWorkers.includes(id));
                        return (
                        <>
                            <div className="flex justify-between items-center mb-4" style={{ gap: 'var(--space-2)' }}>
                                <span className="font-bold">Seleccionar Trabajadores</span>
                                <div className="flex items-center gap-2">
                                    {hayScope && (
                                        <button className="btn btn-ghost btn-sm" onClick={() => setVerTodaLaObra(v => !v)}>
                                            {verTodaLaObra ? 'Ver solo su grupo' : 'Ver toda la obra'}
                                        </button>
                                    )}
                                    <button className="btn btn-secondary btn-sm" onClick={selectAllWorkers}>
                                        {todosVisiblesSel ? 'Deseleccionar todos' : 'Seleccionar todos'}
                                    </button>
                                </div>
                            </div>

                            <div className="flex flex-col gap-2" style={{ maxHeight: '300px', overflowY: 'auto' }}>
                                {visiblesAsist.length === 0 && (
                                    <div className="text-sm text-muted">Este relator no tiene trabajadores en su grupo. Usa "Ver toda la obra" para registrar de todos modos.</div>
                                )}
                                {visiblesAsist.map((worker) => {
                                    const isSelected = selectedWorkers.includes(worker.personaId);
                                    const alreadyAttended = selectedActivity.asistentes.some(a => (a as any).personaId === worker.personaId || a.workerId === worker.personaId);
                                    return (
                                        <div
                                            key={worker.personaId}
                                            className={`flex items-center justify-between ${alreadyAttended ? '' : 'cursor-pointer'}`}
                                            style={{
                                                padding: 'var(--space-3)',
                                                background: isSelected ? 'rgba(76, 175, 80, 0.1)' : 'var(--surface-elevated)',
                                                borderRadius: 'var(--radius-md)',
                                                border: isSelected ? '1px solid var(--primary-500)' : '1px solid transparent',
                                                opacity: alreadyAttended ? 0.5 : 1
                                            }}
                                            onClick={() => !alreadyAttended && toggleWorkerSelection(worker.personaId)}
                                        >
                                            <div className="flex items-center gap-3">
                                                <div className="avatar avatar-sm">{worker.nombre.charAt(0)}</div>
                                                <div>
                                                    <div className="font-bold">{worker.nombre} {worker.apellido}</div>
                                                    <div className="text-sm text-muted">{worker.cargo}</div>
                                                </div>
                                            </div>
                                            {alreadyAttended ? (
                                                <span className="badge badge-success">Ya registrado</span>
                                            ) : (
                                                <div style={{ width: '24px', height: '24px', borderRadius: '4px', border: '2px solid var(--surface-border)', background: isSelected ? 'var(--primary-500)' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                                    {isSelected && <FiCheck style={{ color: 'white' }} />}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>

                            {selectedWorkers.length > 0 && (
                                <div className="mt-6">
                                    <div className="alert alert-info">
                                        <strong>{selectedWorkers.length}</strong> trabajador(es) seleccionado(s). Cada uno firmará con <strong>su propio PIN</strong>, uno por uno.
                                    </div>
                                </div>
                            )}
                        </>
                        );
                    })()}
                </Modal>

                {/* Signature Modal — firma asistida SECUENCIAL (PIN por trabajador) */}
                {(() => {
                    const currentWorkerId = selectedWorkers[signingIndex];
                    const currentWorker = workers.find(w => w.personaId === currentWorkerId);
                    const currentNombre = currentWorker ? `${currentWorker.nombre} ${currentWorker.apellido || ''}`.trim() : 'Trabajador';
                    return (
                        <SignatureModal
                            // Remonta el modal (y el PinInput) por cada trabajador para
                            // resetear el PIN al avanzar. Sin esto, el input queda
                            // congelado con el PIN del trabajador anterior.
                            key={`sign-${signingIndex}`}
                            isOpen={showSignatureModal && selectedWorkers.length > 0}
                            onClose={() => { setShowSignatureModal(false); setSigningIndex(0); }}
                            onConfirm={handleSignCurrentWorker}
                            type="activity"
                            title={`Firma de ${currentNombre}`}
                            itemName={`${selectedActivity?.titulo || ''} · Trabajador ${signingIndex + 1} de ${selectedWorkers.length}`}
                            description={`${currentNombre} ingresa su PIN para firmar su asistencia. Cada trabajador firma con su propio PIN.`}
                            error={signatureError}
                            secondaryActionLabel={selectedWorkers.length > 1 ? 'Saltar este trabajador' : undefined}
                            onSecondaryAction={selectedWorkers.length > 1 ? handleSkipCurrentWorker : undefined}
                        />
                    );
                })()}

                {/* Self-Sign Modal for Workers */}
                <SignatureModal
                    isOpen={showSelfSignModal}
                    onClose={() => setShowSelfSignModal(false)}
                    onConfirm={handleSelfSign}
                    type="activity"
                    title="Registrar mi asistencia"
                    itemName={selfSignActivity?.titulo}
                    description="Confirma tu asistencia a esta actividad con tu firma digital."
                    error={signatureError}
                />

                {/* Activity Detail Modal */}
                <Modal
                    isOpen={showDetailModal && !!detailActivity}
                    onClose={() => setShowDetailModal(false)}
                    title="Detalle de la Actividad"
                    subtitle={detailActivity?.titulo}
                    size="lg"
                >
                    {detailActivity && (() => {
                        const typeInfo = ACTIVITY_TYPES[detailActivity.tipo] || {
                            label: detailActivity.tipoDescripcion || detailActivity.tipo,
                            color: 'var(--gray-500)',
                            icon: <FiFileText />,
                        };
                        const requeridos = (detailActivity.asistentesRequeridos || [])
                            .map(id => workers.find(w => w.personaId === id))
                            .filter(Boolean) as Worker[];

                        return (
                            <div className="flex flex-col gap-4">
                                <div className="flex items-center gap-3">
                                    <div className="avatar" style={{ background: typeInfo.color, fontSize: '1.2rem' }}>
                                        {typeInfo.icon}
                                    </div>
                                    <div>
                                        <div className="font-bold">{detailActivity.titulo}</div>
                                        <div className="text-sm text-muted">
                                            {typeInfo.label}
                                            {detailActivity.subtipo && ` · ${detailActivity.subtipoDescripcion || CAPACITACION_SUBTIPOS[detailActivity.subtipo] || detailActivity.subtipo}`}
                                        </div>
                                    </div>
                                </div>

                                <div className="grid grid-cols-2" style={{ gap: 'var(--space-3)' }}>
                                    <div>
                                        <div className="text-xs text-muted">Fecha</div>
                                        <div className="font-bold">{new Date(detailActivity.fecha).toLocaleDateString('es-CL')}</div>
                                    </div>
                                    <div>
                                        <div className="text-xs text-muted">Horario</div>
                                        <div className="font-bold">
                                            {detailActivity.horaInicio}
                                            {detailActivity.horaFin && ` - ${detailActivity.horaFin}`}
                                        </div>
                                    </div>
                                    <div>
                                        <div className="text-xs text-muted">Estado</div>
                                        <span className={`badge badge-${detailActivity.estado === 'completada' ? 'success' :
                                            detailActivity.estado === 'cancelada' ? 'danger' :
                                                detailActivity.estado === 'programada' ? 'neutral' : 'warning'}`}>
                                            {detailActivity.estado}
                                        </span>
                                    </div>
                                    {detailActivity.ubicacion && (
                                        <div>
                                            <div className="text-xs text-muted">Ubicación</div>
                                            <div className="font-bold">{detailActivity.ubicacion}</div>
                                        </div>
                                    )}
                                </div>

                                {detailActivity.descripcion && (
                                    <div>
                                        <div className="text-xs text-muted">Descripción</div>
                                        <div>{detailActivity.descripcion}</div>
                                    </div>
                                )}

                                {requeridos.length > 0 && (
                                    <div>
                                        <div className="text-xs text-muted mb-2">Asistentes requeridos ({requeridos.length})</div>
                                        <div className="flex flex-col gap-2">
                                            {requeridos.map(w => (
                                                <div key={w.personaId} className="flex items-center gap-3">
                                                    <div className="avatar avatar-sm">{w.nombre.charAt(0)}</div>
                                                    <div>
                                                        <div className="font-bold">{w.nombre} {w.apellido}</div>
                                                        <div className="text-sm text-muted">{w.cargo}</div>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                <ReporteActividad
                                    activity={detailActivity}
                                    workers={workers}
                                    catalogos={catalogos}
                                    permisosDef={permisosDef}
                                />

                                {detailActivity.planificacion?.observaciones && (
                                    <div>
                                        <div className="text-xs text-muted">
                                            {detailActivity.tipo === 'REUNION_COMITE' ? 'Participación y consulta' : 'Observaciones'}
                                        </div>
                                        <div style={{ whiteSpace: 'pre-wrap' }}>{detailActivity.planificacion.observaciones}</div>
                                    </div>
                                )}
                                {(detailActivity.permisosTrabajo || []).length > 0 && (
                                    <div>
                                        <div className="text-xs text-muted mb-2">Permisos de trabajo</div>
                                        <div className="flex gap-2" style={{ flexWrap: 'wrap' }}>
                                            {detailActivity.permisosTrabajo!.map((pt) => (
                                                <span key={pt.tipo} className={`badge ${pt.completo ? 'badge-success' : 'badge-warning'}`}>
                                                    {permisosDef[pt.tipo]?.label || pt.tipo} {pt.completo ? '· completo' : '· incompleto'}
                                                </span>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {(canManage || detailActivity.relatorId === user?.personaId) && (
                                    <div className="flex justify-end">
                                        <button className="btn btn-secondary btn-sm" onClick={() => {
                                            setEditActivity(detailActivity);
                                            setEditDraft({
                                                planificacion: detailActivity.planificacion || { observaciones: '' },
                                                permisosTrabajo: detailActivity.permisosTrabajo || [],
                                            });
                                            setShowDetailModal(false);
                                            setShowEditModal(true);
                                        }}>
                                            Completar registro
                                        </button>
                                    </div>
                                )}
                            </div>
                        );
                    })()}
                </Modal>

                {/* Completar registro Modal — edición acotada de planificación + permisos de trabajo (PATCH) */}
                <Modal
                    isOpen={showEditModal && !!editActivity}
                    onClose={() => !editSaving && setShowEditModal(false)}
                    title="Completar registro"
                    subtitle={editActivity?.titulo}
                    footer={
                        <>
                            <button className="btn btn-secondary" disabled={editSaving} onClick={() => setShowEditModal(false)}>Cancelar</button>
                            <button className="btn btn-primary" disabled={editSaving} onClick={handleSaveRegistro}>
                                {editSaving ? 'Guardando…' : 'Guardar registro'}
                            </button>
                        </>
                    }
                >
                    {editActivity && catalogos && (
                        <>
                            <PlanificacionDiariaForm
                                value={editDraft.planificacion}
                                onChange={(planificacion) => setEditDraft({ ...editDraft, planificacion })}
                                catalogos={catalogos}
                                tipoActividad={editActivity.tipo}
                            />
                            {['CHARLA_5MIN', 'ART'].includes(editActivity.tipo) && (
                                <PermisosTrabajoForm
                                    value={editDraft.permisosTrabajo}
                                    onChange={(permisosTrabajo) => setEditDraft({ ...editDraft, permisosTrabajo })}
                                    permisosDef={permisosDef}
                                    workers={workers}
                                />
                            )}
                        </>
                    )}
                </Modal>
            </div>
        </>
    );
}
