import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { FiUser, FiMail, FiCreditCard, FiShield, FiLock, FiClock, FiTool } from 'react-icons/fi';

const roleLabel = (role?: string) => {
    switch (role) {
        case 'admin': return 'Administrador';
        case 'jefe_obra': return 'Jefe de Obra';
        case 'supervisor': return 'Supervisor';
        case 'prevencionista': return 'Prevencionista';
        case 'trabajador': return 'Trabajador';
        default: return 'Usuario';
    }
};

export default function Settings() {
    const { user } = useAuth();
    const navigate = useNavigate();

    return (
        <>

            <div className="page-content">
                <div className="page-header">
                    <div className="page-header-info">
                        <h2 className="page-header-title">
                            <FiTool className="text-primary-500" />
                            Configuración
                        </h2>
                        <p className="page-header-description">Tu perfil y preferencias de la cuenta.</p>
                    </div>
                </div>

                {/* Perfil (solo lectura por ahora) */}
                <div className="card" style={{ padding: 'var(--space-5)', marginBottom: 'var(--space-4)' }}>
                    <h3 className="font-semibold" style={{ marginBottom: 'var(--space-4)' }}>Mi perfil</h3>
                    <div className="settings-grid">
                        <div className="settings-field">
                            <span className="settings-field-label"><FiUser size={14} /> Nombre</span>
                            <span className="settings-field-value">{[user?.nombre, user?.apellido].filter(Boolean).join(' ') || '—'}</span>
                        </div>
                        <div className="settings-field">
                            <span className="settings-field-label"><FiCreditCard size={14} /> RUT</span>
                            <span className="settings-field-value">{user?.rut || '—'}</span>
                        </div>
                        <div className="settings-field">
                            <span className="settings-field-label"><FiShield size={14} /> Rol</span>
                            <span className="settings-field-value">{roleLabel(user?.rol)}</span>
                        </div>
                        <div className="settings-field">
                            <span className="settings-field-label"><FiMail size={14} /> Email</span>
                            <span className="settings-field-value">{user?.email || '—'}</span>
                        </div>
                    </div>
                    <div style={{ marginTop: 'var(--space-4)' }}>
                        <button className="btn btn-secondary" onClick={() => navigate('/change-password')}>
                            <FiLock /> Cambiar contraseña
                        </button>
                    </div>
                </div>

                {/* Próximamente */}
                <div className="card settings-soon" style={{ padding: 'var(--space-6)' }}>
                    <div className="settings-soon-icon"><FiClock size={28} /></div>
                    <h3 className="font-semibold" style={{ margin: 'var(--space-3) 0 var(--space-1)' }}>Más opciones próximamente</h3>
                    <p className="text-muted" style={{ maxWidth: 460, margin: '0 auto' }}>
                        La edición de perfil, notificaciones, gestión de la empresa y preferencias de la
                        aplicación estarán disponibles en una próxima versión.
                    </p>
                </div>
            </div>

            <style>{`
                .settings-grid {
                    display: grid;
                    grid-template-columns: repeat(2, 1fr);
                    gap: var(--space-4);
                }
                .settings-field {
                    display: flex;
                    flex-direction: column;
                    gap: 4px;
                }
                .settings-field-label {
                    display: inline-flex;
                    align-items: center;
                    gap: var(--space-2);
                    font-size: var(--text-xs);
                    text-transform: uppercase;
                    letter-spacing: 0.04em;
                    color: var(--text-muted);
                }
                .settings-field-value {
                    font-size: var(--text-base);
                    color: var(--text-primary);
                    font-weight: 500;
                }
                .settings-soon {
                    text-align: center;
                }
                .settings-soon-icon {
                    width: 56px;
                    height: 56px;
                    border-radius: var(--radius-full);
                    background: var(--surface-elevated);
                    border: 1px solid var(--surface-border);
                    color: var(--text-muted);
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                }
                @media (max-width: 640px) {
                    .settings-grid { grid-template-columns: 1fr; }
                }
            `}</style>
        </>
    );
}
