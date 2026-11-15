import { createContext, useContext } from 'react';

/**
 * Enlace entre los reproductores de "Escuchar documento" y quien los contiene
 * (el modal de firma). Sin él, el modal no sabría que hay una lectura en curso.
 *
 * - `registrar`: el reproductor empezó a sonar. El modal pausa cualquier otro
 *   (dos documentos leyéndose a la vez no se entienden) y lo muestra en el
 *   resumen del paso de PIN en el celular, para pausarlo sin volver atrás.
 * - `soltar`: el reproductor se desmontó.
 * - `alRevisar`: la persona abrió o escuchó el documento (marca el paso 1).
 *
 * Fuera de un modal de firma no hay contexto y los reproductores funcionan solos.
 */
export interface LecturaActiva {
    registrar: (audio: HTMLAudioElement) => void;
    soltar: (audio: HTMLAudioElement) => void;
    alRevisar: () => void;
}

export const LecturaActivaContext = createContext<LecturaActiva | null>(null);

export const useLecturaActiva = () => useContext(LecturaActivaContext);
