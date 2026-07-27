import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { tenantsApi } from '../api/tenants.api';
import { personasApi } from '../api/personas.api';
import type { TenantSetupData, TenantSetupResponse } from '../api/tenants.api';
import { FiArrowRight, FiArrowLeft, FiCheckCircle, FiCopy, FiCheck, FiUserPlus, FiX, FiUpload, FiDownload, FiAlertCircle, FiPlus, FiInfo, FiLock } from 'react-icons/fi';
import { PERMISSION_GROUPS, DEFAULT_ROLE_PRESETS, ALL_PERMISSION_KEYS } from '../permissions';
import { DS44_CARGOS } from '../utils/ds44';

// ── RUT utilities ────────────────────────────────────────────────
function rutFormat(raw: string): string {
  const clean = raw.replace(/[^0-9kK]/g, '').toUpperCase();
  if (clean.length < 2) return clean;
  const body = clean.slice(0, -1);
  const dv   = clean.slice(-1);
  return body.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + '-' + dv;
}

function rutValid(rut: string): boolean {
  const clean = rut.replace(/[^0-9kK]/g, '').toUpperCase();
  if (clean.length < 2) return false;
  const body = clean.slice(0, -1);
  const dv   = clean.slice(-1);
  let sum = 0, mult = 2;
  for (let i = body.length - 1; i >= 0; i--) {
    sum += parseInt(body[i]) * mult;
    mult = mult === 7 ? 2 : mult + 1;
  }
  const rem = 11 - (sum % 11);
  return dv === (rem === 11 ? '0' : rem === 10 ? 'K' : String(rem));
}
// ─────────────────────────────────────────────────────────────────

type Step = 'empresa' | 'roles' | 'admin' | 'trabajadores' | 'confirmacion';
const STEPS: Step[] = ['empresa', 'roles', 'admin', 'trabajadores', 'confirmacion'];
const STEP_LABELS: Record<Step, string> = {
  empresa: 'Empresa',
  roles: 'Roles',
  admin: 'Administrador',
  trabajadores: 'Trabajadores',
  confirmacion: 'Confirmar',
};
const STEP_NUMS: Record<Step, string> = {
  empresa: '1', roles: '2', admin: '3', trabajadores: '4', confirmacion: '5',
};
// ── Roles de la empresa ───────────────────────────────────────────
// `tipo` es la esencia estable del rol (admin|jefe_obra|prevencionista|
// supervisor|trabajador). Los roles con `tipo` son los mínimos de toda empresa:
//   • `protegido` → no se pueden eliminar ni editar su descripción; SOLO el
//     nombre es editable. Sus permisos sí se pueden ajustar (la esencia la
//     define el `tipo`, no los permisos).
//   • `locked` (solo Administrador) → además, permisos no editables (acceso total).
interface RoleDraft { _id: string; nombre: string; descripcion: string; permisos: string[]; locked?: boolean; tipo?: string | null; protegido?: boolean; }
const DEFAULT_ROLES: Array<Omit<RoleDraft, '_id'>> = [
  { nombre: 'Jefe de Obra', descripcion: 'Responsable de la dirección y supervisión de la obra.', permisos: DEFAULT_ROLE_PRESETS.jefe_obra, tipo: 'jefe_obra', protegido: true },
  { nombre: 'Prevencionista', descripcion: 'Encargado de la prevención de riesgos y la seguridad en obra.', permisos: DEFAULT_ROLE_PRESETS.prevencionista, tipo: 'prevencionista', protegido: true },
  { nombre: 'Supervisor', descripcion: 'Lidera una cuadrilla de personas trabajadoras y coordina el equipo en terreno.', permisos: DEFAULT_ROLE_PRESETS.supervisor, tipo: 'supervisor', protegido: true },
  { nombre: 'Persona trabajadora', descripcion: 'Ejecuta las actividades diarias en obra dentro de la cuadrilla de un supervisor.', permisos: DEFAULT_ROLE_PRESETS.trabajador, tipo: 'trabajador', protegido: true },
];
const ADMIN_ROLE_DRAFT: RoleDraft = {
  _id: 'role-admin',
  nombre: 'Administrador',
  descripcion: 'Acceso completo a la gestión de la empresa.',
  permisos: ALL_PERMISSION_KEYS,
  locked: true,
  protegido: true,
  tipo: 'admin',
};

// Cargos = oficios DS44 (catálogo semilla). Los perfiles de acceso
// (Administrativo/Prevencionista/Supervisor) son ROLES, viven en el paso "Roles".
const CARGOS = DS44_CARGOS;

const BLANK_WORKER = {
  rut: '', nombre: '', apellidoPaterno: '', apellidoMaterno: '',
  fechaNacimiento: '', email: '', rol: 'trabajador', cargo: '', tieneAccesoWeb: true,
};

interface WorkerDraft {
  _id: string; rut: string; nombre: string;
  apellidoPaterno: string; apellidoMaterno: string;
  fechaNacimiento: string; email: string; rol: string; cargo: string; tieneAccesoWeb: boolean;
}
interface WorkerResult {
  rut: string; nombre: string; apellido: string;
  password?: string; error?: string;
}

