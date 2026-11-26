process.env.CAMPO_HMAC_KEY = 'clave-de-prueba-hmac';
process.env.CAMPO_CIFRADO_LOCAL_KEY = require('crypto').randomBytes(32).toString('base64');
process.env.CREDENCIAL_PEPPER = 'pimienta-de-prueba';
process.env.EVIDENCIA_BUCKET = process.env.EVIDENCIA_BUCKET || 'evidencia-de-prueba';
process.env.AWS_REGION = process.env.AWS_REGION || 'us-east-1';
process.env.AWS_ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID || 'PRUEBA_SIN_AWS';
process.env.AWS_SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY || 'PRUEBA_SIN_AWS';

const { prepararEntorno, crearDobleTablas } = require('./doble-dynamo-tablas');
const esquemas = prepararEntorno();

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand } = require('@aws-sdk/lib-dynamodb');
const { fuente } = require('../lib/gobernanza/inventario');

const { s3Client } = require('../lib/clients/s3');
const { PersonaService } = require('../lib/services/PersonaService');
const { TenantService } = require('../lib/services/TenantService');
const { eventBus } = require('../lib/events/EventBus');
const { huellaClave } = require('../lib/gobernanza/auditoriaSalud');
const incidentes = require('../handlers/incidents-module/handler');

let doble; let emitir; let consola; let enviarS3;
let objetos; // clave → lo que respondería HeadObject
let A; let B; let gestora; let soloHistorial; let trabajadora; let companero; let ajena;

beforeEach(async () => {
    doble = crearDobleTablas(DynamoDBDocumentClient.prototype, esquemas, { proyecciones: true });
    emitir = eventBus.emit;
    eventBus.emit = async () => {};
    consola = { log: console.log, error: console.error, warn: console.warn };
    console.log = () => {}; console.error = () => {}; console.warn = () => {};

    // S3: solo HeadObject, con lo que la prueba haya "subido". Lo demás sigue al
    // cliente real, que `tests/sin-aws.js` bloquea.
    objetos = new Map();
    enviarS3 = s3Client.send;
    s3Client.send = async function simulado(cmd) {
        if (cmd.constructor.name === 'HeadObjectCommand') {
            if (!objetos.has(cmd.input.Key)) throw Object.assign(new Error('NotFound'), { name: 'NotFound', $metadata: { httpStatusCode: 404 } });
            return objetos.get(cmd.input.Key);
        }
        return enviarS3.call(s3Client, cmd);
    };

    A = (await new TenantService().setup({ nombre: 'Constructora A', rutEmpresa: '76.543.210-3' })).tenantId;
    B = (await new TenantService().setup({ nombre: 'Constructora B', rutEmpresa: '77.777.777-7' })).tenantId;
    const svc = new PersonaService();
    gestora = (await svc.crear(A, { rut: '12.345.678-5', nombre: 'Sara', rol: 'supervisor' })).persona.personaId;
    soloHistorial = (await svc.crear(A, { rut: '9.876.543-3', nombre: 'Hugo', rol: 'supervisor' })).persona.personaId;
    trabajadora = (await svc.crear(A, { rut: '11.111.111-1', nombre: 'Rosa', rol: 'trabajador' })).persona.personaId;
    companero = (await svc.crear(A, { rut: '16.666.666-K', nombre: 'Juan', rol: 'trabajador' })).persona.personaId;
    ajena = (await svc.crear(B, { rut: '22.222.222-2', nombre: 'Otra', rol: 'supervisor' })).persona.personaId;
});
afterEach(() => {
    s3Client.send = enviarS3;
    doble.restaurar();
    eventBus.emit = emitir;
    Object.assign(console, consola);
});

const GESTION = 'incidentes.reportar,incidentes.historial';
const SOLO_HISTORIAL = 'incidentes.historial';
const TRABAJADOR = 'actividades.ver';
const HUELLA = Buffer.alloc(32, 7).toString('base64');

