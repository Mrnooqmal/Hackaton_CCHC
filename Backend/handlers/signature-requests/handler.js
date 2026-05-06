const { v4: uuidv4 } = require('uuid');
const { PutCommand, GetCommand, ScanCommand, UpdateCommand, QueryCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient } = require('../../lib/clients/dynamodb');
const { success, error, created } = require('../../lib/utils/response');
const { validateRequired } = require('../../lib/utils/validation');
// NEW: Import EventBus for automatic notifications
const { eventBus } = require('../../lib/events/EventBus');

const TABLE_NAME = process.env.SIGNATURE_REQUESTS_TABLE || 'SignatureRequests';
const SIGNATURES_TABLE = process.env.SIGNATURES_TABLE || 'Signatures';
const { PersonaService } = require('../../lib/services/PersonaService');

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
 *   tenantId?: string
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

        // Obtener informacion del solicitante
        const personaService = new PersonaService();
        const solicitante = await personaService.getById(body.solicitanteId);
        if (!solicitante) return error('Solicitante no encontrado', 404);

        // Obtener informacion de las personas asignadas
        const trabajadoresInfo = [];
        for (const pid of body.trabajadoresIds) {
            const persona = await personaService.getById(pid);
            if (persona) {
                trabajadoresInfo.push({
                    personaId: persona.personaId,
                    workerId: persona.personaId, // backward compat
                    nombre: `${persona.nombre} ${persona.apellido || ''}`.trim(),
                    rut: persona.rut,
                    cargo: persona.cargo,
                    firmado: false,
                    signatureId: null,
                    fechaFirma: null,
                });
            }
        }

        if (trabajadoresInfo.length === 0) {
            return error('Ninguna de las personas especificadas fue encontrada');
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
            tenantId: body.tenantId || solicitante.tenantId || 'default',

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

        // NEW: Emit event for automatic notifications
        try {
            const personaIds = trabajadoresInfo.map(t => t.personaId);
            const isUrgent = body.fechaLimite &&
                new Date(body.fechaLimite) <= new Date(Date.now() + 48 * 60 * 60 * 1000); // <48hrs

            await eventBus.emit('signature.requested', {
                requestId: signatureRequest.requestId,
                personaIds,
                requestedBy: body.solicitanteId,
                documentName: signatureRequest.titulo,
                priority: isUrgent ? 'urgent' : 'normal'
            });
        } catch (eventError) {
            console.error('Error emitting signature.requested event:', eventError);
            // Continue even if notification fails
        }

        return created(signatureRequest);
    } catch (err) {
        console.error('Error creating signature request:', err);
        return error(err.message, 500);
    }
};

/**
 * GET /signature-requests - Listar solicitudes de firma
 * Query params: tenantId, estado, solicitanteId, tipo
 */
