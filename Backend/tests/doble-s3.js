// Doble de S3 para la huella de archivo (H-7).
//
// Responde `HeadObject` como S3 cuando el objeto se subió con su SHA-256:
// devuelve `ChecksumSHA256` y `VersionId`. Por defecto todo objeto "existe" y su
// huella es una función determinista de su clave, que es lo que necesitan las
// pruebas que no tratan de la huella pero pasan por quien la registra. Las que
// sí tratan de ella fijan objetos concretos, los alteran o los hacen desaparecer.
//
// Cualquier otro comando sigue de largo al cliente real, donde lo detiene
// `tests/sin-aws.js`: el doble no abre una puerta a S3 de verdad.

const crypto = require('crypto');
const { s3Client } = require('../lib/clients/s3');

const huellaDe = (contenido) => crypto.createHash('sha256').update(String(contenido)).digest('base64');

const NO_EXISTE = Symbol('no-existe');

const crearDobleS3 = () => {
    const objetos = new Map();
    const original = s3Client.send;

    s3Client.send = async function simulado(cmd) {
        const nombre = cmd.constructor.name;
        const input = cmd.input || {};
        if (nombre === 'HeadObjectCommand') {
            const objeto = objetos.has(input.Key) ? objetos.get(input.Key) : { ChecksumSHA256: huellaDe(input.Key), VersionId: 'v1' };
            if (objeto === NO_EXISTE) {
                throw Object.assign(new Error('NotFound'), { name: 'NotFound', $metadata: { httpStatusCode: 404 } });
            }
            return input.ChecksumMode === 'ENABLED' ? objeto : { VersionId: objeto.VersionId };
        }
        return original.call(s3Client, cmd);
    };

    return {
        /** Fija el contenido de un objeto: su huella pasa a ser la de ese contenido. */
        subir: (clave, contenido, versionId = 'v1') => objetos.set(clave, { ChecksumSHA256: huellaDe(contenido), VersionId: versionId }),
        /** Un objeto sin SHA-256 (subido antes de que el navegador la calculara). */
        sinHuella: (clave) => objetos.set(clave, { VersionId: 'v1' }),
        borrar: (clave) => objetos.set(clave, NO_EXISTE),
        huellaDe,
        restaurar: () => { s3Client.send = original; },
    };
};

module.exports = { crearDobleS3, huellaDe };
