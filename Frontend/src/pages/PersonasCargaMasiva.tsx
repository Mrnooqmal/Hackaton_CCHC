import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { apiBaseUrl, personasApi } from '../api/client';
import type { BulkPreviewRow, BulkCatalogos, BulkRowInput, CargaEstado, CargaResumen } from '../api/personas.api';
import { useAuth } from '../context/AuthContext';
import { PageHeader } from '../components/ui';
import {
    FiDownload, FiUpload, FiCheckCircle, FiAlertTriangle, FiInfo, FiX,
    FiCheck, FiFilter, FiFileText, FiRefreshCw, FiClock,
} from 'react-icons/fi';

const ESTADO_CARGA_LABEL: Record<CargaEstado['estado'], string> = {
    en_proceso: 'En proceso',
    completada: 'Completada',
    completada_con_errores: 'Completada con filas fallidas',
    encolado_incompleto: 'Detenida: reanúdala',
};

// Validación local del RUT (mod 11) — para re-validar al vuelo mientras se edita.
const rutValido = (rut: string): boolean => {
    const clean = (rut || '').replace(/[.\s-]/g, '').toUpperCase();
    if (clean.length < 2) return false;
    const body = clean.slice(0, -1);
    const dv = clean.slice(-1);
    if (!/^\d+$/.test(body)) return false;
    let sum = 0, mul = 2;
    for (let i = body.length - 1; i >= 0; i -= 1) {
        sum += parseInt(body[i], 10) * mul;
        mul = mul === 7 ? 2 : mul + 1;
    }
    const res = 11 - (sum % 11);
    const dvCalc = res === 11 ? '0' : res === 10 ? 'K' : String(res);
    return dv === dvCalc;
};
const rutKey = (r?: string) => (r || '').replace(/[.-]/g, '').toLowerCase();

// Opciones estáticas (coinciden con los desplegables de la plantilla).
const NIVEL_ESCOLAR_OPC = ['Básica incompleta', 'Básica completa', 'Media incompleta', 'Media completa', 'Técnica', 'Universitaria', 'Postgrado'];
const RELACION_OPC = ['Cónyuge', 'Conviviente', 'Padre', 'Madre', 'Hijo/a', 'Hermano/a', 'Otro familiar', 'Amigo/a'];

type EditableRow = BulkPreviewRow & { incluir: boolean; _origRut: string; _origTenantDup: boolean };

// Re-valida las filas en el cliente (mismas reglas que el backend, salvo la
// existencia en la BD que solo se conoce del backend/al confirmar).
function revalidar(rows: EditableRow[], cat: BulkCatalogos): EditableRow[] {
    const roleSet = new Set(cat.roles.map((r) => r.trim().toLowerCase()));
    const obraSet = new Set<string>();
    cat.obras.forEach((o) => {
        if (o.codigo) obraSet.add(o.codigo.toLowerCase());
        if (o.label) obraSet.add(o.label.toLowerCase());
        if (o.obraId) obraSet.add(o.obraId.toLowerCase());
    });
    const supSet = new Set(cat.supervisores.map((s) => rutKey(s.rut)));
    const counts: Record<string, number> = {};
    rows.forEach((r) => { if (r.incluir) { const k = rutKey(r.rut); if (k) counts[k] = (counts[k] || 0) + 1; } });

    return rows.map((r) => {
        const errores: string[] = [];
        const advertencias: string[] = [];
        if (!r.rut) errores.push('Falta el RUT');
        else if (!rutValido(r.rut)) errores.push('RUT inválido');
        if (!r.nombre) errores.push('Falta el nombre');
        if (!r.rol) errores.push('Falta el rol');
        else if (roleSet.size && !roleSet.has(r.rol.trim().toLowerCase())) errores.push(`El rol "${r.rol}" no existe en la empresa`);
        if (r.incluir && rutKey(r.rut) && counts[rutKey(r.rut)] > 1) errores.push('RUT duplicado en el archivo');
        if (r._origTenantDup && rutKey(r.rut) === rutKey(r._origRut)) errores.push('Ya existe una persona con este RUT');

        if (r.obra) {
            const noRes = String(r.obra).split(',').map((t) => t.trim()).filter(Boolean).filter((t) => !obraSet.has(t.toLowerCase()));
            if (noRes.length) advertencias.push(`Obra no encontrada: ${noRes.join(', ')}`);
        }
        if (r.supervisor) {
            const sk = rutKey(r.supervisor);
            const enArchivo = rows.some((x) => x.incluir && rutKey(x.rut) === sk && (x.rol || '').trim().toLowerCase() === 'supervisor');
            if (!supSet.has(sk) && !enArchivo) advertencias.push(`Supervisor no encontrado (RUT ${r.supervisor})`);
        }
        const estado: EditableRow['estado'] = errores.length ? 'error' : (advertencias.length ? 'advertencia' : 'ok');
        return { ...r, errores, advertencias, estado };
    });
}

const ESTADO_ORDER: Record<string, number> = { error: 0, advertencia: 1, ok: 2 };

const PASOS = [
    { id: 'form', label: 'Subir' },
    { id: 'review', label: 'Revisar y corregir' },
    { id: 'result', label: 'Resultado' },
] as const;

/**
 * Los tres pasos a la vista desde el principio: el que viene ya se anuncia, y
 * queda claro que subir el archivo no crea a nadie todavía.
 */
