/**
 * PersonaService (Refactored)
 * 
 * Opera sobre PersonasTable unicamente.
 * Elimina toda la logica de sincronizacion dual Users/Workers.
 * Un solo ID, un solo pinHash, queries por PK TENANT#{tenantId}.
 */

const { v4: uuidv4 } = require('uuid');
const { PutCommand, GetCommand, QueryCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient } = require('../clients/dynamodb');
const { Persona, ROLES } = require('../models/Persona');
const {
    validateRut, validateRequired, hashPin, verifyPin,
    validatePin, generateSignatureToken, hashPassword, generateTempPassword
} = require('../utils/validation');

const PERSONAS_TABLE = process.env.PERSONAS_TABLE || 'Personas';

class PersonaService {
    constructor() {
        this.dynamo = docClient;
        this.table = PERSONAS_TABLE;
    }

    /**
     * Crear una nueva persona dentro de un tenant
     */
    async crear(tenantId, data) {
        const validation = validateRequired(data, ['rut', 'nombre', 'rol']);
        if (!validation.valid) {
            throw new Error(`Campos requeridos faltantes: ${validation.missing.join(', ')}`);
        }

        const rutValidation = validateRut(data.rut);
        if (!rutValidation.valid) throw new Error('RUT invalido');

        if (!ROLES[data.rol]) {
            throw new Error(`Rol invalido. Roles validos: ${Object.keys(ROLES).join(', ')}`);
        }

        // Verificar unicidad por RUT dentro del tenant (via GSI)
        const existente = await this.getByRut(tenantId, rutValidation.formatted);
        if (existente) throw new Error('Ya existe una persona con este RUT en este tenant');

        const personaId = uuidv4();
        const now = new Date().toISOString();
        const tieneAccesoWeb = data.tieneAccesoWeb || data.rol === 'admin' || data.rol === 'prevencionista' || data.rol === 'supervisor';
        let passwordTemporal = null;

        const personaData = {
            personaId,
            tenantId,
            rut: rutValidation.formatted,
            nombre: data.nombre,
            apellido: data.apellido || '',
            email: data.email || '',
            telefono: data.telefono || '',
            rol: data.rol,
            permisos: ROLES[data.rol].permisos,
            cargo: data.cargo || ROLES[data.rol].nombre,
            obraIds: data.obraIds || [],
            tieneAccesoWeb,
            habilitado: false,
            estado: 'pendiente',
            createdAt: now,
            updatedAt: now
        };

        // Generar password temporal si tiene acceso web
        if (tieneAccesoWeb && data.email) {
            passwordTemporal = generateTempPassword(10);
            personaData.passwordHash = hashPassword(passwordTemporal, personaId);
            personaData.passwordTemporal = true;
        }

        const persona = new Persona(personaData);

        await this.dynamo.send(new PutCommand({
            TableName: this.table,
            Item: persona.toDynamoItem()
        }));

        return { persona, passwordTemporal };
    }

    /**
     * Obtener persona por ID (via GSI personaId-index)
     */
    async getById(personaId) {
        const result = await this.dynamo.send(new QueryCommand({
            TableName: this.table,
            IndexName: 'personaId-index',
            KeyConditionExpression: 'personaId = :personaId',
            ExpressionAttributeValues: { ':personaId': personaId }
        }));
        if (!result.Items || result.Items.length === 0) return null;
        return Persona.fromDynamoItem(result.Items[0]);
    }

    /**
     * Obtener persona por RUT dentro de un tenant (via GSI tenantRut-index)
     */
    async getByRut(tenantId, rut) {
        const rutValidation = validateRut(rut);
        const rutFormatted = rutValidation.valid ? rutValidation.formatted : rut;

        const result = await this.dynamo.send(new QueryCommand({
            TableName: this.table,
            IndexName: 'tenantRut-index',
            KeyConditionExpression: 'tenantId = :tenantId AND rut = :rut',
            ExpressionAttributeValues: {
                ':tenantId': tenantId,
                ':rut': rutFormatted
            }
        }));
        if (!result.Items || result.Items.length === 0) return null;
        return Persona.fromDynamoItem(result.Items[0]);
    }

    /**
     * Obtener persona por email (via GSI email-index, cross-tenant para login)
     */
    async getByEmail(email) {
        const result = await this.dynamo.send(new QueryCommand({
            TableName: this.table,
            IndexName: 'email-index',
            KeyConditionExpression: 'email = :email',
            ExpressionAttributeValues: { ':email': email }
        }));
        if (!result.Items || result.Items.length === 0) return null;
        return Persona.fromDynamoItem(result.Items[0]);
    }

    /**
     * Listar personas de un tenant (via PK)
     */
    async listByTenant(tenantId, filters = {}) {
        let filterExpression = '';
        const expressionValues = {
            ':pk': `TENANT#${tenantId}`,
            ':prefix': 'PERSONA#'
        };
        const expressionNames = {};

        if (filters.rol) {
            filterExpression += 'rol = :rol';
            expressionValues[':rol'] = filters.rol;
        }
        if (filters.estado) {
            filterExpression += filterExpression ? ' AND estado = :estado' : 'estado = :estado';
            expressionValues[':estado'] = filters.estado;
        }
        if (filters.obraId) {
            filterExpression += filterExpression ? ' AND contains(obraIds, :obraId)' : 'contains(obraIds, :obraId)';
            expressionValues[':obraId'] = filters.obraId;
        }

        const params = {
            TableName: this.table,
            KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
            ExpressionAttributeValues: expressionValues
        };

        if (filterExpression) {
            params.FilterExpression = filterExpression;
        }
        if (Object.keys(expressionNames).length > 0) {
            params.ExpressionAttributeNames = expressionNames;
        }

        const result = await this.dynamo.send(new QueryCommand(params));
        return (result.Items || []).map(item => Persona.fromDynamoItem(item));
    }

