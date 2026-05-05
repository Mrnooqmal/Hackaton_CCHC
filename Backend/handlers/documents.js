const { v4: uuidv4 } = require('uuid');
const { PutCommand, GetCommand, QueryCommand, ScanCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient } = require('../lib/dynamodb');
const { success, error, created } = require('../lib/response');
const { validateRequired, generateSignatureToken } = require('../lib/validation');
const { FirmaService } = require('../lib/services/FirmaService');
const { PersonaService } = require('../lib/services/PersonaService');
const { eventBus } = require('../lib/events/EventBus');

const TABLE_NAME = process.env.DOCUMENTS_TABLE || 'Documents';

// Tipos de documentos según el DS 44
const DOCUMENT_TYPES = {
    IRL: 'Informe de Riesgos Laborales',
    DIAGNOSTICO_LEGAL: 'Diagnóstico de aspectos legales',
    POLITICA_SSO: 'Política de Seguridad y Salud Ocupacional',
    REGLAMENTO_INTERNO: 'Reglamento Interno',
    PROCEDIMIENTO_TRABAJO: 'Procedimiento de Trabajo Seguro',
    MATRIZ_MIPPER: 'Matriz MIPPER',
    MIPER: 'MIPER',
    ENCUESTA_SALUD: 'Encuesta de Salud Pre-Ocupacional',
    TEST_EVALUACION: 'Test de Evaluación',
    ENTREGA_EPP: 'Entrega de EPP',
    CAPACITACION: 'Capacitación',
    MAPA_RIESGOS: 'Mapa de Riesgos',
};

/**
 * POST /documents - Crear nuevo documento
 */
module.exports.create = async (event) => {
    try {
        const body = JSON.parse(event.body || '{}');
        const tenantId = body.tenantId || event.queryStringParameters?.tenantId;
        if (!tenantId) return error('tenantId es requerido');

        const validation = validateRequired(body, ['tipo', 'titulo']);
        if (!validation.valid) {
            return error(`Campos requeridos faltantes: ${validation.missing.join(', ')}`);
        }

        if (!DOCUMENT_TYPES[body.tipo]) {
            return error(`Tipo de documento inválido. Tipos válidos: ${Object.keys(DOCUMENT_TYPES).join(', ')}`);
        }

        const now = new Date().toISOString();
        const documentId = uuidv4();

        const document = {
            documentId,
            tenantId,
            obraId: body.obraId || null,
            clasificacion: body.clasificacion || 'diario',
            fase: body.fase || null,
            tipo: body.tipo,
            tipoDescripcion: DOCUMENT_TYPES[body.tipo],
            obligatorio: body.obligatorio || false,
            titulo: body.titulo,
            contenido: body.contenido || '',
            descripcion: body.descripcion || '',
            relatorId: body.relatorId || null,
            s3Key: body.s3Key || null,
            archivoUrl: body.archivoUrl || null,
            archivoNombre: body.archivoNombre || null,
            fechaCaducidad: body.fechaCaducidad || null,
            createdBy: body.createdBy || null,
            creatorName: body.creatorName || null,
            firmas: [],
            asignaciones: [],
            estado: 'activo',
            version: 1,
            createdAt: now,
            updatedAt: now,
        };

        await docClient.send(new PutCommand({ TableName: TABLE_NAME, Item: document }));

        // Notificar asignados (usa personaId, no workerId)
        try {
            if (body.assignedTo && Array.isArray(body.assignedTo) && body.assignedTo.length > 0) {
                await eventBus.emit('document.assigned', {
                    documentId: document.documentId,
                    userIds: body.assignedTo,
                    assignedBy: body.createdBy || 'system',
                    creatorName: body.creatorName || 'Gestor SST',
                    documentName: document.titulo,
                    dueDate: body.dueDate || null
                });
            }
        } catch (eventError) {
            console.error('Error emitting document.assigned event:', eventError);
        }

        return created(document);
    } catch (err) {
        console.error('Error creating document:', err);
        return error(err.message, 500);
    }
};

/**
 * GET /documents - Listar documentos
 */
module.exports.list = async (event) => {
    try {
        const { tenantId, tipo, estado, clasificacion, obraId } = event.queryStringParameters || {};
        if (!tenantId) return error('tenantId es requerido');

        // Query por GSI tenantId-index (no Scan)
        const params = {
            TableName: TABLE_NAME,
            IndexName: 'tenantId-index',
            KeyConditionExpression: 'tenantId = :tenantId',
            ExpressionAttributeValues: { ':tenantId': tenantId }
        };

        // Filtros adicionales
        let filterParts = [];
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
        if (clasificacion) {
            filterParts.push('clasificacion = :clasificacion');
            params.ExpressionAttributeValues[':clasificacion'] = clasificacion;
        }
        if (filterParts.length > 0) {
            params.FilterExpression = filterParts.join(' AND ');
        }

        const result = await docClient.send(new QueryCommand(params));

        return success({
            documents: result.Items || [],
            types: DOCUMENT_TYPES,
        });
    } catch (err) {
        console.error('Error listing documents:', err);
        return error(err.message, 500);
    }
};

