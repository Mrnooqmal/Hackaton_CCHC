const { v4: uuidv4 } = require('uuid');
const { PutCommand, GetCommand, UpdateCommand, QueryCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient } = require('../../lib/clients/dynamodb');
const { success, error, created } = require('../../lib/utils/response');
const { fechaHoraChile } = require('../../lib/utils/fechaChile');
const { validateRequired } = require('../../lib/utils/validation');
// NEW: Import EventBus for automatic notifications
const { eventBus } = require('../../lib/events/EventBus');

const TABLE_NAME = process.env.SIGNATURE_REQUESTS_TABLE || 'SignatureRequests';
const SIGNATURES_TABLE = process.env.SIGNATURES_TABLE || 'Signatures';
const { PERMISSIONS } = require('../../lib/permissions');
const { conSesion, sesionPuede, esDeLaEmpresa } = require('../../lib/auth/sesion');
const { personaDeLaEmpresa, obraDeLaEmpresa } = require('../../lib/auth/pertenencia');
const { cifrarConLlaveDatos } = require('../../lib/cifradoCampo');
const {
    llaveDe: llaveDeArreglos,
    descifrarSolicitudDeTenant,
    descifrarSolicitudesDeTenant,
} = require('../../lib/arregloSensible');

// ─── Identidad ───────────────────────────────────────────────────────────────
//
// Todo este módulo tomaba la identidad del cliente: la empresa de la consulta
// (y descifraba las solicitudes de la empresa que se nombrara), el solicitante
// del cuerpo, y el historial de cualquier persona por su id. Ahora la empresa y
// el actor salen de la sesión, y lo que el cliente nombra (una solicitud, una
// persona, una obra) se comprueba contra la empresa con 404.
//
// Quién ve qué: quien gestiona solicitudes (`firmas.crear`) ve las de su
// empresa; el resto, solo aquellas en las que firma o que pidió.

const gestiona = (sesion) => sesionPuede(sesion, PERMISSIONS.FIRMAS_CREAR);

const participa = (solicitud, personaId) => solicitud.solicitanteId === personaId
    || (solicitud.trabajadores || []).some((t) => t.personaId === personaId || t.workerId === personaId);

/** La solicitud, si es de la empresa de la sesión. */
async function solicitudDeLaEmpresa(requestId, sesion) {
    if (!requestId) return null;
    const r = await docClient.send(new GetCommand({ TableName: TABLE_NAME, Key: { requestId } }));
    return esDeLaEmpresa(r.Item, sesion) ? r.Item : null;
}

/**
 * Las firmas pendientes y el historial de una persona los ve ella misma, o
 * quien puede ver el detalle de las personas (la ficha del trabajador).
 */
async function personaConsultable(personaId, sesion) {
    if (personaId !== sesion.personaId && !sesionPuede(sesion, PERMISSIONS.PERSONAS_DETALLE)) return null;
    return personaDeLaEmpresa(personaId, sesion);
}

// Tipos de solicitudes de firma
const REQUEST_TYPES = {
    CHARLA_5MIN: { label: 'Charla de 5 Minutos', icon: 'chat', requiresDoc: false },
    CAPACITACION: { label: 'Capacitación', icon: 'book', requiresDoc: true },
    INDUCCION: { label: 'Inducción', icon: 'graduation', requiresDoc: true },
    ENTREGA_EPP: { label: 'Entrega de EPP', icon: 'shield', requiresDoc: true },
    ART: { label: 'Análisis de Riesgos en Terreno', icon: 'warning', requiresDoc: true },
    PROCEDIMIENTO: { label: 'Procedimiento de Trabajo', icon: 'clipboard', requiresDoc: true },
    INSPECCION: { label: 'Inspección de Seguridad', icon: 'search', requiresDoc: false },
    REGLAMENTO: { label: 'Reglamento Interno', icon: 'document', requiresDoc: true },
    DOCUMENTO: { label: 'Documento DS44', icon: 'file', requiresDoc: true },
    OTRO: { label: 'Otro', icon: 'edit', requiresDoc: false },
    INVESTIGACION_ACCIDENTE: { label: 'Investigación de Accidente / EP', icon: 'search', requiresDoc: true },
    CAPACITACION_SST: {
        label: 'Capacitación SST 8 horas',
        icon: 'book',
        requiresDoc: true,
        requiereFirmaRelator: true,
        descripcionLegal: 'Art. 16 DS 44 - Registro de asistencia con firma cruzada'
    }
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
 * }
 * La empresa y el solicitante salen de la sesión.
 */
