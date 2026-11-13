// Dónde va el globo de un paso. Geometría pura: recibe rectángulos y devuelve
// coordenadas, para probarla sin navegador (tests/ayuda-posicion.test.mjs) y
// confirmarla en uno real a 360 px (tests/e2e).
//
// Regla principal: el globo nunca tapa el elemento resaltado ni sale de la
// pantalla. En pantallas angostas va anclado de borde a borde, abajo o arriba,
// en la mitad opuesta al elemento. En pantallas anchas flota junto al elemento,
// en la posición pedida si cabe, o en la primera que quepa; si ninguna cabe,
// también se ancla.
//
// Un elemento más alto que la pantalla (una lista larga de requisitos) no deja
// lugar arriba ni abajo, y su centro queda justo en la mitad de la pantalla:
// elegir el borde por el centro lo hacía saltar de abajo a arriba con cualquier
// desplazamiento de un par de píxeles. Para él la posición es fija: al costado
// si cabe, abajo a la derecha; si no, anclado abajo. Y una vez elegido el lado en
// un paso, `recolocar` lo mantiene (solo sigue al elemento) mientras el
// elemento y la pantalla no cambien de tamaño (lo decide el motor).

import type { Posicion } from './tipos.ts';

export interface Rect { readonly top: number; readonly left: number; readonly width: number; readonly height: number }
export interface Tamano { readonly width: number; readonly height: number }

export type Colocacion =
    | { modo: 'flotante'; lado: Exclude<Posicion, 'auto'>; top: number; left: number; width: number }
    | { modo: 'anclado'; borde: 'abajo' | 'arriba'; top: number; left: number; width: number; altoMax?: number }
    | { modo: 'centrado'; top: number; left: number; width: number };

/** Ancho bajo el cual el globo va siempre anclado. */
export const ANCHO_ANGOSTO = 640;
export const MARGEN = 16;
/** Separación entre el globo y el elemento. */
export const SEPARACION = 12;
/** Halo del resaltado alrededor del elemento: el globo tampoco lo tapa. */
export const HALO = 6;
export const ANCHO_GLOBO = 360;
/**
 * Alto mínimo útil del globo anclado (título, dos líneas y botones). Con menos
 * espacio libre que esto junto al elemento no se le limita el alto: taparía el
 * elemento igual, y además sería ilegible.
 */
export const ALTO_MINIMO_GLOBO = 140;

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

/** ¿El elemento, con su halo, no cabe en el alto de la pantalla? */
export const esMasAltoQueLaVista = (o: Rect, vista: Tamano) => o.height + 2 * HALO > vista.height - 2 * MARGEN;

/**
 * Espacio libre entre el elemento (con su halo y la separación) y el borde de la
 * pantalla donde se ancla el globo, o null si no alcanza para un globo legible.
 */
export function altoLibre(objetivo: Rect | null, vista: Tamano, borde: 'abajo' | 'arriba'): number | null {
    if (!objetivo || esMasAltoQueLaVista(objetivo, vista)) return null;
    const libre = borde === 'abajo'
        ? vista.height - MARGEN - (objetivo.top + objetivo.height + HALO + SEPARACION)
        : objetivo.top - HALO - SEPARACION - MARGEN;
    return libre >= ALTO_MINIMO_GLOBO ? Math.floor(libre) : null;
}

// Anclado, el globo no pasa de la mitad libre: su alto se limita al espacio que
// deja el elemento de ese lado y el texto se desplaza dentro del globo. Antes
// medía lo que pedía su contenido y en el teléfono tapaba la parte de abajo de
// un elemento alto (prueba en terreno del 11 de noviembre de 2026, Mis firmas).
function anclado(objetivo: Rect | null, globo: Tamano, vista: Tamano, borde: 'abajo' | 'arriba' = bordeLibre(objetivo, vista)): Colocacion {
    const width = vista.width - 2 * MARGEN;
    const altoMax = altoLibre(objetivo, vista, borde);
    const alto = altoMax === null ? globo.height : Math.min(globo.height, altoMax);
    const top = borde === 'abajo' ? vista.height - MARGEN - alto : MARGEN;
    return altoMax === null
        ? { modo: 'anclado', borde, left: MARGEN, width, top }
        : { modo: 'anclado', borde, left: MARGEN, width, top, altoMax };
}

