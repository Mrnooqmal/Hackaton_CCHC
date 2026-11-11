// Progreso de los recorridos guiados (D-33). Lo que se fija:
//   - la entrada es una lista blanca: ni la empresa ni la persona pueden venir
//     del cliente, y nada fuera de los cuatro campos se acepta;
//   - el estado nunca retrocede, aunque los eventos lleguen desordenados desde
//     la cola sin conexión, y repetir una escritura no duplica nada;
//   - cerrar no es completar: tres cierres cuentan como omitido;
//   - una versión mayor reinicia el progreso y una menor se ignora;
//   - una empresa nunca lee ni escribe el progreso de otra, ni una persona el
//     de otra;
//   - con el tratamiento bloqueado por una solicitud del titular no se escribe;
//   - dos escrituras simultáneas no se pisan.

const { prepararEntorno, crearDobleTablas } = require('./doble-dynamo-tablas');
const esquemas = prepararEntorno();

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { PutCommand } = require('@aws-sdk/lib-dynamodb');

const { docClient } = require('../lib/clients/dynamodb');
const P = require('../lib/ayuda/progreso');
const repositorio = require('../lib/ayuda/repositorio');
const { atender } = require('../handlers/ayuda/progreso');

// ─── Reglas puras ────────────────────────────────────────────────────────────

const entrada = (extra = {}) => ({ recorridoId: 'intro', version: 1, estado: 'en_progreso', ultimoPaso: 0, cierres: 0, ...extra });

test('validarEntrada acepta lo mínimo y completa ultimoPaso y cierres en cero', () => {
    assert.deepEqual(P.validarEntrada('intro-terreno', { version: 1, estado: 'completado' }),
        { recorridoId: 'intro-terreno', version: 1, estado: 'completado', ultimoPaso: 0, cierres: 0 });
});

test('validarEntrada rechaza identificadores que no son un slug', () => {
    const malos = ['', 'Intro', 'intro terreno', '../x', 'a"]', 'a--b', '-a', 'a-', 'a_b', 'x'.repeat(65), null, 42];
    for (const id of malos) assert.throws(() => P.validarEntrada(id, { version: 1, estado: 'completado' }), { codigo: 'ENTRADA_INVALIDA' }, String(id));
});

test('validarEntrada rechaza campos fuera de la lista blanca, también la empresa y la persona', () => {
    for (const extra of [{ tenantId: 'otra' }, { personaId: 'otra' }, { completado: true }, { config: {} }]) {
        assert.throws(() => P.validarEntrada('intro', { version: 1, estado: 'completado', ...extra }), { codigo: 'ENTRADA_INVALIDA' }, JSON.stringify(extra));
    }
});

test('validarEntrada rechaza valores fuera de rango o de tipo', () => {
    const malos = [
        {}, [], null,
        { version: 0, estado: 'completado' }, { version: 1.5, estado: 'completado' }, { version: '1', estado: 'completado' },
        { version: 10001, estado: 'completado' },
        { version: 1, estado: 'visto' }, { version: 1, estado: 'toString' }, { version: 1 },
        { version: 1, estado: 'en_progreso', ultimoPaso: -1 }, { version: 1, estado: 'en_progreso', ultimoPaso: 20 },
        { version: 1, estado: 'en_progreso', cierres: 100 }, { version: 1, estado: 'en_progreso', cierres: -1 },
    ];
    for (const c of malos) assert.throws(() => P.validarEntrada('intro', c), { codigo: 'ENTRADA_INVALIDA' }, JSON.stringify(c));
});

test('fusionar: sin nada guardado se escribe lo que llega', () => {
    assert.deepEqual(P.fusionar(null, entrada({ estado: 'completado', ultimoPaso: 3 })),
        { progreso: { version: 1, estado: 'completado', ultimoPaso: 3, cierres: 0 }, cambia: true });
});

test('fusionar: un completado no retrocede por un evento viejo que llega tarde', () => {
    const guardado = { version: 1, estado: 'completado', ultimoPaso: 4, cierres: 1 };
    for (const tarde of [entrada({ estado: 'en_progreso', ultimoPaso: 1 }), entrada({ estado: 'omitido', cierres: 0 })]) {
        const r = P.fusionar(guardado, tarde);
        assert.equal(r.progreso.estado, 'completado');
        assert.equal(r.progreso.ultimoPaso, 4);
        assert.equal(r.cambia, false);
    }
});

