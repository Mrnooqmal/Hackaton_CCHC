process.env.CAMPO_HMAC_KEY = 'clave-de-prueba-hmac';
process.env.CAMPO_CIFRADO_LOCAL_KEY = require('crypto').randomBytes(32).toString('base64');
process.env.CREDENCIAL_PEPPER = 'pimienta-de-prueba';

const { prepararEntorno, crearDobleTablas } = require('./doble-dynamo-tablas');
const esquemas = prepararEntorno();

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { ScanCommand, UpdateCommand, PutCommand } = require('@aws-sdk/lib-dynamodb');

const { docClient } = require('../lib/clients/dynamodb');
const { PersonaService } = require('../lib/services/PersonaService');
const { TenantService } = require('../lib/services/TenantService');
const { ALL_PERMISSION_KEYS, DEFAULT_ROLE_PRESETS, PERMISSIONS } = require('../lib/permissions');
const { sesionDesdeToken, hashToken } = require('../lib/auth/sesion');
const notificaciones = require('../handlers/notifications/handler');
const personas = require('../handlers/personas-module/handler');
const auth = require('../handlers/auth/handler');

const MOTIVO = 'Olvidó su contraseña y no tiene correo';
const PERMISO = 'persona.restablecer_contrasena';

let doble;
let correos;
let original;
let tenantA;
let tenantB;
let ids;

const alta = async (tenantId, rut, rol, extra = {}) => (await new PersonaService().crear(tenantId, {
    rut, nombre: rol, apellidoPaterno: 'Prueba', rol, tieneAccesoWeb: true, ...extra,
})).persona.personaId;

beforeEach(async () => {
    doble = crearDobleTablas(docClient, esquemas, { proyecciones: true });
    correos = [];
    original = notificaciones.sendContrasenaRestablecidaEmail;
    notificaciones.sendContrasenaRestablecidaEmail = async (email, nombre, datos) => { correos.push({ email, nombre, datos }); return { sent: true }; };
    tenantA = (await new TenantService().setup({ nombre: 'Constructora A', rutEmpresa: '76.543.210-3' })).tenantId;
    tenantB = (await new TenantService().setup({ nombre: 'Constructora B', rutEmpresa: '77.777.777-7' })).tenantId;
    ids = {
        admin: await alta(tenantA, '9.876.543-3', 'admin', { password: 'Clave-admin-1' }),
        prevencionista: await alta(tenantA, '11.111.111-1', 'prevencionista', { password: 'Clave-prev-1' }),
        otroAdmin: await alta(tenantA, '14.141.414-3', 'admin', { password: 'Clave-otro-1' }),
        trabajador: await alta(tenantA, '12.345.678-5', 'trabajador', { password: 'Propia-1', email: 'juan@ejemplo.cl' }),
        pendiente: await alta(tenantA, '17.171.717-5', 'trabajador'),
        deOtraEmpresa: await alta(tenantB, '15.151.515-0', 'trabajador', { password: 'Propia-1' }),
    };
});
afterEach(() => {
    notificaciones.sendContrasenaRestablecidaEmail = original;
    doble.restaurar();
});

const SESIONES = {
    admin: () => ({ personaId: ids.admin, rol: 'admin', permisos: ALL_PERMISSION_KEYS }),
    prevencionista: () => ({ personaId: ids.prevencionista, rol: 'prevencionista', permisos: DEFAULT_ROLE_PRESETS.prevencionista }),
    prevencionistaConPermiso: () => ({ personaId: ids.prevencionista, rol: 'prevencionista', permisos: [...DEFAULT_ROLE_PRESETS.prevencionista, PERMISO] }),
};

const restablecer = async (quien, personaId, motivo = MOTIVO) => {
    const s = SESIONES[quien]();
    const res = await personas.personasHandler({
        requestContext: {
            http: { method: 'POST', sourceIp: '10.0.0.1' },
            authorizer: { lambda: { sessionId: `s-${quien}`, personaId: s.personaId, tenantId: tenantA, rol: s.rol, permisos: s.permisos.join(',') } },
        },
        rawPath: `/personas/${personaId}/restablecer-contrasena`,
        body: JSON.stringify({ motivo }),
    });
    return { status: res.statusCode, cuerpo: JSON.parse(res.body) };
};

