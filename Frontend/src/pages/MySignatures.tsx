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
    FiChevronRight,
    FiX,
    FiDownload,
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
                        <div className="empty-state-icon">⚠️</div>
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

            <div className="main-content">
                {/* Stats */}
                <div className="grid grid-cols-3 mb-6">
                    <div className="card">
                        <div className="flex items-center gap-3">
                            <div className="avatar" style={{ background: 'var(--warning-100)', color: 'var(--warning-600)' }}>
                                <FiClock size={24} />
                            </div>
                            <div>
                                <div className="text-2xl font-bold">{pendingRequests.length}</div>
                                <div className="text-sm text-muted">Pendientes</div>
                            </div>
                        </div>
                    </div>
                    <div className="card">
                        <div className="flex items-center gap-3">
                            <div className="avatar" style={{ background: 'var(--success-100)', color: 'var(--success-600)' }}>
                                <FiCheck size={24} />
                            </div>
                            <div>
                                <div className="text-2xl font-bold">{signatureHistory.length}</div>
                                <div className="text-sm text-muted">Firmados</div>
                            </div>
                        </div>
                    </div>
                    <div className="card">
                        <div className="flex items-center gap-3">
                            <div className="avatar" style={{ background: 'var(--primary-100)', color: 'var(--primary-600)' }}>
                                <FiFileText size={24} />
                            </div>
                            <div>
                                <div className="text-2xl font-bold">{pendingRequests.length + signatureHistory.length}</div>
                                <div className="text-sm text-muted">Total</div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Tabs */}
                <div className="tabs mb-6">
                    <button
                        className={`tab ${activeTab === 'pendientes' ? 'active' : ''}`}
                        onClick={() => setActiveTab('pendientes')}
                    >
                        <FiClock />
                        Pendientes ({pendingRequests.length})
                    </button>
                    <button
                        className={`tab ${activeTab === 'historial' ? 'active' : ''}`}
                        onClick={() => setActiveTab('historial')}
                    >
                        <FiCheck />
                        Historial ({signatureHistory.length})
                    </button>
                </div>

                {/* Content */}
                {activeTab === 'pendientes' && (
                    <div className="card">
                        <div className="card-header">
                            <h2 className="card-title">Solicitudes Pendientes de Firma</h2>
                        </div>

                        {pendingRequests.length === 0 ? (
                            <div className="empty-state" style={{ padding: 'var(--space-8)' }}>
                                <div className="empty-state-icon">✅</div>
                                <h3 className="empty-state-title">¡Todo al día!</h3>
                                <p className="empty-state-description">
                                    No tienes solicitudes pendientes de firma.
                                </p>
                            </div>
                        ) : (
                            <div className="flex flex-col gap-3">
                                {pendingRequests.map((request) => (
                                    <div
                                        key={request.requestId}
                                        className="card"
                                        style={{
                                            border: '1px solid var(--warning-200)',
                                            background: 'var(--warning-50)',
                                        }}
                                    >
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-4">
                                                <div className="avatar" style={{ fontSize: '1.5rem', background: 'white' }}>
                                                    {REQUEST_TYPES[request.tipo]?.icon || '📝'}
                                                </div>
                                                <div>
                                                    <div className="font-bold">{request.titulo}</div>
                                                    <div className="text-sm text-muted">
                                                        {REQUEST_TYPES[request.tipo]?.label}
                                                    </div>
                                                    <div className="flex items-center gap-2 mt-1 text-sm text-muted">
                                                        <FiUser size={14} />
                                                        Solicitado por: {request.solicitanteNombre}
                                                    </div>
                                                    <div className="flex items-center gap-2 text-sm text-muted">
                                                        <FiCalendar size={14} />
                                                        {new Date(request.fechaCreacion).toLocaleDateString('es-CL', {
                                                            weekday: 'long',
                                                            year: 'numeric',
                                                            month: 'long',
                                                            day: 'numeric',
                                                        })}
                                                    </div>
                                                </div>
                                            </div>
                                            <button
                                                className="btn btn-primary"
                                                onClick={() => openSignModal(request)}
                                            >
                                                Firmar <FiChevronRight />
                                            </button>
                                        </div>

                                        {/* Documents preview */}
                                        {request.documentos.length > 0 && (
                                            <div className="mt-4 pt-4" style={{ borderTop: '1px solid var(--warning-200)' }}>
                                                <div className="text-sm font-medium mb-2">Documentos a revisar:</div>
                                                <div className="flex gap-2 flex-wrap">
                                                    {request.documentos.map((doc, idx) => (
                                                        <button
                                                            key={idx}
                                                            className="btn btn-secondary btn-sm"
                                                            onClick={() => downloadDocument(doc.url, doc.nombre)}
                                                        >
                                                            <FiFile size={14} /> {doc.nombre}
                                                        </button>
                                                    ))}
                                                </div>
                                            </div>
                                        )}

                                        {request.descripcion && (
                                            <div className="mt-3 p-3 rounded" style={{ background: 'white' }}>
                                                <div className="text-sm">{request.descripcion}</div>
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
                            <h2 className="card-title">Historial de Firmas</h2>
                        </div>

                        {signatureHistory.length === 0 ? (
                            <div className="empty-state" style={{ padding: 'var(--space-8)' }}>
                                <div className="empty-state-icon">📋</div>
                                <h3 className="empty-state-title">Sin historial</h3>
                                <p className="empty-state-description">
                                    Aún no has firmado ningún documento.
                                </p>
                            </div>
                        ) : (
                            <div className="table-container">
                                <table className="table">
                                    <thead>
                                        <tr>
                                            <th>Documento</th>
                                            <th>Tipo</th>
                                            <th>Solicitante</th>
                                            <th>Fecha de Firma</th>
                                            <th>Token</th>
                                            <th>Estado</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {signatureHistory.map(({ firma, solicitud }) => (
                                            <tr key={firma.signatureId}>
                                                <td>
                                                    <div className="flex items-center gap-2">
                                                        <span style={{ fontSize: '1.2rem' }}>
                                                            {REQUEST_TYPES[firma.requestTipo]?.icon || '📝'}
                                                        </span>
                                                        <div>
                                                            <div className="font-medium">{firma.requestTitulo}</div>
                                                            {solicitud?.documentos && solicitud.documentos.length > 0 && (
                                                                <div className="text-xs text-muted">
                                                                    {solicitud.documentos.length} documento(s) adjunto(s)
                                                                </div>
                                                            )}
                                                        </div>
                                                    </div>
                                                </td>
                                                <td>
                                                    <span className="badge" style={{ background: 'var(--neutral-100)' }}>
                                                        {REQUEST_TYPES[firma.requestTipo]?.label || firma.requestTipo}
                                                    </span>
                                                </td>
                                                <td>{firma.solicitanteNombre}</td>
                                                <td>
                                                    <div>{firma.fecha}</div>
                                                    <div className="text-xs text-muted">{firma.horario}</div>
                                                </td>
                                                <td>
                                                    <code className="text-xs" style={{ background: 'var(--neutral-100)', padding: '2px 6px', borderRadius: '4px' }}>
                                                        {firma.token.slice(0, 8)}...
                                                    </code>
                                                </td>
                                                <td>
                                                    {firma.estado === 'valida' ? (
                                                        <span className="badge" style={{ background: 'var(--success-500)', color: 'white' }}>
                                                            <FiCheck size={14} /> Válida
                                                        </span>
                                                    ) : firma.estado === 'disputada' ? (
                                                        <span className="badge" style={{ background: 'var(--warning-500)', color: 'white' }}>
                                                            <FiAlertCircle size={14} /> Disputada
                                                        </span>
                                                    ) : (
                                                        <span className="badge" style={{ background: 'var(--error-500)', color: 'white' }}>
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
                    <div className="modal" style={{ maxWidth: '500px' }} onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <h2>Confirmar Firma</h2>
                            <button className="btn btn-ghost" onClick={() => setShowSignModal(false)}>
                                <FiX />
                            </button>
                        </div>

                        <div className="modal-body">
                            {/* Request Details */}
                            <div className="card mb-4" style={{ background: 'var(--neutral-50)' }}>
                                <div className="flex items-center gap-3 mb-3">
                                    <span style={{ fontSize: '2rem' }}>
                                        {REQUEST_TYPES[selectedRequest.tipo]?.icon || '📝'}
                                    </span>
                                    <div>
                                        <div className="font-bold text-lg">{selectedRequest.titulo}</div>
                                        <div className="text-sm text-muted">
                                            {REQUEST_TYPES[selectedRequest.tipo]?.label}
                                        </div>
                                    </div>
                                </div>

                                {selectedRequest.descripcion && (
                                    <p className="text-sm mb-3">{selectedRequest.descripcion}</p>
                                )}

                                <div className="text-sm">
                                    <div className="flex items-center gap-2 text-muted">
                                        <FiUser size={14} />
                                        Solicitado por: <strong>{selectedRequest.solicitanteNombre}</strong>
                                    </div>
                                    <div className="flex items-center gap-2 text-muted mt-1">
                                        <FiCalendar size={14} />
                                        {new Date(selectedRequest.fechaCreacion).toLocaleDateString('es-CL')}
                                    </div>
                                </div>

                                {/* Documents to sign */}
                                {selectedRequest.documentos.length > 0 && (
                                    <div className="mt-4 pt-4" style={{ borderTop: '1px solid var(--neutral-200)' }}>
                                        <div className="text-sm font-medium mb-2">
                                            Documentos que estás firmando:
                                        </div>
                                        <div className="flex flex-col gap-2">
                                            {selectedRequest.documentos.map((doc, idx) => (
                                                <div
                                                    key={idx}
                                                    className="flex items-center justify-between p-2 rounded"
                                                    style={{ background: 'white' }}
                                                >
                                                    <div className="flex items-center gap-2">
                                                        <FiFile size={16} />
                                                        <span className="text-sm">{doc.nombre}</span>
                                                    </div>
                                                    <button
                                                        className="btn btn-ghost btn-sm"
                                                        onClick={() => downloadDocument(doc.url, doc.nombre)}
                                                    >
                                                        <FiDownload size={14} />
                                                    </button>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* Warning */}
                            <div className="alert alert-warning mb-4" style={{ background: 'var(--warning-50)', border: '1px solid var(--warning-200)', borderRadius: 'var(--radius-md)', padding: 'var(--space-4)' }}>
                                <div className="flex items-start gap-3">
                                    <FiAlertCircle style={{ color: 'var(--warning-600)', flexShrink: 0, marginTop: '2px' }} />
                                    <div className="text-sm">
                                        <strong>Declaración de conformidad:</strong> Al ingresar tu PIN confirmas que has leído y comprendido los documentos adjuntos, y aceptas los términos establecidos.
                                    </div>
                                </div>
                            </div>

                            {/* PIN Input */}
                            <div className="text-center">
                                <label className="label">Ingresa tu PIN de 4 dígitos</label>
                                <PinInput
                                    onComplete={(completedPin) => setPin(completedPin)}
                                    disabled={signing}
                                    mode="verify"
                                    error={error}
                                />
                            </div>
                        </div>

                        <div className="modal-footer">
                            <button
                                className="btn btn-secondary"
                                onClick={() => setShowSignModal(false)}
                                disabled={signing}
                            >
                                Cancelar
                            </button>
                            <button
                                className="btn btn-primary"
                                onClick={handleSign}
                                disabled={signing || pin.length !== 4}
                            >
                                {signing ? <div className="spinner" /> : <FiCheck />}
                                Confirmar Firma
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
