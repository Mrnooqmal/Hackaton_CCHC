import '../css/AuthCard.css';

/**
 * Tarjeta de acceso: fondo fotográfico, tarjeta de 520px y logo con su regla.
 * Una sola pieza para todas las pantallas fuera del sistema (login, elegir
 * empresa, recuperar y restablecer contraseña, primer ingreso, alta de empresa),
 * para que se vean iguales y cambien juntas.
 *
 * `fija`: alto fijo del flujo, para pasos con una lista que hace scroll.
 */
export default function TarjetaAcceso({ children, fija = false }: { children: React.ReactNode; fija?: boolean }) {
    return (
        <div className="lp-root">
            <div className="lp-bg" aria-hidden="true" />
            <main className={`lp-card${fija ? ' lp-card--fija' : ''}`}>
                <div className="lp-head">
                    <div className="lp-logo" aria-label="Build and Serve">
                        <span className="lp-logo-build">Build</span>
                        <span className="lp-logo-amp">&amp;</span>
                        <span className="lp-logo-serve">Serve</span>
                    </div>
                    <div className="lp-divider" aria-hidden="true" />
                </div>
                {children}
            </main>
        </div>
    );
}