export default function TenantOnboarding() {
  const navigate = useNavigate();
  const [currentStep, setCurrentStep] = useState<Step>('empresa');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Set<string>>(new Set());
  const [copiedKey, setCopiedKey] = useState('');
  const [result, setResult] = useState<TenantSetupResponse | null>(null);
  const [adminPassword, setAdminPassword] = useState('');
  const [workersResult, setWorkersResult] = useState<WorkerResult[]>([]);

  // La empresa parte con tamaño 1 (solo el administrador) y crece automáticamente
  // al registrar trabajadores; ya no se pide un número manual.
  const [empresa, setEmpresa] = useState({
    nombre: '', rutEmpresa: '', logo: null as string | null, colorPrincipal: '#006edc',
    codigoHabilitacion: '',
  });
  const logoInputRef = useRef<HTMLInputElement>(null);
  const [admin, setAdmin] = useState({ rut: '', nombre: '', apellidoPaterno: '', apellidoMaterno: '', fechaNacimiento: '', email: '' });
  const [roles, setRoles] = useState<RoleDraft[]>(() => [
    ADMIN_ROLE_DRAFT,
    ...DEFAULT_ROLES.map((r, i) => ({ ...r, _id: `role-${i}` })),
  ]);
  const [rolesInfoVisible, setRolesInfoVisible] = useState(true);
  const [workers, setWorkers] = useState<WorkerDraft[]>([]);
  const [wForm, setWForm] = useState(() => ({
    ...BLANK_WORKER,
    rol: DEFAULT_ROLES.find(r => r.tipo === 'trabajador')?.nombre.trim() ?? '',
  }));
  const [wErrors, setWErrors] = useState<Set<string>>(new Set());
  const [workerTab, setWorkerTab] = useState<'manual' | 'bulk'>('manual');
  const [bulkLoading, setBulkLoading] = useState(false);
  const [bulkErrors, setBulkErrors] = useState<Array<{ fila: number; error: string }>>([]);
  const [bulkSuccess, setBulkSuccess] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const idx = STEPS.indexOf(currentStep);

  const clearField = (k: string) => setFieldErrors(p => {
    if (!p.has(k)) return p;
    const n = new Set(p); n.delete(k); return n;
  });

  const validateEmpresa = (): string[] => {
    const f: string[] = [];
    if (!empresa.nombre.trim()) f.push('nombre');
    if (!empresa.rutEmpresa.trim()) f.push('rutEmpresa');
    else if (!rutValid(empresa.rutEmpresa)) f.push('rutEmpresaFormato');
    return f;
  };

  const validateAdmin = (): string[] => {
    const f: string[] = [];
    if (!admin.rut.trim()) f.push('rut');
    else if (!rutValid(admin.rut)) f.push('rutFormato');
    if (!admin.nombre.trim()) f.push('adminNombre');
    if (!admin.apellidoPaterno.trim()) f.push('adminApellidoPaterno');
    if (!admin.email.trim()) f.push('email');
    else if (!/\S+@\S+\.\S+/.test(admin.email)) f.push('emailFormato');
    return f;
  };

  const buildMsg = (fields: string[]) => {
    const LABELS: Record<string, string> = {
      nombre: 'Razón social', rutEmpresa: 'RUT empresa',
      rut: 'RUT', adminNombre: 'Nombre',
      adminApellidoPaterno: 'Apellido paterno', email: 'Email',
    };
    const msgs: string[] = [];
    const required = fields.filter(f => !['rutEmpresaFormato','rutFormato','emailFormato'].includes(f));
    if (required.length) msgs.push(`Completa: ${required.map(x => LABELS[x] || x).join(', ')}`);
    if (fields.includes('rutEmpresaFormato') || fields.includes('rutFormato')) msgs.push('El RUT no es válido.');
    if (fields.includes('emailFormato')) msgs.push('El email no tiene un formato válido.');
    return msgs.join(' ');
  };

  const next = async () => {
    setError(''); setFieldErrors(new Set());
    if (currentStep === 'empresa') {
      const f = validateEmpresa();
      if (f.length) { setFieldErrors(new Set(f)); setError(buildMsg(f)); return; }
      setLoading(true);
      try {
        const res = await tenantsApi.validate({ nombre: empresa.nombre, rutEmpresa: empresa.rutEmpresa });
        if (res.success && res.data && !res.data.valido) {
          const campos = new Set<string>();
          const msgs: string[] = [];
          if (res.data.conflictos.nombre) { campos.add('nombre'); msgs.push(res.data.conflictos.nombre); }
          if (res.data.conflictos.rutEmpresa) { campos.add('rutEmpresa'); msgs.push(res.data.conflictos.rutEmpresa); }
          setFieldErrors(campos);
          setError(msgs.join(' '));
          return;
        }
      } catch {
        // si el servidor no responde, permitir continuar
      } finally {
        setLoading(false);
      }
    }
    if (currentStep === 'roles') {
      if (roles.length === 0) {
        setError('Debes mantener al menos un rol para la empresa.');
        return;
      }
      if (roles.some(r => !r.nombre.trim())) {
        setError('Cada rol debe tener un nombre.');
        return;
      }
      const nombres = roles.map(r => r.nombre.trim().toLowerCase());
      if (new Set(nombres).size !== nombres.length) {
        setError('Hay roles con nombres duplicados.');
        return;
      }
    }
    if (currentStep === 'admin') {
      const f = validateAdmin();
      if (f.length) { setFieldErrors(new Set(f)); setError(buildMsg(f)); return; }
      setLoading(true);
      try {
        const res = await personasApi.validateRut(admin.rut);
        if (res.success && res.data && !res.data.valido) {
          setFieldErrors(new Set(['rut']));
          setError(res.data.mensaje || 'El RUT ya está registrado en el sistema');
          return;
        }
      } catch {
        // si el servidor no responde, permitir continuar
      } finally {
        setLoading(false);
      }
    }
    if (idx + 1 < STEPS.length) setCurrentStep(STEPS[idx + 1]);
  };

  const prev = () => {
    setError(''); setFieldErrors(new Set());
    if (idx > 0) setCurrentStep(STEPS[idx - 1]);
  };

  const updateRole = (id: string, field: 'nombre' | 'descripcion', value: string) =>
    setRoles(p => p.map(r => {
      if (r._id !== id) return r;
      // En roles protegidos solo el nombre es editable (la descripción no).
      if (field === 'descripcion' && r.protegido) return r;
      return { ...r, [field]: value };
    }));

  // Mantiene el rol si no es el objetivo, o si es protegido (mínimo, no removible).
  const removeRole = (id: string) => setRoles(p => p.filter(r => r._id !== id || r.protegido));

  const togglePermiso = (id: string, permKey: string) =>
    setRoles(p => p.map(r => {
      if (r._id !== id || r.locked) return r;
      const has = r.permisos.includes(permKey);
      return { ...r, permisos: has ? r.permisos.filter(k => k !== permKey) : [...r.permisos, permKey] };
    }));

  const addRole = () =>
    setRoles(p => [...p, { _id: String(Date.now() + Math.random()), nombre: '', descripcion: '', permisos: [] }]);

  const addWorker = () => {
    const errs = new Set<string>();
    if (!wForm.nombre.trim()) errs.add('wNombre');
    if (!wForm.apellidoPaterno.trim()) errs.add('wApellidoPaterno');
    if (!wForm.rut.trim()) errs.add('wRut');
    else if (!rutValid(wForm.rut)) errs.add('wRutFormato');
    else if (wForm.rut.trim() === admin.rut.trim()) errs.add('wRutDupAdmin');
    else if (workers.some(w => w.rut.trim() === wForm.rut.trim())) errs.add('wRutDup');
    setWErrors(errs);
    if (errs.size) return;
    setWorkers(p => [...p, { ...wForm, _id: String(Date.now() + Math.random()) }]);
    setWForm({ ...BLANK_WORKER, rol: (roles.find(r => r.tipo === 'trabajador') ?? roles.find(r => !r.locked))?.nombre.trim() ?? '' });
    setWErrors(new Set());
  };

  const removeWorker = (id: string) => setWorkers(p => p.filter(w => w._id !== id));

  const handleBulkUpload = async (file: File) => {
    if (!file.name.toLowerCase().endsWith('.xlsx')) {
      setBulkErrors([{ fila: 0, error: 'El archivo debe ser .xlsx' }]);
      return;
    }
    setBulkLoading(true);
    setBulkErrors([]);
    setBulkSuccess(0);
    try {
      const reader = new FileReader();
      reader.onload = async (e) => {
        const base64 = (e.target?.result as string).split('base64,')[1] || '';
        const res = await personasApi.parseExcel({ fileBase64: base64, fileName: file.name });
        if (!res.success || !res.data) {
          setBulkErrors([{ fila: 0, error: res.error || 'Error al procesar el archivo' }]);
          setBulkLoading(false);
          return;
        }
        const { trabajadores, errores } = res.data;
        const adminRutClean = admin.rut.replace(/[^0-9kK]/gi, '').toLowerCase();
        const existingRuts = new Set(workers.map(w => w.rut.replace(/[^0-9kK]/gi, '').toLowerCase()));
        const added: WorkerDraft[] = [];
        const skipped: Array<{ fila: number; error: string }> = [...errores];
        trabajadores.forEach((t, i) => {
          const rutClean = t.rut.replace(/[^0-9kK]/gi, '').toLowerCase();
          if (rutClean === adminRutClean) {
            skipped.push({ fila: i + 2, error: `${t.rut}: mismo RUT que el administrador` });
          } else if (existingRuts.has(rutClean)) {
            skipped.push({ fila: i + 2, error: `${t.rut}: ya está en la lista` });
          } else {
            existingRuts.add(rutClean);
            added.push({ ...t, _id: String(Date.now() + Math.random()) });
          }
        });
        setWorkers(p => [...p, ...added]);
        setBulkSuccess(added.length);
        setBulkErrors(skipped);
        setBulkLoading(false);
      };
      reader.readAsDataURL(file);
    } catch {
      setBulkErrors([{ fila: 0, error: 'Error al leer el archivo' }]);
      setBulkLoading(false);
    }
  };

  const handleSubmit = async () => {
    setLoading(true); setError('');
    try {
      const payload: TenantSetupData = {
        nombre: empresa.nombre,
        rutEmpresa: empresa.rutEmpresa,
        // Código de habilitación (gating de alta). Se valida server-side.
        codigoHabilitacion: empresa.codigoHabilitacion.trim() || undefined,
        // Tamaño inicial 1 (solo el administrador). El backend lo fuerza igualmente.
        cantidadTrabajadores: 1,
        preferencias: {
          colorPrimario: empresa.colorPrincipal,
          logoBase64: empresa.logo ?? undefined,
        },
        roles: roles.map(r => ({
          // El id de los roles protegidos lo fija el backend según su `tipo`.
          id: r.tipo ?? r.nombre.trim(),
          tipo: r.tipo ?? null,
          nombre: r.nombre.trim(),
          descripcion: r.descripcion.trim(),
          permisos: r.locked ? ALL_PERMISSION_KEYS : r.permisos,
        })),
        admin: { rut: admin.rut, nombre: admin.nombre, apellidoPaterno: admin.apellidoPaterno, apellidoMaterno: admin.apellidoMaterno, fechaNacimiento: admin.fechaNacimiento || undefined, email: admin.email },
        // Los trabajadores se crean en el mismo setup (server-side) para que queden
        // persistidos de forma confiable junto al tenant y el administrador.
        trabajadores: workers.map(w => ({
          rut: w.rut, nombre: w.nombre,
          apellidoPaterno: w.apellidoPaterno, apellidoMaterno: w.apellidoMaterno,
          fechaNacimiento: w.fechaNacimiento || undefined,
          email: w.email, rol: w.rol, cargo: w.cargo,
          tieneAccesoWeb: true,
        })),
      };
      const response = await tenantsApi.setup(payload);
      if (response.success && response.data) {
        const data = response.data as any;
        const tempPwd = typeof data.passwordTemporal === 'string' ? data.passwordTemporal
          : (typeof data.admin?.passwordTemporal === 'string' ? data.admin.passwordTemporal : '');
        setAdminPassword(tempPwd);

        const trabajadores = (response.data.trabajadores || []) as Array<{ rut: string; nombre: string; apellido: string; password?: string; error?: string }>;
        if (trabajadores.length > 0) {
          setWorkersResult(trabajadores.map(t => ({
            rut: t.rut, nombre: t.nombre, apellido: t.apellido || '',
            password: t.password, error: t.error,
          })));
        }
        setResult(response.data);
      } else {
        setError(response.error || 'Error al crear la empresa');
      }
    } catch {
      setError('Error de conexión con el servidor');
    } finally {
      setLoading(false);
    }
  };

  const copyText = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(''), 2000);
  };

  const compressLogo = (dataUrl: string): Promise<string> =>
    new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const MAX_H = 120;
        const scale = Math.min(1, MAX_H / img.height);
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        canvas.getContext('2d')!.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/png'));
      };
      img.onerror = reject;
      img.src = dataUrl;
    });

  const handleLogoFile = (file: File) => {
    if (!file.type.startsWith('image/')) {
      setError('El logo debe ser una imagen (PNG, JPG, SVG, WebP).');
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setError('El logo no puede superar los 2 MB.');
      return;
    }
    const reader = new FileReader();
    reader.onload = async e => {
      try {
        const compressed = await compressLogo(e.target?.result as string);
        setEmpresa(prev => ({ ...prev, logo: compressed }));
        setError('');
      } catch {
        setError('Error al procesar la imagen.');
      }
    };
    reader.readAsDataURL(file);
  };

  const hexToRgb = (hex: string) => {
    const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
    if (!m) return { r: 0, g: 110, b: 220 };
    return { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) };
  };

  // Contraste WCAG contra blanco (texto blanco sobre el color de marca).
  const contrastVsWhite = (hex: string) => {
    const { r, g, b } = hexToRgb(hex);
    const lum = [r, g, b].map((v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    const l = 0.2126 * lum[0] + 0.7152 * lum[1] + 0.0722 * lum[2];
    return 1.05 / (l + 0.05);
  };

  const SUGGESTED_COLORS = [
    { hex: '#006edc', label: 'Azul CChC' },
    { hex: '#002952', label: 'Azul marino' },
    { hex: '#df3601', label: 'Naranja' },
    { hex: '#c81e1e', label: 'Rojo' },
    { hex: '#047857', label: 'Verde' },
    { hex: '#7c3aed', label: 'Violeta' },
    { hex: '#b45309', label: 'Ámbar' },
    { hex: '#0e7490', label: 'Cian' },
  ];

  /* ── SUCCESS ── */
  if (result) {
    return (
      <div className="onb-root">
        <div className="onb-bg" aria-hidden="true" />
        <div className="onb-card">
          <div className="onb-logo">
            <span className="onb-logo-b">Build</span>
            <span className="onb-logo-amp">&amp;</span>
            <span className="onb-logo-s">Serve</span>
          </div>
          <div className="onb-divider" />

          <div style={{ textAlign: 'center', marginBottom: 20 }}>
            <div className="onb-success-circle"><FiCheckCircle size={36} /></div>
            <h2 className="onb-success-title">¡Empresa Registrada!</h2>
            <p className="onb-success-sub">
              <strong>{result.tenant.nombre}</strong> ha sido configurada exitosamente.
            </p>
          </div>

          {result.admin && (
            <div className="onb-cred-block">
              <div className="onb-cred-label">ADMINISTRADOR</div>
              <div className="onb-cred-value">{result.admin.nombre} {result.admin.apellido} — {result.admin.rut}</div>
              {adminPassword && (
                <>
                  <div className="onb-pw-tag">Contraseña temporal</div>
                  <div className="onb-pw-box">
                    <code className="onb-pw-code">{adminPassword}</code>
                    <button className="onb-copy-btn" onClick={() => copyText(adminPassword, 'admin')} title="Copiar">
                      {copiedKey === 'admin' ? <FiCheck size={14} /> : <FiCopy size={14} />}
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          {workersResult.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <div className="onb-cred-label" style={{ marginBottom: 10 }}>
                TRABAJADORES CREADOS ({workersResult.length})
              </div>
              {workersResult.map((w, i) => (
                <div key={i} className={`onb-cred-block ${w.error ? 'onb-cred-block--err' : ''}`} style={{ marginBottom: 8 }}>
                  <div className="onb-cred-value">{w.nombre} {w.apellido} — {w.rut}</div>
                  {w.error && <div className="onb-cred-error">{w.error}</div>}
                  {w.password && (
                    <div className="onb-pw-box" style={{ marginTop: 6 }}>
                      <code className="onb-pw-code">{w.password}</code>
                      <button className="onb-copy-btn" onClick={() => copyText(w.password!, `w-${i}`)} title="Copiar">
                        {copiedKey === `w-${i}` ? <FiCheck size={14} /> : <FiCopy size={14} />}
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          <button className="onb-submit" style={{ width: '100%', justifyContent: 'center' }} onClick={() => navigate('/login')}>
            <span>Ir al Login</span> <FiArrowRight size={15} />
          </button>
          <p className="onb-hint">Se solicitará cambiar la contraseña en el primer acceso.</p>
        </div>
        <style>{onbStyles}</style>
      </div>
    );
  }

  /* ── WIZARD ── */
  return (
    <div className="onb-root">
      <div className="onb-bg" aria-hidden="true" />
      <div className="onb-card" role="main">
        {/* Logo */}
        <div className="onb-logo">
          <span className="onb-logo-b">Build</span>
          <span className="onb-logo-amp">&amp;</span>
          <span className="onb-logo-s">Serve</span>
        </div>

        {/* Stepper */}
        <div className="onb-stepper">
          {STEPS.map((s, i) => (
            <div key={s} className="onb-step-group">
              <div className={`onb-step-dot${i < idx ? ' done' : ''}${s === currentStep ? ' active' : ''}`}>
                {i < idx ? <FiCheck size={12} /> : STEP_NUMS[s]}
              </div>
              <span className={`onb-step-lbl${s === currentStep ? ' active' : ''}`}>{STEP_LABELS[s]}</span>
              {i < STEPS.length - 1 && <div className={`onb-step-line${i < idx ? ' done' : ''}`} />}
            </div>
          ))}
        </div>

        <div className="onb-divider" />

        {/* Step: Empresa */}
        {currentStep === 'empresa' && (
          <div className="onb-anim">
            <h2 className="onb-title">Datos de la Empresa</h2>
            <div className="onb-grid">
              <div className="onb-field onb-full">
                <label className="onb-label">RAZÓN SOCIAL *</label>
                <input
                  className={`onb-input${fieldErrors.has('nombre') ? ' onb-input--err' : ''}`}
                  placeholder="Constructora Demo SpA"
                  value={empresa.nombre}
                  onChange={e => { setEmpresa({ ...empresa, nombre: e.target.value }); clearField('nombre'); }}
                />
              </div>
              <div className="onb-field onb-full">
                <label className="onb-label">RUT EMPRESA *</label>
                <input
                  className={`onb-input${(fieldErrors.has('rutEmpresa') || fieldErrors.has('rutEmpresaFormato')) ? ' onb-input--err' : ''}`}
                  placeholder="76.123.456-7"
                  value={empresa.rutEmpresa}
                  onChange={e => { setEmpresa({ ...empresa, rutEmpresa: rutFormat(e.target.value) }); clearField('rutEmpresa'); clearField('rutEmpresaFormato'); }}
                />
              </div>
              <div className="onb-field onb-full">
                <label className="onb-label">CÓDIGO DE HABILITACIÓN</label>
                <input
                  className="onb-input"
                  placeholder="Código entregado por la CChC"
                  value={empresa.codigoHabilitacion}
                  onChange={e => setEmpresa({ ...empresa, codigoHabilitacion: e.target.value })}
                  autoComplete="off"
                />
                <span className="onb-hint">Requerido para registrar una empresa. Solicítalo al administrador de la plataforma.</span>
              </div>
            </div>

            {/* ── Logo de la empresa ── */}
            <div className="onb-brand-section">
              <div className="onb-field">
                <label className="onb-label">LOGO DE LA EMPRESA</label>
                <div className="onb-logo-upload-area">
                  <div className="onb-logo-preview">
                    {empresa.logo ? (
                      <img src={empresa.logo} alt="Logo empresa" className="onb-logo-preview-img" />
                    ) : (
                      <div className="onb-logo-preview-default" aria-label="Logo por defecto">
                        <span className="onb-logo-b">Build</span>
                        <span className="onb-logo-amp">&amp;</span>
                        <span className="onb-logo-s">Serve</span>
                      </div>
                    )}
                  </div>
                  <div className="onb-logo-upload-actions">
                    <input
                      ref={logoInputRef}
                      type="file"
                      accept="image/*"
                      style={{ display: 'none' }}
                      onChange={e => {
                        const file = e.target.files?.[0];
                        if (file) handleLogoFile(file);
                        e.target.value = '';
                      }}
                    />
                    <button
                      type="button"
                      className="onb-logo-upload-btn"
                      onClick={() => logoInputRef.current?.click()}
                    >
                      <FiUpload size={13} />
                      {empresa.logo ? 'Cambiar logo' : 'Subir logo'}
                    </button>
                    {empresa.logo && (
                      <button
                        type="button"
                        className="onb-logo-remove-btn"
                        onClick={() => setEmpresa(prev => ({ ...prev, logo: null }))}
                        title="Eliminar logo"
                      >
                        <FiX size={13} /> Eliminar
                      </button>
                    )}
                    <span className="onb-logo-hint">PNG, JPG, SVG o WebP · Máx. 2 MB</span>
                  </div>
                </div>
              </div>

              {/* ── Color principal ── */}
              <div className="onb-field">
                <label className="onb-label">COLOR PRINCIPAL</label>
                <div className="onb-color-picker-row">
                  <div
                    className="onb-color-swatch"
                    style={{ background: empresa.colorPrincipal }}
                    onClick={() => document.getElementById('onb-color-input')?.click()}
                    role="button"
                    tabIndex={0}
                    title="Abrir selector de color"
                    onKeyDown={e => e.key === 'Enter' && document.getElementById('onb-color-input')?.click()}
                  />
                  <input
                    id="onb-color-input"
                    type="color"
                    className="onb-color-native"
                    value={empresa.colorPrincipal}
                    onChange={e => setEmpresa(prev => ({ ...prev, colorPrincipal: e.target.value }))}
                  />
                  <input
                    type="text"
                    className="onb-color-hex-input onb-input"
                    value={empresa.colorPrincipal}
                    maxLength={7}
                    onChange={e => {
                      const val = e.target.value;
                      setEmpresa(prev => ({ ...prev, colorPrincipal: val }));
                    }}
                    onBlur={e => {
                      const val = e.target.value;
                      if (!/^#[0-9a-f]{6}$/i.test(val)) {
                        setEmpresa(prev => ({ ...prev, colorPrincipal: '#006edc' }));
                      }
                    }}
                    spellCheck={false}
                  />
                  <div className="onb-color-rgb">
                    {(() => {
                      const { r, g, b } = hexToRgb(empresa.colorPrincipal);
                      return <span>R {r} · G {g} · B {b}</span>;
                    })()}
                  </div>
                </div>

                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
                  {SUGGESTED_COLORS.map((s) => {
                    const active = empresa.colorPrincipal.toLowerCase() === s.hex.toLowerCase();
                    return (
                      <button key={s.hex} type="button" title={`${s.label} · ${s.hex}`}
                        onClick={() => setEmpresa(prev => ({ ...prev, colorPrincipal: s.hex }))}
                        style={{
                          width: 26, height: 26, borderRadius: 7, background: s.hex, cursor: 'pointer',
                          border: active ? '2px solid #fff' : '2px solid rgba(255,255,255,0.25)',
                          boxShadow: active ? '0 0 0 2px rgba(255,255,255,0.5)' : 'none',
                          outline: 'none', padding: 0,
                        }} />
                    );
                  })}
                </div>

                {(() => {
                  const ratio = contrastVsWhite(empresa.colorPrincipal);
                  const ok = ratio >= 4.5;
                  return (
                    <p className="onb-color-hint" style={{ marginTop: 8, color: ok ? '#86efac' : '#fcd34d' }}>
                      {ok ? '✓ Buen contraste con texto blanco' : '⚠ Contraste bajo con texto blanco'} · {ratio.toFixed(1)}:1
                    </p>
                  );
                })()}

                <p className="onb-color-hint">
                  Reemplazará el azul principal en toda la plataforma. Haz clic en el cuadro de color para abrir la paleta RGB.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Step: Roles */}
        {currentStep === 'roles' && (
          <div className="onb-anim">
            <h2 className="onb-title">Roles de la Empresa</h2>

            {rolesInfoVisible && (
              <div className="onb-info-banner">
                <FiInfo size={15} className="onb-info-icon" />
                <p className="onb-info-text">
                  Los roles marcados con <FiLock size={11} style={{ verticalAlign: -1 }} /> son los mínimos de toda
                  empresa: puedes renombrarlos y ajustar sus permisos, pero no eliminarlos ni
                  cambiar su descripción (en esencia siguen siendo el mismo rol). Puedes añadir
                  los roles adicionales que necesites.
                </p>
                <button
                  className="onb-info-close"
                  onClick={() => setRolesInfoVisible(false)}
                  type="button"
                  title="Cerrar"
                >
                  <FiX size={13} />
                </button>
              </div>
            )}

            <div className="onb-roles-list">
              {roles.map((r, i) => (
                <div key={r._id} className="onb-role-card">
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                    <span className="onb-role-index">{r.protegido ? <FiLock size={12} /> : String(i + 1).padStart(2, '0')}</span>
                    <div className="onb-role-fields">
                      <div className="onb-role-field-group">
                        <label className="onb-role-label">NOMBRE DEL ROL</label>
                        <input
                          className="onb-input onb-role-name"
                          placeholder="Ej. Capataz"
                          value={r.nombre}
                          onChange={e => updateRole(r._id, 'nombre', e.target.value)}
                        />
                      </div>
                      <div className="onb-role-field-group">
                        <label className="onb-role-label">DESCRIPCIÓN{r.protegido && ' (fija)'}</label>
                        <input
                          className="onb-input onb-role-desc"
                          placeholder="Responsabilidades del rol (opcional)"
                          value={r.descripcion}
                          onChange={e => updateRole(r._id, 'descripcion', e.target.value)}
                          disabled={r.protegido}
                          title={r.protegido ? 'La descripción de un rol mínimo no se puede editar.' : undefined}
                        />
                      </div>
                    </div>
                    {!r.protegido && (
                      <button
                        className="onb-role-remove"
                        onClick={() => removeRole(r._id)}
                        type="button"
                        title="Eliminar rol"
                      >
                        <FiX size={13} />
                      </button>
                    )}
                  </div>

                  {/* Selector de permisos por grupos */}
                  <div className="onb-perms">
                    <div className="onb-perms-head">
                      PERMISOS{r.locked && <span className="onb-perms-lock"><FiLock size={10} /> Acceso total (no editable)</span>}
                    </div>
                    <div className="onb-perms-groups">
                      {PERMISSION_GROUPS.map(group => (
                        <div key={group.grupo} className="onb-perms-group">
                          <div className="onb-perms-group-title">{group.grupo}</div>
                          {group.permisos.map(perm => {
                            const checked = r.locked || r.permisos.includes(perm.key);
                            return (
                              <label key={perm.key} className={`onb-perm-item${r.locked ? ' onb-perm-item--locked' : ''}`}>
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  disabled={r.locked}
                                  onChange={() => togglePermiso(r._id, perm.key)}
                                />
                                <span>{perm.label}</span>
                              </label>
                            );
                          })}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {roles.length === 0 && (
              <p className="onb-roles-empty">No hay roles. Añade al menos uno para continuar.</p>
            )}

            <button className="onb-add-role-btn" onClick={addRole} type="button">
              <FiPlus size={14} /><span>Añadir rol</span>
            </button>
          </div>
        )}

        {/* Step: Admin */}
        {currentStep === 'admin' && (
          <div className="onb-anim">
            <h2 className="onb-title">Administrador Principal</h2>
            <p className="onb-subtitle">Esta persona tendrá acceso completo a la gestión de la empresa.</p>
            <div className="onb-grid">
              <div className="onb-field onb-full">
                <label className="onb-label">RUT *</label>
                <input
                  className={`onb-input${(fieldErrors.has('rut') || fieldErrors.has('rutFormato')) ? ' onb-input--err' : ''}`}
                  placeholder="12.345.678-9"
                  value={admin.rut}
                  onChange={e => { setAdmin({ ...admin, rut: rutFormat(e.target.value) }); clearField('rut'); clearField('rutFormato'); }}
                />
              </div>
              <div className="onb-field">
                <label className="onb-label">NOMBRE *</label>
                <input
                  className={`onb-input${fieldErrors.has('adminNombre') ? ' onb-input--err' : ''}`}
                  placeholder="Juan"
                  value={admin.nombre}
                  onChange={e => { setAdmin({ ...admin, nombre: e.target.value }); clearField('adminNombre'); }}
                />
              </div>
              <div className="onb-field">
                <label className="onb-label">APELLIDO PATERNO *</label>
                <input
                  className={`onb-input${fieldErrors.has('adminApellidoPaterno') ? ' onb-input--err' : ''}`}
                  placeholder="Pérez"
                  value={admin.apellidoPaterno}
                  onChange={e => { setAdmin({ ...admin, apellidoPaterno: e.target.value }); clearField('adminApellidoPaterno'); }}
                />
              </div>
              <div className="onb-field">
                <label className="onb-label">APELLIDO MATERNO</label>
                <input
                  className="onb-input"
                  placeholder="González"
                  value={admin.apellidoMaterno}
                  onChange={e => setAdmin({ ...admin, apellidoMaterno: e.target.value })}
                />
              </div>
              <div className="onb-field">
                <label className="onb-label">FECHA DE NACIMIENTO</label>
                <input
                  className="onb-input"
                  type="date"
                  value={admin.fechaNacimiento}
                  onChange={e => setAdmin({ ...admin, fechaNacimiento: e.target.value })}
                />
              </div>
              <div className="onb-field onb-full">
                <label className="onb-label">EMAIL *</label>
                <input
                  className={`onb-input${(fieldErrors.has('email') || fieldErrors.has('emailFormato')) ? ' onb-input--err' : ''}`}
                  type="email"
                  placeholder="admin@empresa.cl"
                  value={admin.email}
                  onChange={e => { setAdmin({ ...admin, email: e.target.value }); clearField('email'); clearField('emailFormato'); }}
                />
              </div>
            </div>
          </div>
        )}

        {/* Step: Trabajadores */}
        {currentStep === 'trabajadores' && (
          <div className="onb-anim">
            <h2 className="onb-title">Añadir Trabajadores</h2>
            <p className="onb-subtitle">Opcional — puedes agregar trabajadores ahora o más tarde desde el panel.</p>

            {/* Tab control */}
            <div className="onb-tabs">
              <button
                className={`onb-tab${workerTab === 'manual' ? ' onb-tab--active' : ''}`}
                onClick={() => setWorkerTab('manual')} type="button"
              >
                <FiUserPlus size={13} /> Agregar manualmente
              </button>
              <button
                className={`onb-tab${workerTab === 'bulk' ? ' onb-tab--active' : ''}`}
                onClick={() => setWorkerTab('bulk')} type="button"
              >
                <FiUpload size={13} /> Carga masiva
              </button>
            </div>

            {/* Manual tab */}
            {workerTab === 'manual' && (
              <div className="onb-worker-form">
                <div className="onb-grid">
                  <div className="onb-field">
                    <label className="onb-label">NOMBRE *</label>
                    <input
                      className={`onb-input${wErrors.has('wNombre') ? ' onb-input--err' : ''}`}
                      placeholder="Juan"
                      value={wForm.nombre}
                      onChange={e => { setWForm({ ...wForm, nombre: e.target.value }); setWErrors(p => { const n = new Set(p); n.delete('wNombre'); return n; }); }}
                    />
                  </div>
                  <div className="onb-field">
                    <label className="onb-label">APELLIDO PATERNO *</label>
                    <input
                      className={`onb-input${wErrors.has('wApellidoPaterno') ? ' onb-input--err' : ''}`}
                      placeholder="Pérez"
                      value={wForm.apellidoPaterno}
                      onChange={e => { setWForm({ ...wForm, apellidoPaterno: e.target.value }); setWErrors(p => { const n = new Set(p); n.delete('wApellidoPaterno'); return n; }); }}
                    />
                  </div>
                  <div className="onb-field">
                    <label className="onb-label">APELLIDO MATERNO</label>
                    <input
                      className="onb-input"
                      placeholder="González"
                      value={wForm.apellidoMaterno}
                      onChange={e => setWForm({ ...wForm, apellidoMaterno: e.target.value })}
                    />
                  </div>
                  <div className="onb-field">
                    <label className="onb-label">FECHA DE NACIMIENTO</label>
                    <input
                      className="onb-input"
                      type="date"
                      value={wForm.fechaNacimiento}
                      onChange={e => setWForm({ ...wForm, fechaNacimiento: e.target.value })}
                    />
                  </div>
                  <div className="onb-field">
                    <label className="onb-label">RUT *</label>
                    <input
                      className={`onb-input${(wErrors.has('wRut') || wErrors.has('wRutFormato') || wErrors.has('wRutDup') || wErrors.has('wRutDupAdmin')) ? ' onb-input--err' : ''}`}
                      placeholder="12.345.678-9"
                      value={wForm.rut}
                      onChange={e => { setWForm({ ...wForm, rut: rutFormat(e.target.value) }); setWErrors(p => { const n = new Set(p); n.delete('wRut'); n.delete('wRutFormato'); n.delete('wRutDup'); n.delete('wRutDupAdmin'); return n; }); }}
                    />
                    {wErrors.has('wRutFormato') && <span style={{ fontSize: 11, color: '#ef4444' }}>RUT no válido</span>}
                    {wErrors.has('wRutDupAdmin') && <span style={{ fontSize: 11, color: '#ef4444' }}>Este RUT pertenece al administrador</span>}
                    {wErrors.has('wRutDup') && <span style={{ fontSize: 11, color: '#ef4444' }}>Este RUT ya fue agregado</span>}
                  </div>
                  <div className="onb-field">
                    <label className="onb-label">EMAIL</label>
                    <input
                      className="onb-input" type="email"
                      placeholder="trabajador@empresa.cl"
                      value={wForm.email}
                      onChange={e => setWForm({ ...wForm, email: e.target.value })}
                    />
                  </div>
                  <div className="onb-field">
                    <label className="onb-label">ROL</label>
                    <select
                      className="onb-input onb-select"
                      value={wForm.rol}
                      onChange={e => setWForm({ ...wForm, rol: e.target.value })}
                    >
                      {roles.filter(r => !r.locked).map(r => {
                        const id = r.nombre.trim();
                        return <option key={id} value={id}>{r.nombre}</option>;
                      })}
                    </select>
                  </div>
                  <div className="onb-field">
                    <label className="onb-label">CARGO</label>
                    <select
                      className="onb-input onb-select"
                      value={wForm.cargo}
                      onChange={e => setWForm({ ...wForm, cargo: e.target.value })}
                    >
                      <option value="">Sin cargo (opcional)</option>
                      {CARGOS.map(c => <option key={c.codigo} value={c.codigo}>{c.label}</option>)}
                    </select>
                  </div>
                </div>
                <div className="onb-wform-footer">
                  <button className="onb-add-btn" onClick={addWorker} type="button">
                    <FiUserPlus size={13} /><span>Añadir trabajador a la empresa</span>
                  </button>
                </div>
              </div>
            )}

            {/* Bulk tab */}
            {workerTab === 'bulk' && (
              <div className="onb-bulk-panel">
                <button
                  className="onb-template-btn"
                  type="button"
                  onClick={() => personasApi.downloadTemplate()}
                >
                  <FiDownload size={13} /> Descargar plantilla Excel
                </button>

                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx"
                  style={{ display: 'none' }}
                  onChange={e => {
                    const file = e.target.files?.[0];
                    if (file) handleBulkUpload(file);
                    if (fileInputRef.current) fileInputRef.current.value = '';
                  }}
                />

                <div
                  className={`onb-dropzone${bulkLoading ? ' onb-dropzone--loading' : ''}`}
                  onClick={() => !bulkLoading && fileInputRef.current?.click()}
                  onDragOver={e => { e.preventDefault(); e.currentTarget.classList.add('onb-dropzone--drag'); }}
                  onDragLeave={e => e.currentTarget.classList.remove('onb-dropzone--drag')}
                  onDrop={e => {
                    e.preventDefault();
                    e.currentTarget.classList.remove('onb-dropzone--drag');
                    const file = e.dataTransfer.files?.[0];
                    if (file) handleBulkUpload(file);
                  }}
                >
                  {bulkLoading ? (
                    <div className="onb-spinner" style={{ borderTopColor: '#006edc', borderColor: 'rgba(0,110,220,0.2)', width: 24, height: 24 }} />
                  ) : (
                    <>
                      <FiUpload size={28} style={{ color: '#006edc', marginBottom: 10 }} />
                      <span className="onb-dropzone-title">Arrastra el archivo aquí o haz clic para seleccionar</span>
                      <span className="onb-dropzone-hint">Solo archivos .xlsx</span>
                    </>
                  )}
                </div>

                {bulkSuccess > 0 && (
                  <div className="onb-bulk-success">
                    <FiCheck size={14} /> {bulkSuccess} trabajador{bulkSuccess !== 1 ? 'es' : ''} importado{bulkSuccess !== 1 ? 's' : ''} correctamente
                  </div>
                )}

                {bulkErrors.length > 0 && (
                  <div className="onb-bulk-errors">
                    <div className="onb-bulk-errors-title"><FiAlertCircle size={13} /> {bulkErrors.length} fila{bulkErrors.length !== 1 ? 's' : ''} con error</div>
                    {bulkErrors.slice(0, 5).map((e, i) => (
                      <div key={i} className="onb-bulk-error-row">
                        {e.fila > 0 && <span className="onb-bulk-fila">Fila {e.fila}:</span>} {e.error}
                      </div>
                    ))}
                    {bulkErrors.length > 5 && <div className="onb-bulk-error-row" style={{ color: '#94a3b8' }}>...y {bulkErrors.length - 5} más</div>}
                  </div>
                )}
              </div>
            )}

            {workers.length > 0 && (
              <div className="onb-workers-section">
                <div className="onb-workers-count">
                  {workers.length} trabajador{workers.length !== 1 ? 'es' : ''} agregado{workers.length !== 1 ? 's' : ''}
                </div>
                <div className="onb-workers-grid">
                  {workers.map(w => (
                    <div key={w._id} className="onb-worker-card">
                      <div className="onb-worker-avatar">
                        {w.nombre[0]?.toUpperCase()}{w.apellidoPaterno?.[0]?.toUpperCase() ?? w.nombre[1]?.toUpperCase() ?? ''}
                      </div>
                      <div className="onb-worker-info">
                        <span className="onb-worker-name">{w.nombre} {w.apellidoPaterno} {w.apellidoMaterno}</span>
                        <span className="onb-worker-rut">{w.rut}</span>
                        <span className="onb-worker-role">{roles.find(r => r.nombre.trim() === w.rol)?.nombre || w.rol}</span>
                      </div>
                      <button className="onb-worker-remove" onClick={() => removeWorker(w._id)} type="button" title="Eliminar">
                        <FiX size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Step: Confirmacion */}
        {currentStep === 'confirmacion' && (
          <div className="onb-anim">
            <h2 className="onb-title">Confirmar Registro</h2>
            <p className="onb-subtitle">Revisa los datos antes de crear la empresa.</p>

            <div className="onb-confirm-grid">
              {/* Empresa */}
              <div className="onb-confirm-card">
                <div className="onb-confirm-card-header">
                  <span className="onb-confirm-card-tag">Empresa</span>
                </div>
                <div className="onb-confirm-kv">
                  <span className="onb-confirm-k">Razón Social</span>
                  <span className="onb-confirm-v">{empresa.nombre}</span>
                </div>
                <div className="onb-confirm-kv">
                  <span className="onb-confirm-k">RUT</span>
                  <span className="onb-confirm-v onb-confirm-mono">{empresa.rutEmpresa}</span>
                </div>
                <div className="onb-confirm-kv">
                  <span className="onb-confirm-k">Personas iniciales</span>
                  <span className="onb-confirm-v">{1 + workers.length} (1 admin{workers.length > 0 ? ` + ${workers.length} trabajador${workers.length !== 1 ? 'es' : ''}` : ''})</span>
                </div>
              </div>

              {/* Administrador */}
              <div className="onb-confirm-card">
                <div className="onb-confirm-card-header">
                  <span className="onb-confirm-card-tag">Administrador</span>
                </div>
                <div className="onb-confirm-kv">
                  <span className="onb-confirm-k">Nombre</span>
                  <span className="onb-confirm-v">{[admin.nombre, admin.apellidoPaterno, admin.apellidoMaterno].filter(Boolean).join(' ')}</span>
                </div>
                <div className="onb-confirm-kv">
                  <span className="onb-confirm-k">RUT</span>
                  <span className="onb-confirm-v onb-confirm-mono">{admin.rut}</span>
                </div>
                <div className="onb-confirm-kv">
                  <span className="onb-confirm-k">Email</span>
                  <span className="onb-confirm-v onb-confirm-mono">{admin.email}</span>
                </div>
              </div>
            </div>

            {/* Roles */}
            {roles.length > 0 && (
              <div className="onb-confirm-card onb-confirm-card--full">
                <div className="onb-confirm-card-header">
                  <span className="onb-confirm-card-tag">Roles</span>
                  <span className="onb-confirm-card-count">{roles.length}</span>
                </div>
                <div className="onb-confirm-pills">
                  {roles.map(r => (
                    <span key={r._id} className="onb-confirm-pill">{r.nombre}</span>
                  ))}
                </div>
              </div>
            )}

            {/* Trabajadores */}
            {workers.length > 0 && (
              <div className="onb-confirm-card onb-confirm-card--full">
                <div className="onb-confirm-card-header">
                  <span className="onb-confirm-card-tag">Trabajadores</span>
                  <span className="onb-confirm-card-count">{workers.length}</span>
                </div>
                <div className="onb-confirm-workers">
                  {workers.map(w => (
                    <div key={w._id} className="onb-confirm-worker-row">
                      <div className="onb-confirm-worker-avatar">
                        {w.nombre[0]?.toUpperCase()}{w.apellidoPaterno?.[0]?.toUpperCase() ?? ''}
                      </div>
                      <div className="onb-confirm-worker-info">
                        <span className="onb-confirm-worker-name">{w.nombre} {w.apellidoPaterno} {w.apellidoMaterno}</span>
                        <span className="onb-confirm-worker-rut">{w.rut}</span>
                      </div>
                      <span className="onb-confirm-worker-rol">
                        {roles.find(r => r.nombre.trim() === w.rol)?.nombre || w.rol}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {error && <p className="onb-error" role="alert">{error}</p>}

        {/* Navigation */}
        <div className="onb-nav">
          {idx > 0 && (
            <button className="onb-back-btn" onClick={prev} type="button">
              <FiArrowLeft size={14} /> Atrás
            </button>
          )}
          <div style={{ flex: 1 }} />
          {currentStep !== 'confirmacion' ? (
            <button className="onb-submit" onClick={next} disabled={loading} type="button">
              {loading ? <div className="onb-spinner" /> : <><span>Siguiente</span> <FiArrowRight size={15} /></>}
            </button>
          ) : (
            <button className="onb-submit" onClick={handleSubmit} disabled={loading} type="button">
              {loading
                ? <div className="onb-spinner" />
                : <><span>Crear Empresa</span> <FiCheckCircle size={15} /></>
              }
            </button>
          )}
        </div>

        <a href="/login" className="onb-login-link">← Ya tengo cuenta, ir al Login</a>
      </div>

      <style>{onbStyles}</style>
    </div>
  );
}

const onbStyles = `
  .onb-root {
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px 16px;
    position: relative;
    overflow: hidden;
  }

  .onb-bg {
    position: absolute;
    inset: 0;
    background: url('/fondoLogin.png') center center / cover no-repeat;
    z-index: 0;
  }

  .onb-card {
    position: relative;
    z-index: 1;
    width: 100%;
    max-width: 640px;
    background: #ffffff;
    border-radius: 16px;
    padding: 44px 48px 40px;
    box-shadow:
      0 2px 4px rgba(0,0,0,0.08),
      0 8px 24px rgba(0,0,0,0.18),
      0 32px 64px rgba(0,0,0,0.28);
    animation: onbRise 0.45s cubic-bezier(0.22, 1, 0.36, 1) both;
    box-sizing: border-box;
  }

  @keyframes onbRise {
    from { opacity: 0; transform: translateY(20px) scale(0.98); }
    to   { opacity: 1; transform: translateY(0) scale(1); }
  }

  /* ── Logo ── */
  .onb-logo {
    display: flex;
    align-items: baseline;
    justify-content: center;
    gap: 6px;
    font-family: 'Lora', Georgia, serif;
    font-size: 2rem;
    font-weight: 600;
    line-height: 1;
    letter-spacing: -0.01em;
    margin-bottom: 18px;
  }
  .onb-logo-b   { color: #003b75; }
  .onb-logo-amp { color: #df3601; font-weight: 500; }
  .onb-logo-s   { color: #006edc; }

  .onb-divider {
    height: 1px;
    background: #e8edf3;
    margin-bottom: 20px;
  }

  /* ── Stepper ── */
  .onb-stepper {
    display: flex;
    align-items: center;
    justify-content: center;
    margin-bottom: 20px;
    gap: 0;
    overflow: hidden;
  }

  .onb-step-group {
    display: flex;
    align-items: center;
    gap: 0;
    flex-shrink: 0;
  }

  .onb-step-dot {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    border: 2px solid #e2e8f0;
    background: #f8fafc;
    color: #94a3b8;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 10px;
    font-weight: 700;
    flex-shrink: 0;
    transition: all 0.2s ease;
  }
  .onb-step-dot.active { border-color: #002855; background: #002855; color: #fff; }
  .onb-step-dot.done   { border-color: #006edc; background: #006edc; color: #fff; }

  .onb-step-lbl {
    font-size: 10px;
    font-weight: 600;
    color: #94a3b8;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin-left: 5px;
    white-space: nowrap;
    display: none;
  }
  /* Solo muestra la etiqueta del paso activo para que no se desborden los 5 pasos */
  .onb-step-lbl.active { display: inline; color: #002855; }

  .onb-step-line {
    width: 18px;
    height: 2px;
    background: #e2e8f0;
    margin: 0 4px;
    flex-shrink: 0;
    transition: background 0.2s;
  }
  .onb-step-line.done { background: #006edc; }

  /* ── Content ── */
  .onb-anim {
    animation: onbSlide 0.25s ease-out both;
  }
  @keyframes onbSlide {
    from { opacity: 0; transform: translateX(10px); }
    to   { opacity: 1; transform: translateX(0); }
  }

  .onb-title {
    font-size: 18px;
    font-weight: 700;
    color: #0f172a;
    margin: 0 0 4px;
    letter-spacing: -0.02em;
  }

  .onb-subtitle {
    font-size: 12px;
    color: #64748b;
    margin: 0 0 18px;
    line-height: 1.5;
  }

  /* ── Grid / Fields ── */
  .onb-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 13px;
  }

  .onb-full { grid-column: span 2; }

  .onb-field {
    display: flex;
    flex-direction: column;
    gap: 5px;
  }

  .onb-label {
    font-size: 10px;
    font-weight: 700;
    color: #64748b;
    letter-spacing: 0.07em;
    text-transform: uppercase;
  }

  .onb-input {
    width: 100%;
    height: 38px;
    padding: 0 12px;
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    color: #0f172a;
    font-size: 13px;
    font-family: inherit;
    transition: border-color 0.15s, box-shadow 0.15s, background 0.15s;
    outline: none;
    box-sizing: border-box;
  }
  .onb-input:focus {
    border-color: #006edc;
    background: #fff;
    box-shadow: 0 0 0 3px rgba(0,110,220,0.12);
  }
  .onb-input::placeholder { color: #b0bec5; }
  .onb-input--err { border-color: #ef4444 !important; box-shadow: 0 0 0 3px rgba(239,68,68,0.10) !important; }

  .onb-select {
    appearance: none;
    -webkit-appearance: none;
    cursor: pointer;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%2394a3b8' stroke-width='2'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E");
    background-repeat: no-repeat;
    background-position: right 10px center;
    padding-right: 30px;
  }
  .onb-select option { background: #fff; color: #0f172a; }

  /* ── Tabs ── */
  .onb-tabs {
    display: flex;
    gap: 0;
    margin-bottom: 14px;
    border: 1px solid #e2e8f0;
    border-radius: 10px;
    overflow: hidden;
    background: #f8fafc;
  }

  .onb-tab {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    height: 38px;
    background: none;
    border: none;
    font-size: 12.5px;
    font-weight: 600;
    font-family: inherit;
    color: #64748b;
    cursor: pointer;
    transition: background 0.15s, color 0.15s;
  }
  .onb-tab:not(:last-child) { border-right: 1px solid #e2e8f0; }
  .onb-tab:hover:not(.onb-tab--active) { background: #f1f5f9; color: #334155; }
  .onb-tab--active { background: #002855; color: #fff; }

  /* ── Bulk panel ── */
  .onb-bulk-panel {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .onb-template-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    height: 36px;
    padding: 0 16px;
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    color: #006edc;
    font-size: 12.5px;
    font-weight: 600;
    font-family: inherit;
    cursor: pointer;
    align-self: flex-start;
    transition: background 0.15s, border-color 0.15s;
  }
  .onb-template-btn:hover { background: #f0f7ff; border-color: #bfdbfe; }

  .onb-dropzone {
    border: 2px dashed #cbd5e1;
    border-radius: 12px;
    padding: 32px 20px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: border-color 0.15s, background 0.15s;
    background: #f8fafc;
    gap: 4px;
    min-height: 120px;
  }
  .onb-dropzone:hover, .onb-dropzone--drag {
    border-color: #006edc;
    background: #f0f7ff;
  }
  .onb-dropzone--loading { cursor: default; }

  .onb-dropzone-title {
    font-size: 13px;
    font-weight: 600;
    color: #334155;
  }

  .onb-dropzone-hint {
    font-size: 11.5px;
    color: #94a3b8;
  }

  .onb-bulk-success {
    display: flex;
    align-items: center;
    gap: 7px;
    font-size: 12.5px;
    font-weight: 600;
    color: #16a34a;
    padding: 8px 12px;
    background: rgba(22,163,74,0.07);
    border-radius: 8px;
    border: 1px solid rgba(22,163,74,0.2);
  }

  .onb-bulk-errors {
    padding: 10px 12px;
    background: rgba(239,68,68,0.04);
    border: 1px solid rgba(239,68,68,0.18);
    border-radius: 8px;
    font-size: 12px;
  }

  .onb-bulk-errors-title {
    display: flex;
    align-items: center;
    gap: 5px;
    font-weight: 700;
    color: #ef4444;
    margin-bottom: 6px;
  }

  .onb-bulk-error-row {
    color: #475569;
    padding: 2px 0;
    border-bottom: 1px solid rgba(239,68,68,0.08);
    line-height: 1.5;
  }
  .onb-bulk-error-row:last-child { border-bottom: none; }

  .onb-bulk-fila {
    font-weight: 600;
    color: #94a3b8;
    margin-right: 4px;
  }

  /* ── Worker form ── */
  .onb-worker-form {
    background: #f8fafc;
    border: 1px solid #e8edf3;
    border-radius: 12px;
    padding: 16px;
    margin-bottom: 0;
  }

  .onb-wform-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-top: 12px;
    padding-top: 12px;
    border-top: 1px solid #e8edf3;
    gap: 12px;
  }

  .onb-check-label {
    display: flex;
    align-items: center;
    gap: 7px;
    font-size: 12px;
    color: #475569;
    cursor: pointer;
    flex: 1;
  }
  .onb-check-label input {
    accent-color: #006edc;
    width: 14px;
    height: 14px;
    flex-shrink: 0;
    cursor: pointer;
  }

  .onb-add-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    height: 34px;
    padding: 0 16px;
    background: #002855;
    color: #fff;
    border: none;
    border-radius: 8px;
    font-size: 12.5px;
    font-weight: 600;
    font-family: inherit;
    cursor: pointer;
    white-space: nowrap;
    flex-shrink: 0;
    transition: background 0.15s, transform 0.12s;
  }
  .onb-add-btn:hover { background: #006edc; transform: translateY(-1px); }

  /* ── Workers grid (similar to pdir-grid) ── */
  .onb-workers-section { margin-top: 18px; }

  .onb-workers-count {
    font-size: 10px;
    font-weight: 700;
    color: #64748b;
    text-transform: uppercase;
    letter-spacing: 0.07em;
    margin-bottom: 10px;
  }

  .onb-workers-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 10px;
  }

  .onb-worker-card {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    padding: 16px 12px 12px;
    background: #fff;
    border: 1px solid #e8edf3;
    border-radius: 10px;
    position: relative;
    transition: transform 0.15s, box-shadow 0.15s, border-color 0.15s;
    animation: onbRise 0.25s ease both;
  }
  .onb-worker-card:hover {
    transform: translateY(-2px);
    box-shadow: 0 6px 18px -4px rgba(0,0,0,0.12);
    border-color: #cbd5e1;
  }

  .onb-worker-avatar {
    width: 48px;
    height: 48px;
    border-radius: 50%;
    background: #002855;
    color: #fff;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 16px;
    font-weight: 700;
    letter-spacing: 0.02em;
    margin-bottom: 10px;
    flex-shrink: 0;
    transition: box-shadow 0.15s;
  }
  .onb-worker-card:hover .onb-worker-avatar {
    box-shadow: 0 0 0 3px #f0f7ff, 0 0 0 5px #006edc;
  }

  .onb-worker-info {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    width: 100%;
  }

  .onb-worker-name {
    font-size: 12px;
    font-weight: 600;
    color: #0f172a;
    line-height: 1.35;
    word-break: break-word;
  }

  .onb-worker-rut {
    font-family: 'Courier New', monospace;
    font-size: 10px;
    color: #94a3b8;
    letter-spacing: 0.04em;
  }

  .onb-worker-role {
    font-size: 10px;
    color: #475569;
    margin-top: 6px;
    padding-top: 6px;
    border-top: 1px solid #f1f5f9;
    width: 100%;
    text-align: center;
  }

  .onb-worker-remove {
    position: absolute;
    top: 6px;
    right: 6px;
    width: 20px;
    height: 20px;
    background: none;
    border: none;
    color: #cbd5e1;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 4px;
    transition: color 0.15s, background 0.15s;
    padding: 0;
  }
  .onb-worker-remove:hover { color: #ef4444; background: rgba(239,68,68,0.08); }

  /* ── Info banner ── */
  .onb-info-banner {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    background: #eff6ff;
    border: 1px solid #bfdbfe;
    border-left: 3px solid #006edc;
    border-radius: 8px;
    padding: 10px 12px;
    margin-bottom: 16px;
  }

  .onb-info-icon {
    color: #006edc;
    flex-shrink: 0;
    margin-top: 1px;
  }

  .onb-info-text {
    flex: 1;
    font-size: 12px;
    color: #1e40af;
    line-height: 1.55;
    margin: 0;
  }

  .onb-info-close {
    width: 22px;
    height: 22px;
    background: none;
    border: none;
    color: #93c5fd;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 4px;
    flex-shrink: 0;
    padding: 0;
    transition: color 0.15s, background 0.15s;
  }
  .onb-info-close:hover { color: #1e40af; background: rgba(37,99,235,0.08); }

  /* ── Roles ── */
  .onb-roles-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-bottom: 12px;
    max-height: 280px;
    overflow-y: auto;
    padding-right: 4px;
  }
  .onb-roles-list::-webkit-scrollbar { width: 4px; }
  .onb-roles-list::-webkit-scrollbar-track { background: transparent; }
  .onb-roles-list::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 99px; }
  .onb-roles-list::-webkit-scrollbar-thumb:hover { background: #94a3b8; }

  .onb-role-card {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 14px;
    background: #fff;
    border: 1px solid #e2e8f0;
    border-left: 3px solid #002855;
    border-radius: 10px;
    padding: 12px 14px 12px 16px;
    animation: onbRise 0.22s ease both;
    transition: border-color 0.15s, box-shadow 0.15s;
  }
  .onb-perms {
    border-top: 1px dashed #e2e8f0;
    padding-top: 10px;
  }
  .onb-perms-head {
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.04em;
    color: #64748b;
    margin-bottom: 8px;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .onb-perms-lock {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    color: #002855;
    font-weight: 600;
    letter-spacing: 0;
    text-transform: none;
  }
  .onb-perms-groups {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 10px 18px;
  }
  .onb-perms-group-title {
    font-size: 11px;
    font-weight: 700;
    color: #0f172a;
    margin-bottom: 4px;
  }
  .onb-perm-item {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    color: #334155;
    padding: 2px 0;
    cursor: pointer;
  }
  .onb-perm-item--locked {
    opacity: 0.6;
    cursor: default;
  }
  .onb-perm-item input {
    cursor: inherit;
  }
  .onb-role-card:hover {
    border-color: #c7d5e8;
    border-left-color: #006edc;
    box-shadow: 0 3px 12px -4px rgba(0,40,85,0.12);
  }

  .onb-role-index {
    font-size: 11px;
    font-weight: 800;
    color: #94a3b8;
    letter-spacing: 0.05em;
    flex-shrink: 0;
    width: 20px;
    text-align: center;
    font-variant-numeric: tabular-nums;
  }

  .onb-role-fields {
    display: grid;
    grid-template-columns: 1fr 1.6fr;
    gap: 10px;
    flex: 1;
    min-width: 0;
  }

  .onb-role-field-group {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
  }

  .onb-role-label {
    font-size: 9.5px;
    font-weight: 700;
    color: #94a3b8;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .onb-role-name { font-weight: 600; font-size: 13px; }
  .onb-role-desc { font-size: 12.5px; }

  .onb-role-remove {
    width: 26px;
    height: 26px;
    background: none;
    border: none;
    color: #cbd5e1;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 6px;
    flex-shrink: 0;
    transition: color 0.15s, background 0.15s;
  }
  .onb-role-remove:hover { color: #ef4444; background: rgba(239,68,68,0.08); }

  .onb-roles-empty {
    font-size: 12.5px;
    color: #94a3b8;
    text-align: center;
    padding: 14px;
    margin: 0 0 12px;
    background: #f8fafc;
    border: 1px dashed #cbd5e1;
    border-radius: 10px;
  }

  .onb-add-role-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 7px;
    width: 100%;
    height: 38px;
    background: #fff;
    border: 1.5px dashed #bfdbfe;
    border-radius: 10px;
    color: #006edc;
    font-size: 13px;
    font-weight: 600;
    font-family: inherit;
    cursor: pointer;
    transition: background 0.15s, border-color 0.15s;
  }
  .onb-add-role-btn:hover { background: #f0f7ff; border-color: #006edc; }

  @media (max-width: 480px) {
    .onb-role-fields { grid-template-columns: 1fr; gap: 6px; }
  }

  /* ── Confirmation ── */
  .onb-confirm-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
    margin-bottom: 10px;
  }

  .onb-confirm-card {
    background: #fff;
    border: 1px solid #e2e8f0;
    border-radius: 10px;
    padding: 13px 15px;
    display: flex;
    flex-direction: column;
    gap: 0;
  }
  .onb-confirm-card--full {
    grid-column: span 2;
  }

  .onb-confirm-card-header {
    display: flex;
    align-items: center;
    gap: 7px;
    margin-bottom: 11px;
    padding-bottom: 9px;
    border-bottom: 1px solid #f1f5f9;
  }

  .onb-confirm-card-tag {
    font-size: 9.5px;
    font-weight: 800;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: #002855;
    background: rgba(0,40,85,0.07);
    padding: 2px 7px;
    border-radius: 99px;
  }

  .onb-confirm-card-count {
    font-size: 11px;
    font-weight: 700;
    color: #94a3b8;
    background: #f1f5f9;
    padding: 1px 6px;
    border-radius: 99px;
  }

  .onb-confirm-kv {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 10px;
    padding: 5px 0;
    border-bottom: 1px solid #f8fafc;
  }
  .onb-confirm-kv:last-child { border-bottom: none; padding-bottom: 0; }

  .onb-confirm-k {
    font-size: 11px;
    font-weight: 600;
    color: #94a3b8;
    white-space: nowrap;
    flex-shrink: 0;
  }

  .onb-confirm-v {
    font-size: 12.5px;
    font-weight: 600;
    color: #0f172a;
    text-align: right;
    word-break: break-all;
  }

  .onb-confirm-mono {
    font-family: 'Courier New', monospace;
    font-size: 12px;
    font-weight: 500;
    color: #334155;
  }

  /* Pills de roles */
  .onb-confirm-pills {
    display: flex;
    flex-wrap: wrap;
    gap: 7px;
  }

  .onb-confirm-pill {
    font-size: 12px;
    font-weight: 600;
    color: #002855;
    background: rgba(0,40,85,0.06);
    border: 1px solid rgba(0,40,85,0.12);
    border-radius: 99px;
    padding: 3px 11px;
    white-space: nowrap;
  }

  /* Lista de trabajadores */
  .onb-confirm-workers {
    display: flex;
    flex-direction: column;
    gap: 0;
    max-height: 200px;
    overflow-y: auto;
    margin: 0 -2px;
    padding: 0 2px;
  }
  .onb-confirm-workers::-webkit-scrollbar { width: 4px; }
  .onb-confirm-workers::-webkit-scrollbar-track { background: transparent; }
  .onb-confirm-workers::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 99px; }
  .onb-confirm-workers::-webkit-scrollbar-thumb:hover { background: #94a3b8; }

  .onb-confirm-worker-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 7px 0;
    border-bottom: 1px solid #f1f5f9;
  }
  .onb-confirm-worker-row:last-child { border-bottom: none; }

  .onb-confirm-worker-avatar {
    width: 30px;
    height: 30px;
    border-radius: 50%;
    background: #002855;
    color: #fff;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 11px;
    font-weight: 700;
    flex-shrink: 0;
    letter-spacing: 0.02em;
  }

  .onb-confirm-worker-info {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .onb-confirm-worker-name {
    font-size: 12.5px;
    font-weight: 600;
    color: #0f172a;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .onb-confirm-worker-rut {
    font-size: 10.5px;
    color: #94a3b8;
    font-family: 'Courier New', monospace;
    letter-spacing: 0.02em;
  }

  .onb-confirm-worker-rol {
    font-size: 11px;
    font-weight: 600;
    color: #006edc;
    background: rgba(0,110,220,0.07);
    border: 1px solid rgba(0,110,220,0.14);
    border-radius: 99px;
    padding: 2px 9px;
    white-space: nowrap;
    flex-shrink: 0;
  }

  @media (max-width: 480px) {
    .onb-confirm-grid { grid-template-columns: 1fr; }
    .onb-confirm-card--full { grid-column: span 1; }
  }

  /* ── Error ── */
  .onb-error {
    font-size: 12px;
    color: #df3601;
    font-weight: 500;
    margin: 14px 0 0;
    padding: 8px 10px;
    background: rgba(223,54,1,0.06);
    border-radius: 6px;
    border-left: 2px solid #df3601;
  }

  /* ── Navigation ── */
  .onb-nav {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-top: 20px;
  }

  .onb-back-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    height: 40px;
    padding: 0 16px;
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    color: #475569;
    font-size: 13px;
    font-weight: 500;
    font-family: inherit;
    cursor: pointer;
    transition: background 0.15s, border-color 0.15s;
  }
  .onb-back-btn:hover { background: #f1f5f9; border-color: #cbd5e1; }

  .onb-submit {
    height: 40px;
    padding: 0 22px;
    display: flex;
    align-items: center;
    gap: 7px;
    background: #002855;
    color: #fff;
    border: none;
    border-radius: 8px;
    font-size: 13.5px;
    font-weight: 600;
    font-family: inherit;
    cursor: pointer;
    letter-spacing: 0.01em;
    transition: background 0.15s, transform 0.12s, box-shadow 0.15s;
  }
  .onb-submit:not(:disabled):hover {
    background: #006edc;
    transform: translateY(-1px);
    box-shadow: 0 6px 20px rgba(0,110,220,0.3);
  }
  .onb-submit:disabled { opacity: 0.6; cursor: not-allowed; }

  .onb-spinner {
    width: 16px; height: 16px;
    border: 2px solid rgba(255,255,255,0.3);
    border-top-color: #fff;
    border-radius: 50%;
    animation: onbSpin 0.7s linear infinite;
  }
  @keyframes onbSpin { to { transform: rotate(360deg); } }

  .onb-login-link {
    display: block;
    text-align: center;
    margin-top: 16px;
    font-size: 12px;
    color: #006edc;
    text-decoration: none;
    font-weight: 500;
    transition: color 0.15s;
  }
  .onb-login-link:hover { color: #0052a3; text-decoration: underline; }

  /* ── Success ── */
  .onb-success-circle {
    width: 72px; height: 72px;
    background: rgba(0,110,220,0.08);
    color: #006edc;
    border-radius: 50%;
    display: flex; align-items: center; justify-content: center;
    margin: 0 auto 14px;
  }

  .onb-success-title {
    font-size: 22px;
    font-weight: 700;
    color: #0f172a;
    margin: 0 0 8px;
    letter-spacing: -0.02em;
  }

  .onb-success-sub {
    font-size: 13px;
    color: #64748b;
    margin: 0 0 20px;
    line-height: 1.5;
  }

  .onb-cred-block {
    background: #f8fafc;
    border: 1px solid #e8edf3;
    border-radius: 10px;
    padding: 14px 16px;
    margin-bottom: 10px;
  }
  .onb-cred-block--err {
    background: rgba(239,68,68,0.04);
    border-color: rgba(239,68,68,0.25);
  }

  .onb-cred-label {
    font-size: 9.5px;
    font-weight: 800;
    color: #94a3b8;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    margin-bottom: 4px;
  }

  .onb-cred-value {
    font-size: 13px;
    font-weight: 600;
    color: #0f172a;
    margin-bottom: 8px;
  }

  .onb-cred-error { font-size: 11px; color: #ef4444; }

  .onb-pw-tag {
    font-size: 10px;
    font-weight: 600;
    color: #64748b;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    display: block;
    margin-bottom: 6px;
  }

  .onb-pw-box {
    display: flex;
    align-items: center;
    justify-content: space-between;
    background: rgba(0,110,220,0.06);
    border: 1px solid rgba(0,110,220,0.15);
    border-radius: 8px;
    padding: 8px 12px;
    gap: 10px;
  }

  .onb-pw-code {
    font-family: 'Courier New', monospace;
    font-size: 14px;
    font-weight: 700;
    color: #006edc;
    letter-spacing: 0.04em;
  }

  .onb-copy-btn {
    background: rgba(0,110,220,0.1);
    color: #006edc;
    border: none;
    width: 28px; height: 28px;
    border-radius: 6px;
    display: flex; align-items: center; justify-content: center;
    cursor: pointer;
    flex-shrink: 0;
    transition: all 0.15s;
  }
  .onb-copy-btn:hover { background: #006edc; color: #fff; }

  .onb-hint {
    font-size: 11px;
    color: #94a3b8;
    text-align: center;
    margin: 10px 0 0;
  }

  /* ── Brand section (logo + color) ── */
  .onb-brand-section {
    display: flex;
    flex-direction: column;
    gap: 18px;
    margin-top: 18px;
    padding-top: 18px;
    border-top: 1px solid #e8edf3;
  }

  .onb-logo-upload-area {
    display: flex;
    align-items: center;
    gap: 16px;
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    border-radius: 10px;
    padding: 14px 16px;
  }

  .onb-logo-preview {
    width: 96px;
    height: 56px;
    flex-shrink: 0;
    border-radius: 8px;
    background: #fff;
    border: 1px solid #e2e8f0;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
  }

  .onb-logo-preview-img {
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
  }

  .onb-logo-preview-default {
    display: flex;
    align-items: baseline;
    gap: 4px;
    font-family: 'Lora', Georgia, serif;
    font-size: 0.82rem;
    font-weight: 600;
    letter-spacing: -0.01em;
  }

  .onb-logo-upload-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    flex: 1;
    min-width: 0;
  }

  .onb-logo-upload-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 34px;
    padding: 0 14px;
    background: #fff;
    border: 1px solid #cbd5e1;
    border-radius: 7px;
    color: #334155;
    font-size: 12.5px;
    font-weight: 600;
    font-family: inherit;
    cursor: pointer;
    transition: background 0.15s, border-color 0.15s;
    white-space: nowrap;
  }
  .onb-logo-upload-btn:hover { background: #f1f5f9; border-color: #94a3b8; }

  .onb-logo-remove-btn {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    height: 34px;
    padding: 0 12px;
    background: none;
    border: 1px solid rgba(239,68,68,0.25);
    border-radius: 7px;
    color: #ef4444;
    font-size: 12.5px;
    font-weight: 600;
    font-family: inherit;
    cursor: pointer;
    transition: background 0.15s;
  }
  .onb-logo-remove-btn:hover { background: rgba(239,68,68,0.06); }

  .onb-logo-hint {
    font-size: 11px;
    color: #94a3b8;
    width: 100%;
  }

  /* ── Color picker ── */
  .onb-color-picker-row {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
  }

  .onb-color-swatch {
    width: 38px;
    height: 38px;
    border-radius: 8px;
    flex-shrink: 0;
    border: 2px solid rgba(0,0,0,0.10);
    cursor: pointer;
    transition: transform 0.12s, box-shadow 0.12s;
    box-shadow: 0 1px 4px rgba(0,0,0,0.12);
  }
  .onb-color-swatch:hover { transform: scale(1.06); box-shadow: 0 2px 8px rgba(0,0,0,0.18); }

  .onb-color-native {
    position: absolute;
    opacity: 0;
    width: 0;
    height: 0;
    pointer-events: none;
  }

  .onb-color-hex-input {
    width: 96px !important;
    font-family: 'Courier New', monospace !important;
    font-size: 13px !important;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .onb-color-rgb {
    font-size: 11.5px;
    color: #64748b;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  .onb-color-hint {
    font-size: 11px;
    color: #94a3b8;
    margin: 6px 0 0;
    line-height: 1.5;
  }

  /* ── Responsive ── */
  @media (max-width: 620px) {
    .onb-card { padding: 32px 20px 28px; border-radius: 12px; }
    .onb-logo { font-size: 1.7rem; }
    .onb-grid { grid-template-columns: 1fr; }
    .onb-full { grid-column: span 1; }
    .onb-workers-grid { grid-template-columns: repeat(2, 1fr); }
    .onb-step-lbl { display: none !important; }
    .onb-wform-footer { flex-direction: column; align-items: flex-start; gap: 10px; }
    .onb-add-btn { width: 100%; justify-content: center; }
    .onb-logo-upload-area { flex-direction: column; align-items: flex-start; }
    .onb-color-picker-row { flex-wrap: wrap; }
  }

  @media (max-width: 380px) {
    .onb-workers-grid { grid-template-columns: 1fr; }
  }
`;
