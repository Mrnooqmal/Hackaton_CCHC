// Aislamiento entre empresas — actividades, incidentes, encuestas e inbox.
//
// Tercer tramo del mismo cierre. Dos casos de este grupo son distintos de los
// anteriores y conviene nombrarlos:
//
//   - El INBOX no guarda empresa en el mensaje: la pertenencia la da el
//     destinatario. Todas sus rutas recibían el `userId` por query o por cuerpo,
//     así que el id de otra persona abría su bandeja entera.
//   - La ENCUESTA de salud pre-ocupacional lleva las respuestas dentro del
//     propio documento: un surveyId ajeno era la ficha de salud declarada de una
//     nómina completa.

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');
const actividades = require('../handlers/activities/handler');
const incidentes = require('../handlers/incidents-module/handler');
const encuestas = require('../handlers/surveys/handler');
const inbox = require('../handlers/inbox-module/handler');

const EMPRESA_A = 't-empresa-a';
const EMPRESA_B = 't-empresa-b';

const PERMISOS_AMPLIOS = [
    'actividades.ver', 'actividades.crear', 'actividades.planificar',
    'incidentes.reportar', 'incidentes.historial', 'incidentes.estadisticas',
    'incidentes.calificar_accidente', 'encuestas.crear', 'obra.firma_asistida',
].join(',');

const contexto = (tenantId, extra = {}) => ({
    authorizer: {
        lambda: {
            sessionId: 's-1',
            personaId: extra.personaId || 'p-a',
            tenantId,
            rol: extra.rol || 'prevencionista',
            permisos: extra.permisos !== undefined ? extra.permisos : PERMISOS_AMPLIOS,
        },
    },
});

/** Evento estilo API Gateway con sesión. */
const ev = (tenantId, over = {}, extra = {}) => ({
    pathParameters: {}, queryStringParameters: null, headers: { host: 'api.test' },
    ...over,
    requestContext: { ...contexto(tenantId, extra), http: { method: over.method || 'GET' } },
});

/** Evento para los módulos con itty-router (incidentes, inbox). */
const evRouter = (tenantId, metodo, ruta, { body, query, extra = {}, sinSesion = false } = {}) => ({
    rawPath: ruta,
    rawQueryString: query || '',
    headers: { host: 'api.test' },
    queryStringParameters: query
        ? Object.fromEntries(new URLSearchParams(query))
        : null,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    requestContext: {
        ...(sinSesion ? {} : contexto(tenantId, extra)),
        http: { method: metodo, path: ruta },
    },
});

let store;
let envioOriginal;

// Se intercepta en el PROTOTIPO del cliente de DynamoDB y no en `docClient`:
// incidentes e inbox no usan el cliente compartido, cada repositorio construye
// el suyo al cargar el módulo. Un solo punto cubre a los cuatro módulos.
beforeEach(() => {
    store = { item: null, items: [], escrituras: [] };
    envioOriginal = DynamoDBDocumentClient.prototype.send;
    DynamoDBDocumentClient.prototype.send = async function (cmd) {
        const nombre = cmd.constructor.name;
        if (nombre === 'GetCommand') return { Item: store.item };
        if (nombre === 'QueryCommand') return { Items: store.items };
        if (nombre === 'ScanCommand') return { Items: store.items };
        if (nombre === 'UpdateCommand') { store.escrituras.push(cmd.input); return { Attributes: store.item }; }
        if (nombre === 'PutCommand') { store.escrituras.push(cmd.input); return {}; }
        if (nombre === 'DeleteCommand') { store.escrituras.push(cmd.input); return {}; }
        return {};
    };
});

afterEach(() => { DynamoDBDocumentClient.prototype.send = envioOriginal; });

const cuerpo = (res) => JSON.parse(res.body);

// ─── Actividades ─────────────────────────────────────────────────────────────

test('una actividad de otra empresa no se lee', async () => {
    store.item = {
        activityId: 'a-b', tenantId: EMPRESA_B, titulo: 'Charla de la competencia',
        asistentes: [{ personaId: 'p-b', rut: '11.111.111-1' }],
    };

    const res = await actividades.get(ev(EMPRESA_A, { pathParameters: { id: 'a-b' } }));

    assert.equal(res.statusCode, 404);
    assert.doesNotMatch(res.body, /11\.111\.111/, 'no se filtra el RUT de los asistentes');
});

test('una actividad de otra empresa no se edita', async () => {
    store.item = { activityId: 'a-b', tenantId: EMPRESA_B, tipo: 'CHARLA_5MIN', relatorId: 'p-b' };

    const res = await actividades.patch(ev(EMPRESA_A, {
        pathParameters: { id: 'a-b' }, method: 'PATCH',
        body: JSON.stringify({ descripcion: 'editada desde fuera' }),
    }));

    assert.equal(res.statusCode, 404);
    assert.equal(store.escrituras.length, 0);
});

