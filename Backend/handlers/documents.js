const { v4: uuidv4 } = require('uuid');
const { PutCommand, GetCommand, ScanCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient } = require('../lib/dynamodb');
const { success, error, created } = require('../lib/response');
const { validateRequired, generateSignatureToken } = require('../lib/validation');

const TABLE_NAME = process.env.DOCUMENTS_TABLE || 'Documents';
const WORKERS_TABLE = process.env.WORKERS_TABLE || 'Workers';

// Tipos de documentos según el DS 44
const DOCUMENT_TYPES = {
    IRL: 'Informe de Riesgos Laborales',
    POLITICA_SSO: 'Política de Seguridad y Salud Ocupacional',
    REGLAMENTO_INTERNO: 'Reglamento Interno',
    PROCEDIMIENTO_TRABAJO: 'Procedimiento de Trabajo Seguro',
    MATRIZ_MIPPER: 'Matriz MIPPER',
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
            tipo: body.tipo,
            tipoDescripcion: DOCUMENT_TYPES[body.tipo],
            titulo: body.titulo,
            contenido: body.contenido || '',
            descripcion: body.descripcion || '',
            empresaId: body.empresaId || 'default',
            relatorId: body.relatorId || null,
            s3Key: body.s3Key || null,
            firmas: [],
            asignaciones: [],
            estado: 'activo',
            version: 1,
            createdAt: now,
            updatedAt: now,
        };

        await docClient.send(
            new PutCommand({
                TableName: TABLE_NAME,
                Item: document,
            })
        );

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
        const { empresaId, tipo, estado } = event.queryStringParameters || {};

        let filterExpression = '';
        const expressionAttributeValues = {};

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

        const params = {
            TableName: TABLE_NAME,
        };

        if (filterExpression) {
            params.FilterExpression = filterExpression;
            params.ExpressionAttributeValues = expressionAttributeValues;
        }

        const result = await docClient.send(new ScanCommand(params));

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
 * POST /documents/{id}/assign - Asignar documento a trabajador(es)
 */
