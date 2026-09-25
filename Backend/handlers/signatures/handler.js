const { v4: uuidv4 } = require('uuid');
const { PutCommand, GetCommand, ScanCommand, UpdateCommand, QueryCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient } = require('../../lib/clients/dynamodb');
const { success, error, created } = require('../../lib/utils/response');
const { fechaHoraChile } = require('../../lib/utils/fechaChile');
const { validateRequired, generateSignatureToken, verifyPin, enmascararRut } = require('../../lib/utils/validation');
const { guardarTraza, conTraza } = require('../../lib/traza-sensible');
const { verificarConLimite } = require('../../lib/limitePin');
const { FirmaService } = require('../../lib/services/FirmaService');
const signatureRequests = require('../signature-requests/handler');

const SIGNATURES_TABLE = process.env.SIGNATURES_TABLE || 'Signatures';
const DOCUMENTS_TABLE = process.env.DOCUMENTS_TABLE || 'Documents';
const { PersonaService } = require('../../lib/services/PersonaService');
const { conSesion, sesionPuede } = require('../../lib/auth/sesion');
const { PERMISSIONS } = require('../../lib/permissions');
const { normalizeRol } = require('../../lib/utils/validation');

/**
 * Firma de la empresa de la sesión, o null.
 *
 * La tabla está indexada por `signatureId`: con el id se leía, se disputaba y se
 * revocaba la firma de cualquier empresa. Quien use esto responde 404.
 */
const firmaDelTenant = async (signatureId, sesion) => {
    if (!signatureId) return null;
    const res = await docClient.send(new GetCommand({
        TableName: SIGNATURES_TABLE,
        Key: { signatureId },
    }));
    const firma = res.Item;
    return firma && firma.tenantId === sesion.tenantId ? firma : null;
};

/** Deja fuera lo que no sea de la empresa de la sesión. */
const soloDelTenant = (items, sesion) =>
    (items || []).filter((f) => f.tenantId === sesion.tenantId);

/**
 * POST /signatures - Crear firma con validación de PIN
 * 
 * Body: {
 *   workerId: string,          // ID del trabajador que firma
 *   pin: string,               // PIN de 4 dígitos
 *   requestId: string,         // ID de la solicitud de firma
 *   metadata?: object          // Datos adicionales (geolocalización, etc)
 * }
 */