const pedir = (quien, metodo, ruta, body) => incidentes.incidentsHandler({
    rawPath: ruta, rawQueryString: '', headers: { host: 'api.test' }, queryStringParameters: null,
    body: body === undefined ? undefined : JSON.stringify(body),
    requestContext: {
        http: { method: metodo, path: ruta, sourceIp: '200.1.2.3' },
        authorizer: { lambda: { sessionId: 's', personaId: quien.personaId, tenantId: quien.tenantId, rol: 'x', permisos: quien.permisos, credencialProvisional: 'false' } },
    },
});
const como = (personaId, permisos, tenantId = A) => ({ personaId, permisos, tenantId });
const datos = (res) => JSON.parse(res.body).data;

/** Un accidente grave, creado por quien gestiona. Devuelve su id. */
const accidente = async (extra = {}) => {
    const res = await pedir(como(gestora, GESTION), 'POST', '/incidents', {
        tipo: 'accidente', gravedad: 'grave', descripcion: 'Caída desde el andamio', obraId: 'o-1',
        trabajador: { nombre: 'Pedro Soto', rut: '15.555.555-6' }, ...extra,
    });
    assert.equal(res.statusCode, 201, res.body);
    return datos(res).incidentId;
};
const guardado = (id) => doble.items('INCIDENTS_TABLE').find((i) => i.incidentId === id);

/** Paso 1: pide la URL de subida. */
const pedirSubida = (quien, id, extra = {}) => pedir(quien, 'POST', `/incidents/${id}/documents`, {
    tipo: 'diat', fileType: 'application/pdf', checksumSha256: HUELLA, tamano: 2048, ...extra,
});
/** Deja el archivo "subido" en S3, como lo vería HeadObject. */
const subirAS3 = (s3Key, extra = {}) => objetos.set(s3Key, {
    ContentType: 'application/pdf', ContentLength: 2048, ChecksumSHA256: HUELLA, VersionId: 'v1', ...extra,
});
/** Paso 2: confirma. */
const confirmar = (quien, id, s3Key, extra = {}) => pedir(quien, 'POST', `/incidents/${id}/documents/confirmar`, {
    s3Key, fileName: 'DIAT.pdf', ...extra,
});

/** Los dos pasos completos; devuelve la respuesta de la confirmación y la clave. */
const subirPapel = async (quien, id, { tipo = 'diat', fileType = 'application/pdf', fileName = 'DIAT.pdf', fecha, head } = {}) => {
    const paso1 = await pedirSubida(quien, id, { tipo, fileType });
    assert.equal(paso1.statusCode, 200, paso1.body);
    const { s3Key } = datos(paso1);
    subirAS3(s3Key, { ContentType: fileType, ...(head || {}) });
    const paso2 = await confirmar(quien, id, s3Key, { fileName, ...(fecha ? { fechaDocumento: fecha } : {}) });
    return { res: paso2, s3Key };
};

const verPapeles = async (id, quien = como(gestora, GESTION)) => datos(await pedir(quien, 'GET', `/incidents/${id}/documents`));
const anular = (id, papelId, body = { motivo: 'Se subió con el tipo equivocado' }, quien = como(gestora, GESTION)) =>
    pedir(quien, 'PUT', `/incidents/${id}/documents/${papelId}/anular`, body);
const cumple = (lista, clave) => lista.requeridos.find((r) => r.clave === clave).cumplido;

