import { useState } from 'react';
import { Link } from 'react-router-dom';
import { authApi } from '../api/client';
import { FiUser, FiArrowLeft, FiCheckCircle } from 'react-icons/fi';

// Formatea el RUT mientras se escribe (igual que en el login).
const rutFormat = (raw: string) => {
    const clean = raw.replace(/[^0-9kK]/g, '').toUpperCase();
    if (clean.length < 2) return clean;
    const body = clean.slice(0, -1);
    const dv = clean.slice(-1);
    return body.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + '-' + dv;
};

export default function ForgotPassword() {
    const [rut, setRut] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    // El backend responde siempre genérico (anti-enumeración): mostramos un
    // mensaje de "revisa tu correo" sin confirmar si el RUT existe.
    const [sent, setSent] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!rut.trim()) { setError('Ingresa tu RUT'); return; }
        setLoading(true); setError('');
        try {
            const res = await authApi.forgotPassword(rut.trim());
            if (res.success) setSent(true);
            else setError(res.error || 'No se pudo procesar la solicitud');
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

                {sent ? (
                    <div className="auth-simple-success">
                        <FiCheckCircle size={40} className="auth-simple-success-icon" />
                        <h1 className="auth-simple-title">Revisa tu correo</h1>
                        <p className="auth-simple-sub">
                            Si el RUT está registrado y tiene un correo asociado, te enviamos
                            un enlace para restablecer tu contraseña. El enlace caduca en 30 minutos.
                        </p>
                        <Link to="/login" className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }}>
                            Volver al inicio de sesión
                        </Link>
                    </div>
                ) : (
                    <>
                        <h1 className="auth-simple-title">Recuperar contraseña</h1>
                        <p className="auth-simple-sub">
                            Ingresa tu RUT y te enviaremos un enlace a tu correo para crear una nueva contraseña.
                        </p>
                        <form onSubmit={handleSubmit} noValidate>
                            <div className="form-group">
                                <label className="form-label" htmlFor="fp-rut">RUT</label>
                                <div className="auth-simple-input-wrap">
                                    <FiUser size={14} className="auth-simple-input-icon" />
                                    <input
                                        id="fp-rut"
                                        className="form-input"
                                        style={{ paddingLeft: 34 }}
                                        placeholder="12.345.678-9"
                                        value={rut}
                                        onChange={(e) => setRut(rutFormat(e.target.value))}
                                        autoComplete="username"
                                        autoFocus
                                    />
                                </div>
                            </div>

                            {error && <p className="auth-simple-error" role="alert">{error}</p>}

                            <button type="submit" className="btn btn-primary" disabled={loading}
                                style={{ width: '100%', justifyContent: 'center', marginTop: 4 }}>
                                {loading ? 'Enviando…' : 'Enviar enlace'}
                            </button>
                        </form>
                        <Link to="/login" className="auth-simple-back">
                            <FiArrowLeft size={13} /> Volver al inicio de sesión
                        </Link>
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
                    font-size: 24px;
                    font-weight: 700;
                    display: flex;
                    gap: 6px;
                    justify-content: center;
                    margin-bottom: 24px;
                }
                .auth-simple-title {
                    font-size: 20px;
                    font-weight: 700;
                    color: var(--text-primary);
                    margin: 0 0 8px;
                    text-align: center;
                }
                .auth-simple-sub {
                    font-size: 13px;
                    color: var(--text-secondary);
                    line-height: 1.55;
                    margin: 0 0 24px;
                    text-align: center;
                }
                .auth-simple-input-wrap { position: relative; }
                .auth-simple-input-icon {
                    position: absolute;
                    left: 12px;
                    top: 50%;
                    transform: translateY(-50%);
                    color: var(--text-muted);
                }
                .auth-simple-error {
                    font-size: 13px;
                    color: var(--danger-500, #ef4444);
                    margin: 0 0 12px;
                }
                .auth-simple-back {
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    gap: 6px;
                    margin-top: 18px;
                    font-size: 13px;
                    color: var(--accent, #006edc);
                    text-decoration: none;
                }
                .auth-simple-back:hover { text-decoration: underline; }
                .auth-simple-success { text-align: center; }
                .auth-simple-success-icon { color: var(--success-500, #22c55e); margin-bottom: 12px; }
            `}</style>
        </div>
    );
}
