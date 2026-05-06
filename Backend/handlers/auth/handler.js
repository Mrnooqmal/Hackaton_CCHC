/**
 * Auth Handler (Refactored for Multi-Tenant)
 * 
 * Usa PersonasTable en vez de UsersTable.
 * Login por RUT busca via GSI tenantRut-index (con tenantId del body)
 * o via email-index (cross-tenant).
 * Sessions incluyen tenantId y personaId.
 */

const { v4: uuidv4 } = require('uuid');
const { PutCommand, GetCommand, ScanCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient } = require('../../lib/clients/dynamodb');
const { success, error } = require('../../lib/utils/response');
const { validateRut, validateRequired, hashPassword, verifyPassword } = require('../../lib/utils/validation');
const { PersonaService } = require('../../lib/services/PersonaService');
const crypto = require('crypto');

const SESSIONS_TABLE = process.env.SESSIONS_TABLE || 'Sessions';
const SESSION_DURATION_HOURS = 24;

const personaService = new PersonaService();

const generateSessionToken = () => {
    return crypto.randomBytes(32).toString('hex');
};

/**
 * POST /auth/login - Iniciar sesión
 * 
 * Body: { rut, password, tenantId? }
 * tenantId es opcional: si no viene, se busca por email cross-tenant
 */
module.exports.login = async (event) => {
    try {
        const body = JSON.parse(event.body || '{}');

        const validation = validateRequired(body, ['rut', 'password']);
        if (!validation.valid) {
            return error(`Campos requeridos faltantes: ${validation.missing.join(', ')}`);
        }

        const { rut, password, tenantId } = body;

        const rutValidation = validateRut(rut);
        if (!rutValidation.valid) {
            return error('RUT inválido');
        }

        // Buscar persona por RUT dentro del tenant
        let persona = null;
        if (tenantId) {
            persona = await personaService.getByRut(tenantId, rutValidation.formatted);
        }

        // Si no se encontró y no se dio tenantId, intentar buscar cross-tenant por email
        // (fallback para compatibilidad)
        if (!persona) {
            // Fallback: buscar en PersonasTable por RUT (GSI tenantRut no funciona sin tenantId)
            // En producción con Cognito esto se resuelve con el JWT
            const { QueryCommand: QC } = require('@aws-sdk/lib-dynamodb');
            // Por ahora, usar un approach legacy temporal
            const { ScanCommand: SC } = require('@aws-sdk/lib-dynamodb');
            const scanResult = await docClient.send(new SC({
                TableName: process.env.PERSONAS_TABLE || 'Personas',
                IndexName: 'tenantRut-index',
                FilterExpression: 'rut = :rut',
                ExpressionAttributeValues: { ':rut': rutValidation.formatted }
            }));
            if (scanResult.Items && scanResult.Items.length > 0) {
                const { Persona } = require('../../lib/models/Persona');
                persona = Persona.fromDynamoItem(scanResult.Items[0]);
            }
        }

        if (!persona) {
            return error('Credenciales inválidas', 401);
        }

        if (!persona.tieneAccesoWeb) {
            return error('Este usuario no tiene acceso web. Use la app móvil.', 403);
        }

        if (persona.estado === 'suspendido' || persona.estado === 'inactivo') {
            return error('Usuario suspendido. Contacte al administrador.', 403);
        }

        // Verificar contraseña (hasheada con personaId)
        const passValido = verifyPassword(password, persona._passwordHash, persona.personaId);
        if (!passValido) {
            return error('Credenciales inválidas', 401);
        }

        const now = new Date();
        const expiresAt = new Date(now.getTime() + SESSION_DURATION_HOURS * 60 * 60 * 1000);

        // Crear sesión con tenantId y personaId
        const sessionId = uuidv4();
        const token = generateSessionToken();

        const session = {
            sessionId,
            personaId: persona.personaId,
            tenantId: persona.tenantId,
            token,
            ipAddress: event.requestContext?.http?.sourceIp
                || event.requestContext?.identity?.sourceIp || 'unknown',
            userAgent: event.headers?.['user-agent'] || 'unknown',
            createdAt: now.toISOString(),
            expiresAt: expiresAt.toISOString(),
            lastActivity: now.toISOString(),
            activa: true,
            // TTL para auto-cleanup de DynamoDB
            ttl: Math.floor(expiresAt.getTime() / 1000)
        };

        await docClient.send(new PutCommand({
            TableName: SESSIONS_TABLE,
            Item: session
        }));

        // Actualizar último acceso
        await docClient.send(new UpdateCommand({
            TableName: process.env.PERSONAS_TABLE || 'Personas',
            Key: {
                PK: `TENANT#${persona.tenantId}`,
                SK: `PERSONA#${persona.personaId}`
            },
            UpdateExpression: 'SET ultimoAcceso = :ultimoAcceso',
            ExpressionAttributeValues: { ':ultimoAcceso': now.toISOString() }
        }));

        return success({
            message: 'Inicio de sesión exitoso',
            token,
            sessionId,
            expiresAt: expiresAt.toISOString(),
            user: persona.toSafeFormat(),
            tenantId: persona.tenantId,
            requiereCambioPassword: persona.passwordTemporal,
            requiereEnrolamiento: !persona.habilitado
        });
    } catch (err) {
        console.error('Error in login:', err);
        return error(err.message, 500);
    }
};