module.exports.create = async (event) => {
    try {
        const ses = conSesion(event);
        if (!ses.ok) return ses.respuesta;
        const sesion = ses.sesion;
        if (!gestiona(sesion)) return error('No tienes permiso para crear solicitudes de firma', 403);

        const body = JSON.parse(event.body || '{}');

        const validation = validateRequired(body, ['tipo', 'titulo', 'trabajadoresIds']);
        if (!validation.valid) {
            return error(`Campos requeridos faltantes: ${validation.missing.join(', ')}`);
        }
        if (!REQUEST_TYPES[body.tipo]) {
            return error(`Tipo de solicitud inválido. Tipos válidos: ${Object.keys(REQUEST_TYPES).join(', ')}`);
        }
        if (!Array.isArray(body.trabajadoresIds) || body.trabajadoresIds.length === 0) {
            return error('Debe especificar al menos un trabajador');
        }
        if (body.obraId && !await obraDeLaEmpresa(body.obraId, sesion)) return error('Obra no encontrada', 404);

        // Quien solicita es quien tiene la sesión: venía del cuerpo, y con él el
        // permiso que se comprobaba y la empresa de la solicitud.
        const solicitante = await personaDeLaEmpresa(sesion.personaId, sesion);
        if (!solicitante) return error('Solicitante no encontrado', 404);
        const requestTenantId = sesion.tenantId;

        // Obtener informacion de las personas asignadas (solo del mismo tenant)
        const llaveArreglos = await llaveDeArreglos(requestTenantId);
        const trabajadoresInfo = [];
        const trabajadoresOmitidos = [];
        for (const pid of body.trabajadoresIds) {
            const persona = await personaDeLaEmpresa(pid, sesion);
            if (!persona) {
                trabajadoresOmitidos.push(pid);
                continue;
            }
            trabajadoresInfo.push({
                personaId: persona.personaId,
                workerId: persona.personaId, // backward compat
                nombre: `${persona.nombre} ${persona.apellido || ''}`.trim(),
                // Cifrado con la llave de la empresa (D-10): la solicitud
                // entera viaja en cada listado, con todos sus trabajadores.
                rutCifrado: cifrarConLlaveDatos(persona.rut ?? null, llaveArreglos),
                cargo: persona.cargo,
                firmado: false,
                signatureId: null,
                fechaFirma: null,
            });
        }

        // Una persona ajena a la empresa se trata como inexistente (404), igual
        // que en el resto del sistema: decir "es de otra organización" confirma
        // que el id existe.
        if (trabajadoresOmitidos.length > 0) return error('Persona no encontrada', 404);

        const now = new Date().toISOString();
        const requestId = uuidv4();

        const referenciaId = body.referenciaId || body.documentId || null;
        const referenciaTipo = body.referenciaTipo || (body.documentId ? 'document' : null);

        const signatureRequest = {
            requestId,
            tipo: body.tipo,
            tipoInfo: REQUEST_TYPES[body.tipo],
            titulo: body.titulo,
            descripcion: body.descripcion || '',

            // Referencia opcional (ej: documento DS44)
            referenciaId,
            referenciaTipo,
            documentId: body.documentId || null,

            // Documentos adjuntos
            documentos: body.documentos || [],
            tieneDocumentos: (body.documentos && body.documentos.length > 0),

            // Información del solicitante
            solicitanteId: sesion.personaId,
            solicitanteNombre: `${solicitante.nombre} ${solicitante.apellido || ''}`.trim(),
            solicitanteRutCifrado: cifrarConLlaveDatos(solicitante.rut ?? null, llaveArreglos),

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
            obraId: body.obraId || null,
            tenantId: requestTenantId,

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
                requestedBy: sesion.personaId,
                documentName: signatureRequest.titulo,
                priority: isUrgent ? 'urgent' : 'normal',
                obraId: signatureRequest.obraId
            });
        } catch (eventError) {
            console.error('Error emitting signature.requested event:', eventError);
            // Continue even if notification fails
        }

        // Al cliente va el RUT, no el sobre.
        return created(await descifrarSolicitudDeTenant(signatureRequest, requestTenantId));
    } catch (err) {
        console.error('Error creating signature request:', err);
        return error(err.message, 500);
    }
};

