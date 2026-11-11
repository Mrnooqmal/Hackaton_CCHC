// Carga de las páginas del manual. Vite incluye todos los .md de content/ en el
// bundle como texto crudo (import.meta.glob ?raw, eager), sin script externo.
// En el build de prod, una página pendiente de revisión normativa llega como
// null (vite-manual-pendiente.ts) y no se publica: ver publicacion.ts.

import { sinFilasNoPublicadas } from './publicacion';

const modulos = import.meta.glob('./content/**/*.md', {
    query: '?raw',
    import: 'default',
    eager: true,
}) as Record<string, string | null>;

export interface ManualDoc {
    /** Slug canónico, sin barra inicial ni final (ej. 'ds44/epp', 'ds44'). */
    slug: string;
    title: string;
    /** Cuerpo markdown sin frontmatter. */
    body: string;
}

/** Quita un bloque de frontmatter YAML inicial (--- … ---) si existe. */
function stripFrontmatter(raw: string): string {
    const m = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(raw);
    return m ? raw.slice(m[0].length) : raw;
}

/** Primer encabezado `# ...` como título; si no hay, usa el slug. */
function extractTitle(body: string, slug: string): string {
    const m = /^#\s+(.+?)\s*$/m.exec(body);
    return m ? m[1].trim() : slug;
}

/** './content/ds44/epp.md' → 'ds44/epp' ; './content/ds44/index.md' → 'ds44'. */
function pathToSlug(filePath: string): string {
    let s = filePath.replace(/^\.\/content\//, '').replace(/\.md$/, '');
    if (s.endsWith('/index')) s = s.slice(0, -'/index'.length);
    return s;
}

const DOCS: Record<string, ManualDoc> = {};
for (const [filePath, raw] of Object.entries(modulos)) {
    if (typeof raw !== 'string') continue;
    const slug = pathToSlug(filePath);
    const body = stripFrontmatter(raw);
    DOCS[slug] = { slug, title: extractTitle(body, slug), body };
}

// Ya con todas las páginas: una fila de tabla que presenta una página no
// publicada en este build no se muestra ni se busca.
for (const doc of Object.values(DOCS)) {
    doc.body = sinFilasNoPublicadas(doc.body, (pagina) => pagina === '' || pagina in DOCS);
}

/** Normaliza una ruta relativa a /manual a su slug canónico. */
export function normalizeSlug(relPath: string): string {
    return relPath.replace(/^\/+/, '').replace(/\/+$/, '');
}

export function getDoc(relPath: string): ManualDoc | undefined {
    return DOCS[normalizeSlug(relPath)];
}

export function allDocs(): ManualDoc[] {
    return Object.values(DOCS);
}

/** Si la página (ruta relativa a /manual) está publicada en este build. */
export function existePagina(relPath: string): boolean {
    return normalizeSlug(relPath) in DOCS;
}
