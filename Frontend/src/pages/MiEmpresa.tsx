import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
    FiBriefcase, FiShield, FiTag, FiPlus, FiTrash2, FiSave, FiLock,
    FiUpload, FiX, FiInfo, FiUsers, FiAlertTriangle, FiChevronRight,
    FiCheck, FiImage, FiFile, FiEye, FiEdit3, FiHeart, FiSearch,
} from 'react-icons/fi';
import { LuHardHat } from 'react-icons/lu';
import {
    AlertBanner, Modal, Select, PageHeader, CollectionView,
    SgsstSkeleton, EstructuraPreventivaSkeleton, CompletitudFufSkeleton,
} from '../components/ui';
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
import EstructuraPreventivaPanel from '../components/EstructuraPreventivaPanel';
import CompletitudFufPanel from '../components/CompletitudFufPanel';
import SgsstPanel from '../components/SgsstPanel';
import OrganizacionesSindicales from '../components/OrganizacionesSindicales';
import SolicitudesTitularesPanel from '../components/gobernanza/SolicitudesTitularesPanel';
import { AMBITO } from '../utils/estructuraPreventiva';

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

type TabKey = 'identidad' | 'roles' | 'cargos' | 'epp' | 'salud' | 'datos';

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
        salud: hasPermission(PERMISSIONS.EMPRESA_FICHA_SALUD),
        datos: hasPermission(PERMISSIONS.EMPRESA_DERECHOS_TITULARES),
    };
    const tabs: { key: TabKey; label: string; icon: any }[] = [
        ...(can.identidad ? [{ key: 'identidad' as const, label: 'Identidad', icon: FiBriefcase }] : []),
        ...(can.roles ? [{ key: 'roles' as const, label: 'Roles y permisos', icon: FiShield }] : []),
        ...(can.cargos ? [{ key: 'cargos' as const, label: 'Cargos', icon: FiTag }] : []),
        ...(can.epp ? [{ key: 'epp' as const, label: 'EPP', icon: LuHardHat }] : []),
        ...(can.salud ? [{ key: 'salud' as const, label: 'Ficha de salud', icon: FiHeart }] : []),
        ...(can.datos ? [{ key: 'datos' as const, label: 'Datos personales', icon: FiLock }] : []),
    ];
    const [tab, setTab] = useState<TabKey>(tabs[0]?.key ?? 'identidad');
    // La acción principal de EPP vive en el encabezado; el modal, en la pestaña.
    const [eppNuevo, setEppNuevo] = useState(0);

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

    return (
        <div className="mi-empresa-page" style={{ padding: '0 24px 40px' }}>
            {/* Las secciones de la empresa son pestañas del encabezado, como en
                el resto de páginas con contenido alternable. */}
            <PageHeader
                banner
                title="Mi Empresa"
                description="Identidad, roles, cargos, elementos de protección y ficha de salud de la empresa."
                tabs={tabs.map((t) => {
                    const Icon = t.icon;
                    return { id: t.key, label: t.label, icon: <Icon size={15} /> };
                })}
                activeTab={tab}
                onTabChange={(id) => setTab(id as TabKey)}
                tabsLabel="Secciones de la empresa"
                actions={
                    tab === 'cargos' && can.cargos ? (
                        <Link to="/cargos-onboarding" className="btn btn-primary">
                            <FiUsers size={15} /> Onboarding por cargo
                        </Link>
                    ) : tab === 'epp' && can.epp ? (
                        <button className="btn btn-primary" onClick={() => setEppNuevo((n) => n + 1)}>
                            <FiPlus size={15} /> Nuevo elemento
                        </button>
                    ) : undefined
                }
            />

            {loadError && <AlertBanner variant="error" message={loadError} onDismiss={() => setLoadError('')} />}

            {/* Mientras llega la empresa, cada pestaña que depende de ella muestra su
                esqueleto. Cargos y EPP no la necesitan: arrancan su propia carga
                en paralelo y se encargan de su esqueleto. */}
            {loading && tab === 'identidad' && can.identidad && <IdentidadSkeleton />}
            {loading && tab === 'roles' && can.roles && <RolesSkeleton />}
            {loading && tab === 'salud' && can.salud && <FichaSaludSkeleton />}

            {!loading && tab === 'identidad' && can.identidad && tenant && (
                <IdentidadTab
                    tenant={tenant}
                    personas={personas}
                    onSaved={(t) => setTenant(t)}
                    brand={{ setLogo, setPrimaryColor }}
                    auth={{ user, updateUser }}
                    toast={toast}
                />
            )}
            {!loading && tab === 'roles' && can.roles && tenant && (
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
                    personasListas={!loading}
                    canEditKits={hasPermission(PERMISSIONS.CARGOS_GESTIONAR)}
                />
            )}
            {tab === 'epp' && can.epp && (
                <EppTab tenantId={tenantId} toast={toast} nuevo={eppNuevo} />
            )}
            {!loading && tab === 'salud' && can.salud && tenant && (
                <FichaSaludTab tenant={tenant} onSaved={(t) => setTenant(t)} toast={toast} />
            )}
            {tab === 'datos' && can.datos && <SolicitudesTitularesPanel />}

            <style>{styles}</style>
        </div>
    );
}

