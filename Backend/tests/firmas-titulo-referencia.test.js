// El historial de firmas de una persona dice qué se firmó.
//
// Las firmas de documentos, actividades y encuestas (`FirmaService.crear`)
// guardan solo `referenciaId`: la ficha de la persona mostraba un guion en vez
// del título. `GET /signatures/worker/{id}` lo resuelve al listar.

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
const poner = (TableName, Item) => docClient.send(new PutCommand({ TableName, Item }));

beforeEach(async () => {
    doble = crearDobleTablas(docClient, esquemas, { proyecciones: true });
    await poner('DOCUMENTS_TABLE', { documentId: 'd-1', tenantId: 't-A', titulo: 'Reglamento interno' });
    await poner('DOCUMENTS_TABLE', { documentId: 'd-2', tenantId: 't-B', titulo: 'De otra empresa' });
    await poner('ACTIVITIES_TABLE', { activityId: 'a-1', tenantId: 't-A', titulo: 'Charla de altura' });
    const base = { tenantId: 't-A', personaId: 'p-1', estado: 'valida', timestamp: '2026-10-04T10:00:00.000Z' };
    await poner('SIGNATURES_TABLE', { ...base, signatureId: 's-doc', tipoFirma: 'documento', referenciaId: 'd-1', referenciaTipo: 'document' });
    await poner('SIGNATURES_TABLE', { ...base, signatureId: 's-act', tipoFirma: 'actividad', referenciaId: 'a-1', referenciaTipo: 'activity' });
    await poner('SIGNATURES_TABLE', { ...base, signatureId: 's-ajena', tipoFirma: 'documento', referenciaId: 'd-2', referenciaTipo: 'document' });
    await poner('SIGNATURES_TABLE', { ...base, signatureId: 's-req', requestTitulo: 'Procedimientos (v2)', referenciaId: 'd-1', referenciaTipo: 'document' });
});
afterEach(() => doble.restaurar());

const ev = {
    pathParameters: { workerId: 'p-1' },
    requestContext: {
        http: { method: 'GET', path: '/signatures/worker/p-1' },
        authorizer: { lambda: { sessionId: 's', personaId: 'p-1', tenantId: 't-A', rol: 'trabajador', permisos: '', credencialProvisional: 'false' } },
    },
    headers: {},
};

test('cada firma trae el título de lo que se firmó, solo de la propia empresa', async () => {
    const res = await firmas.getByWorker(ev);
    assert.equal(res.statusCode, 200, res.body);
    const porId = Object.fromEntries(JSON.parse(res.body).data.firmas.map((f) => [f.signatureId, f]));
    assert.equal(porId['s-doc'].referenciaTitulo, 'Reglamento interno');
    assert.equal(porId['s-act'].referenciaTitulo, 'Charla de altura');
    assert.equal(porId['s-ajena'].referenciaTitulo, undefined, 'no filtra títulos de otra empresa');
    assert.equal(porId['s-req'].referenciaTitulo, undefined, 'la de solicitud ya trae el suyo');
});
