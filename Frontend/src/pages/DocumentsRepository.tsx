import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import Header from '../components/Header';
import {
    FiFileText,
    FiFolder,
    FiSearch,
    FiFilter,
    FiUpload,
    FiDownload,
    FiFile,
    FiX,
    FiUsers,
    FiChevronDown,
    FiChevronUp
} from 'react-icons/fi';
import { documentsApi, uploadsApi, type Document } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useObraContext } from '../context/ObraContext';
import { useToast } from '../context/ToastContext';
import { AlertBanner } from '../components/ui';

type RepoDocument = Document & {
    clasificacion?: string;
    fase?: string;
    obraId?: string | null;
    creatorName?: string | null;
    createdBy?: string | null;
    archivoNombre?: string | null;
    s3Key?: string | null;
};

export default function DocumentsRepository() {
    const { user, hasPermission } = useAuth();
    const { obras, selectedObraId, selectedObra, setSelectedObraId, isLoadingObras } = useObraContext();
    const { toast } = useToast();

    const [documents, setDocuments] = useState<RepoDocument[]>([]);
    const [documentTypes, setDocumentTypes] = useState<Record<string, string>>({});
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [filterType, setFilterType] = useState('');
    const [expandedRows, setExpandedRows] = useState<Record<string, boolean>>({});
    const canViewGeneral = user?.rol !== 'trabajador';
    const canSelectObra = user?.rol === 'admin';
    const [activeScope, setActiveScope] = useState<'general' | 'personal'>(canViewGeneral ? 'general' : 'personal');

    const canUpload = hasPermission('asignar_documentos') || hasPermission('gestionar_obras');
    const [showUploadForm, setShowUploadForm] = useState(false);
    const [creating, setCreating] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [selectedFile, setSelectedFile] = useState<File | null>(null);
    const fileInputRef = useRef<HTMLInputElement | null>(null);

    const [newDoc, setNewDoc] = useState({
        tipo: '',
        titulo: '',
        descripcion: ''
    });

    useEffect(() => {
        if (!canViewGeneral) {
            setActiveScope('personal');
        }
    }, [canViewGeneral]);

    useEffect(() => {
        loadDocuments();
    }, [selectedObraId]);

    const loadDocuments = async () => {
        if (!selectedObraId) {
            setDocuments([]);
            setDocumentTypes({});
            setLoading(false);
            return;
        }

        setLoading(true);
        try {
            const res = await documentsApi.list({ obraId: selectedObraId } as any);
            if (res.success && res.data) {
                setDocuments((res.data.documents || []) as RepoDocument[]);
                setDocumentTypes(res.data.types || {});
            }
        } catch (err) {
            console.error('Error loading repository documents:', err);
            toast.error('No se pudieron cargar los documentos');
        } finally {
            setLoading(false);
        }
    };

    const isAssignedToUser = (doc: RepoDocument) =>
        Boolean(user?.workerId && doc.asignaciones?.some(a => a.workerId === user.workerId));

    const personalDocuments = useMemo(() => documents.filter(isAssignedToUser), [documents, user?.workerId]);
    const generalDocuments = useMemo(
        () => documents.filter(doc => doc.clasificacion !== 'diario'),
        [documents]
    );
    const visibleDocuments = useMemo(() => {
        const baseDocs = activeScope === 'personal' ? personalDocuments : generalDocuments;
        return baseDocs.filter((doc) => {
            const matchesSearch = doc.titulo.toLowerCase().includes(searchTerm.toLowerCase())
                || (doc.descripcion || '').toLowerCase().includes(searchTerm.toLowerCase())
                || (doc.archivoNombre || '').toLowerCase().includes(searchTerm.toLowerCase());
            const matchesType = !filterType || doc.tipo === filterType;
            return matchesSearch && matchesType;
        });
    }, [activeScope, generalDocuments, personalDocuments, searchTerm, filterType]);

    const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0] || null;
        if (!file) return;

        if (file.size > 10 * 1024 * 1024) {
            toast.error('El archivo supera los 10MB');
            return;
        }

        setSelectedFile(file);
    };

    const uploadFile = async (): Promise<string | null> => {
        if (!selectedFile) return null;

        setUploading(true);
        try {
            const urlRes = await uploadsApi.getUploadUrl({
                fileName: selectedFile.name,
                fileType: selectedFile.type,
                fileSize: selectedFile.size,
                categoria: 'documentos'
            });

            if (!urlRes.success || !urlRes.data) {
                throw new Error(urlRes.error || 'Error obteniendo URL');
            }

            const uploadRes = await fetch(urlRes.data.uploadUrl, {
                method: 'PUT',
                body: selectedFile,
                headers: {
                    'Content-Type': selectedFile.type
                }
            });

            if (!uploadRes.ok) {
                throw new Error('Error subiendo archivo');
            }

            await uploadsApi.confirmUpload({
                fileKey: urlRes.data.fileKey,
                fileName: selectedFile.name,
                fileType: selectedFile.type,
                fileSize: selectedFile.size
            });

            return urlRes.data.fileKey;
        } catch (err) {
            console.error('Upload error:', err);
            toast.error('No se pudo subir el archivo');
            return null;
        } finally {
            setUploading(false);
        }
    };

    const resetUploadForm = () => {
        setNewDoc({ tipo: '', titulo: '', descripcion: '' });
        setSelectedFile(null);
        if (fileInputRef.current) {
            fileInputRef.current.value = '';
        }
    };

    const handleCreateDocument = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!selectedObraId) return;
        if (!newDoc.tipo || !newDoc.titulo) {
            toast.warning('Completa tipo y titulo');
            return;
        }
        if (!selectedFile) {
            toast.warning('Selecciona un archivo');
            return;
        }

        setCreating(true);
        try {
            const fileKey = await uploadFile();
            if (!fileKey) {
                setCreating(false);
                return;
            }

            const response = await documentsApi.create({
                tipo: newDoc.tipo,
                titulo: newDoc.titulo,
                descripcion: newDoc.descripcion,
                archivoUrl: fileKey,
                archivoNombre: selectedFile?.name || undefined,
                obraId: selectedObraId,
                clasificacion: 'repositorio',
                createdBy: user?.userId,
                creatorName: user ? `${user.nombre} ${user.apellido || ''}`.trim() : undefined
            } as any);

            if (response.success && response.data) {
                toast.success('Documento agregado al repositorio');
                setDocuments(prev => [response.data as RepoDocument, ...prev]);
                setShowUploadForm(false);
                resetUploadForm();
            } else {
                toast.error(response.error || 'Error al crear documento');
            }
        } catch (err) {
            console.error('Error creating repository doc:', err);
            toast.error('No se pudo crear el documento');
        } finally {
            setCreating(false);
        }
    };

    const handleDownload = async (doc: RepoDocument) => {
        const fileKey = doc.s3Key || doc.archivoUrl;
        if (!fileKey) return;
        try {
            const response = await uploadsApi.getDownloadUrl(fileKey);
            if (response.success && response.data?.downloadUrl) {
                window.open(response.data.downloadUrl, '_blank');
            } else {
                toast.error('No se pudo descargar el archivo');
            }
        } catch (err) {
            console.error('Download error:', err);
            toast.error('No se pudo descargar el archivo');
        }
    };

    const formatDate = (value?: string | null) => {
        if (!value) return '-';
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return value;
        return date.toLocaleDateString('es-CL');
    };

    const toggleRow = (documentId: string) => {
        setExpandedRows((prev) => ({
            ...prev,
            [documentId]: !prev[documentId]
        }));
    };

    const generalCount = generalDocuments.length;
    const personalCount = personalDocuments.length;

    return (
        <>
            <Header title="Repositorio de Documentos" />

            <div className="page-content">
                <div className="page-header">
                    <div className="page-header-info">
                        <h2 className="page-header-title">
                            <FiFolder className="text-primary-500" />
                            Repositorio de Archivos
                        </h2>
                        <p className="page-header-description">
                            Registro centralizado de documentos de la obra, incluyendo DS44 y anexos generales.
                        </p>
                    </div>
                    <div className="page-header-actions" style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
                        {canSelectObra && (
                            <select
                                className="form-input form-select"
                                value={selectedObraId || ''}
                                onChange={(e) => setSelectedObraId(e.target.value || null)}
                                disabled={isLoadingObras || obras.length === 0}
                                style={{ minWidth: '220px' }}
                            >
                                <option value="">Selecciona una obra</option>
                                {obras.map((obra) => (
                                    <option key={obra.obraId} value={obra.obraId}>{obra.nombre}</option>
                                ))}
                            </select>
                        )}
                        {canUpload && selectedObraId && (
                            <button className="btn btn-primary" onClick={() => setShowUploadForm((prev) => !prev)}>
                                <FiUpload /> Subir Documento
                            </button>
                        )}
                    </div>
                </div>

                {!selectedObraId && (
                    <AlertBanner
                        variant="warning"
                        message="Selecciona una obra para ver su repositorio de documentos."
                    />
                )}

                {selectedObraId && (
                    <div className="card mb-6" style={{ padding: 'var(--space-4)' }}>
                        <div className="flex items-center justify-between flex-wrap" style={{ gap: 'var(--space-3)' }}>
                            <div className="text-sm text-muted">
                                Obra activa: <strong>{selectedObra?.nombre || 'Sin nombre'}</strong>
                            </div>
                            <div className="text-sm text-muted">
                                {generalCount} documentos totales
                            </div>
                        </div>
                    </div>
                )}

                {selectedObraId && canViewGeneral && (
                    <div className="tabs mb-6" style={{ borderBottom: '1px solid var(--surface-border)', display: 'flex', gap: 'var(--space-6)' }}>
                        <button
                            className={`tab ${activeScope === 'general' ? 'active' : ''}`}
                            onClick={() => setActiveScope('general')}
                            style={{
                                padding: 'var(--space-3) 0',
                                background: 'transparent',
                                border: 'none',
                                borderBottom: activeScope === 'general' ? '2px solid var(--primary-500)' : '2px solid transparent',
                                color: activeScope === 'general' ? 'var(--primary-600)' : 'var(--text-muted)',
                                fontWeight: activeScope === 'general' ? '600' : 'normal',
                                cursor: 'pointer'
                            }}
                        >
                            General ({generalCount})
                        </button>
                        <button
                            className={`tab ${activeScope === 'personal' ? 'active' : ''}`}
                            onClick={() => setActiveScope('personal')}
                            style={{
                                padding: 'var(--space-3) 0',
                                background: 'transparent',
                                border: 'none',
                                borderBottom: activeScope === 'personal' ? '2px solid var(--primary-500)' : '2px solid transparent',
                                color: activeScope === 'personal' ? 'var(--primary-600)' : 'var(--text-muted)',
                                fontWeight: activeScope === 'personal' ? '600' : 'normal',
                                cursor: 'pointer'
                            }}
                        >
                            Personal ({personalCount})
                        </button>

                    </div>
                )}

                {selectedObraId && !canViewGeneral && (
                    <div className="tabs mb-6" style={{ borderBottom: '1px solid var(--surface-border)' }}>
                        <span className="tab active" style={{ padding: 'var(--space-3) 0', borderBottom: '2px solid var(--primary-500)', color: 'var(--primary-600)', fontWeight: 600 }}>
                            Mis Documentos ({personalCount})
                        </span>
                    </div>
                )}

                {showUploadForm && canUpload && selectedObraId && (
                    <div className="card mb-6" style={{ padding: 'var(--space-5)' }}>
                        <form onSubmit={handleCreateDocument}>
                            <div className="grid grid-cols-2" style={{ gap: 'var(--space-4)' }}>
                                <div className="form-group">
                                    <label className="form-label">Tipo de Documento *</label>
                                    <select
                                        className="form-input form-select"
                                        value={newDoc.tipo}
                                        onChange={(e) => setNewDoc(prev => ({ ...prev, tipo: e.target.value }))}
                                        required
                                    >
                                        <option value="">Selecciona un tipo</option>
                                        {Object.entries(documentTypes).map(([key, label]) => (
                                            <option key={key} value={key}>{label}</option>
                                        ))}
                                    </select>
                                </div>
                                <div className="form-group">
                                    <label className="form-label">Titulo *</label>
                                    <input
                                        className="form-input"
                                        value={newDoc.titulo}
                                        onChange={(e) => setNewDoc(prev => ({ ...prev, titulo: e.target.value }))}
                                        required
                                    />
                                </div>
                            </div>
                            <div className="form-group">
                                <label className="form-label">Descripcion</label>
                                <textarea
                                    className="form-input"
                                    rows={3}
                                    value={newDoc.descripcion}
                                    onChange={(e) => setNewDoc(prev => ({ ...prev, descripcion: e.target.value }))}
                                />
                            </div>
                            <div className="form-group">
                                <label className="form-label">Archivo *</label>
                                <div
                                    className="file-upload-area"
                                    onClick={() => fileInputRef.current?.click()}
                                    style={{
                                        border: '2px dashed var(--surface-border)',
                                        borderRadius: 'var(--radius-lg)',
                                        padding: 'var(--space-5)',
                                        textAlign: 'center',
                                        cursor: 'pointer',
                                        background: 'var(--surface-elevated)'
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
                                            <FiFile size={18} />
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
                                                <FiX />
                                            </button>
                                        </div>
                                    ) : (
                                        <div className="text-muted">
                                            <FiUpload size={28} style={{ marginBottom: '8px' }} />
                                            <div>Selecciona un archivo (max 10MB)</div>
                                        </div>
                                    )}
                                </div>
                            </div>
                            <div className="flex gap-3" style={{ justifyContent: 'flex-end' }}>
                                <button type="button" className="btn btn-secondary" onClick={() => { setShowUploadForm(false); resetUploadForm(); }} disabled={creating || uploading}>
                                    Cancelar
                                </button>
                                <button type="submit" className="btn btn-primary" disabled={creating || uploading}>
                                    {creating ? 'Subiendo...' : 'Guardar'}
                                </button>
                            </div>
                        </form>
                    </div>
                )}

                {selectedObraId && (
                    <div className="card mb-6">
                        <div className="documents-actions-bar">
                            <div className="documents-filters">
                                <div style={{ position: 'relative', flex: 1, maxWidth: '320px' }}>
                                    <input
                                        type="text"
                                        placeholder="Buscar en el repositorio..."
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
                                        style={{ paddingLeft: '40px', minWidth: '220px' }}
                                    >
                                        <option value="">Todos los tipos</option>
                                        {Object.entries(documentTypes).map(([key, label]) => (
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
                        </div>
                    </div>
                )}

                {loading && (
                    <div className="flex items-center justify-center" style={{ height: '240px' }}>
                        <div className="spinner" />
                    </div>
                )}

                {!loading && selectedObraId && visibleDocuments.length === 0 && (
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
                            No hay documentos en este apartado
                        </h3>
                        <p className="empty-state-description" style={{ color: 'var(--text-muted)', maxWidth: '400px', margin: '0 auto' }}>
                            Ajusta los filtros o sube un nuevo archivo al repositorio.
                        </p>
                    </div>
                )}

                {!loading && selectedObraId && visibleDocuments.length > 0 && (
                    <div className="card" style={{ padding: 'var(--space-2)', background: 'var(--surface-card)', border: '1px solid var(--surface-border)' }}>
                        <div className="table-container">
                            <table className="table table-compact" style={{ minWidth: '960px' }}>
                            <thead>
                                <tr>
                                    <th style={{ width: '36%' }}>Documento</th>
                                    <th style={{ width: '16%' }}>Tipo</th>
                                    <th style={{ width: '16%' }}>Clasificacion</th>
                                    <th style={{ width: '16%' }}>Autor</th>
                                    <th style={{ width: '10%' }}>Fecha</th>
                                    <th style={{ width: '6%' }}>Accion</th>
                                </tr>
                            </thead>
                            <tbody>
                                {visibleDocuments.map((doc) => {
                                    const typeLabel = documentTypes[doc.tipo] || doc.tipo;
                                    const fileKey = doc.s3Key || doc.archivoUrl;
                                    const assignmentCount = doc.asignaciones?.length || 0;
                                    const clasificacionLabel = doc.clasificacion || 'diario';
                                    const isExpanded = Boolean(expandedRows[doc.documentId]);
                                    return (
                                        <Fragment key={doc.documentId}>
                                            <tr>
                                                <td>
                                                    <div className="flex items-start gap-3">
                                                        <div
                                                            className="avatar avatar-sm"
                                                            style={{ background: 'var(--primary-500)', width: '36px', height: '36px', flexShrink: 0, alignSelf: 'flex-start' }}
                                                        >
                                                            <FiFileText />
                                                        </div>
                                                        <div>
                                                            <div className="font-semibold">{doc.titulo}</div>
                                                            <div
                                                                className="text-xs text-muted"
                                                                style={{
                                                                    overflow: 'hidden',
                                                                    textOverflow: 'ellipsis',
                                                                    display: '-webkit-box',
                                                                    WebkitLineClamp: 1,
                                                                    WebkitBoxOrient: 'vertical',
                                                                    maxWidth: 420
                                                                }}
                                                            >
                                                                {doc.descripcion || 'Sin descripcion'}
                                                            </div>
                                                            <div className="text-xs text-muted" style={{ marginTop: 4 }}>
                                                                <FiUsers size={12} /> {assignmentCount} asignaciones
                                                            </div>
                                                        </div>
                                                    </div>
                                                </td>
                                                <td>
                                                    <span className="badge badge-neutral">{typeLabel}</span>
                                                </td>
                                                <td>
                                                    <span className="badge badge-secondary" style={{ textTransform: 'capitalize' }}>
                                                        {clasificacionLabel}
                                                    </span>
                                                    {doc.fase && (
                                                        <div className="text-xs text-muted" style={{ marginTop: 4 }}>Fase: {doc.fase}</div>
                                                    )}
                                                </td>
                                                <td>
                                                    <div className="text-sm">{doc.creatorName || 'Sistema'}</div>
                                                </td>
                                                <td>
                                                    <div className="text-sm">{formatDate(doc.createdAt)}</div>
                                                </td>
                                                <td>
                                                    <div className="flex items-center gap-2">
                                                        {fileKey ? (
                                                            <button
                                                                className="btn btn-ghost btn-icon btn-sm"
                                                                onClick={() => handleDownload(doc)}
                                                                title="Descargar archivo"
                                                            >
                                                                <FiDownload />
                                                            </button>
                                                        ) : (
                                                            <span className="text-xs text-muted">-</span>
                                                        )}
                                                        <button
                                                            className="btn btn-ghost btn-icon btn-sm"
                                                            onClick={() => toggleRow(doc.documentId)}
                                                            aria-expanded={isExpanded}
                                                            title={isExpanded ? 'Ocultar detalles' : 'Mostrar detalles'}
                                                        >
                                                            {isExpanded ? <FiChevronUp /> : <FiChevronDown />}
                                                        </button>
                                                    </div>
                                                </td>
                                            </tr>
                                            {isExpanded && (
                                                <tr className="table-expand-row">
                                                    <td colSpan={6}>
                                                        <div className="table-expand-content">
                                                            <div>
                                                                <strong>Descripcion:</strong> {doc.descripcion || 'Sin descripcion'}
                                                            </div>
                                                            <div>
                                                                <strong>Archivo:</strong> {doc.archivoNombre || 'Sin archivo'}
                                                            </div>
                                                            <div>
                                                                <strong>Clasificacion:</strong> {clasificacionLabel}
                                                            </div>
                                                            <div>
                                                                <strong>Asignaciones:</strong> {assignmentCount}
                                                            </div>
                                                        </div>
                                                    </td>
                                                </tr>
                                            )}
                                        </Fragment>
                                    );
                                })}
                            </tbody>
                            </table>
                        </div>
                    </div>
                )}
            </div>
        </>
    );
}
