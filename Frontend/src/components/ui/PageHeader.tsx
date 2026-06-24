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

        /* ── Banner variant ── */
        .ui-page-header--banner {
          /* Pull up by main-content's top gap (space-6) and bleed into both
             main-content (space-6) + page-content (space-6) horizontal paddings */
          margin: calc(-1 * var(--space-6)) calc(-2 * var(--space-6)) var(--space-6);
          /* Restore inner padding so text stays aligned with the page body below */
          padding: var(--space-5) var(--space-12) calc(var(--space-6) + 3px);
          background: var(--cchc-navy);
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
          background: linear-gradient(90deg, #006edc 0%, #df3601 100%);
        }
        .ui-page-header--banner .ui-page-header-title {
          color: #fff;
        }
        .ui-page-header--banner .ui-page-header-description {
          color: rgba(255, 255, 255, 0.78);
        }
        .ui-page-header--banner .ui-page-header-back {
          color: rgba(255, 255, 255, 0.68);
        }
        .ui-page-header--banner .ui-page-header-back:hover {
          color: #fff;
        }
        .ui-page-header--banner .ui-page-header-scope {
          background: rgba(255, 255, 255, 0.15);
          color: rgba(255, 255, 255, 0.9);
        }
        .ui-page-header--banner .btn-secondary {
          background: rgba(255,255,255,0.12);
          border-color: rgba(255,255,255,0.25);
          color: white;
        }
        .ui-page-header--banner .btn-secondary:hover {
          background: rgba(255,255,255,0.2);
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
        .ui-page-header--banner .ui-page-header-breadcrumb-item a { color: rgba(255,255,255,0.6); }
        .ui-page-header--banner .ui-page-header-breadcrumb-item a:hover { color: #fff; }
        .ui-page-header--banner .ui-page-header-breadcrumb-sep { color: rgba(255,255,255,0.4); }
        .ui-page-header--banner .ui-page-header-breadcrumb-current { color: rgba(255,255,255,0.85); }

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
        @media (max-width: 640px) {
          .ui-page-header--banner {
            /* Mobile: main-content h-padding=space-4, page-content h-padding=space-2 → cancel both */
            margin: calc(-1 * var(--space-4)) calc(-1 * var(--space-6)) var(--space-4);
            padding: var(--space-4) var(--space-6) var(--space-5);
          }
          .ui-page-header-actions { width: 100%; justify-content: flex-start; }
        }
      `}</style>
    </div>
  );
}
