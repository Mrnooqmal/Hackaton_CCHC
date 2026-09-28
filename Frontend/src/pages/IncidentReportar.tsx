import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
    FiUpload, FiCamera, FiX, FiMic, FiRefreshCw, FiCheck,
} from 'react-icons/fi';
import { incidentsApi, workersApi, aiApi } from '../api/client';
import type { CreateIncidentData } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useObraContext } from '../context/ObraContext';
import { useToast } from '../context/ToastContext';
import { PERMISSIONS } from '../permissions';
import { FormPage, FieldSection, PageHeader, Select, SegmentedControl } from '../components/ui';
import { ETAPAS_CONSTRUCTIVAS } from '../utils/incidentes';

const INITIAL_FORM: CreateIncidentData = {
    tipo: 'incidente',
    centroTrabajo: '',
    trabajador: { nombre: '', rut: '', genero: '', cargo: '' },
    descripcion: '',
    gravedad: 'leve',
    diasPerdidos: 0,
    evidencias: [],
    clasificacion: 'hallazgo',
    tipoHallazgo: 'condicion',
    etapaConstructiva: '',
};

// Antes era el mismo modal de Incidents.tsx, que cambiaba de campos según
// `clasificacion`; ahora es pantalla completa, como Actividades → Nueva
// actividad. El segmentado "Hallazgo/Incidente" conserva esa idea de un
// solo formulario con dos destinos, en vez de dos páginas separadas.
export default function IncidentReportar() {
    const navigate = useNavigate();
    const location = useLocation();
    const { user, hasPermission } = useAuth();
    const { selectedObraId } = useObraContext();
    const { toast } = useToast();

    const canCreateIncidente = hasPermission(PERMISSIONS.INCIDENTES_REPORTAR);

    const [formData, setFormData] = useState<CreateIncidentData>(() => {
        const prefill = (location.state as any)?.clasificacion;
        return { ...INITIAL_FORM, clasificacion: prefill === 'incidente' ? 'incidente' : 'hallazgo' };
    });
    const esHallazgoForm = formData.clasificacion === 'hallazgo';

    // Un usuario sin permiso para reportar incidentes no puede llegar a esa
    // variante ni por un enlace directo con estado precargado.
    useEffect(() => {
        if (!canCreateIncidente && formData.clasificacion === 'incidente') {
            setFormData((prev) => ({ ...prev, clasificacion: 'hallazgo' }));
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [canCreateIncidente]);

    const [personasTenant, setPersonasTenant] = useState<any[]>([]);
    useEffect(() => {
        workersApi.list().then((res) => {
            if (res.success && res.data) setPersonasTenant(res.data as any[]);
        });
    }, []);

    const [trabajadorSearch, setTrabajadorSearch] = useState('');
    const [showTrabajadorDropdown, setShowTrabajadorDropdown] = useState(false);

    const [afectados, setAfectados] = useState<Array<{ nombre: string; rut: string; cargo: string }>>([{ nombre: '', rut: '', cargo: '' }]);
    const [afectadoSearch, setAfectadoSearch] = useState<string[]>(['']);
    const [showAfectadoDropdown, setShowAfectadoDropdown] = useState<boolean[]>([false]);

    const [confirmaEnvio, setConfirmaEnvio] = useState(false);
    const [uploadedFiles, setUploadedFiles] = useState<File[]>([]);
    const [uploading, setUploading] = useState(false);
    const [formError, setFormError] = useState('');

    /* ----- Cámara ----- */
    const [cameraActive, setCameraActive] = useState(false);
    const [videoStream, setVideoStream] = useState<MediaStream | null>(null);
    const videoRef = useRef<HTMLVideoElement>(null);

    useEffect(() => {
        if (!videoRef.current) return;
        if (videoStream) {
            videoRef.current.srcObject = videoStream;
            videoRef.current.play()?.catch((err) => console.warn('No se pudo reproducir la vista previa de la cámara', err));
        } else {
            videoRef.current.srcObject = null;
        }
    }, [videoStream]);

    const startCamera = async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
            setVideoStream(stream);
            setCameraActive(true);
        } catch (err) {
            console.error('Error accessing camera:', err);
            setFormError('No se pudo acceder a la cámara. Asegúrate de dar los permisos necesarios.');
        }
    };

    const stopCamera = () => {
        videoStream?.getTracks().forEach((track) => track.stop());
        setVideoStream(null);
        setCameraActive(false);
    };

    const capturePhoto = () => {
        if (!videoRef.current) return;
        const canvas = document.createElement('canvas');
        canvas.width = videoRef.current.videoWidth;
        canvas.height = videoRef.current.videoHeight;
        const ctx = canvas.getContext('2d');
        ctx?.drawImage(videoRef.current, 0, 0);
        canvas.toBlob((blob) => {
            if (blob) {
                const file = new File([blob], `incidente_${Date.now()}.jpg`, { type: 'image/jpeg' });
                setUploadedFiles((prev) => [...prev, file]);
                stopCamera();
            }
        }, 'image/jpeg', 0.8);
    };

    /* ----- Dictado con transcripción por IA ----- */
    const [isDictating, setIsDictating] = useState(false);
    const [isTranscribingDesc, setIsTranscribingDesc] = useState(false);
    const dictationRecorderRef = useRef<MediaRecorder | null>(null);
    const dictationChunksRef = useRef<Blob[]>([]);

    const startDictation = async () => {
        setIsDictating(true);
        dictationChunksRef.current = [];
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const mediaRecorder = new MediaRecorder(stream);
            dictationRecorderRef.current = mediaRecorder;
            mediaRecorder.ondataavailable = (e) => {
                if (e.data.size > 0) dictationChunksRef.current.push(e.data);
            };
            mediaRecorder.onstop = async () => {
                setIsDictating(false);
                setIsTranscribingDesc(true);
                stream.getTracks().forEach((t) => t.stop());
                const audioBlob = new Blob(dictationChunksRef.current, { type: 'audio/webm' });
                const reader = new FileReader();
                reader.readAsDataURL(audioBlob);
                reader.onloadend = async () => {
                    const base64 = (reader.result as string).split(',')[1];
                    try {
                        const result = await aiApi.transcribeAudio(base64, 'audio/webm');
                        if (result.success && result.data) {
                            setFormData((prev) => ({
                                ...prev,
                                descripcion: prev.descripcion ? `${prev.descripcion} ${result.data!.text}` : result.data!.text,
                            }));
                        }
                    } catch {
                        setFormError('No se pudo transcribir el audio.');
                    } finally {
                        setIsTranscribingDesc(false);
                    }
                };
            };
            mediaRecorder.start();
            setFormError('');
        } catch {
            setIsDictating(false);
            setFormError('No se pudo acceder al micrófono.');
        }
    };

    const stopDictation = () => {
        if (dictationRecorderRef.current && dictationRecorderRef.current.state !== 'inactive') {
            dictationRecorderRef.current.stop();
        }
    };

    // Libera cámara y micrófono si la persona navega fuera sin cerrar ninguno.
    useEffect(() => () => {
        stopCamera();
        if (dictationRecorderRef.current && dictationRecorderRef.current.state !== 'inactive') {
            dictationRecorderRef.current.stop();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files) setUploadedFiles((prev) => [...prev, ...Array.from(e.target.files!)]);
    };
    const removeFile = (index: number) => setUploadedFiles((prev) => prev.filter((_, i) => i !== index));

    const uploadFiles = async (incidentId: string): Promise<string[]> => {
        const s3Keys: string[] = [];
        for (const file of uploadedFiles) {
            try {
                const urlResponse = await incidentsApi.uploadEvidence({ archivo: file, fileName: file.name, fileType: file.type, incidentId });
                if (urlResponse.success && urlResponse.data) {
                    await fetch(urlResponse.data.uploadUrl, { method: 'PUT', body: file, headers: urlResponse.data.uploadHeaders });
                    s3Keys.push(urlResponse.data.s3Key);
                }
            } catch (error) {
                console.error('Error subiendo archivo:', error);
            }
        }
        return s3Keys;
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (uploading) return;
        if (!selectedObraId) { setFormError('Selecciona una obra antes de reportar.'); return; }
        setFormError('');
        setUploading(true);
        try {
            const tipoEfectivo = esHallazgoForm
                ? (formData.tipoHallazgo === 'accion' ? 'accion_subestandar' : 'condicion_subestandar')
                : formData.tipo;
            const nombreCompleto = [user?.nombre, user?.apellidoPaterno, user?.apellidoMaterno].filter(Boolean).join(' ');
            const payload: CreateIncidentData & { realizadoPor: unknown } = {
                ...formData,
                tipo: tipoEfectivo as CreateIncidentData['tipo'],
                obraId: selectedObraId,
                solicitanteId: user?.personaId,
                reportadoPor: nombreCompleto || 'Usuario',
                realizadoPor: {
                    personaId: user?.personaId || null,
                    nombre: nombreCompleto || '',
                    rut: user?.rut || '',
                    cargo: '',
                },
                tenantId: (user as any)?.tenantId,
                empresaId: (user as any)?.tenantId,
                centroTrabajo: formData.centroTrabajo || '',
                ...(esHallazgoForm && !formData.trabajador.nombre
                    ? { trabajador: { nombre: '', rut: '', genero: '', cargo: '' } }
                    : {}),
                ...(esHallazgoForm && formData.tipoHallazgo === 'accion'
                    ? { afectados: afectados.filter((a) => a.nombre.trim() !== '') }
                    : {}),
            };

            const response = await incidentsApi.create(payload);
            if (response.success && response.data) {
                if (uploadedFiles.length > 0) {
                    const s3Keys = await uploadFiles(response.data.incidentId);
                    if (s3Keys.length > 0) await incidentsApi.update(response.data.incidentId, { evidencias: s3Keys });
                }
                toast.success(esHallazgoForm ? 'Hallazgo reportado correctamente' : 'Incidente reportado correctamente');
                navigate('/incidents');
            } else {
                setFormError(response.error || 'Error al reportar.');
            }
        } catch (error) {
            console.error('Error:', error);
            setFormError('Error de conexión con el servidor.');
        } finally {
            setUploading(false);
        }
    };

    if (!selectedObraId) {
        return (
            <div className="page-content">
                <PageHeader banner title="Reportar" description="Selecciona una obra para reportar un hallazgo o un incidente." />
            </div>
        );
    }

    const buscarPersonas = (q: string) => {
        const query = q.toLowerCase();
        return personasTenant.filter((p) => {
            const fullName = `${p.nombre || ''} ${p.apellido || ''}`.toLowerCase();
            return fullName.includes(query) || (p.rut && p.rut.toLowerCase().includes(query));
        });
    };

    return (
        <>
            <div className="page-content">
                <PageHeader
                    banner
                    title={esHallazgoForm ? 'Reportar hallazgo' : 'Reportar incidente'}
                    description={esHallazgoForm
                        ? 'Una condición o acción subestándar detectada en la obra, antes de que provoque un incidente.'
                        : 'Un accidente o incidente ocurrido durante la jornada.'}
                />
            </div>

            <FormPage
                maxWidth={880}
                onSubmit={handleSubmit}
                header={
                    <div style={{ marginBottom: 'var(--space-8)' }}>
                    <SegmentedControl
                        ariaLabel="Tipo de reporte"
                        fullWidth={false}
                        value={formData.clasificacion || 'hallazgo'}
                        onChange={(v) => setFormData((prev) => ({ ...prev, clasificacion: v as any }))}
                        options={[
                            { value: 'hallazgo', label: 'Hallazgo' },
                            ...(canCreateIncidente ? [{ value: 'incidente', label: 'Incidente' }] : []),
                        ]}
                    />
                    </div>
                }
                actions={
                    <>
                        {formError ? (
                            <span style={{ marginRight: 'auto', fontSize: 'var(--text-sm)', color: 'var(--danger-600)' }}>{formError}</span>
                        ) : (
                            <span style={{ marginRight: 'auto', fontSize: '12px', color: 'var(--text-muted)' }}>
                                {esHallazgoForm ? 'Se notifica al equipo de prevención de la obra.' : 'Se notifica a prevención y al jefe directo de inmediato.'}
                            </span>
                        )}
                        <button type="button" className="btn btn-secondary" onClick={() => navigate('/incidents')} disabled={uploading}>
                            Cancelar
                        </button>
                        <button type="submit" className="btn btn-primary" disabled={uploading}>
                            {uploading ? 'Enviando…' : esHallazgoForm ? 'Reportar hallazgo' : 'Reportar incidente'}
                        </button>
                    </>
                }
            >
                <FieldSection title={esHallazgoForm ? 'Tipo de hallazgo' : 'Detalles del incidente'} inline cols={3}>
                    {esHallazgoForm && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
                            <label className="form-label">Tipo de hallazgo <span style={{ color: 'var(--accent-text)' }}>*</span></label>
                            <Select
                                ariaLabel="Tipo de hallazgo"
                                value={formData.tipoHallazgo}
                                onChange={(v) => setFormData((prev) => ({ ...prev, tipoHallazgo: v as any }))}
                                options={[
                                    { value: 'condicion', label: 'Condición subestándar' },
                                    { value: 'accion', label: 'Acción subestándar' },
                                ]}
                            />
                            <span className="form-hint">Condición: un elemento o entorno inseguro. Acción: una conducta insegura de una persona.</span>
                        </div>
                    )}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
                        <label className="form-label">Etapa constructiva</label>
                        <Select
                            ariaLabel="Etapa constructiva"
                            placeholder="Seleccionar etapa…"
                            searchable
                            value={formData.etapaConstructiva}
                            onChange={(v) => setFormData((prev) => ({ ...prev, etapaConstructiva: v }))}
                            options={ETAPAS_CONSTRUCTIVAS.map((etapa) => ({ value: etapa, label: etapa }))}
                        />
                    </div>
                    {!esHallazgoForm && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
                            <label className="form-label">Gravedad <span style={{ color: 'var(--accent-text)' }}>*</span></label>
                            <Select
                                ariaLabel="Gravedad"
                                value={formData.gravedad}
                                onChange={(v) => setFormData((prev) => ({ ...prev, gravedad: v as any }))}
                                options={[
                                    { value: 'leve', label: 'Leve' },
                                    { value: 'grave', label: 'Grave' },
                                    { value: 'fatal', label: 'Fatal' },
                                ]}
                            />
                        </div>
                    )}
                </FieldSection>

                {!esHallazgoForm && (
                    <FieldSection title="Trabajador afectado" inline>
                        <div className="full-width" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
                            <label className="form-label">Buscar trabajador</label>
                            <div style={{ position: 'relative' }}>
                                <input
                                    type="text"
                                    className="form-input"
                                    placeholder="Escribe nombre o RUT…"
                                    value={trabajadorSearch}
                                    autoComplete="off"
                                    onChange={(e) => {
                                        setTrabajadorSearch(e.target.value);
                                        setShowTrabajadorDropdown(true);
                                        if (!e.target.value) setFormData((prev) => ({ ...prev, trabajador: { nombre: '', rut: '', genero: '', cargo: '' } }));
                                    }}
                                    onFocus={() => setShowTrabajadorDropdown(true)}
                                    onBlur={() => setTimeout(() => setShowTrabajadorDropdown(false), 150)}
                                />
                                {showTrabajadorDropdown && trabajadorSearch.length > 0 && (() => {
                                    const filtered = buscarPersonas(trabajadorSearch);
                                    return (
                                        <div className="inc-autocomplete">
                                            {filtered.length === 0 ? (
                                                <div className="inc-autocomplete-empty">No se encontraron trabajadores</div>
                                            ) : filtered.map((p: any) => (
                                                <button
                                                    key={p.personaId || p.workerId}
                                                    type="button"
                                                    className="inc-autocomplete-option"
                                                    onMouseDown={() => {
                                                        const nombre = `${p.nombre || ''} ${p.apellido || ''}`.trim();
                                                        setTrabajadorSearch(nombre);
                                                        setShowTrabajadorDropdown(false);
                                                        setFormData((prev) => ({
                                                            ...prev,
                                                            trabajador: { nombre, rut: p.rut || '', genero: p.genero || '', cargo: p.cargo || p.puesto || '' },
                                                        }));
                                                    }}
                                                >
                                                    <span className="inc-autocomplete-name">{p.nombre} {p.apellido || ''}</span>
                                                    <span className="inc-autocomplete-meta">{p.rut}{p.cargo ? ` · ${p.cargo}` : p.puesto ? ` · ${p.puesto}` : ''}</span>
                                                </button>
                                            ))}
                                        </div>
                                    );
                                })()}
                            </div>
                            {formData.trabajador.nombre && (
                                <p className="form-hint" style={{ color: 'var(--primary-400)' }}>
                                    <FiCheck style={{ display: 'inline', marginRight: '4px' }} />
                                    {formData.trabajador.nombre}{formData.trabajador.rut ? ` — ${formData.trabajador.rut}` : ''}{formData.trabajador.cargo ? ` · ${formData.trabajador.cargo}` : ''}
                                </p>
                            )}
                        </div>
                    </FieldSection>
                )}

                {esHallazgoForm && formData.tipoHallazgo === 'accion' && (
                    <FieldSection title="Trabajador(es) afectado(s)" inline description="Opcional">
                        <div className="full-width" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                            {afectados.map((afectado, idx) => (
                                <div key={idx}>
                                    <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'flex-start' }}>
                                        <div style={{ position: 'relative', flex: 1 }}>
                                            <input
                                                type="text"
                                                className="form-input"
                                                placeholder="Buscar por nombre o RUT…"
                                                value={afectadoSearch[idx] ?? ''}
                                                autoComplete="off"
                                                onChange={(e) => {
                                                    const next = [...afectadoSearch]; next[idx] = e.target.value; setAfectadoSearch(next);
                                                    const nextDrop = [...showAfectadoDropdown]; nextDrop[idx] = true; setShowAfectadoDropdown(nextDrop);
                                                    if (!e.target.value) setAfectados(afectados.map((a, i) => (i === idx ? { nombre: '', rut: '', cargo: '' } : a)));
                                                }}
                                                onFocus={() => { const nextDrop = [...showAfectadoDropdown]; nextDrop[idx] = true; setShowAfectadoDropdown(nextDrop); }}
                                                onBlur={() => setTimeout(() => { const nextDrop = [...showAfectadoDropdown]; nextDrop[idx] = false; setShowAfectadoDropdown(nextDrop); }, 150)}
                                            />
                                            {showAfectadoDropdown[idx] && (afectadoSearch[idx] ?? '').length > 0 && (() => {
                                                const filtered = buscarPersonas(afectadoSearch[idx] ?? '');
                                                return (
                                                    <div className="inc-autocomplete">
                                                        {filtered.length === 0 ? (
                                                            <div className="inc-autocomplete-empty">No se encontraron trabajadores</div>
                                                        ) : filtered.map((p: any) => (
                                                            <button
                                                                key={p.personaId || p.workerId}
                                                                type="button"
                                                                className="inc-autocomplete-option"
                                                                onMouseDown={() => {
                                                                    const nombre = `${p.nombre || ''} ${p.apellido || ''}`.trim();
                                                                    const next = [...afectadoSearch]; next[idx] = nombre; setAfectadoSearch(next);
                                                                    const nextDrop = [...showAfectadoDropdown]; nextDrop[idx] = false; setShowAfectadoDropdown(nextDrop);
                                                                    setAfectados(afectados.map((a, i) => (i === idx ? { nombre, rut: p.rut || '', cargo: p.cargo || p.puesto || '' } : a)));
                                                                }}
                                                            >
                                                                <span className="inc-autocomplete-name">{p.nombre} {p.apellido || ''}</span>
                                                                <span className="inc-autocomplete-meta">{p.rut}{p.cargo ? ` · ${p.cargo}` : p.puesto ? ` · ${p.puesto}` : ''}</span>
                                                            </button>
                                                        ))}
                                                    </div>
                                                );
                                            })()}
                                        </div>
                                        {afectados.length > 1 && (
                                            <button
                                                type="button"
                                                className="btn btn-secondary btn-icon"
                                                onClick={() => {
                                                    setAfectados(afectados.filter((_, i) => i !== idx));
                                                    setAfectadoSearch(afectadoSearch.filter((_, i) => i !== idx));
                                                    setShowAfectadoDropdown(showAfectadoDropdown.filter((_, i) => i !== idx));
                                                }}
                                            >
                                                <FiX size={14} />
                                            </button>
                                        )}
                                    </div>
                                    {afectado.nombre && (
                                        <p className="form-hint" style={{ color: 'var(--primary-400)', marginTop: 'var(--space-2)' }}>
                                            <FiCheck size={13} style={{ display: 'inline', marginRight: '4px' }} />
                                            {afectado.nombre}{afectado.rut ? ` — ${afectado.rut}` : ''}{afectado.cargo ? ` · ${afectado.cargo}` : ''}
                                        </p>
                                    )}
                                </div>
                            ))}
                            <button
                                type="button"
                                className="btn btn-secondary btn-sm"
                                style={{ alignSelf: 'flex-start' }}
                                onClick={() => {
                                    setAfectados([...afectados, { nombre: '', rut: '', cargo: '' }]);
                                    setAfectadoSearch([...afectadoSearch, '']);
                                    setShowAfectadoDropdown([...showAfectadoDropdown, false]);
                                }}
                            >
                                Agregar afectado
                            </button>
                        </div>
                    </FieldSection>
                )}

                <FieldSection title="Descripción" inline>
                    <div className="full-width" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                            <label className="form-label" style={{ margin: 0 }}>Detalle <span style={{ color: 'var(--accent-text)' }}>*</span></label>
                            <button
                                type="button"
                                className="inc-dictate-btn"
                                data-state={isDictating ? 'recording' : isTranscribingDesc ? 'busy' : 'idle'}
                                title={isDictating ? 'Detener grabación' : isTranscribingDesc ? 'Transcribiendo…' : 'Dictar descripción con voz'}
                                onClick={isDictating ? stopDictation : startDictation}
                                disabled={isTranscribingDesc}
                            >
                                {isTranscribingDesc ? (
                                    <><FiRefreshCw size={14} className="inc-spin" /> Transcribiendo…</>
                                ) : isDictating ? (
                                    <><span className="inc-rec-dot" /> Grabando · Detener</>
                                ) : (
                                    <><FiMic size={14} /> Dictar</>
                                )}
                            </button>
                        </div>
                        <textarea
                            className="form-input"
                            rows={5}
                            placeholder={esHallazgoForm
                                ? 'Describe el hallazgo observado: condición o acción detectada, lugar exacto, posibles riesgos asociados…'
                                : 'Describe con detalle lo ocurrido, incluyendo circunstancias, lugar exacto, hora aproximada y cualquier información relevante…'}
                            value={formData.descripcion}
                            onChange={(e) => setFormData((prev) => ({ ...prev, descripcion: e.target.value }))}
                            required
                        />
                        <span className="form-hint">
                            {esHallazgoForm ? 'Incluye toda la información que permita verificar y gestionar el hallazgo.' : 'Sé lo más específico posible para facilitar la investigación.'}
                        </span>
                    </div>
                </FieldSection>

                <FieldSection title="Evidencia fotográfica" inline description="Opcional, pero ayuda a la revisión">
                    <div className="full-width" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                        <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'stretch' }}>
                            <div className="upload-zone" style={{ flex: 1 }}>
                                <input type="file" id="inc-file-upload" className="hidden" multiple accept="image/*" onChange={handleFileSelect} />
                                <label htmlFor="inc-file-upload" className="upload-label">
                                    <FiUpload size={22} className="text-muted mb-1" />
                                    <p className="font-semibold" style={{ fontSize: 'var(--text-sm)' }}>Seleccionar fotos</p>
                                    <p className="text-xs text-muted">PNG, JPG hasta 10MB</p>
                                </label>
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', flexShrink: 0 }}>
                                <button type="button" className="inc-camera-btn" data-active={cameraActive} onClick={cameraActive ? capturePhoto : startCamera}>
                                    <FiCamera size={20} />
                                    {cameraActive ? 'Capturar' : 'Cámara'}
                                </button>
                                {cameraActive && (
                                    <button type="button" className="btn btn-ghost btn-sm" onClick={stopCamera}>
                                        <FiX size={13} /> Cerrar
                                    </button>
                                )}
                            </div>
                        </div>

                        {cameraActive && (
                            <div className="inc-camera-preview">
                                <div className="inc-camera-live"><span className="inc-rec-dot" /> Cámara activa — presiona Capturar para tomar la foto</div>
                                <video ref={videoRef} autoPlay playsInline />
                            </div>
                        )}

                        {uploadedFiles.length > 0 && (
                            <div>
                                <p className="text-sm font-semibold mb-2">{uploadedFiles.length} archivo(s) seleccionado(s)</p>
                                <div className="inc-evidence-grid">
                                    {uploadedFiles.map((file, index) => (
                                        <div key={index} className="inc-evidence-thumb">
                                            <img src={URL.createObjectURL(file)} alt={file.name} />
                                            <button type="button" className="inc-evidence-remove" onClick={() => removeFile(index)} aria-label={`Quitar ${file.name}`}>
                                                <FiX size={13} />
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                </FieldSection>

                <FieldSection title="Confirmación de envío" inline>
                    <div className="full-width inc-confirm-box">
                        <div className="inc-confirm-meta">
                            <span>Reportado por <strong>{[user?.nombre, user?.apellidoPaterno, user?.apellidoMaterno].filter(Boolean).join(' ')}</strong></span>
                            <span>{new Date().toLocaleString('es-CL')}</span>
                        </div>
                        <label className="inc-confirm-check">
                            <input
                                type="checkbox"
                                className="checkbox-input custom-checkbox"
                                checked={confirmaEnvio}
                                onChange={(e) => setConfirmaEnvio(e.target.checked)}
                                required
                            />
                            <span>
                                <span className="inc-confirm-text">
                                    {esHallazgoForm
                                        ? 'Declaro que el hallazgo reportado ha sido observado directamente y es comprobable en el lugar.'
                                        : 'Declaro que la información proporcionada corresponde fielmente a los hechos ocurridos.'}
                                </span>
                                <span className="inc-confirm-hint">Esta declaración queda registrada con tu nombre y es verificable por cargos superiores.</span>
                            </span>
                        </label>
                    </div>
                </FieldSection>
            </FormPage>

            <style>{`
                .inc-autocomplete {
                    position: absolute; top: calc(100% + 4px); left: 0; right: 0; z-index: 60;
                    background: var(--surface-card); border: 1px solid var(--surface-border);
                    border-radius: var(--radius-md); box-shadow: var(--shadow-xl);
                    max-height: 220px; overflow-y: auto;
                }
                .inc-autocomplete-empty { padding: 12px 14px; color: var(--text-muted); font-size: var(--text-sm); }
                .inc-autocomplete-option {
                    width: 100%; display: flex; flex-direction: column; gap: 2px;
                    padding: 10px 14px; border: none; border-bottom: 1px solid var(--surface-border);
                    background: transparent; cursor: pointer; text-align: left;
                }
                .inc-autocomplete-option:hover { background: var(--surface-hover); }
                .inc-autocomplete-name { font-weight: 600; font-size: var(--text-sm); color: var(--text-primary); }
                .inc-autocomplete-meta { font-size: var(--text-xs); color: var(--text-muted); font-family: var(--font-mono); }

                .inc-dictate-btn {
                    display: inline-flex; align-items: center; gap: 7px; padding: 6px 14px; min-height: 34px;
                    border-radius: var(--radius-full); border: 1.5px solid var(--surface-border);
                    background: var(--surface-hover); color: var(--text-secondary);
                    font-size: var(--text-sm); font-weight: 500; cursor: pointer; flex-shrink: 0;
                    transition: all var(--transition-fast); font-family: inherit;
                }
                .inc-dictate-btn[data-state='recording'] { border-color: var(--danger-500); background: rgba(244,67,54,0.10); color: var(--danger-400); }
                .inc-dictate-btn[data-state='busy'] { border-color: var(--primary-500); background: var(--accent-tint); color: var(--primary-400); cursor: not-allowed; }
                .inc-rec-dot { width: 9px; height: 9px; border-radius: 50%; background: var(--danger-500); display: inline-block; flex-shrink: 0; animation: inc-pulse 1s ease-in-out infinite; }
                .inc-spin { animation: inc-spin 1s linear infinite; }
                @keyframes inc-spin { to { transform: rotate(360deg); } }
                @keyframes inc-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }

                .inc-camera-btn {
                    display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 5px;
                    padding: var(--space-3); min-width: 76px; flex: 1;
                    border: 1.5px solid var(--surface-border); border-radius: var(--radius-md);
                    background: var(--surface-hover); color: var(--text-secondary);
                    cursor: pointer; font-size: var(--text-xs); font-weight: 600; font-family: inherit;
                    transition: all var(--transition-fast);
                }
                .inc-camera-btn[data-active='true'] { border-color: var(--primary-500); background: var(--accent-tint); color: var(--primary-400); }

                .inc-camera-preview { border-radius: var(--radius-lg); overflow: hidden; border: 1.5px solid var(--primary-500); background: #000; }
                .inc-camera-live {
                    padding: 6px 12px; display: flex; align-items: center; gap: 8px;
                    background: var(--accent-tint); border-bottom: 1px solid rgba(0,110,220,0.25);
                    font-size: var(--text-xs); color: var(--primary-400); font-weight: 600;
                }
                .inc-camera-preview video { width: 100%; max-height: 240px; object-fit: cover; display: block; }

                .inc-evidence-grid { display: flex; flex-wrap: wrap; gap: var(--space-3); }
                .inc-evidence-thumb {
                    position: relative; width: 86px; height: 86px; flex-shrink: 0;
                    border-radius: var(--radius-md); overflow: hidden;
                    border: 1px solid var(--surface-border); background: var(--surface-elevated);
                }
                .inc-evidence-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
                .inc-evidence-remove {
                    position: absolute; top: 4px; right: 4px; width: 20px; height: 20px; border-radius: 50%;
                    border: none; background: rgba(0,0,0,0.55); color: #fff;
                    display: flex; align-items: center; justify-content: center; cursor: pointer; padding: 0;
                }

                .inc-confirm-box { background: var(--surface-elevated); border: 1px solid var(--surface-border); border-radius: var(--radius-lg); overflow: hidden; }
                .inc-confirm-meta {
                    display: flex; gap: var(--space-6); flex-wrap: wrap; padding: var(--space-4);
                    border-bottom: 1px solid var(--surface-border); background: var(--surface-card);
                    font-size: var(--text-sm); color: var(--text-secondary);
                }
                .inc-confirm-meta strong { color: var(--text-primary); }
                .inc-confirm-check { display: flex; align-items: flex-start; gap: var(--space-3); padding: var(--space-4); cursor: pointer; }
                .inc-confirm-check input { margin-top: 3px; flex-shrink: 0; accent-color: var(--primary-500); }
                .inc-confirm-text { display: block; font-size: var(--text-sm); font-weight: 500; color: var(--text-primary); }
                .inc-confirm-hint { display: block; font-size: var(--text-xs); color: var(--text-muted); margin-top: var(--space-1); }
            `}</style>
        </>
    );
}
