// Minimización en las respuestas (fila 7.5): lo que ve de OTRAS personas quien
// no gestiona documentos ni personal.
//
// Documentos: un trabajador (solo `actividades.ver`) recibía en `GET /documents`
// y `GET /documents/{id}` el RUT y la IP de todos los firmantes de cada
// documento de la empresa, también en las versiones archivadas. Ahora ve su
// propia asignación y su propia firma completas, y de las demás solo que
// existen y su estado. Quien tiene `repositorio.ver` o `personas.detalle` ve
// todo, como antes.

process.env.CAMPO_HMAC_KEY = 'clave-de-prueba-hmac';
process.env.CAMPO_CIFRADO_LOCAL_KEY = require('crypto').randomBytes(32).toString('base64');

const { prepararEntorno, crearDobleTablas } = require('./doble-dynamo-tablas');
const esquemas = prepararEntorno();

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { PutCommand } = require('@aws-sdk/lib-dynamodb');

const { docClient } = require('../lib/clients/dynamodb');
const { TenantService } = require('../lib/services/TenantService');
const { llaveDe, cifrarDocumento } = require('../lib/arregloSensible');
const documentos = require('../handlers/documents/handler');

let doble;
let tenantId;
const YO = 'p-rosa';
const OTRO = 'p-juan';

beforeEach(async () => {
    doble = crearDobleTablas(docClient, esquemas, { proyecciones: true });
    tenantId = (await new TenantService().setup({ nombre: 'Constructora A', rutEmpresa: '76.543.210-3' })).tenantId;
    const llave = await llaveDe(tenantId);
    const doc = cifrarDocumento({
        documentId: 'd-1', tenantId, titulo: 'Procedimiento de altura', tipo: 'PROCEDIMIENTO', clasificacion: 'empresa', estado: 'activo',
        asignaciones: [
            { personaId: YO, nombre: 'Rosa Soto', rut: '11.111.111-1', cargo: 'Jornal', estado: 'firmado' },
            { personaId: OTRO, nombre: 'Juan Pérez', rut: '12.345.678-5', cargo: 'Capataz', estado: 'pendiente' },
        ],
        firmas: [
            { personaId: YO, nombre: 'Rosa Soto', rut: '11.111.111-1', ip: '10.0.0.1', token: 'TOK-ROSA', tipoFirma: 'trabajador', timestamp: '2026-11-08T10:00:00Z' },
            { personaId: OTRO, nombre: 'Juan Pérez', rut: '12.345.678-5', ip: '10.0.0.2', token: 'TOK-JUAN', tipoFirma: 'trabajador', timestamp: '2026-11-08T11:00:00Z' },
        ],
        versiones: [{ version: 1, publicadoEn: '2026-10-01', firmasArchivadas: [{ personaId: OTRO, nombre: 'Juan Pérez', rut: '12.345.678-5', ip: '10.0.0.9' }] }],
    }, llave);
    await docClient.send(new PutCommand({ TableName: 'DOCUMENTS_TABLE', Item: doc }));
});
afterEach(() => doble.restaurar());

const ev = (ruta, permisos, pathParameters = {}) => ({
    routeKey: `GET ${ruta}`, rawPath: ruta, pathParameters,
    requestContext: { http: { method: 'GET', path: ruta }, authorizer: { lambda: { sessionId: 's', personaId: YO, tenantId, rol: 'trabajador', permisos, credencialProvisional: 'false' } } },
    queryStringParameters: {}, headers: {},
});

const sinDatosDeJuan = (cuerpo) => {
    for (const dato of ['12.345.678-5', '10.0.0.2', '10.0.0.9', 'Juan Pérez', 'TOK-JUAN', 'Capataz']) {
        assert.ok(!cuerpo.includes(dato), `no debería viajar: ${dato}`);
    }
};

