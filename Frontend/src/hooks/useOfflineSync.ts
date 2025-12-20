import { useState, useEffect, useCallback, useRef } from 'react';
import { offlineStore } from '../services/offlineStore';
import type { OfflineRequest } from '../services/offlineStore';
import { useOnlineStatus } from './useOnlineStatus';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

interface SyncResult {
    requestId: string;
    success: boolean;
    serverRequestId?: string;
    error?: string;
    signatureResults?: {
        rut: string;
        success: boolean;
        error?: string;
    }[];
}

interface UseOfflineSyncReturn {
    pendingRequests: OfflineRequest[];
    pendingCount: number;
    totalPendingSignatures: number;
    isSyncing: boolean;
    lastSyncTime: Date | null;
    syncError: string | null;
    syncAll: () => Promise<SyncResult[]>;
    syncOne: (requestId: string) => Promise<SyncResult>;
    refreshPending: () => Promise<void>;
    isOnline: boolean;
}

export function useOfflineSync(): UseOfflineSyncReturn {
    const { isOnline, wasOffline, clearWasOffline } = useOnlineStatus();
    const [pendingRequests, setPendingRequests] = useState<OfflineRequest[]>([]);
    const [pendingCount, setPendingCount] = useState(0);
    const [totalPendingSignatures, setTotalPendingSignatures] = useState(0);
    const [isSyncing, setIsSyncing] = useState(false);
    const [lastSyncTime, setLastSyncTime] = useState<Date | null>(null);
    const [syncError, setSyncError] = useState<string | null>(null);
    const syncInProgress = useRef(false);

    const refreshPending = useCallback(async () => {
        try {
            const pending = await offlineStore.getPendingRequests();
            setPendingRequests(pending);
            setPendingCount(pending.length);
            setTotalPendingSignatures(pending.reduce((acc, req) => acc + req.firmas.length, 0));
        } catch (error) {
            console.error('Error refreshing pending requests:', error);
        }
    }, []);

    // Cargar datos iniciales
    useEffect(() => {
        refreshPending();
    }, [refreshPending]);

    // Sync automático cuando vuelve la conexión
    useEffect(() => {
        if (isOnline && wasOffline && pendingCount > 0 && !syncInProgress.current) {
            clearWasOffline();
            // Pequeño delay para asegurar que la conexión está estable
            const timer = setTimeout(() => {
                syncAll();
            }, 2000);
            return () => clearTimeout(timer);
        }
    }, [isOnline, wasOffline, pendingCount, clearWasOffline]);

    const syncOne = useCallback(async (requestId: string): Promise<SyncResult> => {
        const request = await offlineStore.getOfflineRequest(requestId);
        if (!request) {
            return { requestId, success: false, error: 'Solicitud no encontrada' };
        }

        if (request.firmas.length === 0) {
            return { requestId, success: false, error: 'La solicitud no tiene firmas' };
        }

        try {
            // Marcar como sincronizando
            request.syncStatus = 'syncing';
            await offlineStore.updateOfflineRequest(request);

            await offlineStore.addSyncLog({
                requestId,
                action: 'sync_start',
                message: `Iniciando sincronización de ${request.firmas.length} firmas`,
            });

            // Enviar al backend
            const response = await fetch(`${API_BASE_URL}/signature-requests/offline-batch`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    tipo: request.tipo,
                    titulo: request.titulo,
                    descripcion: request.descripcion,
                    ubicacion: request.ubicacion,
                    solicitanteId: request.solicitanteId,
                    firmasOffline: request.firmas.map(f => ({
                        rut: f.rut,
                        pin: f.pin,
                        nombre: f.nombre,
                        timestampLocal: f.timestampLocal,
                    })),
                    fechaCreacionOffline: request.fechaCreacion,
                }),
            });

            const data = await response.json();

            if (data.success) {
                request.syncStatus = 'synced';
                request.syncedAt = new Date().toISOString();
                request.serverRequestId = data.data.requestId;
                await offlineStore.updateOfflineRequest(request);

                await offlineStore.addSyncLog({
                    requestId,
                    action: 'sync_success',
                    message: `Sincronización exitosa. ${data.data.firmasValidas}/${request.firmas.length} firmas válidas`,
                    details: data.data,
                });

                return {
                    requestId,
                    success: true,
                    serverRequestId: data.data.requestId,
                    signatureResults: data.data.resultadosFirmas,
                };
            } else {
                request.syncStatus = 'error';
                request.syncError = data.error || 'Error desconocido';
                await offlineStore.updateOfflineRequest(request);

                await offlineStore.addSyncLog({
                    requestId,
                    action: 'sync_error',
                    message: data.error || 'Error desconocido',
                });

                return {
                    requestId,
                    success: false,
                    error: data.error,
                };
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Error de conexión';
            
            request.syncStatus = 'error';
            request.syncError = errorMessage;
            await offlineStore.updateOfflineRequest(request);

            await offlineStore.addSyncLog({
                requestId,
                action: 'sync_error',
                message: errorMessage,
            });

            return {
                requestId,
                success: false,
                error: errorMessage,
            };
        }
    }, []);

    const syncAll = useCallback(async (): Promise<SyncResult[]> => {
        if (syncInProgress.current || !isOnline) {
            return [];
        }

        syncInProgress.current = true;
        setIsSyncing(true);
        setSyncError(null);

        try {
            const pending = await offlineStore.getPendingRequests();
            const results: SyncResult[] = [];

            for (const request of pending) {
                const result = await syncOne(request.id);
                results.push(result);
                
                // Pequeño delay entre requests para no sobrecargar
                await new Promise(resolve => setTimeout(resolve, 500));
            }

            setLastSyncTime(new Date());
            await refreshPending();

            const failed = results.filter(r => !r.success);
            if (failed.length > 0) {
                setSyncError(`${failed.length} solicitud(es) no se pudieron sincronizar`);
            }

            return results;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Error de sincronización';
            setSyncError(errorMessage);
            return [];
        } finally {
            syncInProgress.current = false;
            setIsSyncing(false);
        }
    }, [isOnline, syncOne, refreshPending]);

    return {
        pendingRequests,
        pendingCount,
        totalPendingSignatures,
        isSyncing,
        lastSyncTime,
        syncError,
        syncAll,
        syncOne,
        refreshPending,
        isOnline,
    };
}
