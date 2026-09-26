// H-7: la huella de integridad del archivo guardado.
//
// El navegador calcula el SHA-256 al subir, el servidor lo firma en la URL y S3
// lo comprueba contra los bytes. Estas pruebas fijan lo que se construyó encima,
// sin un segundo cálculo:
//
//   1. la huella se LEE de S3; nunca se acepta del cliente;
//   2. el documento la guarda cuando recibe su archivo, y una versión archivada
//      conserva la suya;
//   3. al descargar, un archivo que ya no es el registrado no se entrega, y
//      queda medido; sin huella registrada no se afirma nada;
//   4. todo escritor del archivo de un documento escribe también su huella.

process.env.CAMPO_HMAC_KEY = 'clave-de-prueba-hmac';
process.env.CAMPO_CIFRADO_LOCAL_KEY = require('crypto').randomBytes(32).toString('base64');
process.env.EVIDENCIA_BUCKET = 'bucket-evidencia-prueba';
process.env.TRABAJO_BUCKET = 'bucket-trabajo-prueba';

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { docClient } = require('../lib/clients/dynamodb');
const { crearDobleS3 } = require('./doble-s3');
const { crearTablaTenants } = require('./doble-tabla-tenants');
const { verificarArchivo, camposDeArchivo, huellaDePut } = require('../lib/huellaArchivo');

const EMPRESA = 't1';
const CLAVE = `tenants/${EMPRESA}/documentos/1-acta.pdf`;
const CLAVE_V2 = `tenants/${EMPRESA}/documentos/2-acta-v2.pdf`;

const SESION = {
    requestContext: {
        authorizer: {
            lambda: {
                sessionId: 's-1', personaId: 'p-editor', tenantId: EMPRESA, rol: 'prevencionista',
                permisos: 'repositorio.ver,repositorio.subir,obra.subir_documentos',
            },
        },
    },
};
const ev = (extra) => ({ ...SESION, ...extra });
const datos = (res) => JSON.parse(res.body).data;

let s3;
let store;
let originalSend;
let registrados;
let errorOriginal;

beforeEach(() => {
    require('../lib/llaveTenant')._olvidarCache();
    s3 = crearDobleS3();
    const tenants = crearTablaTenants([EMPRESA]);
    store = { docs: new Map(), updates: [], puts: [] };
    originalSend = docClient.send;
    docClient.send = async (cmd) => {
        const deTenants = tenants.responder(cmd);
        if (deTenants !== undefined) return deTenants;
        const nombre = cmd.constructor.name;
        const input = cmd.input || {};
        if (nombre === 'QueryCommand') return { Items: [...store.docs.values()] };
        if (nombre === 'GetCommand') return { Item: store.docs.get(input.Key.documentId) };
        if (nombre === 'PutCommand') { store.puts.push(input.Item); return {}; }
        if (nombre === 'UpdateCommand') { store.updates.push(input); return { Attributes: store.docs.get(input.Key.documentId) }; }
        return {};
    };
    registrados = [];
    errorOriginal = console.error;
    console.error = (...a) => registrados.push(a.join(' '));
});

afterEach(() => {
    docClient.send = originalSend;
    s3.restaurar();
    console.error = errorOriginal;
});

const doc = (extra = {}) => ({
    documentId: 'd-1', tenantId: EMPRESA, tipo: 'PROCEDIMIENTO_TRABAJO', titulo: 'Procedimiento',
    s3Key: CLAVE, archivoUrl: CLAVE, asignaciones: [], firmas: [], ...extra,
});

// ─── La biblioteca ───────────────────────────────────────────────────────────

