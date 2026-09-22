// El alta de una empresa por interfaz, con una invitación de un solo uso.
//
// Lo que estas pruebas fijan no es que el formulario funcione, sino las cinco
// cosas que lo hacen seguro:
//
//   1. el enlace sirve UNA vez, y dos envíos simultáneos crean UNA empresa;
//   2. vencido, revocado o usado, la respuesta hacia afuera es siempre la misma,
//      y el motivo real queda registrado adentro;
//   3. el correo del administrador lo fija la licencia: lo que venga en el
//      cuerpo no se usa;
//   4. el `tenantId` lo genera el servidor;
//   5. un dato inválido —un RUT repetido, una contraseña corta— NO quema el
//      enlace: se valida antes de consumirlo.

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

process.env.LICENCIAS_TABLE = 'licencias-prueba';
process.env.TENANTS_TABLE = 'tenants-prueba';
process.env.PERSONAS_TABLE = 'personas-prueba';
process.env.CREDENCIAL_SCRYPT_LN = '10'; // el costo real se mide en la Lambda

const { docClient } = require('../lib/clients/dynamodb');
const { LicenciaService, hashLicencia } = require('../lib/services/LicenciaService');
const onboarding = require('../handlers/onboarding/handler');

const EMAIL = 'maria.soto@constructora.cl';

let almacen;
let registrado;
let consolaOriginal;
let envioOriginal;

/** Doble de DynamoDB con lo que este flujo necesita: clave primaria, escritura
 *  condicionada y recorrido de tabla. Las condiciones se evalúan de verdad,
 *  porque el uso único depende exactamente de eso. */
const montarDoble = () => {
    almacen = { licencias: new Map(), tenants: [], personas: [] };
    envioOriginal = docClient.send;

    docClient.send = async (cmd) => {
        const nombre = cmd.constructor.name;
        const input = cmd.input || {};
        const tabla = input.TableName || '';

        if (tabla.includes('licencias')) {
            const clave = input.Key?.licenciaHash || input.Item?.licenciaHash;
            if (nombre === 'PutCommand') { almacen.licencias.set(clave, { ...input.Item }); return {}; }
            if (nombre === 'GetCommand') return { Item: almacen.licencias.get(clave) };
            if (nombre === 'ScanCommand') return { Items: [...almacen.licencias.values()] };
            if (nombre === 'UpdateCommand') {
                const actual = almacen.licencias.get(clave);
                if (!actual) throw Object.assign(new Error('no existe'), { name: 'ConditionalCheckFailedException' });
                const v = input.ExpressionAttributeValues || {};
                const cond = input.ConditionExpression || '';
                if (cond.includes('estado = :emitida') && actual.estado !== v[':emitida']) {
                    throw Object.assign(new Error('condición'), { name: 'ConditionalCheckFailedException' });
                }
                if (cond.includes('attribute_not_exists(usedAt) OR usedAt = :nulo') && actual.usedAt) {
                    throw Object.assign(new Error('condición'), { name: 'ConditionalCheckFailedException' });
                }
                if (cond.includes('estado = :usada') && actual.estado !== v[':usada']) {
                    throw Object.assign(new Error('condición'), { name: 'ConditionalCheckFailedException' });
                }
                if (cond.includes('usedAt = :esperado') && actual.usedAt !== v[':esperado']) {
                    throw Object.assign(new Error('condición'), { name: 'ConditionalCheckFailedException' });
                }
                if (cond.includes('estado <> :usada') && actual.estado === v[':usada']) {
                    throw Object.assign(new Error('condición'), { name: 'ConditionalCheckFailedException' });
                }
                const actualizado = { ...actual };
                // El estado nuevo sale del placeholder que usa la expresión, no
                // de adivinar: `revocar` declara `:usada` en su condición, así
                // que elegirlo por presencia daba un estado equivocado.
                const nuevoEstado = (input.UpdateExpression.match(/estado = (:\w+)/) || [])[1];
                if (nuevoEstado) actualizado.estado = v[nuevoEstado];
                if (input.UpdateExpression.includes('usedAt = :ahora')) actualizado.usedAt = v[':ahora'];
                if (input.UpdateExpression.includes('usedAt = :nulo')) actualizado.usedAt = null;
                if (input.UpdateExpression.includes('usedIp = :ip')) actualizado.usedIp = v[':ip'];
                if (input.UpdateExpression.includes('tenantId = :t')) actualizado.tenantId = v[':t'];
                almacen.licencias.set(clave, actualizado);
                return { Attributes: actualizado };
            }
        }

        // Empresa y personas: lo justo para que el alta corra.
        if (tabla.includes('tenants')) {
            if (nombre === 'PutCommand') { almacen.tenants.push(input.Item); return {}; }
            if (nombre === 'QueryCommand' || nombre === 'ScanCommand') return { Items: [] };
            if (nombre === 'GetCommand') {
                const t = almacen.tenants.find((x) => x.PK === input.Key?.PK);
                return { Item: t };
            }
            if (nombre === 'UpdateCommand') {
                const t = almacen.tenants.find((x) => x.PK === input.Key?.PK) || {};
                return { Attributes: { ...t, ...(input.ExpressionAttributeValues || {}) } };
            }
        }
        if (tabla.includes('personas')) {
            if (nombre === 'PutCommand') { almacen.personas.push(input.Item); return {}; }
            if (nombre === 'QueryCommand' || nombre === 'ScanCommand') return { Items: [] };
            return {};
        }
        return {};
    };
};

