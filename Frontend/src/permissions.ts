/**
 * Catálogo único de permisos de la plataforma.
 *
 * Cada permiso gobierna la visibilidad de un módulo (sidebar/ruta) o de una
 * acción concreta (botón). El rol "admin" siempre tiene todos los permisos
 * (bypass en AuthContext.hasPermission y en el backend).
 *
 * Debe mantenerse sincronizado con Backend/lib/permissions.js.
 */

export const PERMISSIONS = {
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
    PERSONA_DESVINCULAR: 'persona.desvincular',
    // Repositorio de archivos
    REPOSITORIO_VER: 'repositorio.ver',
    REPOSITORIO_SUBIR: 'repositorio.subir',
    // Firma electrónica
    FIRMAS_CREAR: 'firmas.crear',
    // Incidentes
    INCIDENTES_ESTADISTICAS: 'incidentes.estadisticas',
    INCIDENTES_HISTORIAL: 'incidentes.historial',
    INCIDENTES_REPORTAR: 'incidentes.reportar',
    INCIDENTES_CALIFICAR_ACCIDENTE: 'incidentes.calificar_accidente',
    // Encuestas
    ENCUESTAS_CREAR: 'encuestas.crear',
    // Actividades
    ACTIVIDADES_VER: 'actividades.ver',
    ACTIVIDADES_CREAR: 'actividades.crear',
    // Armar el esqueleto de planificación mensual (genera borradores por rango).
    // Delegable por tenant a otros roles (ej. Comité Paritario) desde Mi Empresa.
    ACTIVIDADES_PLANIFICAR: 'actividades.planificar',
    // Cargos de onboarding (catálogo de cargos + kits DS44, nivel empresa)
    CARGOS_GESTIONAR: 'cargos.gestionar',
    // Mi Empresa (configuración de la empresa: roles, cargos e identidad)
    EMPRESA_VER: 'empresa.ver',
    EMPRESA_ROLES: 'empresa.roles',
    EMPRESA_CARGOS: 'empresa.cargos',
    EMPRESA_EPP: 'empresa.epp',
    EMPRESA_IDENTIDAD: 'empresa.identidad',
} as const;

export type PermissionKey = typeof PERMISSIONS[keyof typeof PERMISSIONS];

/**
 * Grupos de permisos con etiquetas legibles (selector del onboarding y de
 * Mi Empresa). El nombre del grupo ya da el contexto, así que la etiqueta de
 * cada permiso nombra solo la acción; `nota` aclara un matiz que no cabe en
 * la etiqueta.
 */
export interface PermissionGroup {
    grupo: string;
    permisos: { key: PermissionKey; label: string; nota?: string }[];
}

