import { Link } from 'react-router-dom';

// Pie de página: mismo material que el header y el sidebar (superficie, borde y
// tokens de tema). Queda por debajo del pliegue y solo se ve al hacer scroll;
// los estilos viven en css/layout.css.
export default function Footer() {
    const year = new Date().getFullYear();

    return (
        <footer className="ft-root" role="contentinfo">
            <div className="ft-main">
                <div className="ft-brand-group">
                    <span className="ft-brand" aria-label="Build and Serve">
                        <span className="ft-brand-build">Build</span>
                        <span className="ft-brand-amp">&amp;</span>
                        <span className="ft-brand-serve">Serve</span>
                    </span>

                    <span className="ft-sep" aria-hidden="true" />

                    <div className="ft-collab">
                        <span className="ft-collab-label">En colaboración con</span>
                        {/* Dos versiones del logo: el tema decide cuál se muestra (ver layout.css) */}
                        <img
                            src="/logoCCHC_light.png"
                            alt="Cámara Chilena de la Construcción"
                            className="ft-logo ft-logo--light"
                        />
                        <img
                            src="/logoCCHC_dark.png"
                            alt="Cámara Chilena de la Construcción"
                            className="ft-logo ft-logo--dark"
                        />
                    </div>
                </div>

                <nav className="ft-links" aria-label="Enlaces del pie">
                    <Link to="/manual" className="ft-link">Manual de uso</Link>
                    <Link to="/manual/guia-inicio/instalacion#preguntas-frecuentes" className="ft-link">
                        Preguntas frecuentes
                    </Link>
                    <a href="/about" target="_blank" rel="noopener noreferrer" className="ft-link">
                        Acerca de Build &amp; Serve
                    </a>
                    <a href="/equipo" target="_blank" rel="noopener noreferrer" className="ft-link">
                        Equipo
                    </a>
                </nav>
            </div>

            <div className="ft-legal">
                {/* El © solo se muestra en móvil (ver layout.css) */}
                <span className="ft-copy">© {year} Build &amp; Serve</span>
                <span>Desarrollado por The Code Cookers</span>
            </div>
        </footer>
    );
}
