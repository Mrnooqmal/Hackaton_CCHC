import { Link } from 'react-router-dom';

export interface PageHeaderTab {
  id: string;
  label: string;
  /** Recuento u otra marca corta a la derecha del rótulo. */
  badge?: React.ReactNode;
  icon?: React.ReactNode;
}

export interface PageHeaderProps {
  title: string;
  description?: React.ReactNode;
  scope?: { label: string };
  /** Optional breadcrumb segments shown before the title */
  breadcrumb?: { label: string; to: string }[];
  actions?: React.ReactNode;
  /**
   * Secciones de la página. Cuando el contenido cambia por pestañas, estas van
   * en el encabezado —pegadas a su regla inferior, como en el detalle de obra—
   * y no sueltas sobre el contenido: así el corte entre secciones pertenece al
   * chrome de la página y no compite con lo que la sección muestra.
   */
  tabs?: PageHeaderTab[];
  activeTab?: string;
  onTabChange?: (id: string) => void;
  /** Etiqueta del grupo de pestañas para lectores de pantalla. */
  tabsLabel?: string;
  /** When true, renders as a full-bleed CChC navy→blue gradient banner */
  banner?: boolean;
}

export default function PageHeader({
  title, description, scope, breadcrumb, actions,
  tabs, activeTab, onTabChange, tabsLabel, banner,
}: PageHeaderProps) {
  const conTabs = Boolean(tabs && tabs.length > 0);
  return (
    <div className={`ui-page-header${banner ? ' ui-page-header--banner' : ''}${conTabs ? ' ui-page-header--con-tabs' : ''}`}>
      {breadcrumb && breadcrumb.length > 0 && (
        <nav className="ui-page-header-breadcrumb">
          {breadcrumb.map((crumb, i) => (
            <span key={i} className="ui-page-header-breadcrumb-item">
              <Link to={crumb.to}>{crumb.label}</Link>
              <span className="ui-page-header-breadcrumb-sep">›</span>
            </span>
          ))}
          <span className="ui-page-header-breadcrumb-current">{title}</span>
        </nav>
      )}
      <div className="ui-page-header-main">
        <div className="ui-page-header-info">
          {scope && <span className="ui-page-header-scope">{scope.label}</span>}
          <h1 className="ui-page-header-title">{title}</h1>
          {description && <div className="ui-page-header-description">{description}</div>}
        </div>
        {actions && <div className="ui-page-header-actions">{actions}</div>}
      </div>
      {conTabs && (
        <div className="ui-page-header-tabs" role="tablist" aria-label={tabsLabel ?? 'Secciones'}>
          {tabs!.map(tab => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              className="ui-page-header-tab"
              aria-selected={tab.id === activeTab}
              onClick={() => onTabChange?.(tab.id)}
            >
              {tab.icon}
              {tab.label}
              {tab.badge !== undefined && <span className="ui-page-header-tab-badge">{tab.badge}</span>}
            </button>
          ))}
        </div>
      )}
      <style>{`
        .ui-page-header {
          padding: var(--space-6) 0 var(--space-4);
          border-bottom: 1px solid var(--surface-border);
          margin-bottom: var(--space-6);
        }

        /* ── Banner variant ──
           El banner comparte superficie con la barra principal del header, de
           modo que header + título forman un solo bloque de chrome continuo.
           La costura con el lienzo de contenido es una regla NEUTRA de 1 px
           que no llega a los bordes: arranca y termina donde arranca y termina
           el texto (--banner-rule-inset = --banner-bleed), así el corte se lee
           como parte de la columna de contenido y no como un marco. Antes era
           una barra de 3 px con degradado azul→naranjo: pesaba más que el
           título y repetía la marca que ya cargan la franja superior y el
           footer. El color institucional queda para el marco de la app. */
        .ui-page-header--banner {
          /* Sangrado lateral = padding de .main-content + el de .page-content.
             La MISMA medida se reutiliza como padding interno, de modo que el
             fondo llega a los bordes y el título queda alineado con el
             contenido de la página que va debajo. Ambos paddings cambian por
             breakpoint, así que sólo se redefine la variable (ver abajo). */
          --banner-bleed: calc(var(--space-6) + var(--space-6));
          /* Margen lateral de la regla. Sigue al sangrado, de modo que en cada
             breakpoint queda alineada con el título de arriba y el contenido
             de abajo sin tener que redefinirla. */
          --banner-rule-inset: var(--banner-bleed);
          margin: calc(-1 * var(--space-6)) calc(-1 * var(--banner-bleed)) var(--space-6);
          padding: var(--space-8) var(--banner-bleed) calc(var(--space-6) + 1px);
          background: var(--surface-card);
          position: relative;
          border-top: none;
          border-bottom: none;
        }
        .ui-page-header--banner::after {
          content: '';
          position: absolute;
          bottom: 0;
          left: var(--banner-rule-inset);
          right: var(--banner-rule-inset);
          height: 1px;
          background: var(--surface-border);
        }

        .ui-page-header-breadcrumb {
          display: flex;
          align-items: center;
          flex-wrap: wrap;
          gap: 2px;
          margin-bottom: var(--space-3);
          font-size: var(--text-sm);
        }
        .ui-page-header-breadcrumb-item {
          display: inline-flex;
          align-items: center;
          gap: 4px;
        }
        .ui-page-header-breadcrumb-item a {
          color: var(--text-muted);
          text-decoration: none;
          transition: color var(--transition-fast);
        }
        .ui-page-header-breadcrumb-item a:hover { color: var(--text-primary); }
        .ui-page-header-breadcrumb-sep {
          color: var(--text-muted);
          opacity: 0.5;
          font-size: 12px;
          margin: 0 2px;
        }
        .ui-page-header-breadcrumb-current {
          color: var(--text-secondary);
          font-weight: 500;
        }
        /* Las pestañas se apoyan en la regla inferior del encabezado: el
           subrayado de la activa y esa regla son la misma línea. Por eso el
           relleno de abajo se anula y lo pone el alto de la pestaña. */
        .ui-page-header--con-tabs { padding-bottom: 0; }
        .ui-page-header--banner.ui-page-header--con-tabs { padding-bottom: 0; }
        .ui-page-header-tabs {
          display: flex;
          gap: 4px;
          margin-top: var(--space-4);
          overflow-x: auto;
          scrollbar-width: none;
        }
        .ui-page-header-tabs::-webkit-scrollbar { display: none; }
        .ui-page-header-tab {
          display: inline-flex;
          align-items: center;
          gap: 7px;
          height: 48px;
          padding: 0 var(--space-4);
          background: none;
          border: none;
          border-bottom: 2px solid transparent;
          font-family: inherit;
          font-size: var(--text-sm);
          color: var(--text-secondary);
          white-space: nowrap;
          cursor: pointer;
          transition: color var(--transition-fast), border-color var(--transition-fast);
        }
        .ui-page-header-tab:hover { color: var(--text-primary); }
        .ui-page-header-tab[aria-selected='true'] {
          border-bottom-color: var(--accent);
          color: var(--accent-text);
          font-weight: 500;
        }
        .ui-page-header-tab-badge {
          padding: 1px 7px;
          border-radius: 999px;
          background: var(--surface-hover);
          color: var(--text-secondary);
          font-size: 0.72rem;
          font-weight: 700;
          font-variant-numeric: tabular-nums;
        }
        .ui-page-header-tab[aria-selected='true'] .ui-page-header-tab-badge {
          background: var(--accent-tint);
          color: var(--accent-text);
        }
        .ui-page-header-main {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: var(--space-4);
          flex-wrap: wrap;
        }
        .ui-page-header-info { flex: 1; min-width: 0; }
        .ui-page-header-scope {
          display: inline-block;
          font-size: var(--text-xs);
          font-weight: 600;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          color: var(--accent-text);
          background: var(--accent-tint);
          padding: 2px 8px;
          border-radius: var(--radius-sm);
          margin-bottom: var(--space-2);
        }
        .ui-page-header-title {
          font-size: var(--text-2xl);
          font-weight: 700;
          color: var(--text-primary);
          line-height: 1.2;
          margin: 0;
        }
        .ui-page-header-description {
          margin-top: var(--space-1);
          font-size: var(--text-sm);
          color: var(--text-secondary);
          line-height: 1.5;
        }
        .ui-page-header-actions {
          display: flex;
          align-items: center;
          gap: var(--space-2);
          flex-shrink: 0;
        }
        /* Sangrado por breakpoint (main-content + page-content):
           24+24 → 16+24 (≤1024) → 16+8 (≤768). Bajo 768 el padding lateral de
           .page-content baja a --space-2, no a --space-4: calcularlo con el
           valor equivocado desbordaba el banner 8px en teléfono. */
        @media (max-width: 1024px) {
          .ui-page-header--banner { --banner-bleed: calc(var(--space-4) + var(--space-6)); }
        }
        @media (max-width: 768px) {
          .ui-page-header--banner { --banner-bleed: calc(var(--space-4) + var(--space-2)); }
        }
        @media (max-width: 640px) {
          /* Sólo espaciado vertical: el horizontal lo controla --banner-bleed */
          .ui-page-header--banner {
            margin-top: calc(-1 * var(--space-4));
            margin-bottom: var(--space-4);
            padding-top: var(--space-6);
            padding-bottom: var(--space-5);
          }
          .ui-page-header-actions { width: 100%; justify-content: flex-start; }
        }

      `}</style>
    </div>
  );
}
