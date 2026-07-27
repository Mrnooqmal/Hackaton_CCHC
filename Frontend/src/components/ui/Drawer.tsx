import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { FiX } from 'react-icons/fi';

export interface DrawerProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  width?: number;
  footer?: React.ReactNode;
  children: React.ReactNode;
}

export default function Drawer({ isOpen, onClose, title, subtitle, width = 480, footer, children }: DrawerProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (isOpen) {
      previousFocusRef.current = document.activeElement as HTMLElement;
      setTimeout(() => panelRef.current?.focus(), 10);
    } else {
      previousFocusRef.current?.focus();
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return createPortal(
    <>
      <div className="ui-drawer-overlay" onClick={onClose} aria-hidden="true" />
      <div
        ref={panelRef}
        className="ui-drawer-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ui-drawer-title"
        tabIndex={-1}
        style={{ '--drawer-width': `${width}px` } as React.CSSProperties}
      >
        <div className="ui-drawer-header">
          <div className="ui-drawer-header-text">
            <h2 id="ui-drawer-title" className="ui-drawer-title">{title}</h2>
            {subtitle && <p className="ui-drawer-subtitle">{subtitle}</p>}
          </div>
          <button
            className="ui-drawer-close"
            onClick={onClose}
            aria-label="Cerrar panel"
          >
            <FiX size={18} />
          </button>
        </div>
        <div className="ui-drawer-body">
          {children}
        </div>
        {footer && <div className="ui-drawer-footer">{footer}</div>}
      </div>
      <style>{`
        .ui-drawer-overlay {
          position: fixed;
          inset: 0;
          background: rgba(0,0,0,0.5);
          backdrop-filter: blur(2px);
          z-index: 9000;
          animation: ui-drawer-fade 200ms ease;
        }
        @keyframes ui-drawer-fade {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        .ui-drawer-panel {
          position: fixed;
          top: 0;
          right: 0;
          bottom: 0;
          width: min(var(--drawer-width, 480px), 100vw);
          background: var(--surface-card);
          border-left: 1px solid var(--surface-border);
          box-shadow: var(--shadow-xl);
          z-index: 9001;
          display: flex;
          flex-direction: column;
          outline: none;
          animation: ui-drawer-slide 250ms cubic-bezier(0.4,0,0.2,1);
        }
        @keyframes ui-drawer-slide {
          from { transform: translateX(100%); }
          to   { transform: translateX(0); }
        }
        .ui-drawer-header {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: var(--space-3);
          padding: var(--space-5) var(--space-6);
          border-bottom: 1px solid var(--surface-border);
          flex-shrink: 0;
        }
        .ui-drawer-header-text { flex: 1; min-width: 0; }
        .ui-drawer-title {
          font-family: var(--font-display);
          font-size: var(--text-lg);
          font-weight: 700;
          color: var(--text-primary);
          margin: 0;
          line-height: 1.3;
        }
        .ui-drawer-subtitle {
          font-size: var(--text-sm);
          color: var(--text-secondary);
          margin: var(--space-1) 0 0;
        }
        .ui-drawer-close {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 32px;
          height: 32px;
          border: none;
          background: none;
          color: var(--text-muted);
          cursor: pointer;
          border-radius: var(--radius-sm);
          flex-shrink: 0;
          transition: background var(--transition-fast), color var(--transition-fast);
        }
        .ui-drawer-close:hover {
          background: var(--surface-hover);
          color: var(--text-primary);
        }
        .ui-drawer-body {
          flex: 1;
          overflow-y: auto;
          padding: var(--space-5) var(--space-6);
        }
        .ui-drawer-footer {
          padding: var(--space-4) var(--space-6);
          border-top: 1px solid var(--surface-border);
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: var(--space-2);
          flex-shrink: 0;
          background: var(--surface-card);
        }
        @media (max-width: 640px) {
          .ui-drawer-panel { width: 100vw; }
        }
      `}</style>
    </>,
    document.body
  );
}
