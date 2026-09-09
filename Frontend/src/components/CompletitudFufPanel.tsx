import { useCallback, useEffect, useState } from 'react';
import { FiAlertTriangle, FiChevronDown, FiChevronRight } from 'react-icons/fi';
import { Badge } from './ui';
import { estructuraApi } from '../api/estructura.api';
import {
    ESTADO_REQUISITO, ESTADO_LABEL, ESTADO_VARIANTE, colorProgreso,
    type CompletitudAmbito,
} from '../utils/completitud';
import type { Ambito } from '../utils/estructuraPreventiva';

/**
 * Panel de completitud del FUF por ámbito (sección 8 del encargo).
 *
 * Muestra el estado de cada requisito agrupado por bloque, con el porcentaje
 * calculado sobre los EXIGIBLES: lo que no aplica y lo que está fuera de alcance
 * sale del denominador en vez de penalizar. Un porcentaje que castiga por no
 * tener lo que no corresponde miente, y el usuario deja de creerle.
 *
 * Los `NoAplica` se muestran igual, con su justificación normativa: un panel que
 * oculta lo que excluyó es tan opaco como uno que castiga de más.
 */

export interface CompletitudFufPanelProps {
    tenantId: string;
    ambito: Ambito;
    obraId?: string | null;
}

export default function CompletitudFufPanel({ tenantId, ambito, obraId = null }: CompletitudFufPanelProps) {
    const [data, setData] = useState<CompletitudAmbito | null>(null);
    const [cargando, setCargando] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [abiertos, setAbiertos] = useState<Set<string>>(new Set());

    const cargar = useCallback(async () => {
        if (!tenantId) return;
        setCargando(true);
        setError(null);
        const res = await estructuraApi.completitud(tenantId, ambito, obraId);
        if (res.success && res.data) {
            setData(res.data);
            // Se abre por defecto el bloque que tenga algo que resolver: es lo que
            // el usuario vino a ver.
            const conPendientes = res.data.bloques
                .filter((b) => b.resumen.progreso < 100)
                .map((b) => b.bloque);
            setAbiertos(new Set(conPendientes));
        } else {
            setError(res.error || 'No se pudo calcular la completitud.');
        }
        setCargando(false);
    }, [tenantId, ambito, obraId]);

    useEffect(() => { void cargar(); }, [cargar]);

    const alternar = (bloque: string) => setAbiertos((prev) => {
        const s = new Set(prev);
        if (s.has(bloque)) s.delete(bloque); else s.add(bloque);
        return s;
    });

    if (cargando) return <div className="text-muted" style={{ fontSize: '0.85rem' }}>Calculando completitud…</div>;
    if (error) {
        return (
            <div className="ds44-alert ds44-alert-danger" style={{ fontSize: '0.85rem' }}>
                <span className="ds44-alert-icon"><FiAlertTriangle size={14} /></span>
                <span>{error}</span>
            </div>
        );
    }
    if (!data) return null;

    const { resumen } = data;

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            <div className="card" style={{ padding: 'var(--space-4)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
                    <span style={{ fontSize: '0.78rem', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600, color: 'var(--text-secondary)' }}>
                        Requisitos del FUF
                    </span>
                    <span style={{ fontWeight: 700, fontSize: '1rem', color: colorProgreso(resumen.progreso) }}>
                        {resumen.progreso}%
                    </span>
                </div>
                <div className="ds44-progress-track">
                    <div className="ds44-progress-fill"
                        style={{ width: `${resumen.progreso}%`, background: colorProgreso(resumen.progreso) }} />
                </div>
                {/* El denominador se declara: sin esto el porcentaje es un número sin
                    procedencia y nadie sabe qué quedó fuera ni por qué. */}
                <div className="text-muted" style={{ fontSize: '0.75rem', marginTop: 5 }}>
                    {resumen.cumplidos} de {resumen.exigibles} requisitos exigibles
                    {resumen.excluidos > 0 && ` · ${resumen.excluidos} no aplican o están fuera de alcance y no penalizan`}
                </div>
            </div>

            {data.bloques.map((b) => {
                const abierto = abiertos.has(b.bloque);
                return (
                    <div key={b.bloque} className="card" style={{ padding: 'var(--space-3)' }}>
                        <button
                            type="button"
                            onClick={() => alternar(b.bloque)}
                            aria-expanded={abierto}
                            style={{
                                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                width: '100%', background: 'none', border: 'none', padding: 0,
                                cursor: 'pointer', gap: 'var(--space-2)', textAlign: 'left',
                            }}
                        >
                            <span style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0 }}>
                                {abierto ? <FiChevronDown size={15} /> : <FiChevronRight size={15} />}
                                <span className="font-medium" style={{ fontSize: '0.9rem' }}>{b.bloque}</span>
                            </span>
                            <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexShrink: 0 }}>
                                <span className="text-muted" style={{ fontSize: '0.78rem' }}>
                                    {b.resumen.cumplidos}/{b.resumen.exigibles}
                                </span>
                                <span style={{ fontWeight: 700, fontSize: '0.85rem', color: colorProgreso(b.resumen.progreso) }}>
                                    {b.resumen.progreso}%
                                </span>
                            </span>
                        </button>

                        {abierto && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', marginTop: 'var(--space-3)' }}>
                                {b.requisitos.map((r) => (
                                    <div key={r.id} className="ds44-doc-row">
                                        <div style={{ minWidth: 0 }}>
                                            <div className="font-medium" style={{ fontSize: '0.88rem' }}>
                                                {r.item !== null && <span className="text-muted">FUF {r.item} · </span>}
                                                {r.titulo}
                                            </div>
                                            <div className="text-muted" style={{ fontSize: '0.78rem' }}>
                                                {r.justificacion || r.detalle || '—'}
                                            </div>
                                        </div>
                                        <Badge variant={ESTADO_VARIANTE[r.estado]}>
                                            {ESTADO_LABEL[r.estado]}
                                        </Badge>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                );
            })}

            {data.limiteRegistroDT && (
                <div className="text-muted" style={{ fontSize: '0.75rem' }}>
                    Plazo estimado para registrar el acta en la Dirección del Trabajo:{' '}
                    {new Date(data.limiteRegistroDT).toLocaleDateString('es-CL')}. Es referencial:
                    el cálculo excluye fin de semana pero no feriados, así que la fecha real puede ser posterior.
                </div>
            )}

            {resumen.porEstado[ESTADO_REQUISITO.FUERA_DE_ALCANCE] > 0 && (
                <div className="text-muted" style={{ fontSize: '0.75rem' }}>
                    {resumen.porEstado[ESTADO_REQUISITO.FUERA_DE_ALCANCE]} requisito(s) se acreditan de forma
                    indirecta y no tienen evidencia propia en el sistema.
                </div>
            )}
        </div>
    );
}
