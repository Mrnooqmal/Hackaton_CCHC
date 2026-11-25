// Fase 1 del rediseño de incidentes: reportar funciona de punta a punta.
//
// El formulario creaba el reporte y adjuntaba las fotos con `PUT /incidents/{id}`,
// que exige `incidentes.reportar`. Un trabajador que reporta un hallazgo no lo
// tiene: recibía 403 y las fotos quedaban fuera del reporte, con la pantalla
// diciendo "reportado correctamente". Ahora las adjunta por
// `POST /incidents/{id}/evidencias`, que solo agrega claves de ese incidente y de
// esa empresa, y solo a quien lo reportó (o a quien gestiona incidentes).
//
// También: el campo "medidas inmediatas" se guarda y se devuelve, y quien
// reporta sale de la sesión, no del cuerpo.

process.env.CAMPO_HMAC_KEY = 'clave-de-prueba-hmac';
process.env.CAMPO_CIFRADO_LOCAL_KEY = require('crypto').randomBytes(32).toString('base64');
process.env.CREDENCIAL_PEPPER = 'pimienta-de-prueba';
// Para firmar URLs de subida sin AWS (si no las puso ya tests/sin-aws.js).
process.env.EVIDENCIA_BUCKET = process.env.EVIDENCIA_BUCKET || 'evidencia-de-prueba';
process.env.AWS_REGION = process.env.AWS_REGION || 'us-east-1';
process.env.AWS_ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID || 'PRUEBA_SIN_AWS';
process.env.AWS_SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY || 'PRUEBA_SIN_AWS';

const { prepararEntorno, crearDobleTablas } = require('./doble-dynamo-tablas');
const esquemas = prepararEntorno();

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');

const { PersonaService } = require('../lib/services/PersonaService');
const { TenantService } = require('../lib/services/TenantService');
const { eventBus } = require('../lib/events/EventBus');
const incidentes = require('../handlers/incidents-module/handler');

let doble; let emitir; let consola;
let A; let B; let trabajadora; let companero; let supervisora; let ajena;

beforeEach(async () => {
    // El repositorio de incidentes construye su propio cliente: el doble va en
    // el prototipo, que comparten todos.
    doble = crearDobleTablas(DynamoDBDocumentClient.prototype, esquemas, { proyecciones: true });
    emitir = eventBus.emit;
    eventBus.emit = async () => {};
    consola = { log: console.log, error: console.error, warn: console.warn };
    console.log = () => {}; console.error = () => {}; console.warn = () => {};
    A = (await new TenantService().setup({ nombre: 'Constructora A', rutEmpresa: '76.543.210-3' })).tenantId;
    B = (await new TenantService().setup({ nombre: 'Constructora B', rutEmpresa: '77.777.777-7' })).tenantId;
    const svc = new PersonaService();
    trabajadora = (await svc.crear(A, { rut: '11.111.111-1', nombre: 'Rosa', rol: 'trabajador' })).persona.personaId;
    companero = (await svc.crear(A, { rut: '9.876.543-3', nombre: 'Juan', rol: 'trabajador' })).persona.personaId;
    supervisora = (await svc.crear(A, { rut: '12.345.678-5', nombre: 'Sara', rol: 'supervisor' })).persona.personaId;
    ajena = (await svc.crear(B, { rut: '22.222.222-2', nombre: 'Otra', rol: 'trabajador' })).persona.personaId;
});
afterEach(() => {
    doble.restaurar();
    eventBus.emit = emitir;
    Object.assign(console, consola);
});

// Sesión de un trabajador: sin `incidentes.reportar` ni `incidentes.historial`.
const TRABAJADOR = 'actividades.ver';
const GESTION = 'incidentes.reportar,incidentes.historial';

