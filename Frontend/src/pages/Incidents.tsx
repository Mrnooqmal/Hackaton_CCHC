import { useState, useEffect } from 'react';
import type { KeyboardEvent } from 'react';
import Header from '../components/Header';
import {
    FiPlus, FiAlertTriangle, FiFilter, FiX, FiUpload, FiImage,
    FiUser, FiMapPin, FiCalendar, FiTrendingUp, FiActivity,
    FiAlertCircle, FiFileText, FiSave, FiChevronDown, FiChevronUp,
    FiPieChart, FiList, FiBarChart2, FiCheck, FiArrowRight,
    FiMic, FiCamera, FiStopCircle, FiRefreshCw, FiPlay, FiZap
} from 'react-icons/fi';
import { incidentsApi, aiApi } from '../api/client';
import type { Incident, CreateIncidentData, IncidentStats, AnalyticsData } from '../api/client';
import { useRef } from 'react';
import { useAuth } from '../context/AuthContext';

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

    const [chartMetric, setChartMetric] = useState<'total' | 'accidentes' | 'incidentes'>('total');
    const [calendarMonth, setCalendarMonth] = useState(new Date());
    const [showSuccess, setShowSuccess] = useState(false);
    const [formError, setFormError] = useState('');


    useEffect(() => {
        loadIncidents();
        loadStats();
    }, [filters]);

    useEffect(() => {
        if (activeTab === 'estadisticas') {
            loadAnalytics();
        }
    }, [activeTab]);

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
                empresaId: user?.userId
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

        try {
            const response = await incidentsApi.create({
                ...formData,
                reportadoPor: user?.nombre || 'Usuario',
                empresaId: user?.empresaId
            });

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
            if (user?.userId && (!incident.viewedBy || !incident.viewedBy.includes(user.userId))) {
                incidentsApi.markAsViewed(incident.incidentId, user.userId).catch(err =>
                    console.error('Error marking incident as viewed:', err)
                );

                // Update local list to hide "New" badge immediately
                setIncidents(prev => prev.map(i =>
                    i.incidentId === incident.incidentId
                        ? { ...i, viewedBy: [...(i.viewedBy || []), user.userId!] }
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
        if (!user?.userId) return false;
        return !incident.viewedBy || !incident.viewedBy.includes(user.userId);
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

    return (
        <>
            <Header title="Incidentes y Accidentes" />
            <div className="page-content">
                <div className="page-header">
                    <div className="page-header-info">
                        <h2 className="page-header-title">
                            <FiAlertTriangle className="text-warning-500" />
                            Control de Incidentes
                        </h2>
                        <p className="page-header-description">Sistema de reporte, seguimiento y análisis estadístico de seguridad.</p>
                    </div>
                    <div className="page-header-actions">
                        <button
                            className="btn btn-primary"
                            onClick={() => setShowModal(true)}
                        >
                            <FiPlus className="mr-2" />
                            Reportar Incidente
                        </button>
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
                                    <div className="chart-controls">
                                        <select
                                            className="chart-select"
                                            value={chartMetric}
                                            onChange={(e) => setChartMetric(e.target.value as 'total' | 'accidentes' | 'incidentes')}
                                        >
                                            <option value="total">Total</option>
                                            <option value="accidentes">Accidentes</option>
                                            <option value="incidentes">Incidentes</option>
                                        </select>
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
                                        <select
                                            className="form-input"
                                            value={filters.tipo}
                                            onChange={(e) => setFilters({ ...filters, tipo: e.target.value })}
                                        >
                                            <option value="">Todos los tipos</option>
                                            <option value="accidente">Accidente</option>
                                            <option value="incidente">Incidente</option>
                                            <option value="condicion_subestandar">Condición Subestándar</option>
                                        </select>
                                    </div>
                                    <div className="form-group flex-1 min-w-[180px]">
                                        <label className="form-label">Estado</label>
                                        <select
                                            className="form-input"
                                            value={filters.estado}
                                            onChange={(e) => setFilters({ ...filters, estado: e.target.value })}
                                        >
                                            <option value="">Todos los estados</option>
                                            <option value="reportado">Reportado</option>
                                            <option value="en_investigacion">En Investigación</option>
                                            <option value="cerrado">Cerrado</option>
                                        </select>
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
                                        ) : incidents.length === 0 ? (
                                            <tr>
                                                <td colSpan={7} className="text-center text-muted" style={{ padding: 'var(--space-8)' }}>
                                                    <FiAlertTriangle size={48} style={{ margin: '0 auto var(--space-4)', opacity: 0.3 }} />
                                                    <p>No hay incidentes registrados</p>
                                                    <p className="text-sm">Los incidentes reportados aparecerán aquí</p>
                                                </td>
                                            </tr>
                                        ) : (
                                            incidents.map((incident) => (
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
                                                        <span className={`badge ${getEstadoBadge(incident.estado)}`}>
                                                            {incident.estado.replace('_', ' ')}
                                                        </span>
                                                    </td>
                                                    <td style={{ textAlign: 'right' }}>
                                                        <button
                                                            className="btn btn-sm btn-secondary"
                                                            onClick={() => openIncidentDetail(incident)}
                                                        >
                                                            Ver Detalle
                                                        </button>
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
                {showModal && (
                    <div className="modal-overlay" onClick={() => setShowModal(false)}>
                        <div className="modal-content max-w-4xl" onClick={(e) => e.stopPropagation()}>
                            <div className="modal-header">
                                <div className="flex items-center gap-4">
                                    <div className="modal-header-icon">
                                        <FiAlertTriangle size={24} />
                                    </div>
                                    <div className="modal-header-text" style={{ marginBottom: '10px' }}> {/* Añade margen inferior */}
                                        <h2 className="modal-title">
                                            {showSuccess ? '¡Reporte Enviado!' : step === 0 ? 'Reporte Rápido de Incidente' : 'Detalles del Reporte'}
                                        </h2>
                                        <p className="modal-subtitle">
                                            {showSuccess
                                                ? 'El incidente ha sido registrado y notificado correctamente'
                                                : step === 0
                                                    ? 'Capture una foto y dicte el incidente para agilizar el registro'
                                                    : 'Verifique y complete la información extraída por la IA'}
                                        </p>
                                    </div>
                                </div>
                                <button
                                    className="modal-close-btn"
                                    onClick={handleCloseModal}
                                    aria-label="Cerrar modal"
                                    style={{ position: 'absolute', top: '20px', right: '20px' }} /* Posiciona la X */
                                >
                                    <FiX size={20} />
                                </button>
                            </div>

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
                                                <div className="camera-view bg-black rounded-xl overflow-hidden relative group">
                                                    {cameraActive ? (
                                                        <>
                                                            <video
                                                                ref={videoRef}
                                                                autoPlay
                                                                playsInline
                                                                className="w-full h-full object-cover"
                                                            />
                                                            <div className="absolute inset-0 pointer-events-none border-[10px] border-black/10"></div>
                                                            <div className="absolute inset-x-0 bottom-6 pointer-events-none flex justify-center" style={{ marginTop: '20px' }}> {/* Añade margen superior */}
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
                                                            <div className="absolute top-6 left-6 bg-black/40 backdrop-blur-md text-white text-[10px] px-2 py-1 rounded-full border border-white/10 uppercase tracking-widest font-bold">
                                                                Live View
                                                            </div>
                                                        </>
                                                    ) : (
                                                        <div className="camera-placeholder w-full h-full flex flex-col items-center justify-center text-white/50 p-4 text-center">
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
                                                                        style={{ marginTop: '20px' }} /* Empuja el botón hacia abajo */
                                                                    >
                                                                        <FiCamera className="mr-2" /> Activar Cámara
                                                                    </button>
                                                                    <p className="mt-4 text-xs">O sube archivos después en el formulario</p>
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
                                                    <div className="flex flex-col items-center text-center">
                                                        <div className={`w-20 h-20 rounded-full flex items-center justify-center mb-4 transition-all ${isRecording ? 'bg-danger-500 scale-110 shadow-lg shadow-danger-200' : 'bg-primary-500'}`}>
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
                                                            className={`btn ${isRecording ? 'btn-danger' : 'btn-primary'} mb-4`}
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

                                                        <textarea
                                                            className="w-full min-h-[100px] bg-surface-card rounded-lg p-3 border border-surface-border text-sm italic overflow-y-auto max-h-[150px] resize-none focus:outline-none focus:border-primary-500 transition-colors"
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
                                                    <select
                                                        className="form-input"
                                                        value={formData.clasificacion}
                                                        onChange={(e) => setFormData({ ...formData, clasificacion: e.target.value as any })}
                                                        required
                                                    >
                                                        <option value="hallazgo">Hallazgo</option>
                                                        <option value="incidente">Incidente</option>
                                                    </select>
                                                    <span className="form-hint">Hallazgo: observación preventiva. Incidente: evento ocurrido.</span>
                                                </div>

                                                {formData.clasificacion === 'hallazgo' && (
                                                    <div className="form-group">
                                                        <label className="form-label">Tipo de Hallazgo *</label>
                                                        <select
                                                            className="form-input"
                                                            value={formData.tipoHallazgo}
                                                            onChange={(e) => setFormData({ ...formData, tipoHallazgo: e.target.value as any })}
                                                            required
                                                        >
                                                            <option value="accion">Acción Subestándar</option>
                                                            <option value="condicion">Condición Subestándar</option>
                                                        </select>
                                                        <span className="form-hint">Acción: comportamiento inseguro. Condición: estado físico peligroso.</span>
                                                    </div>
                                                )}

                                                <div className="form-group">
                                                    <label className="form-label">Etapa Constructiva</label>
                                                    <select
                                                        className="form-input"
                                                        value={formData.etapaConstructiva}
                                                        onChange={(e) => setFormData({ ...formData, etapaConstructiva: e.target.value })}
                                                    >
                                                        <option value="">Seleccionar etapa...</option>
                                                        {ETAPAS_CONSTRUCTIVAS.map((etapa) => (
                                                            <option key={etapa} value={etapa}>{etapa}</option>
                                                        ))}
                                                    </select>
                                                </div>

                                                <div className="form-group">
                                                    <label className="form-label">Tipo de Evento *</label>
                                                    <select
                                                        className="form-input"
                                                        value={formData.tipo}
                                                        onChange={(e) => setFormData({ ...formData, tipo: e.target.value as any })}
                                                        required
                                                    >
                                                        <option value="incidente">Incidente</option>
                                                        <option value="accidente">Accidente</option>
                                                        <option value="condicion_subestandar">Condición Subestándar</option>
                                                    </select>
                                                </div>
                                            </div>
                                        </div>

                                        {/* Sección: Información General */}
                                        <div className="form-section">
                                            <h3 className="form-section-title">Información General</h3>
                                            <div className="grid grid-cols-2 gap-4">
                                                <div className="form-group">
                                                    <label className="form-label">Centro de Trabajo *</label>
                                                    <input
                                                        type="text"
                                                        className="form-input"
                                                        placeholder="Ej: Obra Los Pinos"
                                                        value={formData.centroTrabajo}
                                                        onChange={(e) => setFormData({ ...formData, centroTrabajo: e.target.value })}
                                                        required
                                                    />
                                                </div>

                                                <div className="form-group">
                                                    <label className="form-label">Gravedad</label>
                                                    <select
                                                        className="form-input"
                                                        value={formData.gravedad}
                                                        onChange={(e) => setFormData({ ...formData, gravedad: e.target.value as any })}
                                                    >
                                                        <option value="leve">Leve</option>
                                                        <option value="grave">Grave</option>
                                                        <option value="fatal">Fatal</option>
                                                    </select>
                                                </div>

                                                <div className="form-group">
                                                    <label className="form-label">Días Perdidos</label>
                                                    <input
                                                        type="number"
                                                        className="form-input"
                                                        value={formData.diasPerdidos}
                                                        onChange={(e) => setFormData({ ...formData, diasPerdidos: parseInt(e.target.value) || 0 })}
                                                        min="0"
                                                    />
                                                </div>
                                            </div>
                                        </div>

                                        {/* Sección: Trabajador Afectado */}
                                        <div className="form-section">
                                            <h3 className="form-section-title">Trabajador Afectado</h3>
                                            <div className="grid grid-cols-2 gap-4">
                                                <div className="form-group">
                                                    <label className="form-label">Nombre Completo *</label>
                                                    <input
                                                        type="text"
                                                        className="form-input"
                                                        placeholder="Juan Pérez González"
                                                        value={formData.trabajador.nombre}
                                                        onChange={(e) => setFormData({
                                                            ...formData,
                                                            trabajador: { ...formData.trabajador, nombre: e.target.value }
                                                        })}
                                                        required
                                                    />
                                                </div>

                                                <div className="form-group">
                                                    <label className="form-label">RUT *</label>
                                                    <input
                                                        type="text"
                                                        className="form-input"
                                                        placeholder="12.345.678-9"
                                                        value={formData.trabajador.rut}
                                                        onChange={(e) => setFormData({
                                                            ...formData,
                                                            trabajador: { ...formData.trabajador, rut: e.target.value }
                                                        })}
                                                        required
                                                    />
                                                </div>

                                                <div className="form-group">
                                                    <label className="form-label">Género</label>
                                                    <select
                                                        className="form-input"
                                                        value={formData.trabajador.genero}
                                                        onChange={(e) => setFormData({
                                                            ...formData,
                                                            trabajador: { ...formData.trabajador, genero: e.target.value }
                                                        })}
                                                    >
                                                        <option value="">Seleccionar</option>
                                                        <option value="M">Masculino</option>
                                                        <option value="F">Femenino</option>
                                                        <option value="Otro">Otro</option>
                                                    </select>
                                                </div>

                                                <div className="form-group">
                                                    <label className="form-label">Cargo</label>
                                                    <input
                                                        type="text"
                                                        className="form-input"
                                                        placeholder="Ej: Operador de Grúa"
                                                        value={formData.trabajador.cargo}
                                                        onChange={(e) => setFormData({
                                                            ...formData,
                                                            trabajador: { ...formData.trabajador, cargo: e.target.value }
                                                        })}
                                                    />
                                                </div>
                                            </div>
                                        </div>

                                        {/* Sección: Descripción */}
                                        <div className="form-section">
                                            <h3 className="form-section-title">Descripción del Incidente</h3>
                                            <div className="form-group">
                                                <label className="form-label">Detalle *</label>
                                                <textarea
                                                    className="form-input"
                                                    rows={5}
                                                    placeholder="Describa con detalle lo ocurrido, incluyendo circunstancias, lugar exacto, hora aproximada y cualquier información relevante..."
                                                    value={formData.descripcion}
                                                    onChange={(e) => setFormData({ ...formData, descripcion: e.target.value })}
                                                    required
                                                />
                                                <span className="form-hint">Sea lo más específico posible para facilitar la investigación</span>
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

                                        {/* Sección: Confirmación de Envío */}
                                        <div className="form-section confirmation-section">
                                            <h3 className="form-section-title">
                                                <FiCheck className="inline mr-2" />
                                                Confirmación de Envío
                                            </h3>
                                            <div className="confirmation-box">
                                                <div className="confirmation-info">
                                                    <div className="confirmation-row">
                                                        <span className="confirmation-label">Reportado por:</span>
                                                        <span className="confirmation-value">{user?.nombre || 'Usuario'}</span>
                                                    </div>
                                                    <div className="confirmation-row">
                                                        <span className="confirmation-label">Fecha y hora:</span>
                                                        <span className="confirmation-value">{new Date().toLocaleString('es-CL')}</span>
                                                    </div>
                                                </div>
                                                <label className="confirmation-checkbox">
                                                    <input
                                                        type="checkbox"
                                                        checked={confirmaEnvio}
                                                        onChange={(e) => setConfirmaEnvio(e.target.checked)}
                                                        required
                                                    />
                                                    <span> Confirmo que la información proporcionada es verídica y corresponde a los hechos ocurridos.</span>
                                                </label>
                                                <p className="form-hint" style={{ marginTop: 'var(--space-2)' }}>
                                                    Esta confirmación sirve como registro de autoría del reporte.
                                                </p>
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
                                                        Reportar Incidente
                                                    </>
                                                )}
                                            </button>
                                        </div>
                                    </form>
                                )}
                            </div>
                        </div>
                    </div>
                )}

                {/* Detail Modal */}
                {selectedIncident && (
                    <div className="modal-overlay" onClick={() => setSelectedIncident(null)}>
                        <div className="modal-content max-w-4xl" onClick={(e) => e.stopPropagation()}>
                            <div className="modal-header">
                                <div className="modal-header-icon" style={{ background: 'linear-gradient(135deg, var(--warning-500), var(--warning-600))' }}>
                                    {getTipoIcon(selectedIncident.tipo)}
                                </div>
                                <h2 className="modal-title">Detalle del {getTipoLabel(selectedIncident.tipo)}</h2>
                                <p className="modal-subtitle">
                                    Reportado el {new Date(selectedIncident.fecha).toLocaleDateString('es-CL')}
                                </p>
                            </div>

                            <div className="modal-body">
                                <div className="grid grid-cols-2 gap-6">
                                    {/* Columna Izquierda */}
                                    <div className="space-y-6">
                                        <div>
                                            <h3 className="font-semibold mb-3 flex items-center gap-2 text-primary-400">
                                                <FiAlertTriangle size={18} />
                                                Información General
                                            </h3>
                                            <div className="space-y-2">
                                                <div className="detail-row">
                                                    <span className="detail-label">Tipo:</span>
                                                    <span className="detail-value">{getTipoLabel(selectedIncident.tipo)}</span>
                                                </div>
                                                <div className="detail-row">
                                                    <span className="detail-label">Estado:</span>
                                                    <span className={`badge ${getEstadoBadge(selectedIncident.estado)}`}>
                                                        {selectedIncident.estado.replace('_', ' ')}
                                                    </span>
                                                </div>
                                                <div className="detail-row">
                                                    <span className="detail-label">Gravedad:</span>
                                                    <span className={`badge ${getGravedadBadge(selectedIncident.gravedad)}`}>
                                                        {selectedIncident.gravedad}
                                                    </span>
                                                </div>
                                                <div className="detail-row">
                                                    <span className="detail-label">Fecha:</span>
                                                    <span className="detail-value">
                                                        {new Date(selectedIncident.fecha).toLocaleDateString('es-CL')}
                                                    </span>
                                                </div>
                                                <div className="detail-row">
                                                    <span className="detail-label">Hora:</span>
                                                    <span className="detail-value">{selectedIncident.hora}</span>
                                                </div>
                                                {selectedIncident.diasPerdidos && selectedIncident.diasPerdidos > 0 && (
                                                    <div className="detail-row">
                                                        <span className="detail-label">Días Perdidos:</span>
                                                        <span className="detail-value text-danger-400 font-semibold">
                                                            {selectedIncident.diasPerdidos} días
                                                        </span>
                                                    </div>
                                                )}
                                            </div>
                                        </div>

                                        <div>
                                            <h3 className="font-semibold mb-3 flex items-center gap-2 text-primary-400">
                                                <FiMapPin size={18} />
                                                Ubicación
                                            </h3>
                                            <div className="detail-row">
                                                <span className="detail-label">Centro de Trabajo:</span>
                                                <span className="detail-value">{selectedIncident.centroTrabajo}</span>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Columna Derecha */}
                                    <div className="space-y-6">
                                        <div>
                                            <h3 className="font-semibold mb-3 flex items-center gap-2 text-primary-400">
                                                <FiUser size={18} />
                                                Trabajador Afectado
                                            </h3>
                                            <div className="flex items-center gap-3 mb-3">
                                                <div className="avatar" style={{ background: 'rgba(244, 67, 54, 0.15)', color: 'var(--danger-500)' }}>
                                                    {selectedIncident.trabajador.nombre.charAt(0)}
                                                </div>
                                                <div>
                                                    <div className="font-semibold">{selectedIncident.trabajador.nombre}</div>
                                                    <div className="text-sm text-muted font-mono">{selectedIncident.trabajador.rut}</div>
                                                </div>
                                            </div>
                                            <div className="space-y-2">
                                                {selectedIncident.trabajador.cargo && (
                                                    <div className="detail-row">
                                                        <span className="detail-label">Cargo:</span>
                                                        <span className="detail-value">{selectedIncident.trabajador.cargo}</span>
                                                    </div>
                                                )}
                                                {selectedIncident.trabajador.genero && (
                                                    <div className="detail-row">
                                                        <span className="detail-label">Género:</span>
                                                        <span className="detail-value">{selectedIncident.trabajador.genero}</span>
                                                    </div>
                                                )}
                                            </div>
                                        </div>

                                        {selectedIncident.reportadoPor && (
                                            <div>
                                                <h3 className="font-semibold mb-3 flex items-center gap-2 text-primary-400">
                                                    <FiFileText size={18} />
                                                    Reporte
                                                </h3>
                                                <div className="detail-row">
                                                    <span className="detail-label">Reportado por:</span>
                                                    <span className="detail-value">{selectedIncident.reportadoPor}</span>
                                                </div>
                                            </div>
                                        )}
                                    </div>


                                    {/* Loading & Error States */}
                                    {detailLoading && (
                                        <div className="col-span-2 incident-detail-loading">
                                            <FiActivity className="animate-spin text-primary-500" size={24} />
                                            <span>Cargando detalle completo...</span>
                                        </div>
                                    )}

                                    {detailError && (
                                        <div className="col-span-2 incident-detail-error">
                                            <FiAlertCircle size={20} />
                                            <span>{detailError}</span>
                                        </div>
                                    )}

                                    {/* Descripción - Full Width */}
                                    <div className="col-span-2">
                                        <h3 className="font-semibold mb-3 flex items-center gap-2 text-primary-400">
                                            <FiFileText size={18} />
                                            Descripción del Incidente
                                        </h3>
                                        <div className="p-4 bg-surface-elevated rounded-lg text-sm leading-relaxed">
                                            {selectedIncident.descripcion}
                                        </div>
                                    </div>

                                    {/* Evidencias */}
                                    {incidentEvidenceItems.length > 0 && (
                                        <div className="col-span-2">
                                            <h3 className="font-semibold mb-3 flex items-center gap-2 text-primary-400">
                                                <FiImage size={18} />
                                                Evidencias Fotográficas ({incidentEvidenceItems.length})
                                            </h3>
                                            <div className="grid grid-cols-4 gap-3">
                                                {incidentEvidenceItems.map(item => (
                                                    <div
                                                        key={item.id}
                                                        className="incident-evidence-card"
                                                        onClick={() => item.url && setImagePreview({ url: item.url, title: item.title })}
                                                        title={item.url ? 'Ver imagen' : 'Imagen no disponible'}
                                                        role="button"
                                                        tabIndex={0}
                                                        onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
                                                            if (event.key === 'Enter' && item.url) {
                                                                setImagePreview({ url: item.url, title: item.title });
                                                            }
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
                            </div>

                            <div className="modal-footer">
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
                            </div>
                        </div>
                    </div>
                )}


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
                }

                .camera-placeholder {
                    padding-top: var(--space-8);
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
        </>
    );
}
