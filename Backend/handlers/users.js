const { v4: uuidv4 } = require('uuid');
const { PutCommand, GetCommand, ScanCommand, UpdateCommand, DeleteCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient } = require('../lib/dynamodb');
const { success, error, created } = require('../lib/response');
const { validateRut, validateRequired, hashPin, verifyPin, validatePin, generateSignatureToken, hashPassword, generateTempPassword } = require('../lib/validation');

const USERS_TABLE = process.env.USERS_TABLE || 'Users';
const SIGNATURES_TABLE = process.env.SIGNATURES_TABLE || 'Signatures';

// Roles válidos del sistema
const ROLES = {
    admin: {
        nombre: 'Administrador',
        permisos: ['crear_usuarios', 'editar_usuarios', 'ver_usuarios', 'reset_pin', 'ver_reportes', 'gestionar_empresa', 'resolver_disputas']
    },
    prevencionista: {
        nombre: 'Prevencionista',
        permisos: ['crear_actividades', 'asignar_documentos', 'ver_trabajadores', 'firmar_relator', 'ver_reportes', 'crear_capacitaciones']
    },
    trabajador: {
        nombre: 'Trabajador',
        permisos: ['ver_documentos_asignados', 'firmar_documentos', 'registrar_asistencia', 'ver_perfil']
    }
};

/**
 * POST /users - Crear nuevo usuario (solo admin)
 */
module.exports.create = async (event) => {
    try {
        const body = JSON.parse(event.body || '{}');

        // TODO: Verificar que el usuario actual es admin (desde token de sesión)
        // Por ahora permitimos crear sin verificación para setup inicial

        const validation = validateRequired(body, ['rut', 'nombre', 'rol']);
        if (!validation.valid) {
            return error(`Campos requeridos faltantes: ${validation.missing.join(', ')}`);
        }

        // Validar RUT
        const rutValidation = validateRut(body.rut);
        if (!rutValidation.valid) {
            return error('RUT inválido');
        }

        // Validar rol
        if (!ROLES[body.rol]) {
            return error(`Rol inválido. Roles válidos: ${Object.keys(ROLES).join(', ')}`);
        }

        // Verificar que el RUT no exista
        const existingUser = await docClient.send(
            new ScanCommand({
                TableName: USERS_TABLE,
                FilterExpression: 'rut = :rut',
                ExpressionAttributeValues: { ':rut': rutValidation.formatted },
            })
        );

        if (existingUser.Items && existingUser.Items.length > 0) {
            return error('Ya existe un usuario con este RUT', 400);
        }

        // Generar Contraseña temporal (Alfanumérica)
        const passwordTemporal = generateTempPassword(10);

        const now = new Date().toISOString();
        const userId = uuidv4();

        const user = {
            userId,
            email: body.email || null,
            rut: rutValidation.formatted,
            nombre: body.nombre,
            apellido: body.apellido || '',
            telefono: body.telefono || '',

            // Rol y permisos
            rol: body.rol,
            permisos: ROLES[body.rol].permisos,

            // Autenticación (Login)
            passwordHash: hashPassword(passwordTemporal, userId),
            passwordTemporal: true,
            passwordCreatedAt: now,

            // Firma (será seteado en enrolamiento)
            pinHash: null,
            habilitado: false,

            // Cargo (para trabajadores principalmente)
            cargo: body.cargo || ROLES[body.rol].nombre,

            // Estado inicial
            estado: 'pendiente', // pendiente, activo, suspendido

            // Personalización
            preferencias: {
                tema: 'dark',
                notificaciones: true,
                idioma: 'es'
            },
            avatar: null,

            // Empresa
            empresaId: body.empresaId || 'default',

            // Metadata
            creadoPor: body.creadoPor || 'system',
            createdAt: now,
            updatedAt: now,
            ultimoAcceso: null
        };

        await docClient.send(
            new PutCommand({
                TableName: USERS_TABLE,
                Item: user,
            })
        );

        // Enviar email de bienvenida si tiene email
        let emailSent = false;
        if (user.email) {
            try {
                const { sendWelcomeEmail } = require('./notifications');
                const emailResult = await sendWelcomeEmail(user.email, user.nombre, user.rut, passwordTemporal);
                emailSent = emailResult.sent;
            } catch (emailErr) {
                console.error('Error sending welcome email:', emailErr);
                // No falla la creación por error de email
            }
        }

        // Retornar usuario con Contraseña temporal visible (solo en creación)
        return created({
            message: 'Usuario creado exitosamente',
            user: {
                userId: user.userId,
                rut: user.rut,
                nombre: user.nombre,
                apellido: user.apellido,
                rol: user.rol,
                cargo: user.cargo,
                estado: user.estado
            },
            passwordTemporal, // Solo visible en la respuesta de creación
            emailNotificado: emailSent,
            instrucciones: emailSent
                ? 'Se ha enviado un email con las credenciales al usuario'
                : 'El usuario debe cambiar esta contraseña en su primer acceso'
        });
    } catch (err) {
        console.error('Error creating user:', err);
        return error(err.message, 500);
    }
};

