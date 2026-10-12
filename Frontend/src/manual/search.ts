// Buscador cliente del manual (reemplaza el "local search" de VitePress).
//
// Indexa cada SECCIÓN por separado, no la página entera: cada subtítulo (H2 y
// H3) es un resultado propio que lleva directo a ese punto de la página. Lo que
// hay antes del primer subtítulo cuenta como la sección de la página misma. Así,
// buscar "menú lateral" encuentra el punto de Primeros pasos que lo explica, y
// no solo la página donde aparece.

import MiniSearch from 'minisearch';
import GithubSlugger from 'github-slugger';
import { allDocs } from './content';

export interface SearchResult {
    /** Página (ruta relativa a /manual). */
    slug: string;
    /** Ancla del subtítulo, o null si el resultado es la página completa. */
    anchor: string | null;
    /** Subtítulo (o título de la página si no hay subtítulo). */
    title: string;
    /** Título de la página a la que pertenece. */
    page: string;
    snippet: string;
}

interface Seccion {
    id: string;
    slug: string;
    anchor: string | null;
    titulo: string;
    pagina: string;
    text: string;
}

// Quita marcas markdown para el índice y los snippets (texto plano legible).
function toPlain(md: string): string {
    return md
        .replace(/```[\s\S]*?```/g, ' ')         // bloques de código
        .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')    // imágenes
        .replace(/^#{1,6}\s+/gm, '')              // encabezados
        .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')  // enlaces → solo el texto
        .replace(/:::\s*\w*/g, ' ')               // aperturas de callout
        .replace(/[*_`>#|]/g, ' ')                // símbolos markdown
        .replace(/\s+/g, ' ')
        .trim();
}

/** Texto de un encabezado tal como lo muestra la página (mismo criterio que headings.ts). */
const textoEncabezado = (md: string) => md.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/[*_`]/g, '').trim();

/** Parte una página en secciones por sus subtítulos H2 y H3. */
function seccionesDe(slug: string, pagina: string, body: string): Seccion[] {
    const slugger = new GithubSlugger();
    const secciones: Seccion[] = [];
    let actual = { anchor: null as string | null, titulo: pagina, lineas: [] as string[] };
    let enCodigo = false;

    const cerrar = () => {
        const text = toPlain(actual.lineas.join('\n'));
        if (text || actual.anchor) {
            secciones.push({
                id: actual.anchor ? `${slug}#${actual.anchor}` : slug,
                slug, anchor: actual.anchor, titulo: actual.titulo, pagina, text,
            });
        }
    };

    for (const linea of body.split('\n')) {
        if (/^```/.test(linea.trim())) enCodigo = !enCodigo;
        const m = !enCodigo && /^(#{2,3})\s+(.+?)\s*$/.exec(linea);
        if (m) {
            cerrar();
            const titulo = textoEncabezado(m[2]);
            actual = { anchor: slugger.slug(titulo), titulo, lineas: [] };
            continue;
        }
        // El título de la página (H1) ya va en `pagina`.
        if (!enCodigo && /^#\s+/.test(linea)) continue;
        actual.lineas.push(linea);
    }
    cerrar();
    return secciones;
}

const secciones = allDocs().flatMap((d) => seccionesDe(d.slug, d.title, d.body));
const porId = new Map(secciones.map((s) => [s.id, s] as const));

/** Minúsculas y sin tildes: "menu" encuentra "menú". */
const normalizar = (t: string) => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

const mini = new MiniSearch<Seccion>({
    fields: ['titulo', 'pagina', 'text'],
    storeFields: ['id'],
    processTerm: (t) => normalizar(t),
    searchOptions: {
        // El subtítulo pesa más que el cuerpo: quien escribe "menú lateral" busca
        // el punto que se llama así, no todos los que lo mencionan.
        boost: { titulo: 4, pagina: 1.5 },
        prefix: true,
        fuzzy: 0.2,
        combineWith: 'AND',
    },
});
mini.addAll(secciones);

function makeSnippet(s: Seccion, query: string): string {
    const text = s.text;
    if (!text) return '';
    const plano = normalizar(text);
    const term = normalizar(query.trim().split(/\s+/)[0] ?? '');
    const idx = term ? plano.indexOf(term) : -1;
    if (idx < 0) return text.slice(0, 120) + (text.length > 120 ? '…' : '');
    const start = Math.max(0, idx - 50);
    return (start > 0 ? '…' : '') + text.slice(start, start + 140).trim() + '…';
}

export function searchManual(query: string, limit = 10): SearchResult[] {
    const q = query.trim();
    if (q.length < 2) return [];
    // Si ninguna sección tiene todas las palabras, se aceptan las que tengan alguna.
    let hits = mini.search(q);
    if (hits.length === 0) hits = mini.search(q, { combineWith: 'OR' });
    return hits.slice(0, limit).map((r) => {
        const s = porId.get(r.id as string)!;
        return { slug: s.slug, anchor: s.anchor, title: s.titulo, page: s.pagina, snippet: makeSnippet(s, q) };
    });
}
