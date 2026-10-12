import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { authApi } from '../api/client';
import {
  FiEye, FiEyeOff, FiCheck, FiLock, FiUser, FiArrowRight, FiArrowUp, FiLogOut,
  FiMonitor, FiEdit2, FiKey,
} from 'react-icons/fi';
import { AlertBanner, FieldSection, FormPage, PageHeader } from '../components/ui';
import '../css/AuthCard.css';
import '../css/cambio-password.css';

// Misma regla que valida el backend (POST /auth/change-password).
const MIN_PASSWORD = 6;

const PASOS_PRIMER_INGRESO = [
  { id: 'password', label: 'Contraseña' },
  { id: 'firma', label: 'Tu firma' },
];

type Campo = 'passwordActual' | 'passwordNuevo' | 'confirmarPassword';

/**
 * Cambio de contraseña con dos caras:
 *  - Primer ingreso (contraseña temporal o sin enrolar): pantalla completa con la
 *    tarjeta de acceso, como el login y el alta de empresa. No pide la actual.
 *  - Desde Configuración: página dentro del sistema, con secciones de formulario.
 * La lógica (validación, llamada y reemplazo de sesión) es la misma para ambas.
 */
export default function ChangePassword() {
  const { user, logout, updateUser, reemplazarSesion } = useAuth();
  const navigate = useNavigate();
  const isFirstEntry = user?.passwordTemporal === true || user?.habilitado === false;

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [errorActual, setErrorActual] = useState('');
  const [success, setSuccess] = useState(false);
  const [show, setShow] = useState({ passwordActual: false, passwordNuevo: false, confirmarPassword: false });
  const [capsLock, setCapsLock] = useState(false);
  const [form, setForm] = useState({ passwordActual: '', passwordNuevo: '', confirmarPassword: '' });

  const minLen = form.passwordNuevo.length >= MIN_PASSWORD;
  const match = form.passwordNuevo === form.confirmarPassword && form.confirmarPassword !== '';
  // En el primer ingreso no se pide la contraseña actual (ya se validó al iniciar sesión).
  const canSubmit = Boolean((isFirstEntry || form.passwordActual) && minLen && match);
  const requisitos = [
    { label: `${MIN_PASSWORD} caracteres o más`, ok: minLen },
    { label: 'Coinciden', ok: match },
  ];

  const handleCaps = (e: React.KeyboardEvent) => setCapsLock(e.getModifierState('CapsLock'));

  const cambiar = (campo: Campo, valor: string) => {
    setForm((f) => ({ ...f, [campo]: valor }));
    if (error) setError('');
    if (campo === 'passwordActual' && errorActual) setErrorActual('');
    if (success) setSuccess(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit || loading) return;
    setLoading(true); setError(''); setErrorActual('');
    // Se toma antes del cambio: al reemplazar la sesión el usuario se recalcula.
    const debeEnrolarse = !user?.habilitado;
    try {
      const response = await authApi.changePassword({
        personaId: user?.personaId || user?.userId || '',
        ...form,
      });
      if (response.success) {
        const d = response.data;
        if (d?.token && d.sessionId && d.expiresAt && d.user) {
          // El cambio revoca la sesión con la que se hizo y emite otra: hay que
          // usar la nueva desde ya, o lo siguiente (crear el PIN) sale con un
          // token que ya no vale.
          reemplazarSesion({ token: d.token, sessionId: d.sessionId, expiresAt: d.expiresAt, user: d.user });
        } else {
          updateUser({ passwordTemporal: false } as Parameters<typeof updateUser>[0]);
        }
        if (isFirstEntry) {
          // El siguiente paso del primer ingreso es crear la firma.
          navigate(debeEnrolarse ? '/enroll-me' : '/', { replace: true });
          return;
        }
        setForm({ passwordActual: '', passwordNuevo: '', confirmarPassword: '' });
        setShow({ passwordActual: false, passwordNuevo: false, confirmarPassword: false });
        setSuccess(true);
      } else if (response.error === 'Contraseña actual incorrecta') {
        setErrorActual('No es tu contraseña actual. Revisa mayúsculas y vuelve a intentarlo.');
      } else {
        setError(response.error || 'No se pudo cambiar la contraseña.');
      }
    } catch {
      setError('No pudimos conectar con el servidor. Revisa tu conexión e inténtalo de nuevo.');
    } finally {
      setLoading(false);
    }
  };

  const ojo = (campo: Campo) => (
    <button
      type="button"
      className={isFirstEntry ? 'lp-eye-btn' : 'cpw-ojo'}
      onClick={() => setShow((s) => ({ ...s, [campo]: !s[campo] }))}
      aria-label={show[campo] ? 'Ocultar contraseña' : 'Mostrar contraseña'}
    >
      {show[campo] ? <FiEyeOff size={15} /> : <FiEye size={15} />}
    </button>
  );

  const inputProps = (campo: Campo, autoComplete: string) => ({
    type: show[campo] ? 'text' : 'password',
    value: form[campo],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => cambiar(campo, e.target.value),
    onKeyDown: handleCaps,
    onKeyUp: handleCaps,
    onBlur: () => setCapsLock(false),
    autoComplete,
  });

  const listaRequisitos = (className: string) => (
    <ul className={className} aria-label="Requisitos de la contraseña">
      {requisitos.map((r) => (
        <li key={r.label} className={r.ok ? 'onb-req onb-req--ok' : 'onb-req'}>
          {r.ok ? <FiCheck size={11} strokeWidth={3} /> : <span className="onb-req-punto" />}
          {r.label}
          <span className="sr-only">{r.ok ? ' (cumplido)' : ' (pendiente)'}</span>
        </li>
      ))}
    </ul>
  );

  const Mayus = capsLock ? (
    <span className="cpw-mayus" role="status"><FiArrowUp size={11} strokeWidth={2.6} /> Bloq Mayús activado</span>
  ) : null;

  // ── Primer ingreso: tarjeta de acceso a pantalla completa ──────────────────
  if (isFirstEntry) {
    return (
      <div className="lp-root">
        <div className="lp-bg" aria-hidden="true" />
        <main className="lp-card">
          <div className="lp-head">
            <div className="lp-logo" aria-label="Build and Serve">
              <span className="lp-logo-build">Build</span>
              <span className="lp-logo-amp">&amp;</span>
              <span className="lp-logo-serve">Serve</span>
            </div>
            <div className="lp-divider" aria-hidden="true" />
          </div>

          <div className="lp-body">
            <ol className="onb-steps" style={{ gridTemplateColumns: `repeat(${PASOS_PRIMER_INGRESO.length}, minmax(0, 1fr))` }}
              aria-label="Pasos de tu primer ingreso">
              {PASOS_PRIMER_INGRESO.map((p, i) => (
                <li key={p.id} className={`onb-step onb-step--${i === 0 ? 'actual' : 'pendiente'}`}
                  aria-current={i === 0 ? 'step' : undefined}>
                  <span className="onb-step-bar" />
                  <span className="onb-step-label"><span className="onb-step-num">{i + 1}.</span>{p.label}</span>
                </li>
              ))}
            </ol>

            <h1 className="lp-title">Crea tu contraseña</h1>
            <p className="lp-hint">La que recibiste es temporal. Elige una propia para entrar desde ahora con tu RUT.</p>

            <form className="lp-form onb-form" onSubmit={handleSubmit} noValidate>
              <div className="lp-field">
                <label className="lp-label" htmlFor="cp-rut">Tu RUT</label>
                <div className="lp-input-wrap">
                  <span className="lp-input-icon"><FiUser size={15} /></span>
                  <input id="cp-rut" className="lp-input onb-input-fijo" type="text" readOnly
                    value={user?.rut || ''} autoComplete="username" />
                  <span className="onb-input-candado"><FiLock size={15} /></span>
                </div>
              </div>
              <div className="onb-row">
                <div className="lp-field">
                  <label className="lp-label" htmlFor="cp-nueva">Contraseña</label>
                  <div className="lp-input-wrap">
                    <span className="lp-input-icon"><FiLock size={15} /></span>
                    <input id="cp-nueva" className="lp-input lp-input--password" autoFocus
                      {...inputProps('passwordNuevo', 'new-password')} />
                    {ojo('passwordNuevo')}
                  </div>
                </div>
                <div className="lp-field">
                  <label className="lp-label" htmlFor="cp-repetir">Repite la contraseña</label>
                  <div className="lp-input-wrap">
                    <span className="lp-input-icon"><FiLock size={15} /></span>
                    <input id="cp-repetir" className="lp-input lp-input--password"
                      {...inputProps('confirmarPassword', 'new-password')} />
                    {ojo('confirmarPassword')}
                  </div>
                </div>
              </div>
              {listaRequisitos('onb-requisitos')}
              {Mayus}

              {error && <p className="lp-error" role="alert">{error}</p>}

              <button type="submit" className="lp-submit" disabled={!canSubmit || loading}>
                {loading ? <div className="lp-spinner" /> : <><span>Guardar contraseña</span><FiArrowRight size={15} /></>}
              </button>
            </form>
          </div>

          <div className="lp-foot">
            <button type="button" className="lp-foot-link" onClick={() => logout()} disabled={loading}>
              <FiLogOut size={14} /> Cerrar sesión
            </button>
            <span className="lp-foot-meta">Paso 1 de {PASOS_PRIMER_INGRESO.length}</span>
          </div>
        </main>
      </div>
    );
  }

  // ── Desde Configuración: página dentro del sistema ─────────────────────────
  return (
    <>
      <div className="page-content">
        <PageHeader
          banner
          title="Cambiar contraseña"
          description="Es la que usas para entrar con tu RUT. Tu PIN de firma no cambia."
        />
      </div>

      <FormPage
        maxWidth={960}
        onSubmit={handleSubmit}
        className="cpw-page"
        header={<></>}
        actions={
          <>
            {error ? (
              <span className="cpw-estado cpw-estado--error" role="alert">{error}</span>
            ) : (
              <span className="cpw-estado">
                {canSubmit ? 'Lista para guardar' : !form.passwordActual ? 'Escribe tu contraseña actual' : 'Faltan requisitos'}
              </span>
            )}
            <button type="button" className="btn btn-secondary" onClick={() => navigate('/configuracion')} disabled={loading}>
              {success ? 'Volver a Configuración' : 'Cancelar'}
            </button>
            <button type="submit" className="btn btn-primary" disabled={!canSubmit || loading}>
              {loading ? 'Cambiando…' : 'Cambiar contraseña'}
            </button>
          </>
        }
      >
        <div className="cpw-cols">
          <div className="cpw-main">
            {success && (
              <AlertBanner variant="success" message="Contraseña actualizada"
                onDismiss={() => setSuccess(false)}>
                Cerramos tu sesión en los demás dispositivos. En este sigues conectado; usa la nueva desde tu próximo ingreso.
              </AlertBanner>
            )}

            <FieldSection title="Tu acceso" description="Confirma que eres tú" inline>
              <div className="form-group">
                <label className="form-label" htmlFor="cpw-rut">RUT</label>
                <div className="cpw-fijo">
                  <input id="cpw-rut" className="form-input" value={user?.rut || ''} readOnly disabled
                    autoComplete="username" title="El RUT no se puede modificar." />
                  <FiLock size={13} aria-hidden="true" />
                </div>
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="cpw-actual">Contraseña actual</label>
                <div className="cpw-pass">
                  <input id="cpw-actual" className={`form-input${errorActual ? ' error' : ''}`}
                    aria-invalid={errorActual ? true : undefined}
                    aria-describedby={errorActual ? 'cpw-actual-error' : undefined}
                    {...inputProps('passwordActual', 'current-password')} />
                  {ojo('passwordActual')}
                </div>
                {errorActual && <span className="form-error" id="cpw-actual-error">{errorActual}</span>}
              </div>
            </FieldSection>

            <FieldSection title="Nueva contraseña" description={`Mínimo ${MIN_PASSWORD} caracteres`} inline>
              <div className="form-group">
                <label className="form-label" htmlFor="cpw-nueva">Nueva contraseña</label>
                <div className="cpw-pass">
                  <input id="cpw-nueva" className="form-input" {...inputProps('passwordNuevo', 'new-password')} />
                  {ojo('passwordNuevo')}
                </div>
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="cpw-repetir">Repite la nueva</label>
                <div className="cpw-pass">
                  <input id="cpw-repetir" className="form-input" {...inputProps('confirmarPassword', 'new-password')} />
                  {ojo('confirmarPassword')}
                </div>
              </div>
              <div className="cpw-fila-completa">
                {listaRequisitos('onb-requisitos cpw-requisitos')}
                {Mayus}
              </div>
            </FieldSection>
          </div>

          <aside className="cpw-ayuda" aria-label="Qué pasa al cambiarla">
            <span className="cpw-ayuda-rotulo">Al cambiarla</span>
            <ul>
              <li>
                <FiMonitor size={16} aria-hidden="true" />
                <div><b>Se cierran tus otras sesiones</b>
                  <span>Si entraste desde otro teléfono o computador, ahí tendrás que volver a ingresar.</span></div>
              </li>
              <li>
                <FiEdit2 size={16} aria-hidden="true" />
                <div><b>Tu PIN de firma sigue igual</b>
                  <span>Para cambiarlo usa “Cambiar PIN de firma” en Configuración.</span></div>
              </li>
              <li>
                <FiKey size={16} aria-hidden="true" />
                <div><b>¿No recuerdas la actual?</b>
                  <span>Cierra sesión y entra con “¿Olvidaste tu contraseña?”; te llega un enlace a tu correo.</span></div>
              </li>
            </ul>
          </aside>
        </div>
      </FormPage>
    </>
  );
}
