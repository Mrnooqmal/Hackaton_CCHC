/**
 * useOfflineSignature - Hook para firmas con soporte offline
 * Detecta conectividad y guarda firmas localmente si no hay conexión
 */

import { useCallback, useState } from 'react';
import { useOnlineStatus } from './useOnlineStatus';
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
    surveyAnswers?: any[]; // For surveys
}

const OFFLINE_SIGNATURES_KEY = 'pendingOfflineSignatures';

// Guardar firmas pendientes en localStorage (más simple que IndexedDB para este caso)
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

export function useOfflineSignature() {
    const { isOnline, wasOffline } = useOnlineStatus();
    const [syncing, setSyncing] = useState(false);
    const [pendingCount, setPendingCount] = useState(getPendingSignatures().length);

    // Actualizar contador de pendientes
    const refreshPendingCount = useCallback(() => {
        setPendingCount(getPendingSignatures().length);
    }, []);

    // Firmar documento con fallback offline
    const signDocument = useCallback(async (
        documentId: string,
        documentTitle: string,
        workerId: string,
        workerName: string,
        pin: string
    ): Promise<{ success: boolean; offline: boolean; error?: string }> => {
        if (isOnline) {
            try {
                const response = await documentsApi.sign(documentId, {
                    workerId,
                    tipoFirma: 'trabajador',
                    pin
                });
                if (response.success) {
                    return { success: true, offline: false };
                }
                return { success: false, offline: false, error: response.error };
            } catch (error: any) {
                // Si falla por red, guardar offline
                if (!navigator.onLine || error.message?.includes('fetch') || error.message?.includes('NetworkError')) {
                    const sig: OfflinePendingSignature = {
                        id: `offline_${Date.now()}`,
                        type: 'documento',
                        targetId: documentId,
                        targetTitle: documentTitle,
                        workerId,
                        workerName,
                        pin,
                        timestamp: new Date().toISOString(),
                        synced: false
                    };
                    savePendingSignature(sig);
                    refreshPendingCount();
                    return { success: true, offline: true };
                }
                return { success: false, offline: false, error: error.message };
            }
        } else {
            // Guardar offline
            const sig: OfflinePendingSignature = {
                id: `offline_${Date.now()}`,
                type: 'documento',
                targetId: documentId,
                targetTitle: documentTitle,
                workerId,
                workerName,
                pin,
                timestamp: new Date().toISOString(),
                synced: false
            };
            savePendingSignature(sig);
            refreshPendingCount();
            return { success: true, offline: true };
        }
    }, [isOnline, refreshPendingCount]);

    // Firmar actividad (registro de asistencia) con fallback offline
    const signActivity = useCallback(async (
        activityId: string,
        activityTitle: string,
        workerId: string,
        workerName: string,
        pin: string
    ): Promise<{ success: boolean; offline: boolean; error?: string }> => {
        if (isOnline) {
            try {
                const response = await activitiesApi.registerAttendance(activityId, {
                    workerIds: [workerId],
                    incluirFirmaRelator: false,
                    pin
                });
                if (response.success) {
                    return { success: true, offline: false };
                }
                return { success: false, offline: false, error: response.error };
            } catch (error: any) {
                if (!navigator.onLine || error.message?.includes('fetch') || error.message?.includes('NetworkError')) {
                    const sig: OfflinePendingSignature = {
                        id: `offline_${Date.now()}`,
                        type: 'actividad',
                        targetId: activityId,
                        targetTitle: activityTitle,
                        workerId,
                        workerName,
                        pin,
                        timestamp: new Date().toISOString(),
                        synced: false
                    };
                    savePendingSignature(sig);
                    refreshPendingCount();
                    return { success: true, offline: true };
                }
                return { success: false, offline: false, error: error.message };
            }
        } else {
            const sig: OfflinePendingSignature = {
                id: `offline_${Date.now()}`,
                type: 'actividad',
                targetId: activityId,
                targetTitle: activityTitle,
                workerId,
                workerName,
                pin,
                timestamp: new Date().toISOString(),
                synced: false
            };
            savePendingSignature(sig);
            refreshPendingCount();
            return { success: true, offline: true };
        }
    }, [isOnline, refreshPendingCount]);

    // Responder encuesta con fallback offline
    const signSurvey = useCallback(async (
        surveyId: string,
        surveyTitle: string,
        workerId: string,
        workerName: string,
        responses: any[],
        pin: string
    ): Promise<{ success: boolean; offline: boolean; error?: string }> => {
        if (isOnline) {
            try {
                const response = await surveysApi.updateResponseStatus(surveyId, workerId, {
                    estado: 'respondida',
                    responses,
                    pin
                });
                if (response.success) {
                    return { success: true, offline: false };
                }
                return { success: false, offline: false, error: response.error };
            } catch (error: any) {
                if (!navigator.onLine || error.message?.includes('fetch') || error.message?.includes('NetworkError')) {
                    const sig: OfflinePendingSignature = {
                        id: `offline_${Date.now()}`,
                        type: 'encuesta',
                        targetId: surveyId,
                        targetTitle: surveyTitle,
                        workerId,
                        workerName,
                        pin,
                        timestamp: new Date().toISOString(),
                        synced: false,
                        surveyAnswers: responses
                    };
                    savePendingSignature(sig);
                    refreshPendingCount();
                    return { success: true, offline: true };
                }
                return { success: false, offline: false, error: error.message };
            }
        } else {
            const sig: OfflinePendingSignature = {
                id: `offline_${Date.now()}`,
                type: 'encuesta',
                targetId: surveyId,
                targetTitle: surveyTitle,
                workerId,
                workerName,
                pin,
                timestamp: new Date().toISOString(),
                synced: false,
                surveyAnswers: responses
            };
            savePendingSignature(sig);
            refreshPendingCount();
            return { success: true, offline: true };
        }
    }, [isOnline, refreshPendingCount]);

    // Sincronizar firmas pendientes cuando vuelve la conexión
    const syncPendingSignatures = useCallback(async (): Promise<{ synced: number; failed: number }> => {
        if (!isOnline) return { synced: 0, failed: 0 };

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
    }, [isOnline, refreshPendingCount]);

    return {
        isOnline,
        wasOffline,
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
