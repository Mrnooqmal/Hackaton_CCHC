import { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import PinInput from '../components/PinInput';
import {
    FiCheck,
    FiClock,
    FiFileText,
    FiCalendar,
    FiUser,
    FiAlertCircle,
    FiX,
    FiDownload,
    FiEdit3,
    FiShield,
    FiRefreshCw,
} from 'react-icons/fi';

import {
    signatureRequestsApi,
    signaturesApi,
    documentsApi,
    uploadsApi,
    type SignatureRequest,
    type NewSignature,
    REQUEST_TYPES,
} from '../api/client';

type PendingItem = SignatureRequest & {
    __kind?: 'document';
    __documentId?: string;
    __tipoLabel?: string;
};

const docToPendingItem = (doc: any): PendingItem => {
    const fileKey: string | null = doc.s3Key || doc.archivoUrl || null;
    const nombre: string = doc.archivoNombre || doc.titulo || 'Documento';
    return {
        requestId: `doc:${doc.documentId}`,
        tipo: doc.tipo,
        tipoInfo: undefined as any,
        titulo: doc.titulo || doc.tipoDescripcion || 'Documento de onboarding',
        descripcion: doc.descripcion || '',
        documentos: fileKey ? [{ nombre, url: fileKey, tipo: '', tamaño: 0 }] : [],
        tieneDocumentos: Boolean(fileKey),
        solicitanteId: doc.createdBy || 'system',
        solicitanteNombre: doc.creatorName || 'Sistema DS44',
        solicitanteRut: '',
        trabajadores: [],
        totalRequeridos: 1,
        totalFirmados: 0,
        fechaCreacion: doc.createdAt || new Date().toISOString(),
        fechaLimite: null,
        fechaCompletado: null,
        ubicacion: null,
        obraId: doc.obraId || null,
        empresaId: doc.tenantId || '',
        estado: 'pendiente',
        createdAt: doc.createdAt || '',
        updatedAt: doc.updatedAt || '',
        __kind: 'document',
        __documentId: doc.documentId,
        __tipoLabel: doc.articulo ? `Onboarding · ${doc.articulo}` : 'Onboarding',
    };
};
import { useAuth } from '../context/AuthContext';
import { Modal, PageHeader } from '../components/ui';

type TabType = 'pendientes' | 'historial';

const formatLocalDateTime = (timestamp: string) => {
    const d = new Date(timestamp);
    if (isNaN(d.getTime())) return { date: '—', time: '—' };
    return {
        date: d.toLocaleDateString('es-CL', { day: 'numeric', month: 'short', year: 'numeric' }),
        time: d.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' }),
    };
};

export default function MySignatures() {
    const { user } = useAuth();
    const location = useLocation();
    const navigate = useNavigate();
    const [activeTab, setActiveTab] = useState<TabType>('pendientes');
    const [pendingRequests, setPendingRequests] = useState<PendingItem[]>([]);
    const [signatureHistory, setSignatureHistory] = useState<{ firma: NewSignature; solicitud: SignatureRequest | null }[]>([]);
    const [loading, setLoading] = useState(true);
    const [expandedHistId, setExpandedHistId] = useState<string | null>(null);
    const [selectedRequest, setSelectedRequest] = useState<PendingItem | null>(null);
    const [showSignModal, setShowSignModal] = useState(false);
    const [signing, setSigning] = useState(false);
    const [pin, setPin] = useState('');
    const [declared, setDeclared] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        if (user?.personaId) {
            loadData();
        } else {
            setLoading(false);
        }
    }, [user?.personaId]);

    useEffect(() => {
        const target = (location.state as { firmarRequestId?: string } | null)?.firmarRequestId;
        if (!target || pendingRequests.length === 0) return;
        const item = pendingRequests.find(r => r.requestId === target);
        if (item) {
            setSelectedRequest(item);
            setPin('');
            setDeclared(false);
            setError('');
            setShowSignModal(true);
            setActiveTab('pendientes');
        }
        navigate(location.pathname, { replace: true, state: null });
    }, [pendingRequests, location.state]);

    const loadData = async () => {
        if (!user?.personaId) return;
        setLoading(true);
        try {
            const [pendingRes, historyRes, onboardingDocsRes] = await Promise.all([
                signatureRequestsApi.getPendingByWorker(user.personaId),
                signatureRequestsApi.getHistoryByWorker(user.personaId),
                documentsApi.list({ clasificacion: 'diario', pendienteDe: user.personaId }),
            ]);

            const requests: PendingItem[] = (pendingRes.success && pendingRes.data)
                ? pendingRes.data.pendientes
                : [];
            const onboardingDocs: PendingItem[] = (onboardingDocsRes.success && onboardingDocsRes.data?.documents)
                ? onboardingDocsRes.data.documents.map(docToPendingItem)
                : [];
            setPendingRequests([...onboardingDocs, ...requests]);

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
        if (!selectedRequest || !user?.personaId || pin.length !== 4) return;
        setSigning(true);
        setError('');
        try {
            const response = selectedRequest.__kind === 'document' && selectedRequest.__documentId
                ? await documentsApi.sign(selectedRequest.__documentId, {
                    personaId: user.personaId,
                    tipoFirma: 'documento',
                    pin,
                })
                : await signaturesApi.create({
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
                setDeclared(false);
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

    const openSignModal = (request: PendingItem) => {
        setSelectedRequest(request);
        setPin('');
        setDeclared(false);
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

    if (!user?.personaId) {
        return (
            <div className="main-content">
                <div className="empty-state">
                    <div className="empty-state-icon"><FiAlertCircle size={48} style={{ color: 'var(--warning-500)' }} /></div>
                    <h3 className="empty-state-title">No tienes acceso</h3>
                    <p className="empty-state-description">Tu cuenta no está asociada a un perfil de trabajador.</p>
                </div>
            </div>
        );
    }

    return (
        <>
            <div className="page-content">
                <PageHeader
                    banner
                    scope={{ label: 'Firmas Digitales' }}
                    title="Mis Firmas"
                    description="Documentos pendientes de firma y registro de tu historial."
                    actions={
                        <button className="btn btn-secondary" onClick={loadData} disabled={loading}>
                            <FiRefreshCw className={loading ? 'spin' : ''} /> Actualizar
                        </button>
                    }
                />

                {/* Tabs */}
                <div className="msig-tabs">
                    <button
                        className={`msig-tab ${activeTab === 'pendientes' ? 'active' : ''}`}
                        onClick={() => setActiveTab('pendientes')}
                    >
                        <FiClock size={15} />
                        Pendientes
                        {pendingRequests.length > 0 && (
                            <span className="msig-tab-count">{pendingRequests.length}</span>
                        )}
                    </button>
                    <button
                        className={`msig-tab ${activeTab === 'historial' ? 'active' : ''}`}
                        onClick={() => setActiveTab('historial')}
                    >
                        <FiCheck size={15} />
                        Historial
                        {signatureHistory.length > 0 && (
                            <span className="msig-tab-count msig-tab-count--muted">{signatureHistory.length}</span>
                        )}
                    </button>
                </div>

                {/* Pendientes */}
                {activeTab === 'pendientes' && (
                    pendingRequests.length === 0 ? (
                        <div className="empty-state" style={{ padding: 'var(--space-16)' }}>
                            <div className="empty-state-icon">
                                <FiCheck size={40} style={{ color: 'var(--success-500)' }} />
                            </div>
                            <h3 className="empty-state-title">Todo al día</h3>
                            <p className="empty-state-description">
                                No tienes solicitudes pendientes de firma. Te notificaremos cuando haya nuevos documentos.
                            </p>
                        </div>
                    ) : (
                        <div className="msig-list">
                            {pendingRequests.map((request) => (
                                <div key={request.requestId} className="msig-card">
                                    <div className="msig-card-main">
                                        <div className="msig-card-icon">
                                            {REQUEST_TYPES[request.tipo]?.icon || <FiFileText size={18} />}
                                        </div>
                                        <div className="msig-card-body">
                                            <div className="msig-card-type">
                                                {REQUEST_TYPES[request.tipo]?.label || request.__tipoLabel || 'Documento'}
                                            </div>
                                            <h3 className="msig-card-title">{request.titulo}</h3>
                                            <div className="msig-card-meta">
                                                <span className="msig-meta-item">
                                                    <FiUser size={12} />
                                                    {request.solicitanteNombre}
                                                </span>
                                                <span className="msig-meta-sep">·</span>
                                                <span className="msig-meta-item">
                                                    <FiCalendar size={12} />
                                                    {new Date(request.fechaCreacion).toLocaleDateString('es-CL', {
                                                        day: 'numeric',
                                                        month: 'short',
                                                        year: 'numeric',
                                                    })}
                                                </span>
                                            </div>
                                            {request.descripcion && (
                                                <p className="msig-card-desc">{request.descripcion}</p>
                                            )}
                                            {request.documentos.length > 0 && (
                                                <div className="msig-docs">
                                                    {request.documentos.map((doc, idx) => (
                                                        <button
                                                            key={idx}
                                                            className="msig-doc-chip"
                                                            onClick={() => downloadDocument(doc.url, doc.nombre)}
                                                        >
                                                            <FiDownload size={12} />
                                                            {doc.nombre}
                                                        </button>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                        <div className="msig-card-action">
                                            <button
                                                className="btn btn-primary btn-sm"
                                                onClick={() => openSignModal(request)}
                                            >
                                                <FiEdit3 size={14} /> Firmar
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )
                )}

                {/* Historial */}
                {activeTab === 'historial' && (
                    signatureHistory.length === 0 ? (
                        <div className="empty-state" style={{ padding: 'var(--space-16)' }}>
                            <div className="empty-state-icon">
                                <FiFileText size={40} style={{ color: 'var(--text-muted)' }} />
                            </div>
                            <h3 className="empty-state-title">Sin historial</h3>
                            <p className="empty-state-description">
                                Aún no has firmado ningún documento. Aparecerán aquí con su información de validación.
                            </p>
                        </div>
                    ) : (
                        <div className="msig-history">
                            {signatureHistory.map(({ firma, solicitud }) => {
                                const isExpanded = expandedHistId === firma.signatureId;
                                const { date, time } = formatLocalDateTime(firma.timestamp || firma.createdAt);
                                const titulo = firma.requestTitulo || solicitud?.titulo || REQUEST_TYPES[firma.requestTipo]?.label || 'Firma';
                                const badgeKey = firma.estado === 'valida' ? 'valid' : firma.estado === 'disputada' ? 'warn' : 'err';
                                return (
                                    <div key={firma.signatureId} className={`msig-hist-row ${isExpanded ? 'msig-hist-row--expanded' : ''}`}>
                                        <button
                                            className="msig-hist-summary"
                                            onClick={() => setExpandedHistId(isExpanded ? null : firma.signatureId)}
                                            aria-expanded={isExpanded}
                                        >
                                            <div className="msig-hist-icon">
                                                {REQUEST_TYPES[firma.requestTipo]?.icon || <FiFileText size={16} />}
                                            </div>
                                            <div className="msig-hist-body">
                                                <div className="msig-hist-title">{titulo}</div>
                                                <div className="msig-hist-meta">
                                                    <span className="msig-meta-item"><FiCalendar size={11} />{date} · {time}</span>
                                                    {firma.solicitanteNombre && (
                                                        <>
                                                            <span className="msig-meta-sep">·</span>
                                                            <span className="msig-meta-item"><FiUser size={11} />{firma.solicitanteNombre}</span>
                                                        </>
                                                    )}
                                                </div>
                                            </div>
                                            <div className="msig-hist-right">
                                                <span className={`msig-badge msig-badge--${badgeKey}`}>
                                                    {firma.estado === 'valida' ? <><FiCheck size={11} /> Válida</> : firma.estado === 'disputada' ? <><FiAlertCircle size={11} /> Disputada</> : <><FiX size={11} /> {firma.estado}</>}
                                                </span>
                                            </div>
                                        </button>

                                        {isExpanded && (
                                            <div className="msig-hist-detail">
                                                <div className="msig-hist-detail-grid">
                                                    <div className="msig-hist-detail-item">
                                                        <span className="msig-hist-detail-label">Tipo</span>
                                                        <span>{REQUEST_TYPES[firma.requestTipo]?.label || firma.requestTipo || '—'}</span>
                                                    </div>
                                                    <div className="msig-hist-detail-item">
                                                        <span className="msig-hist-detail-label">Fecha y hora</span>
                                                        <span>{date} a las {time}</span>
                                                    </div>
                                                    {firma.solicitanteNombre && (
                                                        <div className="msig-hist-detail-item">
                                                            <span className="msig-hist-detail-label">Solicitado por</span>
                                                            <span>{firma.solicitanteNombre}</span>
                                                        </div>
                                                    )}
                                                    {solicitud?.documentos && solicitud.documentos.length > 0 && (
                                                        <div className="msig-hist-detail-item">
                                                            <span className="msig-hist-detail-label">Documentos</span>
                                                            <div className="msig-docs">
                                                                {solicitud.documentos.map((doc, idx) => (
                                                                    <button key={idx} className="msig-doc-chip" onClick={() => downloadDocument(doc.url, doc.nombre)}>
                                                                        <FiDownload size={11} />{doc.nombre}
                                                                    </button>
                                                                ))}
                                                            </div>
                                                        </div>
                                                    )}
                                                    <div className="msig-hist-detail-item" style={{ gridColumn: '1 / -1' }}>
                                                        <span className="msig-hist-detail-label">Token de verificación</span>
                                                        <span className="msig-token" style={{ fontSize: '12px' }}>
                                                            <FiShield size={12} />{firma.token}
                                                        </span>
                                                    </div>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    )
                )}
            </div>

            <Modal
                isOpen={showSignModal && !!selectedRequest}
                onClose={() => setShowSignModal(false)}
                title="Firma digital"
                size="sm"
                preventClose={signing}
                footer={
                    <>
                        <button className="btn btn-secondary" onClick={() => setShowSignModal(false)} disabled={signing} style={{ flex: 1 }}>
                            <FiX size={16} /> Cancelar
                        </button>
                        <button
                            className="btn btn-primary"
                            onClick={handleSign}
                            disabled={signing || pin.length !== 4 || !declared}
                            style={{ flex: 2 }}
                        >
                            {signing
                                ? <><div className="spinner" style={{ width: '16px', height: '16px' }} /> Firmando...</>
                                : <><FiCheck size={18} /> Confirmar Firma</>
                            }
                        </button>
                    </>
                }
            >
                {selectedRequest && (
                    <div className="msig-modal-pin">
                        <PinInput
                            onComplete={(completedPin) => setPin(completedPin)}
                            disabled={signing}
                            mode="verify"
                            error={error}
                        />
                        <label className="msig-declare-check" style={{ marginTop: 'var(--space-3)' }}>
                            <input
                                type="checkbox"
                                checked={declared}
                                onChange={e => setDeclared(e.target.checked)}
                                disabled={signing}
                            />
                            <span>Declaro haber leído conscientemente la solicitud de firma</span>
                        </label>
                    </div>
                )}
            </Modal>

            <style>{`
                /* ── Tabs ── */
                .msig-tabs {
                    display: flex;
                    gap: var(--space-1);
                    background: var(--surface-elevated);
                    border: 1px solid var(--surface-border);
                    border-radius: var(--radius-lg);
                    padding: var(--space-1);
                    width: fit-content;
                    margin-bottom: var(--space-5);
                }
                .msig-tab {
                    display: flex;
                    align-items: center;
                    gap: var(--space-2);
                    padding: var(--space-2) var(--space-4);
                    border-radius: var(--radius-md);
                    border: none;
                    background: transparent;
                    color: var(--text-muted);
                    font-size: var(--text-sm);
                    font-weight: 500;
                    cursor: pointer;
                    transition: all 0.15s;
                    white-space: nowrap;
                }
                .msig-tab:hover { color: var(--text-primary); background: var(--surface-hover); }
                .msig-tab.active {
                    background: var(--surface-card);
                    color: var(--text-primary);
                    box-shadow: var(--shadow-sm);
                    border: 1px solid var(--surface-border);
                }
                .msig-tab-count {
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    min-width: 20px;
                    height: 20px;
                    padding: 0 6px;
                    border-radius: var(--radius-full);
                    font-size: 11px;
                    font-weight: 700;
                    background: var(--warning-500);
                    color: white;
                }
                .msig-tab-count--muted {
                    background: var(--surface-border);
                    color: var(--text-secondary);
                }

                /* ── Lista de pendientes ── */
                .msig-list {
                    display: flex;
                    flex-direction: column;
                    gap: var(--space-3);
                }
                .msig-card {
                    background: var(--surface-card);
                    border: 1px solid var(--surface-border);
                    border-radius: var(--radius-xl);
                    padding: var(--space-4) var(--space-5);
                    transition: border-color 0.15s, box-shadow 0.15s;
                }
                .msig-card:hover {
                    border-color: var(--primary-300);
                    box-shadow: var(--shadow-md);
                }
                .msig-card-main {
                    display: flex;
                    align-items: flex-start;
                    gap: var(--space-4);
                }
                .msig-card-icon {
                    flex-shrink: 0;
                    width: 40px;
                    height: 40px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    background: var(--surface-elevated);
                    border: 1px solid var(--surface-border);
                    border-radius: var(--radius-lg);
                    color: var(--text-secondary);
                    font-size: 18px;
                }
                .msig-card-body { flex: 1; min-width: 0; }
                .msig-card-type {
                    font-size: 11px;
                    font-weight: 700;
                    letter-spacing: 0.05em;
                    text-transform: uppercase;
                    color: var(--accent-text);
                    margin-bottom: var(--space-1);
                }
                .msig-card-title {
                    font-size: var(--text-base);
                    font-weight: 600;
                    color: var(--text-primary);
                    margin: 0 0 var(--space-2);
                    line-height: 1.3;
                }
                .msig-card-meta {
                    display: flex;
                    align-items: center;
                    flex-wrap: wrap;
                    gap: var(--space-1);
                    font-size: var(--text-xs);
                    color: var(--text-muted);
                }
                .msig-meta-item {
                    display: inline-flex;
                    align-items: center;
                    gap: 4px;
                }
                .msig-meta-sep { color: var(--surface-border); }
                .msig-card-desc {
                    font-size: var(--text-sm);
                    color: var(--text-secondary);
                    margin: var(--space-2) 0 0;
                    line-height: 1.5;
                    padding: var(--space-2) var(--space-3);
                    background: var(--surface-elevated);
                    border-left: 3px solid var(--surface-border);
                    border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
                }
                .msig-docs {
                    display: flex;
                    flex-wrap: wrap;
                    gap: var(--space-2);
                    margin-top: var(--space-3);
                    padding-top: var(--space-3);
                    border-top: 1px solid var(--surface-border);
                }
                .msig-doc-chip {
                    display: inline-flex;
                    align-items: center;
                    gap: var(--space-1);
                    padding: 4px 10px;
                    background: var(--surface-elevated);
                    border: 1px solid var(--surface-border);
                    border-radius: var(--radius-md);
                    font-size: var(--text-xs);
                    color: var(--text-secondary);
                    cursor: pointer;
                    transition: background 0.15s, color 0.15s;
                }
                .msig-doc-chip:hover {
                    background: var(--surface-hover);
                    color: var(--text-primary);
                }
                .msig-card-action {
                    flex-shrink: 0;
                    padding-top: 2px;
                }

                /* ── Historial ── */
                .msig-history {
                    display: flex;
                    flex-direction: column;
                    gap: 0;
                    background: var(--surface-card);
                    border: 1px solid var(--surface-border);
                    border-radius: var(--radius-xl);
                    overflow: hidden;
                }
                .msig-hist-row {
                    display: flex;
                    flex-direction: column;
                    border-bottom: 1px solid var(--surface-border);
                }
                .msig-hist-row:last-child { border-bottom: none; }
                .msig-hist-row--expanded { background: var(--surface-elevated); }
                .msig-hist-summary {
                    display: flex;
                    align-items: center;
                    gap: var(--space-3);
                    padding: var(--space-3) var(--space-4);
                    background: none;
                    border: none;
                    text-align: left;
                    width: 100%;
                    cursor: pointer;
                    transition: background 0.12s;
                }
                .msig-hist-summary:hover { background: var(--surface-hover); }
                .msig-hist-detail {
                    padding: var(--space-3) var(--space-4) var(--space-4);
                    border-top: 1px dashed var(--surface-border);
                }
                .msig-hist-detail-grid {
                    display: grid;
                    grid-template-columns: 1fr 1fr;
                    gap: var(--space-3) var(--space-6);
                }
                .msig-hist-detail-item {
                    display: flex;
                    flex-direction: column;
                    gap: 2px;
                    font-size: var(--text-sm);
                    color: var(--text-primary);
                }
                .msig-hist-detail-label {
                    font-size: 11px;
                    font-weight: 600;
                    text-transform: uppercase;
                    letter-spacing: 0.05em;
                    color: var(--text-muted);
                }
                .msig-hist-icon {
                    flex-shrink: 0;
                    width: 32px;
                    height: 32px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    background: var(--surface-elevated);
                    border: 1px solid var(--surface-border);
                    border-radius: var(--radius-md);
                    color: var(--text-muted);
                    font-size: 15px;
                }
                .msig-hist-body { flex: 1; min-width: 0; }
                .msig-hist-title {
                    font-size: var(--text-sm);
                    font-weight: 500;
                    color: var(--text-primary);
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    margin-bottom: 2px;
                }
                .msig-hist-meta {
                    display: flex;
                    align-items: center;
                    flex-wrap: wrap;
                    gap: var(--space-1);
                    font-size: 11px;
                    color: var(--text-muted);
                }
                .msig-hist-right {
                    flex-shrink: 0;
                    display: flex;
                    flex-direction: column;
                    align-items: flex-end;
                    gap: var(--space-1);
                }
                .msig-badge {
                    display: inline-flex;
                    align-items: center;
                    gap: 3px;
                    padding: 3px 8px;
                    border-radius: var(--radius-full);
                    font-size: 11px;
                    font-weight: 600;
                }
                .msig-badge--valid { background: var(--success-500); color: #fff; }
                .msig-badge--warn  { background: var(--warning-500); color: #fff; }
                .msig-badge--err   { background: var(--danger-500);  color: #fff; }
                .msig-token {
                    display: inline-flex;
                    align-items: center;
                    gap: 4px;
                    font-family: monospace;
                    font-size: 10px;
                    color: var(--text-muted);
                }

                .msig-declare-check {
                    display: flex;
                    align-items: flex-start;
                    gap: var(--space-3);
                    margin-top: var(--space-4);
                    padding: var(--space-3) var(--space-4);
                    background: var(--surface-elevated);
                    border: 1px solid var(--surface-border);
                    border-radius: var(--radius-lg);
                    cursor: pointer;
                    transition: border-color 0.15s;
                    font-size: var(--text-sm);
                    color: var(--text-secondary);
                    line-height: 1.4;
                    user-select: none;
                }
                .msig-declare-check:has(input:checked) {
                    border-color: var(--primary-400);
                    background: var(--accent-tint);
                    color: var(--text-primary);
                }
                .msig-declare-check input[type="checkbox"] {
                    flex-shrink: 0;
                    width: 16px;
                    height: 16px;
                    margin-top: 1px;
                    accent-color: var(--primary-500);
                    cursor: pointer;
                }

                /* ── Dark mode ── */
                [data-theme="dark"] .msig-modal-warning { border-color: rgba(251,191,36,0.25); }
                @media (prefers-color-scheme: dark) {
                    .msig-modal-warning { border-color: rgba(251,191,36,0.25); }
                }

                /* ── Mobile ── */
                @media (max-width: 640px) {
                    .msig-tabs { width: 100%; }
                    .msig-tab { flex: 1; justify-content: center; }
                    .msig-card-main { flex-wrap: wrap; }
                    .msig-card-action { width: 100%; padding-top: var(--space-3); border-top: 1px solid var(--surface-border); }
                    .msig-card-action .btn { width: 100%; justify-content: center; }
                    .msig-hist-row { flex-wrap: wrap; gap: var(--space-2); }
                    .msig-hist-right { flex-direction: row; width: 100%; justify-content: space-between; }
                }
            `}</style>
        </>
    );
}
