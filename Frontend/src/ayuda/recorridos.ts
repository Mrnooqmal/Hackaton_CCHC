// Definiciones de los recorridos guiados (D-33). Guía completa:
// docs/ayuda-contextual/como-escribir-un-recorrido.md
//
// Para agregar o cambiar uno:
//   1. Marca en el componente cada elemento que vas a resaltar con `ancla()` y
//      regístralo en `registro.ts`.
//   2. Escribe o edita la definición acá. Si cambias el contenido de uno que ya
//      existe, sube su `version`.
//   3. `npm run recorridos:huellas` actualiza `huellas.json`; el build falla si
//      el contenido cambió y la versión no, o si las huellas no están al día.
//
// Los textos se muestran como texto plano. Reglas de redacción en el encargo:
// el sistema custodia evidencia, no valida el contenido de los documentos ni
// garantiza el cumplimiento legal.
//
// Recorridos iniciales (Fase 5, aprobados el 7 de noviembre de 2026): nacieron
// en BORRADOR (el build de prod no incluye borradores: vite-borradores.ts) y se
// publicaron el 8 de noviembre de 2026, tras la revisión de Adrean en dev con
// la vista previa. Un recorrido nuevo empieza en borrador. Las tres introducciones de
// Inicio se reparten por permiso para que cada persona calce con una sola:
// sin `obras.ver` (terreno), con `obras.ver` y sin `empresa.ver` (gestión de
// obra), con `empresa.ver` (vista de empresa).
//
// En el teléfono, el menú lateral, la obra actual y el menú de sesión están
// ocultos: sus pasos se saltan solos. El del botón de menú se ve en los dos.

import type { DefinicionRecorrido } from './tipos.ts';

const t = (es: string) => ({ es });