test('fusionar: un omitido que después se completa queda completado (falla 20)', () => {
    const r = P.fusionar({ version: 1, estado: 'omitido', ultimoPaso: 0, cierres: 0 }, entrada({ estado: 'completado', ultimoPaso: 5 }));
    assert.deepEqual(r.progreso, { version: 1, estado: 'completado', ultimoPaso: 5, cierres: 0 });
    assert.equal(r.cambia, true);
});

test('fusionar: cerrar no completa, y al tercer cierre cuenta como omitido', () => {
    let guardado = null;
    for (const [cierres, esperado] of [[1, 'en_progreso'], [2, 'en_progreso'], [3, 'omitido']]) {
        guardado = P.fusionar(guardado, entrada({ cierres })).progreso;
        assert.equal(guardado.estado, esperado, `con ${cierres} cierres`);
    }
});

test('fusionar: los cierres y el último paso nunca bajan', () => {
    const r = P.fusionar({ version: 1, estado: 'en_progreso', ultimoPaso: 3, cierres: 2 }, entrada({ ultimoPaso: 1, cierres: 1 }));
    assert.deepEqual(r.progreso, { version: 1, estado: 'en_progreso', ultimoPaso: 3, cierres: 2 });
    assert.equal(r.cambia, false);
});

test('fusionar: una versión mayor reinicia, también sobre un completado', () => {
    const r = P.fusionar({ version: 1, estado: 'completado', ultimoPaso: 4, cierres: 2 }, entrada({ version: 2, ultimoPaso: 0 }));
    assert.deepEqual(r.progreso, { version: 2, estado: 'en_progreso', ultimoPaso: 0, cierres: 0 });
    assert.equal(r.cambia, true);
});

test('fusionar: un evento de una versión anterior se ignora', () => {
    const guardado = { version: 3, estado: 'en_progreso', ultimoPaso: 0, cierres: 0 };
    const r = P.fusionar(guardado, entrada({ version: 2, estado: 'completado' }));
    assert.deepEqual(r.progreso, guardado);
    assert.equal(r.cambia, false);
});

test('fusionar: el resultado no depende del orden de llegada', () => {
    const eventos = [
        entrada({ ultimoPaso: 1 }), entrada({ ultimoPaso: 2, cierres: 1 }), entrada({ estado: 'completado', ultimoPaso: 4 }),
        entrada({ cierres: 2 }), entrada({ estado: 'omitido' }),
    ];
    const aplicar = (orden) => orden.reduce((g, e) => P.fusionar(g, e).progreso, null);
    const esperado = aplicar(eventos);
    // Todas las rotaciones y el orden inverso.
    for (let i = 0; i < eventos.length; i += 1) assert.deepEqual(aplicar([...eventos.slice(i), ...eventos.slice(0, i)]), esperado);
    assert.deepEqual(aplicar([...eventos].reverse()), esperado);
    assert.deepEqual(esperado, { version: 1, estado: 'completado', ultimoPaso: 4, cierres: 2 });
});

// ─── Handler y tabla ─────────────────────────────────────────────────────────

let doble;
beforeEach(async () => {
    doble = crearDobleTablas(docClient, esquemas);
    for (const [tenantId, personaId, extra] of [['t1', 'ana', {}], ['t1', 'beto', {}], ['t2', 'ana', {}], ['t1', 'bloq', { solicitudesBloqueo: new Set(['sol-1']) }]]) {
        await docClient.send(new PutCommand({ TableName: 'PERSONAS_TABLE', Item: { PK: `TENANT#${tenantId}`, SK: `PERSONA#${personaId}`, personaId, tenantId, nombre: personaId, ...extra } }));
    }
});
afterEach(() => doble.restaurar());

const evento = ({ tenantId = 't1', personaId = 'ana', provisional = false } = {}, metodo, ruta, cuerpo, pathParameters) => ({
    requestContext: { http: { method: metodo }, authorizer: { lambda: { sessionId: 's', personaId, tenantId, rol: 'trabajador', permisos: '', credencialProvisional: String(provisional) } } },
    rawPath: ruta,
    pathParameters,
    body: cuerpo === undefined ? undefined : typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo),
    headers: {}, queryStringParameters: {},
});
const poner = (ses, id, cuerpo) => atender(evento(ses, 'PUT', `/ayuda/progreso/${id}`, cuerpo, { recorridoId: id }));
const ver = (ses) => atender(evento(ses, 'GET', '/ayuda/progreso'));
const cuerpo = (res) => JSON.parse(res.body);
const filas = () => doble.items('RECORRIDOS_TABLE');

