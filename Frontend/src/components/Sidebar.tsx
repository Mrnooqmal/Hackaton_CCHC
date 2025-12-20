import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
    FiHome,
    FiUsers,
    FiFileText,
    FiCalendar,
    FiEdit3,
    FiCheckSquare,
    FiMessageSquare,
    FiSettings,
    FiShield,
    FiLogOut,
    FiUser,
    FiAlertTriangle,
    FiClipboard,
    FiMail,
    FiBell,
    FiX
} from 'react-icons/fi';
import { surveysApi, workersApi, inboxApi, type InboxMessage } from '../api/client';
import { useAuth } from '../context/AuthContext';

interface NavItem {
    path: string;
    icon: any;
    label: string;
    permission?: string;
    badge?: number;
}

interface NavSection {
    section: string;
    items: NavItem[];
}

const navItems: NavSection[] = [
    {
        section: 'Principal',
        items: [
            { path: '/', icon: FiHome, label: 'Dashboard' },
            { path: '/inbox', icon: FiMail, label: 'Bandeja de Entrada' },
            { path: '/workers', icon: FiUsers, label: 'Trabajadores', permission: 'ver_trabajadores' },
            { path: '/workers/enroll', icon: FiShield, label: 'Enrolamiento', permission: 'ver_trabajadores' },
        ]
    },
    {
        section: 'Firmas',
        items: [
            { path: '/signature-requests', icon: FiEdit3, label: 'Solicitar Firmas', permission: 'crear_actividades' },
            { path: '/my-signatures', icon: FiCheckSquare, label: 'Mis Firmas' },
        ]
    },
    {
        section: 'Gestión',
        items: [
            { path: '/documents', icon: FiFileText, label: 'Documentos' },
            { path: '/activities', icon: FiCalendar, label: 'Actividades' },
            { path: '/surveys', icon: FiClipboard, label: 'Encuestas' },
            { path: '/incidents', icon: FiAlertTriangle, label: 'Incidentes' },
        ]
    },
    {
        section: 'Herramientas',
        items: [
            { path: '/users', icon: FiUser, label: 'Usuarios', permission: 'crear_usuarios' },
            { path: '/ai-assistant', icon: FiMessageSquare, label: 'Asistente IA' },
            { path: '/settings', icon: FiSettings, label: 'Configuración' },
        ]
    }
];

