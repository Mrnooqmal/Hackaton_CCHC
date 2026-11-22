// Servidor local contra dev (scripts/servidor-local.js): la lógica pura, sin
// arrancar nada ni llamar a AWS. Los handlers y el autorizador se simulan.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const http = require('http');
const path = require('path');
const s = require('../scripts/servidor-local');

const YML = path.join(__dirname, '..', 'serverless.yml');

test('solo trabaja contra dev', () => {
    assert.equal(s.validarAmbiente(undefined), 'dev');
    assert.equal(s.validarAmbiente('dev'), 'dev');
    assert.throws(() => s.validarAmbiente('prod'), /solo trabaja contra "dev"/);
    assert.throws(() => s.validarAmbiente('staging'), /solo trabaja contra "dev"/);
    assert.throws(() => s.validarAmbiente(s.leerArgumentos(['--stage=prod']).stage), /solo trabaja contra "dev"/);
    assert.deepEqual(s.leerArgumentos(['--puerto', '3005', '--recargar']), { puerto: 3005, stage: undefined, recargar: true });
    assert.throws(() => s.leerArgumentos(['--puerto', 'x']), /--puerto/);
    assert.throws(() => s.leerArgumentos(['--otra']), /desconocido/);
});

test('el lector de YAML entiende mapas, listas, comillas, comentarios y bloques', () => {
    const y = s.parsearYaml([
        'a: 1 # comentario',
        'b:',
        '  - x',
        '  - "y # no es comentario"',
        '  - k: v',
        '    n:',
        '      m: 2',
        'c:',
        '- z',
        'd: |',
        '  a: b',
        '  - c',
        'e: https://host:80/x',
    ].join('\r\n'));
    assert.deepEqual(y, {
        a: '1',
        b: ['x', 'y # no es comentario', { k: 'v', n: { m: '2' } }],
        c: ['z'],
        d: 'a: b\n- c',
        e: 'https://host:80/x',
    });
});

test('lee las rutas, el autorizador y el CORS del serverless.yml real', () => {
    const c = s.leerConfiguracion(YML);
    assert.ok(c.rutas.length > 50, 'cargó las rutas');
    const inc = c.rutas.find((r) => r.clave === 'ANY /incidents/{proxy+}');
    assert.equal(inc.funcion, 'incidentsModule');
    assert.equal(inc.autorizador, 'sesionUsuario');
    assert.equal(c.autorizadores.sesionUsuario, 'sesionAuthorizer');
    assert.ok(c.funciones.sesionAuthorizer.handler.endsWith('authorizer.autorizar'));
    assert.equal(c.rutas.find((r) => r.clave === 'POST /auth/login').autorizador, null);
    assert.ok(c.cors.origenes.includes('http://localhost:5173'));
    assert.ok(c.cors.origenes.every((o) => !o.includes('${')));
    assert.ok(c.cors.metodos.includes('PATCH') && c.cors.cabeceras.includes('Authorization'));
    assert.equal(c.cors.maxAge, 600);
    // Todo handler declarado existe como archivo.
    for (const f of Object.values(c.funciones)) {
        const base = f.handler.slice(0, f.handler.lastIndexOf('.'));
        assert.ok(fs.existsSync(path.join(__dirname, '..', `${base}.js`)), `${f.handler} no existe`);
    }
});

test('falla con mensaje claro si no puede leer las rutas', () => {
    const tmp = path.join(os.tmpdir(), `sin-rutas-${process.pid}.yml`);
    fs.writeFileSync(tmp, 'service: X\nfunctions:\n  f:\n    handler: a.b\n');
    try {
        assert.throws(() => s.leerConfiguracion(tmp), /ninguna ruta httpApi/);
        assert.throws(() => s.leerConfiguracion(path.join(os.tmpdir(), 'no-existe.yml')), /No se pudo leer/);
    } finally { fs.unlinkSync(tmp); }
});

