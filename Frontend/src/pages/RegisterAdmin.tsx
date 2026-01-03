import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { usersApi } from '../api/client';
import { FiShield, FiArrowRight, FiCheckCircle, FiCopy, FiCheck } from 'react-icons/fi';

export default function RegisterAdmin() {
    const navigate = useNavigate();
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [copied, setCopied] = useState(false);
    const [successData, setSuccessData] = useState<{ password?: string; rut: string } | null>(null);
    const [formData, setFormData] = useState({
        rut: '',
        nombre: '',
        apellido: '',
        email: ''
    });

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError('');

        try {
            const response = await usersApi.create({
                ...formData,
                rol: 'admin',
                cargo: 'Administrador General'
            });

            if (response.success && response.data) {
                setSuccessData({
                    password: (response.data as any).passwordTemporal,
                    rut: formData.rut
                });
            } else {
                setError(response.error || 'Error al crear el administrador inicial');
            }
        } catch {
            setError('Error de conexión con el servidor.');
        } finally {
            setLoading(false);
        }
    };

    const copyToClipboard = (text: string) => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    /* =======================
       VISTA ÉXITO (PREMIUM)
    ======================= */
    if (successData) {
        return (
            <div className="register-page">
                <div className="login-bg">
                    <div className="login-bg-gradient login-bg-gradient-1"></div>
                    <div className="login-bg-gradient login-bg-gradient-2"></div>
                    <div className="login-bg-gradient login-bg-gradient-3"></div>
                </div>

                <div className="register-content">
                    <div className="register-card text-center">
                        <div className="login-card-glow"></div>

                        <div className="success-icon">
                            <FiCheckCircle size={40} />
                        </div>

                        <h2 className="success-title">¡Administrador Creado!</h2>
                        <p className="success-subtitle">
                            Guarda estas credenciales en un lugar seguro. Solo se muestran una vez.
                        </p>

                        <div className="credentials-box text-left">
                            <div className="credential-row">
                                <span>RUT DEL ADMINISTRADOR</span>
                                <strong>{successData.rut}</strong>
                            </div>

                            <div className="credential-row">
                                <div className="flex items-center justify-between mb-2">
                                    <span>CONTRASEÑA TEMPORAL</span>
                                    <div className="bg-success-500/10 text-success-500 text-[9px] px-2 py-0.5 rounded-full font-black border border-success-500/20 uppercase tracking-widest flex items-center gap-1">
                                        Confidencial
                                    </div>
                                </div>
                                <div className="password-box group-hover:border-success-500/50 transition-all">
                                    <code>{successData.password || '******'}</code>
                                    <button
                                        onClick={() => copyToClipboard(successData.password || '')}
                                        className={copied ? 'copied' : ''}
                                        title="Copiar contraseña"
                                    >
                                        {copied ? <FiCheck size={20} /> : <FiCopy size={20} />}
                                    </button>
                                </div>
                            </div>
                        </div>

                        <button
                            onClick={() => navigate('/login')}
                            className="btn btn-primary btn-lg w-full register-btn mb-6"
                        >
                            <span>Ir al Login</span>
                            <FiArrowRight className="ml-2" />
                        </button>

                        <p className="form-info">
                            Se te solicitará cambiar esta contraseña en tu primer acceso.
                        </p>
                    </div>
                </div>

                {styles}
            </div>
        );
    }

    /* =======================
       FORMULARIO
    ======================= */
    return (
        <div className="register-page">
            {/* Fondo animado con gradientes (Igual que Login) */}
            <div className="login-bg">
                <div className="login-bg-gradient login-bg-gradient-1"></div>
                <div className="login-bg-gradient login-bg-gradient-2"></div>
                <div className="login-bg-gradient login-bg-gradient-3"></div>
            </div>

            <div className="register-content">
                <div className="register-header">
                    <div className="register-brand">
                        <div className="register-logo">
                            <div className="register-logo-icon">
                                <FiShield size={32} />
                            </div>
                            <div className="register-logo-shine"></div>
                        </div>
                    </div>
                    <h1>Configuración Inicial</h1>
                    <p>Crea el primer administrador del sistema</p>
                </div>

                <div className="register-card">
                    <div className="login-card-glow"></div>
                    <form onSubmit={handleSubmit} className="register-form">
                        <div className="form-grid">
                            <div className="form-group full-width">
                                <label>RUT</label>
                                <input
                                    type="text"
                                    placeholder="12.345.678-9"
                                    value={formData.rut}
                                    onChange={(e) => setFormData({ ...formData, rut: e.target.value })}
                                    required
                                />
                            </div>

                            <div className="form-group">
                                <label>NOMBRE</label>
                                <input
                                    type="text"
                                    placeholder="Juan"
                                    value={formData.nombre}
                                    onChange={(e) => setFormData({ ...formData, nombre: e.target.value })}
                                    required
                                />
                            </div>

                            <div className="form-group">
                                <label>APELLIDO</label>
                                <input
                                    type="text"
                                    placeholder="Pérez"
                                    value={formData.apellido}
                                    onChange={(e) => setFormData({ ...formData, apellido: e.target.value })}
                                    required
                                />
                            </div>

                            <div className="form-group full-width">
                                <label>EMAIL</label>
                                <input
                                    type="email"
                                    placeholder="admin@empresa.cl"
                                    value={formData.email}
                                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                                    required
                                />
                            </div>
                        </div>

                        {error && <div className="form-error">{error}</div>}

                        <button className="btn btn-primary btn-lg w-full register-btn" disabled={loading}>
                            {loading ? <div className="spinner mx-auto" /> : (
                                <>
                                    <span>Registrar Administrador</span>
                                    <FiArrowRight className="ml-2" />
                                </>
                            )}
                        </button>

                        <p className="form-info">
                            Este formulario se usa solo la primera vez para activar el sistema.
                        </p>
                    </form>
                </div>
            </div>

            {styles}
        </div>
    );
}

