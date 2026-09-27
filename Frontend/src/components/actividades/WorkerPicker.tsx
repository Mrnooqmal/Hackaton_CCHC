import type { ReactNode } from 'react';
import { FiCheck, FiSearch } from 'react-icons/fi';
import type { Worker } from '../../api/client';

export interface WorkerPickerProps {
    workers: Worker[];
    /** personaIds seleccionados */
    selected: string[];
    onToggle: (personaId: string) => void;
    search: string;
    onSearchChange: (value: string) => void;
    /** Etiqueta del grupo (ej. "Asistentes requeridos") */
    label?: string;
    /** Acciones a la derecha del encabezado (ej. "Ver toda la obra") */
    headerActions?: ReactNode;
    /** Marca a quienes ya firmaron: no seleccionables */
    lockedIds?: string[];
    lockedLabel?: string;
    /** Destaca a los convocados y los ordena primero */
    highlightIds?: string[];
    highlightLabel?: string;
    /** Mensaje cuando no hay ningún trabajador que mostrar */
    emptyMessage?: string;
    /** Altura máxima de la lista antes de hacer scroll */
    maxHeight?: number;
    /** Filas más bajas (para listas anidadas, como el planificador) */
    compact?: boolean;
    onSelectAll?: () => void;
    /**
     * 'card' (por defecto): fila-botón con avatar y check propios, usada donde
     * hace falta marcar estados (citado, ya firmó). 'flat': casillero nativo
     * con RUT y filas separadas por línea, igual que "Trabajadores asignados"
     * en Obra nueva — para los selectores simples (Nueva actividad, Planificar
     * el mes) que no tienen esos estados y deben verse consistentes con ese.
     */
    variant?: 'card' | 'flat';
}

/**
 * Selector de trabajadores compartido por los modales de actividades
 * (crear, completar borrador, registrar asistencia y planificar el mes).
 */
