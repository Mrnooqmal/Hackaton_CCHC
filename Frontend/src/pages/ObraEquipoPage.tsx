import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { obrasApi, workersApi } from '../api/client';
import { tenantsApi, type TenantRole } from '../api/tenants.api';
import { useCargoCatalog } from '../hooks/useCargoCatalog';
import { AlertBanner, PageHeader } from '../components/ui';
import { PERMISSIONS } from '../permissions';
import FirmaAsistidaModal from '../components/FirmaAsistidaModal';
import { useNavigate } from 'react-router-dom';
import { FiSearch, FiUserPlus, FiCheck, FiX, FiChevronDown, FiAlertTriangle, FiUsers, FiEdit2 } from 'react-icons/fi';
import { LuCircleCheck } from 'react-icons/lu';

// Cuadrilla left-border accent colors (cycle by supervisor index)
const CREW_COLORS = ['#006edc', '#16a34a', '#7c3aed', '#d97706', '#0891b2', '#db2777'];

const initials = (nombre: string, apellido?: string) =>
    `${nombre[0] ?? ''}${apellido?.[0] ?? nombre[1] ?? ''}`.toUpperCase();

const norm = (s: string) =>
    String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();

// Calcula la posición fija de un menú anclado a un disparador. Se usa para
// renderizar los dropdowns en un portal y así escapar del `overflow: hidden`
// de la tarjeta de cuadrilla (que recortaba la lista desplegada).
function useAnchoredMenu(open: boolean, anchorRef: React.RefObject<HTMLElement | null>) {
    const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);
    useLayoutEffect(() => {
        if (!open) { setPos(null); return; }
        const el = anchorRef.current;
        if (!el) return;
        const update = () => {
            const r = el.getBoundingClientRect();
            setPos({ top: r.bottom + 4, left: r.left, width: r.width });
        };
        update();
        window.addEventListener('scroll', update, true);
        window.addEventListener('resize', update);
        return () => {
            window.removeEventListener('scroll', update, true);
            window.removeEventListener('resize', update);
        };
    }, [open, anchorRef]);
    return pos;
}

// ── Dropdown de cargos con checkboxes ───────────────────────────────────────
function CargoDropdown({
    options, selected, onToggle,
}: {
    options: { value: string; label: string }[];
    selected: string[];
    onToggle: (code: string) => void;
}) {
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);
    const menuRef = useRef<HTMLDivElement>(null);
    const pos = useAnchoredMenu(open, ref);
    useEffect(() => {
        if (!open) return;
        const onDoc = (e: MouseEvent) => {
            const t = e.target as Node;
            if (ref.current?.contains(t) || menuRef.current?.contains(t)) return;
            setOpen(false);
        };
        document.addEventListener('mousedown', onDoc);
        return () => document.removeEventListener('mousedown', onDoc);
    }, [open]);

    const labels = options.filter((o) => selected.includes(o.value)).map((o) => o.label);
    const summary = labels.length === 0 ? 'Sin cargos' : labels.length <= 2 ? labels.join(', ') : `${labels.length} cargos`;

    return (
        <div className="eq-dd" ref={ref} onClick={(e) => e.stopPropagation()}>
            <button type="button" className="eq-dd-btn" onClick={() => setOpen((o) => !o)} title={labels.join(', ')}>
                <span className="eq-dd-btn-label">{summary}</span>
                <FiChevronDown size={13} style={{ flexShrink: 0, opacity: 0.6 }} />
            </button>
            {open && pos && createPortal(
                <div
                    className="eq-dd-menu"
                    ref={menuRef}
                    style={{ position: 'fixed', top: pos.top, left: pos.left, minWidth: Math.max(pos.width, 200) }}
                    onClick={(e) => e.stopPropagation()}
                >
                    {options.map((opt) => (
                        <label key={opt.value} className="eq-dd-item">
                            <input type="checkbox" checked={selected.includes(opt.value)} onChange={() => onToggle(opt.value)} />
                            <span>{opt.label}</span>
                        </label>
                    ))}
                </div>,
                document.body
            )}
        </div>
    );
}

