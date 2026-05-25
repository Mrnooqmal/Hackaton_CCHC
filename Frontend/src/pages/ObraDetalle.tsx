import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import Header from '../components/Header';
import { useAuth } from '../context/AuthContext';
import { activitiesApi, documentsApi, incidentsApi, obrasApi, uploadsApi, workersApi, signatureRequestsApi } from '../api/client';
import { LuArrowLeft, LuBuilding2, LuFileText, LuUsers, LuShieldAlert, LuPencil, LuUserPlus, LuClock, LuChevronUp, LuChevronDown, LuCircleCheck, LuDownload } from 'react-icons/lu';
import { FiUploadCloud, FiEye, FiAlertTriangle } from 'react-icons/fi';
import { Modal } from '../components/ui';
import { DS44_CHECK_ITEM, DS44_ONBOARDING_ITEMS, DS44_PHASE_LABELS, DS44_PLAN_DOCS, type Ds44OnboardingItem } from '../utils/ds44';
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
  const autoAdvanceRef = useRef(false);
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
  // Inline per-worker doc upload
  const [uploadingWorkerDoc, setUploadingWorkerDoc] = useState<string | null>(null); // `${workerId}:${tipo}`
  const [markingDone, setMarkingDone] = useState<string | null>(null); // `${workerId}:${tipo}`
  // Local override map so checklist updates immediately without full refetch
  const [localDoneOverrides, setLocalDoneOverrides] = useState<Record<string, boolean>>({});

  const faseDeming = obra?.faseDeming || 'plan';
  const [selectedDemingPhase, setSelectedDemingPhase] = useState(faseDeming);

  const onboardingSummary = useMemo(() => {
    const activeWorkers = trabajadores.filter((worker) => worker.estado !== 'inactivo');
    if (!activeWorkers.length) {
      return { completed: 0, total: 0, progress: 0, byWorker: [] as any[] };
    }

    const docStatus = new Map<string, boolean>();
    documentosPrevencion.forEach((doc) => {
      const hasFile = Boolean(doc.s3Key || doc.archivoUrl);
      (doc.asignaciones || []).forEach((asig: any) => {
        const personaId = asig.personaId || asig.workerId;
        if (!personaId || !doc.tipo) return;
        const key = `${personaId}:${doc.tipo}`;
        if (asig.estado === 'firmado' || asig.fechaFirma || hasFile) {
          docStatus.set(key, true);
        } else if (!docStatus.has(key)) {
          docStatus.set(key, false);
        }
      });
    });

    const requestStatus = new Map<string, boolean>();
    obraSignatureRequests.forEach((request) => {
      (request.trabajadores || []).forEach((trabajador) => {
        const workerId = trabajador.workerId;
        if (!workerId || !request.tipo) return;
        const key = `${workerId}:${request.tipo}`;
        if (trabajador.firmado) {
          requestStatus.set(key, true);
        } else if (!requestStatus.has(key)) {
          requestStatus.set(key, false);
        }
      });
    });

    let total = 0;
    let completed = 0;

    const byWorker = activeWorkers.map((worker) => {
      const workerId = worker.personaId || worker.workerId;
      let workerTotal = 0;
      let workerCompleted = 0;
      const obraKey = obraId || '';
      const manualOverrides = obraKey ? (worker as any).onboardingDS44?.[obraKey]?.items || {} : {};

      // Check actividades for CAPACITACION (grupal)
      const hasCapacitacion = actividades.some(
        (act: any) => (act.obraId === obraId || !obraId) &&
          (act.tipo === 'CAPACITACION' || act.titulo?.toLowerCase().includes('capacitacion') || act.titulo?.toLowerCase().includes('capacitación')) &&
          (act.asistentes || []).some((a: any) => (a.personaId || a.workerId) === workerId && a.asistio !== false)
      );

      const itemDetail = DS44_ONBOARDING_ITEMS.map((item) => {
        let done = false;
        const overrideKey = `${workerId}:${item.tipo}`;
        const manualDone = Boolean(manualOverrides[item.tipo]);
        const localDone = localDoneOverrides[overrideKey] === true;

        if (item.kind === 'document') {
          const key = `${workerId}:${item.tipo}`;
          done = docStatus.get(key) === true;
        } else if (item.kind === 'signature') {
          const key = `${workerId}:${item.tipo}`;
          done = requestStatus.get(key) === true;
        } else if (item.kind === 'actividad') {
          // CAPACITACION grupal
          done = hasCapacitacion;
        }

        if (manualDone || localDone) {
          done = true;
        }

        workerTotal += 1;
        if (done) workerCompleted += 1;

        return { key: item.key, tipo: item.tipo, label: item.label, articulo: item.articulo, done, kind: item.kind, actionLabel: item.actionLabel, actionRoute: item.actionRoute };
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
  }, [documentosPrevencion, obraSignatureRequests, trabajadores, actividades, obraId, localDoneOverrides]);

  const indicadores = useMemo(() => {
    const pendientesFirma = documentosPrevencion.reduce((total, doc) => {
      const pendientes = (doc.asignaciones || []).filter((a: any) => a.estado !== 'firmado').length;
      return total + pendientes;
    }, 0);
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
  }, [documentosPrevencion, ds44Docs, actividades, incidentes, faseDeming, onboardingSummary]);

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
      } catch (error) {
        console.error('Error loading obra detail:', error);
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [obraId]);

  useEffect(() => {
    setSelectedDemingPhase(faseDeming);
  }, [faseDeming]);

  const reloadDocs = useCallback(async () => {
    if (!obraId) return;
    const docsObraRes = await documentsApi.list({ obraId, clasificacion: 'obra' } as any);
    if (docsObraRes.success && docsObraRes.data) {
      const docsObra = docsObraRes.data.documents || [];
      const mappedDs44 = DS44_PLAN_DOCS.map((required) => {
        const existing = docsObra.find((doc: any) => required.tipos.includes(doc.tipo));
        const hasFile = Boolean(existing?.s3Key || existing?.archivoUrl);
        return { ...required, documentId: existing?.documentId, archivoSubido: hasFile, document: existing };
      });
      setDs44Docs(mappedDs44);
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
          createdBy: user?.userId,
          creatorName: user ? `${user.nombre} ${user.apellido || ''}`.trim() : undefined
        } as any);
        documentId = (createRes as any)?.data?.documentId || documentId;
      }

      if (documentId && doWorkerIds.length > 0) {
        await documentsApi.assign(documentId, {
          workerIds: doWorkerIds,
          fechaLimite: expiryValue,
          notificar: true,
          replace: true,
          assignedBy: user?.userId,
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
        const workerId = worker.personaId || worker.workerId;
        const docsRes = await documentsApi.list({ obraId, workerId } as any);
        if (docsRes.success && docsRes.data) {
          const workerDocs = docsRes.data.documents || [];
          const targetDoc = workerDocs.find((d: any) =>
            d.tipo === tipo &&
            (d.asignaciones || []).some((a: any) => (a.personaId || a.workerId) === workerId)
          );
          if (targetDoc) {
            // Update file + mark the worker's asignacion as firmado so checklist reflects it
            const updatedAsignaciones = (targetDoc.asignaciones || []).map((a: any) =>
              (a.personaId || a.workerId) === workerId
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
    setRegistroSignModal(false);
    setExportingRegistro(true);
    try {
      const html = generateRegistroATHTML();
      const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 30000);

      // Registrar el export como documento firmado en el sistema
      await documentsApi.create({
        obraId,
        clasificacion: 'obra',
        fase: 'hacer',
        tipo: 'REGISTRO_AT_EP',
        titulo: `Registro AT/EP — ${obra?.nombre} — ${new Date().toLocaleDateString('es-CL')}`,
        obligatorio: false,
        estado: 'activo',
        createdBy: user?.userId,
        creatorName: user ? `${user.nombre} ${user.apellido || ''}`.trim() : undefined
      } as any);
    } catch (err) {
      console.error('Error exportando Registro AT/EP:', err);
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
          (d.asignaciones || []).some((a: any) => (a.personaId || a.workerId) === workerId)
        );
        if (targetDoc) {
          const updatedAsignaciones = (targetDoc.asignaciones || []).map((a: any) =>
            (a.personaId || a.workerId) === workerId
              ? { ...a, estado: 'firmado', fechaFirma: new Date().toISOString() }
              : a
          );
          await documentsApi.update(targetDoc.documentId, {
            s3Key: fileKey, archivoUrl: fileKey, archivoNombre: file.name,
            asignaciones: updatedAsignaciones
          } as any);
        }
      }
      setLocalDoneOverrides(prev => ({ ...prev, [key]: true }));
    } catch (err) {
      console.error('Error subiendo doc de onboarding:', err);
    } finally {
      setUploadingWorkerDoc(null);
    }
  };

  const handleMarkItemDone = async (workerId: string, tipo: string, kind: string) => {
    if (!obraId || !obra) return;
    const key = `${workerId}:${tipo}`;
    setMarkingDone(key);
    try {
      if (kind === 'document') return;
      const worker = trabajadores.find((w) => (w.personaId || w.workerId) === workerId);
      if (!worker) throw new Error('Trabajador no encontrado');

      const now = new Date().toISOString();
      const current = (worker as any).onboardingDS44 || {};
      const obraEntry = current[obraId] || {};
      const items = { ...(obraEntry.items || {}) };
      items[tipo] = {
        doneAt: now,
        doneBy: user?.userId,
        source: 'manual'
      };

      const nextOnboarding = {
        ...current,
        [obraId]: {
          ...obraEntry,
          items,
          updatedAt: now
        }
      };

      const res = await workersApi.update(workerId, { onboardingDS44: nextOnboarding } as any);
      if (res.success) {
        setLocalDoneOverrides((prev) => ({ ...prev, [key]: true }));
        const updated = (res.data as any)?.persona;
        const nextOverrides = updated?.onboardingDS44 || nextOnboarding;

        setTrabajadores((prev) => prev.map((w) =>
          (w.personaId || w.workerId) === workerId
            ? { ...w, onboardingDS44: nextOverrides }
            : w
        ));
        setAllWorkers((prev) => prev.map((w) =>
          (w.personaId || w.workerId) === workerId
            ? { ...w, onboardingDS44: nextOverrides }
            : w
        ));
      }
    } catch (err) {
      console.error('Error marcando item como listo:', err);
    } finally {
      setMarkingDone(null);
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

  const getSignatureStats = (doc: any) => {
    const asignaciones = doc?.asignaciones || [];
    const firmadas = asignaciones.filter((asignacion: any) => asignacion.estado === 'firmado' || asignacion.fechaFirma).length;
    return { firmadas, total: asignaciones.length, asignaciones };
  };

  const openDs44Modal = async (doc: Ds44Item) => {
    setSelectedDs44Doc(doc);
    setSelectedDs44Detail(doc.document || null);
    setSelectedWorkerIds((doc.document?.asignaciones || []).map((a: any) => a.personaId || a.workerId));
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
          setSelectedWorkerIds((res.data.asignaciones || []).map((a: any) => a.personaId || a.workerId));
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
          createdBy: user?.userId,
          creatorName: user ? `${user.nombre} ${user.apellido || ''}`.trim() : undefined
        } as any);
        documentId = (createRes as any)?.data?.documentId || (createRes as any)?.data?.id || documentId;
      }

      if (documentId && targetSignerIds.length > 0) {
        await documentsApi.assign(documentId, {
          workerIds: targetSignerIds,
          fechaLimite: expiryValue,
          notificar: true,
          replace: true,
          assignedBy: user?.userId,
          assignerName: user ? `${user.nombre} ${user.apellido || ''}`.trim() : undefined
        } as any);

        // Also create a SignatureRequest so workers see it in "Mis Firmas"
        try {
          const docTitle = selectedDs44Doc.titulo || 'Documento DS44';
          const docAttachments = fileKey ? [{
            nombre: fileName || docTitle,
            url: fileKey,
            tipo: 'application/pdf',
            tamaño: pendingDs44File?.size || 0
          }] : [];

          await signatureRequestsApi.create({
            tipo: 'DOCUMENTO',
            titulo: `Firma requerida: ${docTitle}`,
            descripcion: `Se requiere su firma para el documento DS44 "${docTitle}" de la obra.`,
            documentos: docAttachments,
            trabajadoresIds: targetSignerIds,
            solicitanteId: user?.userId || '',
            fechaLimite: expiryValue || undefined,
            empresaId: obra?.tenantId,
            referenciaId: documentId,
            referenciaTipo: 'document',
            documentId,
          } as any);
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

  const documentosPendientes = ds44Docs.filter((doc) => !doc.archivoSubido);
  const documentosVencidos = ds44Docs.filter((doc) => {
    const fechaCaducidad = getDocExpiryDate(doc.document);
    if (!fechaCaducidad) return false;
    return new Date(fechaCaducidad) < new Date();
  });
  const ds44Total = ds44Docs.length;
  const ds44Uploaded = ds44Total - documentosPendientes.length;
  const ds44Progress = ds44Total > 0 ? Math.round((ds44Uploaded / ds44Total) * 100) : 0;
  const documentosPendientesTitulos = documentosPendientes.map((doc) => doc.titulo);
  const inactiveWorkers = trabajadores.filter((worker) => worker.estado === 'inactivo');
  const activeWorkers = trabajadores.filter((worker) => worker.estado !== 'inactivo');


  // Fase 2 (DO) progress — disponible para uso futuro en JSX
  const planCompleto = ds44Docs.length > 0 && ds44Docs.every((doc) => doc.archivoSubido);
  const doPendientes = doDocs.filter((doc) => !doc.archivoSubido);
  const doTotal = doDocs.length;
  const doUploaded = doTotal - doPendientes.length;
  void doUploaded; // reservado para indicador de fase DO

  const faseLabel = DS44_PHASE_LABELS[selectedDemingPhase] || selectedDemingPhase.toUpperCase();
  const isPlanPhase = selectedDemingPhase === 'plan';
  const isDoPhase = selectedDemingPhase === 'hacer';
  const isCheckPhase = selectedDemingPhase === 'verificar';

  const FASES_DEMING = [
    { key: 'plan', label: 'PLANIFICAR', short: 'PLAN' },
    { key: 'hacer', label: 'HACER', short: 'DO' },
    { key: 'verificar', label: 'VERIFICAR', short: 'CHECK' },
    { key: 'actuar', label: 'ACTUAR', short: 'ACT' },
  ];
  const idxFaseDeming = FASES_DEMING.findIndex(f => f.key === faseDeming);

  useEffect(() => {
    if (!obraId) return;
    if (faseDeming !== 'plan' || !planCompleto) {
      autoAdvanceRef.current = false;
      return;
    }
    if (activatingFaseDeming || autoAdvanceRef.current) return;

    autoAdvanceRef.current = true;
    handleActivarFaseHacer();
  }, [obraId, faseDeming, planCompleto, activatingFaseDeming, handleActivarFaseHacer]);

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
      etapaActual: obra.etapaActual || 'excavacion',
      estado: obra.estado || 'activa'
    });
    setIsEditModalOpen(true);
  };

  const handleEditChange = (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = event.target;
    setEditData((prev: any) => ({ ...prev, [name]: value }));
  };

  const handleSaveObra = async () => {
    if (!obraId || !editData) return;
    const res = await obrasApi.update(obraId, {
      nombre: editData.nombre,
      etapaActual: editData.etapaActual,
      estado: editData.estado
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
    setUpdatingWorkers(worker.personaId || worker.workerId);
    try {
      const obraIds = Array.isArray(worker.obraIds) ? worker.obraIds : [];
      if (!obraIds.includes(obraId)) {
        await workersApi.update(worker.personaId || worker.workerId, {
          obraIds: [...obraIds, obraId],
          estado: 'activo',
          solicitanteId: user?.userId
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
          await workersApi.update(worker.personaId || worker.workerId, {
            obraIds: [...obraIds, obraId],
            estado: 'activo',
            solicitanteId: user?.userId
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

      await workersApi.update(worker.personaId || worker.workerId, {
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
        solicitanteId: user?.userId
      } as any;
      await workersApi.update(worker.personaId || worker.workerId, updated);
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
              <div className="text-muted" style={{ marginTop: 'var(--space-3)' }}>Etapa actual</div>
              <div className="badge badge-info" style={{ width: 'fit-content', textTransform: 'capitalize' }}>
                {obra.etapaActual?.replace('_', ' ') || '-'}
              </div>
              <div className="text-muted" style={{ marginTop: 'var(--space-3)' }}>Estado</div>
              <div className="badge badge-success" style={{ width: 'fit-content' }}>{obra.estado || '-'}</div>
            </>
          </div>

          <div className="card">
            <div className="card-header">
              <div className="card-title">Trabajadores Asignados</div>
              <LuUsers className="text-muted" />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 'var(--space-3)' }}>
              <div className="text-muted">{trabajadores.length} trabajadores asociados</div>
              <button
                className="btn btn-sm"
                style={{ backgroundColor: 'var(--success-500, #10b981)', color: 'white', border: 'none' }}
                onClick={() => setIsWorkersModalOpen(true)}
              >
                <LuUserPlus />
                Gestionar
              </button>
            </div>
            {trabajadores.length === 0 ? (
              <div className="text-muted">No hay trabajadores asociados a esta obra.</div>
            ) : (
              <div style={{ maxHeight: '360px', overflowY: 'auto', paddingRight: 'var(--space-2)' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                  {activeWorkers.map((worker) => (
                    <div key={worker.personaId || worker.workerId} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
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
                        <div key={worker.personaId || worker.workerId} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
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
                    <div className="text-muted">{ds44Uploaded}/{ds44Total} documentos subidos</div>
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
                  {(documentosPendientes.length > 0 || documentosVencidos.length > 0) && (
                    <div className="ds44-alerts">
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
                <div style={{ maxHeight: '360px', overflowY: 'auto', paddingRight: 'var(--space-2)' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                    {ds44Docs.map((doc) => {
                      const { firmadas, total } = getSignatureStats(doc.document);
                      const fechaCaducidad = getDocExpiryDate(doc.document);
                      const isExpired = Boolean(fechaCaducidad && new Date(fechaCaducidad) < new Date());
                      const showSignatureDetails = total > 0;
                      const firmasCompletas = total > 0 && firmadas === total;
                      const firmasClass = total === 0
                        ? 'signature-counter signature-counter-neutral'
                        : firmasCompletas
                          ? 'signature-counter signature-counter-complete'
                          : 'signature-counter signature-counter-pending';
                      return (
                        <div key={doc.key} className="card" style={{ padding: 'var(--space-3)' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-3)', alignItems: 'flex-start' }}>
                            <div>
                              <div className="font-medium">{doc.titulo}</div>
                              <div className="text-muted">{doc.estadoFirma}</div>
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)', marginTop: 'var(--space-2)' }}>
                                <span className={`ds44-card-status ${doc.archivoSubido ? 'ds44-card-status-ok' : 'ds44-card-status-danger'}`}>
                                  <span className="ds44-card-status-dot" />
                                  {doc.archivoSubido ? 'Archivo cargado' : 'Documento obligatorio ausente'}
                                </span>
                                {fechaCaducidad && (
                                  <span className={`ds44-card-status ${isExpired ? 'ds44-card-status-danger' : 'ds44-card-status-ok'}`}>
                                    <span className="ds44-card-status-dot" />
                                    {isExpired ? 'Vencido' : 'Caduca'}: {formatDate(fechaCaducidad)}
                                  </span>
                                )}
                              </div>
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 'var(--space-2)' }}>
                              <span className={`badge ${doc.archivoSubido ? 'badge-success' : 'badge-danger'}`}>
                                {doc.archivoSubido ? 'Cargado' : 'Pendiente'}
                              </span>
                              {isExpired && (
                                <span className="badge badge-danger">Vencido</span>
                              )}
                            </div>
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 'var(--space-3)' }}>
                            <div className={firmasClass}>
                              Firmas: {firmadas}/{total}
                            </div>
                          </div>
                          <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-3)' }}>
                            <button
                              className={doc.archivoSubido ? 'btn btn-secondary' : 'btn btn-primary'}
                              type="button"
                              onClick={() => openDs44Modal(doc)}
                            >
                              {doc.archivoSubido ? 'Actualizar documento' : 'Subir documento'}
                            </button>
                            <button
                              className="btn btn-secondary"
                              type="button"
                              disabled={!doc.archivoSubido || ds44Previewing}
                              onClick={() => handlePreviewDocumentFromCard(doc)}
                            >
                              Ver documento
                            </button>
                            {showSignatureDetails && (
                              <button
                                className="btn btn-secondary"
                                type="button"
                                onClick={() => openSignatureModal(doc)}
                              >
                                Detalle de firmas
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
                        <div className="font-medium">Registro AT/EP/Incidentes Peligrosos</div>
                      </div>
                      <div className="text-muted" style={{ fontSize: '0.8rem', marginBottom: 'var(--space-2)' }}>
                        Arts. 72-73 DS44 &middot; Generado automáticamente desde los incidentes registrados en esta obra.
                      </div>
                      <div style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
                        <span style={{ fontSize: '0.82rem' }}>
                          <span style={{ fontWeight: 600 }}>{incidentes.length}</span>
                          <span className="text-muted"> incidente{incidentes.length !== 1 ? 's' : ''} total{incidentes.length !== 1 ? 'es' : ''}</span>
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

                {/* ── Sección B: Onboarding por trabajador ─────────────────── */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: 'var(--space-3) 0 var(--space-2)' }}>
                  <div className="font-medium">Onboarding de trabajadores</div>
                  <div className="text-muted" style={{ fontSize: '0.85rem' }}>
                    {onboardingSummary.completed}/{onboardingSummary.total} completados
                    {onboardingSummary.total > 0 && ` · ${onboardingSummary.progress}%`}
                  </div>
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
                              {((worker as any).itemDetail as Array<Ds44OnboardingItem & { done: boolean }>).map((item) => (
                                <div key={item.key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--surface-border)', gap: 'var(--space-2)' }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', minWidth: 0 }}>
                                    {item.done
                                      ? <LuCircleCheck size={16} style={{ color: '#10b981', flexShrink: 0 }} />
                                      : <LuClock size={16} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                                    }
                                    <div style={{ minWidth: 0 }}>
                                      <div style={{ fontSize: '0.87rem', fontWeight: item.done ? 400 : 500, color: item.done ? 'var(--text-muted)' : 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                        {item.label}
                                      </div>
                                      <div className="text-muted" style={{ fontSize: '0.75rem' }}>{item.articulo}</div>
                                    </div>
                                  </div>
                                  {!item.done && (
                                    item.kind === 'document' ? (
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
                                          style={{ padding: '2px 10px', fontSize: '0.78rem', flexShrink: 0 }}
                                          disabled={uploadingWorkerDoc === `${worker.workerId}:${item.tipo}`}
                                          onClick={() => document.getElementById(`wd-${worker.workerId}-${item.key}`)?.click()}
                                        >
                                          {uploadingWorkerDoc === `${worker.workerId}:${item.tipo}` ? '...' : 'Subir'}
                                        </button>
                                      </>
                                    ) : (
                                      <button
                                        className="btn btn-secondary"
                                        style={{ padding: '2px 10px', fontSize: '0.78rem', flexShrink: 0 }}
                                        disabled={markingDone === `${worker.workerId}:${item.tipo}`}
                                        onClick={() => handleMarkItemDone(worker.workerId, item.tipo, item.kind)}
                                      >
                                        {markingDone === `${worker.workerId}:${item.tipo}` ? '...' : 'Marcar listo'}
                                      </button>
                                    )
                                  )}
                                  {item.done && (
                                    <LuCircleCheck size={16} style={{ color: '#10b981', flexShrink: 0 }} />
                                  )}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}


            {isCheckPhase && (
              <div className="card" style={{ padding: 'var(--space-4)', background: 'var(--surface-elevated)' }}>
                <div className="font-medium" style={{ marginBottom: 'var(--space-2)' }}>{DS44_CHECK_ITEM.titulo}</div>
                <div className="text-muted" style={{ marginBottom: 'var(--space-3)' }}>{DS44_CHECK_ITEM.descripcion}</div>
                <div className="text-xs text-muted">{DS44_CHECK_ITEM.articulo}</div>
                <div className="text-muted" style={{ marginTop: 'var(--space-3)' }}>
                  {activeWorkers.length > 100
                    ? 'Requiere evaluacion anual. Marca los resultados en la ficha de obra.'
                    : 'No aplica: obra con menos de 100 trabajadores.'}
                </div>
              </div>
            )}
          </div>

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

          <div className="card">
            <div className="card-header">
              <div className="card-title">Documentos de Prevencion</div>
              <LuFileText className="text-muted" />
            </div>
            {documentosPrevencion.length === 0 ? (
              <div className="text-muted">No hay documentos diarios asociados.</div>
            ) : (
              <div style={{ maxHeight: '280px', overflowY: 'auto', paddingRight: 'var(--space-2)', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                {documentosPrevencion.map((doc) => (
                  <div key={doc.documentId} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div className="font-medium">{doc.titulo}</div>
                    </div>
                    <span className="badge badge-neutral">{doc.estado || 'activo'}</span>
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
                    key={worker.personaId || worker.workerId}
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
                      checked={selectedWorkerIds.includes(worker.personaId || worker.workerId)}
                      onChange={() => toggleWorkerSelection(worker.personaId || worker.workerId)}
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

      {/* ── Modal: Confirmar firma y exportar Registro AT/EP ── */}
      <Modal
        isOpen={registroSignModal}
        onClose={() => setRegistroSignModal(false)}
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
              El sistema generará el PDF oficial y registrará tu firma como Prevencionista responsable.
            </p>
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
                    const workersToAdd = allWorkers.filter(w => selectedUnassignedWorkerIds.includes(w.personaId || w.workerId));
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
                const unassignedIds = unassigned.map(w => w.personaId || w.workerId);
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
              const workerId = worker.personaId || worker.workerId;
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
            signatureModalDoc.asignaciones.map((asignacion: any) => (
              <div
                key={asignacion.personaId || asignacion.workerId}
                style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
              >
                <div>
                  <div className="font-medium">{asignacion.nombre || 'Trabajador'}</div>
                  <div className="text-muted">{asignacion.rut || ''}</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div className={`badge ${asignacion.estado === 'firmado' ? 'badge-success' : 'badge-warning'}`}>
                    {asignacion.estado === 'firmado' ? 'Firmado' : 'Pendiente'}
                  </div>
                  {asignacion.fechaFirma && (
                    <div className="text-muted" style={{ marginTop: 'var(--space-1)' }}>
                      {formatDate(asignacion.fechaFirma)}
                    </div>
                  )}
                </div>
              </div>
            ))
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
                  <label key={worker.personaId || worker.workerId} className="checkbox-row" style={{ padding: 'var(--space-2) var(--space-3)', cursor: 'pointer', borderBottom: index === trabajadores.length - 1 ? 'none' : '1px solid var(--surface-border)' }}>
                    <input
                      type="checkbox"
                      className="checkbox-input custom-checkbox"
                      checked={doWorkerIds.includes(worker.personaId || worker.workerId)}
                      onChange={() => {
                        const id = worker.personaId || worker.workerId;
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
            <label className="form-label">Etapa actual</label>
            <select className="form-input form-select" name="etapaActual" value={editData?.etapaActual || 'excavacion'} onChange={handleEditChange}>
              <option value="excavacion">Excavacion</option>
              <option value="obra_gruesa">Obra gruesa</option>
              <option value="terminaciones">Terminaciones</option>
              <option value="entrega">Entrega</option>
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Estado</label>
            <select className="form-input form-select" name="estado" value={editData?.estado || 'activa'} onChange={handleEditChange}>
              <option value="activa">Activa</option>
              <option value="pausada">Pausada</option>
              <option value="finalizada">Finalizada</option>
            </select>
          </div>
        </div>
      </Modal>
    </>
  );
}
