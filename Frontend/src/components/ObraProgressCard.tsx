import { Link } from 'react-router-dom';

interface ObraProgressStats {
    uploaded: number;
    total: number;
    progress: number;
    label?: string;
}

interface ObraProgressCardProps {
    obra: {
        obraId: string;
        nombre: string;
        etapaActual?: string;
        faseDeming?: string;
        estado?: string;
    };
    progress: ObraProgressStats;
    managePath?: string;
    manageLabel?: string;
}

export default function ObraProgressCard({
    obra,
    progress,
    managePath,
    manageLabel = 'Gestionar Obra'
}: ObraProgressCardProps) {
    const DS44_PHASE_LABELS: Record<string, string> = {
        plan: 'PLANIFICAR',
        hacer: 'HACER',
        verificar: 'VERIFICAR',
        actuar: 'ACTUAR'
    };
    const DS44_PHASE_STYLES: Record<string, { background: string; color: string; border: string }> = {
        plan: {
            background: 'rgba(59, 130, 246, 0.16)',
            color: 'var(--primary-700)',
            border: '1px solid var(--primary-500)'
        },
        hacer: {
            background: 'rgba(16, 185, 129, 0.16)',
            color: 'var(--success-700)',
            border: '1px solid var(--success-500)'
        },
        verificar: {
            background: 'rgba(234, 179, 8, 0.18)',
            color: 'var(--warning-700)',
            border: '1px solid var(--warning-500)'
        },
        actuar: {
            background: 'rgba(239, 68, 68, 0.16)',
            color: 'var(--danger-700)',
            border: '1px solid var(--danger-500)'
        }
    };
    const stageLabel = obra.etapaActual ? obra.etapaActual.replace('_', ' ') : '-';
    const faseDemingKey = obra.faseDeming || 'plan';
    const faseDemingLabel = DS44_PHASE_LABELS[faseDemingKey] || faseDemingKey.toUpperCase();
    const faseDemingStyle = DS44_PHASE_STYLES[faseDemingKey] || {
        background: 'var(--surface-elevated)',
        color: 'var(--text-muted)',
        border: '1px solid var(--surface-border)'
    };
    const statusVariant = obra.estado === 'activa' ? 'success' : obra.estado ? 'warning' : 'secondary';
    const statusLabel = obra.estado || 'sin estado';
    const percent = Number.isFinite(progress.progress) ? progress.progress : 0;
    const progressColor = percent === 100 ? 'var(--success-500)' : 'var(--primary-500)';
    const progressLabel = progress.label || 'documentos normativos listos en esta fase';
    const progressDetail = progress.total > 0
        ? `${progress.uploaded} de ${progress.total} ${progressLabel}`
        : 'Sin datos para esta fase';

    return (
        <div className="card" style={{ padding: 'var(--space-4)', border: '1px solid var(--surface-border)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 'var(--space-3)' }}>
                <div>
                    <h3 className="font-bold text-lg">{obra.nombre}</h3>
                    <div
                        className="text-xs text-muted"
                        style={{ textTransform: 'capitalize', marginTop: 2, opacity: 0.7, fontSize: '0.72rem' }}
                    >
                        Etapa obra: {stageLabel}
                    </div>
                </div>
                <span className={`badge badge-${statusVariant}`} style={{ textTransform: 'capitalize' }}>
                    {statusLabel}
                </span>
            </div>
            <div style={{ marginBottom: managePath ? 'var(--space-4)' : 'var(--space-2)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 'var(--space-3)', gap: 'var(--space-3)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                        <span className="text-sm text-muted">Cumplimiento DS44</span>
                        <span
                            className="badge"
                            style={{
                                ...faseDemingStyle,
                                fontWeight: 700,
                                letterSpacing: '0.02em'
                            }}
                        >
                            Fase {faseDemingLabel}
                        </span>
                    </div>
                    <span className="text-sm font-bold">{percent}%</span>
                </div>
                <div className="progress">
                    <div className="progress-bar" style={{ width: `${percent}%`, background: progressColor }} />
                </div>
                <div className="text-xs text-muted mt-1">
                    {progressDetail}
                </div>
            </div>
            {managePath && (
                <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                    <Link to={managePath} className="btn btn-secondary btn-sm" style={{ flex: 1, justifyContent: 'center' }}>
                        {manageLabel}
                    </Link>
                </div>
            )}
        </div>
    );
}
