const { S3Client } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

const isOffline = process.env.IS_OFFLINE === 'true';

const base = isOffline
    ? {
        region: 'us-east-1',
        endpoint: 'http://localhost:4566', // LocalStack para desarrollo
        forcePathStyle: true,
        credentials: {
            accessKeyId: 'test',
            secretAccessKey: 'test',
        },
    }
    : {
        region: process.env.AWS_REGION || 'us-east-1',
    };

/**
 * Cliente para lo que el SERVIDOR lee y escribe.
 *
 * Deja el checksum por defecto del SDK: al escribir él tiene el archivo y lo
 * mide de verdad. Eso es lo que exige el bucket de evidencia, que tiene Object
 * Lock y rechaza toda escritura sin huella de integridad (Registro Art. 72,
 * informes del Art. 71).
 */
const s3Client = new S3Client(base);

/**
 * Checksums solo cuando la operación los exige.
 *
 * Desde la 3.729 el SDK calcula por defecto un CRC32 en cada PutObject. En una
 * URL PREFIRMADA no hay cuerpo que medir, así que firmaba el CRC32 de un cuerpo
 * vacío (`x-amz-checksum-crc32=AAAAAA==`) y S3 rechazaba el archivo real. Para
 * prefirmar, la huella la calcula el navegador —que sí tiene el archivo— y se
 * pasa explícita en `ChecksumSHA256`.
 */
const CHECKSUMS = {
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
};

/** Cliente SOLO para prefirmar subidas desde el navegador. */
const s3ClientPrefirmas = new S3Client({ ...base, ...CHECKSUMS });

/** SHA-256 en base64: 32 bytes son 44 caracteres, con un `=` de relleno. */
const HUELLA_SHA256 = /^[A-Za-z0-9+/]{43}=$/;

/**
 * URL prefirmada de subida (PutObject) con la huella del archivo como HEADER.
 *
 * S3 no lee la huella si viaja en la URL: la exige como header HTTP en los
 * buckets con Object Lock ("Content-MD5 OR x-amz-checksum- HTTP header is
 * required"). Por defecto el SDK la sube a la query, así que se la marca como
 * no izable: queda firmada como header y el navegador tiene que enviarla en el
 * PUT con el mismo valor. Si el archivo no coincide, S3 responde BadDigest.
 */
function urlDeSubida(command, expiresIn) {
    const conHuella = Boolean(command.input && command.input.ChecksumSHA256);
    return getSignedUrl(s3ClientPrefirmas, command, {
        expiresIn,
        ...(conHuella ? { unhoistableHeaders: new Set(['x-amz-checksum-sha256']) } : {}),
    });
}

module.exports = { s3Client, s3ClientPrefirmas, CHECKSUMS, HUELLA_SHA256, urlDeSubida };
