const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, GetCommand, QueryCommand, ScanCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { SNSClient, PublishCommand } = require('@aws-sdk/client-sns');
const { v4: uuidv4 } = require('uuid');

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const s3Client = new S3Client({});
const snsClient = new SNSClient({});

const INCIDENTS_TABLE = process.env.INCIDENTS_TABLE;
const INCIDENT_EVIDENCE_BUCKET = process.env.INCIDENT_EVIDENCE_BUCKET;
const INCIDENT_NOTIFICATION_TOPIC = process.env.INCIDENT_NOTIFICATION_TOPIC;
const USERS_TABLE = process.env.USERS_TABLE;
const INBOX_TABLE = process.env.INBOX_TABLE;

// Helper para respuestas
const response = (statusCode, body) => ({
    statusCode,
    headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
    },
    body: JSON.stringify(body),
});

const getAccountIdFromContext = (context) => {
    if (process.env.AWS_ACCOUNT_ID) {
        return process.env.AWS_ACCOUNT_ID;
    }

    const arn = context?.invokedFunctionArn || process.env.AWS_LAMBDA_FUNCTION_ARN;
    if (arn) {
        const parts = arn.split(':');
        if (parts.length > 4) {
            return parts[4];
        }
    }
    return null;
};

const buildNotificationTopicArn = (context) => {
    if (process.env.INCIDENT_NOTIFICATION_TOPIC_ARN) {
        return process.env.INCIDENT_NOTIFICATION_TOPIC_ARN;
    }

    if (!INCIDENT_NOTIFICATION_TOPIC) {
        return null;
    }

    const region = process.env.AWS_REGION || 'us-east-1';
    const accountId = getAccountIdFromContext(context);
    if (!accountId) {
        return null;
    }

    return `arn:aws:sns:${region}:${accountId}:${INCIDENT_NOTIFICATION_TOPIC}`;
};

const buildEvidencePreviews = async (keys = []) => {
    if (!Array.isArray(keys) || keys.length === 0) return [];

    const previews = await Promise.all(
        keys.map(async (key) => {
            if (!key) return null;

            try {
                const command = new GetObjectCommand({
                    Bucket: INCIDENT_EVIDENCE_BUCKET,
                    Key: key
                });
                const url = await getSignedUrl(s3Client, command, { expiresIn: 900 });
                return { key, url };
            } catch (error) {
                console.error('Error generando URL de evidencia:', key, error);
                return { key };
            }
        })
    );

    return previews.filter(Boolean);
}
// Helper para obtener prevencionistas
const getPrevencionistas = async (empresaId) => {
    try {
        console.log('[DEBUG] Buscando prevencionistas para empresaId:', empresaId);
        console.log('[DEBUG] USERS_TABLE:', USERS_TABLE);
        console.log('[DEBUG] Filtro: empresaId =', empresaId, 'AND rol = prevencionista AND estado = activo');

        const result = await docClient.send(new ScanCommand({
            TableName: USERS_TABLE,
            FilterExpression: 'empresaId = :empresaId AND rol = :rol AND estado = :estado',
            ExpressionAttributeValues: {
                ':empresaId': empresaId,
                ':rol': 'prevencionista',
                ':estado': 'activo'
            },
            ProjectionExpression: 'userId, nombre, apellido, rol, cargo, empresaId'
        }));

        console.log('[DEBUG] Prevencionistas encontrados:', result.Items?.length || 0);
        console.log('[DEBUG] Prevencionistas:', JSON.stringify(result.Items, null, 2));

        return result.Items || [];
    } catch (error) {
        console.error('[ERROR] Error obteniendo prevencionistas:', error);
        return [];
    }
};

