import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { authApi } from '../api/client';
import { FiLock, FiEye, FiEyeOff, FiCheckCircle, FiAlertCircle } from 'react-icons/fi';

export default function ResetPassword() {
    const [searchParams] = useSearchParams();
    const navigate = useNavigate();
    const personaId = searchParams.get('pid') || '';
    const token = searchParams.get('token') || '';
    const linkValido = !!personaId && !!token;

    const [form, setForm] = useState({ passwordNuevo: '', confirmarPassword: '' });
    const [show, setShow] = useState({ nuevo: false, confirmar: false });
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [done, setDone] = useState(false);

    const minLen = form.passwordNuevo.length >= 6;
    const match = form.passwordNuevo === form.confirmarPassword && form.confirmarPassword !== '';
    const canSubmit = linkValido && minLen && match;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!canSubmit) return;
        setLoading(true); setError('');
        try {
            const res = await authApi.resetPassword({
                personaId, token,
                passwordNuevo: form.passwordNuevo,
                confirmarPassword: form.confirmarPassword,
            });
            if (res.success) {
                setDone(true);
                setTimeout(() => navigate('/login', { replace: true }), 2200);
            } else {
                setError(res.error || 'No se pudo restablecer la contraseña');
            }
        } catch {
            setError('Error de conexión con el servidor');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="auth-simple-page">
            <div className="auth-simple-card" role="main">
                <div className="auth-simple-logo" aria-label="Build and Serve">
                    <span style={{ color: 'var(--text-primary)' }}>Build</span>
                    <span style={{ color: 'var(--danger-500, #df3601)' }}>&amp;</span>
                    <span style={{ color: 'var(--text-primary)' }}>Serve</span>
                </div>

                {!linkValido ? (
                    <div className="auth-simple-success">
                        <FiAlertCircle size={40} style={{ color: 'var(--danger-500, #ef4444)', marginBottom: 12 }} />
                        <h1 className="auth-simple-title">Enlace inválido</h1>
                        <p className="auth-simple-sub">
                            El enlace de recuperación está incompleto o es inválido. Solicita uno nuevo.
                        </p>
                        <Link to="/recuperar-clave" className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }}>
                            Solicitar nuevo enlace
                        </Link>
                    </div>
                ) : done ? (
                    <div className="auth-simple-success">
                        <FiCheckCircle size={40} className="auth-simple-success-icon" />
                        <h1 className="auth-simple-title">¡Contraseña restablecida!</h1>
                        <p className="auth-simple-sub">Redirigiendo al inicio de sesión…</p>
                    </div>
                ) : (
                    <>
                        <h1 className="auth-simple-title">Nueva contraseña</h1>
                        <p className="auth-simple-sub">Crea una contraseña nueva y segura para tu cuenta.</p>
                        <form onSubmit={handleSubmit} noValidate>
                            <div className="form-group">
                                <label className="form-label">Nueva contraseña</label>
                                <div className="auth-simple-input-wrap">
                                    <FiLock size={14} className="auth-simple-input-icon" />
                                    <input
                                        type={show.nuevo ? 'text' : 'password'}
                                        className="form-input"
                                        style={{ paddingLeft: 34, paddingRight: 38 }}
                                        value={form.passwordNuevo}
                                        onChange={(e) => setForm({ ...form, passwordNuevo: e.target.value })}
                                        autoComplete="new-password"
                                        autoFocus
                                    />
                                    <button type="button" className="auth-simple-eye"
                                        onClick={() => setShow(s => ({ ...s, nuevo: !s.nuevo }))}
                                        tabIndex={-1} aria-label={show.nuevo ? 'Ocultar' : 'Mostrar'}>
                                        {show.nuevo ? <FiEyeOff size={15} /> : <FiEye size={15} />}
                                    </button>
                                </div>
                                {form.passwordNuevo && !minLen && (
                                    <span className="auth-simple-hint">Mínimo 6 caracteres</span>
                                )}
                            </div>

                            <div className="form-group">
                                <label className="form-label">Confirmar contraseña</label>
                                <div className="auth-simple-input-wrap">
                                    <FiLock size={14} className="auth-simple-input-icon" />
                                    <input
                                        type={show.confirmar ? 'text' : 'password'}
                                        className="form-input"
                                        style={{ paddingLeft: 34, paddingRight: 38 }}
                                        value={form.confirmarPassword}
                                        onChange={(e) => setForm({ ...form, confirmarPassword: e.target.value })}
                                        autoComplete="new-password"
                                    />
                                    <button type="button" className="auth-simple-eye"
                                        onClick={() => setShow(s => ({ ...s, confirmar: !s.confirmar }))}
                                        tabIndex={-1} aria-label={show.confirmar ? 'Ocultar' : 'Mostrar'}>
                                        {show.confirmar ? <FiEyeOff size={15} /> : <FiEye size={15} />}
                                    </button>
                                </div>
                                {form.confirmarPassword && !match && (
                                    <span className="auth-simple-hint">Las contraseñas no coinciden</span>
                                )}
                            </div>

                            {error && <p className="auth-simple-error" role="alert">{error}</p>}

                            <button type="submit" className="btn btn-primary" disabled={loading || !canSubmit}
                                style={{ width: '100%', justifyContent: 'center', marginTop: 4 }}>
                                {loading ? 'Guardando…' : 'Restablecer contraseña'}
                            </button>
                        </form>
                    </>
                )}
            </div>

            <style>{`
                .auth-simple-page {
                    min-height: 100vh;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    padding: 24px;
                    background: var(--surface-bg, #0f172a);
                }
                .auth-simple-card {
                    width: 100%;
                    max-width: 420px;
                    background: var(--surface-card, #fff);
                    border: 1px solid var(--surface-border, #e2e8f0);
                    border-radius: var(--radius-lg, 16px);
                    padding: 36px 32px;
                    box-shadow: 0 10px 40px rgba(0,0,0,0.18);
                }
                .auth-simple-logo {
                    font-size: 24px; font-weight: 700; display: flex; gap: 6px;
                    justify-content: center; margin-bottom: 24px;
                }
                .auth-simple-title {
                    font-size: 20px; font-weight: 700; color: var(--text-primary);
                    margin: 0 0 8px; text-align: center;
                }
                .auth-simple-sub {
                    font-size: 13px; color: var(--text-secondary); line-height: 1.55;
                    margin: 0 0 24px; text-align: center;
                }
                .auth-simple-input-wrap { position: relative; }
                .auth-simple-input-icon {
                    position: absolute; left: 12px; top: 50%;
                    transform: translateY(-50%); color: var(--text-muted);
                }
                .auth-simple-eye {
                    position: absolute; right: 10px; top: 50%; transform: translateY(-50%);
                    background: none; border: none; cursor: pointer; color: var(--text-muted);
                    display: flex; align-items: center;
                }
                .auth-simple-hint { font-size: 12px; color: var(--text-muted); margin-top: 4px; display: block; }
                .auth-simple-error { font-size: 13px; color: var(--danger-500, #ef4444); margin: 0 0 12px; }
                .auth-simple-success { text-align: center; }
                .auth-simple-success-icon { color: var(--success-500, #22c55e); margin-bottom: 12px; }
            `}</style>
        </div>
    );
}
