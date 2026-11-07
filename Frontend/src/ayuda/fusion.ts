// Fusión del progreso de un recorrido: la misma regla que aplica el backend
// (`Backend/lib/ayuda/progreso.js`, `fusionar`). El frontend la usa para su
// copia local y para la cola sin conexión, de modo que lo que muestra coincide
// con lo que el servidor va a guardar. `Backend/tests/ayuda-gemelos.test.js`
// compara las dos implementaciones caso por caso.
//
//   versión mayor: reinicia. versión menor: se ignora.
//   misma versión: el estado solo sube (en_progreso < omitido < completado);
//   cierres y último paso, el máximo. En curso con tres cierres cuenta como omitido.

import { ESTADOS_PROGRESO, LIMITES } from './tipos.ts';
import type { EstadoProgreso } from './tipos.ts';

export interface EntradaProgreso {
    readonly version: number;
    readonly estado: EstadoProgreso;
    readonly ultimoPaso: number;
    readonly cierres: number;
}

const rango = (e: EstadoProgreso) => ESTADOS_PROGRESO.indexOf(e);

const aplicarRegla = (p: EntradaProgreso): EntradaProgreso =>
    (p.estado === 'en_progreso' && p.cierres >= LIMITES.CIERRES_PARA_OMITIR ? { ...p, estado: 'omitido' } : p);

const campos = (p: EntradaProgreso): EntradaProgreso =>
    ({ version: p.version, estado: p.estado, ultimoPaso: p.ultimoPaso, cierres: p.cierres });

export function fusionar(actual: EntradaProgreso | null, entrante: EntradaProgreso): { progreso: EntradaProgreso; cambia: boolean } {
    if (!actual) return { progreso: aplicarRegla(campos(entrante)), cambia: true };
    const guardado = campos(actual);
    if (entrante.version < guardado.version) return { progreso: guardado, cambia: false };
    if (entrante.version > guardado.version) return { progreso: aplicarRegla(campos(entrante)), cambia: true };

    const fusion = aplicarRegla({
        version: guardado.version,
        estado: rango(entrante.estado) > rango(guardado.estado) ? entrante.estado : guardado.estado,
        ultimoPaso: Math.max(guardado.ultimoPaso, entrante.ultimoPaso),
        cierres: Math.max(guardado.cierres, entrante.cierres),
    });
    const cambia = (Object.keys(fusion) as (keyof EntradaProgreso)[]).some((k) => fusion[k] !== guardado[k]);
    return { progreso: fusion, cambia };
}
