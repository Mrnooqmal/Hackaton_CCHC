// Personas sin correo: se crean, entran con su RUT, y la recuperación no les promete nada.
//
// La contraseña inicial son los primeros cuatro dígitos del RUT precisamente
// porque en terreno mucha gente no tiene correo: se la dice en persona quien la
// registra. Hasta el 27 de septiembre de 2026, a esa misma gente no se la podía
// crear: `crear` escribía `email: ''`, `email` es la clave de `email-index` y
// DynamoDB rechazaba la escritura completa. Y aunque se hubiera podido, la
// contraseña solo se generaba si había correo.
//
// El doble de DynamoDB usa los esquemas reales de `serverless.yml` y rechaza lo
// mismo que DynamoDB: una clave de índice vacía o de otro tipo.

process.env.CAMPO_HMAC_KEY = 'clave-de-prueba-hmac';
process.env.CAMPO_CIFRADO_LOCAL_KEY = require('crypto').randomBytes(32).toString('base64');
process.env.CREDENCIAL_PEPPER = 'pimienta-de-prueba';

const { prepararEntorno, crearDobleTablas } = require('./doble-dynamo-tablas');
const esquemas = prepararEntorno();   // antes de cargar servicios: leen el nombre de la tabla al importarse

const { test, before, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const { docClient } = require('../lib/clients/dynamodb');
const { PersonaService } = require('../lib/services/PersonaService');
const { TenantService } = require('../lib/services/TenantService');
const personas = require('../handlers/personas-module/handler');
const auth = require('../handlers/auth/handler');
const notificaciones = require('../handlers/notifications/handler');

let doble;
let tenantId;
let adminId;
let correos;
let originalRecuperacion;

// RUT válidos, con los cuatro primeros dígitos conocidos.
const RUT_SIN_CORREO = '12.345.678-5';
const RUT_SIN_CORREO_2 = '11.111.111-1';
const RUT_CON_CORREO = '22.222.222-2';

beforeEach(async () => {
    doble = crearDobleTablas(docClient, esquemas);
    correos = [];
    originalRecuperacion = notificaciones.sendPasswordResetEmail;
    notificaciones.sendPasswordResetEmail = async (email) => { correos.push({ tipo: 'recuperacion', email }); return { sent: true }; };
    const tenant = await new TenantService().setup({ nombre: 'Constructora Prueba', rutEmpresa: '76.543.210-3' });
    tenantId = tenant.tenantId;
    const { persona } = await new PersonaService().crear(tenantId, {
        rut: '9.876.543-3', nombre: 'Ana', rol: 'admin', email: 'ana@ejemplo.cl', password: 'una-clave-larga',
    });
    adminId = persona.personaId;
});
afterEach(() => {
    doble.restaurar();
    notificaciones.sendPasswordResetEmail = originalRecuperacion;
});

const itemDe = (personaId) => doble.items('PERSONAS_TABLE').find((i) => i.personaId === personaId);

const pedirComo = (actorId, metodo, ruta, cuerpo, permisos = require('../lib/permissions').ALL_PERMISSION_KEYS.join(',')) => personas.personasHandler({
    requestContext: {
        http: { method: metodo },
        authorizer: { lambda: { sessionId: 's-1', personaId: actorId, tenantId, rol: 'admin', permisos } },
    },
    rawPath: ruta,
    body: JSON.stringify(cuerpo),
});
const pedir = (metodo, ruta, cuerpo) => pedirComo(adminId, metodo, ruta, cuerpo);

// ─── El doble rechaza lo mismo que DynamoDB ─────────────────────────────────

test('el doble rechaza una clave de índice vacía, como DynamoDB', async () => {
    const { PutCommand } = require('@aws-sdk/lib-dynamodb');
    await assert.rejects(
        docClient.send(new PutCommand({ TableName: 'PERSONAS_TABLE', Item: { PK: 'TENANT#x', SK: 'PERSONA#y', email: '' } })),
        /empty string value. IndexName: email-index/,
    );
    await assert.rejects(
        docClient.send(new PutCommand({ TableName: 'SIGNATURES_TABLE', Item: { signatureId: 's', requestId: null } })),
        /Type mismatch for Index Key requestId/,
    );
});

// ─── El servicio ─────────────────────────────────────────────────────────────

test('sin correo, la persona se crea sin el atributo: queda fuera de email-index', async () => {
    const { persona } = await new PersonaService().crear(tenantId, { rut: RUT_SIN_CORREO, nombre: 'Juan', rol: 'trabajador' });
    const item = itemDe(persona.personaId);
    assert.ok(item, 'la persona quedó guardada');
    assert.ok(!('email' in item), 'sin atributo, no cadena vacía');
});

test('con correo vacío o solo espacios, igual: sin atributo', async () => {
    const svc = new PersonaService();
    const { persona: a } = await svc.crear(tenantId, { rut: RUT_SIN_CORREO, nombre: 'Juan', rol: 'trabajador', email: '' });
    const { persona: b } = await svc.crear(tenantId, { rut: RUT_SIN_CORREO_2, nombre: 'Pedro', rol: 'trabajador', email: '   ' });
    assert.ok(!('email' in itemDe(a.personaId)));
    assert.ok(!('email' in itemDe(b.personaId)));
});

test('sin correo, la persona queda con la contraseña inicial de los cuatro dígitos, que vence en 7 días', async () => {
    const { persona } = await new PersonaService().crear(tenantId, { rut: RUT_SIN_CORREO, nombre: 'Juan', rol: 'trabajador' });
    const item = itemDe(persona.personaId);
    assert.equal(item.activacionPendiente, true);
    assert.equal(item.credencialInicial, true);
    assert.equal(item.passwordTemporal, true);
    assert.ok(Math.abs(Date.parse(item.passwordTemporalVence) - (Date.now() + 7 * 24 * 3600e3)) < 60e3);
    assert.ok((await require('../lib/credenciales').verificar('1234', item.passwordHash, persona.personaId)).valido);
});

test('con correo, se guarda sin espacios alrededor', async () => {
    const { persona } = await new PersonaService().crear(tenantId, { rut: RUT_CON_CORREO, nombre: 'Rosa', rol: 'trabajador', email: '  rosa@ejemplo.cl ' });
    assert.equal(itemDe(persona.personaId).email, 'rosa@ejemplo.cl');
});

test('borrar el correo al editar quita el atributo; no lo deja vacío', async () => {
    const svc = new PersonaService();
    const { persona } = await svc.crear(tenantId, { rut: RUT_CON_CORREO, nombre: 'Rosa', rol: 'trabajador', email: 'rosa@ejemplo.cl' });
    await svc.actualizar(tenantId, persona.personaId, { email: '' });
    assert.ok(!('email' in itemDe(persona.personaId)));
    await svc.actualizar(tenantId, persona.personaId, { email: ' nuevo@ejemplo.cl ', nivelEscolar: 'Media completa' });
    assert.equal(itemDe(persona.personaId).email, 'nuevo@ejemplo.cl');
});

// El teléfono de la persona no tiene finalidad en el sistema (21 de noviembre
// de 2026): si un cliente antiguo lo manda, no se guarda ni se devuelve.
test('el teléfono de la persona no se guarda al crear ni al editar, ni sale en la ficha', async () => {
    const svc = new PersonaService();
    const { persona } = await svc.crear(tenantId, { rut: RUT_CON_CORREO, nombre: 'Rosa', rol: 'trabajador', telefono: '912345678' });
    assert.ok(!('telefono' in itemDe(persona.personaId)));
    assert.ok(!('telefono' in persona));
    await svc.actualizar(tenantId, persona.personaId, { telefono: '912345678', nivelEscolar: 'Media completa' });
    assert.ok(!('telefono' in itemDe(persona.personaId)));
});

test('borrar el correo como único cambio también funciona', async () => {
    const svc = new PersonaService();
    const { persona } = await svc.crear(tenantId, { rut: RUT_CON_CORREO, nombre: 'Rosa', rol: 'trabajador', email: 'rosa@ejemplo.cl' });
    await svc.actualizar(tenantId, persona.personaId, { email: '  ' });
    assert.ok(!('email' in itemDe(persona.personaId)));
});

// ─── Alta manual y carga masiva, por la ruta ────────────────────────────────

test('alta manual sin correo: 201, sin contraseña en la respuesta y sin enlace', async () => {
    const res = await pedir('POST', '/personas', { rut: RUT_SIN_CORREO, nombre: 'Juan', apellidoPaterno: 'Soto', rol: 'trabajador' });
    assert.equal(res.statusCode, 201, res.body);
    const cuerpo = JSON.parse(res.body).data;
    assert.equal(cuerpo.passwordTemporal, undefined, 'ninguna contraseña vuelve a quien registra');
    assert.equal(cuerpo.password, undefined);
    assert.ok(!JSON.stringify(cuerpo).includes('"1234"'));
    assert.equal(cuerpo.enlaceActivacion, 'sin-correo');
    assert.equal(cuerpo.persona.activacionPendiente, true);
});

test('carga masiva con filas sin correo: se crean todas', async () => {
    const cola = require('./doble-cola').crearDobleCola();
    try {
        const res = await pedir('POST', '/personas/carga-masiva/confirmar', {
            filas: [
                { filaExcel: 2, rut: RUT_SIN_CORREO, nombre: 'Juan', apellidoPaterno: 'Soto', rol: 'Persona trabajadora' },
                { filaExcel: 3, rut: RUT_SIN_CORREO_2, nombre: 'Pedro', apellidoPaterno: 'Díaz', rol: 'Persona trabajadora', email: '' },
                { filaExcel: 4, rut: RUT_CON_CORREO, nombre: 'Rosa', apellidoPaterno: 'Vera', rol: 'Persona trabajadora', email: 'rosa@ejemplo.cl' },
            ],
        });
        assert.equal(res.statusCode, 202, res.body);
        const { cargaId } = JSON.parse(res.body).data;
        await cola.drenar();
        const estado = JSON.parse((await pedir('GET', `/personas/cargas/${cargaId}`)).body).data;
        assert.equal(estado.creadas, 3, JSON.stringify(estado.filasFallidas));
        assert.equal(estado.fallidas, 0);
        assert.equal(estado.estado, 'completada');
        const sinCorreo = doble.items('PERSONAS_TABLE').filter((i) => i.rol === 'Persona trabajadora' && !('email' in i));
        assert.equal(sinCorreo.length, 2);
    } finally {
        cola.restaurar();
    }
});

// ─── Entrar y recuperar ──────────────────────────────────────────────────────

test('alguien sin correo entra con los cuatro dígitos y se le pide cambiarla; activado en terreno, los cuatro dígitos dejan de servir', async () => {
    const { persona } = await new PersonaService().crear(tenantId, { rut: RUT_SIN_CORREO, nombre: 'Juan', rol: 'trabajador' });
    const ingresar = (password) => auth.login({ body: JSON.stringify({ rut: RUT_SIN_CORREO, password }), requestContext: { http: { sourceIp: '127.0.0.1' } } });
    const inicial = await ingresar('1234');
    assert.equal(inicial.statusCode, 200, inicial.body);
    assert.equal(JSON.parse(inicial.body).data.requiereCambioPassword, true);
    const activacion = await pedirComo(adminId, 'POST', `/personas/${persona.personaId}/activar-acceso`, {});
    assert.equal(activacion.statusCode, 200, activacion.body);
    const { password } = JSON.parse(activacion.body).data;
    assert.equal((await ingresar('1234')).statusCode, 401);
    const res = await ingresar(password);
    assert.equal(res.statusCode, 200, res.body);
    const d = JSON.parse(res.body).data;
    assert.ok(d.token, 'tiene sesión');
    assert.equal(d.requiereCambioPassword, true);
    assert.ok(!('credencialInicial' in itemDe(persona.personaId)));
});

test('recuperar la contraseña sin correo: respuesta genérica, nada enviado ni guardado, y le dice a quién recurrir', async () => {
    const { persona } = await new PersonaService().crear(tenantId, { rut: RUT_SIN_CORREO, nombre: 'Juan', rol: 'trabajador' });
    const res = await auth.forgotPassword({ body: JSON.stringify({ rut: RUT_SIN_CORREO }) });
    assert.equal(res.statusCode, 200);
    assert.match(JSON.parse(res.body).data.message, /pide a un administrador de tu empresa/);
    assert.equal(correos.length, 0, 'no hay a dónde mandar nada');
    assert.ok(!('resetTokenHash' in itemDe(persona.personaId)), 'ni queda un token que nadie va a recibir');
});

test('la respuesta de recuperación es idéntica con correo, sin correo y con un RUT que no existe', async () => {
    await new PersonaService().crear(tenantId, { rut: RUT_SIN_CORREO, nombre: 'Juan', rol: 'trabajador' });
    await new PersonaService().crear(tenantId, { rut: RUT_CON_CORREO, nombre: 'Rosa', rol: 'trabajador', email: 'rosa@ejemplo.cl' });
    const cuerpo = async (rut) => (await auth.forgotPassword({ body: JSON.stringify({ rut }) })).body;
    const sin = await cuerpo(RUT_SIN_CORREO);
    assert.equal(await cuerpo(RUT_CON_CORREO), sin);
    assert.equal(await cuerpo('5.555.555-5'), sin);
    assert.equal(correos.length, 1, 'solo a quien tiene correo');
});

// ─── La otra clave de índice que se escribía nula ────────────────────────────

test('/signatures/enroll está retirada: no registra una firma sin verificar el PIN', async () => {
    // Escribía `requestId: null` (clave de requestId-index) y por eso fallaba
    // siempre; pero además no verificaba el PIN. Arreglar el null la habría
    // vuelto un camino para crear firmas sin PIN.
    const firmas = require('../handlers/signatures/handler');
    const { persona } = await new PersonaService().crear(tenantId, { rut: RUT_SIN_CORREO, nombre: 'Juan', rol: 'trabajador' });
    const res = await firmas.createEnrollment({
        requestContext: { http: { method: 'POST' }, authorizer: { lambda: { sessionId: 's-1', personaId: persona.personaId, tenantId, rol: 'trabajador', permisos: '' } } },
        body: JSON.stringify({ personaId: persona.personaId, pin: '0000' }),
    });
    assert.equal(res.statusCode, 410);
    assert.equal(doble.items('SIGNATURES_TABLE').length, 0);
});
