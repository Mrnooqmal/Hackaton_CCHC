const { v4: uuidv4 } = require('uuid');
const { PutCommand, GetCommand, QueryCommand, ScanCommand, UpdateCommand, DeleteCommand } = require('@aws-sdk/lib-dynamodb');
const { GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { SQSClient, SendMessageCommand } = require('@aws-sdk/client-sqs');
const { docClient } = require('../../lib/clients/dynamodb');
const { s3Client } = require('../../lib/clients/s3');
const { success, error, created } = require('../../lib/utils/response');
const { validateRequired, generateSignatureToken } = require('../../lib/utils/validation');
const { FirmaService } = require('../../lib/services/FirmaService');
const { PersonaService } = require('../../lib/services/PersonaService');
const { TenantService } = require('../../lib/services/TenantService');
const { PdfStampingService } = require('../../lib/services/PdfStampingService');
const { PERMISSIONS, personaPuede } = require('../../lib/permissions');
const { DESTINATARIO, MEDIO } = require('../../lib/distribucion');

const DESTINATARIOS_VALIDOS = new Set(Object.values(DESTINATARIO));
const MEDIOS_VALIDOS = new Set(Object.values(MEDIO));
const { eventBus } = require('../../lib/events/EventBus');

const TABLE_NAME = process.env.DOCUMENTS_TABLE || 'Documents';
const DOCUMENTS_BUCKET = process.env.DOCUMENTS_BUCKET;
const DOCUMENT_STAMP_QUEUE_URL = process.env.DOCUMENT_STAMP_QUEUE_URL;
const sqsClient = new SQSClient({ region: process.env.AWS_REGION || 'us-east-1' });

// Construye las piezas de la UpdateCommand atómica de firmas — ver
// FirmaService.buildFirmaUpdateParts (compartida con handlers/signatures).
const buildFirmaUpdateParts = FirmaService.buildFirmaUpdateParts;

// Permisos que habilitan subir/crear documentos (repositorio o documentos de fase).
const PERMISOS_SUBIR_DOC = [
    PERMISSIONS.REPOSITORIO_SUBIR,
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
    VIGILANCIA_SALUD: 'Programa de Vigilancia de la Salud (Art. 67)',
    EXAMEN_OCUPACIONAL: 'Registro de Examen Ocupacional (Art. 68)',
    INVESTIGACION_ACCIDENTE: 'Investigación de Accidente / EP',
    RESTRICCION_LABORAL: 'Restricción o Traslado por EP',
    // Fase HACER (ciclo Deming) — procedimientos operativos de obra (DS44 Excel)
    PROCEDIMIENTO_EPP: 'Procedimiento de Provisión y Uso de EPP (Art. 13)',
    VIGILANCIA_AMBIENTAL: 'Programa de Vigilancia Ambiental (Art. 67)',
    OPERACION_MAQUINAS: 'Operación Segura de Máquinas y Herramientas (Art. 10)',
    PROCEDIMIENTO_AGENTES: 'Utilización de Agentes Físicos, Químicos y Biológicos (Art. 2 N°14 c)',
    PLAN_EMERGENCIAS: 'Plan de Gestión y Respuesta ante Emergencias (Art. 19)',
    PROCEDIMIENTO_RIESGO_GRAVE: 'Procedimiento ante Riesgo Grave o Inminente (Art. 18)',
    PROCEDIMIENTO_EVACUACION: 'Evacuación y Traslado de Personas Afectadas (Art. 19)',
    PROCEDIMIENTO_INVESTIGACION: 'Investigación de Accidentes (Árbol de Causas) (Art. 71)',
    GESTION_CAMBIOS: 'Gestión de Cambios en Procesos/Tecnologías/Materiales (Art. 12)',
    COORDINACION_ENTIDADES: 'Coordinación con Otras Entidades en Faena (Art. 20)',
    CONSULTA_REPRESENTANTES: 'Consulta y Participación de Trabajadores (Arts. 17, 37, 71)',
    PROGRAMA_TRABAJO_PREVENTIVO: 'Programa de Trabajo Preventivo (Art. 8)',
    // Tipos historicos (compatibilidad con datos previos)
    PLAN_CAPACITACION: 'Plan de Capacitación (Art. 16)',
    INFO_RIESGOS_LABORALES: 'Información de Riesgos Laborales (Art. 15)',
    // Fase HACER — registros de ejecucion (evidencia de que la actividad ocurrio).
    // Se distinguen del procedimiento homonimo: PLAN_EMERGENCIAS es el plan escrito
    // y ACTA_ENSAYO_EMERGENCIA es el acta del ensayo; COORDINACION_ENTIDADES es el
    // procedimiento y REGISTRO_COORDINACION el acta de las reuniones.
    ACTA_ENSAYO_EMERGENCIA: 'Acta del Ensayo del Plan de Emergencias (Art. 19)',
    REGISTRO_COORDINACION: 'Registro de Reuniones de Coordinación entre Empleadores (Art. 20)',
    PUBLICACION_MAPA_RIESGOS: 'Evidencia de Publicación del Mapa de Riesgos (Art. 62)',
    REGISTRO_CONSULTA: 'Registro de Consulta a los Representantes de las Personas Trabajadoras (Art. 17)',
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
    // --- Estructura preventiva (DS 44 Arts. 23, 32, 36, 39, 42, 50, 55, 65, 66) ---
    // Todos cuelgan de un organo o de una reunion via su documentId. No se crean
    // tablas por tipo de acta: un acta es un Documento con tipo.
    ACTA_ELECCION_REPRESENTANTES: 'Acta de eleccion de representantes de las personas trabajadoras (Art. 23)',
    DESIGNACION_REPRESENTANTES_EMPLEADOR: 'Designacion de representantes de la entidad empleadora (Art. 23)',
    ACTA_CONSTITUCION_CPHS: 'Acta de constitucion del Comite Paritario (Art. 23)',
    ACTA_REUNION_CPHS: 'Acta de reunion del Comite Paritario (Arts. 39 y 42)',
    COMUNICACION_ACUERDOS_CPHS: 'Comunicacion de acuerdos a la entidad empleadora (Art. 42)',
    ACTA_ASAMBLEA_DELEGADO: 'Acta de asamblea de eleccion del Delegado de SST (Art. 66)',
    COMPROBANTE_REGISTRO_DT: 'Comprobante de registro en la Direccion del Trabajo (Art. 36)',
    CERTIFICADO_CURSO_OPR: 'Certificado de curso de orientacion en prevencion de riesgos (Art. 32)',
    CERTIFICADO_CAPACITACION_ENCARGADO: 'Certificado de capacitacion del encargado de gestion del riesgo (Art. 65)',
    REGISTRO_SEREMI_EXPERTO: 'Registro en la Seremi de Salud del experto del Departamento de Prevencion (Art. 55)',
    DESIGNACION_ENCARGADO_RIESGO: 'Designacion del encargado en materia de gestion del riesgo (Art. 65)',
    PROGRAMA_TRABAJO_CPHS: 'Programa de trabajo del Comite Paritario (Art. 47)',
    // --- Sistema de Gestion de SST (item 1, Art. 22) ---
    // Los literales d) y e) del Art. 22 no tenian dueno: la evaluacion del
    // desempeno y las acciones de mejora se cubren con estos tipos cuando el
    // modulo correspondiente no aporta un documento propio.
    AUDITORIA_SGSST: 'Evaluacion o auditoria del desempeno del SGSST (Art. 22 letra d)',
    ACCIONES_MEJORA_SGSST: 'Acciones de mejora continua o correctivas del SGSST (Art. 22 letra e)',
    REGISTROS_INDICADORES_SST: 'Registros e indicadores de SST (Arts. 73 a 75)',
    OTRO: 'Documento General',
    // Tipos de libre creación desde /documents (no gestionados por onboarding/obra).
    COMUNICADO: 'Comunicado interno',
    INSTRUCTIVO: 'Instructivo / Manual',
    OTRO_NORMATIVO: 'Otro documento de empresa',
    ACTA_REGISTRO: 'Acta / Registro',
    OTRO_DIARIO: 'Otro registro de obra',
};

// Procedimientos de obra (DS 44): documentos cuya actualización de versión debe
// notificarse a la línea de mando y re-firmarse. Espejo de DS44_DO_PROCEDIMIENTOS
// en Frontend/src/utils/ds44.ts (más el procedimiento de trabajo genérico).
//
// La MIPER no es un procedimiento del HACER, pero entra acá porque el Art. 7
// inc. 9 le exige el mismo ciclo: al revisarla hay que volver a informarla a la
// línea de mando y re-firmarla. `MATRIZ_MIPPER` es el alias histórico del mismo
// documento (ver DS44_PLAN_DOCS.tipos) y va incluido para las obras antiguas.
const TIPOS_PROCEDIMIENTO = new Set([
    'PROCEDIMIENTO_TRABAJO', 'PROCEDIMIENTO_EPP', 'OPERACION_MAQUINAS', 'PROCEDIMIENTO_AGENTES',
    'PLAN_EMERGENCIAS', 'PROCEDIMIENTO_RIESGO_GRAVE', 'PROCEDIMIENTO_EVACUACION',
    'PROCEDIMIENTO_INVESTIGACION', 'GESTION_CAMBIOS', 'COORDINACION_ENTIDADES', 'CONSULTA_REPRESENTANTES',
    'VIGILANCIA_AMBIENTAL', 'VIGILANCIA_SALUD',
    'MIPER', 'MATRIZ_MIPPER',
    // El Art. 57 inc. 5 obliga a revisar el Reglamento al menos cada año CON
    // participacion del comite o del delegado, y el FUF 51 pide el registro de
    // control de cambios. Es el mismo ciclo de la MIPER: al publicar una version
    // se re-informa y se re-firma, asi que se versiona igual aunque sea un
    // documento de la fase PLAN.
    'REGLAMENTO_INTERNO',
]);
const esProcedimiento = (tipo) => TIPOS_PROCEDIMIENTO.has(tipo);

// Documentos corporativos: su archivo maestro es una plantilla del catalogo del
// tenant y se reparte en copias por persona (ver nuevaVersionCorporativa).
const TIPOS_CORPORATIVOS = new Set(['REGLAMENTO_INTERNO', 'POLITICA_SSO']);

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
            periodo: body.periodo || null,
            // Desde cuándo rige el documento. Es contra esta fecha, y no contra la
            // de subida, que el Art. 57 inc. 2 mide los 30 días de anticipación del
            // Reglamento Interno: subir el archivo no es haberlo informado.
            fechaEntradaVigencia: body.fechaEntradaVigencia || null,
            // Fecha del hecho que el documento acredita. Distinta de createdAt:
            // un acta de un simulacro de marzo subida en septiembre acredita marzo,
            // y es contra esta fecha que se mide la vigencia anual (Art. 19).
            fecha: body.fecha || null,
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
        const { tenantId, tipo, estado, clasificacion, obraId, pendienteDe, asignadoA } = event.queryStringParameters || {};
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
        let documents = result.Items || [];

        // Por defecto se ocultan los archivados (soft-delete al desasignar de la
        // obra). Solo aparecen si se piden explícitamente con estado=archivado.
        if (estado !== 'archivado') {
            documents = documents.filter((doc) => doc.estado !== 'archivado');
        }

        // pendienteDe={personaId}: documentos de onboarding listos para que ESA
        // persona los firme — tiene asignación pendiente Y el doc ya tiene archivo
        // (plantilla pegada). DynamoDB no filtra dentro de listas de mapas, por eso
        // se filtra en código (la query ya está acotada por tenant).
        if (pendienteDe) {
            documents = documents.filter((doc) => {
                const tieneArchivo = Boolean(doc.s3Key || doc.archivoUrl);
                if (!tieneArchivo) return false;
                return (doc.asignaciones || []).some(
                    (a) => a.personaId === pendienteDe && a.estado === 'pendiente'
                );
            });
        }

        // asignadoA={personaId}: TODOS los documentos donde esa persona tiene una
        // asignación (firmada o pendiente), para calcular su cumplimiento personal.
        if (asignadoA) {
            documents = documents.filter((doc) =>
                (doc.asignaciones || []).some((a) => a.personaId === asignadoA)
            );
        }

        return success({
            documents,
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
 * DELETE /documents/{id} - Eliminar un documento.
 *
 * Pensado para los requisitos que admiten varios documentos a la vez (los planes
 * de emergencia): sin esto, una colección solo puede crecer y un plan subido por
 * error queda para siempre. Un documento YA FIRMADO no se elimina: la firma es
 * un registro con validez legal (DS 44). Para reemplazar su contenido está
 * `update`, que archiva la versión anterior.
 */
module.exports.remove = async (event) => {
    try {
        const { id } = event.pathParameters || {};
        if (!id) return error('ID de documento requerido');

        const cur = await docClient.send(new GetCommand({ TableName: TABLE_NAME, Key: { documentId: id } }));
        const doc = cur.Item;
        if (!doc) return error('Documento no encontrado', 404);

        if (Array.isArray(doc.firmas) && doc.firmas.length > 0) {
            return error('Este documento ya tiene firmas y no se puede eliminar. Sube una versión nueva si necesitas corregirlo.', 409);
        }

        // Enforcement por permiso + aislamiento de tenant cuando se identifica al actor.
        const actorId = event.queryStringParameters?.actorId;
        if (actorId) {
            const personaService = new PersonaService();
            const actor = await personaService.getById(actorId).catch(() => null);
            if (!actor || actor.tenantId !== doc.tenantId) {
                return error('No autorizado para este documento', 403);
            }
            const tenant = await new TenantService().getById(doc.tenantId).catch(() => null);
            const tenantSafe = tenant ? tenant.toSafeFormat() : null;
            if (!PERMISOS_SUBIR_DOC.some((p) => personaPuede(actor, tenantSafe, p))) {
                return error('No tienes permiso para eliminar documentos', 403);
            }
        }

        await docClient.send(new DeleteCommand({ TableName: TABLE_NAME, Key: { documentId: id } }));
        return success({ documentId: id });
    } catch (err) {
        console.error('Error deleting document:', err);
        return error(err.message, 500);
    }
};

/**
 * PUT /documents/{id} - Actualizar documento
 *
 * Si la actualización reemplaza el archivo, la versión anterior NO se pierde:
 * se archiva en `versiones[]` y sube el contador `version`. Es un invariante del
 * documento (reemplazar nunca destruye lo anterior), no una función de un
 * endpoint, por eso vive acá y cubre todas las pantallas que reemplazan archivos.
 * A diferencia de `nuevaVersion`, no toca firmas ni asignaciones.
 */
module.exports.update = async (event) => {
    try {
        const { id } = event.pathParameters || {};
        if (!id) return error('ID de documento requerido');

        const body = JSON.parse(event.body || '{}');
        const allowedFields = ['titulo', 'descripcion', 'contenido', 's3Key', 'archivoUrl', 'archivoNombre', 'estado', 'clasificacion', 'fase', 'tipo', 'obligatorio', 'fechaCaducidad', 'periodo', 'fecha', 'fechaEntradaVigencia'];
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

        // Archivar la versión saliente cuando el archivo cambia de verdad.
        const nuevoS3Key = body.s3Key !== undefined ? body.s3Key : body.archivoUrl;
        if (nuevoS3Key) {
            const cur = await docClient.send(new GetCommand({ TableName: TABLE_NAME, Key: { documentId: id } }));
            const doc = cur.Item;
            if (!doc) return error('Documento no encontrado', 404);

            const s3KeyActual = doc.s3Key || doc.archivoUrl || null;
            if (s3KeyActual && s3KeyActual !== nuevoS3Key) {
                const versionActual = doc.version || 1;
                const snapshot = {
                    version: versionActual,
                    s3Key: s3KeyActual,
                    archivoNombre: doc.archivoNombre || null,
                    publicadaPor: doc.ultimaPublicacionPor || doc.createdBy || null,
                    publicadaPorNombre: doc.ultimaPublicacionNombre || doc.creatorName || null,
                    publicadaEn: doc.updatedAt || doc.createdAt || null,
                    motivo: doc.ultimoMotivoVersion || null,
                    participantes: doc.ultimosParticipantesRevision || null,
                };
                const versiones = Array.isArray(doc.versiones) ? [...doc.versiones, snapshot] : [snapshot];

                updateExpressions.push('#version = :version', '#versiones = :versiones');
                expressionNames['#version'] = 'version';
                expressionNames['#versiones'] = 'versiones';
                expressionValues[':version'] = versionActual + 1;
                expressionValues[':versiones'] = versiones;

                // El PDF con el anexo de firmas estampado corresponde al archivo viejo.
                updateExpressions.push('#docFirmadoKey = :nulo', '#docFirmadoCount = :cero');
                expressionNames['#docFirmadoKey'] = 'documentoFirmadoS3Key';
                expressionNames['#docFirmadoCount'] = 'documentoFirmadoFirmaCount';
                expressionValues[':nulo'] = null;
                expressionValues[':cero'] = 0;

                if (body.publicadaPor !== undefined) {
                    updateExpressions.push('#pubPor = :pubPor', '#pubNombre = :pubNombre');
                    expressionNames['#pubPor'] = 'ultimaPublicacionPor';
                    expressionNames['#pubNombre'] = 'ultimaPublicacionNombre';
                    expressionValues[':pubPor'] = body.publicadaPor || null;
                    expressionValues[':pubNombre'] = body.publicadaPorNombre || null;
                }
            }
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
 * POST /documents/{id}/nueva-version — Publica una nueva versión de un
 * PROCEDIMIENTO. Archiva la versión anterior (con sus firmas) en `versiones[]`,
 * sube `version`, reemplaza el archivo, resetea las asignaciones a 'pendiente'
 * (re-firma obligatoria) e invalida el PDF estampado cacheado. Emite
 * `document.version.updated` → notifica a la línea de mando y a los firmantes.
 *
 * Body: { s3Key, archivoNombre?, motivo, notasCambio?, publicadaPor?,
 *         publicadaPorNombre?, versionEsperada? }
 */
/**
 * POST /documents/corporativo/nueva-version
 *
 * Publica una version nueva de un documento CORPORATIVO (Reglamento Interno,
 * Politica SST) — FUF 51, Art. 57 inc. 5.
 *
 * Por que existe aparte de `nuevaVersion`: el Reglamento no es un documento de
 * obra. Su archivo maestro vive como plantilla del catalogo de cargos del tenant
 * y `createOnboardingDocument` reparte UNA COPIA POR PERSONA al vincularla. No
 * hay un unico documentId al que apuntar, asi que versionar "el Reglamento" es
 * versionar las N copias a la vez.
 *
 * Hace tres cosas que la norma pide juntas:
 *   1. archiva la version anterior de cada copia y sube su `version`,
 *   2. resetea las asignaciones a `pendiente` — re-firma obligatoria, y
 *   3. emite UNA sola notificacion consolidada (no N), que con el resolver de
 *      representantes alcanza al comite paritario y al delegado.
 *
 * El archivo maestro del catalogo lo actualiza el frontend por separado: es
 * config del tenant, no un documento.
 */
module.exports.nuevaVersionCorporativa = async (event) => {
    try {
        const body = JSON.parse(event.body || '{}');
        const { tenantId, tipo, s3Key, archivoNombre, motivo, notasCambio, publicadaPor, publicadaPorNombre, participantesRevision } = body;

        if (!tenantId) return error('tenantId es requerido');
        if (!TIPOS_CORPORATIVOS.has(tipo)) {
            return error(`tipo inválido. Corporativos: ${[...TIPOS_CORPORATIVOS].join(', ')}`);
        }
        if (!s3Key) return error('s3Key (archivo de la nueva versión) es requerido');
        if (!motivo || !String(motivo).trim()) return error('El motivo del cambio es requerido');

        // Copias vigentes de ese tipo en el tenant (GSI, no Scan).
        const res = await docClient.send(new QueryCommand({
            TableName: TABLE_NAME,
            IndexName: 'tenantId-index',
            KeyConditionExpression: 'tenantId = :t',
            FilterExpression: '#tipo = :tipo AND #estado <> :anulado',
            ExpressionAttributeNames: { '#tipo': 'tipo', '#estado': 'estado' },
            ExpressionAttributeValues: { ':t': tenantId, ':tipo': tipo, ':anulado': 'anulado' },
        }));
        const copias = res.Items || [];
        if (copias.length === 0) {
            return error('No hay copias de este documento para versionar. Súbelo primero desde el catálogo de cargos.', 404);
        }

        const now = new Date().toISOString();
        const firmantes = new Set();
        let actualizados = 0;

        for (const doc of copias) {
            const versionPrevia = doc.version || 1;
            const snapshot = {
                version: versionPrevia,
                s3Key: doc.s3Key || doc.archivoUrl || null,
                archivoNombre: doc.archivoNombre || null,
                motivo: doc.ultimoMotivoVersion || null,
                // FUF 51 / Art. 57 inc. 5: participantes de la revisión anual.
                participantes: doc.ultimosParticipantesRevision || null,
                firmas: doc.firmas || [],
                publicadaPor: doc.ultimaPublicacionPor || null,
                publicadaEn: doc.updatedAt || null,
            };
            const asignacionesReset = (doc.asignaciones || []).map(a => ({
                ...a, estado: 'pendiente', fechaFirma: null, notificado: true,
            }));
            (doc.asignaciones || []).forEach(a => a.personaId && firmantes.add(a.personaId));

            try {
                await docClient.send(new UpdateCommand({
                    TableName: TABLE_NAME,
                    Key: { documentId: doc.documentId },
                    UpdateExpression: 'SET #version = :v'
                        + ', s3Key = :k, archivoUrl = :k, archivoNombre = :n, firmas = :vacio,'
                        + ' asignaciones = :asig, documentoFirmadoS3Key = :nulo,'
                        + ' ultimoMotivoVersion = :m, notasCambio = :nc,'
                        + ' ultimaPublicacionPor = :p, ultimaPublicacionNombre = :pn,'
                        + ' ultimosParticipantesRevision = :part,'
                        + ' versiones = list_append(if_not_exists(versiones, :vacio), :snap), updatedAt = :now',
                    ExpressionAttributeNames: { '#version': 'version' },
                    ExpressionAttributeValues: {
                        ':v': versionPrevia + 1,
                        ':k': s3Key,
                        ':n': archivoNombre || doc.archivoNombre || null,
                        ':vacio': [],
                        ':asig': asignacionesReset,
                        ':nulo': null,
                        ':m': String(motivo).trim(),
                        ':nc': notasCambio || null,
                        ':p': publicadaPor || null,
                        ':pn': publicadaPorNombre || null,
                        ':part': participantesRevision || null,
                        ':snap': [snapshot],
                        ':now': now,
                    },
                }));
                actualizados += 1;
            } catch (e) {
                console.error(`No se pudo versionar la copia ${doc.documentId}:`, e.message);
            }
        }

        // UNA notificación por la publicación, no una por copia: el hecho que se
        // comunica es que cambió el Reglamento, no que cambiaron N archivos.
        try {
            await eventBus.emit('document.version.updated', {
                documentId: copias[0].documentId,
                tenantId,
                obraId: null,
                documentName: DOCUMENT_TYPES[tipo] || tipo,
                version: (copias[0].version || 1) + 1,
                motivo: String(motivo).trim(),
                publicadaPor: publicadaPor || null,
                publicadaPorNombre: publicadaPorNombre || null,
                firmanteIds: [...firmantes],
            });
        } catch (eventErr) {
            console.error('Error emitting document.version.updated (corporativo):', eventErr);
        }

        return success({
            message: `Nueva versión publicada en ${actualizados} copia(s). El personal debe re-firmar.`,
            tipo,
            copiasActualizadas: actualizados,
            firmantesConvocados: firmantes.size,
        });
    } catch (err) {
        console.error('Error publicando versión corporativa:', err);
        return error('Error al publicar la nueva versión', 500);
    }
};

module.exports.nuevaVersion = async (event) => {
    try {
        const { id } = event.pathParameters || {};
        if (!id) return error('ID de documento requerido');

        const body = JSON.parse(event.body || '{}');
        const { s3Key, motivo, notasCambio, publicadaPor, versionEsperada, participantesRevision } = body;

        if (!s3Key) return error('s3Key (archivo de la nueva versión) es requerido');
        if (!motivo || !String(motivo).trim()) return error('El motivo del cambio es requerido');

        const cur = await docClient.send(new GetCommand({ TableName: TABLE_NAME, Key: { documentId: id } }));
        const doc = cur.Item;
        if (!doc) return error('Documento no encontrado', 404);
        if (!esProcedimiento(doc.tipo)) {
            return error('El versionado con notificación solo aplica a procedimientos', 400);
        }

        const tenantId = doc.tenantId;

        // Enforcement por permiso + aislamiento de tenant cuando se identifica al actor.
        if (publicadaPor) {
            const personaService = new PersonaService();
            const actor = await personaService.getById(publicadaPor).catch(() => null);
            if (!actor || actor.tenantId !== tenantId) {
                return error('No autorizado para este documento', 403);
            }
            const tenant = await new TenantService().getById(tenantId).catch(() => null);
            const tenantSafe = tenant ? tenant.toSafeFormat() : null;
            const puede = PERMISOS_SUBIR_DOC.some(p => personaPuede(actor, tenantSafe, p));
            if (!puede) return error('No tienes permiso para publicar una nueva versión', 403);
        }

        // Control de concurrencia optimista (evita pisar una versión publicada en paralelo).
        const versionActual = doc.version || 1;
        if (versionEsperada !== undefined && Number(versionEsperada) !== versionActual) {
            return error('El documento cambió mientras editabas. Recarga e inténtalo de nuevo.', 409);
        }

        const now = new Date().toISOString();
        const nuevaVer = versionActual + 1;

        // Snapshot inmutable de la versión anterior (auditoría). Las firmas reales
        // permanecen además en SignaturesTable (no se toca — restricción legal PIN).
        const snapshot = {
            version: versionActual,
            s3Key: doc.s3Key || null,
            archivoNombre: doc.archivoNombre || null,
            publicadaPor: doc.ultimaPublicacionPor || doc.createdBy || null,
            publicadaPorNombre: doc.ultimaPublicacionNombre || doc.creatorName || null,
            publicadaEn: doc.updatedAt || doc.createdAt || null,
            motivo: doc.ultimoMotivoVersion || null,
            // FUF 51 / Art. 57 inc. 5: participantes de la revisión (comité paritario,
            // delegado, depto. prevención, sindicato) que dieron origen a esta versión.
            participantes: doc.ultimosParticipantesRevision || null,
            firmasArchivadas: doc.firmas || [],
            asignacionesArchivadas: doc.asignaciones || [],
        };
        const versiones = Array.isArray(doc.versiones) ? [...doc.versiones, snapshot] : [snapshot];

        // Re-firma: se conservan las mismas personas asignadas, en estado 'pendiente'.
        const asignacionesReset = (doc.asignaciones || []).map(a => ({
            ...a, estado: 'pendiente', fechaFirma: null, notificado: true,
        }));
        const firmantesPrevios = [...new Set((doc.asignaciones || []).map(a => a.personaId).filter(Boolean))];

        await docClient.send(new UpdateCommand({
            TableName: TABLE_NAME,
            Key: { documentId: id },
            UpdateExpression: 'SET version = :v, versiones = :vs, s3Key = :s3, archivoUrl = :s3, archivoNombre = :an, '
                + 'firmas = :empty, asignaciones = :asig, documentoFirmadoS3Key = :nulo, documentoFirmadoFirmaCount = :cero, '
                + '#um = :motivo, notasCambio = :notas, ultimaPublicacionPor = :pby, ultimaPublicacionNombre = :pbn, ultimosParticipantesRevision = :part, updatedAt = :now',
            ExpressionAttributeNames: { '#um': 'ultimoMotivoVersion' },
            ExpressionAttributeValues: {
                ':v': nuevaVer,
                ':vs': versiones,
                ':s3': s3Key,
                ':an': body.archivoNombre || doc.archivoNombre || null,
                ':empty': [],
                ':asig': asignacionesReset,
                ':nulo': null,
                ':cero': 0,
                ':motivo': motivo,
                ':notas': notasCambio || null,
                ':pby': publicadaPor || null,
                ':pbn': body.publicadaPorNombre || null,
                ':part': participantesRevision || null,
                ':now': now,
            },
        }));

        // Notificación desacoplada (best-effort: no rompe la publicación).
        try {
            await eventBus.emit('document.version.updated', {
                documentId: id,
                tenantId,
                obraId: doc.obraId || null,
                documentName: doc.titulo,
                tipo: doc.tipo,
                version: nuevaVer,
                motivo,
                notasCambio: notasCambio || null,
                publicadaPor: publicadaPor || 'system',
                publicadaPorNombre: body.publicadaPorNombre || 'Gestor SST',
                firmanteIds: firmantesPrevios,
            });
        } catch (eventErr) {
            console.error('Error emitting document.version.updated event:', eventErr);
        }

        const updated = await docClient.send(new GetCommand({ TableName: TABLE_NAME, Key: { documentId: id } }));
        return success(updated.Item);
    } catch (err) {
        console.error('Error creating document version:', err);
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
                obraId: documentData.obraId || null,
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

        const firmaEmbebida = FirmaService.toDocumentFirmaFormat(firmaResult);
        const parts = buildFirmaUpdateParts({
            documentData,
            nuevasFirmas: [firmaEmbebida],
            asignacionUpdates: esFirmaRelator ? [] : [{ personaId: signerPersonaId }]
        });

        if (esFirmaRelator) {
            // La firma del relator no toca asignaciones: registra firmaRelator.
            parts.setClauses.push('firmaRelator = :firmaRelator');
            parts.values[':firmaRelator'] = {
                personaId: persona.personaId,
                nombre: `${persona.nombre} ${persona.apellido || ''}`.trim(),
                timestamp: parts.now,
                estado: 'firmado'
            };
            if (body.modalidad) {
                parts.setClauses.push('modalidad = :modalidad');
                parts.values[':modalidad'] = String(body.modalidad);
            }
        }

        await docClient.send(new UpdateCommand({
            TableName: TABLE_NAME,
            Key: { documentId: id },
            UpdateExpression: 'SET ' + parts.setClauses.join(', '),
            ExpressionAttributeNames: parts.names,
            ExpressionAttributeValues: parts.values
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

        const { firmanteId, asistidoPor } = body;
        if (!firmanteId) return error('firmanteId (trabajador) es requerido');
        if (!asistidoPor) return error('asistidoPor (quien asiste la firma) es requerido');

        // Solo firma con PIN del trabajador: sin PIN no hay evidencia real, así que
        // la modalidad presencial queda descartada en la firma asistida.
        const metodo = 'PIN';
        if (!body.pin) return error('El trabajador debe ingresar su PIN para firmar', 400);

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
        const credencial = body.pin;

        let firmaResult;
        try {
            firmaResult = await FirmaService.crear({
                personaId: firmanteId,
                tenantId: firmante.tenantId,
                obraId: documentData.obraId || null,
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
        const parts = buildFirmaUpdateParts({
            documentData,
            nuevasFirmas: [firmaEmbebida],
            asignacionUpdates: [{ personaId: firmanteId, asistidoPor }]
        });

        await docClient.send(new UpdateCommand({
            TableName: TABLE_NAME,
            Key: { documentId: id },
            UpdateExpression: 'SET ' + parts.setClauses.join(', '),
            ExpressionAttributeNames: parts.names,
            ExpressionAttributeValues: parts.values
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
            obraId: documentData.obraId || null,
            metodo,
            credencial: pin || {},
            tipoFirma: tipoFirma || 'trabajador',
            referenciaId: id,
            referenciaTipo: 'document',
            contexto
        });

        const nuevasFirmas = resultado.exitosas.map(f => FirmaService.toDocumentFirmaFormat(f));

        if (nuevasFirmas.length > 0) {
            const parts = buildFirmaUpdateParts({
                documentData,
                nuevasFirmas,
                // Solo se marca "firmado" a quienes realmente firmaron con éxito
                // (antes se marcaba a todo personaIds, incluyendo fallidas).
                asignacionUpdates: resultado.exitosas.map(f => ({ personaId: f.personaId }))
            });

            await docClient.send(new UpdateCommand({
                TableName: TABLE_NAME,
                Key: { documentId: id },
                UpdateExpression: 'SET ' + parts.setClauses.join(', '),
                ExpressionAttributeNames: parts.names,
                ExpressionAttributeValues: parts.values
            }));
        }

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

/**
 * Deriva la key S3 del PDF estampado a partir de la key del PDF original.
 * Siempre la misma key por documento (se sobreescribe en cada regeneración):
 * la prueba legal vive en las firmas (inmutables en Signatures/firmas), el
 * PDF estampado es solo su renderización más reciente.
 */
function keyDocumentoFirmado(s3Key) {
    return s3Key.replace(/\.[^/.]+$/, '') + '.firmado.pdf';
}

/**
 * GET /documents/{id}/download-firmado - Descarga el PDF con el anexo de
 * firmas estampado.
 *
 * El estampado se genera "bajo demanda" (lazy), no en cada firma: si la
 * versión cacheada ya refleja todas las firmas actuales, se devuelve de
 * inmediato (200). Si no (falta generarla o hay firmas nuevas desde la
 * última vez), se encola su regeneración en una cola SQS FIFO agrupada por
 * documentId -- así, si varias personas piden la descarga a la vez (o el
 * documento se completa justo cuando llegan las últimas firmas), los jobs
 * se serializan solos sin locks manuales -- y se responde 202 para que el
 * cliente reintente en unos segundos.
 */
module.exports.downloadFirmado = async (event) => {
    try {
        const { id } = event.pathParameters || {};
        if (!id) return error('ID de documento requerido');

        const docResult = await docClient.send(new GetCommand({
            TableName: TABLE_NAME,
            Key: { documentId: id }
        }));
        if (!docResult.Item) return error('Documento no encontrado', 404);
        const documentData = docResult.Item;

        // El archivo puede haber quedado guardado en s3Key o en archivoUrl
        // según el flujo de creación (ver documents.create / documents.list).
        const fileKey = documentData.s3Key || documentData.archivoUrl;
        if (!fileKey) return error('El documento no tiene archivo asociado', 400);

        const firmasCount = (documentData.firmas || []).length;

        // Sin firmas todavía: no hay nada que estampar, se sirve el original.
        if (firmasCount === 0) {
            const url = await getSignedUrl(s3Client, new GetObjectCommand({
                Bucket: DOCUMENTS_BUCKET,
                Key: fileKey
            }), { expiresIn: 300 });
            return success({ estado: 'listo', url, firmasCount });
        }

        const estampadoAlDia = documentData.documentoFirmadoS3Key
            && (documentData.documentoFirmadoFirmaCount || 0) === firmasCount;

        if (estampadoAlDia) {
            const url = await getSignedUrl(s3Client, new GetObjectCommand({
                Bucket: DOCUMENTS_BUCKET,
                Key: documentData.documentoFirmadoS3Key
            }), { expiresIn: 300 });
            return success({ estado: 'listo', url, firmasCount });
        }

        // Cache miss: encolar regeneración. MessageDeduplicationId incluye el
        // conteo de firmas para no encolar trabajo duplicado si varias
        // personas piden la descarga con el mismo estado de firmas.
        await sqsClient.send(new SendMessageCommand({
            QueueUrl: DOCUMENT_STAMP_QUEUE_URL,
            MessageBody: JSON.stringify({ documentId: id }),
            MessageGroupId: id,
            MessageDeduplicationId: `${id}-${firmasCount}`
        }));

        return success({ estado: 'generando', firmasCount }, 202);
    } catch (err) {
        console.error('Error downloading signed document:', err);
        return error(err.message, 500);
    }
};

/**
 * Worker SQS: regenera el PDF estampado de un documento.
 *
 * Nunca confía en el estado capturado al encolar el mensaje: vuelve a leer
 * el documento en este momento y estampa el set de firmas más reciente,
 * siempre desde el PDF ORIGINAL (nunca desde una versión ya estampada, para
 * no ir arrastrando anexos duplicados).
 */
module.exports.stamp = async (event) => {
    for (const record of event.Records || []) {
        let documentId;
        try {
            ({ documentId } = JSON.parse(record.body));

            const docResult = await docClient.send(new GetCommand({
                TableName: TABLE_NAME,
                Key: { documentId }
            }));
            if (!docResult.Item) {
                console.error(`stamp: documento ${documentId} no encontrado, se descarta el job`);
                continue;
            }
            const documentData = docResult.Item;
            const firmas = documentData.firmas || [];
            const fileKey = documentData.s3Key || documentData.archivoUrl;

            // Si mientras el job esperaba en la cola ya se generó una versión
            // igual o más reciente (job anterior del mismo grupo), no repetir.
            if ((documentData.documentoFirmadoFirmaCount || 0) >= firmas.length) {
                continue;
            }
            if (!fileKey) {
                console.error(`stamp: documento ${documentId} no tiene archivo asociado, se descarta el job`);
                continue;
            }

            const original = await PdfStampingService.descargarOriginal(DOCUMENTS_BUCKET, fileKey);
            const estampado = await PdfStampingService.estamparAnexo(original, firmas, { titulo: documentData.titulo });

            const estampadoKey = keyDocumentoFirmado(fileKey);
            await PdfStampingService.subirEstampado(DOCUMENTS_BUCKET, estampadoKey, estampado);

            await docClient.send(new UpdateCommand({
                TableName: TABLE_NAME,
                Key: { documentId },
                UpdateExpression: 'SET documentoFirmadoS3Key = :key, documentoFirmadoFirmaCount = :count, documentoFirmadoAt = :now',
                ExpressionAttributeValues: {
                    ':key': estampadoKey,
                    ':count': firmas.length,
                    ':now': new Date().toISOString()
                }
            }));
        } catch (err) {
            console.error(`Error estampando documento ${documentId}:`, err);
            // Se relanza para que SQS reintente (y, tras agotar los reintentos,
            // el mensaje caiga al DLQ en vez de perderse silenciosamente).
            throw err;
        }
    }
};


/**
 * POST /documents/{id}/difusion — registra un envío DECLARADO del documento a un
 * destinatario tipificado (Art. 57 inc. 2 y equivalentes).
 *
 * Se suma al mismo array `difusiones[]` que escribe EventBus al publicar una
 * versión: una sola constancia de "a quién se informó y cuándo", con dos orígenes.
 * No se crea una entidad paralela.
 *
 * El sistema NO verifica que el envío haya ocurrido ni que la evidencia lo
 * demuestre: registra lo declarado, con su fecha, su medio y su respaldo.
 */
module.exports.registrarDifusion = async (event) => {
    try {
        const { id } = event.pathParameters || {};
        if (!id) return error('ID de documento requerido');

        const body = JSON.parse(event.body || '{}');
        const { destinatarioTipo, medio, fecha, evidenciaDocumentoId, observacion, registradoPor } = body;

        if (!DESTINATARIOS_VALIDOS.has(destinatarioTipo)) {
            return error(`destinatarioTipo inválido. Válidos: ${[...DESTINATARIOS_VALIDOS].join(', ')}`);
        }
        if (!MEDIOS_VALIDOS.has(medio)) {
            return error(`medio inválido. Válidos: ${[...MEDIOS_VALIDOS].join(', ')}`);
        }

        // Anti contradicción 5: ninguna fecha de envío puede ser futura.
        const fechaEnvio = fecha ? new Date(fecha) : new Date();
        if (Number.isNaN(fechaEnvio.getTime())) return error('La fecha de envío no es válida');
        if (fechaEnvio.getTime() > Date.now()) return error('La fecha de envío no puede ser futura');

        const doc = await docClient.send(new GetCommand({ TableName: TABLE_NAME, Key: { documentId: id } }));
        if (!doc.Item) return error('Documento no encontrado', 404);

        const constancia = {
            origen: 'manual',
            fecha: fechaEnvio.toISOString(),
            version: doc.Item.version || null,
            destinatarioTipo,
            medio,
            evidenciaDocumentoId: evidenciaDocumentoId || null,
            observacion: observacion || null,
            registradoPor: registradoPor || null,
            registradoEn: new Date().toISOString(),
        };

        const res = await docClient.send(new UpdateCommand({
            TableName: TABLE_NAME,
            Key: { documentId: id },
            UpdateExpression: 'SET difusiones = list_append(if_not_exists(difusiones, :vacio), :d), updatedAt = :now',
            ExpressionAttributeValues: { ':d': [constancia], ':vacio': [], ':now': constancia.registradoEn },
            ReturnValues: 'ALL_NEW',
        }));

        return success({ message: 'Constancia de envío registrada', documento: res.Attributes });
    } catch (err) {
        console.error('Error registrando difusión:', err);
        return error(err.message, 500);
    }
};
