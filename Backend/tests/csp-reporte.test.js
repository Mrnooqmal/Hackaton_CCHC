// La ruta pública de reportes de CSP: sin tokens en los logs, solo campos útiles, tamaño acotado.
//
// El reporte de una violación trae la URL de la página y el referer. La página
// de restablecer contraseña lleva `?pid=…&token=…`, y el enlace de la licencia
// de alta lleva su token: registrar esas URLs tal cual dejaba credenciales en
// CloudWatch, legibles por cualquiera con acceso a los logs.

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const { reportar, _interno } = require('../handlers/csp/handler');

const TOKEN = 'a3f9c2e1d4b5a6978877665544332211ffeeddccbbaa';
const PAGINA_CON_TOKEN = `https://d30jksx91fodea.cloudfront.net/restablecer-clave?pid=p-123&token=${TOKEN}#paso2`;
const LICENCIA_CON_TOKEN = `https://d30jksx91fodea.cloudfront.net/onboarding?licencia=${TOKEN}`;

let registrado;
let originalLog;
beforeEach(() => {
    registrado = [];
    originalLog = console.log;
    console.log = (...a) => registrado.push(a.join(' '));
});
afterEach(() => { console.log = originalLog; });

const evento = (cuerpo, extra = {}) => ({
    requestContext: { http: { method: 'POST' } },
    body: typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo),
    ...extra,
});

// Formato `report-uri` (application/csp-report), el de Firefox y Safari.
const reporteUri = (sobre = {}) => ({
    'csp-report': {
        'document-uri': PAGINA_CON_TOKEN,
        referrer: LICENCIA_CON_TOKEN,
        'violated-directive': 'script-src-elem',
        'effective-directive': 'script-src-elem',
        'original-policy': "default-src 'self'; script-src 'self'; report-uri https://x/csp/reporte",
        'blocked-uri': `https://evil.example.com/x.js?session=${TOKEN}`,
        'source-file': `https://d30jksx91fodea.cloudfront.net/assets/index.js?v=${TOKEN}`,
        'line-number': 12,
        'column-number': 34,
        'status-code': 200,
        disposition: 'report',
        'script-sample': 'Juan Pérez 12.345.678-5',
        ...sobre,
    },
});

// Formato `report-to` (application/reports+json), el de Chrome.
const reporteTo = () => ([{
    type: 'csp-violation',
    age: 10,
    url: PAGINA_CON_TOKEN,
    user_agent: 'Mozilla/5.0 (Linux; Android 14)',
    body: {
        documentURL: PAGINA_CON_TOKEN,
        referrer: LICENCIA_CON_TOKEN,
        blockedURL: 'inline',
        effectiveDirective: 'script-src-elem',
        originalPolicy: "default-src 'self'",
        sourceFile: PAGINA_CON_TOKEN,
        sample: 'alert(document.cookie) Juan Pérez',
        disposition: 'report',
        statusCode: 200,
        lineNumber: 1,
        columnNumber: 2,
    },
}, { type: 'deprecation', body: { id: 'x' } }]);

const lineasCsp = () => registrado.filter((l) => l.startsWith('CSP_VIOLACION'));
const campos = (i = 0) => JSON.parse(lineasCsp()[i].slice('CSP_VIOLACION '.length));

// ─── Sin tokens ─────────────────────────────────────────────────────────────

test('ninguna URL registrada conserva la consulta ni el fragmento: los tokens no llegan a los logs', async () => {
    await reportar(evento(reporteUri()));
    await reportar(evento(reporteTo()));
    const todo = registrado.join('\n');
    assert.equal(lineasCsp().length, 2);
    assert.ok(!todo.includes(TOKEN), 'un token llegó a los logs');
    assert.ok(!/\?[a-z]+=/.test(todo), 'quedó una consulta en alguna URL');
    assert.ok(!todo.includes('#paso2'), 'quedó el fragmento');
});

test('se conserva lo que sirve para ubicar la violación: origen y ruta', async () => {
    await reportar(evento(reporteUri()));
    const c = campos();
    assert.equal(c.pagina, 'https://d30jksx91fodea.cloudfront.net/restablecer-clave');
    assert.equal(c.referer, 'https://d30jksx91fodea.cloudfront.net/onboarding');
    assert.equal(c.bloqueado, 'https://evil.example.com/x.js');
    assert.equal(c.archivo, 'https://d30jksx91fodea.cloudfront.net/assets/index.js');
    assert.equal(c.directiva, 'script-src-elem');
    assert.equal(c.linea, 12);
});

