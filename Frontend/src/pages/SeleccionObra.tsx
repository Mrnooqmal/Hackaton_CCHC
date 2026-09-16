import { useEffect, useMemo, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { FiAlertTriangle, FiBriefcase, FiChevronRight, FiLogOut, FiMapPin, FiRotateCw } from 'react-icons/fi';
import { useAuth } from '../context/AuthContext';
import { useObraContext } from '../context/ObraContext';
import { useBrand } from '../context/BrandContext';

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

    const cargando = isLoadingObras && obras.length === 0;
    const sinOpciones = !cargando && obras.length === 0 && !puedeGestionarEmpresa;

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

            <div className="so-card" role="main">
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
                </div>

                <div className="so-divider" aria-hidden="true" />

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

                {!cargando && obras.length > 0 && (
                    <div className="so-list">
                        {obras.map((obra) => (
                            <button
                                key={obra.obraId}
                                type="button"
                                className="so-option"
                                onClick={() => entrarAObra(obra.obraId)}
                            >
                                <span className="so-option-icon"><FiMapPin size={16} /></span>
                                <span className="so-option-info">
                                    <span className="so-option-name">
                                        {obra.codigo && <span className="so-option-code">{obra.codigo}</span>}
                                        {obra.nombre}
                                    </span>
                                    <span className="so-option-meta">
                                        <span className={`so-dot so-dot--${estadoTono(obra.estado)}`} aria-hidden="true" />
                                        {capitalizar(obra.estado) || 'Sin estado'}
                                        {obra.etapaConstructivaActual || obra.etapaActual
                                            ? ` · ${obra.etapaConstructivaActual || obra.etapaActual}`
                                            : ''}
                                    </span>
                                </span>
                                <FiChevronRight size={16} className="so-option-caret" />
                            </button>
                        ))}
                    </div>
                )}

                {!cargando && puedeGestionarEmpresa && (
                    <>
                        {obras.length > 0 && (
                            <div className="so-sep">
                                <span>o bien</span>
                            </div>
                        )}
                        <button type="button" className="so-option so-option--empresa" onClick={entrarAEmpresa}>
                            <span className="so-option-icon so-option-icon--empresa"><FiBriefcase size={16} /></span>
                            <span className="so-option-info">
                                <span className="so-option-name">Gestionar la empresa</span>
                                <span className="so-option-meta">Obras, roles, cargos e identidad</span>
                            </span>
                            <FiChevronRight size={16} className="so-option-caret" />
                        </button>
                    </>
                )}

                <div className="so-foot">
                    <span className="so-foot-user">
                        {[user?.nombre, user?.apellido].filter(Boolean).join(' ')}
                    </span>
                    <button type="button" className="so-logout" onClick={() => logout()}>
                        <FiLogOut size={13} /> Cerrar sesión
                    </button>
                </div>
            </div>

            <style>{`
                /* ── Pantalla de selección de obra (continúa el lenguaje del login) ── */
                .so-root {
                    min-height: 100vh;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    padding: 24px 16px;
                    position: relative;
                    overflow: hidden;
                }

                .so-bg {
                    position: absolute;
                    inset: 0;
                    background: url('/fondoLogin.png') center center / cover no-repeat;
                    z-index: 0;
                }

                .so-card {
                    position: relative;
                    z-index: 1;
                    width: 100%;
                    max-width: 480px;
                    background: #ffffff;
                    border-radius: 16px;
                    padding: 40px 40px 28px;
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
                    align-items: center;
                    justify-content: center;
                }

                .so-logo {
                    display: flex;
                    align-items: baseline;
                    gap: 6px;
                    font-family: 'Lora', Georgia, serif;
                    font-size: 2rem;
                    font-weight: 600;
                    line-height: 1;
                    letter-spacing: -0.01em;
                }

                .so-logo-build { color: #003b75; }
                .so-logo-amp   { color: #df3601; font-weight: 500; }
                .so-logo-serve { color: #006edc; }

                .so-logo-img {
                    max-height: 44px;
                    max-width: 200px;
                    object-fit: contain;
                }

                .so-divider {
                    height: 1px;
                    background: #e8edf3;
                    margin: 20px 0 22px;
                }

                .so-title {
                    font-size: 22px;
                    font-weight: 700;
                    color: #0f172a;
                    margin: 0 0 6px;
                    letter-spacing: -0.02em;
                }

                .so-hint {
                    font-size: 12.5px;
                    color: #64748b;
                    margin: 0 0 18px;
                    line-height: 1.5;
                }

                /* ── Lista de obras ── */
                .so-list {
                    display: flex;
                    flex-direction: column;
                    gap: 8px;
                    max-height: 44vh;
                    overflow-y: auto;
                    /* espacio para que el foco no quede cortado al hacer scroll */
                    margin: 0 -4px;
                    padding: 2px 4px;
                }

                .so-option {
                    display: flex;
                    align-items: center;
                    gap: 12px;
                    width: 100%;
                    padding: 12px 14px;
                    background: #f8fafc;
                    border: 1px solid #e2e8f0;
                    border-radius: 10px;
                    cursor: pointer;
                    text-align: left;
                    font-family: inherit;
                    color: #0f172a;
                    transition: border-color 0.15s ease, background 0.15s ease, transform 0.12s ease, box-shadow 0.15s ease;
                }

                .so-option:hover {
                    border-color: #006edc;
                    background: #fff;
                    transform: translateY(-1px);
                    box-shadow: 0 6px 18px rgba(15, 23, 42, 0.08);
                }

                .so-option:focus-visible {
                    outline: none;
                    border-color: #006edc;
                    box-shadow: 0 0 0 3px rgba(0, 110, 220, 0.18);
                }

                .so-option-icon {
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    width: 34px;
                    height: 34px;
                    flex-shrink: 0;
                    border-radius: 9px;
                    background: rgba(0, 110, 220, 0.1);
                    color: #006edc;
                }

                /* La gestión de empresa es la alternativa, no una obra más. */
                .so-option--empresa {
                    background: #fff;
                    border-style: dashed;
                }

                .so-option--empresa:hover {
                    border-style: solid;
                    border-color: #002855;
                }

                .so-option--empresa:hover .so-option-caret { color: #002855; }

                .so-option-icon--empresa {
                    background: rgba(0, 40, 85, 0.1);
                    color: #002855;
                }

                .so-option-info {
                    flex: 1;
                    min-width: 0;
                    display: flex;
                    flex-direction: column;
                    gap: 3px;
                }

                .so-option-name {
                    display: flex;
                    align-items: center;
                    gap: 6px;
                    font-size: 13.5px;
                    font-weight: 600;
                    color: #0f172a;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                }

                .so-option-code {
                    flex-shrink: 0;
                    font-size: 10.5px;
                    font-weight: 700;
                    letter-spacing: 0.03em;
                    color: #006edc;
                    background: rgba(0, 110, 220, 0.1);
                    padding: 2px 6px;
                    border-radius: 4px;
                }

                .so-option-meta {
                    display: flex;
                    align-items: center;
                    gap: 5px;
                    font-size: 11.5px;
                    color: #94a3b8;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                }

                .so-dot {
                    width: 6px;
                    height: 6px;
                    border-radius: 50%;
                    flex-shrink: 0;
                }
                .so-dot--ok   { background: #16a34a; }
                .so-dot--warn { background: #f59e0b; }
                .so-dot--mute { background: #cbd5e1; }

                .so-option-caret {
                    flex-shrink: 0;
                    color: #cbd5e1;
                }

                .so-option:hover .so-option-caret { color: #006edc; }

                /* ── Separador "o" ── */
                .so-sep {
                    display: flex;
                    align-items: center;
                    gap: 10px;
                    margin: 14px 0;
                    color: #b0bec5;
                    font-size: 11px;
                    text-transform: uppercase;
                    letter-spacing: 0.08em;
                }

                .so-sep::before,
                .so-sep::after {
                    content: '';
                    flex: 1;
                    height: 1px;
                    background: #e8edf3;
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
                    padding: 16px;
                    border: 1px dashed #e2e8f0;
                    border-radius: 10px;
                    color: #f59e0b;
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
                    margin-top: 8px;
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

                /* ── Pie ── */
                .so-foot {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    gap: 12px;
                    margin-top: 22px;
                    padding-top: 16px;
                    border-top: 1px solid #e8edf3;
                }

                .so-foot-user {
                    font-size: 12px;
                    color: #94a3b8;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                }

                .so-logout {
                    display: inline-flex;
                    align-items: center;
                    gap: 6px;
                    flex-shrink: 0;
                    background: none;
                    border: none;
                    padding: 0;
                    font-family: inherit;
                    font-size: 12.5px;
                    font-weight: 500;
                    color: #64748b;
                    cursor: pointer;
                    transition: color 0.15s ease;
                }

                .so-logout:hover { color: #df3601; }

                @media (max-width: 500px) {
                    .so-root { min-height: 100dvh; }
                    .so-card { padding: 32px 22px 22px; border-radius: 12px; }
                    .so-logo { font-size: 1.75rem; }
                    .so-title { font-size: 20px; }
                    .so-list { max-height: 50vh; }
                }
            `}</style>
        </div>
    );
}
