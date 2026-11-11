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
 * Ahora el PIN no se guarda nunca en claro. Sin red, firmar siempre es posible y
 * siempre exige el PIN; la persona no elige ni ve la diferencia entre:
 *
 *   - VALES: si el equipo tiene vales suyos para la obra, el PIN los abre y el
 *     error de tipeo se detecta al momento (utils/valesCifrados). Se renuevan solos
 *     cada vez que escribe su PIN con red (utils/valesTurno).
 *   - SOBRE: si no, el PIN se cifra con la llave pública del servidor, amarrado a
 *     esa firma, y se comprueba al volver la señal (utils/sobreFirma, D-37).
 */

import { useCallback, useState, useEffect } from 'react';
import { documentsApi, activitiesApi, surveysApi } from '../api/client';
import {
    leerCola, agregarACola, quitarDeCola, tomarVale, nuevoIdFirma,
    anotarRechazada, leerRechazadas, olvidarRechazadas,
    type FirmaPendiente, type TipoFirma, type FirmaRechazada,
} from '../utils/colaFirmas';
import { cifradoDisponible } from '../utils/valesCifrados';
import { cifrarSobre, leerLlaveSobre } from '../utils/sobreFirma';
import { deviceId, EVENTO_COLA } from '../utils/valesTurno';

export type SignatureType = TipoFirma;
export type OfflinePendingSignature = FirmaPendiente;

/** Avisa a las demás instancias del hook que la cola o los vales cambiaron. */
export { EVENTO_COLA };
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

// ─── Firmas pendientes de sincronizar (por empresa) ──────────────────────────

const getPendingSignatures = (): FirmaPendiente[] => leerCola(empresa());

/**
 * Una sola sincronización a la vez en la pestaña: la lanzan varias pantallas y
 * el sincronizador del layout. El servidor ya es idempotente (idFirmaLocal), pero
 * no hay motivo para mandar dos veces lo mismo.
 */
export interface ResultadoSincronizacion { synced: number; failed: number; enRevision: number; sinRed: boolean }
let sincronizacionEnCurso: Promise<ResultadoSincronizacion> | null = null;

// ─── Mensajes ────────────────────────────────────────────────────────────────

const NO_SE_GUARDO = 'No se pudo guardar la firma en este equipo. Entra una vez con señal e inténtalo de nuevo.';
const NO_SE_FIRMO = 'No se pudo firmar. Inténtalo de nuevo.';

const pinIncorrecto = (quedan = 0) => (quedan === 1
    ? 'PIN incorrecto. Queda 1 intento en este equipo.'
    : `PIN incorrecto. Quedan ${quedan} intentos en este equipo.`);

/** Se borraron sus vales de este equipo: el próximo intento va en sobre, sin que se note. */
const PIN_INCORRECTO_FINAL = 'PIN incorrecto. Revísalo e inténtalo de nuevo; si no lo recuerdas, pide que te lo restablezcan.';

