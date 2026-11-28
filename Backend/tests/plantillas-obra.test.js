process.env.CAMPO_HMAC_KEY = 'clave-de-prueba-hmac';
process.env.CAMPO_CIFRADO_LOCAL_KEY = require('crypto').randomBytes(32).toString('base64');

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { docClient } = require('../lib/clients/dynamodb');
const { PersonaService } = require('../lib/services/PersonaService');
const { TenantService } = require('../lib/services/TenantService');
const { eventBus } = require('../lib/events/EventBus');
const { crearDobleS3 } = require('./doble-s3');
const { syncPlantillasObra } = require('../handlers/personas-module/handler');

const originales = {
    listar: PersonaService.prototype.listByTenant,
    tenant: TenantService.prototype.getById,
    send: docClient.send,
    emit: eventBus.emit,
};
let dobleS3;
let creados;
let consultas;
let existentes;

const persona = (personaId, cargo) => ({
    personaId, tenantId: 't1', nombre: personaId, rol: 'trabajador', cargo,
    cargosEnObra: () => [cargo],
});
const obra = (plantillas) => ({ obraId: 'o1', plantillasOnboarding: plantillas });
const conPlantilla = { JORNAL: { PROCEDIMIENTO_TRABAJO: { fileKey: 'tenants/t1/plantillas/p.pdf', nombre: 'p.pdf' } } };

beforeEach(() => {
    dobleS3 = crearDobleS3();
    creados = [];
    consultas = 0;
    existentes = [];
    eventBus.emit = async () => {};
    PersonaService.prototype.listByTenant = async () => [persona('ana', 'JORNAL'), persona('luis', 'CARPINTERO')];
    TenantService.prototype.getById = async () => ({
        tenantId: 't1',
        reglas: { cargos: [{ codigo: 'JORNAL', label: 'Jornal', kit: [
            { key: 'PROCEDIMIENTO_TRABAJO', tipo: 'PROCEDIMIENTO_TRABAJO', titulo: 'Procedimiento', alcancePlantilla: 'obra', accion: 'DIFUSION_FIRMA' },
        ] }] },
    });
    docClient.send = async (cmd) => {
        if (cmd.constructor.name === 'QueryCommand') {
            consultas++;
            const primera = !cmd.input.ExclusiveStartKey;
            return primera ? { Items: [], LastEvaluatedKey: { documentId: 'x' } } : { Items: existentes };
        }
        if (cmd.constructor.name === 'GetCommand') return { Item: { tenantId: 't1' } };
        if (cmd.constructor.name === 'UpdateCommand') return { Attributes: { tenantId: 't1' } };
        if (cmd.constructor.name === 'PutCommand') creados.push(cmd.input.Item);
        return {};
    };
});

afterEach(() => {
    PersonaService.prototype.listByTenant = originales.listar;
    TenantService.prototype.getById = originales.tenant;
    docClient.send = originales.send;
    eventBus.emit = originales.emit;
    dobleS3.restaurar();
});

test('crea el documento solo a quien tiene el cargo de la plantilla', async () => {
    const r = await syncPlantillasObra({ tenantId: 't1', obra: obra(conPlantilla) });
    assert.deepEqual(r, { asignadas: 1, pendientes: 0 });
    assert.deepEqual(creados.map((d) => [d.asignaciones[0].personaId, d.tipo, d.s3Key]),
        [['ana', 'PROCEDIMIENTO_TRABAJO', 'tenants/t1/plantillas/p.pdf']]);
});

test('no duplica un documento que está en la segunda página del listado', async () => {
    existentes = [{ documentId: 'd', obraId: 'o1', clasificacion: 'diario', tipo: 'PROCEDIMIENTO_TRABAJO', asignaciones: [{ personaId: 'ana' }] }];
    await syncPlantillasObra({ tenantId: 't1', obra: obra(conPlantilla) });
    assert.equal(creados.length, 0);
    assert.equal(consultas, 2);
});

test('una persona que falla queda informada como pendiente', async () => {
    const base = docClient.send;
    docClient.send = async (cmd) => {
        if (cmd.constructor.name === 'PutCommand') throw new Error('sin capacidad');
        return base(cmd);
    };
    assert.deepEqual(await syncPlantillasObra({ tenantId: 't1', obra: obra(conPlantilla) }), { asignadas: 0, pendientes: 1 });
});

test('sin plantillas con archivo no se recorre a nadie', async () => {
    await syncPlantillasObra({ tenantId: 't1', obra: obra({ JORNAL: {} }) });
    assert.equal(consultas, 0);
});