// Helper para enviar notificaciones de incidente a prevencionistas
const sendIncidentNotification = async (incident, prevencionistas) => {
    console.log('[DEBUG] sendIncidentNotification llamado');
    console.log('[DEBUG] INBOX_TABLE:', INBOX_TABLE);
    console.log('[DEBUG] Número de prevencionistas:', prevencionistas?.length || 0);

    if (!prevencionistas || prevencionistas.length === 0) {
        console.log('[WARN] No hay prevencionistas para notificar');
        return;
    }

    const now = new Date().toISOString();
    const baseMessageId = uuidv4();

    // Determinar prioridad basada en gravedad
    let priority = 'normal';
    if (incident.gravedad === 'fatal') {
        priority = 'urgent';
    } else if (incident.gravedad === 'grave') {
        priority = 'high';
    }

    // Crear asunto y contenido del mensaje
    const subject = `Nuevo ${incident.tipo} reportado - ${incident.gravedad}`;
    const content = `Se ha reportado un nuevo ${incident.tipo} en ${incident.centroTrabajo}.

Trabajador: ${incident.trabajador.nombre}
Fecha: ${incident.fecha} ${incident.hora}
Gravedad: ${incident.gravedad}
Descripción: ${incident.descripcion}

Por favor, revise este incidente en el sistema.`;

    // Enviar mensaje a cada prevencionista
    for (const prev of prevencionistas) {
        try {
            const messageId = `${baseMessageId}-${prev.userId.substring(0, 8)}`;
            const message = {
                recipientId: prev.userId,
                messageId,
                senderId: 'sistema',
                senderName: 'Sistema de Incidentes',
                senderRol: 'system',
                type: 'alert',
                priority,
                subject,
                content,
                read: false,
                readAt: null,
                archivedByRecipient: false,
                archivedBySender: false,
                linkedEntity: {
                    type: 'incident',
                    id: incident.incidentId
                },
                createdAt: now,
                updatedAt: now
            };

            await docClient.send(new PutCommand({
                TableName: INBOX_TABLE,
                Item: message
            }));

            console.log(`Notificación enviada a prevencionista: ${prev.nombre} ${prev.apellido || ''}`);
        } catch (error) {
            console.error(`Error enviando notificación a ${prev.userId}:`, error);
        }
    }
};

// CREATE - Crear nuevo incidente
exports.create = async (event, context) => {
    try {
        const data = JSON.parse(event.body);
        const incidentId = uuidv4();
        const now = new Date().toISOString();

        // Validar campos obligatorios
        if (!data.tipo || !data.centroTrabajo || !data.trabajador || !data.descripcion) {
            return response(400, {
                success: false,
                error: 'Faltan campos obligatorios: tipo, centroTrabajo, trabajador, descripcion'
            });
        }

        const incident = {
            incidentId,
            tipo: data.tipo, // 'accidente' | 'incidente' | 'condicion_subestandar'
            centroTrabajo: data.centroTrabajo,
            trabajador: {
                nombre: data.trabajador.nombre,
                rut: data.trabajador.rut,
                genero: data.trabajador.genero || '',
                cargo: data.trabajador.cargo || ''
            },
            fecha: data.fecha || now.split('T')[0],
            hora: data.hora || now.split('T')[1].split('.')[0],
            descripcion: data.descripcion,
            gravedad: data.gravedad || 'leve', // 'leve' | 'grave' | 'fatal'
            diasPerdidos: data.diasPerdidos || 0,
            evidencias: data.evidencias || [], // Array de S3 keys
            documentos: data.documentos || {},
            investigaciones: {
                prevencionista: null,
                jefeDirecto: null,
                comiteParitario: null
            },
            estado: 'reportado', // 'reportado' | 'en_investigacion' | 'cerrado'
            reportadoPor: data.reportadoPor || 'sistema',
            empresaId: data.empresaId || 'default',
            createdAt: now,
            updatedAt: now
        };

        // Guardar en DynamoDB
        await docClient.send(new PutCommand({
            TableName: INCIDENTS_TABLE,
            Item: incident
        }));

        // Enviar notificación SNS
        try {
            const topicArn = buildNotificationTopicArn(context);

            if (!topicArn) {
                console.warn('No se pudo determinar el ARN del tópico SNS para notificaciones de incidentes.');
            } else {
                const message = {
                    incidentId,
                    tipo: incident.tipo,
                    centroTrabajo: incident.centroTrabajo,
                    trabajador: incident.trabajador.nombre,
                    fecha: incident.fecha,
                    gravedad: incident.gravedad,
                    descripcion: incident.descripcion
                };

                await snsClient.send(new PublishCommand({
                    TopicArn: topicArn,
                    Subject: `Nuevo ${incident.tipo} reportado - ${incident.gravedad}`,
                    Message: JSON.stringify(message, null, 2)
                }));
            }
        } catch (snsError) {
            console.error('Error enviando notificación SNS:', snsError);
            // No fallar la creación si SNS falla
        }

        // Enviar notificaciones a prevencionistas vía inbox
        try {
            console.log('[DEBUG] Iniciando envío de notificaciones para incidentId:', incidentId);
            console.log('[DEBUG] empresaId del incidente:', incident.empresaId);

            const prevencionistas = await getPrevencionistas(incident.empresaId);
            console.log('[DEBUG] Prevencionistas obtenidos:', prevencionistas.length);

            await sendIncidentNotification(incident, prevencionistas);
            console.log(`[SUCCESS] Notificaciones enviadas a ${prevencionistas.length} prevencionista(s)`);
        } catch (notifError) {
            console.error('[ERROR] Error enviando notificaciones inbox:', notifError);
            console.error('[ERROR] Stack trace:', notifError.stack);
            // No fallar la creación si las notificaciones fallan
        }

        return response(201, {
            success: true,
            data: incident,
            message: 'Incidente creado exitosamente'
        });

    } catch (error) {
        console.error('Error creando incidente:', error);
        return response(500, {
            success: false,
            error: error.message
        });
    }
};

