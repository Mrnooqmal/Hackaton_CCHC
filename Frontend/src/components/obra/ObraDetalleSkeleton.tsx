import type { PestanaObra } from './ObraCabecera';

/**
 * Esqueleto del detalle de obra.
 *
 * Reproduce la retícula real en vez de un spinner centrado: con el spinner la
 * página aparecía de golpe y en otra posición, y cada entrada al detalle era
 * un salto.
 *
 * Dibuja la pestaña que se va a abrir, no una fija. El detalle arranca en
 * Cumplimiento DS 44, así que un esqueleto con el letrero y el plano del
 * Resumen prometía una pantalla que nunca llegaba: el salto que se quería
 * evitar volvía, ahora disfrazado de carga.
 *
 * `aria-busy` va UNA vez en el contenedor: los bloques son decorativos y
 * anunciarlos por separado llenaría el lector de pantalla de cajas vacías.
 */
export default function ObraDetalleSkeleton({ pestana = 'ds44' }: { pestana?: PestanaObra }) {
    return (
        <div aria-busy="true" aria-live="polite" aria-label="Cargando la obra">
            <div className="ob-skel-cabecera">
                <div className="ob-skel-identidad">
                    <div className="ob-skel ob-skel--foto" />
                    <div className="ob-skel-texto">
                        <div className="ob-skel ob-skel--linea" style={{ width: 52 }} />
                        <div className="ob-skel ob-skel--titulo" />
                    </div>
                </div>
                <div className="ob-skel-barra">
                    <div className="ob-skel ob-skel--pestana" />
                    <div className="ob-skel ob-skel--pestana" style={{ width: 148 }} />
                </div>
            </div>

            {pestana === 'ds44' ? <EsqueletoDs44 /> : <EsqueletoResumen />}
        </div>
    );
}

/** Avance + fases arriba, requisitos y módulos abajo (ver Ds44Fases). */
function EsqueletoDs44() {
    return (
        <div className="ob-ds44">
            <section className="ob-ds44__avance">
                <div className="ob-skel-texto">
                    <div className="ob-skel ob-skel--linea" style={{ width: 132, height: 10 }} />
                    <div className="ob-skel" style={{ width: 116, height: 48 }} />
                </div>
                <div className="ob-fases">
                    {[0, 1, 2, 3].map((i) => (
                        <div key={i} className="ob-skel-fase">
                            <div className="ob-skel ob-skel--linea" style={{ width: '58%' }} />
                            <div className="ob-skel" style={{ height: 6, borderRadius: 999 }} />
                            <div className="ob-skel ob-skel--linea" style={{ width: '72%', height: 10 }} />
                        </div>
                    ))}
                </div>
            </section>

            <div className="ob-ds44__cuerpo">
                <section className="ob-skel-texto" style={{ gap: 14 }}>
                    <div className="ob-skel-encabezado">
                        <div className="ob-skel ob-skel--titulo" style={{ height: 22, width: 236 }} />
                        <div className="ob-skel" style={{ height: 38, width: 268, borderRadius: 10 }} />
                    </div>
                    <div className="ob-lista">
                        {[0, 1, 2, 3, 4].map((i) => (
                            <div key={i} className="ob-skel-requisito">
                                <div className="ob-skel ob-skel--circulo" style={{ width: 22, height: 22 }} />
                                <div className="ob-skel-texto" style={{ gap: 7 }}>
                                    <div className="ob-skel ob-skel--linea" style={{ width: `${68 - i * 6}%` }} />
                                    <div className="ob-skel ob-skel--linea" style={{ width: '38%', height: 10 }} />
                                </div>
                                <div className="ob-skel" style={{ width: 84, height: 28, borderRadius: 8 }} />
                            </div>
                        ))}
                    </div>
                </section>

                <aside className="ob-modulos">
                    <div className="ob-skel ob-skel--linea" style={{ width: 164, height: 16 }} />
                    <div className="ob-skel ob-skel--linea" style={{ width: '92%', marginTop: 8 }} />
                    <div className="ob-skel ob-skel--linea" style={{ width: '74%', marginBottom: 10 }} />
                    {[0, 1, 2].map((i) => (
                        <div key={i} className="ob-skel-modulo">
                            <div className="ob-skel ob-skel--linea" style={{ width: '52%' }} />
                            <div className="ob-skel ob-skel--linea" style={{ width: '86%', height: 10 }} />
                        </div>
                    ))}
                </aside>
            </div>
        </div>
    );
}

/** Letrero de identificación + plano de ubicación (ver ObraResumen). */
function EsqueletoResumen() {
    return (
        <div className="ob-resumen">
            <section className="ob-panel ob-skel-panel ob-span-5">
                <div className="ob-skel ob-skel--linea" style={{ width: 128 }} />
                <div className="ob-skel ob-skel--titulo" style={{ height: 34, width: '70%' }} />
                <div className="ob-skel-fila">
                    <div className="ob-skel ob-skel--linea" />
                    <div className="ob-skel ob-skel--linea" />
                </div>
                <div className="ob-skel-fila">
                    <div className="ob-skel ob-skel--linea" style={{ height: 18 }} />
                    <div className="ob-skel ob-skel--linea" style={{ height: 18 }} />
                </div>
            </section>

            <section className="ob-panel ob-skel-panel ob-span-7">
                <div className="ob-skel" style={{ height: 168, borderRadius: 'var(--radius-md)' }} />
                <div className="ob-skel ob-skel--linea" style={{ width: 96 }} />
                <div className="ob-skel ob-skel--linea" style={{ width: '55%', height: 18 }} />
            </section>
        </div>
    );
}
