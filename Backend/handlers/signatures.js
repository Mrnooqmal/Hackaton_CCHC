const { v4: uuidv4 } = require('uuid');
const { PutCommand, GetCommand, ScanCommand, UpdateCommand, QueryCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient } = require('../lib/dynamodb');
const { success, error, created } = require('../lib/response');
const { validateRequired, generateSignatureToken, verifyPin } = require('../lib/validation');

const SIGNATURES_TABLE = process.env.SIGNATURES_TABLE || 'Signatures';
const WORKERS_TABLE = process.env.WORKERS_TABLE || 'Workers';

/**
 * POST /signatures/create - Crear firma con validación de PIN
 * 
 * Body: {
 *   workerId: string,
 *   pin: string,
 *   tipoFirma: 'enrolamiento' | 'documento' | 'actividad' | 'capacitacion',
 *   referenciaId?: string,     // ID del documento/actividad firmado
 *   referenciaTipo?: string,   // 'document', 'activity', etc.
 *   metadata?: object          // Datos adicionales
 * }
 */
module.exports.create = async (event) => {
    try {
        const body = JSON.parse(event.body || '{}');

        // Validar campos requeridos
        const validation = validateRequired(body, ['workerId', 'pin', 'tipoFirma']);
        if (!validation.valid) {
            return error(`Campos requeridos faltantes: ${validation.missing.join(', ')}`);
        }

        const { workerId, pin, tipoFirma, referenciaId, referenciaTipo, metadata } = body;

        // Validar tipo de firma
        const tiposValidos = ['enrolamiento', 'documento', 'actividad', 'capacitacion'];
        if (!tiposValidos.includes(tipoFirma)) {
            return error(`Tipo de firma inválido. Tipos válidos: ${tiposValidos.join(', ')}`);
        }

        // Obtener trabajador
        const workerResult = await docClient.send(
            new GetCommand({
                TableName: WORKERS_TABLE,
                Key: { workerId },
            })
        );

        if (!workerResult.Item) {
            return error('Trabajador no encontrado', 404);
        }

        const worker = workerResult.Item;

        // Para firma de enrolamiento, el trabajador puede no tener PIN aún
        // Para otros tipos, debe tener PIN y estar habilitado
        if (tipoFirma !== 'enrolamiento') {
            if (!worker.habilitado) {
                return error('Trabajador no está habilitado. Debe completar el enrolamiento primero.', 403);
            }

            // Verificar PIN
            if (!worker.pinHash) {
                return error('Trabajador no tiene PIN configurado', 400);
            }

            const pinValido = verifyPin(pin, worker.pinHash, workerId);
            if (!pinValido) {
                return error('PIN incorrecto', 401);
            }
        }

        const now = new Date();
        const signatureId = uuidv4();
        const token = generateSignatureToken();

        // Crear registro de firma según DS 44
        const signature = {
            signatureId,
            token,

            // Información del firmante
            workerId,
            workerRut: worker.rut,
            workerNombre: `${worker.nombre} ${worker.apellido || ''}`.trim(),

            // Contexto de la firma
            tipoFirma,
            referenciaId: referenciaId || null,
            referenciaTipo: referenciaTipo || null,

            // Timestamps según DS 44
            fecha: now.toISOString().split('T')[0],
            horario: now.toTimeString().split(' ')[0],
            timestamp: now.toISOString(),

            // Metadata
            ipAddress: event.requestContext?.http?.sourceIp ||
                event.requestContext?.identity?.sourceIp || 'unknown',
            userAgent: event.headers?.['user-agent'] || 'unknown',
            metodoValidacion: 'PIN',
            metadata: metadata || null,

            // Estado
            estado: 'valida',
            disputaInfo: null,

            empresaId: worker.empresaId || 'default',
            createdAt: now.toISOString(),
        };

        // Guardar firma en SignaturesTable
        await docClient.send(
            new PutCommand({
                TableName: SIGNATURES_TABLE,
                Item: signature,
            })
        );

        return created({
            message: 'Firma registrada exitosamente',
            signature: {
                signatureId: signature.signatureId,
                token: signature.token,
                workerNombre: signature.workerNombre,
                workerRut: signature.workerRut,
                fecha: signature.fecha,
                horario: signature.horario,
                tipoFirma: signature.tipoFirma,
                estado: signature.estado,
            },
        });
    } catch (err) {
        console.error('Error creating signature:', err);
        return error(err.message, 500);
    }
};