test('sin permiso no se crea una actividad', async () => {
    const res = await actividades.create(ev(EMPRESA_A, {
        method: 'POST',
        body: JSON.stringify({ tipo: 'CHARLA_5MIN', titulo: 'Charla', relatorId: 'p-a' }),
    }, { rol: 'colaborador', permisos: 'actividades.ver' }));

    assert.equal(res.statusCode, 403);
    assert.equal(store.escrituras.length, 0);
});

test('el listado de actividades ignora el tenantId del cliente', async () => {
    store.items = [];
    const res = await actividades.list({
        ...ev(EMPRESA_A),
        queryStringParameters: { tenantId: EMPRESA_B },
    });

    assert.equal(res.statusCode, 200);
    // La query se arma con la empresa de la sesión, no con la del parámetro.
    assert.equal(cuerpo(res).data.activities.length, 0);
});

test('no se registra la asistencia de otra persona sin permiso de firma asistida', async () => {
    store.item = { activityId: 'a-a', tenantId: EMPRESA_A, estado: 'programada', asistentes: [] };

    const res = await actividades.registerAttendance(ev(EMPRESA_A, {
        pathParameters: { id: 'a-a' }, method: 'POST',
        body: JSON.stringify({ personaId: 'otro-trabajador', pin: '1234' }),
    }, { rol: 'colaborador', permisos: 'actividades.ver' }));

    assert.equal(res.statusCode, 403);
    assert.equal(store.escrituras.length, 0);
});

// ─── Incidentes ──────────────────────────────────────────────────────────────

test('un incidente de otra empresa no se lee', async () => {
    store.item = {
        incidentId: 'i-b', tenantId: EMPRESA_B,
        trabajador: { nombre: 'Persona Accidentada', rut: '11.111.111-1' },
        descripcion: 'Caída de altura',
    };

    const res = await incidentes.incidentsHandler(evRouter(EMPRESA_A, 'GET', '/incidents/i-b'));

    assert.equal(res.statusCode, 404);
    assert.doesNotMatch(res.body, /Accidentada/, 'no se filtran los datos de salud del afectado');
});

test('un incidente de otra empresa no se edita ni se califica como accidente', async () => {
    store.item = { incidentId: 'i-b', tenantId: EMPRESA_B, tipo: 'incidente' };

    const edicion = await incidentes.incidentsHandler(
        evRouter(EMPRESA_A, 'PUT', '/incidents/i-b', { body: { descripcion: 'otra cosa' } })
    );
    const calificacion = await incidentes.incidentsHandler(
        evRouter(EMPRESA_A, 'PUT', '/incidents/i-b/calificar-accidente', { body: { actorId: 'p-a' } })
    );

    assert.equal(edicion.statusCode, 404);
    assert.equal(calificacion.statusCode, 404);
    assert.equal(store.escrituras.length, 0);
});

test('sin permiso no se reporta un incidente, aunque se mande un solicitanteId', async () => {
    const res = await incidentes.incidentsHandler(evRouter(
        EMPRESA_A, 'POST', '/incidents',
        {
            body: { tipo: 'accidente', descripcion: 'Caída', solicitanteId: 'el-prevencionista' },
            extra: { rol: 'colaborador', permisos: 'actividades.ver' },
        },
    ));

    assert.equal(res.statusCode, 403);
    assert.equal(store.escrituras.length, 0);
});

test('sin permiso no se cierra la gobernanza de un hallazgo', async () => {
    store.item = { incidentId: 'i-a', tenantId: EMPRESA_A, clasificacion: 'hallazgo' };

    const res = await incidentes.incidentsHandler(evRouter(
        EMPRESA_A, 'PUT', '/incidents/i-a/gobernanza',
        {
            body: { estadoCierre: 'cerrado', actorId: 'el-supervisor' },
            extra: { rol: 'colaborador', permisos: 'actividades.ver' },
        },
    ));

    assert.equal(res.statusCode, 403);
    assert.equal(store.escrituras.length, 0);
});

test('sin sesión no se listan incidentes', async () => {
    const res = await incidentes.incidentsHandler(
        evRouter(EMPRESA_A, 'GET', '/incidents', { sinSesion: true })
    );

    assert.equal(res.statusCode, 401);
});

// ─── Encuestas ───────────────────────────────────────────────────────────────

test('una encuesta de otra empresa no se lee', async () => {
    store.item = {
        surveyId: 'e-b', tenantId: EMPRESA_B, titulo: 'Encuesta de Salud',
        recipients: [{ workerId: 'p-b', rut: '11.111.111-1', responses: [{ respuesta: 'Hipertensión' }] }],
    };

    const res = await encuestas.get(ev(EMPRESA_A, { pathParameters: { id: 'e-b' } }));

    assert.equal(res.statusCode, 404);
    assert.doesNotMatch(res.body, /Hipertensi/, 'no se filtran las respuestas de salud');
});

