// Registro de pantallas y anclas de los recorridos guiados (D-33).
//
// Un recorrido nunca nombra un elemento con texto libre: nombra un ancla de este
// registro, y el componente la marca con `ancla()`. Así, un error de tipeo en un
// recorrido no compila, y un ancla que ningún componente usa hace fallar el
// build (`scripts/verificar-recorridos.mjs`): al rediseñar una pantalla se
// rompe el build, no el recorrido en silencio.
//
// Las claves solo llevan minúsculas, dígitos y guiones, y el motor arma el
// selector desde aquí: ningún texto de un recorrido llega a un selector CSS
// (falla 7).

/**
 * Pantallas con sesión. `ruta` es el patrón de `App.tsx` (el build comprueba que
 * siga existiendo); `null` para lo que no es una ruta. `manual`: la página del
 * manual que abre la ayuda de esa pantalla.
 */
export const PANTALLAS = {
    global: { ruta: null, descripcion: 'Elementos presentes en todas las pantallas (encabezado, menú lateral)' },
    'menu-ayuda': { ruta: null, descripcion: 'Menú de ayuda abierto (lo abre un paso con la acción abrir_ayuda)' },
    inicio: { ruta: '/', descripcion: 'Inicio', manual: 'modulos/dashboard' },
    'seleccion-obra': { ruta: '/seleccionar-obra', descripcion: 'Elegir obra o vista de empresa', manual: 'modulos/obras' },
    personas: { ruta: '/personas', descripcion: 'Personas', manual: 'modulos/personas' },
    'persona-nueva': { ruta: '/personas/nueva', descripcion: 'Agregar persona', manual: 'modulos/personas' },
    'personas-carga-masiva': { ruta: '/personas/carga-masiva', descripcion: 'Carga masiva de personas', manual: 'modulos/personas' },
    'persona-detalle': { ruta: '/personas/:rut', descripcion: 'Ficha de una persona', manual: 'modulos/personas' },
    // Ruta antigua de la ficha, todavía en App.tsx (los enlaces viejos llegan aquí).
    'persona-detalle-legado': { ruta: '/workers/:rut', descripcion: 'Ficha de una persona (ruta antigua)', manual: 'modulos/personas' },
    'enrolar-trabajador': { ruta: '/workers/enroll', descripcion: 'Enrolar trabajador', manual: 'modulos/personas' },
    obras: { ruta: '/obras', descripcion: 'Obras', manual: 'modulos/obras' },
    'obra-nueva': { ruta: '/obras/nueva', descripcion: 'Crear obra', manual: 'modulos/obras' },
    'obra-detalle': { ruta: '/obras/:obraId', descripcion: 'Detalle de una obra', manual: 'modulos/obras' },
    prescripciones: { ruta: '/prescripciones', descripcion: 'Prescripciones', manual: 'modulos/prescripciones' },
    'prescripcion-nueva': { ruta: '/prescripciones/nueva', descripcion: 'Registrar prescripción', manual: 'modulos/prescripciones' },
    'prescripcion-implementar': { ruta: '/prescripciones/:id/implementar', descripcion: 'Implementar prescripción', manual: 'modulos/prescripciones' },
    'estructura-constituir': { ruta: '/estructura/constituir', descripcion: 'Constituir órgano preventivo', manual: 'modulos/estructura-preventiva' },
    'estructura-organo': { ruta: '/estructura/organos/:organoId', descripcion: 'Órgano preventivo', manual: 'modulos/estructura-preventiva' },
    'cargos-onboarding': { ruta: '/cargos-onboarding', descripcion: 'Cargos y kits de incorporación', manual: 'modulos/onboarding-cargos' },
    'catalogos-actividad': { ruta: '/catalogos-actividad', descripcion: 'Catálogos de actividades', manual: 'modulos/catalogos' },
    repositorio: { ruta: '/documents-repository', descripcion: 'Repositorio de documentos', manual: 'modulos/documentos' },
    encuestas: { ruta: '/surveys', descripcion: 'Encuestas', manual: 'modulos/encuestas' },
    'encuesta-nueva': { ruta: '/surveys/nueva', descripcion: 'Crear encuesta', manual: 'modulos/encuestas' },
    'encuesta-detalle': { ruta: '/surveys/:surveyId', descripcion: 'Detalle de encuesta', manual: 'modulos/encuestas' },
    'encuesta-responder': { ruta: '/surveys/:surveyId/responder', descripcion: 'Responder encuesta', manual: 'modulos/encuestas' },
    incidentes: { ruta: '/incidents', descripcion: 'Hallazgos e incidentes', manual: 'modulos/incidentes' },
    'incidente-reportar': { ruta: '/incidents/reportar', descripcion: 'Reportar hallazgo o incidente', manual: 'modulos/incidentes' },
    actividades: { ruta: '/activities', descripcion: 'Actividades', manual: 'modulos/actividades' },
    'actividad-nueva': { ruta: '/activities/nueva', descripcion: 'Crear actividad', manual: 'modulos/actividades' },
    'actividad-planificar': { ruta: '/activities/planificar', descripcion: 'Planificar el mes', manual: 'modulos/actividades' },
    'solicitudes-firma': { ruta: '/signature-requests', descripcion: 'Solicitudes de firma', manual: 'modulos/firmas' },
    'mis-firmas': { ruta: '/my-signatures', descripcion: 'Mis firmas', manual: 'modulos/firmas' },
    bandeja: { ruta: '/inbox', descripcion: 'Bandeja de entrada', manual: 'modulos/bandeja-entrada' },
    'mi-empresa': { ruta: '/mi-empresa', descripcion: 'Mi empresa', manual: 'modulos/tenants' },
    crear: { ruta: '/crear', descripcion: 'Crear (accesos rápidos)' },
    configuracion: { ruta: '/configuracion', descripcion: 'Configuración', manual: 'modulos/configuracion' },
    'mis-datos': { ruta: '/mis-datos', descripcion: 'Mis datos y privacidad', manual: 'modulos/datos-personales' },
    'cambiar-contrasena': { ruta: '/change-password', descripcion: 'Cambiar contraseña', manual: 'modulos/configuracion' },
    enrolamiento: { ruta: '/enroll-me', descripcion: 'Mi enrolamiento', manual: 'guia-inicio/primeros-pasos' },
} as const satisfies Record<string, { ruta: string | null; descripcion: string; manual?: string }>;

