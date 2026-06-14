/**
 * Catálogo único de permisos (espejo de Frontend/src/permissions.ts).
 *
 * Gobierna la autorización por permiso en los handlers. El rol "admin" siempre
 * tiene todos los permisos. La resolución es dinámica: se calcula desde la
 * definición de rol del tenant en cada login/me.
 */

const { normalizeRol } = require('./utils/validation');

const PERMISSIONS = {
    // Obras
    OBRAS_VER: 'obras.ver',
    OBRAS_CREAR: 'obras.crear',
    OBRAS_DETALLE: 'obras.detalle',
    // Detalle de obra
    OBRA_ASIGNAR_TRABAJADORES: 'obra.asignar_trabajadores',
    OBRA_SUBIR_DOCUMENTOS: 'obra.subir_documentos',
    OBRA_FIRMA_ASISTIDA: 'obra.firma_asistida',
    // Personas
    PERSONAS_VER: 'personas.ver',
    PERSONAS_CREAR: 'personas.crear',
    PERSONAS_DETALLE: 'personas.detalle',
    // Detalle de persona
    PERSONA_EXPORTAR: 'persona.exportar',
    PERSONA_ONBOARDING: 'persona.onboarding',
    PERSONA_EPP: 'persona.epp',
    PERSONA_VIGILANCIA_SALUD: 'persona.vigilancia_salud',
    // Repositorio
    REPOSITORIO_VER: 'repositorio.ver',
    REPOSITORIO_SUBIR: 'repositorio.subir',
    // Firma electrónica
    FIRMAS_CREAR: 'firmas.crear',
    // Incidentes
    INCIDENTES_ESTADISTICAS: 'incidentes.estadisticas',
    INCIDENTES_HISTORIAL: 'incidentes.historial',
    INCIDENTES_REPORTAR: 'incidentes.reportar',
    // Encuestas
    ENCUESTAS_CREAR: 'encuestas.crear',
    // Asistente IA
    IA_VER: 'ia.ver',
    // Actividades
    ACTIVIDADES_VER: 'actividades.ver',
    ACTIVIDADES_CREAR: 'actividades.crear',
    // Documentos
    DOCUMENTOS_VER: 'documentos.ver',
    DOCUMENTOS_SUBIR: 'documentos.subir',
};

const ALL_PERMISSION_KEYS = Object.values(PERMISSIONS);

const DEFAULT_ROLE_PRESETS = {
    admin: ALL_PERMISSION_KEYS,
    jefe_obra: [
        PERMISSIONS.OBRAS_VER, PERMISSIONS.OBRAS_CREAR, PERMISSIONS.OBRAS_DETALLE,
        PERMISSIONS.OBRA_ASIGNAR_TRABAJADORES, PERMISSIONS.OBRA_SUBIR_DOCUMENTOS, PERMISSIONS.OBRA_FIRMA_ASISTIDA,
        PERMISSIONS.PERSONAS_VER, PERMISSIONS.PERSONAS_CREAR, PERMISSIONS.PERSONAS_DETALLE,
        PERMISSIONS.PERSONA_EXPORTAR, PERMISSIONS.PERSONA_ONBOARDING, PERMISSIONS.PERSONA_EPP, PERMISSIONS.PERSONA_VIGILANCIA_SALUD,
        PERMISSIONS.REPOSITORIO_VER, PERMISSIONS.REPOSITORIO_SUBIR,
        PERMISSIONS.FIRMAS_CREAR,
        PERMISSIONS.INCIDENTES_ESTADISTICAS, PERMISSIONS.INCIDENTES_HISTORIAL, PERMISSIONS.INCIDENTES_REPORTAR,
        PERMISSIONS.ENCUESTAS_CREAR,
        PERMISSIONS.IA_VER,
        PERMISSIONS.ACTIVIDADES_VER, PERMISSIONS.ACTIVIDADES_CREAR,
        PERMISSIONS.DOCUMENTOS_VER, PERMISSIONS.DOCUMENTOS_SUBIR,
    ],
    prevencionista: [
        PERMISSIONS.OBRAS_VER, PERMISSIONS.OBRAS_DETALLE,
        PERMISSIONS.OBRA_SUBIR_DOCUMENTOS, PERMISSIONS.OBRA_FIRMA_ASISTIDA,
        PERMISSIONS.PERSONAS_VER, PERMISSIONS.PERSONAS_DETALLE,
        PERMISSIONS.PERSONA_ONBOARDING, PERMISSIONS.PERSONA_EPP, PERMISSIONS.PERSONA_VIGILANCIA_SALUD,
        PERMISSIONS.REPOSITORIO_VER, PERMISSIONS.REPOSITORIO_SUBIR,
        PERMISSIONS.FIRMAS_CREAR,
        PERMISSIONS.INCIDENTES_ESTADISTICAS, PERMISSIONS.INCIDENTES_HISTORIAL, PERMISSIONS.INCIDENTES_REPORTAR,
        PERMISSIONS.ENCUESTAS_CREAR,
        PERMISSIONS.IA_VER,
        PERMISSIONS.ACTIVIDADES_VER, PERMISSIONS.ACTIVIDADES_CREAR,
        PERMISSIONS.DOCUMENTOS_VER, PERMISSIONS.DOCUMENTOS_SUBIR,
    ],
    supervisor: [
        PERMISSIONS.OBRAS_VER, PERMISSIONS.OBRAS_DETALLE,
        PERMISSIONS.OBRA_ASIGNAR_TRABAJADORES, PERMISSIONS.OBRA_FIRMA_ASISTIDA,
        PERMISSIONS.PERSONAS_VER, PERMISSIONS.PERSONAS_DETALLE,
        PERMISSIONS.REPOSITORIO_VER,
        PERMISSIONS.FIRMAS_CREAR,
        PERMISSIONS.INCIDENTES_ESTADISTICAS, PERMISSIONS.INCIDENTES_HISTORIAL, PERMISSIONS.INCIDENTES_REPORTAR,
        PERMISSIONS.ACTIVIDADES_VER,
        PERMISSIONS.DOCUMENTOS_VER,
    ],
    colaborador: [],
    trabajador: [],
};

/**
 * Resuelve los permisos efectivos de una persona según la definición de rol
 * del tenant. Admin → todos. Fallback a presets por defecto.
 * @param {{rol?: string}} persona
 * @param {{roles?: Array<{id?: string, nombre?: string, permisos?: string[]}>}} tenant
 * @returns {string[]}
 */
const resolvePersonaPermisos = (persona, tenant) => {
    if (!persona) return [];
    if (normalizeRol(persona.rol) === 'admin') return [...ALL_PERMISSION_KEYS];

    const roles = Array.isArray(tenant?.roles) ? tenant.roles : [];
    const role = roles.find(
        (r) => r.id === persona.rol || normalizeRol(r.nombre) === normalizeRol(persona.rol)
    );
    if (role && Array.isArray(role.permisos)) return role.permisos;

    return DEFAULT_ROLE_PRESETS[normalizeRol(persona.rol)] || [];
};

/**
 * Verifica si una persona tiene un permiso dado dentro de su tenant.
 * @returns {boolean}
 */
const personaPuede = (persona, tenant, permKey) => {
    if (!persona) return false;
    if (normalizeRol(persona.rol) === 'admin') return true;
    return resolvePersonaPermisos(persona, tenant).includes(permKey);
};

module.exports = {
    PERMISSIONS,
    ALL_PERMISSION_KEYS,
    DEFAULT_ROLE_PRESETS,
    resolvePersonaPermisos,
    personaPuede,
};
