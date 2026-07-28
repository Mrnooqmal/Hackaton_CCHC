import { useMemo } from 'react';
import { FiChevronLeft, FiChevronRight } from 'react-icons/fi';
import type { Activity } from '../api/client';
import { estadoSeguimiento } from '../utils/seguimientoActividad';

/**
 * Calendario mensual de actividades.
 *
 * Grilla lunes→domingo con los fines de semana atenuados (no se trabaja en obra:
 * la planificación nunca genera actividades en sábado/domingo). Cada día muestra
 * "chips" de actividades coloreados por tipo; los borradores (planificados aún no
 * completados) se distinguen con borde punteado y opacidad.
 */

interface ActivityCalendarProps {
    /** Mes visible: cualquier fecha dentro del mes (se usa año y mes). */
    month: Date;
    activities: Activity[];
    /** Colores por tipo de actividad (mismo mapa de Activities.tsx). */
    typeColors: Record<string, { label: string; color: string }>;
    onMonthChange: (nuevo: Date) => void;
    onActivityClick: (activity: Activity) => void;
    /** Click en un día del mes: abre el detalle del día (ver/completar/crear). */
    onDayClick?: (fechaISO: string) => void;
}

const DIAS_SEMANA = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

/** Fecha local YYYY-MM-DD (sin pasar por UTC para no correr el día). */
const toISO = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export default function ActivityCalendar({
    month,
    activities,
    typeColors,
    onMonthChange,
    onActivityClick,
    onDayClick,
}: ActivityCalendarProps) {
    const hoy = toISO(new Date());

    // Semanas del mes: celdas desde el lunes de la primera semana hasta el domingo
    // de la última (las celdas fuera del mes van apagadas).
    const semanas = useMemo(() => {
        const primero = new Date(month.getFullYear(), month.getMonth(), 1);
        const ultimo = new Date(month.getFullYear(), month.getMonth() + 1, 0);
        // getDay(): 0=domingo … 6=sábado → índice lunes-based (0=lunes).
        const offsetLunes = (primero.getDay() + 6) % 7;

        const celdas: { fecha: Date; delMes: boolean }[] = [];
        const cursor = new Date(primero);
        cursor.setDate(cursor.getDate() - offsetLunes);
        while (cursor <= ultimo || celdas.length % 7 !== 0) {
            celdas.push({ fecha: new Date(cursor), delMes: cursor.getMonth() === month.getMonth() });
            cursor.setDate(cursor.getDate() + 1);
        }

        const filas: typeof celdas[] = [];
        for (let i = 0; i < celdas.length; i += 7) filas.push(celdas.slice(i, i + 7));
        return filas;
    }, [month]);

    // Actividades indexadas por fecha para pintar cada celda en O(1).
    const porFecha = useMemo(() => {
        const map = new Map<string, Activity[]>();
        for (const a of activities) {
            if (!a.fecha) continue;
            if (!map.has(a.fecha)) map.set(a.fecha, []);
            map.get(a.fecha)!.push(a);
        }
        // Orden estable dentro del día: por hora de inicio.
        map.forEach(list => list.sort((x, y) => (x.horaInicio || '').localeCompare(y.horaInicio || '')));
        return map;
    }, [activities]);

    const mesLabel = month.toLocaleDateString('es-CL', { month: 'long', year: 'numeric' });

    const cambiarMes = (delta: number) =>
        onMonthChange(new Date(month.getFullYear(), month.getMonth() + delta, 1));

    return (
        <div className="card">
            <style>{`
                .acal-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 4px; }
                .acal-dow { text-align: center; font-size: 0.75rem; font-weight: 700; color: var(--text-muted); padding: var(--space-2) 0; text-transform: uppercase; }
                .acal-cell { min-height: 96px; border: 1px solid var(--surface-border); border-radius: var(--radius-md); padding: 4px; background: var(--surface-elevated); display: flex; flex-direction: column; gap: 3px; overflow: hidden; }
                .acal-cell--fuera { opacity: 0.35; }
                .acal-cell--finde { background: var(--surface); opacity: 0.55; }
                .acal-cell--hoy { border-color: var(--primary-500); box-shadow: inset 0 0 0 1px var(--primary-500); }
                .acal-cell--clickable { cursor: pointer; transition: border-color 0.12s; }
                .acal-cell--clickable:hover { border-color: var(--accent); }
                .acal-dia { font-size: 0.75rem; font-weight: 700; color: var(--text-muted); }
                .acal-chip { font-size: 0.7rem; line-height: 1.25; padding: 2px 6px; border-radius: 4px; color: #fff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; cursor: pointer; border: 1px solid transparent; }
                .acal-chip:hover { filter: brightness(1.15); }
                .acal-chip--borrador { opacity: 0.75; border-style: dashed; border-color: rgba(255,255,255,0.7); }
                .acal-chip--completada { text-decoration: none; }
                .acal-chip--cancelada { opacity: 0.45; text-decoration: line-through; }
                /* Vencida (no realizada dentro del plazo): anillo rojo para que resalte. */
                .acal-chip--vencida { box-shadow: 0 0 0 2px var(--danger-500); }
                .acal-mas { font-size: 0.68rem; color: var(--text-muted); padding-left: 4px; }
            `}</style>

            <div className="card-header flex items-center justify-between">
                <h2 className="card-title" style={{ textTransform: 'capitalize' }}>{mesLabel}</h2>
                <div className="flex items-center gap-2">
                    <button className="btn btn-secondary btn-sm" aria-label="Mes anterior" onClick={() => cambiarMes(-1)}>
                        <FiChevronLeft />
                    </button>
                    <button className="btn btn-secondary btn-sm" onClick={() => onMonthChange(new Date())}>
                        Hoy
                    </button>
                    <button className="btn btn-secondary btn-sm" aria-label="Mes siguiente" onClick={() => cambiarMes(1)}>
                        <FiChevronRight />
                    </button>
                </div>
            </div>

            <div className="acal-grid" role="grid" aria-label={`Calendario de actividades de ${mesLabel}`}>
                {DIAS_SEMANA.map(d => <div key={d} className="acal-dow">{d}</div>)}

                {semanas.flat().map(({ fecha, delMes }) => {
                    const iso = toISO(fecha);
                    const dow = fecha.getDay();
                    const esFinde = dow === 0 || dow === 6;
                    const delDia = porFecha.get(iso) || [];
                    const visibles = delDia.slice(0, 3);
                    const extras = delDia.length - visibles.length;
                    // Cualquier día del mes abre su detalle (los findes solo si tienen
                    // actividades legacy que mostrar; no se planifica en finde).
                    const clickable = Boolean(onDayClick) && delMes && (!esFinde || delDia.length > 0);

                    return (
                        <div
                            key={iso}
                            role="gridcell"
                            className={[
                                'acal-cell',
                                !delMes ? 'acal-cell--fuera' : '',
                                esFinde ? 'acal-cell--finde' : '',
                                iso === hoy && delMes ? 'acal-cell--hoy' : '',
                                clickable ? 'acal-cell--clickable' : '',
                            ].filter(Boolean).join(' ')}
                            title={esFinde && delDia.length === 0
                                ? 'Fin de semana (no se planifican actividades)'
                                : `Ver actividades del ${fecha.getDate()}`}
                            onClick={() => clickable && onDayClick!(iso)}
                        >
                            <span className="acal-dia">{fecha.getDate()}</span>
                            {visibles.map(a => {
                                const info = typeColors[a.tipo];
                                const seg = estadoSeguimiento(a, hoy);
                                return (
                                    <div
                                        key={a.activityId}
                                        className={[
                                            'acal-chip',
                                            a.estado === 'borrador' ? 'acal-chip--borrador' : '',
                                            a.estado === 'completada' ? 'acal-chip--completada' : '',
                                            a.estado === 'cancelada' ? 'acal-chip--cancelada' : '',
                                            seg.vencida ? 'acal-chip--vencida' : '',
                                        ].filter(Boolean).join(' ')}
                                        style={{ background: info?.color || 'var(--gray-500)' }}
                                        title={`${a.titulo} · ${info?.label || a.tipoDescripcion || a.tipo}${a.estado === 'borrador' ? ' · Borrador por completar' : ''}${seg.vencida ? ' · VENCIDA (no realizada)' : ''}`}
                                        onClick={(e) => { e.stopPropagation(); onActivityClick(a); }}
                                    >
                                        {a.estado === 'borrador' ? '◌ ' : ''}{a.horaInicio ? `${a.horaInicio.slice(0, 5)} ` : ''}{a.titulo}
                                    </div>
                                );
                            })}
                            {extras > 0 && <span className="acal-mas">+{extras} más</span>}
                        </div>
                    );
                })}
            </div>

            {/* Leyenda: cuadrado y texto separados con gap fijo; los ítems no se
                parten (nowrap) y fluyen en varias filas en pantallas angostas. */}
            <div
                className="mt-4"
                style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    alignItems: 'center',
                    columnGap: 'var(--space-5, 20px)',
                    rowGap: 'var(--space-2, 8px)',
                }}
            >
                {Object.entries(typeColors).map(([key, { label, color }]) => (
                    <span
                        key={key}
                        className="text-xs text-muted"
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 8, whiteSpace: 'nowrap' }}
                    >
                        <span style={{ width: 12, height: 12, borderRadius: 3, background: color, display: 'inline-block', flexShrink: 0 }} />
                        {label}
                    </span>
                ))}
                <span
                    className="text-xs text-muted"
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 8, whiteSpace: 'nowrap' }}
                >
                    <span style={{ width: 12, height: 12, borderRadius: 3, border: '1px dashed var(--text-muted)', display: 'inline-block', flexShrink: 0 }} />
                    Borrador por completar
                </span>
                <span
                    className="text-xs text-muted"
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 8, whiteSpace: 'nowrap' }}
                >
                    <span style={{ width: 12, height: 12, borderRadius: 3, boxShadow: '0 0 0 2px var(--danger-500)', display: 'inline-block', flexShrink: 0 }} />
                    Vencida (no realizada)
                </span>
            </div>
        </div>
    );
}
