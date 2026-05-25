import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import Header from '../components/Header';
import { apiBaseUrl, personasApi, type PersonaResponse } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useObraContext } from '../context/ObraContext';
import ConfirmModal from '../components/ConfirmModal';
import { AlertBanner, CredentialCard } from '../components/ui';
import {
    FiUserPlus, FiShield, FiEdit2, FiAlertCircle,
    FiArrowRight, FiUsers, FiLock, FiX, FiSave,
    FiBriefcase, FiStar, FiSearch, FiEye, FiUpload, FiDownload
} from 'react-icons/fi';

const ROLE_CONFIG: Record<string, { label: string; color: string; icon: any; desc: string }> = {
    admin: { label: 'Administrador', color: 'var(--primary-500)', icon: FiStar, desc: 'Acceso completo al sistema' },
    jefe_obra: { label: 'Jefe de Obra', color: 'var(--success-500)', icon: FiBriefcase, desc: 'Gestiona su(s) obra(s) asignadas' },
    prevencionista: { label: 'Prevencionista', color: 'var(--warning-500)', icon: FiShield, desc: 'Gestión de prevención y documentos' },
    supervisor: { label: 'Supervisor', color: 'var(--info-500)', icon: FiEye, desc: 'Supervisión de trabajadores y actividades' },
    trabajador: { label: 'Trabajador', color: 'var(--gray-500)', icon: FiUsers, desc: 'Acceso básico para firmas y documentos' },
};

