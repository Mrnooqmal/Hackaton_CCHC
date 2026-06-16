import { useState, useEffect, useRef, useCallback } from 'react';
import type { KeyboardEvent } from 'react';
import {
    FiPlus, FiAlertTriangle, FiX, FiUpload, FiImage,
    FiUser, FiCalendar, FiActivity,
    FiAlertCircle, FiFileText, FiSave,
    FiPieChart, FiList, FiBarChart2, FiCheck, FiArrowRight,
    FiMic, FiCamera, FiRefreshCw
} from 'react-icons/fi';
import { incidentsApi, aiApi, workersApi } from '../api/client';
import type { Incident, CreateIncidentData, IncidentStats, AnalyticsData, IncidentLocation } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useObraContext } from '../context/ObraContext';
import { PERMISSIONS } from '../permissions';
import { Modal, Select } from '../components/ui';

const INCIDENT_EVIDENCE_BASE_URL = (import.meta.env.VITE_INCIDENT_EVIDENCE_BASE_URL || '').replace(/\/+$/, '');

const buildEvidenceUrl = (s3Key: string) => {
    if (!s3Key) return '';
    if (/^https?:\/\//i.test(s3Key)) {
        return s3Key;
    }
    if (s3Key.startsWith('s3://')) {
        const withoutScheme = s3Key.replace('s3://', '');
        const [bucket, ...keyParts] = withoutScheme.split('/');
        return keyParts.length > 0
            ? `https://${bucket}.s3.amazonaws.com/${keyParts.join('/')}`
            : '';
    }
    if (INCIDENT_EVIDENCE_BASE_URL) {
        const sanitizedKey = s3Key.replace(/^\/+/, '');
        return `${INCIDENT_EVIDENCE_BASE_URL}/${sanitizedKey}`;
    }
    return '';
};

// Construction phases for the dropdown
const ETAPAS_CONSTRUCTIVAS = [
    'Excavaciones',
    'Fundaciones',
    'Obra Gruesa',
    'Instalaciones Sanitarias',
    'Instalaciones Eléctricas',
    'Terminaciones',
    'Obras Exteriores',
    'Otro'
];


