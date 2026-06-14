const { v4: uuidv4 } = require('uuid');
const { PutCommand, GetCommand, QueryCommand, ScanCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient } = require('../../lib/clients/dynamodb');
const { success, error, created } = require('../../lib/utils/response');
const { validateRequired, generateSignatureToken } = require('../../lib/utils/validation');
const { FirmaService } = require('../../lib/services/FirmaService');
const { PersonaService } = require('../../lib/services/PersonaService');
const { TenantService } = require('../../lib/services/TenantService');
const { PERMISSIONS, personaPuede } = require('../../lib/permissions');
const { eventBus } = require('../../lib/events/EventBus');

const TABLE_NAME = process.env.DOCUMENTS_TABLE || 'Documents';

// Permisos que habilitan subir/crear documentos (repositorio o documentos de obra).
const PERMISOS_SUBIR_DOC = [
    PERMISSIONS.REPOSITORIO_SUBIR,
    PERMISSIONS.DOCUMENTOS_SUBIR,
    PERMISSIONS.OBRA_SUBIR_DOCUMENTOS,
];

// Tipos de documentos según el DS 44
const DOCUMENT_TYPES = {
    // Fase PLAN (ciclo Deming)
    IRL: 'Informe de Riesgos Laborales',
    DIAGNOSTICO_LEGAL: 'Diagnóstico de aspectos legales',
    POLITICA_SSO: 'Política de Seguridad y Salud Ocupacional',
    REGLAMENTO_INTERNO: 'Reglamento Interno',
    PROCEDIMIENTO_TRABAJO: 'Procedimiento de Trabajo Seguro',
    MATRIZ_MIPPER: 'Matriz MIPPER',
    MIPER: 'MIPER',
    ENCUESTA_SALUD: 'Encuesta de Salud Pre-Ocupacional',
    TEST_EVALUACION: 'Test de Evaluación',
    ENTREGA_EPP: 'Entrega de EPP',
    CAPACITACION: 'Capacitación',
    CAPACITACION_SST: 'Capacitación SST 8 horas (Art. 16) — firma cruzada relator y trabajador',
    MAPA_RIESGOS: 'Mapa de Riesgos',
    REGISTRO_ACTIVIDAD: 'Registro de Actividad Preventiva (Art. 72)',
    INDUCCION_EMERGENCIA: 'Inducción Plan de Emergencia (Art. 19)',
    VIGILANCIA_SALUD: 'Registro de Vigilancia de Salud (Art. 67)',
    EXAMEN_OCUPACIONAL: 'Registro de Examen Ocupacional (Art. 68)',
    INVESTIGACION_ACCIDENTE: 'Investigación de Accidente / EP',
    RESTRICCION_LABORAL: 'Restricción o Traslado por EP',
    // Fase HACER (ciclo Deming) — procedimientos operativos de obra (DS44 Excel)
    PROCEDIMIENTO_EPP: 'Procedimiento de Provisión y Uso de EPP (Art. 13)',
    OPERACION_MAQUINAS: 'Operación Segura de Máquinas y Herramientas (Art. 10)',
    PROCEDIMIENTO_AGENTES: 'Utilización de Agentes Físicos, Químicos y Biológicos (Art. 2 N°14 c)',
    PLAN_EMERGENCIAS: 'Plan de Gestión y Respuesta ante Emergencias (Art. 19)',
    PROCEDIMIENTO_RIESGO_GRAVE: 'Procedimiento ante Riesgo Grave o Inminente (Art. 18)',
    PROCEDIMIENTO_EVACUACION: 'Evacuación y Traslado de Personas Afectadas (Art. 19)',
    PROCEDIMIENTO_INVESTIGACION: 'Investigación de Accidentes (Árbol de Causas) (Art. 71)',
    GESTION_CAMBIOS: 'Gestión de Cambios en Procesos/Tecnologías/Materiales (Art. 12)',
    COORDINACION_ENTIDADES: 'Coordinación con Otras Entidades en Faena (Art. 20)',
    CONSULTA_REPRESENTANTES: 'Consulta y Participación de Trabajadores (Arts. 17, 37, 71)',
    // Tipos historicos (compatibilidad con datos previos)
    PLAN_CAPACITACION: 'Plan de Capacitación (Art. 16)',
    INFO_RIESGOS_LABORALES: 'Información de Riesgos Laborales (Art. 15)',
    VIGILANCIA_AMBIENTAL: 'Vigilancia Ambiental y de Salud (Art. 67)',
    // Fase HACER — eventos sobrevinientes
    REGISTRO_RIESGO_GRAVE: 'Registro de Riesgo Grave e Inminente (Art. 18)',
    REGISTRO_AT_EP: 'Registro AT, EP e Incidentes Peligrosos (Arts. 71-72)',
    TRASLADO_PUESTO: 'Traslado de Puesto por EP Diagnosticada (Art. 69)',
    // Fase VERIFICAR (CHECK)
    EVALUACION_DESEMPENO: 'Evaluación de Desempeño del SGSST (Arts. 14, 22.4)',
    INFORME_ANUAL_GESTION: 'Informe Anual de Gestión Preventiva (Art. 52.15)',
    REGISTRO_DESVIACIONES: 'Registro de Desviaciones / Incumplimientos (CHECK)',
    // Fase ACTUAR (ACT)
    PLAN_MEJORA: 'Plan de Mejora / Medidas Correctivas (Art. 2.16, Art. 14)',
    OTRO: 'Documento General',
};

