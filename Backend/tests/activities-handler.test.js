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
    // Con firmas registradas se intenta colar contenido (titulo) y firmas: el
    // handler debe ignorarlos y escribir solo el registro post-charla.
    await handler.patch(ev({ pathParameters: { id: 'a-1' }, body: JSON.stringify({
        solicitanteId: 'p-1', planificacion: { observaciones: 'acta' },
        titulo: 'hackeado', asistentes: [], firmaRelator: null,
    }) }));
    assert.equal(store.updates.length, 1);
    // El UpdateExpression es dinámico (#fN = :vN): se valida por los NOMBRES de
    // atributo realmente escritos, no por la forma literal de la expresión.
    const campos = Object.values(store.updates[0].ExpressionAttributeNames || {});
    assert.deepEqual([...campos].sort(), ['permisosTrabajo', 'planificacion', 'updatedAt']);
    assert.ok(!campos.includes('asistentes'));
    assert.ok(!campos.includes('firmaRelator'));
    assert.ok(!campos.includes('titulo')); // contenido congelado con firmas
});

test('PATCH 400 si la planificación trae un código de catálogo desconocido', async () => {
    store.activity = { activityId: 'a-1', tenantId: 't-1', tipo: 'CHARLA_5MIN', relatorId: 'p-1' };
    store.personas['p-1'] = persona({ personaId: 'p-1', tenantId: 't-1' });
    const res = await handler.patch(ev({ pathParameters: { id: 'a-1' }, body: JSON.stringify({ solicitanteId: 'p-1', planificacion: { tema: { codigo: 'NO_EXISTE' } } }) }));
    assert.equal(res.statusCode, 400);
    assert.match(JSON.parse(res.body).error || JSON.parse(res.body).message || '', /NO_EXISTE|desconocido/i);
    assert.equal(store.updates.length, 0);
});

// ── PATCH: reasignación de relator (reemplazo del responsable planificado) ──

test('PATCH reasigna el relator y conserva a quién lo asignaba el plan', async () => {
    store.activity = {
        activityId: 'a-1', tenantId: 't-1', tipo: 'CHARLA_5MIN', estado: 'borrador',
        origen: 'planificacion', relatorId: 'p-sup', responsables: ['p-sup'], asistentes: [],
    };
    store.personas['p-adm'] = persona({ personaId: 'p-adm', tenantId: 't-1', rol: 'admin' });
    store.personas['p-nuevo'] = persona({ personaId: 'p-nuevo', tenantId: 't-1', rol: 'supervisor' });

    const res = await handler.patch(ev({ pathParameters: { id: 'a-1' }, body: JSON.stringify({
        solicitanteId: 'p-adm', relatorId: 'p-nuevo',
    }) }));

    assert.equal(res.statusCode, 200);
    const escrito = {};
    const u = store.updates[0];
    Object.entries(u.ExpressionAttributeNames).forEach(([alias, campo]) => {
        escrito[campo] = u.ExpressionAttributeValues[alias.replace('#f', ':v')];
    });
    assert.equal(escrito.relatorId, 'p-nuevo');
    // responsables[0] sigue siendo el relator; el saliente deja de ser responsable.
    assert.deepEqual(escrito.responsables, ['p-nuevo']);
    // Trazabilidad: queda constancia del responsable original del plan.
    assert.equal(escrito.relatorPlanificadoId, 'p-sup');
});

test('PATCH 409 al reasignar el relator si la actividad ya tiene firmas', async () => {
    store.activity = {
        activityId: 'a-1', tenantId: 't-1', tipo: 'CHARLA_5MIN', estado: 'programada',
        origen: 'planificacion', relatorId: 'p-sup', responsables: ['p-sup'],
        asistentes: [{ personaId: 'p-x' }],
    };
    store.personas['p-adm'] = persona({ personaId: 'p-adm', tenantId: 't-1', rol: 'admin' });
    store.personas['p-nuevo'] = persona({ personaId: 'p-nuevo', tenantId: 't-1', rol: 'supervisor' });

    const res = await handler.patch(ev({ pathParameters: { id: 'a-1' }, body: JSON.stringify({
        solicitanteId: 'p-adm', relatorId: 'p-nuevo',
    }) }));

    assert.equal(res.statusCode, 409);
    assert.equal(store.updates.length, 0);
});

