// La marca de "visto" de un incidente (`POST /incidents/:id/viewed`).
//
// `create` guarda `viewedBy` como lista y la marca usaba `ADD` con un conjunto de texto:
// DynamoDB rechaza eso sobre una lista (ValidationException) y la marca nunca se guardaba.
// La forma guardada es la lista; lo que quedó como conjunto o sin el campo se convierte.

process.env.CAMPO_HMAC_KEY = 'clave-de-prueba-hmac';
process.env.CAMPO_CIFRADO_LOCAL_KEY = require('crypto').randomBytes(32).toString('base64');
process.env.CREDENCIAL_PEPPER = 'pimienta-de-prueba';
process.env.EVIDENCIA_BUCKET = process.env.EVIDENCIA_BUCKET || 'evidencia-de-prueba';
process.env.AWS_REGION = process.env.AWS_REGION || 'us-east-1';
process.env.AWS_ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID || 'PRUEBA_SIN_AWS';
process.env.AWS_SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY || 'PRUEBA_SIN_AWS';

const { prepararEntorno, crearDobleTablas } = require('./doble-dynamo-tablas');
const esquemas = prepararEntorno();

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');

const { PersonaService } = require('../lib/services/PersonaService');
const { TenantService } = require('../lib/services/TenantService');
const { ObraService } = require('../lib/services/ObraService');
const { eventBus } = require('../lib/events/EventBus');
const { conVistoPor } = require('../lib/casos-servidor');
const incidentes = require('../handlers/incidents-module/handler');
const { IncidentsRepository } = require('../handlers/incidents-module/incidents.repository');

let doble; let emitir; let consola;
let A; let obraA;
let prevencionista;

beforeEach(async () => {
    doble = crearDobleTablas(DynamoDBDocumentClient.prototype, esquemas, { proyecciones: true });
    emitir = eventBus.emit;
    eventBus.emit = async () => {};
    consola = { log: console.log, error: console.error, warn: console.warn };
    console.log = () => {}; console.error = () => {}; console.warn = () => {};

    A = (await new TenantService().setup({ nombre: 'Constructora A', rutEmpresa: '76.543.210-3' })).tenantId;
    obraA = (await new ObraService().crear(A, { nombre: 'Edificio Los Robles' })).obraId;
    const svc = new PersonaService();
    prevencionista = (await svc.crear(A, { rut: '9.876.543-3', nombre: 'Pedro', rol: 'prevencionista' })).persona.personaId;
    doble.items('PERSONAS_TABLE').find((x) => x.personaId === prevencionista).estado = 'activo';
});
afterEach(() => {
    doble.restaurar();
    eventBus.emit = emitir;
    Object.assign(console, consola);
});

const PREVENCION = 'incidentes.reportar,incidentes.historial,incidentes.calificar_accidente';
const pedir = (quien, metodo, ruta, body) => incidentes.incidentsHandler({
    rawPath: ruta, rawQueryString: '', headers: { host: 'api.test' }, queryStringParameters: null,
    body: body === undefined ? undefined : JSON.stringify(body),
    requestContext: {
        http: { method: metodo, path: ruta, sourceIp: '200.1.2.3' },
        authorizer: { lambda: { sessionId: 's', personaId: quien.personaId, tenantId: quien.tenantId, rol: 'x', permisos: quien.permisos, credencialProvisional: 'false' } },
    },
});
const prev = () => ({ personaId: prevencionista, permisos: PREVENCION, tenantId: A });
const guardado = (id) => doble.items('INCIDENTS_TABLE').find((i) => i.incidentId === id);
const crearAccidente = async () => {
    const res = await pedir(prev(), 'POST', '/incidents', {
        tipo: 'accidente', gravedad: 'grave', descripcion: 'Caída desde el andamio', obraId: obraA, centroTrabajo: 'Torre A',
        trabajador: { nombre: 'Juan Pérez', rut: '17.777.777-3' },
    });
    assert.equal(res.statusCode, 201, res.body);
    return JSON.parse(res.body).data.incidentId;
};
const marcar = async (id) => assert.equal((await pedir(prev(), 'POST', `/incidents/${id}/viewed`, {})).statusCode, 200);
const leer = async (id) => {
    const res = await pedir(prev(), 'GET', `/incidents/${id}`);
    assert.equal(res.statusCode, 200, res.body);
    return JSON.parse(res.body).data;
};