/**
 * GET /signatures/worker/{workerId} - Obtener historial de firmas de un trabajador
<<<<<<< HEAD
 * También busca por signerId para compatibilidad con userId
=======
 * Soporta buscar tanto por workerId como por userId para máxima compatibilidad
>>>>>>> 7d9f9bdaba9dedda767df346f51a9993f23c3dee
 */
module.exports.getByWorker = async (event) => {
    try {
        const { workerId } = event.pathParameters || {};

        if (!workerId) {
            return error('ID de trabajador requerido');
        }

        // Buscar por workerId O por signerId (para compatibilidad con userId)
        const result = await docClient.send(
            new ScanCommand({
                TableName: SIGNATURES_TABLE,
<<<<<<< HEAD
                FilterExpression: 'workerId = :workerId OR signerId = :workerId',
=======
                FilterExpression: 'workerId = :id OR userId = :id OR referenciaId = :id',
>>>>>>> 7d9f9bdaba9dedda767df346f51a9993f23c3dee
                ExpressionAttributeValues: {
                    ':id': workerId,
                },
            })
        );

        // Ordenar por timestamp descendente
        const signatures = (result.Items || []).sort((a, b) =>
            new Date(b.timestamp) - new Date(a.timestamp)
        );

        return success({
            workerId,
            totalFirmas: signatures.length,
            firmas: signatures,
        });
    } catch (err) {
        console.error('Error getting signatures by worker:', err);
        return error(err.message, 500);
    }
};

/**
 * GET /signatures/{id} - Obtener firma por ID
 */
module.exports.get = async (event) => {
    try {
        const { id } = event.pathParameters || {};

        if (!id) {
            return error('ID de firma requerido');
        }

        const result = await docClient.send(
            new GetCommand({
                TableName: SIGNATURES_TABLE,
                Key: { signatureId: id },
            })
        );

        if (!result.Item) {
            return error('Firma no encontrada', 404);
        }

        return success(result.Item);
    } catch (err) {
        console.error('Error getting signature:', err);
        return error(err.message, 500);
    }
};

/**
 * POST /signatures/{id}/dispute - Reportar problema con una firma
 * 
 * Body: {
 *   motivo: string,
 *   reportadoPor: string (workerId del que reporta)
 * }
 */
module.exports.dispute = async (event) => {
    try {
        const { id } = event.pathParameters || {};
        const body = JSON.parse(event.body || '{}');

        if (!id) {
            return error('ID de firma requerido');
        }

        const validation = validateRequired(body, ['motivo', 'reportadoPor']);
        if (!validation.valid) {
            return error(`Campos requeridos faltantes: ${validation.missing.join(', ')}`);
        }

        // Verificar que la firma existe
        const sigResult = await docClient.send(
            new GetCommand({
                TableName: SIGNATURES_TABLE,
                Key: { signatureId: id },
            })
        );

        if (!sigResult.Item) {
            return error('Firma no encontrada', 404);
        }

        if (sigResult.Item.estado === 'disputada') {
            return error('Esta firma ya está en disputa', 400);
        }

        const now = new Date().toISOString();

        const disputaInfo = {
            motivo: body.motivo,
            reportadoPor: body.reportadoPor,
            fechaReporte: now,
            resolucion: null,
            resueltoPor: null,
            fechaResolucion: null,
        };

        await docClient.send(
            new UpdateCommand({
                TableName: SIGNATURES_TABLE,
                Key: { signatureId: id },
                UpdateExpression: 'SET estado = :estado, disputaInfo = :disputaInfo',
                ExpressionAttributeValues: {
                    ':estado': 'disputada',
                    ':disputaInfo': disputaInfo,
                },
            })
        );

        return success({
            message: 'Disputa registrada exitosamente. Un administrador revisará el caso.',
            signatureId: id,
            disputaInfo,
        });
    } catch (err) {
        console.error('Error disputing signature:', err);
        return error(err.message, 500);
    }
};