/** ¿El globo anclado, con el alto que va a tener, tapa el elemento con su halo? */
const tapa = (c: Colocacion, o: Rect, globo: Tamano) =>
    seCruzan({ top: c.top, left: c.left, width: c.width, height: c.modo === 'anclado' && c.altoMax ? Math.min(globo.height, c.altoMax) : globo.height }, conHalo(o));

type Lado = Exclude<Posicion, 'auto'>;

/** Coordenadas del globo en un lado del elemento, sin revisar si cabe. */
function enLado(lado: Lado, o: Rect, globo: Tamano, vista: Tamano): { top: number; left: number } {
    const w = globo.width;
    const h = globo.height;
    if (lado === 'abajo' || lado === 'arriba') {
        return {
            top: lado === 'abajo' ? o.top + o.height + HALO + SEPARACION : o.top - HALO - SEPARACION - h,
            left: limitar(o.left + o.width / 2 - w / 2, MARGEN, vista.width - MARGEN - w),
        };
    }
    return {
        left: lado === 'derecha' ? o.left + o.width + HALO + SEPARACION : o.left - HALO - SEPARACION - w,
        // Junto a un elemento más alto que la pantalla, abajo y fijo: su centro
        // se mueve con cada desplazamiento.
        top: esMasAltoQueLaVista(o, vista) ? vista.height - MARGEN - h : limitar(o.top + o.height / 2 - h / 2, MARGEN, vista.height - MARGEN - h),
    };
}

function flotante(lado: Lado, o: Rect, globo: Tamano, vista: Tamano): Colocacion | null {
    const w = globo.width;
    const h = globo.height;
    const { top, left } = enLado(lado, o, globo, vista);
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
    const alto = esMasAltoQueLaVista(objetivo, vista);
    if (vista.width < ANCHO_ANGOSTO) return anclado(objetivo, globo, vista, alto ? 'abajo' : undefined);
    const orden = preferida === 'auto' ? ORDEN_AUTO : [preferida, ...ORDEN_AUTO.filter((l) => l !== preferida)];
    for (const lado of orden) {
        if (alto && (lado === 'abajo' || lado === 'arriba')) continue;
        const c = flotante(lado, objetivo, globo, vista);
        if (c) return c;
    }
    return anclado(objetivo, globo, vista, alto ? 'abajo' : undefined);
}

/**
 * La misma elección de antes (modo, lado o borde) con las medidas de ahora: el
 * globo sigue al elemento sin cambiar de lado. Lo usa el motor dentro de un paso
 * mientras el elemento y la pantalla conservan su tamaño; el alto del globo sí
 * puede cambiar (al anclarse cambia de ancho y con eso de alto). Si el lado
 * elegido ya no cabe (la persona desplazó la página), queda dentro de la
 * pantalla en vez de saltar al otro lado.
 */
export function recolocar(previa: Colocacion, objetivo: Rect | null, globo: Tamano, vista: Tamano): Colocacion {
    if (previa.modo === 'anclado') {
        const igual = anclado(objetivo, globo, vista, previa.borde);
        // El borde se eligió con la página todavía desplazándose (el motor trae
        // el elemento a la vista y mide en el cuadro siguiente): si ese borde
        // ahora tapa el elemento y el otro no, se cambia. Solo en ese caso, para
        // no saltar de un borde a otro con cada píxel de desplazamiento.
        if (!objetivo || esMasAltoQueLaVista(objetivo, vista) || !tapa(igual, objetivo, globo)) return igual;
        const otro = anclado(objetivo, globo, vista, previa.borde === 'abajo' ? 'arriba' : 'abajo');
        return tapa(otro, objetivo, globo) ? igual : otro;
    }
    if (previa.modo === 'centrado' || !objetivo) return colocar(objetivo, globo, vista);
    const { top, left } = enLado(previa.lado, objetivo, globo, vista);
    return {
        modo: 'flotante', lado: previa.lado, width: globo.width,
        top: limitar(top, MARGEN, vista.height - MARGEN - globo.height),
        left: limitar(left, MARGEN, vista.width - MARGEN - globo.width),
    };
}
