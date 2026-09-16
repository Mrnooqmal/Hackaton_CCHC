// Aislamiento entre empresas.
//
// El agujero no era el parámetro `?tenantId=` del cliente (ése ya se ignora):
// era que conocer un identificador bastaba. `GET /documents/{id}`,
// `GET /personas/{id}` y `GET /signatures/{id}` leían por clave primaria sin
// preguntar de qué empresa era el dato, y las escrituras tomaban al actor
// (creador, validador, quien publica, quien firma) de lo que viniera en el
// cuerpo.
//
// Estas pruebas fijan las tres reglas del cierre:
//   1. dato de otra empresa → 404, nunca 403 ni el dato (que exista un id en otra
//      empresa tampoco se informa);
//   2. el actor sale de la sesión, no del cuerpo;
//   3. una firma sin PIN no se registra.

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const { docClient } = require('../lib/clients/dynamodb');
const documentos = require('../handlers/documents/handler');
const firmas = require('../handlers/signatures/handler');
const personas = require('../handlers/personas-module/handler');
const { Persona } = require('../lib/models/Persona');

// Sesión de una persona de la empresa A, con permisos amplios: si aun así no
// alcanza a la empresa B, no es por falta de permisos sino por pertenencia.
const sesionDe = (tenantId, extra = {}) => ({
    requestContext: {
        authorizer: {
            lambda: {
                sessionId: 's-1',
                personaId: extra.personaId || 'p-a',
                tenantId,
                rol: extra.rol || 'prevencionista',
                permisos: extra.permisos !== undefined
                    ? extra.permisos
                    : 'repositorio.subir,obra.subir_documentos,personas.ver,personas.crear,personas.detalle,persona.vigilancia_salud,obra.firma_asistida,firmas.crear',
            },
        },
    },
});

const EMPRESA_A = 't-empresa-a';
const EMPRESA_B = 't-empresa-b';

let store;
let originalSend;

beforeEach(() => {
    store = { item: null, personaItems: [], escrituras: [], borrados: [] };
    originalSend = docClient.send;
    docClient.send = async (cmd) => {
        const nombre = cmd.constructor.name;
        if (nombre === 'GetCommand') return { Item: store.item };
        if (nombre === 'QueryCommand') return { Items: store.personaItems };
        if (nombre === 'UpdateCommand') {
            store.escrituras.push(cmd.input);
            return { Attributes: store.item || store.personaItems[0] };
        }
        if (nombre === 'PutCommand') { store.escrituras.push(cmd.input); return {}; }
        if (nombre === 'DeleteCommand') { store.borrados.push(cmd.input); return {}; }
        return {};
    };
});

afterEach(() => { docClient.send = originalSend; });

const cuerpo = (evento, body) => ({ ...evento, body: JSON.stringify(body) });

// ─── Documentos ──────────────────────────────────────────────────────────────

test('un documento de otra empresa no se lee', async () => {
    store.item = { documentId: 'd-b', tenantId: EMPRESA_B, titulo: 'MIPER de la competencia' };

    const res = await documentos.get({ ...sesionDe(EMPRESA_A), pathParameters: { id: 'd-b' } });

    assert.equal(res.statusCode, 404, 'se responde 404, no 403: la existencia tampoco se informa');
    assert.doesNotMatch(res.body, /competencia/, 'no se filtra nada del documento');
});

test('sin sesión no se lee ningún documento', async () => {
    store.item = { documentId: 'd-a', tenantId: EMPRESA_A };

    const res = await documentos.get({ pathParameters: { id: 'd-a' } });

    assert.equal(res.statusCode, 401);
});

test('un documento de la propia empresa sí se lee', async () => {
    store.item = { documentId: 'd-a', tenantId: EMPRESA_A, titulo: 'MIPER Obra Central' };

    const res = await documentos.get({ ...sesionDe(EMPRESA_A), pathParameters: { id: 'd-a' } });

    assert.equal(res.statusCode, 200);
    assert.match(res.body, /Obra Central/);
});

