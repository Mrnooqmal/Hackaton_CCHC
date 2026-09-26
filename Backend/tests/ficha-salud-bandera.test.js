// La Ficha Básica de Salud la enciende la empresa, y queda probado quién y cuándo.
//
// Recolectar datos de salud de todo el plantel es una decisión que la empresa
// tiene que poder demostrar que tomó. Estas pruebas fijan las cuatro cosas de
// las que depende que esa demostración valga:
//
//   1. solo la cambia quien tiene el permiso `empresa.ficha_salud`;
//   2. quién y cuándo salen de la SESIÓN, nunca del cuerpo de la petición;
//   3. el historial solo crece: cada decisión se agrega, nada se reescribe, y
//      el PUT genérico de configuración no puede tocarlo;
//   4. apagada, abrir Encuestas no crea ni sincroniza la ficha.

process.env.CAMPO_HMAC_KEY = 'clave-de-prueba-hmac';
process.env.CAMPO_CIFRADO_LOCAL_KEY = require('crypto').randomBytes(32).toString('base64');

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const { docClient } = require('../lib/clients/dynamodb');
const { crearTablaTenants } = require('./doble-tabla-tenants');
const { PersonaService } = require('../lib/services/PersonaService');
const empresa = require('../handlers/tenants-module/handler');
const encuestas = require('../handlers/surveys/handler');

const EMPRESA = 't-empresa-a';
const OTRA = 't-empresa-b';
const CLAVE = `TENANT#${EMPRESA}#METADATA#${EMPRESA}`;

const sesionDe = (tenantId, { personaId = 'p-admin', permisos = 'empresa.ficha_salud,empresa.identidad,empresa.roles' } = {}) => ({
    requestContext: {
        authorizer: { lambda: { sessionId: 's-1', personaId, tenantId, rol: 'admin', permisos } },
    },
});

const ev = (sesion, metodo, ruta, body) => ({
    ...sesion,
    requestContext: { ...sesion.requestContext, http: { method: metodo, path: ruta } },
    rawPath: ruta,
    queryStringParameters: null,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
});

const encender = (sesion, habilitada, extra = {}) => empresa.tenantsHandler(
    ev(sesion, 'PUT', `/tenants/${EMPRESA}/ficha-salud`, { habilitada, ...extra })
);

const condicionFallida = () => Object.assign(new Error('condición'), { name: 'ConditionalCheckFailedException' });

let tabla;
let encuestasGuardadas;
let originalSend;
let originalGetById;
let originalListar;