export const PERMISSION_GROUPS: PermissionGroup[] = [
    {
        grupo: 'Obras',
        permisos: [
            { key: PERMISSIONS.OBRAS_VER, label: 'Ver obras' },
            { key: PERMISSIONS.OBRAS_CREAR, label: 'Crear obra' },
            { key: PERMISSIONS.OBRAS_DETALLE, label: 'Ver detalle' },
            { key: PERMISSIONS.OBRA_ASIGNAR_TRABAJADORES, label: 'Asignar trabajadores' },
            { key: PERMISSIONS.OBRA_SUBIR_DOCUMENTOS, label: 'Subir documentos de fase' },
            { key: PERMISSIONS.OBRA_FIRMA_ASISTIDA, label: 'Firma asistida' },
            { key: PERMISSIONS.CARGOS_GESTIONAR, label: 'Gestionar cargos y kits' },
        ],
    },
    {
        grupo: 'Personas',
        permisos: [
            { key: PERMISSIONS.PERSONAS_VER, label: 'Ver personas' },
            { key: PERMISSIONS.PERSONAS_CREAR, label: 'Añadir personas', nota: 'Incluye la carga masiva desde planilla.' },
            { key: PERMISSIONS.PERSONAS_DETALLE, label: 'Ver detalle' },
            { key: PERMISSIONS.PERSONA_EXPORTAR, label: 'Exportar reporte' },
            { key: PERMISSIONS.PERSONA_ONBOARDING, label: 'Actualizar onboarding' },
            { key: PERMISSIONS.PERSONA_EPP, label: 'Registrar entregas de EPP' },
            { key: PERMISSIONS.PERSONA_VIGILANCIA_SALUD, label: 'Editar vigilancia de salud' },
            { key: PERMISSIONS.PERSONA_DESVINCULAR, label: 'Desvincular persona' },
        ],
    },
    {
        grupo: 'Repositorio',
        permisos: [
            { key: PERMISSIONS.REPOSITORIO_VER, label: 'Ver archivos' },
            { key: PERMISSIONS.REPOSITORIO_SUBIR, label: 'Subir documento' },
        ],
    },
    {
        grupo: 'Firma electrónica',
        permisos: [
            { key: PERMISSIONS.FIRMAS_CREAR, label: 'Crear solicitud de firma' },
        ],
    },
    {
        grupo: 'Incidentes',
        permisos: [
            { key: PERMISSIONS.INCIDENTES_ESTADISTICAS, label: 'Ver estadísticas' },
            { key: PERMISSIONS.INCIDENTES_HISTORIAL, label: 'Ver historial' },
            { key: PERMISSIONS.INCIDENTES_REPORTAR, label: 'Reportar incidente', nota: 'Reportar un hallazgo está siempre permitido.' },
            { key: PERMISSIONS.INCIDENTES_CALIFICAR_ACCIDENTE, label: 'Calificar accidente' },
        ],
    },
    {
        grupo: 'Encuestas',
        permisos: [
            { key: PERMISSIONS.ENCUESTAS_CREAR, label: 'Crear encuesta' },
        ],
    },
    {
        grupo: 'Actividades',
        permisos: [
            { key: PERMISSIONS.ACTIVIDADES_VER, label: 'Ver actividades' },
            { key: PERMISSIONS.ACTIVIDADES_CREAR, label: 'Crear actividad' },
            { key: PERMISSIONS.ACTIVIDADES_PLANIFICAR, label: 'Planificar el mes', nota: 'Genera el esqueleto de actividades del mes en borrador.' },
        ],
    },
    {
        grupo: 'Mi Empresa',
        permisos: [
            { key: PERMISSIONS.EMPRESA_VER, label: 'Ver Mi Empresa' },
            { key: PERMISSIONS.EMPRESA_ROLES, label: 'Gestionar roles y permisos' },
            { key: PERMISSIONS.EMPRESA_CARGOS, label: 'Gestionar cargos' },
            { key: PERMISSIONS.EMPRESA_EPP, label: 'Gestionar catálogo de EPP' },
            { key: PERMISSIONS.EMPRESA_IDENTIDAD, label: 'Configurar identidad' },
        ],
    },
];

/** Todas las claves de permiso (alcance del rol admin). */
export const ALL_PERMISSION_KEYS: PermissionKey[] = Object.values(PERMISSIONS);

/**
 * Presets por defecto para los roles precargados. Editables en el onboarding.
 * Reproducen el alcance histórico de cada rol del sistema.
 */
