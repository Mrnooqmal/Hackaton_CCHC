// Avisos del EventBus durables (D-25): con cola, emitir encola y el trabajador
// escribe; si un aviso falla se reintenta sin duplicar lo que ya llegó, y la
// constancia de difusión queda una sola vez por evento.

process.env.CAMPO_HMAC_KEY = 'clave-de-prueba-hmac';
process.env.CAMPO_CIFRADO_LOCAL_KEY = require('crypto').randomBytes(32).toString('base64');

const { prepararEntorno, crearDobleTablas } = require('./doble-dynamo-tablas');
const esquemas = prepararEntorno();

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { PutCommand } = require('@aws-sdk/lib-dynamodb');

const { docClient } = require('../lib/clients/dynamodb');
const { eventBus } = require('../lib/events/EventBus');
const { crearDobleCola } = require('./doble-cola');

let doble;
let cola;
beforeEach(() => { doble = crearDobleTablas(docClient, esquemas); cola = crearDobleCola(); });
afterEach(() => { cola.restaurar(); doble.restaurar(); });

const bandeja = () => doble.items('INBOX_TABLE');
const asignar = (ids) => eventBus.emit('document.assigned', { documentId: 'd-1', personaIds: ids, assignedBy: 'p-0', documentName: 'ODI' });
/** Las próximas `n` escrituras en la bandeja para `destinatario` fallan. */
const fallarBandeja = (n, destinatario) => {
    const enviar = docClient.send;
    let quedan = n;
    docClient.send = async (cmd) => {
        if (quedan > 0 && cmd.input?.TableName === 'INBOX_TABLE' && cmd.input.Item?.recipientId === destinatario) {
            quedan--; throw Object.assign(new Error('DynamoDB no disponible'), { name: 'InternalServerError' });
        }
        return enviar.call(docClient, cmd);
    };
    return () => { docClient.send = enviar; };
};

test('con cola, emitir no escribe en la petición: encola, y el trabajador deja los avisos', async () => {
    await asignar(['p-1', 'p-2']);
    assert.equal(bandeja().length, 0);
    assert.equal(cola.colas.eventos.length, 1);
    await cola.drenar();
    assert.deepEqual(bandeja().map((m) => m.recipientId).sort(), ['p-1', 'p-2']);
});

test('si un aviso falla a mitad de camino, se reintenta y completa sin duplicar a quien ya lo recibió', async () => {
    await asignar(['p-1', 'p-2', 'p-3']);
    const restaurar = fallarBandeja(2, 'p-2');
    await cola.drenar();
    restaurar();
    const porDestinatario = bandeja().reduce((a, m) => ({ ...a, [m.recipientId]: (a[m.recipientId] || 0) + 1 }), {});
    assert.deepEqual(porDestinatario, { 'p-1': 1, 'p-2': 1, 'p-3': 1 });
    assert.equal(cola.colas.fallidos.length, 0);
});

test('un aviso que falla seis veces termina en la cola de fallidos (con alarma), no se pierde en silencio', async () => {
    await asignar(['p-1']);
    const restaurar = fallarBandeja(99, 'p-1');
    await cola.drenar();
    restaurar();
    assert.equal(cola.colas.fallidos.length, 1);
    assert.equal(JSON.parse(cola.colas.fallidos[0].body).evento, 'document.assigned');
});

