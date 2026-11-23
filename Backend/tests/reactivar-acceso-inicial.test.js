process.env.CAMPO_HMAC_KEY = 'clave-de-prueba-hmac';
process.env.CAMPO_CIFRADO_LOCAL_KEY = require('crypto').randomBytes(32).toString('base64');
process.env.CREDENCIAL_PEPPER = 'pimienta-de-prueba';
process.env.FRONTEND_URL = 'https://app.ejemplo.cl';

const { prepararEntorno, crearDobleTablas } = require('./doble-dynamo-tablas');
const esquemas = prepararEntorno();

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { ScanCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');

const { docClient } = require('../lib/clients/dynamodb');
const { PersonaService } = require('../lib/services/PersonaService');
const { TenantService } = require('../lib/services/TenantService');
const { ALL_PERMISSION_KEYS, DEFAULT_ROLE_PRESETS } = require('../lib/permissions');
const credenciales = require('../lib/credenciales');
const notificaciones = require('../handlers/notifications/handler');
const personas = require('../handlers/personas-module/handler');
const auth = require('../handlers/auth/handler');

const SIETE_DIAS = 7 * 24 * 3600e3;
const OBRA = 'obra-norte';
const OTRA_OBRA = 'obra-sur';

let doble;
let original;
let tenantA;
let tenantB;
let ids;

const alta = async (tenantId, rut, rol, extra = {}) => (await new PersonaService().crear(tenantId, {
    rut, nombre: rol, apellidoPaterno: 'Prueba', rol, tieneAccesoWeb: true, obraIds: [OBRA], ...extra,
})).persona.personaId;

beforeEach(async () => {
    doble = crearDobleTablas(docClient, esquemas, { proyecciones: true });
    original = notificaciones.sendActivacionEmail;
    notificaciones.sendActivacionEmail = async () => ({ sent: true });
    tenantA = (await new TenantService().setup({ nombre: 'Constructora A', rutEmpresa: '76.543.210-3' })).tenantId;
    tenantB = (await new TenantService().setup({ nombre: 'Constructora B', rutEmpresa: '77.777.777-7' })).tenantId;
    ids = {
        admin: await alta(tenantA, '9.876.543-3', 'admin', { password: 'Clave-admin-1' }),
        prevencionista: await alta(tenantA, '11.111.111-1', 'prevencionista', { password: 'Clave-prev-1' }),
        trabajador: await alta(tenantA, '12.345.678-5', 'trabajador'),
        otro: await alta(tenantA, '17.171.717-5', 'trabajador'),
        otroAdmin: await alta(tenantA, '14.141.414-3', 'admin'),
        deOtraObra: await alta(tenantA, '18.181.818-2', 'trabajador', { obraIds: [OTRA_OBRA] }),
        activo: await alta(tenantA, '19.191.919-K', 'trabajador', { password: 'Propia-1' }),
        deOtraEmpresa: await alta(tenantB, '15.151.515-0', 'trabajador'),
    };
});
afterEach(() => {
    notificaciones.sendActivacionEmail = original;
    doble.restaurar();
});

const SESIONES = {
    admin: () => ({ personaId: ids.admin, rol: 'admin', permisos: ALL_PERMISSION_KEYS }),
    prevencionista: () => ({ personaId: ids.prevencionista, rol: 'prevencionista', permisos: DEFAULT_ROLE_PRESETS.prevencionista }),
    sinPermiso: () => ({ personaId: ids.prevencionista, rol: 'prevencionista', permisos: DEFAULT_ROLE_PRESETS.prevencionista.filter((p) => p !== 'persona.activar_acceso') }),
};

const llamar = async (quien, rawPath, cuerpo = {}) => {
    const s = SESIONES[quien]();
    const res = await personas.personasHandler({
        requestContext: {
            http: { method: 'POST', sourceIp: '10.0.0.1' },
            authorizer: { lambda: { sessionId: `s-${quien}`, personaId: s.personaId, tenantId: tenantA, rol: s.rol, permisos: s.permisos.join(',') } },
        },
        rawPath,
        body: JSON.stringify(cuerpo),
    });
    return { status: res.statusCode, cuerpo: JSON.parse(res.body) };
};
const reactivarFicha = (quien, personaId) => llamar(quien, `/personas/${personaId}/reactivar-inicial`);
const reactivarObra = (quien, obraId = OBRA) => llamar(quien, '/personas/reactivar-inicial', { obraId });

const filas = async (tabla) => (await docClient.send(new ScanCommand({ TableName: tabla }))).Items || [];
const item = (personaId) => new PersonaService().getItemById(personaId);
const ingresar = async (rut, password) => {
    const res = await auth.login({ body: JSON.stringify({ rut, password }), requestContext: { http: { sourceIp: '10.0.0.1' } }, headers: {} });
    return { status: res.statusCode, cuerpo: JSON.parse(res.body) };
};
const fijar = (tenantId, personaId, expresion, valores = {}) => docClient.send(new UpdateCommand({
    TableName: 'PERSONAS_TABLE', Key: { PK: `TENANT#${tenantId}`, SK: `PERSONA#${personaId}` },
    UpdateExpression: expresion, ...(Object.keys(valores).length ? { ExpressionAttributeValues: valores } : {}),
}));
const vencer = (personaId, tenantId = tenantA) => fijar(tenantId, personaId, 'SET passwordTemporalVence = :v', { ':v': new Date(Date.now() - 1000).toISOString() });
const cercaDe = (iso, ms) => Math.abs(Date.parse(iso) - ms) < 60e3;

test('reactivar la ficha de alguien con la inicial vencida le da otros 7 días con los cuatro dígitos', async () => {
    await vencer(ids.trabajador);
    assert.equal((await ingresar('12.345.678-5', '1234')).status, 401);

    const r = await reactivarFicha('admin', ids.trabajador);
    assert.equal(r.status, 200, JSON.stringify(r.cuerpo));
    assert.ok(cercaDe(r.cuerpo.data.vence, Date.now() + SIETE_DIAS));

    const entrada = await ingresar('12.345.678-5', '1234');
    assert.equal(entrada.status, 200, JSON.stringify(entrada.cuerpo));
    assert.equal(entrada.cuerpo.data.requiereCambioPassword, true);

    const registro = (await filas('AUDITORIA_ACCESOS_TABLE')).find((x) => x.operacion === 'credencial.inicial_reactivada');
    assert.equal(registro.actorId, ids.admin);
    assert.deepEqual(registro.titulares, [ids.trabajador]);
    const avisos = (await filas('INBOX_TABLE')).filter((m) => m.recipientId === ids.trabajador);
    assert.equal(avisos.length, 1);
    assert.match(avisos[0].subject, /reactivado/);
});

test('una ficha pendiente sin contraseña (alta de D-40) recibe los cuatro dígitos al reactivarla', async () => {
    await fijar(tenantA, ids.trabajador, 'SET passwordTemporal = :no REMOVE passwordHash, passwordTemporalVence, credencialInicial', { ':no': false });
    assert.equal((await ingresar('12.345.678-5', '1234')).status, 401);

    assert.equal((await reactivarFicha('admin', ids.trabajador)).status, 200);
    const despues = await item(ids.trabajador);
    assert.equal(despues.credencialInicial, true);
    assert.equal(despues.activacionPendiente, true);
    assert.equal((await ingresar('12.345.678-5', '1234')).status, 200);
});

test('una ficha vieja con los cuatro dígitos y sin vencimiento se puede reactivar', async () => {
    await fijar(tenantA, ids.trabajador, 'REMOVE passwordTemporalVence, credencialInicial, activacionPendiente');
    assert.equal((await ingresar('12.345.678-5', '1234')).status, 401);
    assert.equal((await reactivarFicha('admin', ids.trabajador)).status, 200);
    assert.equal((await ingresar('12.345.678-5', '1234')).status, 200);
});

test('con una temporal de 2 horas vigente no se reactiva: 409 y nada cambia', async () => {
    const activacion = await llamar('admin', `/personas/${ids.trabajador}/activar-acceso`);
    assert.equal(activacion.status, 200);
    const antes = await item(ids.trabajador);
    const r = await reactivarFicha('admin', ids.trabajador);
    assert.equal(r.status, 409);
    assert.match(r.cuerpo.error, /temporal vigente/);
    assert.deepEqual(await item(ids.trabajador), antes);
    assert.equal((await ingresar('12.345.678-5', activacion.cuerpo.data.password)).status, 200);
});

test('con la temporal de 2 horas vencida sí se reactiva, y vuelven los cuatro dígitos', async () => {
    await llamar('admin', `/personas/${ids.trabajador}/activar-acceso`);
    await vencer(ids.trabajador);
    assert.equal((await reactivarFicha('admin', ids.trabajador)).status, 200);
    assert.equal((await ingresar('12.345.678-5', '1234')).status, 200);
});

test('a quien ya eligió su contraseña no se le reactiva (409)', async () => {
    const r = await reactivarFicha('admin', ids.activo);
    assert.equal(r.status, 409);
    assert.match(r.cuerpo.error, /ya eligió su contraseña/);
    assert.equal((await ingresar('19.191.919-K', '1919')).status, 401);
});

test('permisos de la reactivación por ficha: sin permiso 403, otra empresa 404, la propia 403, permisos ajenos 403', async () => {
    assert.equal((await reactivarFicha('sinPermiso', ids.trabajador)).status, 403);
    assert.equal((await reactivarFicha('admin', ids.deOtraEmpresa)).status, 404);
    assert.equal((await reactivarFicha('prevencionista', ids.prevencionista)).status, 403);
    const ajeno = await reactivarFicha('prevencionista', ids.otroAdmin);
    assert.equal(ajeno.status, 403);
    assert.match(ajeno.cuerpo.error, /permisos que tú no tienes/);
    assert.equal((await filas('INBOX_TABLE')).length, 0);
    assert.ok(!(await filas('AUDITORIA_ACCESOS_TABLE')).some((x) => x.operacion === 'credencial.inicial_reactivada'));
});

test('la reactivación no borra un enlace de activación por correo pendiente', async () => {
    const conCorreo = await alta(tenantA, '22.222.222-2', 'trabajador', { email: 'rosa@ejemplo.cl' });
    assert.equal((await llamar('admin', `/personas/${conCorreo}/enviar-activacion`)).status, 200);
    const token = (await item(conCorreo)).resetTokenHash;
    await vencer(conCorreo);
    assert.equal((await reactivarFicha('admin', conCorreo)).status, 200);
    assert.equal((await item(conCorreo)).resetTokenHash, token);
});

test('por obra: reactiva solo a quienes no han entrado en esa obra, y cuenta lo que deja fuera', async () => {
    await vencer(ids.trabajador);
    await vencer(ids.otro);
    await vencer(ids.deOtraObra);
    const conTemporal = await alta(tenantA, '16.161.616-8', 'trabajador');
    await llamar('admin', `/personas/${conTemporal}/activar-acceso`);

    const r = await reactivarObra('prevencionista');
    assert.equal(r.status, 200, JSON.stringify(r.cuerpo));
    assert.equal(r.cuerpo.data.reactivadas, 2);
    assert.equal(r.cuerpo.data.omitidas.temporalVigente, 1);
    assert.equal(r.cuerpo.data.omitidas.sinPermiso, 1, 'el otro administrador');
    assert.equal(r.cuerpo.data.restantes, 0);

    assert.equal((await ingresar('12.345.678-5', '1234')).status, 200);
    assert.equal((await ingresar('17.171.717-5', '1717')).status, 200);
    assert.equal((await ingresar('18.181.818-2', '1818')).status, 401, 'otra obra no se toca');
    assert.equal((await ingresar('19.191.919-K', '1919')).status, 401, 'quien ya eligió su contraseña no se toca');
});

test('por obra: repetirla enseguida no vuelve a avisar ni a registrar a las mismas personas', async () => {
    await vencer(ids.trabajador);
    await reactivarObra('admin');
    const avisos = (await filas('INBOX_TABLE')).length;
    const registros = (await filas('AUDITORIA_ACCESOS_TABLE')).length;
    const segunda = await reactivarObra('admin');
    assert.equal(segunda.cuerpo.data.reactivadas, 0);
    assert.ok(segunda.cuerpo.data.yaReactivadas >= 1);
    assert.equal((await filas('INBOX_TABLE')).length, avisos);
    assert.equal((await filas('AUDITORIA_ACCESOS_TABLE')).length, registros);
});

test('por obra: si se acaba el tiempo de la petición, dice cuántas faltan y la siguiente termina', async () => {
    for (const id of [ids.trabajador, ids.otro]) await vencer(id);
    const reloj = Date.now;
    const reactivar = PersonaService.prototype.reactivarInicial;
    let corrimiento = 0;
    Date.now = () => reloj() + corrimiento;
    PersonaService.prototype.reactivarInicial = async function (...a) {
        const r = await reactivar.apply(this, a);
        corrimiento += 5000;
        return r;
    };
    try {
        const primera = await reactivarObra('admin');
        assert.equal(primera.cuerpo.data.reactivadas, 1);
        assert.ok(primera.cuerpo.data.restantes >= 1);
        corrimiento = 0;
        PersonaService.prototype.reactivarInicial = reactivar;
        const segunda = await reactivarObra('admin');
        assert.equal(segunda.cuerpo.data.restantes, 0);
        assert.equal(segunda.cuerpo.data.reactivadas + segunda.cuerpo.data.yaReactivadas, 3);
    } finally {
        Date.now = reloj;
        PersonaService.prototype.reactivarInicial = reactivar;
    }
    assert.equal((await ingresar('12.345.678-5', '1234')).status, 200);
    assert.equal((await ingresar('17.171.717-5', '1717')).status, 200);
});

test('por obra: sin permiso 403 y sin obra 400', async () => {
    assert.equal((await reactivarObra('sinPermiso')).status, 403);
    assert.equal((await llamar('admin', '/personas/reactivar-inicial', {})).status, 400);
});

test('D1: los cuatro dígitos abren solo la empresa donde la inicial sigue vigente', async () => {
    const enB = await alta(tenantB, '19.191.919-K', 'trabajador');
    const abre = async (password) => {
        const r = await ingresar('19.191.919-K', password);
        if (r.status !== 200) return [];
        return r.cuerpo.data.requiereSeleccionTenant ? r.cuerpo.data.opciones.map((o) => o.tenantId).sort() : [r.cuerpo.data.user?.tenantId || r.cuerpo.data.tenantId];
    };
    assert.deepEqual(await abre('1919'), [tenantB]);
    assert.deepEqual(await abre('Propia-1'), [tenantA]);
    await vencer(enB, tenantB);
    assert.deepEqual(await abre('1919'), []);
});

test('cambiar la contraseña desde la inicial termina la activación y quita la marca de inicial', async () => {
    const entrada = await ingresar('12.345.678-5', '1234');
    const { sesionDesdeToken } = require('../lib/auth/sesion');
    const sesion = await sesionDesdeToken(entrada.cuerpo.data.token);
    const res = await auth.changePassword({
        requestContext: {
            http: { method: 'POST', path: '/auth/change-password', sourceIp: '10.0.0.1' },
            authorizer: { lambda: { sessionId: sesion.sessionId, personaId: ids.trabajador, tenantId: tenantA, rol: 'trabajador', permisos: '', credencialProvisional: 'true' } },
        },
        rawPath: '/auth/change-password',
        headers: { 'user-agent': 'prueba' },
        body: JSON.stringify({ passwordNuevo: 'Elegida-1', confirmarPassword: 'Elegida-1' }),
    });
    assert.equal(res.statusCode, 200, res.body);
    const despues = await item(ids.trabajador);
    assert.equal(despues.credencialInicial, undefined);
    assert.equal(despues.activacionPendiente, undefined);
    assert.equal((await ingresar('12.345.678-5', '1234')).status, 401);
    assert.equal((await reactivarFicha('admin', ids.trabajador)).status, 409);
});

test('una contraseña inicial vencida responde lo mismo que una equivocada', async () => {
    await vencer(ids.trabajador);
    const vencida = await ingresar('12.345.678-5', '1234');
    const equivocada = await ingresar('12.345.678-5', '9999');
    assert.equal(vencida.status, 401);
    assert.deepEqual(vencida.cuerpo, equivocada.cuerpo);
    assert.match(vencida.cuerpo.error, /pide que reactiven tu acceso/);
});

test('el RUT con dígito verificador K da los cuatro primeros dígitos del número', () => {
    assert.equal(credenciales.passwordInicialDeRut('19.191.919-K'), '1919');
    assert.equal(credenciales.passwordInicialDeRut('9.876.543-3'), '9876');
    assert.equal(credenciales.passwordInicialDeRut('1.234-5'), '1234');
    assert.equal(credenciales.passwordInicialDeRut('1.234-K'), '1234');
    assert.equal(credenciales.passwordInicialDeRut('123-4'), null);
    assert.equal(credenciales.passwordInicialDeRut(''), null);
});

test('migración: quien no ha entrado queda con la inicial por 7 días; el resto no se toca; una segunda corrida no hace nada', async () => {
    const { migrar } = require('../scripts/migrar-acceso-inicial');
    const operador = { id: 'arn:aws:iam::000000000000:user/prueba', tipo: 'operador', nombre: 'Soporte de Build & Serve' };
    await fijar(tenantA, ids.trabajador, 'REMOVE passwordTemporalVence, credencialInicial, activacionPendiente');
    await fijar(tenantA, ids.otro, 'SET passwordTemporal = :no REMOVE passwordHash, passwordTemporalVence, credencialInicial', { ':no': false });
    await vencer(ids.deOtraObra);
    const conTemporal = await alta(tenantA, '16.161.616-8', 'trabajador');
    await llamar('admin', `/personas/${conTemporal}/activar-acceso`);
    await vencer(ids.deOtraEmpresa, tenantB);
    const desvinculada = await alta(tenantA, '21.212.121-5', 'trabajador');
    await docClient.send(new UpdateCommand({
        TableName: 'PERSONAS_TABLE', Key: { PK: `TENANT#${tenantA}`, SK: `PERSONA#${desvinculada}` },
        UpdateExpression: 'SET #e = :d REMOVE passwordTemporalVence', ExpressionAttributeNames: { '#e': 'estado' }, ExpressionAttributeValues: { ':d': 'desvinculado' },
    }));

    const simulacion = await migrar({ aplicar: false, actor: operador });
    assert.equal(simulacion.porMigrar, 5);
    assert.equal(simulacion.migradas, 0);
    assert.equal((await ingresar('12.345.678-5', '1234')).status, 401, 'la simulación no escribe');

    const r = await migrar({ aplicar: true, actor: operador });
    assert.equal(r.migradas, 4);
    assert.deepEqual(r.omitidas, { TEMPORAL_VIGENTE: 1 });
    for (const [rut, inicial] of [['12.345.678-5', '1234'], ['17.171.717-5', '1717'], ['18.181.818-2', '1818'], ['15.151.515-0', '1515']]) {
        assert.equal((await ingresar(rut, inicial)).status, 200, rut);
    }
    const migrada = await item(ids.trabajador);
    assert.ok(cercaDe(migrada.passwordTemporalVence, Date.now() + SIETE_DIAS));
    assert.equal((await ingresar('19.191.919-K', '1919')).status, 401, 'quien eligió su contraseña sigue igual');
    assert.ok((await filas('AUDITORIA_ACCESOS_TABLE')).filter((x) => x.operacion === 'credencial.inicial_reactivada').every((x) => x.actorId === operador.id));

    const segunda = await migrar({ aplicar: true, actor: operador });
    assert.equal(segunda.migradas, 0);
    assert.deepEqual(segunda.omitidas, { TEMPORAL_VIGENTE: 1 });
});
