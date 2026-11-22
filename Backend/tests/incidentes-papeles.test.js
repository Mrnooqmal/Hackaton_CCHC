// Fase 2 del rediseño de incidentes: la carpeta del caso.
//
// Subir un papel (DIAT, DIEP, informe, constancia, respaldo) es en dos pasos:
// pedir la URL de subida —que no registra nada— y confirmar cuando el archivo ya
// está en S3, con HeadObject. Se acumulan en una lista sin pisar lo anterior; se
// descargan con enlace firmado de 15 minutos; y la entrega de la DIAT y la DIEP
// queda en la auditoría de acceso a datos de salud (y si no se puede registrar,
// no sale).

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
const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');

const { s3Client } = require('../lib/clients/s3');
const { PersonaService } = require('../lib/services/PersonaService');
const { TenantService } = require('../lib/services/TenantService');
const { eventBus } = require('../lib/events/EventBus');
const { huellaClave } = require('../lib/gobernanza/auditoriaSalud');
const { MAX_BYTES_PAPEL, MAX_PAPELES_POR_CASO } = require('../lib/casos');
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

// ─── Subir en dos pasos ──────────────────────────────────────────────────────

test('paso 1: la URL de subida se firma con la huella y la clave queda bajo papeles/, sin registrar nada', async () => {
    const id = await accidente();
    const res = await pedirSubida(como(gestora, GESTION), id);
    assert.equal(res.statusCode, 200, res.body);
    const { uploadUrl, s3Key, papelId } = datos(res);
    assert.ok(s3Key.startsWith(`tenants/${A}/incidentes/${id}/papeles/diat-${papelId}.pdf`), s3Key);
    assert.match(uploadUrl, /X-Amz-Signature=/);
    assert.match(uploadUrl, /x-amz-checksum-sha256/i, 'la huella va firmada como header');
    // Sin confirmación no hay registro.
    assert.deepEqual(guardado(id).papeles, []);
    const lista = await pedir(como(gestora, GESTION), 'GET', `/incidents/${id}/documents`);
    assert.deepEqual(datos(lista).archivos, []);
});

test('confirmar un archivo que no se subió falla y no deja registro', async () => {
    const id = await accidente();
    const { s3Key } = datos(await pedirSubida(como(gestora, GESTION), id));
    const res = await confirmar(como(gestora, GESTION), id, s3Key);
    assert.equal(res.statusCode, 400, res.body);
    assert.deepEqual(guardado(id).papeles, []);
});

test('confirmar después de subir registra el papel con tipo, nombre, MIME, quién, cuándo y la fecha del documento', async () => {
    const id = await accidente();
    const { res, s3Key } = await subirPapel(como(gestora, GESTION), id, { fecha: '2026-11-10', fileName: 'DIAT firmada.pdf' });
    assert.equal(res.statusCode, 201, res.body);
    const [p] = guardado(id).papeles;
    assert.equal(p.tipo, 'diat');
    assert.equal(p.nombreArchivo, 'DIAT firmada.pdf');
    assert.equal(p.tipoMime, 'application/pdf');
    assert.equal(p.s3Key, s3Key);
    assert.equal(p.subidoPor, gestora, 'quién sube sale de la sesión');
    assert.ok(p.subidoEn);
    assert.equal(p.fechaDocumento, '2026-11-10');
    assert.equal(p.tamano, 2048);
    assert.deepEqual(p.huella, { alg: 'sha256', valor: HUELLA, versionId: 'v1' });
    // A quien sube no se le devuelve la clave de S3 ni la huella.
    assert.deepEqual(Object.keys(datos(res).papel).sort(), ['fechaDocumento', 'nombreArchivo', 'papelId', 'subidoEn', 'subidoPor', 'tamano', 'tipo', 'tipoMime']);
});

test('confirmar dos veces el mismo archivo no lo duplica', async () => {
    const id = await accidente();
    const { s3Key } = await subirPapel(como(gestora, GESTION), id);
    const otra = await confirmar(como(gestora, GESTION), id, s3Key);
    assert.equal(otra.statusCode, 200, otra.body);
    assert.equal(guardado(id).papeles.length, 1);
});

