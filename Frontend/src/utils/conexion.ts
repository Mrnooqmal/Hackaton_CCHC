/**
 * Si hay señal, una sola respuesta para toda la aplicación.
 *
 * Antes cada pantalla decidía por su cuenta (`navigator.onLine`, el `isOnline`
 * de cada instancia de useOfflineSignature, o la respuesta de su propia carga),
 * y sin señal Encuestas apilaba tres avisos, uno de ellos rojo (prueba en
 * terreno del 11 de noviembre de 2026). Ahora hay un solo aviso, el del layout
 * (SincronizadorFirmas), y las pantallas solo leen este estado para no mostrar
 * ceros ni ofrecer lo que necesita conexión.
 *
 * Lo alimenta `apiRequest` (una petición sin respuesta = sin señal; cualquier
 * respuesta del servidor = hay señal) y los eventos `online`/`offline` del
 * navegador. En Android `navigator.onLine` puede ir atrasado: por eso manda lo
 * que pasó con la última petición.
 */

type Oyente = () => void;

const oyentes = new Set<Oyente>();
let sinSenal = typeof navigator !== 'undefined' && navigator.onLine === false;

/** Lo que se dice en lugar de un dato que no se pudo cargar por falta de señal. */
export const NO_DISPONIBLE_SIN_CONEXION = 'No disponible sin conexión';

export const haySenal = (): boolean => !sinSenal;

export function marcarSenal(hay: boolean): void {
    if (sinSenal === !hay) return;
    sinSenal = !hay;
    oyentes.forEach((f) => {
        try { f(); } catch { /* un oyente roto no corta a los demás */ }
    });
}

export function suscribirSenal(f: Oyente): () => void {
    oyentes.add(f);
    return () => { oyentes.delete(f); };
}

if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('online', () => marcarSenal(true));
    window.addEventListener('offline', () => marcarSenal(false));
}
