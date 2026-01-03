/**
 * FirmaService
 * 
 * Servicio centralizado para gestión de firmas digitales.
 * Implementa Strategy Pattern para diferentes métodos de validación.
 */

const { v4: uuidv4 } = require('uuid');
const { GetCommand, PutCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient } = require('../dynamodb');
const { generateSignatureToken, verifyPin } = require('../validation');
const { PersonaService } = require('./PersonaService');

const SIGNATURES_TABLE = process.env.SIGNATURES_TABLE || 'Signatures';

// Estrategias de validación de firma (Strategy Pattern)
const ESTRATEGIAS_VALIDACION = {
    PIN: {
        nombre: 'PIN',
        validar: async (persona, credencial, idParaHash) => {
            if (!persona._pinHash) {
                throw new Error('PIN no configurado');
            }
            return verifyPin(credencial, persona._pinHash, idParaHash);
        }
    },
    OFFLINE: {
        nombre: 'Offline',
        validar: async (persona, credencial, idParaHash) => {
            // Para firma offline, la validación se hizo en el momento de captura
            // Aquí solo verificamos el token de sincronización
            return !!credencial.timestampLocal && !!credencial.offlineToken;
        }
    },
    BIOMETRICO: {
        nombre: 'Biométrico',
        validar: async (persona, credencial) => {
            // Placeholder para futura implementación
            throw new Error('Método biométrico no implementado aún');
        }
    },
    PRESENCIAL: {
        nombre: 'Presencial',
        validar: async (persona, credencial) => {
            // Firma presencial registrada por un tercero (relator/supervisor)
            // No requiere PIN del trabajador en este momento
            return true;
        }
    }
};

class FirmaService {
    /**
     * Crea una firma validando credenciales
     * 
     * @param {Object} params
     * @param {string} params.workerId - ID del trabajador que firma
     * @param {string} params.metodo - 'PIN', 'OFFLINE', 'BIOMETRICO'
     * @param {any} params.credencial - Credencial según el método (PIN, token offline, etc)
     * @param {string} params.tipoFirma - 'documento', 'actividad', 'enrolamiento', etc
     * @param {string} params.referenciaId - ID del documento/actividad firmada
     * @param {string} params.referenciaTipo - 'document', 'activity', 'request'
     * @param {Object} params.contexto - Contexto de la request (IP, userAgent, etc)
     * @param {Object} params.metadata - Datos adicionales opcionales
     */
    static async crear(params) {
        const {
            workerId,
            metodo = 'PIN',
            credencial,
            tipoFirma,
            referenciaId,
            referenciaTipo,
            contexto = {},
            metadata = {}
        } = params;

        // Validar que el método existe
        const estrategia = ESTRATEGIAS_VALIDACION[metodo];
        if (!estrategia) {
            throw new Error(`Método de validación '${metodo}' no soportado`);
        }

        // Obtener persona
        const persona = await PersonaService.obtenerPorId(workerId, 'worker');
        if (!persona) {
            throw new Error('Trabajador no encontrado');
        }

        // Verificar que esté habilitado (excepto para enrolamiento)
        if (tipoFirma !== 'enrolamiento' && !persona.habilitado) {
            throw new Error('Trabajador no está habilitado. Debe completar el enrolamiento primero.');
        }

        // Validar credencial con la estrategia correspondiente
        const idParaHash = persona.workerId || persona.userId;
        const valido = await estrategia.validar(persona, credencial, idParaHash);
        if (!valido) {
            throw new Error(`Validación de ${metodo} fallida`);
        }

        // Crear firma
        const now = new Date();
        const signatureId = uuidv4();
        const token = generateSignatureToken();

        const firma = {
            signatureId,
            token,

            // Información del firmante
            workerId: persona.workerId,
            userId: persona.userId,
            workerRut: persona.rut,
            workerNombre: `${persona.nombre} ${persona.apellido || ''}`.trim(),
            workerCargo: persona.cargo || '',

            // Contexto de la firma
            tipoFirma,
            referenciaId: referenciaId || null,
            referenciaTipo: referenciaTipo || null,

            // Timestamps según DS 44
            fecha: now.toISOString().split('T')[0],
            horario: now.toTimeString().split(' ')[0],
            timestamp: now.toISOString(),

            // Metadata
            ipAddress: contexto.ipAddress || 'unknown',
            userAgent: contexto.userAgent || 'unknown',
            metodoValidacion: estrategia.nombre,
            metadata: metadata || null,

            // Estado
            estado: 'valida',
            disputaInfo: null,

            empresaId: persona.empresaId || 'default',
            createdAt: now.toISOString()
        };

        // Guardar en tabla Signatures
        await docClient.send(
            new PutCommand({
                TableName: SIGNATURES_TABLE,
                Item: firma
            })
        );

        return firma;
    }

    /**
     * Crea múltiples firmas en batch (para firma masiva)
     */
    static async crearBatch(workerIds, paramsComunes) {
        const resultados = {
            exitosas: [],
            fallidas: []
        };

        for (const workerId of workerIds) {
            try {
                const firma = await this.crear({
                    ...paramsComunes,
                    workerId
                });
                resultados.exitosas.push(firma);
            } catch (err) {
                resultados.fallidas.push({
                    workerId,
                    error: err.message
                });
            }
        }

        return resultados;
    }

    /**
     * Obtiene una firma por ID
     */
    static async obtenerPorId(signatureId) {
        const result = await docClient.send(
            new GetCommand({
                TableName: SIGNATURES_TABLE,
                Key: { signatureId }
            })
        );

        return result.Item || null;
    }

    /**
     * Obtiene una firma por token (para verificación pública)
     */
    static async obtenerPorToken(token) {
        const { ScanCommand } = require('@aws-sdk/lib-dynamodb');
        const result = await docClient.send(
            new ScanCommand({
                TableName: SIGNATURES_TABLE,
                FilterExpression: '#token = :token',
                ExpressionAttributeNames: { '#token': 'token' },
                ExpressionAttributeValues: { ':token': token }
            })
        );

        return result.Items?.[0] || null;
    }

    /**
     * Verifica si un token de firma es válido
     */
    static async verificarToken(token) {
        const firma = await this.obtenerPorToken(token);
        if (!firma) {
            return { valida: false, error: 'Token no encontrado' };
        }

        if (firma.estado !== 'valida') {
            return { valida: false, error: `Firma en estado: ${firma.estado}`, firma };
        }

        return { valida: true, firma };
    }

    /**
     * Convierte firma al formato embebido usado en activities.asistentes
     */
    static toAsistenteFormat(firma, persona) {
        return {
            workerId: persona.workerId,
            nombre: persona.nombre,
            rut: persona.rut,
            cargo: persona.cargo || '',
            firma: {
                token: firma.token,
                fecha: firma.fecha,
                horario: firma.horario,
                timestamp: firma.timestamp
            }
        };
    }

    /**
     * Convierte firma al formato embebido usado en documents.firmas
     */
    static toDocumentFirmaFormat(firma) {
        return {
            token: firma.token,
            workerId: firma.workerId,
            nombre: firma.workerNombre,
            rut: firma.workerRut,
            tipoFirma: firma.tipoFirma,
            fecha: firma.fecha,
            horario: firma.horario,
            timestamp: firma.timestamp,
            ip: firma.ipAddress
        };
    }
}

module.exports = { FirmaService, ESTRATEGIAS_VALIDACION };
