import { useCallback, useEffect, useRef } from 'react';
import { FiUploadCloud, FiWifiOff, FiAlertTriangle } from 'react-icons/fi';
import { useOfflineSignature } from '../../hooks/useOfflineSignature';
import { useToast } from '../../context/ToastContext';
import { plural } from '../../utils/plural';

/**
 * Envía las firmas tomadas sin red, desde cualquier pantalla y sin que nadie lo
 * pida: al entrar, al volver la red, al volver a la app y, mientras haya firmas
 * pendientes, cada 20 segundos.
 *
 * Los reintentos no miran `navigator.onLine` ni dependen del evento `online`: en
 * Android, Chrome no siempre lo dispara, y en la prueba en terreno hubo que tocar
 * "Enviar ahora" al volver la señal. Sin red el intento falla enseguida, sin ruido.
 * El botón queda solo como respaldo.
 *
 * La cola es de la empresa de la sesión (utils/colaFirmas): lo de otra empresa en
 * el mismo equipo espera a una sesión de esa empresa.
 *
 * Las firmas que el servidor rechazó se muestran con el nombre de la persona hasta
 * que alguien marque "Entendido": esa persona tiene que firmar de nuevo.
 */
const CADA_MS = 20 * 1000;

export default function SincronizadorFirmas() {
    const { isOnline, pendingCount, syncing, syncPendingSignatures, rechazadas, olvidarRechazadas } = useOfflineSignature();
    const { toast } = useToast();
    const avisando = useRef(false);

    const enviar = useCallback(async () => {
        if (avisando.current) return;
        avisando.current = true;
        try {
            const r = await syncPendingSignatures();
            if (r.synced > 0) {
                const enviadas = plural(r.synced, 'firma enviada', 'firmas enviadas');
                toast.success(r.enRevision > 0 ? `${enviadas}; ${plural(r.enRevision, 'quedó', 'quedaron')} en revisión.` : `${enviadas}.`);
            }
        } finally {
            avisando.current = false;
        }
    }, [syncPendingSignatures, toast]);

    const hayPendientes = pendingCount > 0;

    // Al entrar, al volver la red y al volver a la app.
    useEffect(() => {
        if (!hayPendientes) return undefined;
        const siVisible = () => { if (document.visibilityState === 'visible') enviar(); };
        enviar();
        window.addEventListener('online', enviar);
        window.addEventListener('focus', enviar);
        window.addEventListener('pageshow', enviar);
        document.addEventListener('visibilitychange', siVisible);
        return () => {
            window.removeEventListener('online', enviar);
            window.removeEventListener('focus', enviar);
            window.removeEventListener('pageshow', enviar);
            document.removeEventListener('visibilitychange', siVisible);
        };
    }, [hayPendientes, enviar]);

    // Cada 20 segundos mientras quede algo pendiente, con o sin red a la vista.
    useEffect(() => {
        if (!hayPendientes) return undefined;
        const id = window.setInterval(enviar, CADA_MS);
        return () => window.clearInterval(id);
    }, [hayPendientes, enviar]);

    const avisoRechazadas = rechazadas.length > 0 && (
        <div className="sincronizador-firmas sincronizador-firmas--rechazadas" role="alert">
            <FiAlertTriangle aria-hidden />
            <ul>
                {rechazadas.map((r) => (
                    <li key={r.id}>La firma de {r.workerName} ({r.targetTitle}) no se validó: tiene que firmar de nuevo.</li>
                ))}
            </ul>
            <button type="button" className="btn btn-secondary btn-sm" onClick={olvidarRechazadas}>Entendido</button>
        </div>
    );

    if (!hayPendientes) return avisoRechazadas || null;

    return (
        <>
            {avisoRechazadas}
            <div className="sincronizador-firmas" role="status" aria-live="polite">
                {isOnline ? <FiUploadCloud aria-hidden /> : <FiWifiOff aria-hidden />}
                <span>
                    {plural(pendingCount, 'firma por enviar', 'firmas por enviar')}
                    {isOnline ? '' : ': se envían solas cuando vuelva la señal.'}
                </span>
                <button type="button" className="btn btn-secondary btn-sm" onClick={enviar} disabled={syncing}>
                    {syncing ? 'Enviando…' : 'Enviar ahora'}
                </button>
            </div>
        </>
    );
}
