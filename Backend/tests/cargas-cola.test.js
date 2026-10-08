// Carga masiva en cola (D-24): un mensaje por fila, idempotencia por carga y
// RUT, cada fila contada una vez, fase 2 al terminar, filas fallidas con su
// motivo y reintento solo de lo transitorio.

process.env.CAMPO_HMAC_KEY = 'clave-de-prueba-hmac';
process.env.CAMPO_CIFRADO_LOCAL_KEY = require('crypto').randomBytes(32).toString('base64');
process.env.CREDENCIAL_PEPPER = 'pimienta-de-prueba';

const { prepararEntorno, crearDobleTablas } = require('./doble-dynamo-tablas');
const esquemas = prepararEntorno();

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { PutCommand } = require('@aws-sdk/lib-dynamodb');

const { docClient } = require('../lib/clients/dynamodb');
const { TenantService } = require('../lib/services/TenantService');
const { PersonaService } = require('../lib/services/PersonaService');
const { crearDobleCola } = require('./doble-cola');
const cargas = require('../lib/cargas');
const personas = require('../handlers/personas-module/handler');

let doble;
let cola;
let T;
let adminId;

beforeEach(async () => {
    doble = crearDobleTablas(docClient, esquemas);
    cola = crearDobleCola();
    T = (await new TenantService().setup({ nombre: 'Constructora Carga', rutEmpresa: '76.543.210-3' })).tenantId;
    adminId = (await new PersonaService().crear(T, { rut: '9.876.543-3', nombre: 'Ana', rol: 'admin', email: 'ana@ejemplo.cl', password: 'clave-larga-1' })).persona.personaId;
    await docClient.send(new PutCommand({ TableName: 'OBRAS_TABLE', Item: { PK: `TENANT#${T}`, SK: 'OBRA#o-1', obraId: 'o-1', tenantId: T, nombre: 'Edificio Norte', codigo: 'NORTE' } }));
});
afterEach(() => { cola.restaurar(); doble.restaurar(); });

const pedir = async (metodo, ruta, cuerpo, { tenant = T, quien = adminId } = {}) => {
    const r = await personas.personasHandler({
        requestContext: { http: { method: metodo }, authorizer: { lambda: { sessionId: 's', personaId: quien, tenantId: tenant, rol: 'admin', permisos: 'personas.crear,personas.ver' } } },
        rawPath: ruta, body: cuerpo ? JSON.stringify(cuerpo) : undefined,
    });
    return { status: r.statusCode, data: JSON.parse(r.body).data, cuerpo: r.body };
};
const fila = (n, rut, extra = {}) => ({ filaExcel: n, rut, nombre: `Persona ${n}`, apellidoPaterno: 'Prueba', rol: 'Persona trabajadora', ...extra });
const dv = (n) => { let t = 0, m = 2; for (const d of String(n).split('').reverse()) { t += Number(d) * m; m = m === 7 ? 2 : m + 1; } const r = 11 - (t % 11); return r === 11 ? '0' : r === 10 ? 'K' : String(r); };
const RUTS = [11111111, 12345678, 13131313, 14141414, 15151515].map((n) => `${String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.')}-${dv(n)}`);
const confirmar = async (filas) => {
    const r = await pedir('POST', '/personas/carga-masiva/confirmar', { filas });
    assert.equal(r.status, 202, r.cuerpo);
    return r.data.cargaId;
};
const estado = async (id) => (await pedir('GET', `/personas/cargas/${id}`)).data;
const personasCreadas = () => doble.items('PERSONAS_TABLE').filter((p) => p.rol === 'Persona trabajadora');
const trabajadoresEmpresa = () => doble.items('TENANTS_TABLE').find((t) => t.SK === `METADATA#${T}`)?.cantidadTrabajadores || 0;
/** Hace fallar las próximas `n` escrituras que cumplan `si`. */
const fallarEscrituras = (n, si) => {
    const enviar = docClient.send;
    let quedan = n;
    docClient.send = async (cmd) => {
        if (quedan > 0 && si(cmd)) { quedan--; throw Object.assign(new Error('DynamoDB no disponible'), { name: 'InternalServerError' }); }
        return enviar.call(docClient, cmd);
    };
    return () => { docClient.send = enviar; };
};

test('confirmar no crea personas: crea la carga, encola una fila por mensaje y responde 202', async () => {
    const id = await confirmar(RUTS.slice(0, 3).map((r, i) => fila(i + 2, r)));
    assert.equal(personasCreadas().length, 0, 'nada se crea en la petición');
    assert.equal(cola.colas.cargas.length, 3, 'un mensaje por fila');
    const e = await estado(id);
    assert.deepEqual([e.estado, e.total, e.procesadas], ['en_proceso', 3, 0]);
});