module.exports.create = async (event) => {
    try {
        const ses = conSesion(event);
        if (!ses.ok) return ses.respuesta;
        const sesion = ses.sesion;

        const body = JSON.parse(event.body || '{}');

        // Validar campos requeridos
        const validation = validateRequired(body, ['personaId', 'pin', 'requestId']);
        if (!validation.valid) {
            return error(`Campos requeridos faltantes: ${validation.missing.join(', ')}`);
        }

        const { personaId: inputPersonaId, pin, requestId, metadata } = body;

        // Cada quien firma por sí mismo. Firmar por otro es la firma asistida (el
        // trabajador teclea su PIN en el dispositivo de quien asiste) y exige ese
        // permiso; el PIN sigue siendo la prueba del consentimiento.
        if (inputPersonaId !== sesion.personaId
            && !sesionPuede(sesion, PERMISSIONS.OBRA_FIRMA_ASISTIDA)) {
            return error('No tienes permiso para registrar la firma de otra persona', 403);
        }

        // Obtener persona
        const personaService = new PersonaService();
        const persona = await personaService.getById(inputPersonaId);

        if (!persona) {
            return error('Persona no encontrada', 404);
        }

        // Quien firma tiene que ser de la empresa de la sesión.
        if (persona.tenantId !== sesion.tenantId) {
            return error('Persona no encontrada', 404);
        }

        // Verificar que está habilitada
        if (!persona.habilitado) {
            return error('Persona no está habilitada. Debe completar el enrolamiento primero.', 403);
        }

        // Verificar PIN
        if (!persona.tienePinConfigurado || !persona.tienePinConfigurado()) {
            return error('Persona no tiene PIN configurado', 400);
        }

        const chequeo = await verificarConLimite(persona, pin, verifyPin);
        if (!chequeo.ok) {
            return error(chequeo.mensaje, chequeo.bloqueada ? 423 : 401);
        }

        // Verificar que la solicitud existe y el trabajador está incluido
        const requestResult = await docClient.send(
            new GetCommand({
                TableName: process.env.SIGNATURE_REQUESTS_TABLE || 'SignatureRequests',
                Key: { requestId },
            })
        );

        if (!requestResult.Item) {
            return error('Solicitud de firma no encontrada', 404);
        }

        const request = requestResult.Item;

        // Verificar que la solicitud no está cancelada o vencida
        if (['cancelada', 'vencida'].includes(request.estado)) {
            return error(`La solicitud está ${request.estado}`, 400);
        }

        // La persona solo puede firmar solicitudes de su propia empresa
        if (request.tenantId && persona.tenantId && request.tenantId !== persona.tenantId) {
            return error('No estás incluido en esta solicitud de firma', 403);
        }

        // Verificar que el trabajador está en la lista de la solicitud.
        // Solicitudes antiguas solo traen workerId en la lista: aceptar ambos.
        const trabajadorEnSolicitud = (request.trabajadores || []).find(
            t => t.personaId === inputPersonaId || t.workerId === inputPersonaId
        );
        if (!trabajadorEnSolicitud) {
            return error('No estás incluido en esta solicitud de firma', 403);
        }

        // Verificar que no haya firmado ya
        if (trabajadorEnSolicitud.firmado) {
            return error('Ya has firmado esta solicitud', 400);
        }

        const now = new Date();
        const signatureId = uuidv4();
        const token = generateSignatureToken();

        // Crear registro de firma según DS 44
        const signature = {
            signatureId,
            token,

            // Referencia a la solicitud (para GSI)
            requestId,
            requestTitulo: request.titulo,
            requestTipo: request.tipo,

            // Información del firmante
            personaId: inputPersonaId,
            // El RUT no va acá: vive en el elemento aparte, fuera de todo índice
            // (ver `lib/traza-sensible.js`). El nombre y el cargo sí, porque los
            // listados y el anexo de firmas los muestran.
            workerNombre: `${persona.nombre} ${persona.apellido || ''}`.trim(),
            workerCargo: persona.cargo,

            // Información del solicitante
            solicitanteId: request.solicitanteId,
            solicitanteNombre: request.solicitanteNombre,

            // Timestamps según DS 44
            ...fechaHoraChile(now),
            timestamp: now.toISOString(),

            // La IP y el agente de usuario tampoco: son traza de auditoría, no
            // dato de listado, y ningún flujo los lee de vuelta desde esta tabla.
            metodoValidacion: 'PIN',
            metadata: metadata || null,

            // Documentos firmados (referencia)
            documentosFirmados: request.documentos || [],

            // Estado
            estado: 'valida',
            disputaInfo: null,

            tenantId: persona.tenantId || 'default',
            createdAt: now.toISOString(),
        };

        const trazaAuditoria = {
            workerRut: persona.rut,
            ipAddress: event.requestContext?.http?.sourceIp
                || event.requestContext?.identity?.sourceIp || 'unknown',
            userAgent: event.headers?.['user-agent'] || 'unknown',
        };

        // La traza primero: si falla, no queda una firma sin su respaldo de
        // auditoría. Al revés sí puede pasar y sería peor.
        await guardarTraza(SIGNATURES_TABLE, 'signatureId', signatureId, trazaAuditoria);

        await docClient.send(
            new PutCommand({
                TableName: SIGNATURES_TABLE,
                Item: signature,
            })
        );

        // Actualizar la solicitud con esta firma
        const updateResult = await signatureRequests.updateOnSignature(requestId, inputPersonaId, signatureId);

        // Si la solicitud referencia un documento, marcar la asignación como
        // firmada Y agregar la firma al array `firmas` del documento (fuente
        // que usa el estampado del PDF). Usa el mismo helper atómico que
        // documents.sign/signAssisted/signBulk (list_append + path indexado)
        // para que firmas concurrentes sobre el mismo documento no se pisen.
        const referencedDocumentId = request.referenciaId || request.documentId || null;
        if (request.referenciaTipo === 'document' && referencedDocumentId) {
            try {
                const docResult = await docClient.send(
                    new GetCommand({
                        TableName: DOCUMENTS_TABLE,
                        Key: { documentId: referencedDocumentId }
                    })
                );

                if (docResult.Item) {
                    const documentData = docResult.Item;
                    // Mismo constructor que documents.sign/signAssisted/signBulk.
                    // Antes este camino armaba la entrada a mano, con los mismos
                    // campos: dos escritores del mismo arreglo, y solo uno se
                    // acordaba de cada cambio (ya pasó con `workerNombre`).
                    const firmaEmbebida = await FirmaService.toDocumentFirmaFormat({
                        token: signature.token,
                        personaId: signature.personaId,
                        personaNombre: signature.workerNombre,
                        personaRut: trazaAuditoria.workerRut,
                        tipoFirma: 'trabajador',
                        fecha: signature.fecha,
                        horario: signature.horario,
                        timestamp: signature.timestamp,
                        ipAddress: trazaAuditoria.ipAddress,
                        tenantId: signature.tenantId
                    });
                    const parts = FirmaService.buildFirmaUpdateParts({
                        documentData,
                        nuevasFirmas: [firmaEmbebida],
                        asignacionUpdates: [{ personaId: inputPersonaId }]
                    });

                    await docClient.send(
                        new UpdateCommand({
                            TableName: DOCUMENTS_TABLE,
                            Key: { documentId: referencedDocumentId },
                            UpdateExpression: 'SET ' + parts.setClauses.join(', '),
                            ExpressionAttributeNames: parts.names,
                            ExpressionAttributeValues: parts.values
                        })
                    );
                }
            } catch (docUpdateError) {
                console.error('Error syncing document assignment from signature request:', docUpdateError);
            }
        }

        return created({
            message: 'Firma registrada exitosamente',
            signature: {
                signatureId: signature.signatureId,
                token: signature.token,
                workerNombre: signature.workerNombre,
                workerRut: trazaAuditoria.workerRut,
                fecha: signature.fecha,
                horario: signature.horario,
                requestTitulo: signature.requestTitulo,
                estado: signature.estado,
            },
            solicitudActualizada: updateResult,
        });
    } catch (err) {
        console.error('Error creating signature:', err);
        return error(err.message, 500);
    }
};