test('sin repositorio.ver: de los demás, solo que existen y su estado; lo propio, completo', async () => {
    for (const res of [
        await documentos.list(ev('/documents', 'actividades.ver')),
        await documentos.get(ev('/documents/d-1', 'actividades.ver', { id: 'd-1' })),
    ]) {
        assert.equal(res.statusCode, 200, res.body);
        sinDatosDeJuan(res.body);
        const data = JSON.parse(res.body).data;
        const doc = data.documents ? data.documents[0] : data;
        assert.deepEqual(doc.asignaciones.find((a) => a.personaId === OTRO), { personaId: OTRO, estado: 'pendiente' });
        assert.equal(doc.asignaciones.find((a) => a.personaId === YO).rut, '11.111.111-1', 'la propia, completa');
        assert.equal(doc.firmas.find((f) => f.personaId === YO).token, 'TOK-ROSA');
        assert.equal(doc.firmas.length, 2, 'se sabe cuántos firmaron');
        assert.equal(doc.versiones[0].version, 1);
        assert.equal(doc.versiones[0].firmasArchivadas, undefined);
    }
});

test('con repositorio.ver o personas.detalle: todo, como antes', async () => {
    for (const permisos of ['repositorio.ver', 'personas.detalle']) {
        const res = await documentos.get(ev('/documents/d-1', permisos, { id: 'd-1' }));
        const doc = JSON.parse(res.body).data;
        assert.equal(doc.firmas.find((f) => f.personaId === OTRO).rut, '12.345.678-5', permisos);
        assert.equal(doc.versiones[0].firmasArchivadas.length, 1, permisos);
    }
});

// ─── Actividades ─────────────────────────────────────────────────────────────

const actividades = require('../handlers/activities/handler');
const { cifrarCamposEnArreglo, cifrarCamposEnObjeto } = require('../lib/arregloSensible');

const ponerActividad = async () => {
    const llave = await llaveDe(tenantId);
    await docClient.send(new PutCommand({ TableName: 'ACTIVITIES_TABLE', Item: {
        activityId: 'a-1', tenantId, titulo: 'Charla de altura', tipo: 'CHARLA_5_MINUTOS', estado: 'completada', createdAt: '2026-11-08T09:00:00Z',
        asistentes: cifrarCamposEnArreglo([
            { personaId: YO, nombre: 'Rosa Soto', rut: '11.111.111-1', cargo: 'Jornal', firma: { token: 'TOK-ROSA' } },
            { personaId: OTRO, nombre: 'Juan Pérez', rut: '12.345.678-5', cargo: 'Capataz', firma: { token: 'TOK-JUAN' } },
        ], ['rut'], llave),
        firmaRelator: cifrarCamposEnObjeto({ personaId: 'p-relator', nombre: 'Ana Relatora', rut: '13.131.313-1', timestamp: '2026-11-08T09:00:00Z' }, ['rut'], llave),
    } }));
};

test('actividades sin actividades.crear: de los demás asistentes, el identificador; del relator, su nombre', async () => {
    await ponerActividad();
    for (const res of [
        await actividades.list(ev('/activities', 'actividades.ver')),
        await actividades.get(ev('/activities/a-1', 'actividades.ver', { id: 'a-1' })),
    ]) {
        assert.equal(res.statusCode, 200, res.body);
        sinDatosDeJuan(res.body);
        assert.ok(!res.body.includes('13.131.313-1'), 'sin el RUT del relator');
        const data = JSON.parse(res.body).data;
        const act = data.activities ? data.activities.find((a) => a.activityId === 'a-1') : data;
        assert.deepEqual(act.asistentes.find((a) => a.personaId === OTRO), { personaId: OTRO });
        assert.equal(act.asistentes.find((a) => a.personaId === YO).rut, '11.111.111-1', 'la propia, completa');
        assert.equal(act.firmaRelator.nombre, 'Ana Relatora');
    }
});

test('actividades con actividades.crear o personas.detalle: todo', async () => {
    await ponerActividad();
    for (const permisos of ['actividades.crear', 'personas.detalle']) {
        const act = JSON.parse((await actividades.get(ev('/activities/a-1', permisos, { id: 'a-1' }))).body).data;
        assert.equal(act.asistentes.find((a) => a.personaId === OTRO).rut, '12.345.678-5', permisos);
        assert.equal(act.firmaRelator.rut, '13.131.313-1', permisos);
    }
});

// ─── Incidentes ──────────────────────────────────────────────────────────────

const { IncidentsRepository } = require('../handlers/incidents-module/incidents.repository');
const incidentes = require('../handlers/incidents-module/handler');

