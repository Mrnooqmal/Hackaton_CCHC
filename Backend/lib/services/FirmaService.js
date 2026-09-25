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
const { fechaHoraChile } = require('../utils/fechaChile');
const { generateSignatureToken, verifyPin } = require('../utils/validation');
const { guardarTraza, conTraza } = require('../traza-sensible');
const { cifrarConLlaveDatos } = require('../cifradoCampo');
const { llaveDe: llaveDeArreglos } = require('../arregloSensible');

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
    // Firma tomada SIN CONEXIÓN, acreditada por un vale de un solo uso que la
    // persona desbloqueó con su PIN al inicio del turno (ver ValeFirmaService).
    //
    // Antes esta estrategia se daba por válida con que el cliente mandara un
    // `timestampLocal` y un `offlineToken` cualesquiera: no comprobaba nada. El
    // consumo real del vale ocurre en `crear()`, porque necesita marcarlo usado de
    // forma atómica y saber si venció.
    VALE: {
        nombre: 'Vale offline',
        validar: async (persona, credencial) => Boolean(credencial && credencial.vale)
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
            obraId = null,
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

        // Validar credencial con la estrategia correspondiente.
        //
        // El PIN pasa por el límite de intentos (H-2, lib/limitePin.js) desde
        // ACÁ, no en cada llamador. `crear()` es el único choque de todos los
        // caminos que firman con PIN además de /signatures directo: documentos
        // (individual y masiva), actividades, encuestas y los registros AT/EP e
        // Art. 71. Parcharlos uno por uno habría dejado abierto el que se
        // olvidara; parchar el punto de encuentro los cierra todos a la vez.
        let valido;
        if (metodo === 'PIN') {
            const { verificarConLimiteOLanzar } = require('../limitePin');
            valido = await verificarConLimiteOLanzar(persona, credencial, verifyPin);
        } else {
            valido = await estrategia.validar(persona, credencial);
        }
        if (!valido) {
            throw new Error(`Validación de ${metodo} fallida`);
        }

        // IDEMPOTENCIA: si ya existe una firma válida de esta persona para la misma
        // referencia (documento/actividad), se devuelve esa en vez de crear un
        // duplicado (protege contra doble envío / reintentos de red).
        if (referenciaId && referenciaTipo && tipoFirma !== 'enrolamiento') {
            try {
                const existing = await docClient.send(new QueryCommand({
                    TableName: SIGNATURES_TABLE,
                    IndexName: 'personaId-index',
                    KeyConditionExpression: 'personaId = :p',
                    FilterExpression: 'referenciaId = :r AND referenciaTipo = :rt AND tipoFirma = :tf AND #st = :e',
                    ExpressionAttributeNames: { '#st': 'estado' },
                    ExpressionAttributeValues: {
                        ':p': persona.personaId,
                        ':r': referenciaId,
                        ':rt': referenciaTipo,
                        ':tf': tipoFirma,
                        ':e': 'valida',
                    },
                }));
                if (existing.Items && existing.Items.length > 0) {
                    return existing.Items[0];
                }
            } catch (idemErr) {
                console.error('Idempotencia firma: verificación falló, se continúa:', idemErr.message);
            }
        }

        // Firma sin conexión: se consume el vale (uso único, atómico) y se anota
        // en la propia firma qué la acredita. Si el vale venció, la firma SE
        // REGISTRA marcada para revisión: el acto ocurrió y descartarlo destruiría
        // evidencia real, pero no puede contar como cumplimiento hasta que alguien
        // con permiso lo confirme.
        let trazaOffline = null;
        if (metodo === 'VALE') {
            const { ValeFirmaService, MOTIVOS } = require('./ValeFirmaService');
            const consumo = await ValeFirmaService.consumir({
                vale: credencial.vale,
                personaId: persona.personaId,
                deviceId: credencial.deviceId || null,
            });
            if (!consumo.ok) {
                const explicacion = {
                    [MOTIVOS.NO_EXISTE]: 'El vale de firma no es válido.',
                    [MOTIVOS.OTRA_PERSONA]: 'El vale de firma no es válido.',
                    [MOTIVOS.YA_USADO]: 'Este vale de firma ya se usó.',
                    [MOTIVOS.DEMASIADO_VIEJO]: 'El vale de firma venció hace demasiado tiempo y ya no puede sincronizarse.',
                }[consumo.motivo] || 'El vale de firma no es válido.';
                throw new Error(explicacion);
            }
            trazaOffline = {
                valeEmitidoEn: consumo.vale.createdAt,
                valeExpiraEn: consumo.vale.expiresAt,
                dispositivoEmision: consumo.vale.deviceIdEmision || null,
                dispositivoUso: credencial.deviceId || null,
                // Momento en que la persona firmó en terreno, según el reloj del
                // dispositivo. Es declarado, no verificable: por eso se guarda
                // aparte del `timestamp` del servidor y nunca lo reemplaza.
                firmadaSinConexionEn: credencial.timestampLocal || null,
                sincronizadaEn: new Date().toISOString(),
                valeVencido: Boolean(consumo.vencido),
            };
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
            // El RUT no va en el elemento listado: vive aparte, fuera de todo
            // índice (ver `lib/traza-sensible.js`). El nombre sí, porque el anexo
            // de firmas y los listados lo muestran.
            personaNombre: `${persona.nombre} ${persona.apellido || ''}`.trim(),
            personaCargo: persona.cargo || '',
            tenantId: tenantId || persona.tenantId,

            // Contexto de la firma
            tipoFirma,
            referenciaId: referenciaId || null,
            referenciaTipo: referenciaTipo || null,
            // Obra a la que pertenece la firma (trazabilidad por obra). Se deriva del
            // documento/actividad firmado; null para firmas sin obra (ej. enrolamiento).
            obraId: obraId || null,

            // Timestamps según DS 44
            ...fechaHoraChile(now),
            timestamp: now.toISOString(),

            // La IP y el agente de usuario son traza de auditoría y van con el
            // RUT en el elemento aparte.
            metodoValidacion: estrategia.nombre,
            metadata: metadata || null,

            // Estado
            estado: 'valida',
            // Una firma sincronizada con un vale vencido no cuenta como
            // cumplimiento hasta que alguien con permiso la confirma. Los motores
            // de completitud deben ignorar las firmas con `requiereRevision`.
            requiereRevision: trazaOffline?.valeVencido || false,
            motivoRevision: trazaOffline?.valeVencido
                ? 'El vale de firma había vencido al sincronizar: la firma se registró pero requiere confirmación.'
                : null,
            revision: null,
            offline: trazaOffline,
            createdAt: now.toISOString()
        };

        const traza = {
            personaRut: persona.rut,
            ipAddress: contexto.ipAddress || 'unknown',
            userAgent: contexto.userAgent || 'unknown',
        };

        // La traza primero: una firma sin su respaldo de auditoría es peor que
        // una traza sin su firma.
        await guardarTraza(SIGNATURES_TABLE, 'signatureId', signatureId, traza);

        // Guardar en tabla Signatures (registro inmutable)
        await docClient.send(new PutCommand({
            TableName: SIGNATURES_TABLE,
            Item: firma
        }));

        // Quien llama recibe la firma COMPLETA: la copia que se embebe en el
        // documento lleva el RUT y la IP, y se arma en este mismo momento.
        return { ...firma, ...traza };
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
     * `toAsistenteFormat` se eliminó el 24 de septiembre de 2026, al cifrar los
     * arreglos embebidos. No tenía un solo llamador —actividades arma sus
     * asistentes por su cuenta— y era justo la forma de escribir un RUT en claro
     * que este cambio viene a cerrar: dejarla habría sido dejar puesta la pala
     * para volver a cavar el mismo hoyo.
     */

    /**
     * Convierte firma al formato embebido para documentos, con el RUT y la IP
     * ya cifrados con la llave de la empresa (D-10).
     *
     * Es el ÚNICO constructor de entradas de `firmas[]`. El camino de firma por
     * solicitud armaba su propia copia a mano, con los mismos campos y sin
     * cifrar; ahora pasa por acá como todos los demás.
     */
    static async toDocumentFirmaFormat(firma) {
        const llave = await llaveDeArreglos(firma.tenantId);
        return {
            token: firma.token,
            personaId: firma.personaId,
            nombre: firma.personaNombre,
            rutCifrado: cifrarConLlaveDatos(firma.personaRut ?? null, llave),
            tipoFirma: firma.tipoFirma,
            fecha: firma.fecha,
            horario: firma.horario,
            timestamp: firma.timestamp,
            ipCifrado: cifrarConLlaveDatos(firma.ipAddress ?? null, llave)
        };
    }

    /**
     * Construye las piezas (SET clauses / names / values) de una UpdateCommand
     * atómica para registrar firmas sobre un documento. Usada por CUALQUIER
     * endpoint que marque un documento como firmado (documents.sign,
     * documents.signAssisted, documents.signBulk, signatures.create vía
     * SignatureRequests) para que todos alimenten el mismo array `firmas`
     * (fuente para el estampado del PDF) de forma consistente.
     *
     * 'firmas' se actualiza con list_append (DynamoDB lo resuelve server-side
     * sobre el valor actual, sin necesitar leer-antes-de-escribir) y cada
     * asignación tocada se actualiza por índice (asignaciones[idx].campo), no
     * reescribiendo el array completo. Así, firmas concurrentes sobre el mismo
     * documento (varias personas firmando casi al mismo tiempo) no se pisan
     * entre sí: cada UpdateItem solo toca los paths que le corresponden.
     */
    static buildFirmaUpdateParts({ documentData, nuevasFirmas, asignacionUpdates = [] }) {
        const now = new Date().toISOString();

        // DynamoDB rechaza la escritura completa si sobra un nombre o un valor
        // declarado y no usado, y también si el mapa va vacío. Por eso todo lo que
        // depende de tocar una asignación se agrega SOLO cuando hay una asignación
        // que tocar: firmar un documento en el que la persona no está asignada —la
        // firma del relator, o la de un rezagado cuya asignación ya estaba
        // firmada— fallaba con un 500 ilegible.
        const names = {};
        const values = {
            ':nuevasFirmas': nuevasFirmas,
            ':emptyList': [],
            ':updatedAt': now,
        };
        const setClauses = [
            'firmas = list_append(if_not_exists(firmas, :emptyList), :nuevasFirmas)',
            'updatedAt = :updatedAt',
        ];

        const asignaciones = documentData.asignaciones || [];
        asignacionUpdates.forEach((upd, i) => {
            const idx = asignaciones.findIndex((a) => a.personaId === upd.personaId && a.estado === 'pendiente');
            if (idx === -1) return;

            names['#estado'] = 'estado';
            values[':firmado'] = 'firmado';

            const fechaKey = `:fechaFirma${i}`;
            values[fechaKey] = now;
            setClauses.push(`asignaciones[${idx}].#estado = :firmado`);
            setClauses.push(`asignaciones[${idx}].fechaFirma = ${fechaKey}`);
            if (upd.asistidoPor) {
                const apKey = `:asistidoPor${i}`;
                values[apKey] = upd.asistidoPor;
                setClauses.push(`asignaciones[${idx}].asistidoPor = ${apKey}`);
            }
        });

        return { setClauses, names: Object.keys(names).length ? names : undefined, values, now };
    }
}

module.exports = { FirmaService, ESTRATEGIAS_VALIDACION };
