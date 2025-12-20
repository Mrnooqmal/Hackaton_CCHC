import { useEffect, useState } from 'react';
import { FiWifiOff, FiCloud, FiAlertCircle } from 'react-icons/fi';
import { useOfflineSync } from '../hooks/useOfflineSync';
import { Link } from 'react-router-dom';

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
    } = useOfflineSync();

    const [dismissed, setDismissed] = useState(false);

    // Resetear dismiss cuando cambia el estado
    useEffect(() => {
        if (!isOnline || pendingCount > 0) {
            setDismissed(false);
        }
    }, [isOnline, pendingCount]);

    // No mostrar si está dismisseado o si está online sin pendientes
    if (dismissed || (isOnline && pendingCount === 0)) {
        return null;
    }

    return (
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
                        <strong>Sin conexión.</strong> Las firmas se guardarán localmente.
                    </span>
                    <Link 
                        to="/offline-signatures"
                        style={{ 
                            color: 'white', 
                            textDecoration: 'underline',
                            marginLeft: 'var(--space-2)',
                        }}
                    >
                        Ir a Firmas Offline
                    </Link>
                </>
            ) : pendingCount > 0 ? (
                <>
                    <FiAlertCircle size={16} />
                    <span>
                        <strong>{pendingCount}</strong> solicitud{pendingCount !== 1 ? 'es' : ''} con{' '}
                        <strong>{totalPendingSignatures}</strong> firma{totalPendingSignatures !== 1 ? 's' : ''} pendiente{totalPendingSignatures !== 1 ? 's' : ''} de sincronizar
                    </span>
                    <button
                        onClick={syncAll}
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
    );
}
