/**
 * Esqueletos de la pantalla de Encuestas.
 *
 * El encabezado, las pestañas, el buscador y el toggle "Mostrar" no dependen
 * de `surveys` (son texto fijo o estado local), así que Surveys.tsx los
 * dibuja reales desde el primer render — igual que en Actividades. Solo lo
 * que sí depende de los datos —las tarjetas de resumen, las filas de "Mis
 * encuestas" y la rejilla de "Encuestas creadas"— se reemplaza por estas
 * piezas mientras `loading` es true, con la misma forma que el contenido
 * real, para que no haya un salto al llegar la respuesta.
 */

/** Anchos que no se repiten fila a fila: un bloque parejo se lee como tabla. */
const ANCHOS = ['62%', '78%', '54%', '70%', '84%'];

export function SurveyStatTileSkeleton() {
    return (
        <div className="survey-stat-tile" aria-hidden="true">
            <span className="ui-skel ui-skel--linea" style={{ width: 110, height: 10 }} />
            <span className="ui-skel ui-skel--linea" style={{ width: 46, height: 26, marginTop: 2 }} />
            <span className="ui-skel ui-skel--linea" style={{ width: 90, height: 10 }} />
        </div>
    );
}

export function SurveyRowSkeleton({ i = 0 }: { i?: number }) {
    return (
        <li aria-hidden="true">
            <div className="survey-row" style={{ cursor: 'default' }}>
                <span className="survey-row-icon">
                    <span className="ui-skel ui-skel--circulo" style={{ width: 16, height: 16 }} />
                </span>
                <div className="survey-row-main">
                    <div className="ui-skel ui-skel--linea" style={{ width: ANCHOS[i % ANCHOS.length], height: 13 }} />
                    <div className="ui-skel ui-skel--linea" style={{ width: '34%', height: 10, marginTop: 6 }} />
                </div>
                <span className="ui-skel ui-skel--pildora" style={{ width: 64, height: 20 }} />
            </div>
        </li>
    );
}

/** Un solo contenedor (no sabemos aún si serán "Pendientes" o "Respondidas"). */
export function SurveyRowSectionSkeleton({ rows = 3 }: { rows?: number }) {
    return (
        <section className="survey-row-section" aria-hidden="true">
            <div className="survey-row-section-header">
                <span className="ui-skel ui-skel--linea" style={{ width: 90, height: 15 }} />
                <span className="ui-skel ui-skel--linea" style={{ width: 70, height: 12 }} />
            </div>
            <ul className="survey-row-list">
                {Array.from({ length: rows }, (_, i) => <SurveyRowSkeleton key={i} i={i} />)}
            </ul>
        </section>
    );
}

export function SurveyCardSkeleton({ i = 0 }: { i?: number }) {
    return (
        <div className="card survey-card" aria-hidden="true">
            <div className="survey-card-head">
                <span className="ui-skel ui-skel--linea" style={{ width: ANCHOS[i % ANCHOS.length], height: 15 }} />
                <span className="ui-skel ui-skel--pildora" style={{ width: 64 }} />
            </div>
            <span className="ui-skel ui-skel--linea" style={{ width: '82%', height: 11 }} />
            <span className="ui-skel ui-skel--linea" style={{ width: '56%', height: 10 }} />
            <div className="survey-card-metrics">
                {[0, 1, 2, 3].map((n) => (
                    <span key={n}>
                        <span className="ui-skel ui-skel--linea" style={{ width: 22, height: 15 }} />
                        <span className="ui-skel ui-skel--linea" style={{ width: 44, height: 9, marginTop: 4 }} />
                    </span>
                ))}
            </div>
            <span className="ui-skel" style={{ display: 'block', width: '100%', height: 4, borderRadius: 999 }} />
            <span className="ui-skel" style={{ display: 'block', width: '100%', height: 36, borderRadius: 'var(--radius-md)' }} />
        </div>
    );
}

/** Una pregunta: rótulo, tipo, título y la fila de opciones. */
function PreguntaSkeleton({ i = 0 }: { i?: number }) {
    return (
        <div className="card survey-question-card" aria-hidden="true">
            <div className="survey-question-header">
                <span className="ui-skel ui-skel--pildora" style={{ width: 78, height: 20 }} />
                <span className="ui-skel ui-skel--pildora" style={{ width: 110, height: 20 }} />
            </div>
            <span className="ui-skel ui-skel--linea" style={{ width: ANCHOS[i % ANCHOS.length], height: 14 }} />
            <div className="option-pill-group">
                {[70, 56, 64].map((w, n) => <span key={n} className="ui-skel ui-skel--pildora" style={{ width: w, height: 30 }} />)}
            </div>
        </div>
    );
}

export function SurveyDetalleSkeleton() {
    return (
        <div className="survey-detail" aria-hidden="true">
            <div className="survey-detail-meta">
                <span className="ui-skel ui-skel--pildora" style={{ width: 60 }} />
                <span className="ui-skel ui-skel--linea" style={{ width: 180, height: 11 }} />
            </div>
            <div className="survey-stats survey-stats--4">
                {[0, 1, 2, 3].map((n) => <SurveyStatTileSkeleton key={n} />)}
            </div>
            <div className="survey-question-list">
                {[0, 1, 2].map((n) => <PreguntaSkeleton key={n} i={n} />)}
            </div>
        </div>
    );
}

export function SurveyResponderSkeleton() {
    return (
        <div className="survey-respond-list" style={{ maxWidth: 760, margin: '0 auto' }} aria-hidden="true">
            {[0, 1, 2].map((n) => <PreguntaSkeleton key={n} i={n} />)}
        </div>
    );
}
