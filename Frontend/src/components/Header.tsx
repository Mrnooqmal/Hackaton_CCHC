import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { FiMenu, FiChevronDown, FiChevronRight, FiBell, FiHome, FiSun, FiMoon } from 'react-icons/fi';
import { useLayout } from '../context/LayoutContext';
import { useObraContext } from '../context/ObraContext';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../hooks/useTheme';
import { useBrand } from '../context/BrandContext';

interface Crumb {
    label: string;
    to?: string;
    home?: boolean;
}

// Etiqueta de cada sección de primer nivel para las migas de pan
const SECTION: Record<string, { label: string; path?: string }> = {
    personas: { label: 'Personas', path: '/personas' },
    workers: { label: 'Personas', path: '/personas' },
    users: { label: 'Personas', path: '/personas' },
    obras: { label: 'Obras', path: '/obras' },
    documents: { label: 'Documentos', path: '/documents' },
    surveys: { label: 'Encuestas', path: '/surveys' },
    incidents: { label: 'Incidentes', path: '/incidents' },
    activities: { label: 'Actividades', path: '/activities' },
    'my-signatures': { label: 'Firmas', path: '/my-signatures' },
    'offline-signatures': { label: 'Firmas offline', path: '/offline-signatures' },
    'signature-requests': { label: 'Firmas', path: '/my-signatures' },
    inbox: { label: 'Notificaciones', path: '/inbox' },
    'ai-assistant': { label: 'Asistente IA', path: '/ai-assistant' },
    settings: { label: 'Configuración' },
    'change-password': { label: 'Cambiar contraseña' },
    'enroll-me': { label: 'Mi enrolamiento' },
};

// Etiqueta de la hoja para páginas de detalle (rutas con id dinámico)
const DETAIL_LEAF: Record<string, string> = {
    workers: 'Detalle de persona',
    personas: 'Detalle de persona',
    obras: 'Detalle de obra',
};

function buildCrumbs(pathname: string): Crumb[] {
    const segments = pathname.split('/').filter(Boolean);
    const crumbs: Crumb[] = [{ label: 'Inicio', to: '/', home: true }];

    if (segments.length === 0) {
        return crumbs;
    }

    const first = segments[0];
    const section = SECTION[first];
    const isLeafSection = segments.length === 1;

    crumbs.push({
        label: section?.label ?? first.charAt(0).toUpperCase() + first.slice(1),
        to: isLeafSection ? undefined : (section?.path ?? `/${first}`),
    });

    if (segments.length > 1) {
        crumbs.push({ label: DETAIL_LEAF[first] ?? 'Detalle' });
    }

    // Elimina duplicados consecutivos
    return crumbs.filter((c, i) => i === 0 || c.label !== crumbs[i - 1].label);
}

