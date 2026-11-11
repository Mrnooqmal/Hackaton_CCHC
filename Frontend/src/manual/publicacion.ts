// Qué páginas del manual se publican en cada ambiente.
//
// Una página con `revision: pendiente-normativa` en el frontmatter (hoy, la
// sección FUF y DS 44) espera la revisión de alguien con criterio normativo.
// Como los recorridos en borrador: en dev se ve, para revisarla; en el build de
// prod no entra (vite-manual-pendiente.ts la deja fuera del bundle). Los enlaces
// que llevan a ella desde páginas publicadas se muestran como texto, sin enlace,
// para que en prod no haya enlaces rotos.
//
// Solo funciones puras: las usan el plugin de Vite, el verificador de recorridos,
// el manual en el navegador y las pruebas (Node las ejecuta directamente).

/** Frontmatter `revision: pendiente-normativa` al comienzo de una página. */
export const pendienteNormativa = (texto: string): boolean =>
    /^---\r?\n(?:[\s\S]*?\r?\n)?revision:\s*pendiente-normativa\s*\r?\n[\s\S]*?---/.test(texto);

/** Ruta de un archivo del manual a su página: 'fuf/index.md' → 'fuf', 'fuf/firmas.md' → 'fuf/firmas'. */
export const paginaDeArchivo = (relativa: string): string =>
    relativa.replace(/\.md$/, '').replace(/(^|\/)index$/, '');

export type EnlaceManual =
    | { tipo: 'externo' | 'ancla' | 'recorrido'; url: string }
    | { tipo: 'interno'; to: string }
    /** Lleva a una página que no está publicada en este build: va como texto. */
    | { tipo: 'texto' };

/**
 * Cómo se muestra un enlace del markdown del manual. `existe(pagina)` dice si la
 * página está en este build; `destinoViejo(pagina, ancla)` resuelve las
 * direcciones del manual anterior (null si no es vieja).
 */
export function resolverEnlace(
    href: string,
    existe: (pagina: string) => boolean,
    destinoViejo: (pagina: string, ancla: string) => string | null,
): EnlaceManual {
    if (href.startsWith('recorrido:')) return { tipo: 'recorrido', url: href };
    if (/^(https?:|mailto:|tel:)/.test(href)) return { tipo: 'externo', url: href };
    if (href.startsWith('#')) return { tipo: 'ancla', url: href };

    let to = href.replace(/\.(md|html)(?=$|#)/, '');
    if (!to.startsWith('/')) to = '/' + to;
    const [ruta, ancla = ''] = to.split('#');
    const pagina = ruta.replace(/^\/+|\/+$/g, '');
    if (pagina === '' || existe(pagina)) return { tipo: 'interno', to: '/manual' + to };
    const viejo = destinoViejo(pagina, ancla);
    if (viejo) {
        const nueva = viejo.replace(/^\/manual\/?/, '').split('#')[0];
        if (nueva === '' || existe(nueva)) return { tipo: 'interno', to: viejo };
    }
    return { tipo: 'texto' };
}

/**
 * Quita las filas de tabla que llevan a una página no publicada en este build:
 * una fila que presenta una sección que no existe no se arregla sacándole el
 * enlace. El resto del markdown queda igual.
 */
export function sinFilasNoPublicadas(markdown: string, existe: (pagina: string) => boolean): string {
    return markdown.split('\n').filter((linea) => {
        if (!linea.trimStart().startsWith('|')) return true;
        return ![...linea.matchAll(/\]\(\/([^)#\s]*)(?:#[^)\s]*)?\)/g)]
            .some((m) => !m[1].startsWith('img/') && !existe(m[1].replace(/\/+$/, '')));
    }).join('\n');
}

/**
 * A dónde lleva una dirección vieja del manual en este build: su página nueva
 * si está publicada; si no (por ejemplo, una de DS 44 en prod mientras FUF
 * espera la revisión), la portada del manual. null si la dirección no es vieja.
 */
export function redireccionPublicada(
    pagina: string,
    ancla: string,
    existe: (pagina: string) => boolean,
    destinoViejo: (pagina: string, ancla: string) => string | null,
): string | null {
    const destino = destinoViejo(pagina, ancla);
    if (!destino) return null;
    const nueva = destino.replace(/^\/manual\/?/, '').split('#')[0];
    return nueva === '' || existe(nueva) ? destino : '/manual';
}
