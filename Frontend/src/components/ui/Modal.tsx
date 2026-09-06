import { useEffect, useCallback, useRef } from 'react';
import type { ReactNode, MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { FiX } from 'react-icons/fi';

/* ------------------------------------------------------------------ */
/*  Tamanhos predefinidos                                              */
/* ------------------------------------------------------------------ */
// `sm` queda reservado para la entrada de PIN de firma (el único modal que
// debe permanecer angosto); todo lo demás usa más del ancho disponible.
const SIZE_MAP = {
    sm: '400px',
    md: '520px',
    lg: '960px',
    xl: '1400px',
} as const;

export type ModalSize = keyof typeof SIZE_MAP;

/** Modales abiertos, del más antiguo al de más arriba. Ver el efecto que la mantiene. */
const pilaModales: symbol[] = [];

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
    const id = useRef<symbol>(undefined as unknown as symbol);
    if (!id.current) id.current = Symbol('modal');

    /* ----- Pila de modales abiertos ----- */
    // Un modal puede abrirse sobre otro (una vista previa sobre un formulario).
    // Sin la pila, Escape cerraba TODOS los modales abiertos a la vez y se perdía
    // lo que el usuario estuviera editando debajo; y cerrar el de arriba
    // devolvía el scroll al body con el de abajo todavía abierto.
    useEffect(() => {
        if (!isOpen) return;
        const propio = id.current;
        pilaModales.push(propio);
        document.body.style.overflow = 'hidden';

        return () => {
            const i = pilaModales.indexOf(propio);
            if (i !== -1) pilaModales.splice(i, 1);
            if (pilaModales.length === 0) document.body.style.overflow = '';
        };
    }, [isOpen]);

    /* ----- Cerrar con Escape (solo el modal de más arriba) ----- */
    const handleKeyDown = useCallback(
        (e: KeyboardEvent) => {
            if (e.key !== 'Escape' || preventClose) return;
            if (pilaModales[pilaModales.length - 1] !== id.current) return;
            onClose();
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
