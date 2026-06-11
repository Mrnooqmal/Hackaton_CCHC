export default function Footer() {
    const year = new Date().getFullYear();

    return (
        <footer className="ft-root" role="contentinfo">
            {/* Línea institucional superior */}
            <div className="ft-accent-line" aria-hidden="true" />

            <div className="ft-inner">
                {/* ── Cabecera de marca ── */}
                <div className="ft-brand-row">
                    <div className="ft-brand-bs" aria-label="Build and Serve">
                        <span className="ft-bs-build">Build</span>
                        <span className="ft-bs-amp">&amp;</span>
                        <span className="ft-bs-serve">Serve</span>
                    </div>

                    <div className="ft-collab" aria-label="En colaboración con la Cámara Chilena de la Construcción">
                        <span className="ft-collab-text">En colaboración con</span>
                        <img
                            src="/logoCCHC_dark.png"
                            alt="Cámara Chilena de la Construcción"
                            className="ft-cchc-logo"
                        />
                    </div>
                </div>

                {/* ── Separador ── */}
                <div className="ft-divider" aria-hidden="true" />

                {/* ── Grilla de secciones ── */}
                <div className="ft-grid">
                    {/* Columna 1 – Plataforma */}
                    <div className="ft-col">
                        <h3 className="ft-col-title">¿Qué es Build &amp; Serve?</h3>
                        <p className="ft-col-desc">
                            Plataforma digital para la gestión de obras, documentos, personas
                            y cumplimiento normativo en proyectos de construcción.
                        </p>
                        <a href="#about" className="ft-col-link ft-col-link--cta">
                            Conocer más →
                        </a>
                    </div>

                    {/* Columna 2 – Manual */}
                    <div className="ft-col">
                        <h3 className="ft-col-title">Manual de uso</h3>
                        <p className="ft-col-desc">
                            ¿Necesitas ayuda con tu experiencia en Build &amp; Serve?
                        </p>
                        <a href="#manual" className="ft-col-link ft-col-link--cta">
                            Ver manual de uso →
                        </a>
                    </div>

                    {/* Columna 3 – Equipo */}
                    <div className="ft-col">
                        <h3 className="ft-col-title">Conoce al equipo</h3>
                        <p className="ft-col-desc">
                            Estudiantes de la Universidad del Desarrollo que combinan tecnología
                            e innovación para construir soluciones con impacto real en la industria.
                        </p>
                        <a href="#team" className="ft-col-link ft-col-link--cta">
                            Ver equipo →
                        </a>
                    </div>

                    {/* Columna 4 – The Code Cookers */}
                    <div className="ft-col ft-col--cookers">
                        <h3 className="ft-col-title">Desarrollado por</h3>
                        <div className="ft-cookers-badge" aria-label="The Code Cookers">
                            <span className="ft-cookers-icon" aria-hidden="true">{'</>'}</span>
                            <span className="ft-cookers-name">The Code Cookers</span>
                        </div>
                        <p className="ft-col-desc ft-col-desc--sm">
                            Hackathon CChC 2025 — Seguridad sin Papeleo.
                        </p>
                    </div>
                </div>
            </div>

            {/* ── Barra inferior ── */}
            <div className="ft-bottom">
                <div className="ft-bottom-inner">
                    <p className="ft-copyright">
                        © {year} Build &amp; Serve · Cámara Chilena de la Construcción
                    </p>
                    <p className="ft-rights">
                        Todos los derechos reservados
                    </p>
                </div>
            </div>

            <style>{`
                /* ── Raíz: rompe el padding de .main-content para llegar a los bordes ── */
                .ft-root {
                    /* Desktop: .main-content padding = var(--space-6) = 24px */
                    margin-top: 40px;
                    margin-left: -24px;
                    margin-right: -24px;
                    margin-bottom: -24px;
                    width: calc(100% + 48px);
                    background: #001428;
                    color: #e2e8f0;
                    font-family: var(--font-ui, 'Roboto', sans-serif);
                    box-sizing: border-box;
                }

                /* Tablet/móvil ≤1024px: .main-content padding lateral = var(--space-4) = 16px */
                @media (max-width: 1024px) {
                    .ft-root {
                        margin-left: -16px;
                        margin-right: -16px;
                        margin-bottom: -16px;
                        width: calc(100% + 32px);
                    }
                }

                /* Móvil pequeño ≤480px: .main-content padding = var(--space-3) = 12px */
                @media (max-width: 480px) {
                    .ft-root {
                        margin-left: -12px;
                        margin-right: -12px;
                        margin-bottom: -12px;
                        width: calc(100% + 24px);
                    }
                }

                /* ── Línea institucional azul→rojo ── */
                .ft-accent-line {
                    height: 3px;
                    background: linear-gradient(90deg, #006edc 0%, #df3601 100%);
                }

                /* ── Contenedor interior ── */
                .ft-inner {
                    max-width: 1200px;
                    margin: 0 auto;
                    padding: 48px 32px 36px;
                }

                /* ── Fila de marca ── */
                .ft-brand-row {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    flex-wrap: wrap;
                    gap: 20px;
                    margin-bottom: 32px;
                }

                .ft-brand-bs {
                    display: flex;
                    align-items: baseline;
                    gap: 5px;
                    font-family: var(--font-display, 'Lora', Georgia, serif);
                    font-size: 1.75rem;
                    font-weight: 600;
                    line-height: 1;
                    letter-spacing: -0.01em;
                }

                .ft-bs-build { color: #e8eefb; }
                .ft-bs-amp   { color: #df3601; font-weight: 500; font-size: 1.5rem; }
                .ft-bs-serve { color: #4d9fff; }

                .ft-collab {
                    display: flex;
                    align-items: center;
                    gap: 12px;
                }

                .ft-collab-text {
                    font-size: 11px;
                    font-weight: 500;
                    letter-spacing: 0.08em;
                    text-transform: uppercase;
                    color: #64748b;
                    white-space: nowrap;
                }

                .ft-cchc-logo {
                    height: 32px;
                    width: auto;
                    object-fit: contain;
                    opacity: 0.85;
                    transition: opacity 0.2s ease;
                }

                .ft-cchc-logo:hover { opacity: 1; }

                /* ── Divisor ── */
                .ft-divider {
                    height: 1px;
                    background: rgba(255, 255, 255, 0.07);
                    margin-bottom: 36px;
                }

                /* ── Grilla de 4 columnas ── */
                .ft-grid {
                    display: grid;
                    grid-template-columns: repeat(4, 1fr);
                    gap: 32px 24px;
                }

                .ft-col {
                    display: flex;
                    flex-direction: column;
                    gap: 10px;
                }

                .ft-col-title {
                    font-family: var(--font-display, 'Lora', Georgia, serif);
                    font-size: 13px;
                    font-weight: 600;
                    color: #ffffff;
                    letter-spacing: 0.03em;
                    margin-bottom: 2px;
                }

                .ft-col-desc {
                    font-size: 12.5px;
                    color: #7c9ab8;
                    line-height: 1.65;
                    margin: 0;
                }

                .ft-col-desc--sm { font-size: 11.5px; }

                .ft-col-list {
                    list-style: none;
                    padding: 0;
                    margin: 0;
                    display: flex;
                    flex-direction: column;
                    gap: 6px;
                }

                .ft-col-link {
                    font-size: 12.5px;
                    color: #7c9ab8;
                    text-decoration: none;
                    transition: color 0.15s ease;
                    line-height: 1.4;
                }

                .ft-col-link:hover { color: #4d9fff; }

                .ft-col-link--cta {
                    font-size: 12px;
                    font-weight: 600;
                    color: #4d9fff;
                    letter-spacing: 0.02em;
                    margin-top: 4px;
                }

                .ft-col-link--cta:hover { color: #8cc4ff; }

                /* ── The Code Cookers badge ── */
                .ft-cookers-badge {
                    display: inline-flex;
                    align-items: center;
                    gap: 8px;
                    background: rgba(0, 110, 220, 0.12);
                    border: 1px solid rgba(0, 110, 220, 0.22);
                    border-radius: 8px;
                    padding: 8px 12px;
                    width: fit-content;
                    margin: 2px 0 4px;
                    transition: background 0.2s ease, border-color 0.2s ease;
                }

                .ft-cookers-badge:hover {
                    background: rgba(0, 110, 220, 0.2);
                    border-color: rgba(0, 110, 220, 0.4);
                }

                .ft-cookers-icon {
                    font-family: var(--font-mono, 'JetBrains Mono', monospace);
                    font-size: 13px;
                    color: #4d9fff;
                    font-weight: 700;
                    line-height: 1;
                }

                .ft-cookers-name {
                    font-size: 13px;
                    font-weight: 600;
                    color: #e2e8f0;
                    letter-spacing: 0.01em;
                    white-space: nowrap;
                }

                /* ── Barra inferior ── */
                .ft-bottom {
                    border-top: 1px solid rgba(255, 255, 255, 0.06);
                    background: rgba(0, 0, 0, 0.2);
                }

                .ft-bottom-inner {
                    max-width: 1200px;
                    margin: 0 auto;
                    padding: 14px 32px;
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    gap: 12px;
                    flex-wrap: wrap;
                }

                .ft-copyright,
                .ft-rights {
                    font-size: 11px;
                    color: #475569;
                    margin: 0;
                    line-height: 1;
                }

                /* ── Responsive ── */

                /* Tablet: 2 columnas */
                @media (max-width: 900px) {
                    .ft-inner { padding: 40px 24px 32px; }
                    .ft-grid { grid-template-columns: repeat(2, 1fr); gap: 28px 20px; }
                }

                /* Móvil: 1 columna */
                @media (max-width: 540px) {
                    .ft-inner { padding: 32px 20px 28px; }

                    .ft-brand-row {
                        flex-direction: column;
                        align-items: flex-start;
                        gap: 16px;
                    }

                    .ft-collab {
                        flex-direction: column;
                        align-items: flex-start;
                        gap: 8px;
                    }

                    .ft-brand-bs { font-size: 1.5rem; }

                    .ft-grid {
                        grid-template-columns: 1fr;
                        gap: 24px;
                    }

                    .ft-bottom-inner {
                        padding: 12px 20px;
                        flex-direction: column;
                        align-items: flex-start;
                        gap: 4px;
                    }
                }
            `}</style>
        </footer>
    );
}