/**
 * POST /signatures/enroll - Firma de enrolamiento (sin requestId)
 * 
 * Body: {
 *   workerId: string,
 *   pin: string,           // El PIN que el trabajador está configurando
 *   signatureData?: string // Datos del canvas de firma (opcional)
 * }
 */
module.exports.createEnrollment = async (event) => {
    try {
        const ses = conSesion(event);
        if (!ses.ok) return ses.respuesta;
        const sesion = ses.sesion;

        const body = JSON.parse(event.body || '{}');

        const validation = validateRequired(body, ['personaId', 'pin']);
        if (!validation.valid) {
            return error(`Campos requeridos faltantes: ${validation.missing.join(', ')}`);
        }

        const { personaId, pin, signatureData } = body;

        // La persona se enrola ella misma, o lo hace quien la registra en su
        // dispositivo (mismo criterio que POST /personas/{id}/enrolamiento).
        if (personaId !== sesion.personaId && !sesionPuede(sesion, PERMISSIONS.PERSONAS_CREAR)) {
            return error('No tienes permiso para enrolar a otra persona', 403);
        }

        // Obtener persona
        const personaService = new PersonaService();
        const persona = await personaService.getById(personaId);

        if (!persona || persona.tenantId !== sesion.tenantId) {
            return error('Persona no encontrada', 404);
        }

        // Verificar que no esté ya habilitada
        if (persona.habilitado) {
            return error('Esta persona ya completó su enrolamiento', 400);
        }

        const now = new Date();
        const signatureId = uuidv4();
        const token = generateSignatureToken();

        // Crear registro de firma de enrolamiento
        const signature = {
            signatureId,
            token,
            requestId: null, // Sin solicitud asociada

            // Información del firmante
            personaId: personaId,
            workerRut: persona.rut,
            workerNombre: `${persona.nombre} ${persona.apellido || ''}`.trim(),
            workerCargo: persona.cargo,

            // Tipo especial
            requestTipo: 'ENROLAMIENTO',
            requestTitulo: 'Firma de Enrolamiento',
            solicitanteId: null,
            solicitanteNombre: 'Sistema',

            // Timestamps
            ...fechaHoraChile(now),
            timestamp: now.toISOString(),

            // Metadata
            ipAddress: event.requestContext?.http?.sourceIp ||
                event.requestContext?.identity?.sourceIp || 'unknown',
            userAgent: event.headers?.['user-agent'] || 'unknown',
            metodoValidacion: 'PIN_INICIAL',
            signatureData: signatureData || null,

            estado: 'valida',
            tenantId: persona.tenantId || 'default',
            createdAt: now.toISOString(),
        };

        // Guardar firma
        await docClient.send(
            new PutCommand({
                TableName: SIGNATURES_TABLE,
                Item: signature,
            })
        );

        return created({
            message: 'Firma de enrolamiento registrada exitosamente',
            signature: {
                signatureId: signature.signatureId,
                token: signature.token,
                fecha: signature.fecha,
                horario: signature.horario,
            },
        });
    } catch (err) {
        console.error('Error creating enrollment signature:', err);
        return error(err.message, 500);
    }
};

