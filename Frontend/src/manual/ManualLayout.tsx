import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { FiSearch, FiBookOpen, FiArrowLeft, FiMenu, FiX } from 'react-icons/fi';
import { MANUAL_SECTIONS, permisoDePagina } from './manualNav';
import { filtrarMarkdown, useFiltroManual } from './filtro';
import FiltroManualProvider from './FiltroManualProvider';
import Callout from './Callout';
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
    const { puede } = useFiltroManual();
    const results: SearchResult[] = useMemo(() => (q ? searchManual(q, 10, puede) : []), [q, puede]);

    useEffect(() => {
        const onClick = (e: MouseEvent) => {
            if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
        };
        document.addEventListener('mousedown', onClick);
        return () => document.removeEventListener('mousedown', onClick);
    }, []);

    const go = (r: SearchResult) => {
        setQ(''); setOpen(false);
        navigate(`/manual/${r.slug}${r.anchor ? `#${r.anchor}` : ''}`);
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
                onKeyDown={(e) => { if (e.key === 'Enter' && results[0]) go(results[0]); if (e.key === 'Escape') setOpen(false); }}
                aria-label="Buscar en el manual"
            />
            {open && results.length > 0 && (
                <ul className="manual-search__results">
                    {results.map((r) => (
                        <li key={`${r.slug}#${r.anchor ?? ''}`}>
                            <button type="button" onClick={() => go(r)}>
                                <span className="manual-search__title">{r.title}</span>
                                {r.anchor && <span className="manual-search__page">{r.page}</span>}
                                {r.snippet && <span className="manual-search__snippet">{r.snippet}</span>}
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

/**
 * Interruptor "Mi rol / Todo el manual". Solo con sesión: sin ella no hay rol
 * con qué filtrar y se ve todo.
 */
function VerTodo() {
    const { conSesion, verTodo, setVerTodo } = useFiltroManual();
    if (!conSesion) return null;
    return (
        <div className="manual-vertodo">
            <div className="manual-vertodo__opciones" role="group" aria-label="Qué parte del manual ver">
                <button type="button" aria-pressed={!verTodo} onClick={() => setVerTodo(false)}>Mi rol</button>
                <button type="button" aria-pressed={verTodo} onClick={() => setVerTodo(true)}>Todo el manual</button>
            </div>
            <p className="manual-vertodo__nota">
                {verTodo
                    ? 'Estás viendo el manual completo, también lo que tu rol no usa.'
                    : 'Solo lo que tu rol puede hacer.'}
            </p>
        </div>
    );
}

function Sidebar({
    activePath,
    open,
    onNavigate,
}: {
    activePath: string;
    open: boolean;
    onNavigate: () => void;
}) {
    const { puede } = useFiltroManual();
    return (
        <nav
            className={`manual-sidebar${open ? ' is-open' : ''}`}
            aria-label="Secciones del manual"
        >
            <button
                type="button"
                className="manual-sidebar__close"
                onClick={onNavigate}
                aria-label="Cerrar menú"
            >
                <FiX aria-hidden="true" />
            </button>
            <ManualSearch />
            <VerTodo />
            {MANUAL_SECTIONS.map((sec) => ({ sec, items: sec.items.filter((it) => puede(it.permiso)) }))
                .filter(({ items }) => items.length > 0)
                .map(({ sec, items }) => (
                <div key={sec.slug} className="manual-sidebar__group">
                    <p className="manual-sidebar__group-title">{sec.text}</p>
                    <ul>
                        {items.map((it) => {
                            const rel = it.link.replace(/\/+$/, '');
                            const active = rel === activePath;
                            return (
                                <li key={it.link}>
                                    <Link
                                        to={`/manual/${it.link}`}
                                        className={active ? 'is-active' : ''}
                                        aria-current={active ? 'page' : undefined}
                                        onClick={onNavigate}
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
    return (
        <FiltroManualProvider>
            <ManualLayoutContenido />
        </FiltroManualProvider>
    );
}

function ManualLayoutContenido() {
    const rel = useRelPath();
    const { hash, pathname } = useLocation();
    const { puede } = useFiltroManual();
    const doc = rel ? getDoc(rel) : undefined;
    // El cuerpo ya sin las secciones que la persona no ve: de él salen la página
    // y el índice "En esta página", para que no apunte a secciones ocultas.
    const body = useMemo(() => (doc ? filtrarMarkdown(doc.body, puede) : ''), [doc, puede]);
    const headings = useMemo(() => (doc ? extractHeadings(body) : []), [doc, body]);
    const paginaOculta = Boolean(doc) && !puede(permisoDePagina(rel));
    const contentRef = useRef<HTMLDivElement>(null);
    const [menuOpen, setMenuOpen] = useState(false);

    // Scroll: al ancla si la hay, o arriba al cambiar de página.
    useEffect(() => {
        if (hash) {
            const el = document.getElementById(decodeURIComponent(hash.slice(1)));
            if (el) {
                el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                // Las capturas que están sobre la sección cargan después del salto y
                // empujan el contenido hacia abajo: se vuelve a alinear mientras el
                // contenido cambia de tamaño, hasta que la persona mueva la página.
                const alinear = () => el.scrollIntoView({ block: 'start' });
                const ro = new ResizeObserver(alinear);
                if (contentRef.current) ro.observe(contentRef.current);
                const soltar = () => {
                    ro.disconnect();
                    ['wheel', 'touchstart', 'keydown'].forEach((t) => window.removeEventListener(t, soltar));
                };
                ['wheel', 'touchstart', 'keydown'].forEach((t) => window.addEventListener(t, soltar, { passive: true }));
                const fin = window.setTimeout(soltar, 2500);
                return () => { window.clearTimeout(fin); soltar(); };
            }
        }
        contentRef.current?.scrollTo?.({ top: 0 });
        window.scrollTo({ top: 0 });
    }, [pathname, hash]);

    // Cierra el menú lateral (drawer móvil) al navegar a otra página.
    useEffect(() => { setMenuOpen(false); }, [pathname]);

    return (
        <div className="manual-root">
            {/* ── Navbar identitaria (marca Build & Serve) ── */}
            <header className="manual-navbar">
                <div className="manual-navbar__inner">
                    <div className="manual-navbar__left">
                        <button
                            type="button"
                            className="manual-menu-btn"
                            onClick={() => setMenuOpen(true)}
                            aria-label="Abrir menú de secciones"
                            aria-expanded={menuOpen}
                        >
                            <FiMenu aria-hidden="true" />
                        </button>
                        <Link
                            to="/manual"
                            className="manual-navbar__brand"
                            aria-label="Build & Serve — Manual de uso"
                        >
                            <span className="manual-navbar__bs">
                                <span className="manual-navbar__bs-build">Build</span>
                                <span className="manual-navbar__bs-amp">&amp;</span>
                                <span className="manual-navbar__bs-serve">Serve</span>
                            </span>
                            <span className="manual-navbar__sub">
                                <FiBookOpen aria-hidden="true" /> Manual de uso
                            </span>
                        </Link>
                    </div>
                    <Link to="/" className="manual-navbar__back">
                        <FiArrowLeft aria-hidden="true" />
                        <span className="manual-navbar__back-text">Volver a la aplicación</span>
                    </Link>
                </div>
            </header>

            <div className="manual-shell">
                {menuOpen && (
                    <div
                        className="manual-overlay"
                        onClick={() => setMenuOpen(false)}
                        aria-hidden="true"
                    />
                )}

                <Sidebar activePath={rel} open={menuOpen} onNavigate={() => setMenuOpen(false)} />

                <main className="manual-content" ref={contentRef}>
                    {!rel ? (
                        <ManualHome />
                    ) : doc ? (
                        <>
                            {paginaOculta && (
                                <div className="manual-prose">
                                    <Callout type="info" title="Esta página no es de tu rol">
                                        <p>
                                            Describe funciones que tu rol no tiene, por eso no aparece en el menú.
                                            Si las necesitas, pídele el permiso al administrador de tu empresa.
                                        </p>
                                    </Callout>
                                </div>
                            )}
                            <ManualPage doc={doc} body={body} />
                        </>
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
        </div>
    );
}