const pedir = (quien, metodo, ruta, body) => incidentes.incidentsHandler({
    rawPath: ruta, rawQueryString: '', headers: { host: 'api.test' }, queryStringParameters: null,
    body: body === undefined ? undefined : JSON.stringify(body),
    requestContext: {
        http: { method: metodo, path: ruta },
        authorizer: { lambda: { sessionId: 's', personaId: quien.personaId, tenantId: quien.tenantId, rol: 'x', permisos: quien.permisos, credencialProvisional: 'false' } },
    },
});
const como = (personaId, permisos, tenantId = A) => ({ personaId, permisos, tenantId });

const HALLAZGO = { clasificacion: 'hallazgo', tipo: 'condicion_subestandar', descripcion: 'Baranda suelta en losa 3', obraId: 'o-1' };
const UUID = '0b6f1c2e-3d4a-4b5c-8d9e-0f1a2b3c4d5e';
const UUID2 = '1c7a2d3f-4e5b-4c6d-9e0f-1a2b3c4d5e6f';
const clave = (tenantId, incidentId, uuid = UUID, ext = 'jpg') => `tenants/${tenantId}/incidentes/${incidentId}/${uuid}.${ext}`;

/** Crea un hallazgo como la trabajadora y devuelve su id. */
const reportar = async (extra = {}) => {
    const res = await pedir(como(trabajadora, TRABAJADOR), 'POST', '/incidents', { ...HALLAZGO, ...extra });
    assert.equal(res.statusCode, 201, res.body);
    return JSON.parse(res.body).data.incidentId;
};
const guardado = (id) => doble.items('INCIDENTS_TABLE').find((i) => i.incidentId === id);

test('quien reportó sale de la sesión, aunque el cuerpo diga otra cosa', async () => {
    const id = await reportar({ reportadoPor: supervisora });
    assert.equal(guardado(id).reportadoPor, trabajadora);
});

test('la hipótesis: un trabajador no puede adjuntar sus fotos por PUT /incidents/{id}', async () => {
    const id = await reportar();
    const res = await pedir(como(trabajadora, TRABAJADOR), 'PUT', `/incidents/${id}`, { evidencias: [clave(A, id)] });
    assert.equal(res.statusCode, 403, res.body);
    assert.deepEqual(guardado(id).evidencias, []);
});

test('quien reportó puede adjuntar evidencia a su propio reporte, y se agrega sin pisar lo anterior', async () => {
    const id = await reportar();
    const r1 = await pedir(como(trabajadora, TRABAJADOR), 'POST', `/incidents/${id}/evidencias`, { evidencias: [clave(A, id)] });
    assert.equal(r1.statusCode, 200, r1.body);
    const r2 = await pedir(como(trabajadora, TRABAJADOR), 'POST', `/incidents/${id}/evidencias`, { evidencias: [clave(A, id, UUID2, 'png'), clave(A, id)] });
    assert.equal(r2.statusCode, 200, r2.body);
    assert.deepEqual(guardado(id).evidencias, [clave(A, id), clave(A, id, UUID2, 'png')]);
    assert.deepEqual(JSON.parse(r2.body).data.evidencias, [clave(A, id), clave(A, id, UUID2, 'png')]);
});

test('la ruta solo agrega evidencia: ignora cualquier otro campo del cuerpo', async () => {
    const id = await reportar();
    const res = await pedir(como(trabajadora, TRABAJADOR), 'POST', `/incidents/${id}/evidencias`, {
        evidencias: [clave(A, id)], estado: 'cerrado', tenantId: B, descripcion: 'otra', reportadoPor: companero,
    });
    assert.equal(res.statusCode, 200, res.body);
    const it = guardado(id);
    assert.equal(it.estado, 'reportado');
    assert.equal(it.tenantId, A);
    assert.equal(it.descripcion, HALLAZGO.descripcion);
    assert.equal(it.reportadoPor, trabajadora);
});

test('otra persona de la empresa sin permiso no puede adjuntar a un reporte ajeno (404: ni sabe que existe)', async () => {
    const id = await reportar();
    const res = await pedir(como(companero, TRABAJADOR), 'POST', `/incidents/${id}/evidencias`, { evidencias: [clave(A, id)] });
    assert.equal(res.statusCode, 404, res.body);
    assert.deepEqual(guardado(id).evidencias, []);
});