/**
 * POST /documents - Crear nuevo documento
 */
module.exports.create = async (event) => {
    try {
        const body = JSON.parse(event.body || '{}');
        const tenantId = body.tenantId || event.queryStringParameters?.tenantId;
        if (!tenantId) return error('tenantId es requerido');

        const validation = validateRequired(body, ['tipo', 'titulo']);
        if (!validation.valid) {
            return error(`Campos requeridos faltantes: ${validation.missing.join(', ')}`);
        }

        if (!DOCUMENT_TYPES[body.tipo]) {
            return error(`Tipo de documento inválido. Tipos válidos: ${Object.keys(DOCUMENT_TYPES).join(', ')}`);
        }

        // Enforcement por permiso cuando se identifica al creador.
        if (body.createdBy) {
            const personaService = new PersonaService();
            const creador = await personaService.getById(body.createdBy).catch(() => null);
            const tenant = await new TenantService().getById(tenantId).catch(() => null);
            const tenantSafe = tenant ? tenant.toSafeFormat() : null;
            const puede = creador && PERMISOS_SUBIR_DOC.some(p => personaPuede(creador, tenantSafe, p));
            if (!puede) {
                return error('No tienes permiso para subir documentos', 403);
            }
        }

        const now = new Date().toISOString();
        const documentId = uuidv4();

        const document = {
            documentId,
            tenantId,
            obraId: body.obraId || null,
            clasificacion: body.clasificacion || 'diario',
            fase: body.fase || null,
            tipo: body.tipo,
            tipoDescripcion: DOCUMENT_TYPES[body.tipo],
            obligatorio: body.obligatorio || false,
            titulo: body.titulo,
            contenido: body.contenido || '',
            descripcion: body.descripcion || '',
            relatorId: body.relatorId || null,
            s3Key: body.s3Key || null,
            archivoUrl: body.archivoUrl || null,
            archivoNombre: body.archivoNombre || null,
            fechaCaducidad: body.fechaCaducidad || null,
            createdBy: body.createdBy || null,
            creatorName: body.creatorName || null,
            firmas: [],
            asignaciones: [],
            estado: 'activo',
            version: 1,
            createdAt: now,
            updatedAt: now,
        };

        await docClient.send(new PutCommand({ TableName: TABLE_NAME, Item: document }));

        // Notificar asignados (usa personaId, no workerId)
        try {
            if (body.assignedTo && Array.isArray(body.assignedTo) && body.assignedTo.length > 0) {
                await eventBus.emit('document.assigned', {
                    documentId: document.documentId,
                    userIds: body.assignedTo,
                    assignedBy: body.createdBy || 'system',
                    creatorName: body.creatorName || 'Gestor SST',
                    documentName: document.titulo,
                    dueDate: body.dueDate || null
                });
            }
        } catch (eventError) {
            console.error('Error emitting document.assigned event:', eventError);
        }

        return created(document);
    } catch (err) {
        console.error('Error creating document:', err);
        return error(err.message, 500);
    }
};