test('varios archivos del mismo tipo se acumulan: una segunda DIAT no pisa la primera', async () => {
    const id = await accidente();
    const uno = await subirPapel(como(gestora, GESTION), id, { fileName: 'DIAT-1.pdf' });
    const dos = await subirPapel(como(gestora, GESTION), id, { fileName: 'DIAT-2.pdf' });
    const informe = await subirPapel(como(gestora, GESTION), id, { tipo: 'informe_investigacion', fileName: 'informe.pdf' });
    for (const r of [uno, dos, informe]) assert.equal(r.res.statusCode, 201, r.res.body);
    const papeles = guardado(id).papeles;
    assert.deepEqual(papeles.map((p) => p.nombreArchivo), ['DIAT-1.pdf', 'DIAT-2.pdf', 'informe.pdf']);
    assert.deepEqual(papeles.map((p) => p.s3Key), [uno.s3Key, dos.s3Key, informe.s3Key]);
    assert.notEqual(uno.s3Key, dos.s3Key);
});

test('se aceptan PDF y las tres imágenes; la extensión sale del tipo MIME, no del nombre', async () => {
    const id = await accidente();
    for (const [mime, ext] of [['application/pdf', 'pdf'], ['image/jpeg', 'jpg'], ['image/png', 'png'], ['image/webp', 'webp']]) {
        const { res, s3Key } = await subirPapel(como(gestora, GESTION), id, { tipo: 'otro', fileType: mime, fileName: 'archivo.exe' });
        assert.equal(res.statusCode, 201, res.body);
        assert.ok(s3Key.endsWith(`.${ext}`), s3Key);
    }
});

// ─── Qué se rechaza ──────────────────────────────────────────────────────────

test('tipo de documento y tipo MIME inválidos se rechazan en el paso 1', async () => {
    const id = await accidente();
    for (const tipo of ['foto', 'DIAT', '', 'constructor', undefined, 5]) {
        const res = await pedirSubida(como(gestora, GESTION), id, { tipo });
        assert.equal(res.statusCode, 400, `${String(tipo)}: ${res.body}`);
    }
    for (const fileType of ['text/html', 'image/svg+xml', 'application/x-msdownload', 'application/zip', '', undefined]) {
        const res = await pedirSubida(como(gestora, GESTION), id, { fileType });
        assert.equal(res.statusCode, 400, `${String(fileType)}: ${res.body}`);
    }
});

test('sin la huella SHA-256 no se firma la subida', async () => {
    const id = await accidente();
    for (const checksumSha256 of [undefined, '', 'corta', `${'A'.repeat(43)}x`]) {
        const res = await pedirSubida(como(gestora, GESTION), id, { checksumSha256 });
        assert.equal(res.statusCode, 400, `${String(checksumSha256)}: ${res.body}`);
    }
});

test('un archivo más grande que el tope se rechaza: declarado en el paso 1 y medido por S3 en el paso 2', async () => {
    const id = await accidente();
    const grande = await pedirSubida(como(gestora, GESTION), id, { tamano: MAX_BYTES_PAPEL + 1 });
    assert.equal(grande.statusCode, 413, grande.body);

    // Un cliente que miente en el paso 1: lo que mide S3 manda.
    const { res } = await subirPapel(como(gestora, GESTION), id, { head: { ContentLength: MAX_BYTES_PAPEL + 1 } });
    assert.equal(res.statusCode, 413, res.body);
    assert.deepEqual(guardado(id).papeles, []);
});

test('un archivo que S3 guardó con otro tipo no se registra (aunque el cliente diga PDF)', async () => {
    const id = await accidente();
    const { res } = await subirPapel(como(gestora, GESTION), id, { head: { ContentType: 'text/html' } });
    assert.equal(res.statusCode, 400, res.body);
    assert.deepEqual(guardado(id).papeles, []);
});

test('la clave del papel: solo de esta empresa, de este incidente y de la carpeta de papeles', async () => {
    const id = await accidente();
    const otro = await accidente();
    const uuid = '0b6f1c2e-3d4a-4b5c-8d9e-0f1a2b3c4d5e';
    const malas = [
        `tenants/${A}/incidentes/${id}/${uuid}.jpg`,                       // una foto
        `tenants/${A}/incidentes/${id}/diat-${uuid}.pdf`,                  // fuera de papeles/
        `tenants/${B}/incidentes/${id}/papeles/diat-${uuid}.pdf`,          // otra empresa
        `tenants/${A}/incidentes/${otro}/papeles/diat-${uuid}.pdf`,        // otro incidente
        `tenants/${A}/incidentes/${id}/papeles/../${uuid}.jpg`,
        `tenants/${A}/incidentes/${id}/papeles/foto-${uuid}.pdf`,          // tipo desconocido
        `tenants/${A}/incidentes/${id}/papeles/diat-${uuid}.exe`,
        `tenants/${A}/incidentes/${id}/papeles/sub/diat-${uuid}.pdf`,
        `tenants/${A}/incidentes/${id}/papeles/`,
        42, null,
    ];
    for (const mala of malas) {
        if (typeof mala === 'string') subirAS3(mala);
        const res = await confirmar(como(gestora, GESTION), id, mala);
        assert.equal(res.statusCode, 400, `${String(mala)}: ${res.body}`);
    }
    assert.deepEqual(guardado(id).papeles, []);
});

