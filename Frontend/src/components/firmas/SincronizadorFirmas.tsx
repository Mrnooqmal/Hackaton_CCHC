import { useCallback, useEffect, useRef } from 'react';
import { FiUploadCloud, FiWifiOff } from 'react-icons/fi';
import { useOfflineSignature } from '../../hooks/useOfflineSignature';
import { useToast } from '../../context/ToastContext';

/**
 * Envía las firmas tomadas sin red, desde cualquier pantalla.
 *
 * Antes solo se sincronizaba en Actividades, Encuestas y Solicitudes: quien
 * recuperaba la señal en otra pantalla dejaba las firmas en el equipo sin saberlo.
 * Esto vive en el layout: sincroniza al entrar, al volver la red y cada dos
 * minutos mientras quede algo pendiente, y muestra cuántas faltan por enviar.
 *
 * La cola es de la empresa de la sesión (utils/colaFirmas): lo de otra empresa en
 * el mismo equipo espera a una sesión de esa empresa.
 */
const CADA_MS = 2 * 60 * 1000;

export default function SincronizadorFirmas() {
    const { isOnline, pendingCount, syncing, syncPendingSignatures } = useOfflineSignature();
    const { toast } = useToast();
    const avisando = useRef(false);

    const enviar = useCallback(async () => {
        if (!navigator.onLine || avisando.current) return;
        avisando.current = true;
        try {
            const r = await syncPendingSignatures();
            if (r.synced > 0) {
                toast.success(r.enRevision > 0
                    ? `${r.synced} firma(s) enviada(s); ${r.enRevision} quedó(aron) en revisión.`
                    : `${r.synced} firma(s) tomada(s) sin conexión enviada(s).`);
            }
            if (r.failed > 0 && r.synced === 0 && navigator.onLine) {
                toast.error(`${r.failed} firma(s) no se pudieron enviar. Se reintenta sola.`);
            }
        } finally {
            avisando.current = false;
        }
    }, [syncPendingSignatures, toast]);

    // Al entrar y al volver la red.
    useEffect(() => {
        if (isOnline && pendingCount > 0) enviar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOnline]);

    // Cada dos minutos, solo si hay algo pendiente y red.
    useEffect(() => {
        if (!isOnline || pendingCount === 0) return undefined;
        const id = window.setInterval(enviar, CADA_MS);
        return () => window.clearInterval(id);
    }, [isOnline, pendingCount, enviar]);

    if (pendingCount === 0) return null;

    return (
        <div className="sincronizador-firmas" role="status" aria-live="polite">
            {isOnline ? <FiUploadCloud aria-hidden /> : <FiWifiOff aria-hidden />}
            <span>
                {pendingCount === 1 ? '1 firma por enviar' : `${pendingCount} firmas por enviar`}
                {isOnline ? '' : ': se envían solas cuando vuelva la señal.'}
            </span>
            {isOnline && (
                <button type="button" className="btn btn-secondary btn-sm" onClick={enviar} disabled={syncing}>
                    {syncing ? 'Enviando…' : 'Enviar ahora'}
                </button>
            )}
        </div>
    );
}
