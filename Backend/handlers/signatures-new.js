const { v4: uuidv4 } = require('uuid');
const { PutCommand, GetCommand, ScanCommand, UpdateCommand, QueryCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient } = require('../lib/dynamodb');
const { success, error, created } = require('../lib/response');
const { validateRequired, generateSignatureToken, verifyPin } = require('../lib/validation');
const signatureRequests = require('./signature-requests');

const SIGNATURES_TABLE = process.env.SIGNATURES_TABLE || 'Signatures';
const WORKERS_TABLE = process.env.WORKERS_TABLE || 'Workers';
const USERS_TABLE = process.env.USERS_TABLE || 'Users';

/**
 * POST /signatures - Crear firma con validación de PIN
 * 
 * Body: {
 *   workerId: string,          // ID del trabajador que firma
 *   pin: string,               // PIN de 4 dígitos
 *   requestId: string,         // ID de la solicitud de firma
 *   metadata?: object          // Datos adicionales (geolocalización, etc)
 * }
 */
module.exports.create = async (event) => {
    try {
        const body = JSON.parse(event.body || '{}');

        // Validar campos requeridos
        const validation = validateRequired(body, ['workerId', 'pin', 'requestId']);
        if (!validation.valid) {
            return error(`Campos requeridos faltantes: ${validation.missing.join(', ')}`);
        }

        const { workerId, pin, requestId, metadata } = body;

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

        // Verificar que el trabajador está habilitado
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

        // Verificar que la solicitud existe y el trabajador está incluido
        const requestResult = await docClient.send(
            new GetCommand({
                TableName: process.env.SIGNATURE_REQUESTS_TABLE || 'SignatureRequests',
                Key: { requestId },
            })
        );

        if (!requestResult.Item) {
            return error('Solicitud de firma no encontrada', 404);
        }

        const request = requestResult.Item;

        // Verificar que la solicitud no está cancelada o vencida
        if (['cancelada', 'vencida'].includes(request.estado)) {
            return error(`La solicitud está ${request.estado}`, 400);
        }

        // Verificar que el trabajador está en la lista de la solicitud
        const trabajadorEnSolicitud = request.trabajadores.find(t => t.workerId === workerId);
        if (!trabajadorEnSolicitud) {
            return error('No estás incluido en esta solicitud de firma', 403);
        }

        // Verificar que no haya firmado ya
        if (trabajadorEnSolicitud.firmado) {
            return error('Ya has firmado esta solicitud', 400);
        }

        const now = new Date();
        const signatureId = uuidv4();
        const token = generateSignatureToken();

        // Crear registro de firma según DS 44
        const signature = {
            signatureId,
            token,

            // Referencia a la solicitud (para GSI)
            requestId,
            requestTitulo: request.titulo,
            requestTipo: request.tipo,

            // Información del firmante
            workerId,
            workerRut: worker.rut,
            workerNombre: `${worker.nombre} ${worker.apellido || ''}`.trim(),
            workerCargo: worker.cargo,

            // Información del solicitante
            solicitanteId: request.solicitanteId,
            solicitanteNombre: request.solicitanteNombre,

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

            // Documentos firmados (referencia)
            documentosFirmados: request.documentos || [],

            // Estado
            estado: 'valida',
            disputaInfo: null,

            empresaId: worker.empresaId || request.empresaId || 'default',
            createdAt: now.toISOString(),
        };

        // Guardar firma en SignaturesTable
        await docClient.send(
            new PutCommand({
                TableName: SIGNATURES_TABLE,
                Item: signature,
            })
        );

        // Actualizar la solicitud con esta firma
        const updateResult = await signatureRequests.updateOnSignature(requestId, workerId, signatureId);

        return created({
            message: 'Firma registrada exitosamente',
            signature: {
                signatureId: signature.signatureId,
                token: signature.token,
                workerNombre: signature.workerNombre,
                workerRut: signature.workerRut,
                fecha: signature.fecha,
                horario: signature.horario,
                requestTitulo: signature.requestTitulo,
                estado: signature.estado,
            },
            solicitudActualizada: updateResult,
        });
    } catch (err) {
        console.error('Error creating signature:', err);
        return error(err.message, 500);
    }
};

/**
 * POST /signatures/enroll - Firma de enrolamiento (sin requestId)
 * 
 * Body: {
 *   workerId: string,
 *   pin: string,           // El PIN que el trabajador está configurando
 *   signatureData?: string // Datos del canvas de firma (opcional)
 * }
 */
