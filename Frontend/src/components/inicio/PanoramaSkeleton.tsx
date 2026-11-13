/**
 * Esqueleto del panorama de la empresa.
 *
 * Dibuja la grilla real que va a aparecer —cuatro indicadores arriba y los
 * cuatro paneles en su misma disposición— en vez de un spinner centrado: así el
 * contenido no salta al llegar y la espera no parece una pantalla rota.
 *
 * `aria-busy` va una sola vez, en el contenedor, y los bloques quedan fuera del
 * árbol de accesibilidad: son decorativos y leerlos uno por uno sería ruido.
 * La animación de `.ui-skel` ya respeta `prefers-reduced-motion` en
 * components.css.
 */

function Linea({ ancho }: { ancho: string }) {
    return <div className="ui-skel ui-skel--linea" style={{ width: ancho }} />;
}

function TarjetaIndicador() {
    return (
        <div className="card" style={{ flexDirection: 'row', alignItems: 'center', gap: 'var(--space-3)' }}>
            <div className="ui-skel ui-skel--circulo" style={{ width: 48, height: 48, borderRadius: 'var(--radius-md)' }} />
            <div style={{ flex: 1, minWidth: 0 }}>
                <Linea ancho="48%" />
                <div style={{ height: 6 }} />
                <Linea ancho="70%" />
            </div>
        </div>
    );
}

function PanelConFilas({ filas, conBarra }: { filas: number; conBarra?: boolean }) {
    return (
        <div className="card">
            <div className="card-header">
                <div style={{ flex: 1, minWidth: 0 }}>
                    <Linea ancho="42%" />
                    <div style={{ height: 8 }} />
                    <Linea ancho="76%" />
                </div>
            </div>
            {Array.from({ length: filas }).map((_, i) => (
                <div
                    key={i}
                    style={{
                        display: 'grid',
                        gridTemplateColumns: conBarra ? 'minmax(0, 1fr) 96px 52px' : 'minmax(0, 1fr) 72px',
                        alignItems: 'center',
                        gap: 'var(--space-3)',
                        padding: 'var(--space-3) var(--space-2)',
                        borderTop: i === 0 ? 'none' : '1px solid var(--surface-border)',
                    }}
                >
                    <div style={{ minWidth: 0 }}>
                        <Linea ancho={`${58 + ((i * 11) % 30)}%`} />
                        <div style={{ height: 6 }} />
                        <Linea ancho={`${34 + ((i * 7) % 22)}%`} />
                    </div>
                    {conBarra && <div className="ui-skel ui-skel--linea" style={{ width: '100%', height: 8 }} />}
                    <div className="ui-skel ui-skel--pildora" style={{ width: conBarra ? 40 : 64, marginLeft: 'auto' }} />
                </div>
            ))}
        </div>
    );
}

export function PanoramaEmpresaSkeleton() {
    return (
        <div aria-busy="true" aria-live="polite">
            <div className="stats-grid-4">
                {Array.from({ length: 4 }).map((_, i) => <TarjetaIndicador key={i} />)}
            </div>
            <div className="pan-grid">
                <PanelConFilas filas={5} />
                <PanelConFilas filas={5} conBarra />
            </div>
            <div className="pan-grid pan-grid--invertida">
                <PanelConFilas filas={4} />
                <PanelConFilas filas={4} />
            </div>
        </div>
    );
}

export default PanoramaEmpresaSkeleton;
