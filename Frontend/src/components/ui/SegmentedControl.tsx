import type { ReactNode } from 'react';

export interface SegmentOption {
    value: string;
    label: string;
    icon?: ReactNode;
}

export interface SegmentedControlProps {
    value: string;
    onChange: (value: string) => void;
    options: SegmentOption[];
    disabled?: boolean;
    /** Ocupa todo el ancho repartiendo los segmentos por igual */
    fullWidth?: boolean;
    ariaLabel?: string;
    className?: string;
}

/**
 * Control segmentado para conjuntos cortos de opciones (2-5).
 * Alternativa a un <select> cuando se quiere ver todas las opciones de un vistazo.
 */
export default function SegmentedControl({
    value,
    onChange,
    options,
    disabled = false,
    fullWidth = true,
    ariaLabel,
    className = '',
}: SegmentedControlProps) {
    return (
        <div
            className={`ui-segmented ${fullWidth ? 'full' : ''} ${className}`}
            role="radiogroup"
            aria-label={ariaLabel}
        >
            {options.map((opt) => (
                <button
                    type="button"
                    key={opt.value}
                    role="radio"
                    aria-checked={opt.value === value}
                    disabled={disabled}
                    className={`ui-segmented-item ${opt.value === value ? 'active' : ''}`}
                    onClick={() => onChange(opt.value)}
                >
                    {opt.icon && <span className="ui-segmented-icon">{opt.icon}</span>}
                    <span>{opt.label}</span>
                </button>
            ))}
        </div>
    );
}
