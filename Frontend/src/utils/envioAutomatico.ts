import { plural } from './plural';

/**
 * Qué dice la franja de firmas del layout (SincronizadorFirmas) y cuándo ofrece
 * "Enviar ahora". Lógica pura, para probarla sin navegador.
 *
 * Prueba en terreno del 11 de noviembre de 2026: "Enviar ahora" aparecía con
 * señal mientras el envío automático ya estaba enviando, y confundía. Mientras
 * el envío automático funcione se dice "Enviando…", sin botón. El botón aparece
 * solo si el envío automático lleva más de 2 minutos fallando CON señal: sin
 * señal no hay nada que un toque pueda arreglar, y no se ofrece.
 */

export const PLAZO_RESPALDO_MS = 2 * 60 * 1000;

export interface EstadoEnvio {
    /** Desde cuándo fallan los intentos con señal (ms), o null si no fallan. */
    fallandoDesde: number | null;
}

export const ENVIO_INICIAL: EstadoEnvio = { fallandoDesde: null };

export interface ResultadoIntento { synced: number; failed: number; sinRed: boolean }

/** El estado después de un intento de envío. */
export function trasIntento(estado: EstadoEnvio, r: ResultadoIntento, ahora: number): EstadoEnvio {
    // Llegó algo, o no quedó nada por fallar: funciona.
    if (r.synced > 0 || r.failed === 0) return ENVIO_INICIAL;
    // Sin señal no es el envío el que falla: el plazo cuenta desde que vuelve.
    if (r.sinRed) return ENVIO_INICIAL;
    return { fallandoDesde: estado.fallandoDesde ?? ahora };
}

export function ofrecerEnviarAhora(estado: EstadoEnvio, hay: boolean, ahora: number): boolean {
    return hay && estado.fallandoDesde !== null && ahora - estado.fallandoDesde > PLAZO_RESPALDO_MS;
}

export interface Franja {
    texto: string;
    /** "Enviando…" junto al texto (con señal, mientras el envío automático funciona). */
    enviando: boolean;
    boton: boolean;
}

/**
 * La franja, o null si no hay nada que decir. Sin señal es el ÚNICO aviso de
 * la pantalla: las pantallas ya no ponen el suyo.
 */
export function franjaDeEnvio({ hay, pendientes, respaldo }: { hay: boolean; pendientes: number; respaldo: boolean }): Franja | null {
    const porEnviar = plural(pendientes, 'firma por enviar', 'firmas por enviar');
    if (!hay) {
        return {
            texto: pendientes > 0
                ? `Sin señal. ${porEnviar}: ${pendientes === 1 ? 'se envía sola' : 'se envían solas'} cuando vuelva. Lo que necesita conexión no está disponible.`
                : 'Sin señal. Lo que firmes queda en este equipo y se envía solo; lo que necesita conexión no está disponible.',
            enviando: false,
            boton: false,
        };
    }
    if (pendientes === 0) return null;
    if (respaldo) return { texto: `${porEnviar}: no se han podido enviar.`, enviando: false, boton: true };
    return { texto: porEnviar, enviando: true, boton: false };
}
