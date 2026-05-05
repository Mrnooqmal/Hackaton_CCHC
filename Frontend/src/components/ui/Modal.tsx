import { useEffect, useCallback } from 'react';
import type { ReactNode, MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { FiX } from 'react-icons/fi';

/* ------------------------------------------------------------------ */
/*  Tamanhos predefinidos                                              */
/* ------------------------------------------------------------------ */
const SIZE_MAP = {
    sm: '400px',
    md: '500px',
    lg: '800px',
    xl: '1200px',
} as const;

export type ModalSize = keyof typeof SIZE_MAP;

/* ------------------------------------------------------------------ */
/*  Props                                                              */
/* ------------------------------------------------------------------ */
export interface ModalProps {
    /** Controla la visibilidad del modal */
    isOpen: boolean;
    /** Callback al cerrar (overlay, boton X, Escape) */
    onClose: () => void;
    /** Titulo mostrado en el header */
    title: string;
    /** Subtitulo opcional bajo el titulo */
    subtitle?: string;
    /** Icono opcional a la izquierda del titulo */
    icon?: ReactNode;
    /** Ancho maximo del modal */
    size?: ModalSize;
    /** Contenido del body */
    children: ReactNode;
    /** Contenido del footer (botones de accion) */
    footer?: ReactNode;
    /** Cerrar al hacer clic en el overlay (default: true) */
    closeOnOverlay?: boolean;
    /** Deshabilita todo cierre (para procesos en curso) */
    preventClose?: boolean;
}

/* ------------------------------------------------------------------ */
/*  Componente                                                         */
/* ------------------------------------------------------------------ */
export default function Modal({
    isOpen,
    onClose,
    title,
    subtitle,
    icon,
    size = 'md',
    children,
    footer,
    closeOnOverlay = true,
    preventClose = false,
}: ModalProps) {
    /* ----- Bloquear scroll del body ----- */
    useEffect(() => {
        if (isOpen) {
            document.body.style.overflow = 'hidden';
        } else {
            document.body.style.overflow = '';
        }
        return () => {
            document.body.style.overflow = '';
        };
    }, [isOpen]);

    /* ----- Cerrar con Escape ----- */
    const handleKeyDown = useCallback(
        (e: KeyboardEvent) => {
            if (e.key === 'Escape' && !preventClose) {
                onClose();
            }
        },
        [onClose, preventClose],
    );

    useEffect(() => {
        if (isOpen) {
            document.addEventListener('keydown', handleKeyDown);
        }
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, handleKeyDown]);

    if (!isOpen) return null;

    const handleOverlayClick = (e: MouseEvent) => {
        if (closeOnOverlay && !preventClose && e.target === e.currentTarget) {
            onClose();
        }
    };

    const handleCloseClick = () => {
        if (!preventClose) onClose();
    };

    const modalContent = (
        <div className="modal-overlay" onClick={handleOverlayClick}>
            <div
                className="modal"
                style={{ maxWidth: SIZE_MAP[size] }}
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="modal-header">
                    <div className="modal-header-left">
                        {icon && <div className="modal-header-icon">{icon}</div>}
                        <div>
                            <h2 className="modal-title">{title}</h2>
                            {subtitle && <p className="modal-subtitle">{subtitle}</p>}
                        </div>
                    </div>
                    <button
                        type="button"
                        className="btn btn-ghost btn-icon"
                        onClick={handleCloseClick}
                        disabled={preventClose}
                        aria-label="Cerrar modal"
                    >
                        <FiX size={20} />
                    </button>
                </div>

                {/* Body */}
                <div className="modal-body">{children}</div>

                {/* Footer */}
                {footer && <div className="modal-footer">{footer}</div>}
            </div>
        </div>
    );

    return createPortal(modalContent, document.body);
}