// LIST - Listar incidentes con filtros
exports.list = async (event) => {
    try {
        const params = event.queryStringParameters || {};
        const empresaId = params.empresaId;
        const tipo = params.tipo;
        const estado = params.estado;
        const fechaInicio = params.fechaInicio;
        const fechaFin = params.fechaFin;

        let items = [];

        // Usar Scan simple para evitar problemas con GSI
        const result = await docClient.send(new ScanCommand({
            TableName: INCIDENTS_TABLE
        }));
        items = result.Items || [];

        // Filtrar por empresaId si se proporciona
        if (empresaId) {
            items = items.filter(item => item.empresaId === empresaId);
        }

        // Filtros adicionales
        if (tipo) {
            items = items.filter(item => item.tipo === tipo);
        }
        if (estado) {
            items = items.filter(item => item.estado === estado);
        }
        if (fechaFin) {
            items = items.filter(item => item.fecha <= fechaFin);
        }

        // Ordenar por fecha descendente
        items.sort((a, b) => new Date(b.fecha) - new Date(a.fecha));

        return response(200, {
            success: true,
            data: items,
            total: items.length
        });

    } catch (error) {
        console.error('Error listando incidentes:', error);
        return response(500, {
            success: false,
            error: error.message
        });
    }
};

// GET - Obtener incidente por ID
exports.get = async (event) => {
    try {
        const { id } = event.pathParameters;

        const result = await docClient.send(new GetCommand({
            TableName: INCIDENTS_TABLE,
            Key: { incidentId: id }
        }));

        if (!result.Item) {
            return response(404, {
                success: false,
                error: 'Incidente no encontrado'
            });
        }

        const incident = result.Item;
        const evidencePreviews = await buildEvidencePreviews(incident.evidencias || []);

        return response(200, {
            success: true,
            data: {
                ...incident,
                evidencePreviews
            }
        });

    } catch (error) {
        console.error('Error obteniendo incidente:', error);
        return response(500, {
            success: false,
            error: error.message
        });
    }
};

