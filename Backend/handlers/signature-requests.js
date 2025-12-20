const { v4: uuidv4 } = require('uuid');
const { PutCommand, GetCommand, ScanCommand, UpdateCommand, QueryCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient } = require('../lib/dynamodb');
const { success, error, created } = require('../lib/response');
const { validateRequired } = require('../lib/validation');

const TABLE_NAME = process.env.SIGNATURE_REQUESTS_TABLE || 'SignatureRequests';
const SIGNATURES_TABLE = process.env.SIGNATURES_TABLE || 'Signatures';
const WORKERS_TABLE = process.env.WORKERS_TABLE || 'Workers';
const USERS_TABLE = process.env.USERS_TABLE || 'Users';

// Tipos de solicitudes de firma
const REQUEST_TYPES = {
    CHARLA_5MIN: { label: 'Charla de 5 Minutos', icon: '💬', requiresDoc: false },
    CAPACITACION: { label: 'Capacitación', icon: '📚', requiresDoc: true },
    INDUCCION: { label: 'Inducción', icon: '🎓', requiresDoc: true },
    ENTREGA_EPP: { label: 'Entrega de EPP', icon: '🦺', requiresDoc: true },
    ART: { label: 'Análisis de Riesgos en Terreno', icon: '⚠️', requiresDoc: true },
    PROCEDIMIENTO: { label: 'Procedimiento de Trabajo', icon: '📋', requiresDoc: true },
    INSPECCION: { label: 'Inspección de Seguridad', icon: '🔍', requiresDoc: false },
    REGLAMENTO: { label: 'Reglamento Interno', icon: '📖', requiresDoc: true },
    OTRO: { label: 'Otro', icon: '📝', requiresDoc: false },
};

/**
 * POST /signature-requests - Crear nueva solicitud de firmas
 * 
 * Body: {
 *   tipo: string,              // Tipo de solicitud (ver REQUEST_TYPES)
 *   titulo: string,            // Título descriptivo
 *   descripcion?: string,      // Descripción opcional
 *   documentos?: [{            // Archivos adjuntos (opcional)
 *     nombre: string,
 *     url: string,             // URL de S3
 *     tipo: string,            // MIME type
 *     tamaño: number
 *   }],
 *   trabajadoresIds: string[], // IDs de trabajadores que deben firmar
 *   fechaLimite?: string,      // Fecha límite opcional
 *   ubicacion?: string,        // Ubicación de la actividad
 *   empresaId?: string
 * }
 */