test('anular un papel: deja de contar, queda en el caso con su motivo y se puede subir de nuevo', async () => {
    const id = await accidente();
    const { s3Key } = await subirPapel(como(gestora, GESTION), id);
    const { papelId } = guardado(id).papeles[0];
    assert.equal(cumple(await verPapeles(id), 'diat'), true);

    const res = await anular(id, papelId);
    assert.equal(res.statusCode, 200, res.body);
    assert.ok(!res.body.includes(s3Key), 'no devuelve la clave');
    const [p] = guardado(id).papeles;
    assert.equal(p.s3Key, s3Key);
    assert.equal(p.anulado.anuladoPor, gestora);
    assert.equal(p.anulado.motivo, 'Se subió con el tipo equivocado');
    const despues = await verPapeles(id);
    assert.equal(cumple(despues, 'diat'), false);
    assert.equal(despues.archivos.length, 1);
    assert.ok(despues.archivos[0].anulado);

    await subirPapel(como(gestora, GESTION), id);
    assert.equal(cumple(await verPapeles(id), 'diat'), true);
    assert.equal(guardado(id).papeles.length, 2);
});

test('anular exige motivo, permiso de gestión, un papel vigente y el caso abierto', async () => {
    const id = await accidente();
    await subirPapel(como(gestora, GESTION), id);
    const { papelId } = guardado(id).papeles[0];
    assert.equal((await anular(id, papelId, { motivo: '   ' })).statusCode, 400);
    assert.equal((await anular(id, papelId, { motivo: 'x'.repeat(501) })).statusCode, 400);
    assert.equal((await anular(id, papelId, undefined, como(soloHistorial, SOLO_HISTORIAL))).statusCode, 403);
    assert.equal((await anular(id, papelId, undefined, como(gestora, 'incidentes.reportar'))).statusCode, 403);
    assert.equal((await anular(id, papelId, undefined, como(ajena, GESTION, B))).statusCode, 404);
    assert.equal((await anular(id, 'no-existe')).statusCode, 404);
    guardado(id).estado = 'cerrado';
    assert.equal((await anular(id, papelId)).statusCode, 409);
    assert.equal(guardado(id).papeles[0].anulado, undefined);
    guardado(id).estado = 'en_investigacion';
    assert.equal((await anular(id, papelId)).statusCode, 200);
    assert.equal((await anular(id, papelId)).statusCode, 409);
});

test('quien anuló un papel cuenta como persona involucrada para la retención', () => {
    const personas = fuente('INCIDENTS_TABLE').personasDe({ papeles: [{ subidoPor: 'p-subio', anulado: { anuladoPor: 'p-anulo' } }] });
    assert.ok(personas.includes('p-anulo'));
});

const guardarInforme = async (id, extra = {}) => {
    const documentId = `informe-${id}`;
    const s3Key = `tenants/${A}/registros/o-1/investigaciones/${documentId}.html`;
    guardado(id).obraId = 'o-1';
    await DynamoDBDocumentClient.from(new DynamoDBClient({})).send(new PutCommand({
        TableName: process.env.DOCUMENTS_TABLE,
        Item: { documentId, tenantId: A, tipo: 'INVESTIGACION_ACCIDENTE', s3Key, createdAt: '2026-11-26T12:00:00.000Z', ...extra },
    }));
    guardado(id).informeDocumentId = documentId;
    return s3Key;
};

test('el informe firmado desde la obra aparece entre los papeles y se descarga con enlace auditado', async () => {
    const id = await accidente();
    const s3Key = await guardarInforme(id);
    const lista = await pedir(como(soloHistorial, SOLO_HISTORIAL), 'GET', `/incidents/${id}/documents`);
    assert.ok(!lista.body.includes(s3Key), 'la lista no entrega la clave');
    const [p] = datos(lista).archivos;
    assert.equal(p.papelId, 'informe-firmado');
    assert.equal(p.firmado, true);
    assert.equal(p.contieneSalud, true);
    assert.equal(p.documento, undefined);

    const enlace = await pedir(como(soloHistorial, SOLO_HISTORIAL), 'GET', `/incidents/${id}/documents/informe-firmado/enlace`);
    assert.equal(enlace.statusCode, 200, enlace.body);
    assert.match(datos(enlace).url, /investigaciones.*X-Amz-Signature=/);
    assert.ok(JSON.stringify(doble.items('AUDITORIA_ACCESOS_TABLE')).includes(huellaClave(s3Key)), 'queda en la auditoría');
    assert.equal((await pedir(como(trabajadora, TRABAJADOR), 'GET', `/incidents/${id}/documents/informe-firmado/enlace`)).statusCode, 404);
    assert.equal((await anular(id, 'informe-firmado')).statusCode, 404, 'el informe firmado no se anula');
});

