// Dónde vive cada archivo.
//
// La regla es una sola: si se puede regenerar o reemplazar sin perder prueba, es
// trabajo; si es lo que se le muestra a un fiscalizador, es evidencia. Lo que
// está en evidencia queda bloqueado cinco años, así que equivocarse de lado tiene
// consecuencias en las dos direcciones: un logo imborrable o un acta borrable.

process.env.EVIDENCIA_BUCKET = 'bucket-evidencia';
process.env.TRABAJO_BUCKET = 'bucket-trabajo';

const test = require('node:test');
const assert = require('node:assert/strict');

const alm = require('../lib/almacenamiento');

const EMPRESA = 't-empresa-a';

// ─── Clasificación ───────────────────────────────────────────────────────────

test('lo que acredita cumplimiento cae en evidencia', () => {
    for (const nombre of ['documentos', 'trabajadores', 'actas-cphs', 'acuerdos-cphs',
        'programa-cphs', 'estructura-preventiva', 'evaluaciones', 'epp', 'incidentes', 'registros']) {
        const c = alm.categoria(nombre);
        assert.ok(c, `la categoría ${nombre} debería estar declarada`);
        assert.equal(c.clase, alm.EVIDENCIA, `${nombre} debería ser evidencia`);
    }
});

test('lo reemplazable cae en trabajo', () => {
    for (const nombre of ['plantilla', 'plantilla-obra', 'obras', 'logos', 'perfil', 'estampados']) {
        assert.equal(alm.categoria(nombre).clase, alm.TRABAJO, `${nombre} debería ser trabajo`);
    }
});

test('una categoría desconocida no se adivina', () => {
    // Elegir un bucket por defecto se equivoca caro en las dos direcciones.
    assert.equal(alm.categoria('cualquier-cosa'), null);
    assert.equal(alm.categoria(''), null);
    assert.equal(alm.categoria(undefined), null);
});

test('la clase de un archivo se deduce de su clave, sin consultar nada', () => {
    assert.equal(alm.claseDeClave(`tenants/${EMPRESA}/documentos/acta.pdf`), alm.EVIDENCIA);
    assert.equal(alm.claseDeClave(`tenants/${EMPRESA}/estructura/acta-cphs.pdf`), alm.EVIDENCIA);
    assert.equal(alm.claseDeClave(`tenants/${EMPRESA}/incidentes/i-1/foto.jpg`), alm.EVIDENCIA);
    assert.equal(alm.claseDeClave(`tenants/${EMPRESA}/logos/logo.png`), alm.TRABAJO);
    assert.equal(alm.claseDeClave(`tenants/${EMPRESA}/estampados/d-1-abc.pdf`), alm.TRABAJO);
});

test('la clase no se decide comparando nombres de bucket', () => {
    // Con las dos variables de entorno sin definir, comparar por nombre daba
    // verdadero siempre: "todo es evidencia" o "nada lo es".
    assert.notEqual(alm.claseDeClave(`tenants/${EMPRESA}/documentos/x.pdf`),
        alm.claseDeClave(`tenants/${EMPRESA}/logos/x.png`));
});

test('cada clase resuelve a su bucket', () => {
    assert.equal(alm.bucketDe(alm.EVIDENCIA), 'bucket-evidencia');
    assert.equal(alm.bucketDe(alm.TRABAJO), 'bucket-trabajo');
    assert.equal(alm.bucketDeClave(`tenants/${EMPRESA}/documentos/x.pdf`), 'bucket-evidencia');
    assert.equal(alm.bucketDeClave(`tenants/${EMPRESA}/plantillas/x.pdf`), 'bucket-trabajo');
});

// ─── Pertenencia ─────────────────────────────────────────────────────────────

test('todo cuelga del prefijo de la empresa', () => {
    const c = alm.categoria('documentos');
    const clave = `${alm.prefijoDeEmpresa(EMPRESA)}${c.carpeta}/archivo.pdf`;

    assert.ok(alm.esDeLaEmpresa(clave, EMPRESA));
    assert.ok(!alm.esDeLaEmpresa(clave, 't-otra-empresa'));
});

// ─── Clave del PDF estampado ─────────────────────────────────────────────────

test('la clave del estampado cambia con el archivo y con las firmas', () => {
    const base = { tenantId: EMPRESA, documentId: 'd-1' };
    const firmas = [{ token: 'a' }, { token: 'b' }];

    const original = alm.claveEstampado({ ...base, s3KeyOriginal: 'v1.pdf', firmas });

    assert.notEqual(original, alm.claveEstampado({ ...base, s3KeyOriginal: 'v2.pdf', firmas }));
    assert.notEqual(original, alm.claveEstampado({ ...base, s3KeyOriginal: 'v1.pdf', firmas: [...firmas, { token: 'c' }] }));
    // Mismo número de firmas, firmas distintas: por eso la huella usa los tokens.
    assert.notEqual(original, alm.claveEstampado({ ...base, s3KeyOriginal: 'v1.pdf', firmas: [{ token: 'a' }, { token: 'z' }] }));
});

test('sin cambios, la clave es la misma: diez descargas reutilizan un archivo', () => {
    const p = { tenantId: EMPRESA, documentId: 'd-1', s3KeyOriginal: 'v1.pdf', firmas: [{ token: 'a' }] };
    const claves = new Set(Array.from({ length: 10 }, () => alm.claveEstampado(p)));

    assert.equal(claves.size, 1);
});

test('el estampado vive en trabajo, no en evidencia', () => {
    // Es una renderización del original más las firmas: la prueba son las firmas,
    // no este PDF. Si cayera en evidencia, cada regeneración quedaría inmovilizada
    // cinco años.
    const clave = alm.claveEstampado({ tenantId: EMPRESA, documentId: 'd-1', s3KeyOriginal: 'v1.pdf', firmas: [{ token: 'a' }] });

    assert.equal(alm.claseDeClave(clave), alm.TRABAJO);
    assert.ok(alm.esDeLaEmpresa(clave, EMPRESA), 'y sigue colgando de la empresa');
});

// ─── Caducidad del estampado ─────────────────────────────────────────────────

test('el estampado se sube etiquetado para caducar', async () => {
    // La regla de ciclo de vida del bucket de trabajo selecciona por ETIQUETA,
    // porque un prefijo de S3 no puede saltarse el tramo de la empresa en
    // `tenants/{empresa}/estampados/…`. Sin la etiqueta el archivo no caduca: la
    // primera versión de la regla usaba `Prefix: ''` y habría borrado el bucket
    // entero cada día.
    const { s3Client } = require('../lib/clients/s3');
    const { PdfStampingService } = require('../lib/services/PdfStampingService');

    const original = s3Client.send;
    let enviado = null;
    s3Client.send = async (cmd) => { enviado = cmd.input; return {}; };
    await PdfStampingService.subirEstampado('bucket-trabajo', 'tenants/t/estampados/d-1.pdf', Buffer.from('x'));
    s3Client.send = original;

    assert.equal(enviado.Tagging, 'ciclo=efimero');
});