/**
 * GET /documents/{id} - Obtener documento por ID
 */
module.exports.get = async (event) => {
    try {
        const { id } = event.pathParameters || {};

        if (!id) {
            return error('ID de documento requerido');
        }

        const result = await docClient.send(
            new GetCommand({
                TableName: TABLE_NAME,
                Key: { documentId: id },
            })
        );

        if (!result.Item) {
            return error('Documento no encontrado', 404);
        }

        return success(result.Item);
    } catch (err) {
        console.error('Error getting document:', err);
        return error(err.message, 500);
    }
};

/**
 * PUT /documents/{id} - Actualizar documento
 */
module.exports.update = async (event) => {
    try {
        const { id } = event.pathParameters || {};
        if (!id) return error('ID de documento requerido');

        const body = JSON.parse(event.body || '{}');
        const allowedFields = ['titulo', 'descripcion', 'contenido', 's3Key', 'archivoUrl', 'archivoNombre', 'estado', 'clasificacion', 'fase', 'tipo', 'obligatorio', 'fechaCaducidad'];
        const updateExpressions = [];
        const expressionNames = {};
        const expressionValues = {};

        allowedFields.forEach((field) => {
            if (body[field] !== undefined) {
                updateExpressions.push(`#${field} = :${field}`);
                expressionNames[`#${field}`] = field;
                expressionValues[`:${field}`] = body[field];
            }
        });

        if (updateExpressions.length === 0) {
            return error('No hay campos para actualizar');
        }

        updateExpressions.push('#updatedAt = :updatedAt');
        expressionNames['#updatedAt'] = 'updatedAt';
        expressionValues[':updatedAt'] = new Date().toISOString();

        const result = await docClient.send(new UpdateCommand({
            TableName: TABLE_NAME,
            Key: { documentId: id },
            UpdateExpression: `SET ${updateExpressions.join(', ')}`,
            ExpressionAttributeNames: expressionNames,
            ExpressionAttributeValues: expressionValues,
            ReturnValues: 'ALL_NEW'
        }));

        return success(result.Attributes);
    } catch (err) {
        console.error('Error updating document:', err);
        return error(err.message, 500);
    }
};

/**
 * POST /documents/{id}/assign - Asignar documento a trabajador(es)
 */
module.exports.assign = async (event) => {
    try {
        const { id } = event.pathParameters || {};
        const body = JSON.parse(event.body || '{}');

        if (!id) return error('ID de documento requerido');

        // Acepta personaIds o workerIds (legacy)
        const personaIds = body.personaIds || body.workerIds;
        const { fechaLimite, notificar, assignedBy, assignerName, replace } = body;

        if (!personaIds || !Array.isArray(personaIds) || personaIds.length === 0) {
            return error('Se requiere un array de IDs de personas');
        }

        const docResult = await docClient.send(new GetCommand({
            TableName: TABLE_NAME,
            Key: { documentId: id }
        }));

        if (!docResult.Item) return error('Documento no encontrado', 404);

        // Lookup personas via PersonaService
        const personaService = new PersonaService();
        const now = new Date().toISOString();
        const nuevasAsignaciones = [];

        for (const pid of personaIds) {
            const persona = await personaService.getById(pid);
            nuevasAsignaciones.push({
                personaId: pid,
                nombre: persona ? `${persona.nombre} ${persona.apellido || ''}`.trim() : pid,
                rut: persona?.rut || null,
                fechaAsignacion: now,
                fechaLimite: fechaLimite || null,
                estado: 'pendiente',
                notificado: notificar || false
            });
        }

        const shouldReplace = Boolean(replace);
        const asignaciones = shouldReplace
            ? nuevasAsignaciones
            : [...(docResult.Item.asignaciones || []), ...nuevasAsignaciones];

        const updateExpression = shouldReplace
            ? 'SET asignaciones = :asignaciones, firmas = :firmas, updatedAt = :updatedAt'
            : 'SET asignaciones = :asignaciones, updatedAt = :updatedAt';

        const expressionAttributeValues = shouldReplace
            ? { ':asignaciones': asignaciones, ':firmas': [], ':updatedAt': now }
            : { ':asignaciones': asignaciones, ':updatedAt': now };

        await docClient.send(new UpdateCommand({
            TableName: TABLE_NAME,
            Key: { documentId: id },
            UpdateExpression: updateExpression,
            ExpressionAttributeValues: expressionAttributeValues
        }));

        // Notificar asignados
        try {
            await eventBus.emit('document.assigned', {
                documentId: id,
                userIds: personaIds,
                assignedBy: assignedBy || 'system',
                creatorName: assignerName || docResult.Item.creatorName || 'Gestor SST',
                documentName: docResult.Item.titulo,
                dueDate: fechaLimite || null
            });
        } catch (eventError) {
            console.error('Error emitting document.assigned event:', eventError);
        }

        return success({
            message: `Documento asignado a ${personaIds.length} persona(s)`,
            asignaciones: nuevasAsignaciones
        });
    } catch (err) {
        console.error('Error assigning document:', err);
        return error(err.message, 500);
    }
};

/**
 * POST /documents/{id}/sign - Firmar documento (individual)
 */