test('sin sesión responde 401, y con la contraseña inicial sin cambiar, 403', async () => {
    const sinSesion = { requestContext: { http: { method: 'GET' } }, rawPath: '/ayuda/progreso', headers: {} };
    assert.equal((await atender(sinSesion)).statusCode, 401);
    assert.equal((await ver({ provisional: true })).statusCode, 403);
    assert.equal((await poner({ provisional: true }, 'intro', { version: 1, estado: 'completado' })).statusCode, 403);
    assert.equal(filas().length, 0);
});

test('PUT y GET: se guarda bajo la empresa y la persona de la sesión, y se lee de vuelta', async () => {
    const r = await poner({}, 'intro', { version: 1, estado: 'en_progreso', ultimoPaso: 2 });
    assert.equal(r.statusCode, 200, r.body);
    assert.equal(cuerpo(r).data.escrito, true);
    assert.deepEqual(filas().map((f) => [f.tenantId, f.sk, f.personaId]), [['t1', 'ana#intro', 'ana']]);

    const g = cuerpo(await ver({})).data;
    assert.equal(g.registrar, true);
    assert.equal(g.progreso.length, 1);
    assert.deepEqual({ ...g.progreso[0], actualizadoEn: undefined },
        { recorridoId: 'intro', version: 1, estado: 'en_progreso', ultimoPaso: 2, cierres: 0, actualizadoEn: undefined });
    assert.equal(g.progreso[0].rev, undefined, 'la revisión interna no sale por la API');
});

test('el cuerpo no puede nombrar a otra empresa ni a otra persona', async () => {
    for (const extra of [{ tenantId: 't2' }, { personaId: 'beto' }]) {
        const r = await poner({}, 'intro', { version: 1, estado: 'completado', ...extra });
        assert.equal(r.statusCode, 400, JSON.stringify(extra));
        assert.equal(cuerpo(r).codigo, 'ENTRADA_INVALIDA');
    }
    assert.equal(filas().length, 0);
});

test('una empresa nunca lee ni escribe el progreso de otra, ni una persona el de otra', async () => {
    // La misma persona en dos empresas (login multiempresa) y una compañera.
    await poner({ tenantId: 't1', personaId: 'ana' }, 'intro', { version: 1, estado: 'completado' });
    await poner({ tenantId: 't1', personaId: 'beto' }, 'intro', { version: 1, estado: 'omitido' });

    assert.deepEqual(cuerpo(await ver({ tenantId: 't2', personaId: 'ana' })).data.progreso, [], 'en t2 no ve lo de t1');
    assert.deepEqual(cuerpo(await ver({ tenantId: 't1', personaId: 'beto' })).data.progreso.map((p) => p.estado), ['omitido'], 'beto ve solo lo suyo');

    // Escribir en t2 no toca la fila de t1.
    await poner({ tenantId: 't2', personaId: 'ana' }, 'intro', { version: 1, estado: 'en_progreso' });
    const deAna = filas().filter((f) => f.personaId === 'ana').map((f) => [f.tenantId, f.estado]).sort();
    assert.deepEqual(deAna, [['t1', 'completado'], ['t2', 'en_progreso']]);
});

test('una persona que no está en la empresa de la sesión recibe 404 y no escribe nada', async () => {
    const r = await poner({ tenantId: 't2', personaId: 'beto' }, 'intro', { version: 1, estado: 'completado' });
    assert.equal(r.statusCode, 404);
    assert.equal((await ver({ tenantId: 't2', personaId: 'beto' })).statusCode, 404);
    assert.equal(filas().length, 0);
});

test('repetir la misma escritura no duplica ni cambia nada', async () => {
    await poner({}, 'intro', { version: 1, estado: 'completado', ultimoPaso: 3 });
    const antes = structuredClone(filas());
    const r = await poner({}, 'intro', { version: 1, estado: 'completado', ultimoPaso: 3 });
    assert.equal(r.statusCode, 200);
    assert.equal(cuerpo(r).data.escrito, false);
    assert.deepEqual(filas(), antes);
});

test('un evento viejo de la cola sin conexión no hace retroceder un completado', async () => {
    await poner({}, 'intro', { version: 1, estado: 'completado', ultimoPaso: 4 });
    const r = await poner({}, 'intro', { version: 1, estado: 'en_progreso', ultimoPaso: 1, cierres: 1 });
    assert.equal(r.statusCode, 200);
    assert.equal(cuerpo(r).data.progreso.estado, 'completado');
    assert.equal(filas()[0].estado, 'completado');
});

test('con el tratamiento bloqueado no se registra progreso, y el GET lo avisa', async () => {
    const r = await poner({ personaId: 'bloq' }, 'intro', { version: 1, estado: 'completado' });
    assert.equal(r.statusCode, 409);
    assert.equal(cuerpo(r).codigo, 'TRATAMIENTO_BLOQUEADO');
    assert.equal(filas().length, 0);
    assert.equal(cuerpo(await ver({ personaId: 'bloq' })).data.registrar, false);
});

