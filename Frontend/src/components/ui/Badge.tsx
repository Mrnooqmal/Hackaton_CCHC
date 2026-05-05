import type { ReactNode } from 'react';

/* ------------------------------------------------------------------ */
/*  Props                                                              */
/* ------------------------------------------------------------------ */
export type BadgeVariant = 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'secondary';

export interface BadgeProps {
    /** Variante visual */
    variant?: BadgeVariant;
    /** Contenido del badge */
    children: ReactNode;
    /** Tamano */
    size?: 'sm' | 'md';
}

/* ------------------------------------------------------------------ */
/*  Mapeo de variantes a clases CSS existentes                         */
/* ------------------------------------------------------------------ */
const VARIANT_CLASS: Record<BadgeVariant, string> = {
    success: 'badge-success',
    warning: 'badge-warning',
    danger: 'badge-danger',
    info: 'badge-info',
    neutral: 'badge-neutral',
    secondary: 'badge-secondary',
};

/* ------------------------------------------------------------------ */
/*  Componente                                                         */
/* ------------------------------------------------------------------ */
export default function Badge({ variant = 'neutral', children, size = 'md' }: BadgeProps) {
    const sizeClass = size === 'sm' ? 'badge-sm' : '';
    return (
        <span className={`badge ${VARIANT_CLASS[variant]} ${sizeClass}`}>
            {children}
        </span>
    );
}
