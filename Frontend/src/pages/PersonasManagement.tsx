import { useState, useEffect } from 'react';
import Header from '../components/Header';
import { personasApi, type PersonaResponse } from '../api/client';
import { useAuth } from '../context/AuthContext';
import ConfirmModal from '../components/ConfirmModal';
import {
    FiUserPlus, FiShield, FiCheckCircle, FiAlertCircle, FiEdit2,
    FiArrowRight, FiUsers, FiLock, FiX, FiSave,
    FiBriefcase, FiStar, FiSearch, FiEye
} from 'react-icons/fi';

const ROLE_CONFIG: Record<string, { label: string; color: string; icon: any; desc: string }> = {
    admin: { label: 'Administrador', color: 'var(--primary-500)', icon: FiStar, desc: 'Acceso completo al sistema' },
    prevencionista: { label: 'Prevencionista', color: 'var(--warning-500)', icon: FiShield, desc: 'Gestión de prevención y documentos' },
    supervisor: { label: 'Supervisor', color: 'var(--info-500)', icon: FiEye, desc: 'Supervisión de trabajadores y actividades' },
    trabajador: { label: 'Trabajador', color: 'var(--gray-500)', icon: FiUsers, desc: 'Acceso básico para firmas y documentos' },
};

export default function PersonasManagement() {
    const { user } = useAuth();
    const tenantId = user?.tenantId || user?.empresaId || localStorage.getItem('tenant_id') || '';

    const [personas, setPersonas] = useState<PersonaResponse[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [searchTerm, setSearchTerm] = useState('');
    const [filterRol, setFilterRol] = useState('');

    // Create modal
    const [showCreate, setShowCreate] = useState(false);
    const [newPersona, setNewPersona] = useState({
        rut: '', nombre: '', apellido: '', email: '', cargo: '',
        rol: 'trabajador' as string, tieneAccesoWeb: false
    });
    const [createResult, setCreateResult] = useState<{ password?: string; persona: any } | null>(null);

    // Edit modal
    const [showEdit, setShowEdit] = useState(false);
    const [editing, setEditing] = useState<PersonaResponse | null>(null);
    const [editForm, setEditForm] = useState({ nombre: '', apellido: '', email: '', cargo: '', estado: '' as string });

    // Reset password
    const [confirmModal, setConfirmModal] = useState<{ isOpen: boolean; title: string; message: string; personaId?: string }>({ isOpen: false, title: '', message: '' });
    const [resetResult, setResetResult] = useState<{ rut: string; passwordTemporal: string } | null>(null);

    const fetchPersonas = async () => {
        setLoading(true);
        try {
            const filters: any = {};
            if (filterRol) filters.rol = filterRol;
            const res = await personasApi.list(tenantId, filters);
            if (res.success && res.data) {
                setPersonas(res.data.personas || []);
            } else {
                setError(res.error || 'Error al cargar personas');
            }
        } catch { setError('Error de conexión'); }
        finally { setLoading(false); }
    };

    useEffect(() => { if (tenantId) fetchPersonas(); }, [tenantId, filterRol]);

    const handleCreate = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        try {
            const res = await personasApi.create(tenantId, {
                ...newPersona,
                tieneAccesoWeb: newPersona.tieneAccesoWeb || newPersona.rol === 'admin' || newPersona.rol === 'prevencionista'
            });
            if (res.success && res.data) {
                setCreateResult({
                    password: typeof res.data.passwordTemporal === 'string' ? res.data.passwordTemporal : undefined,
                    persona: res.data.persona
                });
                setShowCreate(false);
                setNewPersona({ rut: '', nombre: '', apellido: '', email: '', cargo: '', rol: 'trabajador', tieneAccesoWeb: false });
                fetchPersonas();
            } else { setError(res.error || 'Error al crear persona'); }
        } catch { setError('Error de conexión'); }
        finally { setLoading(false); }
    };

    const openEdit = (p: PersonaResponse) => {
        setEditing(p);
        setEditForm({ nombre: p.nombre, apellido: p.apellido || '', email: p.email || '', cargo: p.cargo || '', estado: p.estado });
        setShowEdit(true);
    };

    const handleUpdate = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!editing) return;
        setLoading(true);
        try {
            const res = await personasApi.update(tenantId, editing.personaId, editForm as any);
            if (res.success) { setShowEdit(false); setEditing(null); fetchPersonas(); }
            else { setError(res.error || 'Error al actualizar'); }
        } catch { setError('Error de conexión'); }
        finally { setLoading(false); }
    };

    const handleResetPw = (p: PersonaResponse) => {
        setConfirmModal({
            isOpen: true, title: '¿Resetear contraseña?',
            message: `Se generará una nueva contraseña temporal para ${p.nombre} ${p.apellido}.`,
            personaId: p.personaId
        });
    };

    const confirmReset = async () => {
        const pid = confirmModal.personaId;
        if (!pid) return;
        setConfirmModal(prev => ({ ...prev, isOpen: false }));
        setLoading(true);
        try {
            const res = await personasApi.resetPassword(tenantId, pid);
            if (res.success && res.data) {
                const p = personas.find(x => x.personaId === pid);
                setResetResult({ rut: p?.rut || '', passwordTemporal: res.data.passwordTemporal });
            } else { setError(res.error || 'Error al resetear'); }
        } catch { setError('Error de conexión'); }
        finally { setLoading(false); }
    };

    const filtered = personas.filter(p => {
        const s = searchTerm.toLowerCase().replace(/[.-]/g, '');
        const rut = p.rut.toLowerCase().replace(/[.-]/g, '');
        return p.nombre.toLowerCase().includes(searchTerm.toLowerCase()) ||
            (p.apellido || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
            rut.includes(s);
    });

    const rolBadge = (rol: string) => {
        const cfg = ROLE_CONFIG[rol] || ROLE_CONFIG.trabajador;
        return <span style={{ background: cfg.color, color: '#fff', padding: '2px 10px', borderRadius: 99, fontSize: 11, fontWeight: 700, textTransform: 'uppercase' as const }}>{cfg.label}</span>;
    };

    return (
        <>
            <Header title="Gestión de Personas" />
            <div className="page-content">
                <div className="page-header">
                    <div className="page-header-info">
                        <h2 className="page-header-title"><FiUsers className="text-primary-500" /> Personas de la Empresa</h2>
                        <p className="page-header-description">Gestione todos los usuarios, roles y permisos desde un solo lugar.</p>
                    </div>
                    <div className="page-header-actions">
                        <button className="btn btn-primary" onClick={() => { setCreateResult(null); setShowCreate(true); }}>
                            <FiUserPlus /> Nueva Persona
                        </button>
                    </div>
                </div>

                {/* Result Banners */}
                {createResult && (
                    <div className="alert alert-success mb-6">
                        <div className="flex items-start gap-3">
                            <FiCheckCircle size={24} className="text-success-500" style={{ flexShrink: 0, marginTop: 2 }} />
                            <div className="flex-1">
                                <div className="flex justify-between items-start">
                                    <h3 className="font-bold text-lg">Persona creada con éxito</h3>
                                    <button onClick={() => setCreateResult(null)}><FiX /></button>
                                </div>
                                {createResult.password && (
                                    <>
                                        <p className="text-sm mt-1">Credenciales de acceso:</p>
                                        <div className="mt-2" style={{ background: 'var(--surface-elevated)', border: '1px solid rgba(76,175,80,0.2)', padding: 12, borderRadius: 12, fontFamily: 'var(--font-mono)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                            <div><span style={{ fontSize: 10, color: 'var(--text-muted)', display: 'block' }}>RUT</span><strong>{createResult.persona?.rut}</strong></div>
                                            <div style={{ textAlign: 'right' }}><span style={{ fontSize: 10, color: 'var(--text-muted)', display: 'block' }}>Pass Temporal</span><strong style={{ fontSize: 18, color: 'var(--primary-500)' }}>{createResult.password}</strong></div>
                                        </div>
                                        <p className="mt-2 text-xs text-muted flex items-center gap-1"><FiAlertCircle size={12} /> El usuario deberá cambiar esta contraseña al iniciar sesión.</p>
                                    </>
                                )}
                            </div>
                        </div>
                    </div>
                )}

                {resetResult && (
                    <div className="alert alert-warning mb-6">
                        <div className="flex items-start gap-3">
                            <FiLock size={24} className="text-warning-500" style={{ flexShrink: 0, marginTop: 2 }} />
                            <div className="flex-1">
                                <div className="flex justify-between items-start">
                                    <h3 className="font-bold text-lg">Contraseña Reseteada</h3>
                                    <button onClick={() => setResetResult(null)}><FiX /></button>
                                </div>
                                <div className="mt-2" style={{ background: 'var(--surface-elevated)', border: '1px solid rgba(234,179,8,0.2)', padding: 12, borderRadius: 12, fontFamily: 'var(--font-mono)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <div><span style={{ fontSize: 10, color: 'var(--text-muted)', display: 'block' }}>RUT</span><strong>{resetResult.rut}</strong></div>
                                    <div style={{ textAlign: 'right' }}><span style={{ fontSize: 10, color: 'var(--text-muted)', display: 'block' }}>Nueva Clave</span><strong style={{ fontSize: 18, color: 'var(--warning-500)' }}>{resetResult.passwordTemporal}</strong></div>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {error && <div className="alert alert-danger mb-6">{error} <button onClick={() => setError('')} style={{ float: 'right' }}><FiX /></button></div>}

                {/* Filters */}
                <div className="card mb-6">
                    <div className="flex items-center gap-4" style={{ flexWrap: 'wrap' }}>
                        <div style={{ position: 'relative', flex: 1, minWidth: 200 }}>
                            <input type="text" placeholder="Buscar por nombre o RUT..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} className="form-input" style={{ paddingLeft: 40 }} />
                            <FiSearch style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                        </div>
                        <select className="form-input" style={{ width: 180 }} value={filterRol} onChange={e => setFilterRol(e.target.value)}>
                            <option value="">Todos los roles</option>
                            <option value="admin">Administrador</option>
                            <option value="prevencionista">Prevencionista</option>
                            <option value="supervisor">Supervisor</option>
                            <option value="trabajador">Trabajador</option>
                        </select>
                    </div>
                </div>

                {/* Table */}
                <div className="card">
                    <div className="card-header">
                        <div><h2 className="card-title">Directorio de Personas</h2><p className="card-subtitle">{filtered.length} persona(s)</p></div>
                    </div>
                    <div className="scroll-hint"><FiArrowRight /><span>Desliza para ver más</span></div>
                    <div className="table-container">
                        <table className="table">
                            <thead><tr><th>Persona</th><th>Rol</th><th>Cargo</th><th>Estado</th><th>Acceso Web</th><th style={{ textAlign: 'right' }}>Acciones</th></tr></thead>
                            <tbody>
                                {loading && filtered.length === 0 ? (
                                    <tr><td colSpan={6} className="text-center"><div className="spinner" style={{ margin: '16px auto' }} /></td></tr>
                                ) : filtered.length === 0 ? (
                                    <tr><td colSpan={6} className="text-center text-muted" style={{ padding: 32 }}>No hay personas registradas</td></tr>
                                ) : filtered.map(p => (
                                    <tr key={p.personaId}>
                                        <td>
                                            <div className="flex items-center gap-3">
                                                <div className="avatar avatar-sm" style={{ background: ROLE_CONFIG[p.rol]?.color || 'var(--gray-500)', color: '#fff' }}>{p.nombre[0]}{(p.apellido || p.nombre)[0]}</div>
                                                <div>
                                                    <div style={{ fontWeight: 600 }}>{p.nombre} {p.apellido}</div>
                                                    <div className="text-muted" style={{ fontSize: 11, fontFamily: 'var(--font-mono)' }}>{p.rut}</div>
                                                </div>
                                            </div>
                                        </td>
                                        <td>{rolBadge(p.rol)}</td>
                                        <td className="text-sm">{p.cargo || '-'}</td>
                                        <td>
                                            <div className="flex items-center gap-2">
                                                {p.habilitado ? <FiShield style={{ color: 'var(--success-500)' }} /> : <FiAlertCircle style={{ color: 'var(--warning-500)' }} />}
                                                <span className="text-sm">{p.estado}</span>
                                            </div>
                                        </td>
                                        <td><span className={`badge badge-${p.tieneAccesoWeb ? 'success' : 'secondary'}`}>{p.tieneAccesoWeb ? 'Sí' : 'No'}</span></td>
                                        <td style={{ textAlign: 'right' }}>
                                            <div className="flex gap-2" style={{ justifyContent: 'flex-end' }}>
                                                {p.tieneAccesoWeb && <button className="btn btn-secondary btn-sm" title="Reset Contraseña" onClick={() => handleResetPw(p)}><FiLock /></button>}
                                                <button className="btn btn-secondary btn-sm" title="Editar" onClick={() => openEdit(p)}><FiEdit2 /></button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>

            {/* Create Modal */}
            {showCreate && (
                <div className="modal-overlay">
                    <div className="modal-content" style={{ maxWidth: 560 }}>
                        <div className="modal-header" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 8 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                                <div className="modal-header-icon" style={{ background: 'var(--primary-500)', marginBottom: 0 }}><FiUserPlus size={24} /></div>
                                <h2 className="modal-title" style={{ marginBottom: 0 }}>Nueva Persona</h2>
                            </div>
                            <p className="modal-subtitle" style={{ marginTop: 0 }}>Agregue un nuevo miembro a su empresa</p>
                        </div>
                        <form onSubmit={handleCreate} className="modal-body">
                            <div className="form-section">
                                <h3 className="form-section-title">Datos Personales</h3>
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="form-group"><label className="form-label">Nombre *</label><input type="text" className="form-input" value={newPersona.nombre} onChange={e => setNewPersona({ ...newPersona, nombre: e.target.value })} required /></div>
                                    <div className="form-group"><label className="form-label">Apellido</label><input type="text" className="form-input" value={newPersona.apellido} onChange={e => setNewPersona({ ...newPersona, apellido: e.target.value })} /></div>
                                </div>
                                <div className="form-group"><label className="form-label">RUT *</label><input type="text" className="form-input" placeholder="12.345.678-9" value={newPersona.rut} onChange={e => setNewPersona({ ...newPersona, rut: e.target.value })} required /></div>
                                <div className="form-group"><label className="form-label">Email</label><input type="email" className="form-input" value={newPersona.email} onChange={e => setNewPersona({ ...newPersona, email: e.target.value })} /><span className="form-hint">Si tiene acceso web, recibirá credenciales por email</span></div>
                                <div className="form-group"><label className="form-label"><FiBriefcase size={14} /> Cargo</label><input type="text" className="form-input" placeholder="Ej: Operador" value={newPersona.cargo} onChange={e => setNewPersona({ ...newPersona, cargo: e.target.value })} /></div>
                            </div>
                            <div className="form-section">
                                <h3 className="form-section-title">Rol en el Sistema</h3>
                                <div className="role-selector">
                                    {Object.entries(ROLE_CONFIG).map(([key, cfg]) => {
                                        const Icon = cfg.icon;
                                        return (
                                            <button key={key} type="button" className={`role-card ${newPersona.rol === key ? 'selected' : ''}`} onClick={() => setNewPersona({ ...newPersona, rol: key, tieneAccesoWeb: key === 'admin' || key === 'prevencionista' })}>
                                                <div className="role-card-icon"><Icon size={24} /></div>
                                                <span className="role-card-title">{cfg.label}</span>
                                                <span className="role-card-desc">{cfg.desc}</span>
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                            {(newPersona.rol === 'trabajador' || newPersona.rol === 'supervisor') && (
                                <div className="form-group">
                                    <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                        <input type="checkbox" checked={newPersona.tieneAccesoWeb} onChange={e => setNewPersona({ ...newPersona, tieneAccesoWeb: e.target.checked })} />
                                        Habilitar acceso web (login con contraseña)
                                    </label>
                                </div>
                            )}
                            <div className="modal-footer">
                                <button type="button" className="btn btn-secondary" onClick={() => setShowCreate(false)}>Cancelar</button>
                                <button type="submit" className="btn btn-primary" disabled={loading || !newPersona.nombre || !newPersona.rut}>{loading ? <div className="spinner" /> : <><FiUserPlus /> Crear Persona</>}</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Edit Modal */}
            {showEdit && editing && (
                <div className="modal-overlay">
                    <div className="modal-content" style={{ maxWidth: 480 }}>
                        <div className="modal-header">
                            <div className="modal-header-icon" style={{ background: 'linear-gradient(135deg, var(--info-500), var(--info-600))' }}><FiEdit2 size={24} /></div>
                            <h2 className="modal-title">Editar Persona</h2>
                            <p className="modal-subtitle">{editing.nombre} {editing.apellido} — {rolBadge(editing.rol)}</p>
                        </div>
                        <form onSubmit={handleUpdate} className="modal-body">
                            <div className="form-section">
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="form-group"><label className="form-label">Nombre</label><input type="text" className="form-input" value={editForm.nombre} onChange={e => setEditForm({ ...editForm, nombre: e.target.value })} required /></div>
                                    <div className="form-group"><label className="form-label">Apellido</label><input type="text" className="form-input" value={editForm.apellido} onChange={e => setEditForm({ ...editForm, apellido: e.target.value })} /></div>
                                </div>
                                <div className="form-group"><label className="form-label">Email</label><input type="email" className="form-input" value={editForm.email} onChange={e => setEditForm({ ...editForm, email: e.target.value })} /></div>
                                <div className="form-group"><label className="form-label">Cargo</label><input type="text" className="form-input" value={editForm.cargo} onChange={e => setEditForm({ ...editForm, cargo: e.target.value })} /></div>
                                <div className="form-group"><label className="form-label">Estado</label>
                                    <select className="form-input" value={editForm.estado} onChange={e => setEditForm({ ...editForm, estado: e.target.value })}>
                                        <option value="pendiente">Pendiente</option><option value="activo">Activo</option><option value="suspendido">Suspendido</option>
                                    </select>
                                </div>
                            </div>
                            <div className="modal-footer">
                                <button type="button" className="btn btn-secondary" onClick={() => { setShowEdit(false); setEditing(null); }}><FiX /> Cancelar</button>
                                <button type="submit" className="btn btn-primary" disabled={loading}>{loading ? <div className="spinner" /> : <><FiSave /> Guardar</>}</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            <ConfirmModal isOpen={confirmModal.isOpen} title={confirmModal.title} message={confirmModal.message} confirmLabel="Resetear Contraseña" variant="warning" onConfirm={confirmReset} onCancel={() => setConfirmModal(prev => ({ ...prev, isOpen: false }))} />

            <style>{`
                .role-selector { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; }
                .role-card { display: flex; flex-direction: column; align-items: center; text-align: center; padding: 16px; background: var(--surface-elevated); border: 2px solid var(--surface-border); border-radius: 12px; cursor: pointer; transition: all 0.2s; }
                .role-card:hover { border-color: var(--primary-400); background: var(--surface-card); }
                .role-card.selected { border-color: var(--primary-500); background: rgba(76,175,80,0.1); box-shadow: 0 0 0 3px rgba(76,175,80,0.2); }
                .role-card-icon { font-size: 28px; margin-bottom: 8px; }
                .role-card-title { font-size: 13px; font-weight: 600; color: var(--text-primary); margin-bottom: 4px; }
                .role-card-desc { font-size: 10px; color: var(--text-muted); line-height: 1.4; }
                .modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.7); backdrop-filter: blur(4px); display: flex; align-items: center; justify-content: center; z-index: 1000; animation: fadeIn .2s; }
                @keyframes fadeIn { from { opacity: 0 } to { opacity: 1 } }
                .modal-content { background: var(--surface-card); border-radius: var(--radius-xl); border: 1px solid var(--surface-border); box-shadow: 0 25px 50px -12px rgba(0,0,0,.5); width: 100%; max-height: 90vh; overflow-y: auto; animation: slideUp .3s; }
                @keyframes slideUp { from { opacity: 0; transform: translateY(20px) } to { opacity: 1; transform: translateY(0) } }
                .modal-header { text-align: center; padding: 24px; border-bottom: 1px solid var(--surface-border); background: var(--surface-elevated); }
                .modal-header-icon { width: 56px; height: 56px; border-radius: 16px; display: flex; align-items: center; justify-content: center; margin: 0 auto 12px; color: #fff; }
                .modal-title { font-size: 18px; font-weight: 700; color: var(--text-primary); margin-bottom: 4px; }
                .modal-subtitle { font-size: 13px; color: var(--text-muted); }
                .modal-body { padding: 24px; }
                .modal-footer { display: flex; gap: 12px; justify-content: flex-end; padding-top: 16px; border-top: 1px solid var(--surface-border); margin-top: 16px; }
                .form-section { margin-bottom: 24px; }
                .form-section-title { font-size: 13px; font-weight: 600; color: var(--text-secondary); text-transform: uppercase; letter-spacing: .05em; margin-bottom: 16px; padding-bottom: 8px; border-bottom: 1px solid var(--surface-border); }
                .form-hint { font-size: 11px; color: var(--text-muted); margin-top: 4px; display: block; }
                @media (max-width: 640px) { .role-selector { grid-template-columns: 1fr; } }
            `}</style>
        </>
    );
}
