import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import ConfirmModal from './ConfirmModal';
import {
    FiHome,
    FiUsers,
    FiFileText,
    FiCalendar,
    FiEdit3,
    FiSettings,
    FiBriefcase,
    FiAlertTriangle,
    FiCheckSquare,
    FiX,
    FiLogOut,
    FiList,
    FiClipboard,
    FiShield,
    FiMapPin,
    FiRepeat
} from 'react-icons/fi';
import { surveysApi, workersApi } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useObraContext } from '../context/ObraContext';
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

// El menú depende del ámbito con el que se entró: administrar la empresa y
// operar una obra son dos trabajos distintos, y mezclar ambos menús fue lo que
// hizo confuso el diseño anterior.
//
// Cada ítem declara el permiso de vista que lo habilita; el render filtra por
// hasPermission y oculta secciones vacías. Los módulos sin permiso (Inicio,
// Firmas, Incidentes, Encuestas, Configuración) son siempre visibles; sus
// subacciones se gatean dentro de la página. El admin tiene bypass total en
// hasPermission, por lo que ve todos los ítems.

/** Vista de empresa: solo administración, ninguna operación de obra. */
const NAV_EMPRESA: NavSection[] = [
    {
        section: 'Principal',
        items: [
            { path: '/', icon: FiHome, label: 'Inicio' },
        ]
    },
    {
        section: 'Gestión',
        items: [
            { path: '/obras', icon: FiMapPin, label: 'Obras', permission: PERMISSIONS.OBRAS_VER },
            // El alta de personas es un acto de empresa: aquí está el plantel
            // completo. Dentro de una obra el mismo módulo muestra solo su equipo
            // y solo deja sumar gente que ya existe a este nivel.
            { path: '/personas', icon: FiUsers, label: 'Personas', permission: PERMISSIONS.PERSONAS_VER },
        ]
    },
    {
        section: 'Sistema',
        items: [
            { path: '/mi-empresa', icon: FiBriefcase, label: 'Mi Empresa', permission: PERMISSIONS.EMPRESA_VER },
            { path: '/cargos-onboarding', icon: FiCheckSquare, label: 'Onboarding', permission: PERMISSIONS.CARGOS_GESTIONAR },
            { path: '/catalogos-actividad', icon: FiList, label: 'Catálogos', permission: PERMISSIONS.CARGOS_GESTIONAR },
        ]
    }
];

/**
 * Dentro de una obra: su operación diaria. Los módulos de empresa (Mi Empresa,
 * Onboarding, Catálogos) viven en la otra vista. `obraId` puede faltar cuando
 * alguien sin obras asignadas entra igual a la plataforma; ahí el primer ítem
 * cae al listado y el permiso lo oculta si no corresponde.
 */
const navObra = (obraId: string | null): NavSection[] => [
    {
        section: 'Principal',
        items: [
            { path: '/', icon: FiHome, label: 'Inicio' },
        ]
    },
    {
        section: 'Gestión',
        items: [
            obraId
                ? { path: `/obras/${obraId}`, icon: FiMapPin, label: 'Detalle de obra', permission: PERMISSIONS.OBRAS_DETALLE }
                : { path: '/obras', icon: FiMapPin, label: 'Obras', permission: PERMISSIONS.OBRAS_VER },
            { path: '/personas', icon: FiUsers, label: 'Personas', permission: PERMISSIONS.PERSONAS_VER },
            { path: '/documents-repository', icon: FiFileText, label: 'Repositorio', permission: PERMISSIONS.REPOSITORIO_VER },
            { path: '/activities', icon: FiCalendar, label: 'Actividades', permission: PERMISSIONS.ACTIVIDADES_VER },
            { path: '/surveys', icon: FiClipboard, label: 'Encuestas' },
        ]
    },
    {
        section: 'Cumplimiento',
        items: [
            { path: '/my-signatures', icon: FiEdit3, label: 'Mis firmas' },
            { path: '/incidents', icon: FiAlertTriangle, label: 'Incidentes' },
            { path: '/prescripciones', icon: FiShield, label: 'Prescripciones', permission: PERMISSIONS.REPOSITORIO_VER },
        ]
    },
    {
        section: 'Sistema',
        items: [
            { path: '/settings', icon: FiSettings, label: 'Configuración' },
        ]
    }
];