/**
 * GET /documents - Listar documentos
 */
module.exports.list = async (event) => {
    try {
        const { tenantId, tipo, estado, clasificacion, obraId } = event.queryStringParameters || {};
        if (!tenantId) return error('tenantId es requerido');

        // Query por GSI tenantId-index (no Scan)
        const params = {
            TableName: TABLE_NAME,
            IndexName: 'tenantId-index',
            KeyConditionExpression: 'tenantId = :tenantId',
            ExpressionAttributeValues: { ':tenantId': tenantId }
        };

        // Filtros adicionales
        let filterParts = [];
        if (obraId) {
            filterParts.push('obraId = :obraId');
            params.ExpressionAttributeValues[':obraId'] = obraId;
        }
        if (tipo) {
            filterParts.push('tipo = :tipo');
            params.ExpressionAttributeValues[':tipo'] = tipo;
        }
        if (estado) {
            filterParts.push('estado = :estado');
            params.ExpressionAttributeValues[':estado'] = estado;
        }
        if (clasificacion) {
            filterParts.push('clasificacion = :clasificacion');
            params.ExpressionAttributeValues[':clasificacion'] = clasificacion;
        }
        if (filterParts.length > 0) {
            params.FilterExpression = filterParts.join(' AND ');
        }

        const result = await docClient.send(new QueryCommand(params));

        return success({
            documents: result.Items || [],
            types: DOCUMENT_TYPES,
        });
    } catch (err) {
        console.error('Error listing documents:', err);
        return error(err.message, 500);
    }
};

/**
 * GET /documents/{id} - Obtener documento por ID
 */
module.exports.get = async (event) => {
    try {
        const { id } = event.pathParameters || {};

        if (!id) {
            return error('ID de documento requerido');
        }

        const result = await docClient.send(
            new GetCommand({
                TableName: TABLE_NAME,
                Key: { documentId: id },
            })
        );

        if (!result.Item) {
            return error('Documento no encontrado', 404);
        }

        return success(result.Item);
    } catch (err) {
        console.error('Error getting document:', err);
        return error(err.message, 500);
    }
};

/**
 * PUT /documents/{id} - Actualizar documento
 */
module.exports.update = async (event) => {
    try {
        const { id } = event.pathParameters || {};
        if (!id) return error('ID de documento requerido');

        const body = JSON.parse(event.body || '{}');
        const allowedFields = ['titulo', 'descripcion', 'contenido', 's3Key', 'archivoUrl', 'archivoNombre', 'estado', 'clasificacion', 'fase', 'tipo', 'obligatorio', 'fechaCaducidad'];
        const updateExpressions = [];
        const expressionNames = {};
        const expressionValues = {};

        allowedFields.forEach((field) => {
            if (body[field] !== undefined) {
                updateExpressions.push(`#${field} = :${field}`);
                expressionNames[`#${field}`] = field;
                expressionValues[`:${field}`] = body[field];
            }
        });

        if (updateExpressions.length === 0) {
            return error('No hay campos para actualizar');
        }

        updateExpressions.push('#updatedAt = :updatedAt');
        expressionNames['#updatedAt'] = 'updatedAt';
        expressionValues[':updatedAt'] = new Date().toISOString();

        const result = await docClient.send(new UpdateCommand({
            TableName: TABLE_NAME,
            Key: { documentId: id },
            UpdateExpression: `SET ${updateExpressions.join(', ')}`,
            ExpressionAttributeNames: expressionNames,
            ExpressionAttributeValues: expressionValues,
            ReturnValues: 'ALL_NEW'
        }));

        return success(result.Attributes);
    } catch (err) {
        console.error('Error updating document:', err);
        return error(err.message, 500);
    }
};