function Pasos({ actual }: { actual: 'form' | 'review' | 'result' }) {
    const i = PASOS.findIndex((x) => x.id === actual);
    return (
        <ol className="cm-pasos">
            {PASOS.map((paso, idx) => (
                <li key={paso.id} className="cm-paso-wrap">
                    {idx > 0 && <span className="cm-paso-line" aria-hidden="true" />}
                    <span
                        className={`cm-paso${idx === i ? ' cm-paso--on' : ''}${idx < i ? ' cm-paso--done' : ''}`}
                        aria-current={idx === i ? 'step' : undefined}
                    >
                        <span className="cm-paso-num" aria-hidden="true">
                            {idx < i ? <FiCheck size={13} /> : idx + 1}
                        </span>
                        {paso.label}
                    </span>
                </li>
            ))}
        </ol>
    );
}

/**
 * Campo al que apunta un mensaje de validación. El error se marca en la celda
 * culpable, no solo al final de la fila: así se corrige donde se lee.
 */
const campoCulpable = (msg: string): keyof BulkPreviewRow | null => {
    const m = msg.toLowerCase();
    if (m.includes('rut')) return 'rut';
    if (m.includes('nombre')) return 'nombre';
    if (m.includes('rol')) return 'rol';
    if (m.includes('obra')) return 'obra';
    if (m.includes('supervisor')) return 'supervisor';
    return null;
};
const campoConError = (r: EditableRow, campo: keyof BulkPreviewRow) =>
    r.errores.some((e) => campoCulpable(e) === campo);
const campoConAdvertencia = (r: EditableRow, campo: keyof BulkPreviewRow) =>
    r.advertencias.some((e) => campoCulpable(e) === campo);

