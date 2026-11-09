import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkDirective from 'remark-directive';
import rehypeSlug from 'rehype-slug';
import rehypeAutolinkHeadings from 'rehype-autolink-headings';
import Callout from './Callout';
import { normalizeVitepressContainers, remarkCalloutData } from './remarkCallout';
import { existePagina, type ManualDoc } from './content';
import { resolverEnlace } from './publicacion';
import { destinoDe } from './redirecciones';
import { useRecorridos } from '../ayuda/contexto';

/** `recorrido:<id>` pasa tal cual; todo lo demás, con la limpieza de siempre (sin `javascript:`). */
const transformarUrl = (url: string) => (/^recorrido:[a-z0-9-]+$/.test(url) ? url : defaultUrlTransform(url));

const remarkPlugins = [remarkGfm, remarkDirective, remarkCalloutData];
const rehypePlugins = [rehypeSlug, [rehypeAutolinkHeadings, { behavior: 'wrap' }]] as never;

/**
 * "Ver recorrido": `[Ver recorrido](recorrido:<id>)` lleva a la pantalla del
 * recorrido y lo abre. Solo aparece si la persona puede verlo: sin sesión (el
 * manual es público), sin permiso o con el recorrido fuera de vigencia, el
 * enlace no se muestra.
 */
function EnlaceRecorrido({ id, children }: { id: string; children: ReactNode }) {
    const { enlaceA } = useRecorridos();
    const destino = enlaceA(id);
    return destino ? <Link to={destino} className="manual-ver-recorrido">{children}</Link> : null;
}

/**
 * Reescribe los enlaces del manual a rutas SPA (/manual/...) o externas. Un
 * enlace a una página que no se publica en este build (pendiente de revisión
 * normativa, en prod) queda como texto: nunca un enlace roto.
 */
function MdLink({ href = '', children }: ComponentPropsWithoutRef<'a'>) {
    const e = resolverEnlace(String(href), existePagina, destinoDe);
    switch (e.tipo) {
        case 'recorrido': return <EnlaceRecorrido id={e.url.slice('recorrido:'.length)}>{children}</EnlaceRecorrido>;
        case 'externo': return <a href={e.url} target="_blank" rel="noopener noreferrer">{children}</a>;
        case 'ancla': return <a href={e.url}>{children}</a>; // ancla en la misma página
        case 'interno': return <Link to={e.to}>{children}</Link>;
        case 'texto': return <>{children}</>;
    }
}

/** Imágenes del manual: las capturas viven en public/manual-img (antes /img). */
function MdImg({ src, alt, node, ...props }: ComponentPropsWithoutRef<'img'> & { node?: unknown }) {
    void node;
    const s = typeof src === 'string' ? src.replace(/^\/img\//, '/manual-img/') : src;
    return <img src={s} alt={alt ?? ''} loading="lazy" {...props} />;
}

const components = {
    a: MdLink,
    img: MdImg,
    div({ className, children, node, ...props }: ComponentPropsWithoutRef<'div'> & { node?: unknown }) {
        void node;
        if (className && /(^|\s)callout(\s|$)/.test(className)) {
            const type = /callout-(\w+)/.exec(className)?.[1] ?? 'info';
            const title = (props as Record<string, string>)['data-callout-title'];
            return <Callout type={type} title={title}>{children}</Callout>;
        }
        return <div className={className} {...props}>{children}</div>;
    },
};

/** `body`: el markdown ya filtrado según el rol (ver `filtro.tsx`); si falta, el completo. */
export default function ManualPage({ doc, body }: { doc: ManualDoc; body?: string }): ReactNode {
    const md = normalizeVitepressContainers(body ?? doc.body);
    return (
        <article className="manual-prose">
            <ReactMarkdown
                remarkPlugins={remarkPlugins}
                rehypePlugins={rehypePlugins}
                components={components}
                urlTransform={transformarUrl}
            >
                {md}
            </ReactMarkdown>
        </article>
    );
}