test('las claves de los papeles no pasan por la ruta de las fotos', async () => {
    const id = await accidente();
    const { s3Key } = await subirPapel(como(gestora, GESTION), id);
    const res = await pedir(como(gestora, GESTION), 'POST', `/incidents/${id}/evidencias`, { evidencias: [s3Key] });
    assert.equal(res.statusCode, 400, res.body);
    assert.deepEqual(guardado(id).evidencias, []);
});

test('la fecha del documento: un día real, sin futuro; el nombre del archivo no puede traer rutas', async () => {
    const id = await accidente();
    for (const fecha of ['10-11-2026', '2026-13-01', '2026-02-30', '2999-01-01', 'ayer']) {
        const { res } = await subirPapel(como(gestora, GESTION), id, { fecha });
        assert.equal(res.statusCode, 400, `${fecha}: ${res.body}`);
    }
    assert.deepEqual(guardado(id).papeles, []);

    const { res } = await subirPapel(como(gestora, GESTION), id, { fileName: '../../etc/passwd\u0000.pdf' });
    assert.equal(res.statusCode, 201, res.body);
    assert.equal(guardado(id).papeles[0].nombreArchivo, '.._.._etc_passwd.pdf');
    const sinNombre = await subirPapel(como(gestora, GESTION), id, { fileName: '   ' });
    assert.equal(sinNombre.res.statusCode, 400, sinNombre.res.body);
});

test('el caso admite hasta 30 archivos', async () => {
    const id = await accidente();
    for (let n = 0; n < MAX_PAPELES_POR_CASO; n++) {
        const { res } = await subirPapel(como(gestora, GESTION), id, { tipo: 'otro', fileName: `respaldo-${n}.pdf` });
        assert.equal(res.statusCode, 201, `${n}: ${res.body}`);
    }
    const sobra = await pedirSubida(como(gestora, GESTION), id, { tipo: 'otro' });
    assert.equal(sobra.statusCode, 400, sobra.body);
    assert.equal(guardado(id).papeles.length, MAX_PAPELES_POR_CASO);
});

// ─── Permisos ────────────────────────────────────────────────────────────────

test('quien gestiona incidentes sube; quien solo ve el historial no (403)', async () => {
    const id = await accidente();
    const ok = await subirPapel(como(gestora, GESTION), id);
    assert.equal(ok.res.statusCode, 201, ok.res.body);

    const paso1 = await pedirSubida(como(soloHistorial, SOLO_HISTORIAL), id);
    assert.equal(paso1.statusCode, 403, paso1.body);
    // Ni confirmando una clave válida que subió otra persona.
    const paso2 = await confirmar(como(soloHistorial, SOLO_HISTORIAL), id, ok.s3Key);
    assert.equal(paso2.statusCode, 403, paso2.body);
});

test('quien reportó el caso pero no gestiona incidentes: puede leerlo, no subir ni ver los papeles (403)', async () => {
    // Un hallazgo lo reporta cualquier trabajador, sin incidentes.reportar.
    const creado = await pedir(como(trabajadora, TRABAJADOR), 'POST', '/incidents', {
        clasificacion: 'hallazgo', tipo: 'condicion_subestandar', descripcion: 'Baranda suelta', obraId: 'o-1',
    });
    assert.equal(creado.statusCode, 201, creado.body);
    const id = datos(creado).incidentId;
    assert.equal((await pedir(como(trabajadora, TRABAJADOR), 'GET', `/incidents/${id}`)).statusCode, 200);
    assert.equal((await pedirSubida(como(trabajadora, TRABAJADOR), id)).statusCode, 403);
    assert.equal((await pedir(como(trabajadora, TRABAJADOR), 'GET', `/incidents/${id}/documents`)).statusCode, 403);
});

