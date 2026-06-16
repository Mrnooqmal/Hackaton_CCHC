import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
    FiHome,
    FiUsers,
    FiFileText,
    FiCalendar,
    FiEdit3,
    FiMessageSquare,
    FiSettings,
    FiAlertTriangle,
    FiClipboard,
    FiMail,
    FiBell,
    FiX,
    FiLogOut
} from 'react-icons/fi';
import { surveysApi, workersApi, type InboxMessage } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { PERMISSIONS } from '../permissions';

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

// Cada ítem declara el permiso de vista que lo habilita; el render filtra
// por hasPermission y oculta secciones vacías. Los módulos sin permiso
// (Inicio, Firma, Incidentes, Encuestas, Configuración) son siempre visibles;
// sus subacciones se gatean dentro de la página.
// El admin tiene bypass total en hasPermission, por lo que ve todos los ítems.
const GENERIC_NAV: NavSection[] = [
    {
        section: 'Principal',
        items: [
            { path: '/', icon: FiHome, label: 'Inicio' },
        ]
    },
    {
        section: 'Gestión',
        items: [
            { path: '/obras', icon: FiHome, label: 'Obras', permission: PERMISSIONS.OBRAS_VER },
            { path: '/personas', icon: FiUsers, label: 'Personas', permission: PERMISSIONS.PERSONAS_VER },
            { path: '/documents-repository', icon: FiFileText, label: 'Archivos', permission: PERMISSIONS.REPOSITORIO_VER },
            { path: '/documents', icon: FiFileText, label: 'Documentos', permission: PERMISSIONS.DOCUMENTOS_VER },
            { path: '/activities', icon: FiCalendar, label: 'Actividades', permission: PERMISSIONS.ACTIVIDADES_VER },
        ]
    },
    {
        section: 'Cumplimiento',
        items: [
            { path: '/signature-requests', icon: FiEdit3, label: 'Firma Electrónica' },
            { path: '/incidents', icon: FiAlertTriangle, label: 'Incidentes' },
            { path: '/surveys', icon: FiClipboard, label: 'Encuestas' },
        ]
    },
    {
        section: 'Sistema',
        items: [
            { path: '/ai-assistant', icon: FiMessageSquare, label: 'Asistente IA', permission: PERMISSIONS.IA_VER },
            { path: '/settings', icon: FiSettings, label: 'Configuración' },
        ]
    }
];

export default function Sidebar({ isOpen = false, onClose }: SidebarProps = {}) {
    const location = useLocation();
    const navigate = useNavigate();
    const { user, hasPermission, logout } = useAuth();
    const [pendingSurveyCount, setPendingSurveyCount] = useState(0);
    const sidebarRef = useRef<HTMLElement>(null);
    const [workerId, setWorkerId] = useState<string | null>(null);
    const canRespondSurveys = user?.rol === 'trabajador' || user?.rol === 'prevencionista';
    const pendingBadgeLabel = pendingSurveyCount > 99 ? '99+' : String(pendingSurveyCount);

    // Inbox notifications state
    const [unreadInboxCount] = useState(0);
    const [recentMessages] = useState<InboxMessage[]>([]);
    const [showNotificationPopup, setShowNotificationPopup] = useState(false);
    const inboxBadgeLabel = unreadInboxCount > 99 ? '99+' : String(unreadInboxCount);

    // Load inbox unread count
    useEffect(() => {
        if (!user?.userId) return;

        // Inbox auto-refresh está deshabilitado por ahora
        return () => { };
    }, [user?.userId]);

    useEffect(() => {
        if (!canRespondSurveys) {
            setWorkerId(null);
            return;
        }

        if (user?.personaId) {
            setWorkerId(user.personaId);
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
    }, [canRespondSurveys, user?.personaId, user?.rut]);

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


    // Recorta el sidebar para que no tape el footer en desktop
    useEffect(() => {
        const update = () => {
            if (!sidebarRef.current || window.innerWidth <= 1024) {
                if (sidebarRef.current) sidebarRef.current.style.bottom = '';
                return;
            }
            const footer = document.querySelector('.ft-root') as HTMLElement | null;
            if (!footer) return;
            const overflow = window.innerHeight - footer.getBoundingClientRect().top;
            sidebarRef.current.style.bottom = overflow > 0 ? `${overflow}px` : '0';
        };

        window.addEventListener('scroll', update, { passive: true });
        window.addEventListener('resize', update, { passive: true });
        update();
        return () => {
            window.removeEventListener('scroll', update);
            window.removeEventListener('resize', update);
        };
    }, []);

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

            <aside ref={sidebarRef} className={`sidebar ${isOpen ? 'mobile-open' : ''}`}>
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

                <nav className="sidebar-nav">
                    {GENERIC_NAV.map((section: NavSection) => {
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

                {user && (() => {
                    const initials = [user.nombre, user.apellido]
                        .filter(Boolean)
                        .map((s) => s[0].toUpperCase())
                        .join('');
                    const roleLabels: Record<string, string> = {
                        admin: 'Administrador',
                        jefe_obra: 'Jefe de Obra',
                        supervisor: 'Supervisor',
                        prevencionista: 'Prevencionista',
                        trabajador: 'Trabajador',
                    };
                    const roleLabel = roleLabels[user.rol] ?? user.rol;
                    return (
                        <div className="sidebar-footer">
                            <div className="sidebar-user">
                                <button
                                    className="sidebar-user-profile-btn"
                                    onClick={() => navigate('/settings')}
                                    title="Ir a configuración"
                                >
                                    <div className="sidebar-user-avatar">
                                        {user.fotoPerfil
                                            ? <img src={user.fotoPerfil} alt={initials} style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }} />
                                            : initials}
                                    </div>
                                    <div className="sidebar-user-meta">
                                        <span className="sidebar-user-name">
                                            {user.nombre} {user.apellido}
                                        </span>
                                        <span className="sidebar-user-role">{roleLabel}</span>
                                    </div>
                                </button>
                                <button
                                    className="sidebar-user-logout"
                                    onClick={logout}
                                    title="Cerrar sesión"
                                    aria-label="Cerrar sesión"
                                >
                                    <FiLogOut />
                                </button>
                            </div>
                        </div>
                    );
                })()}

                <style>{`
                .sidebar-user-profile-btn {
                    display: flex;
                    align-items: center;
                    gap: 10px;
                    flex: 1;
                    min-width: 0;
                    background: none;
                    border: none;
                    padding: 0;
                    cursor: pointer;
                    border-radius: var(--radius-md);
                    transition: opacity 0.15s;
                    text-align: left;
                }
                .sidebar-user-profile-btn:hover {
                    opacity: 0.8;
                }
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
