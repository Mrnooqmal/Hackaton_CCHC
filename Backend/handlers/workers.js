const { v4: uuidv4 } = require('uuid');
const { PutCommand, GetCommand, ScanCommand, UpdateCommand, QueryCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient } = require('../lib/dynamodb');
const { assignWorkerToHealthSurvey } = require('../lib/healthSurvey');
const { success, error, created } = require('../lib/response');
const { validateRut, validateRequired, generateSignatureToken, hashPin, verifyPin, validatePin } = require('../lib/validation');

const TABLE_NAME = process.env.WORKERS_TABLE || 'Workers';
const SIGNATURES_TABLE = process.env.SIGNATURES_TABLE || 'Signatures';
const USERS_TABLE = process.env.USERS_TABLE || 'Users';

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
            // Nuevos campos para sistema de firma
            habilitado: false,          // Se activa después de firma de enrolamiento
            pinHash: null,              // Hash del PIN de 4 dígitos
            pinCreatedAt: null,         // Fecha de creación del PIN
            firmaEnrolamiento: null,    // Datos de la firma de enrolamiento
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

        try {
            await assignWorkerToHealthSurvey(worker);
        } catch (healthSurveyError) {
            console.error('No se pudo asignar la encuesta de salud por defecto al crear worker:', healthSurveyError);
        }

        return created(worker);
    } catch (err) {
        console.error('Error creating worker:', err);
        return error(err.message, 500);
    }
};

/**
 * GET /workers - Listar todos los trabajadores
 * Incluye workers tradicionales Y usuarios con rol prevencionista/trabajador
 */
