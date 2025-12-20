const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { v4: uuidv4 } = require('uuid');
const { success, error } = require('../lib/response');
const { validateRequired } = require('../lib/validation');

const isOffline = process.env.IS_OFFLINE === 'true';
const BUCKET_NAME = process.env.DOCUMENTS_BUCKET || 'hackaton-documents';

// Configuración del cliente S3
const s3Client = new S3Client(
    isOffline
        ? {
            region: 'us-east-1',
            endpoint: 'http://localhost:4566', // LocalStack para desarrollo
            forcePathStyle: true,
            credentials: {
                accessKeyId: 'test',
                secretAccessKey: 'test',
            },
        }
        : { region: process.env.AWS_REGION || 'us-east-1' }
);

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

/**
 * POST /uploads/presigned-url - Obtener URL prefirmada para subir archivo
 * 
 * Body: {
 *   fileName: string,      // Nombre del archivo original
 *   fileType: string,      // MIME type
 *   fileSize: number,      // Tamaño en bytes
 *   categoria: string,     // Categoría del documento (opcional)
 *   empresaId?: string
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
        const body = JSON.parse(event.body || '{}');

        const validation = validateRequired(body, ['fileName', 'fileType', 'fileSize']);
        if (!validation.valid) {
            return error(`Campos requeridos faltantes: ${validation.missing.join(', ')}`);
        }

        const { fileName, fileType, fileSize, categoria, empresaId } = body;

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
        const prefix = empresaId || 'general';
        const folder = categoria || 'documentos';

        const fileKey = `${prefix}/${folder}/${timestamp}-${uniqueId}-${sanitizedFileName}`;

        // Crear comando de upload
        const command = new PutObjectCommand({
            Bucket: BUCKET_NAME,
            Key: fileKey,
            ContentType: fileType,
            Metadata: {
                'original-name': fileName,
                'uploaded-at': new Date().toISOString(),
                'empresa-id': empresaId || 'general',
            },
        });

        // Generar URL prefirmada (válida por 5 minutos)
        const expiresIn = 300;
        const uploadUrl = await getSignedUrl(s3Client, command, { expiresIn });

        return success({
            uploadUrl,
            fileKey,
            expiresIn,
            bucket: BUCKET_NAME,
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
        const body = JSON.parse(event.body || '{}');

        if (!body.fileKey) {
            return error('fileKey es requerido');
        }

        const command = new GetObjectCommand({
            Bucket: BUCKET_NAME,
            Key: body.fileKey,
        });

        // URL válida por 1 hora
        const expiresIn = 3600;
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
        const body = JSON.parse(event.body || '{}');

        const validation = validateRequired(body, ['fileKey', 'fileName', 'fileType', 'fileSize']);
        if (!validation.valid) {
            return error(`Campos requeridos faltantes: ${validation.missing.join(', ')}`);
        }

        const { fileKey, fileName, fileType, fileSize } = body;

        // Verificar que el archivo existe en S3
        try {
            const command = new GetObjectCommand({
                Bucket: BUCKET_NAME,
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
            Bucket: BUCKET_NAME,
            Key: fileKey,
        });
        const downloadUrl = await getSignedUrl(s3Client, downloadCommand, { expiresIn: 3600 });

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
        // El fileKey viene codificado en la URL
        const fileKey = decodeURIComponent(event.pathParameters?.fileKey || '');

        if (!fileKey) {
            return error('fileKey es requerido');
        }

        const command = new DeleteObjectCommand({
            Bucket: BUCKET_NAME,
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
        const body = JSON.parse(event.body || '{}');

        if (!body.fileKeys || !Array.isArray(body.fileKeys)) {
            return error('fileKeys debe ser un array');
        }

        const urls = await Promise.all(
            body.fileKeys.map(async (fileKey) => {
                try {
                    const command = new GetObjectCommand({
                        Bucket: BUCKET_NAME,
                        Key: fileKey,
                    });
                    const downloadUrl = await getSignedUrl(s3Client, command, { expiresIn: 3600 });
                    return { fileKey, downloadUrl, error: null };
                } catch (err) {
                    return { fileKey, downloadUrl: null, error: err.message };
                }
            })
        );

        return success({
            urls,
            expiresIn: 3600,
        });
    } catch (err) {
        console.error('Error generating batch download URLs:', err);
        return error(err.message, 500);
    }
};
