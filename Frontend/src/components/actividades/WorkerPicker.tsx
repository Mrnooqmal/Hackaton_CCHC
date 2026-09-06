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
                <>
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

                    <div className="wp-list" style={{ maxHeight }}>
                        {visibles.length === 0 ? (
                            <p className="wp-empty">Ningún trabajador coincide con «{search}».</p>
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
                </>
            )}

            <style>{`
                .wp { display: flex; flex-direction: column; gap: var(--space-2); }
                .wp-head { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); flex-wrap: wrap; }
                .wp-label { font-size: var(--text-sm); font-weight: 600; color: var(--text-secondary); display: inline-flex; align-items: center; gap: 6px; }
                .wp-count { font-size: 11px; font-weight: 700; color: var(--accent-text); background: var(--accent-tint); padding: 1px 7px; border-radius: var(--radius-full); }
                .wp-head-actions { display: flex; align-items: center; gap: var(--space-1); }
                .wp-empty { font-size: var(--text-sm); color: var(--text-muted); margin: 0; padding: var(--space-3) 0; }

                .wp-search { position: relative; display: flex; align-items: center; }
                .wp-search > svg { position: absolute; left: 11px; color: var(--text-muted); pointer-events: none; }
                .wp-search input {
                    width: 100%; padding: 8px 12px 8px 33px;
                    border: 1px solid var(--surface-border); border-radius: var(--radius-md);
                    background: var(--surface-bg); color: var(--text-primary); font-size: var(--text-sm);
                }
                .wp-search input:focus { outline: none; border-color: var(--primary-500); box-shadow: 0 0 0 3px var(--accent-tint); }

                .wp-list {
                    display: flex; flex-direction: column; gap: 2px;
                    overflow-y: auto; padding: 4px;
                    border: 1px solid var(--surface-border); border-radius: var(--radius-md);
                    background: var(--surface-bg);
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
            `}</style>
        </div>
    );
}
