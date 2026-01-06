import { useState, useEffect, useRef } from 'react';
import Header from '../components/Header';
import {
    FiPlus,
    FiFileText,
    FiUsers,
    FiCheck,
    FiClock,
    FiSearch,
    FiFilter,
    FiUpload,
    FiDownload,
    FiX,
    FiEye,
    FiFile,
    FiTrash2,
    FiUserCheck,
    FiAlertCircle,
    FiCalendar
} from 'react-icons/fi';
import { documentsApi, workersApi, uploadsApi, type Document, type Worker } from '../api/client';
import { useAuth } from '../context/AuthContext';

const DOCUMENT_TYPES: Record<string, { label: string; color: string }> = {
    IRL: { label: 'Informe de Riesgos Laborales', color: 'var(--primary-500)' },
    POLITICA_SSO: { label: 'Política SSO', color: 'var(--info-500)' },
    REGLAMENTO_INTERNO: { label: 'Reglamento Interno', color: 'var(--warning-500)' },
    PROCEDIMIENTO_TRABAJO: { label: 'Procedimiento de Trabajo', color: 'var(--success-500)' },
    MATRIZ_MIPPER: { label: 'Matriz MIPPER', color: 'var(--danger-500)' },
    ENTREGA_EPP: { label: 'Entrega EPP', color: 'var(--success-500)' },
    CAPACITACION: { label: 'Capacitación', color: 'var(--info-500)' },
};

