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
}

/* ------------------------------------------------------------------ */
/*  Componente                                                         */
/* ------------------------------------------------------------------ */
export default function EmptyState({ icon, title, description, action }: EmptyStateProps) {
    return (
        <div className="card ui-empty-state">
            <div className="ui-empty-state-icon">{icon}</div>
            <h3 className="ui-empty-state-title">{title}</h3>
            <p className="ui-empty-state-description">{description}</p>
            {action && (
                <button className="btn btn-primary" onClick={action.onClick}>
                    {action.icon}
                    {action.label}
                </button>
            )}
        </div>
    );
}
