// Encuestas: a quién le llegan, qué trae el listado y quién ve las respuestas.
//
// El 23 de septiembre de 2026 `tenantId-index` dejó de proyectar `recipients`
// (llevaba el RUT de cada destinatario al índice). El listado se sirve desde ese
// índice, y la pantalla sacaba de ahí tres cosas: las encuestas asignadas a
// quien mira, las preguntas del detalle y el avance de los ítems del kit. Desde
// entonces a nadie "le llegaba" una encuesta y el detalle salía sin preguntas.
// El doble de pruebas devolvía el ítem completo desde el índice, así que nada lo
// vio: estas pruebas proyectan como DynamoDB.
//
// Además, `GET /surveys/{id}` entregaba las respuestas de todos los
// destinatarios a cualquiera de la empresa, incluida la Ficha Básica de Salud,
// cuyo id es predecible.

process.env.CAMPO_HMAC_KEY = 'clave-de-prueba-hmac';
process.env.CAMPO_CIFRADO_LOCAL_KEY = require('crypto').randomBytes(32).toString('base64');
process.env.CREDENCIAL_PEPPER = 'pimienta-de-prueba';

const { prepararEntorno, crearDobleTablas } = require('./doble-dynamo-tablas');
const esquemas = prepararEntorno();   // antes de cargar servicios: leen el nombre de la tabla al importarse

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const { docClient } = require('../lib/clients/dynamodb');
const { PersonaService } = require('../lib/services/PersonaService');
const { TenantService } = require('../lib/services/TenantService');
const { idEncuestaSalud } = require('../lib/health/healthSurvey');
const { construirDestinatario, llaveDe, llaveSaludDe } = require('../lib/arregloSensible');
const { PutCommand } = require('@aws-sdk/lib-dynamodb');
const encuestas = require('../handlers/surveys/handler');

// El admin del reporte: se asignó una encuesta a sí mismo y no le llegó.
const RUT_ADMIN = '21.535.758-9';
const RUT_TRABAJADOR = '12.345.678-5';
const RUT_OTRO = '11.111.111-1';

let doble;
let tenantId;
let admin;
let trabajador;
let otro;

beforeEach(async () => {
    require('../lib/llaveTenant')._olvidarCache();
    doble = crearDobleTablas(docClient, esquemas, { proyecciones: true });
    const tenant = await new TenantService().setup({ nombre: 'Constructora Prueba', rutEmpresa: '76.543.210-3' });
    tenantId = tenant.tenantId;
    const personas = new PersonaService();
    admin = (await personas.crear(tenantId, { rut: RUT_ADMIN, nombre: 'Ana', rol: 'admin', cargo: 'ADMINISTRATIVO', email: 'ana@ejemplo.cl', password: 'una-clave-larga' })).persona;
    trabajador = (await personas.crear(tenantId, { rut: RUT_TRABAJADOR, nombre: 'Juan', rol: 'trabajador', cargo: 'CARPINTERO' })).persona;
    otro = (await personas.crear(tenantId, { rut: RUT_OTRO, nombre: 'Luis', rol: 'trabajador', cargo: 'CARPINTERO' })).persona;
});
afterEach(() => doble.restaurar());

const PERMISOS_ADMIN = 'encuestas.crear,personas.ver,personas.detalle,persona.vigilancia_salud';

