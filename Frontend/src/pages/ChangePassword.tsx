import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { authApi } from '../api/client';
import { FiEye, FiEyeOff, FiCheck, FiX, FiAlertCircle } from 'react-icons/fi';
import { OnboardingShell } from '../components/ui';
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
  // En el primer ingreso no se pide la contraseña actual (ya se validó al iniciar sesión).
  const canSubmit = (isFirstEntry || form.passwordActual) && minLen && match;

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
    <OnboardingShell
      user={user}
      steps={ONBOARDING_STEPS}
      currentIndex={success ? 1 : 0}
      completed={success ? ['pass'] : []}
      sideHint={isFirstEntry
        ? 'Crea una contraseña segura para proteger tu cuenta. Este paso es obligatorio.'
        : 'Actualiza tu contraseña de acceso cuando lo necesites.'}
    >
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

              {!isFirstEntry && (
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
              )}

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
    </OnboardingShell>
  );
}