const rutas = [
    s.nuevaRuta('any', '/x', 'f1', null),
    s.nuevaRuta('any', '/x/{proxy+}', 'f2', null),
    s.nuevaRuta('get', '/x/{id}', 'f3', null),
    s.nuevaRuta('get', '/x/{id}/detalle', 'f4', null),
    s.nuevaRuta('get', '/x/fijo', 'f5', null),
    s.nuevaRuta('post', '/x/fijo', 'f6', null),
    s.nuevaRuta('any', '/x/fijo', 'f7', null),
];

test('coincidencia de rutas: parámetros, proxy, any y la más específica', () => {
    const f = (m, p) => { const r = s.buscarRuta(rutas, m, p); return r && r.ruta.funcion; };
    assert.equal(f('GET', '/x'), 'f1');
    assert.equal(f('DELETE', '/x'), 'f1');
    assert.equal(f('GET', '/x/fijo'), 'f5', 'literal sobre parámetro, método sobre any');
    assert.equal(f('POST', '/x/fijo'), 'f6');
    assert.equal(f('PUT', '/x/fijo'), 'f7', 'any literal sobre el parámetro y el proxy');
    assert.equal(f('GET', '/x/42'), 'f3');
    assert.equal(f('POST', '/x/42'), 'f2', 'sin ruta POST /x/{id}, cae al proxy');
    assert.equal(f('GET', '/x/42/detalle'), 'f4');
    assert.equal(f('GET', '/x/42/otro/mas'), 'f2');
    assert.equal(f('GET', '/y'), null);
    assert.equal(f('GET', '/'), null);
    const m = s.buscarRuta(rutas, 'GET', '/x/a%20b/c/d');
    assert.equal(m.ruta.funcion, 'f2');
    assert.deepEqual(m.params, { proxy: 'a b/c/d' });
    assert.deepEqual(s.buscarRuta(rutas, 'GET', '/x/a%20b').params, { id: 'a b' });
    assert.equal(s.buscarRuta(rutas, 'GET', '/x/%E0%A4%A'), null, 'URL mal codificada: sin ruta');
});

test('arma el evento de HTTP API con payload 2.0', () => {
    const ruta = s.nuevaRuta('any', '/x/{proxy+}', 'f2', 'sesionUsuario');
    const e = s.armarEvento({
        metodo: 'post',
        url: '/x/a/b?p=1&p=2&q=%C3%A1',
        cabeceras: { Host: 'localhost:3001', 'Content-Type': 'application/json', cookie: 'a=1; b=2', 'x-multi': ['u', 'v'] },
        cuerpo: Buffer.from('{"k":1}'),
        ip: '127.0.0.1',
        ruta,
        parametros: { proxy: 'a/b' },
    });
    assert.equal(e.version, '2.0');
    assert.equal(e.rawPath, '/x/a/b');
    assert.equal(e.rawQueryString, 'p=1&p=2&q=%C3%A1');
    assert.deepEqual(e.queryStringParameters, { p: '1,2', q: 'á' });
    assert.deepEqual(e.pathParameters, { proxy: 'a/b' });
    assert.equal(e.headers.host, 'localhost:3001');
    assert.equal(e.headers['content-type'], 'application/json');
    assert.equal(e.headers['x-multi'], 'u,v');
    assert.equal(e.headers.cookie, undefined);
    assert.deepEqual(e.cookies, ['a=1', 'b=2']);
    assert.equal(e.body, '{"k":1}');
    assert.equal(e.isBase64Encoded, false);
    assert.equal(e.routeKey, 'ANY /x/{proxy+}');
    assert.equal(e.requestContext.http.method, 'POST');
    assert.equal(e.requestContext.http.path, '/x/a/b');
    assert.equal(e.requestContext.http.sourceIp, '127.0.0.1');
    assert.equal(e.requestContext.routeKey, 'ANY /x/{proxy+}');
});