const ev = (persona, { permisos = '', pathParameters = {}, body } = {}) => ({
    pathParameters,
    queryStringParameters: null,
    headers: { 'user-agent': 'prueba' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    requestContext: {
        http: { method: 'GET', sourceIp: '127.0.0.1' },
        authorizer: { lambda: { sessionId: 's-1', personaId: persona.personaId, tenantId, rol: persona.rol, permisos } },
    },
});

const cuerpo = (res) => JSON.parse(res.body).data;

const PREGUNTAS = [
    { titulo: '¿Qué tan expuesto te sientes?', tipo: 'multiple', opciones: ['Mucho', 'Poco'] },
    { titulo: 'Limpieza del frente', tipo: 'escala', escalaMax: 5 },
];

const crearEncuesta = async (extra = {}) => {
    const res = await encuestas.create(ev(admin, {
        permisos: PERMISOS_ADMIN,
        body: { titulo: 'Percepción de riesgos', preguntas: PREGUNTAS, ...extra },
    }));
    assert.equal(res.statusCode, 201, res.body);
    return cuerpo(res);
};

const listar = async (persona, permisos = '') => {
    const res = await encuestas.list(ev(persona, { permisos }));
    assert.equal(res.statusCode, 200, res.body);
    return cuerpo(res).surveys;
};

const detalle = (persona, surveyId, permisos = '') =>
    encuestas.get(ev(persona, { permisos, pathParameters: { id: surveyId } }));

// ─── El reporte: asignada por RUT y "no le llegó" ───────────────────────────

test('la encuesta asignada por RUT le aparece a quien se asignó, aunque sea admin', async () => {
    const encuesta = await crearEncuesta({ audienceType: 'personalizado', ruts: [RUT_ADMIN] });

    const [enLista] = await listar(admin, PERMISOS_ADMIN);
    assert.equal(enLista.surveyId, encuesta.surveyId);
    assert.deepEqual(enLista.miAsignacion, { estado: 'pendiente', respondedAt: null });

    // A quien no se le asignó, la encuesta se le lista sin asignación.
    const [paraOtro] = await listar(trabajador);
    assert.equal(paraOtro.miAsignacion, null);
});

test('el listado cuenta las preguntas y no expone a los destinatarios', async () => {
    await crearEncuesta({ audienceType: 'todos' });
    const [enLista] = await listar(admin, PERMISOS_ADMIN);
    assert.equal(enLista.totalPreguntas, 2);
    assert.equal(enLista.recipients, undefined);
    assert.equal(enLista.preguntas, undefined);
    assert.equal(enLista.stats.totalRecipients, 3);
});

test('el listado no se rompe si una encuesta del índice ya no está en la tabla', async () => {
    const encuesta = await crearEncuesta({ audienceType: 'todos' });
    // Consistencia eventual del índice: la fila existe allá y no acá.
    doble.tablas.SURVEYS_TABLE.delete(JSON.stringify([encuesta.surveyId]));
    doble.tablas.SURVEYS_TABLE.set('fantasma', { surveyId: 'fantasma', tenantId, titulo: 'x', createdAt: '2026-01-01' });
    const lista = await listar(admin, PERMISOS_ADMIN);
    const fantasma = lista.find((s) => s.surveyId === 'fantasma');
    assert.equal(fantasma.totalPreguntas, 0);
    assert.equal(fantasma.miAsignacion, null);
});

// ─── El detalle trae las preguntas ──────────────────────────────────────────

test('el detalle trae las preguntas y, a quien gestiona, todos los destinatarios', async () => {
    const encuesta = await crearEncuesta({ audienceType: 'todos' });
    const res = await detalle(admin, encuesta.surveyId, PERMISOS_ADMIN);
    assert.equal(res.statusCode, 200, res.body);
    const data = cuerpo(res);
    assert.equal(data.preguntas.length, 2);
    assert.equal(data.preguntas[0].titulo, '¿Qué tan expuesto te sientes?');
    assert.equal(data.recipients.length, 3);
});

test('un destinatario sin permiso de gestión ve las preguntas y solo lo suyo', async () => {
    const encuesta = await crearEncuesta({ audienceType: 'todos' });
    const res = await detalle(trabajador, encuesta.surveyId);
    assert.equal(res.statusCode, 200, res.body);
    const data = cuerpo(res);
    assert.equal(data.preguntas.length, 2);
    assert.deepEqual(data.recipients.map((r) => r.personaId), [trabajador.personaId]);
    assert.equal(data.stats.totalRecipients, 3);
});

test('quien no es destinatario ni gestiona no ve la encuesta', async () => {
    const encuesta = await crearEncuesta({ audienceType: 'personalizado', ruts: [RUT_TRABAJADOR] });
    const res = await detalle(otro, encuesta.surveyId);
    assert.equal(res.statusCode, 404);
});

// ─── La Ficha Básica de Salud ───────────────────────────────────────────────

const sembrarFichaSalud = async () => {
    const [llave, llaveSalud] = await Promise.all([llaveDe(tenantId), llaveSaludDe(tenantId)]);
    const respuestas = [{ questionId: 'health-01', value: 'Sí' }];
    await docClient.send(new PutCommand({
        TableName: 'SURVEYS_TABLE',
        Item: {
            surveyId: idEncuestaSalud(tenantId),
            tenantId,
            titulo: 'Ficha Básica de Salud',
            preguntas: [{ questionId: 'health-01', titulo: '¿Tiene alergias?', tipo: 'multiple', opciones: ['Sí', 'No'], required: true }],
            recipients: [
                { ...construirDestinatario(trabajador, { responses: respuestas, estado: 'respondida' }, llave, llaveSalud) },
                { ...construirDestinatario(otro, { responses: respuestas, estado: 'respondida' }, llave, llaveSalud) },
            ],
            stats: { totalRecipients: 2, responded: 2, pending: 0, completionRate: 100 },
            createdAt: '2026-09-01T00:00:00.000Z',
        },
    }));
    return idEncuestaSalud(tenantId);
};

test('la ficha de salud no entrega respuestas ajenas sin el permiso de vigilancia de salud', async () => {
    const id = await sembrarFichaSalud();

    const sinPermiso = cuerpo(await detalle(admin, id, 'encuestas.crear'));
    assert.equal(sinPermiso.recipients.length, 2);
    assert.ok(sinPermiso.recipients.every((r) => r.responses === undefined), 'las respuestas de salud no viajan');

    const conPermiso = cuerpo(await detalle(admin, id, 'encuestas.crear,persona.vigilancia_salud'));
    assert.deepEqual(conPermiso.recipients[0].responses, [{ questionId: 'health-01', value: 'Sí' }]);

    // La propia persona siempre ve lo que declaró.
    const propia = cuerpo(await detalle(trabajador, id));
    assert.deepEqual(propia.recipients.map((r) => r.personaId), [trabajador.personaId]);
    assert.deepEqual(propia.recipients[0].responses, [{ questionId: 'health-01', value: 'Sí' }]);
});

test('el listado marca la ficha de salud', async () => {
    await sembrarFichaSalud();
    const lista = await listar(trabajador);
    assert.equal(lista.find((s) => s.surveyId === idEncuestaSalud(tenantId)).esFichaSalud, true);
});

// ─── Ítems del kit: el avance por persona ───────────────────────────────────

test('con permiso de ver personas, el listado trae quién respondió cada ítem del kit', async () => {
    await crearEncuesta({ audienceType: 'todos', kitItemKey: 'ENCUESTA_INGRESO' });
    const [conPermiso] = await listar(admin, PERMISOS_ADMIN);
    assert.deepEqual(new Set(conPermiso.avanceKit.asignados), new Set([admin.personaId, trabajador.personaId, otro.personaId]));
    assert.deepEqual(conPermiso.avanceKit.respondidos, []);

    const [sinPermiso] = await listar(trabajador);
    assert.equal(sinPermiso.avanceKit, undefined);
});

test('el aviso a la bandeja usa el nombre de la sesión, no el del cuerpo', async () => {
    const eventos = [];
    const { eventBus } = require('../lib/events/EventBus');
    const emitOriginal = eventBus.emit;
    eventBus.emit = async (nombre, data) => { eventos.push({ nombre, data }); };
    try {
        await crearEncuesta({ audienceType: 'personalizado', ruts: [RUT_ADMIN], creatorName: 'Gerencia General' });
    } finally {
        eventBus.emit = emitOriginal;
    }
    const aviso = eventos.find((e) => e.nombre === 'survey.assigned');
    assert.deepEqual(aviso.data.userIds, [admin.personaId]);
    assert.equal(aviso.data.creatorName, 'Ana');
});

test('al responder, se recibe lo propio y no las respuestas de los demás', async () => {
    const id = await sembrarFichaSalud();
    const { FirmaService } = require('../lib/services/FirmaService');
    const crearOriginal = FirmaService.crear;
    FirmaService.crear = async () => ({ signatureId: 'f-1', token: 't-1', fecha: '2026-09-28', timestamp: '2026-09-28T12:00:00.000Z' });
    try {
        const res = await encuestas.updateResponseStatus(ev(trabajador, {
            pathParameters: { id, workerId: trabajador.personaId },
            body: { estado: 'respondida', pin: '1234', responses: [{ questionId: 'health-01', value: 'No' }] },
        }));
        assert.equal(res.statusCode, 200, res.body);
        const data = cuerpo(res);
        assert.deepEqual(data.survey.recipients.map((r) => r.personaId), [trabajador.personaId]);
        assert.deepEqual(data.recipient.responses, [{ questionId: 'health-01', value: 'No' }]);
    } finally {
        FirmaService.crear = crearOriginal;
    }
});
