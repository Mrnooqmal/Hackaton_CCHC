process.env.CAMPO_HMAC_KEY = 'clave-de-prueba-hmac';
process.env.CAMPO_CIFRADO_LOCAL_KEY = require('crypto').randomBytes(32).toString('base64');
process.env.CREDENCIAL_PEPPER = 'pimienta-de-prueba';
process.env.FRONTEND_URL = 'https://app.ejemplo.cl';

const { prepararEntorno, crearDobleTablas } = require('./doble-dynamo-tablas');
const esquemas = prepararEntorno();

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { ScanCommand } = require('@aws-sdk/lib-dynamodb');

const { docClient } = require('../lib/clients/dynamodb');
const { PersonaService } = require('../lib/services/PersonaService');
const { TenantService } = require('../lib/services/TenantService');
const { ALL_PERMISSION_KEYS, DEFAULT_ROLE_PRESETS } = require('../lib/permissions');
const credenciales = require('../lib/credenciales');
const notificaciones = require('../handlers/notifications/handler');
const personas = require('../handlers/personas-module/handler');
const auth = require('../handlers/auth/handler');

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
    original = notificaciones.sendActivacionEmail;
    notificaciones.sendActivacionEmail = async (email, nombre, enlace, horas) => { correos.push({ email, enlace, horas }); return { sent: true }; };
    tenantA = (await new TenantService().setup({ nombre: 'Constructora A', rutEmpresa: '76.543.210-3' })).tenantId;
    tenantB = (await new TenantService().setup({ nombre: 'Constructora B', rutEmpresa: '77.777.777-7' })).tenantId;
    ids = {
        admin: await alta(tenantA, '9.876.543-3', 'admin', { password: 'Clave-admin-1' }),
        prevencionista: await alta(tenantA, '11.111.111-1', 'prevencionista', { password: 'Clave-prev-1' }),
        jefe: await alta(tenantA, '13.131.313-6', 'jefe_obra'),
        otroAdmin: await alta(tenantA, '14.141.414-3', 'admin'),
        trabajador: await alta(tenantA, '12.345.678-5', 'trabajador'),
        conCorreo: await alta(tenantA, '22.222.222-2', 'trabajador', { email: 'rosa@ejemplo.cl' }),
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

const pedir = async (quien, accion, personaId) => {
    const s = SESIONES[quien]();
    const res = await personas.personasHandler({
        requestContext: {
            http: { method: 'POST', sourceIp: '10.0.0.1' },
            authorizer: { lambda: { sessionId: `s-${quien}`, personaId: s.personaId, tenantId: tenantA, rol: s.rol, permisos: s.permisos.join(',') } },
        },
        rawPath: `/personas/${personaId}/${accion}`,
        body: '{}',
    });
    return { status: res.statusCode, cuerpo: JSON.parse(res.body) };
};

const filas = async (tabla) => (await docClient.send(new ScanCommand({ TableName: tabla }))).Items || [];
const ingresar = async (rut, password) => (await auth.login({
    body: JSON.stringify({ rut, password }), requestContext: { http: { sourceIp: '10.0.0.1' } }, headers: {},
})).statusCode;

test('el administrador activa a un trabajador: temporal de 2 horas, una sola vez en la respuesta', async () => {
    const r = await pedir('admin', 'activar-acceso', ids.trabajador);
    assert.equal(r.status, 200, JSON.stringify(r.cuerpo));
    assert.match(r.cuerpo.data.password, /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    assert.ok(Math.abs(new Date(r.cuerpo.data.vence).getTime() - (Date.now() + 2 * 3600e3)) < 60e3);
    assert.equal(await ingresar('12.345.678-5', r.cuerpo.data.password), 200);
    const registro = (await filas('AUDITORIA_ACCESOS_TABLE')).find((x) => x.operacion === 'credencial.acceso_activado');
    assert.equal(registro.actorId, ids.admin);
    assert.deepEqual(registro.titulares, [ids.trabajador]);
});

test('el prevencionista activa a un trabajador', async () => {
    const r = await pedir('prevencionista', 'activar-acceso', ids.trabajador);
    assert.equal(r.status, 200, JSON.stringify(r.cuerpo));
});

test('sin el permiso, 403 y nada escrito', async () => {
    const r = await pedir('sinPermiso', 'activar-acceso', ids.trabajador);
    assert.equal(r.status, 403);
    assert.equal((await filas('INBOX_TABLE')).length, 0);
    assert.equal(await credenciales.pendienteDeActivacion(await new PersonaService().getItemById(ids.trabajador)), true);
});

test('una persona de otra empresa: 404 y nada escrito', async () => {
    const antes = await new PersonaService().getItemById(ids.deOtraEmpresa);
    const r = await pedir('admin', 'activar-acceso', ids.deOtraEmpresa);
    assert.equal(r.status, 404);
    assert.equal((await filas('INBOX_TABLE')).length, 0);
    assert.deepEqual(await new PersonaService().getItemById(ids.deOtraEmpresa), antes);
});

test('nadie activa su propio acceso', async () => {
    const r = await pedir('prevencionista', 'activar-acceso', ids.prevencionista);
    assert.equal(r.status, 403);
});

test('el prevencionista no activa a quien tiene permisos que él no tiene', async () => {
    for (const objetivo of ['jefe', 'otroAdmin']) {
        const r = await pedir('prevencionista', 'activar-acceso', ids[objetivo]);
        assert.equal(r.status, 403, objetivo);
        assert.match(r.cuerpo.error, /permisos que tú no tienes/);
    }
    assert.equal((await filas('INBOX_TABLE')).length, 0);
});

test('el administrador sí activa a otro administrador', async () => {
    assert.equal((await pedir('admin', 'activar-acceso', ids.otroAdmin)).status, 200);
});

test('a quien ya eligió su contraseña no se le activa de nuevo (409)', async () => {
    const r = await pedir('admin', 'activar-acceso', ids.prevencionista);
    assert.equal(r.status, 409);
    assert.match(r.cuerpo.error, /ya eligió su contraseña/);
    assert.equal((await filas('INBOX_TABLE')).length, 0);
});

test('el enlace por correo: sin correo, 409; con correo, enlace de 72 horas que no muestra la contraseña', async () => {
    const sin = await pedir('admin', 'enviar-activacion', ids.trabajador);
    assert.equal(sin.status, 409);

    const con = await pedir('admin', 'enviar-activacion', ids.conCorreo);
    assert.equal(con.status, 200, JSON.stringify(con.cuerpo));
    assert.equal(con.cuerpo.data.correo, 'enviado');
    assert.equal(con.cuerpo.data.password, undefined);
    assert.equal(correos.length, 1);
    assert.equal(correos[0].horas, 72);
    const url = new URL(correos[0].enlace);
    assert.equal(url.origin, 'https://app.ejemplo.cl');
    assert.equal(url.pathname, '/restablecer-clave');
    assert.equal(url.searchParams.get('activar'), '1');

    const item = await new PersonaService().getItemById(ids.conCorreo);
    assert.equal(item.resetTokenHash, credenciales.hashTokenEnlace(url.searchParams.get('token')));
    assert.ok(Math.abs(new Date(item.resetTokenExpiry).getTime() - (Date.now() + 72 * 3600e3)) < 60e3);
    assert.ok(!JSON.stringify(await filas('AUDITORIA_ACCESOS_TABLE')).includes(url.searchParams.get('token')));
    assert.ok((await filas('AUDITORIA_ACCESOS_TABLE')).some((x) => x.operacion === 'credencial.enlace_activacion'));

    const res = await auth.resetPassword({ body: JSON.stringify({
        personaId: ids.conCorreo, token: url.searchParams.get('token'), passwordNuevo: 'Elegida-1', confirmarPassword: 'Elegida-1',
    }) });
    assert.equal(res.statusCode, 200, res.body);
    const despues = await new PersonaService().getItemById(ids.conCorreo);
    assert.equal(despues.activacionPendiente, undefined, 'elegir su contraseña termina la activación');
    assert.equal(despues.passwordTemporal, false);
    assert.equal(await ingresar('22.222.222-2', 'Elegida-1'), 200);
});

test('el alta individual con correo manda el enlace, nunca una contraseña', async () => {
    const s = SESIONES.admin();
    const res = await personas.personasHandler({
        requestContext: {
            http: { method: 'POST', sourceIp: '10.0.0.1' },
            authorizer: { lambda: { sessionId: 's-admin', personaId: s.personaId, tenantId: tenantA, rol: 'admin', permisos: s.permisos.join(',') } },
        },
        rawPath: '/personas',
        body: JSON.stringify({ rut: '16.161.616-8', nombre: 'Luis', apellidoPaterno: 'Mora', rol: 'trabajador', email: 'luis@ejemplo.cl', tieneAccesoWeb: true }),
    });
    assert.equal(res.statusCode, 201, res.body);
    const data = JSON.parse(res.body).data;
    assert.equal(data.enlaceActivacion, 'enviado');
    assert.equal(data.passwordTemporal, undefined);
    assert.equal(correos.length, 1);
    assert.equal(correos[0].email, 'luis@ejemplo.cl');
});

test('la carga masiva con correo manda enlaces de activación, y todas quedan con la contraseña inicial que vence en 7 días', async () => {
    const cola = require('./doble-cola').crearDobleCola();
    try {
        const s = SESIONES.admin();
        const confirmar = await personas.personasHandler({
            requestContext: {
                http: { method: 'POST', sourceIp: '10.0.0.1' },
                authorizer: { lambda: { sessionId: 's-admin', personaId: s.personaId, tenantId: tenantA, rol: 'admin', permisos: s.permisos.join(',') } },
            },
            rawPath: '/personas/carga-masiva/confirmar',
            body: JSON.stringify({ sendWelcomeEmail: true, filas: [
                { filaExcel: 2, rut: '17.171.717-5', nombre: 'Ana', apellidoPaterno: 'Paz', rol: 'Persona trabajadora', email: 'ana@ejemplo.cl' },
                { filaExcel: 3, rut: '18.181.818-2', nombre: 'Leo', apellidoPaterno: 'Paz', rol: 'Persona trabajadora' },
            ] }),
        });
        assert.equal(confirmar.statusCode, 202, confirmar.body);
        await cola.drenar();
        assert.equal(correos.length, 1);
        assert.equal(correos[0].email, 'ana@ejemplo.cl');
        assert.match(correos[0].enlace, /activar=1/);
        const nuevas = (await filas('PERSONAS_TABLE')).filter((i) => i.rol === 'Persona trabajadora');
        assert.equal(nuevas.length, 2);
        assert.ok(nuevas.every((i) => i.activacionPendiente === true && i.credencialInicial === true && i.passwordTemporal === true));
        assert.ok(nuevas.every((i) => Math.abs(Date.parse(i.passwordTemporalVence) - (Date.now() + 7 * 24 * 3600e3)) < 60e3));
        assert.ok(correos.every((c) => !/\b1717\b/.test(JSON.stringify(c))));
    } finally {
        cola.restaurar();
    }
});

test('no se manda un enlace a quien ya eligió su contraseña, y lo dice', async () => {
    const activa = await alta(tenantA, '19.191.919-K', 'trabajador', { email: 'activa@ejemplo.cl', password: 'Propia-1' });
    const r = await pedir('admin', 'enviar-activacion', activa);
    assert.equal(r.status, 409);
    assert.match(r.cuerpo.error, /ya eligió su contraseña/);
    assert.equal(correos.length, 0);
});
