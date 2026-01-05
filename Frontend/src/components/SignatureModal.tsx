import { useState } from 'react';
import { createPortal } from 'react-dom';
import PinInput from './PinInput';
import { FiShield, FiX, FiFileText, FiCheckSquare, FiClipboard, FiCalendar } from 'react-icons/fi';

export type SignatureType = 'document' | 'survey' | 'activity' | 'signature-request' | 'generic';

interface SignatureModalProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: (pin: string) => Promise<void>;
    type?: SignatureType;
    title?: string;
    itemName?: string;
    description?: string;
    loading?: boolean;
    error?: string;
}

const typeConfig: Record<SignatureType, { icon: React.ReactNode; label: string; color: string }> = {
    document: { icon: <FiFileText size={24} />, label: 'Documento', color: 'var(--info-500)' },
    survey: { icon: <FiClipboard size={24} />, label: 'Encuesta', color: 'var(--success-500)' },
    activity: { icon: <FiCalendar size={24} />, label: 'Actividad', color: 'var(--accent-500)' },
    'signature-request': { icon: <FiCheckSquare size={24} />, label: 'Solicitud de Firma', color: 'var(--warning-500)' },
    generic: { icon: <FiShield size={24} />, label: 'Cumplimiento', color: 'var(--primary-500)' },
};

