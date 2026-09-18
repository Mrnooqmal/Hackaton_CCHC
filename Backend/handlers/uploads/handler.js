const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { v4: uuidv4 } = require('uuid');
const { QueryCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient } = require('../../lib/clients/dynamodb');
const { success, error } = require('../../lib/utils/response');
const { validateRequired } = require('../../lib/utils/validation');
const { conSesion, sesionPuede } = require('../../lib/auth/sesion');
const { PERMISSIONS } = require('../../lib/permissions');
const { TIPOS_SALUD } = require('../../lib/documentos-salud');
const { registrarFallo } = require('../../lib/degradacion');
const almacenamiento = require('../../lib/almacenamiento');

const isOffline = process.env.IS_OFFLINE === 'true';

// Configuración del cliente S3
const { s3Client } = require("../../lib/clients/s3");

// Tipos MIME permitidos
const ALLOWED_MIME_TYPES = [
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
];

// Tamaño máximo: 10 MB
const MAX_FILE_SIZE = 10 * 1024 * 1024;

const DOCUMENTS_TABLE = process.env.DOCUMENTS_TABLE || 'Documents';

// Tope de claves por lote de descarga.
const MAX_CLAVES_POR_LOTE = 100;

// ─────────────────────────────────────────────────────────────────────────────
// MODELO DE PERTENENCIA DE LOS ARCHIVOS
//
// Estos endpoints emiten URLs prefirmadas: quien obtiene una lee (o escribe) el
// objeto directamente en S3, sin pasar más por la API. Por eso la pregunta que
// tienen que responder no es "¿quién eres?" sino "¿este archivo es tuyo?".
//
// La respuesta se apoya en cómo están nombradas las claves, que hoy son de dos
// formas:
//
//   1. `tenants/{tenantId}/...` — el 95% de los objetos. La empresa está EN LA
//      CLAVE, así que la pertenencia se resuelve comparando con la sesión, sin
//      consultar nada.
//   2. `general/...` — un puñado de archivos antiguos, subidos cuando el
//      `tenantId` era opcional. No dicen de quién son, así que solo se sirven si
//      un documento DE LA EMPRESA de la sesión los referencia.
//
// Las subidas nuevas siempre caen en (1): el prefijo lo pone el servidor con el
// `tenantId` de la sesión, nunca el cliente.
// ─────────────────────────────────────────────────────────────────────────────

const prefijoDe = (tenantId) => almacenamiento.prefijoDeEmpresa(tenantId);

/** Todas las claves de S3 que un documento referencia. */
const clavesDeDocumento = (doc) => [
    doc.s3Key,
    doc.archivoUrl,
    doc.documentoFirmadoS3Key,
    ...(Array.isArray(doc.versiones) ? doc.versiones.map((v) => v.s3Key) : []),
].filter(Boolean);

/**
 * Mapa clave de S3 → documento de la empresa que la referencia.
 *
 * Una sola consulta por request: el lote de descargas comparte el mapa en vez de
 * preguntar por cada archivo.
 */
const documentosPorClave = async (tenantId) => {
    const mapa = new Map();
    try {
        const res = await docClient.send(new QueryCommand({
            TableName: DOCUMENTS_TABLE,
            IndexName: 'tenantId-index',
            KeyConditionExpression: 'tenantId = :t',
            ExpressionAttributeValues: { ':t': tenantId },
        }));
        for (const doc of (res.Items || [])) {
            for (const clave of clavesDeDocumento(doc)) {
                if (!mapa.has(clave)) mapa.set(clave, doc);
            }
        }
    } catch (err) {
        // Si la consulta falla se deniega lo heredado, no se abre: los archivos
        // bajo el prefijo de la empresa siguen sirviéndose igual. Desde afuera eso
        // se ve como "ese archivo no existe", así que el fallo queda medible.
        registrarFallo('uploads.documentos-referencia', err);
    }
    return mapa;
};

/**
 * ¿Puede esta sesión leer esta clave?
 *
 * Además de la pertenencia, respeta el resguardo de los documentos de salud
 * (Arts. 67 y 68): el archivo de un examen ocupacional solo lo abre quien tiene
 * el permiso de vigilancia o la persona a la que se refiere. Sin esto, el visor
 * de archivos era la puerta de atrás del filtro que ya aplica el repositorio.
 */
