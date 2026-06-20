import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { FiPlus, FiCopy, FiTrash2, FiEdit2, FiSave, FiLock, FiAlertTriangle, FiUpload, FiFile, FiEye, FiRefreshCw } from 'react-icons/fi';
import { AlertBanner, Modal, Select, SegmentedControl, PageHeader, Drawer } from '../components/ui';
import { uploadsApi } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { tenantsApi, type TenantCargo } from '../api/tenants.api';
import { invalidateCargoCatalog, buildSeedCargoCatalog } from '../hooks/useCargoCatalog';
import type { Ds44KitItem, Ds44AccionTipo } from '../utils/ds44';
import { buildBaseCargoKit } from '../utils/ds44';

const ACCION_OPTIONS: { value: Ds44AccionTipo; label: string }[] = [
    { value: 'DIFUSION_FIRMA', label: 'Difusión + firma' },
    { value: 'CAPACITACION_EVALUACION', label: 'Capacitación + evaluación' },
    { value: 'ENTREGA_EPP', label: 'Entrega de EPP' },
    { value: 'EVIDENCIA_EXTERNA', label: 'Evidencia externa' },
    { value: 'INGRESO_VIGILANCIA', label: 'Ingreso a vigilancia (MINSAL)' },
    { value: 'ENCUESTA', label: 'Encuesta' },
];
const ALCANCE_OPTIONS = [
    { value: 'tenant', label: 'Empresa (1 documento para todas las obras)' },
    { value: 'obra', label: 'Obra (específico de cada obra)' },
    { value: 'persona', label: 'Persona (evidencia individual)' },
    { value: 'ninguno', label: 'Sin documento' },
];
const NATURALEZA_OPTIONS = [
    { value: 'procedimiento_corporativo', label: 'Procedimiento corporativo' },
    { value: 'derivado_miper', label: 'Derivado del MIPER' },
    { value: 'evidencia_individual', label: 'Evidencia individual' },
];

const ACCION_LABEL: Record<string, string> = Object.fromEntries(ACCION_OPTIONS.map((o) => [o.value, o.label]));
const ALCANCE_SHORT: Record<string, string> = { tenant: 'empresa', obra: 'obra', persona: 'persona', ninguno: '—' };

const codeFromLabel = (label: string) =>
    label.trim().toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 32) || 'CARGO';

// Ítems que son de empresa: idénticos en todos los cargos (kitTransversal).
// Se muestran en la sección "Documentos de empresa" — siempre visible, arriba.
const EMPRESA_KEYS = new Set(['RI_76', 'POLITICA_SST']);

// Grupos del kit ESPECÍFICO del cargo. Excluye EMPRESA_KEYS.
const GRUPOS_CARGO: { naturaleza: Ds44KitItem['naturaleza']; titulo: string; sub: string; destacado?: boolean }[] = [
    { naturaleza: 'derivado_miper', titulo: 'IRL del cargo', sub: 'Información de Riesgos Laborales — específica del cargo. Se define una vez por empresa y se capacita a cada trabajador al ingresar.', destacado: true },
    { naturaleza: 'procedimiento_corporativo', titulo: 'Procedimientos del cargo', sub: 'Capacitaciones y procedimientos operativos específicos de este cargo.' },
    { naturaleza: 'evidencia_individual', titulo: 'Evidencia individual', sub: 'Se adjunta al vincular al trabajador a una obra (EPP, exámenes ocupacionales, encuestas).' },
];

// Normaliza datos llegados de DB: corrige IRL con alcance 'obra' (seed anterior)
// y elimina PLAN_EMERGENCIAS del kit-cargo (ahora vive en DS44_PLAN_DOCS por obra).
const normalizeCargos = (list: TenantCargo[]): TenantCargo[] =>
    list.map((c) => ({
        ...c,
        kit: c.kit
            .filter((it) => it.key !== 'PLAN_EMERGENCIAS')
            .map((it) => it.key === 'IRL' && it.alcancePlantilla === 'obra'
                ? { ...it, alcancePlantilla: 'tenant' as const }
                : it
            ),
    }));

const emptyItem = (): Ds44KitItem => ({
    key: '', tipo: '', titulo: '', naturaleza: 'procedimiento_corporativo',
    alcancePlantilla: 'tenant', accion: 'DIFUSION_FIRMA',
});

