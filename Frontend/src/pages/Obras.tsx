import React, { useMemo, useState, useEffect } from 'react';
import Header from '../components/Header';
import { documentsApi, obrasApi, tenantsApi, workersApi } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import {
  LuBuilding2,
  LuPlus,
  LuMapPin
} from 'react-icons/lu';
import { FiAlertTriangle } from 'react-icons/fi';
import { Modal } from '../components/ui';

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

const REQUIRED_DS44 = [
  { tipos: ['POLITICA_SSO'] },
  { tipos: ['DIAGNOSTICO_LEGAL'] },
  { tipos: ['MIPER', 'MATRIZ_MIPPER'] },
  { tipos: ['MAPA_RIESGOS'] },
  { tipos: ['REGLAMENTO_INTERNO'] }
];

const REGION_COMUNAS: Record<string, string[]> = {
  'Arica y Parinacota': ['Arica', 'Camarones', 'Putre', 'General Lagos'],
  Tarapacá: ['Iquique', 'Alto Hospicio', 'Pozo Almonte', 'Camiña', 'Colchane', 'Huara', 'Pica'],
  Antofagasta: ['Antofagasta', 'Mejillones', 'Sierra Gorda', 'Taltal', 'Calama', 'Ollagüe', 'San Pedro de Atacama', 'Tocopilla', 'María Elena'],
  Atacama: ['Copiapó', 'Caldera', 'Tierra Amarilla', 'Chañaral', 'Diego de Almagro', 'Vallenar', 'Alto del Carmen', 'Freirina', 'Huasco'],
  Coquimbo: ['La Serena', 'Coquimbo', 'Andacollo', 'La Higuera', 'Paihuano', 'Vicuña', 'Illapel', 'Canela', 'Los Vilos', 'Salamanca', 'Ovalle', 'Combarbalá', 'Monte Patria', 'Punitaqui', 'Río Hurtado'],
  Valparaíso: ['Valparaíso', 'Casablanca', 'Concón', 'Juan Fernández', 'Puchuncaví', 'Quintero', 'Viña del Mar', 'Isla de Pascua', 'Los Andes', 'Calle Larga', 'Rinconada', 'San Esteban', 'La Ligua', 'Cabildo', 'Papudo', 'Petorca', 'Zapallar', 'Quillota', 'Calera', 'Hijuelas', 'La Cruz', 'Nogales', 'San Antonio', 'Algarrobo', 'Cartagena', 'El Quisco', 'El Tabo', 'Santo Domingo', 'San Felipe', 'Catemu', 'Llaillay', 'Panquehue', 'Putaendo', 'Santa María', 'Limache', 'Olmué', 'Quilpué', 'Villa Alemana'],
  'Región Metropolitana': ['Santiago', 'Cerrillos', 'Cerro Navia', 'Conchalí', 'El Bosque', 'Estación Central', 'Huechuraba', 'Independencia', 'La Cisterna', 'La Florida', 'La Granja', 'La Pintana', 'La Reina', 'Las Condes', 'Lo Barnechea', 'Lo Espejo', 'Lo Prado', 'Macul', 'Maipú', 'Ñuñoa', 'Pedro Aguirre Cerda', 'Peñalolén', 'Providencia', 'Pudahuel', 'Quilicura', 'Quinta Normal', 'Recoleta', 'Renca', 'San Joaquín', 'San Miguel', 'San Ramón', 'Vitacura', 'Puente Alto', 'Pirque', 'San José de Maipo', 'Colina', 'Lampa', 'Tiltil', 'San Bernardo', 'Buin', 'Calera de Tango', 'Paine', 'Melipilla', 'Alhué', 'Curacaví', 'María Pinto', 'San Pedro', 'Talagante', 'El Monte', 'Isla de Maipo', 'Padre Hurtado', 'Peñaflor'],
  "O'Higgins": ['Rancagua', 'Codegua', 'Coinco', 'Coltauco', 'Doñihue', 'Graneros', 'Las Cabras', 'Machalí', 'Malloa', 'Mostazal', 'Olivar', 'Peumo', 'Pichidegua', 'Quinta de Tilcoco', 'Rengo', 'Requínoa', 'San Vicente', 'Pichilemu', 'La Estrella', 'Litueche', 'Marchigüe', 'Navidad', 'Paredones', 'San Fernando', 'Chimbarongo', 'Lolol', 'Nancagua', 'Palmilla', 'Peralillo', 'Placilla', 'Pumanque', 'Santa Cruz'],
  Maule: ['Talca', 'Constitución', 'Curepto', 'Empedrado', 'Maule', 'Pelarco', 'Pencahue', 'Río Claro', 'San Clemente', 'San Rafael', 'Cauquenes', 'Chanco', 'Pelluhue', 'Curicó', 'Hualañé', 'Licantén', 'Molina', 'Rauco', 'Romeral', 'Sagrada Familia', 'Teno', 'Vichuquén', 'Linares', 'Colbún', 'Longaví', 'Parral', 'Retiro', 'San Javier', 'Villa Alegre', 'Yerbas Buenas'],
  Ñuble: ['Chillán', 'Chillán Viejo', 'El Carmen', 'Pemuco', 'Pinto', 'Quillón', 'San Ignacio', 'Yungay', 'Bulnes', 'Cobquecura', 'Coelemu', 'Ninhue', 'Portezuelo', 'Quirihue', 'Ránquil', 'San Carlos', 'San Fabián', 'San Nicolás', 'Coihueco', 'Ñiquén'],
  Biobío: ['Concepción', 'Coronel', 'Chiguayante', 'Florida', 'Hualqui', 'Lota', 'Penco', 'San Pedro de la Paz', 'Santa Juana', 'Talcahuano', 'Tomé', 'Hualpén', 'Lebu', 'Arauco', 'Cañete', 'Contulmo', 'Curanilahue', 'Los Álamos', 'Tirúa', 'Los Ángeles', 'Antuco', 'Cabrero', 'Laja', 'Mulchén', 'Nacimiento', 'Negrete', 'Quilleco', 'Quilaco', 'San Rosendo', 'Santa Bárbara', 'Tucapel', 'Yumbel', 'Alto Biobío'],
  'La Araucanía': ['Temuco', 'Carahue', 'Cunco', 'Curarrehue', 'Freire', 'Galvarino', 'Gorbea', 'Lautaro', 'Loncoche', 'Melipeuco', 'Nueva Imperial', 'Padre Las Casas', 'Perquenco', 'Pitrufquén', 'Pucón', 'Saavedra', 'Teodoro Schmidt', 'Toltén', 'Vilcún', 'Villarrica', 'Cholchol', 'Angol', 'Collipulli', 'Curacautín', 'Ercilla', 'Lonquimay', 'Los Sauces', 'Lumaco', 'Purén', 'Renaico', 'Traiguén', 'Victoria'],
  'Los Ríos': ['Valdivia', 'Corral', 'Lanco', 'Los Lagos', 'Máfil', 'Mariquina', 'Paillaco', 'Panguipulli', 'La Unión', 'Futrono', 'Lago Ranco', 'Río Bueno'],
  'Los Lagos': ['Puerto Montt', 'Calbuco', 'Cochamó', 'Fresia', 'Frutillar', 'Los Muermos', 'Llanquihue', 'Maullín', 'Puerto Varas', 'Castro', 'Ancud', 'Chonchi', 'Curaco de Vélez', 'Dalcahue', 'Puqueldón', 'Queilén', 'Quemchi', 'Quinchao', 'Osorno', 'Puerto Octay', 'Purranque', 'Puyehue', 'Río Negro', 'San Juan de la Costa', 'San Pablo', 'Chaitén', 'Futaleufú', 'Hualaihué', 'Palena'],
  Aysén: ['Coyhaique', 'Lago Verde', 'Aysén', 'Cisnes', 'Guaitecas', 'Cochrane', "O'Higgins", 'Tortel', 'Chile Chico', 'Río Ibáñez'],
  Magallanes: ['Punta Arenas', 'Laguna Blanca', 'Río Verde', 'San Gregorio', 'Cabo de Hornos', 'Antártica', 'Porvenir', 'Primavera', 'Timaukel', 'Natales', 'Torres del Paine']
};