describe('la huella del archivo', () => {
    test('se lee de S3: es la que S3 comprobó contra los bytes al recibir el PUT', async () => {
        s3.subir(CLAVE, 'contenido del acta', 'ver-7');
        const { archivoHuella } = await camposDeArchivo(CLAVE);
        assert.deepEqual(archivoHuella, { alg: 'sha256', valor: s3.huellaDe('contenido del acta'), versionId: 'ver-7' });
    });

    test('un objeto sin SHA-256 no inventa una huella', async () => {
        s3.sinHuella(CLAVE);
        assert.deepEqual(await camposDeArchivo(CLAVE), { archivoHuella: null });
    });

    test('lo que el servidor escribe trae su huella en la respuesta del PUT', () => {
        assert.deepEqual(huellaDePut({ ChecksumSHA256: 'abc=', VersionId: 'v9' }), { alg: 'sha256', valor: 'abc=', versionId: 'v9' });
        assert.equal(huellaDePut({ ChecksumCRC32: 'x' }), null, 'un CRC32 no es la huella del sistema');
    });

    test('verificada, alterada, desaparecida y sin huella son cuatro respuestas distintas', async () => {
        s3.subir(CLAVE, 'original');
        const registrado = doc({ archivoHuella: (await camposDeArchivo(CLAVE)).archivoHuella });

        assert.equal(await verificarArchivo(registrado, CLAVE), 'verificada');
        s3.subir(CLAVE, 'otro contenido bajo la misma clave', 'v2');
        assert.equal(await verificarArchivo(registrado, CLAVE), 'alterada');
        s3.borrar(CLAVE);
        assert.equal(await verificarArchivo(registrado, CLAVE), 'alterada', 'registrado y ya no está: no es el registrado');
        assert.equal(await verificarArchivo(doc(), CLAVE), 'sin-huella', 'sin nada registrado no se afirma nada');
    });

    test('una versión archivada se verifica contra SU huella, no contra la vigente', async () => {
        s3.subir(CLAVE, 'v1'); s3.subir(CLAVE_V2, 'v2');
        const d = doc({
            s3Key: CLAVE_V2, archivoUrl: CLAVE_V2, archivoHuella: (await camposDeArchivo(CLAVE_V2)).archivoHuella,
            versiones: [{ version: 1, s3Key: CLAVE, archivoHuella: (await camposDeArchivo(CLAVE)).archivoHuella }],
        });
        assert.equal(await verificarArchivo(d, CLAVE), 'verificada');
        assert.equal(await verificarArchivo(d, CLAVE_V2), 'verificada');
    });
});

// ─── Confirmar la subida ─────────────────────────────────────────────────────

describe('al confirmar la subida', () => {
    const uploads = () => require('../handlers/uploads/handler');

    test('la huella viene de S3, no del cuerpo de la petición', async () => {
        s3.subir(CLAVE, 'bytes reales');
        const res = await uploads().confirmUpload(ev({ body: JSON.stringify({
            fileKey: CLAVE, fileName: 'acta.pdf', fileType: 'application/pdf', fileSize: 10,
            huella: { alg: 'sha256', valor: 'inventada=' }, checksumSha256: 'inventada=',
        }) }));
        assert.equal(res.statusCode, 200);
        assert.equal(datos(res).documento.huella.valor, s3.huellaDe('bytes reales'));
    });

    test('un archivo que no está responde 404, con HeadObject y sin descargarlo', async () => {
        s3.borrar(CLAVE);
        const res = await uploads().confirmUpload(ev({ body: JSON.stringify({
            fileKey: CLAVE, fileName: 'acta.pdf', fileType: 'application/pdf', fileSize: 10,
        }) }));
        assert.equal(res.statusCode, 404);
    });
});

// ─── Descargar ───────────────────────────────────────────────────────────────

describe('al descargar', () => {
    const uploads = () => require('../handlers/uploads/handler');
    const pedir = (clave) => uploads().getDownloadUrl(ev({ body: JSON.stringify({ fileKey: clave }) }));

    test('el archivo registrado se entrega, y se dice que se verificó', async () => {
        s3.subir(CLAVE, 'original');
        store.docs.set('d-1', doc({ archivoHuella: (await camposDeArchivo(CLAVE)).archivoHuella }));
        const res = await pedir(CLAVE);
        assert.equal(res.statusCode, 200);
        assert.equal(datos(res).integridad, 'verificada');
        assert.ok(datos(res).downloadUrl);
    });

    test('un archivo cambiado por debajo del documento NO se entrega, y queda medido', async () => {
        s3.subir(CLAVE, 'original');
        store.docs.set('d-1', doc({ archivoHuella: (await camposDeArchivo(CLAVE)).archivoHuella }));
        s3.subir(CLAVE, 'reemplazado', 'v2');

        const res = await pedir(CLAVE);
        assert.equal(res.statusCode, 409);
        assert.match(JSON.parse(res.body).error, /no coincide con su huella/);
        assert.ok(registrados.some((l) => l.includes('FALLO_DEPENDENCIA') && l.includes('integridad.archivo')),
            'una evidencia alterada no puede ser un error silencioso');
    });

    test('un documento anterior a H-7, sin huella registrada, se entrega sin afirmar nada', async () => {
        store.docs.set('d-1', doc());
        const res = await pedir(CLAVE);
        assert.equal(res.statusCode, 200);
        assert.equal(datos(res).integridad, 'sin-huella');
    });

    test('en el lote, el alterado queda fuera y los demás se entregan', async () => {
        s3.subir(CLAVE, 'a'); s3.subir(CLAVE_V2, 'b');
        store.docs.set('d-1', doc({ archivoHuella: (await camposDeArchivo(CLAVE)).archivoHuella }));
        store.docs.set('d-2', doc({ documentId: 'd-2', s3Key: CLAVE_V2, archivoUrl: CLAVE_V2, archivoHuella: (await camposDeArchivo(CLAVE_V2)).archivoHuella }));
        s3.subir(CLAVE, 'a alterado', 'v2');

        const res = await uploads().getBatchDownloadUrls(ev({ body: JSON.stringify({ fileKeys: [CLAVE, CLAVE_V2] }) }));
        const [alterado, sano] = datos(res).urls;
        assert.equal(alterado.downloadUrl, null);
        assert.equal(alterado.integridad, 'alterada');
        assert.ok(sano.downloadUrl);
        assert.equal(sano.integridad, 'verificada');
    });

    test('el documento firmado no se estampa sobre un original alterado', async () => {
        s3.subir(CLAVE, 'original');
        store.docs.set('d-1', doc({ archivoHuella: (await camposDeArchivo(CLAVE)).archivoHuella, firmas: [{ token: 'SIG-1' }] }));
        s3.subir(CLAVE, 'reemplazado', 'v2');

        const documentos = require('../handlers/documents/handler');
        const res = await documentos.downloadFirmado(ev({ pathParameters: { id: 'd-1' } }));
        assert.equal(res.statusCode, 409, 'el anexo le pondría firmas válidas a un archivo que no es el que se firmó');
    });
});

