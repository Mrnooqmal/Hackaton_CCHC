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

            {/* Modal de Creación */}
            {showCreateModal && (
                <div className="modal-overlay">
                    <div className="modal-content max-w-lg">
                        <div className="p-6">
                            <h2 className="text-xl font-bold mb-4">Crear Nuevo Usuario</h2>
                            <form onSubmit={handleCreateUser} className="space-y-4">
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="form-group">
                                        <label className="form-label">Nombre</label>
                                        <input
                                            type="text"
                                            className="form-input"
                                            value={newUser.nombre}
                                            onChange={(e) => setNewUser({ ...newUser, nombre: e.target.value })}
                                            required
                                        />
                                    </div>
                                    <div className="form-group">
                                        <label className="form-label">Apellido</label>
                                        <input
                                            type="text"
                                            className="form-input"
                                            value={newUser.apellido}
                                            onChange={(e) => setNewUser({ ...newUser, apellido: e.target.value })}
                                        />
                                    </div>
                                </div>
                                <div className="form-group">
                                    <label className="form-label">RUT</label>
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
                                    <label className="form-label">Rol</label>
                                    <select
                                        className="form-input form-select"
                                        value={newUser.rol}
                                        onChange={(e) => setNewUser({ ...newUser, rol: e.target.value as any })}
                                    >
                                        <option value="trabajador">Trabajador</option>
                                        <option value="prevencionista">Prevencionista</option>
                                        <option value="admin">Administrador</option>
                                    </select>
                                </div>
                                <div className="form-group">
                                    <label className="form-label">Email</label>
                                    <input
                                        type="email"
                                        className="form-input"
                                        value={newUser.email}
                                        onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
                                    />
                                </div>

                                <div className="flex gap-3 pt-4">
                                    <button
                                        type="button"
                                        className="btn btn-secondary flex-1"
                                        onClick={() => setShowCreateModal(false)}
                                    >
                                        Cancelar
                                    </button>
                                    <button
                                        type="submit"
                                        className="btn btn-primary flex-1"
                                        disabled={loading}
                                    >
                                        {loading ? <div className="spinner" /> : 'Crear Usuario'}
                                    </button>
                                </div>
                            </form>
                        </div>
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
                    background: rgba(0,0,0,0.5);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    z-index: 1000;
                }
                .modal-content {
                    background: var(--surface-base);
                    border-radius: var(--radius-lg);
                    width: 100%;
                }
            `}</style>
        </>
    );
}
