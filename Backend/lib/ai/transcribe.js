/**
 * Dictado por voz con Amazon Transcribe.
 *
 * Reemplaza a Gemini (Google): el audio ya no sale de AWS, que es donde vive
 * todo lo demás. Es el único uso de IA vigente: dictar el relato al reportar un
 * incidente.
 *
 * ── Por qué en dos pasos ─────────────────────────────────────────────────────
 *
 * Transcribe por lotes tarda varios segundos aunque el audio dure tres, y HTTP
 * API corta a los 30 s. Esperar dentro de una sola petición era apostar a que
 * la cola de Transcribe ande rápida. Así que:
 *
 *   1. `iniciar` sube el audio al bucket de dictados y lanza el trabajo.
 *      Responde al tiro con un `jobId`.
 *   2. `consultar` lo pregunta el navegador cada par de segundos. Cuando el
 *      trabajo terminó, devuelve el texto y BORRA el audio, la transcripción y
 *      el trabajo.
 *
 * ── Por qué un bucket aparte ─────────────────────────────────────────────────
 *
 * El de `trabajo` tiene versionado: un DeleteObject ahí deja la versión vieja
 * viva hasta que la expire la política, y borrar versiones es un permiso que
 * solo tiene RolSupresion (tests/gobernanza-permisos.test.js). El de dictados no
 * tiene versionado, así que borrar es borrar. Si el navegador nunca vuelve a
 * preguntar (cerró la pestaña), la expiración de un día del bucket lo limpia.
 *
 * La transcripción también se escribe en ese bucket y no en el almacenamiento
 * propio de Transcribe, que la guarda 90 días.
 */

