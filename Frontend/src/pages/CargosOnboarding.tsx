import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FiPlus, FiCopy, FiTrash2, FiEdit2, FiSave, FiArrowLeft, FiInfo, FiLock, FiAlertTriangle, FiUpload, FiFile, FiEye } from 'react-icons/fi';
import { AlertBanner, Modal, Select, SegmentedControl } from '../components/ui';
import { uploadsApi } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { tenantsApi, type TenantCargo } from '../api/tenants.api';
import { invalidateCargoCatalog, buildSeedCargoCatalog } from '../hooks/useCargoCatalog';
import type { Ds44KitItem, Ds44AccionTipo } from '../utils/ds44';

const ACCION_OPTIONS: { value: Ds44AccionTipo; label: string }[] = [
    { value: 'DIFUSION_FIRMA', label: 'Difusión + firma' },
    { value: 'CAPACITACION_EVALUACION', label: 'Capacitación + evaluación' },
    { value: 'ENTREGA_EPP', label: 'Entrega de EPP' },
    { value: 'EVIDENCIA_EXTERNA', label: 'Evidencia externa' },
    { value: 'INGRESO_VIGILANCIA', label: 'Ingreso a vigilancia (MINSAL)' },
    { value: 'ENCUESTA', label: 'Encuesta' },
];
const ALCANCE_OPTIONS = [
    { value: 'tenant', label: 'Empresa (1 plantilla para todas las obras)' },
    { value: 'obra', label: 'Obra (deriva del MIPER)' },
    { value: 'persona', label: 'Persona (evidencia individual)' },
    { value: 'ninguno', label: 'Sin plantilla' },
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

const emptyItem = (): Ds44KitItem => ({
    key: '', tipo: '', titulo: '', naturaleza: 'procedimiento_corporativo',
    alcancePlantilla: 'tenant', accion: 'DIFUSION_FIRMA',
});

export default function CargosOnboarding() {
    const navigate = useNavigate();
    const { user } = useAuth();
    const tenantId = (user as any)?.tenantId as string | undefined;

    const [cargos, setCargos] = useState<TenantCargo[]>([]);
    const [selected, setSelected] = useState<string>('');
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [dirty, setDirty] = useState(false);
    const [error, setError] = useState('');
    const [saved, setSaved] = useState(false);

    // Modales
    const [newCargoOpen, setNewCargoOpen] = useState(false);
    const [newCargoLabel, setNewCargoLabel] = useState('');
    const [itemModal, setItemModal] = useState<{ idx: number | null; draft: Ds44KitItem } | null>(null);
    // Subida de plantilla por ítem (key = índice del ítem en el kit actual).
    const [uploadingItem, setUploadingItem] = useState<number | null>(null);

    useEffect(() => {
        if (!tenantId) { setLoading(false); return; }
        tenantsApi.getCargos(tenantId)
            .then((res) => {
                // Si el tenant aún no tiene catálogo (o el endpoint no responde),
                // se parte de la semilla DS44 para que el editor nunca quede vacío.
                const fetched = res?.success && Array.isArray(res?.data?.cargos) ? res.data!.cargos : [];
                const list = fetched.length ? fetched : buildSeedCargoCatalog();
                setCargos(list);
                setSelected(list[0]?.codigo || '');
            })
            .catch(() => {
                const seed = buildSeedCargoCatalog();
                setCargos(seed);
                setSelected(seed[0]?.codigo || '');
            })
            .finally(() => setLoading(false));
    }, [tenantId]);

    const current = useMemo(() => cargos.find((c) => c.codigo === selected) || null, [cargos, selected]);

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
        mutate((d) => [...d, { codigo, label, seed: false, kit: [] }]);
        setSelected(codigo);
        setNewCargoLabel(''); setNewCargoOpen(false);
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

    // Sube el archivo a S3 (flujo presigned existente) y deja la referencia en el
    // ítem. Recuerda: se persiste al "Guardar cambios" del catálogo.
    const uploadPlantilla = async (idx: number, file: File) => {
        setUploadingItem(idx); setError('');
        try {
            const res = await uploadsApi.uploadFile(file, 'plantilla', tenantId, tenantId);
            if (res.success && res.data) {
                setItemPlantilla(idx, { fileKey: res.data.url, nombre: res.data.nombre, tipo: res.data.tipo, subidoEn: res.data.subidoEn || new Date().toISOString() });
            } else {
                setError(res.error || 'No se pudo subir la plantilla');
            }
        } catch { setError('Error de conexión al subir la plantilla'); }
        finally { setUploadingItem(null); }
    };

    const previewPlantilla = async (fileKey: string) => {
        try {
            const res = await uploadsApi.getDownloadUrl(fileKey);
            if (res.success && res.data?.downloadUrl) window.open(res.data.downloadUrl, '_blank');
            else setError('No se pudo abrir la plantilla');
        } catch { setError('No se pudo abrir la plantilla'); }
    };

    const saveItem = () => {
        if (!itemModal) return;
        const draft = { ...itemModal.draft };
        draft.titulo = draft.titulo.trim() || draft.codigoEbco || 'Documento';
        draft.tipo = (draft.tipo || draft.key || draft.titulo).trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_');
        draft.key = (draft.key || draft.tipo).trim();
        mutate((d) => d.map((c) => {
            if (c.codigo !== selected) return c;
            const kit = [...c.kit];
            if (itemModal.idx === null) kit.push(draft); else kit[itemModal.idx] = draft;
            return { ...c, kit, seed: false };
        }));
        setItemModal(null);
    };

    if (loading) return (
        <div style={{ padding: 24, display: 'flex', justifyContent: 'center' }}><div className="spinner" /></div>
    );

    return (
        <div style={{ padding: '0 24px 32px' }}>
            <div className="page-header">
                <div className="page-header-info">
                    <button className="btn btn-ghost btn-sm" onClick={() => navigate(-1)} style={{ marginBottom: 8 }}><FiArrowLeft /> Volver</button>
                    <h2 className="page-header-title">Cargos de onboarding</h2>
                </div>
            </div>
            <div>

                <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', marginBottom: 16 }}>
                    <FiInfo style={{ flexShrink: 0, color: 'var(--info-500)' }} />
                    <span className="text-sm text-muted" style={{ flex: 1 }}>
                        El catálogo de cargos es de la <b>empresa</b>: lo que definas aquí aplica a <b>todas las obras</b>. Cada cargo lleva su kit de onboarding DS44.
                    </span>
                    <button className="btn btn-primary" disabled={!dirty || saving} onClick={handleSave}>
                        {saving ? <div className="spinner" /> : <><FiSave /> Guardar cambios</>}
                    </button>
                </div>

                {error && <AlertBanner variant="error" message={error} onDismiss={() => setError('')} />}
                {saved && <AlertBanner variant="success" message="Catálogo de cargos guardado." onDismiss={() => setSaved(false)} />}

                <div style={{ display: 'grid', gridTemplateColumns: 'minmax(240px, 320px) 1fr', gap: 16, alignItems: 'start' }}>
                    {/* Lista de cargos */}
                    <div className="card" style={{ padding: 12 }}>
                        <div className="text-sm text-muted" style={{ padding: '4px 8px 8px', fontWeight: 600 }}>CARGOS · {cargos.length}</div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                            {cargos.map((c) => (
                                <button key={c.codigo} onClick={() => setSelected(c.codigo)}
                                    className={`card card-interactive ${selected === c.codigo ? 'selected' : ''}`}
                                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '10px 12px', textAlign: 'left', borderColor: selected === c.codigo ? 'var(--primary-500)' : undefined }}>
                                    <span style={{ fontWeight: 500 }}>{c.label}</span>
                                    <span className="text-xs" style={{ opacity: 0.7 }}>
                                        {c.legacy ? 'heredado' : c.seed ? 'EBCO' : 'personalizado'} · {c.kit.length}
                                    </span>
                                </button>
                            ))}
                        </div>
                        <button className="btn btn-secondary" style={{ width: '100%', marginTop: 8 }} onClick={() => setNewCargoOpen(true)}><FiPlus /> Nuevo cargo</button>
                    </div>

                    {/* Editor del kit */}
                    {!current ? (
                        <div className="card empty-state" style={{ padding: 40 }}>
                            <p className="empty-state-description">Selecciona o crea un cargo para editar su kit.</p>
                        </div>
                    ) : (
                        <div className="card" style={{ padding: 16 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                                <input className="form-input" style={{ fontWeight: 600, fontSize: '1.05rem', maxWidth: 360 }}
                                    value={current.label} onChange={(e) => renameCargo(current.codigo, e.target.value)} aria-label="Nombre del cargo" />
                                <span className="text-xs text-muted">{current.codigo}</span>
                                <div style={{ flex: 1 }} />
                                <button className="btn btn-ghost btn-sm" onClick={() => duplicateCargo(current)} title="Duplicar cargo"><FiCopy /> Duplicar</button>
                                <button className="btn btn-ghost btn-sm" onClick={() => removeCargo(current.codigo)} title="Eliminar cargo" style={{ color: 'var(--danger-500)' }}><FiTrash2 /></button>
                            </div>

                            <div className="text-sm text-muted" style={{ marginBottom: 8 }}>Kit de onboarding · {current.kit.length} ítems</div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                {current.kit.map((it, idx) => (
                                    <div key={idx} className="card" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px' }}>
                                        <div style={{ flex: 1, minWidth: 0 }}>
                                            <div style={{ fontWeight: 500, display: 'flex', alignItems: 'center', gap: 6 }}>
                                                {it.codigoEbco && <span className="text-xs" style={{ background: 'var(--surface-hover)', padding: '1px 6px', borderRadius: 4 }}>{it.codigoEbco}</span>}
                                                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.titulo}</span>
                                                {it.bloqueante && <span title="Bloqueante para ingresar a terreno" style={{ color: 'var(--danger-500)', display: 'inline-flex' }}><FiLock size={13} /></span>}
                                            </div>
                                            <div className="text-xs text-muted">
                                                {ACCION_LABEL[it.accion]}{it.notaMinima ? ` · ${it.notaMinima}%` : ''} · {ALCANCE_SHORT[it.alcancePlantilla]}
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
                                        <button className="btn btn-ghost btn-sm" onClick={() => setItemModal({ idx, draft: { ...it } })}><FiEdit2 /></button>
                                        <button className="btn btn-ghost btn-sm" onClick={() => removeItem(idx)} style={{ color: 'var(--danger-500)' }}><FiTrash2 /></button>
                                    </div>
                                ))}
                                {current.kit.length === 0 && <div className="text-sm text-muted" style={{ padding: '8px 4px' }}>Sin ítems. Agrega el primero.</div>}
                            </div>
                            <button className="btn btn-secondary" style={{ marginTop: 10 }} onClick={() => setItemModal({ idx: null, draft: emptyItem() })}><FiPlus /> Agregar ítem</button>
                        </div>
                    )}
                </div>
            </div>

            {/* Modal: nuevo cargo */}
            <Modal isOpen={newCargoOpen} onClose={() => setNewCargoOpen(false)} title="Nuevo cargo"
                subtitle="El código se deriva del nombre. Empieza con kit vacío (o duplica uno existente)."
                footer={<><button className="btn btn-secondary" onClick={() => setNewCargoOpen(false)}>Cancelar</button>
                    <button className="btn btn-primary" disabled={!newCargoLabel.trim()} onClick={addCargo}><FiPlus /> Crear</button></>}>
                <div className="form-group">
                    <label className="form-label">Nombre del cargo</label>
                    <input className="form-input" autoFocus value={newCargoLabel} onChange={(e) => setNewCargoLabel(e.target.value)}
                        placeholder="Ej: Enfierrador" onKeyDown={(e) => e.key === 'Enter' && addCargo()} />
                    {newCargoLabel.trim() && <div className="text-xs text-muted" style={{ marginTop: 6 }}>Código: <b>{codeFromLabel(newCargoLabel)}</b></div>}
                </div>
            </Modal>

            {/* Modal: editar ítem del kit */}
            <Modal isOpen={!!itemModal} onClose={() => setItemModal(null)} title={itemModal?.idx === null ? 'Agregar ítem' : 'Editar ítem'} size="lg"
                footer={<><button className="btn btn-secondary" onClick={() => setItemModal(null)}>Cancelar</button>
                    <button className="btn btn-primary" disabled={!itemModal?.draft.titulo.trim() && !itemModal?.draft.codigoEbco} onClick={saveItem}><FiSave /> Guardar ítem</button></>}>
                {itemModal && (
                    <ItemEditor draft={itemModal.draft} onChange={(draft) => setItemModal({ ...itemModal, draft })} />
                )}
            </Modal>
        </div>
    );
}

