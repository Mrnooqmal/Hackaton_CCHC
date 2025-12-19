const { v4: uuidv4 } = require('uuid');
const { PutCommand, GetCommand, ScanCommand, UpdateCommand, QueryCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient } = require('../lib/dynamodb');
const { success, error, created } = require('../lib/response');
const { validateRut, validateRequired, generateSignatureToken } = require('../lib/validation');

const TABLE_NAME = process.env.WORKERS_TABLE || 'Workers';

/**
 * POST /workers - Registrar nuevo trabajador (Enrolamiento)
 */
module.exports.create = async (event) => {
    try {
        const body = JSON.parse(event.body || '{}');

        // Validar campos requeridos
        const validation = validateRequired(body, ['rut', 'nombre', 'cargo']);
        if (!validation.valid) {
            return error(`Campos requeridos faltantes: ${validation.missing.join(', ')}`);
        }

        // Validar RUT chileno
        const rutValidation = validateRut(body.rut);
        if (!rutValidation.valid) {
            return error('RUT inválido');
        }

        const now = new Date().toISOString();
        const workerId = uuidv4();

        const worker = {
            workerId,
            rut: rutValidation.formatted,
            nombre: body.nombre,
            apellido: body.apellido || '',
            email: body.email || '',
            telefono: body.telefono || '',
            cargo: body.cargo,
            empresaId: body.empresaId || 'default',
            fechaEnrolamiento: now,
            signatureToken: generateSignatureToken(),
            estado: 'activo',
            createdAt: now,
            updatedAt: now,
        };

        await docClient.send(
            new PutCommand({
                TableName: TABLE_NAME,
                Item: worker,
                ConditionExpression: 'attribute_not_exists(workerId)',
            })
        );

        return created(worker);
    } catch (err) {
        console.error('Error creating worker:', err);
        return error(err.message, 500);
    }
};

/**
 * GET /workers - Listar todos los trabajadores
 */
module.exports.list = async (event) => {
    try {
        const empresaId = event.queryStringParameters?.empresaId || 'default';

        const result = await docClient.send(
            new ScanCommand({
                TableName: TABLE_NAME,
                FilterExpression: 'empresaId = :empresaId AND estado = :estado',
                ExpressionAttributeValues: {
                    ':empresaId': empresaId,
                    ':estado': 'activo',
                },
            })
        );

        return success(result.Items || []);
    } catch (err) {
        console.error('Error listing workers:', err);
        return error(err.message, 500);
    }
};

/**
 * GET /workers/{id} - Obtener trabajador por ID
 */
module.exports.get = async (event) => {
    try {
        const { id } = event.pathParameters || {};

        if (!id) {
            return error('ID de trabajador requerido');
        }

        const result = await docClient.send(
            new GetCommand({
                TableName: TABLE_NAME,
                Key: { workerId: id },
            })
        );

        if (!result.Item) {
            return error('Trabajador no encontrado', 404);
        }

        return success(result.Item);
    } catch (err) {
        console.error('Error getting worker:', err);
        return error(err.message, 500);
    }
};

/**
 * PUT /workers/{id} - Actualizar trabajador
 */
module.exports.update = async (event) => {
    try {
        const { id } = event.pathParameters || {};
        const body = JSON.parse(event.body || '{}');

        if (!id) {
            return error('ID de trabajador requerido');
        }

        // Si se actualiza el RUT, validarlo
        if (body.rut) {
            const rutValidation = validateRut(body.rut);
            if (!rutValidation.valid) {
                return error('RUT inválido');
            }
            body.rut = rutValidation.formatted;
        }

        const updateExpressions = [];
        const expressionAttributeNames = {};
        const expressionAttributeValues = {};

        const allowedFields = ['nombre', 'apellido', 'email', 'telefono', 'cargo', 'rut', 'estado'];

        allowedFields.forEach((field) => {
            if (body[field] !== undefined) {
                updateExpressions.push(`#${field} = :${field}`);
                expressionAttributeNames[`#${field}`] = field;
                expressionAttributeValues[`:${field}`] = body[field];
            }
        });

        if (updateExpressions.length === 0) {
            return error('No hay campos para actualizar');
        }

        updateExpressions.push('#updatedAt = :updatedAt');
        expressionAttributeNames['#updatedAt'] = 'updatedAt';
        expressionAttributeValues[':updatedAt'] = new Date().toISOString();

        const result = await docClient.send(
            new UpdateCommand({
                TableName: TABLE_NAME,
                Key: { workerId: id },
                UpdateExpression: `SET ${updateExpressions.join(', ')}`,
                ExpressionAttributeNames: expressionAttributeNames,
                ExpressionAttributeValues: expressionAttributeValues,
                ReturnValues: 'ALL_NEW',
            })
        );

        return success(result.Attributes);
    } catch (err) {
        console.error('Error updating worker:', err);
        return error(err.message, 500);
    }
};

/**
 * POST /workers/{id}/sign - Registrar firma digital del trabajador
 */
module.exports.sign = async (event) => {
    try {
        const { id } = event.pathParameters || {};
        const body = JSON.parse(event.body || '{}');

        if (!id) {
            return error('ID de trabajador requerido');
        }

        // Obtener trabajador actual
        const workerResult = await docClient.send(
            new GetCommand({
                TableName: TABLE_NAME,
                Key: { workerId: id },
            })
        );

        if (!workerResult.Item) {
            return error('Trabajador no encontrado', 404);
        }

        const worker = workerResult.Item;
        const now = new Date();

        // Crear registro de firma
        const signatureRecord = {
            token: generateSignatureToken(),
            nombre: worker.nombre,
            rut: worker.rut,
            fecha: now.toISOString().split('T')[0],
            horario: now.toTimeString().split(' ')[0],
            tipo: body.tipo || 'enrolamiento',
            documentoId: body.documentoId || null,
            ip: event.requestContext?.identity?.sourceIp || 'unknown',
            timestamp: now.toISOString(),
        };

        // Agregar firma al historial del trabajador
        const firmas = worker.firmas || [];
        firmas.push(signatureRecord);

        await docClient.send(
            new UpdateCommand({
                TableName: TABLE_NAME,
                Key: { workerId: id },
                UpdateExpression: 'SET firmas = :firmas, updatedAt = :updatedAt',
                ExpressionAttributeValues: {
                    ':firmas': firmas,
                    ':updatedAt': now.toISOString(),
                },
            })
        );

        return success({
            message: 'Firma registrada exitosamente',
            signature: signatureRecord,
        });
    } catch (err) {
        console.error('Error signing:', err);
        return error(err.message, 500);
    }
};

/**
 * GET /workers/rut/{rut} - Buscar trabajador por RUT
 */
module.exports.getByRut = async (event) => {
    try {
        const { rut } = event.pathParameters || {};

        if (!rut) {
            return error('RUT requerido');
        }

        const rutValidation = validateRut(rut);
        if (!rutValidation.valid) {
            return error('RUT inválido');
        }

        const result = await docClient.send(
            new ScanCommand({
                TableName: TABLE_NAME,
                FilterExpression: 'rut = :rut',
                ExpressionAttributeValues: {
                    ':rut': rutValidation.formatted,
                },
            })
        );

        if (!result.Items || result.Items.length === 0) {
            return error('Trabajador no encontrado', 404);
        }

        return success(result.Items[0]);
    } catch (err) {
        console.error('Error getting worker by RUT:', err);
        return error(err.message, 500);
    }
};
