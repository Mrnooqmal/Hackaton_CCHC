import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { FiCheck, FiX, FiAlertTriangle, FiInfo } from 'react-icons/fi';

/* ------------------------------------------------------------------ */
/*  Tipos                                                              */
/* ------------------------------------------------------------------ */
type ToastVariant = 'success' | 'error' | 'warning' | 'info';

interface ToastItem {
    id: string;
    message: string;
    variant: ToastVariant;
}

interface ToastProps {
    toasts: ToastItem[];
    onRemove: (id: string) => void;
    /** Milisegundos antes de auto-dismiss (default: 4000) */
    duration?: number;
}

/* ------------------------------------------------------------------ */
/*  Configuracion por variante                                         */
/* ------------------------------------------------------------------ */
const VARIANT_CONFIG: Record<ToastVariant, { icon: React.ReactNode; bg: string; border: string }> = {
    success: {
        icon: <FiCheck size={18} />,
        bg: 'rgba(34, 197, 94, 0.15)',
        border: 'var(--success-500)',
    },
    error: {
        icon: <FiX size={18} />,
        bg: 'rgba(244, 67, 54, 0.15)',
        border: 'var(--danger-500)',
    },
    warning: {
        icon: <FiAlertTriangle size={18} />,
        bg: 'rgba(234, 179, 8, 0.15)',
        border: 'var(--warning-500)',
    },
    info: {
        icon: <FiInfo size={18} />,
        bg: 'rgba(59, 130, 246, 0.15)',
        border: 'var(--info-500)',
    },
};

/* ------------------------------------------------------------------ */
/*  Componente individual                                              */
/* ------------------------------------------------------------------ */
function ToastItem({
    item,
    onRemove,
    duration = 4000,
}: {
    item: ToastItem;
    onRemove: (id: string) => void;
    duration: number;
}) {
    useEffect(() => {
        const timer = setTimeout(() => onRemove(item.id), duration);
        return () => clearTimeout(timer);
    }, [item.id, onRemove, duration]);

    const config = VARIANT_CONFIG[item.variant];

    return (
        <div
            className="ui-toast"
            style={{
                background: config.bg,
                borderLeft: `3px solid ${config.border}`,
            }}
        >
            <span className="ui-toast-icon" style={{ color: config.border }}>
                {config.icon}
            </span>
            <span className="ui-toast-message">{item.message}</span>
            <button
                className="ui-toast-close"
                onClick={() => onRemove(item.id)}
                aria-label="Cerrar notificacion"
            >
                <FiX size={14} />
            </button>
        </div>
    );
}

/* ------------------------------------------------------------------ */
/*  Contenedor de Toasts                                               */
/* ------------------------------------------------------------------ */
export default function Toast({ toasts, onRemove, duration = 4000 }: ToastProps) {
    if (toasts.length === 0) return null;

    return createPortal(
        <div className="ui-toast-container">
            {toasts.map((t) => (
                <ToastItem key={t.id} item={t} onRemove={onRemove} duration={duration} />
            ))}
        </div>,
        document.body,
    );
}
