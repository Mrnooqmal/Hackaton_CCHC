// Navegación del manual — portado de manual-src/.vitepress/config.ts.
// Es solo data: define las secciones (nav superior) y la sidebar por sección.
// Las rutas son relativas a /manual (el prefijo lo pone <ManualLayout>).

export interface NavItem {
    text: string;
    /** Ruta relativa a /manual, sin barra inicial. '' = portada de la sección. */
    link: string;
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

export const MANUAL_SECTIONS: NavSection[] = [
    {
        slug: 'guia-inicio',
        text: 'Guía de Inicio',
        navText: 'Guía de Inicio',
        items: [
            { text: '¿Qué es Build & Serve?', link: 'guia-inicio/' },
            { text: 'Cómo ingresar', link: 'guia-inicio/instalacion' },
            { text: 'Primeros pasos', link: 'guia-inicio/primeros-pasos' },
            { text: 'Registro de una empresa', link: 'guia-inicio/onboarding' },
        ],
    },
    {
        slug: 'ds44',
        text: 'DS44 & Normativa',
        navText: 'DS44',
        items: [
            { text: '¿Qué es el DS 44?', link: 'ds44/' },
            { text: 'Documentos obligatorios', link: 'ds44/documentos-obligatorios' },
            { text: 'Fases de obra', link: 'ds44/fases-obra' },
            { text: 'Entrega de EPP', link: 'ds44/epp' },
            { text: 'Capacitaciones (Art.16)', link: 'ds44/capacitaciones' },
            { text: 'Firmas digitales y DS44', link: 'ds44/firmas-digitales' },
        ],
    },
    {
        slug: 'modulos',
        text: 'Módulos',
        navText: 'Módulos',
        items: [
            { text: 'Resumen de módulos', link: 'modulos/' },
            { text: 'Dashboard', link: 'modulos/dashboard' },
            { text: 'Obras', link: 'modulos/obras' },
            { text: 'Documentos', link: 'modulos/documentos' },
            { text: 'Firmas Digitales', link: 'modulos/firmas' },
            { text: 'Incidentes', link: 'modulos/incidentes' },
            { text: 'Actividades', link: 'modulos/actividades' },
            { text: 'Encuestas', link: 'modulos/encuestas' },
            { text: 'Asistente IA', link: 'modulos/asistente-ia' },
            { text: 'Personas', link: 'modulos/personas' },
            { text: 'Bandeja de Entrada', link: 'modulos/bandeja-entrada' },
            { text: 'Mi Empresa', link: 'modulos/tenants' },
        ],
    },
    {
        slug: 'roles',
        text: 'Roles de Usuario',
        navText: 'Roles',
        items: [
            { text: 'Todos los roles', link: 'roles/' },
            { text: 'Admin', link: 'roles/admin' },
            { text: 'Prevencionista', link: 'roles/prevencionista' },
            { text: 'Jefe de Obra', link: 'roles/jefe-obra' },
            { text: 'Supervisor', link: 'roles/supervisor' },
            { text: 'Trabajador', link: 'roles/trabajador' },
        ],
    },
];

/** Sección a la que pertenece una ruta relativa (ej. 'ds44/epp' → sección ds44). */
export function sectionForPath(relPath: string): NavSection | undefined {
    const slug = relPath.split('/').filter(Boolean)[0] || '';
    return MANUAL_SECTIONS.find((s) => s.slug === slug);
}
