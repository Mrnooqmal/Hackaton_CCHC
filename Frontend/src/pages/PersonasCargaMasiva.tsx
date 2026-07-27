import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiBaseUrl, personasApi } from '../api/client';
import type { BulkPreviewRow, BulkCatalogos, BulkRowInput, BulkResultados } from '../api/personas.api';
import { useAuth } from '../context/AuthContext';
import { FiDownload, FiUpload, FiCheckCircle, FiAlertTriangle, FiInfo, FiX, FiArrowLeft } from 'react-icons/fi';

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

export default function PersonasCargaMasiva() {
    const { user } = useAuth();
    const navigate = useNavigate();
    const tenantId = user?.tenantId || user?.empresaId || localStorage.getItem('tenant_id') || '';

    const [step, setStep] = useState<'form' | 'review' | 'result'>('form');
    const [uploadFile, setUploadFile] = useState<File | null>(null);
    const [sendWelcomeEmail, setSendWelcomeEmail] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [downloadError, setDownloadError] = useState('');
    const [rows, setRows] = useState<EditableRow[]>([]);
    const [catalogos, setCatalogos] = useState<BulkCatalogos | null>(null);
    const [resultado, setResultado] = useState<BulkResultados | null>(null);
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
                setResultado(res.data.resultados);
                setStep('result');
            } else {
                setError(res.error || 'Error al cargar las personas.');
            }
        } catch { setError('Error de conexión. Intenta nuevamente.'); }
        finally { setLoading(false); }
    };

    const reset = () => {
        setStep('form'); setUploadFile(null); setRows([]); setCatalogos(null);
        setResultado(null); setError('');
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    const incluidasOk = rows.filter((r) => r.incluir && r.estado !== 'error').length;
    const conError = rows.filter((r) => r.estado === 'error').length;
    const conAdv = rows.filter((r) => r.estado === 'advertencia').length;

    return (
        <>
            {/* Banner compacto */}
            <div style={{ background: '#002952', padding: 'var(--space-4) var(--space-6) 0' }}>
                <div style={{ maxWidth: 1200, margin: '0 auto' }}>
                    <button type="button" onClick={() => navigate('/personas')} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.7)', fontSize: 'var(--text-sm)', padding: 0, marginBottom: 4 }}>
                        <FiArrowLeft size={14} /> Personas
                    </button>
                    <h1 style={{ margin: 0, fontSize: 'var(--text-xl)', fontWeight: 700, color: 'white', fontFamily: 'var(--font-display)' }}>Carga masiva de personas</h1>
                    <p style={{ margin: '2px 0 0', fontSize: 'var(--text-sm)', color: 'rgba(255,255,255,0.75)' }}>
                        {step === 'form' && 'Descarga la plantilla, complétala y súbela para revisar antes de cargar.'}
                        {step === 'review' && 'Revisa y corrige los datos. Solo se crearán las filas marcadas y sin error.'}
                        {step === 'result' && 'Resultado de la carga.'}
                    </p>
                </div>
                <div style={{ height: 3, background: 'linear-gradient(90deg, #006edc 0%, #df3601 100%)', marginTop: 'var(--space-3)' }} />
            </div>

            <div className="page-content">
                <div style={{ maxWidth: step === 'review' ? 1300 : 900, margin: '0 auto' }}>

                    {error && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: 'var(--space-3) var(--space-4)', borderRadius: 'var(--radius-md)', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', color: 'var(--danger-700)', fontSize: 'var(--text-sm)', marginBottom: 'var(--space-4)' }}>
                            <FiAlertTriangle style={{ flexShrink: 0 }} /> {error}
                        </div>
                    )}

                    {/* ── Paso 1: subir ── */}
                    {step === 'form' && (
                        <form onSubmit={handleValidar} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
                            <div className="cm-section">
                                <div className="cm-section-header"><span className="cm-step-num">1</span>
                                    <div><div className="cm-section-title">Descarga la plantilla</div>
                                        <div className="cm-section-sub">Trae desplegables de rol, cargo y obra de tu empresa.</div></div>
                                </div>
                                <div className="cm-section-body">
                                    <button type="button" className="btn btn-secondary" onClick={handleDownloadTemplate}><FiDownload /> Descargar plantilla Excel</button>
                                    {downloadError && <p style={{ color: 'var(--danger-600)', fontSize: 'var(--text-sm)', marginTop: 8 }}>{downloadError}</p>}
                                    <div style={{ marginTop: 'var(--space-4)', padding: 'var(--space-3) var(--space-4)', borderRadius: 'var(--radius-md)', background: 'var(--surface-elevated)', border: '1px solid var(--surface-border)', fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', lineHeight: 1.7 }}>
                                        <strong style={{ color: 'var(--text-primary)' }}>Obligatorias:</strong> rut, nombre, rol<br />
                                        <strong style={{ color: 'var(--text-primary)' }}>obra:</strong> elígela del desplegable (o escribe el código, varias separadas por coma).<br />
                                        <strong style={{ color: 'var(--text-primary)' }}>supervisor:</strong> RUT del supervisor de la cuadrilla (puede venir en el mismo Excel con rol Supervisor).
                                    </div>
                                </div>
                            </div>

                            <div className="cm-section">
                                <div className="cm-section-header"><span className="cm-step-num">2</span>
                                    <div><div className="cm-section-title">Sube el archivo</div>
                                        <div className="cm-section-sub">Lo validamos y te dejamos revisar antes de crear nada.</div></div>
                                </div>
                                <div className="cm-section-body">
                                    <div className="cm-dropzone" onClick={() => fileInputRef.current?.click()} style={{ borderColor: uploadFile ? 'var(--primary-400)' : undefined, background: uploadFile ? 'rgba(0,110,220,0.04)' : undefined }}>
                                        {uploadFile ? (
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                                                <FiCheckCircle size={24} style={{ color: 'var(--primary-500)', flexShrink: 0 }} />
                                                <div><div style={{ fontWeight: 600, fontSize: 'var(--text-sm)', color: 'var(--primary-600)' }}>{uploadFile.name}</div>
                                                    <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>{(uploadFile.size / 1024).toFixed(1)} KB · Haz clic para cambiar</div></div>
                                                <button type="button" onClick={e => { e.stopPropagation(); setUploadFile(null); if (fileInputRef.current) fileInputRef.current.value = ''; }} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}><FiX /></button>
                                            </div>
                                        ) : (
                                            <><FiUpload size={28} style={{ color: 'var(--text-muted)', marginBottom: 'var(--space-3)' }} />
                                                <div style={{ fontWeight: 600, fontSize: 'var(--text-sm)', color: 'var(--text-primary)' }}>Haz clic para seleccionar</div>
                                                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', marginTop: 4 }}>Solo archivos .xlsx</div></>
                                        )}
                                    </div>
                                    <input ref={fileInputRef} type="file" accept=".xlsx" style={{ display: 'none' }} onChange={e => setUploadFile(e.target.files?.[0] || null)} />
                                </div>
                            </div>

                            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-3)', paddingBottom: 'var(--space-8)' }}>
                                <button type="button" className="btn btn-secondary" onClick={() => navigate('/personas')}>Cancelar</button>
                                <button type="submit" className="btn btn-primary" disabled={loading || !uploadFile}>
                                    {loading ? 'Validando…' : <>Validar y revisar</>}
                                </button>
                            </div>
                        </form>
                    )}

                    {/* ── Paso 2: revisión editable ── */}
                    {step === 'review' && catalogos && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', paddingBottom: 'var(--space-8)' }}>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-3)', alignItems: 'center' }}>
                                <span className="cm-chip cm-chip-ok"><FiCheckCircle size={13} /> {incluidasOk} a cargar</span>
                                <span className="cm-chip cm-chip-adv"><FiInfo size={13} /> {conAdv} con advertencia</span>
                                <span className="cm-chip cm-chip-err"><FiAlertTriangle size={13} /> {conError} con error</span>
                                <label style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8, fontSize: 'var(--text-sm)', cursor: 'pointer' }}>
                                    <input type="checkbox" checked={sendWelcomeEmail} onChange={e => setSendWelcomeEmail(e.target.checked)} />
                                    Enviar credenciales por email
                                </label>
                            </div>

                            <div style={{ border: '1px solid var(--surface-border)', borderRadius: 'var(--radius-md)', overflowX: 'auto' }}>
                                <table className="cm-table">
                                    <thead>
                                        <tr>
                                            <th style={{ width: 36, position: 'sticky', left: 0, zIndex: 2 }}></th>
                                            <th style={{ width: 44 }}>Fila</th>
                                            <th style={{ minWidth: 150 }}>Estado</th>
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
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {rows.map((r, idx) => (
                                            <tr key={r.filaExcel} className={`cm-row cm-row-${r.estado}`} style={{ opacity: r.incluir ? 1 : 0.45 }}>
                                                <td className="cm-sticky-col"><input type="checkbox" checked={r.incluir} onChange={e => updateRow(idx, { incluir: e.target.checked })} title={r.estado === 'error' ? 'No se puede cargar con errores' : 'Incluir en la carga'} /></td>
                                                <td style={{ fontFamily: 'monospace', color: 'var(--text-muted)' }}>{r.filaExcel}</td>
                                                <td>
                                                    {r.estado === 'ok' && <span className="cm-badge cm-badge-ok">Listo</span>}
                                                    {r.estado === 'advertencia' && <span className="cm-badge cm-badge-adv" title={r.advertencias.join(' · ')}>Advertencia</span>}
                                                    {r.estado === 'error' && <span className="cm-badge cm-badge-err" title={r.errores.join(' · ')}>Error</span>}
                                                    {(r.errores.length > 0 || r.advertencias.length > 0) && (
                                                        <div className="cm-msgs">{[...r.errores, ...r.advertencias].join(' · ')}</div>
                                                    )}
                                                </td>
                                                <td><input className="cm-input" style={{ width: 130 }} value={r.nombre} onChange={e => updateRow(idx, { nombre: e.target.value })} /></td>
                                                <td><input className="cm-input" style={{ width: 110 }} value={r.apellidoPaterno || ''} onChange={e => updateRow(idx, { apellidoPaterno: e.target.value })} placeholder="—" /></td>
                                                <td><input className="cm-input" style={{ width: 110 }} value={r.apellidoMaterno || ''} onChange={e => updateRow(idx, { apellidoMaterno: e.target.value })} placeholder="—" /></td>
                                                <td><input className="cm-input" style={{ width: 110, fontFamily: 'monospace' }} value={r.rut} onChange={e => updateRow(idx, { rut: e.target.value })} /></td>
                                                <td><input className="cm-input" style={{ width: 120 }} value={r.fechaNacimiento || ''} onChange={e => updateRow(idx, { fechaNacimiento: e.target.value })} placeholder="AAAA-MM-DD" /></td>
                                                <td><input className="cm-input" style={{ width: 170 }} value={r.email || ''} onChange={e => updateRow(idx, { email: e.target.value })} placeholder="—" /></td>
                                                <td><input className="cm-input" style={{ width: 120 }} value={r.telefono || ''} onChange={e => updateRow(idx, { telefono: e.target.value })} placeholder="—" /></td>
                                                <td>
                                                    <select className="cm-input" style={{ width: 140 }} value={r.rol} onChange={e => updateRow(idx, { rol: e.target.value })}>
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
                                                <td><input className="cm-input" list="cm-obras" style={{ width: 160 }} value={r.obra || ''} onChange={e => updateRow(idx, { obra: e.target.value })} placeholder="—" /></td>
                                                <td><input className="cm-input" list="cm-sups" style={{ width: 130, fontFamily: 'monospace' }} value={r.supervisor || ''} onChange={e => updateRow(idx, { supervisor: e.target.value })} placeholder="—" /></td>
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
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                                <datalist id="cm-obras">{catalogos.obras.map(o => <option key={o.obraId} value={o.label} />)}</datalist>
                                <datalist id="cm-sups">{catalogos.supervisores.map(s => <option key={s.rut} value={s.rut}>{s.nombre}</option>)}</datalist>
                            </div>

                            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-3)' }}>
                                <button type="button" className="btn btn-secondary" onClick={reset} disabled={loading}>Volver</button>
                                <button type="button" className="btn btn-primary" onClick={handleConfirmar} disabled={loading || incluidasOk === 0}>
                                    {loading ? 'Cargando…' : `Confirmar carga (${incluidasOk})`}
                                </button>
                            </div>
                        </div>
                    )}

                    {/* ── Paso 3: resultado ── */}
                    {step === 'result' && resultado && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)', paddingBottom: 'var(--space-8)' }}>
                            <div className="grid-collapse-mobile" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 'var(--space-4)' }}>
                                <div className="cm-stat cm-stat-ok"><FiCheckCircle size={26} /><div className="cm-stat-n">{resultado.creados.length}</div><div className="cm-stat-l">Creados</div></div>
                                <div className="cm-stat cm-stat-adv"><FiInfo size={26} /><div className="cm-stat-n">{resultado.duplicados.length}</div><div className="cm-stat-l">Duplicados</div></div>
                                <div className={`cm-stat ${resultado.errores.length ? 'cm-stat-err' : 'cm-stat-ok'}`}>{resultado.errores.length ? <FiAlertTriangle size={26} /> : <FiCheckCircle size={26} />}<div className="cm-stat-n">{resultado.errores.length}</div><div className="cm-stat-l">Errores</div></div>
                            </div>
                            {(resultado.errores.length > 0 || resultado.duplicados.length > 0) && (
                                <div style={{ border: '1px solid var(--surface-border)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
                                    <table className="cm-table">
                                        <thead><tr><th style={{ width: 60 }}>Fila</th><th>RUT</th><th>Detalle</th></tr></thead>
                                        <tbody>
                                            {resultado.errores.map((e, i) => <tr key={`e${i}`}><td style={{ fontFamily: 'monospace', color: 'var(--danger-600)' }}>{e.fila}</td><td style={{ fontFamily: 'monospace' }}>{e.rut || '—'}</td><td>{e.error}</td></tr>)}
                                            {resultado.duplicados.map((d, i) => <tr key={`d${i}`}><td style={{ fontFamily: 'monospace', color: 'var(--warning-600)' }}>{d.fila}</td><td style={{ fontFamily: 'monospace' }}>{d.rut || '—'}</td><td>{d.motivo}</td></tr>)}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                            <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
                                <button className="btn btn-secondary" onClick={reset}>Cargar otra planilla</button>
                                <button className="btn btn-primary" onClick={() => navigate('/personas')}>Ver personas</button>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            <style>{`
                .cm-section { border: 1px solid var(--surface-border); border-radius: var(--radius-lg); overflow: hidden; background: var(--surface-card); }
                .cm-section-header { display: flex; align-items: flex-start; gap: var(--space-4); padding: var(--space-4) var(--space-6); background: var(--surface-elevated); border-bottom: 1px solid var(--surface-border); }
                .cm-step-num { width: 28px; height: 28px; border-radius: 50%; background: #006edc; color: white; display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 700; flex-shrink: 0; margin-top: 1px; }
                .cm-section-title { font-size: var(--text-base); font-weight: 600; color: var(--text-primary); }
                .cm-section-sub { font-size: var(--text-sm); color: var(--text-secondary); margin-top: 2px; }
                .cm-section-body { padding: var(--space-5) var(--space-6); }
                .cm-dropzone { border: 2px dashed var(--surface-border); border-radius: var(--radius-md); padding: var(--space-8) var(--space-6); text-align: center; cursor: pointer; transition: all 0.2s; background: var(--surface-elevated); }
                .cm-dropzone:hover { border-color: var(--primary-400); background: rgba(0,110,220,0.04); }
                .cm-chip { display: inline-flex; align-items: center; gap: 5px; padding: 4px 10px; border-radius: 999px; font-size: var(--text-xs); font-weight: 600; }
                .cm-chip-ok { background: rgba(34,197,94,0.1); color: var(--success-600); }
                .cm-chip-adv { background: rgba(234,179,8,0.12); color: var(--warning-600); }
                .cm-chip-err { background: rgba(239,68,68,0.1); color: var(--danger-600); }
                .cm-table { width: 100%; border-collapse: collapse; font-size: var(--text-sm); }
                .cm-table th { padding: var(--space-2) var(--space-3); text-align: left; font-weight: 600; color: var(--text-secondary); background: var(--surface-elevated); white-space: nowrap; position: sticky; top: 0; }
                .cm-table td { padding: var(--space-2) var(--space-3); border-top: 1px solid var(--surface-border); vertical-align: top; white-space: nowrap; }
                .cm-table td.cm-sticky-col { position: sticky; left: 0; background: var(--surface-card); z-index: 1; }
                .cm-table thead th:first-child { z-index: 3; background: var(--surface-elevated); }
                .cm-row-error { background: rgba(239,68,68,0.04); }
                .cm-row-advertencia { background: rgba(234,179,8,0.04); }
                .cm-input { width: 100%; min-width: 90px; padding: 4px 6px; border: 1px solid var(--surface-border); border-radius: 6px; background: var(--surface-card); color: var(--text-primary); font-size: var(--text-sm); }
                .cm-input:focus { outline: none; border-color: var(--primary-400); }
                .cm-badge { display: inline-block; padding: 2px 8px; border-radius: 6px; font-size: 11px; font-weight: 600; white-space: nowrap; }
                .cm-badge-ok { background: rgba(34,197,94,0.12); color: var(--success-600); }
                .cm-badge-adv { background: rgba(234,179,8,0.15); color: var(--warning-600); }
                .cm-badge-err { background: rgba(239,68,68,0.12); color: var(--danger-600); }
                .cm-msgs { font-size: 11px; color: var(--text-muted); margin-top: 3px; max-width: 220px; }
                .cm-stat { padding: var(--space-5); border-radius: var(--radius-lg); display: flex; flex-direction: column; align-items: center; gap: 6px; }
                .cm-stat-n { font-size: var(--text-3xl); font-weight: 800; }
                .cm-stat-l { font-size: var(--text-sm); color: var(--text-secondary); }
                .cm-stat-ok { background: rgba(34,197,94,0.08); border: 1px solid rgba(34,197,94,0.25); color: var(--success-600); }
                .cm-stat-adv { background: rgba(234,179,8,0.08); border: 1px solid rgba(234,179,8,0.25); color: var(--warning-600); }
                .cm-stat-err { background: rgba(239,68,68,0.08); border: 1px solid rgba(239,68,68,0.25); color: var(--danger-600); }
            `}</style>
        </>
    );
}
