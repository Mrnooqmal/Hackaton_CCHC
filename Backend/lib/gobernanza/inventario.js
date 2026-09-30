/**
 * Inventario de datos personales: qué se guarda de cada persona, dónde, para qué
 * y qué pasa con ello al vencer su plazo o si pide suprimirlo.
 *
 * Es la fuente única de dos cosas que no pueden divergir:
 *   - el proceso de retención (`lib/gobernanza/retencion.js`) recorre ESTAS
 *     fuentes para saber qué registros son de quién;
 *   - el registro de tratamientos (Ley 21.719, punto 7.3 del documento de
 *     gobernanza) se genera desde acá (`node scripts/registro-tratamientos.js`).
 * Una prueba (`tests/inventario-datos.test.js`) exige que toda tabla de
 * `serverless.yml` esté en el inventario: una tabla nueva sin clasificar hace
 * fallar la build.
 *
 * ── Clases ────────────────────────────────────────────────────────────────
 *
 *   EVIDENCIA     acredita cumplimiento del DS 44 u obligaciones laborales:
 *                 se conserva hasta 5 años desde el término del vínculo (D-2),
 *                 y le gana a una solicitud de supresión mientras no venza.
 *   CONVENIENCIA  se recogió para comodidad de uso, no para acreditar nada:
 *                 se suprime a solicitud del titular, sin esperar el plazo.
 *   `contieneSalud`: la tabla puede traer datos de salud (vigilancia, exámenes,
 *   la ficha de salud, licencias médicas, lesiones de un accidente). Lo usa el
 *   informe de brecha para decir si hubo salud expuesta.
 *
 *   OPERACIONAL   existe para que el sistema funcione (sesiones, vales,
 *                 licencias de alta): vence solo, por TTL o por uso.
 *
 * ── Al vencer el plazo (decisión del 28 de septiembre de 2026) ────────────
 *
 *   SUPRIMIR      el registro se borra.
 *   ANONIMIZAR    se quitan los datos de la persona y se conserva el resto:
 *                 los incidentes, para no perder los indicadores históricos de
 *                 accidentabilidad.
 *   GRUPAL        el registro involucra a varias personas (acta, actividad,
 *                 documento con varios firmantes): se conserva COMPLETO hasta
 *                 que vence el plazo del último involucrado, y entonces se
 *                 suprime.
 *   EMPRESA       no pertenece a una persona sino a la empresa: no vence por
 *                 personas. Queda fuera del proceso.
 */

const CLASE = { EVIDENCIA: 'evidencia', CONVENIENCIA: 'conveniencia', OPERACIONAL: 'operacional' };
const AL_VENCER = { SUPRIMIR: 'suprimir', ANONIMIZAR: 'anonimizar', GRUPAL: 'grupal', EMPRESA: 'empresa', TTL: 'ttl' };

const ids = (lista, campo = 'personaId') => (Array.isArray(lista) ? lista.map((x) => x?.[campo]).filter(Boolean) : []);
const uno = (v) => (v ? [v] : []);

/**
 * Cada fuente dice, para un ítem de su tabla, qué personas involucra
 * (`personasDe`) y qué archivos de S3 referencia (`archivosDe`).
 */
