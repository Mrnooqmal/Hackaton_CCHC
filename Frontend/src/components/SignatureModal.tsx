import { useState } from 'react';
import { FiX, FiFileText, FiUser, FiCalendar, FiClock, FiAlertTriangle } from 'react-icons/fi';
import PinInput from './PinInput';

interface SignatureData {
    tipoFirma: 'enrolamiento' | 'documento' | 'actividad' | 'capacitacion';
    titulo: string;
    descripcion?: string;
    referenciaId?: string;
    referenciaTipo?: string;
}

interface WorkerData {
    workerId: string;
    nombre: string;
    apellido?: string;
    rut: string;
}

interface SignatureModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSign: (pin: string) => Promise<void>;
    onDispute?: (motivo: string) => void;
    signatureData: SignatureData;
    workerData: WorkerData;
    loading?: boolean;
    error?: string;
}

export default function SignatureModal({
    isOpen,
    onClose,
    onSign,
    onDispute,
    signatureData,
    workerData,
    loading = false,
    error,
}: SignatureModalProps) {
    const [showDispute, setShowDispute] = useState(false);
    const [disputeMotivo, setDisputeMotivo] = useState('');
    const [pinError, setPinError] = useState<string | undefined>(error);
    const [isSubmitting, setIsSubmitting] = useState(false);

    const now = new Date();
    const fecha = now.toLocaleDateString('es-CL', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
    });
    const hora = now.toLocaleTimeString('es-CL', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
    });

    const handlePinComplete = async (pin: string) => {
        setPinError(undefined);
        setIsSubmitting(true);
        try {
            await onSign(pin);
        } catch (err: any) {
            setPinError(err.message || 'Error al procesar la firma');
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleDispute = () => {
        if (onDispute && disputeMotivo.trim()) {
            onDispute(disputeMotivo.trim());
            setShowDispute(false);
            setDisputeMotivo('');
        }
    };

    const getTipoFirmaLabel = () => {
        switch (signatureData.tipoFirma) {
            case 'enrolamiento':
                return 'Firma de Enrolamiento';
            case 'documento':
                return 'Firma de Documento';
            case 'actividad':
                return 'Firma de Actividad';
            case 'capacitacion':
                return 'Firma de Capacitación';
            default:
                return 'Firma Digital';
        }
    };

    if (!isOpen) return null;

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content signature-modal" onClick={(e) => e.stopPropagation()}>
                <button className="modal-close" onClick={onClose} disabled={loading || isSubmitting}>
                    <FiX size={20} />
                </button>

                <div className="modal-header">
                    <div className="modal-icon">
                        <FiFileText size={28} />
                    </div>
                    <h2 className="modal-title">{getTipoFirmaLabel()}</h2>
                    <p className="modal-subtitle">{signatureData.titulo}</p>
                </div>

                {signatureData.descripcion && (
                    <div className="signature-description">
                        {signatureData.descripcion}
                    </div>
                )}

                {/* Datos de la firma según DS 44 */}
                <div className="signature-details">
                    <div className="signature-detail-row">
                        <FiUser size={16} />
                        <span className="detail-label">Firmante:</span>
                        <span className="detail-value">
                            {workerData.nombre} {workerData.apellido || ''}
                        </span>
                    </div>
                    <div className="signature-detail-row">
                        <FiUser size={16} />
                        <span className="detail-label">RUT:</span>
                        <span className="detail-value">{workerData.rut}</span>
                    </div>
                    <div className="signature-detail-row">
                        <FiCalendar size={16} />
                        <span className="detail-label">Fecha:</span>
                        <span className="detail-value">{fecha}</span>
                    </div>
                    <div className="signature-detail-row">
                        <FiClock size={16} />
                        <span className="detail-label">Hora:</span>
                        <span className="detail-value">{hora}</span>
                    </div>
                </div>

                {/* Disclaimer legal */}
                <div className="signature-disclaimer">
                    Al ingresar su PIN, usted declara que ha leído y comprendido el contenido
                    del documento y acepta firmarlo digitalmente. Esta firma tiene validez
                    legal según la normativa vigente.
                </div>

                {!showDispute ? (
                    <>
                        <PinInput
                            onComplete={handlePinComplete}
                            mode="verify"
                            error={pinError || error}
                            disabled={loading || isSubmitting}
                            title="Ingrese su PIN para firmar"
                            subtitle="PIN de 4 dígitos"
                        />

                        {onDispute && (
                            <button
                                type="button"
                                className="btn-link dispute-link"
                                onClick={() => setShowDispute(true)}
                                disabled={loading || isSubmitting}
                            >
                                <FiAlertTriangle size={14} />
                                Reportar un problema con esta firma
                            </button>
                        )}
                    </>
                ) : (
                    <div className="dispute-form">
                        <h3 className="dispute-title">
                            <FiAlertTriangle size={18} />
                            Reportar problema
                        </h3>
                        <p className="dispute-info">
                            Si hay algún problema con esta firma o los datos mostrados no son
                            correctos, puede reportarlo para revisión por un administrador.
                        </p>
                        <textarea
                            className="form-input"
                            placeholder="Describa el motivo del reporte..."
                            value={disputeMotivo}
                            onChange={(e) => setDisputeMotivo(e.target.value)}
                            rows={3}
                        />
                        <div className="dispute-actions">
                            <button
                                type="button"
                                className="btn btn-secondary"
                                onClick={() => setShowDispute(false)}
                            >
                                Cancelar
                            </button>
                            <button
                                type="button"
                                className="btn btn-warning"
                                onClick={handleDispute}
                                disabled={!disputeMotivo.trim()}
                            >
                                Enviar Reporte
                            </button>
                        </div>
                    </div>
                )}

                <style>{`
                    .modal-overlay {
                        position: fixed;
                        top: 0;
                        left: 0;
                        right: 0;
                        bottom: 0;
                        background: rgba(0, 0, 0, 0.6);
                        backdrop-filter: blur(4px);
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        z-index: 1000;
                        padding: var(--space-4);
                    }

                    .modal-content {
                        background: var(--surface-base);
                        border-radius: var(--radius-xl);
                        width: 100%;
                        max-width: 480px;
                        max-height: 90vh;
                        overflow-y: auto;
                        position: relative;
                        box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
                        animation: modalSlideIn 0.3s ease;
                    }

                    @keyframes modalSlideIn {
                        from {
                            opacity: 0;
                            transform: translateY(-20px) scale(0.95);
                        }
                        to {
                            opacity: 1;
                            transform: translateY(0) scale(1);
                        }
                    }

                    .modal-close {
                        position: absolute;
                        top: var(--space-4);
                        right: var(--space-4);
                        background: var(--surface-elevated);
                        border: 1px solid var(--surface-border);
                        border-radius: var(--radius-full);
                        width: 36px;
                        height: 36px;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        cursor: pointer;
                        color: var(--text-muted);
                        transition: all 0.2s ease;
                    }

                    .modal-close:hover {
                        background: var(--surface-hover);
                        color: var(--text-primary);
                    }

                    .modal-header {
                        text-align: center;
                        padding: var(--space-8) var(--space-6) var(--space-4);
                    }

                    .modal-icon {
                        width: 64px;
                        height: 64px;
                        background: linear-gradient(135deg, var(--primary-500), var(--primary-600));
                        border-radius: var(--radius-xl);
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        margin: 0 auto var(--space-4);
                        color: white;
                        box-shadow: 0 8px 20px rgba(59, 130, 246, 0.3);
                    }

                    .modal-title {
                        font-size: var(--text-xl);
                        font-weight: 600;
                        color: var(--text-primary);
                        margin: 0 0 var(--space-2);
                    }

                    .modal-subtitle {
                        font-size: var(--text-base);
                        color: var(--text-muted);
                        margin: 0;
                    }

                    .signature-description {
                        background: var(--surface-elevated);
                        padding: var(--space-4);
                        margin: 0 var(--space-6) var(--space-4);
                        border-radius: var(--radius-md);
                        font-size: var(--text-sm);
                        color: var(--text-secondary);
                        border-left: 3px solid var(--primary-500);
                    }

                    .signature-details {
                        background: var(--surface-elevated);
                        margin: 0 var(--space-6) var(--space-4);
                        border-radius: var(--radius-md);
                        padding: var(--space-4);
                        display: flex;
                        flex-direction: column;
                        gap: var(--space-3);
                    }

                    .signature-detail-row {
                        display: flex;
                        align-items: center;
                        gap: var(--space-3);
                        font-size: var(--text-sm);
                    }

                    .signature-detail-row svg {
                        color: var(--primary-500);
                        flex-shrink: 0;
                    }

                    .detail-label {
                        color: var(--text-muted);
                        min-width: 80px;
                    }

                    .detail-value {
                        color: var(--text-primary);
                        font-weight: 500;
                    }

                    .signature-disclaimer {
                        margin: 0 var(--space-6) var(--space-4);
                        padding: var(--space-3);
                        background: rgba(245, 158, 11, 0.1);
                        border: 1px solid rgba(245, 158, 11, 0.3);
                        border-radius: var(--radius-md);
                        font-size: var(--text-xs);
                        color: var(--warning-600);
                        line-height: 1.5;
                    }

                    .signature-modal .pin-input-container {
                        margin: 0 var(--space-6);
                        border: none;
                        background: transparent;
                        padding: var(--space-4) 0;
                    }

                    .dispute-link {
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        gap: var(--space-2);
                        color: var(--text-muted);
                        font-size: var(--text-sm);
                        padding: var(--space-4) var(--space-6) var(--space-6);
                        background: none;
                        border: none;
                        cursor: pointer;
                        transition: color 0.2s ease;
                    }

                    .dispute-link:hover {
                        color: var(--warning-500);
                    }

                    .dispute-form {
                        padding: var(--space-4) var(--space-6) var(--space-6);
                    }

                    .dispute-title {
                        display: flex;
                        align-items: center;
                        gap: var(--space-2);
                        color: var(--warning-500);
                        font-size: var(--text-lg);
                        margin: 0 0 var(--space-3);
                    }

                    .dispute-info {
                        font-size: var(--text-sm);
                        color: var(--text-muted);
                        margin: 0 0 var(--space-4);
                    }

                    .dispute-form textarea {
                        width: 100%;
                        resize: none;
                    }

                    .dispute-actions {
                        display: flex;
                        gap: var(--space-3);
                        margin-top: var(--space-4);
                    }

                    .dispute-actions .btn {
                        flex: 1;
                    }

                    .btn-warning {
                        background: var(--warning-500);
                        color: white;
                    }

                    .btn-warning:hover {
                        background: var(--warning-600);
                    }
                `}</style>
            </div>
        </div>
    );
}
