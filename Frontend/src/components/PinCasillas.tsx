import { useState } from 'react';

interface PinCasillasProps {
    id: string;
    value: string;
    onChange: (valor: string) => void;
    /** Se llama al escribir el cuarto dígito. */
    onComplete?: (valor: string) => void;
    /** Muestra los dígitos en vez de puntos. */
    visible?: boolean;
    error?: boolean;
    disabled?: boolean;
    autoFocus?: boolean;
    ariaLabel?: string;
}

const LARGO = 4;

/**
 * PIN de 4 dígitos en casillas.
 *
 * Por debajo es UN input numérico real, transparente y tendido sobre las
 * casillas: tocar cualquiera abre el teclado numérico del teléfono, y lectores
 * de pantalla y gestores de contraseñas ven un campo normal. Las casillas solo
 * dibujan su estado: vacía, la que toca, llena (navy, como la credencial) o error.
 */
export default function PinCasillas({
    id, value, onChange, onComplete, visible = false, error = false, disabled = false,
    autoFocus = false, ariaLabel = 'PIN de 4 dígitos',
}: PinCasillasProps) {
    const [enfocado, setEnfocado] = useState(false);

    const cambiar = (e: React.ChangeEvent<HTMLInputElement>) => {
        const limpio = e.target.value.replace(/\D/g, '').slice(0, LARGO);
        onChange(limpio);
        if (limpio.length === LARGO && value.length < LARGO) onComplete?.(limpio);
    };

    return (
        <div className={`pin-casillas${error ? ' pin-casillas--error' : ''}`}>
            {Array.from({ length: LARGO }, (_, i) => {
                const lleno = i < value.length;
                const actual = enfocado && !disabled && i === Math.min(value.length, LARGO - 1) && !lleno;
                return (
                    <span
                        key={i}
                        aria-hidden="true"
                        className={`pin-casilla${lleno ? ' pin-casilla--llena' : ''}${actual ? ' pin-casilla--actual' : ''}`}
                    >
                        {lleno && (visible ? <span className="pin-casilla-digito">{value[i]}</span> : <span className="pin-casilla-punto" />)}
                        {actual && <span className="pin-casilla-cursor" />}
                    </span>
                );
            })}
            <input
                id={id}
                className="pin-casillas-input"
                type={visible ? 'text' : 'password'}
                inputMode="numeric"
                pattern="[0-9]*"
                autoComplete="off"
                maxLength={LARGO}
                value={value}
                onChange={cambiar}
                onFocus={() => setEnfocado(true)}
                onBlur={() => setEnfocado(false)}
                disabled={disabled}
                autoFocus={autoFocus}
                aria-label={ariaLabel}
                aria-invalid={error || undefined}
            />
        </div>
    );
}