test('lo que no es URL se reduce a su palabra clave o esquema', () => {
    const { sinConsulta } = _interno;
    assert.equal(sinConsulta('inline'), 'inline');
    assert.equal(sinConsulta('eval'), 'eval');
    assert.equal(sinConsulta(`data:text/html,<script>${TOKEN}</script>`), 'data');
    assert.equal(sinConsulta(`blob:https://d30jksx91fodea.cloudfront.net/${TOKEN}`), 'blob');
    assert.equal(sinConsulta(`no es url?token=${TOKEN}`), 'no es url');
    assert.equal(sinConsulta(''), null);
});

// ─── Solo los campos útiles ─────────────────────────────────────────────────

test('no se registra el reporte entero: ni la política, ni la muestra del script, ni el user-agent', async () => {
    await reportar(evento(reporteUri()));
    await reportar(evento(reporteTo()));
    const todo = registrado.join('\n');
    assert.ok(!todo.includes('Juan Pérez'), 'la muestra del script puede traer datos personales');
    assert.ok(!todo.includes('12.345.678-5'));
    assert.ok(!todo.includes("default-src 'self'"), 'la política completa no aporta y ocupa');
    assert.ok(!todo.includes('Mozilla'), 'sin user-agent');
    const permitidos = new Set(['_aws', 'stage', 'CspViolaciones', 'pagina', 'referer', 'bloqueado', 'directiva', 'archivo', 'linea', 'columna', 'disposicion', 'estado']);
    for (let i = 0; i < lineasCsp().length; i++) {
        for (const k of Object.keys(campos(i))) assert.ok(permitidos.has(k), `campo no permitido: ${k}`);
    }
});

test('de report-to solo se toman las violaciones de CSP, no otros tipos de reporte', async () => {
    await reportar(evento(reporteTo()));
    assert.equal(lineasCsp().length, 1);
    assert.equal(campos().bloqueado, 'inline');
});

test('cada violación deja una métrica por directiva', async () => {
    await reportar(evento(reporteUri()));
    const c = campos();
    assert.equal(c.CspViolaciones, 1);
    assert.deepEqual(c._aws.CloudWatchMetrics[0].Dimensions, [['stage'], ['stage', 'directiva']]);
});

// ─── Ruta pública: acotada ──────────────────────────────────────────────────

test('responde 204 sin cuerpo y sin caché', async () => {
    const res = await reportar(evento(reporteUri()));
    assert.equal(res.statusCode, 204);
    assert.equal(res.body, '');
    assert.equal(res.headers['Cache-Control'], 'no-store');
});

test('un cuerpo de más de 8 KB se rechaza sin procesar ni registrar', async () => {
    const grande = reporteUri({ 'script-sample': 'x'.repeat(_interno.MAX_BYTES) });
    const res = await reportar(evento(grande));
    assert.equal(res.statusCode, 413);
    assert.equal(lineasCsp().length, 0);
});

test('el límite de tamaño también vale para cuerpos en base64', async () => {
    const grande = Buffer.from(JSON.stringify(reporteUri({ 'script-sample': 'x'.repeat(_interno.MAX_BYTES) }))).toString('base64');
    const res = await reportar(evento(grande, { isBase64Encoded: true }));
    assert.equal(res.statusCode, 413);
});

test('más de 20 violaciones en un envío se rechazan enteras', async () => {
    const muchas = Array.from({ length: _interno.MAX_REPORTES + 1 }, () => ({ type: 'csp-violation', body: { effectiveDirective: 'img-src' } }));
    const res = await reportar(evento(muchas));
    assert.equal(res.statusCode, 413);
    assert.equal(lineasCsp().length, 0);
});

test('un cuerpo que no es JSON responde 400 y no registra nada', async () => {
    const res = await reportar(evento('esto no es json'));
    assert.equal(res.statusCode, 400);
    assert.equal(lineasCsp().length, 0);
});

test('un JSON sin reportes de CSP no registra nada', async () => {
    const res = await reportar(evento({ hola: 'mundo' }));
    assert.equal(res.statusCode, 204);
    assert.equal(lineasCsp().length, 0);
});

test('un reporte en base64 (así lo entrega API Gateway a veces) se decodifica y se registra', async () => {
    const b64 = Buffer.from(JSON.stringify(reporteUri())).toString('base64');
    const res = await reportar(evento(b64, { isBase64Encoded: true }));
    assert.equal(res.statusCode, 204);
    assert.equal(lineasCsp().length, 1);
    assert.ok(!registrado.join('\n').includes(TOKEN));
});
