import type { ReactNode } from 'react';

/* ------------------------------------------------------------------ */
/*  Props                                                              */
/* ------------------------------------------------------------------ */
export interface StatCardProps {
    /** Icono dentro del avatar */
    icon: ReactNode;
    /** Valor numerico o texto principal */
    value: string | number;
    /** Etiqueta descriptiva */
    label: string;
    /** Color de fondo del avatar (variable CSS o hex) */
    color: string;
}

/* ------------------------------------------------------------------ */
/*  Componente                                                         */
/* ------------------------------------------------------------------ */
export default function StatCard({ icon, value, label, color }: StatCardProps) {
    return (
        <div className="card ui-stat-card">
            <div className="flex items-center gap-3">
                <div className="avatar" style={{ background: color }}>
                    {icon}
                </div>
                <div>
                    <div className="ui-stat-card-value">{value}</div>
                    <div className="ui-stat-card-label">{label}</div>
                </div>
            </div>
        </div>
    );
}