export default function Sidebar() {
    const location = useLocation();
    const { user, logout, hasPermission } = useAuth();
    const [pendingSurveyCount, setPendingSurveyCount] = useState(0);
    const [workerId, setWorkerId] = useState<string | null>(null);
    const canRespondSurveys = user?.rol === 'trabajador' || user?.rol === 'prevencionista';
    const pendingBadgeLabel = pendingSurveyCount > 99 ? '99+' : String(pendingSurveyCount);

    // Inbox notifications state
    const [unreadInboxCount, setUnreadInboxCount] = useState(0);
    const [recentMessages, setRecentMessages] = useState<InboxMessage[]>([]);
    const [showNotificationPopup, setShowNotificationPopup] = useState(false);
    const inboxBadgeLabel = unreadInboxCount > 99 ? '99+' : String(unreadInboxCount);

    // Load inbox unread count
    useEffect(() => {
        if (!user?.userId) return;

        let cancelled = false;

        const loadInboxData = async () => {
            try {
                // Get unread count
                const countResponse = await inboxApi.getUnreadCount(user.userId);
                if (!cancelled && countResponse.success && countResponse.data) {
                    setUnreadInboxCount(countResponse.data.unreadCount);
                }

                // Get recent messages for popup
                const inboxResponse = await inboxApi.getInbox(user.userId, 'unread', 5);
                if (!cancelled && inboxResponse.success && inboxResponse.data) {
                    setRecentMessages(inboxResponse.data.messages);
                }
            } catch (error) {
                console.error('Error loading inbox data:', error);
            }
        };

        loadInboxData();
        const intervalId = window.setInterval(loadInboxData, 30000); // Refresh every 30 seconds

        return () => {
            cancelled = true;
            window.clearInterval(intervalId);
        };
    }, [user?.userId]);

    useEffect(() => {
        if (!canRespondSurveys) {
            setWorkerId(null);
            return;
        }

        if (user?.workerId) {
            setWorkerId(user.workerId);
            return;
        }

        const rut = user?.rut;
        if (!rut) {
            setWorkerId(null);
            return;
        }

        let cancelled = false;

        const resolveWorkerId = async () => {
            try {
                const response = await workersApi.getByRut(rut);
                if (!cancelled) {
                    if (response.success && response.data) {
                        setWorkerId(response.data.workerId);
                    } else {
                        setWorkerId(null);
                    }
                }
            } catch (error) {
                if (!cancelled) {
                    setWorkerId(null);
                }
            }
        };

        resolveWorkerId();

        return () => {
            cancelled = true;
        };
    }, [canRespondSurveys, user?.workerId, user?.rut]);

    useEffect(() => {
        if (!canRespondSurveys || !workerId) {
            setPendingSurveyCount(0);
            return;
        }

        let cancelled = false;

        const loadPendingSurveys = async () => {
            try {
                const response = await surveysApi.list();
                if (!cancelled) {
                    if (response.success && response.data?.surveys) {
                        const pending = response.data.surveys.reduce((total, survey) => {
                            const recipient = survey.recipients?.find((r) => r.workerId === workerId);
                            if (recipient && recipient.estado !== 'respondida') {
                                return total + 1;
                            }
                            return total;
                        }, 0);
                        setPendingSurveyCount(pending);
                    } else {
                        setPendingSurveyCount(0);
                    }
                }
            } catch (error) {
                if (!cancelled) {
                    setPendingSurveyCount(0);
                }
            }
        };

        loadPendingSurveys();
        const intervalId = window.setInterval(loadPendingSurveys, 60000);

        return () => {
            cancelled = true;
            window.clearInterval(intervalId);
        };
    }, [workerId, canRespondSurveys]);

    const handleLogout = () => {
        if (confirm('¿Cerrar sesión?')) {
            logout();
        }
    };

    return (
        <aside className="sidebar">
            <div className="sidebar-header">
                <div className="sidebar-logo">
                    <div className="sidebar-logo-icon">🌳</div>
                    <div>
                        <div className="sidebar-logo-text">Yggdrasil</div>
                    </div>
                </div>
            </div>

            <nav className="sidebar-nav">
                {navItems.map((section) => {
                    // Filtrar items según permisos
                    const visibleItems = section.items.filter(item =>
                        !item.permission || hasPermission(item.permission)
                    );

                    if (visibleItems.length === 0) return null;

                    return (
                        <div key={section.section} className="nav-section">
                            <div className="nav-section-title">{section.section}</div>
                            {visibleItems.map((item) => {
                                const Icon = item.icon;
                                const isActive = location.pathname === item.path;
                                const showSurveyBadge = item.path === '/surveys' && canRespondSurveys && pendingSurveyCount > 0;
                                const showInboxBadge = item.path === '/inbox' && unreadInboxCount > 0;
                                const showStaticBadge = !showSurveyBadge && !showInboxBadge && typeof item.badge === 'number' && item.badge > 0;

                                return (
                                    <Link
                                        key={item.path}
                                        to={item.path}
                                        className={`nav-item ${isActive ? 'active' : ''}`}
                                    >
                                        <span className="nav-item-icon">
                                            <Icon />
                                        </span>
                                        <span>{item.label}</span>
                                        {showSurveyBadge && (
                                            <span className="nav-item-badge">
                                                {pendingBadgeLabel}
                                            </span>
                                        )}
                                        {showInboxBadge && (
                                            <span className="nav-item-badge inbox-badge">
                                                {inboxBadgeLabel}
                                            </span>
                                        )}
                                        {showStaticBadge && (
                                            <span className="nav-item-badge">
                                                {item.badge}
                                            </span>
                                        )}
                                    </Link>
                                );
                            })}
                        </div>
                    );
                })}
            </nav>

            {user && (
                <div className="sidebar-footer">
                    <div className="user-info">
                        <div className="avatar avatar-sm bg-primary-500">
                            {user.nombre[0]}{user.apellido?.[0] || ''}
                        </div>
                        <div className="user-details overflow-hidden">
                            <div className="user-name truncate">{user.nombre} {user.apellido}</div>
                            <div className={`user-role-badge role-${user.rol}`}>
                                {user.rol === 'admin'}
                                {user.rol === 'prevencionista'}
                                {user.rol === 'trabajador'}
                                {' '}{user.rol === 'admin' ? 'Administrador' : user.rol === 'prevencionista' ? 'Prevencionista' : 'Trabajador'}
                            </div>
                        </div>
                        <button
                            className="logout-btn"
                            onClick={handleLogout}
                            title="Cerrar sesión"
                        >
                            <FiLogOut />
                        </button>
                    </div>
                </div>
            )}

            {/* Notification Popup - Bottom Right */}
            {showNotificationPopup && recentMessages.length > 0 && (
                <div className="notification-popup">
                    <div className="notification-popup-header">
                        <span><FiBell /> Notificaciones</span>
                        <button onClick={() => setShowNotificationPopup(false)}><FiX /></button>
                    </div>
                    <div className="notification-popup-list">
                        {recentMessages.slice(0, 5).map((msg) => (
                            <Link
                                key={msg.messageId}
                                to="/inbox"
                                className="notification-popup-item"
                                onClick={() => setShowNotificationPopup(false)}
                            >
                                <div className="notification-popup-icon">
                                    <FiMail />
                                </div>
                                <div className="notification-popup-content">
                                    <div className="notification-popup-title">{msg.subject || 'Sin asunto'}</div>
                                    <div className="notification-popup-meta">{msg.senderName || 'Sistema'}</div>
                                </div>
                            </Link>
                        ))}
                    </div>
                    <Link to="/inbox" className="notification-popup-footer" onClick={() => setShowNotificationPopup(false)}>
                        Ver todos los mensajes
                    </Link>
                </div>
            )}

            {/* Floating notification bell for large screens */}
            {unreadInboxCount > 0 && !showNotificationPopup && (
                <button
                    className="notification-fab"
                    onClick={() => setShowNotificationPopup(true)}
                    title={`${unreadInboxCount} mensaje(s) sin leer`}
                >
                    <FiBell />
                    <span className="notification-fab-badge">{inboxBadgeLabel}</span>
                </button>
            )}

            <style>{`
                .sidebar-footer {
                    padding: var(--space-4);
                    border-top: 1px solid var(--surface-border);
                    margin-top: auto;
                }
                .user-info {
                    display: flex;
                    align-items: center;
                    gap: var(--space-3);
                    padding: var(--space-3);
                    background: var(--surface-elevated);
                    border-radius: var(--radius-lg);
                }
                .user-details {
                    flex: 1;
                }
                .user-name {
                    font-size: var(--text-sm);
                    font-weight: 600;
                    color: var(--text-primary);
                    margin-bottom: 4px;
                }
                .user-role-badge {
                    display: inline-flex;
                    align-items: center;
                    gap: 4px;
                    font-size: 11px;
                    font-weight: 600;
                    padding: 2px 8px;
                    border-radius: 12px;
                    text-transform: capitalize;
                }
                .role-admin {
                    background: linear-gradient(135deg, var(--warning-500), var(--warning-600));
                    color: white;
                }
                .role-prevencionista {
                    background: linear-gradient(135deg, var(--primary-500), var(--primary-600));
                    color: white;
                }
                .role-trabajador {
                    background: linear-gradient(135deg, var(--info-500), var(--info-600));
                    color: white;
                }
                .logout-btn {
                    background: none;
                    border: none;
                    color: var(--text-muted);
                    cursor: pointer;
                    padding: var(--space-2);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    transition: color 0.2s;
                }
                .logout-btn:hover {
                    color: var(--danger-500);
                }

                /* Inbox badge styles */
                .inbox-badge {
                    background: var(--primary-500) !important;
                    animation: pulse-badge 2s infinite;
                }
                @keyframes pulse-badge {
                    0%, 100% { transform: scale(1); }
                    50% { transform: scale(1.1); }
                }

                /* Notification FAB (Floating Action Button) */
                .notification-fab {
                    position: fixed;
                    bottom: var(--space-6);
                    right: var(--space-6);
                    width: 56px;
                    height: 56px;
                    border-radius: 50%;
                    background: linear-gradient(135deg, var(--primary-500), var(--primary-600));
                    color: white;
                    border: none;
                    cursor: pointer;
                    box-shadow: var(--shadow-lg);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    font-size: 24px;
                    transition: transform 0.2s, box-shadow 0.2s;
                    z-index: 1000;
                }
                .notification-fab:hover {
                    transform: scale(1.1);
                    box-shadow: var(--shadow-xl);
                }
                .notification-fab-badge {
                    position: absolute;
                    top: -4px;
                    right: -4px;
                    background: var(--danger-500);
                    color: white;
                    font-size: 11px;
                    font-weight: 700;
                    padding: 2px 6px;
                    border-radius: 10px;
                    min-width: 20px;
                    text-align: center;
                }

                /* Notification Popup */
                .notification-popup {
                    position: fixed;
                    bottom: calc(var(--space-6) + 70px);
                    right: var(--space-6);
                    width: 360px;
                    max-height: 400px;
                    background: var(--surface-card);
                    border-radius: var(--radius-xl);
                    box-shadow: var(--shadow-2xl);
                    border: 1px solid var(--surface-border);
                    z-index: 1001;
                    overflow: hidden;
                    animation: slideUp 0.3s ease;
                }
                @keyframes slideUp {
                    from { opacity: 0; transform: translateY(20px); }
                    to { opacity: 1; transform: translateY(0); }
                }
                .notification-popup-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    padding: var(--space-4);
                    border-bottom: 1px solid var(--surface-border);
                    font-weight: 600;
                }
                .notification-popup-header span {
                    display: flex;
                    align-items: center;
                    gap: var(--space-2);
                }
                .notification-popup-header button {
                    background: none;
                    border: none;
                    color: var(--text-muted);
                    cursor: pointer;
                    padding: var(--space-1);
                    display: flex;
                }
                .notification-popup-header button:hover {
                    color: var(--text-primary);
                }
                .notification-popup-list {
                    max-height: 280px;
                    overflow-y: auto;
                }
                .notification-popup-item {
                    display: flex;
                    align-items: flex-start;
                    gap: var(--space-3);
                    padding: var(--space-3) var(--space-4);
                    text-decoration: none;
                    color: inherit;
                    transition: background 0.2s;
                }
                .notification-popup-item:hover {
                    background: var(--surface-hover);
                }
                .notification-popup-icon {
                    width: 36px;
                    height: 36px;
                    border-radius: 50%;
                    background: var(--primary-100);
                    color: var(--primary-600);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    flex-shrink: 0;
                }
                .notification-popup-content {
                    flex: 1;
                    min-width: 0;
                }
                .notification-popup-title {
                    font-size: var(--text-sm);
                    font-weight: 500;
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                }
                .notification-popup-meta {
                    font-size: var(--text-xs);
                    color: var(--text-muted);
                }
                .notification-popup-footer {
                    display: block;
                    text-align: center;
                    padding: var(--space-3);
                    border-top: 1px solid var(--surface-border);
                    color: var(--primary-500);
                    text-decoration: none;
                    font-weight: 500;
                    font-size: var(--text-sm);
                }
                .notification-popup-footer:hover {
                    background: var(--surface-hover);
                }

                /* Hide FAB on small screens */
                @media (max-width: 1024px) {
                    .notification-fab,
                    .notification-popup {
                        display: none;
                    }
                }
            `}</style>
        </aside>
    );
}
