const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

// El servicio habla con DynamoDB; se intercepta el docClient para probar la
// lógica de validación y de cumplimiento documental sin infraestructura.
const enviados = [];
let itemsEnTabla = [];

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
    if (request.endsWith('clients/dynamodb')) {
        return {
            docClient: {
                send: async (cmd) => {
                    enviados.push(cmd);
                    const nombre = cmd.constructor.name;
                    if (nombre === 'QueryCommand') return { Items: itemsEnTabla };
                    if (nombre === 'GetCommand') {
                        const { tenantId, eppId } = cmd.input.Key;
                        return { Item: itemsEnTabla.find((i) => i.tenantId === tenantId && i.eppId === eppId) || null };
                    }
                    if (nombre === 'PutCommand') {
                        itemsEnTabla = itemsEnTabla
                            .filter((i) => i.eppId !== cmd.input.Item.eppId)
                            .concat(cmd.input.Item);
                        return {};
                    }
                    if (nombre === 'DeleteCommand') {
                        itemsEnTabla = itemsEnTabla.filter((i) => i.eppId !== cmd.input.Key.eppId);
                        return {};
                    }
                    return {};
                },
            },
        };
    }
    return originalLoad.apply(this, arguments);
};

const { EppCatalogoService, evaluarCumplimiento } = require('../lib/services/EppCatalogoService');
Module._load = originalLoad;

const service = new EppCatalogoService();
const adjunto = (nombre) => ({ fileKey: `tenants/t1/epp/${nombre}.pdf`, nombre: `${nombre}.pdf`, tipo: 'application/pdf' });

beforeEach(() => { itemsEnTabla = []; enviados.length = 0; });

// ── Cumplimiento documental (DS44 Art. 13) ──
test('un elemento sin respaldos reporta ambos faltantes', () => {
    const r = evaluarCumplimiento({ certificado: null, instructivo: null });
    assert.equal(r.completo, false);
    assert.deepEqual(r.faltantes, ['certificado', 'instructivo']);
});

test('con certificado pero sin instructivo sigue incompleto', () => {
    const r = evaluarCumplimiento({ certificado: adjunto('cert'), instructivo: null });
    assert.equal(r.completo, false);
    assert.deepEqual(r.faltantes, ['instructivo']);
});

test('con ambos respaldos queda completo', () => {
    const r = evaluarCumplimiento({ certificado: adjunto('cert'), instructivo: adjunto('uso') });
    assert.equal(r.completo, true);
    assert.deepEqual(r.faltantes, []);
});

// ── Creación ──
test('crear exige nombre', async () => {
    await assert.rejects(() => service.create('t1', { nombre: '   ' }), /nombre.*obligatorio/i);
});

test('crear sin respaldos se permite, pero marca el incumplimiento', async () => {
    const epp = await service.create('t1', { nombre: 'Casco clase B' });
    assert.equal(epp.nombre, 'Casco clase B');
    assert.equal(epp.completo, false);
    assert.deepEqual(epp.faltantes, ['certificado', 'instructivo']);
    assert.equal(epp.tenantId, 't1');
    assert.ok(epp.eppId);
});

test('el tipo de certificado por defecto es certificado de calidad', async () => {
    const epp = await service.create('t1', { nombre: 'Arnés', certificado: adjunto('cert') });
    assert.equal(epp.certificadoTipo, 'certificado_calidad');
});

test('acepta registro ISP como alternativa al certificado de calidad', async () => {
    const epp = await service.create('t1', {
        nombre: 'Guantes', certificado: adjunto('isp'), certificadoTipo: 'registro_isp',
    });
    assert.equal(epp.certificadoTipo, 'registro_isp');
});

test('rechaza un tipo de certificado desconocido', async () => {
    await assert.rejects(
        () => service.create('t1', { nombre: 'Botas', certificado: adjunto('x'), certificadoTipo: 'inventado' }),
        /tipo de certificado inválido/i,
    );
});

test('sin certificado no se guarda su tipo', async () => {
    const epp = await service.create('t1', { nombre: 'Lentes', certificadoTipo: 'registro_isp' });
    assert.equal(epp.certificadoTipo, null);
});

// ── Aislamiento por tenant ──
test('la lista solo consulta el tenant pedido', async () => {
    await service.create('t1', { nombre: 'Casco' });
    enviados.length = 0;
    await service.list('t1');
    const query = enviados.find((c) => c.constructor.name === 'QueryCommand');
    assert.equal(query.input.ExpressionAttributeValues[':t'], 't1');
    assert.match(query.input.KeyConditionExpression, /tenantId = :t/);
});

test('la lista viene ordenada por nombre', async () => {
    itemsEnTabla = [
        { tenantId: 't1', eppId: '1', nombre: 'Zapatos' },
        { tenantId: 't1', eppId: '2', nombre: 'Arnés' },
        { tenantId: 't1', eppId: '3', nombre: 'Casco' },
    ];
    const lista = await service.list('t1');
    assert.deepEqual(lista.map((e) => e.nombre), ['Arnés', 'Casco', 'Zapatos']);
});

// ── Actualización ──
test('actualizar completa los respaldos faltantes', async () => {
    const creado = await service.create('t1', { nombre: 'Casco' });
    assert.equal(creado.completo, false);
    const actualizado = await service.update('t1', creado.eppId, {
        nombre: 'Casco clase B', certificado: adjunto('cert'), instructivo: adjunto('uso'),
    });
    assert.equal(actualizado.completo, true);
    assert.equal(actualizado.nombre, 'Casco clase B');
    assert.equal(actualizado.createdAt, creado.createdAt, 'createdAt no debe cambiar');
});

test('los derivados no se persisten en la tabla', async () => {
    const creado = await service.create('t1', { nombre: 'Casco' });
    await service.update('t1', creado.eppId, { nombre: 'Casco', certificado: adjunto('c'), instructivo: adjunto('i') });
    const guardado = itemsEnTabla.find((i) => i.eppId === creado.eppId);
    assert.equal('completo' in guardado, false);
    assert.equal('faltantes' in guardado, false);
});

test('actualizar un elemento inexistente falla', async () => {
    await assert.rejects(() => service.update('t1', 'no-existe', { nombre: 'X' }), /no encontrado/i);
});

// ── Borrado ──
test('eliminar quita el elemento del catálogo', async () => {
    const creado = await service.create('t1', { nombre: 'Casco' });
    await service.remove('t1', creado.eppId);
    assert.deepEqual(await service.list('t1'), []);
});

test('eliminar un elemento inexistente falla', async () => {
    await assert.rejects(() => service.remove('t1', 'no-existe'), /no encontrado/i);
});