test('quien ve el historial pero no gestiona incidentes tampoco adjunta a lo ajeno (403)', async () => {
    const id = await reportar();
    const res = await pedir(como(companero, 'incidentes.historial'), 'POST', `/incidents/${id}/evidencias`, { evidencias: [clave(A, id)] });
    assert.equal(res.statusCode, 403, res.body);
    assert.deepEqual(guardado(id).evidencias, []);
});

test('quien gestiona incidentes (incidentes.reportar) puede adjuntar evidencia', async () => {
    const id = await reportar();
    const res = await pedir(como(supervisora, GESTION), 'POST', `/incidents/${id}/evidencias`, { evidencias: [clave(A, id)] });
    assert.equal(res.statusCode, 200, res.body);
    assert.deepEqual(guardado(id).evidencias, [clave(A, id)]);
});

test('un incidente de otra empresa responde 404, aunque quien pide tenga todos los permisos', async () => {
    const id = await reportar();
    const res = await pedir(como(ajena, GESTION, B), 'POST', `/incidents/${id}/evidencias`, { evidencias: [clave(B, id)] });
    assert.equal(res.statusCode, 404, res.body);
    assert.deepEqual(guardado(id).evidencias, []);
});

test('no se aceptan claves de otra empresa, de otro incidente, fuera de forma ni documentos del caso', async () => {
    const id = await reportar();
    const otro = await reportar();
    const malas = [
        clave(B, id),
        clave(A, otro),
        `tenants/${A}/incidentes/sin-incidente/${UUID}.jpg`,
        `tenants/${A}/incidentes/${id}/../${otro}/${UUID}.jpg`,
        `tenants/${A}/incidentes/${id}/diat-${UUID}.pdf`,
        `tenants/${A}/incidentes/${id}/sub/${UUID}.jpg`,
        `tenants/${A}/incidentes/${id}/`,
        42,
    ];
    for (const mala of malas) {
        const res = await pedir(como(trabajadora, TRABAJADOR), 'POST', `/incidents/${id}/evidencias`, { evidencias: [clave(A, id), mala] });
        assert.equal(res.statusCode, 400, `${String(mala)}: ${res.body}`);
    }
    assert.deepEqual(guardado(id).evidencias, [], 'una sola clave mala rechaza el envío entero');
});

test('sin claves, o con demasiadas, responde 400', async () => {
    const id = await reportar();
    const vacio = await pedir(como(trabajadora, TRABAJADOR), 'POST', `/incidents/${id}/evidencias`, { evidencias: [] });
    assert.equal(vacio.statusCode, 400, vacio.body);
    const sinCampo = await pedir(como(trabajadora, TRABAJADOR), 'POST', `/incidents/${id}/evidencias`, {});
    assert.equal(sinCampo.statusCode, 400, sinCampo.body);

    const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
    const once = Array.from({ length: 11 }, (_, n) => clave(A, id, uuid(n)));
    const muchas = await pedir(como(trabajadora, TRABAJADOR), 'POST', `/incidents/${id}/evidencias`, { evidencias: once });
    assert.equal(muchas.statusCode, 400, muchas.body);

    // Tope total: dos envíos de diez llenan el caso; el siguiente no entra.
    for (const desde of [0, 10]) {
        const lote = Array.from({ length: 10 }, (_, n) => clave(A, id, uuid(desde + n)));
        const r = await pedir(como(trabajadora, TRABAJADOR), 'POST', `/incidents/${id}/evidencias`, { evidencias: lote });
        assert.equal(r.statusCode, 200, r.body);
    }
    const sobra = await pedir(como(trabajadora, TRABAJADOR), 'POST', `/incidents/${id}/evidencias`, { evidencias: [clave(A, id, uuid(99))] });
    assert.equal(sobra.statusCode, 400, sobra.body);
    assert.equal(guardado(id).evidencias.length, 20);
});