test('un compañero sin permiso para leer el caso recibe 404 al subir y al listar', async () => {
    const id = await accidente();
    const { s3Key } = await subirPapel(como(gestora, GESTION), id);
    for (const [metodo, ruta, body] of [
        ['POST', `/incidents/${id}/documents`, { tipo: 'diat', fileType: 'application/pdf', checksumSha256: HUELLA }],
        ['POST', `/incidents/${id}/documents/confirmar`, { s3Key, fileName: 'x.pdf' }],
        ['GET', `/incidents/${id}/documents`, undefined],
    ]) {
        const res = await pedir(como(companero, TRABAJADOR), metodo, ruta, body);
        assert.equal(res.statusCode, 404, `${metodo} ${ruta}: ${res.body}`);
    }
    // Con permiso de gestión pero sin ser del caso ni ver el historial: el mismo 404.
    const sinHistorial = await pedirSubida(como(companero, 'incidentes.reportar'), id);
    assert.equal(sinHistorial.statusCode, 404, sinHistorial.body);
});

test('un incidente de otra empresa responde 404, con todos los permisos', async () => {
    const id = await accidente();
    const { s3Key } = await subirPapel(como(gestora, GESTION), id);
    for (const [metodo, ruta, body] of [
        ['POST', `/incidents/${id}/documents`, { tipo: 'diat', fileType: 'application/pdf', checksumSha256: HUELLA }],
        ['POST', `/incidents/${id}/documents/confirmar`, { s3Key, fileName: 'x.pdf' }],
        ['GET', `/incidents/${id}/documents`, undefined],
    ]) {
        const res = await pedir(como(ajena, GESTION, B), metodo, ruta, body);
        assert.equal(res.statusCode, 404, `${metodo} ${ruta}: ${res.body}`);
    }
    assert.equal(guardado(id).papeles.length, 1);
});

test('sin sesión no hay acceso', async () => {
    const id = await accidente();
    const res = await incidentes.incidentsHandler({
        rawPath: `/incidents/${id}/documents`, rawQueryString: '', headers: { host: 'api.test' }, queryStringParameters: null,
        requestContext: { http: { method: 'GET', path: `/incidents/${id}/documents` } },
    });
    assert.equal(res.statusCode, 401, res.body);
});

// ─── Los papeles no salen por ninguna otra respuesta ────────────────────────

test('el detalle y el listado del incidente no traen los papeles ni sus claves, ni siquiera para el historial', async () => {
    const id = await accidente();
    const { s3Key } = await subirPapel(como(gestora, GESTION), id);
    assert.equal(guardado(id).papeles.length, 1);
    for (const ruta of [`/incidents/${id}`, '/incidents']) {
        for (const permisos of [GESTION, SOLO_HISTORIAL]) {
            const res = await pedir(como(gestora, permisos), 'GET', ruta);
            assert.equal(res.statusCode, 200, res.body);
            assert.ok(!res.body.includes(s3Key), `${ruta} (${permisos}) devolvió la clave`);
            assert.ok(!res.body.includes('papeles') && !res.body.includes('DIAT.pdf'), `${ruta} (${permisos}) devolvió los papeles`);
        }
    }
    const edicion = await pedir(como(gestora, GESTION), 'PUT', `/incidents/${id}`, { diasPerdidos: 3 });
    assert.equal(edicion.statusCode, 200, edicion.body);
    assert.ok(!edicion.body.includes(s3Key) && !edicion.body.includes('papeles'));
});

test('no se pueden escribir papeles ni documentos por el PUT ni al crear el incidente', async () => {
    const falso = [{ tipo: 'diat', s3Key: 'tenants/otra/incidentes/x/papeles/diat-1.pdf', nombreArchivo: 'x.pdf' }];
    const id = await accidente({ papeles: falso, documentos: { diat: { s3Key: 'tenants/otra/x.pdf' } } });
    assert.deepEqual(guardado(id).papeles, []);
    assert.deepEqual(guardado(id).documentos, {});
    await pedir(como(gestora, GESTION), 'PUT', `/incidents/${id}`, { papeles: falso, documentos: { diat: 'x' } });
    assert.deepEqual(guardado(id).papeles, []);
    assert.deepEqual(guardado(id).documentos, {});
});

// ─── Descarga firmada y auditada ─────────────────────────────────────────────