test('un documento de salud no se entrega a quien no tiene el permiso ni está asignado', async () => {
    store.item = {
        documentId: 'd-salud', tenantId: EMPRESA_A, tipo: 'EXAMEN_OCUPACIONAL',
        asignaciones: [{ personaId: 'otra-persona' }],
    };

    const res = await documentos.get({
        ...sesionDe(EMPRESA_A, { rol: 'supervisor', permisos: 'personas.ver' }),
        pathParameters: { id: 'd-salud' },
    });

    assert.equal(res.statusCode, 404);
});

test('la persona a la que se refiere sí ve su documento de salud', async () => {
    store.item = {
        documentId: 'd-salud', tenantId: EMPRESA_A, tipo: 'EXAMEN_OCUPACIONAL',
        asignaciones: [{ personaId: 'p-a' }],
    };

    const res = await documentos.get({
        ...sesionDe(EMPRESA_A, { rol: 'colaborador', permisos: '' }),
        pathParameters: { id: 'd-salud' },
    });

    assert.equal(res.statusCode, 200);
});

test('no se borra un documento de otra empresa', async () => {
    store.item = { documentId: 'd-b', tenantId: EMPRESA_B, firmas: [] };

    const res = await documentos.remove({
        ...sesionDe(EMPRESA_A), pathParameters: { id: 'd-b' }, queryStringParameters: { actorId: 'p-a' },
    });

    assert.equal(res.statusCode, 404);
    assert.equal(store.borrados.length, 0, 'no se envió ningún DeleteCommand');
});

test('sin permiso no se borra, aunque no se mande actorId', async () => {
    // Antes el permiso solo se comprobaba si el llamante se identificaba: omitir
    // `?actorId=` era saltárselo.
    store.item = { documentId: 'd-a', tenantId: EMPRESA_A, firmas: [] };

    const res = await documentos.remove({
        ...sesionDe(EMPRESA_A, { rol: 'colaborador', permisos: '' }),
        pathParameters: { id: 'd-a' },
        queryStringParameters: null,
    });

    assert.equal(res.statusCode, 403);
    assert.equal(store.borrados.length, 0);
});

test('no se publica una versión nueva sobre un documento de otra empresa', async () => {
    store.item = { documentId: 'd-b', tenantId: EMPRESA_B, tipo: 'MIPER', s3Key: 'x.pdf', version: 1 };

    const res = await documentos.nuevaVersion(cuerpo(
        { ...sesionDe(EMPRESA_A), pathParameters: { id: 'd-b' } },
        { s3Key: 'nuevo.pdf', motivo: 'Revisión anual' },
    ));

    assert.equal(res.statusCode, 404);
    assert.equal(store.escrituras.length, 0);
});

test('quien publica la versión queda registrado desde la sesión, no desde el cuerpo', async () => {
    store.item = { documentId: 'd-a', tenantId: EMPRESA_A, tipo: 'MIPER', s3Key: 'v1.pdf', version: 1 };

    await documentos.nuevaVersion(cuerpo(
        { ...sesionDe(EMPRESA_A), pathParameters: { id: 'd-a' } },
        { s3Key: 'v2.pdf', motivo: 'Revisión anual', publicadaPor: 'el-gerente' },
    ));

    const update = store.escrituras.find((e) => e.UpdateExpression);
    assert.equal(update.ExpressionAttributeValues[':pby'], 'p-a');
    assert.notEqual(update.ExpressionAttributeValues[':pby'], 'el-gerente');
});

// ─── Firma de documentos ─────────────────────────────────────────────────────

test('sin PIN no se firma un documento', async () => {
    // El método PRESENCIAL de FirmaService valida siempre: omitir el PIN era la
    // forma corta de fabricar la firma de otra persona.
    store.item = { documentId: 'd-a', tenantId: EMPRESA_A, asignaciones: [{ personaId: 'p-a', estado: 'pendiente' }] };

    const res = await documentos.sign(cuerpo(
        { ...sesionDe(EMPRESA_A), pathParameters: { id: 'd-a' } },
        { personaId: 'p-a', tipoFirma: 'documento' },
    ));

    assert.equal(res.statusCode, 400);
    assert.match(JSON.parse(res.body).error, /PIN/);
    assert.equal(store.escrituras.length, 0, 'no se registró ninguna firma');
});

