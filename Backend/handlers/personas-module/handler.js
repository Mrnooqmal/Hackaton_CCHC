/**
 * Personas Module - Handler
 * 
 * Identidad unificada: reemplaza /users y /workers.
 * Todas las operaciones filtran por tenantId.
 */
const XLSX = require('xlsx');
const ExcelJS = require('exceljs');
const { v4: uuidv4 } = require('uuid');
const { PutCommand, QueryCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient } = require('../../lib/clients/dynamodb');
const { PersonaService } = require('../../lib/services/PersonaService');
const { ObraService } = require('../../lib/services/ObraService');
const { EppService } = require('../../lib/services/EppService');
const { TenantService } = require('../../lib/services/TenantService');
const { success, error, created, cors, headers } = require('../../lib/utils/response');
const { normalizeRol } = require('../../lib/utils/validation');
const { PERMISSIONS, personaPuede } = require('../../lib/permissions');
const { sendWelcomeEmail } = require('../notifications/handler');
const { eventBus } = require('../../lib/events/EventBus');
const { normalizeCargoCodigo, resolveCargoKitFromCatalog, resolveKitUnion, esEvidenciaReutilizable } = require('../../lib/ds44');
const { InboxRepository } = require('../inbox-module/inbox.repository');

const personaService = new PersonaService();
const obraService = new ObraService();
const eppService = new EppService();
const tenantService = new TenantService();
const inboxRepository = new InboxRepository();

// Resuelve el tenant (toSafeFormat) para evaluar permisos por persona.
const tenantSafe = async (tenantId) => {
    if (!tenantId) return null;
    const tenant = await tenantService.getById(tenantId).catch(() => null);
    return tenant ? tenant.toSafeFormat() : null;
};

const TEMPLATE_HEADERS = [
    'rut',
    'nombre',
    'apellidoPaterno',
    'apellidoMaterno',
    'fechaNacimiento',
    'email',
    'telefono',
    'rol',
    'cargo',
    'obraId',
    'nivelEscolar',
    'contactoEmergenciaNombre',
    'contactoEmergenciaTelefono',
    'contactoEmergenciaRelacion',
    'cursos'
];

// Roles y cargos de ejemplo concordantes con los que trae por defecto la pagina
// de registro de empresa (Prevencionista, Jefe de Obra, Supervisor, Colaborador)
// y la lista de cargos sugeridos. Los roles reales pueden variar segun los defina
// el administrador al registrar la empresa.
// El ROL es el perfil de permisos; el CARGO es el oficio de terreno (define el kit
// de onboarding). Un rol de gestión (Prevencionista, Jefe de Obra, Admin) NO lleva
// cargo de terreno: deja la columna cargo vacía.
const TEMPLATE_EXAMPLE_ROWS = [
    ['12.345.678-9', 'Juan', 'Perez', 'Soto', '1990-05-12', 'jperez@empresa.cl', '56912345678', 'Colaborador', 'Carpintero', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'Media completa', 'Ana Perez', '56911112222', 'Conyuge', 'Manejo de extintores; Trabajo en altura'],
    ['11.111.111-1', 'Maria', 'Lopez', 'Diaz', '1985-09-30', 'mlopez@empresa.cl', '56987654321', 'Prevencionista', 'Prevencionista', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'Universitaria', 'Pedro Lopez', '56933334444', 'Hermano', 'Uso de EPP']
];

const TEMPLATE_INSTRUCTIONS = [
    '1. Las columnas rut, nombre y rol son obligatorias.',
    '2. El rol debe coincidir con uno de los roles definidos para la empresa (ej. Prevencionista, Jefe de Obra, Supervisor, Colaborador o Administrador).',
    '3. cargo: cargo del trabajador (ej. Carpintero, Jornal de aseo y acarreo, Maestro albañil, Prevencionista).',
    '4. obraId: codigo (ej. OBRA-001) o UUID de la obra. Puedes copiarlo desde el detalle de la obra. Para asignar a varias obras, separalas por coma (ej. OBRA-001, OBRA-002). Si se deja vacio, la persona se crea en la empresa sin obra (se vincula despues); si la carga se hace desde una obra, se asigna a esa obra.',
    '5. fechaNacimiento: formato AAAA-MM-DD (ej. 1990-05-12). Opcional.',
    '6. Si el email es valido, se genera una contraseña temporal para el acceso web: los primeros 4 digitos del RUT. La persona debera cambiarla en su primer ingreso.',
    '7. cursos: separar varios por punto y coma (;). Ej: Manejo de extintores; Trabajo en altura.',
    '8. nivelEscolar y contacto de emergencia son opcionales pero recomendados para la ficha.',
    '9. Reemplaza el obraId de ejemplo con el ID real de tu obra antes de importar.',
    '10. Elimine las filas de ejemplo antes de cargar el archivo.'
];

const DOCUMENTS_TABLE = process.env.DOCUMENTS_TABLE || 'Documents';
const SIGNATURE_REQUESTS_TABLE = process.env.SIGNATURE_REQUESTS_TABLE || 'SignatureRequests';
const SIGNATURES_TABLE = process.env.SIGNATURES_TABLE || 'Signatures';

// Roles de gestión/staff que NO pasan por el onboarding de terreno del trabajador.
// (El kit reducido para posiciones de gestión se definirá en una fase posterior.)
const ROLES_GESTION = new Set(['admin', 'jefe_obra', 'supervisor', 'prevencionista', 'relator']);

const ONBOARDING_DOCUMENTS = [
    {
        tipo: 'IRL',
        titulo: 'IRL — Información de Riesgos Laborales',
        descripcion: 'Art. 15 — Documento de información y recepción por trabajador',
        requiereFirmaRelator: false
    },
    {
        // Decision reunion 2026-06-10: CAPACITACION_SST es un documento cargable
        // con firma cruzada (relator + trabajador). El sistema se abstrae de la
        // modalidad (presencial, e-learning, mutualidad, streaming); el certificado
        // o registro de asistencia es la evidencia que cierra la brecha.
        tipo: 'CAPACITACION_SST',
        titulo: 'Capacitación SST 8 horas',
        descripcion: 'Art. 16 — Registro o certificado de asistencia con firma cruzada (relator y trabajador)',
        requiereFirmaRelator: true,
        notaModalidad: 'El sistema acepta cualquier modalidad: presencial, e-learning, mutualidad o streaming'
    },
    {
        tipo: 'REGLAMENTO_INTERNO',
        titulo: 'Reglamento Interno (RIHS/RIOHS)',
        descripcion: 'Art. 56 — Entrega y recepción firmada',
        requiereFirmaRelator: false
    },
    {
        tipo: 'PROCEDIMIENTO_TRABAJO',
        titulo: 'Procedimientos de Trabajo Seguro aplicables',
        descripcion: 'Art. 10 — Recepción y firma del trabajador',
        requiereFirmaRelator: false
    }
];

const ONBOARDING_SIGNATURE_REQUESTS = [
    {
        tipo: 'ENTREGA_EPP',
        titulo: 'Entrega y capacitación de EPP',
        descripcion: 'Art. 13 — Entrega, registro y firma de recepción. Requiere validación de instancia superior.',
        requiereValidadorSuperior: true,
        rolesValidadorPermitidos: ['admin', 'jefe_obra', 'supervisor', 'prevencionista'],
        requiereCapacitacionUso: true,
        duracionCapacitacionMinutos: 60
    },
    {
        tipo: 'INDUCCION',
        titulo: 'Inducción Plan de Emergencia',
        descripcion: 'Art. 19 — Inducción y firma de asistencia'
    }
];

const REQUEST_TYPES = {
    CHARLA_5MIN: { label: 'Charla de 5 Minutos', icon: '💬', requiresDoc: false },
    CAPACITACION: { label: 'Capacitación', icon: '📚', requiresDoc: true },
    INDUCCION: { label: 'Inducción', icon: '🎓', requiresDoc: true },
    ENTREGA_EPP: { label: 'Entrega de EPP', icon: '🦺', requiresDoc: true },
    ART: { label: 'Análisis de Riesgos en Terreno', icon: '⚠️', requiresDoc: true },
    PROCEDIMIENTO: { label: 'Procedimiento de Trabajo', icon: '📋', requiresDoc: true },
    INSPECCION: { label: 'Inspección de Seguridad', icon: '🔍', requiresDoc: false },
    REGLAMENTO: { label: 'Reglamento Interno', icon: '📖', requiresDoc: true },
    DOCUMENTO: { label: 'Documento DS44', icon: '📄', requiresDoc: true },
    OTRO: { label: 'Otro', icon: '📝', requiresDoc: false }
};

const normalizeHeader = (value) =>
    String(value || '')
        .trim()
        .toLowerCase()
        .replace(/[\s._-]+/g, '');

const headerAliases = {
    rut: 'rut',
    nombre: 'nombre',
    apellidopaterno: 'apellidoPaterno',
    apellidomaterno: 'apellidoMaterno',
    apellido: 'apellido',
    fechanacimiento: 'fechaNacimiento',
    fechadenacimiento: 'fechaNacimiento',
    nacimiento: 'fechaNacimiento',
    fechanac: 'fechaNacimiento',
    email: 'email',
    correo: 'email',
    telefono: 'telefono',
    phone: 'telefono',
    rol: 'rol',
    cargo: 'cargo',
    obra: 'obra',
    codigoobra: 'obra',
    obracodigo: 'obra',
    obraid: 'obra',
    iddeobra: 'obra',
    nivelescolar: 'nivelEscolar',
    escolaridad: 'nivelEscolar',
    contactoemergencianombre: 'contactoEmergenciaNombre',
    contactoemergenciatelefono: 'contactoEmergenciaTelefono',
    contactoemergenciarelacion: 'contactoEmergenciaRelacion',
    cursos: 'cursos',
    capacitaciones: 'cursos'
};