/**
 * GET /users - Listar usuarios (admin y prevencionista)
 */
module.exports.list = async (event) => {
    try {
        const { empresaId, rol, estado } = event.queryStringParameters || {};

        let filterExpression = '';
        const expressionAttributeValues = {};

        if (empresaId) {
            filterExpression += 'empresaId = :empresaId';
            expressionAttributeValues[':empresaId'] = empresaId;
        }

        if (rol) {
            filterExpression += filterExpression ? ' AND rol = :rol' : 'rol = :rol';
            expressionAttributeValues[':rol'] = rol;
        }

        if (estado) {
            filterExpression += filterExpression ? ' AND estado = :estado' : 'estado = :estado';
            expressionAttributeValues[':estado'] = estado;
        }

        const params = {
            TableName: USERS_TABLE,
        };

        if (filterExpression) {
            params.FilterExpression = filterExpression;
            params.ExpressionAttributeValues = expressionAttributeValues;
        }

        const result = await docClient.send(new ScanCommand(params));

        // No exponer pinHash
        const users = (result.Items || []).map(user => {
            const { pinHash, ...safeUser } = user;
            return safeUser;
        });

        return success({
            total: users.length,
            users,
            roles: ROLES
        });
    } catch (err) {
        console.error('Error listing users:', err);
        return error(err.message, 500);
    }
};

/**
 * GET /users/{id} - Obtener usuario por ID
 */
module.exports.get = async (event) => {
    try {
        const { id } = event.pathParameters || {};

        if (!id) {
            return error('ID de usuario requerido');
        }

        const result = await docClient.send(
            new GetCommand({
                TableName: USERS_TABLE,
                Key: { userId: id },
            })
        );

        if (!result.Item) {
            return error('Usuario no encontrado', 404);
        }

        // No exponer hashes
        const { passwordHash, pinHash, ...safeUser } = result.Item;
        return success(safeUser);
    } catch (err) {
        console.error('Error getting user:', err);
        return error(err.message, 500);
    }
};

/**
 * GET /users/rut/{rut} - Buscar usuario por RUT
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
                TableName: USERS_TABLE,
                FilterExpression: 'rut = :rut',
                ExpressionAttributeValues: {
                    ':rut': rutValidation.formatted,
                },
            })
        );

        if (!result.Items || result.Items.length === 0) {
            return error('Usuario no encontrado', 404);
        }

        const { passwordHash, pinHash, ...safeUser } = result.Items[0];
        return success(safeUser);
    } catch (err) {
        console.error('Error getting user by RUT:', err);
        return error(err.message, 500);
    }
};

/**
 * PUT /users/{id} - Actualizar usuario
 */
