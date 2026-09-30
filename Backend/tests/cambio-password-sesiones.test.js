// Cambiar la contraseña emite una sesión nueva y revoca todas las anteriores.
//
// El síntoma que lo trajo: tras cambiar la contraseña inicial, crear el PIN
// respondía "Debes cambiar tu contraseña inicial". El autorizador cachea su
// respuesta 60 segundos por token, y el token seguía siendo el mismo: durante
// ese minuto seguía diciendo `credencialProvisional=true`. Reproducido en dev
// (mismo token: 403 a los 2 s del cambio, 200 a los 69 s).
//
// Detrás había un problema peor. Cambiar la contraseña no revocaba ninguna
// sesión. Con la contraseña inicial de D-13, quien conoce un RUT puede entrar
// antes que su dueña y dejar abierta esa sesión: cuando ella cambiaba la
// contraseña, la sesión ajena dejaba de ser provisional y quedaba completa por
// seis horas. Lo mismo al restablecerla por correo o por un administrador.
//
// La regla que fijan estas pruebas: si la contraseña cambió, ninguna sesión
// abierta con la anterior sigue valiendo, en ninguna de las empresas de la
// persona. Ver D-26.

process.env.CAMPO_HMAC_KEY = 'clave-de-prueba-hmac';
process.env.CAMPO_CIFRADO_LOCAL_KEY = require('crypto').randomBytes(32).toString('base64');
process.env.CREDENCIAL_PEPPER = 'pimienta-de-prueba';

const { prepararEntorno, crearDobleTablas } = require('./doble-dynamo-tablas');
const esquemas = prepararEntorno();

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

const { docClient } = require('../lib/clients/dynamodb');
const { PersonaService } = require('../lib/services/PersonaService');
const { TenantService } = require('../lib/services/TenantService');
const { sesionDesdeToken } = require('../lib/auth/sesion');
const auth = require('../handlers/auth/handler');

const RUT = '12.345.678-5';
const INICIAL = '1234';

let doble;
let tenantA;
let personaA;

beforeEach(async () => {
    // Con proyecciones: la revocación lee `personaId-index`, que solo proyecta
    // claves, y tiene que funcionar con lo que el índice realmente devuelve.
    doble = crearDobleTablas(docClient, esquemas, { proyecciones: true });
    tenantA = (await new TenantService().setup({ nombre: 'Constructora A', rutEmpresa: '76.543.210-3' })).tenantId;
    const { persona } = await new PersonaService().crear(tenantA, {
        rut: RUT, nombre: 'Juan', rol: 'trabajador', email: 'juan@ejemplo.cl', tieneAccesoWeb: true,
    });
    personaA = persona.personaId;
});
afterEach(() => doble.restaurar());

const login = async (password = INICIAL) => {
    const res = await auth.login({
        body: JSON.stringify({ rut: RUT, password }),
        requestContext: { http: { sourceIp: '10.0.0.1' } },
        headers: { 'user-agent': 'prueba' },
    });
    assert.equal(res.statusCode, 200, res.body);
    return JSON.parse(res.body).data;
};

/** Lo que API Gateway le entrega al handler, con el contexto del autorizador. */
const cambiar = (sesion, passwordNuevo = 'Nueva-clave-1') => auth.changePassword({
    requestContext: {
        http: { method: 'POST', path: '/auth/change-password', sourceIp: '10.0.0.1' },
        authorizer: { lambda: {
            sessionId: sesion.sessionId, personaId: personaA, tenantId: tenantA,
            rol: 'trabajador', permisos: '', credencialProvisional: 'true',
        } },
    },
    rawPath: '/auth/change-password',
    headers: { authorization: `Bearer ${sesion.token}`, 'user-agent': 'prueba' },
    body: JSON.stringify({ passwordNuevo, confirmarPassword: passwordNuevo }),
});

// ─── Cambio de contraseña con sesión ─────────────────────────────────────────

test('cambiar la contraseña devuelve una sesión nueva, ya no provisional', async () => {
    const propia = await login();
    const res = await cambiar(propia);

    assert.equal(res.statusCode, 200, res.body);
    const data = JSON.parse(res.body).data;
    assert.ok(data.token, 'trae token');
    assert.notEqual(data.token, propia.token, 'y es otro: el autorizador cachea por token');
    assert.ok(data.sessionId && data.expiresAt);
    assert.equal(data.user.passwordTemporal, false);

    const nueva = await sesionDesdeToken(data.token);
    assert.equal(nueva?.personaId, personaA);
    assert.equal(nueva?.tenantId, tenantA);
});