// ── Autocompletador de supervisores ─────────────────────────────────────────
function SupervisorAutocomplete({
    options, value, onChange, placeholder = 'Buscar supervisor…', allowClear = true,
}: {
    options: { value: string; label: string }[];
    value: string;
    onChange: (v: string) => void;
    placeholder?: string;
    allowClear?: boolean;
}) {
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState('');
    const ref = useRef<HTMLDivElement>(null);
    const menuRef = useRef<HTMLDivElement>(null);
    const pos = useAnchoredMenu(open, ref);
    const selected = options.find((o) => o.value === value) || null;

    useEffect(() => {
        if (!open) return;
        const onDoc = (e: MouseEvent) => {
            const t = e.target as Node;
            if (ref.current?.contains(t) || menuRef.current?.contains(t)) return;
            setOpen(false); setQuery('');
        };
        document.addEventListener('mousedown', onDoc);
        return () => document.removeEventListener('mousedown', onDoc);
    }, [open]);

    const filtered = options.filter((o) => norm(o.label).includes(norm(query)));

    return (
        <div className="eq-ac" ref={ref} onClick={(e) => e.stopPropagation()}>
            <div className={`eq-ac-control${!value ? ' eq-ac-control--warn' : ''}`} onClick={() => setOpen(true)}>
                <FiSearch size={13} style={{ flexShrink: 0, opacity: 0.55 }} />
                <input
                    className="eq-ac-input"
                    value={open ? query : (selected?.label ?? '')}
                    placeholder={selected ? selected.label : placeholder}
                    onFocus={() => { setOpen(true); setQuery(''); }}
                    onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
                />
                {value && allowClear && !open && (
                    <button type="button" className="eq-ac-clear" title="Quitar" onClick={(e) => { e.stopPropagation(); onChange(''); }}>
                        <FiX size={12} />
                    </button>
                )}
                <FiChevronDown size={13} style={{ flexShrink: 0, opacity: 0.6 }} />
            </div>
            {open && pos && createPortal(
                <div
                    className="eq-dd-menu"
                    ref={menuRef}
                    style={{ position: 'fixed', top: pos.top, left: pos.left, minWidth: Math.max(pos.width, 200) }}
                    onClick={(e) => e.stopPropagation()}
                >
                    {filtered.length === 0 && <div className="eq-ac-empty">Sin coincidencias</div>}
                    {filtered.map((o) => (
                        <button
                            type="button"
                            key={o.value}
                            className={`eq-ac-item${o.value === value ? ' eq-ac-item--sel' : ''}`}
                            onClick={() => { onChange(o.value); setOpen(false); setQuery(''); }}
                        >
                            {o.label}
                        </button>
                    ))}
                </div>,
                document.body
            )}
        </div>
    );
}