module.exports.update = async (event) => {
    try {
        const { id } = event.pathParameters || {};
        const body = JSON.parse(event.body || '{}');

        if (!id) {
            return error('ID de usuario requerido');
        }

        // Campos que se pueden actualizar
        const allowedFields = ['nombre', 'apellido', 'email', 'telefono', 'cargo', 'estado', 'preferencias', 'avatar'];

        const updateExpressions = [];
        const expressionAttributeNames = {};
        const expressionAttributeValues = {};

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
                TableName: USERS_TABLE,
                Key: { userId: id },
                UpdateExpression: `SET ${updateExpressions.join(', ')}`,
                ExpressionAttributeNames: expressionAttributeNames,
                ExpressionAttributeValues: expressionAttributeValues,
                ReturnValues: 'ALL_NEW',
            })
        );

        const { passwordHash, pinHash, ...safeUser } = result.Attributes;
        return success(safeUser);
    } catch (err) {
        console.error('Error updating user:', err);
        return error(err.message, 500);
    }
};

/**
 * POST /users/{id}/reset-password - Resetear contraseña a temporal (solo admin)
 */
module.exports.resetPassword = async (event) => {
    try {
        const { id } = event.pathParameters || {};

        if (!id) {
            return error('ID de usuario requerido');
        }

        // Verificar que existe
        const userResult = await docClient.send(
            new GetCommand({
                TableName: USERS_TABLE,
                Key: { userId: id },
            })
        );

        if (!userResult.Item) {
            return error('Usuario no encontrado', 404);
        }

        // Generar nueva contraseña temporal
        const passwordTemporal = generateTempPassword(10);
        const now = new Date().toISOString();

        await docClient.send(
            new UpdateCommand({
                TableName: USERS_TABLE,
                Key: { userId: id },
                UpdateExpression: 'SET passwordHash = :passwordHash, passwordTemporal = :passwordTemporal, passwordCreatedAt = :passwordCreatedAt, updatedAt = :updatedAt',
                ExpressionAttributeValues: {
                    ':passwordHash': hashPassword(passwordTemporal, id),
                    ':passwordTemporal': true,
                    ':passwordCreatedAt': now,
                    ':updatedAt': now,
                },
            })
        );

        // Enviar email con nueva contraseña temporal
        const user = userResult.Item;
        let emailSent = false;
        if (user.email) {
            try {
                const { sendWelcomeEmail } = require('./notifications');
                const emailResult = await sendWelcomeEmail(user.email, user.nombre, user.rut, passwordTemporal);
                emailSent = emailResult.sent;
            } catch (emailErr) {
                console.error('Error sending reset password email:', emailErr);
            }
        }

        return success({
            message: 'Contraseña reseteada exitosamente',
            userId: id,
            passwordTemporal,
            emailNotificado: emailSent,
            instrucciones: emailSent
                ? 'Se ha enviado un email con la nueva contraseña al usuario'
                : 'El usuario debe cambiar esta contraseña en su próximo acceso'
        });
    } catch (err) {
        console.error('Error resetting password:', err);
        return error(err.message, 500);
    }
};

/**
 * POST /users/{id}/set-pin - Configurar o cambiar PIN del usuario
 */
