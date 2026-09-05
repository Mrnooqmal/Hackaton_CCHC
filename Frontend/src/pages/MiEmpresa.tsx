import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
    FiBriefcase, FiShield, FiTag, FiPlus, FiTrash2, FiSave, FiLock,
    FiUpload, FiX, FiInfo, FiUsers, FiArrowRight, FiAlertTriangle,
} from 'react-icons/fi';
import { AlertBanner, Modal, Select, PageHeader, CollectionView } from '../components/ui';
import type { CollectionMode } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { useBrand, DEFAULT_PRIMARY_COLOR } from '../context/BrandContext';
import { useToast } from '../context/ToastContext';
import { tenantsApi, type Tenant, type TenantRole, type TenantCargo } from '../api/tenants.api';
import { personasApi } from '../api/personas.api';
import type { PersonaResponse } from '../api/types';
import { PERMISSION_GROUPS, ALL_PERMISSION_KEYS, PERMISSIONS } from '../permissions';

// ── Helpers ──────────────────────────────────────────────────────────────────
const normalize = (s: string) =>
    String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();

const slug = (s: string) =>
    normalize(s).replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');


const isAdminRole = (r: { id?: string; nombre?: string }) =>
    r.id === 'admin' || ['admin', 'administrador'].includes(normalize(r.nombre || ''));

// Una persona pertenece a un rol si su `rol` coincide con el id o el nombre del rol.
const personaEnRol = (p: PersonaResponse, r: { id?: string; nombre?: string }) =>
    normalize(p.rol) === normalize(r.id || '') || normalize(p.rol) === normalize(r.nombre || '');

const personaActiva = (p: PersonaResponse) => p.estado !== 'desvinculado';

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
    const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
    if (!m) return null;
    return { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) };
}

// Luminancia relativa (WCAG) y ratio de contraste contra blanco — para validar
// que el texto blanco sobre el color de marca sea legible (botones, banners).
function relativeLuminance({ r, g, b }: { r: number; g: number; b: number }): number {
    const ch = [r, g, b].map((v) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

function contrastVsWhite(hex: string): number | null {
    const rgb = hexToRgb(hex);
    if (!rgb) return null;
    const l = relativeLuminance(rgb);
    return (1 + 0.05) / (l + 0.05);
}

// Paleta sugerida: colores de marca legibles con texto blanco (contraste AA ≥ 4.5).
const SUGGESTED_COLORS = [
    { hex: '#006edc', label: 'Azul CChC' },
    { hex: '#002952', label: 'Azul marino' },
    { hex: '#df3601', label: 'Naranja' },
    { hex: '#c81e1e', label: 'Rojo' },
    { hex: '#047857', label: 'Verde' },
    { hex: '#7c3aed', label: 'Violeta' },
    { hex: '#b45309', label: 'Ámbar' },
    { hex: '#0e7490', label: 'Cian' },
];

function compressLogo(dataUrl: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            const MAX_H = 120;
            const scale = Math.min(1, MAX_H / img.height);
            const canvas = document.createElement('canvas');
            canvas.width = Math.round(img.width * scale);
            canvas.height = Math.round(img.height * scale);
            canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
            resolve(canvas.toDataURL('image/png'));
        };
        img.onerror = reject;
        img.src = dataUrl;
    });
}

interface RoleDraft { _id: string; id: string; nombre: string; descripcion: string; permisos: string[]; locked?: boolean; tipo?: string | null; protegido?: boolean; }

type TabKey = 'identidad' | 'roles' | 'cargos';

