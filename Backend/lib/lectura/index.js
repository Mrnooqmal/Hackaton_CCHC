/**
 * Lectura en voz alta de documentos.
 *
 * No todos los trabajadores saben leer, y lo que firman tienen que conocerlo.
 * El visor ofrece "Escuchar": esto saca el texto del archivo (lib/lectura/texto.js,
 * con Amazon Textract si está escaneado) y lo pasa a voz con Amazon Polly.
 *
 * ── Una vez por versión ──────────────────────────────────────────────────────
 *
 * El audio se genera la primera vez que alguien lo pide y queda en el bucket de
 * `trabajo` (`almacenamiento.claveLectura`). Si cincuenta personas escuchan el
 * mismo reglamento, Polly cobra una vez. Una versión nueva del documento es otra
 * clave de S3 (u otro ETag), así que el audio viejo deja de pedirse solo y caduca
 * por la regla `lecturas` del bucket.
 *
 * ── En segundo plano ─────────────────────────────────────────────────────────
 *
 * Un documento largo, o uno escaneado que pasa por Textract, tarda más de lo
 * que aguanta una petición. `estado` responde al tiro (listo, preparando o no
 * disponible) y, si no hay audio, encola el trabajo; el navegador vuelve a
 * preguntar. El estado mientras tanto es un `.json` junto al audio: no hace
 * falta una tabla para algo que dura un minuto.
 *
 * Quién puede escuchar qué lo decide quien llama, con la misma regla que la
 * descarga del archivo (handlers/uploads): el audio dice lo mismo que el archivo.
 */