test('medidas inmediatas: se guardan en el incidente (no en la traza) y se devuelven al leer', async () => {
    const id = await reportar({ medidasInmediatas: '  Se acordonó la zona y se avisó al capataz.  ' });
    const it = guardado(id);
    assert.equal(it.medidasInmediatas, 'Se acordonó la zona y se avisó al capataz.');
    const traza = doble.items('INCIDENTS_TABLE').find((i) => String(i.incidentId).endsWith('#traza'));
    assert.ok(!JSON.stringify(traza || {}).includes('acordonó'), 'el texto no va en la traza');

    // Quien reportó, sin historial, lo lee en el detalle y en su listado.
    const detalle = await pedir(como(trabajadora, TRABAJADOR), 'GET', `/incidents/${id}`);
    assert.equal(detalle.statusCode, 200, detalle.body);
    assert.equal(JSON.parse(detalle.body).data.medidasInmediatas, 'Se acordonó la zona y se avisó al capataz.');
    const lista = await pedir(como(trabajadora, TRABAJADOR), 'GET', '/incidents');
    assert.equal(JSON.parse(lista.body).data.find((i) => i.incidentId === id).medidasInmediatas, 'Se acordonó la zona y se avisó al capataz.');
});

test('medidas inmediatas: se limitan a 1.000 caracteres, son opcionales y se editan por PUT', async () => {
    const largo = await reportar({ medidasInmediatas: 'x'.repeat(1500) });
    assert.equal(guardado(largo).medidasInmediatas.length, 1000);

    const sin = await reportar();
    assert.equal(guardado(sin).medidasInmediatas, '');

    const res = await pedir(como(supervisora, GESTION), 'PUT', `/incidents/${sin}`, { medidasInmediatas: 'Se retiró el andamio.' });
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(guardado(sin).medidasInmediatas, 'Se retiró el andamio.');
});

// ─── POST /incidents/upload-evidence: la misma regla que adjuntar ────────────
// Antes firmaba a cualquiera de la empresa una subida a la carpeta de cualquier
// incidente. Ahora, con `incidentId`, exige lo mismo que
// `POST /incidents/{id}/evidencias` (función compartida `rechazoParaEvidencia`).

const HUELLA = Buffer.alloc(32, 7).toString('base64');
const subir = (quien, incidentId) => pedir(quien, 'POST', '/incidents/upload-evidence', {
    fileName: 'foto.jpg', fileType: 'image/jpeg', checksumSha256: HUELLA, ...(incidentId === undefined ? {} : { incidentId }),
});

test('upload-evidence: quien reportó obtiene la URL firmada, con la clave en la carpeta de su incidente', async () => {
    const id = await reportar();
    const res = await subir(como(trabajadora, TRABAJADOR), id);
    assert.equal(res.statusCode, 200, res.body);
    const { s3Key, uploadUrl } = JSON.parse(res.body).data;
    assert.ok(s3Key.startsWith(`tenants/${A}/incidentes/${id}/`), s3Key);
    assert.ok(uploadUrl);
    // Y esa clave es exactamente la que después se puede adjuntar.
    const adj = await pedir(como(trabajadora, TRABAJADOR), 'POST', `/incidents/${id}/evidencias`, { evidencias: [s3Key] });
    assert.equal(adj.statusCode, 200, adj.body);
});

test('upload-evidence: quien gestiona incidentes también puede', async () => {
    const id = await reportar();
    const res = await subir(como(supervisora, GESTION), id);
    assert.equal(res.statusCode, 200, res.body);
});

test('upload-evidence: un compañero sin permiso recibe 404 (no puede leer el caso)', async () => {
    const id = await reportar();
    const res = await subir(como(companero, TRABAJADOR), id);
    assert.equal(res.statusCode, 404, res.body);
});

test('upload-evidence: quien lee el historial pero no gestiona recibe 403', async () => {
    const id = await reportar();
    const res = await subir(como(companero, 'incidentes.historial'), id);
    assert.equal(res.statusCode, 403, res.body);
});