export default function MiEmpresa() {
    const { user, hasPermission, updateUser } = useAuth();
    const { setLogo, setPrimaryColor } = useBrand();
    const { toast } = useToast();
    const tenantId = (user as any)?.tenantId as string | undefined;

    const can = {
        identidad: hasPermission(PERMISSIONS.EMPRESA_IDENTIDAD),
        roles: hasPermission(PERMISSIONS.EMPRESA_ROLES),
        cargos: hasPermission(PERMISSIONS.EMPRESA_CARGOS),
    };
    const tabs: { key: TabKey; label: string; icon: any }[] = [
        ...(can.identidad ? [{ key: 'identidad' as const, label: 'Identidad', icon: FiBriefcase }] : []),
        ...(can.roles ? [{ key: 'roles' as const, label: 'Roles y permisos', icon: FiShield }] : []),
        ...(can.cargos ? [{ key: 'cargos' as const, label: 'Cargos', icon: FiTag }] : []),
    ];
    const [tab, setTab] = useState<TabKey>(tabs[0]?.key ?? 'identidad');

    const [tenant, setTenant] = useState<Tenant | null>(null);
    const [personas, setPersonas] = useState<PersonaResponse[]>([]);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState('');

    useEffect(() => {
        if (!tenantId) { setLoading(false); return; }
        let alive = true;
        Promise.all([tenantsApi.get(tenantId), personasApi.list(tenantId)])
            .then(([tRes, pRes]) => {
                if (!alive) return;
                if (tRes.success && tRes.data) setTenant(tRes.data);
                else setLoadError(tRes.error || 'No se pudo cargar la empresa');
                if (pRes.success && pRes.data) setPersonas(pRes.data.personas);
            })
            .catch(() => alive && setLoadError('Error de conexión al cargar la empresa'))
            .finally(() => alive && setLoading(false));
        return () => { alive = false; };
    }, [tenantId]);

    if (!tenantId) {
        return <div style={{ padding: 24 }}><AlertBanner variant="error" message="No hay una empresa asociada a tu sesión." /></div>;
    }
    if (loading) {
        return <div style={{ padding: 48, display: 'flex', justifyContent: 'center' }}><div className="spinner" /></div>;
    }

    return (
        <div className="mi-empresa-page" style={{ padding: '0 24px 40px' }}>
            <PageHeader
                banner
                title="Mi Empresa"
                description={`Administra la identidad, los roles y permisos, y los cargos de ${tenant?.nombre || 'tu empresa'}.`}
            />

            {loadError && <AlertBanner variant="error" message={loadError} onDismiss={() => setLoadError('')} />}

            <div className="tabs" role="tablist">
                {tabs.map((t) => {
                    const Icon = t.icon;
                    return (
                        <button key={t.key} role="tab" aria-selected={tab === t.key}
                            className={`tab me-tab ${tab === t.key ? 'active' : ''}`} onClick={() => setTab(t.key)}>
                            <Icon size={15} /> {t.label}
                        </button>
                    );
                })}
            </div>

            {tab === 'identidad' && can.identidad && tenant && (
                <IdentidadTab
                    tenant={tenant}
                    onSaved={(t) => setTenant(t)}
                    brand={{ setLogo, setPrimaryColor }}
                    auth={{ user, updateUser }}
                    toast={toast}
                />
            )}
            {tab === 'roles' && can.roles && tenant && (
                <RolesTab
                    tenantId={tenantId}
                    tenant={tenant}
                    personas={personas}
                    setPersonas={setPersonas}
                    onSaved={(t) => setTenant(t)}
                    toast={toast}
                />
            )}
            {tab === 'cargos' && can.cargos && (
                <CargosTab
                    tenantId={tenantId}
                    personas={personas}
                    canEditKits={hasPermission(PERMISSIONS.CARGOS_GESTIONAR)}
                />
            )}

            <style>{styles}</style>
        </div>
    );
}