beforeEach(() => {
    montarDoble();
    registrado = [];
    consolaOriginal = console.error;
    console.error = (...a) => registrado.push(a.join(' '));
});

afterEach(() => {
    docClient.send = envioOriginal;
    console.error = consolaOriginal;
});

const emitir = (opciones = {}) => LicenciaService.emitir({
    email: EMAIL,
    prellenado: { nombre: 'Constructora Ejemplo SpA', rutEmpresa: '76.111.999-0' },
    emitidaPor: 'prueba',
    ...opciones,
});

const cuerpoValido = (token, cambios = {}) => ({
    token,
    empresa: { nombre: 'Constructora Ejemplo SpA', rutEmpresa: '76.111.999-0' },
    admin: {
        rut: '15.111.222-6',
        nombre: 'María',
        apellidoPaterno: 'Soto',
        password: 'Obra2026segura',
        confirmarPassword: 'Obra2026segura',
        ...(cambios.admin || {}),
    },
    ...(cambios.raiz || {}),
});

const completar = (cuerpo, ip = '1.2.3.4') => onboarding.completar({
    body: JSON.stringify(cuerpo),
    requestContext: { http: { sourceIp: ip, method: 'POST' } },
    headers: {},
});

const validar = (token) => onboarding.validarLicencia({
    pathParameters: { token },
    requestContext: { http: { method: 'GET' } },
});

// ─── Lo que la licencia muestra antes de usarse ──────────────────────────────

test('validar devuelve solo el correo fijado y el prellenado', async () => {
    const { token } = await emitir();

    const res = await validar(token);
    const datos = JSON.parse(res.body).data;

    assert.equal(res.statusCode, 200);
    assert.equal(datos.email, EMAIL);
    assert.equal(datos.prellenado.nombre, 'Constructora Ejemplo SpA');
    // Nada más: este endpoint es público.
    assert.deepEqual(Object.keys(datos).sort(), ['email', 'expiraEn', 'prellenado', 'valida']);
    assert.equal(res.body.includes('licenciaId'), false, 'no se filtra el identificador interno');
});

// ─── Lo que no sirve, y cómo se ve hacia afuera ──────────────────────────────

const esperaEnlaceInvalido = (res) => {
    assert.equal(res.statusCode, 404);
    assert.match(JSON.parse(res.body).error, /inválido o venció/);
};

test('una licencia vencida no sirve, y no dice que está vencida', async () => {
    const { token } = await emitir();
    const item = almacen.licencias.get(hashLicencia(token));
    item.expiresAt = new Date(Date.now() - 1000).toISOString();

    esperaEnlaceInvalido(await validar(token));
    esperaEnlaceInvalido(await completar(cuerpoValido(token)));
    assert.ok(registrado.some((l) => l.includes('vencida')), 'el motivo real queda registrado adentro');
    assert.equal(almacen.tenants.length, 0);
});

test('una licencia revocada no sirve', async () => {
    const { token, licenciaId } = await emitir();
    await LicenciaService.revocar(licenciaId);

    esperaEnlaceInvalido(await validar(token));
    esperaEnlaceInvalido(await completar(cuerpoValido(token)));
    assert.ok(registrado.some((l) => l.includes('revocada')));
    assert.equal(almacen.tenants.length, 0);
});

test('un token inventado no sirve y no distingue del vencido', async () => {
    esperaEnlaceInvalido(await validar('token-que-no-existe'));
    assert.ok(registrado.some((l) => l.includes('no_existe')));
});

// ─── Uso único ───────────────────────────────────────────────────────────────

test('la licencia sirve una sola vez', async () => {
    const { token } = await emitir();

    const primera = await completar(cuerpoValido(token));
    assert.equal(primera.statusCode, 201);
    assert.equal(almacen.tenants.length, 1);

    const segunda = await completar(cuerpoValido(token, { admin: { rut: '16.222.333-9' } }));
    esperaEnlaceInvalido(segunda);
    assert.equal(almacen.tenants.length, 1, 'el segundo intento no crea una segunda empresa');
});

