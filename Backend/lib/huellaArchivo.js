/**
 * H-7: la huella de integridad del ARCHIVO guardado.
 *
 * (La del CONTENIDO firmado de los informes es otra cosa, y vive en
 * `lib/huella.js`.)
 *
 * ── De dónde sale la huella: no hay un segundo cálculo ──────────────────────
 *
 * El navegador calcula el SHA-256 del archivo antes de subirlo, el servidor lo
 * firma dentro de la URL prefirmada, y S3 lo comprueba contra los bytes al
 * recibir el PUT: si no coincide, rechaza la subida (BadDigest). Lo que queda
 * guardado en el objeto (`ChecksumSHA256`) es, entonces, una huella que S3 ya
 * verificó. Este módulo la LEE de S3 con `HeadObject`; no vuelve a calcularla y
 * no la acepta del cliente, que podría mandar cualquier cosa. Para lo que
 * escribe el propio servidor (los informes del Art. 71), se pide a S3 el mismo
 * algoritmo al escribir y se toma de la respuesta.
 *
 * ── Qué se registra y qué se verifica ────────────────────────────────────────
 *
 * Cuando un documento recibe su archivo se guarda en el documento
 * `archivoHuella: { alg, valor, versionId }`. Al descargar, la huella que S3
 * tiene HOY para ese objeto tiene que ser la registrada. Lo que esto detecta es
 * que el objeto haya cambiado por debajo del documento: en los buckets con
 * versiones, una escritura nueva sobre la misma clave no borra la anterior pero
 * pasa a ser la que se sirve.
 */

const { HeadObjectCommand } = require('@aws-sdk/client-s3');
const { s3Client } = require('./clients/s3');
const almacenamiento = require('./almacenamiento');

const ALG = 'sha256';

/**
 * La huella que S3 tiene registrada para el objeto, o null si el objeto no
 * tiene SHA-256 (subidas anteriores a que el navegador la calculara).
 */
const leerHuellaArchivo = async (clave) => {
    if (!clave) return null;
    const res = await s3Client.send(new HeadObjectCommand({
        Bucket: almacenamiento.bucketDeClave(clave),
        Key: clave,
        ChecksumMode: 'ENABLED',
    }));
    if (!res.ChecksumSHA256) return null;
    return { alg: ALG, valor: res.ChecksumSHA256, versionId: res.VersionId || null };
};

/** La huella que devuelve un PutObject hecho por el servidor con `ChecksumAlgorithm: 'SHA256'`. */
const huellaDePut = (respuesta) => (respuesta?.ChecksumSHA256
    ? { alg: ALG, valor: respuesta.ChecksumSHA256, versionId: respuesta.VersionId || null }
    : null);

/**
 * Los campos que un documento guarda junto a su archivo. Es la ÚNICA forma de
 * escribir `archivoHuella`: el inventario de este cambio encontró siete
 * lugares que le asignan el archivo a un documento, y un campo que se escribe
 * en siete sitios a mano es un campo que alguno olvida.
 */
const camposDeArchivo = async (clave) => ({
    archivoHuella: clave ? await leerHuellaArchivo(clave) : null,
});

/** La huella registrada para ESA clave: la del archivo vigente o la de una versión archivada. */
const huellaRegistradaPara = (doc, clave) => {
    if (!doc || !clave) return null;
    if (clave === doc.s3Key || clave === doc.archivoUrl) return doc.archivoHuella || null;
    const version = (doc.versiones || []).find((v) => v.s3Key === clave);
    return version?.archivoHuella || null;
};

/**
 * ¿El objeto sigue siendo el que se registró?
 *
 * @returns {Promise<'verificada'|'sin-huella'|'alterada'>}
 *   'sin-huella' cuando no hay nada registrado contra qué comparar (documentos
 *   anteriores a H-7): no se afirma nada, ni que esté bien ni que esté mal.
 */
const verificarArchivo = async (doc, clave) => {
    const registrada = huellaRegistradaPara(doc, clave);
    if (!registrada) return 'sin-huella';
    let actual;
    try {
        actual = await leerHuellaArchivo(clave);
    } catch (err) {
        // Registrado y ya no está: tampoco es el archivo que se registró. Otro
        // error de S3 no dice nada sobre la integridad y se propaga, en vez de
        // afirmar que el archivo está bien o mal.
        if (err?.name === 'NotFound' || err?.$metadata?.httpStatusCode === 404) return 'alterada';
        throw err;
    }
    return actual && actual.alg === registrada.alg && actual.valor === registrada.valor
        ? 'verificada'
        : 'alterada';
};

module.exports = { leerHuellaArchivo, huellaDePut, camposDeArchivo, huellaRegistradaPara, verificarArchivo };