test('al drenar la cola: todas creadas, contadores exactos, carga completada y el conteo de la empresa sube una vez por persona', async () => {
    const antes = trabajadoresEmpresa();
    const id = await confirmar(RUTS.map((r, i) => fila(i + 2, r)));
    await cola.drenar();
    const e = await estado(id);
    assert.deepEqual([e.estado, e.creadas, e.fallidas, e.procesadas], ['completada', 5, 0, 5]);
    assert.equal(personasCreadas().length, 5);
    assert.equal(trabajadoresEmpresa() - antes, 5);
});

test('idempotencia: cada fila entregada dos veces (SQS entrega al menos una vez) crea y cuenta una sola vez', async () => {
    const id = await confirmar(RUTS.slice(0, 3).map((r, i) => fila(i + 2, r)));
    cola.colas.cargas.push(...cola.colas.cargas.map((m) => ({ ...m, messageId: `${m.messageId}-dup` })));
    await cola.drenar();
    const e = await estado(id);
    assert.equal(personasCreadas().length, 3);
    assert.deepEqual([e.creadas, e.procesadas], [3, 3]);
});

test('idempotencia: si se cae después de crear la ficha y antes de contarla, el reintento no la duplica', async () => {
    const antes = trabajadoresEmpresa();
    const id = await confirmar([fila(2, RUTS[0])]);
    // La transacción que marca la fila y la cuenta falla una vez.
    const restaurar = fallarEscrituras(1, (c) => c.constructor.name === 'TransactWriteCommand');
    await cola.drenar();
    restaurar();
    const e = await estado(id);
    assert.equal(personasCreadas().length, 1);
    assert.deepEqual([e.creadas, e.procesadas, e.estado], [1, 1, 'completada']);
    assert.equal(trabajadoresEmpresa() - antes, 1);
});

test('las filas inválidas quedan fallidas en el acto, con su número de fila y su motivo, sin ir a la cola', async () => {
    const id = await confirmar([fila(2, RUTS[0]), fila(3, '12.345.678-9'), fila(4, RUTS[1], { rol: 'Astronauta' })]);
    assert.equal(cola.colas.cargas.length, 1);
    await cola.drenar();
    const e = await estado(id);
    assert.deepEqual([e.estado, e.creadas, e.fallidas], ['completada_con_errores', 1, 2]);
    assert.deepEqual(e.filasFallidas.map((f) => f.fila).sort(), [3, 4]);
    assert.ok(e.filasFallidas.every((f) => f.motivo && f.reintentable === false));
});

test('un fallo transitorio que se repite deja la fila fallida y reintentable; reintentar la completa y corrige los contadores', async () => {
    const id = await confirmar([fila(2, RUTS[0]), fila(3, RUTS[1])]);
    const esFicha = (c) => c.constructor.name === 'PutCommand' && c.input.TableName === 'PERSONAS_TABLE' && String(c.input.Item?.nombre).endsWith('3');
    const restaurar = fallarEscrituras(cargas.MAX_INTENTOS, esFicha);
    await cola.drenar();
    restaurar();
    let e = await estado(id);
    assert.deepEqual([e.estado, e.creadas, e.fallidas], ['completada_con_errores', 1, 1]);
    assert.equal(e.filasFallidas[0].fila, 3);
    assert.equal(e.filasFallidas[0].reintentable, true);
    assert.match(e.filasFallidas[0].motivo, /tras 4 intentos/);
    assert.equal(cola.colas.fallidos.length, 0, 'no se perdió en la cola de fallidos: quedó como fila fallida');

    const r = await pedir('POST', `/personas/cargas/${id}/reintentar`);
    assert.equal(r.data.reencoladas, 1);
    await cola.drenar();
    e = await estado(id);
    assert.deepEqual([e.estado, e.creadas, e.fallidas, e.procesadas], ['completada', 2, 0, 2]);
    assert.equal(personasCreadas().length, 2);
});

test('un duplicado que aparece entre validar y procesar queda fallido como duplicado, y reintentar no lo toca', async () => {
    const id = await confirmar([fila(2, RUTS[0])]);
    await new PersonaService().crear(T, { rut: RUTS[0], nombre: 'Ya estaba', rol: 'Persona trabajadora' });
    await cola.drenar();
    const e = await estado(id);
    assert.equal(e.filasFallidas[0].tipoFallo, 'duplicado');
    assert.equal((await pedir('POST', `/personas/cargas/${id}/reintentar`)).data.reencoladas, 0);
});

test('si no se pudo encolar, la carga queda en "encolado incompleto" y reintentar la termina sin duplicar', async () => {
    cola.fallarProximosEnvios(1);
    const id = await confirmar(RUTS.slice(0, 3).map((r, i) => fila(i + 2, r)));
    assert.equal((await estado(id)).estado, 'encolado_incompleto');
    await pedir('POST', `/personas/cargas/${id}/reintentar`);
    await cola.drenar();
    const e = await estado(id);
    assert.deepEqual([e.estado, e.creadas], ['completada', 3]);
    assert.equal(personasCreadas().length, 3);
});