/**
 * GET /signatures/{id} - Obtener firma por ID
 */
module.exports.get = async (event) => {
    try {
        const ses = conSesion(event);
        if (!ses.ok) return ses.respuesta;

        const { id } = event.pathParameters || {};

        if (!id) {
            return error('ID de firma requerido');
        }

        const firma = await firmaDelTenant(id, ses.sesion);
        if (!firma) {
            return error('Firma no encontrada', 404);
        }

        return success(firma);
    } catch (err) {
        console.error('Error getting signature:', err);
        return error(err.message, 500);
    }
};

/**
 * GET /signatures/worker/{workerId} - Historial de firmas de un trabajador
 * Soporta buscar tanto por workerId como por userId resolviendo la relación entre ambos
 */
module.exports.getByWorker = async (event) => {
    try {
        const ses = conSesion(event);
        if (!ses.ok) return ses.respuesta;
        const sesion = ses.sesion;

        const { workerId: inputId } = event.pathParameters || {};
        if (!inputId) return error('ID requerido');

        // El historial de firmas de otra persona es parte de su ficha.
        if (inputId !== sesion.personaId && !sesionPuede(sesion, PERMISSIONS.PERSONAS_DETALLE)) {
            return error('No tienes permiso para ver las firmas de otra persona', 403);
        }

        // Query por GSI personaId-index (índice global: el resultado se acota a la
        // empresa de la sesión, porque una misma persona puede estar en varias).
        const result = await docClient.send(
            new QueryCommand({
                TableName: SIGNATURES_TABLE,
                IndexName: 'personaId-index',
                KeyConditionExpression: 'personaId = :pid',
                ExpressionAttributeValues: { ':pid': inputId },
            })
        );

        const signatures = soloDelTenant(result.Items, sesion).sort((a, b) =>
            new Date(b.timestamp) - new Date(a.timestamp)
        );

        return success({
            personaId: inputId,
            totalFirmas: signatures.length,
            firmas: signatures,
        });
    } catch (err) {
        console.error('Error getting signatures by worker:', err);
        return error(err.message, 500);
    }
};