export default function Sidebar({ isOpen = false, onClose }: SidebarProps = {}) {
    const location = useLocation();
    const navigate = useNavigate();
    const { user, hasPermission, logout } = useAuth();
    const { selectedObraId, modoEmpresa, puedeGestionarEmpresa, puedeCambiarDeObra, cambiarDeObra } = useObraContext();
    const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
    const [sessionMenuOpen, setSessionMenuOpen] = useState(false);
    const [pendingSurveyCount, setPendingSurveyCount] = useState(0);
    const [workerId, setWorkerId] = useState<string | null>(null);
    const sessionMenuRef = useRef<HTMLDivElement | null>(null);
    const canRespondSurveys = user?.rol === 'trabajador' || user?.rol === 'prevencionista';
    const pendingBadgeLabel = pendingSurveyCount > 99 ? '99+' : String(pendingSurveyCount);

    // Las notificaciones viven en el Header (campana con badge), no en el sidebar.

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


    // Solo quien entró a administrar la empresa ve el menú de empresa: alguien
    // sin obras asignadas también queda sin obra activa, y ahí lo que necesita
    // es su operación (firmas, encuestas), no la administración.
    const navSections = useMemo(
        () => (modoEmpresa && puedeGestionarEmpresa ? NAV_EMPRESA : navObra(selectedObraId)),
        [modoEmpresa, puedeGestionarEmpresa, selectedObraId]
    );

    // El menú de sesión se cierra al pinchar fuera o con Escape.
    useEffect(() => {
        if (!sessionMenuOpen) return;
        const handleClickOutside = (event: MouseEvent) => {
            if (sessionMenuRef.current && !sessionMenuRef.current.contains(event.target as Node)) {
                setSessionMenuOpen(false);
            }
        };
        const handleEscape = (event: KeyboardEvent) => {
            if (event.key === 'Escape') setSessionMenuOpen(false);
        };
        document.addEventListener('mousedown', handleClickOutside);
        document.addEventListener('keydown', handleEscape);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
            document.removeEventListener('keydown', handleEscape);
        };
    }, [sessionMenuOpen]);

    const handleLinkClick = () => {
        if (onClose) {
            onClose();
        }
    };

    // Cambiar de obra devuelve al paso de selección posterior al login.
    const handleCambiarDeObra = () => {
        setSessionMenuOpen(false);
        if (onClose) onClose();
        cambiarDeObra();
        navigate('/seleccionar-obra');
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

            <ConfirmModal
                isOpen={showLogoutConfirm}
                title="Cerrar sesión"
                message="¿Estás seguro de que deseas cerrar sesión?"
                confirmLabel="Cerrar sesión"
                cancelLabel="Cancelar"
                variant="danger"
                onConfirm={() => { setShowLogoutConfirm(false); logout(); }}
                onCancel={() => setShowLogoutConfirm(false)}
            />

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

                <nav className="sidebar-nav">
                    {navSections.map((section: NavSection) => {
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
                                    const showStaticBadge = !showSurveyBadge && typeof item.badge === 'number' && item.badge > 0;

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
                                <div className="sidebar-session" ref={sessionMenuRef}>
                                    <button
                                        className="sidebar-user-logout"
                                        onClick={() => setSessionMenuOpen((prev) => !prev)}
                                        title="Opciones de sesión"
                                        aria-label="Opciones de sesión"
                                        aria-haspopup="menu"
                                        aria-expanded={sessionMenuOpen}
                                    >
                                        <FiLogOut />
                                    </button>

                                    {sessionMenuOpen && (
                                        <div className="sidebar-session-menu" role="menu">
                                            {puedeCambiarDeObra && (
                                                <button
                                                    type="button"
                                                    role="menuitem"
                                                    className="sidebar-session-item"
                                                    onClick={handleCambiarDeObra}
                                                >
                                                    <FiRepeat />
                                                    <span>Cambiar de obra</span>
                                                </button>
                                            )}
                                            <button
                                                type="button"
                                                role="menuitem"
                                                className="sidebar-session-item sidebar-session-item--danger"
                                                onClick={() => { setSessionMenuOpen(false); setShowLogoutConfirm(true); }}
                                            >
                                                <FiLogOut />
                                                <span>Cerrar sesión</span>
                                            </button>
                                        </div>
                                    )}
                                </div>
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
