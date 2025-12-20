import { useState, useEffect } from 'react';
import Header from '../components/Header';
import {
    FiMail, FiSend, FiInbox, FiArchive, FiSearch,
    FiCheck, FiCheckCircle, FiAlertCircle, FiBell, FiClock,
    FiTrash2, FiChevronLeft, FiPlus
} from 'react-icons/fi';
import { inboxApi, type InboxMessage, type InboxRecipient, type SendMessageData, type MessageType, type MessagePriority } from '../api/client';
import { useAuth } from '../context/AuthContext';

type TabType = 'inbox' | 'sent' | 'archived';
type FilterType = 'all' | 'unread' | 'archived';

export default function Inbox() {
    const { user } = useAuth();
    const [activeTab, setActiveTab] = useState<TabType>('inbox');
    const [messages, setMessages] = useState<InboxMessage[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedMessage, setSelectedMessage] = useState<InboxMessage | null>(null);
    const [filter, setFilter] = useState<FilterType>('all');
    const [searchTerm, setSearchTerm] = useState('');
    const [unreadCount, setUnreadCount] = useState(0);

    // Compose modal
    const [showCompose, setShowCompose] = useState(false);
    const [recipients, setRecipients] = useState<InboxRecipient[]>([]);
    const [loadingRecipients, setLoadingRecipients] = useState(false);
    const [composing, setComposing] = useState(false);
    const [composeData, setComposeData] = useState({
        recipientIds: [] as string[],
        subject: '',
        content: '',
        type: 'message' as MessageType,
        priority: 'normal' as MessagePriority
    });

    useEffect(() => {
        if (user?.userId) {
            loadMessages();
            loadUnreadCount();
        }
    }, [user?.userId, activeTab, filter]);

    const loadMessages = async () => {
        if (!user?.userId) return;
        setLoading(true);
        try {
            let response;
            if (activeTab === 'inbox') {
                response = await inboxApi.getInbox(user.userId, filter);
            } else if (activeTab === 'sent') {
                response = await inboxApi.getSent(user.userId);
            } else {
                response = await inboxApi.getInbox(user.userId, 'archived');
            }

            if (response.success && response.data) {
                setMessages(response.data.messages);
            }
        } catch (error) {
            console.error('Error loading messages:', error);
        } finally {
            setLoading(false);
        }
    };

    const loadUnreadCount = async () => {
        if (!user?.userId) return;
        try {
            const response = await inboxApi.getUnreadCount(user.userId);
            if (response.success && response.data) {
                setUnreadCount(response.data.unreadCount);
            }
        } catch (error) {
            console.error('Error loading unread count:', error);
        }
    };

    const loadRecipients = async () => {
        if (!user?.userId) return;
        setLoadingRecipients(true);
        try {
            const response = await inboxApi.getRecipients(user.userId, user.empresaId);
            if (response.success && response.data) {
                setRecipients(response.data.recipients);
            }
        } catch (error) {
            console.error('Error loading recipients:', error);
        } finally {
            setLoadingRecipients(false);
        }
    };

    const handleOpenMessage = async (message: InboxMessage) => {
        setSelectedMessage(message);
        if (!message.read && user?.userId) {
            await inboxApi.markAsRead(message.messageId, user.userId);
            setMessages(prev => prev.map(m =>
                m.messageId === message.messageId ? { ...m, read: true } : m
            ));
            setUnreadCount(prev => Math.max(0, prev - 1));
        }
    };

    const handleArchive = async (messageId: string) => {
        if (!user?.userId) return;
        try {
            await inboxApi.archive(messageId, user.userId);
            setMessages(prev => prev.filter(m => m.messageId !== messageId));
            setSelectedMessage(null);
        } catch (error) {
            console.error('Error archiving:', error);
        }
    };

    const handleDelete = async (messageId: string) => {
        if (!user?.userId) return;
        if (!confirm('¿Eliminar este mensaje?')) return;
        try {
            await inboxApi.delete(messageId, user.userId);
            setMessages(prev => prev.filter(m => m.messageId !== messageId));
            setSelectedMessage(null);
        } catch (error) {
            console.error('Error deleting:', error);
        }
    };

    const handleMarkAllAsRead = async () => {
        if (!user?.userId) return;
        try {
            await inboxApi.markAllAsRead(user.userId);
            setMessages(prev => prev.map(m => ({ ...m, read: true })));
            setUnreadCount(0);
        } catch (error) {
            console.error('Error marking all as read:', error);
        }
    };

    const handleCompose = () => {
        setShowCompose(true);
        loadRecipients();
        setComposeData({
            recipientIds: [],
            subject: '',
            content: '',
            type: 'message',
            priority: 'normal'
        });
    };

    const handleSend = async () => {
        if (!user?.userId || composeData.recipientIds.length === 0 || !composeData.subject || !composeData.content) {
            alert('Por favor completa todos los campos');
            return;
        }

        setComposing(true);
        try {
            const sendData: SendMessageData = {
                senderId: user.userId,
                senderName: `${user.nombre} ${user.apellido || ''}`.trim(),
                senderRol: user.rol || 'trabajador',
                ...composeData
            };

            const response = await inboxApi.send(sendData);
            if (response.success) {
                setShowCompose(false);
                alert('Mensaje enviado exitosamente');
                if (activeTab === 'sent') loadMessages();
            } else {
                alert('Error al enviar: ' + response.error);
            }
        } catch (error) {
            console.error('Error sending:', error);
            alert('Error al enviar mensaje');
        } finally {
            setComposing(false);
        }
    };

    const toggleRecipient = (userId: string) => {
        setComposeData(prev => ({
            ...prev,
            recipientIds: prev.recipientIds.includes(userId)
                ? prev.recipientIds.filter(id => id !== userId)
                : [...prev.recipientIds, userId]
        }));
    };

    const getTypeIcon = (type: string) => {
        switch (type) {
            case 'alert': return <FiAlertCircle className="text-danger-500" />;
            case 'notification': return <FiBell className="text-info-500" />;
            case 'task': return <FiCheckCircle className="text-warning-500" />;
            default: return <FiMail className="text-primary-500" />;
        }
    };

    const getPriorityBadge = (priority: string) => {
        const badges: Record<string, string> = {
            urgent: 'badge-danger',
            high: 'badge-warning',
            normal: 'badge-secondary'
        };
        return badges[priority] || 'badge-secondary';
    };

    const formatDate = (date: string) => {
        const d = new Date(date);
        const now = new Date();
        const diff = now.getTime() - d.getTime();
        const days = Math.floor(diff / (1000 * 60 * 60 * 24));

        if (days === 0) {
            return d.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' });
        } else if (days === 1) {
            return 'Ayer';
        } else if (days < 7) {
            return d.toLocaleDateString('es-CL', { weekday: 'short' });
        } else {
            return d.toLocaleDateString('es-CL', { day: '2-digit', month: 'short' });
        }
    };

    const filteredMessages = messages.filter(m =>
        m.subject.toLowerCase().includes(searchTerm.toLowerCase()) ||
        m.senderName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        m.content.toLowerCase().includes(searchTerm.toLowerCase())
    );

    return (
        <>
            <Header title="Bandeja de Entrada" />

            <div className="page-content">
                <div className="inbox-container">
                    {/* Sidebar */}
                    <div className="inbox-sidebar">
                        <button className="btn btn-primary w-full mb-4" onClick={handleCompose}>
                            <FiPlus /> Nuevo Mensaje
                        </button>

                        <nav className="inbox-nav">
                            <button
                                className={`inbox-nav-item ${activeTab === 'inbox' ? 'active' : ''}`}
                                onClick={() => { setActiveTab('inbox'); setFilter('all'); }}
                            >
                                <FiInbox />
                                <span>Bandeja de Entrada</span>
                                {unreadCount > 0 && (
                                    <span className="inbox-badge">{unreadCount}</span>
                                )}
                            </button>
                            <button
                                className={`inbox-nav-item ${activeTab === 'sent' ? 'active' : ''}`}
                                onClick={() => setActiveTab('sent')}
                            >
                                <FiSend />
                                <span>Enviados</span>
                            </button>
                            <button
                                className={`inbox-nav-item ${activeTab === 'archived' ? 'active' : ''}`}
                                onClick={() => setActiveTab('archived')}
                            >
                                <FiArchive />
                                <span>Archivados</span>
                            </button>
                        </nav>

                        {activeTab === 'inbox' && (
                            <div className="inbox-filters">
                                <h4>Filtrar</h4>
                                <label className="inbox-filter-item">
                                    <input
                                        type="radio"
                                        checked={filter === 'all'}
                                        onChange={() => setFilter('all')}
                                    />
                                    Todos
                                </label>
                                <label className="inbox-filter-item">
                                    <input
                                        type="radio"
                                        checked={filter === 'unread'}
                                        onChange={() => setFilter('unread')}
                                    />
                                    No leídos
                                </label>
                            </div>
                        )}
                    </div>

                    {/* Message List */}
                    <div className="inbox-list">
                        <div className="inbox-list-header">
                            <div className="inbox-search">
                                <FiSearch />
                                <input
                                    type="text"
                                    placeholder="Buscar mensajes..."
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                />
                            </div>
                            {activeTab === 'inbox' && unreadCount > 0 && (
                                <button className="btn btn-sm btn-secondary" onClick={handleMarkAllAsRead}>
                                    <FiCheck /> Marcar todos leídos
                                </button>
                            )}
                        </div>

                        <div className="inbox-messages">
                            {loading ? (
                                <div className="inbox-empty">
                                    <div className="spinner" />
                                </div>
                            ) : filteredMessages.length === 0 ? (
                                <div className="inbox-empty">
                                    <FiInbox size={48} />
                                    <p>No hay mensajes</p>
                                </div>
                            ) : (
                                filteredMessages.map((message) => (
                                    <div
                                        key={message.messageId}
                                        className={`inbox-message-item ${!message.read ? 'unread' : ''} ${selectedMessage?.messageId === message.messageId ? 'selected' : ''}`}
                                        onClick={() => handleOpenMessage(message)}
                                    >
                                        <div className="inbox-message-icon">
                                            {getTypeIcon(message.type)}
                                        </div>
                                        <div className="inbox-message-content">
                                            <div className="inbox-message-header">
                                                <span className="inbox-message-sender">
                                                    {activeTab === 'sent' ? 'Para: ' : ''}{message.senderName}
                                                </span>
                                                <span className="inbox-message-time">{formatDate(message.createdAt)}</span>
                                            </div>
                                            <div className="inbox-message-subject">{message.subject}</div>
                                            <div className="inbox-message-preview">
                                                {message.content.substring(0, 80)}...
                                            </div>
                                        </div>
                                        {message.priority !== 'normal' && (
                                            <span className={`badge ${getPriorityBadge(message.priority)}`}>
                                                {message.priority}
                                            </span>
                                        )}
                                    </div>
                                ))
                            )}
                        </div>
                    </div>

                    {/* Message Detail */}
                    {selectedMessage && (
                        <div className="inbox-detail">
                            <div className="inbox-detail-header">
                                <button className="btn btn-ghost btn-sm" onClick={() => setSelectedMessage(null)}>
                                    <FiChevronLeft />
                                </button>
                                <div className="inbox-detail-actions">
                                    <button className="btn btn-ghost btn-sm" onClick={() => handleArchive(selectedMessage.messageId)} title="Archivar">
                                        <FiArchive />
                                    </button>
                                    <button className="btn btn-ghost btn-sm" onClick={() => handleDelete(selectedMessage.messageId)} title="Eliminar">
                                        <FiTrash2 />
                                    </button>
                                </div>
                            </div>

                            <div className="inbox-detail-content">
                                <h2 className="inbox-detail-subject">{selectedMessage.subject}</h2>
                                <div className="inbox-detail-meta">
                                    <div className="inbox-detail-sender">
                                        <div className="avatar avatar-sm">{selectedMessage.senderName.charAt(0)}</div>
                                        <div>
                                            <div className="font-semibold">{selectedMessage.senderName}</div>
                                            <div className="text-sm text-muted">{selectedMessage.senderRol}</div>
                                        </div>
                                    </div>
                                    <div className="text-sm text-muted">
                                        <FiClock size={12} /> {new Date(selectedMessage.createdAt).toLocaleString('es-CL')}
                                    </div>
                                </div>
                                <div className="inbox-detail-body">
                                    {selectedMessage.content.split('\n').map((line, i) => (
                                        <p key={i}>{line}</p>
                                    ))}
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Compose Modal */}
            {showCompose && (
                <div className="modal-overlay" onClick={() => setShowCompose(false)}>
                    <div className="modal-content max-w-2xl" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <div className="modal-header-icon">
                                <FiSend />
                            </div>
                            <h2 className="modal-title">Nuevo Mensaje</h2>
                        </div>

                        <div className="modal-body">
                            <div className="form-group">
                                <label className="form-label">Destinatarios *</label>
                                {loadingRecipients ? (
                                    <div className="spinner" />
                                ) : (
                                    <div className="recipient-list">
                                        {recipients.map((r) => (
                                            <label key={r.userId} className={`recipient-item ${composeData.recipientIds.includes(r.userId) ? 'selected' : ''}`}>
                                                <input
                                                    type="checkbox"
                                                    checked={composeData.recipientIds.includes(r.userId)}
                                                    onChange={() => toggleRecipient(r.userId)}
                                                />
                                                <div className="avatar avatar-sm">{r.nombre.charAt(0)}</div>
                                                <div>
                                                    <div className="font-semibold">{r.nombreCompleto}</div>
                                                    <div className="text-xs text-muted">{r.rol} • {r.rut}</div>
                                                </div>
                                            </label>
                                        ))}
                                    </div>
                                )}
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div className="form-group">
                                    <label className="form-label">Tipo</label>
                                    <select
                                        className="form-input"
                                        value={composeData.type}
                                        onChange={(e) => setComposeData({ ...composeData, type: e.target.value as MessageType })}
                                    >
                                        <option value="message">Mensaje</option>
                                        <option value="notification">Notificación</option>
                                        <option value="alert">Alerta</option>
                                        <option value="task">Tarea</option>
                                    </select>
                                </div>
                                <div className="form-group">
                                    <label className="form-label">Prioridad</label>
                                    <select
                                        className="form-input"
                                        value={composeData.priority}
                                        onChange={(e) => setComposeData({ ...composeData, priority: e.target.value as MessagePriority })}
                                    >
                                        <option value="normal">Normal</option>
                                        <option value="high">Alta</option>
                                        <option value="urgent">Urgente</option>
                                    </select>
                                </div>
                            </div>

                            <div className="form-group">
                                <label className="form-label">Asunto *</label>
                                <input
                                    type="text"
                                    className="form-input"
                                    placeholder="Asunto del mensaje"
                                    value={composeData.subject}
                                    onChange={(e) => setComposeData({ ...composeData, subject: e.target.value })}
                                />
                            </div>

                            <div className="form-group">
                                <label className="form-label">Mensaje *</label>
                                <textarea
                                    className="form-input"
                                    rows={6}
                                    placeholder="Escribe tu mensaje aquí..."
                                    value={composeData.content}
                                    onChange={(e) => setComposeData({ ...composeData, content: e.target.value })}
                                />
                            </div>
                        </div>

                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={() => setShowCompose(false)}>
                                Cancelar
                            </button>
                            <button className="btn btn-primary" onClick={handleSend} disabled={composing}>
                                {composing ? <><div className="spinner" /> Enviando...</> : <><FiSend /> Enviar</>}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <style>{`
                .inbox-container {
                    display: grid;
                    grid-template-columns: 240px 1fr 400px;
                    gap: var(--space-4);
                    height: calc(100vh - var(--header-height) - var(--space-12));
                    background: var(--surface-card);
                    border-radius: var(--radius-xl);
                    border: 1px solid var(--surface-border);
                    overflow: hidden;
                }

                .inbox-sidebar {
                    padding: var(--space-4);
                    border-right: 1px solid var(--surface-border);
                    display: flex;
                    flex-direction: column;
                }

                .inbox-nav {
                    display: flex;
                    flex-direction: column;
                    gap: var(--space-1);
                }

                .inbox-nav-item {
                    display: flex;
                    align-items: center;
                    gap: var(--space-3);
                    padding: var(--space-3);
                    border-radius: var(--radius-md);
                    background: transparent;
                    border: none;
                    color: var(--text-secondary);
                    cursor: pointer;
                    transition: all 0.2s;
                    text-align: left;
                    width: 100%;
                }

                .inbox-nav-item:hover {
                    background: var(--surface-hover);
                }

                .inbox-nav-item.active {
                    background: var(--primary-500);
                    color: white;
                }

                .inbox-badge {
                    margin-left: auto;
                    background: var(--danger-500);
                    color: white;
                    font-size: 11px;
                    font-weight: 600;
                    padding: 2px 8px;
                    border-radius: var(--radius-full);
                }

                .inbox-filters {
                    margin-top: var(--space-6);
                    padding-top: var(--space-4);
                    border-top: 1px solid var(--surface-border);
                }

                .inbox-filters h4 {
                    font-size: var(--text-xs);
                    text-transform: uppercase;
                    color: var(--text-muted);
                    margin-bottom: var(--space-2);
                }

                .inbox-filter-item {
                    display: flex;
                    align-items: center;
                    gap: var(--space-2);
                    padding: var(--space-2);
                    cursor: pointer;
                    font-size: var(--text-sm);
                }

                .inbox-list {
                    display: flex;
                    flex-direction: column;
                    overflow: hidden;
                }

                .inbox-list-header {
                    padding: var(--space-4);
                    border-bottom: 1px solid var(--surface-border);
                    display: flex;
                    gap: var(--space-3);
                    align-items: center;
                }

                .inbox-search {
                    flex: 1;
                    display: flex;
                    align-items: center;
                    gap: var(--space-2);
                    background: var(--surface-elevated);
                    padding: var(--space-2) var(--space-3);
                    border-radius: var(--radius-md);
                }

                .inbox-search input {
                    flex: 1;
                    background: transparent;
                    border: none;
                    outline: none;
                    color: var(--text-primary);
                }

                .inbox-messages {
                    flex: 1;
                    overflow-y: auto;
                }

                .inbox-empty {
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                    height: 100%;
                    color: var(--text-muted);
                    gap: var(--space-3);
                }

                .inbox-message-item {
                    display: flex;
                    align-items: flex-start;
                    gap: var(--space-3);
                    padding: var(--space-4);
                    border-bottom: 1px solid var(--surface-border);
                    cursor: pointer;
                    transition: background 0.2s;
                }

                .inbox-message-item:hover {
                    background: var(--surface-hover);
                }

                .inbox-message-item.selected {
                    background: var(--surface-elevated);
                }

                .inbox-message-item.unread {
                    background: rgba(76, 175, 80, 0.05);
                }

                .inbox-message-item.unread .inbox-message-subject {
                    font-weight: 700;
                }

                .inbox-message-icon {
                    width: 32px;
                    height: 32px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                }

                .inbox-message-content {
                    flex: 1;
                    min-width: 0;
                }

                .inbox-message-header {
                    display: flex;
                    justify-content: space-between;
                    margin-bottom: var(--space-1);
                }

                .inbox-message-sender {
                    font-size: var(--text-sm);
                    font-weight: 500;
                }

                .inbox-message-time {
                    font-size: var(--text-xs);
                    color: var(--text-muted);
                }

                .inbox-message-subject {
                    font-size: var(--text-sm);
                    margin-bottom: var(--space-1);
                }

                .inbox-message-preview {
                    font-size: var(--text-xs);
                    color: var(--text-muted);
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                }

                .inbox-detail {
                    border-left: 1px solid var(--surface-border);
                    display: flex;
                    flex-direction: column;
                }

                .inbox-detail-header {
                    display: flex;
                    justify-content: space-between;
                    padding: var(--space-4);
                    border-bottom: 1px solid var(--surface-border);
                }

                .inbox-detail-actions {
                    display: flex;
                    gap: var(--space-2);
                }

                .inbox-detail-content {
                    flex: 1;
                    padding: var(--space-5);
                    overflow-y: auto;
                }

                .inbox-detail-subject {
                    font-size: var(--text-xl);
                    font-weight: 700;
                    margin-bottom: var(--space-4);
                }

                .inbox-detail-meta {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    padding-bottom: var(--space-4);
                    border-bottom: 1px solid var(--surface-border);
                    margin-bottom: var(--space-4);
                }

                .inbox-detail-sender {
                    display: flex;
                    align-items: center;
                    gap: var(--space-3);
                }

                .inbox-detail-body {
                    line-height: 1.7;
                    color: var(--text-secondary);
                }

                .inbox-detail-body p {
                    margin-bottom: var(--space-3);
                }

                .recipient-list {
                    max-height: 200px;
                    overflow-y: auto;
                    border: 1px solid var(--surface-border);
                    border-radius: var(--radius-md);
                    padding: var(--space-2);
                }

                .recipient-item {
                    display: flex;
                    align-items: center;
                    gap: var(--space-3);
                    padding: var(--space-2);
                    border-radius: var(--radius-md);
                    cursor: pointer;
                    transition: background 0.2s;
                }

                .recipient-item:hover {
                    background: var(--surface-hover);
                }

                .recipient-item.selected {
                    background: rgba(76, 175, 80, 0.15);
                }

                .recipient-item input {
                    margin-right: var(--space-2);
                }

                @media (max-width: 1200px) {
                    .inbox-container {
                        grid-template-columns: 200px 1fr;
                    }
                    .inbox-detail {
                        position: fixed;
                        top: var(--header-height);
                        right: 0;
                        bottom: 0;
                        width: 400px;
                        background: var(--surface-card);
                        z-index: 100;
                        box-shadow: var(--shadow-xl);
                    }
                }

                @media (max-width: 768px) {
                    .inbox-container {
                        grid-template-columns: 1fr;
                    }
                    .inbox-sidebar {
                        display: none;
                    }
                }
            `}</style>
        </>
    );
}
