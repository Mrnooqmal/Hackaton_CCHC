const { v4: uuidv4 } = require('uuid');
const { PutCommand, GetCommand, ScanCommand, UpdateCommand, DeleteCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient } = require('../lib/dynamodb');
const { success, error } = require('../lib/response');
const { validateRut, validateRequired, hashPin, verifyPin, validatePin, hashPassword, verifyPassword } = require('../lib/validation');
const crypto = require('crypto');

const USERS_TABLE = process.env.USERS_TABLE || 'Users';
const SESSIONS_TABLE = process.env.SESSIONS_TABLE || 'Sessions';

// Duración de sesión en horas
const SESSION_DURATION_HOURS = 24;

/**
 * Genera un token de sesión seguro
 */
const generateSessionToken = () => {
    return crypto.randomBytes(32).toString('hex');
};

/**
 * POST /auth/login - Iniciar sesión
 * 
 * Body: {
 *   rut: string,       // RUT del usuario
 *   password: string   // Contraseña alfanumérica
 * }
 */
module.exports.login = async (event) => {
    try {
        const body = JSON.parse(event.body || '{}');

        const validation = validateRequired(body, ['rut', 'password']);
        if (!validation.valid) {
            return error(`Campos requeridos faltantes: ${validation.missing.join(', ')}`);
        }

        const { rut, password } = body;

        // Validar formato de RUT
        const rutValidation = validateRut(rut);
        if (!rutValidation.valid) {
            return error('RUT inválido');
        }

        // Buscar usuario por RUT
        const userResult = await docClient.send(
            new ScanCommand({
                TableName: USERS_TABLE,
                FilterExpression: 'rut = :rut',
                ExpressionAttributeValues: {
                    ':rut': rutValidation.formatted,
                },
            })
        );

        if (!userResult.Items || userResult.Items.length === 0) {
            return error('Credenciales inválidas', 401);
        }

        const user = userResult.Items[0];

        // Verificar estado del usuario
        if (user.estado === 'suspendido') {
            return error('Usuario suspendido. Contacte al administrador.', 403);
        }

        // Verificar Contraseña
        const passValido = verifyPassword(password, user.passwordHash, user.userId);
        if (!passValido) {
            return error('Credenciales inválidas', 401);
        }

        const now = new Date();
        const expiresAt = new Date(now.getTime() + SESSION_DURATION_HOURS * 60 * 60 * 1000);

        // Crear sesión
        const sessionId = uuidv4();
        const token = generateSessionToken();

        const session = {
            sessionId,
            userId: user.userId,
            token,
            ipAddress: event.requestContext?.http?.sourceIp ||
                event.requestContext?.identity?.sourceIp || 'unknown',
            userAgent: event.headers?.['user-agent'] || 'unknown',
            createdAt: now.toISOString(),
            expiresAt: expiresAt.toISOString(),
            lastActivity: now.toISOString(),
            activa: true
        };

        await docClient.send(
            new PutCommand({
                TableName: SESSIONS_TABLE,
                Item: session,
            })
        );

        // Actualizar último acceso del usuario
        await docClient.send(
            new UpdateCommand({
                TableName: USERS_TABLE,
                Key: { userId: user.userId },
                UpdateExpression: 'SET ultimoAcceso = :ultimoAcceso',
                ExpressionAttributeValues: {
                    ':ultimoAcceso': now.toISOString(),
                },
            })
        );

        // Preparar respuesta (sin exponer hashes)
        const { passwordHash, pinHash, ...safeUser } = user;

        return success({
            message: 'Inicio de sesión exitoso',
            token,
            sessionId,
            expiresAt: expiresAt.toISOString(),
            user: safeUser,
            requiereCambioPassword: user.passwordTemporal,
            requiereEnrolamiento: !user.habilitado
        });
    } catch (err) {
        console.error('Error in login:', err);
        return error(err.message, 500);
    }
};

/**
 * POST /auth/change-password - Cambiar Contraseña
 * 
 * Body: {
 *   userId: string,
 *   passwordActual: string,
 *   passwordNuevo: string,
 *   confirmarPassword: string
 * }
 */
module.exports.changePassword = async (event) => {
    try {
        const body = JSON.parse(event.body || '{}');

        const validation = validateRequired(body, ['userId', 'passwordActual', 'passwordNuevo', 'confirmarPassword']);
        if (!validation.valid) {
            return error(`Campos requeridos faltantes: ${validation.missing.join(', ')}`);
        }

        const { userId, passwordActual, passwordNuevo, confirmarPassword } = body;

        // Validar que coincidan
        if (passwordNuevo !== confirmarPassword) {
            return error('Las contraseñas no coinciden');
        }

        // Validar que no sea demasiado corta
        if (passwordNuevo.length < 6) {
            return error('La contraseña debe tener al menos 6 caracteres');
        }

        // Obtener usuario
        const userResult = await docClient.send(
            new GetCommand({
                TableName: USERS_TABLE,
                Key: { userId },
            })
        );

        if (!userResult.Item) {
            return error('Usuario no encontrado', 404);
        }

        const user = userResult.Item;

        // Verificar contraseña actual
        const passValido = verifyPassword(passwordActual, user.passwordHash, userId);
        if (!passValido) {
            return error('Contraseña actual incorrecta', 401);
        }

        // Actualizar Contraseña
        const now = new Date().toISOString();
        const newPasswordHash = hashPassword(passwordNuevo, userId);

        await docClient.send(
            new UpdateCommand({
                TableName: USERS_TABLE,
                Key: { userId },
                UpdateExpression: 'SET passwordHash = :passwordHash, passwordTemporal = :passwordTemporal, passwordCreatedAt = :passwordCreatedAt, updatedAt = :updatedAt',
                ExpressionAttributeValues: {
                    ':passwordHash': newPasswordHash,
                    ':passwordTemporal': false,
                    ':passwordCreatedAt': now,
                    ':updatedAt': now,
                },
            })
        );

        return success({
            message: 'Contraseña actualizada exitosamente',
            passwordTemporal: false
        });
    } catch (err) {
        console.error('Error changing password:', err);
        return error(err.message, 500);
    }
};