module.exports.list = async (event) => {
    try {
        const { tenantId, estado, solicitanteId, tipo } = event.queryStringParameters || {};

        if (tenantId) {
            // Use GSI query for tenant isolation
            let filterParts = [];
            const expressionAttributeValues = { ':tenantId': tenantId };

            if (estado) { filterParts.push('estado = :estado'); expressionAttributeValues[':estado'] = estado; }
            if (solicitanteId) { filterParts.push('solicitanteId = :solicitanteId'); expressionAttributeValues[':solicitanteId'] = solicitanteId; }
            if (tipo) { filterParts.push('tipo = :tipo'); expressionAttributeValues[':tipo'] = tipo; }

            const params = {
                TableName: TABLE_NAME,
                IndexName: 'tenantId-index',
                KeyConditionExpression: 'tenantId = :tenantId',
                ExpressionAttributeValues: expressionAttributeValues,
            };
            if (filterParts.length > 0) params.FilterExpression = filterParts.join(' AND ');

            const result = await docClient.send(new QueryCommand(params));

            const requests = (result.Items || []).sort((a, b) =>
                new Date(b.createdAt) - new Date(a.createdAt)
            );

            return success({ requests, total: requests.length, types: REQUEST_TYPES });
        }

        // Fallback: Scan without tenant filter
        const scanParams = { TableName: TABLE_NAME };
        let filterParts2 = [];
        const exprVals = {};
        if (estado) { filterParts2.push('estado = :estado'); exprVals[':estado'] = estado; }
        if (solicitanteId) { filterParts2.push('solicitanteId = :solicitanteId'); exprVals[':solicitanteId'] = solicitanteId; }
        if (tipo) { filterParts2.push('tipo = :tipo'); exprVals[':tipo'] = tipo; }
        if (filterParts2.length > 0) {
            scanParams.FilterExpression = filterParts2.join(' AND ');
            scanParams.ExpressionAttributeValues = exprVals;
        }
        const result = await docClient.send(new ScanCommand(scanParams));

        const requests = (result.Items || []).sort((a, b) =>
            new Date(b.createdAt) - new Date(a.createdAt)
        );

        return success({ requests, total: requests.length, types: REQUEST_TYPES });
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
            const trabajador = request.trabajadores.find(t => t.personaId === workerId || t.workerId === workerId);
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
 * Resuelve tanto workerId como userId para asegurar historial completo
 */
module.exports.getHistoryByWorker = async (event) => {
    try {
        const { workerId: inputId } = event.pathParameters || {};
        if (!inputId) return error('ID de persona requerido');

        // Query por GSI personaId-index
        const signaturesResult = await docClient.send(
            new QueryCommand({
                TableName: SIGNATURES_TABLE,
                IndexName: 'personaId-index',
                KeyConditionExpression: 'personaId = :pid',
                ExpressionAttributeValues: { ':pid': inputId },
            })
        );

        const firmas = (signaturesResult.Items || []).sort((a, b) =>
            new Date(b.timestamp) - new Date(a.timestamp)
        );

        const historial = [];
        for (const firma of firmas) {
            if (firma.requestId) {
                const requestResult = await docClient.send(
                    new GetCommand({ TableName: TABLE_NAME, Key: { requestId: firma.requestId } })
                );
                historial.push({ firma, solicitud: requestResult.Item || null });
            } else {
                historial.push({ firma, solicitud: null });
            }
        }

        return success({ historial, totalFirmas: firmas.length, personaId: inputId });
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
        const { tenantId, solicitanteId } = event.queryStringParameters || {};

        let filterExpression = '';
        const expressionAttributeValues = {};

        if (tenantId) {
            filterExpression = 'tenantId = :tenantId';
            expressionAttributeValues[':tenantId'] = tenantId;
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
            if (t.personaId === workerId || t.workerId === workerId) {
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

/**
 * POST /signature-requests/offline-batch - Procesar firmas recolectadas offline
 * 
 * Body: {
 *   tipo: string,
 *   titulo: string,
 *   descripcion?: string,
 *   ubicacion?: string,
 *   solicitanteId: string,
 *   firmasOffline: [{
 *     rut: string,
 *     pin: string,
 *     nombre?: string,
 *     timestampLocal: string
 *   }],
 *   fechaCreacionOffline: string
 * }
 */
module.exports.processOfflineBatch = async (event) => {
    try {
        const body = JSON.parse(event.body || '{}');

        const validation = validateRequired(body, ['tipo', 'titulo', 'solicitanteId', 'firmasOffline']);
        if (!validation.valid) {
            return error(`Campos requeridos faltantes: ${validation.missing.join(', ')}`);
        }

        if (!Array.isArray(body.firmasOffline) || body.firmasOffline.length === 0) {
            return error('Se requiere al menos una firma offline');
        }

        // Obtener informacion del solicitante
        const personaService = new PersonaService();
        const solicitante = await personaService.getById(body.solicitanteId);
        const solicitanteInfo = solicitante || {
            nombre: 'Usuario', apellido: 'Offline', rut: 'N/A',
            tenantId: body.tenantId || 'default',
        };
        const tenantId = body.tenantId || solicitanteInfo.tenantId || 'default';

        const now = new Date().toISOString();
        const requestId = uuidv4();
        const resultadosFirmas = [];
        const trabajadoresInfo = [];
        let firmasValidas = 0;

        for (const firmaOffline of body.firmasOffline) {
            const { rut, pin, nombre, timestampLocal } = firmaOffline;
            console.log(`[Offline Sync] Buscando persona con RUT: ${rut} en tenant ${tenantId}`);

            const persona = await personaService.getByRut(tenantId, rut);

            if (!persona) {
                resultadosFirmas.push({ rut, success: false, error: 'Persona no encontrada' });
                continue;
            }

            if (!persona.habilitado) {
                resultadosFirmas.push({ rut, success: false, error: 'Persona no habilitada' });
                continue;
            }

            if (!persona.pinHash) {
                resultadosFirmas.push({ rut, success: false, error: 'Persona sin PIN configurado' });
                continue;
            }

            const { verifyPin, generateSignatureToken } = require('../../lib/utils/validation');
            const pinValido = verifyPin(pin, persona.pinHash, persona.personaId);

            if (!pinValido) {
                resultadosFirmas.push({ rut, success: false, error: 'PIN incorrecto' });
                continue;
            }

            const signatureId = uuidv4();
            const token = generateSignatureToken();

            const signature = {
                signatureId,
                token,
                personaId: persona.personaId,
                workerRut: persona.rut,
                workerNombre: `${persona.nombre} ${persona.apellido || ''}`.trim(),
                tipoFirma: body.tipo,
                requestId,
                requestTipo: body.tipo,
                requestTitulo: body.titulo,
                referenciaId: requestId,
                referenciaTipo: 'signature-request',
                fecha: timestampLocal ? timestampLocal.split('T')[0] : now.split('T')[0],
                horario: timestampLocal ? new Date(timestampLocal).toTimeString().split(' ')[0] : new Date().toTimeString().split(' ')[0],
                timestamp: timestampLocal || now,
                timestampSync: now,
                offlineSignature: true,
                ipAddress: event.requestContext?.http?.sourceIp || 'offline',
                userAgent: event.headers?.['user-agent'] || 'offline-sync',
                metodoValidacion: 'PIN-OFFLINE',
                estado: 'valida',
                tenantId,
                createdAt: now,
            };

            await docClient.send(new PutCommand({ TableName: SIGNATURES_TABLE, Item: signature }));

            trabajadoresInfo.push({
                personaId: persona.personaId,
                workerId: persona.personaId,
                nombre: `${persona.nombre} ${persona.apellido || ''}`.trim(),
                rut: persona.rut,
                cargo: persona.cargo,
                firmado: true,
                signatureId,
                fechaFirma: timestampLocal || now,
            });

            resultadosFirmas.push({ rut, success: true, signatureId, token });
            firmasValidas++;
        }

        const signatureRequest = {
            requestId,
            tipo: body.tipo,
            tipoInfo: REQUEST_TYPES[body.tipo] || REQUEST_TYPES.OTRO,
            titulo: body.titulo,
            descripcion: body.descripcion || '',
            documentos: [],
            tieneDocumentos: false,
            solicitanteId: body.solicitanteId,
            solicitanteNombre: `${solicitanteInfo.nombre} ${solicitanteInfo.apellido || ''}`.trim(),
            solicitanteRut: solicitanteInfo.rut,
            trabajadores: trabajadoresInfo,
            totalRequeridos: trabajadoresInfo.length,
            totalFirmados: firmasValidas,
            fechaCreacion: body.fechaCreacionOffline || now,
            fechaLimite: null,
            fechaCompletado: firmasValidas === trabajadoresInfo.length ? now : null,
            ubicacion: body.ubicacion || null,
            tenantId,
            estado: firmasValidas === trabajadoresInfo.length ? 'completada' : (firmasValidas > 0 ? 'en_proceso' : 'pendiente'),
            offlineRequest: true,
            fechaSincronizacion: now,
            createdAt: now,
            updatedAt: now,
        };

        await docClient.send(new PutCommand({ TableName: TABLE_NAME, Item: signatureRequest }));

        return success({
            message: `Solicitud sincronizada. ${firmasValidas}/${body.firmasOffline.length} firmas válidas.`,
            requestId,
            firmasValidas,
            firmasInvalidas: body.firmasOffline.length - firmasValidas,
            resultadosFirmas,
        });
    } catch (err) {
        console.error('Error processing offline batch:', err);
        return error(err.message, 500);
    }
};
