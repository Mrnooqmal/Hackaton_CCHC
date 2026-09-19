import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { FiMenu, FiChevronRight, FiBell, FiHome, FiSun, FiMoon, FiHelpCircle } from 'react-icons/fi';
import { useLayout } from '../context/LayoutContext';
import { useObraContext } from '../context/ObraContext';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../hooks/useTheme';
import { useBrand } from '../context/BrandContext';
import { inboxApi } from '../api/client';

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
    'documents-repository': { label: 'Repositorio', path: '/documents-repository' },
    surveys: { label: 'Encuestas', path: '/surveys' },
    incidents: { label: 'Incidentes', path: '/incidents' },
    activities: { label: 'Actividades', path: '/activities' },
    'my-signatures': { label: 'Firmas', path: '/my-signatures' },
    'signature-requests': { label: 'Firmas', path: '/my-signatures' },
    inbox: { label: 'Notificaciones', path: '/inbox' },
    settings: { label: 'Configuración' },
    'change-password': { label: 'Cambiar contraseña' },
    'enroll-me': { label: 'Mi enrolamiento' },
};

// Ayuda contextual: primer segmento de la ruta → página del módulo en el manual
// (/manual/modulos/*). Las rutas sin página propia caen a la portada del manual.
const MANUAL_SECTION: Record<string, string> = {
    '': 'dashboard',
    personas: 'personas',
    workers: 'personas',
    users: 'personas',
    obras: 'obras',
    'documents-repository': 'documentos',
    surveys: 'encuestas',
    incidents: 'incidentes',
    activities: 'actividades',
    'catalogos-actividad': 'actividades',
    'my-signatures': 'firmas',
    'signature-requests': 'firmas',
    inbox: 'bandeja-entrada',
    'mi-empresa': 'tenants',
    'cargos-onboarding': 'tenants',
};

/** Ruta SPA del manual correspondiente a la ruta actual (portada si no hay módulo). */
const manualUrlFor = (pathname: string): string => {
    const primer = pathname.split('/').filter(Boolean)[0] || '';
    const slug = MANUAL_SECTION[primer];
    return slug ? `/manual/modulos/${slug}` : '/manual';
};

// Etiqueta de la hoja para páginas de detalle (rutas con id dinámico)
const DETAIL_LEAF: Record<string, string> = {
    workers: 'Detalle de persona',
    personas: 'Detalle de persona',
    obras: 'Detalle de obra',
};

// Etiqueta de la hoja para sub-rutas de acción (no dinámicas), por `sección/acción`.
// Tiene prioridad sobre DETAIL_LEAF para que /personas/nueva no diga "Detalle".
const ACTION_LEAF: Record<string, string> = {
    'personas/nueva': 'Nueva persona',
    'personas/carga-masiva': 'Carga masiva',
    'obras/nueva': 'Nueva obra',
};

// Etiqueta de la hoja para sub-rutas que cuelgan de una página de detalle,
// por `sección/sub-acción` (la sub-acción es el segmento posterior al id).
const SUBDETAIL_LEAF: Record<string, string> = {
    'obras/equipo': 'Equipo de obra',
};

function buildCrumbs(pathname: string, obraActiva = false): Crumb[] {
    const segments = pathname.split('/').filter(Boolean);
    const crumbs: Crumb[] = [{ label: 'Inicio', to: '/', home: true }];

    if (segments.length === 0) {
        return crumbs;
    }

    const first = segments[0];
    const section = SECTION[first];
    const isLeafSection = segments.length === 1;

    // Con una obra activa el listado de obras queda fuera del flujo: el detalle
    // de esa obra es el nodo de primer nivel, igual que en el menú lateral.
    const omitirListadoObras = obraActiva && first === 'obras' && !isLeafSection;

    if (!omitirListadoObras) {
        crumbs.push({
            label: section?.label ?? first.charAt(0).toUpperCase() + first.slice(1),
            to: isLeafSection ? undefined : (section?.path ?? `/${first}`),
        });
    }

    if (segments.length > 1) {
        const actionLabel = ACTION_LEAF[`${first}/${segments[1]}`];
        const detailLabel = actionLabel ?? DETAIL_LEAF[first] ?? 'Detalle';
        const hasSubRoute = segments.length > 2;
        // Con una sub-ruta (ej. /obras/:id/equipo) el detalle pasa a ser enlace
        crumbs.push({
            label: detailLabel,
            to: hasSubRoute ? `/${first}/${segments[1]}` : undefined,
        });

        if (hasSubRoute) {
            const sub = segments[2];
            const subLabel = SUBDETAIL_LEAF[`${first}/${sub}`];
            crumbs.push({ label: subLabel ?? sub.charAt(0).toUpperCase() + sub.slice(1) });
        }
    }

    // Elimina duplicados consecutivos
    return crumbs.filter((c, i) => i === 0 || c.label !== crumbs[i - 1].label);
}