module.exports.list = async (event) => {
    try {
        const empresaId = event.queryStringParameters?.empresaId;
        const includeUsers = event.queryStringParameters?.includeUsers !== 'false';

        // 1. Obtener workers tradicionales
        const workersParams = {
            TableName: TABLE_NAME,
        };

        if (empresaId) {
            workersParams.FilterExpression = 'empresaId = :empresaId AND estado = :estado';
            workersParams.ExpressionAttributeValues = {
                ':empresaId': empresaId,
                ':estado': 'activo',
            };
        } else {
            workersParams.FilterExpression = 'estado = :estado';
            workersParams.ExpressionAttributeValues = {
                ':estado': 'activo',
            };
        }

        const workersResult = await docClient.send(new ScanCommand(workersParams));
        let allWorkers = workersResult.Items || [];

        // 2. También obtener usuarios con rol prevencionista o trabajador
        if (includeUsers) {
            const USERS_TABLE = process.env.USERS_TABLE || 'Users';

            const usersParams = {
                TableName: USERS_TABLE,
                FilterExpression: '(rol = :rolTrabajador OR rol = :rolPrevencionista)',
                ExpressionAttributeValues: {
                    ':rolTrabajador': 'trabajador',
                    ':rolPrevencionista': 'prevencionista',
                },
            };

            if (empresaId) {
                usersParams.FilterExpression += ' AND empresaId = :empresaId';
                usersParams.ExpressionAttributeValues[':empresaId'] = empresaId;
            }

            const usersResult = await docClient.send(new ScanCommand(usersParams));
            const users = usersResult.Items || [];

            // Mapear usuarios a formato de worker para compatibilidad
            const usersAsWorkers = users
                .filter(user => !user.workerId) // Solo usuarios sin workerId (legacy)
                .map(user => ({
                    workerId: user.userId, // Usar userId como workerId temporal
                    rut: user.rut,
                    nombre: user.nombre,
                    apellido: user.apellido || '',
                    email: user.email || '',
                    telefono: user.telefono || '',
                    cargo: user.cargo || user.rol,
                    empresaId: user.empresaId || 'default',
                    fechaEnrolamiento: user.createdAt,
                    estado: user.estado === 'activo' ? 'activo' : 'activo',
                    habilitado: user.habilitado || false,
                    pinHash: user.pinHash,
                    pinCreatedAt: user.pinCreatedAt,
                    firmaEnrolamiento: user.firmaEnrolamiento,
                    createdAt: user.createdAt,
                    updatedAt: user.updatedAt,
                    // Marcar que viene de tabla Users
                    _sourceTable: 'users',
                    userId: user.userId,
                    rol: user.rol,
                }));

            // Combinar, evitando duplicados por RUT
            const existingRuts = new Set(allWorkers.map(w => w.rut));
            usersAsWorkers.forEach(userWorker => {
                if (!existingRuts.has(userWorker.rut)) {
                    allWorkers.push(userWorker);
                }
            });
        }

        // Ordenar por nombre
        allWorkers.sort((a, b) => (a.nombre || '').localeCompare(b.nombre || ''));

        return success(allWorkers);
    } catch (err) {
        console.error('Error listing workers:', err);
        return error(err.message, 500);
    };
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

/**
 * POST /workers/{id}/set-pin - Configurar o cambiar PIN del trabajador
 */
module.exports.setPin = async (event) => {
    try {
        const { id } = event.pathParameters || {};
        const body = JSON.parse(event.body || '{}');

        if (!id) {
            return error('ID de trabajador requerido');
        }

        const { pin, pinActual } = body;

        // Validar formato del nuevo PIN
        const pinValidation = validatePin(pin);
        if (!pinValidation.valid) {
            return error(pinValidation.error);
        }

        // Obtener trabajador
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

        // Si ya tiene PIN, requiere el PIN actual para cambiarlo
        if (worker.pinHash) {
            if (!pinActual) {
                return error('PIN actual es requerido para cambiar el PIN');
            }
            const pinActualValido = verifyPin(pinActual, worker.pinHash, id);
            if (!pinActualValido) {
                return error('PIN actual incorrecto', 401);
            }
        }

        const now = new Date().toISOString();
        const newPinHash = hashPin(pin, id);

        await docClient.send(
            new UpdateCommand({
                TableName: TABLE_NAME,
                Key: { workerId: id },
                UpdateExpression: 'SET pinHash = :pinHash, pinCreatedAt = :pinCreatedAt, updatedAt = :updatedAt',
                ExpressionAttributeValues: {
                    ':pinHash': newPinHash,
                    ':pinCreatedAt': now,
                    ':updatedAt': now,
                },
            })
        );

        // Sincronizar con la tabla Users si tiene userId
        if (worker.userId) {
            console.log(`Syncing PIN change for user ${worker.userId}`);
            // En Users se hashea con userId
            const pinHashForUser = hashPin(pin, worker.userId);
            try {
                await docClient.send(
                    new UpdateCommand({
                        TableName: USERS_TABLE,
                        Key: { userId: worker.userId },
                        UpdateExpression: 'SET pinHash = :pinHash, pinCreatedAt = :pinCreatedAt, updatedAt = :updatedAt',
                        ExpressionAttributeValues: {
                            ':pinHash': pinHashForUser,
                            ':pinCreatedAt': now,
                            ':updatedAt': now,
                        },
                    })
                );
            } catch (syncError) {
                console.error('Error syncing PIN change with users table:', syncError);
            }
        }

        return success({
            message: worker.pinHash ? 'PIN actualizado exitosamente' : 'PIN configurado exitosamente',
            pinCreatedAt: now,
        });
    } catch (err) {
        console.error('Error setting PIN:', err);
        return error(err.message, 500);
    }
};

/**
 * POST /workers/{id}/complete-enrollment - Completar enrolamiento con firma
 * Este endpoint valida el PIN y marca al trabajador como habilitado
 */
module.exports.completeEnrollment = async (event) => {
    try {
        const { id } = event.pathParameters || {};
        const body = JSON.parse(event.body || '{}');

        if (!id) {
            return error('ID de trabajador requerido');
        }

        const { pin } = body;

        if (!pin) {
            return error('PIN es requerido para completar el enrolamiento');
        }

        // Obtener trabajador
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

        if (worker.habilitado) {
            // Si el trabajador ya está habilitado, verificar si el usuario vinculado también lo está
            if (worker.userId) {
                const userRes = await docClient.send(
                    new GetCommand({
                        TableName: USERS_TABLE,
                        Key: { userId: worker.userId },
                    })
                );
                if (userRes.Item && userRes.Item.habilitado) {
                    return error('El trabajador y el usuario ya están habilitados', 400);
                }
                console.log('Worker enabled but user not. Allowing sync enrollment.');
            } else {
                return error('El trabajador ya está habilitado', 400);
            }
        }

        if (!worker.pinHash) {
            return error('El trabajador debe configurar un PIN primero', 400);
        }

        // Verificar PIN
        const pinValido = verifyPin(pin, worker.pinHash, id);
        if (!pinValido) {
            return error('PIN incorrecto', 401);
        }

        const now = new Date();
        const token = generateSignatureToken();

        // Datos de la firma de enrolamiento
        const firmaEnrolamiento = {
            token,
            fecha: now.toISOString().split('T')[0],
            horario: now.toTimeString().split(' ')[0],
            timestamp: now.toISOString(),
            metodoValidacion: 'PIN',
            ipAddress: event.requestContext?.http?.sourceIp ||
                event.requestContext?.identity?.sourceIp || 'unknown',
        };

        // Crear registro en SignaturesTable
        const signatureId = uuidv4();
        const signature = {
            signatureId,
            token,
            workerId: id,
            workerRut: worker.rut,
            workerNombre: `${worker.nombre} ${worker.apellido || ''}`.trim(),
            tipoFirma: 'enrolamiento',
            referenciaId: id,
            referenciaTipo: 'worker',
            fecha: firmaEnrolamiento.fecha,
            horario: firmaEnrolamiento.horario,
            timestamp: firmaEnrolamiento.timestamp,
            ipAddress: firmaEnrolamiento.ipAddress,
            userAgent: event.headers?.['user-agent'] || 'unknown',
            metodoValidacion: 'PIN',
            metadata: null,
            estado: 'valida',
            disputaInfo: null,
            empresaId: worker.empresaId || 'default',
            createdAt: now.toISOString(),
        };

        await docClient.send(
            new PutCommand({
                TableName: SIGNATURES_TABLE,
                Item: signature,
            })
        );

        // Actualizar trabajador como habilitado
        await docClient.send(
            new UpdateCommand({
                TableName: TABLE_NAME,
                Key: { workerId: id },
                UpdateExpression: 'SET habilitado = :habilitado, firmaEnrolamiento = :firmaEnrolamiento, updatedAt = :updatedAt',
                ExpressionAttributeValues: {
                    ':habilitado': true,
                    ':firmaEnrolamiento': firmaEnrolamiento,
                    ':updatedAt': now.toISOString(),
                },
            })
        );

        // Sincronizar con la tabla de Usuarios si existe una cuenta vinculada
        if (worker.userId || worker.rut) {
            try {
                let userToUpdate = null;
                if (worker.userId) {
                    const userRes = await docClient.send(new GetCommand({ TableName: USERS_TABLE, Key: { userId: worker.userId } }));
                    userToUpdate = userRes.Item;
                } else {
                    const userRes = await docClient.send(new ScanCommand({ TableName: USERS_TABLE, FilterExpression: 'rut = :rut', ExpressionAttributeValues: { ':rut': worker.rut } }));
                    userToUpdate = userRes.Items && userRes.Items[0];
                }

                if (userToUpdate) {
                    console.log(`Syncing habilitado state for user ${userToUpdate.userId}`);
                    // IMPORTANTE: Para el usuario, el PIN se hashea con su userId
                    const pinHashForUser = hashPin(pin, userToUpdate.userId);

                    await docClient.send(
                        new UpdateCommand({
                            TableName: USERS_TABLE,
                            Key: { userId: userToUpdate.userId },
                            UpdateExpression: 'SET habilitado = :habilitado, pinHash = :pinHash, pinCreatedAt = :pinCreatedAt, workerId = :workerId, updatedAt = :updatedAt',
                            ExpressionAttributeValues: {
                                ':habilitado': true,
                                ':pinHash': pinHashForUser,
                                ':pinCreatedAt': now.toISOString(),
                                ':workerId': id,
                                ':updatedAt': now.toISOString(),
                            },
                        })
                    );
                }
            } catch (syncError) {
                console.error('Error syncing enablement with users table:', syncError);
                // No bloqueamos el éxito del trabajador por un error en usuarios
            }
        }

        return success({
            message: 'Enrolamiento completado exitosamente. El trabajador está ahora habilitado.',
            workerId: id,
            habilitado: true,
            firma: {
                token: firmaEnrolamiento.token,
                fecha: firmaEnrolamiento.fecha,
                horario: firmaEnrolamiento.horario,
            },
        });
    } catch (err) {
        console.error('Error completing enrollment:', err);
        return error(err.message, 500);
    }
};
