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
 * Los vales se guardan cifrados con una llave derivada del PIN (utils/
 * valesCifrados): sin red, firmar exige el PIN de la persona, también en la
 * firma asistida. Cinco PIN equivocados seguidos en el equipo borran sus vales.
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
import {
    leerCola, agregarACola, quitarDeCola, guardarValesDe, tomarVale, valesDisponibles, valesDePersona, nuevoIdFirma,
    anotarRechazada, leerRechazadas, olvidarRechazadas, MAX_INTENTOS_EQUIPO,
    type FirmaPendiente, type TipoFirma, type FirmaRechazada,
} from '../utils/colaFirmas';
import { cifrarVales, cifradoDisponible } from '../utils/valesCifrados';

export type SignatureType = TipoFirma;
export type OfflinePendingSignature = FirmaPendiente;

const DEVICE_KEY = 'deviceId';

/** Avisa a las demás instancias del hook que la cola o los vales cambiaron. */
export const EVENTO_COLA = 'cola-firmas-cambio';
const avisarCambio = () => {
    try { window.dispatchEvent(new CustomEvent(EVENTO_COLA)); } catch { /* sin window */ }
};

/**
 * Empresa de la sesión, leída en el momento: la cola y los vales se guardan por
 * empresa, y una sesión solo ve y sincroniza los de la suya (ver utils/colaFirmas).
 */
const empresa = (): string | null => {
    try { return localStorage.getItem('tenant_id'); } catch { return null; }
};

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

// ─── Firmas pendientes de sincronizar (por empresa) ──────────────────────────

const getPendingSignatures = (): FirmaPendiente[] => leerCola(empresa());

const valesDisponiblesDe = (personaId: string, obraId: string | null = null): number =>
    valesDisponibles(empresa(), personaId, undefined, obraId);

/**
 * Una sola sincronización a la vez en la pestaña: la lanzan varias pantallas y
 * el sincronizador del layout. El servidor ya es idempotente (idFirmaLocal), pero
 * no hay motivo para mandar dos veces lo mismo.
 */
let sincronizacionEnCurso: Promise<{ synced: number; failed: number; enRevision: number }> | null = null;

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

/** Los vales son de la obra del turno: no sirven para firmar algo de otra obra. */
const OTRA_OBRA = 'La firma sin conexión de esta persona está habilitada para otra obra. '
    + 'Con señal, puede habilitarla para esta obra con su PIN.';

const pinIncorrecto = (quedan = 0) => `PIN incorrecto. Quedan ${quedan} intento(s) en este equipo; `
    + `después del ${MAX_INTENTOS_EQUIPO}º error se borra la firma sin conexión de esta persona.`;

const BLOQUEADO = `${MAX_INTENTOS_EQUIPO} PIN equivocados seguidos: se borró la firma sin conexión de esta persona en este equipo. `
    + 'Con señal, puede habilitarla de nuevo con su PIN.';

const SIN_CIFRADO = 'Este navegador no permite guardar la firma sin conexión de forma segura. '
    + 'Usa un navegador actualizado (Chrome o Safari) en la dirección https de la aplicación.';

