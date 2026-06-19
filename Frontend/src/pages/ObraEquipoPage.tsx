import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { obrasApi, workersApi } from '../api/client';
import { useCargoCatalog } from '../hooks/useCargoCatalog';
import { AlertBanner, PageHeader } from '../components/ui';
import { PERMISSIONS } from '../permissions';
import FirmaAsistidaModal from '../components/FirmaAsistidaModal';
import { useNavigate } from 'react-router-dom';
import { FiSearch, FiUserPlus, FiCheck, FiX } from 'react-icons/fi';
import { LuCircleCheck } from 'react-icons/lu';

const initials = (nombre: string, apellido?: string) =>
    `${nombre[0] ?? ''}${apellido?.[0] ?? nombre[1] ?? ''}`.toUpperCase();

export default function ObraEquipoPage() {
    const { user, hasPermission } = useAuth();
    const { obraId } = useParams<{ obraId: string }>();
    const navigate = useNavigate();
    const { options: cargoOptions } = useCargoCatalog();

    const canAsignar = hasPermission(PERMISSIONS.OBRA_ASIGNAR_TRABAJADORES);
    const canFirmaAsistida = hasPermission(PERMISSIONS.OBRA_FIRMA_ASISTIDA);

    const [obra, setObra] = useState<any | null>(null);
    const [workers, setWorkers] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [updating, setUpdating] = useState<string | null>(null);
    const [toast, setToast] = useState<string | null>(null);
    const [search, setSearch] = useState('');
    const [searchAssigned, setSearchAssigned] = useState('');
    // cargo selection per worker (for adding/updating)
    const [assignCargos, setAssignCargos] = useState<Record<string, string[]>>({});
    // firma asistida
    const [firmaOpen, setFirmaOpen] = useState(false);
    const [firmaWorkerId, setFirmaWorkerId] = useState<string | undefined>(undefined);

    const showToast = (msg: string) => {
        setToast(msg);
        setTimeout(() => setToast(null), 3000);
    };

    const reloadWorkers = async () => {
        const res = await workersApi.list();
        if (res.success && res.data) setWorkers(res.data as any[]);
    };

    useEffect(() => {
        if (!obraId) return;
        let alive = true;
        Promise.all([obrasApi.getById(obraId), workersApi.list()])
            .then(([oRes, wRes]) => {
                if (!alive) return;
                if (oRes.success && oRes.data) setObra(oRes.data);
                if (wRes.success && wRes.data) setWorkers(wRes.data as any[]);
            })
            .catch(() => alive && setError('Error de conexión al cargar datos'))
            .finally(() => alive && setLoading(false));
        return () => { alive = false; };
    }, [obraId]);

    const assigned = useMemo(
        () => workers.filter((w) => Array.isArray(w.obraIds) && w.obraIds.includes(obraId)),
        [workers, obraId]
    );
    const unassigned = useMemo(
        () => workers.filter((w) => !(Array.isArray(w.obraIds) && w.obraIds.includes(obraId))),
        [workers, obraId]
    );

    const filteredUnassigned = useMemo(() => {
        const s = search.toLowerCase();
        if (!s) return unassigned;
        return unassigned.filter(
            (w) =>
                w.nombre?.toLowerCase().includes(s) ||
                (w.apellido || '').toLowerCase().includes(s) ||
                w.rut?.toLowerCase().includes(s)
        );
    }, [unassigned, search]);

    const cargosActuales = (w: any): string[] => {
        const a = (w.asignaciones || []).find((x: any) => x.obraId === obraId);
        if (a && Array.isArray(a.cargos) && a.cargos.length) return a.cargos;
        return w.cargo ? [w.cargo] : [];
    };

    const handleAdd = async (w: any) => {
        if (!obraId) return;
        setUpdating(w.personaId);
        try {
            const cargos = assignCargos[w.personaId] || (w.cargo ? [w.cargo] : []);
            await workersApi.setAsignacion(w.personaId, obraId, cargos, user?.personaId || user?.userId);
            if (w.estado === 'inactivo') await workersApi.update(w.personaId, { estado: 'activo' } as any);
            await reloadWorkers();
            setAssignCargos((p) => { const n = { ...p }; delete n[w.personaId]; return n; });
            showToast(`${w.nombre} ${w.apellido || ''} agregado a la obra`);
        } catch { setError('No se pudo agregar el trabajador'); }
        finally { setUpdating(null); }
    };

    const handleBaja = async (w: any) => {
        if (!obraId || w.rol === 'admin') return;
        setUpdating(w.personaId);
        try {
            await workersApi.update(w.personaId, { estado: 'inactivo' } as any);
            await reloadWorkers();
            showToast(`${w.nombre} dado de baja`);
        } catch { setError('No se pudo dar de baja'); }
        finally { setUpdating(null); }
    };

    const handleReactivar = async (w: any) => {
        if (!obraId) return;
        setUpdating(w.personaId);
        try {
            const cargos = cargosActuales(w);
            await workersApi.setAsignacion(w.personaId, obraId, cargos, user?.personaId || user?.userId);
            await workersApi.update(w.personaId, { estado: 'activo' } as any);
            await reloadWorkers();
            showToast(`${w.nombre} reactivado`);
        } catch { setError('No se pudo reactivar'); }
        finally { setUpdating(null); }
    };

    const handleUpdateCargos = async (w: any) => {
        if (!obraId) return;
        setUpdating(w.personaId);
        try {
            const cargos = assignCargos[w.personaId] ?? cargosActuales(w);
            await workersApi.setAsignacion(w.personaId, obraId, cargos, user?.personaId || user?.userId);
            await reloadWorkers();
            setAssignCargos((p) => { const n = { ...p }; delete n[w.personaId]; return n; });
            showToast('Cargo actualizado');
        } catch { setError('No se pudo actualizar el cargo'); }
        finally { setUpdating(null); }
    };

    const toggleCargo = (workerId: string, cargoCode: string, base: string[]) => {
        setAssignCargos((prev) => {
            const curr = prev[workerId] ?? base;
            const next = curr.includes(cargoCode) ? curr.filter((c) => c !== cargoCode) : [...curr, cargoCode];
            return { ...prev, [workerId]: next };
        });
    };

    const activeAssigned = assigned.filter((w) => w.estado !== 'inactivo');
    const inactiveAssigned = assigned.filter((w) => w.estado === 'inactivo');

    const filteredActiveAssigned = useMemo(() => {
        const s = searchAssigned.toLowerCase();
        if (!s) return activeAssigned;
        return activeAssigned.filter(
            (w) =>
                w.nombre?.toLowerCase().includes(s) ||
                (w.apellido || '').toLowerCase().includes(s) ||
                w.rut?.toLowerCase().includes(s)
        );
    }, [activeAssigned, searchAssigned]);

    const obraName = obra?.nombre || obra?.codigo || obraId || '…';

    if (loading) return (
        <div className="page-content" style={{ display: 'flex', justifyContent: 'center', paddingTop: 64 }}>
            <div className="spinner" />
        </div>
    );

    return (
        <div className="page-content">
            <PageHeader
                banner
                scope={{ label: obraName }}
                title="Gestionar equipo"
                description={`Agrega, asigna cargos o da de baja trabajadores de ${obraName}.`}
                backTo={`/obras/${obraId}`}
            />

            {error && <AlertBanner variant="error" message={error} onDismiss={() => setError('')} />}

            {/* ── Trabajadores en esta obra ── */}
            <div className="card eq-section">
                <div className="eq-section-head">
                    <div>
                        <div className="eq-section-title">En esta obra</div>
                        <div className="eq-section-sub">{activeAssigned.length} activos{inactiveAssigned.length > 0 ? ` · ${inactiveAssigned.length} dados de baja` : ''}</div>
                    </div>
                    <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', flexWrap: 'wrap' }}>
                        <div className="eq-search-wrap">
                            <FiSearch size={14} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                            <input
                                className="form-input"
                                style={{ flex: 1, fontSize: 'var(--text-sm)', minWidth: 160 }}
                                placeholder="Buscar en obra…"
                                value={searchAssigned}
                                onChange={(e) => setSearchAssigned(e.target.value)}
                            />
                        </div>
                        {canFirmaAsistida && (
                            <button className="btn btn-secondary btn-sm" onClick={() => { setFirmaWorkerId(undefined); setFirmaOpen(true); }}>
                                Firma asistida
                            </button>
                        )}
                    </div>
                </div>

                {assigned.length === 0 ? (
                    <div style={{ padding: 'var(--space-4)', textAlign: 'center', color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>
                        No hay trabajadores asignados. Agrégalos desde la sección de abajo.
                    </div>
                ) : (
                    <div className="eq-worker-list">
                        {filteredActiveAssigned.length === 0 && searchAssigned && (
                            <div style={{ padding: 'var(--space-3)', textAlign: 'center', color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>
                                Sin resultados para «{searchAssigned}».
                            </div>
                        )}
                        {filteredActiveAssigned.map((w) => {
                            const currCargos = assignCargos[w.personaId] ?? cargosActuales(w);
                            const isDirty = !!assignCargos[w.personaId];
                            return (
                                <div
                                    key={w.personaId}
                                    className="eq-worker-row"
                                    style={{ cursor: 'pointer' }}
                                    onClick={() => navigate(`/personas/${encodeURIComponent(w.rut)}`)}
                                >
                                    <div className="eq-worker-avatar">{initials(w.nombre, w.apellido)}</div>
                                    <div className="eq-worker-info">
                                        <div className="eq-worker-name">{w.nombre} {w.apellido || ''}</div>
                                        <div className="eq-worker-rut">{w.rut}</div>
                                    </div>
                                    {/* Selector de cargos — stop propagation to prevent row click */}
                                    <div className="eq-cargo-pills" onClick={(e) => e.stopPropagation()}>
                                        {cargoOptions.map((opt) => (
                                            <button
                                                key={opt.value}
                                                type="button"
                                                className={`eq-cargo-pill${currCargos.includes(opt.value) ? ' eq-cargo-pill--sel' : ''}`}
                                                onClick={() => toggleCargo(w.personaId, opt.value, cargosActuales(w))}
                                            >
                                                {opt.label}
                                            </button>
                                        ))}
                                    </div>
                                    <div className="eq-worker-actions" onClick={(e) => e.stopPropagation()}>
                                        {isDirty && (
                                            <button
                                                className="btn btn-primary btn-sm"
                                                disabled={updating === w.personaId}
                                                onClick={() => handleUpdateCargos(w)}
                                            >
                                                <FiCheck size={13} /> Guardar
                                            </button>
                                        )}
                                        {canFirmaAsistida && (
                                            <button
                                                className="btn btn-secondary btn-sm"
                                                onClick={() => { setFirmaWorkerId(w.personaId); setFirmaOpen(true); }}
                                            >
                                                Firma asistida
                                            </button>
                                        )}
                                        <button
                                            className="btn btn-ghost btn-sm"
                                            style={{ color: 'var(--danger-500)' }}
                                            disabled={updating === w.personaId || w.rol === 'admin'}
                                            onClick={() => handleBaja(w)}
                                        >
                                            <FiX size={13} /> Baja
                                        </button>
                                    </div>
                                </div>
                            );
                        })}
                        {inactiveAssigned.length > 0 && (
                            <details className="eq-baja-section">
                                <summary className="eq-baja-summary">
                                    Dados de baja · {inactiveAssigned.length}
                                </summary>
                                <div className="eq-worker-list" style={{ marginTop: 'var(--space-2)' }}>
                                    {inactiveAssigned.map((w) => (
                                        <div key={w.personaId} className="eq-worker-row eq-worker-row--inactive">
                                            <div className="eq-worker-avatar eq-worker-avatar--inactive">{initials(w.nombre, w.apellido)}</div>
                                            <div className="eq-worker-info">
                                                <div className="eq-worker-name">{w.nombre} {w.apellido || ''}</div>
                                                <div className="eq-worker-rut">{w.rut}</div>
                                            </div>
                                            <div style={{ flex: 1 }} />
                                            <div className="eq-worker-actions">
                                                <button
                                                    className="btn btn-primary btn-sm"
                                                    disabled={updating === w.personaId}
                                                    onClick={() => handleReactivar(w)}
                                                >
                                                    Reactivar
                                                </button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </details>
                        )}
                    </div>
                )}
            </div>

            {/* ── Agregar trabajadores ── */}
            {canAsignar && (
                <div className="card eq-section">
                    <div className="eq-section-head">
                        <div>
                            <div className="eq-section-title">Agregar trabajadores</div>
                            <div className="eq-section-sub">{filteredUnassigned.length} disponibles en la empresa</div>
                        </div>
                        <div className="eq-search-wrap">
                            <FiSearch size={15} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                            <input
                                className="form-input"
                                style={{ flex: 1, fontSize: 'var(--text-sm)' }}
                                placeholder="Buscar por nombre o RUT…"
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                            />
                        </div>
                    </div>

                    {filteredUnassigned.length === 0 ? (
                        <div style={{ padding: 'var(--space-4)', textAlign: 'center', color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>
                            {search ? 'Sin resultados para esa búsqueda.' : 'Todos los trabajadores de la empresa ya están asignados a esta obra.'}
                        </div>
                    ) : (
                        <div className="eq-worker-list">
                            {filteredUnassigned.map((w) => {
                                const currCargos = assignCargos[w.personaId] || (w.cargo ? [w.cargo] : []);
                                return (
                                    <div key={w.personaId} className="eq-worker-row">
                                        <div className="eq-worker-avatar">{initials(w.nombre, w.apellido)}</div>
                                        <div className="eq-worker-info">
                                            <div className="eq-worker-name">{w.nombre} {w.apellido || ''}</div>
                                            <div className="eq-worker-rut">{w.rut} · {w.cargo || 'Sin cargo'}</div>
                                        </div>
                                        <div className="eq-cargo-pills">
                                            {cargoOptions.map((opt) => (
                                                <button
                                                    key={opt.value}
                                                    type="button"
                                                    className={`eq-cargo-pill${currCargos.includes(opt.value) ? ' eq-cargo-pill--sel' : ''}`}
                                                    onClick={() => toggleCargo(w.personaId, opt.value, w.cargo ? [w.cargo] : [])}
                                                >
                                                    {opt.label}
                                                </button>
                                            ))}
                                        </div>
                                        <div className="eq-worker-actions">
                                            <button
                                                className="btn btn-primary btn-sm"
                                                disabled={updating === w.personaId}
                                                onClick={() => handleAdd(w)}
                                            >
                                                {updating === w.personaId ? '…' : <><FiUserPlus size={13} /> Agregar</>}
                                            </button>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            )}

            {/* Firma asistida */}
            <FirmaAsistidaModal
                isOpen={firmaOpen}
                onClose={() => { setFirmaOpen(false); setFirmaWorkerId(undefined); }}
                obraId={obraId ?? ''}
                workers={assigned}
                asistidoPor={user?.personaId || user?.userId || ''}
                initialWorkerId={firmaWorkerId}
            />

            {/* Toast */}
            {toast && (
                <div style={{
                    position: 'fixed', bottom: 24, right: 24, zIndex: 9999,
                    background: 'var(--cchc-navy, #002952)', color: '#fff',
                    padding: '12px 20px', borderRadius: 'var(--radius-md)',
                    boxShadow: '0 4px 20px rgba(0,0,0,0.2)',
                    display: 'flex', alignItems: 'center', gap: 10,
                    fontSize: 'var(--text-sm)', fontWeight: 500,
                }}>
                    <LuCircleCheck size={16} /> {toast}
                </div>
            )}

            <style>{`
                .spinner {
                    width: 28px; height: 28px; border: 3px solid var(--surface-border);
                    border-top-color: var(--primary-500); border-radius: 50%;
                    animation: spin 0.8s linear infinite;
                }
                @keyframes spin { to { transform: rotate(360deg); } }

                .eq-section { padding: var(--space-4); margin-bottom: var(--space-4); }
                .eq-section-head {
                    display: flex; align-items: flex-start; justify-content: space-between;
                    gap: var(--space-3); flex-wrap: wrap; margin-bottom: var(--space-4);
                }
                .eq-section-title { font-weight: 700; font-size: var(--text-base); color: var(--text-primary); margin-bottom: 2px; }
                .eq-section-sub { font-size: var(--text-xs); color: var(--text-muted); }

                .eq-search-wrap {
                    display: flex; align-items: center; gap: var(--space-2);
                    border: 1px solid var(--surface-border); border-radius: var(--radius-md);
                    padding: 0 var(--space-2); background: var(--surface); min-width: 240px;
                }
                .eq-search-wrap .form-input {
                    border: none; box-shadow: none; background: transparent; padding: 6px 0;
                }

                .eq-worker-list { display: flex; flex-direction: column; gap: var(--space-2); }
                .eq-worker-row {
                    display: flex; align-items: center; gap: var(--space-3); flex-wrap: wrap;
                    padding: var(--space-3); border: 1px solid var(--surface-border);
                    border-radius: var(--radius-md); background: var(--surface);
                    transition: border-color 0.15s;
                }
                .eq-worker-row:hover { border-color: var(--accent); }
                .eq-worker-row--inactive { opacity: 0.65; }

                .eq-worker-avatar {
                    width: 36px; height: 36px; border-radius: 50%; flex-shrink: 0;
                    display: flex; align-items: center; justify-content: center;
                    font-weight: 700; font-size: var(--text-sm); text-transform: uppercase;
                    background: rgba(0,110,220,0.12); color: #4d9fff;
                    border: 1.5px solid rgba(0,110,220,0.25);
                }
                .eq-worker-avatar--inactive { background: var(--surface-hover); color: var(--text-muted); border-color: var(--surface-border); }

                .eq-worker-info { min-width: 140px; }
                .eq-worker-name { font-weight: 600; font-size: var(--text-sm); color: var(--text-primary); }
                .eq-worker-rut { font-size: var(--text-xs); color: var(--text-muted); margin-top: 1px; }

                .eq-cargo-pills { display: flex; flex-wrap: wrap; gap: 4px; flex: 1; }
                .eq-cargo-pill {
                    font-size: 11px; padding: 2px 8px; border-radius: 999px;
                    border: 1px solid var(--surface-border); background: transparent;
                    color: var(--text-muted); cursor: pointer; transition: all 0.12s;
                }
                .eq-cargo-pill--sel {
                    border-color: var(--accent); background: var(--accent-tint);
                    color: var(--accent-text); font-weight: 600;
                }
                .eq-cargo-pill:hover:not(.eq-cargo-pill--sel) { border-color: var(--accent); color: var(--accent-text); }

                .eq-worker-actions { display: flex; gap: 6px; align-items: center; flex-shrink: 0; flex-wrap: wrap; }

                .eq-baja-section { margin-top: var(--space-2); }
                .eq-baja-summary {
                    font-size: var(--text-xs); font-weight: 600; color: var(--text-muted);
                    text-transform: uppercase; letter-spacing: 0.05em; cursor: pointer;
                    padding: var(--space-2) 0; list-style: none;
                }
                .eq-baja-summary::-webkit-details-marker { display: none; }
                .eq-baja-summary::before { content: '▶ '; font-size: 9px; }
                details[open] .eq-baja-summary::before { content: '▼ '; }
            `}</style>
        </div>
    );
}
