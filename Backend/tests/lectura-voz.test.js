// Lectura en voz alta de documentos (lib/lectura).
//
// Lo que se fija:
//   - quién puede escuchar un archivo es exactamente quién puede descargarlo:
//     el audio dice lo mismo que el archivo, incluido el resguardo de salud;
//   - el texto que se lee es el literal del archivo, limpio para la voz;
//   - un formato que no se puede leer se dice claro, sin encolar nada;
//   - el audio se hace una vez: si ya está, no se vuelve a pedir a Polly.

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

process.env.EVIDENCIA_BUCKET = 'bucket-evidencia-prueba';
process.env.TRABAJO_BUCKET = 'bucket-trabajo-prueba';

const { PDFDocument, StandardFonts } = require('pdf-lib');
const { docClient } = require('../lib/clients/dynamodb');
const { s3Client } = require('../lib/clients/s3');
const cola = require('../lib/cola');
const texto = require('../lib/lectura/texto');
const uploads = require('../handlers/uploads/handler');

const EMPRESA_A = 't-empresa-a';
const EMPRESA_B = 't-empresa-b';

const ev = (tenantId, body, { personaId = 'p-a', permisos = 'repositorio.ver' } = {}) => ({
    requestContext: { authorizer: { lambda: { sessionId: 's-1', personaId, tenantId, rol: 'colaborador', permisos } } },
    body: JSON.stringify(body),
});
const datos = (res) => JSON.parse(res.body).data;

let store;
let originales;

beforeEach(() => {
    // `objetos`: claves que existen en S3. `encolados`: lo que salió a la cola.
    store = { documentos: [], objetos: new Map(), encolados: [] };
    originales = { s3: s3Client.send, dynamo: docClient.send, encolar: cola.encolar, configurada: cola.colaConfigurada };
    s3Client.send = async (cmd) => {
        const { Key } = cmd.input;
        const nombre = cmd.constructor.name;
        if (nombre === 'HeadObjectCommand' || nombre === 'GetObjectCommand') {
            if (!store.objetos.has(Key)) {
                throw Object.assign(new Error('no existe'), { name: nombre === 'HeadObjectCommand' ? 'NotFound' : 'NoSuchKey', $metadata: { httpStatusCode: 404 } });
            }
            const cuerpo = store.objetos.get(Key);
            return { ETag: '"etag-1"', Body: { transformToString: async () => String(cuerpo) } };
        }
        if (nombre === 'PutObjectCommand') { store.objetos.set(Key, cmd.input.Body); return {}; }
        return {};
    };
    docClient.send = async (cmd) => (cmd.constructor.name === 'QueryCommand' ? { Items: store.documentos } : {});
    cola.colaConfigurada = () => true;
    cola.encolar = async (_c, mensajes) => { store.encolados.push(...mensajes); return mensajes.length; };
});

afterEach(() => {
    s3Client.send = originales.s3;
    docClient.send = originales.dynamo;
    cola.encolar = originales.encolar;
    cola.colaConfigurada = originales.configurada;
});

// ─── Acceso: el mismo de la descarga ─────────────────────────────────────────

test('no se escucha un archivo de otra empresa', async () => {
    const res = await uploads.getLectura(ev(EMPRESA_A, { fileKey: `tenants/${EMPRESA_B}/documentos/riohs.pdf` }));
    assert.equal(res.statusCode, 404);
    assert.equal(store.encolados.length, 0);
});

test('el examen de otra persona no se escucha sin el permiso de vigilancia', async () => {
    const clave = `tenants/${EMPRESA_A}/documentos/examen.pdf`;
    store.objetos.set(clave, 'pdf');
    store.documentos = [{ documentId: 'd-salud', tenantId: EMPRESA_A, tipo: 'EXAMEN_OCUPACIONAL', s3Key: clave, asignaciones: [{ personaId: 'otra' }] }];
    const res = await uploads.getLectura(ev(EMPRESA_A, { fileKey: clave }));
    assert.equal(res.statusCode, 404, 'la lectura no puede ser la puerta de atrás del resguardo de salud');
    assert.equal(store.encolados.length, 0);
});

test('sin sesión no hay lectura', async () => {
    const res = await uploads.getLectura({ requestContext: {}, body: '{}' });
    assert.equal(res.statusCode, 401);
});

// ─── Una vez por versión ─────────────────────────────────────────────────────