// ─── Registrar ───────────────────────────────────────────────────────────────

describe('el documento registra la huella al recibir su archivo', () => {
    test('reemplazar el archivo registra la huella nueva, leída de S3, y archiva la vieja con la suya', async () => {
        s3.subir(CLAVE, 'v1'); s3.subir(CLAVE_V2, 'v2');
        const huellaV1 = (await camposDeArchivo(CLAVE)).archivoHuella;
        store.docs.set('d-1', doc({ archivoHuella: huellaV1, version: 1 }));

        const documentos = require('../handlers/documents/handler');
        const res = await documentos.update(ev({
            pathParameters: { id: 'd-1' },
            body: JSON.stringify({ s3Key: CLAVE_V2, archivoUrl: CLAVE_V2, archivoHuella: { alg: 'sha256', valor: 'del-cliente=' } }),
        }));
        assert.equal(res.statusCode, 200);

        const u = store.updates.at(-1);
        const valor = (campo) => {
            const ph = Object.entries(u.ExpressionAttributeNames).find(([, n]) => n === campo)?.[0];
            return u.ExpressionAttributeValues[`:${ph?.slice(1)}`];
        };
        assert.equal(valor('archivoHuella').valor, s3.huellaDe('v2'), 'la del archivo nuevo, leída de S3 y no del cuerpo');
        assert.deepEqual(valor('versiones').at(-1).archivoHuella, huellaV1, 'la versión archivada sigue pudiendo probarse');
    });
});

// ─── La prueba estructural ───────────────────────────────────────────────────
//
// Siete lugares le asignan el archivo a un documento. El que olvide la huella no
// falla: deja un documento que nunca se va a poder verificar. Esta prueba falla
// si alguno escribe `s3Key` sin escribir `archivoHuella` en la misma escritura.

describe('todo escritor del archivo de un documento escribe su huella', () => {
    const RAIZ = path.join(__dirname, '..');
    const ESCRITORES = ['handlers/documents/handler.js', 'handlers/personas-module/handler.js', 'lib/services/RegistroService.js'];

    test('cada `SET ... s3Key = :x` lleva también `archivoHuella = :y`', () => {
        const faltan = [];
        for (const rel of ESCRITORES) {
            fs.readFileSync(path.join(RAIZ, rel), 'utf8').split('\n').forEach((linea, i) => {
                if (/s3Key = :/.test(linea) && !/archivoHuella = :/.test(linea)) faltan.push(`${rel}:${i + 1}  ${linea.trim()}`);
            });
        }
        assert.deepEqual(faltan, []);
    });

    test('cada escritor usa el módulo único de la huella', () => {
        const sinModulo = ESCRITORES.filter((rel) => !/require\((['"])\.\.?\/(\.\.\/)*(lib\/)?huellaArchivo\1\)/.test(
            fs.readFileSync(path.join(RAIZ, rel), 'utf8')));
        assert.deepEqual(sinModulo, []);
    });
});
