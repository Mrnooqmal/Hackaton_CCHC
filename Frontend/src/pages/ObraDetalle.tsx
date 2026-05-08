import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import Header from '../components/Header';
import { useAuth } from '../context/AuthContext';
import { activitiesApi, documentsApi, incidentsApi, obrasApi, uploadsApi, workersApi } from '../api/client';
import { LuArrowLeft, LuBuilding2, LuFileText, LuUsers, LuShieldAlert, LuPencil, LuUserPlus } from 'react-icons/lu';
import { FiUploadCloud, FiEye } from 'react-icons/fi';
import { Modal } from '../components/ui';

const REQUIRED_DS44 = [
  {
    key: 'POLITICA_SSO',
    tipos: ['POLITICA_SSO'],
    titulo: 'Politica de Seguridad y Salud en el Trabajo',
    estadoFirma: 'Firmada por el representante legal'
  },
  {
    key: 'DIAGNOSTICO_LEGAL',
    tipos: ['DIAGNOSTICO_LEGAL'],
    titulo: 'Diagnostico de aspectos legales',
    estadoFirma: 'Consultar quien los firma'
  },
  {
    key: 'MIPER',
    tipos: ['MIPER', 'MATRIZ_MIPPER'],
    titulo: 'MIPER',
    estadoFirma: 'Firmada Trabajadores, Comite, delegado y sindicato'
  },
  {
    key: 'MAPA_RIESGOS',
    tipos: ['MAPA_RIESGOS'],
    titulo: 'Mapa de Riesgos',
    estadoFirma: 'No firmable (confirmar)'
  },
  {
    key: 'REGLAMENTO_INTERNO',
    tipos: ['REGLAMENTO_INTERNO'],
    titulo: 'Reglamento Interno de Higiene y Seguridad',
    estadoFirma: 'Firmada Trabajadores, Comite, delegado y sindicato'
  }
];

interface Ds44Item {
  key: string;
  tipos: string[];
  titulo: string;
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

  const faseActual = obra?.etapaActual || 'excavacion';

  const indicadores = useMemo(() => {
    const pendientesFirma = documentosPrevencion.reduce((total, doc) => {
      const pendientes = (doc.asignaciones || []).filter((a: any) => a.estado !== 'firmado').length;
      return total + pendientes;
    }, 0);
    const ds44Pendientes = ds44Docs.filter((doc) => !doc.archivoSubido).length;
    const mesActual = new Date().toISOString().slice(0, 7);
    const actividadesMes = actividades.filter((act) => act.fecha?.startsWith(mesActual)).length;
    const incidentesAbiertos = incidentes.filter((inc) => ['reportado', 'en_investigacion'].includes(inc.estado)).length;

    return [
      { label: 'Firmas pendientes', value: String(pendientesFirma) },
      { label: 'Documentos DS44 pendientes', value: String(ds44Pendientes) },
      { label: 'Actividades del mes', value: String(actividadesMes) },
      { label: 'Incidentes abiertos', value: String(incidentesAbiertos) }
    ];
  }, [documentosPrevencion, ds44Docs, actividades, incidentes]);

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
        const mappedDs44 = REQUIRED_DS44.map((required) => {
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

        const docsPrev = docsPrevRes.success && docsPrevRes.data ? docsPrevRes.data.documents || [] : [];
        setDocumentosPrevencion(docsPrev);

        const workers = workersRes.success && workersRes.data ? workersRes.data : [];
        setAllWorkers(workers);
        const asignados = workers.filter((worker: any) => Array.isArray(worker.obraIds) && worker.obraIds.includes(obraId));
        setTrabajadores(asignados);

        const incItems = incidentsRes.success && incidentsRes.data ? incidentsRes.data : [];
        setIncidentes(incItems.filter((inc: any) => inc.obraId === obraId));

        const actItems = activitiesRes.success && activitiesRes.data ? activitiesRes.data.activities || [] : [];
        setActividades(actItems.filter((act: any) => act.obraId === obraId));
      } catch (error) {
        console.error('Error loading obra detail:', error);
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [obraId]);

  const reloadDocs = async () => {
    if (!obraId) return;
    const docsObraRes = await documentsApi.list({ obraId, clasificacion: 'obra' } as any);
    if (docsObraRes.success && docsObraRes.data) {
      const docsObra = docsObraRes.data.documents || [];
      const mappedDs44 = REQUIRED_DS44.map((required) => {
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
    }
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
    const earliest = fechas.reduce((min, current) => (current < min ? current : min), fechas[0]);
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
          fase: faseActual,
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
          estado: 'activo'
        } as any);
      }
      const refreshed = await workersApi.list();
      if (refreshed.success && refreshed.data) {
        const workers = refreshed.data as any[];
        setAllWorkers(workers);
        setTrabajadores(workers.filter((w: any) => Array.isArray(w.obraIds) && w.obraIds.includes(obraId)));
      }
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
            estado: 'activo'
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
        obraIds: obraIds.includes(obraId) ? obraIds : [...obraIds, obraId]
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
            )}
          </div>

          <div className="card" style={{ gridColumn: '1 / -1' }}>
            <div className="card-header">
              <div className="card-title">Documentos DS44</div>
              <LuFileText className="text-muted" />
            </div>
            <div style={{ display: 'grid', gap: 'var(--space-2)', marginBottom: 'var(--space-3)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-3)' }}>
                <div className="font-medium">Progreso DS44</div>
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
              {documentosPendientes.length > 0 && (
                <div className="alert alert-danger">
                  Documentos faltantes: {documentosPendientesTitulos.join(', ')}.
                </div>
              )}
              {documentosVencidos.length > 0 && (
                <div className="alert alert-danger">
                  Hay {documentosVencidos.length} documento{documentosVencidos.length === 1 ? '' : 's'} DS44 vencido{documentosVencidos.length === 1 ? '' : 's'}.
                </div>
              )}
            </div>
            <div style={{ maxHeight: '360px', overflowY: 'auto', paddingRight: 'var(--space-2)' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                {ds44Docs.map((doc) => {
                  const { firmadas, total, asignaciones } = getSignatureStats(doc.document);
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
                        <div className={doc.archivoSubido ? 'text-muted' : 'text-danger-500'} style={{ marginTop: 'var(--space-1)' }}>
                          {doc.archivoSubido ? 'Archivo cargado' : 'Documento obligatorio ausente'}
                        </div>
                        <div className={isExpired ? 'text-danger-500' : 'text-muted'} style={{ marginTop: 'var(--space-1)' }}>
                          Vencimiento: {formatDate(fechaCaducidad)}
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
          </div>

          <div className="card">
            <div className="card-header">
              <div className="card-title">Incidentes y Hallazgos</div>
              <LuShieldAlert className="text-muted" />
            </div>
            {incidentes.length === 0 ? (
              <div className="text-muted">No hay incidentes reportados en esta obra.</div>
            ) : (
              <div style={{ display: 'grid', gap: 'var(--space-3)' }}>
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
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                {documentosPrevencion.map((doc) => (
                  <div key={doc.documentId} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div className="font-medium">{doc.titulo}</div>
                      <div className="text-muted">{doc.estado || 'activo'}</div>
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