// ── Editor de un ítem del kit ────────────────────────────────────────────────
function ItemEditor({ draft, onChange }: { draft: Ds44KitItem; onChange: (d: Ds44KitItem) => void }) {
    const set = (patch: Partial<Ds44KitItem>) => onChange({ ...draft, ...patch });
    const isCap = draft.accion === 'CAPACITACION_EVALUACION';
    const isEpp = draft.accion === 'ENTREGA_EPP';

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div className="form-row" style={{ display: 'grid', gridTemplateColumns: '1fr 160px', gap: 12 }}>
                <div className="form-group"><label className="form-label">Título</label>
                    <input className="form-input" value={draft.titulo} onChange={(e) => set({ titulo: e.target.value })} placeholder="Ej: Trabajos en Altura" /></div>
                <div className="form-group"><label className="form-label">Código EBCO</label>
                    <input className="form-input" value={draft.codigoEbco || ''} onChange={(e) => set({ codigoEbco: e.target.value })} placeholder="PR-PO-08" /></div>
            </div>

            <div className="form-group"><label className="form-label">Acción de onboarding</label>
                <Select value={draft.accion} onChange={(v) => set({ accion: v as Ds44AccionTipo })} options={ACCION_OPTIONS} ariaLabel="Acción" /></div>

            <div className="form-row" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div className="form-group"><label className="form-label">Naturaleza</label>
                    <Select value={draft.naturaleza} onChange={(v) => set({ naturaleza: v as any })} options={NATURALEZA_OPTIONS} ariaLabel="Naturaleza" /></div>
                <div className="form-group"><label className="form-label">Plantilla / alcance</label>
                    <Select value={draft.alcancePlantilla} onChange={(v) => set({ alcancePlantilla: v as any })} options={ALCANCE_OPTIONS} ariaLabel="Alcance" /></div>
            </div>

            {isCap && (
                <div className="form-group"><label className="form-label">Nota mínima (evaluación)</label>
                    <SegmentedControl value={String(draft.notaMinima || 70)} onChange={(v) => set({ notaMinima: Number(v) as 70 | 90 })}
                        options={[{ value: '70', label: '70% (general)' }, { value: '90', label: '90% (altura/SPDC)' }]} /></div>
            )}

            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <input type="checkbox" checked={!!draft.bloqueante} onChange={(e) => set({ bloqueante: e.target.checked })} />
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><FiAlertTriangle size={14} style={{ color: 'var(--warning-500)' }} /> Bloqueante para ingresar a terreno (no bloquea el registro)</span>
            </label>

            {isEpp && <EppMatrixEditor matriz={draft.matrizEpp || []} onChange={(matrizEpp) => set({ matrizEpp })} />}
        </div>
    );
}

