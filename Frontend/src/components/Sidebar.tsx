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
    FiUser,
    FiAlertTriangle,
    FiClipboard,
    FiMail,
    FiBell,
    FiX,
    FiMoon,
    FiSun
} from 'react-icons/fi';
import { surveysApi, workersApi, inboxApi, type InboxMessage } from '../api/client';
import { useAuth } from '../context/AuthContext';

interface SidebarProps {
    isOpen?: boolean;
    onClose?: () => void;
}

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

// Role-based navigation configuration
const getNavItemsByRole = (role: string): NavSection[] => {
    switch (role) {
        case 'trabajador':
            return [
                {
                    section: 'Mi Panel',
                    items: [
                        { path: '/', icon: FiHome, label: 'Dashboard' },
                        { path: '/inbox', icon: FiBell, label: 'Notificaciones' },
                        { path: '/my-signatures', icon: FiCheckSquare, label: 'Mis Certificados' },
                    ]
                },
                {
                    section: 'Mis Asignaciones',
                    items: [
                        { path: '/surveys', icon: FiClipboard, label: 'Encuestas' },
                        { path: '/activities', icon: FiCalendar, label: 'Capacitaciones' },
                        { path: '/documents', icon: FiFileText, label: 'Documentos' },
                    ]
                },
                {
                    section: 'Acciones',
                    items: [
                        { path: '/incidents', icon: FiAlertTriangle, label: 'Reportar Incidente' },
                        { path: '/settings', icon: FiSettings, label: 'Configuración' },
                    ]
                }
            ];

        case 'prevencionista':
            return [
                {
                    section: 'Panel',
                    items: [
                        { path: '/', icon: FiHome, label: 'Dashboard' },
                        { path: '/inbox', icon: FiBell, label: 'Notificaciones' },
                    ]
                },
                {
                    section: 'Cumplimiento',
                    items: [
                        { path: '/signature-requests', icon: FiEdit3, label: 'Solicitudes de Firma' },
                        { path: '/my-signatures', icon: FiCheckSquare, label: 'Mis Certificados' },
                        { path: '/surveys', icon: FiClipboard, label: 'Auditorías y Encuestas' },
                        { path: '/documents', icon: FiFileText, label: 'Documentos' },
                    ]
                },
                {
                    section: 'Gestión',
                    items: [
                        { path: '/workers', icon: FiUsers, label: 'Trabajadores' },
                        { path: '/activities', icon: FiCalendar, label: 'Actividades' },
                        { path: '/incidents', icon: FiAlertTriangle, label: 'Incidentes' },
                        { path: '/ai-assistant', icon: FiMessageSquare, label: 'Asistente IA' },
                    ]
                }
            ];

        case 'admin':
            return [
                {
                    section: 'Panel',
                    items: [
                        { path: '/', icon: FiHome, label: 'Dashboard' },
                        { path: '/inbox', icon: FiBell, label: 'Notificaciones' },
                    ]
                },
                {
                    section: 'Administración',
                    items: [
                        { path: '/users', icon: FiUser, label: 'Usuarios' },
                        { path: '/workers', icon: FiUsers, label: 'Trabajadores' },
                    ]
                },
                {
                    section: 'Sistema',
                    items: [
                        { path: '/ai-assistant', icon: FiMessageSquare, label: 'Asistente IA' },
                        { path: '/settings', icon: FiSettings, label: 'Configuración' },
                    ]
                }
            ];

        default:
            // Fallback para roles desconocidos
            return [
                {
                    section: 'Principal',
                    items: [
                        { path: '/', icon: FiHome, label: 'Dashboard' },
                        { path: '/settings', icon: FiSettings, label: 'Configuración' },
                    ]
                }
            ];
    }
};