module.exports.create = async (event) => {
    try {
        const body = JSON.parse(event.body || '{}');

        // Validar campos requeridos
        const validation = validateRequired(body, ['tipo', 'titulo', 'trabajadoresIds', 'solicitanteId']);
        if (!validation.valid) {
            return error(`Campos requeridos faltantes: ${validation.missing.join(', ')}`);
        }

        // Validar tipo
        if (!REQUEST_TYPES[body.tipo]) {
            return error(`Tipo de solicitud inválido. Tipos válidos: ${Object.keys(REQUEST_TYPES).join(', ')}`);
        }

        // Validar que hay al menos un trabajador
        if (!Array.isArray(body.trabajadoresIds) || body.trabajadoresIds.length === 0) {
            return error('Debe especificar al menos un trabajador');
        }

        // Obtener información del solicitante
        const solicitanteResult = await docClient.send(
            new GetCommand({
                TableName: USERS_TABLE,
                Key: { userId: body.solicitanteId },
            })
        );

        if (!solicitanteResult.Item) {
            return error('Solicitante no encontrado', 404);
        }

        const solicitante = solicitanteResult.Item;

        // Obtener información de los trabajadores
        const trabajadoresInfo = [];
        for (const workerId of body.trabajadoresIds) {
            const workerResult = await docClient.send(
                new GetCommand({
                    TableName: WORKERS_TABLE,
                    Key: { workerId },
                })
            );
            if (workerResult.Item) {
                trabajadoresInfo.push({
                    workerId: workerResult.Item.workerId,
                    nombre: `${workerResult.Item.nombre} ${workerResult.Item.apellido || ''}`.trim(),
                    rut: workerResult.Item.rut,
                    cargo: workerResult.Item.cargo,
                    firmado: false,
                    signatureId: null,
                    fechaFirma: null,
                });
            }
        }

        if (trabajadoresInfo.length === 0) {
            return error('Ninguno de los trabajadores especificados fue encontrado');
        }

        const now = new Date().toISOString();
        const requestId = uuidv4();

        const signatureRequest = {
            requestId,
            tipo: body.tipo,
            tipoInfo: REQUEST_TYPES[body.tipo],
            titulo: body.titulo,
            descripcion: body.descripcion || '',

            // Documentos adjuntos
            documentos: body.documentos || [],
            tieneDocumentos: (body.documentos && body.documentos.length > 0),

            // Información del solicitante
            solicitanteId: body.solicitanteId,
            solicitanteNombre: `${solicitante.nombre} ${solicitante.apellido || ''}`.trim(),
            solicitanteRut: solicitante.rut,

            // Trabajadores y progreso
            trabajadores: trabajadoresInfo,
            totalRequeridos: trabajadoresInfo.length,
            totalFirmados: 0,

            // Fechas
            fechaCreacion: now,
            fechaLimite: body.fechaLimite || null,
            fechaCompletado: null,

            // Metadata
            ubicacion: body.ubicacion || null,
            empresaId: body.empresaId || solicitante.empresaId || 'default',

            // Estado
            estado: 'pendiente', // pendiente, en_proceso, completada, cancelada, vencida

            createdAt: now,
            updatedAt: now,
        };

        await docClient.send(
            new PutCommand({
                TableName: TABLE_NAME,
                Item: signatureRequest,
            })
        );

        return created(signatureRequest);
    } catch (err) {
        console.error('Error creating signature request:', err);
        return error(err.message, 500);
    }
};

/**
 * GET /signature-requests - Listar solicitudes de firma
 * Query params: empresaId, estado, solicitanteId, tipo
 */
module.exports.list = async (event) => {
    try {
        const { empresaId, estado, solicitanteId, tipo } = event.queryStringParameters || {};

        let filterExpression = '';
        const expressionAttributeValues = {};

        if (empresaId) {
            filterExpression += 'empresaId = :empresaId';
            expressionAttributeValues[':empresaId'] = empresaId;
        }

        if (estado) {
            filterExpression += filterExpression ? ' AND estado = :estado' : 'estado = :estado';
            expressionAttributeValues[':estado'] = estado;
        }

        if (solicitanteId) {
            filterExpression += filterExpression ? ' AND solicitanteId = :solicitanteId' : 'solicitanteId = :solicitanteId';
            expressionAttributeValues[':solicitanteId'] = solicitanteId;
        }

        if (tipo) {
            filterExpression += filterExpression ? ' AND tipo = :tipo' : 'tipo = :tipo';
            expressionAttributeValues[':tipo'] = tipo;
        }

        const params = {
            TableName: TABLE_NAME,
        };

        if (filterExpression) {
            params.FilterExpression = filterExpression;
            params.ExpressionAttributeValues = expressionAttributeValues;
        }

        const result = await docClient.send(new ScanCommand(params));

        // Ordenar por fecha de creación descendente
        const requests = (result.Items || []).sort((a, b) =>
            new Date(b.createdAt) - new Date(a.createdAt)
        );

        return success({
            requests,
            total: requests.length,
            types: REQUEST_TYPES,
        });
    } catch (err) {
        console.error('Error listing signature requests:', err);
        return error(err.message, 500);
    }
};

/**
 * GET /signature-requests/{id} - Obtener solicitud por ID con detalle de firmas
 */
module.exports.get = async (event) => {
    try {
        const { id } = event.pathParameters || {};

        if (!id) {
            return error('ID de solicitud requerido');
        }

        const result = await docClient.send(
            new GetCommand({
                TableName: TABLE_NAME,
                Key: { requestId: id },
            })
        );

        if (!result.Item) {
            return error('Solicitud no encontrada', 404);
        }

        // Obtener firmas asociadas a esta solicitud
        const signaturesResult = await docClient.send(
            new QueryCommand({
                TableName: SIGNATURES_TABLE,
                IndexName: 'requestId-index',
                KeyConditionExpression: 'requestId = :requestId',
                ExpressionAttributeValues: {
                    ':requestId': id,
                },
            })
        );

        return success({
            ...result.Item,
            firmasDetalle: signaturesResult.Items || [],
        });
    } catch (err) {
        console.error('Error getting signature request:', err);
        return error(err.message, 500);
    }
};

