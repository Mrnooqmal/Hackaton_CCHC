import type { ReactNode } from 'react';

/* ------------------------------------------------------------------ */
/*  Props                                                              */
/* ------------------------------------------------------------------ */
export interface EmptyStateProps {
    /** Icono principal (react-icons element) */
    icon: ReactNode;
    /** Titulo del estado vacio */
    title: string;
    /** Descripcion explicativa */
    description: string;
    /** Boton de accion opcional */
    action?: {
        label: string;
        onClick: () => void;
        icon?: ReactNode;
    };
    /** Segunda accion, junto a la principal (por ejemplo, otra forma de empezar) */
    secondaryAction?: {
        label: string;
        onClick: () => void;
        icon?: ReactNode;
    };
    /** Botones mas grandes, para pantallas donde la accion es lo unico que hay que hacer */
    large?: boolean;
}

/* ------------------------------------------------------------------ */
/*  Componente                                                         */
/* ------------------------------------------------------------------ */
export default function EmptyState({ icon, title, description, action, secondaryAction, large = false }: EmptyStateProps) {
    const tamano = large ? ' btn-lg' : '';
    const botonPrincipal = action && (
        <button type="button" className={`btn btn-primary${tamano}`} onClick={action.onClick}>
            {action.icon}
            {action.label}
        </button>
    );
    return (
        <div className="card ui-empty-state">
            <div className="ui-empty-state-icon">{icon}</div>
            <h3 className="ui-empty-state-title">{title}</h3>
            <p className="ui-empty-state-description">{description}</p>
            {secondaryAction ? (
                <div className="ui-empty-state-actions">
                    {botonPrincipal}
                    <button type="button" className={`btn btn-secondary${tamano}`} onClick={secondaryAction.onClick}>
                        {secondaryAction.icon}
                        {secondaryAction.label}
                    </button>
                </div>
            ) : botonPrincipal}
        </div>
    );
}
