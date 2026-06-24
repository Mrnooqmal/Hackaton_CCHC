import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { obrasApi, workersApi } from '../api/client';
import { tenantsApi, type TenantRole } from '../api/tenants.api';
import { useCargoCatalog } from '../hooks/useCargoCatalog';
import { AlertBanner, PageHeader, Modal } from '../components/ui';
import type { CollectionMode } from '../components/ui';
import { PERMISSIONS } from '../permissions';
import FirmaAsistidaModal from '../components/FirmaAsistidaModal';
import {
    FiSearch, FiUserPlus, FiCheck, FiX, FiChevronDown,
    FiAlertTriangle, FiUsers, FiEdit2, FiList, FiGrid,
    FiUser, FiPenTool,
} from 'react-icons/fi';
import { LuCircleCheck } from 'react-icons/lu';

const GESTION_CONTAINER = '__gestion__';
const SIN_CUADRILLA_CONTAINER = '__sin_cuadrilla__';

const initials = (nombre: string, apellido?: string) =>
    `${nombre[0] ?? ''}${apellido?.[0] ?? nombre[1] ?? ''}`.toUpperCase();

const norm = (s: string) =>
    String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();

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

// ── Dropdown de cargos ──────────────────────────────────────────────────────
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

// ── Modal de confirmación para arrastre a gestión ───────────────────────────
function GestionConfirmModal({
    persona,
    onClose,
    onConfirm,
}: {
    persona: any;
    onClose: () => void;
    onConfirm: () => void;
}) {
    const [input, setInput] = useState('');
    const fullName = `${persona.nombre} ${persona.apellido || ''}`.trim();
    const expected = `Deseo incorporar a ${fullName}`;
    const matches = input.trim() === expected;

    return createPortal(
        <div className="eq-modal-overlay" onClick={onClose}>
            <div className="eq-modal" onClick={(e) => e.stopPropagation()}>
                <div className="eq-modal-icon">
                    <FiAlertTriangle size={22} />
                </div>
                <h3 className="eq-modal-title">Equipo reservado para gestión</h3>
                <p className="eq-modal-body">
                    Este grupo está reservado para cargos de coordinación y dirección de obra:
                    administración, jefatura de obra y prevención de riesgos.
                    Los trabajadores de cuadrilla no se pueden añadir aquí mediante arrastre.
                </p>
                <p className="eq-modal-body">
                    Para incorporar a <strong>{fullName}</strong> al equipo de gestión, cambia
                    su rol desde el panel de edición (vista de listado).
                </p>
                <p className="eq-modal-prompt">
                    Si entiendes esto y deseas continuar, escribe exactamente:
                </p>
                <div className="eq-modal-expected">{expected}</div>
                <input
                    className="eq-modal-input"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder="Escribe la frase exacta…"
                    autoFocus
                />
                <div className="eq-modal-actions">
                    <button className="btn btn-ghost btn-sm" onClick={onClose}>Cancelar</button>
                    <button
                        className="btn btn-primary btn-sm"
                        disabled={!matches}
                        onClick={onConfirm}
                    >
                        Confirmar
                    </button>
                </div>
            </div>
        </div>,
        document.body
    );
}

