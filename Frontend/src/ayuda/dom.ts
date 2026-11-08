// Encontrar el elemento de un paso, esperarlo si todavía no se renderiza y
// traerlo a la vista. Recibe el documento: así se prueba con happy-dom
// (tests/ayuda-dom.test.mjs) y con un navegador real (tests/e2e).

import type { AnclaKey } from './registro.ts';

/** Espera por omisión para que aparezca un ancla (falla 2). El motor la recibe como opción. */
export const ESPERA_ANCLA_MS = 4000;

/**
 * Margen para un ancla que ya está en la página pero oculta (el menú lateral o
 * la obra actual en el teléfono, ocultos por CSS). La espera larga es para lo
 * que todavía no se dibuja; lo que el diseño oculta no va a aparecer, y esperar
 * el plazo completo por cada uno retrasaba segundos el recorrido.
 */
export const ESPERA_ANCLA_OCULTA_MS = 300;

/**
 * Selector de un ancla. Las claves salen del registro (minúsculas, dígitos,
 * guiones y un punto), nunca de texto de un recorrido; igual se escapan, por si
 * algún día el registro admite otra cosa (falla 7).
 */
export function selectorDe(clave: AnclaKey, doc: Document): string {
    const escapar = doc.defaultView?.CSS?.escape;
    const valor = escapar ? escapar(clave) : clave.replace(/["\\]/g, '\\$&');
    return `[data-tour="${valor}"]`;
}

/**
 * ¿Se puede resaltar? Sí si ocupa espacio, no está oculto por estilo y no está
 * desplazado fuera de la pantalla en horizontal (el menú lateral cerrado en un
 * teléfono). Que esté más abajo, fuera de la vista vertical, NO lo descarta: se
 * desplaza hasta él (falla 1).
 */
export function visible(el: Element): boolean {
    const win = el.ownerDocument.defaultView;
    if (!win) return false;
    const estilo = win.getComputedStyle(el);
    if (estilo.display === 'none' || estilo.visibility === 'hidden' || estilo.visibility === 'collapse') return false;
    if (estilo.opacity !== '' && Number(estilo.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    if (r.right <= 0 || r.left >= win.innerWidth) return false;
    // Un ancestro con display:none también lo oculta; getBoundingClientRect ya lo
    // da en cero en un navegador real. happy-dom no calcula diseño, así que se
    // revisa la cadena.
    for (let p = el.parentElement; p; p = p.parentElement) {
        const e = win.getComputedStyle(p);
        if (e.display === 'none' || e.visibility === 'hidden') return false;
    }
    return true;
}

/** ¿Hay en la página algún elemento con esa ancla, visible o no? */
const existeAncla = (clave: AnclaKey, doc: Document) => doc.querySelector(selectorDe(clave, doc)) !== null;

/** El primer elemento visible con esa ancla, o null. */
export function buscarAncla(clave: AnclaKey, doc: Document): HTMLElement | null {
    for (const el of Array.from(doc.querySelectorAll<HTMLElement>(selectorDe(clave, doc)))) {
        if (visible(el)) return el;
    }
    return null;
}

/**
 * Espera a que el ancla exista y sea visible, hasta `espera` ms. Resuelve en
 * cuanto aparece (MutationObserver sobre todo el documento, incluidos cambios
 * de atributos que la hagan visible), o null al vencer el plazo o al cancelar.
 * Si el ancla ya está en la página pero oculta, espera solo `esperaOculta`.
 */
export function esperarAncla(clave: AnclaKey, doc: Document, { espera = ESPERA_ANCLA_MS, esperaOculta = ESPERA_ANCLA_OCULTA_MS, senal }: { espera?: number; esperaOculta?: number; senal?: AbortSignal } = {}): Promise<HTMLElement | null> {
    const ya = buscarAncla(clave, doc);
    if (ya) return Promise.resolve(ya);
    const win = doc.defaultView;
    if (!win || senal?.aborted) return Promise.resolve(null);

    return new Promise((resolver) => {
        let listo = false;
        const terminar = (el: HTMLElement | null) => {
            if (listo) return;
            listo = true;
            observador.disconnect();
            win.clearTimeout(plazo);
            senal?.removeEventListener('abort', alCancelar);
            resolver(el);
        };
        const alCancelar = () => terminar(null);
        const observador = new win.MutationObserver(() => {
            const el = buscarAncla(clave, doc);
            if (el) terminar(el);
        });
        observador.observe(doc.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style', 'hidden', 'data-tour'] });
        const plazo = win.setTimeout(() => terminar(buscarAncla(clave, doc)), existeAncla(clave, doc) ? Math.min(esperaOculta, espera) : espera);
        senal?.addEventListener('abort', alCancelar);
    });
}

/**
 * Lleva el elemento a la vista. `margenSuperior` deja libre la cabecera fija
 * (si no, el elemento queda debajo de ella) y `bloque` dice si se quiere arriba
 * o al centro: en un teléfono el globo va abajo, así que el elemento va arriba.
 */
export function traerALaVista(el: HTMLElement, { margenSuperior = 0, bloque = 'center' as ScrollLogicalPosition } = {}) {
    const previo = el.style.scrollMarginTop;
    el.style.scrollMarginTop = `${margenSuperior}px`;
    el.scrollIntoView({ block: bloque, inline: 'nearest', behavior: 'auto' });
    el.style.scrollMarginTop = previo;
}
