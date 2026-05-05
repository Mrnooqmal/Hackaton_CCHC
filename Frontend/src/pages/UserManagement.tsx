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
import { Modal } from '../components/ui';

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
                                        <span className="text-[10px] uppercase text-text-muted block mb-1">Pass Temporal </span>
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

            {/* Modal de Creacion */}
            <Modal
                isOpen={showCreateModal}
                onClose={() => setShowCreateModal(false)}
                title="Nuevo Usuario"
                subtitle="Complete los datos para crear un nuevo usuario en el sistema"
                size="lg"
                footer={
                    <>
                        <button type="button" className="btn btn-secondary" onClick={() => setShowCreateModal(false)}>Cancelar</button>
                        <button type="submit" form="create-user-form" className="btn btn-primary" disabled={loading || !newUser.nombre || !newUser.apellido || !newUser.rut}>
                            {loading ? <div className="spinner" /> : (<><FiUserPlus className="mr-2" />Crear Usuario</>)}
                        </button>
                    </>
                }
            >
                <form id="create-user-form" onSubmit={handleCreateUser}>
                    <div className="form-section">
                        <h3 className="form-section-title">Datos Personales</h3>
                        <div className="grid grid-cols-2 gap-4">
                            <div className="form-group">
                                <label className="form-label">Nombre *</label>
                                <input type="text" className="form-input" placeholder="Juan" value={newUser.nombre} onChange={(e) => setNewUser({ ...newUser, nombre: e.target.value })} required />
                            </div>
                            <div className="form-group">
                                <label className="form-label">Apellido *</label>
                                <input type="text" className="form-input" placeholder="Perez" value={newUser.apellido} onChange={(e) => setNewUser({ ...newUser, apellido: e.target.value })} required />
                            </div>
                        </div>
                        <div className="form-group">
                            <label className="form-label">RUT *</label>
                            <input type="text" className="form-input" placeholder="12.345.678-9" value={newUser.rut} onChange={(e) => setNewUser({ ...newUser, rut: e.target.value })} required />
                        </div>
                        <div className="form-group">
                            <label className="form-label">Email</label>
                            <input type="email" className="form-input" placeholder="usuario@empresa.cl" value={newUser.email} onChange={(e) => setNewUser({ ...newUser, email: e.target.value })} />
                            <span className="form-hint">Se notificara al usuario por email con sus credenciales</span>
                        </div>
                        <div className="form-group">
                            <label className="form-label flex items-center gap-2"><FiBriefcase size={14} className="text-text-muted" />Cargo</label>
                            <input type="text" className="form-input" placeholder="Ej: Operador de Maquinaria" value={newUser.cargo} onChange={(e) => setNewUser({ ...newUser, cargo: e.target.value })} />
                            <span className="form-hint">Si se deja vacio, se usara el nombre del rol</span>
                        </div>
                    </div>
                    <div className="form-section">
                        <h3 className="form-section-title">Rol en el Sistema</h3>
                        <div className="role-selector">
                            <button type="button" className={`role-card ${newUser.rol === 'trabajador' ? 'selected' : ''}`} onClick={() => setNewUser({ ...newUser, rol: 'trabajador' })}>
                                <div className="role-card-icon"><FiUsers size={24} /></div>
                                <span className="role-card-title">Trabajador</span>
                                <span className="role-card-desc">Acceso basico para firmar documentos y actividades</span>
                            </button>
                            <button type="button" className={`role-card ${newUser.rol === 'prevencionista' ? 'selected' : ''}`} onClick={() => setNewUser({ ...newUser, rol: 'prevencionista' })}>
                                <div className="role-card-icon"><FiShield size={24} /></div>
                                <span className="role-card-title">Prevencionista</span>
                                <span className="role-card-desc">Gestion de documentos, actividades y prevencion</span>
                            </button>
                            <button type="button" className={`role-card ${newUser.rol === 'admin' ? 'selected' : ''}`} onClick={() => setNewUser({ ...newUser, rol: 'admin' })}>
                                <div className="role-card-icon"><FiStar size={24} /></div>
                                <span className="role-card-title">Administrador</span>
                                <span className="role-card-desc">Acceso completo al sistema y gestion de usuarios</span>
                            </button>
                        </div>
                    </div>
                </form>
            </Modal>

            {/* Modal de Edicion */}
            <Modal
                isOpen={showEditModal && !!editingUser}
                onClose={() => { setShowEditModal(false); setEditingUser(null); }}
                title="Editar Usuario"
                subtitle={editingUser ? `${editingUser.nombre} ${editingUser.apellido}` : ''}
                footer={
                    <>
                        <button type="button" className="btn btn-secondary" onClick={() => { setShowEditModal(false); setEditingUser(null); }}><FiX className="mr-2" />Cancelar</button>
                        <button type="submit" form="edit-user-form" className="btn btn-primary" disabled={loading}>
                            {loading ? <div className="spinner" /> : (<><FiSave className="mr-2" />Guardar Cambios</>)}
                        </button>
                    </>
                }
            >
                <form id="edit-user-form" onSubmit={handleUpdateUser}>
                    <div className="form-section">
                        <div className="grid grid-cols-2 gap-4">
                            <div className="form-group">
                                <label className="form-label">Nombre</label>
                                <input type="text" className="form-input" value={editForm.nombre} onChange={(e) => setEditForm({ ...editForm, nombre: e.target.value })} required />
                            </div>
                            <div className="form-group">
                                <label className="form-label">Apellido</label>
                                <input type="text" className="form-input" value={editForm.apellido} onChange={(e) => setEditForm({ ...editForm, apellido: e.target.value })} />
                            </div>
                        </div>
                        <div className="form-group">
                            <label className="form-label">Email</label>
                            <input type="email" className="form-input" value={editForm.email} onChange={(e) => setEditForm({ ...editForm, email: e.target.value })} />
                        </div>
                        <div className="form-group">
                            <label className="form-label">Cargo</label>
                            <input type="text" className="form-input" value={editForm.cargo} onChange={(e) => setEditForm({ ...editForm, cargo: e.target.value })} />
                        </div>
                        <div className="form-group">
                            <label className="form-label">Estado</label>
                            <select className="form-input" value={editForm.estado} onChange={(e) => setEditForm({ ...editForm, estado: e.target.value as any })}>
                                <option value="pendiente">Pendiente</option>
                                <option value="activo">Activo</option>
                                <option value="suspendido">Suspendido</option>
                            </select>
                        </div>
                    </div>
                </form>
            </Modal>

            <ConfirmModal
                isOpen={confirmModal.isOpen}
                title={confirmModal.title}
                message={confirmModal.message}
                confirmLabel="Resetear Contraseña"
                variant="warning"
                onConfirm={confirmResetPassword}
                onCancel={() => setConfirmModal(prev => ({ ...prev, isOpen: false }))}
            />

        </>
    );
}
