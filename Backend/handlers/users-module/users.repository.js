const { v4: uuidv4 } = require('uuid');
const { PutCommand, GetCommand, ScanCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient } = require('../../lib/dynamodb');
const {
    validateRut,
    validateRequired,
    hashPin,
    verifyPin,
    validatePin,
    generateSignatureToken,
    hashPassword,
    generateTempPassword
} = require('../../lib/validation');
const { assignWorkerToHealthSurvey } = require('../../lib/healthSurvey');
const { sendWelcomeEmail } = require('../notifications');

const USERS_TABLE = process.env.USERS_TABLE || 'Users';
const WORKERS_TABLE = process.env.WORKERS_TABLE || 'Workers';
const SIGNATURES_TABLE = process.env.SIGNATURES_TABLE || 'Signatures';

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

class UsersRepository {
    constructor() {
        this.dynamo = docClient;
        this.usersTable = USERS_TABLE;
        this.workersTable = WORKERS_TABLE;
        this.signaturesTable = SIGNATURES_TABLE;
    }

    async create(body) {
        const validation = validateRequired(body, ['rut', 'nombre', 'rol']);
        if (!validation.valid) {
            throw new Error(`Campos requeridos faltantes: ${validation.missing.join(', ')}`);
        }

        const rutValidation = validateRut(body.rut);
        if (!rutValidation.valid) {
            throw new Error('RUT inválido');
        }

        if (!ROLES[body.rol]) {
            throw new Error(`Rol inválido. Roles válidos: ${Object.keys(ROLES).join(', ')}`);
        }

        // Verificar existencia por RUT
        const existingUser = await this.dynamo.send(
            new ScanCommand({
                TableName: this.usersTable,
                FilterExpression: 'rut = :rut',
                ExpressionAttributeValues: { ':rut': rutValidation.formatted },
            })
        );

        if (existingUser.Items && existingUser.Items.length > 0) {
            throw new Error('Ya existe un usuario con este RUT');
        }

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
            rol: body.rol,
            permisos: ROLES[body.rol].permisos,
            passwordHash: hashPassword(passwordTemporal, userId),
            passwordTemporal: true,
            passwordCreatedAt: now,
            pinHash: null,
            habilitado: false,
            cargo: body.cargo || ROLES[body.rol].nombre,
            estado: 'pendiente',
            preferencias: { tema: 'dark', notificaciones: true, idioma: 'es' },
            avatar: null,
            empresaId: body.empresaId || 'default',
            workerId: null,
            creadoPor: body.creadoPor || 'system',
            createdAt: now,
            updatedAt: now,
            ultimoAcceso: null
        };

        let workerCreated = null;
        if (body.rol !== 'admin') {
            const workerId = uuidv4();
            user.workerId = workerId;

            const worker = {
                workerId,
                rut: rutValidation.formatted,
                nombre: body.nombre,
                apellido: body.apellido || '',
                email: body.email || '',
                telefono: body.telefono || '',
                cargo: body.cargo || ROLES[body.rol].nombre,
                empresaId: body.empresaId || 'default',
                fechaEnrolamiento: now,
                signatureToken: generateSignatureToken(),
                estado: 'activo',
                habilitado: false,
                pinHash: null,
                pinCreatedAt: null,
                firmaEnrolamiento: null,
                userId: userId,
                createdAt: now,
                updatedAt: now,
            };

            await this.dynamo.send(new PutCommand({ TableName: this.workersTable, Item: worker }));

            try {
                await assignWorkerToHealthSurvey(worker);
            } catch (error) {
                console.error('Error assigning health survey:', error);
            }

            workerCreated = { workerId, message: 'Worker creado y vinculado automáticamente' };
        }

        await this.dynamo.send(new PutCommand({ TableName: this.usersTable, Item: user }));

        let emailSent = false;
        if (user.email) {
            try {
                const emailResult = await sendWelcomeEmail(user.email, user.nombre, user.rut, passwordTemporal);
                emailSent = emailResult.sent;
            } catch (error) {
                console.error('Error sending welcome email:', error);
            }
        }

