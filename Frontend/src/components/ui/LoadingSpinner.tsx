/* ------------------------------------------------------------------ */
/*  Props                                                              */
/* ------------------------------------------------------------------ */
export interface LoadingSpinnerProps {
    /** Variante de presentacion */
    variant?: 'fullPage' | 'inline' | 'button';
    /** Texto opcional junto al spinner */
    label?: string;
}

/* ------------------------------------------------------------------ */
/*  Componente                                                         */
/* ------------------------------------------------------------------ */
export default function LoadingSpinner({ variant = 'inline', label }: LoadingSpinnerProps) {
    if (variant === 'fullPage') {
        return (
            <div className="ui-loading-fullpage">
                <div className="spinner" />
                {label && <span className="ui-loading-label">{label}</span>}
            </div>
        );
    }

    if (variant === 'button') {
        return (
            <>
                <div className="spinner spinner-sm" />
                {label && <span>{label}</span>}
            </>
        );
    }

    // inline
    return (
        <div className="ui-loading-inline">
            <div className="spinner" />
            {label && <span className="ui-loading-label">{label}</span>}
        </div>
    );
}
