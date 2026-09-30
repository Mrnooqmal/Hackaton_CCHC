import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { FiAlertTriangle, FiBriefcase, FiChevronRight, FiLogOut, FiRotateCw, FiSearch } from 'react-icons/fi';
import { useAuth } from '../context/AuthContext';
import { useObraContext } from '../context/ObraContext';
import { useBrand } from '../context/BrandContext';
import { useObraImagenes } from '../hooks/useObraImagenes';

// Con pocas obras se ven todas de un vistazo; desde aquí conviene poder filtrar.
const OBRAS_PARA_BUSCADOR = 6;

/**
 * Paso siguiente al login: elegir dónde se va a trabajar.
 *
 * La plataforma opera siempre sobre una obra, así que la obra se elige una vez
 * al entrar y no con un selector suelto en el header. Quien administra la
 * empresa tiene además la opción de quedarse en la vista global.
 *
 * Cuando no hay nada que preguntar (una sola obra y sin acceso a la empresa, o
 * ninguna obra) el ámbito ya viene resuelto por ObraContext y esta pantalla se
 * limita a seguir de largo.
 */
export default function SeleccionObra() {
    const { user, logout } = useAuth();
    const {
        obras,
        isLoadingObras,
        refreshObras,
        scopeElegido,
        puedeGestionarEmpresa,
        elegirObra,
        elegirEmpresa,
    } = useObraContext();
    const { logo } = useBrand();
    const navigate = useNavigate();
    const location = useLocation();

    // Destino tras elegir obra: la ruta que se quiso abrir, salvo que pertenezca
    // a la obra anterior (el detalle de otra obra no aplica al nuevo ámbito).
    const destino = useMemo(() => {
        const pedido = (location.state as any)?.from?.pathname as string | undefined;
        if (!pedido || pedido === '/seleccionar-obra' || pedido.startsWith('/obras/')) return '/';
        return pedido;
    }, [location.state]);

    // Si el ámbito se resolvió sin preguntar, entra directo. El flag evita que
    // esta redirección compita con la del clic de la persona.
    const eligiendo = useRef(false);
    useEffect(() => {
        if (!eligiendo.current && scopeElegido) navigate(destino, { replace: true });
    }, [scopeElegido, destino, navigate]);

    const entrarAObra = (obraId: string) => {
        eligiendo.current = true;
        elegirObra(obraId);
        navigate(destino, { replace: true });
    };

    const entrarAEmpresa = () => {
        eligiendo.current = true;
        elegirEmpresa();
        navigate('/mi-empresa', { replace: true });
    };

    const imagenes = useObraImagenes(obras);
    const [busqueda, setBusqueda] = useState('');
    const obrasVisibles = useMemo(() => {
        const q = busqueda.trim().toLowerCase();
        if (!q) return obras;
        return obras.filter((o) => `${o.nombre || ''} ${o.codigo || ''}`.toLowerCase().includes(q));
    }, [obras, busqueda]);

    const cargando = isLoadingObras && obras.length === 0;
    const sinOpciones = !cargando && obras.length === 0 && !puedeGestionarEmpresa;

    const nombreCompleto = [user?.nombre, user?.apellido].filter(Boolean).join(' ');
    const iniciales = [user?.nombre, user?.apellido].filter(Boolean).map((t) => (t as string)[0]).join('').toUpperCase();

    const capitalizar = (texto?: string) => (texto ? texto.charAt(0).toUpperCase() + texto.slice(1) : '');

    const estadoTono = (estado?: string) => {
        const e = (estado || '').toLowerCase();
        if (e === 'activa' || e === 'activo') return 'ok';
        if (e === 'pausada' || e === 'pausa') return 'warn';
        return 'mute';
    };

    return (
        <div className="so-root">
            <div className="so-bg" aria-hidden="true" />

            {/* Misma tarjeta que el login (520 de ancho, alto fijo): logo y pie no se
                mueven; la lista de obras es lo único que hace scroll. */}
            <main className="so-card">
                <div className="so-head">
                    {logo ? (
                        <img src={logo} alt="Logo de la empresa" className="so-logo-img" />
                    ) : (
                        <div className="so-logo" aria-label="Build and Serve">
                            <span className="so-logo-build">Build</span>
                            <span className="so-logo-amp">&amp;</span>
                            <span className="so-logo-serve">Serve</span>
                        </div>
                    )}
                    <div className="so-divider" aria-hidden="true" />
                </div>

                <div className="so-body">
                    <h1 className="so-title">
                        Hola{user?.nombre ? `, ${user.nombre}` : ''}
                    </h1>
                    <p className="so-hint">
                        {obras.length > 0
                            ? 'Elige la obra con la que vas a trabajar. Todo lo que veas dentro será de esa obra.'
                            : 'Elige dónde quieres entrar.'}
                    </p>

                    {cargando && (
                        <div className="so-loading">
                            <div className="so-spinner" />
                            <span>Cargando tus obras…</span>
                        </div>
                    )}

                    {sinOpciones && (
                        <div className="so-empty">
                            <FiAlertTriangle size={28} />
                            <p className="so-empty-title">No hay obras disponibles</p>
                            <p className="so-empty-text">
                                No pudimos encontrar obras para tu cuenta. Vuelve a intentarlo y, si sigue
                                igual, pídele a quien administra la empresa que te asigne a una obra.
                            </p>
                            <button type="button" className="so-retry" onClick={() => refreshObras()}>
                                <FiRotateCw size={13} /> Volver a intentar
                            </button>
                        </div>
                    )}

                    {!cargando && obras.length >= OBRAS_PARA_BUSCADOR && (
                        <label className="so-search">
                            <FiSearch size={15} aria-hidden="true" />
                            <input
                                type="search"
                                aria-label="Buscar obra"
                                placeholder="Buscar obra"
                                value={busqueda}
                                onChange={(e) => setBusqueda(e.target.value)}
                            />
                        </label>
                    )}

                    {!cargando && obras.length > 0 && (
                        <div className="so-list">
                            {obrasVisibles.map((obra) => (
                                <button
                                    key={obra.obraId}
                                    type="button"
                                    className="so-option"
                                    onClick={() => entrarAObra(obra.obraId)}
                                >
                                    <img
                                        src={imagenes[obra.obraId] || '/obraDefault.png'}
                                        alt=""
                                        className="so-option-thumb"
                                        loading="lazy"
                                    />
                                    <span className="so-option-info">
                                        <span className="so-option-name">
                                            {obra.codigo && <span className="so-option-code">{obra.codigo}</span>}
                                            <span className="so-option-nombre">{obra.nombre}</span>
                                        </span>
                                        <span className="so-option-meta">
                                            <span className={`so-dot so-dot--${estadoTono(obra.estado)}`} aria-hidden="true" />
                                            {capitalizar(obra.estado) || 'Sin estado'}
                                            {obra.etapaConstructivaActual || obra.etapaActual
                                                ? ` · ${obra.etapaConstructivaActual || obra.etapaActual}`
                                                : ''}
                                        </span>
                                    </span>
                                    <FiChevronRight size={17} className="so-option-caret" />
                                </button>
                            ))}
                            {obrasVisibles.length === 0 && (
                                <p className="so-no-match">Ninguna obra coincide con «{busqueda.trim()}».</p>
                            )}
                        </div>
                    )}

                    {/* Gestionar la empresa: fijo bajo la lista, no se pierde al hacer scroll */}
                    {!cargando && puedeGestionarEmpresa && (
                        <button type="button" className="so-option so-option--empresa" onClick={entrarAEmpresa}>
                            <span className="so-empresa-icon"><FiBriefcase size={17} /></span>
                            <span className="so-option-info">
                                <span className="so-option-name">Gestionar la empresa</span>
                                <span className="so-option-meta">Obras, roles, cargos e identidad</span>
                            </span>
                            <FiChevronRight size={17} className="so-option-caret" />
                        </button>
                    )}
                </div>

                <div className="so-foot">
                    <span className="so-foot-user">
                        {iniciales && <span className="so-foot-avatar" aria-hidden="true">{iniciales}</span>}
                        <span className="so-foot-name">{nombreCompleto}</span>
                    </span>
                    <button type="button" className="so-logout" onClick={() => logout()}>
                        <FiLogOut size={14} /> Cerrar sesión
                    </button>
                </div>
            </main>

            <style>{`
                /* ── Selección de obra: continúa la tarjeta del login ── */
                .so-root {
                    min-height: 100vh;
                    min-height: 100dvh;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    padding: 24px 16px;
                    box-sizing: border-box;
                    position: relative;
                    overflow: hidden;
                    font-family: var(--font-ui);
                }

                .so-bg {
                    position: absolute;
                    inset: 0;
                    background: #1c2b3d url('/fondoLogin.png') center center / cover no-repeat;
                    z-index: 0;
                }

                .so-card {
                    position: relative;
                    z-index: 1;
                    width: 100%;
                    max-width: 520px;
                    height: min(580px, calc(100dvh - 48px));
                    display: flex;
                    flex-direction: column;
                    background: #ffffff;
                    color: #0f172a;
                    border-radius: 16px;
                    padding: 40px 40px 12px;
                    box-shadow:
                        0 2px 4px rgba(0,0,0,0.08),
                        0 8px 24px rgba(0,0,0,0.18),
                        0 32px 64px rgba(0,0,0,0.28);
                    animation: so-rise 0.45s cubic-bezier(0.22, 1, 0.36, 1) both;
                    box-sizing: border-box;
                }

                @keyframes so-rise {
                    from { opacity: 0; transform: translateY(20px) scale(0.98); }
                    to   { opacity: 1; transform: translateY(0) scale(1); }
                }

                .so-head {
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    gap: 20px;
                    flex-shrink: 0;
                }

                .so-logo {
                    display: flex;
                    align-items: baseline;
                    gap: 6px;
                    font-family: var(--font-display);
                    font-size: 34px;
                    font-weight: 600;
                    line-height: 1;
                    letter-spacing: -0.01em;
                }

                .so-logo-build { color: #003b75; }
                .so-logo-amp   { color: #df3601; font-weight: 500; }
                .so-logo-serve { color: #006edc; }

                .so-logo-img { max-height: 40px; max-width: 200px; object-fit: contain; }

                .so-divider { align-self: stretch; height: 1px; background: #e8edf3; }

                /* ── Cuerpo ── */
                .so-body {
                    flex: 1;
                    min-height: 0;
                    display: flex;
                    flex-direction: column;
                    padding-top: 22px;
                }

                .so-title {
                    font-size: 22px;
                    font-weight: 700;
                    color: #0f172a;
                    margin: 0;
                    letter-spacing: -0.02em;
                }

                .so-hint {
                    font-size: 13px;
                    color: #64748b;
                    margin: 6px 0 0;
                    line-height: 1.5;
                }

                .so-search {
                    position: relative;
                    display: block;
                    flex-shrink: 0;
                    margin-top: 16px;
                }

                .so-search > svg {
                    position: absolute;
                    left: 12px;
                    top: 50%;
                    transform: translateY(-50%);
                    color: #64748b;
                    pointer-events: none;
                }

                .so-search input {
                    width: 100%;
                    height: 40px;
                    box-sizing: border-box;
                    padding: 0 12px 0 36px;
                    background: #f8fafc;
                    border: 1px solid #e2e8f0;
                    border-radius: 8px;
                    font-size: 13px;
                    font-family: inherit;
                    color: #0f172a;
                    outline: none;
                    transition: border-color 0.15s ease, box-shadow 0.15s ease, background 0.15s ease;
                }

                .so-search input::placeholder { color: #94a3b8; }

                .so-search input:focus {
                    border-color: #006edc;
                    background: #fff;
                    box-shadow: 0 0 0 3px rgba(0, 110, 220, 0.12);
                }

                /* ── Lista de obras: lo único que hace scroll ── */
                .so-list {
                    /* crece solo hasta su contenido; si no cabe, hace scroll */
                    flex: 0 1 auto;
                    min-height: 0;
                    display: flex;
                    flex-direction: column;
                    gap: 8px;
                    overflow-y: auto;
                    overscroll-behavior: contain;
                    /* espacio para que el foco y la sombra no queden cortados */
                    margin: 12px -4px 0;
                    padding: 2px 4px 4px;
                }

                .so-option {
                    display: flex;
                    align-items: center;
                    gap: 12px;
                    width: 100%;
                    min-height: 64px;
                    flex-shrink: 0;
                    padding: 8px 12px 8px 8px;
                    background: #f8fafc;
                    border: 1px solid #e2e8f0;
                    border-radius: 12px;
                    cursor: pointer;
                    text-align: left;
                    font-family: inherit;
                    color: #0f172a;
                    transition: border-color 0.15s ease, background 0.15s ease, box-shadow 0.15s ease;
                }

                .so-option:hover,
                .so-option:focus-visible {
                    outline: none;
                    border-color: #006edc;
                    background: #fff;
                    box-shadow: 0 4px 14px rgba(0, 110, 220, 0.14);
                }

                .so-option-thumb {
                    width: 48px;
                    height: 48px;
                    flex-shrink: 0;
                    border-radius: 8px;
                    object-fit: cover;
                    background: #e2e8f0;
                }

                .so-option-info {
                    flex: 1;
                    min-width: 0;
                    display: flex;
                    flex-direction: column;
                    gap: 4px;
                }

                .so-option-name {
                    display: flex;
                    align-items: center;
                    gap: 7px;
                    min-width: 0;
                    font-size: 14px;
                    font-weight: 600;
                    color: #0f172a;
                }

                .so-option-nombre {
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                }

                .so-option-code {
                    flex-shrink: 0;
                    padding: 1px 6px;
                    border-radius: 4px;
                    background: #eef2f7;
                    font-size: 10.5px;
                    font-weight: 700;
                    letter-spacing: 0.03em;
                    color: #475569;
                }

                .so-option-meta {
                    display: flex;
                    align-items: center;
                    gap: 6px;
                    font-size: 12px;
                    color: #64748b;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                }

                .so-dot {
                    width: 7px;
                    height: 7px;
                    border-radius: 50%;
                    flex-shrink: 0;
                }
                .so-dot--ok   { background: #16a34a; }
                .so-dot--warn { background: #d97706; }
                .so-dot--mute { background: #cbd5e1; }

                .so-option-caret { flex-shrink: 0; color: #64748b; transition: color 0.15s ease; }
                .so-option:hover .so-option-caret,
                .so-option:focus-visible .so-option-caret { color: #006edc; }

                .so-no-match {
                    margin: 8px 0 0;
                    font-size: 12.5px;
                    color: #64748b;
                    text-align: center;
                }

                /* La gestión de empresa es la alternativa, no una obra más */
                .so-option--empresa {
                    min-height: 56px;
                    margin-top: 12px;
                    background: #f1f6fd;
                    border: 1px dashed #9cc3ee;
                }

                .so-option--empresa:hover,
                .so-option--empresa:focus-visible {
                    border-style: solid;
                    border-color: #002855;
                    background: #fff;
                    box-shadow: 0 4px 14px rgba(0, 40, 85, 0.12);
                }

                .so-option--empresa:hover .so-option-caret,
                .so-option--empresa:focus-visible .so-option-caret { color: #002855; }

                .so-empresa-icon {
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    width: 40px;
                    height: 40px;
                    flex-shrink: 0;
                    border-radius: 8px;
                    background: #002855;
                    color: #fff;
                }

                /* ── Estados ── */
                .so-loading {
                    display: flex;
                    align-items: center;
                    gap: 10px;
                    padding: 18px 0;
                    font-size: 12.5px;
                    color: #64748b;
                }

                .so-spinner {
                    width: 16px;
                    height: 16px;
                    border: 2px solid rgba(0, 110, 220, 0.2);
                    border-top-color: #006edc;
                    border-radius: 50%;
                    animation: so-spin 0.7s linear infinite;
                }

                @keyframes so-spin { to { transform: rotate(360deg); } }

                .so-empty {
                    display: flex;
                    flex-direction: column;
                    align-items: flex-start;
                    gap: 6px;
                    margin-top: 16px;
                    padding: 16px;
                    border: 1px dashed #e2e8f0;
                    border-radius: 10px;
                    color: #d97706;
                }

                .so-empty-title {
                    margin: 4px 0 0;
                    font-size: 13.5px;
                    font-weight: 600;
                    color: #0f172a;
                }

                .so-empty-text {
                    margin: 0;
                    font-size: 12px;
                    color: #64748b;
                    line-height: 1.5;
                }

                .so-retry {
                    display: inline-flex;
                    align-items: center;
                    gap: 6px;
                    min-height: 36px;
                    margin-top: 4px;
                    padding: 0;
                    background: none;
                    border: none;
                    font-family: inherit;
                    font-size: 12.5px;
                    font-weight: 500;
                    color: #006edc;
                    cursor: pointer;
                }

                .so-retry:hover { text-decoration: underline; }

                /* ── Pie: quién entra y la salida ── */
                .so-foot {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    gap: 12px;
                    flex-shrink: 0;
                    min-height: 52px;
                    margin-top: 16px;
                    border-top: 1px solid #e8edf3;
                }

                .so-foot-user {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    min-width: 0;
                    font-size: 12.5px;
                    font-weight: 500;
                    color: #334155;
                }

                .so-foot-avatar {
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    width: 26px;
                    height: 26px;
                    flex-shrink: 0;
                    border-radius: 50%;
                    background: #e6f0fb;
                    color: #003b75;
                    font-size: 10.5px;
                    font-weight: 700;
                }

                .so-foot-name {
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                }

                .so-logout {
                    display: inline-flex;
                    align-items: center;
                    gap: 6px;
                    flex-shrink: 0;
                    min-height: 44px;
                    background: none;
                    border: none;
                    padding: 0;
                    font-family: inherit;
                    font-size: 13px;
                    font-weight: 500;
                    color: #64748b;
                    cursor: pointer;
                    transition: color 0.15s ease;
                }

                .so-logout:hover { color: #c2410c; }

                /* ── Móvil ── */
                @media (max-width: 560px) {
                    .so-root { padding: 16px; }
                    .so-card {
                        height: min(640px, calc(100dvh - 32px));
                        padding: 30px 22px 8px;
                        border-radius: 12px;
                    }
                    .so-logo { font-size: 30px; }
                    .so-title { font-size: 20px; }
                    /* 16px evita que iOS haga zoom al enfocar el buscador */
                    .so-search input { font-size: 16px; }
                    /* Poco ancho: el nombre pasa a dos líneas en vez de cortarse tras el código */
                    .so-option-name { align-items: flex-start; }
                    .so-option-code { margin-top: 2px; }
                    .so-option-nombre {
                        white-space: normal;
                        display: -webkit-box;
                        -webkit-line-clamp: 2;
                        -webkit-box-orient: vertical;
                        line-height: 1.3;
                    }
                    .so-option-meta { white-space: normal; }
                }

                @media (prefers-reduced-motion: reduce) {
                    .so-card { animation: none; }
                }
            `}</style>
        </div>
    );
}