// ── Editor de la matriz EPP (solo acción Entrega de EPP) ─────────────────────
function EppMatrixEditor({ matriz, onChange }: { matriz: { descripcion: string; critico?: boolean }[]; onChange: (m: { descripcion: string; critico?: boolean }[]) => void }) {
    const [nuevo, setNuevo] = useState('');
    const add = () => { if (nuevo.trim()) { onChange([...matriz, { descripcion: nuevo.trim() }]); setNuevo(''); } };
    return (
        <div className="card" style={{ padding: 12 }}>
            <div className="text-sm" style={{ fontWeight: 600, marginBottom: 8 }}>Matriz EPP del cargo · {matriz.length}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 8 }}>
                {matriz.map((e, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <input className="form-input" value={e.descripcion} onChange={(ev) => onChange(matriz.map((x, j) => j === i ? { ...x, descripcion: ev.target.value } : x))} style={{ flex: 1 }} />
                        <label className="text-xs" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                            <input type="checkbox" checked={!!e.critico} onChange={(ev) => onChange(matriz.map((x, j) => j === i ? { ...x, critico: ev.target.checked } : x))} /> crítico
                        </label>
                        <button className="btn btn-ghost btn-sm" onClick={() => onChange(matriz.filter((_, j) => j !== i))} style={{ color: 'var(--danger-500)' }}><FiTrash2 size={14} /></button>
                    </div>
                ))}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
                <input className="form-input" value={nuevo} onChange={(e) => setNuevo(e.target.value)} placeholder="Agregar EPP… (ej: Arnés de cuerpo completo)" onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), add())} style={{ flex: 1 }} />
                <button className="btn btn-secondary" onClick={add}><FiPlus /></button>
            </div>
        </div>
    );
}