export default function PersonasCargaMasiva() {
    const { user } = useAuth();
    const navigate = useNavigate();
    const tenantId = user?.tenantId || user?.empresaId || localStorage.getItem('tenant_id') || '';

    const [searchParams, setSearchParams] = useSearchParams();
    const cargaIdUrl = searchParams.get('carga');
    const [step, setStep] = useState<'form' | 'review' | 'result'>(cargaIdUrl ? 'result' : 'form');
    const [uploadFile, setUploadFile] = useState<File | null>(null);
    const [sendWelcomeEmail, setSendWelcomeEmail] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [downloadError, setDownloadError] = useState('');
    const [rows, setRows] = useState<EditableRow[]>([]);
    const [catalogos, setCatalogos] = useState<BulkCatalogos | null>(null);
    // La carga corre en el servidor (D-24): la pantalla solo consulta su avance,
    // y el id va en la URL para poder cerrar y volver.
    const [carga, setCarga] = useState<CargaEstado | null>(null);
    const [recientes, setRecientes] = useState<CargaResumen[]>([]);
    const [reintentando, setReintentando] = useState(false);
    // Con planillas largas lo que importa son las filas que no pasan: el filtro
    // deja ver solo esas sin perder el recuento total, que manda arriba.
    const [soloProblemas, setSoloProblemas] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const readFileAsBase64 = (file: File) => new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            const result = typeof reader.result === 'string' ? reader.result : '';
            resolve(result.includes('base64,') ? result.split('base64,')[1] : result);
        };
        reader.onerror = () => reject(new Error('No se pudo leer el archivo'));
        reader.readAsDataURL(file);
    });

    const handleDownloadTemplate = async () => {
        setDownloadError('');
        try {
            const token = localStorage.getItem('auth_token');
            const params = new URLSearchParams();
            if (tenantId) params.set('tenantId', tenantId);
            const url = `${apiBaseUrl}/personas/plantilla${params.toString() ? `?${params}` : ''}`;
            const response = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : undefined });
            if (!response.ok) { setDownloadError('No fue posible descargar la plantilla.'); return; }
            const blob = await response.blob();
            const link = document.createElement('a');
            link.href = URL.createObjectURL(blob);
            link.download = 'plantilla_personas.xlsx';
            document.body.appendChild(link);
            link.click();
            link.remove();
            URL.revokeObjectURL(link.href);
        } catch { setDownloadError('Error al descargar la plantilla.'); }
    };

    // Paso 1 → 2: valida el archivo (sin crear) y muestra la tabla de revisión.
    const handleValidar = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!uploadFile) { setError('Selecciona un archivo Excel primero.'); return; }
        setLoading(true); setError('');
        try {
            const fileBase64 = await readFileAsBase64(uploadFile);
            const res = await personasApi.bulkValidate(tenantId, { fileBase64, fileName: uploadFile.name });
            if (res.success && res.data) {
                const editables: EditableRow[] = res.data.filas.map((f) => ({
                    ...f,
                    incluir: f.estado !== 'error',
                    _origRut: f.rut,
                    _origTenantDup: (f.errores || []).some((x) => x.includes('Ya existe')),
                }));
                editables.sort((a, b) => (ESTADO_ORDER[a.estado] - ESTADO_ORDER[b.estado]) || (a.filaExcel - b.filaExcel));
                setRows(editables);
                setCatalogos(res.data.catalogos);
                setStep('review');
            } else {
                setError(res.error || 'No se pudo validar el archivo.');
            }
        } catch { setError('Error de conexión. Intenta nuevamente.'); }
        finally { setLoading(false); }
    };

    const updateRow = (idx: number, patch: Partial<EditableRow>) => {
        setRows((prev) => {
            const next = prev.map((r, i) => (i === idx ? { ...r, ...patch } : r));
            return catalogos ? revalidar(next, catalogos) : next;
        });
    };

    // Paso 2 → 3: crea solo las filas incluidas (JSON).
    const handleConfirmar = async () => {
        const incluidas = rows.filter((r) => r.incluir && r.estado !== 'error');
        if (!incluidas.length) { setError('No hay filas válidas para cargar. Corrige o incluye al menos una.'); return; }
        setLoading(true); setError('');
        try {
            const filas: BulkRowInput[] = incluidas.map((r) => ({
                filaExcel: r.filaExcel, rut: r.rut, nombre: r.nombre,
                apellidoPaterno: r.apellidoPaterno, apellidoMaterno: r.apellidoMaterno,
                fechaNacimiento: r.fechaNacimiento, email: r.email, telefono: r.telefono,
                rol: r.rol, cargo: r.cargo, obra: r.obra, supervisor: r.supervisor,
                nivelEscolar: r.nivelEscolar,
                contactoEmergenciaNombre: r.contactoEmergenciaNombre,
                contactoEmergenciaTelefono: r.contactoEmergenciaTelefono,
                contactoEmergenciaRelacion: r.contactoEmergenciaRelacion,
                cursos: r.cursos,
            }));
            const res = await personasApi.bulkConfirm(tenantId, { filas, sendWelcomeEmail });
            if (res.success && res.data) {
                setCarga(null);
                setSearchParams({ carga: res.data.cargaId });
                setStep('result');
            } else {
                setError(res.error || 'Error al cargar las personas.');
            }
        } catch { setError('Error de conexión. Intenta nuevamente.'); }
        finally { setLoading(false); }
    };

    const reset = () => {
        setStep('form'); setUploadFile(null); setRows([]); setCatalogos(null);
        setCarga(null); setSearchParams({}); setError(''); setSoloProblemas(false);
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    const cargarEstado = useCallback(async (id: string) => {
        const r = await personasApi.cargaEstado(id).catch(() => null);
        if (r?.success && r.data) setCarga(r.data);
        else if (r && !r.success) setError(r.error || 'No se pudo leer la carga.');
    }, []);

    // Mientras está en proceso, se consulta cada 2 segundos.
    useEffect(() => {
        if (!cargaIdUrl) return undefined;
        setStep('result');
        cargarEstado(cargaIdUrl);
        const t = setInterval(() => {
            setCarga((c) => { if (!c || c.estado === 'en_proceso') cargarEstado(cargaIdUrl); return c; });
        }, 2000);
        return () => clearInterval(t);
    }, [cargaIdUrl, cargarEstado]);

    useEffect(() => {
        if (step !== 'form') return;
        personasApi.cargasRecientes().then((r) => { if (r.success && r.data) setRecientes(r.data.cargas); }).catch(() => null);
    }, [step]);

    const reintentarFallidas = async () => {
        if (!carga) return;
        setReintentando(true); setError('');
        const r = await personasApi.reintentarCarga(carga.cargaId).catch(() => null);
        setReintentando(false);
        if (r?.success) cargarEstado(carga.cargaId); else setError(r?.error || 'No se pudo reintentar.');
    };

    const incluidasOk = rows.filter((r) => r.incluir && r.estado !== 'error').length;
    const conError = rows.filter((r) => r.estado === 'error').length;
    const conAdv = rows.filter((r) => r.estado === 'advertencia').length;
    const visibles = soloProblemas ? rows.filter((r) => r.estado !== 'ok') : rows;

    return (
        <>
            <div className="page-content">
                <PageHeader
                    banner
                    title="Carga masiva de personas"
                    description={
                        (step === 'form' && 'Nada se crea hasta que revises el archivo. La validación es el paso 2.') ||
                        (step === 'review' && 'Corrige aquí mismo. Solo se crean las filas marcadas y sin error.') ||
                        (step === 'result' && 'Las personas se crean en segundo plano. Puedes cerrar esta pantalla y volver: el avance queda guardado.') ||
                        undefined
                    }
                />
                <div style={{ maxWidth: step === 'review' ? 1300 : 900, margin: '0 auto' }}>

                    <div style={{ marginBottom: 'var(--space-6)' }}><Pasos actual={step} /></div>

                    {error && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: 'var(--space-3) var(--space-4)', borderRadius: 'var(--radius-md)', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', color: 'var(--danger-700)', fontSize: 'var(--text-sm)', marginBottom: 'var(--space-4)' }}>
                            <FiAlertTriangle style={{ flexShrink: 0 }} /> {error}
                        </div>
                    )}

                    {/* ── Paso 1: subir ── */}
                    {step === 'form' && (
                        <form onSubmit={handleValidar} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
                            {/* Cada bloque es un rótulo con regla: la numeración ya
                                la lleva la barra de pasos, y repetirla en cada
                                encabezado contaba dos veces lo mismo. */}
                            <section aria-label="Descarga la plantilla">
                                <div className="cm-rotulo">
                                    <span className="cm-rotulo-title">Descarga la plantilla</span>
                                    <span className="cm-rotulo-sub">Trae los roles y cargos de tu empresa como desplegables.</span>
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)', flexWrap: 'wrap' }}>
                                    <button type="button" className="btn btn-secondary" onClick={handleDownloadTemplate}><FiDownload /> Descargar plantilla Excel</button>
                                    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Obligatorios: RUT, nombre y rol.</span>
                                </div>
                                {downloadError && <p style={{ color: 'var(--danger-600)', fontSize: 'var(--text-sm)', marginTop: 8 }}>{downloadError}</p>}
                                <ul className="cm-reglas">
                                    <li><strong>obra:</strong> elígela del desplegable (o escribe el código; varias separadas por coma).</li>
                                    <li><strong>supervisor:</strong> RUT del supervisor de la cuadrilla (puede venir en el mismo Excel con rol Supervisor).</li>
                                </ul>
                            </section>

                            <section aria-label="Sube el archivo">
                                <div className="cm-rotulo">
                                    <span className="cm-rotulo-title">Sube el archivo</span>
                                    <span className="cm-rotulo-sub">Solo .xlsx</span>
                                </div>
                                <div
                                    className={`cm-dropzone${uploadFile ? ' cm-dropzone--on' : ''}`}
                                    onClick={() => fileInputRef.current?.click()}
                                >
                                    <span className="cm-dropzone-icon"><FiUpload size={24} /></span>
                                    <span className="cm-dropzone-text">
                                        <span className="cm-dropzone-title">Arrastra la plantilla completada</span>
                                        <span className="cm-dropzone-sub">o búscala en tu equipo</span>
                                    </span>
                                    {/* Archivo elegido: se confirma qué se va a validar, antes de validar. */}
                                    {uploadFile && (
                                        <span className="cm-file">
                                            <FiFileText size={16} style={{ color: 'var(--accent-text)', flexShrink: 0 }} />
                                            <span className="cm-file-info">
                                                <span className="cm-file-name">{uploadFile.name}</span>
                                                <span className="cm-file-meta">{(uploadFile.size / 1024).toFixed(1)} KB</span>
                                            </span>
                                            <button
                                                type="button"
                                                aria-label="Quitar archivo"
                                                className="cm-file-x"
                                                onClick={e => { e.stopPropagation(); setUploadFile(null); if (fileInputRef.current) fileInputRef.current.value = ''; }}
                                            >
                                                <FiX size={15} />
                                            </button>
                                        </span>
                                    )}
                                </div>
                                <input ref={fileInputRef} type="file" accept=".xlsx" style={{ display: 'none' }} onChange={e => setUploadFile(e.target.files?.[0] || null)} />
                            </section>

                            <div className="cm-repisa">
                                <span className="cm-repisa-hint">Subir el archivo no crea a nadie: en el paso 2 eliges qué filas se cargan.</span>
                                <button type="button" className="btn btn-secondary" onClick={() => navigate('/personas')}>Cancelar</button>
                                <button type="submit" className="btn btn-primary" disabled={loading || !uploadFile}>
                                    {loading ? 'Validando…' : 'Revisar el archivo'}
                                </button>
                            </div>
                        </form>
                    )}

                    {/* ── Paso 2: revisión editable ── */}
                    {step === 'review' && catalogos && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', paddingBottom: 'var(--space-8)' }}>
                            {/* El recuento manda: dice cuántas entran y cuántas no,
                                antes de la tabla. El error va en naranjo y con punto;
                                la advertencia se carga igual, así que no se tiñe. */}
                            <div className="cm-cuenta">
                                <span className="cm-chip"><strong>{incluidasOk}</strong> se van a crear</span>
                                <span className="cm-chip cm-chip--muted">{conAdv} con advertencia</span>
                                {conError > 0 && (
                                    <span className="cm-chip cm-chip--err">
                                        <span className="cm-dot" aria-hidden="true" />
                                        {conError} con error, no se cargan
                                    </span>
                                )}
                                <span style={{ flex: 1 }} />
                                <label className="cm-check">
                                    <input type="checkbox" checked={sendWelcomeEmail} onChange={e => setSendWelcomeEmail(e.target.checked)} />
                                    Enviar credenciales por email
                                </label>
                                <button
                                    type="button"
                                    className={`cm-filtro${soloProblemas ? ' cm-filtro--on' : ''}`}
                                    aria-pressed={soloProblemas}
                                    onClick={() => setSoloProblemas(v => !v)}
                                >
                                    <FiFilter size={14} /> Solo con problemas
                                </button>
                            </div>

                            <div style={{ border: '1px solid var(--surface-border)', borderRadius: 'var(--radius-md)', overflowX: 'auto' }}>
                                <table className="cm-table">
                                    <thead>
                                        <tr>
                                            <th style={{ width: 36, position: 'sticky', left: 0, zIndex: 2 }}></th>
                                            <th style={{ width: 44 }}>Fila</th>
                                            <th style={{ width: 34 }} aria-label="Estado" />
                                            <th>Nombre</th>
                                            <th>Ap. paterno</th>
                                            <th>Ap. materno</th>
                                            <th>RUT</th>
                                            <th>Fecha nac.</th>
                                            <th>Email</th>
                                            <th>Teléfono</th>
                                            <th>Rol</th>
                                            <th>Cargo</th>
                                            <th>Obra</th>
                                            <th>Supervisor (RUT)</th>
                                            <th>Nivel escolar</th>
                                            <th>Contacto nombre</th>
                                            <th>Contacto teléfono</th>
                                            <th>Contacto relación</th>
                                            <th>Cursos</th>
                                            <th style={{ minWidth: 200 }}>Observación</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {visibles.map((r) => {
                                            const idx = rows.indexOf(r);
                                            const cls = (campo: Parameters<typeof campoConError>[1]) =>
                                                `cm-input${campoConError(r, campo) ? ' cm-input--err' : campoConAdvertencia(r, campo) ? ' cm-input--adv' : ''}`;
                                            return (
                                            <tr key={r.filaExcel} className={`cm-row cm-row-${r.estado}`} style={{ opacity: r.incluir ? 1 : 0.45 }}>
                                                <td className="cm-sticky-col"><input type="checkbox" checked={r.incluir} disabled={r.estado === 'error'} onChange={e => updateRow(idx, { incluir: e.target.checked })} title={r.estado === 'error' ? 'No se puede cargar con errores' : 'Incluir en la carga'} /></td>
                                                <td style={{ fontFamily: 'monospace', color: 'var(--text-muted)' }}>{r.filaExcel}</td>
                                                <td>
                                                    {r.estado === 'ok' && <FiCheck size={15} style={{ color: 'var(--text-secondary)' }} aria-label="Listo" />}
                                                    {r.estado === 'advertencia' && <FiInfo size={15} style={{ color: 'var(--text-secondary)' }} aria-label="Con advertencia" />}
                                                    {r.estado === 'error' && <FiAlertTriangle size={15} style={{ color: 'var(--danger-alerta)' }} aria-label="Con error" />}
                                                </td>
                                                <td><input className={cls('nombre')} style={{ width: 130 }} value={r.nombre} onChange={e => updateRow(idx, { nombre: e.target.value })} /></td>
                                                <td><input className="cm-input" style={{ width: 110 }} value={r.apellidoPaterno || ''} onChange={e => updateRow(idx, { apellidoPaterno: e.target.value })} placeholder="—" /></td>
                                                <td><input className="cm-input" style={{ width: 110 }} value={r.apellidoMaterno || ''} onChange={e => updateRow(idx, { apellidoMaterno: e.target.value })} placeholder="—" /></td>
                                                <td><input className={cls('rut')} style={{ width: 110, fontFamily: 'monospace' }} value={r.rut} onChange={e => updateRow(idx, { rut: e.target.value })} /></td>
                                                <td><input className="cm-input" style={{ width: 120 }} value={r.fechaNacimiento || ''} onChange={e => updateRow(idx, { fechaNacimiento: e.target.value })} placeholder="AAAA-MM-DD" /></td>
                                                <td><input className="cm-input" style={{ width: 170 }} value={r.email || ''} onChange={e => updateRow(idx, { email: e.target.value })} placeholder="—" /></td>
                                                <td><input className="cm-input" style={{ width: 120 }} value={r.telefono || ''} onChange={e => updateRow(idx, { telefono: e.target.value })} placeholder="—" /></td>
                                                <td>
                                                    <select className={cls('rol')} style={{ width: 140 }} value={r.rol} onChange={e => updateRow(idx, { rol: e.target.value })}>
                                                        <option value="">—</option>
                                                        {!catalogos.roles.some(x => x.toLowerCase() === (r.rol || '').toLowerCase()) && r.rol && <option value={r.rol}>{r.rol} (inválido)</option>}
                                                        {catalogos.roles.map(x => <option key={x} value={x}>{x}</option>)}
                                                    </select>
                                                </td>
                                                <td>
                                                    <select className="cm-input" style={{ width: 150 }} value={r.cargo || ''} onChange={e => updateRow(idx, { cargo: e.target.value })}>
                                                        <option value="">—</option>
                                                        {r.cargo && !catalogos.cargos.some(x => x.toLowerCase() === (r.cargo || '').toLowerCase()) && <option value={r.cargo}>{r.cargo}</option>}
                                                        {catalogos.cargos.map(x => <option key={x} value={x}>{x}</option>)}
                                                    </select>
                                                </td>
                                                <td><input className={cls('obra')} list="cm-obras" style={{ width: 160 }} value={r.obra || ''} onChange={e => updateRow(idx, { obra: e.target.value })} placeholder="—" /></td>
                                                <td><input className={cls('supervisor')} list="cm-sups" style={{ width: 130, fontFamily: 'monospace' }} value={r.supervisor || ''} onChange={e => updateRow(idx, { supervisor: e.target.value })} placeholder="—" /></td>
                                                <td>
                                                    <select className="cm-input" style={{ width: 150 }} value={r.nivelEscolar || ''} onChange={e => updateRow(idx, { nivelEscolar: e.target.value })}>
                                                        <option value="">—</option>
                                                        {r.nivelEscolar && !NIVEL_ESCOLAR_OPC.includes(r.nivelEscolar) && <option value={r.nivelEscolar}>{r.nivelEscolar}</option>}
                                                        {NIVEL_ESCOLAR_OPC.map(x => <option key={x} value={x}>{x}</option>)}
                                                    </select>
                                                </td>
                                                <td><input className="cm-input" style={{ width: 130 }} value={r.contactoEmergenciaNombre || ''} onChange={e => updateRow(idx, { contactoEmergenciaNombre: e.target.value })} placeholder="—" /></td>
                                                <td><input className="cm-input" style={{ width: 120 }} value={r.contactoEmergenciaTelefono || ''} onChange={e => updateRow(idx, { contactoEmergenciaTelefono: e.target.value })} placeholder="—" /></td>
                                                <td>
                                                    <select className="cm-input" style={{ width: 130 }} value={r.contactoEmergenciaRelacion || ''} onChange={e => updateRow(idx, { contactoEmergenciaRelacion: e.target.value })}>
                                                        <option value="">—</option>
                                                        {r.contactoEmergenciaRelacion && !RELACION_OPC.includes(r.contactoEmergenciaRelacion) && <option value={r.contactoEmergenciaRelacion}>{r.contactoEmergenciaRelacion}</option>}
                                                        {RELACION_OPC.map(x => <option key={x} value={x}>{x}</option>)}
                                                    </select>
                                                </td>
                                                <td><input className="cm-input" style={{ width: 200 }} value={r.cursos || ''} onChange={e => updateRow(idx, { cursos: e.target.value })} placeholder="Curso 1; Curso 2" /></td>
                                                <td className={r.errores.length ? 'cm-obs cm-obs--err' : 'cm-obs'}>
                                                    {[...r.errores, ...r.advertencias].join(' · ') || '—'}
                                                </td>
                                            </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                                <datalist id="cm-obras">{catalogos.obras.map(o => <option key={o.obraId} value={o.label} />)}</datalist>
                                <datalist id="cm-sups">{catalogos.supervisores.map(s => <option key={s.rut} value={s.rut}>{s.nombre}</option>)}</datalist>
                            </div>

                            <div className="cm-repisa">
                                <button type="button" className="btn btn-secondary" onClick={reset} disabled={loading}>Volver</button>
                                <span style={{ flex: 1 }} />
                                <span className="cm-repisa-hint" style={{ marginRight: 0 }}>
                                    {conError > 0
                                        ? `Las ${conError} filas con error quedan fuera; puedes corregirlas aquí mismo.`
                                        : 'Ninguna fila queda fuera.'}
                                </span>
                                <button type="button" className="btn btn-primary" onClick={handleConfirmar} disabled={loading || incluidasOk === 0}>
                                    {loading ? 'Cargando…' : `Crear ${incluidasOk} persona${incluidasOk !== 1 ? 's' : ''}`}
                                </button>
                            </div>
                        </div>
                    )}

                    {/* ── Paso 3: avance y resultado (D-24) ── */}
                    {step === 'result' && !carga && (
                        <div style={{ display: 'flex', justifyContent: 'center', padding: 'var(--space-8)' }}><div className="spinner" /></div>
                    )}
                    {step === 'result' && carga && (() => {
                        const pct = carga.total ? Math.round((carga.procesadas / carga.total) * 100) : 100;
                        const reintentables = carga.filasFallidas.filter((f) => f.reintentable).length;
                        const pendientes = carga.total - carga.procesadas;
                        return (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)', paddingBottom: 'var(--space-8)' }}>
                                <div>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, marginBottom: 8, flexWrap: 'wrap' }}>
                                        <strong style={{ fontSize: '0.95rem' }}>{ESTADO_CARGA_LABEL[carga.estado]}</strong>
                                        <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{carga.procesadas} de {carga.total} filas</span>
                                    </div>
                                    <div className="cm-progreso" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Avance de la carga">
                                        <div className="cm-progreso-barra" style={{ width: `${pct}%` }} />
                                    </div>
                                </div>
                                <div className="grid-collapse-mobile" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 'var(--space-4)' }}>
                                    <div className="cm-stat cm-stat-ok"><FiCheckCircle size={26} /><div className="cm-stat-n">{carga.creadas}</div><div className="cm-stat-l">Creadas</div></div>
                                    <div className="cm-stat cm-stat-adv"><FiClock size={26} /><div className="cm-stat-n">{pendientes}</div><div className="cm-stat-l">Pendientes</div></div>
                                    <div className={`cm-stat ${carga.fallidas ? 'cm-stat-err' : 'cm-stat-ok'}`}>{carga.fallidas ? <FiAlertTriangle size={26} /> : <FiCheckCircle size={26} />}<div className="cm-stat-n">{carga.fallidas}</div><div className="cm-stat-l">Fallidas</div></div>
                                </div>
                                {carga.creadas > 0 && (
                                    // Quien no tiene correo no recibe nada: la contraseña se la dice en persona quien la registra.
                                    <p style={{ margin: 0, fontSize: '0.88rem', lineHeight: 1.55, color: 'var(--text-secondary)', maxWidth: '72ch' }}>
                                        Cada persona entra con su RUT y, como contraseña inicial, los cuatro primeros dígitos de su RUT;
                                        se le pide cambiarla al entrar. Quien no tiene correo no recibe aviso: díselo en persona.
                                    </p>
                                )}
                                {carga.filasFallidas.length > 0 && (
                                    <div style={{ border: '1px solid var(--surface-border)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
                                        <table className="cm-table">
                                            <thead><tr><th style={{ width: 60 }}>Fila</th><th>RUT</th><th>Motivo</th></tr></thead>
                                            <tbody>
                                                {carga.filasFallidas.map((f) => (
                                                    <tr key={`f${f.fila}-${f.rut}`}>
                                                        <td style={{ fontFamily: 'monospace', color: f.tipoFallo === 'duplicado' ? 'var(--warning-600)' : 'var(--danger-600)' }}>{f.fila}</td>
                                                        <td style={{ fontFamily: 'monospace' }}>{f.rut || '—'}</td>
                                                        <td>{f.motivo}{f.reintentable ? ' (se puede reintentar)' : ''}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                                {(carga.avisos.length > 0 || carga.correosFallidos.length > 0) && (
                                    <div style={{ fontSize: '0.86rem', color: 'var(--text-secondary)', display: 'flex', flexDirection: 'column', gap: 4 }}>
                                        {carga.avisos.map((a) => <span key={`a${a.fila}`}>Fila {a.fila}: {a.aviso}</span>)}
                                        {carga.correosFallidos.map((c) => <span key={`c${c.fila}`}>Fila {c.fila}: {c.correo === 'suprimido' ? 'su correo rebotó antes; no se le escribió' : 'no se pudo enviar el correo de bienvenida'}.</span>)}
                                    </div>
                                )}
                                {carga.fallidas > reintentables && (
                                    <p style={{ margin: 0, fontSize: '0.86rem', color: 'var(--text-secondary)', maxWidth: '72ch' }}>
                                        Las filas con datos inválidos o duplicadas no se reintentan: corrígelas en la planilla y cárgalas de nuevo.
                                    </p>
                                )}
                                <div style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
                                    {(reintentables > 0 || carga.estado === 'encolado_incompleto') && (
                                        <button className="btn btn-primary" onClick={reintentarFallidas} disabled={reintentando}>
                                            <FiRefreshCw size={15} /> {carga.estado === 'encolado_incompleto' ? 'Reanudar la carga' : `Reintentar ${reintentables} fallida${reintentables !== 1 ? 's' : ''}`}
                                        </button>
                                    )}
                                    <button className="btn btn-secondary" onClick={reset}>Cargar otra planilla</button>
                                    <button className="btn btn-secondary" onClick={() => navigate('/personas')}>Ver personas</button>
                                </div>
                            </div>
                        );
                    })()}

                    {step === 'form' && recientes.length > 0 && (
                        <section aria-label="Cargas recientes" style={{ marginTop: 'var(--space-8)' }}>
                            <div className="cm-rotulo"><span className="cm-rotulo-title">Cargas recientes</span></div>
                            <ul className="cm-recientes">
                                {recientes.map((c) => (
                                    <li key={c.cargaId}>
                                        <button type="button" onClick={() => setSearchParams({ carga: c.cargaId })}>
                                            <span>{new Date(c.creadaEn).toLocaleString('es-CL', { dateStyle: 'short', timeStyle: 'short' })}{c.iniciadaPor?.nombre ? ` · ${c.iniciadaPor.nombre}` : ''}</span>
                                            <span>{ESTADO_CARGA_LABEL[c.estado]} · {c.creadas} de {c.total} creadas{c.fallidas ? ` · ${c.fallidas} fallidas` : ''}</span>
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        </section>
                    )}
                </div>
            </div>

            <style>{`
                /* ── Avance de la carga ───────────────────────── */
                .cm-progreso { height: 8px; border-radius: 999px; background: var(--surface-border); overflow: hidden; }
                .cm-progreso-barra { height: 100%; background: var(--primary-600, var(--success-600)); transition: width 400ms cubic-bezier(0.22, 1, 0.36, 1); }
                @media (prefers-reduced-motion: reduce) { .cm-progreso-barra { transition: none; } }
                .cm-recientes { list-style: none; margin: var(--space-3) 0 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
                .cm-recientes button { width: 100%; display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; padding: 10px 12px; background: none; border: 1px solid var(--surface-border); border-radius: var(--radius-md); font: inherit; font-size: 0.86rem; color: var(--text-primary); text-align: left; cursor: pointer; }
                .cm-recientes button:hover { background: var(--surface-hover, rgba(0,0,0,0.03)); }
                .cm-recientes button span:last-child { color: var(--text-secondary); }

                /* ── Pasos ────────────────────────────────────── */
                .cm-pasos { margin: 0; padding: 0; list-style: none; display: flex; align-items: center; flex-wrap: wrap; }
                .cm-paso-wrap { display: flex; align-items: center; gap: 10px; }
                .cm-paso-line { width: 40px; height: 1px; background: var(--surface-border); }
                .cm-paso {
                    display: inline-flex; align-items: center; gap: 9px;
                    font-size: 13px; color: var(--text-secondary); white-space: nowrap;
                }
                .cm-paso--on { color: var(--text-primary); font-weight: 600; }
                .cm-paso-num {
                    display: flex; align-items: center; justify-content: center;
                    width: 26px; height: 26px; border-radius: 50%;
                    border: 1.5px solid var(--surface-border); color: var(--text-muted);
                    font-size: 12px; font-weight: 700; flex-shrink: 0;
                }
                .cm-paso--on .cm-paso-num {
                    background: var(--accent-tint); border-color: var(--accent); color: var(--accent-text);
                }
                .cm-paso--done .cm-paso-num { color: var(--text-secondary); }

                /* ── Rótulo con regla ─────────────────────────── */
                .cm-rotulo {
                    display: flex; align-items: baseline; gap: var(--space-3); flex-wrap: wrap;
                    padding-bottom: 9px; margin-bottom: var(--space-4);
                    border-bottom: 1px solid var(--surface-border);
                }
                .cm-rotulo-title { font-size: var(--text-sm); font-weight: 600; color: var(--text-primary); }
                .cm-rotulo-sub { font-size: 11.5px; color: var(--text-secondary); }
                .cm-reglas {
                    margin: var(--space-4) 0 0; padding-left: 18px;
                    font-size: var(--text-xs); color: var(--text-secondary); line-height: 1.7;
                }
                .cm-reglas strong { color: var(--text-primary); }

                /* ── Zona de arrastre ─────────────────────────── */
                .cm-dropzone {
                    display: flex; flex-direction: column; align-items: center; justify-content: center;
                    gap: 12px; padding: var(--space-8); text-align: center; cursor: pointer;
                    border: 1.5px dashed color-mix(in srgb, var(--surface-border) 55%, var(--text-muted));
                    border-radius: 12px; transition: border-color 0.2s, background 0.2s;
                }
                .cm-dropzone:hover { border-color: var(--accent); }
                .cm-dropzone--on { border-color: color-mix(in srgb, var(--accent) 45%, transparent); }
                .cm-dropzone-icon {
                    display: flex; align-items: center; justify-content: center;
                    width: 52px; height: 52px; border-radius: 50%;
                    border: 1.5px solid var(--surface-border); color: var(--text-muted);
                }
                .cm-dropzone-text { display: flex; flex-direction: column; gap: 4px; }
                .cm-dropzone-title { font-size: 14px; font-weight: 600; color: var(--text-primary); }
                .cm-dropzone-sub { font-size: 12.5px; color: var(--text-secondary); }
                .cm-file {
                    display: inline-flex; align-items: center; gap: 10px; margin-top: 6px;
                    padding: 9px 12px; border: 1px solid var(--surface-border); border-radius: 9px;
                }
                .cm-file-info { display: flex; flex-direction: column; gap: 1px; text-align: left; }
                .cm-file-name { font-size: 12.5px; font-weight: 600; color: var(--text-primary); }
                .cm-file-meta { font-size: 11px; color: var(--text-muted); }
                .cm-file-x {
                    display: flex; padding: 2px; background: none; border: none;
                    color: var(--text-muted); cursor: pointer;
                }
                .cm-file-x:hover { color: var(--danger-alerta); }

                /* ── Repisa de acciones ──────────────────────── */
                .cm-repisa {
                    display: flex; align-items: center; gap: var(--space-3); flex-wrap: wrap;
                    padding-top: 18px; margin-bottom: var(--space-8);
                    border-top: 1px solid var(--surface-border);
                }
                .cm-repisa-hint { font-size: 12px; color: var(--text-muted); margin-right: auto; }

                /* ── Recuento de la revisión ──────────────────── */
                .cm-cuenta { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
                .cm-chip {
                    display: inline-flex; align-items: center; gap: 6px;
                    padding: 5px 12px; border: 1px solid var(--surface-border); border-radius: 9999px;
                    font-size: 12.5px; color: var(--text-primary);
                }
                .cm-chip strong { font-weight: 600; }
                .cm-chip--muted { color: var(--text-secondary); }
                .cm-chip--err {
                    color: var(--danger-alerta);
                    border-color: color-mix(in srgb, var(--danger-alerta) 45%, transparent);
                }
                .cm-dot { width: 5px; height: 5px; border-radius: 50%; background: var(--danger-alerta); }
                .cm-check {
                    display: flex; align-items: center; gap: 8px;
                    font-size: 12.5px; color: var(--text-secondary); cursor: pointer;
                }
                .cm-filtro {
                    display: inline-flex; align-items: center; gap: 7px;
                    padding: 7px 13px; background: none;
                    border: 1px solid var(--surface-border); border-radius: 8px;
                    color: var(--text-primary); font-family: inherit; font-size: 12.5px; cursor: pointer;
                    transition: border-color 0.12s, background 0.12s;
                }
                .cm-filtro:hover { border-color: var(--accent); }
                .cm-filtro--on { border-color: var(--accent); background: var(--accent-tint); color: var(--accent-text); }

                /* ── Tabla de revisión ─────────────────────────
                   La advertencia se carga igual, así que la fila no se tiñe; el
                   error sí bloquea, y se marca con el acento a la izquierda y en
                   la celda culpable. */
                .cm-table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
                .cm-table th {
                    padding: 9px var(--space-3); text-align: left; white-space: nowrap;
                    font-size: 10.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.07em;
                    color: var(--text-secondary); background: var(--surface-card);
                    border-bottom: 1px solid var(--surface-border);
                    position: sticky; top: 0;
                }
                .cm-table td {
                    padding: var(--space-2) var(--space-3); vertical-align: middle; white-space: nowrap;
                    border-top: 1px solid color-mix(in srgb, var(--surface-border) 70%, transparent);
                }
                .cm-table td.cm-sticky-col { position: sticky; left: 0; background: var(--surface-card); z-index: 1; }
                .cm-table thead th:first-child { z-index: 3; }
                .cm-row-error td:first-child { box-shadow: inset 2px 0 0 var(--danger-alerta); }
                .cm-obs { white-space: normal; max-width: 260px; color: var(--text-secondary); font-size: 11.5px; }
                .cm-obs--err { color: var(--danger-alerta); }
                .cm-input {
                    width: 100%; min-width: 90px; padding: 4px 8px;
                    border: 1px solid var(--surface-border); border-radius: 6px;
                    background: none; color: var(--text-primary); font-size: 12.5px; font-family: inherit;
                }
                .cm-input:focus { outline: none; border-color: var(--accent); }
                .cm-input--err { border-color: color-mix(in srgb, var(--danger-alerta) 50%, transparent); color: var(--danger-alerta); }
                .cm-input--adv { border-color: color-mix(in srgb, var(--surface-border) 40%, var(--text-muted)); }

                /* ── Resultado ─────────────────────────────── */
                .cm-stat {
                    padding: var(--space-5); border-radius: 12px;
                    display: flex; flex-direction: column; align-items: center; gap: 6px;
                    border: 1px solid var(--surface-border); color: var(--text-primary);
                }
                .cm-stat-n { font-size: var(--text-3xl); font-weight: 700; font-variant-numeric: tabular-nums; }
                .cm-stat-l { font-size: var(--text-sm); color: var(--text-secondary); }
                .cm-stat-ok { color: var(--success-apagado); }
                .cm-stat-adv { color: var(--text-secondary); }
                .cm-stat-err {
                    color: var(--danger-alerta);
                    border-color: color-mix(in srgb, var(--danger-alerta) 40%, transparent);
                }
            `}</style>
        </>
    );
}