export default function PersonasManagement() {
    const { user, hasPermission } = useAuth();
    const { selectedObraId, selectedObra } = useObraContext();
    const tenantId = user?.tenantId || user?.empresaId || localStorage.getItem('tenant_id') || '';
    const isAdmin = user?.rol === 'admin';
    const isObraScoped = Boolean(user && !isAdmin);
    const isMissingObra = isObraScoped && !selectedObraId;
    const canCreatePersonas = isAdmin;
    const canBulkUpload = isAdmin;
    const canManageObra = hasPermission('gestionar_obras');

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

    // Bulk upload
    const [showBulkUpload, setShowBulkUpload] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [uploadResult, setUploadResult] = useState<any | null>(null);
    const [uploadError, setUploadError] = useState('');
    const [uploadFile, setUploadFile] = useState<File | null>(null);
    const [sendWelcomeEmail, setSendWelcomeEmail] = useState(false);
    const fileInputRef = useRef<HTMLInputElement | null>(null);

    const fetchPersonas = async () => {
        if (!tenantId) {
            setPersonas([]);
            setLoading(false);
            return;
        }
        if (isMissingObra) {
            setPersonas([]);
            setLoading(false);
            return;
        }
        setLoading(true);
        try {
            const filters: any = {};
            if (filterRol) filters.rol = filterRol;
            if (isObraScoped && selectedObraId) filters.obraId = selectedObraId;
            const res = await personasApi.list(tenantId, filters);
            if (res.success && res.data) {
                setPersonas(res.data.personas || []);
            } else {
                setError(res.error || 'Error al cargar personas');
            }
        } catch { setError('Error de conexión'); }
        finally { setLoading(false); }
    };

    useEffect(() => { fetchPersonas(); }, [tenantId, filterRol, selectedObraId, isObraScoped]);

    const handleCreate = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!canCreatePersonas) {
            setError('No tienes permisos para crear personas.');
            return;
        }
        setLoading(true);
        try {
            const obraIds = isObraScoped && selectedObraId ? [selectedObraId] : undefined;
            const res = await personasApi.create(tenantId, {
                ...newPersona,
                obraIds,
                tieneAccesoWeb: newPersona.tieneAccesoWeb || newPersona.rol === 'admin' || newPersona.rol === 'jefe_obra' || newPersona.rol === 'prevencionista'
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

    const readFileAsBase64 = (file: File) => new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            const result = typeof reader.result === 'string' ? reader.result : '';
            const base64 = result.includes('base64,') ? result.split('base64,')[1] : result;
            resolve(base64);
        };
        reader.onerror = () => reject(new Error('No se pudo leer el archivo'));
        reader.readAsDataURL(file);
    });

    const handleDownloadTemplate = async () => {
        setUploadError('');
        try {
            const token = localStorage.getItem('auth_token');
            const params = new URLSearchParams();
            if (tenantId) params.set('tenantId', tenantId);
            const url = `${apiBaseUrl}/personas/plantilla${params.toString() ? `?${params}` : ''}`;

            const response = await fetch(url, {
                headers: token ? { Authorization: `Bearer ${token}` } : undefined
            });

            if (!response.ok) {
                setUploadError('No fue posible descargar la plantilla');
                return;
            }

            const blob = await response.blob();
            const link = document.createElement('a');
            link.href = URL.createObjectURL(blob);
            link.download = 'plantilla_personas.xlsx';
            document.body.appendChild(link);
            link.click();
            link.remove();
            URL.revokeObjectURL(link.href);
        } catch {
            setUploadError('Error al descargar la plantilla');
        }
    };

    const handleBulkUpload = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!canBulkUpload) {
            setUploadError('Solo administradores pueden usar la carga masiva.');
            return;
        }
        if (!uploadFile) {
            setUploadError('Selecciona un archivo Excel');
            return;
        }

        setUploading(true);
        setUploadError('');
        setUploadResult(null);

        try {
            const fileBase64 = await readFileAsBase64(uploadFile);
            const res = await personasApi.bulkUpload(tenantId, {
                fileBase64,
                fileName: uploadFile.name,
                sendWelcomeEmail
            });

            if (res.success && res.data) {
                setUploadResult(res.data);
                fetchPersonas();
            } else {
                setUploadError(res.error || 'Error en la carga masiva');
            }
        } catch {
            setUploadError('Error de conexión');
        } finally {
            setUploading(false);
            if (fileInputRef.current) fileInputRef.current.value = '';
            setUploadFile(null);
        }
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

    const pageTitle = isObraScoped ? 'Equipo de Obra' : 'Personas de la Empresa';
    const pageDescription = isObraScoped
        ? selectedObra
            ? `Personas asignadas a ${selectedObra.nombre}.`
            : 'Selecciona una obra para ver el equipo asignado.'
        : 'Gestione todos los usuarios, roles y permisos desde un solo lugar.';
        const showAdminActions = isAdmin;

    return (
        <>
            <Header title={isObraScoped ? 'Equipo de Obra' : 'Gestión de Personas'} />
            <div className="page-content">
                <div className="page-header">
                    <div className="page-header-info">
                        <h2 className="page-header-title"><FiUsers className="text-primary-500" /> {pageTitle}</h2>
                        <p className="page-header-description">{pageDescription}</p>
                    </div>
                    {showAdminActions && (
                        <div className="page-header-actions">
                            <button
                                className="btn btn-secondary"
                                onClick={() => { setUploadResult(null); setUploadError(''); setSendWelcomeEmail(false); setShowBulkUpload(true); }}
                            >
                                <FiUpload /> Carga Masiva
                            </button>
                            <button
                                className="btn btn-primary"
                                onClick={() => { setCreateResult(null); setShowCreate(true); }}
                            >
                                <FiUserPlus /> Nueva Persona
                            </button>
                        </div>
                    )}
                </div>

                {isMissingObra && (
                    <AlertBanner
                        variant="warning"
                        message="Selecciona una obra en el encabezado para ver y gestionar el equipo asignado."
                    />
                )}

                {!isAdmin && selectedObraId && (
                    <AlertBanner
                        variant="info"
                        message="Las nuevas personas se crean a nivel empresa. Para sumar personas a esta obra, asigna personal desde la ficha de la obra."
                    >
                        {canManageObra && (
                            <Link to={`/obras/${selectedObraId}`} className="btn btn-secondary btn-sm" style={{ marginTop: 'var(--space-2)' }}>
                                Ir a Gestionar Obra
                            </Link>
                        )}
                    </AlertBanner>
                )}

                {/* Result Banners */}
                {createResult && (
                    <AlertBanner
                        variant="success"
                        message="Persona creada con éxito"
                        onDismiss={() => setCreateResult(null)}
                        autoDismissMs={0}
                    >
                        {createResult.password && (
                            <CredentialCard
                                rut={createResult.persona?.rut || ''}
                                password={createResult.password}
                                variant="primary"
                            />
                        )}
                    </AlertBanner>
                )}

                {resetResult && (
                    <AlertBanner
                        variant="warning"
                        message="Contraseña Reseteada"
                        onDismiss={() => setResetResult(null)}
                        autoDismissMs={0}
                    >
                        <CredentialCard
                            rut={resetResult.rut}
                            password={resetResult.passwordTemporal}
                            title="Nueva clave de acceso"
                            variant="warning"
                        />
                    </AlertBanner>
                )}

                {error && (
                    <AlertBanner
                        variant="error"
                        message={error}
                        onDismiss={() => setError('')}
                    />
                )}

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
                            <option value="jefe_obra">Jefe de Obra</option>
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
                                ) : isMissingObra ? (
                                    <tr><td colSpan={6} className="text-center text-muted" style={{ padding: 32 }}>Selecciona una obra para ver su equipo</td></tr>
                                ) : filtered.length === 0 ? (
                                    <tr><td colSpan={6} className="text-center text-muted" style={{ padding: 32 }}>No hay personas registradas</td></tr>
                                ) : filtered.map(p => (
                                    <tr key={p.personaId}>
                                        <td>
                                            <div className="flex items-center gap-3">
                                                <div className="avatar avatar-sm" style={{ background: ROLE_CONFIG[p.rol]?.color || 'var(--gray-500)', color: '#fff' }}>{p.nombre[0]}{(p.apellido || p.nombre)[0]}</div>
                                                <Link to={`/personas/${p.rut}`} style={{ color: 'inherit', textDecoration: 'none' }}>
                                                    <div style={{ fontWeight: 600 }}>{p.nombre} {p.apellido}</div>
                                                    <div className="text-muted" style={{ fontSize: 11, fontFamily: 'var(--font-mono)' }}>{p.rut}</div>
                                                </Link>
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

            {/* Bulk Upload Modal */}
            {showBulkUpload && canBulkUpload && (
                <div className="modal-overlay">
                    <div className="modal-content" style={{ maxWidth: 600 }}>
                        <div className="modal-header" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 8 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                                <div className="modal-header-icon" style={{ background: 'var(--info-500)', marginBottom: 0 }}><FiUpload size={24} /></div>
                                <h2 className="modal-title" style={{ marginBottom: 0 }}>Carga masiva de personas</h2>
                            </div>
                            <p className="modal-subtitle" style={{ marginTop: 0 }}>Descargue la plantilla, complete los datos y suba el Excel</p>
                        </div>
                        <form onSubmit={handleBulkUpload} className="modal-body">
                            <div className="form-section">
                                <h3 className="form-section-title">Plantilla</h3>
                                <p className="text-sm" style={{ marginBottom: 12 }}>Use la plantilla oficial para evitar errores en la carga.</p>
                                <button type="button" className="btn btn-secondary" onClick={handleDownloadTemplate}>
                                    <FiDownload /> Descargar plantilla
                                </button>
                            </div>
                            <div className="form-section">
                                <h3 className="form-section-title">Opciones</h3>
                                <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                    <input type="checkbox" checked={sendWelcomeEmail} onChange={e => setSendWelcomeEmail(e.target.checked)} />
                                    Enviar credenciales por email cuando aplique
                                </label>
                            </div>

                            {uploadError && <div className="alert alert-danger mb-4">{uploadError}</div>}
                            {uploadResult && (
                                <div className={`alert mb-4 ${uploadResult.resultados?.errores?.length > 0 ? 'alert-danger' : uploadResult.resultados?.duplicados?.length > 0 ? 'alert-warning' : 'alert-success'}`}>
                                    <div style={{ fontWeight: 700, marginBottom: 12, fontSize: '15px' }}>{uploadResult.mensaje}</div>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                            <span className="badge badge-success" style={{ width: 28, textAlign: 'center', display: 'inline-block' }}>{uploadResult.resultados?.creados?.length || 0}</span>
                                            <span className="text-sm font-medium">Usuarios creados exitosamente</span>
                                        </div>
                                        {(uploadResult.resultados?.duplicados?.length || 0) > 0 && (
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--warning-600)' }}>
                                                <span className="badge badge-warning" style={{ width: 28, textAlign: 'center', display: 'inline-block' }}>{uploadResult.resultados?.duplicados?.length || 0}</span>
                                                <span className="text-sm font-medium">Registros duplicados (ignorados)</span>
                                            </div>
                                        )}
                                        {(uploadResult.resultados?.errores?.length || 0) > 0 && (
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--danger-500)' }}>
                                                    <span className="badge badge-danger" style={{ width: 28, textAlign: 'center', display: 'inline-block' }}>{uploadResult.resultados?.errores?.length || 0}</span>
                                                    <span className="text-sm font-medium">Errores encontrados (filas omitidas)</span>
                                                </div>
                                                <div style={{ marginTop: '4px', maxHeight: '120px', overflowY: 'auto', fontSize: '12px', background: 'var(--surface-bg)', border: '1px solid var(--surface-border)', borderRadius: '6px', padding: '8px' }}>
                                                    <ul style={{ margin: 0, paddingLeft: '16px', color: 'var(--text-secondary)' }}>
                                                        {uploadResult.resultados?.errores?.map((err: any, idx: number) => (
                                                            <li key={idx} style={{ marginBottom: '4px' }}>
                                                                <strong>Fila {err.fila}:</strong> {err.error}
                                                            </li>
                                                        ))}
                                                    </ul>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}

                            <div className="form-section">
                                <h3 className="form-section-title">Archivo</h3>
                                <div className="form-group">
                                    <label className="form-label">Archivo Excel (.xlsx)</label>
                                    <div 
                                        className="file-upload-zone"
                                        onClick={() => fileInputRef.current?.click()}
                                    >
                                        <FiUpload size={28} style={{ marginBottom: 12, color: uploadFile ? 'var(--primary-500)' : 'var(--text-muted)', display: 'inline-block' }} />
                                        {uploadFile ? (
                                            <div style={{ fontWeight: 600, color: 'var(--primary-500)', fontSize: '14px' }}>{uploadFile.name}</div>
                                        ) : (
                                            <div style={{ color: 'var(--text-muted)', fontSize: '14px' }}>Haz clic aquí para seleccionar un archivo .xlsx</div>
                                        )}
                                    </div>
                                    <input
                                        ref={fileInputRef}
                                        type="file"
                                        accept=".xlsx"
                                        style={{ display: 'none' }}
                                        onChange={e => setUploadFile(e.target.files?.[0] || null)}
                                    />
                                </div>
                            </div>

                            <div className="modal-footer">
                                <button type="button" className="btn btn-secondary" onClick={() => setShowBulkUpload(false)}>Cancelar</button>
                                <button type="submit" className="btn btn-primary" disabled={uploading || !uploadFile}>
                                    {uploading ? <div className="spinner" /> : <><FiUpload /> Cargar archivo</>}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Create Modal */}
            {showCreate && canCreatePersonas && (
                <div className="modal-overlay">
                    <div className="modal-content" style={{ maxWidth: 560 }}>
                        <div className="modal-header" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 8 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                                <div className="modal-header-icon" style={{ background: 'var(--primary-500)', marginBottom: 0 }}><FiUserPlus size={24} /></div>
                                <h2 className="modal-title" style={{ marginBottom: 0 }}>Nueva Persona</h2>
                            </div>
                            <p className="modal-subtitle" style={{ marginTop: 0 }}>
                                {isObraScoped ? 'Agregue un nuevo miembro a la obra seleccionada' : 'Agregue un nuevo miembro a su empresa'}
                            </p>
                        </div>
                        <form onSubmit={handleCreate} className="modal-body">
                            <div className="form-section">
                                <h3 className="form-section-title">Rol en el Sistema</h3>
                                <div className="role-selector">
                                    {Object.entries(ROLE_CONFIG).map(([key, cfg]) => {
                                        const Icon = cfg.icon;
                                        return (
                                            <button key={key} type="button" className={`role-card ${newPersona.rol === key ? 'selected' : ''}`} onClick={() => setNewPersona({ ...newPersona, rol: key, cargo: key === 'trabajador' ? newPersona.cargo : '', tieneAccesoWeb: key === 'admin' || key === 'jefe_obra' || key === 'prevencionista' || key === 'supervisor' })}>
                                                <div className="role-card-icon"><Icon size={24} /></div>
                                                <span className="role-card-title">{cfg.label}</span>
                                                <span className="role-card-desc">{cfg.desc}</span>
                                            </button>
                                        );
                                    })}o
                                </div>
                            </div>
                            {newPersona.rol === 'trabajador' && (
                                <div className="form-group">
                                    <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                        <input type="checkbox" checked={newPersona.tieneAccesoWeb} onChange={e => setNewPersona({ ...newPersona, tieneAccesoWeb: e.target.checked })} />
                                        Habilitar acceso web (login con contraseña)
                                    </label>
                                </div>
                            )}
                            <div className="form-section">
                                <h3 className="form-section-title">Datos Personales</h3>
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="form-group"><label className="form-label">Nombre *</label><input type="text" className="form-input" value={newPersona.nombre} onChange={e => setNewPersona({ ...newPersona, nombre: e.target.value })} required /></div>
                                    <div className="form-group"><label className="form-label">Apellido</label><input type="text" className="form-input" value={newPersona.apellido} onChange={e => setNewPersona({ ...newPersona, apellido: e.target.value })} /></div>
                                </div>
                                <div className="form-group"><label className="form-label">RUT *</label><input type="text" className="form-input" placeholder="12.345.678-9" value={newPersona.rut} onChange={e => setNewPersona({ ...newPersona, rut: e.target.value })} required /></div>
                                <div className="form-group"><label className="form-label">Email</label><input type="email" className="form-input" value={newPersona.email} onChange={e => setNewPersona({ ...newPersona, email: e.target.value })} /><span className="form-hint">Si tiene acceso web, recibirá credenciales por email</span></div>
                                {newPersona.rol === 'trabajador' && (
                                    <div className="form-group"><label className="form-label"><FiBriefcase size={14} /> Cargo</label><input type="text" className="form-input" placeholder="Ej: Operador, Jefe de Obra..." value={newPersona.cargo} onChange={e => setNewPersona({ ...newPersona, cargo: e.target.value })} /></div>
                                )}
                            </div>
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
                .file-upload-zone { border: 2px dashed var(--surface-border); border-radius: 12px; padding: 32px 16px; text-align: center; cursor: pointer; transition: all 0.2s; background: var(--surface-elevated); }
                .file-upload-zone:hover { border-color: var(--primary-400); background: var(--surface-card); }
                @media (max-width: 640px) { .role-selector { grid-template-columns: 1fr; } }
            `}</style>
        </>
    );
}