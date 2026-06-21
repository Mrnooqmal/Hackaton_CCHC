import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { obrasApi, workersApi } from '../api/client';
import { tenantsApi, type TenantRole } from '../api/tenants.api';
import { useCargoCatalog } from '../hooks/useCargoCatalog';
import { AlertBanner, PageHeader } from '../components/ui';
import { PERMISSIONS } from '../permissions';
import FirmaAsistidaModal from '../components/FirmaAsistidaModal';
import { useNavigate } from 'react-router-dom';
import { FiSearch, FiUserPlus, FiCheck, FiX, FiChevronDown, FiAlertTriangle, FiUsers } from 'react-icons/fi';
import { LuCircleCheck } from 'react-icons/lu';

const initials = (nombre: string, apellido?: string) =>
    `${nombre[0] ?? ''}${apellido?.[0] ?? nombre[1] ?? ''}`.toUpperCase();

const norm = (s: string) =>
    String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();

// ── Dropdown de cargos con checkboxes (multi-cargo) ───────────────────────────
function CargoDropdown({
    options, selected, onToggle,
}: {
    options: { value: string; label: string }[];
    selected: string[];
    onToggle: (code: string) => void;
}) {
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (!open) return;
        const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
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
            {open && (
                <div className="eq-dd-menu">
                    {options.map((opt) => (
                        <label key={opt.value} className="eq-dd-item">
                            <input type="checkbox" checked={selected.includes(opt.value)} onChange={() => onToggle(opt.value)} />
                            <span>{opt.label}</span>
                        </label>
                    ))}
                </div>
            )}
        </div>
    );
}

