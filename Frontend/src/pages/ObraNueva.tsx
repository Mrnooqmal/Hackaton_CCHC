import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { obrasApi, tenantsApi, uploadsApi, workersApi } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useObraContext } from '../context/ObraContext';
import AddressAutocomplete from '../components/AddressAutocomplete';
import { FormPage, FieldSection, Select, SegmentedControl } from '../components/ui';
import { FiArrowLeft } from 'react-icons/fi';

interface ObraForm {
  nombre: string;
  codigo: string;
  direccion: string;
  comuna: string;
  region: string;
  mandante: string;
  estado: string;
  trabajadoresAprobados: string[];
  faenaCompartida: boolean;
  tieneMaquinaria: boolean;
  agentesFQB: boolean;
}

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

const INITIAL_FORM: ObraForm = {
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
  agentesFQB: false,
};

export default function ObraNueva() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { refreshObras } = useObraContext();

  const [formData, setFormData] = useState<ObraForm>(INITIAL_FORM);
  const [workers, setWorkers] = useState<any[]>([]);
  const [obraImageFile, setObraImageFile] = useState<File | null>(null);
  const [obraImagePreview, setObraImagePreview] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState('');

  const resolvedCompanyName = useMemo(() => {
    const u = user as any;
    return companyName || u?.empresaNombre || u?.nombreEmpresa || u?.tenantNombre || u?.razonSocial || '';
  }, [companyName, user]);

  // Load workers + tenant name on mount
  useEffect(() => {
    workersApi.list().then(res => {
      if (res.success && res.data) setWorkers((res.data as any).personas || res.data);
    }).catch(() => {});

    if (user?.tenantId) {
      tenantsApi.get(user.tenantId).then(res => {
        if (res.success && res.data?.nombre) setCompanyName(res.data.nombre);
      }).catch(() => {});
    }
  }, []);

  // Auto-fill mandante when company name resolves
  useEffect(() => {
    if (resolvedCompanyName && !formData.mandante) {
      setFormData(prev => ({ ...prev, mandante: resolvedCompanyName }));
    }
  }, [resolvedCompanyName]);

  // Image preview URL lifecycle
  useEffect(() => {
    if (!obraImageFile) { setObraImagePreview(''); return; }
    const url = URL.createObjectURL(obraImageFile);
    setObraImagePreview(url);
    return () => URL.revokeObjectURL(url);
  }, [obraImageFile]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value, type } = e.target as HTMLInputElement;
    const checked = (e.target as HTMLInputElement).checked;
    setFormData(prev => ({ ...prev, [name]: type === 'checkbox' ? checked : value }));
  };

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    setObraImageFile(file || null);
    if (e.target) e.target.value = '';
  };

  const handleWorkerToggle = (workerId: string) => {
    setFormData(prev => {
      const current = prev.trabajadoresAprobados;
      const updated = current.includes(workerId)
        ? current.filter(id => id !== workerId)
        : [...current, workerId];
      return { ...prev, trabajadoresAprobados: updated };
    });
  };

  const handleRegionChange = (value: string) => {
    setFormData(prev => ({ ...prev, region: value, comuna: '' }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isCreating) return;
    setError('');
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
        if (!uploadResult.ok) throw new Error('Error al subir imagen');
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
        refreshObras();
        navigate('/obras');
      } else {
        setError('No se pudo crear la obra. Intenta nuevamente.');
      }
    } catch (err) {
      console.error(err);
      setError('Ocurrió un error al crear la obra.');
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <>
      <div style={{ background: '#002952', padding: 'var(--space-5) var(--space-8) 0', position: 'relative' }}>
        <div style={{ maxWidth: 960, margin: '0 auto' }}>
          <button
            type="button"
            onClick={() => navigate('/obras')}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              background: 'none', border: 'none', cursor: 'pointer',
              color: 'rgba(255,255,255,0.7)', fontSize: 'var(--text-sm)', padding: 0,
              marginBottom: 'var(--space-2)',
            }}
          >
            <FiArrowLeft size={14} /> Obras
          </button>
          <h1 style={{ margin: 0, fontSize: 'var(--text-2xl)', fontWeight: 700, color: 'white', fontFamily: 'var(--font-display)' }}>
            Nueva obra
          </h1>
          <p style={{ margin: 'var(--space-1) 0 0', fontSize: 'var(--text-sm)', color: 'rgba(255,255,255,0.75)' }}>
            Define los datos del proyecto para comenzar el flujo DS44.
          </p>
        </div>
        <div style={{ height: 3, background: 'linear-gradient(90deg, #006edc 0%, #df3601 100%)', marginTop: 'var(--space-6)' }} />
      </div>
      <FormPage
        maxWidth={960}
        header={<></>}
        onSubmit={handleSubmit}
        actions={
          <>
            {error && <span style={{ color: 'var(--danger-500)', fontSize: 'var(--text-sm)', marginRight: 'auto' }}>{error}</span>}
            <button type="button" className="btn btn-secondary" onClick={() => navigate('/obras')}>
              Cancelar
            </button>
            <button type="submit" className="btn btn-primary" disabled={isCreating}>
              {isCreating ? 'Creando…' : 'Crear obra'}
            </button>
          </>
        }
      >
      <FieldSection title="Identificación" description="Nombre oficial y código interno de la obra." cols={2}>
        <div className="form-group full-width">
          <label className="form-label">Nombre de obra *</label>
          <input
            required
            name="nombre"
            value={formData.nombre}
            onChange={handleInputChange}
            className="form-input"
            placeholder="Ej. Torre Costanera Norte"
          />
        </div>
        <div className="form-group">
          <label className="form-label">Código</label>
          <input
            name="codigo"
            value={formData.codigo}
            onChange={handleInputChange}
            className="form-input"
            placeholder="Ej. OBR-001"
          />
        </div>
        <div className="form-group">
          <label className="form-label">Mandante</label>
          <input
            name="mandante"
            value={resolvedCompanyName || formData.mandante}
            onChange={handleInputChange}
            className="form-input"
            placeholder={resolvedCompanyName || 'Empresa mandante'}
            disabled
          />
        </div>
        <div className="form-group full-width">
          <label className="form-label">Estado</label>
          <SegmentedControl
            ariaLabel="Estado de la obra"
            value={formData.estado}
            onChange={(v) => setFormData(prev => ({ ...prev, estado: v }))}
            options={[
              { value: 'activa', label: 'Activa' },
              { value: 'pausada', label: 'Pausada' },
              { value: 'finalizada', label: 'Finalizada' },
            ]}
          />
        </div>
      </FieldSection>

      <FieldSection title="Ubicación" description="Región, comuna y dirección exacta del proyecto." cols={2}>
        <div className="form-group">
          <label className="form-label">Región *</label>
          <Select
            ariaLabel="Región"
            placeholder="Selecciona una región"
            searchable
            value={formData.region}
            onChange={handleRegionChange}
            options={Object.keys(REGION_COMUNAS).map(r => ({ value: r, label: r }))}
          />
        </div>
        <div className="form-group">
          <label className="form-label">Comuna *</label>
          <Select
            ariaLabel="Comuna"
            placeholder="Selecciona una comuna"
            searchable
            disabled={!formData.region}
            value={formData.comuna}
            onChange={(v) => setFormData(prev => ({ ...prev, comuna: v }))}
            options={(REGION_COMUNAS[formData.region] || []).map(c => ({ value: c, label: c }))}
          />
        </div>
        <div className="form-group full-width">
          <label className="form-label">Dirección *</label>
          <AddressAutocomplete
            required
            value={formData.direccion}
            onChange={v => setFormData(prev => ({ ...prev, direccion: v }))}
          />
        </div>
      </FieldSection>

      <FieldSection title="Características DS44" description="Define qué artículos del DS44 aplican a esta obra.">
        <div className="full-width" style={{ border: '1px solid var(--surface-border)', borderRadius: 'var(--radius-md)' }}>
          {[
            { name: 'faenaCompartida', label: 'Comparte sitio con otra(s) entidad(es) — faena compartida (Art. 20)', checked: formData.faenaCompartida },
            { name: 'tieneMaquinaria', label: 'Hay máquinas/herramientas motrices (Art. 10)', checked: formData.tieneMaquinaria },
            { name: 'agentesFQB', label: 'Existen agentes físicos/químicos/biológicos (Art. 2 N°14 c)', checked: formData.agentesFQB },
          ].map((item, idx, arr) => (
            <label
              key={item.name}
              className="checkbox-row"
              style={{
                padding: 'var(--space-2) var(--space-3)',
                cursor: 'pointer',
                borderBottom: idx < arr.length - 1 ? '1px solid var(--surface-border)' : 'none',
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-2)',
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
      </FieldSection>

      <div className="grid-collapse-mobile" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-5)', alignItems: 'start' }}>
      <FieldSection title="Imagen de referencia" description="Foto del terreno u obra (opcional).">
        <div className="form-group full-width">
          <div style={{
            border: '1px dashed var(--surface-border)',
            borderRadius: 'var(--radius-md)',
            padding: 'var(--space-4)',
            background: 'var(--surface-elevated)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
              <label htmlFor="obra-image-upload" className="btn btn-secondary" style={{ cursor: 'pointer' }}>
                Seleccionar imagen
              </label>
              <span className="text-muted" style={{ fontSize: 'var(--text-sm)' }}>
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
              <div style={{ marginTop: 12, borderRadius: 'var(--radius-md)', overflow: 'hidden', border: '1px solid var(--surface-border)' }}>
                <img
                  src={obraImagePreview}
                  alt="Vista previa"
                  style={{ width: '100%', height: 180, objectFit: 'cover', display: 'block' }}
                />
              </div>
            )}
          </div>
        </div>
      </FieldSection>

      <FieldSection title="Trabajadores asignados" description="Personas habilitadas para acceder a esta obra desde el inicio.">
        <div className="full-width" style={{ maxHeight: 260, overflowY: 'auto', border: '1px solid var(--surface-border)', borderRadius: 'var(--radius-md)' }}>
          {workers.length === 0 ? (
            <div className="text-muted" style={{ padding: 'var(--space-3)' }}>No hay trabajadores en el tenant.</div>
          ) : (
            workers.map((worker, idx) => (
              <label
                key={worker.personaId}
                className="checkbox-row"
                style={{
                  padding: 'var(--space-2) var(--space-3)',
                  cursor: 'pointer',
                  borderBottom: idx < workers.length - 1 ? '1px solid var(--surface-border)' : 'none',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--space-2)',
                }}
              >
                <input
                  type="checkbox"
                  checked={formData.trabajadoresAprobados.includes(worker.personaId)}
                  onChange={() => handleWorkerToggle(worker.personaId)}
                  className="checkbox-input custom-checkbox"
                />
                <span>{worker.nombre}</span>
                <span className="text-muted">({worker.rut})</span>
              </label>
            ))
          )}
        </div>
      </FieldSection>
      </div>
    </FormPage>
    </>
  );
}