/**
 * GET /signature-requests/pending/{workerId} - Solicitudes pendientes de un trabajador
 */
module.exports.getPendingByWorker = async (event) => {
    try {
        const { workerId } = event.pathParameters || {};

        if (!workerId) {
            return error('ID de trabajador requerido');
        }

        // Buscar solicitudes donde el trabajador está en la lista y no ha firmado
        const result = await docClient.send(
            new ScanCommand({
                TableName: TABLE_NAME,
                FilterExpression: 'estado IN (:pendiente, :enProceso)',
                ExpressionAttributeValues: {
                    ':pendiente': 'pendiente',
                    ':enProceso': 'en_proceso',
                },
            })
        );

        // Filtrar las que incluyen al trabajador y no ha firmado
        const pendientes = (result.Items || []).filter(request => {
            const trabajador = request.trabajadores.find(t => t.workerId === workerId);
            return trabajador && !trabajador.firmado;
        }).map(request => ({
            ...request,
            miEstado: 'pendiente',
        }));

        return success({
            pendientes,
            total: pendientes.length,
        });
    } catch (err) {
        console.error('Error getting pending requests:', err);
        return error(err.message, 500);
    }
};

/**
 * GET /signature-requests/history/{workerId} - Historial de firmas de un trabajador
 */
module.exports.getHistoryByWorker = async (event) => {
    try {
        const { workerId } = event.pathParameters || {};

        if (!workerId) {
            return error('ID de trabajador requerido');
        }

        // Obtener todas las firmas del trabajador
        const signaturesResult = await docClient.send(
            new ScanCommand({
                TableName: SIGNATURES_TABLE,
                FilterExpression: 'workerId = :workerId',
                ExpressionAttributeValues: {
                    ':workerId': workerId,
                },
            })
        );

        const firmas = (signaturesResult.Items || []).sort((a, b) =>
            new Date(b.timestamp) - new Date(a.timestamp)
        );

        // Obtener información de las solicitudes asociadas
        const historial = [];
        for (const firma of firmas) {
            if (firma.requestId) {
                const requestResult = await docClient.send(
                    new GetCommand({
                        TableName: TABLE_NAME,
                        Key: { requestId: firma.requestId },
                    })
                );
                historial.push({
                    firma,
                    solicitud: requestResult.Item || null,
                });
            } else {
                historial.push({ firma, solicitud: null });
            }
        }

        return success({
            historial,
            totalFirmas: firmas.length,
        });
    } catch (err) {
        console.error('Error getting worker history:', err);
        return error(err.message, 500);
    }
};

/**
 * POST /signature-requests/{id}/cancel - Cancelar solicitud
 */
module.exports.cancel = async (event) => {
    try {
        const { id } = event.pathParameters || {};
        const body = JSON.parse(event.body || '{}');

        if (!id) {
            return error('ID de solicitud requerido');
        }

        const result = await docClient.send(
            new GetCommand({
                TableName: TABLE_NAME,
                Key: { requestId: id },
            })
        );

        if (!result.Item) {
            return error('Solicitud no encontrada', 404);
        }

        if (result.Item.estado === 'completada') {
            return error('No se puede cancelar una solicitud completada');
        }

        const now = new Date().toISOString();

        await docClient.send(
            new UpdateCommand({
                TableName: TABLE_NAME,
                Key: { requestId: id },
                UpdateExpression: 'SET estado = :estado, motivoCancelacion = :motivo, updatedAt = :updatedAt',
                ExpressionAttributeValues: {
                    ':estado': 'cancelada',
                    ':motivo': body.motivo || 'Cancelada por el solicitante',
                    ':updatedAt': now,
                },
            })
        );

        return success({ message: 'Solicitud cancelada exitosamente' });
    } catch (err) {
        console.error('Error canceling request:', err);
        return error(err.message, 500);
    }
};