export default function CargosOnboarding() {
    const { user } = useAuth();
    const tenantId = (user as any)?.tenantId as string | undefined;
    const [searchParams] = useSearchParams();

    const [cargos, setCargos] = useState<TenantCargo[]>([]);
    const [selected, setSelected] = useState<string>('');
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [dirty, setDirty] = useState(false);
    const [error, setError] = useState('');
    const [saved, setSaved] = useState(false);

    const [newCargoOpen, setNewCargoOpen] = useState(false);
    const [newCargoLabel, setNewCargoLabel] = useState('');
    const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
    const [cargoToDelete, setCargoToDelete] = useState<TenantCargo | null>(null);
    const [itemToDelete, setItemToDelete] = useState<{ idx: number; label: string } | null>(null);
    const [itemDrawer, setItemDrawer] = useState<{ idx: number | null; draft: Ds44KitItem } | null>(null);
    const [uploadingItem, setUploadingItem] = useState<number | null>(null);
    const [uploadingEmpresaKey, setUploadingEmpresaKey] = useState<string | null>(null);

    useEffect(() => {
        if (!tenantId) { setLoading(false); return; }
        const wanted = searchParams.get('cargo');
        const pick = (list: TenantCargo[]) =>
            (wanted && list.some((c) => c.codigo === wanted) ? wanted : list[0]?.codigo) || '';
        tenantsApi.getCargos(tenantId)
            .then((res) => {
                const fetched = res?.success && Array.isArray(res?.data?.cargos) ? res.data!.cargos : [];
                const list = normalizeCargos(fetched.length ? fetched : buildSeedCargoCatalog());
                setCargos(list);
                setSelected(pick(list));
            })
            .catch(() => {
                const seed = normalizeCargos(buildSeedCargoCatalog());
                setCargos(seed);
                setSelected(pick(seed));
            })
            .finally(() => setLoading(false));
    }, [tenantId]); // eslint-disable-line react-hooks/exhaustive-deps

    const current = useMemo(() => cargos.find((c) => c.codigo === selected) || null, [cargos, selected]);

    // Ítems de empresa: se extraen del primer cargo que los tenga. Son idénticos en todos.
    const empresaItems = useMemo(() => {
        const map = new Map<string, Ds44KitItem>();
        for (const c of cargos) {
            for (const it of c.kit) {
                if (EMPRESA_KEYS.has(it.key) && !map.has(it.key)) map.set(it.key, it);
            }
        }
        return [...map.entries()].map(([key, it]) => ({ key, it }));
    }, [cargos]);

    const mutate = (fn: (draft: TenantCargo[]) => TenantCargo[]) => {
        setCargos((prev) => fn(prev.map((c) => ({ ...c, kit: c.kit.map((i) => ({ ...i })) }))));
        setDirty(true);
        setSaved(false);
    };

    const handleSave = async () => {
        if (!tenantId) return;
        setSaving(true); setError('');
        try {
            const res = await tenantsApi.saveCargos(tenantId, cargos);
            if (res.success) {
                invalidateCargoCatalog();
                setDirty(false); setSaved(true);
                if (res.data?.cargos) setCargos(res.data.cargos);
            } else {
                setError(res.error || 'No se pudo guardar');
            }
        } catch { setError('Error de conexión al guardar'); }
        finally { setSaving(false); }
    };

    const addCargo = () => {
        const label = newCargoLabel.trim();
        if (!label) return;
        let codigo = codeFromLabel(label);
        const taken = new Set(cargos.map((c) => c.codigo));
        while (taken.has(codigo)) codigo = `${codigo}_2`;
        mutate((d) => [...d, { codigo, label, seed: false, kit: buildBaseCargoKit() }]);
        setSelected(codigo);
        setNewCargoLabel(''); setNewCargoOpen(false);
    };

    const resetCatalog = () => {
        const seed = normalizeCargos(buildSeedCargoCatalog());
        setCargos(seed);
        setSelected(seed[0]?.codigo || '');
        setDirty(true); setSaved(false);
        setResetConfirmOpen(false);
    };

    const duplicateCargo = (c: TenantCargo) => {
        let codigo = `${c.codigo}_COPIA`;
        const taken = new Set(cargos.map((x) => x.codigo));
        while (taken.has(codigo)) codigo = `${codigo}_2`;
        mutate((d) => [...d, { codigo, label: `${c.label} (copia)`, seed: false, kit: c.kit.map((i) => ({ ...i })) }]);
        setSelected(codigo);
    };

    const removeCargo = (codigo: string) => {
        mutate((d) => d.filter((c) => c.codigo !== codigo));
        setSelected((s) => (s === codigo ? '' : s));
    };

    const renameCargo = (codigo: string, label: string) =>
        mutate((d) => d.map((c) => (c.codigo === codigo ? { ...c, label, seed: false } : c)));

    const removeItem = (idx: number) =>
        mutate((d) => d.map((c) => (c.codigo === selected ? { ...c, kit: c.kit.filter((_, i) => i !== idx), seed: false } : c)));

    const setItemPlantilla = (idx: number, plantilla: Ds44KitItem['plantilla']) =>
        mutate((d) => d.map((c) => {
            if (c.codigo !== selected) return c;
            const kit = c.kit.map((it, i) => (i === idx ? { ...it, plantilla } : it));
            return { ...c, kit, seed: false };
        }));

    const uploadPlantilla = async (idx: number, file: File) => {
        setUploadingItem(idx); setError('');
        try {
            const res = await uploadsApi.uploadFile(file, 'plantilla', tenantId, tenantId);
            if (res.success && res.data) {
                setItemPlantilla(idx, { fileKey: res.data.url, nombre: res.data.nombre, tipo: res.data.tipo, subidoEn: res.data.subidoEn || new Date().toISOString() });
            } else {
                setError(res.error || 'No se pudo subir el documento');
            }
        } catch { setError('Error de conexión al subir'); }
        finally { setUploadingItem(null); }
    };

    // Sube un documento de empresa y lo propaga a TODOS los cargos con esa key.
    const uploadEmpresaDoc = async (key: string, file: File) => {
        setUploadingEmpresaKey(key); setError('');
        try {
            const res = await uploadsApi.uploadFile(file, 'plantilla', tenantId, tenantId);
            if (res.success && res.data) {
                const plantilla = { fileKey: res.data.url, nombre: res.data.nombre, tipo: res.data.tipo, subidoEn: res.data.subidoEn || new Date().toISOString() };
                setCargos((prev) => prev.map((c) => ({
                    ...c, seed: false,
                    kit: c.kit.map((it) => it.key === key ? { ...it, plantilla } : it),
                })));
                setDirty(true); setSaved(false);
            } else {
                setError(res.error || 'No se pudo subir el documento');
            }
        } catch { setError('Error de conexión al subir'); }
        finally { setUploadingEmpresaKey(null); }
    };

    const removeEmpresaDoc = (key: string) => {
        setCargos((prev) => prev.map((c) => ({
            ...c, seed: false,
            kit: c.kit.map((it) => it.key === key ? { ...it, plantilla: undefined } : it),
        })));
        setDirty(true); setSaved(false);
    };

    const previewPlantilla = async (fileKey: string) => {
        try {
            const res = await uploadsApi.getDownloadUrl(fileKey);
            if (res.success && res.data?.downloadUrl) window.open(res.data.downloadUrl, '_blank');
            else setError('No se pudo abrir el documento');
        } catch { setError('No se pudo abrir el documento'); }
    };

    const saveItem = () => {
        if (!itemDrawer) return;
        const draft = { ...itemDrawer.draft };
        draft.titulo = draft.titulo.trim() || draft.codigoEbco || 'Documento';
        draft.tipo = (draft.tipo || draft.key || draft.titulo).trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_');
        draft.key = (draft.key || draft.tipo).trim();
        mutate((d) => d.map((c) => {
            if (c.codigo !== selected) return c;
            const kit = [...c.kit];
            if (itemDrawer.idx === null) kit.push(draft); else kit[itemDrawer.idx] = draft;
            return { ...c, kit, seed: false };
        }));
        setItemDrawer(null);
    };

    if (loading) return (
        <div className="page-content" style={{ display: 'flex', justifyContent: 'center', paddingTop: 'var(--space-10)' }}>
            <div className="spinner" />
        </div>
    );

    return (
        <div className="page-content">
            <PageHeader
                banner
                scope={{ label: 'Empresa · Onboarding' }}
                title="Onboarding y documentos de empresa"
                description="Administra los documentos base de la empresa (Reglamento Interno, Política SST) y define el kit de onboarding de cada cargo. Estos documentos aplican a todas las obras: súbelos o renuévalos aquí una sola vez."
                actions={
                    <button className="btn btn-save" disabled={!dirty || saving} onClick={handleSave}>
                        {saving ? 'Guardando…' : <><FiSave /> Guardar cambios</>}
                    </button>
                }
            />

            {error && <AlertBanner variant="error" message={error} onDismiss={() => setError('')} />}
            {saved && <AlertBanner variant="success" message="Catálogo de cargos guardado." onDismiss={() => setSaved(false)} />}

            {/* ── Sección 1: Documentos de empresa ── */}
            <div className="card co-empresa-section">
                <div className="co-empresa-head">
                    <div>
                        <div className="co-empresa-title">Documentos de empresa</div>
                        <div className="co-empresa-sub">
                            Aplican a <strong>todos los cargos</strong>. Sube el documento una vez y se distribuye a cualquier trabajador nuevo, sin importar la obra.
                        </div>
                    </div>
                </div>
                {empresaItems.length === 0 ? (
                    <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)', padding: 'var(--space-2) 0' }}>
                        Sin documentos de empresa configurados — agrega un cargo para ver sus documentos base.
                    </div>
                ) : (
                    <div className="co-empresa-items">
                        {empresaItems.map(({ key, it }) => (
                            <div key={key} className="co-empresa-item">
                                <div className="co-empresa-item-info">
                                    {it.codigoEbco && <span className="co-ebco-tag">{it.codigoEbco}</span>}
                                    <span className="co-empresa-item-title">{it.titulo}</span>
                                    <span className="co-empresa-item-accion">{ACCION_LABEL[it.accion]}</span>
                                </div>
                                <PlantillaControl
                                    item={it}
                                    uploading={uploadingEmpresaKey === key}
                                    onUpload={(file) => uploadEmpresaDoc(key, file)}
                                    onPreview={() => it.plantilla && previewPlantilla(it.plantilla.fileKey)}
                                    onRemove={() => removeEmpresaDoc(key)}
                                />
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* ── Sección 2: Por cargo ── */}
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(220px, 280px) 1fr', gap: 'var(--space-4)', alignItems: 'start' }}>
                {/* Lista de cargos */}
                <div className="card" style={{ padding: 'var(--space-3)' }}>
                    <div style={{
                        fontSize: 'var(--text-xs)', fontWeight: 700, letterSpacing: '0.06em',
                        textTransform: 'uppercase', color: 'var(--text-secondary)',
                        padding: 'var(--space-1) var(--space-2) var(--space-2)',
                    }}>
                        Cargos · {cargos.length}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                        {cargos.map((c) => (
                            <button
                                key={c.codigo}
                                onClick={() => setSelected(c.codigo)}
                                style={{
                                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                    gap: 8, padding: 'var(--space-2) var(--space-3)',
                                    borderRadius: 'var(--radius-sm)',
                                    border: selected === c.codigo ? '1px solid var(--accent)' : '1px solid transparent',
                                    background: selected === c.codigo ? 'var(--accent-tint)' : 'none',
                                    color: 'var(--text-primary)', cursor: 'pointer', textAlign: 'left',
                                    transition: 'background 0.15s, border-color 0.15s',
                                }}
                            >
                                <span style={{ fontWeight: selected === c.codigo ? 600 : 400, fontSize: 'var(--text-sm)' }}>{c.label}</span>
                                <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', flexShrink: 0 }}>
                                    {c.kit.filter((it) => !EMPRESA_KEYS.has(it.key)).length}
                                </span>
                            </button>
                        ))}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)', marginTop: 'var(--space-2)' }}>
                        <button className="btn btn-secondary" style={{ width: '100%' }} onClick={() => setNewCargoOpen(true)}>
                            <FiPlus /> Nuevo cargo
                        </button>
                        <button
                            className="btn btn-ghost btn-sm"
                            style={{ width: '100%', color: 'var(--text-muted)', fontSize: 'var(--text-xs)' }}
                            onClick={() => setResetConfirmOpen(true)}
                            title="Restaura todos los cargos al catálogo predefinido EBCO"
                        >
                            <FiRefreshCw size={12} /> Restablecer catálogo
                        </button>
                    </div>
                </div>

                {/* Kit específico del cargo */}
                {!current ? (
                    <div className="card empty-state" style={{ padding: 'var(--space-10)' }}>
                        <p className="empty-state-description">Selecciona o crea un cargo para editar su kit.</p>
                    </div>
                ) : (
                    <div className="card" style={{ padding: 'var(--space-4)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', marginBottom: 'var(--space-4)', flexWrap: 'wrap' }}>
                            <input
                                className="form-input"
                                style={{ fontWeight: 600, fontSize: 'var(--text-base)', maxWidth: 340, flex: 1 }}
                                value={current.label}
                                onChange={(e) => renameCargo(current.codigo, e.target.value)}
                                aria-label="Nombre del cargo"
                            />
                            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', fontFamily: 'monospace' }}>{current.codigo}</span>
                            <div style={{ flex: 1 }} />
                            <button className="btn btn-ghost btn-sm" onClick={() => duplicateCargo(current)} title="Duplicar cargo"><FiCopy /></button>
                            <button className="btn btn-ghost btn-sm" onClick={() => setCargoToDelete(current)} style={{ color: 'var(--danger-500)' }} title="Eliminar cargo"><FiTrash2 /></button>
                        </div>

                        <div style={{
                            fontSize: 'var(--text-xs)', fontWeight: 700, letterSpacing: '0.06em',
                            textTransform: 'uppercase', color: 'var(--text-secondary)', marginBottom: 'var(--space-3)',
                        }}>
                            Kit específico · {current.kit.filter((it) => !EMPRESA_KEYS.has(it.key)).length} ítems
                        </div>

                        {current.kit.filter((it) => !EMPRESA_KEYS.has(it.key)).length === 0 ? (
                            <div style={{ padding: 'var(--space-4)', fontSize: 'var(--text-sm)', color: 'var(--text-muted)', textAlign: 'center', border: '1px dashed var(--surface-border)', borderRadius: 'var(--radius-md)' }}>
                                Sin ítems todavía — empieza agregando el <b>IRL del cargo</b> con «Agregar ítem».
                            </div>
                        ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
                                {GRUPOS_CARGO.map((grupo) => {
                                    const items = current.kit
                                        .map((it, idx) => ({ it, idx }))
                                        .filter(({ it }) => it.naturaleza === grupo.naturaleza && !EMPRESA_KEYS.has(it.key));
                                    if (items.length === 0) return null;
                                    return (
                                        <div key={grupo.naturaleza} className={`co-group${grupo.destacado ? ' co-group--cargo' : ''}`}>
                                            <div className="co-group-head">
                                                <div className="co-group-title">
                                                    {grupo.titulo}
                                                    <span className="co-group-count">{items.length}</span>
                                                </div>
                                                <div className="co-group-sub">{grupo.sub}</div>
                                            </div>
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                                                {items.map(({ it, idx }) => (
                                                    <div key={idx} style={{
                                                        display: 'flex', alignItems: 'flex-start', gap: 'var(--space-3)',
                                                        padding: 'var(--space-3)',
                                                        border: '1px solid var(--surface-border)',
                                                        borderRadius: 'var(--radius-md)',
                                                        background: 'var(--surface)',
                                                    }}>
                                                        <div style={{ flex: 1, minWidth: 0 }}>
                                                            <div style={{ fontWeight: 500, display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                                                                {it.codigoEbco && (
                                                                    <span style={{
                                                                        fontSize: 'var(--text-xs)', background: 'var(--surface-hover)',
                                                                        padding: '1px 6px', borderRadius: 4, fontFamily: 'monospace',
                                                                    }}>{it.codigoEbco}</span>
                                                                )}
                                                                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.titulo}</span>
                                                                {it.bloqueante && <FiLock size={13} style={{ color: 'var(--danger-500)', flexShrink: 0 }} title="Bloqueante para ingresar a terreno" />}
                                                            </div>
                                                            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', marginTop: 2 }}>
                                                                {ACCION_LABEL[it.accion]}
                                                                {it.notaMinima ? ` · ${it.notaMinima}%` : ''}
                                                                {' · '}{ALCANCE_SHORT[it.alcancePlantilla]}
                                                                {it.accion === 'ENTREGA_EPP' && it.matrizEpp ? ` · ${it.matrizEpp.length} EPP` : ''}
                                                            </div>
                                                            <PlantillaControl
                                                                item={it}
                                                                uploading={uploadingItem === idx}
                                                                onUpload={(file) => uploadPlantilla(idx, file)}
                                                                onPreview={() => it.plantilla && previewPlantilla(it.plantilla.fileKey)}
                                                                onRemove={() => setItemPlantilla(idx, undefined)}
                                                            />
                                                        </div>
                                                        <div style={{ display: 'flex', gap: 'var(--space-1)', flexShrink: 0 }}>
                                                            <button className="btn btn-ghost btn-sm" onClick={() => setItemDrawer({ idx, draft: { ...it } })} title="Editar ítem"><FiEdit2 /></button>
                                                            <button className="btn btn-ghost btn-sm" onClick={() => setItemToDelete({ idx, label: it.titulo })} style={{ color: 'var(--danger-500)' }} title="Eliminar ítem"><FiTrash2 /></button>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}

                        <button
                            className="btn btn-secondary"
                            style={{ marginTop: 'var(--space-3)' }}
                            onClick={() => setItemDrawer({ idx: null, draft: emptyItem() })}
                        >
                            <FiPlus /> Agregar ítem
                        </button>
                    </div>
                )}
            </div>

            {/* Modal: nuevo cargo */}
            <Modal
                isOpen={newCargoOpen}
                onClose={() => setNewCargoOpen(false)}
                title="Nuevo cargo"
                subtitle="El código se deriva del nombre. Luego cargas su IRL y documentos."
                footer={
                    <>
                        <button className="btn btn-secondary" onClick={() => setNewCargoOpen(false)}>Cancelar</button>
                        <button className="btn btn-primary" disabled={!newCargoLabel.trim()} onClick={addCargo}><FiPlus /> Crear</button>
                    </>
                }
            >
                <div className="form-group">
                    <label className="form-label">Nombre del cargo</label>
                    <input
                        className="form-input" autoFocus
                        value={newCargoLabel}
                        onChange={(e) => setNewCargoLabel(e.target.value)}
                        placeholder="Ej: Enfierrador"
                        onKeyDown={(e) => e.key === 'Enter' && addCargo()}
                    />
                    {newCargoLabel.trim() && (
                        <div className="text-xs text-muted" style={{ marginTop: 6 }}>
                            Código: <b>{codeFromLabel(newCargoLabel)}</b>
                        </div>
                    )}
                </div>
            </Modal>

            {/* Modal: confirmar restablecer catálogo */}
            <Modal
                isOpen={resetConfirmOpen}
                onClose={() => setResetConfirmOpen(false)}
                title="Restablecer catálogo"
                subtitle="Esta acción reemplaza todos los cargos con el catálogo predefinido EBCO."
                footer={
                    <>
                        <button className="btn btn-secondary" onClick={() => setResetConfirmOpen(false)}>Cancelar</button>
                        <button className="btn btn-danger" onClick={resetCatalog}>
                            <FiRefreshCw size={14} /> Restablecer
                        </button>
                    </>
                }
            >
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, background: 'var(--surface-hover)', padding: '10px 12px', borderRadius: 'var(--radius-md)', fontSize: 'var(--text-sm)' }}>
                    <FiAlertTriangle style={{ color: 'var(--warning-500)', flexShrink: 0, marginTop: 1 }} />
                    <span>
                        Se eliminarán los cargos personalizados y los documentos subidos quedarán sin referencia.
                        Deberás <strong>guardar cambios</strong> después para persistir en la base de datos.
                    </span>
                </div>
            </Modal>

            {/* Modal: confirmar eliminar cargo */}
            <Modal
                isOpen={!!cargoToDelete}
                onClose={() => setCargoToDelete(null)}
                title="Eliminar cargo"
                subtitle={cargoToDelete ? `Se quitará "${cargoToDelete.label}" del catálogo.` : undefined}
                footer={
                    <>
                        <button className="btn btn-secondary" onClick={() => setCargoToDelete(null)}>Cancelar</button>
                        <button className="btn btn-danger" onClick={() => { if (cargoToDelete) removeCargo(cargoToDelete.codigo); setCargoToDelete(null); }}>
                            <FiTrash2 size={14} /> Eliminar cargo
                        </button>
                    </>
                }
            >
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, background: 'var(--surface-hover)', padding: '10px 12px', borderRadius: 'var(--radius-md)', fontSize: 'var(--text-sm)' }}>
                    <FiAlertTriangle style={{ color: 'var(--warning-500)', flexShrink: 0, marginTop: 1 }} />
                    <span>
                        Se eliminará el cargo y todo su kit de documentos del catálogo. Deberás <strong>guardar cambios</strong> después para persistir en la base de datos.
                    </span>
                </div>
            </Modal>

            {/* Modal: confirmar eliminar ítem del kit */}
            <Modal
                isOpen={!!itemToDelete}
                onClose={() => setItemToDelete(null)}
                title="Eliminar ítem"
                subtitle={itemToDelete ? `Se quitará "${itemToDelete.label}" del kit de este cargo.` : undefined}
                footer={
                    <>
                        <button className="btn btn-secondary" onClick={() => setItemToDelete(null)}>Cancelar</button>
                        <button className="btn btn-danger" onClick={() => { if (itemToDelete) removeItem(itemToDelete.idx); setItemToDelete(null); }}>
                            <FiTrash2 size={14} /> Eliminar ítem
                        </button>
                    </>
                }
            >
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, background: 'var(--surface-hover)', padding: '10px 12px', borderRadius: 'var(--radius-md)', fontSize: 'var(--text-sm)' }}>
                    <FiAlertTriangle style={{ color: 'var(--warning-500)', flexShrink: 0, marginTop: 1 }} />
                    <span>
                        Se eliminará este ítem del kit del cargo. Deberás <strong>guardar cambios</strong> después para persistir en la base de datos.
                    </span>
                </div>
            </Modal>

            {/* Drawer: editar ítem del kit */}
            <Drawer
                isOpen={!!itemDrawer}
                onClose={() => setItemDrawer(null)}
                title={itemDrawer?.idx === null ? 'Agregar ítem' : 'Editar ítem'}
                subtitle="Define la acción, alcance y documento del ítem DS44."
                width={520}
                footer={
                    <>
                        <button className="btn btn-secondary" onClick={() => setItemDrawer(null)}>Cancelar</button>
                        <button
                            className="btn btn-primary"
                            disabled={!itemDrawer?.draft.titulo.trim() && !itemDrawer?.draft.codigoEbco}
                            onClick={saveItem}
                        >
                            <FiSave /> Guardar ítem
                        </button>
                    </>
                }
            >
                {itemDrawer && (
                    <ItemEditor
                        draft={itemDrawer.draft}
                        onChange={(draft) => setItemDrawer({ ...itemDrawer, draft })}
                    />
                )}
            </Drawer>

            <style>{`
                .spinner {
                    width: 28px; height: 28px;
                    border: 3px solid var(--surface-border);
                    border-top-color: var(--primary-500);
                    border-radius: 50%;
                    animation: spin 0.8s linear infinite;
                    display: inline-block;
                }
                @keyframes spin { to { transform: rotate(360deg); } }

                /* ── Sección Documentos de empresa ── */
                .co-empresa-section {
                    padding: var(--space-4);
                    margin-bottom: var(--space-4);
                    border-left: 3px solid var(--cchc-navy, #002952);
                }
                .co-empresa-head {
                    margin-bottom: var(--space-3);
                }
                .co-empresa-title {
                    font-size: var(--text-base); font-weight: 700;
                    color: var(--text-primary);
                    margin-bottom: 3px;
                }
                .co-empresa-sub {
                    font-size: var(--text-sm); color: var(--text-secondary);
                    line-height: 1.5;
                }
                .co-empresa-items {
                    display: flex; flex-direction: column; gap: var(--space-2);
                }
                .co-empresa-item {
                    display: flex; align-items: center; gap: var(--space-4); flex-wrap: wrap;
                    padding: var(--space-3) var(--space-3);
                    border: 1px solid var(--surface-border);
                    border-radius: var(--radius-md);
                    background: var(--surface);
                }
                .co-empresa-item-info {
                    display: flex; align-items: center; gap: var(--space-2); flex: 1; min-width: 0; flex-wrap: wrap;
                }
                .co-ebco-tag {
                    font-size: var(--text-xs); background: var(--surface-hover);
                    padding: 1px 6px; border-radius: 4px; font-family: monospace;
                    white-space: nowrap; flex-shrink: 0;
                }
                .co-empresa-item-title {
                    font-weight: 500; font-size: var(--text-sm);
                    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
                }
                .co-empresa-item-accion {
                    font-size: var(--text-xs); color: var(--text-muted);
                    white-space: nowrap;
                }

                /* ── Grupos del kit por-cargo ── */
                .co-group {
                    border: 1px solid var(--surface-border);
                    border-radius: var(--radius-md);
                    background: var(--surface-elevated);
                    padding: var(--space-3);
                }
                .co-group--cargo {
                    border-color: var(--accent);
                    box-shadow: 0 0 0 1px var(--accent) inset;
                }
                .co-group-head { margin-bottom: var(--space-3); }
                .co-group-title {
                    display: flex; align-items: center; gap: var(--space-2);
                    font-size: var(--text-sm); font-weight: 700;
                    color: var(--text-primary);
                }
                .co-group--cargo .co-group-title { color: var(--accent-text); }
                .co-group-count {
                    font-size: 11px; font-weight: 700;
                    background: var(--surface-hover); color: var(--text-secondary);
                    padding: 1px 7px; border-radius: 999px;
                }
                .co-group--cargo .co-group-count { background: var(--accent); color: #fff; }
                .co-group-sub {
                    font-size: var(--text-xs); color: var(--text-secondary);
                    margin-top: 3px; line-height: 1.45;
                }
            `}</style>
        </div>
    );
}

// ── Editor de un ítem del kit ────────────────────────────────────────────────
function ItemEditor({ draft, onChange }: { draft: Ds44KitItem; onChange: (d: Ds44KitItem) => void }) {
    const set = (patch: Partial<Ds44KitItem>) => onChange({ ...draft, ...patch });
    const isCap = draft.accion === 'CAPACITACION_EVALUACION';
    const isEpp = draft.accion === 'ENTREGA_EPP';

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', padding: 'var(--space-2) 0' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 160px', gap: 'var(--space-3)' }}>
                <div className="form-group">
                    <label className="form-label">Título</label>
                    <input className="form-input" value={draft.titulo} onChange={(e) => set({ titulo: e.target.value })} placeholder="Ej: Trabajos en Altura" />
                </div>
                <div className="form-group">
                    <label className="form-label">Código EBCO</label>
                    <input className="form-input" value={draft.codigoEbco || ''} onChange={(e) => set({ codigoEbco: e.target.value })} placeholder="PR-PO-08" />
                </div>
            </div>

            <div className="form-group">
                <label className="form-label">Acción de onboarding</label>
                <Select value={draft.accion} onChange={(v) => set({ accion: v as Ds44AccionTipo })} options={ACCION_OPTIONS} ariaLabel="Acción" />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
                <div className="form-group">
                    <label className="form-label">Naturaleza</label>
                    <Select value={draft.naturaleza} onChange={(v) => set({ naturaleza: v as any })} options={NATURALEZA_OPTIONS} ariaLabel="Naturaleza" />
                </div>
                <div className="form-group">
                    <label className="form-label">Alcance del documento</label>
                    <Select value={draft.alcancePlantilla} onChange={(v) => set({ alcancePlantilla: v as any })} options={ALCANCE_OPTIONS} ariaLabel="Alcance" />
                </div>
            </div>

            {isCap && (
                <div className="form-group">
                    <label className="form-label">Nota mínima (evaluación)</label>
                    <SegmentedControl
                        value={String(draft.notaMinima || 70)}
                        onChange={(v) => set({ notaMinima: Number(v) as 70 | 90 })}
                        options={[{ value: '70', label: '70% (general)' }, { value: '90', label: '90% (altura/SPDC)' }]}
                    />
                </div>
            )}

            <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', cursor: 'pointer', fontSize: 'var(--text-sm)' }}>
                <input type="checkbox" checked={!!draft.bloqueante} onChange={(e) => set({ bloqueante: e.target.checked })} />
                <FiAlertTriangle size={14} style={{ color: 'var(--warning-500)' }} />
                Bloqueante para ingresar a terreno (no bloquea el registro)
            </label>

            {isEpp && <EppMatrixEditor matriz={draft.matrizEpp || []} onChange={(matrizEpp) => set({ matrizEpp })} />}
        </div>
    );
}

// ── Editor de la matriz EPP ──────────────────────────────────────────────────
function EppMatrixEditor({ matriz, onChange }: {
    matriz: { descripcion: string; critico?: boolean }[];
    onChange: (m: { descripcion: string; critico?: boolean }[]) => void;
}) {
    const [nuevo, setNuevo] = useState('');
    const add = () => {
        if (nuevo.trim()) { onChange([...matriz, { descripcion: nuevo.trim() }]); setNuevo(''); }
    };
    return (
        <div className="card" style={{ padding: 'var(--space-3)' }}>
            <div style={{ fontWeight: 600, fontSize: 'var(--text-sm)', marginBottom: 'var(--space-2)' }}>Matriz EPP · {matriz.length}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', marginBottom: 'var(--space-2)' }}>
                {matriz.map((e, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                        <input
                            className="form-input"
                            value={e.descripcion}
                            onChange={(ev) => onChange(matriz.map((x, j) => j === i ? { ...x, descripcion: ev.target.value } : x))}
                            style={{ flex: 1 }}
                        />
                        <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 'var(--text-xs)', whiteSpace: 'nowrap' }}>
                            <input type="checkbox" checked={!!e.critico} onChange={(ev) => onChange(matriz.map((x, j) => j === i ? { ...x, critico: ev.target.checked } : x))} />
                            crítico
                        </label>
                        <button className="btn btn-ghost btn-sm" onClick={() => onChange(matriz.filter((_, j) => j !== i))} style={{ color: 'var(--danger-500)' }}><FiTrash2 size={14} /></button>
                    </div>
                ))}
            </div>
            <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                <input
                    className="form-input"
                    value={nuevo}
                    onChange={(e) => setNuevo(e.target.value)}
                    placeholder="Agregar EPP… (ej: Arnés de cuerpo completo)"
                    onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), add())}
                    style={{ flex: 1 }}
                />
                <button className="btn btn-secondary" onClick={add}><FiPlus /></button>
            </div>
        </div>
    );
}