const crypto = require('crypto');
const {
    TranscribeClient,
    StartTranscriptionJobCommand,
    GetTranscriptionJobCommand,
    DeleteTranscriptionJobCommand,
} = require('@aws-sdk/client-transcribe');
const { PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { s3Client } = require('../clients/s3');

const transcribeClient = new TranscribeClient({ region: process.env.AWS_REGION || 'us-east-1' });

const DICTADOS_BUCKET = process.env.DICTADOS_BUCKET;
// `es-US` y no `es-ES`: es el modelo entrenado con español latinoamericano.
// Transcribe no tiene variante chilena.
const IDIOMA = process.env.TRANSCRIBE_IDIOMA || 'es-US';
const PREFIJO_TRABAJO = 'dictado-';

/** MIME del navegador → formato de Transcribe. Chrome y Firefox graban WebM; Safari, MP4. */
const FORMATOS = {
    'audio/webm': 'webm',
    'audio/mp4': 'mp4',
    'audio/x-m4a': 'm4a',
    'audio/m4a': 'm4a',
    'audio/ogg': 'ogg',
    'audio/mpeg': 'mp3',
    'audio/mp3': 'mp3',
    'audio/wav': 'wav',
    'audio/x-wav': 'wav',
    'audio/flac': 'flac',
};

/** `audio/webm;codecs=opus` → `webm`. null si Transcribe no lo acepta. */
const formatoDe = (mimeType) => FORMATOS[String(mimeType || '').split(';')[0].trim().toLowerCase()] || null;

const ID_VALIDO = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Todo lo de un dictado cuelga de la empresa y la persona que dicta. Es lo que
 * permite comprobar al consultar que el trabajo es de quien pregunta, sin
 * guardar nada en DynamoDB.
 */
const prefijoDe = ({ tenantId, personaId }) => `dictados/${tenantId}/${personaId}/`;

async function borrarSinFallar(comando, que) {
    try {
        await comando();
    } catch (err) {
        // La expiración del bucket es el respaldo: un borrado fallido no le
        // cuesta el texto a quien dictó.
        if (err?.name !== 'NoSuchKey' && err?.name !== 'NotFoundException') {
            console.error(`[Transcribe] No se pudo borrar ${que}:`, err?.name || err);
        }
    }
}

/** `nombreTrabajo` null: el trabajo no llegó a crearse y solo hay archivos que borrar. */
async function limpiar(nombreTrabajo, claves) {
    await Promise.all([
        ...claves.map((Key) => borrarSinFallar(
            () => s3Client.send(new DeleteObjectCommand({ Bucket: DICTADOS_BUCKET, Key })), Key)),
        nombreTrabajo && borrarSinFallar(
            () => transcribeClient.send(new DeleteTranscriptionJobCommand({ TranscriptionJobName: nombreTrabajo })),
            nombreTrabajo),
    ]);
}

/**
 * Sube el audio y lanza la transcripción.
 * @returns {Promise<string>} jobId para consultar.
 */
async function iniciar({ tenantId, personaId, audioBase64, mimeType }) {
    const formato = formatoDe(mimeType);
    if (!formato) throw Object.assign(new Error('Formato de audio no soportado'), { codigo: 'FORMATO' });

    const jobId = crypto.randomUUID();
    const base = `${prefijoDe({ tenantId, personaId })}${jobId}`;
    const claveAudio = `${base}.${formato}`;
    const nombreTrabajo = `${PREFIJO_TRABAJO}${jobId}`;

    await s3Client.send(new PutObjectCommand({
        Bucket: DICTADOS_BUCKET,
        Key: claveAudio,
        Body: Buffer.from(audioBase64, 'base64'),
        ContentType: mimeType,
    }));

    try {
        await transcribeClient.send(new StartTranscriptionJobCommand({
            TranscriptionJobName: nombreTrabajo,
            LanguageCode: IDIOMA,
            MediaFormat: formato,
            Media: { MediaFileUri: `s3://${DICTADOS_BUCKET}/${claveAudio}` },
            OutputBucketName: DICTADOS_BUCKET,
            OutputKey: `${base}.json`,
            // Sin esto Transcribe escribe el resultado con la llave de S3 y no
            // con la propia, como todo lo demás de la plataforma.
            // Tiene que ser el ARN: con el id de la llave Transcribe responde 400.
            OutputEncryptionKMSKeyId: process.env.DICTADOS_KMS_KEY_ARN,
        }));
    } catch (err) {
        await limpiar(null, [claveAudio]);
        throw err;
    }
    return jobId;
}

/**
 * Estado de un dictado. Cuando terminó (bien o mal) borra todo lo que dejó.
 *
 * @returns {Promise<null | { estado: 'en_proceso' } | { estado: 'listo', texto: string } | { estado: 'fallido' }>}
 *   null si no existe o no es de esta persona: quien pregunta no distingue
 *   uno de otro.
 */
async function consultar({ tenantId, personaId, jobId }) {
    if (!ID_VALIDO.test(String(jobId || ''))) return null;
    const nombreTrabajo = `${PREFIJO_TRABAJO}${jobId}`;

    let trabajo;
    try {
        const res = await transcribeClient.send(new GetTranscriptionJobCommand({ TranscriptionJobName: nombreTrabajo }));
        trabajo = res.TranscriptionJob;
    } catch (err) {
        if (err?.name === 'BadRequestException' || err?.name === 'NotFoundException') return null;
        throw err;
    }

    const uriPropia = `s3://${DICTADOS_BUCKET}/${prefijoDe({ tenantId, personaId })}${jobId}.`;
    const uriAudio = trabajo?.Media?.MediaFileUri || '';
    if (!uriAudio.startsWith(uriPropia)) return null;

    const estado = trabajo.TranscriptionJobStatus;
    if (estado === 'QUEUED' || estado === 'IN_PROGRESS') return { estado: 'en_proceso' };

    const claveAudio = uriAudio.slice(`s3://${DICTADOS_BUCKET}/`.length);
    const claveTexto = `${prefijoDe({ tenantId, personaId })}${jobId}.json`;

    try {
        if (estado !== 'COMPLETED') {
            console.error('[Transcribe] Trabajo fallido:', trabajo.FailureReason);
            return { estado: 'fallido' };
        }
        const obj = await s3Client.send(new GetObjectCommand({ Bucket: DICTADOS_BUCKET, Key: claveTexto }));
        const json = JSON.parse(await obj.Body.transformToString());
        const texto = (json?.results?.transcripts || []).map((t) => t.transcript).join(' ').trim();
        return { estado: 'listo', texto };
    } finally {
        await limpiar(nombreTrabajo, [claveAudio, claveTexto]);
    }
}

module.exports = { iniciar, consultar, formatoDe };
