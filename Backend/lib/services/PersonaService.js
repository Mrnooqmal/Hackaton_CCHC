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
    validatePin, generateSignatureToken, hashPassword, generateTempPassword, normalizeRol
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

        if (!data.rol || typeof data.rol !== 'string' || !data.rol.trim()) {
            throw new Error('El campo rol es requerido');
        }

        // Verificar unicidad por RUT dentro del tenant (via GSI)
        const existente = await this.getByRut(tenantId, rutValidation.formatted);
        if (existente) throw new Error('Ya existe una persona con este RUT en este tenant');

        const personaId = uuidv4();
        const now = new Date().toISOString();
        // Los roles del sistema tienen permisos predefinidos; los roles personalizados del tenant no.
        // Se normaliza para admitir nombres con mayúsculas o espacios ("Jefe de Obra", "Prevencionista").
        const rolConfig = ROLES[normalizeRol(data.rol)];
        const tieneAccesoWeb = data.tieneAccesoWeb !== undefined ? data.tieneAccesoWeb : Boolean(rolConfig);
        let passwordTemporal = null;

        const apellidoPaterno = data.apellidoPaterno || '';
        const apellidoMaterno = data.apellidoMaterno || '';
        const apellido = data.apellido || [apellidoPaterno, apellidoMaterno].filter(Boolean).join(' ');

        const personaData = {
            personaId,
            tenantId,
            rut: rutValidation.formatted,
            nombre: data.nombre,
            apellidoPaterno,
            apellidoMaterno,
            apellido,
            fechaNacimiento: data.fechaNacimiento || null,
            email: data.email || '',
            telefono: data.telefono || '',
            rol: data.rol,
            permisos: rolConfig ? rolConfig.permisos : [],
            // El cargo es el oficio DS44 (del catálogo de /onboarding), NO el rol.
            // Si no se indica, queda vacío: antes se rellenaba con el nombre del rol
            // ("Trabajador"), creando cargos fantasma que no existen en el catálogo.
            cargo: data.cargo || null,
            obraIds: data.obraIds || [],
            // Si vienen asignaciones explícitas (obra+cargos), priman; si no, el
            // modelo las deriva de obraIds + cargo (shim de compatibilidad).
            asignaciones: Array.isArray(data.asignaciones) ? data.asignaciones : undefined,
            evidencias: Array.isArray(data.evidencias) ? data.evidencias : [],
            contactoEmergencia: data.contactoEmergencia || { nombre: '', telefono: '', relacion: '' },
            nivelEscolar: data.nivelEscolar || '',
            cursos: Array.isArray(data.cursos) ? data.cursos : [],
            tieneAccesoWeb,
            habilitado: false,
            estado: 'pendiente',
            creadoPor: data.creadoPor || null,
            createdAt: now,
            updatedAt: now
        };

        // Generar password temporal si tiene acceso web.
        // Convención: los primeros 4 dígitos del RUT (sin puntos ni dígito verificador).
        // El usuario debe cambiarla en el primer ingreso (passwordTemporal = true).
        if (tieneAccesoWeb && data.email) {
            const rutDigits = rutValidation.formatted.replace(/[^0-9]/g, '').slice(0, -1); // quita DV
            const first4 = rutDigits.slice(0, 4);
            passwordTemporal = first4.length === 4 ? first4 : generateTempPassword(10);
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
     * Buscar si un RUT ya existe en cualquier tenant (scan global)
     */
    async getByRutGlobal(rut) {
        const { ScanCommand } = require('@aws-sdk/lib-dynamodb');
        const rutValidation = validateRut(rut);
        const rutFormatted = rutValidation.valid ? rutValidation.formatted : rut;
        const result = await this.dynamo.send(new ScanCommand({
            TableName: this.table,
            FilterExpression: 'rut = :rut AND begins_with(SK, :prefix)',
            ExpressionAttributeValues: { ':rut': rutFormatted, ':prefix': 'PERSONA#' }
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
            filterExpression += filterExpression ? ' AND #estado = :estado' : '#estado = :estado';
            expressionNames['#estado'] = 'estado';
            expressionValues[':estado'] = filters.estado;
        } else {
            // Por defecto excluir personas desvinculadas
            filterExpression += filterExpression ? ' AND #estado <> :desvinculado' : '#estado <> :desvinculado';
            expressionNames['#estado'] = 'estado';
            expressionValues[':desvinculado'] = 'desvinculado';
        }
        if (filters.obraId) {
            filterExpression += ' AND contains(obraIds, :obraId)';
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
        const allowedFields = ['nombre', 'apellido', 'apellidoPaterno', 'apellidoMaterno', 'email', 'telefono',
            'fechaNacimiento', 'fotoPerfil', 'notificacionesSms',
            'rol', 'cargo', 'estado', 'preferencias', 'obraIds', 'asignaciones', 'historialAsignaciones', 'evidencias',
            'vigilanciaSalud', 'restriccionLaboral', 'onboardingDS44',
            'contactoEmergencia', 'nivelEscolar', 'cursos'];

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
     * Persiste asignaciones + mantiene el espejo obraIds en el mismo update
     * (DynamoDB UpdateCommand es parcial: hay que escribir ambos juntos para que
     * no queden inconsistentes).
     */
    async _persistAsignaciones(tenantId, personaId, asignaciones) {
        const obraIds = [...new Set(asignaciones.map((a) => a.obraId))];
        return this.actualizar(tenantId, personaId, { asignaciones, obraIds });
    }

    /**
     * Asigna (o reemplaza) los cargos de la persona en una obra. cargos es la
     * lista COMPLETA de cargos en esa obra (multi-cargo). Devuelve la persona y
     * los obraId nuevos (para que el caller dispare onboarding solo en esos).
     */
    async setAsignacionObra(tenantId, personaId, obraId, cargos = [], supervisorPersonaId = undefined, asignadaPor = undefined, prevencionistaPersonaId = undefined) {
        const persona = await this.getById(personaId);
        if (!persona) throw new Error('Persona no encontrada');
        const yaAsignada = persona.asignaciones.some((a) => a.obraId === obraId);
        const prev = persona.asignaciones.find((a) => a.obraId === obraId);
        const asignaciones = persona.asignaciones.filter((a) => a.obraId !== obraId);
        asignaciones.push({
            obraId,
            cargos: Persona._normalizeCargos(cargos),
            // Si no se envía supervisor se conserva el previo (no se borra al editar cargos).
            supervisorPersonaId: supervisorPersonaId !== undefined
                ? (supervisorPersonaId || null)
                : (prev?.supervisorPersonaId || null),
            // Prevencionista a cargo (para supervisores). Mismo criterio: si no se
            // envía, se conserva el previo.
            prevencionistaPersonaId: prevencionistaPersonaId !== undefined
                ? (prevencionistaPersonaId || null)
                : (prev?.prevencionistaPersonaId || null),
            fechaIngreso: prev?.fechaIngreso || new Date().toISOString(),
            // Quién asignó: al crear se toma el actor; al editar se conserva el original.
            asignadaPor: yaAsignada ? (prev?.asignadaPor || null) : (asignadaPor || null),
            estado: 'activa',
        });
        const actualizada = await this._persistAsignaciones(tenantId, personaId, asignaciones);
        return { persona: actualizada, esNueva: !yaAsignada };
    }

    /**
     * Quita la asignación de la persona a una obra. NO la borra: la mueve a
     * `historialAsignaciones[]` con egreso + auditoría (finalizadaPor, motivo).
     * Las evidencias persona-level se conservan intactas.
     * @param {{ finalizadaPor?: string, motivo?: string }} opts
     */
    async quitarDeObra(tenantId, personaId, obraId, opts = {}) {
        const persona = await this.getById(personaId);
        if (!persona) throw new Error('Persona no encontrada');
        const asignacion = persona.asignaciones.find((a) => a.obraId === obraId);
        const asignaciones = persona.asignaciones.filter((a) => a.obraId !== obraId);
        const obraIds = [...new Set(asignaciones.map((a) => a.obraId))];

        const historialAsignaciones = [...(persona.historialAsignaciones || [])];
        if (asignacion) {
            historialAsignaciones.push({
                obraId: asignacion.obraId,
                cargos: asignacion.cargos || [],
                supervisorPersonaId: asignacion.supervisorPersonaId || null,
                prevencionistaPersonaId: asignacion.prevencionistaPersonaId || null,
                fechaIngreso: asignacion.fechaIngreso || null,
                fechaEgreso: new Date().toISOString(),
                asignadaPor: asignacion.asignadaPor || null,
                finalizadaPor: opts.finalizadaPor || null,
                motivo: opts.motivo || 'egreso',
            });
        }
        return this.actualizar(tenantId, personaId, { asignaciones, obraIds, historialAsignaciones });
    }

    /**
     * Registra/actualiza una evidencia persona-level con vigencia (examen altura,
     * SPDC…). Se guarda la última por tipo (la vigente que reutilizan las obras).
     */
    async addEvidencia(tenantId, personaId, evidencia) {
        const persona = await this.getById(personaId);
        if (!persona) throw new Error('Persona no encontrada');
        const evidencias = [
            ...persona.evidencias.filter((e) => e.tipo !== evidencia.tipo),
            { ...evidencia, registradoEn: new Date().toISOString() },
        ];
        return this.actualizar(tenantId, personaId, { evidencias });
    }

    /**
     * Configurar PIN — un solo hash, un solo update (no dos como antes)
     */
    async setPin(tenantId, personaId, pin, pinActual) {
        const pinValidation = validatePin(pin);
        if (!pinValidation.valid) throw new Error(pinValidation.error);

        const persona = await this.getById(personaId);
        if (!persona) throw new Error('Persona no encontrada');

        const yaTienePin = !!persona._pinHash;

        // Verificacion opcional del PIN actual: si el cliente lo envia, se valida.
        // No es obligatorio, lo que permite la actualizacion directa del PIN.
        if (yaTienePin && pinActual) {
            const pinValido = verifyPin(pinActual, persona._pinHash, personaId);
            if (!pinValido) throw new Error('PIN actual incorrecto');
        }

        // Validacion de duplicados: el nuevo PIN no puede ser identico al registrado.
        if (yaTienePin && verifyPin(pin, persona._pinHash, personaId)) {
            throw new Error('El nuevo PIN no puede ser igual al PIN actual');
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

    /**
     * Desvincular una persona de la empresa (soft delete).
     * Marca estado='desvinculado' y registra quién y cuándo desvinculó.
     * El ajuste del conteo de trabajadores del tenant lo realiza el handler.
     */
    async eliminar(tenantId, personaId, desvinculadoPor = null) {
        const now = new Date().toISOString();
        await this.dynamo.send(new UpdateCommand({
            TableName: this.table,
            Key: {
                PK: `TENANT#${tenantId}`,
                SK: `PERSONA#${personaId}`
            },
            UpdateExpression: 'SET #estado = :estado, desvinculacion = :desvinculacion, updatedAt = :updatedAt',
            ExpressionAttributeNames: { '#estado': 'estado' },
            ExpressionAttributeValues: {
                ':estado': 'desvinculado',
                ':desvinculacion': {
                    fechaDesvinculacion: now,
                    desvinculadoPor: desvinculadoPor || null
                },
                ':updatedAt': now
            }
        }));
        return { message: 'Persona desvinculada de la empresa', personaId };
    }
}

module.exports = { PersonaService };