// UPDATE - Actualizar incidente (investigaciones, estado, etc)
exports.update = async (event) => {
    try {
        const { id } = event.pathParameters;
        const data = JSON.parse(event.body);
        const now = new Date().toISOString();

        // Construir expresión de actualización
        let updateExpression = 'SET updatedAt = :updatedAt';
        const expressionAttributeValues = {
            ':updatedAt': now
        };

        if (data.estado) {
            updateExpression += ', estado = :estado';
            expressionAttributeValues[':estado'] = data.estado;
        }

        if (data.investigacionPrevencionista) {
            updateExpression += ', investigaciones.prevencionista = :invPrev';
            expressionAttributeValues[':invPrev'] = {
                ...data.investigacionPrevencionista,
                fecha: now
            };
        }

        if (data.investigacionJefeDirecto) {
            updateExpression += ', investigaciones.jefeDirecto = :invJefe';
            expressionAttributeValues[':invJefe'] = {
                ...data.investigacionJefeDirecto,
                fecha: now
            };
        }

        if (data.investigacionComiteParitario) {
            updateExpression += ', investigaciones.comiteParitario = :invComite';
            expressionAttributeValues[':invComite'] = {
                ...data.investigacionComiteParitario,
                fecha: now
            };
        }

        if (data.diasPerdidos !== undefined) {
            updateExpression += ', diasPerdidos = :diasPerdidos';
            expressionAttributeValues[':diasPerdidos'] = data.diasPerdidos;
        }

        if (data.documentos) {
            updateExpression += ', documentos = :documentos';
            expressionAttributeValues[':documentos'] = data.documentos;
        }

        if (data.evidencias) {
            updateExpression += ', evidencias = :evidencias';
            expressionAttributeValues[':evidencias'] = data.evidencias;
        }

        const result = await docClient.send(new UpdateCommand({
            TableName: INCIDENTS_TABLE,
            Key: { incidentId: id },
            UpdateExpression: updateExpression,
            ExpressionAttributeValues: expressionAttributeValues,
            ReturnValues: 'ALL_NEW'
        }));

        return response(200, {
            success: true,
            data: result.Attributes,
            message: 'Incidente actualizado exitosamente'
        });

    } catch (error) {
        console.error('Error actualizando incidente:', error);
        return response(500, {
            success: false,
            error: error.message
        });
    }
};

// UPLOAD EVIDENCE - Generar URL presignada para subir evidencia
exports.uploadEvidence = async (event) => {
    try {
        const data = JSON.parse(event.body);
        const { fileName, fileType, incidentId } = data;

        if (!fileName || !fileType) {
            return response(400, {
                success: false,
                error: 'fileName y fileType son requeridos'
            });
        }

        // Generar key único para S3
        const fileExtension = fileName.split('.').pop();
        const s3Key = `${incidentId || 'temp'}/${uuidv4()}.${fileExtension}`;

        // Generar URL presignada
        const command = new PutObjectCommand({
            Bucket: INCIDENT_EVIDENCE_BUCKET,
            Key: s3Key,
            ContentType: fileType
        });

        const uploadUrl = await getSignedUrl(s3Client, command, { expiresIn: 3600 });

        return response(200, {
            success: true,
            data: {
                uploadUrl,
                s3Key,
                fileUrl: `https://${INCIDENT_EVIDENCE_BUCKET}.s3.amazonaws.com/${s3Key}`
            }
        });

    } catch (error) {
        console.error('Error generando URL de upload:', error);
        return response(500, {
            success: false,
            error: error.message
        });
    }
};

// GET STATS - Obtener estadísticas automáticas
exports.getStats = async (event) => {
    try {
        const params = event.queryStringParameters || {};
        const empresaId = params.empresaId;
        const mes = params.mes || new Date().toISOString().slice(0, 7); // YYYY-MM
        const masaLaboral = parseInt(params.masaLaboral) || 100; // Número de trabajadores

        // Obtener todos los incidentes del mes
        let items = [];

        // Usar Scan simple para evitar problemas con GSI
        const result = await docClient.send(new ScanCommand({
            TableName: INCIDENTS_TABLE
        }));
        items = result.Items || [];

        // Filtrar por empresaId y mes
        if (empresaId) {
            items = items.filter(item => item.empresaId === empresaId);
        }
        items = items.filter(item => item.fecha && item.fecha.startsWith(mes));

        // Calcular métricas
        const accidentes = items.filter(i => i.tipo === 'accidente');
        const numAccidentes = accidentes.length;
        const diasPerdidos = accidentes.reduce((sum, acc) => sum + (acc.diasPerdidos || 0), 0);

        // Tasa de accidentabilidad = (Nº accidentes / masa laboral) * 100
        const tasaAccidentabilidad = masaLaboral > 0 ? (numAccidentes / masaLaboral) * 100 : 0;

        // Siniestralidad = (Días perdidos / masa laboral) * 100
        const siniestralidad = masaLaboral > 0 ? (diasPerdidos / masaLaboral) * 100 : 0;

        // Tasa de frecuencia = (Nº accidentes / Horas trabajadas) * 1,000,000
        // Asumiendo 8 horas/día, 22 días/mes
        const horasTrabajadas = masaLaboral * 8 * 22;
        const tasaFrecuencia = horasTrabajadas > 0 ? (numAccidentes / horasTrabajadas) * 1000000 : 0;

        // Estadísticas por tipo
        const porTipo = {
            accidentes: items.filter(i => i.tipo === 'accidente').length,
            incidentes: items.filter(i => i.tipo === 'incidente').length,
            condicionesSubestandar: items.filter(i => i.tipo === 'condicion_subestandar').length
        };

        // Estadísticas por gravedad
        const porGravedad = {
            leve: accidentes.filter(a => a.gravedad === 'leve').length,
            grave: accidentes.filter(a => a.gravedad === 'grave').length,
            fatal: accidentes.filter(a => a.gravedad === 'fatal').length
        };

        return response(200, {
            success: true,
            data: {
                mes,
                masaLaboral,
                numeroAccidentes: numAccidentes,
                diasPerdidos,
                tasaAccidentabilidad: parseFloat(tasaAccidentabilidad.toFixed(2)),
                siniestralidad: parseFloat(siniestralidad.toFixed(2)),
                tasaFrecuencia: parseFloat(tasaFrecuencia.toFixed(2)),
                porTipo,
                porGravedad,
                totalIncidentes: items.length
            }
        });

    } catch (error) {
        console.error('Error calculando estadísticas:', error);
        return response(500, {
            success: false,
            error: error.message
        });
    }
};

