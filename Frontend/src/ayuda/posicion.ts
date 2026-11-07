// Dónde va el globo de un paso. Geometría pura: recibe rectángulos y devuelve
// coordenadas, para probarla sin navegador (tests/ayuda-posicion.test.mjs) y
// confirmarla en uno real a 360 px (tests/e2e).
//
// Regla principal: el globo nunca tapa el elemento resaltado ni sale de la
// pantalla. En pantallas angostas va anclado de borde a borde, abajo o arriba,
// en la mitad opuesta al elemento. En pantallas anchas flota junto al elemento,
// en la posición pedida si cabe, o en la primera que quepa; si ninguna cabe,
// también se ancla.

import type { Posicion } from './tipos.ts';

export interface Rect { readonly top: number; readonly left: number; readonly width: number; readonly height: number }
export interface Tamano { readonly width: number; readonly height: number }

export type Colocacion =
    | { modo: 'flotante'; lado: Exclude<Posicion, 'auto'>; top: number; left: number; width: number }
    | { modo: 'anclado'; borde: 'abajo' | 'arriba'; top: number; left: number; width: number }
    | { modo: 'centrado'; top: number; left: number; width: number };

/** Ancho bajo el cual el globo va siempre anclado. */
export const ANCHO_ANGOSTO = 640;
export const MARGEN = 16;
/** Separación entre el globo y el elemento. */
export const SEPARACION = 12;
/** Halo del resaltado alrededor del elemento: el globo tampoco lo tapa. */
export const HALO = 6;
export const ANCHO_GLOBO = 360;

const ORDEN_AUTO: Exclude<Posicion, 'auto'>[] = ['abajo', 'arriba', 'derecha', 'izquierda'];

const limitar = (v: number, min: number, max: number) => Math.max(min, Math.min(v, max));

export const seCruzan = (a: Rect, b: Rect) =>
    a.left < b.left + b.width && b.left < a.left + a.width && a.top < b.top + b.height && b.top < a.top + a.height;

const conHalo = (r: Rect): Rect => ({ top: r.top - HALO, left: r.left - HALO, width: r.width + 2 * HALO, height: r.height + 2 * HALO });

/** Ancho del globo para un viewport. */
export const anchoGlobo = (vista: Tamano) =>
    (vista.width < ANCHO_ANGOSTO ? vista.width - 2 * MARGEN : Math.min(ANCHO_GLOBO, vista.width - 2 * MARGEN));

/** El borde donde se ancla: la mitad de la pantalla que el elemento no ocupa. */
export const bordeLibre = (objetivo: Rect | null, vista: Tamano): 'abajo' | 'arriba' =>
    (!objetivo || objetivo.top + objetivo.height / 2 <= vista.height / 2 ? 'abajo' : 'arriba');

function anclado(objetivo: Rect | null, globo: Tamano, vista: Tamano): Colocacion {
    const borde = bordeLibre(objetivo, vista);
    const width = vista.width - 2 * MARGEN;
    return { modo: 'anclado', borde, left: MARGEN, width, top: borde === 'abajo' ? vista.height - MARGEN - globo.height : MARGEN };
}

function flotante(lado: Exclude<Posicion, 'auto'>, o: Rect, globo: Tamano, vista: Tamano): Colocacion | null {
    const w = globo.width;
    const h = globo.height;
    let top: number;
    let left: number;
    if (lado === 'abajo' || lado === 'arriba') {
        top = lado === 'abajo' ? o.top + o.height + HALO + SEPARACION : o.top - HALO - SEPARACION - h;
        left = limitar(o.left + o.width / 2 - w / 2, MARGEN, vista.width - MARGEN - w);
    } else {
        left = lado === 'derecha' ? o.left + o.width + HALO + SEPARACION : o.left - HALO - SEPARACION - w;
        top = limitar(o.top + o.height / 2 - h / 2, MARGEN, vista.height - MARGEN - h);
    }
    const r = { top, left, width: w, height: h };
    const dentro = top >= MARGEN && left >= MARGEN && top + h <= vista.height - MARGEN && left + w <= vista.width - MARGEN;
    return dentro && !seCruzan(r, conHalo(o)) ? { modo: 'flotante', lado, top, left, width: w } : null;
}

/**
 * @param objetivo  rectángulo del elemento en la vista, o null (paso sin ancla)
 * @param globo     tamaño medido del globo (con el ancho de `anchoGlobo`)
 * @param vista     tamaño del viewport
 */
export function colocar(objetivo: Rect | null, globo: Tamano, vista: Tamano, preferida: Posicion = 'auto'): Colocacion {
    if (!objetivo) {
        const width = anchoGlobo(vista);
        return { modo: 'centrado', width, left: (vista.width - width) / 2, top: Math.max(MARGEN, (vista.height - globo.height) / 2) };
    }
    if (vista.width < ANCHO_ANGOSTO) return anclado(objetivo, globo, vista);
    const orden = preferida === 'auto' ? ORDEN_AUTO : [preferida, ...ORDEN_AUTO.filter((l) => l !== preferida)];
    for (const lado of orden) {
        const c = flotante(lado, objetivo, globo, vista);
        if (c) return c;
    }
    return anclado(objetivo, globo, vista);
}
