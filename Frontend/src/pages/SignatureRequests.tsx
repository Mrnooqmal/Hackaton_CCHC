import { useState, useEffect, useRef } from 'react';
import Header from '../components/Header';
import {
    FiPlus,
    FiUsers,
    FiCheck,
    FiClock,
    FiX,
    FiUpload,
    FiFile,
    FiSearch,
    FiChevronDown,
    FiChevronUp,
    FiAlertCircle,
    FiSend,
    FiTrendingUp,
    FiRefreshCw,
    FiFilter,
    FiCalendar,
    FiFileText,
    FiArrowRight,
    FiBriefcase,
    FiShield,
    FiLayers,
} from 'react-icons/fi';
import {
    signatureRequestsApi,
    workersApi,
    uploadsApi,
    type SignatureRequest,
    type Worker,
    type DocumentoAdjunto,
} from '../api/client';
import { useAuth } from '../context/AuthContext';
import ConfirmModal from '../components/ConfirmModal';

export default function SignatureRequests() {
    const { user } = useAuth();
    const [requests, setRequests] = useState<SignatureRequest[]>([]);
    const [workers, setWorkers] = useState<Worker[]>([]);
    const [loading, setLoading] = useState(true);
    const [showModal, setShowModal] = useState(false);
    const [selectedRequest, setSelectedRequest] = useState<SignatureRequest | null>(null);
    const [filterStatus, setFilterStatus] = useState<string>('');
    const [searchTerm, setSearchTerm] = useState('');
    const [error, setError] = useState('');
    const [confirmCancel, setConfirmCancel] = useState<{
        isOpen: boolean;
        requestId?: string;
    }>({ isOpen: false });

    const [newRequest, setNewRequest] = useState({
        tipo: 'CHARLA_5MIN',
        titulo: '',
        descripcion: '',
        fechaLimite: '',
        ubicacion: '',
    });
    const [selectedWorkers, setSelectedWorkers] = useState<string[]>([]);
    const [uploadedDocs, setUploadedDocs] = useState<DocumentoAdjunto[]>([]);
    const [uploading, setUploading] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        loadData();
    }, []);

    const loadData = async () => {
        try {
            const [requestsRes, workersRes] = await Promise.all([
                signatureRequestsApi.list(),
                workersApi.list(),
            ]);

            if (requestsRes.success && requestsRes.data) {
                setRequests(requestsRes.data.requests);
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

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = e.target.files;
        if (!files || files.length === 0) return;

        setUploading(true);
        try {
            for (const file of Array.from(files)) {
                const result = await uploadsApi.uploadFile(file, 'solicitudes');
                if (result.success && result.data) {
                    setUploadedDocs(prev => [...prev, result.data!]);
                } else {
                    setError(`Error al subir ${file.name}: ${result.error}`);
                }
            }
        } finally {
            setUploading(false);
            if (fileInputRef.current) {
                fileInputRef.current.value = '';
            }
        }
    };

    const removeDocument = (index: number) => {
        setUploadedDocs(prev => prev.filter((_, i) => i !== index));
    };

    const handleCreateRequest = async (e: React.FormEvent) => {
        e.preventDefault();

        if (selectedWorkers.length === 0) {
            alert('Debe seleccionar al menos un trabajador');
            return;
        }

        if (!user?.userId) {
            alert('No hay usuario autenticado');
            return;
        }

        setSubmitting(true);
        try {
            const response = await signatureRequestsApi.create({
                tipo: newRequest.tipo,
                titulo: newRequest.titulo || REQUEST_TYPES[newRequest.tipo].label,
                descripcion: newRequest.descripcion,
                documentos: uploadedDocs,
                trabajadoresIds: selectedWorkers,
                solicitanteId: user.userId,
                fechaLimite: newRequest.fechaLimite || undefined,
                ubicacion: newRequest.ubicacion || undefined,
            });

            if (response.success && response.data) {
                setRequests([response.data, ...requests]);
                resetForm();
                setShowModal(false);
            } else {
                setError(response.error || 'Error al crear solicitud');
            }
        } catch (error) {
            console.error('Error creating request:', error);
            setError('Error al crear solicitud');
        } finally {
            setSubmitting(false);
        }
    };

    const resetForm = () => {
        setNewRequest({
            tipo: 'CHARLA_5MIN',
            titulo: '',
            descripcion: '',
            fechaLimite: '',
            ubicacion: '',
        });
        setSelectedWorkers([]);
        setUploadedDocs([]);
    };

    const toggleWorkerSelection = (workerId: string) => {
        setSelectedWorkers(prev =>
            prev.includes(workerId)
                ? prev.filter(id => id !== workerId)
                : [...prev, workerId]
        );
    };

    const selectAllWorkers = () => {
        if (selectedWorkers.length === workers.length) {
            setSelectedWorkers([]);
        } else {
            setSelectedWorkers(workers.map(w => w.workerId));
        }
    };

    const handleCancelRequest = (requestId: string) => {
        setConfirmCancel({ isOpen: true, requestId });
    };

    const confirmHandleCancel = async () => {
        const requestId = confirmCancel.requestId;
        if (!requestId) return;

        setConfirmCancel({ isOpen: false });
        try {
            const response = await signatureRequestsApi.cancel(requestId, 'Cancelada por el solicitante');
            if (response.success) {
                loadData();
            } else {
                setError(response.error || 'Error al cancelar solicitud');
            }
        } catch (error) {
            console.error('Error canceling request:', error);
            setError('Error de conexión al cancelar solicitud');
        }
    };

    const REQUEST_TYPES: Record<string, { label: string; icon: React.ReactNode; color: string; requiresDoc?: boolean }> = {
        CHARLA_5MIN: {
            label: 'Charla 5 Minutos',
            icon: <FiClock />,
            color: 'var(--primary-500)',
            requiresDoc: true
        },
        CAPACITACION: {
            label: 'Capacitación',
            icon: <FiLayers />,
            color: 'var(--info-500)',
            requiresDoc: true
        },
        ENTREGA_EPP: {
            label: 'Entrega EPP',
            icon: <FiShield />,
            color: 'var(--success-500)',
            requiresDoc: true
        },
        DOCUMENTO_GENERAL: {
            label: 'Documento General',
            icon: <FiFileText />,
            color: 'var(--warning-500)',
            requiresDoc: true
        },
        OTRO: {
            label: 'Otro',
            icon: <FiBriefcase />,
            color: 'var(--neutral-500)'
        },
    };

    const getStatusBadge = (estado: string) => {
        const badges: Record<string, { color: string; icon: React.ReactNode; label: string }> = {
            pendiente: { color: 'var(--warning-500)', icon: <FiClock />, label: 'Pendiente' },
            en_proceso: { color: 'var(--info-500)', icon: <FiUsers />, label: 'En Proceso' },
            completada: { color: 'var(--success-500)', icon: <FiCheck />, label: 'Completada' },
            cancelada: { color: 'var(--error-500)', icon: <FiX />, label: 'Cancelada' },
            vencida: { color: 'var(--neutral-500)', icon: <FiAlertCircle />, label: 'Vencida' },
        };
        const badge = badges[estado] || badges.pendiente;
        return (
            <span className="badge" style={{ background: badge.color, color: 'white', display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '6px 12px', borderRadius: '20px', fontSize: '12px', fontWeight: 600 }}>
                <span style={{ display: 'flex' }}>{badge.icon}</span> {badge.label}
            </span>
        );
    };

    const filteredRequests = requests.filter(req => {
        const matchesStatus = !filterStatus || req.estado === filterStatus;
        const matchesSearch = !searchTerm ||
            req.titulo.toLowerCase().includes(searchTerm.toLowerCase()) ||
            req.solicitanteNombre.toLowerCase().includes(searchTerm.toLowerCase());
        return matchesStatus && matchesSearch;
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
            <Header title="Solicitudes de Firma" />

            <div className="page-content">
                <div className="survey-hero mb-8">
                    <div className="survey-hero-icon">
                        <FiSend size={28} />
                    </div>

                    {error && (
                        <div className="alert alert-danger mb-6 flex justify-between items-center">
                            <div className="flex items-center gap-3">
                                <FiAlertCircle />
                                {error}
                            </div>
                            <button onClick={() => setError('')} className="btn-ghost btn-sm p-1">
                                <FiX />
                            </button>
                        </div>
                    )}
                    <div style={{ flex: 1 }}>
                        <div className="survey-hero-eyebrow">Gestión de Solicitudes</div>
                        <h2 style={{ fontSize: 'var(--text-2xl)', fontWeight: 700, marginBottom: 'var(--space-2)' }}>
                            Administra las solicitudes de firma
                        </h2>
                        <p className="text-sm text-muted" style={{ maxWidth: '600px' }}>
                            Las solicitudes de firma se generan automáticamente desde actividades, capacitaciones y documentos asignados. También puedes crear solicitudes manuales para casos especiales.
                        </p>
                    </div>
                    <button className="btn btn-secondary" onClick={loadData} disabled={loading} style={{ padding: '10px 20px' }}>
                        <FiRefreshCw className={loading ? 'spin' : ''} /> Actualizar
                    </button>
                </div>

                <div className="grid grid-cols-4 mb-6">
                    <div className="card stat-card">
                        <div className="flex items-center gap-3 mb-1">
                            <div className="avatar avatar-sm" style={{ background: 'var(--warning-500)' }}>
                                <FiClock />
                            </div>
                            <span className="text-xs text-muted">Pendientes</span>
                        </div>
                        <div className="stat-value">{requests.filter(r => r.estado === 'pendiente').length}</div>
                        <div className="stat-change" style={{ color: 'var(--warning-500)' }}>
                            <FiAlertCircle size={14} />
                            Esperando firmas
                        </div>
                    </div>
                    <div className="card stat-card">
                        <div className="flex items-center gap-3 mb-1">
                            <div className="avatar avatar-sm" style={{ background: 'var(--info-500)' }}>
                                <FiUsers />
                            </div>
                            <span className="text-xs text-muted">En Proceso</span>
                        </div>
                        <div className="stat-value">{requests.filter(r => r.estado === 'en_proceso').length}</div>
                        <div className="stat-change" style={{ color: 'var(--info-500)' }}>
                            <FiTrendingUp size={14} />
                            Firmas parciales
                        </div>
                    </div>
                    <div className="card stat-card">
                        <div className="flex items-center gap-3 mb-1">
                            <div className="avatar avatar-sm" style={{ background: 'var(--success-500)' }}>
                                <FiCheck />
                            </div>
                            <span className="text-xs text-muted">Completadas</span>
                        </div>
                        <div className="stat-value">{requests.filter(r => r.estado === 'completada').length}</div>
                        <div className="stat-change positive">
                            <FiCheck size={14} />
                            100% firmadas
                        </div>
                    </div>
                    <div className="card stat-card">
                        <div className="flex items-center gap-3 mb-1">
                            <div className="avatar avatar-sm" style={{ background: 'var(--primary-500)' }}>
                                <FiFileText />
                            </div>
                            <span className="text-xs text-muted">Total</span>
                        </div>
                        <div className="stat-value">{requests.length}</div>
                        <div className="stat-change positive">
                            <FiSend size={14} />
                            Solicitudes creadas
                        </div>
                    </div>
                </div>

                <div className="card signature-filters-card">
                    <div className="flex items-center justify-between gap-4 signature-actions-bar">
                        <div className="flex items-center gap-4 flex-1 signature-actions-bar">
                            <div style={{ position: 'relative', flex: 1, maxWidth: '400px' }}>
                                <input
                                    type="text"
                                    placeholder="Buscar por título o solicitante..."
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                    className="form-input"
                                    style={{ paddingLeft: '48px', height: '44px', borderRadius: '12px' }}
                                />
                                <FiSearch
                                    size={20}
                                    style={{
                                        position: 'absolute',
                                        left: '16px',
                                        top: '50%',
                                        transform: 'translateY(-50%)',
                                        color: 'var(--text-muted)'
                                    }}
                                />
                            </div>
                            <div style={{ position: 'relative' }}>
                                <select
                                    value={filterStatus}
                                    onChange={(e) => setFilterStatus(e.target.value)}
                                    className="form-input"
                                    style={{ paddingLeft: '48px', minWidth: '200px', height: '44px', borderRadius: '12px', cursor: 'pointer' }}
                                >
                                    <option value="">Todos los estados</option>
                                    <option value="pendiente">Pendiente</option>
                                    <option value="en_proceso">En Proceso</option>
                                    <option value="completada">Completada</option>
                                    <option value="cancelada">Cancelada</option>
                                </select>
                                <FiFilter
                                    size={20}
                                    style={{
                                        position: 'absolute',
                                        left: '16px',
                                        top: '50%',
                                        transform: 'translateY(-50%)',
                                        color: 'var(--text-muted)',
                                        pointerEvents: 'none'
                                    }}
                                />
                            </div>
                            {(searchTerm || filterStatus) && (
                                <button
                                    className="btn btn-ghost btn-sm"
                                    onClick={() => { setSearchTerm(''); setFilterStatus(''); }}
                                    style={{ color: 'var(--text-muted)', height: '44px' }}
                                >
                                    <FiX size={18} /> Limpiar
                                </button>
                            )}
                        </div>
                        <button
                            className="btn btn-primary"
                            onClick={() => setShowModal(true)}
                            style={{ boxShadow: 'var(--shadow-glow-primary)', height: '44px', padding: '0 24px' }}
                        >
                            <FiPlus size={20} />
                            Nueva Solicitud
                        </button>
                    </div>
                </div>

                <div className="card signature-list-container">
                    <div className="card-header signature-list-header">
                        <div>
                            <h2 className="card-title" style={{ fontSize: '20px', marginBottom: '4px' }}>Solicitudes de Firma</h2>
                            <p className="card-subtitle">Haz clic en una solicitud para ver los detalles</p>
                        </div>
                        {filteredRequests.length > 0 && (
                            <span className="badge" style={{ background: 'var(--primary-100)', color: 'var(--primary-700)', fontSize: '13px', padding: '6px 12px' }}>
                                {filteredRequests.length} solicitud{filteredRequests.length !== 1 ? 'es' : ''}
                            </span>
                        )}
                    </div>

                    <div className="signature-list-body">
                        {filteredRequests.length === 0 ? (
                            <div className="empty-state" style={{ padding: '60px 24px' }}>
                                <div className="empty-state-icon" style={{ fontSize: '3rem', marginBottom: 'var(--space-4)' }}>
                                    <FiFileText />
                                </div>
                                <h3 className="empty-state-title">No hay solicitudes</h3>
                                <p className="empty-state-description">
                                    {searchTerm || filterStatus
                                        ? 'No se encontraron solicitudes con los filtros aplicados.'
                                        : 'Crea tu primera solicitud de firma para comenzar.'
                                    }
                                </p>
                                {!searchTerm && !filterStatus && (
                                    <button className="btn btn-primary" onClick={() => setShowModal(true)} style={{ marginTop: '16px' }}>
                                        <FiPlus />
                                        Nueva Solicitud
                                    </button>
                                )}
                            </div>
                        ) : (
                            <>
                                <div className="scroll-hint">
                                    <FiArrowRight />
                                    <span>Desliza para ver más</span>
                                </div>
                                <div className="flex flex-col gap-4">
                                    {filteredRequests.map((request) => {
                                        const isExpanded = selectedRequest?.requestId === request.requestId;
                                        const progressPercent = (request.totalFirmados / request.totalRequeridos) * 100;
                                        const statusColors: Record<string, string> = {
                                            pendiente: 'var(--warning-400)',
                                            en_proceso: 'var(--info-400)',
                                            completada: 'var(--success-400)',
                                            cancelada: 'var(--error-400)',
                                            vencida: 'var(--neutral-400)',
                                        };

                                        return (
                                            <div
                                                key={request.requestId}
                                                className={`signature-request-card ${isExpanded ? 'expanded' : ''}`}
                                                data-status={request.estado}
                                                onClick={() => setSelectedRequest(isExpanded ? null : request)}
                                            >

                                                <div className="signature-card-main">
                                                    <div className="signature-card-info">
                                                        <div
                                                            className="signature-card-icon"
                                                            style={{
                                                                fontSize: '1.25rem',
                                                                background: 'var(--surface-card)',
                                                                width: '56px',
                                                                height: '56px',
                                                                flexShrink: 0,
                                                                boxShadow: 'var(--shadow-sm)',
                                                                border: '1px solid var(--surface-border)',
                                                                color: REQUEST_TYPES[request.tipo]?.color || 'var(--primary-500)',
                                                            }}
                                                        >
                                                            {REQUEST_TYPES[request.tipo]?.icon || <FiFileText />}
                                                        </div>
                                                        <div className="signature-card-details">
                                                            <div className="signature-card-badges">
                                                                <span
                                                                    className="badge"
                                                                    style={{
                                                                        background: 'var(--surface-hover)',
                                                                        color: 'var(--text-secondary)',
                                                                        fontSize: '11px',
                                                                        fontWeight: 600,
                                                                        textTransform: 'uppercase',
                                                                        letterSpacing: '0.5px',
                                                                        padding: '4px 10px'
                                                                    }}
                                                                >
                                                                    {REQUEST_TYPES[request.tipo]?.label}
                                                                </span>
                                                                {getStatusBadge(request.estado)}
                                                            </div>
                                                            <h3 className="signature-card-title">
                                                                {request.titulo}
                                                            </h3>
                                                            <div className="signature-card-meta">
                                                                <div className="flex items-center gap-2">
                                                                    <FiUsers size={14} style={{ color: 'var(--primary-500)' }} />
                                                                    <span>{request.solicitanteNombre}</span>
                                                                </div>
                                                                <div className="flex items-center gap-2">
                                                                    <FiCalendar size={14} style={{ color: 'var(--info-500)' }} />
                                                                    <span>{new Date(request.fechaCreacion).toLocaleDateString('es-CL', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                                                                </div>
                                                                {request.documentos.length > 0 && (
                                                                    <div className="flex items-center gap-2">
                                                                        <FiFile size={14} style={{ color: 'var(--text-muted)' }} />
                                                                        <span>{request.documentos.length} doc{request.documentos.length !== 1 ? 's' : ''}</span>
                                                                    </div>
                                                                )}
                                                            </div>
                                                        </div>
                                                    </div>

                                                    <div className="signature-card-actions">
                                                        <div className="signature-progress-circle">
                                                            <div
                                                                style={{
                                                                    position: 'relative',
                                                                    width: '60px',
                                                                    height: '60px',
                                                                    margin: '0 auto',
                                                                }}
                                                            >
                                                                <svg width="60" height="60" style={{ transform: 'rotate(-90deg)' }}>
                                                                    <circle
                                                                        cx="30"
                                                                        cy="30"
                                                                        r="26"
                                                                        fill="none"
                                                                        stroke="var(--surface-border)"
                                                                        strokeWidth="4"
                                                                    />
                                                                    <circle
                                                                        cx="30"
                                                                        cy="30"
                                                                        r="26"
                                                                        fill="none"
                                                                        stroke={progressPercent === 100 ? 'var(--success-500)' : 'var(--primary-500)'}
                                                                        strokeWidth="4"
                                                                        strokeDasharray={`${(progressPercent / 100) * 163.4} 163.4`}
                                                                        strokeLinecap="round"
                                                                    />
                                                                </svg>
                                                                <div style={{
                                                                    position: 'absolute',
                                                                    top: '50%',
                                                                    left: '50%',
                                                                    transform: 'translate(-50%, -50%)',
                                                                    fontSize: 'var(--text-sm)',
                                                                    fontWeight: 700,
                                                                    color: progressPercent === 100 ? 'var(--success-600)' : 'var(--primary-600)',
                                                                }}>
                                                                    {request.totalFirmados}/{request.totalRequeridos}
                                                                </div>
                                                            </div>
                                                            <div className="text-xs text-muted mt-2">Firmas</div>
                                                        </div>

                                                        <div className={`signature-expand-btn ${isExpanded ? 'active' : ''}`}>
                                                            {isExpanded ? <FiChevronUp size={18} /> : <FiChevronDown size={18} />}
                                                        </div>
                                                    </div>
                                                </div>

                                                {selectedRequest?.requestId === request.requestId && (
                                                    <div
                                                        className="signature-detail-section"
                                                        onClick={(e) => e.stopPropagation()}
                                                    >
                                                        {request.descripcion && (
                                                            <div className="signature-detail-box description">
                                                                <div className="flex items-center gap-2 mb-3 text-primary-600 font-semibold text-xs uppercase tracking-wider">
                                                                    <FiFileText size={14} /> Descripción
                                                                </div>
                                                                <p className="text-sm" style={{ margin: 0, lineHeight: 1.6, color: 'var(--text-primary)' }}>{request.descripcion}</p>
                                                            </div>
                                                        )}

                                                        {request.documentos.length > 0 && (
                                                            <div className="signature-detail-box">
                                                                <div className="signature-detail-header">
                                                                    <div className="signature-detail-title">
                                                                        <FiFile size={18} style={{ color: 'var(--primary-500)' }} />
                                                                        Documentos Adjuntos
                                                                    </div>
                                                                    <span className="badge" style={{ background: 'var(--primary-100)', color: 'var(--primary-700)', fontSize: '12px', fontWeight: 600, padding: '4px 10px' }}>
                                                                        {request.documentos.length}
                                                                    </span>
                                                                </div>
                                                                <div className="signature-docs-list">
                                                                    {request.documentos.map((doc, idx) => (
                                                                        <button
                                                                            key={idx}
                                                                            className="signature-doc-btn"
                                                                            onClick={async (e) => {
                                                                                e.preventDefault();
                                                                                e.stopPropagation();
                                                                                const res = await uploadsApi.getDownloadUrl(doc.url);
                                                                                if (res.success && res.data) {
                                                                                    window.open(res.data.downloadUrl, '_blank');
                                                                                }
                                                                            }}
                                                                        >
                                                                            <FiFile size={14} /> {doc.nombre}
                                                                        </button>
                                                                    ))}
                                                                </div>
                                                            </div>
                                                        )}

                                                        <div className="signature-detail-box">
                                                            <div className="signature-detail-header">
                                                                <div className="signature-detail-title">
                                                                    <FiUsers size={18} style={{ color: 'var(--primary-500)' }} />
                                                                    Progreso de Firmas
                                                                </div>
                                                                <span
                                                                    className="badge"
                                                                    style={{
                                                                        background: request.totalFirmados === request.totalRequeridos
                                                                            ? 'var(--success-500)'
                                                                            : 'var(--primary-500)',
                                                                        color: 'white',
                                                                        padding: '6px 12px',
                                                                        fontSize: '13px'
                                                                    }}
                                                                >
                                                                    {request.totalFirmados}/{request.totalRequeridos} firmados
                                                                </span>
                                                            </div>

                                                            <div
                                                                style={{
                                                                    height: '8px',
                                                                    background: 'var(--surface-hover)',
                                                                    borderRadius: 'var(--radius-full)',
                                                                    overflow: 'hidden',
                                                                    marginBottom: '20px',
                                                                }}
                                                            >
                                                                <div
                                                                    style={{
                                                                        height: '100%',
                                                                        width: `${(request.totalFirmados / request.totalRequeridos) * 100}%`,
                                                                        background: request.totalFirmados === request.totalRequeridos
                                                                            ? 'linear-gradient(90deg, var(--success-500), var(--success-400))'
                                                                            : 'linear-gradient(90deg, var(--primary-500), var(--primary-400))',
                                                                        borderRadius: 'var(--radius-full)',
                                                                        transition: 'width 0.3s ease',
                                                                    }}
                                                                />
                                                            </div>

                                                            <div className="signature-workers-grid">
                                                                {request.trabajadores.map((t) => (
                                                                    <div
                                                                        key={t.workerId}
                                                                        className={`signature-worker-item ${t.firmado ? 'signed' : ''}`}
                                                                    >
                                                                        <div className="signature-worker-avatar" style={{ background: t.firmado ? 'var(--success-500)' : 'var(--surface-hover)', color: t.firmado ? 'white' : 'var(--warning-500)' }}>
                                                                            {t.firmado ? <FiCheck size={16} /> : <FiClock size={16} />}
                                                                        </div>
                                                                        <div className="signature-worker-details">
                                                                            <div className="signature-worker-name">
                                                                                {t.nombre}
                                                                            </div>
                                                                            <div className="signature-worker-rut">{t.rut}</div>
                                                                            {t.firmado && t.fechaFirma && (
                                                                                <div className="signature-worker-date">
                                                                                    <FiCheck size={11} />
                                                                                    Firmó: {new Date(t.fechaFirma).toLocaleString('es-CL', {
                                                                                        day: '2-digit',
                                                                                        month: 'short',
                                                                                        hour: '2-digit',
                                                                                        minute: '2-digit',
                                                                                    })}
                                                                                </div>
                                                                            )}
                                                                        </div>
                                                                        {t.firmado && (
                                                                            <span
                                                                                className="badge"
                                                                                style={{
                                                                                    background: 'var(--success-100)',
                                                                                    color: 'var(--success-700)',
                                                                                    fontSize: '11px',
                                                                                    padding: '4px 8px'
                                                                                }}
                                                                            >
                                                                                ✓ Firmado
                                                                            </span>
                                                                        )}
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        </div>

                                                        {request.estado !== 'completada' && request.estado !== 'cancelada' && (
                                                            <div className="signature-cancel-action">
                                                                <button
                                                                    className="btn btn-danger"
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        handleCancelRequest(request.requestId);
                                                                    }}
                                                                    style={{ boxShadow: 'var(--shadow-sm)', padding: '10px 20px' }}
                                                                >
                                                                    <FiX size={16} /> Cancelar Solicitud
                                                                </button>
                                                            </div>
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            </>
                        )}
                    </div>
                </div>
            </div>

            {showModal && (
                <div className="modal-overlay" onClick={() => setShowModal(false)}>
                    <div
                        className="modal"
                        style={{
                            maxWidth: '1000px',
                            width: '95vw',
                            maxHeight: '90vh',
                            display: 'flex',
                            flexDirection: 'column',
                            borderRadius: '20px'
                        }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div
                            className="modal-header"
                            style={{
                                flexShrink: 0,
                                borderBottom: '1px solid var(--surface-border)',
                                padding: '24px',
                            }}
                        >
                            <div className="flex items-center gap-3">
                                <div
                                    className="avatar"
                                    style={{
                                        background: 'var(--gradient-primary)',
                                        boxShadow: 'var(--shadow-glow-primary)',
                                        width: '48px',
                                        height: '48px'
                                    }}
                                >
                                    <FiSend size={22} />
                                </div>
                                <div>
                                    <h2 style={{ fontSize: '22px', fontWeight: 700, marginBottom: '4px' }}>Nueva Solicitud de Firma</h2>
                                    <p className="text-sm text-muted">Completa los pasos para crear la solicitud</p>
                                </div>
                            </div>
                            <button className="btn btn-ghost btn-icon" onClick={() => { resetForm(); setShowModal(false); }} style={{ width: '44px', height: '44px' }}>
                                <FiX size={22} />
                            </button>
                        </div>

                        <form onSubmit={handleCreateRequest} style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
                            <div className="modal-body" style={{ flex: 1, overflowY: 'auto', padding: '24px' }}>

                                <div
                                    className="survey-section mb-8"
                                    style={{
                                        background: 'linear-gradient(135deg, rgba(76, 175, 80, 0.08), rgba(76, 175, 80, 0.02))',
                                        border: '1px solid rgba(76, 175, 80, 0.2)',
                                        padding: '24px',
                                        marginBottom: '24px',
                                        borderRadius: '16px'
                                    }}
                                >
                                    <div className="flex items-center gap-3 mb-4">
                                        <div
                                            className="avatar avatar-sm"
                                            style={{ background: 'var(--primary-500)', width: '36px', height: '36px' }}
                                        >
                                            <span style={{ fontSize: '15px', fontWeight: 700 }}>1</span>
                                        </div>
                                        <label className="font-semibold" style={{ margin: 0, fontSize: '16px' }}>
                                            Tipo de Solicitud
                                        </label>
                                    </div>
                                    <div style={{
                                        display: 'grid',
                                        gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
                                        gap: '12px'
                                    }}>
                                        {Object.entries(REQUEST_TYPES).map(([key, value]) => (
                                            <div
                                                key={key}
                                                style={{
                                                    cursor: 'pointer',
                                                    padding: '20px 12px',
                                                    borderRadius: '12px',
                                                    border: newRequest.tipo === key ? '2px solid var(--primary-500)' : '1px solid var(--surface-border)',
                                                    background: newRequest.tipo === key
                                                        ? 'linear-gradient(135deg, var(--primary-500), var(--primary-600))'
                                                        : 'var(--surface-card)',
                                                    color: newRequest.tipo === key ? 'white' : 'var(--text-primary)',
                                                    transition: 'all 0.2s',
                                                    display: 'flex',
                                                    flexDirection: 'column',
                                                    alignItems: 'center',
                                                    justifyContent: 'center',
                                                    gap: '8px',
                                                    textAlign: 'center',
                                                    minHeight: '100px',
                                                    boxShadow: newRequest.tipo === key ? 'var(--shadow-glow-primary)' : 'var(--shadow-sm)',
                                                }}
                                                onClick={() => setNewRequest({ ...newRequest, tipo: key, titulo: '' })}
                                            >
                                                <span style={{ fontSize: '1.75rem', display: 'flex' }}>{value.icon}</span>
                                                <span style={{ fontSize: '13px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>{value.label}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                <div
                                    className="mb-6 p-5"
                                    style={{
                                        background: 'var(--surface-elevated)',
                                        borderRadius: '16px',
                                        border: '1px solid var(--surface-border)',
                                    }}
                                >
                                    <div className="flex items-center gap-3 mb-4">
                                        <div
                                            className="avatar avatar-sm"
                                            style={{ background: 'var(--info-500)', width: '36px', height: '36px' }}
                                        >
                                            <span style={{ fontSize: '15px', fontWeight: 700 }}>2</span>
                                        </div>
                                        <label className="font-medium" style={{ margin: 0, fontSize: '16px' }}>
                                            Detalles de la Solicitud
                                        </label>
                                    </div>

                                    <div style={{
                                        display: 'grid',
                                        gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
                                        gap: '20px',
                                        marginBottom: '20px'
                                    }}>
                                        <div className="form-group" style={{ marginBottom: 0 }}>
                                            <label className="form-label" style={{ fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '8px' }}>Título (opcional)</label>
                                            <input
                                                type="text"
                                                className="form-input"
                                                placeholder={REQUEST_TYPES[newRequest.tipo].label}
                                                value={newRequest.titulo}
                                                onChange={(e) => setNewRequest({ ...newRequest, titulo: e.target.value })}
                                                style={{ borderRadius: '10px', padding: '12px 16px', height: '44px' }}
                                            />
                                        </div>
                                        <div className="form-group" style={{ marginBottom: 0 }}>
                                            <label className="form-label" style={{ fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '8px' }}>Fecha Límite (opcional)</label>
                                            <input
                                                type="date"
                                                className="form-input"
                                                value={newRequest.fechaLimite}
                                                onChange={(e) => setNewRequest({ ...newRequest, fechaLimite: e.target.value })}
                                                style={{ borderRadius: '10px', padding: '12px 16px', height: '44px' }}
                                            />
                                        </div>
                                    </div>

                                    <div className="form-group" style={{ marginBottom: 0 }}>
                                        <label className="form-label" style={{ fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '8px' }}>Descripción (opcional)</label>
                                        <textarea
                                            className="form-input"
                                            rows={3}
                                            placeholder="Agrega una descripción para dar contexto a los firmantes..."
                                            value={newRequest.descripcion}
                                            onChange={(e) => setNewRequest({ ...newRequest, descripcion: e.target.value })}
                                            style={{ resize: 'vertical', minHeight: '90px', borderRadius: '10px', padding: '12px 16px' }}
                                        />
                                    </div>
                                </div>

                                <div
                                    className="mb-6 p-5"
                                    style={{
                                        background: 'var(--surface-elevated)',
                                        borderRadius: '16px',
                                        border: '1px solid var(--surface-border)',
                                    }}
                                >
                                    <div className="flex items-center gap-3 mb-4">
                                        <div
                                            className="avatar avatar-sm"
                                            style={{ background: 'var(--warning-500)', width: '36px', height: '36px' }}
                                        >
                                            <span style={{ fontSize: '15px', fontWeight: 700 }}>3</span>
                                        </div>
                                        <div style={{ flex: 1 }}>
                                            <label className="font-medium" style={{ margin: 0, fontSize: '16px' }}>
                                                Documentos Adjuntos
                                                {REQUEST_TYPES[newRequest.tipo].requiresDoc && (
                                                    <span style={{ color: 'var(--danger-500)', marginLeft: '4px' }}>*</span>
                                                )}
                                            </label>
                                            <p className="text-sm text-muted" style={{ marginTop: '4px' }}>
                                                Sube los documentos que necesitan firma
                                            </p>
                                        </div>
                                        {uploadedDocs.length > 0 && (
                                            <span
                                                className="badge"
                                                style={{
                                                    background: 'var(--success-500)',
                                                    color: 'white',
                                                    fontSize: '13px',
                                                    padding: '6px 12px'
                                                }}
                                            >
                                                {uploadedDocs.length} archivo{uploadedDocs.length !== 1 ? 's' : ''}
                                            </span>
                                        )}
                                    </div>
                                    <input
                                        ref={fileInputRef}
                                        type="file"
                                        multiple
                                        accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png"
                                        onChange={handleFileUpload}
                                        style={{ display: 'none' }}
                                    />
                                    <div
                                        className="upload-zone"
                                        style={{
                                            border: '2px dashed var(--surface-border)',
                                            borderRadius: '12px',
                                            padding: '40px 24px',
                                            textAlign: 'center',
                                            cursor: 'pointer',
                                            background: 'var(--surface-card)',
                                            transition: 'all 0.2s',
                                            marginBottom: '12px'
                                        }}
                                        onClick={() => fileInputRef.current?.click()}
                                    >
                                        {uploading ? (
                                            <div className="flex items-center justify-center gap-3">
                                                <div className="spinner" />
                                                <span className="text-muted">Subiendo archivo...</span>
                                            </div>
                                        ) : (
                                            <>
                                                <div
                                                    className="avatar mb-4"
                                                    style={{
                                                        background: 'var(--surface-hover)',
                                                        margin: '0 auto',
                                                        width: '64px',
                                                        height: '64px'
                                                    }}
                                                >
                                                    <FiUpload size={28} style={{ color: 'var(--text-muted)' }} />
                                                </div>
                                                <p className="font-medium" style={{ marginBottom: '8px', fontSize: '16px' }}>Click para subir archivos</p>
                                                <p style={{ fontSize: '14px', color: 'var(--text-muted)' }}>PDF, Word, Excel, Imágenes (máx 10MB)</p>
                                            </>
                                        )}
                                    </div>
                                    {uploadedDocs.length > 0 && (
                                        <div className="flex gap-3 flex-wrap mt-4">
                                            {uploadedDocs.map((doc, idx) => (
                                                <div
                                                    key={idx}
                                                    className="flex items-center gap-2 p-3 pr-4"
                                                    style={{
                                                        background: 'linear-gradient(135deg, rgba(76, 175, 80, 0.1), rgba(76, 175, 80, 0.05))',
                                                        border: '1px solid var(--success-300)',
                                                        borderRadius: '10px',
                                                    }}
                                                >
                                                    <div
                                                        className="avatar avatar-sm"
                                                        style={{ background: 'var(--success-500)', width: '32px', height: '32px' }}
                                                    >
                                                        <FiFile size={14} />
                                                    </div>
                                                    <span className="text-sm font-medium" style={{ maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{doc.nombre}</span>
                                                    <button
                                                        type="button"
                                                        onClick={() => removeDocument(idx)}
                                                        className="btn btn-ghost btn-sm"
                                                        style={{ padding: '4px', marginLeft: '4px' }}
                                                    >
                                                        <FiX size={16} />
                                                    </button>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>

                                <div
                                    className="p-5"
                                    style={{
                                        background: 'var(--surface-elevated)',
                                        borderRadius: '16px',
                                        border: '1px solid var(--surface-border)',
                                    }}
                                >
                                    <div className="flex items-center justify-between mb-4">
                                        <div className="flex items-center gap-3">
                                            <div
                                                className="avatar avatar-sm"
                                                style={{ background: 'var(--success-500)', width: '36px', height: '36px' }}
                                            >
                                                <span style={{ fontSize: '15px', fontWeight: 700 }}>4</span>
                                            </div>
                                            <div>
                                                <label className="font-medium" style={{ margin: 0, fontSize: '16px' }}>
                                                    Asignar Firmantes
                                                    <span style={{ color: 'var(--danger-500)', marginLeft: '4px' }}>*</span>
                                                </label>
                                                <p className="text-sm text-muted" style={{ marginTop: '4px' }}>
                                                    Selecciona los trabajadores que deben firmar
                                                </p>
                                            </div>
                                            <span
                                                className="badge"
                                                style={{
                                                    background: selectedWorkers.length > 0 ? 'var(--primary-500)' : 'var(--surface-hover)',
                                                    color: selectedWorkers.length > 0 ? 'white' : 'var(--text-muted)',
                                                    fontSize: '13px',
                                                    padding: '6px 12px'
                                                }}
                                            >
                                                {selectedWorkers.length} de {workers.length}
                                            </span>
                                        </div>
                                        <button
                                            type="button"
                                            className="btn btn-secondary btn-sm"
                                            onClick={selectAllWorkers}
                                            style={{ padding: '8px 16px', height: '36px' }}
                                        >
                                            {selectedWorkers.length === workers.length ? (
                                                <><FiX size={16} /> Desestimar</>
                                            ) : (
                                                <><FiCheck size={16} /> Seleccionar todos</>
                                            )}
                                        </button>
                                    </div>
                                    <div
                                        style={{
                                            maxHeight: '320px',
                                            overflowY: 'auto',
                                            padding: '8px',
                                            background: 'var(--surface-card)',
                                            borderRadius: '12px',
                                            border: '1px solid var(--surface-border)',
                                            display: 'grid',
                                            gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
                                            gap: '8px'
                                        }}
                                    >
                                        {workers.map((worker) => {
                                            const isSelected = selectedWorkers.includes(worker.workerId);
                                            return (
                                                <label
                                                    key={worker.workerId}
                                                    style={{
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        gap: '12px',
                                                        padding: '12px',
                                                        borderRadius: '10px',
                                                        cursor: 'pointer',
                                                        background: isSelected
                                                            ? 'linear-gradient(135deg, rgba(76, 175, 80, 0.12), rgba(76, 175, 80, 0.06))'
                                                            : 'var(--surface-elevated)',
                                                        border: isSelected
                                                            ? '1px solid var(--primary-400)'
                                                            : '1px solid var(--surface-border)',
                                                        transition: 'all 0.15s',
                                                        boxShadow: isSelected ? 'var(--shadow-sm)' : 'none',
                                                    }}
                                                >
                                                    <div
                                                        className="avatar avatar-sm"
                                                        style={{
                                                            background: isSelected ? 'var(--primary-500)' : 'var(--surface-hover)',
                                                            color: isSelected ? 'white' : 'var(--text-muted)',
                                                            transition: 'all 0.15s',
                                                            width: '36px',
                                                            height: '36px'
                                                        }}
                                                    >
                                                        {isSelected ? <FiCheck size={16} /> : <FiUsers size={16} />}
                                                    </div>
                                                    <input
                                                        type="checkbox"
                                                        checked={isSelected}
                                                        onChange={() => toggleWorkerSelection(worker.workerId)}
                                                        style={{ display: 'none' }}
                                                    />
                                                    <div style={{ flex: 1, minWidth: 0 }}>
                                                        <div style={{
                                                            fontSize: '14px',
                                                            fontWeight: 500,
                                                            display: 'flex',
                                                            alignItems: 'center',
                                                            gap: '6px',
                                                            flexWrap: 'wrap',
                                                            marginBottom: '4px'
                                                        }}>
                                                            <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                                                {worker.nombre} {worker.apellido}
                                                            </span>
                                                            {(worker as any).rol && (
                                                                <span style={{
                                                                    fontSize: '10px',
                                                                    padding: '3px 8px',
                                                                    borderRadius: '12px',
                                                                    background: (worker as any).rol === 'prevencionista' ? 'var(--primary-500)' : 'var(--info-500)',
                                                                    color: 'white',
                                                                    textTransform: 'capitalize'
                                                                }}>
                                                                    {(worker as any).rol}
                                                                </span>
                                                            )}
                                                            {!worker.habilitado && (
                                                                <span style={{
                                                                    fontSize: '10px',
                                                                    padding: '3px 8px',
                                                                    borderRadius: '12px',
                                                                    background: 'var(--warning-100)',
                                                                    color: 'var(--warning-700)'
                                                                }}>
                                                                    Sin enrolar
                                                                </span>
                                                            )}
                                                        </div>
                                                        <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                                                            {worker.cargo} • {worker.rut}
                                                        </div>
                                                    </div>
                                                </label>
                                            );
                                        })}
                                    </div>
                                    {workers.filter(w => !w.habilitado).length > 0 && (
                                        <div
                                            className="flex items-center gap-3 mt-4 p-4"
                                            style={{
                                                background: 'var(--warning-50)',
                                                borderRadius: '10px',
                                                border: '1px solid var(--warning-200)',
                                            }}
                                        >
                                            <FiAlertCircle style={{ color: 'var(--warning-600)', flexShrink: 0, fontSize: '18px' }} />
                                            <p className="text-sm" style={{ margin: 0, color: 'var(--warning-700)' }}>
                                                Las personas sin enrolar pueden ser asignadas pero no podrán firmar hasta completar su enrolamiento
                                            </p>
                                        </div>
                                    )}
                                </div>
                            </div>

                            <div
                                className="modal-footer"
                                style={{
                                    flexShrink: 0,
                                    borderTop: '1px solid var(--surface-border)',
                                    padding: '20px 24px',
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    alignItems: 'center',
                                    background: 'var(--surface-elevated)',
                                }}
                            >
                                <div className="flex items-center gap-2">
                                    {selectedWorkers.length === 0 ? (
                                        <>
                                            <FiAlertCircle style={{ color: 'var(--warning-500)', fontSize: '18px' }} />
                                            <span className="text-sm text-muted">Selecciona al menos un firmante</span>
                                        </>
                                    ) : (
                                        <>
                                            <FiCheck style={{ color: 'var(--success-500)', fontSize: '18px' }} />
                                            <span className="text-sm" style={{ color: 'var(--success-600)', fontWeight: 500 }}>{selectedWorkers.length} firmante{selectedWorkers.length !== 1 ? 's' : ''} seleccionado{selectedWorkers.length !== 1 ? 's' : ''}</span>
                                        </>
                                    )}
                                </div>
                                <div className="flex gap-3">
                                    <button
                                        type="button"
                                        className="btn btn-secondary"
                                        onClick={() => { resetForm(); setShowModal(false); }}
                                        style={{ padding: '10px 20px', height: '44px' }}
                                    >
                                        <FiX size={18} /> Cancelar
                                    </button>
                                    <button
                                        type="submit"
                                        className="btn btn-primary"
                                        disabled={submitting || selectedWorkers.length === 0 || (REQUEST_TYPES[newRequest.tipo].requiresDoc && uploadedDocs.length === 0)}
                                        style={{
                                            boxShadow: selectedWorkers.length > 0 ? 'var(--shadow-glow-primary)' : 'none',
                                            padding: '10px 24px',
                                            height: '44px'
                                        }}
                                    >
                                        {submitting ? (
                                            <>
                                                <div className="spinner" style={{ width: '18px', height: '18px' }} />
                                                Creando...
                                            </>
                                        ) : (
                                            <>
                                                <FiSend size={18} />
                                                Crear Solicitud
                                            </>
                                        )}
                                    </button>
                                </div>
                            </div>
                        </form>
                    </div>
                </div>
            )}
            <ConfirmModal
                isOpen={confirmCancel.isOpen}
                title="¿Cancelar solicitud?"
                message="Esta acción detendrá el proceso de firma para todos los trabajadores pendientes. Los datos registrados hasta ahora se mantendrán pero no se podrán agregar más firmas."
                confirmLabel="Sí, Cancelar Solicitud"
                cancelLabel="No, Mantener Activa"
                variant="danger"
                onConfirm={confirmHandleCancel}
                onCancel={() => setConfirmCancel({ isOpen: false })}
            />
        </>
    );
}