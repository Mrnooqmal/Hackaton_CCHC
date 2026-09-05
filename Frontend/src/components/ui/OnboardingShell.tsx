import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import Stepper from './Stepper';
import type { StepperStep } from './Stepper';

export interface OnboardingShellProps {
  /** Datos del usuario para el panel lateral (nombre, apellido, email). */
  user?: { nombre?: string; apellido?: string; email?: string } | null;
  /** Pasos del flujo de onboarding mostrados en el stepper. */
  steps: StepperStep[];
  currentIndex: number;
  completed?: string[];
  /** Texto de ayuda al pie del panel lateral. */
  sideHint?: string;
  /** Contenido del área principal (formulario, tarjeta, etc.). */
  children: ReactNode;
}

/**
 * Carcasa a pantalla completa para los pasos del primer ingreso (cambio de
 * contraseña + enrolamiento). Panel lateral navy con logo, datos del usuario y
 * stepper; área principal centrada para el contenido de cada paso.
 */
export default function OnboardingShell({
  user,
  steps,
  currentIndex,
  completed = [],
  sideHint,
  children,
}: OnboardingShellProps) {
  return (
    <div className="cp-root">
      {/* Panel de contexto — solo visible en desktop */}
      <div className="cp-side">
        <div className="cp-side-inner">
          <Link to="/" className="cp-logo" aria-label="Build & Serve — Inicio">
            <span className="cp-logo-primary">Build</span>
            <span className="cp-logo-amp">&amp;</span>
            <span className="cp-logo-secondary">Serve</span>
          </Link>
          {user && (user.nombre || user.email) && (
            <div className="cp-user-info">
              {(user.nombre || user.apellido) && (
                <span className="cp-user-name">{user.nombre} {user.apellido}</span>
              )}
              {user.email && <span className="cp-user-email">{user.email}</span>}
            </div>
          )}
          <div className="cp-stepper-wrap">
            <Stepper steps={steps} currentIndex={currentIndex} completed={completed} orientation="vertical" />
          </div>
          {sideHint && <p className="cp-side-hint">{sideHint}</p>}
        </div>
        <div className="cp-side-grid" aria-hidden="true" />
      </div>

      {/* Área principal */}
      <div className="cp-main">
        <div className="cp-form-wrap">
          <div className="cp-stepper-mobile">
            <Stepper steps={steps} currentIndex={currentIndex} completed={completed} orientation="horizontal" />
          </div>
          {children}
        </div>
      </div>

      <style>{`
        .cp-root { min-height: 100vh; display: flex; background: var(--surface-bg); }
        /* ── Panel lateral ── */
        .cp-side {
          width: 340px; flex-shrink: 0; background: var(--cchc-navy);
          position: relative; overflow: hidden; display: flex; flex-direction: column;
        }
        .cp-side-inner {
          position: relative; z-index: 1; padding: var(--space-10) var(--space-8);
          display: flex; flex-direction: column; gap: var(--space-6); flex: 1;
        }
        .cp-side-grid {
          position: absolute; inset: 0;
          background-image:
            linear-gradient(rgba(0,110,220,0.08) 1px, transparent 1px),
            linear-gradient(90deg, rgba(0,110,220,0.08) 1px, transparent 1px);
          background-size: 28px 28px; pointer-events: none;
        }
        .cp-logo {
          display: flex; align-items: center; gap: 4px; font-family: var(--font-logo);
          font-size: var(--text-xl); font-weight: 700; text-decoration: none; letter-spacing: -0.02em;
        }
        .cp-logo-primary { color: #e8eefb; }
        .cp-logo-amp { color: #4d9fff; margin: 0 2px; }
        .cp-logo-secondary { color: #4d9fff; }
        .cp-user-info {
          display: flex; flex-direction: column; gap: 2px;
          padding: var(--space-3) var(--space-4); background: rgba(255,255,255,0.06);
          border-radius: var(--radius-md); border: 1px solid rgba(255,255,255,0.1);
        }
        .cp-user-name { font-size: var(--text-sm); font-weight: 600; color: #e8eefb; }
        .cp-user-email { font-size: var(--text-xs); color: rgba(232,238,251,0.6); }
        .cp-stepper-wrap { margin-top: var(--space-2); }
        .cp-side-hint {
          font-size: var(--text-sm); color: rgba(232,238,251,0.55);
          line-height: 1.6; margin-top: auto;
        }
        /* ── Área principal ── */
        .cp-main {
          flex: 1; display: flex; align-items: center; justify-content: center;
          padding: var(--space-8) var(--space-6);
        }
        .cp-form-wrap {
          width: 100%; max-width: 460px; display: flex; flex-direction: column; gap: var(--space-6);
        }
        .cp-stepper-mobile { display: none; }
        .cp-form-header { display: flex; flex-direction: column; gap: var(--space-1); }
        .cp-title {
          font-size: var(--text-2xl); font-weight: 700;
          color: var(--text-primary); margin: 0;
        }
        .cp-subtitle { font-size: var(--text-sm); color: var(--text-secondary); margin: 0; line-height: 1.5; }
        .cp-form { display: flex; flex-direction: column; gap: var(--space-5); }
        .cp-field { position: relative; }
        .cp-field .form-input { padding-right: 42px; }
        .cp-toggle {
          position: absolute; right: 10px; top: 50%; transform: translateY(-50%);
          background: none; border: none; color: var(--text-muted); cursor: pointer;
          display: flex; align-items: center; padding: 4px; border-radius: var(--radius-sm);
          transition: color var(--transition-fast);
        }
        .cp-toggle:hover { color: var(--text-primary); }
        .cp-strength { display: flex; align-items: center; gap: var(--space-2); margin-top: var(--space-2); }
        .cp-strength-bars { display: flex; gap: 3px; }
        .cp-strength-bar { width: 36px; height: 3px; border-radius: 2px; background: var(--surface-hover); transition: background 0.3s; }
        .cp-strength-label { font-size: var(--text-xs); font-weight: 600; }
        .cp-rules { display: flex; flex-wrap: wrap; gap: var(--space-2); margin-top: var(--space-2); }
        .cp-rule {
          display: inline-flex; align-items: center; gap: 4px; font-size: var(--text-xs);
          color: var(--text-muted); transition: color var(--transition-fast);
        }
        .cp-rule.ok { color: var(--success-500); }
        .cp-capslock {
          display: flex; align-items: center; gap: var(--space-1); font-size: var(--text-xs);
          color: var(--warning-600); padding: var(--space-2) var(--space-3);
          background: rgba(234,179,8,0.08); border: 1px solid rgba(234,179,8,0.2); border-radius: var(--radius-sm);
        }
        .cp-error {
          display: flex; align-items: center; gap: var(--space-2); font-size: var(--text-sm);
          color: var(--danger-500); padding: var(--space-3); background: rgba(244,67,54,0.08);
          border: 1px solid rgba(244,67,54,0.2); border-radius: var(--radius-sm);
        }
        .cp-actions { display: flex; flex-direction: column; gap: var(--space-2); padding-top: var(--space-2); }
        .cp-success {
          display: flex; flex-direction: column; align-items: center; gap: var(--space-3);
          padding: var(--space-10) 0; text-align: center;
        }
        .cp-success-icon {
          width: 56px; height: 56px; border-radius: 50%; background: rgba(34,197,94,0.12);
          color: var(--success-500); display: flex; align-items: center; justify-content: center;
        }
        .cp-success-title { font-size: var(--text-xl); font-weight: 700; color: var(--text-primary); margin: 0; }
        .cp-success-sub { font-size: var(--text-sm); color: var(--text-secondary); margin: 0; }
        .cp-side::after {
          content: ''; position: absolute; top: 0; left: 0; right: 0; height: 3px;
          background: var(--cchc-accent-line);
        }
        /* ── Responsive ── */
        @media (max-width: 768px) {
          .cp-side { display: none; }
          .cp-stepper-mobile { display: block; }
          .cp-main { padding: var(--space-6) var(--space-4); align-items: flex-start; }
        }
      `}</style>
    </div>
  );
}
