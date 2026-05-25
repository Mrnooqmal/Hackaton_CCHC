import { useState } from 'react';
import { FiCopy, FiCheck, FiKey, FiUser } from 'react-icons/fi';

export interface CredentialCardProps {
    /** The RUT or username label */
    rut: string;
    /** The temporary password */
    password: string;
    /** Title for the card — e.g. "Credenciales de acceso" or "Contraseña Reseteada" */
    title?: string;
    /** Subtitle / hint shown below the card */
    hint?: string;
    /** Accent color variant */
    variant?: 'primary' | 'warning';
}

export default function CredentialCard({
    rut,
    password,
    title = 'Credenciales de acceso',
    hint = 'El usuario deberá cambiar esta contraseña al iniciar sesión.',
    variant = 'primary',
}: CredentialCardProps) {
    const [copiedField, setCopiedField] = useState<'rut' | 'password' | null>(null);

    const accentColor = variant === 'warning' ? 'var(--warning-500)' : 'var(--primary-500)';
    const accentBg = variant === 'warning' ? 'rgba(234, 179, 8, 0.1)' : 'rgba(76, 175, 80, 0.1)';

    const handleCopy = async (value: string, field: 'rut' | 'password') => {
        try {
            await navigator.clipboard.writeText(value);
            setCopiedField(field);
            setTimeout(() => setCopiedField(null), 2000);
        } catch {
            // fallback
            const textArea = document.createElement('textarea');
            textArea.value = value;
            document.body.appendChild(textArea);
            textArea.select();
            document.execCommand('copy');
            document.body.removeChild(textArea);
            setCopiedField(field);
            setTimeout(() => setCopiedField(null), 2000);
        }
    };

    return (
        <div className="credential-card">
            <div className="credential-card__header">
                <FiKey size={16} style={{ color: accentColor }} />
                <span className="credential-card__title">{title}</span>
            </div>
            <div className="credential-card__body" style={{ background: accentBg }}>
                <div className="credential-card__field">
                    <div className="credential-card__field-icon">
                        <FiUser size={14} />
                    </div>
                    <div className="credential-card__field-content">
                        <span className="credential-card__label">RUT</span>
                        <span className="credential-card__value">{rut}</span>
                    </div>
                    <button
                        className="credential-card__copy"
                        onClick={() => handleCopy(rut, 'rut')}
                        title="Copiar RUT"
                        type="button"
                    >
                        {copiedField === 'rut' ? <FiCheck size={14} /> : <FiCopy size={14} />}
                    </button>
                </div>
                <div className="credential-card__divider" />
                <div className="credential-card__field credential-card__field--highlight">
                    <div className="credential-card__field-icon" style={{ color: accentColor }}>
                        <FiKey size={14} />
                    </div>
                    <div className="credential-card__field-content">
                        <span className="credential-card__label">Contraseña Temporal</span>
                        <span className="credential-card__value credential-card__value--password" style={{ color: accentColor }}>
                            {password}
                        </span>
                    </div>
                    <button
                        className="credential-card__copy credential-card__copy--accent"
                        onClick={() => handleCopy(password, 'password')}
                        title="Copiar contraseña"
                        type="button"
                        style={{ '--copy-accent': accentColor } as React.CSSProperties}
                    >
                        {copiedField === 'password' ? <FiCheck size={14} /> : <FiCopy size={14} />}
                    </button>
                </div>
            </div>
            {hint && (
                <p className="credential-card__hint">
                    {hint}
                </p>
            )}
        </div>
    );
}