const INCIDENTES = [
    { incidentId: 'i-mio', tenantId: null, reportadoPor: YO, tipo: 'condicion_subestandar', fecha: '2026-11-08', descripcion: 'Baranda suelta' },
    { incidentId: 'i-ajeno', tenantId: null, reportadoPor: OTRO, tipo: 'accidente', fecha: '2026-11-07', trabajadorNombre: 'Juan Pérez', descripcion: 'Caída, fractura de muñeca' },
];

const conRepo = async (fn) => {
    const P = IncidentsRepository.prototype;
    const orig = { list: P.list, get: P.get, getItem: P.getItem, getDocuments: P.getDocuments };
    const datos = INCIDENTES.map((i) => ({ ...i, tenantId }));
    P.list = async () => ({ items: datos, total: datos.length });
    P.getItem = async (id) => datos.find((i) => i.incidentId === id) || null;
    P.get = async (id) => ({ ...datos.find((i) => i.incidentId === id), rut: '12.345.678-5' });
    P.getDocuments = async () => ({ documents: [] });
    try { return await fn(); } finally { Object.assign(P, orig); }
};
const evInc = (metodo, ruta, permisos) => ({
    rawPath: ruta, routeKey: `ANY /incidents/{proxy+}`,
    requestContext: { http: { method: metodo, path: ruta }, authorizer: { lambda: { sessionId: 's', personaId: YO, tenantId, rol: 'trabajador', permisos, credencialProvisional: 'false' } } },
    queryStringParameters: {}, headers: {},
});

test('incidentes sin incidentes.historial: solo lo que reportó la propia persona', () => conRepo(async () => {
    const lista = await incidentes.incidentsHandler(evInc('GET', '/incidents', 'actividades.ver'));
    assert.equal(lista.statusCode, 200, lista.body);
    assert.deepEqual(JSON.parse(lista.body).data.map((i) => i.incidentId), ['i-mio']);
    assert.ok(!lista.body.includes('fractura'), 'ni el relato del accidente ajeno');
    assert.equal((await incidentes.incidentsHandler(evInc('GET', '/incidents/i-mio', 'actividades.ver'))).statusCode, 200);
    const ajeno = await incidentes.incidentsHandler(evInc('GET', '/incidents/i-ajeno', 'actividades.ver'));
    assert.equal(ajeno.statusCode, 404, 'el mismo 404 que si no existiera');
    assert.ok(!ajeno.body.includes('12.345.678-5'));
    assert.equal((await incidentes.incidentsHandler(evInc('GET', '/incidents/i-ajeno/documents', 'actividades.ver'))).statusCode, 404);
}));

test('incidentes con incidentes.historial: todos', () => conRepo(async () => {
    const lista = await incidentes.incidentsHandler(evInc('GET', '/incidents', 'incidentes.historial'));
    assert.equal(JSON.parse(lista.body).data.length, 2);
    assert.equal((await incidentes.incidentsHandler(evInc('GET', '/incidents/i-ajeno', 'incidentes.historial'))).statusCode, 200);
}));

// ─── Obras ───────────────────────────────────────────────────────────────────

const obras = require('../handlers/obras-module/handler');

test('obras: expediente, consolidado y medidas exigen obras.detalle (traen incidentes y personas)', async () => {
    const evObra = (ruta, permisos) => ({
        rawPath: ruta, routeKey: 'GET /obras/{proxy+}',
        requestContext: { http: { method: 'GET', path: ruta }, authorizer: { lambda: { sessionId: 's', personaId: YO, tenantId, rol: 'trabajador', permisos, credencialProvisional: 'false' } } },
        queryStringParameters: {}, headers: {},
    });
    for (const ruta of ['/obras/o-1/expediente', '/obras/o-1/check/consolidado', '/obras/o-1/medidas-correctivas']) {
        const r = await obras.obrasHandler(evObra(ruta, 'actividades.ver'));
        assert.equal(r.statusCode, 403, `${ruta}: ${r.statusCode}`);
    }
    // Con el permiso pasa la barrera (y llega a la pertenencia de la obra: 404, no existe).
    const r = await obras.obrasHandler(evObra('/obras/o-1/medidas-correctivas', 'obras.detalle'));
    assert.equal(r.statusCode, 404, r.body);
});