test('sin permiso de firma asistida no se firma por otra persona', async () => {
    store.item = { documentId: 'd-a', tenantId: EMPRESA_A };

    const res = await documentos.sign(cuerpo(
        { ...sesionDe(EMPRESA_A, { rol: 'colaborador', permisos: '' }), pathParameters: { id: 'd-a' } },
        { personaId: 'otro-trabajador', tipoFirma: 'documento', pin: '1234' },
    ));

    assert.equal(res.statusCode, 403);
    assert.equal(store.escrituras.length, 0);
});

test('la firma masiva sin PIN no registra nada', async () => {
    store.item = { documentId: 'd-a', tenantId: EMPRESA_A };

    const res = await documentos.signBulk(cuerpo(
        { ...sesionDe(EMPRESA_A), pathParameters: { id: 'd-a' } },
        { personaIds: ['p-1', 'p-2', 'p-3'], tipoFirma: 'trabajador' },
    ));

    assert.equal(res.statusCode, 400);
    assert.equal(store.escrituras.length, 0);
});

// ─── Firmas ──────────────────────────────────────────────────────────────────

test('una firma de otra empresa no se lee', async () => {
    store.item = { signatureId: 'f-b', tenantId: EMPRESA_B, workerRut: '11.111.111-1' };

    const res = await firmas.get({ ...sesionDe(EMPRESA_A), pathParameters: { id: 'f-b' } });

    assert.equal(res.statusCode, 404);
    assert.doesNotMatch(res.body, /11\.111\.111/, 'no se filtra el RUT del firmante');
});

test('una firma de otra empresa no se puede disputar', async () => {
    store.item = { signatureId: 'f-b', tenantId: EMPRESA_B, estado: 'valida', personaId: 'p-b' };

    const res = await firmas.dispute(cuerpo(
        { ...sesionDe(EMPRESA_A), pathParameters: { id: 'f-b' } },
        { motivo: 'No la reconozco', reportadoPor: 'p-a' },
    ));

    assert.equal(res.statusCode, 404);
    assert.equal(store.escrituras.length, 0);
});

test('solo un administrador resuelve (y revoca) una disputa', async () => {
    store.item = { signatureId: 'f-a', tenantId: EMPRESA_A, estado: 'disputada', disputaInfo: {} };

    const res = await firmas.resolve(cuerpo(
        { ...sesionDe(EMPRESA_A), pathParameters: { id: 'f-a' } },
        { resolucion: 'Revocada', resueltoPor: 'quien-sea', nuevoEstado: 'revocada' },
    ));

    assert.equal(res.statusCode, 403);
    assert.equal(store.escrituras.length, 0, 'la firma no se revocó');
});

test('el administrador resuelve y queda registrado como quien resolvió', async () => {
    store.item = { signatureId: 'f-a', tenantId: EMPRESA_A, estado: 'disputada', disputaInfo: { motivo: 'x' } };

    const res = await firmas.resolve(cuerpo(
        { ...sesionDe(EMPRESA_A, { rol: 'admin', personaId: 'p-admin' }), pathParameters: { id: 'f-a' } },
        { resolucion: 'Se confirma', resueltoPor: 'otra-persona', nuevoEstado: 'valida' },
    ));

    assert.equal(res.statusCode, 200);
    const update = store.escrituras.find((e) => e.UpdateExpression);
    assert.equal(update.ExpressionAttributeValues[':disputaInfo'].resueltoPor, 'p-admin');
});

test('el historial de firmas se acota a la empresa de la sesión', async () => {
    // Una misma persona puede estar en dos empresas: el índice por personaId es
    // global y devuelve las firmas de ambas.
    store.personaItems = [
        { signatureId: 'f-a', tenantId: EMPRESA_A, personaId: 'p-a', timestamp: '2026-01-01T00:00:00.000Z' },
        { signatureId: 'f-b', tenantId: EMPRESA_B, personaId: 'p-a', timestamp: '2026-02-01T00:00:00.000Z' },
    ];

    const res = await firmas.getByWorker({ ...sesionDe(EMPRESA_A), pathParameters: { workerId: 'p-a' } });

    const { data } = JSON.parse(res.body);
    assert.equal(data.totalFirmas, 1);
    assert.equal(data.firmas[0].signatureId, 'f-a');
});