// ── Control de documento por ítem ────────────────────────────────────────────
function PlantillaControl({ item, uploading, onUpload, onPreview, onRemove }: {
    item: Ds44KitItem; uploading: boolean; onUpload: (file: File) => void; onPreview: () => void; onRemove: () => void;
}) {
    const inputRef = useRef<HTMLInputElement | null>(null);

    if (item.alcancePlantilla === 'obra') {
        return <div style={{ marginTop: 4, fontSize: 'var(--text-xs)', color: 'var(--info-500)' }}>Documento por obra — se configura en cada obra, no aquí.</div>;
    }
    if (item.alcancePlantilla === 'persona' || item.alcancePlantilla === 'ninguno') {
        return <div style={{ marginTop: 4, fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>Sin documento · evidencia individual</div>;
    }
    return (
        <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <input
                ref={inputRef} type="file" hidden accept=".pdf,.png,.jpg,.jpeg,.doc,.docx,.xls,.xlsx"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) onUpload(f); e.target.value = ''; }}
            />
            {item.plantilla ? (
                <>
                    <span style={{
                        display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 'var(--text-xs)',
                        background: 'rgba(47,170,91,0.12)', color: 'var(--success-500)',
                        padding: '2px 8px', borderRadius: 6, maxWidth: 220, overflow: 'hidden',
                    }}>
                        <FiFile size={12} />
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.plantilla.nombre}</span>
                    </span>
                    <button className="btn btn-ghost btn-sm" onClick={onPreview} title="Ver documento"><FiEye size={13} /></button>
                    <button className="btn btn-ghost btn-sm" disabled={uploading} onClick={() => inputRef.current?.click()} title="Reemplazar documento">
                        {uploading ? '…' : <FiUpload size={13} />}
                    </button>
                    <button className="btn btn-ghost btn-sm" onClick={onRemove} style={{ color: 'var(--danger-500)' }} title="Quitar"><FiTrash2 size={13} /></button>
                </>
            ) : (
                <button className="btn btn-secondary btn-sm" disabled={uploading} onClick={() => inputRef.current?.click()}>
                    {uploading ? 'Subiendo…' : <><FiUpload size={13} /> Subir documento</>}
                </button>
            )}
        </div>
    );
}