// ── Identidad ─────────────────────────────────────────────────────────────────
function IdentidadTab({ tenant, onSaved, brand, auth, toast }: {
    tenant: Tenant;
    onSaved: (t: Tenant) => void;
    brand: { setLogo: (l: string | null) => void; setPrimaryColor: (c: string) => void };
    auth: { user: any; updateUser: (u: any) => void };
    toast: ReturnType<typeof useToast>['toast'];
}) {
    const [nombre, setNombre] = useState(tenant.nombre || '');
    const [color, setColor] = useState(tenant.preferencias?.colorPrimario || DEFAULT_PRIMARY_COLOR);
    // Logo: vista previa actual (presignado vía branding) + base64 nuevo si se cambia.
    const [logoPreview, setLogoPreview] = useState<string | null>(auth.user?.branding?.logoUrl || null);
    const [logoBase64, setLogoBase64] = useState<string | undefined>(undefined);
    const [saving, setSaving] = useState(false);
    const [err, setErr] = useState('');
    const fileRef = useRef<HTMLInputElement>(null);

    const rgb = hexToRgb(color);
    const colorValido = !!rgb;

    const onFile = (file: File) => {
        if (!file.type.startsWith('image/')) { setErr('El logo debe ser una imagen (PNG, JPG, SVG, WebP).'); return; }
        if (file.size > 2 * 1024 * 1024) { setErr('El logo no puede superar los 2 MB.'); return; }
        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const compressed = await compressLogo(e.target?.result as string);
                setLogoPreview(compressed); setLogoBase64(compressed); setErr('');
            } catch { setErr('Error al procesar la imagen.'); }
        };
        reader.readAsDataURL(file);
    };

    const dirty = nombre.trim() !== (tenant.nombre || '')
        || color.toLowerCase() !== (tenant.preferencias?.colorPrimario || DEFAULT_PRIMARY_COLOR).toLowerCase()
        || logoBase64 !== undefined;

    const save = async () => {
        if (!nombre.trim()) { setErr('La razón social no puede quedar vacía.'); return; }
        if (!colorValido) { setErr('El color principal no es un hexadecimal válido (ej. #006edc).'); return; }
        setSaving(true); setErr('');
        try {
            const res = await tenantsApi.updateBranding(tenant.tenantId, {
                nombre: nombre.trim(), colorPrimario: color, logoBase64,
            });
            if (res.success && res.data) {
                // Aplicar identidad en vivo y reflejarla en la sesión.
                brand.setPrimaryColor(color);
                if (logoBase64) brand.setLogo(logoBase64);
                else if (logoBase64 === '') brand.setLogo(null);
                auth.updateUser({
                    branding: {
                        ...(auth.user?.branding || {}),
                        colorPrimario: color,
                        ...(logoBase64 ? { logoUrl: logoBase64 } : logoBase64 === '' ? { logoUrl: null } : {}),
                    },
                });
                onSaved(res.data.tenant);
                setLogoBase64(undefined);
                toast.success('Identidad de la empresa actualizada.');
            } else {
                setErr(res.error || 'No se pudo guardar la identidad.');
            }
        } catch { setErr('Error de conexión al guardar.'); }
        finally { setSaving(false); }
    };

    return (
        <div className="me-grid-2">
            <div className="card me-card">
                <h3 className="me-card-title">Datos de la empresa</h3>
                <div className="form-group">
                    <label className="form-label">Razón social</label>
                    <input className="form-input" value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Constructora Demo SpA" />
                </div>
                <div className="form-group">
                    <label className="form-label">RUT empresa</label>
                    <input className="form-input" value={tenant.rutEmpresa} disabled readOnly />
                    <span className="text-xs text-muted">El RUT no se puede modificar.</span>
                </div>

                <h3 className="me-card-title" style={{ marginTop: 20 }}>Color principal</h3>
                <div className="me-color-row">
                    <button type="button" className="me-swatch" style={{ background: colorValido ? color : '#888' }}
                        onClick={() => document.getElementById('me-color-input')?.click()} title="Abrir selector de color" />
                    <input id="me-color-input" type="color" className="me-color-native"
                        value={colorValido ? color : DEFAULT_PRIMARY_COLOR} onChange={(e) => setColor(e.target.value)} />
                    <input className="form-input" style={{ maxWidth: 130 }} value={color} maxLength={7} spellCheck={false}
                        onChange={(e) => setColor(e.target.value)} />
                    {rgb && <span className="text-xs text-muted">R {rgb.r} · G {rgb.g} · B {rgb.b}</span>}
                </div>

                <div style={{ marginTop: 12 }}>
                    <span className="text-xs text-muted" style={{ display: 'block', marginBottom: 6 }}>Colores sugeridos</span>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                        {SUGGESTED_COLORS.map((s) => {
                            const active = color.toLowerCase() === s.hex.toLowerCase();
                            return (
                                <button key={s.hex} type="button" title={`${s.label} · ${s.hex}`}
                                    onClick={() => setColor(s.hex)}
                                    style={{
                                        width: 28, height: 28, borderRadius: 8, background: s.hex, cursor: 'pointer',
                                        border: active ? '2px solid var(--text-primary)' : '2px solid var(--surface-border)',
                                        boxShadow: active ? '0 0 0 2px var(--surface-bg)' : 'none',
                                        outline: 'none', padding: 0,
                                    }} />
                            );
                        })}
                    </div>
                </div>

                {colorValido && (() => {
                    const ratio = contrastVsWhite(color);
                    if (ratio == null) return null;
                    const ok = ratio >= 4.5;
                    return (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 }}>
                            <span style={{
                                display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 'var(--text-xs)', fontWeight: 600,
                                color: '#fff', background: color, padding: '3px 10px', borderRadius: 6,
                            }}>Texto blanco</span>
                            <span className="text-xs" style={{ color: ok ? 'var(--success-600, #047857)' : 'var(--warning-600, #b45309)', fontWeight: 600 }}>
                                {ok ? '✓ Buen contraste' : '⚠ Contraste bajo'} · {ratio.toFixed(1)}:1
                            </span>
                        </div>
                    );
                })()}

                <p className="text-xs text-muted" style={{ marginTop: 6 }}>
                    Reemplaza el color de acento en toda la plataforma al guardar. Recomendamos un contraste mínimo de 4.5:1 con el texto blanco de los botones.
                </p>
            </div>

            <div className="card me-card">
                <h3 className="me-card-title">Logo</h3>
                <div className="me-logo-area">
                    <div className="me-logo-preview">
                        {logoPreview
                            ? <img src={logoPreview} alt="Logo de la empresa" />
                            : <span className="text-sm text-muted">Sin logo</span>}
                    </div>
                    <div className="me-logo-actions">
                        <input ref={fileRef} type="file" accept="image/*" hidden
                            onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ''; }} />
                        <button className="btn btn-secondary btn-sm" onClick={() => fileRef.current?.click()}>
                            <FiUpload size={13} /> {logoPreview ? 'Cambiar logo' : 'Subir logo'}
                        </button>
                        {logoPreview && (
                            <button className="btn btn-ghost btn-sm" style={{ color: 'var(--danger-500)' }}
                                onClick={() => { setLogoPreview(null); setLogoBase64(''); }}>
                                <FiX size={13} /> Quitar
                            </button>
                        )}
                        <span className="text-xs text-muted">PNG, JPG, SVG o WebP · Máx. 2 MB</span>
                    </div>
                </div>
            </div>

            <div className="me-save-bar">
                {err && <AlertBanner variant="error" message={err} onDismiss={() => setErr('')} />}
                <button className="btn btn-primary" disabled={!dirty || saving} onClick={save}>
                    {saving ? <div className="spinner" /> : <><FiSave /> Guardar identidad</>}
                </button>
            </div>
        </div>
    );
}

