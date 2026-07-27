import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { FiSearch, FiBookOpen, FiArrowLeft } from 'react-icons/fi';
import { MANUAL_SECTIONS } from './manualNav';
import { getDoc } from './content';
import { extractHeadings } from './headings';
import { searchManual, type SearchResult } from './search';
import ManualHome from './ManualHome';
import ManualPage from './ManualPage';
import './manual.css';

/** Ruta relativa a /manual (sin barra inicial ni final). '' = portada. */
function useRelPath(): string {
    const { pathname } = useLocation();
    return pathname.replace(/^\/manual\/?/, '').replace(/\/+$/, '');
}

function ManualSearch() {
    const navigate = useNavigate();
    const [q, setQ] = useState('');
    const [open, setOpen] = useState(false);
    const boxRef = useRef<HTMLDivElement>(null);
    const results: SearchResult[] = useMemo(() => (q ? searchManual(q) : []), [q]);

    useEffect(() => {
        const onClick = (e: MouseEvent) => {
            if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
        };
        document.addEventListener('mousedown', onClick);
        return () => document.removeEventListener('mousedown', onClick);
    }, []);

    const go = (slug: string) => {
        setQ(''); setOpen(false);
        navigate(`/manual/${slug}`);
    };

    return (
        <div className="manual-search" ref={boxRef}>
            <FiSearch className="manual-search__icon" aria-hidden="true" />
            <input
                className="manual-search__input"
                type="search"
                placeholder="Buscar en el manual…"
                value={q}
                onChange={(e) => { setQ(e.target.value); setOpen(true); }}
                onFocus={() => setOpen(true)}
                aria-label="Buscar en el manual"
            />
            {open && results.length > 0 && (
                <ul className="manual-search__results">
                    {results.map((r) => (
                        <li key={r.slug}>
                            <button type="button" onClick={() => go(r.slug)}>
                                <span className="manual-search__title">{r.title}</span>
                                <span className="manual-search__snippet">{r.snippet}</span>
                            </button>
                        </li>
                    ))}
                </ul>
            )}
            {open && q.length >= 2 && results.length === 0 && (
                <ul className="manual-search__results">
                    <li className="manual-search__empty">Sin resultados para “{q}”.</li>
                </ul>
            )}
        </div>
    );
}

function Sidebar({ activePath }: { activePath: string }) {
    return (
        <nav className="manual-sidebar" aria-label="Secciones del manual">
            <Link to="/" className="manual-sidebar__back">
                <FiArrowLeft aria-hidden="true" /> Volver a la aplicación
            </Link>
            <Link to="/manual" className="manual-sidebar__brand">
                <FiBookOpen aria-hidden="true" /> Manual de uso
            </Link>
            <ManualSearch />
            {MANUAL_SECTIONS.map((sec) => (
                <div key={sec.slug} className="manual-sidebar__group">
                    <p className="manual-sidebar__group-title">{sec.text}</p>
                    <ul>
                        {sec.items.map((it) => {
                            const rel = it.link.replace(/\/+$/, '');
                            const active = rel === activePath;
                            return (
                                <li key={it.link}>
                                    <Link
                                        to={`/manual/${it.link}`}
                                        className={active ? 'is-active' : ''}
                                        aria-current={active ? 'page' : undefined}
                                    >
                                        {it.text}
                                    </Link>
                                </li>
                            );
                        })}
                    </ul>
                </div>
            ))}
        </nav>
    );
}

export default function ManualLayout() {
    const rel = useRelPath();
    const { hash, pathname } = useLocation();
    const doc = rel ? getDoc(rel) : undefined;
    const headings = useMemo(() => (doc ? extractHeadings(doc.body) : []), [doc]);
    const contentRef = useRef<HTMLDivElement>(null);

    // Scroll: al ancla si la hay, o arriba al cambiar de página.
    useEffect(() => {
        if (hash) {
            const el = document.getElementById(decodeURIComponent(hash.slice(1)));
            if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
        }
        contentRef.current?.scrollTo?.({ top: 0 });
        window.scrollTo({ top: 0 });
    }, [pathname, hash]);

    return (
        <div className="manual-shell">
            <Sidebar activePath={rel} />

            <main className="manual-content" ref={contentRef}>
                {!rel ? (
                    <ManualHome />
                ) : doc ? (
                    <ManualPage doc={doc} />
                ) : (
                    <div className="manual-prose">
                        <h1>Página no encontrada</h1>
                        <p>La página que buscas no existe en el manual.</p>
                        <p><Link to="/manual">Volver al inicio del manual →</Link></p>
                    </div>
                )}
            </main>

            {doc && headings.length > 0 && (
                <aside className="manual-toc" aria-label="En esta página">
                    <p className="manual-toc__title">En esta página</p>
                    <ul>
                        {headings.map((h) => (
                            <li key={h.id} className={h.depth === 3 ? 'is-sub' : ''}>
                                <a href={`#${h.id}`}>{h.text}</a>
                            </li>
                        ))}
                    </ul>
                </aside>
            )}
        </div>
    );
}
