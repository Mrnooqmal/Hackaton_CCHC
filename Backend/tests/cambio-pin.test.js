// Quién puede fijar el PIN con el que se firma.
//
// El PIN es la credencial de firma: quien lo fija puede firmar por esa persona.
// La regla vive en `PersonaService.setPin`, el único punto por donde pasa todo
// cambio de PIN, y estas pruebas la ejercitan ahí, sin la ruta, porque la ruta
// era la única defensa y el servicio verificaba el PIN actual solo "si el
// cliente lo envía".
//
//   - con PIN: solo la propia persona lo cambia, probando el actual, y esa
//     prueba pasa por el límite de intentos;
//   - sin PIN: lo configura ella o quien tenga permiso de enrolar;
//   - la escritura procede solo si el PIN guardado sigue siendo el verificado.

process.env.CAMPO_HMAC_KEY = 'clave-de-prueba-hmac';
process.env.CAMPO_CIFRADO_LOCAL_KEY = require('crypto').randomBytes(32).toString('base64');
process.env.CREDENCIAL_PEPPER = 'pimienta-de-prueba';

// El límite de intentos se sustituye ANTES de cargar el servicio (que lo toma al
// importarse). Su comportamiento real lo prueban `limite-pin.test.js` y la ruta;
// acá importa que el servicio pase por él y respete lo que decide.
const limitePin = require('../lib/limitePin');
const consultasAlLimite = [];
let bloquear = false;
limitePin.verificarConLimiteOLanzar = async (persona, pinIngresado, verificar) => {
    consultasAlLimite.push(persona.personaId);
    if (bloquear) throw Object.assign(new Error('Cuenta bloqueada temporalmente'), { codigo: 'PIN_BLOQUEADO' });
    return verificar(pinIngresado, persona._pinHash, persona.personaId);
};

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const { docClient } = require('../lib/clients/dynamodb');
const { PersonaService } = require('../lib/services/PersonaService');
const { hashPin, verifyPin } = require('../lib/utils/validation');

const EMPRESA = 't1';
const DUENA = 'p-duena';
const SUPERVISOR = 'p-supervisor';

let ficha;
let escrituras;
let originalSend;
let originalGet;
let alLeer;

beforeEach(async () => {
    consultasAlLimite.length = 0;
    bloquear = false;
    alLeer = null;
    ficha = { personaId: DUENA, tenantId: EMPRESA, pinHash: null };
    escrituras = [];

    originalGet = PersonaService.prototype.getById;
    PersonaService.prototype.getById = async () => {
        const vista = { personaId: ficha.personaId, tenantId: EMPRESA, _pinHash: ficha.pinHash };
        if (alLeer) alLeer();   // para simular lo que pasa ENTRE la lectura y la escritura
        return vista;
    };

    originalSend = docClient.send;
    docClient.send = async (cmd) => {
        if (cmd.constructor.name !== 'UpdateCommand') return {};
        const i = cmd.input;
        const cond = i.ConditionExpression || '';
        const cumple = cond === 'attribute_not_exists(pinHash)'
            ? !ficha.pinHash
            : cond === 'pinHash = :anterior' ? ficha.pinHash === i.ExpressionAttributeValues[':anterior'] : true;
        if (!cumple) throw Object.assign(new Error('condición'), { name: 'ConditionalCheckFailedException' });
        ficha.pinHash = i.ExpressionAttributeValues[':pinHash'];
        escrituras.push(i);
        return {};
    };
});

afterEach(() => {
    docClient.send = originalSend;
    PersonaService.prototype.getById = originalGet;
});

const svc = () => new PersonaService();
const actor = (personaId, puedeEnrolar = false) => ({ personaId, puedeEnrolar });
const conPin = async (pin) => { ficha.pinHash = await hashPin(pin, DUENA); };
const rechaza = (promesa, codigo) => assert.rejects(promesa, (err) => err.codigo === codigo);

// ─── Con PIN: solo ella, probando el actual ─────────────────────────────────

test('la propia persona cambia su PIN probando el actual', async () => {
    await conPin('4821');
    await svc().setPin(EMPRESA, DUENA, '7395', '4821', actor(DUENA));
    assert.equal(await verifyPin('7395', ficha.pinHash, DUENA), true);
});