/**
 * POST /documents/{id}/assign - Asignar documento a trabajador(es)
 */
module.exports.assign = async (event) => {
    try {
        const { id } = event.pathParameters || {};
        const body = JSON.parse(event.body || '{}');

        if (!id) return error('ID de documento requerido');

        const personaIds = body.personaIds;
        const { fechaLimite, notificar, assignedBy, assignerName, replace } = body;

        if (!personaIds || !Array.isArray(personaIds) || personaIds.length === 0) {
            return error('Se requiere un array de IDs de personas');
        }

        const docResult = await docClient.send(new GetCommand({
            TableName: TABLE_NAME,
            Key: { documentId: id }
        }));

        if (!docResult.Item) return error('Documento no encontrado', 404);

        // Lookup personas via PersonaService (solo del tenant del documento)
        const personaService = new PersonaService();
        const now = new Date().toISOString();
        const nuevasAsignaciones = [];
        const documentTenantId = docResult.Item.tenantId || null;

        for (const pid of personaIds) {
            const persona = await personaService.getById(pid);
            if (documentTenantId && persona?.tenantId && persona.tenantId !== documentTenantId) {
                console.warn(`[Documents] Persona ${pid} pertenece a otro tenant (${persona.tenantId} != ${documentTenantId}), omitida de la asignación`);
                continue;
            }
            nuevasAsignaciones.push({
                personaId: pid,
                nombre: persona ? `${persona.nombre} ${persona.apellido || ''}`.trim() : pid,
                rut: persona?.rut || null,
                fechaAsignacion: now,
                fechaLimite: fechaLimite || null,
                estado: 'pendiente',
                notificado: notificar || false
            });
        }

        if (nuevasAsignaciones.length === 0) {
            return error('Las personas especificadas no pertenecen a la organización del documento', 400);
        }

        const shouldReplace = Boolean(replace);
        const asignaciones = shouldReplace
            ? nuevasAsignaciones
            : [...(docResult.Item.asignaciones || []), ...nuevasAsignaciones];

        const updateExpression = shouldReplace
            ? 'SET asignaciones = :asignaciones, firmas = :firmas, updatedAt = :updatedAt'
            : 'SET asignaciones = :asignaciones, updatedAt = :updatedAt';

        const expressionAttributeValues = shouldReplace
            ? { ':asignaciones': asignaciones, ':firmas': [], ':updatedAt': now }
            : { ':asignaciones': asignaciones, ':updatedAt': now };

        await docClient.send(new UpdateCommand({
            TableName: TABLE_NAME,
            Key: { documentId: id },
            UpdateExpression: updateExpression,
            ExpressionAttributeValues: expressionAttributeValues
        }));

        // Notificar asignados (solo los que quedaron efectivamente asignados)
        const assignedIds = nuevasAsignaciones.map(a => a.personaId);
        try {
            await eventBus.emit('document.assigned', {
                documentId: id,
                userIds: assignedIds,
                assignedBy: assignedBy || 'system',
                creatorName: assignerName || docResult.Item.creatorName || 'Gestor SST',
                documentName: docResult.Item.titulo,
                dueDate: fechaLimite || null
            });
        } catch (eventError) {
            console.error('Error emitting document.assigned event:', eventError);
        }

        return success({
            message: `Documento asignado a ${nuevasAsignaciones.length} persona(s)`,
            asignaciones: nuevasAsignaciones
        });
    } catch (err) {
        console.error('Error assigning document:', err);
        return error(err.message, 500);
    }
};