export default function Header() {
    const { user } = useAuth();
    const { toggleMobileMenu, toggleSidebarCollapsed } = useLayout();
    const { obras, selectedObraId, setSelectedObraId, isLoadingObras } = useObraContext();
    const { theme, toggleTheme } = useTheme();
    const { logo } = useBrand();
    const location = useLocation();
    const [obraMenuOpen, setObraMenuOpen] = useState(false);
    const obraMenuRef = useRef<HTMLDivElement | null>(null);

    const crumbs = buildCrumbs(location.pathname);

    const selectedObra = selectedObraId
        ? obras.find((o) => o.obraId === selectedObraId)?.nombre || 'Obra desconocida'
        : 'Todas las obras';

    // El botón hamburguesa colapsa el sidebar en escritorio y abre el overlay en móvil
    const handleToggleSidebar = () => {
        if (typeof window !== 'undefined' && window.innerWidth <= 1024) {
            toggleMobileMenu();
        } else {
            toggleSidebarCollapsed();
        }
    };

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (obraMenuRef.current && !obraMenuRef.current.contains(event.target as Node)) {
                setObraMenuOpen(false);
            }
        };
        if (obraMenuOpen) {
            document.addEventListener('mousedown', handleClickOutside);
        }
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [obraMenuOpen]);

    const showObraSelector =
        user && (user.rol === 'admin' || user.rol === 'prevencionista' || obras.length > 0);

    return (
        <header className="header">
            {/* ── Franja institucional superior ── */}
            <div className="header-topbar">
                <span className="header-topbar-brand">
                    Cámara Chilena de la Construcción
                </span>
            </div>

            {/* ── Barra principal ── */}
            <div className="header-mainbar">
                <div className="header-mainbar-left">
                    <button
                        type="button"
                        className="header-hamburger"
                        onClick={handleToggleSidebar}
                        aria-label="Mostrar u ocultar el menú lateral"
                    >
                        <FiMenu />
                    </button>

                    {logo ? (
                        <Link to="/" className="header-brand" aria-label="Inicio">
                            <img src={logo} alt="Logo empresa" className="header-brand-logo" />
                        </Link>
                    ) : (
                        <Link to="/" className="header-brand" aria-label="Build &amp; Serve — Inicio">
                            <span className="header-brand-primary">Build</span>
                            <span className="header-brand-amp">&amp;</span>
                            <span className="header-brand-secondary">Serve</span>
                        </Link>
                    )}

                    <span className="header-divider" aria-hidden="true" />

                    <nav className="breadcrumbs" aria-label="Migas de pan">
                        {crumbs.map((crumb, index) => {
                            const isLast = index === crumbs.length - 1;
                            return (
                                <span className="breadcrumb-node" key={`${crumb.label}-${index}`}>
                                    {index > 0 && (
                                        <FiChevronRight className="breadcrumb-sep" aria-hidden="true" />
                                    )}
                                    {isLast ? (
                                        <span className="breadcrumb-current" aria-current="page">
                                            {crumb.label}
                                        </span>
                                    ) : crumb.to ? (
                                        <Link to={crumb.to} className="breadcrumb-link">
                                            {crumb.home ? <FiHome aria-label={crumb.label} /> : crumb.label}
                                        </Link>
                                    ) : (
                                        <span className="breadcrumb-ancestor">{crumb.label}</span>
                                    )}
                                </span>
                            );
                        })}
                    </nav>
                </div>

                <div className="header-mainbar-right">
                    {showObraSelector && (
                        <div className="header-obra" ref={obraMenuRef}>
                            <button
                                type="button"
                                className="header-obra-trigger"
                                onClick={() => setObraMenuOpen((prev) => !prev)}
                                disabled={isLoadingObras}
                                aria-haspopup="menu"
                                aria-expanded={obraMenuOpen}
                            >
                                <span className="header-obra-label">
                                    {isLoadingObras ? 'Cargando…' : selectedObra}
                                </span>
                                <FiChevronDown className="header-obra-caret" />
                            </button>

                            {obraMenuOpen && (
                                <div className="header-dropdown" role="menu">
                                    <button
                                        type="button"
                                        className={`header-dropdown-item ${!selectedObraId ? 'active' : ''}`}
                                        onClick={() => {
                                            setSelectedObraId(null);
                                            setObraMenuOpen(false);
                                        }}
                                    >
                                        Todas las obras
                                    </button>
                                    {obras.length > 0 && <div className="header-dropdown-divider" />}
                                    {obras.map((obra) => (
                                        <button
                                            key={obra.obraId}
                                            type="button"
                                            className={`header-dropdown-item ${selectedObraId === obra.obraId ? 'active' : ''}`}
                                            onClick={() => {
                                                setSelectedObraId(obra.obraId);
                                                setObraMenuOpen(false);
                                            }}
                                        >
                                            <span className="header-dropdown-item-title">{obra.nombre}</span>
                                            <span className="header-dropdown-item-sub">{obra.etapaActual}</span>
                                        </button>
                                    ))}
                                    {obras.length === 0 && !isLoadingObras && (
                                        <div className="header-dropdown-empty">No hay obras disponibles</div>
                                    )}
                                </div>
                            )}
                        </div>
                    )}

                    <button
                        type="button"
                        className="header-action"
                        onClick={toggleTheme}
                        aria-label={theme === 'dark' ? 'Activar modo claro' : 'Activar modo oscuro'}
                        title={theme === 'dark' ? 'Modo claro' : 'Modo oscuro'}
                    >
                        {theme === 'dark' ? <FiSun /> : <FiMoon />}
                    </button>

                    <Link
                        to="/inbox"
                        className={`header-action ${location.pathname === '/inbox' ? 'active' : ''}`}
                        aria-label="Notificaciones"
                        title="Notificaciones"
                    >
                        <FiBell />
                    </Link>
                </div>
            </div>
        </header>
    );
}
