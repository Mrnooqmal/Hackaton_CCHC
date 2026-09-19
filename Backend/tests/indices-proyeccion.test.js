// Los índices proyectan SOLO sus claves.
//
// Los tres índices de personas pasaron de `ProjectionType: ALL` a `KEYS_ONLY`
// para dejar de tener tres copias completas de la ficha —con el hash del PIN, el
// de la contraseña y los campos de salud— repartidas por la tabla.
//
// El cambio tiene una consecuencia que no es obvia y que ya nos mordió en
// producción: **cada índice proyecta sus propias claves, no las de los demás**.
// `tenantRut-index` devuelve `tenantId`, `rut`, `PK` y `SK`; NO devuelve
// `personaId`. Un código que asumía lo contrario dejó la recuperación de
// contraseña respondiendo 200 con su mensaje genérico mientras por detrás
// fallaba con "ExpressionAttributeValues must not be empty".
//
// Estas pruebas usan un doble que proyecta igual que DynamoDB: si alguien vuelve
// a leer del índice un campo que el índice no tiene, fallan acá y no en
// producción.

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const { docClient } = require('../lib/clients/dynamodb');
const { PersonaService } = require('../lib/services/PersonaService');

const EMPRESA = 't-empresa-a';
const PERSONA = 'p-1';

// La ficha completa, tal como vive en la TABLA.
const fichaCompleta = {
    PK: `TENANT#${EMPRESA}`,
    SK: `PERSONA#${PERSONA}`,
    personaId: PERSONA,
    tenantId: EMPRESA,
    rut: '12.345.678-5',
    email: 'persona@ejemplo.cl',
    nombre: 'Juan',
    apellido: 'Pérez',
    rol: 'trabajador',
    estado: 'activo',
    tieneAccesoWeb: true,
    // Lo que precisamente NO queremos repetido en tres índices.
    passwordHash: 'hash-de-contraseña',
    pinHash: 'hash-de-pin',
    resetTokenHash: 'hash-del-token',
    resetTokenExpiry: '2099-01-01T00:00:00.000Z',
    vigilanciaSalud: { enVigilancia: true },
};

/** Claves que proyecta cada índice: las suyas, más las de la tabla. */
const PROYECCION = {
    'personaId-index': ['PK', 'SK', 'personaId'],
    'email-index': ['PK', 'SK', 'email'],
    'tenantRut-index': ['PK', 'SK', 'tenantId', 'rut'],
};

const soloProyectado = (indice) =>
    Object.fromEntries(PROYECCION[indice].map((k) => [k, fichaCompleta[k]]));

let originalSend;
let consultas;

beforeEach(() => {
    consultas = [];
    originalSend = docClient.send;
    docClient.send = async (cmd) => {
        const nombre = cmd.constructor.name;
        const input = cmd.input || {};
        consultas.push(nombre);

        if (nombre === 'QueryCommand' || nombre === 'ScanCommand') {
            const indice = input.IndexName;
            // Igual que DynamoDB: una consulta sin valores es un error, no un
            // resultado vacío. Es el fallo exacto que llegó a producción.
            const valores = input.ExpressionAttributeValues || {};
            if (Object.keys(valores).length === 0) {
                const err = new Error('ExpressionAttributeValues must not be empty');
                err.name = 'ValidationException';
                throw err;
            }
            if (Object.values(valores).some((v) => v === undefined)) {
                const err = new Error('ExpressionAttributeValues must not contain undefined');
                err.name = 'ValidationException';
                throw err;
            }
            return { Items: [soloProyectado(indice)] };
        }
        if (nombre === 'GetCommand') {
            const mismaFicha = input.Key.PK === fichaCompleta.PK && input.Key.SK === fichaCompleta.SK;
            return { Item: mismaFicha ? fichaCompleta : null };
        }
        return {};
    };
});

afterEach(() => { docClient.send = originalSend; });

// ─── Las tres búsquedas resuelven la ficha ───────────────────────────────────

test('buscar por id devuelve la ficha completa, leyéndola de la tabla', async () => {
    const persona = await new PersonaService().getById(PERSONA);

    assert.equal(persona.nombre, 'Juan');
    assert.equal(persona._passwordHash, 'hash-de-contraseña', 'el login necesita el hash, y viene de la tabla');
    assert.deepEqual(consultas, ['QueryCommand', 'GetCommand'], 'índice para ubicar, tabla para leer');
});

test('buscar por RUT devuelve la ficha completa', async () => {
    const persona = await new PersonaService().getByRut(EMPRESA, '12.345.678-5');

    assert.equal(persona.personaId, PERSONA);
    assert.equal(persona._passwordHash, 'hash-de-contraseña');
});

test('buscar por correo devuelve la ficha completa', async () => {
    const persona = await new PersonaService().getByEmail('persona@ejemplo.cl');

    assert.equal(persona.personaId, PERSONA);
});

test('el ítem crudo trae los campos que el modelo no preserva', async () => {
    // La recuperación de contraseña necesita `resetTokenHash`, que `Persona` no
    // conserva.
    const item = await new PersonaService().getItemById(PERSONA);

    assert.equal(item.resetTokenHash, 'hash-del-token');
    assert.equal(item.resetTokenExpiry, '2099-01-01T00:00:00.000Z');
});

// ─── El error concreto que llegó a producción ────────────────────────────────