export default function WorkerPicker({
    workers,
    selected,
    onToggle,
    search,
    onSearchChange,
    label,
    headerActions,
    lockedIds = [],
    lockedLabel = 'Ya registrado',
    highlightIds = [],
    highlightLabel = 'Convocado',
    emptyMessage = 'No hay trabajadores asignados a esta obra.',
    maxHeight = 260,
    compact = false,
    onSelectAll,
    variant = 'card',
}: WorkerPickerProps) {
    const lockedSet = new Set(lockedIds);
    const highlightSet = new Set(highlightIds);

    const q = search.trim().toLowerCase();
    const visibles = (!q
        ? workers
        : workers.filter((w) => `${w.nombre} ${w.apellido} ${w.cargo}`.toLowerCase().includes(q))
    )
        .slice()
        .sort((a, b) => Number(highlightSet.has(b.personaId)) - Number(highlightSet.has(a.personaId)));

    const seleccionables = workers.filter((w) => !lockedSet.has(w.personaId));
    const todosSeleccionados =
        seleccionables.length > 0 && seleccionables.every((w) => selected.includes(w.personaId));

    return (
        <div className={`wp ${compact ? 'wp-compact' : ''}`}>
            {(label || headerActions || onSelectAll) && (
                <div className="wp-head">
                    <span className="wp-label">
                        {label}
                        {selected.length > 0 && <span className="wp-count">{selected.length}</span>}
                    </span>
                    <div className="wp-head-actions">
                        {headerActions}
                        {onSelectAll && seleccionables.length > 0 && (
                            <button type="button" className="btn btn-ghost btn-sm" onClick={onSelectAll}>
                                {todosSeleccionados ? 'Quitar todos' : 'Seleccionar todos'}
                            </button>
                        )}
                    </div>
                </div>
            )}

            {workers.length === 0 ? (
                <p className="wp-empty">{emptyMessage}</p>
            ) : (
                /* Búsqueda y lista comparten UNA sola caja: la búsqueda vive
                   dentro, con una regla abajo, para que el panel no cambie de
                   alto al escribir — mismo trazo que "Trabajadores asignados"
                   en Obra nueva. */
                <div className="wp-box">
                    {workers.length > 6 && (
                        <div className="wp-search">
                            <FiSearch size={14} aria-hidden="true" />
                            <input
                                type="text"
                                placeholder="Buscar por nombre o cargo…"
                                value={search}
                                onChange={(e) => onSearchChange(e.target.value)}
                            />
                        </div>
                    )}

                    <div className={`wp-list${variant === 'flat' ? ' wp-list-flat' : ''}`} style={{ maxHeight }}>
                        {visibles.length === 0 ? (
                            <p className="wp-empty">Ningún trabajador coincide con «{search}».</p>
                        ) : variant === 'flat' ? (
                            visibles.map((w, idx) => {
                                const isSelected = selected.includes(w.personaId);
                                const isLocked = lockedSet.has(w.personaId);
                                const isHighlighted = highlightSet.has(w.personaId);
                                return (
                                    <label
                                        key={w.personaId}
                                        className={`wp-flat-row${isLocked ? ' locked' : ''}`}
                                        style={{ borderBottom: idx < visibles.length - 1 ? '1px solid var(--surface-border)' : 'none' }}
                                    >
                                        <input
                                            type="checkbox"
                                            className="checkbox-input custom-checkbox"
                                            checked={isSelected}
                                            disabled={isLocked}
                                            onChange={() => onToggle(w.personaId)}
                                        />
                                        <span className="wp-flat-identity">
                                            <span>
                                                {w.nombre} {w.apellido}
                                                {isHighlighted && <span className="wp-tag">{highlightLabel}</span>}
                                            </span>
                                            <span className="text-muted wp-flat-meta">
                                                {[w.rut, w.cargo].filter(Boolean).join(' · ')}
                                            </span>
                                        </span>
                                        {isLocked && <span className="badge badge-success badge-sm">{lockedLabel}</span>}
                                    </label>
                                );
                            })
                        ) : (
                            visibles.map((w) => {
                                const isSelected = selected.includes(w.personaId);
                                const isLocked = lockedSet.has(w.personaId);
                                const isHighlighted = highlightSet.has(w.personaId);
                                return (
                                    <button
                                        type="button"
                                        key={w.personaId}
                                        className={`wp-row${isSelected ? ' selected' : ''}${isLocked ? ' locked' : ''}${isHighlighted ? ' highlighted' : ''}`}
                                        disabled={isLocked}
                                        aria-pressed={isSelected}
                                        onClick={() => onToggle(w.personaId)}
                                    >
                                        <span className="wp-avatar" aria-hidden="true">{w.nombre.charAt(0)}</span>
                                        <span className="wp-identity">
                                            <span className="wp-name">
                                                {w.nombre} {w.apellido}
                                                {isHighlighted && <span className="wp-tag">{highlightLabel}</span>}
                                            </span>
                                            {w.cargo && <span className="wp-role">{w.cargo}</span>}
                                        </span>
                                        {isLocked ? (
                                            <span className="badge badge-success badge-sm">{lockedLabel}</span>
                                        ) : (
                                            <span className="wp-check" aria-hidden="true">
                                                {isSelected && <FiCheck size={13} />}
                                            </span>
                                        )}
                                    </button>
                                );
                            })
                        )}
                    </div>
                </div>
            )}

            <style>{`
                .wp { display: flex; flex-direction: column; gap: var(--space-2); }
                .wp-head { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); flex-wrap: wrap; }
                .wp-label { font-size: var(--text-sm); font-weight: 600; color: var(--text-secondary); display: inline-flex; align-items: center; gap: 6px; }
                .wp-count { font-size: 11px; font-weight: 700; color: var(--accent-text); background: var(--accent-tint); padding: 1px 7px; border-radius: var(--radius-full); }
                .wp-head-actions { display: flex; align-items: center; gap: var(--space-1); }
                .wp-empty { font-size: var(--text-sm); color: var(--text-muted); margin: 0; padding: var(--space-3) 0; }

                /* Una sola caja: la búsqueda va arriba con una regla abajo, la
                   lista se desplaza debajo. Ninguna de las dos lleva su propio
                   borde — el borde es de la caja. */
                .wp-box {
                    display: flex; flex-direction: column;
                    border: 1px solid var(--surface-border); border-radius: var(--radius-md);
                    overflow: hidden; background: none;
                }
                .wp-search {
                    position: relative; display: flex; align-items: center; flex-shrink: 0;
                    border-bottom: 1px solid var(--surface-border);
                }
                .wp-search > svg { position: absolute; left: 11px; color: var(--text-muted); pointer-events: none; }
                .wp-search input {
                    width: 100%; height: 38px; padding: 0 12px 0 33px;
                    border: none; background: none; color: var(--text-primary); font-size: var(--text-sm);
                }
                .wp-search input:focus { outline: none; }
                /* Solo el buscador prende el contorno de la caja: si fuera
                   :focus-within, tocar a una persona de la lista (que también
                   mueve el foco a su checkbox) encendería el borde entero de
                   la caja en cada clic. */
                .wp-box:has(.wp-search input:focus) { border-color: var(--primary-500); box-shadow: 0 0 0 3px var(--accent-tint); }

                .wp-list {
                    display: flex; flex-direction: column; gap: 2px;
                    overflow-y: auto; padding: 4px;
                    background: none;
                }
                .wp-row {
                    display: flex; align-items: center; gap: var(--space-3);
                    width: 100%; text-align: left; padding: 8px 10px;
                    background: transparent; border: 1px solid transparent; border-radius: var(--radius-sm);
                    cursor: pointer; color: inherit; font: inherit;
                    transition: background var(--transition-fast), border-color var(--transition-fast);
                }
                .wp-compact .wp-row { padding: 5px 8px; gap: var(--space-2); }
                .wp-row:hover:not(:disabled) { background: var(--surface-hover); }
                .wp-row:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
                .wp-row.selected { background: var(--accent-tint); border-color: var(--primary-500); }
                .wp-row.locked { opacity: 0.55; cursor: default; }
                /* Convocado: barra de color al costado, sin competir con el estado seleccionado */
                .wp-row.highlighted { box-shadow: inset 3px 0 0 var(--accent); }

                .wp-avatar {
                    width: 28px; height: 28px; flex-shrink: 0; border-radius: 50%;
                    background: var(--surface-hover); color: var(--text-secondary);
                    display: flex; align-items: center; justify-content: center;
                    font-size: 12px; font-weight: 600; text-transform: uppercase;
                }
                .wp-compact .wp-avatar { width: 24px; height: 24px; font-size: 11px; }
                .wp-identity { display: flex; flex-direction: column; gap: 1px; min-width: 0; flex: 1; }
                .wp-name { font-size: var(--text-sm); font-weight: 500; color: var(--text-primary); display: inline-flex; align-items: center; gap: 6px; flex-wrap: wrap; }
                .wp-role { font-size: var(--text-xs); color: var(--text-muted); }
                .wp-tag { font-size: 10px; font-weight: 600; letter-spacing: .02em; color: var(--accent-text); background: var(--accent-tint); padding: 1px 6px; border-radius: var(--radius-full); }

                .wp-check {
                    width: 20px; height: 20px; flex-shrink: 0; border-radius: var(--radius-sm);
                    border: 1.5px solid var(--surface-border); background: var(--surface-card);
                    display: flex; align-items: center; justify-content: center; color: #fff;
                    transition: background var(--transition-fast), border-color var(--transition-fast);
                }
                .wp-row.selected .wp-check { background: var(--primary-500); border-color: var(--primary-500); }

                /* variant="flat": mismo trazo que "Trabajadores asignados" en Obra
                   nueva — casillero nativo y filas separadas por línea, sin avatar
                   ni fondo de seleccionado. */
                .wp-list-flat { gap: 0; padding: 0; }
                .wp-flat-row {
                    display: flex; align-items: center; gap: var(--space-2);
                    padding: var(--space-2) var(--space-3); cursor: pointer;
                }
                .wp-flat-row.locked { opacity: 0.55; cursor: default; }
                .wp-compact .wp-flat-row { padding: 6px 10px; }
                .wp-flat-identity { display: flex; flex-direction: column; gap: 1px; min-width: 0; flex: 1; }
                .wp-flat-identity > span:first-child { display: inline-flex; align-items: center; gap: 6px; flex-wrap: wrap; }
                .wp-flat-meta { font-size: var(--text-xs); }
            `}</style>
        </div>
    );
}
