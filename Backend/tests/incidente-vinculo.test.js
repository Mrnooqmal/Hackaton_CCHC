// Un incidente se vincula a la persona afectada por el HMAC de su RUT, y ningún RUT queda en claro.
//
// Sin el vínculo, la retención y la supresión (lib/gobernanza) no encontraban los
// incidentes de una persona sin descifrarlos todos. Y `realizadoPor.rut`, que
// mandaba el navegador, quedaba en claro en la tabla (H-14).

process.env.CAMPO_HMAC_KEY = 'clave-de-prueba-hmac';
process.env.CAMPO_CIFRADO_LOCAL_KEY = require('crypto').randomBytes(32).toString('base64');

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const { docClient } = require('../lib/clients/dynamodb');
const { IncidentsRepository } = require('../handlers/incidents-module/incidents.repository');
const { hmacRut } = require('../lib/cifradoCampo');

const RUT = '12.345.678-5';
let escritos;
let original;
let originalLog;
beforeEach(() => {
    escritos = [];
    original = docClient.send;
    originalLog = console.log;
    console.log = () => {};
    docClient.send = async (cmd) => { if (cmd.constructor.name === 'PutCommand') escritos.push(cmd.input.Item); return {}; };
});
afterEach(() => { docClient.send = original; console.log = originalLog; });

const crear = (datos) => {
    const repo = new IncidentsRepository();
    repo.dynamo = { send: docClient.send };
    return repo.create({ tipo: 'accidente', descripcion: 'Caída', tenantId: 't1', obraId: 'o1', ...datos }, {});
};
const incidente = () => escritos.find((x) => !String(x.incidentId).endsWith('#traza'));

test('guarda el HMAC del RUT de la persona afectada, el mismo con que se busca su ficha', async () => {
    await crear({ trabajador: { nombre: 'Ana', rut: '12345678-5' } });
    assert.equal(incidente().afectadoRutHmac, await hmacRut(RUT), 'el formato del RUT no importa: se normaliza');
});

test('sin RUT válido, no hay vínculo (y no se inventa uno)', async () => {
    await crear({ trabajador: { nombre: 'Ana', rut: 'no-es-rut' } });
    assert.equal(incidente().afectadoRutHmac, null);
});

test('ningún RUT queda en claro en el incidente listado, aunque el navegador mande el de quien reporta', async () => {
    await crear({ trabajador: { nombre: 'Ana', rut: RUT }, realizadoPor: { personaId: 'p1', nombre: 'Luis', rut: '9.876.543-3', cargo: 'Supervisor' } });
    const it = incidente();
    assert.deepEqual(it.realizadoPor, { personaId: 'p1', nombre: 'Luis', cargo: 'Supervisor' });
    const texto = JSON.stringify(it);
    assert.ok(!texto.includes('9.876.543-3') && !texto.includes('98765433'));
    assert.ok(!texto.includes(RUT) && !texto.includes('12345678'));
});
