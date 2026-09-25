/**
 * Subidas prefirmadas al bucket con Object Lock.
 *
 * S3 exige una huella de integridad en toda subida a un bucket con bloqueo, y la
 * exige como HEADER: si viaja en la URL la ignora y responde "Content-MD5 OR
 * x-amz-checksum- HTTP header is required". Verificado contra el bucket de dev.
 * La huella la calcula el navegador; el servidor la firma como header.
 */
// Credenciales ficticias: firmar no llama a AWS, solo necesita algo con qué firmar.
process.env.AWS_ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID || 'AKIAPRUEBA';
process.env.AWS_SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY || 'prueba';

const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const { PutObjectCommand } = require('@aws-sdk/client-s3');
const { HUELLA_SHA256, urlDeSubida } = require('../lib/clients/s3');

const comando = (extra = {}) => new PutObjectCommand({
    Bucket: 'bucket', Key: 'tenants/t/documentos/a.pdf', ContentType: 'application/pdf', ...extra,
});

test('con la huella del archivo, se firma como header y no viaja en la URL', async () => {
    const huella = crypto.createHash('sha256').update('contenido del pdf').digest('base64');
    const url = new URL(await urlDeSubida(comando({ ChecksumSHA256: huella }), 60));
    assert.strictEqual(url.searchParams.get('x-amz-checksum-sha256'), null, 'en la URL S3 la ignora');
    assert.match(url.searchParams.get('X-Amz-SignedHeaders'), /x-amz-checksum-sha256/);
});

test('sin huella, la URL no inventa un checksum (el CRC32 de un cuerpo vacío)', async () => {
    const url = new URL(await urlDeSubida(comando(), 60));
    assert.strictEqual(url.searchParams.get('x-amz-checksum-crc32'), null);
    assert.strictEqual(url.searchParams.get('X-Amz-SignedHeaders'), 'host');
});

test('la validación de huella acepta un SHA-256 en base64 y rechaza lo demás', () => {
    assert.ok(HUELLA_SHA256.test(crypto.createHash('sha256').update('x').digest('base64')));
    assert.ok(!HUELLA_SHA256.test('AAAAAA=='));
    assert.ok(!HUELLA_SHA256.test(''));
});
