import { Fragment, useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
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
    FiEye,
    FiFile,
    FiTrash2,
    FiUserCheck,
    FiAlertCircle,
    FiCalendar,
    FiPenTool,
    FiChevronDown,
    FiChevronUp
} from 'react-icons/fi';
import { documentsApi, workersApi, uploadsApi, type Document, type Worker } from '../api/client';
import { abrirDocumentoFirmable } from '../utils/documentoFirmado';
import { useAuth } from '../context/AuthContext';
import { PERMISSIONS } from '../permissions';
import { useToast } from '../context/ToastContext';
import { useObraContext } from '../context/ObraContext';
import { useOfflineSignature } from '../hooks/useOfflineSignature';
import SignatureModal from '../components/SignatureModal';
import { Modal, Select, PageHeader } from '../components/ui';

const DOCUMENT_TYPES: Record<string, { label: string; color: string; category: string }> = {
    IRL: { label: 'Informe de Riesgos Laborales', color: 'var(--primary-500)', category: 'normativo' },
    POLITICA_SSO: { label: 'Política SSO', color: 'var(--info-500)', category: 'normativo' },
    DIAGNOSTICO_LEGAL: { label: 'Matriz Legal aplicable', color: 'var(--warning-500)', category: 'normativo' },
    REGLAMENTO_INTERNO: { label: 'Reglamento Interno', color: 'var(--warning-500)', category: 'normativo' },
    PROCEDIMIENTO_TRABAJO: { label: 'Procedimiento de Trabajo', color: 'var(--success-500)', category: 'normativo' },
    MATRIZ_MIPPER: { label: 'Matriz MIPPER', color: 'var(--danger-500)', category: 'normativo' },
    MIPER: { label: 'MIPER', color: 'var(--danger-500)', category: 'normativo' },
    MAPA_RIESGOS: { label: 'Mapa de Riesgos', color: 'var(--info-500)', category: 'normativo' },
    ENTREGA_EPP: { label: 'Entrega EPP', color: 'var(--success-500)', category: 'diario' },
    CAPACITACION: { label: 'Capacitación', color: 'var(--info-500)', category: 'diario' },
    CHARLA_5_MIN: { label: 'Charla 5 Minutos', color: 'var(--warning-500)', category: 'diario' },
    // Tipos de libre creación (no gestionados por onboarding/obra).
    COMUNICADO: { label: 'Comunicado interno', color: 'var(--info-500)', category: 'normativo' },
    INSTRUCTIVO: { label: 'Instructivo / Manual', color: 'var(--success-500)', category: 'normativo' },
    OTRO_NORMATIVO: { label: 'Otro documento de empresa', color: 'var(--text-muted)', category: 'normativo' },
    ACTA_REGISTRO: { label: 'Acta / Registro', color: 'var(--info-500)', category: 'diario' },
    OTRO_DIARIO: { label: 'Otro registro de obra', color: 'var(--text-muted)', category: 'diario' },
};

// Tipos GESTIONADOS por otros módulos (onboarding del cargo, DS44 de la obra,
// actividades, EPP). NO se ofrecen en la creación manual de /documents: el IRL,
// Reglamento, Política, MIPER, etc. se cargan desde /onboarding o el detalle de obra,
// y las charlas/capacitaciones/EPP desde sus propios flujos.
const TIPOS_GESTIONADOS = new Set([
    'IRL', 'POLITICA_SSO', 'DIAGNOSTICO_LEGAL', 'REGLAMENTO_INTERNO', 'MATRIZ_MIPPER',
    'MIPER', 'MAPA_RIESGOS', 'ENTREGA_EPP', 'CAPACITACION', 'CHARLA_5_MIN',
]);
// Tipos disponibles para crear manualmente, por categoría.
const tiposCreables = (category: string) =>
    Object.entries(DOCUMENT_TYPES).filter(([key, info]) => info.category === category && !TIPOS_GESTIONADOS.has(key));

