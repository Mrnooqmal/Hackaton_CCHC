import { useState, useEffect } from 'react';
import Header from '../components/Header';
import {
    FiWifiOff,
    FiWifi,
    FiPlus,
    FiUsers,
    FiCheck,
    FiX,
    FiClock,
    FiTrash2,
    FiEdit3,
    FiCloudOff,
    FiCloud,
    FiAlertCircle,
    FiCheckCircle,
    FiUser,
    FiHash,
} from 'react-icons/fi';
import { offlineStore } from '../services/offlineStore';
import type { OfflineRequest } from '../services/offlineStore';
import { useOfflineSync } from '../hooks/useOfflineSync';
import { useAuth } from '../context/AuthContext';
import { REQUEST_TYPES } from '../api/client';
import ConfirmModal from '../components/ConfirmModal';

type ViewMode = 'list' | 'create' | 'collect';

export default function OfflineSignatures() {
    const { user } = useAuth();
    const {
        pendingRequests,
        pendingCount,
        totalPendingSignatures,
        isSyncing,
        lastSyncTime,
        syncError,
        syncAll,
        refreshPending,
        isOnline,
    } = useOfflineSync();

    const [viewMode, setViewMode] = useState<ViewMode>('list');
    const [activeRequest, setActiveRequest] = useState<OfflineRequest | null>(null);

    // Form para nueva solicitud
    const [newRequest, setNewRequest] = useState({
        tipo: 'CHARLA_5MIN',
        titulo: '',
        descripcion: '',
        ubicacion: '',
    });

    // Form para recolectar firma
    const [signatureForm, setSignatureForm] = useState({
        rut: '',
        nombre: '',
        pin: '',
    });
    const [signatureError, setSignatureError] = useState('');
    const [signatureSuccess, setSignatureSuccess] = useState(false);
    const [confirmAction, setConfirmAction] = useState<{
        isOpen: boolean;
        title: string;
        message: string;
        onConfirm: () => void;
        variant: 'danger' | 'warning' | 'primary';
    }>({
        isOpen: false,
        title: '',
        message: '',
        onConfirm: () => { },
        variant: 'primary'
    });

    useEffect(() => {
        refreshPending();
    }, [refreshPending]);

    const handleCreateRequest = async () => {
        if (!newRequest.titulo.trim()) {
            alert('El título es requerido');
            return;
        }

        try {
            const request = await offlineStore.createOfflineRequest({
                tipo: newRequest.tipo,
                titulo: newRequest.titulo || REQUEST_TYPES[newRequest.tipo]?.label || 'Solicitud Offline',
                descripcion: newRequest.descripcion,
                ubicacion: newRequest.ubicacion,
                solicitanteId: user?.userId || 'unknown',
                solicitanteNombre: user ? `${user.nombre} ${user.apellido || ''}`.trim() : 'Usuario Offline',
                firmas: [],
            });

            setActiveRequest(request);
            setViewMode('collect');
            setNewRequest({ tipo: 'CHARLA_5MIN', titulo: '', descripcion: '', ubicacion: '' });
            await refreshPending();
        } catch (error) {
            console.error('Error creating offline request:', error);
            alert('Error al crear la solicitud');
        }
    };

    const formatRut = (value: string): string => {
        // Eliminar todo excepto números y k/K
        let rut = value.replace(/[^0-9kK]/g, '').toUpperCase();

        if (rut.length > 1) {
            const dv = rut.slice(-1);
            let body = rut.slice(0, -1);

            // Formatear con puntos
            body = body.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
            rut = `${body}-${dv}`;
        }

        return rut;
    };

    const handleRutChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const formatted = formatRut(e.target.value);
        setSignatureForm(prev => ({ ...prev, rut: formatted }));
    };

    const handleAddSignature = async () => {
        if (!activeRequest) return;

        setSignatureError('');
        setSignatureSuccess(false);

        // Validar RUT
        if (!signatureForm.rut || signatureForm.rut.length < 9) {
            setSignatureError('Ingrese un RUT válido');
            return;
        }

        // Validar PIN
        if (signatureForm.pin.length !== 4) {
            setSignatureError('El PIN debe ser de 4 dígitos');
            return;
        }

        // Verificar que no haya firmado ya
        const alreadySigned = activeRequest.firmas.some(
            f => f.rut.replace(/[.-]/g, '') === signatureForm.rut.replace(/[.-]/g, '')
        );
        if (alreadySigned) {
            setSignatureError('Este trabajador ya firmó esta solicitud');
            return;
        }

        try {
            await offlineStore.addSignatureToRequest(activeRequest.id, {
                rut: signatureForm.rut,
                nombre: signatureForm.nombre,
                pin: signatureForm.pin, // En producción, esto debería hashearse
                validated: false,
            });

            // Refrescar la solicitud activa
            const updated = await offlineStore.getOfflineRequest(activeRequest.id);
            if (updated) {
                setActiveRequest(updated);
            }

            setSignatureForm({ rut: '', nombre: '', pin: '' });
            setSignatureSuccess(true);
            setTimeout(() => setSignatureSuccess(false), 2000);
            await refreshPending();
        } catch (error) {
            console.error('Error adding signature:', error);
            setSignatureError('Error al agregar la firma');
        }
    };

    const handleRemoveSignature = async (signatureId: string) => {
        if (!activeRequest) return;

        setConfirmAction({
            isOpen: true,
            title: '¿Eliminar firma?',
            message: 'Esta firma será eliminada permanentemente de la solicitud offline actual.',
            variant: 'danger',
            onConfirm: async () => {
                try {
                    await offlineStore.removeSignatureFromRequest(activeRequest.id, signatureId);
                    const updated = await offlineStore.getOfflineRequest(activeRequest.id);
                    if (updated) {
                        setActiveRequest(updated);
                    }
                    await refreshPending();
                } catch (error) {
                    console.error('Error removing signature:', error);
                }
                setConfirmAction(prev => ({ ...prev, isOpen: false }));
            }
        });
    };

    const handleDeleteRequest = async (requestId: string) => {
        setConfirmAction({
            isOpen: true,
            title: '¿Eliminar solicitud offline?',
            message: 'Esta acción eliminará la solicitud y todas sus firmas guardadas localmente. No se puede deshacer.',
            variant: 'danger',
            onConfirm: async () => {
                try {
                    await offlineStore.deleteOfflineRequest(requestId);
                    if (activeRequest?.id === requestId) {
                        setActiveRequest(null);
                        setViewMode('list');
                    }
                    await refreshPending();
                } catch (error) {
                    console.error('Error deleting request:', error);
                }
                setConfirmAction(prev => ({ ...prev, isOpen: false }));
            }
        });
    };

    const openRequestForCollection = async (request: OfflineRequest) => {
        setActiveRequest(request);
        setViewMode('collect');
    };

    const getStatusColor = (status: OfflineRequest['syncStatus']) => {
        switch (status) {
            case 'pending': return 'var(--warning-500)';
            case 'syncing': return 'var(--info-500)';
            case 'synced': return 'var(--success-500)';
            case 'error': return 'var(--error-500)';
            default: return 'var(--neutral-500)';
        }
    };

    const getStatusLabel = (status: OfflineRequest['syncStatus']) => {
        switch (status) {
            case 'pending': return 'Pendiente';
            case 'syncing': return 'Sincronizando...';
            case 'synced': return 'Sincronizado';
            case 'error': return 'Error';
            default: return status;
        }
    };

    return (
        <>
            <Header title="Firmas Offline" />

            <div className="page-content">
                {/* Status Banner */}
                <div
                    className="card mb-6"
                    style={{
                        background: isOnline
                            ? 'linear-gradient(135deg, rgba(76, 175, 80, 0.15), rgba(76, 175, 80, 0.05))'
                            : 'linear-gradient(135deg, rgba(255, 152, 0, 0.15), rgba(255, 152, 0, 0.05))',
                        border: `1px solid ${isOnline ? 'var(--success-300)' : 'var(--warning-300)'}`,
                    }}
                >
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-4">
                            <div
                                className="avatar"
                                style={{
                                    background: isOnline ? 'var(--success-500)' : 'var(--warning-500)',
                                    width: 48,
                                    height: 48,
                                }}
                            >
                                {isOnline ? <FiWifi size={24} /> : <FiWifiOff size={24} />}
                            </div>
                            <div>
                                <h3 className="font-bold" style={{ margin: 0 }}>
                                    {isOnline ? 'Conectado' : 'Sin Conexión'}
                                </h3>
                                <p className="text-sm text-muted" style={{ margin: 0 }}>
                                    {isOnline
                                        ? 'Las firmas se sincronizarán automáticamente'
                                        : 'Las firmas se guardarán localmente hasta tener conexión'
                                    }
                                </p>
                            </div>
                        </div>
                        <div className="flex items-center gap-3">
                            {pendingCount > 0 && (
                                <div className="text-center">
                                    <div
                                        className="badge"
                                        style={{
                                            background: 'var(--warning-500)',
                                            color: 'white',
                                            fontSize: 'var(--text-lg)',
                                            padding: 'var(--space-2) var(--space-4)',
                                        }}
                                    >
                                        {pendingCount} solicitud{pendingCount !== 1 ? 'es' : ''} • {totalPendingSignatures} firma{totalPendingSignatures !== 1 ? 's' : ''}
                                    </div>
                                    <div className="text-xs text-muted mt-1">pendientes de sincronizar</div>
                                </div>
                            )}
                            {isOnline && pendingCount > 0 && (
                                <button
                                    className="btn btn-primary"
                                    onClick={syncAll}
                                    disabled={isSyncing}
                                >
                                    <FiCloud className={isSyncing ? 'spin' : ''} />
                                    {isSyncing ? 'Sincronizando...' : 'Sincronizar Ahora'}
                                </button>
                            )}
                        </div>
                    </div>
                    {syncError && (
                        <div
                            className="mt-3 p-3"
                            style={{
                                background: 'rgba(244, 67, 54, 0.1)',
                                borderRadius: 'var(--radius-md)',
                                color: 'var(--error-600)',
                            }}
                        >
                            <FiAlertCircle className="inline mr-2" />
                            {syncError}
                        </div>
                    )}
                    {lastSyncTime && (
                        <div className="text-xs text-muted mt-2">
                            Última sincronización: {lastSyncTime.toLocaleString('es-CL')}
                        </div>
                    )}
                </div>

                {/* View Mode: List */}
                {viewMode === 'list' && (
                    <>
                        {/* Actions */}
                        <div className="card mb-6">
                            <div className="flex items-center justify-between">
                                <div>
                                    <h2 className="card-title">Solicitudes Offline</h2>
                                    <p className="card-subtitle">Recolecta firmas sin necesidad de conexión a internet</p>
                                </div>
                                <button
                                    className="btn btn-primary"
                                    onClick={() => setViewMode('create')}
                                    style={{ boxShadow: 'var(--shadow-glow-primary)' }}
                                >
                                    <FiPlus size={18} />
                                    Nueva Solicitud Offline
                                </button>
                            </div>
                        </div>

                        {/* Requests List */}
                        <div className="card">
                            {pendingRequests.length === 0 ? (
                                <div className="empty-state" style={{ padding: 'var(--space-10)' }}>
                                    <div className="empty-state-icon" style={{ fontSize: '3rem' }}>
                                        <FiCloudOff />
                                    </div>
                                    <h3 className="empty-state-title">Sin solicitudes offline</h3>
                                    <p className="empty-state-description">
                                        Crea una nueva solicitud para recolectar firmas sin conexión.
                                    </p>
                                    <button className="btn btn-primary" onClick={() => setViewMode('create')}>
                                        <FiPlus />
                                        Nueva Solicitud
                                    </button>
                                </div>
                            ) : (
                                <div className="flex flex-col gap-3">
                                    {pendingRequests.map((request) => (
                                        <div
                                            key={request.id}
                                            className="p-4"
                                            style={{
                                                background: 'var(--surface-elevated)',
                                                borderRadius: 'var(--radius-lg)',
                                                border: '1px solid var(--surface-border)',
                                            }}
                                        >
                                            <div className="flex items-center justify-between">
                                                <div className="flex items-center gap-4">
                                                    <div
                                                        className="avatar"
                                                        style={{ fontSize: '1.5rem', background: 'var(--surface-card)' }}
                                                    >
                                                        {REQUEST_TYPES[request.tipo]?.icon || '📝'}
                                                    </div>
                                                    <div>
                                                        <div className="flex items-center gap-2 mb-1">
                                                            <h3 className="font-bold" style={{ margin: 0 }}>
                                                                {request.titulo}
                                                            </h3>
                                                            <span
                                                                className="badge"
                                                                style={{
                                                                    background: getStatusColor(request.syncStatus),
                                                                    color: 'white',
                                                                }}
                                                            >
                                                                {getStatusLabel(request.syncStatus)}
                                                            </span>
                                                        </div>
                                                        <div className="flex items-center gap-3 text-sm text-muted">
                                                            <span>{REQUEST_TYPES[request.tipo]?.label}</span>
                                                            <span>•</span>
                                                            <span>
                                                                <FiUsers className="inline mr-1" />
                                                                {request.firmas.length} firma{request.firmas.length !== 1 ? 's' : ''}
                                                            </span>
                                                            <span>•</span>
                                                            <span>
                                                                <FiClock className="inline mr-1" />
                                                                {new Date(request.fechaCreacion).toLocaleString('es-CL', {
                                                                    day: '2-digit',
                                                                    month: 'short',
                                                                    hour: '2-digit',
                                                                    minute: '2-digit',
                                                                })}
                                                            </span>
                                                        </div>
                                                        {request.syncError && (
                                                            <div className="text-xs mt-1" style={{ color: 'var(--error-500)' }}>
                                                                Error: {request.syncError}
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    {request.syncStatus !== 'synced' && (
                                                        <button
                                                            className="btn btn-secondary"
                                                            onClick={() => openRequestForCollection(request)}
                                                        >
                                                            <FiEdit3 size={16} />
                                                            {request.firmas.length === 0 ? 'Recolectar Firmas' : 'Continuar'}
                                                        </button>
                                                    )}
                                                    {request.syncStatus !== 'syncing' && (
                                                        <button
                                                            className="btn btn-ghost"
                                                            onClick={() => handleDeleteRequest(request.id)}
                                                            style={{ color: 'var(--error-500)' }}
                                                        >
                                                            <FiTrash2 size={16} />
                                                        </button>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </>
                )}

                {/* View Mode: Create */}
                {viewMode === 'create' && (
                    <div className="card">
                        <div className="card-header">
                            <div>
                                <h2 className="card-title">Nueva Solicitud Offline</h2>
                                <p className="card-subtitle">Configura los detalles de la solicitud</p>
                            </div>
                            <button
                                className="btn btn-ghost"
                                onClick={() => setViewMode('list')}
                            >
                                <FiX /> Cancelar
                            </button>
                        </div>

                        <div className="flex flex-col gap-4">
                            <div>
                                <label className="form-label">Tipo de Solicitud *</label>
                                <select
                                    className="form-input"
                                    value={newRequest.tipo}
                                    onChange={(e) => setNewRequest(prev => ({
                                        ...prev,
                                        tipo: e.target.value,
                                        titulo: prev.titulo || REQUEST_TYPES[e.target.value]?.label || '',
                                    }))}
                                >
                                    {Object.entries(REQUEST_TYPES).map(([key, value]) => (
                                        <option key={key} value={key}>
                                            {value.icon} {value.label}
                                        </option>
                                    ))}
                                </select>
                            </div>

                            <div>
                                <label className="form-label">Título *</label>
                                <input
                                    type="text"
                                    className="form-input"
                                    placeholder="Ej: Charla de seguridad - Trabajo en altura"
                                    value={newRequest.titulo}
                                    onChange={(e) => setNewRequest(prev => ({ ...prev, titulo: e.target.value }))}
                                />
                            </div>

                            <div>
                                <label className="form-label">Descripción</label>
                                <textarea
                                    className="form-input"
                                    rows={3}
                                    placeholder="Descripción opcional de la actividad..."
                                    value={newRequest.descripcion}
                                    onChange={(e) => setNewRequest(prev => ({ ...prev, descripcion: e.target.value }))}
                                />
                            </div>

                            <div>
                                <label className="form-label">Ubicación</label>
                                <input
                                    type="text"
                                    className="form-input"
                                    placeholder="Ej: Sector A, Piso 3"
                                    value={newRequest.ubicacion}
                                    onChange={(e) => setNewRequest(prev => ({ ...prev, ubicacion: e.target.value }))}
                                />
                            </div>

                            <div className="flex gap-3 mt-4">
                                <button
                                    className="btn btn-primary"
                                    onClick={handleCreateRequest}
                                    style={{ flex: 1 }}
                                >
                                    <FiCheck /> Crear y Recolectar Firmas
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {/* View Mode: Collect Signatures */}
                {viewMode === 'collect' && activeRequest && (
                    <div className="grid gap-6" style={{ gridTemplateColumns: '1fr 400px' }}>
                        {/* Formulario de firma */}
                        <div className="card">
                            <div className="card-header">
                                <div>
                                    <div className="flex items-center gap-2 mb-1">
                                        <span style={{ fontSize: '1.5rem' }}>
                                            {REQUEST_TYPES[activeRequest.tipo]?.icon}
                                        </span>
                                        <h2 className="card-title">{activeRequest.titulo}</h2>
                                    </div>
                                    <p className="card-subtitle">
                                        Recolectando firmas • {activeRequest.firmas.length} firma{activeRequest.firmas.length !== 1 ? 's' : ''} registrada{activeRequest.firmas.length !== 1 ? 's' : ''}
                                    </p>
                                </div>
                                <button
                                    className="btn btn-secondary"
                                    onClick={() => { setViewMode('list'); setActiveRequest(null); }}
                                >
                                    <FiCheck /> Finalizar
                                </button>
                            </div>

                            {/* Área de firma */}
                            <div
                                className="p-6"
                                style={{
                                    background: 'linear-gradient(135deg, var(--surface-elevated), var(--surface-card))',
                                    borderRadius: 'var(--radius-xl)',
                                    border: '2px dashed var(--surface-border)',
                                }}
                            >
                                <h3 className="font-bold mb-4 text-center" style={{ fontSize: 'var(--text-lg)' }}>
                                    <FiUser className="inline mr-2" />
                                    Registrar Nueva Firma
                                </h3>

                                {signatureSuccess && (
                                    <div
                                        className="mb-4 p-4 text-center"
                                        style={{
                                            background: 'rgba(76, 175, 80, 0.15)',
                                            borderRadius: 'var(--radius-lg)',
                                            color: 'var(--success-600)',
                                        }}
                                    >
                                        <FiCheckCircle size={32} className="mb-2" />
                                        <div className="font-bold">¡Firma registrada exitosamente!</div>
                                    </div>
                                )}

                                {signatureError && (
                                    <div
                                        className="mb-4 p-3"
                                        style={{
                                            background: 'rgba(244, 67, 54, 0.1)',
                                            borderRadius: 'var(--radius-md)',
                                            color: 'var(--error-600)',
                                        }}
                                    >
                                        <FiAlertCircle className="inline mr-2" />
                                        {signatureError}
                                    </div>
                                )}

                                <div className="flex flex-col gap-4">
                                    <div>
                                        <label className="form-label">
                                            <FiHash className="inline mr-1" />
                                            RUT del Trabajador *
                                        </label>
                                        <input
                                            type="text"
                                            className="form-input"
                                            placeholder="12.345.678-9"
                                            value={signatureForm.rut}
                                            onChange={handleRutChange}
                                            style={{ fontSize: 'var(--text-lg)', textAlign: 'center' }}
                                            maxLength={12}
                                        />
                                    </div>

                                    <div>
                                        <label className="form-label">
                                            <FiUser className="inline mr-1" />
                                            Nombre (opcional)
                                        </label>
                                        <input
                                            type="text"
                                            className="form-input"
                                            placeholder="Nombre del trabajador"
                                            value={signatureForm.nombre}
                                            onChange={(e) => setSignatureForm(prev => ({ ...prev, nombre: e.target.value }))}
                                        />
                                    </div>

                                    <div>
                                        <label className="form-label">
                                            <FiEdit3 className="inline mr-1" />
                                            PIN de Firma (4 dígitos) *
                                        </label>
                                        <input
                                            type="password"
                                            className="form-input"
                                            placeholder="••••"
                                            value={signatureForm.pin}
                                            onChange={(e) => {
                                                const value = e.target.value.replace(/\D/g, '').slice(0, 4);
                                                setSignatureForm(prev => ({ ...prev, pin: value }));
                                            }}
                                            maxLength={4}
                                            style={{
                                                fontSize: 'var(--text-xl)',
                                                textAlign: 'center',
                                                letterSpacing: '0.5em',
                                                fontFamily: 'monospace',
                                            }}
                                        />
                                    </div>

                                    <button
                                        className="btn btn-primary btn-lg mt-4"
                                        onClick={handleAddSignature}
                                        disabled={signatureForm.rut.length < 9 || signatureForm.pin.length !== 4}
                                        style={{
                                            padding: 'var(--space-4)',
                                            fontSize: 'var(--text-lg)',
                                        }}
                                    >
                                        <FiCheck size={20} />
                                        Registrar Firma
                                    </button>
                                </div>
                            </div>
                        </div>

                        {/* Lista de firmantes */}
                        <div className="card" style={{ alignSelf: 'start' }}>
                            <div className="card-header">
                                <h3 className="card-title">
                                    <FiUsers className="inline mr-2" />
                                    Firmantes ({activeRequest.firmas.length})
                                </h3>
                            </div>

                            {activeRequest.firmas.length === 0 ? (
                                <div className="text-center p-6 text-muted">
                                    <FiUsers size={32} className="mb-2 opacity-50" />
                                    <p>Aún no hay firmas registradas</p>
                                </div>
                            ) : (
                                <div
                                    className="flex flex-col gap-2"
                                    style={{ maxHeight: '400px', overflowY: 'auto' }}
                                >
                                    {activeRequest.firmas.map((firma, index) => (
                                        <div
                                            key={firma.id}
                                            className="flex items-center justify-between p-3"
                                            style={{
                                                background: 'var(--surface-elevated)',
                                                borderRadius: 'var(--radius-md)',
                                                border: '1px solid var(--surface-border)',
                                            }}
                                        >
                                            <div className="flex items-center gap-3">
                                                <div
                                                    className="avatar avatar-sm"
                                                    style={{ background: 'var(--success-500)' }}
                                                >
                                                    {index + 1}
                                                </div>
                                                <div>
                                                    <div className="font-medium text-sm">
                                                        {firma.nombre || 'Trabajador'}
                                                    </div>
                                                    <div className="text-xs text-muted">
                                                        {firma.rut} • {new Date(firma.timestampLocal).toLocaleTimeString('es-CL', {
                                                            hour: '2-digit',
                                                            minute: '2-digit',
                                                        })}
                                                    </div>
                                                </div>
                                            </div>
                                            <button
                                                className="btn btn-ghost btn-sm"
                                                onClick={() => handleRemoveSignature(firma.id)}
                                                style={{ color: 'var(--error-500)' }}
                                            >
                                                <FiX size={14} />
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            )}

                            {activeRequest.firmas.length > 0 && (
                                <div
                                    className="mt-4 p-3"
                                    style={{
                                        background: 'var(--surface-elevated)',
                                        borderRadius: 'var(--radius-md)',
                                        textAlign: 'center',
                                    }}
                                >
                                    <div className="text-xs text-muted mb-1">Estado</div>
                                    <div
                                        className="badge"
                                        style={{
                                            background: 'var(--warning-500)',
                                            color: 'white',
                                        }}
                                    >
                                        <FiCloudOff className="inline mr-1" />
                                        Guardado localmente
                                    </div>
                                    {isOnline && (
                                        <div className="text-xs text-muted mt-2">
                                            Se sincronizará al finalizar
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </div>

            <style>{`
                .spin {
                    animation: spin 1s linear infinite;
                }
                @keyframes spin {
                    from { transform: rotate(0deg); }
                    to { transform: rotate(360deg); }
                }
            `}</style>

            <ConfirmModal
                isOpen={confirmAction.isOpen}
                title={confirmAction.title}
                message={confirmAction.message}
                variant={confirmAction.variant}
                onConfirm={confirmAction.onConfirm}
                onCancel={() => setConfirmAction(prev => ({ ...prev, isOpen: false }))}
            />
        </>
    );
}