beforeEach(() => {
    require('../lib/llaveTenant')._olvidarCache();
    tabla = crearTablaTenants([EMPRESA, OTRA]);
    encuestasGuardadas = new Map();
    originalSend = docClient.send;

    docClient.send = async (cmd) => {
        const nombre = cmd.constructor.name;
        const input = cmd.input || {};
        const expr = input.UpdateExpression || '';

        // La escritura de la bandera: la misma condición y el mismo list_append
        // que DynamoDB, que son lo que garantiza el historial. Se reconoce por
        // el `list_append`, no por el nombre del atributo: si el PUT genérico
        // llegara a nombrar `fichaSaludHistorial`, tiene que caer en su propia
        // rama y no confundirse con esta — si no, la prueba pasaría por un error
        // del doble y no porque la protección funcione.
        if (nombre === 'UpdateCommand' && expr.includes('list_append(if_not_exists(fichaSaludHistorial')) {
            const clave = `${input.Key.PK}#${input.Key.SK}`;
            const actual = tabla.filas.get(clave);
            const v = input.ExpressionAttributeValues;
            const cumple = actual && (input.ConditionExpression.includes(':no')
                ? actual.fichaSaludHabilitada === undefined || actual.fichaSaludHabilitada === false
                : actual.fichaSaludHabilitada === true);
            if (!cumple) throw condicionFallida();
            const nuevo = {
                ...actual,
                fichaSaludHabilitada: v[':h'],
                fichaSaludHistorial: [...(actual.fichaSaludHistorial || []), ...v[':evento']],
                updatedAt: v[':u'],
            };
            tabla.filas.set(clave, nuevo);
            return { Attributes: nuevo };
        }

        // El PUT genérico de configuración (updateConfig): aplica `#campo = :campo`.
        if (nombre === 'UpdateCommand' && input.Key?.SK?.startsWith('METADATA#') && input.ExpressionAttributeNames) {
            const clave = `${input.Key.PK}#${input.Key.SK}`;
            const nuevo = { ...tabla.filas.get(clave) };
            for (const [, ph, vh] of expr.matchAll(/(#\w+) = (:\w+)/g)) {
                nuevo[input.ExpressionAttributeNames[ph]] = input.ExpressionAttributeValues[vh];
            }
            tabla.filas.set(clave, nuevo);
            return { Attributes: nuevo };
        }

        const deTenants = tabla.responder(cmd);
        if (deTenants !== undefined) {
            // La lectura liviana de la bandera pide un solo atributo.
            if (nombre === 'GetCommand' && input.ProjectionExpression && deTenants.Item) {
                return { Item: { fichaSaludHabilitada: deTenants.Item.fichaSaludHabilitada } };
            }
            return deTenants;
        }

        if (nombre === 'GetCommand' && input.Key?.surveyId) return { Item: encuestasGuardadas.get(input.Key.surveyId) };
        if (nombre === 'PutCommand' && input.Item?.surveyId) { encuestasGuardadas.set(input.Item.surveyId, input.Item); return {}; }
        if (nombre === 'QueryCommand') return { Items: [] };
        return {};
    };

    originalGetById = PersonaService.prototype.getById;
    PersonaService.prototype.getById = async (id) => ({
        personaId: id, tenantId: EMPRESA, nombre: 'Ana', apellido: 'Rojas',
    });
    originalListar = PersonaService.prototype.listByTenant;
    PersonaService.prototype.listByTenant = async () => ([
        { personaId: 'p-1', tenantId: EMPRESA, nombre: 'Luis', rut: '11.111.111-1' },
    ]);
});

afterEach(() => {
    docClient.send = originalSend;
    PersonaService.prototype.getById = originalGetById;
    PersonaService.prototype.listByTenant = originalListar;
});

const historial = () => tabla.filas.get(CLAVE).fichaSaludHistorial || [];

// ─── Quién puede ─────────────────────────────────────────────────────────────

test('sin el permiso empresa.ficha_salud no se cambia, y no queda nada escrito', async () => {
    const res = await encender(sesionDe(EMPRESA, { permisos: 'empresa.identidad,empresa.roles' }), true);

    assert.equal(res.statusCode, 403);
    assert.notEqual(tabla.filas.get(CLAVE).fichaSaludHabilitada, true);
    assert.equal(historial().length, 0);
});

test('la ficha de otra empresa no se toca: 404, igual que el resto del módulo', async () => {
    const res = await empresa.tenantsHandler(ev(sesionDe(OTRA), 'PUT', `/tenants/${EMPRESA}/ficha-salud`, { habilitada: true }));

    assert.equal(res.statusCode, 404);
    assert.equal(historial().length, 0);
});

test('un valor que no es booleano se rechaza, en vez de interpretarse', async () => {
    const res = await encender(sesionDe(EMPRESA), 'true');
    assert.equal(res.statusCode, 400);
    assert.equal(historial().length, 0);
});

// ─── Quién y cuándo: de la sesión ────────────────────────────────────────────

test('queda registrado quién la encendió y cuándo, tomado de la sesión', async () => {
    const antes = Date.now();
    const res = await encender(sesionDe(EMPRESA, { personaId: 'p-admin' }), true);

    assert.equal(res.statusCode, 200);
    assert.equal(tabla.filas.get(CLAVE).fichaSaludHabilitada, true);
    const [evento] = historial();
    assert.equal(evento.habilitada, true);
    assert.equal(evento.personaId, 'p-admin');
    assert.equal(evento.nombre, 'Ana Rojas', 'el nombre tal como era en ese momento');
    assert.ok(Date.parse(evento.en) >= antes - 1000, 'con la hora del servidor');
});

test('el cuerpo no puede decir que la encendió otra persona', async () => {
    await encender(sesionDe(EMPRESA, { personaId: 'p-admin' }), true, {
        personaId: 'p-otro', nombre: 'Alguien Más', en: '2020-01-01T00:00:00.000Z',
    });

    const [evento] = historial();
    assert.equal(evento.personaId, 'p-admin');
    assert.notEqual(evento.nombre, 'Alguien Más');
    assert.notEqual(evento.en, '2020-01-01T00:00:00.000Z');
});

// ─── El historial solo crece ─────────────────────────────────────────────────

test('encender, apagar y volver a encender deja tres decisiones, en orden', async () => {
    await encender(sesionDe(EMPRESA), true);
    await encender(sesionDe(EMPRESA), false);
    await encender(sesionDe(EMPRESA), true);

    assert.deepEqual(historial().map((e) => e.habilitada), [true, false, true]);
});

test('pedir el estado que ya tiene no agrega nada: el historial registra decisiones', async () => {
    await encender(sesionDe(EMPRESA), true);
    const res = await encender(sesionDe(EMPRESA), true);

    assert.equal(res.statusCode, 200);
    assert.equal(JSON.parse(res.body).data.cambio, false);
    assert.equal(historial().length, 1);
});

test('apagar una ficha que nunca se encendió no registra nada', async () => {
    const res = await encender(sesionDe(EMPRESA), false);

    assert.equal(JSON.parse(res.body).data.cambio, false);
    assert.equal(historial().length, 0);
});

test('el PUT genérico de configuración no puede encenderla ni reescribir el historial', async () => {
    await encender(sesionDe(EMPRESA), true);
    await encender(sesionDe(EMPRESA), false);

    await empresa.tenantsHandler(ev(sesionDe(EMPRESA), 'PUT', `/tenants/${EMPRESA}`, {
        preferencias: { colorPrimario: '#000000' },
        fichaSaludHabilitada: true,
        fichaSaludHistorial: [],
    }));

    assert.equal(tabla.filas.get(CLAVE).fichaSaludHabilitada, false, 'sigue apagada');
    assert.equal(historial().length, 2, 'el historial no se pudo vaciar');
});

// ─── Apagada, Encuestas no la crea ───────────────────────────────────────────

const abrirEncuestas = () => encuestas.list(ev(sesionDe(EMPRESA, { permisos: 'encuestas.ver' }), 'GET', '/surveys'));

test('apagada (el estado inicial), abrir Encuestas no crea la ficha', async () => {
    const res = await abrirEncuestas();

    assert.equal(res.statusCode, 200);
    assert.equal(encuestasGuardadas.size, 0, 'no se recolecta nada como efecto de abrir una pantalla');
});

test('encendida, abrir Encuestas crea la ficha de ESTA empresa', async () => {
    await encender(sesionDe(EMPRESA), true);
    await abrirEncuestas();

    assert.ok(encuestasGuardadas.has(`default-health-survey#${EMPRESA}`));
});

test('apagarla después no borra la ficha ya creada', async () => {
    await encender(sesionDe(EMPRESA), true);
    await abrirEncuestas();
    await encender(sesionDe(EMPRESA), false);
    await abrirEncuestas();

    assert.ok(encuestasGuardadas.has(`default-health-survey#${EMPRESA}`), 'apagar no es borrar datos de salud');
});