module.exports.assign = async (event) => {
    try {
        const { id } = event.pathParameters || {};
        const body = JSON.parse(event.body || '{}');

        if (!id) {
            return error('ID de documento requerido');
        }

        const { workerIds, fechaLimite, notificar } = body;

        if (!workerIds || !Array.isArray(workerIds) || workerIds.length === 0) {
            return error('Se requiere un array de IDs de trabajadores');
        }

        // Obtener documento actual
        const docResult = await docClient.send(
            new GetCommand({
                TableName: TABLE_NAME,
                Key: { documentId: id },
            })
        );

        if (!docResult.Item) {
            return error('Documento no encontrado', 404);
        }

        const now = new Date().toISOString();
        const nuevasAsignaciones = workerIds.map((workerId) => ({
            workerId,
            fechaAsignacion: now,
            fechaLimite: fechaLimite || null,
            estado: 'pendiente',
            notificado: notificar || false,
        }));

        const asignaciones = [...(docResult.Item.asignaciones || []), ...nuevasAsignaciones];

        await docClient.send(
            new UpdateCommand({
                TableName: TABLE_NAME,
                Key: { documentId: id },
                UpdateExpression: 'SET asignaciones = :asignaciones, updatedAt = :updatedAt',
                ExpressionAttributeValues: {
                    ':asignaciones': asignaciones,
                    ':updatedAt': now,
                },
            })
        );

        return success({
            message: `Documento asignado a ${workerIds.length} trabajador(es)`,
            asignaciones: nuevasAsignaciones,
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

        if (!id) {
            return error('ID de documento requerido');
        }

        const validation = validateRequired(body, ['workerId', 'tipoFirma']);
        if (!validation.valid) {
            return error(`Campos requeridos faltantes: ${validation.missing.join(', ')}`);
        }

        // Obtener documento
        const docResult = await docClient.send(
            new GetCommand({
                TableName: TABLE_NAME,
                Key: { documentId: id },
            })
        );

        if (!docResult.Item) {
            return error('Documento no encontrado', 404);
        }

        // Obtener datos del trabajador
        const workerResult = await docClient.send(
            new GetCommand({
                TableName: WORKERS_TABLE,
                Key: { workerId: body.workerId },
            })
        );

        if (!workerResult.Item) {
            return error('Trabajador no encontrado', 404);
        }

        const worker = workerResult.Item;
        const now = new Date();

        // Crear registro de firma según DS 44
        const firma = {
            token: generateSignatureToken(),
            workerId: body.workerId,
            nombre: worker.nombre,
            rut: worker.rut,
            tipoFirma: body.tipoFirma, // 'trabajador', 'relator', 'supervisor'
            fecha: now.toISOString().split('T')[0],
            horario: now.toTimeString().split(' ')[0],
            timestamp: now.toISOString(),
            ip: event.requestContext?.identity?.sourceIp || 'unknown',
        };

        const firmas = [...(docResult.Item.firmas || []), firma];

        // Actualizar estado de asignación si existe
        const asignaciones = (docResult.Item.asignaciones || []).map((a) => {
            if (a.workerId === body.workerId && a.estado === 'pendiente') {
                return { ...a, estado: 'firmado', fechaFirma: now.toISOString() };
            }
            return a;
        });

        await docClient.send(
            new UpdateCommand({
                TableName: TABLE_NAME,
                Key: { documentId: id },
                UpdateExpression: 'SET firmas = :firmas, asignaciones = :asignaciones, updatedAt = :updatedAt',
                ExpressionAttributeValues: {
                    ':firmas': firmas,
                    ':asignaciones': asignaciones,
                    ':updatedAt': now.toISOString(),
                },
            })
        );

        return success({
            message: 'Documento firmado exitosamente',
            firma,
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

        if (!id) {
            return error('ID de documento requerido');
        }

        const { workerIds, tipoFirma, relatorId } = body;

        if (!workerIds || !Array.isArray(workerIds) || workerIds.length === 0) {
            return error('Se requiere un array de IDs de trabajadores');
        }

        // Obtener documento
        const docResult = await docClient.send(
            new GetCommand({
                TableName: TABLE_NAME,
                Key: { documentId: id },
            })
        );

        if (!docResult.Item) {
            return error('Documento no encontrado', 404);
        }

        const now = new Date();
        const nuevasFirmas = [];

        // Obtener datos de cada trabajador y crear firma
        for (const workerId of workerIds) {
            const workerResult = await docClient.send(
                new GetCommand({
                    TableName: WORKERS_TABLE,
                    Key: { workerId },
                })
            );

            if (workerResult.Item) {
                const worker = workerResult.Item;
                nuevasFirmas.push({
                    token: generateSignatureToken(),
                    workerId,
                    nombre: worker.nombre,
                    rut: worker.rut,
                    tipoFirma: tipoFirma || 'trabajador',
                    fecha: now.toISOString().split('T')[0],
                    horario: now.toTimeString().split(' ')[0],
                    timestamp: now.toISOString(),
                    firmaMasiva: true,
                    relatorId: relatorId || null,
                });
            }
        }

        const firmas = [...(docResult.Item.firmas || []), ...nuevasFirmas];

        // Actualizar asignaciones
        const asignaciones = (docResult.Item.asignaciones || []).map((a) => {
            if (workerIds.includes(a.workerId) && a.estado === 'pendiente') {
                return { ...a, estado: 'firmado', fechaFirma: now.toISOString() };
            }
            return a;
        });

        await docClient.send(
            new UpdateCommand({
                TableName: TABLE_NAME,
                Key: { documentId: id },
                UpdateExpression: 'SET firmas = :firmas, asignaciones = :asignaciones, updatedAt = :updatedAt',
                ExpressionAttributeValues: {
                    ':firmas': firmas,
                    ':asignaciones': asignaciones,
                    ':updatedAt': now.toISOString(),
                },
            })
        );

        return success({
            message: `${nuevasFirmas.length} firmas registradas exitosamente`,
            firmas: nuevasFirmas,
        });
    } catch (err) {
        console.error('Error bulk signing document:', err);
        return error(err.message, 500);
    }
};