/**
 * GET /signatures/request/{requestId} - Firmas de una solicitud específica
 */
module.exports.getByRequest = async (event) => {
    try {
        const ses = conSesion(event);
        if (!ses.ok) return ses.respuesta;

        const { requestId } = event.pathParameters || {};

        if (!requestId) {
            return error('ID de solicitud requerido');
        }

        // Usar el GSI para query eficiente
        const result = await docClient.send(
            new QueryCommand({
                TableName: SIGNATURES_TABLE,
                IndexName: 'requestId-index',
                KeyConditionExpression: 'requestId = :requestId',
                ExpressionAttributeValues: {
                    ':requestId': requestId,
                },
            })
        );

        // Ordenar por timestamp (solo las de la empresa de la sesión)
        const signatures = soloDelTenant(result.Items, ses.sesion).sort((a, b) =>
            new Date(a.timestamp) - new Date(b.timestamp)
        );

        return success({
            requestId,
            totalFirmas: signatures.length,
            firmas: signatures,
        });
    } catch (err) {
        console.error('Error getting signatures by request:', err);
        return error(err.message, 500);
    }
};

/**
 * GET /signatures/verify/{token} - Verificar firma por token (para auditoría).
 *
 * Es el único endpoint público del módulo, y lo es por diseño: quien tenga el
 * token impreso en el anexo de firmas —un fiscalizador, por ejemplo— debe poder
 * comprobar la firma sin cuenta en el sistema.
 *
 * Por eso mismo el RUT viaja PARCIAL. Quien verifica ya tiene delante el RUT de
 * la persona y solo necesita confirmar que coincide; devolverlo completo
 * convertía un token en una consulta abierta de identidad.
 */
module.exports.verifyByToken = async (event) => {
    try {
        const { token } = event.pathParameters || {};

        if (!token) {
            return error('Token requerido');
        }

        const result = await docClient.send(
            new ScanCommand({
                TableName: SIGNATURES_TABLE,
                // El filtro por token ya deja fuera los elementos con la traza
                // (no tienen token), pero se es explícito porque este `Scan`
                // recorre la tabla entera.
                FilterExpression: '#token = :token',
                ExpressionAttributeNames: {
                    '#token': 'token',
                },
                ExpressionAttributeValues: {
                    ':token': token,
                },
            })
        );

        if (!result.Items || result.Items.length === 0) {
            return error('Firma no encontrada', 404);
        }

        const signature = await conTraza(SIGNATURES_TABLE, 'signatureId', result.Items[0]);

        return success({
            verificada: true,
            firma: {
                signatureId: signature.signatureId,
                token: signature.token,
                // `personaNombre` lo escribe FirmaService y `workerNombre` este
                // handler: sin el alias, la verificación pública mostraba el nombre
                // vacío en toda firma hecha desde un documento o una actividad.
                workerNombre: signature.workerNombre || signature.personaNombre,
                // RUT parcial: ver el comentario del handler.
                workerRut: enmascararRut(signature.workerRut || signature.personaRut),
                fecha: signature.fecha,
                horario: signature.horario,
                requestTitulo: signature.requestTitulo,
                requestTipo: signature.requestTipo,
                estado: signature.estado,
                documentosFirmados: signature.documentosFirmados?.length || 0,
            },
        });
    } catch (err) {
        console.error('Error verifying signature:', err);
        return error(err.message, 500);
    }
};

/**
 * POST /signatures/{id}/dispute - Reportar problema con una firma
 */
