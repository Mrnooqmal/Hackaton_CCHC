// Buscador cliente del manual (reemplaza el "local search" de VitePress).
// Indexa título + cuerpo de cada página con minisearch.

import MiniSearch from 'minisearch';
import { allDocs } from './content';

export interface SearchResult {
    slug: string;
    title: string;
    snippet: string;
}

// Quita marcas markdown para el índice y los snippets (texto plano legible).
function toPlain(md: string): string {
    return md
        .replace(/```[\s\S]*?```/g, ' ')       // bloques de código
        .replace(/^#{1,6}\s+/gm, '')             // encabezados
        .replace(/[*_`>#|]/g, ' ')               // símbolos markdown
        .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')  // enlaces → solo el texto
        .replace(/:::\s*\w*/g, ' ')              // aperturas de callout
        .replace(/\s+/g, ' ')
        .trim();
}

const docs = allDocs().map((d) => ({ id: d.slug, title: d.title, text: toPlain(d.body) }));
const textById = new Map(docs.map((d) => [d.id, d.text] as const));
const titleById = new Map(allDocs().map((d) => [d.slug, d.title] as const));

const mini = new MiniSearch<{ id: string; title: string; text: string }>({
    fields: ['title', 'text'],
    storeFields: ['title'],
    searchOptions: { boost: { title: 3 }, prefix: true, fuzzy: 0.2 },
});
mini.addAll(docs);

function makeSnippet(slug: string, query: string): string {
    const text = textById.get(slug) ?? '';
    const term = query.trim().split(/\s+/)[0]?.toLowerCase() ?? '';
    const idx = term ? text.toLowerCase().indexOf(term) : -1;
    if (idx < 0) return text.slice(0, 120) + (text.length > 120 ? '…' : '');
    const start = Math.max(0, idx - 50);
    return (start > 0 ? '…' : '') + text.slice(start, start + 140).trim() + '…';
}

export function searchManual(query: string, limit = 8): SearchResult[] {
    const q = query.trim();
    if (q.length < 2) return [];
    return mini.search(q).slice(0, limit).map((r) => ({
        slug: r.id as string,
        title: titleById.get(r.id as string) ?? (r.id as string),
        snippet: makeSnippet(r.id as string, q),
    }));
}
