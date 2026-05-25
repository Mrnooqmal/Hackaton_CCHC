import { useEffect, useState } from 'react';
import { FiCheckCircle, FiAlertCircle, FiAlertTriangle, FiInfo, FiX } from 'react-icons/fi';

export type AlertVariant = 'success' | 'error' | 'warning' | 'info';

export interface AlertBannerProps {
    /** The message to display */
    message: string;
    /** Visual style variant */
    variant: AlertVariant;
    /** Called when the alert is dismissed (via X or auto-dismiss) */
    onDismiss?: () => void;
    /** Auto-dismiss after this many milliseconds. Defaults to 6000 for errors, 0 (no auto) for others. Set 0 to disable. */
    autoDismissMs?: number;
    /** Optional children for rich content below the message */
    children?: React.ReactNode;
    /** Extra CSS class */
    className?: string;
}

const VARIANT_CONFIG: Record<AlertVariant, {
    icon: React.ReactNode;
    accentColor: string;
    bgColor: string;
    borderColor: string;
    label: string;
}> = {
    success: {
        icon: <FiCheckCircle size={20} />,
        accentColor: 'var(--success-500)',
        bgColor: 'rgba(34, 197, 94, 0.08)',
        borderColor: 'rgba(34, 197, 94, 0.25)',
        label: 'Éxito',
    },
    error: {
        icon: <FiAlertCircle size={20} />,
        accentColor: 'var(--danger-500)',
        bgColor: 'rgba(244, 67, 54, 0.08)',
        borderColor: 'rgba(244, 67, 54, 0.25)',
        label: 'Error',
    },
    warning: {
        icon: <FiAlertTriangle size={20} />,
        accentColor: 'var(--warning-500)',
        bgColor: 'rgba(234, 179, 8, 0.08)',
        borderColor: 'rgba(234, 179, 8, 0.25)',
        label: 'Atención',
    },
    info: {
        icon: <FiInfo size={20} />,
        accentColor: 'var(--info-500)',
        bgColor: 'rgba(59, 130, 246, 0.08)',
        borderColor: 'rgba(59, 130, 246, 0.25)',
        label: 'Info',
    },
};

export default function AlertBanner({
    message,
    variant,
    onDismiss,
    autoDismissMs,
    children,
    className = '',
}: AlertBannerProps) {
    const [exiting, setExiting] = useState(false);
    const config = VARIANT_CONFIG[variant];

    // Determine auto-dismiss: errors auto-dismiss by default (6s), others don't unless specified
    const effectiveDuration =
        autoDismissMs !== undefined
            ? autoDismissMs
            : variant === 'error'
              ? 6000
              : 0;

    useEffect(() => {
        if (effectiveDuration <= 0 || !onDismiss) return;
        const timer = setTimeout(() => {
            setExiting(true);
            setTimeout(() => onDismiss(), 300);
        }, effectiveDuration);
        return () => clearTimeout(timer);
    }, [effectiveDuration, onDismiss]);

    const handleDismiss = () => {
        setExiting(true);
        setTimeout(() => onDismiss?.(), 300);
    };

    return (
        <div
            className={`alert-banner ${exiting ? 'alert-banner--exit' : ''} ${className}`}
            style={{
                '--alert-accent': config.accentColor,
                '--alert-bg': config.bgColor,
                '--alert-border': config.borderColor,
            } as React.CSSProperties}
            role="alert"
        >
            <div className="alert-banner__accent" />
            <div className="alert-banner__icon">{config.icon}</div>
            <div className="alert-banner__body">
                <p className="alert-banner__message">{message}</p>
                {children && <div className="alert-banner__content">{children}</div>}
            </div>
            {onDismiss && (
                <button
                    className="alert-banner__close"
                    onClick={handleDismiss}
                    aria-label="Cerrar alerta"
                    type="button"
                >
                    <FiX size={16} />
                </button>
            )}
        </div>
    );
}