// ── Control de plantilla por ítem (según alcance) ────────────────────────────
// alcance 'tenant' → se sube aquí (1 archivo para todas las obras).
// alcance 'obra'   → se sube por obra (IRL/MIPER); aquí solo se informa.
// alcance 'persona'→ evidencia individual; no hay plantilla.
function PlantillaControl({ item, uploading, onUpload, onPreview, onRemove }: {
    item: Ds44KitItem; uploading: boolean; onUpload: (file: File) => void; onPreview: () => void; onRemove: () => void;
}) {
    const inputRef = useRef<HTMLInputElement | null>(null);

    if (item.alcancePlantilla === 'obra') {
        return <div className="text-xs" style={{ marginTop: 4, color: 'var(--info-500)' }}>📄 Plantilla por obra (deriva del MIPER · se sube en cada obra)</div>;
    }
    if (item.alcancePlantilla === 'persona' || item.alcancePlantilla === 'ninguno') {
        return <div className="text-xs text-muted" style={{ marginTop: 4 }}>Sin plantilla · {item.accion === 'ENTREGA_EPP' ? 'entrega individual' : 'evidencia individual'}</div>;
    }
    // alcance 'tenant'
    return (
        <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <input ref={inputRef} type="file" hidden accept=".pdf,.png,.jpg,.jpeg,.doc,.docx,.xls,.xlsx"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) onUpload(f); e.target.value = ''; }} />
            {item.plantilla ? (
                <>
                    <span className="text-xs" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: 'rgba(47,170,91,0.12)', color: 'var(--success-500)', padding: '2px 8px', borderRadius: 6, maxWidth: 260, overflow: 'hidden' }}>
                        <FiFile size={12} /> <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.plantilla.nombre}</span>
                    </span>
                    <button className="btn btn-ghost btn-sm" onClick={onPreview} title="Ver plantilla"><FiEye size={13} /></button>
                    <button className="btn btn-ghost btn-sm" disabled={uploading} onClick={() => inputRef.current?.click()} title="Reemplazar">{uploading ? <div className="spinner" /> : <FiUpload size={13} />}</button>
                    <button className="btn btn-ghost btn-sm" onClick={onRemove} title="Quitar plantilla" style={{ color: 'var(--danger-500)' }}><FiTrash2 size={13} /></button>
                </>
            ) : (
                <button className="btn btn-secondary btn-sm" disabled={uploading} onClick={() => inputRef.current?.click()}>
                    {uploading ? <><div className="spinner" /> Subiendo…</> : <><FiUpload size={13} /> Subir plantilla</>}
                </button>
            )}
        </div>
    );
}
