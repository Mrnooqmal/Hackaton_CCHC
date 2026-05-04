import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { tenantsApi } from '../api/client';
import type { TenantSetupData, TenantSetupResponse } from '../api/client';
import { FiArrowRight, FiArrowLeft, FiCheckCircle, FiCopy, FiCheck, FiShield, FiUsers, FiSettings, FiUser } from 'react-icons/fi';

type Step = 'empresa' | 'plan' | 'admin' | 'confirmacion';
const STEPS: Step[] = ['empresa', 'plan', 'admin', 'confirmacion'];
const STEP_LABELS: Record<Step, string> = {
  empresa: 'Empresa',
  plan: 'Plan',
  admin: 'Administrador',
  confirmacion: 'Confirmar',
};
const STEP_ICONS: Record<Step, React.ReactNode> = {
  empresa: <FiSettings size={18} />,
  plan: <FiUsers size={18} />,
  admin: <FiUser size={18} />,
  confirmacion: <FiCheckCircle size={18} />,
};

const PLANES = [
  { id: 'starter' as const, nombre: 'Starter', obras: 1, trabajadores: 25, desc: 'Ideal para empresas pequeñas', precio: 'Gratis' },
  { id: 'professional' as const, nombre: 'Professional', obras: 5, trabajadores: 100, desc: 'Para empresas en crecimiento', precio: '$49.990/mes' },
  { id: 'enterprise' as const, nombre: 'Enterprise', obras: -1, trabajadores: -1, desc: 'Sin límites, soporte premium', precio: 'Contactar' },
];

