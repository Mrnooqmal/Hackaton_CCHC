import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { documentsApi, obrasApi, workersApi } from '../api/client';
import { tenantsApi, type TenantRole } from '../api/tenants.api';
import { useCargoCatalog } from '../hooks/useCargoCatalog';
import { useObraOnboarding } from '../hooks/useObraOnboarding';
import type { OnboardingItem, OnboardingWorker } from '../utils/onboardingObra';
import { useObraContext } from '../context/ObraContext';
import { AlertBanner, Modal } from './ui';
import type { CollectionMode } from './ui';
import { PERMISSIONS } from '../permissions';
import FirmaAsistidaModal from './FirmaAsistidaModal';
import { EquipoObraSkeleton } from './ui/Skeletons';
import {
    FiSearch, FiUserPlus, FiCheck, FiX, FiChevronDown, FiChevronRight,
    FiChevronUp, FiMoreHorizontal, FiPlus,
    FiAlertTriangle, FiUsers, FiEdit2, FiList, FiGrid,
    FiUser, FiPenTool, FiArrowRight, FiClipboard,
} from 'react-icons/fi';
import { LuCircleCheck, LuClock, LuShieldAlert } from 'react-icons/lu';

const GESTION_CONTAINER = '__gestion__';
const SIN_CUADRILLA_CONTAINER = '__sin_cuadrilla__';

const initials = (nombre: string, apellido?: string) =>
    `${nombre[0] ?? ''}${apellido?.[0] ?? nombre[1] ?? ''}`.toUpperCase();

/** Retrato de la persona; las iniciales son el respaldo cuando no hay foto. */
function PersonaAvatar({ w, className, onClick, title }: {
    w: any; className: string; onClick?: () => void; title?: string;
}) {
    return (
        <div className={className} onClick={onClick} title={title}>
            {w.fotoPerfil
                ? <img src={w.fotoPerfil} alt="" className="eq-avatar-img" />
                : initials(w.nombre, w.apellido)}
        </div>
    );
}

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

// ── Panel principal ──────────────────────────────────────────────────────────
/**
 * Equipo de una obra: cuadrillas, roles, cargos y seguimiento de onboarding.
 *
 * Es la vista de Personas cuando se entró a trabajar en una obra. Agrupa por
 * equipo (gestión, cuadrilla de cada supervisor, sin cuadrilla) y solo deja
 * sumar gente que ya existe a nivel empresa: dar de alta una persona nueva es
 * un acto de empresa, no de obra.
 */
