import { useEffect, useMemo, useRef, useState } from 'react';
import {
    FiFileText,
    FiFolder,
    FiSearch,
    FiUpload,
    FiDownload,
    FiFile,
    FiX,
    FiUsers,
    FiEye,
    FiChevronRight,
    FiHome,
    FiShield,
    FiCalendar,
    FiArchive,
    FiUser
} from 'react-icons/fi';
import { documentsApi, uploadsApi, tenantsApi, type Document } from '../api/client';
import { abrirDocumentoFirmable } from '../utils/documentoFirmado';
import { useAuth } from '../context/AuthContext';
import { useObraContext } from '../context/ObraContext';
import RepositorioFuf from '../components/RepositorioFuf';
import { AMBITO as AMBITO_FUF } from '../utils/estructuraPreventiva';
import { PERMISSIONS } from '../permissions';
import { useToast } from '../context/ToastContext';
import { AlertBanner, Select, PageHeader, SegmentedControl } from '../components/ui';
import DocumentPreviewModal from '../components/DocumentPreviewModal';

// ── Carpetas del repositorio ──────────────────────────────────────────────
// Cada documento se ubica en una carpeta según su clasificación / fase.
type FolderKey = 'empresa' | 'obra' | 'ds44' | 'repositorio' | 'diario' | 'trabajador' | 'otros';

const FOLDERS: Record<FolderKey, { label: string; icon: typeof FiFolder; color: string }> = {
    empresa:     { label: 'Documentos de empresa',   icon: FiArchive,  color: '#0ea5e9' },
    obra:        { label: 'Documentos de obra',      icon: FiHome,     color: '#006edc' },
    ds44:        { label: 'DS44 · Cumplimiento',     icon: FiShield,   color: '#10b981' },
    repositorio: { label: 'Repositorio general',     icon: FiFolder,   color: '#8b5cf6' },
    diario:      { label: 'Registros y actividades', icon: FiCalendar, color: '#f59e0b' },
    trabajador:  { label: 'Documentos de personas',  icon: FiUsers,    color: '#ec4899' },
    otros:       { label: 'Otros',                   icon: FiFile,     color: '#64748b' },
};
const FOLDER_ORDER: FolderKey[] = ['empresa', 'obra', 'ds44', 'repositorio', 'diario', 'trabajador', 'otros'];

const folderOf = (doc: { clasificacion?: string; fase?: string }): FolderKey => {
    if (doc.clasificacion === 'empresa') return 'empresa';
    if (doc.fase) return 'ds44';
    switch (doc.clasificacion) {
        case 'obra': return 'obra';
        case 'repositorio': return 'repositorio';
        case 'diario': return 'diario';
        case 'trabajador': return 'trabajador';
        default: return 'otros';
    }
};

