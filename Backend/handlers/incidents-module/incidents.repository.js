const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, GetCommand, ScanCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { SNSClient, PublishCommand } = require('@aws-sdk/client-sns');
const { v4: uuidv4 } = require('uuid');

class IncidentsRepository {
    constructor() {
        // Inicialización simple como en incidents.js
        const dynamoClient = new DynamoDBClient({});
        this.dynamo = DynamoDBDocumentClient.from(dynamoClient);
        this.s3 = new S3Client({});
        this.sns = new SNSClient({});

        this.incidentsTable = process.env.INCIDENTS_TABLE;
        this.incidentEvidenceBucket = process.env.INCIDENT_EVIDENCE_BUCKET;
        this.usersTable = process.env.USERS_TABLE;
        this.inboxTable = process.env.INBOX_TABLE;

        console.log('IncidentsRepository initialized with table:', this.incidentsTable);
    }

    // Helper functions converted to methods
    getAccountIdFromContext(context) {
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
    }

    buildNotificationTopicArn(context) {
        if (process.env.INCIDENT_NOTIFICATION_TOPIC_ARN) {
            return process.env.INCIDENT_NOTIFICATION_TOPIC_ARN;
        }
        const topicName = process.env.INCIDENT_NOTIFICATION_TOPIC;
        if (!topicName) {
            return null;
        }
        const region = process.env.AWS_REGION || 'us-east-1';
        const accountId = this.getAccountIdFromContext(context);
        if (!accountId) {
            return null;
        }
        return `arn:aws:sns:${region}:${accountId}:${topicName}`;
    }

    async buildEvidencePreviews(keys = []) {
        if (!Array.isArray(keys) || keys.length === 0) return [];

        const previews = await Promise.all(
            keys.map(async (key) => {
                if (!key) return null;
                try {
                    const command = new GetObjectCommand({
                        Bucket: this.incidentEvidenceBucket,
                        Key: key
                    });
                    const url = await getSignedUrl(this.s3, command, { expiresIn: 900 });
                    return { key, url };
                } catch (error) {
                    console.error('Error generando URL de evidencia:', key, error);
                    return { key };
                }
            })
        );
        return previews.filter(Boolean);
    }

    async getPrevencionistas(empresaId) {
        try {
            console.log('[DEBUG] Buscando prevencionistas para empresaId:', empresaId);
            const result = await this.dynamo.send(new ScanCommand({
                TableName: this.usersTable,
                FilterExpression: 'empresaId = :empresaId AND rol = :rol AND estado = :estado',
                ExpressionAttributeValues: {
                    ':empresaId': empresaId,
                    ':rol': 'prevencionista',
                    ':estado': 'activo'
                },
                ProjectionExpression: 'userId, nombre, apellido, rol, cargo, empresaId'
            }));
            console.log('[DEBUG] Prevencionistas encontrados:', result.Items?.length || 0);
            return result.Items || [];
        } catch (error) {
            console.error('[ERROR] Error obteniendo prevencionistas:', error);
            return [];
        }
    }

