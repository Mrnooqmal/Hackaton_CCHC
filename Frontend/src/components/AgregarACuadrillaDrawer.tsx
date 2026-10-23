import { useMemo, useState } from 'react';
import { FiSearch } from 'react-icons/fi';
import { Drawer } from './ui';

export interface GrupoCandidatos {
    clave: string;
    titulo: string;
    personas: any[];
    /** De dónde viene cada persona: «en la obra», «se suma a la obra», «de Rodrigo Fuentes». */
    origen: (w: any) => string;
    /** Quienes todavía no están en la obra: su origen se destaca. */
    nueva?: boolean;
}

const nombreDe = (w: any) => `${w.nombre} ${w.apellido || ''}`.trim();
const iniciales = (w: any) => `${w.nombre?.[0] ?? ''}${w.apellido?.[0] ?? w.nombre?.[1] ?? ''}`.toUpperCase();

/**
 * Armar una cuadrilla sin arrastrar: lista con casillas de quienes pueden
 * sumarse (sin cuadrilla, fuera de la obra o en otra cuadrilla), con buscador,
 * filtros y «Seleccionar todos» por grupo. Confirma con un solo botón.
 *
 * Se monta con `key` por cuadrilla, así cada apertura parte sin marcas.
 */
export default function AgregarACuadrillaDrawer({
    isOpen, cuadrilla, grupos, onClose, onConfirm, cargoDe,
}: {
    isOpen: boolean;
    /** Nombre del supervisor de la cuadrilla destino. */
    cuadrilla: string;
    grupos: GrupoCandidatos[];
    onClose: () => void;
    onConfirm: (personaIds: string[]) => void;
    /** Cargo legible de la persona (el catálogo guarda códigos). */
    cargoDe?: (w: any) => string;
}) {
    const [marcadas, setMarcadas] = useState<Set<string>>(new Set());
    const [filtro, setFiltro] = useState('todas');
    const [q, setQ] = useState('');

    const visibles = useMemo(() => {
        const s = q.trim().toLowerCase();
        return grupos
            .filter((g) => filtro === 'todas' || filtro === g.clave)
            .map((g) => ({
                ...g,
                personas: s
                    ? g.personas.filter((w) => `${nombreDe(w)} ${w.rut || ''}`.toLowerCase().includes(s))
                    : g.personas,
            }))
            .filter((g) => g.personas.length > 0);
    }, [grupos, filtro, q]);

    const alternar = (id: string) => setMarcadas((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id); else next.add(id);
        return next;
    });
    const alternarGrupo = (personas: any[]) => setMarcadas((prev) => {
        const next = new Set(prev);
        const todas = personas.every((w) => next.has(w.personaId));
        personas.forEach((w) => (todas ? next.delete(w.personaId) : next.add(w.personaId)));
        return next;
    });

    const n = marcadas.size;
    const hayCandidatos = grupos.some((g) => g.personas.length > 0);

    return (
        <Drawer
            isOpen={isOpen}
            onClose={onClose}
            title={`Agregar a la Cuadrilla de ${cuadrilla}`}
            subtitle="Marca a quienes quieres sumar. Quien no está en la obra se agrega a ella en esta cuadrilla."
            width={480}
            footer={
                <div className="acd-pie">
                    <span className="acd-cuantos">
                        {n ? <><strong>{n}</strong> seleccionada{n > 1 ? 's' : ''}</> : 'Nadie seleccionado'}
                    </span>
                    <button type="button" className="btn btn-secondary" onClick={onClose}>Cancelar</button>
                    <button type="button" className="btn btn-primary" disabled={!n}
                        onClick={() => onConfirm([...marcadas])}>
                        {n ? `Agregar ${n} a la cuadrilla` : 'Agregar'}
                    </button>
                </div>
            }
        >
            <div className="acd">
                {hayCandidatos ? (
                    <>
                        <div className="acd-cab">
                            <label className="eq-search-wrap">
                                <FiSearch size={15} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                                <input
                                    className="form-input"
                                    style={{ flex: 1, fontSize: '13.5px', minWidth: 100 }}
                                    placeholder="Buscar por nombre o RUT…"
                                    aria-label="Buscar personas"
                                    value={q}
                                    onChange={(e) => setQ(e.target.value)}
                                />
                            </label>
                            <div className="acd-filtros" role="group" aria-label="Mostrar">
                                {[{ clave: 'todas', titulo: 'Todas' }, ...grupos.filter((g) => g.personas.length > 0)].map((g) => (
                                    <button key={g.clave} type="button" className="acd-filtro"
                                        aria-pressed={filtro === g.clave} onClick={() => setFiltro(g.clave)}>
                                        {g.titulo}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {visibles.length === 0 ? (
                            <p className="acd-vacio">No hay personas que coincidan con la búsqueda.</p>
                        ) : visibles.map((g) => {
                            const todas = g.personas.every((w) => marcadas.has(w.personaId));
                            return (
                                <section key={g.clave} className="acd-grupo" aria-label={g.titulo}>
                                    <div className="acd-grupo-head">
                                        <span>{g.titulo} · {g.personas.length}</span>
                                        <button type="button" onClick={() => alternarGrupo(g.personas)}>
                                            {todas ? 'Quitar' : 'Seleccionar todos'}
                                        </button>
                                    </div>
                                    {g.personas.map((w) => (
                                        <label key={w.personaId} className="acd-fila">
                                            <input type="checkbox" checked={marcadas.has(w.personaId)}
                                                onChange={() => alternar(w.personaId)} />
                                            <span className="acd-avatar" aria-hidden="true">{iniciales(w)}</span>
                                            <span className="acd-datos">
                                                <strong>{nombreDe(w)}</strong>
                                                <span>{[w.rut, cargoDe ? cargoDe(w) : (w.cargo || w.rolNombre)].filter(Boolean).join(' · ')}</span>
                                            </span>
                                            <span className={`acd-origen${g.nueva ? ' acd-origen--nueva' : ''}`}>{g.origen(w)}</span>
                                        </label>
                                    ))}
                                </section>
                            );
                        })}
                    </>
                ) : (
                    <p className="acd-vacio">
                        No hay trabajadores para sumar: todos los de la empresa ya están en esta cuadrilla.
                    </p>
                )}
            </div>

            <style>{`
                .acd { display: flex; flex-direction: column; gap: var(--space-2); }
                .acd-cab { display: flex; flex-direction: column; gap: var(--space-3); margin-bottom: var(--space-2); }
                .acd-filtros { display: flex; gap: 6px; flex-wrap: wrap; }
                .acd-filtro {
                    padding: 4px 10px; border: 1px solid var(--surface-border); border-radius: 999px;
                    background: none; color: var(--text-secondary); font-size: 12px; cursor: pointer;
                }
                .acd-filtro[aria-pressed="true"] {
                    background: var(--accent-tint); border-color: var(--accent); color: var(--accent-text); font-weight: 600;
                }
                .acd-grupo-head {
                    display: flex; align-items: center; justify-content: space-between; gap: 8px;
                    padding: 10px 0 6px; font-size: 11px; font-weight: 700; letter-spacing: 0.07em;
                    text-transform: uppercase; color: var(--text-secondary);
                }
                .acd-grupo-head button {
                    border: 0; background: none; padding: 2px 4px; cursor: pointer;
                    color: var(--accent-text); font-size: 12px; font-weight: 500; text-transform: none; letter-spacing: 0;
                }
                .acd-fila {
                    display: grid; grid-template-columns: 18px 32px minmax(0, 1fr) auto; align-items: center; gap: 12px;
                    padding: 8px 10px; margin: 0 -10px; border-radius: var(--radius-sm); cursor: pointer;
                }
                .acd-fila:hover { background: var(--surface-hover); }
                .acd-fila input { width: 17px; height: 17px; margin: 0; accent-color: var(--accent); cursor: pointer; }
                .acd-avatar {
                    width: 32px; height: 32px; border-radius: 50%; display: flex; align-items: center; justify-content: center;
                    font-size: 12px; font-weight: 700; color: var(--text-secondary);
                    background: color-mix(in srgb, var(--accent) 10%, transparent); border: 1px solid var(--surface-border);
                }
                .acd-datos { display: flex; flex-direction: column; min-width: 0; }
                .acd-datos strong { font-size: 13px; font-weight: 600; color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
                .acd-datos span { font-size: 11.5px; color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
                .acd-origen { font-size: 11px; color: var(--text-muted); white-space: nowrap; }
                .acd-origen--nueva { color: var(--accent-text); font-weight: 500; }
                .acd-vacio { font-size: var(--text-sm); color: var(--text-muted); margin: var(--space-4) 0; }
                .acd-pie { display: flex; align-items: center; gap: var(--space-2); width: 100%; }
                .acd-cuantos { flex: 1; font-size: 12.5px; color: var(--text-secondary); }
                .acd-cuantos strong { color: var(--text-primary); }
                @media (max-width: 480px) {
                    .acd-fila { grid-template-columns: 18px 32px minmax(0, 1fr); }
                    .acd-origen { grid-column: 3; margin-top: -6px; }
                }
            `}</style>
        </Drawer>
    );
}