test('si no se pueden leer los destinatarios, el evento falla y se reintenta: no se da por avisado a nadie', async () => {
    const { PersonaService } = require('../lib/services/PersonaService');
    const { TenantService } = require('../lib/services/TenantService');
    const E = (await new TenantService().setup({ nombre: 'Constructora Avisos', rutEmpresa: '76.543.210-3' })).tenantId;
    const prev = (await new PersonaService().crear(E, { rut: '11.111.111-1', nombre: 'Marta', rol: 'prevencionista', email: 'm@ejemplo.cl', password: 'clave-larga-1' })).persona;
    await docClient.send(new PutCommand({ TableName: 'DOCUMENTS_TABLE', Item: { documentId: 'd-9', tenantId: E } }));
    await eventBus.emit('document.version.updated', { documentId: 'd-9', tenantId: E, documentName: 'Procedimiento', version: 2, motivo: 'x', publicadaPor: 'p-0', firmanteIds: ['p-5'] });
    const original = eventBus.personaService.listByTenant;
    let fallos = 1;
    eventBus.personaService.listByTenant = async (...a) => { if (fallos-- > 0) throw new Error('lectura caída'); return original.apply(eventBus.personaService, a); };
    await cola.drenar();
    eventBus.personaService.listByTenant = original;
    const doc = doble.items('DOCUMENTS_TABLE').find((d) => d.documentId === 'd-9');
    assert.equal(doc.difusiones.length, 1, 'la constancia quedó, en el reintento');
    assert.deepEqual(doc.difusiones[0].destinatarios.mando, [prev.personaId], 'con la línea de mando real, no vacía');
    assert.ok(bandeja().some((m) => m.recipientId === prev.personaId));
    assert.ok(bandeja().some((m) => m.recipientId === 'p-5'));
});

test('la constancia de difusión queda una sola vez aunque el evento se entregue dos veces', async () => {
    await docClient.send(new PutCommand({ TableName: 'DOCUMENTS_TABLE', Item: { documentId: 'd-8', tenantId: 't-1' } }));
    await eventBus.emit('document.version.updated', { documentId: 'd-8', tenantId: 't-1', documentName: 'P', version: 3, motivo: 'y', publicadaPor: 'p-0', firmanteIds: ['p-5'] });
    cola.colas.eventos.push({ ...cola.colas.eventos[0], messageId: 'dup' });
    await cola.drenar();
    const doc = doble.items('DOCUMENTS_TABLE').find((d) => d.documentId === 'd-8');
    assert.equal(doc.difusiones.length, 1);
    assert.equal(bandeja().filter((m) => m.recipientId === 'p-5').length, 1);
});

test('si no se puede encolar, se despacha en la petición: el aviso llega igual', async () => {
    cola.fallarProximosEnvios(1);
    await asignar(['p-1']);
    assert.equal(bandeja().length, 1);
});

test('sin cola (local y pruebas), un suscriptor que falla no tumba la operación', async () => {
    cola.restaurar();
    const restaurar = fallarBandeja(1, 'p-1');
    await assert.doesNotReject(asignar(['p-1']));
    restaurar();
});

test('si no se pueden leer los representantes, el evento falla y se reintenta: el comité recibe el aviso', async () => {
    await docClient.send(new PutCommand({ TableName: 'DOCUMENTS_TABLE', Item: { documentId: 'd-7', tenantId: 't-2' } }));
    await eventBus.emit('document.version.updated', { documentId: 'd-7', tenantId: 't-2', documentName: 'MIPER', version: 2, motivo: 'z', publicadaPor: 'p-0', firmanteIds: [] });
    const svc = eventBus.estructuraService;
    const originales = { listar: svc.listarOrganos, obtener: svc.getOrgano };
    let fallos = 1;
    svc.listarOrganos = async () => {
        if (fallos-- > 0) throw new Error('estructura no disponible');
        return [{ organoId: 'cphs-1', ambito: 'empresa', tipo: 'comite_paritario' }];
    };
    svc.getOrgano = async () => ({ organoId: 'cphs-1', miembros: [{ personaId: 'rep-1', estado: 'activo' }] });
    try {
        await cola.drenar();
    } finally {
        svc.listarOrganos = originales.listar;
        svc.getOrgano = originales.obtener;
    }
    const doc = doble.items('DOCUMENTS_TABLE').find((d) => d.documentId === 'd-7');
    assert.equal(doc.difusiones.length, 1);
    assert.deepEqual(doc.difusiones[0].destinatarios.representantes, ['rep-1'], 'con los representantes reales, no vacíos');
    assert.ok(bandeja().some((m) => m.recipientId === 'rep-1'));
});