test('GET: la lista trae un enlace firmado de 15 minutos, nunca una URL directa ni la clave de S3', async () => {
    const id = await accidente();
    const { s3Key } = await subirPapel(como(gestora, GESTION), id, { tipo: 'informe_investigacion', fileName: 'informe.pdf', fecha: '2026-11-11' });
    const res = await pedir(como(soloHistorial, SOLO_HISTORIAL), 'GET', `/incidents/${id}/documents`);
    assert.equal(res.statusCode, 200, res.body);
    const { archivos, requeridos, avance } = datos(res);
    assert.equal(archivos.length, 1);
    const [a] = archivos;
    assert.equal(a.tipo, 'informe_investigacion');
    assert.equal(a.nombreArchivo, 'informe.pdf');
    assert.equal(a.fechaDocumento, '2026-11-11');
    assert.equal(a.contieneSalud, false);
    const url = new URL(a.url);
    assert.equal(url.searchParams.get('X-Amz-Expires'), '900');
    assert.ok(url.searchParams.get('X-Amz-Signature'));
    assert.ok(url.pathname.endsWith(s3Key) || decodeURIComponent(url.pathname).endsWith(s3Key));
    assert.match(url.searchParams.get('response-content-disposition'), /attachment; filename\*=UTF-8''informe\.pdf/);
    assert.ok(!('s3Key' in a) && !('huella' in a));
    // Lo que exige el caso, calculado con las reglas compartidas.
    assert.deepEqual(requeridos.map((r) => [r.clave, r.cumplido]), [
        ['diat', false], ['informe_investigacion', true], ['medida_correctiva', false], ['constancia_aviso_autoridad', false],
    ]);
    assert.deepEqual(avance, { cumplidos: 1, total: 4, porcentaje: 25 });
});

const filasDeSalud = () => doble.items('AUDITORIA_ACCESOS_TABLE').filter((r) => Array.isArray(r.tipos) && r.tipos.includes('descarga_documento_salud'));

test('descargar la DIAT queda en la auditoría de acceso a salud, con la huella de la clave y no la clave', async () => {
    const id = await accidente();
    const diat = await subirPapel(como(gestora, GESTION), id, { fileName: 'DIAT Pedro Soto.pdf' });
    await subirPapel(como(gestora, GESTION), id, { tipo: 'informe_investigacion' });
    const res = await pedir(como(soloHistorial, SOLO_HISTORIAL), 'GET', `/incidents/${id}/documents`);
    assert.equal(res.statusCode, 200, res.body);
    const [fila] = filasDeSalud();
    assert.ok(fila, 'hay un registro de acceso');
    assert.equal(fila.actorId, soloHistorial);
    assert.equal(fila.ip, '200.1.2.3');
    assert.deepEqual(fila.documentos, [id]);
    assert.deepEqual(fila.claves, [huellaClave(diat.s3Key)], 'solo la DIAT, que es la que trae salud');
    const texto = JSON.stringify(fila);
    assert.ok(!texto.includes(diat.s3Key) && !texto.includes('Pedro Soto'), 'ni la clave ni el nombre del archivo');
});

test('un caso sin DIAT ni DIEP no deja registro de acceso a salud', async () => {
    const id = await accidente();
    await subirPapel(como(gestora, GESTION), id, { tipo: 'informe_investigacion' });
    const res = await pedir(como(soloHistorial, SOLO_HISTORIAL), 'GET', `/incidents/${id}/documents`);
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(filasDeSalud().length, 0);
});

test('si el registro de auditoría no se puede escribir, la DIAT no se entrega (503)', async () => {
    const id = await accidente();
    const { s3Key } = await subirPapel(como(gestora, GESTION), id);
    const enviar = DynamoDBDocumentClient.prototype.send;
    DynamoDBDocumentClient.prototype.send = async function (cmd) {
        if (cmd.input?.TableName === 'AUDITORIA_ACCESOS_TABLE') throw Object.assign(new Error('caída'), { name: 'InternalServerError' });
        return enviar.call(this, cmd);
    };
    let res;
    try {
        res = await pedir(como(soloHistorial, SOLO_HISTORIAL), 'GET', `/incidents/${id}/documents`);
    } finally {
        DynamoDBDocumentClient.prototype.send = enviar;
    }
    assert.equal(res.statusCode, 503, res.body);
    assert.ok(!res.body.includes('X-Amz-Signature') && !res.body.includes(s3Key) && !res.body.includes('DIAT.pdf'));
});