export const RECORRIDOS: readonly DefinicionRecorrido[] = [
    // ─── Obligatorios ────────────────────────────────────────────────────────
    {
        id: 'inicio-terreno',
        tipo: 'obligatorio',
        pantalla: 'inicio',
        visibleSi: { ninguno: ['obras.ver'] },
        ambito: 'cualquiera',
        version: 1,
        reiniciarAlPublicar: false,
        estado: 'publicado',
        titulo: t('Tu pantalla de Inicio'),
        manual: 'roles/trabajador',
        pasos: [
            {
                ancla: 'inicio.aviso-ingreso',
                titulo: t('Antes de entrar a la obra'),
                descripcion: t('Te faltan firmas obligatorias para ingresar a terreno. Toca este aviso y fírmalas antes que nada.'),
            },
            {
                ancla: 'inicio.accesos',
                titulo: t('Tus accesos'),
                descripcion: t('Tus firmas, las actividades de hoy, tus encuestas y el botón para reportar un hallazgo o un incidente.'),
            },
            {
                ancla: 'inicio.pendientes',
                titulo: t('Lo que te toca'),
                descripcion: t('Aquí aparece lo que espera por ti: firmar un documento, responder una encuesta o registrar tu asistencia. Lo atrasado va primero.'),
                manual: 'terreno/firmar',
            },
            {
                ancla: 'global.boton-ayuda',
                titulo: t('¿Tienes dudas?'),
                descripcion: t('En cada pantalla, este botón tiene guías como esta y la página del manual que la explica. Ábrelo cuando quieras o cuando lo necesites.'),
                manual: 'empezar/ayuda',
            },
        ],
    },
    {
        id: 'inicio-gestion',
        tipo: 'obligatorio',
        pantalla: 'inicio',
        visibleSi: { alguno: ['obras.ver'], ninguno: ['empresa.ver'] },
        ambito: 'obra',
        version: 1,
        reiniciarAlPublicar: false,
        estado: 'publicado',
        titulo: t('Inicio para quien gestiona la obra'),
        manual: 'empezar/elegir-obra',
        pasos: [
            {
                ancla: 'global.obra-actual',
                titulo: t('Dónde estás trabajando'),
                descripcion: t('Aquí ves en qué estás: una obra o la vista de empresa. Las pantallas muestran lo de ahí: sus actividades, firmas, incidentes y documentos.'),
            },
            {
                ancla: 'global.menu-lateral',
                titulo: t('Tus módulos'),
                descripcion: t('Desde aquí entras a lo que gestionas: el detalle de la obra, personas, repositorio, actividades e incidentes.'),
            },
            {
                ancla: 'global.boton-menu',
                titulo: t('El menú'),
                descripcion: t('Este botón muestra u oculta el menú. En el teléfono, ábrelo para entrar a tus módulos; abajo, junto a tu nombre, está Cambiar de obra.'),
            },
            {
                ancla: 'global.menu-sesion',
                titulo: t('Cambiar de obra'),
                descripcion: t('Si trabajas en varias obras, cambias de una a otra desde este menú.'),
            },
            {
                ancla: 'inicio.pendientes',
                titulo: t('Tus propios pendientes'),
                descripcion: t('Además de gestionar, tú también firmas documentos y respondes encuestas. Lo que te toca a ti, personalmente, aparece en esta lista.'),
            },
            {
                ancla: 'global.boton-ayuda',
                titulo: t('Ayuda en cada pantalla'),
                descripcion: t('Guías como esta y el manual de la pantalla en la que estás. Ábrela cuando quieras o cuando lo necesites.'),
                manual: 'empezar/ayuda',
            },
        ],
    },
    {
        id: 'inicio-empresa',
        tipo: 'obligatorio',
        pantalla: 'inicio',
        visibleSi: { todos: ['empresa.ver'] },
        ambito: 'empresa',
        version: 1,
        reiniciarAlPublicar: false,
        estado: 'publicado',
        titulo: t('La vista de empresa'),
        manual: 'roles/administrador',
        pasos: [
            {
                ancla: 'global.menu-lateral',
                titulo: t('La vista de empresa'),
                descripcion: t('Aquí configuras la empresa: obras, personas, Mi Empresa, Onboarding y catálogos.'),
            },
            {
                ancla: 'global.boton-menu',
                titulo: t('El menú'),
                descripcion: t('Este botón muestra u oculta el menú. En el teléfono, ábrelo para configurar la empresa; abajo, junto a tu nombre, entras a una obra.'),
            },
            {
                ancla: 'global.menu-sesion',
                titulo: t('Entrar a una obra'),
                descripcion: t('Para trabajar dentro de una obra, usa Cambiar de obra en este menú.'),
            },
            {
                ancla: 'global.boton-ayuda',
                titulo: t('Ayuda en cada pantalla'),
                descripcion: t('Guías como esta y el manual de cada pantalla. Para empezar, revisa Mi Empresa y registra a tu equipo.'),
                manual: 'roles/administrador',
            },
        ],
    },
    {
        id: 'mis-firmas',
        tipo: 'obligatorio',
        pantalla: 'mis-firmas',
        visibleSi: {},
        ambito: 'cualquiera',
        version: 1,
        reiniciarAlPublicar: false,
        estado: 'publicado',
        titulo: t('Firmar lo que te asignan'),
        manual: 'terreno/firmar',
        pasos: [
            {
                ancla: 'mis-firmas.pestanas',
                titulo: t('Pendientes e historial'),
                descripcion: t('En Pendientes está lo que espera tu firma. En Historial, todo lo que ya firmaste, con su comprobante.'),
            },
            {
                ancla: 'mis-firmas.lista',
                titulo: t('Cómo se firma'),
                descripcion: t('Toca Firmar, lee el documento con Ver documento, escribe tu PIN de 6 dígitos y marca que lo leíste. La firma queda registrada con fecha y hora.'),
                manual: 'terreno/firmar',
            },
            {
                ancla: 'mis-firmas.avance',
                titulo: t('Tu avance'),
                descripcion: t('Cuánto llevas firmado este mes y lo que vence pronto en tu obra.'),
            },
        ],
    },

    // ─── Opcionales (desde la ayuda de cada pantalla) ───────────────────────
    {
        id: 'reportar',
        tipo: 'opcional',
        pantalla: 'incidente-reportar',
        visibleSi: {},
        ambito: 'obra',
        version: 1,
        reiniciarAlPublicar: false,
        estado: 'publicado',
        titulo: t('Hallazgo, incidente o accidente'),
        manual: 'terreno/reportar',
        pasos: [
            {
                ancla: 'incidente-reportar.tipo',
                titulo: t('¿Hallazgo o incidente?'),
                descripcion: t('Un hallazgo es algo inseguro que ves antes de que cause daño: cualquiera puede reportarlo. Un incidente es algo que ya pasó. Si hubo lesión, quien tiene el permiso lo califica después como accidente.'),
                manual: 'terreno/reportar',
            },
            {
                ancla: 'incidente-reportar.datos',
                titulo: t('Qué y dónde'),
                descripcion: t('El tipo de hallazgo y la etapa de la obra. En un incidente, además, su gravedad: leve, grave o fatal. Los graves y fatales se investigan.'),
            },
            {
                ancla: 'incidente-reportar.afectados',
                titulo: t('Quién resultó afectado'),
                descripcion: t('Si hubo una persona afectada, búscala por nombre o RUT. Es opcional. En un hallazgo, este campo aparece al elegir acción subestándar.'),
            },
            {
                ancla: 'incidente-reportar.detalle',
                titulo: t('Qué pasó'),
                descripcion: t('Cuéntalo con claridad. Puedes dictarlo si lo autorizaste en Mis datos y privacidad.'),
            },
            {
                ancla: 'incidente-reportar.evidencia',
                titulo: t('Fotos'),
                descripcion: t('Una foto ayuda a entender y a corregir. Súbela o tómala con la cámara del teléfono.'),
            },
            {
                ancla: 'incidente-reportar.envio',
                titulo: t('Revisar y enviar'),
                descripcion: t('Marca la declaración y envía. El reporte queda con tu nombre y se avisa al equipo de prevención de la obra, que lo revisa y le da seguimiento.'),
            },
        ],
    },
    {
        id: 'cambiar-de-obra',
        tipo: 'opcional',
        pantalla: 'inicio',
        visibleSi: { alguno: ['obras.ver'] },
        ambito: 'cualquiera',
        version: 1,
        reiniciarAlPublicar: false,
        estado: 'publicado',
        titulo: t('Cambiar de obra'),
        manual: 'empezar/elegir-obra',
        pasos: [
            {
                // Solo en el teléfono: ahí el menú lateral (con el menú de tres puntos) está oculto.
                ancla: 'global.boton-menu',
                soloSiNoSeVe: 'global.menu-sesion',
                titulo: t('Abre el menú'),
                descripcion: t('Toca este botón para abrir el menú. Abajo, junto a tu nombre, está el menú de tres puntos con Cambiar de obra.'),
            },
            {
                ancla: 'global.menu-sesion',
                titulo: t('Cambiar de obra'),
                descripcion: t('Toca aquí y elige Cambiar de obra. Si administras la empresa, desde aquí también vuelves a la vista de empresa.'),
                manual: 'empezar/elegir-obra',
            },
        ],
    },
    {
        id: 'programar-actividades',
        tipo: 'opcional',
        pantalla: 'actividades',
        visibleSi: { alguno: ['actividades.crear', 'actividades.planificar'] },
        ambito: 'obra',
        version: 1,
        reiniciarAlPublicar: false,
        estado: 'publicado',
        titulo: t('Charlas y capacitaciones'),
        manual: 'obra/actividades',
        pasos: [
            {
                ancla: 'actividades.vistas',
                titulo: t('Lista o calendario'),
                descripcion: t('La lista muestra lo de hoy y lo que falta completar; el calendario, el mes completo.'),
            },
            {
                ancla: 'actividades.planificar',
                titulo: t('Planificar el mes'),
                descripcion: t('Arma de una vez los borradores del mes. Cada responsable completa después el detalle del día.'),
                manual: 'obra/actividades',
            },
            {
                ancla: 'actividades.nueva',
                titulo: t('Una actividad suelta'),
                descripcion: t('Para una charla o una capacitación que no estaba planificada.'),
            },
            {
                ancla: 'actividades.por-completar',
                titulo: t('Por completar'),
                descripcion: t('Los borradores del plan que te tocan: ábrelos, escribe el tema y quedan programados.'),
            },
            {
                ancla: 'actividades.buscar',
                titulo: t('Buscar'),
                descripcion: t('Encuentra una actividad de hoy o del calendario por su título o descripción, o filtra por tipo.'),
            },
        ],
    },
    {
        id: 'subir-documentos',
        tipo: 'opcional',
        pantalla: 'repositorio',
        visibleSi: { todos: ['repositorio.subir'] },
        ambito: 'obra',
        version: 1,
        reiniciarAlPublicar: false,
        estado: 'publicado',
        titulo: t('Guardar y versionar documentos'),
        manual: 'obra/documentos',
        pasos: [
            {
                ancla: 'repositorio.subir',
                titulo: t('Subir un documento'),
                descripcion: t('Elige el tipo, ponle un título y adjunta el archivo (hasta 10 MB). Según el tipo, queda en su carpeta. La plataforma no revisa el contenido: que sea correcto y esté al día es responsabilidad de quien lo sube.'),
                manual: 'obra/documentos',
            },
            {
                ancla: 'repositorio.ds44',
                titulo: t('Una versión nueva, no otro archivo'),
                descripcion: t('Si un documento del formulario se renueva, no subas uno aparte. Ábrelo desde DS44 · Cumplimiento y usa Publicar nueva versión: así queda el historial y se vuelve a pedir la firma.'),
            },
        ],
    },
    {
        id: 'cumplimiento-obra',
        tipo: 'opcional',
        pantalla: 'obra-detalle',
        visibleSi: { todos: ['obras.detalle'] },
        ambito: 'obra',
        version: 1,
        reiniciarAlPublicar: false,
        estado: 'publicado',
        titulo: t('Qué le falta a la obra'),
        manual: 'obra/cumplimiento',
        pasos: [
            {
                ancla: 'obra-detalle.pestanas',
                titulo: t('Resumen y cumplimiento'),
                descripcion: t('En Resumen están los datos de la obra, su dotación y el órgano preventivo que le exige el DS 44. Aquí, en Cumplimiento, está lo que se le pide y en qué va cada requisito.'),
            },
            {
                ancla: 'obra-detalle.avance',
                titulo: t('Avance y fases'),
                descripcion: t('El avance cuenta solo lo que se le exige a esta obra. La fase En curso pasa sola a la siguiente cuando se completa, y puedes resolver requisitos de cualquier fase cuando quieras.'),
            },
            {
                ancla: 'obra-detalle.filtro',
                titulo: t('Filtrar por estado'),
                descripcion: t('Vencido, pendiente, incompleto, pendiente de firma o completado.'),
            },
            {
                ancla: 'obra-detalle.requisitos',
                titulo: t('Qué falta'),
                descripcion: t('Cada fila dice qué falta y ofrece una sola acción: Cargar el documento, elegir Firmantes, Recordar a quien no firma, Registrar un envío o responder Sí o No. La plataforma muestra la evidencia; no certifica que la obra cumpla.'),
                manual: 'obra/cumplimiento',
            },
            {
                ancla: 'obra-detalle.modulos',
                titulo: t('Módulos de la fase'),
                descripcion: t('Aquí se registra el trabajo de cada día: estructura preventiva, registro de actividad, investigaciones, medidas correctivas. Lo que registras acredita los requisitos de al lado.'),
            },
            {
                ancla: 'obra-detalle.exportar',
                titulo: t('Exportar FUF'),
                descripcion: t('Abre el reporte imprimible del formulario de fiscalización, con el estado de cada requisito. Útil para tenerlo a mano en una fiscalización.'),
            },
        ],
    },
    {
        id: 'encontrar-documentos',
        tipo: 'opcional',
        pantalla: 'repositorio',
        visibleSi: { todos: ['repositorio.ver'] },
        ambito: 'obra',
        version: 1,
        reiniciarAlPublicar: false,
        estado: 'publicado',
        titulo: t('Encontrar un documento'),
        manual: 'obra/documentos',
        pasos: [
            {
                ancla: 'repositorio.ambito',
                titulo: t('General o Personal'),
                descripcion: t('En General están los documentos de la obra y de la empresa. En Personal, solo los que te asignaron a ti para leer o firmar. Si solo ves Mis documentos, esos son los tuyos.'),
            },
            {
                ancla: 'repositorio.buscar',
                titulo: t('Buscar'),
                descripcion: t('Escribe parte del nombre y busca en todo el repositorio, sin abrir carpeta por carpeta.'),
            },
            {
                ancla: 'repositorio.carpetas',
                titulo: t('Las carpetas'),
                descripcion: t('Empresa, obra, registros y actividades, documentos de personas y otros. Solo aparecen las que tienen algo. Dentro de cada una, el ojo abre el documento y la flecha lo descarga.'),
            },
            {
                ancla: 'repositorio.ds44',
                titulo: t('DS44 · Cumplimiento'),
                descripcion: t('No es una carpeta de archivos: es el formulario de fiscalización, ordenado por sección. Muestra qué documento acredita cada requisito, de esta obra o de la empresa, y qué falta.'),
                manual: 'obra/documentos',
            },
        ],
    },
    {
        id: 'gestionar-incidentes',
        tipo: 'opcional',
        pantalla: 'incidentes',
        visibleSi: { todos: ['incidentes.historial'] },
        ambito: 'obra',
        version: 1,
        reiniciarAlPublicar: false,
        estado: 'publicado',
        titulo: t('Seguir los incidentes de la obra'),
        manual: 'obra/incidentes',
        pasos: [
            {
                ancla: 'incidentes.pestanas',
                titulo: t('Listado y estadísticas'),
                descripcion: t('En Listado están los eventos de la obra. En Estadísticas, los totales, la tasa de accidentabilidad y la tendencia, para descargar en CSV o PDF.'),
            },
            {
                ancla: 'incidentes.filtros',
                titulo: t('Encontrar un evento'),
                descripcion: t('Separa hallazgos e incidentes, busca por descripción y filtra por gravedad, por abiertos o cerrados y por etapa.'),
            },
            {
                ancla: 'incidentes.lista',
                titulo: t('Gestionar un evento'),
                descripcion: t('Tócalo para ver su detalle. Ahí defines el responsable, el plazo y el cierre, y quien tiene el permiso lo califica como accidente.'),
                manual: 'obra/incidentes',
            },
            {
                ancla: 'incidentes.lista',
                titulo: t('Investigaciones'),
                descripcion: t('Los graves y fatales se investigan. La investigación y sus medidas se registran en Detalle de obra, en las fases Verificar y Actuar.'),
            },
        ],
    },
];