test('entrada inválida y JSON roto responden 400; una ruta desconocida, 404', async () => {
    assert.equal((await poner({}, 'Intro', { version: 1, estado: 'completado' })).statusCode, 400);
    assert.equal((await poner({}, 'intro', '{no es json')).statusCode, 400);
    assert.equal((await atender(evento({}, 'DELETE', '/ayuda/progreso/intro'))).statusCode, 404);
    assert.equal((await atender(evento({}, 'GET', '/ayuda/otra'))).statusCode, 404);
    assert.equal(filas().length, 0);
});

test('hay un tope de recorridos por persona', async () => {
    for (let i = 0; i < P.LIMITES.RECORRIDOS_POR_PERSONA; i += 1) {
        await docClient.send(new PutCommand({ TableName: 'RECORRIDOS_TABLE', Item: { tenantId: 't1', sk: `ana#r${i}`, personaId: 'ana', recorridoId: `r${i}`, version: 1, estado: 'completado', ultimoPaso: 0, cierres: 0, rev: 1 } }));
    }
    const nuevo = await poner({}, 'otro', { version: 1, estado: 'completado' });
    assert.equal(nuevo.statusCode, 409);
    assert.equal(cuerpo(nuevo).codigo, 'LIMITE_RECORRIDOS');
    // Actualizar uno existente sigue funcionando.
    assert.equal((await poner({}, 'r0', { version: 2, estado: 'en_progreso' })).statusCode, 200);
    // Otra persona no se ve afectada.
    assert.equal((await poner({ personaId: 'beto' }, 'otro', { version: 1, estado: 'completado' })).statusCode, 200);
});

test('dos escrituras simultáneas no se pisan: la segunda se vuelve a fusionar', async () => {
    await poner({}, 'intro', { version: 1, estado: 'en_progreso', ultimoPaso: 1 });
    // Entre la lectura y la escritura de esta petición, otra completa el recorrido.
    const send = docClient.send;
    let metido = false;
    docClient.send = async function (cmd) {
        if (!metido && cmd.constructor.name === 'PutCommand' && cmd.input.TableName === 'RECORRIDOS_TABLE') {
            metido = true;
            await repositorio.registrar('t1', 'ana', { recorridoId: 'intro', version: 1, estado: 'completado', ultimoPaso: 4, cierres: 0 });
        }
        return send.call(this, cmd);
    };
    try {
        const r = await poner({}, 'intro', { version: 1, estado: 'en_progreso', ultimoPaso: 2, cierres: 1 });
        assert.equal(r.statusCode, 200, r.body);
    } finally {
        docClient.send = send;
    }
    const f = filas()[0];
    assert.equal(f.estado, 'completado', 'el completado de la otra escritura no se perdió');
    assert.equal(f.ultimoPaso, 4);
    assert.equal(f.cierres, 1, 'y el cierre de esta tampoco');
});

test('si la carrera no se resuelve en los intentos, responde 409 sin escribir a ciegas', async () => {
    await poner({}, 'intro', { version: 1, estado: 'en_progreso' });
    const send = docClient.send;
    docClient.send = async function (cmd) {
        if (cmd.constructor.name === 'PutCommand' && cmd.input.TableName === 'RECORRIDOS_TABLE') {
            throw Object.assign(new Error('The conditional request failed'), { name: 'ConditionalCheckFailedException' });
        }
        return send.call(this, cmd);
    };
    try {
        const r = await poner({}, 'intro', { version: 1, estado: 'completado' });
        assert.equal(r.statusCode, 409);
        assert.equal(cuerpo(r).codigo, 'CAMBIO_CONCURRENTE');
    } finally {
        docClient.send = send;
    }
    assert.equal(filas()[0].estado, 'en_progreso');
});

test('un error inesperado responde 500 sin el detalle', async () => {
    const send = docClient.send;
    const errores = [];
    const consola = console.error;
    console.error = (...a) => errores.push(a);
    docClient.send = async () => { throw new Error('ProvisionedThroughputExceeded en tabla-secreta'); };
    try {
        const r = await poner({}, 'intro', { version: 1, estado: 'completado' });
        assert.equal(r.statusCode, 500);
        assert.ok(!r.body.includes('tabla-secreta'));
    } finally {
        docClient.send = send;
        console.error = consola;
    }
    assert.equal(errores.length, 1, 'el error queda registrado');
});
