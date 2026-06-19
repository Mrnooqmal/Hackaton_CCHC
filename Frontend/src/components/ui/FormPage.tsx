export interface FormPageProps {
  header?: React.ReactNode;
  stepper?: React.ReactNode;
  children: React.ReactNode;
  actions: React.ReactNode;
  onSubmit?: (e: React.FormEvent) => void;
  /** Max width of the form inner container. Default 760. Use 960 for wider forms. */
  maxWidth?: number;
}

export default function FormPage({ header, stepper, children, actions, onSubmit, maxWidth = 760 }: FormPageProps) {
  return (
    // El <form> envuelve también las acciones: si el botón submit queda fuera
    // del form, el click no dispara onSubmit (el submit no se asocia a ningún form).
    <form className="ui-form-page" onSubmit={onSubmit} noValidate>
      <div className="ui-form-page-inner" style={{ maxWidth }}>
        <div className="ui-form-page-header">{header}</div>
        {stepper && <div className="ui-form-page-stepper">{stepper}</div>}
        <div className="ui-form-page-body">
          {children}
        </div>
      </div>
      <div className="ui-form-page-actions">{actions}</div>
      <style>{`
        .ui-form-page {
          display: flex;
          flex-direction: column;
          min-height: calc(100vh - var(--header-height, 94px));
        }
        .ui-form-page-inner {
          flex: 1;
          width: 100%;
          margin: 0 auto;
          padding: var(--space-6) var(--space-6) calc(var(--space-6) + 72px);
        }
        .ui-form-page-stepper {
          margin-bottom: var(--space-6);
        }
        .ui-form-page-body {
          display: flex;
          flex-direction: column;
          gap: var(--space-8);
        }
        .ui-form-page-actions {
          position: sticky;
          bottom: 0;
          left: 0;
          right: 0;
          background: var(--surface-card);
          border-top: 1px solid var(--surface-border);
          padding: var(--space-4) var(--space-6);
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: var(--space-2);
          z-index: 10;
        }
        @media (max-width: 640px) {
          .ui-form-page-inner { padding: var(--space-4) var(--space-4) calc(var(--space-4) + 72px); }
          .ui-form-page-actions { padding: var(--space-3) var(--space-4); }
        }
      `}</style>
    </form>
  );
}

export interface FieldSectionProps {
  title: string;
  description?: string;
  children: React.ReactNode;
  /** Cols in the grid body. Default 2. */
  cols?: 2 | 3;
  /** Accent variant for the section header. Default 'none'. */
  accent?: 'blue' | 'none';
}

export function FieldSection({ title, description, children, cols = 2, accent = 'none' }: FieldSectionProps) {
  return (
    <section className="ui-field-section">
      <div className={`ui-field-section-header${accent === 'blue' ? ' ui-field-section-header--blue' : ''}`}>
        <h2 className="ui-field-section-title">{title}</h2>
        {description && <p className="ui-field-section-description">{description}</p>}
      </div>
      <div className={`ui-field-section-body ui-field-section-body--cols-${cols}`}>{children}</div>
      <style>{`
        .ui-field-section {
          display: flex;
          flex-direction: column;
          gap: var(--space-4);
        }
        .ui-field-section-header {
          padding-bottom: var(--space-3);
          border-bottom: 1px solid var(--surface-border);
        }
        .ui-field-section-header--blue {
          border-bottom-color: var(--primary-400, #006edc);
          padding-left: var(--space-3);
          border-left: 3px solid var(--primary-500, #006edc);
        }
        .ui-field-section-title {
          font-family: var(--font-display);
          font-size: var(--text-lg);
          font-weight: 600;
          color: var(--text-primary);
          margin: 0;
        }
        .ui-field-section-description {
          font-size: var(--text-sm);
          color: var(--text-secondary);
          margin: var(--space-1) 0 0;
          line-height: 1.5;
        }
        .ui-field-section-body {
          display: grid;
          gap: var(--space-4);
        }
        .ui-field-section-body--cols-2 { grid-template-columns: repeat(2, 1fr); }
        .ui-field-section-body--cols-3 { grid-template-columns: repeat(3, 1fr); }
        .ui-field-section-body > * { min-width: 0; }
        .ui-field-section-body .form-group.full-width,
        .ui-field-section-body > .full-width { grid-column: 1 / -1; }
        @media (max-width: 768px) {
          .ui-field-section-body--cols-3 { grid-template-columns: repeat(2, 1fr); }
        }
        @media (max-width: 640px) {
          .ui-field-section-body--cols-2,
          .ui-field-section-body--cols-3 { grid-template-columns: 1fr; }
        }
      `}</style>
    </section>
  );
}
