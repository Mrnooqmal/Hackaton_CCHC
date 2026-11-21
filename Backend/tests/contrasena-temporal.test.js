process.env.CAMPO_HMAC_KEY = 'clave-de-prueba-hmac';
process.env.CAMPO_CIFRADO_LOCAL_KEY = require('crypto').randomBytes(32).toString('base64');
process.env.CREDENCIAL_PEPPER = 'pimienta-de-prueba';

const { prepararEntorno, crearDobleTablas } = require('./doble-dynamo-tablas');
const esquemas = prepararEntorno();

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { PutCommand, UpdateCommand, ScanCommand } = require('@aws-sdk/lib-dynamodb');

const { docClient } = require('../lib/clients/dynamodb');
const { PersonaService } = require('../lib/services/PersonaService');
const { TenantService } = require('../lib/services/TenantService');
const { sesionDesdeToken, hashToken } = require('../lib/auth/sesion');
const credenciales = require('../lib/credenciales');
const auditoria = require('../lib/gobernanza/auditoria');
const auth = require('../handlers/auth/handler');

const RUT = '12.345.678-5';
const ACTOR = { id: 'p-admin', tipo: 'persona', nombre: 'Ana Admin', rol: 'admin' };
const AVISO = { asunto: 'Tu acceso fue activado', contenido: 'Ana Admin activó tu acceso.' };

let doble;
let tenantId;
let personaId;
let consola;

beforeEach(async () => {
    doble = crearDobleTablas(docClient, esquemas, { proyecciones: true });
    tenantId = (await new TenantService().setup({ nombre: 'Constructora A', rutEmpresa: '76.543.210-3' })).tenantId;
    personaId = (await new PersonaService().crear(tenantId, {
        rut: RUT, nombre: 'Juan', rol: 'trabajador', tieneAccesoWeb: true,
    })).persona.personaId;
    consola = [];
    for (const m of ['log', 'info', 'warn', 'error']) {
        const orig = console[m];
        console[m] = (...a) => { consola.push(a.map(String).join(' ')); };
        console[m].orig = orig;
    }
});
afterEach(() => {
    for (const m of ['log', 'info', 'warn', 'error']) if (console[m].orig) console[m] = console[m].orig;
    doble.restaurar();
});

const emitir = (opciones = {}) => new PersonaService().emitirTemporal(tenantId, personaId, {
    horas: 2, actor: ACTOR, operacion: 'credencial.acceso_activado', exigir: 'pendiente', aviso: AVISO, ...opciones,
});

const ingresar = async (password) => {
    const res = await auth.login({
        body: JSON.stringify({ rut: RUT, password }),
        requestContext: { http: { sourceIp: '10.0.0.1' } },
        headers: { 'user-agent': 'prueba' },
    });
    return { status: res.statusCode, cuerpo: JSON.parse(res.body) };
};

const todo = async () => {
    const tablas = {};
    for (const t of Object.keys(esquemas)) tablas[t] = (await docClient.send(new ScanCommand({ TableName: t }))).Items || [];
    return tablas;
};

