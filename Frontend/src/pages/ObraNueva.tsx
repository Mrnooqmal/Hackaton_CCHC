import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { obrasApi, tenantsApi, uploadsApi, workersApi } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useObraContext } from '../context/ObraContext';
import AddressAutocomplete from '../components/AddressAutocomplete';
import { FiSearch } from 'react-icons/fi';
import { FormPage, FieldSection, Select, SegmentedControl, PageHeader } from '../components/ui';

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

/** Quita tildes, apóstrofos y signos para comparar nombres de lugar. */
const normalizarLugar = (v: string) =>
  String(v || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Traduce el nombre de región del buscador de direcciones al del catálogo.
 *
 * El proveedor devuelve el nombre largo y oficial ("Región del Biobío",
 * "Región Metropolitana de Santiago", "Región del Libertador General Bernardo
 * O'Higgins"), que nunca es igual a la clave del catálogo: se busca la clave
 * contenida en él.
 */
const regionDelCatalogo = (region: string): string => {
  const n = normalizarLugar(region);
  if (!n) return '';
  return Object.keys(REGION_COMUNAS).find(r => n.includes(normalizarLugar(r))) || '';
};

/** Primera candidata que exista como comuna de esa región. */
const comunaDelCatalogo = (region: string, candidatas: string[]): string => {
  const comunas = REGION_COMUNAS[region] || [];
  for (const candidata of candidatas) {
    const n = normalizarLugar(candidata);
    const comuna = comunas.find(c => normalizarLugar(c) === n);
    if (comuna) return comuna;
  }
  return '';
};

/**
 * Alto de los dos paneles del último paso (imagen y trabajadores).
 *
 * Van lado a lado y antes cada uno medía lo que le pedía su contenido: la
 * lista crecía con la cantidad de gente y el selector de imagen quedaba como
 * una franja suelta al lado de una columna tres veces más alta. Con una medida
 * común, la fila queda pareja y la lista no cambia de alto según el tenant.
 */
const ALTO_PANEL = 260;

/** Nombre y apellidos; `apellido` ya viene armado, los otros dos son el respaldo. */
const nombreCompleto = (p: { nombre?: string; apellido?: string; apellidoPaterno?: string; apellidoMaterno?: string }) =>
  [p.nombre, p.apellido || [p.apellidoPaterno, p.apellidoMaterno].filter(Boolean).join(' ')]
    .filter(Boolean)
    .join(' ')
    .trim();

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
  const [buscaTrabajador, setBuscaTrabajador] = useState('');
  /**
   * Qué dejó la última dirección elegida del buscador.
   *
   * La sugerencia muestra comuna, provincia y región, pero al elegirla el campo
   * se queda solo con la calle: quien probó el formulario creyó que el selector
   * no funcionaba. Esto es el acuse de recibo —qué se reconoció y qué no—, y se
   * borra apenas la dirección se vuelve a escribir a mano.
   */
  const [lugarElegido, setLugarElegido] = useState<{ comuna: string; region: string } | null>(null);

  /**
   * Trabajadores que calzan con la búsqueda.
   *
   * El RUT se compara sin puntos ni guion en ambos lados: quien lo escribe de
   * memoria rara vez lo puntúa igual que como está guardado.
   */
  const trabajadoresVisibles = useMemo(() => {
    const q = buscaTrabajador.trim().toLowerCase();
    if (!q) return workers;
    const qRut = q.replace(/[.-]/g, '');
    return workers.filter(w =>
      nombreCompleto(w).toLowerCase().includes(q)
      || String(w.rut || '').toLowerCase().replace(/[.-]/g, '').includes(qRut)
    );
  }, [workers, buscaTrabajador]);

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
          archivo: obraImageFile, fileName: obraImageFile.name,
          fileType: obraImageFile.type,
          fileSize: obraImageFile.size,
          categoria: 'obras',
          tenantId
        });
        if (!uploadUrlRes.success || !uploadUrlRes.data) throw new Error('Error al obtener URL de subida');
        const uploadResult = await fetch(uploadUrlRes.data.uploadUrl, {
          method: 'PUT',
          body: obraImageFile,
          headers: uploadUrlRes.data.uploadHeaders
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
      <div className="page-content">
        <PageHeader
          banner
          title="Nueva obra"
          description="Define los datos del proyecto para comenzar el flujo DS44."
        />
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
          <label className="form-label">Empresa mandante</label>
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

      {/* La dirección va PRIMERO y región y comuna debajo: al elegir del
          buscador, los dos campos que se rellenan solos quedan a la vista, en
          la línea siguiente. Con el orden anterior el efecto ocurría más
          arriba de donde estaba el ojo y la selección parecía no hacer nada. */}
      <FieldSection title="Ubicación" description="Busca la dirección y confirma comuna y región." cols={2}>
        <div className="form-group full-width">
          <label className="form-label">Dirección *</label>
          <AddressAutocomplete
            required
            value={formData.direccion}
            onChange={v => {
              setLugarElegido(null);
              setFormData(prev => ({ ...prev, direccion: v }));
            }}
            /* La comuna y la región se leen en la sugerencia elegida: obligar a
               repetirlas en sus campos era pedir dos veces el mismo dato. Solo
               se rellenan cuando calzan con el catálogo; si no calzan, se
               dejan como estaban para que nadie herede un valor inventado. */
            onSelect={lugar => {
              const region = regionDelCatalogo(lugar.region);
              const comuna = comunaDelCatalogo(region, lugar.comunaCandidatas);
              setLugarElegido({ comuna, region });
              setFormData(prev => ({
                ...prev,
                direccion: lugar.direccion,
                region: region || prev.region,
                comuna: comuna || (region && region !== prev.region ? '' : prev.comuna),
              }));
            }}
          />
          {/* El campo se queda con la calle —comuna y región tienen su propio
              campo, y repetirlas dentro de la dirección las guardaría dos
              veces—, así que el acuse de recibo dice qué se tomó de ella. */}
          {lugarElegido && (
            <span className="form-hint" style={{ marginTop: 6 }}>
              {lugarElegido.comuna && lugarElegido.region
                ? <>De esa dirección se tomaron <strong style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{lugarElegido.comuna}</strong> y <strong style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{lugarElegido.region}</strong>.</>
                : lugarElegido.region
                  ? <>De esa dirección se tomó <strong style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{lugarElegido.region}</strong>. Elige la comuna aquí abajo.</>
                  : 'No reconocimos la comuna ni la región de esa dirección: complétalas aquí abajo.'}
            </span>
          )}
        </div>
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
            height: ALTO_PANEL,
            boxSizing: 'border-box',
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-3)',
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
            {/* La vista previa ocupa el resto del panel; sin foto, el hueco dice
                para qué sirve en vez de quedar en blanco. */}
            {obraImagePreview ? (
              <div style={{ flex: 1, minHeight: 0, borderRadius: 'var(--radius-md)', overflow: 'hidden', border: '1px solid var(--surface-border)' }}>
                <img
                  src={obraImagePreview}
                  alt="Vista previa"
                  style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                />
              </div>
            ) : (
              <div className="text-muted" style={{
                flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
                textAlign: 'center', fontSize: 'var(--text-sm)', lineHeight: 1.5,
              }}>
                La foto encabeza el detalle de la obra y su tarjeta en el listado.
              </div>
            )}
          </div>
        </div>
      </FieldSection>

      <FieldSection title="Trabajadores asignados" description="Personas habilitadas para acceder a esta obra desde el inicio.">
        <div className="full-width" style={{
          height: ALTO_PANEL,
          display: 'flex',
          flexDirection: 'column',
          border: '1px solid var(--surface-border)',
          borderRadius: 'var(--radius-md)',
          overflow: 'hidden',
        }}>
          {/* El buscador va DENTRO de la caja: fuera, la columna crecería y
              dejaría de calzar con el panel de la imagen. */}
          <label style={{
            display: 'flex', alignItems: 'center', gap: 9, flexShrink: 0,
            height: 38, padding: '0 12px',
            borderBottom: '1px solid var(--surface-border)',
          }}>
            <FiSearch size={15} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
            <input
              value={buscaTrabajador}
              onChange={e => setBuscaTrabajador(e.target.value)}
              placeholder="Buscar por nombre o RUT…"
              aria-label="Buscar trabajador"
              autoComplete="off"
              style={{
                flex: 1, minWidth: 0, height: '100%',
                background: 'none', border: 'none', outline: 'none',
                color: 'var(--text-primary)', fontFamily: 'inherit', fontSize: '13.5px',
              }}
            />
          </label>

          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
            {workers.length === 0 ? (
              <div className="text-muted" style={{ padding: 'var(--space-3)' }}>No hay trabajadores en la empresa.</div>
            ) : trabajadoresVisibles.length === 0 ? (
              <div className="text-muted" style={{ padding: 'var(--space-3)' }}>Nadie calza con esa búsqueda.</div>
            ) : (
              trabajadoresVisibles.map((worker, idx) => (
                <label
                  key={worker.personaId}
                  className="checkbox-row"
                  style={{
                    padding: 'var(--space-2) var(--space-3)',
                    cursor: 'pointer',
                    borderBottom: idx < trabajadoresVisibles.length - 1 ? '1px solid var(--surface-border)' : 'none',
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
                  {/* Nombre arriba; abajo el RUT y el rol, que son el dato con
                      que se distingue a dos personas que se llaman igual. */}
                  <span style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
                    <span>{nombreCompleto(worker)}</span>
                    <span className="text-muted" style={{ fontSize: 'var(--text-xs)' }}>
                      {[worker.rut, worker.rolNombre || worker.rol].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                </label>
              ))
            )}
          </div>
        </div>
      </FieldSection>
      </div>
    </FormPage>
    </>
  );
}