test('PATCH rechaza un relator de otra empresa', async () => {
    store.activity = {
        activityId: 'a-1', tenantId: 't-1', tipo: 'CHARLA_5MIN', estado: 'borrador',
        origen: 'planificacion', relatorId: 'p-sup', responsables: ['p-sup'], asistentes: [],
    };
    store.personas['p-adm'] = persona({ personaId: 'p-adm', tenantId: 't-1', rol: 'admin' });
    store.personas['p-ajeno'] = persona({ personaId: 'p-ajeno', tenantId: 't-OTRO', rol: 'supervisor' });

    const res = await handler.patch(ev({ pathParameters: { id: 'a-1' }, body: JSON.stringify({
        solicitanteId: 'p-adm', relatorId: 'p-ajeno',
    }) }));

    assert.equal(res.statusCode, 400);
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

// ── CREATE: configuración de la evaluación de aprendizaje ──

test('CREATE deja la evaluación no exigida si no se pide', async () => {
    store.tenant = null;
    const res = await handler.create(ev({ body: JSON.stringify({
        tenantId: 't-1', tipo: 'CAPACITACION', subtipo: 'EPP', titulo: 'Uso de EPP', relatorId: 'p-1',
    }) }));
    assert.equal(res.statusCode, 201);
    assert.deepEqual(store.puts[0].Item.evaluacion, { exigida: false, notaMinima: null, escala: 'porcentaje', respaldo: null });
});

test('CREATE acepta la nota mínima del kit (70/90) y nace sin respaldo', async () => {
    store.tenant = null;
    const res = await handler.create(ev({ body: JSON.stringify({
        tenantId: 't-1', tipo: 'CAPACITACION', subtipo: 'PRL_8H', titulo: 'PRL 8h', relatorId: 'p-1',
        evaluacion: { exigida: true, notaMinima: 90 },
    }) }));
    assert.equal(res.statusCode, 201);
    assert.equal(store.puts[0].Item.evaluacion.notaMinima, 90);
    // El respaldo se sube después de dictada la capacitación, no al crearla.
    assert.equal(store.puts[0].Item.evaluacion.respaldo, null);
});

test('CREATE ignora un respaldo enviado al crear', async () => {
    store.tenant = null;
    await handler.create(ev({ body: JSON.stringify({
        tenantId: 't-1', tipo: 'CAPACITACION', titulo: 'Cap', relatorId: 'p-1',
        evaluacion: { exigida: true, notaMinima: 70, respaldo: { fileKey: 'x/y.pdf' } },
    }) }));
    assert.equal(store.puts[0].Item.evaluacion.respaldo, null);
});

test('CREATE 400 si la nota mínima no es una de las del catálogo de cargos', async () => {
    store.tenant = null;
    const res = await handler.create(ev({ body: JSON.stringify({
        tenantId: 't-1', tipo: 'CAPACITACION', titulo: 'Cap', relatorId: 'p-1',
        evaluacion: { exigida: true, notaMinima: 55 },
    }) }));
    assert.equal(res.statusCode, 400);
    assert.equal(store.puts.length, 0);
});

test('CREATE ignora la evaluación en una actividad que no es CAPACITACION', async () => {
    store.tenant = null;
    const res = await handler.create(ev({ body: JSON.stringify({
        tenantId: 't-1', tipo: 'CHARLA_5MIN', titulo: 'Charla', relatorId: 'p-1',
        planificacion: { tema: { codigo: 'FRAGUADO' } },
        evaluacion: { exigida: true, notaMinima: 70 },
    }) }));
    assert.equal(res.statusCode, 201);
    assert.equal(store.puts[0].Item.evaluacion, null);
});

// ── PATCH: respaldo documental de la evaluación ──

const capacitacion = (over = {}) => ({
    activityId: 'a-1', tenantId: 't-1', tipo: 'CAPACITACION', subtipo: 'EPP',
    estado: 'programada', relatorId: 'p-rel', responsables: ['p-rel'],
    evaluacion: { exigida: true, notaMinima: 70, escala: 'porcentaje', respaldo: null },
    asistentes: [{ personaId: 'p-t1', nombre: 'Ana' }],
    ...over,
});

const respaldo = { fileKey: 'tenants/t-1/actividades/a-1/evaluaciones.pdf', nombre: 'Evaluaciones EPP.pdf', tipo: 'application/pdf', tamano: 12345 };

const campoEscrito = (campo) => {
    const u = store.updates[0];
    const alias = Object.entries(u.ExpressionAttributeNames).find(([, c]) => c === campo)?.[0];
    return alias ? u.ExpressionAttributeValues[alias.replace('#f', ':v')] : undefined;
};

test('PATCH adjunta el respaldo y deja constancia de quién lo subió', async () => {
    store.activity = capacitacion();
    store.personas['p-rel'] = persona({ personaId: 'p-rel', tenantId: 't-1' });
    const res = await handler.patch(ev({ pathParameters: { id: 'a-1' }, body: JSON.stringify({
        solicitanteId: 'p-rel', evaluacion: { exigida: true, notaMinima: 70, respaldo },
    }) }));
    assert.equal(res.statusCode, 200);
    const guardada = campoEscrito('evaluacion');
    assert.equal(guardada.respaldo.fileKey, respaldo.fileKey);
    assert.equal(guardada.respaldo.subidoPor, 'p-rel');
    assert.ok(guardada.respaldo.subidoEn);
});

test('PATCH admite el respaldo aunque la actividad esté cerrada y con firmas', async () => {
    // La capacitación se corrige fuera del sistema: el documento llega días después.
    store.activity = capacitacion({ estado: 'completada', firmaRelator: { token: 'z' } });
    store.personas['p-rel'] = persona({ personaId: 'p-rel', tenantId: 't-1' });
    const res = await handler.patch(ev({ pathParameters: { id: 'a-1' }, body: JSON.stringify({
        solicitanteId: 'p-rel', evaluacion: { exigida: true, notaMinima: 70, respaldo },
    }) }));
    assert.equal(res.statusCode, 200);
    assert.equal(campoEscrito('evaluacion').respaldo.fileKey, respaldo.fileKey);
});

test('PATCH conserva el respaldo si solo se edita la exigencia', async () => {
    store.activity = capacitacion({ evaluacion: { exigida: true, notaMinima: 70, escala: 'porcentaje', respaldo: { ...respaldo, subidoPor: 'p-otro', subidoEn: '2026-01-01T00:00:00.000Z' } } });
    store.personas['p-rel'] = persona({ personaId: 'p-rel', tenantId: 't-1' });
    const res = await handler.patch(ev({ pathParameters: { id: 'a-1' }, body: JSON.stringify({
        solicitanteId: 'p-rel', evaluacion: { exigida: true, notaMinima: 90 },
    }) }));
    assert.equal(res.statusCode, 200);
    const guardada = campoEscrito('evaluacion');
    assert.equal(guardada.notaMinima, 90);
    assert.equal(guardada.respaldo.fileKey, respaldo.fileKey);   // no se perdió
    assert.equal(guardada.respaldo.subidoPor, 'p-otro');          // ni su autoría
});

test('PATCH 409 al desactivar la evaluación con un respaldo cargado', async () => {
    store.activity = capacitacion({ evaluacion: { exigida: true, notaMinima: 70, escala: 'porcentaje', respaldo } });
    store.personas['p-rel'] = persona({ personaId: 'p-rel', tenantId: 't-1' });
    const res = await handler.patch(ev({ pathParameters: { id: 'a-1' }, body: JSON.stringify({
        solicitanteId: 'p-rel', evaluacion: { exigida: false },
    }) }));
    assert.equal(res.statusCode, 409);
    assert.equal(store.updates.length, 0);
});

test('PATCH 400 si el respaldo viene sin fileKey', async () => {
    store.activity = capacitacion();
    store.personas['p-rel'] = persona({ personaId: 'p-rel', tenantId: 't-1' });
    const res = await handler.patch(ev({ pathParameters: { id: 'a-1' }, body: JSON.stringify({
        solicitanteId: 'p-rel', evaluacion: { exigida: true, notaMinima: 70, respaldo: { nombre: 'sin key' } },
    }) }));
    assert.equal(res.statusCode, 400);
    assert.equal(store.updates.length, 0);
});

test('PATCH 400 si se manda evaluación a una actividad que no es CAPACITACION', async () => {
    store.activity = capacitacion({ tipo: 'CHARLA_5MIN', evaluacion: null });
    store.personas['p-rel'] = persona({ personaId: 'p-rel', tenantId: 't-1' });
    const res = await handler.patch(ev({ pathParameters: { id: 'a-1' }, body: JSON.stringify({
        solicitanteId: 'p-rel', evaluacion: { exigida: true, notaMinima: 70 },
    }) }));
    assert.equal(res.statusCode, 400);
});

test('PATCH quitar el respaldo lo deja en null sin tocar la exigencia', async () => {
    store.activity = capacitacion({ evaluacion: { exigida: true, notaMinima: 70, escala: 'porcentaje', respaldo } });
    store.personas['p-rel'] = persona({ personaId: 'p-rel', tenantId: 't-1' });
    const res = await handler.patch(ev({ pathParameters: { id: 'a-1' }, body: JSON.stringify({
        solicitanteId: 'p-rel', evaluacion: { exigida: true, notaMinima: 70, respaldo: null },
    }) }));
    assert.equal(res.statusCode, 200);
    const guardada = campoEscrito('evaluacion');
    assert.equal(guardada.respaldo, null);
    assert.equal(guardada.exigida, true);
});

test('PATCH no toca asistentes ni firmas al adjuntar el respaldo', async () => {
    store.activity = capacitacion({ firmaRelator: { token: 'z' } });
    store.personas['p-rel'] = persona({ personaId: 'p-rel', tenantId: 't-1' });
    await handler.patch(ev({ pathParameters: { id: 'a-1' }, body: JSON.stringify({
        solicitanteId: 'p-rel', evaluacion: { exigida: true, notaMinima: 70, respaldo },
        asistentes: [], firmaRelator: null,
    }) }));
    const campos = Object.values(store.updates[0].ExpressionAttributeNames || {});
    assert.deepEqual([...campos].sort(), ['evaluacion', 'updatedAt']);
});