const puedeLeerClave = (clave, sesion, mapaDocs) => {
    if (!clave || typeof clave !== 'string') return false;

    const doc = mapaDocs.get(clave) || null;
    const esDelPrefijo = clave.startsWith(prefijoDe(sesion.tenantId));

    // Heredado (`general/...`): solo si un documento de la empresa lo referencia.
    if (!esDelPrefijo && !doc) return false;
    if (!esDelPrefijo && doc.tenantId !== sesion.tenantId) return false;

    if (doc && TIPOS_SALUD.has(doc.tipo)) {
        if (sesionPuede(sesion, PERMISSIONS.PERSONA_VIGILANCIA_SALUD)) return true;
        return (doc.asignaciones || []).some((a) => a.personaId === sesion.personaId);
    }
    return true;
};

/**
 * POST /uploads/presigned-url - Obtener URL prefirmada para subir archivo
 * 
 * Body: {
 *   fileName: string,      // Nombre del archivo original
 *   fileType: string,      // MIME type
 *   fileSize: number,      // Tamaño en bytes
 *   categoria: string,     // Categoría del documento (opcional)
 *   tenantId?: string
 * }
 * 
 * Returns: {
 *   uploadUrl: string,     // URL para hacer PUT del archivo
 *   fileKey: string,       // Key del archivo en S3
 *   expiresIn: number      // Segundos hasta que expire la URL
 * }
 */
module.exports.getUploadUrl = async (event) => {
    try {
        const ses = conSesion(event);
        if (!ses.ok) return ses.respuesta;
        const sesion = ses.sesion;

        const body = JSON.parse(event.body || '{}');

        const validation = validateRequired(body, ['fileName', 'fileType', 'fileSize']);
        if (!validation.valid) {
            return error(`Campos requeridos faltantes: ${validation.missing.join(', ')}`);
        }

        const { fileName, fileType, fileSize } = body;
        // La empresa del prefijo sale de la sesión: con `tenantId` en el cuerpo se
        // podían dejar archivos dentro del espacio de otra empresa.
        const tenantId = sesion.tenantId;

        // La categoría decide en qué bucket cae el archivo, y eso decide si se va a
        // poder borrar alguna vez (ver lib/almacenamiento.js). Una categoría que
        // nadie declaró no se adivina: se rechaza.
        const clase = almacenamiento.categoria(body.categoria);
        if (!clase) {
            return error(
                `Categoría de archivo no reconocida. Válidas: ${Object.keys(almacenamiento.CATEGORIAS).join(', ')}`,
                400,
            );
        }

        // Validar tipo MIME
        if (!ALLOWED_MIME_TYPES.includes(fileType)) {
            return error(`Tipo de archivo no permitido. Tipos válidos: PDF, imágenes, Word, Excel`);
        }

        // Validar tamaño
        if (fileSize > MAX_FILE_SIZE) {
            return error(`El archivo excede el tamaño máximo permitido (10 MB)`);
        }

        // Generar key único para el archivo
        const timestamp = Date.now();
        const uniqueId = uuidv4().slice(0, 8);
        const sanitizedFileName = fileName.replace(/[^a-zA-Z0-9.-]/g, '_');
        const fileKey = `${prefijoDe(tenantId)}${clase.carpeta}/${timestamp}-${uniqueId}-${sanitizedFileName}`;
        const bucket = almacenamiento.bucketDe(clase.clase);

        // Crear comando de upload
        const command = new PutObjectCommand({
            Bucket: bucket,
            Key: fileKey,
            ContentType: fileType,
            Metadata: {
                'original-name': fileName,
                'uploaded-at': new Date().toISOString(),
                'tenant-id': tenantId,
                'uploaded-by': sesion.personaId,
            },
        });

        // Generar URL prefirmada (válida por 5 minutos)
        const expiresIn = 300;
        const uploadUrl = await getSignedUrl(s3Client, command, { expiresIn });

        return success({
            uploadUrl,
            fileKey,
            expiresIn,
            // Informativo: el cliente sube a la URL prefirmada y guarda la CLAVE,
            // nunca el bucket. Así un cambio de bucket no obliga a migrar datos.
            bucket,
            clase: clase.clase,
        });
    } catch (err) {
        console.error('Error generating upload URL:', err);
        return error(err.message, 500);
    }
};

