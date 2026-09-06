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
    FiList,
    FiEdit3,
    FiTrash2,
    FiGrid,
    FiChevronDown,
    FiUserX,
    FiX,
    FiEye,
    FiDownload,
} from 'react-icons/fi';
import {
    activitiesApi,
    workersApi,
    tenantsApi,
    ausenciasApi,
    type Ausencia,
    type Activity,
    type Worker,
    type CatalogosActividad,
    type PermisosTrabajoDef,
    type PlanificacionActividad,
    type PermisoTrabajo,
    type PlanItem,
} from '../api/client';
import SignatureModal from '../components/SignatureModal';
import { estadoSeguimiento, hoyISO } from '../utils/seguimientoActividad';
import { construirFilasAsistencia, labelDe, listaSeleccion, CLIMA_LABEL } from '../utils/reporteActividad';
import { construirReporteActividadPdf, nombreArchivoReporte } from '../utils/reporteActividadPdf';
import PlanificacionDiariaForm from '../components/actividades/PlanificacionDiariaForm';
import PermisosTrabajoForm from '../components/actividades/PermisosTrabajoForm';
import ReporteActividad from '../components/actividades/ReporteActividad';
import WorkerPicker from '../components/actividades/WorkerPicker';
import DocumentPreviewModal from '../components/DocumentPreviewModal';
import ActivityCalendar from '../components/ActivityCalendar';
import { Modal, Select, PageHeader, SegmentedControl } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { useObraContext } from '../context/ObraContext';
import { PERMISSIONS } from '../permissions';
import { useToast } from '../context/ToastContext';
import { useOfflineSignature } from '../hooks/useOfflineSignature';
import { useLocation } from 'react-router-dom';

// Semáforo de seguimiento → clase de badge existente.
const NIVEL_BADGE: Record<string, string> = { verde: 'success', amarillo: 'warning', rojo: 'danger', neutral: 'neutral' };

const ACTIVITY_TYPES: Record<string, { label: string; color: string; icon: React.ReactElement }> = {
    CHARLA_5MIN: { label: 'Charla 5 Minutos', color: 'var(--primary-500)', icon: <FiMessageSquare /> },
    ART: { label: 'Análisis de Riesgos', color: 'var(--warning-500)', icon: <FiAlertTriangle /> },
    CAPACITACION: { label: 'Capacitación', color: 'var(--info-500)', icon: <FiBook /> },
    INDUCCION: { label: 'Inducción', color: 'var(--success-500)', icon: <FiAward /> },
    INSPECCION: { label: 'Inspección', color: 'var(--accent-500)', icon: <FiSearch /> },
    REUNION_COMITE: { label: 'Reunión Comité Paritario', color: 'var(--secondary-500, #7c3aed)', icon: <FiUsers /> },
    SIMULACRO: { label: 'Simulacro de Emergencia', color: 'var(--danger-500, #dc2626)', icon: <FiAlertTriangle /> },
    // Casos no contemplados en el catálogo: el detalle va en el título/descripción.
    OTRO: { label: 'Otra actividad', color: 'var(--gray-500)', icon: <FiFileText /> },
};