test('las disputas se listan por la empresa de la sesión, no por la del parámetro', async () => {
    store.personaItems = [{ signatureId: 'f-a', tenantId: EMPRESA_A, estado: 'disputada' }];

    const res = await firmas.listDisputes({
        ...sesionDe(EMPRESA_A),
        queryStringParameters: { tenantId: EMPRESA_B },
    });

    assert.equal(res.statusCode, 200);
});

// ─── Personas ────────────────────────────────────────────────────────────────

const personaItem = (tenantId, personaId, extra = {}) => ({
    PK: `TENANT#${tenantId}`, SK: `PERSONA#${personaId}`,
    personaId, tenantId, rut: '12.345.678-5', nombre: 'Juan', apellido: 'Pérez',
    rol: 'trabajador', ...extra,
});

const eventoPersonas = (evento, metodo, ruta) => ({
    ...evento,
    requestContext: { ...evento.requestContext, http: { method: metodo } },
    rawPath: ruta,
});

test('una persona de otra empresa no se lee', async () => {
    store.personaItems = [personaItem(EMPRESA_B, 'p-b')];

    const res = await personas.personasHandler(
        eventoPersonas(sesionDe(EMPRESA_A), 'GET', '/personas/p-b')
    );

    assert.equal(res.statusCode, 404);
    assert.doesNotMatch(res.body, /12\.345\.678/);
});

test('no se modifica una persona de otra empresa', async () => {
    store.personaItems = [personaItem(EMPRESA_B, 'p-b')];

    const res = await personas.personasHandler(cuerpo(
        eventoPersonas(sesionDe(EMPRESA_A), 'PUT', '/personas/p-b'),
        { rol: 'admin' },
    ));

    assert.equal(res.statusCode, 404);
    assert.equal(store.escrituras.length, 0, 'no se escribió nada en la empresa ajena');
});

test('solo un administrador otorga el rol de administrador', async () => {
    store.personaItems = [personaItem(EMPRESA_A, 'p-otro')];

    const res = await personas.personasHandler(cuerpo(
        eventoPersonas(sesionDe(EMPRESA_A), 'PUT', '/personas/p-otro'),
        { rol: 'admin' },
    ));

    assert.equal(res.statusCode, 403);
    assert.equal(store.escrituras.length, 0);
});

test('sin el permiso de vigilancia no se escribe la ficha de salud', async () => {
    store.personaItems = [personaItem(EMPRESA_A, 'p-otro')];

    const res = await personas.personasHandler(cuerpo(
        eventoPersonas(sesionDe(EMPRESA_A, { permisos: 'personas.ver,personas.crear' }), 'PUT', '/personas/p-otro'),
        { vigilanciaSalud: { enVigilancia: true } },
    ));

    assert.equal(res.statusCode, 403);
    assert.match(JSON.parse(res.body).error, /salud/i);
});

test('cada quien puede editar su propio perfil sin permisos de gestión', async () => {
    store.personaItems = [personaItem(EMPRESA_A, 'p-a')];

    const res = await personas.personasHandler(cuerpo(
        eventoPersonas(sesionDe(EMPRESA_A, { rol: 'colaborador', permisos: '' }), 'PUT', '/personas/p-a'),
        { telefono: '+56 9 1111 1111', notificacionesSms: true },
    ));

    assert.equal(res.statusCode, 200);
});

test('nadie edita el nombre de un tercero sin permiso de gestión', async () => {
    store.personaItems = [personaItem(EMPRESA_A, 'p-otro')];

    const res = await personas.personasHandler(cuerpo(
        eventoPersonas(sesionDe(EMPRESA_A, { rol: 'colaborador', permisos: '' }), 'PUT', '/personas/p-otro'),
        { nombre: 'Nombre cambiado' },
    ));

    assert.equal(res.statusCode, 403);
    assert.equal(store.escrituras.length, 0);
});

