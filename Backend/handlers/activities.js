const { v4: uuidv4 } = require('uuid');
const { PutCommand, GetCommand, QueryCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient } = require('../lib/dynamodb');
const { success, error, created } = require('../lib/response');
const { validateRequired, generateSignatureToken } = require('../lib/validation');
const { FirmaService } = require('../lib/services/FirmaService');
const { PersonaService } = require('../lib/services/PersonaService');
const { eventBus } = require('../lib/events/EventBus');

const TABLE_NAME = process.env.ACTIVITIES_TABLE || 'Activities';

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
        const tenantId = body.tenantId || event.queryStringParameters?.tenantId;
        if (!tenantId) return error('tenantId es requerido');

        const validation = validateRequired(body, ['tipo', 'titulo', 'relatorId']);
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
            tenantId,
            obraId: body.obraId || null,
            tipo: body.tipo,
            tipoDescripcion: ACTIVITY_TYPES[body.tipo],
            titulo: body.titulo,
            descripcion: body.descripcion || '',
            fecha: body.fecha || now.split('T')[0],
            horaInicio: body.horaInicio || now.split('T')[1].substring(0, 5),
            horaFin: body.horaFin || null,
            relatorId: body.relatorId,
            ubicacion: body.ubicacion || '',
            asistentes: [],
            firmaRelator: null,
            estado: 'programada',
            createdAt: now,
            updatedAt: now,
        };

        await docClient.send(new PutCommand({ TableName: TABLE_NAME, Item: activity }));

        // Notificar asistentes
        try {
            if (body.attendees && body.attendees.length > 0) {
                await eventBus.emit('activity.created', {
                    activityId: activity.activityId,
                    attendeeIds: body.attendees,
                    createdBy: body.relatorId,
                    activityName: activity.titulo,
                    fecha: activity.fecha,
                    tipo: activity.tipo
                });
            }
        } catch (eventError) {
            console.error('Error emitting activity.created event:', eventError);
        }

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
        const { tenantId, tipo, estado, fecha, relatorId } = event.queryStringParameters || {};
        if (!tenantId) return error('tenantId es requerido');

        // Query por GSI tenantId-index (no Scan)
        const params = {
            TableName: TABLE_NAME,
            IndexName: 'tenantId-index',
            KeyConditionExpression: 'tenantId = :tenantId',
            ExpressionAttributeValues: { ':tenantId': tenantId }
        };

        let filterParts = [];
        const expressionAttributeNames = {};

        if (tipo) {
            filterParts.push('tipo = :tipo');
            params.ExpressionAttributeValues[':tipo'] = tipo;
        }
        if (estado) {
            filterParts.push('estado = :estado');
            params.ExpressionAttributeValues[':estado'] = estado;
        }
        if (fecha) {
            filterParts.push('#fecha = :fecha');
            expressionAttributeNames['#fecha'] = 'fecha';
            params.ExpressionAttributeValues[':fecha'] = fecha;
        }
        if (relatorId) {
            filterParts.push('relatorId = :relatorId');
            params.ExpressionAttributeValues[':relatorId'] = relatorId;
        }

        if (filterParts.length > 0) {
            params.FilterExpression = filterParts.join(' AND ');
        }
        if (Object.keys(expressionAttributeNames).length > 0) {
            params.ExpressionAttributeNames = expressionAttributeNames;
        }

        const result = await docClient.send(new QueryCommand(params));

        const activities = (result.Items || []).sort((a, b) =>
            new Date(b.createdAt) - new Date(a.createdAt)
        );

        return success({ activities, types: ACTIVITY_TYPES });
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

        if (!id) return error('ID de actividad requerido');

        // Acepta personaId o workerId (legacy) 
        const { personaId, personaIds, workerId, workerIds, incluirFirmaRelator, pin } = body;
        const personas = personaIds || (personaId ? [personaId] : workerIds || (workerId ? [workerId] : []));

        if (personas.length === 0) {
            return error('Se requiere al menos un trabajador');
        }

        // Obtener actividad
        const actResult = await docClient.send(new GetCommand({
            TableName: TABLE_NAME,
            Key: { activityId: id }
        }));

        if (!actResult.Item) return error('Actividad no encontrada', 404);
        const activity = actResult.Item;

        const personaService = new PersonaService();
        const now = new Date();
        const nuevosAsistentes = [];
        const contexto = {
            ipAddress: event.requestContext?.http?.sourceIp || 'unknown',
            userAgent: event.headers?.['user-agent'] || 'unknown'
        };

        // Registrar cada persona
        for (const pid of personas) {
            const yaRegistrado = (activity.asistentes || []).some(a => 
                a.personaId === pid || a.workerId === pid
            );
            if (yaRegistrado) continue;

            const persona = await personaService.getById(pid);
            if (!persona) continue;

            // Crear firma en SignaturesTable
            const metodo = pin ? 'PIN' : 'PRESENCIAL';
            try {
                const firma = await FirmaService.crear({
                    personaId: pid,
                    tenantId: activity.tenantId,
                    metodo,
                    credencial: pin || {},
                    tipoFirma: 'actividad',
                    referenciaId: id,
                    referenciaTipo: 'activity',
                    contexto,
                    persona
                });

                nuevosAsistentes.push({
                    personaId: pid,
                    nombre: persona.nombre,
                    rut: persona.rut,
                    cargo: persona.cargo || '',
                    firma: {
                        token: firma.token,
                        fecha: firma.fecha,
                        horario: firma.horario,
                        timestamp: firma.timestamp
                    }
                });
            } catch (firmaErr) {
                console.error(`Error creando firma para ${pid}:`, firmaErr.message);
            }
        }

        const asistentes = [...(activity.asistentes || []), ...nuevosAsistentes];

        // Firma del relator si se solicita
        let firmaRelator = activity.firmaRelator;
        if (incluirFirmaRelator && !firmaRelator && activity.relatorId) {
            const relator = await personaService.getById(activity.relatorId);
            if (relator) {
                firmaRelator = {
                    token: generateSignatureToken(),
                    personaId: activity.relatorId,
                    nombre: relator.nombre,
                    rut: relator.rut,
                    fecha: now.toISOString().split('T')[0],
                    horario: now.toTimeString().split(' ')[0],
                    timestamp: now.toISOString()
                };
            }
        }

        const estado = asistentes.length > 0 ? 'completada' : activity.estado;

        await docClient.send(new UpdateCommand({
            TableName: TABLE_NAME,
            Key: { activityId: id },
            UpdateExpression: 'SET asistentes = :asistentes, firmaRelator = :firmaRelator, estado = :estado, horaFin = :horaFin, updatedAt = :updatedAt',
            ExpressionAttributeValues: {
                ':asistentes': asistentes,
                ':firmaRelator': firmaRelator,
                ':estado': estado,
                ':horaFin': now.toTimeString().split(' ')[0].substring(0, 5),
                ':updatedAt': now.toISOString()
            }
        }));

        return success({
            message: `${nuevosAsistentes.length} asistente(s) registrado(s)`,
            totalAsistentes: asistentes.length,
            nuevosAsistentes,
            firmaRelator: incluirFirmaRelator ? firmaRelator : undefined
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
        const { tenantId, fechaInicio, fechaFin } = event.queryStringParameters || {};
        if (!tenantId) return error('tenantId es requerido');

        // Query por GSI tenantId-index
        const result = await docClient.send(new QueryCommand({
            TableName: TABLE_NAME,
            IndexName: 'tenantId-index',
            KeyConditionExpression: 'tenantId = :tenantId',
            ExpressionAttributeValues: { ':tenantId': tenantId }
        }));

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
