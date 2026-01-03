/**
 * PersonaService
 * 
 * Servicio que gestiona la lógica unificada de Usuario/Trabajador.
 * Actúa como "single source of truth" lógica, manteniendo sincronizadas
 * ambas tablas (Users y Workers).
 */

const { GetCommand, ScanCommand, UpdateCommand, PutCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient } = require('../dynamodb');
const { Persona } = require('../models/Persona');
const { validateRut, hashPin, verifyPin, validatePin, generateSignatureToken } = require('../validation');

const USERS_TABLE = process.env.USERS_TABLE || 'Users';
const WORKERS_TABLE = process.env.WORKERS_TABLE || 'Workers';

class PersonaService {
    /**
     * Obtiene una Persona por ID (busca en ambas tablas y fusiona)
     * @param {string} id - userId o workerId
     * @param {string} tipo - 'user', 'worker', o 'auto' (busca en ambas)
     */
    static async obtenerPorId(id, tipo = 'auto') {
        let userData = null;
        let workerData = null;

        if (tipo === 'user' || tipo === 'auto') {
            try {
                const userResult = await docClient.send(
                    new GetCommand({
                        TableName: USERS_TABLE,
                        Key: { userId: id }
                    })
                );
                userData = userResult.Item;
            } catch (err) {
                console.error('Error getting user:', err);
            }
        }

        if (tipo === 'worker' || tipo === 'auto') {
            try {
                const workerResult = await docClient.send(
                    new GetCommand({
                        TableName: WORKERS_TABLE,
                        Key: { workerId: id }
                    })
                );
                workerData = workerResult.Item;
            } catch (err) {
                console.error('Error getting worker:', err);
            }
        }

        // Si encontramos User y tiene workerId, también obtenemos el Worker
        if (userData && userData.workerId && !workerData) {
            try {
                const workerResult = await docClient.send(
                    new GetCommand({
                        TableName: WORKERS_TABLE,
                        Key: { workerId: userData.workerId }
                    })
                );
                workerData = workerResult.Item;
            } catch (err) {
                console.error('Error getting linked worker:', err);
            }
        }

        // Si encontramos Worker y tiene userId, también obtenemos el User
        if (workerData && workerData.userId && !userData) {
            try {
                const userResult = await docClient.send(
                    new GetCommand({
                        TableName: USERS_TABLE,
                        Key: { userId: workerData.userId }
                    })
                );
                userData = userResult.Item;
            } catch (err) {
                console.error('Error getting linked user:', err);
            }
        }

        if (!userData && !workerData) {
            return null;
        }

        // Fusionar datos
        if (userData && workerData) {
            return Persona.mergeUserAndWorker(userData, workerData);
        } else if (userData) {
            return Persona.fromUser(userData);
        } else {
            return Persona.fromWorker(workerData);
        }
    }

    /**
     * Obtiene una Persona por RUT
     */
    static async obtenerPorRut(rut) {
        const rutValidation = validateRut(rut);
        if (!rutValidation.valid) {
            throw new Error('RUT inválido');
        }

        // Buscar en Users
        const userResult = await docClient.send(
            new ScanCommand({
                TableName: USERS_TABLE,
                FilterExpression: 'rut = :rut',
                ExpressionAttributeValues: { ':rut': rutValidation.formatted }
            })
        );
        const userData = userResult.Items?.[0];

        // Buscar en Workers
        const workerResult = await docClient.send(
            new ScanCommand({
                TableName: WORKERS_TABLE,
                FilterExpression: 'rut = :rut',
                ExpressionAttributeValues: { ':rut': rutValidation.formatted }
            })
        );
        const workerData = workerResult.Items?.[0];

        if (!userData && !workerData) {
            return null;
        }

        if (userData && workerData) {
            return Persona.mergeUserAndWorker(userData, workerData);
        } else if (userData) {
            return Persona.fromUser(userData);
        } else {
            return Persona.fromWorker(workerData);
        }
    }