export function useOfflineSignature() {
    const [isOnline, setIsOnline] = useState(navigator.onLine);
    const [syncing, setSyncing] = useState(false);
    const [pendingCount, setPendingCount] = useState(getPendingSignatures().length);
    const [enRevision, setEnRevision] = useState(0);
    const [rechazadas, setRechazadas] = useState<FirmaRechazada[]>(leerRechazadas(empresa()));

    useEffect(() => {
        const handleOnline = () => setIsOnline(true);
        const handleOffline = () => setIsOnline(false);

        // En Android el evento `online` no siempre llega: al volver a la app se
        // vuelve a mirar.
        const alVolver = () => setIsOnline(navigator.onLine);

        window.addEventListener('online', handleOnline);
        window.addEventListener('offline', handleOffline);
        document.addEventListener('visibilitychange', alVolver);

        return () => {
            window.removeEventListener('online', handleOnline);
            window.removeEventListener('offline', handleOffline);
            document.removeEventListener('visibilitychange', alVolver);
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
        if (!tenantId || !cifradoDisponible()) return { error: NO_SE_GUARDO };

        const id = nuevoIdFirma();
        const timestamp = new Date().toISOString();
        const credencial: Pick<FirmaPendiente, 'vale' | 'sobre'> = {};
        const tomado = await tomarVale(tenantId, workerId, obraId, pin);
        if ('vale' in tomado) {
            credencial.vale = tomado.vale;
        } else if (tomado.motivo === 'pin_incorrecto') {
            avisarCambio();
            return { error: pinIncorrecto(tomado.quedan) };
        } else if (tomado.motivo === 'bloqueado') {
            avisarCambio();
            return { error: PIN_INCORRECTO_FINAL };
        } else {
            // Sin vales para esta obra: el sobre. Sin señal siempre se puede firmar.
            const llave = leerLlaveSobre();
            if (!llave) return { error: NO_SE_GUARDO };
            try {
                credencial.sobre = await cifrarSobre(pin, {
                    personaId: workerId, tenantId, obraId, tipo: type, referenciaId: targetId, idFirmaLocal: id, timestampLocal: timestamp,
                }, llave);
            } catch {
                return { error: NO_SE_GUARDO };
            }
        }

        const sig: FirmaPendiente = {
            id,
            tenantId,
            type,
            targetId,
            targetTitle,
            workerId,
            workerName,
            ...credencial,
            timestamp,
            surveyAnswers,
        };
        // Si el equipo no pudo guardarla (almacenamiento lleno), no se da por
        // tomada: quien firma tiene que saberlo en el momento.
        if (!agregarACola(sig)) return { error: NO_SE_GUARDO };
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

            if (response.sinRed) {
                return guardarParaDespues('documento', documentId, documentTitle, workerId, workerName, obraId, pin);
            }

            return { success: false, offline: false, error: response.error || NO_SE_FIRMO };
        } catch {
            return guardarParaDespues('documento', documentId, documentTitle, workerId, workerName, obraId, pin);
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

            if (response.sinRed) {
                return guardarParaDespues('actividad', activityId, activityTitle, workerId, workerName, obraId, pin);
            }

            return { success: false, offline: false, error: response.error || NO_SE_FIRMO };
        } catch {
            return guardarParaDespues('actividad', activityId, activityTitle, workerId, workerName, obraId, pin);
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

            if (response.sinRed) {
                return guardarParaDespues('encuesta', surveyId, surveyTitle, workerId, workerName, obraId, pin, responses);
            }

            return { success: false, offline: false, error: response.error || NO_SE_FIRMO };
        } catch {
            return guardarParaDespues('encuesta', surveyId, surveyTitle, workerId, workerName, obraId, pin, responses);
        }
    }, [guardarParaDespues]);

    /**
     * Sincroniza lo pendiente. Una firma cuyo vale venció NO se pierde: el
     * servidor la acepta marcada para revisión y la cuenta acá para poder
     * avisarlo. Solo se descarta del equipo lo que el servidor aceptó (de una u
     * otra forma); lo que falla por red se reintenta en la próxima pasada.
     */
    const syncPendingSignatures = useCallback(async (): Promise<ResultadoSincronizacion> => {
        // No se mira `navigator.onLine`: en Android puede estar atrasado, y sin red
        // el intento falla enseguida. Ver SincronizadorFirmas.
        if (sincronizacionEnCurso) return sincronizacionEnCurso;
        sincronizacionEnCurso = sincronizar().finally(() => { sincronizacionEnCurso = null; });
        return sincronizacionEnCurso;
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [refreshPendingCount]);

    const sincronizar = async (): Promise<ResultadoSincronizacion> => {

        // Solo la cola de la empresa de esta sesión: la de otra empresa en el
        // mismo equipo espera a una sesión de esa empresa.
        const tenantId = empresa();
        if (!tenantId) return { synced: 0, failed: 0, enRevision: 0, sinRed: false };

        const pending = leerCola(tenantId);
        if (pending.length === 0) return { synced: 0, failed: 0, enRevision: 0, sinRed: false };
        setSyncing(true);
        // Un intento de PIN por sincronización y por persona (D-37).
        const idSincronizacion = nuevoIdFirma().replace(/^firma_/, 'sinc_').slice(0, 64);
        let sinRed = false;
        let synced = 0;
        let failed = 0;
        let revision = 0;

        for (const sig of pending) {
            try {
                const credencial = {
                    ...(sig.vale ? { vale: sig.vale } : { sobre: sig.sobre, idSincronizacion }),
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
                } else if ((response as { sinRed?: boolean } | undefined)?.sinRed) {
                    // Sin señal: el resto tampoco va a llegar. Sin ruido, se reintenta.
                    sinRed = true;
                    failed++;
                    break;
                } else if (response && !(response as { reintentable?: boolean }).reintentable) {
                    // El servidor la rechazó (PIN equivocado en un sobre, el 1 de 256
                    // que pasa la comprobación de un vale, vale ya usado o anulado):
                    // reintentar no cambia nada. Se quita
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
                sinRed = true;
                failed++;
                break;
            }
        }

        // Si algo llegó, hay señal aunque el navegador diga otra cosa.
        setIsOnline(synced > 0 || navigator.onLine);
        refreshPendingCount();
        setRechazadas(leerRechazadas(tenantId));
        avisarCambio();
        setEnRevision(revision);
        setSyncing(false);
        return { synced, failed, enRevision: revision, sinRed };
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
