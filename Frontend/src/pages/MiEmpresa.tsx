import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
    FiBriefcase, FiShield, FiTag, FiPlus, FiTrash2, FiSave, FiLock,
    FiUpload, FiX, FiInfo, FiUsers, FiArrowRight, FiAlertTriangle,
    FiCheck, FiImage, FiFile, FiEye, FiEdit3,
} from 'react-icons/fi';
import { LuHardHat } from 'react-icons/lu';
import { AlertBanner, Modal, Select, PageHeader, CollectionView } from '../components/ui';
import type { CollectionMode } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { useBrand, DEFAULT_PRIMARY_COLOR } from '../context/BrandContext';
import { useToast } from '../context/ToastContext';
import { tenantsApi, type Tenant, type TenantRole, type TenantCargo } from '../api/tenants.api';
import { eppApi, CERTIFICADO_TIPO_LABEL, type EppElemento, type EppAdjunto, type CertificadoTipo } from '../api/epp.api';
import { uploadsApi } from '../api/uploads.api';
import { personasApi } from '../api/personas.api';
import type { PersonaResponse } from '../api/types';
import { PERMISSION_GROUPS, ALL_PERMISSION_KEYS, PERMISSIONS } from '../permissions';
import DocumentPreviewModal from '../components/DocumentPreviewModal';

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

// La franja institucional del header (--cchc-navy) es el color de marca oscurecido.
// El factor debe coincidir con `darken(0.22)` de BrandContext.applyPrimaryColor.
const NAVY_DARKEN = 0.22;

