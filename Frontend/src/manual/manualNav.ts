// Navegación del manual.
// Es solo data: define las secciones (nav superior) y la sidebar por sección.
// Las rutas son relativas a /manual (el prefijo lo pone <ManualLayout>).

export interface NavItem {
    text: string;
    /** Ruta relativa a /manual, sin barra inicial. '' = portada de la sección. */
    link: string;
    /**
     * Permisos con los que la página aparece en el menú y el buscador (basta con
     * uno). Sin permiso, la ven todos. Ver `filtro.tsx`.
     */
    permiso?: readonly string[];
}

export interface NavSection {
    /** Slug de la sección (primer segmento tras /manual). */
    slug: string;
    /** Título del grupo en la sidebar. */
    text: string;
    /** Texto del enlace en el nav superior. */
    navText: string;
    items: NavItem[];
}

// Ordenado por TAREA, no por módulo (Fase 4, aprobada el 7 de noviembre de
// 2026): lo que hace cualquiera en terreno, lo que se gestiona en la obra, la
// configuración de la empresa, una entrada por rol y la referencia normativa.
// Los permisos de cada página son los de la pantalla que explica.
export const MANUAL_SECTIONS: NavSection[] = [
    {
        slug: 'empezar',
        text: 'Empezar',
        navText: 'Empezar',
        items: [
            { text: 'Qué es Build & Serve', link: 'empezar/' },
            { text: 'Cómo ingresar', link: 'empezar/ingresar' },
            { text: 'Elegir obra y moverte', link: 'empezar/elegir-obra' },
            { text: 'Ayuda en cada pantalla', link: 'empezar/ayuda' },
            { text: 'Tu cuenta', link: 'empezar/mi-cuenta' },
        ],
    },
    {
        slug: 'terreno',
        text: 'En terreno',
        navText: 'En terreno',
        items: [
            { text: 'Firmar lo que te asignaron', link: 'terreno/firmar' },
            { text: 'Responder una encuesta', link: 'terreno/encuestas' },
            { text: 'Reportar un hallazgo o un incidente', link: 'terreno/reportar' },
            { text: 'Avisos y mensajes', link: 'terreno/avisos' },
            { text: 'Tus datos y tu privacidad', link: 'terreno/mis-datos' },
        ],
    },
    {
        slug: 'obra',
        text: 'En la obra',
        navText: 'En la obra',
        items: [
            { text: 'Seguir el cumplimiento del FUF', link: 'obra/cumplimiento', permiso: ['obras.detalle'] },
            { text: 'Programar charlas y capacitaciones', link: 'obra/actividades', permiso: ['actividades.crear', 'actividades.planificar'] },
            { text: 'Registrar la asistencia', link: 'obra/asistencia', permiso: ['actividades.crear'] },
            { text: 'Pedir firmas y firma asistida', link: 'obra/pedir-firmas', permiso: ['firmas.crear', 'obra.firma_asistida'] },
            { text: 'Subir y versionar documentos', link: 'obra/documentos', permiso: ['repositorio.ver'] },
            { text: 'Entregar EPP', link: 'obra/epp', permiso: ['persona.epp', 'empresa.epp'] },
            { text: 'Sumar personas a la obra', link: 'obra/equipo', permiso: ['personas.ver'] },
            { text: 'Gestionar incidentes', link: 'obra/incidentes', permiso: ['incidentes.historial', 'incidentes.estadisticas'] },
            { text: 'Prescripciones', link: 'obra/prescripciones', permiso: ['repositorio.ver'] },
            { text: 'Comité paritario y delegados', link: 'obra/estructura', permiso: ['obras.detalle', 'empresa.ver'] },
            { text: 'Crear encuestas', link: 'obra/encuestas', permiso: ['encuestas.crear'] },
        ],
    },
    {
        slug: 'empresa',
        text: 'Empresa',
        navText: 'Empresa',
        items: [
            { text: 'Mi Empresa', link: 'empresa/', permiso: ['empresa.ver'] },
            { text: 'Roles y permisos', link: 'empresa/roles', permiso: ['empresa.ver'] },
            { text: 'Personas', link: 'empresa/personas', permiso: ['personas.ver'] },
            { text: 'Crear y administrar obras', link: 'empresa/obras', permiso: ['obras.ver', 'obras.detalle'] },
            { text: 'Cargos, kits y catálogos', link: 'empresa/cargos', permiso: ['cargos.gestionar', 'empresa.cargos', 'empresa.epp'] },
            { text: 'Ficha Básica de Salud', link: 'empresa/salud', permiso: ['empresa.ficha_salud'] },
            { text: 'Datos personales', link: 'empresa/datos-personales', permiso: ['empresa.derechos_titulares', 'empresa.supresion_datos'] },
            { text: 'Activar una empresa nueva', link: 'empresa/alta', permiso: ['empresa.ver'] },
        ],
    },
    {
        slug: 'roles',
        text: 'Por rol',
        navText: 'Por rol',
        items: [
            { text: 'Qué hago según mi rol', link: 'roles/' },
            { text: 'Trabajador', link: 'roles/trabajador' },
            { text: 'Supervisor', link: 'roles/supervisor' },
            { text: 'Prevencionista', link: 'roles/prevencionista' },
            { text: 'Jefe de obra', link: 'roles/jefe-obra' },
            { text: 'Administrador', link: 'roles/administrador' },
        ],
    },
    {
        slug: 'fuf',
        text: 'FUF y DS 44',
        navText: 'FUF y DS 44',
        items: [
            { text: 'FUF y DS 44', link: 'fuf/' },
            { text: 'Qué pide el FUF', link: 'fuf/requisitos' },
            { text: 'Capacitaciones (Art. 16)', link: 'fuf/capacitaciones' },
            { text: 'Firmas', link: 'fuf/firmas' },
        ],
    },
];

/** Sección a la que pertenece una ruta relativa (ej. 'ds44/epp' → sección ds44). */
export function sectionForPath(relPath: string): NavSection | undefined {
    const slug = relPath.split('/').filter(Boolean)[0] || '';
    return MANUAL_SECTIONS.find((s) => s.slug === slug);
}

/** Permisos de una página (ruta relativa a /manual), o undefined si la ven todos. */
export function permisoDePagina(relPath: string): readonly string[] | undefined {
    const rel = relPath.replace(/^\/+|\/+$/g, '');
    for (const sec of MANUAL_SECTIONS) {
        for (const it of sec.items) if (it.link.replace(/\/+$/, '') === rel) return it.permiso;
    }
    return undefined;
}