export default function Incidents() {
    const { user, hasPermission } = useAuth();
    const { selectedObraId, obras } = useObraContext();
    const selectedObra = obras.find(o => o.obraId === selectedObraId) ?? null;
    const [incidents, setIncidents] = useState<Incident[]>([]);
    const [stats, setStats] = useState<IncidentStats | null>(null);
    const [_analytics, setAnalytics] = useState<AnalyticsData | null>(null);
    const [loading, setLoading] = useState(true);
    const [showModal, setShowModal] = useState(false);
    const [selectedIncident, setSelectedIncident] = useState<Incident | null>(null);
    const [detailLoading, setDetailLoading] = useState(false);
    const [detailError, setDetailError] = useState('');
    const [imagePreview, setImagePreview] = useState<{ url: string; title: string } | null>(null);
    const [_showFilters, _setShowFilters] = useState(false);
    const [activeTab, setActiveTab] = useState<'listado' | 'estadisticas'>('listado');
    const [filters, _setFilters] = useState({
        tipo: '',
        estado: '',
        fechaInicio: '',
        fechaFin: ''
    });

    // Form state with enhanced fields for Phase 4
    const [formData, setFormData] = useState<CreateIncidentData>({
        tipo: 'incidente',
        centroTrabajo: '',
        trabajador: {
            nombre: '',
            rut: '',
            genero: '',
            cargo: ''
        },
        descripcion: '',
        gravedad: 'leve',
        diasPerdidos: 0,
        evidencias: [],
        // New fields for Phase 4
        clasificacion: 'incidente',
        tipoHallazgo: 'condicion',
        etapaConstructiva: ''
    });


    const [confirmaEnvio, setConfirmaEnvio] = useState(false);
    const [uploadedFiles, setUploadedFiles] = useState<File[]>([]);
    const [uploading, setUploading] = useState(false);
    const [location, setLocation] = useState<IncidentLocation | null>(null);
    const [isGettingLocation, setIsGettingLocation] = useState(false);
    // El mensaje de error de ubicación ya no se muestra en la UI; se conserva el setter
    const [, setLocationError] = useState('');

    const [_chartMetric, _setChartMetric] = useState<'total' | 'accidentes' | 'incidentes'>('total');
    const [calendarMonth, setCalendarMonth] = useState(new Date());
    const [showSuccess, setShowSuccess] = useState(false);
    const [formError, setFormError] = useState('');

    // ─── Reunion 2026-06-10: hallazgos vs incidentes ──────────────────────────
    // Incidentes/accidentes: creacion restringida a supervisor y superiores.
    const canCreateIncidente = hasPermission(PERMISSIONS.INCIDENTES_REPORTAR);
    const canVerEstadisticas = hasPermission(PERMISSIONS.INCIDENTES_ESTADISTICAS);
    const canVerHistorial = hasPermission(PERMISSIONS.INCIDENTES_HISTORIAL);
    const canCalificarAccidente = hasPermission(PERMISSIONS.INCIDENTES_CALIFICAR_ACCIDENTE);
    const [listTab, setListTab] = useState<'hallazgos' | 'incidentes'>('incidentes');
    const esHallazgo = (inc: Incident) =>
        (inc as any).clasificacion === 'hallazgo' || ['condicion_subestandar', 'accion_subestandar'].includes(inc.tipo);

    // Reporte flash (datos minimos, editable en investigacion)
    const [flashMode, setFlashMode] = useState(false);
    const [flashAfectados, setFlashAfectados] = useState<Array<{ nombre: string; rut: string; cargo: string }>>([{ nombre: '', rut: '', cargo: '' }]);
    const [flashDescripcion, setFlashDescripcion] = useState('');
    const [flashUbicacion, setFlashUbicacion] = useState('');

    // Gobernanza de hallazgos (panel supervisor+)
    const [gobIncident, setGobIncident] = useState<Incident | null>(null);
    const [gobForm, setGobForm] = useState({ responsableId: '', plazoRespuestaISO: '', estadoCierre: 'abierto', comentarioCierre: '' });
    const [gobSaving, setGobSaving] = useState(false);
    const [gobError, setGobError] = useState('');
    const [personasTenant, setPersonasTenant] = useState<any[]>([]);

    // Autocomplete de trabajadores para hallazgo
    const [trabajadorSearch, setTrabajadorSearch] = useState('');
    const [showTrabajadorDropdown, setShowTrabajadorDropdown] = useState(false);

    const openGobernanza = async (inc: Incident) => {
        const g = (inc as any).gobernanza || {};
        setGobForm({
            responsableId: g.responsableId || '',
            plazoRespuestaISO: g.plazoRespuestaISO ? String(g.plazoRespuestaISO).slice(0, 10) : '',
            estadoCierre: g.estadoCierre || 'abierto',
            comentarioCierre: g.comentarioCierre || ''
        });
        setGobError('');
        setGobIncident(inc);
        if (personasTenant.length === 0) {
            const res = await workersApi.list();
            if (res.success && res.data) setPersonasTenant(res.data as any[]);
        }
    };

    const handleSaveGobernanza = async () => {
        if (!gobIncident || !user?.personaId) return;
        if (gobForm.estadoCierre === 'cerrado' && !gobForm.comentarioCierre.trim()) {
            setGobError('El comentario de cierre es requerido para cerrar el hallazgo.');
            return;
        }
        setGobSaving(true);
        setGobError('');
        try {
            const responsable = personasTenant.find((p: any) => p.personaId === gobForm.responsableId);
            const res = await incidentsApi.updateGobernanza(gobIncident.incidentId, {
                actorId: user.personaId,
                responsableId: gobForm.responsableId || null,
                responsableNombre: responsable ? `${responsable.nombre} ${responsable.apellido || ''}`.trim() : null,
                plazoRespuestaISO: gobForm.plazoRespuestaISO || null,
                estadoCierre: gobForm.estadoCierre as any,
                comentarioCierre: gobForm.comentarioCierre || null
            });
            if (!res.success) { setGobError(res.error || 'No se pudo guardar la gobernanza.'); return; }
            setGobIncident(null);
            loadIncidents();
        } catch {
            setGobError('Error de conexion.');
        } finally {
            setGobSaving(false);
        }
    };


    useEffect(() => {
        loadIncidents();
        loadStats();
    }, [filters, selectedObraId]);

    useEffect(() => {
        if (activeTab === 'estadisticas') {
            loadAnalytics();
        }
    }, [activeTab, selectedObraId]);

    // Si el usuario no puede ver el historial pero sí estadísticas, abre esa pestaña.
    useEffect(() => {
        if (activeTab === 'listado' && !canVerHistorial && canVerEstadisticas) {
            setActiveTab('estadisticas');
        }
    }, [canVerHistorial, canVerEstadisticas, activeTab]);

    // Precarga trabajadores al abrir el modal (hallazgo e incidente)
    useEffect(() => {
        if (showModal && personasTenant.length === 0) {
            workersApi.list().then(res => {
                if (res.success && res.data) setPersonasTenant(res.data as any[]);
            });
        }
    }, [showModal]);

    const loadIncidents = async () => {
        if (!selectedObraId) {
            setIncidents([]);
            setLoading(false);
            return;
        }
        setLoading(true);
        try {
            const response = await incidentsApi.list({
                tenantId: user?.tenantId,
                obraId: selectedObraId,
                ...filters
            });
            if (response.success && response.data) {
                // Garantía de aislamiento por obra: aunque el backend devuelva de más
                // (registros legacy sin obraId, o respuesta sin filtrar), la tabla solo
                // muestra reportes cuya obraId coincide EXACTAMENTE con la obra activa.
                setIncidents(response.data.filter((inc) => inc.obraId === selectedObraId));
            }
        } catch (error) {
            console.error('Error cargando incidentes:', error);
        } finally {
            setLoading(false);
        }
    };

    const loadStats = async () => {
        if (!selectedObraId) { setStats(null); return; }
        try {
            const response = await incidentsApi.getStats({
                tenantId: user?.tenantId,
                obraId: selectedObraId,
                masaLaboral: 100
            });
            if (response.success && response.data) {
                setStats(response.data);
            }
        } catch (error) {
            console.error('Error cargando estadísticas:', error);
            setStats(null);
        }
    };

    const loadAnalytics = async () => {
        if (!selectedObraId) { setAnalytics(null); return; }
        try {
            const response = await incidentsApi.getAnalytics({
                tenantId: user?.tenantId,
                obraId: selectedObraId,
            });
            if (response.success && response.data) {
                setAnalytics(response.data);
            }
        } catch (error) {
            console.error('Error cargando analytics:', error);
            setAnalytics(null);
        }
    };

    const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files) {
            const files = Array.from(e.target.files);
            setUploadedFiles(prev => [...prev, ...files]);
        }
    };

    const removeFile = (index: number) => {
        setUploadedFiles(prev => prev.filter((_, i) => i !== index));
    };

    // AI Quick Report States
    const [step, setStep] = useState(1);
    const [cameraActive, setCameraActive] = useState(false);
    const [videoStream, setVideoStream] = useState<MediaStream | null>(null);
    const videoRef = useRef<HTMLVideoElement>(null);
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);

    // Dictation for description field
    const [isDictating, setIsDictating] = useState(false);
    const [isTranscribingDesc, setIsTranscribingDesc] = useState(false);
    const dictationRecorderRef = useRef<MediaRecorder | null>(null);
    const dictationChunksRef = useRef<Blob[]>([]);

    // Confirmación inline para calificar como accidente
    const [confirmingAccidenteId, setConfirmingAccidenteId] = useState<string | null>(null);
    const [markingAccidente, setMarkingAccidente] = useState(false);

    // Multiple afectados for accion subestandar
    const [afectados, setAfectados] = useState<Array<{ nombre: string; rut: string; cargo: string }>>([{ nombre: '', rut: '', cargo: '' }]);
    const [afectadoSearch, setAfectadoSearch] = useState<string[]>(['']);
    const [showAfectadoDropdown, setShowAfectadoDropdown] = useState<boolean[]>([false]);

    const requestLocation = useCallback(async (options?: { force?: boolean }) => {
        if (location && !options?.force) return location;
        if (!navigator.geolocation) {
            setLocationError('Tu navegador no permite obtener la ubicación automáticamente.');
            return null;
        }

        setIsGettingLocation(true);
        setLocationError('');

        const getPosition = (opts: PositionOptions) => new Promise<GeolocationPosition>((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(resolve, reject, opts);
        });

        try {
            const baseOptions: PositionOptions = {
                enableHighAccuracy: true,
                timeout: 20000,
                maximumAge: 0
            };

            const first = await getPosition(baseOptions);
            let best = first;

            // If accuracy is low (bigger number = worse), try once more to refine
            if (typeof first.coords.accuracy === 'number' && first.coords.accuracy > 40) {
                try {
                    const second = await getPosition({ ...baseOptions, timeout: 25000 });
                    if (second.coords.accuracy < first.coords.accuracy) {
                        best = second;
                    }
                } catch (retryErr) {
                    console.warn('No se pudo mejorar la precisión de GPS', retryErr);
                }
            }

            const coords: IncidentLocation = {
                lat: Number(best.coords.latitude.toFixed(6)),
                lng: Number(best.coords.longitude.toFixed(6)),
                accuracy: Math.round(best.coords.accuracy),
                source: 'geolocalizacion',
                timestamp: best.timestamp
            };
            setLocation(coords);
            return coords;
        } catch (err) {
            console.error('Error obteniendo ubicación', err);
            setLocationError('No se pudo obtener tu ubicación. Revisa permisos de GPS.');
            return null;
        } finally {
            setIsGettingLocation(false);
        }
    }, [location]);

    useEffect(() => {
        if (showModal && step === 1 && !location && !isGettingLocation) {
            requestLocation();
        }
    }, [showModal, step, location, isGettingLocation, requestLocation]);

    // Keep video element in sync with the active stream so the preview renders reliably
    useEffect(() => {
        if (!videoRef.current) return;

        if (videoStream) {
            videoRef.current.srcObject = videoStream;
            const playPromise = videoRef.current.play();
            playPromise?.catch(err => console.warn('No se pudo reproducir la vista previa de la cámara', err));
        } else {
            videoRef.current.srcObject = null;
        }
    }, [videoStream]);

    useEffect(() => {
        if (!showModal) {
            stopCamera();
            stopRecording(); // ADDED: Ensure recording stops when modal closes
            setFormError('');
        }
    }, [showModal]);

    const startCamera = async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: 'environment' }
            });
            setVideoStream(stream);
            if (videoRef.current) {
                videoRef.current.srcObject = stream;
            }
            setCameraActive(true);
        } catch (err) {
            console.error('Error accessing camera:', err);
            setFormError('No se pudo acceder a la cámara. Por favor asegúrese de dar los permisos necesarios.');
        }
    };

    const stopCamera = () => {
        if (videoStream) {
            videoStream.getTracks().forEach(track => track.stop());
            setVideoStream(null);
        }
        setCameraActive(false);
    };

    const capturePhoto = () => {
        if (videoRef.current) {
            const canvas = document.createElement('canvas');
            canvas.width = videoRef.current.videoWidth;
            canvas.height = videoRef.current.videoHeight;
            const ctx = canvas.getContext('2d');
            ctx?.drawImage(videoRef.current, 0, 0);

            canvas.toBlob((blob) => {
                if (blob) {
                    const file = new File([blob], `incidente_${Date.now()}.jpg`, { type: 'image/jpeg' });
                    setUploadedFiles(prev => [...prev, file]);
                    stopCamera();
                }
            }, 'image/jpeg', 0.8);
        }
    };

    const handleCloseModal = () => {
        setShowModal(false);
        setShowSuccess(false);
        setStep(1);
        resetForm();
    };


    const stopRecording = () => {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
            mediaRecorderRef.current.stop();
        }
    };

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
                stream.getTracks().forEach(t => t.stop());
                const audioBlob = new Blob(dictationChunksRef.current, { type: 'audio/webm' });
                const reader = new FileReader();
                reader.readAsDataURL(audioBlob);
                reader.onloadend = async () => {
                    const base64 = (reader.result as string).split(',')[1];
                    try {
                        const result = await aiApi.transcribeAudio(base64, 'audio/webm');
                        if (result.success && result.data) {
                            setFormData(prev => ({
                                ...prev,
                                descripcion: prev.descripcion ? prev.descripcion + ' ' + result.data!.text : result.data!.text
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


    const uploadFiles = async (incidentId: string): Promise<string[]> => {
        const s3Keys: string[] = [];

        for (const file of uploadedFiles) {
            try {
                const urlResponse = await incidentsApi.uploadEvidence({
                    fileName: file.name,
                    fileType: file.type,
                    incidentId
                });

                if (urlResponse.success && urlResponse.data) {
                    await fetch(urlResponse.data.uploadUrl, {
                        method: 'PUT',
                        body: file,
                        headers: {
                            'Content-Type': file.type
                        }
                    });

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
        setUploading(true);
        setFormError('');

        const currentLocation = await requestLocation({ force: true });

        try {
            const esHallazgoForm = formData.clasificacion === 'hallazgo';
            const esFlashForm = !esHallazgoForm && flashMode;

            // El tipo efectivo del hallazgo sale del selector accion/condicion.
            const tipoEfectivo = esHallazgoForm
                ? (formData.tipoHallazgo === 'accion' ? 'accion_subestandar' : 'condicion_subestandar')
                : formData.tipo;

            const nombreCompleto = [user?.nombre, user?.apellidoPaterno, user?.apellidoMaterno].filter(Boolean).join(' ');
            const payload: CreateIncidentData & { realizadoPor: unknown } = {
                ...formData,
                tipo: tipoEfectivo as CreateIncidentData['tipo'],
                obraId: selectedObraId || undefined,
                solicitanteId: user?.personaId,
                reportadoPor: nombreCompleto || 'Usuario',
                realizadoPor: {
                    personaId: user?.personaId || null,
                    nombre: nombreCompleto || '',
                    rut: user?.rut || '',
                    cargo: '',
                },
                // El backend persiste tenantId; empresaId se mantiene como alias legacy.
                tenantId: (user as any)?.tenantId,
                empresaId: (user as any)?.tenantId,
                ubicacion: currentLocation || undefined,
                // centroTrabajo no se captura en el formulario actual — backend lo acepta vacío
                centroTrabajo: formData.centroTrabajo || '',
                // Para hallazgos el trabajador es opcional; se pasa null cuando no se seleccionó
                ...(esHallazgoForm && !formData.trabajador.nombre
                    ? { trabajador: { nombre: '', rut: '', genero: '', cargo: '' } }
                    : {}),
                // Afectados de acción subestándar (múltiples, opcional)
                ...(esHallazgoForm && formData.tipoHallazgo === 'accion'
                    ? { afectados: afectados.filter(a => a.nombre.trim() !== '') }
                    : {})
            };

            if (esFlashForm) {
                const afectados = flashAfectados.filter((a) => a.nombre.trim() !== '');
                if (afectados.length === 0) {
                    setFormError('Indica al menos un afectado (nombre requerido).');
                    setUploading(false);
                    return;
                }
                payload.esFlash = true;
                payload.afectados = afectados.map((a) => ({ nombre: a.nombre.trim(), rut: a.rut.trim() || null, cargo: a.cargo.trim() || null }));
                payload.descripcionBreve = flashDescripcion.slice(0, 500);
                payload.ubicacionReferencia = flashUbicacion;
                // El backend completa trabajador/descripcion/centroTrabajo desde el flash.
                payload.descripcion = payload.descripcion || flashDescripcion.slice(0, 500);
                payload.trabajador = payload.trabajador?.nombre ? payload.trabajador : { nombre: afectados[0].nombre, rut: afectados[0].rut || '', genero: '', cargo: afectados[0].cargo || '' };
                payload.centroTrabajo = payload.centroTrabajo || flashUbicacion || 'Por definir';
            }

            const response = await incidentsApi.create(payload);

            if (response.success && response.data) {
                if (uploadedFiles.length > 0) {
                    const s3Keys = await uploadFiles(response.data.incidentId);

                    if (s3Keys.length > 0) {
                        await incidentsApi.update(response.data.incidentId, {
                            evidencias: s3Keys
                        });
                    }
                }

                resetForm();
                loadIncidents();
                loadStats();
                setShowSuccess(true);
            } else {
                setFormError(response.error || 'Error al reportar incidente');
            }
        } catch (error) {
            console.error('Error:', error);
            setFormError('Error de conexión con el servidor.');
        } finally {
            setUploading(false);
        }
    };

    const handleMarcarAccidente = async (incidentId: string) => {
        if (!user?.personaId) return;
        setMarkingAccidente(true);
        try {
            const res = await incidentsApi.marcarAccidente(incidentId, user.personaId);
            if (res.success) {
                setIncidents(prev => prev.map(i =>
                    i.incidentId === incidentId
                        ? { ...i, tipo: 'accidente', clasificacion: 'incidente' }
                        : i
                ));
            }
        } catch {
            // silencioso — el usuario puede reintentar
        } finally {
            setMarkingAccidente(false);
            setConfirmingAccidenteId(null);
        }
    };

    const resetForm = () => {
        setFormData({
            tipo: 'incidente',
            centroTrabajo: '',
            trabajador: {
                nombre: '',
                rut: '',
                genero: '',
                cargo: ''
            },
            descripcion: '',
            gravedad: 'leve',
            diasPerdidos: 0,
            evidencias: [],
            clasificacion: 'incidente',
            tipoHallazgo: 'condicion',
            etapaConstructiva: ''
        });
        setUploadedFiles([]);
        setConfirmaEnvio(false);
        setLocation(null);
        setLocationError('');
        setIsGettingLocation(false);
        setFlashMode(false);
        setFlashAfectados([{ nombre: '', rut: '', cargo: '' }]);
        setFlashDescripcion('');
        setFlashUbicacion('');
        setTrabajadorSearch('');
        setShowTrabajadorDropdown(false);
        setAfectados([{ nombre: '', rut: '', cargo: '' }]);
        setAfectadoSearch(['']);
        setShowAfectadoDropdown([false]);
        setIsDictating(false);
        setIsTranscribingDesc(false);
    };


    const openIncidentDetail = async (incident: Incident) => {
        setDetailError('');
        setSelectedIncident(incident);
        setDetailLoading(true);

        try {
            // Mark as viewed in background if not already seen
            const uid = user?.personaId || user?.userId;
            if (uid && (!incident.viewedBy || !incident.viewedBy.includes(uid))) {
                incidentsApi.markAsViewed(incident.incidentId, uid).catch(err =>
                    console.error('Error marking incident as viewed:', err)
                );

                // Update local list to hide "New" badge immediately
                setIncidents(prev => prev.map(i =>
                    i.incidentId === incident.incidentId
                        ? { ...i, viewedBy: [...(i.viewedBy || []), uid] }
                        : i
                ));
            }

            const response = await incidentsApi.get(incident.incidentId);
            if (response.success && response.data) {
                setSelectedIncident(response.data);
            } else {
                setDetailError(response.error || 'No fue posible cargar el detalle del incidente.');
            }
        } catch (error) {
            console.error('Error cargando detalle del incidente:', error);
            setDetailError('Ocurrió un error al cargar el detalle del incidente.');
        } finally {
            setDetailLoading(false);
        }
    };

    const getEstadoBadge = (estado: string) => {
        const badges: Record<string, string> = {
            reportado: 'badge-warning',
            en_investigacion: 'badge-info',
            cerrado: 'badge-secondary'
        };
        return badges[estado] || 'badge-secondary';
    };

    const getGravedadBadge = (gravedad: string) => {
        const badges: Record<string, string> = {
            leve: 'badge-success',
            grave: 'badge-warning',
            fatal: 'badge-danger'
        };
        return badges[gravedad] || 'badge-secondary';
    };


    const getTipoLabel = (tipo: string) => {
        const labels: Record<string, string> = {
            accidente: 'Incidente',
            incidente: 'Incidente',
            condicion_subestandar: 'Condición Subestándar',
            accion_subestandar: 'Acción Subestándar',
        };
        return labels[tipo] || tipo;
    };

    // Check if incident is new (unseen by current user)
    const isNewIncident = (incident: Incident) => {
        const uid = user?.personaId || user?.userId;
        if (!uid) return false;
        return !incident.viewedBy || (Array.isArray(incident.viewedBy) && !incident.viewedBy.includes(uid));
    };

    // Generate calendar data for a specific month
    const generateCalendarData = () => {
        const days = [];
        const year = calendarMonth.getFullYear();
        const month = calendarMonth.getMonth();

        // Get first day of month and total days
        const firstDay = new Date(year, month, 1);
        const lastDay = new Date(year, month + 1, 0);
        const totalDays = lastDay.getDate();

        // Get starting day of week (0 = Sunday)
        const startDayOfWeek = firstDay.getDay();

        // Add empty cells for days before the month starts
        for (let i = 0; i < startDayOfWeek; i++) {
            days.push({ empty: true });
        }

        // Add all days of the month
        for (let day = 1; day <= totalDays; day++) {
            const date = new Date(year, month, day);
            const dateStr = date.toISOString().split('T')[0];

            // Find incidents on this day
            const dayIncidents = incidents.filter(inc => inc.fecha === dateStr);
            const hasIncident = dayIncidents.length > 0;

            // Get worst severity for the day
            let severity: string | null = null;
            if (hasIncident) {
                if (dayIncidents.some(inc => inc.gravedad === 'fatal')) severity = 'fatal';
                else if (dayIncidents.some(inc => inc.gravedad === 'grave')) severity = 'grave';
                else severity = 'leve';
            }

            days.push({
                empty: false,
                date: dateStr,
                dayNum: day,
                hasIncident,
                count: dayIncidents.length,
                severity
            });
        }

        return days;
    };


    // Navigate calendar month
    const navigateMonth = (direction: number) => {
        const newDate = new Date(calendarMonth);
        newDate.setMonth(newDate.getMonth() + direction);
        setCalendarMonth(newDate);
    };

    // Format month name
    const formatMonthName = (date: Date) => {
        return date.toLocaleDateString('es-CL', { month: 'long', year: 'numeric' });
    };


    // Download report as CSV or PDF
    const downloadReport = (format: 'csv' | 'pdf') => {
        if (format === 'csv') {
            // Generate CSV
            const headers = ['Fecha', 'Tipo', 'Centro de Trabajo', 'Trabajador', 'Gravedad', 'Estado', 'Días Perdidos'];
            const rows = incidents.map(inc => [
                inc.fecha,
                getTipoLabel(inc.tipo),
                inc.centroTrabajo,
                inc.trabajador.nombre,
                inc.gravedad,
                inc.estado,
                inc.diasPerdidos || 0
            ]);

            const csvContent = [
                headers.join(','),
                ...rows.map(row => row.join(','))
            ].join('\n');

            const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.setAttribute('download', `reporte_incidentes_${new Date().toISOString().split('T')[0]}.csv`);
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);
        } else {
            // For PDF, create a printable version
            const printContent = `
                <html>
                <head>
                    <title>Reporte de Incidentes</title>
                    <style>
                        body { font-family: Arial, sans-serif; padding: 20px; }
                        h1 { color: #333; border-bottom: 2px solid #4CAF50; padding-bottom: 10px; }
                        .stats { display: flex; gap: 20px; margin: 20px 0; }
                        .stat-box { padding: 15px; background: #f5f5f5; border-radius: 8px; text-align: center; }
                        .stat-value { font-size: 24px; font-weight: bold; color: #333; }
                        .stat-label { font-size: 12px; color: #666; }
                        table { width: 100%; border-collapse: collapse; margin-top: 20px; }
                        th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
                        th { background: #4CAF50; color: white; }
                        tr:nth-child(even) { background: #f9f9f9; }
                        .footer { margin-top: 30px; text-align: center; color: #666; font-size: 12px; }
                    </style>
                </head>
                <body>
                    <h1>Reporte de Incidentes y Accidentes</h1>
                    <p>Generado el ${new Date().toLocaleString('es-CL')}</p>
                    
                    <div class="stats">
                        <div class="stat-box">
                            <div class="stat-value">${stats?.numeroAccidentes || 0}</div>
                            <div class="stat-label">Accidentes</div>
                        </div>
                        <div class="stat-box">
                            <div class="stat-value">${stats?.tasaAccidentabilidad.toFixed(1) || 0}%</div>
                            <div class="stat-label">Tasa Accidentabilidad</div>
                        </div>
                        <div class="stat-box">
                            <div class="stat-value">${stats?.diasPerdidos || 0}</div>
                            <div class="stat-label">Días Perdidos</div>
                        </div>
                        <div class="stat-box">
                            <div class="stat-value">${stats?.siniestralidad.toFixed(1) || 0}%</div>
                            <div class="stat-label">Siniestralidad</div>
                        </div>
                    </div>
                    
                    <table>
                        <thead>
                            <tr>
                                <th>Fecha</th>
                                <th>Tipo</th>
                                <th>Centro de Trabajo</th>
                                <th>Trabajador</th>
                                <th>Gravedad</th>
                                <th>Estado</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${incidents.map(inc => `
                                <tr>
                                    <td>${inc.fecha}</td>
                                    <td>${getTipoLabel(inc.tipo)}</td>
                                    <td>${inc.centroTrabajo}</td>
                                    <td>${inc.trabajador.nombre}</td>
                                    <td>${inc.gravedad}</td>
                                    <td>${inc.estado.replace('_', ' ')}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                    
                    <div class="footer">
                        Sistema de Gestión de Seguridad Laboral | Masa Laboral: ${stats?.masaLaboral || 100}
                    </div>
                </body>
                </html>
            `;

            const printWindow = window.open('', '_blank');
            if (printWindow) {
                printWindow.document.write(printContent);
                printWindow.document.close();
                printWindow.focus();
                setTimeout(() => printWindow.print(), 250);
            }
        }
    };

    const getEvidenceDisplayName = (key: string | undefined | null, index: number) => {
        if (key) {
            const segments = key.split('/');
            const filename = segments.pop();
            if (filename && filename.trim().length > 0) {
                return filename;
            }
        }
        return `Evidencia ${index + 1}`;
    };

    const incidentEvidenceItems = selectedIncident
        ? ((selectedIncident.evidencePreviews && selectedIncident.evidencePreviews.length > 0)
            ? selectedIncident.evidencePreviews.map((preview, index) => {
                const key = preview.key || `evidence-${index}`;
                const url = preview.url || buildEvidenceUrl(preview.key || '');
                const displayName = getEvidenceDisplayName(preview.key, index);
                return {
                    id: `${key}-${index}`,
                    url,
                    title: displayName,
                    label: displayName
                };
            })
            : (selectedIncident.evidencias || []).map((s3Key, index) => {
                const key = s3Key || `evidence-${index}`;
                const url = buildEvidenceUrl(s3Key);
                const displayName = getEvidenceDisplayName(s3Key, index);
                return {
                    id: `${key}-${index}`,
                    url,
                    title: displayName,
                    label: displayName
                };
            }))
        : [];

    return (
        <>
            <div className="page-content">
                <div className="page-header">
                    <div className="page-header-info">
                        <h2 className="page-header-title">
                            <FiAlertTriangle className="text-blue-500" />
                            Control de eventos
                        </h2>
                        <p className="page-header-description">
                            {selectedObra
                                ? <>Obra: <strong>{selectedObra.nombre}</strong></>
                                : 'Sistema de reporte, seguimiento y análisis estadístico de seguridad.'}
                        </p>
                    </div>
                    <div className="page-header-actions" style={{ display: 'flex', gap: 'var(--space-2)' }}>
                        <button
                            className="btn btn-secondary"
                            disabled={!selectedObraId}
                            onClick={() => { setFormData((prev) => ({ ...prev, clasificacion: 'hallazgo' })); setFlashMode(false); setStep(1); setShowModal(true); }}
                        >
                            <FiPlus className="mr-2" />
                            Reportar hallazgo
                        </button>
                        {canCreateIncidente && (
                            <button
                                className="btn btn-primary"
                                disabled={!selectedObraId}
                                onClick={() => { setFormData((prev) => ({ ...prev, clasificacion: 'incidente' })); setStep(1); setShowModal(true); }}
                            >
                                <FiPlus className="mr-2" />
                                Reportar Incidente
                            </button>
                        )}
                    </div>
                </div>

                {/* Gate: obra requerida */}
                {!selectedObraId && (
                    <div style={{
                        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                        padding: 'var(--space-16) var(--space-6)', textAlign: 'center', gap: 'var(--space-4)'
                    }}>
                        <div style={{
                            width: 64, height: 64, borderRadius: '50%',
                            background: 'var(--warning-500, #f59e0b)', opacity: 0.12,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            position: 'relative'
                        }}>
                        </div>
                        <FiAlertCircle size={40} style={{ color: 'var(--warning-500, #f59e0b)', marginTop: '-68px', position: 'relative', zIndex: 1 }} />
                        <p style={{ fontWeight: 700, fontSize: 'var(--text-lg)', color: 'var(--text-primary)', margin: 0 }}>
                            Debe seleccionar una obra antes de acceder a los incidentes
                        </p>
                        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)', maxWidth: 380, margin: 0 }}>
                            Use el selector de obra en la barra superior para elegir la obra de la que desea ver o reportar incidentes y hallazgos.
                        </p>
                    </div>
                )}

                {/* Contenido — solo visible cuando hay obra seleccionada */}
                {selectedObraId && <>

                {/* Tabs — cada pestaña requiere su permiso de vista */}
                {(canVerHistorial || canVerEstadisticas) && (
                    <div className="incidents-tabs mb-6" style={{ display: 'grid', gridTemplateColumns: canVerHistorial && canVerEstadisticas ? '1fr 1fr' : '1fr', gap: 'var(--space-2)' }}>
                        {canVerHistorial && (
                            <button
                                className={`incidents-tab ${activeTab === 'listado' ? 'active' : ''}`}
                                onClick={() => setActiveTab('listado')}
                            >
                                <FiList size={18} />
                                Listado
                            </button>
                        )}
                        {canVerEstadisticas && (
                            <button
                                className={`incidents-tab ${activeTab === 'estadisticas' ? 'active' : ''}`}
                                onClick={() => setActiveTab('estadisticas')}
                            >
                                <FiPieChart size={18} />
                                Estadísticas
                            </button>
                        )}
                    </div>
                )}

                {/* Statistics Dashboard Tab */}
                {activeTab === 'estadisticas' && canVerEstadisticas && (() => {
                    const hallazgosCount = incidents.filter(esHallazgo).length;
                    const accidentesCount = incidents.filter(i => i.tipo === 'accidente').length;
                    const incidentesCount = incidents.filter(i => !esHallazgo(i) && i.tipo === 'incidente').length;
                    const total = incidents.length;
                    const tasaCorregida = total > 0 ? (accidentesCount / total * 100) : 0;
                    const hallazgosCerrados = incidents.filter(i => esHallazgo(i) && (i as any).gobernanza?.estadoCierre === 'cerrado').length;
                    const pctCerrados = hallazgosCount > 0 ? (hallazgosCerrados / hallazgosCount * 100) : 0;
                    const indiceProactivo = total > 0 ? (hallazgosCount / total * 100) : 0;

                    const now = new Date();
                    const trendMonths = Array.from({ length: 6 }, (_, i) => {
                        const d = new Date(now.getFullYear(), now.getMonth() - 5 + i, 1);
                        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
                        const label = d.toLocaleDateString('es-CL', { month: 'short' });
                        const monthIncs = incidents.filter(inc => (inc.fecha || '').startsWith(key));
                        return {
                            label,
                            hallazgos: monthIncs.filter(esHallazgo).length,
                            incidentes: monthIncs.filter(inc => !esHallazgo(inc) && inc.tipo === 'incidente').length,
                            accidentes: monthIncs.filter(inc => inc.tipo === 'accidente').length,
                        };
                    });
                    const maxTrend = Math.max(...trendMonths.map(m => m.hallazgos + m.incidentes + m.accidentes), 1);

                    const etapaData = ETAPAS_CONSTRUCTIVAS
                        .map(e => ({ label: e, count: incidents.filter(i => (i as any).etapaConstructiva === e).length }))
                        .filter(e => e.count > 0)
                        .sort((a, b) => b.count - a.count);
                    const maxEtapa = Math.max(...etapaData.map(e => e.count), 1);

                    const gravedadTotal = Math.max(
                        incidents.filter(i => i.gravedad === 'leve').length +
                        incidents.filter(i => i.gravedad === 'grave').length +
                        incidents.filter(i => i.gravedad === 'fatal').length, 1
                    );

                    const barW = 40;
                    const gap = (400 - 6 * barW) / 7;
                    const chartBottom = 128;
                    const chartH = 110;

                    return (
                        <div className="stats-dashboard">
                            {/* Header */}
                            <div className="dashboard-header mb-6">
                                <h3 className="text-lg font-bold">Consolidado Estadístico</h3>
                                <div className="flex gap-2">
                                    <button className="btn btn-secondary btn-sm" onClick={() => downloadReport('csv')}>
                                        <FiFileText className="mr-1" /> CSV
                                    </button>
                                    <button className="btn btn-primary btn-sm" onClick={() => downloadReport('pdf')}>
                                        <FiFileText className="mr-1" /> PDF
                                    </button>
                                </div>
                            </div>

                            {/* 4 key metrics */}
                            <div className="stats-grid-4 mb-4">
                                {([
                                    { label: 'Hallazgos', value: hallazgosCount },
                                    { label: 'Incidentes', value: incidentesCount },
                                    { label: 'Accidentes', value: accidentesCount },
                                    { label: 'Tasa de accidentabilidad', value: `${tasaCorregida.toFixed(1)}%` },
                                ] as { label: string; value: string | number }[]).map(({ label, value }) => (
                                    <div key={label} className="stat-card" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 'var(--space-2)' }}>
                                        <div className="stat-card-label">{label}</div>
                                        <div className="stat-card-value" style={{ fontSize: '1.875rem', color: 'var(--primary-400)' }}>{value}</div>
                                    </div>
                                ))}
                            </div>

                            {/* 2 proportion metrics */}
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 'var(--space-4)', marginBottom: 'var(--space-4)' }}>
                                {([
                                    { label: '% Hallazgos cerrados', pct: pctCerrados, sub: `${hallazgosCerrados} de ${hallazgosCount} cerrados` },
                                    { label: 'Índice proactivo', pct: indiceProactivo, sub: 'Hallazgos sobre total de eventos' },
                                ] as { label: string; pct: number; sub: string }[]).map(({ label, pct, sub }) => (
                                    <div key={label} className="stat-card" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 'var(--space-3)' }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'baseline' }}>
                                            <div className="stat-card-label">{label}</div>
                                            <div style={{ fontSize: 'var(--text-xl)', fontWeight: 700, color: 'var(--primary-400)' }}>{pct.toFixed(1)}%</div>
                                        </div>
                                        <div style={{ height: 5, background: 'var(--surface-border)', borderRadius: 3, width: '100%', overflow: 'hidden' }}>
                                            <div style={{ height: '100%', width: `${Math.min(pct, 100)}%`, background: 'var(--primary-500)', borderRadius: 3, transition: 'width 0.6s ease' }} />
                                        </div>
                                        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>{sub}</div>
                                    </div>
                                ))}
                            </div>

                            {/* Tendencia mensual + Etapa constructiva */}
                            <div className="charts-row-2 mb-4">
                                <div className="card">
                                    <div className="card-header">
                                        <h3 className="font-semibold flex items-center gap-2">
                                            <FiBarChart2 /> Tendencia mensual
                                        </h3>
                                    </div>
                                    <div style={{ padding: 'var(--space-3) var(--space-4) var(--space-2)' }}>
                                        <svg viewBox="0 0 400 155" width="100%" style={{ display: 'block' }}>
                                            {trendMonths.map((m, i) => {
                                                const x = gap + i * (barW + gap);
                                                const hH = (m.hallazgos / maxTrend) * chartH;
                                                const iH = (m.incidentes / maxTrend) * chartH;
                                                const aH = (m.accidentes / maxTrend) * chartH;
                                                return (
                                                    <g key={i}>
                                                        {m.hallazgos > 0 && <rect x={x} y={chartBottom - hH} width={barW} height={hH} rx={2} fill="rgba(0,110,220,0.22)" />}
                                                        {m.incidentes > 0 && <rect x={x} y={chartBottom - hH - iH} width={barW} height={iH} rx={2} fill="#006edc" />}
                                                        {m.accidentes > 0 && <rect x={x} y={chartBottom - hH - iH - aH} width={barW} height={aH} rx={2} fill="#002952" />}
                                                        <text x={x + barW / 2} y={144} fontSize="9" textAnchor="middle" fill="var(--text-muted)">{m.label}</text>
                                                    </g>
                                                );
                                            })}
                                        </svg>
                                        <div style={{ display: 'flex', gap: 'var(--space-5)', justifyContent: 'center', paddingBottom: 'var(--space-2)' }}>
                                            {[
                                                { color: 'rgba(0,110,220,0.22)', border: '1px solid #006edc', label: 'Hallazgos' },
                                                { color: '#006edc', border: 'none', label: 'Incidentes' },
                                                { color: '#002952', border: 'none', label: 'Accidentes' },
                                            ].map(l => (
                                                <div key={l.label} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                                                    <div style={{ width: 10, height: 10, background: l.color, border: l.border, borderRadius: 2, flexShrink: 0 }} />
                                                    <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>{l.label}</span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                </div>

                                <div className="card">
                                    <div className="card-header">
                                        <h3 className="font-semibold flex items-center gap-2">
                                            <FiActivity /> Por etapa constructiva
                                        </h3>
                                    </div>
                                    <div className="chart-container bar-chart-container">
                                        {etapaData.length > 0 ? (
                                            <div className="horizontal-bars">
                                                {etapaData.map((row, idx) => (
                                                    <div key={idx} className="h-bar-group">
                                                        <div className="h-bar-label">{row.label}</div>
                                                        <div className="h-bar-track">
                                                            <div className="h-bar-fill" style={{ width: `${(row.count / maxEtapa) * 100}%`, background: 'var(--primary-500)' }} />
                                                        </div>
                                                        <span className="h-bar-value">{row.count}</span>
                                                    </div>
                                                ))}
                                            </div>
                                        ) : (
                                            <div className="chart-empty">Sin datos por etapa</div>
                                        )}
                                    </div>
                                </div>
                            </div>

                            {/* Gravedad + Calendario */}
                            <div className="charts-row-2 mb-6">
                                <div className="card">
                                    <div className="card-header">
                                        <h3 className="font-semibold flex items-center gap-2">
                                            <FiAlertTriangle /> Gravedad
                                        </h3>
                                    </div>
                                    <div className="chart-container bar-chart-container">
                                        <div className="horizontal-bars">
                                            {[
                                                { label: 'Leve', count: incidents.filter(i => i.gravedad === 'leve').length },
                                                { label: 'Grave', count: incidents.filter(i => i.gravedad === 'grave').length },
                                                { label: 'Fatal', count: incidents.filter(i => i.gravedad === 'fatal').length },
                                            ].map((row, i) => (
                                                <div key={i} className="h-bar-group">
                                                    <div className="h-bar-label">{row.label}</div>
                                                    <div className="h-bar-track">
                                                        <div className="h-bar-fill" style={{ width: `${(row.count / gravedadTotal) * 100}%`, background: 'var(--primary-500)' }} />
                                                    </div>
                                                    <span className="h-bar-value">{row.count}</span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                </div>

                                <div className="card">
                                    <div className="card-header chart-header-controls">
                                        <h3 className="font-semibold flex items-center gap-2">
                                            <FiCalendar /> Calendario
                                        </h3>
                                        <div className="calendar-nav">
                                            <button className="nav-btn" onClick={() => navigateMonth(-1)}>&lt;</button>
                                            <span className="month-label" style={{ fontSize: '10px' }}>{formatMonthName(calendarMonth)}</span>
                                            <button className="nav-btn" onClick={() => navigateMonth(1)}>&gt;</button>
                                        </div>
                                    </div>
                                    <div className="calendar-month-container" style={{ padding: '8px' }}>
                                        <div className="calendar-weekdays" style={{ gap: '4px', marginBottom: '4px' }}>
                                            {['D', 'L', 'M', 'M', 'J', 'V', 'S'].map(d => (
                                                <div key={d} className="weekday-cell" style={{ width: '42px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', fontWeight: '600', color: 'var(--text-muted)' }}>
                                                    {d}
                                                </div>
                                            ))}
                                        </div>
                                        <div className="calendar-grid-month" style={{ gap: '4px' }}>
                                            {generateCalendarData().map((day: any, i: number) => (
                                                day.empty ? (
                                                    <div key={i} className="calendar-cell-empty" style={{ width: '42px', height: '32px' }} />
                                                ) : (
                                                    <div key={i} className={`calendar-cell-day ${day.hasIncident ? 'has-incident' : ''} ${day.severity || ''}`} style={{ width: '42px', height: '32px', minHeight: '32px', minWidth: '42px' }}>
                                                        <span className="day-num" style={{ fontSize: '9px' }}>{day.dayNum}</span>
                                                        <div className="calendar-tooltip">
                                                            <div className="tooltip-header">{day.date}</div>
                                                            {day.hasIncident ? (
                                                                <div className="tooltip-body">
                                                                    <div className="tooltip-stat">
                                                                        <span className="label">Eventos:</span>
                                                                        <span className="value">{day.count}</span>
                                                                    </div>
                                                                    <div className="tooltip-stat">
                                                                        <span className="label">Gravedad:</span>
                                                                        <span className={`severity-badge ${day.severity}`}>{day.severity?.toUpperCase()}</span>
                                                                    </div>
                                                                </div>
                                                            ) : (
                                                                <div className="tooltip-body no-events">Sin incidentes</div>
                                                            )}
                                                        </div>
                                                    </div>
                                                )
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    );
                })()}

                {/* Listado Tab Content */}
                {activeTab === 'listado' && canVerHistorial && (
                    <>
                        {/* Incidents Table */}
                        <div className="card">
                            {/* Separacion hallazgos / incidentes (reunion 2026-06-10) */}
                            <div style={{ display: 'flex', gap: 'var(--space-2)', marginBottom: 'var(--space-3)' }}>
                                <button
                                    type="button"
                                    className={`btn btn-sm ${listTab === 'hallazgos' ? 'btn-primary' : 'btn-secondary'}`}
                                    onClick={() => setListTab('hallazgos')}
                                >
                                    Hallazgos ({incidents.filter(esHallazgo).length})
                                </button>
                                <button
                                    type="button"
                                    className={`btn btn-sm ${listTab === 'incidentes' ? 'btn-primary' : 'btn-secondary'}`}
                                    onClick={() => setListTab('incidentes')}
                                >
                                    Incidentes ({incidents.filter((i) => !esHallazgo(i)).length})
                                </button>
                            </div>

                            <div className="incident-list">
                                {loading ? (
                                    <div style={{ display: 'flex', justifyContent: 'center', padding: 'var(--space-8)' }}>
                                        <div className="spinner" />
                                    </div>
                                ) : incidents.filter((i) => listTab === 'hallazgos' ? esHallazgo(i) : !esHallazgo(i)).length === 0 ? (
                                    <div style={{ padding: 'var(--space-10)', textAlign: 'center', color: 'var(--text-muted)' }}>
                                        <FiAlertTriangle size={36} style={{ margin: '0 auto var(--space-3)', opacity: 0.25, display: 'block' }} />
                                        <p style={{ fontWeight: 500, marginBottom: 'var(--space-1)' }}>{listTab === 'hallazgos' ? 'Sin hallazgos registrados' : 'Sin incidentes registrados'}</p>
                                        <p style={{ fontSize: 'var(--text-sm)' }}>{listTab === 'hallazgos' ? 'Cualquier trabajador puede reportar un hallazgo' : 'Los incidentes reportados aparecerán aquí'}</p>
                                    </div>
                                ) : (
                                    incidents.filter((i) => listTab === 'hallazgos' ? esHallazgo(i) : !esHallazgo(i)).map((incident) => (
                                        <div
                                            key={incident.incidentId}
                                            className="incident-row"
                                            onClick={() => openIncidentDetail(incident)}
                                            role="button"
                                            tabIndex={0}
                                            onKeyDown={(e) => e.key === 'Enter' && openIncidentDetail(incident)}
                                        >
                                            <div className="incident-row-meta">
                                                <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>
                                                    {new Date(incident.fecha).toLocaleDateString('es-CL', { day: 'numeric', month: 'short', year: 'numeric' })}
                                                </span>
                                                {isNewIncident(incident) && (
                                                    <span className="badge badge-success" style={{ fontSize: '10px', marginTop: '4px', display: 'block', width: 'fit-content' }}>Nuevo</span>
                                                )}
                                            </div>
                                            <div className="incident-row-desc">
                                                <p style={{ margin: 0, fontSize: 'var(--text-sm)', color: incident.descripcion ? 'var(--text-primary)' : 'var(--text-muted)', fontStyle: incident.descripcion ? 'normal' : 'italic', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', lineHeight: 1.55 }}>
                                                    {incident.descripcion || 'Sin descripción registrada'}
                                                </p>
                                            </div>
                                            <div className="incident-row-status">
                                                {esHallazgo(incident) && (incident as any).gobernanza ? (
                                                    <span className={`badge ${(incident as any).gobernanza.estadoCierre === 'cerrado' ? 'badge-success' : (incident as any).gobernanza.estadoCierre === 'en_proceso' ? 'badge-info' : 'badge-warning'}`} style={{ fontSize: '10px' }}>
                                                        {String((incident as any).gobernanza.estadoCierre || 'abierto').replace('_', ' ')}
                                                    </span>
                                                ) : (
                                                    <span className={`badge ${getEstadoBadge(incident.estado)}`} style={{ fontSize: '10px' }}>
                                                        {incident.estado.replace('_', ' ')}
                                                    </span>
                                                )}
                                                <FiArrowRight size={14} style={{ color: 'var(--text-muted)', flexShrink: 0, marginTop: '4px' }} />
                                            </div>
                                        </div>
                                    ))
                                )}
                            </div>
                        </div>
                    </>
                )}

                {/* Create Modal */}
                <Modal
                    isOpen={showModal}
                    onClose={handleCloseModal}
                    title={showSuccess ? '¡Reporte Enviado!' : formData.clasificacion === 'hallazgo' ? 'Reportar Hallazgo' : 'Reportar Incidente'}
                    subtitle={showSuccess
                        ? 'El incidente ha sido registrado y notificado correctamente'
                        : formData.clasificacion === 'hallazgo'
                            ? 'Complete la información del hallazgo observado'
                            : 'Complete la información del incidente ocurrido'
                    }
                    icon={<FiAlertTriangle size={24} />}
                    size="xl"
                    preventClose={uploading}
                >
                    <div className="modal-body p-0">
                                {showSuccess ? (
                                    <div className="success-modal-body p-12 text-center">
                                        <div className="success-animation-container mb-8">
                                            <div className="success-pulse"></div>
                                            <div className="success-icon-wrapper">
                                                <FiCheck size={48} className="text-white" />
                                            </div>
                                        </div>
                                        <h3 className="text-2xl font-bold mb-4">Registro Exitoso</h3>
                                        <p className="text-muted mb-8 max-w-sm mx-auto" style={{ marginBottom: 'var(--space-12)' }}>
                                            El reporte ha sido ingresado al sistema. El prevencionista a cargo recibirá una notificación inmediata para su revisión.
                                        </p>
                                        <button
                                            className="btn btn-primary btn-lg px-12 mt-8"
                                            onClick={handleCloseModal}
                                            style={{ marginTop: 'var(--space-10)' }}
                                        >
                                            Entendido
                                        </button>
                                    </div>
                                ) : (
                                    <form onSubmit={handleSubmit} className="p-6">
                                        {/* Sección: Clasificación del Reporte */}
                                        <div className="form-section">
                                            <h3 className="form-section-title">
                                                {formData.clasificacion === 'hallazgo' ? 'Tipo de Hallazgo' : 'Detalles del Incidente'}
                                            </h3>
                                            <div className="grid grid-cols-2 gap-4">
                                                {formData.clasificacion === 'hallazgo' && (
                                                    <div className="form-group">
                                                        <label className="form-label">Tipo de Hallazgo *</label>
                                                        <Select
                                                            ariaLabel="Tipo de hallazgo"
                                                            value={formData.tipoHallazgo}
                                                            onChange={(v) => setFormData({ ...formData, tipoHallazgo: v as any })}
                                                            options={[
                                                                { value: 'accion', label: 'Acción Subestándar' },
                                                                { value: 'condicion', label: 'Condición Subestándar' },
                                                            ]}
                                                        />
                                                        <span className="form-hint">Acción: comportamiento inseguro. Condición: estado físico peligroso.</span>
                                                    </div>
                                                )}

                                                <div className="form-group">
                                                    <label className="form-label">Etapa Constructiva</label>
                                                    <Select
                                                        ariaLabel="Etapa constructiva"
                                                        placeholder="Seleccionar etapa…"
                                                        searchable
                                                        value={formData.etapaConstructiva}
                                                        onChange={(v) => setFormData({ ...formData, etapaConstructiva: v })}
                                                        options={ETAPAS_CONSTRUCTIVAS.map((etapa) => ({ value: etapa, label: etapa }))}
                                                    />
                                                </div>

                                                {formData.clasificacion === 'incidente' && (
                                                    <div className="form-group">
                                                        <label className="form-label">Gravedad *</label>
                                                        <Select
                                                            ariaLabel="Gravedad"
                                                            value={formData.gravedad}
                                                            onChange={(v) => setFormData({ ...formData, gravedad: v as any })}
                                                            options={[
                                                                { value: 'leve', label: 'Leve' },
                                                                { value: 'grave', label: 'Grave' },
                                                                { value: 'fatal', label: 'Fatal' },
                                                            ]}
                                                        />
                                                    </div>
                                                )}
                                            </div>
                                        </div>

                                        {/* Sección: Trabajador Afectado (solo incidente) */}
                                        {formData.clasificacion === 'incidente' && (
                                        <div className="form-section">
                                            <h3 className="form-section-title">Trabajador Afectado</h3>
                                            <div className="form-group">
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
                                                            if (!e.target.value) setFormData({ ...formData, trabajador: { nombre: '', rut: '', genero: '', cargo: '' } });
                                                        }}
                                                        onFocus={() => setShowTrabajadorDropdown(true)}
                                                        onBlur={() => setTimeout(() => setShowTrabajadorDropdown(false), 150)}
                                                    />
                                                    {showTrabajadorDropdown && trabajadorSearch.length > 0 && (() => {
                                                        const q = trabajadorSearch.toLowerCase();
                                                        const filtered = personasTenant.filter(p => {
                                                            const fullName = `${p.nombre || ''} ${p.apellido || ''}`.toLowerCase();
                                                            return fullName.includes(q) || (p.rut && p.rut.toLowerCase().includes(q));
                                                        });
                                                        return (
                                                            <div style={{
                                                                position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0,
                                                                zIndex: 60, background: 'var(--surface-card)',
                                                                border: '1px solid var(--surface-border)', borderRadius: 'var(--radius-md)',
                                                                boxShadow: 'var(--shadow-xl)', maxHeight: '220px', overflowY: 'auto'
                                                            }}>
                                                                {filtered.length === 0 ? (
                                                                    <div style={{ padding: '12px 14px', color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>
                                                                        No se encontraron trabajadores
                                                                    </div>
                                                                ) : filtered.map((p: any) => (
                                                                    <button
                                                                        key={p.personaId || p.workerId}
                                                                        type="button"
                                                                        style={{
                                                                            width: '100%', display: 'flex', flexDirection: 'column',
                                                                            padding: '10px 14px', border: 'none', borderBottom: '1px solid var(--surface-border)',
                                                                            background: 'transparent', cursor: 'pointer', textAlign: 'left'
                                                                        }}
                                                                        onMouseDown={() => {
                                                                            const nombre = `${p.nombre || ''} ${p.apellido || ''}`.trim();
                                                                            setTrabajadorSearch(nombre);
                                                                            setShowTrabajadorDropdown(false);
                                                                            setFormData({
                                                                                ...formData,
                                                                                trabajador: {
                                                                                    nombre,
                                                                                    rut: p.rut || '',
                                                                                    genero: p.genero || '',
                                                                                    cargo: p.cargo || p.puesto || ''
                                                                                }
                                                                            });
                                                                        }}
                                                                        onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface-hover)')}
                                                                        onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                                                                    >
                                                                        <span style={{ fontWeight: 600, fontSize: 'var(--text-sm)', color: 'var(--text-primary)' }}>
                                                                            {p.nombre} {p.apellido || ''}
                                                                        </span>
                                                                        <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                                                                            {p.rut}{p.cargo ? ` · ${p.cargo}` : p.puesto ? ` · ${p.puesto}` : ''}
                                                                        </span>
                                                                    </button>
                                                                ))}
                                                            </div>
                                                        );
                                                    })()}
                                                </div>
                                                {formData.trabajador.nombre && (
                                                    <p className="form-hint" style={{ color: 'var(--primary-400)', marginTop: 'var(--space-2)' }}>
                                                        <FiCheck style={{ display: 'inline', marginRight: '4px' }} />
                                                        {formData.trabajador.nombre}{formData.trabajador.rut ? ` — ${formData.trabajador.rut}` : ''}{formData.trabajador.cargo ? ` · ${formData.trabajador.cargo}` : ''}
                                                    </p>
                                                )}
                                            </div>
                                        </div>
                                        )}

                                        {/* Sección: Afectados (solo hallazgo tipo acción subestándar, opcional, múltiple) */}
                                        {formData.clasificacion === 'hallazgo' && formData.tipoHallazgo === 'accion' && (
                                        <div className="form-section">
                                            <h3 className="form-section-title" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                                                Trabajador(es) Afectado(s)
                                                <span style={{ fontSize: 'var(--text-xs)', fontWeight: 400, color: 'var(--text-muted)' }}>(opcional)</span>
                                            </h3>
                                            {afectados.map((afectado, idx) => (
                                                <div key={idx} style={{ marginBottom: 'var(--space-3)' }}>
                                                    <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'flex-start' }}>
                                                        <div style={{ position: 'relative', flex: 1 }}>
                                                            <input
                                                                type="text"
                                                                className="form-input"
                                                                placeholder="Buscar por nombre o RUT…"
                                                                value={afectadoSearch[idx] ?? ''}
                                                                autoComplete="off"
                                                                onChange={(e) => {
                                                                    const next = [...afectadoSearch];
                                                                    next[idx] = e.target.value;
                                                                    setAfectadoSearch(next);
                                                                    const nextDrop = [...showAfectadoDropdown];
                                                                    nextDrop[idx] = true;
                                                                    setShowAfectadoDropdown(nextDrop);
                                                                    if (!e.target.value) {
                                                                        setAfectados(afectados.map((a, i) => i === idx ? { nombre: '', rut: '', cargo: '' } : a));
                                                                    }
                                                                }}
                                                                onFocus={() => {
                                                                    const nextDrop = [...showAfectadoDropdown];
                                                                    nextDrop[idx] = true;
                                                                    setShowAfectadoDropdown(nextDrop);
                                                                }}
                                                                onBlur={() => setTimeout(() => {
                                                                    const nextDrop = [...showAfectadoDropdown];
                                                                    nextDrop[idx] = false;
                                                                    setShowAfectadoDropdown(nextDrop);
                                                                }, 150)}
                                                            />
                                                            {showAfectadoDropdown[idx] && (afectadoSearch[idx] ?? '').length > 0 && (() => {
                                                                const q = (afectadoSearch[idx] ?? '').toLowerCase();
                                                                const filtered = personasTenant.filter(p => {
                                                                    const fullName = `${p.nombre || ''} ${p.apellido || ''}`.toLowerCase();
                                                                    return fullName.includes(q) || (p.rut && p.rut.toLowerCase().includes(q));
                                                                });
                                                                return (
                                                                    <div style={{
                                                                        position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0,
                                                                        zIndex: 60, background: 'var(--surface-card)',
                                                                        border: '1px solid var(--surface-border)', borderRadius: 'var(--radius-md)',
                                                                        boxShadow: 'var(--shadow-xl)', maxHeight: '200px', overflowY: 'auto'
                                                                    }}>
                                                                        {filtered.length === 0 ? (
                                                                            <div style={{ padding: '12px 14px', color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>
                                                                                No se encontraron trabajadores
                                                                            </div>
                                                                        ) : filtered.map((p: any) => (
                                                                            <button
                                                                                key={p.personaId || p.workerId}
                                                                                type="button"
                                                                                style={{
                                                                                    width: '100%', display: 'flex', flexDirection: 'column',
                                                                                    padding: '10px 14px', border: 'none', borderBottom: '1px solid var(--surface-border)',
                                                                                    background: 'transparent', cursor: 'pointer', textAlign: 'left'
                                                                                }}
                                                                                onMouseDown={() => {
                                                                                    const nombre = `${p.nombre || ''} ${p.apellido || ''}`.trim();
                                                                                    const next = [...afectadoSearch];
                                                                                    next[idx] = nombre;
                                                                                    setAfectadoSearch(next);
                                                                                    const nextDrop = [...showAfectadoDropdown];
                                                                                    nextDrop[idx] = false;
                                                                                    setShowAfectadoDropdown(nextDrop);
                                                                                    setAfectados(afectados.map((a, i) => i === idx ? {
                                                                                        nombre,
                                                                                        rut: p.rut || '',
                                                                                        cargo: p.cargo || p.puesto || ''
                                                                                    } : a));
                                                                                }}
                                                                                onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface-hover)')}
                                                                                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                                                                            >
                                                                                <span style={{ fontWeight: 600, fontSize: 'var(--text-sm)', color: 'var(--text-primary)' }}>
                                                                                    {p.nombre} {p.apellido || ''}
                                                                                </span>
                                                                                <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                                                                                    {p.rut}{p.cargo ? ` · ${p.cargo}` : p.puesto ? ` · ${p.puesto}` : ''}
                                                                                </span>
                                                                            </button>
                                                                        ))}
                                                                    </div>
                                                                );
                                                            })()}
                                                        </div>
                                                        {afectados.length > 1 && (
                                                            <button
                                                                type="button"
                                                                style={{
                                                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                                    width: '36px', height: '36px', flexShrink: 0,
                                                                    border: '1px solid var(--surface-border)', borderRadius: 'var(--radius-md)',
                                                                    background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer'
                                                                }}
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
                                                        <p style={{ marginTop: 'var(--space-2)', fontSize: 'var(--text-sm)', color: 'var(--primary-400)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                            <FiCheck size={13} />
                                                            {afectado.nombre}{afectado.rut ? ` — ${afectado.rut}` : ''}{afectado.cargo ? ` · ${afectado.cargo}` : ''}
                                                        </p>
                                                    )}
                                                </div>
                                            ))}
                                            <button
                                                type="button"
                                                className="btn btn-secondary btn-sm"
                                                onClick={() => {
                                                    setAfectados([...afectados, { nombre: '', rut: '', cargo: '' }]);
                                                    setAfectadoSearch([...afectadoSearch, '']);
                                                    setShowAfectadoDropdown([...showAfectadoDropdown, false]);
                                                }}
                                            >
                                                <FiPlus size={14} style={{ marginRight: '4px' }} /> Agregar afectado
                                            </button>
                                        </div>
                                        )}

                                        {/* Sección: Descripción */}
                                        <div className="form-section">
                                            <h3 className="form-section-title">
                                                {formData.clasificacion === 'hallazgo' ? 'Descripción del Hallazgo' : 'Descripción del Incidente'}
                                            </h3>
                                            <div className="form-group">
                                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-2)' }}>
                                                    <label className="form-label" style={{ margin: 0 }}>Detalle *</label>
                                                    <button
                                                        type="button"
                                                        title={isDictating ? 'Detener grabación' : isTranscribingDesc ? 'Transcribiendo…' : 'Dictar descripción con voz'}
                                                        onClick={isDictating ? stopDictation : startDictation}
                                                        disabled={isTranscribingDesc}
                                                        style={{
                                                            display: 'inline-flex', alignItems: 'center', gap: '7px',
                                                            padding: '6px 14px', minHeight: '36px',
                                                            borderRadius: 'var(--radius-full)',
                                                            border: `1.5px solid ${isDictating ? 'var(--danger-500)' : isTranscribingDesc ? 'var(--primary-500)' : 'var(--surface-border)'}`,
                                                            background: isDictating ? 'rgba(244,67,54,0.10)' : isTranscribingDesc ? 'rgba(0,110,220,0.10)' : 'var(--surface-hover)',
                                                            color: isDictating ? 'var(--danger-400)' : isTranscribingDesc ? 'var(--primary-400)' : 'var(--text-secondary)',
                                                            cursor: isTranscribingDesc ? 'not-allowed' : 'pointer',
                                                            fontSize: 'var(--text-sm)', fontWeight: 500,
                                                            transition: 'all var(--transition-fast)',
                                                            flexShrink: 0,
                                                        }}
                                                    >
                                                        {isTranscribingDesc ? (
                                                            <>
                                                                <FiRefreshCw size={14} style={{ animation: 'spin 1s linear infinite', flexShrink: 0 }} />
                                                                Transcribiendo…
                                                            </>
                                                        ) : isDictating ? (
                                                            <>
                                                                <span style={{
                                                                    width: 9, height: 9, borderRadius: '50%',
                                                                    background: 'var(--danger-500)',
                                                                    display: 'inline-block', flexShrink: 0,
                                                                    animation: 'pulse-badge 1s ease-in-out infinite'
                                                                }} />
                                                                Grabando · Detener
                                                            </>
                                                        ) : (
                                                            <>
                                                                <FiMic size={14} />
                                                                Dictar
                                                            </>
                                                        )}
                                                    </button>
                                                </div>
                                                <textarea
                                                    className="form-input"
                                                    rows={5}
                                                    placeholder={formData.clasificacion === 'hallazgo'
                                                        ? 'Describa el hallazgo observado: condición o acción detectada, lugar exacto, posibles riesgos asociados…'
                                                        : 'Describa con detalle lo ocurrido, incluyendo circunstancias, lugar exacto, hora aproximada y cualquier información relevante…'}
                                                    value={formData.descripcion}
                                                    onChange={(e) => setFormData({ ...formData, descripcion: e.target.value })}
                                                    required
                                                />
                                                <span className="form-hint">
                                                    {formData.clasificacion === 'hallazgo'
                                                        ? 'Incluya toda la información que permita verificar y gestionar el hallazgo'
                                                        : 'Sea lo más específico posible para facilitar la investigación'}
                                                </span>
                                            </div>
                                        </div>

                                        {/* Sección: Evidencias */}
                                        <div className="form-section">
                                            <h3 className="form-section-title">Evidencias Fotográficas</h3>
                                            <div className="form-group">
                                                <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'stretch', marginBottom: (uploadedFiles.length > 0 || cameraActive) ? 'var(--space-3)' : 0 }}>
                                                    <div className="upload-zone" style={{ flex: 1 }}>
                                                        <input
                                                            type="file"
                                                            id="file-upload"
                                                            className="hidden"
                                                            multiple
                                                            accept="image/*"
                                                            onChange={handleFileSelect}
                                                        />
                                                        <label htmlFor="file-upload" className="upload-label">
                                                            <FiUpload size={24} className="text-muted mb-1" />
                                                            <p className="font-semibold" style={{ fontSize: 'var(--text-sm)' }}>Seleccionar fotos</p>
                                                            <p className="text-xs text-muted">PNG, JPG hasta 10MB</p>
                                                        </label>
                                                    </div>
                                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', flexShrink: 0 }}>
                                                        <button
                                                            type="button"
                                                            onClick={cameraActive ? capturePhoto : startCamera}
                                                            title={cameraActive ? 'Tomar foto' : 'Abrir cámara'}
                                                            style={{
                                                                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                                                                gap: '5px', padding: 'var(--space-3)', minWidth: '76px', flex: 1,
                                                                border: `1.5px solid ${cameraActive ? 'var(--primary-500)' : 'var(--surface-border)'}`,
                                                                borderRadius: 'var(--radius-md)',
                                                                background: cameraActive ? 'rgba(0,110,220,0.10)' : 'var(--surface-hover)',
                                                                color: cameraActive ? 'var(--primary-400)' : 'var(--text-secondary)',
                                                                cursor: 'pointer', fontSize: 'var(--text-xs)', fontWeight: 600,
                                                                transition: 'all var(--transition-fast)',
                                                            }}
                                                        >
                                                            <FiCamera size={22} />
                                                            {cameraActive ? 'Capturar' : 'Cámara'}
                                                        </button>
                                                        {cameraActive && (
                                                            <button
                                                                type="button"
                                                                onClick={stopCamera}
                                                                title="Cerrar cámara"
                                                                style={{
                                                                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px',
                                                                    padding: 'var(--space-2)', minHeight: '34px',
                                                                    border: '1px solid var(--surface-border)', borderRadius: 'var(--radius-md)',
                                                                    background: 'transparent', color: 'var(--text-muted)',
                                                                    cursor: 'pointer', fontSize: 'var(--text-xs)',
                                                                    transition: 'all var(--transition-fast)',
                                                                }}
                                                            >
                                                                <FiX size={13} /> Cerrar
                                                            </button>
                                                        )}
                                                    </div>
                                                </div>

                                                {cameraActive && (
                                                    <div style={{ marginBottom: 'var(--space-3)', borderRadius: 'var(--radius-lg)', overflow: 'hidden', border: '1.5px solid var(--primary-500)', background: '#000' }}>
                                                        <div style={{
                                                            padding: '6px 12px', display: 'flex', alignItems: 'center', gap: '8px',
                                                            background: 'rgba(0,110,220,0.12)', borderBottom: '1px solid rgba(0,110,220,0.25)',
                                                            fontSize: 'var(--text-xs)', color: 'var(--primary-400)', fontWeight: 600,
                                                        }}>
                                                            <span style={{
                                                                width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                                                                background: 'var(--danger-500)',
                                                                animation: 'pulse-badge 1s ease-in-out infinite'
                                                            }} />
                                                            Cámara activa — presiona Capturar para tomar la foto
                                                        </div>
                                                        <video
                                                            ref={videoRef}
                                                            autoPlay
                                                            playsInline
                                                            style={{ width: '100%', maxHeight: '240px', objectFit: 'cover', display: 'block' }}
                                                        />
                                                    </div>
                                                )}

                                                {uploadedFiles.length > 0 && (
                                                    <div>
                                                        <p className="text-sm font-semibold mb-2">{uploadedFiles.length} archivo(s) seleccionado(s)</p>
                                                        <div className="grid grid-cols-4 gap-3">
                                                            {uploadedFiles.map((file, index) => (
                                                                <div key={index} className="relative group">
                                                                    <img
                                                                        src={URL.createObjectURL(file)}
                                                                        alt={file.name}
                                                                        className="w-full h-24 object-cover rounded border border-surface-border"
                                                                    />
                                                                    <button
                                                                        type="button"
                                                                        className="absolute top-1 right-1 bg-danger-500 text-white rounded-full p-1.5 opacity-0 group-hover:opacity-100 transition-opacity"
                                                                        onClick={() => removeFile(index)}
                                                                    >
                                                                        <FiX size={14} />
                                                                    </button>
                                                                    <div className="absolute bottom-0 left-0 right-0 bg-black/60 p-1 text-xs text-white truncate rounded-b opacity-0 group-hover:opacity-100 transition-opacity">
                                                                        {file.name}
                                                                    </div>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        </div>

                                        {/* Sección: Confirmación de Envío */}
                                        <div className="form-section">
                                            <h3 className="form-section-title" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                                                <FiCheck size={16} />
                                                Confirmación de Envío
                                            </h3>
                                            <div style={{
                                                background: 'var(--surface-elevated)',
                                                border: '1px solid var(--surface-border)',
                                                borderRadius: 'var(--radius-lg)',
                                                overflow: 'hidden'
                                            }}>
                                                {/* Metadata del reporte */}
                                                <div style={{
                                                    display: 'flex', gap: 'var(--space-6)', flexWrap: 'wrap',
                                                    padding: 'var(--space-4)', borderBottom: '1px solid var(--surface-border)',
                                                    background: 'var(--surface-card)'
                                                }}>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                                                        <FiUser size={14} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                                                        <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>Reportado por</span>
                                                        <span style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--text-primary)' }}>
                                                            {[user?.nombre, user?.apellidoPaterno, user?.apellidoMaterno].filter(Boolean).join(' ')}
                                                        </span>
                                                    </div>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                                                        <FiCalendar size={14} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                                                        <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>Fecha y hora</span>
                                                        <span style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--text-primary)' }}>
                                                            {new Date().toLocaleString('es-CL')}
                                                        </span>
                                                    </div>
                                                </div>
                                                {/* Checkbox de declaración */}
                                                <label style={{
                                                    display: 'flex', alignItems: 'flex-start', gap: 'var(--space-3)',
                                                    padding: 'var(--space-4)', cursor: 'pointer'
                                                }}>
                                                    <input
                                                        type="checkbox"
                                                        checked={confirmaEnvio}
                                                        onChange={(e) => setConfirmaEnvio(e.target.checked)}
                                                        style={{ marginTop: '3px', flexShrink: 0, accentColor: 'var(--primary-500)' }}
                                                        required
                                                    />
                                                    <div>
                                                        <p style={{ fontSize: 'var(--text-sm)', fontWeight: 500, color: 'var(--text-primary)', margin: 0 }}>
                                                            {formData.clasificacion === 'hallazgo'
                                                                ? 'Declaro que el hallazgo reportado ha sido observado directamente y es comprobable en terreno.'
                                                                : 'Declaro que la información proporcionada corresponde fielmente a los hechos ocurridos.'}
                                                        </p>
                                                        <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', marginTop: 'var(--space-1)' }}>
                                                            Esta declaración queda registrada con tu nombre y es verificable por cargos superiores.
                                                        </p>
                                                    </div>
                                                </label>
                                            </div>
                                        </div>

                                        {formError && (
                                            <div className="bg-danger-500/10 border border-danger-500/20 text-danger-500 p-4 rounded-lg mb-6 flex items-center gap-3 animate-shake">
                                                <FiAlertCircle size={20} />
                                                <span className="text-sm font-medium">{formError}</span>
                                            </div>
                                        )}

                                        <div className="modal-footer">
                                            <button
                                                type="button"
                                                className="btn btn-secondary"
                                                onClick={() => setShowModal(false)}
                                                disabled={uploading}
                                            >
                                                <FiX className="mr-2" />
                                                Cancelar
                                            </button>
                                            <button
                                                type="submit"
                                                className="btn btn-primary"
                                                disabled={uploading}
                                            >
                                                {uploading ? (
                                                    <>
                                                        <div className="spinner mr-2" />
                                                        Enviando...
                                                    </>
                                                ) : (
                                                    <>
                                                        <FiSave className="mr-2" />
                                                        {formData.clasificacion === 'hallazgo' ? 'Reportar Hallazgo' : 'Reportar Incidente'}
                                                    </>
                                                )}
                                            </button>
                                        </div>
                                    </form>
                                )}
                            </div>
                </Modal>

                {/* Detail Modal */}
                <Modal
                    isOpen={!!selectedIncident}
                    onClose={() => {
                        setSelectedIncident(null);
                        setDetailError('');
                        setDetailLoading(false);
                        setImagePreview(null);
                    }}
                    title={`Detalle del ${selectedIncident ? getTipoLabel(selectedIncident.tipo) : ''}`}
                    subtitle={`Reportado el ${selectedIncident ? new Date(selectedIncident.fecha).toLocaleDateString('es-CL') : ''}`}
                    icon={<FiAlertTriangle size={24} />}
                    size="xl"
                    footer={
                        <button
                            className="btn btn-secondary"
                            onClick={() => {
                                setSelectedIncident(null);
                                setDetailError('');
                                setDetailLoading(false);
                                setImagePreview(null);
                            }}
                        >
                            <FiX className="mr-2" />
                            Cerrar
                        </button>
                    }
                >
                    {selectedIncident && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>

                            {/* Flash banner */}
                            {(selectedIncident as any).reporteFlash?.esFlash && (
                                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-3)', padding: 'var(--space-3) var(--space-4)', borderRadius: 'var(--radius-md)', background: 'rgba(245,158,11,0.07)', border: '1px solid rgba(245,158,11,0.2)' }}>
                                    <FiAlertCircle size={14} style={{ color: 'var(--warning-500)', flexShrink: 0, marginTop: '2px' }} />
                                    <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.5 }}>
                                        Reporte inicial — datos serán completados durante la investigación.
                                    </p>
                                </div>
                            )}

                            {/* Loading / Error */}
                            {detailLoading && (
                                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>
                                    <FiActivity size={14} style={{ animation: 'spin 1s linear infinite' }} />
                                    Cargando detalle…
                                </div>
                            )}
                            {detailError && (
                                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', padding: 'var(--space-3) var(--space-4)', background: 'rgba(239,68,68,0.07)', border: '1px solid rgba(239,68,68,0.18)', borderRadius: 'var(--radius-md)', fontSize: 'var(--text-sm)', color: 'var(--danger-400)' }}>
                                    <FiAlertCircle size={14} />{detailError}
                                </div>
                            )}

                            {/* Metadatos — tira compacta */}
                            <div style={{ display: 'flex', gap: 'var(--space-6)', flexWrap: 'wrap', paddingBottom: 'var(--space-4)', borderBottom: '1px solid var(--surface-border)' }}>
                                <div>
                                    <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600, marginBottom: '3px' }}>Tipo</div>
                                    <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--text-primary)' }}>{getTipoLabel(selectedIncident.tipo)}</div>
                                </div>
                                <div>
                                    <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600, marginBottom: '3px' }}>Estado</div>
                                    <span className={`badge ${getEstadoBadge(selectedIncident.estado)}`} style={{ fontSize: '11px' }}>{selectedIncident.estado.replace('_', ' ')}</span>
                                </div>
                                <div>
                                    <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600, marginBottom: '3px' }}>Gravedad</div>
                                    <span className={`badge ${getGravedadBadge(selectedIncident.gravedad)}`} style={{ fontSize: '11px' }}>{selectedIncident.gravedad}</span>
                                </div>
                                <div>
                                    <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600, marginBottom: '3px' }}>Fecha</div>
                                    <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-primary)' }}>
                                        {new Date(selectedIncident.fecha).toLocaleDateString('es-CL', { day: 'numeric', month: 'short', year: 'numeric' })}
                                        {selectedIncident.hora && <span style={{ color: 'var(--text-muted)', marginLeft: '6px' }}>{selectedIncident.hora}</span>}
                                    </div>
                                </div>
                                {(selectedIncident.diasPerdidos ?? 0) > 0 && (
                                    <div>
                                        <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600, marginBottom: '3px' }}>Días perdidos</div>
                                        <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--danger-400)' }}>{selectedIncident.diasPerdidos}</div>
                                    </div>
                                )}
                            </div>

                            {/* Descripción — bloque principal */}
                            <div>
                                <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600, marginBottom: 'var(--space-2)' }}>
                                    {esHallazgo(selectedIncident) ? 'Descripción del hallazgo' : 'Descripción del incidente'}
                                </div>
                                <p style={{ margin: 0, fontSize: 'var(--text-sm)', color: selectedIncident.descripcion ? 'var(--text-primary)' : 'var(--text-muted)', fontStyle: selectedIncident.descripcion ? 'normal' : 'italic', lineHeight: 1.75 }}>
                                    {selectedIncident.descripcion || 'Sin descripción registrada.'}
                                </p>
                            </div>

                            {/* Trabajador afectado */}
                            {selectedIncident.trabajador.nombre && (
                                <div style={{ paddingTop: 'var(--space-4)', borderTop: '1px solid var(--surface-border)' }}>
                                    <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600, marginBottom: 'var(--space-2)' }}>Trabajador afectado</div>
                                    <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center', flexWrap: 'wrap' }}>
                                        <div>
                                            <div style={{ fontWeight: 600, fontSize: 'var(--text-sm)', color: 'var(--text-primary)' }}>{selectedIncident.trabajador.nombre}</div>
                                            {selectedIncident.trabajador.rut && (
                                                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{selectedIncident.trabajador.rut}</div>
                                            )}
                                        </div>
                                        {selectedIncident.trabajador.cargo && (
                                            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', padding: '3px 8px', background: 'var(--surface-elevated)', border: '1px solid var(--surface-border)', borderRadius: 'var(--radius-sm)' }}>
                                                {selectedIncident.trabajador.cargo}
                                            </span>
                                        )}
                                    </div>
                                </div>
                            )}

                            {/* Gestionar — acciones con permisos */}
                            {(canCreateIncidente || canCalificarAccidente) && (
                                <div style={{ paddingTop: 'var(--space-4)', borderTop: '1px solid var(--surface-border)' }}>
                                    <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600, marginBottom: 'var(--space-3)' }}>Gestionar</div>
                                    <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap', alignItems: 'center' }}>
                                        {esHallazgo(selectedIncident) && canCreateIncidente && (
                                            <button
                                                className="btn btn-sm btn-secondary"
                                                onClick={() => openGobernanza(selectedIncident)}
                                            >
                                                <FiActivity size={13} style={{ marginRight: '4px' }} />
                                                Gobernanza del hallazgo
                                            </button>
                                        )}
                                        {canCalificarAccidente && selectedIncident.tipo !== 'accidente' && (
                                            confirmingAccidenteId === selectedIncident.incidentId ? (
                                                <>
                                                    <button
                                                        className="btn btn-sm"
                                                        disabled={markingAccidente}
                                                        onClick={() => handleMarcarAccidente(selectedIncident.incidentId)}
                                                        style={{ background: 'var(--danger-600)', color: '#fff', border: 'none', opacity: markingAccidente ? 0.7 : 1 }}
                                                    >
                                                        {markingAccidente ? 'Guardando…' : '¿Confirmar accidente?'}
                                                    </button>
                                                    <button className="btn btn-sm btn-secondary" disabled={markingAccidente} onClick={() => setConfirmingAccidenteId(null)}>
                                                        Cancelar
                                                    </button>
                                                </>
                                            ) : (
                                                <button
                                                    className="btn btn-sm btn-secondary"
                                                    onClick={() => setConfirmingAccidenteId(selectedIncident.incidentId)}
                                                    style={{ color: 'var(--danger-400)', borderColor: 'rgba(239,68,68,0.4)' }}
                                                >
                                                    <FiAlertCircle size={13} style={{ marginRight: '4px' }} />
                                                    Marcar como accidente
                                                </button>
                                            )
                                        )}
                                    </div>
                                </div>
                            )}

                            {/* Trazabilidad */}
                            {selectedIncident.reportadoPor && (
                                <div style={{ paddingTop: 'var(--space-4)', borderTop: '1px solid var(--surface-border)' }}>
                                    <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600, marginBottom: '2px' }}>Reportado por</div>
                                    <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-primary)' }}>
                                        {(selectedIncident as any).realizadoPor?.nombre || selectedIncident.reportadoPor}
                                    </div>
                                    {(selectedIncident as any).realizadoPor?.rut && (
                                        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', marginTop: '2px' }}>
                                            {(selectedIncident as any).realizadoPor.rut}
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Evidencias */}
                            {incidentEvidenceItems.length > 0 && (
                                <div style={{ paddingTop: 'var(--space-4)', borderTop: '1px solid var(--surface-border)' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-3)' }}>
                                        <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600 }}>Evidencias fotográficas</span>
                                        <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{incidentEvidenceItems.length} archivo{incidentEvidenceItems.length !== 1 ? 's' : ''}</span>
                                    </div>
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))', gap: 'var(--space-2)' }}>
                                        {incidentEvidenceItems.map(item => (
                                            <div
                                                key={item.id}
                                                className="incident-evidence-card"
                                                onClick={() => item.url && setImagePreview({ url: item.url, title: item.title })}
                                                title={item.url ? 'Ver imagen' : 'Imagen no disponible'}
                                                role="button"
                                                tabIndex={0}
                                                onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
                                                    if (event.key === 'Enter' && item.url) setImagePreview({ url: item.url, title: item.title });
                                                }}
                                            >
                                                {item.url ? (
                                                    <img src={item.url} alt={item.title} loading="lazy" />
                                                ) : (
                                                    <div className="incident-evidence-placeholder">
                                                        <FiImage size={24} />
                                                    </div>
                                                )}
                                                <div className="incident-evidence-meta">
                                                    <FiImage size={10} />
                                                    <span>{item.label}</span>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                        </div>
                    )}
                </Modal>


                {imagePreview && (
                    <div className="incident-evidence-lightbox" onClick={() => setImagePreview(null)}>
                        <div className="incident-evidence-lightbox-content" onClick={(e) => e.stopPropagation()}>
                            <button
                                type="button"
                                className="incident-evidence-lightbox-close"
                                onClick={() => setImagePreview(null)}
                                aria-label="Cerrar imagen"
                            >
                                <FiX size={20} />
                            </button>
                            <img src={imagePreview.url} alt={imagePreview.title} />
                            <p>{imagePreview.title}</p>
                        </div>
                    </div>
                )}


                <style>{`
                /* ── Lista de incidentes/hallazgos ── */
                .incident-list {
                    border-top: 1px solid var(--surface-border);
                }

                .incident-row {
                    display: grid;
                    grid-template-columns: 7rem 1fr auto;
                    gap: var(--space-4);
                    align-items: start;
                    padding: var(--space-4) var(--space-5);
                    border-bottom: 1px solid var(--surface-border);
                    cursor: pointer;
                    transition: background var(--transition-fast);
                    outline: none;
                }

                .incident-row:hover,
                .incident-row:focus-visible {
                    background: var(--surface-elevated);
                }

                .incident-row-meta {
                    padding-top: 2px;
                }

                .incident-row-desc {
                    padding-top: 2px;
                }

                .incident-row-status {
                    display: flex;
                    flex-direction: column;
                    align-items: flex-end;
                    gap: var(--space-1);
                    padding-top: 2px;
                    flex-shrink: 0;
                }

                @media (max-width: 600px) {
                    .incident-row {
                        grid-template-columns: 6rem 1fr auto;
                        gap: var(--space-3);
                        padding: var(--space-3) var(--space-4);
                    }
                }

                @media (prefers-reduced-motion: reduce) {
                    .incident-row { transition: none; }
                }

                /* Tabs Navigation */
                .incidents-tabs {
                    display: flex;
                    gap: var(--space-2);
                    background: var(--surface-card);
                    padding: var(--space-2);
                    border-radius: var(--radius-lg);
                    border: 1px solid var(--surface-border);
                }

                .incidents-tab {
                    display: flex;
                    align-items: center;
                    gap: var(--space-2);
                    padding: var(--space-3) var(--space-5);
                    border-radius: var(--radius-md);
                    border: none;
                    background: transparent;
                    color: var(--text-muted);
                    font-weight: 600;
                    cursor: pointer;
                    transition: all var(--transition-normal);
                }

                .incidents-tab:hover {
                    background: var(--surface-elevated);
                    color: var(--text-primary);
                }

                .incidents-tab.active {
                    background: linear-gradient(135deg, var(--primary-500), var(--primary-600));
                    color: white;
                }

                /* Dashboard Header */
                .dashboard-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    padding: var(--space-4);
                    background: var(--surface-card);
                    border: 1px solid var(--surface-border);
                    border-radius: var(--radius-lg);
                }

                .stats-grid-4 {
                    display: grid;
                    grid-template-columns: repeat(4, 1fr);
                    gap: var(--space-4);
                }

                @media (max-width: 1024px) {
                    .stats-grid-4 {
                        grid-template-columns: repeat(2, 1fr);
                    }
                }

                @media (max-width: 600px) {
                    .stats-grid-4 {
                        grid-template-columns: 1fr;
                    }
                }

                .stat-card {
                    display: flex;
                    align-items: center;
                    gap: var(--space-4);
                    padding: var(--space-5);
                    background: var(--surface-card);
                    border: 1px solid var(--surface-border);
                    border-radius: var(--radius-lg);
                    transition: all var(--transition-normal);
                }

                .stat-card:hover {
                    background: var(--surface-elevated);
                    transform: translateY(-2px);
                    box-shadow: var(--shadow-lg);
                }

                .stat-card-icon {
                    width: 56px;
                    height: 56px;
                    border-radius: var(--radius-md);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    color: white;
                    flex-shrink: 0;
                }

                .stat-card-content {
                    flex: 1;
                }

                .stat-card-label {
                    font-size: var(--text-xs);
                    color: var(--text-muted);
                    text-transform: uppercase;
                    letter-spacing: 0.05em;
                    font-weight: 600;
                    margin-bottom: var(--space-1);
                }

                .stat-card-value {
                    font-size: var(--text-2xl);
                    font-weight: 700;
                    color: var(--text-primary);
                }

                /* Charts */
                .charts-grid {
                    display: grid;
                    grid-template-columns: repeat(3, 1fr);
                    gap: var(--space-4);
                }

                .charts-row-2 {
                    display: grid;
                    grid-template-columns: repeat(2, 1fr);
                    gap: var(--space-4);
                }

                @media (max-width: 1200px) {
                    .charts-grid, .charts-row-2 {
                        grid-template-columns: 1fr;
                    }
                }

                .chart-container {
                    padding: var(--space-3);
                    height: 160px;
                    display: flex;
                    flex-direction: column;
                    justify-content: center;
                }

                .line-chart {
                    width: 100%;
                    height: 100%;
                }

                /* Calendarheat map / Month Calendar */
                .calendar-card-full {
                    min-height: auto;
                }


                .calendar-weekdays {
                    display: grid;
                    grid-template-columns: repeat(7, 1fr);
                    gap: 4px;
                    margin-bottom: 4px;
                    width: 100%;
                }

                .weekday-cell {
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    font-size: 10px;
                    font-weight: 600;
                    color: var(--text-muted);
                    text-transform: uppercase;
                    width: 42px;
                    height: 32px;
                }

                .calendar-grid-month {
                    display: grid;
                    grid-template-columns: repeat(7, 1fr);
                    gap: 4px;
                    width: 100%;
                }

                .calendar-cell-day {
                    width: 42px;
                    height: 32px;
                    min-width: 42px;
                    min-height: 32px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    background: var(--surface-elevated);
                    border-radius: var(--radius-sm);
                    position: relative;
                    transition: all var(--transition-normal);
                    border: 1px solid var(--surface-border);
                }

                .calendar-cell-empty {
                    width: 42px;
                    height: 32px;
                    min-width: 42px;
                    min-height: 32px;
                    visibility: hidden;
                }
                    
                .calendar-cell-day:hover {
                    transform: translateY(-2px);
                    z-index: 2;
                    box-shadow: var(--shadow-md);
                    border-color: var(--primary-300);
                    background: var(--surface-card);
                }

                .calendar-cell-day.leve { background: linear-gradient(135deg, rgba(76, 175, 80, 0.35), rgba(76, 175, 80, 0.15)); border-color: rgba(76, 175, 80, 0.4); }
                .calendar-cell-day.grave { background: linear-gradient(135deg, rgba(255, 152, 0, 0.35), rgba(255, 152, 0, 0.15)); border-color: rgba(255, 152, 0, 0.4); }
                .calendar-cell-day.fatal { background: linear-gradient(135deg, rgba(244, 67, 54, 0.45), rgba(244, 67, 54, 0.25)); border-color: rgba(244, 67, 54, 0.4); }

                /* Custom Tooltip Styling */
                .calendar-tooltip {
                    position: absolute;
                    bottom: 110%;
                    left: 50%;
                    transform: translateX(-50%) translateY(10px);
                    background: rgba(15, 23, 42, 0.95);
                    backdrop-filter: blur(8px);
                    border: 1px solid rgba(255, 255, 255, 0.1);
                    border-radius: 8px;
                    padding: 8px 12px;
                    width: max-content;
                    max-width: 200px;
                    z-index: 100;
                    box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.5);
                    opacity: 0;
                    visibility: hidden;
                    pointer-events: none;
                    transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
                }

                .calendar-cell-day:hover .calendar-tooltip {
                    opacity: 1;
                    visibility: visible;
                    transform: translateX(-50%) translateY(0);
                }

                .tooltip-header {
                    font-size: 10px;
                    font-weight: 700;
                    color: var(--primary-400);
                    text-transform: uppercase;
                    letter-spacing: 0.05em;
                    margin-bottom: 4px;
                    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
                    padding-bottom: 4px;
                }

                .tooltip-body {
                    display: flex;
                    flex-direction: column;
                    gap: 4px;
                }

                .tooltip-stat {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    gap: 12px;
                    font-size: 11px;
                }

                .tooltip-stat .label {
                    color: var(--text-muted);
                }

                .tooltip-stat .value {
                    color: var(--text-primary);
                    font-weight: 600;
                }

                .no-events {
                    color: var(--text-muted);
                    font-size: 10px;
                    font-style: italic;
                    text-align: center;
                }

                .severity-badge {
                    font-size: 9px;
                    font-weight: 700;
                    padding: 2px 6px;
                    border-radius: 4px;
                    background: rgba(255, 255, 255, 0.05);
                }

                .severity-badge.leve { color: #4ade80; background: rgba(74, 222, 128, 0.1); }
                .severity-badge.grave { color: #fbbf24; background: rgba(251, 191, 36, 0.1); }
                .severity-badge.fatal { color: #f87171; background: rgba(248, 113, 113, 0.1); }

                /* Incident Detail Modal */
                .detail-row {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    padding: var(--space-2) 0;
                }

                .detail-label {
                    font-size: var(--text-sm);
                    color: var(--text-muted);
                    font-weight: 500;
                }

                .detail-value {
                    font-size: var(--text-sm);
                    color: var(--text-primary);
                    font-weight: 600;
                }

                .avatar {
                    width: 48px;
                    height: 48px;
                    border-radius: var(--radius-full);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    font-weight: 700;
                    font-size: var(--text-lg);
                }

                .avatar-sm {
                    width: 32px;
                    height: 32px;
                    font-size: var(--text-sm);
                }

                .badge {
                    padding: 4px 12px;
                    border-radius: var(--radius-full);
                    font-size: var(--text-xs);
                    font-weight: 700;
                    text-transform: uppercase;
                }

                .badge-success { background: var(--success-500); color: white; }
                .badge-warning { background: var(--warning-500); color: white; }
                .badge-danger { background: var(--danger-500); color: white; }

                /* Evidence Preview */
                .incident-evidence-card {
                    position: relative;
                    border-radius: var(--radius-lg);
                    overflow: hidden;
                    border: 1px solid var(--surface-border);
                    background: var(--surface-elevated);
                    min-height: 140px;
                    cursor: pointer;
                }

                .incident-evidence-card img {
                    width: 100%;
                    height: 100%;
                    object-fit: cover;
                    transition: transform var(--transition-normal);
                }

                .incident-evidence-card:hover img {
                    transform: scale(1.05);
                }

                .incident-evidence-lightbox {
                    position: fixed;
                    inset: 0;
                    background: rgba(0, 0, 0, 0.9);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    z-index: 2000;
                    padding: var(--space-6);
                }

                .incident-evidence-lightbox-content {
                    position: relative;
                    max-width: 90vw;
                    max-height: 90vh;
                }

                .incident-evidence-lightbox-content img {
                    max-width: 100%;
                    max-height: 80vh;
                    border-radius: var(--radius-lg);
                    box-shadow: 0 25px 50px rgba(0,0,0,0.5);
                }

                .incident-evidence-lightbox-close {
                    position: absolute;
                    top: -40px;
                    right: 0;
                    background: transparent;
                    border: none;
                    color: white;
                    cursor: pointer;
                }

                /* AI Quick Report Styles */
                .quick-report-container {
                    background: var(--surface-card);
                    border-radius: 0 0 var(--radius-lg) var(--radius-lg);
                }

                .camera-view {
                    aspect-ratio: 4/3;
                    border: 2px solid var(--surface-border);
                    box-shadow: var(--shadow-inner);
                    position: relative;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                }

                .camera-live-label {
                    display: inline-flex;
                    align-items: center;
                    gap: 6px;
                    padding: 6px 10px;
                    font-size: 10px;
                    letter-spacing: 0.08em;
                    text-transform: uppercase;
                    color: white;
                    background: rgba(0,0,0,0.6);
                    border: 1px solid rgba(255,255,255,0.12);
                    border-radius: 999px;
                    margin-bottom: var(--space-2);
                    width: fit-content;
                }

                .camera-view.is-idle {
                    aspect-ratio: auto;
                }

                .camera-placeholder {
                    padding: var(--space-3);
                    min-height: 120px;
                    justify-content: center;
                }

                .audio-recorder {
                    min-height: 250px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                }

                .modal-header-text {
                    flex: 1;
                    display: flex;
                    flex-direction: column;
                }

                @media (max-width: 640px) {
                    .modal-header {
                        flex-direction: column;
                        align-items: flex-start;
                        gap: var(--space-2);
                        padding: var(--space-4);
                    }
                    .modal-title {
                        font-size: var(--text-lg);
                        margin: 0;
                    }
                    .modal-subtitle {
                        font-size: var(--text-xs);
                        margin-top: var(--space-1);
                    }
                }

                .loader-dots {
                    display: flex;
                    gap: 6px;
                }

                .loader-dots div {
                    width: 10px;
                    height: 10px;
                    background: var(--primary-500);
                    border-radius: 50%;
                    animation: loader-dots 1.4s infinite ease-in-out both;
                }

                .loader-dots div:nth-child(2) { animation-delay: -0.16s; }

                /* Shutter Button Styles */
                .btn-shutter {
                    background: transparent;
                    border: none;
                    cursor: pointer;
                    padding: 0;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    transition: transform 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275);
                }

                .btn-shutter:hover {
                    transform: scale(1.1);
                }

                .btn-shutter:active {
                    transform: scale(0.9);
                }

                .btn-shutter-outer {
                    width: 58px;
                    height: 58px;
                    border-radius: 50%;
                    border: 4px solid white;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    background: rgba(255, 255, 255, 0.1);
                    backdrop-filter: blur(4px);
                    box-shadow: 0 0 20px rgba(0, 0, 0, 0.5);
                }

                .btn-shutter-inner {
                    width: 44px;
                    height: 44px;
                    border-radius: 50%;
                    background: white;
                    box-shadow: inset 0 0 10px rgba(0, 0, 0, 0.1);
                    transition: all 0.2s;
                }

                .btn-shutter:hover .btn-shutter-inner {
                    background: var(--primary-500);
                }

                /* Location preview */
                .location-box {
                    border: 1px dashed var(--surface-border);
                    background: var(--surface-elevated);
                    border-radius: var(--radius-md);
                    padding: var(--space-3);
                }

                .location-error {
                    display: flex;
                    align-items: center;
                    gap: var(--space-2);
                    color: var(--danger-500);
                    font-size: var(--text-sm);
                    margin-top: var(--space-2);
                }

                .location-loading {
                    display: flex;
                    align-items: center;
                    gap: var(--space-2);
                    color: var(--text-muted);
                    margin-top: var(--space-2);
                }

                .map-preview-frame {
                    position: relative;
                    border: 1px solid var(--surface-border);
                    border-radius: var(--radius-md);
                    overflow: hidden;
                    background: var(--surface-card);
                    aspect-ratio: 16 / 9;
                }

                .map-preview-frame iframe {
                    width: 100%;
                    height: 100%;
                    border: 0;
                    pointer-events: none;
                }

                .map-preview-overlay {
                    position: absolute;
                    inset: 0;
                    display: flex;
                    align-items: flex-end;
                    padding: var(--space-3);
                    background: linear-gradient(180deg, transparent 60%, rgba(0, 0, 0, 0.55));
                    color: white;
                    font-weight: 700;
                    text-decoration: none;
                    opacity: 1;
                    transition: opacity var(--transition-normal);
                }

                .map-preview-frame:hover .map-preview-overlay {
                    opacity: 1;
                }

                .location-map-card {
                    border: 1px solid var(--surface-border);
                    border-radius: var(--radius-md);
                    padding: var(--space-3);
                    background: var(--surface-card);
                }

                .modal-close-btn {
                    background: transparent;
                    border: none;
                    color: var(--text-muted);
                    padding: var(--space-2);
                    border-radius: var(--radius-md);
                    cursor: pointer;
                    transition: all var(--transition-normal);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                }

                .modal-close-btn:hover {
                    background: var(--surface-elevated);
                    color: var(--text-primary);
                }

                /* Success View Styles */
                .success-modal-body {
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                }

                .success-animation-container {
                    position: relative;
                    width: 100px;
                    height: 100px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                }

                .success-pulse {
                    position: absolute;
                    width: 100%;
                    height: 100%;
                    background: var(--success-500);
                    border-radius: 50%;
                    opacity: 0.2;
                    animation: pulse-success 2s infinite;
                }

                .success-icon-wrapper {
                    position: relative;
                    width: 80px;
                    height: 80px;
                    background: var(--success-500);
                    border-radius: 50%;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    box-shadow: 0 10px 25px rgba(34, 197, 94, 0.4);
                }

                @keyframes pulse-success {
                    0% { transform: scale(1); opacity: 0.4; }
                    100% { transform: scale(1.6); opacity: 0; }
                }

                @keyframes shake {
                    0%, 100% { transform: translateX(0); }
                    10%, 30%, 50%, 70%, 90% { transform: translateX(-4px); }
                    20%, 40%, 60%, 80% { transform: translateX(4px); }
                }

                .animate-shake {
                    animation: shake 0.5s cubic-bezier(.36,.07,.19,.97) both;
                }

                @keyframes loader-dots {
                    0%, 80%, 100% { transform: scale(0); }
                    40% { transform: scale(1); }
                }

                @keyframes bounce {
                    0%, 100% { transform: scaleY(1); }
                    50% { transform: scaleY(0.4); }
                }
            `}</style>
            </>}
            </div>

            {/* Modal: gobernanza de hallazgos (responsable, plazo, verificacion de cierre) */}
            <Modal
                isOpen={!!gobIncident}
                onClose={() => setGobIncident(null)}
                title="Gobernanza del hallazgo"
                subtitle={gobIncident?.descripcion ? gobIncident.descripcion.slice(0, 80) : ''}
                size="md"
                footer={
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-2)', width: '100%' }}>
                        <button className="btn btn-secondary" onClick={() => setGobIncident(null)}>Cancelar</button>
                        <button className="btn btn-primary" onClick={handleSaveGobernanza} disabled={gobSaving}>
                            {gobSaving ? 'Guardando…' : 'Guardar gobernanza'}
                        </button>
                    </div>
                }
            >
                <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                    {gobError && (
                        <div style={{ padding: '8px 12px', borderRadius: '8px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', fontSize: '0.82rem', color: '#b91c1c' }}>
                            {gobError}
                        </div>
                    )}
                    <div className="form-group">
                        <label className="form-label">Responsable de cierre</label>
                        <select className="form-input form-select" value={gobForm.responsableId} onChange={(e) => setGobForm({ ...gobForm, responsableId: e.target.value })}>
                            <option value="">Seleccione…</option>
                            {personasTenant.map((p: any) => (
                                <option key={p.personaId} value={p.personaId}>{p.nombre} {p.apellido || ''} {p.cargo ? `- ${p.cargo}` : ''}</option>
                            ))}
                        </select>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        <div className="form-group">
                            <label className="form-label">Plazo de respuesta</label>
                            <input type="date" className="form-input" value={gobForm.plazoRespuestaISO} onChange={(e) => setGobForm({ ...gobForm, plazoRespuestaISO: e.target.value })} />
                        </div>
                        <div className="form-group">
                            <label className="form-label">Estado de cierre</label>
                            <select className="form-input form-select" value={gobForm.estadoCierre} onChange={(e) => setGobForm({ ...gobForm, estadoCierre: e.target.value })}>
                                <option value="abierto">Abierto</option>
                                <option value="en_proceso">En proceso</option>
                                <option value="cerrado">Cerrado</option>
                            </select>
                        </div>
                    </div>
                    <div className="form-group">
                        <label className="form-label">Comentario de cierre {gobForm.estadoCierre === 'cerrado' && '*'}</label>
                        <textarea className="form-input" rows={3} value={gobForm.comentarioCierre} onChange={(e) => setGobForm({ ...gobForm, comentarioCierre: e.target.value })} style={{ resize: 'vertical' }} />
                        <span className="form-hint">El cierre queda verificado por ti ({user?.nombre || 'usuario actual'}).</span>
                    </div>
                </div>
            </Modal>
        </>
    );
}
