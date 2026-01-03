import { useState, useEffect } from 'react';
import Header from '../components/Header';
import { usersApi, type User } from '../api/client';
import {
    FiUserPlus,
    FiShield,
    FiCheckCircle,
    FiAlertCircle,
    FiEdit2,
    FiArrowRight,
    FiUsers,
    FiLock,
    FiX,
    FiSave,
    FiCheck,
    FiBriefcase,
    FiStar
} from 'react-icons/fi';
import ConfirmModal from '../components/ConfirmModal';

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
    const [showEditModal, setShowEditModal] = useState(false);
    const [editingUser, setEditingUser] = useState<User | null>(null);
    const [editForm, setEditForm] = useState({
        nombre: '',
        apellido: '',
        email: '',
        cargo: '',
        estado: '' as 'pendiente' | 'activo' | 'suspendido'
    });

    // Confirmation Modal State
    const [confirmModal, setConfirmModal] = useState<{
        isOpen: boolean;
        title: string;
        message: string;
        userId?: string;
    }>({
        isOpen: false,
        title: '',
        message: ''
    });

    // Success notification after password reset
    const [resetResult, setResetResult] = useState<{
        rut: string;
        passwordTemporal: string;
        emailNotificado: boolean;
    } | null>(null);

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

    const handleResetPassword = (userId: string) => {
        const user = users.find(u => u.userId === userId);
        setConfirmModal({
            isOpen: true,
            title: '¿Resetear contraseña?',
            message: `Se generará una nueva contraseña temporal para ${user?.nombre} ${user?.apellido}. El acceso actual será invalidado.`,
            userId
        });
    };

    const confirmResetPassword = async () => {
        const userId = confirmModal.userId;
        if (!userId) return;

        setConfirmModal(prev => ({ ...prev, isOpen: false }));
        setLoading(true);
        try {
            const response = await usersApi.resetPassword(userId);
            if (response.success && response.data) {
                const user = users.find(u => u.userId === userId);
                setResetResult({
                    rut: user?.rut || '',
                    passwordTemporal: response.data.passwordTemporal,
                    emailNotificado: !!(response.data as any).emailNotificado
                });
            } else {
                setError(response.error || 'Error al resetear contraseña');
            }
        } catch (err) {
            setError('Error de conexión al resetear contraseña');
        } finally {
            setLoading(false);
        }
    };

    const openEditModal = (user: User) => {
        setEditingUser(user);
        setEditForm({
            nombre: user.nombre,
            apellido: user.apellido || '',
            email: user.email || '',
            cargo: (user as any).cargo || '',
            estado: user.estado
        });
        setShowEditModal(true);
    };

    const handleUpdateUser = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!editingUser) return;

        setLoading(true);
        try {
            const response = await usersApi.update(editingUser.userId, editForm);
            if (response.success) {
                setShowEditModal(false);
                setEditingUser(null);
                fetchUsers();
            } else {
                setError(response.error || 'Error al actualizar usuario');
            }
        } catch (err) {
            setError('Error de conexión');
        } finally {
            setLoading(false);
        }
    };

    return (
        <>
            <Header title="Gestión de Usuarios" />
            <div className="page-content">
                <div className="page-header">
                    <div className="page-header-info">
                        <h2 className="page-header-title">
                            <FiUsers className="text-primary-500" />
                            Usuarios del Sistema
                        </h2>
                        <p className="page-header-description">Administre el acceso, roles y permisos de los usuarios de su empresa.</p>
                    </div>
                    <div className="page-header-actions">
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
                </div>

                {creadoResult && (
                    <div className="alert alert-success mb-6 shadow-lg border-success-500/20">
                        <div className="flex items-start gap-3">
                            <div className="bg-success-500/20 p-2 rounded-lg">
                                <FiCheckCircle size={24} className="text-success-500" />
                            </div>
                            <div className="flex-1">
                                <div className="flex justify-between items-start">
                                    <h3 className="font-bold text-lg">Usuario creado con éxito</h3>
                                    <button onClick={() => setCreadoResult(null)} className="text-text-muted hover:text-text-primary">
                                        <FiX />
                                    </button>
                                </div>
                                <p className="text-sm text-text-secondary mt-1">Entregue estas credenciales al usuario para su primer acceso:</p>
                                <div className="mt-3 bg-surface-elevated border border-success-500/20 p-4 rounded-xl font-mono flex justify-between items-center">
                                    <div>
                                        <span className="text-[10px] uppercase text-text-muted block mb-1">RUT</span>
                                        <span className="font-bold">{creadoResult.user.rut}</span>
                                    </div>
                                    <div className="text-right">
                                        <span className="text-[10px] uppercase text-text-muted block mb-1">Pass Temporal</span>
                                        <strong className="text-xl text-primary-500">{creadoResult.password}</strong>
                                    </div>
                                </div>
                                <p className="mt-3 text-xs text-text-muted italic flex items-center gap-2">
                                    <FiAlertCircle size={12} />
                                    El usuario deberá cambiar esta contraseña al iniciar sesión.
                                </p>
                            </div>
                        </div>
                    </div>
                )}

                {resetResult && (
                    <div className="alert alert-warning mb-6 shadow-lg border-warning-500/20">
                        <div className="flex items-start gap-3">
                            <div className="bg-warning-500/20 p-2 rounded-lg">
                                <FiLock size={24} className="text-warning-500" />
                            </div>
                            <div className="flex-1">
                                <div className="flex justify-between items-start">
                                    <h3 className="font-bold text-lg">Contraseña Reseteada</h3>
                                    <button onClick={() => setResetResult(null)} className="text-text-muted hover:text-text-primary">
                                        <FiX />
                                    </button>
                                </div>
                                <p className="text-sm text-text-secondary mt-1">Se ha generado una nueva clave de acceso:</p>
                                <div className="mt-3 bg-surface-elevated border border-warning-500/20 p-4 rounded-xl font-mono flex justify-between items-center">
                                    <div>
                                        <span className="text-[10px] uppercase text-text-muted block mb-1">RUT</span>
                                        <span className="font-bold">{resetResult.rut}</span>
                                    </div>
                                    <div className="text-right">
                                        <span className="text-[10px] uppercase text-text-muted block mb-1">Nueva Clave</span>
                                        <strong className="text-xl text-warning-500">{resetResult.passwordTemporal}</strong>
                                    </div>
                                </div>
                                {resetResult.emailNotificado && (
                                    <p className="mt-3 text-xs text-success-500 flex items-center gap-2">
                                        <FiCheck size={12} />
                                        Se envió una notificación automática al email del usuario.
                                    </p>
                                )}
                            </div>
                        </div>
                    </div>
                )}

                {error && <div className="alert alert-danger mb-6">{error}</div>}

                <div className="card">
                    <div className="scroll-hint">
                        <FiArrowRight />
                        <span>Desliza para ver más</span>
                    </div>

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
                                                <button
                                                    className="btn btn-secondary btn-sm"
                                                    title="Editar"
                                                    onClick={() => openEditModal(u)}
                                                >
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
                                    <label className="form-label flex items-center gap-2">
                                        <FiBriefcase size={14} className="text-text-muted" />
                                        Cargo
                                    </label>
                                    <input
                                        type="text"
                                        className="form-input"
                                        placeholder="Ej: Operador de Maquinaria"
                                        value={newUser.cargo}
                                        onChange={(e) => setNewUser({ ...newUser, cargo: e.target.value })}
                                    />
                                    <span className="form-hint">Si se deja vacío, se usará el nombre del rol</span>
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
                                        <div className="role-card-icon">
                                            <FiUsers size={24} />
                                        </div>
                                        <span className="role-card-title">Trabajador</span>
                                        <span className="role-card-desc">Acceso básico para firmar documentos y actividades</span>
                                    </button>
                                    <button
                                        type="button"
                                        className={`role-card ${newUser.rol === 'prevencionista' ? 'selected' : ''}`}
                                        onClick={() => setNewUser({ ...newUser, rol: 'prevencionista' })}
                                    >
                                        <div className="role-card-icon">
                                            <FiShield size={24} />
                                        </div>
                                        <span className="role-card-title">Prevencionista</span>
                                        <span className="role-card-desc">Gestión de documentos, actividades y prevención</span>
                                    </button>
                                    <button
                                        type="button"
                                        className={`role-card ${newUser.rol === 'admin' ? 'selected' : ''}`}
                                        onClick={() => setNewUser({ ...newUser, rol: 'admin' })}
                                    >
                                        <div className="role-card-icon">
                                            <FiStar size={24} />
                                        </div>
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

            {/* Modal de Edición */}
            {showEditModal && editingUser && (
                <div className="modal-overlay">
                    <div className="modal-content max-w-md">
                        <div className="modal-header">
                            <div className="modal-header-icon" style={{ background: 'linear-gradient(135deg, var(--info-500), var(--info-600))' }}>
                                <FiEdit2 size={24} />
                            </div>
                            <h2 className="modal-title">Editar Usuario</h2>
                            <p className="modal-subtitle">{editingUser.nombre} {editingUser.apellido}</p>
                        </div>

                        <form onSubmit={handleUpdateUser} className="modal-body">
                            <div className="form-section">
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="form-group">
                                        <label className="form-label">Nombre</label>
                                        <input
                                            type="text"
                                            className="form-input"
                                            value={editForm.nombre}
                                            onChange={(e) => setEditForm({ ...editForm, nombre: e.target.value })}
                                            required
                                        />
                                    </div>
                                    <div className="form-group">
                                        <label className="form-label">Apellido</label>
                                        <input
                                            type="text"
                                            className="form-input"
                                            value={editForm.apellido}
                                            onChange={(e) => setEditForm({ ...editForm, apellido: e.target.value })}
                                        />
                                    </div>
                                </div>
                                <div className="form-group">
                                    <label className="form-label">Email</label>
                                    <input
                                        type="email"
                                        className="form-input"
                                        value={editForm.email}
                                        onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
                                    />
                                </div>
                                <div className="form-group">
                                    <label className="form-label">Cargo</label>
                                    <input
                                        type="text"
                                        className="form-input"
                                        value={editForm.cargo}
                                        onChange={(e) => setEditForm({ ...editForm, cargo: e.target.value })}
                                    />
                                </div>
                                <div className="form-group">
                                    <label className="form-label">Estado</label>
                                    <select
                                        className="form-input"
                                        value={editForm.estado}
                                        onChange={(e) => setEditForm({ ...editForm, estado: e.target.value as any })}
                                    >
                                        <option value="pendiente">Pendiente</option>
                                        <option value="activo">Activo</option>
                                        <option value="suspendido">Suspendido</option>
                                    </select>
                                </div>
                            </div>

                            <div className="modal-footer">
                                <button
                                    type="button"
                                    className="btn btn-secondary"
                                    onClick={() => { setShowEditModal(false); setEditingUser(null); }}
                                >
                                    <FiX className="mr-2" />
                                    Cancelar
                                </button>
                                <button
                                    type="submit"
                                    className="btn btn-primary"
                                    disabled={loading}
                                >
                                    {loading ? <div className="spinner" /> : (
                                        <>
                                            <FiSave className="mr-2" />
                                            Guardar Cambios
                                        </>
                                    )}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            <ConfirmModal
                isOpen={confirmModal.isOpen}
                title={confirmModal.title}
                message={confirmModal.message}
                confirmLabel="Resetear Contraseña"
                variant="warning"
                onConfirm={confirmResetPassword}
                onCancel={() => setConfirmModal(prev => ({ ...prev, isOpen: false }))}
            />

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
                    background: var(--surface-card);
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