    /**
     * Actualizar datos de una persona
     */
    async actualizar(tenantId, personaId, updates) {
        const allowedFields = ['nombre', 'apellido', 'email', 'telefono',
            'cargo', 'estado', 'preferencias', 'obraIds'];

        const updateExpressions = [];
        const expressionNames = {};
        const expressionValues = {};

        allowedFields.forEach(field => {
            if (updates[field] !== undefined) {
                updateExpressions.push(`#${field} = :${field}`);
                expressionNames[`#${field}`] = field;
                expressionValues[`:${field}`] = updates[field];
            }
        });

        if (updateExpressions.length === 0) throw new Error('No hay campos para actualizar');

        updateExpressions.push('#updatedAt = :updatedAt');
        expressionNames['#updatedAt'] = 'updatedAt';
        expressionValues[':updatedAt'] = new Date().toISOString();

        const result = await this.dynamo.send(new UpdateCommand({
            TableName: this.table,
            Key: {
                PK: `TENANT#${tenantId}`,
                SK: `PERSONA#${personaId}`
            },
            UpdateExpression: `SET ${updateExpressions.join(', ')}`,
            ExpressionAttributeNames: expressionNames,
            ExpressionAttributeValues: expressionValues,
            ReturnValues: 'ALL_NEW'
        }));

        return Persona.fromDynamoItem(result.Attributes);
    }

    /**
     * Configurar PIN — un solo hash, un solo update (no dos como antes)
     */
    async setPin(tenantId, personaId, pin, pinActual) {
        const pinValidation = validatePin(pin);
        if (!pinValidation.valid) throw new Error(pinValidation.error);

        const persona = await this.getById(personaId);
        if (!persona) throw new Error('Persona no encontrada');

        // Verificar PIN actual si ya tiene uno
        if (persona._pinHash && persona.habilitado) {
            if (!pinActual) throw new Error('PIN actual es requerido para cambiar el PIN');
            const pinValido = verifyPin(pinActual, persona._pinHash, personaId);
            if (!pinValido) throw new Error('PIN actual incorrecto');
        }

        const now = new Date().toISOString();
        const newPinHash = hashPin(pin, personaId);

        await this.dynamo.send(new UpdateCommand({
            TableName: this.table,
            Key: {
                PK: `TENANT#${tenantId}`,
                SK: `PERSONA#${personaId}`
            },
            UpdateExpression: 'SET pinHash = :pinHash, pinCreatedAt = :pinCreatedAt, updatedAt = :updatedAt',
            ExpressionAttributeValues: {
                ':pinHash': newPinHash,
                ':pinCreatedAt': now,
                ':updatedAt': now
            }
        }));

        return {
            message: persona._pinHash ? 'PIN actualizado exitosamente' : 'PIN configurado exitosamente',
            pinCreatedAt: now
        };
    }

    /**
     * Completar enrolamiento — un solo update (no dos como antes)
     */
    async completarEnrolamiento(tenantId, personaId, pin, eventContext) {
        const persona = await this.getById(personaId);
        if (!persona) throw new Error('Persona no encontrada');
        if (persona.estaEnrolado()) throw new Error('La persona ya esta enrolada');

        // Verificar PIN
        const pinValido = verifyPin(pin, persona._pinHash, personaId);
        if (!pinValido) throw new Error('PIN incorrecto');

        const now = new Date();
        const token = generateSignatureToken();
        const ipAddress = eventContext?.requestContext?.http?.sourceIp
            || eventContext?.requestContext?.identity?.sourceIp || 'unknown';

        const firmaEnrolamiento = {
            token,
            fecha: now.toISOString().split('T')[0],
            horario: now.toTimeString().split(' ')[0],
            timestamp: now.toISOString(),
            metodoValidacion: 'PIN',
            ipAddress
        };

        await this.dynamo.send(new UpdateCommand({
            TableName: this.table,
            Key: {
                PK: `TENANT#${tenantId}`,
                SK: `PERSONA#${personaId}`
            },
            UpdateExpression: 'SET habilitado = :habilitado, estado = :estado, firmaEnrolamiento = :firmaEnrolamiento, updatedAt = :updatedAt',
            ExpressionAttributeValues: {
                ':habilitado': true,
                ':estado': 'activo',
                ':firmaEnrolamiento': firmaEnrolamiento,
                ':updatedAt': now.toISOString()
            }
        }));

        return {
            message: 'Enrolamiento completado exitosamente',
            personaId,
            habilitado: true,
            firma: {
                token: firmaEnrolamiento.token,
                fecha: firmaEnrolamiento.fecha,
                horario: firmaEnrolamiento.horario
            }
        };
    }
    /**
     * Resetear contraseña — genera nueva password temporal
     */
    async resetPassword(tenantId, personaId) {
        const persona = await this.getById(personaId);
        if (!persona) throw new Error('Persona no encontrada');

        const passwordTemporal = generateTempPassword(10);
        const passwordHash = hashPassword(passwordTemporal, personaId);
        const now = new Date().toISOString();

        await this.dynamo.send(new UpdateCommand({
            TableName: this.table,
            Key: {
                PK: `TENANT#${tenantId}`,
                SK: `PERSONA#${personaId}`
            },
            UpdateExpression: 'SET passwordHash = :passwordHash, passwordTemporal = :passwordTemporal, updatedAt = :updatedAt',
            ExpressionAttributeValues: {
                ':passwordHash': passwordHash,
                ':passwordTemporal': true,
                ':updatedAt': now
            }
        }));

        return {
            message: 'Contraseña reseteada exitosamente',
            passwordTemporal,
            personaId
        };
    }
}

module.exports = { PersonaService };
