import { useState, useEffect } from 'react';
import Header from '../components/Header';
import { usersApi, type User } from '../api/client';
import { FiUserPlus, FiShield, FiLock, FiEdit2, FiCheckCircle, FiAlertCircle } from 'react-icons/fi';

export default function UserManagement() {
    const [users, setUsers] = useState<User[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [newUser, setNewUser] = useState({
        rut: '',
        nombre: '',
        apellido: '',
        email: '',
        rol: 'trabajador' as 'admin' | 'prevencionista' | 'trabajador',
        cargo: ''
    });
    const [creadoResult, setCreadoResult] = useState<{ password?: string; user: any } | null>(null);

    const fetchUsers = async () => {
        setLoading(true);
        try {
            const response = await usersApi.list();
            if (response.success && response.data) {
                setUsers(response.data.users);
            } else {
                setError(response.error || 'Error al cargar usuarios');
            }
        } catch (err) {
            setError('Error de conexión');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchUsers();
    }, []);

    const handleCreateUser = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        try {
            const response = await usersApi.create(newUser);
            if (response.success && response.data) {
                setCreadoResult({
                    password: (response.data as any).passwordTemporal,
                    user: response.data
                });
                setShowCreateModal(false);
                fetchUsers();
            } else {
                setError(response.error || 'Error al crear usuario');
            }
        } catch (err) {
            setError('Error de conexión');
        } finally {
            setLoading(false);
        }
    };

    const handleResetPassword = async (userId: string) => {
        if (!confirm('¿Está seguro de resetear la contraseña de este usuario?')) return;

        try {
            const response = await usersApi.resetPassword(userId);
            if (response.success && response.data) {
                alert(`Contraseña reseteada. Nueva contraseña temporal: ${response.data.passwordTemporal}`);
            }
        } catch (err) {
            alert('Error al resetear contraseña');
        }
    };

    return (
        <>
            <Header title="Gestión de Usuarios" />
            <div className="page-content">
                <div className="mb-6 flex justify-between items-center">
                    <div>
                        <h2 className="text-xl font-bold">Usuarios del Sistema</h2>
                        <p className="text-muted">Administre el acceso y roles de su empresa</p>
                    </div>
                    <button
                        className="btn btn-primary"
                        onClick={() => {
                            setCreadoResult(null);
                            setShowCreateModal(true);
                        }}
                    >
                        <FiUserPlus className="mr-2" />
                        Nuevo Usuario
                    </button>
                </div>

                {creadoResult && (
                    <div className="alert alert-success mb-6">
                        <div className="flex items-start gap-3">
                            <FiCheckCircle size={24} className="mt-1" />
                            <div>
                                <h3 className="font-bold">Usuario creado con éxito</h3>
                                <p>Entregue estas credenciales al usuario para su primer acceso:</p>
                                <div className="mt-2 bg-white/10 p-3 rounded font-mono">
                                    RUT: {creadoResult.user.rut} <br />
                                    CONTRASEÑA TEMPORAL: <strong className="text-xl text-primary-400">{creadoResult.password}</strong>
                                </div>
                                <p className="mt-2 text-sm italic">* El usuario deberá cambiar esta contraseña al iniciar sesión.</p>
                            </div>
                        </div>
                    </div>
                )}

                {error && <div className="alert alert-danger mb-6">{error}</div>}

                <div className="card">
                    <div className="table-container">
                        <table className="table">
                            <thead>
                                <tr>
                                    <th>Usuario</th>
                                    <th>Rol</th>
                                    <th>Estado</th>
                                    <th>Acceso</th>
                                    <th style={{ textAlign: 'right' }}>Acciones</th>
                                </tr>
                            </thead>
                            <tbody>
                                {loading && users.length === 0 ? (
                                    <tr>
                                        <td colSpan={5} className="text-center">
                                            <div className="spinner" style={{ margin: 'var(--space-4) auto' }} />
                                        </td>
                                    </tr>
                                ) : users.length === 0 ? (
                                    <tr>
                                        <td colSpan={5} className="text-center text-muted" style={{ padding: 'var(--space-8)' }}>
                                            No hay usuarios registrados
                                        </td>
                                    </tr>
                                ) : users.map((u) => (
                                    <tr key={u.userId}>
                                        <td>
                                            <div className="flex items-center gap-3">
                                                <div className="avatar avatar-sm" style={{ background: 'rgba(76, 175, 80, 0.15)', color: 'var(--primary-500)' }}>
                                                    {u.nombre[0]}{u.apellido?.[0] || u.nombre[1]}
                                                </div>
                                                <div>
                                                    <div style={{ fontWeight: 600 }}>{u.nombre} {u.apellido}</div>
                                                    <div className="text-muted" style={{ fontSize: 'var(--text-xs)', fontFamily: 'var(--font-mono)' }}>{u.rut}</div>
                                                </div>
                                            </div>
                                        </td>
                                        <td>
                                            <span className={`badge ${u.rol === 'admin' ? 'badge-primary' :
                                                u.rol === 'prevencionista' ? 'badge-warning' : 'badge-secondary'
                                                }`}>
                                                {u.rol}
                                            </span>
                                        </td>
                                        <td>
                                            <div className="flex items-center gap-2">
                                                {u.habilitado ? (
                                                    <FiShield style={{ color: 'var(--success-500)' }} />
                                                ) : (
                                                    <FiAlertCircle style={{ color: 'var(--warning-500)' }} />
                                                )}
                                                <span className="text-sm">{u.estado}</span>
                                            </div>
                                        </td>
                                        <td className="text-muted text-sm">
                                            {u.ultimoAcceso ? new Date(u.ultimoAcceso).toLocaleDateString() : 'Nunca'}
                                        </td>
                                        <td style={{ textAlign: 'right' }}>
                                            <div className="flex gap-2" style={{ justifyContent: 'flex-end' }}>
                                                <button
                                                    className="btn btn-secondary btn-sm"
                                                    title="Reset Contraseña"
                                                    onClick={() => handleResetPassword(u.userId)}
                                                >
                                                    <FiLock />
                                                </button>
                                                <button className="btn btn-secondary btn-sm" title="Editar">
                                                    <FiEdit2 />
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>

            {/* Modal de Creación Mejorado */}
            {showCreateModal && (
                <div className="modal-overlay">
                    <div className="modal-content max-w-lg">
                        <div className="modal-header">
                            <div className="modal-header-icon">
                                <FiUserPlus size={24} />
                            </div>
                            <h2 className="modal-title">Nuevo Usuario</h2>
                            <p className="modal-subtitle">Complete los datos para crear un nuevo usuario en el sistema</p>
                        </div>

                        <form onSubmit={handleCreateUser} className="modal-body">
                            {/* Sección: Datos Personales */}
                            <div className="form-section">
                                <h3 className="form-section-title">Datos Personales</h3>
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="form-group">
                                        <label className="form-label">Nombre *</label>
                                        <input
                                            type="text"
                                            className="form-input"
                                            placeholder="Juan"
                                            value={newUser.nombre}
                                            onChange={(e) => setNewUser({ ...newUser, nombre: e.target.value })}
                                            required
                                        />
                                    </div>
                                    <div className="form-group">
                                        <label className="form-label">Apellido *</label>
                                        <input
                                            type="text"
                                            className="form-input"
                                            placeholder="Pérez"
                                            value={newUser.apellido}
                                            onChange={(e) => setNewUser({ ...newUser, apellido: e.target.value })}
                                            required
                                        />
                                    </div>
                                </div>
                                <div className="form-group">
                                    <label className="form-label">RUT *</label>
                                    <input
                                        type="text"
                                        className="form-input"
                                        placeholder="12.345.678-9"
                                        value={newUser.rut}
                                        onChange={(e) => setNewUser({ ...newUser, rut: e.target.value })}
                                        required
                                    />
                                </div>
                                <div className="form-group">
                                    <label className="form-label">Email</label>
                                    <input
                                        type="email"
                                        className="form-input"
                                        placeholder="usuario@empresa.cl"
                                        value={newUser.email}
                                        onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
                                    />
                                    <span className="form-hint">Se notificará al usuario por email con sus credenciales</span>
                                </div>
                                <div className="form-group">
                                    <label className="form-label">Cargo</label>
                                    <input
                                        type="text"
                                        className="form-input"
                                        placeholder="Ej: Operador de Maquinaria"
                                        value={newUser.cargo}
                                        onChange={(e) => setNewUser({ ...newUser, cargo: e.target.value })}
                                    />
                                </div>
                            </div>

                            {/* Sección: Rol */}
                            <div className="form-section">
                                <h3 className="form-section-title">Rol en el Sistema</h3>
                                <div className="role-selector">
                                    <button
                                        type="button"
                                        className={`role-card ${newUser.rol === 'trabajador' ? 'selected' : ''}`}
                                        onClick={() => setNewUser({ ...newUser, rol: 'trabajador' })}
                                    >
                                        <span className="role-card-icon">👷</span>
                                        <span className="role-card-title">Trabajador</span>
                                        <span className="role-card-desc">Acceso básico para firmar documentos y actividades</span>
                                    </button>
                                    <button
                                        type="button"
                                        className={`role-card ${newUser.rol === 'prevencionista' ? 'selected' : ''}`}
                                        onClick={() => setNewUser({ ...newUser, rol: 'prevencionista' })}
                                    >
                                        <span className="role-card-icon">🛡️</span>
                                        <span className="role-card-title">Prevencionista</span>
                                        <span className="role-card-desc">Gestión de documentos, actividades y prevención</span>
                                    </button>
                                    <button
                                        type="button"
                                        className={`role-card ${newUser.rol === 'admin' ? 'selected' : ''}`}
                                        onClick={() => setNewUser({ ...newUser, rol: 'admin' })}
                                    >
                                        <span className="role-card-icon">👑</span>
                                        <span className="role-card-title">Administrador</span>
                                        <span className="role-card-desc">Acceso completo al sistema y gestión de usuarios</span>
                                    </button>
                                </div>
                            </div>

                            <div className="modal-footer">
                                <button
                                    type="button"
                                    className="btn btn-secondary"
                                    onClick={() => setShowCreateModal(false)}
                                >
                                    Cancelar
                                </button>
                                <button
                                    type="submit"
                                    className="btn btn-primary"
                                    disabled={loading || !newUser.nombre || !newUser.apellido || !newUser.rut}
                                >
                                    {loading ? <div className="spinner" /> : (
                                        <>
                                            <FiUserPlus className="mr-2" />
                                            Crear Usuario
                                        </>
                                    )}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            <style>{`
                .badge {
                    padding: 2px 8px;
                    border-radius: 9999px;
                    font-size: 12px;
                    font-weight: 600;
                    text-transform: uppercase;
                }
                .badge-primary { background: var(--primary-500); color: white; }
                .badge-warning { background: var(--warning-500); color: white; }
                .badge-secondary { background: var(--gray-600); color: white; }
                
                .modal-overlay {
                    position: fixed;
                    top: 0;
                    left: 0;
                    right: 0;
                    bottom: 0;
                    background: rgba(0,0,0,0.7);
                    backdrop-filter: blur(4px);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    z-index: 1000;
                    animation: fadeIn 0.2s ease-out;
                }
                
                @keyframes fadeIn {
                    from { opacity: 0; }
                    to { opacity: 1; }
                }
                
                .modal-content {
                    background: var(--surface-base);
                    border-radius: var(--radius-xl);
                    border: 1px solid var(--surface-border);
                    box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
                    width: 100%;
                    max-height: 90vh;
                    overflow-y: auto;
                    animation: slideUp 0.3s ease-out;
                }
                
                @keyframes slideUp {
                    from { opacity: 0; transform: translateY(20px); }
                    to { opacity: 1; transform: translateY(0); }
                }
                
                .modal-header {
                    text-align: center;
                    padding: var(--space-6);
                    border-bottom: 1px solid var(--surface-border);
                    background: var(--surface-elevated);
                }
                
                .modal-header-icon {
                    width: 56px;
                    height: 56px;
                    background: linear-gradient(135deg, var(--primary-500), var(--primary-600));
                    border-radius: 16px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    margin: 0 auto var(--space-3);
                    color: white;
                }
                
                .modal-title {
                    font-size: var(--text-xl);
                    font-weight: 700;
                    color: var(--text-primary);
                    margin-bottom: var(--space-1);
                }
                
                .modal-subtitle {
                    font-size: var(--text-sm);
                    color: var(--text-muted);
                }
                
                .modal-body {
                    padding: var(--space-6);
                }
                
                .modal-footer {
                    display: flex;
                    gap: var(--space-3);
                    justify-content: flex-end;
                    padding-top: var(--space-4);
                    border-top: 1px solid var(--surface-border);
                    margin-top: var(--space-4);
                }
                
                .form-section {
                    margin-bottom: var(--space-6);
                }
                
                .form-section-title {
                    font-size: var(--text-sm);
                    font-weight: 600;
                    color: var(--text-secondary);
                    text-transform: uppercase;
                    letter-spacing: 0.05em;
                    margin-bottom: var(--space-4);
                    padding-bottom: var(--space-2);
                    border-bottom: 1px solid var(--surface-border);
                }
                
                .form-hint {
                    font-size: 11px;
                    color: var(--text-muted);
                    margin-top: 4px;
                    display: block;
                }
                
                .role-selector {
                    display: grid;
                    grid-template-columns: repeat(3, 1fr);
                    gap: var(--space-3);
                }
                
                .role-card {
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    text-align: center;
                    padding: var(--space-4);
                    background: var(--surface-elevated);
                    border: 2px solid var(--surface-border);
                    border-radius: var(--radius-lg);
                    cursor: pointer;
                    transition: all 0.2s ease;
                }
                
                .role-card:hover {
                    border-color: var(--primary-400);
                    background: var(--surface-card);
                }
                
                .role-card.selected {
                    border-color: var(--primary-500);
                    background: rgba(76, 175, 80, 0.1);
                    box-shadow: 0 0 0 3px rgba(76, 175, 80, 0.2);
                }
                
                .role-card-icon {
                    font-size: 28px;
                    margin-bottom: var(--space-2);
                }
                
                .role-card-title {
                    font-size: var(--text-sm);
                    font-weight: 600;
                    color: var(--text-primary);
                    margin-bottom: var(--space-1);
                }
                
                .role-card-desc {
                    font-size: 10px;
                    color: var(--text-muted);
                    line-height: 1.4;
                }
                
                @media (max-width: 640px) {
                    .role-selector {
                        grid-template-columns: 1fr;
                    }
                }
            `}</style>
        </>
    );
}