/**
 * POST /uploads/download-url - Obtener URL prefirmada para descargar archivo
 * 
 * Body: {
 *   fileKey: string        // Key del archivo en S3
 * }
 */
module.exports.getDownloadUrl = async (event) => {
    try {
        // Estuvo cerrado (403) mientras la API no tenía autenticación: emitía una
        // URL de lectura para CUALQUIER clave que le pasaran. Se reabre con el
        // modelo de pertenencia de arriba.
        const ses = conSesion(event);
        if (!ses.ok) return ses.respuesta;
        const sesion = ses.sesion;

        const body = JSON.parse(event.body || '{}');

        if (!body.fileKey) {
            return error('fileKey es requerido');
        }

        const mapaDocs = await documentosPorClave(sesion.tenantId);
        if (!puedeLeerClave(body.fileKey, sesion, mapaDocs)) {
            return error('Archivo no encontrado', 404);
        }

        const command = new GetObjectCommand({
            Bucket: almacenamiento.bucketDeClave(body.fileKey),
            Key: body.fileKey,
        });

        // URL válida por 15 minutos. Era una hora: una URL prefirmada es una
        // credencial anónima al portador, y el visor la usa de inmediato.
        const expiresIn = 900;
        const downloadUrl = await getSignedUrl(s3Client, command, { expiresIn });

        return success({
            downloadUrl,
            expiresIn,
        });
    } catch (err) {
        console.error('Error generating download URL:', err);
        return error(err.message, 500);
    }
};

/**
 * POST /uploads/confirm - Confirmar que el archivo fue subido exitosamente
 * 
 * Body: {
 *   fileKey: string,
 *   fileName: string,
 *   fileType: string,
 *   fileSize: number
 * }
 * 
 * Returns: Metadata del archivo confirmado
 */
module.exports.confirmUpload = async (event) => {
    try {
        const ses = conSesion(event);
        if (!ses.ok) return ses.respuesta;
        const sesion = ses.sesion;

        const body = JSON.parse(event.body || '{}');

        const validation = validateRequired(body, ['fileKey', 'fileName', 'fileType', 'fileSize']);
        if (!validation.valid) {
            return error(`Campos requeridos faltantes: ${validation.missing.join(', ')}`);
        }

        const { fileKey, fileName, fileType, fileSize } = body;

        // Solo se confirma lo que se acaba de subir al espacio de la propia empresa.
        if (!String(fileKey).startsWith(prefijoDe(sesion.tenantId))) {
            return error('Archivo no encontrado', 404);
        }

        // Verificar que el archivo existe en S3
        const bucket = almacenamiento.bucketDeClave(fileKey);
        try {
            const command = new GetObjectCommand({
                Bucket: bucket,
                Key: fileKey,
            });

            // Solo verificar que existe, no descargar
            await s3Client.send(command);
        } catch (s3Error) {
            if (s3Error.name === 'NoSuchKey') {
                return error('El archivo no fue encontrado en el servidor', 404);
            }
            throw s3Error;
        }

        // Generar URL de descarga
        const downloadCommand = new GetObjectCommand({
            Bucket: bucket,
            Key: fileKey,
        });
        const downloadUrl = await getSignedUrl(s3Client, downloadCommand, { expiresIn: 900 });

        return success({
            confirmed: true,
            documento: {
                nombre: fileName,
                url: fileKey,  // Guardamos el key, no la URL temporal
                tipo: fileType,
                tamaño: fileSize,
                subidoEn: new Date().toISOString(),
            },
            downloadUrl,  // URL temporal para vista previa
        });
    } catch (err) {
        console.error('Error confirming upload:', err);
        return error(err.message, 500);
    }
};

/**
 * DELETE /uploads/{fileKey} - Eliminar archivo de S3
 */