/**
 * PUT /signatures/{id}/resolve - Resolver disputa (admin/relator)
 * 
 * Body: {
 *   resolucion: string,
 *   resueltoPor: string (workerId del admin/relator),
 *   nuevoEstado: 'valida' | 'revocada'
 * }
 */
module.exports.resolve = async (event) => {
    try {
        const { id } = event.pathParameters || {};
        const body = JSON.parse(event.body || '{}');

        if (!id) {
            return error('ID de firma requerido');
        }

        const validation = validateRequired(body, ['resolucion', 'resueltoPor', 'nuevoEstado']);
        if (!validation.valid) {
            return error(`Campos requeridos faltantes: ${validation.missing.join(', ')}`);
        }

        if (!['valida', 'revocada'].includes(body.nuevoEstado)) {
            return error('Estado inválido. Debe ser "valida" o "revocada"');
        }

        // Verificar que la firma existe y está en disputa
        const sigResult = await docClient.send(
            new GetCommand({
                TableName: SIGNATURES_TABLE,
                Key: { signatureId: id },
            })
        );

        if (!sigResult.Item) {
            return error('Firma no encontrada', 404);
        }

        if (sigResult.Item.estado !== 'disputada') {
            return error('Esta firma no está en disputa', 400);
        }

        const now = new Date().toISOString();
        const disputaInfo = {
            ...sigResult.Item.disputaInfo,
            resolucion: body.resolucion,
            resueltoPor: body.resueltoPor,
            fechaResolucion: now,
        };

        await docClient.send(
            new UpdateCommand({
                TableName: SIGNATURES_TABLE,
                Key: { signatureId: id },
                UpdateExpression: 'SET estado = :estado, disputaInfo = :disputaInfo',
                ExpressionAttributeValues: {
                    ':estado': body.nuevoEstado,
                    ':disputaInfo': disputaInfo,
                },
            })
        );

        return success({
            message: `Disputa resuelta. La firma está ahora en estado "${body.nuevoEstado}"`,
            signatureId: id,
            nuevoEstado: body.nuevoEstado,
            disputaInfo,
        });
    } catch (err) {
        console.error('Error resolving dispute:', err);
        return error(err.message, 500);
    }
};

/**
 * GET /signatures/disputes - Listar firmas en disputa (para admin)
 */
module.exports.listDisputes = async (event) => {
    try {
        const { empresaId } = event.queryStringParameters || {};

        let filterExpression = 'estado = :estado';
        const expressionAttributeValues = {
            ':estado': 'disputada',
        };

        if (empresaId) {
            filterExpression += ' AND empresaId = :empresaId';
            expressionAttributeValues[':empresaId'] = empresaId;
        }

        const result = await docClient.send(
            new ScanCommand({
                TableName: SIGNATURES_TABLE,
                FilterExpression: filterExpression,
                ExpressionAttributeValues: expressionAttributeValues,
            })
        );

        // Ordenar por fecha de reporte descendente
        const disputes = (result.Items || []).sort((a, b) =>
            new Date(b.disputaInfo?.fechaReporte || 0) - new Date(a.disputaInfo?.fechaReporte || 0)
        );

        return success({
            totalDisputas: disputes.length,
            disputas: disputes,
        });
    } catch (err) {
        console.error('Error listing disputes:', err);
        return error(err.message, 500);
    }
};