// ── Autocompletador (buscador) de supervisores ────────────────────────────────
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
    const selected = options.find((o) => o.value === value) || null;

    useEffect(() => {
        if (!open) return;
        const onDoc = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) { setOpen(false); setQuery(''); }
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
            {open && (
                <div className="eq-dd-menu">
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
                </div>
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
    // cargo selection per worker (dirty buffer hasta guardar)
    const [assignCargos, setAssignCargos] = useState<Record<string, string[]>>({});
    // supervisor seleccionado al agregar un trabajador a la obra
    const [assignSupervisor, setAssignSupervisor] = useState<Record<string, string>>({});
    // firma asistida
    const [firmaOpen, setFirmaOpen] = useState(false);
    const [firmaWorkerId, setFirmaWorkerId] = useState<string | undefined>(undefined);

    const tenantId = (user as any)?.tenantId as string | undefined;

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

    // ── Helpers de rol / cargo / cuadrilla ────────────────────────────────────
    const rolOptions = useMemo(
        () => roles.filter((r) => r.tipo !== 'admin').map((r) => ({ value: r.id, label: r.nombre })),
        [roles]
    );

    // id de rol actual de una persona, resuelto contra la def. del tenant.
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

    // ── Acciones ──────────────────────────────────────────────────────────────
    const handleAdd = async (w: any) => {
        if (!obraId) return;
        const esTrabajador = rolTipoDe(w) === 'trabajador';
        const haySupervisores = supervisorSelectOptions.length > 0;
        const supervisorId = assignSupervisor[w.personaId];
        // Solo se exige supervisor si la obra ya tiene alguno; si no, el trabajador
        // queda temporalmente sin cuadrilla (se le asigna después).
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

    // Cambia el rol de empresa de la persona (atributo global, afecta permisos).
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

    // Cambia/asigna el supervisor (cuadrilla) de un trabajador en esta obra.
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

    // ── Render de fila de persona (reutilizable) ──────────────────────────────
    const renderRow = (w: any, opts: { showSupervisor?: boolean; nested?: boolean } = {}) => {
        const currCargos = assignCargos[w.personaId] ?? cargosActuales(w);
        const isDirty = !!assignCargos[w.personaId];
        const roleId = currentRoleId(w);
        const sup = supervisorDe(w) || '';
        return (
            <div
                key={w.personaId}
                className={`eq-worker-row${opts.nested ? ' eq-worker-row--nested' : ''}`}
                style={{ cursor: 'pointer' }}
                onClick={() => navigate(`/personas/${encodeURIComponent(w.rut)}`)}
            >
                <div className="eq-worker-avatar">{initials(w.nombre, w.apellido)}</div>
                <div className="eq-worker-info">
                    <div className="eq-worker-name">{w.nombre} {w.apellido || ''}</div>
                    <div className="eq-worker-rut">{w.rut}</div>
                </div>

                {/* Controles — stopPropagation para no navegar */}
                <div className="eq-worker-controls" onClick={(e) => e.stopPropagation()}>
                    <label className="eq-ctrl">
                        <span className="eq-ctrl-label">Rol</span>
                        <select
                            className="eq-select"
                            value={roleId}
                            disabled={w.rol === 'admin' || updating === w.personaId}
                            onChange={(e) => handleRolChange(w, e.target.value)}
                        >
                            {!rolOptions.some((o) => o.value === roleId) && <option value={roleId}>{w.rolNombre || w.rol}</option>}
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

                    {opts.showSupervisor && (
                        supervisorSelectOptions.length > 0 ? (
                            <label className="eq-ctrl eq-ctrl--wide">
                                <span className="eq-ctrl-label">Asignar a supervisor</span>
                                <SupervisorAutocomplete
                                    options={supervisorSelectOptions}
                                    value={sup}
                                    onChange={(v) => handleSupervisorChange(w, v)}
                                />
                            </label>
                        ) : (
                            <div className="eq-sup-warn">
                                <FiAlertTriangle size={14} style={{ flexShrink: 0 }} />
                                <span>Precaución, no hay supervisores. El trabajador no estará asignado a un supervisor temporalmente.</span>
                            </div>
                        )
                    )}
                </div>

                <div className="eq-worker-actions" onClick={(e) => e.stopPropagation()}>
                    {isDirty && (
                        <button className="btn btn-primary btn-sm" disabled={updating === w.personaId} onClick={() => handleUpdateCargos(w)}>
                            <FiCheck size={13} /> Guardar
                        </button>
                    )}
                    {canFirmaAsistida && (
                        <button className="btn btn-secondary btn-sm" onClick={() => { setFirmaWorkerId(w.personaId); setFirmaOpen(true); }}>
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
                backTo={`/obras/${obraId}`}
            />

            {error && <AlertBanner variant="error" message={error} onDismiss={() => setError('')} />}

            {/* ── Equipo en obra: cuadrillas por supervisor ── */}
            <div className="card eq-section">
                <div className="eq-section-head">
                    <div>
                        <div className="eq-section-title">En esta obra</div>
                        <div className="eq-section-sub">
                            {activeAssigned.length} activos · {supervisores.length} cuadrilla(s)
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
                    <div style={{ padding: 'var(--space-4)', textAlign: 'center', color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>
                        No hay personas en esta obra. Agrégalas desde la sección de abajo.
                    </div>
                ) : (
                    <div className="eq-groups">
                        {/* Sin cuadrilla (warning) — trabajadores que requieren supervisor */}
                        {sinCuadrilla.filter(matchesSearch).length > 0 && (
                            <div className="eq-crew eq-crew--warn">
                                <div className="eq-crew-head">
                                    <FiAlertTriangle size={15} style={{ color: 'var(--danger-500)' }} />
                                    <div className="eq-crew-title">Sin cuadrilla</div>
                                    <span className="eq-crew-count">{sinCuadrilla.length}</span>
                                    <span className="eq-crew-hint">Asigna un supervisor a cada persona trabajadora.</span>
                                </div>
                                <div className="eq-worker-list">
                                    {sinCuadrilla.filter(matchesSearch).map((w) => renderRow(w, { showSupervisor: true, nested: true }))}
                                </div>
                            </div>
                        )}

                        {/* Una "cuadrilla" por supervisor */}
                        {supervisores.map((sup) => {
                            const crew = cuadrillaDe(sup.personaId);
                            const visibleCrew = crew.filter(matchesSearch);
                            const supVisible = matchesSearch(sup);
                            if (!supVisible && visibleCrew.length === 0) return null;
                            return (
                                <div key={sup.personaId} className="eq-crew">
                                    <div className="eq-crew-head">
                                        <FiUsers size={15} style={{ color: 'var(--accent)' }} />
                                        <div className="eq-crew-title">Cuadrilla de {sup.nombre} {sup.apellido || ''}</div>
                                        <span className="eq-crew-count">{crew.length}</span>
                                    </div>
                                    {/* El supervisor como cabecera de su contenedor */}
                                    {renderRow(sup)}
                                    {visibleCrew.length > 0 && (
                                        <div className="eq-worker-list eq-crew-list">
                                            {visibleCrew.map((w) => renderRow(w, { showSupervisor: true, nested: true }))}
                                        </div>
                                    )}
                                    {crew.length === 0 && (
                                        <div className="eq-crew-empty">Aún no hay personas trabajadoras en esta cuadrilla.</div>
                                    )}
                                </div>
                            );
                        })}

                        {/* Equipo de gestión (roles que no son cuadrilla) */}
                        {gestion.filter(matchesSearch).length > 0 && (
                            <div className="eq-crew">
                                <div className="eq-crew-head">
                                    <div className="eq-crew-title">Equipo de gestión</div>
                                    <span className="eq-crew-count">{gestion.length}</span>
                                </div>
                                <div className="eq-worker-list">
                                    {gestion.filter(matchesSearch).map((w) => renderRow(w))}
                                </div>
                            </div>
                        )}

                        {inactiveAssigned.length > 0 && (
                            <details className="eq-baja-section">
                                <summary className="eq-baja-summary">Dados de baja · {inactiveAssigned.length}</summary>
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
                                                <button className="btn btn-primary btn-sm" disabled={updating === w.personaId} onClick={() => handleReactivar(w)}>
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
                        <div style={{ padding: 'var(--space-4)', textAlign: 'center', color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>
                            {search ? 'Sin resultados para esa búsqueda.' : 'Todas las personas de la empresa ya están en esta obra.'}
                        </div>
                    ) : (
                        <div className="eq-worker-list">
                            {filteredUnassigned.map((w) => {
                                const currCargos = assignCargos[w.personaId] || (w.cargo ? [w.cargo] : []);
                                const esTrabajador = rolTipoDe(w) === 'trabajador';
                                return (
                                    <div key={w.personaId} className="eq-worker-row">
                                        <div className="eq-worker-avatar">{initials(w.nombre, w.apellido)}</div>
                                        <div className="eq-worker-info">
                                            <div className="eq-worker-name">{w.nombre} {w.apellido || ''}</div>
                                            <div className="eq-worker-rut">{w.rut} · {w.rolNombre || w.rol}</div>
                                        </div>
                                        <div className="eq-worker-controls">
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
                                                        <span className="eq-ctrl-label">Asignar a supervisor *</span>
                                                        <SupervisorAutocomplete
                                                            options={supervisorSelectOptions}
                                                            value={assignSupervisor[w.personaId] || ''}
                                                            onChange={(v) => setAssignSupervisor((p) => ({ ...p, [w.personaId]: v }))}
                                                        />
                                                    </label>
                                                ) : (
                                                    <div className="eq-sup-warn">
                                                        <FiAlertTriangle size={14} style={{ flexShrink: 0 }} />
                                                        <span>Precaución, no hay supervisores. El trabajador no estará asignado a un supervisor temporalmente.</span>
                                                    </div>
                                                )
                                            )}
                                        </div>
                                        <div className="eq-worker-actions">
                                            <button className="btn btn-primary btn-sm" disabled={updating === w.personaId} onClick={() => handleAdd(w)}>
                                                {updating === w.personaId ? '…' : <><FiUserPlus size={13} /> Agregar</>}
                                            </button>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                    {canAsignar && supervisorSelectOptions.length === 0 && unassigned.some((w) => rolTipoDe(w) === 'trabajador') && (
                        <div className="eq-add-note">
                            <FiAlertTriangle size={13} style={{ color: 'var(--warning-500, #d97706)' }} /> Agrega primero un Supervisor a la obra para poder armar cuadrillas.
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
                .eq-search-wrap .form-input { border: none; box-shadow: none; background: transparent; padding: 6px 0; }

                .eq-groups { display: flex; flex-direction: column; gap: var(--space-4); }

                /* Contenedor de cuadrilla */
                .eq-crew {
                    border: 1px solid var(--surface-border); border-radius: var(--radius-lg);
                    background: var(--surface-subtle, rgba(0,0,0,0.015)); padding: var(--space-3);
                }
                .eq-crew--warn { border-color: var(--danger-500); background: rgba(220,38,38,0.05); }
                .eq-crew-head { display: flex; align-items: center; gap: var(--space-2); margin-bottom: var(--space-3); flex-wrap: wrap; }
                .eq-crew-title { font-weight: 700; font-size: var(--text-sm); color: var(--text-primary); }
                .eq-crew-count {
                    font-size: 11px; font-weight: 700; background: var(--accent-tint, rgba(0,110,220,0.12));
                    color: var(--accent-text, #2563eb); border-radius: 999px; padding: 1px 8px;
                }
                .eq-crew--warn .eq-crew-count { background: rgba(220,38,38,0.12); color: var(--danger-500); }
                .eq-crew-hint { font-size: var(--text-xs); color: var(--text-muted); }
                .eq-crew-list { margin-top: var(--space-2); padding-left: var(--space-3); border-left: 2px solid var(--surface-border); }
                .eq-crew-empty { font-size: var(--text-xs); color: var(--text-muted); padding: var(--space-2) var(--space-2) 0 var(--space-3); }

                .eq-worker-list { display: flex; flex-direction: column; gap: var(--space-2); }
                .eq-worker-row {
                    display: flex; align-items: center; gap: var(--space-3); flex-wrap: wrap;
                    padding: var(--space-3); border: 1px solid var(--surface-border);
                    border-radius: var(--radius-md); background: var(--surface);
                    transition: border-color 0.15s;
                }
                .eq-worker-row:hover { border-color: var(--accent); }
                .eq-worker-row--nested { background: var(--surface); }
                .eq-worker-row--inactive { opacity: 0.65; }

                .eq-worker-avatar {
                    width: 36px; height: 36px; border-radius: 50%; flex-shrink: 0;
                    display: flex; align-items: center; justify-content: center;
                    font-weight: 700; font-size: var(--text-sm); text-transform: uppercase;
                    background: rgba(0,110,220,0.12); color: #4d9fff; border: 1.5px solid rgba(0,110,220,0.25);
                }
                .eq-worker-avatar--inactive { background: var(--surface-hover); color: var(--text-muted); border-color: var(--surface-border); }

                .eq-worker-info { min-width: 130px; }
                .eq-worker-name { font-weight: 600; font-size: var(--text-sm); color: var(--text-primary); }
                .eq-worker-rut { font-size: var(--text-xs); color: var(--text-muted); margin-top: 1px; }

                .eq-worker-controls { display: flex; gap: var(--space-3); flex: 1; flex-wrap: wrap; align-items: flex-end; }
                .eq-ctrl { display: flex; flex-direction: column; gap: 2px; min-width: 130px; }
                .eq-ctrl-label { font-size: 10px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; color: var(--text-muted); }
                .eq-select {
                    font-size: var(--text-sm); padding: 5px 8px; border-radius: var(--radius-md);
                    border: 1px solid var(--surface-border); background: var(--surface-elevated); color: var(--text-primary);
                    min-width: 130px; cursor: pointer; color-scheme: light dark;
                }
                /* Asegura que el popup nativo de opciones siga el tema (no quede blanco en oscuro) */
                .eq-select option { background: var(--surface-elevated); color: var(--text-primary); }
                .eq-select:hover:not(:disabled) { border-color: var(--accent); }
                .eq-select:focus-visible { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-tint); }
                .eq-select:disabled { opacity: 0.55; cursor: default; }
                .eq-select--warn { border-color: var(--danger-500); }

                /* Dropdown de cargos */
                .eq-dd { position: relative; min-width: 130px; }
                .eq-dd-btn {
                    display: flex; align-items: center; justify-content: space-between; gap: 6px; width: 100%;
                    font-size: var(--text-sm); padding: 5px 8px; border-radius: var(--radius-md);
                    border: 1px solid var(--surface-border); background: var(--surface-elevated); color: var(--text-primary); cursor: pointer;
                    transition: border-color 0.12s ease, box-shadow 0.12s ease;
                }
                .eq-dd-btn:hover { border-color: var(--accent); }
                .eq-dd-btn-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
                .eq-dd-menu {
                    position: absolute; z-index: 50; top: calc(100% + 4px); left: 0; min-width: 200px; max-height: 260px; overflow-y: auto;
                    background: var(--surface-elevated); border: 1px solid var(--surface-border); border-radius: var(--radius-md);
                    box-shadow: 0 8px 24px rgba(0,0,0,0.16); padding: 4px;
                }
                .eq-dd-item {
                    display: flex; align-items: center; gap: 8px; padding: 6px 8px; border-radius: var(--radius-sm);
                    font-size: var(--text-sm); cursor: pointer; color: var(--text-primary);
                }
                .eq-dd-item:hover { background: var(--surface-hover); }

                /* Autocompletador de supervisores */
                .eq-ctrl--wide { min-width: 200px; }
                .eq-ac { position: relative; min-width: 200px; }
                .eq-ac-control {
                    display: flex; align-items: center; gap: 6px; min-height: 32px; padding: 3px 6px 3px 8px;
                    border: 1px solid var(--surface-border); border-radius: var(--radius-md);
                    background: var(--surface-elevated); cursor: text;
                    transition: border-color .12s ease, box-shadow .12s ease;
                }
                .eq-ac-control:hover { border-color: var(--accent); }
                .eq-ac-control:focus-within { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-tint); }
                .eq-ac-control--warn { border-color: var(--danger-500); }
                .eq-ac-control--warn:focus-within { box-shadow: 0 0 0 3px rgba(220,38,38,0.15); }
                .eq-ac-input {
                    flex: 1; min-width: 0; border: none; outline: none; background: transparent;
                    font-size: var(--text-sm); color: var(--text-primary); padding: 1px 0;
                }
                .eq-ac-input::placeholder { color: var(--text-muted); }
                .eq-ac-clear {
                    display: flex; align-items: center; justify-content: center; border: none; background: transparent;
                    color: var(--text-muted); cursor: pointer; padding: 0; flex-shrink: 0;
                }
                .eq-ac-clear:hover { color: var(--danger-500); }
                .eq-ac-item {
                    display: block; width: 100%; text-align: left; border: none; background: transparent;
                    padding: 6px 8px; border-radius: var(--radius-sm); font-size: var(--text-sm);
                    color: var(--text-primary); cursor: pointer;
                }
                .eq-ac-item:hover { background: var(--surface-hover); }
                .eq-ac-item--sel { background: var(--accent-tint, rgba(0,110,220,0.12)); color: var(--accent-text, #2563eb); font-weight: 600; }
                .eq-ac-empty { padding: 8px; font-size: var(--text-xs); color: var(--text-muted); text-align: center; }

                .eq-sup-warn {
                    display: flex; align-items: center; gap: 8px; flex: 1; min-width: 200px;
                    padding: 8px 10px; border-radius: var(--radius-md);
                    background: rgba(217,119,6,0.10); border: 1px solid rgba(217,119,6,0.35);
                    color: var(--warning-700, #b45309); font-size: var(--text-xs); font-weight: 500;
                }

                .eq-worker-actions { display: flex; gap: 6px; align-items: center; flex-shrink: 0; flex-wrap: wrap; }

                .eq-add-note { display: flex; align-items: center; gap: 6px; margin-top: var(--space-3); font-size: var(--text-xs); color: var(--text-muted); }

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