test('el índice por RUT no trae personaId: resolver por él falla', async () => {
    // Esto documenta el error, no lo permite: quien consulta un índice tiene que
    // resolver la ficha con `fichaDesdeClave`, no deducirla del resultado.
    const claveDelIndice = soloProyectado('tenantRut-index');

    assert.equal(claveDelIndice.personaId, undefined, 'tenantRut-index NO proyecta personaId');
    await assert.rejects(
        () => new PersonaService().getById(claveDelIndice.personaId),
        /ExpressionAttributeValues/,
        'buscar por un campo que el índice no proyecta explota como en producción',
    );
});

test('resolver desde la clave del índice sí funciona, venga del índice que venga', async () => {
    const servicio = new PersonaService();

    for (const indice of Object.keys(PROYECCION)) {
        const persona = await servicio.fichaDesdeClave(soloProyectado(indice));
        assert.equal(persona.personaId, PERSONA, `falló resolviendo desde ${indice}`);
    }
});

// ─── El camino completo de recuperación de contraseña ────────────────────────

test('la recuperación de contraseña encuentra a la persona por su RUT', async () => {
    // Es el flujo que se cayó: `Scan` sobre tenantRut-index y, con lo que
    // devuelve, resolver la ficha.
    const auth = require('../handlers/auth/handler');

    const res = await auth.forgotPassword({
        body: JSON.stringify({ rut: '12.345.678-5' }),
        requestContext: { http: { sourceIp: '1.2.3.4' } },
        headers: {},
    });

    assert.equal(res.statusCode, 200);
    // La respuesta es genérica a propósito (no revela si el RUT existe), así que
    // lo que se comprueba es que llegó a ESCRIBIR el token: si la búsqueda
    // hubiera fallado, no habría UpdateCommand.
    assert.ok(consultas.includes('UpdateCommand'), 'se registró el token de recuperación');
});

// ─── Obras y empresas: el mismo criterio, los mismos dos pasos ───────────────
//
// `obraId-index` y `slug-index` pasaron a `KEYS_ONLY` por la misma razón que los
// de personas. Estas pruebas usan un doble que, igual que DynamoDB, devuelve
// desde el índice SOLO sus claves: si alguien vuelve a leer del índice un
// atributo que el índice ya no tiene, falla acá.

const { ObraService } = require('../lib/services/ObraService');
const { TenantService } = require('../lib/services/TenantService');

const obraEnTabla = {
    PK: 'TENANT#t-empresa-a', SK: 'OBRA#o-1',
    obraId: 'o-1', tenantId: 't-empresa-a',
    nombre: 'Edificio Costanera', estado: 'activa', codigo: 'OBRA-001',
};

const empresaEnTabla = {
    PK: 'TENANT#t-empresa-a', SK: 'METADATA',
    tenantId: 't-empresa-a', slug: 'constructora-norte',
    nombre: 'Constructora Norte', rutEmpresa: '76.111.999-0',
};

/** Doble que proyecta como el índice real: sus claves y nada más. */
const soloClaves = (item, propias) => {
    const proyectado = { PK: item.PK, SK: item.SK };
    for (const k of propias) proyectado[k] = item[k];
    return proyectado;
};

test('una obra se busca por el índice y se lee de la tabla', async () => {
    const servicio = new ObraService();
    const original = servicio.dynamo.send;
    servicio.dynamo.send = async (cmd) => {
        const nombre = cmd.constructor.name;
        if (nombre === 'QueryCommand' && cmd.input.IndexName === 'obraId-index') {
            return { Items: [soloClaves(obraEnTabla, ['obraId'])] };
        }
        if (nombre === 'GetCommand') {
            const k = cmd.input.Key;
            return { Item: k.PK === obraEnTabla.PK && k.SK === obraEnTabla.SK ? obraEnTabla : undefined };
        }
        return {};
    };

    const obra = await servicio.getById('o-1');
    servicio.dynamo.send = original;

    assert.equal(obra.obraId, 'o-1');
    // El nombre NO viaja en el índice: si esto vuelve a estar vacío, alguien
    // volvió a confiar en la proyección.
    assert.equal(obra.nombre, 'Edificio Costanera');
    assert.equal(obra.tenantId, 't-empresa-a', 'la pertenencia se comprueba con esto');
});

test('una obra que no existe sigue siendo null, no un error', async () => {
    const servicio = new ObraService();
    const original = servicio.dynamo.send;
    servicio.dynamo.send = async () => ({ Items: [] });

    assert.equal(await servicio.getById('no-existe'), null);
    servicio.dynamo.send = original;
});

test('la empresa se busca por slug y se lee de la tabla', async () => {
    const servicio = new TenantService();
    const original = servicio.dynamo.send;
    servicio.dynamo.send = async (cmd) => {
        const nombre = cmd.constructor.name;
        if (nombre === 'QueryCommand' && cmd.input.IndexName === 'slug-index') {
            return { Items: [soloClaves(empresaEnTabla, ['slug'])] };
        }
        if (nombre === 'GetCommand') return { Item: empresaEnTabla };
        return {};
    };

    const tenant = await servicio.getBySlug('constructora-norte');
    servicio.dynamo.send = original;

    assert.equal(tenant.tenantId, 't-empresa-a');
    assert.equal(tenant.nombre, 'Constructora Norte');
});

test('ya no existe listByEstado: su índice se eliminó', () => {
    // Si alguien lo reintroduce sin recrear el índice, la llamada fallaría en
    // producción con "index not found" y acá queda dicho por qué no está.
    assert.equal(typeof new TenantService().listByEstado, 'undefined');
});
