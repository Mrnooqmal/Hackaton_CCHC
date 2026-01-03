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

    return (
        <div className="modal-overlay" onClick={onCancel}>
            <div className="modal-content confirm-modal" onClick={(e) => e.stopPropagation()}>
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
                    .confirm-modal {
                        max-width: 400px;
                        padding: var(--space-8) var(--space-6) var(--space-6);
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
}
