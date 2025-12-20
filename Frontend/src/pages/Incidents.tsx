import { useState, useEffect } from 'react';
import { FiPlus, FiAlertTriangle, FiFilter, FiX, FiUpload, FiImage, FiUser, FiMapPin } from 'react-icons/fi';
import { incidentsApi } from '../api/client';
import type { Incident, CreateIncidentData, IncidentStats } from '../api/client';
import { useAuth } from '../context/AuthContext';

export default function Incidents() {
    const { user } = useAuth();
    const [incidents, setIncidents] = useState<Incident[]>([]);
    const [stats, setStats] = useState<IncidentStats | null>(null);
    const [loading, setLoading] = useState(true);
    const [showModal, setShowModal] = useState(false);
    const [selectedIncident, setSelectedIncident] = useState<Incident | null>(null);
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
            // No bloquear la carga de la página si las estadísticas fallan
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
                // Obtener URL presignada
                const urlResponse = await incidentsApi.uploadEvidence({
                    fileName: file.name,
                    fileType: file.type,
                    incidentId
                });

                if (urlResponse.success && urlResponse.data) {
                    // Subir archivo a S3
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
            // Crear incidente
            const response = await incidentsApi.create({
                ...formData,
                reportadoPor: user?.nombre || 'Usuario',
                empresaId: user?.userId
            });

            if (response.success && response.data) {
                // Subir evidencias si hay archivos
                if (uploadedFiles.length > 0) {
                    const s3Keys = await uploadFiles(response.data.incidentId);

                    // Actualizar incidente con las evidencias
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

    const getEstadoBadge = (estado: string) => {
        const badges: Record<string, string> = {
            reportado: 'bg-yellow-500',
            en_investigacion: 'bg-blue-500',
            cerrado: 'bg-gray-500'
        };
        return badges[estado] || 'bg-gray-500';
    };

    const getGravedadBadge = (gravedad: string) => {
        const badges: Record<string, string> = {
            leve: 'bg-green-500',
            grave: 'bg-orange-500',
            fatal: 'bg-red-500'
        };
        return badges[gravedad] || 'bg-gray-500';
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
        <div className="page-container">
            <div className="page-header">
                <div>
                    <h1 className="page-title">
                        <FiAlertTriangle className="inline mr-2" />
                        Incidentes y Accidentes
                    </h1>
                    <p className="page-subtitle">
                        Sistema de reporte y seguimiento de incidentes
                    </p>
                </div>
                <button
                    className="btn btn-primary"
                    onClick={() => setShowModal(true)}
                >
                    <FiPlus /> Reportar Incidente
                </button>
            </div>

            {/* Estadísticas */}
            {stats && (
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
                    <div className="card p-4">
                        <div className="text-sm text-gray-500 mb-1">Total Incidentes</div>
                        <div className="text-2xl font-bold">{stats.totalIncidentes}</div>
                    </div>
                    <div className="card p-4">
                        <div className="text-sm text-gray-500 mb-1">Tasa Accidentabilidad</div>
                        <div className="text-2xl font-bold">{stats.tasaAccidentabilidad}%</div>
                    </div>
                    <div className="card p-4">
                        <div className="text-sm text-gray-500 mb-1">Días Perdidos</div>
                        <div className="text-2xl font-bold">{stats.diasPerdidos}</div>
                    </div>
                    <div className="card p-4">
                        <div className="text-sm text-gray-500 mb-1">Siniestralidad</div>
                        <div className="text-2xl font-bold">{stats.siniestralidad}%</div>
                    </div>
                </div>
            )}

            {/* Filtros */}
            <div className="card p-4 mb-6">
                <div className="flex items-center gap-4">
                    <FiFilter className="text-gray-500" />
                    <select
                        className="input"
                        value={filters.tipo}
                        onChange={(e) => setFilters({ ...filters, tipo: e.target.value })}
                    >
                        <option value="">Todos los tipos</option>
                        <option value="accidente">Accidente</option>
                        <option value="incidente">Incidente</option>
                        <option value="condicion_subestandar">Condición Subestándar</option>
                    </select>
                    <select
                        className="input"
                        value={filters.estado}
                        onChange={(e) => setFilters({ ...filters, estado: e.target.value })}
                    >
                        <option value="">Todos los estados</option>
                        <option value="reportado">Reportado</option>
                        <option value="en_investigacion">En Investigación</option>
                        <option value="cerrado">Cerrado</option>
                    </select>
                    <input
                        type="date"
                        className="input"
                        value={filters.fechaInicio}
                        onChange={(e) => setFilters({ ...filters, fechaInicio: e.target.value })}
                        placeholder="Fecha inicio"
                    />
                    <input
                        type="date"
                        className="input"
                        value={filters.fechaFin}
                        onChange={(e) => setFilters({ ...filters, fechaFin: e.target.value })}
                        placeholder="Fecha fin"
                    />
                </div>
            </div>

            {/* Lista de incidentes */}
            <div className="card">
                <div className="table-container">
                    <table className="table">
                        <thead>
                            <tr>
                                <th>Fecha</th>
                                <th>Tipo</th>
                                <th>Centro de Trabajo</th>
                                <th>Trabajador</th>
                                <th>Gravedad</th>
                                <th>Estado</th>
                                <th>Acciones</th>
                            </tr>
                        </thead>
                        <tbody>
                            {loading ? (
                                <tr>
                                    <td colSpan={7} className="text-center py-8">
                                        Cargando...
                                    </td>
                                </tr>
                            ) : incidents.length === 0 ? (
                                <tr>
                                    <td colSpan={7} className="text-center py-8">
                                        No hay incidentes registrados
                                    </td>
                                </tr>
                            ) : (
                                incidents.map((incident) => (
                                    <tr key={incident.incidentId}>
                                        <td>{new Date(incident.fecha).toLocaleDateString()}</td>
                                        <td>{getTipoLabel(incident.tipo)}</td>
                                        <td>{incident.centroTrabajo}</td>
                                        <td>{incident.trabajador.nombre}</td>
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
                                        <td>
                                            <button
                                                className="btn btn-sm btn-secondary"
                                                onClick={() => setSelectedIncident(incident)}
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

            {/* Modal de reporte */}
            {showModal && (
                <div className="modal-overlay" onClick={() => setShowModal(false)}>
                    <div className="modal-content" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <h2 className="modal-title">Reportar Incidente/Accidente</h2>
                            <button onClick={() => setShowModal(false)}>
                                <FiX />
                            </button>
                        </div>

                        <form onSubmit={handleSubmit} className="modal-body">
                            <div className="grid grid-cols-2 gap-4">
                                <div className="form-group">
                                    <label className="label">Tipo *</label>
                                    <select
                                        className="input"
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
                                    <label className="label">Centro de Trabajo *</label>
                                    <input
                                        type="text"
                                        className="input"
                                        value={formData.centroTrabajo}
                                        onChange={(e) => setFormData({ ...formData, centroTrabajo: e.target.value })}
                                        required
                                    />
                                </div>

                                <div className="form-group">
                                    <label className="label">Nombre Trabajador *</label>
                                    <input
                                        type="text"
                                        className="input"
                                        value={formData.trabajador.nombre}
                                        onChange={(e) => setFormData({
                                            ...formData,
                                            trabajador: { ...formData.trabajador, nombre: e.target.value }
                                        })}
                                        required
                                    />
                                </div>

                                <div className="form-group">
                                    <label className="label">RUT Trabajador *</label>
                                    <input
                                        type="text"
                                        className="input"
                                        value={formData.trabajador.rut}
                                        onChange={(e) => setFormData({
                                            ...formData,
                                            trabajador: { ...formData.trabajador, rut: e.target.value }
                                        })}
                                        required
                                    />
                                </div>

                                <div className="form-group">
                                    <label className="label">Género</label>
                                    <select
                                        className="input"
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
                                    <label className="label">Cargo</label>
                                    <input
                                        type="text"
                                        className="input"
                                        value={formData.trabajador.cargo}
                                        onChange={(e) => setFormData({
                                            ...formData,
                                            trabajador: { ...formData.trabajador, cargo: e.target.value }
                                        })}
                                    />
                                </div>

                                <div className="form-group">
                                    <label className="label">Gravedad</label>
                                    <select
                                        className="input"
                                        value={formData.gravedad}
                                        onChange={(e) => setFormData({ ...formData, gravedad: e.target.value as any })}
                                    >
                                        <option value="leve">Leve</option>
                                        <option value="grave">Grave</option>
                                        <option value="fatal">Fatal</option>
                                    </select>
                                </div>

                                <div className="form-group">
                                    <label className="label">Días Perdidos</label>
                                    <input
                                        type="number"
                                        className="input"
                                        value={formData.diasPerdidos}
                                        onChange={(e) => setFormData({ ...formData, diasPerdidos: parseInt(e.target.value) || 0 })}
                                        min="0"
                                    />
                                </div>
                            </div>

                            <div className="form-group">
                                <label className="label">Descripción del Incidente *</label>
                                <textarea
                                    className="input"
                                    rows={4}
                                    value={formData.descripcion}
                                    onChange={(e) => setFormData({ ...formData, descripcion: e.target.value })}
                                    required
                                />
                            </div>

                            {/* Upload de evidencias */}
                            <div className="form-group">
                                <label className="label">Evidencias Fotográficas</label>
                                <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center">
                                    <input
                                        type="file"
                                        id="file-upload"
                                        className="hidden"
                                        multiple
                                        accept="image/*"
                                        onChange={handleFileSelect}
                                    />
                                    <label htmlFor="file-upload" className="cursor-pointer">
                                        <FiUpload className="mx-auto text-4xl text-gray-400 mb-2" />
                                        <p className="text-gray-600">Click para seleccionar fotos</p>
                                        <p className="text-sm text-gray-400">o arrastra y suelta aquí</p>
                                    </label>
                                </div>

                                {/* Preview de archivos */}
                                {uploadedFiles.length > 0 && (
                                    <div className="mt-4 grid grid-cols-3 gap-2">
                                        {uploadedFiles.map((file, index) => (
                                            <div key={index} className="relative">
                                                <img
                                                    src={URL.createObjectURL(file)}
                                                    alt={file.name}
                                                    className="w-full h-24 object-cover rounded"
                                                />
                                                <button
                                                    type="button"
                                                    className="absolute top-1 right-1 bg-red-500 text-white rounded-full p-1"
                                                    onClick={() => removeFile(index)}
                                                >
                                                    <FiX size={12} />
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>

                            <div className="modal-footer">
                                <button
                                    type="button"
                                    className="btn btn-secondary"
                                    onClick={() => setShowModal(false)}
                                    disabled={uploading}
                                >
                                    Cancelar
                                </button>
                                <button
                                    type="submit"
                                    className="btn btn-primary"
                                    disabled={uploading}
                                >
                                    {uploading ? 'Enviando...' : 'Reportar Incidente'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Modal de detalle */}
            {selectedIncident && (
                <div className="modal-overlay" onClick={() => setSelectedIncident(null)}>
                    <div className="modal-content max-w-4xl" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <h2 className="modal-title">Detalle del Incidente</h2>
                            <button onClick={() => setSelectedIncident(null)}>
                                <FiX />
                            </button>
                        </div>

                        <div className="modal-body">
                            <div className="grid grid-cols-2 gap-6">
                                <div>
                                    <h3 className="font-semibold mb-2 flex items-center gap-2">
                                        <FiAlertTriangle /> Información General
                                    </h3>
                                    <div className="space-y-2">
                                        <p><strong>Tipo:</strong> {getTipoLabel(selectedIncident.tipo)}</p>
                                        <p><strong>Estado:</strong> <span className={`badge ${getEstadoBadge(selectedIncident.estado)}`}>{selectedIncident.estado}</span></p>
                                        <p><strong>Gravedad:</strong> <span className={`badge ${getGravedadBadge(selectedIncident.gravedad)}`}>{selectedIncident.gravedad}</span></p>
                                        <p><strong>Fecha:</strong> {new Date(selectedIncident.fecha).toLocaleDateString()}</p>
                                        <p><strong>Hora:</strong> {selectedIncident.hora}</p>
                                    </div>
                                </div>

                                <div>
                                    <h3 className="font-semibold mb-2 flex items-center gap-2">
                                        <FiUser /> Trabajador Afectado
                                    </h3>
                                    <div className="space-y-2">
                                        <p><strong>Nombre:</strong> {selectedIncident.trabajador.nombre}</p>
                                        <p><strong>RUT:</strong> {selectedIncident.trabajador.rut}</p>
                                        <p><strong>Cargo:</strong> {selectedIncident.trabajador.cargo}</p>
                                        <p><strong>Género:</strong> {selectedIncident.trabajador.genero}</p>
                                    </div>
                                </div>

                                <div className="col-span-2">
                                    <h3 className="font-semibold mb-2 flex items-center gap-2">
                                        <FiMapPin /> Ubicación
                                    </h3>
                                    <p><strong>Centro de Trabajo:</strong> {selectedIncident.centroTrabajo}</p>
                                </div>

                                <div className="col-span-2">
                                    <h3 className="font-semibold mb-2">Descripción</h3>
                                    <p className="text-gray-700">{selectedIncident.descripcion}</p>
                                </div>

                                {selectedIncident.evidencias && selectedIncident.evidencias.length > 0 && (
                                    <div className="col-span-2">
                                        <h3 className="font-semibold mb-2 flex items-center gap-2">
                                            <FiImage /> Evidencias Fotográficas
                                        </h3>
                                        <div className="grid grid-cols-3 gap-2">
                                            {selectedIncident.evidencias.map((s3Key, index) => (
                                                <div key={index} className="border rounded p-2">
                                                    <p className="text-xs text-gray-500 truncate">{s3Key}</p>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
