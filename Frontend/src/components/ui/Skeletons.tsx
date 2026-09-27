/**
 * Esqueletos de las pantallas de colección: Personas (empresa y obra) y Obras.
 *
 * Dibujan la retícula real —la rejilla de tarjetas, las filas, los rótulos de
 * cuadrilla— en vez de un spinner centrado: con el spinner el contenido
 * aparecía de golpe y en otra posición, y cada entrada era un salto.
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
        <div className="sk-card">
            <div className="ui-skel ui-skel--circulo sk-avatar" />
            <div className="sk-card-body">
                <div className="ui-skel ui-skel--linea" style={{ width: ANCHOS[i % ANCHOS.length], height: 13 }} />
                <div className="ui-skel ui-skel--linea" style={{ width: '52%', height: 10 }} />
                <div className="ui-skel ui-skel--linea" style={{ width: '40%', height: 10 }} />
            </div>
            {conPildora && <div className="ui-skel ui-skel--pildora" style={{ width: 72 }} />}
            {conBarra && (
                <div className="sk-barra">
                    <div className="ui-skel" style={{ width: 46, height: 3, borderRadius: 999 }} />
                    <div className="ui-skel ui-skel--linea" style={{ width: 22, height: 9 }} />
                </div>
            )}
        </div>
    );
}

function FilaSkel({ i }: { i: number }) {
    return (
        <div className="sk-row">
            <div className="ui-skel ui-skel--circulo" style={{ width: 32, height: 32 }} />
            <div className="sk-row-info">
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
        <div className={`sk-rotulo${dentroDeCaja ? ' sk-rotulo--caja' : ''}`}>
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
                <div className="sk-grid">
                    {Array.from({ length: filas }, (_, i) => <TarjetaSkel key={i} i={i} conPildora />)}
                </div>
            ) : (
                <div className="sk-caja">
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
        <div aria-busy="true" aria-live="polite" aria-label="Cargando el equipo de la obra" className="sk-page">
            <div className="sk-toolbar">
                <div className="ui-skel" style={{ width: 300, height: 38, borderRadius: 8 }} />
                <div className="ui-skel ui-skel--linea" style={{ width: 210 }} />
                <span style={{ flex: 1 }} />
                <div className="ui-skel" style={{ width: 76, height: 36, borderRadius: 9 }} />
            </div>

            {/* Gestión: una fila de píldoras, no una rejilla. */}
            <div className="sk-chips">
                <div className="ui-skel ui-skel--linea" style={{ width: 58, height: 10 }} />
                {[150, 132, 120].map((w, i) => (
                    <div key={i} className="ui-skel ui-skel--pildora" style={{ width: w, height: 32 }} />
                ))}
            </div>

            {cuadrillas.map((n, c) => (
                <section key={c} className={vista === 'list' ? 'sk-caja' : undefined}>
                    <RotuloSkel ancho={c === 0 ? 96 : 124} dentroDeCaja={vista === 'list'} />
                    {vista === 'grid' ? (
                        <div className="sk-grid">
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

/**
 * Listado de obras.
 *
 * Su tarjeta no se parece a la de una persona: la manda una foto de 160px con
 * el nombre y el estado debajo, así que el esqueleto reserva ese bloque. Un
 * esqueleto de tarjetas de persona acá habría prometido otra pantalla.
 */
export function ObrasSkeleton({ vista = 'grid', filas = 6 }: { vista?: Vista; filas?: number }) {
    return (
        <div aria-busy="true" aria-live="polite" aria-label="Cargando las obras">
            {vista === 'grid' ? (
                <div className="sk-grid sk-grid--obras">
                    {Array.from({ length: filas }, (_, i) => (
                        <div key={i} className="sk-obra">
                            <div className="ui-skel sk-obra-foto" />
                            <div className="sk-obra-body">
                                <div className="sk-obra-titulo">
                                    <div className="ui-skel ui-skel--linea" style={{ width: ANCHOS[i % ANCHOS.length], height: 13 }} />
                                    <div className="ui-skel ui-skel--pildora" style={{ width: 58 }} />
                                </div>
                                <div className="ui-skel ui-skel--linea" style={{ width: '58%', height: 10 }} />
                                <div className="ui-skel ui-skel--linea" style={{ width: 76, height: 9 }} />
                            </div>
                        </div>
                    ))}
                </div>
            ) : (
                <div className="sk-caja">
                    {Array.from({ length: filas }, (_, i) => (
                        <div key={i} className="sk-row sk-row--obras">
                            <div className="ui-skel ui-skel--linea" style={{ width: 92, height: 10 }} />
                            <div className="ui-skel ui-skel--linea" style={{ width: ANCHOS[i % ANCHOS.length], height: 12 }} />
                            <div className="ui-skel ui-skel--pildora" style={{ width: 62 }} />
                            <div className="ui-skel ui-skel--linea" style={{ width: 54, height: 10, justifySelf: 'center' }} />
                            <div className="ui-skel ui-skel--linea" style={{ width: '62%', height: 10 }} />
                        </div>
                    ))}
                </div>
            )}
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
            .sk-page { display: flex; flex-direction: column; gap: var(--space-6); }
            .sk-toolbar { display: flex; align-items: center; gap: var(--space-3); flex-wrap: wrap; }
            .sk-chips { display: flex; align-items: center; gap: var(--space-3); flex-wrap: wrap; }

            .sk-grid {
                display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px;
            }
            .sk-card {
                display: flex; flex-direction: column; align-items: center; gap: 9px;
                padding: 20px 14px 14px;
                border: 1px solid var(--surface-border); border-radius: 12px;
            }
            .sk-avatar { width: 52px; height: 52px; flex-shrink: 0; }
            .sk-card-body {
                display: flex; flex-direction: column; align-items: center; gap: 5px; width: 100%;
            }
            .sk-barra { display: flex; align-items: center; gap: 7px; }

            .sk-rotulo {
                display: flex; align-items: center; gap: 10px;
                padding-bottom: 9px; margin-bottom: var(--space-4);
                border-bottom: 1px solid var(--surface-border);
            }
            .sk-rotulo--caja { padding: 11px var(--space-4); margin-bottom: 0; }

            /* Obras: la rejilla se acomoda sola y la tarjeta la abre la foto. */
            .sk-grid--obras { grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: var(--space-4); }
            .sk-obra {
                border: 1px solid var(--surface-border); border-radius: var(--radius-lg); overflow: hidden;
            }
            .sk-obra-foto { height: 160px; border-radius: 0; }
            .sk-obra-body { display: flex; flex-direction: column; gap: 7px; padding: var(--space-3); }
            .sk-obra-titulo { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); }

            .sk-caja {
                border: 1px solid var(--surface-border); border-radius: 12px; overflow: hidden;
            }
            .sk-row {
                display: grid; grid-template-columns: 34px minmax(0, 1fr) 180px 120px 32px;
                align-items: center; gap: 14px; padding: 13px var(--space-4);
                border-top: 1px solid color-mix(in srgb, var(--surface-border) 70%, transparent);
            }
            .sk-row:first-child { border-top: none; }
            .sk-rotulo--caja + .sk-row { border-top: none; }
            .sk-row-info { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
            /* Código · nombre · estado · DS 44 · ubicación (ver obraColumns). */
            .sk-row--obras { grid-template-columns: 140px minmax(0, 1fr) 110px 90px minmax(0, 1fr); }

            @media (max-width: 900px) { .sk-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
            @media (max-width: 760px) {
                .sk-row { grid-template-columns: 34px minmax(0, 1fr) 32px; }
                .sk-row > :nth-child(3), .sk-row > :nth-child(4) { display: none; }
                .sk-row--obras { grid-template-columns: 110px minmax(0, 1fr) 90px; }
                .sk-row--obras > :nth-child(4), .sk-row--obras > :nth-child(5) { display: none; }
            }
            @media (max-width: 580px) { .sk-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
        `}</style>
    );
}
