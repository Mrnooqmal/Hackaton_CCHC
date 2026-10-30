// Registro de auditoría de las operaciones sobre datos personales (D-31) y la
// detección de eventos sospechosos. Lo que se fija:
//   - cada registro trae identificador, fecha, actor, operación, recurso,
//     titulares, origen y resultado, de un catálogo cerrado;
//   - nunca contraseñas, tokens, RUT, correos ni valores de campos;
//   - el sello delata una alteración hecha sin la llave;
//   - ningún rol puede modificar ni borrar, y el único vencimiento es el TTL;
//   - consultar la auditoría exige permiso y queda a su vez registrado;
//   - las reglas de detección alertan al cruzar el umbral, una vez por ventana.

process.env.CAMPO_HMAC_KEY = 'clave-de-prueba-hmac';
process.env.CAMPO_CIFRADO_LOCAL_KEY = require('crypto').randomBytes(32).toString('base64');
process.env.CREDENCIAL_PEPPER = 'pimienta-de-prueba';
process.env.CREDENCIAL_SCRYPT_LN = '10';

const { prepararEntorno, crearDobleTablas } = require('./doble-dynamo-tablas');
const esquemas = prepararEntorno();

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { docClient } = require('../lib/clients/dynamodb');
const { PersonaService } = require('../lib/services/PersonaService');
const { TenantService } = require('../lib/services/TenantService');
const A = require('../lib/gobernanza/auditoria');
const deteccion = require('../lib/gobernanza/deteccion');
const derechos = require('../handlers/gobernanza/derechos');

let doble;
let T;
let ana;
let juan;

beforeEach(async () => {
    require('../lib/llaveTenant')._olvidarCache();
    doble = crearDobleTablas(docClient, esquemas);
    T = (await new TenantService().setup({ nombre: 'Constructora Prueba', rutEmpresa: '76.543.210-3' })).tenantId;
    const svc = new PersonaService();
    ana = (await svc.crear(T, { rut: '9.876.543-3', nombre: 'Ana', rol: 'admin', email: 'ana@ejemplo.cl', password: 'clave-larga-1' })).persona;
    juan = (await svc.crear(T, { rut: '12.345.678-5', nombre: 'Juan', rol: 'trabajador', password: 'clave-de-juan-1' })).persona;
});
afterEach(() => doble.restaurar());

const AHORA = new Date('2026-10-29T15:00:00Z');
const registros = () => doble.items('AUDITORIA_ACCESOS_TABLE').filter((e) => e.operacion);
const evento = (p, metodo, ruta, { permisos = '', query = {} } = {}) => ({
    requestContext: { http: { method: metodo, sourceIp: '200.1.1.1' }, authorizer: { lambda: { sessionId: 's', personaId: p.personaId, tenantId: T, rol: p.rol, permisos } } },
    rawPath: ruta, queryStringParameters: query, headers: {},
});
const base = () => ({ tenantId: T, operacion: 'datos.modificacion', actor: { id: ana.personaId, rol: 'admin' }, recurso: { tipo: 'persona', id: juan.personaId }, titulares: [juan.personaId], origen: { ip: '200.1.1.1', canal: 'web' }, detalle: { campos: ['telefono'] } });

// ─── Qué lleva y qué no ─────────────────────────────────────────────────────

test('cada registro trae los atributos que permiten reconstruir la operación', async () => {
    const r = await A.registrar(base(), { ahora: AHORA });
    for (const k of ['eventoId', 'en', 'categoria', 'operacion', 'resultado', 'actorId', 'actorTipo', 'recurso', 'titulares', 'origen', 'detalle', 'ttl', 'sello']) {
        assert.ok(k in r, `falta ${k}`);
    }
    assert.equal(r.categoria, 'datos');
    assert.equal(r.resultado, 'exito');
    assert.equal(r.sk, `EV#${AHORA.toISOString()}#${r.eventoId}`);
});

test('una operación fuera del catálogo no se puede registrar', async () => {
    await assert.rejects(A.registrar({ ...base(), operacion: 'algo.nuevo' }), (e) => e.codigo === 'AUDITORIA_DATO_PROHIBIDO');
});

test('el detalle rechaza contraseñas, tokens, RUT, correos, valores y textos largos', () => {
    const malos = [
        { password: 'x' }, { pin: '1234' }, { token: 'abc' }, { llaveDatos: 'k' }, { rut: '1' }, { email: 'a' },
        { telefono: '1' }, { nombre: 'Juan' }, { valorAnterior: 'x' }, { respuestas: [] }, { descripcion: 'x' },
        { campo: '12.345.678-5' }, { campo: '12345678-5' }, { contacto: 'juan@ejemplo.cl' }, { nota: 'x'.repeat(121) },
        { anidado: { secreto: 'x' } },
    ];
    for (const detalle of malos) assert.throws(() => A.sanear(detalle), (e) => e.codigo === 'AUDITORIA_DATO_PROHIBIDO', JSON.stringify(detalle));
    assert.deepEqual(A.sanear({ campos: ['rut', 'telefono'], version: 'v1', conteo: 3 }), { campos: ['rut', 'telefono'], version: 'v1', conteo: 3 }, 'el NOMBRE de un campo sí');
});