/**
 * POST /documents/{id}/sign - Firmar documento (individual)
 */
module.exports.sign = async (event) => {
    try {
        const { id } = event.pathParameters || {};
        const body = JSON.parse(event.body || '{}');

        if (!id) return error('ID de documento requerido');

        const signerPersonaId = body.personaId;
        if (!signerPersonaId || !body.tipoFirma) {
            return error('personaId y tipoFirma son requeridos');
        }

        const docResult = await docClient.send(new GetCommand({
            TableName: TABLE_NAME,
            Key: { documentId: id }
        }));
        if (!docResult.Item) return error('Documento no encontrado', 404);
        const documentData = docResult.Item;

        const personaService = new PersonaService();
        const persona = await personaService.getById(signerPersonaId);
        if (!persona) return error('Persona no encontrada', 404);

        // La persona solo puede firmar documentos de su propia empresa
        if (documentData.tenantId && persona.tenantId && documentData.tenantId !== persona.tenantId) {
            return error('El documento no pertenece a tu organización', 403);
        }

        const esFirmaRelator = body.tipoFirma === 'relator';
        if (esFirmaRelator) {
            if (!documentData.requiereFirmaRelator) {
                return error('Este documento no requiere firma de relator', 400);
            }
            if (!persona.tienePermiso('firmar_relator')) {
                return error('No tienes permiso para firmar como relator', 403);
            }
        }

        // ENTREGA_EPP: el trabajador no puede firmar la recepcion hasta que una
        // instancia superior valide la entrega (decision reunion 2026-06-10).
        if (!esFirmaRelator && documentData.tipo === 'ENTREGA_EPP'
            && documentData.validacion?.requerida
            && documentData.validacion?.estado !== 'validado') {
            return error('La entrega de EPP debe ser validada por una instancia superior antes de firmar la recepcion', 400);
        }

        const contexto = {
            ipAddress: event.requestContext?.http?.sourceIp || 'unknown',
            userAgent: event.headers?.['user-agent'] || 'unknown'
        };

        const metodo = body.pin ? 'PIN' : 'PRESENCIAL';
        let firmaResult;
        try {
            firmaResult = await FirmaService.crear({
                personaId: signerPersonaId,
                tenantId: documentData.tenantId,
                metodo,
                credencial: body.pin || {},
                tipoFirma: body.tipoFirma,
                referenciaId: id,
                referenciaTipo: 'document',
                contexto,
                metadata: esFirmaRelator ? { rolFirma: 'relator', modalidad: body.modalidad || null } : null,
                persona
            });
        } catch (firmaErr) {
            return error(firmaErr.message, 400);
        }

        const now = new Date().toISOString();
        const firmaEmbebida = FirmaService.toDocumentFirmaFormat(firmaResult);
        const firmas = [...(documentData.firmas || []), firmaEmbebida];

        let updateExpression = 'SET firmas = :firmas, updatedAt = :updatedAt';
        const expressionValues = { ':firmas': firmas, ':updatedAt': now };

        if (esFirmaRelator) {
            // La firma del relator no toca asignaciones: registra firmaRelator.
            updateExpression += ', firmaRelator = :firmaRelator';
            expressionValues[':firmaRelator'] = {
                personaId: persona.personaId,
                nombre: `${persona.nombre} ${persona.apellido || ''}`.trim(),
                timestamp: now,
                estado: 'firmado'
            };
            if (body.modalidad) {
                updateExpression += ', modalidad = :modalidad';
                expressionValues[':modalidad'] = String(body.modalidad);
            }
        } else {
            const asignaciones = (documentData.asignaciones || []).map((a) => {
                if (a.personaId === signerPersonaId && a.estado === 'pendiente') {
                    return { ...a, estado: 'firmado', fechaFirma: now };
                }
                return a;
            });
            updateExpression += ', asignaciones = :asignaciones';
            expressionValues[':asignaciones'] = asignaciones;
        }

        await docClient.send(new UpdateCommand({
            TableName: TABLE_NAME,
            Key: { documentId: id },
            UpdateExpression: updateExpression,
            ExpressionAttributeValues: expressionValues
        }));

        return success({
            message: esFirmaRelator ? 'Firma de relator registrada' : 'Documento firmado exitosamente',
            firma: firmaEmbebida,
            signatureId: firmaResult.signatureId,
            token: firmaResult.token
        });
    } catch (err) {
        console.error('Error signing document:', err);
        return error(err.message, 500);
    }
};

