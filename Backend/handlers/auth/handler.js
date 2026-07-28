/**
 * Auth Handler (Refactored for Multi-Tenant)
 * 
 * Usa PersonasTable en vez de UsersTable.
 * Login por RUT busca via GSI tenantRut-index (con tenantId del body)
 * o via email-index (cross-tenant).
 * Sessions incluyen tenantId y personaId.
 */

const { v4: uuidv4 } = require('uuid');
const { PutCommand, GetCommand, ScanCommand, UpdateCommand, QueryCommand, DeleteCommand } = require('@aws-sdk/lib-dynamodb');
const { GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { docClient } = require('../../lib/clients/dynamodb');
const { s3Client } = require('../../lib/clients/s3');
const { success, error } = require('../../lib/utils/response');
const { validateRut, validateRequired, hashPassword, verifyPassword } = require('../../lib/utils/validation');
const { PersonaService } = require('../../lib/services/PersonaService');
const { TenantService } = require('../../lib/services/TenantService');
const { resolvePersonaPermisos } = require('../../lib/permissions');
const crypto = require('crypto');

const SESSIONS_TABLE = process.env.SESSIONS_TABLE || 'Sessions';
const SESSION_DURATION_HOURS = 6;
const SELECTION_TOKEN_MINUTES = 5;
const BUCKET_NAME = process.env.DOCUMENTS_BUCKET;

const personaService = new PersonaService();
const tenantService = new TenantService();

/**
 * Construye el payload de usuario con permisos resueltos dinámicamente
 * desde la definición de rol del tenant (admin => todos).
 */
const buildUserPayload = async (persona) => {
    let permisos = [];
    let branding = null;
    try {
        const tenant = await tenantService.getById(persona.tenantId);
        const tenantData = tenant ? tenant.toSafeFormat() : null;
        permisos = resolvePersonaPermisos(persona, tenantData);
        if (tenantData?.preferencias) {
            const prefs = tenantData.preferencias;
            let logoUrl = null;
            if (prefs.logoKey && BUCKET_NAME) {
                try {
                    logoUrl = await getSignedUrl(
                        s3Client,
                        new GetObjectCommand({ Bucket: BUCKET_NAME, Key: prefs.logoKey }),
                        { expiresIn: SESSION_DURATION_HOURS * 3600 }
                    );
                } catch (urlErr) {
                    console.error('Failed to generate logo presigned URL:', urlErr);
                }
            }
            branding = {
                logoUrl,
                colorPrimario: prefs.colorPrimario || null,
            };
        }
    } catch (permErr) {
        console.error('Error resolviendo permisos:', permErr);
        permisos = resolvePersonaPermisos(persona, null);
    }
    return { ...persona.toSafeFormat(), permisos, branding };
};

const generateSessionToken = () => {
    return crypto.randomBytes(32).toString('hex');
};

/**
 * Crea la sesión real para una ficha ya resuelta (persona × tenant) y arma la
 * respuesta de login exitoso. Compartido por login() (caso de una sola
 * empresa) y selectTenant() (tras elegir empresa cuando hay varias).
 * Re-valida acceso web y estado por si cambiaron entre el login y la
 * selección (o si la ficha llega directo desde login()).
 */
const crearSesionParaPersona = async (persona, event) => {
    if (!persona.tieneAccesoWeb) {
        return error('Este usuario no tiene acceso web. Use la app móvil.', 403);
    }
    if (['suspendido', 'inactivo', 'desvinculado'].includes(persona.estado)) {
        return error('Usuario suspendido o desvinculado. Contacte al administrador.', 403);
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + SESSION_DURATION_HOURS * 60 * 60 * 1000);
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
        user: await buildUserPayload(persona),
        tenantId: persona.tenantId,
        requiereCambioPassword: persona.passwordTemporal,
        requiereEnrolamiento: !persona.habilitado
    });
};