// Resuelve apellido paterno/materno admitiendo tanto la plantilla nueva (columnas
// separadas) como una columna unica "apellido" (plantillas antiguas o externas).
const resolveApellidos = (paterno, materno, apellidoUnico) => {
    if (paterno || materno) return { apellidoPaterno: paterno, apellidoMaterno: materno };
    const parts = String(apellidoUnico || '').split(/\s+/).filter(Boolean);
    return { apellidoPaterno: parts[0] || '', apellidoMaterno: parts.slice(1).join(' ') };
};

const buildAssignment = (persona, fechaLimite = null) => {
    const now = new Date().toISOString();
    return {
        personaId: persona.personaId,
        nombre: `${persona.nombre} ${persona.apellido || ''}`.trim(),
        rut: persona.rut,
        fechaAsignacion: now,
        fechaLimite,
        estado: 'pendiente',
        notificado: true
    };
};

const createOnboardingDocument = async ({ tenantId, obraId, persona, solicitante, docConfig }) => {
    const now = new Date().toISOString();
    const documentId = uuidv4();
    const asignacion = buildAssignment(persona);

    // Evidencia persona-level reutilizada (examen altura/vigilancia vigente): el
    // ítem nace COMPLETO porque la evidencia ya es válida y vigente en la persona.
    const reuse = docConfig.evidenciaReuse || null;
    if (reuse) {
        asignacion.estado = 'firmado';
        asignacion.fechaFirma = now;
        asignacion.reutilizado = true;
    }

    const document = {
        documentId,
        tenantId,
        obraId,
        // Los documentos de empresa (RI/Política) son de nivel tenant (obraId null)
        // y se marcan 'empresa'; el resto del kit es 'diario' por obra.
        clasificacion: docConfig.clasificacion || 'diario',
        fase: 'hacer',
        tipo: docConfig.tipo,
        tipoDescripcion: docConfig.titulo,
        obligatorio: true,
        titulo: docConfig.titulo,
        contenido: '',
        descripcion: docConfig.descripcion || '',
        relatorId: null,
        // Plantilla pegada (si el kit la trae): el ítem nace con archivo →
        // queda listo para firma (pendiente_firma). Sin plantilla: pendiente_asignar.
        s3Key: docConfig.plantilla?.fileKey || null,
        archivoUrl: null,
        archivoNombre: docConfig.plantilla?.nombre || null,
        fechaCaducidad: null,
        createdBy: solicitante?.personaId || 'system',
        creatorName: solicitante ? `${solicitante.nombre} ${solicitante.apellido || ''}`.trim() : 'Sistema DS44',
        firmas: [],
        asignaciones: [asignacion],
        estado: 'activo',
        version: 1,
        // Firma cruzada (relator + trabajador). Solo aplica si el catalogo lo exige
        // (CAPACITACION_SST). El documento se considera firmado cuando la asignacion
        // del trabajador esta firmada Y firmaRelator.estado === 'firmado'.
        requiereFirmaRelator: docConfig.requiereFirmaRelator || false,
        firmaRelator: docConfig.requiereFirmaRelator ? {
            personaId: null,
            nombre: null,
            timestamp: null,
            estado: 'pendiente'
        } : null,
        notaModalidad: docConfig.notaModalidad || null,
        modalidad: null,
        // Trazabilidad del kit del cargo que generó este ítem de onboarding.
        kitItemKey: docConfig.kitItemKey || docConfig.tipo,
        accion: docConfig.accion || null,
        alcance: docConfig.alcance || null,
        bloqueante: docConfig.bloqueante || false,
        notaMinima: docConfig.notaMinima || null,
        articulo: docConfig.articulo || null,
        // Cargo(s) del kit que originaron este ítem (multi-cargo en la obra).
        cargo: (Array.isArray(docConfig.cargosOrigen) && docConfig.cargosOrigen.length)
            ? docConfig.cargosOrigen.join(', ')
            : (persona.cargo || null),
        cargosOrigen: docConfig.cargosOrigen || null,
        // Reutilización de evidencia persona-level (trazabilidad de auditoría).
        reutilizadoDe: reuse?.origenObraId || null,
        vigenciaHasta: reuse?.venceEn || null,
        createdAt: now,
        updatedAt: now
    };

    await docClient.send(new PutCommand({ TableName: DOCUMENTS_TABLE, Item: document }));

    try {
        await eventBus.emit('document.assigned', {
            documentId,
            userIds: [persona.personaId],
            assignedBy: solicitante?.personaId || 'system',
            creatorName: document.creatorName,
            documentName: docConfig.titulo,
            dueDate: null
        });
    } catch (eventError) {
        console.error('Error emitting document.assigned event (onboarding):', eventError);
    }

    return documentId;
};

const createSignatureRequest = async ({ tenantId, obraId, persona, solicitante, requestConfig }) => {
    const now = new Date().toISOString();
    const requestId = uuidv4();
    const solicitanteId = solicitante?.personaId || persona.personaId;
    const solicitanteNombre = solicitante
        ? `${solicitante.nombre} ${solicitante.apellido || ''}`.trim()
        : `${persona.nombre} ${persona.apellido || ''}`.trim();
    const solicitanteRut = solicitante?.rut || persona.rut;

    const signatureRequest = {
        requestId,
        tipo: requestConfig.tipo,
        tipoInfo: REQUEST_TYPES[requestConfig.tipo],
        titulo: requestConfig.titulo,
        descripcion: requestConfig.descripcion || '',
        referenciaId: null,
        referenciaTipo: null,
        documentId: null,
        documentos: [],
        tieneDocumentos: false,
        solicitanteId,
        solicitanteNombre,
        solicitanteRut,
        trabajadores: [
            {
                personaId: persona.personaId,
                workerId: persona.personaId,
                nombre: `${persona.nombre} ${persona.apellido || ''}`.trim(),
                rut: persona.rut,
                cargo: persona.cargo,
                firmado: false,
                signatureId: null,
                fechaFirma: null
            }
        ],
        totalRequeridos: 1,
        totalFirmados: 0,
        fechaCreacion: now,
        fechaLimite: null,
        fechaCompletado: null,
        ubicacion: null,
        obraId,
        tenantId,
        estado: 'pendiente',
        createdAt: now,
        updatedAt: now
    };

    await docClient.send(new PutCommand({ TableName: SIGNATURE_REQUESTS_TABLE, Item: signatureRequest }));

    try {
        await eventBus.emit('signature.requested', {
            requestId,
            personaIds: [persona.personaId],
            requestedBy: solicitanteId,
            documentName: signatureRequest.titulo,
            priority: 'normal'
        });
    } catch (eventError) {
        console.error('Error emitting signature.requested event (onboarding):', eventError);
    }

    return requestId;
};

// Aviso best-effort al solicitante: faltan plantillas para el cargo. No bloquea.
const avisarFaltaPlantilla = async ({ solicitante, persona, obraId, faltantes }) => {
    if (!solicitante?.personaId || faltantes.length === 0) return;
    try {
        await inboxRepository.sendMessage({
            senderId: 'system',
            senderName: 'Sistema DS44',
            senderRol: 'sistema',
            recipientIds: [solicitante.personaId],
            type: 'alerta',
            priority: 'alta',
            subject: `Faltan plantillas de onboarding (${persona.cargo})`,
            content: `Ingresó ${persona.nombre} ${persona.apellido || ''} con cargo ${persona.cargo}. Faltan plantillas para: ${faltantes.join(', ')}. Cárgalas en el catálogo de cargos (alcance empresa) o en la obra (IRL/MIPER).`,
            linkedEntity: { tipo: 'onboarding', id: obraId || null }
        });
    } catch (err) {
        console.error('Aviso de plantilla faltante falló:', err.message);
    }
};

// Documentos de onboarding (clasificacion 'diario') de una persona en una obra.
// Base para idempotencia (no duplicar al reasignar) y limpieza al desasignar.
const getOnboardingDocsForPersonaObra = async (tenantId, obraId, personaId) => {
    const result = await docClient.send(new QueryCommand({
        TableName: DOCUMENTS_TABLE,
        IndexName: 'tenantId-index',
        KeyConditionExpression: 'tenantId = :t',
        ExpressionAttributeValues: { ':t': tenantId },
    }));
    return (result.Items || []).filter((doc) =>
        doc.obraId === obraId &&
        doc.clasificacion === 'diario' &&
        (doc.asignaciones || []).some((a) => a.personaId === personaId)
    );
};

// Documentos de empresa que TODA persona (salvo admin) debe revisar/firmar,
// indistinto de rol o cargo: Reglamento Interno y Política SST. Se toman del
// catálogo del tenant (cualquier cargo los tiene en su kit transversal).
const EMPRESA_DOC_TIPOS = ['REGLAMENTO_INTERNO', 'POLITICA_SSO'];
const getCompanyWideKitItems = (tenant) => {
    const porTipo = {};
    for (const c of (tenant?.reglas?.cargos || [])) {
        for (const it of (c.kit || [])) {
            if (EMPRESA_DOC_TIPOS.includes(it.tipo) && !porTipo[it.tipo]) {
                porTipo[it.tipo] = it; // primera aparición (con plantilla si la hay)
            }
        }
    }
    return EMPRESA_DOC_TIPOS.map((t) => porTipo[t]).filter(Boolean);
};

