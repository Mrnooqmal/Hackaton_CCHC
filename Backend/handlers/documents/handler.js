const { v4: uuidv4 } = require('uuid');
const { PutCommand, GetCommand, QueryCommand, ScanCommand, UpdateCommand, DeleteCommand } = require('@aws-sdk/lib-dynamodb');
const { GetObjectCommand, HeadObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { docClient } = require('../../lib/clients/dynamodb');
const { s3Client } = require('../../lib/clients/s3');
const { success, error, created } = require('../../lib/utils/response');
const { validateRequired, generateSignatureToken } = require('../../lib/utils/validation');
const { FirmaService } = require('../../lib/services/FirmaService');
const { PersonaService } = require('../../lib/services/PersonaService');
const { TenantService } = require('../../lib/services/TenantService');
const { PdfStampingService } = require('../../lib/services/PdfStampingService');
const { PERMISSIONS } = require('../../lib/permissions');
const { conSesion, sesionPuede } = require('../../lib/auth/sesion');
const { TIPOS_SALUD, filtrarSalud } = require('../../lib/documentos-salud');
const { DESTINATARIO, MEDIO } = require('../../lib/distribucion');
const almacenamiento = require('../../lib/almacenamiento');
const {
    llaveDe: llaveDeArreglos,
    construirAsignacion,
    descifrarDocumento,
    descifrarDocumentosDeTenant,
    descifrarDocumentoDeTenant,
} = require('../../lib/arregloSensible');

/** Una firma recién escrita, lista para el cliente: lo que se guarda lleva el
 *  RUT y la IP en sobre, y lo que se devuelve los lleva en claro. */
const firmaParaCliente = async (firma, tenantId) =>
    (await descifrarDocumentoDeTenant({ firmas: [firma] }, tenantId)).firmas[0];

const DESTINATARIOS_VALIDOS = new Set(Object.values(DESTINATARIO));
const MEDIOS_VALIDOS = new Set(Object.values(MEDIO));
const { eventBus } = require('../../lib/events/EventBus');
const { FirmaRepresentanteService, requiereFirmaRepresentante, ROL_REPRESENTANTE } = require('../../lib/services/FirmaRepresentanteService');

/**
 * Si el documento lo firma el representante legal (el Programa de Trabajo
 * Preventivo), se le asigna en cuanto el documento tiene archivo. Sin esto, un
 * programa subido quedaba "Incompleto" sin que nadie le pidiera la firma.
 * Un fallo acá no tumba la carga: el documento ya quedó guardado, y designar de
 * nuevo al representante vuelve a sincronizar.
 */
const asignarRepresentanteSiCorresponde = async (doc) => {
    if (!doc || !requiereFirmaRepresentante(doc.tipo)) return;
    try {
        const tenant = await new TenantService().getById(doc.tenantId);
        await new FirmaRepresentanteService().alCrearDocumento(doc, tenant?.reglas?.representanteLegal || null);
    } catch (err) {
        console.error('[documents] no se pudo asignar la firma del representante legal:', err.message);
    }
};

const TABLE_NAME = process.env.DOCUMENTS_TABLE || 'Documents';

// Vigencia de las URL prefirmadas: son credenciales al portador y quien las pide
// las usa de inmediato.
const URL_VIGENCIA_SEGUNDOS = 900;

// Construye las piezas de la UpdateCommand atómica de firmas — ver
// FirmaService.buildFirmaUpdateParts (compartida con handlers/signatures).
const buildFirmaUpdateParts = FirmaService.buildFirmaUpdateParts;

// Permisos que habilitan subir/crear documentos (repositorio o documentos de fase).
const PERMISOS_SUBIR_DOC = [
    PERMISSIONS.REPOSITORIO_SUBIR,
    PERMISSIONS.OBRA_SUBIR_DOCUMENTOS,
];

/** ¿La sesión puede subir o modificar documentos? */
const puedeSubir = (sesion) => PERMISOS_SUBIR_DOC.some((p) => sesionPuede(sesion, p));

/**
 * Documento de la empresa de la sesión, o null.
 *
 * `DocumentsTable` está indexada por `documentId` a secas: leer o escribir con el
 * id bastaba, sin importar de qué empresa fuera el documento. Quien use esto
 * responde 404 — que el id exista en otra empresa no se informa.
 */
const documentoDelTenant = async (documentId, sesion) => {
    if (!documentId) return null;
    const res = await docClient.send(new GetCommand({
        TableName: TABLE_NAME,
        Key: { documentId },
    }));
    const doc = res.Item;
    return doc && doc.tenantId === sesion.tenantId ? doc : null;
};

/**
 * ¿Puede esta sesión ver este documento?
 *
 * Los de salud (Arts. 67 y 68) solo para quien tiene el permiso o para la persona
 * a la que se refieren — el mismo criterio que `filtrarSalud` aplica al listado.
 */
const puedeVerDocumento = (doc, sesion) => {
    if (!TIPOS_SALUD.has(doc.tipo)) return true;
    if (sesionPuede(sesion, PERMISSIONS.PERSONA_VIGILANCIA_SALUD)) return true;
    return (doc.asignaciones || []).some((a) => a.personaId === sesion.personaId);
};

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
    // FUF 37 / Art. 46 inc. 3. Es la CONSTANCIA de la entrega, no la
    // documentación entregada: el sistema no abre los archivos ni verifica qué
    // contienen. Se pueden registrar varias entregas, una por documento.
    // FUF 16 / Art. 13 inc. 2. Lo emite el fabricante o el ISP, no la empresa: se
    // custodia y se muestra, no se valida su contenido.
    // FUF 18 y 19 / Art. 13 incs. 3 y 4. Un solo documento para dos obligaciones:
    // que la capacitación se haya hecho, y que conste quiénes asistieron.
    CAPACITACION_EPP: 'Capacitacion en uso y mantencion de EPP (Art. 13)',
    CERTIFICACION_EPP: 'Certificacion de calidad o registro ISP de los EPP (Art. 13)',
    // FUF 49 / Arts. 56 a 61. El comprobante del sitio de la Direccion del Trabajo.
    // Distinto de COMPROBANTE_REGISTRO_DT, que es el registro del comite (Art. 36).
    INGRESO_RIOHS_DT: 'Comprobante de ingreso del Reglamento Interno en la Direccion del Trabajo',
    ENTREGA_DOCUMENTACION_CPHS: 'Constancia de entrega de documentacion preventiva al comite (Art. 46)',
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
        const ses = conSesion(event);
        if (!ses.ok) return ses.respuesta;
        const sesion = ses.sesion;

        const body = JSON.parse(event.body || '{}');
        // La empresa dueña del documento sale de la sesión: con `tenantId` en el
        // cuerpo se podían sembrar documentos en la empresa de otro.
        const tenantId = sesion.tenantId;

        const validation = validateRequired(body, ['tipo', 'titulo']);
        if (!validation.valid) {
            return error(`Campos requeridos faltantes: ${validation.missing.join(', ')}`);
        }

        if (!DOCUMENT_TYPES[body.tipo]) {
            return error(`Tipo de documento inválido. Tipos válidos: ${Object.keys(DOCUMENT_TYPES).join(', ')}`);
        }

        // El permiso se exige SIEMPRE: antes bastaba con no mandar `createdBy`.
        if (!puedeSubir(sesion)) {
            return error('No tienes permiso para subir documentos', 403);
        }
        const creador = await new PersonaService().getById(sesion.personaId).catch(() => null);

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
            // Quién lo subió es un hecho de auditoría: sale de la sesión.
            createdBy: sesion.personaId,
            creatorName: creador ? `${creador.nombre} ${creador.apellido || ''}`.trim() : (body.creatorName || null),
            firmas: [],
            asignaciones: [],
            estado: 'activo',
            version: 1,
            createdAt: now,
            updatedAt: now,
        };

        await docClient.send(new PutCommand({ TableName: TABLE_NAME, Item: document }));
        await asignarRepresentanteSiCorresponde(document);

        // Notificar asignados (usa personaId, no workerId)
        try {
            if (body.assignedTo && Array.isArray(body.assignedTo) && body.assignedTo.length > 0) {
                await eventBus.emit('document.assigned', {
                    documentId: document.documentId,
                    userIds: body.assignedTo,
                    assignedBy: sesion.personaId,
                    creatorName: document.creatorName || 'Gestor SST',
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
        const ses = conSesion(event);
        if (!ses.ok) return ses.respuesta;
        const sesion = ses.sesion;

        const {
            tipo, estado, clasificacion, obraId, pendienteDe, asignadoA,
        } = event.queryStringParameters || {};
        // Empresa y solicitante salen de la sesión: `?tenantId=` listaba los
        // documentos de cualquier empresa, y `?solicitanteId=` permitía pasar por
        // quien sí puede ver los documentos de salud.
        const tenantId = sesion.tenantId;
        const solicitanteId = sesion.personaId;

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

        // Resguardo de datos sensibles (Arts. 67 y 68). Se resuelve al final, sobre
        // el conjunto ya filtrado, para no pagar la consulta de persona cuando el
        // resultado no trae ningún documento de salud.
        if (documents.some((d) => TIPOS_SALUD.has(d.tipo))) {
            const [persona, tenant] = await Promise.all([
                new PersonaService().getById(solicitanteId).catch(() => null),
                new TenantService().getById(tenantId).catch(() => null),
            ]);
            const tenantSafe = tenant ? tenant.toSafeFormat() : null;
            documents = filtrarSalud(documents, persona, tenantSafe);
        }

        return success({
            documents: await descifrarDocumentosDeTenant(documents, tenantId),
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
        const ses = conSesion(event);
        if (!ses.ok) return ses.respuesta;
        const sesion = ses.sesion;

        const { id } = event.pathParameters || {};

        if (!id) {
            return error('ID de documento requerido');
        }

        // Pertenencia y salud: mismo 404 en los dos casos, para no delatar por la
        // diferencia de respuestas que el documento existe.
        const doc = await documentoDelTenant(id, sesion);
        if (!doc || !puedeVerDocumento(doc, sesion)) {
            return error('Documento no encontrado', 404);
        }

        return success(await descifrarDocumentoDeTenant(doc, sesion.tenantId));
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
        const ses = conSesion(event);
        if (!ses.ok) return ses.respuesta;
        const sesion = ses.sesion;

        const { id } = event.pathParameters || {};
        if (!id) return error('ID de documento requerido');

        const doc = await documentoDelTenant(id, sesion);
        if (!doc) return error('Documento no encontrado', 404);

        if (Array.isArray(doc.firmas) && doc.firmas.length > 0) {
            return error('Este documento ya tiene firmas y no se puede eliminar. Sube una versión nueva si necesitas corregirlo.', 409);
        }

        // El permiso se exige SIEMPRE: antes se saltaba omitiendo `?actorId=`.
        if (!puedeSubir(sesion)) {
            return error('No tienes permiso para eliminar documentos', 403);
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
        const ses = conSesion(event);
        if (!ses.ok) return ses.respuesta;
        const sesion = ses.sesion;

        const { id } = event.pathParameters || {};
        if (!id) return error('ID de documento requerido');

        const actual = await documentoDelTenant(id, sesion);
        if (!actual) return error('Documento no encontrado', 404);
        // Adjuntar el archivo de un ítem de onboarding es parte de la gestión de la
        // ficha, por eso ese permiso vale además de los de subida.
        if (!puedeSubir(sesion) && !sesionPuede(sesion, PERMISSIONS.PERSONA_ONBOARDING)) {
            return error('No tienes permiso para modificar documentos', 403);
        }

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
            const doc = actual;

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

                // Antes acá había que anular a mano el PDF estampado, porque
                // correspondía al archivo viejo. Ya no: su clave se deriva del
                // archivo y de las firmas (ver `claveEstampado`), así que al
                // cambiar el archivo la clave cambia sola.

                // Quién publicó: de la sesión, no del cuerpo.
                updateExpressions.push('#pubPor = :pubPor', '#pubNombre = :pubNombre');
                expressionNames['#pubPor'] = 'ultimaPublicacionPor';
                expressionNames['#pubNombre'] = 'ultimaPublicacionNombre';
                expressionValues[':pubPor'] = sesion.personaId;
                expressionValues[':pubNombre'] = body.publicadaPorNombre || null;
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
        // El programa precreado de una obra recibe su archivo por acá.
        await asignarRepresentanteSiCorresponde(result.Attributes);

        return success(await descifrarDocumentoDeTenant(result.Attributes, sesion.tenantId));
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
        const ses = conSesion(event);
        if (!ses.ok) return ses.respuesta;
        const sesion = ses.sesion;

        const body = JSON.parse(event.body || '{}');
        const { tipo, s3Key, archivoNombre, motivo, notasCambio, publicadaPorNombre, participantesRevision } = body;

        // Empresa y publicante salen de la sesión: esto reescribe TODAS las copias
        // del Reglamento de una empresa y obliga a re-firmar a su personal.
        const tenantId = sesion.tenantId;
        const publicadaPor = sesion.personaId;
        if (!puedeSubir(sesion)) {
            return error('No tienes permiso para publicar una nueva versión', 403);
        }
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
                        + ' asignaciones = :asig,'
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
        const ses = conSesion(event);
        if (!ses.ok) return ses.respuesta;
        const sesion = ses.sesion;

        const { id } = event.pathParameters || {};
        if (!id) return error('ID de documento requerido');

        const body = JSON.parse(event.body || '{}');
        const { s3Key, motivo, notasCambio, versionEsperada, participantesRevision } = body;
        // Quién publica sale de la sesión (el cuerpo podía nombrar a cualquiera).
        const publicadaPor = sesion.personaId;

        if (!s3Key) return error('s3Key (archivo de la nueva versión) es requerido');
        if (!motivo || !String(motivo).trim()) return error('El motivo del cambio es requerido');

        const doc = await documentoDelTenant(id, sesion);
        if (!doc) return error('Documento no encontrado', 404);
        if (!esProcedimiento(doc.tipo)) {
            return error('El versionado con notificación solo aplica a procedimientos', 400);
        }

        const tenantId = doc.tenantId;

        // El permiso se exige SIEMPRE: antes se saltaba omitiendo `publicadaPor`.
        if (!puedeSubir(sesion)) {
            return error('No tienes permiso para publicar una nueva versión', 403);
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
                + 'firmas = :empty, asignaciones = :asig, '
                + '#um = :motivo, notasCambio = :notas, ultimaPublicacionPor = :pby, ultimaPublicacionNombre = :pbn, ultimosParticipantesRevision = :part, updatedAt = :now',
            ExpressionAttributeNames: { '#um': 'ultimoMotivoVersion' },
            ExpressionAttributeValues: {
                ':v': nuevaVer,
                ':vs': versiones,
                ':s3': s3Key,
                ':an': body.archivoNombre || doc.archivoNombre || null,
                ':empty': [],
                ':asig': asignacionesReset,
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
        const ses = conSesion(event);
        if (!ses.ok) return ses.respuesta;
        const sesion = ses.sesion;

        const { id } = event.pathParameters || {};
        const body = JSON.parse(event.body || '{}');

        if (!id) return error('ID de documento requerido');

        const personaIds = body.personaIds;
        const { fechaLimite, notificar, assignerName, replace } = body;
        // Quién asigna sale de la sesión.
        const assignedBy = sesion.personaId;

        if (!personaIds || !Array.isArray(personaIds) || personaIds.length === 0) {
            return error('Se requiere un array de IDs de personas');
        }

        const doc = await documentoDelTenant(id, sesion);
        if (!doc) return error('Documento no encontrado', 404);
        if (!puedeSubir(sesion) && !sesionPuede(sesion, PERMISSIONS.OBRA_ASIGNAR_TRABAJADORES)) {
            return error('No tienes permiso para asignar documentos', 403);
        }
        const docResult = { Item: doc };

        // Lookup personas via PersonaService (solo del tenant del documento)
        const personaService = new PersonaService();
        const now = new Date().toISOString();
        const nuevasAsignaciones = [];
        const documentTenantId = docResult.Item.tenantId || null;

        const llaveArreglos = await llaveDeArreglos(documentTenantId || sesion.tenantId);
        // Si el documento lo firma el representante legal y se le asigna a él, la
        // asignación lleva la misma marca que pone la sincronización: así, al
        // cambiar de representante, se le quita la pendiente al anterior.
        const repLegalId = requiereFirmaRepresentante(docResult.Item.tipo)
            ? ((await new TenantService().getById(documentTenantId || sesion.tenantId).catch(() => null))?.reglas?.representanteLegal?.personaId || null)
            : null;
        // Asignar dos veces a quien ya tiene la firma pendiente duplicaba la fila
        // (y el "Recordar" del ítem 9 lo hacía en cada clic). Se le vuelve a
        // avisar, pero no se agrega otra asignación.
        // Con `replace` la lista se rehace entera: ahí nadie se salta.
        const yaPendientes = new Set(replace ? [] : (docResult.Item.asignaciones || [])
            .filter((a) => a.estado === 'pendiente').map((a) => a.personaId));
        const soloAvisar = [];
        for (const pid of personaIds) {
            if (yaPendientes.has(pid)) { soloAvisar.push(pid); continue; }
            const persona = await personaService.getById(pid);
            if (documentTenantId && persona?.tenantId && persona.tenantId !== documentTenantId) {
                console.warn(`[Documents] Persona ${pid} pertenece a otro tenant (${persona.tenantId} != ${documentTenantId}), omitida de la asignación`);
                continue;
            }
            const asignacion = construirAsignacion(persona, {
                fechaLimite: fechaLimite || null,
                notificado: notificar || false,
                nombreFallback: pid,
            }, llaveArreglos);
            nuevasAsignaciones.push(repLegalId && pid === repLegalId ? { ...asignacion, rol: ROL_REPRESENTANTE } : asignacion);
        }

        if (nuevasAsignaciones.length === 0 && soloAvisar.length === 0) {
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

        // Notificar asignados, y volver a avisar a quien ya la tenía pendiente.
        const assignedIds = [...nuevasAsignaciones.map(a => a.personaId), ...soloAvisar];
        try {
            await eventBus.emit('document.assigned', {
                documentId: id,
                userIds: assignedIds,
                assignedBy,
                creatorName: assignerName || docResult.Item.creatorName || 'Gestor SST',
                documentName: docResult.Item.titulo,
                dueDate: fechaLimite || null
            });
        } catch (eventError) {
            console.error('Error emitting document.assigned event:', eventError);
        }

        return success({
            message: `Documento asignado a ${nuevasAsignaciones.length} persona(s)`,
            // Lo que va al cliente es el RUT, no el sobre: esta respuesta la
            // dibuja la pantalla igual que un listado.
            asignaciones: descifrarDocumento({ asignaciones: nuevasAsignaciones }, llaveArreglos).asignaciones
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
        const ses = conSesion(event);
        if (!ses.ok) return ses.respuesta;
        const sesion = ses.sesion;

        const { id } = event.pathParameters || {};
        const body = JSON.parse(event.body || '{}');

        if (!id) return error('ID de documento requerido');

        const signerPersonaId = body.personaId;
        if (!signerPersonaId || !body.tipoFirma) {
            return error('personaId y tipoFirma son requeridos');
        }

        // Una firma sin credencial no prueba nada: el método PRESENCIAL valida
        // siempre (ver FirmaService), así que omitir el PIN permitía firmar por
        // otro. Toda firma exige el PIN de quien firma o —cuando se tomó sin red—
        // un vale de un solo uso que esa persona desbloqueó con su PIN.
        if (!body.pin && !body.vale) {
            return error('Debes ingresar tu PIN para firmar', 400);
        }

        // Quien tiene la sesión firma por sí mismo. Firmar por otro es la firma
        // asistida (el trabajador teclea SU PIN en el dispositivo de quien asiste)
        // y exige ese permiso: el PIN sigue siendo la prueba del consentimiento.
        if (signerPersonaId !== sesion.personaId
            && !sesionPuede(sesion, PERMISSIONS.OBRA_FIRMA_ASISTIDA)) {
            return error('No tienes permiso para registrar la firma de otra persona', 403);
        }

        const documentData = await documentoDelTenant(id, sesion);
        if (!documentData) return error('Documento no encontrado', 404);
        const docResult = { Item: documentData };

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

        const metodo = body.vale ? 'VALE' : 'PIN';
        const credencial = body.vale
            ? { vale: body.vale, deviceId: body.deviceId || null, timestampLocal: body.timestampLocal || null }
            : body.pin;
        let firmaResult;
        try {
            firmaResult = await FirmaService.crear({
                personaId: signerPersonaId,
                tenantId: documentData.tenantId,
                obraId: documentData.obraId || null,
                metodo,
                credencial,
                tipoFirma: body.tipoFirma,
                referenciaId: id,
                referenciaTipo: 'document',
                contexto,
                metadata: esFirmaRelator ? { rolFirma: 'relator', modalidad: body.modalidad || null } : null,
                persona
            });
        } catch (firmaErr) {
            if (firmaErr.codigo === 'PIN_BLOQUEADO') return error(firmaErr.message, 423);
            return error(firmaErr.message, 400);
        }

        const firmaEmbebida = await FirmaService.toDocumentFirmaFormat(firmaResult);
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
            firma: await firmaParaCliente(firmaEmbebida, documentData.tenantId),
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
        const ses = conSesion(event);
        if (!ses.ok) return ses.respuesta;
        const sesion = ses.sesion;

        const { id } = event.pathParameters || {};
        const body = JSON.parse(event.body || '{}');
        if (!id) return error('ID de documento requerido');

        const { firmanteId } = body;
        // Quién asiste la firma es quien tiene la sesión: con `asistidoPor` en el
        // cuerpo se podía dejar constancia a nombre de otro.
        const asistidoPor = sesion.personaId;
        if (!firmanteId) return error('firmanteId (trabajador) es requerido');

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

        // 2. Documento de la empresa de la sesión y firmante asignado a él
        const documentData = await documentoDelTenant(id, sesion);
        if (!documentData) return error('Documento no encontrado', 404);

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
            if (firmaErr.codigo === 'PIN_BLOQUEADO') return error(firmaErr.message, 423);
            return error(firmaErr.message, 400);
        }

        const firmaEmbebida = await FirmaService.toDocumentFirmaFormat(firmaResult);
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
            firma: await firmaParaCliente(firmaEmbebida, documentData.tenantId),
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
        const ses = conSesion(event);
        if (!ses.ok) return ses.respuesta;
        const sesion = ses.sesion;

        const { id } = event.pathParameters || {};
        const body = JSON.parse(event.body || '{}');

        if (!id) return error('ID de documento requerido');

        const personaIds = body.personaIds;
        const { tipoFirma, pin } = body;

        if (!personaIds || !Array.isArray(personaIds) || personaIds.length === 0) {
            return error('Se requiere un array de IDs de personas');
        }

        // Sin PIN esto firmaba por una lista entera de personas (método PRESENCIAL,
        // que valida siempre): era el camino más corto para fabricar evidencia.
        // Con PIN obligatorio solo puede prosperar la firma de quien lo conoce.
        if (!pin) {
            return error('Debes ingresar el PIN de quien firma', 400);
        }
        if (!sesionPuede(sesion, PERMISSIONS.OBRA_FIRMA_ASISTIDA)) {
            return error('No tienes permiso para registrar firmas de otras personas', 403);
        }

        const documentData = await documentoDelTenant(id, sesion);
        if (!documentData) return error('Documento no encontrado', 404);

        const contexto = {
            ipAddress: event.requestContext?.http?.sourceIp || 'unknown',
            userAgent: event.headers?.['user-agent'] || 'unknown'
        };

        const metodo = 'PIN';
        const resultado = await FirmaService.crearBatch(personaIds, {
            tenantId: documentData.tenantId,
            obraId: documentData.obraId || null,
            metodo,
            credencial: pin,
            tipoFirma: tipoFirma || 'trabajador',
            referenciaId: id,
            referenciaTipo: 'document',
            contexto
        });

        const nuevasFirmas = await Promise.all(
            resultado.exitosas.map((f) => FirmaService.toDocumentFirmaFormat(f)));

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
            firmas: (await descifrarDocumentoDeTenant({ firmas: nuevasFirmas }, documentData.tenantId)).firmas,
            errores: resultado.fallidas.length > 0 ? resultado.fallidas : undefined
        });
    } catch (err) {
        console.error('Error bulk signing document:', err);
        return error(err.message, 500);
    }
};

/**
 * GET /documents/{id}/download-firmado — PDF con el anexo de firmas.
 *
 * ── Qué cambió ───────────────────────────────────────────────────────────────
 *
 * Antes esto era un caché con cola: si el estampado no estaba al día se encolaba
 * un trabajo en SQS, se respondía 202 y el navegador sondeaba hasta quince veces.
 * Esa maquinaria resolvía una latencia que no existe —estampar un PDF de 750 KB
 * toma 244 ms, y uno de 5 MB, 1,3 s— y a cambio traía dos problemas: el estampado
 * vivía en una clave fija que había que invalidar a mano en los tres lugares que
 * reemplazan el archivo o reabren las firmas (y bastaba con que alguien agregara
 * un cuarto para servir como documento firmado un PDF de otra versión), y cada
 * regeneración dejaba una versión más del mismo objeto.
 *
 * Ahora el anexo se arma en la propia petición y el resultado se guarda bajo una
 * clave DERIVADA del estado de las firmas (ver `claveEstampado`). El caché se
 * invalida solo: si entra una firma o se publica una versión, la clave cambia. Y
 * si diez personas descargan el mismo documento a la vez, las diez resuelven la
 * misma clave y se reutiliza el archivo.
 *
 * El resultado no viaja por la API —una respuesta de Lambda no puede pasar de
 * 6 MB y acá hay documentos de 5 MB— sino que se devuelve una URL prefirmada,
 * igual que antes.
 */
module.exports.downloadFirmado = async (event) => {
    try {
        const ses = conSesion(event);
        if (!ses.ok) return ses.respuesta;
        const sesion = ses.sesion;

        const { id } = event.pathParameters || {};
        if (!id) return error('ID de documento requerido');

        const documentData = await documentoDelTenant(id, sesion);
        if (!documentData || !puedeVerDocumento(documentData, sesion)) {
            return error('Documento no encontrado', 404);
        }

        // El archivo puede haber quedado guardado en s3Key o en archivoUrl
        // según el flujo de creación (ver documents.create / documents.list).
        const fileKey = documentData.s3Key || documentData.archivoUrl;
        if (!fileKey) return error('El documento no tiene archivo asociado', 400);

        // El anexo de firmas estampa el RUT en el PDF: acá sí hace falta en
        // claro. Es el único lugar donde este dato tiene que salir del sobre.
        const firmas = (await descifrarDocumentoDeTenant(documentData, sesion.tenantId)).firmas || [];
        const bucketOriginal = almacenamiento.bucketDeClave(fileKey);

        // Sin firmas no hay nada que estampar: se sirve el original.
        if (firmas.length === 0) {
            const url = await getSignedUrl(s3Client, new GetObjectCommand({
                Bucket: bucketOriginal,
                Key: fileKey,
            }), { expiresIn: URL_VIGENCIA_SEGUNDOS });
            return success({ estado: 'listo', url, firmasCount: 0 });
        }

        const claveEstampado = almacenamiento.claveEstampado({
            tenantId: sesion.tenantId,
            documentId: id,
            s3KeyOriginal: fileKey,
            firmas,
        });
        const bucketEstampado = almacenamiento.bucketDeClave(claveEstampado);

        // ¿Ya está hecho para este mismo estado de firmas?
        let existe = true;
        try {
            await s3Client.send(new HeadObjectCommand({ Bucket: bucketEstampado, Key: claveEstampado }));
        } catch (err) {
            if (err.name !== 'NotFound' && err.$metadata?.httpStatusCode !== 404) throw err;
            existe = false;
        }

        if (!existe) {
            // Se estampa SIEMPRE desde el original, nunca desde un estampado
            // previo: de lo contrario el anexo se iría duplicando.
            const original = await PdfStampingService.descargarOriginal(bucketOriginal, fileKey);
            const estampado = await PdfStampingService.estamparAnexo(original, firmas, { titulo: documentData.titulo });
            await PdfStampingService.subirEstampado(bucketEstampado, claveEstampado, estampado);
        }

        const url = await getSignedUrl(s3Client, new GetObjectCommand({
            Bucket: bucketEstampado,
            Key: claveEstampado,
        }), { expiresIn: URL_VIGENCIA_SEGUNDOS });

        return success({ estado: 'listo', url, firmasCount: firmas.length, reutilizado: existe });
    } catch (err) {
        console.error('Error downloading signed document:', err);
        return error('No se pudo preparar el documento firmado', 500);
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
        const ses = conSesion(event);
        if (!ses.ok) return ses.respuesta;
        const sesion = ses.sesion;

        const { id } = event.pathParameters || {};
        if (!id) return error('ID de documento requerido');

        const body = JSON.parse(event.body || '{}');
        const { destinatarioTipo, medio, fecha, evidenciaDocumentoId, observacion } = body;
        // Quién declara el envío queda registrado desde la sesión: la constancia
        // vale por quién la firma.
        const registradoPor = sesion.personaId;

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

        const doc = { Item: await documentoDelTenant(id, sesion) };
        if (!doc.Item) return error('Documento no encontrado', 404);
        if (!puedeSubir(sesion)) {
            return error('No tienes permiso para registrar la difusión de un documento', 403);
        }

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