test('un ingreso fallido se registra por el HMAC del RUT, nunca el RUT ni la contraseña probada', async () => {
    const auth = require('../handlers/auth/handler');
    const res = await auth.login({ body: JSON.stringify({ rut: '12.345.678-5', password: 'clave-equivocada' }), requestContext: { http: { method: 'POST', sourceIp: '200.9.9.9' } }, headers: {} });
    assert.equal(res.statusCode, 401);
    const [r] = registros();
    assert.equal(r.operacion, 'auth.ingreso_fallido');
    assert.equal(r.actorTipo, 'cuenta');
    assert.match(r.actorId, /^rut:v1:[0-9a-f]{64}$/);
    assert.equal(r.origen.ip, '200.9.9.9');
    const texto = JSON.stringify(r);
    assert.ok(!texto.includes('12.345.678') && !texto.includes('12345678') && !texto.includes('clave-equivocada'));
});

// ─── Integridad ─────────────────────────────────────────────────────────────

test('el sello delata una alteración hecha sin la llave', async () => {
    const r = await A.registrar(base(), { ahora: AHORA });
    assert.equal(await A.verificarSello(r), 'integro');
    assert.equal(await A.verificarSello({ ...r, resultado: 'denegado' }), 'alterado');
    assert.equal(await A.verificarSello({ ...r, titulares: [] }), 'alterado');
    assert.equal(await A.verificarSello({ ...r, ttl: r.ttl + 1 }), 'alterado', 'tampoco se puede alargar o acortar su conservación');
    const { sello, ...sinSello } = r;
    assert.equal(await A.verificarSello(sinSello), 'sin_sello');
});

test('cada categoría tiene su plazo de conservación, y vence por TTL', async () => {
    const seg = await A.registrar({ ...base(), operacion: 'auth.ingreso' }, { ahora: AHORA });
    const dat = await A.registrar(base(), { ahora: AHORA });
    const dias = (r) => Math.round((r.ttl * 1000 - AHORA.getTime()) / 86400000);
    assert.equal(dias(seg), 365);
    assert.equal(dias(dat), 1825);
});

