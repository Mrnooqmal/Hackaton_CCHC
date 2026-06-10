import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import Header from '../components/Header';
import { useAuth } from '../context/AuthContext';
import { activitiesApi, documentsApi, incidentsApi, obrasApi, uploadsApi, workersApi, signatureRequestsApi, tenantsApi } from '../api/client';
import { LuArrowLeft, LuBuilding2, LuFileText, LuUsers, LuShieldAlert, LuPencil, LuUserPlus, LuClock, LuChevronUp, LuChevronDown, LuCircleCheck, LuDownload } from 'react-icons/lu';
import { FiUploadCloud, FiEye, FiAlertTriangle } from 'react-icons/fi';
import { Modal, Select, SegmentedControl } from '../components/ui';
import { DS44_ACT_ACTUALIZACIONES, DS44_ACT_DOCS, DS44_CHECK_DOCS, DS44_DO_PROCEDIMIENTOS, DS44_DO_CAPACITACIONES, DS44_DO_REGISTROS_GESTION, DS44_DO_EVENTOS, evalAplicabilidad, DS44_ONBOARDING_ITEMS, DS44_PHASE_LABELS, DS44_PLAN_DOCS, type Ds44DoContext, type Ds44DoElemento } from '../utils/ds44';
import FirmaAsistidaModal from '../components/FirmaAsistidaModal';
import type { SignatureRequest } from '../api/client';

interface Ds44Item {
  key: string;
  tipos: string[];
  titulo: string;
  estadoFirma?: string;
  documentId?: string;
  archivoSubido: boolean;
  document?: any;
}

interface DoItem {
  key: string;
  tipos: string[];
  titulo: string;
  descripcion: string;
  articulo: string;
  estadoFirma: string;
  documentId?: string;
  archivoSubido: boolean;
  document?: any;
}