    /**
     * Configura o cambia el PIN de una Persona
     * Mantiene ambas tablas sincronizadas
     * 
     * @param {string} id - userId o workerId
     * @param {string} tipo - 'user' o 'worker' (desde qué endpoint se llama)
     * @param {string} pinActual - PIN actual (requerido si ya tiene PIN y está habilitado)
     * @param {string} pinNuevo - Nuevo PIN a configurar
     */
    static async cambiarPin(id, tipo, pinActual, pinNuevo) {
        // Validar formato del nuevo PIN
        const pinValidation = validatePin(pinNuevo);
        if (!pinValidation.valid) {
            throw new Error(pinValidation.error);
        }

        // Obtener persona completa
        const persona = await this.obtenerPorId(id, tipo);
        if (!persona) {
            throw new Error(`${tipo === 'user' ? 'Usuario' : 'Trabajador'} no encontrado`);
        }

        // Si ya tiene PIN Y está habilitado, verificar el PIN actual
        if (persona._pinHash && persona.habilitado) {
            if (!pinActual) {
                throw new Error('PIN actual es requerido para cambiar el PIN');
            }
            // Verificar con el ID correcto según la fuente
            const idParaVerificar = tipo === 'user' ? persona.userId : persona.workerId;
            const pinValido = verifyPin(pinActual, persona._pinHash, idParaVerificar);
            if (!pinValido) {
                throw new Error('PIN actual incorrecto');
            }
        }

        const now = new Date().toISOString();

        // Actualizar ambas tablas con PIN hasheado con su respectivo ID
        const updates = [];

        if (persona.userId) {
            const pinHashUser = hashPin(pinNuevo, persona.userId);
            updates.push(
                docClient.send(
                    new UpdateCommand({
                        TableName: USERS_TABLE,
                        Key: { userId: persona.userId },
                        UpdateExpression: 'SET pinHash = :pinHash, pinCreatedAt = :pinCreatedAt, updatedAt = :updatedAt',
                        ExpressionAttributeValues: {
                            ':pinHash': pinHashUser,
                            ':pinCreatedAt': now,
                            ':updatedAt': now
                        }
                    })
                )
            );
        }

        if (persona.workerId) {
            const pinHashWorker = hashPin(pinNuevo, persona.workerId);
            updates.push(
                docClient.send(
                    new UpdateCommand({
                        TableName: WORKERS_TABLE,
                        Key: { workerId: persona.workerId },
                        UpdateExpression: 'SET pinHash = :pinHash, pinCreatedAt = :pinCreatedAt, updatedAt = :updatedAt',
                        ExpressionAttributeValues: {
                            ':pinHash': pinHashWorker,
                            ':pinCreatedAt': now,
                            ':updatedAt': now
                        }
                    })
                )
            );
        }

        await Promise.all(updates);

        return {
            message: persona._pinHash ? 'PIN actualizado exitosamente' : 'PIN configurado exitosamente',
            pinCreatedAt: now
        };
    }

