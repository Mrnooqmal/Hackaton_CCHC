import { useState, useEffect } from 'react';
import Header from '../components/Header';
import PinInput from '../components/PinInput';
import {
    FiCheck,
    FiClock,
    FiFile,
    FiFileText,
    FiCalendar,
    FiUser,
    FiAlertCircle,
    FiX,
    FiDownload,
    FiEdit3,
    FiShield,
    FiTrendingUp,
    FiRefreshCw,
} from 'react-icons/fi';
import {
    signatureRequestsApi,
    signaturesApi,
    uploadsApi,
    type SignatureRequest,
    type NewSignature,
    REQUEST_TYPES,
} from '../api/client';
import { useAuth } from '../context/AuthContext';

type TabType = 'pendientes' | 'historial';

export default function MySignatures() {
    const { user } = useAuth();
    const [activeTab, setActiveTab] = useState<TabType>('pendientes');
    const [pendingRequests, setPendingRequests] = useState<SignatureRequest[]>([]);
    const [signatureHistory, setSignatureHistory] = useState<{ firma: NewSignature; solicitud: SignatureRequest | null }[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedRequest, setSelectedRequest] = useState<SignatureRequest | null>(null);
    const [showSignModal, setShowSignModal] = useState(false);
    const [signing, setSigning] = useState(false);
    const [pin, setPin] = useState('');
    const [error, setError] = useState('');

    useEffect(() => {
        if (user?.workerId) {
            loadData();
        } else {
            // Si no hay workerId, no hay datos que cargar
            setLoading(false);
        }
    }, [user?.workerId]);

    const loadData = async () => {
        if (!user?.workerId) return;

        setLoading(true);
        try {
            const [pendingRes, historyRes] = await Promise.all([
                signatureRequestsApi.getPendingByWorker(user.workerId),
                signatureRequestsApi.getHistoryByWorker(user.workerId),
            ]);

            if (pendingRes.success && pendingRes.data) {
                setPendingRequests(pendingRes.data.pendientes);
            }
            if (historyRes.success && historyRes.data) {
                setSignatureHistory(historyRes.data.historial);
            }
        } catch (error) {
            console.error('Error loading data:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleSign = async () => {
        if (!selectedRequest || !user?.workerId || pin.length !== 4) return;

        setSigning(true);
        setError('');

        try {
            const response = await signaturesApi.create({
                workerId: user.workerId,
                pin,
                requestId: selectedRequest.requestId,
            });

            if (response.success) {
                // Refresh data
                await loadData();
                setShowSignModal(false);
                setSelectedRequest(null);
                setPin('');
            } else {
                setError(response.error || 'Error al firmar');
            }
        } catch (error) {
            console.error('Error signing:', error);
            setError('Error al procesar la firma');
        } finally {
            setSigning(false);
        }
    };

    const openSignModal = (request: SignatureRequest) => {
        setSelectedRequest(request);
        setPin('');
        setError('');
        setShowSignModal(true);
    };

    const downloadDocument = async (fileKey: string, fileName: string) => {
        try {
            const response = await uploadsApi.getDownloadUrl(fileKey);
            if (response.success && response.data) {
                const link = document.createElement('a');
                link.href = response.data.downloadUrl;
                link.download = fileName;
                link.target = '_blank';
                link.click();
            }
        } catch (error) {
            console.error('Error downloading:', error);
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center" style={{ height: '100vh' }}>
                <div className="spinner" />
            </div>
        );
    }

    if (!user?.workerId) {
        return (
            <>
                <Header title="Mis Firmas" />
                <div className="main-content">
                    <div className="empty-state">
                        <div className="empty-state-icon"><FiAlertCircle size={48} style={{ color: 'var(--warning-500)' }} /></div>
                        <h3 className="empty-state-title">No tienes acceso</h3>
                        <p className="empty-state-description">
                            Tu cuenta no está asociada a un perfil de trabajador.
                        </p>
                    </div>
                </div>
            </>
        );
    }

    return (
        <>
            <Header title="Mis Firmas" />

            <div className="page-content">
                {/* Hero Section */}
                <div className="survey-hero mb-6">
                    <div className="survey-hero-icon">
                        <FiEdit3 size={28} />
                    </div>
                    <div style={{ flex: 1 }}>
                        <div className="survey-hero-eyebrow">Centro de Firmas</div>
                        <h2 style={{ fontSize: 'var(--text-xl)', fontWeight: 600, marginBottom: 'var(--space-1)' }}>
                            Bienvenido a tu panel de firmas digitales
                        </h2>
                        <p className="text-sm text-muted">
                            Revisa y firma documentos de manera segura. Todas tus firmas quedan registradas con validación criptográfica.
                        </p>
                    </div>
                    <button className="btn btn-secondary" onClick={loadData} disabled={loading}>
                        <FiRefreshCw className={loading ? 'spin' : ''} /> Actualizar
                    </button>
                </div>

                {/* Stats Cards */}
                <div className="grid grid-cols-3 mb-6">
                    <div className="card stat-card">
                        <div className="flex items-center gap-3 mb-1">
                            <div className="avatar avatar-sm" style={{ background: 'var(--warning-500)' }}>
                                <FiClock />
                            </div>
                            <span className="text-xs text-muted">Pendientes de Firma</span>
                        </div>
                        <div className="stat-value">{pendingRequests.length}</div>
                        {pendingRequests.length > 0 && (
                            <div className="stat-change" style={{ color: 'var(--warning-500)' }}>
                                <FiAlertCircle size={14} />
                                Requieren tu atención
                            </div>
                        )}
                    </div>
                    <div className="card stat-card">
                        <div className="flex items-center gap-3 mb-1">
                            <div className="avatar avatar-sm" style={{ background: 'var(--success-500)' }}>
                                <FiCheck />
                            </div>
                            <span className="text-xs text-muted">Documentos Firmados</span>
                        </div>
                        <div className="stat-value">{signatureHistory.length}</div>
                        <div className="stat-change positive">
                            <FiTrendingUp size={14} />
                            Completados exitosamente
                        </div>
                    </div>
                    <div className="card stat-card">
                        <div className="flex items-center gap-3 mb-1">
                            <div className="avatar avatar-sm" style={{ background: 'var(--primary-500)' }}>
                                <FiShield />
                            </div>
                            <span className="text-xs text-muted">Total de Solicitudes</span>
                        </div>
                        <div className="stat-value">{pendingRequests.length + signatureHistory.length}</div>
                        <div className="stat-change positive">
                            <FiFileText size={14} />
                            Documentos gestionados
                        </div>
                    </div>
                </div>

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
                            <div
                                style={{
                                    fontWeight: 600,
                                    color: activeTab === 'pendientes' ? 'var(--warning-700)' : 'var(--text-secondary)',
                                    fontSize: 'var(--text-base)',
                                }}
                            >
                                Pendientes
                            </div>
                            <div
                                style={{
                                    fontSize: 'var(--text-sm)',
                                    color: activeTab === 'pendientes' ? 'var(--warning-600)' : 'var(--text-muted)',
                                }}
                            >
                                {pendingRequests.length} solicitud{pendingRequests.length !== 1 ? 'es' : ''}
                            </div>
                        </div>
                        {pendingRequests.length > 0 && (
                            <span
                                className="badge"
                                style={{
                                    marginLeft: 'auto',
                                    background: 'var(--warning-500)',
                                    color: 'white',
                                    fontWeight: 600,
                                    minWidth: '28px',
                                    height: '28px',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    borderRadius: 'var(--radius-full)',
                                }}
                            >
                                {pendingRequests.length}
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
                            <div
                                style={{
                                    fontWeight: 600,
                                    color: activeTab === 'historial' ? 'var(--success-700)' : 'var(--text-secondary)',
                                    fontSize: 'var(--text-base)',
                                }}
                            >
                                Historial
                            </div>
                            <div
                                style={{
                                    fontSize: 'var(--text-sm)',
                                    color: activeTab === 'historial' ? 'var(--success-600)' : 'var(--text-muted)',
                                }}
                            >
                                {signatureHistory.length} firma{signatureHistory.length !== 1 ? 's' : ''} registrada{signatureHistory.length !== 1 ? 's' : ''}
                            </div>
                        </div>
                        {signatureHistory.length > 0 && (
                            <span
                                className="badge"
                                style={{
                                    marginLeft: 'auto',
                                    background: activeTab === 'historial' ? 'var(--success-500)' : 'var(--surface-hover)',
                                    color: activeTab === 'historial' ? 'white' : 'var(--text-muted)',
                                    fontWeight: 600,
                                    minWidth: '28px',
                                    height: '28px',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    borderRadius: 'var(--radius-full)',
                                    transition: 'all var(--transition-fast)',
                                }}
                            >
                                {signatureHistory.length}
                            </span>
                        )}
                    </button>
                </div>

                {/* Content */}
                {activeTab === 'pendientes' && (
                    <div className="card">
                        <div className="card-header">
                            <div>
                                <h2 className="card-title">Solicitudes Pendientes de Firma</h2>
                                <p className="card-subtitle">Documentos que requieren tu firma digital</p>
                            </div>
                            {pendingRequests.length > 0 && (
                                <span className="badge" style={{ background: 'var(--warning-500)', color: 'white' }}>
                                    {pendingRequests.length} pendiente{pendingRequests.length !== 1 ? 's' : ''}
                                </span>
                            )}
                        </div>

                        {pendingRequests.length === 0 ? (
                            <div className="empty-state" style={{ padding: 'var(--space-10)' }}>
                                <div className="empty-state-icon" style={{ marginBottom: 'var(--space-4)' }}>
                                    <FiCheck size={48} style={{ color: 'var(--success-500)' }} />
                                </div>
                                <h3 className="empty-state-title">¡Todo al día!</h3>
                                <p className="empty-state-description">
                                    No tienes solicitudes pendientes de firma. <br />
                                    Te notificaremos cuando haya nuevos documentos para firmar.
                                </p>
                            </div>
                        ) : (
                            <div className="flex flex-col gap-4">
                                {pendingRequests.map((request, index) => (
                                    <div
                                        key={request.requestId}
                                        className="signature-request-card"
                                        style={{
                                            padding: 'var(--space-5)',
                                            borderRadius: 'var(--radius-xl)',
                                            border: '1px solid var(--warning-300)',
                                            background: 'linear-gradient(135deg, rgba(255, 193, 7, 0.08), rgba(255, 193, 7, 0.02))',
                                            transition: 'all var(--transition-normal)',
                                            position: 'relative',
                                            overflow: 'hidden',
                                        }}
                                    >
                                        {/* Priority indicator */}
                                        <div style={{
                                            position: 'absolute',
                                            top: 0,
                                            left: 0,
                                            width: '4px',
                                            height: '100%',
                                            background: 'var(--warning-500)',
                                            borderRadius: 'var(--radius-xl) 0 0 var(--radius-xl)',
                                        }} />

                                        <div className="flex items-start justify-between gap-4">
                                            <div className="flex items-start gap-4" style={{ flex: 1 }}>
                                                <div
                                                    className="avatar"
                                                    style={{
                                                        fontSize: '1.75rem',
                                                        background: 'white',
                                                        width: '56px',
                                                        height: '56px',
                                                        boxShadow: 'var(--shadow-md)',
                                                        border: '2px solid var(--warning-200)',
                                                    }}
                                                >
                                                    {REQUEST_TYPES[request.tipo]?.icon || <FiFileText />}
                                                </div>
                                                <div style={{ flex: 1 }}>
                                                    <div className="flex items-center gap-2 mb-1">
                                                        <span className="badge" style={{ background: 'var(--warning-100)', color: 'var(--warning-700)', fontSize: '11px' }}>
                                                            #{index + 1} • {REQUEST_TYPES[request.tipo]?.label}
                                                        </span>
                                                    </div>
                                                    <h3 style={{ fontSize: 'var(--text-lg)', fontWeight: 600, marginBottom: 'var(--space-2)' }}>
                                                        {request.titulo}
                                                    </h3>
                                                    <div className="flex flex-wrap items-center gap-4 text-sm text-muted">
                                                        <div className="flex items-center gap-2">
                                                            <FiUser size={14} style={{ color: 'var(--primary-500)' }} />
                                                            <span>Solicitado por: <strong>{request.solicitanteNombre}</strong></span>
                                                        </div>
                                                        <div className="flex items-center gap-2">
                                                            <FiCalendar size={14} style={{ color: 'var(--info-500)' }} />
                                                            <span>
                                                                {new Date(request.fechaCreacion).toLocaleDateString('es-CL', {
                                                                    weekday: 'short',
                                                                    day: 'numeric',
                                                                    month: 'short',
                                                                    year: 'numeric',
                                                                })}
                                                            </span>
                                                        </div>
                                                    </div>

                                                    {request.descripcion && (
                                                        <div
                                                            className="mt-3 p-3 rounded-lg text-sm"
                                                            style={{
                                                                background: 'rgba(255, 255, 255, 0.7)',
                                                                border: '1px solid var(--warning-200)',
                                                            }}
                                                        >
                                                            {request.descripcion}
                                                        </div>
                                                    )}
                                                </div>
                                            </div>

                                            <button
                                                className="btn btn-primary btn-lg"
                                                onClick={() => openSignModal(request)}
                                                style={{
                                                    minWidth: '140px',
                                                    boxShadow: 'var(--shadow-glow-primary)',
                                                }}
                                            >
                                                <FiEdit3 size={18} />
                                                Firmar
                                            </button>
                                        </div>

                                        {/* Documents preview */}
                                        {request.documentos.length > 0 && (
                                            <div
                                                className="mt-4 pt-4"
                                                style={{
                                                    borderTop: '1px dashed var(--warning-300)',
                                                }}
                                            >
                                                <div className="flex items-center gap-2 mb-3">
                                                    <FiFile size={14} style={{ color: 'var(--warning-600)' }} />
                                                    <span className="text-sm font-medium">Documentos adjuntos ({request.documentos.length})</span>
                                                </div>
                                                <div className="flex gap-2 flex-wrap">
                                                    {request.documentos.map((doc, idx) => (
                                                        <button
                                                            key={idx}
                                                            className="btn btn-secondary btn-sm"
                                                            onClick={() => downloadDocument(doc.url, doc.nombre)}
                                                            style={{
                                                                background: 'white',
                                                                borderColor: 'var(--warning-200)',
                                                            }}
                                                        >
                                                            <FiDownload size={14} /> {doc.nombre}
                                                        </button>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}

                {activeTab === 'historial' && (
                    <div className="card">
                        <div className="card-header">
                            <div>
                                <h2 className="card-title">Historial de Firmas</h2>
                                <p className="card-subtitle">Registro completo de tus firmas digitales</p>
                            </div>
                            {signatureHistory.length > 0 && (
                                <span className="badge badge-success" style={{ background: 'var(--success-100)', color: 'var(--success-700)' }}>
                                    <FiShield size={12} /> {signatureHistory.length} firma{signatureHistory.length !== 1 ? 's' : ''} registrada{signatureHistory.length !== 1 ? 's' : ''}
                                </span>
                            )}
                        </div>

                        {signatureHistory.length === 0 ? (
                            <div className="empty-state" style={{ padding: 'var(--space-10)' }}>
                                <div className="empty-state-icon" style={{ marginBottom: 'var(--space-4)' }}>
                                    <FiFileText size={48} style={{ color: 'var(--text-muted)' }} />
                                </div>
                                <h3 className="empty-state-title">Sin historial</h3>
                                <p className="empty-state-description">
                                    Aún no has firmado ningún documento. <br />
                                    Cuando firmes documentos, aparecerán aquí con su información de validación.
                                </p>
                            </div>
                        ) : (
                            <div className="table-container" style={{ borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
                                <table className="table">
                                    <thead>
                                        <tr>
                                            <th style={{ width: '30%' }}>Documento</th>
                                            <th>Tipo</th>
                                            <th>Solicitante</th>
                                            <th>Fecha de Firma</th>
                                            <th>Token de Verificación</th>
                                            <th>Estado</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {signatureHistory.map(({ firma, solicitud }) => (
                                            <tr
                                                key={firma.signatureId}
                                                style={{
                                                    transition: 'background var(--transition-fast)',
                                                }}
                                            >
                                                <td>
                                                    <div className="flex items-center gap-3">
                                                        <div
                                                            className="avatar avatar-sm"
                                                            style={{
                                                                fontSize: '1.25rem',
                                                                background: 'var(--surface-elevated)',
                                                                border: '1px solid var(--surface-border)',
                                                            }}
                                                        >
                                                            {REQUEST_TYPES[firma.requestTipo]?.icon || <FiFileText />}
                                                        </div>
                                                        <div>
                                                            <div className="font-medium" style={{ marginBottom: '2px' }}>
                                                                {firma.requestTitulo}
                                                            </div>
                                                            {solicitud?.documentos && solicitud.documentos.length > 0 && (
                                                                <div className="flex items-center gap-1 text-xs text-muted">
                                                                    <FiFile size={10} />
                                                                    {solicitud.documentos.length} documento{solicitud.documentos.length !== 1 ? 's' : ''}
                                                                </div>
                                                            )}
                                                        </div>
                                                    </div>
                                                </td>
                                                <td>
                                                    <span
                                                        className="badge"
                                                        style={{
                                                            background: 'var(--primary-100)',
                                                            color: 'var(--primary-700)',
                                                            fontWeight: 500,
                                                        }}
                                                    >
                                                        {REQUEST_TYPES[firma.requestTipo]?.label || firma.requestTipo}
                                                    </span>
                                                </td>
                                                <td>
                                                    <div className="flex items-center gap-2">
                                                        <FiUser size={14} className="text-muted" />
                                                        <span>{firma.solicitanteNombre}</span>
                                                    </div>
                                                </td>
                                                <td>
                                                    <div className="flex flex-col">
                                                        <span className="font-medium">{firma.fecha}</span>
                                                        <span className="text-xs text-muted flex items-center gap-1">
                                                            <FiClock size={10} />
                                                            {firma.horario}
                                                        </span>
                                                    </div>
                                                </td>
                                                <td>
                                                    <div
                                                        className="flex items-center gap-2"
                                                        style={{
                                                            fontFamily: 'monospace',
                                                            fontSize: 'var(--text-xs)',
                                                            background: 'var(--surface-elevated)',
                                                            padding: '6px 10px',
                                                            borderRadius: 'var(--radius-md)',
                                                            border: '1px solid var(--surface-border)',
                                                            width: 'fit-content',
                                                        }}
                                                    >
                                                        <FiShield size={12} style={{ color: 'var(--success-500)' }} />
                                                        <span>{firma.token.slice(0, 12)}...</span>
                                                    </div>
                                                </td>
                                                <td>
                                                    {firma.estado === 'valida' ? (
                                                        <span
                                                            className="badge"
                                                            style={{
                                                                background: 'linear-gradient(135deg, var(--success-500), var(--success-600))',
                                                                color: 'white',
                                                                display: 'inline-flex',
                                                                alignItems: 'center',
                                                                gap: '4px',
                                                                boxShadow: '0 2px 4px rgba(76, 175, 80, 0.3)',
                                                            }}
                                                        >
                                                            <FiCheck size={14} /> Válida
                                                        </span>
                                                    ) : firma.estado === 'disputada' ? (
                                                        <span
                                                            className="badge"
                                                            style={{
                                                                background: 'linear-gradient(135deg, var(--warning-500), var(--warning-600))',
                                                                color: 'white',
                                                                display: 'inline-flex',
                                                                alignItems: 'center',
                                                                gap: '4px',
                                                            }}
                                                        >
                                                            <FiAlertCircle size={14} /> Disputada
                                                        </span>
                                                    ) : (
                                                        <span
                                                            className="badge"
                                                            style={{
                                                                background: 'var(--error-500)',
                                                                color: 'white',
                                                                display: 'inline-flex',
                                                                alignItems: 'center',
                                                                gap: '4px',
                                                            }}
                                                        >
                                                            <FiX size={14} /> {firma.estado}
                                                        </span>
                                                    )}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* Sign Modal */}
            {showSignModal && selectedRequest && (
                <div className="modal-overlay" onClick={() => setShowSignModal(false)}>
                    <div
                        className="modal"
                        style={{ maxWidth: '520px' }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="modal-header" style={{ borderBottom: '1px solid var(--surface-border)', paddingBottom: 'var(--space-4)' }}>
                            <div className="flex items-center gap-3">
                                <div
                                    className="avatar"
                                    style={{
                                        background: 'var(--gradient-primary)',
                                        boxShadow: 'var(--shadow-glow-primary)',
                                    }}
                                >
                                    <FiEdit3 size={20} />
                                </div>
                                <div>
                                    <h2 style={{ fontSize: 'var(--text-lg)', fontWeight: 600 }}>Confirmar Firma Digital</h2>
                                    <p className="text-sm text-muted">Revisa los detalles antes de firmar</p>
                                </div>
                            </div>
                            <button className="btn btn-ghost btn-icon" onClick={() => setShowSignModal(false)}>
                                <FiX size={20} />
                            </button>
                        </div>

                        <div className="modal-body" style={{ padding: 'var(--space-5)' }}>
                            {/* Request Details */}
                            <div
                                className="survey-section mb-4"
                                style={{
                                    background: 'linear-gradient(135deg, rgba(76, 175, 80, 0.08), rgba(76, 175, 80, 0.02))',
                                    border: '1px solid rgba(76, 175, 80, 0.2)',
                                    marginBottom: 'var(--space-4)',
                                    padding: 'var(--space-4)',
                                }}
                            >
                                <div className="flex items-start gap-4">
                                    <div
                                        className="avatar"
                                        style={{
                                            fontSize: '2rem',
                                            background: 'white',
                                            width: '64px',
                                            height: '64px',
                                            boxShadow: 'var(--shadow-md)',
                                            border: '2px solid var(--primary-200)',
                                        }}
                                    >
                                        {REQUEST_TYPES[selectedRequest.tipo]?.icon || <FiFileText />}
                                    </div>
                                    <div style={{ flex: 1 }}>
                                        <div className="survey-section-eyebrow" style={{ marginBottom: '4px' }}>
                                            {REQUEST_TYPES[selectedRequest.tipo]?.label}
                                        </div>
                                        <h3 style={{ fontSize: 'var(--text-lg)', fontWeight: 600, marginBottom: 'var(--space-2)' }}>
                                            {selectedRequest.titulo}
                                        </h3>
                                        <div className="flex flex-wrap items-center gap-3 text-sm">
                                            <div className="flex items-center gap-2 text-muted">
                                                <FiUser size={14} style={{ color: 'var(--primary-500)' }} />
                                                <strong>{selectedRequest.solicitanteNombre}</strong>
                                            </div>
                                            <div className="flex items-center gap-2 text-muted">
                                                <FiCalendar size={14} style={{ color: 'var(--info-500)' }} />
                                                {new Date(selectedRequest.fechaCreacion).toLocaleDateString('es-CL', {
                                                    day: 'numeric',
                                                    month: 'short',
                                                    year: 'numeric'
                                                })}
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                {selectedRequest.descripcion && (
                                    <p
                                        className="text-sm mt-4 p-3"
                                        style={{
                                            background: 'rgba(255,255,255,0.6)',
                                            borderRadius: 'var(--radius-md)',
                                            borderLeft: '3px solid var(--primary-400)',
                                        }}
                                    >
                                        {selectedRequest.descripcion}
                                    </p>
                                )}
                            </div>

                            {/* Documents to sign */}
                            {selectedRequest.documentos.length > 0 && (
                                <div
                                    className="mb-4 p-4"
                                    style={{
                                        background: 'var(--surface-elevated)',
                                        borderRadius: 'var(--radius-lg)',
                                        border: '1px solid var(--surface-border)',
                                    }}
                                >
                                    <div className="flex items-center gap-2 mb-3">
                                        <FiFileText size={16} style={{ color: 'var(--primary-500)' }} />
                                        <span className="font-medium">Documentos a firmar</span>
                                        <span className="badge badge-neutral" style={{ marginLeft: 'auto' }}>
                                            {selectedRequest.documentos.length}
                                        </span>
                                    </div>
                                    <div className="flex flex-col gap-2">
                                        {selectedRequest.documentos.map((doc, idx) => (
                                            <div
                                                key={idx}
                                                className="flex items-center justify-between p-3"
                                                style={{
                                                    background: 'white',
                                                    borderRadius: 'var(--radius-md)',
                                                    border: '1px solid var(--surface-border)',
                                                }}
                                            >
                                                <div className="flex items-center gap-3">
                                                    <div
                                                        className="avatar avatar-sm"
                                                        style={{
                                                            background: 'var(--info-100)',
                                                            color: 'var(--info-600)',
                                                        }}
                                                    >
                                                        <FiFile size={16} />
                                                    </div>
                                                    <span className="text-sm font-medium">{doc.nombre}</span>
                                                </div>
                                                <button
                                                    className="btn btn-ghost btn-sm"
                                                    onClick={() => downloadDocument(doc.url, doc.nombre)}
                                                    title="Descargar documento"
                                                >
                                                    <FiDownload size={16} />
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Warning */}
                            <div
                                className="mb-5"
                                style={{
                                    background: 'linear-gradient(135deg, rgba(255, 193, 7, 0.12), rgba(255, 193, 7, 0.04))',
                                    border: '1px solid var(--warning-300)',
                                    borderRadius: 'var(--radius-lg)',
                                    padding: 'var(--space-4)',
                                }}
                            >
                                <div className="flex items-start gap-3">
                                    <div
                                        className="avatar avatar-sm"
                                        style={{
                                            background: 'var(--warning-500)',
                                            flexShrink: 0,
                                        }}
                                    >
                                        <FiAlertCircle size={16} />
                                    </div>
                                    <div className="text-sm">
                                        <strong style={{ display: 'block', marginBottom: '4px', color: 'var(--warning-700)' }}>
                                            Declaración de conformidad
                                        </strong>
                                        <span className="text-muted">
                                            Al ingresar tu PIN confirmas que has leído y comprendido los documentos adjuntos, y aceptas los términos establecidos.
                                        </span>
                                    </div>
                                </div>
                            </div>

                            {/* PIN Input */}
                            <div
                                className="text-center p-5"
                                style={{
                                    background: 'var(--surface-elevated)',
                                    borderRadius: 'var(--radius-lg)',
                                    border: '1px solid var(--surface-border)',
                                }}
                            >
                                <div className="flex items-center justify-center gap-2 mb-3">
                                    <FiShield size={18} style={{ color: 'var(--primary-500)' }} />
                                    <label className="font-medium">Ingresa tu PIN de 4 dígitos</label>
                                </div>
                                <PinInput
                                    onComplete={(completedPin) => setPin(completedPin)}
                                    disabled={signing}
                                    mode="verify"
                                    error={error}
                                />
                                {error && (
                                    <div className="mt-3 text-sm" style={{ color: 'var(--error-500)' }}>
                                        <FiAlertCircle style={{ display: 'inline', marginRight: '4px' }} />
                                        {error}
                                    </div>
                                )}
                            </div>
                        </div>

                        <div
                            className="modal-footer"
                            style={{
                                borderTop: '1px solid var(--surface-border)',
                                paddingTop: 'var(--space-4)',
                                gap: 'var(--space-3)',
                            }}
                        >
                            <button
                                className="btn btn-secondary"
                                onClick={() => setShowSignModal(false)}
                                disabled={signing}
                                style={{ flex: 1 }}
                            >
                                <FiX size={16} />
                                Cancelar
                            </button>
                            <button
                                className="btn btn-primary"
                                onClick={handleSign}
                                disabled={signing || pin.length !== 4}
                                style={{
                                    flex: 2,
                                    boxShadow: pin.length === 4 ? 'var(--shadow-glow-primary)' : 'none',
                                }}
                            >
                                {signing ? (
                                    <>
                                        <div className="spinner" style={{ width: '16px', height: '16px' }} />
                                        Firmando...
                                    </>
                                ) : (
                                    <>
                                        <FiCheck size={18} />
                                        Confirmar Firma
                                    </>
                                )}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