// Reactiva un documento de onboarding archivado (al reasignar a la obra).
const setOnboardingDocEstado = async (documentId, estado) => {
    await docClient.send(new UpdateCommand({
        TableName: DOCUMENTS_TABLE,
        Key: { documentId },
        UpdateExpression: 'SET #e = :estado, updatedAt = :u',
        ExpressionAttributeNames: { '#e': 'estado' },
        ExpressionAttributeValues: { ':estado': estado, ':u': new Date().toISOString() },
    }));
};

// Marca como 'superada' las firmas válidas de unas personas para una referencia
// (al renovar un documento: la firma anterior es de una versión previa). Las firmas
// no se borran (auditoría); cambiar el estado permite volver a firmar la versión
// nueva (la verificación de idempotencia solo cuenta firmas 'valida').
const supersedeFirmasDeReferencia = async (referenciaId, personaIds) => {
    for (const pid of personaIds) {
        try {
            const res = await docClient.send(new QueryCommand({
                TableName: SIGNATURES_TABLE,
                IndexName: 'personaId-index',
                KeyConditionExpression: 'personaId = :p',
                FilterExpression: 'referenciaId = :r AND #st = :v',
                ExpressionAttributeNames: { '#st': 'estado' },
                ExpressionAttributeValues: { ':p': pid, ':r': referenciaId, ':v': 'valida' },
            }));
            for (const f of (res.Items || [])) {
                await docClient.send(new UpdateCommand({
                    TableName: SIGNATURES_TABLE,
                    Key: { signatureId: f.signatureId },
                    UpdateExpression: 'SET #st = :s, supersededAt = :u',
                    ExpressionAttributeNames: { '#st': 'estado' },
                    ExpressionAttributeValues: { ':s': 'superada', ':u': new Date().toISOString() },
                }));
            }
        } catch (e) {
            console.error('No se pudo superar firma previa al renovar:', e.message);
        }
    }
};

// Genera el onboarding DS44 según el KIT del cargo (catálogo del tenant).
// - Sin cargo → no hay kit (personal de oficina/gestión).
// - ENTREGA_EPP → EppService (Art. 13), matriz del cargo.
// - Ítems con plantilla (tenant del catálogo / obra del MIPER) → doc con archivo
//   pegado (pendiente_firma). Sin plantilla y se esperaba → doc vacío + aviso.
// - Nunca bloquea el registro/vinculación (cada ítem va en su propio try/catch).
// - IDEMPOTENTE: si el ítem ya existe para esta persona+obra (de una asignación
//   previa), no se duplica; si estaba archivado, se reactiva.
const runOnboardingForObra = async ({ tenantId, obraId, persona, solicitante }) => {
    // El kit DE OBRA es solo para trabajadores de TERRENO (con cargo). Los documentos
    // de EMPRESA (Reglamento Interno + Política SST) ya NO viven en el kit por obra:
    // son de nivel tenant y se asignan a TODA persona no-admin en ensureCompanyDocsForPersona
    // (indistinto de rol, cargo u obra). Aquí solo se genera el kit técnico del cargo.
    const rolNorm = normalizeRol(persona.rol);
    if (rolNorm === 'admin') return;

    // El cargo vive en la ASIGNACIÓN a esta obra (multi-cargo). Fallback al cargo
    // legacy global por compatibilidad con personas aún no migradas.
    const cargosObra = typeof persona.cargosEnObra === 'function' ? persona.cargosEnObra(obraId) : [];
    const rawCargos = (cargosObra && cargosObra.length) ? cargosObra : (persona.cargo ? [persona.cargo] : []);
    // Normaliza a CÓDIGO del catálogo: "Carpintero" → CARPINTERO (resuelve su kit
    // real de 13 ítems). Sin esto, el texto libre caía SIEMPRE al kit genérico.
    const cargos = [...new Set(rawCargos.map((c) => normalizeCargoCodigo(c)).filter(Boolean))];

    // Sin cargo de terreno (gestión/oficina) → no hay kit de obra. Sus documentos de
    // empresa se asignan aparte (a nivel tenant).
    const esTerreno = !ROLES_GESTION.has(rolNorm) && cargos.length > 0;
    if (!esTerreno) return;

    const tenant = await tenantService.getById(tenantId).catch(() => null);
    const kit = resolveKitUnion(tenant?.reglas?.cargos, cargos);
    if (!Array.isArray(kit) || kit.length === 0) return;

    const obra = obraId ? await obraService.getById(obraId).catch(() => null) : null;
    const aplicabilidad = (obra && obra.aplicabilidadKit) || {};       // MIPER manual por obra+cargo
    const plantillasPorCargo = (obra && obra.plantillasOnboarding) || {};

    // Idempotencia: documentos de onboarding ya existentes de esta persona en la
    // obra (de una asignación previa), indexados por la key del kit / tipo.
    const existentes = await getOnboardingDocsForPersonaObra(tenantId, obraId, persona.personaId).catch(() => []);
    const existentePorKey = new Map();
    for (const d of existentes) {
        const k = d.kitItemKey || d.tipo;
        if (k && !existentePorKey.has(k)) existentePorKey.set(k, d);
    }

    const faltantes = [];

    for (const item of kit) {
        try {
            // Los documentos de empresa (RI/Política) NO se crean por obra: son de
            // nivel tenant (ensureCompanyDocsForPersona). Se saltan aquí.
            if (EMPRESA_DOC_TIPOS.includes(item.tipo)) continue;

            const origenes = (item.cargosOrigen && item.cargosOrigen.length) ? item.cargosOrigen : cargos;

            // Aplicabilidad MIPER (manual): se excluye solo si TODOS los cargos de
            // origen lo marcan 'no_aplica' en esta obra (PR-PO excluidos según MIPER).
            const excluido = origenes.length > 0 && origenes.every((cg) => aplicabilidad?.[cg]?.[item.key] === 'no_aplica');
            if (excluido) continue;

            // IDEMPOTENCIA: si el ítem ya existe (asignación previa), no se duplica.
            // Si estaba archivado (la persona fue desasignada antes), se reactiva.
            const yaExiste = existentePorKey.get(item.key) || existentePorKey.get(item.tipo);
            if (yaExiste) {
                if (yaExiste.estado === 'archivado') {
                    await setOnboardingDocEstado(yaExiste.documentId, 'activo').catch(() => {});
                }
                continue;
            }

            // EPP (Art. 13): la entrega física es un acto real (bodega/prevención
            // hace entrega y el trabajador firma recepción). NO se auto-genera al
            // crear la persona: hacerlo simulaba una entrega inexistente y ensuciaba
            // el historial de EPP. El ítem queda PENDIENTE en el checklist DS44 y la
            // entrega se registra cuando efectivamente ocurre (modal "Nueva entrega
            // / Reposición de EPP" en la ficha del trabajador).
            if (item.accion === 'ENTREGA_EPP') {
                continue;
            }

            // Naturaleza NO documental: encuestas y el ingreso a vigilancia de salud
            // se gestionan en sus propios módulos (encuestas / ficha de salud), no se
            // crean como documentos de firma aquí.
            if (['ENCUESTA', 'INGRESO_VIGILANCIA'].includes(item.accion)) {
                continue;
            }

            // Evidencia persona-level reutilizable (examen altura, vigilancia): si la
            // persona tiene una vigente, se reutiliza y el ítem nace completo.
            let evidenciaReuse = null;
            if (esEvidenciaReutilizable(item) && typeof persona.evidenciaVigente === 'function') {
                evidenciaReuse = persona.evidenciaVigente(item.tipo);
            }

            // Plantilla por alcance: tenant (del catálogo) u obra (IRL/MIPER, por cargo).
            let plantilla = null;
            if (item.alcancePlantilla === 'tenant') plantilla = item.plantilla || null;
            else if (item.alcancePlantilla === 'obra') {
                for (const cg of origenes) {
                    const m = plantillasPorCargo[cg] || {};
                    plantilla = m[item.key] || m[item.tipo] || null;
                    if (plantilla) break;
                }
            }

            // SOLO se asignan los ítems CONFIGURADOS. Si el ítem espera una plantilla
            // (tenant/obra) y aún no se ha subido (ni hay evidencia reutilizable), NO se
            // crea un documento vacío: queda como FALTANTE (aviso al admin) y, cuando se
            // suba la plantilla en /onboarding o el detalle de obra, el broadcast lo
            // asigna retroactivamente a quien corresponda.
            const esperaPlantilla = item.alcancePlantilla === 'tenant' || item.alcancePlantilla === 'obra';
            if (esperaPlantilla && !plantilla && !evidenciaReuse) {
                faltantes.push(`${item.codigoEbco ? item.codigoEbco + ' · ' : ''}${item.titulo}`);
                continue;
            }

            await createOnboardingDocument({
                tenantId, obraId, persona, solicitante,
                docConfig: {
                    tipo: item.tipo,
                    titulo: item.titulo,
                    descripcion: item.articulo ? `${item.articulo} — ${item.titulo}` : item.titulo,
                    requiereFirmaRelator: Boolean(item.requiereFirmaRelator),
                    plantilla: evidenciaReuse
                        ? { fileKey: evidenciaReuse.fileKey || null, nombre: evidenciaReuse.nombre || item.titulo }
                        : plantilla,
                    kitItemKey: item.key,
                    accion: item.accion,
                    alcance: item.alcancePlantilla,
                    bloqueante: Boolean(item.bloqueante),
                    notaMinima: item.notaMinima || null,
                    articulo: item.articulo || null,
                    cargosOrigen: origenes,
                    evidenciaReuse: evidenciaReuse
                        ? { origenObraId: evidenciaReuse.origenObraId || null, venceEn: evidenciaReuse.venceEn || null }
                        : null
                }
            });
        } catch (itemErr) {
            console.error(`Onboarding: error en ítem ${item.key}:`, itemErr.message);
        }
    }

    await avisarFaltaPlantilla({ solicitante, persona, obraId, faltantes });
};

