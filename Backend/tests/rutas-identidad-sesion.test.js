// `/ausencias` y `/signature-requests`: empresa y actor desde la sesión,
// pertenencia con 404 y permiso exigido.
//
// Las dos rutas tomaban la identidad del cliente. `/ausencias` leía `tenantId`
// del cuerpo o de la consulta y `registradoPor` del cuerpo: con una sesión
// cualquiera se leían, escribían y borraban ausencias de otra empresa, con su
// motivo. `/signature-requests` descifraba las solicitudes de la empresa que se
// nombrara en la consulta, comparaba la empresa en `get` solo si el cliente la
// mandaba, tomaba el solicitante del cuerpo, devolvía el historial de firmas de
// cualquier persona de cualquier empresa y dejaba cancelar cualquier solicitud.
//
// La prueba estructural (`identidad-desde-sesion.test.js`) impide que vuelva a
// aparecer una lectura así; esta fija el comportamiento de estas rutas.

process.env.CAMPO_HMAC_KEY = 'clave-de-prueba-hmac';
process.env.CAMPO_CIFRADO_LOCAL_KEY = require('crypto').randomBytes(32).toString('base64');
process.env.CREDENCIAL_PEPPER = 'pimienta-de-prueba';

const { prepararEntorno, crearDobleTablas } = require('./doble-dynamo-tablas');
const esquemas = prepararEntorno();

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { PutCommand } = require('@aws-sdk/lib-dynamodb');

const { docClient } = require('../lib/clients/dynamodb');
const { PersonaService } = require('../lib/services/PersonaService');
const { TenantService } = require('../lib/services/TenantService');
const ausencias = require('../handlers/ausencias/handler');
const solicitudes = require('../handlers/signature-requests/handler');
const { eventBus } = require('../lib/events/EventBus');

let doble;
let A; let B;            // empresas
let jefe; let trabajadora; let ajena;
let obraA; let obraB;
let emitir;

const GESTOR = 'actividades.crear,firmas.crear,personas.detalle';

beforeEach(async () => {
    doble = crearDobleTablas(docClient, esquemas, { proyecciones: true });
    emitir = eventBus.emit;
    eventBus.emit = async () => {};
    A = (await new TenantService().setup({ nombre: 'Constructora A', rutEmpresa: '76.543.210-3' })).tenantId;
    B = (await new TenantService().setup({ nombre: 'Constructora B', rutEmpresa: '77.777.777-7' })).tenantId;
    const svc = new PersonaService();
    jefe = (await svc.crear(A, { rut: '12.345.678-5', nombre: 'Jefa', rol: 'jefe_obra' })).persona.personaId;
    trabajadora = (await svc.crear(A, { rut: '11.111.111-1', nombre: 'Rosa', rol: 'trabajador' })).persona.personaId;
    ajena = (await svc.crear(B, { rut: '22.222.222-2', nombre: 'Otra', rol: 'trabajador' })).persona.personaId;
    obraA = 'obra-a'; obraB = 'obra-b';
    for (const [t, o] of [[A, obraA], [B, obraB]]) {
        await docClient.send(new PutCommand({ TableName: 'OBRAS_TABLE', Item: { PK: `TENANT#${t}`, SK: `OBRA#${o}`, obraId: o, tenantId: t, nombre: o } }));
    }
});
afterEach(() => { doble.restaurar(); eventBus.emit = emitir; });

/** Evento con sesión. `tenantId` ajeno en la consulta a propósito: no debe importar. */
const ev = ({ personaId = jefe, tenantId = A, permisos = GESTOR, metodo = 'GET', ruta = '/', query = {}, body, path = {} } = {}) => ({
    requestContext: {
        http: { method: metodo, path: ruta, sourceIp: '10.0.0.1' },
        authorizer: { lambda: { sessionId: 's', personaId, tenantId, rol: 'x', permisos, credencialProvisional: 'false' } },
    },
    rawPath: ruta,
    queryStringParameters: { tenantId: B, ...query },
    pathParameters: path,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: {},
});
const datos = (res) => JSON.parse(res.body).data;

// ─── /ausencias ──────────────────────────────────────────────────────────────

const HOY = '2026-10-01';

test('ausencias: se registra en la empresa de la sesión, a nombre de quien la registra', async () => {
    const res = await ausencias.create(ev({ metodo: 'POST', body: {
        tenantId: B, obraId: obraA, fecha: HOY, personaId: trabajadora, motivo: 'licencia', solicitanteId: ajena,
    } }));
    assert.equal(res.statusCode, 201, res.body);
    const [item] = doble.items('AUSENCIAS_TABLE');
    assert.equal(item.tenantId, A, 'la empresa del cuerpo no cuenta');
    assert.equal(item.registradoPor, jefe, 'quien registra es la sesión, no el solicitanteId del cuerpo');
});

test('ausencias: una persona u obra de otra empresa responde 404 y no escribe nada', async () => {
    for (const body of [
        { obraId: obraA, fecha: HOY, personaId: ajena },
        { obraId: obraB, fecha: HOY, personaId: trabajadora },
    ]) {
        const res = await ausencias.create(ev({ metodo: 'POST', body }));
        assert.equal(res.statusCode, 404, JSON.stringify(body));
    }
    assert.equal(doble.items('AUSENCIAS_TABLE').length, 0);
});