module.exports.dispute = async (event) => {
    try {
        const ses = conSesion(event);
        if (!ses.ok) return ses.respuesta;
        const sesion = ses.sesion;

        const { id } = event.pathParameters || {};
        const body = JSON.parse(event.body || '{}');

        if (!id) {
            return error('ID de firma requerido');
        }

        const validation = validateRequired(body, ['motivo']);
        if (!validation.valid) {
            return error(`Campos requeridos faltantes: ${validation.missing.join(', ')}`);
        }

        const firma = await firmaDelTenant(id, sesion);
        if (!firma) {
            return error('Firma no encontrada', 404);
        }

        // Desconocer una firma lo hace la persona a la que se le atribuye, o quien
        // gestiona firmas en la empresa.
        if (firma.personaId !== sesion.personaId && !sesionPuede(sesion, PERMISSIONS.FIRMAS_CREAR)) {
            return error('No tienes permiso para reportar esta firma', 403);
        }

        if (firma.estado === 'disputada') {
            return error('Esta firma ya está en disputa', 400);
        }

        const now = new Date().toISOString();

        const disputaInfo = {
            motivo: body.motivo,
            // Quién reporta sale de la sesión: es el sujeto de la disputa.
            reportadoPor: sesion.personaId,
            fechaReporte: now,
            resolucion: null,
            resueltoPor: null,
            fechaResolucion: null,
        };

        await docClient.send(
            new UpdateCommand({
                TableName: SIGNATURES_TABLE,
                Key: { signatureId: id },
                UpdateExpression: 'SET estado = :estado, disputaInfo = :disputaInfo',
                ExpressionAttributeValues: {
                    ':estado': 'disputada',
                    ':disputaInfo': disputaInfo,
                },
            })
        );

        return success({
            message: 'Disputa registrada exitosamente',
            signatureId: id,
            disputaInfo,
        });
    } catch (err) {
        console.error('Error disputing signature:', err);
        return error(err.message, 500);
    }
};

/**
 * PUT /signatures/{id}/resolve - Resolver disputa
 */
module.exports.resolve = async (event) => {
    try {
        const ses = conSesion(event);
        if (!ses.ok) return ses.respuesta;
        const sesion = ses.sesion;

        const { id } = event.pathParameters || {};
        const body = JSON.parse(event.body || '{}');

        if (!id) {
            return error('ID de firma requerido');
        }

        const validation = validateRequired(body, ['resolucion', 'nuevoEstado']);
        if (!validation.valid) {
            return error(`Campos requeridos faltantes: ${validation.missing.join(', ')}`);
        }

        if (!['valida', 'revocada'].includes(body.nuevoEstado)) {
            return error('Estado inválido. Debe ser "valida" o "revocada"');
        }

        // Resolver una disputa puede REVOCAR una firma, que es la prueba de que se
        // cumplió una obligación del DS 44: queda en manos del administrador de la
        // empresa, no de cualquiera que conozca el identificador.
        if (normalizeRol(sesion.rol) !== 'admin') {
            return error('Solo un administrador puede resolver una disputa de firma', 403);
        }

        const firma = await firmaDelTenant(id, sesion);
        if (!firma) {
            return error('Firma no encontrada', 404);
        }

        if (firma.estado !== 'disputada') {
            return error('Esta firma no está en disputa', 400);
        }

        const now = new Date().toISOString();
        const disputaInfo = {
            ...firma.disputaInfo,
            resolucion: body.resolucion,
            // Quién resuelve sale de la sesión.
            resueltoPor: sesion.personaId,
            fechaResolucion: now,
        };

        await docClient.send(
            new UpdateCommand({
                TableName: SIGNATURES_TABLE,
                Key: { signatureId: id },
                UpdateExpression: 'SET estado = :estado, disputaInfo = :disputaInfo',
                ExpressionAttributeValues: {
                    ':estado': body.nuevoEstado,
                    ':disputaInfo': disputaInfo,
                },
            })
        );

        return success({
            message: `Disputa resuelta. Estado: ${body.nuevoEstado}`,
            signatureId: id,
            nuevoEstado: body.nuevoEstado,
            disputaInfo,
        });
    } catch (err) {
        console.error('Error resolving dispute:', err);
        return error(err.message, 500);
    }
};