export default function Documents() {
    const { user } = useAuth();
    const [documents, setDocuments] = useState<Document[]>([]);
    const [workers, setWorkers] = useState<Worker[]>([]);
    const [loading, setLoading] = useState(true);
    const [showModal, setShowModal] = useState(false);
    const [showDetailModal, setShowDetailModal] = useState(false);
    const [showAssignModal, setShowAssignModal] = useState(false);
    const [selectedDocument, setSelectedDocument] = useState<Document | null>(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [filterType, setFilterType] = useState('');
    const [uploading, setUploading] = useState(false);
    const [creating, setCreating] = useState(false);
    const [assigning, setAssigning] = useState(false);
    const [notification, setNotification] = useState<{ message: string; type: 'success' | 'error' | 'info' | 'warning' } | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // New document form
    const [newDoc, setNewDoc] = useState({
        tipo: '',
        titulo: '',
        descripcion: '',
    });
    const [selectedFile, setSelectedFile] = useState<File | null>(null);

    // Assignment form
    const [assignmentType, setAssignmentType] = useState<'todos' | 'cargo' | 'personalizado'>('todos');
    const [selectedCargo, setSelectedCargo] = useState('');
    const [selectedWorkerIds, setSelectedWorkerIds] = useState<string[]>([]);

    const showNotification = (message: string, type: 'success' | 'error' | 'info' | 'warning' = 'info') => {
        setNotification({ message, type });
        setTimeout(() => setNotification(null), 5000);
    };

    useEffect(() => {
        loadData();
    }, []);

    const loadData = async () => {
        try {
            const [docsRes, workersRes] = await Promise.all([
                documentsApi.list(),
                workersApi.list()
            ]);

            if (docsRes.success && docsRes.data) {
                setDocuments(docsRes.data.documents);
            }
            if (workersRes.success && workersRes.data) {
                setWorkers(workersRes.data);
            }
        } catch (error) {
            console.error('Error loading data:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            // Validate file size (max 10MB)
            if (file.size > 10 * 1024 * 1024) {
                showNotification('El archivo es demasiado grande. Máximo 10MB.', 'error');
                return;
            }
            setSelectedFile(file);
        }
    };

    const uploadFile = async (): Promise<string | null> => {
        if (!selectedFile) return null;

        setUploading(true);
        try {
            // 1. Get presigned URL
            const urlRes = await uploadsApi.getUploadUrl({
                fileName: selectedFile.name,
                fileType: selectedFile.type,
                fileSize: selectedFile.size,
                categoria: 'documentos'
            });

            if (!urlRes.success || !urlRes.data) {
                throw new Error(urlRes.error || 'Error getting upload URL');
            }

            // 2. Upload file to S3
            const uploadRes = await fetch(urlRes.data.uploadUrl, {
                method: 'PUT',
                body: selectedFile,
                headers: {
                    'Content-Type': selectedFile.type
                }
            });

            if (!uploadRes.ok) {
                throw new Error('Error uploading file');
            }

            // 3. Confirm upload
            const confirmRes = await uploadsApi.confirmUpload({
                fileKey: urlRes.data.fileKey,
                fileName: selectedFile.name,
                fileType: selectedFile.type,
                fileSize: selectedFile.size
            });

            if (!confirmRes.success) {
                throw new Error(confirmRes.error || 'Error confirming upload');
            }

            return urlRes.data.fileKey;
        } catch (err) {
            console.error('Upload error:', err);
            showNotification('Error al subir el archivo', 'error');
            return null;
        } finally {
            setUploading(false);
        }
    };

    const handleCreateDocument = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newDoc.tipo || !newDoc.titulo) {
            showNotification('Por favor complete los campos obligatorios', 'warning');
            return;
        }

        setCreating(true);
        try {
            // Upload file if selected
            let fileKey: string | null = null;
            if (selectedFile) {
                fileKey = await uploadFile();
                if (!fileKey) {
                    setCreating(false);
                    return;
                }
            }

            // Create document
            const response = await documentsApi.create({
                ...newDoc,
                archivoUrl: fileKey || undefined,
                archivoNombre: selectedFile?.name || undefined,
                createdBy: user?.userId,
                creatorName: user ? `${user.nombre} ${user.apellido || ''}`.trim() : undefined
            });

            if (response.success && response.data) {
                setDocuments([response.data, ...documents]);
                setShowModal(false);
                resetForm();
                showNotification('Documento creado exitosamente', 'success');
            } else {
                showNotification(response.error || 'Error al crear documento', 'error');
            }
        } catch (error) {
            console.error('Error creating document:', error);
            showNotification('Error al crear documento', 'error');
        } finally {
            setCreating(false);
        }
    };

    const resetForm = () => {
        setNewDoc({ tipo: '', titulo: '', descripcion: '' });
        setSelectedFile(null);
        if (fileInputRef.current) {
            fileInputRef.current.value = '';
        }
    };

    const handleViewDetails = async (doc: Document) => {
        setSelectedDocument(doc);
        setShowDetailModal(true);
    };

    const handleOpenAssignModal = (doc: Document) => {
        setSelectedDocument(doc);
        setAssignmentType('todos');
        setSelectedCargo('');
        setSelectedWorkerIds([]);
        setShowAssignModal(true);
    };

    const handleAssign = async () => {
        if (!selectedDocument) return;

        let workerIdsToAssign: string[] = [];

        if (assignmentType === 'todos') {
            workerIdsToAssign = workers.filter(w => w.habilitado).map(w => w.workerId);
        } else if (assignmentType === 'cargo') {
            workerIdsToAssign = workers
                .filter(w => w.habilitado && w.cargo?.toLowerCase() === selectedCargo.toLowerCase())
                .map(w => w.workerId);
        } else {
            workerIdsToAssign = selectedWorkerIds;
        }

        if (workerIdsToAssign.length === 0) {
            showNotification('No hay trabajadores para asignar', 'warning');
            return;
        }

        setAssigning(true);
        try {
            const response = await documentsApi.assign(selectedDocument.documentId, {
                workerIds: workerIdsToAssign,
                assignedBy: user?.userId,
                assignerName: user ? `${user.nombre} ${user.apellido || ''}`.trim() : undefined
            });

            if (response.success) {
                showNotification(`Documento asignado a ${workerIdsToAssign.length} trabajadores`, 'success');
                setShowAssignModal(false);
                loadData(); // Refresh to get updated assignments
            } else {
                showNotification(response.error || 'Error al asignar documento', 'error');
            }
        } catch (error) {
            console.error('Error assigning document:', error);
            showNotification('Error al asignar documento', 'error');
        } finally {
            setAssigning(false);
        }
    };

    const handleDownloadFile = async (fileKey: string) => {
        try {
            const response = await uploadsApi.getDownloadUrl(fileKey);
            if (response.success && response.data?.downloadUrl) {
                window.open(response.data.downloadUrl, '_blank');
            } else {
                showNotification('Error al obtener el archivo', 'error');
            }
        } catch (error) {
            console.error('Error downloading file:', error);
            showNotification('Error al descargar archivo', 'error');
        }
    };

    const formatDateTime = (value?: string | null) => {
        if (!value) return '—';
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return value;
        return date.toLocaleString('es-CL', {
            dateStyle: 'medium',
            timeStyle: 'short',
        });
    };

    const toggleWorkerSelection = (workerId: string) => {
        setSelectedWorkerIds(prev =>
            prev.includes(workerId)
                ? prev.filter(id => id !== workerId)
                : [...prev, workerId]
        );
    };

    // Get unique cargos from workers
    const uniqueCargos = [...new Set(workers.map(w => w.cargo).filter(Boolean))] as string[];

    const filteredDocuments = documents.filter((doc) => {
        const matchesSearch = doc.titulo.toLowerCase().includes(searchTerm.toLowerCase());
        const matchesType = !filterType || doc.tipo === filterType;
        return matchesSearch && matchesType;
    });

    if (loading) {
        return (
            <div className="flex items-center justify-center" style={{ height: '100vh' }}>
                <div className="spinner" />
            </div>
        );
    }

    return (
        <>
            <Header title="Documentos" />

            {notification && (
                <div className={`notification notification-${notification.type}`} style={{
                    position: 'fixed',
                    top: '20px',
                    right: '20px',
                    zIndex: 10000,
                    padding: 'var(--space-4) var(--space-6)',
                    borderRadius: 'var(--radius-lg)',
                    background: notification.type === 'error' ? 'var(--danger-500)' :
                        notification.type === 'success' ? 'var(--success-500)' :
                            notification.type === 'warning' ? 'var(--warning-500)' : 'var(--primary-500)',
                    color: 'white',
                    boxShadow: 'var(--shadow-lg)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 'var(--space-3)',
                    animation: 'slideIn 0.3s ease-out'
                }}>
                    {notification.type === 'error' && <FiAlertCircle />}
                    {notification.type === 'success' && <FiCheck />}
                    <span>{notification.message}</span>
                </div>
            )}

            <div className="page-content">
                <div className="page-header">
                    <div className="page-header-info">
                        <h2 className="page-header-title">
                            <FiFileText className="text-primary-500" />
                            Gestión Documental Normativa
                        </h2>
                        <p className="page-header-description">
                            Control de políticas, reglamentos, procedimientos y matrices de riesgo.
                        </p>
                    </div>
                </div>

                {/* Actions */}
                <div className="card mb-6">
                    <div className="documents-actions-bar">
                        <div className="documents-filters">
                            <div style={{ position: 'relative', flex: 1, maxWidth: '300px' }}>
                                <input
                                    type="text"
                                    placeholder="Buscar documentos..."
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                    className="form-input"
                                    style={{ paddingLeft: '40px' }}
                                />
                                <FiSearch
                                    style={{
                                        position: 'absolute',
                                        left: '12px',
                                        top: '50%',
                                        transform: 'translateY(-50%)',
                                        color: 'var(--text-muted)'
                                    }}
                                />
                            </div>

                            <div style={{ position: 'relative' }}>
                                <select
                                    value={filterType}
                                    onChange={(e) => setFilterType(e.target.value)}
                                    className="form-input form-select"
                                    style={{ paddingLeft: '40px', minWidth: '200px' }}
                                >
                                    <option value="">Todos los tipos</option>
                                    {Object.entries(DOCUMENT_TYPES).map(([key, { label }]) => (
                                        <option key={key} value={key}>{label}</option>
                                    ))}
                                </select>
                                <FiFilter
                                    style={{
                                        position: 'absolute',
                                        left: '12px',
                                        top: '50%',
                                        transform: 'translateY(-50%)',
                                        color: 'var(--text-muted)'
                                    }}
                                />
                            </div>
                        </div>

                        <button className="btn btn-primary" onClick={() => setShowModal(true)}>
                            <FiPlus />
                            Nuevo Documento
                        </button>
                    </div>
                </div>

                {/* Stats */}
                <div className="grid grid-cols-4 mb-6">
                    <div className="card">
                        <div className="flex items-center gap-3">
                            <div className="avatar" style={{ background: 'var(--primary-500)' }}>
                                <FiFileText />
                            </div>
                            <div>
                                <div className="stat-value" style={{ fontSize: 'var(--text-2xl)' }}>
                                    {documents.length}
                                </div>
                                <div className="text-sm text-muted">Total Documentos</div>
                            </div>
                        </div>
                    </div>

                    <div className="card">
                        <div className="flex items-center gap-3">
                            <div className="avatar" style={{ background: 'var(--success-500)' }}>
                                <FiCheck />
                            </div>
                            <div>
                                <div className="stat-value" style={{ fontSize: 'var(--text-2xl)' }}>
                                    {documents.filter(d => d.firmas && d.firmas.length > 0).length}
                                </div>
                                <div className="text-sm text-muted">Con Firmas</div>
                            </div>
                        </div>
                    </div>

                    <div className="card">
                        <div className="flex items-center gap-3">
                            <div className="avatar" style={{ background: 'var(--warning-500)' }}>
                                <FiClock />
                            </div>
                            <div>
                                <div className="stat-value" style={{ fontSize: 'var(--text-2xl)' }}>
                                    {documents.filter(d => d.asignaciones?.some(a => a.estado === 'pendiente')).length}
                                </div>
                                <div className="text-sm text-muted">Pendientes</div>
                            </div>
                        </div>
                    </div>

                    <div className="card">
                        <div className="flex items-center gap-3">
                            <div className="avatar" style={{ background: 'var(--info-500)' }}>
                                <FiUsers />
                            </div>
                            <div>
                                <div className="stat-value" style={{ fontSize: 'var(--text-2xl)' }}>
                                    {documents.reduce((acc, d) => acc + (d.asignaciones?.length || 0), 0)}
                                </div>
                                <div className="text-sm text-muted">Asignaciones</div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Documents Grid */}
                {filteredDocuments.length === 0 ? (
                    <div className="card empty-state" style={{ padding: 'var(--space-12)' }}>
                        <div className="empty-state-icon-container" style={{
                            width: '80px',
                            height: '80px',
                            borderRadius: '50%',
                            background: 'var(--surface-elevated)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            margin: '0 auto var(--space-6)'
                        }}>
                            <FiFileText size={40} style={{ color: 'var(--text-muted)' }} />
                        </div>
                        <h3 className="empty-state-title" style={{ fontSize: 'var(--text-xl)', fontWeight: 'bold', marginBottom: 'var(--space-2)' }}>
                            No se encontraron documentos
                        </h3>
                        <p className="empty-state-description" style={{ color: 'var(--text-muted)', maxWidth: '400px', margin: '0 auto var(--space-8)' }}>
                            {searchTerm || filterType
                                ? 'No hay documentos que coincidan con tu búsqueda actual. Intenta ajustar los filtros.'
                                : 'Comienza subiendo políticas, reglamentos o procedimientos para tu organización.'}
                        </p>
                        {!searchTerm && !filterType && (
                            <button className="btn btn-primary" onClick={() => setShowModal(true)}>
                                <FiPlus /> Crear primer documento
                            </button>
                        )}
                    </div>
                ) : (
                    <div className="grid grid-cols-3">
                        {filteredDocuments.map((doc) => {
                            const docType = DOCUMENT_TYPES[doc.tipo] || { label: doc.tipo, color: 'var(--text-muted)' };
                            const pendingCount = doc.asignaciones?.filter(a => a.estado === 'pendiente').length || 0;
                            const signedCount = doc.asignaciones?.filter(a => a.estado === 'firmado').length || 0;
                            const totalAssigned = doc.asignaciones?.length || 0;

                            return (
                                <div key={doc.documentId} className="card">
                                    <div className="flex items-start justify-between mb-3">
                                        <div className="avatar" style={{ background: docType.color }}>
                                            <FiFileText />
                                        </div>
                                        {doc.archivoUrl && (
                                            <button
                                                className="btn btn-ghost btn-icon btn-sm"
                                                onClick={() => handleDownloadFile(doc.archivoUrl!)}
                                                title="Descargar archivo"
                                            >
                                                <FiDownload />
                                            </button>
                                        )}
                                    </div>

                                    <h4 className="font-semibold mb-1">{doc.titulo}</h4>
                                    <span className="badge badge-neutral mb-2">{docType.label}</span>
                                    <p className="text-sm text-muted mb-4" style={{
                                        overflow: 'hidden',
                                        textOverflow: 'ellipsis',
                                        display: '-webkit-box',
                                        WebkitLineClamp: 2,
                                        WebkitBoxOrient: 'vertical'
                                    }}>
                                        {doc.descripcion || 'Sin descripción'}
                                    </p>

                                    <div className="flex gap-4 mb-4 text-sm">
                                        <div className="flex items-center gap-1">
                                            <FiUsers size={14} className="text-muted" />
                                            <span>{totalAssigned} asignados</span>
                                        </div>
                                        <div className="flex items-center gap-1">
                                            <FiCheck size={14} className="text-success-500" />
                                            <span>{signedCount} firmados</span>
                                        </div>
                                        {pendingCount > 0 && (
                                            <div className="flex items-center gap-1">
                                                <FiClock size={14} className="text-warning-500" />
                                                <span>{pendingCount} pendientes</span>
                                            </div>
                                        )}
                                        <div className="flex items-center gap-2 text-xs text-muted">
                                            <FiCalendar size={12} />
                                            <span>{formatDateTime(doc.createdAt)}</span>
                                        </div>
                                    </div>

                                    <div className="flex gap-2">
                                        <button
                                            className="btn btn-secondary btn-sm"
                                            style={{ flex: 1 }}
                                            onClick={() => handleViewDetails(doc)}
                                        >
                                            <FiEye size={14} />
                                            Ver Detalles
                                        </button>
                                        <button
                                            className="btn btn-primary btn-sm"
                                            style={{ flex: 1 }}
                                            onClick={() => handleOpenAssignModal(doc)}
                                        >
                                            <FiUserCheck size={14} />
                                            Asignar
                                        </button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}

                {/* Create Document Modal */}
                {showModal && (
                    <div className="modal-overlay" onClick={() => setShowModal(false)}>
                        <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '500px' }}>
                            <div className="modal-header">
                                <h2 className="modal-title">Nuevo Documento</h2>
                                <button
                                    className="btn btn-ghost btn-icon"
                                    onClick={() => { setShowModal(false); resetForm(); }}
                                >
                                    <FiX />
                                </button>
                            </div>

                            <form onSubmit={handleCreateDocument}>
                                <div className="modal-body">
                                    <div className="form-group">
                                        <label className="form-label">Tipo de Documento *</label>
                                        <select
                                            value={newDoc.tipo}
                                            onChange={(e) => setNewDoc({ ...newDoc, tipo: e.target.value })}
                                            className="form-input form-select"
                                            required
                                        >
                                            <option value="">Seleccione un tipo</option>
                                            {Object.entries(DOCUMENT_TYPES).map(([key, { label }]) => (
                                                <option key={key} value={key}>{label}</option>
                                            ))}
                                        </select>
                                    </div>

                                    <div className="form-group">
                                        <label className="form-label">Título *</label>
                                        <input
                                            type="text"
                                            value={newDoc.titulo}
                                            onChange={(e) => setNewDoc({ ...newDoc, titulo: e.target.value })}
                                            className="form-input"
                                            placeholder="Ej: IRL - Soldador"
                                            required
                                        />
                                    </div>

                                    <div className="form-group">
                                        <label className="form-label">Descripción</label>
                                        <textarea
                                            value={newDoc.descripcion}
                                            onChange={(e) => setNewDoc({ ...newDoc, descripcion: e.target.value })}
                                            className="form-input"
                                            rows={3}
                                            placeholder="Descripción del documento..."
                                            style={{ resize: 'vertical' }}
                                        />
                                    </div>

                                    {/* File Upload */}
                                    <div className="form-group">
                                        <label className="form-label">Archivo del Documento</label>
                                        <div
                                            className="file-upload-area"
                                            onClick={() => fileInputRef.current?.click()}
                                            style={{
                                                border: '2px dashed var(--surface-border)',
                                                borderRadius: 'var(--radius-lg)',
                                                padding: 'var(--space-6)',
                                                textAlign: 'center',
                                                cursor: 'pointer',
                                                background: selectedFile ? 'var(--success-500/10)' : 'var(--surface-elevated)',
                                                transition: 'all 0.2s'
                                            }}
                                        >
                                            <input
                                                ref={fileInputRef}
                                                type="file"
                                                accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png"
                                                onChange={handleFileSelect}
                                                style={{ display: 'none' }}
                                            />
                                            {selectedFile ? (
                                                <div className="flex items-center justify-center gap-2">
                                                    <FiFile size={20} className="text-success-500" />
                                                    <span className="font-semibold">{selectedFile.name}</span>
                                                    <button
                                                        type="button"
                                                        className="btn btn-ghost btn-icon btn-sm"
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            setSelectedFile(null);
                                                            if (fileInputRef.current) fileInputRef.current.value = '';
                                                        }}
                                                    >
                                                        <FiTrash2 size={14} />
                                                    </button>
                                                </div>
                                            ) : (
                                                <>
                                                    <FiUpload size={32} className="text-muted" style={{ marginBottom: 'var(--space-2)' }} />
                                                    <p className="text-muted">
                                                        Haz clic para seleccionar un archivo
                                                    </p>
                                                    <p className="text-xs text-muted">
                                                        PDF, Word, Excel o imágenes (máx. 10MB)
                                                    </p>
                                                </>
                                            )}
                                        </div>
                                    </div>
                                </div>

                                <div className="modal-footer">
                                    <button
                                        type="button"
                                        className="btn btn-secondary"
                                        onClick={() => { setShowModal(false); resetForm(); }}
                                        disabled={creating || uploading}
                                    >
                                        Cancelar
                                    </button>
                                    <button
                                        type="submit"
                                        className="btn btn-primary"
                                        disabled={creating || uploading}
                                    >
                                        {uploading ? (
                                            <>
                                                <div className="spinner spinner-sm" />
                                                Subiendo archivo...
                                            </>
                                        ) : creating ? (
                                            <>
                                                <div className="spinner spinner-sm" />
                                                Creando...
                                            </>
                                        ) : (
                                            'Crear Documento'
                                        )}
                                    </button>
                                </div>
                            </form>
                        </div>
                    </div>
                )}

                {/* Document Detail Modal */}
                {showDetailModal && selectedDocument && (
                    <div className="modal-overlay" onClick={() => setShowDetailModal(false)}>
                        <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '600px' }}>
                            <div className="modal-header">
                                <h2 className="modal-title">{selectedDocument.titulo}</h2>
                                <button
                                    className="btn btn-ghost btn-icon"
                                    onClick={() => setShowDetailModal(false)}
                                >
                                    <FiX />
                                </button>
                            </div>

                            <div className="modal-body">
                                <div className="mb-4">
                                    <span className="badge" style={{
                                        background: DOCUMENT_TYPES[selectedDocument.tipo]?.color || 'var(--text-muted)',
                                        color: 'white'
                                    }}>
                                        {DOCUMENT_TYPES[selectedDocument.tipo]?.label || selectedDocument.tipo}
                                    </span>
                                </div>

                                <p className="mb-4">{selectedDocument.descripcion || 'Sin descripción'}</p>

                                {selectedDocument.archivoUrl && (
                                    <div className="mb-4">
                                        <button
                                            className="btn btn-primary"
                                            onClick={() => handleDownloadFile(selectedDocument.archivoUrl!)}
                                        >
                                            <FiDownload />
                                            Descargar Documento
                                        </button>
                                    </div>
                                )}

                                <div className="flex items-center gap-3 mb-4">
                                    <FiCalendar style={{ color: 'var(--primary-500)' }} />
                                    <div>
                                        <div className="text-sm font-bold">Fecha de Creación</div>
                                        <div className="text-sm text-muted">{formatDateTime(selectedDocument.createdAt)}</div>
                                    </div>
                                </div>

                                {/* Assignments Status */}
                                <div>
                                    <h4 className="font-semibold mb-3">
                                        <FiUsers className="inline" /> Asignaciones ({selectedDocument.asignaciones?.length || 0})
                                    </h4>

                                    {(!selectedDocument.asignaciones || selectedDocument.asignaciones.length === 0) ? (
                                        <p className="text-muted">No hay asignaciones aún</p>
                                    ) : (
                                        <div style={{ maxHeight: '200px', overflowY: 'auto' }}>
                                            <table className="table w-full text-sm">
                                                <thead>
                                                    <tr>
                                                        <th className="text-left">Trabajador</th>
                                                        <th className="text-left">Asignado</th>
                                                        <th className="text-left">Firmado</th>
                                                        <th className="text-left">Estado</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {selectedDocument.asignaciones.map((assignment, idx) => (
                                                        <tr
                                                            key={idx}
                                                            style={{
                                                                borderBottom: '1px solid var(--surface-border)'
                                                            }}
                                                        >
                                                            <td>{assignment.nombre || assignment.workerId}</td>
                                                            <td>{formatDateTime(assignment.fechaAsignacion)}</td>
                                                            <td>{assignment.fechaFirma ? formatDateTime(assignment.fechaFirma) : '—'}</td>
                                                            <td>
                                                                <span className={`badge ${assignment.estado === 'firmado' ? 'badge-success' : 'badge-warning'}`}>
                                                                    {assignment.estado === 'firmado' ? 'Firmado' : 'Pendiente'}
                                                                </span>
                                                            </td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    )}
                                </div>
                            </div>

                            <div className="modal-footer">
                                <button
                                    className="btn btn-secondary"
                                    onClick={() => setShowDetailModal(false)}
                                >
                                    Cerrar
                                </button>
                                <button
                                    className="btn btn-primary"
                                    onClick={() => {
                                        setShowDetailModal(false);
                                        handleOpenAssignModal(selectedDocument);
                                    }}
                                >
                                    <FiUserCheck />
                                    Asignar a más personas
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {/* Assignment Modal */}
                {showAssignModal && selectedDocument && (
                    <div className="modal-overlay" onClick={() => setShowAssignModal(false)}>
                        <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '500px' }}>
                            <div className="modal-header">
                                <h2 className="modal-title">Asignar Documento</h2>
                                <button
                                    className="btn btn-ghost btn-icon"
                                    onClick={() => setShowAssignModal(false)}
                                >
                                    <FiX />
                                </button>
                            </div>

                            <div className="modal-body">
                                <p className="mb-4">
                                    <strong>{selectedDocument.titulo}</strong>
                                </p>

                                <div className="form-group">
                                    <label className="form-label">¿A quién asignar?</label>
                                    <div className="flex gap-2 mb-4">
                                        <button
                                            type="button"
                                            className={`btn ${assignmentType === 'todos' ? 'btn-primary' : 'btn-secondary'}`}
                                            onClick={() => setAssignmentType('todos')}
                                        >
                                            Todos
                                        </button>
                                        <button
                                            type="button"
                                            className={`btn ${assignmentType === 'cargo' ? 'btn-primary' : 'btn-secondary'}`}
                                            onClick={() => setAssignmentType('cargo')}
                                        >
                                            Por Cargo
                                        </button>
                                        <button
                                            type="button"
                                            className={`btn ${assignmentType === 'personalizado' ? 'btn-primary' : 'btn-secondary'}`}
                                            onClick={() => setAssignmentType('personalizado')}
                                        >
                                            Personalizado
                                        </button>
                                    </div>
                                </div>

                                {assignmentType === 'cargo' && (
                                    <div className="form-group">
                                        <label className="form-label">Seleccionar Cargo</label>
                                        <select
                                            value={selectedCargo}
                                            onChange={(e) => setSelectedCargo(e.target.value)}
                                            className="form-input form-select"
                                        >
                                            <option value="">Seleccione un cargo</option>
                                            {uniqueCargos.map(cargo => (
                                                <option key={cargo} value={cargo}>{cargo}</option>
                                            ))}
                                        </select>
                                    </div>
                                )}

                                {assignmentType === 'personalizado' && (
                                    <div className="form-group">
                                        <label className="form-label">
                                            Seleccionar Trabajadores ({selectedWorkerIds.length} seleccionados)
                                        </label>
                                        <div style={{ maxHeight: '200px', overflowY: 'auto', border: '1px solid var(--surface-border)', borderRadius: 'var(--radius-md)' }}>
                                            {workers.filter(w => w.habilitado).map(worker => (
                                                <label
                                                    key={worker.workerId}
                                                    className="flex items-center gap-2"
                                                    style={{
                                                        padding: 'var(--space-2) var(--space-3)',
                                                        cursor: 'pointer',
                                                        borderBottom: '1px solid var(--surface-border)',
                                                        background: selectedWorkerIds.includes(worker.workerId) ? 'var(--primary-500/10)' : 'transparent'
                                                    }}
                                                >
                                                    <input
                                                        type="checkbox"
                                                        checked={selectedWorkerIds.includes(worker.workerId)}
                                                        onChange={() => toggleWorkerSelection(worker.workerId)}
                                                    />
                                                    <span>{worker.nombre} {worker.apellido}</span>
                                                    <span className="text-sm text-muted">- {worker.cargo}</span>
                                                </label>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {assignmentType === 'todos' && (
                                    <p className="text-muted">
                                        Se asignará a {workers.filter(w => w.habilitado).length} trabajadores habilitados.
                                    </p>
                                )}
                            </div>

                            <div className="modal-footer">
                                <button
                                    className="btn btn-secondary"
                                    onClick={() => setShowAssignModal(false)}
                                    disabled={assigning}
                                >
                                    Cancelar
                                </button>
                                <button
                                    className="btn btn-primary"
                                    onClick={handleAssign}
                                    disabled={assigning || (assignmentType === 'cargo' && !selectedCargo) || (assignmentType === 'personalizado' && selectedWorkerIds.length === 0)}
                                >
                                    {assigning ? (
                                        <>
                                            <div className="spinner spinner-sm" />
                                            Asignando...
                                        </>
                                    ) : (
                                        'Asignar Documento'
                                    )}
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
            <style>{`
                @keyframes slideIn {
                    from { transform: translateX(100%); opacity: 0; }
                    to { transform: translateX(0); opacity: 1; }
                }

                .notification {
                    transition: all 0.3s ease;
                }

                .empty-state {
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                    text-align: center;
                }

                .spinner {
                    width: 40px;
                    height: 40px;
                    border: 3px solid var(--surface-border);
                    border-top-color: var(--primary-500);
                    border-radius: 50%;
                    animation: spin 0.8s linear infinite;
                }

                @keyframes spin {
                    to { transform: rotate(360deg); }
                }
            `}</style>
        </>
    );
}
