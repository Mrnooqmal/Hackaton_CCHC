/**
 * useOfflineSignature — firmas con soporte sin conexión.
 *
 * ── Qué cambió y por qué ─────────────────────────────────────────────────────
 *
 * Antes, firmar sin red guardaba el PIN del trabajador en `localStorage`, en
 * claro, hasta poder sincronizar. En un equipo compartido de terreno —el caso
 * normal— cualquiera que lo tomara leía esos PIN, y con un PIN se firma a nombre
 * de esa persona.
 *
 * Ahora el dispositivo guarda VALES: credenciales de un solo uso que el servidor
 * emite después de que la persona teclea su PIN una vez, con red, al empezar el
 * turno. El PIN no se guarda nunca. Un vale robado sirve para firmar como esa
 * persona durante su vigencia y una sola vez; un PIN robado sirve para siempre.
 *
 * Dos consecuencias que la interfaz debe hacer visibles (ver `valesDe`):
 *
 *   1. Sin vales y sin red no se puede firmar sin conexión. Por eso se piden al
 *      empezar, en bloque, y `necesitaVales` avisa mientras todavía hay red.
 *   2. Un vale vence a las 12 horas. Si la firma se sincroniza después de eso, el
 *      servidor la registra igual pero marcada para revisión: el acto ocurrió y
 *      descartarlo destruiría evidencia real, pero no cuenta como cumplimiento
 *      hasta que alguien con permiso la confirma. El resultado de la sincronización
 *      lo informa en `enRevision`.
 */

import { useCallback, useState, useEffect } from 'react';
import { documentsApi, activitiesApi, surveysApi, signaturesApi } from '../api/client';

export type SignatureType = 'documento' | 'actividad' | 'encuesta';

export interface OfflinePendingSignature {
    id: string;
    type: SignatureType;
    targetId: string;
    targetTitle: string;
    workerId: string;
    workerName: string;
    /** Vale de un solo uso. Reemplaza al PIN, que ya no se guarda. */
    vale: string;
    timestamp: string;
    synced: boolean;
    surveyAnswers?: any[];
}

interface ValesDePersona {
    personaId: string;
    vales: string[];
    expiraEn: string;
}

const OFFLINE_SIGNATURES_KEY = 'pendingOfflineSignatures';
const VALES_KEY = 'offlineVales';
const DEVICE_KEY = 'deviceId';

/**
 * Identificador del equipo. Es TRAZA, no credencial: el servidor lo guarda para
 * el acta (en qué equipo se desbloqueó el vale y en cuál se usó) y no lo exige
 * para validar. Si el navegador limpia sus datos, este id se regenera — y los
 * vales desaparecen con él, porque viven en el mismo almacenamiento: el caso real
 * no es "vale rechazado" sino "este equipo se quedó sin vales", y se resuelve
 * volviendo a pedirlos con red.
 */