test('evento sin cuerpo ni consulta, y cuerpo binario en base64', () => {
    const e = s.armarEvento({ metodo: 'GET', url: '/x', cabeceras: {}, cuerpo: Buffer.alloc(0), ruta: rutas[0], parametros: {} });
    assert.equal(e.body, undefined);
    assert.equal(e.queryStringParameters, undefined);
    assert.equal(e.pathParameters, undefined);
    assert.equal(e.rawQueryString, '');
    const b = s.armarEvento({
        metodo: 'PUT', url: '/x', cabeceras: { 'content-type': 'application/pdf' },
        cuerpo: Buffer.from([0, 255, 1]), ruta: rutas[0], parametros: {},
    });
    assert.equal(b.isBase64Encoded, true);
    assert.deepEqual([...Buffer.from(b.body, 'base64')], [0, 255, 1]);
});

test('traduce la respuesta del handler', () => {
    const a = s.traducirRespuesta({ statusCode: 201, headers: { 'Content-Type': 'text/plain' }, body: 'hola', cookies: ['a=1'] });
    assert.equal(a.estado, 201);
    assert.equal(a.cabeceras['content-type'], 'text/plain');
    assert.equal(a.cuerpo.toString(), 'hola');
    assert.deepEqual(a.cookies, ['a=1']);
    const b = s.traducirRespuesta({ statusCode: 200, isBase64Encoded: true, body: Buffer.from('xyz').toString('base64') });
    assert.equal(b.cuerpo.toString(), 'xyz');
    assert.equal(s.traducirRespuesta({ statusCode: 204 }).cuerpo.length, 0);
    const c = s.traducirRespuesta('texto');
    assert.equal(c.estado, 200);
    assert.equal(c.cuerpo.toString(), 'texto');
    const d = s.traducirRespuesta({ ok: true });
    assert.equal(d.estado, 200);
    assert.equal(d.cuerpo.toString(), '{"ok":true}');
    assert.equal(s.traducirRespuesta(undefined).estado, 502);
    assert.equal(s.traducirRespuesta({ statusCode: 400, body: { e: 1 } }).cuerpo.toString(), '{"e":1}');
});

test('CORS: solo para orígenes permitidos, con los métodos y cabeceras de la configuración', () => {
    const cors = { origenes: ['http://localhost:5173'], metodos: ['GET', 'POST'], cabeceras: ['Authorization'], maxAge: 600 };
    const ok = s.cabecerasCors(cors, 'http://localhost:5173', true);
    assert.equal(ok['access-control-allow-origin'], 'http://localhost:5173');
    assert.equal(ok['access-control-allow-methods'], 'GET,POST');
    assert.equal(ok['access-control-allow-headers'], 'Authorization');
    assert.equal(ok['access-control-max-age'], '600');
    assert.deepEqual(Object.keys(s.cabecerasCors(cors, 'http://localhost:5173', false)).sort(), ['access-control-allow-origin', 'vary']);
    assert.deepEqual(s.cabecerasCors(cors, 'https://otro.example', true), {});
    assert.deepEqual(s.cabecerasCors(cors, undefined, true), {});
});

