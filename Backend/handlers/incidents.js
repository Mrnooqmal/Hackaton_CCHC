const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, GetCommand, QueryCommand, ScanCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
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

// Helper para respuestas
const response = (statusCode, body) => ({
    statusCode,
    headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
    },
    body: JSON.stringify(body),
});

// CREATE - Crear nuevo incidente
exports.create = async (event) => {
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
                TopicArn: `arn:aws:sns:${process.env.AWS_REGION || 'us-east-1'}:${process.env.AWS_ACCOUNT_ID || ''}:${INCIDENT_NOTIFICATION_TOPIC}`,
                Subject: `Nuevo ${incident.tipo} reportado - ${incident.gravedad}`,
                Message: JSON.stringify(message, null, 2)
            }));
        } catch (snsError) {
            console.error('Error enviando notificación SNS:', snsError);
            // No fallar la creación si SNS falla
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

        return response(200, {
            success: true,
            data: result.Item
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