/**
 * GET /signature-requests/stats - Estadísticas de solicitudes
 */
module.exports.getStats = async (event) => {
    try {
        const { empresaId, solicitanteId } = event.queryStringParameters || {};

        let filterExpression = '';
        const expressionAttributeValues = {};

        if (empresaId) {
            filterExpression = 'empresaId = :empresaId';
            expressionAttributeValues[':empresaId'] = empresaId;
        }

        if (solicitanteId) {
            filterExpression += filterExpression ? ' AND solicitanteId = :solicitanteId' : 'solicitanteId = :solicitanteId';
            expressionAttributeValues[':solicitanteId'] = solicitanteId;
        }

        const params = {
            TableName: TABLE_NAME,
        };

        if (filterExpression) {
            params.FilterExpression = filterExpression;
            params.ExpressionAttributeValues = expressionAttributeValues;
        }

        const result = await docClient.send(new ScanCommand(params));
        const requests = result.Items || [];

        const stats = {
            total: requests.length,
            pendientes: requests.filter(r => r.estado === 'pendiente').length,
            enProceso: requests.filter(r => r.estado === 'en_proceso').length,
            completadas: requests.filter(r => r.estado === 'completada').length,
            canceladas: requests.filter(r => r.estado === 'cancelada').length,
            vencidas: requests.filter(r => r.estado === 'vencida').length,
            totalFirmasRequeridas: requests.reduce((acc, r) => acc + r.totalRequeridos, 0),
            totalFirmasObtenidas: requests.reduce((acc, r) => acc + r.totalFirmados, 0),
            porTipo: {},
        };

        // Estadísticas por tipo
        Object.keys(REQUEST_TYPES).forEach(tipo => {
            const delTipo = requests.filter(r => r.tipo === tipo);
            if (delTipo.length > 0) {
                stats.porTipo[tipo] = {
                    ...REQUEST_TYPES[tipo],
                    total: delTipo.length,
                    completadas: delTipo.filter(r => r.estado === 'completada').length,
                };
            }
        });

        return success(stats);
    } catch (err) {
        console.error('Error getting stats:', err);
        return error(err.message, 500);
    }
};

/**
 * Helper: Actualizar estado de solicitud cuando se firma
 * (llamado internamente desde signatures.js)
 */
module.exports.updateOnSignature = async (requestId, workerId, signatureId) => {
    try {
        const result = await docClient.send(
            new GetCommand({
                TableName: TABLE_NAME,
                Key: { requestId },
            })
        );

        if (!result.Item) {
            return { success: false, error: 'Solicitud no encontrada' };
        }

        const request = result.Item;
        const now = new Date().toISOString();

        // Actualizar el trabajador en la lista
        const trabajadores = request.trabajadores.map(t => {
            if (t.workerId === workerId) {
                return {
                    ...t,
                    firmado: true,
                    signatureId,
                    fechaFirma: now,
                };
            }
            return t;
        });

        const totalFirmados = trabajadores.filter(t => t.firmado).length;
        const todosHanFirmado = totalFirmados === request.totalRequeridos;

        // Determinar nuevo estado
        let nuevoEstado = request.estado;
        if (todosHanFirmado) {
            nuevoEstado = 'completada';
        } else if (totalFirmados > 0) {
            nuevoEstado = 'en_proceso';
        }

        await docClient.send(
            new UpdateCommand({
                TableName: TABLE_NAME,
                Key: { requestId },
                UpdateExpression: 'SET trabajadores = :trabajadores, totalFirmados = :totalFirmados, estado = :estado, fechaCompletado = :fechaCompletado, updatedAt = :updatedAt',
                ExpressionAttributeValues: {
                    ':trabajadores': trabajadores,
                    ':totalFirmados': totalFirmados,
                    ':estado': nuevoEstado,
                    ':fechaCompletado': todosHanFirmado ? now : null,
                    ':updatedAt': now,
                },
            })
        );

        return { success: true, nuevoEstado, totalFirmados };
    } catch (err) {
        console.error('Error updating request on signature:', err);
        return { success: false, error: err.message };
    }
};
