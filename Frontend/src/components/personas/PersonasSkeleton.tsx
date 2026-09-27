/**
 * Esqueletos de las dos pantallas de Personas.
 *
 * Dibujan la retícula real —la rejilla de tarjetas, las filas, los rótulos de
 * cuadrilla— en vez de un spinner centrado: con el spinner el contenido
 * aparecía de golpe y en otra posición, y cada entrada a Personas era un salto.
 *
 * Cada uno respeta la vista elegida (cuadrícula o lista), igual que el
 * esqueleto del detalle de obra respeta la pestaña: prometer una cuadrícula y
 * entregar una lista devuelve el salto que se quería evitar, ahora disfrazado
 * de carga.
 *
 * `aria-busy` va UNA vez en el contenedor; los bloques son decorativos.
 */

type Vista = 'grid' | 'list';

/** Anchos que no se repiten fila a fila: un bloque parejo se lee como tabla. */
const ANCHOS = ['62%', '78%', '54%', '70%', '84%', '58%', '74%', '66%'];

function TarjetaSkel({ i, conPildora, conBarra }: { i: number; conPildora?: boolean; conBarra?: boolean }) {
    return (
        <div className="pk-card">
            <div className="ui-skel ui-skel--circulo pk-avatar" />
            <div className="pk-card-body">
                <div className="ui-skel ui-skel--linea" style={{ width: ANCHOS[i % ANCHOS.length], height: 13 }} />
                <div className="ui-skel ui-skel--linea" style={{ width: '52%', height: 10 }} />
                <div className="ui-skel ui-skel--linea" style={{ width: '40%', height: 10 }} />
            </div>
            {conPildora && <div className="ui-skel ui-skel--pildora" style={{ width: 72 }} />}
            {conBarra && (
                <div className="pk-barra">
                    <div className="ui-skel" style={{ width: 46, height: 3, borderRadius: 999 }} />
                    <div className="ui-skel ui-skel--linea" style={{ width: 22, height: 9 }} />
                </div>
            )}
        </div>
    );
}

function FilaSkel({ i }: { i: number }) {
    return (
        <div className="pk-row">
            <div className="ui-skel ui-skel--circulo" style={{ width: 32, height: 32 }} />
            <div className="pk-row-info">
                <div className="ui-skel ui-skel--linea" style={{ width: ANCHOS[i % ANCHOS.length], height: 12 }} />
                <div className="ui-skel ui-skel--linea" style={{ width: '34%', height: 9 }} />
            </div>
            <div className="ui-skel ui-skel--pildora" style={{ width: 84 }} />
            <div className="ui-skel ui-skel--pildora" style={{ width: 64 }} />
            <div className="ui-skel" style={{ width: 16, height: 16, justifySelf: 'end' }} />
        </div>
    );
}

/** Rótulo de sección: el mismo texto + contador + regla que llega después. */
function RotuloSkel({ ancho = 132, dentroDeCaja = false }: { ancho?: number; dentroDeCaja?: boolean }) {
    return (
        <div className={`pk-rotulo${dentroDeCaja ? ' pk-rotulo--caja' : ''}`}>
            <div className="ui-skel ui-skel--linea" style={{ width: ancho, height: 14 }} />
            <div className="ui-skel ui-skel--pildora" style={{ width: 26 }} />
        </div>
    );
}

/** Directorio de la empresa: una sola rejilla, sin agrupar. */
export function DirectorioSkeleton({ vista = 'grid', filas = 12 }: { vista?: Vista; filas?: number }) {
    return (
        <div aria-busy="true" aria-live="polite" aria-label="Cargando las personas">
            {vista === 'grid' ? (
                <div className="pk-grid">
                    {Array.from({ length: filas }, (_, i) => <TarjetaSkel key={i} i={i} conPildora />)}
                </div>
            ) : (
                <div className="pk-caja">
                    {Array.from({ length: Math.min(filas, 8) }, (_, i) => <FilaSkel key={i} i={i} />)}
                </div>
            )}
            <EstilosSkeleton />
        </div>
    );
}

