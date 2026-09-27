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
const { Persona } = require('../lib/models/Persona');
const { cumple, aplicar } = require('./expresiones-dynamo');
const { hashPin, verifyPin } = require('../lib/utils/validation');

const EMPRESA = 't1';
const DUENA = 'p-duena';
const SUPERVISOR = 'p-supervisor';

let ficha;
let escrituras;
let originalSend;
let originalGet;
let alLeer;

// La ficha es el ítem TAL COMO LO GUARDA `crear`: con `pinHash: null`, un
// atributo presente con valor NULL, no ausente. Las condiciones se evalúan con
// la semántica de DynamoDB (`tests/expresiones-dynamo.js`), no por comparación
// de texto: el doble anterior trataba ese `null` como ausente y dejó pasar que
// ninguna persona nueva podía configurar su primer PIN.
const fichaRecienCreada = () => ({
    PK: `TENANT#${EMPRESA}`, SK: `PERSONA#${DUENA}`, personaId: DUENA, tenantId: EMPRESA,
    nombre: 'Duena', email: null, pinHash: null, pinCreatedAt: null,
    pinIntentosFallidos: 0, pinBloqueadaHasta: null, pinRestablecido: null, pinHistorial: [],
});

let bandeja;
let fallarTransaccion;

const condicionFallida = () => Object.assign(new Error('condición'), { name: 'ConditionalCheckFailedException' });

