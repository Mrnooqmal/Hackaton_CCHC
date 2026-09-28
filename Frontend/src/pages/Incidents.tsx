import { useState, useEffect } from 'react';
import type { KeyboardEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    FiPlus, FiAlertTriangle, FiX, FiImage,
    FiCalendar, FiActivity, FiShield, FiZap, FiTrendingUp,
    FiAlertCircle, FiFileText,
    FiPieChart, FiList, FiBarChart2,
    FiChevronLeft, FiChevronRight, FiCheckCircle, FiClock, FiCircle
} from 'react-icons/fi';
import { incidentsApi, workersApi } from '../api/client';
import type { Incident, IncidentStats, AnalyticsData } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useObraContext } from '../context/ObraContext';
import { PERMISSIONS } from '../permissions';
import { Modal, Select, PageHeader, SegmentedControl, SearchInput, StatCard, IncidentesSkeleton, IncidentesStatsSkeleton } from '../components/ui';
import { incidenteCerrado, ETAPAS_CONSTRUCTIVAS } from '../utils/incidentes';

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

export default function Incidents() {
    const navigate = useNavigate();
    const { user, hasPermission } = useAuth();
    const { selectedObraId } = useObraContext();
    const [incidents, setIncidents] = useState<Incident[]>([]);
    const [stats, setStats] = useState<IncidentStats | null>(null);
    const [_analytics, setAnalytics] = useState<AnalyticsData | null>(null);
    const [loading, setLoading] = useState(true);
    const [selectedIncident, setSelectedIncident] = useState<Incident | null>(null);
    const [detailLoading, setDetailLoading] = useState(false);
    const [detailError, setDetailError] = useState('');
    // Carrusel de evidencias: índice de la imagen abierta dentro de la galería
    // navegable (o null si el visor está cerrado).
    const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
    const [activeTab, setActiveTab] = useState<'listado' | 'estadisticas'>('listado');
    const [filters] = useState({
        tipo: '',
        estado: '',
        fechaInicio: '',
        fechaFin: ''
    });

    // Filtros del listado — client-side, sobre lo ya cargado (igual que el
    // segmentado hallazgos/incidentes): no hay volumen que justifique pedirlos
    // al backend.
    const [listSearch, setListSearch] = useState('');
    const [filtroGravedad, setFiltroGravedad] = useState('');
    const [filtroCierre, setFiltroCierre] = useState('');
    const [filtroEtapa, setFiltroEtapa] = useState('');

    const [calendarMonth, setCalendarMonth] = useState(new Date());

    // ─── Reunion 2026-06-10: hallazgos vs incidentes ──────────────────────────
    // Incidentes/accidentes: creacion restringida a supervisor y superiores.
    const canCreateIncidente = hasPermission(PERMISSIONS.INCIDENTES_REPORTAR);
    const canVerEstadisticas = hasPermission(PERMISSIONS.INCIDENTES_ESTADISTICAS);
    const canVerHistorial = hasPermission(PERMISSIONS.INCIDENTES_HISTORIAL);
    const canCalificarAccidente = hasPermission(PERMISSIONS.INCIDENTES_CALIFICAR_ACCIDENTE);
    const [listTab, setListTab] = useState<'hallazgos' | 'incidentes'>('incidentes');
    const esHallazgo = (inc: Incident) =>
        (inc as any).clasificacion === 'hallazgo' || ['condicion_subestandar', 'accion_subestandar'].includes(inc.tipo);

    // Gobernanza de hallazgos (panel supervisor+)
    const [gobIncident, setGobIncident] = useState<Incident | null>(null);
    const [gobForm, setGobForm] = useState({ responsableId: '', plazoRespuestaISO: '', estadoCierre: 'abierto', comentarioCierre: '' });
    const [gobSaving, setGobSaving] = useState(false);
    const [gobError, setGobError] = useState('');
    const [personasTenant, setPersonasTenant] = useState<any[]>([]);

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

    // Confirmación inline para calificar como accidente
    const [confirmingAccidenteId, setConfirmingAccidenteId] = useState<string | null>(null);
    const [markingAccidente, setMarkingAccidente] = useState(false);

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

    // Estado y cierre son flujos de trabajo (no un semáforo bueno/malo): un
    // punto de acento para "recién llegado", un aro para "en curso" y un
    // check neutro para "resuelto" — mismo lenguaje en ambos casos.
    const renderEstadoBadge = (estado: string) => {
        if (estado === 'cerrado') return <span className="badge badge-neutral"><FiCheckCircle size={11} /> Cerrado</span>;
        if (estado === 'en_investigacion') return <span className="badge badge-secondary"><FiClock size={11} /> En investigación</span>;
        return <span className="badge badge-accent"><FiCircle size={10} /> Reportado</span>;
    };

    const renderCierreBadge = (estadoCierre: string) => {
        if (estadoCierre === 'cerrado') return <span className="badge badge-neutral"><FiCheckCircle size={11} /> Cerrado</span>;
        if (estadoCierre === 'en_proceso') return <span className="badge badge-secondary"><FiClock size={11} /> En proceso</span>;
        return <span className="badge badge-accent"><FiCircle size={10} /> Abierto</span>;
    };

    // Gravedad SÍ es una escala de riesgo real, pero se evita el semáforo
    // verde/ámbar/rojo: leve queda neutro, grave usa el único acento de
    // alerta que ya existe en el resto de la app (--danger-alerta, el mismo
    // de "Dar de baja" en Personas) y el rojo de marca queda reservado solo
    // para fatal.
    const renderGravedadBadge = (gravedad: string) => {
        if (gravedad === 'fatal') return <span className="badge inc-badge-critico"><FiAlertCircle size={11} /> Fatal</span>;
        if (gravedad === 'grave') return <span className="badge inc-badge-alerta"><FiAlertTriangle size={11} /> Grave</span>;
        return <span className="badge badge-neutral"><FiCircle size={10} /> Leve</span>;
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
                (inc.trabajadorNombre || inc.trabajador?.nombre || ''),
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
                                    <td>${(inc.trabajadorNombre || inc.trabajador?.nombre || '')}</td>
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

    // Solo las evidencias con imagen disponible son navegables en el carrusel.
    const viewableEvidence = incidentEvidenceItems.filter(item => !!item.url);
    const lightboxItem = lightboxIndex !== null ? viewableEvidence[lightboxIndex] : null;

    const openLightbox = (item: { url?: string }) => {
        const idx = viewableEvidence.findIndex(v => v.url === item.url);
        if (idx >= 0) setLightboxIndex(idx);
    };
    const showPrevEvidence = () =>
        setLightboxIndex(i => (i === null ? i : (i - 1 + viewableEvidence.length) % viewableEvidence.length));
    const showNextEvidence = () =>
        setLightboxIndex(i => (i === null ? i : (i + 1) % viewableEvidence.length));

    // Navegación por teclado mientras el carrusel está abierto.
    useEffect(() => {
        if (lightboxIndex === null) return;
        const onKey = (e: globalThis.KeyboardEvent) => {
            if (e.key === 'Escape') setLightboxIndex(null);
            else if (e.key === 'ArrowLeft') showPrevEvidence();
            else if (e.key === 'ArrowRight') showNextEvidence();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [lightboxIndex, viewableEvidence.length]);

    return (
        <>
            <div className="page-content">
                {/* Listado y estadísticas son dos vistas de lo mismo, no un
                    filtro: van en el encabezado, como en el resto de páginas
                    con secciones alternables. Cada pestaña requiere su propio
                    permiso de vista, así que puede faltar una de las dos —o
                    las dos, sin obra activa. */}
                <PageHeader
                    banner
                    title="Incidentes y hallazgos"
                    description="Reporte, seguimiento y análisis estadístico de incidentes, accidentes y hallazgos de seguridad."
                    tabs={selectedObraId && (canVerHistorial || canVerEstadisticas) ? [
                        ...(canVerHistorial ? [{ id: 'listado', label: 'Listado', icon: <FiList size={15} /> }] : []),
                        ...(canVerEstadisticas ? [{ id: 'estadisticas', label: 'Estadísticas', icon: <FiPieChart size={15} /> }] : []),
                    ] : undefined}
                    activeTab={activeTab}
                    onTabChange={(id) => setActiveTab(id as 'listado' | 'estadisticas')}
                    tabsLabel="Vista de incidentes"
                    actions={
                        <>
                            <button
                                className="btn btn-secondary"
                                disabled={!selectedObraId}
                                onClick={() => navigate('/incidents/reportar', { state: { clasificacion: 'hallazgo' } })}
                            >
                                <FiPlus /> Reportar hallazgo
                            </button>
                            {canCreateIncidente && (
                                <button
                                    className="btn btn-primary"
                                    disabled={!selectedObraId}
                                    onClick={() => navigate('/incidents/reportar', { state: { clasificacion: 'incidente' } })}
                                >
                                    <FiPlus /> Reportar incidente
                                </button>
                            )}
                        </>
                    }
                />

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
                            No hay una obra activa
                        </p>
                        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)', maxWidth: 380, margin: 0 }}>
                            Los incidentes y hallazgos pertenecen a una obra. Para verlos o reportarlos, usa «Cambiar de obra», en el botón de sesión al final del menú lateral.
                        </p>
                    </div>
                )}

                {/* Contenido — solo visible cuando hay obra seleccionada */}
                {selectedObraId && <>

                {/* Statistics Dashboard Tab */}
                {activeTab === 'estadisticas' && canVerEstadisticas && (() => {
                    if (loading) return <IncidentesStatsSkeleton />;
                    const hallazgosCount = incidents.filter(esHallazgo).length;
                    const accidentesCount = incidents.filter(i => i.tipo === 'accidente').length;
                    const incidentesCount = incidents.filter(i => !esHallazgo(i) && i.tipo === 'incidente').length;
                    const total = incidents.length;
                    const tasaCorregida = total > 0 ? (accidentesCount / total * 100) : 0;
                    const hallazgosCerrados = incidents.filter(i => esHallazgo(i) && incidenteCerrado(i)).length;
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

                            {/* 4 métricas clave — un solo acento (azul) para la que resume el
                                riesgo del período; el resto queda neutro, sin colorear cada
                                tarjeta por categoría. */}
                            <div className="stats-grid-4 mb-4">
                                <StatCard icon={<FiShield size={20} />} value={hallazgosCount} label="Hallazgos" color="var(--gray-600)" />
                                <StatCard icon={<FiZap size={20} />} value={incidentesCount} label="Incidentes" color="var(--gray-600)" />
                                <StatCard icon={<FiAlertCircle size={20} />} value={accidentesCount} label="Accidentes" color="var(--gray-600)" />
                                <StatCard icon={<FiTrendingUp size={20} />} value={`${tasaCorregida.toFixed(1)}%`} label="Tasa de accidentabilidad" color="var(--primary-600)" />
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
                                                        {m.hallazgos > 0 && <rect x={x} y={chartBottom - hH} width={barW} height={hH} rx={2} fill="var(--accent-tint)" />}
                                                        {m.incidentes > 0 && <rect x={x} y={chartBottom - hH - iH} width={barW} height={iH} rx={2} fill="var(--primary-500)" />}
                                                        {m.accidentes > 0 && <rect x={x} y={chartBottom - hH - iH - aH} width={barW} height={aH} rx={2} fill="var(--primary-800)" />}
                                                        <text x={x + barW / 2} y={144} fontSize="9" textAnchor="middle" fill="var(--text-muted)">{m.label}</text>
                                                    </g>
                                                );
                                            })}
                                        </svg>
                                        <div style={{ display: 'flex', gap: 'var(--space-5)', justifyContent: 'center', paddingBottom: 'var(--space-2)' }}>
                                            {[
                                                { color: 'var(--accent-tint)', border: '1px solid var(--primary-500)', label: 'Hallazgos' },
                                                { color: 'var(--primary-500)', border: 'none', label: 'Incidentes' },
                                                { color: 'var(--primary-800)', border: 'none', label: 'Accidentes' },
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
                                    {/* Dona con una sola rampa: neutro (leve) → acento de alerta
                                        (grave) → rojo de marca reservado solo para fatal. Reemplaza
                                        las barras verde/ámbar/rojo que traía esta tarjeta. */}
                                    <div className="chart-container" style={{ height: 'auto', padding: 'var(--space-4)' }}>
                                        {(() => {
                                            const leveN = incidents.filter(i => i.gravedad === 'leve').length;
                                            const graveN = incidents.filter(i => i.gravedad === 'grave').length;
                                            const fatalN = incidents.filter(i => i.gravedad === 'fatal').length;
                                            const pLeve = (leveN / gravedadTotal) * 100;
                                            const pGrave = (graveN / gravedadTotal) * 100;
                                            return (
                                                <div className="inc-gravedad-row">
                                                    <div
                                                        className="inc-gravedad-donut"
                                                        style={{ background: `conic-gradient(var(--surface-hover) 0% ${pLeve}%, var(--danger-alerta) ${pLeve}% ${pLeve + pGrave}%, var(--cchc-red) ${pLeve + pGrave}% 100%)` }}
                                                    >
                                                        <div className="inc-gravedad-hole">
                                                            <span className="inc-gravedad-total">{leveN + graveN + fatalN}</span>
                                                            <span className="inc-gravedad-total-label">total</span>
                                                        </div>
                                                    </div>
                                                    <div className="inc-gravedad-legend">
                                                        <div><span className="inc-gravedad-dot" style={{ background: 'var(--surface-hover)' }} />Leve<b>{leveN}</b></div>
                                                        <div><span className="inc-gravedad-dot" style={{ background: 'var(--danger-alerta)' }} />Grave<b>{graveN}</b></div>
                                                        <div><span className="inc-gravedad-dot" style={{ background: 'var(--cchc-red)' }} />Fatal<b>{fatalN}</b></div>
                                                    </div>
                                                </div>
                                            );
                                        })()}
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
                {activeTab === 'listado' && canVerHistorial && (() => {
                    const base = incidents.filter((i) => listTab === 'hallazgos' ? esHallazgo(i) : !esHallazgo(i));
                    const filtered = base.filter((i) => {
                        if (listSearch && !(i.descripcion || '').toLowerCase().includes(listSearch.toLowerCase())) return false;
                        if (filtroGravedad && i.gravedad !== filtroGravedad) return false;
                        if (filtroCierre === 'abierto' && incidenteCerrado(i)) return false;
                        if (filtroCierre === 'cerrado' && !incidenteCerrado(i)) return false;
                        if (filtroEtapa && (i as any).etapaConstructiva !== filtroEtapa) return false;
                        return true;
                    });
                    const abiertos = base.filter((i) => !incidenteCerrado(i)).length;
                    const cerrados = base.length - abiertos;

                    return (
                        <div className="card">
                            {/* Segmentado hallazgos/incidentes + buscador + filtros (reunion
                                2026-06-10): antes eran dos botones sueltos sin buscador. */}
                            <div className="inc-toolbar">
                                <SegmentedControl
                                    ariaLabel="Tipo"
                                    fullWidth={false}
                                    value={listTab}
                                    onChange={(v) => setListTab(v as 'hallazgos' | 'incidentes')}
                                    options={[
                                        { value: 'hallazgos', label: `Hallazgos (${incidents.filter(esHallazgo).length})` },
                                        { value: 'incidentes', label: `Incidentes (${incidents.filter((i) => !esHallazgo(i)).length})` },
                                    ]}
                                />
                                <SearchInput value={listSearch} onChange={setListSearch} placeholder="Buscar por descripción…" maxWidth="260px" />
                                <Select ariaLabel="Gravedad" value={filtroGravedad} onChange={setFiltroGravedad}
                                    placeholder="Gravedad: Todas"
                                    options={[
                                        { value: '', label: 'Gravedad: Todas' },
                                        { value: 'leve', label: 'Leve' },
                                        { value: 'grave', label: 'Grave' },
                                        { value: 'fatal', label: 'Fatal' },
                                    ]}
                                />
                                <Select ariaLabel="Cierre" value={filtroCierre} onChange={setFiltroCierre}
                                    placeholder="Cierre: Todos"
                                    options={[
                                        { value: '', label: 'Cierre: Todos' },
                                        { value: 'abierto', label: 'Abiertos' },
                                        { value: 'cerrado', label: 'Cerrados' },
                                    ]}
                                />
                                <Select ariaLabel="Etapa constructiva" value={filtroEtapa} onChange={setFiltroEtapa}
                                    placeholder="Etapa: Todas" searchable
                                    options={[{ value: '', label: 'Etapa: Todas' }, ...ETAPAS_CONSTRUCTIVAS.map((e) => ({ value: e, label: e }))]}
                                />
                                <span className="inc-toolbar-count">{abiertos} abiertos · {cerrados} cerrados</span>
                            </div>

                            <div className="incident-list">
                                {loading ? (
                                    <IncidentesSkeleton />
                                ) : filtered.length === 0 ? (
                                    <div style={{ padding: 'var(--space-10)', textAlign: 'center', color: 'var(--text-muted)' }}>
                                        <FiAlertTriangle size={36} style={{ margin: '0 auto var(--space-3)', opacity: 0.25, display: 'block' }} />
                                        <p style={{ fontWeight: 500, marginBottom: 'var(--space-1)' }}>{listTab === 'hallazgos' ? 'Sin hallazgos registrados' : 'Sin incidentes registrados'}</p>
                                        <p style={{ fontSize: 'var(--text-sm)' }}>{base.length > 0 ? 'Ningún registro coincide con los filtros.' : listTab === 'hallazgos' ? 'Cualquier trabajador puede reportar un hallazgo' : 'Los incidentes reportados aparecerán aquí'}</p>
                                    </div>
                                ) : (
                                    filtered.map((incident) => {
                                        const gravedad = incident.gravedad;
                                        const tintClass = gravedad === 'fatal' ? 'inc-icon-critico' : gravedad === 'grave' ? 'inc-icon-alerta' : 'inc-icon-neutro';
                                        return (
                                            <div
                                                key={incident.incidentId}
                                                className="incident-row"
                                                onClick={() => openIncidentDetail(incident)}
                                                role="button"
                                                tabIndex={0}
                                                onKeyDown={(e) => e.key === 'Enter' && openIncidentDetail(incident)}
                                            >
                                                <span className={`incident-row-icon ${tintClass}`}>
                                                    {esHallazgo(incident) ? <FiShield size={17} /> : <FiZap size={17} />}
                                                </span>
                                                <div className="incident-row-body">
                                                    <div className="incident-row-eyebrow">
                                                        {getTipoLabel(incident.tipo)}
                                                        {(incident as any).etapaConstructiva && <><span className="dot">·</span>{(incident as any).etapaConstructiva}</>}
                                                        {isNewIncident(incident) && <span className="badge badge-accent inc-nuevo-pill">Nuevo</span>}
                                                    </div>
                                                    <p className="incident-row-desc">
                                                        {incident.descripcion || 'Sin descripción registrada'}
                                                    </p>
                                                    <div className="incident-row-meta">
                                                        {/* reportadoPor puede venir como ID de persona: se muestra
                                                            solo un nombre legible, o se omite. */}
                                                        {((incident as any).realizadoPor?.nombre || incident.trabajadorNombre) && (
                                                            <><span>{(incident as any).realizadoPor?.nombre || incident.trabajadorNombre}</span><span className="dot">·</span></>
                                                        )}
                                                        <span>{new Date(incident.fecha).toLocaleDateString('es-CL', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                                                        {incident.evidencias?.length > 0 && (
                                                            <><span className="dot">·</span><span><FiImage size={11} style={{ verticalAlign: '-1px', marginRight: 3 }} />{incident.evidencias.length} foto{incident.evidencias.length !== 1 ? 's' : ''}</span></>
                                                        )}
                                                    </div>
                                                </div>
                                                <div className="incident-row-status">
                                                    {esHallazgo(incident)
                                                        ? renderCierreBadge((incident as any).gobernanza?.estadoCierre || 'abierto')
                                                        : renderEstadoBadge(incident.estado)}
                                                    {renderGravedadBadge(incident.gravedad)}
                                                </div>
                                            </div>
                                        );
                                    })
                                )}
                            </div>
                        </div>
                    );
                })()}

                {/* Detail Modal */}
                <Modal
                    isOpen={!!selectedIncident}
                    onClose={() => {
                        setSelectedIncident(null);
                        setDetailError('');
                        setDetailLoading(false);
                        setLightboxIndex(null);
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
                                setLightboxIndex(null);
                            }}
                        >
                            <FiX className="mr-2" />
                            Cerrar
                        </button>
                    }
                >
                    {selectedIncident && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>

                            {/* Cabecera: cierre/estado + gravedad como chips, no como
                                tabla de datos — mismo lenguaje que las filas del listado. */}
                            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap', paddingBottom: 'var(--space-4)', borderBottom: '1px solid var(--surface-border)' }}>
                                {esHallazgo(selectedIncident)
                                    ? renderCierreBadge((selectedIncident as any).gobernanza?.estadoCierre || 'abierto')
                                    : renderEstadoBadge(selectedIncident.estado)}
                                {renderGravedadBadge(selectedIncident.gravedad)}
                                <span style={{ flexGrow: 1 }} />
                                <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>
                                    {new Date(selectedIncident.fecha).toLocaleDateString('es-CL', { day: 'numeric', month: 'short', year: 'numeric' })}
                                    {selectedIncident.hora && ` · ${selectedIncident.hora}`}
                                </span>
                            </div>

                            {/* Flash banner */}
                            {(selectedIncident as any).reporteFlash?.esFlash && (
                                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-3)', padding: 'var(--space-3) var(--space-4)', borderRadius: 'var(--radius-md)', background: 'var(--accent-tint)', border: '1px solid rgba(0,110,220,0.25)' }}>
                                    <FiAlertCircle size={14} style={{ color: 'var(--accent-text)', flexShrink: 0, marginTop: '2px' }} />
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

                            {/* Dos columnas: qué pasó a la izquierda, quién responde a la
                                derecha — un hallazgo se gestiona por gobernanza, un
                                incidente por su ciclo de investigación (utils/incidentes.ts). */}
                            <div className="inc-detail-grid">
                                <div className="inc-detail-col">
                                    <div>
                                        <div className="inc-detail-label">
                                            {esHallazgo(selectedIncident) ? 'Descripción del hallazgo' : 'Descripción del incidente'}
                                        </div>
                                        <p style={{ margin: 0, fontSize: 'var(--text-sm)', color: selectedIncident.descripcion ? 'var(--text-primary)' : 'var(--text-muted)', fontStyle: selectedIncident.descripcion ? 'normal' : 'italic', lineHeight: 1.75 }}>
                                            {selectedIncident.descripcion || 'Sin descripción registrada.'}
                                        </p>
                                    </div>

                                    {((selectedIncident as any).etapaConstructiva || (selectedIncident.diasPerdidos ?? 0) > 0) && (
                                        <div style={{ display: 'flex', gap: 'var(--space-6)' }}>
                                            {(selectedIncident as any).etapaConstructiva && (
                                                <div>
                                                    <div className="inc-detail-label">Etapa</div>
                                                    <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-primary)' }}>{(selectedIncident as any).etapaConstructiva}</div>
                                                </div>
                                            )}
                                            {(selectedIncident.diasPerdidos ?? 0) > 0 && (
                                                <div>
                                                    <div className="inc-detail-label">Días perdidos</div>
                                                    <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--text-primary)' }}>{selectedIncident.diasPerdidos}</div>
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    {/* Trabajador afectado */}
                                    {(selectedIncident.trabajadorNombre || selectedIncident.trabajador?.nombre) && (
                                        <div>
                                            <div className="inc-detail-label">Trabajador afectado</div>
                                            <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center', flexWrap: 'wrap' }}>
                                                <div>
                                                    <div style={{ fontWeight: 600, fontSize: 'var(--text-sm)', color: 'var(--text-primary)' }}>{selectedIncident.trabajadorNombre || selectedIncident.trabajador?.nombre}</div>
                                                    {selectedIncident.trabajador?.rut && (
                                                        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{selectedIncident.trabajador?.rut}</div>
                                                    )}
                                                </div>
                                                {selectedIncident.trabajador?.cargo && (
                                                    <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', padding: '3px 8px', background: 'var(--surface-elevated)', border: '1px solid var(--surface-border)', borderRadius: 'var(--radius-sm)' }}>
                                                        {selectedIncident.trabajador?.cargo}
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    )}

                                    {/* Evidencias */}
                                    {incidentEvidenceItems.length > 0 && (
                                        <div>
                                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-3)' }}>
                                                <span className="inc-detail-label" style={{ marginBottom: 0 }}>Evidencias fotográficas</span>
                                                <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{incidentEvidenceItems.length} archivo{incidentEvidenceItems.length !== 1 ? 's' : ''}</span>
                                            </div>
                                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))', gap: 'var(--space-2)' }}>
                                                {incidentEvidenceItems.map(item => (
                                                    <div
                                                        key={item.id}
                                                        className="incident-evidence-card"
                                                        onClick={() => item.url && openLightbox(item)}
                                                        title={item.url ? 'Ver imagen' : 'Imagen no disponible'}
                                                        role="button"
                                                        tabIndex={0}
                                                        onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
                                                            if (event.key === 'Enter' && item.url) openLightbox(item);
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

                                <div className="inc-detail-col inc-detail-col-side">
                                    {esHallazgo(selectedIncident) ? (
                                        <div>
                                            <div className="inc-detail-label">Gobernanza</div>
                                            {(() => {
                                                const gob = (selectedIncident as any).gobernanza || {};
                                                return (
                                                    <div className="inc-gob-panel">
                                                        <div className="inc-gob-row">
                                                            <span>Responsable</span>
                                                            <strong>{gob.responsableNombre || 'Sin asignar'}</strong>
                                                        </div>
                                                        <div className="inc-gob-row">
                                                            <span>Plazo de respuesta</span>
                                                            <strong>{gob.plazoRespuestaISO ? new Date(gob.plazoRespuestaISO).toLocaleDateString('es-CL') : 'Sin definir'}</strong>
                                                        </div>
                                                        {gob.comentarioCierre && (
                                                            <p style={{ margin: 0, fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                                                                “{gob.comentarioCierre}”
                                                            </p>
                                                        )}
                                                    </div>
                                                );
                                            })()}
                                        </div>
                                    ) : (
                                        <div>
                                            <div className="inc-detail-label">Investigación</div>
                                            {(() => {
                                                const inv = selectedIncident.investigaciones || {};
                                                const roles: Array<{ key: keyof typeof inv; label: string }> = [
                                                    { key: 'prevencionista', label: 'Prevencionista' },
                                                    { key: 'jefeDirecto', label: 'Jefe directo' },
                                                    { key: 'comiteParitario', label: 'Comité paritario' },
                                                ];
                                                const alguna = roles.some((r) => inv[r.key]);
                                                if (!alguna) {
                                                    return <p style={{ margin: 0, fontSize: 'var(--text-sm)', color: 'var(--text-muted)', fontStyle: 'italic' }}>Aún no hay investigaciones registradas.</p>;
                                                }
                                                return (
                                                    <div className="inc-gob-panel">
                                                        {roles.map((r) => {
                                                            const investigacion = inv[r.key];
                                                            const completada = investigacion?.estado === 'completada';
                                                            return (
                                                                <div key={r.key} className="inc-gob-row">
                                                                    <span>{investigacion?.investigador || r.label}</span>
                                                                    {investigacion ? (
                                                                        <span className={`badge ${completada ? 'badge-neutral' : 'badge-accent'}`} style={{ fontSize: '10.5px' }}>
                                                                            {completada ? <FiCheckCircle size={10} /> : <FiClock size={10} />}
                                                                            {completada ? 'Completada' : 'Pendiente'}
                                                                        </span>
                                                                    ) : (
                                                                        <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>Sin asignar</span>
                                                                    )}
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                );
                                            })()}
                                        </div>
                                    )}

                                    {/* Gestionar — acciones con permisos */}
                                    {(canCreateIncidente || canCalificarAccidente) && (
                                        <div>
                                            <div className="inc-detail-label">Gestionar</div>
                                            <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap', alignItems: 'center' }}>
                                                {esHallazgo(selectedIncident) && canCreateIncidente && (
                                                    <button
                                                        className="btn btn-sm btn-secondary"
                                                        onClick={() => openGobernanza(selectedIncident)}
                                                    >
                                                        <FiActivity size={13} style={{ marginRight: '4px' }} />
                                                        Editar gobernanza
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
                                        <div>
                                            <div className="inc-detail-label">Reportado por</div>
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
                                </div>
                            </div>
                        </div>
                    )}
                </Modal>


                {lightboxItem && (
                    <div className="incident-evidence-lightbox" onClick={() => setLightboxIndex(null)}>
                        <div className="incident-evidence-lightbox-content" onClick={(e) => e.stopPropagation()}>
                            <button
                                type="button"
                                className="incident-evidence-lightbox-close"
                                onClick={() => setLightboxIndex(null)}
                                aria-label="Cerrar imagen"
                            >
                                <FiX size={20} />
                            </button>
                            {viewableEvidence.length > 1 && (
                                <button
                                    type="button"
                                    className="incident-evidence-lightbox-nav prev"
                                    onClick={showPrevEvidence}
                                    aria-label="Imagen anterior"
                                >
                                    <FiChevronLeft size={26} />
                                </button>
                            )}
                            <img src={lightboxItem.url} alt={lightboxItem.title} />
                            {viewableEvidence.length > 1 && (
                                <button
                                    type="button"
                                    className="incident-evidence-lightbox-nav next"
                                    onClick={showNextEvidence}
                                    aria-label="Imagen siguiente"
                                >
                                    <FiChevronRight size={26} />
                                </button>
                            )}
                            <p>
                                {lightboxItem.title}
                                {viewableEvidence.length > 1 && (
                                    <span className="incident-evidence-lightbox-counter">
                                        {(lightboxIndex ?? 0) + 1} / {viewableEvidence.length}
                                    </span>
                                )}
                            </p>
                        </div>
                    </div>
                )}


                <style>{`
                /* ── Barra de herramientas del listado ── */
                .inc-toolbar {
                    display: flex;
                    align-items: center;
                    gap: var(--space-3);
                    flex-wrap: wrap;
                    margin-bottom: var(--space-4);
                }
                /* .ui-select ocupa el 100% por defecto (pensado para formularios);
                   en la barra cada filtro es una pastilla del ancho de su texto. */
                .inc-toolbar .ui-select { width: auto; flex: 0 0 auto; min-width: 150px; }
                .inc-toolbar .ui-search-input { flex: 1 1 200px; }
                .inc-toolbar-count {
                    margin-left: auto;
                    font-size: var(--text-xs);
                    color: var(--text-muted);
                    white-space: nowrap;
                }

                /* ── Lista de incidentes/hallazgos ── */
                .incident-list {
                    border-top: 1px solid var(--surface-border);
                }

                .incident-row {
                    display: grid;
                    grid-template-columns: auto 1fr auto;
                    gap: var(--space-4);
                    align-items: flex-start;
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

                /* Ícono de fila tintado por gravedad — leve queda neutro, grave usa
                   el único acento de alerta que ya existe en el resto de la app y
                   fatal el rojo de marca. Nada de verde/ámbar/rojo genérico. */
                .incident-row-icon {
                    width: 38px; height: 38px; flex-shrink: 0;
                    display: flex; align-items: center; justify-content: center;
                    border-radius: var(--radius-md);
                }
                .inc-icon-neutro { background: var(--surface-hover); color: var(--text-secondary); }
                .inc-icon-alerta { background: rgba(223,54,1,0.12); color: var(--danger-alerta); }
                .inc-icon-critico { background: rgba(223,54,1,0.12); color: var(--cchc-red); }

                .incident-row-body { min-width: 0; padding-top: 1px; }
                .incident-row-eyebrow {
                    display: flex; align-items: center; gap: 6px;
                    font-size: 11px; font-weight: 600; letter-spacing: 0.03em; text-transform: uppercase;
                    color: var(--text-muted); margin-bottom: 3px;
                }
                .incident-row-eyebrow .dot { color: var(--surface-border); }
                .inc-nuevo-pill { font-size: 9.5px; padding: 1px 7px; text-transform: none; letter-spacing: 0.02em; }
                .incident-row-desc {
                    margin: 0 0 4px; font-size: var(--text-sm); color: var(--text-primary);
                    display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; line-height: 1.5;
                }
                .incident-row-meta {
                    display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
                    font-size: var(--text-xs); color: var(--text-muted);
                }
                .incident-row-meta .dot { color: var(--surface-border); }

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
                        gap: var(--space-3);
                        padding: var(--space-3) var(--space-4);
                    }
                }

                @media (prefers-reduced-motion: reduce) {
                    .incident-row { transition: none; }
                }

                /* ── Detalle: dos columnas ── */
                .inc-detail-grid {
                    display: grid;
                    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
                    gap: var(--space-6);
                }
                .inc-detail-col {
                    display: flex;
                    flex-direction: column;
                    gap: var(--space-4);
                    min-width: 0;
                }
                .inc-detail-col-side {
                    padding-left: var(--space-6);
                    border-left: 1px solid var(--surface-border);
                }
                .inc-detail-label {
                    font-size: 11px; color: var(--text-muted); font-weight: 600;
                    margin-bottom: var(--space-2);
                }
                .inc-gob-panel {
                    display: flex; flex-direction: column; gap: var(--space-2);
                    padding: var(--space-3); border: 1px solid var(--surface-border);
                    border-radius: var(--radius-md); background: var(--surface-elevated);
                }
                .inc-gob-row {
                    display: flex; align-items: center; justify-content: space-between; gap: var(--space-3);
                    font-size: var(--text-sm); color: var(--text-secondary);
                }
                .inc-gob-row strong { color: var(--text-primary); font-weight: 600; }
                @media (max-width: 768px) {
                    .inc-detail-grid { grid-template-columns: 1fr; }
                    .inc-detail-col-side { padding-left: 0; border-left: none; padding-top: var(--space-4); border-top: 1px solid var(--surface-border); }
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

                /* Mismo criterio que la dona de Gravedad: neutro para leve, el
                   acento de alerta para grave, y el rojo de marca reservado solo
                   para fatal — no el semáforo verde/ámbar/rojo anterior. */
                .calendar-cell-day.leve { background: var(--surface-hover); border-color: var(--surface-border); }
                .calendar-cell-day.grave { background: rgba(223,54,1,0.14); border-color: rgba(223,54,1,0.35); }
                .calendar-cell-day.fatal { background: rgba(223,54,1,0.22); border-color: var(--cchc-red); box-shadow: inset 0 0 0 1.5px var(--cchc-red); }

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

                .severity-badge.leve { color: var(--text-secondary); background: var(--surface-hover); }
                .severity-badge.grave { color: var(--danger-alerta); background: rgba(223,54,1,0.12); }
                .severity-badge.fatal { color: #fff; background: var(--cchc-red); }

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

                /* Gravedad grave/fatal: el único acento de alerta ya existente en la
                   app (tenue para grave) y el rojo de marca sólo para fatal — no un
                   badge-danger nuevo con el rojo Material genérico. */
                .inc-badge-alerta { background: rgba(223,54,1,0.12); color: var(--danger-alerta); }
                .inc-badge-critico { background: var(--cchc-red); color: #fff; }

                /* Dona de gravedad (Estadísticas) */
                .inc-gravedad-row { display: flex; align-items: center; gap: var(--space-5); }
                .inc-gravedad-donut { position: relative; width: 132px; height: 132px; flex-shrink: 0; border-radius: 50%; }
                .inc-gravedad-hole {
                    position: absolute; inset: 18px; border-radius: 50%; background: var(--surface-card);
                    display: flex; flex-direction: column; align-items: center; justify-content: center;
                }
                .inc-gravedad-total { font-size: 22px; font-weight: 700; color: var(--text-primary); }
                .inc-gravedad-total-label { font-size: 10.5px; color: var(--text-muted); }
                .inc-gravedad-legend { display: flex; flex-direction: column; gap: var(--space-2); flex-grow: 1; }
                .inc-gravedad-legend > div { display: flex; align-items: center; gap: 8px; font-size: var(--text-sm); color: var(--text-secondary); }
                .inc-gravedad-legend > div b { margin-left: auto; color: var(--text-primary); font-weight: 600; }
                .inc-gravedad-dot { width: 9px; height: 9px; border-radius: 3px; flex-shrink: 0; }

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

                .incident-evidence-lightbox-content p {
                    margin-top: var(--space-3);
                    text-align: center;
                    color: white;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    gap: var(--space-3);
                }

                .incident-evidence-lightbox-counter {
                    font-variant-numeric: tabular-nums;
                    color: rgba(255, 255, 255, 0.7);
                    font-size: var(--text-sm);
                }

                .incident-evidence-lightbox-nav {
                    position: absolute;
                    top: 50%;
                    transform: translateY(-50%);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    width: 44px;
                    height: 44px;
                    border-radius: 999px;
                    background: rgba(0, 0, 0, 0.45);
                    border: 1px solid rgba(255, 255, 255, 0.2);
                    color: white;
                    cursor: pointer;
                    transition: background 0.15s ease;
                }

                .incident-evidence-lightbox-nav:hover {
                    background: rgba(0, 0, 0, 0.75);
                }

                .incident-evidence-lightbox-nav.prev { left: -56px; }
                .incident-evidence-lightbox-nav.next { right: -56px; }

                @media (max-width: 640px) {
                    .incident-evidence-lightbox-nav.prev { left: 8px; }
                    .incident-evidence-lightbox-nav.next { right: 8px; }
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
            `}</style>
            </>}
            </div>

            {/* Modal: gobernanza de hallazgos (responsable, plazo, verificacion de cierre) */}
            <Modal
                isOpen={!!gobIncident}
                onClose={() => setGobIncident(null)}
                title="Gobernanza del hallazgo"
                subtitle={gobIncident?.descripcion ? gobIncident.descripcion.slice(0, 80) : ''}
                size="lg"
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
                            <option value="">Selecciona…</option>
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
