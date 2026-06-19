export interface FormPageProps {
  header: React.ReactNode;
  stepper?: React.ReactNode;
  children: React.ReactNode;
  actions: React.ReactNode;
  onSubmit?: (e: React.FormEvent) => void;
}

export default function FormPage({ header, stepper, children, actions, onSubmit }: FormPageProps) {
  return (
    <div className="ui-form-page">
      <div className="ui-form-page-inner">
        <div className="ui-form-page-header">{header}</div>
        {stepper && <div className="ui-form-page-stepper">{stepper}</div>}
        <form
          className="ui-form-page-body"
          onSubmit={onSubmit}
          noValidate
        >
          {children}
        </form>
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
          max-width: 760px;
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
    </div>
  );
}

export interface FieldSectionProps {
  title: string;
  description?: string;
  children: React.ReactNode;
}

export function FieldSection({ title, description, children }: FieldSectionProps) {
  return (
    <section className="ui-field-section">
      <div className="ui-field-section-header">
        <h2 className="ui-field-section-title">{title}</h2>
        {description && <p className="ui-field-section-description">{description}</p>}
      </div>
      <div className="ui-field-section-body">{children}</div>
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
          grid-template-columns: repeat(2, 1fr);
          gap: var(--space-4);
        }
        .ui-field-section-body > * { min-width: 0; }
        .ui-field-section-body .form-group.full-width,
        .ui-field-section-body > .full-width { grid-column: 1 / -1; }
        @media (max-width: 640px) {
          .ui-field-section-body { grid-template-columns: 1fr; }
        }
      `}</style>
    </section>
  );
}