const deviceId = (): string => {
    try {
        let id = localStorage.getItem(DEVICE_KEY);
        if (!id) {
            id = `dev_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
            localStorage.setItem(DEVICE_KEY, id);
        }
        return id;
    } catch {
        return 'desconocido';
    }
};

// ─── Firmas pendientes de sincronizar ────────────────────────────────────────

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

// ─── Vales disponibles en el equipo ──────────────────────────────────────────

const leerVales = (): ValesDePersona[] => {
    try {
        const stored = localStorage.getItem(VALES_KEY);
        const lista: ValesDePersona[] = stored ? JSON.parse(stored) : [];
        // Los vencidos se descartan solos: ocupan espacio y ya no sirven para una
        // firma nueva (para una ya tomada, el servidor decide; ver el encabezado).
        const ahora = Date.now();
        return lista.filter(v => new Date(v.expiraEn).getTime() > ahora && v.vales.length > 0);
    } catch {
        return [];
    }
};

const guardarVales = (lista: ValesDePersona[]): void => {
    try {
        localStorage.setItem(VALES_KEY, JSON.stringify(lista));
    } catch {
        /* almacenamiento lleno o bloqueado: se sigue sin vales */
    }
};

/** Toma un vale de la persona y lo quita del equipo (un vale, una firma). */
const tomarVale = (personaId: string): string | null => {
    const lista = leerVales();
    const entrada = lista.find(v => v.personaId === personaId);
    if (!entrada || entrada.vales.length === 0) return null;
    const vale = entrada.vales.shift() as string;
    guardarVales(lista);
    return vale;
};

const valesDisponiblesDe = (personaId: string): number =>
    leerVales().find(v => v.personaId === personaId)?.vales.length ?? 0;

// ─── Detección de errores de red ─────────────────────────────────────────────

const isNetworkError = (error: any): boolean => {
    if (!navigator.onLine) return true;
    const message = error?.message?.toLowerCase() || '';
    return message.includes('failed to fetch') ||
        message.includes('networkerror') ||
        message.includes('network') ||
        message.includes('fetch');
};

const isNetworkErrorResponse = (errorMsg: string): boolean => {
    const msg = errorMsg?.toLowerCase() || '';
    return msg.includes('failed to fetch') ||
        msg.includes('network') ||
        msg.includes('fetch') ||
        msg.includes('err_name_not_resolved') ||
        msg.includes('err_internet_disconnected');
};

/** Sin vales no hay firma sin conexión: el mensaje tiene que decir qué hacer. */
const SIN_VALES = 'No hay firma sin conexión habilitada para esta persona en este equipo. '
    + 'Con señal, pídele que ingrese su PIN para habilitarla.';

export function useOfflineSignature() {
    const [isOnline, setIsOnline] = useState(navigator.onLine);
    const [syncing, setSyncing] = useState(false);
    const [pendingCount, setPendingCount] = useState(getPendingSignatures().length);
    const [enRevision, setEnRevision] = useState(0);

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

    const refreshPendingCount = useCallback(() => {
        setPendingCount(getPendingSignatures().length);
    }, []);

    /**
     * Habilita la firma sin conexión de una persona en ESTE equipo. Es el único
     * momento en que el PIN entra al flujo, y requiere red.
     */
    const habilitarSinConexion = useCallback(async (
        personaId: string,
        pin: string,
        cantidad = 10,
    ): Promise<{ success: boolean; error?: string; expiraEn?: string }> => {
        if (!navigator.onLine) {
            return { success: false, error: 'Necesitas señal para habilitar la firma sin conexión.' };
        }
        try {
            const res = await signaturesApi.emitirVales({ personaId, pin, cantidad, deviceId: deviceId() });
            if (!res.success || !res.data) {
                return { success: false, error: res.error || 'No se pudo habilitar la firma sin conexión.' };
            }
            const lista = leerVales().filter(v => v.personaId !== personaId);
            lista.push({ personaId, vales: res.data.vales, expiraEn: res.data.expiraEn });
            guardarVales(lista);
            return { success: true, expiraEn: res.data.expiraEn };
        } catch (error: any) {
            return { success: false, error: error?.message || 'No se pudo habilitar la firma sin conexión.' };
        }
    }, []);

    /** Cuántos vales le quedan a una persona en este equipo. */
    const valesDe = useCallback((personaId: string) => valesDisponiblesDe(personaId), []);

    /** ¿Conviene pedir vales ahora que hay red? */
    const necesitaVales = useCallback(
        (personaId: string, minimo = 3) => valesDisponiblesDe(personaId) < minimo,
        [],
    );

    const createOfflineSignature = useCallback((
        type: SignatureType,
        targetId: string,
        targetTitle: string,
        workerId: string,
        workerName: string,
        surveyAnswers?: any[]
    ): OfflinePendingSignature | null => {
        const vale = tomarVale(workerId);
        if (!vale) return null;

        const sig: OfflinePendingSignature = {
            id: `offline_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            type,
            targetId,
            targetTitle,
            workerId,
            workerName,
            vale,
            timestamp: new Date().toISOString(),
            synced: false,
            surveyAnswers
        };
        savePendingSignature(sig);
        refreshPendingCount();
        return sig;
    }, [refreshPendingCount]);

    /** Guarda la firma para sincronizar, o explica por qué no se puede. */
    const guardarParaDespues = useCallback((
        type: SignatureType,
        targetId: string,
        targetTitle: string,
        workerId: string,
        workerName: string,
        surveyAnswers?: any[]
    ): { success: boolean; offline: boolean; error?: string } => {
        const sig = createOfflineSignature(type, targetId, targetTitle, workerId, workerName, surveyAnswers);
        if (!sig) return { success: false, offline: true, error: SIN_VALES };
        return { success: true, offline: true };
    }, [createOfflineSignature]);

    const signDocument = useCallback(async (
        documentId: string,
        documentTitle: string,
        workerId: string,
        workerName: string,
        pin: string
    ): Promise<{ success: boolean; offline: boolean; error?: string }> => {
        if (!navigator.onLine) {
            return guardarParaDespues('documento', documentId, documentTitle, workerId, workerName);
        }

        try {
            const response = await documentsApi.sign(documentId, {
                personaId: workerId,
                tipoFirma: 'trabajador',
                pin
            });

            if (response.success) {
                return { success: true, offline: false };
            }

            if (isNetworkErrorResponse(response.error || '')) {
                return guardarParaDespues('documento', documentId, documentTitle, workerId, workerName);
            }

            return { success: false, offline: false, error: response.error };
        } catch (error: any) {
            if (isNetworkError(error)) {
                return guardarParaDespues('documento', documentId, documentTitle, workerId, workerName);
            }
            return { success: false, offline: false, error: error.message || 'Error desconocido' };
        }
    }, [guardarParaDespues]);

    const signActivity = useCallback(async (
        activityId: string,
        activityTitle: string,
        workerId: string,
        workerName: string,
        pin: string
    ): Promise<{ success: boolean; offline: boolean; error?: string }> => {
        if (!navigator.onLine) {
            return guardarParaDespues('actividad', activityId, activityTitle, workerId, workerName);
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
                return guardarParaDespues('actividad', activityId, activityTitle, workerId, workerName);
            }

            return { success: false, offline: false, error: response.error };
        } catch (error: any) {
            if (isNetworkError(error)) {
                return guardarParaDespues('actividad', activityId, activityTitle, workerId, workerName);
            }
            return { success: false, offline: false, error: error.message || 'Error desconocido' };
        }
    }, [guardarParaDespues]);

    const signSurvey = useCallback(async (
        surveyId: string,
        surveyTitle: string,
        workerId: string,
        workerName: string,
        responses: any[],
        pin: string
    ): Promise<{ success: boolean; offline: boolean; error?: string }> => {
        if (!navigator.onLine) {
            return guardarParaDespues('encuesta', surveyId, surveyTitle, workerId, workerName, responses);
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
                return guardarParaDespues('encuesta', surveyId, surveyTitle, workerId, workerName, responses);
            }

            return { success: false, offline: false, error: response.error };
        } catch (error: any) {
            if (isNetworkError(error)) {
                return guardarParaDespues('encuesta', surveyId, surveyTitle, workerId, workerName, responses);
            }
            return { success: false, offline: false, error: error.message || 'Error desconocido' };
        }
    }, [guardarParaDespues]);

    /**
     * Sincroniza lo pendiente. Una firma cuyo vale venció NO se pierde: el
     * servidor la acepta marcada para revisión y la cuenta acá para poder
     * avisarlo. Solo se descarta del equipo lo que el servidor aceptó (de una u
     * otra forma); lo que falla por red se reintenta en la próxima pasada.
     */
    const syncPendingSignatures = useCallback(async (): Promise<{ synced: number; failed: number; enRevision: number }> => {
        if (!navigator.onLine) return { synced: 0, failed: 0, enRevision: 0 };

        setSyncing(true);
        const pending = getPendingSignatures();
        let synced = 0;
        let failed = 0;
        let revision = 0;

        for (const sig of pending) {
            try {
                const credencial = {
                    vale: sig.vale,
                    deviceId: deviceId(),
                    timestampLocal: sig.timestamp,
                };
                let response;
                if (sig.type === 'documento') {
                    response = await documentsApi.sign(sig.targetId, {
                        personaId: sig.workerId,
                        tipoFirma: 'trabajador',
                        ...credencial,
                    } as any);
                } else if (sig.type === 'actividad') {
                    response = await activitiesApi.registerAttendance(sig.targetId, {
                        workerIds: [sig.workerId],
                        incluirFirmaRelator: false,
                        ...credencial,
                    } as any);
                } else if (sig.type === 'encuesta') {
                    response = await surveysApi.updateResponseStatus(sig.targetId, sig.workerId, {
                        estado: 'respondida',
                        responses: sig.surveyAnswers,
                        ...credencial,
                    } as any);
                }

                if (response?.success) {
                    const datos: any = response.data;
                    if (datos?.firma?.requiereRevision || datos?.requiereRevision) revision++;
                    removePendingSignature(sig.id);
                    synced++;
                } else if (response && !isNetworkErrorResponse(response.error || '')) {
                    // El servidor la rechazó (vale ya usado, o vencido hace
                    // demasiado): reintentar no va a cambiar nada y dejarla en el
                    // equipo solo acumula un PIN... ya no, pero sí una firma que
                    // nunca va a entrar. Se descarta y se informa como fallida.
                    removePendingSignature(sig.id);
                    failed++;
                } else {
                    failed++;
                }
            } catch {
                failed++;
            }
        }

        refreshPendingCount();
        setEnRevision(revision);
        setSyncing(false);
        return { synced, failed, enRevision: revision };
    }, [refreshPendingCount]);

    return {
        isOnline,
        syncing,
        pendingCount,
        enRevision,
        signDocument,
        signActivity,
        signSurvey,
        syncPendingSignatures,
        refreshPendingCount,
        getPendingSignatures,
        habilitarSinConexion,
        valesDe,
        necesitaVales,
    };
}