test('ausencias: listar y quitar no salen de la empresa de la sesión', async () => {
    await docClient.send(new PutCommand({ TableName: 'AUSENCIAS_TABLE', Item: {
        tenantId: B, sk: `${obraB}#${HOY}#${ajena}`, obraId: obraB, fecha: HOY, personaId: ajena, motivo: 'licencia',
    } }));
    // Con la empresa B en la consulta, y su obra.
    const lista = await ausencias.list(ev({ query: { tenantId: B, obraId: obraB, fecha: HOY } }));
    assert.equal(lista.statusCode, 404, 'la obra de otra empresa no existe para esta sesión');
    const quitar = await ausencias.remove(ev({ metodo: 'DELETE', query: { tenantId: B, obraId: obraB, fecha: HOY, personaId: ajena } }));
    assert.equal(quitar.statusCode, 404);
    assert.equal(doble.items('AUSENCIAS_TABLE').length, 1, 'la ausencia de la otra empresa sigue ahí');
});

test('ausencias: sin el permiso de convocar actividades, 403', async () => {
    const r = await ausencias.list(ev({ personaId: trabajadora, permisos: 'actividades.ver', query: { obraId: obraA, fecha: HOY } }));
    assert.equal(r.statusCode, 403);
});

// ─── /signature-requests ─────────────────────────────────────────────────────

const crearSolicitud = (over = {}) => solicitudes.create(ev({ metodo: 'POST', body: {
    tipo: 'OTRO', titulo: 'Firma', trabajadoresIds: [trabajadora], solicitanteId: ajena, tenantId: B, ...over,
} }));

test('solicitudes: se crean en la empresa de la sesión, con la sesión como solicitante', async () => {
    const res = await crearSolicitud();
    assert.equal(res.statusCode, 201, res.body);
    const [item] = doble.items('SIGNATURE_REQUESTS_TABLE');
    assert.equal(item.tenantId, A);
    assert.equal(item.solicitanteId, jefe);
});

test('solicitudes: crear exige el permiso, y una persona u obra ajena responde 404', async () => {
    assert.equal((await solicitudes.create(ev({ metodo: 'POST', permisos: '', body: { tipo: 'OTRO', titulo: 'x', trabajadoresIds: [trabajadora] } }))).statusCode, 403);
    assert.equal((await crearSolicitud({ trabajadoresIds: [trabajadora, ajena] })).statusCode, 404);
    assert.equal((await crearSolicitud({ obraId: obraB })).statusCode, 404);
    assert.equal(doble.items('SIGNATURE_REQUESTS_TABLE').length, 0);
});

/** Una solicitud de la empresa B, escrita directo. */
const solicitudDeB = async () => {
    await docClient.send(new PutCommand({ TableName: 'SIGNATURE_REQUESTS_TABLE', Item: {
        requestId: 'r-b', tenantId: B, solicitanteId: ajena, estado: 'pendiente', createdAt: '2026-10-01T00:00:00Z',
        trabajadores: [{ personaId: ajena, firmado: false }], totalRequeridos: 1, totalFirmados: 0,
    } }));
};

test('solicitudes: listar, ver, estadísticas y cancelar no salen de la empresa de la sesión', async () => {
    await solicitudDeB();
    const lista = await solicitudes.list(ev({ query: { tenantId: B } }));
    assert.equal(lista.statusCode, 200);
    assert.equal(datos(lista).requests.length, 0, 'la empresa de la consulta no cuenta');
    assert.equal((await solicitudes.get(ev({ path: { id: 'r-b' } }))).statusCode, 404);
    assert.equal(datos(await solicitudes.getStats(ev({ query: { tenantId: B } }))).total, 0);
    assert.equal((await solicitudes.cancel(ev({ metodo: 'POST', path: { id: 'r-b' }, body: {} }))).statusCode, 404);
    assert.equal(doble.items('SIGNATURE_REQUESTS_TABLE')[0].estado, 'pendiente');
});

test('solicitudes: sin firmas.crear se ve solo lo propio', async () => {
    await crearSolicitud();
    const otra = await solicitudes.create(ev({ metodo: 'POST', body: { tipo: 'OTRO', titulo: 'Otra', trabajadoresIds: [jefe] } }));
    assert.equal(otra.statusCode, 201);
    const comoTrabajadora = ev({ personaId: trabajadora, permisos: '' });
    const lista = datos(await solicitudes.list(comoTrabajadora));
    assert.deepEqual(lista.requests.map((r) => r.titulo), ['Firma'], 'solo aquella en la que firma');
    const idOtra = datos(otra).requestId;
    assert.equal((await solicitudes.get(ev({ personaId: trabajadora, permisos: '', path: { id: idOtra } }))).statusCode, 404);
    assert.equal((await solicitudes.cancel(ev({ personaId: trabajadora, permisos: '', metodo: 'POST', path: { id: idOtra }, body: {} }))).statusCode, 403);
});

test('solicitudes: pendientes e historial, de uno mismo o con personas.detalle, y solo de la empresa', async () => {
    await solicitudDeB();
    // La persona de otra empresa no existe para esta sesión.
    assert.equal((await solicitudes.getPendingByWorker(ev({ path: { workerId: ajena } }))).statusCode, 404);
    assert.equal((await solicitudes.getHistoryByWorker(ev({ path: { workerId: ajena } }))).statusCode, 404);
    // Sin personas.detalle, solo lo propio.
    const deOtra = ev({ personaId: trabajadora, permisos: '', path: { workerId: jefe } });
    assert.equal((await solicitudes.getPendingByWorker(deOtra)).statusCode, 404);
    const propias = await solicitudes.getPendingByWorker(ev({ personaId: trabajadora, permisos: '', path: { workerId: trabajadora } }));
    assert.equal(propias.statusCode, 200);
});

test('solicitudes: cancelar deja constancia de quién canceló', async () => {
    const id = datos(await crearSolicitud()).requestId;
    const res = await solicitudes.cancel(ev({ metodo: 'POST', path: { id }, body: { canceladaPor: ajena } }));
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(doble.items('SIGNATURE_REQUESTS_TABLE')[0].canceladaPor, jefe);
});