/**
 * POST /auth/login - Iniciar sesión
 *
 * Body: { rut, password }
 * Una persona puede pertenecer a varias empresas (mismo RUT, contraseña
 * compartida — ver PersonaService.propagarPassword). La credencial se valida
 * UNA vez contra cualquier ficha con acceso web que coincida; si la identidad
 * pertenece a una sola empresa con acceso activo, entra directo. Si pertenece
 * a varias, se devuelve un token corto para elegir empresa (ver selectTenant).
 */
module.exports.login = async (event) => {
    try {
        const body = JSON.parse(event.body || '{}');

        const validation = validateRequired(body, ['rut', 'password']);
        if (!validation.valid) {
            return error(`Campos requeridos faltantes: ${validation.missing.join(', ')}`);
        }

        const { rut, password } = body;

        const rutValidation = validateRut(rut);
        if (!rutValidation.valid) {
            return error('RUT inválido');
        }

        const todas = await personaService.getAllByRutGlobal(rutValidation.formatted);

        // Identidad: la contraseña debe coincidir con AL MENOS una ficha con
        // acceso web (cualquier estado — incluso desvinculada, para poder
        // distinguir "contraseña incorrecta" de "sin empresas activas").
        const candidatas = todas.filter((p) => p.tieneAccesoWeb && p._passwordHash);
        const autenticado = candidatas.some((p) => verifyPassword(password, p._passwordHash, p.personaId));
        if (!autenticado) {
            return error('Credenciales inválidas', 401);
        }

        const seleccionables = todas.filter((p) =>
            p.tieneAccesoWeb && !['desvinculado', 'suspendido', 'inactivo'].includes(p.estado));
        if (seleccionables.length === 0) {
            return error('No tienes acceso web activo en ninguna empresa. Contacta a tu administrador.', 403);
        }

        if (seleccionables.length === 1) {
            return await crearSesionParaPersona(seleccionables[0], event);
        }

        // Pertenece a varias empresas: se pide elegir antes de crear sesión.
        const now = new Date();
        const expiresAt = new Date(now.getTime() + SELECTION_TOKEN_MINUTES * 60 * 1000);
        const selectionToken = crypto.randomBytes(32).toString('hex');

        await docClient.send(new PutCommand({
            TableName: SESSIONS_TABLE,
            Item: {
                sessionId: selectionToken,
                activa: false,
                pendienteSeleccion: true,
                rut: rutValidation.formatted,
                opciones: seleccionables.map((p) => ({ personaId: p.personaId, tenantId: p.tenantId })),
                createdAt: now.toISOString(),
                expiresAt: expiresAt.toISOString(),
                ttl: Math.floor(expiresAt.getTime() / 1000)
            }
        }));

        const opciones = await Promise.all(seleccionables.map(async (p) => {
            const tenant = await tenantService.getById(p.tenantId).catch(() => null);
            return { tenantId: p.tenantId, tenantNombre: tenant?.nombre || p.tenantId, rol: p.rol };
        }));

        return success({ requiereSeleccionTenant: true, selectionToken, opciones });
    } catch (err) {
        console.error('Error in login:', err);
        return error(err.message, 500);
    }
};

/**
 * POST /auth/select-tenant - Segundo paso del login cuando la persona
 * pertenece a varias empresas.
 * Body: { selectionToken, tenantId }
 */
