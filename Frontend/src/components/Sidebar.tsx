import { Link, useLocation } from 'react-router-dom';
import {
    FiHome,
    FiUsers,
    FiFileText,
    FiCalendar,
    FiAlertTriangle,
    FiMessageSquare,
    FiSettings,
    FiShield,
    FiLogOut,
    FiUser,
    FiClipboard
} from 'react-icons/fi';
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
            { path: '/workers', icon: FiUsers, label: 'Trabajadores', permission: 'ver_trabajadores' },
            { path: '/workers/enroll', icon: FiShield, label: 'Enrolamiento', permission: 'ver_trabajadores' },
        ]
    },
    {
        section: 'Gestión',
        items: [
            { path: '/documents', icon: FiFileText, label: 'Documentos' },
            { path: '/activities', icon: FiCalendar, label: 'Actividades' },
            { path: '/surveys', icon: FiClipboard, label: 'Encuestas' },
            { path: '/incidents', icon: FiAlertTriangle, label: 'Incidentes', badge: 2 },
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

    const handleLogout = () => {
        if (confirm('¿Cerrar sesión?')) {
            logout();
        }
    };

    return (
        <aside className="sidebar">
            <div className="sidebar-header">
                <div className="sidebar-logo">
                    <div className="sidebar-logo-icon">🛡️</div>
                    <div>
                        <div className="sidebar-logo-text">PrevencionApp</div>
                        <div className="sidebar-logo-subtitle">Sistema DS 44</div>
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
                                        {item.badge && (
                                            <span className="nav-item-badge">{item.badge}</span>
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
                                {user.rol === 'admin' && '👑'}
                                {user.rol === 'prevencionista' && '🛡️'}
                                {user.rol === 'trabajador' && '👷'}
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
            `}</style>
        </aside>
    );
}