    async sendIncidentNotification(incident, prevencionistas) {
        console.log('[DEBUG] sendIncidentNotification llamado');
        if (!prevencionistas || prevencionistas.length === 0) {
            console.log('[WARN] No hay prevencionistas para notificar');
            return;
        }

        const now = new Date().toISOString();
        const baseMessageId = uuidv4();
        let priority = 'normal';
        if (incident.gravedad === 'fatal') priority = 'urgent';
        else if (incident.gravedad === 'grave') priority = 'high';

        const subject = `Nuevo ${incident.tipo} reportado - ${incident.gravedad}`;
        const content = `Se ha reportado un nuevo ${incident.tipo} en ${incident.centroTrabajo}.\n\nTrabajador: ${incident.trabajador.nombre}\nFecha: ${incident.fecha} ${incident.hora}\nGravedad: ${incident.gravedad}\nDescripción: ${incident.descripcion}\n\nPor favor, revise este incidente en el sistema.`;

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

                await this.dynamo.send(new PutCommand({
                    TableName: this.inboxTable,
                    Item: message
                }));
                console.log(`Notificación enviada a prevencionista: ${prev.nombre} ${prev.apellido || ''}`);
            } catch (error) {
                console.error(`Error enviando notificación a ${prev.userId}:`, error);
            }
        }
    }

    // CREATE
    async create(data, context) {
        console.log('[CREATE] Repo.create called with data:', JSON.stringify(data));
        const incidentId = uuidv4();
        const now = new Date().toISOString();

        // Strict validation
        if (!data.tipo || !data.centroTrabajo || !data.trabajador || !data.descripcion) {
            console.error('[CREATE] Validation failed - missing required fields');
            throw new Error('Faltan campos obligatorios: tipo, centroTrabajo, trabajador, descripcion');
        }

        // Additional validation to prevent empty data
        if (!data.trabajador.nombre || data.trabajador.nombre.trim() === '') {
            console.error('[CREATE] Validation failed - empty worker name');
            throw new Error('El nombre del trabajador es requerido');
        }

        if (data.descripcion.trim() === '') {
            console.error('[CREATE] Validation failed - empty description');
            throw new Error('La descripción es requerida');
        }

        const incident = {
            incidentId,
            tipo: data.tipo,
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
            gravedad: data.gravedad || 'leve',
            diasPerdidos: data.diasPerdidos || 0,
            evidencias: data.evidencias || [],
            documentos: data.documentos || {},
            investigaciones: {
                prevencionista: null,
                jefeDirecto: null,
                comiteParitario: null
            },
            estado: 'reportado',
            reportadoPor: data.reportadoPor || 'sistema',
            empresaId: data.empresaId || 'default',
            viewedBy: [], // Track who has seen the incident
            createdAt: now,
            updatedAt: now
        };

        await this.dynamo.send(new PutCommand({
            TableName: this.incidentsTable,
            Item: incident
        }));

        // SNS Notification
        try {
            const topicArn = this.buildNotificationTopicArn(context);
            if (!topicArn) {
                console.warn('No se pudo determinar el ARN del tópico SNS');
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
                await this.sns.send(new PublishCommand({
                    TopicArn: topicArn,
                    Subject: `Nuevo ${incident.tipo} reportado - ${incident.gravedad}`,
                    Message: JSON.stringify(message, null, 2)
                }));
            }
        } catch (snsError) {
            console.error('Error enviando notificación SNS:', snsError);
        }

        // Inbox Notification
        try {
            const prevencionistas = await this.getPrevencionistas(incident.empresaId);
            await this.sendIncidentNotification(incident, prevencionistas);
        } catch (notifError) {
            console.error('[ERROR] Error enviando notificaciones inbox:', notifError);
        }

        return {
            incident,
            message: 'Incidente creado exitosamente'
        };
    }

    // LIST
    async list({ empresaId, tipo, estado, fechaInicio, fechaFin }) {
        console.log('Repo.list called');
        let items = [];

        // Scan simple
        const result = await this.dynamo.send(new ScanCommand({
            TableName: this.incidentsTable
        }));
        items = result.Items || [];

        if (empresaId) items = items.filter(item => item.empresaId === empresaId);
        if (tipo) items = items.filter(item => item.tipo === tipo);
        if (estado) items = items.filter(item => item.estado === estado);
        if (fechaFin) items = items.filter(item => item.fecha <= fechaFin);

        items.sort((a, b) => new Date(b.fecha) - new Date(a.fecha));

        return {
            items,
            total: items.length
        };
    }

    // GET
    async get(id) {
        console.log('[GET] Repo.get called for ID:', id);
        const result = await this.dynamo.send(new GetCommand({
            TableName: this.incidentsTable,
            Key: { incidentId: id }
        }));

        if (!result.Item) {
            console.error('[GET] Incident not found:', id);
            throw new Error('Incidente no encontrado');
        }

        const incident = result.Item;
        console.log('[GET] Building evidence previews for', (incident.evidencias || []).length, 'items');
        const evidencePreviews = await this.buildEvidencePreviews(incident.evidencias || []);
        console.log('[GET] Evidence previews built:', evidencePreviews.length);

        return {
            ...incident,
            evidencePreviews
        };
    }

    // UPDATE
    async update(id, data) {
        console.log('[UPDATE] Repo.update called for ID:', id, 'with data:', JSON.stringify(data));
        const now = new Date().toISOString();
        let updateExpression = 'SET updatedAt = :updatedAt';
        const expressionAttributeValues = { ':updatedAt': now };

        if (data.estado) {
            updateExpression += ', estado = :estado';
            expressionAttributeValues[':estado'] = data.estado;
        }
        if (data.investigacionPrevencionista) {
            updateExpression += ', investigaciones.prevencionista = :invPrev';
            expressionAttributeValues[':invPrev'] = { ...data.investigacionPrevencionista, fecha: now };
        }
        if (data.investigacionJefeDirecto) {
            updateExpression += ', investigaciones.jefeDirecto = :invJefe';
            expressionAttributeValues[':invJefe'] = { ...data.investigacionJefeDirecto, fecha: now };
        }
        if (data.investigacionComiteParitario) {
            updateExpression += ', investigaciones.comiteParitario = :invComite';
            expressionAttributeValues[':invComite'] = { ...data.investigacionComiteParitario, fecha: now };
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

        const result = await this.dynamo.send(new UpdateCommand({
            TableName: this.incidentsTable,
            Key: { incidentId: id },
            UpdateExpression: updateExpression,
            ExpressionAttributeValues: expressionAttributeValues,
            ReturnValues: 'ALL_NEW'
        }));

        return {
            incident: result.Attributes,
            message: 'Incidente actualizado exitosamente'
        };
    }

    // UPLOAD EVIDENCE
    async uploadEvidence({ fileName, fileType, incidentId }) {
        console.log('[UPLOAD_EVIDENCE] Called with:', { fileName, fileType, incidentId });
        if (!fileName || !fileType) {
            throw new Error('fileName y fileType son requeridos');
        }

        const fileExtension = fileName.split('.').pop();
        const s3Key = `${incidentId || 'temp'}/${uuidv4()}.${fileExtension}`;

        const command = new PutObjectCommand({
            Bucket: this.incidentEvidenceBucket,
            Key: s3Key,
            ContentType: fileType
        });
        const uploadUrl = await getSignedUrl(this.s3, command, { expiresIn: 3600 });

        return {
            uploadUrl,
            s3Key,
            fileUrl: `https://${this.incidentEvidenceBucket}.s3.amazonaws.com/${s3Key}`
        };
    }

    // GET STATS
    async getStats({ empresaId, mes, masaLaboral }) {
        mes = mes || new Date().toISOString().slice(0, 7);
        masaLaboral = parseInt(masaLaboral) || 100;

        let items = [];
        const result = await this.dynamo.send(new ScanCommand({
            TableName: this.incidentsTable
        }));
        items = result.Items || [];

        if (empresaId) items = items.filter(item => item.empresaId === empresaId);
        items = items.filter(item => item.fecha && item.fecha.startsWith(mes));

        const accidentes = items.filter(i => i.tipo === 'accidente');
        const numAccidentes = accidentes.length;
        const diasPerdidos = accidentes.reduce((sum, acc) => sum + (acc.diasPerdidos || 0), 0);
        const tasaAccidentabilidad = masaLaboral > 0 ? (numAccidentes / masaLaboral) * 100 : 0;
        const siniestralidad = masaLaboral > 0 ? (diasPerdidos / masaLaboral) * 100 : 0;
        const horasTrabajadas = masaLaboral * 8 * 22;
        const tasaFrecuencia = horasTrabajadas > 0 ? (numAccidentes / horasTrabajadas) * 1000000 : 0;

        const porTipo = {
            accidentes: items.filter(i => i.tipo === 'accidente').length,
            incidentes: items.filter(i => i.tipo === 'incidente').length,
            condicionesSubestandar: items.filter(i => i.tipo === 'condicion_subestandar').length
        };
        const porGravedad = {
            leve: accidentes.filter(a => a.gravedad === 'leve').length,
            grave: accidentes.filter(a => a.gravedad === 'grave').length,
            fatal: accidentes.filter(a => a.gravedad === 'fatal').length
        };

        return {
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
        };
    }

    // ADD INVESTIGATION
    async addInvestigation(id, data) {
        if (!id) throw new Error('ID de incidente requerido');
        const now = new Date().toISOString();

        if (!data.tipo || !data.hallazgos || !data.recomendaciones || !data.medidas) {
            throw new Error('Campos requeridos: tipo, hallazgos, recomendaciones, medidas');
        }
        const tiposValidos = ['prevencionista', 'jefe_directo', 'comite_paritario'];
        if (!tiposValidos.includes(data.tipo)) {
            throw new Error(`Tipo de investigación inválido. Valores válidos: ${tiposValidos.join(', ')}`);
        }
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

        const result = await this.dynamo.send(new UpdateCommand({
            TableName: this.incidentsTable,
            Key: { incidentId: id },
            UpdateExpression: `SET investigaciones.${campoInvestigacion} = :investigation, estado = :estado, updatedAt = :updatedAt`,
            ExpressionAttributeValues: {
                ':investigation': investigation,
                ':estado': 'en_investigacion',
                ':updatedAt': now
            },
            ReturnValues: 'ALL_NEW'
        }));

        return {
            incident: result.Attributes,
            message: 'Investigación agregada exitosamente',
            investigation
        };
    }

    // UPLOAD DOCUMENT
    async uploadDocument(id, data) {
        if (!id) throw new Error('ID de incidente requerido');
        const { fileName, fileType, documentType } = data;
        if (!fileName || !fileType || !documentType) {
            throw new Error('fileName, fileType y documentType son requeridos');
        }
        const tiposValidos = ['diat', 'diep'];
        if (!tiposValidos.includes(documentType)) {
            throw new Error(`Tipo de documento inválido. Valores válidos: ${tiposValidos.join(', ')}`);
        }

        const fileExtension = fileName.split('.').pop();
        const s3Key = `${id}/documents/${documentType}-${uuidv4()}.${fileExtension}`;
        const command = new PutObjectCommand({
            Bucket: this.incidentEvidenceBucket,
            Key: s3Key,
            ContentType: fileType
        });
        const uploadUrl = await getSignedUrl(this.s3, command, { expiresIn: 3600 });
        const now = new Date().toISOString();

        await this.dynamo.send(new UpdateCommand({
            TableName: this.incidentsTable,
            Key: { incidentId: id },
            UpdateExpression: `SET documentos.${documentType} = :docInfo, updatedAt = :updatedAt`,
            ExpressionAttributeValues: {
                ':docInfo': { s3Key, fileName, fileType, uploadedAt: now },
                ':updatedAt': now
            }
        }));

        return { uploadUrl, s3Key, documentType };
    }

    // GET DOCUMENTS
    async getDocuments(id) {
        if (!id) throw new Error('ID de incidente requerido');
        const result = await this.dynamo.send(new GetCommand({
            TableName: this.incidentsTable,
            Key: { incidentId: id }
        }));
        if (!result.Item) throw new Error('Incidente no encontrado');

        const documents = [];
        const incident = result.Item;
        if (incident.documentos) {
            for (const [docType, docInfo] of Object.entries(incident.documentos)) {
                if (docInfo && docInfo.s3Key) {
                    documents.push({
                        documentType: docType,
                        ...docInfo,
                        url: `https://${this.incidentEvidenceBucket}.s3.amazonaws.com/${docInfo.s3Key}`
                    });
                }
            }
        }
        return { documents };
    }

    // GET ANALYTICS
    async getAnalytics({ empresaId, fechaInicio, fechaFin }) {
        fechaFin = fechaFin || new Date().toISOString().split('T')[0];
        const result = await this.dynamo.send(new ScanCommand({
            TableName: this.incidentsTable
        }));
        let items = result.Items || [];

        if (empresaId) items = items.filter(item => item.empresaId === empresaId);
        if (fechaInicio) items = items.filter(item => item.fecha >= fechaInicio);
        if (fechaFin) items = items.filter(item => item.fecha <= fechaFin);

        const distribucionPorTipo = {
            accidentes: items.filter(i => i.tipo === 'accidente').length,
            incidentes: items.filter(i => i.tipo === 'incidente').length,
            condicionesSubestandar: items.filter(i => i.tipo === 'condicion_subestandar').length
        };
        const accidentes = items.filter(i => i.tipo === 'accidente');
        const distribucionPorGravedad = {
            leve: accidentes.filter(a => a.gravedad === 'leve').length,
            grave: accidentes.filter(a => a.gravedad === 'grave').length,
            fatal: accidentes.filter(a => a.gravedad === 'fatal').length
        };

        const tendencias = [];
        const ahora = new Date();
        for (let i = 5; i >= 0; i--) {
            const mes = new Date(ahora.getFullYear(), ahora.getMonth() - i, 1);
            const mesStr = mes.toISOString().slice(0, 7);
            const itemsMes = items.filter(item => item.fecha && item.fecha.startsWith(mesStr));
            tendencias.push({
                mes: mesStr,
                total: itemsMes.length,
                accidentes: itemsMes.filter(j => j.tipo === 'accidente').length,
                incidentes: itemsMes.filter(j => j.tipo === 'incidente').length
            });
        }

        const centrosMap = {};
        items.forEach(item => {
            const centro = item.centroTrabajo || 'Sin especificar';
            if (!centrosMap[centro]) centrosMap[centro] = { total: 0 };
            centrosMap[centro].total++;
        });

        const porCentroTrabajo = Object.entries(centrosMap).map(([centro, data]) => ({
            centro,
            total: data.total,
            tasa: items.length > 0 ? ((data.total / items.length) * 100).toFixed(2) : 0
        }));

        return {
            periodo: `${fechaInicio || 'inicio'} - ${fechaFin}`,
            distribucionPorTipo,
            distribucionPorGravedad,
            tendencias,
            porCentroTrabajo,
            totalIncidentes: items.length
        };
    }

    // QUICK REPORT
    async quickReport(data) {
        const incidentId = uuidv4();
        const now = new Date().toISOString();
        if (!data.tipo || !data.centroTrabajo || !data.descripcion) {
            throw new Error('Campos requeridos: tipo, centroTrabajo, descripcion');
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

        await this.dynamo.send(new PutCommand({
            TableName: this.incidentsTable,
            Item: incident
        }));

        try {
            const topicArn = this.buildNotificationTopicArn();
            if (topicArn) {
                const message = {
                    incidentId,
                    tipo: incident.tipo,
                    centroTrabajo: incident.centroTrabajo,
                    descripcion: incident.descripcion,
                    origenReporte: 'qr_publico'
                };
                await this.sns.send(new PublishCommand({
                    TopicArn: topicArn,
                    Subject: `Nuevo reporte QR: ${incident.tipo}`,
                    Message: JSON.stringify(message, null, 2)
                }));
            }
        } catch (snsError) {
            console.error('Error enviando notificación SNS:', snsError);
        }

        try {
            const prevencionistas = await this.getPrevencionistas(incident.empresaId);
            await this.sendIncidentNotification(incident, prevencionistas);
        } catch (notifError) {
            console.error('Error enviando notificaciones inbox:', notifError);
        }

        return {
            incidentId,
            message: 'Reporte creado exitosamente'
        };
    }

    // MARK AS VIEWED
    async markAsViewed(id, userId) {
        if (!id || !userId) return;

        console.log(`[MARK_AS_VIEWED] Incident ${id} by user ${userId}`);

        try {
            await this.dynamo.send(new UpdateCommand({
                TableName: this.incidentsTable,
                Key: { incidentId: id },
                UpdateExpression: 'ADD viewedBy :userId',
                ExpressionAttributeValues: {
                    ':userId': new Set([userId])
                }
            }));
        } catch (error) {
            console.error('[ERROR] markAsViewed failed:', error);
        }
    }
}

module.exports = { IncidentsRepository };
