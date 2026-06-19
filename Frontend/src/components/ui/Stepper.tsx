import { FiCheck } from 'react-icons/fi';

export interface StepperStep {
  id: string;
  label: string;
}

export interface StepperProps {
  steps: StepperStep[];
  currentIndex: number;
  completed?: string[];
  orientation?: 'horizontal' | 'vertical';
}

export default function Stepper({ steps, currentIndex, completed = [], orientation = 'horizontal' }: StepperProps) {
  return (
    <ol className={`ui-stepper ui-stepper--${orientation}`} role="list">
      {steps.map((step, i) => {
        const isDone = completed.includes(step.id);
        const isCurrent = i === currentIndex && !isDone;
        const isPast = i < currentIndex || isDone;

        return (
          <li
            key={step.id}
            className={`ui-stepper-step${isCurrent ? ' current' : ''}${isPast ? ' past' : ''}`}
            aria-current={isCurrent ? 'step' : undefined}
          >
            <div className="ui-stepper-indicator">
              {isPast ? <FiCheck size={13} strokeWidth={3} /> : <span>{i + 1}</span>}
            </div>
            {orientation === 'horizontal' && i < steps.length - 1 && (
              <div className={`ui-stepper-connector${isPast ? ' filled' : ''}`} />
            )}
            <span className="ui-stepper-label">{step.label}</span>
          </li>
        );
      })}
      <style>{`
        .ui-stepper {
          list-style: none;
          padding: 0;
          margin: 0;
          display: flex;
          gap: 0;
        }
        .ui-stepper--horizontal {
          flex-direction: row;
          align-items: center;
        }
        .ui-stepper--vertical {
          flex-direction: column;
          gap: var(--space-4);
        }
        .ui-stepper-step {
          display: flex;
          align-items: center;
          gap: var(--space-2);
          position: relative;
        }
        .ui-stepper--horizontal .ui-stepper-step {
          flex-direction: column;
          align-items: center;
          flex: 1;
        }
        .ui-stepper-indicator {
          width: 28px;
          height: 28px;
          border-radius: 50%;
          border: 2px solid var(--surface-border);
          background: var(--surface-card);
          color: var(--text-muted);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: var(--text-xs);
          font-weight: 700;
          flex-shrink: 0;
          transition: background var(--transition-fast), border-color var(--transition-fast), color var(--transition-fast);
          z-index: 1;
        }
        .ui-stepper-step.current .ui-stepper-indicator {
          border-color: var(--accent);
          background: var(--accent-tint);
          color: var(--accent);
        }
        .ui-stepper-step.past .ui-stepper-indicator {
          border-color: var(--accent);
          background: var(--accent);
          color: #fff;
        }
        .ui-stepper-connector {
          height: 2px;
          flex: 1;
          background: var(--surface-border);
          margin: 0 var(--space-1);
          transition: background var(--transition-normal);
        }
        .ui-stepper-connector.filled {
          background: var(--accent);
        }
        .ui-stepper--horizontal .ui-stepper-connector {
          position: absolute;
          top: 14px;
          left: calc(50% + 16px);
          right: calc(-50% + 16px);
          height: 2px;
          margin: 0;
          z-index: 0;
        }
        .ui-stepper-label {
          font-size: var(--text-xs);
          font-weight: 500;
          color: var(--text-muted);
          white-space: nowrap;
        }
        .ui-stepper-step.current .ui-stepper-label { color: var(--text-primary); }
        .ui-stepper-step.past .ui-stepper-label { color: var(--accent-text); }
        .ui-stepper--horizontal .ui-stepper-label {
          margin-top: var(--space-1);
          text-align: center;
        }
        .ui-stepper--vertical .ui-stepper-step { flex-direction: row; }
      `}</style>
    </ol>
  );
}
