const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { docClient } = require('../lib/clients/dynamodb');

// Tests de integración del handler de actividades. Se mockea docClient.send
// (compartido por el handler y por PersonaService/TenantService) para ejercitar
// la autorización del PATCH, la intangibilidad de las firmas y la validación
// del create sin tocar DynamoDB real.
const handler = require('../handlers/activities/handler');

// Estado configurable por test + captura de escrituras.
let store;
let originalSend;

const ev = (over = {}) => ({ pathParameters: {}, queryStringParameters: {}, body: '{}', requestContext: {}, headers: {}, ...over });

beforeEach(() => {
    store = {
        activity: null,        // Item que devuelve el GET de Activities
        personas: {},          // personaId -> item de persona
        tenant: null,          // Item de tenant (getById)
        updates: [],           // UpdateCommand capturados
        puts: [],              // PutCommand capturados
    };
    originalSend = docClient.send;
    docClient.send = async (cmd) => {
        const name = cmd.constructor.name;
        const input = cmd.input || {};
        if (name === 'GetCommand' && input.Key && input.Key.activityId !== undefined) {
            return { Item: store.activity };
        }
        if (name === 'GetCommand' && input.Key && String(input.Key.PK || '').startsWith('TENANT#')) {
            return { Item: store.tenant };
        }
        if (name === 'QueryCommand' && input.IndexName === 'personaId-index') {
            const pid = input.ExpressionAttributeValues[':personaId'];
            const item = store.personas[pid];
            return { Items: item ? [item] : [] };
        }
        if (name === 'UpdateCommand') { store.updates.push(input); return {}; }
        if (name === 'PutCommand') { store.puts.push(input); return {}; }
        // Cualquier otra query (list por tenantId-index, etc.) sin resultados.
        return { Items: [] };
    };
});

afterEach(() => { docClient.send = originalSend; });

const persona = (over = {}) => ({ personaId: 'p-1', tenantId: 't-1', rol: 'trabajador', nombre: 'Ana', apellidoPaterno: 'Soto', ...over });

// ── PATCH: autorización ──

test('PATCH 404 si la actividad no existe', async () => {
    store.activity = null;
    const res = await handler.patch(ev({ pathParameters: { id: 'a-x' }, body: JSON.stringify({ solicitanteId: 'p-1' }) }));
    assert.equal(res.statusCode, 404);
});

test('PATCH 400 si falta solicitanteId', async () => {
    store.activity = { activityId: 'a-1', tenantId: 't-1', tipo: 'CHARLA_5MIN', relatorId: 'p-9' };
    const res = await handler.patch(ev({ pathParameters: { id: 'a-1' }, body: '{}' }));
    assert.equal(res.statusCode, 400);
});

test('PATCH 403 si el solicitante es de otro tenant', async () => {
    store.activity = { activityId: 'a-1', tenantId: 't-1', tipo: 'CHARLA_5MIN', relatorId: 'p-9' };
    store.personas['p-2'] = persona({ personaId: 'p-2', tenantId: 't-OTRO', rol: 'admin' });
    const res = await handler.patch(ev({ pathParameters: { id: 'a-1' }, body: JSON.stringify({ solicitanteId: 'p-2' }) }));
    assert.equal(res.statusCode, 403);
});

test('PATCH 403 si no es relator ni tiene permiso de crear actividades', async () => {
    store.activity = { activityId: 'a-1', tenantId: 't-1', tipo: 'CHARLA_5MIN', relatorId: 'p-9' };
    store.personas['p-2'] = persona({ personaId: 'p-2', tenantId: 't-1', rol: 'trabajador' });
    store.tenant = null; // tenant sin roles personalizados → trabajador no puede
    const res = await handler.patch(ev({ pathParameters: { id: 'a-1' }, body: JSON.stringify({ solicitanteId: 'p-2' }) }));
    assert.equal(res.statusCode, 403);
});

