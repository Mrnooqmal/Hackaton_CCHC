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
} from 'react-icons/fi';
import {
    signatureRequestsApi,
    workersApi,
    uploadsApi,
    type SignatureRequest,
    type Worker,
    type DocumentoAdjunto,
    REQUEST_TYPES,
} from '../api/client';
import { useAuth } from '../context/AuthContext';

export default function SignatureRequests() {
    const { user } = useAuth();
    const [requests, setRequests] = useState<SignatureRequest[]>([]);
    const [workers, setWorkers] = useState<Worker[]>([]);
    const [loading, setLoading] = useState(true);
    const [showModal, setShowModal] = useState(false);
    const [selectedRequest, setSelectedRequest] = useState<SignatureRequest | null>(null);
    const [filterStatus, setFilterStatus] = useState<string>('');
    const [searchTerm, setSearchTerm] = useState('');

    // Form state
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
                    alert(`Error al subir ${file.name}: ${result.error}`);
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
                alert(response.error || 'Error al crear solicitud');
            }
        } catch (error) {
            console.error('Error creating request:', error);
            alert('Error al crear solicitud');
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
        // Seleccionar todos los workers (habilitados o no)
        if (selectedWorkers.length === workers.length) {
            setSelectedWorkers([]);
        } else {
            setSelectedWorkers(workers.map(w => w.workerId));
        }
    };

    const handleCancelRequest = async (requestId: string) => {
        if (!confirm('¿Está seguro de cancelar esta solicitud?')) return;

        try {
            const response = await signatureRequestsApi.cancel(requestId, 'Cancelada por el solicitante');
            if (response.success) {
                loadData();
            }
        } catch (error) {
            console.error('Error canceling request:', error);
        }
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
            <span className="badge" style={{ background: badge.color, color: 'white', display: 'flex', alignItems: 'center', gap: '4px' }}>
                {badge.icon} {badge.label}
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
                {/* Hero Section */}
                <div className="survey-hero mb-6">
                    <div className="survey-hero-icon">
                        <FiSend size={28} />
                    </div>
                    <div style={{ flex: 1 }}>
                        <div className="survey-hero-eyebrow">Gestión de Solicitudes</div>
                        <h2 style={{ fontSize: 'var(--text-xl)', fontWeight: 600, marginBottom: 'var(--space-1)' }}>
                            Administra las solicitudes de firma
                        </h2>
                        <p className="text-sm text-muted">
                            Crea, monitorea y gestiona solicitudes de firma para documentos, charlas y capacitaciones.
                        </p>
                    </div>
                    <button className="btn btn-secondary" onClick={loadData} disabled={loading}>
                        <FiRefreshCw className={loading ? 'spin' : ''} /> Actualizar
                    </button>
                </div>

                {/* Stats Cards */}
                <div className="grid grid-cols-4 mb-6">
                    <div className="card stat-card">
                        <div className="flex items-center gap-3 mb-4">
                            <div className="avatar" style={{ background: 'var(--warning-500)' }}>
                                <FiClock size={20} />
                            </div>
                            <span className="text-sm text-muted">Pendientes</span>
                        </div>
                        <div className="stat-value">{requests.filter(r => r.estado === 'pendiente').length}</div>
                        <div className="stat-change" style={{ color: 'var(--warning-500)' }}>
                            <FiAlertCircle size={14} />
                            Esperando firmas
                        </div>
                    </div>
                    <div className="card stat-card">
                        <div className="flex items-center gap-3 mb-4">
                            <div className="avatar" style={{ background: 'var(--info-500)' }}>
                                <FiUsers size={20} />
                            </div>
                            <span className="text-sm text-muted">En Proceso</span>
                        </div>
                        <div className="stat-value">{requests.filter(r => r.estado === 'en_proceso').length}</div>
                        <div className="stat-change" style={{ color: 'var(--info-500)' }}>
                            <FiTrendingUp size={14} />
                            Firmas parciales
                        </div>
                    </div>
                    <div className="card stat-card">
                        <div className="flex items-center gap-3 mb-4">
                            <div className="avatar" style={{ background: 'var(--success-500)' }}>
                                <FiCheck size={20} />
                            </div>
                            <span className="text-sm text-muted">Completadas</span>
                        </div>
                        <div className="stat-value">{requests.filter(r => r.estado === 'completada').length}</div>
                        <div className="stat-change positive">
                            <FiCheck size={14} />
                            100% firmadas
                        </div>
                    </div>
                    <div className="card stat-card">
                        <div className="flex items-center gap-3 mb-4">
                            <div className="avatar" style={{ background: 'var(--primary-500)' }}>
                                <FiFileText size={20} />
                            </div>
                            <span className="text-sm text-muted">Total</span>
                        </div>
                        <div className="stat-value">{requests.length}</div>
                        <div className="stat-change positive">
                            <FiSend size={14} />
                            Solicitudes creadas
                        </div>
                    </div>
                </div>

                {/* Filters and Actions */}
                <div 
                    className="card mb-6"
                    style={{
                        background: 'var(--surface-elevated)',
                        border: '1px solid var(--surface-border)',
                    }}
                >
                    <div className="flex items-center justify-between gap-4">
                        <div className="flex items-center gap-4 flex-1">
                            <div style={{ position: 'relative', flex: 1, maxWidth: '320px' }}>
                                <input
                                    type="text"
                                    placeholder="Buscar por título o solicitante..."
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                    className="form-input"
                                    style={{ paddingLeft: '44px' }}
                                />
                                <FiSearch
                                    size={18}
                                    style={{
                                        position: 'absolute',
                                        left: '14px',
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
                                    style={{ paddingLeft: '44px', minWidth: '180px', cursor: 'pointer' }}
                                >
                                    <option value="">Todos los estados</option>
                                    <option value="pendiente">⏳ Pendiente</option>
                                    <option value="en_proceso">👥 En Proceso</option>
                                    <option value="completada">✅ Completada</option>
                                    <option value="cancelada">❌ Cancelada</option>
                                </select>
                                <FiFilter
                                    size={18}
                                    style={{
                                        position: 'absolute',
                                        left: '14px',
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
                                    style={{ color: 'var(--text-muted)' }}
                                >
                                    <FiX size={16} /> Limpiar
                                </button>
                            )}
                        </div>
                        <button 
                            className="btn btn-primary"
                            onClick={() => setShowModal(true)}
                            style={{ boxShadow: 'var(--shadow-glow-primary)' }}
                        >
                            <FiPlus size={18} />
                            Nueva Solicitud
                        </button>
                    </div>
                </div>

                {/* Requests List */}
                <div className="card">
                    <div className="card-header">
                        <div>
                            <h2 className="card-title">Solicitudes de Firma</h2>
                            <p className="card-subtitle">Haz clic en una solicitud para ver los detalles</p>
                        </div>
                        {filteredRequests.length > 0 && (
                            <span className="badge" style={{ background: 'var(--primary-100)', color: 'var(--primary-700)' }}>
                                {filteredRequests.length} solicitud{filteredRequests.length !== 1 ? 'es' : ''}
                            </span>
                        )}
                    </div>

                    {filteredRequests.length === 0 ? (
                        <div className="empty-state" style={{ padding: 'var(--space-10)' }}>
                            <div className="empty-state-icon" style={{ fontSize: '3rem', marginBottom: 'var(--space-4)' }}>📋</div>
                            <h3 className="empty-state-title">No hay solicitudes</h3>
                            <p className="empty-state-description">
                                {searchTerm || filterStatus 
                                    ? 'No se encontraron solicitudes con los filtros aplicados.'
                                    : 'Crea tu primera solicitud de firma para comenzar.'
                                }
                            </p>
                            {!searchTerm && !filterStatus && (
                                <button className="btn btn-primary" onClick={() => setShowModal(true)}>
                                    <FiPlus />
                                    Nueva Solicitud
                                </button>
                            )}
                        </div>
                    ) : (
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
                                        style={{ 
                                            padding: 'var(--space-5)',
                                            borderRadius: 'var(--radius-xl)',
                                            border: isExpanded ? '2px solid var(--primary-400)' : '1px solid var(--surface-border)',
                                            background: isExpanded 
                                                ? 'linear-gradient(135deg, rgba(76, 175, 80, 0.06), rgba(76, 175, 80, 0.02))'
                                                : 'var(--surface-elevated)',
                                            cursor: 'pointer',
                                            transition: 'all var(--transition-normal)',
                                            position: 'relative',
                                            overflow: 'hidden',
                                        }}
                                        onClick={() => setSelectedRequest(isExpanded ? null : request)}
                                    >
                                        {/* Status indicator line */}
                                        <div style={{
                                            position: 'absolute',
                                            top: 0,
                                            left: 0,
                                            width: '4px',
                                            height: '100%',
                                            background: statusColors[request.estado] || 'var(--neutral-400)',
                                            borderRadius: 'var(--radius-xl) 0 0 var(--radius-xl)',
                                        }} />

                                        <div className="flex items-center justify-between">
                                            <div className="flex items-start gap-4" style={{ flex: 1 }}>
                                                <div 
                                                    className="avatar"
                                                    style={{ 
                                                        fontSize: '1.75rem',
                                                        background: 'var(--surface-card)',
                                                        width: '56px',
                                                        height: '56px',
                                                        boxShadow: 'var(--shadow-sm)',
                                                        border: '1px solid var(--surface-border)',
                                                    }}
                                                >
                                                    {REQUEST_TYPES[request.tipo]?.icon || '📝'}
                                                </div>
                                                <div style={{ flex: 1 }}>
                                                    <div className="flex items-center gap-2 mb-1">
                                                        <span 
                                                            className="badge" 
                                                            style={{ 
                                                                background: 'var(--surface-hover)', 
                                                                color: 'var(--text-secondary)',
                                                                fontSize: '11px',
                                                            }}
                                                        >
                                                            {REQUEST_TYPES[request.tipo]?.label}
                                                        </span>
                                                        {getStatusBadge(request.estado)}
                                                    </div>
                                                    <h3 style={{ fontSize: 'var(--text-lg)', fontWeight: 600, marginBottom: 'var(--space-1)' }}>
                                                        {request.titulo}
                                                    </h3>
                                                    <div className="flex flex-wrap items-center gap-3 text-sm text-muted">
                                                        <div className="flex items-center gap-1">
                                                            <FiUsers size={14} style={{ color: 'var(--primary-500)' }} />
                                                            <span>{request.solicitanteNombre}</span>
                                                        </div>
                                                        <div className="flex items-center gap-1">
                                                            <FiCalendar size={14} style={{ color: 'var(--info-500)' }} />
                                                            <span>{new Date(request.fechaCreacion).toLocaleDateString('es-CL', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                                                        </div>
                                                        {request.documentos.length > 0 && (
                                                            <div className="flex items-center gap-1">
                                                                <FiFile size={14} style={{ color: 'var(--text-muted)' }} />
                                                                <span>{request.documentos.length} doc{request.documentos.length !== 1 ? 's' : ''}</span>
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                            
                                            <div className="flex items-center gap-5">
                                                {/* Progress indicator */}
                                                <div style={{ textAlign: 'center', minWidth: '80px' }}>
                                                    <div 
                                                        style={{ 
                                                            position: 'relative',
                                                            width: '56px',
                                                            height: '56px',
                                                            margin: '0 auto',
                                                        }}
                                                    >
                                                        <svg width="56" height="56" style={{ transform: 'rotate(-90deg)' }}>
                                                            <circle
                                                                cx="28"
                                                                cy="28"
                                                                r="24"
                                                                fill="none"
                                                                stroke="var(--surface-border)"
                                                                strokeWidth="4"
                                                            />
                                                            <circle
                                                                cx="28"
                                                                cy="28"
                                                                r="24"
                                                                fill="none"
                                                                stroke={progressPercent === 100 ? 'var(--success-500)' : 'var(--primary-500)'}
                                                                strokeWidth="4"
                                                                strokeDasharray={`${(progressPercent / 100) * 150.8} 150.8`}
                                                                strokeLinecap="round"
                                                            />
                                                        </svg>
                                                        <div style={{
                                                            position: 'absolute',
                                                            top: '50%',
                                                            left: '50%',
                                                            transform: 'translate(-50%, -50%)',
                                                            fontSize: 'var(--text-xs)',
                                                            fontWeight: 700,
                                                            color: progressPercent === 100 ? 'var(--success-600)' : 'var(--primary-600)',
                                                        }}>
                                                            {request.totalFirmados}/{request.totalRequeridos}
                                                        </div>
                                                    </div>
                                                    <div className="text-xs text-muted mt-1">Firmas</div>
                                                </div>
                                                
                                                <div 
                                                    className="avatar avatar-sm"
                                                    style={{ 
                                                        background: isExpanded ? 'var(--primary-500)' : 'var(--surface-hover)',
                                                        color: isExpanded ? 'white' : 'var(--text-muted)',
                                                        transition: 'all var(--transition-fast)',
                                                    }}
                                                >
                                                    {isExpanded ? <FiChevronUp size={16} /> : <FiChevronDown size={16} />}
                                                </div>
                                            </div>
                                        </div>

                                    {/* Expanded Details */}
                                    {selectedRequest?.requestId === request.requestId && (
                                        <div 
                                            className="mt-5 pt-5" 
                                            style={{ borderTop: '1px dashed var(--surface-border)' }}
                                            onClick={(e) => e.stopPropagation()}
                                        >
                                            {request.descripcion && (
                                                <div 
                                                    className="mb-4 p-4"
                                                    style={{ 
                                                        background: 'rgba(255,255,255,0.5)',
                                                        borderRadius: 'var(--radius-lg)',
                                                        borderLeft: '3px solid var(--primary-400)',
                                                    }}
                                                >
                                                    <p className="text-sm\" style={{ margin: 0 }}>{request.descripcion}</p>
                                                </div>
                                            )}

                                            {/* Documents */}
                                            {request.documentos.length > 0 && (
                                                <div 
                                                    className="mb-4 p-4"
                                                    style={{ 
                                                        background: 'var(--surface-card)',
                                                        borderRadius: 'var(--radius-lg)',
                                                        border: '1px solid var(--surface-border)',
                                                    }}
                                                >
                                                    <div className="flex items-center gap-2 mb-3">
                                                        <FiFile size={16} style={{ color: 'var(--primary-500)' }} />
                                                        <h4 className="font-medium\" style={{ margin: 0 }}>Documentos Adjuntos</h4>
                                                        <span className="badge\" style={{ background: 'var(--primary-100)', color: 'var(--primary-700)', fontSize: '11px' }}>
                                                            {request.documentos.length}
                                                        </span>
                                                    </div>
                                                    <div className="flex gap-2 flex-wrap">
                                                        {request.documentos.map((doc, idx) => (
                                                            <button
                                                                key={idx}
                                                                className="btn btn-secondary btn-sm"
                                                                onClick={async (e) => {
                                                                    e.preventDefault();
                                                                    e.stopPropagation();
                                                                    const res = await uploadsApi.getDownloadUrl(doc.url);
                                                                    if (res.success && res.data) {
                                                                        window.open(res.data.downloadUrl, '_blank');
                                                                    }
                                                                }}
                                                                style={{ background: 'white' }}
                                                            >
                                                                <FiFile size={14} /> {doc.nombre}
                                                            </button>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}

                                            {/* Workers Progress */}
                                            <div 
                                                className="mb-4 p-4"
                                                style={{ 
                                                    background: 'var(--surface-card)',
                                                    borderRadius: 'var(--radius-lg)',
                                                    border: '1px solid var(--surface-border)',
                                                }}
                                            >
                                                <div className="flex items-center justify-between mb-3">
                                                    <div className="flex items-center gap-2">
                                                        <FiUsers size={16} style={{ color: 'var(--primary-500)' }} />
                                                        <h4 className="font-medium\" style={{ margin: 0 }}>Progreso de Firmas</h4>
                                                    </div>
                                                    <span 
                                                        className="badge"
                                                        style={{ 
                                                            background: request.totalFirmados === request.totalRequeridos 
                                                                ? 'var(--success-500)' 
                                                                : 'var(--primary-500)',
                                                            color: 'white',
                                                        }}
                                                    >
                                                        {request.totalFirmados}/{request.totalRequeridos} firmados
                                                    </span>
                                                </div>
                                                
                                                {/* Progress bar */}
                                                <div 
                                                    style={{ 
                                                        height: '8px',
                                                        background: 'var(--surface-hover)',
                                                        borderRadius: 'var(--radius-full)',
                                                        overflow: 'hidden',
                                                        marginBottom: 'var(--space-4)',
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
                                                
                                                <div 
                                                    className="grid gap-2" 
                                                    style={{ 
                                                        gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
                                                        maxHeight: '240px', 
                                                        overflowY: 'auto',
                                                        padding: 'var(--space-1)',
                                                    }}
                                                >
                                                    {request.trabajadores.map((t) => (
                                                        <div
                                                            key={t.workerId}
                                                            className="flex items-center gap-3 p-3"
                                                            style={{ 
                                                                background: t.firmado ? 'linear-gradient(135deg, rgba(76, 175, 80, 0.1), rgba(76, 175, 80, 0.05))' : 'var(--surface-elevated)',
                                                                borderRadius: 'var(--radius-md)',
                                                                border: t.firmado ? '1px solid var(--success-300)' : '1px solid var(--surface-border)',
                                                            }}
                                                        >
                                                            <div 
                                                                className="avatar avatar-sm"
                                                                style={{ 
                                                                    background: t.firmado ? 'var(--success-500)' : 'var(--surface-hover)',
                                                                    color: t.firmado ? 'white' : 'var(--warning-500)',
                                                                }}
                                                            >
                                                                {t.firmado ? <FiCheck size={14} /> : <FiClock size={14} />}
                                                            </div>
                                                            <div style={{ flex: 1, minWidth: 0 }}>
                                                                <div 
                                                                    className="font-medium text-sm" 
                                                                    style={{ 
                                                                        whiteSpace: 'nowrap',
                                                                        overflow: 'hidden',
                                                                        textOverflow: 'ellipsis',
                                                                    }}
                                                                >
                                                                    {t.nombre}
                                                                </div>
                                                                <div className="text-xs text-muted">{t.rut}</div>
                                                            </div>
                                                            {t.firmado && (
                                                                <span 
                                                                    className="badge"
                                                                    style={{ 
                                                                        background: 'var(--success-100)', 
                                                                        color: 'var(--success-700)',
                                                                        fontSize: '10px',
                                                                    }}
                                                                >
                                                                    ✓ Firmado
                                                                </span>
                                                            )}
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>

                                            {/* Actions */}
                                            {request.estado !== 'completada' && request.estado !== 'cancelada' && (
                                                <div className="flex gap-3">
                                                    <button
                                                        className="btn btn-danger"
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            handleCancelRequest(request.requestId);
                                                        }}
                                                        style={{ boxShadow: 'var(--shadow-sm)' }}
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
                    )}
                </div>
            </div>

            {/* Create Modal */}
            {showModal && (
                <div className="modal-overlay" onClick={() => setShowModal(false)}>
                    <div
                        className="modal"
                        style={{
                            maxWidth: '900px',
                            width: '95vw',
                            maxHeight: '90vh',
                            display: 'flex',
                            flexDirection: 'column'
                        }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div 
                            className="modal-header" 
                            style={{ 
                                flexShrink: 0,
                                borderBottom: '1px solid var(--surface-border)',
                                paddingBottom: 'var(--space-4)',
                            }}
                        >
                            <div className="flex items-center gap-3">
                                <div 
                                    className="avatar"
                                    style={{ 
                                        background: 'var(--gradient-primary)',
                                        boxShadow: 'var(--shadow-glow-primary)',
                                    }}
                                >
                                    <FiSend size={20} />
                                </div>
                                <div>
                                    <h2 style={{ fontSize: 'var(--text-lg)', fontWeight: 600 }}>Nueva Solicitud de Firma</h2>
                                    <p className="text-sm text-muted">Completa los pasos para crear la solicitud</p>
                                </div>
                            </div>
                            <button className="btn btn-ghost btn-icon" onClick={() => { resetForm(); setShowModal(false); }}>
                                <FiX size={20} />
                            </button>
                        </div>

                        <form onSubmit={handleCreateRequest} style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
                            <div className="modal-body" style={{ flex: 1, overflowY: 'auto', padding: 'var(--space-5)' }}>
                                
                                {/* Step 1: Type Selection */}
                                <div 
                                    className="survey-section mb-5"
                                    style={{ 
                                        background: 'linear-gradient(135deg, rgba(76, 175, 80, 0.08), rgba(76, 175, 80, 0.02))',
                                        border: '1px solid rgba(76, 175, 80, 0.2)',
                                        padding: 'var(--space-4)',
                                        marginBottom: 'var(--space-5)',
                                    }}
                                >
                                    <div className="flex items-center gap-2 mb-3">
                                        <div 
                                            className="avatar avatar-sm"
                                            style={{ background: 'var(--primary-500)' }}
                                        >
                                            <span style={{ fontSize: '12px', fontWeight: 700 }}>1</span>
                                        </div>
                                        <label className="font-medium" style={{ margin: 0 }}>
                                            Tipo de Solicitud
                                        </label>
                                    </div>
                                    <div style={{
                                        display: 'grid',
                                        gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
                                        gap: 'var(--space-2)'
                                    }}>
                                        {Object.entries(REQUEST_TYPES).map(([key, value]) => (
                                            <div
                                                key={key}
                                                style={{
                                                    cursor: 'pointer',
                                                    padding: 'var(--space-3)',
                                                    borderRadius: 'var(--radius-lg)',
                                                    border: newRequest.tipo === key ? '2px solid var(--primary-500)' : '1px solid var(--surface-border)',
                                                    background: newRequest.tipo === key 
                                                        ? 'linear-gradient(135deg, var(--primary-500), var(--primary-600))' 
                                                        : 'var(--surface-card)',
                                                    color: newRequest.tipo === key ? 'white' : 'var(--text-primary)',
                                                    transition: 'all 0.2s',
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: 'var(--space-2)',
                                                    boxShadow: newRequest.tipo === key ? 'var(--shadow-glow-primary)' : 'var(--shadow-sm)',
                                                }}
                                                onClick={() => setNewRequest({ ...newRequest, tipo: key, titulo: '' })}
                                            >
                                                <span style={{ fontSize: '1.4rem' }}>{value.icon}</span>
                                                <span style={{ fontSize: 'var(--text-sm)', fontWeight: 500 }}>{value.label}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                {/* Step 2: Details */}
                                <div 
                                    className="mb-5 p-4"
                                    style={{ 
                                        background: 'var(--surface-elevated)',
                                        borderRadius: 'var(--radius-xl)',
                                        border: '1px solid var(--surface-border)',
                                    }}
                                >
                                    <div className="flex items-center gap-2 mb-4">
                                        <div 
                                            className="avatar avatar-sm"
                                            style={{ background: 'var(--info-500)' }}
                                        >
                                            <span style={{ fontSize: '12px', fontWeight: 700 }}>2</span>
                                        </div>
                                        <label className="font-medium" style={{ margin: 0 }}>
                                            Detalles de la Solicitud
                                        </label>
                                    </div>
                                    
                                    <div style={{
                                        display: 'grid',
                                        gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                                        gap: 'var(--space-4)',
                                        marginBottom: 'var(--space-4)'
                                    }}>
                                        <div className="form-group" style={{ marginBottom: 0 }}>
                                            <label className="form-label">Título (opcional)</label>
                                            <input
                                                type="text"
                                                className="form-input"
                                                placeholder={REQUEST_TYPES[newRequest.tipo].label}
                                                value={newRequest.titulo}
                                                onChange={(e) => setNewRequest({ ...newRequest, titulo: e.target.value })}
                                            />
                                        </div>
                                        <div className="form-group" style={{ marginBottom: 0 }}>
                                            <label className="form-label">Fecha Límite (opcional)</label>
                                            <input
                                                type="date"
                                                className="form-input"
                                                value={newRequest.fechaLimite}
                                                onChange={(e) => setNewRequest({ ...newRequest, fechaLimite: e.target.value })}
                                            />
                                        </div>
                                    </div>

                                    <div className="form-group" style={{ marginBottom: 0 }}>
                                        <label className="form-label">Descripción (opcional)</label>
                                        <textarea
                                            className="form-input"
                                            rows={2}
                                            placeholder="Agrega una descripción para dar contexto a los firmantes..."
                                            value={newRequest.descripcion}
                                            onChange={(e) => setNewRequest({ ...newRequest, descripcion: e.target.value })}
                                            style={{ resize: 'vertical', minHeight: '70px' }}
                                        />
                                    </div>
                                </div>

                                {/* Step 3: Documents */}
                                <div 
                                    className="mb-5 p-4"
                                    style={{ 
                                        background: 'var(--surface-elevated)',
                                        borderRadius: 'var(--radius-xl)',
                                        border: '1px solid var(--surface-border)',
                                    }}
                                >
                                    <div className="flex items-center gap-2 mb-3">
                                        <div 
                                            className="avatar avatar-sm"
                                            style={{ background: 'var(--warning-500)' }}
                                        >
                                            <span style={{ fontSize: '12px', fontWeight: 700 }}>3</span>
                                        </div>
                                        <label className="font-medium" style={{ margin: 0 }}>
                                            Documentos Adjuntos
                                            {REQUEST_TYPES[newRequest.tipo].requiresDoc && (
                                                <span style={{ color: 'var(--danger-500)', marginLeft: '4px' }}>*</span>
                                            )}
                                        </label>
                                        {uploadedDocs.length > 0 && (
                                            <span 
                                                className="badge"
                                                style={{ 
                                                    background: 'var(--success-500)', 
                                                    color: 'white',
                                                    marginLeft: 'auto',
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
                                            borderRadius: 'var(--radius-lg)',
                                            padding: 'var(--space-5)',
                                            textAlign: 'center',
                                            cursor: 'pointer',
                                            background: 'var(--surface-card)',
                                            transition: 'all 0.2s'
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
                                                    className="avatar mb-3"
                                                    style={{ 
                                                        background: 'var(--surface-hover)',
                                                        margin: '0 auto',
                                                    }}
                                                >
                                                    <FiUpload size={24} style={{ color: 'var(--text-muted)' }} />
                                                </div>
                                                <p className="font-medium" style={{ marginBottom: '4px' }}>Click para subir archivos</p>
                                                <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>PDF, Word, Excel, Imágenes (máx 10MB)</p>
                                            </>
                                        )}
                                    </div>
                                    {uploadedDocs.length > 0 && (
                                        <div className="flex gap-2 flex-wrap mt-3">
                                            {uploadedDocs.map((doc, idx) => (
                                                <div 
                                                    key={idx} 
                                                    className="flex items-center gap-2 p-2 pr-3"
                                                    style={{ 
                                                        background: 'linear-gradient(135deg, rgba(76, 175, 80, 0.1), rgba(76, 175, 80, 0.05))',
                                                        border: '1px solid var(--success-300)',
                                                        borderRadius: 'var(--radius-md)',
                                                    }}
                                                >
                                                    <div 
                                                        className="avatar avatar-sm"
                                                        style={{ background: 'var(--success-500)', width: '28px', height: '28px' }}
                                                    >
                                                        <FiFile size={12} />
                                                    </div>
                                                    <span className="text-sm font-medium">{doc.nombre}</span>
                                                    <button
                                                        type="button"
                                                        onClick={() => removeDocument(idx)}
                                                        className="btn btn-ghost btn-sm"
                                                        style={{ padding: '4px', marginLeft: '4px' }}
                                                    >
                                                        <FiX size={14} />
                                                    </button>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>

                                {/* Step 4: Select Workers */}
                                <div 
                                    className="p-4"
                                    style={{ 
                                        background: 'var(--surface-elevated)',
                                        borderRadius: 'var(--radius-xl)',
                                        border: '1px solid var(--surface-border)',
                                    }}
                                >
                                    <div className="flex items-center justify-between mb-3">
                                        <div className="flex items-center gap-2">
                                            <div 
                                                className="avatar avatar-sm"
                                                style={{ background: 'var(--success-500)' }}
                                            >
                                                <span style={{ fontSize: '12px', fontWeight: 700 }}>4</span>
                                            </div>
                                            <label className="font-medium" style={{ margin: 0 }}>
                                                Asignar Firmantes
                                                <span style={{ color: 'var(--danger-500)', marginLeft: '4px' }}>*</span>
                                            </label>
                                            <span 
                                                className="badge"
                                                style={{
                                                    background: selectedWorkers.length > 0 ? 'var(--primary-500)' : 'var(--surface-hover)',
                                                    color: selectedWorkers.length > 0 ? 'white' : 'var(--text-muted)',
                                                }}
                                            >
                                                {selectedWorkers.length} de {workers.length}
                                            </span>
                                        </div>
                                        <button
                                            type="button"
                                            className="btn btn-secondary btn-sm"
                                            onClick={selectAllWorkers}
                                        >
                                            {selectedWorkers.length === workers.length ? (
                                                <><FiX size={14} /> Deseleccionar</>
                                            ) : (
                                                <><FiCheck size={14} /> Seleccionar todos</>
                                            )}
                                        </button>
                                    </div>
                                    <div
                                        style={{
                                            maxHeight: '280px',
                                            overflowY: 'auto',
                                            padding: 'var(--space-2)',
                                            background: 'var(--surface-card)',
                                            borderRadius: 'var(--radius-lg)',
                                            border: '1px solid var(--surface-border)',
                                            display: 'grid',
                                            gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
                                            gap: 'var(--space-2)'
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
                                                        gap: 'var(--space-3)',
                                                        padding: 'var(--space-3)',
                                                        borderRadius: 'var(--radius-md)',
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
                                                        }}
                                                    >
                                                        {isSelected ? <FiCheck size={14} /> : <FiUsers size={14} />}
                                                    </div>
                                                    <input
                                                        type="checkbox"
                                                        checked={isSelected}
                                                        onChange={() => toggleWorkerSelection(worker.workerId)}
                                                        style={{ display: 'none' }}
                                                    />
                                                    <div style={{ flex: 1, minWidth: 0 }}>
                                                        <div style={{
                                                            fontSize: 'var(--text-sm)',
                                                            fontWeight: 500,
                                                            display: 'flex',
                                                            alignItems: 'center',
                                                            gap: '6px',
                                                            flexWrap: 'wrap'
                                                        }}>
                                                            <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                                                {worker.nombre} {worker.apellido}
                                                            </span>
                                                            {(worker as any).rol && (
                                                                <span style={{
                                                                    fontSize: '9px',
                                                                    padding: '2px 6px',
                                                                    borderRadius: '10px',
                                                                    background: (worker as any).rol === 'prevencionista' ? 'var(--primary-500)' : 'var(--info-500)',
                                                                    color: 'white',
                                                                    textTransform: 'capitalize'
                                                                }}>
                                                                    {(worker as any).rol}
                                                                </span>
                                                            )}
                                                            {!worker.habilitado && (
                                                                <span style={{
                                                                    fontSize: '9px',
                                                                    padding: '2px 6px',
                                                                    borderRadius: '10px',
                                                                    background: 'var(--warning-100)',
                                                                    color: 'var(--warning-700)'
                                                                }}>
                                                                    Sin enrolar
                                                                </span>
                                                            )}
                                                        </div>
                                                        <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
                                                            {worker.cargo} • {worker.rut}
                                                        </div>
                                                    </div>
                                                </label>
                                            );
                                        })}
                                    </div>
                                    {workers.filter(w => !w.habilitado).length > 0 && (
                                        <div 
                                            className="flex items-center gap-2 mt-3 p-3"
                                            style={{ 
                                                background: 'var(--warning-50)',
                                                borderRadius: 'var(--radius-md)',
                                                border: '1px solid var(--warning-200)',
                                            }}
                                        >
                                            <FiAlertCircle style={{ color: 'var(--warning-600)', flexShrink: 0 }} />
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
                                    padding: 'var(--space-4) var(--space-5)', 
                                    display: 'flex', 
                                    justifyContent: 'space-between', 
                                    alignItems: 'center',
                                    background: 'var(--surface-elevated)',
                                }}
                            >
                                <div className="flex items-center gap-2">
                                    {selectedWorkers.length === 0 ? (
                                        <>
                                            <FiAlertCircle style={{ color: 'var(--warning-500)' }} />
                                            <span className="text-sm text-muted">Selecciona al menos un firmante</span>
                                        </>
                                    ) : (
                                        <>
                                            <FiCheck style={{ color: 'var(--success-500)' }} />
                                            <span className="text-sm\" style={{ color: 'var(--success-600)' }}>{selectedWorkers.length} firmante{selectedWorkers.length !== 1 ? 's' : ''} seleccionado{selectedWorkers.length !== 1 ? 's' : ''}</span>
                                        </>
                                    )}
                                </div>
                                <div className="flex gap-3">
                                    <button 
                                        type="button" 
                                        className="btn btn-secondary" 
                                        onClick={() => { resetForm(); setShowModal(false); }}
                                    >
                                        <FiX size={16} /> Cancelar
                                    </button>
                                    <button
                                        type="submit"
                                        className="btn btn-primary"
                                        disabled={submitting || selectedWorkers.length === 0 || (REQUEST_TYPES[newRequest.tipo].requiresDoc && uploadedDocs.length === 0)}
                                        style={{ 
                                            boxShadow: selectedWorkers.length > 0 ? 'var(--shadow-glow-primary)' : 'none',
                                        }}
                                    >
                                        {submitting ? (
                                            <>
                                                <div className="spinner" style={{ width: '16px', height: '16px' }} />
                                                Creando...
                                            </>
                                        ) : (
                                            <>
                                                <FiSend size={16} />
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
        </>
    );
}