function darkenHex(hex: string, t: number): string | null {
    const rgb = hexToRgb(hex);
    if (!rgb) return null;
    const ch = (n: number) => Math.max(0, Math.min(255, Math.round(n * t))).toString(16).padStart(2, '0');
    return `#${ch(rgb.r)}${ch(rgb.g)}${ch(rgb.b)}`;
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

type TabKey = 'identidad' | 'roles' | 'cargos' | 'epp';

export default function MiEmpresa() {
    const { user, hasPermission, updateUser } = useAuth();
    const { setLogo, setPrimaryColor } = useBrand();
    const { toast } = useToast();
    const tenantId = (user as any)?.tenantId as string | undefined;

    const can = {
        identidad: hasPermission(PERMISSIONS.EMPRESA_IDENTIDAD),
        roles: hasPermission(PERMISSIONS.EMPRESA_ROLES),
        cargos: hasPermission(PERMISSIONS.EMPRESA_CARGOS),
        epp: hasPermission(PERMISSIONS.EMPRESA_EPP),
    };
    const tabs: { key: TabKey; label: string; icon: any }[] = [
        ...(can.identidad ? [{ key: 'identidad' as const, label: 'Identidad', icon: FiBriefcase }] : []),
        ...(can.roles ? [{ key: 'roles' as const, label: 'Roles y permisos', icon: FiShield }] : []),
        ...(can.cargos ? [{ key: 'cargos' as const, label: 'Cargos', icon: FiTag }] : []),
        ...(can.epp ? [{ key: 'epp' as const, label: 'EPP', icon: LuHardHat }] : []),
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
                description={`Administra la identidad, los roles y permisos, los cargos y el catálogo de EPP de ${tenant?.nombre || 'tu empresa'}.`}
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
                    personas={personas}
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
            {tab === 'epp' && can.epp && (
                <EppTab tenantId={tenantId} toast={toast} />
            )}

            <style>{styles}</style>
        </div>
    );
}

// ── Identidad ─────────────────────────────────────────────────────────────────
function IdentidadTab({ tenant, personas, onSaved, brand, auth, toast }: {
    tenant: Tenant;
    personas: PersonaResponse[];
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
    const [dragging, setDragging] = useState(false);
    const fileRef = useRef<HTMLInputElement>(null);

    const [repLegalId, setRepLegalId] = useState(tenant.reglas?.representanteLegal?.personaId || '');
    const [savingRepLegal, setSavingRepLegal] = useState(false);

    // Se guarda al elegir, no al enviar el formulario: es un solo campo y el botón
    // de abajo es el de la identidad visual (nombre, color, logo).
    const guardarRepLegal = async (personaId: string) => {
        const anterior = repLegalId;
        setRepLegalId(personaId);
        setSavingRepLegal(true);
        try {
            const persona = personas.find((p) => p.personaId === personaId);
            const res = await tenantsApi.updateRepresentanteLegal(
                tenant.tenantId,
                personaId
                    ? {
                        personaId,
                        nombre: persona ? `${persona.nombre} ${persona.apellido || ''}`.trim() : null,
                        rut: persona?.rut || null,
                    }
                    : null,
            );
            if (res.success && res.data) {
                onSaved(res.data.tenant);
                toast.success(personaId ? 'Representante legal designado.' : 'Representante legal quitado.');
            } else {
                setRepLegalId(anterior);
                toast.error(res.error || 'No se pudo guardar el representante legal.');
            }
        } catch {
            setRepLegalId(anterior);
            toast.error('Error de conexión al guardar el representante legal.');
        } finally {
            setSavingRepLegal(false);
        }
    };

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

    const ratio = colorValido ? contrastVsWhite(color) : null;
    const contrasteOk = ratio != null && ratio >= 4.5;
    const tint = rgb ? `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.12)` : 'var(--surface-hover)';
    const navy = (colorValido && darkenHex(color, NAVY_DARKEN)) || 'var(--cchc-navy)';

    return (
        <div className="me-identity">
            <div className="me-identity-form">
                <section className="me-section">
                    <div className="me-section-head">
                        <h3 className="me-section-title">Datos de la empresa</h3>
                        <p className="me-section-hint">El nombre con el que tu empresa aparece en la plataforma y en los documentos.</p>
                    </div>
                    <div className="me-section-body">
                        <div className="form-group">
                            <label className="form-label" htmlFor="me-nombre">Razón social</label>
                            <input id="me-nombre" className="form-input" value={nombre}
                                onChange={(e) => setNombre(e.target.value)} placeholder="Constructora Demo SpA" />
                        </div>
                        <div className="form-group">
                            <label className="form-label" htmlFor="me-rut">RUT empresa</label>
                            <div className="me-field-locked">
                                <input id="me-rut" className="form-input" value={tenant.rutEmpresa} disabled readOnly />
                                <FiLock size={13} aria-hidden="true" />
                            </div>
                            <span className="me-field-hint">El RUT no se puede modificar.</span>
                        </div>
                        {/* Representante legal (DS 44 Art. 8 inc. 1): aprueba el Programa de
                            Trabajo Preventivo y firma la Política SST. Se guarda solo, sin
                            depender del botón de identidad, porque es un dato normativo y no
                            de marca. */}
                        <div className="form-group">
                            <label className="form-label" htmlFor="me-repleg">Representante legal</label>
                            <select
                                id="me-repleg"
                                className="form-input"
                                value={repLegalId}
                                disabled={savingRepLegal}
                                onChange={(e) => guardarRepLegal(e.target.value)}
                            >
                                <option value="">Sin designar</option>
                                {personas.map((p) => (
                                    <option key={p.personaId} value={p.personaId}>
                                        {`${p.nombre} ${p.apellido || ''}`.trim()}{p.rut ? ` · ${p.rut}` : ''}
                                    </option>
                                ))}
                            </select>
                            <span className="me-field-hint">
                                Aprueba el Programa de Trabajo Preventivo (Art. 8) y firma la Política SST.
                                Sin designarlo, el programa no se puede aprobar.
                            </span>
                        </div>
                    </div>
                </section>

                <section className="me-section">
                    <div className="me-section-head">
                        <h3 className="me-section-title">Logo</h3>
                        <p className="me-section-hint">Reemplaza el nombre Build &amp; Serve en la barra superior.</p>
                    </div>
                    <div className="me-section-body">
                        <input ref={fileRef} type="file" accept="image/*" hidden
                            onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ''; }} />
                        <button type="button"
                            className={`me-dropzone ${dragging ? 'dragging' : ''} ${logoPreview ? 'has-logo' : ''}`}
                            onClick={() => fileRef.current?.click()}
                            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                            onDragLeave={() => setDragging(false)}
                            onDrop={(e) => {
                                e.preventDefault(); setDragging(false);
                                const f = e.dataTransfer.files?.[0]; if (f) onFile(f);
                            }}>
                            {logoPreview ? (
                                <img src={logoPreview} alt="Logo de la empresa" />
                            ) : (
                                <span className="me-dropzone-empty">
                                    <FiImage size={20} aria-hidden="true" />
                                    <span className="me-dropzone-title">Arrastra tu logo o haz clic para subirlo</span>
                                    <span className="me-dropzone-sub">PNG, JPG, SVG o WebP · Máx. 2 MB</span>
                                </span>
                            )}
                        </button>
                        {logoPreview && (
                            <div className="me-logo-actions">
                                <button className="btn btn-secondary btn-sm" onClick={() => fileRef.current?.click()}>
                                    <FiUpload size={13} /> Cambiar logo
                                </button>
                                <button className="btn btn-ghost btn-sm" style={{ color: 'var(--danger-500)' }}
                                    onClick={() => { setLogoPreview(null); setLogoBase64(''); }}>
                                    <FiX size={13} /> Quitar
                                </button>
                            </div>
                        )}
                    </div>
                </section>

                <section className="me-section">
                    <div className="me-section-head">
                        <h3 className="me-section-title">Color principal</h3>
                        <p className="me-section-hint">Se aplica a los botones, enlaces y elementos activos de toda la plataforma.</p>
                    </div>
                    <div className="me-section-body">
                        <div className="me-color-row">
                            <button type="button" className="me-swatch" style={{ background: colorValido ? color : 'var(--surface-hover)' }}
                                onClick={() => document.getElementById('me-color-input')?.click()}
                                aria-label="Abrir el selector de color" />
                            <input id="me-color-input" type="color" className="me-color-native" tabIndex={-1}
                                value={colorValido ? color : DEFAULT_PRIMARY_COLOR} onChange={(e) => setColor(e.target.value)} />
                            <input className="form-input me-hex" value={color} maxLength={7} spellCheck={false}
                                aria-label="Código del color" onChange={(e) => setColor(e.target.value)} />
                        </div>

                        <div className="me-suggested">
                            <span className="me-field-hint">Colores sugeridos</span>
                            <div className="me-suggested-row">
                                {SUGGESTED_COLORS.map((s) => {
                                    const active = color.toLowerCase() === s.hex.toLowerCase();
                                    return (
                                        <button key={s.hex} type="button" title={s.label} aria-label={s.label}
                                            aria-pressed={active}
                                            className={`me-suggested-dot ${active ? 'active' : ''}`}
                                            style={{ background: s.hex }}
                                            onClick={() => setColor(s.hex)}>
                                            {active && <FiCheck size={13} aria-hidden="true" />}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    </div>
                </section>
            </div>

            <aside className="me-preview">
                <span className="me-preview-eyebrow">Vista previa</span>

                <div className="me-mock" aria-hidden="true">
                    <div className="me-mock-topbar" style={{ background: navy }}>
                        Cámara Chilena de la Construcción
                    </div>
                    <div className="me-mock-top">
                        {logoPreview
                            ? <img src={logoPreview} alt="" className="me-mock-logo" />
                            : <span className="me-mock-wordmark">Build<i>&amp;</i>Serve</span>}
                        <span className="me-mock-divider" />
                        <span className="me-mock-crumb">{nombre.trim() || 'Tu empresa'}</span>
                    </div>
                    <div className="me-mock-body">
                        <div className="me-mock-nav">
                            <span className="me-mock-nav-item active"
                                style={{ background: tint, borderColor: colorValido ? color : 'var(--surface-border)' }}>Obras</span>
                            <span className="me-mock-nav-item">Personas</span>
                            <span className="me-mock-nav-item">Documentos</span>
                        </div>
                        <div className="me-mock-lines">
                            <span /><span /><span />
                        </div>
                        <div className="me-mock-actions">
                            <span className="me-mock-btn" style={{ background: colorValido ? color : 'var(--surface-hover)' }}>
                                Guardar
                            </span>
                            <span className="me-mock-link" style={{ color: colorValido ? color : 'var(--text-muted)' }}>
                                Ver detalle
                            </span>
                        </div>
                    </div>
                </div>

                {ratio != null && (
                    <div className={`me-contrast ${contrasteOk ? 'ok' : 'warn'}`}>
                        <span className="me-contrast-dot" />
                        <div>
                            <strong>{contrasteOk ? 'Buen contraste' : 'Contraste bajo'}</strong>
                            <p>{contrasteOk
                                ? 'El texto blanco de los botones se lee sin esfuerzo sobre este color.'
                                : 'El texto blanco de los botones cuesta de leer. Prueba un tono más oscuro.'}</p>
                        </div>
                    </div>
                )}
            </aside>

            <div className="me-save-bar">
                {err && <AlertBanner variant="error" message={err} onDismiss={() => setErr('')} />}
                <div className="me-save-actions">
                    {dirty && !saving && <span className="me-field-hint">Tienes cambios sin guardar.</span>}
                    <button className="btn btn-primary" disabled={!dirty || saving} onClick={save}>
                        {saving ? <div className="spinner" /> : <><FiSave /> Guardar identidad</>}
                    </button>
                </div>
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

    // Marca o quita de una vez todos los permisos de un módulo.
    const setGroupPerms = (id: string, keys: string[], on: boolean) =>
        setRoles((p) => p.map((r) => {
            if (r._id !== id || r.locked) return r;
            const resto = r.permisos.filter((k) => !keys.includes(k));
            return { ...r, permisos: on ? [...resto, ...keys] : resto };
        }));

    // Solo cuentan las claves vigentes: un rol puede arrastrar permisos retirados.
    const activos = (r: RoleDraft) => ALL_PERMISSION_KEYS.filter((k) => r.permisos.includes(k)).length;

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
                    puedes renombrarlos y ajustar sus permisos, pero no eliminarlos. Al eliminar un rol con
                    personas asignadas, se te pedirá reasignarlas antes.
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

                            {r.locked ? (
                                <div className="me-perms-total">
                                    <FiLock size={14} aria-hidden="true" />
                                    <div>
                                        <strong>Acceso total</strong>
                                        <p>
                                            El administrador entra a todos los módulos de la plataforma.
                                            Sus permisos no se editan.
                                        </p>
                                    </div>
                                </div>
                            ) : (
                                <>
                                    <div className="me-perms-head">
                                        <span>Permisos</span>
                                        <span className="me-perms-tally">
                                            {activos(r)} de {ALL_PERMISSION_KEYS.length}
                                        </span>
                                    </div>
                                    <div className="me-perms-groups">
                                        {PERMISSION_GROUPS.map((g) => {
                                            const keys = g.permisos.map((p) => p.key);
                                            const marcados = keys.filter((k) => r.permisos.includes(k)).length;
                                            const todos = marcados === keys.length;
                                            return (
                                                <div key={g.grupo} className={`me-mod${marcados ? '' : ' vacio'}`}>
                                                    <div className="me-mod-head">
                                                        <span className="me-mod-name">{g.grupo}</span>
                                                        <button type="button" className="me-mod-all"
                                                            onClick={() => setGroupPerms(r._id, keys, !todos)}>
                                                            {todos ? 'Quitar todo' : 'Marcar todo'}
                                                        </button>
                                                        <span className="me-mod-tally">{marcados}/{keys.length}</span>
                                                    </div>
                                                    <div className="me-mod-chips">
                                                        {g.permisos.map((perm) => (
                                                            <label key={perm.key} className="me-chip" title={perm.nota}>
                                                                <input type="checkbox"
                                                                    checked={r.permisos.includes(perm.key)}
                                                                    onChange={() => togglePerm(r._id, perm.key)} />
                                                                <span>{perm.label}</span>
                                                            </label>
                                                        ))}
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </>
                            )}
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

// ── Catálogo de EPP (DS44 Art. 13) ────────────────────────────────────────────
// Cada elemento exige dos respaldos obligatorios: el certificado (de calidad o
// registro ISP) y el instructivo de uso/mantención/reposición. Un elemento
// incompleto se puede entregar igual, pero queda marcado en todas las pantallas.
interface EppDraft {
    nombre: string;
    descripcion: string;
    certificado: EppAdjunto | null;
    certificadoTipo: CertificadoTipo;
    instructivo: EppAdjunto | null;
}

const emptyEppDraft: EppDraft = {
    nombre: '',
    descripcion: '',
    certificado: null,
    certificadoTipo: 'certificado_calidad',
    instructivo: null,
};

function EppTab({ tenantId, toast }: {
    tenantId: string;
    toast: ReturnType<typeof useToast>['toast'];
}) {
    const [items, setItems] = useState<EppElemento[]>([]);
    const [loading, setLoading] = useState(true);
    const [err, setErr] = useState('');
    const [search, setSearch] = useState('');
    const [modalOpen, setModalOpen] = useState(false);
    const [editing, setEditing] = useState<EppElemento | null>(null);
    const [draft, setDraft] = useState<EppDraft>(emptyEppDraft);
    const [saving, setSaving] = useState(false);
    const [borrar, setBorrar] = useState<EppElemento | null>(null);
    const [preview, setPreview] = useState<{ url: string | null; name: string } | null>(null);

    // Vista previa dentro de la misma página: se abre el modal en estado de
    // carga mientras se resuelve la URL presignada del respaldo.
    const verDocumento = async (adjunto: EppAdjunto) => {
        setPreview({ url: null, name: adjunto.nombre });
        try {
            const res = await uploadsApi.getDownloadUrl(adjunto.fileKey);
            if (res.success && res.data) {
                setPreview((prev) => prev ? { ...prev, url: res.data!.downloadUrl } : prev);
            } else {
                toast.error('No se pudo abrir la vista previa');
                setPreview(null);
            }
        } catch {
            toast.error('No se pudo abrir la vista previa');
            setPreview(null);
        }
    };

    useEffect(() => {
        let alive = true;
        eppApi.list(tenantId)
            .then((res) => {
                if (!alive) return;
                if (res.success && res.data) setItems(res.data.epp);
                else setErr(res.error || 'No se pudo cargar el catálogo de EPP.');
            })
            .catch(() => alive && setErr('Error de conexión al cargar el catálogo de EPP.'))
            .finally(() => alive && setLoading(false));
        return () => { alive = false; };
    }, [tenantId]);

    const incompletos = items.filter((e) => !e.completo).length;

    const filtrados = items.filter((e) => {
        if (!search.trim()) return true;
        const q = search.toLowerCase();
        return e.nombre.toLowerCase().includes(q) || (e.descripcion || '').toLowerCase().includes(q);
    });

    const abrirNuevo = () => {
        setEditing(null);
        setDraft(emptyEppDraft);
        setErr('');
        setModalOpen(true);
    };

    const abrirEdicion = (e: EppElemento) => {
        setEditing(e);
        setDraft({
            nombre: e.nombre,
            descripcion: e.descripcion || '',
            certificado: e.certificado,
            certificadoTipo: e.certificadoTipo || 'certificado_calidad',
            instructivo: e.instructivo,
        });
        setErr('');
        setModalOpen(true);
    };

    const guardar = async () => {
        if (!draft.nombre.trim()) { setErr('El nombre del elemento es obligatorio.'); return; }
        setSaving(true); setErr('');
        try {
            const payload = {
                nombre: draft.nombre.trim(),
                descripcion: draft.descripcion.trim() || null,
                certificado: draft.certificado,
                certificadoTipo: draft.certificado ? draft.certificadoTipo : null,
                instructivo: draft.instructivo,
            };
            const res = editing
                ? await eppApi.update(tenantId, editing.eppId, payload)
                : await eppApi.create(tenantId, payload);
            if (!res.success || !res.data) { setErr(res.error || 'No se pudo guardar el elemento.'); return; }
            const guardado = res.data.epp;
            setItems((prev) => editing
                ? prev.map((e) => e.eppId === guardado.eppId ? guardado : e)
                : [...prev, guardado].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')));
            setModalOpen(false);
            toast.success(editing ? 'Elemento actualizado.' : 'Elemento agregado al catálogo.');
        } catch {
            setErr('Error de conexión al guardar.');
        } finally {
            setSaving(false);
        }
    };

    const eliminar = async () => {
        if (!borrar) return;
        setSaving(true);
        try {
            const res = await eppApi.remove(tenantId, borrar.eppId);
            if (!res.success) { toast.error(res.error || 'No se pudo eliminar el elemento.'); return; }
            setItems((prev) => prev.filter((e) => e.eppId !== borrar.eppId));
            toast.success(`"${borrar.nombre}" eliminado del catálogo.`);
            setBorrar(null);
        } catch {
            toast.error('Error de conexión al eliminar.');
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return <div style={{ padding: 32, display: 'flex', justifyContent: 'center' }}><div className="spinner" /></div>;
    }

    return (
        <div className="epp-tab">
            {err && !modalOpen && <AlertBanner variant="error" message={err} onDismiss={() => setErr('')} />}

            {incompletos > 0 && (
                <div className="epp-alerta">
                    <FiAlertTriangle size={16} aria-hidden="true" />
                    <div>
                        <strong>{incompletos} elemento{incompletos === 1 ? '' : 's'} sin respaldo completo</strong>
                        <p>
                            El DS44 exige el certificado de calidad o registro ISP y el instructivo de uso y
                            mantención de cada EPP. Se pueden entregar igual, pero la falta queda registrada.
                        </p>
                    </div>
                </div>
            )}

            <div className="epp-toolbar">
                <div className="epp-search">
                    <FiTag size={15} aria-hidden="true" />
                    <input
                        type="search"
                        placeholder="Buscar elemento…"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                    />
                </div>
                <span className="epp-count">{items.length} elemento{items.length === 1 ? '' : 's'}</span>
                <button className="btn btn-primary btn-sm" onClick={abrirNuevo}>
                    <FiPlus size={14} /> Nuevo elemento
                </button>
            </div>

            {items.length === 0 ? (
                <div className="epp-empty">
                    <span className="epp-empty-icon"><LuHardHat size={22} /></span>
                    <h3>Todavía no hay elementos de EPP</h3>
                    <p>
                        Agrega los cascos, guantes, arneses y demás elementos que entrega tu empresa.
                        Al registrarlos acá, quien haga una entrega los elige de la lista en vez de escribirlos.
                    </p>
                    <button className="btn btn-primary" onClick={abrirNuevo}>
                        <FiPlus /> Agregar el primero
                    </button>
                </div>
            ) : filtrados.length === 0 ? (
                <p className="epp-sin-resultados">Ningún elemento coincide con «{search}».</p>
            ) : (
                <ul className="epp-grid">
                    {filtrados.map((e, i) => (
                        <li key={e.eppId} className="epp-tile" style={{ animationDelay: `${Math.min(i * 20, 400)}ms` }}>
                            <div className="epp-tile-top">
                                <span className="epp-tile-icon"><LuHardHat size={16} aria-hidden="true" /></span>
                                <div className="epp-tile-menu">
                                    <button type="button" aria-label={`Editar ${e.nombre}`} title="Editar"
                                        onClick={() => abrirEdicion(e)}>
                                        <FiEdit3 size={13} />
                                    </button>
                                    <button type="button" className="danger" aria-label={`Eliminar ${e.nombre}`} title="Eliminar"
                                        onClick={() => setBorrar(e)}>
                                        <FiTrash2 size={13} />
                                    </button>
                                </div>
                            </div>

                            <div className="epp-tile-body">
                                <h4 className="epp-tile-name" title={e.nombre}>{e.nombre}</h4>
                                {e.descripcion && <p className="epp-tile-desc" title={e.descripcion}>{e.descripcion}</p>}
                            </div>

                            <div className="epp-tile-docs">
                                <EppDocChip
                                    label="Certificado de calidad o registro ISP"
                                    title={e.certificado && e.certificadoTipo ? CERTIFICADO_TIPO_LABEL[e.certificadoTipo] : 'Certificado o registro ISP'}
                                    adjunto={e.certificado}
                                    onView={verDocumento}
                                    onMissingClick={() => abrirEdicion(e)}
                                />
                                <EppDocChip
                                    label="Instructivo de uso y mantención"
                                    title="Instructivo de uso y mantención"
                                    adjunto={e.instructivo}
                                    onView={verDocumento}
                                    onMissingClick={() => abrirEdicion(e)}
                                />
                            </div>
                        </li>
                    ))}
                </ul>
            )}

            {/* Alta / edición */}
            <Modal
                isOpen={modalOpen}
                onClose={() => !saving && setModalOpen(false)}
                preventClose={saving}
                title={editing ? 'Editar elemento de EPP' : 'Nuevo elemento de EPP'}
                subtitle={editing ? editing.nombre : 'Quedará disponible para todas las entregas de la empresa.'}
                icon={<LuHardHat size={20} />}
                size="lg"
                footer={
                    <>
                        <button className="btn btn-secondary" disabled={saving} onClick={() => setModalOpen(false)}>
                            Cancelar
                        </button>
                        <button className="btn btn-primary" disabled={saving} onClick={guardar}>
                            {saving ? 'Guardando…' : <><FiSave size={14} /> Guardar elemento</>}
                        </button>
                    </>
                }
            >
                <div className="epp-form">
                    {err && <AlertBanner variant="error" message={err} onDismiss={() => setErr('')} />}

                    <div className="form-group">
                        <label className="form-label" htmlFor="epp-nombre">Nombre del elemento *</label>
                        <input id="epp-nombre" className="form-input" value={draft.nombre} maxLength={120}
                            placeholder="Ej: Casco de seguridad clase B"
                            onChange={(e) => setDraft({ ...draft, nombre: e.target.value })} />
                    </div>

                    <div className="form-group">
                        <label className="form-label" htmlFor="epp-desc">Descripción</label>
                        <input id="epp-desc" className="form-input" value={draft.descripcion}
                            placeholder="Marca, modelo o norma que cumple (opcional)"
                            onChange={(e) => setDraft({ ...draft, descripcion: e.target.value })} />
                    </div>

                    <div className="epp-form-docs">
                        <h4 className="epp-form-title">Respaldos obligatorios (DS44)</h4>
                        <p className="epp-form-hint">
                            Puedes guardar el elemento sin ellos, pero quedará marcado como incompleto
                            en el catálogo y en cada entrega que lo incluya.
                        </p>

                        <EppUploader
                            titulo="Certificado de calidad o registro ISP"
                            tenantId={tenantId}
                            adjunto={draft.certificado}
                            onChange={(certificado) => setDraft({ ...draft, certificado })}
                            onError={setErr}
                            onView={verDocumento}
                            extra={draft.certificado ? (
                                <div className="epp-tipo">
                                    <label className="form-label" htmlFor="epp-tipo-cert">Este documento es</label>
                                    <Select
                                        ariaLabel="Tipo de documento de certificación"
                                        value={draft.certificadoTipo}
                                        onChange={(v) => setDraft({ ...draft, certificadoTipo: v as CertificadoTipo })}
                                        options={[
                                            { value: 'certificado_calidad', label: CERTIFICADO_TIPO_LABEL.certificado_calidad },
                                            { value: 'registro_isp', label: CERTIFICADO_TIPO_LABEL.registro_isp },
                                        ]}
                                    />
                                </div>
                            ) : undefined}
                        />

                        <EppUploader
                            titulo="Instructivo de uso y mantención"
                            ayuda="Uso, mantenimiento, reposición o recambio del elemento."
                            tenantId={tenantId}
                            adjunto={draft.instructivo}
                            onChange={(instructivo) => setDraft({ ...draft, instructivo })}
                            onError={setErr}
                            onView={verDocumento}
                        />
                    </div>
                </div>
            </Modal>

            {/* Confirmación de borrado */}
            <Modal
                isOpen={!!borrar}
                onClose={() => !saving && setBorrar(null)}
                title="Eliminar elemento del catálogo"
                subtitle={borrar?.nombre}
                icon={<FiAlertTriangle size={20} />}
                footer={
                    <>
                        <button className="btn btn-secondary" disabled={saving} onClick={() => setBorrar(null)}>Cancelar</button>
                        <button className="btn btn-danger" disabled={saving} onClick={eliminar}>
                            {saving ? 'Eliminando…' : <><FiTrash2 size={14} /> Eliminar</>}
                        </button>
                    </>
                }
            >
                <p className="epp-borrar-texto">
                    Dejará de estar disponible para nuevas entregas. Las entregas ya registradas
                    conservan el elemento tal como se entregó.
                </p>
            </Modal>

            {/* Vista previa de un respaldo, dentro de la misma página */}
            <DocumentPreviewModal
                isOpen={!!preview}
                onClose={() => setPreview(null)}
                url={preview?.url ?? null}
                fileName={preview?.name}
                onDownload={preview?.url ? () => window.open(preview.url as string, '_blank', 'noopener') : undefined}
            />
        </div>
    );
}

/**
 * Acceso compacto a un respaldo dentro de la tarjeta de cuadrícula: un chip
 * ícono + etiqueta. Presente → abre la vista previa. Faltante → lleva a
 * editar el elemento para cargarlo (sin bloques de color, solo trazo discontinuo).
 */
function EppDocChip({ label, title, adjunto, onView, onMissingClick }: {
    label: string;
    title: string;
    adjunto: EppAdjunto | null;
    onView: (a: EppAdjunto) => void;
    onMissingClick: () => void;
}) {
    if (!adjunto) {
        return (
            <button type="button" className="epp-tile-doc missing" onClick={onMissingClick}
                title={`${title}: sin cargar — clic para agregarlo`}>
                <FiPlus size={13} aria-hidden="true" />
                <span>{label}</span>
            </button>
        );
    }
    return (
        <button type="button" className="epp-tile-doc" onClick={() => onView(adjunto)}
            title={`Ver ${title.toLowerCase()}: ${adjunto.nombre}`}>
            <FiEye size={13} aria-hidden="true" />
            <span>{label}</span>
        </button>
    );
}

/** Slot de subida de un respaldo, con vista previa y reemplazo. */
function EppUploader({ titulo, ayuda, tenantId, adjunto, onChange, onError, onView, extra }: {
    titulo: string;
    ayuda?: string;
    tenantId: string;
    adjunto: EppAdjunto | null;
    onChange: (a: EppAdjunto | null) => void;
    onError: (msg: string) => void;
    onView: (a: EppAdjunto) => void;
    extra?: React.ReactNode;
}) {
    const inputRef = useRef<HTMLInputElement>(null);
    const [subiendo, setSubiendo] = useState(false);

    const subir = async (file: File) => {
        setSubiendo(true);
        try {
            const res = await uploadsApi.uploadFile(file, 'epp', tenantId, tenantId);
            if (!res.success || !res.data) { onError(res.error || 'No se pudo subir el archivo.'); return; }
            // `url` de DocumentoAdjunto es la key de S3, no una URL navegable.
            const d = res.data;
            onChange({
                fileKey: d.url,
                nombre: d.nombre || file.name,
                tipo: d.tipo || file.type,
                subidoEn: d.subidoEn || new Date().toISOString(),
            });
        } catch {
            onError('Error de conexión al subir el archivo.');
        } finally {
            setSubiendo(false);
        }
    };

    return (
        <div className={`epp-slot${adjunto ? ' cargado' : ''}`}>
            <div className="epp-slot-head">
                <span className="epp-slot-title">
                    {adjunto
                        ? <FiCheck size={14} className="epp-slot-ok" aria-hidden="true" />
                        : <FiAlertTriangle size={14} className="epp-slot-falta" aria-hidden="true" />}
                    {titulo}
                </span>
                {!adjunto && <span className="epp-slot-flag">Falta</span>}
            </div>
            {ayuda && <p className="epp-slot-ayuda">{ayuda}</p>}

            <input ref={inputRef} type="file" hidden accept=".pdf,.png,.jpg,.jpeg,.doc,.docx,.xls,.xlsx"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) subir(f); e.target.value = ''; }} />

            {adjunto ? (
                <div className="epp-slot-file">
                    <span className="epp-slot-name"><FiFile size={13} aria-hidden="true" /> {adjunto.nombre}</span>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => onView(adjunto)}>
                        <FiEye size={13} /> Ver
                    </button>
                    <button type="button" className="btn btn-ghost btn-sm" disabled={subiendo}
                        onClick={() => inputRef.current?.click()}>
                        {subiendo ? 'Subiendo…' : <><FiUpload size={13} /> Reemplazar</>}
                    </button>
                    <button type="button" className="btn btn-ghost btn-sm" style={{ color: 'var(--danger-500)' }}
                        aria-label={`Quitar ${titulo}`} onClick={() => onChange(null)}>
                        <FiX size={13} />
                    </button>
                </div>
            ) : (
                <button type="button" className="btn btn-secondary btn-sm" disabled={subiendo}
                    onClick={() => inputRef.current?.click()}>
                    {subiendo ? 'Subiendo…' : <><FiUpload size={13} /> Subir documento</>}
                </button>
            )}

            {extra}
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

/* ── Identidad ─────────────────────────────────────────────────────────────── */
.me-identity { display: grid; grid-template-columns: minmax(0, 1fr) 320px; gap: var(--space-4); align-items: start; }

.me-identity-form {
    background: var(--surface-card); border: 1px solid var(--surface-border);
    border-radius: var(--radius-lg); overflow: hidden;
}
.me-section { display: grid; grid-template-columns: 210px minmax(0, 1fr); gap: var(--space-6); padding: var(--space-5) var(--space-6); border-bottom: 1px solid var(--surface-border); }
.me-section:last-child { border-bottom: none; }
.me-section-title { font-size: var(--text-sm); font-weight: 600; margin: 0 0 4px; color: var(--text-primary); }
.me-section-hint { font-size: var(--text-xs); line-height: 1.5; color: var(--text-muted); margin: 0; }
.me-section-body > .form-group:last-child { margin-bottom: 0; }

.me-field-locked { position: relative; }
.me-field-locked .form-input { padding-right: 34px; }
.me-field-locked svg { position: absolute; right: 12px; top: 50%; transform: translateY(-50%); color: var(--text-muted); pointer-events: none; }
.me-field-hint { display: block; font-size: var(--text-xs); color: var(--text-muted); margin-top: 6px; }

/* Logo */
.me-dropzone {
    width: 100%; min-height: 116px; padding: var(--space-4);
    display: flex; align-items: center; justify-content: center;
    border: 1px dashed var(--surface-border); border-radius: var(--radius-md);
    background: var(--surface-elevated); cursor: pointer;
    transition: border-color var(--transition-fast), background var(--transition-fast);
}
.me-dropzone:hover, .me-dropzone.dragging { border-color: var(--primary-500); background: var(--cchc-blue-tint, var(--surface-hover)); }
.me-dropzone.has-logo { border-style: solid; background: var(--surface-card); }
.me-dropzone img { max-width: 100%; max-height: 84px; object-fit: contain; }
.me-dropzone-empty { display: flex; flex-direction: column; align-items: center; gap: 6px; color: var(--text-muted); text-align: center; }
.me-dropzone-title { font-size: var(--text-sm); font-weight: 500; color: var(--text-secondary); }
.me-dropzone-sub { font-size: var(--text-xs); }
.me-logo-actions { display: flex; align-items: center; gap: var(--space-2); margin-top: var(--space-3); }

/* Color */
.me-color-row { display: flex; align-items: center; gap: var(--space-3); }
.me-swatch { width: 42px; height: 42px; flex-shrink: 0; border-radius: var(--radius-md); border: 1px solid var(--surface-border); cursor: pointer; box-shadow: inset 0 0 0 1px rgb(0 0 0 / 0.06); }
.me-color-native { width: 0; height: 0; opacity: 0; position: absolute; pointer-events: none; }
.me-hex { max-width: 130px; font-family: var(--font-mono); text-transform: lowercase; }

.me-suggested { margin-top: var(--space-4); }
.me-suggested-row { display: flex; flex-wrap: wrap; gap: var(--space-2); margin-top: 6px; }
.me-suggested-dot {
    width: 28px; height: 28px; padding: 0; border-radius: 50%; cursor: pointer;
    border: 1px solid rgb(0 0 0 / 0.12); color: #fff;
    display: flex; align-items: center; justify-content: center;
    transition: transform var(--transition-fast), box-shadow var(--transition-fast);
}
.me-suggested-dot:hover { transform: scale(1.12); }
.me-suggested-dot.active { box-shadow: 0 0 0 2px var(--surface-card), 0 0 0 4px var(--text-primary); }

/* Vista previa de la identidad */
.me-preview {
    background: var(--surface-card); border: 1px solid var(--surface-border);
    border-radius: var(--radius-lg); padding: var(--space-4);
    display: flex; flex-direction: column; gap: var(--space-3);
}
.me-preview-eyebrow { font-size: 10.5px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: var(--text-muted); }
.me-mock { border: 1px solid var(--surface-border); border-radius: var(--radius-md); overflow: hidden; }
.me-mock-topbar {
    height: 20px; display: flex; align-items: center; padding: 0 10px;
    font-size: 7.5px; font-weight: 500; letter-spacing: 0.14em; text-transform: uppercase;
    color: rgba(255, 255, 255, 0.92); white-space: nowrap; overflow: hidden;
}
.me-mock-top { display: flex; align-items: center; gap: var(--space-2); padding: 10px 12px; background: var(--surface-card); border-bottom: 1px solid var(--surface-border); }
.me-mock-logo { max-height: 18px; max-width: 90px; object-fit: contain; }
.me-mock-wordmark { font-size: 12px; font-weight: 700; color: var(--text-primary); white-space: nowrap; }
.me-mock-wordmark i { font-style: normal; color: var(--text-muted); margin: 0 1px; }
.me-mock-divider { width: 1px; height: 14px; background: var(--surface-border); }
.me-mock-crumb { font-size: 11px; color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.me-mock-body { padding: 12px; background: var(--surface-bg); display: flex; flex-direction: column; gap: 12px; }
.me-mock-nav { display: flex; gap: 6px; }
.me-mock-nav-item { font-size: 10.5px; color: var(--text-muted); padding: 4px 8px; border-radius: var(--radius-sm); border: 1px solid transparent; }
.me-mock-nav-item.active { color: var(--text-primary); font-weight: 600; border-left-width: 2px; border-left-style: solid; }
.me-mock-lines { display: flex; flex-direction: column; gap: 6px; }
.me-mock-lines span { height: 6px; border-radius: 3px; background: var(--surface-hover); }
.me-mock-lines span:nth-child(2) { width: 78%; }
.me-mock-lines span:nth-child(3) { width: 52%; }
.me-mock-actions { display: flex; align-items: center; gap: 10px; }
.me-mock-btn { font-size: 11px; font-weight: 600; color: #fff; padding: 6px 12px; border-radius: var(--radius-sm); }
.me-mock-link { font-size: 11px; font-weight: 500; }

.me-contrast { display: flex; align-items: flex-start; gap: var(--space-2); padding: 10px 12px; border-radius: var(--radius-md); background: var(--surface-elevated); }
.me-contrast strong { display: block; font-size: var(--text-xs); font-weight: 600; }
.me-contrast p { margin: 2px 0 0; font-size: var(--text-xs); line-height: 1.45; color: var(--text-muted); }
.me-contrast-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; margin-top: 5px; }
.me-contrast.ok strong { color: var(--success-600); }
.me-contrast.ok .me-contrast-dot { background: var(--success-500); }
.me-contrast.warn strong { color: var(--warning-600); }
.me-contrast.warn .me-contrast-dot { background: var(--warning-500); }

.me-save-bar { grid-column: 1 / -1; display: flex; flex-direction: column; gap: var(--space-3); align-items: flex-end; }
.me-save-bar .alert-banner { width: 100%; }
.me-save-actions { display: flex; align-items: center; gap: var(--space-3); }
.me-save-actions .me-field-hint { margin-top: 0; }

@media (max-width: 1080px) {
  .me-identity { grid-template-columns: minmax(0, 1fr); }
}
@media (max-width: 720px) {
  .me-section { grid-template-columns: minmax(0, 1fr); gap: var(--space-3); padding: var(--space-4); }
}

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

/* ── Permisos: un módulo por celda, cada permiso es un chip conmutable ──────
   El chip sustituye a la lista de casillas: ocupa ~3 veces menos alto, deja
   todo el alcance del rol visible de un vistazo y el único color en juego es
   el de la marca (activo) frente al trazo neutro (inactivo). */
.me-perms-head {
    display: flex; align-items: baseline; justify-content: space-between; gap: 8px;
    margin: 4px 0 10px; padding-top: 12px; border-top: 1px solid var(--surface-border);
    font-size: var(--text-xs); font-weight: 700; letter-spacing: .04em; text-transform: uppercase; color: var(--text-muted);
}
.me-perms-tally { font-weight: 600; letter-spacing: 0; text-transform: none; font-variant-numeric: tabular-nums; }

/* Rol Administrador: no hay nada que decidir, así que no se dibujan controles. */
.me-perms-total {
    display: flex; align-items: flex-start; gap: 10px;
    margin-top: 12px; padding: 12px 14px; border-radius: var(--radius-md);
    background: var(--surface-elevated); border: 1px solid var(--surface-border); color: var(--text-muted);
}
.me-perms-total strong { display: block; font-size: var(--text-sm); color: var(--text-primary); }
.me-perms-total p { margin: 2px 0 0; font-size: var(--text-xs); line-height: 1.55; }

/* Columnas en vez de grilla: los módulos tienen 1 y 8 permisos, y una grilla
   estira cada celda a la altura de la más alta — cajas medio vacías. El
   empaquetado por columnas las deja del alto de su contenido. */
.me-perms-groups { columns: 248px; column-gap: 10px; }
.me-mod {
    display: flex; flex-direction: column; gap: 8px;
    padding: 10px 12px 12px; margin-bottom: 10px; border-radius: var(--radius-md);
    background: var(--surface-elevated); border: 1px solid var(--surface-border);
    break-inside: avoid;
}
/* Un módulo sin permisos marcados se lee, pero no compite por la atención. */
.me-mod.vacio { background: transparent; }
.me-mod.vacio .me-mod-name { font-weight: 500; color: var(--text-muted); }
.me-mod-head { display: flex; align-items: baseline; gap: 8px; }
.me-mod-name { flex: 1; min-width: 0; font-size: var(--text-sm); font-weight: 600; color: var(--text-primary); }
.me-mod-tally { font-size: 11px; font-weight: 600; color: var(--text-muted); font-variant-numeric: tabular-nums; }
.me-mod-all {
    border: none; background: none; padding: 0; cursor: pointer; font-family: inherit;
    font-size: 11px; font-weight: 600; color: var(--accent-text);
    opacity: 0; transition: opacity var(--transition-fast);
}
.me-mod:hover .me-mod-all, .me-mod:focus-within .me-mod-all { opacity: 1; }
.me-mod-all:focus-visible { opacity: 1; outline: 2px solid var(--primary-400); outline-offset: 2px; border-radius: 3px; }

.me-mod-chips { display: flex; flex-wrap: wrap; gap: 5px; }
.me-chip { display: inline-flex; cursor: pointer; }
.me-chip input { position: absolute; width: 1px; height: 1px; opacity: 0; margin: 0; }
.me-chip span {
    display: inline-block; padding: 4px 9px; border-radius: var(--radius-full);
    border: 1px solid var(--surface-border); background: var(--surface-card);
    font-size: 11.5px; line-height: 1.35; color: var(--text-muted);
    transition: background var(--transition-fast), border-color var(--transition-fast), color var(--transition-fast);
}
.me-chip:hover span { border-color: var(--primary-400); color: var(--text-primary); }
.me-chip input:checked + span {
    background: var(--accent-tint); border-color: transparent; color: var(--accent-text); font-weight: 600;
}
.me-chip input:focus-visible + span { outline: 2px solid var(--primary-400); outline-offset: 2px; }

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

/* ── Catálogo de EPP ─────────────────────────────────────────────────────── */
.epp-tab { display: flex; flex-direction: column; gap: var(--space-4); }

/* Aviso de incumplimiento DS44: ámbar, no rojo — se puede operar igual */
.epp-alerta {
    display: flex; align-items: flex-start; gap: var(--space-3);
    padding: 12px 14px; border-radius: var(--radius-md);
    background: rgba(234, 179, 8, 0.1); border: 1px solid rgba(234, 179, 8, 0.28);
    color: var(--warning-600, var(--warning-500));
}
.epp-alerta strong { display: block; font-size: var(--text-sm); }
.epp-alerta p { margin: 3px 0 0; font-size: var(--text-xs); line-height: 1.55; color: var(--text-secondary); }

.epp-toolbar { display: flex; align-items: center; gap: var(--space-3); flex-wrap: wrap; }
.epp-search { position: relative; display: flex; align-items: center; flex: 1 1 220px; max-width: 340px; }
.epp-search > svg { position: absolute; left: 12px; color: var(--text-muted); pointer-events: none; }
.epp-search input {
    width: 100%; padding: 9px 12px 9px 36px;
    border: 1px solid var(--surface-border); border-radius: var(--radius-md);
    background: var(--surface-card); color: var(--text-primary); font-size: 0.88rem;
}
.epp-search input:focus { outline: none; border-color: var(--primary-400); box-shadow: 0 0 0 3px var(--accent-tint); }
.epp-count { font-size: var(--text-xs); color: var(--text-muted); margin-right: auto; }

/* Cuadrícula de elementos: cada EPP es una tarjeta compacta y autocontenida.
   Sin franjas ni fondos de color — solo el ícono y los estados hover/foco
   usan el color de marca; lo demás es tipografía y trazo neutro. */
/* Misma cuadrícula, tamaño de tarjeta y hover que /personas (pdir-grid/pdir-card),
   para que ambas pantallas se sientan parte de la misma interfaz. */
.epp-grid {
    list-style: none; margin: 0; padding: var(--space-2) 0 0;
    display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px;
}
.epp-tile {
    display: flex; flex-direction: column; gap: 12px;
    padding: 16px; background: var(--surface-card); border: 1px solid var(--surface-border);
    border-radius: 12px;
    transition: transform 0.18s ease, box-shadow 0.18s ease, border-color 0.18s;
    animation: eppTileIn 0.3s ease both;
}
@keyframes eppTileIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
.epp-tile:hover, .epp-tile:focus-within {
    transform: translateY(-3px);
    box-shadow: 0 8px 24px -4px rgba(0, 0, 0, 0.18);
    border-color: var(--primary-400);
}
@media (max-width: 900px) { .epp-grid { grid-template-columns: repeat(3, 1fr); } }
@media (max-width: 580px) { .epp-grid { grid-template-columns: repeat(2, 1fr); } }

.epp-tile-top { display: flex; align-items: flex-start; justify-content: space-between; gap: 4px; }
.epp-tile-icon {
    width: 32px; height: 32px; border-radius: 9px; flex-shrink: 0;
    display: flex; align-items: center; justify-content: center;
    background: var(--accent-tint); color: var(--primary-600);
}
.epp-tile-menu { display: flex; gap: 1px; opacity: .5; transition: opacity var(--transition-fast); }
.epp-tile:hover .epp-tile-menu, .epp-tile:focus-within .epp-tile-menu { opacity: 1; }
.epp-tile-menu button {
    width: 24px; height: 24px; display: flex; align-items: center; justify-content: center;
    border: none; background: none; color: var(--text-muted); border-radius: 6px; cursor: pointer;
}
.epp-tile-menu button:hover { background: var(--surface-hover); color: var(--text-primary); }
.epp-tile-menu button.danger:hover { color: var(--danger-500); }

.epp-tile-body { display: flex; flex-direction: column; gap: 3px; }
.epp-tile-name {
    margin: 0; font-size: var(--text-sm); font-weight: 600; color: var(--text-primary); line-height: 1.3;
    display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}
.epp-tile-desc {
    margin: 0; font-size: var(--text-xs); color: var(--text-muted); line-height: 1.4;
    display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}

/* Accesos a los respaldos: fila ícono + etiqueta completa, sin nombre de archivo en pantalla */
.epp-tile-docs { display: flex; flex-direction: column; gap: 6px; margin-top: auto; }
.epp-tile-doc {
    display: flex; align-items: center; gap: 8px; text-align: left;
    padding: 8px 9px; border-radius: var(--radius-md);
    border: 1px solid var(--surface-border); background: var(--surface-elevated);
    color: var(--text-secondary); font-size: 11.5px; font-weight: 500; line-height: 1.3; font-family: inherit;
    cursor: pointer; transition: all var(--transition-fast);
}
.epp-tile-doc svg { flex-shrink: 0; }
.epp-tile-doc:hover { border-color: var(--primary-400); color: var(--primary-600); background: var(--accent-tint); }
.epp-tile-doc:focus-visible { outline: 2px solid var(--primary-500, var(--primary-600)); outline-offset: 1px; }
.epp-tile-doc.missing { color: var(--text-muted); border-style: dashed; }
.epp-tile-doc.missing:hover { border-color: var(--text-muted); color: var(--text-secondary); background: var(--surface-elevated); }

.epp-empty { text-align: center; padding: var(--space-10) var(--space-6); }
.epp-empty-icon {
    width: 44px; height: 44px; border-radius: var(--radius-lg);
    background: var(--surface-hover); color: var(--text-muted);
    display: inline-flex; align-items: center; justify-content: center; margin-bottom: var(--space-3);
}
.epp-empty h3 { font-size: var(--text-base); font-weight: 600; margin: 0 0 4px; }
.epp-empty p { font-size: var(--text-sm); color: var(--text-muted); margin: 0 auto var(--space-5); max-width: 420px; line-height: 1.55; }
.epp-sin-resultados { font-size: var(--text-sm); color: var(--text-muted); padding: var(--space-4) 0; margin: 0; }

/* Formulario */
.epp-form { display: flex; flex-direction: column; }
.epp-form-docs { display: flex; flex-direction: column; gap: var(--space-3); }
.epp-form-title { font-size: var(--text-sm); font-weight: 600; margin: 0; }
.epp-form-hint { font-size: var(--text-xs); color: var(--text-muted); margin: -6px 0 0; line-height: 1.55; }
.epp-slot {
    display: flex; flex-direction: column; gap: var(--space-2);
    padding: var(--space-4); border-radius: var(--radius-md);
    background: var(--surface-elevated); border: 1px solid var(--surface-border);
    border-left: 3px solid var(--warning-500);
}
.epp-slot.cargado { border-left-color: var(--success-500); }
.epp-slot-head { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); }
.epp-slot-title { display: inline-flex; align-items: center; gap: 7px; font-size: var(--text-sm); font-weight: 500; }
.epp-slot-ok { color: var(--success-500); }
.epp-slot-falta { color: var(--warning-500); }
.epp-slot-flag { font-size: 10px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: var(--warning-600, var(--warning-500)); }
.epp-slot-ayuda { font-size: var(--text-xs); color: var(--text-muted); margin: -4px 0 0; }
.epp-slot-file { display: flex; align-items: center; gap: var(--space-2); flex-wrap: wrap; }
.epp-slot-name {
    display: inline-flex; align-items: center; gap: 6px; min-width: 0; flex: 1;
    font-size: var(--text-xs); color: var(--text-secondary);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.epp-tipo { display: flex; flex-direction: column; gap: 4px; padding-top: var(--space-2); border-top: 1px solid var(--surface-border); }
.epp-tipo .form-label { margin-bottom: 0; }
.epp-borrar-texto { font-size: var(--text-sm); color: var(--text-secondary); line-height: 1.6; margin: 0; }

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