export default function Documents() {
    const { user, hasPermission } = useAuth();
    const canSubirDocumento = hasPermission(PERMISSIONS.DOCUMENTOS_SUBIR);
    const { selectedObraId, selectedObra, obras } = useObraContext();
    const { isOnline, pendingCount, signDocument, syncPendingSignatures } = useOfflineSignature();
    const [activeTab, setActiveTab] = useState<'normativos' | 'diarios'>('normativos');
    const activeCategory = activeTab === 'normativos' ? 'normativo' : 'diario';
    const [documents, setDocuments] = useState<Document[]>([]);
    const [workers, setWorkers] = useState<Worker[]>([]);
    const [loading, setLoading] = useState(true);
    const [showModal, setShowModal] = useState(false);
    const [showDetailModal, setShowDetailModal] = useState(false);
    const [showAssignModal, setShowAssignModal] = useState(false);
    const [selectedDocument, setSelectedDocument] = useState<Document | null>(null);
    const [showSignModal, setShowSignModal] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const [filterType, setFilterType] = useState('');
    const [expandedRows, setExpandedRows] = useState<Record<string, boolean>>({});
    const [uploading, setUploading] = useState(false);
    const [creating, setCreating] = useState(false);
    const [assigning, setAssigning] = useState(false);
    const [signing, setSigning] = useState(false);
    const { toast } = useToast();
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [searchParams, setSearchParams] = useSearchParams();
    // Evita reabrir el detalle si el usuario cierra el modal con el mismo ?doc en la URL.
    const handledDocParam = useRef<string | null>(null);
    // Visualización inline del archivo en el detalle (URL presignada).
    const [detailPreviewUrl, setDetailPreviewUrl] = useState<string | null>(null);

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
    // Búsqueda dentro del modo "personalizado" (filtra la lista de trabajadores).
    const [workerSearch, setWorkerSearch] = useState('');

    useEffect(() => {
        loadData();
    }, [selectedObraId]);

    // Sync pending offline signatures when online
    useEffect(() => {
        if (isOnline && pendingCount > 0) {
            syncPendingSignatures().then(result => {
                if (result.synced > 0) {
                    toast.success(`${result.synced} firma(s) sincronizada(s)`);
                    loadData();
                }
            });
        }
    }, [isOnline]);

    // Deep-link: si llega ?doc=<id> (desde una notificación), abre directamente el
    // detalle del documento con su visualización y la opción de firmar.
    useEffect(() => {
        const docId = searchParams.get('doc');
        if (!docId || documents.length === 0 || handledDocParam.current === docId) return;
        const target = documents.find(d => d.documentId === docId);
        if (target) {
            handledDocParam.current = docId;
            setSelectedDocument(target);
            setShowDetailModal(true);
            // Limpia el parámetro para no reabrir al navegar dentro de la página.
            searchParams.delete('doc');
            setSearchParams(searchParams, { replace: true });
        }
    }, [documents, searchParams, setSearchParams]);

    const loadData = async () => {
        try {
            const [docsRes, workersRes] = await Promise.all([
                // Los documentos NORMATIVOS son de empresa (no se filtran por obra); los
                // DIARIOS sí se acotan por obra, pero eso se filtra en el front para que
                // un documento de empresa recién creado se vea siempre, esté o no en obra.
                documentsApi.list({}),
                workersApi.list({ obraId: selectedObraId || undefined })
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
                toast.error('El archivo es demasiado grande. MÃ¡ximo 10MB.');
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
            toast.error('Error al subir el archivo');
            return null;
        } finally {
            setUploading(false);
        }
    };

    const handleCreateDocument = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newDoc.tipo || !newDoc.titulo) {
            toast.warning('Por favor complete los campos obligatorios');
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
                createdBy: user?.personaId,
                creatorName: user ? `${user.nombre} ${user.apellido || ''}`.trim() : undefined
            });

            if (response.success && response.data) {
                setDocuments([response.data, ...documents]);
                setShowModal(false);
                resetForm();
                toast.success('Documento creado exitosamente');
            } else {
                toast.error(response.error || 'Error al crear documento');
            }
        } catch (error) {
            console.error('Error creating document:', error);
            toast.error('Error al crear documento');
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
        setWorkerSearch('');
        setShowAssignModal(true);
    };

    const handleAssign = async () => {
        if (!selectedDocument) return;

        let workerIdsToAssign: string[] = [];

        // No se exige estar enrolado/activo para ASIGNAR: el supervisor asigna ahora
        // y la persona firma cuando complete su enrolamiento. (Antes se filtraba por
        // w.habilitado y no se podía asignar a quien aún no se activaba.)
        if (assignmentType === 'todos') {
            workerIdsToAssign = workers.map(w => w.personaId);
        } else if (assignmentType === 'cargo') {
            workerIdsToAssign = workers
                .filter(w => w.cargo?.toLowerCase() === selectedCargo.toLowerCase())
                .map(w => w.personaId);
        } else {
            workerIdsToAssign = selectedWorkerIds;
        }

        if (workerIdsToAssign.length === 0) {
            toast.warning('No hay trabajadores para asignar');
            return;
        }

        setAssigning(true);
        try {
            const response = await documentsApi.assign(selectedDocument.documentId, {
                workerIds: workerIdsToAssign,
                personaIds: workerIdsToAssign,
                assignedBy: user?.personaId,
                assignerName: user ? `${user.nombre} ${user.apellido || ''}`.trim() : undefined
            });

            if (response.success) {
                // La notificación al asignado la envía el backend al asignar el
                // documento (evento 'document.assigned' → bandeja con deep-link).
                // No se vuelve a enviar desde el frontend para evitar duplicados.
                toast.success(`Documento asignado a ${workerIdsToAssign.length} trabajadores`);
                setShowAssignModal(false);
                loadData(); // Refresh to get updated assignments
            } else {
                toast.error(response.error || 'Error al asignar documento');
            }
        } catch (error) {
            console.error('Error assigning document:', error);
            toast.error('Error al asignar documento');
        } finally {
            setAssigning(false);
        }
    };



    const handleOpenSignModal = (doc: Document) => {
        setSelectedDocument(doc);
        setShowSignModal(true);
    };

    const handleSign = async (pin: string) => {
        if (!selectedDocument || !user?.personaId) return;

        setSigning(true);
        try {
            const result = await signDocument(
                selectedDocument.documentId,
                selectedDocument.titulo,
                user.personaId,
                user.nombre || 'Usuario',
                pin
            );

            if (result.success) {
                if (result.offline) {
                    toast.info('Firma guardada localmente. Se sincronizará cuando vuelva la conexión.');
                } else {
                    toast.success('Documento firmado exitosamente');
                }
                setShowSignModal(false);
                if (!result.offline) {
                    loadData();
                }
            } else {
                throw new Error(result.error || 'Error al firmar documento');
            }
        } catch (error) {
            console.error('Error signing document:', error);
            throw error; // Re-throw so SignatureModal shows the error
        } finally {
            setSigning(false);
        }
    };

    // Resuelve una URL presignada para visualizar el archivo dentro del detalle.
    useEffect(() => {
        let cancelled = false;
        const fileKey = showDetailModal ? selectedDocument?.archivoUrl : null;
        if (!fileKey) { setDetailPreviewUrl(null); return; }
        setDetailPreviewUrl(null);
        uploadsApi.getDownloadUrl(fileKey).then(res => {
            if (!cancelled && res.success && res.data?.downloadUrl) setDetailPreviewUrl(res.data.downloadUrl);
        }).catch(() => { /* preview opcional */ });
        return () => { cancelled = true; };
    }, [showDetailModal, selectedDocument]);

    const handleDownloadFile = async (doc: Document) => {
        // Documentos con firmas: se descarga la versión con el anexo de
        // firmas estampado (validez legal), no el archivo original. La
        // pestaña se abre ya en el click (ver utils/documentoFirmado) para
        // que el navegador no la bloquee mientras se espera el estampado.
        await abrirDocumentoFirmable({
            documentId: doc.documentId,
            firmas: doc.firmas,
            fileKey: doc.archivoUrl,
            onPreparando: () => toast.info('Preparando documento firmado, esto puede tardar unos segundos...'),
            onError: (mensaje) => toast.error(mensaje),
        });
    };

    const formatDateTime = (value?: string | null) => {
        if (!value) return 'â€”';
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

    // Trabajadores visibles en el modo "personalizado" según la búsqueda
    // (nombre, apellido, cargo o RUT). Sin término => todos.
    const filteredWorkers = (() => {
        const q = workerSearch.trim().toLowerCase();
        if (!q) return workers;
        return workers.filter(w =>
            `${w.nombre || ''} ${w.apellido || ''}`.toLowerCase().includes(q)
            || (w.cargo || '').toLowerCase().includes(q)
            || (w.rut || '').toLowerCase().includes(q)
        );
    })();

    // "Seleccionar todos" opera sobre lo filtrado: si ya están todos los visibles
    // seleccionados, los quita; si no, los agrega (preservando la selección previa).
    const allFilteredSelected = filteredWorkers.length > 0
        && filteredWorkers.every(w => selectedWorkerIds.includes(w.personaId));
    const toggleSelectAllFiltered = () => {
        const filteredIds = filteredWorkers.map(w => w.personaId);
        if (allFilteredSelected) {
            const remove = new Set(filteredIds);
            setSelectedWorkerIds(prev => prev.filter(id => !remove.has(id)));
        } else {
            setSelectedWorkerIds(prev => Array.from(new Set([...prev, ...filteredIds])));
        }
    };

    const toggleRow = (documentId: string) => {
        setExpandedRows((prev) => ({
            ...prev,
            [documentId]: !prev[documentId]
        }));
    };

    // Get unique cargos from workers
    const uniqueCargos = [...new Set(workers.map(w => w.cargo).filter(Boolean))] as string[];

    const isWorkerOrSupervisor = user?.rol === 'trabajador';

    const filteredDocuments = documents.filter((doc) => {
        if ((doc as any).clasificacion === 'repositorio') return false;
        const typeInfo = DOCUMENT_TYPES[doc.tipo];
        const categoryMatch = typeInfo ? typeInfo.category === activeCategory : activeTab === 'normativos';
        // El tab NORMATIVOS muestra documentos de empresa (no se filtran por obra).
        // Para gestión, las copias por-trabajador del onboarding (con kitItemKey) NO
        // van aquí: son tareas de firma de cada persona (se ven en su ficha / la obra)
        // y de lo contrario el tab se inundaría con un RI/Política por trabajador.
        // El propio trabajador SÍ las ve (abajo se filtra a sus asignados) para firmar.
        if (activeCategory === 'normativo' && (doc as any).kitItemKey && !isWorkerOrSupervisor) return false;
        // El tab DIARIOS (registros por obra) se acota a la obra activa; un diario
        // sin obra también se muestra.
        if (activeCategory === 'diario' && selectedObraId && (doc as any).obraId && (doc as any).obraId !== selectedObraId) {
            return false;
        }
        const matchesSearch = doc.titulo.toLowerCase().includes(searchTerm.toLowerCase());
        const matchesType = !filterType || doc.tipo === filterType;

        // Si no es admin/prevencionista, ver solo si está asignado
        if (isWorkerOrSupervisor) {
            const isAssigned = doc.asignaciones?.some(a => a.workerId === user?.personaId || (a as any).personaId === user?.personaId);
            return categoryMatch && matchesSearch && matchesType && isAssigned;
        }

        return categoryMatch && matchesSearch && matchesType;
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



            <div className="page-content">
                <PageHeader
                    banner
                    scope={{ label: selectedObra?.nombre ? `Obra · ${selectedObra.nombre}` : 'Documentos' }}
                    title="Gestión documental"
                    description="Políticas, reglamentos, procedimientos y matrices de riesgo, con difusión y firma de los trabajadores."
                    actions={
                        canSubirDocumento ? (
                            <button className="btn btn-save" onClick={() => setShowModal(true)}>
                                <FiPlus /> Nuevo documento
                            </button>
                        ) : undefined
                    }
                />

                {/* Offline Banner */}
                {(!isOnline || pendingCount > 0) && (
                    <div
                        className="mb-4 p-3 rounded-lg flex items-center justify-between"
                        style={{
                            background: !isOnline ? 'rgba(245, 158, 11, 0.1)' : 'rgba(59, 130, 246, 0.1)',
                            border: `1px solid ${!isOnline ? '#f59e0b' : '#3b82f6'}`,
                            color: !isOnline ? '#b45309' : '#1d4ed8'
                        }}
                    >
                        <div className="flex items-center gap-2">
                            {!isOnline ? (
                                <>
                                    <FiAlertCircle size={18} />
                                    <span className="font-medium">Sin conexión - Las firmas se guardarán localmente</span>
                                </>
                            ) : (
                                <>
                                    <FiCheck size={18} />
                                    <span className="font-medium">{pendingCount} firma(s) pendiente(s) de sincronizar</span>
                                </>
                            )}
                        </div>
                        {isOnline && pendingCount > 0 && (
                            <button
                                className="btn btn-sm"
                                style={{
                                    background: 'var(--info-600)',
                                    color: 'white',
                                    border: 'none'
                                }}
                                onClick={() => syncPendingSignatures()}
                            >
                                Sincronizar ahora
                            </button>
                        )}
                    </div>
                )}

                {/* Tabs */}
                <div className="tabs mb-6" style={{ borderBottom: '1px solid var(--surface-border)', display: 'flex', gap: 'var(--space-6)' }}>
                    <button
                        className={`tab ${activeTab === 'normativos' ? 'active' : ''}`}
                        onClick={() => { setActiveTab('normativos'); setFilterType(''); }}
                        style={{
                            padding: 'var(--space-3) 0',
                            background: 'transparent',
                            border: 'none',
                            borderBottom: activeTab === 'normativos' ? '2px solid var(--primary-500)' : '2px solid transparent',
                            color: activeTab === 'normativos' ? 'var(--primary-600)' : 'var(--text-muted)',
                            fontWeight: activeTab === 'normativos' ? '600' : 'normal',
                            cursor: 'pointer',
                            fontSize: '1rem'
                        }}
                    >
                        Documentos Normativos (DS44)
                    </button>
                    <button
                        className={`tab ${activeTab === 'diarios' ? 'active' : ''}`}
                        onClick={() => { setActiveTab('diarios'); setFilterType(''); }}
                        style={{
                            padding: 'var(--space-3) 0',
                            background: 'transparent',
                            border: 'none',
                            borderBottom: activeTab === 'diarios' ? '2px solid var(--primary-500)' : '2px solid transparent',
                            color: activeTab === 'diarios' ? 'var(--primary-600)' : 'var(--text-muted)',
                            fontWeight: activeTab === 'diarios' ? '600' : 'normal',
                            cursor: 'pointer',
                            fontSize: '1rem'
                        }}
                    >
                        Documentos de Uso Diario
                    </button>
                </div>

                {/* Toolbar: búsqueda + filtro */}
                <div className="tbar">
                    <div className="tbar-search">
                        <FiSearch size={15} />
                        <input
                            type="text"
                            placeholder="Buscar documentos…"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                        />
                    </div>
                    <div style={{ minWidth: '210px' }}>
                        <Select
                            ariaLabel="Filtrar por tipo"
                            leadingIcon={<FiFilter />}
                            value={filterType}
                            onChange={setFilterType}
                            options={[
                                { value: '', label: 'Todos los tipos' },
                                ...Object.entries(DOCUMENT_TYPES)
                                    .filter(([, info]) => info.category === activeCategory)
                                    .map(([key, { label }]) => ({ value: key, label })),
                            ]}
                        />
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
                                    {filteredDocuments.length}
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
                                    {filteredDocuments.filter(d => d.firmas && d.firmas.length > 0).length}
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
                                    {filteredDocuments.filter(d => d.asignaciones?.some(a => a.estado === 'pendiente')).length}
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
                                    {filteredDocuments.reduce((acc, d) => acc + (d.asignaciones?.length || 0), 0)}
                                </div>
                                <div className="text-sm text-muted">Asignaciones</div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Documents List */}
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
                                ? 'No hay documentos que coincidan con tu bÃºsqueda actual. Intenta ajustar los filtros.'
                                : user?.rol === 'trabajador'
                                    ? 'No tienes documentos asignados pendiente de firma.'
                                    : 'Comienza subiendo polÃ­ticas, reglamentos o procedimientos para tu organizaciÃ³n.'}
                        </p>
                        {!searchTerm && !filterType && canSubirDocumento && (
                            <button className="btn btn-primary" onClick={() => setShowModal(true)}>
                                <FiPlus /> Crear primer documento
                            </button>
                        )}
                    </div>
                ) : (
                    <div className="table-container">
                        <table className="table table-compact" style={{ minWidth: '960px' }}>
                            <thead>
                                <tr>
                                    <th style={{ width: '36%' }}>Documento</th>
                                    <th style={{ width: '14%' }}>Tipo</th>
                                    <th style={{ width: '18%' }}>Asignaciones</th>
                                    <th style={{ width: '16%' }}>Fecha</th>
                                    <th style={{ width: '16%' }}>Acciones</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filteredDocuments.map((doc) => {
                                    const docType = DOCUMENT_TYPES[doc.tipo] || { label: doc.tipo, color: 'var(--text-muted)' };
                                    const pendingCount = doc.asignaciones?.filter(a => a.estado === 'pendiente').length || 0;
                                    const signedCount = doc.asignaciones?.filter(a => a.estado === 'firmado').length || 0;
                                    const totalAssigned = doc.asignaciones?.length || 0;

                                    // Las asignaciones usan personaId (workerId es legacy): se comprueban ambos
                                    // para que quien asigna (prevencionista/supervisor) también pueda FIRMAR el
                                    // documento si se lo asignaron a sí mismo.
                                    const myAssignment = user?.personaId ? doc.asignaciones?.find(a => (a as any).personaId === user.personaId || a.workerId === user.personaId) : null;
                                    const isPendingForMe = myAssignment?.estado === 'pendiente';
                                    const isSignedByMe = myAssignment?.estado === 'firmado';
                                    const isExpanded = Boolean(expandedRows[doc.documentId]);
                                    const myStatusLabel = myAssignment
                                        ? myAssignment.estado === 'firmado'
                                            ? 'Firmado'
                                            : 'Pendiente'
                                        : 'No asignado';

                                    return (
                                        <Fragment key={doc.documentId}>
                                            <tr>
                                                <td>
                                                    <div className="flex items-start gap-3">
                                                        <div className="avatar avatar-sm" style={{ background: docType.color }}>
                                                            <FiFileText />
                                                        </div>
                                                        <div>
                                                            <div className="font-semibold" style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                                                                {doc.titulo}
                                                                {/* Alcance: empresa (sin obra) u obra específica. */}
                                                                {(() => {
                                                                    const oId = (doc as any).obraId;
                                                                    if (!oId) return <span className="badge" style={{ fontSize: '10px', background: 'rgba(0,110,220,0.12)', color: 'var(--primary-600)' }}>Empresa</span>;
                                                                    const o = obras.find((x: any) => x.obraId === oId);
                                                                    return <span className="badge badge-neutral" style={{ fontSize: '10px' }}>{o?.nombre || 'Obra'}</span>;
                                                                })()}
                                                            </div>
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
                                                                {doc.descripcion || 'Sin descripción'}
                                                            </div>
                                                        </div>
                                                    </div>
                                                </td>
                                                <td>
                                                    <span className="badge badge-neutral">{docType.label}</span>
                                                </td>
                                                <td>
                                                    <div className="text-sm">{signedCount}/{totalAssigned} firmados</div>
                                                    {pendingCount > 0 && (
                                                        <div className="text-xs text-muted">{pendingCount} pendientes</div>
                                                    )}
                                                </td>
                                                <td>
                                                    <div className="text-sm">{formatDateTime(doc.createdAt)}</div>
                                                </td>
                                                <td>
                                                    <div className="flex flex-wrap gap-2" style={{ alignItems: 'center' }}>
                                                        {doc.archivoUrl && (
                                                            <button
                                                                className="btn btn-ghost btn-icon btn-sm"
                                                                onClick={() => handleDownloadFile(doc)}
                                                                title="Descargar archivo"
                                                            >
                                                                <FiDownload />
                                                            </button>
                                                        )}
                                                        <button
                                                            className="btn btn-secondary btn-sm"
                                                            onClick={() => handleViewDetails(doc)}
                                                        >
                                                            <FiEye size={14} />
                                                            Ver
                                                        </button>
                                                        {canSubirDocumento && (
                                                            <button
                                                                className="btn btn-primary btn-sm"
                                                                onClick={() => handleOpenAssignModal(doc)}
                                                            >
                                                                <FiUserCheck size={14} />
                                                                Asignar
                                                            </button>
                                                        )}
                                                        {isPendingForMe && (
                                                            <button
                                                                className="btn btn-success btn-sm"
                                                                style={{ background: 'var(--success-600)', borderColor: 'var(--success-600)', color: 'white' }}
                                                                onClick={() => handleOpenSignModal(doc)}
                                                            >
                                                                <FiPenTool size={14} />
                                                                Firmar
                                                            </button>
                                                        )}
                                                        {isSignedByMe && (
                                                            <span className="badge badge-success flex items-center" style={{ height: 28 }}>
                                                                <FiCheck className="mr-1" /> Firmado
                                                            </span>
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
                                                    <td colSpan={5}>
                                                        <div className="table-expand-content">
                                                            <div>
                                                                <strong>Descripción:</strong> {doc.descripcion || 'Sin descripción'}
                                                            </div>
                                                            <div>
                                                                <strong>Archivo:</strong> {doc.archivoNombre || 'Sin archivo'}
                                                            </div>
                                                            <div>
                                                                <strong>Asignaciones:</strong> {signedCount}/{totalAssigned} firmados · {pendingCount} pendientes
                                                            </div>
                                                            <div>
                                                                <strong>Mi estado:</strong> {myStatusLabel}
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
                )}

                {/* Create Document Modal */}
                <Modal
                    isOpen={showModal}
                    onClose={() => { setShowModal(false); resetForm(); }}
                    title="Nuevo Documento"
                    preventClose={creating || uploading}
                    footer={
                        <>
                            <button type="button" className="btn btn-secondary" onClick={() => { setShowModal(false); resetForm(); }} disabled={creating || uploading}>Cancelar</button>
                            <button type="submit" form="create-doc-form" className="btn btn-primary" disabled={creating || uploading}>
                                {uploading ? (<><div className="spinner spinner-sm" />Subiendo...</>) : creating ? (<><div className="spinner spinner-sm" />Creando...</>) : 'Crear Documento'}
                            </button>
                        </>
                    }
                >
                    <form id="create-doc-form" onSubmit={handleCreateDocument}>
                        <div className="form-group">
                                        <label className="form-label">Tipo de Documento *</label>
                                        <Select
                                            ariaLabel="Tipo de documento"
                                            placeholder="Seleccione un tipo"
                                            searchable
                                            value={newDoc.tipo}
                                            onChange={(v) => setNewDoc({ ...newDoc, tipo: v })}
                                            options={tiposCreables(activeCategory)
                                                .map(([key, { label }]) => ({ value: key, label }))}
                                        />
                                        <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', marginTop: 2, display: 'block' }}>
                                            El IRL, Reglamento, Política SST, MIPER y similares se cargan desde Onboarding o el detalle de la obra, no aquí.
                                        </span>
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
                    </form>
                </Modal>

                {/* Document Detail Modal */}
                <Modal
                    isOpen={showDetailModal && !!selectedDocument}
                    onClose={() => setShowDetailModal(false)}
                    title={selectedDocument?.titulo || ''}
                    size="lg"
                    footer={
                        <>
                            {(user?.personaId && selectedDocument?.asignaciones?.some(a => ((a as any).personaId === user!.personaId || a.workerId === user!.personaId) && a.estado === 'pendiente')) && (
                                <button className="btn btn-success" style={{ background: 'var(--success-600)', color: 'white', marginRight: 'auto' }} onClick={() => { setShowDetailModal(false); setShowSignModal(true); }}>
                                    <FiPenTool className="inline mr-2" />Firmar Documento
                                </button>
                            )}
                            <button className="btn btn-secondary" onClick={() => setShowDetailModal(false)}>Cerrar</button>
                            {canSubirDocumento && (
                                <button className="btn btn-primary" onClick={() => { setShowDetailModal(false); selectedDocument && handleOpenAssignModal(selectedDocument); }}>
                                    <FiUserCheck />Asignar a mas personas
                                </button>
                            )}
                        </>
                    }
                >
                    {selectedDocument && (
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
                                        {/* Visualización inline del archivo (PDF / imagen). */}
                                        {(() => {
                                            const name = (selectedDocument.archivoNombre || selectedDocument.archivoUrl || '').toLowerCase();
                                            const isPdf = name.endsWith('.pdf');
                                            const isImg = /\.(png|jpe?g|gif|webp|svg)$/.test(name);
                                            if (!detailPreviewUrl) {
                                                return (
                                                    <div style={{ height: 120, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--surface-elevated)', borderRadius: 'var(--radius-md)', color: 'var(--text-muted)', fontSize: 'var(--text-sm)', marginBottom: 'var(--space-3)' }}>
                                                        <div className="spinner" style={{ marginRight: 8 }} /> Cargando vista previa…
                                                    </div>
                                                );
                                            }
                                            if (isPdf) {
                                                return <iframe title="Vista previa del documento" src={detailPreviewUrl} style={{ width: '100%', height: 420, border: '1px solid var(--surface-border)', borderRadius: 'var(--radius-md)', marginBottom: 'var(--space-3)' }} />;
                                            }
                                            if (isImg) {
                                                return <img alt="Vista previa del documento" src={detailPreviewUrl} style={{ maxWidth: '100%', maxHeight: 420, borderRadius: 'var(--radius-md)', border: '1px solid var(--surface-border)', marginBottom: 'var(--space-3)', display: 'block' }} />;
                                            }
                                            return (
                                                <div style={{ padding: 'var(--space-4)', background: 'var(--surface-elevated)', borderRadius: 'var(--radius-md)', color: 'var(--text-muted)', fontSize: 'var(--text-sm)', marginBottom: 'var(--space-3)' }}>
                                                    Vista previa no disponible para este tipo de archivo. Usa “Descargar” para abrirlo.
                                                </div>
                                            );
                                        })()}
                                        <div className="flex gap-2">
                                            <button
                                                className="btn btn-primary"
                                                onClick={() => handleDownloadFile(selectedDocument)}
                                            >
                                                <FiDownload />
                                                Descargar Documento
                                            </button>
                                            {detailPreviewUrl && (
                                                <a className="btn btn-secondary" href={detailPreviewUrl} target="_blank" rel="noopener noreferrer">
                                                    <FiEye /> Abrir en pestaña
                                                </a>
                                            )}
                                        </div>
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
                                                            <td>
                                                                {assignment.fechaFirma ? (
                                                                    <div className="flex flex-col">
                                                                        <span>{formatDateTime(assignment.fechaFirma)}</span>
                                                                    </div>
                                                                ) : 'â€”'}
                                                            </td>
                                                            <td>
                                                                <span className={`badge ${assignment.estado === 'firmado' ? 'badge-success' : 'badge-warning'}`}>
                                                                    {assignment.estado === 'firmado' ? 'FIRMADO' : 'PENDIENTE'}
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
                    )}
                </Modal>
                {/* Assignment Modal */}
                <Modal
                    isOpen={showAssignModal && !!selectedDocument}
                    onClose={() => setShowAssignModal(false)}
                    title="Asignar Documento"
                    preventClose={assigning}
                    footer={
                        <>
                            <button className="btn btn-secondary" onClick={() => setShowAssignModal(false)} disabled={assigning}>Cancelar</button>
                            <button className="btn btn-primary" onClick={handleAssign} disabled={assigning || (assignmentType === 'cargo' && !selectedCargo) || (assignmentType === 'personalizado' && selectedWorkerIds.length === 0)}>
                                {assigning ? (<><div className="spinner spinner-sm" />Asignando...</>) : 'Asignar Documento'}
                            </button>
                        </>
                    }
                >
                                    <p className="mb-4">
                                        <strong>{selectedDocument?.titulo}</strong>
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
                                            <Select
                                                ariaLabel="Cargo"
                                                placeholder="Seleccione un cargo"
                                                searchable
                                                value={selectedCargo}
                                                onChange={setSelectedCargo}
                                                options={uniqueCargos.map(cargo => ({ value: cargo, label: cargo }))}
                                            />
                                        </div>
                                    )}

                                    {assignmentType === 'personalizado' && (
                                        <div className="form-group">
                                            <div className="flex items-center justify-between mb-2" style={{ gap: 'var(--space-2)' }}>
                                                <label className="form-label" style={{ margin: 0 }}>
                                                    Seleccionar Trabajadores ({selectedWorkerIds.length} seleccionados)
                                                </label>
                                                <button
                                                    type="button"
                                                    className="btn btn-ghost btn-sm"
                                                    onClick={toggleSelectAllFiltered}
                                                    disabled={filteredWorkers.length === 0}
                                                >
                                                    {allFilteredSelected ? 'Quitar todos' : 'Seleccionar todos'}
                                                </button>
                                            </div>
                                            <div className="tbar-search" style={{ marginBottom: 'var(--space-2)' }}>
                                                <FiSearch size={15} />
                                                <input
                                                    type="text"
                                                    placeholder="Buscar por nombre, cargo o RUT…"
                                                    value={workerSearch}
                                                    onChange={(e) => setWorkerSearch(e.target.value)}
                                                />
                                            </div>
                                            <div style={{ maxHeight: '200px', overflowY: 'auto', border: '1px solid var(--surface-border)', borderRadius: 'var(--radius-md)' }}>
                                                {filteredWorkers.length === 0 ? (
                                                    <div className="text-sm text-muted" style={{ padding: 'var(--space-3)' }}>
                                                        No hay trabajadores que coincidan con la búsqueda.
                                                    </div>
                                                ) : filteredWorkers.map(worker => (
                                                    <label
                                                        key={worker.personaId}
                                                        className="flex items-center gap-2"
                                                        style={{
                                                            padding: 'var(--space-2) var(--space-3)',
                                                            cursor: 'pointer',
                                                            borderBottom: '1px solid var(--surface-border)',
                                                            background: selectedWorkerIds.includes(worker.personaId) ? 'var(--primary-500/10)' : 'transparent'
                                                        }}
                                                    >
                                                        <input
                                                            type="checkbox"
                                                            checked={selectedWorkerIds.includes(worker.personaId)}
                                                            onChange={() => toggleWorkerSelection(worker.personaId)}
                                                        />
                                                        <span>{worker.nombre} {worker.apellido}</span>
                                                        <span className="text-sm text-muted">- {worker.cargo || 'Sin cargo'}</span>
                                                        {!(worker as any).habilitado && <span className="badge badge-warning" style={{ fontSize: '10px' }}>pendiente</span>}
                                                    </label>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    {assignmentType === 'todos' && (
                                        <p className="text-muted">
                                            Se asignará a {workers.length} persona(s) de la obra. Las que aún no se enrolan podrán firmar una vez activen su cuenta.
                                        </p>
                                    )}
                </Modal>

                {/* Sign Modal */}
                <SignatureModal
                    isOpen={showSignModal && !!selectedDocument}
                    onClose={() => setShowSignModal(false)}
                    onConfirm={handleSign}
                    type="document"
                    title="Firmar Documento"
                    itemName={selectedDocument?.titulo}
                    description="Al firmar, confirmas que has le\u00eddo y aceptas el contenido de este documento."
                    loading={signing}
                />
            </div >

        </>
    );
}
