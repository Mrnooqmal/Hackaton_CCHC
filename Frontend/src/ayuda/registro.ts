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
    inicio: { ruta: '/', descripcion: 'Inicio', manual: 'empezar/elegir-obra' },
    'seleccion-obra': { ruta: '/seleccionar-obra', descripcion: 'Elegir obra o vista de empresa', manual: 'empezar/elegir-obra' },
    personas: { ruta: '/personas', descripcion: 'Personas', manual: 'empresa/personas' },
    'persona-nueva': { ruta: '/personas/nueva', descripcion: 'Agregar persona', manual: 'empresa/personas' },
    'personas-carga-masiva': { ruta: '/personas/carga-masiva', descripcion: 'Carga masiva de personas', manual: 'empresa/personas' },
    'persona-detalle': { ruta: '/personas/:rut', descripcion: 'Ficha de una persona', manual: 'empresa/personas' },
    // Ruta antigua de la ficha, todavía en App.tsx (los enlaces viejos llegan aquí).
    'persona-detalle-legado': { ruta: '/workers/:rut', descripcion: 'Ficha de una persona (ruta antigua)', manual: 'empresa/personas' },
    'enrolar-trabajador': { ruta: '/workers/enroll', descripcion: 'Enrolar trabajador', manual: 'empresa/personas' },
    obras: { ruta: '/obras', descripcion: 'Obras', manual: 'empresa/obras' },
    'obra-nueva': { ruta: '/obras/nueva', descripcion: 'Crear obra', manual: 'empresa/obras' },
    'obra-detalle': { ruta: '/obras/:obraId', descripcion: 'Detalle de una obra', manual: 'obra/cumplimiento' },
    prescripciones: { ruta: '/prescripciones', descripcion: 'Prescripciones', manual: 'obra/prescripciones' },
    'prescripcion-nueva': { ruta: '/prescripciones/nueva', descripcion: 'Registrar prescripción', manual: 'obra/prescripciones' },
    'prescripcion-implementar': { ruta: '/prescripciones/:id/implementar', descripcion: 'Implementar prescripción', manual: 'obra/prescripciones' },
    'estructura-constituir': { ruta: '/estructura/constituir', descripcion: 'Constituir órgano preventivo', manual: 'obra/estructura' },
    'estructura-organo': { ruta: '/estructura/organos/:organoId', descripcion: 'Órgano preventivo', manual: 'obra/estructura' },
    'cargos-onboarding': { ruta: '/cargos-onboarding', descripcion: 'Cargos y kits de incorporación', manual: 'empresa/cargos' },
    'catalogos-actividad': { ruta: '/catalogos-actividad', descripcion: 'Catálogos de actividades', manual: 'empresa/cargos' },
    repositorio: { ruta: '/documents-repository', descripcion: 'Repositorio de documentos', manual: 'obra/documentos' },
    encuestas: { ruta: '/surveys', descripcion: 'Encuestas', manual: 'terreno/encuestas' },
    'encuesta-nueva': { ruta: '/surveys/nueva', descripcion: 'Crear encuesta', manual: 'obra/encuestas' },
    'encuesta-detalle': { ruta: '/surveys/:surveyId', descripcion: 'Detalle de encuesta', manual: 'terreno/encuestas' },
    'encuesta-responder': { ruta: '/surveys/:surveyId/responder', descripcion: 'Responder encuesta', manual: 'terreno/encuestas' },
    incidentes: { ruta: '/incidents', descripcion: 'Hallazgos e incidentes', manual: 'terreno/reportar' },
    'incidente-reportar': { ruta: '/incidents/reportar', descripcion: 'Reportar hallazgo o incidente', manual: 'terreno/reportar' },
    actividades: { ruta: '/activities', descripcion: 'Actividades', manual: 'obra/actividades' },
    'actividad-nueva': { ruta: '/activities/nueva', descripcion: 'Crear actividad', manual: 'obra/actividades' },
    'actividad-planificar': { ruta: '/activities/planificar', descripcion: 'Planificar el mes', manual: 'obra/actividades' },
    'solicitudes-firma': { ruta: '/signature-requests', descripcion: 'Solicitudes de firma', manual: 'obra/pedir-firmas' },
    'mis-firmas': { ruta: '/my-signatures', descripcion: 'Mis firmas', manual: 'terreno/firmar' },
    bandeja: { ruta: '/inbox', descripcion: 'Bandeja de entrada', manual: 'terreno/avisos' },
    'mi-empresa': { ruta: '/mi-empresa', descripcion: 'Mi empresa', manual: 'empresa' },
    crear: { ruta: '/crear', descripcion: 'Crear (accesos rápidos)' },
    configuracion: { ruta: '/configuracion', descripcion: 'Configuración', manual: 'empezar/mi-cuenta' },
    'mis-datos': { ruta: '/mis-datos', descripcion: 'Mis datos y privacidad', manual: 'terreno/mis-datos' },
    'cambiar-contrasena': { ruta: '/change-password', descripcion: 'Cambiar contraseña', manual: 'empezar/mi-cuenta' },
    enrolamiento: { ruta: '/enroll-me', descripcion: 'Mi enrolamiento', manual: 'empezar/ingresar' },
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
        'menu-lateral': 'Menú lateral con los módulos (oculto en el teléfono)',
        'boton-menu': 'Botón de tres líneas que muestra u oculta el menú lateral',
        'obra-actual': 'Nombre de la obra en la que se está, en el encabezado (oculto en el teléfono)',
        'menu-sesion': 'Menú de tres puntos junto al nombre, con Cambiar de obra y Cerrar sesión (oculto en el teléfono)',
    },
    inicio: {
        'aviso-ingreso': 'Aviso de firmas obligatorias para entrar a la obra (solo si faltan)',
        accesos: 'Accesos rápidos: Mis firmas, Actividades, Encuestas, Reportar incidente',
        pendientes: 'Panel Tus pendientes',
    },
    'mis-firmas': {
        pestanas: 'Pestañas Pendientes e Historial',
        lista: 'Lista de documentos pendientes de firma',
        avance: 'Panel Tu avance y próximos vencimientos',
    },
    'incidente-reportar': {
        tipo: 'Selector Hallazgo o Incidente',
        datos: 'Tipo de hallazgo, o detalles del incidente con su gravedad',
        detalle: 'Descripción de lo que pasó, con el botón Dictar',
        evidencia: 'Evidencia fotográfica',
    },
    actividades: {
        vistas: 'Pestañas Lista y Calendario',
        planificar: 'Botón Planificar mes (solo con permiso)',
        nueva: 'Botón Nueva actividad',
        'por-completar': 'Sección Del plan, por completar (solo si hay borradores)',
    },
    repositorio: {
        carpetas: 'Carpetas del repositorio',
        subir: 'Botón Subir documento',
    },
    'obra-detalle': {
        avance: 'Avance de la obra y sus cuatro fases',
        filtro: 'Filtro de requisitos por estado',
        requisitos: 'Lista de requisitos de la fase elegida',
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

/** Lo que devuelve `ancla()`, para los componentes que lo reciben como prop. */
export type AtributoAncla = ReturnType<typeof ancla>;

/** Todas las anclas registradas, como `pantalla.ancla`. */
export const todasLasAnclas = (): AnclaKey[] =>
    Object.entries(ANCLAS).flatMap(([p, as]) => Object.keys(as).map((a) => `${p}.${a}` as AnclaKey));
