/**
 * Personas Module - Handler
 * 
 * Identidad unificada: reemplaza /users y /workers.
 * Todas las operaciones filtran por tenantId.
 */
const XLSX = require('xlsx');
const ExcelJS = require('exceljs');
const { v4: uuidv4 } = require('uuid');
const { PutCommand } = require('@aws-sdk/lib-dynamodb');
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
        clasificacion: 'diario',
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

// Genera el onboarding DS44 según el KIT del cargo (catálogo del tenant).
// - Sin cargo → no hay kit (personal de oficina/gestión).
// - ENTREGA_EPP → EppService (Art. 13), matriz del cargo.
// - Ítems con plantilla (tenant del catálogo / obra del MIPER) → doc con archivo
//   pegado (pendiente_firma). Sin plantilla y se esperaba → doc vacío + aviso.
// - Nunca bloquea el registro/vinculación (cada ítem va en su propio try/catch).
const runOnboardingForObra = async ({ tenantId, obraId, persona, solicitante }) => {
    // Solo trabajadores de TERRENO reciben el kit de onboarding DS44. Los roles de
    // gestión/staff (admin, jefe de obra, supervisor, prevencionista, relator) NO
    // pasan por este flujo: evita contaminar el checklist (p.ej. "admin 0/6") y que
    // un rol caiga al kit genérico. Sus documentos base/extras se manejan aparte.
    if (ROLES_GESTION.has(normalizeRol(persona.rol))) return;

    // El cargo vive en la ASIGNACIÓN a esta obra (multi-cargo). Fallback al cargo
    // legacy global por compatibilidad con personas aún no migradas.
    const cargosObra = typeof persona.cargosEnObra === 'function' ? persona.cargosEnObra(obraId) : [];
    const rawCargos = (cargosObra && cargosObra.length) ? cargosObra : (persona.cargo ? [persona.cargo] : []);
    // Normaliza a CÓDIGO del catálogo: "Carpintero" → CARPINTERO (resuelve su kit
    // real de 13 ítems). Sin esto, el texto libre caía SIEMPRE al kit genérico.
    const cargos = [...new Set(rawCargos.map((c) => normalizeCargoCodigo(c)).filter(Boolean))];
    if (cargos.length === 0) return; // sin cargo de terreno → sin kit (oficina/gestión)

    const tenant = await tenantService.getById(tenantId).catch(() => null);
    // Unión de kits de todos los cargos de la persona en la obra (dedup + estricto).
    const kit = resolveKitUnion(tenant?.reglas?.cargos, cargos);
    if (!Array.isArray(kit) || kit.length === 0) return;

    const obra = obraId ? await obraService.getById(obraId).catch(() => null) : null;
    const aplicabilidad = (obra && obra.aplicabilidadKit) || {};       // MIPER manual por obra+cargo
    const plantillasPorCargo = (obra && obra.plantillasOnboarding) || {};

    const faltantes = [];

    for (const item of kit) {
        try {
            const origenes = (item.cargosOrigen && item.cargosOrigen.length) ? item.cargosOrigen : cargos;

            // Aplicabilidad MIPER (manual): se excluye solo si TODOS los cargos de
            // origen lo marcan 'no_aplica' en esta obra (PR-PO excluidos según MIPER).
            const excluido = origenes.every((cg) => aplicabilidad?.[cg]?.[item.key] === 'no_aplica');
            if (excluido) continue;

            // EPP (Art. 13): la entrega física es un acto real (bodega/prevención
            // hace entrega y el trabajador firma recepción). NO se auto-genera al
            // crear la persona: hacerlo simulaba una entrega inexistente y ensuciaba
            // el historial de EPP. El ítem queda PENDIENTE en el checklist DS44 y la
            // entrega se registra cuando efectivamente ocurre (modal "Nueva entrega
            // / Reposición de EPP" en la ficha del trabajador).
            if (item.accion === 'ENTREGA_EPP') {
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

            // Faltante solo si se esperaba plantilla, no hay, y no se reutilizó evidencia.
            if (!plantilla && !evidenciaReuse && (item.alcancePlantilla === 'tenant' || item.alcancePlantilla === 'obra')) {
                faltantes.push(`${item.codigoEbco ? item.codigoEbco + ' · ' : ''}${item.titulo}`);
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

                    // Generar onboarding DS44 para trabajadores creados con obra.
                    // Antes solo se disparaba al asignar obra via PUT; la carga masiva
                    // dejaba trabajadores sin documentos de onboarding (bug demo).
                    if (normalizeRol(persona.rol) === 'trabajador' && Array.isArray(persona.obraIds)) {
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

            // Generar onboarding DS44 si el trabajador se crea ya asignado a obra(s).
            if (normalizeRol(persona.rol) === 'trabajador' && Array.isArray(persona.obraIds) && persona.obraIds.length > 0) {
                const solicitanteId = body.solicitanteId || null;
                const solicitante = solicitanteId ? await personaService.getById(solicitanteId).catch(() => null) : null;
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
                const isWorker = normalizeRol(persona.rol) === 'trabajador';

                if (isWorker && addedObras.length > 0) {
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
                if (esNueva && normalizeRol(persona.rol) === 'trabajador') {
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
            const persona = await personaService.quitarDeObra(tenantId, personaId, segments[2]);
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
