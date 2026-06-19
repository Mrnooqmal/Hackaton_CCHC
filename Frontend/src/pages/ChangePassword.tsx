import { useState, useRef } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { authApi } from '../api/client';
import { FiEye, FiEyeOff, FiCheck, FiX, FiAlertCircle } from 'react-icons/fi';
import { Stepper } from '../components/ui';
import type { StepperStep } from '../components/ui';

const ONBOARDING_STEPS: StepperStep[] = [
  { id: 'pass', label: 'Contraseña' },
  { id: 'enroll', label: 'Enrolamiento' },
];

function StrengthBar({ password }: { password: string }) {
  const score = (() => {
    if (!password) return 0;
    let s = 0;
    if (password.length >= 6) s++;
    if (password.length >= 10) s++;
    if (/[A-Z]/.test(password)) s++;
    if (/[0-9]/.test(password)) s++;
    if (/[^A-Za-z0-9]/.test(password)) s++;
    return s;
  })();
  const label = ['', 'Muy débil', 'Débil', 'Regular', 'Buena', 'Fuerte'][score];
  const color = ['', '#ef4444', '#f97316', '#eab308', '#22c55e', '#16a34a'][score];
  return (
    <div className="cp-strength">
      <div className="cp-strength-bars">
        {[1, 2, 3, 4, 5].map(i => (
          <div key={i} className="cp-strength-bar" style={{ background: i <= score ? color : undefined }} />
        ))}
      </div>
      {label && <span className="cp-strength-label" style={{ color }}>{label}</span>}
    </div>
  );
}

function RuleCheck({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={`cp-rule${ok ? ' ok' : ''}`}>
      {ok ? <FiCheck size={12} strokeWidth={3} /> : <FiX size={12} strokeWidth={3} />}
      {label}
    </span>
  );
}