test('dos envíos simultáneos con el mismo enlace crean una sola empresa', async () => {
    const { token } = await emitir();

    const [a, b] = await Promise.all([
        completar(cuerpoValido(token)),
        completar(cuerpoValido(token)),
    ]);

    const exitosas = [a, b].filter((r) => r.statusCode === 201);
    assert.equal(exitosas.length, 1, 'gana exactamente uno');
    assert.equal(almacen.tenants.length, 1, 'y se crea exactamente una empresa');
});

// ─── El correo lo fija la licencia ───────────────────────────────────────────

test('el correo del cuerpo se ignora: manda el de la licencia', async () => {
    const { token } = await emitir();

    const res = await completar(cuerpoValido(token, {
        admin: { email: 'atacante@otro-dominio.cl' },
    }));

    assert.equal(res.statusCode, 201);
    assert.equal(JSON.parse(res.body).data.administrador.email, EMAIL);
    assert.equal(almacen.personas[0].email, EMAIL, 'la ficha guardada lleva el correo de la licencia');
});

test('el tenantId lo pone el servidor, no el cliente', async () => {
    const { token } = await emitir();

    await completar(cuerpoValido(token, { raiz: { tenantId: 't-de-otra-empresa' } }));

    assert.equal(almacen.tenants.length, 1);
    assert.notEqual(almacen.tenants[0].tenantId, 't-de-otra-empresa');
    assert.match(almacen.tenants[0].tenantId, /^[0-9a-f-]{36}$/);
});

// ─── Un error del formulario no quema el enlace ──────────────────────────────

test('una contraseña que no cumple la política no consume la licencia', async () => {
    const { token } = await emitir();

    const res = await completar(cuerpoValido(token, {
        admin: { password: 'corta', confirmarPassword: 'corta' },
    }));

    assert.equal(res.statusCode, 400);
    assert.equal(almacen.licencias.get(hashLicencia(token)).estado, 'emitida', 'el enlace sigue sirviendo');
    assert.equal(almacen.tenants.length, 0);

    // Y con una contraseña válida, el mismo enlace funciona.
    assert.equal((await completar(cuerpoValido(token))).statusCode, 201);
});

test('las contraseñas que no coinciden no consumen la licencia', async () => {
    const { token } = await emitir();

    const res = await completar(cuerpoValido(token, {
        admin: { confirmarPassword: 'Otra-distinta-9' },
    }));

    assert.equal(res.statusCode, 400);
    assert.equal(almacen.licencias.get(hashLicencia(token)).estado, 'emitida');
});

test('un RUT ya registrado no quema el enlace', async () => {
    const { token } = await emitir();

    // La persona ya existe en el sistema.
    const original = docClient.send;
    docClient.send = async (cmd) => {
        const t = cmd.input?.TableName || '';
        if (t.includes('personas') && cmd.constructor.name === 'ScanCommand') {
            return { Items: [{ personaId: 'p-existente', rut: '15.111.222-6', tenantId: 'otra' }] };
        }
        return original(cmd);
    };

    const res = await completar(cuerpoValido(token));
    docClient.send = original;

    assert.equal(res.statusCode, 400);
    assert.match(JSON.parse(res.body).error, /ya está registrado/);
    assert.equal(almacen.licencias.get(hashLicencia(token)).estado, 'emitida', 'el enlace no se gastó');
    assert.equal(almacen.tenants.length, 0);
});

// ─── Traza ───────────────────────────────────────────────────────────────────

test('queda registrado quién emitió, cuándo se usó y desde qué IP', async () => {
    const { token, licenciaId } = await emitir({ emitidaPor: 'operador-de-turno' });

    await completar(cuerpoValido(token), '200.1.2.3');

    const guardada = almacen.licencias.get(hashLicencia(token));
    assert.equal(guardada.licenciaId, licenciaId);
    assert.equal(guardada.emitidaPor, 'operador-de-turno');
    assert.ok(guardada.emitidaEn);
    assert.ok(guardada.usedAt, 'cuándo se consumió');
    assert.equal(guardada.usedIp, '200.1.2.3', 'desde dónde');
    assert.equal(guardada.tenantId, almacen.tenants[0].tenantId, 'y qué empresa salió de ella');
});

test('el token nunca se guarda en claro', async () => {
    const { token } = await emitir();

    const guardada = [...almacen.licencias.values()][0];
    assert.equal(guardada.licenciaHash, hashLicencia(token));
    assert.equal(JSON.stringify(guardada).includes(token), false);
});