test('PATCH lo permite el relator de la actividad', async () => {
    store.activity = { activityId: 'a-1', tenantId: 't-1', tipo: 'REUNION_COMITE', relatorId: 'p-1', asistentes: [{ personaId: 'x' }] };
    store.personas['p-1'] = persona({ personaId: 'p-1', tenantId: 't-1', rol: 'trabajador' });
    const res = await handler.patch(ev({ pathParameters: { id: 'a-1' }, body: JSON.stringify({ solicitanteId: 'p-1', planificacion: { observaciones: 'acta' } }) }));
    assert.equal(res.statusCode, 200);
});

test('PATCH lo permite un admin aunque no sea el relator', async () => {
    store.activity = { activityId: 'a-1', tenantId: 't-1', tipo: 'REUNION_COMITE', relatorId: 'p-9' };
    store.personas['p-adm'] = persona({ personaId: 'p-adm', tenantId: 't-1', rol: 'admin' });
    const res = await handler.patch(ev({ pathParameters: { id: 'a-1' }, body: JSON.stringify({ solicitanteId: 'p-adm', planificacion: { observaciones: 'ok' } }) }));
    assert.equal(res.statusCode, 200);
});

// ── PATCH: intangibilidad de firmas / auditoría ──

test('PATCH solo escribe planificacion, permisosTrabajo y updatedAt (nunca asistentes/firmas)', async () => {
    store.activity = { activityId: 'a-1', tenantId: 't-1', tipo: 'REUNION_COMITE', relatorId: 'p-1', asistentes: [{ personaId: 'x' }], firmaRelator: { token: 'z' } };
    store.personas['p-1'] = persona({ personaId: 'p-1', tenantId: 't-1' });
    await handler.patch(ev({ pathParameters: { id: 'a-1' }, body: JSON.stringify({ solicitanteId: 'p-1', planificacion: { observaciones: 'acta' } }) }));
    assert.equal(store.updates.length, 1);
    const expr = store.updates[0].UpdateExpression;
    assert.match(expr, /SET planificacion = :p, permisosTrabajo = :pt, updatedAt = :u/);
    assert.doesNotMatch(expr, /asistentes/);
    assert.doesNotMatch(expr, /firmaRelator/);
    // Los valores escritos no incluyen asistentes ni firmas.
    const vals = store.updates[0].ExpressionAttributeValues;
    assert.deepEqual(Object.keys(vals).sort(), [':p', ':pt', ':u']);
});

test('PATCH 400 si la planificación trae un código de catálogo desconocido', async () => {
    store.activity = { activityId: 'a-1', tenantId: 't-1', tipo: 'CHARLA_5MIN', relatorId: 'p-1' };
    store.personas['p-1'] = persona({ personaId: 'p-1', tenantId: 't-1' });
    const res = await handler.patch(ev({ pathParameters: { id: 'a-1' }, body: JSON.stringify({ solicitanteId: 'p-1', planificacion: { tema: { codigo: 'NO_EXISTE' } } }) }));
    assert.equal(res.statusCode, 400);
    assert.match(JSON.parse(res.body).error || JSON.parse(res.body).message || '', /NO_EXISTE|desconocido/i);
    assert.equal(store.updates.length, 0);
});

// ── CREATE: validación del bloque de planificación ──

test('CREATE 400 si una CHARLA_5MIN no trae tema tratado', async () => {
    store.tenant = null; // usa catálogos de fábrica
    const res = await handler.create(ev({ body: JSON.stringify({ tenantId: 't-1', tipo: 'CHARLA_5MIN', titulo: 'Charla', relatorId: 'p-1' }) }));
    assert.equal(res.statusCode, 400);
    assert.match(JSON.parse(res.body).error || JSON.parse(res.body).message || '', /tema/i);
    assert.equal(store.puts.length, 0);
});

test('CREATE guarda la planificación cuando es válida', async () => {
    store.tenant = null;
    const res = await handler.create(ev({ body: JSON.stringify({
        tenantId: 't-1', tipo: 'CHARLA_5MIN', titulo: 'Charla', relatorId: 'p-1',
        planificacion: { tema: { codigo: 'FRAGUADO' }, observaciones: 'ok' },
    }) }));
    assert.equal(res.statusCode, 201);
    assert.equal(store.puts.length, 1);
    assert.equal(store.puts[0].Item.planificacion.tema.codigo, 'FRAGUADO');
    assert.deepEqual(store.puts[0].Item.permisosTrabajo, []);
});
