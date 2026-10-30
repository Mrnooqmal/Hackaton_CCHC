/**
 * Esqueletos del Inicio.
 *
 * Mismo criterio que ui/Skeletons: se dibuja la retícula real —la lista de
 * pendientes y la agenda del día— en vez de un bloque pulsante que llena el
 * panel. El bloque anterior (`.inicio-cargando`) ocupaba todo el alto y el
 * contenido aparecía después en otra posición, que es justo el salto que los
 * esqueletos existen para evitar.
 *
 * `aria-busy` va UNA vez en el contenedor; los bloques son decorativos.
 */

/** Anchos que no se repiten fila a fila: un bloque parejo se lee como tabla. */
const ANCHOS = ['68%', '52%', '76%', '60%', '84%'];

/** Fila con la forma de `.inicio-item`: icono, cuerpo, marca y chevron. */
function ItemSkel({ i, conMarca }: { i: number; conMarca?: boolean }) {
    return (
        <li>
            <div className="inicio-item">
                <span className="inicio-item-icono">
                    <span className="ui-skel ui-skel--circulo" style={{ width: 18, height: 18, display: 'block' }} />
                </span>
                <span className="inicio-item-cuerpo">
                    <span className="ui-skel ui-skel--linea" style={{ width: ANCHOS[i % ANCHOS.length], height: 12 }} />
                    <span className="ui-skel ui-skel--linea" style={{ width: '38%', height: 9 }} />
                </span>
                {conMarca && <span className="ui-skel ui-skel--pildora" style={{ width: 58, height: 18 }} />}
                <span className="inicio-item-chevron">
                    <span className="ui-skel" style={{ width: 14, height: 14, display: 'block' }} />
                </span>
            </div>
        </li>
    );
}

/** Lista de un panel del Inicio (pendientes o agenda del día). */
export function ListaInicioSkeleton({ filas = 3, conMarca = false }: { filas?: number; conMarca?: boolean }) {
    return (
        <ul className="inicio-lista" aria-busy="true" aria-label="Cargando">
            {Array.from({ length: filas }, (_, i) => (
                <ItemSkel key={i} i={i} conMarca={conMarca} />
            ))}
        </ul>
    );
}

/** Estado de un acceso rápido: evita el guion suelto mientras se calcula. */
export function AccesoEstadoSkeleton() {
    return <span className="ui-skel ui-skel--linea" style={{ width: 54, height: 9, display: 'inline-block' }} />;
}
