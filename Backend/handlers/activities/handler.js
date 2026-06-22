const { v4: uuidv4 } = require('uuid');
const { PutCommand, GetCommand, QueryCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient } = require('../../lib/clients/dynamodb');
const { success, error, created } = require('../../lib/utils/response');
const { validateRequired, generateSignatureToken } = require('../../lib/utils/validation');
const { FirmaService } = require('../../lib/services/FirmaService');
const { PersonaService } = require('../../lib/services/PersonaService');
const { eventBus } = require('../../lib/events/EventBus');

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

// Subtipos de CAPACITACION segun el DS44 (Excel de Elementos). Permiten
// distinguir de forma estricta cada capacitacion exigida en la fase DO,
// en vez de adivinar por palabras del titulo.
const CAPACITACION_SUBTIPOS = {
    PRL_8H: 'Prevención de Riesgos Laborales (8h) — Art. 16',
    EPP: 'Uso y mantención de EPP — Art. 13',
    CPHS_ORIENTACION: 'Orientación CPHS (8h) — Art. 32',
    CPHS_20H: 'Curso 20h CPHS — Art. 32',
    DELEGADO: 'Capacitación Delegado SST — Art. 66',
    ENCARGADO: 'Encargado Gestión del Riesgo — Art. 65',
    OTRA: 'Otra capacitación',
};

// Tope de ocurrencias por serie, para evitar crear cantidades desmedidas.
const MAX_OCURRENCIAS = 180;

/**
 * Genera la lista de fechas (YYYY-MM-DD) de una serie recurrente entre la fecha
 * de inicio y `hasta` (inclusive), según la frecuencia. Devuelve solo la fecha
 * de inicio si no hay repetición o los parámetros son inválidos.
 */
function generarFechasRecurrencia(inicio, hasta, frecuencia) {
    if (frecuencia === 'unica' || !hasta) return [inicio];
    const cur = new Date(`${inicio}T00:00:00`);
    const fin = new Date(`${hasta}T00:00:00`);
    if (isNaN(cur.getTime()) || isNaN(fin.getTime()) || fin < cur) return [inicio];

    const fechas = [];
    while (cur <= fin && fechas.length < MAX_OCURRENCIAS) {
        fechas.push(cur.toISOString().split('T')[0]);
        if (frecuencia === 'diaria') cur.setDate(cur.getDate() + 1);
        else if (frecuencia === 'semanal') cur.setDate(cur.getDate() + 7);
        else if (frecuencia === 'mensual') cur.setMonth(cur.getMonth() + 1);
        else break;
    }
    return fechas;
}

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

        // El subtipo solo aplica a CAPACITACION; si viene, debe ser valido.
        let subtipo = null;
        if (body.tipo === 'CAPACITACION') {
            subtipo = body.subtipo || 'OTRA';
            if (!CAPACITACION_SUBTIPOS[subtipo]) {
                return error(`Subtipo de capacitación inválido. Válidos: ${Object.keys(CAPACITACION_SUBTIPOS).join(', ')}`);
            }
        }

        const now = new Date().toISOString();

        // Periodicidad: si la actividad se repite, generamos una ocurrencia por
        // fecha (ej. una charla de 5 min cada día a las 9am). Todas comparten un
        // serieId para poder agruparlas/identificarlas. 'unica' = sin repetición.
        const FRECUENCIAS = ['unica', 'diaria', 'semanal', 'mensual'];
        const frecuencia = FRECUENCIAS.includes(body.frecuencia) ? body.frecuencia : 'unica';
        const fechaInicio = body.fecha || now.split('T')[0];
        const repetirHasta = body.repetirHasta || null;

        const fechas = generarFechasRecurrencia(fechaInicio, repetirHasta, frecuencia);
        const esSerie = frecuencia !== 'unica' && fechas.length > 1;
        const serieId = esSerie ? uuidv4() : null;

        const asistentesRequeridos = Array.isArray(body.asistentesRequeridos)
            ? body.asistentesRequeridos
            : (Array.isArray(body.attendees) ? body.attendees : []);

        const baseActivity = {
            tenantId,
            obraId: body.obraId || null,
            tipo: body.tipo,
            tipoDescripcion: ACTIVITY_TYPES[body.tipo],
            subtipo,
            subtipoDescripcion: subtipo ? CAPACITACION_SUBTIPOS[subtipo] : null,
            titulo: body.titulo,
            descripcion: body.descripcion || '',
            horaInicio: body.horaInicio || now.split('T')[1].substring(0, 5),
            horaFin: body.horaFin || null,
            relatorId: body.relatorId,
            ubicacion: body.ubicacion || '',
            asistentesRequeridos,
            asistentes: [],
            firmaRelator: null,
            estado: 'programada',
            recurrencia: esSerie ? { frecuencia, repetirHasta, serieId } : { frecuencia: 'unica' },
            serieId,
            // Vínculo con el ítem del kit de onboarding (trazabilidad): si esta
            // actividad se agendó para cumplir un ítem, al asistir se cierra ese ítem.
            kitItemKey: body.kitItemKey || null,
            createdAt: now,
            updatedAt: now,
        };

        const actividades = fechas.map((fecha) => ({
            ...baseActivity,
            activityId: uuidv4(),
            fecha,
        }));

        for (const act of actividades) {
            await docClient.send(new PutCommand({ TableName: TABLE_NAME, Item: act }));
        }

        // Notificar asistentes (un solo evento por la serie/actividad, con la primera fecha).
        try {
            if (asistentesRequeridos.length > 0) {
                const primera = actividades[0];
                await eventBus.emit('activity.created', {
                    activityId: primera.activityId,
                    attendeeIds: asistentesRequeridos,
                    createdBy: body.relatorId,
                    activityName: primera.titulo,
                    fecha: primera.fecha,
                    tipo: primera.tipo,
                    obraId: primera.obraId,
                    serie: esSerie ? { serieId, ocurrencias: actividades.length } : undefined,
                });
            }
        } catch (eventError) {
            console.error('Error emitting activity.created event:', eventError);
        }

        // Compatibilidad: una sola actividad devuelve el objeto; una serie devuelve
        // la lista creada junto con la primera ocurrencia.
        if (!esSerie) return created(actividades[0]);
        return created({ serie: true, serieId, count: actividades.length, activities: actividades, first: actividades[0] });
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
        const { tenantId, obraId, tipo, estado, fecha, relatorId } = event.queryStringParameters || {};
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

        if (obraId) {
            filterParts.push('obraId = :obraId');
            params.ExpressionAttributeValues[':obraId'] = obraId;
        }
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

        return success({ activities, types: ACTIVITY_TYPES, capacitacionSubtipos: CAPACITACION_SUBTIPOS });
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

        // Firma con PIN del trabajador (no presencial): la asistencia se firma de
        // forma INDIVIDUAL porque un PIN solo autentica a su dueño. El cliente
        // registra un trabajador a la vez con su propio PIN.
        if (!pin) return error('Se requiere el PIN del trabajador para registrar la asistencia', 400);
        if (personas.length > 1) {
            return error('La firma con PIN es individual: registra un trabajador a la vez con su propio PIN', 400);
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
            const yaRegistrado = (activity.asistentes || []).some(a => a.personaId === pid);
            if (yaRegistrado) continue;

            const persona = await personaService.getById(pid);
            if (!persona) continue;

            // Crear firma en SignaturesTable (siempre con PIN del trabajador).
            const metodo = 'PIN';
            const firma = await FirmaService.crear({
                personaId: pid,
                tenantId: activity.tenantId,
                obraId: activity.obraId || null,
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