export default function Sidebar({ isOpen = false, onClose }: SidebarProps = {}) {
    const location = useLocation();
    const { user, hasPermission } = useAuth();
    const [theme, setTheme] = useState<'dark' | 'light'>(() => {
        if (typeof window !== 'undefined') {
            return window.localStorage.getItem('theme') === 'light' ? 'light' : 'dark';
        }
        return 'dark';
    });
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
                // Silently fail to avoid console spam during auto-refresh
                // console.error('Error loading inbox data:', error);
            }
        };

        // loadInboxData();
        // const intervalId = window.setInterval(loadInboxData, 10000); // Temporary disable to clear console errors

        return () => {
            cancelled = true;
            // window.clearInterval(intervalId);
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
        const intervalId = window.setInterval(loadPendingSurveys, 15000); // Refresh every 15 seconds

        // Listen for survey response events to refresh immediately
        const handleSurveyResponded = () => {
            loadPendingSurveys();
        };
        window.addEventListener('surveyResponded', handleSurveyResponded);

        return () => {
            cancelled = true;
            window.clearInterval(intervalId);
            window.removeEventListener('surveyResponded', handleSurveyResponded);
        };
    }, [workerId, canRespondSurveys]);

    useEffect(() => {
        if (typeof document === 'undefined') return;
        const root = document.documentElement;
        root.classList.toggle('theme-light', theme === 'light');
        localStorage.setItem('theme', theme);
    }, [theme]);

    const toggleTheme = () => {
        setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));
    };

    const handleLinkClick = () => {
        if (onClose) {
            onClose();
        }
    };

    return (
        <>
            {/* Overlay for mobile */}
            {isOpen && onClose && (
                <div
                    className={`sidebar-overlay ${isOpen ? 'active' : ''}`}
                    onClick={onClose}
                />
            )}

            <aside className={`sidebar ${isOpen ? 'mobile-open' : ''}`}>
                {/* Mobile close button */}
                {onClose && (
                    <button
                        className="sidebar-mobile-close"
                        onClick={onClose}
                        aria-label="Cerrar menú"
                    >
                        <FiX />
                    </button>
                )}

                <div className="sidebar-header">
                    <div className="sidebar-logo">
                        <div className="sidebar-logo-text" aria-label="Build and Serve">
                            <span className="sidebar-logo-primary">Build</span>
                            <span className="sidebar-logo-amp">&</span>
                            <span className="sidebar-logo-secondary">Serve</span>
                        </div>
                    </div>
                </div>

                <nav className="sidebar-nav">
                    {getNavItemsByRole(user?.rol || '').map((section: NavSection) => {
                        // Permissions are already filtered by role, but keep this for double-checking
                        const visibleItems = section.items.filter((item: NavItem) =>
                            !item.permission || hasPermission(item.permission)
                        );

                        if (visibleItems.length === 0) return null;

                        return (
                            <div key={section.section} className="nav-section">
                                <div className="nav-section-title">{section.section}</div>
                                {visibleItems.map((item: NavItem) => {
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
                                            onClick={handleLinkClick}
                                        >
                                            <span className="nav-item-icon">
                                                <Icon />
                                            </span>
                                            <span>{item.label}</span>
                                            {showSurveyBadge && (
                                                <span className="nav-item-badge survey-badge">
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

                <div className="sidebar-theme-toggle">
                    <button className="btn btn-ghost" onClick={toggleTheme}>
                        {theme === 'dark' ? (
                            <>
                                <FiSun />
                                Modo claro
                            </>
                        ) : (
                            <>
                                <FiMoon />
                                Modo oscuro
                            </>
                        )}
                    </button>
                </div>

                <style>{`
                /* Attention badge styles */
                .inbox-badge,
                .survey-badge {
                    background: var(--danger-500) !important;
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

                .sidebar-theme-toggle {
                    margin: var(--space-4);
                }
                .sidebar-theme-toggle .btn {
                    width: 100%;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    gap: var(--space-2);
                }
            `}</style>
            </aside>
        </>
    );
}