test('no se entrega como informe un documento de otra empresa, de otro tipo o fuera de registros', async () => {
    for (const extra of [{ tenantId: 'otra' }, { tipo: 'OTRO' }, { s3Key: 'tenants/otra/registros/x.html' }, { s3Key: `tenants/${A}/registros/o-1/vigilancia/otro.html` }]) {
        const id = await accidente();
        await guardarInforme(id, extra);
        assert.deepEqual((await verPapeles(id)).archivos, [], JSON.stringify(extra));
        assert.equal((await pedir(como(gestora, GESTION), 'GET', `/incidents/${id}/documents/informe-firmado/enlace`)).statusCode, 404);
    }
});

test('un informe firmado alterado no se entrega', async () => {
    const id = await accidente();
    const s3Key = await guardarInforme(id, { archivoHuella: { alg: 'sha256', valor: HUELLA } });
    objetos.set(s3Key, { ChecksumSHA256: Buffer.alloc(32, 9).toString('base64') });
    const res = await pedir(como(gestora, GESTION), 'GET', `/incidents/${id}/documents/informe-firmado/enlace`);
    assert.equal(res.statusCode, 409, res.body);
});

test('el responsable de un hallazgo tiene que poder ver el historial; el ya asignado no se revalida', async () => {
    const hallazgo = { clasificacion: 'hallazgo', tipo: 'condicion_subestandar', descripcion: 'Baranda suelta', obraId: 'o-1' };
    const svc = doble.items('PERSONAS_TABLE');
    for (const x of svc) x.estado = 'activo';
    assert.equal((await pedir(como(gestora, GESTION), 'POST', '/incidents', { ...hallazgo, responsableId: companero })).statusCode, 400);
    const creado = await pedir(como(gestora, GESTION), 'POST', '/incidents', { ...hallazgo, responsableId: soloHistorial });
    assert.equal(creado.statusCode, 201, creado.body);
    const id = datos(creado).incidentId;
    const gobernanza = (body) => pedir(como(gestora, GESTION), 'PUT', `/incidents/${id}/gobernanza`, body);
    const triaje = (body) => pedir(como(gestora, `${GESTION},incidentes.calificar_accidente`), 'PUT', `/incidents/${id}/triaje`, body);
    assert.equal((await gobernanza({ responsableId: companero })).statusCode, 400);
    assert.equal((await triaje({ tipo: 'condicion_subestandar', responsableId: companero })).statusCode, 400);
    assert.equal(guardado(id).gobernanza.responsableId, soloHistorial);
    guardado(id).gobernanza.responsableId = companero;
    assert.equal((await gobernanza({ responsableId: companero, plazoRespuestaISO: '2026-12-10' })).statusCode, 200);
});

const enviarDynamo = () => DynamoDBDocumentClient.prototype.send;
const conFallo = async (condicion, fn) => {
    const original = enviarDynamo();
    DynamoDBDocumentClient.prototype.send = async function enviar(cmd) {
        const err = condicion(cmd);
        if (err) throw err;
        return original.call(this, cmd);
    };
    try { return await fn(); } finally { DynamoDBDocumentClient.prototype.send = original; }
};
const caida = () => Object.assign(new Error('caída'), { name: 'InternalServerError' });