export const Obras: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  
  const [obras, setObras] = useState<Obra[]>([]);
  const [workers, setWorkers] = useState<any[]>([]);
  const [ds44Alerts, setDs44Alerts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  
  const [isModalOpen, setIsModalOpen] = useState(false);
  const canViewObras = user?.rol === 'admin';
  const [companyName, setCompanyName] = useState('');
  const resolvedCompanyName = useMemo(() => {
    const userAny = user as any;
    return companyName || userAny?.empresaNombre || userAny?.nombreEmpresa || userAny?.tenantNombre || userAny?.razonSocial || '';
  }, [companyName, user]);

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

      let obrasList: Obra[] = [];
      if (obrasRes.success && obrasRes.data) {
        const data = obrasRes.data as any;
        obrasList = Array.isArray(data) ? data : (data.obras || []);
        setObras(obrasList);
      }
      
      if (workersRes.success && workersRes.data) {
        setWorkers((workersRes.data as any).personas || workersRes.data);
      }

      if (obrasList.length > 0) {
        const alerts: Record<string, number> = {};
        await Promise.all(
          obrasList.map(async (obra) => {
            if (!obra.obraId) {
              return;
            }
            const docsRes = await documentsApi.list({ obraId: obra.obraId, clasificacion: 'obra' } as any);
            const docs = docsRes.success && docsRes.data ? docsRes.data.documents || [] : [];
            const missingCount = REQUIRED_DS44.filter((required) => {
              const existing = docs.find((doc: any) => required.tipos.includes(doc.tipo));
              const hasFile = Boolean(existing?.s3Key || existing?.archivoUrl);
              return !hasFile;
            }).length;
            alerts[obra.obraId] = missingCount;
          })
        );
        setDs44Alerts(alerts);
      } else {
        setDs44Alerts({});
      }
    } catch (error) {
      console.error("Error fetching data:", error);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchData();
  }, []);

  useEffect(() => {
    const loadTenantName = async () => {
      if (!user?.tenantId) return;
      if (companyName) return;
      try {
        const res = await tenantsApi.get(user.tenantId);
        if (res.success && res.data?.nombre) {
          setCompanyName(res.data.nombre);
        }
      } catch (error) {
        console.error('Error loading tenant name:', error);
      }
    };
    loadTenantName();
  }, [companyName, user?.tenantId]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  useEffect(() => {
    if (!isModalOpen) return;
    if (resolvedCompanyName && !formData.mandante) {
      setFormData(prev => ({ ...prev, mandante: resolvedCompanyName }));
    }
  }, [resolvedCompanyName, formData.mandante, isModalOpen]);

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
      const res = await obrasApi.create({
        ...formData,
        mandante: resolvedCompanyName || formData.mandante
      });
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

  const handleRegionChange = (value: string) => {
    setFormData(prev => ({ ...prev, region: value, comuna: '' }));
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
                      <th>Alertas</th>
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
                      const obraKey = obra.obraId || obra.codigo;
                      const alertCount = obra.obraId ? (ds44Alerts[obra.obraId] ?? 0) : 0;

                      return (
                        <React.Fragment key={obra.obraId || obra.codigo}>
                          <tr
                            style={{ cursor: 'pointer' }}
                            onClick={() => navigate(`/obras/${obraKey}`)}
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
                              {alertCount > 0 ? (
                                <div className="flex items-center gap-2 text-danger-500" style={{ fontWeight: 600 }}>
                                  <FiAlertTriangle />
                                  <span>{alertCount}</span>
                                </div>
                              ) : (
                                <span style={{ color: 'var(--text-primary)' }}>0</span>
                              )}
                            </td>
                          </tr>
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
      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title="Nueva Obra"
        subtitle="Completa los datos principales y asigna trabajadores."
        size="lg"
        footer={
          <>
            <button type="button" className="btn btn-secondary" onClick={() => setIsModalOpen(false)}>
              Cancelar
            </button>
            <button type="submit" form="crear-obra-form" className="btn btn-primary">
              Crear Obra
            </button>
          </>
        }
      >
        <form id="crear-obra-form" onSubmit={handleSubmit} className="modal-form">
          <div className="modal-body p-0">
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
                  <div className="form-group">
                    <label className="form-label">Nombre de obra</label>
                    <input required name="nombre" value={formData.nombre} onChange={handleInputChange} className="form-input" />
                  </div>

                  <div className="form-group">
                    <label className="form-label">Mandante</label>
                    <input
                      required
                      name="mandante"
                      value={resolvedCompanyName || formData.mandante}
                      onChange={handleInputChange}
                      className="form-input"
                      placeholder={resolvedCompanyName || 'Empresa mandante'}
                      disabled
                    />
                  </div>

                  <div style={{ display: 'flex', gap: 'var(--space-4)' }}>
                    <div style={{ flex: 1 }} className="form-group">
                      <label className="form-label">Región</label>
                      <select
                        name="region"
                        value={formData.region}
                        onChange={(event) => handleRegionChange(event.target.value)}
                        className="form-input form-select"
                        required
                      >
                        <option value="">Selecciona una región</option>
                        {Object.keys(REGION_COMUNAS).map(region => (
                          <option key={region} value={region}>{region}</option>
                        ))}
                      </select>
                    </div>

                    <div style={{ flex: 1 }} className="form-group">
                      <label className="form-label">Comuna</label>
                      <select
                        name="comuna"
                        value={formData.comuna}
                        onChange={handleInputChange}
                        className="form-input form-select"
                        required
                        disabled={!formData.region}
                      >
                        <option value="">Selecciona una comuna</option>
                        {(REGION_COMUNAS[formData.region] || []).map(comuna => (
                          <option key={comuna} value={comuna}>{comuna}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="form-group">
                    <label className="form-label">Dirección</label>
                    <input required name="direccion" value={formData.direccion} onChange={handleInputChange} className="form-input" />
                  </div>

                  <div className="form-group">
                    <label className="form-label">Código interno</label>
                    <input required name="codigo" value={formData.codigo} onChange={handleInputChange} className="form-input" />
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
                          className="checkbox-row"
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
                            className="checkbox-input custom-checkbox"
                          />
                          <span>{worker.nombre}</span>
                          <span className="text-muted">({worker.rut})</span>
                        </label>
                      ))
                    )}
                  </div>
                </div>
              </div>
        </form>
      </Modal>
    </>
  );
};
export default Obras;