test('la primera vez se encola y responde "preparando"; la segunda no vuelve a encolar', async () => {
    const clave = `tenants/${EMPRESA_A}/documentos/riohs.pdf`;
    store.objetos.set(clave, 'pdf');

    const primera = await uploads.getLectura(ev(EMPRESA_A, { fileKey: clave }));
    assert.equal(primera.statusCode, 200);
    assert.equal(datos(primera).estado, 'preparando');
    assert.equal(store.encolados.length, 1);
    assert.equal(store.encolados[0].tipo, 'lectura');
    assert.ok(store.encolados[0].base.startsWith(`tenants/${EMPRESA_A}/lecturas/`), 'el audio vive en el espacio de la empresa');

    const segunda = await uploads.getLectura(ev(EMPRESA_A, { fileKey: clave }));
    assert.equal(datos(segunda).estado, 'preparando');
    assert.equal(store.encolados.length, 1, 'mientras se prepara no se pide de nuevo');
});

test('con el audio hecho se entrega una URL y no se encola nada', async () => {
    const clave = `tenants/${EMPRESA_A}/documentos/riohs.pdf`;
    store.objetos.set(clave, 'pdf');
    await uploads.getLectura(ev(EMPRESA_A, { fileKey: clave }));
    store.objetos.set(`${store.encolados[0].base}.mp3`, 'audio');
    store.encolados = [];

    const res = await uploads.getLectura(ev(EMPRESA_A, { fileKey: clave }));
    assert.equal(datos(res).estado, 'listo');
    assert.ok(datos(res).audioUrl);
    assert.equal(store.encolados.length, 0);
});

test('un formato que no se puede leer se dice al tiro, sin encolar', async () => {
    const clave = `tenants/${EMPRESA_A}/documentos/planilla.xlsx`;
    store.objetos.set(clave, 'xlsx');
    const res = await uploads.getLectura(ev(EMPRESA_A, { fileKey: clave }));
    assert.equal(datos(res).estado, 'no_disponible');
    assert.match(datos(res).motivo, /PDF o Word/);
    assert.equal(store.encolados.length, 0);
});

// ─── El texto ────────────────────────────────────────────────────────────────

test('de un PDF con texto se lee el literal', async () => {
    const d = await PDFDocument.create();
    const f = await d.embedFont(StandardFonts.Helvetica);
    d.addPage().drawText('Uso obligatorio de casco en toda la obra.', { x: 50, y: 700, font: f, size: 12 });
    const r = await texto.extraer(Buffer.from(await d.save()), 'x/riohs.pdf');
    assert.deepEqual(r, { texto: 'Uso obligatorio de casco en toda la obra.' });
});

test('un PDF sin texto (escaneado) va a OCR', async () => {
    const d = await PDFDocument.create();
    d.addPage();
    d.addPage();
    assert.deepEqual(await texto.extraer(Buffer.from(await d.save()), 'x/escaneado.pdf'), { ocr: 'pdf' });
});

test('las imágenes van a OCR; Excel y .doc no se leen', async () => {
    assert.deepEqual(await texto.extraer(Buffer.from(''), 'x/foto.JPG'), { ocr: 'imagen' });
    assert.ok((await texto.extraer(Buffer.from(''), 'x/planilla.xlsx')).noDisponible);
    assert.ok((await texto.extraer(Buffer.from(''), 'x/antiguo.doc')).noDisponible);
});

test('un archivo dañado no rompe: queda como no disponible', async () => {
    const r = await texto.extraer(Buffer.from('esto no es un pdf'), 'x/roto.pdf');
    assert.equal(r.noDisponible, texto.MOTIVOS.ilegible);
});

test('la limpieza une palabras cortadas y quita los números de página', () => {
    assert.equal(texto.limpiar('La preven-\nción es tarea\n3\nde todos.\nPágina 4 de 10'), 'La prevención es tarea\nde todos.');
});

test('el texto de Textract sale en orden, con pausa entre páginas', () => {
    const r = texto.textoDeTextract([
        { BlockType: 'PAGE', Page: 1 },
        { BlockType: 'LINE', Text: 'Artículo 1.', Page: 1 },
        { BlockType: 'WORD', Text: 'Artículo', Page: 1 },
        { BlockType: 'LINE', Text: 'Artículo 2.', Page: 2 },
    ]);
    assert.equal(r.texto, 'Artículo 1.\n\nArtículo 2.');
});

test('los trozos para Polly no pasan el máximo y no se pierde texto', () => {
    const largo = Array.from({ length: 400 }, (_, i) => `Esta es la oración número ${i}.`).join(' ');
    const sinPuntos = 'palabra '.repeat(1000);
    for (const t of [largo, sinPuntos]) {
        const trozos = texto.trocear(t, 2800);
        assert.ok(trozos.every((x) => x.length <= 2800));
        assert.equal(trozos.join(' ').replace(/\s+/g, ' ').trim(), t.replace(/\s+/g, ' ').trim());
    }
});

test('un documento demasiado largo no se manda a Polly', () => {
    const r = texto.textoDeTextract([{ BlockType: 'LINE', Text: 'a'.repeat(texto.MAX_CARACTERES + 1), Page: 1 }]);
    assert.equal(r.noDisponible, texto.MOTIVOS.muyLargo);
});