const filas = async (tabla) => (await docClient.send(new ScanCommand({ TableName: tabla }))).Items || [];
const item = (personaId) => new PersonaService().getItemById(personaId);
const ingresar = async (rut, password) => {
    const res = await auth.login({ body: JSON.stringify({ rut, password }), requestContext: { http: { sourceIp: '10.0.0.1' } }, headers: {} });
    return { status: res.statusCode, cuerpo: JSON.parse(res.body) };
};
const sesionAbierta = async (personaId, tenantId) => {
    const token = crypto.randomBytes(32).toString('hex');
    await docClient.send(new PutCommand({ TableName: 'SESSIONS_TABLE', Item: {
        sessionId: `s-${personaId}`, personaId, tenantId, tokenHash: hashToken(token),
        activa: true, expiresAt: new Date(Date.now() + 3600e3).toISOString(),
    } }));
    return token;
};
const todo = async () => JSON.stringify(await Promise.all(['PERSONAS_TABLE', 'INBOX_TABLE', 'AUDITORIA_ACCESOS_TABLE', 'SESSIONS_TABLE'].map(filas)));

test('el administrador restablece a quien olvidó su contraseña: temporal de 72 horas, mostrada una sola vez', async () => {
    const token = await sesionAbierta(ids.trabajador, tenantA);
    const r = await restablecer('admin', ids.trabajador);
    assert.equal(r.status, 200, JSON.stringify(r.cuerpo));
    const { password, vence, sesionesCerradas, correo } = r.cuerpo.data;
    assert.match(password, /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    assert.ok(!/[01OIL]/.test(password));
    assert.ok(Math.abs(Date.parse(vence) - (Date.now() + 72 * 3600e3)) < 60e3);
    assert.equal(sesionesCerradas, true);
    assert.equal(correo, 'enviado');

    assert.equal(await sesionDesdeToken(token), null, 'las sesiones de esa ficha se cierran');
    assert.equal((await ingresar('12.345.678-5', 'Propia-1')).status, 401, 'la anterior ya no sirve');
    const entrada = await ingresar('12.345.678-5', password);
    assert.equal(entrada.status, 200, JSON.stringify(entrada.cuerpo));
    assert.equal(entrada.cuerpo.data.requiereCambioPassword, true);

    const ficha = await item(ids.trabajador);
    assert.equal(ficha.passwordRestablecido.por, ids.admin);
    assert.equal(ficha.passwordRestablecido.motivo, MOTIVO);
    assert.ok(!ficha.activacionPendiente, 'no vuelve a quedar pendiente de activación');
});

test('la contraseña temporal no queda en la bandeja, la auditoría, las sesiones, la ficha ni el correo', async () => {
    const r = await restablecer('admin', ids.trabajador);
    const { password } = r.cuerpo.data;
    assert.ok(!(await todo()).includes(password));
    assert.ok(!JSON.stringify(correos).includes(password));

    const aviso = (await filas('INBOX_TABLE')).find((m) => m.recipientId === ids.trabajador);
    assert.match(aviso.subject, /restablecida/);
    assert.match(aviso.content, new RegExp(MOTIVO));
    const registro = (await filas('AUDITORIA_ACCESOS_TABLE')).find((x) => x.operacion === 'credencial.contrasena_restablecida');
    assert.equal(registro.actorId, ids.admin);
    assert.deepEqual(registro.titulares, [ids.trabajador]);
    assert.equal(registro.detalle.motivo, MOTIVO);
    assert.equal(correos.length, 1);
    assert.equal(correos[0].email, 'juan@ejemplo.cl');
    assert.equal(correos[0].datos.motivo, MOTIVO);
});

test('la temporal abre solo esa empresa, y el cambio desde ella no se copia a la otra (D1)', async () => {
    const enB = await alta(tenantB, '12.345.678-5', 'trabajador', { password: 'Propia-1' });
    const r = await restablecer('admin', ids.trabajador);
    const abre = async (password) => {
        const e = await ingresar('12.345.678-5', password);
        if (e.status !== 200) return [];
        return e.cuerpo.data.requiereSeleccionTenant ? e.cuerpo.data.opciones.map((o) => o.tenantId).sort() : [(await sesionDesdeToken(e.cuerpo.data.token)).tenantId];
    };
    assert.deepEqual(await abre(r.cuerpo.data.password), [tenantA]);
    assert.deepEqual(await abre('Propia-1'), [tenantB], 'en la otra empresa sigue la anterior');

    const entrada = await ingresar('12.345.678-5', r.cuerpo.data.password);
    const sesion = await sesionDesdeToken(entrada.cuerpo.data.token);
    const cambio = await auth.changePassword({
        requestContext: {
            http: { method: 'POST', path: '/auth/change-password', sourceIp: '10.0.0.1' },
            authorizer: { lambda: { sessionId: sesion.sessionId, personaId: ids.trabajador, tenantId: tenantA, rol: 'trabajador', permisos: '', credencialProvisional: 'true' } },
        },
        rawPath: '/auth/change-password',
        headers: { 'user-agent': 'prueba' },
        body: JSON.stringify({ passwordNuevo: 'Nueva-clave-1', confirmarPassword: 'Nueva-clave-1' }),
    });
    assert.equal(cambio.statusCode, 200, cambio.body);
    assert.deepEqual(await abre('Nueva-clave-1'), [tenantA]);
    assert.deepEqual(await abre('Propia-1'), [tenantB]);
    const ficha = await item(ids.trabajador);
    assert.equal(ficha.passwordRestablecido, undefined, 'elegir la nueva cierra el restablecimiento');
    assert.equal(ficha.passwordTemporal, false);
    assert.equal((await item(enB)).passwordRestablecido, undefined);
});

test('vencida, la temporal responde igual que una contraseña equivocada, y se puede restablecer de nuevo', async () => {
    const r = await restablecer('admin', ids.trabajador);
    await docClient.send(new UpdateCommand({
        TableName: 'PERSONAS_TABLE', Key: { PK: `TENANT#${tenantA}`, SK: `PERSONA#${ids.trabajador}` },
        UpdateExpression: 'SET passwordTemporalVence = :v', ExpressionAttributeValues: { ':v': new Date(Date.now() - 1000).toISOString() },
    }));
    const vencida = await ingresar('12.345.678-5', r.cuerpo.data.password);
    assert.equal(vencida.status, 401);
    assert.deepEqual(vencida.cuerpo, (await ingresar('12.345.678-5', 'Equivocada-1')).cuerpo);
    const otra = await restablecer('admin', ids.trabajador);
    assert.equal(otra.status, 200);
    assert.equal((await ingresar('12.345.678-5', otra.cuerpo.data.password)).status, 200);
});

test('límites: sin el permiso 403, otra empresa 404, uno mismo 403, quien tiene más permisos 403; y nada escrito', async () => {
    const antes = await todo();
    assert.equal((await restablecer('prevencionista', ids.trabajador)).status, 403, 'el permiso no viene en los roles por omisión');
    assert.equal((await restablecer('admin', ids.deOtraEmpresa)).status, 404);
    assert.equal((await restablecer('admin', ids.admin)).status, 403);
    const ajeno = await restablecer('prevencionistaConPermiso', ids.otroAdmin);
    assert.equal(ajeno.status, 403);
    assert.match(ajeno.cuerpo.error, /permisos que tú no tienes/);
    assert.equal(await todo(), antes);
    assert.equal((await restablecer('prevencionistaConPermiso', ids.trabajador)).status, 200, 'con el permiso asignado, sí a quien tiene menos');
});

test('solo el administrador trae el permiso por omisión', () => {
    assert.equal(PERMISSIONS.PERSONA_RESTABLECER_CONTRASENA, PERMISO);
    assert.ok(ALL_PERMISSION_KEYS.includes(PERMISO));
    for (const [rol, permisos] of Object.entries(DEFAULT_ROLE_PRESETS)) {
        if (rol !== 'admin') assert.ok(!permisos.includes(PERMISO), rol);
    }
});

test('estado de la persona: desvinculada, suspendida, sin acceso web o pendiente de activación responden 409 sin escribir', async () => {
    for (const [rut, campo, valor] of [['23.232.323-K', 'estado', 'desvinculado'], ['24.242.424-7', 'estado', 'suspendido'], ['25.252.525-4', 'tieneAccesoWeb', false]]) {
        const id = await alta(tenantA, rut, 'trabajador', { password: 'Propia-1' });
        await docClient.send(new UpdateCommand({
            TableName: 'PERSONAS_TABLE', Key: { PK: `TENANT#${tenantA}`, SK: `PERSONA#${id}` },
            UpdateExpression: 'SET #c = :v', ExpressionAttributeNames: { '#c': campo }, ExpressionAttributeValues: { ':v': valor },
        }));
        const antes = await item(id);
        const r = await restablecer('admin', id);
        assert.equal(r.status, 409, `${campo}=${valor}: ${JSON.stringify(r.cuerpo)}`);
        assert.deepEqual(await item(id), antes);
    }
    const pendiente = await restablecer('admin', ids.pendiente);
    assert.equal(pendiente.status, 409);
    assert.match(pendiente.cuerpo.error, /todavía no elige su contraseña/);
});

test('el motivo: entre 10 y 120 caracteres, y sin RUT ni correo', async () => {
    for (const motivo of ['', 'corto', 'x'.repeat(121), 'Lo pidió el 12.345.678-5 por teléfono', 'Pidió que se lo mande a juan@ejemplo.cl']) {
        const r = await restablecer('admin', ids.trabajador, motivo);
        assert.equal(r.status, 400, motivo);
    }
    assert.equal((await filas('INBOX_TABLE')).length, 0);
    assert.equal((await restablecer('admin', ids.trabajador, 'x'.repeat(120))).status, 200);
});

test('si la contraseña cambió entre la lectura y la escritura, 409 y nada escrito', async () => {
    const svc = PersonaService.prototype;
    const leer = svc.getItemById;
    svc.getItemById = async function (id) {
        const it = await leer.call(this, id);
        return id === ids.trabajador ? { ...it, passwordHash: 'hash-viejo' } : it;
    };
    try {
        const r = await restablecer('admin', ids.trabajador);
        assert.equal(r.status, 409);
    } finally {
        svc.getItemById = leer;
    }
    assert.equal((await filas('INBOX_TABLE')).length, 0);
    assert.equal((await ingresar('12.345.678-5', 'Propia-1')).status, 200);
});

test('si el aviso por correo falla, el restablecimiento queda hecho y lo dice', async () => {
    notificaciones.sendContrasenaRestablecidaEmail = async () => ({ sent: false, error: 'Throttling' });
    const r = await restablecer('admin', ids.trabajador);
    assert.equal(r.status, 200);
    assert.equal(r.cuerpo.data.correo, 'fallido');
    assert.equal((await ingresar('12.345.678-5', r.cuerpo.data.password)).status, 200);
});

test('D8: cinco restablecimientos de la misma cuenta en una hora generan una alerta', async () => {
    const ruts = ['16.161.616-8', '18.181.818-2', '19.191.919-K', '21.212.121-5', '22.222.222-2'];
    for (const rut of ruts) {
        const id = await alta(tenantA, rut, 'trabajador', { password: 'Propia-1' });
        assert.equal((await restablecer('admin', id)).status, 200, rut);
    }
    const alertas = (await filas('AUDITORIA_ACCESOS_TABLE')).filter((x) => x.operacion === 'alerta.restablecimientos_reiterados');
    assert.equal(alertas.length, 1);
});

test('script de operador: el ensayo no escribe nada; con --confirmar el actor es el operador y el aviso dice Soporte', async () => {
    const script = require('../scripts/restablecer-contrasena');
    const antes = await todo();
    const e = await script.ensayo({ tenantId: tenantA, rut: '12.345.678-5' });
    assert.equal(await todo(), antes);
    assert.deepEqual({ ...e, personaId: undefined }, {
        empresa: tenantA, personaId: undefined, rol: 'trabajador', estado: e.estado,
        tieneCorreo: true, unicoAdministrador: false, sesionesAbiertas: 0, empresasDelRut: 1,
    });
    assert.equal(e.personaId, ids.trabajador);
    assert.equal((await script.ensayo({ tenantId: tenantA, rut: '9.876.543-3' })).unicoAdministrador, false, 'hay otro administrador');

    const operador = { id: 'arn:aws:iam::000000000000:user/soporte', tipo: 'operador', nombre: 'Soporte de Build & Serve' };
    const r = await script.restablecer({ tenantId: tenantA, rut: '12.345.678-5', motivo: 'TICKET-42 confirmado por teléfono', actor: operador });
    assert.equal((await ingresar('12.345.678-5', r.password)).status, 200);
    const registro = (await filas('AUDITORIA_ACCESOS_TABLE')).find((x) => x.operacion === 'credencial.contrasena_restablecida');
    assert.equal(registro.actorId, operador.id);
    assert.match((await filas('INBOX_TABLE'))[0].content, /^Soporte de Build & Serve restableció tu contraseña/);
});