export function useOfflineSignature() {
    const [isOnline, setIsOnline] = useState(navigator.onLine);
    const [syncing, setSyncing] = useState(false);
    const [pendingCount, setPendingCount] = useState(getPendingSignatures().length);
    const [enRevision, setEnRevision] = useState(0);
    const [rechazadas, setRechazadas] = useState<FirmaRechazada[]>(leerRechazadas(empresa()));

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

    // La cola la cambian varias pantallas y el sincronizador del layout: cada
    // instancia del hook se entera por este evento (y por `storage`, si cambió
    // en otra pestaña) y refresca su conteo.
    useEffect(() => {
        const refrescar = () => {
            setPendingCount(getPendingSignatures().length);
            setRechazadas(leerRechazadas(empresa()));
        };
        window.addEventListener(EVENTO_COLA, refrescar);
        window.addEventListener('storage', refrescar);
        return () => {
            window.removeEventListener(EVENTO_COLA, refrescar);
            window.removeEventListener('storage', refrescar);
        };
    }, []);

    /**
     * Habilita la firma sin conexión de una persona en ESTE equipo. Es el único
     * momento en que el PIN entra al flujo, y requiere red.
     */
    const habilitarSinConexion = useCallback(async (
        personaId: string,
        pin: string,
        /** Obra del turno: los vales sirven para esa obra y para lo que no tiene obra. */
        obraId: string,
        cantidad = 5,
    ): Promise<{ success: boolean; error?: string; expiraEn?: string }> => {
        if (!navigator.onLine) {
            return { success: false, error: 'Necesitas señal para habilitar la firma sin conexión.' };
        }
        // Sin WebCrypto no se habilita: los vales nunca se guardan en claro.
        if (!cifradoDisponible()) return { success: false, error: SIN_CIFRADO };
        try {
            const res = await signaturesApi.emitirVales({ personaId, obraId, pin, cantidad, deviceId: deviceId() });
            if (!res.success || !res.data) {
                return { success: false, error: res.error || 'No se pudo habilitar la firma sin conexión.' };
            }
            const tenantId = empresa();
            if (!tenantId) return { success: false, error: 'No hay una sesión activa en este equipo.' };
            // El servidor ya comprobó este PIN: la llave que sale de él es la buena.
            const cifrado = await cifrarVales(pin, res.data.vales);
            guardarValesDe(tenantId, { personaId, obraId: res.data.obraId, cifrado, expiraEn: res.data.expiraEn, intentosFallidos: 0 });
            avisarCambio();
            return { success: true, expiraEn: res.data.expiraEn };
        } catch (error: any) {
            return { success: false, error: error?.message || 'No se pudo habilitar la firma sin conexión.' };
        }
    }, []);

    /** Cuántos vales le quedan a una persona en este equipo. */
    /** Cuántos vales le quedan; con `obraId`, solo los de esa obra. */
    const valesDe = useCallback((personaId: string, obraId: string | null = null) => valesDisponiblesDe(personaId, obraId), []);

    /** Los vales de la persona en el equipo: cuántos, de qué obra y hasta cuándo. */
    const detalleVales = useCallback((personaId: string) => valesDePersona(empresa(), personaId), []);

    /** ¿Conviene pedir vales para esta obra ahora que hay red? */
    const necesitaVales = useCallback(
        (personaId: string, obraId: string, minimo = 3) => valesDisponiblesDe(personaId, obraId) < minimo,
        [],
    );

    const createOfflineSignature = useCallback(async (
        type: SignatureType,
        targetId: string,
        targetTitle: string,
        workerId: string,
        workerName: string,
        /** Obra de lo que se firma (null si es de la empresa). */
        obraId: string | null,
        /** El PIN de la persona: descifra su vale. Sin él no hay firma. */
        pin: string,
        surveyAnswers?: any[]
    ): Promise<{ sig: OfflinePendingSignature } | { error: string }> => {
        const tenantId = empresa();
        if (!tenantId) return { error: SIN_VALES };
        if (!cifradoDisponible()) return { error: SIN_CIFRADO };
        const tomado = await tomarVale(tenantId, workerId, obraId, pin);
        if ('motivo' in tomado) {
            avisarCambio();
            if (tomado.motivo === 'otra_obra') return { error: OTRA_OBRA };
            if (tomado.motivo === 'pin_incorrecto') return { error: pinIncorrecto(tomado.quedan) };
            if (tomado.motivo === 'bloqueado') return { error: BLOQUEADO };
            return { error: SIN_VALES };
        }

        const sig: FirmaPendiente = {
            id: nuevoIdFirma(),
            tenantId,
            type,
            targetId,
            targetTitle,
            workerId,
            workerName,
            vale: tomado.vale,
            timestamp: new Date().toISOString(),
            surveyAnswers,
        };
        // Si el equipo no pudo guardarla (almacenamiento lleno), no se da por
        // tomada: quien firma tiene que saberlo en el momento.
        if (!agregarACola(sig)) return { error: 'No se pudo guardar la firma en este equipo: el almacenamiento está lleno.' };
        refreshPendingCount();
        avisarCambio();
        return { sig };
    }, [refreshPendingCount]);

    /** Guarda la firma para sincronizar, o explica por qué no se puede. */
    const guardarParaDespues = useCallback(async (
        type: SignatureType,
        targetId: string,
        targetTitle: string,
        workerId: string,
        workerName: string,
        obraId: string | null,
        pin: string,
        surveyAnswers?: any[]
    ): Promise<{ success: boolean; offline: boolean; error?: string }> => {
        const r = await createOfflineSignature(type, targetId, targetTitle, workerId, workerName, obraId, pin, surveyAnswers);
        if ('error' in r) return { success: false, offline: true, error: r.error };
        return { success: true, offline: true };
    }, [createOfflineSignature]);

    const signDocument = useCallback(async (
        documentId: string,
        documentTitle: string,
        workerId: string,
        workerName: string,
        pin: string,
        obraId: string | null = null,
    ): Promise<{ success: boolean; offline: boolean; error?: string }> => {
        if (!navigator.onLine) {
            return guardarParaDespues('documento', documentId, documentTitle, workerId, workerName, obraId, pin);
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
                return guardarParaDespues('documento', documentId, documentTitle, workerId, workerName, obraId, pin);
            }

            return { success: false, offline: false, error: response.error };
        } catch (error: any) {
            if (isNetworkError(error)) {
                return guardarParaDespues('documento', documentId, documentTitle, workerId, workerName, obraId, pin);
            }
            return { success: false, offline: false, error: error.message || 'Error desconocido' };
        }
    }, [guardarParaDespues]);

    const signActivity = useCallback(async (
        activityId: string,
        activityTitle: string,
        workerId: string,
        workerName: string,
        pin: string,
        obraId: string | null = null,
    ): Promise<{ success: boolean; offline: boolean; error?: string }> => {
        if (!navigator.onLine) {
            return guardarParaDespues('actividad', activityId, activityTitle, workerId, workerName, obraId, pin);
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
                return guardarParaDespues('actividad', activityId, activityTitle, workerId, workerName, obraId, pin);
            }

            return { success: false, offline: false, error: response.error };
        } catch (error: any) {
            if (isNetworkError(error)) {
                return guardarParaDespues('actividad', activityId, activityTitle, workerId, workerName, obraId, pin);
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
        pin: string,
        obraId: string | null = null,
    ): Promise<{ success: boolean; offline: boolean; error?: string }> => {
        if (!navigator.onLine) {
            return guardarParaDespues('encuesta', surveyId, surveyTitle, workerId, workerName, obraId, pin, responses);
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
                return guardarParaDespues('encuesta', surveyId, surveyTitle, workerId, workerName, obraId, pin, responses);
            }

            return { success: false, offline: false, error: response.error };
        } catch (error: any) {
            if (isNetworkError(error)) {
                return guardarParaDespues('encuesta', surveyId, surveyTitle, workerId, workerName, obraId, pin, responses);
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
        if (sincronizacionEnCurso) return sincronizacionEnCurso;
        sincronizacionEnCurso = sincronizar().finally(() => { sincronizacionEnCurso = null; });
        return sincronizacionEnCurso;
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [refreshPendingCount]);

    const sincronizar = async (): Promise<{ synced: number; failed: number; enRevision: number }> => {

        // Solo la cola de la empresa de esta sesión: la de otra empresa en el
        // mismo equipo espera a una sesión de esa empresa.
        const tenantId = empresa();
        if (!tenantId) return { synced: 0, failed: 0, enRevision: 0 };

        setSyncing(true);
        const pending = leerCola(tenantId);
        let synced = 0;
        let failed = 0;
        let revision = 0;

        for (const sig of pending) {
            try {
                const credencial = {
                    vale: sig.vale,
                    deviceId: deviceId(),
                    timestampLocal: sig.timestamp,
                    // Identifica esta firma: si un intento anterior gastó el vale
                    // y no alcanzó a escribirla, el servidor acepta el reintento.
                    idFirmaLocal: sig.id,
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
                    quitarDeCola(tenantId, sig.id);
                    synced++;
                } else if (response && !(response as { reintentable?: boolean }).reintentable && !isNetworkErrorResponse(response.error || '')) {
                    // El servidor la rechazó (vale inválido —el 1 de 256 PIN
                    // equivocados que pasa la comprobación—, ya usado, anulado o
                    // vencido hace demasiado): reintentar no cambia nada. Se quita
                    // de la cola y se anota con el nombre de la persona, para que
                    // alguien le pida firmar de nuevo.
                    quitarDeCola(tenantId, sig.id);
                    anotarRechazada(tenantId, {
                        id: sig.id, workerName: sig.workerName, targetTitle: sig.targetTitle,
                        motivo: response.error || 'La firma no se pudo validar.', en: new Date().toISOString(),
                    });
                    failed++;
                } else {
                    failed++;
                }
            } catch {
                failed++;
            }
        }

        refreshPendingCount();
        setRechazadas(leerRechazadas(tenantId));
        avisarCambio();
        setEnRevision(revision);
        setSyncing(false);
        return { synced, failed, enRevision: revision };
    };

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
        detalleVales,
        necesitaVales,
        /** Firmas que el servidor rechazó al sincronizar, con nombre, hasta que alguien las vea. */
        rechazadas,
        olvidarRechazadas: () => {
            const t = empresa();
            if (t) olvidarRechazadas(t);
            setRechazadas([]);
            avisarCambio();
        },
    };
}
