import React, { useMemo, useState, useEffect } from 'react';
import { documentsApi, obrasApi, tenantsApi, workersApi, uploadsApi } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useObraContext } from '../context/ObraContext';
import { useNavigate } from 'react-router-dom';
import {
  LuBuilding2,
  LuPlus
} from 'react-icons/lu';
import { FiAlertTriangle, FiSearch } from 'react-icons/fi';
import { Modal, Select, SegmentedControl } from '../components/ui';
import AddressAutocomplete from '../components/AddressAutocomplete';
import { PERMISSIONS } from '../permissions';

interface Obra {
  obraId?: string;
  nombre: string;
  codigo: string;
  direccion: string;
  comuna: string;
  region: string;
  mandante: string;
  estado: string;
  trabajadoresAprobados?: string[];
  imagenKey?: string;
  // Flags DS44 que definen que elementos del DO aplican a la obra.
  faenaCompartida?: boolean;
  tieneMaquinaria?: boolean;
  agentesFQB?: boolean;
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
  const { user, hasPermission } = useAuth();
  const canCrearObra = hasPermission(PERMISSIONS.OBRAS_CREAR);
  const canVerDetalle = hasPermission(PERMISSIONS.OBRAS_DETALLE);
  const navigate = useNavigate();
  const { obras: contextObras, isLoadingObras, refreshObras } = useObraContext();
  const obras = contextObras as unknown as Obra[];

