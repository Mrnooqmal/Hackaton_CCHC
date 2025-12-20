import { useState, useEffect } from 'react';
import type { KeyboardEvent } from 'react';
import Header from '../components/Header';
import {
    FiPlus, FiAlertTriangle, FiFilter, FiX, FiUpload, FiImage,
    FiUser, FiMapPin, FiCalendar, FiTrendingUp, FiActivity,
    FiAlertCircle, FiFileText, FiSave, FiChevronDown, FiChevronUp
} from 'react-icons/fi';
import { incidentsApi } from '../api/client';
import type { Incident, CreateIncidentData, IncidentStats } from '../api/client';
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


export default function Incidents() {
    const { user } = useAuth();
    const [incidents, setIncidents] = useState<Incident[]>([]);
    const [stats, setStats] = useState<IncidentStats | null>(null);
    const [loading, setLoading] = useState(true);
    const [showModal, setShowModal] = useState(false);
    const [selectedIncident, setSelectedIncident] = useState<Incident | null>(null);
    const [detailLoading, setDetailLoading] = useState(false);
    const [detailError, setDetailError] = useState('');
    const [imagePreview, setImagePreview] = useState<{ url: string; title: string } | null>(null);
    const [showFilters, setShowFilters] = useState(false);
    const [filters, setFilters] = useState({
        tipo: '',
        estado: '',
        fechaInicio: '',
        fechaFin: ''
    });

    // Form state
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
        evidencias: []
    });

    const [uploadedFiles, setUploadedFiles] = useState<File[]>([]);
    const [uploading, setUploading] = useState(false);

    useEffect(() => {
        loadIncidents();
        loadStats();
    }, [filters]);

    const loadIncidents = async () => {
        setLoading(true);
        try {
            const response = await incidentsApi.list({
                empresaId: user?.userId,
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
                empresaId: user?.userId,
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

    const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files) {
            const files = Array.from(e.target.files);
            setUploadedFiles(prev => [...prev, ...files]);
        }
    };

    const removeFile = (index: number) => {
        setUploadedFiles(prev => prev.filter((_, i) => i !== index));
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
                empresaId: user?.userId
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

                alert('Incidente reportado exitosamente');
                setShowModal(false);
                resetForm();
                loadIncidents();
                loadStats();
            } else {
                alert('Error al reportar incidente: ' + response.error);
            }
        } catch (error) {
            console.error('Error:', error);
            alert('Error al reportar incidente');
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
            evidencias: []
        });
        setUploadedFiles([]);
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

    const openImagePreview = (url: string, title: string) => {
        if (!url) return;
        setImagePreview({ url, title });
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

    return (
        <>
            <Header title="Incidentes y Accidentes" />
            <div className="page-content">
                {/* Header Section */}
                <div className="mb-6 flex justify-between items-center">
                    <div>
                        <h2 className="text-xl font-bold flex items-center gap-2">
                            <FiAlertTriangle className="text-warning-500" />
                            Control de Incidentes
                        </h2>
                        <p className="text-muted">Sistema de reporte, seguimiento y análisis estadístico</p>
                    </div>
                    <button
                        className="btn btn-primary"
                        onClick={() => setShowModal(true)}
                    >
                        <FiPlus className="mr-2" />
                        Reportar Incidente
                    </button>
                </div>

                {/* Stats Cards */}
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
                    <div className="card-header">
                        <div className="flex items-center gap-2">
                            <FiFilter />
                            <h3 className="font-semibold">Filtros</h3>
                        </div>
                        <div className="flex gap-2">
                            {(filters.tipo || filters.estado || filters.fechaInicio || filters.fechaFin) && (
                                <button
                                    className="btn btn-sm btn-secondary"
                                    onClick={clearFilters}
                                >
                                    Limpiar Filtros
                                </button>
                            )}
                            <button
                                className="btn btn-sm btn-secondary incidents-filter-toggle"
                                onClick={() => setShowFilters(!showFilters)}
                            >
                                {showFilters ? <FiChevronUp /> : <FiChevronDown />}
                            </button>
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
            </div>

            {/* Create Modal */}
            {showModal && (
                <div className="modal-overlay" onClick={() => setShowModal(false)}>
                    <div className="modal-content max-w-3xl" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <div className="modal-header-icon">
                                <FiAlertTriangle size={24} />
                            </div>
                            <h2 className="modal-title">Reportar Incidente/Accidente</h2>
                            <p className="modal-subtitle">Complete el formulario con los detalles del incidente</p>
                        </div>

                        <form onSubmit={handleSubmit} className="modal-body">
                            {/* Sección: Información General */}
                            <div className="form-section">
                                <h3 className="form-section-title">Información General</h3>
                                <div className="grid grid-cols-2 gap-4">
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
                            {detailLoading && (
                                <div className="incident-detail-loading">
                                    <div className="spinner" />
                                    <span>Cargando información actualizada...</span>
                                </div>
                            )}
                            {detailError && (
                                <div className="incident-detail-error">
                                    {detailError}
                                </div>
                            )}

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
                                {(() => {
                                    const evidenceItems = selectedIncident.evidencePreviews?.length
                                        ? selectedIncident.evidencePreviews
                                        : (selectedIncident.evidencias || []).map((key) => ({
                                              key,
                                              url: buildEvidenceUrl(key)
                                          }));

                                    if (!evidenceItems || evidenceItems.length === 0) {
                                        return null;
                                    }

                                    return (
                                        <div className="col-span-2">
                                            <h3 className="font-semibold mb-3 flex items-center gap-2 text-primary-400">
                                                <FiImage size={18} />
                                                Evidencias Fotográficas ({evidenceItems.length})
                                            </h3>
                                            <div className="grid grid-cols-4 gap-3 incident-evidence-grid">
                                                {evidenceItems.map((item, index) => {
                                                    const fileName = item.key.split('/').pop() || `Evidencia ${index + 1}`;
                                                    const isClickable = Boolean(item.url);

                                                    const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
                                                        if (!isClickable) return;
                                                        if (event.key === 'Enter' || event.key === ' ') {
                                                            event.preventDefault();
                                                            openImagePreview(item.url as string, fileName);
                                                        }
                                                    };

                                                    return (
                                                        <div
                                                            key={`${item.key}-${index}`}
                                                            className={`incident-evidence-card ${isClickable ? 'is-clickable' : ''}`}
                                                            onClick={() => isClickable && openImagePreview(item.url as string, fileName)}
                                                            role={isClickable ? 'button' : undefined}
                                                            tabIndex={isClickable ? 0 : undefined}
                                                            onKeyDown={handleKeyDown}
                                                        >
                                                            {item.url ? (
                                                                <img
                                                                    src={item.url}
                                                                    alt={`Evidencia ${fileName}`}
                                                                    loading="lazy"
                                                                />
                                                            ) : (
                                                                <div className="incident-evidence-placeholder">
                                                                    <FiImage size={32} />
                                                                </div>
                                                            )}
                                                            <div className="incident-evidence-meta">
                                                                <FiImage size={14} />
                                                                <span>{fileName}</span>
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    );
                                })()}
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

                .card-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    padding: var(--space-4) var(--space-5);
                    border-bottom: 1px solid var(--surface-border);
                    background: var(--surface-elevated);
                }

                .upload-zone {
                    border: 2px dashed var(--surface-border);
                    border-radius: var(--radius-lg);
                    padding: var(--space-8);
                    text-align: center;
                    transition: all var(--transition-normal);
                    cursor: pointer;
                }

                .upload-zone:hover {
                    border-color: var(--primary-500);
                    background: rgba(76, 175, 80, 0.05);
                }

                .upload-label {
                    cursor: pointer;
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                }

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
                    letter-spacing: 0.05em;
                }

                .badge-success { background: var(--success-500); color: white; }
                .badge-warning { background: var(--warning-500); color: white; }
                .badge-danger { background: var(--danger-500); color: white; }
                .badge-info { background: var(--info-500); color: white; }
                .badge-secondary { background: var(--gray-600); color: white; }

                .incident-evidence-card {
                    position: relative;
                    border-radius: var(--radius-lg);
                    overflow: hidden;
                    border: 1px solid var(--surface-border);
                    background: var(--surface-elevated);
                    min-height: 140px;
                }

                .incident-evidence-card img {
                    width: 100%;
                    height: 100%;
                    object-fit: cover;
                    display: block;
                    transition: transform var(--transition-normal);
                }

                .incident-evidence-card.is-clickable {
                    cursor: zoom-in;
                }

                .incident-evidence-card.is-clickable:focus-visible {
                    outline: 2px solid var(--primary-400);
                    outline-offset: 2px;
                }

                .incident-evidence-card:hover img {
                    transform: scale(1.05);
                }

                .incident-evidence-meta {
                    position: absolute;
                    left: 0;
                    right: 0;
                    bottom: 0;
                    display: flex;
                    align-items: center;
                    gap: 6px;
                    padding: 6px 10px;
                    font-size: var(--text-xs);
                    background: linear-gradient(180deg, rgba(0,0,0,0) 0%, rgba(0,0,0,0.75) 100%);
                    color: white;
                }

                .incident-evidence-placeholder {
                    width: 100%;
                    height: 100%;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    color: var(--text-muted);
                }

                .incident-evidence-lightbox {
                    position: fixed;
                    inset: 0;
                    background: rgba(0, 0, 0, 0.85);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    z-index: 1100;
                    padding: var(--space-6);
                }

                .incident-evidence-lightbox-content {
                    position: relative;
                    max-width: min(1200px, 90vw);
                    max-height: 90vh;
                    display: flex;
                    flex-direction: column;
                    gap: var(--space-3);
                    align-items: center;
                }

                .incident-evidence-lightbox-content img {
                    max-width: 100%;
                    max-height: 80vh;
                    border-radius: var(--radius-md);
                    box-shadow: 0 25px 60px rgba(0, 0, 0, 0.6);
                }

                .incident-evidence-lightbox-content p {
                    color: white;
                    font-size: var(--text-sm);
                    text-align: center;
                }

                .incident-evidence-lightbox-close {
                    position: absolute;
                    top: 0;
                    right: 0;
                    transform: translate(50%, -50%);
                    background: rgba(0,0,0,0.7);
                    border: none;
                    border-radius: var(--radius-full);
                    color: white;
                    width: 36px;
                    height: 36px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    cursor: pointer;
                }

                .incident-detail-loading {
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    gap: var(--space-2);
                    padding: var(--space-3);
                    border: 1px dashed var(--surface-border);
                    border-radius: var(--radius-md);
                    color: var(--text-muted);
                    margin-bottom: var(--space-4);
                }

                .incident-detail-error {
                    margin-bottom: var(--space-4);
                    padding: var(--space-3);
                    border-radius: var(--radius-md);
                    background: rgba(244, 67, 54, 0.15);
                    color: var(--danger-500);
                    font-size: var(--text-sm);
                }

                @media (max-width: 768px) {
                    .grid-cols-2,
                    .md\\:grid-cols-2,
                    .lg\\:grid-cols-4 {
                        grid-template-columns: 1fr !important;
                    }
                }

                @media (min-width: 769px) and (max-width: 1023px) {
                    .lg\\:grid-cols-4 {
                        grid-template-columns: repeat(2, 1fr) !important;
                    }
                }

            `}</style>
        </>
    );
}