export default function ObraDetalle() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { obraId } = useParams();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [loading, setLoading] = useState(true);
  const [obra, setObra] = useState<any | null>(null);
  const [trabajadores, setTrabajadores] = useState<any[]>([]);
  const [allWorkers, setAllWorkers] = useState<any[]>([]);
  const [documentosPrevencion, setDocumentosPrevencion] = useState<any[]>([]);
  const [incidentes, setIncidentes] = useState<any[]>([]);
  const [actividades, setActividades] = useState<any[]>([]);
  const [obraSignatureRequests, setObraSignatureRequests] = useState<SignatureRequest[]>([]);
  const [ds44Docs, setDs44Docs] = useState<Ds44Item[]>([]);
  const [obraDocs, setObraDocs] = useState<any[]>([]); // documentos clasificacion 'obra' (incluye procedimientos DO)
  const [tenantSize, setTenantSize] = useState<number | null>(null); // cantidadTrabajadores de la entidad (condicionales DO)
  const [firmaAsistidaOpen, setFirmaAsistidaOpen] = useState(false);
  const [firmaAsistidaWorkerId, setFirmaAsistidaWorkerId] = useState<string | undefined>(undefined);
  const [firmaAsistidaTipo, setFirmaAsistidaTipo] = useState<string | undefined>(undefined);
  // Modal inline de creacion DO (procedimiento/evento => documento; capacitacion => actividad)
  const [doCreateModal, setDoCreateModal] = useState<{ mode: 'documento' | 'actividad'; el: any } | null>(null);
  const [doCreateForm, setDoCreateForm] = useState<{ titulo: string; descripcion: string; fecha: string; relatorId: string; file: File | null }>({ titulo: '', descripcion: '', fecha: '', relatorId: '', file: null });
  const [doCreateSaving, setDoCreateSaving] = useState(false);
  const [doCreateError, setDoCreateError] = useState<string | null>(null);
  const [savingObraFlag, setSavingObraFlag] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0); // bump para recargar datos de la obra
  const [obraToast, setObraToast] = useState<string | null>(null); // confirmacion breve de acciones inline
  const [checkConsolidado, setCheckConsolidado] = useState<any | null>(null);
  const [medidas, setMedidas] = useState<any | null>(null); // read-model medidas correctivas (ACT)
  const [loadingMedidas, setLoadingMedidas] = useState(false);
  const [savingMedida, setSavingMedida] = useState<string | null>(null);
  // Cierre de investigacion Art. 71 (genera informe firmado)
  const [cerrarInvModal, setCerrarInvModal] = useState<{ incidentId: string; descripcion: string } | null>(null);
  const [cerrarInvPin, setCerrarInvPin] = useState('');
  const [cerrarInvSaving, setCerrarInvSaving] = useState(false);
  const [cerrarInvError, setCerrarInvError] = useState<string | null>(null);
  const [cerrarInvResult, setCerrarInvResult] = useState<{ token: string; hash: string } | null>(null);
  const [loadingCheck, setLoadingCheck] = useState(false);
  const [uploadingKey, setUploadingKey] = useState<string | null>(null);
  const [isDs44ModalOpen, setIsDs44ModalOpen] = useState(false);
  const [selectedDs44Doc, setSelectedDs44Doc] = useState<Ds44Item | null>(null);
  const [selectedDs44Detail, setSelectedDs44Detail] = useState<any | null>(null);
  const [selectedWorkerIds, setSelectedWorkerIds] = useState<string[]>([]);
  const [selectedExpiryDate, setSelectedExpiryDate] = useState('');
  const [expiryApplicable, setExpiryApplicable] = useState(true);
  const [ds44Loading, setDs44Loading] = useState(false);
  const [ds44Saving, setDs44Saving] = useState(false);
  const [ds44Previewing, setDs44Previewing] = useState(false);
  const [pendingDs44File, setPendingDs44File] = useState<File | null>(null);
  const [isSignatureModalOpen, setIsSignatureModalOpen] = useState(false);
  const [signatureModalDoc, setSignatureModalDoc] = useState<{ titulo: string; asignaciones: any[] } | null>(null);
  const [editData, setEditData] = useState<any | null>(null);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isWorkersModalOpen, setIsWorkersModalOpen] = useState(false);
  const [updatingWorkers, setUpdatingWorkers] = useState<string | null>(null);
  const [selectedUnassignedWorkerIds, setSelectedUnassignedWorkerIds] = useState<string[]>([]);

  // Fase 2 (DO/HACER) state — modal DO listo para conectar cuando se agregue lista de docs DO
  const [doDocs] = useState<DoItem[]>([]);
  const [activatingFaseDeming, setActivatingFaseDeming] = useState(false);
  const [selectedDoDoc] = useState<DoItem | null>(null);
  const [selectedDoDetail] = useState<any | null>(null);
  const [isDoModalOpen, setIsDoModalOpen] = useState(false);
  const [doLoading] = useState(false);
  const [doSaving, setDoSaving] = useState(false);
  const [pendingDoFile, setPendingDoFile] = useState<File | null>(null);
  const [doExpiryDate, setDoExpiryDate] = useState('');
  const [doExpiryNotApplicable, setDoExpiryNotApplicable] = useState(false);
  const [doWorkerIds, setDoWorkerIds] = useState<string[]>([]);
  const [doPreviewing, setDoPreviewing] = useState(false);
  const doFileInputRef = useRef<HTMLInputElement | null>(null);
  const autoAdvanceRef = useRef<string | null>(null); // fase desde la que ya se auto-avanzó
  // Panel DO: workers expandidos
  const [expandedWorkers, setExpandedWorkers] = useState<Set<string>>(new Set());
  const [planToast, setPlanToast] = useState(false);
  // Modal de onboarding post-asignación
  const [onboardingUploadModal, setOnboardingUploadModal] = useState<{ show: boolean; addedWorkers: any[] } | null>(null);
  const [bulkUploadingTipo, setBulkUploadingTipo] = useState<string | null>(null);
  const [bulkUploadDone, setBulkUploadDone] = useState<Record<string, boolean>>({});
  // Registro AT/EP export
  const [registroSignModal, setRegistroSignModal] = useState(false);
  const [exportingRegistro, setExportingRegistro] = useState(false);
  const [registroPin, setRegistroPin] = useState('');
  const [registroError, setRegistroError] = useState<string | null>(null);
  const [registroResult, setRegistroResult] = useState<{ documentId: string; token: string; hash: string } | null>(null);
  // Inline per-worker doc upload
  const [uploadingWorkerDoc, setUploadingWorkerDoc] = useState<string | null>(null); // `${workerId}:${tipo}`
  // Local override map so checklist updates immediately without full refetch

  const faseDeming = obra?.faseDeming || 'plan';
  const [selectedDemingPhase, setSelectedDemingPhase] = useState(faseDeming);

  const onboardingSummary = useMemo(() => {
    const activeWorkers = trabajadores.filter((worker) => worker.estado !== 'inactivo');
    if (!activeWorkers.length) {
      return { completed: 0, total: 0, progress: 0, byWorker: [] as any[] };
    }

    // Flujo secuencial por (persona, tipo): sin archivo (pendiente_asignar => Subir)
    // -> con archivo sin firmar (pendiente_firma => Firma asistida) -> firmado (completo).
    // "Completo" SOLO con firma real del trabajador.
    const docSigned = new Map<string, boolean>();
    const docHasFile = new Map<string, boolean>();
    documentosPrevencion.forEach((doc) => {
      const hasFile = Boolean(doc.s3Key || doc.archivoUrl);
      (doc.asignaciones || []).forEach((asig: any) => {
        const personaId = asig.personaId;
        if (!personaId || !doc.tipo) return;
        const key = `${personaId}:${doc.tipo}`;
        if (hasFile) docHasFile.set(key, true);
        if (asig.estado === 'firmado' || asig.fechaFirma) docSigned.set(key, true);
      });
    });

    const requestSigned = new Map<string, boolean>();
    const requestAssigned = new Map<string, boolean>();
    obraSignatureRequests.forEach((request) => {
      (request.trabajadores || []).forEach((trabajador) => {
        const workerId = trabajador.workerId;
        if (!workerId || !request.tipo) return;
        const key = `${workerId}:${request.tipo}`;
        requestAssigned.set(key, true);
        if (trabajador.firmado) requestSigned.set(key, true);
      });
    });

    let total = 0;
    let completed = 0;

    const byWorker = activeWorkers.map((worker) => {
      const workerId = worker.personaId;
      let workerTotal = 0;
      let workerCompleted = 0;
      const obraKey = obraId || '';
      const manualOverrides = obraKey ? (worker as any).onboardingDS44?.[obraKey]?.items || {} : {};

      // Capacitacion grupal: completa solo si el trabajador asistio y firmo.
      const hasCapacitacion = actividades.some(
        (act: any) => (act.obraId === obraId || !obraId) &&
          (act.tipo === 'CAPACITACION' || act.titulo?.toLowerCase().includes('capacitacion') || act.titulo?.toLowerCase().includes('capacitación')) &&
          (act.asistentes || []).some((a: any) => (a.personaId) === workerId && a.asistio !== false)
      );
      const hasCapacitacionProgramada = actividades.some(
        (act: any) => (act.obraId === obraId || !obraId) &&
          (act.tipo === 'CAPACITACION' || act.titulo?.toLowerCase().includes('capacitacion') || act.titulo?.toLowerCase().includes('capacitación'))
      );

      const itemDetail = DS44_ONBOARDING_ITEMS.map((item) => {
        const manualDone = Boolean(manualOverrides[item.tipo]);
        const key = `${workerId}:${item.tipo}`;

        let estado: 'pendiente_asignar' | 'pendiente_firma' | 'completo' = 'pendiente_asignar';

        if (item.kind === 'document') {
          if (docSigned.get(key)) estado = 'completo';
          else if (docHasFile.get(key)) estado = 'pendiente_firma';
          else estado = 'pendiente_asignar';
        } else if (item.kind === 'signature') {
          if (requestSigned.get(key)) estado = 'completo';
          else if (requestAssigned.get(key)) estado = 'pendiente_firma';
          else estado = 'pendiente_asignar';
        } else if (item.kind === 'actividad') {
          if (hasCapacitacion) estado = 'completo';
          else if (hasCapacitacionProgramada) estado = 'pendiente_firma';
          else estado = 'pendiente_asignar';
        }

        // Override manual persistido (firma en papel registrada previamente).
        if (manualDone) estado = 'completo';

        const done = estado === 'completo';
        workerTotal += 1;
        if (done) workerCompleted += 1;

        return { key: item.key, tipo: item.tipo, label: item.label, articulo: item.articulo, done, estado, kind: item.kind, actionLabel: item.actionLabel, actionRoute: item.actionRoute };
      });

      total += workerTotal;
      completed += workerCompleted;

      return {
        workerId,
        nombre: `${worker.nombre} ${worker.apellido || ''}`.trim(),
        cargo: worker.cargo || '',
        fechaIngreso: (worker.obraIds || []).length > 0 ? (worker.createdAt || null) : null,
        completed: workerCompleted,
        total: workerTotal,
        itemDetail
      };
    });

    const progress = total > 0 ? Math.round((completed / total) * 100) : 0;
    return { completed, total, progress, byWorker };
  }, [documentosPrevencion, obraSignatureRequests, trabajadores, actividades, obraId]);

  const getSignatureStats = (doc: any) => {
    // Prefer obraSignatureRequests (live data) over doc.asignaciones (may be absent in list responses)
    if (doc?.documentId) {
      const req = obraSignatureRequests.find(
        (r: any) => r.referenciaId === doc.documentId || r.documentId === doc.documentId
      );
      if (req) {
        return { firmadas: req.totalFirmados, total: req.totalRequeridos, asignaciones: req.trabajadores || [] };
      }
    }
    const asignaciones = doc?.asignaciones || [];
    const firmadas = asignaciones.filter((asignacion: any) => asignacion.estado === 'firmado' || asignacion.fechaFirma).length;
    return { firmadas, total: asignaciones.length, asignaciones };
  };

  // ── FASE DO (HACER) — elementos clasificados por naturaleza ───────────────────
  // El % de cumplimiento de la obra se calcula SOLO sobre procedimientos +
  // capacitaciones aplicables + registro maestro Art.72. NO sobre el onboarding
  // ni sobre eventos sobrevinientes. Gating por firma: un elemento con firmantes
  // asignados pendientes NO cuenta como completo hasta que todas las firmas esten.
  const doContext = useMemo<Ds44DoContext>(() => ({
    tamanoEntidad: tenantSize ?? trabajadores.filter((w) => w.estado !== 'inactivo').length,
    faenaCompartida: obra?.faenaCompartida,
    tieneMaquinaria: obra?.tieneMaquinaria,
    agentesFQB: obra?.agentesFQB,
  }), [tenantSize, trabajadores, obra]);

  // Estado de un elemento-documento con gating por firma.
  const estadoDocumento = (tipo: string): { document: any; estado: 'faltante' | 'pendiente_firma' | 'completo'; firmadas: number; totalFirmas: number } => {
    const document = obraDocs.find((d: any) => d.tipo === tipo);
    const archivoSubido = Boolean(document?.s3Key || document?.archivoUrl) || Boolean(document);
    const { firmadas, total } = getSignatureStats(document);
    let estado: 'faltante' | 'pendiente_firma' | 'completo';
    if (!archivoSubido) estado = 'faltante';
    else if (total > 0 && firmadas < total) estado = 'pendiente_firma';
    else estado = 'completo';
    return { document, estado, firmadas, totalFirmas: total };
  };

  // Estado de un elemento-capacitacion leido de ActivitiesTable.
  // "completo" requiere actividad ejecutada con asistentes firmados.
  const estadoCapacitacion = (el: Ds44DoElemento): { matches: any[]; estado: 'faltante' | 'pendiente_firma' | 'completo' } => {
    const matches = actividades.filter((a: any) => {
      if (!(el.actividadTipos || []).includes(a.tipo)) return false;
      // Vincula por subtipo (preciso) o, como respaldo, por titulo exacto
      // (el modal pre-llena el titulo con el del elemento) para que funcione
      // aunque el backend aun no persista el subtipo.
      if (el.subtipo) return a.subtipo === el.subtipo || a.titulo === el.titulo;
      return true;
    });
    const ejecutada = matches.some((a: any) => a.estado === 'completada' && (a.asistentes?.length || 0) > 0);
    const estado = ejecutada ? 'completo' : matches.length > 0 ? 'pendiente_firma' : 'faltante';
    return { matches, estado };
  };

  const doProcedimientos = useMemo(() =>
    DS44_DO_PROCEDIMIENTOS.map((el) => ({
      el,
      aplicabilidad: evalAplicabilidad(el.condicion, doContext),
      ...estadoDocumento(el.tipo),
    })), [doContext, obraDocs]);

  const doCapacitaciones = useMemo(() =>
    DS44_DO_CAPACITACIONES.map((el) => ({
      el,
      aplicabilidad: evalAplicabilidad(el.condicion, doContext),
      ...estadoCapacitacion(el),
    })), [doContext, actividades]);

  const doRegistros = useMemo(() =>
    DS44_DO_REGISTROS_GESTION
      .map((el) => ({ el, aplicabilidad: evalAplicabilidad(el.condicion, doContext) }))
      .filter((r) => r.aplicabilidad !== 'no_aplica'), [doContext]);

  const registroMaestroGenerado = useMemo(() =>
    obraDocs.some((d: any) => d.tipo === 'REGISTRO_AT_EP'), [obraDocs]);

  // % cumplimiento HACER: solo aplicables que cuentan + registro maestro.
  const doCumplimiento = useMemo(() => {
    const procCuenta = doProcedimientos.filter((p) => p.el.cuenta && p.aplicabilidad === 'aplica');
    const capCuenta = doCapacitaciones.filter((c) => c.el.cuenta && c.aplicabilidad === 'aplica');
    const total = procCuenta.length + capCuenta.length + 1; // +1 = registro maestro Art.72
    const completados =
      procCuenta.filter((p) => p.estado === 'completo').length +
      capCuenta.filter((c) => c.estado === 'completo').length +
      (registroMaestroGenerado ? 1 : 0);
    const progress = total > 0 ? Math.round((completados / total) * 100) : 0;
    return { total, completados, progress };
  }, [doProcedimientos, doCapacitaciones, registroMaestroGenerado]);

  const indicadores = useMemo(() => {
    const pendientesFirma = obraSignatureRequests
      .filter((r) => ['pendiente', 'en_proceso'].includes(r.estado))
      .reduce((total, r) => total + (r.totalRequeridos - r.totalFirmados), 0);
    const ds44Pendientes = faseDeming === 'hacer'
      ? Math.max(onboardingSummary.total - onboardingSummary.completed, 0)
      : ds44Docs.filter((doc) => !doc.archivoSubido).length;
    const mesActual = new Date().toISOString().slice(0, 7);
    const actividadesMes = actividades.filter((act) => act.fecha?.startsWith(mesActual)).length;
    const incidentesAbiertos = incidentes.filter((inc) => ['reportado', 'en_investigacion'].includes(inc.estado)).length;
    const ds44Label = faseDeming === 'hacer' ? 'Onboarding DS44 pendiente' : 'Documentos DS44 pendientes';

    return [
      { label: 'Firmas pendientes', value: String(pendientesFirma) },
      { label: ds44Label, value: String(ds44Pendientes) },
      { label: 'Actividades del mes', value: String(actividadesMes) },
      { label: 'Incidentes abiertos', value: String(incidentesAbiertos) }
    ];
  }, [obraSignatureRequests, ds44Docs, actividades, incidentes, faseDeming, onboardingSummary]);

  useEffect(() => {
    const loadData = async () => {
      if (!obraId) return;
      setLoading(true);
      try {
        const [obraRes, docsObraRes, docsPrevRes, workersRes, incidentsRes, activitiesRes] = await Promise.all([
          obrasApi.getById(obraId),
          documentsApi.list({ obraId, clasificacion: 'obra' } as any),
          documentsApi.list({ obraId, clasificacion: 'diario' } as any),
          workersApi.list(),
          incidentsApi.list(),
          activitiesApi.list()
        ]);

        const obraData = obraRes.success ? obraRes.data : null;
        setObra(obraData || null);

        const docsObra = docsObraRes.success && docsObraRes.data ? docsObraRes.data.documents || [] : [];
        const mappedDs44 = DS44_PLAN_DOCS.map((required) => {
          const existing = docsObra.find((doc: any) => required.tipos.includes(doc.tipo));
          const hasFile = Boolean(existing?.s3Key || existing?.archivoUrl);
          return {
            ...required,
            documentId: existing?.documentId,
            archivoSubido: hasFile,
            document: existing
          };
        });
        setDs44Docs(mappedDs44);
        setObraDocs(docsObra);


        const docsPrevRaw = docsPrevRes.success && docsPrevRes.data ? docsPrevRes.data.documents || [] : [];
        const ds44Types = new Set([...DS44_ONBOARDING_ITEMS.map(i => i.tipo), ...DS44_PLAN_DOCS.flatMap(req => req.tipos)]);
        const docsPrevFiltered = docsPrevRaw.filter((d: any) => d.clasificacion === 'diario' || (!ds44Types.has(d.tipo) && d.clasificacion !== 'obra' && d.clasificacion !== 'trabajador'));

        const uniqueDocsPrev: any[] = [];
        const seenIds = new Set();
        for (const doc of docsPrevFiltered) {
          const key = doc.tipo || doc.titulo;
          if (!seenIds.has(key)) {
            seenIds.add(key);
            uniqueDocsPrev.push(doc);
          }
        }
        setDocumentosPrevencion(uniqueDocsPrev);

        const workers = workersRes.success && workersRes.data ? workersRes.data : [];
        setAllWorkers(workers);
        const asignados = workers.filter((worker: any) => Array.isArray(worker.obraIds) && worker.obraIds.includes(obraId));
        setTrabajadores(asignados);

        const incItems = incidentsRes.success && incidentsRes.data ? incidentsRes.data : [];
        setIncidentes(incItems.filter((inc: any) => inc.obraId === obraId));

        const actItems = activitiesRes.success && activitiesRes.data ? activitiesRes.data.activities || [] : [];
        setActividades(actItems.filter((act: any) => act.obraId === obraId));

        const tenantId = obraData?.tenantId || localStorage.getItem('tenant_id') || '';
        const sigRes = await signatureRequestsApi.list({ empresaId: tenantId, obraId });
        if (sigRes.success && sigRes.data) {
          setObraSignatureRequests(sigRes.data.requests || []);
        }

        // Tamaño de la entidad (define CPHS/Delegado/Depto. Prev. en los condicionales DO).
        try {
          const tenantRes = await tenantsApi.get(tenantId);
          if (tenantRes.success && tenantRes.data) {
            setTenantSize((tenantRes.data as any).cantidadTrabajadores ?? null);
          }
        } catch { /* condicionales caeran a 'verificar' si no hay dato */ }
      } catch (error) {
        console.error('Error loading obra detail:', error);
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [obraId, reloadTick]);

  useEffect(() => {
    setSelectedDemingPhase(faseDeming);
  }, [faseDeming]);

  useEffect(() => {
    if (!obraToast) return;
    const t = setTimeout(() => setObraToast(null), 3500);
    return () => clearTimeout(t);
  }, [obraToast]);

  const reloadDocs = useCallback(async () => {
    if (!obraId) return;
    const tenantId = localStorage.getItem('tenant_id') || '';
    const [docsObraRes, sigRes] = await Promise.all([
      documentsApi.list({ obraId, clasificacion: 'obra' } as any),
      signatureRequestsApi.list({ empresaId: tenantId, obraId }),
    ]);
    if (docsObraRes.success && docsObraRes.data) {
      const docsObra = docsObraRes.data.documents || [];
      const mappedDs44 = DS44_PLAN_DOCS.map((required) => {
        const existing = docsObra.find((doc: any) => required.tipos.includes(doc.tipo));
        const hasFile = Boolean(existing?.s3Key || existing?.archivoUrl);
        return { ...required, documentId: existing?.documentId, archivoSubido: hasFile, document: existing };
      });
      setDs44Docs(mappedDs44);
      setObraDocs(docsObra);
    }
    if (sigRes.success && sigRes.data) {
      setObraSignatureRequests(sigRes.data.requests || []);
    }
  }, [obraId]);

  const reloadActividades = useCallback(async () => {
    const res = await activitiesApi.list();
    if (res.success && res.data) {
      setActividades((res.data.activities || []).filter((a: any) => a.obraId === obraId));
    }
  }, [obraId]);

  // Recarga completa de la obra (documentos, asignaciones, firmas, etc.).
  const reloadObraData = useCallback(() => setReloadTick((t) => t + 1), []);

  // Read-model de medidas correctivas (Art. 71) — insumo de la Fase ACT.
  const loadMedidas = useCallback(async () => {
    if (!obraId) return;
    setLoadingMedidas(true);
    try {
      const res = await obrasApi.getMedidasCorrectivas(obraId);
      if (res.success && res.data) setMedidas(res.data);
    } catch (err) {
      console.error('Error cargando medidas correctivas:', err);
    } finally {
      setLoadingMedidas(false);
    }
  }, [obraId]);

  // Cargar medidas al entrar a la fase ACT.
  useEffect(() => {
    if (selectedDemingPhase === 'actuar' && medidas === null) loadMedidas();
  }, [selectedDemingPhase, medidas, loadMedidas]);

  // Avanza el estado de una medida correctiva (seguimiento ACT).
  const avanzarMedida = async (incidentId: string, numero: string | number, estado: 'pendiente' | 'en_proceso' | 'completada' | 'verificada') => {
    const key = `${incidentId}:${numero}`;
    setSavingMedida(key);
    try {
      const res = await incidentsApi.updateMedidaEstado(incidentId, numero, estado);
      if (res.success) {
        await loadMedidas();
        setObraToast('Medida correctiva actualizada.');
      }
    } catch (err) {
      console.error('Error actualizando medida:', err);
    } finally {
      setSavingMedida(null);
    }
  };

  // Cierra la investigacion (Art. 71): genera y firma el informe, lo guarda como
  // documento de la obra y marca el incidente como cerrado.
  const handleCerrarInvestigacion = async () => {
    if (!cerrarInvModal || !obraId) return;
    const firmanteId = user?.personaId;
    if (!firmanteId) { setCerrarInvError('No se pudo identificar al firmante.'); return; }
    if (!cerrarInvPin || cerrarInvPin.length < 4) { setCerrarInvError('Ingresa tu PIN para firmar el informe.'); return; }
    setCerrarInvSaving(true);
    setCerrarInvError(null);
    try {
      const res = await obrasApi.cerrarInvestigacion(obraId, cerrarInvModal.incidentId, {
        firmante: { personaId: firmanteId, pin: cerrarInvPin },
        metodo: 'PIN',
      });
      if (!res.success || !res.data) {
        setCerrarInvError(res.error || 'No se pudo cerrar la investigación. Verifica tu PIN.');
        return;
      }
      setCerrarInvResult(res.data);
      setCerrarInvPin('');
      reloadObraData();
    } catch (err) {
      console.error('Error cerrando investigación:', err);
      setCerrarInvError('Error de conexión.');
    } finally {
      setCerrarInvSaving(false);
    }
  };

  // Persiste un flag de la obra (faenaCompartida/tieneMaquinaria/agentesFQB) desde
  // la micro-pregunta de aplicabilidad. Resuelve la visibilidad sin volver a preguntar.
  const handleSetObraFlag = async (flag: 'faenaCompartida' | 'tieneMaquinaria' | 'agentesFQB', value: boolean) => {
    if (!obraId) return;
    setSavingObraFlag(flag);
    try {
      const res = await obrasApi.update(obraId, { [flag]: value } as any);
      const updated = res.success ? (res.data?.obra || res.data) : null;
      setObra((prev: any) => ({ ...(prev || {}), ...(updated || {}), [flag]: value }));
    } catch (err) {
      console.error('Error guardando flag de obra:', err);
    } finally {
      setSavingObraFlag(null);
    }
  };

  // Abre el modal inline pre-rellenado con los datos del elemento DO.
  const openDoCreate = (mode: 'documento' | 'actividad', el: any) => {
    setDoCreateForm({
      titulo: el.titulo || '',
      descripcion: '',
      fecha: new Date().toISOString().slice(0, 10),
      relatorId: '',
      file: null,
    });
    setDoCreateError(null);
    setDoCreateModal({ mode, el });
  };

  // Crea inline el documento (procedimiento/evento) o la actividad (capacitacion).
  const submitDoCreate = async () => {
    if (!doCreateModal || !obraId || !obra) return;
    const { mode, el } = doCreateModal;
    if (!doCreateForm.titulo.trim()) { setDoCreateError('El título es obligatorio.'); return; }
    setDoCreateSaving(true);
    setDoCreateError(null);
    try {
      if (mode === 'actividad') {
        if (!doCreateForm.relatorId) { setDoCreateError('Selecciona un relator.'); setDoCreateSaving(false); return; }
        const tipoAct = el.activityTipo || 'CAPACITACION';
        const r = await activitiesApi.create({
          tipo: tipoAct,
          subtipo: tipoAct === 'CAPACITACION' ? el.subtipo : undefined,
          titulo: doCreateForm.titulo,
          fecha: doCreateForm.fecha, relatorId: doCreateForm.relatorId,
          obraId, tenantId: obra.tenantId,
        } as any);
        if (!r.success) { setDoCreateError(r.error || 'No se pudo crear la actividad.'); return; }
        await reloadActividades();
        setObraToast(el.activityTipo === 'SIMULACRO' ? 'Simulacro programado.' : 'Capacitación programada. Queda pendiente de firmas de asistencia.');
      } else {
        let s3Key: string | undefined;
        let archivoNombre: string | undefined;
        if (doCreateForm.file) {
          const up = await uploadsApi.getUploadUrl({
            fileName: doCreateForm.file.name, fileType: doCreateForm.file.type,
            fileSize: doCreateForm.file.size, categoria: 'obras', empresaId: obra.tenantId,
          });
          if (up.success && up.data) {
            await fetch(up.data.uploadUrl, { method: 'PUT', body: doCreateForm.file, headers: { 'Content-Type': doCreateForm.file.type } });
            await uploadsApi.confirmUpload({ fileKey: up.data.fileKey, fileName: doCreateForm.file.name, fileType: doCreateForm.file.type, fileSize: doCreateForm.file.size });
            s3Key = up.data.fileKey;
            archivoNombre = doCreateForm.file.name;
          }
        }
        const r = await documentsApi.create({
          obraId, tenantId: obra.tenantId, tipo: el.tipo, titulo: doCreateForm.titulo,
          descripcion: doCreateForm.descripcion, clasificacion: 'obra', fase: 'hacer',
          s3Key, archivoUrl: s3Key, archivoNombre,
          createdBy: user?.personaId, creatorName: user ? `${user.nombre} ${user.apellido || ''}`.trim() : undefined,
        } as any);
        if (!r.success) { setDoCreateError(r.error || 'No se pudo crear el documento.'); return; }
        await reloadDocs();
        setObraToast('Documento creado.');
      }
      setDoCreateModal(null);
    } catch (err) {
      console.error('Error creando elemento DO:', err);
      setDoCreateError('Error de conexión.');
    } finally {
      setDoCreateSaving(false);
    }
  };

  // Mapea la condicion del elemento al flag de obra + texto de micro-pregunta.
  const condicionFlag = (cond: string): { flag: 'faenaCompartida' | 'tieneMaquinaria' | 'agentesFQB'; q: string } | null => {
    if (cond === 'faena_compartida') return { flag: 'faenaCompartida', q: '¿Esta obra comparte sitio con otra entidad?' };
    if (cond === 'tiene_maquinaria') return { flag: 'tieneMaquinaria', q: '¿Hay máquinas/herramientas motrices?' };
    if (cond === 'agentes_fqb') return { flag: 'agentesFQB', q: '¿Existen agentes físicos/químicos/biológicos?' };
    return null;
  };

  const loadCheckConsolidado = useCallback(async () => {
    if (!obraId) return;
    setLoadingCheck(true);
    try {
      const year = new Date().getFullYear();
      const res = await obrasApi.getCheckConsolidado(obraId, { desde: `${year}-01-01`, hasta: `${year}-12-31` });
      if (res.success && res.data) setCheckConsolidado(res.data);
    } catch (err) {
      console.error('Error cargando consolidado CHECK:', err);
    } finally {
      setLoadingCheck(false);
    }
  }, [obraId]);

  const handleActivarFaseHacer = useCallback(async () => {
    if (!obraId) return;
    setActivatingFaseDeming(true);
    try {
      const res = await obrasApi.avanzarFaseDeming(obraId);
      if (res.success && res.data?.obra) {
        setObra(res.data.obra);
        await reloadDocs();
        // Toast de 3s: PLAN completado
        setPlanToast(true);
        setTimeout(() => setPlanToast(false), 3000);
      }
    } catch (err) {
      console.error('Error activando fase HACER:', err);
    } finally {
      setActivatingFaseDeming(false);
    }
  }, [obraId, reloadDocs]);

  // Avance manual de fase del ciclo Deming (HACER→VERIFICAR, VERIFICAR→ACTUAR).
  // A diferencia de PLAN (auto), estas fases las cierra explícitamente el gestor.
  const handleAvanzarFaseDeming = useCallback(async () => {
    if (!obraId) return;
    setActivatingFaseDeming(true);
    try {
      const res = await obrasApi.avanzarFaseDeming(obraId);
      if (res.success && res.data?.obra) {
        setObra(res.data.obra);
        await reloadDocs();
        setObraToast('Fase completada. Avanzaste a la siguiente fase del ciclo.');
      }
    } catch (err) {
      console.error('Error avanzando fase Deming:', err);
    } finally {
      setActivatingFaseDeming(false);
    }
  }, [obraId, reloadDocs]);


  const handleDoFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setPendingDoFile(file);
    if (event.target) event.target.value = '';
  };

  const handleSaveDoChanges = async () => {
    if (!selectedDoDoc || !obraId) return;
    if (!doExpiryNotApplicable && !doExpiryDate) {
      alert('Selecciona una fecha de vencimiento para el documento.');
      return;
    }
    if (!selectedDoDoc.documentId && !pendingDoFile) {
      alert('Debes seleccionar un archivo antes de guardar.');
      return;
    }

    const expiryValue = doExpiryNotApplicable ? null : doExpiryDate;
    setDoSaving(true);
    try {
      let fileKey = selectedDoDetail?.s3Key || selectedDoDetail?.archivoUrl || null;
      let fileName = selectedDoDetail?.archivoNombre || null;

      if (pendingDoFile) {
        const uploadUrlRes = await uploadsApi.getUploadUrl({
          fileName: pendingDoFile.name,
          fileType: pendingDoFile.type,
          fileSize: pendingDoFile.size,
          categoria: 'obras',
          empresaId: obra?.tenantId
        });
        if (!uploadUrlRes.success || !uploadUrlRes.data) throw new Error('Error al obtener URL de subida');
        const uploadResult = await fetch(uploadUrlRes.data.uploadUrl, {
          method: 'PUT',
          body: pendingDoFile,
          headers: { 'Content-Type': pendingDoFile.type }
        });
        if (!uploadResult.ok) throw new Error('Error al subir archivo');
        fileKey = uploadUrlRes.data.fileKey;
        fileName = pendingDoFile.name;
        await uploadsApi.confirmUpload({ fileKey, fileName: pendingDoFile.name, fileType: pendingDoFile.type, fileSize: pendingDoFile.size });
      }

      let documentId = selectedDoDoc.documentId;
      if (documentId) {
        await documentsApi.update(documentId, { s3Key: fileKey, archivoUrl: fileKey, archivoNombre: fileName, fechaCaducidad: expiryValue } as any);
      } else {
        const createRes = await documentsApi.create({
          obraId,
          clasificacion: 'obra',
          fase: faseDeming,
          tipo: selectedDoDoc.tipos[0],
          obligatorio: true,
          titulo: selectedDoDoc.titulo,
          archivoUrl: fileKey,
          archivoNombre: fileName,
          fechaCaducidad: expiryValue,
          createdBy: user?.personaId,
          creatorName: user ? `${user.nombre} ${user.apellido || ''}`.trim() : undefined
        } as any);
        documentId = (createRes as any)?.data?.documentId || documentId;
      }

      if (documentId && doWorkerIds.length > 0) {
        await documentsApi.assign(documentId, {
          workerIds: doWorkerIds,
          personaIds: doWorkerIds,
          fechaLimite: expiryValue,
          notificar: true,
          replace: true,
          assignedBy: user?.personaId,
          assignerName: user ? `${user.nombre} ${user.apellido || ''}`.trim() : undefined
        } as any);
      }

      await reloadDocs();
      setPendingDoFile(null);
      setIsDoModalOpen(false);
    } catch (error) {
      console.error('Error guardando documento DO:', error);
    } finally {
      setDoSaving(false);
    }
  };

  const handlePreviewDoDocument = async () => {
    const fileKey = selectedDoDetail?.s3Key || selectedDoDetail?.archivoUrl;
    if (!fileKey) return;
    setDoPreviewing(true);
    try {
      const res = await uploadsApi.getDownloadUrl(fileKey);
      if (res.success && res.data?.downloadUrl) window.open(res.data.downloadUrl, '_blank');
    } catch (error) {
      console.error('Error abriendo documento DO:', error);
    } finally {
      setDoPreviewing(false);
    }
  };

  const handleBulkOnboardingUpload = async (tipo: string, file: File, workers: any[]) => {
    if (!obraId || !obra) return;
    setBulkUploadingTipo(tipo);
    try {
      const uploadRes = await uploadsApi.getUploadUrl({
        fileName: file.name, fileType: file.type, fileSize: file.size,
        categoria: 'obras', empresaId: obra.tenantId
      });
      if (!uploadRes.success || !uploadRes.data) throw new Error('Sin URL de subida');
      await fetch(uploadRes.data.uploadUrl, { method: 'PUT', body: file, headers: { 'Content-Type': file.type } });
      const fileKey = uploadRes.data.fileKey;
      await uploadsApi.confirmUpload({ fileKey, fileName: file.name, fileType: file.type, fileSize: file.size });

      // Actualizar el documento de cada worker para este tipo
      for (const worker of workers) {
        const workerId = worker.personaId;
        const docsRes = await documentsApi.list({ obraId, workerId } as any);
        if (docsRes.success && docsRes.data) {
          const workerDocs = docsRes.data.documents || [];
          const targetDoc = workerDocs.find((d: any) =>
            d.tipo === tipo &&
            (d.asignaciones || []).some((a: any) => (a.personaId) === workerId)
          );
          if (targetDoc) {
            // Update file + mark the worker's asignacion as firmado so checklist reflects it
            const updatedAsignaciones = (targetDoc.asignaciones || []).map((a: any) =>
              (a.personaId) === workerId
                ? { ...a, estado: 'firmado', fechaFirma: new Date().toISOString() }
                : a
            );
            await documentsApi.update(targetDoc.documentId, {
              s3Key: fileKey,
              archivoUrl: fileKey,
              archivoNombre: file.name,
              asignaciones: updatedAsignaciones
            } as any);
          }
        }
      }
      setBulkUploadDone(prev => ({ ...prev, [tipo]: true }));
    } catch (err) {
      console.error('Error en carga masiva de onboarding:', err);
    } finally {
      setBulkUploadingTipo(null);
    }
  };

  const generateRegistroATHTML = () => {
    const fecha = new Date().toLocaleDateString('es-CL', { year: 'numeric', month: 'long', day: 'numeric' });
    const abiertos = incidentes.filter(i => ['reportado', 'en_investigacion'].includes((i as any).estado));
    const cerrados = incidentes.filter(i => !['reportado', 'en_investigacion'].includes((i as any).estado));
    const rows = incidentes.map((inc: any) => `
      <tr>
        <td>${inc.fecha ? new Date(inc.fecha).toLocaleDateString('es-CL') : '-'}</td>
        <td>${inc.tipo || '-'}</td>
        <td>${inc.descripcion || inc.titulo || '-'}</td>
        <td>${inc.trabajadorAfectado || inc.personaAfectada || '-'}</td>
        <td><span class="badge-${inc.estado === 'cerrado' ? 'ok' : 'warn'}">${inc.estado || '-'}</span></td>
        <td>${inc.responsable || inc.creadoPor || '-'}</td>
      </tr>`).join('');

    return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>Registro AT/EP/Incidentes Peligrosos — ${obra?.nombre}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Segoe UI', Arial, sans-serif; color: #1a1a2e; font-size: 12px; padding: 32px; }
    .header { text-align: center; border-bottom: 3px solid #1a1a2e; padding-bottom: 16px; margin-bottom: 24px; }
    .header h1 { font-size: 15px; font-weight: 700; margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.04em; }
    .header .subtitle { font-size: 11px; color: #555; margin-bottom: 2px; }
    .meta-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 20px; }
    .meta-card { border: 1px solid #ddd; padding: 10px 12px; border-radius: 6px; }
    .meta-label { font-size: 9px; text-transform: uppercase; color: #888; letter-spacing: 0.06em; margin-bottom: 2px; }
    .meta-value { font-size: 16px; font-weight: 700; color: #1a1a2e; }
    .section-title { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.07em; color: #555; margin: 16px 0 8px; padding-bottom: 4px; border-bottom: 1px solid #eee; }
    table { width: 100%; border-collapse: collapse; font-size: 11px; }
    th { background: #1a1a2e; color: #fff; padding: 8px 10px; text-align: left; font-weight: 600; font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; }
    td { padding: 7px 10px; border-bottom: 1px solid #f0f0f0; vertical-align: top; }
    tr:nth-child(even) td { background: #fafafa; }
    .badge-ok { background: #d1fae5; color: #065f46; padding: 2px 8px; border-radius: 12px; font-size: 10px; font-weight: 600; }
    .badge-warn { background: #fef3c7; color: #92400e; padding: 2px 8px; border-radius: 12px; font-size: 10px; font-weight: 600; }
    .empty { text-align: center; color: #aaa; padding: 24px; font-style: italic; }
    .signatures { display: grid; grid-template-columns: 1fr 1fr; gap: 48px; margin-top: 48px; }
    .sign-box { border-top: 1px solid #333; padding-top: 8px; text-align: center; }
    .sign-name { font-weight: 600; font-size: 12px; }
    .sign-role { font-size: 10px; color: #888; }
    .legal-note { margin-top: 24px; font-size: 9px; color: #aaa; border-top: 1px solid #eee; padding-top: 8px; text-align: center; }
    @media print { body { padding: 20px; } }
  </style>
</head>
<body>
  <div class="header">
    <h1>Registro de Accidentes del Trabajo, Enfermedades Profesionales e Incidentes Peligrosos</h1>
    <p class="subtitle">Arts. 72 y 73 — Decreto Supremo N°44/2024 — Ministerio de Salud</p>
    <p class="subtitle">Generado: ${fecha}</p>
  </div>

  <div class="meta-grid">
    <div class="meta-card"><div class="meta-label">Obra</div><div class="meta-value" style="font-size:13px">${obra?.nombre || '-'}</div></div>
    <div class="meta-card"><div class="meta-label">Total incidentes</div><div class="meta-value">${incidentes.length}</div></div>
    <div class="meta-card"><div class="meta-label">Abiertos</div><div class="meta-value" style="color:#d97706">${abiertos.length}</div></div>
    <div class="meta-card"><div class="meta-label">Cerrados</div><div class="meta-value" style="color:#059669">${cerrados.length}</div></div>
  </div>

  <div class="section-title">Detalle de incidentes registrados</div>
  ${incidentes.length === 0
        ? '<p class="empty">No se han registrado incidentes para esta obra.</p>'
        : `<table>
        <thead><tr>
          <th>Fecha</th><th>Tipo</th><th>Descripci&oacute;n</th><th>Afectado</th><th>Estado</th><th>Responsable</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>`
      }

  <div class="signatures">
    <div class="sign-box">
      <div style="height:48px"></div>
      <div class="sign-name">${user ? `${user.nombre} ${user.apellido || ''}`.trim() : 'Prevencionista'}</div>
      <div class="sign-role">Prevencionista / Responsable SST</div>
    </div>
    <div class="sign-box">
      <div style="height:48px"></div>
      <div class="sign-name">Jefe de Obra</div>
      <div class="sign-role">Revisado y validado</div>
    </div>
  </div>

  <p class="legal-note">Documento generado por PrevencionApp &bull; ${obra?.nombre} &bull; Cumplimiento DS44 Arts. 72-73</p>
  <script>window.onload = () => window.print();</script>
</body>
</html>`;
  };

  const handleExportRegistroAT = async () => {
    if (!obraId) return;
    const firmanteId = user?.personaId;
    if (!firmanteId) {
      setRegistroError('No se pudo identificar al firmante.');
      return;
    }
    if (!registroPin || registroPin.length < 4) {
      setRegistroError('Ingresa tu PIN para firmar el registro.');
      return;
    }
    setRegistroError(null);
    setExportingRegistro(true);
    try {
      // El backend consolida incidentes+actividades+ indicadores, firma via
      // FirmaService (firma real, no decorativa) y persiste el snapshot inmutable
      // con hash verificable. El periodo por defecto cubre el anio en curso.
      const year = new Date().getFullYear();
      const res = await obrasApi.generarRegistroATEP(obraId, {
        periodo: { desde: `${year}-01-01`, hasta: `${year}-12-31` },
        firmante: { personaId: firmanteId, pin: registroPin },
        metodo: 'PIN',
      });

      if (!res.success || !res.data) {
        setRegistroError(res.error || 'No se pudo generar el registro. Verifica tu PIN.');
        return;
      }

      setRegistroResult(res.data);
      setRegistroPin('');

      // Vista imprimible del snapshot retornado (solo presentacion).
      const html = generateRegistroATHTML();
      const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    } catch (err) {
      console.error('Error exportando Registro AT/EP:', err);
      setRegistroError('Error de conexion al generar el registro.');
    } finally {
      setExportingRegistro(false);
    }
  };



  const handleInlineWorkerUpload = async (workerId: string, tipo: string, file: File) => {
    if (!obraId || !obra) return;
    const key = `${workerId}:${tipo}`;
    setUploadingWorkerDoc(key);
    try {
      const uploadRes = await uploadsApi.getUploadUrl({
        fileName: file.name, fileType: file.type, fileSize: file.size,
        categoria: 'obras', empresaId: obra.tenantId
      });
      if (!uploadRes.success || !uploadRes.data) throw new Error('Sin URL de subida');
      await fetch(uploadRes.data.uploadUrl, { method: 'PUT', body: file, headers: { 'Content-Type': file.type } });
      const fileKey = uploadRes.data.fileKey;
      await uploadsApi.confirmUpload({ fileKey, fileName: file.name, fileType: file.type, fileSize: file.size });

      // Find and update the worker's specific doc record
      const docsRes = await documentsApi.list({ obraId, workerId } as any);
      if (docsRes.success && docsRes.data) {
        const workerDocs = docsRes.data.documents || [];
        const targetDoc = workerDocs.find((d: any) =>
          d.tipo === tipo &&
          (d.asignaciones || []).some((a: any) => (a.personaId) === workerId)
        );
        if (targetDoc) {
          // Adjuntar el archivo. NO marca firmado: la asignacion queda 'pendiente'
          // hasta que el trabajador firme (firma cruzada via firma asistida).
          await documentsApi.update(targetDoc.documentId, {
            s3Key: fileKey, archivoUrl: fileKey, archivoNombre: file.name
          } as any);
        }
      }
      reloadObraData();
    } catch (err) {
      console.error('Error subiendo doc de onboarding:', err);
    } finally {
      setUploadingWorkerDoc(null);
    }
  };


  const toggleExpandWorker = (workerId: string) => {
    setExpandedWorkers((prev) => {
      const next = new Set(prev);
      if (next.has(workerId)) next.delete(workerId); else next.add(workerId);
      return next;
    });
  };

  const getDocExpiryDate = (doc: any) => {
    if (!doc) return null;
    if (doc.fechaCaducidad) return doc.fechaCaducidad;
    const fechas = (doc.asignaciones || [])
      .map((asignacion: any) => asignacion.fechaLimite)
      .filter(Boolean)
      .map((fecha: string) => new Date(fecha))
      .filter((fecha: Date) => !Number.isNaN(fecha.getTime()));
    if (fechas.length === 0) return null;
    const earliest = fechas.reduce((min: Date, current: Date) => (current < min ? current : min), fechas[0]);
    return earliest.toISOString();
  };

  const formatDate = (value?: string | null) => {
    if (!value) return 'No aplica';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleDateString('es-CL');
  };

  const toDateInputValue = (value?: string | null) => {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : '';
    }
    return date.toISOString().slice(0, 10);
  };

  const openDs44Modal = async (doc: Ds44Item) => {
    setSelectedDs44Doc(doc);
    setSelectedDs44Detail(doc.document || null);
    setSelectedWorkerIds((doc.document?.asignaciones || []).map((a: any) => a.personaId || a.workerId).filter(Boolean));
    const docExpiry = getDocExpiryDate(doc.document);
    setSelectedExpiryDate(toDateInputValue(docExpiry));
    setExpiryApplicable(Boolean(!doc.document || docExpiry));
    setPendingDs44File(null);
    setIsDs44ModalOpen(true);

    if (doc.documentId) {
      setDs44Loading(true);
      try {
        const res = await documentsApi.get(doc.documentId);
        if (res.success && res.data) {
          setSelectedDs44Detail(res.data);
          setSelectedWorkerIds((res.data.asignaciones || []).map((a: any) => a.personaId || a.workerId).filter(Boolean));
          const fetchedExpiry = getDocExpiryDate(res.data);
          setSelectedExpiryDate(toDateInputValue(fetchedExpiry));
          setExpiryApplicable(Boolean(fetchedExpiry));
        }
      } catch (error) {
        console.error('Error loading DS44 document:', error);
      } finally {
        setDs44Loading(false);
      }
    }
  };

  const handleDs44FileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setPendingDs44File(file);
    if (event.target) {
      event.target.value = '';
    }
  };

  const handleSaveDs44Changes = async () => {
    if (!selectedDs44Doc || !obraId) return;

    if (expiryApplicable && !selectedExpiryDate) {
      alert('Selecciona una fecha de caducidad para el documento.');
      return;
    }

    const expiryValue = expiryApplicable ? selectedExpiryDate : null;
    const existingSignerIds = (selectedDs44Detail?.asignaciones || []).map((asignacion: any) => asignacion.personaId || asignacion.workerId);
    const targetSignerIds = selectedWorkerIds.length > 0 ? selectedWorkerIds : existingSignerIds;

    if (!selectedDs44Doc.documentId && !pendingDs44File) {
      alert('Debes seleccionar un archivo antes de guardar.');
      return;
    }

    setUploadingKey(selectedDs44Doc.key);
    setDs44Saving(true);

    try {
      let fileKey = selectedDs44Detail?.s3Key || selectedDs44Detail?.archivoUrl || null;
      let fileName = selectedDs44Detail?.archivoNombre || null;

      if (pendingDs44File) {
        const uploadUrlRes = await uploadsApi.getUploadUrl({
          fileName: pendingDs44File.name,
          fileType: pendingDs44File.type,
          fileSize: pendingDs44File.size,
          categoria: 'obras',
          empresaId: obra?.tenantId
        });

        if (!uploadUrlRes.success || !uploadUrlRes.data) {
          throw new Error(uploadUrlRes.error || 'Error al obtener URL de subida');
        }

        const uploadResult = await fetch(uploadUrlRes.data.uploadUrl, {
          method: 'PUT',
          body: pendingDs44File,
          headers: { 'Content-Type': pendingDs44File.type }
        });

        if (!uploadResult.ok) {
          throw new Error('Error al subir archivo');
        }

        fileKey = uploadUrlRes.data.fileKey;
        fileName = pendingDs44File.name;
        await uploadsApi.confirmUpload({
          fileKey,
          fileName: pendingDs44File.name,
          fileType: pendingDs44File.type,
          fileSize: pendingDs44File.size
        });
      }

      let documentId = selectedDs44Doc.documentId;
      if (documentId) {
        await documentsApi.update(documentId, {
          s3Key: fileKey,
          archivoUrl: fileKey,
          archivoNombre: fileName,
          fechaCaducidad: expiryValue
        } as any);
      } else {
        const createRes = await documentsApi.create({
          obraId,
          clasificacion: 'obra',
          fase: 'plan',
          tipo: selectedDs44Doc.tipos[0],
          obligatorio: true,
          titulo: selectedDs44Doc.titulo,
          archivoUrl: fileKey,
          archivoNombre: fileName,
          fechaCaducidad: expiryValue,
          createdBy: user?.personaId,
          creatorName: user ? `${user.nombre} ${user.apellido || ''}`.trim() : undefined
        } as any);
        documentId = (createRes as any)?.data?.documentId || (createRes as any)?.data?.id || documentId;
      }

      if (documentId && targetSignerIds.length > 0) {
        await documentsApi.assign(documentId, {
          workerIds: targetSignerIds,
          personaIds: targetSignerIds,
          fechaLimite: expiryValue,
          notificar: true,
          replace: true,
          assignedBy: user?.personaId,
          assignerName: user ? `${user.nombre} ${user.apellido || ''}`.trim() : undefined
        } as any);

        // Also create a SignatureRequest so workers see it in "Mis Firmas".
        // Evita duplicados: solo crea si no existe ya una solicitud activa para este documento.
        try {
          const yaExiste = obraSignatureRequests.some(
            (r: any) => (r.referenciaId === documentId || r.documentId === documentId)
              && ['pendiente', 'en_proceso'].includes(r.estado)
          );
          if (!yaExiste) {
            const docTitle = selectedDs44Doc.titulo || 'Documento DS44';
            const docAttachments = fileKey ? [{
              nombre: fileName || docTitle,
              url: fileKey,
              tipo: 'application/pdf',
              tamaño: pendingDs44File?.size || 0
            }] : [];

            await signatureRequestsApi.create({
              tipo: 'DOCUMENTO',
              // El título es el nombre del documento; el backend ya antepone "Firma requerida:"
              // al notificar (evita el doble prefijo "Firma requerida: Firma requerida:").
              titulo: docTitle,
              descripcion: `Se requiere su firma para el documento DS44 "${docTitle}" de la obra.`,
              documentos: docAttachments,
              trabajadoresIds: targetSignerIds,
              solicitanteId: user?.personaId || '',
              fechaLimite: expiryValue || undefined,
              empresaId: obra?.tenantId,
              obraId,
              referenciaId: documentId,
              referenciaTipo: 'document',
              documentId,
            } as any);
          }
        } catch (sigReqError) {
          console.warn('No se pudo crear solicitud de firma (los trabajadores podrían no ver la firma pendiente):', sigReqError);
        }
      }

      await reloadDocs();

      if (documentId) {
        const updatedDoc = await documentsApi.get(documentId);
        if (updatedDoc.success && updatedDoc.data) {
          setSelectedDs44Detail(updatedDoc.data);
          setSelectedDs44Doc((prev) => prev ? { ...prev, documentId } : prev);
          const updatedExpiry = getDocExpiryDate(updatedDoc.data);
          setSelectedExpiryDate(toDateInputValue(updatedExpiry));
          setExpiryApplicable(Boolean(updatedExpiry));
        }
      }

      setPendingDs44File(null);
      setIsDs44ModalOpen(false);
    } catch (error) {
      console.error('Error updating documento DS44:', error);
    } finally {
      setUploadingKey(null);
      setDs44Saving(false);
    }
  };

  const toggleWorkerSelection = (workerId: string) => {
    setSelectedWorkerIds((prev) =>
      prev.includes(workerId) ? prev.filter((id) => id !== workerId) : [...prev, workerId]
    );
  };

  const handlePreviewDocumentFromCard = async (doc: Ds44Item) => {
    const fileKey = doc.document?.s3Key || doc.document?.archivoUrl;
    if (!fileKey) return;
    setDs44Previewing(true);
    try {
      const res = await uploadsApi.getDownloadUrl(fileKey);
      if (res.success && res.data?.downloadUrl) {
        window.open(res.data.downloadUrl, '_blank');
      }
    } catch (error) {
      console.error('Error opening document:', error);
    } finally {
      setDs44Previewing(false);
    }
  };

  const handlePreviewDocument = async () => {
    const fileKey = selectedDs44Detail?.s3Key || selectedDs44Detail?.archivoUrl;
    if (!fileKey) return;
    setDs44Previewing(true);
    try {
      const res = await uploadsApi.getDownloadUrl(fileKey);
      if (res.success && res.data?.downloadUrl) {
        window.open(res.data.downloadUrl, '_blank');
      }
    } catch (error) {
      console.error('Error opening document:', error);
    } finally {
      setDs44Previewing(false);
    }
  };

  const openSignatureModal = (doc: Ds44Item) => {
    const stats = getSignatureStats(doc.document);
    setSignatureModalDoc({ titulo: doc.titulo, asignaciones: stats.asignaciones || [] });
    setIsSignatureModalOpen(true);
  };

  // Gating por firma: un documento de fase cuenta como COMPLETO solo si esta
  // subido Y todas sus firmas asignadas estan hechas. Si tiene firmantes
  // pendientes, NO avanza el % de la fase hasta que todos firmen.
  const docFaseCompleto = (doc: any) => {
    if (!doc.archivoSubido) return false;
    const { firmadas, total } = getSignatureStats(doc.document);
    return total === 0 || firmadas === total;
  };

  const documentosPendientes = ds44Docs.filter((doc) => !doc.archivoSubido);
  const documentosPendientesFirma = ds44Docs.filter((doc) => {
    if (!doc.archivoSubido) return false;
    const { firmadas, total } = getSignatureStats(doc.document);
    return total > 0 && firmadas < total;
  });
  const documentosVencidos = ds44Docs.filter((doc) => {
    const fechaCaducidad = getDocExpiryDate(doc.document);
    if (!fechaCaducidad) return false;
    return new Date(fechaCaducidad) < new Date();
  });
  const ds44Total = ds44Docs.length;
  const ds44Uploaded = ds44Docs.filter(docFaseCompleto).length; // completos (subido + firmado)
  const ds44Progress = ds44Total > 0 ? Math.round((ds44Uploaded / ds44Total) * 100) : 0;
  const documentosPendientesTitulos = documentosPendientes.map((doc) => doc.titulo);
  const inactiveWorkers = trabajadores.filter((worker) => worker.estado === 'inactivo');
  const activeWorkers = trabajadores.filter((worker) => worker.estado !== 'inactivo');


  // PLAN completo: todos los documentos subidos Y firmados (gating por firma).
  const planCompleto = ds44Docs.length > 0 && ds44Docs.every(docFaseCompleto);

  // DO completo: el cumplimiento de la obra (procedimientos + capacitaciones
  // aplicables + registro maestro) llegó al 100%.
  const doCompleto = doCumplimiento.total > 0 && doCumplimiento.progress === 100;

  // CHECK completo: todos los documentos CHECK obligatorios aplicables están registrados.
  const checkCompleto = DS44_CHECK_DOCS
    .filter((d) => d.obligatorio && (d.condicional !== 'mas_100_trabajadores' || activeWorkers.length > 100))
    .every((d) => obraDocs.some((od: any) => od.tipo === d.tipo));

  const doPendientes = doDocs.filter((doc) => !doc.archivoSubido);
  const doTotal = doDocs.length;
  const doUploaded = doTotal - doPendientes.length;
  void doUploaded; // reservado para indicador de fase DO

  const faseLabel = DS44_PHASE_LABELS[selectedDemingPhase] || selectedDemingPhase.toUpperCase();
  const isPlanPhase = selectedDemingPhase === 'plan';
  const isDoPhase = selectedDemingPhase === 'hacer';
  const isCheckPhase = selectedDemingPhase === 'verificar';
  const isActPhase = selectedDemingPhase === 'actuar';

  const FASES_DEMING = [
    { key: 'plan', label: 'PLANIFICAR', short: 'PLAN' },
    { key: 'hacer', label: 'HACER', short: 'DO' },
    { key: 'verificar', label: 'VERIFICAR', short: 'CHECK' },
    { key: 'actuar', label: 'ACTUAR', short: 'ACT' },
  ];
  const idxFaseDeming = FASES_DEMING.findIndex(f => f.key === faseDeming);

  // Auto-avance del ciclo Deming: en cuanto una fase queda completa, pasa sola a
  // la siguiente (PLAN→HACER→VERIFICAR→ACTUAR). Se dispara una sola vez por fase
  // (autoAdvanceRef guarda la fase ya avanzada). ACTUAR no avanza (última fase).
  useEffect(() => {
    if (!obraId || activatingFaseDeming) return;
    const completo =
      faseDeming === 'plan' ? planCompleto
        : faseDeming === 'hacer' ? doCompleto
          : faseDeming === 'verificar' ? checkCompleto
            : false;
    if (!completo) return;
    if (autoAdvanceRef.current === faseDeming) return; // ya disparado para esta fase

    autoAdvanceRef.current = faseDeming;
    if (faseDeming === 'plan') handleActivarFaseHacer();
    else handleAvanzarFaseDeming();
  }, [obraId, faseDeming, planCompleto, doCompleto, checkCompleto, activatingFaseDeming, handleActivarFaseHacer, handleAvanzarFaseDeming]);

  if (loading) {
    return (
      <div className="flex items-center justify-center" style={{ height: '100vh' }}>
        <div className="spinner" />
      </div>
    );
  }

  if (!obra) {
    return (
      <>
        <Header title="Obras" />
        <div className="page-content">
          <div className="card">
            <div className="empty-state">
              <div className="empty-state-icon">
                <LuShieldAlert size={48} className="text-danger-500" />
              </div>
              <h3 className="empty-state-title">Obra no encontrada</h3>
              <p className="empty-state-description">No pudimos cargar la informacion de la obra.</p>
            </div>
          </div>
        </div>
      </>
    );
  }

  const handleEditToggle = () => {
    setEditData({
      nombre: obra.nombre || '',
      estado: obra.estado || 'activa',
      faenaCompartida: Boolean(obra.faenaCompartida),
      tieneMaquinaria: obra.tieneMaquinaria !== undefined ? Boolean(obra.tieneMaquinaria) : true,
      agentesFQB: Boolean(obra.agentesFQB)
    });
    setIsEditModalOpen(true);
  };

  const handleEditChange = (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value, type } = event.target as HTMLInputElement;
    const checked = (event.target as HTMLInputElement).checked;
    setEditData((prev: any) => ({ ...prev, [name]: type === 'checkbox' ? checked : value }));
  };

  const handleSaveObra = async () => {
    if (!obraId || !editData) return;
    const res = await obrasApi.update(obraId, {
      nombre: editData.nombre,
      estado: editData.estado,
      faenaCompartida: editData.faenaCompartida,
      tieneMaquinaria: editData.tieneMaquinaria,
      agentesFQB: editData.agentesFQB
    });
    if (res.success && res.data?.obra) {
      setObra(res.data.obra);
    } else if (res.success && res.data) {
      setObra(res.data);
    }
    setIsEditModalOpen(false);
  };

  const handleAddWorker = async (worker: any) => {
    if (!obraId) return;
    setUpdatingWorkers(worker.personaId);
    try {
      const obraIds = Array.isArray(worker.obraIds) ? worker.obraIds : [];
      if (!obraIds.includes(obraId)) {
        await workersApi.update(worker.personaId, {
          obraIds: [...obraIds, obraId],
          estado: 'activo',
          solicitanteId: user?.personaId || user?.userId
        } as any);
      }
      const refreshed = await workersApi.list();
      if (refreshed.success && refreshed.data) {
        const workers = refreshed.data as any[];
        setAllWorkers(workers);
        setTrabajadores(workers.filter((w: any) => Array.isArray(w.obraIds) && w.obraIds.includes(obraId)));
      }
      // Abrir modal de onboarding post-asignación
      setBulkUploadDone({});
      setOnboardingUploadModal({ show: true, addedWorkers: [worker] });
    } catch (error) {
      console.error('Error adding worker to obra:', error);
    } finally {
      setUpdatingWorkers(null);
    }
  };

  const handleAddMultipleWorkers = async (workersToAdd: any[]) => {
    if (!obraId || workersToAdd.length === 0) return;
    setUpdatingWorkers('multiple');
    try {
      for (const worker of workersToAdd) {
        const obraIds = Array.isArray(worker.obraIds) ? worker.obraIds : [];
        if (!obraIds.includes(obraId)) {
          await workersApi.update(worker.personaId, {
            obraIds: [...obraIds, obraId],
            estado: 'activo',
            solicitanteId: user?.personaId || user?.userId
          } as any);
        }
      }
      const refreshed = await workersApi.list();
      if (refreshed.success && refreshed.data) {
        const workers = refreshed.data as any[];
        setAllWorkers(workers);
        setTrabajadores(workers.filter((w: any) => Array.isArray(w.obraIds) && w.obraIds.includes(obraId)));
        setSelectedUnassignedWorkerIds([]);
      }
      // Abrir modal de onboarding post-asignación
      setIsWorkersModalOpen(false);
      setBulkUploadDone({});
      setOnboardingUploadModal({ show: true, addedWorkers: workersToAdd });
    } catch (error) {
      console.error('Error adding multiple workers to obra:', error);
    } finally {
      setUpdatingWorkers(null);
    }
  };

  const handleDeactivateWorker = async (worker: any) => {
    if (!obraId) return;
    setUpdatingWorkers(worker.personaId);
    try {
      // Prevent deactivating administrators
      if (worker.rol === 'admin') {
        alert('No se puede dar de baja a un trabajador con rol de administrador.');
        return;
      }

      await workersApi.update(worker.personaId, {
        estado: 'inactivo'
      } as any);
      const refreshed = await workersApi.list();
      if (refreshed.success && refreshed.data) {
        const workers = refreshed.data as any[];
        setAllWorkers(workers);
        setTrabajadores(workers.filter((w: any) => Array.isArray(w.obraIds) && w.obraIds.includes(obraId)));
      }
    } catch (error) {
      console.error('Error deactivating worker:', error);
    } finally {
      setUpdatingWorkers(null);
    }
  };

  const handleReactivateWorker = async (worker: any) => {
    if (!obraId) return;
    setUpdatingWorkers(worker.personaId);
    try {
      // set worker as active; also ensure obraId present in obraIds
      const obraIds = Array.isArray(worker.obraIds) ? worker.obraIds : [];
      const updated = {
        estado: 'activo',
        obraIds: obraIds.includes(obraId) ? obraIds : [...obraIds, obraId],
        solicitanteId: user?.personaId || user?.userId
      } as any;
      await workersApi.update(worker.personaId, updated);
      const refreshed = await workersApi.list();
      if (refreshed.success && refreshed.data) {
        const workers = refreshed.data as any[];
        setAllWorkers(workers);
        setTrabajadores(workers.filter((w: any) => Array.isArray(w.obraIds) && w.obraIds.includes(obraId)));
      }
    } catch (error) {
      console.error('Error reactivating worker:', error);
    } finally {
      setUpdatingWorkers(null);
    }
  };

  return (
    <>
      <Header title="Obras" />
      <div className="page-content">
        <div className="page-header">
          <div className="page-header-info">
            <h2 className="page-header-title">
              <LuBuilding2 className="text-primary-500" />
              {obra.nombre}
            </h2>
            <p className="page-header-description">
              {obra.comuna || '-'}, {obra.region || '-'}
            </p>
          </div>
          <div className="page-header-actions">
            <button className="btn btn-secondary" onClick={() => navigate('/obras')}>
              <LuArrowLeft />
              Volver a obras
            </button>
          </div>
        </div>

        <div style={{ display: 'grid', gap: 'var(--space-4)', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', marginBottom: 'var(--space-6)' }}>
          {indicadores.map((item) => (
            <div key={item.label} className="card stat-card">
              <div className="stat-value">{item.value}</div>
              <div className="stat-label">{item.label}</div>
            </div>
          ))}
        </div>

        <div className="obra-dashboard-grid">
          <div className="card">
            <div className="card-header">
              <div className="card-title">Resumen de Obra</div>
              <button className="btn btn-ghost btn-sm" onClick={handleEditToggle}>
                <LuPencil />
                Editar
              </button>
            </div>
            <>
              <div className="text-muted">Mandante</div>
              <div className="font-medium">{obra.mandante || '-'}</div>
              <div className="text-muted" style={{ marginTop: 'var(--space-3)' }}>Direccion</div>
              <div className="font-medium">{obra.direccion || '-'}</div>
              <div className="text-muted" style={{ marginTop: 'var(--space-3)' }}>Region / Comuna</div>
              <div className="font-medium">{obra.region || '-'} · {obra.comuna || '-'}</div>
              <div className="text-muted" style={{ marginTop: 'var(--space-3)' }}>Estado</div>
              <div className="badge badge-success" style={{ width: 'fit-content' }}>{obra.estado || '-'}</div>
            </>
          </div>

          <div className="card">
            <div className="card-header">
              <div className="card-title">Trabajadores Asignados</div>
              <LuUsers className="text-muted" />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 'var(--space-3)', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
              <div className="text-muted">{trabajadores.length} trabajadores asociados</div>
              <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                {user?.permisos?.includes('firmar_asistido') && (
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => setFirmaAsistidaOpen(true)}
                    title="El trabajador firma con su PIN en este dispositivo"
                  >
                    Firma asistida
                  </button>
                )}
                <button
                  className="btn btn-sm"
                  style={{ backgroundColor: 'var(--success-500, #10b981)', color: 'white', border: 'none' }}
                  onClick={() => setIsWorkersModalOpen(true)}
                >
                  <LuUserPlus />
                  Gestionar
                </button>
              </div>
            </div>
            {trabajadores.length === 0 ? (
              <div className="text-muted">No hay trabajadores asociados a esta obra.</div>
            ) : (
              <div style={{ maxHeight: '360px', overflowY: 'auto', paddingRight: 'var(--space-2)' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                  {activeWorkers.map((worker) => (
                    <div key={worker.personaId} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <div className="font-medium">{worker.nombre} {worker.apellido || ''}</div>
                        <div className="text-muted">{worker.cargo || 'Trabajador'}</div>
                      </div>
                      <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
                        <span className="text-muted">{worker.rut}</span>
                        <button
                          className="btn btn-secondary btn-sm"
                          type="button"
                          onClick={() => handleDeactivateWorker(worker)}
                          disabled={updatingWorkers === worker.personaId || worker.rol === 'admin'}
                          title={worker.rol === 'admin' ? 'No se puede dar de baja a administradores' : undefined}
                        >
                          Dar de baja
                        </button>
                      </div>
                    </div>
                  ))}
                  {inactiveWorkers.length > 0 && (
                    <div style={{ marginTop: 'var(--space-3)' }}>
                      <div className="text-muted" style={{ marginBottom: 'var(--space-2)' }}>Dados de baja</div>
                      {inactiveWorkers.map((worker) => (
                        <div key={worker.personaId} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <div>
                            <div className="font-medium">{worker.nombre} {worker.apellido || ''}</div>
                            <div className="text-muted">{worker.cargo || 'Trabajador'}</div>
                          </div>
                          <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
                            <span className="badge badge-warning">Baja</span>
                            <button
                              className="btn btn-primary btn-sm"
                              type="button"
                              onClick={() => handleReactivateWorker(worker)}
                              disabled={updatingWorkers === worker.personaId}
                            >
                              Reactivar
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="card" style={{ gridColumn: '1 / -1', padding: 'var(--space-4)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
              <div className="font-medium">Ciclo DS44 (Deming)</div>
              <div className="text-muted" style={{ fontSize: '0.85rem' }}>
                Selecciona una fase para revisar sus documentos.
              </div>
            </div>
            <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', flexWrap: 'wrap', marginTop: 'var(--space-3)' }}>
              {FASES_DEMING.map((fase, idx) => {
                const isActive = fase.key === faseDeming;
                const isDone = idx < idxFaseDeming;
                const isSelected = fase.key === selectedDemingPhase;
                return (
                  <React.Fragment key={fase.key}>
                    <button
                      type="button"
                      onClick={() => setSelectedDemingPhase(fase.key)}
                      style={{
                        padding: 'var(--space-1) var(--space-3)',
                        borderRadius: 'var(--radius-full)',
                        fontWeight: isSelected ? 700 : 500,
                        fontSize: isSelected ? '0.9rem' : '0.85rem',
                        cursor: 'pointer',
                        background: isDone
                          ? 'var(--success-500, #10b981)'
                          : isActive
                            ? 'var(--primary-500, #3b82f6)'
                            : isSelected
                              ? 'rgba(15, 23, 42, 0.06)'
                              : 'var(--surface-elevated)',
                        color: isDone || isActive ? 'white' : isSelected ? 'var(--text-primary)' : 'var(--text-muted)',
                        border: isSelected
                          ? `2px solid ${isDone || isActive ? 'rgba(255,255,255,0.8)' : 'var(--primary-400,#60a5fa)'}`
                          : `1px solid ${isDone ? 'var(--success-500,#10b981)' : isActive ? 'var(--primary-500,#3b82f6)' : 'var(--surface-border)'}`,
                        boxShadow: isSelected ? '0 8px 18px rgba(15, 23, 42, 0.16)' : 'none',
                        transform: isSelected ? 'scale(1.02)' : 'none'
                      }}
                    >
                      {isDone ? '✓ ' : ''}{fase.label}
                    </button>
                    {idx < FASES_DEMING.length - 1 && (
                      <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>→</span>
                    )}
                  </React.Fragment>
                );
              })}
            </div>
          </div>

          <div className="card" style={{ gridColumn: '1 / -1' }}>
            <div className="card-header">
              <div>
                <div className="card-title">Cumplimiento DS44 — Fase {faseLabel}</div>
                <div className="text-muted" style={{ fontSize: '0.85rem' }}>
                  {isPlanPhase
                    ? 'Documentos base de la obra (PLAN)'
                    : isDoPhase
                      ? 'Checklist de onboarding por trabajador (HACER)'
                      : isCheckPhase
                        ? 'Evaluacion anual y consolidacion de evidencias (CHECK)'
                        : 'Seguimiento de mejora continua'}
                </div>
              </div>
              <LuFileText className="text-muted" />
            </div>

            {isPlanPhase && (
              <>
                <div style={{ display: 'grid', gap: 'var(--space-2)', marginBottom: 'var(--space-3)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-3)' }}>
                    <div className="font-medium">Progreso PLAN</div>
                    <div className="text-muted">{ds44Uploaded}/{ds44Total} documentos completos (subidos y firmados)</div>
                  </div>
                  <div
                    style={{
                      height: '10px',
                      borderRadius: '999px',
                      overflow: 'hidden',
                      background: 'var(--surface-elevated)',
                      border: '1px solid var(--surface-border)'
                    }}
                  >
                    <div
                      style={{
                        width: `${ds44Progress}%`,
                        height: '100%',
                        background: 'var(--gradient-primary)',
                        transition: 'width 200ms ease'
                      }}
                    />
                  </div>
                  {(documentosPendientes.length > 0 || documentosPendientesFirma.length > 0 || documentosVencidos.length > 0) && (
                    <div className="ds44-alerts">
                      {documentosPendientesFirma.length > 0 && (
                        <div className="ds44-alert ds44-alert-warning">
                          <span className="ds44-alert-icon"><LuClock size={16} /></span>
                          <span>Pendientes de firma (no completan la fase): {documentosPendientesFirma.map((d) => d.titulo).join(', ')}.</span>
                        </div>
                      )}
                      {documentosPendientes.length > 0 && (
                        <div className="ds44-alert ds44-alert-danger">
                          <span className="ds44-alert-icon"><FiAlertTriangle size={16} /></span>
                          <span>Documentos faltantes: {documentosPendientesTitulos.join(', ')}.</span>
                        </div>
                      )}
                      {documentosVencidos.length > 0 && (
                        <div className="ds44-alert ds44-alert-warning">
                          <span className="ds44-alert-icon"><LuClock size={16} /></span>
                          <span>Hay {documentosVencidos.length} documento{documentosVencidos.length === 1 ? '' : 's'} DS44 vencido{documentosVencidos.length === 1 ? '' : 's'}.</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
                <div style={{ maxHeight: '520px', overflowY: 'auto', paddingRight: 'var(--space-2)' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                  {ds44Docs.map((doc) => {
                    const { firmadas, total } = getSignatureStats(doc.document);
                    const fechaCaducidad = getDocExpiryDate(doc.document);
                    const isExpired = Boolean(fechaCaducidad && new Date(fechaCaducidad) < new Date());
                    const firmasCompletas = total > 0 && firmadas === total;
                    const badgeClass = isExpired ? 'badge-danger' : firmasCompletas ? 'badge-success' : doc.archivoSubido ? 'badge-warning' : 'badge-danger';
                    const badgeLabel = isExpired ? 'Vencido' : firmasCompletas ? 'Completo' : doc.archivoSubido ? 'Pendiente de firma' : 'Sin documento';
                    return (
                      <div key={doc.key} className="card" style={{ padding: 'var(--space-3)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
                        <div style={{ minWidth: 0 }}>
                          <div className="font-medium" style={{ fontSize: '0.9rem' }}>{doc.titulo}</div>
                          <div className="text-muted" style={{ fontSize: '0.78rem' }}>
                            {doc.estadoFirma}
                            {total > 0 && ` · Firmas: ${firmadas}/${total}`}
                            {fechaCaducidad && ` · ${isExpired ? 'Vencido' : 'Caduca'}: ${formatDate(fechaCaducidad)}`}
                          </div>
                        </div>
                        <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', flexShrink: 0 }}>
                          <span className={`badge ${badgeClass}`}>{badgeLabel}</span>
                          <button
                            className={doc.archivoSubido ? 'btn btn-secondary btn-sm' : 'btn btn-primary btn-sm'}
                            type="button"
                            onClick={() => openDs44Modal(doc)}
                          >
                            {doc.archivoSubido ? 'Actualizar' : 'Subir'}
                          </button>
                          {doc.archivoSubido && (
                            <button
                              className="btn btn-secondary btn-sm"
                              type="button"
                              disabled={ds44Previewing}
                              onClick={() => handlePreviewDocumentFromCard(doc)}
                            >
                              Ver
                            </button>
                          )}
                          {total > 0 && (
                            <button
                              className="btn btn-secondary btn-sm"
                              type="button"
                              onClick={() => openSignatureModal(doc)}
                            >
                              Firmas
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
                </div>
              </>
            )}

            {isDoPhase && (
              <div style={{ maxHeight: '520px', overflowY: 'auto', paddingRight: 'var(--space-2)' }}>
                {/* ── Sección A: Registro AT/EP/Incidentes Peligrosos (Arts. 72-73) ── */}
                <div className="card" style={{ padding: 'var(--space-4)', marginBottom: 'var(--space-3)', border: '1px solid var(--surface-border)', background: 'var(--surface-elevated)' }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 'var(--space-3)' }}>
                    {/* Info */}
                    <div style={{ minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: '4px' }}>
                        <LuShieldAlert size={16} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                        <div className="font-medium">Registro de Actividad Preventiva (Art. 72)</div>
                      </div>
                      <div className="text-muted" style={{ fontSize: '0.8rem', marginBottom: 'var(--space-2)' }}>
                        Arts. 71-72 DS44 &middot; Documento formal del DO. Consolida toda la actividad preventiva
                        del periodo (capacitaciones, EPP, inducciones, vigilancia) más incidentes e indicadores,
                        firmado con hash verificable. No se reduce a incidentes.
                      </div>
                      <div style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
                        <span style={{ fontSize: '0.82rem' }}>
                          <span style={{ fontWeight: 600 }}>{actividades.length}</span>
                          <span className="text-muted"> actividad{actividades.length !== 1 ? 'es' : ''} preventiva{actividades.length !== 1 ? 's' : ''}</span>
                        </span>
                        <span style={{ fontSize: '0.82rem' }}>
                          <span style={{ fontWeight: 600 }}>{incidentes.length}</span>
                          <span className="text-muted"> incidente{incidentes.length !== 1 ? 's' : ''}</span>
                        </span>
                        {incidentes.filter(i => ['reportado', 'en_investigacion'].includes((i as any).estado)).length > 0 && (
                          <span style={{ fontSize: '0.82rem', color: '#f59e0b', fontWeight: 500 }}>
                            {incidentes.filter(i => ['reportado', 'en_investigacion'].includes((i as any).estado)).length} abierto{incidentes.filter(i => ['reportado', 'en_investigacion'].includes((i as any).estado)).length !== 1 ? 's' : ''}
                          </span>
                        )}
                      </div>
                    </div>
                    {/* Acciones */}
                    <div style={{ display: 'flex', gap: 'var(--space-2)', flexShrink: 0, alignItems: 'center' }}>
                      <button
                        className="btn btn-secondary"
                        style={{ padding: '6px 14px', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '6px' }}
                        onClick={() => navigate(`/incidents?obraId=${obraId}`)}
                      >
                        <LuFileText size={14} /> Ver incidentes
                      </button>
                      <button
                        className="btn btn-primary"
                        style={{ padding: '6px 14px', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '6px' }}
                        onClick={() => setRegistroSignModal(true)}
                        disabled={exportingRegistro}
                      >
                        <LuDownload size={14} /> Exportar y Firmar
                      </button>
                    </div>
                  </div>
                </div>

                {/* ── Cumplimiento HACER de la obra (procedimientos + capacitaciones + registro Art.72) ── */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: 'var(--space-3) 0 var(--space-2)' }}>
                  <div>
                    <div className="font-medium">Cumplimiento DO de la obra</div>
                    <div className="text-muted" style={{ fontSize: '0.8rem' }}>
                      Solo elementos aplicables a esta obra. NO incluye el onboarding por persona.
                    </div>
                  </div>
                  <div className="text-muted" style={{ fontSize: '0.85rem' }}>
                    {doCumplimiento.completados}/{doCumplimiento.total} · {doCumplimiento.progress}%
                  </div>
                </div>
                <div style={{ height: '8px', borderRadius: '999px', overflow: 'hidden', background: 'var(--surface-elevated)', border: '1px solid var(--surface-border)', marginBottom: 'var(--space-4)' }}>
                  <div style={{ width: `${doCumplimiento.progress}%`, height: '100%', background: 'var(--gradient-primary)', transition: 'width 300ms ease' }} />
                </div>

                {/* ── Sección: Procedimientos operativos (documento de obra) ── */}
                <div className="font-medium" style={{ marginBottom: 'var(--space-2)' }}>Procedimientos operativos</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', marginBottom: 'var(--space-4)' }}>
                  {doProcedimientos.filter((p) => p.aplicabilidad !== 'no_aplica').map(({ el, aplicabilidad, estado, firmadas, totalFirmas }) => {
                    const verificar = aplicabilidad === 'verificar';
                    const cf = verificar ? condicionFlag(el.condicion) : null;
                    const badgeClass = estado === 'completo' ? 'badge-success' : estado === 'pendiente_firma' ? 'badge-warning' : 'badge-danger';
                    const badgeLabel = estado === 'completo' ? 'Completo' : estado === 'pendiente_firma' ? 'Pendiente de firma' : 'Faltante';
                    return (
                      <div key={el.key} className="card" style={{ padding: 'var(--space-3)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
                        <div style={{ minWidth: 0 }}>
                          <div className="font-medium" style={{ fontSize: '0.9rem' }}>{el.titulo}</div>
                          <div className="text-muted" style={{ fontSize: '0.78rem' }}>
                            {el.articulo}
                            {totalFirmas > 0 && ` · Firmas: ${firmadas}/${totalFirmas}`}
                          </div>
                        </div>
                        <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', flexShrink: 0 }}>
                          {verificar && cf ? (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                              <span className="text-muted" style={{ fontSize: '0.78rem' }}>{cf.q}</span>
                              <button className="btn btn-secondary btn-sm" type="button" disabled={savingObraFlag === cf.flag} onClick={() => handleSetObraFlag(cf.flag, true)}>Sí</button>
                              <button className="btn btn-secondary btn-sm" type="button" disabled={savingObraFlag === cf.flag} onClick={() => handleSetObraFlag(cf.flag, false)}>No</button>
                            </div>
                          ) : (
                            <>
                              <span className={`badge ${badgeClass}`}>{badgeLabel}</span>
                              <button className="btn btn-secondary btn-sm" type="button" onClick={() => openDoCreate('documento', el)}>
                                {estado === 'faltante' ? 'Crear / subir' : 'Actualizar'}
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* ── Sección: Capacitaciones (vinculadas a Actividades) ── */}
                <div className="font-medium" style={{ marginBottom: 'var(--space-2)' }}>Capacitaciones</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', marginBottom: 'var(--space-4)' }}>
                  {doCapacitaciones.filter((c) => c.aplicabilidad !== 'no_aplica').map(({ el, aplicabilidad, estado }) => {
                    const verificar = aplicabilidad === 'verificar';
                    const cf = verificar ? condicionFlag(el.condicion) : null;
                    const badgeClass = estado === 'completo' ? 'badge-success' : estado === 'pendiente_firma' ? 'badge-warning' : 'badge-danger';
                    const badgeLabel = estado === 'completo' ? 'Ejecutada' : estado === 'pendiente_firma' ? 'Programada (faltan firmas)' : 'Sin actividad';
                    return (
                      <div key={el.key} className="card" style={{ padding: 'var(--space-3)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
                        <div style={{ minWidth: 0 }}>
                          <div className="font-medium" style={{ fontSize: '0.9rem' }}>{el.titulo}</div>
                          <div className="text-muted" style={{ fontSize: '0.78rem' }}>{el.articulo} · Se registra como actividad con asistencia firmada</div>
                        </div>
                        <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', flexShrink: 0 }}>
                          {verificar && cf ? (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                              <span className="text-muted" style={{ fontSize: '0.78rem' }}>{cf.q}</span>
                              <button className="btn btn-secondary btn-sm" type="button" disabled={savingObraFlag === cf.flag} onClick={() => handleSetObraFlag(cf.flag, true)}>Sí</button>
                              <button className="btn btn-secondary btn-sm" type="button" disabled={savingObraFlag === cf.flag} onClick={() => handleSetObraFlag(cf.flag, false)}>No</button>
                            </div>
                          ) : (
                            <>
                              <span className={`badge ${badgeClass}`}>{badgeLabel}</span>
                              <button className="btn btn-secondary btn-sm" type="button" onClick={() => openDoCreate('actividad', el)}>
                                Programar
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* ── Sección: Registros de gestión (read-models, datos del sistema) ── */}
                <div className="font-medium" style={{ marginBottom: 'var(--space-2)' }}>Registros de gestión</div>
                <div className="text-muted" style={{ fontSize: '0.78rem', marginBottom: 'var(--space-2)' }}>
                  Se nutren de los datos del sistema; no son documentos a subir y no afectan el %.
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', marginBottom: 'var(--space-4)' }}>
                  {doRegistros.map(({ el }) => {
                    // Conteo/estado real segun la naturaleza del registro.
                    const incCount = incidentes.length;
                    const invPend = incidentes.filter((i: any) => ['grave', 'fatal'].includes(i.gravedad) && i.estado !== 'cerrado').length;
                    const hasSimulacro = actividades.some((a: any) => a.tipo === 'SIMULACRO');
                    const enVigilancia = trabajadores.filter((w: any) => w.vigilanciaSalud?.enVigilancia).length;
                    return (
                      <div key={el.key} className="card" style={{ padding: 'var(--space-3)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
                        <div style={{ minWidth: 0 }}>
                          <div className="font-medium" style={{ fontSize: '0.9rem' }}>{el.titulo}</div>
                          <div className="text-muted" style={{ fontSize: '0.78rem' }}>
                            {el.articulo}
                            {el.accion === 'incidentes' && ` · ${incCount} incidente(s)`}
                            {el.accion === 'investigaciones' && ` · ${invPend} investigación(es) pendiente(s)`}
                            {el.accion === 'simulacro' && ` · ${hasSimulacro ? 'Ensayo registrado' : 'Sin ensayo en el periodo'}`}
                            {el.key === 'REG_VIGILANCIA' && ` · ${enVigilancia} en vigilancia`}
                          </div>
                        </div>
                        <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', flexShrink: 0, flexWrap: 'wrap' }}>
                          {el.moduloPendiente && <span className="badge badge-warning">Módulo pendiente</span>}
                          {el.accion === 'incidentes' && (
                            <>
                              <button className="btn btn-secondary btn-sm" type="button" onClick={() => navigate(`/incidents?obraId=${obraId}`)}>Ver incidentes</button>
                              <button className="btn btn-primary btn-sm" type="button" onClick={() => navigate(`/incidents?obraId=${obraId}&nuevo=1`)}>Reportar</button>
                            </>
                          )}
                          {el.accion === 'investigaciones' && (
                            <button className="btn btn-secondary btn-sm" type="button" onClick={() => navigate(`/incidents?obraId=${obraId}&tab=investigaciones`)}>Ver investigaciones</button>
                          )}
                          {el.accion === 'simulacro' && (
                            <button className="btn btn-secondary btn-sm" type="button" onClick={() => openDoCreate('actividad', { titulo: 'Ensayo anual del plan de emergencias', activityTipo: 'SIMULACRO', tipo: 'SIMULACRO' })}>
                              Programar simulacro
                            </button>
                          )}
                          {el.accion === 'consulta' && (
                            <button className="btn btn-secondary btn-sm" type="button" onClick={() => el.modulo && navigate(el.modulo)}>Ver</button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* ── Sección: Eventos sobrevinientes ── */}
                <div className="font-medium" style={{ marginBottom: 'var(--space-2)' }}>Eventos sobrevinientes</div>
                <div className="text-muted" style={{ fontSize: '0.78rem', marginBottom: 'var(--space-2)' }}>
                  Se generan solo ante el hecho. No cuentan como faltante en el cumplimiento.
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', marginBottom: 'var(--space-4)' }}>
                  {DS44_DO_EVENTOS.map((ev) => {
                    const ocurrencias = obraDocs.filter((d: any) => d.tipo === ev.tipo).length;
                    return (
                      <div key={ev.key} className="card" style={{ padding: 'var(--space-3)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
                        <div style={{ minWidth: 0 }}>
                          <div className="font-medium" style={{ fontSize: '0.9rem' }}>{ev.titulo}</div>
                          <div className="text-muted" style={{ fontSize: '0.78rem' }}>{ev.articulo} · {ocurrencias > 0 ? `${ocurrencias} registro(s)` : 'Sin eventos'}</div>
                        </div>
                        <button className="btn btn-secondary btn-sm" type="button" onClick={() => openDoCreate('documento', ev)}>
                          Registrar
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}


            {isCheckPhase && (
              <div style={{ maxHeight: '520px', overflowY: 'auto', paddingRight: 'var(--space-2)', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                {/* Consolidado del periodo */}
                <div className="card" style={{ padding: 'var(--space-4)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap', marginBottom: 'var(--space-2)' }}>
                    <div className="font-medium">Consolidado del periodo (Arts. 14, 22.4)</div>
                    <button className="btn btn-secondary btn-sm" type="button" onClick={loadCheckConsolidado} disabled={loadingCheck}>
                      {loadingCheck ? 'Cargando…' : checkConsolidado ? 'Actualizar' :'Consolidar periodo'}
                    </button>
                  </div>
                  {checkConsolidado ? (
                    <>
                      <div style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
                        <div style={{ flex: 1, minWidth: '120px' }}>
                          <div className="text-muted" style={{ fontSize: '0.78rem' }}>Accidentes</div>
                          <div style={{ fontSize: '1.3rem', fontWeight: 700 }}>{checkConsolidado.indicadores?.numeroAccidentes ?? 0}</div>
                        </div>
                        <div style={{ flex: 1, minWidth: '120px' }}>
                          <div className="text-muted" style={{ fontSize: '0.78rem' }}>Tasa frecuencia</div>
                          <div style={{ fontSize: '1.3rem', fontWeight: 700 }}>{checkConsolidado.indicadores?.tasaFrecuencia ?? 0}</div>
                        </div>
                        <div style={{ flex: 1, minWidth: '120px' }}>
                          <div className="text-muted" style={{ fontSize: '0.78rem' }}>Investigaciones (pend./cerr.)</div>
                          <div style={{ fontSize: '1.3rem', fontWeight: 700 }}>
                            <span style={{ color: (checkConsolidado.investigacionesATEP?.pendientes ?? 0) > 0 ? '#f59e0b' : undefined }}>{checkConsolidado.investigacionesATEP?.pendientes ?? 0}</span>
                            {' / '}{checkConsolidado.investigacionesATEP?.cerradas ?? 0}
                          </div>
                        </div>
                        <div style={{ flex: 1, minWidth: '120px' }}>
                          <div className="text-muted" style={{ fontSize: '0.78rem' }}>Medidas vencidas</div>
                          <div style={{ fontSize: '1.3rem', fontWeight: 700, color: (checkConsolidado.medidasCorrectivas?.vencidas ?? 0) > 0 ? '#ef4444' : undefined }}>{checkConsolidado.medidasCorrectivas?.vencidas ?? 0}</div>
                        </div>
                        <div style={{ flex: 1, minWidth: '120px' }}>
                          <div className="text-muted" style={{ fontSize: '0.78rem' }}>En vigilancia salud</div>
                          <div style={{ fontSize: '1.3rem', fontWeight: 700 }}>{checkConsolidado.vigilancia?.enVigilancia ?? 0}</div>
                        </div>
                      </div>
                      {(checkConsolidado.medidasCorrectivas?.total ?? 0) > 0 && (
                        <div className="text-muted" style={{ fontSize: '0.8rem', marginTop: 'var(--space-2)' }}>
                          Medidas correctivas: {checkConsolidado.medidasCorrectivas.implementadas}/{checkConsolidado.medidasCorrectivas.total} implementadas · {checkConsolidado.medidasCorrectivas.verificadas} verificadas
                        </div>
                      )}
                      {(checkConsolidado.causasRecurrentes?.length ?? 0) > 0 && (
                        <div style={{ marginTop: 'var(--space-2)', padding: '8px 12px', borderRadius: '8px', background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.25)', fontSize: '0.8rem', color: '#92400e' }}>
                          <strong>Causas raíz recurrentes (desviación sistémica):</strong>
                          <ul style={{ margin: '4px 0 0', paddingLeft: '18px' }}>
                            {checkConsolidado.causasRecurrentes.map((c: any, i: number) => (
                              <li key={i}>{c.descripcion} <span className="text-muted">({c.incidentes} incidentes)</span></li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="text-muted" style={{ fontSize: '0.85rem' }}>
                      Consolida los indicadores de siniestralidad, investigaciones y vigilancia del periodo.
                    </div>
                  )}
                </div>

                {/* ── Investigaciones AT/EP pendientes (Art. 71) — cerrar + firmar informe ── */}
                {(() => {
                  const pendientes = incidentes.filter((i: any) => (['grave', 'fatal'].includes(i.gravedad) || i.esFatal) && i.estado !== 'cerrado');
                  if (pendientes.length === 0) return null;
                  return (
                    <div className="card" style={{ padding: 'var(--space-4)' }}>
                      <div className="font-medium" style={{ marginBottom: 'var(--space-1)' }}>Investigaciones AT/EP pendientes (Art. 71)</div>
                      <div className="text-muted" style={{ fontSize: '0.8rem', marginBottom: 'var(--space-2)' }}>
                        Obligatorias para incidentes graves/fatales. Cerrar genera el informe firmado (árbol de causas) como respaldo del Registro Art. 72.
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                        {pendientes.map((inc: any) => (
                          <div key={inc.incidentId} className="card" style={{ padding: 'var(--space-3)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
                            <div style={{ minWidth: 0 }}>
                              <div className="font-medium" style={{ fontSize: '0.9rem' }}>{inc.descripcion || inc.incidentId}</div>
                              <div className="text-muted" style={{ fontSize: '0.78rem' }}>{inc.fecha || ''} · {inc.gravedad}{inc.esFatal ? ' (fatal)' : ''} · {(inc.medidasCorrectivas || []).length} medida(s)</div>
                            </div>
                            <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', flexShrink: 0 }}>
                              <button className="btn btn-secondary btn-sm" type="button" onClick={() => navigate(`/incidents?obraId=${obraId}`)}>Ver / investigar</button>
                              <button className="btn btn-primary btn-sm" type="button" onClick={() => { setCerrarInvModal({ incidentId: inc.incidentId, descripcion: inc.descripcion || inc.incidentId }); setCerrarInvPin(''); setCerrarInvError(null); setCerrarInvResult(null); }}>
                                Cerrar y firmar informe
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })()}

                {/* Documentos de la Fase CHECK */}
                {DS44_CHECK_DOCS.map((doc) => {
                  const aplica = doc.condicional !== 'mas_100_trabajadores' || activeWorkers.length > 100;
                  if (!aplica) return null;

                  const existing = obraDocs.find((d: any) => d.tipo === doc.tipo);
                  const subido = Boolean(existing?.s3Key || existing?.archivoUrl) || Boolean(existing);
                  return (
                    <div key={doc.key} className="card" style={{ padding: 'var(--space-3)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
                      <div style={{ minWidth: 0 }}>
                        <div className="font-medium" style={{ fontSize: '0.9rem' }}>{doc.titulo}</div>
                        <div className="text-muted" style={{ fontSize: '0.78rem' }}>{doc.articulo}{doc.descripcion ? ` · ${doc.descripcion}` : ''}</div>
                      </div>
                      <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', flexShrink: 0 }}>
                        <span className={`badge ${subido ? 'badge-success' : doc.obligatorio ? 'badge-danger' : 'badge-info'}`}>
                          {subido ? 'Registrado' : doc.obligatorio ? 'Pendiente' : 'Opcional'}
                        </span>
                        <button className="btn btn-secondary btn-sm" type="button" onClick={() => navigate(`/documents?obraId=${obraId}&tipo=${doc.tipo}`)}>
                          Gestionar
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {isActPhase && (
              <div style={{ maxHeight: '520px', overflowY: 'auto', paddingRight: 'var(--space-2)', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>

                {/* Medidas correctivas — solo visible cuando hay datos o está cargando */}
                {(loadingMedidas || (medidas?.medidas?.length ?? 0) > 0) && (
                  <div className="card" style={{ padding: 'var(--space-4)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 'var(--space-2)', marginBottom: loadingMedidas ? 0 : 'var(--space-3)' }}>
                      <div>
                        <div className="font-medium">Medidas correctivas</div>
                        <div className="text-muted" style={{ fontSize: '0.78rem' }}>De investigaciones AT/EP · Art. 71</div>
                      </div>
                      {medidas?.resumen && (
                        <div className="text-muted" style={{ fontSize: '0.8rem', flexShrink: 0 }}>
                          {medidas.resumen.verificadas}/{medidas.resumen.total} verificadas
                          {medidas.resumen.vencidas > 0 && ` · ${medidas.resumen.vencidas} vencida(s)`}
                        </div>
                      )}
                    </div>
                    {loadingMedidas ? (
                      <div className="text-muted" style={{ fontSize: '0.85rem' }}>Cargando medidas…</div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column' }}>
                        {medidas!.medidas.map((m: any, idx: number) => {
                          const nextEstado: Record<string, 'en_proceso' | 'completada' | 'verificada'> = { pendiente: 'en_proceso', en_proceso: 'completada', completada: 'verificada' };
                          const next = nextEstado[m.estado as string];
                          const nextLabel: Record<string, string> = { en_proceso: 'Marcar en proceso', completada: 'Marcar implementada', verificada: 'Marcar verificada' };
                          const estadoLabel: Record<string, string> = { pendiente: 'Pendiente', en_proceso: 'En proceso', completada: 'Implementada', verificada: 'Verificada' };
                          const estadoClass = m.estado === 'verificada' ? 'badge-success' : m.vencida ? 'badge-danger' : m.estado === 'completada' ? 'badge-info' : 'badge-warning';
                          const key = `${m.incidentId}:${m.numero}`;
                          return (
                            <div key={key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 'var(--space-3)', padding: 'var(--space-2) 0', borderBottom: idx < medidas!.medidas.length - 1 ? '1px solid var(--surface-border)' : 'none', flexWrap: 'wrap' }}>
                              <div style={{ minWidth: 0, flex: 1 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: '2px', flexWrap: 'wrap' }}>
                                  <span className={`badge ${estadoClass}`}>{m.vencida && m.estado !== 'verificada' ? 'Vencida' : estadoLabel[m.estado]}</span>
                                  <div className="font-medium" style={{ fontSize: '0.9rem' }}>{m.medida || '(sin descripción)'}</div>
                                </div>
                                <div className="text-muted" style={{ fontSize: '0.78rem' }}>
                                  Causa raíz: {m.causaRaiz || '—'}
                                  {m.responsableNombre && ` · Responsable: ${m.responsableNombre}`}
                                  {m.fechaMaxEjecucion && ` · Plazo: ${m.fechaMaxEjecucion}`}
                                </div>
                              </div>
                              <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', flexShrink: 0 }}>
                                <button className="btn btn-secondary btn-sm" type="button" onClick={() => navigate(`/incidents?obraId=${obraId}`)}>Ver origen</button>
                                {next && (
                                  <button className="btn btn-primary btn-sm" type="button" disabled={savingMedida === key} onClick={() => avanzarMedida(m.incidentId, m.numero, next)}>
                                    {savingMedida === key ? '...' : nextLabel[next]}
                                  </button>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}

                {/* Documentos de la Fase ACT */}
                {DS44_ACT_DOCS.map((doc) => {
                  const existing = obraDocs.find((d: any) => d.tipo === doc.tipo);
                  const subido = Boolean(existing);
                  return (
                    <div key={doc.key} className="card" style={{ padding: 'var(--space-3)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
                      <div style={{ minWidth: 0 }}>
                        <div className="font-medium" style={{ fontSize: '0.9rem' }}>{doc.titulo}</div>
                        <div className="text-muted" style={{ fontSize: '0.78rem' }}>{doc.articulo}{doc.descripcion ? ` · ${doc.descripcion}` : ''}</div>
                      </div>
                      <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', flexShrink: 0 }}>
                        <span className={`badge ${subido ? 'badge-success' : 'badge-danger'}`}>{subido ? 'Registrado' : 'Pendiente'}</span>
                        <button className="btn btn-secondary btn-sm" type="button" onClick={() => navigate(`/documents?obraId=${obraId}&tipo=${doc.tipo}`)}>
                          Gestionar
                        </button>
                      </div>
                    </div>
                  );
                })}

                {/* Actualizaciones condicionales que cierran el ciclo Deming */}
                <div className="card" style={{ padding: 'var(--space-4)' }}>
                  <div className="font-medium" style={{ marginBottom: 'var(--space-3)' }}>Actualizaciones (cierre de ciclo hacia PLAN)</div>
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    {DS44_ACT_ACTUALIZACIONES.map((act, idx) => (
                      <div key={act.key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--space-3)', padding: 'var(--space-2) 0', borderBottom: idx < DS44_ACT_ACTUALIZACIONES.length - 1 ? '1px solid var(--surface-border)' : 'none', flexWrap: 'wrap' }}>
                        <div style={{ minWidth: 0 }}>
                          <div className="font-medium" style={{ fontSize: '0.88rem' }}>{act.titulo}</div>
                          <div className="text-muted" style={{ fontSize: '0.78rem' }}>{act.articulo}</div>
                        </div>
                        <button className="btn btn-secondary btn-sm" type="button" onClick={() => navigate(`/documents?obraId=${obraId}&tipo=${act.tipoOrigen}`)}>
                          Revisar documento
                        </button>
                      </div>
                    ))}
                  </div>
                  <div style={{ marginTop: 'var(--space-3)', padding: '8px 12px', borderRadius: '6px', background: 'var(--surface-base)', border: '1px solid var(--surface-border)', fontSize: '0.78rem' }} className="text-muted">
                    Nota: la evaluación OAL de cotización adicional (DS67/1999) es un proceso externo al SGSST; no se modela como documento obligatorio del sistema.
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Onboarding de trabajadores — seccion separada (track por persona, no es parte de las fases) */}
          <div className="card" style={{ gridColumn: '1 / -1' }}>
            <div className="card-header">
              <div>
                <div className="card-title">Onboarding de trabajadores</div>
                <div className="text-muted" style={{ fontSize: '0.85rem' }}>Track por persona, se dispara al vincular. Independiente de la fase y del cumplimiento DS44 de la obra.</div>
              </div>
              <LuUsers className="text-muted" />
            </div>
                {/* Barra global */}
                <div style={{ height: '8px', borderRadius: '999px', overflow: 'hidden', background: 'var(--surface-elevated)', border: '1px solid var(--surface-border)', marginBottom: 'var(--space-3)' }}>
                  <div style={{ width: `${onboardingSummary.progress}%`, height: '100%', background: 'linear-gradient(90deg,#10b981,#059669)', transition: 'width 300ms ease' }} />
                </div>

                {onboardingSummary.byWorker.length === 0 ? (
                  <div className="text-muted" style={{ padding: 'var(--space-3)', textAlign: 'center' }}>
                    No hay trabajadores activos asignados a esta obra.
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                    {onboardingSummary.byWorker.map((worker) => {
                      const pct = worker.total > 0 ? Math.round((worker.completed / worker.total) * 100) : 0;
                      const isExpanded = expandedWorkers.has(worker.workerId);
                      return (
                        <div key={worker.workerId} className="card" style={{ padding: 0, overflow: 'hidden' }}>
                          {/* Cabecera del worker — clic para expandir */}
                          <button
                            onClick={() => toggleExpandWorker(worker.workerId)}
                            style={{ width: '100%', background: 'none', border: 'none', padding: 'var(--space-3)', cursor: 'pointer', textAlign: 'left' }}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-3)' }}>
                              <div style={{ minWidth: 0 }}>
                                <div className="font-medium" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: '#fff' }}>{worker.nombre}</div>
                                <div style={{ fontSize: '0.8rem', color: 'rgba(255,255,255,0.6)' }}>{(worker as any).cargo || 'Trabajador'}</div>
                              </div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexShrink: 0 }}>
                                <div style={{ width: '80px', height: '6px', borderRadius: '999px', background: 'var(--surface-elevated)', overflow: 'hidden' }}>
                                  <div style={{ width: `${pct}%`, height: '100%', background: pct >= 80 ? '#10b981' : pct >= 50 ? '#f59e0b' : '#ef4444', transition: 'width 300ms' }} />
                                </div>
                                <span className={`badge ${pct >= 80 ? 'badge-success' : pct >= 50 ? 'badge-warning' : 'badge-danger'}`} style={{ minWidth: '48px', textAlign: 'center' }}>
                                  {worker.completed}/{worker.total}
                                </span>
                                {isExpanded ? <LuChevronUp size={16} style={{ color: 'var(--text-muted)', flexShrink: 0 }} /> : <LuChevronDown size={16} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />}
                              </div>
                            </div>
                          </button>

                          {/* Checklist expandible */}
                          {isExpanded && (
                            <div style={{ borderTop: '1px solid var(--surface-border)', padding: 'var(--space-2) var(--space-3)', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                              {((worker as any).itemDetail as any[]).map((item) => {
                                const estado = item.estado as 'pendiente_asignar' | 'pendiente_firma' | 'completo';
                                const estadoLabel = estado === 'completo' ? 'Completo' : estado === 'pendiente_firma' ? 'Pendiente de firma' : 'Pendiente de asignar';
                                const estadoColor = estado === 'completo' ? '#10b981' : estado === 'pendiente_firma' ? '#f59e0b' : 'var(--text-muted)';
                                return (
                                <div key={item.key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--surface-border)', gap: 'var(--space-2)' }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', minWidth: 0 }}>
                                    {estado === 'completo'
                                      ? <LuCircleCheck size={16} style={{ color: '#10b981', flexShrink: 0 }} />
                                      : <LuClock size={16} style={{ color: estadoColor, flexShrink: 0 }} />
                                    }
                                    <div style={{ minWidth: 0 }}>
                                      <div style={{ fontSize: '0.87rem', fontWeight: estado === 'completo' ? 400 : 500, color: estado === 'completo' ? 'var(--text-muted)' : 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                        {item.label}
                                      </div>
                                      <div style={{ fontSize: '0.75rem', color: estadoColor }}>{item.articulo} · {estadoLabel}</div>
                                    </div>
                                  </div>
                                  {estado !== 'completo' && (
                                    <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
                                      {/* Paso 1 — documento sin archivo: subir (no firma, queda pendiente de firma) */}
                                      {item.kind === 'document' && estado === 'pendiente_asignar' && (
                                        <>
                                          <input
                                            type="file"
                                            id={`wd-${worker.workerId}-${item.key}`}
                                            style={{ display: 'none' }}
                                            accept="application/pdf,image/*"
                                            onChange={(e) => {
                                              const file = e.target.files?.[0];
                                              if (file) handleInlineWorkerUpload(worker.workerId, item.tipo, file);
                                              e.target.value = '';
                                            }}
                                          />
                                          <button
                                            className="btn btn-secondary"
                                            style={{ padding: '2px 10px', fontSize: '0.78rem' }}
                                            disabled={uploadingWorkerDoc === `${worker.workerId}:${item.tipo}`}
                                            onClick={() => document.getElementById(`wd-${worker.workerId}-${item.key}`)?.click()}
                                          >
                                            {uploadingWorkerDoc === `${worker.workerId}:${item.tipo}` ? '...' : 'Subir'}
                                          </button>
                                        </>
                                      )}
                                      {/* Paso 2 — pendiente de firma: el trabajador firma con su PIN (firma asistida) */}
                                      {estado === 'pendiente_firma' && (item.kind === 'document' || item.kind === 'signature') && (
                                        <button
                                          className="btn btn-primary"
                                          style={{ padding: '2px 10px', fontSize: '0.78rem' }}
                                          onClick={() => { setFirmaAsistidaWorkerId(worker.workerId); setFirmaAsistidaTipo(item.tipo); setFirmaAsistidaOpen(true); }}
                                        >
                                          Firma asistida
                                        </button>
                                      )}
                                      {/* Firma sin asignar (no debería pasar: el onboarding crea la solicitud) */}
                                      {item.kind === 'signature' && estado === 'pendiente_asignar' && (
                                        <span className="text-muted" style={{ fontSize: '0.75rem' }}>Pendiente de asignar</span>
                                      )}
                                      {/* Capacitación: se gestiona como actividad con asistencia firmada */}
                                      {item.kind === 'actividad' && (
                                        <button
                                          className="btn btn-secondary"
                                          style={{ padding: '2px 10px', fontSize: '0.78rem' }}
                                          onClick={() => navigate('/activities')}
                                        >
                                          {estado === 'pendiente_firma' ? 'Ver actividad' : 'Programar'}
                                        </button>
                                      )}
                                    </div>
                                  )}
                                  {estado === 'completo' && (
                                    <LuCircleCheck size={16} style={{ color: '#10b981', flexShrink: 0 }} />
                                  )}
                                </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
          </div>

          {/* Toast flotante: confirmacion de acciones inline (crear/programar) */}
          {obraToast && (
            <div style={{
              position: 'fixed', top: '24px', right: '24px', zIndex: 9999,
              background: 'linear-gradient(135deg,#10b981,#059669)', color: 'white',
              padding: '14px 20px', borderRadius: '12px', boxShadow: '0 4px 24px rgba(16,185,129,0.4)',
              display: 'flex', alignItems: 'center', gap: '10px',
              animation: 'fadeInRight 0.3s ease',
              maxWidth: '340px', fontSize: '0.9rem', fontWeight: 500
            }}>
              <LuCircleCheck size={20} style={{ flexShrink: 0 }} />
              <div>{obraToast}</div>
            </div>
          )}

          {/* Toast flotante: PLAN completado (3 segundos) */}
          {planToast && (
            <div style={{
              position: 'fixed', top: '24px', right: '24px', zIndex: 9999,
              background: 'linear-gradient(135deg,#10b981,#059669)', color: 'white',
              padding: '14px 20px', borderRadius: '12px', boxShadow: '0 4px 24px rgba(16,185,129,0.4)',
              display: 'flex', alignItems: 'center', gap: '10px',
              animation: 'fadeInRight 0.3s ease',
              maxWidth: '340px', fontSize: '0.9rem', fontWeight: 500
            }}>
              <LuCircleCheck size={20} style={{ flexShrink: 0 }} />
              <div>
                <div style={{ fontWeight: 700 }}>¡Fase PLAN completada!</div>
                <div style={{ opacity: 0.9, fontSize: '0.82rem' }}>La obra avanza automáticamente a la Fase DO.</div>
              </div>
            </div>
          )}

          {/* Banner activación Fase HACER cuando PLAN está completo */}
          {faseDeming === 'plan' && planCompleto && (
            <div className="card" style={{ gridColumn: '1 / -1', background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)', color: 'white', border: 'none' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 'var(--space-3)' }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 700, fontSize: '1.1rem', marginBottom: 'var(--space-1)' }}>
                    <LuCircleCheck size={18} /> Fase PLANIFICAR completada
                  </div>
                  <div style={{ opacity: 0.9, fontSize: '0.9rem' }}>
                    Todos los documentos de la Fase PLAN han sido subidos. La Fase HACER (DO) se activará automáticamente para continuar con la implementación del PTP.
                  </div>
                </div>
                <div style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>
                  {activatingFaseDeming ? 'Activando Fase HACER...' : 'Activación automática en curso'}
                </div>
              </div>
            </div>
          )}

          <div className="card">
            <div className="card-header">
              <div className="card-title">Incidentes y Hallazgos</div>
              <LuShieldAlert className="text-muted" />
            </div>
            {incidentes.length === 0 ? (
              <div className="text-muted">No hay incidentes reportados en esta obra.</div>
            ) : (
              <div style={{ maxHeight: '320px', overflowY: 'auto', paddingRight: 'var(--space-2)', display: 'grid', gap: 'var(--space-3)' }}>
                {incidentes.map((item) => (
                  <div key={item.incidentId} className="card" style={{ padding: 'var(--space-3)' }}>
                    <div className="stat-value">{item.tipo}</div>
                    <div className="stat-label">{item.estado}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <Modal
        isOpen={isDs44ModalOpen}
        onClose={() => {
          setIsDs44ModalOpen(false);
          setPendingDs44File(null);
        }}
        title={selectedDs44Doc?.titulo ? `Documento DS44 - ${selectedDs44Doc.titulo}` : 'Documento DS44'}
        subtitle="Sube el archivo, selecciona firmantes y define caducidad"
        size="lg"
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => setIsDs44ModalOpen(false)} disabled={ds44Saving || uploadingKey === selectedDs44Doc?.key}>
              Cerrar
            </button>
            <button className="btn btn-primary" onClick={handleSaveDs44Changes} disabled={ds44Saving || uploadingKey === selectedDs44Doc?.key}>
              Guardar cambios
            </button>
          </>
        }
      >
        <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
          <div className="ds44-expiry-section">
            <div className="ds44-expiry-toggle">
              <label className="ds44-toggle-label" htmlFor="expiry-toggle">
                <div className="ds44-toggle-text">
                  <span className="ds44-toggle-title">Aplica caducidad</span>
                  <span className="ds44-toggle-hint">
                    {expiryApplicable ? 'Este documento tiene fecha de vencimiento' : 'Sin fecha de vencimiento'}
                  </span>
                </div>
                <div className="ds44-switch-wrapper">
                  <input
                    type="checkbox"
                    id="expiry-toggle"
                    className="ds44-switch-input"
                    checked={expiryApplicable}
                    onChange={(event) => {
                      const checked = event.target.checked;
                      setExpiryApplicable(checked);
                      if (!checked) {
                        setSelectedExpiryDate('');
                      }
                    }}
                  />
                  <span className="ds44-switch-track">
                    <span className="ds44-switch-thumb" />
                  </span>
                </div>
              </label>
            </div>
            <div className={`ds44-date-picker-container ${expiryApplicable ? 'ds44-date-visible' : ''}`}>
              <label className="form-label" style={{ marginBottom: 'var(--space-2)' }}>Fecha de caducidad</label>
              <div className="ds44-date-presets">
                {[
                  { label: '3 meses', months: 3 },
                  { label: '6 meses', months: 6 },
                  { label: '1 año', months: 12 },
                  { label: '2 años', months: 24 },
                ].map((preset) => {
                  const presetDate = new Date();
                  presetDate.setMonth(presetDate.getMonth() + preset.months);
                  const presetValue = presetDate.toISOString().split('T')[0];
                  return (
                    <button
                      key={preset.label}
                      type="button"
                      className={`ds44-date-preset-btn ${selectedExpiryDate === presetValue ? 'active' : ''}`}
                      onClick={() => setSelectedExpiryDate(presetValue)}
                    >
                      {preset.label}
                    </button>
                  );
                })}
              </div>
              <div className="ds44-date-input-wrapper">
                <input
                  className="form-input ds44-date-input"
                  type="date"
                  value={selectedExpiryDate}
                  min={new Date().toISOString().split('T')[0]}
                  onChange={(event) => setSelectedExpiryDate(event.target.value)}
                />
                {selectedExpiryDate && (
                  <div className="ds44-date-display">
                    Caduca el {new Date(selectedExpiryDate + 'T12:00:00').toLocaleDateString('es-CL', { day: 'numeric', month: 'long', year: 'numeric' })}
                  </div>
                )}
              </div>
            </div>
          </div>
          <div
            style={{
              border: '1px dashed var(--surface-border)',
              borderRadius: 'var(--radius-lg)',
              padding: 'var(--space-4)',
              background: 'var(--surface-elevated)',
              display: 'grid',
              gap: 'var(--space-3)'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
              <div className="avatar" style={{ background: 'var(--surface-hover)', color: 'var(--primary-500)' }}>
                <FiUploadCloud size={20} />
              </div>
              <div>
                <div className="font-medium">Subir documento</div>
                <div className="text-muted">
                  {pendingDs44File?.name || selectedDs44Detail?.archivoNombre || 'PDF requerido para completar el DS44'}
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
              <button
                className="btn btn-primary"
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploadingKey === selectedDs44Doc?.key || ds44Loading}
              >
                {pendingDs44File ? 'Cambiar archivo' : selectedDs44Detail?.archivoUrl ? 'Actualizar archivo' : 'Seleccionar archivo'}
              </button>
              <button
                className="btn btn-secondary"
                type="button"
                onClick={handlePreviewDocument}
                disabled={!selectedDs44Detail?.archivoUrl && !selectedDs44Detail?.s3Key || ds44Previewing}
              >
                <FiEye /> Ver documento
              </button>
            </div>
          </div>

          <div style={{ display: 'grid', gap: 'var(--space-2)' }}>
            <div className="font-medium">Firmantes requeridos</div>
            {trabajadores.length === 0 ? (
              <div className="text-muted">No hay trabajadores asignados a esta obra.</div>
            ) : (
              <div style={{ maxHeight: '220px', overflowY: 'auto', border: '1px solid var(--surface-border)', borderRadius: 'var(--radius-md)' }}>
                {trabajadores.map((worker, index) => (
                  <label
                    key={worker.personaId}
                    className="checkbox-row"
                    style={{
                      padding: 'var(--space-2) var(--space-3)',
                      cursor: 'pointer',
                      borderBottom: index === trabajadores.length - 1 ? 'none' : '1px solid var(--surface-border)'
                    }}
                  >
                    <input
                      type="checkbox"
                      className="checkbox-input custom-checkbox"
                      checked={selectedWorkerIds.includes(worker.personaId)}
                      onChange={() => toggleWorkerSelection(worker.personaId)}
                    />
                    <span>{worker.nombre} {worker.apellido || ''}</span>
                    <span className="text-muted">({worker.rut})</span>
                  </label>
                ))}
              </div>
            )}
          </div>

        </div>
      </Modal>

      <input
        ref={fileInputRef}
        type="file"
        accept="application/pdf"
        onChange={handleDs44FileChange}
        style={{ display: 'none' }}
      />

      {/* ── Modal: Firma asistida (trabajador firma con su PIN en el dispositivo del admin) ── */}
      {obraId && user?.personaId && (
        <FirmaAsistidaModal
          isOpen={firmaAsistidaOpen}
          onClose={() => { setFirmaAsistidaOpen(false); setFirmaAsistidaWorkerId(undefined); setFirmaAsistidaTipo(undefined); }}
          obraId={obraId}
          workers={trabajadores}
          asistidoPor={user.personaId}
          initialWorkerId={firmaAsistidaWorkerId}
          initialTipo={firmaAsistidaTipo}
          onSigned={() => { reloadObraData(); }}
        />
      )}

      {/* ── Modal inline: crear procedimiento/evento (documento) o programar capacitación (actividad) ── */}
      <Modal
        isOpen={!!doCreateModal}
        onClose={() => setDoCreateModal(null)}
        title={doCreateModal?.mode === 'actividad' ? (doCreateModal?.el?.activityTipo === 'SIMULACRO' ? 'Programar simulacro' : 'Programar capacitación') : 'Crear / subir documento'}
        subtitle={doCreateModal ? `${doCreateModal.el.titulo} · ${doCreateModal.el.articulo}` : ''}
        size="md"
        footer={
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-2)', width: '100%' }}>
            <button className="btn btn-secondary" onClick={() => setDoCreateModal(null)}>Cancelar</button>
            <button className="btn btn-primary" onClick={submitDoCreate} disabled={doCreateSaving}>
              {doCreateSaving ? 'Guardando…' : doCreateModal?.mode === 'actividad' ? 'Programar' : 'Guardar'}
            </button>
          </div>
        }
      >
        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          {doCreateError && (
            <div style={{ padding: '8px 12px', borderRadius: '8px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', fontSize: '0.82rem', color: '#b91c1c' }}>
              {doCreateError}
            </div>
          )}
          <div className="form-group">
            <label className="form-label">Título</label>
            <input className="form-input" value={doCreateForm.titulo} onChange={(e) => setDoCreateForm((p) => ({ ...p, titulo: e.target.value }))} />
          </div>

          {doCreateModal?.mode === 'actividad' ? (
            <>
              <div className="form-group">
                <label className="form-label">Fecha</label>
                <input type="date" className="form-input" value={doCreateForm.fecha} onChange={(e) => setDoCreateForm((p) => ({ ...p, fecha: e.target.value }))} />
              </div>
              <div className="form-group">
                <label className="form-label">Relator</label>
                <Select
                  ariaLabel="Relator"
                  placeholder="Seleccione un relator"
                  searchable
                  value={doCreateForm.relatorId}
                  onChange={(v) => setDoCreateForm((p) => ({ ...p, relatorId: v }))}
                  options={activeWorkers.map((w) => ({
                    value: w.personaId,
                    label: `${w.nombre} ${w.apellido || ''}`.trim(),
                    description: w.cargo || undefined,
                  }))}
                />
              </div>
              <div className="text-muted" style={{ fontSize: '0.8rem' }}>
                La actividad queda "Programada" hasta que los asistentes firmen su asistencia. Recién ahí cuenta como ejecutada.
              </div>
            </>
          ) : (
            <>
              <div className="form-group">
                <label className="form-label">Descripción</label>
                <textarea className="form-input" rows={3} value={doCreateForm.descripcion} onChange={(e) => setDoCreateForm((p) => ({ ...p, descripcion: e.target.value }))} placeholder="Contenido o resumen del procedimiento…" style={{ resize: 'vertical' }} />
              </div>
              <div className="form-group">
                <label className="form-label">Archivo (opcional)</label>
                <input type="file" className="form-input" accept="application/pdf,image/*" onChange={(e) => setDoCreateForm((p) => ({ ...p, file: e.target.files?.[0] || null }))} />
              </div>
            </>
          )}
        </div>
      </Modal>

      {/* ── Modal: Cerrar investigación Art. 71 (genera informe firmado) ── */}
      <Modal
        isOpen={!!cerrarInvModal}
        onClose={() => { setCerrarInvModal(null); setCerrarInvPin(''); setCerrarInvError(null); setCerrarInvResult(null); }}
        title="Cerrar investigación (Art. 71)"
        subtitle={cerrarInvModal?.descripcion}
        size="md"
        footer={
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-2)', width: '100%' }}>
            <button className="btn btn-secondary" onClick={() => { setCerrarInvModal(null); setCerrarInvPin(''); setCerrarInvError(null); setCerrarInvResult(null); }}>
              {cerrarInvResult ? 'Cerrar' : 'Cancelar'}
            </button>
            {!cerrarInvResult && (
              <button className="btn btn-primary" onClick={handleCerrarInvestigacion} disabled={cerrarInvSaving}>
                {cerrarInvSaving ? 'Firmando…' : 'Cerrar y firmar informe'}
              </button>
            )}
          </div>
        }
      >
        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          <p style={{ fontSize: '0.87rem', color: 'var(--text-muted)', lineHeight: 1.6 }}>
            Se genera el informe de investigación (árbol de causas) con los datos registrados,
            firmado con tu PIN y con hash verificable. El incidente queda <strong>cerrado</strong> y
            el informe se guarda como documento de la obra (respaldo del Registro Art. 72).
          </p>
          {!cerrarInvResult && (
            <div>
              <label className="text-muted" style={{ fontSize: '0.82rem', display: 'block', marginBottom: '4px' }}>Tu PIN de firma</label>
              <input
                type="password"
                inputMode="numeric"
                className="form-input"
                value={cerrarInvPin}
                onChange={(e) => { setCerrarInvPin(e.target.value.replace(/\D/g, '')); setCerrarInvError(null); }}
                placeholder="••••"
                maxLength={8}
                autoComplete="off"
              />
            </div>
          )}
          {cerrarInvError && (
            <div style={{ padding: '8px 12px', borderRadius: '8px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', fontSize: '0.82rem', color: '#b91c1c' }}>
              {cerrarInvError}
            </div>
          )}
          {cerrarInvResult && (
            <div style={{ padding: '8px 12px', borderRadius: '8px', background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.25)', fontSize: '0.78rem', color: '#065f46', wordBreak: 'break-all' }}>
              Investigación cerrada e informe firmado. Token: <strong>{cerrarInvResult.token}</strong><br />
              Hash: {cerrarInvResult.hash}
            </div>
          )}
        </div>
      </Modal>

      {/* ── Modal: Confirmar firma y exportar Registro AT/EP ── */}
      <Modal
        isOpen={registroSignModal}
        onClose={() => { setRegistroSignModal(false); setRegistroPin(''); setRegistroError(null); setRegistroResult(null); }}
        title="Exportar Registro AT/EP"
        subtitle="Arts. 72-73 DS44 — Registro de Accidentes del Trabajo, Enfermedades Profesionales e Incidentes Peligrosos"
        size="md"
        footer={
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-2)', width: '100%' }}>
            <button className="btn btn-secondary" onClick={() => setRegistroSignModal(false)}>
              Cancelar
            </button>
            <button className="btn btn-primary" style={{ display: 'flex', alignItems: 'center', gap: '6px' }} onClick={handleExportRegistroAT} disabled={exportingRegistro}>
              <LuDownload size={14} />
              {exportingRegistro ? 'Generando...' : 'Firmar y Exportar PDF'}
            </button>
          </div>
        }
      >
        <div className="modal-body">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            <div className="card" style={{ padding: 'var(--space-3)', background: 'var(--surface-elevated)', border: '1px solid var(--surface-border)' }}>
              <div style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: '120px' }}>
                  <div className="text-muted" style={{ fontSize: '0.78rem', marginBottom: '2px' }}>Incidentes totales</div>
                  <div style={{ fontSize: '1.4rem', fontWeight: 700 }}>{incidentes.length}</div>
                </div>
                <div style={{ flex: 1, minWidth: '120px' }}>
                  <div className="text-muted" style={{ fontSize: '0.78rem', marginBottom: '2px' }}>Abiertos</div>
                  <div style={{ fontSize: '1.4rem', fontWeight: 700, color: '#f59e0b' }}>
                    {incidentes.filter(i => ['reportado', 'en_investigacion'].includes((i as any).estado)).length}
                  </div>
                </div>
                <div style={{ flex: 1, minWidth: '120px' }}>
                  <div className="text-muted" style={{ fontSize: '0.78rem', marginBottom: '2px' }}>Cerrados</div>
                  <div style={{ fontSize: '1.4rem', fontWeight: 700, color: '#10b981' }}>
                    {incidentes.filter(i => !['reportado', 'en_investigacion'].includes((i as any).estado)).length}
                  </div>
                </div>
              </div>
            </div>
            <p style={{ fontSize: '0.87rem', color: 'var(--text-muted)', lineHeight: 1.6 }}>
              Al confirmar, reconoces haber revisado todos los incidentes registrados en esta obra.
              El sistema consolidará incidentes, actividades e indicadores en un snapshot inmutable
              y registrará tu firma (verificable, con hash) como responsable.
            </p>
            <div>
              <label className="text-muted" style={{ fontSize: '0.82rem', display: 'block', marginBottom: '4px' }}>
                Tu PIN de firma
              </label>
              <input
                type="password"
                inputMode="numeric"
                className="form-input"
                value={registroPin}
                onChange={(e) => { setRegistroPin(e.target.value.replace(/\D/g, '')); setRegistroError(null); }}
                placeholder="••••"
                maxLength={8}
                autoComplete="off"
              />
            </div>
            {registroError && (
              <div style={{ padding: '8px 12px', borderRadius: '8px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', fontSize: '0.82rem', color: '#b91c1c' }}>
                {registroError}
              </div>
            )}
            {registroResult && (
              <div style={{ padding: '8px 12px', borderRadius: '8px', background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.25)', fontSize: '0.78rem', color: '#065f46', wordBreak: 'break-all' }}>
                Registro firmado. Token: <strong>{registroResult.token}</strong><br />
                Hash: {registroResult.hash}
              </div>
            )}
            <div style={{ padding: '10px 14px', borderRadius: '8px', background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.25)', fontSize: '0.82rem', color: '#92400e' }}>
              El documento se abrirá en una nueva pestaña. Usa <strong>Ctrl+P → Guardar como PDF</strong> para descargarlo.
            </div>
          </div>
        </div>
      </Modal>

      {/* ── Modal: Documentos de onboarding generados post-asignación ── */}
      <Modal
        isOpen={!!onboardingUploadModal?.show}
        onClose={() => setOnboardingUploadModal(null)}
        title="Documentos de onboarding generados"
        subtitle={`${onboardingUploadModal?.addedWorkers.length ?? 0} trabajador(es) asignado(s). Puedes subir los archivos ahora o desde el perfil de cada trabajador.`}
        size="lg" 
        footer={
          <div style={{ display: 'flex', justifyContent: 'flex-end', width: '100%' }}>
            <button className="btn btn-primary" onClick={() => setOnboardingUploadModal(null)}>
              Listo
            </button>
          </div>
        }
      >
        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          {DS44_ONBOARDING_ITEMS.map((item) => {
            const isDone = bulkUploadDone[item.tipo];
            const isUploading = bulkUploadingTipo === item.tipo;
            return (
              <div key={item.key} className="card" style={{ padding: 'var(--space-3)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-2)', minWidth: 0 }}>
                  {isDone
                    ? <LuCircleCheck size={16} style={{ color: '#10b981', marginTop: '2px', flexShrink: 0 }} />
                    : item.kind === 'document'
                      ? <LuDownload size={16} style={{ color: 'var(--text-muted)', marginTop: '2px', flexShrink: 0 }} />
                      : <LuClock size={16} style={{ color: 'var(--text-muted)', marginTop: '2px', flexShrink: 0 }} />
                  }
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 500, fontSize: '0.9rem' }}>{item.label}</div>
                    <div className="text-muted" style={{ fontSize: '0.78rem' }}>{item.articulo}</div>
                  </div>
                </div>

                <div style={{ flexShrink: 0 }}>
                  {item.kind === 'document' && !isDone && (
                    <label style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '5px 14px', borderRadius: '8px', border: '1px solid var(--surface-border)', fontSize: '0.82rem', cursor: isUploading ? 'wait' : 'pointer', background: 'var(--surface-elevated)', color: 'var(--text-primary)' }}>
                      {isUploading ? <><LuClock size={13} /> Subiendo...</> : <><LuDownload size={13} /> Subir archivo</>}
                      <input type="file" accept=".pdf,.doc,.docx" style={{ display: 'none' }}
                        disabled={!!bulkUploadingTipo}
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f && onboardingUploadModal) handleBulkOnboardingUpload(item.tipo, f, onboardingUploadModal.addedWorkers);
                          if (e.target) e.target.value = '';
                        }}
                      />
                    </label>
                  )}
                  {item.kind === 'document' && isDone && (
                    <span className="badge badge-success" style={{ fontSize: '0.8rem' }}>Subido</span>
                  )}
                  {item.kind === 'signature' && (
                    <span className="badge badge-secondary" style={{ fontSize: '0.78rem' }}>Solicitud creada</span>
                  )}
                  {item.kind === 'actividad' && (
                    <span className="badge badge-secondary" style={{ fontSize: '0.78rem' }}>Via actividades</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </Modal>

      <Modal
        isOpen={isWorkersModalOpen}
        onClose={() => setIsWorkersModalOpen(false)}
        title="Gestionar trabajadores"
        subtitle="Agrega o da de baja trabajadores asociados a la obra."
        size="lg"
        footer={
          <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
            <div>
              {selectedUnassignedWorkerIds.length > 0 && (
                <button
                  className="btn btn-primary"
                  onClick={() => {
                    const workersToAdd = allWorkers.filter(w => selectedUnassignedWorkerIds.includes(w.personaId));
                    handleAddMultipleWorkers(workersToAdd);
                  }}
                  disabled={updatingWorkers === 'multiple'}
                >
                  Agregar seleccionados ({selectedUnassignedWorkerIds.length})
                </button>
              )}
            </div>
            <button className="btn btn-secondary" onClick={() => setIsWorkersModalOpen(false)}>
              Cerrar
            </button>
          </div>
        }
      >
        <div className="modal-body">
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 'var(--space-3)' }}>
            <div className="text-muted">
              Selecciona trabajadores para agregarlos a la obra.
            </div>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => {
                const unassigned = allWorkers.filter(w => !(Array.isArray(w.obraIds) && w.obraIds.includes(obraId)));
                const unassignedIds = unassigned.map(w => w.personaId);
                if (selectedUnassignedWorkerIds.length === unassignedIds.length && unassignedIds.length > 0) {
                  setSelectedUnassignedWorkerIds([]);
                } else {
                  setSelectedUnassignedWorkerIds(unassignedIds);
                }
              }}
            >
              {(() => {
                const unassignedCount = allWorkers.filter(w => !(Array.isArray(w.obraIds) && w.obraIds.includes(obraId))).length;
                if (unassignedCount === 0) return 'Todos agregados';
                return selectedUnassignedWorkerIds.length === unassignedCount ? 'Deseleccionar todos' : 'Seleccionar todos los disponibles';
              })()}
            </button>
          </div>
          <div style={{ display: 'grid', gap: 'var(--space-3)' }}>
            {allWorkers.map((worker) => {
              const workerId = worker.personaId;
              const isAssigned = Array.isArray(worker.obraIds) && worker.obraIds.includes(obraId);
              const isInactive = worker.estado === 'inactivo';
              const isSelected = selectedUnassignedWorkerIds.includes(workerId);

              return (
                <div key={workerId} className="card" style={{ padding: 'var(--space-3)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                      {!isAssigned && (
                        <input
                          type="checkbox"
                          className="checkbox-input custom-checkbox"
                          checked={isSelected}
                          onChange={() => {
                            setSelectedUnassignedWorkerIds(prev =>
                              prev.includes(workerId) ? prev.filter(id => id !== workerId) : [...prev, workerId]
                            );
                          }}
                          disabled={updatingWorkers === workerId || updatingWorkers === 'multiple'}
                        />
                      )}
                      <div>
                        <div className="font-medium">{worker.nombre} {worker.apellido || ''}</div>
                        <div className="text-muted">{worker.cargo || 'Trabajador'} · {worker.rut}</div>
                      </div>
                    </div>
                    {isAssigned ? (
                      <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                        <span className={`badge ${isInactive ? 'badge-warning' : 'badge-success'}`}>
                          {isInactive ? 'Baja' : 'Activo'}
                        </span>
                        {!isInactive ? (
                          <button
                            className="btn btn-secondary btn-sm"
                            onClick={() => handleDeactivateWorker(worker)}
                            disabled={updatingWorkers === workerId || worker.rol === 'admin'}
                            title={worker.rol === 'admin' ? 'No se puede dar de baja a administradores' : undefined}
                          >
                            Dar de baja
                          </button>
                        ) : (
                          <button
                            className="btn btn-primary btn-sm"
                            onClick={() => handleReactivateWorker(worker)}
                            disabled={updatingWorkers === workerId}
                          >
                            Reactivar
                          </button>
                        )}
                      </div>
                    ) : (
                      <button
                        className="btn btn-primary btn-sm"
                        onClick={() => handleAddWorker(worker)}
                        disabled={updatingWorkers === workerId || updatingWorkers === 'multiple'}
                      >
                        Agregar a obra
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={isSignatureModalOpen}
        onClose={() => setIsSignatureModalOpen(false)}
        title={signatureModalDoc?.titulo ? `Firmas - ${signatureModalDoc.titulo}` : 'Firmas'}
        subtitle="Detalle de firmas solicitadas"
        size="md"
        footer={
          <button className="btn btn-secondary" onClick={() => setIsSignatureModalOpen(false)}>
            Cerrar
          </button>
        }
      >
        <div style={{ display: 'grid', gap: 'var(--space-2)' }}>
          {!signatureModalDoc?.asignaciones?.length ? (
            <div className="text-muted">No hay firmantes asignados.</div>
          ) : (
            signatureModalDoc.asignaciones.map((asignacion: any) => {
              // El estado de firma puede venir de dos formas: document.asignaciones
              // usa `estado: 'firmado'`; request.trabajadores usa `firmado: boolean`.
              const haFirmado = asignacion.estado === 'firmado' || asignacion.firmado === true || Boolean(asignacion.fechaFirma);
              return (
              <div
                key={asignacion.personaId || asignacion.workerId}
                style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
              >
                <div>
                  <div className="font-medium">{asignacion.nombre || 'Trabajador'}</div>
                  <div className="text-muted">{asignacion.rut || ''}</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div className={`badge ${haFirmado ? 'badge-success' : 'badge-warning'}`}>
                    {haFirmado ? 'Firmado' : 'Pendiente'}
                  </div>
                  {asignacion.fechaFirma && (
                    <div className="text-muted" style={{ marginTop: 'var(--space-1)' }}>
                      {formatDate(asignacion.fechaFirma)}
                    </div>
                  )}
                </div>
              </div>
              );
            })
          )}
        </div>
      </Modal>

      {/* Modal subida documentos Fase HACER (DO) */}
      <Modal
        isOpen={isDoModalOpen}
        onClose={() => { setIsDoModalOpen(false); setPendingDoFile(null); }}
        title={selectedDoDoc?.titulo ? `Fase DO — ${selectedDoDoc.titulo}` : 'Documento Fase HACER'}
        subtitle={selectedDoDoc ? `${selectedDoDoc.articulo} · ${selectedDoDoc.descripcion}` : 'Sube el archivo, selecciona firmantes y define vencimiento'}
        size="lg"
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => setIsDoModalOpen(false)} disabled={doSaving}>
              Cerrar
            </button>
            <button className="btn btn-primary" onClick={handleSaveDoChanges} disabled={doSaving}>
              Guardar cambios
            </button>
          </>
        }
      >
        <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label">Vencimiento</label>
            <label className="checkbox-row" style={{ marginTop: 'var(--space-2)' }}>
              <input
                type="checkbox"
                className="checkbox-input custom-checkbox"
                checked={doExpiryNotApplicable}
                onChange={(e) => { setDoExpiryNotApplicable(e.target.checked); if (e.target.checked) setDoExpiryDate(''); }}
              />
              <span>No aplica</span>
            </label>
            {!doExpiryNotApplicable && (
              <input
                className="form-input"
                type="date"
                value={doExpiryDate}
                onChange={(e) => setDoExpiryDate(e.target.value)}
              />
            )}
          </div>
          <div style={{ border: '1px dashed var(--surface-border)', borderRadius: 'var(--radius-lg)', padding: 'var(--space-4)', background: 'var(--surface-elevated)', display: 'grid', gap: 'var(--space-3)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
              <div className="avatar" style={{ background: 'var(--surface-hover)', color: 'var(--primary-500)' }}>
                <FiUploadCloud size={20} />
              </div>
              <div>
                <div className="font-medium">Subir documento</div>
                <div className="text-muted">{pendingDoFile?.name || selectedDoDetail?.archivoNombre || 'PDF requerido'}</div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
              <button className="btn btn-primary" type="button" onClick={() => doFileInputRef.current?.click()} disabled={doLoading}>
                {pendingDoFile ? 'Cambiar archivo' : selectedDoDetail?.archivoUrl ? 'Actualizar archivo' : 'Seleccionar archivo'}
              </button>
              <button className="btn btn-secondary" type="button" onClick={handlePreviewDoDocument} disabled={(!selectedDoDetail?.archivoUrl && !selectedDoDetail?.s3Key) || doPreviewing}>
                <FiEye /> Ver documento
              </button>
            </div>
          </div>
          <div style={{ display: 'grid', gap: 'var(--space-2)' }}>
            <div className="font-medium">Firmantes requeridos</div>
            {trabajadores.length === 0 ? (
              <div className="text-muted">No hay trabajadores asignados a esta obra.</div>
            ) : (
              <div style={{ maxHeight: '220px', overflowY: 'auto', border: '1px solid var(--surface-border)', borderRadius: 'var(--radius-md)' }}>
                {trabajadores.map((worker, index) => (
                  <label key={worker.personaId} className="checkbox-row" style={{ padding: 'var(--space-2) var(--space-3)', cursor: 'pointer', borderBottom: index === trabajadores.length - 1 ? 'none' : '1px solid var(--surface-border)' }}>
                    <input
                      type="checkbox"
                      className="checkbox-input custom-checkbox"
                      checked={doWorkerIds.includes(worker.personaId)}
                      onChange={() => {
                        const id = worker.personaId;
                        setDoWorkerIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
                      }}
                    />
                    <span>{worker.nombre} {worker.apellido || ''}</span>
                    <span className="text-muted">({worker.rut})</span>
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>
      </Modal>

      <input ref={doFileInputRef} type="file" accept="application/pdf" onChange={handleDoFileChange} style={{ display: 'none' }} />

      <Modal
        isOpen={isEditModalOpen}
        onClose={() => setIsEditModalOpen(false)}
        title="Editar obra"
        subtitle="Solo puedes editar nombre, etapa y estado"
        size="md"
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => setIsEditModalOpen(false)}>
              Cancelar
            </button>
            <button className="btn btn-primary" onClick={handleSaveObra}>
              Guardar cambios
            </button>
          </>
        }
      >
        <div style={{ display: 'grid', gap: 'var(--space-3)' }}>
          <div className="form-group">
            <label className="form-label">Nombre</label>
            <input className="form-input" name="nombre" value={editData?.nombre || ''} onChange={handleEditChange} />
          </div>
          <div className="form-group">
            <label className="form-label">Estado</label>
            <SegmentedControl
              ariaLabel="Estado de la obra"
              value={editData?.estado || 'activa'}
              onChange={(v) => setEditData((prev: any) => ({ ...prev, estado: v }))}
              options={[
                { value: 'activa', label: 'Activa' },
                { value: 'pausada', label: 'Pausada' },
                { value: 'finalizada', label: 'Finalizada' },
              ]}
            />
          </div>
          <div className="form-group">
            <label className="form-label">Características DO (definen qué elementos aplican)</label>
            <label className="checkbox-row" style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 0' }}>
              <input type="checkbox" name="faenaCompartida" checked={Boolean(editData?.faenaCompartida)} onChange={handleEditChange} />
              <span>Faena compartida con otra(s) entidad(es) — Art. 20</span>
            </label>
            <label className="checkbox-row" style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 0' }}>
              <input type="checkbox" name="tieneMaquinaria" checked={Boolean(editData?.tieneMaquinaria)} onChange={handleEditChange} />
              <span>Hay máquinas/herramientas motrices — Art. 10</span>
            </label>
            <label className="checkbox-row" style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 0' }}>
              <input type="checkbox" name="agentesFQB" checked={Boolean(editData?.agentesFQB)} onChange={handleEditChange} />
              <span>Existen agentes físicos/químicos/biológicos — Art. 2 N°14 c</span>
            </label>
          </div>
        </div>
      </Modal>
    </>
  );
}
