// Contención y recuperación (plan de respuesta a incidentes): las acciones
// funcionan, quedan en la auditoría con el operador, no borran nada y se
// pueden deshacer. Y los controles nuevos no se eluden con peticiones directas.

process.env.CAMPO_HMAC_KEY = 'clave-de-prueba-hmac';
process.env.CAMPO_CIFRADO_LOCAL_KEY = require('crypto').randomBytes(32).toString('base64');
process.env.CREDENCIAL_PEPPER = 'pimienta-de-prueba';
process.env.CREDENCIAL_SCRYPT_LN = '10';

const { prepararEntorno, crearDobleTablas } = require('./doble-dynamo-tablas');
const esquemas = prepararEntorno();

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { PutCommand } = require('@aws-sdk/lib-dynamodb');

const { docClient } = require('../lib/clients/dynamodb');
const { PersonaService } = require('../lib/services/PersonaService');
const { TenantService } = require('../lib/services/TenantService');
const { formaCanonica } = require('../lib/huella');
const C = require('../lib/gobernanza/contencion');
const A = require('../lib/gobernanza/auditoria');

let doble;
let T;
let juan;

beforeEach(async () => {
    require('../lib/llaveTenant')._olvidarCache();
    doble = crearDobleTablas(docClient, esquemas);
    T = (await new TenantService().setup({ nombre: 'Constructora Prueba', rutEmpresa: '76.543.210-3' })).tenantId;
    juan = (await new PersonaService().crear(T, { rut: '12.345.678-5', nombre: 'Juan', rol: 'trabajador', password: 'clave-de-juan-1' })).persona;
    await new PersonaService().actualizar(T, juan.personaId, { estado: 'activo' });
    await docClient.send(new PutCommand({ TableName: 'SESSIONS_TABLE', Item: { sessionId: 'ses-1', tokenHash: crypto.createHash('sha256').update('tok-juan').digest('hex'), personaId: juan.personaId, tenantId: T, activa: true, expiresAt: '2099-01-01T00:00:00Z' } }));
});
afterEach(() => doble.restaurar());

const OP = { tenantId: T, operador: 'adrean.torres', motivo: 'INC-2026-001 cuenta comprometida' };
const autorizar = () => require('../handlers/auth/authorizer').autorizar({ headers: { authorization: 'Bearer tok-juan' } });
const registros = () => doble.items('AUDITORIA_ACCESOS_TABLE').filter((e) => e.operacion);

test('suspender: el autorizador niega, las sesiones quedan cerradas y queda registro del operador', async () => {
    assert.equal((await autorizar()).isAuthorized, true, 'antes, la sesión sirve');
    const r = await C.suspenderCuenta({ ...OP, tenantId: T, personaId: juan.personaId });
    assert.equal(r.estadoAnterior, 'activo');
    assert.equal(r.sesionesRevocadas, 1);
    assert.equal((await autorizar()).isAuthorized, false);
    const [reg] = registros();
    assert.equal(reg.operacion, 'contencion.suspender_cuenta');
    assert.equal(reg.actorId, 'operador:adrean.torres');
    assert.equal(reg.actorTipo, 'operador');
    assert.ok(doble.items('PERSONAS_TABLE').some((p) => p.personaId === juan.personaId), 'no se borra nada');
});

test('reactivar devuelve el estado anterior y también queda registrado', async () => {
    await C.suspenderCuenta({ ...OP, tenantId: T, personaId: juan.personaId });
    const r = await C.reactivarCuenta({ ...OP, tenantId: T, personaId: juan.personaId, motivo: 'INC-2026-001 contraseña cambiada' });
    assert.equal(r.estado, 'activo');
    const ficha = doble.items('PERSONAS_TABLE').find((p) => p.personaId === juan.personaId);
    assert.equal(ficha.estado, 'activo');
    assert.equal(ficha.suspension, undefined);
    assert.deepEqual(registros().map((e) => e.operacion), ['contencion.suspender_cuenta', 'contencion.reactivar_cuenta']);
});

test('sin operador o sin motivo no se ejecuta ninguna acción', async () => {
    await assert.rejects(C.revocarSesiones({ tenantId: T, personaIds: [juan.personaId], motivo: 'INC-2026-001 algo' }), (e) => e.codigo === 'SIN_OPERADOR');
    await assert.rejects(C.revocarSesiones({ tenantId: T, personaIds: [juan.personaId], operador: 'adrean.torres', motivo: 'x' }), (e) => e.codigo === 'SIN_MOTIVO');
    assert.equal(doble.items('SESSIONS_TABLE')[0].activa, true);
});

test('preservar evidencia: copia la auditoría de la ventana con una huella verificable, y lo registra', async () => {
    await A.registrar({ tenantId: T, operacion: 'auth.ingreso', actor: { id: juan.personaId } }, { ahora: new Date('2026-10-28T10:00:00Z') });
    await A.registrar({ tenantId: T, operacion: 'auth.ingreso', actor: { id: juan.personaId } }, { ahora: new Date('2026-10-20T10:00:00Z') });
    const r = await C.preservarEvidencia({ ...OP, tenantId: T, desde: '2026-10-25T00:00:00Z', hasta: '2026-10-30T00:00:00Z', ahora: new Date('2026-10-29T15:00:00Z') });
    assert.equal(r.paquete.eventos.length, 1, 'solo la ventana');
    assert.equal(r.integridad.integro, 1);
    assert.equal(r.huella, crypto.createHash('sha256').update(formaCanonica(r.paquete)).digest('hex'), 'la huella se puede recalcular');
    assert.ok(registros().some((e) => e.operacion === 'contencion.preservar_evidencia' && e.detalle.huella === r.huella));
});

// ─── No se eluden por la API ────────────────────────────────────────────────

const derechos = require('../handlers/gobernanza/derechos');
const sinSesion = (metodo, ruta, cuerpo) => derechos.atender({ requestContext: { http: { method: metodo } }, rawPath: ruta, body: cuerpo ? JSON.stringify(cuerpo) : undefined, headers: {} });

test('las rutas nuevas, llamadas sin el contexto del autorizador, responden 401', async () => {
    for (const [m, r] of [['GET', '/gobernanza/mis-datos/consentimientos'], ['POST', '/gobernanza/mis-datos/exportacion'], ['POST', '/gobernanza/mis-datos/solicitudes'], ['GET', '/gobernanza/auditoria'], ['POST', '/gobernanza/solicitudes/x/verificacion']]) {
        assert.equal((await sinSesion(m, r, {})).statusCode, 401, `${m} ${r}`);
    }
});

test('con la contraseña inicial sin cambiar, el autoservicio también está cerrado', async () => {
    const ev = { requestContext: { http: { method: 'POST' }, authorizer: { lambda: { personaId: juan.personaId, tenantId: T, rol: 'trabajador', permisos: '', credencialProvisional: 'true' } } }, rawPath: '/gobernanza/mis-datos/exportacion', body: '{"password":"x"}', headers: {} };
    assert.equal((await derechos.atender(ev)).statusCode, 403);
});

test('un tenantId o un personaId en el cuerpo o la consulta no cambian de quién son los datos', async () => {
    const ev = { requestContext: { http: { method: 'GET' }, authorizer: { lambda: { personaId: juan.personaId, tenantId: T, rol: 'trabajador', permisos: '' } } }, rawPath: '/gobernanza/mis-datos/solicitudes', queryStringParameters: { tenantId: 'otra', personaId: 'otra-persona' }, headers: {} };
    const res = await derechos.atender(ev);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(JSON.parse(res.body).data.solicitudes, []);
});