module.exports.sign = async (event) => {
    try {
        const { id } = event.pathParameters || {};
        const body = JSON.parse(event.body || '{}');

        if (!id) return error('ID de documento requerido');

        const signerPersonaId = body.personaId || body.workerId;
        if (!signerPersonaId || !body.tipoFirma) {
            return error('personaId y tipoFirma son requeridos');
        }

        const docResult = await docClient.send(new GetCommand({
            TableName: TABLE_NAME,
            Key: { documentId: id }
        }));
        if (!docResult.Item) return error('Documento no encontrado', 404);
        const documentData = docResult.Item;

        const personaService = new PersonaService();
        const persona = await personaService.getById(signerPersonaId);
        if (!persona) return error('Persona no encontrada', 404);

        const contexto = {
            ipAddress: event.requestContext?.http?.sourceIp || 'unknown',
            userAgent: event.headers?.['user-agent'] || 'unknown'
        };

        const metodo = body.pin ? 'PIN' : 'PRESENCIAL';
        let firmaResult;
        try {
            firmaResult = await FirmaService.crear({
                personaId: signerPersonaId,
                tenantId: documentData.tenantId,
                metodo,
                credencial: body.pin || {},
                tipoFirma: body.tipoFirma,
                referenciaId: id,
                referenciaTipo: 'document',
                contexto,
                persona
            });
        } catch (firmaErr) {
            return error(firmaErr.message, 400);
        }

        const firmaEmbebida = FirmaService.toDocumentFirmaFormat(firmaResult);
        const firmas = [...(documentData.firmas || []), firmaEmbebida];

        const asignaciones = (documentData.asignaciones || []).map((a) => {
            if ((a.personaId === signerPersonaId || a.workerId === signerPersonaId) && a.estado === 'pendiente') {
                return { ...a, estado: 'firmado', fechaFirma: new Date().toISOString() };
            }
            return a;
        });

        await docClient.send(new UpdateCommand({
            TableName: TABLE_NAME,
            Key: { documentId: id },
            UpdateExpression: 'SET firmas = :firmas, asignaciones = :asignaciones, updatedAt = :updatedAt',
            ExpressionAttributeValues: {
                ':firmas': firmas,
                ':asignaciones': asignaciones,
                ':updatedAt': new Date().toISOString()
            }
        }));

        return success({
            message: 'Documento firmado exitosamente',
            firma: firmaEmbebida,
            signatureId: firmaResult.signatureId,
            token: firmaResult.token
        });
    } catch (err) {
        console.error('Error signing document:', err);
        return error(err.message, 500);
    }
};

/**
 * POST /documents/{id}/sign-bulk - Firma masiva de documento
 */
module.exports.signBulk = async (event) => {
    try {
        const { id } = event.pathParameters || {};
        const body = JSON.parse(event.body || '{}');

        if (!id) return error('ID de documento requerido');

        const personaIds = body.personaIds || body.workerIds;
        const { tipoFirma, pin } = body;

        if (!personaIds || !Array.isArray(personaIds) || personaIds.length === 0) {
            return error('Se requiere un array de IDs de personas');
        }

        const docResult = await docClient.send(new GetCommand({
            TableName: TABLE_NAME,
            Key: { documentId: id }
        }));
        if (!docResult.Item) return error('Documento no encontrado', 404);
        const documentData = docResult.Item;

        const contexto = {
            ipAddress: event.requestContext?.http?.sourceIp || 'unknown',
            userAgent: event.headers?.['user-agent'] || 'unknown'
        };

        const metodo = pin ? 'PIN' : 'PRESENCIAL';
        const resultado = await FirmaService.crearBatch(personaIds, {
            tenantId: documentData.tenantId,
            metodo,
            credencial: pin || {},
            tipoFirma: tipoFirma || 'trabajador',
            referenciaId: id,
            referenciaTipo: 'document',
            contexto
        });

        const nuevasFirmas = resultado.exitosas.map(f => FirmaService.toDocumentFirmaFormat(f));
        const firmas = [...(documentData.firmas || []), ...nuevasFirmas];

        const asignaciones = (documentData.asignaciones || []).map((a) => {
            const firmado = personaIds.includes(a.personaId) || personaIds.includes(a.workerId);
            if (firmado && a.estado === 'pendiente') {
                return { ...a, estado: 'firmado', fechaFirma: new Date().toISOString() };
            }
            return a;
        });

        await docClient.send(new UpdateCommand({
            TableName: TABLE_NAME,
            Key: { documentId: id },
            UpdateExpression: 'SET firmas = :firmas, asignaciones = :asignaciones, updatedAt = :updatedAt',
            ExpressionAttributeValues: {
                ':firmas': firmas,
                ':asignaciones': asignaciones,
                ':updatedAt': new Date().toISOString()
            }
        }));

        return success({
            message: `${resultado.exitosas.length} firmas registradas exitosamente`,
            firmas: nuevasFirmas,
            errores: resultado.fallidas.length > 0 ? resultado.fallidas : undefined
        });
    } catch (err) {
        console.error('Error bulk signing document:', err);
        return error(err.message, 500);
    }
};
