/**
 * useOfflineSignature - Hook para firmas con soporte offline
 * Detecta conectividad y guarda firmas localmente si no hay conexión
 */

import { useCallback, useState, useEffect } from 'react';
import { documentsApi, activitiesApi, surveysApi } from '../api/client';

export type SignatureType = 'documento' | 'actividad' | 'encuesta';

export interface OfflinePendingSignature {
    id: string;
    type: SignatureType;
    targetId: string;
    targetTitle: string;
    workerId: string;
    workerName: string;
    pin: string;
    timestamp: string;
    synced: boolean;
    surveyAnswers?: any[];
}

const OFFLINE_SIGNATURES_KEY = 'pendingOfflineSignatures';

// Guardar firmas pendientes en localStorage
const getPendingSignatures = (): OfflinePendingSignature[] => {
    try {
        const stored = localStorage.getItem(OFFLINE_SIGNATURES_KEY);
        return stored ? JSON.parse(stored) : [];
    } catch {
        return [];
    }
};

const savePendingSignature = (sig: OfflinePendingSignature): void => {
    const pending = getPendingSignatures();
    pending.push(sig);
    localStorage.setItem(OFFLINE_SIGNATURES_KEY, JSON.stringify(pending));
};

const removePendingSignature = (id: string): void => {
    const pending = getPendingSignatures().filter(s => s.id !== id);
    localStorage.setItem(OFFLINE_SIGNATURES_KEY, JSON.stringify(pending));
};

// Detectar si es un error de red
const isNetworkError = (error: any): boolean => {
    if (!navigator.onLine) return true;
    const message = error?.message?.toLowerCase() || '';
    return message.includes('failed to fetch') ||
        message.includes('networkerror') ||
        message.includes('network') ||
        message.includes('fetch');
};

// Detectar error de red en el mensaje de respuesta
const isNetworkErrorResponse = (errorMsg: string): boolean => {
    const msg = errorMsg?.toLowerCase() || '';
    return msg.includes('failed to fetch') ||
        msg.includes('network') ||
        msg.includes('fetch') ||
        msg.includes('err_name_not_resolved') ||
        msg.includes('err_internet_disconnected');
};