// ── Roles y permisos ────────────────────────────────────────────────────────
function RolesTab({ tenantId, tenant, personas, setPersonas, onSaved, toast }: {
    tenantId: string;
    tenant: Tenant;
    personas: PersonaResponse[];
    setPersonas: React.Dispatch<React.SetStateAction<PersonaResponse[]>>;
    onSaved: (t: Tenant) => void;
    toast: ReturnType<typeof useToast>['toast'];
}) {
    const toDraft = (roles: TenantRole[]): RoleDraft[] => {
        const list = roles.map((r, i) => {
            const tipo = r.tipo || (isAdminRole(r) ? 'admin' : null);
            const locked = tipo === 'admin';
            return {
                _id: `r-${i}-${r.id || r.nombre}`,
                id: r.id || slug(r.nombre),
                tipo,
                // Roles con `tipo` son mínimos: no eliminables, descripción no editable.
                protegido: !!tipo,
                nombre: r.nombre,
                descripcion: r.descripcion || '',
                permisos: locked ? ALL_PERMISSION_KEYS : (r.permisos || []),
                locked,
            };
        });
        // Roles mínimos (protegidos) primero; el Administrador a la cabeza.
        return list.sort((a, b) => {
            if (a.locked !== b.locked) return a.locked ? -1 : 1;
            if (a.protegido !== b.protegido) return a.protegido ? -1 : 1;
            return 0;
        });
    };

    const [roles, setRoles] = useState<RoleDraft[]>(() => toDraft(tenant.roles || []));
    const [saving, setSaving] = useState(false);
    const [err, setErr] = useState('');
    const [reassign, setReassign] = useState<{ role: RoleDraft; affected: PersonaResponse[] } | null>(null);

    const baseline = useMemo(() => JSON.stringify(toDraft(tenant.roles || []).map(({ _id, ...r }) => r)), [tenant.roles]);
    const current = JSON.stringify(roles.map(({ _id, ...r }) => r));
    const dirty = baseline !== current;

    const update = (id: string, patch: Partial<RoleDraft>) =>
        setRoles((p) => p.map((r) => {
            if (r._id !== id) return r;
            // En roles protegidos la descripción es fija (solo el nombre es editable).
            if (r.protegido && 'descripcion' in patch) {
                const { descripcion, ...rest } = patch;
                return { ...r, ...rest };
            }
            return { ...r, ...patch };
        }));

    const togglePerm = (id: string, key: string) =>
        setRoles((p) => p.map((r) => {
            if (r._id !== id || r.locked) return r;
            const has = r.permisos.includes(key);
            return { ...r, permisos: has ? r.permisos.filter((k) => k !== key) : [...r.permisos, key] };
        }));

    const addRole = () =>
        setRoles((p) => [...p, { _id: `new-${Date.now()}`, id: '', nombre: '', descripcion: '', permisos: [] }]);

    // Construye la lista de roles para persistir (ids estables; admin con acceso total).
    const buildRolesPayload = (list: RoleDraft[]): TenantRole[] => {
        const taken = new Set<string>();
        return list.map((r) => {
            // El id de un rol protegido lo fija su `tipo` (estable ante renombres).
            let id = r.protegido ? (r.tipo as string) : (r.id || slug(r.nombre) || `rol_${taken.size + 1}`);
            while (taken.has(id)) id = `${id}_2`;
            taken.add(id);
            return {
                id,
                tipo: r.tipo ?? null,
                nombre: r.nombre.trim(),
                descripcion: r.descripcion.trim(),
                permisos: r.locked ? ALL_PERMISSION_KEYS : r.permisos,
            };
        });
    };

    const validate = (list: RoleDraft[]): string | null => {
        if (list.length === 0) return 'Debe existir al menos un rol.';
        if (list.some((r) => !r.nombre.trim())) return 'Cada rol debe tener un nombre.';
        const names = list.map((r) => normalize(r.nombre));
        if (new Set(names).size !== names.length) return 'Hay roles con nombres duplicados.';
        if (!list.some((r) => r.locked)) return 'El rol Administrador no puede eliminarse.';
        return null;
    };

    const persist = async (list: RoleDraft[]): Promise<boolean> => {
        const res = await tenantsApi.updateRoles(tenantId, buildRolesPayload(list));
        if (res.success && res.data) { onSaved(res.data.tenant); return true; }
        setErr(res.error || 'No se pudieron guardar los roles.');
        return false;
    };

    const save = async () => {
        const v = validate(roles);
        if (v) { setErr(v); return; }
        setSaving(true); setErr('');
        try { if (await persist(roles)) toast.success('Roles y permisos actualizados.'); }
        catch { setErr('Error de conexión al guardar.'); }
        finally { setSaving(false); }
    };

    // Eliminar un rol: si tiene personas, exige reasignarlas antes de borrarlo.
    const requestDelete = (role: RoleDraft) => {
        if (role.protegido) return;
        if (roles.filter((r) => !r.locked).length <= 0) { setErr('Debe quedar al menos un rol.'); return; }
        const affected = personas.filter((p) => personaActiva(p) && personaEnRol(p, role));
        if (affected.length > 0) { setReassign({ role, affected }); return; }
        // Sin personas: eliminar directamente (queda pendiente de guardar).
        setRoles((p) => p.filter((r) => r._id !== role._id));
    };

    // Confirmación de reasignación: mueve a las personas al rol destino y elimina el rol.
    const confirmReassign = async (targetId: string) => {
        if (!reassign) return;
        const { role, affected } = reassign;
        const target = roles.find((r) => r.id === targetId || r._id === targetId);
        if (!target) return;
        setSaving(true); setErr('');
        try {
            for (const p of affected) {
                const res = await personasApi.update(tenantId, p.personaId, { rol: target.id });
                if (!res.success) throw new Error(res.error || `No se pudo reasignar a ${p.nombre}`);
            }
            setPersonas((prev) => prev.map((p) =>
                affected.some((a) => a.personaId === p.personaId) ? { ...p, rol: target.id } : p));
            const nextRoles = roles.filter((r) => r._id !== role._id);
            if (await persist(nextRoles)) {
                setRoles(nextRoles);
                toast.success(`Rol "${role.nombre}" eliminado. ${affected.length} persona(s) reasignada(s) a "${target.nombre}".`);
            }
            setReassign(null);
        } catch (e: any) { setErr(e?.message || 'Error al reasignar las personas.'); }
        finally { setSaving(false); }
    };

    const countByRole = (r: RoleDraft) => personas.filter((p) => personaActiva(p) && personaEnRol(p, r)).length;

    return (
        <div>
            <div className="card me-banner">
                <FiInfo style={{ flexShrink: 0, color: 'var(--info-500)' }} />
                <span className="text-sm text-muted" style={{ flex: 1 }}>
                    Los roles con <FiLock size={11} style={{ verticalAlign: -1 }} /> son los mínimos de la empresa:
                    puedes renombrarlos y ajustar sus permisos, pero no eliminarlos ni cambiar su descripción.
                    El <b>Administrador</b> tiene acceso total y sus permisos no se editan. Al eliminar un rol con
                    personas asignadas, deberás reasignarlas a otro rol.
                </span>
                <button className="btn btn-save" disabled={!dirty || saving} onClick={save}>
                    {saving ? <div className="spinner" /> : <><FiSave /> Guardar cambios</>}
                </button>
            </div>

            {err && <AlertBanner variant="error" message={err} onDismiss={() => setErr('')} />}

            <div className="me-roles">
                {roles.map((r) => {
                    const count = countByRole(r);
                    return (
                        <div key={r._id} className="card me-role">
                            <div className="me-role-head">
                                <span className={`me-role-icon ${r.protegido ? 'locked' : ''}`}>
                                    {r.protegido ? <FiLock size={14} /> : <FiShield size={14} />}
                                </span>
                                <div className="me-role-fields">
                                    <input className="form-input me-role-name" placeholder="Nombre del rol"
                                        value={r.nombre} disabled={r.locked}
                                        onChange={(e) => update(r._id, { nombre: e.target.value })} />
                                    <input className="form-input" placeholder="Descripción (opcional)"
                                        value={r.descripcion} disabled={r.protegido}
                                        title={r.protegido ? 'La descripción de un rol mínimo no se puede editar.' : undefined}
                                        onChange={(e) => update(r._id, { descripcion: e.target.value })} />
                                </div>
                                <div className="me-role-meta">
                                    <span className="me-count" title="Personas con este rol"><FiUsers size={12} /> {count}</span>
                                    {!r.protegido && (
                                        <button className="btn btn-ghost btn-sm" style={{ color: 'var(--danger-500)' }}
                                            onClick={() => requestDelete(r)} title="Eliminar rol"><FiTrash2 /></button>
                                    )}
                                </div>
                            </div>

                            <div className="me-perms-head">
                                Permisos {r.locked && <span className="me-lock-tag"><FiLock size={10} /> Acceso total (no editable)</span>}
                            </div>
                            <div className="me-perms-groups">
                                {PERMISSION_GROUPS.map((g) => (
                                    <div key={g.grupo} className="me-perms-group">
                                        <div className="me-perms-group-title">{g.grupo}</div>
                                        {g.permisos.map((perm) => (
                                            <label key={perm.key} className={`me-perm ${r.locked ? 'disabled' : ''}`}>
                                                <input type="checkbox" disabled={r.locked}
                                                    checked={r.locked || r.permisos.includes(perm.key)}
                                                    onChange={() => togglePerm(r._id, perm.key)} />
                                                <span>{perm.label}</span>
                                            </label>
                                        ))}
                                    </div>
                                ))}
                            </div>
                        </div>
                    );
                })}
            </div>

            <button className="btn btn-secondary" style={{ marginTop: 12 }} onClick={addRole}><FiPlus /> Añadir rol</button>

            <ReassignModal
                open={!!reassign}
                title={`Eliminar rol "${reassign?.role.nombre}"`}
                noun="rol"
                affected={(reassign?.affected || []).map((p) => ({
                    id: p.personaId,
                    label: `${p.nombre} ${p.apellido || ''}`.trim(),
                    sub: p.rut,
                }))}
                options={roles.filter((r) => r._id !== reassign?.role._id && r.id).map((r) => ({ value: r.id, label: r.nombre }))}
                busy={saving}
                onCancel={() => setReassign(null)}
                onConfirm={confirmReassign}
            />
        </div>
    );
}

