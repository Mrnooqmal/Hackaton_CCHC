// Auditoría de acceso a datos de salud: quién, cuándo, desde dónde, sin el contenido.
// Sin registro no hay acceso; el acceso a los propios datos no se registra.

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
const { anotarAccesoSalud, huellaClave } = require('../lib/gobernanza/auditoriaSalud');
const personas = require('../handlers/personas-module/handler');
const documentos = require('../handlers/documents/handler');
const { crearDobleS3 } = require('./doble-s3');

let doble;
let dobleS3;
let T;
let medica;    // con permiso de vigilancia
let juan;      // con datos de salud
let pedro;     // sin datos de salud

const VIGILANCIA = { enVigilancia: true, protocolos: ['PREXOR'], fechaUltimoExamen: '2026-05-01', aptitudLaboral: 'apto con restricciones', restricciones: ['no altura'] };

beforeEach(async () => {
    doble = crearDobleTablas(docClient, esquemas);
    dobleS3 = crearDobleS3();
    const tenant = await new TenantService().setup({ nombre: 'Constructora Prueba', rutEmpresa: '76.543.210-3' });
    T = tenant.tenantId;
    const svc = new PersonaService();
    medica = (await svc.crear(T, { rut: '9.876.543-3', nombre: 'Marta', rol: 'prevencionista', email: 'm@ejemplo.cl', password: 'clave-larga-1' })).persona;
    juan = (await svc.crear(T, { rut: '12.345.678-5', nombre: 'Juan', rol: 'trabajador' })).persona;
    pedro = (await svc.crear(T, { rut: '11.111.111-1', nombre: 'Pedro', rol: 'trabajador' })).persona;
    await svc.actualizar(T, juan.personaId, { vigilanciaSalud: VIGILANCIA });
});
afterEach(() => { doble.restaurar(); dobleS3.restaurar(); });

const evento = (quien, metodo, ruta, { permisos = 'personas.ver,personas.detalle,persona.vigilancia_salud', path = {}, body } = {}) => ({
    requestContext: { http: { method: metodo, sourceIp: '200.1.2.3' }, authorizer: { lambda: { sessionId: 's', personaId: quien.personaId, tenantId: T, rol: 'prevencionista', permisos } } },
    headers: { 'user-agent': 'Mozilla/5.0 prueba' }, rawPath: ruta, pathParameters: path, queryStringParameters: {},
    body: body ? JSON.stringify(body) : undefined,
});
const auditoria = () => doble.items('AUDITORIA_ACCESOS_TABLE');

test('ver la ficha de salud de otra persona queda registrado: quién, cuándo, desde dónde, a quién', async () => {
    const r = await personas.personasHandler(evento(medica, 'GET', `/personas/${juan.personaId}`));
    assert.equal(r.statusCode, 200, r.body);
    assert.equal(JSON.parse(r.body).data.vigilanciaSalud.aptitudLaboral, 'apto con restricciones');
    const [a] = auditoria();
    assert.equal(a.actorId, medica.personaId);
    assert.equal(a.ip, '200.1.2.3');
    assert.match(a.userAgent, /Mozilla/);
    assert.equal(a.ruta, `GET /personas/${juan.personaId}`);
    assert.deepEqual(a.titulares, [juan.personaId]);
    assert.deepEqual(a.tipos, ['ficha_salud']);
    assert.ok(a.en);
});

test('el registro no lleva el contenido de salud', async () => {
    await personas.personasHandler(evento(medica, 'GET', `/personas/${juan.personaId}`));
    const texto = JSON.stringify(auditoria());
    assert.ok(!texto.includes('PREXOR') && !texto.includes('restricciones') && !texto.includes('no altura'));
});

test('un listado es UN registro con todas las personas cuya salud se entregó', async () => {
    await new PersonaService().actualizar(T, pedro.personaId, { restriccionLaboral: { detalle: 'x' } });
    await personas.personasHandler(evento(medica, 'GET', '/personas'));
    assert.equal(auditoria().length, 1);
    assert.deepEqual(auditoria()[0].titulares.sort(), [juan.personaId, pedro.personaId].sort());
});

test('ver los propios datos de salud no se registra', async () => {
    await personas.personasHandler(evento(juan, 'GET', `/personas/${juan.personaId}`, { permisos: 'personas.ver' }));
    assert.equal(auditoria().length, 0);
});

test('una ficha sin datos de salud guardados no genera registro, aunque quien mira tenga el permiso', async () => {
    await personas.personasHandler(evento(medica, 'GET', `/personas/${pedro.personaId}`));
    assert.equal(auditoria().length, 0);
});

test('sin el permiso no se entrega salud, y no hay nada que registrar', async () => {
    const r = await personas.personasHandler(evento(pedro, 'GET', `/personas/${juan.personaId}`, { permisos: 'personas.ver,personas.detalle' }));
    assert.equal(JSON.parse(r.body).data.vigilanciaSalud, undefined);
    assert.equal(auditoria().length, 0);
});

test('si el registro no se puede escribir, la salud NO se entrega: 503', async () => {
    const enviar = docClient.send;
    docClient.send = async (cmd) => {
        if (cmd.input?.TableName === 'AUDITORIA_ACCESOS_TABLE') throw Object.assign(new Error('caída'), { name: 'InternalServerError' });
        return enviar(cmd);
    };
    const r = await personas.personasHandler(evento(medica, 'GET', `/personas/${juan.personaId}`));
    docClient.send = enviar;
    assert.equal(r.statusCode, 503);
    assert.ok(!r.body.includes('apto con restricciones'));
});

