import { useState, useEffect, useRef } from 'react';
import Header from '../components/Header';
import {
    FiPlus,
    FiUsers,
    FiCheck,
    FiClock,
    FiX,
    FiUpload,
    FiFile,
    FiSearch,
    FiChevronDown,
    FiChevronUp,
    FiAlertCircle,
} from 'react-icons/fi';
import {
    signatureRequestsApi,
    workersApi,
    uploadsApi,
    type SignatureRequest,
    type Worker,
    type DocumentoAdjunto,
    REQUEST_TYPES,
} from '../api/client';
import { useAuth } from '../context/AuthContext';

export default function SignatureRequests() {
    const { user } = useAuth();
    const [requests, setRequests] = useState<SignatureRequest[]>([]);
    const [workers, setWorkers] = useState<Worker[]>([]);
    const [loading, setLoading] = useState(true);
    const [showModal, setShowModal] = useState(false);
    const [selectedRequest, setSelectedRequest] = useState<SignatureRequest | null>(null);
    const [filterStatus, setFilterStatus] = useState<string>('');
    const [searchTerm, setSearchTerm] = useState('');

    // Form state
    const [newRequest, setNewRequest] = useState({
        tipo: 'CHARLA_5MIN',
        titulo: '',
        descripcion: '',
        fechaLimite: '',
        ubicacion: '',
    });
    const [selectedWorkers, setSelectedWorkers] = useState<string[]>([]);
    const [uploadedDocs, setUploadedDocs] = useState<DocumentoAdjunto[]>([]);
    const [uploading, setUploading] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        loadData();
    }, []);

    const loadData = async () => {
        try {
            const [requestsRes, workersRes] = await Promise.all([
                signatureRequestsApi.list(),
                workersApi.list(),
            ]);

            if (requestsRes.success && requestsRes.data) {
                setRequests(requestsRes.data.requests);
            }
            if (workersRes.success && workersRes.data) {
                setWorkers(workersRes.data);
            }
        } catch (error) {
            console.error('Error loading data:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = e.target.files;
        if (!files || files.length === 0) return;

        setUploading(true);
        try {
            for (const file of Array.from(files)) {
                const result = await uploadsApi.uploadFile(file, 'solicitudes');
                if (result.success && result.data) {
                    setUploadedDocs(prev => [...prev, result.data!]);
                } else {
                    alert(`Error al subir ${file.name}: ${result.error}`);
                }
            }
        } finally {
            setUploading(false);
            if (fileInputRef.current) {
                fileInputRef.current.value = '';
            }
        }
    };

    const removeDocument = (index: number) => {
        setUploadedDocs(prev => prev.filter((_, i) => i !== index));
    };

    const handleCreateRequest = async (e: React.FormEvent) => {
        e.preventDefault();

        if (selectedWorkers.length === 0) {
            alert('Debe seleccionar al menos un trabajador');
            return;
        }

        if (!user?.userId) {
            alert('No hay usuario autenticado');
            return;
        }

        setSubmitting(true);
        try {
            const response = await signatureRequestsApi.create({
                tipo: newRequest.tipo,
                titulo: newRequest.titulo || REQUEST_TYPES[newRequest.tipo].label,
                descripcion: newRequest.descripcion,
                documentos: uploadedDocs,
                trabajadoresIds: selectedWorkers,
                solicitanteId: user.userId,
                fechaLimite: newRequest.fechaLimite || undefined,
                ubicacion: newRequest.ubicacion || undefined,
            });

            if (response.success && response.data) {
                setRequests([response.data, ...requests]);
                resetForm();
                setShowModal(false);
            } else {
                alert(response.error || 'Error al crear solicitud');
            }
        } catch (error) {
            console.error('Error creating request:', error);
            alert('Error al crear solicitud');
        } finally {
            setSubmitting(false);
        }
    };

    const resetForm = () => {
        setNewRequest({
            tipo: 'CHARLA_5MIN',
            titulo: '',
            descripcion: '',
            fechaLimite: '',
            ubicacion: '',
        });
        setSelectedWorkers([]);
        setUploadedDocs([]);
    };

    const toggleWorkerSelection = (workerId: string) => {
        setSelectedWorkers(prev =>
            prev.includes(workerId)
                ? prev.filter(id => id !== workerId)
                : [...prev, workerId]
        );
    };

    const selectAllWorkers = () => {
        // Seleccionar todos los workers (habilitados o no)
        if (selectedWorkers.length === workers.length) {
            setSelectedWorkers([]);
        } else {
            setSelectedWorkers(workers.map(w => w.workerId));
        }
    };

    const handleCancelRequest = async (requestId: string) => {
        if (!confirm('¿Está seguro de cancelar esta solicitud?')) return;

        try {
            const response = await signatureRequestsApi.cancel(requestId, 'Cancelada por el solicitante');
            if (response.success) {
                loadData();
            }
        } catch (error) {
            console.error('Error canceling request:', error);
        }
    };

    const getStatusBadge = (estado: string) => {
        const badges: Record<string, { color: string; icon: React.ReactNode; label: string }> = {
            pendiente: { color: 'var(--warning-500)', icon: <FiClock />, label: 'Pendiente' },
            en_proceso: { color: 'var(--info-500)', icon: <FiUsers />, label: 'En Proceso' },
            completada: { color: 'var(--success-500)', icon: <FiCheck />, label: 'Completada' },
            cancelada: { color: 'var(--error-500)', icon: <FiX />, label: 'Cancelada' },
            vencida: { color: 'var(--neutral-500)', icon: <FiAlertCircle />, label: 'Vencida' },
        };
        const badge = badges[estado] || badges.pendiente;
        return (
            <span className="badge" style={{ background: badge.color, color: 'white', display: 'flex', alignItems: 'center', gap: '4px' }}>
                {badge.icon} {badge.label}
            </span>
        );
    };

    const filteredRequests = requests.filter(req => {
        const matchesStatus = !filterStatus || req.estado === filterStatus;
        const matchesSearch = !searchTerm ||
            req.titulo.toLowerCase().includes(searchTerm.toLowerCase()) ||
            req.solicitanteNombre.toLowerCase().includes(searchTerm.toLowerCase());
        return matchesStatus && matchesSearch;
    });

    if (loading) {
        return (
            <div className="flex items-center justify-center" style={{ height: '100vh' }}>
                <div className="spinner" />
            </div>
        );
    }

    return (
        <>
            <Header title="Solicitudes de Firma" />

            <div className="main-content">
                {/* Stats Cards */}
                <div className="grid grid-cols-4 mb-6">
                    <div className="card">
                        <div className="flex items-center gap-3">
                            <div className="avatar" style={{ background: 'var(--warning-100)', color: 'var(--warning-600)' }}>
                                <FiClock size={24} />
                            </div>
                            <div>
                                <div className="text-2xl font-bold">{requests.filter(r => r.estado === 'pendiente').length}</div>
                                <div className="text-sm text-muted">Pendientes</div>
                            </div>
                        </div>
                    </div>
                    <div className="card">
                        <div className="flex items-center gap-3">
                            <div className="avatar" style={{ background: 'var(--info-100)', color: 'var(--info-600)' }}>
                                <FiUsers size={24} />
                            </div>
                            <div>
                                <div className="text-2xl font-bold">{requests.filter(r => r.estado === 'en_proceso').length}</div>
                                <div className="text-sm text-muted">En Proceso</div>
                            </div>
                        </div>
                    </div>
                    <div className="card">
                        <div className="flex items-center gap-3">
                            <div className="avatar" style={{ background: 'var(--success-100)', color: 'var(--success-600)' }}>
                                <FiCheck size={24} />
                            </div>
                            <div>
                                <div className="text-2xl font-bold">{requests.filter(r => r.estado === 'completada').length}</div>
                                <div className="text-sm text-muted">Completadas</div>
                            </div>
                        </div>
                    </div>
                    <div className="card">
                        <div className="flex items-center gap-3">
                            <div className="avatar" style={{ background: 'var(--primary-100)', color: 'var(--primary-600)' }}>
                                📝
                            </div>
                            <div>
                                <div className="text-2xl font-bold">{requests.length}</div>
                                <div className="text-sm text-muted">Total</div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Filters and Actions */}
                <div className="card mb-6">
                    <div className="flex items-center justify-between gap-4">
                        <div className="flex items-center gap-4 flex-1">
                            <div className="input-group" style={{ maxWidth: '300px' }}>
                                <FiSearch className="input-icon" />
                                <input
                                    type="text"
                                    placeholder="Buscar solicitudes..."
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                    className="input"
                                />
                            </div>
                            <select
                                value={filterStatus}
                                onChange={(e) => setFilterStatus(e.target.value)}
                                className="input"
                                style={{ width: 'auto' }}
                            >
                                <option value="">Todos los estados</option>
                                <option value="pendiente">Pendiente</option>
                                <option value="en_proceso">En Proceso</option>
                                <option value="completada">Completada</option>
                                <option value="cancelada">Cancelada</option>
                            </select>
                        </div>
                        <button className="btn btn-primary" onClick={() => setShowModal(true)}>
                            <FiPlus />
                            Nueva Solicitud
                        </button>
                    </div>
                </div>

                {/* Requests List */}
                <div className="card">
                    <div className="card-header">
                        <h2 className="card-title">Solicitudes de Firma</h2>
                    </div>

                    {filteredRequests.length === 0 ? (
                        <div className="empty-state">
                            <div className="empty-state-icon">📋</div>
                            <h3 className="empty-state-title">No hay solicitudes</h3>
                            <p className="empty-state-description">
                                Crea tu primera solicitud de firma para comenzar.
                            </p>
                            <button className="btn btn-primary" onClick={() => setShowModal(true)}>
                                <FiPlus />
                                Nueva Solicitud
                            </button>
                        </div>
                    ) : (
                        <div className="flex flex-col gap-3">
                            {filteredRequests.map((request) => (
                                <div
                                    key={request.requestId}
                                    className="card"
                                    style={{ cursor: 'pointer', border: selectedRequest?.requestId === request.requestId ? '2px solid var(--primary-500)' : undefined }}
                                    onClick={() => setSelectedRequest(selectedRequest?.requestId === request.requestId ? null : request)}
                                >
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-4">
                                            <div className="avatar" style={{ fontSize: '1.5rem' }}>
                                                {REQUEST_TYPES[request.tipo]?.icon || '📝'}
                                            </div>
                                            <div>
                                                <div className="font-bold">{request.titulo}</div>
                                                <div className="text-sm text-muted">
                                                    {REQUEST_TYPES[request.tipo]?.label} • {new Date(request.fechaCreacion).toLocaleDateString('es-CL')}
                                                </div>
                                                <div className="text-sm text-muted">
                                                    Solicitado por: {request.solicitanteNombre}
                                                </div>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-4">
                                            <div className="text-center">
                                                <div className="text-xl font-bold" style={{ color: 'var(--primary-600)' }}>
                                                    {request.totalFirmados}/{request.totalRequeridos}
                                                </div>
                                                <div className="text-xs text-muted">Firmados</div>
                                            </div>
                                            {getStatusBadge(request.estado)}
                                            {selectedRequest?.requestId === request.requestId ? <FiChevronUp /> : <FiChevronDown />}
                                        </div>
                                    </div>

                                    {/* Expanded Details */}
                                    {selectedRequest?.requestId === request.requestId && (
                                        <div className="mt-4 pt-4" style={{ borderTop: '1px solid var(--neutral-200)' }}>
                                            {request.descripcion && (
                                                <p className="text-sm mb-4">{request.descripcion}</p>
                                            )}

                                            {/* Documents */}
                                            {request.documentos.length > 0 && (
                                                <div className="mb-4">
                                                    <h4 className="text-sm font-bold mb-2">Documentos Adjuntos:</h4>
                                                    <div className="flex gap-2 flex-wrap">
                                                        {request.documentos.map((doc, idx) => (
                                                            <a
                                                                key={idx}
                                                                href="#"
                                                                onClick={async (e) => {
                                                                    e.preventDefault();
                                                                    e.stopPropagation();
                                                                    const res = await uploadsApi.getDownloadUrl(doc.url);
                                                                    if (res.success && res.data) {
                                                                        window.open(res.data.downloadUrl, '_blank');
                                                                    }
                                                                }}
                                                                className="badge"
                                                                style={{ background: 'var(--neutral-100)', cursor: 'pointer' }}
                                                            >
                                                                <FiFile size={14} /> {doc.nombre}
                                                            </a>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}

                                            {/* Workers Progress */}
                                            <div className="mb-4">
                                                <h4 className="text-sm font-bold mb-2">Progreso de Firmas:</h4>
                                                <div className="progress-bar mb-2">
                                                    <div
                                                        className="progress-fill"
                                                        style={{
                                                            width: `${(request.totalFirmados / request.totalRequeridos) * 100}%`,
                                                            background: request.totalFirmados === request.totalRequeridos ? 'var(--success-500)' : 'var(--primary-500)',
                                                        }}
                                                    />
                                                </div>
                                                <div className="grid grid-cols-2 gap-2" style={{ maxHeight: '200px', overflowY: 'auto' }}>
                                                    {request.trabajadores.map((t) => (
                                                        <div
                                                            key={t.workerId}
                                                            className="flex items-center gap-2 p-2 rounded"
                                                            style={{ background: t.firmado ? 'var(--success-50)' : 'var(--neutral-50)' }}
                                                        >
                                                            {t.firmado ? (
                                                                <FiCheck style={{ color: 'var(--success-500)' }} />
                                                            ) : (
                                                                <FiClock style={{ color: 'var(--warning-500)' }} />
                                                            )}
                                                            <div>
                                                                <div className="text-sm font-medium">{t.nombre}</div>
                                                                <div className="text-xs text-muted">{t.rut}</div>
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>

                                            {/* Actions */}
                                            {request.estado !== 'completada' && request.estado !== 'cancelada' && (
                                                <div className="flex gap-2">
                                                    <button
                                                        className="btn btn-secondary"
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            handleCancelRequest(request.requestId);
                                                        }}
                                                    >
                                                        <FiX /> Cancelar
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {/* Create Modal */}
            {showModal && (
                <div className="modal-overlay" onClick={() => setShowModal(false)}>
                    <div className="modal" style={{ maxWidth: '800px' }} onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <h2>Nueva Solicitud de Firma</h2>
                            <button className="btn btn-ghost" onClick={() => { resetForm(); setShowModal(false); }}>
                                <FiX />
                            </button>
                        </div>

                        <form onSubmit={handleCreateRequest}>
                            <div className="modal-body">
                                {/* Step 1: Type Selection */}
                                <div className="mb-6">
                                    <label className="label">Tipo de Solicitud</label>
                                    <div className="grid grid-cols-3 gap-2">
                                        {Object.entries(REQUEST_TYPES).map(([key, value]) => (
                                            <div
                                                key={key}
                                                className={`card ${newRequest.tipo === key ? 'selected' : ''}`}
                                                style={{
                                                    cursor: 'pointer',
                                                    padding: 'var(--space-3)',
                                                    border: newRequest.tipo === key ? '2px solid var(--primary-500)' : '1px solid var(--neutral-200)',
                                                    background: newRequest.tipo === key ? 'var(--primary-50)' : 'white',
                                                }}
                                                onClick={() => setNewRequest({ ...newRequest, tipo: key, titulo: '' })}
                                            >
                                                <div className="flex items-center gap-2">
                                                    <span style={{ fontSize: '1.2rem' }}>{value.icon}</span>
                                                    <span className="text-sm font-medium">{value.label}</span>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                {/* Step 2: Details */}
                                <div className="grid grid-cols-2 gap-4 mb-6">
                                    <div>
                                        <label className="label">Título (opcional)</label>
                                        <input
                                            type="text"
                                            className="input"
                                            placeholder={REQUEST_TYPES[newRequest.tipo].label}
                                            value={newRequest.titulo}
                                            onChange={(e) => setNewRequest({ ...newRequest, titulo: e.target.value })}
                                        />
                                    </div>
                                    <div>
                                        <label className="label">Fecha Límite (opcional)</label>
                                        <input
                                            type="date"
                                            className="input"
                                            value={newRequest.fechaLimite}
                                            onChange={(e) => setNewRequest({ ...newRequest, fechaLimite: e.target.value })}
                                        />
                                    </div>
                                </div>

                                <div className="mb-6">
                                    <label className="label">Descripción (opcional)</label>
                                    <textarea
                                        className="input"
                                        rows={2}
                                        placeholder="Descripción de la solicitud..."
                                        value={newRequest.descripcion}
                                        onChange={(e) => setNewRequest({ ...newRequest, descripcion: e.target.value })}
                                    />
                                </div>

                                {/* Step 3: Documents */}
                                <div className="mb-6">
                                    <label className="label">
                                        Documentos Adjuntos
                                        {REQUEST_TYPES[newRequest.tipo].requiresDoc && (
                                            <span style={{ color: 'var(--error-500)' }}> *</span>
                                        )}
                                    </label>
                                    <input
                                        ref={fileInputRef}
                                        type="file"
                                        multiple
                                        accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png"
                                        onChange={handleFileUpload}
                                        style={{ display: 'none' }}
                                    />
                                    <div
                                        className="upload-zone"
                                        style={{
                                            border: '2px dashed var(--neutral-300)',
                                            borderRadius: 'var(--radius-lg)',
                                            padding: 'var(--space-6)',
                                            textAlign: 'center',
                                            cursor: 'pointer',
                                            background: 'var(--neutral-50)',
                                        }}
                                        onClick={() => fileInputRef.current?.click()}
                                    >
                                        {uploading ? (
                                            <div className="spinner" />
                                        ) : (
                                            <>
                                                <FiUpload size={32} style={{ color: 'var(--neutral-400)', marginBottom: '8px' }} />
                                                <p className="text-muted">Click para subir archivos</p>
                                                <p className="text-xs text-muted">PDF, Word, Excel, Imágenes (máx 10MB)</p>
                                            </>
                                        )}
                                    </div>
                                    {uploadedDocs.length > 0 && (
                                        <div className="flex gap-2 flex-wrap mt-3">
                                            {uploadedDocs.map((doc, idx) => (
                                                <div key={idx} className="badge" style={{ background: 'var(--success-100)', color: 'var(--success-700)' }}>
                                                    <FiFile size={14} /> {doc.nombre}
                                                    <button
                                                        type="button"
                                                        onClick={() => removeDocument(idx)}
                                                        style={{ marginLeft: '4px', cursor: 'pointer', background: 'none', border: 'none', color: 'inherit' }}
                                                    >
                                                        <FiX size={14} />
                                                    </button>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>

                                {/* Step 4: Select Workers */}
                                <div>
                                    <div className="flex items-center justify-between mb-2">
                                        <label className="label" style={{ marginBottom: 0 }}>
                                            Trabajadores a Firmar <span style={{ color: 'var(--error-500)' }}>*</span>
                                        </label>
                                        <button
                                            type="button"
                                            className="btn btn-ghost btn-sm"
                                            onClick={selectAllWorkers}
                                        >
                                            {selectedWorkers.length === workers.length ? 'Deseleccionar todos' : 'Seleccionar todos'}
                                        </button>
                                    </div>
                                    <div
                                        className="grid grid-cols-2 gap-2"
                                        style={{ maxHeight: '200px', overflowY: 'auto', padding: 'var(--space-2)', background: 'var(--neutral-50)', borderRadius: 'var(--radius-md)' }}
                                    >
                                        {workers.map((worker) => (
                                            <label
                                                key={worker.workerId}
                                                className="flex items-center gap-2 p-2 rounded cursor-pointer"
                                                style={{
                                                    background: selectedWorkers.includes(worker.workerId) ? 'var(--primary-50)' : 'white',
                                                    border: selectedWorkers.includes(worker.workerId) ? '1px solid var(--primary-300)' : '1px solid var(--neutral-200)',
                                                }}
                                            >
                                                <input
                                                    type="checkbox"
                                                    checked={selectedWorkers.includes(worker.workerId)}
                                                    onChange={() => toggleWorkerSelection(worker.workerId)}
                                                />
                                                <div className="flex-1">
                                                    <div className="text-sm font-medium flex items-center gap-2">
                                                        {worker.nombre} {worker.apellido}
                                                        {(worker as any).rol && (
                                                            <span className="badge" style={{ fontSize: '10px', padding: '1px 6px', background: (worker as any).rol === 'prevencionista' ? 'var(--primary-100)' : 'var(--info-100)', color: (worker as any).rol === 'prevencionista' ? 'var(--primary-600)' : 'var(--info-600)' }}>
                                                                {(worker as any).rol}
                                                            </span>
                                                        )}
                                                    </div>
                                                    <div className="text-xs text-muted">
                                                        {worker.cargo} • {worker.rut}
                                                        {!worker.habilitado && <span style={{ color: 'var(--warning-500)', marginLeft: '4px' }}>⚠️ Sin enrolar</span>}
                                                    </div>
                                                </div>
                                            </label>
                                        ))}
                                    </div>
                                    {workers.filter(w => !w.habilitado).length > 0 && (
                                        <p className="text-xs text-muted mt-2">
                                            ⚠️ {workers.filter(w => !w.habilitado).length} persona(s) sin enrolar - pueden ser asignadas pero no podrán firmar hasta completar enrolamiento
                                        </p>
                                    )}
                                    <p className="text-sm mt-2" style={{ color: 'var(--primary-600)' }}>
                                        {selectedWorkers.length} persona(s) seleccionada(s)
                                    </p>
                                </div>
                            </div>

                            <div className="modal-footer">
                                <button type="button" className="btn btn-secondary" onClick={() => { resetForm(); setShowModal(false); }}>
                                    Cancelar
                                </button>
                                <button
                                    type="submit"
                                    className="btn btn-primary"
                                    disabled={submitting || selectedWorkers.length === 0 || (REQUEST_TYPES[newRequest.tipo].requiresDoc && uploadedDocs.length === 0)}
                                >
                                    {submitting ? <div className="spinner" /> : <FiCheck />}
                                    Crear Solicitud
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </>
    );
}
