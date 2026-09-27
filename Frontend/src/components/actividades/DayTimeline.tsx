import { useEffect, useMemo, useRef } from 'react';
import { FiChevronUp, FiChevronDown } from 'react-icons/fi';
import type { Activity } from '../../api/client';
import { hoyISO } from '../../utils/seguimientoActividad';

/**
 * Línea de tiempo de 24 horas para el detalle de un día del calendario —
 * como Google Calendar: cada actividad se ubica en su bloque de hora real
 * (alto = duración, posición = hora de inicio) en vez de listarse aparte.
 * Las que se cruzan se parten en columnas dentro de su propio cruce, no en
 * todo el día, para no angostar bloques que no compiten por espacio.
 */

interface DayTimelineProps {
    /** Día que se está viendo (YYYY-MM-DD): decide si se dibuja la línea de «ahora». */
    fecha: string;
    activities: Activity[];
    typeColors: Record<string, { label: string; color: string; icon: React.ReactElement }>;
    onActivityClick: (activity: Activity) => void;
}

const HOUR_PX = 56;
const HORAS = Array.from({ length: 24 }, (_, h) => h);
// Al abrir, se desplaza a horario de obra en vez de la medianoche: es donde
// están casi todas las actividades.
const SCROLL_INICIAL_HORA = 6;
const DURACION_MIN_MIN = 30;

const aMinutos = (hm?: string): number | null => {
    if (!hm) return null;
    const [h, m] = hm.slice(0, 5).split(':').map(Number);
    if (Number.isNaN(h) || Number.isNaN(m)) return null;
    return h * 60 + m;
};

interface Bloque {
    activity: Activity;
    inicio: number;
    fin: number;
}

/**
 * Empaqueta los bloques en columnas SOLO dentro de cada cruce (cluster de
 * actividades que se solapan entre sí): dos charlas a horas opuestas del día
 * no deberían angostarse por un cruce que ocurre en otro momento.
 */
function empaquetar(bloques: Bloque[]): { bloque: Bloque; col: number; cols: number }[] {
    const ordenados = [...bloques].sort((a, b) => a.inicio - b.inicio);
    const clusters: Bloque[][] = [];
    let actual: Bloque[] = [];
    let finActual = -Infinity;
    for (const b of ordenados) {
        if (actual.length && b.inicio >= finActual) {
            clusters.push(actual);
            actual = [];
            finActual = -Infinity;
        }
        actual.push(b);
        finActual = Math.max(finActual, b.fin);
    }
    if (actual.length) clusters.push(actual);

    const resultado: { bloque: Bloque; col: number; cols: number }[] = [];
    for (const cluster of clusters) {
        const finPorColumna: number[] = [];
        const conColumna = cluster.map((b) => {
            let col = finPorColumna.findIndex((fin) => fin <= b.inicio);
            if (col === -1) { col = finPorColumna.length; finPorColumna.push(b.fin); }
            else finPorColumna[col] = b.fin;
            return { bloque: b, col };
        });
        const cols = finPorColumna.length;
        for (const c of conColumna) resultado.push({ ...c, cols });
    }
    return resultado;
}