test('la sesión con la que se cambió queda revocada', async () => {
    const propia = await login();
    await cambiar(propia);
    assert.equal(await sesionDesdeToken(propia.token), null);
});

test('una sesión ajena abierta con la contraseña inicial también queda revocada', async () => {
    // Alguien que conoce el RUT entró primero y no cambió nada.
    const intrusa = await login();
    const propia = await login();
    await cambiar(propia);
    assert.equal(await sesionDesdeToken(intrusa.token), null,
        'si sobrevive, deja de ser provisional y queda completa por seis horas');
});

test('se revocan también las sesiones de la misma persona en otras empresas', async () => {
    // La contraseña es una para toda la identidad: `propagarPassword` la cambia
    // en las fichas hermanas, así que sus sesiones abiertas con la anterior
    // tampoco pueden seguir.
    const tenantB = (await new TenantService().setup({ nombre: 'Constructora B', rutEmpresa: '77.777.777-7' })).tenantId;
    const { persona: hermana } = await new PersonaService().crear(tenantB, {
        rut: RUT, nombre: 'Juan', rol: 'trabajador', email: 'juan@ejemplo.cl', tieneAccesoWeb: true,
    });
    const token = crypto.randomBytes(32).toString('hex');
    const { PutCommand } = require('@aws-sdk/lib-dynamodb');
    const { hashToken } = require('../lib/auth/sesion');
    await docClient.send(new PutCommand({ TableName: 'SESSIONS_TABLE', Item: {
        sessionId: 's-hermana', personaId: hermana.personaId, tenantId: tenantB, tokenHash: hashToken(token),
        activa: true, expiresAt: new Date(Date.now() + 3600e3).toISOString(),
    } }));
    assert.ok(await sesionDesdeToken(token), 'la sesión de la otra empresa existe antes del cambio');

    await cambiar(await login());
    assert.equal(await sesionDesdeToken(token), null);
});

test('si no se pueden revocar las sesiones, no se entrega una sesión nueva', async () => {
    // Responder que todo salió bien con las sesiones anteriores vivas es
    // exactamente lo que esto vino a cerrar.
    const propia = await login();
    const envio = docClient.send;
    docClient.send = async (cmd) => {
        if (cmd.constructor.name === 'QueryCommand' && cmd.input.IndexName === 'personaId-index' && cmd.input.TableName === 'SESSIONS_TABLE') {
            throw Object.assign(new Error('fallo simulado'), { name: 'InternalServerError' });
        }
        return envio(cmd);
    };
    const res = await cambiar(propia);
    docClient.send = envio;

    assert.notEqual(res.statusCode, 200);
    assert.ok(!JSON.parse(res.body).data?.token);
});

// ─── Restablecimientos ───────────────────────────────────────────────────────

test('restablecer la contraseña por correo revoca las sesiones abiertas', async () => {
    const abierta = await login();
    const token = 'token-de-recuperacion';
    const { UpdateCommand } = require('@aws-sdk/lib-dynamodb');
    await docClient.send(new UpdateCommand({
        TableName: 'PERSONAS_TABLE',
        Key: { PK: `TENANT#${tenantA}`, SK: `PERSONA#${personaA}` },
        UpdateExpression: 'SET resetTokenHash = :h, resetTokenExpiry = :e',
        ExpressionAttributeValues: {
            ':h': crypto.createHash('sha256').update(token).digest('hex'),
            ':e': new Date(Date.now() + 3600e3).toISOString(),
        },
    }));

    const res = await auth.resetPassword({
        body: JSON.stringify({ personaId: personaA, token, passwordNuevo: 'Otra-clave-2', confirmarPassword: 'Otra-clave-2' }),
    });
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(await sesionDesdeToken(abierta.token), null);
});

test('el restablecimiento por un administrador revoca las sesiones abiertas', async () => {
    const abierta = await login();
    await new PersonaService().resetPassword(tenantA, personaA);
    assert.equal(await sesionDesdeToken(abierta.token), null);
});

test('el índice de sesiones por persona proyecta solo claves', () => {
    // Como los de personas (D-6): el índice sirve para encontrar la sesión, no
    // para tener otra copia de ella con el hash del token.
    const p = esquemas.SESSIONS_TABLE.proyecciones['personaId-index'];
    assert.equal(p?.tipo, 'KEYS_ONLY');
});
