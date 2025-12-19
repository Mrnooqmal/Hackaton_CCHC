const { v4: uuidv4 } = require('uuid');
const { PutCommand, GetCommand, ScanCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient } = require('../lib/dynamodb');
const { success, error, created } = require('../lib/response');
const { validateRequired, generateSignatureToken } = require('../lib/validation');

const TABLE_NAME = process.env.ACTIVITIES_TABLE || 'Activities';
const WORKERS_TABLE = process.env.WORKERS_TABLE || 'Workers';

// Tipos de actividades según el flujo de prevención
const ACTIVITY_TYPES = {
    CHARLA_5MIN: 'Charla Diaria de 5 Minutos',
    ART: 'Análisis de Riesgos en Terreno',
    CAPACITACION: 'Capacitación',
    INDUCCION: 'Inducción',
    REUNION_COMITE: 'Reunión Comité Paritario',
    SIMULACRO: 'Simulacro de Emergencia',
    INSPECCION: 'Inspección de Seguridad',
};

/**
 * POST /activities - Crear nueva actividad
 */
module.exports.create = async (event) => {
    try {
        const body = JSON.parse(event.body || '{}');

        const validation = validateRequired(body, ['tipo', 'tema', 'relatorId']);
        if (!validation.valid) {
            return error(`Campos requeridos faltantes: ${validation.missing.join(', ')}`);
        }

        if (!ACTIVITY_TYPES[body.tipo]) {
            return error(`Tipo de actividad inválido. Tipos válidos: ${Object.keys(ACTIVITY_TYPES).join(', ')}`);
        }

        const now = new Date().toISOString();
        const activityId = uuidv4();

        const activity = {
            activityId,
            tipo: body.tipo,
            tipoDescripcion: ACTIVITY_TYPES[body.tipo],
            tema: body.tema,
            descripcion: body.descripcion || '',
            fecha: body.fecha || now.split('T')[0],
            horaInicio: body.horaInicio || now.split('T')[1].substring(0, 5),
            horaFin: body.horaFin || null,
            relatorId: body.relatorId,
            empresaId: body.empresaId || 'default',
            ubicacion: body.ubicacion || '',
            asistentes: [],
            firmaRelator: null,
            estado: 'programada', // programada, en_curso, completada, cancelada
            createdAt: now,
            updatedAt: now,
        };

        await docClient.send(
            new PutCommand({
                TableName: TABLE_NAME,
                Item: activity,
            })
        );

        return created(activity);
    } catch (err) {
        console.error('Error creating activity:', err);
        return error(err.message, 500);
    }
};

/**
 * GET /activities - Listar actividades
 */
module.exports.list = async (event) => {
    try {
        const { empresaId, tipo, estado, fecha, relatorId } = event.queryStringParameters || {};

        let filterExpression = '';
        const expressionAttributeValues = {};
        const expressionAttributeNames = {};

        if (empresaId) {
            filterExpression += 'empresaId = :empresaId';
            expressionAttributeValues[':empresaId'] = empresaId;
        }

        if (tipo) {
            filterExpression += filterExpression ? ' AND tipo = :tipo' : 'tipo = :tipo';
            expressionAttributeValues[':tipo'] = tipo;
        }

        if (estado) {
            filterExpression += filterExpression ? ' AND estado = :estado' : 'estado = :estado';
            expressionAttributeValues[':estado'] = estado;
        }

        if (fecha) {
            filterExpression += filterExpression ? ' AND #fecha = :fecha' : '#fecha = :fecha';
            expressionAttributeNames['#fecha'] = 'fecha';
            expressionAttributeValues[':fecha'] = fecha;
        }

        if (relatorId) {
            filterExpression += filterExpression ? ' AND relatorId = :relatorId' : 'relatorId = :relatorId';
            expressionAttributeValues[':relatorId'] = relatorId;
        }

        const params = {
            TableName: TABLE_NAME,
        };

        if (filterExpression) {
            params.FilterExpression = filterExpression;
            params.ExpressionAttributeValues = expressionAttributeValues;
            if (Object.keys(expressionAttributeNames).length > 0) {
                params.ExpressionAttributeNames = expressionAttributeNames;
            }
        }

        const result = await docClient.send(new ScanCommand(params));

        // Ordenar por fecha descendente
        const activities = (result.Items || []).sort((a, b) =>
            new Date(b.createdAt) - new Date(a.createdAt)
        );

        return success({
            activities,
            types: ACTIVITY_TYPES,
        });
    } catch (err) {
        console.error('Error listing activities:', err);
        return error(err.message, 500);
    }
};

/**
 * GET /activities/{id} - Obtener actividad por ID
 */
module.exports.get = async (event) => {
    try {
        const { id } = event.pathParameters || {};

        if (!id) {
            return error('ID de actividad requerido');
        }

        const result = await docClient.send(
            new GetCommand({
                TableName: TABLE_NAME,
                Key: { activityId: id },
            })
        );

        if (!result.Item) {
            return error('Actividad no encontrada', 404);
        }

        return success(result.Item);
    } catch (err) {
        console.error('Error getting activity:', err);
        return error(err.message, 500);
    }
};

/**
 * POST /activities/{id}/attendance - Registrar asistencia con firma
 */