export default function ObraEquipoPanel({ obraId }: { obraId: string }) {
    const { user, hasPermission } = useAuth();
    const navigate = useNavigate();
    const { options: cargoOptions } = useCargoCatalog();
    const { setSelectedObraId } = useObraContext();

    const canAsignar = hasPermission(PERMISSIONS.OBRA_ASIGNAR_TRABAJADORES);
    const canFirmaAsistida = hasPermission(PERMISSIONS.OBRA_FIRMA_ASISTIDA);
    const canSubirDocumentos = hasPermission(PERMISSIONS.OBRA_SUBIR_DOCUMENTOS);

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
    const [firmaOpen, setFirmaOpen] = useState(false);
    const [firmaWorkerId, setFirmaWorkerId] = useState<string | undefined>(undefined);
    // Transferencia de una persona a otra obra.
    const [allObras, setAllObras] = useState<any[]>([]);
    const [transferWorker, setTransferWorker] = useState<any | null>(null);
    const [transferDest, setTransferDest] = useState('');
    const [transferSup, setTransferSup] = useState('');
    const [transferMotivo, setTransferMotivo] = useState('');
    const [transferSups, setTransferSups] = useState<Array<{ personaId: string; nombre: string; apellido?: string }>>([]);
    const [transferring, setTransferring] = useState(false);
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
    // Checklist de onboarding DS 44 de una persona (vista de cuadrícula y popover).
    const [onboardingModal, setOnboardingModal] = useState<{ worker: any } | null>(null);
    const [firmaTipo, setFirmaTipo] = useState<string | undefined>(undefined);
    // Firma cruzada de relator (CAPACITACION_SST): el relator firma con su PIN.
    const [relatorSign, setRelatorSign] = useState<{ documentId: string; titulo: string } | null>(null);
    const [relatorPin, setRelatorPin] = useState('');
    const [relatorModalidad, setRelatorModalidad] = useState('');
    const [relatorSaving, setRelatorSaving] = useState(false);
    const [relatorError, setRelatorError] = useState<string | null>(null);

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

    // Obras destino para transferir (todas las del tenant).
    useEffect(() => {
        obrasApi.list().then((res) => {
            if (res.success && res.data) {
                const arr = Array.isArray(res.data) ? res.data : ((res.data as any).obras || []);
                setAllObras(arr);
            }
        }).catch(() => {});
    }, []);

    // Supervisores de la obra destino (para elegir cuadrilla al transferir).
    useEffect(() => {
        if (!transferDest) { setTransferSups([]); return; }
        workersApi.list({ obraId: transferDest }).then((res) => {
            const arr = (res.success && res.data) ? (res.data as any[]) : [];
            setTransferSups(arr.filter((p) => rolTipoDe(p) === 'supervisor').map((p) => ({ personaId: p.personaId, nombre: p.nombre, apellido: p.apellido })));
        }).catch(() => setTransferSups([]));
        setTransferSup('');
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [transferDest]);

    const openTransfer = (w: any) => {
        setTransferWorker(w); setTransferDest(''); setTransferSup(''); setTransferMotivo('');
    };

    const handleTransferir = async () => {
        if (!transferWorker || !obraId || !transferDest) return;
        setTransferring(true);
        try {
            const res = await workersApi.transferir(transferWorker.personaId, {
                obraOrigen: obraId,
                obraDestino: transferDest,
                supervisorPersonaId: transferSup || undefined,
                solicitanteId: user?.personaId || user?.userId,
                motivo: transferMotivo || 'transferencia',
            });
            if (res.success) {
                showToast(`${transferWorker.nombre} transferido`);
                setTransferWorker(null);
                await reloadWorkers();
            } else {
                setError(res.error || 'No se pudo transferir');
            }
        } catch { setError('No se pudo transferir'); }
        finally { setTransferring(false); }
    };

    const assigned = useMemo(
        () => workers.filter((w) => Array.isArray(w.obraIds) && w.obraIds.includes(obraId)),
        [workers, obraId]
    );
    const unassigned = useMemo(
        () => workers.filter((w) => !(Array.isArray(w.obraIds) && w.obraIds.includes(obraId))),
        [workers, obraId]
    );

    // Onboarding DS 44 de quienes están en la obra: el mismo read-model que
    // alimenta el porcentaje del detalle de obra, aquí en forma de checklist.
    const {
        byWorkerId: onboardingPorPersona,
        reload: reloadOnboarding,
        subirDocumento,
        uploadingDoc,
    } = useObraOnboarding(obraId, assigned, obra);

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
    // (La incorporación a la obra se hace vía handleAddToContainer, que asigna
    // directamente al contenedor/cuadrilla de destino.)

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

    // Fija/cambia el prevencionista a cargo de un supervisor en esta obra. Se refleja
    // de inmediato en el scope de las charlas que dicte ese supervisor y su cadena.
    const handlePrevencionistaChange = async (sup: any, prevencionistaId: string) => {
        if (!obraId || prevencionistaId === (prevencionistaDe(sup) || '')) return;
        const prevWorkers = workers;
        const cargos = cargosActuales(sup);

        setWorkers((prev) => prev.map((pw) => {
            if (pw.personaId !== sup.personaId) return pw;
            return {
                ...pw,
                asignaciones: (pw.asignaciones || []).map((a: any) =>
                    a.obraId === obraId ? { ...a, prevencionistaPersonaId: prevencionistaId || null } : a
                ),
            };
        }));

        setUpdating(sup.personaId);
        try {
            // supervisorPersonaId undefined → se conserva (un supervisor no está en
            // cuadrilla); solo se fija el prevencionista.
            await workersApi.setAsignacion(
                sup.personaId, obraId, cargos, user?.personaId || user?.userId, undefined, prevencionistaId || null,
            );
            showToast(prevencionistaId ? 'Prevencionista asignado' : 'Prevencionista quitado');
            reloadWorkers();
        } catch (e: any) {
            setWorkers(prevWorkers);
            setError(e?.message || 'No se pudo actualizar el prevencionista');
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
    const prevencionistas = useMemo(
        () => activeAssigned.filter((w) => rolTipoDe(w) === 'prevencionista'),
        [activeAssigned, roles]
    );
    const supervisorIds = useMemo(() => new Set(supervisores.map((s) => s.personaId)), [supervisores]);

    const cuadrillaDe = (supId: string) => trabajadores.filter((w) => supervisorDe(w) === supId);
    // Quién se está arrastrando: el hueco de inserción lo nombra, para que se
    // lea DÓNDE cae la tarjeta y no solo que algo cae.
    const dragWorker = useMemo(
        () => (dragPersonaId ? workers.find((w) => w.personaId === dragPersonaId) ?? null : null),
        [workers, dragPersonaId]
    );
    const sinCuadrilla = useMemo(
        () => trabajadores.filter((w) => { const s = supervisorDe(w); return !s || !supervisorIds.has(s); }),
        [trabajadores, supervisorIds]
    );

    const supervisorSelectOptions = supervisores.map((s) => ({ value: s.personaId, label: `${s.nombre} ${s.apellido || ''}`.trim() }));
    // Prevencionista a cargo de un supervisor (define el scope de sus charlas).
    const prevencionistaDe = (w: any): string | null => asignacionDe(w)?.prevencionistaPersonaId || null;
    const prevencionistaSelectOptions = prevencionistas.map((p) => ({ value: p.personaId, label: `${p.nombre} ${p.apellido || ''}`.trim() }));

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

    // ── Onboarding DS 44 ──────────────────────────────────────────────────────
    // Atajo: agendar/asignar un ítem precargado para una persona. Fija la obra
    // activa y abre el flujo correspondiente con prefill.
    const agendarItem = (ob: OnboardingWorker, item: OnboardingItem) => {
        setSelectedObraId(obraId);
        if (item.accion === 'ENCUESTA') {
            navigate('/surveys', { state: { prefill: { rut: ob.rut, nombre: ob.nombre, titulo: item.label, kitItemKey: item.key } } });
        } else {
            // "Nueva actividad" vive en su propia página desde el rediseño:
            // se navega directo ahí, no a la lista de Actividades.
            navigate('/activities/nueva', { state: { prefill: { obraId, personaId: ob.workerId, nombre: ob.nombre, subtipo: item.subtipo || 'OTRA', titulo: item.label, kitItemKey: item.key } } });
        }
    };

    const handleFirmaRelator = async () => {
        if (!relatorSign || !user?.personaId) return;
        if (!relatorPin || relatorPin.length < 4) { setRelatorError('Ingresa tu PIN para firmar.'); return; }
        setRelatorSaving(true);
        setRelatorError(null);
        try {
            const res = await documentsApi.sign(relatorSign.documentId, {
                personaId: user.personaId,
                tipoFirma: 'relator',
                pin: relatorPin,
                modalidad: relatorModalidad || undefined,
            });
            if (!res.success) {
                setRelatorError(res.error || 'No se pudo registrar la firma. Verifica tu PIN.');
                return;
            }
            setRelatorSign(null);
            setRelatorPin('');
            showToast('Firma de relator registrada.');
            reloadOnboarding();
        } catch {
            setRelatorError('Error de conexión.');
        } finally {
            setRelatorSaving(false);
        }
    };

    /**
     * Píldora de progreso del onboarding; null para quien no tiene kit (gestión).
     *
     * La barra siempre es del acento y el estado lo dice el recuento: naranjo con
     * punto cuando quedan bloqueantes. Un semáforo de tres colores en cada
     * tarjeta teñía la rejilla completa y competía con el azul de la marca.
     */
    const renderOnboardingBadge = (w: any, variant: 'full' | 'card' | 'row' = 'full') => {
        const ob = onboardingPorPersona.get(w.personaId);
        if (!ob || ob.total === 0) return null;
        const pct = Math.round((ob.completed / ob.total) * 100);
        const bloqueado = !ob.aptoTerreno;
        return (
            <span
                className={`eq-ob-badge${variant === 'row' ? ' eq-ob-badge--row' : ''}`}
                title={`Onboarding DS 44: ${ob.completed} de ${ob.total} ítems`}
            >
                {variant === 'row' && (
                    <span className={`eq-ob-count${bloqueado ? ' eq-ob-count--warn' : ''}`}>
                        {bloqueado && <span className="eq-ob-dot" aria-hidden="true" />}
                        {ob.completed}/{ob.total}
                    </span>
                )}
                <span className="eq-ob-bar"><span className="eq-ob-bar-fill" style={{ width: `${pct}%` }} /></span>
                {variant !== 'row' && (
                    <span className={`eq-ob-count${bloqueado ? ' eq-ob-count--warn' : ''}`}>
                        {bloqueado && <span className="eq-ob-dot" aria-hidden="true" />}
                        {ob.completed}/{ob.total}
                    </span>
                )}
                {variant === 'full' && (ob.aptoTerreno
                    ? <span className="eq-ob-apto"><LuCircleCheck size={11} /> Apto</span>
                    : <span className="eq-ob-bloq"><LuShieldAlert size={11} /> {ob.bloqueantesPendientes} bloq.</span>
                )}
            </span>
        );
    };

    /** Checklist accionable del kit de cargo de una persona en esta obra. */
    const renderOnboardingChecklist = (w: any) => {
        const ob = onboardingPorPersona.get(w.personaId);
        if (!ob) {
            return (
                <div className="eq-ob-empty">
                    Sin kit de onboarding: el rol de gestión y las personas sin cargo en la obra no entran al onboarding de la obra.
                </div>
            );
        }
        return (
            <div className="eq-ob-list">
                {ob.itemDetail.map((item) => {
                    const soloFaltaRelator = item.estado === 'pendiente_firma' && item.firmaRelatorPendiente && item.trabajadorFirmo;
                    const estadoLabel = item.estado === 'completo' ? 'Completo'
                        : soloFaltaRelator ? 'Pendiente firma relator'
                        : item.estado === 'pendiente_firma' ? 'Pendiente de firma'
                        : 'Pendiente de asignar';
                    const estadoColor = item.estado === 'completo' ? '#10b981' : item.estado === 'pendiente_firma' ? '#f59e0b' : 'var(--text-muted)';
                    const uploadId = `eqob-${w.personaId}-${item.key}`;
                    return (
                        <div key={item.key} className="eq-ob-item">
                            <div className="eq-ob-item-main">
                                {item.estado === 'completo'
                                    ? <LuCircleCheck size={14} style={{ color: '#10b981', flexShrink: 0 }} />
                                    : <LuClock size={14} style={{ color: estadoColor, flexShrink: 0 }} />
                                }
                                <div style={{ minWidth: 0 }}>
                                    <div className="eq-ob-item-label" style={{ color: item.estado === 'completo' ? 'var(--text-muted)' : 'var(--text-primary)' }}>
                                        {item.label}
                                    </div>
                                    <div className="eq-ob-item-meta" style={{ color: estadoColor }}>
                                        {item.articulo}{item.articulo ? ' · ' : ''}{estadoLabel}
                                        {item.bloqueante && item.estado !== 'completo' ? ' · bloqueante' : ''}
                                    </div>
                                </div>
                            </div>
                            {item.estado !== 'completo' && (
                                <div className="eq-ob-item-actions">
                                    {item.accion === 'ENCUESTA' && canAsignar && (
                                        <button className="btn btn-primary" style={{ padding: '2px 10px', fontSize: '0.75rem' }} onClick={() => agendarItem(ob, item)}>
                                            Asignar encuesta
                                        </button>
                                    )}
                                    {item.accion === 'CAPACITACION_EVALUACION' && item.estado === 'pendiente_asignar' && canAsignar && (
                                        <button
                                            className="btn btn-secondary" style={{ padding: '2px 10px', fontSize: '0.75rem' }}
                                            onClick={() => agendarItem(ob, item)}
                                            title="Programar la capacitación de este ítem para esta persona"
                                        >
                                            Programar
                                        </button>
                                    )}
                                    {item.accion !== 'ENCUESTA' && item.estado === 'pendiente_asignar' && canSubirDocumentos && (
                                        <>
                                            <input
                                                type="file" id={uploadId} style={{ display: 'none' }}
                                                accept="application/pdf,image/*"
                                                onChange={(e) => {
                                                    const file = e.target.files?.[0];
                                                    if (file) subirDocumento(w.personaId, item.tipo, file);
                                                    e.target.value = '';
                                                }}
                                            />
                                            <button
                                                className="btn btn-secondary" style={{ padding: '2px 10px', fontSize: '0.75rem' }}
                                                disabled={uploadingDoc === `${w.personaId}:${item.tipo}`}
                                                onClick={() => document.getElementById(uploadId)?.click()}
                                            >
                                                {uploadingDoc === `${w.personaId}:${item.tipo}` ? '…' : 'Subir'}
                                            </button>
                                        </>
                                    )}
                                    {item.estado === 'pendiente_firma' && !item.trabajadorFirmo && canFirmaAsistida && (
                                        <button
                                            className="btn btn-primary" style={{ padding: '2px 10px', fontSize: '0.75rem' }}
                                            onClick={() => { setFirmaWorkerId(w.personaId); setFirmaTipo(item.tipo); setFirmaOpen(true); }}
                                        >
                                            Firma asistida
                                        </button>
                                    )}
                                    {item.estado === 'pendiente_firma' && item.firmaRelatorPendiente && item.documentId && user?.permisos?.includes('firmar_relator') && (
                                        <button
                                            className="btn btn-secondary" style={{ padding: '2px 10px', fontSize: '0.75rem' }}
                                            onClick={() => { setRelatorSign({ documentId: item.documentId!, titulo: item.label }); setRelatorPin(''); setRelatorModalidad(''); setRelatorError(null); }}
                                        >
                                            Firmar como relator
                                        </button>
                                    )}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        );
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
                <PersonaAvatar w={w} className="eq2-card-avatar" />
                <span className="eq2-card-body">
                    {isSup && <span className="eq2-sup-badge">{w.rolNombre || 'Supervisor'}</span>}
                    <span className="eq2-card-name">{w.nombre} {w.apellido || ''}</span>
                    <span className="eq2-card-rut">{w.rut}</span>
                    {/* El supervisor se identifica por su distintivo, no por el
                        cargo: es quien manda en la cuadrilla, no un oficio más. */}
                    {!isSup && (
                        <span className="eq2-card-cargo">
                            {cargoLabels.length > 0 ? cargoLabels.join(' · ') : (w.rolNombre || w.rol || '—')}
                        </span>
                    )}
                </span>
                {!isSup && renderOnboardingBadge(w, 'card')}
            </div>
        );
    };

    // ── Pool card (unassigned worker, grid mode) ──────────────────────────────
    const renderPoolCard = (w: any) => {
        const isDragging = dragPersonaId === w.personaId;
        const isOpen = poolCardAction?.worker.personaId === w.personaId;
        // El menú se ancla a la tarjeta, se abra desde ella o desde «Agregar».
        const handleClick = (e: React.MouseEvent<HTMLElement>) => {
            e.stopPropagation();
            if (isOpen) { setPoolCardAction(null); return; }
            const card = (e.currentTarget as HTMLElement).closest('.eq2-card') ?? e.currentTarget;
            setPoolCardAction({ worker: w, rect: card.getBoundingClientRect() });
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
                <PersonaAvatar w={w} className="eq2-card-avatar" />
                <span className="eq2-card-body">
                    <span className="eq2-card-name">{w.nombre} {w.apellido || ''}</span>
                    <span className="eq2-card-rut">{w.rut}</span>
                    <span className="eq2-card-cargo">{w.rolNombre || w.rol || '—'}</span>
                </span>
                <button
                    type="button"
                    className="eq2-pool-add"
                    disabled={updating === w.personaId}
                    onClick={handleClick}
                >
                    Agregar
                </button>
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
                <PersonaAvatar w={w} className="eq2-row-avatar" />
                <div className="eq2-row-info">
                    <span className="eq2-row-name">{w.nombre} {w.apellido || ''}</span>
                    <span className="eq2-row-rut">{w.rut} · {w.rolNombre || w.rol}</span>
                </div>
                <button
                    type="button"
                    className="eq2-pool-add"
                    disabled={updating === w.personaId}
                    onClick={(e) => { e.stopPropagation(); handleClick(e); }}
                >
                    Agregar
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
                className={`eq2-row${isSup ? ' eq2-row--sup' : ''}${isExpanded ? ' eq2-row--expanded' : ''}${isDragging ? ' eq2-row--dragging' : ''}${isDraggable ? ' eq2-row--draggable' : ''}`}
            >
                <div
                    className="eq2-row-bar"
                    draggable={isDraggable}
                    onDragStart={isDraggable ? (e) => handleDragStart(e, w) : undefined}
                    onDragEnd={isDraggable ? handleDragEnd : undefined}
                    title={isDraggable ? 'Arrastra la fila para cambiarla de cuadrilla' : undefined}
                >
                    <PersonaAvatar
                        w={w}
                        className={`eq2-row-avatar${isSup ? ' eq2-row-avatar--sup' : ''}`}
                        onClick={() => navigate(`/personas/${encodeURIComponent(w.rut)}`)}
                    />

                    <div className="eq2-row-info" onClick={() => navigate(`/personas/${encodeURIComponent(w.rut)}`)}>
                        <span className="eq2-row-name">{w.nombre} {w.apellido || ''}</span>
                        <span className="eq2-row-rut">{w.rut}</span>
                    </div>

                    {/* El supervisor lleva su rol donde los demás llevan el cargo:
                        misma columna, misma lectura. */}
                    {isSup ? (
                        <span className="eq2-row-role">{w.rolNombre || 'Supervisor'}</span>
                    ) : (
                        <div className="eq2-row-chips">
                            {cargoLabels.length > 0
                                ? cargoLabels.map((l, i) => <span key={i} className="eq2-chip">{l}</span>)
                                : <span className="eq2-chip eq2-chip--empty">Sin cargo</span>
                            }
                        </div>
                    )}

                    <div className="eq2-row-ob">{isSup ? <span className="eq2-row-rut">—</span> : renderOnboardingBadge(w, 'row')}</div>

                    <button
                        type="button"
                        className="eq2-row-menu"
                        onClick={(e) => { e.stopPropagation(); toggleExpand(w.personaId); }}
                        aria-expanded={isExpanded}
                        aria-label={isExpanded ? 'Cerrar edición' : 'Opciones'}
                        title={isExpanded ? 'Cerrar edición' : 'Opciones'}
                    >
                        {isExpanded ? <FiChevronUp size={16} /> : <FiMoreHorizontal size={16} />}
                    </button>
                </div>

                {isExpanded && (
                    <div className="eq2-row-panel" onClick={(e) => e.stopPropagation()}>
                        <label className="eq-ctrl">
                            <span className="eq-ctrl-label">Cargos</span>
                            <CargoDropdown
                                options={cargoOptions}
                                selected={currCargos}
                                onToggle={(code) => toggleCargo(w.personaId, code, cargosActuales(w))}
                            />
                        </label>

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
                            <button
                                className="btn btn-secondary btn-sm"
                                onClick={() => navigate(`/personas/${encodeURIComponent(w.rut)}`)}
                            >
                                <FiUser size={13} /> Ver ficha
                            </button>
                            {canFirmaAsistida && (
                                <button
                                    className="btn btn-secondary btn-sm"
                                    onClick={() => { setFirmaWorkerId(w.personaId); setFirmaOpen(true); }}
                                >
                                    <FiPenTool size={13} /> Firma asistida
                                </button>
                            )}
                            <button
                                className="btn btn-ghost btn-sm"
                                style={{ color: '#006edc' }}
                                disabled={updating === w.personaId || w.rol === 'admin'}
                                onClick={() => openTransfer(w)}
                                title="Mover a otra obra (conserva historial y currículum)"
                            >
                                <FiArrowRight size={13} /> Transferir
                            </button>
                            <button
                                className="btn btn-ghost btn-sm eq2-baja-btn"
                                disabled={updating === w.personaId || w.rol === 'admin'}
                                onClick={() => handleBaja(w)}
                            >
                                <FiX size={13} /> Dar de baja
                            </button>
                            {isDirty && (
                                <button
                                    className="btn btn-primary btn-sm"
                                    disabled={updating === w.personaId}
                                    onClick={() => handleUpdateCargos(w)}
                                >
                                    <FiCheck size={13} /> Guardar
                                </button>
                            )}
                        </div>

                        <div className="eq-ob-block">
                            <div className="eq-ob-block-title">
                                <FiClipboard size={13} /> Onboarding DS 44
                            </div>
                            {renderOnboardingChecklist(w)}
                        </div>
                    </div>
                )}
            </div>
        );
    };

    /**
     * Una cuadrilla: rótulo con regla y, debajo, las tarjetas.
     *
     * En cuadrícula la cuadrilla NO es una caja (la única caja es la tarjeta de
     * la persona); en lista sí lo es, porque las filas necesitan un marco que
     * las agrupe o el corte entre cuadrillas no se lee.
     */
    const renderContainer = (opts: {
        id: string;
        title: string;
        count: number;
        supervisor?: any;
        workers: any[];
        isSinCuadrilla?: boolean;
    }) => {
        const { id, title, count, supervisor, workers: crewWorkers, isSinCuadrilla = false } = opts;
        const isDragOver = dragOverContainerId === id;
        // Durante el arrastre hay UN destino: los demás se atenúan en vez de
        // ofrecerse todos como candidatos.
        const isDimmed = !!dragPersonaId && !isDragOver;
        const dropProps = makeContainerDropProps(id);
        const visibles = crewWorkers.filter(matchesSearch);
        // La persona arrastrada solo «entra» si viene de otra cuadrilla o del pool.
        const entra = isDragOver && !!dragWorker && !crewWorkers.some((w) => w.personaId === dragPersonaId);

        if (count === 0 && !supervisor && !isSinCuadrilla) return null;
        if (isSinCuadrilla && visibles.length === 0) return null;

        return (
            <section
                key={id}
                aria-label={isSinCuadrilla ? 'Sin cuadrilla' : `Cuadrilla de ${title}`}
                className={`eq2-crew${mode === 'list' ? ' eq2-crew--boxed' : ''}${isDragOver ? ' eq2-crew--dragover' : ''}${isDimmed ? ' eq2-crew--dim' : ''}`}
                {...dropProps}
            >
                <div className="eq2-crew-head">
                    <span className="eq2-crew-title">{title}</span>
                    <span className="eq2-crew-count">{entra ? `${count} → ${count + 1}` : count}</span>
                    {isDragOver ? (
                        <span className="eq2-crew-hint eq2-crew-hint--drop">
                            {isSinCuadrilla ? 'Soltar para dejarlo sin supervisor' : 'Soltar para sumar a esta cuadrilla'}
                        </span>
                    ) : isSinCuadrilla ? (
                        <span className="eq2-crew-hint">
                            {mode === 'grid'
                                ? 'Arrástralos a una cuadrilla para asignarles supervisor.'
                                : 'Asígnales supervisor desde el menú de cada fila.'}
                        </span>
                    ) : null}
                    <span className="eq2-crew-spacer" />
                    {/* Prevencionista a cargo de esta cuadrilla: define el scope de las
                        charlas del supervisor. Solo se ofrece si la obra tiene alguno. */}
                    {supervisor && prevencionistaSelectOptions.length > 0 && (
                        <div className="eq2-crew-prev">
                            <span className="eq2-crew-hint" style={{ flexShrink: 0 }}>Prevencionista:</span>
                            <SupervisorAutocomplete
                                options={prevencionistaSelectOptions}
                                value={prevencionistaDe(supervisor) || ''}
                                onChange={(pid) => handlePrevencionistaChange(supervisor, pid)}
                                placeholder="Sin asignar…"
                            />
                        </div>
                    )}
                </div>

                {mode === 'grid' ? (
                    <div className="eq2-crew-grid">
                        {supervisor && renderCard(supervisor, { isSup: true })}
                        {visibles.map((w) =>
                            renderCard(w, { isDraggable: rolTipoDe(w) === 'trabajador' })
                        )}
                        {/* Hueco de inserción: dice DÓNDE cae, con la forma de la tarjeta. */}
                        {entra && dragWorker && (
                            <div className="eq2-slot" aria-hidden="true">
                                <FiPlus size={22} />
                                <span className="eq2-slot-name">{dragWorker.nombre} {dragWorker.apellido || ''}</span>
                                <span className="eq2-slot-sub">
                                    {isSinCuadrilla ? 'queda sin cuadrilla' : 'entra a esta cuadrilla'}
                                </span>
                            </div>
                        )}
                        {!supervisor && visibles.length === 0 && !entra && (
                            <div className="eq2-crew-empty-grid">Sin personas en este equipo.</div>
                        )}
                    </div>
                ) : (
                    <div className="eq2-crew-list">
                        {supervisor && renderRow(supervisor, { isSup: true })}
                        {visibles.map((w) =>
                            renderRow(w, {
                                isDraggable: rolTipoDe(w) === 'trabajador',
                                showSupervisor: true,
                            })
                        )}
                        {!supervisor && visibles.length === 0 && (
                            <div className="eq2-crew-empty-list">Sin personas en este equipo.</div>
                        )}
                    </div>
                )}
            </section>
        );
    };

    /**
     * Equipo de gestión: una fila de píldoras, no una rejilla de tarjetas.
     *
     * Son tres o cuatro personas, no se arrastran y no tienen kit DS 44 que
     * mostrar: la rejilla les daba el mismo peso visual que a una cuadrilla de
     * quince. Sigue siendo zona de soltar, pero solo para explicar que no
     * acepta trabajadores de cuadrilla.
     */
    const renderGestion = () => {
        const visibles = gestion.filter(matchesSearch);
        if (visibles.length === 0) return null;
        const isDragWarn = dragOverContainerId === GESTION_CONTAINER && !!dragPersonaId;
        return (
            <section
                aria-label="Equipo de gestión"
                className={`eq2-mgmt${isDragWarn ? ' eq2-mgmt--warn' : ''}`}
                {...makeContainerDropProps(GESTION_CONTAINER)}
            >
                <span className="eq2-mgmt-label">Gestión</span>
                {visibles.map((w) => (
                    <button
                        type="button"
                        key={w.personaId}
                        className="eq2-mgmt-chip"
                        onClick={(e) => {
                            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                            setCardAction(cardAction?.worker.personaId === w.personaId ? null : { worker: w, rect });
                        }}
                    >
                        <PersonaAvatar w={w} className="eq2-mgmt-chip-avatar" />
                        <span className="eq2-mgmt-chip-name">{w.nombre} {w.apellido || ''}</span>
                        <span className="eq2-mgmt-chip-role">{w.rolNombre || w.rol}</span>
                    </button>
                ))}
                {isDragWarn && (
                    <span className="eq2-mgmt-hint">Este equipo no acepta trabajadores de cuadrilla.</span>
                )}
            </section>
        );
    };

    // ── Carga ─────────────────────────────────────────────────────────────────
    // El esqueleto dibuja la vista elegida: prometer una cuadrícula y entregar
    // una lista devuelve el salto que el esqueleto viene a evitar.
    if (loading) return <EquipoObraSkeleton vista={mode === 'list' ? 'list' : 'grid'} />;

    return (
        <>
            {error && <AlertBanner variant="error" message={error} onDismiss={() => setError('')} />}

            {/* La página es UNA columna de secciones separadas por reglas: sin
                tarjetas contenedoras, la jerarquía la marcan los rótulos. */}
            <div className="eq2-page">
                <div className="eq2-toolbar">
                    <div className="eq2-toolbar-left">
                        <label className="eq-search-wrap">
                            <FiSearch size={15} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                            <input
                                className="form-input"
                                style={{ flex: 1, fontSize: '13.5px', minWidth: 120 }}
                                placeholder="Buscar en el equipo…"
                                value={searchAssigned}
                                onChange={(e) => setSearchAssigned(e.target.value)}
                            />
                        </label>
                        <span className="eq2-count-text">
                            {activeAssigned.length} persona{activeAssigned.length !== 1 ? 's' : ''}
                            {' · '}
                            {supervisores.length} cuadrilla{supervisores.length !== 1 ? 's' : ''}
                            {sinCuadrilla.length > 0 && (
                                <> {'· '}<strong>{sinCuadrilla.length} sin asignar</strong></>
                            )}
                        </span>
                    </div>
                    <div className="eq2-toolbar-right">
                        <div className="eq2-mode-toggle" role="group" aria-label="Vista">
                            <button
                                className={`eq2-mode-btn${mode === 'grid' ? ' eq2-mode-btn--active' : ''}`}
                                onClick={() => setMode('grid')} title="Cuadrícula"
                                aria-label="Cuadrícula"
                                aria-pressed={mode === 'grid'}
                            >
                                <FiGrid size={15} />
                            </button>
                            <button
                                className={`eq2-mode-btn${mode === 'list' ? ' eq2-mode-btn--active' : ''}`}
                                onClick={() => setMode('list')} title="Lista"
                                aria-label="Lista"
                                aria-pressed={mode === 'list'}
                            >
                                <FiList size={15} />
                            </button>
                        </div>
                    </div>
                </div>

                {assigned.length === 0 ? (
                    <div className="eq-empty-state">
                        <FiUsers size={28} style={{ opacity: 0.25, marginBottom: 8 }} />
                        <span>No hay personas en esta obra. Agrégalas desde la sección de abajo.</span>
                    </div>
                ) : (
                    <div className="eq2-groups">
                        {renderGestion()}

                        {/* Sin cuadrilla va primero: es lo que hay que resolver. */}
                        {renderContainer({
                            id: SIN_CUADRILLA_CONTAINER,
                            title: 'Sin cuadrilla',
                            count: sinCuadrilla.filter(matchesSearch).length,
                            workers: sinCuadrilla,
                            isSinCuadrilla: true,
                        })}

                        {/* Una cuadrilla se nombra por su supervisor, sin el rodeo
                            de «Equipo de»: el rótulo ya está en contexto. */}
                        {supervisores.map((sup) => {
                            const crew = cuadrillaDe(sup.personaId);
                            const visibleCrew = crew.filter(matchesSearch);
                            const supVisible = matchesSearch(sup);
                            if (!supVisible && visibleCrew.length === 0) return null;
                            const total = crew.length + 1; // +1 por el supervisor
                            return renderContainer({
                                id: sup.personaId,
                                title: `${sup.nombre} ${sup.apellido || ''}`.trim(),
                                count: total,
                                supervisor: supVisible ? sup : undefined,
                                workers: crew,
                            });
                        })}

                        {/* Dados de baja: un enlace al pie, no una sección más. */}
                        {inactiveAssigned.length > 0 && (
                            <details>
                                <summary className="eq-baja-summary">
                                    <FiChevronRight size={14} className="eq-baja-chevron" />
                                    Dados de baja · {inactiveAssigned.length}
                                </summary>
                                <div className="eq-baja-list">
                                    {inactiveAssigned.map((w) => (
                                        <div key={w.personaId} className="eq2-row eq2-row--inactive">
                                            <div className="eq2-row-bar">
                                                <PersonaAvatar w={w} className="eq2-row-avatar eq2-row-avatar--inactive" />
                                                <div className="eq2-row-info">
                                                    <span className="eq2-row-name">{w.nombre} {w.apellido || ''}</span>
                                                    <span className="eq2-row-rut">{w.rut}</span>
                                                </div>
                                                <span />
                                                <span />
                                                <button
                                                    className="btn btn-secondary btn-sm"
                                                    style={{ justifySelf: 'end', whiteSpace: 'nowrap' }}
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

                {/* Personas de la empresa que no están en esta obra: el origen del
                    arrastre. Va en la misma columna, con regla punteada, porque no
                    es el equipo todavía. */}
                {canAsignar && (
                    <section aria-label="Personas de la empresa">
                        <div className="eq-section-head">
                            <span className="eq-section-title">Personas de la empresa</span>
                            <span className="eq-section-sub">
                                {mode === 'grid'
                                    ? 'No están en esta obra. Arrástralas a una cuadrilla o usa Agregar.'
                                    : 'No están en esta obra. Usa Agregar para sumarlas.'}
                            </span>
                            <span className="eq2-crew-spacer" />
                            <label className="eq-search-wrap" style={{ maxWidth: 240, flex: '0 0 auto' }}>
                                <FiSearch size={15} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                                <input
                                    className="form-input"
                                    style={{ flex: 1, fontSize: '13.5px', minWidth: 100 }}
                                    placeholder="Buscar persona…"
                                    value={search}
                                    onChange={(e) => setSearch(e.target.value)}
                                />
                            </label>
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
                            <div className="eq2-crew--boxed">
                                {filteredUnassigned.map(renderPoolRow)}
                            </div>
                        )}

                        {supervisorSelectOptions.length === 0 && unassigned.some((w) => rolTipoDe(w) === 'trabajador') && (
                            <div className="eq-add-note">
                                <FiAlertTriangle size={13} style={{ color: 'var(--danger-alerta)' }} />
                                Agrega primero un Supervisor a la obra para poder armar cuadrillas.
                            </div>
                        )}
                    </section>
                )}
            </div>

            {/* Firma asistida */}
            <FirmaAsistidaModal
                isOpen={firmaOpen}
                onClose={() => { setFirmaOpen(false); setFirmaWorkerId(undefined); setFirmaTipo(undefined); }}
                obraId={obraId}
                workers={assigned}
                asistidoPor={user?.personaId || user?.userId || ''}
                initialWorkerId={firmaWorkerId}
                initialTipo={firmaTipo}
                onSigned={reloadOnboarding}
            />

            {/* Modal: transferir a otra obra */}
            <Modal
                isOpen={!!transferWorker}
                onClose={() => setTransferWorker(null)}
                title="Transferir a otra obra"
                subtitle={transferWorker ? `${transferWorker.nombre} ${transferWorker.apellido || ''}`.trim() : ''}
                size="md"
                footer={
                    <>
                        <button className="btn btn-secondary" onClick={() => setTransferWorker(null)} disabled={transferring}>Cancelar</button>
                        <button
                            className="btn btn-primary"
                            onClick={handleTransferir}
                            disabled={transferring || !transferDest || (transferWorker && rolTipoDe(transferWorker) === 'trabajador' && transferSups.length > 0 && !transferSup)}
                        >
                            {transferring ? 'Transfiriendo…' : 'Transferir'}
                        </button>
                    </>
                }
            >
                {transferWorker && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
                        <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', background: 'var(--surface-elevated)', padding: 'var(--space-3) var(--space-4)', borderRadius: 'var(--radius-md)', lineHeight: 1.5 }}>
                            Se archiva el onboarding de la obra actual (queda para auditoría) y se genera el de la obra destino. El currículum (cursos, evidencias, capacitaciones) se conserva.
                        </div>
                        <label className="eq-ctrl eq-ctrl--wide">
                            <span className="eq-ctrl-label">Obra destino *</span>
                            <select className="eq-select" value={transferDest} onChange={(e) => setTransferDest(e.target.value)}>
                                <option value="">Selecciona una obra…</option>
                                {allObras
                                    .filter((o) => o.obraId !== obraId && !(transferWorker.obraIds || []).includes(o.obraId))
                                    .map((o) => <option key={o.obraId} value={o.obraId}>{o.nombre}{o.codigo ? ` (${o.codigo})` : ''}</option>)}
                            </select>
                        </label>
                        {transferDest && rolTipoDe(transferWorker) === 'trabajador' && (
                            transferSups.length > 0 ? (
                                <label className="eq-ctrl eq-ctrl--wide">
                                    <span className="eq-ctrl-label">Cuadrilla (supervisor) *</span>
                                    <select className="eq-select" value={transferSup} onChange={(e) => setTransferSup(e.target.value)}>
                                        <option value="">Selecciona supervisor…</option>
                                        {transferSups.map((s) => <option key={s.personaId} value={s.personaId}>{s.nombre} {s.apellido || ''}</option>)}
                                    </select>
                                </label>
                            ) : (
                                <div className="eq-sup-warn">
                                    <FiAlertTriangle size={14} style={{ flexShrink: 0 }} />
                                    <span>La obra destino aún no tiene supervisores; quedará sin cuadrilla y se le asigna después.</span>
                                </div>
                            )
                        )}
                        <label className="eq-ctrl eq-ctrl--wide">
                            <span className="eq-ctrl-label">Motivo (opcional)</span>
                            <input className="eq-select" value={transferMotivo} onChange={(e) => setTransferMotivo(e.target.value)} placeholder="Ej. refuerzo de cuadrilla" />
                        </label>
                    </div>
                )}
            </Modal>

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
                        <button
                            className="eq2-card-popover-btn"
                            onClick={() => {
                                const w = cardAction.worker;
                                setCardAction(null);
                                setOnboardingModal({ worker: w });
                            }}
                        >
                            <FiClipboard size={13} /> Onboarding
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
                size="md"
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
                                <PersonaAvatar w={sup} className="eq-team-icon eq-team-icon--avatar" />
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
                        size="md"
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
                                <button
                                    className="btn btn-ghost btn-sm"
                                    style={{ color: '#006edc' }}
                                    disabled={updating === w.personaId || w.rol === 'admin'}
                                    onClick={() => { setEditModal(null); openTransfer(w); }}
                                    title="Mover a otra obra (conserva historial y currículum)"
                                >
                                    <FiArrowRight size={13} /> Transferir
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

            {/* Checklist de onboarding (atajo desde la vista de cuadrícula) */}
            <Modal
                isOpen={!!onboardingModal}
                onClose={() => setOnboardingModal(null)}
                title="Onboarding DS 44"
                subtitle={onboardingModal ? `${onboardingModal.worker.nombre} ${onboardingModal.worker.apellido || ''}`.trim() : ''}
                size="md"
            >
                {onboardingModal && renderOnboardingChecklist(onboardingModal.worker)}
            </Modal>

            {/* Firma de relator (firma cruzada CAPACITACION_SST) */}
            <Modal
                isOpen={!!relatorSign}
                onClose={() => { setRelatorSign(null); setRelatorPin(''); setRelatorError(null); }}
                title="Firma de relator"
                subtitle={relatorSign ? `${relatorSign.titulo} — Art. 16 DS44, firma cruzada` : ''}
                size="sm"
                footer={
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-2)', width: '100%' }}>
                        <button className="btn btn-secondary" onClick={() => { setRelatorSign(null); setRelatorPin(''); setRelatorError(null); }}>Cancelar</button>
                        <button className="btn btn-primary" onClick={handleFirmaRelator} disabled={relatorSaving}>
                            {relatorSaving ? 'Firmando…' : 'Firmar como relator'}
                        </button>
                    </div>
                }
            >
                <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                    <p style={{ fontSize: '0.87rem', color: 'var(--text-muted)', lineHeight: 1.6 }}>
                        Firmas como relator de la capacitación. El documento queda completo
                        cuando existen ambas firmas: la tuya y la del trabajador.
                    </p>
                    <div className="form-group">
                        <label className="form-label">Modalidad (informativo)</label>
                        <select className="form-input form-select" value={relatorModalidad} onChange={(e) => setRelatorModalidad(e.target.value)}>
                            <option value="">Sin especificar</option>
                            <option value="presencial">Presencial</option>
                            <option value="e-learning">E-learning</option>
                            <option value="mutualidad">Mutualidad</option>
                            <option value="streaming">Streaming</option>
                        </select>
                    </div>
                    <div className="form-group">
                        <label className="form-label">Tu PIN de firma</label>
                        <input
                            type="password"
                            inputMode="numeric"
                            className="form-input"
                            value={relatorPin}
                            onChange={(e) => { setRelatorPin(e.target.value.replace(/\D/g, '')); setRelatorError(null); }}
                            placeholder="••••"
                            maxLength={8}
                            autoComplete="off"
                        />
                    </div>
                    {relatorError && (
                        <div style={{ padding: '8px 12px', borderRadius: '8px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', fontSize: '0.82rem', color: '#b91c1c' }}>
                            {relatorError}
                        </div>
                    )}
                </div>
            </Modal>

            <style>{`
                /* ── Lienzo ─────────────────────────────────────
                   La cuadrilla ya NO es una caja: es un rótulo con una regla
                   debajo. La única caja es la tarjeta de la persona, que es la
                   unidad que se arrastra y se lee; así no hay recuadro dentro
                   de recuadro. --eq-rule es la regla interna, más tenue que el
                   borde, para separar filas sin dibujar otra caja. */
                .eq2-page {
                    display: flex; flex-direction: column; gap: var(--space-6);
                    --eq-rule: color-mix(in srgb, var(--surface-border) 70%, transparent);
                    --eq-dash: color-mix(in srgb, var(--surface-border) 55%, var(--text-muted));
                }
                .eq-section-head {
                    display: flex; align-items: center; gap: var(--space-3);
                    flex-wrap: wrap; padding-bottom: 9px;
                    border-bottom: 1px dashed var(--eq-dash, var(--surface-border));
                    margin-bottom: var(--space-4);
                }
                .eq-section-title { font-weight: 600; font-size: var(--text-sm); color: var(--text-primary); }
                .eq-section-sub { font-size: 11.5px; color: var(--text-secondary); }

                /* ── Toolbar ────────────────────────────────── */
                .eq2-toolbar {
                    display: flex; align-items: center; justify-content: space-between;
                    gap: var(--space-3); flex-wrap: wrap;
                }
                .eq2-toolbar-left {
                    display: flex; align-items: center; gap: var(--space-3); flex-wrap: wrap; flex: 1; min-width: 0;
                }
                .eq2-toolbar-right { display: flex; align-items: center; gap: var(--space-2); flex-shrink: 0; }
                .eq2-count-text { font-size: 13px; color: var(--text-secondary); }
                .eq2-count-text strong { font-weight: 600; color: var(--text-primary); }

                /* ── Cuadrícula / lista ────────────────────────── */
                .eq2-mode-toggle {
                    display: flex; gap: 3px; padding: 3px;
                    border: 1px solid var(--surface-border); border-radius: 9px;
                }
                .eq2-mode-btn {
                    display: flex; align-items: center; justify-content: center;
                    width: 32px; height: 28px; border: none; border-radius: 6px; background: none;
                    color: var(--text-secondary); cursor: pointer;
                    transition: background 0.12s, color 0.12s;
                }
                .eq2-mode-btn:hover { color: var(--text-primary); }
                .eq2-mode-btn--active { background: var(--surface-hover); color: var(--text-primary); }

                /* ── Gestión ──────────────────────────────────
                   Son tres o cuatro personas y no se arrastran: una fila de
                   píldoras dice quiénes son sin gastar una rejilla entera. */
                .eq2-mgmt { display: flex; align-items: center; gap: var(--space-3); flex-wrap: wrap; }
                .eq2-mgmt-label {
                    font-size: 11px; font-weight: 700; text-transform: uppercase;
                    letter-spacing: 0.08em; color: var(--text-secondary); flex-shrink: 0;
                }
                .eq2-mgmt-chip {
                    display: inline-flex; align-items: center; gap: var(--space-2);
                    padding: 4px 12px 4px 4px; background: none;
                    border: 1px solid var(--surface-border); border-radius: 999px;
                    color: inherit; font-family: inherit; cursor: pointer;
                    transition: border-color 0.12s, background 0.12s;
                }
                .eq2-mgmt-chip:hover { border-color: var(--accent); background: var(--accent-tint); }
                .eq2-mgmt-chip-avatar {
                    width: 24px; height: 24px; border-radius: 50%; flex-shrink: 0; overflow: hidden;
                    display: flex; align-items: center; justify-content: center;
                    font-size: 10px; font-weight: 700; text-transform: uppercase;
                    background: var(--accent-tint); color: var(--accent-text);
                    border: 1.5px solid color-mix(in srgb, var(--accent) 28%, transparent);
                }
                .eq2-mgmt-chip-name { font-size: 12.5px; font-weight: 500; }
                .eq2-mgmt-chip-role { font-size: 11.5px; color: var(--text-secondary); }
                .eq2-mgmt-hint { font-size: 11.5px; font-weight: 500; color: var(--danger-alerta); }
                .eq2-mgmt--warn .eq2-mgmt-chip {
                    border-color: color-mix(in srgb, var(--danger-alerta) 45%, transparent);
                }

                /* ── Cuadrillas ─────────────────────────────── */
                .eq2-groups { display: flex; flex-direction: column; gap: var(--space-6); }
                .eq2-crew { transition: opacity 0.15s, border-color 0.15s; }
                /* Durante el arrastre hay UN destino, no cinco candidatos. */
                .eq2-crew--dim { opacity: 0.45; }
                .eq2-crew-head {
                    display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
                    padding-bottom: 9px; margin-bottom: var(--space-4);
                    border-bottom: 1px solid var(--surface-border);
                }
                .eq2-crew--dragover .eq2-crew-head { border-bottom-color: var(--accent); }
                .eq2-crew-title { font-size: var(--text-sm); font-weight: 600; color: var(--text-primary); }
                .eq2-crew-count {
                    padding: 1px 8px; border: 1px solid var(--surface-border); border-radius: 999px;
                    font-size: 11.5px; font-weight: 600; color: var(--text-primary);
                    font-variant-numeric: tabular-nums; white-space: nowrap;
                }
                .eq2-crew--dragover .eq2-crew-count { border-color: var(--accent); color: var(--accent-text); }
                .eq2-crew-hint { font-size: 11.5px; color: var(--text-secondary); }
                .eq2-crew-hint--drop { color: var(--accent-text); font-weight: 500; }
                .eq2-crew-spacer { flex: 1; min-width: 0; }
                .eq2-crew-prev { display: flex; align-items: center; gap: var(--space-2); min-width: 220px; }
                .eq2-crew-empty-grid, .eq2-crew-empty-list {
                    font-size: var(--text-xs); color: var(--text-muted); font-style: italic;
                }
                .eq2-crew-empty-list { padding: var(--space-3) var(--space-4); }

                /* En lista la cuadrilla SÍ es una caja: las filas necesitan un
                   marco que las agrupe, o el corte entre cuadrillas no se lee. */
                .eq2-crew--boxed {
                    border: 1px solid var(--surface-border); border-radius: 12px; overflow: hidden;
                }
                .eq2-crew--boxed .eq2-crew-head {
                    padding: 11px var(--space-4); margin-bottom: 0;
                }
                .eq2-crew--boxed.eq2-crew--dragover { border-color: var(--accent); }

                /* ── Rejilla ────────────────────────────────── */
                .eq2-crew-grid {
                    display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px;
                }
                @media (max-width: 900px) {
                    .eq2-crew-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
                }
                @media (max-width: 580px) {
                    .eq2-crew-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
                }

                /* ── Tarjeta de persona ───────────────────────── */
                .eq2-card {
                    position: relative;
                    display: flex; flex-direction: column; align-items: center; text-align: center; gap: 9px;
                    padding: 20px 14px 14px;
                    border: 1px solid var(--surface-border); border-radius: 12px;
                    background: none; cursor: pointer; user-select: none;
                    transition: transform 0.18s ease, border-color 0.18s, background 0.18s, opacity 0.15s;
                    animation: eq2cardIn 0.25s ease both;
                }
                @keyframes eq2cardIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
                .eq2-card:hover { transform: translateY(-2px); border-color: var(--accent); }
                .eq2-card--draggable { cursor: grab; }
                .eq2-card--draggable:active { cursor: grabbing; }
                /* El hueco que dejó la tarjeta levantada queda a la vista. */
                .eq2-card--dragging { opacity: 0.5; transform: none; }
                .eq2-card--open { border-color: var(--accent); background: var(--accent-tint); }
                .eq2-card--sup { border-color: color-mix(in srgb, var(--accent) 35%, transparent); }

                .eq2-card-avatar {
                    width: 52px; height: 52px; border-radius: 50%; flex-shrink: 0; overflow: hidden;
                    display: flex; align-items: center; justify-content: center;
                    font-weight: 700; font-size: 18px; text-transform: uppercase;
                    background: color-mix(in srgb, var(--accent) 10%, transparent);
                    border: 1.5px solid var(--surface-border);
                    color: var(--text-secondary);
                }
                .eq2-card--sup .eq2-card-avatar {
                    background: var(--accent-tint);
                    border-color: color-mix(in srgb, var(--accent) 30%, transparent);
                    color: var(--accent-text);
                }
                /* La foto cubre el círculo; el borde del avatar la enmarca. */
                .eq-avatar-img { width: 100%; height: 100%; object-fit: cover; display: block; }

                .eq2-card-body { display: flex; flex-direction: column; align-items: center; gap: 3px; width: 100%; }
                .eq2-sup-badge {
                    padding: 2px 8px; border-radius: 999px;
                    background: color-mix(in srgb, var(--accent) 18%, transparent);
                    color: var(--accent-text);
                    font-size: 9.5px; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase;
                }
                .eq2-card-name {
                    font-size: 13.5px; font-weight: 600; color: var(--text-primary);
                    max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
                }
                .eq2-card-rut {
                    font-family: var(--font-mono, monospace); font-size: 11px; color: var(--text-muted);
                }
                .eq2-card-cargo {
                    font-size: 11.5px; color: var(--text-secondary);
                    max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
                }

                /* Hueco de inserción: dice DÓNDE cae, con la forma de la tarjeta. */
                .eq2-slot {
                    display: flex; flex-direction: column; align-items: center; justify-content: center;
                    gap: 8px; padding: 20px 14px 14px; text-align: center;
                    border: 1.5px dashed var(--accent); border-radius: 12px; color: var(--accent-text);
                }
                .eq2-slot-name { font-size: 12.5px; font-weight: 600; }
                .eq2-slot-sub { font-size: 11px; color: var(--text-secondary); }

                /* ── Fila de lista ───────────────────────────── */
                .eq2-crew-list { display: flex; flex-direction: column; }
                .eq2-row { border-top: 1px solid var(--eq-rule, var(--surface-border)); }
                .eq2-row:first-child { border-top: none; }
                .eq2-row--dragging { opacity: 0.5; }
                .eq2-row--inactive .eq2-row-bar { opacity: 0.55; }
                .eq2-row-bar {
                    display: grid; grid-template-columns: 34px minmax(0, 1fr) 180px 120px 32px;
                    align-items: center; gap: 14px; padding: 10px var(--space-4);
                    transition: background 0.12s;
                }
                .eq2-row-bar:hover { background: var(--surface-hover); }
                .eq2-row--draggable .eq2-row-bar { cursor: grab; }
                /* Fila abierta: se edita EN la fila, marcada por el acento a la izquierda. */
                .eq2-row--expanded { border-left: 2px solid var(--accent); }
                .eq2-row--expanded .eq2-row-bar { padding-left: calc(var(--space-4) - 2px); }

                .eq2-row-avatar {
                    width: 32px; height: 32px; border-radius: 50%; flex-shrink: 0; overflow: hidden;
                    display: flex; align-items: center; justify-content: center;
                    font-weight: 700; font-size: 11.5px; text-transform: uppercase;
                    background: var(--surface-hover); color: var(--text-secondary);
                    border: none; cursor: pointer;
                }
                .eq2-row-avatar--sup { background: var(--accent-tint); color: var(--accent-text); }
                .eq2-row-avatar--inactive { background: var(--surface-hover); color: var(--text-muted); }

                .eq2-row-info { display: flex; flex-direction: column; gap: 2px; min-width: 0; cursor: pointer; }
                .eq2-row-name {
                    font-size: 13.5px; font-weight: 600; color: var(--text-primary);
                    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
                }
                .eq2-row-rut {
                    font-size: 11px; color: var(--text-secondary); font-family: var(--font-mono, monospace);
                }
                .eq2-row-role { font-size: 12px; color: var(--accent-text); }
                .eq2-row-chips { display: flex; gap: 5px; flex-wrap: wrap; min-width: 0; }
                .eq2-chip {
                    padding: 2px 8px; border: 1px solid var(--surface-border); border-radius: 999px;
                    font-size: 11px; color: var(--text-primary); white-space: nowrap;
                }
                .eq2-chip--empty { color: var(--text-muted); font-style: italic; }
                .eq2-row-ob { min-width: 0; }
                .eq2-row-menu {
                    display: flex; align-items: center; justify-content: center; justify-self: end;
                    width: 28px; height: 28px; padding: 0; background: none; border: none;
                    border-radius: var(--radius-sm); color: var(--text-muted); cursor: pointer;
                    transition: background 0.12s, color 0.12s;
                }
                .eq2-row-menu:hover { background: var(--surface-hover); color: var(--text-primary); }
                .eq2-row--expanded .eq2-row-menu { color: var(--accent-text); }
                @media (max-width: 760px) {
                    .eq2-row-bar { grid-template-columns: 34px minmax(0, 1fr) 32px; row-gap: 8px; }
                    .eq2-row-chips, .eq2-row-ob { grid-column: 2 / 3; }
                }

                /* Los campos cuelgan de la fila, sangrados bajo el nombre. */
                .eq2-row-panel {
                    display: flex; align-items: flex-end; gap: var(--space-4); flex-wrap: wrap;
                    padding: 0 var(--space-4) var(--space-4) 60px;
                }
                .eq2-panel-actions {
                    display: flex; align-items: center; gap: var(--space-2);
                    margin-left: auto; flex-wrap: wrap;
                }
                .eq2-baja-btn { color: var(--danger-alerta) !important; }
                @media (max-width: 760px) {
                    .eq2-row-panel { padding-left: var(--space-4); }
                }

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
                    padding: var(--space-6); max-width: 520px; width: 100%;
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
                    display: flex; align-items: center; gap: 9px; height: 38px;
                    border: 1px solid var(--surface-border); border-radius: 8px;
                    padding: 0 12px; background: none; min-width: 200px; max-width: 320px; flex: 1;
                }
                .eq-search-wrap:focus-within { border-color: var(--accent); }
                .eq-search-wrap .form-input { border: none; box-shadow: none; background: transparent; padding: 6px 0; }
                .eq-empty-state {
                    display: flex; flex-direction: column; align-items: center; justify-content: center;
                    padding: var(--space-8) var(--space-4); gap: 4px;
                    text-align: center; color: var(--text-muted); font-size: var(--text-sm);
                }

                /* ── Controls (labels + inputs) ──────────────────────────── */
                .eq-ctrl { display: flex; flex-direction: column; gap: 3px; min-width: 120px; }
                .eq-ctrl-label {
                    font-size: 10.5px; font-weight: 700; letter-spacing: 0.07em;
                    text-transform: uppercase; color: var(--text-secondary);
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
                .eq-add-note {
                    display: flex; align-items: center; gap: 6px;
                    padding: var(--space-2) var(--space-4) var(--space-3);
                    font-size: var(--text-xs); color: var(--text-muted);
                }

                /* ── Pool card (unassigned, grid) ───────────────────────── */
                /* No están en esta obra: lo dice el aro punteado del avatar, no
                   un borde punteado en toda la tarjeta, que la sacaba de la
                   familia de tarjetas sin necesidad. */
                .eq2-card--pool .eq2-card-avatar {
                    background: none; color: var(--text-secondary);
                    border: 1.5px dashed var(--eq-dash, var(--surface-border));
                }
                .eq2-pool-add {
                    padding: 5px 14px; background: none;
                    border: 1px solid var(--surface-border); border-radius: 7px;
                    color: var(--text-primary); font-family: inherit; font-size: 11.5px;
                    cursor: pointer; transition: border-color 0.12s, background 0.12s;
                }
                .eq2-pool-add:hover:not(:disabled) { border-color: var(--accent); background: var(--accent-tint); }
                .eq2-pool-add:disabled { opacity: 0.5; cursor: default; }

                /* Fila del pool (vista de lista) */
                .eq-pool-row {
                    display: grid; grid-template-columns: 34px minmax(0, 1fr) auto;
                    align-items: center; gap: 14px;
                    padding: 10px var(--space-4);
                    border-top: 1px solid var(--eq-rule, var(--surface-border));
                    cursor: pointer; transition: background 0.12s;
                }
                .eq-pool-row:first-child { border-top: none; }
                .eq-pool-row:hover { background: var(--surface-hover); }
                .eq-pool-row--open { background: var(--accent-tint); }

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
                    overflow: hidden;
                }
                .eq-team-info { display: flex; flex-direction: column; min-width: 0; }
                .eq-team-name {
                    font-size: var(--text-sm); font-weight: 600;
                    color: var(--text-primary); white-space: nowrap;
                    overflow: hidden; text-overflow: ellipsis;
                }
                .eq-team-meta { font-size: var(--text-xs); color: var(--text-muted); margin-top: 1px; }

                /* ── Dados de baja ───────────────────────────────────────── */
                .eq-baja-summary {
                    display: flex; align-items: center; gap: var(--space-2);
                    font-size: 12.5px; color: var(--text-secondary);
                    cursor: pointer; list-style: none; user-select: none;
                    transition: color 0.12s;
                }
                .eq-baja-summary:hover { color: var(--text-primary); }
                .eq-baja-chevron { transition: transform 0.15s; flex-shrink: 0; }
                details[open] .eq-baja-chevron { transform: rotate(90deg); }
                .eq-baja-list {
                    margin-top: var(--space-3);
                    border: 1px solid var(--surface-border); border-radius: 12px; overflow: hidden;
                }
                .eq-baja-summary::-webkit-details-marker { display: none; }
                
                /* ── Onboarding DS 44 ────────────────────────────────────── */
                /* El relleno de la barra es SIEMPRE el acento: el estado lo dice
                   el recuento (naranjo + punto cuando quedan bloqueantes), no un
                   semáforo de tres colores compitiendo con la marca. */
                .eq-ob-badge {
                    display: inline-flex; align-items: center; gap: 7px;
                    flex-shrink: 0; font-size: 10.5px; color: var(--text-secondary);
                    white-space: nowrap;
                }
                .eq-ob-bar {
                    display: block; width: 46px; height: 3px; border-radius: 999px;
                    background: var(--surface-hover); overflow: hidden; flex-shrink: 0;
                }
                .eq-ob-bar-fill {
                    display: block; height: 100%; background: var(--accent);
                    transition: width 300ms ease;
                }
                .eq-ob-count {
                    display: inline-flex; align-items: center; gap: 4px;
                    font-variant-numeric: tabular-nums;
                }
                .eq-ob-count--warn { color: var(--danger-alerta); }
                .eq-ob-dot { width: 5px; height: 5px; border-radius: 50%; background: var(--danger-alerta); }
                /* En lista ocupa una columna: el recuento va sobre la barra. */
                .eq-ob-badge--row { display: flex; flex-direction: column; align-items: stretch; gap: 4px; }
                .eq-ob-badge--row .eq-ob-bar { width: 100%; }
                .eq-ob-apto { display: inline-flex; align-items: center; gap: 3px; color: var(--success-apagado); }
                .eq-ob-bloq { display: inline-flex; align-items: center; gap: 3px; color: var(--danger-alerta); }

                /* El panel de la fila es flex con wrap: el bloque ocupa una línea entera. */
                .eq-ob-block {
                    flex: 1 0 100%; width: 100%;
                    margin-top: var(--space-2); padding-top: var(--space-3);
                    border-top: 1px solid var(--surface-border);
                }
                .eq-ob-block-title {
                    display: flex; align-items: center; gap: 6px;
                    font-size: 0.75rem; font-weight: 700; letter-spacing: 0.04em;
                    text-transform: uppercase; color: var(--text-muted);
                    margin-bottom: var(--space-2);
                }
                .eq-ob-list { display: flex; flex-direction: column; }
                .eq-ob-empty { font-size: 0.8rem; color: var(--text-muted); line-height: 1.5; }
                .eq-ob-item {
                    display: flex; align-items: center; justify-content: space-between;
                    gap: var(--space-2); padding: 6px 0;
                    border-bottom: 1px solid var(--surface-border);
                }
                .eq-ob-item:last-child { border-bottom: none; }
                .eq-ob-item-main { display: flex; align-items: center; gap: var(--space-2); min-width: 0; }
                .eq-ob-item-label {
                    font-size: 0.84rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
                }
                .eq-ob-item-meta { font-size: 0.72rem; }
                .eq-ob-item-actions { display: flex; gap: 6px; flex-shrink: 0; }
            `}</style>
        </>
    );
}