test('upload-evidence: un incidente de otra empresa responde 404, con todos los permisos', async () => {
    const id = await reportar();
    const res = await subir(como(ajena, GESTION, B), id);
    assert.equal(res.statusCode, 404, res.body);
});

test('upload-evidence: un incidentId que no es texto responde 400', async () => {
    const res = await subir(como(trabajadora, TRABAJADOR), { $ne: 'x' });
    assert.equal(res.statusCode, 400, res.body);
});

test('upload-evidence sin incidentId responde 400: ya no se firma una subida a un prefijo sin dueño', async () => {
    // Antes iba a `incidentes/sin-incidente/`, en el bucket que no deja borrar durante 5 años,
    // y `agregarEvidencias` nunca aceptaba esa clave: un archivo guardado años sin incidente.
    for (const sinId of [undefined, null, '', 0]) {
        const res = await pedir(como(trabajadora, TRABAJADOR), 'POST', '/incidents/upload-evidence', {
            fileName: 'foto.jpg', fileType: 'image/jpeg', checksumSha256: HUELLA, ...(sinId === undefined ? {} : { incidentId: sinId }),
        });
        assert.equal(res.statusCode, 400, `${String(sinId)}: ${res.body}`);
        assert.match(JSON.parse(res.body).error, /incidentId/);
        assert.ok(!res.body.includes('sin-incidente') && !res.body.includes('uploadUrl'));
    }
});

test('upload-evidence: solo imágenes (jpeg, png, webp, heic, heif); cualquier otro tipo responde 400', async () => {
    const id = await reportar();
    const pedirTipo = (fileType) => pedir(como(trabajadora, TRABAJADOR), 'POST', '/incidents/upload-evidence', {
        fileName: 'archivo', fileType, checksumSha256: HUELLA, incidentId: id,
    });
    const extensiones = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic', 'image/heif': 'heif' };
    for (const [tipo, ext] of Object.entries(extensiones)) {
        const res = await pedirTipo(tipo);
        assert.equal(res.statusCode, 200, `${tipo}: ${res.body}`);
        // La extensión de la clave sale del tipo, no del nombre del archivo.
        assert.ok(JSON.parse(res.body).data.s3Key.endsWith(`.${ext}`), tipo);
    }
    for (const malo of ['application/pdf', 'text/html', 'image/svg+xml', 'image/gif', 'application/x-msdownload', 'image/jpg', 'IMAGE/JPEG', '', undefined, 5]) {
        const res = await pedirTipo(malo);
        assert.equal(res.statusCode, 400, `${String(malo)}: ${res.body}`);
    }
});

test('upload-evidence: la extensión del nombre del archivo no decide la clave (un .exe con tipo imagen sale como imagen)', async () => {
    const id = await reportar();
    const res = await pedir(como(trabajadora, TRABAJADOR), 'POST', '/incidents/upload-evidence', {
        fileName: 'virus.exe', fileType: 'image/png', checksumSha256: HUELLA, incidentId: id,
    });
    assert.equal(res.statusCode, 200, res.body);
    const { s3Key } = JSON.parse(res.body).data;
    assert.ok(s3Key.endsWith('.png') && !s3Key.includes('exe'), s3Key);
    // Y una clave con otra extensión no se acepta al adjuntar.
    const mala = await pedir(como(trabajadora, TRABAJADOR), 'POST', `/incidents/${id}/evidencias`, { evidencias: [clave(A, id, UUID, 'exe')] });
    assert.equal(mala.statusCode, 400, mala.body);
});

test('upload-evidence: en un caso cerrado no se firma la subida (la foto quedaría huérfana en el bucket)', async () => {
    const id = await reportar();
    guardado(id).gobernanza.estadoCierre = 'cerrado';
    const res = await subir(como(supervisora, GESTION), id);
    assert.equal(res.statusCode, 409, res.body);
});