export type PantallaKey = keyof typeof PANTALLAS;

/**
 * Anclas por pantalla, con la descripción que ve quien escribe un recorrido.
 * Las de `global` sirven en cualquier pantalla; las de `menu-ayuda`, solo en un
 * paso con la acción `abrir_ayuda`. Se agregan junto con el componente que las
 * marca: registrar una que nadie usa hace fallar el build.
 */
export const ANCLAS = {
    global: {
        'boton-ayuda': 'Botón de ayuda del encabezado',
        'menu-lateral': 'Menú lateral con los módulos',
    },
    'menu-ayuda': {
        recorridos: 'Lista de recorridos de la pantalla, dentro del menú de ayuda',
        manual: 'Enlace al manual de la pantalla, dentro del menú de ayuda',
        novedades: 'Novedades, dentro del menú de ayuda',
    },
} as const satisfies Partial<Record<PantallaKey, Record<string, string>>>;

type Anclas = typeof ANCLAS;
export type AnclaKey = { [P in keyof Anclas]: `${P}.${keyof Anclas[P] & string}` }[keyof Anclas];

/** Pantalla dueña de un ancla: lo que va antes del primer punto. */
export const pantallaDeAncla = (clave: AnclaKey): PantallaKey => clave.slice(0, clave.indexOf('.')) as PantallaKey;

/** Atributo con que se marca un elemento: `<div {...ancla('global.menu-lateral')}>`. */
export const ancla = (clave: AnclaKey) => ({ 'data-tour': clave });

/** Todas las anclas registradas, como `pantalla.ancla`. */
export const todasLasAnclas = (): AnclaKey[] =>
    Object.entries(ANCLAS).flatMap(([p, as]) => Object.keys(as).map((a) => `${p}.${a}` as AnclaKey));