test('el formato se puede dictar: 12 caracteres en tres grupos, sin caracteres que se confunden', () => {
    const vistas = new Set();
    for (let i = 0; i < 2000; i++) {
        const p = credenciales.generarTemporal();
        assert.match(p, /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
        assert.ok(!/[01OIL]/.test(p), p);
        vistas.add(p);
    }
    assert.equal(vistas.size, 2000);
    assert.equal(credenciales.ALFABETO_TEMPORAL.length, 31);
});

test('usa todo el alfabeto, sin sesgo grueso', () => {
    const cuenta = {};
    for (let i = 0; i < 3000; i++) for (const ch of credenciales.generarTemporal().replace(/-/g, '')) cuenta[ch] = (cuenta[ch] || 0) + 1;
    const valores = Object.values(cuenta);
    assert.equal(valores.length, 31);
    const media = 36000 / 31;
    assert.ok(Math.min(...valores) > media * 0.85 && Math.max(...valores) < media * 1.15, JSON.stringify(cuenta));
});

test('emitir deja una temporal que abre la cuenta, con vencimiento y cambio obligatorio', async () => {
    const antes = Date.now();
    const r = await emitir();

    const item = await new PersonaService().getItemById(personaId);
    assert.equal((await credenciales.verificar(r.password, item.passwordHash, personaId)).valido, true);
    assert.equal(item.passwordTemporal, true);
    assert.equal(item.activacionPendiente, true, 'sigue pendiente hasta que elija su contraseña');
    const vence = new Date(item.passwordTemporalVence).getTime();
    assert.ok(Math.abs(vence - (antes + 2 * 3600e3)) < 60e3);
    assert.equal(r.vence, item.passwordTemporalVence);
    assert.equal(item.credencialHistorial.at(-1).por, ACTOR.id);

    const entrada = await ingresar(r.password);
    assert.equal(entrada.status, 200, JSON.stringify(entrada.cuerpo));
    assert.equal(entrada.cuerpo.data.requiereCambioPassword, true);
});

test('el aviso en la bandeja y el registro de auditoría van en la misma escritura, sellados', async () => {
    await emitir();
    const tablas = await todo();
    const avisos = tablas.INBOX_TABLE.filter((m) => m.recipientId === personaId);
    assert.equal(avisos.length, 1);
    assert.equal(avisos[0].subject, AVISO.asunto);
    const registros = tablas.AUDITORIA_ACCESOS_TABLE.filter((x) => x.operacion === 'credencial.acceso_activado');
    assert.equal(registros.length, 1);
    assert.equal(registros[0].actorId, ACTOR.id);
    assert.deepEqual(registros[0].titulares, [personaId]);
    assert.equal(registros[0].detalle.vigenciaHoras, 2);
    assert.equal(await auditoria.verificarSello(registros[0]), 'integro');
});

test('la contraseña no queda en ninguna tabla ni en la consola', async () => {
    const r = await emitir();
    const tablas = JSON.stringify(await todo());
    assert.ok(!tablas.includes(r.password));
    assert.ok(!tablas.includes(r.password.replace(/-/g, '')));
    assert.ok(!consola.some((l) => l.includes(r.password)), 'nada en la consola');
});

test('cierra las sesiones abiertas de esa ficha', async () => {
    const token = crypto.randomBytes(32).toString('hex');
    await docClient.send(new PutCommand({ TableName: 'SESSIONS_TABLE', Item: {
        sessionId: 's-1', personaId, tenantId, tokenHash: hashToken(token), activa: true,
        expiresAt: new Date(Date.now() + 3600e3).toISOString(),
    } }));
    const r = await emitir();
    assert.equal(r.sesionesCerradas, true);
    assert.equal(await sesionDesdeToken(token), null);
});

test('si la cuenta cambió entre la lectura y la escritura, no escribe nada', async () => {
    const servicio = new PersonaService();
    const leer = servicio.getItemById.bind(servicio);
    servicio.getItemById = async (id) => {
        const item = await leer(id);
        await docClient.send(new UpdateCommand({
            TableName: 'PERSONAS_TABLE', Key: { PK: `TENANT#${tenantId}`, SK: `PERSONA#${personaId}` },
            UpdateExpression: 'SET passwordHash = :h REMOVE activacionPendiente', ExpressionAttributeValues: { ':h': 'otro' },
        }));
        return item;
    };
    await assert.rejects(() => servicio.emitirTemporal(tenantId, personaId, {
        horas: 2, actor: ACTOR, operacion: 'credencial.acceso_activado', exigir: 'pendiente', aviso: AVISO,
    }), (e) => e.codigo === 'TEMPORAL_CONFLICTO');
    const tablas = await todo();
    assert.equal(tablas.INBOX_TABLE.length, 0);
    assert.equal(tablas.AUDITORIA_ACCESOS_TABLE.filter((x) => x.operacion === 'credencial.acceso_activado').length, 0);
});

test('se puede volver a activar mientras no elija su contraseña, y la temporal anterior deja de servir', async () => {
    const primera = await emitir();
    const segunda = await emitir();
    const item = await new PersonaService().getItemById(personaId);
    assert.equal((await credenciales.verificar(primera.password, item.passwordHash, personaId)).valido, false);
    assert.equal((await credenciales.verificar(segunda.password, item.passwordHash, personaId)).valido, true);
});

test('no se activa a quien ya eligió su contraseña, y lo dice', async () => {
    await emitir();
    await docClient.send(new UpdateCommand({
        TableName: 'PERSONAS_TABLE', Key: { PK: `TENANT#${tenantId}`, SK: `PERSONA#${personaId}` },
        UpdateExpression: 'SET passwordTemporal = :f REMOVE activacionPendiente, passwordTemporalVence', ExpressionAttributeValues: { ':f': false },
    }));
    await assert.rejects(() => emitir(), (e) => e.codigo === 'TEMPORAL_CONFLICTO' && /ya eligió su contraseña/.test(e.message));
});

test('si otro la activó entre la lectura y la escritura, no se emite una segunda temporal', async () => {
    const servicio = new PersonaService();
    const leer = servicio.getItemById.bind(servicio);
    servicio.getItemById = async (id) => {
        const item = await leer(id);
        await docClient.send(new UpdateCommand({
            TableName: 'PERSONAS_TABLE', Key: { PK: `TENANT#${tenantId}`, SK: `PERSONA#${personaId}` },
            UpdateExpression: 'REMOVE activacionPendiente',
        }));
        return item;
    };
    await assert.rejects(() => servicio.emitirTemporal(tenantId, personaId, {
        horas: 2, actor: ACTOR, operacion: 'credencial.acceso_activado', exigir: 'pendiente', aviso: AVISO,
    }), (e) => e.codigo === 'TEMPORAL_CONFLICTO');
    assert.equal((await todo()).INBOX_TABLE.length, 0);
});

test('no emite para una persona de otra empresa', async () => {
    await assert.rejects(() => new PersonaService().emitirTemporal('otra-empresa', personaId, {
        horas: 2, actor: ACTOR, operacion: 'credencial.acceso_activado', exigir: 'pendiente', aviso: AVISO,
    }), (e) => e.codigo === 'PERSONA_NO_ENCONTRADA');
    assert.equal((await todo()).INBOX_TABLE.length, 0);
});

test('una temporal vencida no abre la cuenta y lo dice', async () => {
    const r = await emitir();
    await docClient.send(new UpdateCommand({
        TableName: 'PERSONAS_TABLE', Key: { PK: `TENANT#${tenantId}`, SK: `PERSONA#${personaId}` },
        UpdateExpression: 'SET passwordTemporalVence = :v', ExpressionAttributeValues: { ':v': new Date(Date.now() - 1000).toISOString() },
    }));
    const entrada = await ingresar(r.password);
    assert.equal(entrada.status, 401);
    assert.match(entrada.cuerpo.error, /venció/);
    assert.ok(!entrada.cuerpo.data?.token);

    const otra = await ingresar('Equivocada-1');
    assert.equal(otra.status, 401);
    assert.doesNotMatch(otra.cuerpo.error, /venció/, 'una contraseña equivocada no revela nada');
});

test('al cambiar la temporal se borra el vencimiento', async () => {
    const r = await emitir();
    const entrada = await ingresar(r.password);
    const sesion = await sesionDesdeToken(entrada.cuerpo.data.token);
    const res = await auth.changePassword({
        requestContext: {
            http: { method: 'POST', path: '/auth/change-password', sourceIp: '10.0.0.1' },
            authorizer: { lambda: { sessionId: sesion.sessionId, personaId, tenantId, rol: 'trabajador', permisos: '', credencialProvisional: 'true' } },
        },
        rawPath: '/auth/change-password',
        headers: { 'user-agent': 'prueba' },
        body: JSON.stringify({ passwordNuevo: 'Elegida-1', confirmarPassword: 'Elegida-1' }),
    });
    assert.equal(res.statusCode, 200, res.body);
    const item = await new PersonaService().getItemById(personaId);
    assert.equal(item.passwordTemporal, false);
    assert.equal(item.passwordTemporalVence, undefined);
    assert.equal(item.activacionPendiente, undefined, 'elegir su contraseña termina la activación');
});

test('una ficha nueva queda pendiente de activación, sin contraseña que adivinar', async () => {
    const item = await new PersonaService().getItemById(personaId);
    assert.equal(item.activacionPendiente, true);
    assert.ok(!item.passwordHash);
    assert.equal((await ingresar('1234')).status, 401);
});

test('una ficha vieja con los cuatro dígitos no entra, y se puede activar como una pendiente', async () => {
    await docClient.send(new UpdateCommand({
        TableName: 'PERSONAS_TABLE', Key: { PK: `TENANT#${tenantId}`, SK: `PERSONA#${personaId}` },
        UpdateExpression: 'SET passwordHash = :h, passwordTemporal = :si REMOVE activacionPendiente',
        ExpressionAttributeValues: { ':h': await credenciales.hashear('1234', personaId), ':si': true },
    }));
    const vieja = await ingresar('1234');
    assert.equal(vieja.status, 401);
    assert.match(vieja.cuerpo.error, /venció/);

    const r = await emitir();
    assert.equal((await ingresar(r.password)).status, 200);
    assert.equal((await new PersonaService().getItemById(personaId)).activacionPendiente, true);
});