export default function DayTimeline({ fecha, activities, typeColors, onActivityClick }: DayTimelineProps) {
    const scrollRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        scrollRef.current?.scrollTo({ top: SCROLL_INICIAL_HORA * HOUR_PX - 8 });
    }, [fecha]);

    const esHoy = fecha === hoyISO();
    const ahoraMin = esHoy ? (() => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); })() : null;

    const colocados = useMemo(() => {
        const bloques: Bloque[] = activities.map((a) => {
            const inicio = aMinutos(a.horaInicio) ?? 0;
            const finDeclarado = aMinutos(a.horaFin);
            const fin = Math.max(finDeclarado ?? (inicio + DURACION_MIN_MIN), inicio + 15);
            return { activity: a, inicio, fin };
        });
        return empaquetar(bloques);
    }, [activities]);

    return (
        <div className="dt-wrap">
            <div className="dt-hint">
                <FiChevronUp size={11} aria-hidden="true" /> 00:00 — desplázate para ver la madrugada
            </div>

            <div className="dt-scroll" ref={scrollRef}>
                <div className="dt-track">
                    <div className="dt-grid">
                        {HORAS.map((h) => (
                            <div key={`l-${h}`} className="dt-hourlabel" style={{ height: HOUR_PX }}>
                                {String(h).padStart(2, '0')}:00
                            </div>
                        ))}
                        {HORAS.map((h) => (
                            <div key={`r-${h}`} className="dt-hourline" style={{ height: HOUR_PX }} />
                        ))}
                    </div>

                    <div className="dt-overlay">
                        {ahoraMin != null && (
                            <div className="dt-now" style={{ top: (ahoraMin / 60) * HOUR_PX }} aria-hidden="true" />
                        )}

                        {colocados.map(({ bloque, col, cols }) => {
                            const { activity: a } = bloque;
                            const info = typeColors[a.tipo] || { label: a.tipoDescripcion || a.tipo, color: 'var(--gray-500)' };
                            const top = (bloque.inicio / 60) * HOUR_PX;
                            const height = Math.max(((bloque.fin - bloque.inicio) / 60) * HOUR_PX, 15);
                            const anchoPct = 100 / cols;
                            const corto = height < 32;
                            const horaTxt = (a.horaInicio || '').slice(0, 5);
                            const rangoTxt = a.horaFin ? `${horaTxt}–${a.horaFin.slice(0, 5)}` : horaTxt;

                            return (
                                <button
                                    type="button"
                                    key={a.activityId}
                                    className={`dt-block${a.estado === 'borrador' ? ' dt-block--borrador' : ''}${corto ? ' dt-block--corto' : ''}`}
                                    style={{
                                        top,
                                        height,
                                        left: `calc(${col * anchoPct}% + 3px)`,
                                        width: `calc(${anchoPct}% - 6px)`,
                                        background: info.color,
                                    }}
                                    title={`${a.titulo} · ${info.label} · ${rangoTxt}${a.estado === 'borrador' ? ' · Borrador por completar' : ''}`}
                                    onClick={() => onActivityClick(a)}
                                >
                                    {corto ? (
                                        <span className="dt-block-linea">
                                            {a.estado === 'borrador' ? '◌ ' : ''}{horaTxt} {a.titulo}
                                        </span>
                                    ) : (
                                        <>
                                            <strong className="dt-block-title">{a.estado === 'borrador' ? '◌ ' : ''}{a.titulo}</strong>
                                            <span className="dt-block-hora">{rangoTxt}</span>
                                        </>
                                    )}
                                </button>
                            );
                        })}
                    </div>
                </div>
            </div>

            <div className="dt-hint">
                <FiChevronDown size={11} aria-hidden="true" /> 24:00 — fin del día
            </div>

            <style>{`
                .dt-wrap { display: flex; flex-direction: column; gap: 6px; }
                .dt-hint {
                    display: flex; align-items: center; justify-content: center; gap: 6px;
                    padding: 1px 0; font-size: 10.5px; color: var(--text-muted);
                }
                .dt-scroll { max-height: 520px; overflow-y: auto; border: 1px solid var(--surface-border); border-radius: var(--radius-md); }
                .dt-track { position: relative; }
                .dt-grid { display: grid; grid-template-columns: 60px 1fr; }
                .dt-hourlabel {
                    box-sizing: border-box; display: flex; align-items: flex-start; justify-content: flex-end;
                    padding: 4px 10px 0 0; font-size: 10.5px; color: var(--text-muted);
                    font-variant-numeric: tabular-nums; border-top: 1px solid var(--surface-border);
                }
                .dt-hourline { box-sizing: border-box; border-top: 1px solid var(--surface-border); border-left: 1px solid var(--surface-border); }
                .dt-grid > .dt-hourlabel:first-child, .dt-grid > .dt-hourline:first-child { border-top: none; }

                .dt-overlay { position: absolute; top: 0; left: 60px; right: 0; bottom: 0; }
                .dt-now { position: absolute; left: -5px; right: 0; height: 1.5px; background: var(--danger-500); }
                .dt-now::before {
                    content: ''; position: absolute; left: 0; top: 50%; transform: translateY(-50%);
                    width: 8px; height: 8px; border-radius: 50%; background: var(--danger-500);
                }

                .dt-block {
                    position: absolute; border-radius: 6px; color: #fff; text-align: left;
                    border: none; cursor: pointer; font-family: inherit; overflow: hidden;
                    padding: 4px 8px; box-sizing: border-box;
                    display: flex; flex-direction: column; gap: 2px;
                    transition: filter var(--transition-fast);
                }
                .dt-block:hover { filter: brightness(1.15); }
                .dt-block:focus-visible { outline: 2px solid #fff; outline-offset: -2px; }
                .dt-block-title { font-size: 11.5px; font-weight: 700; line-height: 1.25; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
                .dt-block-hora { font-size: 10px; opacity: 0.9; font-variant-numeric: tabular-nums; }
                .dt-block--corto { flex-direction: row; align-items: center; padding: 0 8px; font-size: 10px; font-weight: 600; }
                .dt-block-linea { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
                .dt-block--borrador { border: 1.5px dashed rgba(255,255,255,0.7); opacity: 0.85; }
            `}</style>
        </div>
    );
}