export default function ChangePassword() {
  const { user, logout, updateUser } = useAuth();
  const navigate = useNavigate();
  const isFirstEntry = user?.passwordTemporal === true || user?.habilitado === false;

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [show, setShow] = useState({ actual: false, nuevo: false, confirmar: false });
  const [capsLock, setCapsLock] = useState(false);
  const [form, setForm] = useState({ passwordActual: '', passwordNuevo: '', confirmarPassword: '' });

  const newRef = useRef<HTMLInputElement>(null);

  const minLen = form.passwordNuevo.length >= 6;
  const match = form.passwordNuevo === form.confirmarPassword && form.confirmarPassword !== '';
  const canSubmit = form.passwordActual && minLen && match;

  const handleCaps = (e: React.KeyboardEvent) => setCapsLock(e.getModifierState('CapsLock'));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    if (form.passwordNuevo !== form.confirmarPassword) { setError('Las contraseñas no coinciden'); return; }
    if (form.passwordNuevo.length < 6) { setError('La contraseña debe tener al menos 6 caracteres'); return; }
    setLoading(true); setError('');
    try {
      const response = await authApi.changePassword({
        personaId: user?.personaId || user?.userId || '',
        ...form
      });
      if (response.success) {
        updateUser({ passwordTemporal: false } as Parameters<typeof updateUser>[0]);
        setSuccess(true);
        setTimeout(() => {
          if (!user?.habilitado) {
            navigate('/enroll-me', { replace: true });
          } else {
            navigate('/', { replace: true });
          }
        }, 1800);
      } else {
        setError(response.error || 'Error al cambiar la contraseña');
      }
    } catch {
      setError('Error de conexión con el servidor');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="cp-root">
      {/* Panel de contexto — solo visible en desktop */}
      <div className="cp-side">
        <div className="cp-side-inner">
          <Link to="/" className="cp-logo" aria-label="Build & Serve — Inicio">
            <span className="cp-logo-primary">Build</span>
            <span className="cp-logo-amp">&amp;</span>
            <span className="cp-logo-secondary">Serve</span>
          </Link>
          {user && (
            <div className="cp-user-info">
              <span className="cp-user-name">{user.nombre} {user.apellido}</span>
              {user.email && <span className="cp-user-email">{user.email}</span>}
            </div>
          )}
          {isFirstEntry && (
            <div className="cp-stepper-wrap">
              <Stepper
                steps={ONBOARDING_STEPS}
                currentIndex={success ? 1 : 0}
                completed={success ? ['pass'] : []}
                orientation="vertical"
              />
            </div>
          )}
          <p className="cp-side-hint">
            {isFirstEntry
              ? 'Crea una contraseña segura para proteger tu cuenta. Este paso es obligatorio.'
              : 'Actualiza tu contraseña de acceso cuando lo necesites.'}
          </p>
        </div>
        <div className="cp-side-grid" aria-hidden="true" />
      </div>

      {/* Formulario */}
      <div className="cp-main">
        <div className="cp-form-wrap">
          {isFirstEntry && (
            <div className="cp-stepper-mobile">
              <Stepper
                steps={ONBOARDING_STEPS}
                currentIndex={success ? 1 : 0}
                completed={success ? ['pass'] : []}
                orientation="horizontal"
              />
            </div>
          )}

          <div className="cp-form-header">
            <h1 className="cp-title">
              {isFirstEntry ? 'Crea tu contraseña' : 'Cambio de contraseña'}
            </h1>
            <p className="cp-subtitle">
              {isFirstEntry
                ? 'Tu contraseña actual es temporal. Por seguridad, debes crear una nueva.'
                : 'Ingresa tu contraseña actual y la nueva.'}
            </p>
          </div>

          {success ? (
            <div className="cp-success">
              <div className="cp-success-icon"><FiCheck size={28} strokeWidth={3} /></div>
              <p className="cp-success-title">¡Contraseña actualizada!</p>
              <p className="cp-success-sub">
                {isFirstEntry ? 'Continuando con el enrolamiento…' : 'Redirigiendo…'}
              </p>
            </div>
          ) : (
            <form className="cp-form" onSubmit={handleSubmit} noValidate>
              {capsLock && (
                <div className="cp-capslock">
                  <FiAlertCircle size={14} /> Bloq Mayús activado
                </div>
              )}

              <div className="form-group">
                <label className="form-label">Contraseña actual</label>
                <div className="cp-field">
                  <input
                    type={show.actual ? 'text' : 'password'}
                    className="form-input"
                    value={form.passwordActual}
                    onChange={e => setForm({ ...form, passwordActual: e.target.value })}
                    onKeyDown={handleCaps}
                    onKeyUp={handleCaps}
                    required
                    autoComplete="current-password"
                  />
                  <button type="button" className="cp-toggle" onClick={() => setShow(s => ({ ...s, actual: !s.actual }))} tabIndex={-1} aria-label={show.actual ? 'Ocultar' : 'Mostrar'}>
                    {show.actual ? <FiEyeOff size={16} /> : <FiEye size={16} />}
                  </button>
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">Nueva contraseña</label>
                <div className="cp-field">
                  <input
                    ref={newRef}
                    type={show.nuevo ? 'text' : 'password'}
                    className="form-input"
                    value={form.passwordNuevo}
                    onChange={e => setForm({ ...form, passwordNuevo: e.target.value })}
                    onKeyDown={handleCaps}
                    onKeyUp={handleCaps}
                    required
                    autoComplete="new-password"
                  />
                  <button type="button" className="cp-toggle" onClick={() => setShow(s => ({ ...s, nuevo: !s.nuevo }))} tabIndex={-1} aria-label={show.nuevo ? 'Ocultar' : 'Mostrar'}>
                    {show.nuevo ? <FiEyeOff size={16} /> : <FiEye size={16} />}
                  </button>
                </div>
                {form.passwordNuevo && <StrengthBar password={form.passwordNuevo} />}
                <div className="cp-rules">
                  <RuleCheck ok={minLen} label="Mínimo 6 caracteres" />
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">Confirmar nueva contraseña</label>
                <div className="cp-field">
                  <input
                    type={show.confirmar ? 'text' : 'password'}
                    className="form-input"
                    value={form.confirmarPassword}
                    onChange={e => setForm({ ...form, confirmarPassword: e.target.value })}
                    onKeyDown={handleCaps}
                    onKeyUp={handleCaps}
                    required
                    autoComplete="new-password"
                  />
                  <button type="button" className="cp-toggle" onClick={() => setShow(s => ({ ...s, confirmar: !s.confirmar }))} tabIndex={-1} aria-label={show.confirmar ? 'Ocultar' : 'Mostrar'}>
                    {show.confirmar ? <FiEyeOff size={16} /> : <FiEye size={16} />}
                  </button>
                </div>
                {form.confirmarPassword && (
                  <div className="cp-rules">
                    <RuleCheck ok={match} label="Las contraseñas coinciden" />
                  </div>
                )}
              </div>

              {error && (
                <div className="cp-error" role="alert">
                  <FiAlertCircle size={15} /> {error}
                </div>
              )}

              <div className="cp-actions">
                <button type="submit" className="btn btn-primary" disabled={loading || !canSubmit}>
                  {loading ? <span className="spinner" /> : null}
                  {loading ? 'Cambiando…' : 'Cambiar contraseña'}
                </button>
                {!isFirstEntry && (
                  <button type="button" className="btn btn-ghost" onClick={() => logout()}>
                    Cerrar sesión
                  </button>
                )}
              </div>
            </form>
          )}
        </div>
      </div>

      <style>{`
        .cp-root {
          min-height: 100vh;
          display: flex;
          background: var(--surface-bg);
        }
        /* ── Panel lateral ── */
        .cp-side {
          width: 340px;
          flex-shrink: 0;
          background: var(--cchc-navy);
          position: relative;
          overflow: hidden;
          display: flex;
          flex-direction: column;
        }
        .cp-side-inner {
          position: relative;
          z-index: 1;
          padding: var(--space-10) var(--space-8);
          display: flex;
          flex-direction: column;
          gap: var(--space-6);
          flex: 1;
        }
        .cp-side-grid {
          position: absolute;
          inset: 0;
          background-image:
            linear-gradient(rgba(0,110,220,0.08) 1px, transparent 1px),
            linear-gradient(90deg, rgba(0,110,220,0.08) 1px, transparent 1px);
          background-size: 28px 28px;
          pointer-events: none;
        }
        .cp-logo {
          display: flex;
          align-items: center;
          gap: 4px;
          font-family: var(--font-logo);
          font-size: var(--text-xl);
          font-weight: 700;
          text-decoration: none;
          letter-spacing: -0.02em;
        }
        .cp-logo-primary { color: #e8eefb; }
        .cp-logo-amp { color: #4d9fff; margin: 0 2px; }
        .cp-logo-secondary { color: #4d9fff; }
        .cp-user-info {
          display: flex;
          flex-direction: column;
          gap: 2px;
          padding: var(--space-3) var(--space-4);
          background: rgba(255,255,255,0.06);
          border-radius: var(--radius-md);
          border: 1px solid rgba(255,255,255,0.1);
        }
        .cp-user-name { font-size: var(--text-sm); font-weight: 600; color: #e8eefb; }
        .cp-user-email { font-size: var(--text-xs); color: rgba(232,238,251,0.6); }
        .cp-stepper-wrap { margin-top: var(--space-2); }
        .cp-side-hint {
          font-size: var(--text-sm);
          color: rgba(232,238,251,0.55);
          line-height: 1.6;
          margin-top: auto;
        }
        /* ── Área de formulario ── */
        .cp-main {
          flex: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: var(--space-8) var(--space-6);
        }
        .cp-form-wrap {
          width: 100%;
          max-width: 420px;
          display: flex;
          flex-direction: column;
          gap: var(--space-6);
        }
        .cp-stepper-mobile { display: none; }
        .cp-form-header { display: flex; flex-direction: column; gap: var(--space-1); }
        .cp-title {
          font-family: var(--font-display);
          font-size: var(--text-2xl);
          font-weight: 700;
          color: var(--text-primary);
          margin: 0;
        }
        .cp-subtitle { font-size: var(--text-sm); color: var(--text-secondary); margin: 0; line-height: 1.5; }
        .cp-form { display: flex; flex-direction: column; gap: var(--space-5); }
        .cp-field { position: relative; }
        .cp-field .form-input { padding-right: 42px; }
        .cp-toggle {
          position: absolute;
          right: 10px;
          top: 50%;
          transform: translateY(-50%);
          background: none;
          border: none;
          color: var(--text-muted);
          cursor: pointer;
          display: flex;
          align-items: center;
          padding: 4px;
          border-radius: var(--radius-sm);
          transition: color var(--transition-fast);
        }
        .cp-toggle:hover { color: var(--text-primary); }
        .cp-strength {
          display: flex;
          align-items: center;
          gap: var(--space-2);
          margin-top: var(--space-2);
        }
        .cp-strength-bars { display: flex; gap: 3px; }
        .cp-strength-bar {
          width: 36px;
          height: 3px;
          border-radius: 2px;
          background: var(--surface-hover);
          transition: background 0.3s;
        }
        .cp-strength-label { font-size: var(--text-xs); font-weight: 600; }
        .cp-rules {
          display: flex;
          flex-wrap: wrap;
          gap: var(--space-2);
          margin-top: var(--space-2);
        }
        .cp-rule {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          font-size: var(--text-xs);
          color: var(--text-muted);
          transition: color var(--transition-fast);
        }
        .cp-rule.ok { color: var(--success-500); }
        .cp-capslock {
          display: flex;
          align-items: center;
          gap: var(--space-1);
          font-size: var(--text-xs);
          color: var(--warning-600);
          padding: var(--space-2) var(--space-3);
          background: rgba(234,179,8,0.08);
          border: 1px solid rgba(234,179,8,0.2);
          border-radius: var(--radius-sm);
        }
        .cp-error {
          display: flex;
          align-items: center;
          gap: var(--space-2);
          font-size: var(--text-sm);
          color: var(--danger-500);
          padding: var(--space-3);
          background: rgba(244,67,54,0.08);
          border: 1px solid rgba(244,67,54,0.2);
          border-radius: var(--radius-sm);
        }
        .cp-actions { display: flex; flex-direction: column; gap: var(--space-2); padding-top: var(--space-2); }
        .cp-success {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: var(--space-3);
          padding: var(--space-10) 0;
          text-align: center;
        }
        .cp-success-icon {
          width: 56px; height: 56px;
          border-radius: 50%;
          background: rgba(34,197,94,0.12);
          color: var(--success-500);
          display: flex; align-items: center; justify-content: center;
        }
        .cp-success-title { font-family: var(--font-display); font-size: var(--text-xl); font-weight: 700; color: var(--text-primary); margin: 0; }
        .cp-success-sub { font-size: var(--text-sm); color: var(--text-secondary); margin: 0; }
        /* Accent line under logo on side panel */
        .cp-side::after {
          content: '';
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          height: 3px;
          background: var(--cchc-accent-line);
        }
        /* ── Responsive ── */
        @media (max-width: 768px) {
          .cp-side { display: none; }
          .cp-stepper-mobile { display: block; }
          .cp-main { padding: var(--space-6) var(--space-4); align-items: flex-start; }
        }
      `}</style>
    </div>
  );
}