test('ver un documento de salud de otra persona queda registrado; uno común, no', async () => {
    await docClient.send(new PutCommand({ TableName: 'DOCUMENTS_TABLE', Item: { documentId: 'examen-1', tenantId: T, tipo: 'EXAMEN_OCUPACIONAL', asignaciones: [{ personaId: juan.personaId }] } }));
    await docClient.send(new PutCommand({ TableName: 'DOCUMENTS_TABLE', Item: { documentId: 'odi-1', tenantId: T, tipo: 'ODI', asignaciones: [{ personaId: juan.personaId }] } }));
    await documentos.get(evento(medica, 'GET', '/documents/examen-1', { path: { id: 'examen-1' } }));
    await documentos.get(evento(medica, 'GET', '/documents/odi-1', { path: { id: 'odi-1' } }));
    assert.equal(auditoria().length, 1);
    assert.deepEqual(auditoria()[0].documentos, ['examen-1']);
    assert.deepEqual(auditoria()[0].titulares, [juan.personaId]);
});

test('la descarga de un archivo de salud queda registrada con la huella de la clave, no la clave', async () => {
    const uploads = require('../handlers/uploads/handler');
    const clave = `tenants/${T}/documentos/examen-juan-perez.pdf`;
    await docClient.send(new PutCommand({ TableName: 'DOCUMENTS_TABLE', Item: { documentId: 'examen-2', tenantId: T, tipo: 'EXAMEN_OCUPACIONAL', s3Key: clave, asignaciones: [{ personaId: juan.personaId }] } }));
    await uploads.getDownloadUrl(evento(medica, 'POST', '/uploads/download-url', { body: { fileKey: clave } })).catch(() => null);
    const a = auditoria().find((x) => x.tipos.includes('descarga_documento_salud'));
    assert.ok(a, 'hay registro de la descarga');
    assert.deepEqual(a.claves, [huellaClave(clave)]);
    assert.ok(!JSON.stringify(a).includes('juan-perez'), 'el nombre del archivo no queda en la auditoría');
});

test('anotar un acceso fuera de un handler auditado es un error de programación, y se ve', () => {
    assert.throws(() => anotarAccesoSalud({ tipo: 'ficha_salud', titulares: ['x'] }), /fuera de conAuditoriaSalud/);
});

test('ver las respuestas de la ficha de salud queda registrado; una encuesta común, no', async () => {
    const encuestas = require('../handlers/surveys/handler');
    const { idEncuestaSalud } = require('../lib/health/healthSurvey');
    const salud = idEncuestaSalud(T);
    const gestiona = 'personas.ver,encuestas.crear,persona.vigilancia_salud';
    await docClient.send(new PutCommand({ TableName: 'SURVEYS_TABLE', Item: { surveyId: salud, tenantId: T, titulo: 'Ficha', recipients: [{ personaId: juan.personaId, respondedAt: '2026-09-01', responses: [{ p: 1, r: 'sí' }] }, { personaId: pedro.personaId }] } }));
    await docClient.send(new PutCommand({ TableName: 'SURVEYS_TABLE', Item: { surveyId: 'clima-1', tenantId: T, titulo: 'Clima', recipients: [{ personaId: juan.personaId, respondedAt: '2026-09-01', responses: [{ p: 1, r: 'bien' }] }] } }));
    const r = await encuestas.get(evento(medica, 'GET', `/surveys/${salud}`, { path: { id: salud }, permisos: gestiona }));
    assert.equal(r.statusCode, 200, r.body);
    await encuestas.get(evento(medica, 'GET', '/surveys/clima-1', { path: { id: 'clima-1' }, permisos: gestiona }));
    assert.equal(auditoria().length, 1);
    assert.deepEqual(auditoria()[0].tipos, ['respuestas_ficha_salud']);
    assert.deepEqual(auditoria()[0].titulares, [juan.personaId], 'solo quien respondió');
});

test('quien gestiona encuestas sin permiso de vigilancia no recibe respuestas de salud, y no hay registro', async () => {
    const encuestas = require('../handlers/surveys/handler');
    const { idEncuestaSalud } = require('../lib/health/healthSurvey');
    const salud = idEncuestaSalud(T);
    await docClient.send(new PutCommand({ TableName: 'SURVEYS_TABLE', Item: { surveyId: salud, tenantId: T, titulo: 'Ficha', recipients: [{ personaId: juan.personaId, respondedAt: '2026-09-01', responses: [{ p: 1, r: 'sí' }] }] } }));
    const r = await encuestas.get(evento(medica, 'GET', `/surveys/${salud}`, { path: { id: salud }, permisos: 'personas.ver,encuestas.crear' }));
    assert.equal(r.statusCode, 200, r.body);
    assert.equal(JSON.parse(r.body).data.recipients[0].responses, undefined);
    assert.equal(auditoria().length, 0);
});

test('el Registro AT/EP (trae salud de varias personas) queda en la auditoría al verlo', async () => {
    await docClient.send(new PutCommand({ TableName: 'DOCUMENTS_TABLE', Item: { documentId: 'reg-1', tenantId: T, tipo: 'REGISTRO_AT_EP' } }));
    await documentos.get(evento(pedro, 'GET', '/documents/reg-1', { path: { id: 'reg-1' }, permisos: 'personas.ver' }));
    assert.equal(auditoria().length, 1);
    assert.deepEqual(auditoria()[0].documentos, ['reg-1']);
});
