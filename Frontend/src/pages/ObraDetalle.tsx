import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import Header from '../components/Header';
import { useAuth } from '../context/AuthContext';
import { activitiesApi, documentsApi, incidentsApi, obrasApi, uploadsApi, workersApi } from '../api/client';
import { LuArrowLeft, LuBuilding2, LuFileText, LuUsers, LuShieldAlert, LuPencil, LuUserPlus, LuX } from 'react-icons/lu';

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
  const [selectedDoc, setSelectedDoc] = useState<Ds44Item | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editData, setEditData] = useState<any | null>(null);
  const [isWorkersModalOpen, setIsWorkersModalOpen] = useState(false);
  const [updatingWorkers, setUpdatingWorkers] = useState<string | null>(null);

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
            archivoSubido: hasFile
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
          archivoSubido: hasFile
        };
      });
      setDs44Docs(mappedDs44);
    }
  };

  const handleSelectFile = (doc: Ds44Item) => {
    setSelectedDoc(doc);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
      fileInputRef.current.click();
    }
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !selectedDoc || !obraId) return;

    setUploadingKey(selectedDoc.key);
    try {
      const uploadUrlRes = await uploadsApi.getUploadUrl({
        fileName: file.name,
        fileType: file.type,
        fileSize: file.size,
        categoria: 'obras',
        empresaId: obra?.tenantId
      });

      if (!uploadUrlRes.success || !uploadUrlRes.data) {
        throw new Error(uploadUrlRes.error || 'Error al obtener URL de subida');
      }

      const uploadResult = await fetch(uploadUrlRes.data.uploadUrl, {
        method: 'PUT',
        body: file,
        headers: { 'Content-Type': file.type }
      });

      if (!uploadResult.ok) {
        throw new Error('Error al subir archivo');
      }

      const fileKey = uploadUrlRes.data.fileKey;
      await uploadsApi.confirmUpload({
        fileKey,
        fileName: file.name,
        fileType: file.type,
        fileSize: file.size
      });

      if (selectedDoc.documentId) {
        await documentsApi.update(selectedDoc.documentId, {
          s3Key: fileKey,
          archivoUrl: fileKey,
          archivoNombre: file.name
        } as any);
      } else {
        await documentsApi.create({
          obraId,
          clasificacion: 'obra',
          fase: faseActual,
          tipo: selectedDoc.tipos[0],
          obligatorio: true,
          titulo: selectedDoc.titulo,
          archivoUrl: fileKey,
          archivoNombre: file.name,
          createdBy: user?.userId,
          creatorName: user ? `${user.nombre} ${user.apellido || ''}`.trim() : undefined
        } as any);
      }

      await reloadDocs();
    } catch (error) {
      console.error('Error uploading documento DS44:', error);
    } finally {
      setUploadingKey(null);
      setSelectedDoc(null);
    }
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
  const inactiveWorkers = trabajadores.filter((worker) => worker.estado === 'inactivo');
  const activeWorkers = trabajadores.filter((worker) => worker.estado !== 'inactivo');

  const handleEditToggle = () => {
    setIsEditing((prev) => !prev);
    setEditData({
      nombre: obra.nombre || '',
      codigo: obra.codigo || '',
      direccion: obra.direccion || '',
      comuna: obra.comuna || '',
      region: obra.region || '',
      etapaActual: obra.etapaActual || 'excavacion',
      estado: obra.estado || 'activa',
      mandante: obra.mandante || ''
    });
  };

  const handleEditChange = (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = event.target;
    setEditData((prev: any) => ({ ...prev, [name]: value }));
  };

  const handleSaveObra = async () => {
    if (!obraId || !editData) return;
    const res = await obrasApi.update(obraId, {
      nombre: editData.nombre,
      codigo: editData.codigo,
      direccion: editData.direccion,
      comuna: editData.comuna,
      region: editData.region,
      etapaActual: editData.etapaActual,
      estado: editData.estado
    });
    if (res.success && res.data?.obra) {
      setObra(res.data.obra);
    } else if (res.success && res.data) {
      setObra(res.data);
    }
    setIsEditing(false);
  };

  const handleAddWorker = async (worker: any) => {
    if (!obraId) return;
    setUpdatingWorkers(worker.personaId);
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

  const handleDeactivateWorker = async (worker: any) => {
    if (!obraId) return;
    setUpdatingWorkers(worker.personaId);
    try {
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
              Codigo {obra.codigo || '-'} · {obra.comuna || '-'}, {obra.region || '-'} · ID {obraId}
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

        <div style={{ display: 'grid', gap: 'var(--space-5)', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))' }}>
          <div className="card">
            <div className="card-header">
              <div className="card-title">Resumen de Obra</div>
              <button className="btn btn-ghost btn-sm" onClick={handleEditToggle}>
                <LuPencil />
                {isEditing ? 'Cancelar' : 'Editar'}
              </button>
            </div>
            {isEditing && editData ? (
              <div style={{ display: 'grid', gap: 'var(--space-3)' }}>
                <div className="form-group">
                  <label className="form-label">Nombre</label>
                  <input className="form-input" name="nombre" value={editData.nombre} onChange={handleEditChange} />
                </div>
                <div className="form-group">
                  <label className="form-label">Codigo</label>
                  <input className="form-input" name="codigo" value={editData.codigo} onChange={handleEditChange} />
                </div>
                <div className="form-group">
                  <label className="form-label">Direccion</label>
                  <input className="form-input" name="direccion" value={editData.direccion} onChange={handleEditChange} />
                </div>
                <div className="form-group">
                  <label className="form-label">Region</label>
                  <input className="form-input" name="region" value={editData.region} onChange={handleEditChange} />
                </div>
                <div className="form-group">
                  <label className="form-label">Comuna</label>
                  <input className="form-input" name="comuna" value={editData.comuna} onChange={handleEditChange} />
                </div>
                <div className="form-group">
                  <label className="form-label">Etapa actual</label>
                  <select className="form-input form-select" name="etapaActual" value={editData.etapaActual} onChange={handleEditChange}>
                    <option value="excavacion">Excavacion</option>
                    <option value="obra_gruesa">Obra gruesa</option>
                    <option value="terminaciones">Terminaciones</option>
                    <option value="entrega">Entrega</option>
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Estado</label>
                  <select className="form-input form-select" name="estado" value={editData.estado} onChange={handleEditChange}>
                    <option value="activa">Activa</option>
                    <option value="pausada">Pausada</option>
                    <option value="finalizada">Finalizada</option>
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Mandante</label>
                  <input className="form-input" name="mandante" value={editData.mandante} disabled />
                </div>
                <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                  <button className="btn btn-primary" type="button" onClick={handleSaveObra}>Guardar cambios</button>
                  <button className="btn btn-secondary" type="button" onClick={handleEditToggle}>Cancelar</button>
                </div>
              </div>
            ) : (
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
            )}
          </div>

          <div className="card">
            <div className="card-header">
              <div className="card-title">Documentos DS44</div>
              <LuFileText className="text-muted" />
            </div>
            {documentosPendientes.length > 0 && (
              <div className="alert alert-warning">
                Faltan {documentosPendientes.length} documentos obligatorios por subir.
              </div>
            )}
            <div style={{ maxHeight: '360px', overflowY: 'auto', paddingRight: 'var(--space-2)' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                {ds44Docs.map((doc) => (
                  <div key={doc.key} className="card" style={{ padding: 'var(--space-3)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-3)', alignItems: 'flex-start' }}>
                      <div>
                        <div className="font-medium">{doc.titulo}</div>
                        <div className="text-muted">{doc.estadoFirma}</div>
                        <div className="text-muted" style={{ marginTop: 'var(--space-1)' }}>
                          {doc.archivoSubido ? 'Archivo cargado' : 'Documento obligatorio ausente'}
                        </div>
                      </div>
                      <span className={`badge ${doc.archivoSubido ? 'badge-success' : 'badge-warning'}`}>
                        {doc.archivoSubido ? 'Cargado' : 'Pendiente'}
                      </span>
                    </div>
                    <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-3)' }}>
                      <button
                        className={doc.archivoSubido ? 'btn btn-secondary' : 'btn btn-primary'}
                        type="button"
                        onClick={() => handleSelectFile(doc)}
                        disabled={uploadingKey === doc.key}
                      >
                        {doc.archivoSubido ? 'Actualizar archivo' : 'Subir archivo'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-header">
              <div className="card-title">Trabajadores Asignados</div>
              <LuUsers className="text-muted" />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 'var(--space-3)' }}>
              <div className="text-muted">{trabajadores.length} trabajadores asociados</div>
              <button className="btn btn-ghost btn-sm" onClick={() => setIsWorkersModalOpen(true)}>
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
                        disabled={updatingWorkers === worker.personaId}
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
                        <span className="badge badge-warning">Baja</span>
                      </div>
                    ))}
                  </div>
                )}
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
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="application/pdf"
        onChange={handleFileChange}
        style={{ display: 'none' }}
      />

      {isWorkersModalOpen && (
        <div className="modal-overlay">
          <div className="modal-content max-w-3xl">
            <div className="modal-header">
              <div>
                <h2 className="modal-title">Gestionar trabajadores</h2>
                <p className="modal-subtitle">Agrega o da de baja trabajadores asociados a la obra.</p>
              </div>
              <button className="btn btn-ghost btn-sm" onClick={() => setIsWorkersModalOpen(false)}>
                <LuX />
              </button>
            </div>
            <div className="modal-body">
              <div style={{ display: 'grid', gap: 'var(--space-3)' }}>
                {allWorkers.map((worker) => {
                  const isAssigned = Array.isArray(worker.obraIds) && worker.obraIds.includes(obraId);
                  const isInactive = worker.estado === 'inactivo';
                  return (
                    <div key={worker.personaId || worker.workerId} className="card" style={{ padding: 'var(--space-3)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                          <div className="font-medium">{worker.nombre} {worker.apellido || ''}</div>
                          <div className="text-muted">{worker.cargo || 'Trabajador'} · {worker.rut}</div>
                        </div>
                        {isAssigned ? (
                          <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                            <span className={`badge ${isInactive ? 'badge-warning' : 'badge-success'}`}>
                              {isInactive ? 'Baja' : 'Activo'}
                            </span>
                            {!isInactive && (
                              <button
                                className="btn btn-secondary btn-sm"
                                onClick={() => handleDeactivateWorker(worker)}
                                disabled={updatingWorkers === worker.personaId}
                              >
                                Dar de baja
                              </button>
                            )}
                          </div>
                        ) : (
                          <button
                            className="btn btn-primary btn-sm"
                            onClick={() => handleAddWorker(worker)}
                            disabled={updatingWorkers === worker.personaId}
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
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setIsWorkersModalOpen(false)}>
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