// Documentos corporativos (1 para todas las obras) que se suben en Onboarding.
// Se inyectan en el repositorio como carpeta "Documentos de empresa".
const EMPRESA_DOC_TITLES: Record<string, string> = {
    REGLAMENTO_INTERNO: 'Reglamento Interno (RIHS/RIOHS)',
    POLITICA_SSO: 'Política de SST',
};
const extractEmpresaDocs = (cargos: any[]): { tipo: string; fileKey: string; nombre?: string; subidoEn?: string }[] => {
    const out: { tipo: string; fileKey: string; nombre?: string; subidoEn?: string }[] = [];
    const seen = new Set<string>();
    for (const c of cargos || []) {
        for (const it of (c?.kit || [])) {
            const fileKey = it?.plantilla?.fileKey;
            if (fileKey && it?.tipo && EMPRESA_DOC_TITLES[it.tipo] && !seen.has(it.tipo)) {
                seen.add(it.tipo);
                out.push({ tipo: it.tipo, fileKey, nombre: it.plantilla.nombre, subidoEn: it.plantilla.subidoEn });
            }
        }
    }
    return out;
};

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
    const { selectedObraId } = useObraContext();
    const { toast } = useToast();

    const [documents, setDocuments] = useState<RepoDocument[]>([]);
    const [empresaDocuments, setEmpresaDocuments] = useState<RepoDocument[]>([]);
    const [documentTypes, setDocumentTypes] = useState<Record<string, string>>({});
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [openFolder, setOpenFolder] = useState<FolderKey | null>(null);
    const canViewGeneral = user?.rol !== 'trabajador';
    const [activeScope, setActiveScope] = useState<'general' | 'personal'>(canViewGeneral ? 'general' : 'personal');
    // Ámbito del formulario DS44. La entidad empleadora tiene sus propios ítems
    // (1, 50) que no viven en ninguna faena, así que no basta con el de la obra.
    const [ambitoFuf, setAmbitoFuf] = useState<'empresa' | 'obra'>('obra');

    const canUpload = hasPermission(PERMISSIONS.REPOSITORIO_SUBIR);
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
            const tenantId = user?.tenantId || localStorage.getItem('tenant_id') || '';
            const [res, cargosRes] = await Promise.all([
                documentsApi.list({ obraId: selectedObraId } as any),
                tenantId ? tenantsApi.getCargos(tenantId) : Promise.resolve({ success: false } as any),
            ]);
            if (res.success && res.data) {
                setDocuments((res.data.documents || []) as RepoDocument[]);
                setDocumentTypes(res.data.types || {});
            }
            // Documentos corporativos (Reglamento Interno, Política SST) subidos en
            // Onboarding: se reflejan en el repositorio como carpeta "Documentos de empresa".
            const empresaRaw = cargosRes.success && cargosRes.data ? extractEmpresaDocs(cargosRes.data.cargos || []) : [];
            setEmpresaDocuments(empresaRaw.map((d) => ({
                documentId: `empresa-${d.tipo}`,
                tipo: d.tipo,
                titulo: EMPRESA_DOC_TITLES[d.tipo] || d.tipo,
                descripcion: 'Documento de empresa · aplica a todas las obras',
                clasificacion: 'empresa',
                archivoUrl: d.fileKey,
                s3Key: d.fileKey,
                archivoNombre: d.nombre || null,
                createdAt: d.subidoEn,
                creatorName: 'Empresa',
            } as RepoDocument)));
        } catch (err) {
            console.error('Error loading repository documents:', err);
            toast.error('No se pudieron cargar los documentos');
        } finally {
            setLoading(false);
        }
    };

    // Las asignaciones usan personaId (workerId es legacy): se comprueban ambos, si no
    // los documentos recién asignados no aparecían en la sección "Personal".
    const isAssignedToUser = (doc: RepoDocument) =>
        Boolean(user?.personaId && doc.asignaciones?.some(a => (a as any).personaId === user.personaId || a.workerId === user.personaId));

    const personalDocuments = useMemo(() => documents.filter(isAssignedToUser), [documents, user?.personaId]);
    const generalDocuments = useMemo(
        () => [...empresaDocuments, ...documents.filter(doc => doc.clasificacion !== 'diario')],
        [documents, empresaDocuments]
    );

    // Documentos del scope activo (antes de aplicar carpeta o búsqueda).
    const scopeDocuments = activeScope === 'personal' ? personalDocuments : generalDocuments;

    // Conteo de documentos por carpeta dentro del scope activo.
    const folderCounts = useMemo(() => {
        const counts: Record<string, number> = {};
        scopeDocuments.forEach((doc) => { const f = folderOf(doc); counts[f] = (counts[f] || 0) + 1; });
        return counts;
    }, [scopeDocuments]);

    const isSearching = searchTerm.trim().length > 0;

    /** El formulario es del cumplimiento de la entidad, no de los archivos que a
     *  una persona le asignaron: no tiene sentido en el ámbito personal. */
    const puedeVerFuf = canViewGeneral && activeScope === 'general';

    /** Sin obra seleccionada solo el ámbito empresa es evaluable. */
    const ambitoEfectivo: 'empresa' | 'obra' = selectedObraId ? ambitoFuf : 'empresa';

    /**
     * Carpetas de la raíz.
     *
     * DS44 aparece SIEMPRE, con conteo 0 si corresponde. No es una carpeta de
     * archivos: es el formulario de fiscalización. Esconderla mientras está vacía
     * la volvía inalcanzable justo cuando más sirve, que es para ver qué falta.
     */
    const carpetasVisibles = useMemo(
        () => FOLDER_ORDER.filter((k) => folderCounts[k] || (k === 'ds44' && puedeVerFuf)),
        [folderCounts, puedeVerFuf]
    );

    // Documentos visibles: al buscar se aplana todo el scope; si no, se filtra por
    // la carpeta abierta. La raíz (sin carpeta, sin búsqueda) muestra carpetas.
    const visibleDocuments = useMemo(() => {
        const term = searchTerm.toLowerCase();
        return scopeDocuments.filter((doc) => {
            if (!isSearching && openFolder && folderOf(doc) !== openFolder) return false;
            if (!term) return true;
            return doc.titulo.toLowerCase().includes(term)
                || (doc.descripcion || '').toLowerCase().includes(term)
                || (doc.archivoNombre || '').toLowerCase().includes(term);
        });
    }, [scopeDocuments, openFolder, searchTerm, isSearching]);

    const showFolders = !isSearching && !openFolder;

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
                createdBy: user?.personaId || user?.userId,
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

    const [preview, setPreview] = useState<{ url: string | null; name: string; doc: RepoDocument } | null>(null);

    const handleDownload = async (doc: RepoDocument) => {
        // Documentos con firmas: se descarga la versión con el anexo de
        // firmas estampado (validez legal), no el archivo original. La
        // pestaña se abre ya en el click (ver utils/documentoFirmado) para
        // que el navegador no la bloquee mientras se espera el estampado.
        await abrirDocumentoFirmable({
            documentId: doc.documentId,
            firmas: doc.firmas,
            fileKey: doc.s3Key || doc.archivoUrl,
            onPreparando: () => toast.info('Preparando documento firmado, esto puede tardar unos segundos...'),
            onError: (mensaje) => toast.error(mensaje),
        });
    };

    const handlePreview = async (doc: RepoDocument) => {
        const fileKey = doc.s3Key || doc.archivoUrl;
        if (!fileKey) return;
        // Abrimos el modal en estado de carga mientras se obtiene la URL presignada.
        setPreview({ url: null, name: doc.archivoNombre || doc.titulo || 'documento', doc });
        try {
            const response = await uploadsApi.getDownloadUrl(fileKey);
            if (response.success && response.data?.downloadUrl) {
                setPreview((prev) => prev ? { ...prev, url: response.data!.downloadUrl } : prev);
            } else {
                toast.error('No se pudo abrir la vista previa');
                setPreview(null);
            }
        } catch (err) {
            console.error('Preview error:', err);
            toast.error('No se pudo abrir la vista previa');
            setPreview(null);
        }
    };

    const formatDate = (value?: string | null) => {
        if (!value) return '-';
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return value;
        return date.toLocaleDateString('es-CL');
    };

    const switchScope = (scope: 'general' | 'personal') => {
        setActiveScope(scope);
        setOpenFolder(null);
        setSearchTerm('');
    };

    const generalCount = generalDocuments.length;
    const personalCount = personalDocuments.length;

    return (
        <>

            <div className="page-content">
                <PageHeader
                    banner
                    title="Repositorio de documentos"
                    description="Documentos organizados por carpetas: base, registros y los asignados a cada persona. La carpeta DS44 no es una carpeta de archivos, es el formulario de fiscalización."
                    actions={
                        canUpload && selectedObraId ? (
                            <button className="btn btn-primary" onClick={() => setShowUploadForm((prev) => !prev)}>
                                <FiUpload /> Subir documento
                            </button>
                        ) : undefined
                    }
                />

                {!selectedObraId && (
                    <AlertBanner
                        variant={puedeVerFuf ? 'info' : 'warning'}
                        message={puedeVerFuf
                            ? 'Selecciona una obra desde la barra superior para ver su repositorio. El formulario de cumplimiento de la entidad empleadora no depende de la obra y está disponible abajo.'
                            : 'Selecciona una obra desde la barra superior para ver su repositorio de documentos.'}
                    />
                )}

                {selectedObraId && canViewGeneral && (
                    <div className="repo-scope">
                        <button
                            className={`repo-scope-btn${activeScope === 'general' ? ' repo-scope-btn--active' : ''}`}
                            onClick={() => switchScope('general')}
                        >
                            <FiFolder size={15} /> General <span className="repo-scope-count">{generalCount}</span>
                        </button>
                        <button
                            className={`repo-scope-btn${activeScope === 'personal' ? ' repo-scope-btn--active' : ''}`}
                            onClick={() => switchScope('personal')}
                        >
                            <FiUser size={15} /> Personal <span className="repo-scope-count">{personalCount}</span>
                        </button>
                    </div>
                )}

                {selectedObraId && !canViewGeneral && (
                    <div className="repo-scope">
                        <span className="repo-scope-btn repo-scope-btn--active">
                            <FiUser size={15} /> Mis documentos <span className="repo-scope-count">{personalCount}</span>
                        </span>
                    </div>
                )}

                {showUploadForm && canUpload && selectedObraId && (
                    <div className="card mb-6" style={{ padding: 'var(--space-5)' }}>
                        <form onSubmit={handleCreateDocument}>
                            <div className="grid grid-cols-2" style={{ gap: 'var(--space-4)' }}>
                                <div className="form-group">
                                    <label className="form-label">Tipo de Documento *</label>
                                    <Select
                                        ariaLabel="Tipo de documento"
                                        placeholder="Selecciona un tipo"
                                        searchable
                                        value={newDoc.tipo}
                                        onChange={(v) => setNewDoc(prev => ({ ...prev, tipo: v }))}
                                        options={Object.entries(documentTypes).map(([key, label]) => ({ value: key, label: label as string }))}
                                    />
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

                {/* ── Toolbar: breadcrumb + búsqueda ──
                    También sin obra: la carpeta DS44 se puede abrir a nivel empresa,
                    y sin migas no habría forma de volver a la raíz. */}
                {(selectedObraId || puedeVerFuf) && (
                    <div className="repo-toolbar">
                        <div className="repo-breadcrumb">
                            <button
                                className="repo-crumb"
                                onClick={() => { setOpenFolder(null); setSearchTerm(''); }}
                                disabled={showFolders}
                            >
                                <FiFolder size={14} /> {activeScope === 'personal' ? 'Personal' : 'General'}
                            </button>
                            {!isSearching && openFolder && (
                                <>
                                    <FiChevronRight size={13} className="repo-crumb-sep" />
                                    <span className="repo-crumb repo-crumb--current">{FOLDERS[openFolder].label}</span>
                                </>
                            )}
                            {isSearching && (
                                <>
                                    <FiChevronRight size={13} className="repo-crumb-sep" />
                                    <span className="repo-crumb repo-crumb--current">Resultados de búsqueda</span>
                                </>
                            )}
                        </div>
                        <div className="repo-search">
                            <FiSearch className="repo-search-icon" size={15} />
                            <input
                                type="text"
                                placeholder="Buscar en todo el repositorio…"
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                            />
                            {searchTerm && (
                                <button className="repo-search-clear" onClick={() => setSearchTerm('')} aria-label="Limpiar búsqueda">
                                    <FiX size={14} />
                                </button>
                            )}
                        </div>
                    </div>
                )}

                {loading && (
                    <div className="flex items-center justify-center" style={{ height: '240px' }}>
                        <div className="spinner" />
                    </div>
                )}

                {/* ── Carpeta DS44: el formulario seccionado ──
                    Es una VISTA sobre los documentos que ya viven en su módulo dueño,
                    con el estado que calcula el panel de cumplimiento. No indexa una
                    lista plana de archivos: el fiscalizador recorre el FUF por sección. */}
                {!loading && openFolder === 'ds44' && !isSearching && puedeVerFuf && (
                    <>
                        {/* El selector solo tiene sentido con obra activa: sin ella el
                            único ámbito evaluable es el de la entidad empleadora. */}
                        {selectedObraId && (
                            <div className="ds44-filtros" style={{ marginBottom: 'var(--space-4)' }}>
                                <SegmentedControl
                                    ariaLabel="Ámbito del formulario"
                                    value={ambitoFuf}
                                    onChange={(v) => setAmbitoFuf(v as 'empresa' | 'obra')}
                                    options={[
                                        { value: 'obra', label: 'Esta obra' },
                                        { value: 'empresa', label: 'Entidad empleadora' },
                                    ]}
                                />
                            </div>
                        )}
                        {/* `key` fuerza el remontaje al cambiar de ámbito: son dos
                            evaluaciones distintas, y reusar el estado dejaría abiertas
                            las secciones del ámbito anterior. */}
                        <RepositorioFuf
                            key={ambitoEfectivo}
                            tenantId={user?.tenantId || localStorage.getItem('tenant_id') || ''}
                            ambito={ambitoEfectivo === 'obra' ? AMBITO_FUF.OBRA : AMBITO_FUF.EMPRESA}
                            obraId={ambitoEfectivo === 'obra' ? selectedObraId : null}
                            onVerDocumento={(doc) => handlePreview(doc as any)}
                        />
                    </>
                )}

                {/* ── Vista de carpetas (raíz) ── */}
                {!loading && showFolders && carpetasVisibles.length > 0 && (
                    <div className="repo-folder-grid">
                        {carpetasVisibles.map((k) => {
                            const f = FOLDERS[k];
                            const Icon = f.icon;
                            return (
                                <button key={k} className="repo-folder" onClick={() => setOpenFolder(k)}>
                                    <div className="repo-folder-icon" style={{ background: `${f.color}1a`, color: f.color }}>
                                        <Icon size={22} />
                                    </div>
                                    <div className="repo-folder-info">
                                        <div className="repo-folder-name">{f.label}</div>
                                        <div className="repo-folder-count">
                                            {k === 'ds44' && !folderCounts[k]
                                                ? 'Formulario de fiscalización'
                                                : `${folderCounts[k] || 0} documento${folderCounts[k] === 1 ? '' : 's'}`}
                                        </div>
                                    </div>
                                    <FiChevronRight className="repo-folder-arrow" size={18} />
                                </button>
                            );
                        })}
                    </div>
                )}

                {/* ── Scope vacío ── */}
                {/* Sin documentos pero con la carpeta DS44 presente, el mensaje no
                    puede decir que no hay nada: la contradiría el formulario que sí
                    está ahí arriba. */}
                {!loading && selectedObraId && showFolders && scopeDocuments.length === 0 && (
                    carpetasVisibles.length > 0 ? (
                        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', marginTop: 'var(--space-4)' }}>
                            Todavía no hay documentos cargados en esta obra. El formulario de
                            fiscalización ya muestra qué corresponde según la dotación.
                        </p>
                    ) : (
                        <div className="repo-empty">
                            <div className="repo-empty-icon"><FiFolder size={34} /></div>
                            <h3>{activeScope === 'personal' ? 'Aún no tienes documentos asignados' : 'No hay documentos en esta obra'}</h3>
                            <p>{activeScope === 'personal'
                                ? 'Los documentos que se te asignen aparecerán aquí, organizados por carpeta.'
                                : 'Sube un archivo o registra documentos DS44 para comenzar a poblar el repositorio.'}</p>
                        </div>
                    )
                )}

                {/* ── Lista de documentos (dentro de carpeta o búsqueda) ── */}
                {/* La carpeta DS44 se muestra como formulario seccionado, no como lista
                    plana: con las dos a la vez el mismo documento aparecía dos veces.
                    Al buscar sí se aplana todo, incluido DS44, porque buscar es
                    justamente pedir resultados sin importar dónde estén. En el ámbito
                    personal el formulario no aplica, así que ahí la carpeta vuelve a
                    ser una lista: sin esto quedaría en blanco. */}
                {!loading && selectedObraId && !showFolders && (openFolder !== 'ds44' || isSearching || !puedeVerFuf) && (
                    visibleDocuments.length === 0 ? (
                        <div className="repo-empty">
                            <div className="repo-empty-icon"><FiFileText size={34} /></div>
                            <h3>Sin resultados</h3>
                            <p>{isSearching ? 'No encontramos documentos que coincidan con tu búsqueda.' : 'Esta carpeta no tiene documentos.'}</p>
                        </div>
                    ) : (
                        <div className="repo-doc-list">
                            {visibleDocuments.map((doc) => {
                                const typeLabel = documentTypes[doc.tipo] || doc.tipo;
                                const fileKey = doc.s3Key || doc.archivoUrl;
                                const assignmentCount = doc.asignaciones?.length || 0;
                                const fk = folderOf(doc);
                                return (
                                    <div key={doc.documentId} className="repo-doc">
                                        <div className="repo-doc-icon" style={{ color: FOLDERS[fk].color }}>
                                            <FiFileText size={18} />
                                        </div>
                                        <div className="repo-doc-main">
                                            <div className="repo-doc-title">{doc.titulo}</div>
                                            <div className="repo-doc-meta">
                                                <span className="badge badge-neutral">{typeLabel}</span>
                                                {isSearching && (
                                                    <span className="repo-doc-folder"><FiFolder size={11} /> {FOLDERS[fk].label}</span>
                                                )}
                                                <span>{doc.creatorName || 'Sistema'}</span>
                                                <span>· {formatDate(doc.createdAt)}</span>
                                                {assignmentCount > 0 && (
                                                    <span>· <FiUsers size={11} /> {assignmentCount}</span>
                                                )}
                                            </div>
                                        </div>
                                        <div className="repo-doc-actions">
                                            {fileKey ? (
                                                <>
                                                    <button className="btn btn-ghost btn-icon btn-sm" onClick={() => handlePreview(doc)} title="Previsualizar">
                                                        <FiEye />
                                                    </button>
                                                    <button className="btn btn-ghost btn-icon btn-sm" onClick={() => handleDownload(doc)} title="Descargar">
                                                        <FiDownload />
                                                    </button>
                                                </>
                                            ) : (
                                                <span className="text-xs text-muted">Sin archivo</span>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )
                )}

                <style>{`
                    .repo-scope {
                        display: inline-flex; gap: 4px; padding: 4px;
                        background: var(--surface-elevated);
                        border: 1px solid var(--surface-border);
                        border-radius: var(--radius-lg);
                        margin-bottom: var(--space-5);
                    }
                    .repo-scope-btn {
                        display: inline-flex; align-items: center; gap: 7px;
                        padding: 7px 14px; border: none; background: none; cursor: pointer;
                        font-size: 0.85rem; font-weight: 600; color: var(--text-muted);
                        border-radius: var(--radius-md); transition: all var(--transition-fast);
                    }
                    .repo-scope-btn:hover { color: var(--text-primary); }
                    .repo-scope-btn--active { background: var(--surface-card); color: var(--primary-600); box-shadow: var(--shadow-sm); }
                    .repo-scope-count {
                        font-size: 0.72rem; font-weight: 700; padding: 1px 7px; border-radius: 999px;
                        background: var(--surface-border); color: var(--text-muted);
                    }
                    .repo-scope-btn--active .repo-scope-count { background: var(--accent-tint); color: var(--accent-text); }

                    .repo-toolbar {
                        display: flex; align-items: center; justify-content: space-between;
                        gap: var(--space-4); margin-bottom: var(--space-4); flex-wrap: wrap;
                    }
                    .repo-breadcrumb { display: flex; align-items: center; gap: 6px; min-width: 0; }
                    .repo-crumb {
                        display: inline-flex; align-items: center; gap: 6px;
                        background: none; border: none; padding: 4px 8px; border-radius: var(--radius-sm);
                        font-size: 0.85rem; font-weight: 600; color: var(--text-muted); cursor: pointer;
                    }
                    .repo-crumb:not(:disabled):hover { color: var(--primary-600); background: var(--surface-elevated); }
                    .repo-crumb:disabled { cursor: default; }
                    .repo-crumb--current { color: var(--text-primary); }
                    .repo-crumb-sep { color: var(--surface-border); flex-shrink: 0; }

                    .repo-search {
                        position: relative; display: flex; align-items: center;
                        flex: 1; max-width: 360px; min-width: 220px;
                    }
                    .repo-search-icon { position: absolute; left: 12px; color: var(--text-muted); pointer-events: none; }
                    .repo-search input {
                        width: 100%; padding: 9px 34px 9px 36px;
                        border: 1px solid var(--surface-border); border-radius: var(--radius-md);
                        background: var(--surface-card); font-size: 0.88rem; color: var(--text-primary);
                    }
                    .repo-search input:focus { outline: none; border-color: var(--primary-400); box-shadow: 0 0 0 3px var(--accent-tint); }
                    .repo-search-clear {
                        position: absolute; right: 8px; display: flex; padding: 4px;
                        background: none; border: none; color: var(--text-muted); cursor: pointer; border-radius: 50%;
                    }
                    .repo-search-clear:hover { background: var(--surface-elevated); color: var(--text-primary); }

                    .repo-folder-grid {
                        display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
                        gap: var(--space-3);
                    }
                    .repo-folder {
                        display: flex; align-items: center; gap: var(--space-3);
                        padding: var(--space-4); text-align: left; cursor: pointer;
                        background: var(--surface-card); border: 1px solid var(--surface-border);
                        border-radius: var(--radius-lg); transition: all var(--transition-fast);
                    }
                    .repo-folder:hover { border-color: var(--primary-300); box-shadow: var(--shadow-md); transform: translateY(-1px); }
                    .repo-folder-icon {
                        width: 46px; height: 46px; border-radius: var(--radius-md);
                        display: flex; align-items: center; justify-content: center; flex-shrink: 0;
                    }
                    .repo-folder-info { flex: 1; min-width: 0; }
                    .repo-folder-name { font-weight: 700; font-size: 0.92rem; color: var(--text-primary); }
                    .repo-folder-count { font-size: 0.78rem; color: var(--text-muted); margin-top: 2px; }
                    .repo-folder-arrow { color: var(--text-muted); flex-shrink: 0; }

                    .repo-doc-list {
                        display: flex; flex-direction: column;
                        border: 1px solid var(--surface-border); border-radius: var(--radius-lg); overflow: hidden;
                        background: var(--surface-card);
                    }
                    .repo-doc {
                        display: flex; align-items: center; gap: var(--space-3);
                        padding: var(--space-3) var(--space-4);
                        border-bottom: 1px solid var(--surface-border); transition: background var(--transition-fast);
                    }
                    .repo-doc:last-child { border-bottom: none; }
                    .repo-doc:hover { background: var(--surface-elevated); }
                    .repo-doc-icon {
                        width: 38px; height: 38px; border-radius: var(--radius-md); flex-shrink: 0;
                        display: flex; align-items: center; justify-content: center; background: var(--surface-elevated);
                    }
                    .repo-doc-main { flex: 1; min-width: 0; }
                    .repo-doc-title { font-weight: 600; font-size: 0.9rem; color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
                    .repo-doc-meta {
                        display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
                        font-size: 0.76rem; color: var(--text-muted); margin-top: 3px;
                    }
                    .repo-doc-folder { display: inline-flex; align-items: center; gap: 3px; color: var(--text-secondary); }
                    .repo-doc-actions { display: flex; align-items: center; gap: 4px; flex-shrink: 0; }

                    .repo-empty {
                        text-align: center; padding: var(--space-10) var(--space-6);
                        border: 1px dashed var(--surface-border); border-radius: var(--radius-lg);
                    }
                    .repo-empty-icon {
                        width: 72px; height: 72px; border-radius: 50%; margin: 0 auto var(--space-4);
                        background: var(--surface-elevated); color: var(--text-muted);
                        display: flex; align-items: center; justify-content: center;
                    }
                    .repo-empty h3 { font-size: var(--text-lg); font-weight: 700; margin: 0 0 var(--space-2); }
                    .repo-empty p { color: var(--text-muted); max-width: 420px; margin: 0 auto; font-size: 0.88rem; }

                    @media (max-width: 560px) {
                        .repo-toolbar { flex-direction: column; align-items: stretch; }
                        .repo-search { max-width: none; }
                    }
                `}</style>
            </div>

            <DocumentPreviewModal
                isOpen={!!preview}
                onClose={() => setPreview(null)}
                url={preview?.url ?? null}
                fileName={preview?.name}
                onDownload={preview ? () => handleDownload(preview.doc) : undefined}
                documento={preview?.doc ?? null}
            />
        </>
    );
}
