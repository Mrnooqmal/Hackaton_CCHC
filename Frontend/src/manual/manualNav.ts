// Navegación del manual — portado de manual-src/.vitepress/config.ts.
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

export const MANUAL_SECTIONS: NavSection[] = [
    {
        slug: 'guia-inicio',
        text: 'Guía de Inicio',
        navText: 'Guía de Inicio',
        items: [
            { text: '¿Qué es Build & Serve?', link: 'guia-inicio/' },
            { text: 'Cómo ingresar', link: 'guia-inicio/instalacion' },
            { text: 'Primeros pasos', link: 'guia-inicio/primeros-pasos' },
            { text: 'Registro de una empresa', link: 'guia-inicio/onboarding', permiso: ['empresa.ver'] },
        ],
    },
    {
        slug: 'ds44',
        text: 'DS44 & Normativa',
        navText: 'DS44',
        items: [
            { text: '¿Qué es el DS 44?', link: 'ds44/' },
            { text: 'Fases y estados del cumplimiento', link: 'ds44/fases-obra' },
            { text: 'Documentos obligatorios', link: 'ds44/documentos-obligatorios' },
            { text: 'Entrega de EPP', link: 'ds44/epp' },
            { text: 'Capacitaciones (Art. 16)', link: 'ds44/capacitaciones' },
            { text: 'Firmas digitales y DS 44', link: 'ds44/firmas-digitales' },
        ],
    },
    {
        slug: 'modulos',
        text: 'Módulos',
        navText: 'Módulos',
        items: [
            { text: 'Resumen de módulos', link: 'modulos/' },
            { text: 'Inicio', link: 'modulos/dashboard' },
            { text: 'Obras', link: 'modulos/obras', permiso: ['obras.ver', 'obras.detalle'] },
            { text: 'Personas', link: 'modulos/personas', permiso: ['personas.ver'] },
            { text: 'Repositorio', link: 'modulos/documentos', permiso: ['repositorio.ver'] },
            { text: 'Actividades', link: 'modulos/actividades', permiso: ['actividades.ver'] },
            { text: 'Encuestas', link: 'modulos/encuestas' },
            { text: 'Firmas', link: 'modulos/firmas' },
            { text: 'Incidentes', link: 'modulos/incidentes' },
            { text: 'Prescripciones', link: 'modulos/prescripciones', permiso: ['repositorio.ver'] },
            { text: 'Estructura preventiva', link: 'modulos/estructura-preventiva', permiso: ['obras.detalle', 'empresa.ver'] },
            { text: 'Notificaciones', link: 'modulos/bandeja-entrada' },
            { text: 'Mi Empresa', link: 'modulos/tenants', permiso: ['empresa.ver'] },
            { text: 'Onboarding por cargo', link: 'modulos/onboarding-cargos', permiso: ['cargos.gestionar'] },
            { text: 'Catálogos', link: 'modulos/catalogos', permiso: ['cargos.gestionar'] },
            { text: 'Datos personales', link: 'modulos/datos-personales', permiso: ['empresa.derechos_titulares', 'empresa.supresion_datos'] },
            { text: 'Configuración', link: 'modulos/configuracion' },
        ],
    },
    {
        slug: 'roles',
        text: 'Roles de Usuario',
        navText: 'Roles',
        items: [
            { text: 'Todos los roles', link: 'roles/' },
            { text: 'Administrador', link: 'roles/admin' },
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

/** Permisos de una página (ruta relativa a /manual), o undefined si la ven todos. */
export function permisoDePagina(relPath: string): readonly string[] | undefined {
    const rel = relPath.replace(/^\/+|\/+$/g, '');
    for (const sec of MANUAL_SECTIONS) {
        for (const it of sec.items) if (it.link.replace(/\/+$/, '') === rel) return it.permiso;
    }
    return undefined;
}