module.exports.createEnrollment = async (event) => {
    try {
        const body = JSON.parse(event.body || '{}');

        const validation = validateRequired(body, ['workerId', 'pin']);
        if (!validation.valid) {
            return error(`Campos requeridos faltantes: ${validation.missing.join(', ')}`);
        }

        const { workerId, pin, signatureData } = body;

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

        // Verificar que no esté ya habilitado
        if (worker.habilitado) {
            return error('Este trabajador ya completó su enrolamiento', 400);
        }

        const now = new Date();
        const signatureId = uuidv4();
        const token = generateSignatureToken();

        // Crear registro de firma de enrolamiento
        const signature = {
            signatureId,
            token,
            requestId: null, // Sin solicitud asociada

            // Información del firmante
            workerId,
            workerRut: worker.rut,
            workerNombre: `${worker.nombre} ${worker.apellido || ''}`.trim(),
            workerCargo: worker.cargo,

            // Tipo especial
            requestTipo: 'ENROLAMIENTO',
            requestTitulo: 'Firma de Enrolamiento',
            solicitanteId: null,
            solicitanteNombre: 'Sistema',

            // Timestamps
            fecha: now.toISOString().split('T')[0],
            horario: now.toTimeString().split(' ')[0],
            timestamp: now.toISOString(),

            // Metadata
            ipAddress: event.requestContext?.http?.sourceIp ||
                event.requestContext?.identity?.sourceIp || 'unknown',
            userAgent: event.headers?.['user-agent'] || 'unknown',
            metodoValidacion: 'PIN_INICIAL',
            signatureData: signatureData || null,

            estado: 'valida',
            empresaId: worker.empresaId || 'default',
            createdAt: now.toISOString(),
        };

        // Guardar firma
        await docClient.send(
            new PutCommand({
                TableName: SIGNATURES_TABLE,
                Item: signature,
            })
        );

        return created({
            message: 'Firma de enrolamiento registrada exitosamente',
            signature: {
                signatureId: signature.signatureId,
                token: signature.token,
                fecha: signature.fecha,
                horario: signature.horario,
            },
        });
    } catch (err) {
        console.error('Error creating enrollment signature:', err);
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
 * GET /signatures/worker/{workerId} - Historial de firmas de un trabajador
 * Soporta buscar tanto por workerId como por userId resolviendo la relación entre ambos
 */
module.exports.getByWorker = async (event) => {
    try {
        const { workerId: inputId } = event.pathParameters || {};

        if (!inputId) {
            return error('ID requerido');
        }

        // 1. Intentar encontrar los IDs vinculados (workerId <-> userId)
        let workerId = inputId;
        let userId = inputId;

        // Buscar en tabla Workers
        const workerRes = await docClient.send(new GetCommand({
            TableName: WORKERS_TABLE,
            Key: { workerId: inputId }
        }));

        if (workerRes.Item) {
            userId = workerRes.Item.userId || userId;
        } else {
            // Si no está en Workers, buscar en tabla Users
            const userRes = await docClient.send(new GetCommand({
                TableName: USERS_TABLE,
                Key: { userId: inputId }
            }));
            if (userRes.Item) {
                workerId = userRes.Item.workerId || workerId;
            }
        }

        console.log(`Searching signatures for workerId: ${workerId} and userId: ${userId}`);

        // 2. Buscar firmas usando ambos identificadores
        const result = await docClient.send(
            new ScanCommand({
                TableName: SIGNATURES_TABLE,
                FilterExpression: 'workerId = :wId OR userId = :uId OR referenciaId = :wId OR referenciaId = :uId',
                ExpressionAttributeValues: {
                    ':wId': workerId,
                    ':uId': userId,
                },
            })
        );

        // Ordenar por timestamp descendente
        const signatures = (result.Items || []).sort((a, b) =>
            new Date(b.timestamp) - new Date(a.timestamp)
        );

        return success({
            workerId: inputId,
            resolvedWorkerId: workerId,
            resolvedUserId: userId,
            totalFirmas: signatures.length,
            firmas: signatures,
        });
    } catch (err) {
        console.error('Error getting signatures by worker:', err);
        return error(err.message, 500);
    }
};

/**
 * GET /signatures/request/{requestId} - Firmas de una solicitud específica
 */
module.exports.getByRequest = async (event) => {
    try {
        const { requestId } = event.pathParameters || {};

        if (!requestId) {
            return error('ID de solicitud requerido');
        }

        // Usar el GSI para query eficiente
        const result = await docClient.send(
            new QueryCommand({
                TableName: SIGNATURES_TABLE,
                IndexName: 'requestId-index',
                KeyConditionExpression: 'requestId = :requestId',
                ExpressionAttributeValues: {
                    ':requestId': requestId,
                },
            })
        );

        // Ordenar por timestamp
        const signatures = (result.Items || []).sort((a, b) =>
            new Date(a.timestamp) - new Date(b.timestamp)
        );

        return success({
            requestId,
            totalFirmas: signatures.length,
            firmas: signatures,
        });
    } catch (err) {
        console.error('Error getting signatures by request:', err);
        return error(err.message, 500);
    }
};

/**
 * GET /signatures/verify/{token} - Verificar firma por token (para auditoría)
 */
module.exports.verifyByToken = async (event) => {
    try {
        const { token } = event.pathParameters || {};

        if (!token) {
            return error('Token requerido');
        }

        const result = await docClient.send(
            new ScanCommand({
                TableName: SIGNATURES_TABLE,
                FilterExpression: '#token = :token',
                ExpressionAttributeNames: {
                    '#token': 'token',
                },
                ExpressionAttributeValues: {
                    ':token': token,
                },
            })
        );

        if (!result.Items || result.Items.length === 0) {
            return error('Firma no encontrada', 404);
        }

        const signature = result.Items[0];

        return success({
            verificada: true,
            firma: {
                signatureId: signature.signatureId,
                token: signature.token,
                workerNombre: signature.workerNombre,
                workerRut: signature.workerRut,
                fecha: signature.fecha,
                horario: signature.horario,
                requestTitulo: signature.requestTitulo,
                requestTipo: signature.requestTipo,
                estado: signature.estado,
                documentosFirmados: signature.documentosFirmados?.length || 0,
            },
        });
    } catch (err) {
        console.error('Error verifying signature:', err);
        return error(err.message, 500);
    }
};

/**
 * POST /signatures/{id}/dispute - Reportar problema con una firma
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
            message: 'Disputa registrada exitosamente',
            signatureId: id,
            disputaInfo,
        });
    } catch (err) {
        console.error('Error disputing signature:', err);
        return error(err.message, 500);
    }
};

/**
 * PUT /signatures/{id}/resolve - Resolver disputa
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
            message: `Disputa resuelta. Estado: ${body.nuevoEstado}`,
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
 * GET /signatures/disputes - Listar firmas en disputa
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