test('no se responde una encuesta de otra empresa', async () => {
    store.item = { surveyId: 'e-b', tenantId: EMPRESA_B, recipients: [{ workerId: 'p-a' }] };

    const res = await encuestas.updateResponseStatus(ev(EMPRESA_A, {
        pathParameters: { id: 'e-b', workerId: 'p-a' }, method: 'POST',
        body: JSON.stringify({ estado: 'respondida', pin: '1234' }),
    }));

    assert.equal(res.statusCode, 404);
    assert.equal(store.escrituras.length, 0);
});

test('no se responde por otra persona sin permiso de firma asistida', async () => {
    store.item = { surveyId: 'e-a', tenantId: EMPRESA_A, recipients: [{ workerId: 'otro' }] };

    const res = await encuestas.updateResponseStatus(ev(EMPRESA_A, {
        pathParameters: { id: 'e-a', workerId: 'otro' }, method: 'POST',
        body: JSON.stringify({ estado: 'respondida', pin: '1234' }),
    }, { rol: 'colaborador', permisos: '' }));

    assert.equal(res.statusCode, 403);
    assert.equal(store.escrituras.length, 0);
});

test('sin permiso no se crean encuestas', async () => {
    const res = await encuestas.create(ev(EMPRESA_A, {
        method: 'POST',
        body: JSON.stringify({ titulo: 'Encuesta', preguntas: [{ titulo: 'p', tipo: 'abierta' }] }),
    }, { rol: 'colaborador', permisos: '' }));

    assert.equal(res.statusCode, 403);
    assert.equal(store.escrituras.length, 0);
});

// ─── Inbox ───────────────────────────────────────────────────────────────────

test('la bandeja que se lee es la de la sesión, no la del parámetro', async () => {
    store.items = [];

    const res = await inbox.inboxHandler(
        evRouter(EMPRESA_A, 'GET', '/inbox', { query: 'userId=otra-persona' })
    );

    assert.equal(res.statusCode, 200);
    // El repositorio consulta por el destinatario de la sesión; el `userId` del
    // query ya no llega a la consulta.
    assert.equal(cuerpo(res).data.messages?.length ?? 0, 0);
});

test('sin sesión no se abre ninguna bandeja', async () => {
    const res = await inbox.inboxHandler(
        evRouter(EMPRESA_A, 'GET', '/inbox', { query: 'userId=otra-persona', sinSesion: true })
    );

    assert.equal(res.statusCode, 401);
});

test('el borrado se aplica al buzón de la sesión, no al del parámetro', async () => {
    // `deleteMessage` borra por (destinatario, mensaje). Antes el destinatario era
    // el `?userId=` del cliente: con el id de otra persona se le borraban sus
    // mensajes. Ahora el borrado solo puede alcanzar el propio buzón.
    const res = await inbox.inboxHandler(
        evRouter(EMPRESA_A, 'DELETE', '/inbox/m-de-otro', { query: 'userId=otra-persona' })
    );

    assert.equal(res.statusCode, 200);
    const borrados = store.escrituras.filter((e) => e.Key?.messageId === 'm-de-otro');
    assert.equal(borrados.length, 1);
    assert.equal(borrados[0].Key.recipientId, 'p-a', 'se borró en el buzón de quien pidió');
    assert.notEqual(borrados[0].Key.recipientId, 'otra-persona');
});

test('sin sesión no se envían mensajes', async () => {
    const res = await inbox.inboxHandler(evRouter(
        EMPRESA_A, 'POST', '/inbox/send',
        { body: { senderId: 'el-admin', recipientIds: ['p-x'], subject: 'x', content: 'y' }, sinSesion: true },
    ));

    assert.equal(res.statusCode, 401);
    assert.equal(store.escrituras.length, 0);
});

// ─── Reloj de la retención ───────────────────────────────────────────────────

test('al terminar el vínculo queda la fecha desde la que se cuenta la conservación', async () => {
    const { Persona } = require('../lib/models/Persona');

    // Una persona activa no tiene reloj corriendo.
    const activa = new Persona({ personaId: 'p-1', tenantId: EMPRESA_A, rut: '12.345.678-5', nombre: 'Ana', rol: 'trabajador' });
    assert.equal(activa.fechaTerminoVinculo, null);

    // Las desvinculaciones anteriores a este campo traían la fecha dentro del
    // bloque de auditoría: se sigue leyendo de ahí, sin migrar datos.
    const antigua = new Persona({
        personaId: 'p-2', tenantId: EMPRESA_A, rut: '12.345.678-5', nombre: 'Ana', rol: 'trabajador',
        estado: 'desvinculado',
        desvinculacion: { fechaDesvinculacion: '2026-03-01T10:00:00.000Z', desvinculadoPor: 'p-adm' },
    });
    assert.equal(antigua.fechaTerminoVinculo, '2026-03-01T10:00:00.000Z');
});