// ── Página principal ─────────────────────────────────────────────────────────
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
    const [expandedWorkers, setExpandedWorkers] = useState<Set<string>>(new Set());

    // View + drag state
    const [mode, setMode] = useState<CollectionMode>('grid');
    const [dragPersonaId, setDragPersonaId] = useState<string | null>(null);
    const [dragOverContainerId, setDragOverContainerId] = useState<string | null>(null);
    const [gestionModalPersona, setGestionModalPersona] = useState<any | null>(null);
    const [cardAction, setCardAction] = useState<{ worker: any; rect: DOMRect } | null>(null);
    const [poolCardAction, setPoolCardAction] = useState<{ worker: any; rect: DOMRect } | null>(null);
    const [addToObraModal, setAddToObraModal] = useState<{ worker: any } | null>(null);
    const [editModal, setEditModal] = useState<{ worker: any } | null>(null);

    const tenantId = (user as any)?.tenantId as string | undefined;

    const toggleExpand = (id: string) =>
        setExpandedWorkers((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
        });

    const showToast = (msg: string) => {
        setToast(msg);
        setTimeout(() => setToast(null), 3500);
    };

    useEffect(() => {
        if (!cardAction) return;
        const close = () => setCardAction(null);
        window.addEventListener('scroll', close, true);
        window.addEventListener('resize', close);
        return () => {
            window.removeEventListener('scroll', close, true);
            window.removeEventListener('resize', close);
        };
    }, [!!cardAction]);

    useEffect(() => {
        if (!poolCardAction) return;
        const close = () => setPoolCardAction(null);
        window.addEventListener('scroll', close, true);
        window.addEventListener('resize', close);
        return () => {
            window.removeEventListener('scroll', close, true);
            window.removeEventListener('resize', close);
        };
    }, [!!poolCardAction]);

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

    // ── Helpers ──────────────────────────────────────────────────────────────
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
        const prevWorkers = workers;
        const cargos = cargosActuales(w);

        // Optimistic: move the card immediately
        setWorkers((prev) => prev.map((pw) => {
            if (pw.personaId !== w.personaId) return pw;
            return {
                ...pw,
                asignaciones: (pw.asignaciones || []).map((a: any) =>
                    a.obraId === obraId ? { ...a, supervisorPersonaId: supervisorId || null } : a
                ),
            };
        }));

        setUpdating(w.personaId);
        try {
            await workersApi.setAsignacion(
                w.personaId, obraId, cargos, user?.personaId || user?.userId, supervisorId || null,
            );
            showToast(supervisorId ? 'Cuadrilla actualizada' : 'Supervisor quitado');
            reloadWorkers(); // sync silently — no await to avoid visual flash
        } catch (e: any) {
            setWorkers(prevWorkers); // roll back
            setError(e?.message || 'No se pudo actualizar la cuadrilla');
        } finally {
            setUpdating(null);
        }
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

    // ── Drag and drop ─────────────────────────────────────────────────────────
    const handleDragStart = (e: React.DragEvent, w: any) => {
        e.dataTransfer.setData('personaId', w.personaId);
        e.dataTransfer.effectAllowed = 'move';
        setDragPersonaId(w.personaId);
    };

    const handleDragEnd = () => {
        setDragPersonaId(null);
        setDragOverContainerId(null);
    };

    const makeContainerDropProps = (containerId: string) => ({
        onDragEnter: (e: React.DragEvent) => { e.preventDefault(); setDragOverContainerId(containerId); },
        onDragOver: (e: React.DragEvent) => { e.preventDefault(); },
        onDragLeave: (e: React.DragEvent) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOverContainerId(null);
        },
        onDrop: async (e: React.DragEvent) => {
            e.preventDefault();
            setDragOverContainerId(null);
            const personaId = e.dataTransfer.getData('personaId');
            if (!personaId) return;

            // Pool worker dragged into a container → add to obra
            const poolWorker = unassigned.find((w) => w.personaId === personaId);
            if (poolWorker) {
                await handleAddToContainer(poolWorker, containerId);
                return;
            }

            // Assigned worker moved between cuadrillas
            const worker = trabajadores.find((w) => w.personaId === personaId)
                ?? sinCuadrilla.find((w) => w.personaId === personaId);
            if (!worker) return;

            if (containerId === GESTION_CONTAINER) {
                setGestionModalPersona(worker);
                return;
            }
            if (containerId === SIN_CUADRILLA_CONTAINER) {
                await handleSupervisorChange(worker, '');
                return;
            }
            if (containerId !== (supervisorDe(worker) || '')) {
                await handleSupervisorChange(worker, containerId);
            }
        },
    });

    const handleAddToContainer = async (worker: any, containerId: string) => {
        if (!obraId) return;
        const prevWorkers = workers;
        const esTrabajador = rolTipoDe(worker) === 'trabajador';
        const supervisorId =
            containerId !== GESTION_CONTAINER && containerId !== SIN_CUADRILLA_CONTAINER
                ? containerId
                : null;
        const cargos = assignCargos[worker.personaId] || (worker.cargo ? [worker.cargo] : []);
        const newAsignacion = {
            obraId,
            supervisorPersonaId: esTrabajador ? supervisorId : null,
            cargos,
            estado: 'activo',
        };

        // Optimistic: move the person into the obra immediately
        setWorkers((prev) => prev.map((pw) => {
            if (pw.personaId !== worker.personaId) return pw;
            const existing = (pw.asignaciones || []).some((a: any) => a.obraId === obraId);
            return {
                ...pw,
                obraIds: [...(pw.obraIds || []), obraId],
                asignaciones: existing
                    ? (pw.asignaciones || []).map((a: any) =>
                        a.obraId === obraId ? { ...a, ...newAsignacion } : a
                      )
                    : [...(pw.asignaciones || []), newAsignacion],
            };
        }));

        setUpdating(worker.personaId);
        try {
            await workersApi.setAsignacion(
                worker.personaId, obraId, cargos, user?.personaId || user?.userId,
                esTrabajador ? supervisorId : null,
            );
            if (worker.estado === 'inactivo') await workersApi.update(worker.personaId, { estado: 'activo' } as any);
            showToast(`${worker.nombre} ${worker.apellido || ''} agregado a la obra`);
            reloadWorkers(); // sync silently
        } catch (e: any) {
            setWorkers(prevWorkers); // roll back
            setError(e?.message || 'No se pudo agregar');
        } finally {
            setUpdating(null);
        }
    };

    const handleGestionConfirm = async () => {
        if (!gestionModalPersona) return;
        const w = gestionModalPersona;
        setGestionModalPersona(null);
        await handleSupervisorChange(w, '');
        showToast(`${w.nombre} removido de su cuadrilla. Para asignarlo al equipo de gestión, edita su rol en el perfil.`);
    };

    // ── Grid card ─────────────────────────────────────────────────────────────
    const renderCard = (w: any, opts: { isSup?: boolean; isDraggable?: boolean } = {}) => {
        const { isSup = false, isDraggable = false } = opts;
        const currCargos = cargosActuales(w);
        const cargoLabels = currCargos.map((c) => cargoOptions.find((o) => o.value === c)?.label || c);
        const isDragging = dragPersonaId === w.personaId;
        const isMenuOpen = cardAction?.worker.personaId === w.personaId;

        const handleCardClick = (e: React.MouseEvent<HTMLDivElement>) => {
            e.stopPropagation();
            if (isMenuOpen) { setCardAction(null); return; }
            const rect = e.currentTarget.getBoundingClientRect();
            setCardAction({ worker: w, rect });
        };

        return (
            <div
                key={w.personaId}
                className={`eq2-card${isSup ? ' eq2-card--sup' : ''}${isDraggable ? ' eq2-card--draggable' : ''}${isDragging ? ' eq2-card--dragging' : ''}${isMenuOpen ? ' eq2-card--open' : ''}`}
                draggable={isDraggable}
                onDragStart={isDraggable ? (e) => handleDragStart(e, w) : undefined}
                onDragEnd={isDraggable ? handleDragEnd : undefined}
                onClick={handleCardClick}
            >
                <div className="eq2-card-avatar">
                    {initials(w.nombre, w.apellido)}
                </div>
                <span className="eq2-card-name">{w.nombre} {w.apellido || ''}</span>
                {isSup && <span className="eq2-sup-badge">Supervisor</span>}
                <span className="eq2-card-rut">{w.rut}</span>
                <span className="eq2-card-cargo">
                    {cargoLabels.length > 0 ? cargoLabels.join(' · ') : (w.rolNombre || w.rol || '—')}
                </span>
            </div>
        );
    };

    // ── Pool card (unassigned worker, grid mode) ──────────────────────────────
    const renderPoolCard = (w: any) => {
        const isDragging = dragPersonaId === w.personaId;
        const isOpen = poolCardAction?.worker.personaId === w.personaId;
        const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
            e.stopPropagation();
            if (isOpen) { setPoolCardAction(null); return; }
            const rect = e.currentTarget.getBoundingClientRect();
            setPoolCardAction({ worker: w, rect });
        };
        return (
            <div
                key={w.personaId}
                className={`eq2-card eq2-card--pool${isDragging ? ' eq2-card--dragging' : ''}${isOpen ? ' eq2-card--open' : ''}`}
                draggable
                onDragStart={(e) => handleDragStart(e, w)}
                onDragEnd={handleDragEnd}
                onClick={handleClick}
            >
                <div className="eq2-card-avatar">{initials(w.nombre, w.apellido)}</div>
                <span className="eq2-card-name">{w.nombre} {w.apellido || ''}</span>
                <span className="eq2-card-rut">{w.rut}</span>
                <span className="eq2-card-cargo">{w.rolNombre || w.rol || '—'}</span>
            </div>
        );
    };

    // ── Pool row (unassigned worker, list mode) ───────────────────────────────
    const renderPoolRow = (w: any) => {
        const isDragging = dragPersonaId === w.personaId;
        const isOpen = poolCardAction?.worker.personaId === w.personaId;
        const handleClick = (e: React.MouseEvent) => {
            e.stopPropagation();
            if (isOpen) { setPoolCardAction(null); return; }
            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
            setPoolCardAction({ worker: w, rect });
        };
        return (
            <div
                key={w.personaId}
                className={`eq2-row eq-pool-row${isDragging ? ' eq2-row--dragging' : ''}${isOpen ? ' eq-pool-row--open' : ''}`}
                draggable
                onDragStart={(e) => handleDragStart(e, w)}
                onDragEnd={handleDragEnd}
                onClick={handleClick}
            >
                <span className="eq2-row-drag" title="Arrastra a un equipo">⠿</span>
                <div className="eq-worker-avatar">{initials(w.nombre, w.apellido)}</div>
                <div className="eq-prow-info">
                    <span className="eq-worker-name">{w.nombre} {w.apellido || ''}</span>
                    <span className="eq-worker-rut">{w.rut} · {w.rolNombre || w.rol}</span>
                </div>
                <button
                    type="button"
                    className="btn btn-secondary btn-sm eq-pool-add-btn"
                    disabled={updating === w.personaId}
                    onClick={(e) => { e.stopPropagation(); handleClick(e); }}
                >
                    <FiUserPlus size={13} /> Agregar
                </button>
            </div>
        );
    };

    // ── List row (with edit panel) ────────────────────────────────────────────
    const renderRow = (w: any, opts: {
        isSup?: boolean;
        showSupervisor?: boolean;
        isDraggable?: boolean;
    } = {}) => {
        const { isSup = false, showSupervisor = false, isDraggable = false } = opts;
        const isExpanded = expandedWorkers.has(w.personaId);
        const currCargos = assignCargos[w.personaId] ?? cargosActuales(w);
        const isDirty = !!assignCargos[w.personaId];
        const roleId = currentRoleId(w);
        const sup = supervisorDe(w) || '';
        const cargoLabels = currCargos.map((c) => cargoOptions.find((o) => o.value === c)?.label || c);
        const isDragging = dragPersonaId === w.personaId;

        return (
            <div
                key={w.personaId}
                className={`eq2-row${isSup ? ' eq2-row--sup' : ''}${isExpanded ? ' eq2-row--expanded' : ''}${isDragging ? ' eq2-row--dragging' : ''}`}
            >
                <div className="eq2-row-bar">
                    {isDraggable && (
                        <div
                            className="eq2-drag-handle"
                            draggable
                            onDragStart={(e) => handleDragStart(e, w)}
                            onDragEnd={handleDragEnd}
                            title="Arrastrar para cambiar de cuadrilla"
                        >
                            ⠿
                        </div>
                    )}

                    <div
                        className={`eq2-row-avatar${isSup ? ' eq2-row-avatar--sup' : ''}`}
                        onClick={() => navigate(`/personas/${encodeURIComponent(w.rut)}`)}
                    >
                        {initials(w.nombre, w.apellido)}
                    </div>

                    <div className="eq2-row-info" onClick={() => navigate(`/personas/${encodeURIComponent(w.rut)}`)}>
                        <span className="eq2-row-name">
                            {w.nombre} {w.apellido || ''}
                            {isSup && <span className="eq2-row-sup-badge">Supervisor</span>}
                        </span>
                        <span className="eq2-row-rut">{w.rut}</span>
                    </div>

                    {!isSup && (
                        <div className="eq2-row-chips">
                            {cargoLabels.length > 0
                                ? cargoLabels.map((l, i) => <span key={i} className="eq2-chip">{l}</span>)
                                : <span className="eq2-chip eq2-chip--empty">Sin cargo</span>
                            }
                        </div>
                    )}

                    {isSup && <div style={{ flex: 1 }} />}

                    <div className="eq2-row-actions" onClick={(e) => e.stopPropagation()}>
                        {canFirmaAsistida && (
                            <button
                                className="btn btn-secondary btn-sm"
                                onClick={() => { setFirmaWorkerId(w.personaId); setFirmaOpen(true); }}
                            >
                                Firma
                            </button>
                        )}
                        <button
                            className="eq2-edit-btn"
                            onClick={() => toggleExpand(w.personaId)}
                            title={isExpanded ? 'Cerrar' : 'Editar'}
                        >
                            <FiEdit2 size={13} className={isExpanded ? 'eq2-edit-icon--active' : ''} />
                        </button>
                    </div>
                </div>

                {isExpanded && (
                    <div className="eq2-row-panel" onClick={(e) => e.stopPropagation()}>
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

                        <div className="eq2-panel-actions">
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
                                className="btn btn-ghost btn-sm eq2-baja-btn"
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

    // ── Container renderer ────────────────────────────────────────────────────
    const renderContainer = (opts: {
        id: string;
        title: string;
        count: number;
        supervisor?: any;
        workers: any[];
        isGestion?: boolean;
        isSinCuadrilla?: boolean;
    }) => {
        const { id, title, count, supervisor, workers, isGestion = false, isSinCuadrilla = false } = opts;
        const isDragOver = dragOverContainerId === id;
        const isGestionDragOver = isDragOver && isGestion;
        const dropProps = makeContainerDropProps(id);

        if (count === 0 && !supervisor && !isGestion && !isSinCuadrilla) return null;
        if (isGestion && count === 0) return null;
        if (isSinCuadrilla && workers.filter(matchesSearch).length === 0) return null;

        return (
            <div
                key={id}
                className={`eq2-crew${isDragOver && !isGestion ? ' eq2-crew--dragover' : ''}${isGestionDragOver ? ' eq2-crew--dragwarn' : ''}${isSinCuadrilla ? ' eq2-crew--warn' : ''}`}
                {...dropProps}
            >
                <div className={`eq2-crew-head${isSinCuadrilla ? ' eq2-crew-head--warn' : ''}`}>
                    {isSinCuadrilla && <FiAlertTriangle size={14} style={{ flexShrink: 0 }} />}
                    <span className="eq2-crew-title">{title}</span>
                    <span className={`eq2-crew-count${isSinCuadrilla ? ' eq2-crew-count--warn' : ''}`}>{count}</span>
                    {isSinCuadrilla && (
                        <span className="eq2-crew-hint">Arrastra estos trabajadores a una cuadrilla.</span>
                    )}
                    {isGestion && dragPersonaId && (
                        <span className="eq2-crew-hint eq2-crew-hint--warn">
                            Este equipo no acepta trabajadores de cuadrilla.
                        </span>
                    )}
                </div>

                {mode === 'grid' ? (
                    <div className="eq2-crew-grid">
                        {supervisor && renderCard(supervisor, { isSup: true })}
                        {workers.filter(matchesSearch).map((w) =>
                            renderCard(w, { isDraggable: !isGestion && rolTipoDe(w) === 'trabajador' })
                        )}
                        {!supervisor && workers.filter(matchesSearch).length === 0 && (
                            <div className="eq2-crew-empty-grid">Sin personas en este equipo.</div>
                        )}
                    </div>
                ) : (
                    <div className="eq2-crew-list">
                        {supervisor && renderRow(supervisor, { isSup: true })}
                        {workers.filter(matchesSearch).map((w) =>
                            renderRow(w, {
                                isDraggable: !isGestion && rolTipoDe(w) === 'trabajador',
                                showSupervisor: !isGestion,
                            })
                        )}
                        {!supervisor && workers.filter(matchesSearch).length === 0 && (
                            <div className="eq2-crew-empty-list">Sin personas en este equipo.</div>
                        )}
                    </div>
                )}
            </div>
        );
    };

    // ── Loading ───────────────────────────────────────────────────────────────
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

            />

            {error && <AlertBanner variant="error" message={error} onDismiss={() => setError('')} />}

            {/* ── Sección: equipo en obra ── */}
            <div className="card eq2-section">
                {/* Toolbar */}
                <div className="eq2-toolbar">
                    <div className="eq2-toolbar-left">
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
                        <span className="eq2-count-text">
                            {activeAssigned.length} activos · {supervisores.length} cuadrilla{supervisores.length !== 1 ? 's' : ''}
                            {sinCuadrilla.length > 0 ? ` · ${sinCuadrilla.length} sin cuadrilla` : ''}
                        </span>
                    </div>
                    <div className="eq2-toolbar-right">
                        <div className="eq2-mode-toggle" role="group" aria-label="Vista">
                            <button
                                className={`eq2-mode-btn${mode === 'grid' ? ' eq2-mode-btn--active' : ''}`}
                                onClick={() => setMode('grid')} title="Cuadrícula"
                                aria-pressed={mode === 'grid'}
                            >
                                <FiGrid size={15} />
                            </button>
                            <button
                                className={`eq2-mode-btn${mode === 'list' ? ' eq2-mode-btn--active' : ''}`}
                                onClick={() => setMode('list')} title="Lista"
                                aria-pressed={mode === 'list'}
                            >
                                <FiList size={15} />
                            </button>
                        </div>
                    </div>
                </div>

                {/* Containers */}
                {assigned.length === 0 ? (
                    <div className="eq-empty-state">
                        <FiUsers size={28} style={{ opacity: 0.25, marginBottom: 8 }} />
                        <span>No hay personas en esta obra. Agrégalas desde la sección de abajo.</span>
                    </div>
                ) : (
                    <div className="eq2-groups">
                        {/* Equipo de gestión */}
                        {renderContainer({
                            id: GESTION_CONTAINER,
                            title: `Equipo de gestión`,
                            count: gestion.filter(matchesSearch).length,
                            workers: gestion,
                            isGestion: true,
                        })}

                        {/* Sin cuadrilla */}
                        {renderContainer({
                            id: SIN_CUADRILLA_CONTAINER,
                            title: `Sin cuadrilla asignada`,
                            count: sinCuadrilla.filter(matchesSearch).length,
                            workers: sinCuadrilla,
                            isSinCuadrilla: true,
                        })}

                        {/* Cuadrillas por supervisor */}
                        {supervisores.map((sup) => {
                            const crew = cuadrillaDe(sup.personaId);
                            const visibleCrew = crew.filter(matchesSearch);
                            const supVisible = matchesSearch(sup);
                            if (!supVisible && visibleCrew.length === 0) return null;
                            const total = crew.length + 1; // +1 for the supervisor
                            return renderContainer({
                                id: sup.personaId,
                                title: `Equipo de ${sup.nombre} ${sup.apellido || ''}`.trim(),
                                count: total,
                                supervisor: supVisible ? sup : undefined,
                                workers: crew,
                            });
                        })}

                        {/* Dados de baja */}
                        {inactiveAssigned.length > 0 && (
                            <details className="eq-baja-section">
                                <summary className="eq-baja-summary">
                                    Dados de baja · {inactiveAssigned.length}
                                </summary>
                                <div className="eq2-crew-list" style={{ marginTop: 'var(--space-2)' }}>
                                    {inactiveAssigned.map((w) => (
                                        <div key={w.personaId} className="eq2-row eq2-row--inactive">
                                            <div className="eq2-row-bar">
                                                <div className="eq2-row-avatar eq2-row-avatar--inactive">
                                                    {initials(w.nombre, w.apellido)}
                                                </div>
                                                <div className="eq2-row-info">
                                                    <span className="eq2-row-name">{w.nombre} {w.apellido || ''}</span>
                                                    <span className="eq2-row-rut">{w.rut}</span>
                                                </div>
                                                <div style={{ flex: 1 }} />
                                                <div className="eq2-row-actions">
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
                <div className="card eq2-section">
                    <div className="eq-section-head" style={{ marginBottom: 'var(--space-3)' }}>
                        <div>
                            <div className="eq-section-title">Agregar personas</div>
                            <div className="eq-section-sub">{filteredUnassigned.length} disponible{filteredUnassigned.length !== 1 ? 's' : ''} en la empresa</div>
                        </div>
                    </div>
                    <div className="eq2-toolbar" style={{ marginBottom: 'var(--space-3)' }}>
                        <div className="eq2-toolbar-left">
                            <div className="eq-search-wrap">
                                <FiSearch size={14} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                                <input
                                    className="form-input"
                                    style={{ flex: 1, fontSize: 'var(--text-sm)', minWidth: 160 }}
                                    placeholder="Buscar persona…"
                                    value={search}
                                    onChange={(e) => setSearch(e.target.value)}
                                />
                            </div>
                        </div>
                    </div>

                    {filteredUnassigned.length === 0 ? (
                        <div className="eq-empty-state">
                            {search ? 'Sin resultados para esa búsqueda.' : 'Todas las personas de la empresa ya están en esta obra.'}
                        </div>
                    ) : mode === 'grid' ? (
                        <div className="eq2-crew-grid">
                            {filteredUnassigned.map(renderPoolCard)}
                        </div>
                    ) : (
                        <div className="eq-prow-list">
                            {filteredUnassigned.map(renderPoolRow)}
                        </div>
                    )}

                    {supervisorSelectOptions.length === 0 && unassigned.some((w) => rolTipoDe(w) === 'trabajador') && (
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

            {/* Popover de acciones por card asignado */}
            {cardAction && createPortal(
                <>
                    <div
                        style={{ position: 'fixed', inset: 0, zIndex: 1998 }}
                        onClick={() => setCardAction(null)}
                    />
                    <div
                        className="eq2-card-popover"
                        style={{
                            position: 'fixed',
                            top: Math.min(cardAction.rect.bottom + 6, window.innerHeight - 140),
                            left: Math.min(cardAction.rect.left, window.innerWidth - 210),
                            zIndex: 1999,
                        }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="eq2-card-popover-name">
                            {cardAction.worker.nombre} {cardAction.worker.apellido || ''}
                        </div>
                        <button
                            className="eq2-card-popover-btn"
                            onClick={() => {
                                const w = cardAction.worker;
                                setCardAction(null);
                                navigate(`/personas/${encodeURIComponent(w.rut)}`);
                            }}
                        >
                            <FiUser size={13} /> Ver perfil
                        </button>
                        <button
                            className="eq2-card-popover-btn"
                            onClick={() => {
                                const w = cardAction.worker;
                                setCardAction(null);
                                setEditModal({ worker: w });
                            }}
                        >
                            <FiEdit2 size={13} /> Editar
                        </button>
                        {canFirmaAsistida && (
                            <button
                                className="eq2-card-popover-btn eq2-card-popover-btn--firma"
                                onClick={() => {
                                    const w = cardAction.worker;
                                    setCardAction(null);
                                    setFirmaWorkerId(w.personaId);
                                    setFirmaOpen(true);
                                }}
                            >
                                <FiPenTool size={13} /> Firmar asistido
                            </button>
                        )}
                    </div>
                </>,
                document.body
            )}

            {/* Popover de acciones por card del pool (ver perfil / agregar a obra) */}
            {poolCardAction && createPortal(
                <>
                    <div
                        style={{ position: 'fixed', inset: 0, zIndex: 1998 }}
                        onClick={() => setPoolCardAction(null)}
                    />
                    <div
                        className="eq2-card-popover"
                        style={{
                            position: 'fixed',
                            top: Math.min(poolCardAction.rect.bottom + 6, window.innerHeight - 110),
                            left: Math.min(poolCardAction.rect.left, window.innerWidth - 210),
                            zIndex: 1999,
                        }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="eq2-card-popover-name">
                            {poolCardAction.worker.nombre} {poolCardAction.worker.apellido || ''}
                        </div>
                        <button
                            className="eq2-card-popover-btn"
                            onClick={() => {
                                const w = poolCardAction.worker;
                                setPoolCardAction(null);
                                navigate(`/personas/${encodeURIComponent(w.rut)}`);
                            }}
                        >
                            <FiUser size={13} /> Ver perfil
                        </button>
                        <button
                            className="eq2-card-popover-btn eq2-card-popover-btn--firma"
                            onClick={() => {
                                const w = poolCardAction.worker;
                                setPoolCardAction(null);
                                setAddToObraModal({ worker: w });
                            }}
                        >
                            <FiUserPlus size={13} /> Agregar a la obra
                        </button>
                    </div>
                </>,
                document.body
            )}

            {/* Modal: elegir contenedor al que asignar */}
            <Modal
                isOpen={!!addToObraModal}
                onClose={() => setAddToObraModal(null)}
                title="¿A qué equipo asignar?"
                subtitle={addToObraModal ? `${addToObraModal.worker.nombre} ${addToObraModal.worker.apellido || ''}`.trim() : ''}
                size="sm"
            >
                {addToObraModal && (
                    <div className="eq-team-list">
                        {/* Equipo de gestión */}
                        <button
                            className="eq-team-btn"
                            disabled={updating === addToObraModal.worker.personaId}
                            onClick={async () => {
                                const w = addToObraModal.worker;
                                setAddToObraModal(null);
                                await handleAddToContainer(w, GESTION_CONTAINER);
                            }}
                        >
                            <div className="eq-team-icon"><FiUsers size={15} /></div>
                            <div className="eq-team-info">
                                <span className="eq-team-name">Equipo de gestión</span>
                                <span className="eq-team-meta">{gestion.length} persona{gestion.length !== 1 ? 's' : ''}</span>
                            </div>
                        </button>

                        {/* Cuadrillas por supervisor */}
                        {supervisores.map((sup) => (
                            <button
                                key={sup.personaId}
                                className="eq-team-btn"
                                disabled={updating === addToObraModal.worker.personaId}
                                onClick={async () => {
                                    const w = addToObraModal.worker;
                                    setAddToObraModal(null);
                                    await handleAddToContainer(w, sup.personaId);
                                }}
                            >
                                <div className="eq-team-icon eq-team-icon--avatar">
                                    {initials(sup.nombre, sup.apellido)}
                                </div>
                                <div className="eq-team-info">
                                    <span className="eq-team-name">{sup.nombre} {sup.apellido || ''}</span>
                                    <span className="eq-team-meta">Cuadrilla · {cuadrillaDe(sup.personaId).length} persona{cuadrillaDe(sup.personaId).length !== 1 ? 's' : ''}</span>
                                </div>
                            </button>
                        ))}

                        {/* Sin cuadrilla */}
                        <button
                            className="eq-team-btn eq-team-btn--muted"
                            disabled={updating === addToObraModal.worker.personaId}
                            onClick={async () => {
                                const w = addToObraModal.worker;
                                setAddToObraModal(null);
                                await handleAddToContainer(w, SIN_CUADRILLA_CONTAINER);
                            }}
                        >
                            <div className="eq-team-icon"><FiUsers size={15} /></div>
                            <div className="eq-team-info">
                                <span className="eq-team-name">Sin cuadrilla</span>
                                <span className="eq-team-meta">Agregar sin asignar supervisor</span>
                            </div>
                        </button>
                    </div>
                )}
            </Modal>

            {/* Modal de edición (rol, cargo, cuadrilla) */}
            {editModal && (() => {
                const w = editModal.worker;
                const roleId = currentRoleId(w);
                const currCargos = assignCargos[w.personaId] ?? cargosActuales(w);
                const isDirty = !!assignCargos[w.personaId];
                const esTrabajador = rolTipoDe(w) === 'trabajador';
                const sup = supervisorDe(w) || '';
                return (
                    <Modal
                        isOpen
                        onClose={() => { setEditModal(null); setAssignCargos((p) => { const n = { ...p }; delete n[w.personaId]; return n; }); }}
                        title="Editar persona"
                        subtitle={`${w.nombre} ${w.apellido || ''}`.trim()}
                        size="sm"
                        footer={
                            <div style={{ display: 'flex', gap: 'var(--space-2)', width: '100%' }}>
                                <button
                                    className="btn btn-ghost btn-sm eq2-baja-btn"
                                    disabled={updating === w.personaId || w.rol === 'admin'}
                                    onClick={async () => { setEditModal(null); await handleBaja(w); }}
                                    style={{ marginRight: 'auto' }}
                                >
                                    <FiX size={13} /> Dar de baja
                                </button>
                                {isDirty && (
                                    <button
                                        className="btn btn-primary btn-sm"
                                        disabled={updating === w.personaId}
                                        onClick={async () => { await handleUpdateCargos(w); setEditModal(null); }}
                                    >
                                        <FiCheck size={13} /> Guardar
                                    </button>
                                )}
                                <button
                                    className="btn btn-secondary btn-sm"
                                    onClick={() => { setEditModal(null); setAssignCargos((p) => { const n = { ...p }; delete n[w.personaId]; return n; }); }}
                                >
                                    Cerrar
                                </button>
                            </div>
                        }
                    >
                        <div className="eq-edit-modal-body">
                            <div>
                                <label className="form-label">Rol</label>
                                <select
                                    className="form-input form-select"
                                    value={roleId}
                                    disabled={w.rol === 'admin' || updating === w.personaId}
                                    onChange={(e) => handleRolChange(w, e.target.value)}
                                >
                                    {!rolOptions.some((o) => o.value === roleId) && (
                                        <option value={roleId}>{w.rolNombre || w.rol}</option>
                                    )}
                                    {rolOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                                </select>
                            </div>
                            <div>
                                <label className="form-label">Cargos</label>
                                <CargoDropdown
                                    options={cargoOptions}
                                    selected={currCargos}
                                    onToggle={(code) => toggleCargo(w.personaId, code, cargosActuales(w))}
                                />
                            </div>
                            {esTrabajador && (
                                supervisorSelectOptions.length > 0 ? (
                                    <div>
                                        <label className="form-label">Cuadrilla</label>
                                        <SupervisorAutocomplete
                                            options={supervisorSelectOptions}
                                            value={sup}
                                            onChange={(v) => handleSupervisorChange(w, v)}
                                        />
                                    </div>
                                ) : (
                                    <div className="eq-sup-warn">
                                        <FiAlertTriangle size={14} style={{ flexShrink: 0 }} />
                                        <span>No hay supervisores en esta obra.</span>
                                    </div>
                                )
                            )}
                        </div>
                    </Modal>
                );
            })()}

            {/* Modal confirmación gestión */}
            {gestionModalPersona && (
                <GestionConfirmModal
                    persona={gestionModalPersona}
                    onClose={() => setGestionModalPersona(null)}
                    onConfirm={handleGestionConfirm}
                />
            )}

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
                /* ── Spinner ─────────────────────────────────────────────── */
                .spinner {
                    width: 28px; height: 28px;
                    border: 3px solid var(--surface-border);
                    border-top-color: var(--primary-500);
                    border-radius: 50%;
                    animation: spin 0.8s linear infinite;
                }
                @keyframes spin { to { transform: rotate(360deg); } }

                /* ── Section ─────────────────────────────────────────────── */
                .eq2-section { padding: var(--space-4); margin-bottom: var(--space-4); }
                .eq-section-head {
                    display: flex; align-items: flex-start; justify-content: space-between;
                    gap: var(--space-3); flex-wrap: wrap; margin-bottom: var(--space-4);
                }
                .eq-section-title { font-weight: 700; font-size: var(--text-base); color: var(--text-primary); margin-bottom: 2px; }
                .eq-section-sub { font-size: var(--text-xs); color: var(--text-muted); }

                /* ── Toolbar ─────────────────────────────────────────────── */
                .eq2-toolbar {
                    display: flex; align-items: center; justify-content: space-between;
                    gap: var(--space-3); flex-wrap: wrap; margin-bottom: var(--space-4);
                }
                .eq2-toolbar-left {
                    display: flex; align-items: center; gap: var(--space-2); flex-wrap: wrap; flex: 1; min-width: 0;
                }
                .eq2-toolbar-right { display: flex; align-items: center; gap: var(--space-2); flex-shrink: 0; }
                .eq2-count-text { font-size: var(--text-xs); color: var(--text-muted); white-space: nowrap; }

                /* ── Mode toggle ─────────────────────────────────────────── */
                .eq2-mode-toggle {
                    display: flex; border: 1px solid var(--surface-border);
                    border-radius: var(--radius-sm); overflow: hidden;
                }
                .eq2-mode-btn {
                    display: flex; align-items: center; justify-content: center;
                    width: 32px; height: 32px; border: none; background: none;
                    color: var(--text-muted); cursor: pointer;
                    transition: background 0.12s, color 0.12s;
                }
                .eq2-mode-btn:hover { background: var(--surface-hover); color: var(--text-primary); }
                .eq2-mode-btn--active { background: var(--accent-tint); color: var(--accent); }

                /* ── Groups & containers ─────────────────────────────────── */
                .eq2-groups { display: flex; flex-direction: column; gap: var(--space-4); }
                .eq2-crew {
                    border: 1px solid var(--surface-border);
                    border-radius: var(--radius-lg);
                    overflow: hidden;
                    transition: border-color 0.15s, box-shadow 0.15s;
                }
                .eq2-crew--dragover {
                    border-color: var(--accent);
                    box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 20%, transparent 80%);
                }
                .eq2-crew--dragwarn {
                    border-color: var(--warning-500, #d97706) !important;
                    box-shadow: 0 0 0 3px rgba(217,119,6,0.20) !important;
                }
                .eq2-crew--warn {
                    border-color: rgba(239,68,68,0.35);
                }

                /* ── Crew header ─────────────────────────────────────────── */
                .eq2-crew-head {
                    display: flex; align-items: center; gap: var(--space-2);
                    padding: 10px var(--space-4);
                    background: var(--surface-subtle, rgba(0,0,0,0.02));
                    border-bottom: 1px solid var(--surface-border);
                }
                .eq2-crew-head--warn { color: var(--danger-500, #ef4444); }
                .eq2-crew-title { font-weight: 700; font-size: var(--text-sm); color: var(--text-primary); }
                .eq2-crew-head--warn .eq2-crew-title { color: var(--danger-500, #ef4444); }
                .eq2-crew-count {
                    font-size: 11px; font-weight: 700; padding: 1px 8px;
                    border-radius: 999px; background: var(--accent-tint); color: var(--accent-text);
                }
                .eq2-crew-count--warn { background: rgba(239,68,68,0.12); color: var(--danger-500, #ef4444); }
                .eq2-crew-hint { font-size: var(--text-xs); color: var(--text-muted); flex: 1; }
                .eq2-crew-hint--warn { color: var(--warning-700, #b45309); font-weight: 500; }
                .eq2-crew-empty-list, .eq2-crew-empty-grid {
                    padding: var(--space-3) var(--space-4);
                    font-size: var(--text-xs); color: var(--text-muted); font-style: italic;
                }

                /* ── Grid layout ─────────────────────────────────────────── */
                .eq2-crew-grid {
                    display: grid;
                    grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
                    gap: 12px;
                    padding: var(--space-4);
                }
                @media (max-width: 640px) {
                    .eq2-crew-grid { grid-template-columns: repeat(2, 1fr); }
                }

                /* ── Grid card ───────────────────────────────────────────── */
                .eq2-card {
                    position: relative;
                    display: flex; flex-direction: column; align-items: center; text-align: center;
                    padding: 20px 14px 14px;
                    border-radius: 12px; border: 1px solid var(--surface-border);
                    background: var(--surface-card);
                    cursor: pointer; user-select: none;
                    transition: transform 0.18s ease, box-shadow 0.18s ease, border-color 0.18s;
                    animation: eq2cardIn 0.25s ease both;
                }
                @keyframes eq2cardIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
                .eq2-card:hover { transform: translateY(-3px); box-shadow: 0 8px 24px -4px rgba(0,0,0,0.18); border-color: var(--primary-400); }
                .eq2-card--draggable { cursor: grab; }
                .eq2-card--draggable:active { cursor: grabbing; }
                .eq2-card--dragging { opacity: 0.4; transform: scale(0.97); }
                .eq2-card--sup {
                    border-color: color-mix(in srgb, var(--accent) 30%, var(--surface-border) 70%);
                }

                /* Supervisor badge on card — below the name, not overlapping the avatar */
                .eq2-sup-badge {
                    display: inline-block;
                    font-size: 10px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase;
                    padding: 2px 8px; border-radius: 999px;
                    background: var(--accent); color: #fff;
                    margin-bottom: 4px;
                }

                /* Card avatar */
                .eq2-card-avatar {
                    width: 52px; height: 52px; border-radius: 50%; flex-shrink: 0;
                    display: flex; align-items: center; justify-content: center;
                    font-weight: 700; font-size: 18px; text-transform: uppercase;
                    background: rgba(0,110,220,0.12); color: var(--accent-text, #4d9fff);
                    border: 1.5px solid rgba(0,110,220,0.2);
                }

                /* Card text */
                .eq2-card-name {
                    font-size: 13px; font-weight: 600; color: var(--text-primary);
                    line-height: 1.35; word-break: break-word; margin: 10px 0 4px; width: 100%;
                }
                .eq2-card-rut {
                    font-family: var(--font-mono, monospace); font-size: 10px;
                    color: var(--text-muted); letter-spacing: 0.04em;
                }
                .eq2-card-cargo {
                    font-size: 11px; color: var(--text-secondary);
                    margin-top: 10px; padding-top: 9px;
                    border-top: 1px solid var(--surface-border);
                    width: 100%; word-break: break-word; line-height: 1.4;
                }

                /* ── List layout ─────────────────────────────────────────── */
                .eq2-crew-list { display: flex; flex-direction: column; }

                /* ── List row ────────────────────────────────────────────── */
                .eq2-row { border-bottom: 1px solid var(--surface-border); }
                .eq2-row:last-child { border-bottom: none; }
                .eq2-row--inactive .eq2-row-bar { opacity: 0.55; }
                .eq2-row--dragging { opacity: 0.4; }

                .eq2-row-bar {
                    display: flex; align-items: center; gap: var(--space-3);
                    padding: 10px var(--space-4); transition: background 0.12s;
                }
                .eq2-row-bar:hover { background: var(--surface-hover); }
                .eq2-row--expanded .eq2-row-bar { background: var(--surface-hover); }

                .eq2-row--sup .eq2-row-bar {
                    padding: 12px var(--space-4);
                    background: color-mix(in srgb, var(--accent) 5%, var(--surface-subtle, rgba(0,0,0,0.02)) 95%);
                    border-bottom: 1px solid var(--surface-border);
                }
                .eq2-row--sup.eq2-row--expanded .eq2-row-bar,
                .eq2-row--sup .eq2-row-bar:hover {
                    background: color-mix(in srgb, var(--accent) 10%, var(--surface-hover) 90%);
                }

                /* Drag handle */
                .eq2-drag-handle {
                    font-size: 14px; color: var(--text-muted); cursor: grab;
                    padding: 0 2px; user-select: none; flex-shrink: 0;
                    opacity: 0.4; transition: opacity 0.12s;
                }
                .eq2-row-bar:hover .eq2-drag-handle { opacity: 0.8; }
                .eq2-drag-handle:active { cursor: grabbing; }

                /* Row avatar */
                .eq2-row-avatar {
                    width: 34px; height: 34px; border-radius: 50%; flex-shrink: 0;
                    display: flex; align-items: center; justify-content: center;
                    font-weight: 700; font-size: var(--text-xs); text-transform: uppercase;
                    background: rgba(0,110,220,0.12); color: var(--accent-text, #4d9fff);
                    border: 1.5px solid rgba(0,110,220,0.2); cursor: pointer;
                }
                .eq2-row-avatar--sup {
                    width: 38px; height: 38px; font-size: var(--text-sm);
                }
                .eq2-row-avatar--inactive {
                    background: var(--surface-hover); color: var(--text-muted); border-color: var(--surface-border);
                }

                /* Row info */
                .eq2-row-info { flex: 0 0 auto; cursor: pointer; min-width: 120px; }
                .eq2-row-name { font-weight: 500; font-size: var(--text-sm); color: var(--text-primary); display: block; }
                .eq2-row--sup .eq2-row-name { font-weight: 700; }
                .eq2-row-rut { font-size: var(--text-xs); color: var(--text-muted); display: block; margin-top: 1px; }

                /* Supervisor inline badge (list mode) */
                .eq2-row-sup-badge {
                    margin-left: 8px; font-size: 10px; font-weight: 700;
                    letter-spacing: 0.04em; text-transform: uppercase;
                    padding: 1px 7px; border-radius: 999px;
                    background: var(--accent); color: #fff;
                    vertical-align: middle;
                }

                /* Cargo chips */
                .eq2-row-chips {
                    display: flex; gap: 4px; flex: 1; flex-wrap: wrap; align-items: center; min-width: 0;
                }
                .eq2-chip {
                    font-size: 11px; font-weight: 600; white-space: nowrap;
                    padding: 2px 9px; border-radius: 999px;
                    background: var(--accent-tint, rgba(0,110,220,0.10));
                    color: var(--accent-text, #4d9fff);
                }
                .eq2-chip--empty { opacity: 0.4; font-weight: 400; font-style: italic; }

                /* Row actions */
                .eq2-row-actions { display: flex; gap: 6px; align-items: center; flex-shrink: 0; }
                .eq2-edit-btn {
                    display: flex; align-items: center; justify-content: center;
                    width: 30px; height: 30px; border: 1px solid var(--surface-border);
                    background: var(--surface-elevated); color: var(--text-muted);
                    border-radius: var(--radius-md); cursor: pointer;
                    transition: background 0.12s, color 0.12s, border-color 0.12s;
                }
                .eq2-edit-btn:hover { background: var(--surface-hover); color: var(--text-primary); border-color: var(--accent); }
                .eq2-edit-icon--active { color: var(--accent); }

                /* Expanded panel */
                .eq2-row-panel {
                    display: flex; gap: var(--space-3); flex-wrap: wrap; align-items: flex-end;
                    padding: var(--space-3) var(--space-4) var(--space-3) 62px;
                    background: var(--surface-subtle, rgba(0,0,0,0.02));
                    border-top: 1px dashed var(--surface-border);
                }
                .eq2-panel-actions {
                    display: flex; gap: 6px; align-items: center; margin-left: auto; flex-shrink: 0;
                }
                .eq2-baja-btn { color: var(--danger-500) !important; }

                /* ── Card action popover ─────────────────────────────────── */
                .eq2-card-popover {
                    background: var(--surface-elevated);
                    border: 1px solid var(--surface-border);
                    border-radius: var(--radius-lg);
                    box-shadow: 0 8px 28px rgba(0,0,0,0.18);
                    min-width: 190px;
                    overflow: hidden;
                    animation: eq2popIn 0.12s ease both;
                }
                @keyframes eq2popIn {
                    from { opacity: 0; transform: translateY(-4px) scale(0.97); }
                    to   { opacity: 1; transform: translateY(0)   scale(1); }
                }
                .eq2-card-popover-name {
                    padding: 9px 14px 8px;
                    font-size: var(--text-xs); font-weight: 700;
                    color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.04em;
                    border-bottom: 1px solid var(--surface-border);
                    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
                }
                .eq2-card-popover-btn {
                    display: flex; align-items: center; gap: 9px;
                    width: 100%; padding: 10px 14px;
                    font-size: var(--text-sm); font-weight: 500;
                    color: var(--text-primary);
                    background: transparent; border: none; cursor: pointer;
                    text-align: left; transition: background 0.1s;
                }
                .eq2-card-popover-btn:hover { background: var(--surface-hover); }
                .eq2-card-popover-btn--firma {
                    color: var(--accent); border-top: 1px solid var(--surface-border);
                }
                .eq2-card-popover-btn--firma:hover { background: var(--accent-tint); }
                .eq2-card--open {
                    border-color: var(--accent);
                    box-shadow: 0 0 0 2px var(--accent-tint);
                }

                /* ── Gestión confirm modal ────────────────────────────────── */
                .eq-modal-overlay {
                    position: fixed; inset: 0; z-index: 9000;
                    background: rgba(0,0,0,0.45); backdrop-filter: blur(2px);
                    display: flex; align-items: center; justify-content: center; padding: var(--space-4);
                }
                .eq-modal {
                    background: var(--surface-card); border: 1px solid var(--surface-border);
                    border-radius: var(--radius-xl); box-shadow: 0 24px 64px rgba(0,0,0,0.25);
                    padding: var(--space-6); max-width: 440px; width: 100%;
                    display: flex; flex-direction: column; gap: var(--space-3);
                }
                .eq-modal-icon {
                    width: 40px; height: 40px; border-radius: 50%;
                    background: rgba(217,119,6,0.12); color: var(--warning-700, #b45309);
                    display: flex; align-items: center; justify-content: center;
                }
                .eq-modal-title { font-size: var(--text-lg); font-weight: 700; color: var(--text-primary); margin: 0; }
                .eq-modal-body { font-size: var(--text-sm); color: var(--text-secondary); margin: 0; line-height: 1.6; }
                .eq-modal-prompt { font-size: var(--text-sm); color: var(--text-primary); font-weight: 500; margin: 0; }
                .eq-modal-expected {
                    font-family: var(--font-mono, monospace); font-size: var(--text-sm);
                    padding: 8px 12px; border-radius: var(--radius-md);
                    background: var(--surface-subtle, rgba(0,0,0,0.04));
                    border: 1px solid var(--surface-border); color: var(--text-primary);
                    user-select: all;
                }
                .eq-modal-input {
                    font-size: var(--text-sm); padding: 8px 12px;
                    border: 1px solid var(--surface-border); border-radius: var(--radius-md);
                    background: var(--surface-elevated); color: var(--text-primary);
                    transition: border-color 0.12s, box-shadow 0.12s;
                    width: 100%; box-sizing: border-box;
                }
                .eq-modal-input:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-tint); }
                .eq-modal-actions { display: flex; gap: var(--space-2); justify-content: flex-end; margin-top: var(--space-1); }

                /* ── Shared helpers ──────────────────────────────────────── */
                .eq-search-wrap {
                    display: flex; align-items: center; gap: var(--space-2);
                    border: 1px solid var(--surface-border); border-radius: var(--radius-md);
                    padding: 0 var(--space-2); background: var(--surface); min-width: 200px;
                }
                .eq-search-wrap .form-input { border: none; box-shadow: none; background: transparent; padding: 6px 0; }
                .eq-empty-state {
                    display: flex; flex-direction: column; align-items: center; justify-content: center;
                    padding: var(--space-8) var(--space-4); gap: 4px;
                    text-align: center; color: var(--text-muted); font-size: var(--text-sm);
                }

                /* ── Controls (labels + inputs) ──────────────────────────── */
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
                .eq-select:hover:not(:disabled) { border-color: var(--accent); }
                .eq-select:focus-visible { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-tint); }
                .eq-select:disabled { opacity: 0.55; cursor: default; }

                /* ── Cargo dropdown ──────────────────────────────────────── */
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
                    position: absolute; z-index: 1000001; top: calc(100% + 4px); left: 0;
                    min-width: 200px; max-height: 260px; overflow-y: auto;
                    background: var(--surface-elevated); border: 1px solid var(--surface-border);
                    border-radius: var(--radius-md); box-shadow: 0 8px 24px rgba(0,0,0,0.16); padding: 4px;
                }
                .eq-dd-item {
                    display: flex; align-items: center; gap: 8px; padding: 6px 8px;
                    border-radius: var(--radius-sm); font-size: var(--text-sm); cursor: pointer; color: var(--text-primary);
                }
                .eq-dd-item:hover { background: var(--surface-hover); }

                /* ── Supervisor autocomplete ──────────────────────────────── */
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

                /* ── Supervisor warning ───────────────────────────────────── */
                .eq-sup-warn {
                    display: flex; align-items: center; gap: 8px; flex: 1; min-width: 190px;
                    padding: 8px 10px; border-radius: var(--radius-md);
                    background: rgba(217,119,6,0.10); border: 1px solid rgba(217,119,6,0.35);
                    color: var(--warning-700, #b45309); font-size: var(--text-xs); font-weight: 500;
                }

                /* ── Edit modal form fields ──────────────────────────────── */
                .eq-edit-modal-body {
                    display: flex; flex-direction: column; gap: var(--space-4);
                }
                /* Scale CargoDropdown trigger to match form-input */
                .eq-edit-modal-body .eq-dd { min-width: 0; width: 100%; }
                .eq-edit-modal-body .eq-dd-btn {
                    padding: var(--space-3) var(--space-4);
                    font-size: var(--text-base);
                    min-height: 42px;
                    border-radius: var(--radius-md);
                }
                /* Scale SupervisorAutocomplete to match form-input */
                .eq-edit-modal-body .eq-ac { min-width: 0; width: 100%; }
                .eq-edit-modal-body .eq-ac-control {
                    padding: var(--space-3) var(--space-4);
                    min-height: 42px;
                    border-radius: var(--radius-md);
                }
                .eq-edit-modal-body .eq-ac-input { font-size: var(--text-base); }

                /* ── Add section ─────────────────────────────────────────── */
                .eq-prow-list { display: flex; flex-direction: column; }
                .eq-prow-info { flex: 0 0 auto; cursor: pointer; min-width: 120px; }
                .eq-worker-avatar {
                    width: 34px; height: 34px; border-radius: 50%; flex-shrink: 0;
                    display: flex; align-items: center; justify-content: center;
                    font-weight: 700; font-size: var(--text-xs); text-transform: uppercase;
                    background: rgba(0,110,220,0.12); color: var(--accent-text, #4d9fff);
                    border: 1.5px solid rgba(0,110,220,0.2);
                }
                .eq-worker-name { font-weight: 500; font-size: var(--text-sm); color: var(--text-primary); display: block; }
                .eq-worker-rut { font-size: var(--text-xs); color: var(--text-muted); display: block; margin-top: 1px; }
                .eq-add-row {
                    display: flex; align-items: center; gap: var(--space-3); flex-wrap: wrap;
                    padding: var(--space-3) var(--space-4);
                    border-bottom: 1px solid var(--surface-border);
                    transition: background 0.12s;
                }
                .eq-add-row:last-of-type { border-bottom: none; }
                .eq-add-row:hover { background: var(--surface-hover); }
                .eq-add-controls { display: flex; gap: var(--space-3); flex: 1; flex-wrap: wrap; align-items: flex-end; }
                .eq-prow-bar-actions { display: flex; gap: 6px; align-items: center; flex-shrink: 0; }
                .eq-add-note {
                    display: flex; align-items: center; gap: 6px;
                    padding: var(--space-2) var(--space-4) var(--space-3);
                    font-size: var(--text-xs); color: var(--text-muted);
                }

                /* ── Pool card (unassigned, grid) ───────────────────────── */
                .eq2-card--pool {
                    border-style: dashed;
                    opacity: 0.88;
                }
                .eq2-card--pool:hover { opacity: 1; }

                /* ── Pool row (unassigned, list) ─────────────────────────── */
                .eq-pool-row {
                    display: flex; align-items: center; gap: var(--space-3);
                    padding: var(--space-3) var(--space-4);
                    border-bottom: 1px solid var(--surface-border);
                    cursor: pointer;
                    transition: background 0.12s;
                }
                .eq-pool-row:last-of-type { border-bottom: none; }
                .eq-pool-row:hover { background: var(--surface-hover); }
                .eq-pool-row--open { background: var(--accent-tint); }
                .eq-pool-add-btn { margin-left: auto; flex-shrink: 0; }

                /* ── Asignar a equipo modal list ─────────────────────────── */
                .eq-team-list { display: flex; flex-direction: column; gap: var(--space-2); }
                .eq-team-btn {
                    display: flex; align-items: center; gap: var(--space-3);
                    width: 100%; text-align: left;
                    padding: var(--space-3) var(--space-4);
                    background: var(--surface-elevated);
                    border: 1px solid var(--surface-border);
                    border-radius: var(--radius-md);
                    cursor: pointer;
                    transition: background 0.12s, border-color 0.12s, transform 0.12s;
                }
                .eq-team-btn:hover:not(:disabled) {
                    background: var(--surface-hover);
                    border-color: var(--accent);
                    transform: translateY(-1px);
                }
                .eq-team-btn:disabled { opacity: 0.5; cursor: default; }
                .eq-team-btn--muted { opacity: 0.75; }
                .eq-team-btn--muted:hover:not(:disabled) { opacity: 1; }
                .eq-team-icon {
                    width: 36px; height: 36px; flex-shrink: 0;
                    display: flex; align-items: center; justify-content: center;
                    background: var(--accent-tint); color: var(--accent);
                    border-radius: var(--radius-md); font-size: var(--text-sm);
                }
                .eq-team-icon--avatar {
                    font-weight: 700; font-size: var(--text-xs);
                    background: rgba(0,110,220,0.12); color: var(--accent-text, #4d9fff);
                    border: 1.5px solid rgba(0,110,220,0.2);
                    border-radius: 50%;
                }
                .eq-team-info { display: flex; flex-direction: column; min-width: 0; }
                .eq-team-name {
                    font-size: var(--text-sm); font-weight: 600;
                    color: var(--text-primary); white-space: nowrap;
                    overflow: hidden; text-overflow: ellipsis;
                }
                .eq-team-meta { font-size: var(--text-xs); color: var(--text-muted); margin-top: 1px; }

                /* ── Dados de baja ───────────────────────────────────────── */
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
