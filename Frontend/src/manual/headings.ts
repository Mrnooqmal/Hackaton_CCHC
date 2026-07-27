// Extrae los encabezados H2/H3 del markdown para el índice "En esta página".
// Usa github-slugger (el mismo que rehype-slug) para que los IDs coincidan con
// los que se generan al renderizar, y así el scroll a #ancla funcione.

import GithubSlugger from 'github-slugger';

export interface Heading {
    depth: 2 | 3;
    text: string;
    id: string;
}

export function extractHeadings(body: string): Heading[] {
    const slugger = new GithubSlugger();
    const headings: Heading[] = [];
    let enCodigo = false;

    for (const linea of body.split('\n')) {
        if (/^```/.test(linea.trim())) { enCodigo = !enCodigo; continue; }
        if (enCodigo) continue;

        const m = /^(#{2,3})\s+(.+?)\s*$/.exec(linea);
        if (!m) continue;
        const depth = m[1].length as 2 | 3;
        // Texto plano del encabezado (sin marcas markdown ni enlaces).
        const text = m[2]
            .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
            .replace(/[*_`]/g, '')
            .trim();
        headings.push({ depth, text, id: slugger.slug(text) });
    }
    return headings;
}
