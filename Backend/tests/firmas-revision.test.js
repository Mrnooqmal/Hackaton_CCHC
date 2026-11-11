// El listado de firmas en revisión: quién las confirma tiene que poder verlas.
//
// Una firma con vale vencido, o de una persona desvinculada antes de sincronizar,
// entra marcada `requiereRevision` y no cuenta como cumplimiento hasta que
// alguien con `firmas.crear` la confirma. La confirmación existía
// (PUT /signatures/{id}/revision) pero no había dónde verlas.

process.env.CAMPO_HMAC_KEY = 'clave-de-prueba-hmac';
process.env.CAMPO_CIFRADO_LOCAL_KEY = require('crypto').randomBytes(32).toString('base64');

const { prepararEntorno, crearDobleTablas } = require('./doble-dynamo-tablas');
const esquemas = prepararEntorno();

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { PutCommand } = require('@aws-sdk/lib-dynamodb');

const { docClient } = require('../lib/clients/dynamodb');
const firmas = require('../handlers/signatures/handler');

let doble;
const firma = (signatureId, tenantId, extra = {}) => ({
    signatureId, tenantId, personaId: 'p-1', personaNombre: 'Rosa', tipoFirma: 'actividad',
    referenciaId: 'a-1', referenciaTipo: 'activity', estado: 'valida', requiereRevision: false,
    timestamp: '2026-11-08T10:00:00.000Z', ...extra,
});

beforeEach(async () => {
    doble = crearDobleTablas(docClient, esquemas, { proyecciones: true });
    for (const f of [
        firma('s-1', 't-A', { requiereRevision: true, motivoRevision: 'El vale de firma había vencido', offline: { valeExpiraEn: '2026-11-07T22:00:00.000Z' } }),
        firma('s-2', 't-A'),
        firma('s-3', 't-B', { requiereRevision: true }),
        firma('s-4', 't-A', { requiereRevision: true, timestamp: '2026-11-08T12:00:00.000Z' }),
    ]) await docClient.send(new PutCommand({ TableName: 'SIGNATURES_TABLE', Item: f }));
});
afterEach(() => doble.restaurar());

const ev = (ruta, permisos) => ({
    routeKey: `GET ${ruta}`, rawPath: ruta,
    requestContext: {
        http: { method: 'GET', path: ruta },
        authorizer: { lambda: { sessionId: 's', personaId: 'p-sup', tenantId: 't-A', rol: 'supervisor', permisos, credencialProvisional: 'false' } },
    },
    queryStringParameters: {}, headers: {},
});

test('lista solo las firmas en revisión de la empresa de la sesión, la más reciente primero', async () => {
    const res = await firmas.listados(ev('/signatures/revision', 'firmas.crear'));
    assert.equal(res.statusCode, 200, res.body);
    const datos = JSON.parse(res.body).data;
    assert.deepEqual(datos.firmas.map((f) => f.signatureId), ['s-4', 's-1']);
    assert.equal(datos.firmas[1].motivoRevision, 'El vale de firma había vencido');
    assert.equal(datos.firmas[1].offline.valeExpiraEn, '2026-11-07T22:00:00.000Z', 'trae las fechas para juzgarla');
});

test('sin firmas.crear, 403', async () => {
    const res = await firmas.listados(ev('/signatures/revision', 'actividades.ver'));
    assert.equal(res.statusCode, 403);
});

test('la misma función sigue respondiendo las disputas por su ruta', async () => {
    await docClient.send(new PutCommand({ TableName: 'SIGNATURES_TABLE', Item: firma('s-5', 't-A', { estado: 'disputada' }) }));
    const res = await firmas.listados(ev('/signatures/disputes', 'firmas.crear'));
    assert.equal(res.statusCode, 200, res.body);
    assert.deepEqual(JSON.parse(res.body).data.disputas.map((f) => f.signatureId), ['s-5']);
});