export const DEFAULT_ROLE_PRESETS: Record<string, PermissionKey[]> = {
    admin: ALL_PERMISSION_KEYS,
    jefe_obra: [
        PERMISSIONS.OBRAS_VER, PERMISSIONS.OBRAS_CREAR, PERMISSIONS.OBRAS_DETALLE,
        PERMISSIONS.OBRA_ASIGNAR_TRABAJADORES, PERMISSIONS.OBRA_SUBIR_DOCUMENTOS, PERMISSIONS.OBRA_FIRMA_ASISTIDA,
        PERMISSIONS.PERSONAS_VER, PERMISSIONS.PERSONAS_CREAR, PERMISSIONS.PERSONAS_DETALLE,
        PERMISSIONS.PERSONA_EXPORTAR, PERMISSIONS.PERSONA_ONBOARDING, PERMISSIONS.PERSONA_EPP, PERMISSIONS.PERSONA_VIGILANCIA_SALUD,
        PERMISSIONS.PERSONA_DESVINCULAR,
        PERMISSIONS.REPOSITORIO_VER, PERMISSIONS.REPOSITORIO_SUBIR,
        PERMISSIONS.FIRMAS_CREAR,
        PERMISSIONS.INCIDENTES_ESTADISTICAS, PERMISSIONS.INCIDENTES_HISTORIAL, PERMISSIONS.INCIDENTES_REPORTAR,
        PERMISSIONS.INCIDENTES_CALIFICAR_ACCIDENTE,
        PERMISSIONS.ENCUESTAS_CREAR,
        PERMISSIONS.ACTIVIDADES_VER, PERMISSIONS.ACTIVIDADES_CREAR, PERMISSIONS.ACTIVIDADES_PLANIFICAR,
        PERMISSIONS.CARGOS_GESTIONAR, PERMISSIONS.EMPRESA_EPP,
    ],
    prevencionista: [
        PERMISSIONS.OBRAS_VER, PERMISSIONS.OBRAS_DETALLE,
        PERMISSIONS.OBRA_SUBIR_DOCUMENTOS, PERMISSIONS.OBRA_FIRMA_ASISTIDA,
        PERMISSIONS.PERSONAS_VER, PERMISSIONS.PERSONAS_DETALLE,
        PERMISSIONS.PERSONA_ONBOARDING, PERMISSIONS.PERSONA_EPP, PERMISSIONS.PERSONA_VIGILANCIA_SALUD,
        PERMISSIONS.REPOSITORIO_VER, PERMISSIONS.REPOSITORIO_SUBIR,
        PERMISSIONS.FIRMAS_CREAR,
        PERMISSIONS.INCIDENTES_ESTADISTICAS, PERMISSIONS.INCIDENTES_HISTORIAL, PERMISSIONS.INCIDENTES_REPORTAR,
        PERMISSIONS.INCIDENTES_CALIFICAR_ACCIDENTE,
        PERMISSIONS.ENCUESTAS_CREAR,
        PERMISSIONS.ACTIVIDADES_VER, PERMISSIONS.ACTIVIDADES_CREAR, PERMISSIONS.ACTIVIDADES_PLANIFICAR,
        // El prevencionista es quien responde por los respaldos DS44 del EPP.
        PERMISSIONS.EMPRESA_EPP,
    ],
    supervisor: [
        PERMISSIONS.OBRAS_VER, PERMISSIONS.OBRAS_DETALLE,
        PERMISSIONS.OBRA_ASIGNAR_TRABAJADORES, PERMISSIONS.OBRA_FIRMA_ASISTIDA,
        PERMISSIONS.PERSONAS_VER, PERMISSIONS.PERSONAS_DETALLE,
        PERMISSIONS.REPOSITORIO_VER,
        PERMISSIONS.FIRMAS_CREAR,
        PERMISSIONS.INCIDENTES_ESTADISTICAS, PERMISSIONS.INCIDENTES_HISTORIAL, PERMISSIONS.INCIDENTES_REPORTAR,
        // El supervisor puede crear sus propias actividades (trabaja solo o tiene
        // tareas adicionales no asignadas por la planificación).
        PERMISSIONS.ACTIVIDADES_VER, PERMISSIONS.ACTIVIDADES_CREAR,
    ],
    // Acceso mínimo para ver/firmar lo asignado. Documentos, encuestas y "mis
    // firmas" no requieren permiso; las páginas filtran a sus ítems asignados.
    colaborador: [
        PERMISSIONS.ACTIVIDADES_VER,
    ],
    trabajador: [
        PERMISSIONS.ACTIVIDADES_VER,
    ],
};
