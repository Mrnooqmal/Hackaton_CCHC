import { useRef, useState, useEffect } from 'react';
import { FiLock, FiEye, FiEyeOff, FiAlertCircle, FiCheck } from 'react-icons/fi';

interface PinInputProps {
    onComplete: (pin: string) => void;
    onError?: () => void;
    mode?: 'create' | 'verify' | 'confirm';
    title?: string;
    subtitle?: string;
    error?: string;
    disabled?: boolean;
    showToggle?: boolean;
}

export default function PinInput({
    onComplete,
    onError,
    mode = 'verify',
    title,
    subtitle,
    error,
    disabled = false,
    showToggle = true,
}: PinInputProps) {
    const [pin, setPin] = useState(['', '', '', '']);
    const [showPin, setShowPin] = useState(false);
    const [isComplete, setIsComplete] = useState(false);
    const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

    // Focus first input on mount
    useEffect(() => {
        if (!disabled) {
            inputRefs.current[0]?.focus();
        }
    }, [disabled]);

    // Reset cuando cambia el error
    useEffect(() => {
        if (error) {
            setPin(['', '', '', '']);
            setIsComplete(false);
            inputRefs.current[0]?.focus();
        }
    }, [error]);

    const handleChange = (index: number, value: string) => {
        if (disabled || isComplete) return;

        // Solo permitir dígitos
        const digit = value.replace(/\D/g, '').slice(-1);

        const newPin = [...pin];
        newPin[index] = digit;
        setPin(newPin);

        // Auto-focus al siguiente campo
        if (digit && index < 3) {
            inputRefs.current[index + 1]?.focus();
        }

        // Verificar si está completo
        if (digit && index === 3) {
            const completePin = newPin.join('');
            if (completePin.length === 4) {
                setIsComplete(true);
                onComplete(completePin);
            }
        }
    };

    const handleKeyDown = (index: number, e: React.KeyboardEvent) => {
        if (disabled || isComplete) return;

        // Backspace: borrar y mover al anterior
        if (e.key === 'Backspace') {
            if (!pin[index] && index > 0) {
                inputRefs.current[index - 1]?.focus();
                const newPin = [...pin];
                newPin[index - 1] = '';
                setPin(newPin);
            }
        }

        // Arrow keys navigation
        if (e.key === 'ArrowLeft' && index > 0) {
            inputRefs.current[index - 1]?.focus();
        }
        if (e.key === 'ArrowRight' && index < 3) {
            inputRefs.current[index + 1]?.focus();
        }
    };

    const handlePaste = (e: React.ClipboardEvent) => {
        if (disabled || isComplete) return;

        e.preventDefault();
        const pastedData = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 4);

        if (pastedData.length === 4) {
            const newPin = pastedData.split('');
            setPin(newPin);
            setIsComplete(true);
            onComplete(pastedData);
        }
    };

    const clearPin = () => {
        setPin(['', '', '', '']);
        setIsComplete(false);
        inputRefs.current[0]?.focus();
    };

    const getTitle = () => {
        if (title) return title;
        switch (mode) {
            case 'create':
                return 'Crear PIN de 4 dígitos';
            case 'confirm':
                return 'Confirmar PIN';
            case 'verify':
            default:
                return 'Ingrese su PIN';
        }
    };

    const getSubtitle = () => {
        if (subtitle) return subtitle;
        switch (mode) {
            case 'create':
                return 'Este PIN será usado para firmar documentos';
            case 'confirm':
                return 'Ingrese nuevamente el PIN para confirmar';
            case 'verify':
            default:
                return 'Ingrese su PIN de 4 dígitos para continuar';
        }
    };

    return (
        <div className="pin-input-container">
            <div className="pin-header">
                <div className="pin-icon">
                    <FiLock size={24} />
                </div>
                <h3 className="pin-title">{getTitle()}</h3>
                <p className="pin-subtitle">{getSubtitle()}</p>
            </div>

            <div className="pin-inputs">
                {pin.map((digit, index) => (
                    <input
                        key={index}
                        ref={(el) => (inputRefs.current[index] = el)}
                        type={showPin ? 'text' : 'password'}
                        inputMode="numeric"
                        pattern="[0-9]*"
                        maxLength={1}
                        value={digit}
                        onChange={(e) => handleChange(index, e.target.value)}
                        onKeyDown={(e) => handleKeyDown(index, e)}
                        onPaste={handlePaste}
                        disabled={disabled || isComplete}
                        className={`pin-digit ${digit ? 'filled' : ''} ${error ? 'error' : ''} ${isComplete && !error ? 'success' : ''}`}
                        autoComplete="off"
                    />
                ))}
            </div>

            {showToggle && (
                <button
                    type="button"
                    className="pin-toggle"
                    onClick={() => setShowPin(!showPin)}
                    disabled={disabled}
                >
                    {showPin ? <FiEyeOff size={18} /> : <FiEye size={18} />}
                    <span>{showPin ? 'Ocultar' : 'Mostrar'}</span>
                </button>
            )}

            {error && (
                <div className="pin-error">
                    <FiAlertCircle size={16} />
                    <span>{error}</span>
                </div>
            )}

            {isComplete && !error && (
                <div className="pin-success">
                    <FiCheck size={16} />
                    <span>PIN ingresado correctamente</span>
                </div>
            )}

            {(error || isComplete) && (
                <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={clearPin}
                    style={{ marginTop: 'var(--space-3)' }}
                >
                    Reintentar
                </button>
            )}

            <style>{`
                .pin-input-container {
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    padding: var(--space-6);
                    background: var(--surface-elevated);
                    border-radius: var(--radius-lg);
                    border: 1px solid var(--surface-border);
                }

                .pin-header {
                    text-align: center;
                    margin-bottom: var(--space-6);
                }

                .pin-icon {
                    width: 56px;
                    height: 56px;
                    background: linear-gradient(135deg, var(--primary-500), var(--primary-600));
                    border-radius: var(--radius-full);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    margin: 0 auto var(--space-4);
                    color: white;
                    box-shadow: 0 4px 12px rgba(59, 130, 246, 0.3);
                }

                .pin-title {
                    font-size: var(--text-xl);
                    font-weight: 600;
                    color: var(--text-primary);
                    margin: 0 0 var(--space-2);
                }

                .pin-subtitle {
                    font-size: var(--text-sm);
                    color: var(--text-muted);
                    margin: 0;
                }

                .pin-inputs {
                    display: flex;
                    gap: var(--space-3);
                    margin-bottom: var(--space-4);
                }

                .pin-digit {
                    width: 56px;
                    height: 64px;
                    text-align: center;
                    font-size: var(--text-2xl);
                    font-weight: 600;
                    border: 2px solid var(--surface-border);
                    border-radius: var(--radius-md);
                    background: var(--surface-base);
                    color: var(--text-primary);
                    transition: all 0.2s ease;
                    caret-color: var(--primary-500);
                }

                .pin-digit:focus {
                    outline: none;
                    border-color: var(--primary-500);
                    box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.2);
                }

                .pin-digit.filled {
                    border-color: var(--primary-400);
                    background: var(--surface-elevated);
                }

                .pin-digit.error {
                    border-color: var(--danger-500);
                    animation: shake 0.4s ease;
                }

                .pin-digit.success {
                    border-color: var(--success-500);
                    background: rgba(16, 185, 129, 0.1);
                }

                .pin-digit:disabled {
                    opacity: 0.6;
                    cursor: not-allowed;
                }

                @keyframes shake {
                    0%, 100% { transform: translateX(0); }
                    25% { transform: translateX(-4px); }
                    75% { transform: translateX(4px); }
                }

                .pin-toggle {
                    display: flex;
                    align-items: center;
                    gap: var(--space-2);
                    background: none;
                    border: none;
                    color: var(--text-muted);
                    font-size: var(--text-sm);
                    cursor: pointer;
                    padding: var(--space-2);
                    transition: color 0.2s ease;
                }

                .pin-toggle:hover {
                    color: var(--text-primary);
                }

                .pin-error {
                    display: flex;
                    align-items: center;
                    gap: var(--space-2);
                    color: var(--danger-500);
                    font-size: var(--text-sm);
                    margin-top: var(--space-3);
                    padding: var(--space-2) var(--space-3);
                    background: rgba(239, 68, 68, 0.1);
                    border-radius: var(--radius-md);
                }

                .pin-success {
                    display: flex;
                    align-items: center;
                    gap: var(--space-2);
                    color: var(--success-500);
                    font-size: var(--text-sm);
                    margin-top: var(--space-3);
                    padding: var(--space-2) var(--space-3);
                    background: rgba(16, 185, 129, 0.1);
                    border-radius: var(--radius-md);
                }
            `}</style>
        </div>
    );
}
