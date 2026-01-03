import { useState, useEffect } from 'react';
import Header from '../components/Header';
import {
    FiPlus,
    FiFileText,
    FiUsers,
    FiCheck,
    FiClock,
    FiSearch,
    FiFilter
} from 'react-icons/fi';
import { documentsApi, workersApi, type Document, type Worker } from '../api/client';

const DOCUMENT_TYPES: Record<string, { label: string; color: string }> = {
    IRL: { label: 'Informe de Riesgos Laborales', color: 'var(--info-500)' },
    POLITICA_SSO: { label: 'Política SSO', color: 'var(--primary-500)' },
    REGLAMENTO_INTERNO: { label: 'Reglamento Interno', color: 'var(--accent-500)' },
    PROCEDIMIENTO_TRABAJO: { label: 'Procedimiento de Trabajo', color: 'var(--warning-500)' },
    MATRIZ_MIPPER: { label: 'Matriz MIPPER', color: 'var(--danger-500)' },
    ENTREGA_EPP: { label: 'Entrega EPP', color: 'var(--success-500)' },
    CAPACITACION: { label: 'Capacitación', color: 'var(--info-500)' },
};

export default function Documents() {
    const [documents, setDocuments] = useState<Document[]>([]);
    const [workers, setWorkers] = useState<Worker[]>([]);
    const [loading, setLoading] = useState(true);
    const [showModal, setShowModal] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const [filterType, setFilterType] = useState('');

    const [newDoc, setNewDoc] = useState({
        tipo: '',
        titulo: '',
        descripcion: '',
    });

    useEffect(() => {
        loadData();
    }, []);

    const loadData = async () => {
        try {
            const [docsRes, workersRes] = await Promise.all([
                documentsApi.list(),
                workersApi.list()
            ]);

            if (docsRes.success && docsRes.data) {
                setDocuments(docsRes.data.documents);
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

    const handleCreateDocument = async (e: React.FormEvent) => {
        e.preventDefault();

        try {
            const response = await documentsApi.create(newDoc);
            if (response.success && response.data) {
                setDocuments([response.data, ...documents]);
                setShowModal(false);
                setNewDoc({ tipo: '', titulo: '', descripcion: '' });
            }
        } catch (error) {
            console.error('Error creating document:', error);
        }
    };

    const filteredDocuments = documents.filter((doc) => {
        const matchesSearch = doc.titulo.toLowerCase().includes(searchTerm.toLowerCase());
        const matchesType = !filterType || doc.tipo === filterType;
        return matchesSearch && matchesType;
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
            <Header title="Documentos" />

            <div className="page-content">
                <div className="page-header">
                    <div className="page-header-info">
                        <h2 className="page-header-title">
                            <FiFileText className="text-primary-500" />
                            Gestión Documental Normativa
                        </h2>
                        <p className="page-header-description">
                            Control de políticas, reglamentos, procedimientos y matrices de riesgo.
                        </p>
                    </div>
                </div>

                {/* Actions */}
                <div className="card mb-6">
                    <div className="documents-actions-bar">
                        <div className="documents-filters">
                            <div style={{ position: 'relative', flex: 1, maxWidth: '300px' }}>
                                <input
                                    type="text"
                                    placeholder="Buscar documentos..."
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                    className="form-input"
                                    style={{ paddingLeft: '40px' }}
                                />
                                <FiSearch
                                    style={{
                                        position: 'absolute',
                                        left: '12px',
                                        top: '50%',
                                        transform: 'translateY(-50%)',
                                        color: 'var(--text-muted)'
                                    }}
                                />
                            </div>

                            <div style={{ position: 'relative' }}>
                                <select
                                    value={filterType}
                                    onChange={(e) => setFilterType(e.target.value)}
                                    className="form-input form-select"
                                    style={{ paddingLeft: '40px', minWidth: '200px' }}
                                >
                                    <option value="">Todos los tipos</option>
                                    {Object.entries(DOCUMENT_TYPES).map(([key, { label }]) => (
                                        <option key={key} value={key}>{label}</option>
                                    ))}
                                </select>
                                <FiFilter
                                    style={{
                                        position: 'absolute',
                                        left: '12px',
                                        top: '50%',
                                        transform: 'translateY(-50%)',
                                        color: 'var(--text-muted)'
                                    }}
                                />
                            </div>
                        </div>

                        <button className="btn btn-primary" onClick={() => setShowModal(true)}>
                            <FiPlus />
                            Nuevo Documento
                        </button>
                    </div>
                </div>

                {/* Stats */}
                <div className="grid grid-cols-4 mb-6">
                    <div className="card">
                        <div className="flex items-center gap-3">
                            <div className="avatar" style={{ background: 'var(--primary-500)' }}>
                                <FiFileText />
                            </div>
                            <div>
                                <div className="stat-value" style={{ fontSize: 'var(--text-2xl)' }}>
                                    {documents.length}
                                </div>
                                <div className="text-sm text-muted">Total Documentos</div>
                            </div>
                        </div>
                    </div>

                    <div className="card">
                        <div className="flex items-center gap-3">
                            <div className="avatar" style={{ background: 'var(--success-500)' }}>
                                <FiCheck />
                            </div>
                            <div>
                                <div className="stat-value" style={{ fontSize: 'var(--text-2xl)' }}>
                                    {documents.filter(d => d.firmas.length > 0).length}
                                </div>
                                <div className="text-sm text-muted">Con Firmas</div>
                            </div>
                        </div>
                    </div>

                    <div className="card">
                        <div className="flex items-center gap-3">
                            <div className="avatar" style={{ background: 'var(--warning-500)' }}>
                                <FiClock />
                            </div>
                            <div>
                                <div className="stat-value" style={{ fontSize: 'var(--text-2xl)' }}>
                                    {documents.filter(d => d.asignaciones.some(a => a.estado === 'pendiente')).length}
                                </div>
                                <div className="text-sm text-muted">Pendientes</div>
                            </div>
                        </div>
                    </div>

                    <div className="card">
                        <div className="flex items-center gap-3">
                            <div className="avatar" style={{ background: 'var(--info-500)' }}>
                                <FiUsers />
                            </div>
                            <div>
                                <div className="stat-value" style={{ fontSize: 'var(--text-2xl)' }}>
                                    {workers.length}
                                </div>
                                <div className="text-sm text-muted">Trabajadores</div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Documents Grid */}
                {filteredDocuments.length === 0 ? (
                    <div className="card">
                        <div className="empty-state">
                            <div className="empty-state-icon"><FiFileText size={48} style={{ color: 'var(--text-muted)' }} /></div>
                            <h3 className="empty-state-title">Sin documentos</h3>
                            <p className="empty-state-description">
                                Crea tu primer documento para comenzar a gestionar firmas y asignaciones.
                            </p>
                            <button className="btn btn-primary" onClick={() => setShowModal(true)}>
                                <FiPlus />
                                Crear Documento
                            </button>
                        </div>
                    </div>
                ) : (
                    <div className="grid grid-cols-3">
                        {filteredDocuments.map((doc) => {
                            const typeInfo = DOCUMENT_TYPES[doc.tipo] || { label: doc.tipo, color: 'var(--gray-500)' };
                            const pendingCount = doc.asignaciones.filter(a => a.estado === 'pendiente').length;
                            const signedCount = doc.firmas.length;

                            return (
                                <div key={doc.documentId} className="card">
                                    <div className="flex items-start justify-between mb-4">
                                        <div
                                            className="avatar"
                                            style={{ background: typeInfo.color }}
                                        >
                                            <FiFileText />
                                        </div>
                                        <span className="badge badge-neutral">{typeInfo.label}</span>
                                    </div>

                                    <h3 className="font-bold mb-2">{doc.titulo}</h3>
                                    {doc.descripcion && (
                                        <p className="text-sm text-muted mb-4" style={{
                                            overflow: 'hidden',
                                            textOverflow: 'ellipsis',
                                            display: '-webkit-box',
                                            WebkitLineClamp: 2,
                                            WebkitBoxOrient: 'vertical'
                                        }}>
                                            {doc.descripcion}
                                        </p>
                                    )}

                                    <div className="flex items-center gap-4 mb-4">
                                        <div className="flex items-center gap-1">
                                            <FiCheck style={{ color: 'var(--success-500)' }} />
                                            <span className="text-sm">{signedCount} firmas</span>
                                        </div>
                                        {pendingCount > 0 && (
                                            <div className="flex items-center gap-1">
                                                <FiClock style={{ color: 'var(--warning-500)' }} />
                                                <span className="text-sm">{pendingCount} pendientes</span>
                                            </div>
                                        )}
                                    </div>

                                    <div className="flex gap-2">
                                        <button className="btn btn-secondary btn-sm" style={{ flex: 1 }}>
                                            Ver Detalles
                                        </button>
                                        <button className="btn btn-primary btn-sm" style={{ flex: 1 }}>
                                            Asignar
                                        </button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}

                {/* Create Document Modal */}
                {showModal && (
                    <div className="modal-overlay" onClick={() => setShowModal(false)}>
                        <div className="modal" onClick={(e) => e.stopPropagation()}>
                            <div className="modal-header">
                                <h2 className="modal-title">Nuevo Documento</h2>
                                <button
                                    className="btn btn-ghost btn-icon"
                                    onClick={() => setShowModal(false)}
                                >
                                    ✕
                                </button>
                            </div>

                            <form onSubmit={handleCreateDocument}>
                                <div className="modal-body">
                                    <div className="form-group">
                                        <label className="form-label">Tipo de Documento *</label>
                                        <select
                                            value={newDoc.tipo}
                                            onChange={(e) => setNewDoc({ ...newDoc, tipo: e.target.value })}
                                            className="form-input form-select"
                                            required
                                        >
                                            <option value="">Seleccione un tipo</option>
                                            {Object.entries(DOCUMENT_TYPES).map(([key, { label }]) => (
                                                <option key={key} value={key}>{label}</option>
                                            ))}
                                        </select>
                                    </div>

                                    <div className="form-group">
                                        <label className="form-label">Título *</label>
                                        <input
                                            type="text"
                                            value={newDoc.titulo}
                                            onChange={(e) => setNewDoc({ ...newDoc, titulo: e.target.value })}
                                            className="form-input"
                                            placeholder="Ej: IRL - Soldador"
                                            required
                                        />
                                    </div>

                                    <div className="form-group">
                                        <label className="form-label">Descripción</label>
                                        <textarea
                                            value={newDoc.descripcion}
                                            onChange={(e) => setNewDoc({ ...newDoc, descripcion: e.target.value })}
                                            className="form-input"
                                            rows={3}
                                            placeholder="Descripción del documento..."
                                            style={{ resize: 'vertical' }}
                                        />
                                    </div>
                                </div>

                                <div className="modal-footer">
                                    <button
                                        type="button"
                                        className="btn btn-secondary"
                                        onClick={() => setShowModal(false)}
                                    >
                                        Cancelar
                                    </button>
                                    <button type="submit" className="btn btn-primary">
                                        Crear Documento
                                    </button>
                                </div>
                            </form>
                        </div>
                    </div>
                )}
            </div>
        </>
    );
}