  const [workers, setWorkers] = useState<any[]>([]);
  const [ds44Alerts, setDs44Alerts] = useState<Record<string, number>>({});
  // Spinner solo si el contexto aún no cargó y no hay datos cacheados
  const loading = isLoadingObras && obras.length === 0;
  const [obraImageFile, setObraImageFile] = useState<File | null>(null);
  const [obraImagePreview, setObraImagePreview] = useState<string>('');
  const [obraImageUrls, setObraImageUrls] = useState<Record<string, string>>({});
  const [isCreating, setIsCreating] = useState(false);
  const imageCacheKey = 'obraImageCache';
  
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterEstado, setFilterEstado] = useState('');
  const canViewObras = hasPermission(PERMISSIONS.OBRAS_VER);
  const [companyName, setCompanyName] = useState('');
  const resolvedCompanyName = useMemo(() => {
    const userAny = user as any;
    return companyName || userAny?.empresaNombre || userAny?.nombreEmpresa || userAny?.tenantNombre || userAny?.razonSocial || '';
  }, [companyName, user]);

  const filteredObras = useMemo(() => {
    const q = searchTerm.toLowerCase().trim();
    return obras.filter(o => {
      if (filterEstado && o.estado !== filterEstado) return false;
      if (!q) return true;
      return (
        o.nombre?.toLowerCase().includes(q) ||
        o.codigo?.toLowerCase().includes(q) ||
        o.direccion?.toLowerCase().includes(q)
      );
    });
  }, [obras, searchTerm, filterEstado]);

  // Form State
  const [formData, setFormData] = useState<Obra>({
    nombre: '',
    codigo: '',
    direccion: '',
    comuna: '',
    region: '',
    mandante: '',
    estado: 'activa',
    trabajadoresAprobados: [],
    faenaCompartida: false,
    tieneMaquinaria: true,
    agentesFQB: false
  });

  // Carga DS44 alerts en background, sin bloquear el render
  const fetchDs44Alerts = async (obrasList: Obra[]) => {
    if (obrasList.length === 0) { setDs44Alerts({}); return; }
    try {
      const docsRes = await documentsApi.list({ clasificacion: 'obra' });
      const allDocs = docsRes.success && docsRes.data ? (docsRes.data as any).documents || [] : [];
      const alerts: Record<string, number> = {};
      obrasList.forEach((obra) => {
        if (!obra.obraId) return;
        const docs = allDocs.filter((doc: any) => doc.obraId === obra.obraId);
        const missingCount = REQUIRED_DS44.filter((required) => {
          const existing = docs.find((doc: any) => required.tipos.includes(doc.tipo));
          return !Boolean(existing?.s3Key || existing?.archivoUrl);
        }).length;
        alerts[obra.obraId] = missingCount;
      });
      setDs44Alerts(alerts);
    } catch {}
  };

  // Carga imágenes en background usando caché localStorage
  const fetchObraImages = async (obrasList: Obra[]) => {
    const imageKeys = obrasList
      .map((o) => ({ obraId: o.obraId, imagenKey: o.imagenKey }))
      .filter((e) => e.obraId && e.imagenKey) as { obraId: string; imagenKey: string }[];
    if (imageKeys.length === 0) { setObraImageUrls({}); return; }

    const now = Date.now();
    const cachedRaw = localStorage.getItem(imageCacheKey);
    const cached: Record<string, { url: string; expiresAt: number }> = cachedRaw ? JSON.parse(cachedRaw) : {};
    const needsFetch = new Set<string>();
    const nextImages: Record<string, string> = {};

    imageKeys.forEach(({ obraId, imagenKey }) => {
      const entry = cached[imagenKey];
      if (entry && entry.expiresAt > now) nextImages[obraId] = entry.url;
      else needsFetch.add(imagenKey);
    });

    if (Object.keys(nextImages).length > 0) setObraImageUrls(prev => ({ ...prev, ...nextImages }));

    if (needsFetch.size > 0) {
      try {
        const res = await uploadsApi.getBatchDownloadUrls(Array.from(needsFetch));
        if (res?.success && res.data?.urls) {
          const expiresInMs = (res.data.expiresIn || 0) * 1000;
          const updatedImages: Record<string, string> = {};
          res.data.urls.forEach((item: any) => {
            if (item.downloadUrl && item.fileKey) {
              cached[item.fileKey] = { url: item.downloadUrl, expiresAt: now + expiresInMs };
              imageKeys.forEach(({ obraId, imagenKey }) => {
                if (imagenKey === item.fileKey) updatedImages[obraId] = item.downloadUrl;
              });
            }
          });
          localStorage.setItem(imageCacheKey, JSON.stringify(cached));
          setObraImageUrls(prev => ({ ...prev, ...updatedImages }));
        }
      } catch {}
    }
  };

  // Cuando el contexto tiene obras, carga DS44 alerts e imágenes en background
  useEffect(() => {
    if (obras.length > 0) {
      fetchDs44Alerts(obras);
      fetchObraImages(obras);
    }
  }, [contextObras]);

  // Workers cargados lazy: solo cuando se abre el modal de creación
  useEffect(() => {
    if (!isModalOpen || workers.length > 0) return;
    workersApi.list().then(res => {
      if (res.success && res.data) setWorkers((res.data as any).personas || res.data);
    }).catch(() => {});
  }, [isModalOpen]);

  // Tenant name cargado lazy: solo al abrir el modal, no en el montaje inicial
  useEffect(() => {
    if (!isModalOpen || companyName || !user?.tenantId) return;
    tenantsApi.get(user.tenantId).then(res => {
      if (res.success && res.data?.nombre) setCompanyName(res.data.nombre);
    }).catch(() => {});
  }, [isModalOpen, companyName, user?.tenantId]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value, type } = e.target as HTMLInputElement;
    const checked = (e.target as HTMLInputElement).checked;
    setFormData(prev => ({ ...prev, [name]: type === 'checkbox' ? checked : value }));
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
          mandante: '',
          estado: 'activa',
          trabajadoresAprobados: [],
          faenaCompartida: false,
          tieneMaquinaria: true,
          agentesFQB: false
        });
        setObraImageFile(null);
        setObraImagePreview('');
        refreshObras();
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
          {canCrearObra && (
            <div className="page-header-actions">
              <button
                onClick={() => setIsModalOpen(true)}
                className="btn btn-primary"
              >
                <LuPlus />
                Crear nueva obra
              </button>
            </div>
          )}
        </div>

        {obras.length === 0 ? (
          <div className="card">
            <div className="empty-state">
              <div className="empty-state-icon">
                <LuBuilding2 size={48} className="text-muted" />
              </div>
              <h3 className="empty-state-title">Sin obras registradas</h3>
              <p className="empty-state-description">
                Crea una obra para comenzar a asignar documentos y personal.
              </p>
            </div>
          </div>
        ) : (
          <>
            {/* Filtros */}
            <div className="card mb-6">
              <div className="flex items-center gap-4" style={{ flexWrap: 'wrap' }}>
                <div style={{ position: 'relative', flex: 1, minWidth: 200 }}>
                  <input
                    type="text"
                    placeholder="Buscar por nombre, código o dirección..."
                    value={searchTerm}
                    onChange={e => setSearchTerm(e.target.value)}
                    className="form-input"
                    style={{ paddingLeft: 40 }}
                  />
                  <FiSearch style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                </div>
                <div style={{ width: 180 }}>
                  <Select
                    ariaLabel="Filtrar por estado"
                    value={filterEstado}
                    onChange={setFilterEstado}
                    options={[
                      { value: '', label: 'Todos los estados' },
                      { value: 'activa', label: 'Activas' },
                      { value: 'pausada', label: 'Pausadas' },
                      { value: 'finalizada', label: 'Finalizadas' },
                    ]}
                  />
                </div>
              </div>
            </div>

            {/* Listado */}
            <div className="card">
              <div className="card-header">
                <div>
                  <h2 className="card-title">Listado de Obras</h2>
                  <p className="card-subtitle">
                    {(searchTerm || filterEstado)
                      ? `${filteredObras.length} de ${obras.length} obras`
                      : `${obras.length} obras registradas`}
                  </p>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 'var(--space-4)', padding: 'var(--space-4)' }}>
                {filteredObras.length === 0 ? (
                  <p style={{ gridColumn: '1/-1', textAlign: 'center', padding: 'var(--space-10)', color: 'var(--text-muted)', fontSize: 14 }}>
                    No hay obras que coincidan con los filtros aplicados
                  </p>
                ) : null}
                {filteredObras.map((obra) => {
                  const obraKey = obra.obraId || obra.codigo;
                  const alertCount = obra.obraId ? (ds44Alerts[obra.obraId] ?? 0) : 0;
                  const imageUrl = obra.obraId ? obraImageUrls[obra.obraId] : '';
                  const displayImage = imageUrl || '/obraDefault.png';

                  return (
                    <div
                      key={obra.obraId || obra.codigo}
                      className="card"
                      style={{ padding: 0, overflow: 'hidden', cursor: canVerDetalle ? 'pointer' : 'default' }}
                      onClick={canVerDetalle ? () => navigate(`/obras/${obraKey}`) : undefined}
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
            </div>{/* /card listado */}
          </>
        )}
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
                    <label className="form-label">Nombre de obra *</label>
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
                      <label className="form-label">Región *</label>
                      <Select
                        ariaLabel="Región"
                        placeholder="Selecciona una región"
                        searchable
                        value={formData.region}
                        onChange={handleRegionChange}
                        options={Object.keys(REGION_COMUNAS).map(region => ({ value: region, label: region }))}
                      />
                    </div>

                    <div style={{ flex: 1 }} className="form-group">
                      <label className="form-label">Comuna *</label>
                      <Select
                        ariaLabel="Comuna"
                        placeholder="Selecciona una comuna"
                        searchable
                        disabled={!formData.region}
                        value={formData.comuna}
                        onChange={(v) => setFormData(prev => ({ ...prev, comuna: v }))}
                        options={(REGION_COMUNAS[formData.region] || []).map(comuna => ({ value: comuna, label: comuna }))}
                      />
                    </div>
                  </div>

                  <div className="form-group">
                    <label className="form-label">Dirección *</label>
                    <AddressAutocomplete
                        required
                        value={formData.direccion}
                        onChange={v => setFormData(prev => ({ ...prev, direccion: v }))}
                    />
                  </div>

                  <div className="form-group">
                    <label className="form-label">Estado</label>
                    <SegmentedControl
                      ariaLabel="Estado de la obra"
                      value={formData.estado}
                      onChange={(v) => setFormData(prev => ({ ...prev, estado: v as Obra['estado'] }))}
                      options={[
                        { value: 'activa', label: 'Activa' },
                        { value: 'pausada', label: 'Pausada' },
                        { value: 'finalizada', label: 'Finalizada' },
                      ]}
                    />
                  </div>

                  <div className="form-group">
                    <label className="form-label">Imagen de referencia <span className="text-muted" style={{ fontWeight: 400 }}>(opcional)</span></label>
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
                      {obraImagePreview && (
                        <div style={{ marginTop: '10px', borderRadius: 'var(--radius-md)', overflow: 'hidden', border: '1px solid var(--surface-border)' }}>
                          <img
                            src={obraImagePreview}
                            alt="Vista previa obra"
                            style={{ width: '100%', height: '160px', objectFit: 'cover', display: 'block' }}
                          />
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <div className="form-group">
                  <label className="form-label">Características de la obra (DS44 — definen qué aplica)</label>
                  <div style={{ border: '1px solid var(--surface-border)', borderRadius: 'var(--radius-md)' }}>
                    {[
                      { name: 'faenaCompartida', label: 'Comparte sitio con otra(s) entidad(es) — faena compartida (Art. 20)', checked: Boolean(formData.faenaCompartida) },
                      { name: 'tieneMaquinaria', label: 'Hay máquinas/herramientas motrices (Art. 10)', checked: Boolean(formData.tieneMaquinaria) },
                      { name: 'agentesFQB', label: 'Existen agentes físicos/químicos/biológicos (Art. 2 N°14 c)', checked: Boolean(formData.agentesFQB) },
                    ].map((item, index, arr) => (
                      <label
                        key={item.name}
                        className="checkbox-row"
                        style={{
                          padding: 'var(--space-2) var(--space-3)',
                          cursor: 'pointer',
                          borderBottom: index === arr.length - 1 ? 'none' : '1px solid var(--surface-border)',
                        }}
                      >
                        <input
                          type="checkbox"
                          name={item.name}
                          checked={item.checked}
                          onChange={handleInputChange}
                          className="checkbox-input custom-checkbox"
                        />
                        <span>{item.label}</span>
                      </label>
                    ))}
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
