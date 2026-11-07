import { useEffect, useSyncExternalStore } from 'react';
import { bloquear, bloqueado, suscribir } from './bloqueo.ts';

/** Mientras `activo` sea true, ningún recorrido se lanza solo. Ver `bloqueo.ts`. */
export function useBloqueoAyuda(activo: boolean) {
    useEffect(() => (activo ? bloquear() : undefined), [activo]);
}

/** ¿Hay algún bloqueo activo? Se actualiza al abrir y cerrar cada uno. */
export const useHayBloqueo = () => useSyncExternalStore(suscribir, bloqueado, bloqueado);
