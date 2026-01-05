import { useEffect, useState, useCallback } from 'react';
import { FiWifiOff, FiCloud, FiAlertCircle, FiCheck, FiX } from 'react-icons/fi';
import { useOfflineSync } from '../hooks/useOfflineSync';

/**
 * Banner que muestra el estado offline y firmas pendientes de sincronizar
 * Se muestra en la parte superior de la aplicación
 */
export default function OfflineBanner() {
    const {
        pendingCount,
        totalPendingSignatures,
        isSyncing,
        syncAll,
        isOnline,
        lastSyncTime,
        syncError,
    } = useOfflineSync();

    const [dismissed, setDismissed] = useState(false);
    const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

    // Track previous pending count to detect sync completion
    const [prevPendingCount, setPrevPendingCount] = useState(pendingCount);

    // Detect sync completion and show toast
    useEffect(() => {
        if (prevPendingCount > 0 && pendingCount === 0 && isOnline && lastSyncTime) {
            // Sync completed successfully
            setToast({
                type: 'success',
                message: `✅ ${prevPendingCount} solicitud${prevPendingCount !== 1 ? 'es' : ''} sincronizada${prevPendingCount !== 1 ? 's' : ''} correctamente`,
            });
        } else if (syncError) {
            setToast({
                type: 'error',
                message: `❌ ${syncError}`,
            });
        }
        setPrevPendingCount(pendingCount);
    }, [pendingCount, isOnline, lastSyncTime, syncError, prevPendingCount]);

    // Auto-dismiss toast after 5 seconds
    useEffect(() => {
        if (toast) {
            const timer = setTimeout(() => setToast(null), 5000);
            return () => clearTimeout(timer);
        }
    }, [toast]);

    // Reset dismiss when status changes
    useEffect(() => {
        if (!isOnline || pendingCount > 0) {
            setDismissed(false);
        }
    }, [isOnline, pendingCount]);

    const handleSync = useCallback(async () => {
        await syncAll();
    }, [syncAll]);

    return (
        <>
            {/* Toast notification */}
            {toast && (
                <div
                    style={{
                        position: 'fixed',
                        bottom: 'var(--space-6)',
                        right: 'var(--space-6)',
                        background: toast.type === 'success'
                            ? 'linear-gradient(135deg, var(--success-500), var(--success-600))'
                            : 'linear-gradient(135deg, var(--danger-500), var(--danger-600))',
                        color: 'white',
                        padding: 'var(--space-4) var(--space-5)',
                        borderRadius: 'var(--radius-lg)',
                        boxShadow: '0 10px 40px rgba(0,0,0,0.3)',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 'var(--space-3)',
                        zIndex: 9999999,
                        animation: 'slideInRight 0.3s ease-out',
                        maxWidth: '400px',
                    }}
                >
                    {toast.type === 'success' ? <FiCheck size={20} /> : <FiX size={20} />}
                    <span style={{ fontWeight: 500 }}>{toast.message}</span>
                    <button
                        onClick={() => setToast(null)}
                        style={{
                            background: 'rgba(255,255,255,0.2)',
                            border: 'none',
                            borderRadius: 'var(--radius-sm)',
                            color: 'white',
                            padding: 'var(--space-1)',
                            cursor: 'pointer',
                            display: 'flex',
                            marginLeft: 'var(--space-2)',
                        }}
                    >
                        <FiX size={14} />
                    </button>
                </div>
            )}

            {/* Offline/Pending banner */}
            {!dismissed && (!isOnline || pendingCount > 0) && (
                <div
                    style={{
                        background: isOnline
                            ? 'linear-gradient(90deg, var(--warning-500), var(--warning-600))'
                            : 'linear-gradient(90deg, var(--error-500), var(--error-600))',
                        color: 'white',
                        padding: 'var(--space-2) var(--space-4)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 'var(--space-3)',
                        fontSize: 'var(--text-sm)',
                        position: 'sticky',
                        top: 0,
                        zIndex: 1000,
                    }}
                >
                    {!isOnline ? (
                        <>
                            <FiWifiOff size={16} />
                            <span>
                                <strong>Sin conexión.</strong> Las firmas se guardarán localmente y se sincronizarán al reconectar.
                            </span>
                        </>
                    ) : pendingCount > 0 ? (
                        <>
                            <FiAlertCircle size={16} />
                            <span>
                                <strong>{pendingCount}</strong> solicitud{pendingCount !== 1 ? 'es' : ''} con{' '}
                                <strong>{totalPendingSignatures}</strong> firma{totalPendingSignatures !== 1 ? 's' : ''} pendiente{totalPendingSignatures !== 1 ? 's' : ''} de sincronizar
                            </span>
                            <button
                                onClick={handleSync}
                                disabled={isSyncing}
                                style={{
                                    background: 'rgba(255,255,255,0.2)',
                                    border: 'none',
                                    color: 'white',
                                    padding: 'var(--space-1) var(--space-3)',
                                    borderRadius: 'var(--radius-md)',
                                    cursor: 'pointer',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 'var(--space-1)',
                                    fontSize: 'var(--text-sm)',
                                }}
                            >
                                <FiCloud className={isSyncing ? 'spin' : ''} size={14} />
                                {isSyncing ? 'Sincronizando...' : 'Sincronizar'}
                            </button>
                        </>
                    ) : null}
                </div>
            )}

            <style>{`
                @keyframes slideInRight {
                    from {
                        opacity: 0;
                        transform: translateX(100px);
                    }
                    to {
                        opacity: 1;
                        transform: translateX(0);
                    }
                }
            `}</style>
        </>
    );
}