// ADD INVESTIGATION - Agregar investigación a un incidente
exports.addInvestigation = async (event) => {
    try {
        const { id } = event.pathParameters;
        const data = JSON.parse(event.body);
        const now = new Date().toISOString();

        // Validar campos requeridos
        if (!data.tipo || !data.hallazgos || !data.recomendaciones || !data.medidas) {
            return response(400, {
                success: false,
                error: 'Campos requeridos: tipo, hallazgos, recomendaciones, medidas'
            });
        }

        // Validar tipo de investigación
        const tiposValidos = ['prevencionista', 'jefe_directo', 'comite_paritario'];
        if (!tiposValidos.includes(data.tipo)) {
            return response(400, {
                success: false,
                error: `Tipo de investigación inválido. Valores válidos: ${tiposValidos.join(', ')}`
            });
        }

        // Mapear tipo a campo de DynamoDB
        const campoInvestigacion = {
            'prevencionista': 'prevencionista',
            'jefe_directo': 'jefeDirecto',
            'comite_paritario': 'comiteParitario'
        }[data.tipo];

        const investigation = {
            investigador: data.investigador || 'sistema',
            rolInvestigador: data.tipo,
            fecha: now,
            hallazgos: data.hallazgos,
            recomendaciones: data.recomendaciones,
            medidas: data.medidas,
            estado: 'completada'
        };

        // Actualizar incidente con la nueva investigación
        const updateExpression = `SET investigaciones.${campoInvestigacion} = :investigation, estado = :estado, updatedAt = :updatedAt`;

        const result = await docClient.send(new UpdateCommand({
            TableName: INCIDENTS_TABLE,
            Key: { incidentId: id },
            UpdateExpression: updateExpression,
            ExpressionAttributeValues: {
                ':investigation': investigation,
                ':estado': 'en_investigacion',
                ':updatedAt': now
            },
            ReturnValues: 'ALL_NEW'
        }));

        return response(200, {
            success: true,
            data: result.Attributes,
            message: 'Investigación agregada exitosamente',
            investigation
        });

    } catch (error) {
        console.error('Error agregando investigación:', error);
        return response(500, {
            success: false,
            error: error.message
        });
    }
};

