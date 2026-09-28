/**
 * POST /csp/reporte — recibe los reportes de la Content-Security-Policy del
 * frontend y los deja en CloudWatch.
 *
 * La CSP se activa primero en modo SOLO REPORTE: el navegador no bloquea nada,
 * pero avisa acá cada vez que algo la habría violado. Cuando pasen unos días sin
 * violaciones legítimas (un origen que la app sí usa y faltó en la política), se
 * pasa a activa. Esta ruta es la que permite verlo.
 *
 * ── Es pública, y eso obliga a tres cosas ───────────────────────────────────
 *
 *  1. **Sin tokens en los logs.** El reporte trae la URL de la página y el
 *     referer, y hay páginas con un token en la URL (restablecer contraseña:
 *     `?pid=…&token=…`; licencia de alta: el token va en la ruta de la API, pero
 *     también puede llegar como consulta). A TODA URL se le quita la consulta y
 *     el fragmento antes de registrarla. Se conserva el origen y la ruta, que es
 *     lo que sirve para saber dónde ocurrió la violación.
 *  2. **Tamaño y ritmo acotados.** El cuerpo no puede pasar de `MAX_BYTES` ni
 *     traer más de `MAX_REPORTES` violaciones, y la ruta tiene su propio límite
 *     de tasa en `serverless.yml` (RouteSettings). Cualquiera puede llamarla: no
 *     puede servir para llenar CloudWatch ni para gastar Lambda.
 *  3. **Solo los campos útiles.** Nunca el reporte entero: se descartan la
 *     política completa (la conocemos), la muestra del script (`script-sample`,
 *     que puede traer texto de la página, datos personales incluidos) y el
 *     user-agent.
 *
 * Acepta los dos formatos que mandan los navegadores: `report-uri`
 * (`application/csp-report`, un objeto `csp-report`) y `report-to`
 * (`application/reports+json`, un arreglo de reportes `csp-violation`).
 */

const { error, headers } = require('../../lib/utils/response');

const MAX_BYTES = 8 * 1024;
const MAX_REPORTES = 20;
const ESPACIO = 'BuildAndServe';
const METRICA = 'CspViolaciones';

/**
 * Deja solo esquema, host y ruta. Sin consulta ni fragmento: ahí viajan los
 * tokens. Lo que no es una URL (`inline`, `eval`, `data`, `blob:…`) se reduce
 * a su palabra clave o a su esquema, que es lo único que dice algo de la
 * violación.
 */
function sinConsulta(valor) {
    if (valor === undefined || valor === null || valor === '') return null;
    const texto = String(valor).slice(0, 2048);
    if (/^(inline|eval|self|wasm-eval|trusted-types-sink)$/i.test(texto)) return texto.toLowerCase();
    const esquema = /^([a-z][a-z0-9+.-]*):/i.exec(texto)?.[1]?.toLowerCase();
    if (esquema === 'data' || esquema === 'blob' || esquema === 'filesystem' || esquema === 'about') return esquema;
    try {
        const u = new URL(texto);
        return `${u.protocol}//${u.host}${u.pathname}`.slice(0, 512);
    } catch {
        // No es una URL válida: se corta en el primer `?` o `#` por las dudas.
        return texto.split(/[?#]/)[0].slice(0, 512);
    }
}

const texto = (v, max = 128) => (typeof v === 'string' ? v.slice(0, max) : null);
const numero = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);

/** Normaliza una violación de cualquiera de los dos formatos a los campos útiles. */
function camposUtiles(r) {
    // `report-to` usa camelCase; `report-uri`, guiones.
    const g = (camel, guion) => (r[camel] !== undefined ? r[camel] : r[guion]);
    return {
        pagina: sinConsulta(g('documentURL', 'document-uri')),
        referer: sinConsulta(g('referrer', 'referrer')),
        bloqueado: sinConsulta(g('blockedURL', 'blocked-uri')),
        directiva: texto(g('effectiveDirective', 'effective-directive') || r['violated-directive']),
        archivo: sinConsulta(g('sourceFile', 'source-file')),
        linea: numero(g('lineNumber', 'line-number')),
        columna: numero(g('columnNumber', 'column-number')),
        disposicion: texto(g('disposition', 'disposition'), 16),
        estado: numero(g('statusCode', 'status-code')),
    };
}

/** Extrae las violaciones del cuerpo, venga en el formato que venga. */
function violacionesDe(cuerpo) {
    if (Array.isArray(cuerpo)) {
        return cuerpo.filter((r) => r && r.type === 'csp-violation' && r.body && typeof r.body === 'object').map((r) => r.body);
    }
    if (cuerpo && typeof cuerpo['csp-report'] === 'object' && cuerpo['csp-report']) return [cuerpo['csp-report']];
    return [];
}

const sinContenido = () => ({ statusCode: 204, headers, body: '' });

module.exports.reportar = async (event) => {
    let crudo = event.body || '';
    if (event.isBase64Encoded) crudo = Buffer.from(crudo, 'base64').toString('utf8');
    if (Buffer.byteLength(crudo, 'utf8') > MAX_BYTES) return error('Reporte demasiado grande', 413);

    let cuerpo;
    try { cuerpo = JSON.parse(crudo); } catch { return error('Reporte inválido', 400); }

    const violaciones = violacionesDe(cuerpo);
    if (violaciones.length > MAX_REPORTES) return error('Demasiados reportes en un envío', 413);

    const stage = process.env.STAGE || process.env.AWS_LAMBDA_FUNCTION_NAME?.split('-')[1] || 'desconocido';
    for (const v of violaciones) {
        const campos = camposUtiles(v);
        // Métrica embebida (EMF) por directiva: para ver de un vistazo si llegan
        // violaciones, sin abrir los logs.
        const linea = {
            _aws: {
                Timestamp: Date.now(),
                CloudWatchMetrics: [{ Namespace: ESPACIO, Dimensions: [['stage'], ['stage', 'directiva']], Metrics: [{ Name: METRICA, Unit: 'Count' }] }],
            },
            stage,
            [METRICA]: 1,
            ...campos,
            directiva: campos.directiva || 'desconocida',
        };
        console.log('CSP_VIOLACION', JSON.stringify(linea));
    }
    return sinContenido();
};

// Para las pruebas.
module.exports._interno = { sinConsulta, camposUtiles, violacionesDe, MAX_BYTES, MAX_REPORTES };
