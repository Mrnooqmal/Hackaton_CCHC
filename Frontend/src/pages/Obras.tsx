import React, { useMemo, useState, useEffect } from 'react';
import Header from '../components/Header';
import { documentsApi, obrasApi, tenantsApi, workersApi, uploadsApi } from '../api/client';
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
  imagenKey?: string;
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
  const [obraImageFile, setObraImageFile] = useState<File | null>(null);
  const [obraImagePreview, setObraImagePreview] = useState<string>('');
  const [obraImageUrls, setObraImageUrls] = useState<Record<string, string>>({});
  const [isCreating, setIsCreating] = useState(false);
  const imageCacheKey = 'obraImageCache';
  
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
      const [obrasRes, workersRes, docsRes] = await Promise.all([
        obrasApi.list(),
        workersApi.list(),
        documentsApi.list({ clasificacion: 'obra' })
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

      // Hide loading spinner as soon as the core structure is ready
      setLoading(false);

      // Compute DS44 alerts in-memory instantly
      if (obrasList.length > 0) {
        const allDocs = docsRes.success && docsRes.data ? (docsRes.data as any).documents || [] : [];
        const alerts: Record<string, number> = {};
        obrasList.forEach((obra) => {
          if (!obra.obraId) {
            return;
          }
          const docs = allDocs.filter((doc: any) => doc.obraId === obra.obraId);
          const missingCount = REQUIRED_DS44.filter((required) => {
            const existing = docs.find((doc: any) => required.tipos.includes(doc.tipo));
            const hasFile = Boolean(existing?.s3Key || existing?.archivoUrl);
            return !hasFile;
          }).length;
          alerts[obra.obraId] = missingCount;
        });
        setDs44Alerts(alerts);
      } else {
        setDs44Alerts({});
      }

      // Load/fetch images progressively with persistent localStorage cache
      const imageKeys = obrasList
        .map((obra) => ({ obraId: obra.obraId, imagenKey: obra.imagenKey }))
        .filter((entry) => entry.obraId && entry.imagenKey) as { obraId: string; imagenKey: string }[];
      
      if (imageKeys.length > 0) {
        const now = Date.now();
        const cachedRaw = localStorage.getItem(imageCacheKey);
        const cached: Record<string, { url: string; expiresAt: number }> = cachedRaw ? JSON.parse(cachedRaw) : {};
        const needsFetch = new Set<string>();

        // Set already cached and valid images immediately
        const nextImages: Record<string, string> = {};
        imageKeys.forEach(({ obraId, imagenKey }) => {
          const cachedEntry = cached[imagenKey];
          if (cachedEntry && cachedEntry.expiresAt > now) {
            nextImages[obraId] = cachedEntry.url;
          } else {
            needsFetch.add(imagenKey);
          }
        });

        if (Object.keys(nextImages).length > 0) {
          setObraImageUrls(prev => ({ ...prev, ...nextImages }));
        }

        // Fetch missing URLs in background
        if (needsFetch.size > 0) {
          const downloadResponse = await uploadsApi.getBatchDownloadUrls(Array.from(needsFetch));
          if (downloadResponse?.success && downloadResponse.data?.urls) {
            const expiresInMs = (downloadResponse.data.expiresIn || 0) * 1000;
            const updatedImages: Record<string, string> = {};
            
            downloadResponse.data.urls.forEach((item: any) => {
              if (item.downloadUrl && item.fileKey) {
                cached[item.fileKey] = {
                  url: item.downloadUrl,
                  expiresAt: now + expiresInMs
                };
                
                // Map back to all matching obras
                imageKeys.forEach(({ obraId, imagenKey }) => {
                  if (imagenKey === item.fileKey) {
                    updatedImages[obraId] = item.downloadUrl;
                  }
                });
              }
            });
            localStorage.setItem(imageCacheKey, JSON.stringify(cached));
            setObraImageUrls(prev => ({ ...prev, ...updatedImages }));
          }
        }
      } else {
        setObraImageUrls({});
      }
    } catch (error) {
      console.error("Error fetching data:", error);
      setLoading(false);
    }
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

  useEffect(() => {
    if (!obraImageFile) {
      setObraImagePreview('');
      return;
    }
    const previewUrl = URL.createObjectURL(obraImageFile);
    setObraImagePreview(previewUrl);
    return () => URL.revokeObjectURL(previewUrl);
  }, [obraImageFile]);

  const handleImageChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    setObraImageFile(file || null);
    if (event.target) event.target.value = '';
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
    if (isCreating) return;
    setIsCreating(true);
    try {
      let imagenKey = '';
      const tenantId = user?.tenantId || localStorage.getItem('tenant_id') || '';
      if (obraImageFile) {
        const uploadUrlRes = await uploadsApi.getUploadUrl({
          fileName: obraImageFile.name,
          fileType: obraImageFile.type,
          fileSize: obraImageFile.size,
          categoria: 'obras',
          tenantId
        });
        if (!uploadUrlRes.success || !uploadUrlRes.data) throw new Error('Error al obtener URL de subida');
        const uploadResult = await fetch(uploadUrlRes.data.uploadUrl, {
          method: 'PUT',
          body: obraImageFile,
          headers: { 'Content-Type': obraImageFile.type }
        });
        if (!uploadResult.ok) throw new Error('Error al subir imagen de obra');
        imagenKey = uploadUrlRes.data.fileKey;
        await uploadsApi.confirmUpload({
          fileKey: imagenKey,
          fileName: obraImageFile.name,
          fileType: obraImageFile.type,
          fileSize: obraImageFile.size
        });
      }

      const res = await obrasApi.create({
        ...formData,
        mandante: resolvedCompanyName || formData.mandante,
        imagenKey
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
        setObraImageFile(null);
        setObraImagePreview('');
        fetchData();
      } else {
        alert("Error al crear obra");
      }
    } catch (error) {
      console.error(error);
    } finally {
      setIsCreating(false);
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

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 'var(--space-4)' }}>
                {obras.map((obra) => {
                  const obraKey = obra.obraId || obra.codigo;
                  const alertCount = obra.obraId ? (ds44Alerts[obra.obraId] ?? 0) : 0;
                  const imageUrl = obra.obraId ? obraImageUrls[obra.obraId] : '';
                  const displayImage = imageUrl || '/obraDefault.png';

                  return (
                    <div
                      key={obra.obraId || obra.codigo}
                      className="card"
                      style={{ padding: 0, overflow: 'hidden', cursor: 'pointer' }}
                      onClick={() => navigate(`/obras/${obraKey}`)}
                    >
                      <div style={{ position: 'relative', height: '160px', background: 'var(--surface-elevated)' }}>
                        <img
                          src={displayImage}
                          alt={`Foto de ${obra.nombre}`}
                          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                          loading="lazy"
                        />
                        {alertCount > 0 && (
                          <div
                            style={{
                              position: 'absolute', right: '12px', top: '12px',
                              background: 'rgba(239, 68, 68, 0.92)',
                              color: 'white',
                              borderRadius: '999px',
                              padding: '4px 10px',
                              fontSize: '0.75rem',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '6px',
                              fontWeight: 600
                            }}
                          >
                            <FiAlertTriangle />
                            {alertCount}
                          </div>
                        )}
                      </div>
                      <div style={{ padding: 'var(--space-3)' }}>
                        <div className="font-bold" style={{ marginBottom: '6px' }}>{obra.nombre}</div>
                        <div className="text-muted" style={{ marginTop: '2px' }}>
                          {obra.comuna || '-'}, {obra.region || '-'}
                        </div>
                        <div
                          style={{
                            marginTop: '10px',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '8px',
                            padding: '6px 12px',
                            borderRadius: '999px',
                            background: alertCount > 0 ? 'rgba(239, 68, 68, 0.12)' : 'var(--surface-elevated)',
                            color: alertCount > 0 ? 'var(--danger-600)' : 'var(--text-muted)',
                            border: alertCount > 0 ? '1px solid rgba(239, 68, 68, 0.35)' : '1px solid var(--surface-border)',
                            fontWeight: 600,
                            fontSize: '0.85rem'
                          }}
                        >
                          <FiAlertTriangle style={{ opacity: alertCount > 0 ? 1 : 0.4 }} />
                          Alertas DS44: {alertCount}
                        </div>
                      </div>
                    </div>
                  );
                })}
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
            <button
              type="submit"
              form="crear-obra-form"
              className="btn btn-primary"
              disabled={isCreating}
            >
              {isCreating ? 'Creando obra' : 'Crear Obra'}
            </button>
          </>
        }
      >
        <form id="crear-obra-form" onSubmit={handleSubmit} className="modal-form">
          <div className="modal-body p-0">
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
                  <div className="form-group">
                    <label className="form-label">Imagen de referencia</label>
                    <div
                      style={{
                        border: '1px dashed var(--surface-border)',
                        borderRadius: 'var(--radius-md)',
                        padding: 'var(--space-3)',
                        background: 'linear-gradient(180deg, rgba(59, 130, 246, 0.06), rgba(59, 130, 246, 0.02))'
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
                        <label
                          htmlFor="obra-image-upload"
                          className="btn btn-secondary"
                          style={{ display: 'inline-flex', alignItems: 'center' }}
                        >
                          Seleccionar imagen
                        </label>
                        <span className="text-muted" style={{ fontSize: '0.85rem' }}>
                          {obraImageFile ? obraImageFile.name : 'Sin archivo seleccionado'}
                        </span>
                      </div>
                      <input
                        id="obra-image-upload"
                        type="file"
                        accept="image/*"
                        onChange={handleImageChange}
                        style={{ display: 'none' }}
                      />
                      <div style={{ marginTop: '10px', borderRadius: 'var(--radius-md)', overflow: 'hidden', border: '1px solid var(--surface-border)' }}>
                        {obraImagePreview ? (
                          <img
                            src={obraImagePreview}
                            alt="Vista previa obra"
                            style={{ width: '100%', height: '160px', objectFit: 'cover', display: 'block' }}
                          />
                        ) : (
                          <div
                            style={{
                              height: '160px',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              color: 'var(--text-muted)',
                              fontSize: '0.9rem'
                            }}
                          >
                            Sube una imagen para mostrarla aqui
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

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
