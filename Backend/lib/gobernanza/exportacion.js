/**
 * Exportación de los datos de un titular (derechos de acceso y portabilidad,
 * Ley 21.719). Función pura: recibe la ficha ya descifrada y los registros de
 * la empresa, y arma el documento. `handlers/gobernanza/titular.js` la entrega
 * al propio titular y `handlers/gobernanza/derechos.js` a quien responde una
 * solicitud llegada por otro canal.
 *
 * ── Formato ────────────────────────────────────────────────────────────────
 * JSON con un esquema declarado (`formato` y `version`), claves estables y
 * fechas ISO 8601: estructurado, de uso común y legible por máquinas, que es lo
 * que pide la portabilidad. Cada sección dice qué contiene y con qué finalidad
 * se trata, para que también lo entienda una persona.
 *
 * ── Qué NO entra, aunque esté en la base de datos ──────────────────────────
 * Por LISTA BLANCA: de cada registro se copian solo los campos nombrados acá.
 * Un campo nuevo que alguien agregue a una tabla no aparece en la exportación
 * hasta que se decida que corresponde. En particular:
 *   - Datos de terceros: los nombres, RUT, firmas y respuestas de compañeros
 *     que aparecen en el mismo documento, actividad o encuesta; quién asignó o
 *     quién reportó. De cada registro compartido sale solo lo del titular.
 *   - Información interna: hashes de contraseña y PIN, HMAC del RUT, sobres
 *     cifrados, llaves, contadores de intentos, claves de S3, IP y agente de
 *     usuario de las firmas (metadatos de seguridad del sistema), sesiones.
 *   - Relatos de incidentes: pueden describir a otras personas. Se entrega el
 *     hecho (tipo, fecha, gravedad, obra) y el titular puede pedir el informe
 *     completo por una solicitud formal, que revisa una persona.
 */

const FORMATO = 'buildandserve.datos-titular';
const VERSION = 1;

/** Copia solo los campos permitidos que tengan valor. */
const solo = (obj, campos) => Object.fromEntries(campos
    .filter((c) => obj && obj[c] !== undefined && obj[c] !== null && obj[c] !== '')
    .map((c) => [c, obj[c]]));

const CAMPOS_FICHA = ['personaId', 'rut', 'nombre', 'apellidoPaterno', 'apellidoMaterno', 'fechaNacimiento', 'email', 'telefono',
    'rol', 'cargo', 'estado', 'nivelEscolar', 'cursos', 'createdAt', 'fechaTerminoVinculo', 'ultimoAcceso'];
const CAMPOS_ASIGNACION = ['obraId', 'cargos', 'fechaIngreso', 'fechaEgreso', 'estado', 'motivo'];
const CAMPOS_EVIDENCIA = ['tipo', 'nombre', 'emitidoEn', 'venceEn', 'estado'];
const CAMPOS_REGISTRO = ['titulo', 'tipo', 'tipoDescripcion', 'subtipoDescripcion', 'categoria', 'obraId', 'fecha', 'estado', 'version', 'createdAt'];
const CAMPOS_PROPIOS = ['estado', 'fechaAsignacion', 'fechaLimite', 'fechaFirma', 'firmadoEl', 'fecha', 'metodo', 'atraso', 'asistio', 'respondedAt', 'estamento', 'cargo'];

const idDe = (x) => (typeof x === 'string' ? x : x?.personaId || x?.workerId || null);
const mio = (lista, yo) => (Array.isArray(lista) ? lista.find((x) => idDe(x) === yo) || null : null);

/**
 * @param {object} p
 * @param {object} p.persona  ficha del titular, descifrada (`Persona`), con salud
 * @param {object} p.registros  por tabla del inventario: los ítems de la empresa
 * @param {object[]} p.bandeja  mensajes del titular
 * @param {object[]} p.consentimientos  registros de consentimiento del titular
 * @param {object[]} p.historialConsentimientos  eventos de consentimiento
 * @param {object[]} p.solicitudes  solicitudes de derechos del titular
 * @param {Map<string, object[]>} [p.respuestasEncuestas]  surveyId → respuestas propias ya descifradas
 * @param {Set<string>} [p.incidentesAfectado]  incidentId donde el titular es la persona afectada
 */