test('el PIN de quien ya lo tiene solo lo cambia esa persona', async () => {
    store.personaItems = [personaItem(EMPRESA_A, 'p-otro', { pinHash: 'hash-existente' })];

    const res = await personas.personasHandler(cuerpo(
        eventoPersonas(sesionDe(EMPRESA_A), 'POST', '/personas/p-otro/set-pin'),
        { pin: '9999' },
    ));

    assert.equal(res.statusCode, 403, 'reemplazar el PIN es poder firmar por esa persona');
    assert.equal(store.escrituras.length, 0);
});

test('sin permiso no se resetea la contraseña de nadie', async () => {
    store.personaItems = [personaItem(EMPRESA_A, 'p-otro')];

    const res = await personas.personasHandler(cuerpo(
        eventoPersonas(sesionDe(EMPRESA_A, { rol: 'colaborador', permisos: '' }), 'POST', '/personas/p-otro/reset-password'),
        {},
    ));

    assert.equal(res.statusCode, 403);
    assert.equal(store.escrituras.length, 0, 'no se generó ninguna contraseña temporal');
});

test('no se resetea la contraseña de una persona de otra empresa', async () => {
    store.personaItems = [personaItem(EMPRESA_B, 'p-b')];

    const res = await personas.personasHandler(cuerpo(
        eventoPersonas(sesionDe(EMPRESA_A), 'POST', '/personas/p-b/reset-password'),
        {},
    ));

    assert.equal(res.statusCode, 404);
    assert.equal(store.escrituras.length, 0);
});

// ─── Datos de salud en la ficha ──────────────────────────────────────────────

test('la ficha de una persona no lleva datos de salud por omisión', () => {
    const persona = new Persona({
        personaId: 'p-1', tenantId: EMPRESA_A, rut: '12.345.678-5', nombre: 'Juan', rol: 'trabajador',
        vigilanciaSalud: { enVigilancia: true, agente: 'sílice' },
        restriccionLaboral: { vigente: true, detalle: 'sin altura' },
    });

    const ficha = persona.toSafeFormat();

    assert.equal('vigilanciaSalud' in ficha, false);
    assert.equal('restriccionLaboral' in ficha, false);
    assert.equal(ficha.nombre, 'Juan', 'el resto de la ficha se mantiene');
});

test('los datos de salud viajan solo cuando se piden explícitamente', () => {
    const persona = new Persona({
        personaId: 'p-1', tenantId: EMPRESA_A, rut: '12.345.678-5', nombre: 'Juan', rol: 'trabajador',
        vigilanciaSalud: { enVigilancia: true, agente: 'sílice' },
    });

    const ficha = persona.toSafeFormat({ incluirSalud: true });

    assert.equal(ficha.vigilanciaSalud.agente, 'sílice');
});

// ─── Verificación pública de firmas ──────────────────────────────────────────

test('la verificación pública devuelve el RUT parcial, no el completo', async () => {
    store.personaItems = [];
    const originalScan = docClient.send;
    docClient.send = async (cmd) => {
        if (cmd.constructor.name === 'ScanCommand') {
            return { Items: [{
                signatureId: 'f-a', token: 'tok-publico', tenantId: EMPRESA_A,
                workerNombre: 'Juan Pérez', workerRut: '12.345.678-5',
                fecha: '2026-09-15', horario: '10:00', estado: 'valida',
            }] };
        }
        return originalScan(cmd);
    };

    const res = await firmas.verifyByToken({ pathParameters: { token: 'tok-publico' } });
    docClient.send = originalScan;

    const { data } = JSON.parse(res.body);
    assert.equal(res.statusCode, 200, 'sigue siendo pública: se verifica sin sesión');
    assert.equal(data.firma.workerNombre, 'Juan Pérez', 'el nombre sí identifica la firma');
    assert.equal(data.firma.workerRut, '···.678-5');
    assert.doesNotMatch(res.body, /12\.345/, 'el RUT completo no viaja');
});

test('el RUT parcial conserva los últimos dígitos y el verificador', () => {
    const { enmascararRut } = require('../lib/utils/validation');
    assert.equal(enmascararRut('12.345.678-5'), '···.678-5');
    assert.equal(enmascararRut('123456785'), '···.678-5');
    assert.equal(enmascararRut('7.654.321-K'), '···.321-K');
    assert.equal(enmascararRut(null), null);
});
