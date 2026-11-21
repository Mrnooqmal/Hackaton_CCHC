process.env.CAMPO_HMAC_KEY = 'clave-de-prueba-hmac';
process.env.CAMPO_CIFRADO_LOCAL_KEY = require('crypto').randomBytes(32).toString('base64');
process.env.CREDENCIAL_PEPPER = 'pimienta-de-prueba';

const { prepararEntorno, crearDobleTablas } = require('./doble-dynamo-tablas');
const esquemas = prepararEntorno();

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { PutCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');

const { docClient } = require('../lib/clients/dynamodb');
const { PersonaService } = require('../lib/services/PersonaService');
const { TenantService } = require('../lib/services/TenantService');
const { sesionDesdeToken, hashToken } = require('../lib/auth/sesion');
const credenciales = require('../lib/credenciales');
const auth = require('../handlers/auth/handler');
const personas = require('../handlers/personas-module/handler');

const RUT = '12.345.678-5';
const INICIAL = '1234';

let doble;
beforeEach(() => { doble = crearDobleTablas(docClient, esquemas, { proyecciones: true }); });
afterEach(() => doble.restaurar());

let rutEmpresa = 70000000;
const empresa = async (nombre) => {
    rutEmpresa += 1;
    const cuerpo = String(rutEmpresa);
    let suma = 0; let mult = 2;
    for (let i = cuerpo.length - 1; i >= 0; i--) { suma += Number(cuerpo[i]) * mult; mult = mult === 7 ? 2 : mult + 1; }
    const r = 11 - (suma % 11);
    const dv = r === 11 ? '0' : r === 10 ? 'K' : String(r);
    return (await new TenantService().setup({ nombre, rutEmpresa: `${cuerpo}-${dv}` })).tenantId;
};

const ficha = async (tenantId, extra = {}) => (await new PersonaService().crear(tenantId, {
    rut: RUT, nombre: 'Juan', rol: 'trabajador', tieneAccesoWeb: true, ...extra,
})).persona.personaId;

const ingresar = async (password) => {
    const res = await auth.login({
        body: JSON.stringify({ rut: RUT, password }),
        requestContext: { http: { sourceIp: '10.0.0.1' } },
        headers: { 'user-agent': 'prueba' },
    });
    return { status: res.statusCode, data: JSON.parse(res.body).data };
};

const empresasQueAbre = async (password) => {
    const { status, data } = await ingresar(password);
    if (status !== 200) return [];
    if (data.requiereSeleccionTenant) return data.opciones.map((o) => o.tenantId).sort();
    return [(await sesionDesdeToken(data.token)).tenantId];
};

const cambiar = (personaId, tenantId, passwordNuevo, passwordActual) => auth.changePassword({
    requestContext: {
        http: { method: 'POST', path: '/auth/change-password', sourceIp: '10.0.0.1' },
        authorizer: { lambda: { sessionId: 's-actual', personaId, tenantId, rol: 'trabajador', permisos: '' } },
    },
    rawPath: '/auth/change-password',
    headers: { 'user-agent': 'prueba' },
    body: JSON.stringify({ passwordActual, passwordNuevo, confirmarPassword: passwordNuevo }),
});

const activar = async (tenantId, personaId) => (await new PersonaService().emitirTemporal(tenantId, personaId, {
    horas: 2, actor: { id: 'p-prueba', tipo: 'persona', nombre: 'Prueba' }, operacion: 'credencial.acceso_activado',
    exigir: 'pendiente', aviso: { asunto: 'Acceso activado', contenido: 'Prueba activó tu acceso.' },
})).password;

const definir = async (personaId, tenantId, password) => {
    await activar(tenantId, personaId);
    const res = await cambiar(personaId, tenantId, password);
    assert.equal(res.statusCode, 200, res.body);
};

const fijar = async (personaId, tenantId, password, extra = {}) => docClient.send(new UpdateCommand({
    TableName: 'PERSONAS_TABLE', Key: { PK: `TENANT#${tenantId}`, SK: `PERSONA#${personaId}` },
    UpdateExpression: `SET passwordHash = :h, passwordTemporal = :t${extra.vence ? ', passwordTemporalVence = :v' : ''} REMOVE activacionPendiente`,
    ExpressionAttributeValues: { ':h': await credenciales.hashear(password, personaId), ':t': Boolean(extra.temporal), ...(extra.vence ? { ':v': extra.vence } : {}) },
}));

const coincide = async (personaId, password) => {
    const p = await new PersonaService().getById(personaId);
    return (await credenciales.verificar(password, p._passwordHash, personaId)).valido;
};

const sesionAbierta = async (personaId, tenantId) => {
    const token = crypto.randomBytes(32).toString('hex');
    await docClient.send(new PutCommand({ TableName: 'SESSIONS_TABLE', Item: {
        sessionId: `s-${personaId}`, personaId, tenantId, tokenHash: hashToken(token),
        activa: true, expiresAt: new Date(Date.now() + 3600e3).toISOString(),
    } }));
    return token;
};

const restablecerPorCorreo = async (personaId, tenantId, passwordNuevo) => {
    const token = crypto.randomBytes(16).toString('hex');
    await docClient.send(new UpdateCommand({
        TableName: 'PERSONAS_TABLE',
        Key: { PK: `TENANT#${tenantId}`, SK: `PERSONA#${personaId}` },
        UpdateExpression: 'SET resetTokenHash = :h, resetTokenExpiry = :e',
        ExpressionAttributeValues: {
            ':h': crypto.createHash('sha256').update(token).digest('hex'),
            ':e': new Date(Date.now() + 3600e3).toISOString(),
        },
    }));
    const res = await auth.resetPassword({
        body: JSON.stringify({ personaId, token, passwordNuevo, confirmarPassword: passwordNuevo }),
    });
    assert.equal(res.statusCode, 200, res.body);
};

test('H-B: la temporal de una ficha nueva no abre la empresa donde la persona ya estaba', async () => {
    const b = await empresa('Constructora B');
    const enB = await ficha(b);
    await definir(enB, b, 'Propia-de-B-1');

    const a = await empresa('Constructora A');
    const enA = await ficha(a);
    const temporal = await activar(a, enA);

    assert.deepEqual(await empresasQueAbre(temporal), [a]);
    assert.deepEqual(await empresasQueAbre('Propia-de-B-1'), [b]);
    assert.deepEqual(await empresasQueAbre(INICIAL), [], 'los cuatro dígitos no abren nada');
});

test('una contraseña que coincide en dos empresas sigue ofreciendo las dos', async () => {
    const a = await empresa('Constructora A');
    const b = await empresa('Constructora B');
    await fijar(await ficha(a), a, 'Comun-1');
    await fijar(await ficha(b), b, 'Comun-1');

    assert.deepEqual(await empresasQueAbre('Comun-1'), [a, b].sort());
});

test('el cambio desde la temporal no se copia a otra empresa ni cierra sus sesiones', async () => {
    const b = await empresa('Constructora B');
    const enB = await ficha(b);
    await definir(enB, b, 'Propia-de-B-1');
    const tokenB = await sesionAbierta(enB, b);

    const a = await empresa('Constructora A');
    const enA = await ficha(a);
    await definir(enA, a, 'Puesta-en-A-1');

    assert.equal(await coincide(enB, 'Propia-de-B-1'), true, 'la contraseña de B no cambió');
    assert.equal(await coincide(enB, 'Puesta-en-A-1'), false);
    assert.ok(await sesionDesdeToken(tokenB), 'la sesión de B sigue');
    assert.deepEqual(await empresasQueAbre('Puesta-en-A-1'), [a]);
});

test('el cambio desde la temporal no se copia aunque la otra empresa tenga la misma y se envíe como actual', async () => {
    const a = await empresa('Constructora A');
    const b = await empresa('Constructora B');
    const enA = await ficha(a);
    const enB = await ficha(b);
    const temporal = await activar(a, enA);
    await fijar(enB, b, temporal, { temporal: true, vence: new Date(Date.now() + 3600e3).toISOString() });

    const res = await cambiar(enA, a, 'Elegida-en-A-1', temporal);
    assert.equal(res.statusCode, 200, res.body);

    assert.equal(await coincide(enB, temporal), true);
    assert.equal(await coincide(enB, 'Elegida-en-A-1'), false);
    assert.deepEqual(await empresasQueAbre('Elegida-en-A-1'), [a]);
});

test('el cambio con la contraseña actual se copia solo a las fichas donde esa contraseña coincide', async () => {
    const a = await empresa('Constructora A');
    const b = await empresa('Constructora B');
    const c = await empresa('Constructora C');
    const enA = await ficha(a);
    const enB = await ficha(b);
    const enC = await ficha(c);
    await definir(enA, a, 'Compartida-1');
    await fijar(enB, b, 'Compartida-1');
    await definir(enC, c, 'Otra-de-C-1');
    const tokenB = await sesionAbierta(enB, b);
    const tokenC = await sesionAbierta(enC, c);

    const res = await cambiar(enA, a, 'Nueva-comun-1', 'Compartida-1');
    assert.equal(res.statusCode, 200, res.body);

    assert.equal(await coincide(enB, 'Nueva-comun-1'), true, 'B compartía la actual: se copia');
    assert.equal(await coincide(enC, 'Otra-de-C-1'), true, 'C tenía otra: no se toca');
    assert.equal(await sesionDesdeToken(tokenB), null);
    assert.ok(await sesionDesdeToken(tokenC));
});

test('H-C: el restablecimiento por correo se copia solo a fichas con el mismo correo', async () => {
    const a = await empresa('Constructora A');
    const b = await empresa('Constructora B');
    const c = await empresa('Constructora C');
    const enA = await ficha(a, { email: 'Juan@Ejemplo.cl' });
    const enB = await ficha(b, { email: 'juan@ejemplo.cl ' });
    const enC = await ficha(c, { email: 'otra@ejemplo.cl' });
    const tokenC = await sesionAbierta(enC, c);

    await restablecerPorCorreo(enA, a, 'Por-correo-1');

    assert.equal(await coincide(enB, 'Por-correo-1'), true, 'mismo correo: se copia');
    assert.equal(await coincide(enC, 'Por-correo-1'), false, 'otro correo: no se toca');
    assert.ok(await sesionDesdeToken(tokenC));
    assert.deepEqual(await empresasQueAbre('Por-correo-1'), [a, b].sort());
});

test('H-C: una empresa que pone su correo en la ficha no alcanza la cuenta de otra empresa', async () => {
    const b = await empresa('Constructora B');
    const enB = await ficha(b, { email: 'juan@personal.cl' });
    await definir(enB, b, 'Propia-de-B-1');
    const a = await empresa('Constructora A');
    const enA = await ficha(a, { email: 'buzon@constructora-a.cl' });

    await restablecerPorCorreo(enA, a, 'Del-atacante-1');

    assert.equal(await coincide(enB, 'Propia-de-B-1'), true);
    assert.deepEqual(await empresasQueAbre('Del-atacante-1'), [a]);
});

test('propagar una contraseña exige decir a qué fichas', async () => {
    const a = await empresa('Constructora A');
    const enA = await ficha(a);
    const persona = await new PersonaService().getById(enA);
    await assert.rejects(() => new PersonaService().propagarPassword(persona, 'x-1'), /criterio/);
});

test('H-A: ya no existe el restablecimiento con contraseña devuelta en la respuesta', async () => {
    const a = await empresa('Constructora A');
    const admin = await ficha(a, { rol: 'admin', rut: '11.111.111-1' });
    const enA = await ficha(a);
    const antes = (await new PersonaService().getItemById(enA)).passwordHash;

    const res = await personas.personasHandler({
        requestContext: {
            http: { method: 'POST', path: `/personas/${enA}/reset-password`, sourceIp: '10.0.0.1' },
            authorizer: { lambda: { sessionId: 's-admin', personaId: admin, tenantId: a, rol: 'admin', permisos: '' } },
        },
        rawPath: `/personas/${enA}/reset-password`,
        pathParameters: { proxy: `${enA}/reset-password` },
        queryStringParameters: { tenantId: a },
        headers: { 'user-agent': 'prueba' },
        body: '{}',
    });

    assert.equal(res.statusCode, 404, res.body);
    assert.ok(!/passwordTemporal/.test(res.body));
    assert.equal((await new PersonaService().getItemById(enA)).passwordHash, antes);
    assert.equal(typeof PersonaService.prototype.resetPassword, 'undefined');
});