/**
 * GET /signature-requests - Listar solicitudes de firma
 * Query params: estado, solicitante, tipo, obraId. La empresa sale de la sesión.
 */
module.exports.list = async (event) => {
    try {
        const ses = conSesion(event);
        if (!ses.ok) return ses.respuesta;
        const sesion = ses.sesion;
        const tenantId = sesion.tenantId;
        // `solicitante` filtra dentro de la empresa: no identifica a quien pide.
        const { estado, tipo, obraId } = event.queryStringParameters || {};
        const filtroSolicitante = (event.queryStringParameters || {}).solicitante || null;

        // Use GSI query for tenant isolation
        let filterParts = [];
        const expressionAttributeValues = { ':tenantId': tenantId };

        if (estado) { filterParts.push('estado = :estado'); expressionAttributeValues[':estado'] = estado; }
        if (filtroSolicitante) { filterParts.push('solicitanteId = :solicitanteId'); expressionAttributeValues[':solicitanteId'] = filtroSolicitante; }
        if (tipo) { filterParts.push('tipo = :tipo'); expressionAttributeValues[':tipo'] = tipo; }
        if (obraId) { filterParts.push('obraId = :obraId'); expressionAttributeValues[':obraId'] = obraId; }

        const params = {
            TableName: TABLE_NAME,
            IndexName: 'tenantId-index',
            KeyConditionExpression: 'tenantId = :tenantId',
            ExpressionAttributeValues: expressionAttributeValues,
        };
        if (filterParts.length > 0) params.FilterExpression = filterParts.join(' AND ');

        const result = await docClient.send(new QueryCommand(params));

        const requests = (result.Items || [])
            .filter((r) => gestiona(sesion) || participa(r, sesion.personaId))
            .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

        return success({
            requests: await descifrarSolicitudesDeTenant(requests, tenantId),
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
        const ses = conSesion(event);
        if (!ses.ok) return ses.respuesta;
        const sesion = ses.sesion;
        const { id } = event.pathParameters || {};

        if (!id) {
            return error('ID de solicitud requerido');
        }

        const solicitud = await solicitudDeLaEmpresa(id, sesion);
        if (!solicitud || !(gestiona(sesion) || participa(solicitud, sesion.personaId))) {
            return error('Solicitud no encontrada', 404);
        }
        const result = { Item: solicitud };

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

        // Quien no gestiona ve su propia firma, no las de sus compañeros.
        const firmas = (signaturesResult.Items || [])
            .filter((f) => gestiona(sesion) || f.personaId === sesion.personaId);

        return success({
            ...(await descifrarSolicitudDeTenant(result.Item, result.Item?.tenantId)),
            firmasDetalle: firmas,
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
        const ses = conSesion(event);
        if (!ses.ok) return ses.respuesta;
        const sesion = ses.sesion;
        const { workerId } = event.pathParameters || {};

        if (!workerId) {
            return error('ID de trabajador requerido');
        }
        if (!await personaConsultable(workerId, sesion)) return error('Persona no encontrada', 404);

        // Siempre por la empresa de la sesión. Sin `tenantId` en la consulta,
        // esto recorría la tabla de todas las empresas.
        const result = await docClient.send(
            new QueryCommand({
                TableName: TABLE_NAME,
                IndexName: 'tenantId-index',
                KeyConditionExpression: 'tenantId = :tenantId',
                FilterExpression: 'estado IN (:pendiente, :enProceso)',
                ExpressionAttributeValues: {
                    ':tenantId': sesion.tenantId,
                    ':pendiente': 'pendiente',
                    ':enProceso': 'en_proceso',
                },
            })
        );

        // Filtrar las que incluyen al trabajador y no ha firmado.
        // Solicitudes antiguas solo traen workerId en la lista de trabajadores.
        const pendientes = (result.Items || []).filter(request => {
            const trabajador = (request.trabajadores || []).find(t => t.personaId === workerId || t.workerId === workerId);
            return trabajador && !trabajador.firmado;
        }).map(request => ({
            ...request,
            miEstado: 'pendiente',
        }));

        return success({
            pendientes: await descifrarSolicitudesDeTenant(pendientes, sesion.tenantId),
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
        const ses = conSesion(event);
        if (!ses.ok) return ses.respuesta;
        const sesion = ses.sesion;
        const { workerId: inputId } = event.pathParameters || {};
        if (!inputId) return error('ID de persona requerido');
        // Antes devolvía las firmas de cualquier persona de cualquier empresa.
        if (!await personaConsultable(inputId, sesion)) return error('Persona no encontrada', 404);

        // Query por GSI personaId-index
        const signaturesResult = await docClient.send(
            new QueryCommand({
                TableName: SIGNATURES_TABLE,
                IndexName: 'personaId-index',
                KeyConditionExpression: 'personaId = :pid',
                ExpressionAttributeValues: { ':pid': inputId },
            })
        );

        // Una persona con fichas en varias empresas: acá solo lo de esta.
        const firmas = (signaturesResult.Items || []).filter((f) => f.tenantId === sesion.tenantId).sort((a, b) =>
            new Date(b.timestamp) - new Date(a.timestamp)
        );

        const historial = [];
        for (const firma of firmas) {
            if (firma.requestId) {
                const requestResult = await docClient.send(
                    new GetCommand({ TableName: TABLE_NAME, Key: { requestId: firma.requestId } })
                );
                historial.push({ firma, solicitud: esDeLaEmpresa(requestResult.Item, sesion) ? requestResult.Item : null });
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
        const ses = conSesion(event);
        if (!ses.ok) return ses.respuesta;
        const sesion = ses.sesion;
        if (!gestiona(sesion)) return error('No tienes permiso para cancelar solicitudes de firma', 403);
        const { id } = event.pathParameters || {};
        const body = JSON.parse(event.body || '{}');

        if (!id) {
            return error('ID de solicitud requerido');
        }

        // Antes cualquiera cancelaba cualquier solicitud, de cualquier empresa.
        const solicitud = await solicitudDeLaEmpresa(id, sesion);
        if (!solicitud) return error('Solicitud no encontrada', 404);
        const result = { Item: solicitud };

        if (result.Item.estado === 'completada') {
            return error('No se puede cancelar una solicitud completada');
        }

        const now = new Date().toISOString();

        await docClient.send(
            new UpdateCommand({
                TableName: TABLE_NAME,
                Key: { requestId: id },
                UpdateExpression: 'SET estado = :estado, motivoCancelacion = :motivo, canceladaPor = :por, updatedAt = :updatedAt',
                ExpressionAttributeValues: {
                    ':estado': 'cancelada',
                    ':motivo': body.motivo || 'Cancelada por el solicitante',
                    ':por': sesion.personaId,
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
        const ses = conSesion(event);
        if (!ses.ok) return ses.respuesta;
        const sesion = ses.sesion;
        if (!gestiona(sesion)) return error('No tienes permiso para ver estas estadísticas', 403);
        const tenantId = sesion.tenantId;
        const filtroSolicitante = (event.queryStringParameters || {}).solicitante || null;

        const params = {
            TableName: TABLE_NAME,
            IndexName: 'tenantId-index',
            KeyConditionExpression: 'tenantId = :tenantId',
            ExpressionAttributeValues: { ':tenantId': tenantId },
        };

        if (filtroSolicitante) {
            params.FilterExpression = 'solicitanteId = :solicitanteId';
            params.ExpressionAttributeValues[':solicitanteId'] = filtroSolicitante;
        }

        const result = await docClient.send(new QueryCommand(params));
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

        // Actualizar el trabajador en la lista.
        // Solicitudes antiguas solo traen workerId, las nuevas personaId: aceptar ambos
        // (mismo criterio que el find de signatures.create) para que la firma
        // siempre quede asignada al trabajador correcto.
        const trabajadores = (request.trabajadores || []).map(t => {
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
 * `POST /signature-requests/offline-batch` fue eliminado el 19 de septiembre de 2026.
 *
 * Recibía los PIN de varias personas dentro del cuerpo de una sola petición, y
 * decidía la empresa con el `tenantId` que mandara el cliente: las dos cosas que
 * este sistema estuvo cerrando durante dos semanas. Lo reemplaza el vale de un
 * solo uso (`lib/services/ValeFirmaService.js`), donde el dispositivo guarda
 * vales en vez del PIN y la empresa sale de la sesión.
 *
 * Con el hasheo por función de costo, además, se había vuelto caro por diseño:
 * cada firma del lote gastaba ~112 ms de CPU y un lote grande agotaba el tiempo
 * de la función con parte de las firmas ya escritas.
 */