export default function ObraEquipoPage() {
    const { user, hasPermission } = useAuth();
    const { obraId } = useParams<{ obraId: string }>();
    const navigate = useNavigate();
    const { options: cargoOptions } = useCargoCatalog();

    const canAsignar = hasPermission(PERMISSIONS.OBRA_ASIGNAR_TRABAJADORES);
    const canFirmaAsistida = hasPermission(PERMISSIONS.OBRA_FIRMA_ASISTIDA);

    const [obra, setObra] = useState<any | null>(null);
    const [workers, setWorkers] = useState<any[]>([]);
    const [roles, setRoles] = useState<TenantRole[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [updating, setUpdating] = useState<string | null>(null);
    const [toast, setToast] = useState<string | null>(null);
    const [search, setSearch] = useState('');
    const [searchAssigned, setSearchAssigned] = useState('');
    const [assignCargos, setAssignCargos] = useState<Record<string, string[]>>({});
    const [assignSupervisor, setAssignSupervisor] = useState<Record<string, string>>({});
    const [firmaOpen, setFirmaOpen] = useState(false);
    const [firmaWorkerId, setFirmaWorkerId] = useState<string | undefined>(undefined);
    // Track which person rows are expanded for editing
    const [expandedWorkers, setExpandedWorkers] = useState<Set<string>>(new Set());

    const tenantId = (user as any)?.tenantId as string | undefined;

    const toggleExpand = (id: string) =>
        setExpandedWorkers((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
        });

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
        Promise.all([
            obrasApi.getById(obraId),
            workersApi.list(),
            tenantId ? tenantsApi.get(tenantId) : Promise.resolve(null),
        ])
            .then(([oRes, wRes, tRes]) => {
                if (!alive) return;
                if (oRes.success && oRes.data) setObra(oRes.data);
                if (wRes.success && wRes.data) setWorkers(wRes.data as any[]);
                if (tRes && (tRes as any).success && (tRes as any).data) setRoles(((tRes as any).data.roles || []) as TenantRole[]);
            })
            .catch(() => alive && setError('Error de conexión al cargar datos'))
            .finally(() => alive && setLoading(false));
        return () => { alive = false; };
    }, [obraId, tenantId]);

    // ── Helpers de rol / cargo / cuadrilla ───────────────────────────────────
    const rolOptions = useMemo(
        () => roles.filter((r) => r.tipo !== 'admin').map((r) => ({ value: r.id, label: r.nombre })),
        [roles]
    );

    const currentRoleId = (w: any): string => {
        const byId = roles.find((r) => r.id === w.rol);
        if (byId) return byId.id;
        const byName = roles.find((r) => norm(r.nombre) === norm(w.rol) || norm(r.nombre) === norm(w.rolNombre));
        return byName?.id ?? (w.rol || '');
    };
    const rolTipoDe = (w: any): string | null => {
        if (w.rolTipo) return w.rolTipo;
        const r = roles.find((x) => x.id === currentRoleId(w));
        return (r?.tipo as string) || null;
    };

    const asignacionDe = (w: any) => (w.asignaciones || []).find((x: any) => x.obraId === obraId);
    const cargosActuales = (w: any): string[] => {
        const a = asignacionDe(w);
        if (a && Array.isArray(a.cargos) && a.cargos.length) return a.cargos;
        return w.cargo ? [w.cargo] : [];
    };
    const supervisorDe = (w: any): string | null => asignacionDe(w)?.supervisorPersonaId || null;

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

    // ── Acciones ─────────────────────────────────────────────────────────────
    const handleAdd = async (w: any) => {
        if (!obraId) return;
        const esTrabajador = rolTipoDe(w) === 'trabajador';
        const haySupervisores = supervisorSelectOptions.length > 0;
        const supervisorId = assignSupervisor[w.personaId];
        if (esTrabajador && haySupervisores && !supervisorId) {
            showToast('Selecciona un supervisor para esta persona trabajadora.');
            return;
        }
        setUpdating(w.personaId);
        try {
            const cargos = assignCargos[w.personaId] || (w.cargo ? [w.cargo] : []);
            await workersApi.setAsignacion(
                w.personaId, obraId, cargos, user?.personaId || user?.userId,
                esTrabajador ? supervisorId : null,
            );
            if (w.estado === 'inactivo') await workersApi.update(w.personaId, { estado: 'activo' } as any);
            await reloadWorkers();
            setAssignCargos((p) => { const n = { ...p }; delete n[w.personaId]; return n; });
            setAssignSupervisor((p) => { const n = { ...p }; delete n[w.personaId]; return n; });
            showToast(`${w.nombre} ${w.apellido || ''} agregado a la obra`);
        } catch (e: any) { setError(e?.message || 'No se pudo agregar el trabajador'); }
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
            await workersApi.setAsignacion(w.personaId, obraId, cargos, user?.personaId || user?.userId, supervisorDe(w));
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

    const handleRolChange = async (w: any, roleId: string) => {
        if (!roleId || roleId === currentRoleId(w)) return;
        setUpdating(w.personaId);
        try {
            await workersApi.update(w.personaId, { rol: roleId } as any);
            await reloadWorkers();
            showToast('Rol actualizado');
        } catch { setError('No se pudo cambiar el rol'); }
        finally { setUpdating(null); }
    };

    const handleSupervisorChange = async (w: any, supervisorId: string) => {
        if (!obraId || supervisorId === (supervisorDe(w) || '')) return;
        setUpdating(w.personaId);
        try {
            await workersApi.setAsignacion(
                w.personaId, obraId, cargosActuales(w), user?.personaId || user?.userId, supervisorId || null,
            );
            await reloadWorkers();
            showToast(supervisorId ? 'Cuadrilla actualizada' : 'Supervisor quitado');
        } catch (e: any) { setError(e?.message || 'No se pudo actualizar la cuadrilla'); }
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

    const matchesSearch = (w: any) => {
        const s = searchAssigned.toLowerCase();
        if (!s) return true;
        return w.nombre?.toLowerCase().includes(s) || (w.apellido || '').toLowerCase().includes(s) || w.rut?.toLowerCase().includes(s);
    };

    // ── Agrupación por cuadrilla ──────────────────────────────────────────────
    const supervisores = useMemo(
        () => activeAssigned.filter((w) => rolTipoDe(w) === 'supervisor'),
        [activeAssigned, roles]
    );
    const trabajadores = useMemo(
        () => activeAssigned.filter((w) => rolTipoDe(w) === 'trabajador'),
        [activeAssigned, roles]
    );
    const gestion = useMemo(
        () => activeAssigned.filter((w) => !['supervisor', 'trabajador'].includes(rolTipoDe(w) || '')),
        [activeAssigned, roles]
    );
    const supervisorIds = useMemo(() => new Set(supervisores.map((s) => s.personaId)), [supervisores]);

    const cuadrillaDe = (supId: string) => trabajadores.filter((w) => supervisorDe(w) === supId);
    const sinCuadrilla = useMemo(
        () => trabajadores.filter((w) => { const s = supervisorDe(w); return !s || !supervisorIds.has(s); }),
        [trabajadores, supervisorIds]
    );

    const supervisorSelectOptions = supervisores.map((s) => ({ value: s.personaId, label: `${s.nombre} ${s.apellido || ''}`.trim() }));

    const obraName = obra?.nombre || obra?.codigo || obraId || '…';

    // ── Render: fila de persona colapsable ────────────────────────────────────
    const renderPersonRow = (w: any, opts: {
        showSupervisor?: boolean;
        variant?: 'supervisor' | 'worker';
    } = {}) => {
        const { variant = 'worker', showSupervisor = false } = opts;
        const isSup = variant === 'supervisor';
        const isExpanded = expandedWorkers.has(w.personaId);
        const currCargos = assignCargos[w.personaId] ?? cargosActuales(w);
        const isDirty = !!assignCargos[w.personaId];
        const roleId = currentRoleId(w);
        const sup = supervisorDe(w) || '';
        const cargoLabels = currCargos.map((c) => cargoOptions.find((o) => o.value === c)?.label || c);

        return (
            <div key={w.personaId} className={`eq-prow${isSup ? ' eq-prow--supervisor' : ''}${isExpanded ? ' eq-prow--expanded' : ''}`}>
                {/* Always-visible summary bar */}
                <div className="eq-prow-bar">
                    <div
                        className={`eq-worker-avatar${isSup ? ' eq-sup-avatar' : ''}`}
                        style={{ cursor: 'pointer' }}
                        onClick={() => navigate(`/personas/${encodeURIComponent(w.rut)}`)}
                    >
                        {initials(w.nombre, w.apellido)}
                    </div>

                    <div
                        className="eq-prow-info"
                        onClick={() => navigate(`/personas/${encodeURIComponent(w.rut)}`)}
                    >
                        <span className={isSup ? 'eq-sup-name' : 'eq-worker-name'}>
                            {w.nombre} {w.apellido || ''}
                        </span>
                        <span className="eq-worker-rut">
                            {isSup ? 'Supervisor · ' : ''}{w.rut}
                        </span>
                    </div>

                    {!isSup && (
                        <div className="eq-cargo-chips">
                            {cargoLabels.length > 0
                                ? cargoLabels.map((l, i) => <span key={i} className="eq-cargo-chip">{l}</span>)
                                : <span className="eq-cargo-chip eq-cargo-chip--empty">Sin cargo</span>
                            }
                        </div>
                    )}

                    {isSup && <div style={{ flex: 1 }} />}

                    <div className="eq-prow-bar-actions" onClick={(e) => e.stopPropagation()}>
                        {canFirmaAsistida && (
                            <button
                                className="btn btn-secondary btn-sm"
                                onClick={() => { setFirmaWorkerId(w.personaId); setFirmaOpen(true); }}
                            >
                                {isSup ? 'Firma asistida' : 'Firma'}
                            </button>
                        )}
                        <button
                            className="eq-edit-toggle"
                            onClick={() => toggleExpand(w.personaId)}
                            title={isExpanded ? 'Cerrar' : 'Editar'}
                        >
                            <FiEdit2 size={13} className={`eq-edit-icon${isExpanded ? ' eq-edit-icon--active' : ''}`} />
                        </button>
                    </div>
                </div>

                {/* Expanded edit panel */}
                {isExpanded && (
                    <div className="eq-prow-panel" onClick={(e) => e.stopPropagation()}>
                        <label className="eq-ctrl">
                            <span className="eq-ctrl-label">Rol</span>
                            <select
                                className="eq-select"
                                value={roleId}
                                disabled={w.rol === 'admin' || updating === w.personaId}
                                onChange={(e) => handleRolChange(w, e.target.value)}
                            >
                                {!rolOptions.some((o) => o.value === roleId) && (
                                    <option value={roleId}>{w.rolNombre || w.rol}</option>
                                )}
                                {rolOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                            </select>
                        </label>

                        <label className="eq-ctrl">
                            <span className="eq-ctrl-label">Cargos</span>
                            <CargoDropdown
                                options={cargoOptions}
                                selected={currCargos}
                                onToggle={(code) => toggleCargo(w.personaId, code, cargosActuales(w))}
                            />
                        </label>

                        {showSupervisor && (
                            supervisorSelectOptions.length > 0 ? (
                                <label className="eq-ctrl eq-ctrl--wide">
                                    <span className="eq-ctrl-label">Cuadrilla</span>
                                    <SupervisorAutocomplete
                                        options={supervisorSelectOptions}
                                        value={sup}
                                        onChange={(v) => handleSupervisorChange(w, v)}
                                    />
                                </label>
                            ) : (
                                <div className="eq-sup-warn">
                                    <FiAlertTriangle size={14} style={{ flexShrink: 0 }} />
                                    <span>Sin supervisores — quedará sin cuadrilla temporalmente.</span>
                                </div>
                            )
                        )}

                        <div className="eq-prow-panel-actions">
                            {isDirty && (
                                <button
                                    className="btn btn-primary btn-sm"
                                    disabled={updating === w.personaId}
                                    onClick={() => handleUpdateCargos(w)}
                                >
                                    <FiCheck size={13} /> Guardar
                                </button>
                            )}
                            <button
                                className="btn btn-ghost btn-sm eq-baja-btn"
                                disabled={updating === w.personaId || w.rol === 'admin'}
                                onClick={() => handleBaja(w)}
                            >
                                <FiX size={13} /> Dar de baja
                            </button>
                        </div>
                    </div>
                )}
            </div>
        );
    };

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
                description={`Organiza cuadrillas, roles y cargos del equipo de ${obraName}.`}
                breadcrumb={[
                    { label: 'Detalle de obra', to: `/obras/${obraId}` },
                ]}
            />

            {error && <AlertBanner variant="error" message={error} onDismiss={() => setError('')} />}

            {/* ── Equipo en obra ── */}
            <div className="card eq-section">
                <div className="eq-section-head">
                    <div>
                        <div className="eq-section-title">En esta obra</div>
                        <div className="eq-section-sub">
                            {activeAssigned.length} activos · {supervisores.length} cuadrilla{supervisores.length !== 1 ? 's' : ''}
                            {sinCuadrilla.length > 0 ? ` · ${sinCuadrilla.length} sin cuadrilla` : ''}
                            {inactiveAssigned.length > 0 ? ` · ${inactiveAssigned.length} dados de baja` : ''}
                        </div>
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
                    <div className="eq-empty-state">
                        <FiUsers size={28} style={{ opacity: 0.25, marginBottom: 8 }} />
                        <span>No hay personas en esta obra. Agrégalas desde la sección de abajo.</span>
                    </div>
                ) : (
                    <div className="eq-groups">

                        {/* Trabajadores sin cuadrilla asignada */}
                        {sinCuadrilla.filter(matchesSearch).length > 0 && (
                            <div className="eq-crew eq-crew--warn">
                                <div className="eq-crew-header eq-crew-header--warn">
                                    <FiAlertTriangle size={14} />
                                    <span className="eq-crew-header-title">Sin cuadrilla asignada</span>
                                    <span className="eq-crew-badge eq-crew-badge--warn">{sinCuadrilla.length}</span>
                                    <span className="eq-crew-hint">Asigna cada trabajador a un supervisor.</span>
                                </div>
                                <div className="eq-prow-list">
                                    {sinCuadrilla.filter(matchesSearch).map((w) =>
                                        renderPersonRow(w, { showSupervisor: true })
                                    )}
                                </div>
                            </div>
                        )}

                        {/* Cuadrillas por supervisor */}
                        {supervisores.map((sup, idx) => {
                            const crewColor = CREW_COLORS[idx % CREW_COLORS.length];
                            const crew = cuadrillaDe(sup.personaId);
                            const visibleCrew = crew.filter(matchesSearch);
                            const supVisible = matchesSearch(sup);
                            if (!supVisible && visibleCrew.length === 0) return null;
                            return (
                                <div
                                    key={sup.personaId}
                                    className="eq-crew"
                                    style={{ '--crew-color': crewColor } as React.CSSProperties}
                                >
                                    {/* Supervisor como encabezado de la cuadrilla */}
                                    {renderPersonRow(sup, { variant: 'supervisor' })}

                                    {/* Trabajadores de la cuadrilla */}
                                    {visibleCrew.length > 0 && (
                                        <div className="eq-prow-list eq-prow-list--indented">
                                            {visibleCrew.map((w) =>
                                                renderPersonRow(w, { showSupervisor: true })
                                            )}
                                        </div>
                                    )}
                                    {crew.length === 0 && (
                                        <div className="eq-crew-empty">
                                            Cuadrilla sin trabajadores asignados.
                                        </div>
                                    )}
                                </div>
                            );
                        })}

                        {/* Equipo de gestión (roles que no son cuadrilla) */}
                        {gestion.filter(matchesSearch).length > 0 && (
                            <div className="eq-crew" style={{ '--crew-color': '#64748b' } as React.CSSProperties}>
                                <div className="eq-crew-header">
                                    <span className="eq-crew-header-title">Equipo de gestión</span>
                                    <span className="eq-crew-badge">{gestion.length}</span>
                                </div>
                                <div className="eq-prow-list">
                                    {gestion.filter(matchesSearch).map((w) => renderPersonRow(w))}
                                </div>
                            </div>
                        )}

                        {/* Dados de baja */}
                        {inactiveAssigned.length > 0 && (
                            <details className="eq-baja-section">
                                <summary className="eq-baja-summary">
                                    Dados de baja · {inactiveAssigned.length}
                                </summary>
                                <div className="eq-prow-list" style={{ marginTop: 'var(--space-2)' }}>
                                    {inactiveAssigned.map((w) => (
                                        <div key={w.personaId} className="eq-prow eq-prow--inactive">
                                            <div className="eq-prow-bar">
                                                <div className="eq-worker-avatar eq-worker-avatar--inactive">
                                                    {initials(w.nombre, w.apellido)}
                                                </div>
                                                <div className="eq-prow-info">
                                                    <span className="eq-worker-name">{w.nombre} {w.apellido || ''}</span>
                                                    <span className="eq-worker-rut">{w.rut}</span>
                                                </div>
                                                <div style={{ flex: 1 }} />
                                                <div className="eq-prow-bar-actions">
                                                    <button
                                                        className="btn btn-primary btn-sm"
                                                        disabled={updating === w.personaId}
                                                        onClick={() => handleReactivar(w)}
                                                    >
                                                        Reactivar
                                                    </button>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </details>
                        )}
                    </div>
                )}
            </div>

            {/* ── Agregar personas ── */}
            {canAsignar && (
                <div className="card eq-section">
                    <div className="eq-section-head">
                        <div>
                            <div className="eq-section-title">Agregar personas</div>
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
                        <div className="eq-empty-state">
                            {search ? 'Sin resultados para esa búsqueda.' : 'Todas las personas de la empresa ya están en esta obra.'}
                        </div>
                    ) : (
                        <div className="eq-prow-list">
                            {filteredUnassigned.map((w) => {
                                const currCargos = assignCargos[w.personaId] || (w.cargo ? [w.cargo] : []);
                                const esTrabajador = rolTipoDe(w) === 'trabajador';
                                return (
                                    <div key={w.personaId} className="eq-add-row">
                                        <div className="eq-worker-avatar">{initials(w.nombre, w.apellido)}</div>
                                        <div className="eq-prow-info">
                                            <span className="eq-worker-name">{w.nombre} {w.apellido || ''}</span>
                                            <span className="eq-worker-rut">{w.rut} · {w.rolNombre || w.rol}</span>
                                        </div>
                                        <div className="eq-add-controls">
                                            <label className="eq-ctrl">
                                                <span className="eq-ctrl-label">Cargos</span>
                                                <CargoDropdown
                                                    options={cargoOptions}
                                                    selected={currCargos}
                                                    onToggle={(code) => toggleCargo(w.personaId, code, w.cargo ? [w.cargo] : [])}
                                                />
                                            </label>
                                            {esTrabajador && (
                                                supervisorSelectOptions.length > 0 ? (
                                                    <label className="eq-ctrl eq-ctrl--wide">
                                                        <span className="eq-ctrl-label">Supervisor *</span>
                                                        <SupervisorAutocomplete
                                                            options={supervisorSelectOptions}
                                                            value={assignSupervisor[w.personaId] || ''}
                                                            onChange={(v) => setAssignSupervisor((p) => ({ ...p, [w.personaId]: v }))}
                                                        />
                                                    </label>
                                                ) : (
                                                    <div className="eq-sup-warn">
                                                        <FiAlertTriangle size={14} style={{ flexShrink: 0 }} />
                                                        <span>Sin supervisores — quedará sin cuadrilla.</span>
                                                    </div>
                                                )
                                            )}
                                        </div>
                                        <div className="eq-prow-bar-actions" style={{ flexShrink: 0 }}>
                                            <button
                                                className="btn btn-primary btn-sm"
                                                disabled={updating === w.personaId}
                                                onClick={() => handleAdd(w)}
                                            >
                                                {updating === w.personaId
                                                    ? '…'
                                                    : <><FiUserPlus size={13} /> Agregar</>
                                                }
                                            </button>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}

                    {canAsignar && supervisorSelectOptions.length === 0 && unassigned.some((w) => rolTipoDe(w) === 'trabajador') && (
                        <div className="eq-add-note">
                            <FiAlertTriangle size={13} style={{ color: 'var(--warning-500, #d97706)' }} />
                            Agrega primero un Supervisor a la obra para poder armar cuadrillas.
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
                /* ── Spinner ─────────────────────────────────────────── */
                .spinner {
                    width: 28px; height: 28px;
                    border: 3px solid var(--surface-border);
                    border-top-color: var(--primary-500);
                    border-radius: 50%;
                    animation: spin 0.8s linear infinite;
                }
                @keyframes spin { to { transform: rotate(360deg); } }

                /* ── Section layout ──────────────────────────────────── */
                .eq-section { padding: var(--space-4); margin-bottom: var(--space-4); }
                .eq-section-head {
                    display: flex; align-items: flex-start; justify-content: space-between;
                    gap: var(--space-3); flex-wrap: wrap; margin-bottom: var(--space-4);
                }
                .eq-section-title { font-weight: 700; font-size: var(--text-base); color: var(--text-primary); margin-bottom: 2px; }
                .eq-section-sub { font-size: var(--text-xs); color: var(--text-muted); }

                /* ── Search ──────────────────────────────────────────── */
                .eq-search-wrap {
                    display: flex; align-items: center; gap: var(--space-2);
                    border: 1px solid var(--surface-border); border-radius: var(--radius-md);
                    padding: 0 var(--space-2); background: var(--surface); min-width: 200px;
                }
                .eq-search-wrap .form-input { border: none; box-shadow: none; background: transparent; padding: 6px 0; }

                /* ── Empty states ────────────────────────────────────── */
                .eq-empty-state {
                    display: flex; flex-direction: column; align-items: center; justify-content: center;
                    padding: var(--space-8) var(--space-4); gap: 4px;
                    text-align: center; color: var(--text-muted); font-size: var(--text-sm);
                }

                /* ── Cuadrilla groups ────────────────────────────────── */
                .eq-groups { display: flex; flex-direction: column; gap: var(--space-4); }

                /* ── Cuadrilla card ──────────────────────────────────── */
                .eq-crew {
                    border: 1px solid var(--surface-border);
                    border-left: 4px solid var(--crew-color, var(--accent));
                    border-radius: var(--radius-lg);
                    overflow: hidden;
                }
                .eq-crew--warn {
                    --crew-color: var(--danger-500);
                    border-color: rgba(244, 67, 54, 0.4);
                }

                /* Cuadrilla header (equipo gestión / sin cuadrilla) */
                .eq-crew-header {
                    display: flex; align-items: center; gap: var(--space-2);
                    padding: 10px var(--space-4);
                    background: var(--surface-subtle, rgba(0,0,0,0.02));
                    border-bottom: 1px solid var(--surface-border);
                    font-size: var(--text-xs);
                }
                .eq-crew-header--warn { color: var(--danger-500); }
                .eq-crew-header-title { font-weight: 700; font-size: var(--text-sm); color: var(--text-primary); }
                .eq-crew-header--warn .eq-crew-header-title { color: var(--danger-500); }
                .eq-crew-badge {
                    font-size: 11px; font-weight: 700;
                    background: var(--accent-tint); color: var(--accent-text);
                    border-radius: 999px; padding: 1px 8px;
                }
                .eq-crew-badge--warn { background: rgba(244,67,54,0.12); color: var(--danger-500); }
                .eq-crew-hint { font-size: var(--text-xs); color: var(--text-muted); }
                .eq-crew-empty {
                    padding: var(--space-3) var(--space-4);
                    font-size: var(--text-xs); color: var(--text-muted); font-style: italic;
                }

                /* ── Person row list ─────────────────────────────────── */
                .eq-prow-list { display: flex; flex-direction: column; }
                .eq-prow-list--indented { border-top: 1px solid var(--surface-border); }

                /* ── Person row ──────────────────────────────────────── */
                .eq-prow { border-bottom: 1px solid var(--surface-border); }
                .eq-prow:last-child { border-bottom: none; }

                /* Bar (always visible) */
                .eq-prow-bar {
                    display: flex; align-items: center; gap: var(--space-3);
                    padding: 10px var(--space-4);
                    transition: background 0.12s;
                }
                .eq-prow-bar:hover { background: var(--surface-hover); }
                .eq-prow--expanded .eq-prow-bar { background: var(--surface-hover); }

                /* Supervisor variant: slightly taller, distinct background */
                .eq-prow--supervisor .eq-prow-bar {
                    padding: 14px var(--space-4);
                    background: color-mix(in srgb, var(--crew-color, var(--accent)) 5%, var(--surface-subtle, rgba(0,0,0,0.02)) 95%);
                    border-bottom: 1px solid var(--surface-border);
                }
                .eq-prow--supervisor.eq-prow--expanded .eq-prow-bar,
                .eq-prow--supervisor .eq-prow-bar:hover {
                    background: color-mix(in srgb, var(--crew-color, var(--accent)) 10%, var(--surface-hover) 90%);
                }

                /* Inactive */
                .eq-prow--inactive .eq-prow-bar { opacity: 0.55; }

                /* ── Avatars ─────────────────────────────────────────── */
                .eq-worker-avatar {
                    width: 34px; height: 34px; border-radius: 50%; flex-shrink: 0;
                    display: flex; align-items: center; justify-content: center;
                    font-weight: 700; font-size: var(--text-xs); text-transform: uppercase;
                    background: rgba(0,110,220,0.12); color: var(--accent-text, #4d9fff);
                    border: 1.5px solid rgba(0,110,220,0.2);
                }
                .eq-worker-avatar--inactive {
                    background: var(--surface-hover);
                    color: var(--text-muted); border-color: var(--surface-border);
                }
                .eq-sup-avatar {
                    width: 40px; height: 40px; font-size: var(--text-sm);
                    background: var(--crew-color, var(--accent));
                    color: #fff; border: none;
                }

                /* ── Name / info ─────────────────────────────────────── */
                .eq-prow-info { flex: 0 0 auto; cursor: pointer; min-width: 120px; }
                .eq-sup-name { font-weight: 700; font-size: var(--text-sm); color: var(--text-primary); display: block; }
                .eq-worker-name { font-weight: 500; font-size: var(--text-sm); color: var(--text-primary); display: block; }
                .eq-worker-rut { font-size: var(--text-xs); color: var(--text-muted); display: block; margin-top: 1px; }

                /* ── Cargo chips (collapsed view) ────────────────────── */
                .eq-cargo-chips {
                    display: flex; gap: 4px; flex: 1; flex-wrap: wrap; align-items: center;
                    min-width: 0;
                }
                .eq-cargo-chip {
                    font-size: 11px; font-weight: 600; white-space: nowrap;
                    padding: 2px 9px; border-radius: 999px;
                    background: var(--accent-tint, rgba(0,110,220,0.10));
                    color: var(--accent-text, #4d9fff);
                }
                .eq-cargo-chip--empty { opacity: 0.4; font-weight: 400; font-style: italic; }

                /* ── Row actions (right side of bar) ─────────────────── */
                .eq-prow-bar-actions { display: flex; gap: 6px; align-items: center; flex-shrink: 0; }

                /* Edit toggle button */
                .eq-edit-toggle {
                    display: flex; align-items: center; justify-content: center;
                    width: 30px; height: 30px; border: 1px solid var(--surface-border);
                    background: var(--surface-elevated); color: var(--text-muted);
                    border-radius: var(--radius-md); cursor: pointer;
                    transition: background 0.12s, color 0.12s, border-color 0.12s;
                }
                .eq-edit-toggle:hover { background: var(--surface-hover); color: var(--text-primary); border-color: var(--accent); }
                .eq-edit-icon { transition: color 0.12s; }
                .eq-edit-icon--active { color: var(--accent); }

                /* ── Expanded edit panel ─────────────────────────────── */
                .eq-prow-panel {
                    display: flex; gap: var(--space-3); flex-wrap: wrap; align-items: flex-end;
                    padding: var(--space-3) var(--space-4) var(--space-3) 62px;
                    background: var(--surface-subtle, rgba(0,0,0,0.02));
                    border-top: 1px dashed var(--surface-border);
                }
                .eq-prow-panel-actions {
                    display: flex; gap: 6px; align-items: center; margin-left: auto; flex-shrink: 0;
                }
                .eq-baja-btn { color: var(--danger-500) !important; }

                /* ── Controls (labels + inputs) ──────────────────────── */
                .eq-ctrl { display: flex; flex-direction: column; gap: 3px; min-width: 120px; }
                .eq-ctrl-label {
                    font-size: 10px; font-weight: 700; letter-spacing: 0.05em;
                    text-transform: uppercase; color: var(--text-muted);
                }
                .eq-ctrl--wide { min-width: 190px; }
                .eq-select {
                    font-size: var(--text-sm); padding: 5px 8px;
                    border-radius: var(--radius-md); border: 1px solid var(--surface-border);
                    background: var(--surface-elevated); color: var(--text-primary);
                    min-width: 120px; cursor: pointer; color-scheme: light dark;
                }
                .eq-select option { background: var(--surface-elevated); color: var(--text-primary); }
                .eq-select:hover:not(:disabled) { border-color: var(--accent); }
                .eq-select:focus-visible { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-tint); }
                .eq-select:disabled { opacity: 0.55; cursor: default; }

                /* ── Cargo dropdown ──────────────────────────────────── */
                .eq-dd { position: relative; min-width: 120px; }
                .eq-dd-btn {
                    display: flex; align-items: center; justify-content: space-between; gap: 6px; width: 100%;
                    font-size: var(--text-sm); padding: 5px 8px; border-radius: var(--radius-md);
                    border: 1px solid var(--surface-border); background: var(--surface-elevated);
                    color: var(--text-primary); cursor: pointer; transition: border-color 0.12s;
                }
                .eq-dd-btn:hover { border-color: var(--accent); }
                .eq-dd-btn-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
                .eq-dd-menu {
                    position: absolute; z-index: 50; top: calc(100% + 4px); left: 0;
                    min-width: 200px; max-height: 260px; overflow-y: auto;
                    background: var(--surface-elevated); border: 1px solid var(--surface-border);
                    border-radius: var(--radius-md); box-shadow: 0 8px 24px rgba(0,0,0,0.16); padding: 4px;
                }
                .eq-dd-item {
                    display: flex; align-items: center; gap: 8px; padding: 6px 8px;
                    border-radius: var(--radius-sm); font-size: var(--text-sm); cursor: pointer; color: var(--text-primary);
                }
                .eq-dd-item:hover { background: var(--surface-hover); }

                /* ── Supervisor autocomplete ──────────────────────────── */
                .eq-ac { position: relative; min-width: 190px; }
                .eq-ac-control {
                    display: flex; align-items: center; gap: 6px; min-height: 32px;
                    padding: 3px 6px 3px 8px;
                    border: 1px solid var(--surface-border); border-radius: var(--radius-md);
                    background: var(--surface-elevated); cursor: text;
                    transition: border-color .12s, box-shadow .12s;
                }
                .eq-ac-control:hover { border-color: var(--accent); }
                .eq-ac-control:focus-within { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-tint); }
                .eq-ac-control--warn { border-color: var(--danger-500); }
                .eq-ac-input {
                    flex: 1; min-width: 0; border: none; outline: none; background: transparent;
                    font-size: var(--text-sm); color: var(--text-primary); padding: 1px 0;
                }
                .eq-ac-input::placeholder { color: var(--text-muted); }
                .eq-ac-clear {
                    display: flex; align-items: center; border: none; background: transparent;
                    color: var(--text-muted); cursor: pointer; padding: 0; flex-shrink: 0;
                }
                .eq-ac-clear:hover { color: var(--danger-500); }
                .eq-ac-item {
                    display: block; width: 100%; text-align: left; border: none; background: transparent;
                    padding: 6px 8px; border-radius: var(--radius-sm);
                    font-size: var(--text-sm); color: var(--text-primary); cursor: pointer;
                }
                .eq-ac-item:hover { background: var(--surface-hover); }
                .eq-ac-item--sel { background: var(--accent-tint); color: var(--accent-text); font-weight: 600; }
                .eq-ac-empty { padding: 8px; font-size: var(--text-xs); color: var(--text-muted); text-align: center; }

                /* ── Supervisor warning banner ────────────────────────── */
                .eq-sup-warn {
                    display: flex; align-items: center; gap: 8px; flex: 1; min-width: 190px;
                    padding: 8px 10px; border-radius: var(--radius-md);
                    background: rgba(217,119,6,0.10); border: 1px solid rgba(217,119,6,0.35);
                    color: var(--warning-700, #b45309); font-size: var(--text-xs); font-weight: 500;
                }

                /* ── Add section rows ────────────────────────────────── */
                .eq-add-row {
                    display: flex; align-items: center; gap: var(--space-3); flex-wrap: wrap;
                    padding: var(--space-3) var(--space-4);
                    border-bottom: 1px solid var(--surface-border);
                    transition: background 0.12s;
                }
                .eq-add-row:last-of-type { border-bottom: none; }
                .eq-add-row:hover { background: var(--surface-hover); }
                .eq-add-controls { display: flex; gap: var(--space-3); flex: 1; flex-wrap: wrap; align-items: flex-end; }
                .eq-add-note {
                    display: flex; align-items: center; gap: 6px;
                    padding: var(--space-2) var(--space-4) var(--space-3);
                    font-size: var(--text-xs); color: var(--text-muted);
                }

                /* ── Dados de baja (collapsible) ─────────────────────── */
                .eq-baja-section { border-top: 1px solid var(--surface-border); margin-top: var(--space-2); }
                .eq-baja-summary {
                    font-size: var(--text-xs); font-weight: 700; color: var(--text-muted);
                    text-transform: uppercase; letter-spacing: 0.05em; cursor: pointer;
                    padding: var(--space-3) var(--space-4); list-style: none; display: block;
                    user-select: none;
                }
                .eq-baja-summary::-webkit-details-marker { display: none; }
                .eq-baja-summary::before { content: '▶  '; font-size: 9px; }
                details[open] .eq-baja-summary::before { content: '▼  '; }
            `}</style>
        </div>
    );
}
