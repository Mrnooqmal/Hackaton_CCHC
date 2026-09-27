/**
 * Filas de esqueleto para la pantalla de Actividades (vista Lista).
 *
 * No es una pantalla de carga aparte: el buscador, el filtro, los rótulos de
 * «Hoy»/«Historial» y los filtros del historial no dependen de los datos
 * (son estado local o texto fijo), así que Activities.tsx los dibuja reales
 * desde el primer render. Solo el CONTENIDO de esas dos listas —lo único que
 * sí necesita `activities`— se reemplaza por estas filas mientras `loading`
 * es true, insertadas dentro del mismo `<ul>`/`<tbody>` real. Así la
 * estructura que carga es la misma que la real, y no hay salto al llegar
 * los datos.
 *
 * `aria-hidden` en cada fila: son decorativas, y el contenedor real ya trae
 * su propio rótulo accesible.
 */

/** Anchos que no se repiten fila a fila: un bloque parejo se lee como tabla. */
const ANCHOS = ['62%', '78%', '54%', '70%', '84%'];

export function ActivitiesHoySkeletonRows() {
    return (
        <>
            {[0, 1, 2].map((i) => (
                <li key={i} aria-hidden="true">
                    <div className="act-row" style={{ cursor: 'default' }}>
                        <span className="act-row-when">
                            <span className="act-row-type">
                                <span className="ui-skel ui-skel--circulo" style={{ width: 18, height: 18 }} />
                            </span>
                            <span className="act-row-hora">
                                <span className="ui-skel ui-skel--linea" style={{ width: 34, height: 12 }} />
                            </span>
                        </span>

                        <div className="act-row-main">
                            <div className="ui-skel ui-skel--linea" style={{ width: ANCHOS[i % ANCHOS.length], height: 13 }} />
                            <div className="ui-skel ui-skel--linea" style={{ width: '38%', height: 10, marginTop: 6 }} />
                        </div>

                        <div className="act-firmas">
                            <span className="ui-skel ui-skel--linea" style={{ width: 46, height: 10 }} />
                            <span className="act-firmas-bar"><i style={{ width: 0 }} /></span>
                            <span className="ui-skel ui-skel--linea" style={{ width: 72, height: 9 }} />
                        </div>

                        <div className="act-row-actions">
                            <div className="ui-skel ui-skel--pildora" style={{ width: 134, height: 30 }} />
                        </div>
                    </div>
                </li>
            ))}
        </>
    );
}

export function ActivitiesHistSkeletonRows() {
    return (
        <>
            {[0, 1, 2, 3].map((i) => (
                <tr key={i} aria-hidden="true">
                    <td>
                        <span className="ui-skel ui-skel--linea" style={{ width: 40, height: 13 }} />
                        <span className="ui-skel ui-skel--linea" style={{ width: 34, height: 9, marginTop: 5 }} />
                    </td>
                    <td>
                        <span className="ui-skel ui-skel--linea" style={{ width: ANCHOS[i % ANCHOS.length], height: 13 }} />
                        <span className="ui-skel ui-skel--linea" style={{ width: '30%', height: 9, marginTop: 5 }} />
                    </td>
                    <td>
                        <span className="ui-skel ui-skel--linea" style={{ width: 60, height: 12 }} />
                    </td>
                    <td>
                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
                            <span className="ui-skel" style={{ width: 28, height: 28, borderRadius: 'var(--radius-md)' }} />
                            <span className="ui-skel" style={{ width: 28, height: 28, borderRadius: 'var(--radius-md)' }} />
                        </div>
                    </td>
                </tr>
            ))}
        </>
    );
}