/**
 * POST /documents/{id}/sign-assisted - Firma asistida por un tercero.
 *
 * Un admin/jefe_obra/supervisor/prevencionista inicia la firma de un documento
 * en su dispositivo, y el TRABAJADOR teclea su propio PIN para firmar. La firma
 * queda con personaId del trabajador (no del asistente) y metadata.asistidoPor
 * para trazabilidad/defensa legal.
 *
 * Body: { tenantId, firmanteId, pin, asistidoPor, metodo: 'PIN'|'PRESENCIAL', firmaManuscrita? }
 */
module.exports.signAssisted = async (event) => {
    try {
        const { id } = event.pathParameters || {};
        const body = JSON.parse(event.body || '{}');
        if (!id) return error('ID de documento requerido');

        const { firmanteId, asistidoPor, metodo = 'PIN' } = body;
        if (!firmanteId) return error('firmanteId (trabajador) es requerido');
        if (!asistidoPor) return error('asistidoPor (quien asiste la firma) es requerido');

        const personaService = new PersonaService();

        // 1. El asistente debe tener permiso 'firmar_asistido'
        const asistente = await personaService.getById(asistidoPor);
        if (!asistente) return error('Asistente no encontrado', 404);
        if (!asistente.tienePermiso('firmar_asistido')) {
            return error('No tienes permiso para iniciar una firma asistida', 403);
        }

        // 2. Documento existe y el firmante esta asignado a el
        const docResult = await docClient.send(new GetCommand({
            TableName: TABLE_NAME,
            Key: { documentId: id }
        }));
        if (!docResult.Item) return error('Documento no encontrado', 404);
        const documentData = docResult.Item;

        const asignacionFirmante = (documentData.asignaciones || []).find(
            (a) => a.personaId === firmanteId
        );
        if (!asignacionFirmante) {
            return error('El trabajador no esta asignado a este documento', 400);
        }

        // ENTREGA_EPP: la recepcion no puede firmarse sin validacion previa de
        // una instancia superior (decision reunion 2026-06-10).
        if (documentData.tipo === 'ENTREGA_EPP'
            && documentData.validacion?.requerida
            && documentData.validacion?.estado !== 'validado') {
            return error('La entrega de EPP debe ser validada por una instancia superior antes de firmar la recepcion', 400);
        }

        // 3. Firmante pertenece al tenant y esta enrolado/habilitado
        const firmante = await personaService.getById(firmanteId);
        if (!firmante) return error('Trabajador no encontrado', 404);
        if (asistente.tenantId !== firmante.tenantId) {
            return error('El trabajador no pertenece a tu organizacion', 403);
        }
        if (!firmante.habilitado) {
            return error('El trabajador no ha completado su enrolamiento', 400);
        }

        // 4. Firmar (metodo PIN valida el PIN del TRABAJADOR, no del asistente)
        const contexto = {
            ipAddress: event.requestContext?.http?.sourceIp || 'unknown',
            userAgent: event.headers?.['user-agent'] || 'unknown'
        };
        const credencial = metodo === 'PIN'
            ? (body.pin || {})
            : { firmaManuscrita: body.firmaManuscrita || null };

        let firmaResult;
        try {
            firmaResult = await FirmaService.crear({
                personaId: firmanteId,
                tenantId: firmante.tenantId,
                metodo,
                credencial,
                tipoFirma: 'documento',
                referenciaId: id,
                referenciaTipo: 'document',
                contexto,
                metadata: { asistidoPor, modalidad: 'firma_asistida' },
                persona: firmante
            });
        } catch (firmaErr) {
            return error(firmaErr.message, 400);
        }

        const firmaEmbebida = FirmaService.toDocumentFirmaFormat(firmaResult);
        const firmas = [...(documentData.firmas || []), firmaEmbebida];
        const now = new Date().toISOString();
        const asignaciones = (documentData.asignaciones || []).map((a) => {
            if (a.personaId === firmanteId && a.estado === 'pendiente') {
                return { ...a, estado: 'firmado', fechaFirma: now, asistidoPor };
            }
            return a;
        });

        await docClient.send(new UpdateCommand({
            TableName: TABLE_NAME,
            Key: { documentId: id },
            UpdateExpression: 'SET firmas = :firmas, asignaciones = :asignaciones, updatedAt = :updatedAt',
            ExpressionAttributeValues: {
                ':firmas': firmas,
                ':asignaciones': asignaciones,
                ':updatedAt': now
            }
        }));

        return success({
            message: 'Documento firmado (firma asistida)',
            firma: firmaEmbebida,
            signatureId: firmaResult.signatureId,
            token: firmaResult.token
        });
    } catch (err) {
        console.error('Error in assisted signing:', err);
        return error(err.message, 500);
    }
};