/**
 * POST /auth/logout - Cerrar sesión
 * 
 * Body: {
 *   sessionId: string
 * }
 */
module.exports.logout = async (event) => {
    try {
        const body = JSON.parse(event.body || '{}');

        if (!body.sessionId) {
            return error('sessionId es requerido');
        }

        // Marcar sesión como inactiva
        await docClient.send(
            new UpdateCommand({
                TableName: SESSIONS_TABLE,
                Key: { sessionId: body.sessionId },
                UpdateExpression: 'SET activa = :activa',
                ExpressionAttributeValues: {
                    ':activa': false,
                },
            })
        );

        return success({
            message: 'Sesión cerrada exitosamente'
        });
    } catch (err) {
        console.error('Error in logout:', err);
        return error(err.message, 500);
    }
};

/**
 * GET /auth/me - Obtener usuario actual desde token
 * 
 * Headers: {
 *   Authorization: "Bearer <token>"
 * }
 */
module.exports.me = async (event) => {
    try {
        const authHeader = event.headers?.authorization || event.headers?.Authorization;

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return error('Token no proporcionado', 401);
        }

        const token = authHeader.substring(7);

        // Buscar sesión por token
        const sessionResult = await docClient.send(
            new ScanCommand({
                TableName: SESSIONS_TABLE,
                FilterExpression: '#token = :token AND activa = :activa',
                ExpressionAttributeNames: {
                    '#token': 'token'
                },
                ExpressionAttributeValues: {
                    ':token': token,
                    ':activa': true,
                },
            })
        );

        if (!sessionResult.Items || sessionResult.Items.length === 0) {
            return error('Sesión inválida o expirada', 401);
        }

        const session = sessionResult.Items[0];

        // Verificar que no haya expirado
        if (new Date(session.expiresAt) < new Date()) {
            // Marcar como inactiva
            await docClient.send(
                new UpdateCommand({
                    TableName: SESSIONS_TABLE,
                    Key: { sessionId: session.sessionId },
                    UpdateExpression: 'SET activa = :activa',
                    ExpressionAttributeValues: { ':activa': false },
                })
            );
            return error('Sesión expirada', 401);
        }

        // Obtener usuario
        const userResult = await docClient.send(
            new GetCommand({
                TableName: USERS_TABLE,
                Key: { userId: session.userId },
            })
        );

        if (!userResult.Item) {
            return error('Usuario no encontrado', 404);
        }

        // Actualizar última actividad
        await docClient.send(
            new UpdateCommand({
                TableName: SESSIONS_TABLE,
                Key: { sessionId: session.sessionId },
                UpdateExpression: 'SET lastActivity = :lastActivity',
                ExpressionAttributeValues: {
                    ':lastActivity': new Date().toISOString(),
                },
            })
        );

        const { passwordHash, pinHash, ...safeUser } = userResult.Item;

        return success({
            user: safeUser,
            session: {
                sessionId: session.sessionId,
                expiresAt: session.expiresAt,
                lastActivity: new Date().toISOString()
            }
        });
    } catch (err) {
        console.error('Error in me:', err);
        return error(err.message, 500);
    }
};

/**
 * POST /auth/validate-token - Validar si un token es válido
 */
module.exports.validateToken = async (event) => {
    try {
        const body = JSON.parse(event.body || '{}');

        if (!body.token) {
            return error('Token es requerido');
        }

        // Buscar sesión por token
        const sessionResult = await docClient.send(
            new ScanCommand({
                TableName: SESSIONS_TABLE,
                FilterExpression: '#token = :token AND activa = :activa',
                ExpressionAttributeNames: {
                    '#token': 'token'
                },
                ExpressionAttributeValues: {
                    ':token': body.token,
                    ':activa': true,
                },
            })
        );

        if (!sessionResult.Items || sessionResult.Items.length === 0) {
            return success({ valid: false, reason: 'Token no encontrado' });
        }

        const session = sessionResult.Items[0];

        // Verificar expiración
        if (new Date(session.expiresAt) < new Date()) {
            return success({ valid: false, reason: 'Token expirado' });
        }

        return success({
            valid: true,
            userId: session.userId,
            expiresAt: session.expiresAt
        });
    } catch (err) {
        console.error('Error validating token:', err);
        return error(err.message, 500);
    }
};