export default function Header() {
    const { user } = useAuth();
    const { toggleMobileMenu, toggleSidebarCollapsed } = useLayout();
    const { selectedObra, modoEmpresa, puedeGestionarEmpresa, isLoadingObras } = useObraContext();
    const { theme, toggleTheme } = useTheme();
    const { logo } = useBrand();
    const location = useLocation();

    // Badge de notificaciones no leidas en la campana del header.
    // Se refresca al cambiar de ruta (ej. tras leer mensajes en /inbox) y cada 60s.
    const [unreadCount, setUnreadCount] = useState(0);
    useEffect(() => {
        const personaId = user?.personaId;
        if (!personaId) return;
        let active = true;
        const loadCount = async () => {
            try {
                const res = await inboxApi.getUnreadCount(personaId);
                if (active && res.success && res.data) setUnreadCount(res.data.unreadCount || 0);
            } catch { /* sin red: se reintenta en el proximo ciclo */ }
        };
        loadCount();
        const interval = setInterval(loadCount, 60000);
        return () => { active = false; clearInterval(interval); };
    }, [user?.personaId, location.pathname]);

    const crumbs = buildCrumbs(location.pathname, !!selectedObra);

    // La obra se elige al entrar (y se cambia desde el menú de sesión), así que
    // acá solo se recuerda en qué ámbito se está trabajando.
    const scopeLabel = selectedObra
        ? [selectedObra.codigo, selectedObra.nombre].filter(Boolean).join(' · ')
        : (modoEmpresa && puedeGestionarEmpresa ? 'Vista empresa' : null);

    // El botón hamburguesa colapsa el sidebar en escritorio y abre el overlay en móvil
    const handleToggleSidebar = () => {
        if (typeof window !== 'undefined' && window.innerWidth <= 1024) {
            toggleMobileMenu();
        } else {
            toggleSidebarCollapsed();
        }
    };

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
                    {!isLoadingObras && scopeLabel && (
                        <span className="header-obra-label" title={`Estás trabajando en: ${scopeLabel}`}>
                            {scopeLabel}
                        </span>
                    )}

                    {/* Ayuda contextual: abre el manual en la página del módulo actual */}
                    <Link
                        to={manualUrlFor(location.pathname)}
                        className="header-action"
                        aria-label="Abrir el manual de uso de esta sección"
                        title="Ayuda de esta sección"
                    >
                        <FiHelpCircle />
                    </Link>

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
                        aria-label={unreadCount > 0 ? `Notificaciones (${unreadCount} sin leer)` : 'Notificaciones'}
                        title={unreadCount > 0 ? `${unreadCount} notificacion(es) sin leer` : 'Notificaciones'}
                        style={{ position: 'relative' }}
                    >
                        <FiBell />
                        {unreadCount > 0 && (
                            <span style={{
                                position: 'absolute', top: '2px', right: '2px',
                                minWidth: '16px', height: '16px', padding: '0 4px',
                                borderRadius: '999px', background: 'var(--danger-500, #ef4444)',
                                color: 'white', fontSize: '10px', fontWeight: 700,
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                lineHeight: 1
                            }}>
                                {unreadCount > 99 ? '99+' : unreadCount}
                            </span>
                        )}
                    </Link>
                </div>
            </div>
        </header>
    );
}
