import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { FiPlus, FiCopy, FiTrash2, FiEdit2, FiLock, FiAlertTriangle, FiUpload, FiEye, FiRefreshCw, FiCheck } from 'react-icons/fi';
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
const ALCANCE_SHORT: Record<string, string> = { tenant: 'empresa', obra: 'obra', persona: 'persona', ninguno: 'sin documento' };

const codeFromLabel = (label: string) =>
    label.trim().toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 32) || 'CARGO';

// Ítems que son de empresa: idénticos en todos los cargos (kitTransversal).
// Se muestran en la sección "Documentos de empresa" — siempre visible, arriba.
const EMPRESA_KEYS = new Set(['RI_76', 'POLITICA_SST']);

// Grupos del kit ESPECÍFICO del cargo. Excluye EMPRESA_KEYS.
const GRUPOS_CARGO: { naturaleza: Ds44KitItem['naturaleza']; titulo: string; sub: string }[] = [
    { naturaleza: 'derivado_miper', titulo: 'IRL del cargo', sub: 'Información de Riesgos Laborales del cargo. Se define una vez por empresa y se capacita a cada trabajador al ingresar.' },
    { naturaleza: 'procedimiento_corporativo', titulo: 'Procedimientos del cargo', sub: 'Capacitaciones y procedimientos operativos propios de este cargo.' },
    { naturaleza: 'evidencia_individual', titulo: 'Evidencia individual', sub: 'Se adjunta al vincular al trabajador a una obra: EPP, exámenes ocupacionales, encuestas.' },
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
    const [syncMsg, setSyncMsg] = useState('');

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
                const n = res.data?.documentosSincronizados || 0;
                setSyncMsg(n > 0 ? `Se sincronizó la plantilla a ${n} documento(s) de trabajadores ya existentes y se les notificó.` : '');
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

    const kitCargo = current ? current.kit.filter((it) => !EMPRESA_KEYS.has(it.key)).length : 0;

    return (
        <div className="page-content">
            <PageHeader
                banner
                title="Onboarding por cargo"
                breadcrumb={[{ label: 'Mi empresa', to: '/mi-empresa' }]}
                description="Documentos base de la empresa y kit de onboarding de cada cargo. Aplican a todas las obras: se suben o renuevan aquí una sola vez."
                actions={
                    <>
                        {dirty && !saving && <span className="co-dirty">Cambios sin guardar</span>}
                        <button className="btn btn-primary" disabled={loading || !dirty || saving} onClick={handleSave}>
                            {saving ? 'Guardando…' : 'Guardar cambios'}
                        </button>
                    </>
                }
            />

            {loading ? <OnboardingCargoSkeleton /> : (
            <div className="co-page">
            {error && <AlertBanner variant="error" message={error} onDismiss={() => setError('')} />}
            {saved && <AlertBanner variant="success" message={`Catálogo de cargos guardado.${syncMsg ? ' ' + syncMsg : ''}`} onDismiss={() => { setSaved(false); setSyncMsg(''); }} />}

            <section className="co-section" aria-labelledby="co-empresa-titulo">
                <div className="co-section-head">
                    <h2 id="co-empresa-titulo" className="co-section-title">Documentos de empresa</h2>
                    <p className="co-section-hint">Aplican a todos los cargos: se envían a cada trabajador nuevo, sin importar la obra.</p>
                </div>
                {empresaItems.length === 0 ? (
                    <p className="co-vacio">
                        Sin documentos de empresa configurados. Agrega un cargo para ver sus documentos base.
                    </p>
                ) : (
                    <div className="co-lista">
                        {empresaItems.map(({ key, it }) => (
                            <div key={key} className="co-empresa-row">
                                <div className="co-item-linea co-empresa-info">
                                    {it.codigoEbco && <span className="co-tag">{it.codigoEbco}</span>}
                                    <span className="co-item-titulo">{it.titulo}</span>
                                    <span className="co-meta">· {ACCION_LABEL[it.accion]}</span>
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
            </section>

            <div className="co-layout">
                <nav className="co-cargos" aria-label="Cargos">
                    <span className="co-cargos-label">Cargos · {cargos.length}</span>
                    {cargos.map((c) => {
                        const activo = selected === c.codigo;
                        return (
                            <button
                                key={c.codigo}
                                type="button"
                                aria-pressed={activo}
                                className={`co-cargo${activo ? ' activo' : ''}`}
                                onClick={() => setSelected(c.codigo)}
                            >
                                <span className="co-cargo-nombre">{c.label}</span>
                                <span className="co-cargo-n">{c.kit.filter((it) => !EMPRESA_KEYS.has(it.key)).length}</span>
                            </button>
                        );
                    })}
                    <div className="co-cargos-acciones">
                        <button type="button" className="co-add co-add--ancho" onClick={() => setNewCargoOpen(true)}>
                            <FiPlus size={14} /> Nuevo cargo
                        </button>
                        <button
                            type="button"
                            className="co-reset"
                            onClick={() => setResetConfirmOpen(true)}
                            title="Restaura todos los cargos al catálogo predefinido EBCO"
                        >
                            <FiRefreshCw size={12} /> Restablecer catálogo
                        </button>
                    </div>
                </nav>

                {!current ? (
                    <div className="co-sin-cargo">Selecciona o crea un cargo para editar su kit.</div>
                ) : (
                    <div className="co-kit">
                        <div className="co-kit-head">
                            <input
                                className="form-input co-cargo-input"
                                value={current.label}
                                onChange={(e) => renameCargo(current.codigo, e.target.value)}
                                aria-label="Nombre del cargo"
                            />
                            <span className="co-codigo">{current.codigo}</span>
                            <span className="co-spacer" />
                            <button type="button" className="btn btn-secondary btn-sm" onClick={() => duplicateCargo(current)}>
                                <FiCopy size={14} /> Duplicar
                            </button>
                            <button type="button" className="btn btn-secondary btn-sm co-texto-alerta" onClick={() => setCargoToDelete(current)}>
                                <FiTrash2 size={14} /> Eliminar
                            </button>
                        </div>

                        {kitCargo === 0 ? (
                            <div className="co-kit-vacio">
                                Sin ítems todavía: empieza agregando el <b>IRL del cargo</b> con «Agregar ítem».
                            </div>
                        ) : GRUPOS_CARGO.map((grupo) => {
                            const items = current.kit
                                .map((it, idx) => ({ it, idx }))
                                .filter(({ it }) => it.naturaleza === grupo.naturaleza && !EMPRESA_KEYS.has(it.key));
                            if (items.length === 0) return null;
                            return (
                                <section key={grupo.naturaleza} className="co-section" aria-label={grupo.titulo}>
                                    <div className="co-section-head">
                                        <h3 className="co-section-title">{grupo.titulo}</h3>
                                        <span className="co-count">{items.length}</span>
                                        <p className="co-section-hint">{grupo.sub}</p>
                                    </div>
                                    <div className="co-lista">
                                        {items.map(({ it, idx }) => (
                                            <div key={idx} className="co-item">
                                                <div className="co-item-main">
                                                    <div className="co-item-linea">
                                                        {it.codigoEbco && <span className="co-tag">{it.codigoEbco}</span>}
                                                        <span className="co-item-titulo">{it.titulo}</span>
                                                        {it.bloqueante && (
                                                            <span className="co-bloq" title="Bloqueante para ingresar a la obra">
                                                                <FiLock size={11} aria-hidden="true" /> Bloqueante
                                                            </span>
                                                        )}
                                                    </div>
                                                    <span className="co-meta">
                                                        {ACCION_LABEL[it.accion]}
                                                        {it.notaMinima ? ` · ${it.notaMinima}%` : ''}
                                                        {' · '}{ALCANCE_SHORT[it.alcancePlantilla]}
                                                        {it.accion === 'ENTREGA_EPP' && it.matrizEpp ? ` · ${it.matrizEpp.length} EPP` : ''}
                                                    </span>
                                                    <div className="co-item-doc">
                                                        <PlantillaControl
                                                            item={it}
                                                            uploading={uploadingItem === idx}
                                                            onUpload={(file) => uploadPlantilla(idx, file)}
                                                            onPreview={() => it.plantilla && previewPlantilla(it.plantilla.fileKey)}
                                                            onRemove={() => setItemPlantilla(idx, undefined)}
                                                        />
                                                    </div>
                                                </div>
                                                <div className="co-item-acciones">
                                                    <button type="button" className="co-icon-btn" onClick={() => setItemDrawer({ idx, draft: { ...it } })}
                                                        aria-label={`Editar ${it.titulo}`} title="Editar ítem"><FiEdit2 size={15} /></button>
                                                    <button type="button" className="co-icon-btn danger" onClick={() => setItemToDelete({ idx, label: it.titulo })}
                                                        aria-label={`Eliminar ${it.titulo}`} title="Eliminar ítem"><FiTrash2 size={15} /></button>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </section>
                            );
                        })}

                        <button type="button" className="co-add" onClick={() => setItemDrawer({ idx: null, draft: emptyItem() })}>
                            <FiPlus size={14} /> Agregar ítem
                        </button>
                    </div>
                )}
            </div>
            </div>
            )}

            {/* Modal: nuevo cargo */}
            <Modal
                isOpen={newCargoOpen}
                onClose={() => setNewCargoOpen(false)}
                title="Nuevo cargo"
                subtitle="El código se deriva del nombre. Después cargas su IRL y sus documentos."
                footer={
                    <>
                        <button className="btn btn-secondary" onClick={() => setNewCargoOpen(false)}>Cancelar</button>
                        <button className="btn btn-primary" disabled={!newCargoLabel.trim()} onClick={addCargo}><FiPlus /> Crear cargo</button>
                    </>
                }
            >
                <div className="form-group">
                    <label className="form-label" htmlFor="co-nuevo-cargo">Nombre del cargo *</label>
                    <input
                        id="co-nuevo-cargo"
                        className="form-input" autoFocus
                        value={newCargoLabel}
                        onChange={(e) => setNewCargoLabel(e.target.value)}
                        placeholder="Ej: Enfierrador"
                        onKeyDown={(e) => e.key === 'Enter' && addCargo()}
                    />
                    {newCargoLabel.trim() && (
                        <div className="co-hint">
                            Código: <span className="co-codigo co-codigo--claro">{codeFromLabel(newCargoLabel)}</span>
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
                <div className="co-aviso">
                    <FiAlertTriangle aria-hidden="true" />
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
                <div className="co-aviso">
                    <FiAlertTriangle aria-hidden="true" />
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
                <div className="co-aviso">
                    <FiAlertTriangle aria-hidden="true" />
                    <span>
                        Se eliminará este ítem del kit del cargo. Deberás <strong>guardar cambios</strong> después para persistir en la base de datos.
                    </span>
                </div>
            </Modal>

            {/* Panel lateral: agregar o editar un ítem del kit */}
            <Drawer
                isOpen={!!itemDrawer}
                onClose={() => setItemDrawer(null)}
                title={itemDrawer?.idx === null ? 'Agregar ítem' : 'Editar ítem'}
                subtitle="Acción, alcance y condiciones del ítem DS44."
                width={560}
                footer={
                    <>
                        <button className="btn btn-secondary" onClick={() => setItemDrawer(null)}>Cancelar</button>
                        <button
                            className="btn btn-primary"
                            disabled={!itemDrawer?.draft.titulo.trim() && !itemDrawer?.draft.codigoEbco}
                            onClick={saveItem}
                        >
                            Guardar ítem
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

            <style>{styles}</style>
        </div>
    );
}

// ── Esqueleto ────────────────────────────────────────────────────────────────
// Mismas clases que la página cargada (co-section, co-empresa-row, co-cargos,
// co-item…), así cada bloque cae donde después cae el contenido.
const Sk = ({ w, h = 12, r, style }: { w?: number | string; h?: number; r?: number; style?: React.CSSProperties }) => (
    <div className="ui-skel" style={{ width: w, height: h, borderRadius: r, flexShrink: 0, ...style }} />
);
/** El bloque mide la letra; la caja, el renglón (line-height) que ocupa el texto real. */
const Txt = ({ w, h, lh, style }: { w: number | string; h: number; lh: number; style?: React.CSSProperties }) => (
    <div style={{ display: 'flex', alignItems: 'center', height: lh, width: typeof w === 'number' ? w : undefined, flex: typeof w === 'number' ? '0 0 auto' : undefined, ...style }}>
        <Sk w={w} h={h} />
    </div>
);
function SeccionHeadSkel({ titulo, hint, conteo }: { titulo: number; hint: number; conteo?: boolean }) {
    return (
        <div className="co-section-head" style={{ alignItems: 'center' }}>
            <Txt w={titulo} h={14} lh={22} />
            {conteo && <Sk w={26} h={22} r={999} />}
            <Txt w={hint} h={10} lh={17} />
        </div>
    );
}
function ItemSkel({ i, tag = true }: { i: number; tag?: boolean }) {
    return (
        <div className="co-item">
            <div className="co-item-main">
                <div className="co-item-linea">
                    {tag && <Sk w={58} h={18} r={5} />}
                    <Txt w={[210, 170, 240, 190][i % 4]} h={13} lh={22.4} />
                </div>
                <Txt w={[200, 150, 180, 220][i % 4]} h={10} lh={19.2} />
                <div className="co-item-doc"><Sk w={[150, 250, 150, 200][i % 4]} h={32} r={8} /></div>
            </div>
            <div className="co-item-acciones"><Sk w={30} h={30} r={6} /><Sk w={30} h={30} r={6} /></div>
        </div>
    );
}
function OnboardingCargoSkeleton() {
    return (
        <div className="co-page" aria-busy="true" aria-live="polite" aria-label="Cargando el onboarding por cargo">
            <section className="co-section">
                <SeccionHeadSkel titulo={170} hint={400} />
                <div className="co-lista">
                    {[0, 1].map((i) => (
                        <div key={i} className="co-empresa-row">
                            <div className="co-item-linea co-empresa-info">
                                <Sk w={52} h={18} r={5} />
                                <Txt w={[320, 290][i]} h={13} lh={22} />
                            </div>
                            <Sk w={[260, 150][i]} h={31} r={7} />
                        </div>
                    ))}
                </div>
            </section>
            <div className="co-layout">
                <div className="co-cargos">
                    <Txt w={80} h={10} lh={18} style={{ padding: '4px 12px 8px', boxSizing: 'content-box' }} />
                    {/* El catálogo predefinido trae 14 cargos. El rótulo de un botón usa
                        line-height normal, no el 1.6 del texto: de ahí el renglón de 15. */}
                    {Array.from({ length: 14 }, (_, i) => (
                        <div key={i} className="co-cargo">
                            <Txt w={[96, 110, 84, 70, 64, 90, 104, 76, 56, 88, 72, 100, 60, 44][i]} h={11} lh={15} />
                            <Sk w={10} h={10} />
                        </div>
                    ))}
                    <div className="co-cargos-acciones">
                        <Sk w="100%" h={40} r={8} />
                        <Sk w={140} h={28} style={{ alignSelf: 'center' }} />
                    </div>
                </div>
                <div className="co-kit">
                    <div className="co-kit-head">
                        <Sk w={340} h={40} r={8} />
                        <Sk w={64} h={10} />
                        <span className="co-spacer" />
                        <Sk w={96} h={32} r={8} />
                        <Sk w={96} h={32} r={8} />
                    </div>
                    <section className="co-section">
                        <SeccionHeadSkel titulo={100} hint={420} conteo />
                        <div className="co-lista"><ItemSkel i={0} /></div>
                    </section>
                    <section className="co-section">
                        <SeccionHeadSkel titulo={170} hint={380} conteo />
                        <div className="co-lista">{[1, 2, 3].map((i) => <ItemSkel key={i} i={i} />)}</div>
                    </section>
                </div>
            </div>
        </div>
    );
}

// ── Editor de un ítem del kit ────────────────────────────────────────────────
function ItemEditor({ draft, onChange }: { draft: Ds44KitItem; onChange: (d: Ds44KitItem) => void }) {
    const set = (patch: Partial<Ds44KitItem>) => onChange({ ...draft, ...patch });
    const isCap = draft.accion === 'CAPACITACION_EVALUACION';
    const isEpp = draft.accion === 'ENTREGA_EPP';

    return (
        <div className="co-editor">
            <div className="co-editor-fila co-editor-fila--codigo">
                <div className="form-group">
                    <label className="form-label" htmlFor="co-item-titulo">Título *</label>
                    <input id="co-item-titulo" className="form-input" value={draft.titulo} onChange={(e) => set({ titulo: e.target.value })} placeholder="Ej: Trabajos en altura" />
                </div>
                <div className="form-group">
                    <label className="form-label" htmlFor="co-item-codigo">Código EBCO</label>
                    <input id="co-item-codigo" className="form-input co-mono" value={draft.codigoEbco || ''} onChange={(e) => set({ codigoEbco: e.target.value })} placeholder="PR-PO-08" />
                </div>
            </div>

            <div className="form-group">
                <label className="form-label">Acción de onboarding</label>
                <Select value={draft.accion} onChange={(v) => set({ accion: v as Ds44AccionTipo })} options={ACCION_OPTIONS} ariaLabel="Acción de onboarding" />
            </div>

            <div className="co-editor-fila">
                <div className="form-group">
                    <label className="form-label">Naturaleza</label>
                    <Select value={draft.naturaleza} onChange={(v) => set({ naturaleza: v as any })} options={NATURALEZA_OPTIONS} ariaLabel="Naturaleza" />
                </div>
                <div className="form-group">
                    <label className="form-label">Alcance del documento</label>
                    <Select value={draft.alcancePlantilla} onChange={(v) => set({ alcancePlantilla: v as any })} options={ALCANCE_OPTIONS} ariaLabel="Alcance del documento" />
                </div>
            </div>

            {isCap && (
                <div className="form-group">
                    <label className="form-label">Nota mínima de la evaluación</label>
                    <SegmentedControl
                        value={String(draft.notaMinima || 70)}
                        onChange={(v) => set({ notaMinima: Number(v) as 70 | 90 })}
                        options={[{ value: '70', label: '70% · general' }, { value: '90', label: '90% · altura y SPDC' }]}
                    />
                </div>
            )}

            <label className="checkbox-row co-check">
                <input
                    type="checkbox"
                    className="checkbox-input custom-checkbox"
                    checked={!!draft.bloqueante}
                    onChange={(e) => set({ bloqueante: e.target.checked })}
                />
                <span>
                    <span className="co-check-titulo">Bloqueante para ingresar a la obra</span>
                    <span className="co-hint">No impide registrar al trabajador; sí que entre a la obra hasta completarlo.</span>
                </span>
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
        <section className="co-matriz" aria-label="Matriz de EPP">
            <div className="co-section-head">
                <h3 className="co-section-title">Matriz de EPP</h3>
                <span className="co-count">{matriz.length}</span>
                <p className="co-section-hint">Un EPP crítico debe entregarse antes de entrar a la obra.</p>
            </div>
            <div className="co-matriz-filas">
                {matriz.map((e, i) => (
                    <div key={i} className="co-matriz-fila">
                        <input
                            className="form-input"
                            aria-label="Elemento de protección"
                            value={e.descripcion}
                            onChange={(ev) => onChange(matriz.map((x, j) => j === i ? { ...x, descripcion: ev.target.value } : x))}
                        />
                        <label className="co-critico">
                            <input
                                type="checkbox"
                                className="checkbox-input custom-checkbox"
                                checked={!!e.critico}
                                onChange={(ev) => onChange(matriz.map((x, j) => j === i ? { ...x, critico: ev.target.checked } : x))}
                            />
                            Crítico
                        </label>
                        <button type="button" className="co-icon-btn danger" aria-label={`Quitar ${e.descripcion || 'EPP'}`}
                            onClick={() => onChange(matriz.filter((_, j) => j !== i))}><FiTrash2 size={15} /></button>
                    </div>
                ))}
            </div>
            <div className="co-matriz-nuevo">
                <input
                    className="form-input"
                    value={nuevo}
                    onChange={(e) => setNuevo(e.target.value)}
                    placeholder="Agregar EPP… (ej: Arnés de cuerpo completo)"
                    aria-label="Nuevo elemento de protección"
                    onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), add())}
                />
                <button type="button" className="co-icon-btn co-icon-btn--borde" aria-label="Agregar EPP" onClick={add}><FiPlus size={15} /></button>
            </div>
        </section>
    );
}

// ── Control de documento por ítem ────────────────────────────────────────────
function PlantillaControl({ item, uploading, onUpload, onPreview, onRemove }: {
    item: Ds44KitItem; uploading: boolean; onUpload: (file: File) => void; onPreview: () => void; onRemove: () => void;
}) {
    const inputRef = useRef<HTMLInputElement | null>(null);

    if (item.alcancePlantilla === 'obra') {
        return <span className="co-doc-nota">Documento por obra: se configura en cada obra, no aquí.</span>;
    }
    if (item.alcancePlantilla === 'persona' || item.alcancePlantilla === 'ninguno') {
        return <span className="co-doc-nota apagada">Sin documento · evidencia individual</span>;
    }
    return (
        <div className="co-doc">
            <input
                ref={inputRef} type="file" hidden accept=".pdf,.png,.jpg,.jpeg,.doc,.docx,.xls,.xlsx"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) onUpload(f); e.target.value = ''; }}
            />
            {item.plantilla ? (
                <>
                    <span className="co-doc-chip" title={item.plantilla.nombre}>
                        <FiCheck size={12} aria-hidden="true" />
                        <span>{item.plantilla.nombre}</span>
                    </span>
                    <button type="button" className="co-icon-btn" onClick={onPreview} aria-label="Ver documento" title="Ver documento"><FiEye size={15} /></button>
                    <button type="button" className="co-icon-btn" disabled={uploading} onClick={() => inputRef.current?.click()}
                        aria-label="Reemplazar documento" title="Reemplazar documento">
                        {uploading ? '…' : <FiUpload size={15} />}
                    </button>
                    <button type="button" className="co-icon-btn danger" onClick={onRemove} aria-label="Quitar documento" title="Quitar documento"><FiTrash2 size={15} /></button>
                </>
            ) : (
                <button type="button" className="btn btn-secondary btn-sm" disabled={uploading} onClick={() => inputRef.current?.click()}>
                    {uploading ? 'Subiendo…' : <><FiUpload size={13} /> Subir documento</>}
                </button>
            )}
        </div>
    );
}

// Traducción del canvas "Onboarding por cargo" (OnboardingCargo*.dc.html): secciones
// con título + regla, recuadros solo por elemento, y color reservado para la acción
// principal, el cargo elegido y dos estados (documento cargado, bloqueante).
const styles = `
.co-page { display: flex; flex-direction: column; gap: var(--space-6); }
.co-dirty { font-size: 12px; color: var(--text-secondary); white-space: nowrap; }

.co-section-head {
    display: flex; align-items: baseline; flex-wrap: wrap; gap: 4px 10px;
    padding-bottom: 9px; margin-bottom: 14px; border-bottom: 1px solid var(--surface-border);
}
.co-section-title { margin: 0; font-size: 14px; font-weight: 600; color: var(--text-primary); }
.co-section-hint { margin: 0; flex: 1 1 320px; font-size: 11.5px; line-height: 1.5; color: var(--text-secondary); }
.co-count {
    padding: 1px 8px; border: 1px solid var(--surface-border); border-radius: 999px;
    font-size: 11.5px; font-weight: 600; color: var(--text-primary); font-variant-numeric: tabular-nums;
}
.co-hint { display: block; margin-top: 4px; font-size: 12px; line-height: 1.5; color: var(--text-secondary); }
.co-vacio { margin: 0; font-size: var(--text-sm); color: var(--text-secondary); }
.co-texto-alerta { color: var(--danger-alerta) !important; }
.co-spacer { flex: 1; }
.co-mono, .co-codigo { font-family: var(--font-mono); }
.co-codigo { font-size: 12px; color: var(--text-muted); }
.co-codigo--claro { color: var(--text-primary); }

.co-lista { display: flex; flex-direction: column; gap: 8px; }
.co-tag {
    padding: 1px 7px; border-radius: 5px; background: var(--surface-hover);
    font-family: var(--font-mono); font-size: 11px; color: var(--text-secondary); white-space: nowrap;
}
.co-item-linea { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; min-width: 0; }
.co-item-titulo { font-size: 14px; font-weight: 600; color: var(--text-primary); }
.co-meta { font-size: 12px; color: var(--text-secondary); }

/* Documentos de empresa */
.co-empresa-row {
    display: flex; align-items: center; flex-wrap: wrap; gap: 12px 16px;
    padding: 12px 16px; border: 1px solid var(--surface-border); border-radius: 12px;
}
.co-empresa-info { flex: 1 1 320px; }
.co-empresa-info .co-item-titulo { font-size: 13.5px; }

/* Cargos + kit */
.co-layout { display: grid; grid-template-columns: 260px minmax(0, 1fr); gap: 28px; align-items: start; }
.co-cargos {
    display: flex; flex-direction: column; gap: 4px; padding: 10px;
    border: 1px solid var(--surface-border); border-radius: 14px;
}
.co-cargos-label {
    padding: 4px 12px 8px; font-size: 11px; font-weight: 700; letter-spacing: .08em;
    text-transform: uppercase; color: var(--text-secondary);
}
.co-cargo {
    display: flex; align-items: center; justify-content: space-between; gap: 8px;
    padding: 9px 12px; border: none; border-radius: 8px; background: none;
    font-family: inherit; font-size: 13px; color: var(--text-primary); text-align: left; cursor: pointer;
    transition: background var(--transition-fast);
}
.co-cargo:hover { background: var(--surface-elevated); }
.co-cargo.activo { background: var(--surface-hover); font-weight: 600; }
.co-cargo-nombre { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.co-cargo-n { flex-shrink: 0; font-size: 11.5px; color: var(--text-muted); font-variant-numeric: tabular-nums; }
.co-cargo.activo .co-cargo-n { color: var(--text-secondary); }
.co-cargos-acciones {
    display: flex; flex-direction: column; gap: 6px;
    margin-top: 8px; padding-top: 10px; border-top: 1px solid var(--surface-border);
}
.co-reset {
    display: inline-flex; align-items: center; justify-content: center; gap: 6px; padding: 6px;
    border: none; background: none; font-family: inherit; font-size: 12px; color: var(--text-muted); cursor: pointer;
}
.co-reset:hover { color: var(--text-primary); }

/* Acción de agregar: trazo discontinuo, igual que en Mi empresa. */
.co-add {
    display: inline-flex; align-items: center; justify-content: center; gap: 8px; align-self: flex-start;
    padding: 9px 16px; border: 1px dashed var(--gray-500); border-radius: var(--radius-md);
    background: none; color: var(--text-primary); font-family: inherit; font-size: 13px; font-weight: 600;
    cursor: pointer; transition: border-color var(--transition-fast), color var(--transition-fast);
}
.co-add:hover { border-color: var(--accent); color: var(--accent-text); }
.co-add--ancho { align-self: stretch; border-radius: 8px; }

.co-kit { display: flex; flex-direction: column; gap: 22px; min-width: 0; }
.co-kit-head { display: flex; align-items: center; flex-wrap: wrap; gap: 12px; }
.co-cargo-input { flex: 1 1 200px; max-width: 340px; height: 40px; font-size: 15px; font-weight: 600; }
.co-kit-vacio {
    padding: var(--space-5); border: 1px dashed var(--gray-500); border-radius: 12px;
    font-size: var(--text-sm); color: var(--text-secondary); text-align: center;
}
.co-sin-cargo {
    padding: var(--space-10); border: 1px dashed var(--gray-500); border-radius: 14px;
    font-size: var(--text-sm); color: var(--text-secondary); text-align: center;
}

.co-item {
    display: flex; align-items: flex-start; gap: 14px;
    padding: 14px 16px; border: 1px solid var(--surface-border); border-radius: 12px;
}
.co-item-main { display: flex; flex-direction: column; gap: 3px; flex: 1; min-width: 0; }
.co-item-doc { margin-top: 8px; }
.co-item-acciones { display: flex; gap: 2px; flex-shrink: 0; }
.co-bloq {
    display: inline-flex; align-items: center; gap: 5px; padding: 2px 9px;
    border: 1px solid var(--surface-border); border-radius: 999px;
    font-size: 11px; font-weight: 500; color: var(--text-primary); white-space: nowrap;
}
.co-bloq svg { color: var(--danger-alerta); }

.co-icon-btn {
    display: flex; align-items: center; justify-content: center; flex-shrink: 0;
    width: 30px; height: 30px; padding: 0; border: none; border-radius: 6px;
    background: none; color: var(--text-muted); cursor: pointer;
    transition: background var(--transition-fast), color var(--transition-fast);
}
.co-icon-btn:hover:not(:disabled) { background: var(--surface-hover); color: var(--text-primary); }
.co-icon-btn.danger:hover:not(:disabled) { color: var(--danger-alerta); }
.co-icon-btn--borde { width: 38px; height: 38px; border: 1px solid var(--surface-border); color: var(--text-primary); }

/* Documento del ítem */
.co-doc { display: flex; align-items: center; flex-wrap: wrap; gap: 4px; }
.co-doc-chip {
    display: inline-flex; align-items: center; gap: 7px; max-width: 280px; margin-right: 2px;
    padding: 5px 10px; border: 1px solid var(--surface-border); border-radius: 7px;
    font-size: 12px; color: var(--text-primary);
}
.co-doc-chip svg { flex-shrink: 0; color: var(--success-apagado); }
.co-doc-chip span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.co-doc-nota { font-size: 12px; color: var(--text-secondary); }
.co-doc-nota.apagada { color: var(--text-muted); }

/* Modales de confirmación */
.co-aviso {
    display: flex; align-items: flex-start; gap: 10px; padding: 10px 12px;
    border-radius: var(--radius-md); background: var(--surface-hover); font-size: var(--text-sm); line-height: 1.5;
}
.co-aviso svg { flex-shrink: 0; margin-top: 3px; color: var(--danger-alerta); }

/* Panel lateral del ítem */
.co-editor { display: flex; flex-direction: column; gap: 18px; padding: var(--space-2) 0; }
.co-editor .form-group { margin-bottom: 0; }
.co-editor-fila { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
.co-editor-fila--codigo { grid-template-columns: minmax(0, 1fr) 150px; }
.co-check { align-items: flex-start; padding: 10px 12px; cursor: pointer; }
.co-check .custom-checkbox { margin-top: 1px; }
.co-check-titulo { display: block; font-size: 13.5px; font-weight: 500; color: var(--text-primary); }
.co-check .co-hint { margin-top: 2px; }

.co-matriz { display: flex; flex-direction: column; }
.co-matriz .co-section-head { margin-bottom: 10px; }
.co-matriz-filas { display: flex; flex-direction: column; gap: 8px; }
.co-matriz-fila { display: flex; align-items: center; gap: 10px; }
.co-matriz-fila .form-input { flex: 1; min-width: 0; }
.co-critico { display: inline-flex; align-items: center; gap: 7px; font-size: 12px; color: var(--text-primary); white-space: nowrap; cursor: pointer; }
.co-matriz-nuevo { display: flex; gap: 8px; margin-top: 10px; }
.co-matriz-nuevo .form-input { flex: 1; min-width: 0; border-style: dashed; }

@media (max-width: 900px) {
  .co-layout { grid-template-columns: minmax(0, 1fr); }
}
@media (max-width: 560px) {
  .co-editor-fila, .co-editor-fila--codigo { grid-template-columns: minmax(0, 1fr); }
}
`;
