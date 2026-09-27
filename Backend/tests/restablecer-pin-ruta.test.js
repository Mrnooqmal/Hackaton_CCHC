// La ruta del restablecimiento de PIN, y lo que la ruta de set-pin le pasa al servicio.
//
// Las reglas viven en `PersonaService` y las prueba `cambio-pin.test.js`. Acá
// solo lo que le toca a la ruta: el permiso, la pertenencia a la empresa, quién
// actúa (siempre desde la sesión, con su nombre) y la traducción de cada
// rechazo a su estado HTTP. Un código sin traducir sale como 500.

process.env.CAMPO_HMAC_KEY = 'clave-de-prueba-hmac';
process.env.CAMPO_CIFRADO_LOCAL_KEY = require('crypto').randomBytes(32).toString('base64');

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const { PersonaService } = require('../lib/services/PersonaService');
const { Persona } = require('../lib/models/Persona');
const personas = require('../handlers/personas-module/handler');

const EMPRESA = 't-a';
const ADMIN = 'p-admin';
const TRABAJADOR = 'p-trab';

const fichas = {
    [ADMIN]: { personaId: ADMIN, tenantId: EMPRESA, nombre: 'Ana', apellidoPaterno: 'Rojas', rol: 'admin' },
    [TRABAJADOR]: { personaId: TRABAJADOR, tenantId: EMPRESA, nombre: 'Juan', apellidoPaterno: 'Soto', rol: 'trabajador' },
    'p-ajena': { personaId: 'p-ajena', tenantId: 't-b', nombre: 'Otra', rol: 'trabajador' },
};

let llamadas;
let rechazo;
let leerFalla;
const originales = {};

beforeEach(() => {
    llamadas = [];
    rechazo = null;
    leerFalla = new Set();
    for (const m of ['getById', 'restablecerPin', 'setPin']) originales[m] = PersonaService.prototype[m];
    PersonaService.prototype.getById = async (id) => {
        if (leerFalla.has(id)) throw Object.assign(new Error('caído'), { name: 'InternalServerError' });
        return fichas[id] ? Persona.fromDynamoItem({ ...fichas[id] }) : null;
    };
    const registrar = (metodo) => async (...args) => {
        llamadas.push({ metodo, args });
        if (rechazo) throw Object.assign(new Error(`rechazo ${rechazo}`), { codigo: rechazo });
        return { message: 'ok' };
    };
    PersonaService.prototype.restablecerPin = registrar('restablecerPin');
    PersonaService.prototype.setPin = registrar('setPin');
});
afterEach(() => {
    for (const m of Object.keys(originales)) PersonaService.prototype[m] = originales[m];
});

const pedir = (ruta, cuerpo, { personaId = ADMIN, permisos = 'persona.restablecer_pin,personas.crear' } = {}) =>
    personas.personasHandler({
        requestContext: {
            http: { method: 'POST' },
            authorizer: { lambda: { sessionId: 's-1', personaId, tenantId: EMPRESA, rol: 'prevencionista', permisos } },
        },
        rawPath: ruta,
        body: JSON.stringify(cuerpo),
    });

const MOTIVO = 'Olvidó su PIN y lo pidió en la obra';

test('restablecer exige el permiso propio: poder enrolar no alcanza', async () => {
    const res = await pedir(`/personas/${TRABAJADOR}/restablecer-pin`, { motivo: MOTIVO }, { permisos: 'personas.crear,personas.ver' });
    assert.equal(res.statusCode, 403);
    assert.equal(llamadas.length, 0);
});

test('restablecer el PIN de alguien de otra empresa responde 404', async () => {
    const res = await pedir('/personas/p-ajena/restablecer-pin', { motivo: MOTIVO });
    assert.equal(res.statusCode, 404);
    assert.equal(llamadas.length, 0);
});

test('quien restablece sale de la sesión, con su nombre; el cuerpo no lo decide', async () => {
    const res = await pedir(`/personas/${TRABAJADOR}/restablecer-pin`, { motivo: MOTIVO, por: 'p-impostor', nombre: 'Otro' });
    assert.equal(res.statusCode, 200);
    const [{ args }] = llamadas;
    assert.deepEqual(args, [EMPRESA, TRABAJADOR, MOTIVO, { personaId: ADMIN, nombre: 'Ana Rojas' }]);
});

test('si no se puede saber el nombre de quien restablece, no se restablece', async () => {
    // Es lo que lee la persona afectada en el aviso: sin él no puede reconocer quién fue.
    leerFalla.add(ADMIN);
    const res = await pedir(`/personas/${TRABAJADOR}/restablecer-pin`, { motivo: MOTIVO });
    assert.equal(res.statusCode, 503);
    assert.equal(llamadas.length, 0);
});

for (const [codigo, estado] of [
    ['MOTIVO_REQUERIDO', 400],
    ['PIN_NO_CONFIGURADO', 409],
    ['PIN_CAMBIO_CONCURRENTE', 409],
    ['PIN_SIN_ACTOR', 500],
]) {
    test(`restablecer: ${codigo} responde ${estado}`, async () => {
        rechazo = codigo;
        if (estado === 500) {
            // Sin actor no debería ocurrir nunca por la ruta (la sesión lo da):
            // si ocurre, es un error del servidor, no del cliente.
            const res = await pedir(`/personas/${TRABAJADOR}/restablecer-pin`, { motivo: MOTIVO }).catch(() => ({ statusCode: 500 }));
            assert.equal(res.statusCode, 500);
            return;
        }
        const res = await pedir(`/personas/${TRABAJADOR}/restablecer-pin`, { motivo: MOTIVO });
        assert.equal(res.statusCode, estado);
    });
}

test('set-pin: quien restableció y quiere asistir recibe 403, no 500', async () => {
    rechazo = 'PIN_MISMA_PERSONA';
    const res = await pedir(`/personas/${TRABAJADOR}/set-pin`, { pin: '7395' });
    assert.equal(res.statusCode, 403);
});

test('set-pin pasa al servicio quién actúa, con su nombre para el historial', async () => {
    await pedir(`/personas/${TRABAJADOR}/set-pin`, { pin: '7395' });
    const [{ args }] = llamadas;
    assert.deepEqual(args[4], { personaId: ADMIN, nombre: 'Ana Rojas', puedeEnrolar: true });
});

test('set-pin sigue funcionando aunque no se pueda leer el nombre: es solo complemento', async () => {
    leerFalla.add(ADMIN);
    const res = await pedir(`/personas/${TRABAJADOR}/set-pin`, { pin: '7395' });
    assert.equal(res.statusCode, 200);
    assert.equal(llamadas[0].args[4].nombre, null);
});