module.exports.selectTenant = async (event) => {
    try {
        const body = JSON.parse(event.body || '{}');
        const validation = validateRequired(body, ['selectionToken', 'tenantId']);
        if (!validation.valid) {
            return error(`Campos requeridos faltantes: ${validation.missing.join(', ')}`);
        }

        const { selectionToken, tenantId } = body;
        const invalidMsg = 'La selección expiró o es inválida. Inicia sesión nuevamente.';

        const pendingResult = await docClient.send(new GetCommand({
            TableName: SESSIONS_TABLE,
            Key: { sessionId: selectionToken }
        }));
        const pending = pendingResult.Item;
        if (!pending || !pending.pendienteSeleccion) {
            return error(invalidMsg, 401);
        }
        if (new Date(pending.expiresAt) < new Date()) {
            return error(invalidMsg, 401);
        }
        const opcionValida = (pending.opciones || []).some((o) => o.tenantId === tenantId);
        if (!opcionValida) {
            return error('Empresa no válida para esta selección.', 401);
        }

        const persona = await personaService.getByRut(tenantId, pending.rut);
        if (!persona) return error('Persona no encontrada', 404);

        // Un solo uso.
        await docClient.send(new DeleteCommand({
            TableName: SESSIONS_TABLE,
            Key: { sessionId: selectionToken }
        })).catch(() => {});

        return await crearSesionParaPersona(persona, event);
    } catch (err) {
        console.error('Error in selectTenant:', err);
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

        const validation = validateRequired(body, ['personaId', 'passwordNuevo', 'confirmarPassword']);
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

        // En el primer ingreso (contraseña temporal) el usuario ya se validó al
        // iniciar sesión con la temporal, así que no se le vuelve a pedir la actual.
        // En cambios posteriores sí se exige y verifica la contraseña vigente.
        if (!persona.passwordTemporal) {
            if (!passwordActual) return error('Campos requeridos faltantes: passwordActual');
            const passValido = verifyPassword(passwordActual, persona._passwordHash, personaId);
            if (!passValido) return error('Contraseña actual incorrecta', 401);
        }

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
        // Mantiene la contraseña "única" para toda la identidad (mismo RUT en
        // otras empresas).
        await personaService.propagarPassword(persona, passwordNuevo, { passwordTemporal: false });

        return success({ message: 'Contraseña actualizada exitosamente', passwordTemporal: false });
    } catch (err) {
        console.error('Error changing password:', err);
        return error(err.message, 500);
    }
};

// Hash de un token de reset (no se guarda el token en claro, solo su hash).
const hashResetToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

// Busca una persona por RUT sin conocer el tenant (mismo patrón que el login).
const findPersonaByRut = async (rutFormatted) => {
    const scanResult = await docClient.send(new ScanCommand({
        TableName: process.env.PERSONAS_TABLE || 'Personas',
        IndexName: 'tenantRut-index',
        FilterExpression: 'rut = :rut',
        ExpressionAttributeValues: { ':rut': rutFormatted }
    }));
    if (scanResult.Items && scanResult.Items.length > 0) {
        const { Persona } = require('../../lib/models/Persona');
        return Persona.fromDynamoItem(scanResult.Items[0]);
    }
    return null;
};

const RESET_TOKEN_MINUTES = 30;

/**
 * POST /auth/forgot-password - Solicitar recuperación de contraseña
 * Body: { rut }
 * Respuesta genérica (anti-enumeración): nunca revela si el RUT existe.
 */
module.exports.forgotPassword = async (event) => {
    // Mensaje único para cualquier caso (exista o no el RUT, tenga o no email).
    const genericResponse = success({
        message: 'Si el RUT está registrado y tiene un correo asociado, te enviamos instrucciones para restablecer tu contraseña.'
    });

    try {
        const body = JSON.parse(event.body || '{}');
        const validation = validateRequired(body, ['rut']);
        if (!validation.valid) {
            return error(`Campos requeridos faltantes: ${validation.missing.join(', ')}`);
        }

        const rutValidation = validateRut(body.rut);
        if (!rutValidation.valid) {
            // No filtramos detalle: respuesta genérica igual.
            return genericResponse;
        }

        const persona = await findPersonaByRut(rutValidation.formatted);
        // Solo enviamos correo si la persona existe, tiene acceso web y email.
        if (!persona || !persona.tieneAccesoWeb || !persona.email) {
            return genericResponse;
        }

        const token = crypto.randomBytes(32).toString('hex');
        const tokenHash = hashResetToken(token);
        const expiry = new Date(Date.now() + RESET_TOKEN_MINUTES * 60 * 1000).toISOString();
        const now = new Date().toISOString();

        await docClient.send(new UpdateCommand({
            TableName: process.env.PERSONAS_TABLE || 'Personas',
            Key: {
                PK: `TENANT#${persona.tenantId}`,
                SK: `PERSONA#${persona.personaId}`
            },
            UpdateExpression: 'SET resetTokenHash = :th, resetTokenExpiry = :te, updatedAt = :u',
            ExpressionAttributeValues: { ':th': tokenHash, ':te': expiry, ':u': now }
        }));

        const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
        const resetUrl = `${frontendUrl}/restablecer-clave?pid=${persona.personaId}&token=${token}`;
        const { sendPasswordResetEmail } = require('../notifications/handler');
        const nombre = [persona.nombre, persona.apellido].filter(Boolean).join(' ') || persona.nombre || 'usuario';
        try {
            await sendPasswordResetEmail(persona.email, nombre, resetUrl, RESET_TOKEN_MINUTES);
        } catch (mailErr) {
            console.error('Error enviando email de recuperación:', mailErr.message);
        }

        return genericResponse;
    } catch (err) {
        console.error('Error in forgotPassword:', err);
        // Incluso ante error interno devolvemos genérico para no filtrar información.
        return genericResponse;
    }
};