/** Equipo de la obra: barra, gestión y dos cuadrillas con su rótulo. */
export function EquipoObraSkeleton({ vista = 'grid' }: { vista?: Vista }) {
    const cuadrillas = [4, 4];
    return (
        <div aria-busy="true" aria-live="polite" aria-label="Cargando el equipo de la obra" className="pk-page">
            <div className="pk-toolbar">
                <div className="ui-skel" style={{ width: 300, height: 38, borderRadius: 8 }} />
                <div className="ui-skel ui-skel--linea" style={{ width: 210 }} />
                <span style={{ flex: 1 }} />
                <div className="ui-skel" style={{ width: 76, height: 36, borderRadius: 9 }} />
            </div>

            {/* Gestión: una fila de píldoras, no una rejilla. */}
            <div className="pk-chips">
                <div className="ui-skel ui-skel--linea" style={{ width: 58, height: 10 }} />
                {[150, 132, 120].map((w, i) => (
                    <div key={i} className="ui-skel ui-skel--pildora" style={{ width: w, height: 32 }} />
                ))}
            </div>

            {cuadrillas.map((n, c) => (
                <section key={c} className={vista === 'list' ? 'pk-caja' : undefined}>
                    <RotuloSkel ancho={c === 0 ? 96 : 124} dentroDeCaja={vista === 'list'} />
                    {vista === 'grid' ? (
                        <div className="pk-grid">
                            {Array.from({ length: n }, (_, i) => <TarjetaSkel key={i} i={i + c} conBarra />)}
                        </div>
                    ) : (
                        Array.from({ length: n }, (_, i) => <FilaSkel key={i} i={i + c} />)
                    )}
                </section>
            ))}
            <EstilosSkeleton />
        </div>
    );
}

/* Las medidas repiten las de la pantalla real (rejilla de 4, tarjeta de
   20/14/14, avatar de 52, fila de 5 columnas) para que el relleno no mueva
   nada de sitio. */
function EstilosSkeleton() {
    return (
        <style>{`
            .pk-page { display: flex; flex-direction: column; gap: var(--space-6); }
            .pk-toolbar { display: flex; align-items: center; gap: var(--space-3); flex-wrap: wrap; }
            .pk-chips { display: flex; align-items: center; gap: var(--space-3); flex-wrap: wrap; }

            .pk-grid {
                display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px;
            }
            .pk-card {
                display: flex; flex-direction: column; align-items: center; gap: 9px;
                padding: 20px 14px 14px;
                border: 1px solid var(--surface-border); border-radius: 12px;
            }
            .pk-avatar { width: 52px; height: 52px; flex-shrink: 0; }
            .pk-card-body {
                display: flex; flex-direction: column; align-items: center; gap: 5px; width: 100%;
            }
            .pk-barra { display: flex; align-items: center; gap: 7px; }

            .pk-rotulo {
                display: flex; align-items: center; gap: 10px;
                padding-bottom: 9px; margin-bottom: var(--space-4);
                border-bottom: 1px solid var(--surface-border);
            }
            .pk-rotulo--caja { padding: 11px var(--space-4); margin-bottom: 0; }

            .pk-caja {
                border: 1px solid var(--surface-border); border-radius: 12px; overflow: hidden;
            }
            .pk-row {
                display: grid; grid-template-columns: 34px minmax(0, 1fr) 180px 120px 32px;
                align-items: center; gap: 14px; padding: 13px var(--space-4);
                border-top: 1px solid color-mix(in srgb, var(--surface-border) 70%, transparent);
            }
            .pk-row:first-child { border-top: none; }
            .pk-rotulo--caja + .pk-row { border-top: none; }
            .pk-row-info { display: flex; flex-direction: column; gap: 5px; min-width: 0; }

            @media (max-width: 900px) { .pk-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
            @media (max-width: 760px) {
                .pk-row { grid-template-columns: 34px minmax(0, 1fr) 32px; }
                .pk-row > :nth-child(3), .pk-row > :nth-child(4) { display: none; }
            }
            @media (max-width: 580px) { .pk-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
        `}</style>
    );
}