// Asigna los DOCUMENTOS DE EMPRESA (Reglamento Interno + Política SST) a una persona
// a NIVEL TENANT (obraId null), indistinto de rol, cargo u obra (salvo admin). Así
// "todo documento de empresa aplica a todos" y aparece en todas sus obras y en su
// ficha. Idempotente: no duplica si la persona ya los tiene.
const ensureCompanyDocsForPersona = async ({ tenantId, persona, solicitante }) => {
    if (!persona) return;
    if (normalizeRol(persona.rol) === 'admin') return;

    const tenant = await tenantService.getById(tenantId).catch(() => null);
    const items = getCompanyWideKitItems(tenant);
    if (!Array.isArray(items) || items.length === 0) return;

    // Documentos de empresa que ya tiene la persona (cualquier obra/tenant), por tipo.
    const existentes = await docClient.send(new QueryCommand({
        TableName: DOCUMENTS_TABLE,
        IndexName: 'tenantId-index',
        KeyConditionExpression: 'tenantId = :t',
        ExpressionAttributeValues: { ':t': tenantId },
    })).then((r) => (r.Items || []).filter((d) =>
        (d.asignaciones || []).some((a) => a.personaId === persona.personaId) &&
        d.estado !== 'archivado'
    )).catch(() => []);
    const tiposExistentes = new Set(existentes.map((d) => d.tipo));

    for (const item of items) {
        if (tiposExistentes.has(item.tipo)) continue; // ya lo tiene → no duplicar
        // Solo se asigna si el documento de empresa ya está CONFIGURADO (plantilla
        // subida en /onboarding). Si aún no, no se crea vacío: cuando se suba, el
        // broadcast lo asigna a todos retroactivamente.
        if (!item.plantilla || !item.plantilla.fileKey) continue;
        try {
            await createOnboardingDocument({
                tenantId, obraId: null, persona, solicitante,
                docConfig: {
                    tipo: item.tipo,
                    titulo: item.titulo,
                    descripcion: item.articulo ? `${item.articulo} — ${item.titulo}` : item.titulo,
                    requiereFirmaRelator: false,
                    plantilla: item.plantilla || null,
                    kitItemKey: item.key,
                    accion: item.accion || 'DIFUSION_FIRMA',
                    alcance: 'tenant',
                    clasificacion: 'empresa',
                    articulo: item.articulo || null,
                    cargosOrigen: null,
                },
            });
        } catch (e) {
            console.error(`No se pudo asignar documento de empresa ${item.tipo} a ${persona.personaId}:`, e.message);
        }
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// BROADCAST retroactivo de plantillas del catálogo de cargos.
//
// Caso: se crea una persona con un cargo cuya plantilla (IRL, PTS…) o cuyo
// documento de empresa (Reglamento Interno, Política SST) AÚN no se había subido.
// Su documento de onboarding nace sin archivo (pendiente_asignar). Cuando luego
// se sube la plantilla en /cargos-onboarding, este broadcast la sincroniza a TODOS
// los documentos de onboarding ya existentes que apliquen y que aún no la tengan,
// y notifica a cada asignado que el documento quedó listo para firmar.
//
// Reglas:
//  - Solo toca documentos NO firmados (preserva firmas de versiones anteriores).
//  - Alcance 'tenant' (RI/Política/IRL de empresa) → aplica a todos los cargos.
//  - Alcance por cargo → solo a documentos de ese cargo.
//  - Idempotente: si el documento ya tiene esa misma plantilla, no hace nada.
const syncPlantillasToWorkers = async ({ tenantId, oldCargos, newCargos }) => {
    const fileKeyDe = (p) => (p && p.fileKey) ? p.fileKey : null;

    // 1) Detectar qué ítems del kit ganaron o cambiaron su plantilla.
    const oldMap = new Map(); // `${cargo}|${key}` -> fileKey anterior
    for (const c of (oldCargos || [])) {
        for (const it of (c.kit || [])) {
            oldMap.set(`${c.codigo}|${it.key}`, fileKeyDe(it.plantilla));
        }
    }
    const cambios = []; // { key, tipo, alcance, cargo, plantilla }  (alta/cambio)
    const removals = []; // { key, tipo, cargo }  (se quitó la plantilla)
    let itemsAgregados = false; // ¿se añadió algún ítem nuevo al kit de algún cargo?
    for (const c of (newCargos || [])) {
        const oldKit = (oldCargos || []).find((o) => o.codigo === c.codigo)?.kit || [];
        const oldKeys = new Set(oldKit.map((it) => it.key));
        for (const it of (c.kit || [])) {
            if (!oldKeys.has(it.key)) itemsAgregados = true;
            const fk = fileKeyDe(it.plantilla);
            const prevFk = oldMap.get(`${c.codigo}|${it.key}`);
            // Se normaliza el código del cargo igual que en los documentos de los
            // trabajadores (cargosDoc), para que el match no falle por formato/casing.
            const cargoNorm = normalizeCargoCodigo(c.codigo) || c.codigo;
            if (fk) {
                if (prevFk !== fk) {
                    cambios.push({ key: it.key, tipo: it.tipo, alcance: it.alcancePlantilla, cargo: cargoNorm, plantilla: it.plantilla });
                }
            } else if (prevFk) {
                // Tenía plantilla y ahora no → se quitó: hay que despegar el archivo de
                // los documentos de los trabajadores (vuelven a "pendiente de asignar").
                removals.push({ key: it.key, tipo: it.tipo, cargo: cargoNorm });
            }
        }
    }
    // ¿Cambió algún documento de empresa (RI/Política)? Si sí, hay que asegurarse de
    // que TODA persona no-admin lo tenga asignado (a nivel tenant) y reciba el archivo.
    const companyWideChanged = cambios.some((c) => EMPRESA_DOC_TIPOS.includes(c.tipo));
    if (cambios.length === 0 && removals.length === 0 && !itemsAgregados) return { actualizados: 0, creados: 0, removidos: 0 };

    // Documentos verdaderamente de empresa (un mismo archivo para TODOS los cargos):
    // Reglamento Interno y Política SST. El IRL, en cambio, es alcance 'tenant' pero
    // su contenido es POR CARGO (cada cargo tiene su propio IRL), así que NO se
    // difunde entre cargos distintos.
    const EMPRESA_WIDE_TIPOS = new Set(['POLITICA_SSO', 'REGLAMENTO_INTERNO']);

    // 2) Documentos de onboarding del tenant (una sola query) si hay altas o bajas.
    const docsRes = (cambios.length > 0 || removals.length > 0) ? await docClient.send(new QueryCommand({
        TableName: DOCUMENTS_TABLE,
        IndexName: 'tenantId-index',
        KeyConditionExpression: 'tenantId = :t',
        ExpressionAttributeValues: { ':t': tenantId },
    })) : { Items: [] };
    // Incluye docs de obra ('diario') y de empresa a nivel tenant ('empresa'): el
    // broadcast de RI/Política debe alcanzar ambos.
    const docs = (docsRes.Items || []).filter((d) => ['diario', 'empresa'].includes(d.clasificacion) && d.estado !== 'archivado');

    let actualizados = 0;
    let removidos = 0;
    const now = new Date().toISOString();
    for (const doc of docs) {
        const docKey = doc.kitItemKey || doc.tipo;
        // Se normalizan SIEMPRE los códigos de cargo del documento (cargosOrigen o el
        // fallback doc.cargo) para comparar con los del catálogo ya normalizados.
        const cargosDoc = ((Array.isArray(doc.cargosOrigen) && doc.cargosOrigen.length)
            ? doc.cargosOrigen
            : (doc.cargo ? String(doc.cargo).split(',') : [])
        ).map((s) => normalizeCargoCodigo(String(s).trim())).filter(Boolean);

        // BAJA: se quitó la plantilla del catálogo → despegar el archivo del documento
        // del trabajador (vuelve a pendiente_asignar) y superar firmas de esa versión.
        const rm = removals.find((r) =>
            (r.key === docKey || r.tipo === doc.tipo) &&
            (EMPRESA_DOC_TIPOS.includes(r.tipo) || cargosDoc.includes(r.cargo))
        );
        if (rm && doc.s3Key) {
            const firmantes = (doc.asignaciones || [])
                .filter((a) => a.estado === 'firmado' || a.fechaFirma)
                .map((a) => a.personaId || a.workerId)
                .filter(Boolean);
            if (firmantes.length > 0) await supersedeFirmasDeReferencia(doc.documentId, firmantes);
            const asigReset = (doc.asignaciones || []).map((a) => ({ ...a, estado: 'pendiente', fechaFirma: null }));
            await docClient.send(new UpdateCommand({
                TableName: DOCUMENTS_TABLE,
                Key: { documentId: doc.documentId },
                UpdateExpression: 'SET s3Key = :s, archivoNombre = :n, asignaciones = :asig, firmas = :f, updatedAt = :u',
                ExpressionAttributeValues: { ':s': null, ':n': null, ':asig': asigReset, ':f': [], ':u': now },
            }));
            removidos++;
            continue;
        }

        // Cambio que aplica a este documento: los docs de empresa (RI/Política) se
        // difunden a todos los cargos; el resto (IRL, PTS…) solo al cargo que coincide.
        const ch = cambios.find((c) =>
            (c.key === docKey || c.tipo === doc.tipo) &&
            (EMPRESA_WIDE_TIPOS.has(c.tipo) || cargosDoc.includes(c.cargo))
        );
        if (!ch) continue;

        // Si ya tiene exactamente esa plantilla, no hay nada que hacer.
        if (doc.s3Key === ch.plantilla.fileKey) continue;

        // RENOVACIÓN: el documento ya tenía un archivo (versión previa) que cambió.
        // Hay que reabrir la firma para TODOS (incluidos los que ya firmaron la
        // versión anterior) y superar sus firmas previas. PRIMERA CARGA: el archivo
        // estaba ausente; solo se adjunta y se mantiene el estado pendiente.
        const esRenovacion = Boolean(doc.s3Key);
        const huboFirmados = (doc.asignaciones || []).some((a) => a.estado === 'firmado' || a.fechaFirma);

        let nuevasAsignaciones = doc.asignaciones || [];
        if (esRenovacion && huboFirmados) {
            const firmantes = (doc.asignaciones || [])
                .filter((a) => a.estado === 'firmado' || a.fechaFirma)
                .map((a) => a.personaId)
                .filter(Boolean);
            await supersedeFirmasDeReferencia(doc.documentId, firmantes);
            nuevasAsignaciones = (doc.asignaciones || []).map((a) => ({
                ...a, estado: 'pendiente', fechaFirma: null,
            }));
        }

        const updateExpr = esRenovacion && huboFirmados
            ? 'SET s3Key = :s, archivoNombre = :n, asignaciones = :asig, version = :ver, firmas = :firmas, updatedAt = :u'
            : 'SET s3Key = :s, archivoNombre = :n, updatedAt = :u';
        const exprValues = esRenovacion && huboFirmados
            ? {
                ':s': ch.plantilla.fileKey,
                ':n': ch.plantilla.nombre || doc.archivoNombre || null,
                ':asig': nuevasAsignaciones,
                ':ver': (doc.version || 1) + 1,
                ':firmas': [],
                ':u': now,
            }
            : {
                ':s': ch.plantilla.fileKey,
                ':n': ch.plantilla.nombre || doc.archivoNombre || null,
                ':u': now,
            };

        await docClient.send(new UpdateCommand({
            TableName: DOCUMENTS_TABLE,
            Key: { documentId: doc.documentId },
            UpdateExpression: updateExpr,
            ExpressionAttributeValues: exprValues,
        }));
        actualizados++;

        // Avisar a TODOS los asignados (en renovación reabren firma; en primera
        // carga, los que estaban pendientes) que el documento está listo para revisar.
        const asignados = nuevasAsignaciones
            .filter((a) => a.estado !== 'firmado')
            .map((a) => a.personaId || a.workerId)
            .filter(Boolean);
        if (asignados.length > 0) {
            try {
                await eventBus.emit('document.assigned', {
                    documentId: doc.documentId,
                    userIds: asignados,
                    assignedBy: 'system',
                    creatorName: 'Sistema DS44',
                    documentName: esRenovacion ? `${doc.titulo} (versión actualizada)` : doc.titulo,
                    dueDate: null,
                });
            } catch (e) {
                console.error('Broadcast plantilla: fallo al notificar', e.message);
            }
        }
    }

    // 3) Asignación retroactiva a personas YA existentes (infalible):
    //    - Documento de empresa cambiado (RI/Política) → asegurar que TODA persona
    //      no-admin lo tenga (a nivel tenant). El doc nace con el archivo y notifica.
    //    - Cualquier plantilla cargada/cambiada o ítem nuevo → re-correr onboarding
    //      por obra (idempotente: crea SOLO lo que falta) para que un trabajador que
    //      ya tenía el cargo reciba el ítem (ej. IRL) aunque su doc aún no existiera.
    const recrearOnboarding = cambios.length > 0 || itemsAgregados;
    let creados = 0;
    if (companyWideChanged || recrearOnboarding) {
        const personas = await personaService.listByTenant(tenantId).catch(() => []);
        for (const p of personas) {
            if (normalizeRol(p.rol) === 'admin') continue;
            if (companyWideChanged) {
                try {
                    await ensureCompanyDocsForPersona({ tenantId, persona: p, solicitante: null });
                } catch (e) {
                    console.error(`Resync docs empresa (persona ${p.personaId}) falló:`, e.message);
                }
            }
            if (recrearOnboarding) {
                const obras = Array.isArray(p.obraIds) ? p.obraIds : [];
                for (const oId of obras) {
                    try {
                        await runOnboardingForObra({ tenantId, obraId: oId, persona: p, solicitante: null });
                        creados++;
                    } catch (e) {
                        console.error(`Resync onboarding (persona ${p.personaId}, obra ${oId}) falló:`, e.message);
                    }
                }
            }
        }
    }

    return { actualizados, creados, removidos };
};

// Valores estandarizados para los desplegables de la plantilla.
const NIVEL_ESCOLAR_OPCIONES = [
    'Básica incompleta', 'Básica completa', 'Media incompleta', 'Media completa',
    'Técnica', 'Universitaria', 'Postgrado'
];
const RELACION_EMERGENCIA_OPCIONES = [
    'Cónyuge', 'Conviviente', 'Padre', 'Madre', 'Hijo/a', 'Hermano/a', 'Otro familiar', 'Amigo/a'
];

// Columnas (1-based) de la hoja Personas que llevan desplegable.
const COL = { rol: 8, cargo: 9, nivelEscolar: 11, relacion: 14 };
const TEMPLATE_FILAS_VALIDADAS = 500; // filas de datos con desplegable activo

/**
 * Genera la plantilla Excel de carga masiva con LISTAS DESPLEGABLES por columna
 * para los campos estandarizados (rol, cargo, nivel escolar, relación de
 * contacto). Los valores de rol/cargo se toman del tenant cuando está
 * disponible; si no, se usan ejemplos. Usa exceljs porque SheetJS (community)
 * no escribe validaciones de datos.
 *
 * @param {{ roles?: string[], cargos?: string[] }} listas
 * @returns {Promise<Buffer>}
 */
const createTemplateBuffer = async ({ roles, cargos } = {}) => {
    const rolesList = (Array.isArray(roles) && roles.length) ? roles
        : ['Administrador', 'Prevencionista', 'Jefe de Obra', 'Supervisor', 'Colaborador'];
    const cargosList = (Array.isArray(cargos) && cargos.length) ? cargos
        : ['Carpintero', 'Maestro albañil', 'Jornal de aseo y acarreo', 'Prevencionista'];

    const wb = new ExcelJS.Workbook();

    // IMPORTANTE: la hoja de datos (Personas) se crea PRIMERO para que sea la
    // pestaña activa. Si la hoja oculta fuera la activa, los visores la revelan
    // (la pestaña activa no puede estar oculta). 'Listas' se agrega al final.
    const ws = wb.addWorksheet('Personas', { views: [{ tabSelected: true }] });
    ws.addRow(TEMPLATE_HEADERS);
    TEMPLATE_EXAMPLE_ROWS.forEach((row) => ws.addRow(row));

    // Encabezado en negrita.
    ws.getRow(1).font = { bold: true };
    ws.columns.forEach((col) => { col.width = 20; });

    // Rangos de cada lista en la hoja oculta.
    const rango = (letra, n) => `Listas!$${letra}$1:$${letra}$${Math.max(n, 1)}`;
    const validaciones = [
        { col: COL.rol, formula: rango('A', rolesList.length), msg: 'Selecciona un rol definido por la empresa.' },
        { col: COL.cargo, formula: rango('B', cargosList.length), msg: 'Selecciona un cargo del catálogo.' },
        { col: COL.nivelEscolar, formula: rango('C', NIVEL_ESCOLAR_OPCIONES.length), msg: 'Selecciona el nivel escolar.' },
        { col: COL.relacion, formula: rango('D', RELACION_EMERGENCIA_OPCIONES.length), msg: 'Selecciona la relación del contacto.' },
    ];

    // Aplica el desplegable a las filas de datos (desde la fila 2).
    for (let fila = 2; fila <= TEMPLATE_FILAS_VALIDADAS + 1; fila++) {
        for (const v of validaciones) {
            ws.getCell(fila, v.col).dataValidation = {
                type: 'list',
                allowBlank: true,
                formulae: [v.formula],
                showErrorMessage: true,
                errorStyle: 'warning',
                errorTitle: 'Valor sugerido',
                error: v.msg,
            };
        }
    }

    const instrucciones = wb.addWorksheet('Instrucciones');
    instrucciones.getColumn(1).width = 120;
    instrucciones.addRow(['Instrucciones']).font = { bold: true };
    TEMPLATE_INSTRUCTIONS.forEach((line) => instrucciones.addRow([line]));

    // Hoja oculta (al final) con los valores permitidos de cada desplegable. No es
    // editable por el usuario: se regenera en cada descarga con los datos reales de
    // la empresa. 'veryHidden' la oculta sin opción de mostrarla desde la UI de Excel.
    const listas = wb.addWorksheet('Listas');
    listas.state = 'veryHidden';
    const columnasLista = [rolesList, cargosList, NIVEL_ESCOLAR_OPCIONES, RELACION_EMERGENCIA_OPCIONES];
    const letras = ['A', 'B', 'C', 'D'];
    columnasLista.forEach((valores, c) => {
        valores.forEach((v, r) => { listas.getCell(`${letras[c]}${r + 1}`).value = v; });
    });

    const buffer = await wb.xlsx.writeBuffer();
    return Buffer.from(buffer);
};

// Broadcast retroactivo de plantillas (lo invoca el guardado de cargos del tenant).
module.exports.syncPlantillasToWorkers = syncPlantillasToWorkers;
module.exports.ensureCompanyDocsForPersona = ensureCompanyDocsForPersona;

module.exports.personasHandler = async (event) => {
    const method = event.requestContext?.http?.method || event.httpMethod;
    const path = event.rawPath || event.path || '';

    const segments = path.replace(/^\/personas\/?/, '').split('/').filter(Boolean);
    const personaId = segments[0] || null;
    const action = segments[1] || null;

    // tenantId: del JWT o query (temporal durante migración)
    const tenantId = event.queryStringParameters?.tenantId
        || event.requestContext?.authorizer?.claims?.['custom:tenantId']
        || null;

    try {
        // CORS preflight
        if (method === 'OPTIONS') return cors();

        // GET /personas/plantilla — Descargar plantilla Excel
        if (method === 'GET' && personaId === 'plantilla') {
            // Plantilla tenant-aware: pobla los desplegables de rol y cargo con los
            // valores reales de la empresa cuando hay tenantId disponible.
            let roles, cargos;
            if (tenantId) {
                const tenant = await tenantService.getById(tenantId).catch(() => null);
                if (tenant) {
                    roles = Array.isArray(tenant.roles) ? tenant.roles.map(r => r.nombre).filter(Boolean) : undefined;
                    cargos = Array.isArray(tenant.reglas?.cargos) ? tenant.reglas.cargos.map(c => c.label || c.codigo).filter(Boolean) : undefined;
                }
            }
            const buffer = await createTemplateBuffer({ roles, cargos });
            return {
                statusCode: 200,
                headers: {
                    ...headers,
                    'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                    'Content-Disposition': 'attachment; filename=plantilla_personas.xlsx'
                },
                body: buffer.toString('base64'),
                isBase64Encoded: true
            };
        }

        // POST /personas/parse-excel — Parsear Excel sin crear personas (para onboarding)
        if (method === 'POST' && personaId === 'parse-excel') {
            const body = JSON.parse(event.body || '{}');
            const fileBase64 = body.fileBase64 || body.archivoBase64 || '';
            const fileName = body.fileName || 'personas.xlsx';

            if (!fileBase64) return error('No se proporcionó ningún archivo');
            if (!fileName.toLowerCase().endsWith('.xlsx')) return error('El archivo debe ser un Excel (.xlsx)');

            const base64 = fileBase64.includes('base64,') ? fileBase64.split('base64,')[1] : fileBase64;
            const buffer = Buffer.from(base64, 'base64');
            let workbook;
            try {
                workbook = XLSX.read(buffer, { type: 'buffer' });
            } catch (xlsxErr) {
                return error('No se pudo leer el archivo Excel. Verifique que sea un archivo .xlsx válido.');
            }
            if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
                return error('El archivo Excel no contiene hojas de trabajo.');
            }
            const sheetName = workbook.SheetNames.includes('Personas') ? 'Personas' : workbook.SheetNames[0];
            const worksheet = workbook.Sheets[sheetName];
            const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });
            if (!rows.length) return error('La plantilla no tiene filas de datos');

            const rawHeaders = rows[0].map(normalizeHeader);
            const headerMap = {};
            rawHeaders.forEach((header, index) => {
                const canonical = headerAliases[header];
                if (canonical) headerMap[canonical] = index;
            });

            const missingHeaders = ['rut', 'nombre', 'rol'].filter(h => headerMap[h] === undefined);
            if (missingHeaders.length > 0) {
                return error(`Faltan columnas obligatorias: ${missingHeaders.join(', ')}`);
            }

            const trabajadores = [];
            const errores = [];
            const seenRut = new Set();

            for (let rowIndex = 1; rowIndex < rows.length; rowIndex++) {
                const row = rows[rowIndex];
                if (!row.some(cell => String(cell || '').trim() !== '')) continue;

                const getCell = (key) => {
                    const idx = headerMap[key];
                    if (idx === undefined) return '';
                    const value = row[idx];
                    return value === undefined || value === null ? '' : String(value).trim();
                };

                const rut = getCell('rut');
                const nombre = getCell('nombre');
                const fechaNacimiento = getCell('fechaNacimiento');
                const email = getCell('email');
                const rol = getCell('rol') || 'Colaborador';
                const cargo = getCell('cargo');

                if (!rut || !nombre) {
                    errores.push({ fila: rowIndex + 1, error: 'Faltan rut o nombre' });
                    continue;
                }

                const rutKey = rut.replace(/[.\-]/g, '').toLowerCase();
                if (seenRut.has(rutKey)) {
                    errores.push({ fila: rowIndex + 1, error: `RUT ${rut} duplicado en el archivo` });
                    continue;
                }
                seenRut.add(rutKey);

                const { apellidoPaterno, apellidoMaterno } = resolveApellidos(
                    getCell('apellidoPaterno'), getCell('apellidoMaterno'), getCell('apellido')
                );

                // El acceso web es siempre habilitado; no se expone en la plantilla.
                trabajadores.push({ rut, nombre, apellidoPaterno, apellidoMaterno, email, rol, cargo, tieneAccesoWeb: true, fechaNacimiento });
            }

            return success({ trabajadores, errores, total: trabajadores.length });
        }

        // POST /personas/carga-masiva — Procesar Excel
        if (method === 'POST' && personaId === 'carga-masiva') {
            if (!tenantId) return error('tenantId es requerido');
            const body = JSON.parse(event.body || '{}');
            const fileBase64 = body.fileBase64 || body.archivoBase64 || '';
            const fileName = body.fileName || 'personas.xlsx';
            const sendEmails = Boolean(body.sendWelcomeEmail);

            if (!fileBase64) return error('No se proporciono ningun archivo');
            if (!fileName.toLowerCase().endsWith('.xlsx')) return error('El archivo debe ser un Excel (.xlsx)');

            const base64 = fileBase64.includes('base64,')
                ? fileBase64.split('base64,')[1]
                : fileBase64;

            const buffer = Buffer.from(base64, 'base64');
            let workbook;
            try {
                workbook = XLSX.read(buffer, { type: 'buffer' });
            } catch (xlsxErr) {
                console.error('Error parsing Excel workbook:', xlsxErr.message);
                return error('No se pudo leer el archivo Excel. Verifique que sea un archivo .xlsx valido y no este protegido con contrasena.');
            }
            if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
                return error('El archivo Excel no contiene hojas de trabajo.');
            }
            const sheetName = workbook.SheetNames.includes('Personas')
                ? 'Personas'
                : workbook.SheetNames[0];
            const worksheet = workbook.Sheets[sheetName];

            const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });
            if (!rows.length) return error('La plantilla no tiene filas');

            const rawHeaders = rows[0].map(normalizeHeader);
            const headerMap = {};

            rawHeaders.forEach((header, index) => {
                const canonical = headerAliases[header];
                if (canonical) headerMap[canonical] = index;
            });

            const requiredHeaders = ['rut', 'nombre', 'rol'];
            const missingHeaders = requiredHeaders.filter(h => headerMap[h] === undefined);
            if (missingHeaders.length > 0) {
                return error(`Faltan columnas obligatorias: ${missingHeaders.join(', ')}`);
            }

            // Obra por defecto del lote (carga hecha desde una obra) + mapas código/UUID->obraId
            const obraIdBatch = body.obraId || null;
            const obrasTenant = await obraService.listByTenant(tenantId).catch(() => []);
            const obraPorCodigo = {};
            const obraPorUUID = {};
            (obrasTenant || []).forEach((o) => {
                if (o.codigo) obraPorCodigo[String(o.codigo).trim().toLowerCase()] = o.obraId;
                if (o.obraId) obraPorUUID[String(o.obraId).trim().toLowerCase()] = o.obraId;
            });

            const resultados = { creados: [], errores: [], duplicados: [], totalProcesados: 0 };
            const seenRut = new Set();

            for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
                const row = rows[rowIndex];
                const rowNumber = rowIndex + 1;

                const rowHasValue = row.some(cell => String(cell || '').trim() !== '');
                if (!rowHasValue) continue;

                resultados.totalProcesados += 1;

                const getCell = (key) => {
                    const idx = headerMap[key];
                    if (idx === undefined) return '';
                    const value = row[idx];
                    return value === undefined || value === null ? '' : String(value).trim();
                };

                const rut = getCell('rut');
                const nombre = getCell('nombre');
                const { apellidoPaterno, apellidoMaterno } = resolveApellidos(
                    getCell('apellidoPaterno'), getCell('apellidoMaterno'), getCell('apellido')
                );
                const fechaNacimiento = getCell('fechaNacimiento');
                const email = getCell('email');
                const telefono = getCell('telefono');
                // Rol: nombre del rol del tenant (ej. "Colaborador") — sin lowercase
                // porque el case importa para resolver el preset de permisos.
                const rol = getCell('rol');
                // Cargo (opcional) → código del catálogo. Vacío queda vacío (sin
                // onboarding de terreno); con texto, normaliza a código (alias EBCO).
                const cargoRaw = getCell('cargo');
                const cargo = cargoRaw ? normalizeCargoCodigo(cargoRaw) : '';
                // Obra: acepta código (ej. OBRA-001) o UUID en la columna obra/obraId.
                // Se pueden indicar MÚLTIPLES obras separadas por coma. Si la celda
                // queda vacía, se usa la obra del lote (si la carga se hizo desde una
                // obra) o la persona se crea sin obra (se vincula después).
                const obraCellRaw = getCell('obra').trim();
                let obraIds = [];
                if (obraCellRaw) {
                    const seenObra = new Set();
                    for (const token of obraCellRaw.split(',')) {
                        const v = token.trim().toLowerCase();
                        if (!v) continue;
                        const resolved = obraPorCodigo[v] || obraPorUUID[v] || null;
                        if (resolved && !seenObra.has(resolved)) {
                            seenObra.add(resolved);
                            obraIds.push(resolved);
                        }
                    }
                } else if (obraIdBatch) {
                    obraIds = [obraIdBatch];
                }
                const nivelEscolar = getCell('nivelEscolar');
                const contactoEmergencia = {
                    nombre: getCell('contactoEmergenciaNombre'),
                    telefono: getCell('contactoEmergenciaTelefono'),
                    relacion: getCell('contactoEmergenciaRelacion')
                };
                const cursos = getCell('cursos')
                    .split(';')
                    .map((c) => c.trim())
                    .filter(Boolean)
                    .map((nombre) => ({ nombre }));

                if (!rut || !nombre || !rol) {
                    resultados.errores.push({ fila: rowNumber, error: 'Faltan rut, nombre o rol' });
                    continue;
                }

                const rutKey = rut.replace(/[.\-]/g, '').toLowerCase();
                if (seenRut.has(rutKey)) {
                    resultados.duplicados.push({ fila: rowNumber, rut, motivo: 'Duplicado en archivo' });
                    continue;
                }
                seenRut.add(rutKey);

                try {
                    const { persona, passwordTemporal } = await personaService.crear(tenantId, {
                        rut,
                        nombre,
                        apellidoPaterno,
                        apellidoMaterno,
                        fechaNacimiento,
                        email,
                        telefono,
                        rol,
                        cargo,
                        obraIds,
                        nivelEscolar,
                        contactoEmergencia,
                        cursos,
                        // El acceso web es siempre habilitado; no se expone en la plantilla.
                        tieneAccesoWeb: true
                    });

                    if (sendEmails && persona.email && passwordTemporal) {
                        try {
                            await sendWelcomeEmail(persona.email, persona.nombre, persona.rut, passwordTemporal);
                        } catch (emailErr) {
                            console.error('Error sending welcome email:', emailErr);
                        }
                    }

                    // Documentos de empresa (RI/Política) a nivel tenant: a TODA persona
                    // no-admin, tenga o no obra.
                    if (normalizeRol(persona.rol) !== 'admin') {
                        await ensureCompanyDocsForPersona({ tenantId, persona, solicitante: null }).catch((e) =>
                            console.error(`Docs empresa fila ${rowNumber}:`, e.message));
                    }
                    // Kit técnico del cargo por obra (solo terreno).
                    if (normalizeRol(persona.rol) !== 'admin' && Array.isArray(persona.obraIds)) {
                        for (const oId of persona.obraIds) {
                            try {
                                await runOnboardingForObra({ tenantId, obraId: oId, persona, solicitante: null });
                            } catch (onboardingErr) {
                                console.error(`Onboarding fallido (fila ${rowNumber}, obra ${oId}):`, onboardingErr.message);
                            }
                        }
                    }

                    console.log(`Carga masiva: persona creada fila ${rowNumber} personaId=${persona.personaId}`);
                    resultados.creados.push({
                        fila: rowNumber,
                        personaId: persona.personaId,
                        rut: persona.rut,
                        passwordTemporal: passwordTemporal || undefined
                    });
                } catch (err) {
                    const message = err?.message || 'Error al crear persona';
                    if (message.includes('Ya existe una persona')) {
                        resultados.duplicados.push({ fila: rowNumber, rut, motivo: 'Ya existe en el tenant' });
                    } else {
                        resultados.errores.push({ fila: rowNumber, error: message });
                    }
                }
            }

            // Cada persona creada por carga masiva aumenta el conteo del tenant.
            if (resultados.creados.length > 0) {
                await tenantService.ajustarCantidadTrabajadores(tenantId, resultados.creados.length).catch((countErr) => {
                    console.error('No se pudo actualizar la cantidad de trabajadores del tenant (carga masiva):', countErr.message);
                });
            }

            return success({
                mensaje: `Carga masiva completada. ${resultados.creados.length} personas creadas.`,
                resultados
            });
        }

        // POST /personas — Crear persona
        if (method === 'POST' && !personaId) {
            if (!tenantId) return error('tenantId es requerido');
            const body = JSON.parse(event.body || '{}');

            // Enforcement por permiso cuando se identifica al creador.
            // (El onboarding inicial crea el admin sin creador y queda exento.)
            const creadorId = body.creadorId || body.solicitanteId || null;
            if (creadorId) {
                const creadorPersona = await personaService.getById(creadorId).catch(() => null);
                if (!creadorPersona || !personaPuede(creadorPersona, await tenantSafe(tenantId), PERMISSIONS.PERSONAS_CREAR)) {
                    return error('No tienes permiso para crear personas', 403);
                }
            }

            const { persona, passwordTemporal } = await personaService.crear(tenantId, {
                ...body,
                creadoPor: creadorId,
            });

            // Cada persona registrada aumenta automáticamente el conteo del tenant.
            await tenantService.ajustarCantidadTrabajadores(tenantId, 1).catch((countErr) => {
                console.error('No se pudo actualizar la cantidad de trabajadores del tenant:', countErr.message);
            });

            // Documentos de empresa (RI/Política) a nivel tenant: a TODA persona
            // no-admin, tenga o no obra.
            const solicitanteCreate = body.solicitanteId ? await personaService.getById(body.solicitanteId).catch(() => null) : null;
            if (normalizeRol(persona.rol) !== 'admin') {
                await ensureCompanyDocsForPersona({ tenantId, persona, solicitante: solicitanteCreate }).catch((e) =>
                    console.error('Docs empresa al crear persona:', e.message));
            }
            // Kit técnico del cargo por obra (solo terreno).
            if (normalizeRol(persona.rol) !== 'admin' && Array.isArray(persona.obraIds) && persona.obraIds.length > 0) {
                const solicitante = solicitanteCreate;
                for (const oId of persona.obraIds) {
                    try {
                        await runOnboardingForObra({ tenantId, obraId: oId, persona, solicitante });
                    } catch (onboardingErr) {
                        console.error(`Onboarding fallido al crear persona (obra ${oId}):`, onboardingErr.message);
                    }
                }
            }

            // Enviar email de bienvenida si tiene acceso web
            let emailSent = false;
            if (persona.email && passwordTemporal) {
                try {
                    const nombreCompleto = [persona.nombre, persona.apellido].filter(Boolean).join(' ');
                    const emailResult = await sendWelcomeEmail(
                        persona.email, nombreCompleto, persona.rut, passwordTemporal
                    );
                    emailSent = emailResult?.sent || false;
                } catch (emailErr) {
                    console.error('Error sending welcome email:', emailErr);
                }
            }

            return created({
                message: 'Persona creada exitosamente',
                persona: persona.toSafeFormat(),
                passwordTemporal: passwordTemporal || undefined,
                emailNotificado: emailSent
            });
        }

        // GET /personas — Listar personas del tenant
        if (method === 'GET' && !personaId) {
            if (!tenantId) return error('tenantId es requerido');
            const { rol, estado, obraId } = event.queryStringParameters || {};
            const personas = await personaService.listByTenant(tenantId, { rol, estado, obraId });
            return success({
                total: personas.length,
                personas: personas.map(p => p.toSafeFormat())
            });
        }

        // GET /personas/validate?rut=... — Verificar si un RUT ya está registrado
        if (method === 'GET' && personaId === 'validate') {
            const rut = event.queryStringParameters?.rut;
            if (!rut) return error('El parámetro rut es requerido', 400);
            const existente = await personaService.getByRutGlobal(rut);
            return success({ existe: !!existente, valido: !existente,
                mensaje: existente ? `El RUT ${rut} ya está registrado en el sistema` : null });
        }

        // GET /personas/by-rut/{rut} — Buscar por RUT
        if (method === 'GET' && personaId === 'by-rut' && action) {
            if (!tenantId) return error('tenantId es requerido');
            const persona = await personaService.getByRut(tenantId, action);
            if (!persona) return error('Persona no encontrada', 404);
            return success(persona.toSafeFormat());
        }

        // GET /personas/{id} — Obtener persona
        if (method === 'GET' && personaId && !action) {
            const persona = await personaService.getById(personaId);
            if (!persona) return error('Persona no encontrada', 404);
            return success(persona.toSafeFormat());
        }

        // PUT /personas/{id} — Actualizar persona
        if (method === 'PUT' && personaId && !action) {
            if (!tenantId) return error('tenantId es requerido');
            const body = JSON.parse(event.body || '{}');
            const previousPersona = await personaService.getById(personaId);
            const previousObraIds = new Set(previousPersona?.obraIds || []);
            const persona = await personaService.actualizar(tenantId, personaId, body);

            try {
                const nextObraIds = Array.isArray(persona.obraIds) ? persona.obraIds : [];
                const addedObras = nextObraIds.filter((id) => !previousObraIds.has(id));
                const noEsAdmin = normalizeRol(persona.rol) !== 'admin';

                if (noEsAdmin && addedObras.length > 0) {
                    const solicitanteId = body.solicitanteId
                        || event.requestContext?.authorizer?.claims?.sub
                        || null;
                    const solicitante = solicitanteId
                        ? await personaService.getById(solicitanteId)
                        : null;

                    for (const obraId of addedObras) {
                        await runOnboardingForObra({
                            tenantId,
                            obraId,
                            persona,
                            solicitante
                        });
                    }
                }
            } catch (onboardingError) {
                console.error('Error creating onboarding tasks:', onboardingError);
            }

            return success({
                message: 'Persona actualizada',
                persona: persona.toSafeFormat()
            });
        }

        // DELETE /personas/{id} — Desvincular (eliminar) persona de la empresa.
        // Requiere el permiso PERSONA_DESVINCULAR del solicitante. No se permite
        // desvincular al administrador. Decrementa el conteo del tenant.
        if (method === 'DELETE' && personaId && !action) {
            if (!tenantId) return error('tenantId es requerido');
            const body = JSON.parse(event.body || '{}');

            const solicitanteId = body.solicitanteId
                || event.requestContext?.authorizer?.claims?.sub
                || null;
            if (solicitanteId) {
                const solicitante = await personaService.getById(solicitanteId).catch(() => null);
                if (!solicitante || !personaPuede(solicitante, await tenantSafe(tenantId), PERMISSIONS.PERSONA_DESVINCULAR)) {
                    return error('No tienes permiso para desvincular personas de la empresa', 403);
                }
            }

            const persona = await personaService.getById(personaId);
            if (!persona) return error('Persona no encontrada', 404);
            if (normalizeRol(persona.rol) === 'admin') {
                return error('No se puede desvincular al administrador de la empresa', 400);
            }

            await personaService.eliminar(tenantId, personaId, solicitanteId);
            await tenantService.ajustarCantidadTrabajadores(tenantId, -1).catch((countErr) => {
                console.error('No se pudo actualizar la cantidad de trabajadores del tenant (desvinculación):', countErr.message);
            });

            return success({ message: 'Persona desvinculada de la empresa', personaId });
        }

        // POST /personas/{id}/asignaciones — Asigna/actualiza cargos del trabajador
        // en una obra (multi-cargo). Dispara onboarding por obra si la asignación es
        // nueva. Body: { obraId, cargos: string[], solicitanteId? }
        if (method === 'POST' && personaId && action === 'asignaciones' && !segments[2]) {
            if (!tenantId) return error('tenantId es requerido');
            const body = JSON.parse(event.body || '{}');
            if (!body.obraId) return error('obraId es requerido');
            const cargos = Array.isArray(body.cargos) ? body.cargos : (body.cargo ? [body.cargo] : []);
            const { persona, esNueva } = await personaService.setAsignacionObra(tenantId, personaId, body.obraId, cargos);

            try {
                if (esNueva && normalizeRol(persona.rol) !== 'admin') {
                    const solicitanteId = body.solicitanteId || event.requestContext?.authorizer?.claims?.sub || null;
                    const solicitante = solicitanteId ? await personaService.getById(solicitanteId) : null;
                    await runOnboardingForObra({ tenantId, obraId: body.obraId, persona, solicitante });
                }
            } catch (onboardingError) {
                console.error('Error creating onboarding tasks (asignación):', onboardingError);
            }

            return success({ message: 'Asignación guardada', persona: persona.toSafeFormat() });
        }

        // DELETE /personas/{id}/asignaciones/{obraId} — Quita al trabajador de una obra.
        if (method === 'DELETE' && personaId && action === 'asignaciones' && segments[2]) {
            if (!tenantId) return error('tenantId es requerido');
            const obraIdQuitar = segments[2];
            const persona = await personaService.quitarDeObra(tenantId, personaId, obraIdQuitar);

            // Consistencia por obra: al sacar a la persona de la obra, sus documentos
            // de onboarding de ESA obra se archivan (no se borran: preservan firmas y
            // auditoría). Si se la reasigna luego, runOnboardingForObra los reactiva.
            try {
                const docs = await getOnboardingDocsForPersonaObra(tenantId, obraIdQuitar, personaId);
                for (const d of docs) {
                    if (d.estado !== 'archivado') {
                        await setOnboardingDocEstado(d.documentId, 'archivado').catch(() => {});
                    }
                }
            } catch (archErr) {
                console.error('No se pudieron archivar documentos de onboarding al desasignar:', archErr.message);
            }

            return success({ message: 'Asignación eliminada', persona: persona.toSafeFormat() });
        }

        // POST /personas/{id}/evidencias — Registra evidencia persona-level con
        // vigencia (examen altura, SPDC…), reutilizable entre obras.
        // Body: { tipo, fileKey?, nombre?, emitidoEn?, venceEn?, origenObraId? }
        if (method === 'POST' && personaId && action === 'evidencias') {
            if (!tenantId) return error('tenantId es requerido');
            const body = JSON.parse(event.body || '{}');
            if (!body.tipo) return error('tipo es requerido');
            const persona = await personaService.addEvidencia(tenantId, personaId, body);
            return success({ message: 'Evidencia registrada', persona: persona.toSafeFormat() });
        }

        // GET /personas/{id}/historial-epp — Historial dinamico de entregas EPP (Art. 13)
        if (method === 'GET' && personaId && action === 'historial-epp') {
            if (!tenantId) return error('tenantId es requerido');
            const historial = await eppService.getHistorial({ tenantId, personaId });
            return success(historial);
        }

        // POST /personas/{id}/epp — Crear entrega/reposicion de EPP (solo instancia superior)
        if (method === 'POST' && personaId && action === 'epp' && !segments[2]) {
            if (!tenantId) return error('tenantId es requerido');
            const body = JSON.parse(event.body || '{}');
            if (!body.creadorId) return error('creadorId es requerido');

            const creador = await personaService.getById(body.creadorId);
            if (!creador) return error('Creador no encontrado', 404);
            if (!personaPuede(creador, await tenantSafe(creador.tenantId), PERMISSIONS.PERSONA_EPP)) {
                return error('No tienes permiso para registrar entregas de EPP', 403);
            }
            const persona = await personaService.getById(personaId);
            if (!persona) return error('Trabajador no encontrado', 404);

            const entrega = await eppService.crearEntrega({
                tenantId,
                obraId: body.obraId || null,
                persona,
                creador,
                itemsEntregados: body.itemsEntregados,
                esReposicion: body.esReposicion,
                motivoReposicion: body.motivoReposicion,
                capacitacion: body.capacitacion
            });
            return created({ message: 'Entrega de EPP registrada (pendiente de validacion)', entrega });
        }

        // POST /personas/{id}/epp/validar — Validar entrega (instancia superior)
        if (method === 'POST' && personaId && action === 'epp' && segments[2] === 'validar') {
            if (!tenantId) return error('tenantId es requerido');
            const body = JSON.parse(event.body || '{}');
            if (!body.entregaDocumentId) return error('entregaDocumentId es requerido');
            if (!body.validadorId) return error('validadorId es requerido');

            const validador = await personaService.getById(body.validadorId);
            if (!validador) return error('Validador no encontrado', 404);

            const entrega = await eppService.validarEntrega({
                entregaDocumentId: body.entregaDocumentId,
                validador,
                observacion: body.observacion || null,
                tenant: await tenantSafe(validador.tenantId)
            });
            return success({ message: 'Entrega de EPP validada', entrega });
        }

        // POST /personas/{id}/set-pin — Configurar PIN
        if (method === 'POST' && personaId && action === 'set-pin') {
            if (!tenantId) return error('tenantId es requerido');
            const body = JSON.parse(event.body || '{}');
            const result = await personaService.setPin(tenantId, personaId, body.pin, body.pinActual);
            return success(result);
        }

        // POST /personas/{id}/enrolamiento — Completar enrolamiento
        if (method === 'POST' && personaId && action === 'enrolamiento') {
            if (!tenantId) return error('tenantId es requerido');
            const body = JSON.parse(event.body || '{}');
            const result = await personaService.completarEnrolamiento(
                tenantId, personaId, body.pin, event
            );
            return success(result);
        }

        // POST /personas/{id}/reset-password — Resetear contraseña
        if (method === 'POST' && personaId && action === 'reset-password') {
            if (!tenantId) return error('tenantId es requerido');
            const result = await personaService.resetPassword(tenantId, personaId);
            return success(result);
        }

        return error('Ruta no encontrada', 404);
    } catch (err) {
        console.error('Error in personas handler:', err);
        return error(err.message, 500);
    }
};
