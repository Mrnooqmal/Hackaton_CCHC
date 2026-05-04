import React, { useState, useEffect } from 'react';
import Header from '../components/Header';
import { obrasApi, workersApi } from '../api/client';
import { useAuth } from '../context/AuthContext';
import {
  LuBuilding2,
  LuPlus,
  LuChevronDown,
  LuChevronUp,
  LuMapPin,
  LuFileText,
  LuUsers,
  LuX
} from 'react-icons/lu';
import { FiAlertTriangle } from 'react-icons/fi';

interface Obra {
  obraId?: string;
  nombre: string;
  codigo: string;
  direccion: string;
  comuna: string;
  region: string;
  etapaActual: string;
  mandante: string;
  estado: string;
  trabajadoresAprobados?: string[];
}

export const Obras: React.FC = () => {
  const { user } = useAuth();
  
  const [obras, setObras] = useState<Obra[]>([]);
  const [workers, setWorkers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [expandedObraId, setExpandedObraId] = useState<string | null>(null);
  const canViewObras = user?.rol === 'admin' || user?.role === 'admin';

  // Form State
  const [formData, setFormData] = useState<Obra>({
    nombre: '',
    codigo: '',
    direccion: '',
    comuna: '',
    region: '',
    etapaActual: 'excavacion',
    mandante: '',
    estado: 'activa',
    trabajadoresAprobados: []
  });

  const fetchData = async () => {
    setLoading(true);
    try {
      const [obrasRes, workersRes] = await Promise.all([
        obrasApi.list(),
        workersApi.list()
      ]);
      
      if (obrasRes.success && obrasRes.data) {
        const data = obrasRes.data as any;
        setObras(Array.isArray(data) ? data : (data.obras || []));
      }
      
      if (workersRes.success && workersRes.data) {
        setWorkers((workersRes.data as any).personas || workersRes.data);
      }
    } catch (error) {
      console.error("Error fetching data:", error);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleWorkerToggle = (workerId: string) => {
    setFormData(prev => {
      const current = prev.trabajadoresAprobados || [];
      const updated = current.includes(workerId)
        ? current.filter(id => id !== workerId)
        : [...current, workerId];
      return { ...prev, trabajadoresAprobados: updated };
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await obrasApi.create(formData);
      if (res.success) {
        setIsModalOpen(false);
        setFormData({
          nombre: '',
          codigo: '',
          direccion: '',
          comuna: '',
          region: '',
          etapaActual: 'excavacion',
          mandante: '',
          estado: 'activa',
          trabajadoresAprobados: []
        });
        fetchData();
      } else {
        alert("Error al crear obra");
      }
    } catch (error) {
      console.error(error);
    }
  };

  const toggleExpand = (obraId: string) => {
    setExpandedObraId(prev => prev === obraId ? null : obraId);
  };

  if (!canViewObras) {
    return (
      <>
        <Header title="Obras" />
        <div className="page-content">
          <div className="card">
            <div className="empty-state">
              <div className="empty-state-icon">
                <FiAlertTriangle size={48} className="text-danger-500" />
              </div>
              <h3 className="empty-state-title">Acceso Restringido</h3>
              <p className="empty-state-description">
                Solo administradores pueden ver esta sección.
              </p>
            </div>
          </div>
        </div>
      </>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center" style={{ height: '100vh' }}>
        <div className="spinner" />
      </div>
    );
  }

  return (
    <>
      <Header title="Obras" />
      <div className="page-content">
        <div className="page-header">
          <div className="page-header-info">
            <h2 className="page-header-title">
              <LuBuilding2 className="text-primary-500" />
              Gestión de Obras
            </h2>
            <p className="page-header-description">
              Administra proyectos, documentos DS44 y asignaciones del personal.
            </p>
          </div>
          <div className="page-header-actions">
            <button
              onClick={() => setIsModalOpen(true)}
              className="btn btn-primary"
            >
              <LuPlus />
              Crear nueva obra
            </button>
          </div>
        </div>

        <div className="card">
          {obras.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon">
                <LuBuilding2 size={48} className="text-muted" />
              </div>
              <h3 className="empty-state-title">Sin obras registradas</h3>
              <p className="empty-state-description">
                Crea una obra para comenzar a asignar documentos y personal.
              </p>
            </div>
          ) : (
            <>
              <div className="card-header">
                <div>
                  <h2 className="card-title">Listado de Obras</h2>
                  <p className="card-subtitle">{obras.length} obras registradas</p>
                </div>
              </div>

              <div className="table-container">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Obra</th>
                      <th>Ubicación</th>
                      <th>Etapa</th>
                      <th>Estado</th>
                      <th>Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {obras.map((obra) => {
                      const statusClass = obra.estado === 'activa'
                        ? 'badge badge-success'
                        : obra.estado === 'pausada'
                          ? 'badge badge-warning'
                          : 'badge badge-neutral';
                      const stageLabel = obra.etapaActual ? obra.etapaActual.replace('_', ' ') : '-';

                      return (
                        <React.Fragment key={obra.obraId || obra.codigo}>
                          <tr
                            style={{ cursor: 'pointer' }}
                            onClick={() => toggleExpand(obra.obraId as string)}
                          >
                            <td>
                              <div className="flex items-center gap-3">
                                <div className="avatar avatar-sm">
                                  <LuBuilding2 />
                                </div>
                                <div>
                                  <div className="font-bold">{obra.nombre}</div>
                                  <div className="text-muted">Código: {obra.codigo || '-'}</div>
                                </div>
                              </div>
                            </td>
                            <td>
                              <div className="flex items-center gap-2">
                                <LuMapPin className="text-muted" />
                                <span>{obra.comuna || '-'}, {obra.region || '-'}</span>
                              </div>
                            </td>
                            <td>
                              <span className="badge badge-info" style={{ textTransform: 'capitalize' }}>
                                {stageLabel}
                              </span>
                            </td>
                            <td>
                              <span className={statusClass}>
                                {obra.estado.toUpperCase()}
                              </span>
                            </td>
                            <td>
                              <button
                                className="btn btn-ghost btn-sm"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  toggleExpand(obra.obraId as string);
                                }}
                                title="Ver detalles"
                              >
                                {expandedObraId === obra.obraId ? <LuChevronUp /> : <LuChevronDown />}
                              </button>
                            </td>
                          </tr>

                          {expandedObraId === obra.obraId && (
                            <tr>
                              <td colSpan={5}>
                                <div
                                  style={{
                                    display: 'grid',
                                    gap: 'var(--space-5)',
                                    gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
                                    padding: 'var(--space-4) 0'
                                  }}
                                >
                                  <div className="card card-balanced-padding">
                                    <div className="card-header">
                                      <div className="card-title">Detalles del Proyecto</div>
                                    </div>
                                    <div className="text-muted">Mandante</div>
                                    <div className="font-medium">{obra.mandante || '-'}</div>
                                    <div className="text-muted" style={{ marginTop: 'var(--space-3)' }}>Dirección</div>
                                    <div className="font-medium">{obra.direccion || '-'}</div>
                                  </div>

                                  <div className="card card-balanced-padding">
                                    <div className="card-header">
                                      <div className="card-title">Trabajadores Asignados</div>
                                      <LuUsers className="text-muted" />
                                    </div>
                                    {obra.trabajadoresAprobados && obra.trabajadoresAprobados.length > 0 ? (
                                      <div style={{ maxHeight: '160px', overflowY: 'auto' }}>
                                        {obra.trabajadoresAprobados.map((rId, index) => {
                                          const worker = workers.find(w => w.personaId === rId || w.rut === rId);
                                          return (
                                            <div
                                              key={rId}
                                              style={{
                                                display: 'flex',
                                                justifyContent: 'space-between',
                                                padding: 'var(--space-2) 0',
                                                borderBottom: index === obra.trabajadoresAprobados!.length - 1 ? 'none' : '1px solid var(--surface-border)'
                                              }}
                                            >
                                              <span>{worker ? worker.nombre : rId}</span>
                                              <span className="text-muted">{worker ? worker.rut : ''}</span>
                                            </div>
                                          );
                                        })}
                                      </div>
                                    ) : (
                                      <p className="text-muted">No hay trabajadores asignados.</p>
                                    )}
                                  </div>

                                  <div className="card card-balanced-padding">
                                    <div className="card-header">
                                      <div className="card-title">Documentos DS44</div>
                                      <LuFileText className="text-muted" />
                                    </div>
                                    <div className="text-muted" style={{ marginBottom: 'var(--space-2)' }}>Etapa actual</div>
                                    <div className="progress" style={{ marginBottom: 'var(--space-3)' }}>
                                      <div className="progress-bar" style={{ width: '85%' }} />
                                    </div>
                                    <div className="text-muted">85% completado</div>
                                    <div className="text-muted" style={{ marginTop: 'var(--space-3)' }}>
                                      MIPER: Completado · Charlas ODI: 42/50 firmas
                                    </div>
                                  </div>

                                  <div className="card card-balanced-padding">
                                    <div className="card-header">
                                      <div className="card-title">Prevención e Incidentes</div>
                                      <FiAlertTriangle className="text-muted" />
                                    </div>
                                    <div style={{ display: 'grid', gap: 'var(--space-3)', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))' }}>
                                      <div className="card stat-card" style={{ padding: 'var(--space-3)' }}>
                                        <div className="stat-value">2</div>
                                        <div className="stat-label">Incidentes leves (mes)</div>
                                      </div>
                                      <div className="card stat-card" style={{ padding: 'var(--space-3)' }}>
                                        <div className="stat-value">14</div>
                                        <div className="stat-label">Charlas realizadas</div>
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Modal Crear Obra */}
      {isModalOpen && (
        <div className="modal-overlay">
          <div className="modal-content max-w-3xl">
            <div className="modal-header">
              <div>
                <h2 className="modal-title">Nueva Obra</h2>
                <p className="modal-subtitle">Completa los datos principales y asigna trabajadores.</p>
              </div>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setIsModalOpen(false)}
                aria-label="Cerrar"
              >
                <LuX />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="modal-form">
              <div className="modal-body">
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                    gap: 'var(--space-4)'
                  }}
                >
                  <div className="form-group">
                    <label className="form-label">Nombre de obra</label>
                    <input required name="nombre" value={formData.nombre} onChange={handleInputChange} className="form-input" />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Código interno</label>
                    <input required name="codigo" value={formData.codigo} onChange={handleInputChange} className="form-input" />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Dirección</label>
                    <input required name="direccion" value={formData.direccion} onChange={handleInputChange} className="form-input" />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Comuna</label>
                    <input required name="comuna" value={formData.comuna} onChange={handleInputChange} className="form-input" />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Región</label>
                    <input required name="region" value={formData.region} onChange={handleInputChange} className="form-input" />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Mandante</label>
                    <input required name="mandante" value={formData.mandante} onChange={handleInputChange} className="form-input" />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Etapa actual</label>
                    <select name="etapaActual" value={formData.etapaActual} onChange={handleInputChange} className="form-input form-select">
                      <option value="excavacion">Excavación / Fundaciones</option>
                      <option value="obra_gruesa">Obra Gruesa</option>
                      <option value="terminaciones">Terminaciones</option>
                      <option value="entrega">Entrega / Cierre</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Estado</label>
                    <select name="estado" value={formData.estado} onChange={handleInputChange} className="form-input form-select">
                      <option value="activa">Activa</option>
                      <option value="pausada">Pausada</option>
                      <option value="finalizada">Finalizada</option>
                    </select>
                  </div>
                </div>

                <div className="form-group">
                  <label className="form-label">Trabajadores asignados</label>
                  <div style={{ maxHeight: '220px', overflowY: 'auto', border: '1px solid var(--surface-border)', borderRadius: 'var(--radius-md)' }}>
                    {workers.length === 0 ? (
                      <div className="text-muted" style={{ padding: 'var(--space-3)' }}>
                        No hay trabajadores en el tenant.
                      </div>
                    ) : (
                      workers.map((worker, index) => (
                        <label
                          key={worker.personaId}
                          className="flex items-center gap-2"
                          style={{
                            padding: 'var(--space-2) var(--space-3)',
                            cursor: 'pointer',
                            borderBottom: index === workers.length - 1 ? 'none' : '1px solid var(--surface-border)'
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={formData.trabajadoresAprobados?.includes(worker.personaId)}
                            onChange={() => handleWorkerToggle(worker.personaId)}
                          />
                          <span>{worker.nombre}</span>
                          <span className="text-muted">({worker.rut})</span>
                        </label>
                      ))
                    )}
                  </div>
                </div>
              </div>

              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setIsModalOpen(false)}>
                  Cancelar
                </button>
                <button type="submit" className="btn btn-primary">
                  Crear Obra
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
};
export default Obras;