test('fase 2: el supervisor que viene en la misma planilla se asigna aunque su fila se procese después', async () => {
    const id = await confirmar([
        fila(2, RUTS[0], { obra: 'NORTE', supervisor: RUTS[1] }),
        fila(3, RUTS[1], { rol: 'Supervisor', obra: 'NORTE' }),
    ]);
    cola.colas.cargas.reverse();
    await cola.drenar();
    assert.equal((await estado(id)).estado, 'completada');
    const sup = doble.items('PERSONAS_TABLE').find((p) => p.rol === 'Supervisor');
    const trab = personasCreadas()[0];
    const asig = (trab.asignaciones || []).find((a) => a.obraId === 'o-1');
    assert.equal(asig?.supervisorPersonaId, sup.personaId);
});

test('la fase 2 no corre con filas pendientes', async () => {
    const id = await confirmar([fila(2, RUTS[0]), fila(3, RUTS[1])]);
    await cargas.fase2({ cargaId: id }, personas.dependenciasCarga());
    assert.equal((await estado(id)).estado, 'en_proceso');
});

test('una fila creada no guarda los datos de la planilla ni el RUT en claro', async () => {
    const id = await confirmar([fila(2, RUTS[0], { email: 'uno@ejemplo.cl', telefono: '912345678' })]);
    await cola.drenar();
    const filaItem = doble.items('CARGAS_TABLE').find((i) => i.cargaId === id && i.sk.startsWith('FILA#'));
    assert.equal(filaItem.estado, 'creada');
    assert.equal(filaItem.datos, undefined);
    assert.equal(filaItem.rut, undefined);
    assert.ok(!JSON.stringify(filaItem).includes('uno@ejemplo.cl'));
    assert.ok(filaItem.expira > Date.now() / 1000, 'vence por TTL');
});

test('solo se guardan los campos de la plantilla, no lo que agregue el cliente', async () => {
    const id = await confirmar([fila(2, RUTS[0], { rolSecreto: 'admin', __proto__x: 1, nota: 'x'.repeat(10) })]);
    const filaItem = doble.items('CARGAS_TABLE').find((i) => i.cargaId === id && i.sk.startsWith('FILA#'));
    assert.equal(filaItem.datos.rolSecreto, undefined);
    assert.equal(filaItem.datos.nota, undefined);
});

test('otra empresa no ve ni reintenta la carga', async () => {
    const id = await confirmar([fila(2, RUTS[0])]);
    const ajena = (await new TenantService().setup({ nombre: 'Otra', rutEmpresa: '77.777.777-7' })).tenantId;
    assert.equal((await pedir('GET', `/personas/cargas/${id}`, null, { tenant: ajena })).status, 404);
    assert.equal((await pedir('POST', `/personas/cargas/${id}/reintentar`, null, { tenant: ajena })).status, 404);
    assert.deepEqual((await pedir('GET', '/personas/cargas', null, { tenant: ajena })).data.cargas, []);
});

test('el listado de cargas de la empresa trae la más reciente primero', async () => {
    const a = await confirmar([fila(2, RUTS[0])]);
    await new Promise((r) => setTimeout(r, 5));
    const b = await confirmar([fila(2, RUTS[1])]);
    assert.deepEqual((await pedir('GET', '/personas/cargas')).data.cargas.map((c) => c.cargaId), [b, a]);
});

test('más de 1000 filas no se aceptan', async () => {
    const r = await pedir('POST', '/personas/carga-masiva/confirmar', { filas: Array.from({ length: 1001 }, (_, i) => fila(i + 2, RUTS[0])) });
    assert.equal(r.status, 400);
});

test('la ruta directa sin asistente está retirada', async () => {
    assert.equal((await pedir('POST', '/personas/carga-masiva', { fileBase64: 'x', fileName: 'a.xlsx' })).status, 410);
});

test('la ficha con id dado se escribe con condición: dos creaciones simultáneas del mismo id, una sola persona', async () => {
    const svc = new PersonaService();
    const id = cargas.personaIdDe('c-1', '111111111');
    const datos = { rut: RUTS[0], nombre: 'Doble', rol: 'Persona trabajadora' };
    const r = await Promise.allSettled([svc.crear(T, datos, { personaId: id }), svc.crear(T, { ...datos, nombre: 'Otra' }, { personaId: id })]);
    assert.equal(r.filter((x) => x.status === 'fulfilled').length, 1);
    assert.equal(doble.items('PERSONAS_TABLE').filter((p) => p.personaId === id).length, 1);
});