test('sin el PIN actual no se cambia — aunque lo pida la propia persona', async () => {
    await conPin('4821');
    await rechaza(svc().setPin(EMPRESA, DUENA, '7395', undefined, actor(DUENA)), 'PIN_ACTUAL_REQUERIDO');
    assert.equal(escrituras.length, 0);
    assert.equal(await verifyPin('4821', ficha.pinHash, DUENA), true, 'el PIN sigue siendo el de antes');
});

test('con el PIN actual incorrecto no se cambia, y el intento cuenta para el límite', async () => {
    await conPin('4821');
    await rechaza(svc().setPin(EMPRESA, DUENA, '7395', '0000', actor(DUENA)), 'PIN_ACTUAL_INCORRECTO');
    assert.equal(escrituras.length, 0);
    assert.deepEqual(consultasAlLimite, [DUENA], 'la prueba del PIN actual pasa por el límite de intentos');
});

test('con la cuenta bloqueada no se cambia: el bloqueo se respeta, no se esquiva', async () => {
    await conPin('4821');
    bloquear = true;
    await rechaza(svc().setPin(EMPRESA, DUENA, '7395', '4821', actor(DUENA)), 'PIN_BLOQUEADO');
    assert.equal(escrituras.length, 0);
});

test('otra persona no cambia un PIN existente, ni con permiso de enrolar ni sabiendo el PIN', async () => {
    await conPin('4821');
    await rechaza(svc().setPin(EMPRESA, DUENA, '7395', '4821', actor(SUPERVISOR, true)), 'PIN_AJENO');
    assert.equal(escrituras.length, 0);
    assert.deepEqual(consultasAlLimite, [], 'ni siquiera se consulta el PIN: no sirve de oráculo para adivinarlo');
});

test('el PIN nuevo no puede ser igual al actual', async () => {
    await conPin('4821');
    await rechaza(svc().setPin(EMPRESA, DUENA, '4821', '4821', actor(DUENA)), 'PIN_IGUAL');
});

// ─── Sin PIN: ella, o quien puede enrolar ───────────────────────────────────

test('sin PIN, la propia persona lo configura', async () => {
    await svc().setPin(EMPRESA, DUENA, '7395', undefined, actor(DUENA));
    assert.equal(await verifyPin('7395', ficha.pinHash, DUENA), true);
});

test('sin PIN, quien tiene permiso de enrolar lo configura (el trabajador lo teclea en su dispositivo)', async () => {
    await svc().setPin(EMPRESA, DUENA, '7395', undefined, actor(SUPERVISOR, true));
    assert.equal(escrituras.length, 1);
});

test('sin PIN, otra persona sin permiso de enrolar no lo configura', async () => {
    await rechaza(svc().setPin(EMPRESA, DUENA, '7395', undefined, actor(SUPERVISOR, false)), 'PIN_AJENO');
    assert.equal(escrituras.length, 0);
});

// ─── Las carreras entre leer y escribir ─────────────────────────────────────

test('si la persona configura su PIN mientras otro "configura el primero", no se sobrescribe', async () => {
    // Quien enrola lee "no tiene PIN"; antes de que escriba, la persona pone el suyo.
    const pinDeElla = await hashPin('4821', DUENA);
    alLeer = () => { ficha.pinHash = pinDeElla; };

    await rechaza(svc().setPin(EMPRESA, DUENA, '1111', undefined, actor(SUPERVISOR, true)), 'PIN_CAMBIO_CONCURRENTE');
    assert.equal(ficha.pinHash, pinDeElla, 'el PIN de ella sigue ahí');
});

test('si el PIN cambia entre verificarlo y escribir, el cambio no procede', async () => {
    await conPin('4821');
    const otro = await hashPin('5555', DUENA);
    alLeer = () => { ficha.pinHash = otro; };   // otro cambio gana la carrera

    await rechaza(svc().setPin(EMPRESA, DUENA, '7395', '4821', actor(DUENA)), 'PIN_CAMBIO_CONCURRENTE');
    assert.equal(ficha.pinHash, otro);
});

test('sin saber quién pide el cambio, no hay cambio', async () => {
    await rechaza(svc().setPin(EMPRESA, DUENA, '7395', undefined, undefined), 'PIN_SIN_ACTOR');
    assert.equal(escrituras.length, 0);
});