// UPLOAD DOCUMENT - Generar URL presignada para subir documentos DIAT/DIEP
exports.uploadDocument = async (event) => {
    try {
        const { id } = event.pathParameters;
        const data = JSON.parse(event.body);
        const { fileName, fileType, documentType } = data;

        if (!fileName || !fileType || !documentType) {
            return response(400, {
                success: false,
                error: 'fileName, fileType y documentType son requeridos'
            });
        }

        // Validar tipo de documento
        const tiposValidos = ['diat', 'diep'];
        if (!tiposValidos.includes(documentType)) {
            return response(400, {
                success: false,
                error: `Tipo de documento inválido. Valores válidos: ${tiposValidos.join(', ')}`
            });
        }

        // Generar key único para S3
        const fileExtension = fileName.split('.').pop();
        const s3Key = `${id}/documents/${documentType}-${uuidv4()}.${fileExtension}`;

        // Generar URL presignada
        const command = new PutObjectCommand({
            Bucket: INCIDENT_EVIDENCE_BUCKET,
            Key: s3Key,
            ContentType: fileType
        });

        const uploadUrl = await getSignedUrl(s3Client, command, { expiresIn: 3600 });

        // Actualizar incidente con referencia al documento
        const now = new Date().toISOString();
        await docClient.send(new UpdateCommand({
            TableName: INCIDENTS_TABLE,
            Key: { incidentId: id },
            UpdateExpression: `SET documentos.${documentType} = :docInfo, updatedAt = :updatedAt`,
            ExpressionAttributeValues: {
                ':docInfo': {
                    s3Key,
                    fileName,
                    fileType,
                    uploadedAt: now
                },
                ':updatedAt': now
            }
        }));

        return response(200, {
            success: true,
            data: {
                uploadUrl,
                s3Key,
                documentType
            }
        });

    } catch (error) {
        console.error('Error generando URL de documento:', error);
        return response(500, {
            success: false,
            error: error.message
        });
    }
};

// GET DOCUMENTS - Obtener documentos del incidente
exports.getDocuments = async (event) => {
    try {
        const { id } = event.pathParameters;

        const result = await docClient.send(new GetCommand({
            TableName: INCIDENTS_TABLE,
            Key: { incidentId: id }
        }));

        if (!result.Item) {
            return response(404, {
                success: false,
                error: 'Incidente no encontrado'
            });
        }

        const documents = [];
        const incident = result.Item;

        // Generar URLs de descarga para documentos existentes
        if (incident.documentos) {
            for (const [docType, docInfo] of Object.entries(incident.documentos)) {
                if (docInfo && docInfo.s3Key) {
                    documents.push({
                        documentType: docType,
                        ...docInfo,
                        url: `https://${INCIDENT_EVIDENCE_BUCKET}.s3.amazonaws.com/${docInfo.s3Key}`
                    });
                }
            }
        }

        return response(200, {
            success: true,
            data: { documents }
        });

    } catch (error) {
        console.error('Error obteniendo documentos:', error);
        return response(500, {
            success: false,
            error: error.message
        });
    }
};

// GET ANALYTICS - Obtener analíticas avanzadas
exports.getAnalytics = async (event) => {
    try {
        const params = event.queryStringParameters || {};
        const empresaId = params.empresaId;
        const fechaInicio = params.fechaInicio;
        const fechaFin = params.fechaFin || new Date().toISOString().split('T')[0];

        // Obtener todos los incidentes
        const result = await docClient.send(new ScanCommand({
            TableName: INCIDENTS_TABLE
        }));
        let items = result.Items || [];

        // Filtros
        if (empresaId) {
            items = items.filter(item => item.empresaId === empresaId);
        }
        if (fechaInicio) {
            items = items.filter(item => item.fecha >= fechaInicio);
        }
        if (fechaFin) {
            items = items.filter(item => item.fecha <= fechaFin);
        }

        // Distribución por tipo
        const distribucionPorTipo = {
            accidentes: items.filter(i => i.tipo === 'accidente').length,
            incidentes: items.filter(i => i.tipo === 'incidente').length,
            condicionesSubestandar: items.filter(i => i.tipo === 'condicion_subestandar').length
        };

        // Distribución por gravedad (solo accidentes)
        const accidentes = items.filter(i => i.tipo === 'accidente');
        const distribucionPorGravedad = {
            leve: accidentes.filter(a => a.gravedad === 'leve').length,
            grave: accidentes.filter(a => a.gravedad === 'grave').length,
            fatal: accidentes.filter(a => a.gravedad === 'fatal').length
        };

        // Tendencias por mes (últimos 6 meses)
        const tendencias = [];
        const ahora = new Date();
        for (let i = 5; i >= 0; i--) {
            const mes = new Date(ahora.getFullYear(), ahora.getMonth() - i, 1);
            const mesStr = mes.toISOString().slice(0, 7); // YYYY-MM
            const itemsMes = items.filter(item => item.fecha && item.fecha.startsWith(mesStr));

            tendencias.push({
                mes: mesStr,
                total: itemsMes.length,
                accidentes: itemsMes.filter(i => i.tipo === 'accidente').length,
                incidentes: itemsMes.filter(i => i.tipo === 'incidente').length
            });
        }

        // Por centro de trabajo
        const centrosMap = {};
        items.forEach(item => {
            const centro = item.centroTrabajo || 'Sin especificar';
            if (!centrosMap[centro]) {
                centrosMap[centro] = { total: 0 };
            }
            centrosMap[centro].total++;
        });

        const porCentroTrabajo = Object.entries(centrosMap).map(([centro, data]) => ({
            centro,
            total: data.total,
            tasa: items.length > 0 ? ((data.total / items.length) * 100).toFixed(2) : 0
        }));

        return response(200, {
            success: true,
            data: {
                periodo: `${fechaInicio || 'inicio'} - ${fechaFin}`,
                distribucionPorTipo,
                distribucionPorGravedad,
                tendencias,
                porCentroTrabajo,
                totalIncidentes: items.length
            }
        });

    } catch (error) {
        console.error('Error calculando analíticas:', error);
        return response(500, {
            success: false,
            error: error.message
        });
    }
};