// ── Cargos (solo lectura + toggle lista/grilla) ───────────────────────────────
function CargosTab({ tenantId, personas }: {
    tenantId: string;
    personas: PersonaResponse[];
    canEditKits: boolean;
}) {
    const [cargos, setCargos] = useState<TenantCargo[]>([]);
    const [loading, setLoading] = useState(true);
    const [err, setErr] = useState('');
    const [mode, setMode] = useState<CollectionMode>('list');
    const [search, setSearch] = useState('');

    useEffect(() => {
        let alive = true;
        tenantsApi.getCargos(tenantId)
            .then((res) => { if (alive && res.success && res.data) setCargos(res.data.cargos); })
            .catch(() => alive && setErr('No se pudo cargar el catálogo de cargos.'))
            .finally(() => alive && setLoading(false));
        return () => { alive = false; };
    }, [tenantId]);

    const countByCargo = (codigo: string) => personas.filter((p) => personaActiva(p) && p.cargo === codigo).length;

    const filtered = cargos.filter((c) => {
        if (!search) return true;
        const s = search.toLowerCase();
        return c.label.toLowerCase().includes(s) || c.codigo.toLowerCase().includes(s);
    });

    if (loading) return <div style={{ padding: 32, display: 'flex', justifyContent: 'center' }}><div className="spinner" /></div>;

    const tagLabel = (c: TenantCargo) => c.legacy ? 'heredado' : c.seed ? 'predefinido' : 'personalizado';
    const tagColor = (c: TenantCargo) => c.legacy ? 'var(--text-muted)' : c.seed ? '#006edc' : '#10b981';

    const listView = (
        <div className="me-cargos-list">
            {filtered.length === 0 && <div className="text-sm text-muted" style={{ padding: '12px 0' }}>No hay cargos que coincidan.</div>}
            {filtered.map((c) => {
                const count = countByCargo(c.codigo);
                return (
                    <Link key={c.codigo} to={`/cargos-onboarding?cargo=${c.codigo}`} className="me-cargo-row">
                        <div className="me-cargo-row-name">{c.label}</div>
                        <div className="me-cargo-row-code">{c.codigo}</div>
                        <div className="me-cargo-row-meta">
                            <span className="me-cargo-row-tag" style={{ color: tagColor(c) }}>{tagLabel(c)}</span>
                            <span className="me-cargo-row-tag">{c.kit?.length || 0} ítems kit</span>
                            <span className="me-cargo-row-count"><FiUsers size={11} /> {count}</span>
                        </div>
                        <FiArrowRight size={13} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                    </Link>
                );
            })}
        </div>
    );

    const gridView = (
        <div className="me-cargos-grid2">
            {filtered.length === 0 && <div className="text-sm text-muted" style={{ padding: '12px 0' }}>No hay cargos que coincidan.</div>}
            {filtered.map((c) => {
                const count = countByCargo(c.codigo);
                return (
                    <Link key={c.codigo} to={`/cargos-onboarding?cargo=${c.codigo}`} className="me-cargo-card">
                        <div className="me-cargo-card-name">{c.label}</div>
                        <div className="me-cargo-card-code">{c.codigo}</div>
                        <div className="me-cargo-card-footer">
                            <span style={{ fontSize: '0.72rem', color: tagColor(c), fontWeight: 600 }}>{tagLabel(c)}</span>
                            <span className="me-cargo-row-count"><FiUsers size={11} /> {count}</span>
                        </div>
                    </Link>
                );
            })}
        </div>
    );

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            {err && <AlertBanner variant="error" message={err} onDismiss={() => setErr('')} />}

            <CollectionView
                searchValue={search}
                onSearchChange={setSearch}
                searchPlaceholder="Buscar cargo…"
                mode={mode}
                onModeChange={setMode}
                count={filtered.length}
                list={listView}
                grid={gridView}
                actions={
                    <Link to="/cargos-onboarding" className="btn btn-primary btn-sm">
                        Onboarding por cargo <FiArrowRight size={13} />
                    </Link>
                }
            />
        </div>
    );
}

