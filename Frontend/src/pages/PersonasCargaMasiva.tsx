import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiBaseUrl, personasApi } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { FiDownload, FiUpload, FiCheckCircle, FiAlertTriangle, FiInfo, FiX, FiArrowLeft, FiCopy } from 'react-icons/fi';

interface UploadResultados {
    creados: any[];
    duplicados: any[];
    errores: Array<{ fila: number; error: string }>;
}

interface UploadResult {
    mensaje: string;
    resultados: UploadResultados;
}

export default function PersonasCargaMasiva() {
    const { user } = useAuth();
    const navigate = useNavigate();

    const tenantId = user?.tenantId || user?.empresaId || localStorage.getItem('tenant_id') || '';

    const [uploadFile, setUploadFile] = useState<File | null>(null);
    const [sendWelcomeEmail, setSendWelcomeEmail] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [uploadResult, setUploadResult] = useState<UploadResult | null>(null);
    const [uploadError, setUploadError] = useState('');
    const [downloadError, setDownloadError] = useState('');
    const [step, setStep] = useState<'form' | 'result'>('form');
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

    const handleUpload = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!uploadFile) { setUploadError('Selecciona un archivo Excel primero.'); return; }
        setUploading(true); setUploadError('');
        try {
            const fileBase64 = await readFileAsBase64(uploadFile);
            const res = await personasApi.bulkUpload(tenantId, {
                fileBase64,
                fileName: uploadFile.name,
                sendWelcomeEmail,
            });
            if (res.success && res.data) {
                setUploadResult(res.data as UploadResult);
                setStep('result');
            } else {
                setUploadError(res.error || 'Error en la carga masiva.');
            }
        } catch { setUploadError('Error de conexión. Intenta nuevamente.'); }
        finally { setUploading(false); }
    };

    const resetForm = () => {
        setUploadFile(null);
        setUploadResult(null);
        setUploadError('');
        setStep('form');
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    const creados = uploadResult?.resultados?.creados?.length ?? 0;
    const duplicados = uploadResult?.resultados?.duplicados?.length ?? 0;
    const errores = uploadResult?.resultados?.errores?.length ?? 0;
    const hasErrors = errores > 0;
    const allOk = creados > 0 && !hasErrors;

    return (
        <>
            {/* CChC navy banner */}
            <div style={{
                background: '#002952',
                padding: 'var(--space-5) var(--space-8) 0',
                position: 'relative',
            }}>
                <div style={{ maxWidth: 900, margin: '0 auto' }}>
                    <button type="button" onClick={() => navigate('/personas')} style={{
                        display: 'inline-flex', alignItems: 'center', gap: 6,
                        background: 'none', border: 'none', cursor: 'pointer',
                        color: 'rgba(255,255,255,0.7)', fontSize: 'var(--text-sm)', padding: 0,
                        marginBottom: 'var(--space-2)',
                    }}>
                        <FiArrowLeft size={14} /> Personas
                    </button>
                    <h1 style={{ margin: 0, fontSize: 'var(--text-2xl)', fontWeight: 700, color: 'white', fontFamily: 'var(--font-display)' }}>
                        Carga masiva de personas
                    </h1>
                    <p style={{ margin: 'var(--space-1) 0 0', fontSize: 'var(--text-sm)', color: 'rgba(255,255,255,0.75)' }}>
                        Importa múltiples trabajadores desde una planilla Excel.
                    </p>
                </div>
                <div style={{ height: 3, background: 'linear-gradient(90deg, #006edc 0%, #df3601 100%)', marginTop: 'var(--space-6)' }} />
            </div>

            <div className="page-content">
                <div style={{ maxWidth: 900, margin: '0 auto' }}>

                    {/* ── Result view ── */}
                    {step === 'result' && uploadResult && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
                            {/* Summary row */}
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 'var(--space-4)' }}>
                                <div style={{ padding: 'var(--space-5)', borderRadius: 'var(--radius-lg)', background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.25)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--space-2)' }}>
                                    <FiCheckCircle size={28} style={{ color: 'var(--success-500)' }} />
                                    <div style={{ fontSize: 'var(--text-3xl)', fontWeight: 800, color: 'var(--success-600)' }}>{creados}</div>
                                    <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>Creados</div>
                                </div>
                                <div style={{ padding: 'var(--space-5)', borderRadius: 'var(--radius-lg)', background: 'rgba(234,179,8,0.08)', border: '1px solid rgba(234,179,8,0.25)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--space-2)' }}>
                                    <FiInfo size={28} style={{ color: 'var(--warning-500)' }} />
                                    <div style={{ fontSize: 'var(--text-3xl)', fontWeight: 800, color: 'var(--warning-600)' }}>{duplicados}</div>
                                    <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>Duplicados (ignorados)</div>
                                </div>
                                <div style={{ padding: 'var(--space-5)', borderRadius: 'var(--radius-lg)', background: hasErrors ? 'rgba(239,68,68,0.08)' : 'rgba(34,197,94,0.05)', border: `1px solid ${hasErrors ? 'rgba(239,68,68,0.25)' : 'rgba(34,197,94,0.15)'}`, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--space-2)' }}>
                                    {hasErrors ? <FiAlertTriangle size={28} style={{ color: 'var(--danger-500)' }} /> : <FiCheckCircle size={28} style={{ color: 'var(--success-500)' }} />}
                                    <div style={{ fontSize: 'var(--text-3xl)', fontWeight: 800, color: hasErrors ? 'var(--danger-600)' : 'var(--success-600)' }}>{errores}</div>
                                    <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>Errores</div>
                                </div>
                            </div>

                            {/* Result message */}
                            <div style={{ padding: 'var(--space-4) var(--space-5)', borderRadius: 'var(--radius-md)', background: allOk ? 'rgba(34,197,94,0.07)' : hasErrors ? 'rgba(239,68,68,0.07)' : 'rgba(234,179,8,0.07)', border: `1px solid ${allOk ? 'rgba(34,197,94,0.2)' : hasErrors ? 'rgba(239,68,68,0.2)' : 'rgba(234,179,8,0.2)'}`, fontWeight: 500, color: 'var(--text-primary)' }}>
                                {uploadResult.mensaje}
                            </div>

                            {/* Error table */}
                            {hasErrors && (
                                <div>
                                    <h3 style={{ fontSize: 'var(--text-base)', fontWeight: 600, marginBottom: 'var(--space-3)', color: 'var(--danger-600)' }}>
                                        Filas con error
                                    </h3>
                                    <div style={{ border: '1px solid var(--surface-border)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
                                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--text-sm)' }}>
                                            <thead>
                                                <tr style={{ background: 'var(--surface-elevated)' }}>
                                                    <th style={{ padding: 'var(--space-3) var(--space-4)', textAlign: 'left', fontWeight: 600, color: 'var(--text-secondary)', width: 80 }}>Fila</th>
                                                    <th style={{ padding: 'var(--space-3) var(--space-4)', textAlign: 'left', fontWeight: 600, color: 'var(--text-secondary)' }}>Error</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {uploadResult.resultados.errores.map((err, idx) => (
                                                    <tr key={idx} style={{ borderTop: '1px solid var(--surface-border)', background: idx % 2 === 0 ? 'transparent' : 'var(--surface-elevated)' }}>
                                                        <td style={{ padding: 'var(--space-3) var(--space-4)', fontFamily: 'monospace', fontWeight: 600, color: 'var(--danger-600)' }}>{err.fila}</td>
                                                        <td style={{ padding: 'var(--space-3) var(--space-4)', color: 'var(--text-secondary)' }}>{err.error}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            )}

                            <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
                                <button className="btn btn-secondary" onClick={resetForm}>
                                    Cargar otra planilla
                                </button>
                                <button className="btn btn-primary" onClick={() => navigate('/personas')}>
                                    Ver personas
                                </button>
                            </div>
                        </div>
                    )}

                    {/* ── Upload form ── */}
                    {step === 'form' && (
                        <form onSubmit={handleUpload} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-8)' }}>
                            {/* Step 1: Template */}
                            <div className="cm-section">
                                <div className="cm-section-header">
                                    <span className="cm-step-num">1</span>
                                    <div>
                                        <div className="cm-section-title">Descarga la plantilla</div>
                                        <div className="cm-section-sub">Usa la plantilla oficial para asegurar el formato correcto de los datos.</div>
                                    </div>
                                </div>
                                <div className="cm-section-body">
                                    <button type="button" className="btn btn-secondary" onClick={handleDownloadTemplate}>
                                        <FiDownload /> Descargar plantilla Excel
                                    </button>
                                    {downloadError && <p style={{ color: 'var(--danger-600)', fontSize: 'var(--text-sm)', marginTop: 8 }}>{downloadError}</p>}
                                    <div style={{ marginTop: 'var(--space-4)', display: 'flex', flexDirection: 'column', gap: 8 }}>
                                        <div style={{ padding: 'var(--space-3) var(--space-4)', borderRadius: 'var(--radius-md)', background: 'var(--surface-elevated)', border: '1px solid var(--surface-border)', fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', lineHeight: 1.7 }}>
                                            <strong style={{ color: 'var(--text-primary)' }}>Requeridas:</strong> rut, nombre, apellidoPaterno, email, rol<br />
                                            <strong style={{ color: 'var(--text-primary)' }}>Opcionales:</strong> apellidoMaterno, telefono, cargo, fechaNacimiento, nivelEscolar, cursos<br />
                                            <strong style={{ color: 'var(--text-primary)' }}>Asignación a obra:</strong> <code style={{ fontFamily: 'monospace', fontSize: '0.88em', background: 'var(--surface-card)', padding: '1px 5px', borderRadius: 3, border: '1px solid var(--surface-border)' }}>obraId</code>
                                        </div>
                                        <div style={{ padding: 'var(--space-3) var(--space-4)', borderRadius: 'var(--radius-md)', background: 'rgba(0,110,220,0.04)', border: '1px solid rgba(0,110,220,0.15)', fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', lineHeight: 1.7 }}>
                                            <strong style={{ color: 'var(--text-primary)', display: 'block', marginBottom: 4 }}>Columna obraId</strong>
                                            Acepta el UUID de la obra (cópialo desde el detalle de la obra con el botón <FiCopy size={11} style={{ display: 'inline', verticalAlign: 'middle' }} />):<br />
                                            <span style={{ fontFamily: 'monospace', letterSpacing: '0.02em', color: '#006edc', fontSize: '0.9em' }}>a1b2c3d4-e5f6-7890-abcd-ef1234567890</span><br />
                                            Para asignar personas a <strong>múltiples obras</strong>, importa el archivo una vez por cada obra con su <code style={{ fontFamily: 'monospace' }}>obraId</code> correspondiente.
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Step 2: Options */}
                            <div className="cm-section">
                                <div className="cm-section-header">
                                    <span className="cm-step-num">2</span>
                                    <div>
                                        <div className="cm-section-title">Opciones de importación</div>
                                        <div className="cm-section-sub">La obra se asigna por la columna <code style={{ fontFamily: 'monospace', fontSize: '0.9em' }}>obraId</code> del Excel.</div>
                                    </div>
                                </div>
                                <div className="cm-section-body">
                                    <label style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-3)', cursor: 'pointer', padding: 'var(--space-3) var(--space-4)', borderRadius: 'var(--radius-md)', border: `1px solid ${sendWelcomeEmail ? 'var(--primary-400)' : 'var(--surface-border)'}`, background: sendWelcomeEmail ? 'rgba(0,110,220,0.05)' : 'transparent', transition: 'all 0.2s', maxWidth: 420 }}>
                                        <input type="checkbox" checked={sendWelcomeEmail} onChange={e => setSendWelcomeEmail(e.target.checked)} style={{ marginTop: 2 }} />
                                        <div>
                                            <div style={{ fontWeight: 600, fontSize: 'var(--text-sm)' }}>Enviar credenciales por email</div>
                                            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', marginTop: 2 }}>Notifica a cada persona con acceso web que sus credenciales están listas</div>
                                        </div>
                                    </label>
                                </div>
                            </div>

                            {/* Step 3: Upload */}
                            <div className="cm-section">
                                <div className="cm-section-header">
                                    <span className="cm-step-num">3</span>
                                    <div>
                                        <div className="cm-section-title">Sube el archivo</div>
                                        <div className="cm-section-sub">Selecciona el archivo Excel con los datos completados.</div>
                                    </div>
                                </div>
                                <div className="cm-section-body">
                                    <div
                                        className="cm-dropzone"
                                        onClick={() => fileInputRef.current?.click()}
                                        style={{ borderColor: uploadFile ? 'var(--primary-400)' : undefined, background: uploadFile ? 'rgba(0,110,220,0.04)' : undefined }}
                                    >
                                        {uploadFile ? (
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                                                <FiCheckCircle size={24} style={{ color: 'var(--primary-500)', flexShrink: 0 }} />
                                                <div>
                                                    <div style={{ fontWeight: 600, fontSize: 'var(--text-sm)', color: 'var(--primary-600)' }}>{uploadFile.name}</div>
                                                    <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>{(uploadFile.size / 1024).toFixed(1)} KB · Haz clic para cambiar</div>
                                                </div>
                                                <button
                                                    type="button"
                                                    onClick={e => { e.stopPropagation(); setUploadFile(null); if (fileInputRef.current) fileInputRef.current.value = ''; }}
                                                    style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}
                                                >
                                                    <FiX />
                                                </button>
                                            </div>
                                        ) : (
                                            <>
                                                <FiUpload size={28} style={{ color: 'var(--text-muted)', marginBottom: 'var(--space-3)' }} />
                                                <div style={{ fontWeight: 600, fontSize: 'var(--text-sm)', color: 'var(--text-primary)' }}>Haz clic para seleccionar</div>
                                                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', marginTop: 4 }}>Solo archivos .xlsx</div>
                                            </>
                                        )}
                                    </div>
                                    <input ref={fileInputRef} type="file" accept=".xlsx" style={{ display: 'none' }} onChange={e => setUploadFile(e.target.files?.[0] || null)} />

                                    {uploadError && (
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', padding: 'var(--space-3) var(--space-4)', borderRadius: 'var(--radius-md)', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', color: 'var(--danger-700)', fontSize: 'var(--text-sm)', marginTop: 'var(--space-3)' }}>
                                            <FiAlertTriangle style={{ flexShrink: 0 }} /> {uploadError}
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* Actions */}
                            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-3)', paddingBottom: 'var(--space-8)' }}>
                                <button type="button" className="btn btn-secondary" onClick={() => navigate('/personas')}>Cancelar</button>
                                <button type="submit" className="btn btn-primary" disabled={uploading || !uploadFile}>
                                    {uploading ? 'Procesando…' : <><FiUpload /> Importar personas</>}
                                </button>
                            </div>
                        </form>
                    )}
                </div>
            </div>

            <style>{`
                .cm-section {
                    border: 1px solid var(--surface-border);
                    border-radius: var(--radius-lg);
                    overflow: hidden;
                    background: var(--surface-card);
                }
                .cm-section-header {
                    display: flex;
                    align-items: flex-start;
                    gap: var(--space-4);
                    padding: var(--space-4) var(--space-6);
                    background: var(--surface-elevated);
                    border-bottom: 1px solid var(--surface-border);
                }
                .cm-step-num {
                    width: 28px; height: 28px; border-radius: 50%;
                    background: #006edc; color: white;
                    display: flex; align-items: center; justify-content: center;
                    font-size: 12px; font-weight: 700; flex-shrink: 0; margin-top: 1px;
                }
                .cm-section-title {
                    font-size: var(--text-base); font-weight: 600; color: var(--text-primary);
                }
                .cm-section-sub {
                    font-size: var(--text-sm); color: var(--text-secondary); margin-top: 2px;
                }
                .cm-section-body {
                    padding: var(--space-5) var(--space-6);
                }
                .cm-dropzone {
                    border: 2px dashed var(--surface-border);
                    border-radius: var(--radius-md);
                    padding: var(--space-8) var(--space-6);
                    text-align: center;
                    cursor: pointer;
                    transition: all 0.2s;
                    background: var(--surface-elevated);
                }
                .cm-dropzone:hover {
                    border-color: var(--primary-400);
                    background: rgba(0,110,220,0.04);
                }
            `}</style>
        </>
    );
}
