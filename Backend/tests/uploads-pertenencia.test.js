// Pertenencia de los archivos (/uploads).
//
// Estos endpoints emiten URLs prefirmadas: quien recibe una lee el objeto en S3
// sin volver a pasar por la API. La URL es, en la práctica, una credencial al
// portador, así que lo que se comprueba antes de emitirla es todo el control que
// va a haber.
//
// Estuvieron cerrados con 403 mientras no hubo autenticación. Estas pruebas
// fijan las condiciones con las que se reabrieron.

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

// Los nombres de bucket se definen antes de cargar el handler: el módulo de
// almacenamiento los lee al importarse, igual que en Lambda.
process.env.EVIDENCIA_BUCKET = 'bucket-evidencia-prueba';
process.env.TRABAJO_BUCKET = 'bucket-trabajo-prueba';

const { docClient } = require('../lib/clients/dynamodb');
const { s3Client } = require('../lib/clients/s3');
const uploads = require('../handlers/uploads/handler');

const EMPRESA_A = 't-empresa-a';
const EMPRESA_B = 't-empresa-b';

const sesionDe = (tenantId, extra = {}) => ({
    requestContext: {
        authorizer: {
            lambda: {
                sessionId: 's-1',
                personaId: extra.personaId || 'p-a',
                tenantId,
                rol: extra.rol || 'prevencionista',
                permisos: extra.permisos !== undefined ? extra.permisos : 'repositorio.subir,obra.subir_documentos',
            },
        },
    },
});

const ev = (tenantId, body, extra) => ({ ...sesionDe(tenantId, extra), body: JSON.stringify(body) });

let store;
let originalSend;
let originalS3;

beforeEach(() => {
    store = { documentos: [], borrados: [] };
    originalS3 = s3Client.send;
    s3Client.send = async (cmd) => {
        if (cmd.constructor.name === 'DeleteObjectCommand') { store.borrados.push(cmd.input); return {}; }
        return {};
    };
    originalSend = docClient.send;
    docClient.send = async (cmd) => {
        const nombre = cmd.constructor.name;
        if (nombre === 'QueryCommand') return { Items: store.documentos };
        if (nombre === 'GetObjectCommand') return {};
        if (nombre === 'DeleteObjectCommand') { store.borrados.push(cmd.input); return {}; }
        return {};
    };
});

afterEach(() => { docClient.send = originalSend; s3Client.send = originalS3; });

const datos = (res) => JSON.parse(res.body).data;

// ─── Subida ──────────────────────────────────────────────────────────────────

test('la clave de subida se arma con la empresa de la sesión, no con la del cuerpo', async () => {
    const res = await uploads.getUploadUrl(ev(EMPRESA_A, {
        fileName: 'acta.pdf', fileType: 'application/pdf', fileSize: 1024,
        tenantId: EMPRESA_B, categoria: 'documentos',
    }));

    assert.equal(res.statusCode, 200);
    assert.ok(datos(res).fileKey.startsWith(`tenants/${EMPRESA_A}/`));
    assert.ok(!datos(res).fileKey.includes(EMPRESA_B));
});

test('una categoría desconocida se rechaza en vez de adivinar bucket', async () => {
    // Elegir un bucket por defecto era caro en las dos direcciones: por defecto
    // `evidencia`, cualquier subida sin clasificar queda imborrable cinco años;
    // por defecto `trabajo`, una evidencia real queda desprotegida.
    const res = await uploads.getUploadUrl(ev(EMPRESA_A, {
        fileName: 'x.pdf', fileType: 'application/pdf', fileSize: 10,
        categoria: '../../tenants/' + EMPRESA_B,
    }));

    assert.equal(res.statusCode, 400);
    assert.match(JSON.parse(res.body).error, /categor/i);
});

test('sin sesión no se emite URL de subida', async () => {
    const res = await uploads.getUploadUrl({ body: JSON.stringify({ fileName: 'x.pdf', fileType: 'application/pdf', fileSize: 10, categoria: 'documentos' }) });
    assert.equal(res.statusCode, 401);
});

// ─── Descarga ────────────────────────────────────────────────────────────────

test('no se descarga un archivo de otra empresa', async () => {
    const res = await uploads.getDownloadUrl(ev(EMPRESA_A, {
        fileKey: `tenants/${EMPRESA_B}/documentos/miper.pdf`,
    }));

    assert.equal(res.statusCode, 404);
});

test('sí se descarga un archivo del espacio propio', async () => {
    const res = await uploads.getDownloadUrl(ev(EMPRESA_A, {
        fileKey: `tenants/${EMPRESA_A}/documentos/miper.pdf`,
    }));

    assert.equal(res.statusCode, 200);
    assert.ok(datos(res).downloadUrl);
    assert.ok(datos(res).expiresIn <= 900, 'la URL prefirmada no vive más de 15 minutos');
});

test('un archivo heredado (general/) solo se sirve si un documento de la empresa lo referencia', async () => {
    const clave = 'general/documentos/antiguo.pdf';

    const sinReferencia = await uploads.getDownloadUrl(ev(EMPRESA_A, { fileKey: clave }));
    assert.equal(sinReferencia.statusCode, 404);

    store.documentos = [{ documentId: 'd-1', tenantId: EMPRESA_A, tipo: 'OTRO', s3Key: clave }];
    const conReferencia = await uploads.getDownloadUrl(ev(EMPRESA_A, { fileKey: clave }));
    assert.equal(conReferencia.statusCode, 200);
});

