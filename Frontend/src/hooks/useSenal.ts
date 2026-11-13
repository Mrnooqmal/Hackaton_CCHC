import { useEffect, useRef, useSyncExternalStore } from 'react';
import { haySenal, suscribirSenal } from '../utils/conexion';

/** ¿Hay señal? El mismo estado en todas las pantallas (utils/conexion). */
export function useHaySenal(): boolean {
    return useSyncExternalStore(suscribirSenal, haySenal, haySenal);
}

/**
 * Llama a `recargar` cuando vuelve la señal, si `pendiente` (lo que se muestra
 * no se pudo cargar por falta de señal). Así la pantalla se completa sola, sin
 * botón de reintentar.
 */
export function useAlVolverLaSenal(recargar: () => void, pendiente: boolean): void {
    const hay = useHaySenal();
    const ultima = useRef(recargar);
    ultima.current = recargar;
    const antes = useRef(hay);
    useEffect(() => {
        const volvio = hay && !antes.current;
        antes.current = hay;
        if (volvio && pendiente) ultima.current();
    }, [hay, pendiente]);
}