test('ningún rol puede actualizar ni borrar registros de auditoría; la tabla tiene TTL y se conserva', () => {
    const yml = fs.readFileSync(path.join(__dirname, '..', 'serverless.yml'), 'utf8');
    const bloque = yml.slice(yml.indexOf('    AuditoriaAccesosTable:'), yml.indexOf('    EppTable:'));
    assert.match(bloque, /DeletionPolicy: Retain/);
    assert.match(bloque, /TimeToLiveSpecification:\s+AttributeName: ttl\s+Enabled: true/);
    // Que ningún statement de IAM, en ningún rol, permita más que agregar y
    // leer sobre esta tabla lo fija tests/gobernanza-permisos.test.js (la
    // incluye junto al historial), también para RolSupresion, que ahora escribe aquí.
    // Y el código no tiene rutas que la modifiquen.
    const fuentes = ['lib/gobernanza/auditoria.js', 'handlers/gobernanza/auditoria.js'].map((f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8')).join('\n');
    assert.ok(!/UpdateCommand|DeleteCommand/.test(fuentes));
});

// ─── Consulta ───────────────────────────────────────────────────────────────

test('consultar la auditoría exige permiso, y el intento queda registrado', async () => {
    const res = await derechos.atender(evento(juan, 'GET', '/gobernanza/auditoria'), { ahora: AHORA });
    assert.equal(res.statusCode, 403);
    assert.deepEqual(registros().map((r) => [r.operacion, r.resultado, r.actorId]), [['auditoria.consulta', 'denegado', juan.personaId]]);
});

test('con permiso se ve solo la empresa propia, con la integridad de cada registro, y la consulta queda registrada', async () => {
    await A.registrar(base(), { ahora: AHORA });
    await A.registrar({ ...base(), tenantId: 'otra-empresa' }, { ahora: AHORA });
    const res = await derechos.atender(evento(ana, 'GET', '/gobernanza/auditoria', { permisos: 'empresa.auditoria' }), { ahora: AHORA });
    assert.equal(res.statusCode, 200, res.body);
    const d = JSON.parse(res.body).data;
    assert.ok(d.eventos.every((e) => e.tenantId === T), 'nada de otra empresa');
    assert.ok(d.eventos.every((e) => e.integridad === 'integro'));
    assert.ok(registros().some((r) => r.operacion === 'auditoria.consulta' && r.resultado === 'exito' && r.actorId === ana.personaId));
});

test('si la consulta no se puede registrar, no se muestra la auditoría', async () => {
    const send = docClient.send;
    docClient.send = async function (cmd) {
        if (cmd.constructor.name === 'PutCommand' && cmd.input.TableName === 'AUDITORIA_ACCESOS_TABLE') throw new Error('caída');
        return send.call(this, cmd);
    };
    try {
        const res = await derechos.atender(evento(ana, 'GET', '/gobernanza/auditoria', { permisos: 'empresa.auditoria' }), { ahora: AHORA });
        assert.equal(res.statusCode, 503);
    } finally {
        docClient.send = send;
    }
});

// ─── Detección ──────────────────────────────────────────────────────────────

const fallido = (n, actor = 'rut:v1:abc') => ({ eventoId: `e${n}`, operacion: 'auth.ingreso_fallido', actorId: actor, en: new Date(AHORA.getTime() - n * 60000).toISOString() });

test('fuerza bruta: cinco ingresos fallidos en quince minutos contra una cuenta alertan; cuatro, no', () => {
    const cuatro = [1, 2, 3].map((n) => fallido(n));
    assert.deepEqual(deteccion.evaluar(fallido(0), cuatro, { ahora: AHORA }), []);
    const cinco = [1, 2, 3, 4].map((n) => fallido(n));
    assert.equal(deteccion.evaluar(fallido(0), cinco, { ahora: AHORA })[0].regla, 'fuerza_bruta_cuenta');
    const viejos = [20, 21, 22, 23].map((n) => fallido(n));
    assert.deepEqual(deteccion.evaluar(fallido(0), viejos, { ahora: AHORA }), [], 'fuera de la ventana no cuentan');
});

test('una alerta por ventana: si ya se alertó, no se repite', () => {
    const previos = [1, 2, 3, 4, 5].map((n) => fallido(n));
    const yaAlertada = { eventoId: 'a1', operacion: 'alerta.fuerza_bruta_cuenta', actorId: 'rut:v1:abc', en: new Date(AHORA.getTime() - 60000).toISOString() };
    assert.deepEqual(deteccion.evaluar(fallido(0), [...previos, yaAlertada], { ahora: AHORA }), []);
});

test('acceso masivo a salud: treinta personas distintas en una hora alertan', () => {
    const ev = (n, titulares) => ({ sk: `s${n}`, tipos: ['ficha_salud'], titulares, en: new Date(AHORA.getTime() - n * 60000).toISOString() });
    const muchos = Array.from({ length: 29 }, (_, i) => `p${i}`);
    assert.deepEqual(deteccion.evaluar(ev(0, muchos), [], { ahora: AHORA }), []);
    assert.equal(deteccion.evaluar(ev(0, muchos), [ev(5, ['p99'])], { ahora: AHORA })[0].regla, 'acceso_masivo_salud');
});

test('otorgar el rol de administrador o cambiar los roles de la empresa alerta siempre', () => {
    assert.equal(deteccion.evaluar({ eventoId: 'x', operacion: 'admin.cambio_rol', detalle: { rolNuevo: 'admin' }, en: AHORA.toISOString() }, [], { ahora: AHORA })[0].regla, 'escalamiento_privilegios');
    assert.deepEqual(deteccion.evaluar({ eventoId: 'y', operacion: 'admin.cambio_rol', detalle: { rolNuevo: 'supervisor' }, en: AHORA.toISOString() }, [], { ahora: AHORA }), []);
});

test('la alerta queda registrada y avisa en la bandeja a quien revisa la auditoría', async () => {
    for (let i = 4; i >= 0; i -= 1) {
        await A.registrar({ operacion: 'auth.ingreso_fallido', resultado: 'denegado', actor: { id: 'rut:v1:abc', tipo: 'cuenta' }, tenantId: T }, { ahora: new Date(AHORA.getTime() - i * 60000) });
    }
    const alertas = registros().filter((r) => r.operacion === 'alerta.fuerza_bruta_cuenta');
    assert.equal(alertas.length, 1);
    assert.equal(alertas[0].detalle.conteo, 5);
    const avisos = doble.items('INBOX_TABLE').filter((m) => m.type === 'alert' && m.subject === 'Alerta de seguridad');
    assert.deepEqual(avisos.map((m) => m.recipientId), [ana.personaId], 'solo a quien tiene el permiso de auditoría');
});
