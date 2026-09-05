import { Link } from 'react-router-dom';
import { FiArrowLeft } from 'react-icons/fi';

export interface PageHeaderProps {
  title: string;
  description?: React.ReactNode;
  scope?: { label: string };
  backTo?: string;
  /** Custom label for the back link (defaults to "Volver") */
  backLabel?: string;
  /** Optional breadcrumb segments shown before the title */
  breadcrumb?: { label: string; to: string }[];
  actions?: React.ReactNode;
  /** When true, renders as a full-bleed CChC navy→blue gradient banner */
  banner?: boolean;
}

export default function PageHeader({ title, description, scope, backTo, backLabel, breadcrumb, actions, banner }: PageHeaderProps) {
  return (
    <div className={`ui-page-header${banner ? ' ui-page-header--banner' : ''}`}>
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
      {backTo && !breadcrumb && (
        <Link to={backTo} className="ui-page-header-back">
          <FiArrowLeft size={15} />
          <span>{backLabel ?? 'Volver'}</span>
        </Link>
      )}
      <div className="ui-page-header-main">
        <div className="ui-page-header-info">
          {scope && <span className="ui-page-header-scope">{scope.label}</span>}
          <h1 className="ui-page-header-title">{title}</h1>
          {description && <div className="ui-page-header-description">{description}</div>}
        </div>
        {actions && <div className="ui-page-header-actions">{actions}</div>}
      </div>
      <style>{`
        .ui-page-header {
          padding: var(--space-6) 0 var(--space-4);
          border-bottom: 1px solid var(--surface-border);
          margin-bottom: var(--space-6);
        }

        /* ── Banner variant ──
           El banner comparte superficie con la barra principal del header, de
           modo que header + título forman un solo bloque de chrome continuo.
           La regla azul→rojo del borde inferior es la única costura entre ese
           bloque y el lienzo de contenido. El navy institucional queda
           reservado para el marco de la app (franja superior y footer). */
        .ui-page-header--banner {
          /* Sangrado lateral = padding de .main-content + el de .page-content.
             La MISMA medida se reutiliza como padding interno, de modo que el
             fondo llega a los bordes y el título queda alineado con el
             contenido de la página que va debajo. Ambos paddings cambian por
             breakpoint, así que sólo se redefine la variable (ver abajo). */
          --banner-bleed: calc(var(--space-6) + var(--space-6));
          margin: calc(-1 * var(--space-6)) calc(-1 * var(--banner-bleed)) var(--space-6);
          padding: var(--space-8) var(--banner-bleed) calc(var(--space-6) + 3px);
          background: var(--surface-card);
          position: relative;
          border-top: none;
          border-bottom: none;
        }
        .ui-page-header--banner::after {
          content: '';
          position: absolute;
          bottom: 0;
          left: 0;
          right: 0;
          height: 3px;
          background: var(--cchc-accent-line);
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
        .ui-page-header-back {
          display: inline-flex;
          align-items: center;
          gap: var(--space-1);
          font-size: var(--text-sm);
          color: var(--text-muted);
          text-decoration: none;
          margin-bottom: var(--space-3);
          transition: color var(--transition-fast);
        }
        .ui-page-header-back:hover { color: var(--text-primary); }
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
           24+24 → 16+24 (≤1024) → 16+16 (≤768) → 12+8 (≤480). */
        @media (max-width: 1024px) {
          .ui-page-header--banner { --banner-bleed: calc(var(--space-4) + var(--space-6)); }
        }
        @media (max-width: 768px) {
          .ui-page-header--banner { --banner-bleed: calc(var(--space-4) + var(--space-4)); }
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
        @media (max-width: 480px) {
          .ui-page-header--banner { --banner-bleed: calc(var(--space-3) + var(--space-2)); }
        }
      `}</style>
    </div>
  );
}