test('el archivo de un documento de salud no se abre sin el permiso de vigilancia', async () => {
    const clave = `tenants/${EMPRESA_A}/documentos/examen.pdf`;
    store.documentos = [{
        documentId: 'd-salud', tenantId: EMPRESA_A, tipo: 'EXAMEN_OCUPACIONAL',
        s3Key: clave, asignaciones: [{ personaId: 'otra-persona' }],
    }];

    const res = await uploads.getDownloadUrl(ev(EMPRESA_A, { fileKey: clave },
        { rol: 'supervisor', permisos: 'repositorio.ver' }));

    assert.equal(res.statusCode, 404, 'el visor de archivos no puede ser la puerta de atrás del resguardo de salud');
});

test('la persona del examen sí puede abrir su propio archivo', async () => {
    const clave = `tenants/${EMPRESA_A}/documentos/examen.pdf`;
    store.documentos = [{
        documentId: 'd-salud', tenantId: EMPRESA_A, tipo: 'EXAMEN_OCUPACIONAL',
        s3Key: clave, asignaciones: [{ personaId: 'p-a' }],
    }];

    const res = await uploads.getDownloadUrl(ev(EMPRESA_A, { fileKey: clave },
        { rol: 'colaborador', permisos: '' }));

    assert.equal(res.statusCode, 200);
});

// ─── Lote ────────────────────────────────────────────────────────────────────

test('el lote solo devuelve URLs de los archivos propios', async () => {
    const propia = `tenants/${EMPRESA_A}/obras/foto.jpg`;
    const ajena = `tenants/${EMPRESA_B}/obras/foto.jpg`;

    const res = await uploads.getBatchDownloadUrls(ev(EMPRESA_A, { fileKeys: [propia, ajena] }));

    const { urls } = datos(res);
    assert.ok(urls.find((u) => u.fileKey === propia).downloadUrl);
    assert.equal(urls.find((u) => u.fileKey === ajena).downloadUrl, null);
    assert.equal(urls.find((u) => u.fileKey === ajena).error, 'Archivo no encontrado');
});

test('el lote tiene tope de claves', async () => {
    const claves = Array.from({ length: 101 }, (_, i) => `tenants/${EMPRESA_A}/x/${i}.pdf`);

    const res = await uploads.getBatchDownloadUrls(ev(EMPRESA_A, { fileKeys: claves }));

    assert.equal(res.statusCode, 400);
});

// ─── Borrado ─────────────────────────────────────────────────────────────────

test('no se borra un archivo de otra empresa', async () => {
    const res = await uploads.deleteFile({
        ...sesionDe(EMPRESA_A),
        pathParameters: { fileKey: encodeURIComponent(`tenants/${EMPRESA_B}/documentos/x.pdf`) },
    });

    assert.equal(res.statusCode, 404);
    assert.equal(store.borrados.length, 0);
});

test('lo que está en el bucket de evidencia no se borra', async () => {
    // Es el punto del bloqueo de objetos. El intento se responde con el motivo en
    // vez de dejar que S3 falle con un error críptico.
    const clave = `tenants/${EMPRESA_A}/documentos/reglamento.pdf`;

    const res = await uploads.deleteFile({
        ...sesionDe(EMPRESA_A),
        pathParameters: { fileKey: encodeURIComponent(clave) },
    });

    assert.equal(res.statusCode, 409);
    assert.match(JSON.parse(res.body).error, /no se pueden eliminar/i);
    assert.equal(store.borrados.length, 0);
});

test('en el bucket de trabajo tampoco se borra lo que respalda un documento', async () => {
    // Una plantilla se puede reemplazar, pero si un documento la referencia,
    // borrarla lo dejaría acreditando algo que ya no existe.
    const clave = `tenants/${EMPRESA_A}/plantillas/reglamento.pdf`;
    store.documentos = [{ documentId: 'd-1', tenantId: EMPRESA_A, tipo: 'REGLAMENTO_INTERNO', s3Key: clave }];

    const res = await uploads.deleteFile({
        ...sesionDe(EMPRESA_A),
        pathParameters: { fileKey: encodeURIComponent(clave) },
    });

    assert.equal(res.statusCode, 409);
    assert.match(JSON.parse(res.body).error, /respalda/i);
    assert.equal(store.borrados.length, 0);
});

test('un archivo de trabajo suelto sí se borra', async () => {
    const res = await uploads.deleteFile({
        ...sesionDe(EMPRESA_A),
        pathParameters: { fileKey: encodeURIComponent(`tenants/${EMPRESA_A}/plantillas/suelta.pdf`) },
    });

    assert.equal(res.statusCode, 200);
    assert.equal(store.borrados.length, 1);
});

test('sin permiso de subida no se borra nada', async () => {
    const res = await uploads.deleteFile({
        ...sesionDe(EMPRESA_A, { rol: 'colaborador', permisos: '' }),
        pathParameters: { fileKey: encodeURIComponent(`tenants/${EMPRESA_A}/plantillas/suelto.pdf`) },
    });

    assert.equal(res.statusCode, 403);
    assert.equal(store.borrados.length, 0);
});

// ─── Confirmación ────────────────────────────────────────────────────────────

test('no se confirma una subida fuera del espacio propio', async () => {
    const res = await uploads.confirmUpload(ev(EMPRESA_A, {
        fileKey: `tenants/${EMPRESA_B}/documentos/x.pdf`,
        fileName: 'x.pdf', fileType: 'application/pdf', fileSize: 10,
    }));

    assert.equal(res.statusCode, 404);
});
