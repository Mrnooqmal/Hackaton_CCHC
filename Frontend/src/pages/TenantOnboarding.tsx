import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { tenantsApi, personasApi } from '../api/client';
import type { TenantSetupData, TenantSetupResponse } from '../api/client';
import { FiArrowRight, FiArrowLeft, FiCheckCircle, FiCopy, FiCheck, FiUserPlus, FiX } from 'react-icons/fi';

type Step = 'empresa' | 'admin' | 'trabajadores' | 'confirmacion';
const STEPS: Step[] = ['empresa', 'admin', 'trabajadores', 'confirmacion'];
const STEP_LABELS: Record<Step, string> = {
  empresa: 'Empresa',
  admin: 'Administrador',
  trabajadores: 'Trabajadores',
  confirmacion: 'Confirmar',
};
const STEP_NUMS: Record<Step, string> = {
  empresa: '1', admin: '2', trabajadores: '3', confirmacion: '4',
};
const ROL_LABELS: Record<string, string> = {
  trabajador: 'Trabajador', supervisor: 'Supervisor',
  jefe_obra: 'Jefe de Obra', prevencionista: 'Prevencionista',
};

const BLANK_WORKER = {
  rut: '', nombre: '', apellido: '', email: '',
  rol: 'trabajador', cargo: '', tieneAccesoWeb: false,
};

interface WorkerDraft {
  _id: string; rut: string; nombre: string; apellido: string;
  email: string; rol: string; cargo: string; tieneAccesoWeb: boolean;
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

  const [empresa, setEmpresa] = useState({
    nombre: '', rutEmpresa: '', email: '', telefono: '', cantidadTrabajadores: 10,
  });
  const [admin, setAdmin] = useState({ rut: '', nombre: '', apellido: '', email: '' });
  const [workers, setWorkers] = useState<WorkerDraft[]>([]);
  const [wForm, setWForm] = useState({ ...BLANK_WORKER });
  const [wErrors, setWErrors] = useState<Set<string>>(new Set());

  const idx = STEPS.indexOf(currentStep);

  const clearField = (k: string) => setFieldErrors(p => {
    if (!p.has(k)) return p;
    const n = new Set(p); n.delete(k); return n;
  });

  const validateEmpresa = (): string[] => {
    const f: string[] = [];
    if (!empresa.nombre.trim()) f.push('nombre');
    if (!empresa.rutEmpresa.trim()) f.push('rutEmpresa');
    if (empresa.cantidadTrabajadores < 1) f.push('cantidadTrabajadores');
    return f;
  };

  const validateAdmin = (): string[] => {
    const f: string[] = [];
    if (!admin.rut.trim()) f.push('rut');
    if (!admin.nombre.trim()) f.push('adminNombre');
    if (!admin.email.trim()) f.push('email');
    else if (!/\S+@\S+\.\S+/.test(admin.email)) f.push('emailFormato');
    return f;
  };

  const buildMsg = (fields: string[]) => {
    const LABELS: Record<string, string> = {
      nombre: 'Razón social', rutEmpresa: 'RUT empresa',
      cantidadTrabajadores: 'Cantidad de trabajadores',
      rut: 'RUT', adminNombre: 'Nombre', email: 'Email',
    };
    if (fields.includes('emailFormato')) {
      const others = fields.filter(x => x !== 'emailFormato').map(x => LABELS[x]).filter(Boolean);
      return (others.length ? `Completa: ${others.join(', ')}. ` : '') + 'El email no tiene un formato válido.';
    }
    return `Completa los campos requeridos: ${fields.map(x => LABELS[x] || x).join(', ')}`;
  };

  const next = () => {
    setError(''); setFieldErrors(new Set());
    if (currentStep === 'empresa') {
      const f = validateEmpresa();
      if (f.length) { setFieldErrors(new Set(f)); setError(buildMsg(f)); return; }
    }
    if (currentStep === 'admin') {
      const f = validateAdmin();
      if (f.length) { setFieldErrors(new Set(f)); setError(buildMsg(f)); return; }
    }
    if (idx + 1 < STEPS.length) setCurrentStep(STEPS[idx + 1]);
  };

  const prev = () => {
    setError(''); setFieldErrors(new Set());
    if (idx > 0) setCurrentStep(STEPS[idx - 1]);
  };

  const addWorker = () => {
    const errs = new Set<string>();
    if (!wForm.nombre.trim()) errs.add('wNombre');
    if (!wForm.rut.trim()) errs.add('wRut');
    setWErrors(errs);
    if (errs.size) return;
    setWorkers(p => [...p, { ...wForm, _id: String(Date.now() + Math.random()) }]);
    setWForm({ ...BLANK_WORKER });
    setWErrors(new Set());
  };

  const removeWorker = (id: string) => setWorkers(p => p.filter(w => w._id !== id));

