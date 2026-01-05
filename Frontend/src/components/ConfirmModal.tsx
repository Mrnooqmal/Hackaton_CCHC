import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { FiAlertTriangle } from 'react-icons/fi';

interface ConfirmModalProps {
    isOpen: boolean;
    title: string;
    message: string;
    confirmLabel?: string;
    cancelLabel?: string;
    onConfirm: () => void;
    onCancel: () => void;
    variant?: 'danger' | 'warning' | 'primary';
}

export default function ConfirmModal({
    isOpen,
    title,
    message,
    confirmLabel = 'Confirmar',
    cancelLabel = 'Cancelar',
    onConfirm,
    onCancel,
    variant = 'primary'
}: ConfirmModalProps) {
    // Lock body scroll when modal is open
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

    if (!isOpen) return null;

    const getVariantClass = () => {
        switch (variant) {
            case 'danger': return 'btn-danger';
            case 'warning': return 'btn-warning';
            default: return 'btn-primary';
        }
    };

    const getIconColor = () => {
        switch (variant) {
            case 'danger': return 'text-danger-500';
            case 'warning': return 'text-warning-500';
            default: return 'text-primary-500';
        }
    };

    const modalContent = (
        <div className="confirm-modal-overlay" onClick={onCancel}>
            <div className="confirm-modal-container" onClick={(e) => e.stopPropagation()}>
                <div className="confirm-modal-body">
                    <div className={`confirm-modal-icon ${getIconColor()}`}>
                        <FiAlertTriangle size={32} />
                    </div>
                    <h2 className="confirm-modal-title">{title}</h2>
                    <p className="confirm-modal-message">{message}</p>
                </div>
                <div className="confirm-modal-actions">
                    <button type="button" className="btn btn-secondary" onClick={onCancel}>
                        {cancelLabel}
                    </button>
                    <button type="button" className={`btn ${getVariantClass()}`} onClick={onConfirm}>
                        {confirmLabel}
                    </button>
                </div>

                <style>{`
                    .confirm-modal-overlay {
                        position: fixed;
                        top: 0;
                        left: 0;
                        right: 0;
                        bottom: 0;
                        background: rgba(0, 0, 0, 0.7);
                        backdrop-filter: blur(4px);
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        z-index: 9999999;
                        padding: var(--space-4);
                    }
                    .confirm-modal-container {
                        background: var(--surface-card);
                        border: 1px solid var(--surface-border);
                        border-radius: var(--radius-xl);
                        max-width: 400px;
                        width: 100%;
                        padding: var(--space-8) var(--space-6) var(--space-6);
                        box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
                        position: relative;
                        z-index: 10000000;
                    }
                    .confirm-modal-body {
                        text-align: center;
                    }
                    .confirm-modal-icon {
                        margin-bottom: var(--space-4);
                        display: flex;
                        justify-content: center;
                    }
                    .confirm-modal-title {
                        font-size: var(--text-2xl);
                        font-weight: 700;
                        margin-bottom: var(--space-2);
                        color: var(--text-primary);
                    }
                    .confirm-modal-message {
                        color: var(--text-secondary);
                        line-height: 1.5;
                        margin-bottom: var(--space-8);
                    }
                    .confirm-modal-actions {
                        display: flex;
                        gap: var(--space-4);
                    }
                    .confirm-modal-actions .btn {
                        flex: 1;
                    }
                `}</style>
            </div>
        </div>
    );

    // Use Portal to render modal at document.body level
    // This escapes the stacking context of the Header
    return createPortal(modalContent, document.body);
}