/**
 * POST /auth/change-password - Cambiar Contraseña
 * Body: { personaId, tenantId, passwordActual, passwordNuevo, confirmarPassword }
 */
module.exports.changePassword = async (event) => {
    try {
        const body = JSON.parse(event.body || '{}');

        const validation = validateRequired(body, ['personaId', 'passwordActual', 'passwordNuevo', 'confirmarPassword']);
        if (!validation.valid) {
            return error(`Campos requeridos faltantes: ${validation.missing.join(', ')}`);
        }

        const { personaId, passwordActual, passwordNuevo, confirmarPassword } = body;

        if (passwordNuevo !== confirmarPassword) {
            return error('Las contraseñas no coinciden');
        }
        if (passwordNuevo.length < 6) {
            return error('La contraseña debe tener al menos 6 caracteres');
        }

        const persona = await personaService.getById(personaId);
        if (!persona) return error('Usuario no encontrado', 404);

        const passValido = verifyPassword(passwordActual, persona._passwordHash, personaId);
        if (!passValido) return error('Contraseña actual incorrecta', 401);

        const now = new Date().toISOString();
        const newPasswordHash = hashPassword(passwordNuevo, personaId);

        await docClient.send(new UpdateCommand({
            TableName: process.env.PERSONAS_TABLE || 'Personas',
            Key: {
                PK: `TENANT#${persona.tenantId}`,
                SK: `PERSONA#${personaId}`
            },
            UpdateExpression: 'SET passwordHash = :passwordHash, passwordTemporal = :passwordTemporal, updatedAt = :updatedAt',
            ExpressionAttributeValues: {
                ':passwordHash': newPasswordHash,
                ':passwordTemporal': false,
                ':updatedAt': now
            }
        }));

        return success({ message: 'Contraseña actualizada exitosamente', passwordTemporal: false });
    } catch (err) {
        console.error('Error changing password:', err);
        return error(err.message, 500);
    }
};

/**
 * POST /auth/logout - Cerrar sesión
 */
module.exports.logout = async (event) => {
    try {
        const body = JSON.parse(event.body || '{}');
        if (!body.sessionId) return error('sessionId es requerido');

        await docClient.send(new UpdateCommand({
            TableName: SESSIONS_TABLE,
            Key: { sessionId: body.sessionId },
            UpdateExpression: 'SET activa = :activa',
            ExpressionAttributeValues: { ':activa': false }
        }));

        return success({ message: 'Sesión cerrada exitosamente' });
    } catch (err) {
        console.error('Error in logout:', err);
        return error(err.message, 500);
    }
};

/**
 * GET /auth/me - Obtener usuario actual desde token
 */
module.exports.me = async (event) => {
    try {
        const authHeader = event.headers?.authorization || event.headers?.Authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return error('Token no proporcionado', 401);
        }

        const token = authHeader.substring(7);

        // Buscar sesión por token (Scan temporal — en prod Cognito resuelve esto)
        const sessionResult = await docClient.send(new ScanCommand({
            TableName: SESSIONS_TABLE,
            FilterExpression: '#token = :token AND activa = :activa',
            ExpressionAttributeNames: { '#token': 'token' },
            ExpressionAttributeValues: { ':token': token, ':activa': true }
        }));

        if (!sessionResult.Items || sessionResult.Items.length === 0) {
            return error('Sesión inválida o expirada', 401);
        }

        const session = sessionResult.Items[0];

        if (new Date(session.expiresAt) < new Date()) {
            await docClient.send(new UpdateCommand({
                TableName: SESSIONS_TABLE,
                Key: { sessionId: session.sessionId },
                UpdateExpression: 'SET activa = :activa',
                ExpressionAttributeValues: { ':activa': false }
            }));
            return error('Sesión expirada', 401);
        }

        // Obtener persona
        const persona = await personaService.getById(session.personaId);
        if (!persona) return error('Usuario no encontrado', 404);

        // Actualizar última actividad
        await docClient.send(new UpdateCommand({
            TableName: SESSIONS_TABLE,
            Key: { sessionId: session.sessionId },
            UpdateExpression: 'SET lastActivity = :lastActivity',
            ExpressionAttributeValues: { ':lastActivity': new Date().toISOString() }
        }));

        return success({
            user: persona.toSafeFormat(),
            tenantId: persona.tenantId,
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
        if (!body.token) return error('Token es requerido');

        const sessionResult = await docClient.send(new ScanCommand({
            TableName: SESSIONS_TABLE,
            FilterExpression: '#token = :token AND activa = :activa',
            ExpressionAttributeNames: { '#token': 'token' },
            ExpressionAttributeValues: { ':token': body.token, ':activa': true }
        }));

        if (!sessionResult.Items || sessionResult.Items.length === 0) {
            return success({ valid: false, reason: 'Token no encontrado' });
        }

        const session = sessionResult.Items[0];
        if (new Date(session.expiresAt) < new Date()) {
            return success({ valid: false, reason: 'Token expirado' });
        }

        return success({
            valid: true,
            personaId: session.personaId,
            tenantId: session.tenantId,
            expiresAt: session.expiresAt
        });
    } catch (err) {
        console.error('Error validating token:', err);
        return error(err.message, 500);
    }
};