    /**
     * Completa el enrolamiento de una Persona
     * Valida PIN, crea firma de enrolamiento, y sincroniza ambas tablas
     */
    static async completarEnrolamiento(id, tipo, pin, contextoRequest) {
        // Obtener persona completa
        const persona = await this.obtenerPorId(id, tipo);
        if (!persona) {
            throw new Error(`${tipo === 'user' ? 'Usuario' : 'Trabajador'} no encontrado`);
        }

        // Verificar que no esté ya habilitado (a menos que haya inconsistencia)
        if (persona.habilitado && persona.userId && persona.workerId) {
            // Verificar consistencia
            const needsSync = !persona.firmaEnrolamiento;
            if (!needsSync) {
                throw new Error('Ya está habilitado');
            }
            console.log('Inconsistencia detectada: habilitado pero sin firma. Permitiendo enrolamiento.');
        }

        // Verificar PIN
        if (!persona._pinHash) {
            throw new Error('Debe configurar un PIN primero');
        }

        const idParaVerificar = tipo === 'user' ? persona.userId : persona.workerId;
        const pinValido = verifyPin(pin, persona._pinHash, idParaVerificar);
        if (!pinValido) {
            throw new Error('PIN incorrecto');
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
            ipAddress: contextoRequest?.ipAddress || 'unknown'
        };

        // Actualizar ambas tablas
        const updates = [];

        if (persona.userId) {
            const pinHashUser = hashPin(pin, persona.userId);
            updates.push(
                docClient.send(
                    new UpdateCommand({
                        TableName: USERS_TABLE,
                        Key: { userId: persona.userId },
                        UpdateExpression: 'SET habilitado = :habilitado, estado = :estado, firmaEnrolamiento = :firmaEnrolamiento, pinHash = :pinHash, updatedAt = :updatedAt' +
                            (persona.workerId && !persona.userId ? ', workerId = :workerId' : ''),
                        ExpressionAttributeValues: {
                            ':habilitado': true,
                            ':estado': 'activo',
                            ':firmaEnrolamiento': firmaEnrolamiento,
                            ':pinHash': pinHashUser,
                            ':updatedAt': now.toISOString(),
                            ...(persona.workerId ? { ':workerId': persona.workerId } : {})
                        }
                    })
                )
            );
        }

        if (persona.workerId) {
            const pinHashWorker = hashPin(pin, persona.workerId);
            updates.push(
                docClient.send(
                    new UpdateCommand({
                        TableName: WORKERS_TABLE,
                        Key: { workerId: persona.workerId },
                        UpdateExpression: 'SET habilitado = :habilitado, firmaEnrolamiento = :firmaEnrolamiento, pinHash = :pinHash, updatedAt = :updatedAt' +
                            (persona.userId ? ', userId = :userId' : ''),
                        ExpressionAttributeValues: {
                            ':habilitado': true,
                            ':firmaEnrolamiento': firmaEnrolamiento,
                            ':pinHash': pinHashWorker,
                            ':updatedAt': now.toISOString(),
                            ...(persona.userId ? { ':userId': persona.userId } : {})
                        }
                    })
                )
            );
        }

        await Promise.all(updates);

        return {
            message: 'Enrolamiento completado exitosamente',
            userId: persona.userId,
            workerId: persona.workerId,
            habilitado: true,
            firma: {
                token: firmaEnrolamiento.token,
                fecha: firmaEnrolamiento.fecha,
                horario: firmaEnrolamiento.horario
            }
        };
    }

    /**
     * Lista todas las Personas (fusiona Users y Workers)
     */
    static async listar(filtros = {}) {
        const { empresaId, rol, includeUsers = true } = filtros;

        // Obtener Workers
        const workerParams = {
            TableName: WORKERS_TABLE,
            FilterExpression: 'estado = :estado',
            ExpressionAttributeValues: { ':estado': 'activo' }
        };

        if (empresaId) {
            workerParams.FilterExpression += ' AND empresaId = :empresaId';
            workerParams.ExpressionAttributeValues[':empresaId'] = empresaId;
        }

        const workersResult = await docClient.send(new ScanCommand(workerParams));
        const workersMap = new Map();
        (workersResult.Items || []).forEach(w => {
            workersMap.set(w.rut, w);
        });

        // Obtener Users si se solicita
        let usersMap = new Map();
        if (includeUsers) {
            const userParams = {
                TableName: USERS_TABLE
            };

            if (rol) {
                userParams.FilterExpression = 'rol = :rol';
                userParams.ExpressionAttributeValues = { ':rol': rol };
            }

            if (empresaId) {
                userParams.FilterExpression = userParams.FilterExpression
                    ? userParams.FilterExpression + ' AND empresaId = :empresaId'
                    : 'empresaId = :empresaId';
                userParams.ExpressionAttributeValues = userParams.ExpressionAttributeValues || {};
                userParams.ExpressionAttributeValues[':empresaId'] = empresaId;
            }

            const usersResult = await docClient.send(new ScanCommand(userParams));
            (usersResult.Items || []).forEach(u => {
                usersMap.set(u.rut, u);
            });
        }

        // Fusionar por RUT
        const allRuts = new Set([...workersMap.keys(), ...usersMap.keys()]);
        const personas = [];

        allRuts.forEach(rut => {
            const userData = usersMap.get(rut);
            const workerData = workersMap.get(rut);

            if (userData && workerData) {
                personas.push(Persona.mergeUserAndWorker(userData, workerData));
            } else if (userData) {
                personas.push(Persona.fromUser(userData));
            } else if (workerData) {
                personas.push(Persona.fromWorker(workerData));
            }
        });

        // Ordenar por nombre
        personas.sort((a, b) => (a.nombre || '').localeCompare(b.nombre || ''));

        return personas;
    }
}

module.exports = { PersonaService };