test('si el caso cambia entre la lectura y la anulación, responde 409 y no pisa lo nuevo', async () => {
    const id = await accidente();
    await subirPapel(como(gestora, GESTION), id);
    const { papelId } = guardado(id).papeles[0];
    const res = await conFallo((cmd) => {
        if (cmd.constructor.name === 'UpdateCommand' && cmd.input.TableName === process.env.INCIDENTS_TABLE) {
            const it = guardado(id);
            if (it.updatedAt !== '2099-01-01T00:00:00.000Z') {
                it.updatedAt = '2099-01-01T00:00:00.000Z';
                it.papeles.push({ papelId: 'de-otra-persona', tipo: 'otro', s3Key: 'k' });
            }
        }
        return null;
    }, () => anular(id, papelId));
    assert.equal(res.statusCode, 409, res.body);
    assert.deepEqual(guardado(id).papeles.map((p) => p.papelId), [papelId, 'de-otra-persona']);
    assert.equal(guardado(id).papeles[0].anulado, undefined);
});

test('los anulados no ocupan el cupo de 30, y el total guardado no pasa de 60', async () => {
    const id = await accidente();
    const lleno = (n, anulados) => Array.from({ length: n }, (_, i) => ({ papelId: `p${i}`, tipo: 'otro', s3Key: `k${i}`, ...(i < anulados ? { anulado: { motivo: 'x' } } : {}) }));
    guardado(id).papeles = lleno(30, 1);
    assert.equal((await pedirSubida(como(gestora, GESTION), id)).statusCode, 200);
    guardado(id).papeles = lleno(30, 0);
    assert.equal((await pedirSubida(como(gestora, GESTION), id)).statusCode, 400);
    guardado(id).papeles = lleno(60, 59);
    assert.equal((await pedirSubida(como(gestora, GESTION), id)).statusCode, 400);
});

test('si no se puede consultar el informe firmado, los demás papeles se listan y se avisa', async () => {
    const id = await accidente();
    await subirPapel(como(gestora, GESTION), id);
    await guardarInforme(id);
    const res = await conFallo((cmd) => (cmd.constructor.name === 'GetCommand' && cmd.input.TableName === process.env.DOCUMENTS_TABLE ? caida() : null),
        () => pedir(como(gestora, GESTION), 'GET', `/incidents/${id}/documents`));
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(datos(res).informeNoDisponible, true);
    assert.equal(datos(res).archivos.length, 1);
});

test('un caso anonimizado no entrega el informe firmado', async () => {
    const id = await accidente();
    await guardarInforme(id);
    guardado(id).anonimizadoEl = '2031-01-01T00:00:00.000Z';
    assert.deepEqual((await verPapeles(id)).archivos, []);
    assert.equal((await pedir(como(gestora, GESTION), 'GET', `/incidents/${id}/documents/informe-firmado/enlace`)).statusCode, 404);
});

test('la auditoría de la descarga del informe identifica el caso y el documento', async () => {
    const id = await accidente();
    await guardarInforme(id);
    await pedir(como(gestora, GESTION), 'GET', `/incidents/${id}/documents/informe-firmado/enlace`);
    const [fila] = doble.items('AUDITORIA_ACCESOS_TABLE').filter((r) => Array.isArray(r.tipos) && r.tipos.includes('descarga_documento_salud'));
    assert.deepEqual(fila.documentos, [id, `informe-${id}`]);
});

test('si no se pueden leer los roles de la empresa, no se decide quién puede ser responsable (503)', async () => {
    for (const x of doble.items('PERSONAS_TABLE')) x.estado = 'activo';
    const res = await conFallo((cmd) => (cmd.constructor.name === 'GetCommand' && cmd.input.TableName === process.env.TENANTS_TABLE ? caida() : null),
        () => pedir(como(gestora, GESTION), 'POST', '/incidents', { clasificacion: 'hallazgo', tipo: 'condicion_subestandar', descripcion: 'Baranda', obraId: 'o-1', responsableId: soloHistorial }));
    assert.equal(res.statusCode, 503, res.body);
    assert.equal(doble.items('INCIDENTS_TABLE').length, 0);
});