module.exports.registerAttendance = async (event) => {
    try {
        const { id } = event.pathParameters || {};
        const body = JSON.parse(event.body || '{}');

        if (!id) {
            return error('ID de actividad requerido');
        }

        // Puede ser firma individual o masiva
        const { workerId, workerIds, incluirFirmaRelator } = body;
        const trabajadores = workerIds || (workerId ? [workerId] : []);

        if (trabajadores.length === 0) {
            return error('Se requiere al menos un trabajador');
        }

        // Obtener actividad
        const actResult = await docClient.send(
            new GetCommand({
                TableName: TABLE_NAME,
                Key: { activityId: id },
            })
        );

        if (!actResult.Item) {
            return error('Actividad no encontrada', 404);
        }

        const activity = actResult.Item;
        const now = new Date();
        const nuevosAsistentes = [];

        // Registrar cada trabajador
        for (const wId of trabajadores) {
            // Verificar si ya está registrado
            const yaRegistrado = (activity.asistentes || []).some(a => a.workerId === wId);
            if (yaRegistrado) continue;

            const workerResult = await docClient.send(
                new GetCommand({
                    TableName: WORKERS_TABLE,
                    Key: { workerId: wId },
                })
            );

            if (workerResult.Item) {
                const worker = workerResult.Item;
                nuevosAsistentes.push({
                    workerId: wId,
                    nombre: worker.nombre,
                    rut: worker.rut,
                    cargo: worker.cargo,
                    firma: {
                        token: generateSignatureToken(),
                        fecha: now.toISOString().split('T')[0],
                        horario: now.toTimeString().split(' ')[0],
                        timestamp: now.toISOString(),
                    },
                });
            }
        }

        const asistentes = [...(activity.asistentes || []), ...nuevosAsistentes];

        // Firma del relator si se solicita
        let firmaRelator = activity.firmaRelator;
        if (incluirFirmaRelator && !firmaRelator) {
            const relatorResult = await docClient.send(
                new GetCommand({
                    TableName: WORKERS_TABLE,
                    Key: { workerId: activity.relatorId },
                })
            );

            if (relatorResult.Item) {
                const relator = relatorResult.Item;
                firmaRelator = {
                    token: generateSignatureToken(),
                    workerId: activity.relatorId,
                    nombre: relator.nombre,
                    rut: relator.rut,
                    fecha: now.toISOString().split('T')[0],
                    horario: now.toTimeString().split(' ')[0],
                    timestamp: now.toISOString(),
                };
            }
        }

        // Actualizar estado si hay asistentes
        const estado = asistentes.length > 0 ? 'completada' : activity.estado;

        await docClient.send(
            new UpdateCommand({
                TableName: TABLE_NAME,
                Key: { activityId: id },
                UpdateExpression: 'SET asistentes = :asistentes, firmaRelator = :firmaRelator, estado = :estado, horaFin = :horaFin, updatedAt = :updatedAt',
                ExpressionAttributeValues: {
                    ':asistentes': asistentes,
                    ':firmaRelator': firmaRelator,
                    ':estado': estado,
                    ':horaFin': now.toTimeString().split(' ')[0].substring(0, 5),
                    ':updatedAt': now.toISOString(),
                },
            })
        );

        return success({
            message: `${nuevosAsistentes.length} asistente(s) registrado(s)`,
            totalAsistentes: asistentes.length,
            nuevosAsistentes,
            firmaRelator: incluirFirmaRelator ? firmaRelator : undefined,
        });
    } catch (err) {
        console.error('Error registering attendance:', err);
        return error(err.message, 500);
    }
};

/**
 * GET /activities/stats - Estadísticas de actividades
 */
module.exports.getStats = async (event) => {
    try {
        const { empresaId, fechaInicio, fechaFin } = event.queryStringParameters || {};

        const result = await docClient.send(
            new ScanCommand({
                TableName: TABLE_NAME,
                FilterExpression: empresaId ? 'empresaId = :empresaId' : undefined,
                ExpressionAttributeValues: empresaId ? { ':empresaId': empresaId } : undefined,
            })
        );

        const activities = result.Items || [];

        // Filtrar por rango de fechas si se especifica
        let filteredActivities = activities;
        if (fechaInicio || fechaFin) {
            filteredActivities = activities.filter(a => {
                const fecha = new Date(a.fecha);
                if (fechaInicio && fecha < new Date(fechaInicio)) return false;
                if (fechaFin && fecha > new Date(fechaFin)) return false;
                return true;
            });
        }

        // Calcular estadísticas
        const stats = {
            total: filteredActivities.length,
            completadas: filteredActivities.filter(a => a.estado === 'completada').length,
            programadas: filteredActivities.filter(a => a.estado === 'programada').length,
            canceladas: filteredActivities.filter(a => a.estado === 'cancelada').length,
            porTipo: {},
            totalAsistentes: 0,
            promedioAsistentesPorActividad: 0,
        };

        // Por tipo
        Object.keys(ACTIVITY_TYPES).forEach(tipo => {
            const delTipo = filteredActivities.filter(a => a.tipo === tipo);
            stats.porTipo[tipo] = {
                nombre: ACTIVITY_TYPES[tipo],
                total: delTipo.length,
                completadas: delTipo.filter(a => a.estado === 'completada').length,
            };
        });

        // Total asistentes
        filteredActivities.forEach(a => {
            stats.totalAsistentes += (a.asistentes || []).length;
        });

        if (stats.completadas > 0) {
            stats.promedioAsistentesPorActividad = Math.round(stats.totalAsistentes / stats.completadas * 10) / 10;
        }

        // Porcentaje de cumplimiento
        stats.porcentajeCumplimiento = stats.total > 0
            ? Math.round((stats.completadas / stats.total) * 100)
            : 0;

        return success(stats);
    } catch (err) {
        console.error('Error getting stats:', err);
        return error(err.message, 500);
    }
};