export function useOfflineSignature() {
    const [isOnline, setIsOnline] = useState(navigator.onLine);
    const [syncing, setSyncing] = useState(false);
    const [pendingCount, setPendingCount] = useState(getPendingSignatures().length);

    // Escuchar cambios de conectividad
    useEffect(() => {
        const handleOnline = () => setIsOnline(true);
        const handleOffline = () => setIsOnline(false);

        window.addEventListener('online', handleOnline);
        window.addEventListener('offline', handleOffline);

        return () => {
            window.removeEventListener('online', handleOnline);
            window.removeEventListener('offline', handleOffline);
        };
    }, []);

    // Actualizar contador de pendientes
    const refreshPendingCount = useCallback(() => {
        setPendingCount(getPendingSignatures().length);
    }, []);

    // Crear firma offline
    const createOfflineSignature = useCallback((
        type: SignatureType,
        targetId: string,
        targetTitle: string,
        workerId: string,
        workerName: string,
        pin: string,
        surveyAnswers?: any[]
    ): OfflinePendingSignature => {
        const sig: OfflinePendingSignature = {
            id: `offline_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            type,
            targetId,
            targetTitle,
            workerId,
            workerName,
            pin,
            timestamp: new Date().toISOString(),
            synced: false,
            surveyAnswers
        };
        savePendingSignature(sig);
        refreshPendingCount();
        return sig;
    }, [refreshPendingCount]);

    // Firmar documento con fallback offline
    const signDocument = useCallback(async (
        documentId: string,
        documentTitle: string,
        workerId: string,
        workerName: string,
        pin: string
    ): Promise<{ success: boolean; offline: boolean; error?: string }> => {
        if (!navigator.onLine) {
            createOfflineSignature('documento', documentId, documentTitle, workerId, workerName, pin);
            return { success: true, offline: true };
        }

        try {
            const response = await documentsApi.sign(documentId, {
                workerId,
                tipoFirma: 'trabajador',
                pin
            });

            if (response.success) {
                return { success: true, offline: false };
            }

            if (isNetworkErrorResponse(response.error || '')) {
                createOfflineSignature('documento', documentId, documentTitle, workerId, workerName, pin);
                return { success: true, offline: true };
            }

            return { success: false, offline: false, error: response.error };
        } catch (error: any) {
            if (isNetworkError(error)) {
                createOfflineSignature('documento', documentId, documentTitle, workerId, workerName, pin);
                return { success: true, offline: true };
            }
            return { success: false, offline: false, error: error.message || 'Error desconocido' };
        }
    }, [createOfflineSignature]);

    // Firmar actividad con fallback offline
    const signActivity = useCallback(async (
        activityId: string,
        activityTitle: string,
        workerId: string,
        workerName: string,
        pin: string
    ): Promise<{ success: boolean; offline: boolean; error?: string }> => {
        if (!navigator.onLine) {
            createOfflineSignature('actividad', activityId, activityTitle, workerId, workerName, pin);
            return { success: true, offline: true };
        }

        try {
            const response = await activitiesApi.registerAttendance(activityId, {
                workerIds: [workerId],
                incluirFirmaRelator: false,
                pin
            });

            if (response.success) {
                return { success: true, offline: false };
            }

            if (isNetworkErrorResponse(response.error || '')) {
                createOfflineSignature('actividad', activityId, activityTitle, workerId, workerName, pin);
                return { success: true, offline: true };
            }

            return { success: false, offline: false, error: response.error };
        } catch (error: any) {
            if (isNetworkError(error)) {
                createOfflineSignature('actividad', activityId, activityTitle, workerId, workerName, pin);
                return { success: true, offline: true };
            }
            return { success: false, offline: false, error: error.message || 'Error desconocido' };
        }
    }, [createOfflineSignature]);

    // Responder encuesta con fallback offline
    const signSurvey = useCallback(async (
        surveyId: string,
        surveyTitle: string,
        workerId: string,
        workerName: string,
        responses: any[],
        pin: string
    ): Promise<{ success: boolean; offline: boolean; error?: string }> => {
        if (!navigator.onLine) {
            createOfflineSignature('encuesta', surveyId, surveyTitle, workerId, workerName, pin, responses);
            return { success: true, offline: true };
        }

        try {
            const response = await surveysApi.updateResponseStatus(surveyId, workerId, {
                estado: 'respondida',
                responses,
                pin
            });

            if (response.success) {
                return { success: true, offline: false };
            }

            if (isNetworkErrorResponse(response.error || '')) {
                createOfflineSignature('encuesta', surveyId, surveyTitle, workerId, workerName, pin, responses);
                return { success: true, offline: true };
            }

            return { success: false, offline: false, error: response.error };
        } catch (error: any) {
            if (isNetworkError(error)) {
                createOfflineSignature('encuesta', surveyId, surveyTitle, workerId, workerName, pin, responses);
                return { success: true, offline: true };
            }
            return { success: false, offline: false, error: error.message || 'Error desconocido' };
        }
    }, [createOfflineSignature]);

    // Sincronizar firmas pendientes cuando vuelve la conexión
    const syncPendingSignatures = useCallback(async (): Promise<{ synced: number; failed: number }> => {
        if (!navigator.onLine) return { synced: 0, failed: 0 };

        setSyncing(true);
        const pending = getPendingSignatures();
        let synced = 0;
        let failed = 0;

        for (const sig of pending) {
            try {
                let response;
                if (sig.type === 'documento') {
                    response = await documentsApi.sign(sig.targetId, {
                        workerId: sig.workerId,
                        tipoFirma: 'trabajador',
                        pin: sig.pin
                    });
                } else if (sig.type === 'actividad') {
                    response = await activitiesApi.registerAttendance(sig.targetId, {
                        workerIds: [sig.workerId],
                        incluirFirmaRelator: false,
                        pin: sig.pin
                    });
                } else if (sig.type === 'encuesta') {
                    response = await surveysApi.updateResponseStatus(sig.targetId, sig.workerId, {
                        estado: 'respondida',
                        responses: sig.surveyAnswers,
                        pin: sig.pin
                    });
                }

                if (response?.success) {
                    removePendingSignature(sig.id);
                    synced++;
                } else {
                    failed++;
                }
            } catch {
                failed++;
            }
        }

        refreshPendingCount();
        setSyncing(false);
        return { synced, failed };
    }, [refreshPendingCount]);

    return {
        isOnline,
        syncing,
        pendingCount,
        signDocument,
        signActivity,
        signSurvey,
        syncPendingSignatures,
        refreshPendingCount,
        getPendingSignatures
    };
}