test('un incidente recién creado (viewedBy es una lista vacía) se marca como visto', async () => {
    const id = await crearAccidente();
    assert.deepEqual(guardado(id).viewedBy, []);
    await marcar(id);
    assert.deepEqual(guardado(id).viewedBy, [prevencionista]);
    assert.deepEqual((await leer(id)).viewedBy, [prevencionista]);
});

test('marcar dos veces no duplica y deja intacto updatedAt', async () => {
    const id = await crearAccidente();
    const antes = guardado(id).updatedAt;
    await marcar(id);
    await marcar(id);
    assert.deepEqual(guardado(id).viewedBy, [prevencionista]);
    assert.equal(guardado(id).updatedAt, antes);
});

test('otra persona se suma a la lista sin quitar a la anterior', async () => {
    const id = await crearAccidente();
    guardado(id).viewedBy = ['otra-persona'];
    await marcar(id);
    assert.deepEqual(guardado(id).viewedBy, ['otra-persona', prevencionista]);
});

test('un viewedBy antiguo como conjunto de texto se reescribe como lista y se lee como arreglo', async () => {
    const id = await crearAccidente();
    const antes = guardado(id).updatedAt;
    guardado(id).viewedBy = new Set(['otra-persona']);
    assert.deepEqual((await leer(id)).viewedBy, ['otra-persona']);
    await marcar(id);
    assert.ok(Array.isArray(guardado(id).viewedBy));
    assert.deepEqual(guardado(id).viewedBy, ['otra-persona', prevencionista]);
    assert.equal(guardado(id).updatedAt, antes);
    await marcar(id);
    assert.deepEqual(guardado(id).viewedBy, ['otra-persona', prevencionista]);
});

test('un conjunto que ya tiene a la persona no cambia y igual se lee como arreglo', async () => {
    const id = await crearAccidente();
    guardado(id).viewedBy = new Set([prevencionista]);
    await marcar(id);
    assert.deepEqual((await leer(id)).viewedBy, [prevencionista]);
});

test('un incidente sin el campo viewedBy se marca como visto', async () => {
    const id = await crearAccidente();
    delete guardado(id).viewedBy;
    assert.deepEqual((await leer(id)).viewedBy, []);
    await marcar(id);
    assert.deepEqual(guardado(id).viewedBy, [prevencionista]);
});

test('el listado entrega viewedBy como arreglo aunque esté guardado como conjunto', async () => {
    const id = await crearAccidente();
    guardado(id).viewedBy = new Set(['otra-persona']);
    const res = await pedir(prev(), 'GET', '/incidents');
    assert.equal(res.statusCode, 200, res.body);
    const datos = JSON.parse(res.body).data;
    const lista = Array.isArray(datos) ? datos : (datos.incidents || datos.items);
    assert.deepEqual(lista.find((i) => i.incidentId === id).viewedBy, ['otra-persona']);
});

test('marcar un incidente que no existe no crea ningún elemento', async () => {
    const antes = doble.items('INCIDENTS_TABLE').length;
    await new IncidentsRepository().markAsViewed('no-existe', prevencionista);
    assert.equal(doble.items('INCIDENTS_TABLE').length, antes);
});

test('conVistoPor: lista, conjunto y ausente', () => {
    const lista = { viewedBy: ['a'] };
    assert.equal(conVistoPor(lista), lista);
    assert.deepEqual(conVistoPor({ viewedBy: new Set(['a', 'b']) }).viewedBy, ['a', 'b']);
    assert.deepEqual(conVistoPor({}).viewedBy, []);
    assert.equal(conVistoPor(null), null);
});