        return {
            message: 'Usuario creado exitosamente',
            user: {
                userId: user.userId,
                rut: user.rut,
                nombre: user.nombre,
                apellido: user.apellido,
                rol: user.rol,
                cargo: user.cargo,
                estado: user.estado,
                workerId: user.workerId
            },
            workerCreated,
            passwordTemporal,
            emailNotificado: emailSent,
            instrucciones: emailSent
                ? 'Se ha enviado un email con las credenciales al usuario'
                : 'El usuario debe cambiar esta contraseña en su primer acceso'
        };
    }

    async list({ empresaId, rol, estado }) {
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

        const params = { TableName: this.usersTable };
        if (filterExpression) {
            params.FilterExpression = filterExpression;
            params.ExpressionAttributeValues = expressionAttributeValues;
        }

        const result = await this.dynamo.send(new ScanCommand(params));
        const users = (result.Items || []).map(user => {
            const { pinHash, passwordHash, ...safeUser } = user;
            return safeUser;
        });

        return { total: users.length, users, roles: ROLES };
    }

    async get(id) {
        if (!id) throw new Error('ID de usuario requerido');

        const result = await this.dynamo.send(new GetCommand({
            TableName: this.usersTable,
            Key: { userId: id }
        }));

        if (!result.Item) throw new Error('Usuario no encontrado');

        const { passwordHash, pinHash, ...safeUser } = result.Item;
        return safeUser;
    }

    async getByRut(rut) {
        if (!rut) throw new Error('RUT requerido');

        const rutValidation = validateRut(rut);
        if (!rutValidation.valid) throw new Error('RUT inválido');

        const result = await this.dynamo.send(new ScanCommand({
            TableName: this.usersTable,
            FilterExpression: 'rut = :rut',
            ExpressionAttributeValues: { ':rut': rutValidation.formatted }
        }));

        if (!result.Items || result.Items.length === 0) throw new Error('Usuario no encontrado');

        const { passwordHash, pinHash, ...safeUser } = result.Items[0];
        return safeUser;
    }

    async update(id, body) {
        if (!id) throw new Error('ID de usuario requerido');

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

        if (updateExpressions.length === 0) throw new Error('No hay campos para actualizar');

        const now = new Date().toISOString();
        updateExpressions.push('#updatedAt = :updatedAt');
        expressionAttributeNames['#updatedAt'] = 'updatedAt';
        expressionAttributeValues[':updatedAt'] = now;

        const result = await this.dynamo.send(new UpdateCommand({
            TableName: this.usersTable,
            Key: { userId: id },
            UpdateExpression: `SET ${updateExpressions.join(', ')}`,
            ExpressionAttributeNames: expressionAttributeNames,
            ExpressionAttributeValues: expressionAttributeValues,
            ReturnValues: 'ALL_NEW',
        }));

        const { passwordHash, pinHash, ...safeUser } = result.Attributes;
        return safeUser;
    }

    async resetPassword(id) {
        if (!id) throw new Error('ID de usuario requerido');

        const userResult = await this.dynamo.send(new GetCommand({
            TableName: this.usersTable,
            Key: { userId: id }
        }));

        if (!userResult.Item) throw new Error('Usuario no encontrado');

        const passwordTemporal = generateTempPassword(10);
        const now = new Date().toISOString();

        await this.dynamo.send(new UpdateCommand({
            TableName: this.usersTable,
            Key: { userId: id },
            UpdateExpression: 'SET passwordHash = :passwordHash, passwordTemporal = :passwordTemporal, passwordCreatedAt = :passwordCreatedAt, updatedAt = :updatedAt',
            ExpressionAttributeValues: {
                ':passwordHash': hashPassword(passwordTemporal, id),
                ':passwordTemporal': true,
                ':passwordCreatedAt': now,
                ':updatedAt': now,
            }
        }));

        const user = userResult.Item;
        let emailSent = false;
        if (user.email) {
            try {
                const emailResult = await sendWelcomeEmail(user.email, user.nombre, user.rut, passwordTemporal);
                emailSent = emailResult.sent;
            } catch (error) {
                console.error('Error sending reset password email:', error);
            }
        }

        return {
            message: 'Contraseña reseteada exitosamente',
            userId: id,
            passwordTemporal,
            emailNotificado: emailSent,
            instrucciones: emailSent
                ? 'Se ha enviado un email con la nueva contraseña al usuario'
                : 'El usuario debe cambiar esta contraseña en su próximo acceso'
        };
    }

    async setPin(id, body) {
        if (!id) throw new Error('ID de usuario requerido');

        const { pin, pinActual } = body;
        const pinValidation = validatePin(pin);
        if (!pinValidation.valid) throw new Error(pinValidation.error);

        const userResult = await this.dynamo.send(new GetCommand({
            TableName: this.usersTable,
            Key: { userId: id }
        }));

        if (!userResult.Item) throw new Error('Usuario no encontrado');
        const user = userResult.Item;

        if (user.pinHash && user.habilitado) {
            if (!pinActual) throw new Error('PIN actual es requerido para cambiar el PIN');
            const pinActualValido = verifyPin(pinActual, user.pinHash, id);
            if (!pinActualValido) throw new Error('PIN actual incorrecto'); // Note: status 401 logic handled in handler
        }

        const now = new Date().toISOString();
        const newPinHash = hashPin(pin, id);

        await this.dynamo.send(new UpdateCommand({
            TableName: this.usersTable,
            Key: { userId: id },
            UpdateExpression: 'SET pinHash = :pinHash, pinCreatedAt = :pinCreatedAt, updatedAt = :updatedAt',
            ExpressionAttributeValues: {
                ':pinHash': newPinHash,
                ':pinCreatedAt': now,
                ':updatedAt': now,
            }
        }));

        if (user.workerId) {
            try {
                const pinHashForWorker = hashPin(pin, user.workerId);
                await this.dynamo.send(new UpdateCommand({
                    TableName: this.workersTable,
                    Key: { workerId: user.workerId },
                    UpdateExpression: 'SET pinHash = :pinHash, pinCreatedAt = :pinCreatedAt, updatedAt = :updatedAt',
                    ExpressionAttributeValues: {
                        ':pinHash': pinHashForWorker,
                        ':pinCreatedAt': now,
                        ':updatedAt': now,
                    }
                }));
            } catch (error) {
                console.error('Error syncing PIN to worker:', error);
            }
        }

        return {
            message: user.pinHash ? 'PIN actualizado exitosamente' : 'PIN configurado exitosamente',
            pinCreatedAt: now
        };
    }

    async completeEnrollment(id, body, eventContext) {
        if (!id) throw new Error('ID de usuario requerido');
        const { pin } = body;
        if (!pin) throw new Error('PIN es requerido para completar el enrolamiento');

        const userResult = await this.dynamo.send(new GetCommand({
            TableName: this.usersTable,
            Key: { userId: id }
        }));

        if (!userResult.Item) throw new Error('Usuario no encontrado');
        const user = userResult.Item;

        if (user.habilitado) {
            let needsWorkerSync = !user.workerId;
            if (user.workerId) {
                const workerRes = await this.dynamo.send(new GetCommand({
                    TableName: this.workersTable,
                    Key: { workerId: user.workerId }
                }));
                if (!workerRes.Item || !workerRes.Item.habilitado) needsWorkerSync = true;
            }
            if (!needsWorkerSync) throw new Error('El usuario y su perfil de trabajador ya están habilitados');
        }

        if (user.pinTemporal) throw new Error('Debe cambiar el PIN temporal antes de completar el enrolamiento');

        const pinValido = verifyPin(pin, user.pinHash, id);
        if (!pinValido) throw new Error('PIN incorrecto');

        const now = new Date();
        const token = generateSignatureToken();
        let effectiveWorkerId = user.workerId;

        if (!effectiveWorkerId) {
            const workerByRut = await this.dynamo.send(new ScanCommand({
                TableName: this.workersTable,
                FilterExpression: 'rut = :rut',
                ExpressionAttributeValues: { ':rut': user.rut }
            }));

            if (workerByRut.Items && workerByRut.Items.length > 0) {
                effectiveWorkerId = workerByRut.Items[0].workerId;
            } else {
                effectiveWorkerId = uuidv4();
                await this.dynamo.send(new PutCommand({
                    TableName: this.workersTable,
                    Item: {
                        workerId: effectiveWorkerId,
                        rut: user.rut,
                        nombre: user.nombre,
                        apellido: user.apellido || '',
                        cargo: user.cargo || user.rol,
                        empresaId: user.empresaId || 'default',
                        estado: 'activo',
                        habilitado: false,
                        userId: id,
                        createdAt: now.toISOString(),
                        updatedAt: now.toISOString()
                    }
                }));
            }
        }

        const ipAddress = eventContext?.requestContext?.http?.sourceIp ||
            eventContext?.requestContext?.identity?.sourceIp || 'unknown';
        const userAgent = eventContext?.headers?.['user-agent'] || 'unknown';

        const firmaEnrolamiento = {
            token,
            fecha: now.toISOString().split('T')[0],
            horario: now.toTimeString().split(' ')[0],
            timestamp: now.toISOString(),
            metodoValidacion: 'PIN',
            ipAddress
        };

        const signature = {
            signatureId: uuidv4(),
            token,
            workerId: effectiveWorkerId || id,
            userId: id,
            workerRut: user.rut,
            workerNombre: `${user.nombre} ${user.apellido || ''}`.trim(),
            tipoFirma: 'enrolamiento',
            referenciaId: id,
            referenciaTipo: 'user',
            fecha: firmaEnrolamiento.fecha,
            horario: firmaEnrolamiento.horario,
            timestamp: firmaEnrolamiento.timestamp,
            ipAddress,
            userAgent,
            metodoValidacion: 'PIN',
            metadata: { rol: user.rol, titulo: 'Enrolamiento Digital' },
            estado: 'valida',
            empresaId: user.empresaId || 'default',
            createdAt: now.toISOString()
        };

        await this.dynamo.send(new PutCommand({ TableName: this.signaturesTable, Item: signature }));

        const userUpdateExpression = 'SET habilitado = :habilitado, estado = :estado, firmaEnrolamiento = :firmaEnrolamiento, updatedAt = :updatedAt' + (effectiveWorkerId && !user.workerId ? ', workerId = :workerId' : '');
        const userExpressionValues = {
            ':habilitado': true,
            ':estado': 'activo',
            ':firmaEnrolamiento': firmaEnrolamiento,
            ':updatedAt': now.toISOString(),
        };
        if (effectiveWorkerId && !user.workerId) userExpressionValues[':workerId'] = effectiveWorkerId;

        await this.dynamo.send(new UpdateCommand({
            TableName: this.usersTable,
            Key: { userId: id },
            UpdateExpression: userUpdateExpression,
            ExpressionAttributeValues: userExpressionValues
        }));

        if (effectiveWorkerId) {
            try {
                const pinHashForWorker = hashPin(pin, effectiveWorkerId);
                await this.dynamo.send(new UpdateCommand({
                    TableName: this.workersTable,
                    Key: { workerId: effectiveWorkerId },
                    UpdateExpression: 'SET habilitado = :habilitado, firmaEnrolamiento = :firmaEnrolamiento, pinHash = :pinHash, updatedAt = :updatedAt, userId = :userId',
                    ExpressionAttributeValues: {
                        ':habilitado': true,
                        ':firmaEnrolamiento': firmaEnrolamiento,
                        ':pinHash': pinHashForWorker,
                        ':updatedAt': now.toISOString(),
                        ':userId': id
                    }
                }));
            } catch (error) {
                console.error('Error syncing worker:', error);
            }
        }

        return {
            message: 'Enrolamiento completado exitosamente',
            userId: id,
            workerId: effectiveWorkerId,
            habilitado: true,
            firma: {
                token: firmaEnrolamiento.token,
                fecha: firmaEnrolamiento.fecha,
                horario: firmaEnrolamiento.horario,
            }
        };
    }
}

module.exports = { UsersRepository, ROLES };
