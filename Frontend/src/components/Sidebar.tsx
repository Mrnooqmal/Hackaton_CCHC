import { Link, useLocation } from 'react-router-dom';
import {
    FiHome,
    FiUsers,
    FiFileText,
    FiCalendar,
    FiAlertTriangle,
    FiMessageSquare,
    FiSettings,
    FiShield
} from 'react-icons/fi';

const navItems = [
    {
        section: 'Principal',
        items: [
            { path: '/', icon: FiHome, label: 'Dashboard' },
            { path: '/workers', icon: FiUsers, label: 'Trabajadores' },
            { path: '/workers/enroll', icon: FiShield, label: 'Enrolamiento' },
        ]
    },
    {
        section: 'Gestión',
        items: [
            { path: '/documents', icon: FiFileText, label: 'Documentos' },
            { path: '/activities', icon: FiCalendar, label: 'Actividades' },
            { path: '/incidents', icon: FiAlertTriangle, label: 'Incidentes', badge: 2 },
        ]
    },
    {
        section: 'Herramientas',
        items: [
            { path: '/ai-assistant', icon: FiMessageSquare, label: 'Asistente IA' },
            { path: '/settings', icon: FiSettings, label: 'Configuración' },
        ]
    }
];

export default function Sidebar() {
    const location = useLocation();

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
                {navItems.map((section) => (
                    <div key={section.section} className="nav-section">
                        <div className="nav-section-title">{section.section}</div>
                        {section.items.map((item) => {
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
                ))}
            </nav>
        </aside>
    );
}