test('de extremo a extremo con handlers simulados: 401, autorizador, contexto, CORS y logs sin datos', async () => {
    const config = {
        rutas: [
            s.nuevaRuta('any', '/privada/{id}', 'priv', 'sesionUsuario'),
            s.nuevaRuta('post', '/publica', 'pub', null),
        ],
        autorizadores: { sesionUsuario: 'aut' },
        cors: { origenes: ['http://localhost:5173'], metodos: ['GET'], cabeceras: ['Authorization'], maxAge: 5 },
    };
    const llamadas = [];
    const ejecutar = async (nombre, evento) => {
        llamadas.push(nombre);
        if (nombre === 'aut') {
            return evento.headers.authorization === 'Bearer bueno'
                ? { isAuthorized: true, context: { tenantId: 't1' } } : { isAuthorized: false };
        }
        if (nombre === 'priv') {
            return { statusCode: 200, body: JSON.stringify({ tenant: evento.requestContext.authorizer.lambda.tenantId, id: evento.pathParameters.id }) };
        }
        return 'eco';
    };
    const lineas = [];
    const srv = s.crearServidor({ config, ejecutar, registrar: (l) => lineas.push(l) });
    await new Promise((r) => srv.listen(0, '127.0.0.1', r));
    const { port } = srv.address();
    const pedir = (metodo, ruta, cabeceras = {}, cuerpo) => new Promise((resolver, rechazar) => {
        const rq = http.request({ host: '127.0.0.1', port, method: metodo, path: ruta, headers: cabeceras }, (rs) => {
            const partes = [];
            rs.on('data', (c) => partes.push(c));
            rs.on('end', () => resolver({ estado: rs.statusCode, cab: rs.headers, cuerpo: Buffer.concat(partes).toString() }));
        });
        rq.on('error', rechazar);
        rq.end(cuerpo);
    });
    try {
        let r = await pedir('GET', '/privada/9');
        assert.equal(r.estado, 401);
        assert.deepEqual(llamadas, [], 'sin Authorization no se invoca al autorizador');
        r = await pedir('GET', '/privada/9', { authorization: 'Bearer malo' });
        assert.equal(r.estado, 401);
        assert.deepEqual(llamadas, ['aut']);
        r = await pedir('GET', '/privada/9?rut=11111111-1', { authorization: 'Bearer bueno', origin: 'http://localhost:5173' });
        assert.equal(r.estado, 200);
        assert.deepEqual(JSON.parse(r.cuerpo), { tenant: 't1', id: '9' });
        assert.equal(r.cab['access-control-allow-origin'], 'http://localhost:5173');
        r = await pedir('POST', '/publica', {}, 'secreto');
        assert.equal(r.cuerpo, 'eco');
        assert.equal(r.cab['access-control-allow-origin'], undefined);
        r = await pedir('OPTIONS', '/privada/9', { origin: 'http://localhost:5173', 'access-control-request-method': 'GET' });
        assert.equal(r.estado, 204);
        assert.equal(r.cab['access-control-allow-methods'], 'GET');
        r = await pedir('GET', '/no-existe/12345678-9');
        assert.equal(r.estado, 404);
        r = await pedir('GET', '/publica', { host: 'evil.example' });
        assert.equal(r.estado, 403);
        const log = lineas.join('\n');
        assert.match(log, /GET ANY \/privada\/\{id\} -> 401 \d+ms/);
        assert.ok(!/11111111|secreto|Bearer|no-existe/.test(log), 'los logs no llevan datos de la petición');
    } finally { await new Promise((res) => srv.close(res)); }
});

test('CORS: con un origen no permitido (o sin origen) no sale ninguna cabecera access-control-* del handler; con uno permitido, solo las de la configuración', async () => {
    const config = {
        rutas: [s.nuevaRuta('any', '/x', 'h', null)],
        autorizadores: {},
        cors: { origenes: ['http://localhost:5173'], metodos: ['GET'], cabeceras: ['Authorization'], maxAge: 5 },
    };
    // Un handler como los del repositorio: pone su propio `*`.
    const ejecutar = async () => ({
        statusCode: 200,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Credentials': 'true', 'Access-Control-Allow-Methods': 'GET,POST' },
        body: '{}',
    });
    const srv = s.crearServidor({ config, ejecutar, registrar: () => {} });
    await new Promise((r) => srv.listen(0, '127.0.0.1', r));
    const { port } = srv.address();
    const pedir = (cabeceras) => new Promise((resolver, rechazar) => {
        const rq = http.request({ host: '127.0.0.1', port, method: 'GET', path: '/x', headers: cabeceras }, (rs) => {
            rs.resume();
            rs.on('end', () => resolver(rs));
        });
        rq.on('error', rechazar);
        rq.end();
    });
    const acceso = (rs) => Object.keys(rs.headers).filter((k) => k.startsWith('access-control-'));
    try {
        assert.deepEqual(acceso(await pedir({ origin: 'https://otro.example' })), []);
        assert.deepEqual(acceso(await pedir({})), []);
        const permitido = await pedir({ origin: 'http://localhost:5173' });
        assert.deepEqual(acceso(permitido), ['access-control-allow-origin']);
        assert.equal(permitido.headers['access-control-allow-origin'], 'http://localhost:5173');
    } finally { await new Promise((res) => srv.close(res)); }
    assert.deepEqual(s.sinCabecerasCors({ 'content-type': 'x', 'access-control-allow-origin': '*', 'Access-Control-Max-Age': '1' }), { 'content-type': 'x' });
});