beforeEach(async () => {
    consultasAlLimite.length = 0;
    bloquear = false;
    alLeer = null;
    ficha = fichaRecienCreada();
    escrituras = [];
    bandeja = [];
    fallarTransaccion = false;

    originalGet = PersonaService.prototype.getById;
    PersonaService.prototype.getById = async () => {
        const vista = Persona.fromDynamoItem(structuredClone(ficha));
        if (alLeer) alLeer();   // para simular lo que pasa ENTRE la lectura y la escritura
        return vista;
    };

    originalSend = docClient.send;
    docClient.send = async (cmd) => {
        const nombre = cmd.constructor.name;
        const i = cmd.input;
        if (nombre === 'UpdateCommand') {
            if (!cumple(ficha, i.ConditionExpression, i.ExpressionAttributeValues, i.ExpressionAttributeNames)) throw condicionFallida();
            ficha = aplicar(ficha, i.UpdateExpression, i.ExpressionAttributeValues, i.ExpressionAttributeNames);
            escrituras.push(i);
            return {};
        }
        if (nombre === 'TransactWriteCommand') {
            // Todo o nada: primero se evalúan TODAS las condiciones.
            const razones = i.TransactItems.map((op) => {
                if (op.Update) {
                    const u = op.Update;
                    return cumple(ficha, u.ConditionExpression, u.ExpressionAttributeValues, u.ExpressionAttributeNames)
                        ? 'None' : 'ConditionalCheckFailed';
                }
                if (op.Put) {
                    const yaEsta = bandeja.find((m) => m.messageId === op.Put.Item.messageId && m.recipientId === op.Put.Item.recipientId);
                    return cumple(yaEsta || null, op.Put.ConditionExpression) ? 'None' : 'ConditionalCheckFailed';
                }
                throw new Error('operación de transacción no simulada');
            });
            if (fallarTransaccion) throw Object.assign(new Error('red'), { name: 'InternalServerError' });
            if (razones.some((r) => r !== 'None')) {
                throw Object.assign(new Error('Transaction cancelled'), {
                    name: 'TransactionCanceledException',
                    CancellationReasons: razones.map((Code) => ({ Code })),
                });
            }
            for (const op of i.TransactItems) {
                if (op.Update) {
                    const u = op.Update;
                    ficha = aplicar(ficha, u.UpdateExpression, u.ExpressionAttributeValues, u.ExpressionAttributeNames);
                    escrituras.push(u);
                }
                if (op.Put) bandeja.push(op.Put.Item);
            }
            return {};
        }
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

// ─── La persona recién creada (pinHash NULL) ────────────────────────────────

test('la ficha recién creada guarda pinHash como NULL, y aun así su primer PIN se configura', async () => {
    assert.ok('pinHash' in ficha && ficha.pinHash === null, 'así lo escribe `crear`: presente y NULL');
    await svc().setPin(EMPRESA, DUENA, '7395', undefined, actor(DUENA));
    assert.equal(await verifyPin('7395', ficha.pinHash, DUENA), true);
});

test('cada configuración queda en el historial, con quién y si fue asistida — nunca el PIN', async () => {
    await svc().setPin(EMPRESA, DUENA, '7395', undefined, { personaId: SUPERVISOR, nombre: 'Supervisor', puedeEnrolar: true });
    assert.equal(ficha.pinHistorial.length, 1);
    const [e] = ficha.pinHistorial;
    assert.equal(e.evento, 'configurado');
    assert.equal(e.por, SUPERVISOR);
    assert.equal(e.asistido, true);
    assert.ok(!JSON.stringify(ficha.pinHistorial).includes('7395'));
    assert.ok(!JSON.stringify(ficha.pinHistorial).includes(ficha.pinHash));
});

// ─── Restablecer: quitar el PIN, avisar, anular vales ──────────────────────

const { ValeFirmaService } = require('../lib/services/ValeFirmaService');
const notificaciones = require('../handlers/notifications/handler');

const ADMIN = 'p-admin';
const OTRO = 'p-otro';
const MOTIVO = 'Olvidó su PIN en terreno, lo pidió en persona';
const admin = { personaId: ADMIN, nombre: 'Admin Uno' };

let valesRevocados;
let resultadoVales;
let correos;
let resultadoCorreo;
let originalRevocar;
let originalCorreo;

beforeEach(() => {
    valesRevocados = [];
    resultadoVales = { revocados: 3, noAplicaban: 1, fallidos: 0 };
    correos = [];
    resultadoCorreo = { sent: true };
    originalRevocar = ValeFirmaService.revocarDePersona;
    originalCorreo = notificaciones.sendPinRestablecidoEmail;
    ValeFirmaService.revocarDePersona = async (personaId, opciones) => {
        valesRevocados.push({ personaId, ...opciones });
        if (resultadoVales instanceof Error) throw resultadoVales;
        return resultadoVales;
    };
    notificaciones.sendPinRestablecidoEmail = async (email, nombre, datos) => {
        correos.push({ email, nombre, ...datos });
        return resultadoCorreo;
    };
});
afterEach(() => {
    ValeFirmaService.revocarDePersona = originalRevocar;
    notificaciones.sendPinRestablecidoEmail = originalCorreo;
});

const restablecer = (motivo = MOTIVO, quien = admin) => svc().restablecerPin(EMPRESA, DUENA, motivo, quien);

test('restablecer quita el PIN, limpia el bloqueo y deja registrado quién, cuándo y por qué', async () => {
    await conPin('4821');
    ficha.pinIntentosFallidos = 7;
    ficha.pinBloqueadaHasta = '2099-01-01T00:00:00.000Z';

    await restablecer();

    assert.ok(!('pinHash' in ficha), 'el PIN ya no existe');
    assert.equal(ficha.pinIntentosFallidos, 0);
    assert.ok(!('pinBloqueadaHasta' in ficha));
    assert.equal(ficha.pinRestablecido.por, ADMIN);
    assert.equal(ficha.pinRestablecido.motivo, MOTIVO);
    assert.equal(ficha.pinHistorial.at(-1).evento, 'restablecido');
});

test('no hay restablecimiento sin aviso: el mensaje de bandeja va en la MISMA transacción', async () => {
    await conPin('4821');
    await restablecer();
    assert.equal(bandeja.length, 1);
    assert.equal(bandeja[0].recipientId, DUENA);
    assert.match(bandeja[0].content, /Admin Uno/);
    assert.match(bandeja[0].content, /Si no pediste esto/);
    assert.equal(bandeja[0].priority, 'high');
});

test('si la transacción falla, no queda ni el restablecimiento ni el aviso', async () => {
    await conPin('4821');
    const antes = ficha.pinHash;
    fallarTransaccion = true;
    await assert.rejects(restablecer());
    assert.equal(ficha.pinHash, antes);
    assert.equal(bandeja.length, 0);
    assert.equal(valesRevocados.length, 0, 'sin restablecimiento no se anula nada');
});

test('si el PIN cambia entre leer y restablecer, no se restablece ni se avisa', async () => {
    await conPin('4821');
    const nuevo = await hashPin('9999', DUENA);
    alLeer = () => { ficha.pinHash = nuevo; };
    await rechaza(restablecer(), 'PIN_CAMBIO_CONCURRENTE');
    assert.equal(ficha.pinHash, nuevo);
    assert.equal(bandeja.length, 0);
});

test('sin motivo, o con uno de una palabra, no se restablece', async () => {
    await conPin('4821');
    await rechaza(restablecer(''), 'MOTIVO_REQUERIDO');
    await rechaza(restablecer('   olvido  '), 'MOTIVO_REQUERIDO');
    assert.ok(ficha.pinHash, 'el PIN sigue ahí');
});

test('sin PIN configurado no hay nada que restablecer', async () => {
    await rechaza(restablecer(), 'PIN_NO_CONFIGURADO');
    assert.equal(bandeja.length, 0);
});

test('los vales sin usar se anulan, en esta empresa y a nombre de quien restableció', async () => {
    await conPin('4821');
    const r = await restablecer();
    assert.deepEqual(valesRevocados, [{ personaId: DUENA, tenantId: EMPRESA, motivo: 'pin_restablecido', por: ADMIN }]);
    assert.equal(r.valesAnulados, 3);
    assert.equal(r.valesSinAnular, 0);
});

test('si anular los vales falla, el restablecimiento se mantiene pero se informa — no se calla', async () => {
    await conPin('4821');
    resultadoVales = new Error('DynamoDB caído');
    const r = await restablecer();
    assert.ok(!('pinHash' in ficha));
    assert.equal(r.valesSinAnular, null, 'null: no se sabe cuántos quedaron vivos');
});

test('con correo, se avisa también por correo; si falla, se informa', async () => {
    await conPin('4821');
    ficha.email = 'duena@ejemplo.cl';
    let r = await restablecer();
    assert.equal(r.avisoCorreo, 'enviado');
    assert.equal(correos[0].email, 'duena@ejemplo.cl');
    assert.equal(correos[0].porNombre, 'Admin Uno');

    await conPin('4821');
    ficha.pinRestablecido = null;
    resultadoCorreo = { sent: false, error: 'MessageRejected' };
    r = await restablecer();
    assert.equal(r.avisoCorreo, 'fallido');
});

test('sin correo, el aviso queda solo en la bandeja', async () => {
    await conPin('4821');
    const r = await restablecer();
    assert.equal(r.avisoCorreo, 'sin-correo');
    assert.equal(correos.length, 0);
});

// ─── El PIN nuevo: dos personas distintas ───────────────────────────────────

test('quien restableció NO puede asistir en el PIN nuevo, aunque pueda enrolar', async () => {
    await conPin('4821');
    await restablecer();
    await rechaza(svc().setPin(EMPRESA, DUENA, '7395', undefined, { ...admin, puedeEnrolar: true }), 'PIN_MISMA_PERSONA');
    assert.ok(!('pinHash' in ficha));
});

test('otra persona con permiso de enrolar sí asiste, y quedan registradas las dos', async () => {
    await conPin('4821');
    await restablecer();
    await svc().setPin(EMPRESA, DUENA, '7395', undefined, { personaId: OTRO, nombre: 'Otro', puedeEnrolar: true });

    assert.equal(await verifyPin('7395', ficha.pinHash, DUENA), true);
    assert.ok(!('pinRestablecido' in ficha), 'el restablecimiento pendiente se cierra');
    const [restablecido, configurado] = ficha.pinHistorial.slice(-2);
    assert.equal(restablecido.evento, 'restablecido');
    assert.equal(restablecido.por, ADMIN);
    assert.equal(configurado.evento, 'configurado');
    assert.equal(configurado.por, OTRO);
    assert.equal(configurado.asistido, true);
    assert.equal(configurado.trasRestablecimientoDe, restablecido.en);
});

test('la propia persona configura su PIN nuevo sin ayuda', async () => {
    await conPin('4821');
    await restablecer();
    await svc().setPin(EMPRESA, DUENA, '7395', undefined, actor(DUENA));
    assert.equal(ficha.pinHistorial.at(-1).asistido, false);
});

test('quien se restablece su propio PIN puede configurar el nuevo: no está asistiendo a nadie', async () => {
    ficha.personaId = ADMIN;
    await conPin('4821');
    await svc().restablecerPin(EMPRESA, ADMIN, MOTIVO, admin);
    await svc().setPin(EMPRESA, ADMIN, '7395', undefined, { ...admin, puedeEnrolar: true });
    assert.equal(ficha.pinHistorial.at(-1).asistido, false);
});

test('si el restablecimiento cambia mientras se asiste, la asistencia no procede', async () => {
    // OTRO lee el restablecimiento de ADMIN y, antes de escribir, queda vigente
    // uno distinto —hecho por el propio OTRO—. La regla se evaluó contra el
    // leído, así que la escritura no puede proceder contra el vigente.
    await conPin('4821');
    await restablecer();
    alLeer = () => { ficha.pinRestablecido = { ...ficha.pinRestablecido, en: '2099-01-01T00:00:00.000Z', por: OTRO }; };
    await rechaza(svc().setPin(EMPRESA, DUENA, '7395', undefined, { personaId: OTRO, puedeEnrolar: true }), 'PIN_CAMBIO_CONCURRENTE');
});