// ── Ficha de salud ────────────────────────────────────────────────────────────
//
// Encender la Ficha Básica de Salud es decidir que se recolectan datos de salud
// de todo el plantel, y la empresa tiene que poder demostrar que lo decidió. Por
// eso el registro no se edita desde acá: lo escribe el backend con la persona y
// la hora de la sesión, y aquí solo se muestra.
function FichaSaludTab({ tenant, onSaved, toast }: {
    tenant: Tenant;
    onSaved: (t: Tenant) => void;
    toast: ReturnType<typeof useToast>['toast'];
}) {
    const [pendiente, setPendiente] = useState<boolean | null>(null);
    const [saving, setSaving] = useState(false);
    const [err, setErr] = useState('');

    const habilitada = tenant.fichaSaludHabilitada === true;
    const historial = [...(tenant.fichaSaludHistorial || [])].reverse();

    const fecha = (iso: string) => new Date(iso).toLocaleString('es-CL', {
        timeZone: 'America/Santiago', dateStyle: 'long', timeStyle: 'short',
    });

    const aplicar = async () => {
        if (pendiente === null) return;
        setSaving(true);
        setErr('');
        try {
            const res = await tenantsApi.setFichaSalud(tenant.tenantId, pendiente);
            if (res.success && res.data) {
                onSaved(res.data.tenant);
                toast.success(pendiente ? 'Ficha Básica de Salud habilitada' : 'Ficha Básica de Salud deshabilitada');
                setPendiente(null);
            } else {
                setErr(res.error || 'No se pudo guardar el cambio.');
            }
        } catch {
            setErr('Error de conexión al guardar el cambio.');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="me-stack">
            {err && <AlertBanner variant="error" message={err} onDismiss={() => setErr('')} />}

            <section className="me-section">
                <div className="me-section-head">
                    <h3 className="me-section-title">Ficha Básica de Salud</h3>
                    <p className="me-section-hint">
                        Cuestionario de antecedentes de salud para cada persona de la empresa. Se
                        envía a todo el plantel y se mantiene al día con las altas nuevas.
                    </p>
                </div>
                <div className="me-fs-estado">
                    <span className={`me-pill ${habilitada ? 'ok' : ''}`}>
                        <span className="me-pill-dot" aria-hidden="true" />
                        {habilitada ? 'Habilitada' : 'Deshabilitada'}
                    </span>
                    <p className="me-fs-estado-texto">
                        {habilitada
                            ? 'Las personas de la empresa la reciben en Encuestas. Las respuestas se guardan cifradas.'
                            : 'No se recolectan datos de salud a través de esta ficha.'}
                    </p>
                    <button
                        className={`btn ${habilitada ? 'me-btn-alerta' : 'btn-primary'}`}
                        disabled={saving}
                        onClick={() => setPendiente(!habilitada)}
                    >
                        {habilitada ? 'Deshabilitar' : 'Habilitar'}
                    </button>
                </div>
            </section>

            <section className="me-section">
                <div className="me-section-head">
                    <h3 className="me-section-title">Historial</h3>
                    <p className="me-section-hint">
                        Quién la habilitó o deshabilitó, y cuándo. Lo registra el sistema y no se
                        puede editar.
                    </p>
                </div>
                {historial.length === 0 ? (
                    <p className="me-field-hint">Nunca se ha habilitado.</p>
                ) : (
                    <ol className="me-fs-historial">
                        {historial.map((e, i) => (
                            <li key={`${e.en}-${i}`} className="me-fs-evento">
                                {e.habilitada
                                    ? <FiCheck size={15} className="me-fs-icono ok" aria-hidden="true" />
                                    : <FiX size={15} className="me-fs-icono" aria-hidden="true" />}
                                <span className="me-fs-quien">
                                    {e.habilitada ? 'Habilitada' : 'Deshabilitada'} por{' '}
                                    <strong>{e.nombre || 'una persona sin nombre registrado'}</strong>
                                </span>
                                <time className="me-fs-cuando" dateTime={e.en}>{fecha(e.en)}</time>
                            </li>
                        ))}
                    </ol>
                )}
            </section>

            <Modal
                isOpen={pendiente !== null}
                onClose={() => !saving && setPendiente(null)}
                title={pendiente ? 'Habilitar la Ficha Básica de Salud' : 'Deshabilitar la Ficha Básica de Salud'}
                subtitle={tenant.nombre}
                icon={pendiente ? <FiHeart size={20} /> : <FiAlertTriangle size={20} />}
                footer={
                    <>
                        <button className="btn btn-secondary" disabled={saving} onClick={() => setPendiente(null)}>Cancelar</button>
                        <button className="btn btn-primary" disabled={saving} onClick={aplicar}>
                            {saving ? 'Guardando…' : pendiente ? 'Habilitar' : 'Deshabilitar'}
                        </button>
                    </>
                }
            >
                {pendiente ? (
                    <p className="me-fs-modal-texto">
                        Todas las personas de la empresa van a recibir la ficha en Encuestas, y las
                        que se incorporen después también. La decisión queda registrada a tu nombre,
                        con la fecha y la hora.
                    </p>
                ) : (
                    <p className="me-fs-modal-texto">
                        La ficha deja de enviarse a las altas nuevas. Lo ya respondido se conserva:
                        deshabilitarla no borra datos de salud. La decisión queda registrada a tu
                        nombre, con la fecha y la hora.
                    </p>
                )}
            </Modal>
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
    const navigate = useNavigate();
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
                    }
                    : null,
            );
            if (res.success && res.data) {
                onSaved(res.data.tenant);
                // Designarlo le asigna lo que tiene que firmar (el Programa de
                // Trabajo Preventivo de cada obra). Se dice, para que no parezca
                // que no pasó nada.
                const asignados = res.data.firmasRepresentante?.asignados || 0;
                toast.success(!personaId
                    ? 'Representante legal quitado.'
                    : asignados > 0
                        ? `Representante legal designado. Se le pidió firmar ${asignados} documento(s); los verá en "Mis firmas".`
                        : 'Representante legal designado.');
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

    const descartar = () => {
        setNombre(tenant.nombre || '');
        setColor(tenant.preferencias?.colorPrimario || DEFAULT_PRIMARY_COLOR);
        setLogoPreview(auth.user?.branding?.logoUrl || null);
        setLogoBase64(undefined);
        setErr('');
    };

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
            <div className="me-stack">
                <section className="me-section">
                    <div className="me-section-head">
                        <h3 className="me-section-title">Datos de la empresa</h3>
                        <p className="me-section-hint">El nombre con el que tu empresa aparece en la plataforma y en los documentos.</p>
                    </div>
                    <div className="me-datos">
                        <div className="form-group me-datos-nombre">
                            <label className="form-label" htmlFor="me-nombre">Razón social</label>
                            <input id="me-nombre" className="form-input" value={nombre}
                                onChange={(e) => setNombre(e.target.value)} placeholder="Constructora Demo SpA" />
                        </div>
                        <div className="form-group">
                            <label className="form-label" htmlFor="me-rut">RUT</label>
                            <div className="me-field-locked">
                                <input id="me-rut" className="form-input" value={tenant.rutEmpresa} disabled readOnly
                                    title="El RUT no se puede modificar." />
                                <FiLock size={13} aria-hidden="true" />
                            </div>
                        </div>
                        {/* Representante legal (DS 44 Art. 8 inc. 1): aprueba el Programa de
                            Trabajo Preventivo y firma la Política SST. Se guarda solo, sin
                            depender del botón de identidad, porque es un dato normativo y no
                            de marca. */}
                        <div className="form-group me-datos-full">
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
                                Sin designarlo, el programa no se puede aprobar. Se guarda al elegirlo.
                            </span>
                        </div>
                    </div>
                </section>

                <section className="me-section">
                    <div className="me-section-head">
                        <h3 className="me-section-title">Logo</h3>
                        <p className="me-section-hint">Reemplaza el nombre Build &amp; Serve en la barra superior.</p>
                    </div>
                    <div className="me-logo">
                        <input ref={fileRef} type="file" accept="image/*" hidden
                            onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ''; }} />
                        <button type="button"
                            className={`me-dropzone ${dragging ? 'dragging' : ''} ${logoPreview ? 'has-logo' : ''}`}
                            aria-label={logoPreview ? 'Cambiar el logo' : 'Subir un logo'}
                            onClick={() => fileRef.current?.click()}
                            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                            onDragLeave={() => setDragging(false)}
                            onDrop={(e) => {
                                e.preventDefault(); setDragging(false);
                                const f = e.dataTransfer.files?.[0]; if (f) onFile(f);
                            }}>
                            {logoPreview
                                ? <img src={logoPreview} alt="Logo de la empresa" />
                                : <FiImage size={22} aria-hidden="true" />}
                        </button>
                        <div className="me-logo-info">
                            <span className="me-logo-titulo">
                                {logoPreview ? 'Logo cargado' : 'Arrastra tu logo o haz clic para subirlo'}
                            </span>
                            <span className="me-field-hint">PNG, JPG, SVG o WebP · Máx. 2 MB</span>
                            <div className="me-logo-actions">
                                <button className="btn btn-secondary btn-sm" onClick={() => fileRef.current?.click()}>
                                    <FiUpload size={13} /> {logoPreview ? 'Cambiar logo' : 'Subir logo'}
                                </button>
                                {logoPreview && (
                                    <button className="btn btn-ghost btn-sm me-texto-alerta"
                                        onClick={() => { setLogoPreview(null); setLogoBase64(''); }}>
                                        <FiX size={13} /> Quitar
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>
                </section>

                <section className="me-section">
                    <div className="me-section-head">
                        <h3 className="me-section-title">Color principal</h3>
                        <p className="me-section-hint">Se aplica a los botones, enlaces y elementos activos de toda la plataforma.</p>
                    </div>
                    <div className="me-color-row">
                        <button type="button" className="me-swatch" style={{ background: colorValido ? color : 'var(--surface-hover)' }}
                            onClick={() => document.getElementById('me-color-input')?.click()}
                            aria-label="Abrir el selector de color" />
                        <input id="me-color-input" type="color" className="me-color-native" tabIndex={-1}
                            value={colorValido ? color : DEFAULT_PRIMARY_COLOR} onChange={(e) => setColor(e.target.value)} />
                        <input className="form-input me-hex" value={color} maxLength={7} spellCheck={false}
                            aria-label="Código del color" onChange={(e) => setColor(e.target.value)} />
                        <span className="me-color-sep" aria-hidden="true" />
                        <div className="me-suggested-row" role="group" aria-label="Colores sugeridos">
                            {SUGGESTED_COLORS.map((s) => {
                                const active = color.toLowerCase() === s.hex.toLowerCase();
                                return (
                                    <button key={s.hex} type="button" title={s.label} aria-label={s.label}
                                        aria-pressed={active}
                                        className={`me-suggested-dot ${active ? 'active' : ''}`}
                                        style={{ background: s.hex }}
                                        onClick={() => setColor(s.hex)}>
                                        {active && <FiCheck size={12} aria-hidden="true" />}
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                </section>

                {/* Art. 57 inc. 2: las organizaciones sindicales son destinatarias
                    del Reglamento Interno. Va acá y no en el repositorio porque es
                    un dato de la empresa, no del documento. */}
                <section className="me-section">
                    <div className="me-section-head">
                        <h3 className="me-section-title">Organizaciones sindicales</h3>
                        <p className="me-section-hint">
                            A quiénes hay que remitir el Reglamento Interno además de las personas
                            trabajadoras y del comité. Si no hay ninguna, declararlo evita que el
                            requisito quede pendiente sin forma de cerrarse.
                        </p>
                    </div>
                    {tenant?.tenantId ? (
                        <OrganizacionesSindicales
                            tenantId={tenant.tenantId}
                            reglas={tenant.reglas}
                            personaId={auth?.user?.personaId || null}
                        />
                    ) : null}
                </section>

                {/* Art. 22: el SGSST es de la entidad empleadora, no de cada obra,
                    así que vive acá y no en la obra. Va antes que la estructura
                    preventiva porque ésta es uno de sus cinco componentes. */}
                <section className="me-section">
                    <div className="me-section-head">
                        <h3 className="me-section-title">Sistema de Gestión de Seguridad y Salud en el Trabajo</h3>
                        <p className="me-section-hint">
                            Los cinco componentes que el Art. 22 exige como contenido mínimo.
                            Tres se acreditan con un documento propio; los otros dos se
                            acreditan en su módulo y aquí solo se enlazan.
                        </p>
                    </div>
                    {tenant?.tenantId ? (
                        <SgsstPanel
                            tenantId={tenant.tenantId}
                            onIrA={(enlace) => {
                                if (enlace === 'estructura-preventiva') {
                                    document.getElementById('estructura-preventiva')
                                        ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                                } else {
                                    navigate('/documents-repository');
                                }
                            }}
                        />
                    ) : null}
                </section>

                {/* Estructura preventiva (DS 44 Arts. 23, 50, 65, 66). No bloquea nada:
                    muestra qué corresponde según la dotación de la entidad y deja
                    constituir también lo que no es obligatorio, como voluntario. */}
                <section className="me-section" id="estructura-preventiva">
                    <div className="me-section-head">
                        <h3 className="me-section-title">Estructura preventiva</h3>
                        <p className="me-section-hint">
                            Órganos que corresponden a la entidad empleadora según su dotación.
                            El comité paritario y el delegado de cada obra se gestionan en la obra.
                        </p>
                    </div>
                    {tenant?.tenantId ? (
                        <EstructuraPreventivaPanel
                            tenantId={tenant.tenantId}
                            ambito={AMBITO.EMPRESA}
                            onConstituir={(tipo) => navigate(`/estructura/constituir?ambito=empresa&tipo=${tipo}`)}
                            onVerOrgano={(organoId) => navigate(`/estructura/organos/${organoId}`)}
                        />
                    ) : null}
                </section>

                {/* Completitud del FUF a nivel entidad empleadora. El porcentaje se
                    calcula sobre los requisitos EXIGIBLES: lo que no aplica sale del
                    denominador en vez de penalizar. */}
                <section className="me-section">
                    <div className="me-section-head">
                        <h3 className="me-section-title">Cumplimiento del Formulario Único de Fiscalización</h3>
                        <p className="me-section-hint">
                            Estado de los requisitos que cubre el módulo de estructura preventiva.
                        </p>
                    </div>
                    {tenant?.tenantId ? (
                        <CompletitudFufPanel tenantId={tenant.tenantId} ambito={AMBITO.EMPRESA} />
                    ) : null}
                </section>

                {err && <AlertBanner variant="error" message={err} onDismiss={() => setErr('')} />}
                {/* Fija al pie de la ventana: los cambios se hacen arriba y no hay que
                    bajar hasta el final del formulario para guardarlos. */}
                <div className={`me-save-bar${dirty ? ' dirty' : ''}`}>
                    <span className="me-field-hint">
                        {dirty && !saving ? 'Tienes cambios sin guardar.' : 'Razón social, logo y color se guardan con este botón.'}
                    </span>
                    <button className="btn btn-secondary" disabled={!dirty || saving} onClick={descartar}>
                        Descartar
                    </button>
                    <button className="btn btn-primary" disabled={!dirty || saving} onClick={save}>
                        {saving ? <div className="spinner" /> : <><FiSave /> Guardar identidad</>}
                    </button>
                </div>
            </div>

            {/* Fija bajo el header mientras se recorre el formulario: el logo y el
                color se editan arriba, pero se sigue viendo el resultado abajo. */}
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
                        {contrasteOk
                            ? <FiCheck size={15} aria-hidden="true" />
                            : <FiAlertTriangle size={15} aria-hidden="true" />}
                        <strong>{contrasteOk ? 'Buen contraste' : 'Contraste bajo'}</strong>
                    </div>
                )}
            </aside>
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
        <div className="me-stack">
            <div className="me-aviso">
                <FiInfo size={17} className="me-aviso-icono" aria-hidden="true" />
                <span className="me-aviso-texto">
                    Los roles con <FiLock size={11} style={{ verticalAlign: -1 }} /> son los mínimos de la empresa:
                    puedes renombrarlos y ajustar sus permisos, pero no eliminarlos. Al eliminar un rol con
                    personas asignadas, se te pedirá reasignarlas antes.
                </span>
                {dirty && !saving && <span className="me-field-hint me-aviso-estado">Cambios sin guardar</span>}
                <button className="btn btn-primary" disabled={!dirty || saving} onClick={save}>
                    {saving ? <div className="spinner" /> : <><FiSave /> Guardar cambios</>}
                </button>
            </div>

            {err && <AlertBanner variant="error" message={err} onDismiss={() => setErr('')} />}

            <div className="me-roles">
                {roles.map((r) => {
                    const count = countByRole(r);
                    return (
                        <div key={r._id} className="me-role">
                            <div className="me-role-head">
                                <span className="me-role-icon" aria-hidden="true">
                                    {r.protegido ? <FiLock size={18} /> : <FiShield size={18} />}
                                </span>
                                <input className="form-input me-role-name" placeholder="Nombre del rol"
                                    aria-label="Nombre del rol"
                                    value={r.nombre} disabled={r.locked}
                                    onChange={(e) => update(r._id, { nombre: e.target.value })} />
                                <input className="form-input me-role-desc" placeholder="Descripción (opcional)"
                                    aria-label="Descripción del rol"
                                    value={r.descripcion} disabled={r.protegido}
                                    title={r.protegido ? 'La descripción de un rol mínimo no se puede editar.' : undefined}
                                    onChange={(e) => update(r._id, { descripcion: e.target.value })} />
                                <span className="me-count" title="Personas con este rol"><FiUsers size={12} /> {count}</span>
                                {!r.protegido && (
                                    <button type="button" className="me-icon-btn danger"
                                        onClick={() => requestDelete(r)} aria-label={`Eliminar rol ${r.nombre}`} title="Eliminar rol">
                                        <FiTrash2 size={15} />
                                    </button>
                                )}
                            </div>

                            {r.locked ? (
                                <div className="me-perms-total">
                                    <FiCheck size={14} aria-hidden="true" />
                                    <span>
                                        <strong>Acceso total</strong> a todos los módulos de la plataforma. Sus permisos no se editan.
                                    </span>
                                </div>
                            ) : (
                                <>
                                    <div className="me-perms-head">
                                        Permisos <span className="me-perms-tally">{activos(r)} de {ALL_PERMISSION_KEYS.length}</span>
                                    </div>
                                    <div className="me-perms-groups">
                                        {PERMISSION_GROUPS.map((g) => {
                                            const keys = g.permisos.map((p) => p.key);
                                            const marcados = keys.filter((k) => r.permisos.includes(k)).length;
                                            const todos = marcados === keys.length;
                                            return (
                                                <div key={g.grupo} className="me-mod">
                                                    <div className="me-mod-head">
                                                        <span className="me-mod-name">{g.grupo}</span>
                                                        <span className="me-mod-tally">{marcados}/{keys.length}</span>
                                                        <button type="button" className="me-mod-all"
                                                            onClick={() => setGroupPerms(r._id, keys, !todos)}>
                                                            {todos ? 'Quitar todo' : 'Marcar todo'}
                                                        </button>
                                                    </div>
                                                    <div className="me-mod-chips">
                                                        {g.permisos.map((perm) => {
                                                            const on = r.permisos.includes(perm.key);
                                                            return (
                                                                <label key={perm.key} className="me-chip" title={perm.nota}>
                                                                    <input type="checkbox" checked={on}
                                                                        onChange={() => togglePerm(r._id, perm.key)} />
                                                                    <span>
                                                                        {on && <FiCheck size={11} aria-hidden="true" />}
                                                                        {perm.label}
                                                                    </span>
                                                                </label>
                                                            );
                                                        })}
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

            <button type="button" className="me-add" onClick={addRole}><FiPlus size={14} /> Añadir rol</button>

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
function CargosTab({ tenantId, personas, personasListas }: {
    tenantId: string;
    personas: PersonaResponse[];
    personasListas: boolean;
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

    // Sin las personas los conteos por cargo saldrían en cero: se espera a ambas.
    const cargando = loading || !personasListas;

    const tipo = (c: TenantCargo) => c.legacy
        ? { label: 'Heredado', cls: 'heredado' }
        : c.seed ? { label: 'Predefinido', cls: 'predefinido' } : { label: 'Personalizado', cls: 'personalizado' };
    const personasLabel = (n: number) => `${n} persona${n === 1 ? '' : 's'}`;
    const kitLabel = (c: TenantCargo) => {
        const n = c.kit?.length || 0;
        return `${n} elemento${n === 1 ? '' : 's'} de kit`;
    };

    const sinResultados = <div className="me-vacio">No hay cargos que coincidan.</div>;

    const listView = filtered.length === 0 ? sinResultados : (
        <div className="me-cargos-list">
            {filtered.map((c) => {
                const t = tipo(c);
                return (
                    <Link key={c.codigo} to={`/cargos-onboarding?cargo=${c.codigo}`} className="me-cargo-row">
                        <span className="me-cargo-row-name">{c.label}</span>
                        <span className="me-cargo-row-code">{c.codigo}</span>
                        <span className={`me-tipo ${t.cls}`}>{t.label}</span>
                        <span className="me-cargo-row-meta me-cargo-row-kit">{kitLabel(c)}</span>
                        <span className="me-cargo-row-meta">{personasLabel(countByCargo(c.codigo))}</span>
                        <FiChevronRight size={15} className="me-cargo-row-chevron" aria-hidden="true" />
                    </Link>
                );
            })}
        </div>
    );

    const gridView = filtered.length === 0 ? sinResultados : (
        <div className="me-cargos-grid2">
            {filtered.map((c) => {
                const t = tipo(c);
                return (
                    <Link key={c.codigo} to={`/cargos-onboarding?cargo=${c.codigo}`} className="me-cargo-card">
                        <span className="me-cargo-card-top">
                            <span className="me-cargo-card-name">{c.label}</span>
                            <span className={`me-tipo ${t.cls}`}>{t.label}</span>
                        </span>
                        <span className="me-cargo-row-code">{c.codigo}</span>
                        <span className="me-cargo-card-footer">
                            <span>{kitLabel(c)}</span>
                            <span>{personasLabel(countByCargo(c.codigo))}</span>
                        </span>
                    </Link>
                );
            })}
        </div>
    );

    return (
        <div className="me-stack">
            {err && <AlertBanner variant="error" message={err} onDismiss={() => setErr('')} />}

            <CollectionView
                searchValue={search}
                onSearchChange={setSearch}
                searchPlaceholder="Buscar cargo…"
                mode={mode}
                onModeChange={setMode}
                count={cargando ? undefined : filtered.length}
                countNoun="cargo"
                list={cargando ? <CargosListSkeleton /> : listView}
                grid={cargando ? <CargosGridSkeleton /> : gridView}
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

function EppTab({ tenantId, toast, nuevo }: {
    tenantId: string;
    toast: ReturnType<typeof useToast>['toast'];
    nuevo: number;
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

    // `nuevo` cambia cuando se pulsa "Nuevo elemento" en el encabezado de la página.
    useEffect(() => { if (nuevo > 0) abrirNuevo(); }, [nuevo]);

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

    if (loading) return <EppSkeleton />;

    return (
        <div className="epp-tab">
            {err && !modalOpen && <AlertBanner variant="error" message={err} onDismiss={() => setErr('')} />}

            {incompletos > 0 && (
                <div className="epp-alerta" role="status">
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
                <label className="epp-search">
                    <FiSearch size={15} aria-hidden="true" />
                    <input
                        type="search"
                        placeholder="Buscar elemento…"
                        aria-label="Buscar elemento"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                    />
                </label>
                <span className="epp-count">{items.length} elemento{items.length === 1 ? '' : 's'}</span>
            </div>

            {items.length === 0 ? (
                <div className="epp-empty">
                    <span className="epp-empty-icon"><LuHardHat size={22} /></span>
                    <h3>Todavía no hay elementos de EPP</h3>
                    <p>
                        Agrega los cascos, guantes, arneses y demás elementos que entrega tu empresa.
                        Al registrarlos aquí, quien haga una entrega los elige de la lista en vez de escribirlos.
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
                                <span className="epp-tile-icon"><LuHardHat size={18} aria-hidden="true" /></span>
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
                                    label="Certificado"
                                    title={e.certificado && e.certificadoTipo ? CERTIFICADO_TIPO_LABEL[e.certificadoTipo] : 'Certificado o registro ISP'}
                                    adjunto={e.certificado}
                                    onView={verDocumento}
                                    onMissingClick={() => abrirEdicion(e)}
                                />
                                <EppDocChip
                                    label="Instructivo"
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
                title={`${title}: sin cargar — clic para agregarlo`}
                aria-label={`${title}: falta. Agregarlo`}>
                <FiPlus size={11} aria-hidden="true" />
                <span>{label}</span>
            </button>
        );
    }
    return (
        <button type="button" className="epp-tile-doc" onClick={() => onView(adjunto)}
            title={`Ver ${title.toLowerCase()}: ${adjunto.nombre}`}
            aria-label={`Ver ${title.toLowerCase()}`}>
            <FiCheck size={11} aria-hidden="true" />
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
                    <button type="button" className="btn btn-ghost btn-sm me-texto-alerta"
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

// ── Esqueletos ───────────────────────────────────────────────────────────────
// Cada pestaña dibuja su retícula con las MISMAS clases que el contenido ya
// cargado (me-section, me-datos, me-role, epp-tile…): así los bloques caen donde
// después cae el texto, en vez de un spinner centrado que salta al cargar.
// `aria-busy` va una vez por contenedor; los bloques son decorativos.

const Sk = ({ w, h = 12, r, className = '', style }: {
    w?: number | string; h?: number; r?: number; className?: string; style?: React.CSSProperties;
}) => (
    <div className={`ui-skel ${className}`} style={{ width: w, height: h, borderRadius: r, flexShrink: 0, ...style }} />
);

/** Un renglón de texto: el bloque mide la letra, la caja mide el renglón
 *  (line-height), que es lo que ocupa el texto real. */
const Txt = ({ w, h, lh, style }: { w: number | string; h: number; lh: number; style?: React.CSSProperties }) => (
    <div style={{ display: 'flex', alignItems: 'center', height: lh, width: typeof w === 'number' ? w : undefined, flex: typeof w === 'number' ? '0 0 auto' : undefined, ...style }}>
        <Sk w={w} h={h} />
    </div>
);

function SeccionHeadSkel({ titulo, hint }: { titulo: number; hint: number }) {
    return (
        <div className="me-section-head" style={{ alignItems: 'center' }}>
            <Txt w={titulo} h={14} lh={22} />
            <Txt w={hint} h={10} lh={17} />
        </div>
    );
}

const LabelSkel = ({ w }: { w: number }) => <Txt w={w} h={10} lh={17} style={{ marginBottom: 6 }} />;

function CampoSkel({ className, label = 90 }: { className?: string; label?: number }) {
    return (
        <div className={`form-group ${className ?? ''}`}>
            <LabelSkel w={label} />
            <Sk w="100%" h={38} r={8} />
        </div>
    );
}

function IdentidadSkeleton() {
    return (
        <div className="me-identity" aria-busy="true" aria-live="polite" aria-label="Cargando la identidad de la empresa">
            <div className="me-stack">
                <section className="me-section">
                    <SeccionHeadSkel titulo={150} hint={340} />
                    <div className="me-datos">
                        <CampoSkel className="me-datos-nombre" label={84} />
                        <CampoSkel label={32} />
                        <div className="form-group me-datos-full">
                            <LabelSkel w={130} />
                            <Sk w="100%" h={38} r={8} />
                            <Txt w="62%" h={10} lh={18} style={{ marginTop: 6 }} />
                        </div>
                    </div>
                </section>

                <section className="me-section">
                    <SeccionHeadSkel titulo={40} hint={260} />
                    <div className="me-logo">
                        <Sk w={96} h={96} r={14} />
                        <div className="me-logo-info">
                            <Txt w={250} h={13} lh={21} />
                            <Txt w={170} h={10} lh={18} />
                            <div className="me-logo-actions"><Sk w={104} h={32} r={8} /></div>
                        </div>
                    </div>
                </section>

                <section className="me-section">
                    <SeccionHeadSkel titulo={110} hint={330} />
                    <div className="me-color-row">
                        <Sk w={40} h={40} r={10} />
                        <Sk w={110} h={38} r={8} />
                        <span className="me-color-sep" aria-hidden="true" />
                        <div className="me-suggested-row">
                            {Array.from({ length: SUGGESTED_COLORS.length }, (_, i) => <Sk key={i} w={26} h={26} r={8} />)}
                        </div>
                    </div>
                </section>

                {/* Organizaciones sindicales llegan con la empresa; se reserva el
                    alto de su forma más común: vacío + formulario para agregar. */}
                <section className="me-section">
                    <SeccionHeadSkel titulo={170} hint={430} />
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                        <Sk w="100%" h={150} r={12} />
                        <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'flex-end' }}>
                            <div style={{ flex: '2 1 200px' }}><LabelSkel w={60} /><Sk w="100%" h={38} r={8} /></div>
                            <div style={{ flex: '2 1 180px' }}><LabelSkel w={64} /><Sk w="100%" h={38} r={8} /></div>
                            <Sk w={104} h={40} r={8} />
                        </div>
                    </div>
                </section>

                <section className="me-section">
                    <SeccionHeadSkel titulo={330} hint={380} />
                    <SgsstSkeleton />
                </section>

                <section className="me-section">
                    <SeccionHeadSkel titulo={160} hint={420} />
                    <EstructuraPreventivaSkeleton />
                </section>

                <section className="me-section">
                    <SeccionHeadSkel titulo={340} hint={300} />
                    <CompletitudFufSkeleton />
                </section>
            </div>

            <aside className="me-preview">
                <Sk w={84} h={10} />
                <div className="me-mock"><Sk w="100%" h={204} r={0} /></div>
                <Sk w="100%" h={40} r={10} />
            </aside>
        </div>
    );
}

const CHIP_ANCHOS = [46, 66, 84, 72, 54, 104, 76, 92, 58, 80];

function RolesSkeleton() {
    return (
        <div className="me-stack" aria-busy="true" aria-live="polite" aria-label="Cargando los roles">
            <div className="me-aviso">
                <Sk w={17} h={17} className="ui-skel--circulo" />
                <div className="me-aviso-texto" style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                    <Sk w="92%" h={11} />
                    <Sk w="58%" h={11} />
                </div>
                <Sk w={150} h={40} r={8} />
            </div>
            <div className="me-roles">
                {[0, 1, 2].map((i) => (
                    <div key={i} className="me-role">
                        <div className="me-role-head">
                            <Sk w={38} h={38} r={10} />
                            <Sk className="me-role-name" h={38} r={8} />
                            <Sk className="me-role-desc" h={38} r={8} />
                            <Sk w={46} h={28} r={999} />
                            {i > 0 && <Sk w={30} h={30} r={6} />}
                        </div>
                        {i === 0 ? (
                            <Sk w="100%" h={41} r={6} />
                        ) : (
                            <>
                                <Txt w={110} h={10} lh={18} style={{ marginBottom: -4 }} />
                                {/* Los mismos grupos y la misma cantidad de chips que llegan. */}
                                <div className="me-perms-groups">
                                    {PERMISSION_GROUPS.map((g, gi) => (
                                        <div key={g.grupo} className="me-mod">
                                            <div className="me-mod-head">
                                                <Txt w={[88, 60, 76, 96, 70][gi % 5]} h={10} lh={18} />
                                                <Txt w={22} h={9} lh={18} style={{ marginRight: 'auto' }} />
                                                <Txt w={64} h={10} lh={18} />
                                            </div>
                                            <div className="me-mod-chips">
                                                {g.permisos.map((_, k) => (
                                                    <Sk key={k} w={CHIP_ANCHOS[(gi + k) % CHIP_ANCHOS.length]} h={26} r={999} />
                                                ))}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </>
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
}

function CargosListSkeleton({ filas = 6 }: { filas?: number }) {
    return (
        <div className="me-cargos-list" aria-busy="true" aria-live="polite" aria-label="Cargando los cargos">
            {Array.from({ length: filas }, (_, i) => (
                <div key={i} className="me-cargo-row">
                    <span className="me-cargo-row-name"><Txt w={[140, 110, 170, 96, 150, 124][i % 6]} h={13} lh={22} /></span>
                    <span className="me-cargo-row-code"><Sk w={52} h={10} /></span>
                    <Sk w={[80, 72, 94][i % 3]} h={21} r={999} />
                    <span className="me-cargo-row-meta me-cargo-row-kit"><Sk w={110} h={10} /></span>
                    <span className="me-cargo-row-meta"><Sk w={70} h={10} /></span>
                    <Sk w={15} h={15} r={4} />
                </div>
            ))}
        </div>
    );
}

function CargosGridSkeleton({ tarjetas = 8 }: { tarjetas?: number }) {
    return (
        <div className="me-cargos-grid2" aria-busy="true" aria-live="polite" aria-label="Cargando los cargos">
            {Array.from({ length: tarjetas }, (_, i) => (
                <div key={i} className="me-cargo-card">
                    <span className="me-cargo-card-top">
                        <Txt w={[120, 96, 140, 110][i % 4]} h={13} lh={22} />
                        <Sk w={[80, 72, 94][i % 3]} h={21} r={999} />
                    </span>
                    <Txt w={52} h={10} lh={19} />
                    <span className="me-cargo-card-footer">
                        <Txt w={100} h={10} lh={19} />
                        <Txt w={64} h={10} lh={19} />
                    </span>
                </div>
            ))}
        </div>
    );
}

function EppSkeleton({ tarjetas = 8 }: { tarjetas?: number }) {
    return (
        <div className="epp-tab" aria-busy="true" aria-live="polite" aria-label="Cargando el catálogo de EPP">
            <div className="epp-toolbar">
                <Sk w={300} h={38} r={8} />
                <Sk w={78} h={11} />
            </div>
            <ul className="epp-grid">
                {Array.from({ length: tarjetas }, (_, i) => (
                    <li key={i} className="epp-tile epp-tile--skel">
                        <div className="epp-tile-top">
                            <Sk w={38} h={38} r={10} />
                            <div className="epp-tile-menu"><Sk w={26} h={26} r={6} /><Sk w={26} h={26} r={6} /></div>
                        </div>
                        <div className="epp-tile-body">
                            <Txt w={['72%', '58%', '80%', '64%'][i % 4]} h={13} lh={17.5} />
                            <Txt w={['50%', '66%', '44%', '58%'][i % 4]} h={10} lh={16} />
                        </div>
                        <div className="epp-tile-docs">
                            <Sk w={80} h={23} r={7} />
                            <Sk w={76} h={23} r={7} />
                        </div>
                    </li>
                ))}
            </ul>
        </div>
    );
}

function FichaSaludSkeleton() {
    return (
        <div className="me-stack" aria-busy="true" aria-live="polite" aria-label="Cargando la ficha de salud">
            <section className="me-section">
                <SeccionHeadSkel titulo={150} hint={430} />
                <div className="me-fs-estado">
                    <Sk w={108} h={26} r={999} />
                    <div className="me-fs-estado-texto">
                        <Txt w="96%" h={11} lh={18.75} />
                        <Txt w="60%" h={11} lh={18.75} />
                    </div>
                    <Sk w={120} h={42} r={8} style={{ marginLeft: 'auto' }} />
                </div>
            </section>
            <section className="me-section">
                <SeccionHeadSkel titulo={70} hint={360} />
                <ol className="me-fs-historial">
                    {[0, 1, 2].map((i) => (
                        <li key={i} className="me-fs-evento">
                            <Sk w={15} h={15} r={4} />
                            <Txt w={[230, 250, 210][i]} h={12} lh={21} />
                            <Txt w={170} h={10} lh={19} style={{ marginLeft: 'auto' }} />
                        </li>
                    ))}
                </ol>
            </section>
        </div>
    );
}

const styles = `
/* Traducción del canvas "Mi empresa" (MiEmpresa*.dc.html): secciones sin tarjeta,
   con título + pista sobre una regla; el único recuadro es el de cada elemento. */
.me-stack { display: flex; flex-direction: column; gap: var(--space-6); min-width: 0; }

.me-section-head {
    display: flex; align-items: baseline; flex-wrap: wrap; gap: 4px 10px;
    padding-bottom: 9px; margin-bottom: 14px; border-bottom: 1px solid var(--surface-border);
}
.me-section-title { margin: 0; font-size: 14px; font-weight: 600; color: var(--text-primary); }
.me-section-hint { margin: 0; flex: 1 1 320px; font-size: 11.5px; line-height: 1.5; color: var(--text-secondary); }
.me-field-hint { display: block; font-size: 12px; line-height: 1.5; color: var(--text-secondary); margin-top: 6px; }
.me-texto-alerta { color: var(--danger-alerta) !important; }

.me-pill {
    display: inline-flex; align-items: center; gap: 7px; flex-shrink: 0;
    padding: 4px 12px; border-radius: 999px; font-size: 12px; font-weight: 700;
    background: var(--surface-hover); color: var(--text-secondary);
}
.me-pill-dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
.me-pill.ok { background: color-mix(in srgb, var(--success-apagado) 16%, transparent); color: var(--success-apagado); }

.me-icon-btn {
    display: flex; align-items: center; justify-content: center; flex-shrink: 0;
    width: 30px; height: 30px; padding: 0; border: none; border-radius: var(--radius-sm);
    background: none; color: var(--text-muted); cursor: pointer;
    transition: background var(--transition-fast), color var(--transition-fast);
}
.me-icon-btn:hover { background: var(--surface-hover); color: var(--text-primary); }
.me-icon-btn.danger:hover { color: var(--danger-alerta); }

/* Acción de agregar: trazo discontinuo, como "Agregar" en Personas. */
.me-add {
    display: inline-flex; align-items: center; gap: 8px; align-self: flex-start;
    padding: 9px 16px; border: 1px dashed var(--gray-500); border-radius: var(--radius-md);
    background: none; color: var(--text-primary); font-family: inherit; font-size: 13px; font-weight: 600;
    cursor: pointer; transition: border-color var(--transition-fast), color var(--transition-fast);
}
.me-add:hover { border-color: var(--accent); color: var(--accent-text); }

/* Paneles legales compartidos (DS44): dentro de Mi empresa, sin relleno, como
   el resto de los recuadros del canvas. */
.me-section .ds44-doc-row { background: none; }

.me-vacio { font-size: var(--text-sm); color: var(--text-secondary); padding: var(--space-3) 0; }

/* ── Identidad ─────────────────────────────────────────────────────────────── */
.me-identity { display: grid; grid-template-columns: minmax(0, 1fr) 320px; gap: 28px; align-items: start; }

.me-datos { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; }
.me-datos .form-group { margin-bottom: 0; }
.me-datos-nombre { grid-column: span 2; }
.me-datos-full { grid-column: 1 / -1; }

.me-field-locked { position: relative; }
.me-field-locked .form-input { padding-right: 34px; }
.me-field-locked svg { position: absolute; right: 12px; top: 50%; transform: translateY(-50%); color: var(--text-muted); pointer-events: none; }

/* Logo */
.me-logo { display: flex; align-items: center; gap: 18px; }
.me-dropzone {
    width: 96px; height: 96px; flex-shrink: 0; padding: 10px;
    display: flex; align-items: center; justify-content: center;
    border: 1.5px dashed var(--gray-500); border-radius: 14px;
    background: none; color: var(--text-muted); cursor: pointer;
    transition: border-color var(--transition-fast), background var(--transition-fast);
}
.me-dropzone:hover, .me-dropzone.dragging { border-color: var(--accent); background: var(--accent-tint); color: var(--accent-text); }
.me-dropzone.has-logo { border: 1px solid var(--surface-border); background: var(--surface-elevated); }
.me-dropzone img { max-width: 100%; max-height: 100%; object-fit: contain; }
.me-logo-info { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.me-logo-titulo { font-size: 13px; font-weight: 600; color: var(--text-primary); }
.me-logo-info .me-field-hint { margin-top: 0; }
.me-logo-actions { display: flex; align-items: center; gap: var(--space-2); margin-top: 8px; }

/* Color */
.me-color-row { display: flex; align-items: center; flex-wrap: wrap; gap: 14px 20px; }
.me-swatch { width: 40px; height: 40px; flex-shrink: 0; border-radius: var(--radius-md); border: 1px solid var(--surface-border); cursor: pointer; }
.me-color-native { width: 0; height: 0; opacity: 0; position: absolute; pointer-events: none; }
.me-hex { width: 110px; font-family: var(--font-mono); text-transform: uppercase; }
.me-color-sep { width: 1px; height: 28px; background: var(--surface-border); }
.me-suggested-row { display: flex; flex-wrap: wrap; gap: 8px; }
.me-suggested-dot {
    width: 26px; height: 26px; padding: 0; border-radius: 8px; cursor: pointer;
    border: 1.5px solid transparent; color: #fff;
    display: flex; align-items: center; justify-content: center;
    transition: transform var(--transition-fast);
}
.me-suggested-dot:hover { transform: scale(1.1); }
.me-suggested-dot.active { border-color: var(--accent); }

.me-save-bar {
    position: sticky; bottom: 0; z-index: 5;
    display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
    margin-top: calc(-1 * var(--space-2)); padding: 14px 0 16px;
    background: var(--surface-bg); border-top: 1px solid var(--surface-border);
}
.me-save-bar.dirty .me-field-hint { color: var(--text-primary); font-weight: 500; }
.me-save-bar .me-field-hint { flex: 1; margin: 0; }

/* Vista previa: se queda a la vista bajo el header fijo mientras se recorre
   el formulario, que es bastante más largo que ella. */
.me-preview {
    position: sticky; top: calc(var(--header-height) + var(--space-4));
    display: flex; flex-direction: column; gap: 12px;
}
.me-preview-eyebrow { font-size: 11px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: var(--text-secondary); }
.me-mock { border: 1px solid var(--surface-border); border-radius: 14px; overflow: hidden; }
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
.me-mock-body { padding: 14px 12px; background: var(--surface-elevated); display: flex; flex-direction: column; gap: 12px; }
.me-mock-nav { display: flex; gap: 6px; }
.me-mock-nav-item { font-size: 10.5px; color: var(--text-muted); padding: 4px 8px; border-radius: var(--radius-sm); border: 1px solid transparent; }
.me-mock-nav-item.active { color: var(--text-primary); font-weight: 600; border-left-width: 2px; border-left-style: solid; }
.me-mock-lines { display: flex; flex-direction: column; gap: 8px; }
.me-mock-lines span { height: 8px; border-radius: 4px; background: var(--surface-hover); }
.me-mock-lines span:nth-child(2) { width: 70%; }
.me-mock-lines span:nth-child(3) { width: 45%; }
.me-mock-actions { display: flex; align-items: center; gap: 10px; }
.me-mock-btn { font-size: 11.5px; font-weight: 600; color: #fff; padding: 6px 14px; border-radius: 7px; }
.me-mock-link { font-size: 11.5px; font-weight: 500; }

.me-contrast {
    display: flex; align-items: center; gap: 8px; padding: 10px 12px; border-radius: var(--radius-md);
    border: 1px solid var(--surface-border);
}
.me-contrast > svg { flex-shrink: 0; }
.me-contrast strong { font-size: 12.5px; font-weight: 600; }
.me-contrast.ok { background: color-mix(in srgb, var(--success-apagado) 8%, transparent); color: var(--success-apagado); }
.me-contrast.warn { background: color-mix(in srgb, var(--danger-alerta) 8%, transparent); color: var(--danger-alerta); }

@media (max-width: 1080px) {
  .me-identity { grid-template-columns: minmax(0, 1fr); }
  /* En una columna la vista previa queda al final: fijarla taparía el formulario. */
  .me-preview { position: static; }
}
@media (max-width: 720px) {
  .me-datos { grid-template-columns: minmax(0, 1fr); }
  .me-datos-nombre { grid-column: auto; }
  .me-color-sep { display: none; }
}

/* ── Ficha de salud ────────────────────────────────────────────────────────── */
.me-fs-estado {
    display: flex; align-items: center; gap: 16px; flex-wrap: wrap;
    padding: 18px 20px; border: 1px solid var(--surface-border); border-radius: 14px;
}
.me-fs-estado-texto { flex: 1 1 280px; margin: 0; max-width: 60ch; font-size: 12.5px; line-height: 1.5; color: var(--text-secondary); }
.me-fs-estado > .btn { margin-left: auto; }
.me-btn-alerta {
    background: none; color: var(--danger-alerta);
    border: 1px solid color-mix(in srgb, var(--danger-alerta) 40%, transparent);
}
.me-btn-alerta:hover:not(:disabled) { background: color-mix(in srgb, var(--danger-alerta) 10%, transparent); }
.me-fs-historial { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
.me-fs-evento {
    display: flex; align-items: center; flex-wrap: wrap; gap: 4px 14px;
    padding: 12px 4px; border-bottom: 1px solid var(--surface-hover); font-size: 13px;
}
.me-fs-icono { flex-shrink: 0; color: var(--danger-alerta); }
.me-fs-icono.ok { color: var(--success-apagado); }
.me-fs-quien { color: var(--text-secondary); }
.me-fs-quien strong { font-weight: 600; color: var(--text-primary); }
.me-fs-cuando { margin-left: auto; color: var(--text-muted); font-size: 12px; font-variant-numeric: tabular-nums; }
.me-fs-modal-texto { margin: 0; line-height: 1.55; color: var(--text-secondary); max-width: 60ch; }

/* ── Roles y permisos ──────────────────────────────────────────────────────── */
.me-aviso {
    display: flex; align-items: center; flex-wrap: wrap; gap: 12px 14px;
    padding: 14px 16px; border: 1px solid var(--surface-border); border-radius: var(--radius-md);
}
.me-aviso-icono { flex-shrink: 0; color: var(--accent-text); }
.me-aviso-texto { flex: 1 1 360px; font-size: 12.5px; line-height: 1.5; color: var(--text-secondary); }
.me-aviso-estado { margin: 0; }

.me-roles { display: flex; flex-direction: column; gap: 12px; }
.me-role {
    display: flex; flex-direction: column; gap: 14px;
    padding: 16px 18px; border: 1px solid var(--surface-border); border-radius: 14px;
}
.me-role-head { display: flex; align-items: center; gap: 12px; }
.me-role-icon {
    width: 38px; height: 38px; flex-shrink: 0; border-radius: var(--radius-md);
    display: flex; align-items: center; justify-content: center;
    background: var(--surface-hover); color: var(--text-secondary);
}
.me-role-name { flex: 1 1 0; max-width: 260px; min-width: 140px; font-weight: 600; }
.me-role-desc { flex: 2 1 0; min-width: 160px; }
.me-count {
    display: inline-flex; align-items: center; gap: 6px; flex-shrink: 0;
    padding: 4px 10px; border: 1px solid var(--surface-border); border-radius: 999px;
    font-size: 11.5px; color: var(--text-secondary); white-space: nowrap;
}

/* Rol Administrador: no hay nada que decidir, así que no se dibujan controles. */
.me-perms-total {
    display: flex; align-items: center; gap: 8px; padding: 10px 12px; border-radius: var(--radius-sm);
    background: color-mix(in srgb, var(--accent) 6%, transparent);
    border: 1px dashed color-mix(in srgb, var(--accent) 30%, transparent);
    font-size: 12px; color: var(--accent-text);
}
.me-perms-total strong { font-weight: 600; }

.me-perms-head { font-size: 11px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: var(--text-muted); margin-bottom: -4px; }
.me-perms-tally { margin-left: 6px; font-weight: 600; letter-spacing: 0; text-transform: none; font-variant-numeric: tabular-nums; }

/* Columnas y no grilla: los módulos tienen entre 1 y 8 permisos, y el
   empaquetado por columnas deja cada uno del alto de su contenido. */
.me-perms-groups { columns: 300px; column-gap: 28px; }
.me-mod { display: flex; flex-direction: column; gap: 8px; margin-bottom: 16px; break-inside: avoid; }
.me-mod-head { display: flex; align-items: center; gap: 10px; }
.me-mod-name { font-size: 11px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: var(--text-secondary); }
.me-mod-tally { font-size: 10.5px; color: var(--text-muted); font-variant-numeric: tabular-nums; margin-right: auto; }
.me-mod-all {
    border: none; background: none; padding: 0; cursor: pointer; font-family: inherit;
    font-size: 11px; font-weight: 600; color: var(--accent-text);
}
.me-mod-all:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 3px; }

/* Chip conmutable: activo = relleno con check; inactivo = trazo discontinuo. */
.me-mod-chips { display: flex; flex-wrap: wrap; gap: 8px; }
.me-chip { display: inline-flex; cursor: pointer; }
.me-chip input { position: absolute; width: 1px; height: 1px; opacity: 0; margin: 0; }
.me-chip span {
    display: inline-flex; align-items: center; gap: 6px;
    padding: 4px 11px; border-radius: 999px; border: 1px dashed var(--gray-500);
    font-size: 12px; line-height: 1.35; font-weight: 500; color: var(--text-secondary);
    transition: background var(--transition-fast), border-color var(--transition-fast), color var(--transition-fast);
}
.me-chip:hover span { border-color: var(--accent); color: var(--text-primary); }
.me-chip input:checked + span {
    border: 1px solid transparent; background: var(--accent-tint); color: var(--accent-text); font-weight: 600;
}
.me-chip input:focus-visible + span { outline: 2px solid var(--accent); outline-offset: 2px; }

@media (max-width: 720px) {
  .me-role-head { flex-wrap: wrap; }
  .me-role-name, .me-role-desc { flex: 1 1 100%; max-width: none; }
}

/* ── Cargos ────────────────────────────────────────────────────────────────── */
.me-tipo { padding: 2px 9px; border-radius: 999px; font-size: 10.5px; font-weight: 600; white-space: nowrap; flex-shrink: 0; }
.me-tipo.predefinido { color: var(--success-apagado); background: color-mix(in srgb, var(--success-apagado) 16%, transparent); }
.me-tipo.heredado { color: var(--accent-text); background: var(--accent-tint); }
.me-tipo.personalizado { color: #c4b5fd; background: rgba(167, 139, 250, 0.16); }
:root.theme-light .me-tipo.personalizado { color: #6d28d9; }

.me-cargos-list { display: flex; flex-direction: column; border: 1px solid var(--surface-border); border-radius: 14px; overflow: hidden; }
.me-cargo-row {
    display: flex; align-items: center; gap: 14px; padding: 13px 16px;
    border-bottom: 1px solid var(--surface-border); text-decoration: none; color: inherit;
    transition: background var(--transition-fast);
}
.me-cargo-row:last-child { border-bottom: none; }
.me-cargo-row:hover { background: var(--surface-hover); }
.me-cargo-row-name { flex: 2 1 0; min-width: 0; font-size: 13.5px; font-weight: 600; color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.me-cargo-row-code { flex: 1 1 0; font-size: 12px; color: var(--text-muted); font-variant-numeric: tabular-nums; }
.me-cargo-row-meta { flex: 1 1 0; font-size: 12px; color: var(--text-secondary); white-space: nowrap; }
.me-cargo-row-chevron { flex-shrink: 0; color: var(--text-muted); }

.me-cargos-grid2 { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 12px; }
.me-cargo-card {
    display: flex; flex-direction: column; gap: 6px; padding: 16px;
    border: 1px solid var(--surface-border); border-radius: 14px;
    text-decoration: none; color: inherit; transition: border-color var(--transition-fast);
}
.me-cargo-card:hover { border-color: var(--accent); }
.me-cargo-card-top { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; }
.me-cargo-card-name { font-size: 13.5px; font-weight: 600; color: var(--text-primary); }
.me-cargo-card-footer { display: flex; justify-content: space-between; gap: 8px; margin-top: 6px; font-size: 12px; color: var(--text-secondary); }

@media (max-width: 720px) {
  .me-cargo-row-code, .me-cargo-row-kit { display: none; }
}

/* ── Catálogo de EPP ─────────────────────────────────────────────────────── */
.epp-tab { display: flex; flex-direction: column; gap: var(--space-5); }

/* Aviso de incumplimiento DS44: el único tono de alerta de la interfaz. */
.epp-alerta {
    display: flex; align-items: flex-start; gap: 12px; padding: 12px 16px; border-radius: var(--radius-md);
    background: color-mix(in srgb, var(--danger-alerta) 8%, transparent);
    border: 1px solid color-mix(in srgb, var(--danger-alerta) 30%, transparent);
    color: var(--danger-alerta);
}
.epp-alerta > svg { flex-shrink: 0; margin-top: 1px; }
.epp-alerta strong { display: block; font-size: 13px; font-weight: 600; color: var(--text-primary); }
.epp-alerta p { margin: 3px 0 0; font-size: 12px; line-height: 1.55; color: var(--text-secondary); }

.epp-toolbar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.epp-search {
    display: flex; align-items: center; gap: 9px; flex: 0 1 300px; height: 38px; padding: 0 12px;
    border: 1px solid var(--surface-border); border-radius: 8px; color: var(--text-muted);
}
.epp-search:focus-within { border-color: var(--accent); }
.epp-search input {
    flex: 1; min-width: 0; border: none; outline: none; background: none;
    color: var(--text-primary); font-family: inherit; font-size: 13.5px;
}
.epp-count { font-size: 13px; color: var(--text-secondary); }

.epp-grid {
    list-style: none; margin: 0; padding: 0;
    display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 14px;
}
.epp-tile {
    display: flex; flex-direction: column; gap: 12px; padding: 16px;
    border: 1px solid var(--surface-border); border-radius: 14px;
    transition: border-color var(--transition-fast);
    animation: eppTileIn 0.3s ease both;
}
.epp-tile--skel, .epp-tile--skel:hover { animation: none; border-color: var(--surface-border); }
@keyframes eppTileIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
.epp-tile:hover, .epp-tile:focus-within { border-color: var(--accent); }
@media (max-width: 900px) { .epp-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
@media (max-width: 580px) { .epp-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }

.epp-tile-top { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; }
.epp-tile-icon {
    width: 38px; height: 38px; border-radius: var(--radius-md); flex-shrink: 0;
    display: flex; align-items: center; justify-content: center;
    background: var(--surface-hover); color: var(--text-secondary);
}
.epp-tile-menu { display: flex; gap: 2px; }
.epp-tile-menu button {
    width: 26px; height: 26px; display: flex; align-items: center; justify-content: center;
    border: none; background: none; color: var(--text-muted); border-radius: 6px; cursor: pointer;
}
.epp-tile-menu button:hover { background: var(--surface-hover); color: var(--text-primary); }
.epp-tile-menu button.danger:hover { color: var(--danger-alerta); }

.epp-tile-body { display: flex; flex-direction: column; gap: 3px; }
.epp-tile-name {
    margin: 0; font-size: 13.5px; font-weight: 600; color: var(--text-primary); line-height: 1.3;
    display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}
.epp-tile-desc {
    margin: 0; font-size: 11.5px; color: var(--text-secondary); line-height: 1.4;
    display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}

/* Respaldos: cargado = relleno con check (abre la vista previa);
   faltante = trazo discontinuo (lleva a editar para cargarlo). */
.epp-tile-docs { display: flex; flex-wrap: wrap; gap: 6px; margin-top: auto; }
.epp-tile-doc {
    display: inline-flex; align-items: center; gap: 5px; padding: 4px 8px; border-radius: 7px;
    border: 1px solid transparent; font-family: inherit; font-size: 10.5px; font-weight: 600; cursor: pointer;
    background: color-mix(in srgb, var(--success-apagado) 16%, transparent); color: var(--success-apagado);
    transition: filter var(--transition-fast), border-color var(--transition-fast);
}
.epp-tile-doc:hover { filter: brightness(1.15); }
.epp-tile-doc:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.epp-tile-doc.missing {
    background: none; font-weight: 500; color: var(--text-secondary);
    border: 1px dashed color-mix(in srgb, var(--danger-alerta) 45%, transparent);
}
.epp-tile-doc.missing:hover { filter: none; border-color: var(--danger-alerta); color: var(--danger-alerta); }

.epp-empty { text-align: center; padding: var(--space-10) var(--space-6); border: 1.5px dashed var(--gray-500); border-radius: 14px; }
.epp-empty-icon {
    width: 52px; height: 52px; border-radius: 50%; border: 1.5px solid var(--surface-border); color: var(--text-muted);
    display: inline-flex; align-items: center; justify-content: center; margin-bottom: var(--space-3);
}
.epp-empty h3 { font-size: 14px; font-weight: 600; margin: 0 0 4px; }
.epp-empty p { font-size: 12.5px; color: var(--text-secondary); margin: 0 auto var(--space-5); max-width: 420px; line-height: 1.55; }
.epp-sin-resultados { font-size: var(--text-sm); color: var(--text-secondary); padding: var(--space-4) 0; margin: 0; }

/* Formulario (modal) */
.epp-form { display: flex; flex-direction: column; }
.epp-form-docs { display: flex; flex-direction: column; gap: var(--space-3); }
.epp-form-title { font-size: 14px; font-weight: 600; margin: 0; }
.epp-form-hint { font-size: 12px; color: var(--text-secondary); margin: -6px 0 0; line-height: 1.55; }
.epp-slot {
    display: flex; flex-direction: column; gap: var(--space-2);
    padding: 12px 14px; border-radius: var(--radius-md); border: 1px dashed var(--gray-500);
}
.epp-slot.cargado { border-style: solid; border-color: var(--surface-border); }
.epp-slot-head { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); }
.epp-slot-title { display: inline-flex; align-items: center; gap: 7px; font-size: 13px; font-weight: 500; }
.epp-slot-ok { color: var(--success-apagado); }
.epp-slot-falta { color: var(--danger-alerta); }
.epp-slot-flag { font-size: 10px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: var(--danger-alerta); }
.epp-slot-ayuda { font-size: 12px; color: var(--text-secondary); margin: -4px 0 0; }
.epp-slot-file { display: flex; align-items: center; gap: var(--space-2); flex-wrap: wrap; }
.epp-slot-name {
    display: inline-flex; align-items: center; gap: 6px; min-width: 0; flex: 1;
    font-size: 12.5px; color: var(--text-primary);
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
`;