const { HeadObjectCommand, GetObjectCommand, PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { PollyClient, SynthesizeSpeechCommand } = require('@aws-sdk/client-polly');
const {
    TextractClient,
    DetectDocumentTextCommand,
    StartDocumentTextDetectionCommand,
    GetDocumentTextDetectionCommand,
} = require('@aws-sdk/client-textract');
const { s3Client } = require('../clients/s3');
const almacenamiento = require('../almacenamiento');
const cola = require('../cola');
const texto = require('./texto');

const region = process.env.AWS_REGION || 'us-east-1';
const polly = new PollyClient({ region });
const textract = new TextractClient({ region });

// Voz neural de español latinoamericano. Polly no tiene voz chilena; `es-US`
// es la más neutra. Cambiarla genera audios nuevos (va en la clave).
const VOZ = process.env.LECTURA_VOZ || 'Lupe';
const IDIOMA = process.env.LECTURA_IDIOMA || 'es-US';

// Si un trabajo quedó "preparando" más que esto, se da por perdido y se
// relanza. Cada paso del OCR renueva la marca, así que un escaneado largo no
// cae acá mientras avanza.
const PREPARANDO_VENCE_MS = 10 * 60 * 1000;
const OCR_DEMORA_S = 15;
const OCR_MAX_CONSULTAS = 60; // ~15 minutos
const URL_VIGENCIA_S = 900;
// Llamadas a Polly en paralelo. Más que esto choca con su límite por segundo.
const PARALELO_POLLY = 4;

const FORMATOS_LEIBLES = new Set(['pdf', 'docx', 'jpg', 'jpeg', 'png']);

const bucketTrabajo = () => almacenamiento.nombreBucketTrabajo();

async function cabecera(Bucket, Key) {
    try {
        return await s3Client.send(new HeadObjectCommand({ Bucket, Key }));
    } catch (err) {
        if (err?.name === 'NotFound' || err?.$metadata?.httpStatusCode === 404) return null;
        throw err;
    }
}

async function leerMarca(base) {
    try {
        const obj = await s3Client.send(new GetObjectCommand({ Bucket: bucketTrabajo(), Key: `${base}.json` }));
        return JSON.parse(await obj.Body.transformToString());
    } catch (err) {
        if (err?.name === 'NoSuchKey' || err?.$metadata?.httpStatusCode === 404) return null;
        throw err;
    }
}

/** La marca dura un día (`ciclo=efimero`): un "no disponible" se vuelve a intentar mañana. */
async function escribirMarca(base, marca) {
    await s3Client.send(new PutObjectCommand({
        Bucket: bucketTrabajo(),
        Key: `${base}.json`,
        Body: JSON.stringify({ ...marca, desde: new Date().toISOString() }),
        ContentType: 'application/json',
        Tagging: 'ciclo=efimero',
    }));
}

const noDisponible = (base, motivo) => escribirMarca(base, { estado: 'no_disponible', motivo });

/**
 * ¿Hay audio para este archivo? Si no hay y nadie lo está preparando, lo encola.
 *
 * @returns {Promise<null | { estado: 'listo', audioUrl: string }
 *   | { estado: 'preparando' } | { estado: 'no_disponible', motivo: string }>}
 *   null si el archivo no existe.
 */
async function estado({ tenantId, fileKey }) {
    if (!FORMATOS_LEIBLES.has(texto.extension(fileKey))) {
        return { estado: 'no_disponible', motivo: texto.MOTIVOS.formato };
    }

    const original = await cabecera(almacenamiento.bucketDeClave(fileKey), fileKey);
    if (!original) return null;
    const base = almacenamiento.claveLectura({ tenantId, fileKey, etag: original.ETag, voz: VOZ });

    if (await cabecera(bucketTrabajo(), `${base}.mp3`)) {
        const audioUrl = await getSignedUrl(s3Client, new GetObjectCommand({
            Bucket: bucketTrabajo(),
            Key: `${base}.mp3`,
            ResponseContentType: 'audio/mpeg',
        }), { expiresIn: URL_VIGENCIA_S });
        return { estado: 'listo', audioUrl };
    }

    const marca = await leerMarca(base);
    if (marca?.estado === 'no_disponible') return { estado: 'no_disponible', motivo: marca.motivo };
    if (marca?.estado === 'preparando' && Date.now() - Date.parse(marca.desde) < PREPARANDO_VENCE_MS) {
        return { estado: 'preparando' };
    }

    await escribirMarca(base, { estado: 'preparando' });
    const mensaje = { tipo: 'lectura', fase: 'extraer', tenantId, fileKey, base };
    if (cola.colaConfigurada('EVENTOS')) {
        await cola.encolar('EVENTOS', [mensaje]);
    } else {
        // Sin cola (ejecución local): se hace en la misma petición.
        await procesar(mensaje);
    }
    return { estado: 'preparando' };
}

/** Pasa el texto a voz, trozo por trozo, y guarda un solo MP3. */
async function sintetizar(base, contenido) {
    const trozos = texto.trocear(contenido);
    const audios = new Array(trozos.length);
    let siguiente = 0;
    const trabajar = async () => {
        while (siguiente < trozos.length) {
            const i = siguiente++;
            const res = await polly.send(new SynthesizeSpeechCommand({
                Engine: 'neural',
                VoiceId: VOZ,
                LanguageCode: IDIOMA,
                OutputFormat: 'mp3',
                TextType: 'text',
                Text: trozos[i],
            }));
            audios[i] = Buffer.from(await res.AudioStream.transformToByteArray());
        }
    };
    await Promise.all(Array.from({ length: Math.min(PARALELO_POLLY, trozos.length) }, trabajar));

    // Los MP3 se pueden concatenar tal cual: son una secuencia de cuadros.
    await s3Client.send(new PutObjectCommand({
        Bucket: bucketTrabajo(),
        Key: `${base}.mp3`,
        Body: Buffer.concat(audios),
        ContentType: 'audio/mpeg',
        // Caduca a los 180 días (regla `lecturas` del bucket). Si alguien lo
        // vuelve a pedir después, se rehace desde el original.
        Tagging: 'ciclo=lectura',
    }));
    await s3Client.send(new DeleteObjectCommand({ Bucket: bucketTrabajo(), Key: `${base}.json` }));
}

/** Todas las páginas de resultados de un OCR asíncrono, o el estado si no terminó. */
async function resultadoOcr(jobId) {
    const bloques = [];
    let NextToken;
    do {
        const r = await textract.send(new GetDocumentTextDetectionCommand({ JobId: jobId, NextToken }));
        if (r.JobStatus !== 'SUCCEEDED' && r.JobStatus !== 'PARTIAL_SUCCESS') return { estado: r.JobStatus };
        bloques.push(...(r.Blocks || []));
        NextToken = r.NextToken;
    } while (NextToken);
    return { estado: 'SUCCEEDED', bloques };
}

/**
 * Un paso del trabajo, desde la cola (handlers/cola/trabajador.js).
 *
 * Lo que es del archivo (formato raro, sin texto, ilegible) queda como "no
 * disponible" y NO lanza: reintentar no lo arregla. Lo que es de AWS (Polly o
 * Textract caídos) lanza, y la cola lo reintenta.
 */
async function procesar(msg) {
    const { fileKey, base } = msg;
    const S3Object = { Bucket: almacenamiento.bucketDeClave(fileKey), Name: fileKey };

    if (msg.fase === 'ocr') {
        const r = await resultadoOcr(msg.ocrJobId);
        if (r.estado === 'IN_PROGRESS') {
            const consulta = (msg.consulta || 1) + 1;
            if (consulta > OCR_MAX_CONSULTAS) return noDisponible(base, texto.MOTIVOS.ilegible);
            await escribirMarca(base, { estado: 'preparando' });
            return cola.encolar('EVENTOS', [{ ...msg, consulta }], { demoraSegundos: OCR_DEMORA_S });
        }
        if (r.estado !== 'SUCCEEDED') return noDisponible(base, texto.MOTIVOS.ilegible);
        const t = texto.textoDeTextract(r.bloques);
        if (t.noDisponible) return noDisponible(base, t.noDisponible);
        return sintetizar(base, t.texto);
    }

    const obj = await s3Client.send(new GetObjectCommand({ Bucket: S3Object.Bucket, Key: fileKey }));
    const bytes = Buffer.from(await obj.Body.transformToByteArray());
    let r = await texto.extraer(bytes, fileKey);

    if (r.ocr === 'imagen') {
        // Una imagen es una página: Textract responde en el momento.
        const res = await textract.send(new DetectDocumentTextCommand({ Document: { S3Object } }));
        r = texto.textoDeTextract(res.Blocks);
    } else if (r.ocr === 'pdf') {
        // Un PDF de varias páginas solo va asíncrono: se vuelve a preguntar
        // con un mensaje demorado, sin dejar al trabajador esperando.
        const { JobId } = await textract.send(new StartDocumentTextDetectionCommand({ DocumentLocation: { S3Object } }));
        await escribirMarca(base, { estado: 'preparando' });
        return cola.colaConfigurada('EVENTOS')
            ? cola.encolar('EVENTOS', [{ ...msg, fase: 'ocr', ocrJobId: JobId, consulta: 1 }], { demoraSegundos: OCR_DEMORA_S })
            : undefined;
    }

    if (r.noDisponible) return noDisponible(base, r.noDisponible);
    return sintetizar(base, r.texto);
}

module.exports = { estado, procesar, FORMATOS_LEIBLES, VOZ };
