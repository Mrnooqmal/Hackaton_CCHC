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
    FiAlertCircle,
    FiSearch,
    FiSend,
    FiRefreshCw,
    FiUser,
    FiCalendar,
    FiFileText,
    FiArrowRight,
    FiBriefcase,
    FiShield,
    FiLayers,
    FiWifiOff,
    FiWifi,
    FiClipboard,
} from 'react-icons/fi';
import {
    signatureRequestsApi,
    signaturesApi,
    workersApi,
    uploadsApi,
    inboxApi,
    type SignatureRequest,
    type Worker,
    type DocumentoAdjunto,
} from '../api/client';
import { useAuth } from '../context/AuthContext';
import ConfirmModal from '../components/ConfirmModal';
import PinInput from '../components/PinInput';
import { useOfflineSignature, type OfflinePendingSignature } from '../hooks/useOfflineSignature';
import { Modal, AlertBanner } from '../components/ui';

type TabType = 'pendientes' | 'historial';

export default function SignatureRequests() {
    const { user } = useAuth();
    const { isOnline, pendingCount, syncPendingSignatures } = useOfflineSignature();
    const [activeTab, setActiveTab] = useState<TabType>('pendientes');
    const [requests, setRequests] = useState<SignatureRequest[]>([]);
    const [offlinePending, setOfflinePending] = useState<OfflinePendingSignature[]>([]);
    const [syncingOffline, setSyncingOffline] = useState(false);
    const [workers, setWorkers] = useState<Worker[]>([]);
    const [loading, setLoading] = useState(true);
    const [showModal, setShowModal] = useState(false);
    const [selectedRequest, setSelectedRequest] = useState<SignatureRequest | null>(null);
    const [error, setError] = useState('');
    const [successMsg, setSuccessMsg] = useState('');
    const [confirmCancel, setConfirmCancel] = useState<{
        isOpen: boolean;
        requestId?: string;
    }>({ isOpen: false });
    const [showDetailModal, setShowDetailModal] = useState(false);
    const [showSignModal, setShowSignModal] = useState(false);
    const [signing, setSigning] = useState(false);
    const [pin, setPin] = useState('');
    const [signError, setSignError] = useState('');

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
        loadOfflinePending();
    }, []);

    // Auto-sync when coming back online
    useEffect(() => {
        if (isOnline && pendingCount > 0) {
            handleSyncOffline();
        }
        loadOfflinePending();
    }, [isOnline]);

    const loadOfflinePending = () => {
        try {
            const stored = localStorage.getItem('pendingOfflineSignatures');
            const pending: OfflinePendingSignature[] = stored ? JSON.parse(stored) : [];
            setOfflinePending(pending.filter(s => !s.synced));
        } catch {
            setOfflinePending([]);
        }
    };

    const handleSyncOffline = async () => {
        setSyncingOffline(true);
        try {
            const result = await syncPendingSignatures();
            if (result.synced > 0) {
                loadData();
            }
            loadOfflinePending();
        } finally {
            setSyncingOffline(false);
        }
    };

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

    const getMimeType = (file: File): string => {
        if (file.type) return file.type;
        // Infer MIME type from extension when the browser doesn't set it
        const ext = file.name.split('.').pop()?.toLowerCase();
        const mimeMap: Record<string, string> = {
            pdf: 'application/pdf',
            doc: 'application/msword',
            docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            xls: 'application/vnd.ms-excel',
            xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            jpg: 'image/jpeg',
            jpeg: 'image/jpeg',
            png: 'image/png',
            gif: 'image/gif',
            webp: 'image/webp',
        };
        return mimeMap[ext || ''] || 'application/octet-stream';
    };

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = e.target.files;
        if (!files || files.length === 0) return;

        setUploading(true);
        try {
            for (const file of Array.from(files)) {
                // Create a new File with the correct MIME type if missing
                const mimeType = getMimeType(file);
                const fileToUpload = file.type ? file : new File([file], file.name, { type: mimeType });
                const result = await uploadsApi.uploadFile(fileToUpload, 'solicitudes');
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
                // FIXED MISSING NOTIFICATIONS (Frontend explicit push)
                try {
                    const recipientsRes = await inboxApi.getRecipients(user?.userId || '', user?.empresaId || '');
                    if (recipientsRes.success && recipientsRes.data) {
                        const allRecipients = recipientsRes.data.recipients;
                        // Map worker IDs to their RUTs, then find matching Inbox Recipients to extract userIds
                        const assignedRuts = workers.filter(w => selectedWorkers.includes(w.personaId)).map(w => w.rut);
                        const recipientUserIds = allRecipients.filter(r => assignedRuts.includes(r.rut)).map(r => r.userId);
                        
                        if (recipientUserIds.length > 0) {
                            const isUrgent = newRequest.fechaLimite && new Date(newRequest.fechaLimite) <= new Date(Date.now() + 48 * 60 * 60 * 1000); // <48hrs
                            await inboxApi.send({
                                senderId: user?.userId || 'system',
                                senderName: user ? `${user.nombre} ${user.apellido || ''}`.trim() : 'PrevencionApp',
                                senderRol: 'system',
                                recipientIds: recipientUserIds,
                                type: 'task',
                                priority: isUrgent ? 'urgent' : 'normal',
                                subject: `Firma requerida: ${newRequest.titulo || REQUEST_TYPES[newRequest.tipo].label}`,
                                content: `Se requiere tu firma para el documento "${newRequest.titulo || REQUEST_TYPES[newRequest.tipo].label}". Por favor firma a la brevedad.`,
                                linkedEntity: { type: 'signature-request', id: response.data.requestId }
                            });
                        }
                    }
                } catch (notifErr) {
                    console.error('Error mandando notificación desde frontend', notifErr);
                }

                setRequests([response.data, ...requests]);
                resetForm();
                setShowModal(false);
                setSuccessMsg(`Solicitud "${response.data.titulo}" creada exitosamente con ${response.data.totalRequeridos} firmante${response.data.totalRequeridos !== 1 ? 's' : ''}`);
                setTimeout(() => setSuccessMsg(''), 5000);
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
            setSelectedWorkers(workers.map(w => w.personaId));
        }
    };

    const openSignModal = (request: SignatureRequest, e?: React.MouseEvent) => {
        e?.stopPropagation();
        setSelectedRequest(request);
        setPin('');
        setSignError('');
        setShowSignModal(true);
    };

    const handleSign = async () => {
        if (!selectedRequest || !user?.personaId || pin.length !== 4) return;
        setSigning(true);
        setSignError('');
        try {
            const response = await signaturesApi.create({
                personaId: user.personaId,
                workerId: user.personaId,
                pin,
                requestId: selectedRequest.requestId,
            });
            if (response.success) {
                await loadData();
                setShowSignModal(false);
                setSelectedRequest(null);
                setPin('');
                setSuccessMsg('Documento firmado correctamente');
                setTimeout(() => setSuccessMsg(''), 5000);
            } else {
                setSignError(response.error || 'PIN incorrecto o error al firmar');
            }
        } catch {
            setSignError('Error de conexión al firmar');
        } finally {
            setSigning(false);
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
            requiresDoc: false
        },
        CAPACITACION: {
            label: 'Capacitación',
            icon: <FiLayers />,
            color: 'var(--info-500)',
            requiresDoc: true
        },
        INDUCCION: {
            label: 'Inducción',
            icon: <FiShield />,
            color: 'var(--success-600)',
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
        ART: {
            label: 'Análisis de Riesgos',
            icon: <FiAlertCircle />,
            color: 'var(--warning-500)',
            requiresDoc: true
        },
        PROCEDIMIENTO: {
            label: 'Procedimiento',
            icon: <FiFileText />,
            color: 'var(--info-600)',
            requiresDoc: true
        },
        INSPECCION: {
            label: 'Inspección',
            icon: <FiSearch />,
            color: 'var(--neutral-600)',
            requiresDoc: false
        },
        REGLAMENTO: {
            label: 'Reglamento Interno',
            icon: <FiFileText />,
            color: 'var(--primary-600)',
            requiresDoc: true
        },
        OTRO: {
            label: 'Otro',
            icon: <FiBriefcase />,
            color: 'var(--neutral-500)'
        },
    };

    const getStatusBadge = (estado: string, request?: SignatureRequest) => {
        // Si el usuario ya firmó pero la solicitud sigue activa, mostrar estado personal
        if (request && estado === 'en_proceso' && user?.personaId) {
            const myEntry = request.trabajadores.find(t => t.workerId === user.personaId);
            if (myEntry?.firmado) {
                const restantes = request.totalRequeridos - request.totalFirmados;
                return (
                    <span className="badge" style={{ background: 'var(--success-500)', color: 'white', display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '6px 12px', borderRadius: '20px', fontSize: '12px', fontWeight: 600 }}>
                        <span style={{ display: 'flex' }}><FiCheck /></span>
                        Firmado · {restantes} firma{restantes !== 1 ? 's' : ''} restante{restantes !== 1 ? 's' : ''}
                    </span>
                );
            }
        }
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

    const activeRequests = requests.filter(r => ['pendiente', 'en_proceso'].includes(r.estado));
    const historicalRequests = requests.filter(r => ['completada', 'cancelada', 'vencida'].includes(r.estado));
    const filteredRequests = activeTab === 'pendientes' ? activeRequests : historicalRequests;

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
                {error && (
                    <AlertBanner
                        variant="error"
                        message={error}
                        onDismiss={() => setError('')}
                    />
                )}
                {successMsg && (
                    <AlertBanner
                        variant="success"
                        message={successMsg}
                        onDismiss={() => setSuccessMsg('')}
                        autoDismissMs={5000}
                    />
                )}

                {/* Tabs */}
                <div
                    className="flex gap-3 mb-6"
                    style={{
                        background: 'var(--surface-elevated)',
                        padding: 'var(--space-2)',
                        borderRadius: 'var(--radius-xl)',
                        border: '1px solid var(--surface-border)',
                    }}
                >
                    <button
                        className="flex items-center gap-3"
                        onClick={() => setActiveTab('pendientes')}
                        style={{
                            flex: 1,
                            padding: 'var(--space-4)',
                            borderRadius: 'var(--radius-lg)',
                            border: activeTab === 'pendientes' ? '1px solid var(--warning-400)' : '1px solid transparent',
                            background: activeTab === 'pendientes'
                                ? 'linear-gradient(135deg, rgba(255, 193, 7, 0.15), rgba(255, 193, 7, 0.05))'
                                : 'transparent',
                            cursor: 'pointer',
                            transition: 'all var(--transition-fast)',
                            boxShadow: activeTab === 'pendientes' ? 'var(--shadow-md)' : 'none',
                        }}
                    >
                        <div
                            className="avatar"
                            style={{
                                background: activeTab === 'pendientes' ? 'var(--warning-500)' : 'var(--surface-hover)',
                                color: activeTab === 'pendientes' ? 'white' : 'var(--text-muted)',
                                width: '44px',
                                height: '44px',
                                transition: 'all var(--transition-fast)',
                            }}
                        >
                            <FiClock size={20} />
                        </div>
                        <div style={{ textAlign: 'left' }}>
                            <div style={{ fontWeight: 600, color: activeTab === 'pendientes' ? 'var(--warning-700)' : 'var(--text-secondary)', fontSize: 'var(--text-base)' }}>
                                Solicitudes Pendientes
                            </div>
                            <div style={{ fontSize: 'var(--text-sm)', color: activeTab === 'pendientes' ? 'var(--warning-600)' : 'var(--text-muted)' }}>
                                {activeRequests.length} solicitud{activeRequests.length !== 1 ? 'es' : ''} activa{activeRequests.length !== 1 ? 's' : ''}
                            </div>
                        </div>
                        {activeRequests.length > 0 && (
                            <span className="badge" style={{ marginLeft: 'auto', background: 'var(--warning-500)', color: 'white', fontWeight: 600, minWidth: '28px', height: '28px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 'var(--radius-full)' }}>
                                {activeRequests.length}
                            </span>
                        )}
                    </button>

                    <button
                        className="flex items-center gap-3"
                        onClick={() => setActiveTab('historial')}
                        style={{
                            flex: 1,
                            padding: 'var(--space-4)',
                            borderRadius: 'var(--radius-lg)',
                            border: activeTab === 'historial' ? '1px solid var(--success-400)' : '1px solid transparent',
                            background: activeTab === 'historial'
                                ? 'linear-gradient(135deg, rgba(76, 175, 80, 0.15), rgba(76, 175, 80, 0.05))'
                                : 'transparent',
                            cursor: 'pointer',
                            transition: 'all var(--transition-fast)',
                            boxShadow: activeTab === 'historial' ? 'var(--shadow-md)' : 'none',
                        }}
                    >
                        <div
                            className="avatar"
                            style={{
                                background: activeTab === 'historial' ? 'var(--success-500)' : 'var(--surface-hover)',
                                color: activeTab === 'historial' ? 'white' : 'var(--text-muted)',
                                width: '44px',
                                height: '44px',
                                transition: 'all var(--transition-fast)',
                            }}
                        >
                            <FiCheck size={20} />
                        </div>
                        <div style={{ textAlign: 'left' }}>
                            <div style={{ fontWeight: 600, color: activeTab === 'historial' ? 'var(--success-700)' : 'var(--text-secondary)', fontSize: 'var(--text-base)' }}>
                                Historial
                            </div>
                            <div style={{ fontSize: 'var(--text-sm)', color: activeTab === 'historial' ? 'var(--success-600)' : 'var(--text-muted)' }}>
                                {historicalRequests.length} solicitud{historicalRequests.length !== 1 ? 'es' : ''} completada{historicalRequests.length !== 1 ? 's' : ''}
                            </div>
                        </div>
                        {historicalRequests.length > 0 && (
                            <span className="badge" style={{ marginLeft: 'auto', background: activeTab === 'historial' ? 'var(--success-500)' : 'var(--surface-hover)', color: activeTab === 'historial' ? 'white' : 'var(--text-muted)', fontWeight: 600, minWidth: '28px', height: '28px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 'var(--radius-full)', transition: 'all var(--transition-fast)' }}>
                                {historicalRequests.length}
                            </span>
                        )}
                    </button>
                </div>

                {/* Offline Pending Signatures Section */}
                {(offlinePending.length > 0 || !isOnline) && (
                    <div className="card mb-6" style={{
                        background: !isOnline
                            ? 'linear-gradient(135deg, rgba(255, 152, 0, 0.1), rgba(255, 152, 0, 0.02))'
                            : 'linear-gradient(135deg, rgba(59, 130, 246, 0.1), rgba(59, 130, 246, 0.02))',
                        border: `1px solid ${!isOnline ? 'rgba(255, 152, 0, 0.3)' : 'rgba(59, 130, 246, 0.3)'}`,
                    }}>
                        <div className="flex items-center justify-between mb-4">
                            <div className="flex items-center gap-3">
                                <div className="avatar avatar-sm" style={{
                                    background: !isOnline ? 'var(--warning-500)' : 'var(--info-500)',
                                }}>
                                    {!isOnline ? <FiWifiOff size={16} /> : <FiWifi size={16} />}
                                </div>
                                <div>
                                    <h3 style={{ margin: 0, fontWeight: 600, fontSize: '15px' }}>
                                        {!isOnline ? 'Sin conexión' : `${offlinePending.length} firma(s) pendiente(s) de sincronizar`}
                                    </h3>
                                    <p className="text-xs text-muted" style={{ margin: 0 }}>
                                        {!isOnline
                                            ? 'Las firmas se guardan localmente hasta tener conexión'
                                            : 'Firmas capturadas offline listas para sincronizar'}
                                    </p>
                                </div>
                            </div>
                            {isOnline && offlinePending.length > 0 && (
                                <button
                                    className="btn btn-primary btn-sm"
                                    onClick={handleSyncOffline}
                                    disabled={syncingOffline}
                                    style={{ padding: '8px 16px' }}
                                >
                                    <FiRefreshCw className={syncingOffline ? 'spin' : ''} size={14} />
                                    {syncingOffline ? 'Sincronizando...' : 'Sincronizar ahora'}
                                </button>
                            )}
                        </div>

                        {offlinePending.length > 0 && (
                            <div className="flex flex-col gap-2">
                                {offlinePending.map((sig) => {
                                    const typeConfig: Record<string, { label: string; icon: React.ReactNode; color: string }> = {
                                        documento: { label: 'Documento', icon: <FiFileText size={14} />, color: 'var(--info-500)' },
                                        actividad: { label: 'Actividad', icon: <FiCalendar size={14} />, color: 'var(--warning-500)' },
                                        encuesta: { label: 'Encuesta', icon: <FiClipboard size={14} />, color: 'var(--success-500)' },
                                    };
                                    const config = typeConfig[sig.type] || typeConfig.documento;
                                    return (
                                        <div
                                            key={sig.id}
                                            className="flex items-center justify-between"
                                            style={{
                                                padding: '12px 16px',
                                                background: 'var(--surface-elevated)',
                                                borderRadius: 'var(--radius-md)',
                                                border: '1px solid var(--surface-border)',
                                            }}
                                        >
                                            <div className="flex items-center gap-3">
                                                <div className="avatar avatar-sm" style={{ background: config.color, width: 32, height: 32, fontSize: '0.8rem' }}>
                                                    {config.icon}
                                                </div>
                                                <div>
                                                    <div className="font-medium" style={{ fontSize: '13px' }}>
                                                        {sig.targetTitle}
                                                    </div>
                                                    <div className="text-xs text-muted" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                        <span>{config.label}</span>
                                                        <span>•</span>
                                                        <span>{sig.workerName}</span>
                                                        <span>•</span>
                                                        <span>
                                                            {new Date(sig.timestamp).toLocaleString('es-CL', {
                                                                day: '2-digit', month: 'short',
                                                                hour: '2-digit', minute: '2-digit',
                                                            })}
                                                        </span>
                                                    </div>
                                                </div>
                                            </div>
                                            <span className="badge" style={{
                                                background: 'rgba(255, 152, 0, 0.15)',
                                                color: '#b45309',
                                                fontSize: '11px',
                                                padding: '4px 10px',
                                            }}>
                                                <FiClock size={10} style={{ marginRight: '4px' }} />
                                                Pendiente
                                            </span>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                )}

                <div className="card">
                    <div className="card-header" style={{ paddingBottom: 'var(--space-4)' }}>
                        <div>
                            <h2 className="card-title" style={{ fontSize: '18px', marginBottom: '2px' }}>
                                {activeTab === 'pendientes' ? 'Solicitudes Pendientes' : 'Historial de Solicitudes'}
                            </h2>
                            <p className="card-subtitle" style={{ fontSize: '13px' }}>
                                {filteredRequests.length} solicitud{filteredRequests.length !== 1 ? 'es' : ''}
                            </p>
                        </div>
                        <div className="flex items-center gap-2">
                            <button className="btn btn-ghost btn-sm" onClick={loadData} disabled={loading} title="Actualizar" style={{ padding: '8px' }}>
                                <FiRefreshCw className={loading ? 'spin' : ''} size={16} />
                            </button>
                            {activeTab === 'pendientes' && (
                                <button
                                    className="btn btn-primary btn-sm"
                                    onClick={() => setShowModal(true)}
                                    style={{ boxShadow: 'var(--shadow-glow-primary)', padding: '8px 16px' }}
                                >
                                    <FiPlus size={16} />
                                    Nueva Solicitud
                                </button>
                            )}
                        </div>
                    </div>

                    {filteredRequests.length === 0 ? (
                        <div className="empty-state" style={{ padding: '60px 24px' }}>
                            <div className="empty-state-icon" style={{ fontSize: '3rem', marginBottom: 'var(--space-4)' }}>
                                {activeTab === 'pendientes' ? <FiClock /> : <FiCheck />}
                            </div>
                            <h3 className="empty-state-title">
                                {activeTab === 'pendientes' ? 'No hay solicitudes pendientes' : 'Sin historial de solicitudes'}
                            </h3>
                            <p className="empty-state-description">
                                {activeTab === 'pendientes'
                                    ? 'Crea tu primera solicitud de firma para comenzar.'
                                    : 'Las solicitudes completadas, canceladas y vencidas aparecerán aquí.'
                                }
                            </p>
                            {activeTab === 'pendientes' && (
                                <button className="btn btn-primary" onClick={() => setShowModal(true)} style={{ marginTop: '16px' }}>
                                    <FiPlus /> Nueva Solicitud
                                </button>
                            )}
                        </div>
                    ) : (
                        <div className="flex flex-col" style={{ gap: '1px', background: 'var(--surface-border)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
                            {filteredRequests.map((request) => {
                                const typeConf = REQUEST_TYPES[request.tipo];
                                return (
                                    <div
                                        key={request.requestId}
                                        className="flex items-center gap-4"
                                        style={{
                                            padding: '16px 20px',
                                            background: 'var(--surface-card)',
                                            cursor: 'pointer',
                                            transition: 'background 0.15s',
                                        }}
                                        onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface-hover)')}
                                        onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--surface-card)')}
                                        onClick={() => { setSelectedRequest(request); setShowDetailModal(true); }}
                                    >
                                        {/* Type icon */}
                                        <div
                                            className="avatar avatar-sm"
                                            style={{
                                                background: 'var(--surface-elevated)',
                                                color: typeConf?.color || 'var(--primary-500)',
                                                width: '44px',
                                                height: '44px',
                                                flexShrink: 0,
                                                border: '1px solid var(--surface-border)',
                                                fontSize: '1.1rem',
                                            }}
                                        >
                                            {typeConf?.icon || <FiFileText />}
                                        </div>

                                        {/* Main info */}
                                        <div style={{ flex: 1, minWidth: 0 }}>
                                            <div className="flex items-center gap-2 mb-1" style={{ flexWrap: 'wrap' }}>
                                                <span style={{ fontWeight: 600, fontSize: '14px', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                    {request.titulo}
                                                </span>
                                                {getStatusBadge(request.estado, request)}
                                            </div>
                                            <div className="flex items-center gap-4" style={{ fontSize: '12px', color: 'var(--text-muted)', flexWrap: 'wrap' }}>
                                                <span className="flex items-center gap-1">
                                                    <FiUsers size={12} style={{ color: 'var(--primary-400)' }} />
                                                    {request.solicitanteNombre}
                                                </span>
                                                <span className="flex items-center gap-1">
                                                    <FiCalendar size={12} style={{ color: 'var(--info-400)' }} />
                                                    {new Date(request.fechaCreacion).toLocaleDateString('es-CL', { day: 'numeric', month: 'short', year: 'numeric' })}
                                                </span>
                                                {request.documentos.length > 0 && (
                                                    <span className="flex items-center gap-1">
                                                        <FiFile size={12} />
                                                        {request.documentos.length} doc{request.documentos.length !== 1 ? 's' : ''}
                                                    </span>
                                                )}
                                                <span style={{ fontSize: '11px', color: 'var(--text-muted)', opacity: 0.7, textTransform: 'uppercase', letterSpacing: '0.4px' }}>
                                                    {typeConf?.label}
                                                </span>
                                            </div>
                                        </div>

                                        {/* Action buttons */}
                                        <div className="flex items-center gap-2" style={{ flexShrink: 0 }}>
                                            {request.trabajadores.some(t => t.workerId === user?.personaId && !t.firmado) && (
                                                <button
                                                    className="btn btn-primary btn-sm"
                                                    onClick={(e) => openSignModal(request, e)}
                                                    style={{ padding: '8px 14px', fontSize: '13px', boxShadow: 'var(--shadow-glow-primary)' }}
                                                >
                                                    <FiCheck size={14} /> Firmar
                                                </button>
                                            )}
                                            <button
                                                className="btn btn-secondary btn-sm"
                                                onClick={(e) => { e.stopPropagation(); setSelectedRequest(request); setShowDetailModal(true); }}
                                                style={{ padding: '8px 14px', fontSize: '13px' }}
                                            >
                                                Ver detalles
                                            </button>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>

            {/* Detail modal */}
            {selectedRequest && (
                <Modal
                    isOpen={showDetailModal}
                    onClose={() => { setShowDetailModal(false); setSelectedRequest(null); }}
                    title={selectedRequest.titulo}
                    subtitle={REQUEST_TYPES[selectedRequest.tipo]?.label}
                    icon={<span style={{ fontSize: '1.2rem', display: 'flex' }}>{REQUEST_TYPES[selectedRequest.tipo]?.icon || <FiFileText />}</span>}
                    size="lg"
                    footer={
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                            {selectedRequest.estado !== 'completada' && selectedRequest.estado !== 'cancelada' ? (
                                <button
                                    className="btn btn-danger btn-sm"
                                    onClick={() => { setShowDetailModal(false); handleCancelRequest(selectedRequest.requestId); }}
                                    style={{ padding: '8px 16px' }}
                                >
                                    <FiX size={15} /> Cancelar solicitud
                                </button>
                            ) : <div />}
                            <button
                                className="btn btn-secondary"
                                onClick={() => { setShowDetailModal(false); setSelectedRequest(null); }}
                            >
                                Cerrar
                            </button>
                        </div>
                    }
                >
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>

                        {/* Status + meta row */}
                        <div style={{
                            display: 'grid',
                            gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
                            gap: 'var(--space-3)',
                        }}>
                            <div style={{ background: 'var(--surface-elevated)', borderRadius: 'var(--radius-md)', padding: '14px 16px', border: '1px solid var(--surface-border)' }}>
                                <div style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '6px', fontWeight: 600 }}>Estado</div>
                                {getStatusBadge(selectedRequest.estado, selectedRequest)}
                            </div>
                            <div style={{ background: 'var(--surface-elevated)', borderRadius: 'var(--radius-md)', padding: '14px 16px', border: '1px solid var(--surface-border)' }}>
                                <div style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '6px', fontWeight: 600 }}>Asignado por</div>
                                <div className="flex items-center gap-2">
                                    <FiUsers size={14} style={{ color: 'var(--primary-500)', flexShrink: 0 }} />
                                    <span style={{ fontSize: '14px', fontWeight: 500 }}>{selectedRequest.solicitanteNombre}</span>
                                </div>
                            </div>
                            <div style={{ background: 'var(--surface-elevated)', borderRadius: 'var(--radius-md)', padding: '14px 16px', border: '1px solid var(--surface-border)' }}>
                                <div style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '6px', fontWeight: 600 }}>Fecha de creación</div>
                                <div className="flex items-center gap-2">
                                    <FiCalendar size={14} style={{ color: 'var(--info-500)', flexShrink: 0 }} />
                                    <span style={{ fontSize: '14px', fontWeight: 500 }}>
                                        {new Date(selectedRequest.fechaCreacion).toLocaleDateString('es-CL', { day: 'numeric', month: 'long', year: 'numeric' })}
                                    </span>
                                </div>
                            </div>
                            {selectedRequest.fechaLimite && (
                                <div style={{ background: 'var(--surface-elevated)', borderRadius: 'var(--radius-md)', padding: '14px 16px', border: '1px solid var(--warning-200)' }}>
                                    <div style={{ fontSize: '11px', color: 'var(--warning-600)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '6px', fontWeight: 600 }}>Fecha límite</div>
                                    <div className="flex items-center gap-2">
                                        <FiAlertCircle size={14} style={{ color: 'var(--warning-500)', flexShrink: 0 }} />
                                        <span style={{ fontSize: '14px', fontWeight: 500 }}>
                                            {new Date(selectedRequest.fechaLimite).toLocaleDateString('es-CL', { day: 'numeric', month: 'long', year: 'numeric' })}
                                        </span>
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Description */}
                        {selectedRequest.descripcion && (
                            <div style={{ background: 'var(--surface-elevated)', borderRadius: 'var(--radius-md)', padding: '16px 20px', border: '1px solid var(--surface-border)' }}>
                                <div style={{ fontSize: '12px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '10px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px' }}>
                                    <FiFileText size={13} /> Descripción
                                </div>
                                <p style={{ margin: 0, fontSize: '14px', lineHeight: 1.65, color: 'var(--text-primary)' }}>{selectedRequest.descripcion}</p>
                            </div>
                        )}

                        {/* Documents */}
                        {selectedRequest.documentos.length > 0 && (
                            <div style={{ background: 'var(--surface-elevated)', borderRadius: 'var(--radius-md)', padding: '16px 20px', border: '1px solid var(--surface-border)' }}>
                                <div style={{ fontSize: '12px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '12px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px' }}>
                                    <FiFile size={13} /> Documentos adjuntos
                                    <span className="badge" style={{ background: 'var(--primary-100)', color: 'var(--primary-700)', fontSize: '11px', padding: '2px 8px', marginLeft: '4px' }}>
                                        {selectedRequest.documentos.length}
                                    </span>
                                </div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                    {selectedRequest.documentos.map((doc, idx) => (
                                        <button
                                            key={idx}
                                            className="flex items-center gap-3"
                                            style={{
                                                background: 'var(--surface-card)',
                                                border: '1px solid var(--surface-border)',
                                                borderRadius: 'var(--radius-md)',
                                                padding: '10px 14px',
                                                cursor: 'pointer',
                                                width: '100%',
                                                textAlign: 'left',
                                                transition: 'all 0.15s',
                                            }}
                                            onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'var(--primary-300)')}
                                            onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'var(--surface-border)')}
                                            onClick={async () => {
                                                const res = await uploadsApi.getDownloadUrl(doc.url);
                                                if (res.success && res.data) window.open(res.data.downloadUrl, '_blank');
                                            }}
                                        >
                                            <div className="avatar avatar-sm" style={{ background: 'var(--primary-100)', color: 'var(--primary-600)', width: '32px', height: '32px', flexShrink: 0 }}>
                                                <FiFile size={14} />
                                            </div>
                                            <span style={{ fontSize: '13px', fontWeight: 500, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{doc.nombre}</span>
                                            <FiArrowRight size={14} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Firmantes progress */}
                        <div style={{ background: 'var(--surface-elevated)', borderRadius: 'var(--radius-md)', padding: '16px 20px', border: '1px solid var(--surface-border)' }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
                                <div style={{ fontSize: '12px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px' }}>
                                    <FiUsers size={13} /> Firmantes
                                </div>
                                <span className="badge" style={{
                                    background: selectedRequest.totalFirmados === selectedRequest.totalRequeridos ? 'var(--success-500)' : 'var(--primary-500)',
                                    color: 'white', fontSize: '12px', padding: '4px 10px', fontWeight: 600,
                                }}>
                                    {selectedRequest.totalFirmados}/{selectedRequest.totalRequeridos} firmados
                                </span>
                            </div>
                            <div style={{ height: '6px', background: 'var(--surface-hover)', borderRadius: 'var(--radius-full)', overflow: 'hidden', marginBottom: '16px' }}>
                                <div style={{
                                    height: '100%',
                                    width: `${(selectedRequest.totalFirmados / selectedRequest.totalRequeridos) * 100}%`,
                                    background: selectedRequest.totalFirmados === selectedRequest.totalRequeridos
                                        ? 'linear-gradient(90deg, var(--success-500), var(--success-400))'
                                        : 'linear-gradient(90deg, var(--primary-500), var(--primary-400))',
                                    borderRadius: 'var(--radius-full)',
                                    transition: 'width 0.3s ease',
                                }} />
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                {selectedRequest.trabajadores.map((t) => (
                                    <div
                                        key={t.workerId}
                                        className="flex items-center gap-3"
                                        style={{
                                            padding: '10px 14px',
                                            borderRadius: 'var(--radius-md)',
                                            background: t.firmado
                                                ? 'linear-gradient(135deg, rgba(76,175,80,0.08), rgba(76,175,80,0.03))'
                                                : 'var(--surface-card)',
                                            border: `1px solid ${t.firmado ? 'rgba(76,175,80,0.2)' : 'var(--surface-border)'}`,
                                        }}
                                    >
                                        <div className="avatar avatar-sm" style={{
                                            background: t.firmado ? 'var(--success-500)' : 'var(--surface-hover)',
                                            color: t.firmado ? 'white' : 'var(--warning-500)',
                                            width: '32px', height: '32px', flexShrink: 0,
                                        }}>
                                            {t.firmado ? <FiCheck size={14} /> : <FiClock size={14} />}
                                        </div>
                                        <div style={{ flex: 1, minWidth: 0 }}>
                                            <div style={{ fontSize: '13px', fontWeight: 500, color: 'var(--text-primary)' }}>{t.nombre}</div>
                                            <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{t.rut}</div>
                                        </div>
                                        {t.firmado && t.fechaFirma ? (
                                            <div style={{ fontSize: '11px', color: 'var(--success-600)', fontWeight: 500, textAlign: 'right', flexShrink: 0 }}>
                                                <FiCheck size={10} style={{ marginRight: '3px' }} />
                                                {new Date(t.fechaFirma).toLocaleString('es-CL', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                                            </div>
                                        ) : (
                                            <span style={{ fontSize: '11px', color: 'var(--warning-600)', fontWeight: 500, flexShrink: 0 }}>Pendiente</span>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </Modal>
            )}

            <Modal
                isOpen={showModal}
                onClose={() => { resetForm(); setShowModal(false); }}
                title="Nueva Solicitud de Firma"
                subtitle="Completa los pasos para crear la solicitud"
                icon={<FiSend size={22} />}
                size="xl"
                preventClose={submitting}
                footer={
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
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
                            >
                                <FiX size={18} /> Cancelar
                            </button>
                            <button
                                type="submit"
                                form="signature-request-form"
                                className="btn btn-primary"
                                disabled={submitting || selectedWorkers.length === 0 || (REQUEST_TYPES[newRequest.tipo].requiresDoc && uploadedDocs.length === 0)}
                                style={{
                                    boxShadow: selectedWorkers.length > 0 ? 'var(--shadow-glow-primary)' : 'none',
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
                }
            >
                <form id="signature-request-form" onSubmit={handleCreateRequest} style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>

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
                                            const isSelected = selectedWorkers.includes(worker.personaId);
                                            return (
                                                <label
                                                    key={worker.personaId}
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
                                                        onChange={() => toggleWorkerSelection(worker.personaId)}
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
                </form>
            </Modal>
            {/* Sign PIN modal */}
            {selectedRequest && (
                <Modal
                    isOpen={showSignModal}
                    onClose={() => { setShowSignModal(false); setPin(''); setSignError(''); }}
                    title="Confirmar Firma Digital"
                    subtitle="Revisa los detalles antes de firmar"
                    preventClose={signing}
                    footer={
                        <>
                            <button
                                className="btn btn-secondary"
                                onClick={() => { setShowSignModal(false); setPin(''); setSignError(''); }}
                                disabled={signing}
                                style={{ flex: 1 }}
                            >
                                <FiX size={16} /> Cancelar
                            </button>
                            <button
                                className="btn btn-primary"
                                onClick={handleSign}
                                disabled={signing || pin.length !== 4}
                                style={{ flex: 2, boxShadow: pin.length === 4 ? 'var(--shadow-glow-primary)' : 'none' }}
                            >
                                {signing
                                    ? <><div className="spinner" style={{ width: '16px', height: '16px' }} /> Firmando...</>
                                    : <><FiCheck size={18} /> Confirmar Firma</>
                                }
                            </button>
                        </>
                    }
                >
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
                        {/* Resumen de la solicitud */}
                        <div style={{
                            background: 'linear-gradient(135deg, rgba(76,175,80,0.08), rgba(76,175,80,0.02))',
                            border: '1px solid rgba(76,175,80,0.2)',
                            borderRadius: 'var(--radius-lg)',
                            padding: 'var(--space-4)',
                        }}>
                            <div className="flex items-start gap-4">
                                <div className="avatar" style={{ fontSize: '1.75rem', background: 'var(--surface-card)', width: '56px', height: '56px', border: '2px solid var(--primary-200)', boxShadow: 'var(--shadow-md)', flexShrink: 0 }}>
                                    {REQUEST_TYPES[selectedRequest.tipo]?.icon || <FiFileText />}
                                </div>
                                <div style={{ flex: 1 }}>
                                    <div style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '4px' }}>
                                        {REQUEST_TYPES[selectedRequest.tipo]?.label}
                                    </div>
                                    <h3 style={{ fontSize: 'var(--text-base)', fontWeight: 600, marginBottom: 'var(--space-2)' }}>
                                        {selectedRequest.titulo}
                                    </h3>
                                    <div className="flex flex-wrap items-center gap-3" style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
                                        <span className="flex items-center gap-1">
                                            <FiUser size={13} style={{ color: 'var(--primary-500)' }} />
                                            {selectedRequest.solicitanteNombre}
                                        </span>
                                        <span className="flex items-center gap-1">
                                            <FiCalendar size={13} style={{ color: 'var(--info-500)' }} />
                                            {new Date(selectedRequest.fechaCreacion).toLocaleDateString('es-CL', { day: 'numeric', month: 'short', year: 'numeric' })}
                                        </span>
                                    </div>
                                </div>
                            </div>
                            {selectedRequest.descripcion && (
                                <p style={{ margin: 'var(--space-3) 0 0', fontSize: '13px', padding: 'var(--space-3)', background: 'rgba(255,255,255,0.5)', borderRadius: 'var(--radius-md)', borderLeft: '3px solid var(--primary-400)', lineHeight: 1.6 }}>
                                    {selectedRequest.descripcion}
                                </p>
                            )}
                        </div>

                        {/* Aviso legal */}
                        <div style={{
                            background: 'linear-gradient(135deg, rgba(255,193,7,0.12), rgba(255,193,7,0.04))',
                            border: '1px solid var(--warning-300)',
                            borderRadius: 'var(--radius-lg)',
                            padding: 'var(--space-4)',
                        }}>
                            <div className="flex items-start gap-3">
                                <div className="avatar avatar-sm" style={{ background: 'var(--warning-500)', flexShrink: 0 }}>
                                    <FiAlertCircle size={16} />
                                </div>
                                <div style={{ fontSize: '13px' }}>
                                    <strong style={{ display: 'block', marginBottom: '4px', color: 'var(--warning-700)' }}>
                                        Declaración de conformidad
                                    </strong>
                                    <span style={{ color: 'var(--text-muted)' }}>
                                        Al ingresar tu PIN confirmas que has leído y comprendido los documentos adjuntos, y aceptas los términos establecidos.
                                    </span>
                                </div>
                            </div>
                        </div>

                        {/* PIN Input */}
                        <div style={{
                            background: 'var(--surface-elevated)',
                            borderRadius: 'var(--radius-lg)',
                            border: '1px solid var(--surface-border)',
                            padding: 'var(--space-5)',
                            textAlign: 'center',
                        }}>
                            <div className="flex items-center justify-center gap-2 mb-3">
                                <FiShield size={18} style={{ color: 'var(--primary-500)' }} />
                                <label className="font-medium">Ingresa tu PIN de 4 dígitos</label>
                            </div>
                            <PinInput
                                onComplete={(completedPin) => setPin(completedPin)}
                                disabled={signing}
                                mode="verify"
                                error={signError}
                            />
                            {signError && (
                                <div className="mt-3" style={{ fontSize: '13px', color: 'var(--error-500)' }}>
                                    <FiAlertCircle style={{ display: 'inline', marginRight: '4px' }} />
                                    {signError}
                                </div>
                            )}
                        </div>
                    </div>
                </Modal>
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