// Etapas constructivas de la obra: dimensión "tipo de trabajo" de la planificación
// (misma nomenclatura que Obra.etapaConstructivaActual en el backend).
const TIPOS_TRABAJO: Record<string, string> = {
    excavacion: 'Excavación',
    obra_gruesa: 'Obra gruesa',
    terminaciones: 'Terminaciones',
    entrega: 'Entrega',
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

// Ítem del formulario del planificador (esqueleto mensual).
interface PlanItemForm {
    tipo: string;
    periodicidad: 'diaria' | 'semanal' | 'mensual';
    tipoTrabajo: string;
    responsables: string[];
    tituloBase: string;
    horaInicio: string;
    ubicacion: string;
}

const emptyPlanItem: PlanItemForm = {
    tipo: 'CHARLA_5MIN',
    periodicidad: 'diaria',
    tipoTrabajo: '',
    responsables: [],
    tituloBase: '',
    horaInicio: '09:00',
    ubicacion: '',
};

export default function Activities() {
    const { user, hasPermission } = useAuth();
    const canCrearActividad = hasPermission(PERMISSIONS.ACTIVIDADES_CREAR);
    const canPlanificar = hasPermission(PERMISSIONS.ACTIVIDADES_PLANIFICAR);
    const { isOnline, pendingCount, signActivity, syncPendingSignatures } = useOfflineSignature();
    const { toast } = useToast();
    const { selectedObraId } = useObraContext();
    const [activities, setActivities] = useState<Activity[]>([]);
    const [workers, setWorkers] = useState<Worker[]>([]);
    const [loading, setLoading] = useState(true);
    const [showModal, setShowModal] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [showAttendanceModal, setShowAttendanceModal] = useState(false);
    const [selectedActivity, setSelectedActivity] = useState<Activity | null>(null);
    const [showDetailModal, setShowDetailModal] = useState(false);
    const [detailActivity, setDetailActivity] = useState<Activity | null>(null);
    const [cerrando, setCerrando] = useState(false);
    // Ausencias/permisos del día (control de asistencia §6).
    const [ausencias, setAusencias] = useState<Ausencia[]>([]);
    const [ausenciaMenu, setAusenciaMenu] = useState<string | null>(null);
    const [ausenciaSaving, setAusenciaSaving] = useState(false);
    const [selectedWorkers, setSelectedWorkers] = useState<string[]>([]);
    // Filtrado de asistentes por relator: por defecto la charla muestra solo el
    // grupo del relator (su cuadrilla / las cuadrillas de sus supervisores). El
    // toggle permite expandir a toda la obra por si algún vínculo no está cargado.
    const [verTodaLaObra, setVerTodaLaObra] = useState(false);
    const [newAttendeeSearch, setNewAttendeeSearch] = useState('');
    const [attendanceSearch, setAttendanceSearch] = useState('');
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
    // Vista: lista clásica o calendario mensual.
    const [viewMode, setViewMode] = useState<'lista' | 'calendario'>('lista');
    const [calendarMonth, setCalendarMonth] = useState(new Date());
    // Planificador (esqueleto mensual): rango + ítems por tipo/periodicidad/responsables.
    const [showPlanModal, setShowPlanModal] = useState(false);
    const [planSubmitting, setPlanSubmitting] = useState(false);
    const [planRango, setPlanRango] = useState({ desde: '', hasta: '' });
    const [planItems, setPlanItems] = useState<PlanItemForm[]>([{ ...emptyPlanItem }]);
    // Buscador del selector de responsables, por ítem del plan.
    const [planSearch, setPlanSearch] = useState<Record<number, string>>({});
    // Detalle de un día del calendario (todas sus actividades + pendientes).
    const [dayModalFecha, setDayModalFecha] = useState<string | null>(null);
    // Pendientes de firmar de UNA actividad de hoy (se abre desde su tarjeta).
    const [pendientesActivityId, setPendientesActivityId] = useState<string | null>(null);
    // Historial: filtros propios (el buscador de arriba solo alcanza a hoy y al calendario).
    const [histSearch, setHistSearch] = useState('');
    const [histDesde, setHistDesde] = useState('');
    const [histHasta, setHistHasta] = useState('');
    const [histVisibles, setHistVisibles] = useState(10);
    // Vista previa del acta en PDF, dentro de la página (sin abrir pestañas).
    const [reportePreview, setReportePreview] = useState<{ url: string; activity: Activity } | null>(null);
    // Completar borrador (rellenar el detalle del día → programada).
    const [showCompleteModal, setShowCompleteModal] = useState(false);
    const [completeActivity, setCompleteActivity] = useState<Activity | null>(null);
    const [completeForm, setCompleteForm] = useState({ titulo: '', descripcion: '', relatorId: '', horaInicio: '', horaFin: '', ubicacion: '', asistentesRequeridos: [] as string[] });
    const [completeSubmitting, setCompleteSubmitting] = useState(false);
    const [completeAttendeeSearch, setCompleteAttendeeSearch] = useState('');

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
        fecha: hoyISO(),
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

    // Día de hoy en fecha LOCAL (no UTC: con toISOString, desde las ~20:00 en Chile
    // el día ya salta al siguiente y las charlas del día dejan de ser firmables).
    // Se declara acá arriba a propósito: loadData() lo usa y el efecto de montaje la
    // invoca desde un render que corta antes en `if (loading) return <spinner/>`.
    const today = hoyISO();

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
            const [activitiesRes, workersRes, ausenciasRes] = await Promise.all([
                activitiesApi.list({ obraId: selectedObraId }),
                workersApi.list({ obraId: selectedObraId }),
                user?.tenantId
                    ? ausenciasApi.list({ tenantId: user.tenantId, obraId: selectedObraId, fecha: today })
                    : Promise.resolve(null),
            ]);

            if (activitiesRes.success && activitiesRes.data) {
                // Aislamiento por obra: aunque el backend devuelva de más (registros
                // legacy sin obraId), solo mostramos los de la obra activa.
                setActivities(activitiesRes.data.activities.filter(a => a.obraId === selectedObraId));
            }
            if (workersRes.success && workersRes.data) {
                setWorkers(workersRes.data);
            }
            if (ausenciasRes && ausenciasRes.success && ausenciasRes.data) {
                setAusencias(ausenciasRes.data.ausencias);
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

    // ── Planificador (esqueleto mensual) ─────────────────────────────────────

    const openPlanModal = () => {
        // Rango por defecto: el mes visible del calendario completo.
        const base = viewMode === 'calendario' ? calendarMonth : new Date();
        const desde = new Date(base.getFullYear(), base.getMonth(), 1);
        const hasta = new Date(base.getFullYear(), base.getMonth() + 1, 0);
        const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        setPlanRango({ desde: iso(desde), hasta: iso(hasta) });
        setPlanItems([{ ...emptyPlanItem }]);
        setShowPlanModal(true);
    };

    const updatePlanItem = (index: number, patch: Partial<PlanItemForm>) =>
        setPlanItems(prev => prev.map((it, i) => (i === index ? { ...it, ...patch } : it)));

    const togglePlanResponsable = (index: number, personaId: string) =>
        setPlanItems(prev => prev.map((it, i) => {
            if (i !== index) return it;
            const responsables = it.responsables.includes(personaId)
                ? it.responsables.filter(id => id !== personaId)
                : [...it.responsables, personaId];
            return { ...it, responsables };
        }));

    const handleGeneratePlan = async (e: React.FormEvent) => {
        e.preventDefault();
        if (planSubmitting || !selectedObraId || !user?.personaId) return;
        if (!planRango.desde || !planRango.hasta || planRango.hasta < planRango.desde) {
            toast.error('Indica un rango de fechas válido');
            return;
        }
        const sinResponsables = planItems.findIndex(it => it.responsables.length === 0);
        if (sinResponsables >= 0) {
            toast.error(`El ítem ${sinResponsables + 1} no tiene responsables asignados`);
            return;
        }

        setPlanSubmitting(true);
        try {
            const items: PlanItem[] = planItems.map(it => ({
                tipo: it.tipo,
                periodicidad: it.periodicidad,
                tipoTrabajo: it.tipoTrabajo || undefined,
                responsables: it.responsables,
                tituloBase: it.tituloBase || undefined,
                camposPrellenados: {
                    horaInicio: it.horaInicio || undefined,
                    ubicacion: it.ubicacion || undefined,
                },
            }));
            const response = await activitiesApi.plan({
                obraId: selectedObraId,
                rangoDesde: planRango.desde,
                rangoHasta: planRango.hasta,
                solicitanteId: user.personaId,
                items,
            });
            if (response.success && response.data) {
                await loadData();
                const { count, omitidas } = response.data;
                toast.success(`${count} actividad(es) planificada(s)${omitidas > 0 ? ` · ${omitidas} ya existían` : ''}`);
                setShowPlanModal(false);
                setViewMode('calendario');
            } else {
                toast.error(response.error || 'Error al generar la planificación');
            }
        } catch (error) {
            console.error('Error generating plan:', error);
            toast.error('Error al generar la planificación');
        } finally {
            setPlanSubmitting(false);
        }
    };

    // ── Completar borrador (rellenar el detalle del día) ─────────────────────

    // Puede completar: un responsable del borrador, o quien puede crear actividades.
    const puedeCompletar = (a: Activity) =>
        a.estado === 'borrador' && (
            canCrearActividad ||
            a.relatorId === user?.personaId ||
            (a.responsables || []).includes(user?.personaId || '')
        );

    const openCompleteModal = (a: Activity) => {
        setCompleteActivity(a);
        setCompleteForm({
            titulo: a.titulo || '',
            descripcion: a.descripcion || '',
            relatorId: a.relatorId || '',
            horaInicio: (a.horaInicio || '09:00').slice(0, 5),
            horaFin: a.horaFin || '',
            ubicacion: a.ubicacion || '',
            asistentesRequeridos: a.asistentesRequeridos || [],
        });
        setCompleteAttendeeSearch('');
        setShowCompleteModal(true);
    };

    const toggleCompleteAttendee = (personaId: string) =>
        setCompleteForm(prev => ({
            ...prev,
            asistentesRequeridos: prev.asistentesRequeridos.includes(personaId)
                ? prev.asistentesRequeridos.filter(id => id !== personaId)
                : [...prev.asistentesRequeridos, personaId],
        }));

    const handleCompleteBorrador = async (e: React.FormEvent) => {
        e.preventDefault();
        if (completeSubmitting || !completeActivity || !user?.personaId) return;
        if (!completeForm.relatorId) {
            toast.error('Selecciona quién dictará la actividad (relator)');
            return;
        }
        setCompleteSubmitting(true);
        try {
            const response = await activitiesApi.patch(completeActivity.activityId, {
                solicitanteId: user.personaId,
                titulo: completeForm.titulo,
                descripcion: completeForm.descripcion,
                relatorId: completeForm.relatorId,
                horaInicio: completeForm.horaInicio,
                horaFin: completeForm.horaFin || undefined,
                ubicacion: completeForm.ubicacion,
                asistentesRequeridos: completeForm.asistentesRequeridos,
                estado: 'programada',
            });
            if (response.success) {
                await loadData();
                toast.success('Actividad completada y programada');
                setShowCompleteModal(false);
                setCompleteActivity(null);
            } else {
                toast.error(response.error || 'Error al completar la actividad');
            }
        } catch (error) {
            console.error('Error completing draft:', error);
            toast.error('Error al completar la actividad');
        } finally {
            setCompleteSubmitting(false);
        }
    };

    // Limpia la búsqueda de asistentes cada vez que se abre "Nueva actividad".
    useEffect(() => {
        if (showModal) setNewAttendeeSearch('');
    }, [showModal]);

    // Limpia la búsqueda de asistentes cada vez que se abre "Registrar Asistencia".
    useEffect(() => {
        if (showAttendanceModal) setAttendanceSearch('');
    }, [showAttendanceModal]);

    // Click en un día del calendario: abre el panel con las actividades de ese día.
    const handleCalendarDayClick = (fechaISO: string) => setDayModalFecha(fechaISO);

    // Crear ad-hoc con la fecha del día pre-cargada (desde el panel del día).
    const crearEnFecha = (fechaISO: string) => {
        setDayModalFecha(null);
        setNewActivity({ ...emptyActivity, fecha: fechaISO });
        setShowModal(true);
    };

    // Click en un chip del calendario: borrador propio → completar; resto → detalle.
    const handleCalendarActivityClick = (a: Activity) => {
        if (puedeCompletar(a)) openCompleteModal(a);
        else openDetailModal(a);
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
        if (!editActivity || editSaving || !user?.personaId) return;
        setEditSaving(true);
        try {
            const res = await activitiesApi.patch(editActivity.activityId, {
                ...editDraft,
                solicitanteId: user.personaId,
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

    // Cierre EXPLÍCITO de la actividad. El backend exige al menos una firma y un
    // registro con contenido; una actividad cerrada sigue admitiendo firmas de
    // rezagados durante el día (no se bloquea la firma, solo se "cierra" el acta).
    const handleCerrarActividad = async (activity: Activity) => {
        if (!user?.personaId || cerrando) return;
        setCerrando(true);
        try {
            const res = await activitiesApi.patch(activity.activityId, {
                solicitanteId: user.personaId,
                estado: 'completada',
            });
            if (res.success && res.data) {
                setActivities((prev) => prev.map((a) => a.activityId === res.data!.activityId ? res.data! : a));
                setDetailActivity(res.data);
                toast.success('Actividad cerrada');
            } else {
                toast.error(res.error || 'No se pudo cerrar la actividad');
            }
        } finally {
            setCerrando(false);
        }
    };

    // Motivos de ausencia disponibles en el selector rápido (espejo del backend).
    const MOTIVOS_AUSENCIA: { code: string; label: string }[] = [
        { code: 'permiso', label: 'Permiso' },
        { code: 'licencia', label: 'Licencia médica' },
        { code: 'falta', label: 'Falta' },
        { code: 'vacaciones', label: 'Vacaciones' },
        { code: 'otro', label: 'Otro' },
    ];

    const marcarAusente = async (personaId: string, motivo: string) => {
        if (!user?.tenantId || !selectedObraId || ausenciaSaving) return;
        setAusenciaSaving(true);
        try {
            const res = await ausenciasApi.create({
                tenantId: user.tenantId, obraId: selectedObraId, fecha: today,
                personaId, motivo, solicitanteId: user.personaId,
            });
            if (res.success && res.data) {
                setAusencias((prev) => [
                    ...prev.filter((a) => !(a.personaId === personaId && a.fecha === today && a.obraId === selectedObraId)),
                    res.data!,
                ]);
                setAusenciaMenu(null);
                toast.success('Marcado como ausente');
            } else {
                toast.error(res.error || 'No se pudo registrar la ausencia');
            }
        } finally {
            setAusenciaSaving(false);
        }
    };

    const quitarAusente = async (personaId: string) => {
        if (!user?.tenantId || !selectedObraId || ausenciaSaving) return;
        setAusenciaSaving(true);
        try {
            const res = await ausenciasApi.remove({ tenantId: user.tenantId, obraId: selectedObraId, fecha: today, personaId });
            if (res.success) {
                setAusencias((prev) => prev.filter((a) => !(a.personaId === personaId && a.fecha === today && a.obraId === selectedObraId)));
                toast.success('Ausencia quitada');
            } else {
                toast.error(res.error || 'No se pudo quitar la ausencia');
            }
        } finally {
            setAusenciaSaving(false);
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

    // Los citados a una actividad, en el orden en que fueron convocados.
    const citadosDe = (a: Activity): Worker[] =>
        (a.asistentesRequeridos || [])
            .map((id) => workers.find((w) => w.personaId === id))
            .filter((w): w is Worker => !!w);

    // Lista que se está mostrando en el modal de asistencia: los citados, salvo
    // que no haya ninguno o se haya expandido a toda la obra.
    const listaAsistenciaVisible = (a: Activity | null): Worker[] => {
        if (!a) return [];
        const citados = citadosDe(a);
        if (citados.length > 0 && !verTodaLaObra) return citados;
        return visibleWorkersFor(a.relatorId).list;
    };

    const selectAllWorkers = () => {
        // Debe operar sobre lo que se ve: si no, seleccionaría gente oculta.
        const visible = listaAsistenciaVisible(selectedActivity);
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

    const matchesFilters = (a: Activity) => {
        const matchesSearch = searchTerm.trim() === '' ||
            a.titulo.toLowerCase().includes(searchTerm.toLowerCase()) ||
            (a.descripcion && a.descripcion.toLowerCase().includes(searchTerm.toLowerCase()));
        const matchesType = filterType === '' || a.tipo === filterType;
        return matchesSearch && matchesType;
    };

    // Los borradores (planificados sin completar) no se mezclan con las listas
    // operativas: viven en el calendario y en su propia sección de pendientes.
    const noBorrador = (a: Activity) => a.estado !== 'borrador';
    const todayActivities = activities.filter(a => a.fecha === today && noBorrador(a) && matchesFilters(a));
    // "Historial" = solo actividades que YA pasaron (fecha anterior a hoy). Las de hoy
    // van en su propia sección y las futuras son recordatorios (no historial).
    // Filtra con sus propios controles (texto + rango de fechas), no con los de arriba:
    // buscar en el historial es una tarea distinta de mirar el día en curso.
    const historialBase = activities.filter(a => a.fecha < today && noBorrador(a));
    const filteredActivities = historialBase
        .filter((a) => {
            const q = histSearch.trim().toLowerCase();
            const coincideTexto = !q
                || a.titulo.toLowerCase().includes(q)
                || (a.descripcion || '').toLowerCase().includes(q)
                || (ACTIVITY_TYPES[a.tipo]?.label || a.tipo).toLowerCase().includes(q);
            const desdeOk = !histDesde || a.fecha >= histDesde;
            const hastaOk = !histHasta || a.fecha <= histHasta;
            return coincideTexto && desdeOk && hastaOk;
        })
        .sort((x, y) => y.fecha.localeCompare(x.fecha) || (y.horaInicio || '').localeCompare(x.horaInicio || ''));
    const histFiltrado = !!(histSearch.trim() || histDesde || histHasta);

    // Atajos de rango: fija desde/hasta a los últimos N días terminando hoy.
    const aplicarRangoDias = (dias: number) => {
        const hasta = new Date();
        const desde = new Date();
        desde.setDate(desde.getDate() - dias);
        setHistDesde(desde.toISOString().slice(0, 10));
        setHistHasta(hasta.toISOString().slice(0, 10));
        setHistVisibles(10);
    };
    const limpiarFiltrosHistorial = () => {
        setHistSearch(''); setHistDesde(''); setHistHasta(''); setHistVisibles(10);
    };
    const upcomingActivities = activities.filter(a => a.fecha > today && noBorrador(a) && matchesFilters(a));
    // Borradores pendientes de completar (propios primero, próximos primero).
    const borradores = activities
        .filter(a => a.estado === 'borrador' && a.fecha >= today && matchesFilters(a))
        .sort((x, y) => x.fecha.localeCompare(y.fecha));
    const misBorradores = borradores.filter(puedeCompletar);

    // Una actividad solo es FIRMABLE cuando ya empezó (fecha+hora de inicio <= ahora).
    // Antes de eso es un recordatorio de asistencia, no se puede firmar todavía.
    const haComenzado = (a: Activity): boolean => {
        if (a.fecha < today) return true;
        if (a.fecha > today) return false;
        const inicio = (a.horaInicio || '00:00').slice(0, 5);
        const ahora = new Date().toTimeString().slice(0, 5);
        return ahora >= inicio;
    };

    // Se puede firmar durante TODO el día de la actividad (con fecha, sin hora
    // límite de cierre): una actividad ya cerrada (completada) sigue admitiendo
    // firmas de rezagados mientras sea su día. Solo se excluye cancelada/borrador
    // y el tramo previo a la hora de inicio.
    const esFirmable = (a: Activity): boolean =>
        a.fecha === today && a.estado !== 'cancelada' && a.estado !== 'borrador' && haComenzado(a);

    // Ausentes/permisos de hoy, indexados por personaId (para excluirlos del rojo).
    const ausentesHoyMap = new Map(ausencias.filter((a) => a.fecha === today).map((a) => [a.personaId, a]));

    // Firmas de una actividad (§6, ítems 3, 4 y 5): cruce convocados × firmados.
    // Los marcados ausentes NO cuentan como pendientes; se listan aparte y salen
    // del denominador, porque ya están justificados.
    const firmasDe = (a: Activity) => {
        const filas = construirFilasAsistencia(a, workers).filas;
        const convocados = filas.filter((f) => f.convocado);
        const convocadosSinFirmar = convocados.filter((f) => !f.asistio);
        const pendientes = convocadosSinFirmar.filter((f) => !ausentesHoyMap.has(f.personaId));
        const ausentes = convocadosSinFirmar
            .filter((f) => ausentesHoyMap.has(f.personaId))
            .map((f) => ({ fila: f, ausencia: ausentesHoyMap.get(f.personaId)! }));
        const firmados = convocados.filter((f) => f.asistio).length;
        const esperados = convocados.length - ausentes.length;
        return { pendientes, ausentes, firmados, esperados, totalFirmas: filas.filter((f) => f.asistio).length };
    };

    // Acta en PDF: se arma en el navegador con los datos ya cargados.
    const generarReporte = (a: Activity) =>
        construirReporteActividadPdf(a, construirFilasAsistencia(a, workers), catalogos, permisosDef);

    const verReporte = (a: Activity) => {
        try {
            const url = generarReporte(a).output('bloburl') as unknown as string;
            // Libera el blob de la vista previa anterior antes de reemplazarla.
            if (reportePreview) URL.revokeObjectURL(reportePreview.url);
            setReportePreview({ url, activity: a });
        } catch (err) {
            console.error('Error generando el reporte:', err);
            toast.error('No se pudo generar el reporte de esta actividad.');
        }
    };

    const descargarReporte = (a: Activity) => {
        try {
            generarReporte(a).save(nombreArchivoReporte(a));
        } catch (err) {
            console.error('Error generando el reporte:', err);
            toast.error('No se pudo generar el reporte de esta actividad.');
        }
    };

    const cerrarReporte = () => {
        if (reportePreview) URL.revokeObjectURL(reportePreview.url);
        setReportePreview(null);
    };

    const pendientesActivity = pendientesActivityId
        ? todayActivities.find((a) => a.activityId === pendientesActivityId) || null
        : null;

    return (
        <>



            <div className="page-content">
                <PageHeader
                    banner
                    title="Actividades y capacitación"
                    description="Charlas de 5 minutos, inducciones, ART y capacitación técnica, con asistencia y firma de los participantes."
                    actions={
                        (canCrearActividad || canPlanificar) ? (
                            <div className="flex items-center gap-2">
                                {canPlanificar && (
                                    <button
                                        className="btn btn-secondary"
                                        disabled={!selectedObraId}
                                        title={!selectedObraId ? 'Selecciona una obra para planificar el mes' : 'Armar el esqueleto de actividades del mes'}
                                        onClick={openPlanModal}
                                    >
                                        <FiCalendar /> Planificar mes
                                    </button>
                                )}
                                {canCrearActividad && (
                                    <button
                                        className="btn btn-primary"
                                        disabled={!selectedObraId}
                                        title={!selectedObraId ? 'Selecciona una obra en la barra superior para crear una actividad' : undefined}
                                        onClick={() => { setVerTodaLaObra(false); setShowModal(true); }}
                                    >
                                        <FiPlus /> Nueva actividad
                                    </button>
                                )}
                            </div>
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

                {/* Toolbar: búsqueda + filtro. Alcanza al día en curso, lo próximo
                    y el calendario; el historial trae sus propios controles. */}
                <div className="tbar act-toolbar">
                    {/* Buscador y filtro son un solo control: se consultan juntos */}
                    <div className="act-filterbar">
                        <div className="act-filterbar-search">
                            <FiSearch size={15} aria-hidden="true" />
                            <input
                                type="search"
                                placeholder="Buscar en hoy y en el calendario…"
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                            />
                        </div>
                        <span className="act-filterbar-divider" aria-hidden="true" />
                        <div className="act-filterbar-select">
                            <Select
                                ariaLabel="Filtrar por tipo de actividad"
                                value={filterType}
                                onChange={setFilterType}
                                options={[
                                    { value: '', label: 'Todos los tipos de actividad' },
                                    ...Object.entries(ACTIVITY_TYPES).map(([key, { label }]) => ({ value: key, label })),
                                ]}
                            />
                        </div>
                    </div>
                    <SegmentedControl
                        ariaLabel="Modo de vista"
                        fullWidth={false}
                        value={viewMode}
                        onChange={(v) => setViewMode(v as 'lista' | 'calendario')}
                        options={[
                            { value: 'lista', label: 'Lista', icon: <FiList size={14} /> },
                            { value: 'calendario', label: 'Calendario', icon: <FiGrid size={14} /> },
                        ]}
                    />
                </div>

                {/* Vista CALENDARIO: coordinación visual del mes */}
                {viewMode === 'calendario' && (
                    <div className="mb-6">
                        <ActivityCalendar
                            month={calendarMonth}
                            activities={activities.filter(matchesFilters)}
                            typeColors={ACTIVITY_TYPES}
                            onMonthChange={setCalendarMonth}
                            onActivityClick={handleCalendarActivityClick}
                            onDayClick={handleCalendarDayClick}
                        />
                    </div>
                )}

                {/* Borradores por completar (planificación pendiente del usuario) */}
                {misBorradores.length > 0 && (
                    <section className="card act-card act-card-todo mb-6">
                        <header className="act-card-head">
                            <div>
                                <h2 className="act-card-title">Del plan, por completar</h2>
                                <p className="act-card-sub">
                                    Estas actividades están agendadas pero les falta el detalle del día.
                                </p>
                            </div>
                            <span className="act-card-count">{misBorradores.length}</span>
                        </header>
                        <ul className="act-todo-list">
                            {misBorradores.slice(0, 5).map((a) => {
                                const typeInfo = ACTIVITY_TYPES[a.tipo] || { label: a.tipo, color: 'var(--gray-500)', icon: <FiFileText /> };
                                return (
                                    <li key={a.activityId} className="act-todo-row">
                                        <span className="act-row-type" style={{ background: typeInfo.color }} aria-hidden="true">
                                            {typeInfo.icon}
                                        </span>
                                        <div className="act-row-main">
                                            <h3 className="act-row-title">{a.titulo}</h3>
                                            <p className="act-row-meta">
                                                {new Date(`${a.fecha}T00:00:00`).toLocaleDateString('es-CL', { weekday: 'long', day: 'numeric', month: 'long' })}
                                                {a.tipoTrabajo && TIPOS_TRABAJO[a.tipoTrabajo] && ` · ${TIPOS_TRABAJO[a.tipoTrabajo]}`}
                                            </p>
                                        </div>
                                        <button className="btn btn-primary btn-sm" onClick={() => openCompleteModal(a)}>
                                            <FiEdit3 size={14} /> Completar
                                        </button>
                                    </li>
                                );
                            })}
                            {misBorradores.length > 5 && (
                                <li className="act-todo-more">
                                    {misBorradores.length - 5} más, en el calendario
                                </li>
                            )}
                        </ul>
                    </section>
                )}

                {/* Vista LISTA */}
                {viewMode === 'lista' && <>

                {/* Actividades de hoy — la superficie de trabajo del día */}
                <section className="card act-card mb-6">
                    <header className="act-card-head">
                        <div>
                            <h2 className="act-card-title">Hoy</h2>
                            <p className="act-card-sub">
                                {new Date().toLocaleDateString('es-CL', { weekday: 'long', day: 'numeric', month: 'long' })}
                                {upcomingActivities.length > 0 && ` · ${upcomingActivities.length} programada${upcomingActivities.length === 1 ? '' : 's'} más adelante`}
                            </p>
                        </div>
                    </header>

                    {todayActivities.length === 0 ? (
                        <div className="act-empty">
                            <span className="act-empty-icon"><FiCalendar size={22} /></span>
                            <h3 className="act-empty-title">
                                {activities.length === 0 ? 'Aún no hay actividades en esta obra' : 'Nada agendado para hoy'}
                            </h3>
                            <p className="act-empty-text">
                                {canCrearActividad
                                    ? 'Parte por la charla de 5 minutos: queda registrada con la firma de cada asistente.'
                                    : 'Cuando el prevencionista agende una actividad, la verás acá para firmar tu asistencia.'}
                            </p>
                            {canCrearActividad && (
                                <div className="act-empty-actions">
                                    <button className="btn btn-primary" onClick={() => { setVerTodaLaObra(false); setShowModal(true); }}>
                                        <FiPlus /> Crear actividad
                                    </button>
                                    {canPlanificar && (
                                        <button className="btn btn-ghost" onClick={openPlanModal}>
                                            <FiCalendar /> Planificar el mes
                                        </button>
                                    )}
                                </div>
                            )}
                        </div>
                    ) : (
                        <ul className="act-today-list">
                            {todayActivities.map((activity) => {
                                const typeInfo = ACTIVITY_TYPES[activity.tipo] || {
                                    label: activity.tipo, color: 'var(--gray-500)', icon: <FiFileText />,
                                };
                                const seg = estadoSeguimiento(activity);
                                const firmas = firmasDe(activity);
                                const tieneConvocados = firmas.esperados > 0;
                                const completo = tieneConvocados && firmas.pendientes.length === 0;
                                const pct = tieneConvocados ? Math.round((firmas.firmados / firmas.esperados) * 100) : 0;
                                const yaFirme = activity.asistentes.some(
                                    (a) => a.workerId === user?.personaId || (a as any).personaId === user?.personaId,
                                );

                                return (
                                    <li key={activity.activityId}>
                                        <article
                                            className="act-row"
                                            role="button"
                                            tabIndex={0}
                                            aria-label={`Ver detalle de ${activity.titulo}`}
                                            onClick={() => openDetailModal(activity)}
                                            onKeyDown={(e) => {
                                                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetailModal(activity); }
                                            }}
                                        >
                                            <span className="act-row-hora">
                                                <b>{(activity.horaInicio || '').slice(0, 5)}</b>
                                                {activity.horaFin && <i>{activity.horaFin.slice(0, 5)}</i>}
                                            </span>

                                            <div className="act-row-main">
                                                <h3 className="act-row-title">{activity.titulo}</h3>
                                                <p className="act-row-meta">
                                                    {typeInfo.label}
                                                    {activity.subtipo && ` · ${activity.subtipoDescripcion || CAPACITACION_SUBTIPOS[activity.subtipo] || activity.subtipo}`}
                                                    {activity.ubicacion && ` · ${activity.ubicacion}`}
                                                </p>
                                            </div>

                                            {/* Medidor de firmas: el estado real de la actividad de un vistazo */}
                                            <div className={`act-firmas${completo ? ' done' : ''}`}>
                                                {tieneConvocados ? (
                                                    <>
                                                        <span className="act-firmas-num">
                                                            <b>{firmas.firmados}</b>/{firmas.esperados}
                                                        </span>
                                                        <span className="act-firmas-bar" role="img"
                                                            aria-label={`${firmas.firmados} de ${firmas.esperados} convocados han firmado`}>
                                                            <i style={{ width: `${pct}%` }} />
                                                        </span>
                                                        <span className="act-firmas-label">
                                                            {completo ? 'Todos firmaron' : `${firmas.pendientes.length} sin firmar`}
                                                            {firmas.ausentes.length > 0 && ` · ${firmas.ausentes.length} ausente${firmas.ausentes.length === 1 ? '' : 's'}`}
                                                        </span>
                                                    </>
                                                ) : (
                                                    <span className="act-firmas-label">
                                                        <FiUsers size={12} /> {firmas.totalFirmas} firma{firmas.totalFirmas === 1 ? '' : 's'} · sin convocados
                                                    </span>
                                                )}
                                            </div>

                                            <span className={`badge badge-${NIVEL_BADGE[seg.nivel]}`}>{seg.label}</span>

                                            <div className="act-row-actions" onClick={(e) => e.stopPropagation()}>
                                                {canManage && (firmas.pendientes.length > 0 || firmas.ausentes.length > 0) && (
                                                    <button
                                                        className="btn btn-secondary btn-sm"
                                                        onClick={() => setPendientesActivityId(activity.activityId)}
                                                    >
                                                        Ver pendientes
                                                    </button>
                                                )}

                                                {esFirmable(activity) ? (
                                                    <>
                                                        {canSelfSign && !yaFirme && (
                                                            <button className="btn btn-secondary btn-sm" onClick={() => openSelfSignModal(activity)}>
                                                                <FiCheck /> Firmar mi asistencia
                                                            </button>
                                                        )}
                                                        {canManage && (
                                                            <button className="btn btn-primary btn-sm" onClick={() => openAttendanceModal(activity)}>
                                                                <FiCheck />
                                                                {activity.estado === 'completada' ? 'Agregar firma' : 'Registrar asistencia'}
                                                            </button>
                                                        )}
                                                    </>
                                                ) : activity.fecha === today && !haComenzado(activity) ? (
                                                    <span className="act-row-hint" title={`Se puede firmar desde las ${(activity.horaInicio || '').slice(0, 5)}`}>
                                                        <FiClock size={12} /> Firma desde las {(activity.horaInicio || '').slice(0, 5)}
                                                    </span>
                                                ) : null}
                                            </div>

                                            {activity.estado === 'completada' && esFirmable(activity) && (
                                                <span className="act-row-foot">
                                                    <FiClock size={11} /> Cerrada, pero admite firmas de rezagados hasta el final del día
                                                </span>
                                            )}
                                        </article>
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                </section>

                {/* Historial — herramienta de consulta: buscar un registro puntual */}
                <section className="card act-card">
                    <header className="act-card-head">
                        <div>
                            <h2 className="act-card-title">Historial</h2>
                            <p className="act-card-sub">
                                Actividades ya realizadas en esta obra
                                {histFiltrado && ` · ${filteredActivities.length} de ${historialBase.length}`}
                            </p>
                        </div>
                    </header>

                    <div className="act-hist-filters">
                        <div className="act-hist-search">
                            <FiSearch size={15} aria-hidden="true" />
                            <input
                                type="search"
                                placeholder="Buscar por título, tema o tipo…"
                                value={histSearch}
                                onChange={(e) => { setHistSearch(e.target.value); setHistVisibles(10); }}
                            />
                        </div>

                        <div className="act-hist-range">
                            <label>
                                <span>Desde</span>
                                <input type="date" value={histDesde} max={histHasta || today}
                                    onChange={(e) => { setHistDesde(e.target.value); setHistVisibles(10); }} />
                            </label>
                            <label>
                                <span>Hasta</span>
                                <input type="date" value={histHasta} min={histDesde} max={today}
                                    onChange={(e) => { setHistHasta(e.target.value); setHistVisibles(10); }} />
                            </label>
                        </div>

                        <div className="act-hist-chips">
                            <button type="button" className="act-chip" onClick={() => aplicarRangoDias(7)}>7 días</button>
                            <button type="button" className="act-chip" onClick={() => aplicarRangoDias(30)}>30 días</button>
                            {histFiltrado && (
                                <button type="button" className="act-chip act-chip-clear" onClick={limpiarFiltrosHistorial}>
                                    Limpiar
                                </button>
                            )}
                        </div>
                    </div>

                    {filteredActivities.length === 0 ? (
                        <div className="act-empty act-empty-sm">
                            <span className="act-empty-icon"><FiClock size={20} /></span>
                            <h3 className="act-empty-title">
                                {histFiltrado ? 'Ningún registro coincide' : 'Todavía no hay historial'}
                            </h3>
                            <p className="act-empty-text">
                                {histFiltrado
                                    ? 'Prueba con otras palabras o amplía el rango de fechas.'
                                    : 'Las actividades aparecen acá al día siguiente de realizarse.'}
                            </p>
                            {histFiltrado && (
                                <div className="act-empty-actions">
                                    <button className="btn btn-secondary btn-sm" onClick={limpiarFiltrosHistorial}>
                                        Quitar filtros
                                    </button>
                                </div>
                            )}
                        </div>
                    ) : (
                        <>
                            <div className="table-container">
                                {/* Sin fila de encabezados: cada celda se explica sola.
                                    El nombre accesible lo aporta aria-label. */}
                                <table className="table act-hist-table" aria-label="Historial de actividades realizadas">
                                    <tbody>
                                        {filteredActivities.slice(0, histVisibles).map((activity) => {
                                            const seg = estadoSeguimiento(activity);
                                            const typeInfo = ACTIVITY_TYPES[activity.tipo] || {
                                                label: activity.tipoDescripcion || activity.tipo, color: 'var(--gray-500)', icon: <FiFileText />,
                                            };
                                            const fecha = new Date(`${activity.fecha}T00:00:00`);
                                            return (
                                                <tr key={activity.activityId} onClick={() => openDetailModal(activity)} style={{ cursor: 'pointer' }}>
                                                    <td>
                                                        <span className="act-hist-date">
                                                            {fecha.toLocaleDateString('es-CL', { day: '2-digit', month: 'short' })}
                                                        </span>
                                                        <span className="act-hist-time">
                                                            {(activity.horaInicio || '').slice(0, 5)}
                                                            {activity.horaFin && `–${activity.horaFin.slice(0, 5)}`}
                                                        </span>
                                                    </td>
                                                    <td>
                                                        <span className="act-hist-title">{activity.titulo}</span>
                                                        <span className="act-hist-type">
                                                            <i style={{ background: typeInfo.color }} aria-hidden="true" />
                                                            {typeInfo.label}
                                                            <span className={`badge badge-sm badge-${NIVEL_BADGE[seg.nivel]}`}>{seg.label}</span>
                                                        </span>
                                                    </td>
                                                    <td>
                                                        <span className="act-hist-firmas">
                                                            <FiUsers size={12} aria-hidden="true" />
                                                            {activity.asistentes.length} firma{activity.asistentes.length === 1 ? '' : 's'}
                                                        </span>
                                                    </td>
                                                    <td>
                                                        <div className="act-hist-report" onClick={(e) => e.stopPropagation()}>
                                                            <button
                                                                className="btn btn-ghost btn-icon btn-sm"
                                                                title="Ver el reporte"
                                                                aria-label={`Ver el reporte de ${activity.titulo}`}
                                                                onClick={() => verReporte(activity)}
                                                            >
                                                                <FiEye />
                                                            </button>
                                                            <button
                                                                className="btn btn-ghost btn-icon btn-sm"
                                                                title="Descargar el reporte en PDF"
                                                                aria-label={`Descargar el reporte de ${activity.titulo}`}
                                                                onClick={() => descargarReporte(activity)}
                                                            >
                                                                <FiDownload />
                                                            </button>
                                                        </div>
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>

                            {filteredActivities.length > histVisibles && (
                                <div className="act-hist-more">
                                    <button className="btn btn-secondary btn-sm" onClick={() => setHistVisibles((n) => n + 20)}>
                                        Mostrar 20 más
                                    </button>
                                    <span className="act-hist-more-count">
                                        {histVisibles} de {filteredActivities.length}
                                    </span>
                                </div>
                            )}
                        </>
                    )}
                </section>
                </>}{/* fin vista lista */}

                </>}

                {/* Pendientes de firmar de una actividad de hoy (§6, ítems 3, 4 y 5) */}
                <Modal
                    isOpen={!!pendientesActivity}
                    onClose={() => { setPendientesActivityId(null); setAusenciaMenu(null); }}
                    title="Quién falta por firmar"
                    subtitle={pendientesActivity?.titulo}
                    icon={<FiUsers size={20} />}
                    size="md"
                    footer={
                        <>
                            <button className="btn btn-secondary" onClick={() => { setPendientesActivityId(null); setAusenciaMenu(null); }}>
                                Cerrar
                            </button>
                            {pendientesActivity && esFirmable(pendientesActivity) && (
                                <button
                                    className="btn btn-primary"
                                    onClick={() => {
                                        const a = pendientesActivity;
                                        setPendientesActivityId(null);
                                        setAusenciaMenu(null);
                                        openAttendanceModal(a);
                                    }}
                                >
                                    <FiCheck /> Registrar asistencia
                                </button>
                            )}
                        </>
                    }
                >
                    {pendientesActivity && (() => {
                        const { pendientes, ausentes, firmados, esperados } = firmasDe(pendientesActivity);
                        return (
                            <div className="act-pend">
                                <p className="act-pend-lead">
                                    <b>{firmados}</b> de <b>{esperados}</b> convocados ya firmaron
                                    {ausentes.length > 0 && <> · {ausentes.length} con ausencia justificada</>}.
                                </p>

                                {pendientes.length > 0 ? (
                                    <div className="act-pend-group">
                                        <h4 className="act-pend-title">Sin firmar ({pendientes.length})</h4>
                                        <p className="act-pend-hint">
                                            Toca a una persona para justificar su ausencia. Los justificados dejan de contar como pendientes.
                                        </p>
                                        <div className="act-pend-list">
                                            {pendientes.map((f) => {
                                                const key = `${pendientesActivity.activityId}#${f.personaId}`;
                                                const abierto = ausenciaMenu === key;
                                                return (
                                                    <div key={f.personaId} className={`act-pend-item${abierto ? ' open' : ''}`}>
                                                        <button
                                                            type="button"
                                                            className="act-pend-person"
                                                            aria-expanded={abierto}
                                                            onClick={() => setAusenciaMenu(abierto ? null : key)}
                                                        >
                                                            <span className="act-pend-avatar" aria-hidden="true">{f.nombre.charAt(0)}</span>
                                                            <span className="act-pend-identity">
                                                                <span className="act-pend-name">{f.nombre}</span>
                                                                {f.cargo && <span className="act-pend-role">{f.cargo}</span>}
                                                            </span>
                                                            <span className="act-pend-cta">
                                                                <FiUserX size={13} /> Justificar
                                                                <FiChevronDown size={13} className={abierto ? 'rot' : ''} />
                                                            </span>
                                                        </button>

                                                        {abierto && (
                                                            <div className="act-pend-motivos">
                                                                {MOTIVOS_AUSENCIA.map((m) => (
                                                                    <button
                                                                        key={m.code}
                                                                        type="button"
                                                                        className="act-chip"
                                                                        disabled={ausenciaSaving}
                                                                        onClick={() => marcarAusente(f.personaId, m.code)}
                                                                    >
                                                                        {m.label}
                                                                    </button>
                                                                ))}
                                                                <button type="button" className="act-chip act-chip-clear"
                                                                    onClick={() => setAusenciaMenu(null)}>
                                                                    Cancelar
                                                                </button>
                                                            </div>
                                                        )}
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                ) : (
                                    <div className="act-pend-ok">
                                        <FiCheck size={16} /> Todos los convocados firmaron.
                                    </div>
                                )}

                                {ausentes.length > 0 && (
                                    <div className="act-pend-group">
                                        <h4 className="act-pend-title">Ausencias justificadas ({ausentes.length})</h4>
                                        <div className="act-pend-ausentes">
                                            {ausentes.map(({ fila, ausencia }) => (
                                                <span key={fila.personaId} className="act-pend-ausente">
                                                    {fila.nombre}
                                                    <i>{ausencia.motivoLabel}</i>
                                                    <button
                                                        type="button"
                                                        aria-label={`Quitar la ausencia de ${fila.nombre}`}
                                                        title="Quitar ausencia"
                                                        disabled={ausenciaSaving}
                                                        onClick={() => quitarAusente(fila.personaId)}
                                                    >
                                                        <FiX size={12} />
                                                    </button>
                                                </span>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>
                        );
                    })()}
                </Modal>

                {/* Create Activity Modal */}
                <Modal
                    isOpen={showModal}
                    onClose={() => !submitting && setShowModal(false)}
                    preventClose={submitting}
                    title="Nueva actividad"
                    subtitle="Queda agendada y, al iniciar, sus asistentes pueden firmar."
                    icon={<FiPlus size={20} />}
                    size="lg"
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
                            {(() => {
                                const { list: visibles, scoped } = visibleWorkersFor(newActivity.relatorId);
                                return (
                                    <WorkerPicker
                                        label="Asistentes requeridos"
                                        workers={visibles}
                                        selected={newActivity.asistentesRequeridos}
                                        onToggle={toggleRequiredAttendee}
                                        search={newAttendeeSearch}
                                        onSearchChange={setNewAttendeeSearch}
                                        maxHeight={220}
                                        emptyMessage={
                                            workers.length === 0
                                                ? 'No hay trabajadores asignados a esta obra.'
                                                : 'Este relator no tiene trabajadores en su grupo. Usa «Ver toda la obra» para elegir de todos modos.'
                                        }
                                        headerActions={
                                            scoped ? (
                                                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setVerTodaLaObra((v) => !v)}>
                                                    {verTodaLaObra ? 'Ver solo su grupo' : 'Ver toda la obra'}
                                                </button>
                                            ) : undefined
                                        }
                                    />
                                );
                            })()}
                        </div>
                    </form>
                </Modal>

                {/* Attendance Modal */}
                <Modal
                    isOpen={showAttendanceModal && !!selectedActivity}
                    onClose={() => setShowAttendanceModal(false)}
                    title="Registrar asistencia"
                    subtitle={selectedActivity?.titulo}
                    icon={<FiCheck size={20} />}
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
                        // Por defecto solo los citados a esta actividad. Quien no fue
                        // convocado pero se presenta igual puede firmar con «Ver toda la obra»
                        // (queda marcado como no convocado en el acta).
                        const citados = citadosDe(selectedActivity);
                        const hayCitados = citados.length > 0;
                        const listaCompleta = visibleWorkersFor(selectedActivity.relatorId).list;
                        const visiblesAsist = listaAsistenciaVisible(selectedActivity);
                        // Ya firmaron: no se pueden volver a seleccionar.
                        const yaFirmaron = visiblesAsist
                            .filter((w) => selectedActivity.asistentes.some(
                                (a) => (a as any).personaId === w.personaId || a.workerId === w.personaId))
                            .map((w) => w.personaId);
                        const extra = listaCompleta.length - citados.length;
                        return (
                            <>
                                <WorkerPicker
                                    label={hayCitados && !verTodaLaObra ? 'Citados a esta actividad' : 'Todos los trabajadores'}
                                    workers={visiblesAsist}
                                    selected={selectedWorkers}
                                    onToggle={toggleWorkerSelection}
                                    search={attendanceSearch}
                                    onSearchChange={setAttendanceSearch}
                                    maxHeight={320}
                                    lockedIds={yaFirmaron}
                                    lockedLabel="Ya firmó"
                                    highlightIds={verTodaLaObra ? (selectedActivity.asistentesRequeridos || []) : []}
                                    highlightLabel="Citado"
                                    onSelectAll={selectAllWorkers}
                                    emptyMessage="Esta actividad no tiene a nadie citado. Usa «Ver toda la obra» para registrar firmas de todos modos."
                                    headerActions={
                                        hayCitados && extra > 0 ? (
                                            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setVerTodaLaObra((v) => !v)}>
                                                {verTodaLaObra ? 'Ver solo los citados' : `Ver toda la obra (${extra} más)`}
                                            </button>
                                        ) : undefined
                                    }
                                />

                                {!hayCitados && (
                                    <p className="act-sign-note">
                                        Nadie fue citado a esta actividad, así que se muestran todos los trabajadores de la obra.
                                    </p>
                                )}
                                {selectedWorkers.length > 0 && (
                                    <p className="act-sign-note">
                                        Cada trabajador firma con <b>su propio PIN</b>, uno por uno. Podrás saltar a quien no esté presente.
                                    </p>
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

                {/* Detalle de la actividad */}
                {(() => {
                    if (!detailActivity) return null;
                    const a = detailActivity;
                    const typeInfo = ACTIVITY_TYPES[a.tipo] || {
                        label: a.tipoDescripcion || a.tipo, color: 'var(--gray-500)', icon: <FiFileText />,
                    };
                    const subtipo = a.subtipo
                        ? (a.subtipoDescripcion || CAPACITACION_SUBTIPOS[a.subtipo] || a.subtipo)
                        : '';
                    const firmas = firmasDe(a);
                    const seg = estadoSeguimiento(a);
                    const estaCerrada = a.estado === 'completada';
                    const relator = workers.find((w) => w.personaId === a.relatorId);
                    // Una actividad de un día ya pasado vive en el historial: es consulta,
                    // no se completa ni se cierra desde acá aunque haya quedado vencida.
                    const esHistorial = a.fecha < today;
                    const puedeGestionar = !esHistorial && (canManage || a.relatorId === user?.personaId);

                    // Guarda de UI del cierre (el backend es la validación dura):
                    // requiere al menos una firma y un registro con contenido.
                    const plan = a.planificacion || {};
                    const tema = plan.tema?.otro
                        || (plan.tema?.codigo && catalogos ? labelDe(catalogos.temas, plan.tema.codigo) : '');
                    const recursos = catalogos ? listaSeleccion(plan.recursos, catalogos.recursos) : [];
                    const riesgos = catalogos ? listaSeleccion(plan.riesgos, catalogos.riesgos) : [];
                    const medidas = catalogos ? listaSeleccion(plan.medidas, catalogos.medidas) : [];
                    const permisos = a.permisosTrabajo || [];
                    const registroVacio = !(
                        (a.descripcion || '').trim() || (a.ubicacion || '').trim()
                        || (a.asistentesRequeridos || []).length > 0
                        || permisos.length > 0 || plan.tema?.codigo || (plan.tema?.otro || '').trim()
                    );
                    const motivoBloqueo = (a.asistentes || []).length === 0
                        ? 'Necesitas al menos una firma para cerrar'
                        : registroVacio ? 'Completa el registro antes de cerrar' : undefined;

                    const hayRegistro = !!(a.descripcion || tema || recursos.length || riesgos.length
                        || medidas.length || plan.tipoTrabajo || plan.observaciones);

                    const abrirCompletarRegistro = () => {
                        setEditActivity(a);
                        setEditDraft({
                            planificacion: a.planificacion || { observaciones: '' },
                            permisosTrabajo: a.permisosTrabajo || [],
                        });
                        setShowDetailModal(false);
                        setShowEditModal(true);
                    };

                    const chips = (label: string, valores: string[]) => valores.length > 0 && (
                        <div className="ad-chips-group">
                            <span className="ad-chips-label">{label}</span>
                            <div className="ad-chips">
                                {valores.map((v) => <span key={v} className="ad-chip">{v}</span>)}
                            </div>
                        </div>
                    );

                    return (
                        <Modal
                            isOpen={showDetailModal}
                            onClose={() => setShowDetailModal(false)}
                            title={a.titulo}
                            subtitle={`${typeInfo.label}${subtipo ? ` · ${subtipo}` : ''}`}
                            icon={typeInfo.icon}
                            size="lg"
                            footer={
                                <div className="ad-footer">
                                    {/* Mismas acciones de reporte que en el historial */}
                                    <div className="ad-footer-report">
                                        <button className="btn btn-ghost btn-sm" onClick={() => verReporte(a)}>
                                            <FiEye size={14} /> Ver reporte
                                        </button>
                                        <button className="btn btn-ghost btn-sm" onClick={() => descargarReporte(a)}>
                                            <FiDownload size={14} /> Descargar reporte
                                        </button>
                                    </div>
                                    {/* El historial es solo de consulta: sin acciones de edición ni cierre */}
                                    {puedeGestionar && (
                                        <div className="ad-footer-main">
                                            <button className="btn btn-secondary" onClick={abrirCompletarRegistro}>
                                                <FiEdit3 size={14} /> Completar registro
                                            </button>
                                            {!estaCerrada && (
                                                <button
                                                    className="btn btn-primary"
                                                    disabled={cerrando || !!motivoBloqueo}
                                                    title={motivoBloqueo}
                                                    onClick={() => handleCerrarActividad(a)}
                                                >
                                                    <FiCheck size={16} />
                                                    {cerrando ? 'Cerrando…' : 'Cerrar actividad'}
                                                </button>
                                            )}
                                        </div>
                                    )}
                                </div>
                            }
                        >
                            <div className="ad">
                                {/* Estado de firmas: lo primero que se necesita saber */}
                                <section className={`ad-hero${firmas.esperados > 0 && firmas.pendientes.length === 0 ? ' done' : ''}`}>
                                    <span className="ad-hero-rail" style={{ background: typeInfo.color }} aria-hidden="true" />
                                    <div className="ad-hero-body">
                                        <div className="ad-hero-top">
                                            <span className="ad-hero-eyebrow">Firmas</span>
                                            <span className={`badge badge-${NIVEL_BADGE[seg.nivel]}`}>{seg.label}</span>
                                        </div>
                                        {firmas.esperados > 0 ? (
                                            <>
                                                <p className="ad-hero-num">
                                                    <b>{firmas.firmados}</b><span>/{firmas.esperados}</span>
                                                </p>
                                                <span className="ad-hero-bar" role="img"
                                                    aria-label={`${firmas.firmados} de ${firmas.esperados} convocados han firmado`}>
                                                    <i style={{ width: `${Math.round((firmas.firmados / firmas.esperados) * 100)}%` }} />
                                                </span>
                                                <p className="ad-hero-note">
                                                    {firmas.pendientes.length === 0
                                                        ? 'Todos los convocados firmaron.'
                                                        : `Faltan ${firmas.pendientes.length} por firmar.`}
                                                    {firmas.ausentes.length > 0 && ` ${firmas.ausentes.length} con ausencia justificada.`}
                                                </p>
                                            </>
                                        ) : (
                                            <>
                                                <p className="ad-hero-num"><b>{firmas.totalFirmas}</b></p>
                                                <p className="ad-hero-note">
                                                    {firmas.totalFirmas === 1 ? 'firma registrada' : 'firmas registradas'} · nadie fue convocado
                                                </p>
                                            </>
                                        )}
                                    </div>
                                    <dl className="ad-datos">
                                        <div><dt>Fecha</dt><dd>{new Date(`${a.fecha}T00:00:00`).toLocaleDateString('es-CL', { day: '2-digit', month: 'short', year: 'numeric' })}</dd></div>
                                        <div><dt>Horario</dt><dd>{(a.horaInicio || '—').slice(0, 5)}{a.horaFin && `–${a.horaFin.slice(0, 5)}`}</dd></div>
                                        <div><dt>Relator</dt><dd>{relator ? `${relator.nombre} ${relator.apellido || ''}`.trim() : '—'}</dd></div>
                                        <div><dt>Lugar</dt><dd>{a.ubicacion || '—'}</dd></div>
                                    </dl>
                                </section>

                                {/* Registro del día */}
                                <section className="ad-section">
                                    <h3 className="ad-section-title">
                                        Registro del día
                                        {!hayRegistro && <span className="ad-section-flag">Sin completar</span>}
                                    </h3>
                                    {hayRegistro ? (
                                        <div className="ad-registro">
                                            {tema && (
                                                <p className="ad-tema"><span>Tema</span> {tema}</p>
                                            )}
                                            {a.descripcion && <p className="ad-texto">{a.descripcion}</p>}
                                            {chips('Recursos', recursos)}
                                            {chips('Riesgos', riesgos)}
                                            {chips('Medidas', medidas)}
                                            {plan.tipoTrabajo && (
                                                <p className="ad-meta-linea">
                                                    Trabajo {plan.tipoTrabajo === 'exterior' ? 'en exterior' : 'en interior'}
                                                    {plan.condicionClimatica && ` · ${CLIMA_LABEL[plan.condicionClimatica] || plan.condicionClimatica}`}
                                                    {plan.tipoTrabajo === 'exterior' && plan.protectorSolar != null
                                                        && ` · protector solar: ${plan.protectorSolar ? 'sí' : 'no'}`}
                                                </p>
                                            )}
                                            {plan.observaciones && (
                                                <div className="ad-obs">
                                                    <span className="ad-chips-label">
                                                        {a.tipo === 'REUNION_COMITE' ? 'Participación y consulta' : 'Observaciones'}
                                                    </span>
                                                    <p className="ad-texto">{plan.observaciones}</p>
                                                </div>
                                            )}
                                        </div>
                                    ) : (
                                        <p className="ad-empty">
                                            Todavía no hay tema, riesgos ni medidas registrados.
                                            {puedeGestionar && ' Complétalo antes de cerrar la actividad.'}
                                        </p>
                                    )}
                                </section>

                                {/* Asistencia */}
                                <section className="ad-section">
                                    <h3 className="ad-section-title">Asistencia</h3>
                                    <ReporteActividad activity={a} workers={workers} />
                                </section>

                                {/* Permisos de trabajo */}
                                {permisos.length > 0 && (
                                    <section className="ad-section">
                                        <h3 className="ad-section-title">Permisos de trabajo</h3>
                                        <ul className="ad-permisos">
                                            {permisos.map((pt) => (
                                                <li key={pt.tipo} className={`ad-permiso${pt.completo ? ' completo' : ''}`}>
                                                    <span className="ad-permiso-nombre">{permisosDef[pt.tipo]?.label || pt.tipo}</span>
                                                    <span className="ad-permiso-estado">
                                                        {pt.completo ? <><FiCheck size={12} /> Completo</> : <><FiAlertTriangle size={12} /> Incompleto</>}
                                                    </span>
                                                </li>
                                            ))}
                                        </ul>
                                    </section>
                                )}

                                {motivoBloqueo && puedeGestionar && !estaCerrada && (
                                    <p className="ad-bloqueo"><FiAlertTriangle size={13} /> {motivoBloqueo}</p>
                                )}
                            </div>
                        </Modal>
                    );
                })()}

                {/* Completar registro Modal — edición acotada de planificación + permisos de trabajo (PATCH) */}
                <Modal
                    isOpen={showEditModal && !!editActivity}
                    onClose={() => !editSaving && setShowEditModal(false)}
                    title="Completar registro"
                    subtitle={editActivity?.titulo}
                    icon={<FiEdit3 size={20} />}
                    size="lg"
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

                {/* Detalle de un día del calendario */}
                <Modal
                    isOpen={!!dayModalFecha}
                    onClose={() => setDayModalFecha(null)}
                    icon={<FiCalendar size={20} />}
                    title="Actividades del día"
                    subtitle={dayModalFecha
                        ? new Date(`${dayModalFecha}T00:00:00`).toLocaleDateString('es-CL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
                        : undefined}
                    size="lg"
                    footer={
                        <>
                            {canCrearActividad && dayModalFecha && (
                                <button className="btn btn-primary" onClick={() => crearEnFecha(dayModalFecha)}>
                                    <FiPlus /> Nueva actividad este día
                                </button>
                            )}
                            <button className="btn btn-secondary" onClick={() => setDayModalFecha(null)}>Cerrar</button>
                        </>
                    }
                >
                    {dayModalFecha && (() => {
                        const delDia = activities
                            .filter(a => a.fecha === dayModalFecha)
                            .sort((x, y) => {
                                // Pendientes por completar primero; luego por hora.
                                const px = x.estado === 'borrador' ? 0 : 1;
                                const py = y.estado === 'borrador' ? 0 : 1;
                                if (px !== py) return px - py;
                                return (x.horaInicio || '').localeCompare(y.horaInicio || '');
                            });
                        const pendientes = delDia.filter(a => a.estado === 'borrador');

                        if (delDia.length === 0) {
                            return (
                                <div className="act-empty act-empty-sm">
                                    <span className="act-empty-icon"><FiCalendar size={20} /></span>
                                    <h3 className="act-empty-title">Sin actividades este día</h3>
                                    <p className="act-empty-text">
                                        {canCrearActividad
                                            ? 'Usa «Nueva actividad este día» para agendar la primera.'
                                            : 'No hay nada registrado ni planificado para esta fecha.'}
                                    </p>
                                </div>
                            );
                        }

                        const estadoBadge = (a: Activity) => {
                            switch (a.estado) {
                                case 'borrador': return <span className="badge badge-warning">Por completar</span>;
                                case 'completada': return <span className="badge badge-success">Completada</span>;
                                case 'cancelada': return <span className="badge badge-danger">Cancelada</span>;
                                case 'en_curso': return <span className="badge badge-warning">En curso</span>;
                                default: return <span className="badge badge-neutral">Programada</span>;
                            }
                        };

                        return (
                            <div className="flex flex-col gap-3">
                                {pendientes.length > 0 && (
                                    <div className="alert alert-warning">
                                        <strong>{pendientes.length}</strong> actividad(es) de este día aún está(n) <strong>por completar</strong>.
                                    </div>
                                )}
                                {delDia.map((a) => {
                                    const typeInfo = ACTIVITY_TYPES[a.tipo] || { label: a.tipoDescripcion || a.tipo, color: 'var(--gray-500)', icon: <FiFileText /> };
                                    const responsable = workers.find(w => w.personaId === a.relatorId);
                                    return (
                                        <div
                                            key={a.activityId}
                                            className="flex items-center justify-between"
                                            style={{
                                                padding: 'var(--space-3)',
                                                background: 'var(--surface-elevated)',
                                                borderRadius: 'var(--radius-md)',
                                                border: a.estado === 'borrador' ? '1px dashed var(--warning-500)' : '1px solid var(--surface-border)',
                                            }}
                                        >
                                            <div className="flex items-center gap-3" style={{ minWidth: 0 }}>
                                                <div className="avatar avatar-sm" style={{ background: typeInfo.color, flexShrink: 0 }}>{typeInfo.icon}</div>
                                                <div style={{ minWidth: 0 }}>
                                                    <div className="font-bold" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.titulo}</div>
                                                    <div className="text-sm text-muted">
                                                        {typeInfo.label}
                                                        {a.horaInicio && ` · ${a.horaInicio.slice(0, 5)}`}
                                                        {a.horaFin && `–${a.horaFin.slice(0, 5)}`}
                                                        {responsable && ` · ${responsable.nombre} ${responsable.apellido || ''}`.trimEnd()}
                                                        {a.tipoTrabajo && TIPOS_TRABAJO[a.tipoTrabajo] && ` · ${TIPOS_TRABAJO[a.tipoTrabajo]}`}
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-2" style={{ flexShrink: 0 }}>
                                                {estadoBadge(a)}
                                                {puedeCompletar(a) ? (
                                                    <button
                                                        className="btn btn-primary btn-sm"
                                                        onClick={() => { setDayModalFecha(null); openCompleteModal(a); }}
                                                    >
                                                        <FiEdit3 size={14} /> Completar
                                                    </button>
                                                ) : (
                                                    <button
                                                        className="btn btn-secondary btn-sm"
                                                        onClick={() => { setDayModalFecha(null); openDetailModal(a); }}
                                                    >
                                                        Ver detalle
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        );
                    })()}
                </Modal>

                {/* Planificador: esqueleto de actividades del mes */}
                <Modal
                    isOpen={showPlanModal}
                    onClose={() => !planSubmitting && setShowPlanModal(false)}
                    preventClose={planSubmitting}
                    icon={<FiCalendar size={20} />}
                    title="Planificar actividades del mes"
                    subtitle="Arma el esqueleto: cada ítem genera actividades en borrador que los responsables completan día a día. Sábados y domingos se excluyen automáticamente."
                    size="lg"
                    footer={
                        <>
                            <button type="button" className="btn btn-secondary" disabled={planSubmitting} onClick={() => setShowPlanModal(false)}>Cancelar</button>
                            <button type="submit" form="plan-form" className="btn btn-primary" disabled={planSubmitting}>
                                {planSubmitting ? 'Generando…' : 'Generar planificación'}
                            </button>
                        </>
                    }
                >
                    <form id="plan-form" onSubmit={handleGeneratePlan}>
                        <div className="grid grid-cols-2" style={{ gap: 'var(--space-4)' }}>
                            <div className="form-group">
                                <label className="form-label">Desde *</label>
                                <input
                                    type="date"
                                    value={planRango.desde}
                                    onChange={(e) => setPlanRango({ ...planRango, desde: e.target.value })}
                                    className="form-input"
                                    required
                                />
                            </div>
                            <div className="form-group">
                                <label className="form-label">Hasta *</label>
                                <input
                                    type="date"
                                    value={planRango.hasta}
                                    min={planRango.desde}
                                    onChange={(e) => setPlanRango({ ...planRango, hasta: e.target.value })}
                                    className="form-input"
                                    required
                                />
                            </div>
                        </div>

                        {planItems.map((item, index) => (
                            <div key={index} className="act-plan-item">
                                <div className="act-plan-item-head">
                                    <span className="act-plan-item-type" style={{ background: ACTIVITY_TYPES[item.tipo]?.color }} aria-hidden="true">
                                        {ACTIVITY_TYPES[item.tipo]?.icon}
                                    </span>
                                    <div className="act-plan-item-copy">
                                        <b>{item.tituloBase.trim() || ACTIVITY_TYPES[item.tipo]?.label || 'Actividad'}</b>
                                        <span>
                                            {item.periodicidad === 'diaria' ? 'Cada día hábil' : item.periodicidad === 'semanal' ? 'Una vez por semana' : 'Una vez al mes'}
                                            {' · '}
                                            {item.responsables.length > 0
                                                ? `${item.responsables.length} responsable${item.responsables.length === 1 ? '' : 's'}`
                                                : 'sin responsables'}
                                        </span>
                                    </div>
                                    {planItems.length > 1 && (
                                        <button
                                            type="button"
                                            className="btn btn-ghost btn-sm"
                                            aria-label={`Quitar ${ACTIVITY_TYPES[item.tipo]?.label || 'este ítem'} del plan`}
                                            onClick={() => setPlanItems(prev => prev.filter((_, i) => i !== index))}
                                        >
                                            <FiTrash2 size={14} />
                                        </button>
                                    )}
                                </div>

                                <div className="grid grid-cols-2" style={{ gap: 'var(--space-4)' }}>
                                    <div className="form-group">
                                        <label className="form-label">Tipo de actividad *</label>
                                        <Select
                                            ariaLabel={`Tipo de actividad del ítem ${index + 1}`}
                                            value={item.tipo}
                                            onChange={(v) => updatePlanItem(index, { tipo: v })}
                                            options={Object.entries(ACTIVITY_TYPES).map(([key, { label, icon }]) => ({ value: key, label, icon }))}
                                        />
                                    </div>
                                    <div className="form-group">
                                        <label className="form-label">Periodicidad *</label>
                                        <Select
                                            ariaLabel={`Periodicidad del ítem ${index + 1}`}
                                            value={item.periodicidad}
                                            onChange={(v) => updatePlanItem(index, { periodicidad: v as PlanItemForm['periodicidad'] })}
                                            options={[
                                                { value: 'diaria', label: 'Diaria (lunes a viernes)' },
                                                { value: 'semanal', label: 'Semanal' },
                                                { value: 'mensual', label: 'Mensual' },
                                            ]}
                                        />
                                    </div>
                                </div>

                                <div className="grid grid-cols-2" style={{ gap: 'var(--space-4)' }}>
                                    <div className="form-group">
                                        <label className="form-label">Tipo de trabajo</label>
                                        <Select
                                            ariaLabel={`Tipo de trabajo del ítem ${index + 1}`}
                                            placeholder="(Todos)"
                                            value={item.tipoTrabajo}
                                            onChange={(v) => updatePlanItem(index, { tipoTrabajo: v })}
                                            options={[
                                                { value: '', label: 'Todos / no aplica' },
                                                ...Object.entries(TIPOS_TRABAJO).map(([value, label]) => ({ value, label })),
                                            ]}
                                        />
                                    </div>
                                    <div className="form-group">
                                        <label className="form-label">Hora por defecto</label>
                                        <input
                                            type="time"
                                            value={item.horaInicio}
                                            onChange={(e) => updatePlanItem(index, { horaInicio: e.target.value })}
                                            className="form-input"
                                        />
                                    </div>
                                </div>

                                <div className="grid grid-cols-2" style={{ gap: 'var(--space-4)' }}>
                                    <div className="form-group">
                                        <label className="form-label">Título base</label>
                                        <input
                                            type="text"
                                            value={item.tituloBase}
                                            onChange={(e) => updatePlanItem(index, { tituloBase: e.target.value })}
                                            className="form-input"
                                            placeholder={ACTIVITY_TYPES[item.tipo]?.label || 'Título de la actividad'}
                                        />
                                    </div>
                                    <div className="form-group">
                                        <label className="form-label">Ubicación por defecto</label>
                                        <input
                                            type="text"
                                            value={item.ubicacion}
                                            onChange={(e) => updatePlanItem(index, { ubicacion: e.target.value })}
                                            className="form-input"
                                            placeholder="Ej: Frente de obra"
                                        />
                                    </div>
                                </div>

                                <div className="form-group" style={{ marginBottom: 0 }}>
                                    <p className="act-plan-hint">
                                        Elige solo a quienes les corresponde esta actividad (ej. inspección de andamios → quienes la realizan).
                                        Se genera un borrador por día para cada responsable.
                                    </p>
                                    <WorkerPicker
                                        label="Responsables"
                                        compact
                                        workers={workers}
                                        selected={item.responsables}
                                        onToggle={(personaId) => togglePlanResponsable(index, personaId)}
                                        search={planSearch[index] || ''}
                                        onSearchChange={(v) => setPlanSearch((prev) => ({ ...prev, [index]: v }))}
                                        maxHeight={180}
                                    />
                                </div>
                            </div>
                        ))}

                        <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            onClick={() => setPlanItems(prev => [...prev, { ...emptyPlanItem }])}
                        >
                            <FiPlus size={14} /> Agregar otro ítem
                        </button>
                    </form>
                </Modal>

                {/* Completar borrador: rellenar el detalle del día */}
                <Modal
                    isOpen={showCompleteModal && !!completeActivity}
                    onClose={() => !completeSubmitting && setShowCompleteModal(false)}
                    preventClose={completeSubmitting}
                    icon={<FiEdit3 size={20} />}
                    title="Completar actividad planificada"
                    subtitle={completeActivity ? `${ACTIVITY_TYPES[completeActivity.tipo]?.label || completeActivity.tipo} · ${new Date(`${completeActivity.fecha}T00:00:00`).toLocaleDateString('es-CL', { weekday: 'long', day: 'numeric', month: 'long' })}` : undefined}
                    size="lg"
                    footer={
                        <>
                            <button type="button" className="btn btn-secondary" disabled={completeSubmitting} onClick={() => setShowCompleteModal(false)}>Cancelar</button>
                            <button type="submit" form="complete-form" className="btn btn-primary" disabled={completeSubmitting}>
                                {completeSubmitting ? 'Guardando…' : 'Guardar y programar'}
                            </button>
                        </>
                    }
                >
                    <form id="complete-form" onSubmit={handleCompleteBorrador}>
                        <div className="alert alert-info mb-4">
                            <span>
                                Este es un borrador del plan. Completa el detalle del día.
                                <br />
                                Al guardar, la actividad queda <strong>programada</strong> y sus asistentes reciben el aviso.
                            </span>
                        </div>

                        <div className="form-group">
                            <label className="form-label">Título *</label>
                            <input
                                type="text"
                                value={completeForm.titulo}
                                onChange={(e) => setCompleteForm({ ...completeForm, titulo: e.target.value })}
                                className="form-input"
                                placeholder="Ej: Charla — Trabajos en altura sector B"
                                required
                            />
                        </div>

                        <div className="form-group">
                            <label className="form-label">Descripción / tema del día</label>
                            <textarea
                                value={completeForm.descripcion}
                                onChange={(e) => setCompleteForm({ ...completeForm, descripcion: e.target.value })}
                                className="form-input"
                                rows={3}
                                placeholder="Detalle específico de esta jornada (cada día puede tratar un tema distinto)…"
                                style={{ resize: 'vertical' }}
                            />
                        </div>

                        <div className="form-group">
                            <label className="form-label">Relator *</label>
                            <Select
                                ariaLabel="Relator"
                                placeholder="Seleccione un relator"
                                searchable
                                value={completeForm.relatorId}
                                onChange={(v) => setCompleteForm({ ...completeForm, relatorId: v })}
                                options={workers.map((worker) => ({
                                    value: worker.personaId,
                                    label: `${worker.nombre} ${worker.apellido}`,
                                    description: worker.cargo,
                                }))}
                            />
                            {/* Reemplazo: se deja constancia de a quién lo asignaba el plan. */}
                            {completeActivity && completeForm.relatorId !== completeActivity.relatorId && (() => {
                                const planificado = workers.find(w => w.personaId === completeActivity.relatorId);
                                return (
                                    <div className="text-xs text-muted" style={{ marginTop: 4 }}>
                                        El plan lo asignaba a {planificado ? `${planificado.nombre} ${planificado.apellido}` : 'otra persona'}.
                                        Queda registrado como reemplazo.
                                    </div>
                                );
                            })()}
                        </div>

                        <div className="grid grid-cols-2" style={{ gap: 'var(--space-4)' }}>
                            <div className="form-group">
                                <label className="form-label">Hora inicio *</label>
                                <input
                                    type="time"
                                    value={completeForm.horaInicio}
                                    onChange={(e) => setCompleteForm({ ...completeForm, horaInicio: e.target.value })}
                                    className="form-input"
                                    required
                                />
                            </div>
                            <div className="form-group">
                                <label className="form-label">Hora fin</label>
                                <input
                                    type="time"
                                    value={completeForm.horaFin}
                                    onChange={(e) => setCompleteForm({ ...completeForm, horaFin: e.target.value })}
                                    className="form-input"
                                />
                            </div>
                        </div>

                        <div className="form-group">
                            <label className="form-label">Ubicación</label>
                            <input
                                type="text"
                                value={completeForm.ubicacion}
                                onChange={(e) => setCompleteForm({ ...completeForm, ubicacion: e.target.value })}
                                className="form-input"
                                placeholder="Ej: Frente de obra, sala de charlas…"
                            />
                        </div>

                        <div className="form-group">
                            <WorkerPicker
                                label="Asistentes requeridos"
                                workers={workers}
                                selected={completeForm.asistentesRequeridos}
                                onToggle={toggleCompleteAttendee}
                                search={completeAttendeeSearch}
                                onSearchChange={setCompleteAttendeeSearch}
                                maxHeight={200}
                            />
                        </div>
                    </form>
                </Modal>

                {/* Acta en PDF, dentro de la página (mismo visor del repositorio) */}
                <DocumentPreviewModal
                    isOpen={!!reportePreview}
                    onClose={cerrarReporte}
                    url={reportePreview?.url ?? null}
                    fileName={reportePreview ? nombreArchivoReporte(reportePreview.activity) : undefined}
                    onDownload={reportePreview ? () => descargarReporte(reportePreview.activity) : undefined}
                />

                <style>{activitiesStyles}</style>
            </div>
        </>
    );
}

const activitiesStyles = `
/* ── Barra de filtros ────────────────────────────────────────────────────── */
/* Buscar y filtrar por tipo son la misma pregunta: van en un solo control, y los
   tres elementos de la barra comparten altura para que la fila lea pareja. */
.act-toolbar { --act-ctl-h: 44px; align-items: center; }

.act-filterbar {
    display: flex; align-items: stretch; height: var(--act-ctl-h);
    flex: 1 1 460px; min-width: 260px; max-width: 620px;
    background: var(--surface-card);
    border: 1px solid var(--surface-border);
    border-radius: var(--radius-md);
    overflow: hidden;
    transition: border-color var(--transition-fast), box-shadow var(--transition-fast);
}
.act-filterbar:focus-within { border-color: var(--primary-400); box-shadow: 0 0 0 3px var(--accent-tint); }

.act-filterbar-search { position: relative; display: flex; align-items: center; flex: 1 1 auto; min-width: 0; }
.act-filterbar-search > svg { position: absolute; left: 13px; color: var(--text-muted); pointer-events: none; }
.act-filterbar-search input {
    width: 100%; height: 100%; padding: 0 var(--space-3) 0 37px;
    border: 0; background: transparent; color: var(--text-primary);
    font-size: 0.88rem; font-family: inherit;
}
.act-filterbar-search input:focus { outline: none; }
.act-filterbar-search input::-webkit-search-cancel-button { filter: grayscale(1); opacity: .6; cursor: pointer; }

.act-filterbar-divider { width: 1px; background: var(--surface-border); flex-shrink: 0; }

/* El Select pierde su caja propia: la caja es la barra */
.act-filterbar-select { flex: 0 0 250px; min-width: 0; }
.act-filterbar-select .ui-select { height: 100%; }
.act-filterbar-select .ui-select-trigger {
    height: 100%; padding: 0 var(--space-3);
    border: 0; border-radius: 0; background: transparent;
    font-size: 0.88rem;
}
.act-filterbar-select .ui-select-trigger:hover:not(:disabled) { background: var(--surface-hover); border-color: transparent; }
.act-filterbar-select .ui-select-trigger.open { background: var(--surface-hover); border-color: transparent; box-shadow: none; }
.act-filterbar-select .ui-select-trigger:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }

.act-toolbar .ui-segmented { height: var(--act-ctl-h); flex-shrink: 0; }

@media (max-width: 720px) {
    .act-filterbar { flex-direction: column; height: auto; max-width: none; }
    .act-filterbar-search { height: var(--act-ctl-h); }
    .act-filterbar-divider { width: auto; height: 1px; }
    .act-filterbar-select { flex: 0 0 var(--act-ctl-h); }
    .act-toolbar .ui-segmented { width: 100%; }
}

/* ── Tarjetas de sección ─────────────────────────────────────────────────── */
/* Contenedor de sección: no reacciona al hover como una card clicable */
.act-card { padding: 0; }
.act-card:hover { border-color: var(--surface-border); box-shadow: none; }
/* La tabla es parte de la tarjeta: sin doble borde ni doble radio.
   min-width:0 es obligatorio — como hijo flex de .card, sin él la tabla se niega a
   encogerse bajo su ancho de contenido y estira la página entera en móvil. */
.act-card .table-container { border: 0; border-radius: 0; border-top: 1px solid var(--surface-border); min-width: 0; }
.act-card .table td { padding-top: var(--space-3); padding-bottom: var(--space-3); }
.act-card .table th:first-child, .act-card .table td:first-child { padding-left: var(--space-5); }
.act-card .table th:last-child, .act-card .table td:last-child { padding-right: var(--space-5); }
.act-card-head {
    display: flex; align-items: center; justify-content: space-between; gap: var(--space-3);
    padding: var(--space-5) var(--space-5) var(--space-4);
}
.act-card-title { font-size: var(--text-lg); font-weight: 600; margin: 0; letter-spacing: -0.01em; }
.act-card-sub { font-size: var(--text-sm); color: var(--text-muted); margin: 2px 0 0; }
.act-card-sub::first-letter { text-transform: uppercase; }
.act-card-count {
    font-size: var(--text-sm); font-weight: 700; color: var(--accent-text);
    background: var(--accent-tint); min-width: 28px; height: 28px; padding: 0 9px;
    border-radius: var(--radius-full); display: inline-flex; align-items: center; justify-content: center;
}

/* ── Estado vacío (con salida a la acción) ───────────────────────────────── */
.act-empty { text-align: center; padding: var(--space-10) var(--space-6) var(--space-8); }
.act-empty-sm { padding: var(--space-8) var(--space-6); }
.act-empty-icon {
    width: 44px; height: 44px; border-radius: var(--radius-lg);
    background: var(--surface-hover); color: var(--text-muted);
    display: inline-flex; align-items: center; justify-content: center; margin-bottom: var(--space-3);
}
.act-empty-title { font-size: var(--text-base); font-weight: 600; margin: 0 0 4px; }
.act-empty-text { font-size: var(--text-sm); color: var(--text-muted); margin: 0 auto; max-width: 380px; line-height: 1.55; }
.act-empty-actions { display: flex; justify-content: center; flex-wrap: wrap; gap: var(--space-2); margin-top: var(--space-5); }

/* ── Actividades de hoy ──────────────────────────────────────────────────── */
.act-today-list { list-style: none; margin: 0; padding: 0 var(--space-3) var(--space-3); display: flex; flex-direction: column; gap: var(--space-2); }
.act-row {
    display: grid;
    /* Anchos fijos en las columnas de estado: cada fila es su propia grilla, así que
       sin ellos las medidas y los badges no se alinean entre filas de la lista. */
    grid-template-columns: 52px minmax(0, 1fr) 132px 96px auto;
    align-items: center; gap: var(--space-3);
    padding: var(--space-3) var(--space-4);
    background: var(--surface-elevated); border: 1px solid var(--surface-border);
    border-radius: var(--radius-md); cursor: pointer;
    transition: border-color var(--transition-fast), background var(--transition-fast);
}
.act-row:hover { background: var(--surface-hover); border-color: var(--primary-400); }
.act-row:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

/* La hora es el ancla de lectura del día: va primero y en tabulares */
.act-row-hora { display: flex; flex-direction: column; line-height: 1.15; font-variant-numeric: tabular-nums; }
.act-row-hora b { font-size: var(--text-base); font-weight: 600; color: var(--text-primary); }
.act-row-hora i { font-style: normal; font-size: var(--text-xs); color: var(--text-muted); }

.act-row-type {
    width: 36px; height: 36px; border-radius: var(--radius-md); color: #fff;
    display: flex; align-items: center; justify-content: center; font-size: 1rem;
}
.act-row-main { min-width: 0; }
.act-row-title { font-size: var(--text-sm); font-weight: 600; margin: 0; color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.act-row-meta { font-size: var(--text-xs); color: var(--text-muted); margin: 2px 0 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* Medidor de firmas: el dato que define el estado real de la actividad */
.act-firmas { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.act-row > .badge { justify-self: start; }
.act-row-actions { justify-self: end; }
.act-firmas-num { font-size: var(--text-xs); color: var(--text-muted); font-variant-numeric: tabular-nums; }
.act-firmas-num b { font-size: var(--text-sm); font-weight: 700; color: var(--text-primary); }
.act-firmas-bar { display: block; height: 4px; border-radius: var(--radius-full); background: var(--surface-border); overflow: hidden; }
.act-firmas-bar i { display: block; height: 100%; border-radius: inherit; background: var(--warning-500); transition: width var(--transition-normal); }
.act-firmas.done .act-firmas-bar i { background: var(--success-500); }
.act-firmas-label { font-size: 11px; color: var(--text-muted); display: inline-flex; align-items: center; gap: 4px; }
.act-firmas.done .act-firmas-label { color: var(--success-600, var(--success-500)); font-weight: 500; }

.act-row-actions { display: flex; align-items: center; gap: var(--space-2); min-width: 0; }
.act-row-hint { display: inline-flex; align-items: center; gap: 4px; font-size: var(--text-xs); color: var(--text-muted); white-space: nowrap; }
.act-row-foot {
    grid-column: 1 / -1; display: inline-flex; align-items: center; gap: 5px;
    font-size: 11px; color: var(--text-muted);
    border-top: 1px dashed var(--surface-border); margin-top: 2px; padding-top: var(--space-2);
}

@media (max-width: 900px) {
    /* La 1ª columna pasa a auto: la comparten la hora y el badge, y así el badge
       cabe a la izquierda con las acciones a la derecha en la misma línea. */
    .act-row { grid-template-columns: auto minmax(0, 1fr); row-gap: var(--space-3); }
    .act-firmas { grid-column: 1 / -1; max-width: 360px; }
    .act-row > .badge { grid-column: 1 / 2; }
    /* stretch, no "end": con justify-self:end la celda toma su ancho máximo y desborda */
    .act-row-actions { grid-column: 2 / -1; justify-self: stretch; justify-content: flex-end; flex-wrap: wrap; }
}
@media (max-width: 560px) {
    .act-row-actions { grid-column: 1 / -1; }
    .act-row-actions .btn { flex: 1 1 auto; justify-content: center; }
    .act-row-hint { white-space: normal; }
}

/* ── Del plan, por completar ─────────────────────────────────────────────── */
/* El borde punteado dice "esto todavía no está en firme" sin necesidad de copy */
.act-card-todo { border-style: dashed; }
.act-todo-list { list-style: none; margin: 0; padding: 0 var(--space-3) var(--space-3); display: flex; flex-direction: column; gap: var(--space-2); }
.act-todo-row {
    display: flex; align-items: center; gap: var(--space-3);
    padding: var(--space-3) var(--space-4);
    background: var(--surface-elevated); border: 1px dashed var(--surface-border);
    border-radius: var(--radius-md);
}
.act-todo-row .act-row-main { flex: 1; }
.act-todo-more { font-size: var(--text-xs); color: var(--text-muted); text-align: center; padding-top: var(--space-1); }

/* ── Historial ───────────────────────────────────────────────────────────── */
.act-hist-filters {
    display: flex; align-items: center; gap: var(--space-3); flex-wrap: wrap;
    padding: 0 var(--space-5) var(--space-4);
}
.act-hist-search { position: relative; display: flex; align-items: center; flex: 1 1 220px; min-width: 190px; max-width: 340px; }
.act-hist-search > svg { position: absolute; left: 12px; color: var(--text-muted); pointer-events: none; }
.act-hist-search input {
    width: 100%; padding: 9px 12px 9px 36px;
    border: 1px solid var(--surface-border); border-radius: var(--radius-md);
    background: var(--surface-bg); color: var(--text-primary); font-size: 0.88rem;
}
.act-hist-search input:focus { outline: none; border-color: var(--primary-400); box-shadow: 0 0 0 3px var(--accent-tint); }

.act-hist-range { display: flex; align-items: center; gap: var(--space-2); }
.act-hist-range label { display: flex; align-items: center; gap: 6px; }
.act-hist-range span { font-size: var(--text-xs); color: var(--text-muted); }
.act-hist-range input {
    padding: 7px 10px; border: 1px solid var(--surface-border); border-radius: var(--radius-md);
    background: var(--surface-bg); color: var(--text-primary); font-size: var(--text-xs);
    font-family: inherit;
    /* El calendario nativo sigue el tema de la app (clase), no el del sistema */
    color-scheme: dark;
}
:root.theme-light .act-hist-range input { color-scheme: light; }
.act-hist-range input:focus { outline: none; border-color: var(--primary-400); box-shadow: 0 0 0 3px var(--accent-tint); }

.act-hist-chips { display: flex; align-items: center; gap: 6px; }
.act-chip {
    font-size: var(--text-xs); font-weight: 500; color: var(--text-secondary);
    background: var(--surface-elevated); border: 1px solid var(--surface-border);
    padding: 6px 11px; border-radius: var(--radius-full); cursor: pointer; font-family: inherit;
    transition: border-color var(--transition-fast), color var(--transition-fast), background var(--transition-fast);
}
.act-chip:hover:not(:disabled) { border-color: var(--primary-400); color: var(--text-primary); }
.act-chip:disabled { opacity: 0.5; cursor: not-allowed; }
.act-chip-clear { color: var(--text-muted); background: transparent; }

.act-hist-table td { vertical-align: middle; }
.act-hist-date { display: block; font-size: var(--text-sm); font-weight: 600; color: var(--text-primary); white-space: nowrap; }
.act-hist-time { display: block; font-size: var(--text-xs); color: var(--text-muted); font-variant-numeric: tabular-nums; }
.act-hist-title { display: block; font-size: var(--text-sm); font-weight: 500; color: var(--text-primary); }
.act-hist-type { display: inline-flex; align-items: center; gap: 6px; font-size: var(--text-xs); color: var(--text-muted); margin-top: 2px; }
.act-hist-type i { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
.act-hist-firmas { display: inline-flex; align-items: center; gap: 5px; font-size: var(--text-sm); color: var(--text-secondary); font-variant-numeric: tabular-nums; }
.act-hist-type .badge { font-size: 10px; padding: 1px 6px; }
.act-hist-report { display: flex; align-items: center; justify-content: flex-end; gap: 2px; }
.act-hist-report .btn { color: var(--text-muted); }
.act-hist-report .btn:hover { color: var(--accent-text); background: var(--accent-tint); }
.act-hist-more {
    display: flex; align-items: center; justify-content: center; gap: var(--space-3);
    padding: var(--space-4); border-top: 1px solid var(--surface-border);
}
.act-hist-more-count { font-size: var(--text-xs); color: var(--text-muted); font-variant-numeric: tabular-nums; }

@media (max-width: 640px) {
    .act-hist-filters { padding: 0 var(--space-4) var(--space-4); }
    .act-hist-range { width: 100%; }
    .act-hist-range label { flex: 1; }
    .act-hist-range input { width: 100%; }
}

/* ── Modal: quién falta por firmar ───────────────────────────────────────── */
.act-pend { display: flex; flex-direction: column; gap: var(--space-5); }
.act-pend-lead { font-size: var(--text-sm); color: var(--text-secondary); margin: 0; }
.act-pend-lead b { color: var(--text-primary); font-variant-numeric: tabular-nums; }
.act-pend-group { display: flex; flex-direction: column; gap: var(--space-2); }
.act-pend-title { font-size: var(--text-xs); font-weight: 700; letter-spacing: .05em; text-transform: uppercase; color: var(--text-muted); margin: 0; }
.act-pend-hint { font-size: var(--text-xs); color: var(--text-muted); margin: 0; line-height: 1.5; }
.act-pend-list { display: flex; flex-direction: column; gap: var(--space-2); }
.act-pend-item { border: 1px solid var(--surface-border); border-radius: var(--radius-md); overflow: hidden; background: var(--surface-elevated); }
.act-pend-item.open { border-color: var(--primary-400); }
.act-pend-person {
    display: flex; align-items: center; gap: var(--space-3); width: 100%;
    padding: 10px 12px; background: transparent; border: none; cursor: pointer;
    color: inherit; font: inherit; text-align: left;
}
.act-pend-person:hover { background: var(--surface-hover); }
.act-pend-person:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
.act-pend-avatar {
    width: 30px; height: 30px; flex-shrink: 0; border-radius: 50%;
    background: var(--surface-hover); color: var(--text-secondary);
    display: flex; align-items: center; justify-content: center;
    font-size: 12px; font-weight: 600; text-transform: uppercase;
}
.act-pend-identity { display: flex; flex-direction: column; min-width: 0; flex: 1; }
.act-pend-name { font-size: var(--text-sm); font-weight: 500; color: var(--text-primary); }
.act-pend-role { font-size: var(--text-xs); color: var(--text-muted); }
.act-pend-cta { display: inline-flex; align-items: center; gap: 5px; font-size: var(--text-xs); color: var(--text-muted); flex-shrink: 0; }
.act-pend-cta .rot { transform: rotate(180deg); }
.act-pend-motivos {
    display: flex; flex-wrap: wrap; gap: 6px;
    padding: 10px 12px; border-top: 1px solid var(--surface-border); background: var(--surface-card);
}
.act-pend-ok {
    display: flex; align-items: center; gap: var(--space-2);
    font-size: var(--text-sm); color: var(--success-600, var(--success-500));
    background: rgba(34, 197, 94, 0.1); border: 1px solid rgba(34, 197, 94, 0.25);
    padding: 10px 12px; border-radius: var(--radius-md);
}
.act-pend-ausentes { display: flex; flex-wrap: wrap; gap: 6px; }
.act-pend-ausente {
    display: inline-flex; align-items: center; gap: 6px;
    font-size: var(--text-xs); color: var(--text-secondary);
    background: var(--surface-elevated); border: 1px solid var(--surface-border);
    padding: 5px 6px 5px 10px; border-radius: var(--radius-full);
}
.act-pend-ausente i { font-style: normal; color: var(--text-muted); }
.act-pend-ausente button {
    display: flex; align-items: center; justify-content: center;
    width: 18px; height: 18px; border-radius: 50%; border: none;
    background: var(--surface-hover); color: var(--text-muted); cursor: pointer;
}
.act-pend-ausente button:hover:not(:disabled) { background: var(--danger-500); color: #fff; }

/* ── Detalle de la actividad ─────────────────────────────────────────────── */
.ad { display: flex; flex-direction: column; gap: var(--space-6); }

/* Hero: el estado de firmas manda, igual que en la lista de hoy */
.ad-hero {
    display: grid; grid-template-columns: 3px minmax(215px, 250px) minmax(0, 1fr);
    gap: 0 var(--space-5); align-items: start;
    background: var(--surface-elevated); border: 1px solid var(--surface-border);
    border-radius: var(--radius-lg); overflow: hidden;
}
.ad-hero-rail { align-self: stretch; }
.ad-hero-body { padding: var(--space-4) 0 var(--space-4) var(--space-2); }
.ad-hero-top { display: flex; align-items: center; gap: var(--space-2); flex-wrap: wrap; margin-bottom: var(--space-2); }
.ad-hero-eyebrow { font-size: 10px; font-weight: 700; letter-spacing: .09em; text-transform: uppercase; color: var(--text-muted); }
.ad-hero-num { margin: 0; line-height: 1; font-variant-numeric: tabular-nums; }
.ad-hero-num b { font-size: 2rem; font-weight: 700; letter-spacing: -0.03em; color: var(--text-primary); }
.ad-hero-num span { font-size: 1.1rem; color: var(--text-muted); }
.ad-hero-bar { display: block; height: 5px; border-radius: var(--radius-full); background: var(--surface-border); overflow: hidden; margin: var(--space-3) 0 var(--space-2); }
.ad-hero-bar i { display: block; height: 100%; border-radius: inherit; background: var(--warning-500); transition: width var(--transition-normal); }
.ad-hero.done .ad-hero-bar i { background: var(--success-500); }
.ad-hero-note { margin: 0; font-size: var(--text-xs); color: var(--text-muted); line-height: 1.5; }
.ad-hero.done .ad-hero-note { color: var(--success-600, var(--success-500)); }

/* Ficha de datos: pares etiqueta/valor, sin cajas */
.ad-datos {
    display: grid; grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-3) var(--space-4); margin: 0;
    padding: var(--space-4) var(--space-4) var(--space-4) 0;
}
.ad-datos dt { font-size: 10px; font-weight: 700; letter-spacing: .09em; text-transform: uppercase; color: var(--text-muted); margin-bottom: 2px; }
.ad-datos dd { margin: 0; font-size: var(--text-sm); color: var(--text-primary); font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }

/* Secciones */
.ad-section { display: flex; flex-direction: column; gap: var(--space-3); }
.ad-section-title {
    display: flex; align-items: center; gap: var(--space-2); margin: 0;
    font-size: 10.5px; font-weight: 700; letter-spacing: .09em; text-transform: uppercase; color: var(--text-muted);
}
.ad-section-title::after { content: ''; flex: 1; height: 1px; background: var(--surface-border); }
.ad-section-flag {
    order: 1; text-transform: none; letter-spacing: 0; font-size: 10.5px; font-weight: 600;
    color: var(--warning-600, var(--warning-500));
}
.ad-empty { margin: 0; font-size: var(--text-sm); color: var(--text-muted); line-height: 1.55; }

.ad-registro { display: flex; flex-direction: column; gap: var(--space-3); }
.ad-tema { margin: 0; font-size: var(--text-sm); color: var(--text-primary); }
.ad-tema span { font-size: 10px; font-weight: 700; letter-spacing: .09em; text-transform: uppercase; color: var(--text-muted); margin-right: 6px; }
.ad-texto { margin: 0; font-size: var(--text-sm); color: var(--text-secondary); line-height: 1.6; white-space: pre-wrap; }
.ad-meta-linea { margin: 0; font-size: var(--text-xs); color: var(--text-muted); }
.ad-obs { display: flex; flex-direction: column; gap: 4px; }

.ad-chips-group { display: flex; flex-direction: column; gap: 5px; }
.ad-chips-label { font-size: 10px; font-weight: 700; letter-spacing: .09em; text-transform: uppercase; color: var(--text-muted); }
.ad-chips { display: flex; flex-wrap: wrap; gap: 5px; }
.ad-chip {
    font-size: var(--text-xs); color: var(--text-secondary);
    background: var(--surface-elevated); border: 1px solid var(--surface-border);
    padding: 4px 10px; border-radius: var(--radius-full);
}

/* Asistencia */
/* Sin scroll propio: el cuerpo del modal ya scrollea y dos barras anidadas
   hacen imposible llegar al final de la lista. */
.ad-lista {
    list-style: none; margin: 0; padding: 4px;
    display: flex; flex-direction: column; gap: 2px;
    border: 1px solid var(--surface-border); border-radius: var(--radius-md); background: var(--surface-bg);
}
.ad-persona { display: flex; align-items: center; gap: var(--space-3); padding: 7px 9px; border-radius: var(--radius-sm); }
.ad-persona:hover { background: var(--surface-hover); }
.ad-persona-avatar {
    width: 26px; height: 26px; flex-shrink: 0; border-radius: 50%;
    background: var(--surface-hover); color: var(--text-muted);
    display: flex; align-items: center; justify-content: center;
    font-size: 11px; font-weight: 600; text-transform: uppercase;
}
/* Quien firmó se marca en el avatar: la lista se lee de un vistazo */
.ad-persona.firmo .ad-persona-avatar { background: var(--accent-tint); color: var(--accent-text); }
.ad-persona-id { display: flex; flex-direction: column; min-width: 0; flex: 1; }
.ad-persona-nombre { font-size: var(--text-sm); color: var(--text-primary); display: inline-flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.ad-persona-cargo { font-size: var(--text-xs); color: var(--text-muted); }
.ad-persona-tag { font-size: 10px; color: var(--text-muted); background: var(--surface-hover); padding: 1px 6px; border-radius: var(--radius-full); }
.ad-firma { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
.ad-firma-hora { font-size: var(--text-xs); color: var(--success-600, var(--success-500)); font-weight: 600; font-variant-numeric: tabular-nums; }
.ad-firma-atraso { display: inline-flex; align-items: center; gap: 3px; font-size: 10px; color: var(--warning-600, var(--warning-500)); }
.ad-sin-firma { font-size: var(--text-xs); color: var(--text-muted); flex-shrink: 0; }

/* Permisos */
.ad-permisos { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--space-2); }
.ad-permiso {
    display: flex; align-items: center; justify-content: space-between; gap: var(--space-3);
    padding: 9px 12px; border-radius: var(--radius-md);
    background: var(--surface-elevated); border: 1px solid var(--surface-border);
    border-left: 3px solid var(--warning-500);
}
.ad-permiso.completo { border-left-color: var(--success-500); }
.ad-permiso-nombre { font-size: var(--text-sm); color: var(--text-primary); }
.ad-permiso-estado { display: inline-flex; align-items: center; gap: 5px; font-size: var(--text-xs); font-weight: 600; color: var(--warning-600, var(--warning-500)); }
.ad-permiso.completo .ad-permiso-estado { color: var(--success-600, var(--success-500)); }

.ad-bloqueo {
    display: flex; align-items: center; gap: var(--space-2); margin: 0;
    font-size: var(--text-xs); color: var(--warning-600, var(--warning-500));
    background: rgba(234, 179, 8, 0.1); border: 1px solid rgba(234, 179, 8, 0.25);
    padding: 9px 12px; border-radius: var(--radius-md);
}

/* Pie: reporte a la izquierda, acciones de la actividad a la derecha */
.ad-footer { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); width: 100%; flex-wrap: wrap; }
/* flex-wrap: con texto junto a los íconos, en una pantalla muy angosta
   "Descargar reporte" ya no cabe junto a "Ver reporte" — que baje de línea
   en vez de desbordar la página. */
.ad-footer-report { display: flex; align-items: center; gap: var(--space-1); flex-wrap: wrap; }
.ad-footer-report .btn { color: var(--text-muted); }
.ad-footer-report .btn:hover { color: var(--accent-text); background: var(--accent-tint); }
.ad-footer-main { display: flex; align-items: center; gap: var(--space-2); flex-wrap: wrap; }

@media (max-width: 640px) {
    .ad-hero { grid-template-columns: 3px minmax(0, 1fr); }
    .ad-datos { grid-column: 2 / -1; padding: 0 var(--space-4) var(--space-4) var(--space-2); }
    .ad-footer { justify-content: stretch; }
    .ad-footer-main { flex: 1; }
    .ad-footer-main .btn { flex: 1 1 auto; justify-content: center; }
}

/* ── Modales de asistencia y planificación ───────────────────────────────── */
.act-sign-note {
    font-size: var(--text-sm); color: var(--text-secondary); line-height: 1.55;
    background: var(--accent-tint); border-radius: var(--radius-md);
    padding: 10px 12px; margin: var(--space-4) 0 0;
}
.act-plan-item {
    border: 1px solid var(--surface-border); border-radius: var(--radius-md);
    background: var(--surface-elevated); padding: var(--space-4);
    margin-bottom: var(--space-4);
}
.act-plan-item-head {
    display: flex; align-items: center; gap: var(--space-3);
    padding-bottom: var(--space-3); margin-bottom: var(--space-4);
    border-bottom: 1px solid var(--surface-border);
}
.act-plan-item-type {
    width: 32px; height: 32px; flex-shrink: 0; border-radius: var(--radius-md); color: #fff;
    display: flex; align-items: center; justify-content: center;
}
.act-plan-item-copy { display: flex; flex-direction: column; min-width: 0; flex: 1; }
.act-plan-item-copy b { font-size: var(--text-sm); font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.act-plan-item-copy span { font-size: var(--text-xs); color: var(--text-muted); }
.act-plan-hint { font-size: var(--text-xs); color: var(--text-muted); line-height: 1.5; margin: 0 0 var(--space-2); }
`;