// QUICK REPORT - Reporte rápido desde QR público
exports.quickReport = async (event) => {
    try {
        const data = JSON.parse(event.body);
        const incidentId = uuidv4();
        const now = new Date().toISOString();

        // Validar campos requeridos
        if (!data.tipo || !data.centroTrabajo || !data.descripcion) {
            return response(400, {
                success: false,
                error: 'Campos requeridos: tipo, centroTrabajo, descripcion'
            });
        }

        const incident = {
            incidentId,
            tipo: data.tipo,
            clasificacion: data.clasificacion || 'hallazgo',
            tipoHallazgo: data.tipoHallazgo || 'condicion',
            etapaConstructiva: data.etapaConstructiva || '',
            centroTrabajo: data.centroTrabajo,
            trabajador: {
                nombre: data.reportadoPor || 'Reporte Anónimo',
                rut: '',
                genero: '',
                cargo: ''
            },
            fecha: now.split('T')[0],
            hora: now.split('T')[1].split('.')[0],
            descripcion: data.descripcion,
            gravedad: data.gravedad || 'leve',
            diasPerdidos: 0,
            evidencias: data.evidencias || [],
            documentos: {},
            investigaciones: {
                prevencionista: null,
                jefeDirecto: null,
                comiteParitario: null
            },
            estado: 'reportado',
            reportadoPor: data.reportadoPor || 'QR-Publico',
            qrToken: data.qrToken || null,
            firmaConfirmacion: data.firmaConfirmacion || null,
            empresaId: data.empresaId || 'default',
            origenReporte: 'qr_publico',
            createdAt: now,
            updatedAt: now
        };

        // Guardar en DynamoDB
        await docClient.send(new PutCommand({
            TableName: INCIDENTS_TABLE,
            Item: incident
        }));

        // Intentar notificación SNS
        try {
            const message = {
                incidentId,
                tipo: incident.tipo,
                centroTrabajo: incident.centroTrabajo,
                descripcion: incident.descripcion,
                origenReporte: 'qr_publico'
            };

            await snsClient.send(new PublishCommand({
                TopicArn: `arn:aws:sns:${process.env.AWS_REGION || 'us-east-1'}:${process.env.AWS_ACCOUNT_ID || ''}:${INCIDENT_NOTIFICATION_TOPIC}`,
                Subject: `Nuevo reporte QR: ${incident.tipo}`,
                Message: JSON.stringify(message, null, 2)
            }));
        } catch (snsError) {
            console.error('Error enviando notificación SNS:', snsError);
        }

        // Enviar notificaciones a prevencionistas vía inbox
        try {
            const prevencionistas = await getPrevencionistas(incident.empresaId);
            await sendIncidentNotification(incident, prevencionistas);
            console.log(`Notificaciones enviadas a ${prevencionistas.length} prevencionista(s)`);
        } catch (notifError) {
            console.error('Error enviando notificaciones inbox:', notifError);
            // No fallar la creación si las notificaciones fallan
        }

        return response(201, {
            success: true,
            incidentId,
            message: 'Reporte creado exitosamente'
        });

    } catch (error) {
        console.error('Error creando reporte rápido:', error);
        return response(500, {
            success: false,
            error: error.message
        });
    }
};
