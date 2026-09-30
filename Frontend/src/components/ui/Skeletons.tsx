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

/** Equipo de la obra: barra, gestión y dos cuadrillas, todos con su rótulo. */
export function EquipoObraSkeleton({ vista = 'grid' }: { vista?: Vista }) {
    // Gestión se dibuja igual que una cuadrilla: va primero, con menos gente.
    const cuadrillas = [3, 4, 4];
    return (
        <div aria-busy="true" aria-live="polite" aria-label="Cargando el equipo de la obra" className="sk-page">
            <div className="sk-toolbar">
                <div className="ui-skel" style={{ width: 300, height: 38, borderRadius: 8 }} />
                <div className="ui-skel ui-skel--linea" style={{ width: 210 }} />
                <span style={{ flex: 1 }} />
                <div className="ui-skel" style={{ width: 76, height: 36, borderRadius: 9 }} />
            </div>

            {cuadrillas.map((n, c) => (
                <section key={c} className={vista === 'list' ? 'sk-caja' : undefined}>
                    <RotuloSkel ancho={[72, 96, 124][c]} dentroDeCaja={vista === 'list'} />
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

/**
 * Listado de incidentes y hallazgos: ícono de 38px, rótulo + descripción +
 * meta, y las dos pastillas apiladas (cierre/estado y gravedad) de cada fila.
 */
export function IncidentesSkeleton({ filas = 5 }: { filas?: number }) {
    return (
        <div aria-busy="true" aria-live="polite" aria-label="Cargando los reportes">
            {Array.from({ length: filas }, (_, i) => (
                <div key={i} className="sk-inc-row">
                    <div className="ui-skel" style={{ width: 38, height: 38, borderRadius: 10 }} />
                    <div className="sk-row-info">
                        <div className="ui-skel ui-skel--linea" style={{ width: 170, height: 9 }} />
                        <div className="ui-skel ui-skel--linea" style={{ width: ANCHOS[i % ANCHOS.length], height: 13 }} />
                        <div className="ui-skel ui-skel--linea" style={{ width: '32%', height: 9 }} />
                    </div>
                    <div className="sk-inc-pills">
                        <div className="ui-skel ui-skel--pildora" style={{ width: 78 }} />
                        <div className="ui-skel ui-skel--pildora" style={{ width: 56 }} />
                    </div>
                </div>
            ))}
            <EstilosSkeleton />
        </div>
    );
}

/** Estadísticas de incidentes: cuatro tarjetas y dos filas de dos gráficos. */
export function IncidentesStatsSkeleton() {
    return (
        <div aria-busy="true" aria-live="polite" aria-label="Cargando las estadísticas" className="sk-page">
            <div className="sk-inc-stats">
                {Array.from({ length: 4 }, (_, i) => (
                    <div key={i} className="sk-inc-stat">
                        <div className="ui-skel ui-skel--circulo" style={{ width: 40, height: 40 }} />
                        <div className="sk-row-info">
                            <div className="ui-skel ui-skel--linea" style={{ width: 48, height: 20 }} />
                            <div className="ui-skel ui-skel--linea" style={{ width: '70%', height: 9 }} />
                        </div>
                    </div>
                ))}
            </div>
            {[0, 1].map((r) => (
                <div key={r} className="sk-inc-charts">
                    {[0, 1].map((c) => (
                        <div key={c} className="sk-inc-chart">
                            <div className="ui-skel ui-skel--linea" style={{ width: 140, height: 13 }} />
                            <div className="ui-skel" style={{ height: 150, borderRadius: 10 }} />
                        </div>
                    ))}
                </div>
            ))}
            <EstilosSkeleton />
        </div>
    );
}

/* ── Paneles DS44 (SGSST, estructura preventiva, completitud del FUF) ──────
   Usan las mismas clases que el panel ya cargado (.card, .ds44-progress-track,
   .ds44-doc-row), así que caen en el mismo sitio y con la misma altura. */

/** Tarjeta de resumen: rótulo a la izquierda, cifra a la derecha, barra y nota. */
function ResumenProgresoSkel({ rotulo, cifra }: { rotulo: number; cifra: number }) {
    return (
        <div className="card" style={{ padding: 'var(--space-4)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--space-3)', marginBottom: 8 }}>
                <div className="ui-skel ui-skel--linea" style={{ width: rotulo, height: 11 }} />
                <div className="ui-skel ui-skel--linea" style={{ width: cifra, height: 16 }} />
            </div>
            <div className="ds44-progress-track" />
            <div className="ui-skel ui-skel--linea" style={{ width: '58%', height: 10, marginTop: 8 }} />
        </div>
    );
}

/** Fila de requisito: título + detalle a la izquierda, estado y acción a la derecha. */
function FilaDs44Skel({ i, letra, accion = true }: { i: number; letra?: boolean; accion?: boolean }) {
    const texto = (
        <div className="sk-row-info" style={{ flex: 1 }}>
            <div className="ui-skel ui-skel--linea" style={{ width: ANCHOS[i % ANCHOS.length], height: 13 }} />
            <div className="ui-skel ui-skel--linea" style={{ width: '46%', height: 10 }} />
        </div>
    );
    return (
        <div className={`ds44-doc-row${letra ? ' sgsst-row' : ''}`}>
            {letra ? (
                <div className="sgsst-row-main">
                    <div className="ui-skel" style={{ width: 26, height: 26, flexShrink: 0 }} />
                    {texto}
                </div>
            ) : texto}
            <div className="sk-ds44-acciones">
                <div className="ui-skel ui-skel--pildora" style={{ width: 84, height: 22 }} />
                {accion && <div className="ui-skel" style={{ width: 76, height: 32, borderRadius: 8 }} />}
            </div>
        </div>
    );
}

/** SGSST: el resumen del Art. 22 y sus cinco componentes, siempre cinco. */
export function SgsstSkeleton() {
    return (
        <div aria-busy="true" aria-live="polite" aria-label="Cargando el sistema de gestión" className="sk-ds44">
            <ResumenProgresoSkel rotulo={190} cifra={44} />
            <div className="sk-ds44-filas">
                {Array.from({ length: 5 }, (_, i) => <FilaDs44Skel key={i} i={i} letra />)}
            </div>
            <EstilosSkeleton />
        </div>
    );
}

/** Estructura preventiva: la tarjeta de dotación y una fila por órgano. */
export function EstructuraPreventivaSkeleton({ filas = 3 }: { filas?: number }) {
    return (
        <div aria-busy="true" aria-live="polite" aria-label="Cargando la estructura preventiva" className="sk-ds44">
            <div className="card" style={{ padding: 'var(--space-4)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-2)' }}>
                    <div className="ui-skel ui-skel--circulo" style={{ width: 16, height: 16 }} />
                    <div className="ui-skel ui-skel--linea" style={{ width: 170, height: 13 }} />
                    <div className="ui-skel ui-skel--pildora" style={{ width: 120, height: 22 }} />
                </div>
                <div className="ui-skel ui-skel--linea" style={{ width: '88%', height: 11, marginTop: 4 }} />
                <div className="ui-skel ui-skel--linea" style={{ width: '64%', height: 11, marginTop: 8 }} />
            </div>
            <div className="sk-ds44-filas">
                {Array.from({ length: filas }, (_, i) => <FilaDs44Skel key={i} i={i + 2} />)}
            </div>
            <EstilosSkeleton />
        </div>
    );
}

/** Completitud del FUF: el resumen y los bloques, que llegan plegados. */
export function CompletitudFufSkeleton({ bloques = 4 }: { bloques?: number }) {
    return (
        <div aria-busy="true" aria-live="polite" aria-label="Calculando la completitud" className="sk-ds44">
            <ResumenProgresoSkel rotulo={140} cifra={120} />
            {Array.from({ length: bloques }, (_, i) => (
                <div key={i} className="card" style={{ padding: 'var(--space-3)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-2)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1 }}>
                            <div className="ui-skel" style={{ width: 15, height: 15 }} />
                            <div className="ui-skel ui-skel--linea" style={{ width: ANCHOS[(i + 3) % ANCHOS.length], maxWidth: 320, height: 13 }} />
                        </div>
                        <div className="ui-skel ui-skel--linea" style={{ width: 64, height: 12 }} />
                    </div>
                </div>
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

            /* Incidentes: misma rejilla que .incident-row (Incidents.tsx). */
            .sk-inc-row {
                display: grid; grid-template-columns: auto 1fr auto; gap: var(--space-4);
                align-items: flex-start; padding: var(--space-4) var(--space-5);
                border-bottom: 1px solid var(--surface-border);
            }
            .sk-inc-pills { display: flex; flex-direction: column; align-items: flex-end; gap: var(--space-1); }
            .sk-inc-stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: var(--space-4); }
            .sk-inc-stat {
                display: flex; align-items: center; gap: var(--space-3); padding: var(--space-5);
                border: 1px solid var(--surface-border); border-radius: var(--radius-lg);
            }
            .sk-inc-charts { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-4); }
            .sk-inc-chart {
                display: flex; flex-direction: column; gap: var(--space-4); padding: var(--space-4);
                border: 1px solid var(--surface-border); border-radius: var(--radius-lg);
            }
            /* Paneles DS44: mismos huecos que el panel cargado (space-3 / space-2). */
            .sk-ds44 { display: flex; flex-direction: column; gap: var(--space-3); }
            .sk-ds44-filas { display: flex; flex-direction: column; gap: var(--space-2); }
            .sk-ds44-acciones { display: flex; align-items: center; gap: var(--space-2); flex-shrink: 0; }

            @media (max-width: 1024px) { .sk-inc-stats { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
            @media (max-width: 1200px) { .sk-inc-charts { grid-template-columns: 1fr; } }

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