module.exports.setPin = async (event) => {
    try {
        const { id } = event.pathParameters || {};
        const body = JSON.parse(event.body || '{}');

        if (!id) {
            return error('ID de usuario requerido');
        }

        const { pin, pinActual } = body;

        // Validar formato del nuevo PIN
        const pinValidation = validatePin(pin);
        if (!pinValidation.valid) {
            return error(pinValidation.error);
        }

        // Obtener usuario
        const userResult = await docClient.send(
            new GetCommand({
                TableName: USERS_TABLE,
                Key: { userId: id },
            })
        );

        if (!userResult.Item) {
            return error('Usuario no encontrado', 404);
        }

        const user = userResult.Item;

        // Si ya tiene PIN Y el usuario está habilitado, requiere el PIN actual para cambiarlo
        // Durante el enrolamiento (habilitado=false), se puede configurar sin PIN actual
        if (user.pinHash && user.habilitado) {
            if (!pinActual) {
                return error('PIN actual es requerido para cambiar el PIN');
            }
            const pinActualValido = verifyPin(pinActual, user.pinHash, id);
            if (!pinActualValido) {
                return error('PIN actual incorrecto', 401);
            }
        }

        const now = new Date().toISOString();
        const newPinHash = hashPin(pin, id);

        await docClient.send(
            new UpdateCommand({
                TableName: USERS_TABLE,
                Key: { userId: id },
                UpdateExpression: 'SET pinHash = :pinHash, pinCreatedAt = :pinCreatedAt, updatedAt = :updatedAt',
                ExpressionAttributeValues: {
                    ':pinHash': newPinHash,
                    ':pinCreatedAt': now,
                    ':updatedAt': now,
                },
            })
        );

        return success({
            message: user.pinHash ? 'PIN actualizado exitosamente' : 'PIN configurado exitosamente',
            pinCreatedAt: now,
        });
    } catch (err) {
        console.error('Error setting PIN:', err);
        return error(err.message, 500);
    }
};

/**
 * POST /users/{id}/complete-enrollment - Completar enrolamiento con firma
 */
module.exports.completeEnrollment = async (event) => {
    try {
        const { id } = event.pathParameters || {};
        const body = JSON.parse(event.body || '{}');

        if (!id) {
            return error('ID de usuario requerido');
        }

        const { pin } = body;

        if (!pin) {
            return error('PIN es requerido para completar el enrolamiento');
        }

        // Obtener usuario
        const userResult = await docClient.send(
            new GetCommand({
                TableName: USERS_TABLE,
                Key: { userId: id },
            })
        );

        if (!userResult.Item) {
            return error('Usuario no encontrado', 404);
        }

        const user = userResult.Item;

        if (user.habilitado) {
            return error('El usuario ya está habilitado', 400);
        }

        if (user.pinTemporal) {
            return error('Debe cambiar el PIN temporal antes de completar el enrolamiento', 400);
        }

        // Verificar PIN
        const pinValido = verifyPin(pin, user.pinHash, id);
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
            workerId: id, // Usamos el userId
            workerRut: user.rut,
            workerNombre: `${user.nombre} ${user.apellido || ''}`.trim(),
            tipoFirma: 'enrolamiento',
            referenciaId: id,
            referenciaTipo: 'user',
            fecha: firmaEnrolamiento.fecha,
            horario: firmaEnrolamiento.horario,
            timestamp: firmaEnrolamiento.timestamp,
            ipAddress: firmaEnrolamiento.ipAddress,
            userAgent: event.headers?.['user-agent'] || 'unknown',
            metodoValidacion: 'PIN',
            metadata: { rol: user.rol },
            estado: 'valida',
            disputaInfo: null,
            empresaId: user.empresaId || 'default',
            createdAt: now.toISOString(),
        };

        await docClient.send(
            new PutCommand({
                TableName: SIGNATURES_TABLE,
                Item: signature,
            })
        );

        // Actualizar usuario como habilitado
        await docClient.send(
            new UpdateCommand({
                TableName: USERS_TABLE,
                Key: { userId: id },
                UpdateExpression: 'SET habilitado = :habilitado, estado = :estado, firmaEnrolamiento = :firmaEnrolamiento, updatedAt = :updatedAt',
                ExpressionAttributeValues: {
                    ':habilitado': true,
                    ':estado': 'activo',
                    ':firmaEnrolamiento': firmaEnrolamiento,
                    ':updatedAt': now.toISOString(),
                },
            })
        );

        return success({
            message: 'Enrolamiento completado exitosamente. El usuario está ahora habilitado.',
            userId: id,
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

// Exportar roles para uso en otros handlers
module.exports.ROLES = ROLES;
