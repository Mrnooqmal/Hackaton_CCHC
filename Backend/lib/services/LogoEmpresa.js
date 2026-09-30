/**
 * Logo de la empresa: validación y subida a S3.
 *
 * Lo usan dos caminos: la identidad en Mi Empresa y el alta por onboarding.
 * Llega como data URL desde el navegador; en DynamoDB solo queda la clave
 * (`preferencias.logoKey`), nunca el base64.
 */

const { PutObjectCommand } = require('@aws-sdk/client-s3');
const { s3Client } = require('../clients/s3');
const almacenamiento = require('../almacenamiento');

/** Mismo límite que anuncia la interfaz. */
const MAX_LOGO_BYTES = 2 * 1024 * 1024;
const TIPOS_LOGO = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']);

/**
 * Revisa un logo en data URL sin subirlo.
 * @returns {string|null} el problema, o null si sirve
 */
const problemaLogo = (dataUrl) => {
    const match = typeof dataUrl === 'string' && dataUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) return 'El logo no es una imagen válida';
    if (!TIPOS_LOGO.has(match[1])) return 'El logo debe ser PNG, JPG, WEBP o SVG';
    if (Buffer.byteLength(match[2], 'base64') > MAX_LOGO_BYTES) return 'El logo no puede pesar más de 2 MB';
    return null;
};

/** Sube el logo y devuelve la clave de S3 que se guarda en `preferencias.logoKey`. */
const subirLogoEmpresa = async (dataUrl, tenantId) => {
    const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
    const contentType = match ? match[1] : 'image/png';
    const base64Data = match ? match[2] : dataUrl;
    const buffer = Buffer.from(base64Data, 'base64');
    // El logo se reemplaza cuando la empresa quiere: es material de trabajo, no
    // evidencia. En el bucket con bloqueo cada cambio habría dejado una versión
    // inmovilizada por cinco años.
    const key = `tenants/${tenantId}/${almacenamiento.CATEGORIAS.logos.carpeta}/logo.png`;
    await s3Client.send(new PutObjectCommand({
        Bucket: almacenamiento.bucketDeClave(key),
        Key: key,
        Body: buffer,
        ContentType: contentType,
    }));
    return key;
};

module.exports = { subirLogoEmpresa, problemaLogo, MAX_LOGO_BYTES };