/**
 * PUT /signatures/{id}/revision — Confirmar o rechazar una firma marcada.
 *
 * Solo llegan acá las firmas tomadas SIN CONEXIÓN cuyo vale ya había vencido al
 * sincronizar (ver `lib/services/ValeFirmaService.js`): la firma se registró
 * porque el acto ocurrió, pero no cuenta como cumplimiento hasta que alguien con
 * responsabilidad sobre las firmas dice, sabiendo lo que pasó, si la reconoce.
 *
 * Body: { decision: 'confirmada' | 'rechazada', motivo? }
 */
module.exports.revisar = async (event) => {
    try {
        const ses = conSesion(event);
        if (!ses.ok) return ses.respuesta;
        const sesion = ses.sesion;

        const { id } = event.pathParameters || {};
        if (!id) return error('ID de firma requerido');

        const body = JSON.parse(event.body || '{}');
        if (!['confirmada', 'rechazada'].includes(body.decision)) {
            return error('decision debe ser "confirmada" o "rechazada"');
        }

        if (!sesionPuede(sesion, PERMISSIONS.FIRMAS_CREAR) && normalizeRol(sesion.rol) !== 'admin') {
            return error('No tienes permiso para revisar firmas', 403);
        }

        const firma = await firmaDelTenant(id, sesion);
        if (!firma) return error('Firma no encontrada', 404);
        if (!firma.requiereRevision) {
            return error('Esta firma no está pendiente de revisión', 400);
        }

        const ahora = new Date().toISOString();
        const revision = {
            decision: body.decision,
            motivo: body.motivo || null,
            revisadoPor: sesion.personaId,
            fechaRevision: ahora,
        };

        // Rechazarla no la borra: queda como firma revocada, con el motivo. La
        // evidencia de que alguien firmó y de que no se reconoció es parte del
        // registro, igual que una disputa resuelta.
        await docClient.send(new UpdateCommand({
            TableName: SIGNATURES_TABLE,
            Key: { signatureId: id },
            UpdateExpression: 'SET requiereRevision = :no, revision = :rev, estado = :estado',
            ExpressionAttributeValues: {
                ':no': false,
                ':rev': revision,
                ':estado': body.decision === 'confirmada' ? 'valida' : 'revocada',
            },
        }));

        return success({
            message: body.decision === 'confirmada'
                ? 'Firma confirmada: ya cuenta como evidencia de cumplimiento.'
                : 'Firma rechazada: queda registrada como revocada.',
            signatureId: id,
            revision,
        });
    } catch (err) {
        console.error('Error revisando firma:', err);
        return error(err.message, 500);
    }
};

/**
 * GET /signatures/disputes - Listar firmas en disputa
 */
module.exports.listDisputes = async (event) => {
    try {
        const ses = conSesion(event);
        if (!ses.ok) return ses.respuesta;

        // La empresa sale de la sesión. Antes se leía de `?tenantId=` —que el
        // frontend ni siquiera manda, envía `empresaId`—, así que la pantalla no
        // funcionaba y, con el parámetro correcto, listaba disputas ajenas.
        const tenantId = ses.sesion.tenantId;

        // Query por GSI + filter
        const result = await docClient.send(
            new QueryCommand({
                TableName: SIGNATURES_TABLE,
                IndexName: 'tenantId-index',
                KeyConditionExpression: 'tenantId = :tenantId',
                FilterExpression: 'estado = :estado',
                ExpressionAttributeValues: {
                    ':tenantId': tenantId,
                    ':estado': 'disputada',
                },
            })
        );

        const disputes = (result.Items || []).sort((a, b) =>
            new Date(b.disputaInfo?.fechaReporte || 0) - new Date(a.disputaInfo?.fechaReporte || 0)
        );

        return success({ totalDisputas: disputes.length, disputas: disputes });
    } catch (err) {
        console.error('Error listing disputes:', err);
        return error(err.message, 500);
    }
};
