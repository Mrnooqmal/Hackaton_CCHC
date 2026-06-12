import { useState, useEffect, useRef, useCallback } from 'react';
import type { KeyboardEvent } from 'react';
import {
    FiPlus, FiAlertTriangle, FiFilter, FiX, FiUpload, FiImage,
    FiUser, FiMapPin, FiCalendar, FiTrendingUp, FiActivity,
    FiAlertCircle, FiFileText, FiSave, FiChevronDown, FiChevronUp,
    FiPieChart, FiList, FiBarChart2, FiCheck, FiArrowRight,
    FiMic, FiCamera, FiStopCircle, FiRefreshCw, FiPlay, FiZap
} from 'react-icons/fi';
import { incidentsApi, aiApi, workersApi } from '../api/client';
import type { Incident, CreateIncidentData, IncidentStats, AnalyticsData, IncidentLocation } from '../api/client';
import { useAuth } from '../context/AuthContext';
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
    const { user } = useAuth();
    const [incidents, setIncidents] = useState<Incident[]>([]);
    const [stats, setStats] = useState<IncidentStats | null>(null);
    const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
    const [loading, setLoading] = useState(true);
    const [showModal, setShowModal] = useState(false);
    const [selectedIncident, setSelectedIncident] = useState<Incident | null>(null);
    const [detailLoading, setDetailLoading] = useState(false);
    const [detailError, setDetailError] = useState('');
    const [imagePreview, setImagePreview] = useState<{ url: string; title: string } | null>(null);
    const [showFilters, setShowFilters] = useState(false);
    const [activeTab, setActiveTab] = useState<'listado' | 'estadisticas'>('listado');
    const [filters, setFilters] = useState({
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
    const [locationError, setLocationError] = useState('');

    const [chartMetric, setChartMetric] = useState<'total' | 'accidentes' | 'incidentes'>('total');
    const [calendarMonth, setCalendarMonth] = useState(new Date());
    const [showSuccess, setShowSuccess] = useState(false);
    const [formError, setFormError] = useState('');

    // ─── Reunion 2026-06-10: hallazgos vs incidentes ──────────────────────────
    // Incidentes/accidentes: creacion restringida a supervisor y superiores.
    const canCreateIncidente = ['admin', 'jefe_obra', 'supervisor', 'prevencionista'].includes(user?.rol || '');
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
    }, [filters]);

    useEffect(() => {
        if (activeTab === 'estadisticas') {
            loadAnalytics();
        }
    }, [activeTab]);

    // Precarga trabajadores al abrir el modal (hallazgo e incidente)
    useEffect(() => {
        if (showModal && personasTenant.length === 0) {
            workersApi.list().then(res => {
                if (res.success && res.data) setPersonasTenant(res.data as any[]);
            });
        }
    }, [showModal]);

    const loadIncidents = async () => {
        setLoading(true);
        try {
            const response = await incidentsApi.list({
                empresaId: user?.empresaId,
                ...filters
            });
            if (response.success && response.data) {
                setIncidents(response.data);
            }
        } catch (error) {
            console.error('Error cargando incidentes:', error);
        } finally {
            setLoading(false);
        }
    };

    const loadStats = async () => {
        try {
            const response = await incidentsApi.getStats({
                empresaId: user?.empresaId,
                masaLaboral: 100 // TODO: Obtener de configuración
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
        try {
            const response = await incidentsApi.getAnalytics({
                empresaId: user?.tenantId || user?.empresaId
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
    const [step, setStep] = useState(0); // 0: Quick Capture, 1: Form Details
    const [isRecording, setIsRecording] = useState(false);
    const [transcript, setTranscript] = useState('');
    const [isProcessingAI, setIsProcessingAI] = useState(false);
    const [isTranscribing, setIsTranscribing] = useState(false);
    const [cameraActive, setCameraActive] = useState(false);
    const [videoStream, setVideoStream] = useState<MediaStream | null>(null);
    const videoRef = useRef<HTMLVideoElement>(null);
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const audioChunksRef = useRef<Blob[]>([]);

    const buildMapsLink = (lat: number, lng: number) => `https://www.google.com/maps?q=${lat},${lng}&z=18`;

    const buildEmbedUrl = (lat: number, lng: number) => {
        const delta = 0.01;
        const bbox = `${lng - delta},${lat - delta},${lng + delta},${lat + delta}`;
        return `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${lat},${lng}`;
    };

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
            setTranscript('');
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
        setStep(0);
        resetForm();
    };

    const startRecording = async () => {
        setIsRecording(true);
        audioChunksRef.current = []; // Clear previous chunks

        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const mediaRecorder = new MediaRecorder(stream);
            mediaRecorderRef.current = mediaRecorder;

            mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    audioChunksRef.current.push(event.data);
                }
            };

            mediaRecorder.onstop = async () => {
                setIsRecording(false);
                setIsTranscribing(true); // Start loading state

                const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
                const reader = new FileReader();
                reader.readAsDataURL(audioBlob);
                reader.onloadend = async () => {
                    const base64String = (reader.result as string).split(',')[1];
                    try {
                        console.log('Enviando audio a transcribir...');
                        const result = await aiApi.transcribeAudio(base64String, 'audio/webm');
                        if (result.success && result.data) {
                            setTranscript(result.data.text);
                            console.log('Transcripción exitosa');
                        } else {
                            setFormError('No se pudo transcribir el audio.');
                        }
                    } catch (error) {
                        console.error('Error en transcripción:', error);
                        setFormError('Error al contactar el servicio de transcripción.');
                    } finally {
                        setIsTranscribing(false);
                        // Clean up tracks
                        stream.getTracks().forEach(track => track.stop());
                    }
                };
            };

            mediaRecorder.start();
            setFormError('');
        } catch (error) {
            console.error('Error al acceder al micrófono:', error);
            setFormError('Acceso al micrófono denegado o no soportado.');
            setIsRecording(false);
        }
    };

    const stopRecording = () => {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
            mediaRecorderRef.current.stop();
        }
    };

    const processWithAI = async () => {
        if (!transcript) return;

        setIsProcessingAI(true);
        try {
            const response = await aiApi.extractIncident(transcript);
            if (response.success && response.data) {
                const data = response.data;
                setFormData(prev => ({
                    ...prev,
                    tipo: (data.tipo as any) || prev.tipo,
                    centroTrabajo: data.centroTrabajo || prev.centroTrabajo,
                    descripcion: data.descripcion || transcript,
                    gravedad: (data.gravedad as any) || prev.gravedad,
                    trabajador: {
                        ...prev.trabajador,
                        nombre: data.trabajador?.nombre || prev.trabajador.nombre,
                        rut: data.trabajador?.rut || prev.trabajador.rut,
                    }
                }));
            }
            setStep(1); // Move to form details
        } catch (err) {
            console.error('Error processing with AI:', err);
            setFormData(prev => ({ ...prev, descripcion: transcript }));
            setStep(1);
        } finally {
            setIsProcessingAI(false);
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

            const payload: CreateIncidentData = {
                ...formData,
                tipo: tipoEfectivo as CreateIncidentData['tipo'],
                solicitanteId: user?.personaId,
                reportadoPor: user?.nombre || 'Usuario',
                empresaId: (user as any)?.tenantId,
                ubicacion: currentLocation || undefined
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
    };

    const clearFilters = () => {
        setFilters({
            tipo: '',
            estado: '',
            fechaInicio: '',
            fechaFin: ''
        });
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

    const getTipoIcon = (tipo: string) => {
        const icons: Record<string, React.ReactElement> = {
            accidente: <FiAlertCircle className="text-danger-500" />,
            incidente: <FiAlertTriangle className="text-warning-500" />,
            condicion_subestandar: <FiActivity className="text-info-500" />
        };
        return icons[tipo] || <FiAlertTriangle />;
    };

    const getTipoLabel = (tipo: string) => {
        const labels: Record<string, string> = {
            accidente: 'Accidente',
            incidente: 'Incidente',
            condicion_subestandar: 'Condición Subestándar'
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

    // Get chart metric label
    const getMetricLabel = () => {
        switch (chartMetric) {
            case 'total': return 'Total Eventos';
            case 'accidentes': return 'Accidentes';
            case 'incidentes': return 'Incidentes';
        }
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

    const selectedIncidentLocation = selectedIncident?.ubicacion || null;

    return (
        <>
            <div className="page-content">
                <div className="page-header">
                    <div className="page-header-info">
                        <h2 className="page-header-title">
                            <FiAlertTriangle className="text-warning-500" />
                            Control de Incidentes
                        </h2>
                        <p className="page-header-description">Sistema de reporte, seguimiento y análisis estadístico de seguridad.</p>
                    </div>
                    <div className="page-header-actions" style={{ display: 'flex', gap: 'var(--space-2)' }}>
                        <button
                            className="btn btn-secondary"
                            onClick={() => { setFormData((prev) => ({ ...prev, clasificacion: 'hallazgo' })); setFlashMode(false); setShowModal(true); }}
                        >
                            <FiPlus className="mr-2" />
                            Reportar hallazgo
                        </button>
                        {canCreateIncidente && (
                            <button
                                className="btn btn-primary"
                                onClick={() => { setFormData((prev) => ({ ...prev, clasificacion: 'incidente' })); setShowModal(true); }}
                            >
                                <FiPlus className="mr-2" />
                                Reportar Incidente
                            </button>
                        )}
                    </div>
                </div>

                {/* Tabs */}
                <div className="incidents-tabs mb-6" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-2)' }}>
                    <button
                        className={`incidents-tab ${activeTab === 'listado' ? 'active' : ''}`}
                        onClick={() => setActiveTab('listado')}
                    >
                        <FiList size={18} />
                        Listado
                    </button>
                    <button
                        className={`incidents-tab ${activeTab === 'estadisticas' ? 'active' : ''}`}
                        onClick={() => setActiveTab('estadisticas')}
                    >
                        <FiPieChart size={18} />
                        Estadísticas
                    </button>
                </div>

                {/* Statistics Dashboard Tab */}
                {activeTab === 'estadisticas' && (
                    <div className="stats-dashboard">
                        {/* Dashboard Header with Download Buttons */}
                        <div className="dashboard-header mb-6">
                            <div className="flex items-center gap-2">
                                <h3 className="text-lg font-bold">Consolidado Estadístico</h3>
                            </div>
                            <div className="flex gap-2">
                                <button
                                    className="btn btn-secondary btn-sm"
                                    onClick={() => downloadReport('csv')}
                                >
                                    <FiFileText className="mr-1" /> CSV
                                </button>
                                <button
                                    className="btn btn-primary btn-sm"
                                    onClick={() => downloadReport('pdf')}
                                >
                                    <FiFileText className="mr-1" /> PDF
                                </button>
                            </div>
                        </div>

                        {/* Single Row of 4 Key Indicator Cards */}
                        {stats && (
                            <div className="stats-grid-4 mb-6">
                                <div className="stat-card stat-card-compact">
                                    <div className="stat-card-icon-sm" style={{ background: 'var(--danger-500)' }}>
                                        <FiAlertCircle size={20} />
                                    </div>
                                    <div className="stat-card-content">
                                        <div className="stat-card-value">{stats.numeroAccidentes}</div>
                                        <div className="stat-card-label">Accidentes</div>
                                    </div>
                                </div>

                                <div className="stat-card stat-card-compact">
                                    <div className="stat-card-icon-sm" style={{ background: 'var(--warning-500)' }}>
                                        <FiTrendingUp size={20} />
                                    </div>
                                    <div className="stat-card-content">
                                        <div className="stat-card-value">{stats.tasaAccidentabilidad.toFixed(1)}%</div>
                                        <div className="stat-card-label">Tasa Accidentabilidad</div>
                                    </div>
                                </div>

                                <div className="stat-card stat-card-compact">
                                    <div className="stat-card-icon-sm" style={{ background: 'var(--primary-500)' }}>
                                        <FiCalendar size={20} />
                                    </div>
                                    <div className="stat-card-content">
                                        <div className="stat-card-value">{stats.diasPerdidos}</div>
                                        <div className="stat-card-label">Días Perdidos</div>
                                    </div>
                                </div>

                                <div className="stat-card stat-card-compact">
                                    <div className="stat-card-icon-sm" style={{ background: '#9c27b0' }}>
                                        <FiActivity size={20} />
                                    </div>
                                    <div className="stat-card-content">
                                        <div className="stat-card-value">{stats.siniestralidad.toFixed(1)}%</div>
                                        <div className="stat-card-label">Siniestralidad</div>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* ROW 1: 2 charts */}
                        <div className="charts-row-2 mb-4">
                            {/* Line Chart - Evolución */}
                            <div className="card">
                                <div className="card-header chart-header-controls">
                                    <h3 className="font-semibold flex items-center gap-2">
                                        <FiTrendingUp /> Evolución {getMetricLabel()}
                                    </h3>
                                    <div className="chart-controls" style={{ minWidth: '160px' }}>
                                        <Select
                                            ariaLabel="Métrica del gráfico"
                                            value={chartMetric}
                                            onChange={(v) => setChartMetric(v as 'total' | 'accidentes' | 'incidentes')}
                                            options={[
                                                { value: 'total', label: 'Total' },
                                                { value: 'accidentes', label: 'Accidentes' },
                                                { value: 'incidentes', label: 'Incidentes' },
                                            ]}
                                        />
                                    </div>
                                </div>
                                <div className="chart-container">
                                    {analytics && analytics.tendencias && analytics.tendencias.length > 0 ? (
                                        <svg viewBox="0 0 400 150" className="w-full h-full">
                                            <defs>
                                                <linearGradient id="lineGradient" x1="0" y1="0" x2="0" y2="1">
                                                    <stop offset="0%" stopColor="var(--primary-500)" stopOpacity="0.3" />
                                                    <stop offset="100%" stopColor="var(--primary-500)" stopOpacity="0" />
                                                </linearGradient>
                                            </defs>
                                            <polyline
                                                fill="url(#lineGradient)"
                                                points={`0,150 ${analytics.tendencias.map((d, i) => {
                                                    const x = (i / (analytics.tendencias.length - 1)) * 400;
                                                    const val = d[chartMetric] || 0;
                                                    const max = Math.max(...analytics.tendencias.map(m => m[chartMetric] || 0), 1);
                                                    return `${x},${150 - (val / max) * 120}`;
                                                }).join(' ')} 400,150`}
                                            />
                                            <polyline
                                                fill="none" stroke="var(--primary-500)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                                                points={analytics.tendencias.map((d, i) => {
                                                    const x = (i / (analytics.tendencias.length - 1)) * 400;
                                                    const val = d[chartMetric] || 0;
                                                    const max = Math.max(...analytics.tendencias.map(m => m[chartMetric] || 0), 1);
                                                    return `${x},${150 - (val / max) * 120}`;
                                                }).join(' ')}
                                            />
                                            {analytics.tendencias.map((d, i) => {
                                                const x = (i / (analytics.tendencias.length - 1)) * 400;
                                                const val = d[chartMetric] || 0;
                                                const max = Math.max(...analytics.tendencias.map(m => m[chartMetric] || 0), 1);
                                                const y = 150 - (val / max) * 120;
                                                return (
                                                    <g key={i}>
                                                        <circle cx={x} cy={y} r="3" fill="var(--primary-500)" stroke="white" strokeWidth="1" />
                                                        <text x={x} y="145" fontSize="8" textAnchor="middle" fill="var(--text-muted)">{d.mes.slice(5)}</text>
                                                    </g>
                                                );
                                            })}
                                        </svg>
                                    ) : <div className="chart-empty">Cargando tendencia...</div>}
                                </div>
                            </div>

                            {/* Bar Chart - Clasificación */}
                            <div className="card">
                                <div className="card-header">
                                    <h3 className="font-semibold flex items-center gap-2">
                                        <FiBarChart2 /> Clasificación
                                    </h3>
                                </div>
                                <div className="chart-container bar-chart-container">
                                    {analytics ? (
                                        <div className="horizontal-bars">
                                            {[
                                                { label: 'Accidentes', val: analytics.distribucionPorTipo.accidentes, color: 'var(--danger-500)' },
                                                { label: 'Incidentes', val: analytics.distribucionPorTipo.incidentes, color: 'var(--warning-500)' },
                                                { label: 'Condiciones', val: analytics.distribucionPorTipo.condicionesSubestandar, color: 'var(--primary-500)' }
                                            ].map((row, i) => (
                                                <div key={i} className="h-bar-group">
                                                    <div className="h-bar-label">{row.label}</div>
                                                    <div className="h-bar-track">
                                                        <div className="h-bar-fill" style={{ width: `${(row.val / (Math.max(analytics.distribucionPorTipo.accidentes + analytics.distribucionPorTipo.incidentes + analytics.distribucionPorTipo.condicionesSubestandar, 1))) * 100}%`, background: row.color }} />
                                                    </div>
                                                    <span className="h-bar-value">{row.val}</span>
                                                </div>
                                            ))}
                                        </div>
                                    ) : <div className="chart-empty">Sin datos</div>}
                                </div>
                            </div>
                        </div>

                        {/* ROW 2: 2 charts */}
                        <div className="charts-row-2 mb-6">
                            {/* Bar Chart - Gravedad */}
                            <div className="card">
                                <div className="card-header">
                                    <h3 className="font-semibold flex items-center gap-2">
                                        <FiAlertTriangle /> Gravedad
                                    </h3>
                                </div>
                                <div className="chart-container bar-chart-container">
                                    {analytics ? (
                                        <div className="horizontal-bars">
                                            {[
                                                { label: 'Leve', val: analytics.distribucionPorGravedad.leve, color: 'var(--success-500)' },
                                                { label: 'Grave', val: analytics.distribucionPorGravedad.grave, color: 'var(--warning-500)' },
                                                { label: 'Fatal', val: analytics.distribucionPorGravedad.fatal, color: 'var(--danger-600)' }
                                            ].map((row, i) => (
                                                <div key={i} className="h-bar-group">
                                                    <div className="h-bar-label">{row.label}</div>
                                                    <div className="h-bar-track">
                                                        <div className="h-bar-fill" style={{ width: `${(row.val / (Math.max(analytics.distribucionPorGravedad.leve + analytics.distribucionPorGravedad.grave + analytics.distribucionPorGravedad.fatal, 1))) * 100}%`, background: row.color }} />
                                                    </div>
                                                    <span className="h-bar-value">{row.val}</span>
                                                </div>
                                            ))}
                                        </div>
                                    ) : <div className="chart-empty">Sin datos</div>}
                                </div>
                            </div>

                            {/* Calendar Heatmap */}
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
                                            <div key={d} className="weekday-cell" style={{
                                                width: '42px',
                                                height: '32px',
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'center',
                                                fontSize: '10px',
                                                fontWeight: '600',
                                                color: 'var(--text-muted)'
                                            }}>
                                                {d}
                                            </div>
                                        ))}
                                    </div>
                                    <div className="calendar-grid-month" style={{ gap: '4px' }}>
                                        {generateCalendarData().map((day: any, i: number) => (
                                            day.empty ? (
                                                <div key={i} className="calendar-cell-empty" style={{
                                                    width: '42px',
                                                    height: '32px'
                                                }} />
                                            ) : (
                                                <div
                                                    key={i}
                                                    className={`calendar-cell-day ${day.hasIncident ? 'has-incident' : ''} ${day.severity || ''}`}
                                                    style={{
                                                        width: '42px',
                                                        height: '32px',
                                                        minHeight: '32px',
                                                        minWidth: '42px'
                                                    }}
                                                >
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
                                                                    <span className={`severity-badge ${day.severity}`}>
                                                                        {day.severity?.toUpperCase()}
                                                                    </span>
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
                )}

                {/* Listado Tab Content */}
                {activeTab === 'listado' && (
                    <>
                        {/* Stats Cards for Listado View */}
                        {stats && (
                            <div className="stats-grid mb-6">
                                <div className="stat-card">
                                    <div className="stat-card-icon" style={{ background: 'linear-gradient(135deg, var(--primary-500), var(--primary-600))' }}>
                                        <FiFileText size={24} />
                                    </div>
                                    <div className="stat-card-content">
                                        <div className="stat-card-label">Total Incidentes</div>
                                        <div className="stat-card-value">{stats.totalIncidentes}</div>
                                    </div>
                                </div>

                                <div className="stat-card">
                                    <div className="stat-card-icon" style={{ background: 'linear-gradient(135deg, var(--warning-500), var(--warning-600))' }}>
                                        <FiTrendingUp size={24} />
                                    </div>
                                    <div className="stat-card-content">
                                        <div className="stat-card-label">Tasa Accidentabilidad</div>
                                        <div className="stat-card-value">{stats.tasaAccidentabilidad.toFixed(2)}%</div>
                                    </div>
                                </div>

                                <div className="stat-card">
                                    <div className="stat-card-icon" style={{ background: 'linear-gradient(135deg, var(--danger-500), var(--danger-600))' }}>
                                        <FiCalendar size={24} />
                                    </div>
                                    <div className="stat-card-content">
                                        <div className="stat-card-label">Días Perdidos</div>
                                        <div className="stat-card-value">{stats.diasPerdidos}</div>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Filters Card */}
                        <div className="card mb-6">
                            <div
                                className="card-header"
                                onClick={() => setShowFilters(!showFilters)}
                                style={{ cursor: 'pointer', transition: 'background 0.2s' }}
                                onMouseEnter={(e) => e.currentTarget.style.background = 'var(--surface-hover)'}
                                onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                            >
                                <div className="flex items-center gap-2">
                                    <FiFilter className={showFilters ? 'text-primary-500' : ''} />
                                    <h3 className="font-semibold" style={{ color: showFilters ? 'var(--primary-600)' : 'inherit' }}>
                                        Filtros de Búsqueda
                                    </h3>
                                </div>
                                <div className="flex items-center gap-2">
                                    {(filters.tipo || filters.estado || filters.fechaInicio || filters.fechaFin) && (
                                        <button
                                            className="btn btn-sm btn-secondary"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                clearFilters();
                                            }}
                                        >
                                            Limpiar Filtros
                                        </button>
                                    )}
                                    <div className="incidents-filter-toggle" style={{ color: 'var(--text-muted)' }}>
                                        {showFilters ? <FiChevronUp size={20} /> : <FiChevronDown size={20} />}
                                    </div>
                                </div>
                            </div>
                            <div className={`p-4 incidents-filters ${showFilters ? 'show' : ''}`}>
                                <div className="flex gap-4 flex-wrap">
                                    <div className="form-group flex-1 min-w-[180px]">
                                        <label className="form-label">Tipo</label>
                                        <Select
                                            ariaLabel="Filtrar por tipo"
                                            value={filters.tipo}
                                            onChange={(v) => setFilters({ ...filters, tipo: v })}
                                            options={[
                                                { value: '', label: 'Todos los tipos' },
                                                { value: 'accidente', label: 'Accidente' },
                                                { value: 'incidente', label: 'Incidente' },
                                                { value: 'condicion_subestandar', label: 'Condición Subestándar' },
                                            ]}
                                        />
                                    </div>
                                    <div className="form-group flex-1 min-w-[180px]">
                                        <label className="form-label">Estado</label>
                                        <Select
                                            ariaLabel="Filtrar por estado"
                                            value={filters.estado}
                                            onChange={(v) => setFilters({ ...filters, estado: v })}
                                            options={[
                                                { value: '', label: 'Todos los estados' },
                                                { value: 'reportado', label: 'Reportado' },
                                                { value: 'en_investigacion', label: 'En Investigación' },
                                                { value: 'cerrado', label: 'Cerrado' },
                                            ]}
                                        />
                                    </div>
                                    <div className="form-group flex-1 min-w-[180px]">
                                        <label className="form-label">Fecha Inicio</label>
                                        <input
                                            type="date"
                                            className="form-input"
                                            value={filters.fechaInicio}
                                            onChange={(e) => setFilters({ ...filters, fechaInicio: e.target.value })}
                                        />
                                    </div>
                                    <div className="form-group flex-1 min-w-[180px]">
                                        <label className="form-label">Fecha Fin</label>
                                        <input
                                            type="date"
                                            className="form-input"
                                            value={filters.fechaFin}
                                            onChange={(e) => setFilters({ ...filters, fechaFin: e.target.value })}
                                        />
                                    </div>
                                </div>
                            </div>
                        </div>

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
                                    Incidentes y Accidentes ({incidents.filter((i) => !esHallazgo(i)).length})
                                </button>
                            </div>

                            <div className="scroll-hint">
                                <FiArrowRight />
                                <span>Desliza para ver más</span>
                            </div>

                            <div className="table-container">
                                <table className="table">
                                    <thead>
                                        <tr>
                                            <th>Tipo</th>
                                            <th>Fecha</th>
                                            <th>Centro de Trabajo</th>
                                            <th>Trabajador</th>
                                            <th>Gravedad</th>
                                            <th>Estado</th>
                                            <th style={{ textAlign: 'right' }}>Acciones</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {loading ? (
                                            <tr>
                                                <td colSpan={7} className="text-center">
                                                    <div className="spinner" style={{ margin: 'var(--space-4) auto' }} />
                                                </td>
                                            </tr>
                                        ) : incidents.filter((i) => listTab === 'hallazgos' ? esHallazgo(i) : !esHallazgo(i)).length === 0 ? (
                                            <tr>
                                                <td colSpan={7} className="text-center text-muted" style={{ padding: 'var(--space-8)' }}>
                                                    <FiAlertTriangle size={48} style={{ margin: '0 auto var(--space-4)', opacity: 0.3 }} />
                                                    <p>{listTab === 'hallazgos' ? 'No hay hallazgos registrados' : 'No hay incidentes registrados'}</p>
                                                    <p className="text-sm">{listTab === 'hallazgos' ? 'Cualquier trabajador puede reportar un hallazgo' : 'Los incidentes reportados aparecerán aquí'}</p>
                                                </td>
                                            </tr>
                                        ) : (
                                            incidents.filter((i) => listTab === 'hallazgos' ? esHallazgo(i) : !esHallazgo(i)).map((incident) => (
                                                <tr key={incident.incidentId}>
                                                    <td>
                                                        <div className="flex items-center gap-2">
                                                            {getTipoIcon(incident.tipo)}
                                                            <span>{getTipoLabel(incident.tipo)}</span>
                                                            {isNewIncident(incident) && (
                                                                <span
                                                                    className="badge badge-info"
                                                                    style={{
                                                                        fontSize: '10px',
                                                                        padding: '2px 6px',
                                                                        animation: 'pulse 2s infinite'
                                                                    }}
                                                                >
                                                                    Nuevo
                                                                </span>
                                                            )}
                                                        </div>
                                                    </td>
                                                    <td>
                                                        <div className="flex items-center gap-2 text-sm">
                                                            <FiCalendar className="text-muted" size={14} />
                                                            {new Date(incident.fecha).toLocaleDateString('es-CL')}
                                                        </div>
                                                    </td>
                                                    <td>
                                                        <div className="flex items-center gap-2">
                                                            <FiMapPin className="text-muted" size={14} />
                                                            {incident.centroTrabajo}
                                                        </div>
                                                    </td>
                                                    <td>
                                                        <div className="flex items-center gap-2">
                                                            <div className="avatar avatar-sm" style={{ background: 'rgba(244, 67, 54, 0.15)', color: 'var(--danger-500)' }}>
                                                                {incident.trabajador.nombre.charAt(0)}
                                                            </div>
                                                            <div>
                                                                <div style={{ fontWeight: 600, fontSize: 'var(--text-sm)' }}>
                                                                    {incident.trabajador.nombre}
                                                                </div>
                                                                <div className="text-muted" style={{ fontSize: 'var(--text-xs)', fontFamily: 'var(--font-mono)' }}>
                                                                    {incident.trabajador.rut}
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </td>
                                                    <td>
                                                        <span className={`badge ${getGravedadBadge(incident.gravedad)}`}>
                                                            {incident.gravedad}
                                                        </span>
                                                    </td>
                                                    <td>
                                                        {esHallazgo(incident) && (incident as any).gobernanza ? (
                                                            <span className={`badge ${(incident as any).gobernanza.estadoCierre === 'cerrado' ? 'badge-success' : (incident as any).gobernanza.estadoCierre === 'en_proceso' ? 'badge-info' : 'badge-warning'}`}>
                                                                {String((incident as any).gobernanza.estadoCierre || 'abierto').replace('_', ' ')}
                                                            </span>
                                                        ) : (
                                                            <span className={`badge ${getEstadoBadge(incident.estado)}`}>
                                                                {incident.estado.replace('_', ' ')}
                                                            </span>
                                                        )}
                                                    </td>
                                                    <td style={{ textAlign: 'right' }}>
                                                        <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
                                                            {esHallazgo(incident) && canCreateIncidente && (
                                                                <button
                                                                    className="btn btn-sm btn-secondary"
                                                                    onClick={() => openGobernanza(incident)}
                                                                >
                                                                    Gestionar
                                                                </button>
                                                            )}
                                                            <button
                                                                className="btn btn-sm btn-secondary"
                                                                onClick={() => openIncidentDetail(incident)}
                                                            >
                                                                Ver Detalle
                                                            </button>
                                                        </div>
                                                    </td>
                                                </tr>
                                            ))
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </>
                )}

                {/* Create Modal */}
                <Modal
                    isOpen={showModal}
                    onClose={handleCloseModal}
                    title={showSuccess ? '¡Reporte Enviado!' : step === 0 ? 'Reporte Rápido de Incidente' : 'Detalles del Reporte'}
                    subtitle={showSuccess
                        ? 'El incidente ha sido registrado y notificado correctamente'
                        : step === 0
                            ? 'Capture una foto y dicte el incidente para agilizar el registro'
                            : 'Verifique y complete la información extraída por la IA'
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
                                ) : step === 0 ? (
                                    <div className="quick-report-container p-6">
                                        {formError && (
                                            <div className="bg-danger-500/10 border border-danger-500/20 text-danger-500 p-4 rounded-lg mb-6 flex items-center gap-3 animate-shake">
                                                <FiAlertCircle size={20} />
                                                <span className="text-sm font-medium">{formError}</span>
                                            </div>
                                        )}
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                                            {/* Camera Section */}
                                            <div className="camera-section">
                                                <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                                                    <FiCamera /> 1. Evidencia Visual
                                                </h3>
                                                {cameraActive && (
                                                    <div className="camera-live-label">Live View</div>
                                                )}
                                                <div className={`camera-view ${cameraActive ? 'is-active' : 'is-idle'} bg-black rounded-xl overflow-hidden relative group`}>
                                                    {cameraActive ? (
                                                        <>
                                                            <video
                                                                ref={videoRef}
                                                                autoPlay
                                                                playsInline
                                                                className="w-full h-full object-cover"
                                                            />
                                                            <div className="absolute inset-0 pointer-events-none border-[10px] border-black/10"></div>
                                                            <div className="absolute inset-x-0 bottom-8 pointer-events-none flex justify-center" style={{ marginTop: '20px' }}> {/* Añade margen superior y separa el botón de la vista */}
                                                                <div className="flex items-center gap-40 pointer-events-auto"> {/* Aumenta el gap */}
                                                                    <button
                                                                        className="btn-shutter group/shutter"
                                                                        onClick={capturePhoto}
                                                                        title="Tomar Foto"
                                                                    >
                                                                        <div className="btn-shutter-outer">
                                                                            <div className="btn-shutter-inner" />
                                                                        </div>
                                                                    </button>
                                                                    <button
                                                                        className="btn btn-secondary btn-sm rounded-full w-12 h-12 flex items-center justify-center shadow-lg border-white/10 bg-black/40 backdrop-blur-md text-white hover:bg-black/60 transition-all"
                                                                        onClick={stopCamera}
                                                                        title="Cerrar Cámara"
                                                                        style={{ marginRight: '-20px' }} /* Mueve más a la derecha */
                                                                    >
                                                                        <FiX size={20} />
                                                                    </button>
                                                                </div>
                                                            </div>
                                                        </>
                                                    ) : (
                                                        <div className="camera-placeholder w-full flex flex-col items-center text-white/50 p-4 text-center gap-3">
                                                            {uploadedFiles.length > 0 ? (
                                                                <div className="relative">
                                                                    <img
                                                                        src={URL.createObjectURL(uploadedFiles[uploadedFiles.length - 1])}
                                                                        className="max-h-40 rounded-lg shadow-xl"
                                                                    />
                                                                    <div className="mt-2 text-primary-400 font-medium flex items-center justify-center gap-1">
                                                                        <FiCheck size={14} /> Foto capturada
                                                                    </div>
                                                                    <button
                                                                        className="mt-4 btn btn-sm btn-outline-white"
                                                                        onClick={startCamera}
                                                                    >
                                                                        <FiRefreshCw className="mr-2" /> Tomar otra
                                                                    </button>
                                                                </div>
                                                            ) : (
                                                                <>
                                                                    <FiCamera size={48} className="mb-4 opacity-20" />
                                                                    <button
                                                                        className="btn btn-primary"
                                                                        onClick={startCamera}
                                                                    >
                                                                        <FiCamera className="mr-2" /> Activar Cámara
                                                                    </button>
                                                                    <p className="text-xs">O sube archivos después en el formulario</p>
                                                                </>
                                                            )}
                                                        </div>
                                                    )}
                                                </div>
                                            </div>

                                            {/* Audio Section */}
                                            <div className="audio-section">
                                                <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                                                    <FiMic /> 2. ¿Qué ocurrió?
                                                </h3>
                                                <div className={`audio-recorder p-6 rounded-xl border-2 border-dashed transition-all ${isRecording ? 'border-danger-500 bg-danger-50/5' : 'border-surface-border bg-surface-hover/30'}`}>
                                                    <div className="quick-report-audio-body">
                                                        <div className="quick-report-audio-controls">
                                                            <div className={`quick-report-mic-indicator w-20 h-20 rounded-full flex items-center justify-center transition-all ${isRecording ? 'bg-danger-500 scale-110 shadow-lg shadow-danger-200' : 'bg-primary-500'}`}>
                                                                {isRecording ? (
                                                                    <div className="flex gap-1">
                                                                        <div className="w-1.5 h-6 bg-white animate-bounce" style={{ animationDelay: '0s' }} />
                                                                        <div className="w-1.5 h-10 bg-white animate-bounce" style={{ animationDelay: '0.1s' }} />
                                                                        <div className="w-1.5 h-8 bg-white animate-bounce" style={{ animationDelay: '0.2s' }} />
                                                                        <div className="w-1.5 h-6 bg-white animate-bounce" style={{ animationDelay: '0.3s' }} />
                                                                    </div>
                                                                ) : (
                                                                    <FiMic size={32} className="text-white" />
                                                                )}
                                                            </div>

                                                            <button
                                                                className={`btn ${isRecording ? 'btn-danger' : 'btn-primary'} quick-report-dictate-btn`}
                                                                onClick={isRecording ? stopRecording : startRecording}
                                                                disabled={isTranscribing}
                                                            >
                                                                {isTranscribing ? (
                                                                    <><FiRefreshCw className="mr-2 animate-spin" /> Procesando Audio...</>
                                                                ) : isRecording ? (
                                                                    <><FiStopCircle className="mr-2" /> Detener Grabación</>
                                                                ) : (
                                                                    <><FiPlay className="mr-2" /> Dictar Reporte</>
                                                                )}
                                                            </button>
                                                        </div>

                                                        <textarea
                                                            className="voice-transcript-area"
                                                            value={transcript}
                                                            onChange={(e) => setTranscript(e.target.value)}
                                                            placeholder={isRecording ? 'Grabando audio...' : isTranscribing ? 'Transcribiendo...' : 'Presione dictar y describa el incidente (ej: "Hay una tabla suelta en el andamio del sector B, riesgo de caída")'}
                                                            disabled={isTranscribing}
                                                        />
                                                    </div>
                                                </div>
                                            </div>
                                        </div>

                                        <div className="mt-10 flex flex-col items-center justify-center border-t border-surface-border pt-8 quick-report-actions">
                                            {isProcessingAI ? (
                                                <div className="flex flex-col items-center">
                                                    <div className="loader-dots mb-4">
                                                        <div /> <div /> <div /> <div />
                                                    </div>
                                                    <p className="text-sm font-medium animate-pulse">La IA está procesando su voz para llenar el reporte...</p>
                                                </div>
                                            ) : (
                                                <div className="flex gap-4" style={{ marginTop: '15px' }}> {/* Añade margen superior */}
                                                    <button
                                                        className="btn btn-secondary btn-lg"
                                                        onClick={() => setStep(1)}
                                                    >
                                                        Ir a Manual <FiArrowRight className="ml-2" />
                                                    </button>
                                                    <button
                                                        className="btn btn-primary btn-lg px-10"
                                                        onClick={processWithAI}
                                                        disabled={!transcript}
                                                    >
                                                        <FiZap size={18} className="mr-2" /> Procesar con IA
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                ) : (
                                    <form onSubmit={handleSubmit} className="p-6">
                                        {/* Sección: Clasificación del Reporte */}
                                        <div className="form-section">
                                            <h3 className="form-section-title">Clasificación del Reporte</h3>
                                            <div className="grid grid-cols-2 gap-4">
                                                <div className="form-group">
                                                    <label className="form-label">Clasificación *</label>
                                                    <Select
                                                        ariaLabel="Clasificación"
                                                        value={formData.clasificacion}
                                                        onChange={(v) => setFormData({ ...formData, clasificacion: v as any })}
                                                        options={[
                                                            { value: 'hallazgo', label: 'Hallazgo' },
                                                            { value: 'incidente', label: 'Incidente' },
                                                        ]}
                                                    />
                                                    <span className="form-hint">Hallazgo: observación preventiva. Incidente: evento ocurrido.</span>
                                                </div>

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
                                                        <label className="form-label">Tipo de Evento *</label>
                                                        <Select
                                                            ariaLabel="Tipo de evento"
                                                            value={formData.tipo === 'accidente' ? 'accidente' : 'incidente'}
                                                            onChange={(v) => setFormData({ ...formData, tipo: v as any })}
                                                            options={[
                                                                { value: 'incidente', label: 'Incidente' },
                                                                { value: 'accidente', label: 'Accidente' },
                                                            ]}
                                                        />
                                                    </div>
                                                )}

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

                                            {/* Subcategoria: Reporte Flash vs Completo (solo incidentes) */}
                                            {formData.clasificacion === 'incidente' && (
                                                <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-3)' }}>
                                                    <button type="button" className={`btn btn-sm ${flashMode ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setFlashMode(true)}>
                                                        Reporte Flash
                                                    </button>
                                                    <button type="button" className={`btn btn-sm ${!flashMode ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setFlashMode(false)}>
                                                        Reporte Completo
                                                    </button>
                                                </div>
                                            )}
                                        </div>

                                        {/* Reporte flash: datos minimos, se completa en la investigacion */}
                                        {formData.clasificacion === 'incidente' && flashMode && (
                                            <div className="form-section">
                                                <div style={{ padding: '10px 14px', borderRadius: '8px', background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.25)', fontSize: '0.82rem', color: '#92400e', marginBottom: 'var(--space-3)' }}>
                                                    Reporte inicial - Informacion segun disponibilidad al momento del registro.
                                                    Los datos seran completados durante la investigacion.
                                                </div>

                                                <h3 className="form-section-title">Afectados</h3>
                                                {flashAfectados.map((afectado, idx) => (
                                                    <div key={idx} className="grid grid-cols-3 gap-4" style={{ marginBottom: 'var(--space-2)' }}>
                                                        <div className="form-group" style={{ margin: 0 }}>
                                                            <input type="text" className="form-input" placeholder="Nombre *" value={afectado.nombre}
                                                                onChange={(e) => setFlashAfectados(flashAfectados.map((a, i) => i === idx ? { ...a, nombre: e.target.value } : a))} />
                                                        </div>
                                                        <div className="form-group" style={{ margin: 0 }}>
                                                            <input type="text" className="form-input" placeholder="RUT (opcional)" value={afectado.rut}
                                                                onChange={(e) => setFlashAfectados(flashAfectados.map((a, i) => i === idx ? { ...a, rut: e.target.value } : a))} />
                                                        </div>
                                                        <div className="form-group" style={{ margin: 0, display: 'flex', gap: '6px' }}>
                                                            <input type="text" className="form-input" placeholder="Cargo (opcional)" value={afectado.cargo}
                                                                onChange={(e) => setFlashAfectados(flashAfectados.map((a, i) => i === idx ? { ...a, cargo: e.target.value } : a))} />
                                                            {flashAfectados.length > 1 && (
                                                                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setFlashAfectados(flashAfectados.filter((_, i) => i !== idx))}>X</button>
                                                            )}
                                                        </div>
                                                    </div>
                                                ))}
                                                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setFlashAfectados([...flashAfectados, { nombre: '', rut: '', cargo: '' }])}>
                                                    Agregar afectado
                                                </button>

                                                <div className="form-group" style={{ marginTop: 'var(--space-3)' }}>
                                                    <label className="form-label">Descripción breve * <span className="text-muted">({flashDescripcion.length}/500)</span></label>
                                                    <textarea className="form-input" rows={3} maxLength={500} value={flashDescripcion}
                                                        onChange={(e) => setFlashDescripcion(e.target.value)} required style={{ resize: 'vertical' }} />
                                                </div>
                                                <div className="grid grid-cols-2 gap-4">
                                                    <div className="form-group">
                                                        <label className="form-label">Severidad *</label>
                                                        <Select
                                                            ariaLabel="Severidad"
                                                            value={formData.gravedad}
                                                            onChange={(v) => setFormData({ ...formData, gravedad: v as any })}
                                                            options={[
                                                                { value: 'leve', label: 'Leve' },
                                                                { value: 'grave', label: 'Grave' },
                                                                { value: 'fatal', label: 'Fatal' },
                                                            ]}
                                                        />
                                                    </div>
                                                    <div className="form-group">
                                                        <label className="form-label">Ubicación de referencia</label>
                                                        <input type="text" className="form-input" placeholder="Ej: Piso 3, sector norte" value={flashUbicacion}
                                                            onChange={(e) => setFlashUbicacion(e.target.value)} />
                                                    </div>
                                                </div>
                                            </div>
                                        )}

                                        {!(formData.clasificacion === 'incidente' && flashMode) && (<>

                                        {/* Sección: Trabajador Afectado — autocomplete para ambos tipos */}
                                        <div className="form-section">
                                            <h3 className="form-section-title">Trabajador Afectado</h3>
                                            <div className="form-group">
                                                <label className="form-label">Buscar trabajador *</label>
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

                                        {/* Sección: Descripción */}
                                        <div className="form-section">
                                            <h3 className="form-section-title">
                                                {formData.clasificacion === 'hallazgo' ? 'Descripción del Hallazgo' : 'Descripción del Incidente'}
                                            </h3>
                                            <div className="form-group">
                                                <label className="form-label">Detalle *</label>
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
                                                <div className="upload-zone">
                                                    <input
                                                        type="file"
                                                        id="file-upload"
                                                        className="hidden"
                                                        multiple
                                                        accept="image/*"
                                                        onChange={handleFileSelect}
                                                    />
                                                    <label htmlFor="file-upload" className="upload-label">
                                                        <FiUpload size={32} className="text-muted mb-2" />
                                                        <p className="font-semibold">Click para seleccionar fotos</p>
                                                        <p className="text-sm text-muted">o arrastra y suelta aquí</p>
                                                        <p className="text-xs text-muted mt-2">PNG, JPG hasta 10MB cada una</p>
                                                    </label>
                                                </div>

                                                {uploadedFiles.length > 0 && (
                                                    <div className="mt-4">
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

                                        </>)}

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
                                                            {user?.nombre} {(user as any)?.apellido || ''}
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
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>

                            {/* Banner reporte flash */}
                            {(selectedIncident as any).reporteFlash?.esFlash && (
                                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-3)', padding: 'var(--space-3) var(--space-4)', borderRadius: 'var(--radius-md)', background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.25)' }}>
                                    <FiAlertCircle size={15} style={{ color: '#b45309', flexShrink: 0, marginTop: '2px' }} />
                                    <p style={{ fontSize: 'var(--text-xs)', color: '#92400e', margin: 0, lineHeight: 1.5 }}>
                                        Reporte inicial — información según disponibilidad al momento del registro. Los datos serán completados durante la investigación.
                                        {(selectedIncident as any).reporteFlash?.editadoEn && (
                                            <> Última actualización: {new Date((selectedIncident as any).reporteFlash.editadoEn).toLocaleString('es-CL')}.</>
                                        )}
                                    </p>
                                </div>
                            )}

                            {/* Loading / Error inline */}
                            {detailLoading && (
                                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', padding: 'var(--space-3)', color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>
                                    <FiActivity size={16} style={{ animation: 'spin 1s linear infinite', color: 'var(--primary-500)' }} />
                                    Cargando detalle completo…
                                </div>
                            )}
                            {detailError && (
                                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', padding: 'var(--space-3) var(--space-4)', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 'var(--radius-md)', fontSize: 'var(--text-sm)', color: 'var(--danger-500)' }}>
                                    <FiAlertCircle size={15} />
                                    {detailError}
                                </div>
                            )}

                            {/* Fila de métricas rápidas */}
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 'var(--space-3)' }}>
                                {[
                                    {
                                        label: 'Tipo',
                                        value: getTipoLabel(selectedIncident.tipo),
                                        icon: <FiAlertTriangle size={13} />,
                                        accent: 'var(--warning-500)',
                                    },
                                    {
                                        label: 'Estado',
                                        value: <span className={`badge ${getEstadoBadge(selectedIncident.estado)}`} style={{ fontSize: '11px' }}>{selectedIncident.estado.replace('_', ' ')}</span>,
                                        icon: <FiActivity size={13} />,
                                        accent: 'var(--info-500)',
                                    },
                                    {
                                        label: 'Gravedad',
                                        value: <span className={`badge ${getGravedadBadge(selectedIncident.gravedad)}`} style={{ fontSize: '11px' }}>{selectedIncident.gravedad}</span>,
                                        icon: <FiAlertCircle size={13} />,
                                        accent: 'var(--danger-500)',
                                    },
                                    {
                                        label: 'Fecha',
                                        value: new Date(selectedIncident.fecha).toLocaleDateString('es-CL', { day: 'numeric', month: 'short', year: 'numeric' }),
                                        icon: <FiCalendar size={13} />,
                                        accent: 'var(--primary-500)',
                                    },
                                    ...(selectedIncident.hora ? [{
                                        label: 'Hora',
                                        value: selectedIncident.hora,
                                        icon: <FiActivity size={13} />,
                                        accent: 'var(--primary-400)',
                                    }] : []),
                                    ...(selectedIncident.diasPerdidos && selectedIncident.diasPerdidos > 0 ? [{
                                        label: 'Días Perdidos',
                                        value: `${selectedIncident.diasPerdidos} días`,
                                        icon: <FiCalendar size={13} />,
                                        accent: 'var(--danger-500)',
                                    }] : []),
                                ].map((item, i) => (
                                    <div key={i} style={{
                                        background: 'var(--surface-elevated)',
                                        border: '1px solid var(--surface-border)',
                                        borderRadius: 'var(--radius-md)',
                                        padding: 'var(--space-3) var(--space-4)',
                                    }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)', color: item.accent, marginBottom: 'var(--space-2)' }}>
                                            {item.icon}
                                            <span style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--text-muted)' }}>
                                                {item.label}
                                            </span>
                                        </div>
                                        <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--text-primary)' }}>
                                            {item.value}
                                        </div>
                                    </div>
                                ))}
                            </div>

                            {/* Trabajador afectado */}
                            <div style={{
                                background: 'var(--surface-elevated)',
                                border: '1px solid var(--surface-border)',
                                borderRadius: 'var(--radius-lg)',
                                overflow: 'hidden',
                            }}>
                                <div style={{
                                    display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
                                    padding: 'var(--space-3) var(--space-4)',
                                    borderBottom: '1px solid var(--surface-border)',
                                    background: 'var(--surface-card)',
                                }}>
                                    <FiUser size={13} style={{ color: 'var(--accent)' }} />
                                    <span style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--text-muted)' }}>
                                        Trabajador Afectado
                                    </span>
                                </div>
                                <div style={{ padding: 'var(--space-4)', display: 'flex', alignItems: 'center', gap: 'var(--space-4)', flexWrap: 'wrap' }}>
                                    <div className="avatar" style={{ background: 'rgba(239,68,68,0.12)', color: 'var(--danger-500)', width: '48px', height: '48px', fontSize: '1.2rem', fontWeight: 700, flexShrink: 0 }}>
                                        {selectedIncident.trabajador.nombre.charAt(0).toUpperCase()}
                                    </div>
                                    <div style={{ flex: 1, minWidth: '140px' }}>
                                        <div style={{ fontWeight: 700, fontSize: 'var(--text-base)', color: 'var(--text-primary)', marginBottom: '2px' }}>
                                            {selectedIncident.trabajador.nombre}
                                        </div>
                                        {selectedIncident.trabajador.rut && (
                                            <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                                                {selectedIncident.trabajador.rut}
                                            </div>
                                        )}
                                    </div>
                                    {(selectedIncident.trabajador.cargo || selectedIncident.trabajador.genero) && (
                                        <div style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
                                            {selectedIncident.trabajador.cargo && (
                                                <div style={{ background: 'var(--surface-card)', border: '1px solid var(--surface-border)', borderRadius: 'var(--radius-md)', padding: '6px 12px' }}>
                                                    <span style={{ fontSize: '10px', color: 'var(--text-muted)', display: 'block', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>Cargo</span>
                                                    <span style={{ fontSize: 'var(--text-sm)', fontWeight: 500, color: 'var(--text-primary)' }}>{selectedIncident.trabajador.cargo}</span>
                                                </div>
                                            )}
                                            {selectedIncident.trabajador.genero && (
                                                <div style={{ background: 'var(--surface-card)', border: '1px solid var(--surface-border)', borderRadius: 'var(--radius-md)', padding: '6px 12px' }}>
                                                    <span style={{ fontSize: '10px', color: 'var(--text-muted)', display: 'block', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>Género</span>
                                                    <span style={{ fontSize: 'var(--text-sm)', fontWeight: 500, color: 'var(--text-primary)' }}>{selectedIncident.trabajador.genero}</span>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* Descripción */}
                            <div style={{
                                background: 'var(--surface-elevated)',
                                border: '1px solid var(--surface-border)',
                                borderRadius: 'var(--radius-lg)',
                                overflow: 'hidden',
                            }}>
                                <div style={{
                                    display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
                                    padding: 'var(--space-3) var(--space-4)',
                                    borderBottom: '1px solid var(--surface-border)',
                                    background: 'var(--surface-card)',
                                }}>
                                    <FiFileText size={13} style={{ color: 'var(--accent)' }} />
                                    <span style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--text-muted)' }}>
                                        {esHallazgo(selectedIncident) ? 'Descripción del Hallazgo' : 'Descripción del Incidente'}
                                    </span>
                                </div>
                                <p style={{ margin: 0, padding: 'var(--space-4)', fontSize: 'var(--text-sm)', color: 'var(--text-primary)', lineHeight: 1.7 }}>
                                    {selectedIncident.descripcion || <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>Sin descripción registrada.</span>}
                                </p>
                            </div>

                            {/* Trazabilidad */}
                            {(selectedIncident.reportadoPor || selectedIncident.incidentId) && (
                                <div style={{
                                    background: 'var(--surface-elevated)',
                                    border: '1px solid var(--surface-border)',
                                    borderRadius: 'var(--radius-lg)',
                                    overflow: 'hidden',
                                }}>
                                    <div style={{
                                        display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
                                        padding: 'var(--space-3) var(--space-4)',
                                        borderBottom: '1px solid var(--surface-border)',
                                        background: 'var(--surface-card)',
                                    }}>
                                        <FiFileText size={13} style={{ color: 'var(--accent)' }} />
                                        <span style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--text-muted)' }}>
                                            Trazabilidad
                                        </span>
                                    </div>
                                    <div style={{ padding: 'var(--space-4)', display: 'flex', gap: 'var(--space-6)', flexWrap: 'wrap' }}>
                                        {selectedIncident.reportadoPor && (
                                            <div>
                                                <span style={{ fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>Reportado por</span>
                                                <p style={{ margin: '4px 0 0', fontSize: 'var(--text-sm)', fontWeight: 500, color: 'var(--text-primary)' }}>
                                                    {selectedIncident.reportadoPor}
                                                </p>
                                            </div>
                                        )}
                                        <div>
                                            <span style={{ fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>ID del reporte</span>
                                            <p style={{ margin: '4px 0 0', fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
                                                {selectedIncident.incidentId}
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* Evidencias fotográficas */}
                            {incidentEvidenceItems.length > 0 && (
                                <div style={{
                                    background: 'var(--surface-elevated)',
                                    border: '1px solid var(--surface-border)',
                                    borderRadius: 'var(--radius-lg)',
                                    overflow: 'hidden',
                                }}>
                                    <div style={{
                                        display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
                                        padding: 'var(--space-3) var(--space-4)',
                                        borderBottom: '1px solid var(--surface-border)',
                                        background: 'var(--surface-card)',
                                    }}>
                                        <FiImage size={13} style={{ color: 'var(--accent)' }} />
                                        <span style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--text-muted)' }}>
                                            Evidencias Fotográficas
                                        </span>
                                        <span style={{ marginLeft: 'auto', background: 'var(--accent-tint)', color: 'var(--accent)', fontSize: '11px', fontWeight: 700, padding: '2px 8px', borderRadius: 'var(--radius-full)' }}>
                                            {incidentEvidenceItems.length}
                                        </span>
                                    </div>
                                    <div style={{ padding: 'var(--space-4)', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))', gap: 'var(--space-3)' }}>
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
            </div >

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