  const handleSubmit = async () => {
    setLoading(true); setError('');
    try {
      const payload: TenantSetupData = {
        nombre: empresa.nombre,
        rutEmpresa: empresa.rutEmpresa,
        cantidadTrabajadores: empresa.cantidadTrabajadores,
        email: empresa.email,
        telefono: empresa.telefono,
        plan: 'starter',
        admin: { rut: admin.rut, nombre: admin.nombre, apellido: admin.apellido, email: admin.email },
      };
      const response = await tenantsApi.setup(payload);
      if (response.success && response.data) {
        const data = response.data as any;
        const tempPwd = typeof data.passwordTemporal === 'string' ? data.passwordTemporal
          : (typeof data.admin?.passwordTemporal === 'string' ? data.admin.passwordTemporal : '');
        setAdminPassword(tempPwd);

        const tenantId = response.data.tenant.tenantId;
        if (workers.length > 0 && tenantId) {
          const results: WorkerResult[] = [];
          for (const w of workers) {
            try {
              const wRes = await personasApi.create(tenantId, {
                rut: w.rut, nombre: w.nombre, apellido: w.apellido,
                email: w.email, rol: w.rol, cargo: w.cargo,
                tieneAccesoWeb: w.tieneAccesoWeb || w.rol !== 'trabajador',
              });
              if (wRes.success && wRes.data) {
                results.push({ rut: w.rut, nombre: w.nombre, apellido: w.apellido, password: wRes.data.passwordTemporal });
              } else {
                results.push({ rut: w.rut, nombre: w.nombre, apellido: w.apellido, error: wRes.error || 'Error al crear' });
              }
            } catch {
              results.push({ rut: w.rut, nombre: w.nombre, apellido: w.apellido, error: 'Error de conexión' });
            }
          }
          setWorkersResult(results);
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
              <div className="onb-field">
                <label className="onb-label">RUT EMPRESA *</label>
                <input
                  className={`onb-input${fieldErrors.has('rutEmpresa') ? ' onb-input--err' : ''}`}
                  placeholder="76.123.456-7"
                  value={empresa.rutEmpresa}
                  onChange={e => { setEmpresa({ ...empresa, rutEmpresa: e.target.value }); clearField('rutEmpresa'); }}
                />
              </div>
              <div className="onb-field">
                <label className="onb-label">CANT. TRABAJADORES *</label>
                <input
                  className={`onb-input${fieldErrors.has('cantidadTrabajadores') ? ' onb-input--err' : ''}`}
                  type="number" min={1}
                  value={empresa.cantidadTrabajadores}
                  onChange={e => { setEmpresa({ ...empresa, cantidadTrabajadores: parseInt(e.target.value) || 1 }); clearField('cantidadTrabajadores'); }}
                />
              </div>
              <div className="onb-field">
                <label className="onb-label">EMAIL CORPORATIVO</label>
                <input
                  className="onb-input" type="email"
                  placeholder="contacto@empresa.cl"
                  value={empresa.email}
                  onChange={e => setEmpresa({ ...empresa, email: e.target.value })}
                />
              </div>
              <div className="onb-field">
                <label className="onb-label">TELÉFONO</label>
                <input
                  className="onb-input"
                  placeholder="+56 9 1234 5678"
                  value={empresa.telefono}
                  onChange={e => setEmpresa({ ...empresa, telefono: e.target.value })}
                />
              </div>
            </div>
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
                  className={`onb-input${fieldErrors.has('rut') ? ' onb-input--err' : ''}`}
                  placeholder="12.345.678-9"
                  value={admin.rut}
                  onChange={e => { setAdmin({ ...admin, rut: e.target.value }); clearField('rut'); }}
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
                <label className="onb-label">APELLIDO</label>
                <input
                  className="onb-input"
                  placeholder="Pérez"
                  value={admin.apellido}
                  onChange={e => setAdmin({ ...admin, apellido: e.target.value })}
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
                  <label className="onb-label">APELLIDO</label>
                  <input
                    className="onb-input"
                    placeholder="Pérez"
                    value={wForm.apellido}
                    onChange={e => setWForm({ ...wForm, apellido: e.target.value })}
                  />
                </div>
                <div className="onb-field">
                  <label className="onb-label">RUT *</label>
                  <input
                    className={`onb-input${wErrors.has('wRut') ? ' onb-input--err' : ''}`}
                    placeholder="12.345.678-9"
                    value={wForm.rut}
                    onChange={e => { setWForm({ ...wForm, rut: e.target.value }); setWErrors(p => { const n = new Set(p); n.delete('wRut'); return n; }); }}
                  />
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
                    <option value="trabajador">Trabajador</option>
                    <option value="supervisor">Supervisor</option>
                    <option value="jefe_obra">Jefe de Obra</option>
                    <option value="prevencionista">Prevencionista</option>
                  </select>
                </div>
                <div className="onb-field">
                  <label className="onb-label">CARGO</label>
                  <input
                    className="onb-input"
                    placeholder="Operador, Maestro..."
                    value={wForm.cargo}
                    onChange={e => setWForm({ ...wForm, cargo: e.target.value })}
                  />
                </div>
              </div>
              <div className="onb-wform-footer">
                <label className="onb-check-label">
                  <input
                    type="checkbox"
                    checked={wForm.tieneAccesoWeb}
                    onChange={e => setWForm({ ...wForm, tieneAccesoWeb: e.target.checked })}
                  />
                  <span>Habilitar acceso web (login con contraseña)</span>
                </label>
                <button className="onb-add-btn" onClick={addWorker} type="button">
                  <FiUserPlus size={13} /><span>Agregar</span>
                </button>
              </div>
            </div>

            {workers.length > 0 && (
              <div className="onb-workers-section">
                <div className="onb-workers-count">
                  {workers.length} trabajador{workers.length !== 1 ? 'es' : ''} agregado{workers.length !== 1 ? 's' : ''}
                </div>
                <div className="onb-workers-grid">
                  {workers.map(w => (
                    <div key={w._id} className="onb-worker-card">
                      <div className="onb-worker-avatar">
                        {w.nombre[0]?.toUpperCase()}{w.apellido?.[0]?.toUpperCase() ?? w.nombre[1]?.toUpperCase() ?? ''}
                      </div>
                      <div className="onb-worker-info">
                        <span className="onb-worker-name">{w.nombre} {w.apellido}</span>
                        <span className="onb-worker-rut">{w.rut}</span>
                        <span className="onb-worker-role">{ROL_LABELS[w.rol] || w.rol}</span>
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
            <div className="onb-summary">
              <div className="onb-sum-section">
                <div className="onb-sum-header">🏢 Empresa</div>
                <div className="onb-sum-row"><span>Razón Social</span><strong>{empresa.nombre}</strong></div>
                <div className="onb-sum-row"><span>RUT</span><strong>{empresa.rutEmpresa}</strong></div>
                <div className="onb-sum-row"><span>Trabajadores</span><strong>{empresa.cantidadTrabajadores}</strong></div>
                {empresa.email && <div className="onb-sum-row"><span>Email</span><strong>{empresa.email}</strong></div>}
              </div>
              <div className="onb-sum-section">
                <div className="onb-sum-header">👤 Administrador</div>
                <div className="onb-sum-row"><span>Nombre</span><strong>{admin.nombre} {admin.apellido}</strong></div>
                <div className="onb-sum-row"><span>RUT</span><strong>{admin.rut}</strong></div>
                <div className="onb-sum-row"><span>Email</span><strong>{admin.email}</strong></div>
              </div>
              {workers.length > 0 && (
                <div className="onb-sum-section">
                  <div className="onb-sum-header">👷 Trabajadores ({workers.length})</div>
                  {workers.map(w => (
                    <div key={w._id} className="onb-sum-row">
                      <span>{w.nombre} {w.apellido} — {w.rut}</span>
                      <strong>{ROL_LABELS[w.rol]}</strong>
                    </div>
                  ))}
                </div>
              )}
            </div>
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
            <button className="onb-submit" onClick={next} type="button">
              <span>Siguiente</span> <FiArrowRight size={15} />
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
  }

  .onb-step-group {
    display: flex;
    align-items: center;
    gap: 0;
  }

  .onb-step-dot {
    width: 30px;
    height: 30px;
    border-radius: 50%;
    border: 2px solid #e2e8f0;
    background: #f8fafc;
    color: #94a3b8;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 11px;
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
    letter-spacing: 0.06em;
    margin-left: 6px;
    white-space: nowrap;
    display: none;
  }
  .onb-step-lbl.active { color: #002855; }

  .onb-step-line {
    width: 28px;
    height: 2px;
    background: #e2e8f0;
    margin: 0 6px;
    flex-shrink: 0;
    transition: background 0.2s;
  }
  .onb-step-line.done { background: #006edc; }

  @media (min-width: 480px) { .onb-step-lbl { display: inline; } }

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

  /* ── Summary ── */
  .onb-summary { display: flex; flex-direction: column; gap: 10px; }

  .onb-sum-section {
    background: #f8fafc;
    border: 1px solid #e8edf3;
    border-radius: 10px;
    padding: 14px 16px;
  }

  .onb-sum-header {
    font-size: 12px;
    font-weight: 700;
    color: #0f172a;
    margin-bottom: 10px;
  }

  .onb-sum-row {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    padding: 4px 0;
    font-size: 12.5px;
    border-bottom: 1px solid #f1f5f9;
    gap: 12px;
  }
  .onb-sum-row:last-child { border-bottom: none; }
  .onb-sum-row span { color: #64748b; white-space: nowrap; }
  .onb-sum-row strong { color: #0f172a; font-weight: 600; text-align: right; word-break: break-word; }

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
  }

  @media (max-width: 380px) {
    .onb-workers-grid { grid-template-columns: 1fr; }
  }
`;
