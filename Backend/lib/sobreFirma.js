/**
 * Sobre de firma sin conexión (D-36): el respaldo para firmar sin señal cuando
 * el equipo no tiene vales de esa persona.
 *
 * El equipo cifra el PIN recién escrito con la llave PÚBLICA de un par RSA que
 * vive en KMS (`ClaveSobreFirma`), junto con el hash de la firma. La privada no
 * sale de KMS: ni el equipo ni quien copie su almacenamiento pueden abrir el
 * sobre ni probar PIN contra él. Al sincronizar, el servidor lo descifra, compara
 * el hash y valida el PIN con el límite de intentos (`limitePin.verificarSobre`).
 *
 * El cifrado asimétrico de KMS no tiene contexto de cifrado, así que el amarre a
 * la firma va dentro de lo cifrado: `{ p: pin, h: hash }`. RSA-OAEP-SHA256 de 2048
 * bits admite 190 bytes, y esto ocupa menos de 90. El hash lo calcula el servidor
 * con lo que ÉL sabe de la firma (persona, empresa, obra, qué se firma) más lo
 * que el sobre declara (idFirmaLocal, hora): un sobre no sirve para otra firma.
 *
 * El PIN descifrado vive solo en memoria y nunca se registra.
 *
 * Vía de prueba: `SOBRE_FIRMA_LOCAL_PEM` (llave privada PEM) reemplaza a KMS, como
 * `CAMPO_CIFRADO_LOCAL_KEY` en `cifradoCampo.js`.
 */

const crypto = require('crypto');

const ALGORITMO = 'RSAES_OAEP_SHA_256';
const VERSION = 1;

const clienteKMS = () => {
    const { KMSClient } = require('@aws-sdk/client-kms');
    return new KMSClient({});
};

const llaveKms = () => {
    const id = process.env.SOBRE_FIRMA_KMS_KEY_ID;
    if (!id) throw new Error('Falta SOBRE_FIRMA_KMS_KEY_ID');
    return id;
};

/** Texto canónico de la firma. Debe coincidir con Frontend/src/utils/sobreFirma.ts. */
const textoDeFirma = ({ personaId, tenantId, obraId, referenciaTipo, referenciaId, idFirmaLocal, timestampLocal }) => JSON.stringify([
    VERSION, personaId, tenantId, obraId || null, referenciaTipo, referenciaId, idFirmaLocal, timestampLocal,
]);

const hashDeFirma = (datos) => crypto.createHash('sha256').update(textoDeFirma(datos), 'utf8').digest('hex');

let publicaEnMemoria = null;

/**
 * La llave pública, en SPKI y base64, tal como la importa WebCrypto. No es
 * secreta: viaja en la sesión. Se pide a KMS una vez por contenedor.
 * @returns {Promise<string|null>} null si no se pudo obtener: entrar sigue funcionando.
 */
async function llavePublica() {
    if (publicaEnMemoria) return publicaEnMemoria;
    try {
        const pem = process.env.SOBRE_FIRMA_LOCAL_PEM;
        if (pem) {
            publicaEnMemoria = crypto.createPublicKey(crypto.createPrivateKey(pem)).export({ type: 'spki', format: 'der' }).toString('base64');
            return publicaEnMemoria;
        }
        const { GetPublicKeyCommand } = require('@aws-sdk/client-kms');
        const r = await clienteKMS().send(new GetPublicKeyCommand({ KeyId: llaveKms() }));
        publicaEnMemoria = Buffer.from(r.PublicKey).toString('base64');
        return publicaEnMemoria;
    } catch (err) {
        console.error('[sobre-firma] No se pudo leer la llave pública:', err.name || err.message);
        return null;
    }
}

/**
 * Abre un sobre.
 * @returns {Promise<{ pin: string, hash: string }|null>} null si el sobre no sirve.
 * @throws si KMS no responde: es pasajero, y la firma tiene que quedar en la cola.
 */
async function abrir(sobre) {
    if (typeof sobre !== 'string' || !sobre || sobre.length > 2048) return null;
    const cifrado = Buffer.from(sobre, 'base64');
    let claro;
    const pem = process.env.SOBRE_FIRMA_LOCAL_PEM;
    if (pem) {
        try {
            claro = crypto.privateDecrypt({ key: pem, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, cifrado);
        } catch {
            return null;
        }
    } else {
        const { DecryptCommand } = require('@aws-sdk/client-kms');
        try {
            const r = await clienteKMS().send(new DecryptCommand({ KeyId: llaveKms(), CiphertextBlob: cifrado, EncryptionAlgorithm: ALGORITMO }));
            claro = Buffer.from(r.Plaintext);
        } catch (err) {
            if (err.name === 'InvalidCiphertextException') return null;
            throw Object.assign(new Error('No se pudo validar la firma en este momento.'), { codigo: 'SOBRE_NO_DISPONIBLE' });
        }
    }
    try {
        const { p, h } = JSON.parse(claro.toString('utf8'));
        return typeof p === 'string' && typeof h === 'string' ? { pin: p, hash: h } : null;
    } catch {
        return null;
    }
}

/** Compara dos hash sin filtrar por tiempo dónde difieren. */
const mismoHash = (a, b) => {
    const x = Buffer.from(String(a));
    const y = Buffer.from(String(b));
    return x.length === y.length && crypto.timingSafeEqual(x, y);
};

module.exports = { VERSION, ALGORITMO, hashDeFirma, textoDeFirma, llavePublica, abrir, mismoHash };