// ── Modal de reasignación (compartido por roles y cargos) ─────────────────────
function ReassignModal({ open, title, noun, affected, options, busy, onCancel, onConfirm }: {
    open: boolean;
    title: string;
    noun: 'rol' | 'cargo';
    affected: { id: string; label: string; sub?: string }[];
    options: { value: string; label: string }[];
    busy: boolean;
    onCancel: () => void;
    onConfirm: (target: string) => void;
}) {
    const [target, setTarget] = useState('');
    useEffect(() => { if (open) setTarget(options[0]?.value ?? ''); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

    const sinDestino = options.length === 0;

    return (
        <Modal isOpen={open} onClose={onCancel} title={title} size="lg"
            subtitle={`${affected.length} persona(s) tienen este ${noun}. Reasígnalas para poder eliminarlo.`}
            footer={<>
                <button className="btn btn-secondary" onClick={onCancel}>Cancelar</button>
                <button className="btn btn-danger" disabled={busy || sinDestino || !target} onClick={() => onConfirm(target)}>
                    {busy ? <div className="spinner" /> : <><FiTrash2 /> Reasignar y eliminar</>}
                </button>
            </>}>
            <div className="me-reassign-warn">
                <FiAlertTriangle style={{ flexShrink: 0, color: 'var(--warning-500)' }} />
                <span className="text-sm">
                    Estas personas perderán el {noun} actual. Elige el {noun} de destino antes de continuar.
                </span>
            </div>

            <div className="form-group" style={{ marginTop: 14 }}>
                <label className="form-label">Reasignar al {noun}</label>
                {sinDestino
                    ? <AlertBanner variant="warning" message={`No hay otro ${noun} disponible. Crea uno antes de eliminar este.`} />
                    : <Select value={target} onChange={setTarget} options={options} ariaLabel={`Nuevo ${noun}`} />}
            </div>

            <div className="me-affected">
                {affected.map((a) => (
                    <div key={a.id} className="me-affected-row">
                        <span className="me-affected-name">{a.label}</span>
                        {a.sub && <span className="text-xs text-muted">{a.sub}</span>}
                    </div>
                ))}
            </div>
        </Modal>
    );
}

const styles = `
.mi-empresa-page .me-tab { display: inline-flex; align-items: center; gap: 6px; background: none; border: none; border-bottom: 2px solid transparent; }
.mi-empresa-page .form-label { display:block; margin-bottom: 6px; }

.me-grid-2 { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 16px; align-items: start; }
.me-card { padding: 20px; }
.me-card-title { font-size: var(--text-base); font-weight: 600; margin: 0 0 14px; }
.me-color-row { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.me-swatch { width: 44px; height: 44px; border-radius: var(--radius-md); border: 1px solid var(--surface-border); cursor: pointer; }
.me-color-native { width: 0; height: 0; opacity: 0; position: absolute; pointer-events: none; }

.me-logo-area { display: flex; align-items: center; gap: 18px; flex-wrap: wrap; }
.me-logo-preview { width: 140px; height: 100px; border: 1px dashed var(--surface-border); border-radius: var(--radius-md); display: flex; align-items: center; justify-content: center; background: var(--surface-hover); overflow: hidden; }
.me-logo-preview img { max-width: 100%; max-height: 100%; object-fit: contain; }
.me-logo-actions { display: flex; flex-direction: column; gap: 8px; align-items: flex-start; }

.me-save-bar { grid-column: 1 / -1; display: flex; flex-direction: column; gap: 12px; align-items: flex-end; }
.me-save-bar .alert-banner { width: 100%; }

.me-banner { display: flex; align-items: center; gap: 12px; padding: 12px 16px; margin-bottom: 16px; }

.me-roles { display: flex; flex-direction: column; gap: 14px; }
.me-role { padding: 16px; }
.me-role-head { display: flex; align-items: flex-start; gap: 12px; margin-bottom: 14px; }
.me-role-icon { width: 32px; height: 32px; border-radius: var(--radius-md); background: var(--cchc-blue-tint); color: var(--accent-text); display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.me-role-icon.locked { background: var(--surface-hover); color: var(--text-muted); }
.me-role-fields { flex: 1; display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.me-role-name { font-weight: 600; }
.me-role-meta { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
.me-count { display: inline-flex; align-items: center; gap: 4px; font-size: var(--text-xs); color: var(--text-muted); background: var(--surface-hover); padding: 3px 8px; border-radius: 999px; white-space: nowrap; }

.me-perms-head { font-size: var(--text-xs); font-weight: 700; letter-spacing: .04em; text-transform: uppercase; color: var(--text-muted); margin-bottom: 10px; display: flex; align-items: center; gap: 8px; }
.me-lock-tag { display: inline-flex; align-items: center; gap: 4px; text-transform: none; letter-spacing: 0; font-weight: 500; color: var(--text-muted); }
.me-perms-groups { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 14px; }
.me-perms-group-title { font-size: var(--text-xs); font-weight: 600; color: var(--text-secondary, var(--text-primary)); margin-bottom: 6px; }
.me-perm { display: flex; align-items: flex-start; gap: 8px; font-size: var(--text-sm); padding: 3px 0; cursor: pointer; }
.me-perm.disabled { cursor: default; opacity: .7; }
.me-perm input { margin-top: 3px; flex-shrink: 0; }

.me-cargos-list { display: flex; flex-direction: column; }
.me-cargo-row {
    display: flex; align-items: center; gap: 12px;
    padding: 9px 12px; border-radius: var(--radius-md);
    text-decoration: none; color: inherit;
    transition: background var(--transition-fast);
    border-bottom: 1px solid var(--surface-border);
}
.me-cargo-row:last-child { border-bottom: none; }
.me-cargo-row:hover { background: var(--surface-hover); }
.me-cargo-row-name { font-weight: 600; font-size: var(--text-sm); color: var(--text-primary); flex: 1; min-width: 120px; }
.me-cargo-row-code { font-family: var(--font-mono); font-size: 11px; color: var(--text-muted); min-width: 80px; }
.me-cargo-row-meta { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.me-cargo-row-tag { font-size: 11px; font-weight: 500; }
.me-cargo-row-count { display: inline-flex; align-items: center; gap: 3px; font-size: 11px; color: var(--text-muted); background: var(--surface-hover); padding: 2px 7px; border-radius: 999px; }
.me-cargos-grid2 { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 10px; }
.me-cargo-card {
    display: flex; flex-direction: column; gap: 6px;
    padding: 14px 16px; border-radius: var(--radius-md);
    border: 1px solid var(--surface-border); background: var(--surface);
    text-decoration: none; color: inherit;
    transition: border-color var(--transition-fast), box-shadow var(--transition-fast);
}
.me-cargo-card:hover { border-color: var(--accent); box-shadow: 0 2px 8px rgba(0,110,220,0.08); }
.me-cargo-card-name { font-weight: 600; font-size: var(--text-sm); color: var(--text-primary); }
.me-cargo-card-code { font-family: var(--font-mono); font-size: 11px; color: var(--text-muted); }
.me-cargo-card-footer { display: flex; align-items: center; justify-content: space-between; margin-top: 4px; }
.me-tag { font-size: var(--text-xs); color: var(--text-muted); background: var(--surface-hover); padding: 3px 8px; border-radius: 6px; white-space: nowrap; }

.me-reassign-warn { display: flex; align-items: center; gap: 10px; background: var(--surface-hover); padding: 10px 12px; border-radius: var(--radius-md); }
.me-affected { margin-top: 14px; max-height: 220px; overflow-y: auto; border: 1px solid var(--surface-border); border-radius: var(--radius-md); }
.me-affected-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 8px 12px; border-bottom: 1px solid var(--surface-border); }
.me-affected-row:last-child { border-bottom: none; }
.me-affected-name { font-size: var(--text-sm); font-weight: 500; }

@media (max-width: 640px) {
  .me-role-head { flex-wrap: wrap; }
  .me-cargo { flex-wrap: wrap; }
}
`;
