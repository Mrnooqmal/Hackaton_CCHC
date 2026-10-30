/**
 * Esqueletos de la estructura preventiva (ficha de órgano y constitución).
 *
 * Mismo criterio que ui/Skeletons: se dibuja la retícula real —la cabecera y
 * las tarjetas— en vez de una línea de texto en una página en blanco. Antes
 * ambas pantallas mostraban "Cargando…" suelto y el contenido aparecía de
 * golpe, que es el salto que los esqueletos existen para evitar.
 *
 * `aria-busy` va UNA vez en el contenedor; los bloques son decorativos.
 */

/** Cabecera con la forma de PageHeader: título y bajada. */
function CabeceraSkel() {
    return (
        <div style={{ marginBottom: 'var(--space-4)', display: 'grid', gap: 8 }}>
            <div className="ui-skel ui-skel--linea" style={{ width: 'min(320px, 60vw)', height: 24 }} />
            <div className="ui-skel ui-skel--linea" style={{ width: 'min(220px, 45vw)', height: 11 }} />
        </div>
    );
}

/** Tarjeta con n campos en fila, como la de datos del órgano. */
function CardCamposSkel({ campos = 4 }: { campos?: number }) {
    return (
        <div
            className="card"
            style={{ padding: 'var(--space-4)', marginBottom: 'var(--space-3)', display: 'flex', gap: 'var(--space-4)', flexWrap: 'wrap' }}
        >
            {Array.from({ length: campos }, (_, i) => (
                <div key={i} style={{ display: 'grid', gap: 6 }}>
                    <div className="ui-skel ui-skel--linea" style={{ width: 64, height: 9 }} />
                    <div className="ui-skel ui-skel--pildora" style={{ width: 86, height: 20 }} />
                </div>
            ))}
        </div>
    );
}

/** Tarjeta de sección con un rótulo y unas líneas de contenido. */
function CardSeccionSkel({ lineas = 3 }: { lineas?: number }) {
    const anchos = ['72%', '58%', '84%', '64%'];
    return (
        <div className="card" style={{ padding: 'var(--space-4)', marginBottom: 'var(--space-3)', display: 'grid', gap: 10 }}>
            <div className="ui-skel ui-skel--linea" style={{ width: 150, height: 13 }} />
            {Array.from({ length: lineas }, (_, i) => (
                <div key={i} className="ui-skel ui-skel--linea" style={{ width: anchos[i % anchos.length], height: 10 }} />
            ))}
        </div>
    );
}

/** Ficha de un órgano: cabecera, datos y las secciones de abajo. */
export function EstructuraOrganoSkeleton() {
    return (
        <div aria-busy="true" aria-label="Cargando órgano">
            <CabeceraSkel />
            <CardCamposSkel campos={4} />
            <CardSeccionSkel lineas={3} />
            <CardSeccionSkel lineas={4} />
        </div>
    );
}

/** Constitución de un órgano: cabecera, barra de pasos y el paso actual. */
export function EstructuraConstituirSkeleton() {
    return (
        <div aria-busy="true" aria-label="Cargando">
            <CabeceraSkel />
            <div
                className="card"
                style={{ padding: 'var(--space-4)', marginBottom: 'var(--space-4)', display: 'flex', gap: 'var(--space-4)', flexWrap: 'wrap' }}
            >
                {Array.from({ length: 3 }, (_, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div className="ui-skel ui-skel--circulo" style={{ width: 22, height: 22 }} />
                        <div className="ui-skel ui-skel--linea" style={{ width: 84, height: 10 }} />
                    </div>
                ))}
            </div>
            <CardSeccionSkel lineas={4} />
        </div>
    );
}