/**
 * POST /auth/reset-password - Restablecer contraseña con token de un solo uso
 * Body: { personaId, token, passwordNuevo, confirmarPassword }
 */
module.exports.resetPassword = async (event) => {
    try {
        const body = JSON.parse(event.body || '{}');
        const validation = validateRequired(body, ['personaId', 'token', 'passwordNuevo', 'confirmarPassword']);
        if (!validation.valid) {
            return error(`Campos requeridos faltantes: ${validation.missing.join(', ')}`);
        }

        const { personaId, token, passwordNuevo, confirmarPassword } = body;

        if (passwordNuevo !== confirmarPassword) {
            return error('Las contraseñas no coinciden');
        }
        if (passwordNuevo.length < 6) {
            return error('La contraseña debe tener al menos 6 caracteres');
        }

        // Leemos el item crudo (no via modelo): el constructor de Persona no
        // preserva resetTokenHash/resetTokenExpiry, así que los consultamos directo.
        const personaQuery = await docClient.send(new QueryCommand({
            TableName: process.env.PERSONAS_TABLE || 'Personas',
            IndexName: 'personaId-index',
            KeyConditionExpression: 'personaId = :pid',
            ExpressionAttributeValues: { ':pid': personaId }
        }));
        const personaItem = personaQuery.Items && personaQuery.Items[0];

        // Mensaje único para token inválido/expirado/persona inexistente.
        const invalidMsg = 'El enlace de recuperación es inválido o expiró. Solicita uno nuevo.';
        if (!personaItem || !personaItem.resetTokenHash || !personaItem.resetTokenExpiry) {
            return error(invalidMsg, 400);
        }
        if (new Date(personaItem.resetTokenExpiry) < new Date()) {
            return error(invalidMsg, 400);
        }
        if (hashResetToken(token) !== personaItem.resetTokenHash) {
            return error(invalidMsg, 400);
        }

        const now = new Date().toISOString();
        const newPasswordHash = hashPassword(passwordNuevo, personaId);

        await docClient.send(new UpdateCommand({
            TableName: process.env.PERSONAS_TABLE || 'Personas',
            Key: {
                PK: `TENANT#${personaItem.tenantId}`,
                SK: `PERSONA#${personaId}`
            },
            UpdateExpression: 'SET passwordHash = :ph, passwordTemporal = :pt, updatedAt = :u REMOVE resetTokenHash, resetTokenExpiry',
            ExpressionAttributeValues: {
                ':ph': newPasswordHash,
                ':pt': false,
                ':u': now
            }
        }));
        // Mantiene la contraseña "única" para toda la identidad (mismo RUT en
        // otras empresas).
        await personaService.propagarPassword(personaItem, passwordNuevo, { passwordTemporal: false });

        return success({ message: 'Contraseña restablecida exitosamente. Ya puedes iniciar sesión.' });
    } catch (err) {
        console.error('Error in resetPassword:', err);
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
            user: await buildUserPayload(persona),
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
