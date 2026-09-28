/**
 * Esqueletos de "Mis Firmas".
 *
 * El encabezado (título, descripción, pestañas) no depende de los datos, así
 * que MySignatures.tsx lo dibuja real desde el primer render — igual que en
 * Actividades y Encuestas. Solo lo que sí depende de `pendingRequests` /
 * `signatureHistory` (el panel "Tu avance" y las tarjetas u filas) se
 * reemplaza por estas piezas mientras `loading` es true, con la misma forma
 * que el contenido real, para que no haya un salto al llegar la respuesta.
 */

/** Anchos que no se repiten fila a fila: un bloque parejo se lee como tabla. */
const ANCHOS = ['62%', '78%', '54%'];

export function MsigCardSkeleton({ i = 0 }: { i?: number }) {
    return (
        <div className="msig-card" aria-hidden="true">
            <div className="msig-card-main">
                <span className="msig-card-icon">
                    <span className="ui-skel ui-skel--circulo" style={{ width: 18, height: 18 }} />
                </span>
                <div className="msig-card-body">
                    <span className="ui-skel ui-skel--linea" style={{ width: 96, height: 9 }} />
                    <div className="ui-skel ui-skel--linea" style={{ width: ANCHOS[i % ANCHOS.length], height: 16, marginTop: 8 }} />
                    <div className="ui-skel ui-skel--linea" style={{ width: '42%', height: 10, marginTop: 8 }} />
                </div>
                <div className="msig-card-action">
                    <span className="ui-skel ui-skel--pildora" style={{ width: 48, height: 20 }} />
                    <span className="ui-skel ui-skel--pildora" style={{ width: 84, height: 30 }} />
                </div>
            </div>
        </div>
    );
}

export function MsigAvanceSkeleton() {
    return (
        <section className="msig-avance-card" aria-hidden="true">
            <div className="msig-avance-head">
                <span className="ui-skel ui-skel--linea" style={{ width: 78, height: 14 }} />
                <span className="ui-skel ui-skel--linea" style={{ width: 50, height: 10 }} />
            </div>

            <div className="msig-avance-bar-wrap">
                <div className="msig-avance-numbers">
                    <span className="ui-skel ui-skel--linea" style={{ width: 64, height: 28 }} />
                    <span className="ui-skel ui-skel--linea" style={{ width: 92, height: 10 }} />
                </div>
                <span className="ui-skel" style={{ display: 'block', width: '100%', height: 6, borderRadius: 999 }} />
            </div>

            <span className="ui-skel ui-skel--linea" style={{ width: 150, height: 10, margin: 'var(--space-5) var(--space-5) 0' }} />

            <ul className="msig-timeline">
                {[0, 1].map((i) => (
                    <li key={i} className="msig-timeline-item">
                        <span className="msig-timeline-rail">
                            <span className="ui-skel ui-skel--circulo" style={{ width: 9, height: 9 }} />
                            {i === 0 && <span className="msig-timeline-line" />}
                        </span>
                        <span className="msig-timeline-body">
                            <span className="ui-skel ui-skel--linea" style={{ width: '72%', height: 12 }} />
                            <span className="ui-skel ui-skel--linea" style={{ width: '46%', height: 10, marginTop: 5 }} />
                        </span>
                    </li>
                ))}
            </ul>

            <span className="ui-skel ui-skel--linea" style={{ width: 130, height: 12, margin: 'var(--space-4) var(--space-5)' }} />
        </section>
    );
}

export function MsigHistRowSkeleton({ i = 0 }: { i?: number }) {
    return (
        <div className="msig-hist-row" aria-hidden="true" style={{ cursor: 'default' }}>
            <span className="msig-hist-icon">
                <span className="ui-skel ui-skel--circulo" style={{ width: 15, height: 15 }} />
            </span>
            <span className="msig-hist-body">
                <span className="ui-skel ui-skel--linea" style={{ width: ANCHOS[i % ANCHOS.length], height: 13 }} />
                <span className="ui-skel ui-skel--linea" style={{ width: '32%', height: 9, marginTop: 5 }} />
            </span>
            <span className="ui-skel ui-skel--linea" style={{ width: 46, height: 11 }} />
        </div>
    );
}