const styles = (
    <style>{`
.register-page {
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    position: relative;
    overflow: hidden;
    background: var(--surface-bg);
    padding: var(--space-4);
}

/* Fondo animado (Keep Login consistency) */
.login-bg {
    position: absolute;
    inset: 0;
    z-index: 0;
}

.login-bg-gradient {
    position: absolute;
    border-radius: 50%;
    filter: blur(100px);
    opacity: 0.3;
    animation: float 20s ease-in-out infinite;
}

.login-bg-gradient-1 { width: 600px; height: 600px; background: linear-gradient(135deg, var(--primary-600), var(--primary-400)); top: -200px; left: -200px; }
.login-bg-gradient-2 { width: 500px; height: 500px; background: linear-gradient(135deg, var(--accent-500), var(--accent-700)); bottom: -150px; right: -150px; animation-delay: -7s; }
.login-bg-gradient-3 { width: 400px; height: 400px; background: linear-gradient(135deg, var(--primary-500), var(--info-500)); top: 50%; left: 50%; transform: translate(-50%, -50%); animation-delay: -14s; }

@keyframes float {
    0%, 100% { transform: translate(0, 0) scale(1); }
    33% { transform: translate(50px, -50px) scale(1.1); }
    66% { transform: translate(-30px, 30px) scale(0.9); }
}

.register-content {
    position: relative;
    z-index: 1;
    width: 100%;
    max-width: 500px;
    animation: fadeInUp 0.6s ease-out;
}

@keyframes fadeInUp {
    from { opacity: 0; transform: translateY(30px); }
    to { opacity: 1; transform: translateY(0); }
}

.register-header {
    text-align: center;
    margin-bottom: 2.5rem;
}

.register-logo {
    position: relative;
    width: 64px;
    height: 64px;
    margin: 0 auto 1.25rem;
}

.register-logo-icon {
    position: relative;
    width: 100%;
    height: 100%;
    background: linear-gradient(135deg, var(--primary-500), var(--primary-700));
    border-radius: 16px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: white;
    box-shadow: 0 10px 30px rgba(76, 175, 80, 0.3);
}

.register-header h1 {
    font-size: 1.75rem;
    font-weight: 800;
    color: white;
    letter-spacing: -0.02em;
    margin-bottom: 0.5rem;
}

.register-header p {
    font-size: 0.9rem;
    color: var(--text-muted);
}

.register-card {
    position: relative;
    background: rgba(26, 26, 26, 0.7);
    backdrop-filter: blur(20px);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: var(--radius-xl);
    padding: 2.5rem;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
    overflow: hidden;
}

.login-card-glow {
    position: absolute;
    top: -50%;
    left: -50%;
    width: 200%;
    height: 200%;
    background: radial-gradient(circle, rgba(76, 175, 80, 0.1) 0%, transparent 70%);
    pointer-events: none;
}

.register-form {
    position: relative;
    z-index: 1;
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
}

.form-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1.25rem;
}

.form-group.full-width {
    grid-column: span 2;
}

.form-group label {
    font-size: 0.7rem;
    font-weight: 800;
    color: var(--text-muted);
    letter-spacing: 0.1em;
    margin-bottom: 0.5rem;
    display: block;
}

.form-group input {
    width: 100%;
    padding: 0.75rem 1rem;
    border-radius: 12px;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.1);
    color: white;
    font-size: 0.95rem;
    transition: all 0.2s;
}

.form-group input:focus {
    background: rgba(255, 255, 255, 0.08);
    border-color: var(--primary-500);
    outline: none;
    box-shadow: 0 0 0 4px rgba(76, 175, 80, 0.15);
}

.register-btn {
    margin-top: 0.5rem;
}

.form-error {
    background: rgba(244, 67, 54, 0.1);
    border: 1px solid rgba(244, 67, 54, 0.2);
    color: var(--danger-400);
    padding: 0.75rem;
    border-radius: 10px;
    font-size: 0.85rem;
    text-align: center;
}

.form-info {
    font-size: 0.75rem;
    text-align: center;
    color: var(--text-muted);
}

/* SUCCESS VIEW */
.success-icon {
    width: 80px;
    height: 80px;
    background: rgba(76, 175, 80, 0.1);
    color: var(--success-500);
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    margin: 0 auto 1.5rem;
    box-shadow: 0 0 40px rgba(76, 175, 80, 0.2);
}

.success-title {
    font-size: 1.75rem;
    font-weight: 800;
    color: white;
    margin-bottom: 0.5rem;
}

.success-subtitle {
    color: var(--text-muted);
    font-size: 0.95rem;
    margin-bottom: 2.5rem;
}

.credentials-box {
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 20px;
    padding: 1.75rem;
    margin-bottom: 2rem;
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
}

.credential-row {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
}

.credential-row span {
    font-size: 0.7rem;
    font-weight: 800;
    color: var(--text-muted);
    letter-spacing: 0.1em;
}

.credential-row strong {
    font-size: 1.2rem;
    color: white;
}

.password-box {
    display: flex;
    align-items: center;
    justify-content: space-between;
    background: rgba(76, 175, 80, 0.08);
    border: 1px solid rgba(76, 175, 80, 0.2);
    padding: 1rem 1.25rem;
    border-radius: 14px;
}

.password-box code {
    font-size: 1.5rem;
    font-family: var(--font-mono);
    font-weight: 800;
    color: var(--success-400);
    letter-spacing: 0.05em;
}

.password-box button {
    background: rgba(76, 175, 80, 0.15);
    color: var(--success-400);
    border: none;
    width: 40px;
    height: 40px;
    border-radius: 10px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: all 0.2s;
}

.password-box button:hover {
    background: var(--success-500);
    color: white;
    transform: scale(1.05);
}

@media (max-width: 480px) {
    .register-card { padding: 1.5rem; }
    .form-grid { grid-template-columns: 1fr; }
    .form-group.full-width { grid-column: span 1; }
    .password-box code { font-size: 1.25rem; }
}
`}</style>
);

