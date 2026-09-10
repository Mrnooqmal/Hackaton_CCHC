/**
 * Resguardo de los documentos con información de salud (DS 44, Arts. 67 y 68).
 *
 * El decreto obliga a mantener la vigilancia de la salud y las autorizaciones de
 * exámenes, pero eso no los vuelve consultables por cualquiera que entre al
 * repositorio: son datos sensibles de una persona identificable, y el repositorio
 * es la pantalla más transitada del sistema.
 *
 * NO se inventa un permiso nuevo: se reutiliza `persona.vigilancia_salud`, que ya
 * gobierna la ficha de vigilancia en el detalle de persona. Dos permisos para la
 * misma pregunta terminan concediendo cosas distintas.
 */

const { PERMISSIONS, personaPuede } = require('./permissions');

/**
 * Tipos que llevan información de salud de alguien en particular.
 *
 * Los registros agregados del Art. 74 (tasas por sexo) NO entran: son
 * estadística, no la salud de nadie identificable, y los ítems 46 y 47 los
 * necesitan visibles para acreditarse.
 */
const TIPOS_SALUD = new Set([
    'VIGILANCIA_SALUD',
    'EXAMEN_OCUPACIONAL',
    'ENCUESTA_SALUD',
    'RESTRICCION_LABORAL',
    'TRASLADO_PUESTO',
]);

const esDocumentoDeSalud = (doc) => TIPOS_SALUD.has(doc?.tipo);

/**
 * ¿Puede esta persona ver este documento de salud?
 *
 * Quien tenga el permiso, y siempre la persona a la que el documento se refiere:
 * ocultarle a alguien su propio examen sería absurdo.
 *
 * Sin solicitante identificado se OCULTA. Es lo contrario a como resuelve el
 * resto del sistema, y es a propósito: si una pantalla olvida identificarse, el
 * error debe ser que falten documentos, nunca que se filtren datos de salud.
 */
function puedeVerSalud(doc, persona, tenantSafe) {
    if (persona && personaPuede(persona, tenantSafe, PERMISSIONS.PERSONA_VIGILANCIA_SALUD)) return true;
    if (!persona?.personaId) return false;
    return (doc?.asignaciones || []).some((a) => a.personaId === persona.personaId)
        || doc?.personaId === persona.personaId;
}

/** Deja fuera del listado los documentos de salud que esta persona no puede ver. */
const filtrarSalud = (documentos, persona, tenantSafe) =>
    (documentos || []).filter((d) => !esDocumentoDeSalud(d) || puedeVerSalud(d, persona, tenantSafe));

module.exports = { TIPOS_SALUD, esDocumentoDeSalud, puedeVerSalud, filtrarSalud };