const FUENTES = [
    {
        tabla: 'PERSONAS_TABLE',
        contieneSalud: true,
        claves: ['PK', 'SK'],
        nombre: 'Ficha de la persona',
        datos: 'RUT (cifrado), nombre, fecha de nacimiento, correo, teléfono, foto, cargo, asignaciones a obras, nivel escolar, cursos, contacto de emergencia, vigilancia de salud y restricción laboral (cifradas), credenciales (hash), historial del PIN, enrolamiento.',
        finalidad: 'Identificar a la persona trabajadora, asignarla a obras, acreditar su onboarding DS 44 y permitirle firmar.',
        clase: CLASE.EVIDENCIA,
        alVencer: AL_VENCER.SUPRIMIR,
        // Suprimibles a solicitud sin esperar el plazo: no acreditan cumplimiento.
        camposConveniencia: ['fotoPerfil', 'telefono', 'contactoEmergencia', 'preferencias', 'nivelEscolar'],
        personasDe: (it) => uno(it.personaId),
        archivosDe: (it) => ids(it.evidencias, 'fileKey'),
    },
    {
        tabla: 'DOCUMENTS_TABLE',
        contieneSalud: true,
        claves: ['documentId'],
        nombre: 'Documentos, asignaciones y firmas',
        datos: 'Documentos de onboarding, procedimientos, entregas de EPP; a quién se asignaron, quién firmó (nombre, RUT e IP cifrados), difusiones, versiones anteriores con sus firmas.',
        finalidad: 'Acreditar la entrega, difusión y firma de la documentación exigida por el DS 44.',
        clase: CLASE.EVIDENCIA,
        alVencer: AL_VENCER.GRUPAL,
        personasDe: (it) => [
            ...ids(it.asignaciones), ...ids(it.firmas), ...uno(it.firmaRelator?.personaId), ...uno(it.relatorId),
            ...(Array.isArray(it.versiones) ? it.versiones.flatMap((v) => [...ids(v.firmasArchivadas), ...ids(v.asignacionesArchivadas)]) : []),
        ],
        archivosDe: (it) => [
            ...uno(it.s3Key), ...uno(it.archivoUrl && !/^https?:/.test(it.archivoUrl) ? it.archivoUrl : null),
            ...(Array.isArray(it.versiones) ? it.versiones.map((v) => v.s3Key).filter(Boolean) : []),
        ],
    },
    {
        tabla: 'SIGNATURES_TABLE',
        contieneSalud: false,
        claves: ['signatureId'],
        // RUT, IP y agente de usuario viven aparte, en `<id>#traza` (lib/traza-sensible.js):
        // sin tenantId, fuera de todo índice. Suprimir la firma es suprimir también eso.
        traza: 'signatureId',
        nombre: 'Registro de firmas',
        datos: 'Quién firmó qué, cuándo, con qué método (PIN o vale), desde qué IP (cifrada), y los documentos firmados.',
        finalidad: 'Prueba de la firma electrónica simple ante la autoridad.',
        clase: CLASE.EVIDENCIA,
        alVencer: AL_VENCER.SUPRIMIR,
        personasDe: (it) => uno(it.personaId),
        archivosDe: (it) => ids(it.documentosFirmados, 'url').filter((u) => !/^https?:/.test(u)),
    },
    {
        tabla: 'SIGNATURE_REQUESTS_TABLE',
        contieneSalud: false,
        claves: ['requestId'],
        nombre: 'Solicitudes de firma',
        datos: 'Solicitante y trabajadores convocados (nombre, cargo, RUT cifrado), estado de cada firma.',
        finalidad: 'Convocar y seguir las firmas de un documento o actividad.',
        clase: CLASE.EVIDENCIA,
        alVencer: AL_VENCER.GRUPAL,
        personasDe: (it) => [...ids(it.trabajadores), ...uno(it.solicitanteId)],
        archivosDe: (it) => ids(it.documentos, 'url').filter((u) => !/^https?:/.test(u)),
    },
    {
        tabla: 'ACTIVITIES_TABLE',
        contieneSalud: false,
        claves: ['activityId'],
        nombre: 'Actividades preventivas y asistencia',
        datos: 'Relator, responsables y asistentes (nombre, cargo, RUT cifrado, firma, atrasos), planificación y evaluación.',
        finalidad: 'Acreditar capacitaciones, charlas y actividades del programa preventivo.',
        clase: CLASE.EVIDENCIA,
        alVencer: AL_VENCER.GRUPAL,
        personasDe: (it) => [...ids(it.asistentes), ...uno(it.relatorId), ...uno(it.firmaRelator?.personaId),
            ...(Array.isArray(it.responsables) ? it.responsables.map((r) => (typeof r === 'string' ? r : r?.personaId)).filter(Boolean) : [])],
        archivosDe: () => [],
    },
    {
        tabla: 'INCIDENTS_TABLE',
        contieneSalud: true,
        claves: ['incidentId'],
        // RUT, género y cargo de la persona afectada, en `<id>#traza`: anonimizar
        // el incidente es borrar esa traza entera.
        traza: 'incidentId',
        nombre: 'Incidentes, accidentes y hallazgos',
        datos: 'Persona afectada (cifrada), quién reporta e investiga, descripción, gravedad, días perdidos, medidas y evidencia.',
        finalidad: 'Registro de AT/EP e incidentes peligrosos (Arts. 71 a 73) e indicadores de accidentabilidad.',
        clase: CLASE.EVIDENCIA,
        // Se conserva el hecho (tipo, fecha, gravedad, días perdidos, obra) para
        // los indicadores; se quitan los datos de las personas.
        alVencer: AL_VENCER.ANONIMIZAR,
        camposPersonales: ['cifrado', 'trabajadorNombre', 'realizadoPor', 'reportadoPor', 'viewedBy', 'investigaciones', 'descripcion', 'evidencias', 'documentos'],
        // La persona afectada se vincula por `afectadoRutHmac` (el mismo HMAC de su
        // ficha), que el proceso resuelve a personaId con `ctx.personaPorRutHmac`.
        // `reportadoPor` es un nombre, no un id.
        personasDe: (it, ctx = {}) => [...uno(ctx.personaPorRutHmac?.[it.afectadoRutHmac]), ...uno(it.realizadoPor?.personaId),
            ...uno(it.gobernanza?.responsableId), ...ids(it.medidasCorrectivas, 'responsableId')],
        archivosDe: (it) => (Array.isArray(it.evidencias) ? it.evidencias.map((e) => (typeof e === 'string' ? e : e?.key || e?.fileKey)).filter(Boolean) : []),
    },
    {
        tabla: 'SURVEYS_TABLE',
        contieneSalud: true,
        claves: ['surveyId'],
        nombre: 'Encuestas y ficha de salud',
        datos: 'Destinatarios (nombre, cargo, RUT cifrado) y sus respuestas cifradas, incluida la ficha básica de salud.',
        finalidad: 'Encuestas del programa preventivo y la ficha básica de salud que habilita cada empresa.',
        clase: CLASE.EVIDENCIA,
        alVencer: AL_VENCER.GRUPAL,
        personasDe: (it) => [...ids(it.recipients), ...ids(it.recipients, 'workerId')],
        archivosDe: () => [],
    },
    {
        tabla: 'AUSENCIAS_TABLE',
        contieneSalud: true,
        claves: ['tenantId', 'sk'],
        nombre: 'Ausencias',
        datos: 'Permisos, licencias médicas, faltas y vacaciones, con fechas y observación.',
        finalidad: 'Justificar la inasistencia a actividades exigidas.',
        clase: CLASE.EVIDENCIA,
        alVencer: AL_VENCER.SUPRIMIR,
        personasDe: (it) => uno(it.personaId),
        archivosDe: () => [],
    },
    {
        tabla: 'ESTRUCTURA_TABLE',
        contieneSalud: false,
        claves: ['tenantId', 'sk'],
        nombre: 'Estructura preventiva (comités, delegados)',
        datos: 'Integrantes de cada órgano (nombre, estamento, cargo, acreditación) y sus reuniones.',
        finalidad: 'Acreditar la constitución y funcionamiento del Comité Paritario y demás órganos.',
        clase: CLASE.EVIDENCIA,
        alVencer: AL_VENCER.GRUPAL,
        personasDe: (it) => [...uno(it.personaId), ...ids(it.miembros), ...ids(it.asistentes)],
        archivosDe: (it) => [...uno(it.acreditacion?.adjunto?.key || it.acreditacion?.adjunto?.fileKey), ...uno(it.adjunto?.key || it.adjunto?.fileKey)],
    },
    {
        tabla: 'INBOX_TABLE',
        contieneSalud: false,
        claves: ['recipientId', 'messageId'],
        nombre: 'Bandeja de mensajes',
        datos: 'Avisos y mensajes enviados y recibidos por la persona.',
        finalidad: 'Comunicación dentro de la plataforma.',
        clase: CLASE.CONVENIENCIA,
        alVencer: AL_VENCER.SUPRIMIR,
        personasDe: (it) => [...uno(it.recipientId), ...uno(it.senderId !== 'system' && it.senderId !== 'sistema' ? it.senderId : null)],
        archivosDe: () => [],
    },
    {
        tabla: 'SUGGESTIONS_TABLE',
        contieneSalud: false,
        claves: ['suggestionId'],
        nombre: 'Sugerencias',
        datos: 'Nombre de quien sugiere y el texto de la sugerencia.',
        finalidad: 'Mejorar la plataforma.',
        clase: CLASE.CONVENIENCIA,
        alVencer: AL_VENCER.SUPRIMIR,
        personasDe: (it) => uno(it.userId),
        archivosDe: () => [],
    },
    {
        tabla: 'SESSIONS_TABLE',
        contieneSalud: false,
        claves: ['sessionId'],
        nombre: 'Sesiones',
        datos: 'Hash del token de sesión, persona, empresa y vencimiento.',
        finalidad: 'Mantener la sesión iniciada.',
        clase: CLASE.OPERACIONAL,
        alVencer: AL_VENCER.TTL,
        personasDe: (it) => uno(it.personaId),
        archivosDe: () => [],
    },
    {
        tabla: 'VALES_TABLE',
        contieneSalud: false,
        claves: ['valeHash'],
        nombre: 'Vales de firma sin conexión',
        datos: 'Hash del vale, persona, equipo de emisión y de uso.',
        finalidad: 'Firmar sin conexión sin guardar el PIN en el equipo.',
        clase: CLASE.OPERACIONAL,
        alVencer: AL_VENCER.TTL,
        personasDe: (it) => uno(it.personaId),
        archivosDe: () => [],
    },
    {
        tabla: 'LICENCIAS_TABLE',
        contieneSalud: false,
        claves: ['licenciaHash'],
        nombre: 'Licencias de alta de empresa',
        datos: 'Correo del futuro administrador y datos prellenados de la empresa.',
        finalidad: 'Dar de alta una empresa con un enlace de un solo uso.',
        clase: CLASE.OPERACIONAL,
        alVencer: AL_VENCER.TTL,
        personasDe: () => [],
        archivosDe: () => [],
    },
    {
        tabla: 'CARGAS_TABLE',
        contieneSalud: false,
        claves: ['cargaId', 'sk'],
        nombre: 'Cargas masivas de personas',
        datos: 'Quién inició la carga y sus contadores; por fila, los datos de la planilla (RUT, nombre, contacto, obra, supervisor) hasta que la persona se crea, y el motivo si falló.',
        finalidad: 'Crear en segundo plano las personas de una planilla y mostrar su avance y sus filas fallidas.',
        clase: CLASE.OPERACIONAL,
        alVencer: AL_VENCER.TTL,
        personasDe: (it) => uno(it.personaId),
        archivosDe: () => [],
    },
    {
        tabla: 'CORREOS_SUPRIMIDOS_TABLE',
        contieneSalud: false,
        claves: ['correoHmac'],
        nombre: 'Direcciones de correo suprimidas',
        datos: 'HMAC de la dirección (nunca la dirección), motivo (rebote, queja, rechazo), fechas.',
        finalidad: 'No volver a escribir a una dirección que rebotó o se quejó.',
        clase: CLASE.OPERACIONAL,
        alVencer: AL_VENCER.TTL,
        personasDe: () => [],
        archivosDe: () => [],
    },
    {
        tabla: 'TENANTS_TABLE',
        contieneSalud: false,
        claves: ['PK', 'SK'],
        nombre: 'Empresa',
        datos: 'Datos de la empresa; su representante legal (nombre y RUT) y el administrador.',
        finalidad: 'Configurar la empresa en la plataforma.',
        clase: CLASE.EVIDENCIA,
        alVencer: AL_VENCER.EMPRESA,
        personasDe: () => [],
        archivosDe: () => [],
    },
    {
        tabla: 'OBRAS_TABLE',
        contieneSalud: false,
        claves: ['PK', 'SK'],
        nombre: 'Obras',
        datos: 'Datos de la obra; sin datos personales salvo referencias a responsables.',
        finalidad: 'Gestionar las obras y su cumplimiento.',
        clase: CLASE.EVIDENCIA,
        alVencer: AL_VENCER.EMPRESA,
        personasDe: () => [],
        archivosDe: (it) => uno(it.imagenKey),
    },
    {
        tabla: 'EPP_TABLE',
        contieneSalud: false,
        claves: ['tenantId', 'eppId'],
        nombre: 'Catálogo de EPP',
        datos: 'Catálogo de elementos de protección; sin datos personales (las entregas son documentos).',
        finalidad: 'Definir los EPP que entrega la empresa.',
        clase: CLASE.EVIDENCIA,
        alVencer: AL_VENCER.EMPRESA,
        personasDe: () => [],
        archivosDe: () => [],
    },
];

// Sin clase de retención todavía (se agrega con la supresión a solicitud): la
// propia tabla de gobernanza guarda solicitudes, bloqueos y lotes.
const TABLAS_DE_GOBERNANZA = ['GOBERNANZA_TABLE', 'GOBERNANZA_HISTORIAL_TABLE', 'AUDITORIA_ACCESOS_TABLE'];

// La clave primaria de un ítem, para poder suprimirlo o actualizarlo.
for (const f of FUENTES) f.clave = (it) => Object.fromEntries(f.claves.map((k) => [k, it[k]]));

const fuente = (tabla) => FUENTES.find((f) => f.tabla === tabla) || null;

module.exports = { FUENTES, CLASE, AL_VENCER, TABLAS_DE_GOBERNANZA, fuente };
