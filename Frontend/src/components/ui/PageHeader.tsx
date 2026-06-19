import { Link } from 'react-router-dom';
import { FiArrowLeft } from 'react-icons/fi';

export interface PageHeaderProps {
  title: string;
  description?: string;
  scope?: { label: string };
  backTo?: string;
  actions?: React.ReactNode;
}

export default function PageHeader({ title, description, scope, backTo, actions }: PageHeaderProps) {
  return (
    <div className="ui-page-header">
      {backTo && (
        <Link to={backTo} className="ui-page-header-back">
          <FiArrowLeft size={16} />
          <span>Volver</span>
        </Link>
      )}
      <div className="ui-page-header-main">
        <div className="ui-page-header-info">
          {scope && <span className="ui-page-header-scope">{scope.label}</span>}
          <h1 className="ui-page-header-title">{title}</h1>
          {description && <p className="ui-page-header-description">{description}</p>}
        </div>
        {actions && <div className="ui-page-header-actions">{actions}</div>}
      </div>
      <style>{`
        .ui-page-header {
          padding: var(--space-6) 0 var(--space-4);
          border-bottom: 1px solid var(--surface-border);
          margin-bottom: var(--space-6);
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
          font-family: var(--font-display);
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
          .ui-page-header-actions { width: 100%; justify-content: flex-start; }
        }
      `}</style>
    </div>
  );
}
