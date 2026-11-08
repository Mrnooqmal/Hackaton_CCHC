// Emisión de vales: la obra del turno es obligatoria, de la empresa, y con la
// persona asignada. Y la Ficha Básica de Salud no se responde sin red.
//
// La obra ata el vale (ver vale-firma.test.js): sin esta comprobación al
// emitir, cualquiera con firma asistida podría pedir vales de una obra ajena, o
// a nombre de alguien que no trabaja en ella.

process.env.CAMPO_HMAC_KEY = 'clave-de-prueba-hmac';
process.env.CAMPO_CIFRADO_LOCAL_KEY = require('crypto').randomBytes(32).toString('base64');
process.env.CREDENCIAL_PEPPER = 'pimienta-de-prueba';

const { prepararEntorno, crearDobleTablas } = require('./doble-dynamo-tablas');
const esquemas = prepararEntorno();

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { PutCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');

const { docClient } = require('../lib/clients/dynamodb');
const { PersonaService } = require('../lib/services/PersonaService');
const { TenantService } = require('../lib/services/TenantService');
const { idEncuestaSalud } = require('../lib/health/healthSurvey');
const vales = require('../handlers/vales/handler');
const encuestas = require('../handlers/surveys/handler');

const PIN = '4827';
let doble; let A; let B; let rosa;

beforeEach(async () => {
    doble = crearDobleTablas(docClient, esquemas, { proyecciones: true });
    A = (await new TenantService().setup({ nombre: 'Constructora A', rutEmpresa: '76.543.210-3' })).tenantId;
    B = (await new TenantService().setup({ nombre: 'Constructora B', rutEmpresa: '77.777.777-7' })).tenantId;
    for (const [t, o] of [[A, 'o-a'], [A, 'o-a2'], [B, 'o-b']]) {
        await docClient.send(new PutCommand({ TableName: 'OBRAS_TABLE', Item: { PK: `TENANT#${t}`, SK: `OBRA#${o}`, obraId: o, tenantId: t, nombre: o } }));
    }
    const svc = new PersonaService();
    rosa = (await svc.crear(A, { rut: '11.111.111-1', nombre: 'Rosa', rol: 'trabajador', obraIds: ['o-a'] })).persona.personaId;
    await svc.setPin(A, rosa, PIN, undefined, { personaId: rosa });
    await docClient.send(new UpdateCommand({
        TableName: 'PERSONAS_TABLE', Key: { PK: `TENANT#${A}`, SK: `PERSONA#${rosa}` },
        UpdateExpression: 'SET habilitado = :h', ExpressionAttributeValues: { ':h': true },
    }));
});
afterEach(() => doble.restaurar());

const ev = (body, { personaId = rosa, permisos = '' } = {}) => ({
    requestContext: {
        http: { method: 'POST', sourceIp: '10.0.0.1' },
        authorizer: { lambda: { sessionId: 's', personaId, tenantId: A, rol: 'trabajador', permisos, credencialProvisional: 'false' } },
    },
    pathParameters: {}, queryStringParameters: {}, headers: {},
    body: JSON.stringify(body),
});

test('sin obra del turno no se emiten vales', async () => {
    const res = await vales.emitir(ev({ pin: PIN }));
    assert.equal(res.statusCode, 400, res.body);
    assert.equal(doble.items('VALES_TABLE').length, 0);
});

test('una obra de otra empresa, o a la que la persona no está asignada, responde 404', async () => {
    assert.equal((await vales.emitir(ev({ pin: PIN, obraId: 'o-b' }))).statusCode, 404);
    assert.equal((await vales.emitir(ev({ pin: PIN, obraId: 'o-a2' }))).statusCode, 404);
    assert.equal(doble.items('VALES_TABLE').length, 0);
});

test('aunque la ficha diga que está asignada, una obra de otra empresa responde 404', async () => {
    // Una asignación a una obra ajena no debería existir; si existe (dato
    // corrupto o manipulado), la comprobación de la obra la ataja sola.
    await docClient.send(new UpdateCommand({
        TableName: 'PERSONAS_TABLE', Key: { PK: `TENANT#${A}`, SK: `PERSONA#${rosa}` },
        UpdateExpression: 'SET obraIds = :o REMOVE asignaciones', ExpressionAttributeValues: { ':o': ['o-a', 'o-b'] },
    }));
    const res = await vales.emitir(ev({ pin: PIN, obraId: 'o-b' }));
    assert.equal(res.statusCode, 404, res.body);
    assert.match(JSON.parse(res.body).error, /Obra no encontrada/);
    assert.equal(doble.items('VALES_TABLE').length, 0);
});

test('con la obra del turno: 5 vales, atados a la persona y a esa obra', async () => {
    const res = await vales.emitir(ev({ pin: PIN, obraId: 'o-a' }));
    assert.equal(res.statusCode, 200, res.body);
    const datos = JSON.parse(res.body).data;
    assert.equal(datos.vales.length, 5);
    assert.equal(datos.obraId, 'o-a');
    const guardados = doble.items('VALES_TABLE');
    assert.equal(guardados.length, 5);
    assert.ok(guardados.every((v) => v.obraId === 'o-a' && v.personaId === rosa && v.tenantId === A));
});

test('la Ficha Básica de Salud no se responde con vale', async () => {
    const surveyId = idEncuestaSalud(A);
    await docClient.send(new PutCommand({ TableName: 'SURVEYS_TABLE', Item: {
        surveyId, tenantId: A, titulo: 'Ficha Básica de Salud', recipients: [{ workerId: rosa, estado: 'pendiente' }], createdAt: '2026-11-01T00:00:00Z',
    } }));
    const res = await encuestas.updateResponseStatus({
        ...ev({ estado: 'respondida', vale: 'v'.repeat(64), idFirmaLocal: 'local-1', responses: [] }),
        pathParameters: { id: surveyId, workerId: rosa },
    });
    assert.equal(res.statusCode, 400, res.body);
    assert.match(JSON.parse(res.body).error, /con señal/);
});