export default function SignatureModal({
    isOpen,
    onClose,
    onConfirm,
    type = 'generic',
    title,
    itemName,
    description,
    loading = false,
    error,
}: SignatureModalProps) {
    const [isProcessing, setIsProcessing] = useState(false);
    const [pinError, setPinError] = useState('');

    const config = typeConfig[type];

    const handlePinComplete = async (pin: string) => {
        setIsProcessing(true);
        setPinError('');

        try {
            await onConfirm(pin);
        } catch (err) {
            setPinError(err instanceof Error ? err.message : 'Error al validar PIN');
        } finally {
            setIsProcessing(false);
        }
    };

    const handleClose = () => {
        if (!isProcessing && !loading) {
            setPinError('');
            onClose();
        }
    };

    if (!isOpen) return null;

    const modalContent = (
        <div className="signature-modal-overlay" onClick={handleClose}>
            <div className="signature-modal" onClick={(e) => e.stopPropagation()}>
                {/* Close button */}
                <button className="signature-modal-close" onClick={handleClose} disabled={isProcessing || loading}>
                    <FiX size={20} />
                </button>

                {/* Header with gradient background */}
                <div className="signature-modal-header">
                    <div className="signature-modal-bg-gradient"></div>
                    <div className="signature-modal-icon" style={{ background: config.color }}>
                        {config.icon}
                    </div>
                    <h2 className="signature-modal-title">
                        {title || `Firmar ${config.label}`}
                    </h2>
                    {itemName && (
                        <p className="signature-modal-item-name">{itemName}</p>
                    )}
                </div>

                {/* Description */}
                {description && (
                    <div className="signature-modal-description">
                        <p>{description}</p>
                    </div>
                )}

                {/* Info box */}
                <div className="signature-modal-info">
                    <FiShield className="signature-modal-info-icon" />
                    <div>
                        <strong>Firma Digital</strong>
                        <p>Tu PIN valida legalmente que has revisado y aceptas este {config.label.toLowerCase()}</p>
                    </div>
                </div>

                {/* PIN Input */}
                <div className="signature-modal-pin-wrapper">
                    <PinInput
                        mode="verify"
                        title="Ingresa tu PIN de 4 dígitos"
                        subtitle="Este PIN fue creado durante tu enrolamiento"
                        onComplete={handlePinComplete}
                        error={error || pinError}
                        disabled={isProcessing || loading}
                    />
                </div>

                {/* Processing indicator */}
                {(isProcessing || loading) && (
                    <div className="signature-modal-processing">
                        <div className="spinner"></div>
                        <span>Procesando firma...</span>
                    </div>
                )}

                <style>{`
                    .signature-modal-overlay {
                        position: fixed;
                        inset: 0;
                        background: rgba(0, 0, 0, 0.7);
                        backdrop-filter: blur(4px);
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        z-index: 999999;
                        padding: var(--space-4);
                    }

                    .signature-modal {
                        position: relative;
                        width: 100%;
                        max-width: 420px;
                        background: #1a1a2e;
                        border-radius: var(--radius-xl);
                        border: 1px solid rgba(255, 255, 255, 0.1);
                        box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.7);
                        overflow: hidden;
                        animation: signatureModalSlideIn 0.3s ease;
                    }

                    @keyframes signatureModalSlideIn {
                        from {
                            opacity: 0;
                            transform: scale(0.95) translateY(-20px);
                        }
                        to {
                            opacity: 1;
                            transform: scale(1) translateY(0);
                        }
                    }

                    .signature-modal-close {
                        position: absolute;
                        top: var(--space-3);
                        right: var(--space-3);
                        background: rgba(255, 255, 255, 0.1);
                        border: none;
                        color: white;
                        width: 36px;
                        height: 36px;
                        border-radius: var(--radius-full);
                        cursor: pointer;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        transition: all 0.2s;
                        z-index: 10;
                    }

                    .signature-modal-close:hover {
                        background: rgba(255, 255, 255, 0.2);
                    }

                    .signature-modal-close:disabled {
                        opacity: 0.5;
                        cursor: not-allowed;
                    }

                    .signature-modal-header {
                        position: relative;
                        padding: var(--space-8) var(--space-6) var(--space-6);
                        text-align: center;
                        background: linear-gradient(135deg, var(--primary-600), var(--primary-700));
                        overflow: hidden;
                    }

                    .signature-modal-bg-gradient {
                        position: absolute;
                        inset: 0;
                        background: radial-gradient(circle at 30% 20%, rgba(255,255,255,0.1) 0%, transparent 50%),
                                    radial-gradient(circle at 70% 80%, rgba(255,255,255,0.05) 0%, transparent 50%);
                    }

                    .signature-modal-icon {
                        position: relative;
                        width: 64px;
                        height: 64px;
                        border-radius: var(--radius-full);
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        color: white;
                        margin: 0 auto var(--space-4);
                        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
                    }

                    .signature-modal-title {
                        position: relative;
                        color: white;
                        font-size: var(--text-xl);
                        font-weight: 600;
                        margin: 0 0 var(--space-2);
                    }

                    .signature-modal-item-name {
                        position: relative;
                        color: rgba(255, 255, 255, 0.85);
                        font-size: var(--text-sm);
                        margin: 0;
                        max-width: 300px;
                        margin: 0 auto;
                        white-space: nowrap;
                        overflow: hidden;
                        text-overflow: ellipsis;
                    }

                    .signature-modal-description {
                        padding: var(--space-4) var(--space-6);
                        background: #16162a;
                        border-bottom: 1px solid rgba(255, 255, 255, 0.1);
                    }

                    .signature-modal-description p {
                        margin: 0;
                        color: var(--text-secondary);
                        font-size: var(--text-sm);
                        text-align: center;
                    }

                    .signature-modal-info {
                        display: flex;
                        align-items: flex-start;
                        gap: var(--space-3);
                        padding: var(--space-4) var(--space-6);
                        background: #16162a;
                        margin: var(--space-4) var(--space-6) 0;
                        border-radius: var(--radius-lg);
                        border: 1px solid rgba(255, 255, 255, 0.1);
                    }

                    .signature-modal-info-icon {
                        color: var(--primary-500);
                        flex-shrink: 0;
                        margin-top: 2px;
                    }

                    .signature-modal-info strong {
                        color: var(--text-primary);
                        font-size: var(--text-sm);
                        display: block;
                        margin-bottom: 2px;
                    }

                    .signature-modal-info p {
                        margin: 0;
                        color: var(--text-muted);
                        font-size: var(--text-xs);
                    }

                    .signature-modal-pin-wrapper {
                        padding: var(--space-6);
                    }

                    .signature-modal-pin-wrapper .pin-input-container {
                        background: transparent;
                        border: none;
                        padding: 0;
                    }

                    .signature-modal-pin-wrapper .pin-digit {
                        background: #0f0f1a;
                        border-color: rgba(255, 255, 255, 0.2);
                    }

                    .signature-modal-pin-wrapper .pin-digit:focus {
                        border-color: var(--primary-500);
                    }

                    .signature-modal-pin-wrapper .pin-digit.filled {
                        background: #16162a;
                        border-color: var(--primary-400);
                    }

                    .signature-modal-processing {
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        gap: var(--space-3);
                        padding: var(--space-4) var(--space-6) var(--space-6);
                        color: var(--text-muted);
                        font-size: var(--text-sm);
                    }

                    .signature-modal-processing .spinner {
                        width: 20px;
                        height: 20px;
                    }
                `}</style>
            </div>
        </div>
    );

    return createPortal(modalContent, document.body);
}