test('un cuerpo de más de 10 MB responde 413 (con CORS) en vez de cortar la conexión', async () => {
    const config = {
        rutas: [s.nuevaRuta('post', '/subida', 'h', null)],
        autorizadores: {},
        cors: { origenes: ['http://localhost:5173'], metodos: ['POST'], cabeceras: ['Authorization'], maxAge: 5 },
    };
    let invocada = false;
    const ejecutar = async () => { invocada = true; return { statusCode: 200, body: '{}' }; };
    const srv = s.crearServidor({ config, ejecutar, registrar: () => {} });
    await new Promise((r) => srv.listen(0, '127.0.0.1', r));
    const { port } = srv.address();
    const enviar = (bytes) => new Promise((resolver, rechazar) => {
        const rq = http.request({ host: '127.0.0.1', port, method: 'POST', path: '/subida', headers: { origin: 'http://localhost:5173', 'content-length': String(bytes) } }, (rs) => {
            const partes = [];
            rs.on('data', (c) => partes.push(c));
            rs.on('end', () => resolver({ estado: rs.statusCode, cab: rs.headers, cuerpo: Buffer.concat(partes).toString() }));
        });
        rq.on('error', rechazar);
        rq.end(Buffer.alloc(bytes, 1));
    });
    try {
        const grande = await enviar(11 * 1024 * 1024);
        assert.equal(grande.estado, 413);
        assert.equal(grande.cab['access-control-allow-origin'], 'http://localhost:5173');
        assert.match(grande.cuerpo, /Too Large/);
        assert.equal(invocada, false, 'el handler no se invocó');
        // Uno que cabe pasa.
        const chico = await enviar(1024);
        assert.equal(chico.estado, 200);
        assert.equal(invocada, true);
    } finally { await new Promise((res) => srv.close(res)); }
});

test('lee el entorno de las Lambdas de dev: por función, sin AWS_*, con IS_OFFLINE falso', () => {
    const salida = JSON.stringify({ Functions: [
        { FunctionName: 'BuildAndServe-dev-a', Timeout: 29, Environment: { Variables: { TABLA: 'T1', IS_OFFLINE: 'true', AWS_REGION: 'x' } } },
        { FunctionName: 'BuildAndServe-dev-b', Timeout: 6, Environment: { Variables: { TABLA: 'T2' } } },
        { FunctionName: 'BuildAndServe-prod-a', Environment: { Variables: { TABLA: 'PROD' } } },
        { FunctionName: 'BuildAndServe-dev-c' },
    ] });
    const f = s.entornosDeFunciones(salida, 'dev');
    assert.deepEqual(Object.keys(f).sort(), ['a', 'b', 'c']);
    assert.deepEqual(f.a.entorno, { TABLA: 'T1', IS_OFFLINE: 'false' });
    assert.equal(f.b.entorno.TABLA, 'T2');
    assert.equal(f.a.timeout, 29);
    assert.deepEqual(f.c.entorno, { IS_OFFLINE: 'false' });
});
