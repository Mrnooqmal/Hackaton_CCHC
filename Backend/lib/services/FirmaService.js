/**
 * FirmaService (Refactored)
 * 
 * Servicio centralizado para gestión de firmas digitales.
 * Strategy Pattern para métodos de validación.
 * 
 * Cambios: workerId → personaId, un solo hash, tenantId en cada firma.
 */

const { v4: uuidv4 } = require('uuid');
const { GetCommand, PutCommand, QueryCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient } = require('../clients/dynamodb');
const { generateSignatureToken, verifyPin } = require('../utils/validation');

const SIGNATURES_TABLE = process.env.SIGNATURES_TABLE || 'Signatures';

// Estrategias de validación de firma (Strategy Pattern)
const ESTRATEGIAS_VALIDACION = {
    PIN: {
        nombre: 'PIN',
        validar: async (persona, credencial) => {
            if (!persona._pinHash) {
                throw new Error('PIN no configurado');
            }
            // Un solo hash con personaId (no más dual userId/workerId)
            return verifyPin(credencial, persona._pinHash, persona.personaId);
        }
    },
    OFFLINE: {
        nombre: 'Offline',
        validar: async (persona, credencial) => {
            return !!credencial.timestampLocal && !!credencial.offlineToken;
        }
    },
    BIOMETRICO: {
        nombre: 'Biométrico',
        validar: async () => {
            throw new Error('Método biométrico no implementado aún');
        }
    },
    PRESENCIAL: {
        nombre: 'Presencial',
        validar: async () => {
            // Firma presencial registrada por un tercero (relator/supervisor)
            return true;
        }
    }
};

class FirmaService {
    /**
     * Crea una firma validando credenciales
     * 
     * @param {Object} params
     * @param {string} params.personaId - ID de la persona que firma
     * @param {string} params.tenantId - ID del tenant
     * @param {string} params.metodo - 'PIN', 'OFFLINE', 'BIOMETRICO', 'PRESENCIAL'
     * @param {any} params.credencial - Credencial según el método
     * @param {string} params.tipoFirma - 'documento', 'actividad', 'enrolamiento'
     * @param {string} params.referenciaId - ID del documento/actividad firmada
     * @param {string} params.referenciaTipo - 'document', 'activity', 'request'
     * @param {Object} params.contexto - Contexto de la request (IP, userAgent)
     * @param {Object} params.metadata - Datos adicionales opcionales
     * @param {Object} [params.persona] - Persona pre-cargada (evita lookup extra)
     */
    static async crear(params) {
        const {
            personaId,
            tenantId,
            metodo = 'PIN',
            credencial,
            tipoFirma,
            referenciaId,
            referenciaTipo,
            contexto = {},
            metadata = {},
            persona: personaPrecargada
        } = params;

        // Validar que el método existe
        const estrategia = ESTRATEGIAS_VALIDACION[metodo];
        if (!estrategia) {
            throw new Error(`Método de validación '${metodo}' no soportado`);
        }

        // Obtener persona si no fue pre-cargada
        let persona = personaPrecargada;
        if (!persona) {
            const { PersonaService } = require('./PersonaService');
            const personaService = new PersonaService();
            persona = await personaService.getById(personaId);
            if (!persona) {
                throw new Error('Persona no encontrada');
            }
        }

        // Verificar que esté habilitada (excepto para enrolamiento)
        if (tipoFirma !== 'enrolamiento' && !persona.habilitado) {
            throw new Error('Persona no está habilitada. Debe completar el enrolamiento primero.');
        }

        // Validar credencial con la estrategia correspondiente
        const valido = await estrategia.validar(persona, credencial);
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

            // Identificación (unificada)
            personaId: persona.personaId,
            personaRut: persona.rut,
            personaNombre: `${persona.nombre} ${persona.apellido || ''}`.trim(),
            personaCargo: persona.cargo || '',
            tenantId: tenantId || persona.tenantId,

            // Contexto de la firma
            tipoFirma,
            referenciaId: referenciaId || null,
            referenciaTipo: referenciaTipo || null,

            // Timestamps según DS 44
            fecha: now.toISOString().split('T')[0],
            horario: now.toTimeString().split(' ')[0],
            timestamp: now.toISOString(),

            // Metadata de auditoría
            ipAddress: contexto.ipAddress || 'unknown',
            userAgent: contexto.userAgent || 'unknown',
            metodoValidacion: estrategia.nombre,
            metadata: metadata || null,

            // Estado
            estado: 'valida',
            createdAt: now.toISOString()
        };

        // Guardar en tabla Signatures (registro inmutable)
        await docClient.send(new PutCommand({
            TableName: SIGNATURES_TABLE,
            Item: firma
        }));

        return firma;
    }

    /**
     * Crea múltiples firmas en batch (para firma masiva)
     */
    static async crearBatch(personaIds, paramsComunes) {
        const resultados = { exitosas: [], fallidas: [] };

        for (const pid of personaIds) {
            try {
                const firma = await this.crear({
                    ...paramsComunes,
                    personaId: pid
                });
                resultados.exitosas.push(firma);
            } catch (err) {
                resultados.fallidas.push({ personaId: pid, error: err.message });
            }
        }

        return resultados;
    }

    /**
     * Obtiene una firma por ID
     */
    static async obtenerPorId(signatureId) {
        const result = await docClient.send(new GetCommand({
            TableName: SIGNATURES_TABLE,
            Key: { signatureId }
        }));
        return result.Item || null;
    }

    /**
     * Obtiene firmas de una persona (via GSI personaId-index)
     */
    static async obtenerPorPersona(personaId) {
        const result = await docClient.send(new QueryCommand({
            TableName: SIGNATURES_TABLE,
            IndexName: 'personaId-index',
            KeyConditionExpression: 'personaId = :personaId',
            ExpressionAttributeValues: { ':personaId': personaId }
        }));
        return result.Items || [];
    }

    /**
     * Obtiene firmas de un tenant (via GSI tenantId-index)
     */
    static async obtenerPorTenant(tenantId) {
        const result = await docClient.send(new QueryCommand({
            TableName: SIGNATURES_TABLE,
            IndexName: 'tenantId-index',
            KeyConditionExpression: 'tenantId = :tenantId',
            ExpressionAttributeValues: { ':tenantId': tenantId }
        }));
        return result.Items || [];
    }

    /**
     * Obtiene firmas por referencia (via GSI requestId-index)
     */
    static async obtenerPorReferencia(requestId) {
        const result = await docClient.send(new QueryCommand({
            TableName: SIGNATURES_TABLE,
            IndexName: 'requestId-index',
            KeyConditionExpression: 'requestId = :requestId',
            ExpressionAttributeValues: { ':requestId': requestId }
        }));
        return result.Items || [];
    }

    /**
     * Convierte firma al formato embebido para asistentes de actividades
     */
    static toAsistenteFormat(firma, persona) {
        return {
            personaId: persona.personaId,
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
     * Convierte firma al formato embebido para documentos
     */
    static toDocumentFirmaFormat(firma) {
        return {
            token: firma.token,
            personaId: firma.personaId,
            nombre: firma.personaNombre,
            rut: firma.personaRut,
            tipoFirma: firma.tipoFirma,
            fecha: firma.fecha,
            horario: firma.horario,
            timestamp: firma.timestamp,
            ip: firma.ipAddress
        };
    }
}

module.exports = { FirmaService, ESTRATEGIAS_VALIDACION };