function construirExportacion({
    persona, registros = {}, bandeja = [], consentimientos = [], historialConsentimientos = [], solicitudes = [],
    respuestasEncuestas = new Map(), incidentesAfectado = new Set(), ahora = new Date(),
}) {
    const yo = persona.personaId;
    const r = (tabla) => registros[tabla] || [];

    const documentos = r('DOCUMENTS_TABLE')
        .filter((d) => mio(d.asignaciones, yo) || mio(d.firmas, yo))
        .map((d) => ({
            documentId: d.documentId,
            ...solo(d, CAMPOS_REGISTRO),
            miAsignacion: mio(d.asignaciones, yo) ? solo(mio(d.asignaciones, yo), CAMPOS_PROPIOS) : null,
            miFirma: mio(d.firmas, yo) ? solo(mio(d.firmas, yo), CAMPOS_PROPIOS) : null,
        }));

    const firmas = r('SIGNATURES_TABLE')
        .filter((f) => f.personaId === yo && !String(f.signatureId || '').endsWith('#traza'))
        .map((f) => solo(f, ['signatureId', 'tipoFirma', 'tipo', 'metodo', 'fecha', 'createdAt', 'referenciaTipo', 'referenciaId', 'obraId', 'estado']));

    const actividades = r('ACTIVITIES_TABLE')
        .filter((a) => mio(a.asistentes, yo) || (a.asistentesRequeridos || []).includes(yo))
        .map((a) => ({
            activityId: a.activityId,
            ...solo(a, CAMPOS_REGISTRO),
            miAsistencia: mio(a.asistentes, yo) ? solo(mio(a.asistentes, yo), CAMPOS_PROPIOS) : null,
        }));

    const encuestas = r('SURVEYS_TABLE')
        .filter((e) => mio(e.recipients, yo))
        .map((e) => ({
            surveyId: e.surveyId,
            ...solo(e, CAMPOS_REGISTRO),
            miRespuesta: { ...solo(mio(e.recipients, yo), CAMPOS_PROPIOS), respuestas: respuestasEncuestas.get(e.surveyId) || null },
        }));

    const incidentes = r('INCIDENTS_TABLE')
        .filter((i) => !String(i.incidentId || '').endsWith('#traza'))
        .filter((i) => incidentesAfectado.has(i.incidentId) || i.realizadoPor?.personaId === yo)
        .map((i) => ({
            incidentId: i.incidentId,
            ...solo(i, ['tipo', 'fecha', 'gravedad', 'diasPerdidos', 'obraId', 'estado']),
            participacion: incidentesAfectado.has(i.incidentId) ? 'persona afectada' : 'reportado por ti',
        }));

    const ausencias = r('AUSENCIAS_TABLE')
        .filter((a) => a.personaId === yo)
        .map((a) => solo(a, ['tipo', 'desde', 'hasta', 'fechaInicio', 'fechaFin', 'observacion', 'createdAt']));

    const estructura = r('ESTRUCTURA_TABLE')
        .filter((e) => e.personaId === yo || mio(e.miembros, yo))
        .map((e) => ({ ...solo(e, ['tipo', 'organoId', 'nombreOrgano', 'obraId', 'createdAt']), miParticipacion: solo(mio(e.miembros, yo) || e, CAMPOS_PROPIOS) }));

    const sugerencias = r('SUGGESTIONS_TABLE')
        .filter((g) => g.userId === yo)
        .map((g) => solo(g, ['suggestionId', 'texto', 'mensaje', 'categoria', 'createdAt']));

    return {
        formato: FORMATO,
        version: VERSION,
        generadoEl: ahora.toISOString(),
        responsable: 'Tu empleador, que es el responsable del tratamiento. Build & Serve es el encargado.',
        nota: 'Incluye los datos que el sistema guarda sobre ti. No incluye datos de otras personas que aparecen en los mismos '
            + 'registros ni información interna de seguridad (hashes de credenciales, direcciones IP, llaves). Si necesitas un '
            + 'informe de incidente completo, solicítalo como solicitud de acceso.',
        secciones: {
            ficha: {
                finalidad: 'Identificarte, asignarte a obras y acreditar tu incorporación (DS 44).',
                datos: {
                    ...solo(persona, CAMPOS_FICHA),
                    contactoEmergencia: persona.contactoEmergencia && Object.values(persona.contactoEmergencia).some(Boolean) ? persona.contactoEmergencia : null,
                    fotoPerfil: persona.fotoPerfil ? 'Tienes una foto de perfil guardada.' : null,
                    asignaciones: (persona.asignaciones || []).map((a) => solo(a, CAMPOS_ASIGNACION)),
                    historialAsignaciones: (persona.historialAsignaciones || []).map((a) => solo(a, CAMPOS_ASIGNACION)),
                    evidencias: (persona.evidencias || []).map((e) => solo(e, CAMPOS_EVIDENCIA)),
                    pinConfigurado: Boolean(persona._pinHash || persona.pinConfigurado),
                },
            },
            saludOcupacional: {
                finalidad: 'Vigilancia de salud ocupacional y restricciones laborales (DS 44, arts. 67 a 69).',
                datos: { vigilanciaSalud: persona.vigilanciaSalud || null, restriccionLaboral: persona.restriccionLaboral || null },
            },
            documentos: { finalidad: 'Acreditar la entrega y firma de documentación preventiva (DS 44).', datos: documentos },
            firmas: { finalidad: 'Prueba de tu firma electrónica simple.', datos: firmas },
            actividades: { finalidad: 'Acreditar capacitaciones y charlas a las que asististe.', datos: actividades },
            encuestas: { finalidad: 'Encuestas del programa preventivo y la Ficha Básica de Salud (esta última, con tu consentimiento).', datos: encuestas },
            incidentes: { finalidad: 'Registro de accidentes e incidentes (Ley 16.744 y DS 44).', datos: incidentes },
            ausencias: { finalidad: 'Justificar inasistencias a actividades exigidas.', datos: ausencias },
            estructuraPreventiva: { finalidad: 'Acreditar tu participación en comités y otros órganos preventivos.', datos: estructura },
            bandeja: {
                finalidad: 'Comunicación dentro de la plataforma.',
                datos: (bandeja || []).map((m) => ({ ...solo(m, ['messageId', 'subject', 'content', 'type', 'createdAt', 'read']), de: m.senderId === 'system' || m.senderId === 'sistema' ? 'sistema' : 'otra persona' })),
            },
            sugerencias: { finalidad: 'Mejorar la plataforma.', datos: sugerencias },
            consentimientos: {
                finalidad: 'Registro de lo que autorizaste y revocaste.',
                datos: (consentimientos || []).map((c) => solo(c, ['finalidad', 'version', 'estado', 'canal', 'otorgadoEl', 'revocadoEl'])),
                historial: (historialConsentimientos || []).map((h) => ({ tipo: h.tipo, en: h.en, ...solo(h.datos || {}, ['finalidad', 'version']) })),
            },
            solicitudes: {
                finalidad: 'Tus solicitudes de acceso, rectificación, supresión y oposición.',
                datos: (solicitudes || []).map((s) => ({
                    ...solo(s, ['solicitudId', 'derecho', 'canal', 'recibidaEl', 'venceEl', 'estado']),
                    respuesta: s.respuesta ? solo(s.respuesta, ['resultado', 'fundamento', 'respondidaEl']) : null,
                })),
            },
        },
    };
}

module.exports = { construirExportacion, FORMATO, VERSION };