module.exports.deleteFile = async (event) => {
    try {
        // Estuvo cerrado (403): borraba cualquier objeto del bucket a partir de la
        // clave, sin comprobar nada y sin versionado que permitiera deshacerlo.
        const ses = conSesion(event);
        if (!ses.ok) return ses.respuesta;
        const sesion = ses.sesion;

        // El fileKey viene codificado en la URL
        const fileKey = decodeURIComponent(event.pathParameters?.fileKey || '');

        if (!fileKey) {
            return error('fileKey es requerido');
        }

        // Solo archivos de la propia empresa, y solo de quien puede subirlos.
        if (!fileKey.startsWith(prefijoDe(sesion.tenantId))) {
            return error('Archivo no encontrado', 404);
        }
        if (!sesionPuede(sesion, PERMISSIONS.REPOSITORIO_SUBIR)
            && !sesionPuede(sesion, PERMISSIONS.OBRA_SUBIR_DOCUMENTOS)) {
            return error('No tienes permiso para eliminar archivos', 403);
        }

        // Un archivo REFERENCIADO por un documento no se borra por esta vía: el
        // documento quedaría acreditando algo que ya no existe, y las firmas viven
        // sobre ese archivo. Para eso está el borrado del documento, que sí
        // comprueba firmas (y las conserva archivando versiones).
        const mapaDocs = await documentosPorClave(sesion.tenantId);
        if (mapaDocs.has(fileKey)) {
            return error('Este archivo respalda un documento del sistema. Elimina el documento si corresponde.', 409);
        }

        // Lo que está en el bucket de evidencia no se borra: ese es justamente el
        // punto del bloqueo de objetos. El intento se responde con el motivo en vez
        // de dejar que S3 falle con un error críptico.
        const bucket = almacenamiento.bucketDeClave(fileKey);
        if (almacenamiento.claseDeClave(fileKey) === almacenamiento.EVIDENCIA) {
            return error('Los archivos que acreditan cumplimiento no se pueden eliminar.', 409);
        }

        const command = new DeleteObjectCommand({
            Bucket: bucket,
            Key: fileKey,
        });

        await s3Client.send(command);

        return success({
            deleted: true,
            fileKey,
        });
    } catch (err) {
        console.error('Error deleting file:', err);
        return error(err.message, 500);
    }
};

/**
 * POST /uploads/batch-download-urls - Obtener URLs de descarga para múltiples archivos
 * 
 * Body: {
 *   fileKeys: string[]
 * }
 */
module.exports.getBatchDownloadUrls = async (event) => {
    try {
        // Estuvo cerrado (403) por el mismo motivo que `/uploads/download-url`, y
        // agravado: como recibe un ARREGLO de claves, emitía en una sola llamada
        // tantas URLs de lectura como se le pidieran. Se reabre con el mismo modelo
        // de pertenencia, resuelto una vez para todo el lote.
        const ses = conSesion(event);
        if (!ses.ok) return ses.respuesta;
        const sesion = ses.sesion;

        const body = JSON.parse(event.body || '{}');

        if (!body.fileKeys || !Array.isArray(body.fileKeys)) {
            return error('fileKeys debe ser un array');
        }
        // Tope al lote: sin él, una sola llamada podía pedir miles de URLs.
        if (body.fileKeys.length > MAX_CLAVES_POR_LOTE) {
            return error(`Máximo ${MAX_CLAVES_POR_LOTE} archivos por solicitud`, 400);
        }

        const mapaDocs = await documentosPorClave(sesion.tenantId);
        const expiresIn = 900;

        const urls = await Promise.all(
            body.fileKeys.map(async (fileKey) => {
                if (!puedeLeerClave(fileKey, sesion, mapaDocs)) {
                    // Mismo mensaje que si no existiera: el lote no sirve para
                    // averiguar qué archivos tiene otra empresa.
                    return { fileKey, downloadUrl: null, error: 'Archivo no encontrado' };
                }
                try {
                    const command = new GetObjectCommand({
                        Bucket: almacenamiento.bucketDeClave(fileKey),
                        Key: fileKey,
                    });
                    const downloadUrl = await getSignedUrl(s3Client, command, { expiresIn });
                    return { fileKey, downloadUrl, error: null };
                } catch (err) {
                    return { fileKey, downloadUrl: null, error: err.message };
                }
            })
        );

        return success({
            urls,
            expiresIn,
        });
    } catch (err) {
        console.error('Error generating batch download URLs:', err);
        return error(err.message, 500);
    }
};