/**
 * POST /documents/{id}/sign-bulk - Firma masiva de documento
 */
module.exports.signBulk = async (event) => {
    try {
        const { id } = event.pathParameters || {};
        const body = JSON.parse(event.body || '{}');

        if (!id) return error('ID de documento requerido');

        const personaIds = body.personaIds;
        const { tipoFirma, pin } = body;

        if (!personaIds || !Array.isArray(personaIds) || personaIds.length === 0) {
            return error('Se requiere un array de IDs de personas');
        }

        const docResult = await docClient.send(new GetCommand({
            TableName: TABLE_NAME,
            Key: { documentId: id }
        }));
        if (!docResult.Item) return error('Documento no encontrado', 404);
        const documentData = docResult.Item;

        const contexto = {
            ipAddress: event.requestContext?.http?.sourceIp || 'unknown',
            userAgent: event.headers?.['user-agent'] || 'unknown'
        };

        const metodo = pin ? 'PIN' : 'PRESENCIAL';
        const resultado = await FirmaService.crearBatch(personaIds, {
            tenantId: documentData.tenantId,
            metodo,
            credencial: pin || {},
            tipoFirma: tipoFirma || 'trabajador',
            referenciaId: id,
            referenciaTipo: 'document',
            contexto
        });

        const nuevasFirmas = resultado.exitosas.map(f => FirmaService.toDocumentFirmaFormat(f));
        const firmas = [...(documentData.firmas || []), ...nuevasFirmas];

        const asignaciones = (documentData.asignaciones || []).map((a) => {
            const firmado = personaIds.includes(a.personaId);
            if (firmado && a.estado === 'pendiente') {
                return { ...a, estado: 'firmado', fechaFirma: new Date().toISOString() };
            }
            return a;
        });

        await docClient.send(new UpdateCommand({
            TableName: TABLE_NAME,
            Key: { documentId: id },
            UpdateExpression: 'SET firmas = :firmas, asignaciones = :asignaciones, updatedAt = :updatedAt',
            ExpressionAttributeValues: {
                ':firmas': firmas,
                ':asignaciones': asignaciones,
                ':updatedAt': new Date().toISOString()
            }
        }));

        return success({
            message: `${resultado.exitosas.length} firmas registradas exitosamente`,
            firmas: nuevasFirmas,
            errores: resultado.fallidas.length > 0 ? resultado.fallidas : undefined
        });
    } catch (err) {
        console.error('Error bulk signing document:', err);
        return error(err.message, 500);
    }
};
