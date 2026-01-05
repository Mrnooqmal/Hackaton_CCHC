const { v4: uuidv4 } = require('uuid');
const { PutCommand, GetCommand, ScanCommand, UpdateCommand, QueryCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient } = require('../lib/dynamodb');
const { success, error, created } = require('../lib/response');
const { validateRequired } = require('../lib/validation');
// NEW: Import EventBus for automatic notifications
const { eventBus } = require('../lib/events/EventBus');

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

        // NEW: Emit event for automatic notifications
        try {
            const workerIds = trabajadoresInfo.map(t => t.workerId);
            const isUrgent = body.fechaLimite &&
                new Date(body.fechaLimite) <= new Date(Date.now() + 48 * 60 * 60 * 1000); // <48hrs

            await eventBus.emit('signature.requested', {
                requestId: signatureRequest.requestId,
                workerIds,
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
 * Resuelve tanto workerId como userId para asegurar historial completo
 */
module.exports.getHistoryByWorker = async (event) => {
    try {
        const { workerId: inputId } = event.pathParameters || {};

        if (!inputId) {
            return error('ID de trabajador requerido');
        }

        // 1. Resolver ambos IDs (workerId <-> userId)
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
            // Buscar en tabla Users
            const userRes = await docClient.send(new GetCommand({
                TableName: USERS_TABLE,
                Key: { userId: inputId }
            }));
            if (userRes.Item) {
                workerId = userRes.Item.workerId || workerId;
            }
        }

        // 2. Obtener todas las firmas asociadas a cualquiera de los IDs
        const signaturesResult = await docClient.send(
            new ScanCommand({
                TableName: SIGNATURES_TABLE,
                FilterExpression: 'workerId = :wId OR userId = :uId OR referenciaId = :wId OR referenciaId = :uId',
                ExpressionAttributeValues: {
                    ':wId': workerId,
                    ':uId': userId,
                },
            })
        );

        const firmas = (signaturesResult.Items || []).sort((a, b) =>
            new Date(b.timestamp) - new Date(a.timestamp)
        );

        // 3. Obtener información de las solicitudes asociadas
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
            resolvedIds: { workerId, userId }
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

        // Obtener información del solicitante
        const solicitanteResult = await docClient.send(
            new GetCommand({
                TableName: USERS_TABLE,
                Key: { userId: body.solicitanteId },
            })
        );

        const solicitante = solicitanteResult.Item || {
            nombre: 'Usuario',
            apellido: 'Offline',
            rut: 'N/A',
            empresaId: 'default',
        };

        const now = new Date().toISOString();
        const requestId = uuidv4();

        // Procesar cada firma offline
        const resultadosFirmas = [];
        const trabajadoresInfo = [];
        let firmasValidas = 0;

        // Helper para normalizar RUT (quitar puntos, guiones y espacios)
        const normalizeRut = (rut) => {
            if (!rut) return '';
            return rut.replace(/[\.\-\s]/g, '').toUpperCase();
        };

        for (const firmaOffline of body.firmasOffline) {
            const { rut, pin, nombre, timestampLocal } = firmaOffline;

            // Normalizar RUT de entrada
            const rutNormalizado = normalizeRut(rut);
            console.log(`[Offline Sync] Buscando trabajador con RUT: ${rut} (normalizado: ${rutNormalizado})`);

            // Buscar trabajador por RUT - scan completo para comparar normalizados
            const workerSearch = await docClient.send(
                new ScanCommand({
                    TableName: WORKERS_TABLE,
                })
            );

            let worker = null;
            if (workerSearch.Items && workerSearch.Items.length > 0) {
                // Buscar coincidencia exacta normalizando ambos
                worker = workerSearch.Items.find(w =>
                    normalizeRut(w.rut) === rutNormalizado
                );
                console.log(`[Offline Sync] Workers encontrados: ${workerSearch.Items.length}, Match: ${worker ? 'SI' : 'NO'}`);
            }

            if (!worker) {
                // Buscar en tabla Users
                console.log(`[Offline Sync] No encontrado en Workers, buscando en Users...`);
                const userSearch = await docClient.send(
                    new ScanCommand({
                        TableName: USERS_TABLE,
                    })
                );

                if (userSearch.Items && userSearch.Items.length > 0) {
                    const user = userSearch.Items.find(u =>
                        normalizeRut(u.rut) === rutNormalizado
                    );
                    console.log(`[Offline Sync] Users encontrados: ${userSearch.Items.length}, Match: ${user ? 'SI' : 'NO'}`);

                    if (user && user.workerId) {
                        // Obtener el worker asociado
                        const workerResult = await docClient.send(
                            new GetCommand({
                                TableName: WORKERS_TABLE,
                                Key: { workerId: user.workerId },
                            })
                        );
                        worker = workerResult.Item;
                        console.log(`[Offline Sync] Worker asociado al User: ${worker ? 'SI' : 'NO'}`);
                    } else if (user && !user.workerId) {
                        // El usuario existe pero no tiene workerId - usar sus datos directamente
                        // Esto puede pasar con prevencionistas que también firman
                        console.log(`[Offline Sync] Usuario encontrado sin workerId, verificando si tiene PIN...`);
                        if (user.pinHash) {
                            worker = {
                                workerId: user.userId,
                                rut: user.rut,
                                nombre: user.nombre,
                                apellido: user.apellido,
                                habilitado: user.habilitado,
                                pinHash: user.pinHash,
                                empresaId: user.empresaId,
                                cargo: user.rol,
                            };
                        }
                    }
                }
            }

            // Si no encontramos el trabajador
            if (!worker) {
                console.log(`[Offline Sync] FALLO: Trabajador no encontrado para RUT ${rut}`);
                resultadosFirmas.push({
                    rut,
                    success: false,
                    error: 'Trabajador no encontrado',
                });
                continue;
            }

            console.log(`[Offline Sync] Trabajador encontrado: ${worker.nombre} ${worker.apellido || ''}, habilitado: ${worker.habilitado}, hasPin: ${!!worker.pinHash}`);

            // Verificar que el trabajador esté habilitado
            if (!worker.habilitado) {
                console.log(`[Offline Sync] FALLO: Trabajador no habilitado`);
                resultadosFirmas.push({
                    rut,
                    success: false,
                    error: 'Trabajador no habilitado',
                });
                continue;
            }

            // Verificar PIN
            if (!worker.pinHash) {
                console.log(`[Offline Sync] FALLO: Trabajador sin PIN configurado`);
                resultadosFirmas.push({
                    rut,
                    success: false,
                    error: 'Trabajador sin PIN configurado',
                });
                continue;
            }

            // Importar función de verificación de PIN
            const { verifyPin, generateSignatureToken } = require('../lib/validation');

            const pinValido = verifyPin(pin, worker.pinHash, worker.workerId);
            console.log(`[Offline Sync] Verificación PIN: ${pinValido ? 'VALIDO' : 'INVALIDO'}`);

            if (!pinValido) {
                resultadosFirmas.push({
                    rut,
                    success: false,
                    error: 'PIN incorrecto',
                });
                continue;
            }

            // PIN válido - crear firma
            const signatureId = uuidv4();
            const token = generateSignatureToken();

            const signature = {
                signatureId,
                token,
                workerId: worker.workerId,
                workerRut: worker.rut,
                workerNombre: `${worker.nombre} ${worker.apellido || ''}`.trim(),
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
                empresaId: worker.empresaId || 'default',
                createdAt: now,
            };

            // Guardar firma
            await docClient.send(
                new PutCommand({
                    TableName: SIGNATURES_TABLE,
                    Item: signature,
                })
            );

            // Agregar a lista de trabajadores
            trabajadoresInfo.push({
                workerId: worker.workerId,
                nombre: `${worker.nombre} ${worker.apellido || ''}`.trim(),
                rut: worker.rut,
                cargo: worker.cargo,
                firmado: true,
                signatureId,
                fechaFirma: timestampLocal || now,
            });

            resultadosFirmas.push({
                rut,
                success: true,
                signatureId,
                token,
            });

            firmasValidas++;
        }

        // Crear la solicitud con todas las firmas ya procesadas
        const signatureRequest = {
            requestId,
            tipo: body.tipo,
            tipoInfo: REQUEST_TYPES[body.tipo] || REQUEST_TYPES.OTRO,
            titulo: body.titulo,
            descripcion: body.descripcion || '',
            documentos: [],
            tieneDocumentos: false,
            solicitanteId: body.solicitanteId,
            solicitanteNombre: `${solicitante.nombre} ${solicitante.apellido || ''}`.trim(),
            solicitanteRut: solicitante.rut,
            trabajadores: trabajadoresInfo,
            totalRequeridos: trabajadoresInfo.length,
            totalFirmados: firmasValidas,
            fechaCreacion: body.fechaCreacionOffline || now,
            fechaLimite: null,
            fechaCompletado: firmasValidas === trabajadoresInfo.length ? now : null,
            ubicacion: body.ubicacion || null,
            empresaId: solicitante.empresaId || 'default',
            estado: firmasValidas === trabajadoresInfo.length ? 'completada' : (firmasValidas > 0 ? 'en_proceso' : 'pendiente'),
            offlineRequest: true,
            fechaSincronizacion: now,
            createdAt: now,
            updatedAt: now,
        };

        await docClient.send(
            new PutCommand({
                TableName: TABLE_NAME,
                Item: signatureRequest,
            })
        );

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