export default function TenantOnboarding() {
  const navigate = useNavigate();
  const [currentStep, setCurrentStep] = useState<Step>('empresa');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [result, setResult] = useState<TenantSetupResponse | null>(null);
  const [passwordTemp, setPasswordTemp] = useState('');

  const [empresa, setEmpresa] = useState({ nombre: '', rutEmpresa: '', email: '', telefono: '', cantidadTrabajadores: 10 });
  const [plan, setPlan] = useState<'starter' | 'professional' | 'enterprise'>('starter');
  const [admin, setAdmin] = useState({ rut: '', nombre: '', apellido: '', email: '' });

  const stepIndex = STEPS.indexOf(currentStep);

  const validateEmpresa = () => {
    if (!empresa.nombre.trim()) return 'El nombre de la empresa es requerido';
    if (!empresa.rutEmpresa.trim()) return 'El RUT de la empresa es requerido';
    if (empresa.cantidadTrabajadores < 1) return 'La cantidad de trabajadores debe ser mayor a 0';
    return '';
  };

  const validateAdmin = () => {
    if (!admin.rut.trim()) return 'El RUT del administrador es requerido';
    if (!admin.nombre.trim()) return 'El nombre del administrador es requerido';
    if (!admin.email.trim()) return 'El email del administrador es requerido';
    if (!/\S+@\S+\.\S+/.test(admin.email)) return 'El email no tiene un formato válido';
    return '';
  };

  const next = () => {
    setError('');
    if (currentStep === 'empresa') {
      const err = validateEmpresa();
      if (err) { setError(err); return; }
    }
    if (currentStep === 'admin') {
      const err = validateAdmin();
      if (err) { setError(err); return; }
    }
    const i = stepIndex + 1;
    if (i < STEPS.length) setCurrentStep(STEPS[i]);
  };

  const prev = () => {
    setError('');
    const i = stepIndex - 1;
    if (i >= 0) setCurrentStep(STEPS[i]);
  };

  const handleSubmit = async () => {
    setLoading(true);
    setError('');
    try {
      const payload: TenantSetupData = {
        nombre: empresa.nombre,
        rutEmpresa: empresa.rutEmpresa,
        cantidadTrabajadores: empresa.cantidadTrabajadores,
        email: empresa.email,
        telefono: empresa.telefono,
        plan,
        admin: { rut: admin.rut, nombre: admin.nombre, apellido: admin.apellido, email: admin.email },
      };
      const response = await tenantsApi.setup(payload);
      if (response.success && response.data) {
        setResult(response.data);
        const data = response.data as any;
        const tempPwd = typeof data.passwordTemporal === 'string' ? data.passwordTemporal 
                     : (typeof data.admin?.passwordTemporal === 'string' ? data.admin.passwordTemporal : '');
        setPasswordTemp(tempPwd);
      } else {
        setError(response.error || 'Error al crear la empresa');
      }
    } catch {
      setError('Error de conexión con el servidor');
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  /* ========== SUCCESS ========== */
  if (result) {
    return (
      <div className="onb-page">
        <div className="login-bg">
          <div className="login-bg-gradient login-bg-gradient-1" />
          <div className="login-bg-gradient login-bg-gradient-2" />
          <div className="login-bg-gradient login-bg-gradient-3" />
        </div>
        <div className="onb-wrap" style={{ maxWidth: 520 }}>
          <div className="onb-card">
            <div className="login-card-glow" />
            <div style={{ position: 'relative', zIndex: 1, textAlign: 'center' }}>
              <div className="onb-success-icon"><FiCheckCircle size={44} /></div>
              <h2 className="onb-success-title">¡Empresa Registrada!</h2>
              <p className="onb-success-sub">
                <strong>{result.tenant.nombre}</strong> ha sido creada exitosamente. Estado: <span className="onb-badge-active">Activo</span>
              </p>

              <div className="onb-creds">
                <div className="onb-cred-row">
                  <span>EMPRESA</span>
                  <strong>{result.tenant.nombre}</strong>
                </div>
                <div className="onb-cred-row">
                  <span>PLAN</span>
                  <strong style={{ textTransform: 'capitalize' }}>{result.tenant.plan}</strong>
                </div>
                {result.admin && (
                  <>
                    <div className="onb-cred-row">
                      <span>ADMINISTRADOR</span>
                      <strong>{result.admin.nombre} — {result.admin.rut}</strong>
                    </div>
                    {passwordTemp && (
                      <div className="onb-cred-row">
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                          <span>CONTRASEÑA TEMPORAL</span>
                          <span className="onb-badge-conf">Confidencial</span>
                        </div>
                        <div className="onb-pw-box">
                          <code>{passwordTemp}</code>
                          <button onClick={() => copyToClipboard(passwordTemp)} title="Copiar">
                            {copied ? <FiCheck size={18} /> : <FiCopy size={18} />}
                          </button>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>

              <button className="btn btn-primary btn-lg onb-btn-full" onClick={() => navigate('/login')}>
                <span>Ir al Login</span> <FiArrowRight />
              </button>
              <p className="onb-small">Se solicitará cambiar la contraseña en el primer acceso.</p>
            </div>
          </div>
        </div>
        {onbStyles}
      </div>
    );
  }

  /* ========== WIZARD ========== */
  return (
    <div className="onb-page">
      <div className="login-bg">
        <div className="login-bg-gradient login-bg-gradient-1" />
        <div className="login-bg-gradient login-bg-gradient-2" />
        <div className="login-bg-gradient login-bg-gradient-3" />
      </div>

      <div className="onb-wrap">
        {/* Header */}
        <div className="onb-header">
          <div className="onb-logo-icon"><FiShield size={30} /></div>
          <h1>Registrar Nueva Empresa</h1>
          <p>Configura tu empresa en la plataforma Build&Serve</p>
        </div>

        {/* Stepper */}
        <div className="onb-stepper">
          {STEPS.map((s, i) => (
            <div key={s} className={`onb-step ${i < stepIndex ? 'done' : ''} ${s === currentStep ? 'active' : ''}`}>
              <div className="onb-step-dot">{i < stepIndex ? <FiCheck size={14} /> : STEP_ICONS[s]}</div>
              <span>{STEP_LABELS[s]}</span>
              {i < STEPS.length - 1 && <div className="onb-step-line" />}
            </div>
          ))}
        </div>

        {/* Card */}
        <div className="onb-card">
          <div className="login-card-glow" />
          <div style={{ position: 'relative', zIndex: 1 }}>

            {/* Step: Empresa */}
            {currentStep === 'empresa' && (
              <div className="onb-form-anim">
                <h3 className="onb-section-title">Datos de la Empresa</h3>
                <div className="onb-grid">
                  <div className="onb-field full">
                    <label>RAZÓN SOCIAL *</label>
                    <input placeholder="Constructora Demo SpA" value={empresa.nombre} onChange={e => setEmpresa({ ...empresa, nombre: e.target.value })} />
                  </div>
                  <div className="onb-field">
                    <label>RUT EMPRESA *</label>
                    <input placeholder="76.123.456-7" value={empresa.rutEmpresa} onChange={e => setEmpresa({ ...empresa, rutEmpresa: e.target.value })} />
                  </div>
                  <div className="onb-field">
                    <label>CANTIDAD TRABAJADORES *</label>
                    <input type="number" min={1} value={empresa.cantidadTrabajadores} onChange={e => setEmpresa({ ...empresa, cantidadTrabajadores: parseInt(e.target.value) || 1 })} />
                  </div>
                  <div className="onb-field">
                    <label>EMAIL CORPORATIVO</label>
                    <input type="email" placeholder="contacto@empresa.cl" value={empresa.email} onChange={e => setEmpresa({ ...empresa, email: e.target.value })} />
                  </div>
                  <div className="onb-field">
                    <label>TELÉFONO</label>
                    <input placeholder="+56 9 1234 5678" value={empresa.telefono} onChange={e => setEmpresa({ ...empresa, telefono: e.target.value })} />
                  </div>
                </div>
              </div>
            )}

            {/* Step: Plan */}
            {currentStep === 'plan' && (
              <div className="onb-form-anim">
                <h3 className="onb-section-title">Selecciona tu Plan</h3>
                <div className="onb-plans">
                  {PLANES.map(p => (
                    <button key={p.id} className={`onb-plan-card ${plan === p.id ? 'selected' : ''}`} onClick={() => setPlan(p.id)}>
                      <div className="onb-plan-top">
                        <h4>{p.nombre}</h4>
                        <span className="onb-plan-price">{p.precio}</span>
                      </div>
                      <p className="onb-plan-desc">{p.desc}</p>
                      <div className="onb-plan-features">
                        <span>🏗️ {p.obras === -1 ? 'Obras ilimitadas' : `${p.obras} obra${p.obras > 1 ? 's' : ''}`}</span>
                        <span>👷 {p.trabajadores === -1 ? 'Trabajadores ilimitados' : `Hasta ${p.trabajadores} trabajadores`}</span>
                      </div>
                      {plan === p.id && <div className="onb-plan-check"><FiCheck size={16} /></div>}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Step: Admin */}
            {currentStep === 'admin' && (
              <div className="onb-form-anim">
                <h3 className="onb-section-title">Administrador Principal</h3>
                <p className="onb-section-sub">Esta persona tendrá acceso completo a la gestión de la empresa.</p>
                <div className="onb-grid">
                  <div className="onb-field full">
                    <label>RUT *</label>
                    <input placeholder="12.345.678-9" value={admin.rut} onChange={e => setAdmin({ ...admin, rut: e.target.value })} />
                  </div>
                  <div className="onb-field">
                    <label>NOMBRE *</label>
                    <input placeholder="Juan" value={admin.nombre} onChange={e => setAdmin({ ...admin, nombre: e.target.value })} />
                  </div>
                  <div className="onb-field">
                    <label>APELLIDO</label>
                    <input placeholder="Pérez" value={admin.apellido} onChange={e => setAdmin({ ...admin, apellido: e.target.value })} />
                  </div>
                  <div className="onb-field full">
                    <label>EMAIL *</label>
                    <input type="email" placeholder="admin@empresa.cl" value={admin.email} onChange={e => setAdmin({ ...admin, email: e.target.value })} />
                  </div>
                </div>
              </div>
            )}

            {/* Step: Confirmacion */}
            {currentStep === 'confirmacion' && (
              <div className="onb-form-anim">
                <h3 className="onb-section-title">Confirmar Registro</h3>
                <p className="onb-section-sub">Revisa los datos antes de crear la empresa.</p>
                <div className="onb-summary">
                  <div className="onb-sum-section">
                    <h4>🏢 Empresa</h4>
                    <div className="onb-sum-row"><span>Razón Social</span><strong>{empresa.nombre}</strong></div>
                    <div className="onb-sum-row"><span>RUT</span><strong>{empresa.rutEmpresa}</strong></div>
                    <div className="onb-sum-row"><span>Trabajadores</span><strong>{empresa.cantidadTrabajadores}</strong></div>
                    {empresa.email && <div className="onb-sum-row"><span>Email</span><strong>{empresa.email}</strong></div>}
                  </div>
                  <div className="onb-sum-section">
                    <h4>📋 Plan</h4>
                    <div className="onb-sum-row"><span>Plan</span><strong style={{ textTransform: 'capitalize' }}>{plan}</strong></div>
                  </div>
                  <div className="onb-sum-section">
                    <h4>👤 Administrador</h4>
                    <div className="onb-sum-row"><span>Nombre</span><strong>{admin.nombre} {admin.apellido}</strong></div>
                    <div className="onb-sum-row"><span>RUT</span><strong>{admin.rut}</strong></div>
                    <div className="onb-sum-row"><span>Email</span><strong>{admin.email}</strong></div>
                  </div>
                </div>
              </div>
            )}

            {error && <div className="onb-error">{error}</div>}

            {/* Navigation */}
            <div className="onb-nav">
              {stepIndex > 0 && (
                <button className="btn onb-btn-back" onClick={prev}><FiArrowLeft /> Atrás</button>
              )}
              <div style={{ flex: 1 }} />
              {currentStep !== 'confirmacion' ? (
                <button className="btn btn-primary onb-btn-next" onClick={next}>Siguiente <FiArrowRight /></button>
              ) : (
                <button className="btn btn-primary onb-btn-next" onClick={handleSubmit} disabled={loading}>
                  {loading ? <div className="spinner" style={{ width: 20, height: 20 }} /> : <><span>Crear Empresa</span> <FiCheckCircle /></>}
                </button>
              )}
            </div>
          </div>
        </div>

        <p className="onb-footer-link">
          <a href="/login">← Ya tengo cuenta, ir al Login</a>
        </p>
      </div>
      {onbStyles}
    </div>
  );
}

/* ========== STYLES ========== */
const onbStyles = (
  <style>{`
.onb-page{min-height:100vh;display:flex;align-items:center;justify-content:center;position:relative;overflow:hidden;background:var(--surface-bg);padding:24px}
.onb-wrap{position:relative;z-index:1;width:100%;max-width:640px;animation:fadeInUp .6s ease-out}
@keyframes fadeInUp{from{opacity:0;transform:translateY(30px)}to{opacity:1;transform:translateY(0)}}
.onb-header{text-align:center;margin-bottom:28px}
.onb-logo-icon{width:60px;height:60px;background:linear-gradient(135deg,var(--primary-500),var(--primary-700));border-radius:16px;display:flex;align-items:center;justify-content:center;color:#fff;margin:0 auto 16px;box-shadow:0 10px 30px rgba(76,175,80,.3)}
.onb-header h1{font-size:1.6rem;font-weight:800;color:#fff;letter-spacing:-.02em;margin-bottom:6px}
.onb-header p{font-size:.88rem;color:var(--text-muted)}
/* stepper */
.onb-stepper{display:flex;align-items:center;justify-content:center;gap:0;margin-bottom:24px}
.onb-step{display:flex;align-items:center;gap:8px;opacity:.45;transition:all .3s}
.onb-step.active,.onb-step.done{opacity:1}
.onb-step-dot{width:34px;height:34px;border-radius:50%;border:2px solid rgba(255,255,255,.15);display:flex;align-items:center;justify-content:center;color:var(--text-muted);font-size:.75rem;transition:all .3s}
.onb-step.active .onb-step-dot{border-color:var(--primary-500);background:rgba(76,175,80,.15);color:var(--primary-400)}
.onb-step.done .onb-step-dot{border-color:var(--primary-500);background:var(--primary-500);color:#fff}
.onb-step span{font-size:.75rem;font-weight:700;color:var(--text-muted);letter-spacing:.05em;display:none}
@media(min-width:600px){.onb-step span{display:inline}}
.onb-step-line{width:32px;height:2px;background:rgba(255,255,255,.1);margin:0 6px}
.onb-step.done+.onb-step .onb-step-line,.onb-step.done .onb-step-line{background:var(--primary-500)}
/* card */
.onb-card{position:relative;background:rgba(26,26,26,.7);backdrop-filter:blur(20px);border:1px solid rgba(255,255,255,.1);border-radius:var(--radius-xl);padding:32px;box-shadow:0 20px 60px rgba(0,0,0,.5);overflow:hidden}
.onb-form-anim{animation:slideIn .3s ease-out}
@keyframes slideIn{from{opacity:0;transform:translateX(16px)}to{opacity:1;transform:translateX(0)}}
.onb-section-title{font-size:1.15rem;font-weight:700;color:#fff;margin-bottom:6px}
.onb-section-sub{font-size:.85rem;color:var(--text-muted);margin-bottom:20px}
/* form fields */
.onb-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}
.onb-field.full{grid-column:span 2}
.onb-field label{display:block;font-size:.68rem;font-weight:800;color:var(--text-muted);letter-spacing:.1em;margin-bottom:6px}
.onb-field input,.onb-field select{width:100%;padding:10px 14px;border-radius:12px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);color:#fff;font-size:.92rem;transition:all .2s}
.onb-field input:focus,.onb-field select:focus{background:rgba(255,255,255,.08);border-color:var(--primary-500);outline:none;box-shadow:0 0 0 3px rgba(76,175,80,.15)}
/* plans */
.onb-plans{display:flex;flex-direction:column;gap:12px}
.onb-plan-card{position:relative;text-align:left;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.08);border-radius:16px;padding:20px;cursor:pointer;transition:all .25s}
.onb-plan-card:hover{border-color:rgba(255,255,255,.18);background:rgba(255,255,255,.05)}
.onb-plan-card.selected{border-color:var(--primary-500);background:rgba(76,175,80,.06);box-shadow:0 0 0 1px var(--primary-500)}
.onb-plan-top{display:flex;justify-content:space-between;align-items:center;margin-bottom:6px}
.onb-plan-top h4{font-size:1.05rem;font-weight:700;color:#fff;margin:0}
.onb-plan-price{font-size:.9rem;font-weight:700;color:var(--primary-400)}
.onb-plan-desc{font-size:.82rem;color:var(--text-muted);margin-bottom:10px}
.onb-plan-features{display:flex;gap:16px;font-size:.78rem;color:var(--text-secondary)}
.onb-plan-check{position:absolute;top:12px;right:12px;width:26px;height:26px;border-radius:50%;background:var(--primary-500);color:#fff;display:flex;align-items:center;justify-content:center}
/* summary */
.onb-summary{display:flex;flex-direction:column;gap:16px}
.onb-sum-section{background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.06);border-radius:14px;padding:16px}
.onb-sum-section h4{font-size:.9rem;font-weight:700;color:#fff;margin:0 0 10px}
.onb-sum-row{display:flex;justify-content:space-between;padding:4px 0;font-size:.85rem}
.onb-sum-row span{color:var(--text-muted)}
.onb-sum-row strong{color:#fff}
/* nav */
.onb-nav{display:flex;align-items:center;gap:12px;margin-top:24px}
.onb-btn-back{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);color:var(--text-secondary);padding:10px 20px;border-radius:12px;display:flex;align-items:center;gap:6px;cursor:pointer;transition:all .2s}
.onb-btn-back:hover{background:rgba(255,255,255,.1);color:#fff}
.onb-btn-next{padding:10px 24px;border-radius:12px;display:flex;align-items:center;gap:6px;font-weight:600}
.onb-error{background:rgba(244,67,54,.1);border:1px solid rgba(244,67,54,.2);color:var(--danger-400);padding:10px;border-radius:10px;font-size:.85rem;text-align:center;margin-top:16px}
.onb-footer-link{text-align:center;margin-top:20px}
.onb-footer-link a{font-size:.85rem;color:var(--primary-400);text-decoration:none;transition:all .2s}
.onb-footer-link a:hover{color:var(--primary-300)}
/* success */
.onb-success-icon{width:76px;height:76px;background:rgba(76,175,80,.1);color:var(--success-500);border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 16px;box-shadow:0 0 40px rgba(76,175,80,.2)}
.onb-success-title{font-size:1.6rem;font-weight:800;color:#fff;margin-bottom:6px}
.onb-success-sub{color:var(--text-muted);font-size:.92rem;margin-bottom:24px}
.onb-badge-active{background:rgba(76,175,80,.15);color:var(--success-400);padding:2px 10px;border-radius:99px;font-size:.75rem;font-weight:700;border:1px solid rgba(76,175,80,.25)}
.onb-badge-conf{background:rgba(76,175,80,.1);color:var(--success-500);padding:1px 8px;border-radius:99px;font-size:.62rem;font-weight:800;letter-spacing:.08em;text-transform:uppercase;border:1px solid rgba(76,175,80,.2)}
.onb-creds{background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.08);border-radius:20px;padding:20px;margin-bottom:20px;display:flex;flex-direction:column;gap:14px;text-align:left}
.onb-cred-row{display:flex;flex-direction:column;gap:4px}
.onb-cred-row span{font-size:.68rem;font-weight:800;color:var(--text-muted);letter-spacing:.1em}
.onb-cred-row strong{font-size:1.05rem;color:#fff}
.onb-pw-box{display:flex;align-items:center;justify-content:space-between;background:rgba(76,175,80,.08);border:1px solid rgba(76,175,80,.2);padding:12px 16px;border-radius:14px}
.onb-pw-box code{font-size:1.3rem;font-family:var(--font-mono);font-weight:800;color:var(--success-400);letter-spacing:.05em}
.onb-pw-box button{background:rgba(76,175,80,.15);color:var(--success-400);border:none;width:36px;height:36px;border-radius:10px;display:flex;align-items:center;justify-content:center;cursor:pointer;transition:all .2s}
.onb-pw-box button:hover{background:var(--success-500);color:#fff;transform:scale(1.05)}
.onb-btn-full{width:100%;margin-top:8px;display:flex;align-items:center;justify-content:center;gap:8px}
.onb-small{font-size:.75rem;text-align:center;color:var(--text-muted);margin-top:12px}
@media(max-width:480px){.onb-grid{grid-template-columns:1fr}.onb-field.full{grid-column:span 1}.onb-card{padding:20px}}
`}</style>
);
