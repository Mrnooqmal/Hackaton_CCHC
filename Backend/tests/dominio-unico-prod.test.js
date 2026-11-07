// Producción solo en https://buildandserve.cl (D-34).
//
// La URL de CloudFront de producción (d30jksx91fodea.cloudfront.net) se aceptaba
// durante la transición al dominio propio. Se cortó antes de la marcha blanca:
// el CORS de prod ya no la acepta, y la distribución la redirige con 301 a la
// raíz del dominio con la misma ruta y consulta. Las dos cosas van juntas: sin
// la redirección, una página servida ahí cargaría y no podría hablar con la API.
//
// La función de CloudFront se ejecuta acá de verdad: se extrae su código de la
// plantilla y se le pasan eventos con la forma que entrega CloudFront.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..', '..');
const leer = (...p) => fs.readFileSync(path.join(RAIZ, ...p), 'utf8');
const CF_PROD = 'd30jksx91fodea.cloudfront.net';

// ─── CORS ────────────────────────────────────────────────────────────────────

test('el CORS de prod (API y buckets) acepta solo el dominio propio', () => {
    const yml = leer('Backend', 'serverless.yml');
    const bloque = /\n {2}corsOrigins:\n {4}prod:\n((?: {6}- .+\n)+)/.exec(yml);
    assert.ok(bloque, 'no se encontró corsOrigins.prod');
    const origenes = [...bloque[1].matchAll(/- (\S+)/g)].map((m) => m[1]);
    assert.deepEqual(origenes, ['https://buildandserve.cl']);
});

// ─── Redirección ─────────────────────────────────────────────────────────────

function funcionDeRedireccion() {
    const plantilla = leer('infra', 'frontend.yml');
    const inicio = plantilla.indexOf('  RedireccionWww:');
    const codigo = /FunctionCode: \|\n((?: {8}.*\n|\n)+)/.exec(plantilla.slice(inicio));
    assert.ok(inicio > 0 && codigo, 'no se encontró el código de la función');
    const fuente = codigo[1].split('\n').map((l) => l.slice(8)).join('\n');
    // eslint-disable-next-line no-new-func
    return new Function(`${fuente}\nreturn handler;`)();
}

const evento = (host, uri = '/', querystring = {}) => ({
    request: { method: 'GET', uri, querystring, headers: host ? { host: { value: host } } : {} },
});

test('la URL de CloudFront de prod redirige con 301 a la raíz, con la ruta y la consulta', () => {
    const handler = funcionDeRedireccion();
    const r = handler(evento(CF_PROD, '/restablecer-clave', {
        pid: { value: 'p-1' }, token: { value: 'a b' }, vacio: { value: '' },
        varios: { value: '1', multiValue: [{ value: '1' }, { value: '2' }] },
    }));
    assert.equal(r.statusCode, 301);
    assert.equal(r.headers.location.value,
        'https://buildandserve.cl/restablecer-clave?pid=p-1&token=a%20b&vacio&varios=1&varios=2');
});

test('también con el host en mayúsculas, y www sigue redirigiendo', () => {
    const handler = funcionDeRedireccion();
    assert.equal(handler(evento(CF_PROD.toUpperCase(), '/x')).headers.location.value, 'https://buildandserve.cl/x');
    assert.equal(handler(evento('www.buildandserve.cl', '/y')).headers.location.value, 'https://buildandserve.cl/y');
});

test('el dominio propio y cualquier otro host pasan sin tocar', () => {
    const handler = funcionDeRedireccion();
    for (const host of ['buildandserve.cl', 'otro.cloudfront.net', null]) {
        const ev = evento(host, '/obras');
        assert.equal(handler(ev), ev.request, `${host} no debe redirigirse`);
    }
});

test('la función sigue asociada al viewer-request de la distribución de prod', () => {
    const plantilla = leer('infra', 'frontend.yml');
    assert.match(plantilla, /- EventType: viewer-request\n\s+FunctionARN: !GetAtt RedireccionWww\.FunctionMetadata\.FunctionARN/);
    // Una función por evento: no puede haber una segunda en el mismo evento.
    assert.equal((plantilla.match(/EventType: viewer-request/g) || []).length, 1);
});

// ─── Lo que ya no puede apuntar a la URL de CloudFront ───────────────────────

test('los scripts verifican prod en el dominio propio, y comprueban la redirección', () => {
    const publicar = leer('infra', 'desplegar-frontend.sh');
    assert.ok(publicar.includes('DOMINIO=buildandserve.cl'), 'publicar el frontend verifica prod en el dominio propio');
    assert.ok(!/DOMINIO="\$\(salida "\$STACK_FRONTEND" DominioDistribucion\)"/.test(publicar),
        'verificar en la URL de CloudFront recibiría 301 en cada archivo');
    const infra = leer('infra', 'desplegar-infra-frontend.sh');
    assert.ok(infra.includes('DOMINIO="$(dominio_de "${par%%:*}")"') && infra.includes('DOMINIO="$(dominio_de "$par")"'),
        'las dos comprobaciones de la CSP miran el dominio propio en prod');
    assert.ok(infra.includes('grep -qixF "location: $ESPERADO"'), 'después de desplegar se comprueba el 301');
});

test('ningún código fuera de la plantilla y las pruebas usa la URL de CloudFront de prod', () => {
    const archivos = [
        ['Backend', 'scripts', 'emitir-licencia.js'],
        ['Backend', 'scripts', 'e2e', 'cliente.js'],
        ['Backend', 'serverless.yml'],
        ['infra', 'desplegar-frontend.sh'],
        ['infra', 'desplegar-infra-frontend.sh'],
    ];
    for (const a of archivos) {
        const texto = leer(...a).split('\n').filter((l) => !/^\s*#|^\s*\/\//.test(l)).join('\n');
        assert.ok(!texto.includes(CF_PROD), `${a.join('/')} todavía usa ${CF_PROD}`);
    }
});
