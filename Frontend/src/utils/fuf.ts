/**
 * Catálogo del Formulario Único de Fiscalización (DS 44/2024).
 *
 * ESPEJO de Backend/lib/fuf.js — GENERADO desde esa fuente, no transcrito a mano.
 * Si hay que cambiar un texto o una sección, se cambia allá y se regenera acá.
 *
 * Es la fuente única de secciones e ítems que consumen el repositorio, el panel
 * de completitud y el export (sección 10.1 del encargo).
 */

export type FaseFuf = 'PLAN' | 'DO' | 'CHECK' | 'ACT';

export interface SeccionFuf {
    numero: number; nombre: string; desde: number; hasta: number;
    /** La 16: acompaña al formulario sin ser parte de él. */
    fueraDelFormulario?: boolean;
}
export interface ItemFuf {
    numero: number; texto: string; articulo: string; fase: FaseFuf;
    /** Sin número de ítem del FUF: la interfaz lo muestra por su artículo. */
    fueraDelFormulario?: boolean;
}

export const SECCIONES_FUF: SeccionFuf[] = [
    { numero: 1, nombre: 'Sistema de Gestión de Seguridad y Salud en el Trabajo', desde: 1, hasta: 1 },
    { numero: 2, nombre: 'Identificación de peligros y evaluación de riesgos', desde: 2, hasta: 7 },
    { numero: 3, nombre: 'Programa de Trabajo en Prevención de Riesgos Laborales', desde: 8, hasta: 20 },
    { numero: 4, nombre: 'Información y formación en seguridad y salud en el trabajo', desde: 21, hasta: 24 },
    { numero: 5, nombre: 'Consulta y participación', desde: 25, hasta: 25 },
    { numero: 6, nombre: 'Riesgo grave e inminente y plan de gestión ante emergencias', desde: 26, hasta: 28 },
    { numero: 7, nombre: 'Coordinación y cooperación entre entidades empleadoras', desde: 29, hasta: 29 },
    { numero: 8, nombre: 'Comités Paritarios de Higiene y Seguridad', desde: 30, hasta: 40 },
    { numero: 9, nombre: 'Departamentos de Prevención de Riesgos', desde: 41, hasta: 48 },
    { numero: 10, nombre: 'Reglamentos Internos', desde: 49, hasta: 52 },
    { numero: 11, nombre: 'Mapas de Riesgos', desde: 53, hasta: 53 },
    { numero: 12, nombre: 'Vigilancia del ambiente y de la salud', desde: 54, hasta: 56 },
    { numero: 13, nombre: 'Traslado del puesto de trabajo y prescripción de medidas', desde: 57, hasta: 58 },
    { numero: 14, nombre: 'Investigación de causas de accidentes y enfermedades profesionales', desde: 59, hasta: 59 },
    { numero: 15, nombre: 'Registro de la actividad preventiva e indicadores de gestión', desde: 60, hasta: 60 },
];

export const ITEMS_FUF: ItemFuf[] = ([
    [1, 'Existencia del SGSST con su contenido mínimo', 'Art. 22', 'PLAN'],
    [2, 'Existencia de la MIPER con cobertura de todos los puestos', 'Art. 7', 'PLAN'],
    [3, 'Alcance de los factores de riesgo en la MIPER', 'Art. 7', 'PLAN'],
    [4, 'Disponibilidad y difusión de la MIPER', 'Art. 7 inc. 9', 'PLAN'],
    [5, 'Contenido mínimo de la MIPER', 'Art. 7', 'PLAN'],
    [6, 'Fecha y revisión periódica de la MIPER', 'Art. 7 inc. final', 'PLAN'],
    [7, 'Autoevaluación en entidades de hasta 25 personas', 'Art. 64', 'PLAN'],
    [8, 'Programa de Trabajo Preventivo dentro de 30 días corridos desde la MIPER', 'Art. 8 inc. 1', 'PLAN'],
    [9, 'Programa de Trabajo Preventivo escrito y aprobado', 'Art. 8', 'PLAN'],
    [10, 'Contenido mínimo del Programa de Trabajo Preventivo', 'Art. 8', 'PLAN'],
    [11, 'Difusión del Programa de Trabajo Preventivo y remisión al comité', 'Art. 8 inc. 3', 'PLAN'],
    [12, 'Máquinas, equipos y elementos de trabajo', 'Art. 10', 'DO'],
    [13, 'Prelación de las medidas de control', 'Art. 9', 'PLAN'],
    [14, 'Entrega gratuita de elementos de protección personal', 'Art. 13 inc. 1', 'DO'],
    [15, 'Adecuación del EPP al riesgo que cubre', 'Art. 13', 'DO'],
    [16, 'Certificación de calidad o registro ISP de los EPP', 'Art. 13 inc. 2', 'DO'],
    [17, 'Procedimiento de gestión de EPP', 'Art. 13 inc. 2', 'DO'],
    [18, 'Capacitación en uso y mantención de EPP', 'Art. 13 inc. 3', 'DO'],
    [19, 'Registro de las capacitaciones en EPP', 'Art. 13 inc. 4', 'DO'],
    [20, 'Evaluación anual del cumplimiento del Programa de Trabajo Preventivo', 'Arts. 14 y 52', 'CHECK'],
    [21, 'Oportunidad de la información de riesgos laborales', 'Art. 15 inc. 1', 'DO'],
    [22, 'Contenido mínimo de la información de riesgos laborales', 'Art. 15', 'DO'],
    [23, 'Ejecución de la capacitación en prevención de riesgos', 'Art. 16 inc. 1', 'DO'],
    [24, 'Contenidos mínimos de la capacitación', 'Art. 16', 'DO'],
    [25, 'Consulta y participación de las personas trabajadoras', 'Arts. 17, 37 y 71', 'DO'],
    [26, 'Actuación ante riesgo grave e inminente', 'Art. 18', 'DO'],
    [27, 'Existencia del plan de gestión ante emergencias', 'Art. 19', 'PLAN'],
    [28, 'Prueba de ensayo anual del plan de emergencias', 'Art. 19 inc. 1', 'DO'],
    [29, 'Coordinación en faena compartida', 'Art. 20', 'DO'],
    [30, 'Constitución del Comité Paritario', 'Art. 23', 'DO'],
    [31, 'Curso de orientación en prevención de los integrantes electos', 'Art. 32', 'DO'],
    [32, 'Registro del acta de constitución en la Dirección del Trabajo', 'Art. 36', 'DO'],
    [33, 'Facilidades para el funcionamiento del comité', 'Art. 38', 'DO'],
    [34, 'Reuniones ordinarias y extraordinarias del comité', 'Art. 39', 'DO'],
    [35, 'Actas de las reuniones del comité', 'Arts. 39 y 42', 'DO'],
    [36, 'Comunicación escrita de los acuerdos a la entidad empleadora', 'Art. 42 inc. 2', 'DO'],
    [37, 'Entrega de documentación preventiva al comité', 'Art. 46 inc. 3', 'DO'],
    [38, 'Funciones mínimas del comité', 'Art. 47', 'DO'],
    [39, 'Delegado de Seguridad y Salud en el Trabajo', 'Art. 66', 'DO'],
    [40, 'Elección del delegado cada 2 años en asamblea con acta', 'Art. 66', 'DO'],
    [41, 'Departamento de Prevención dirigido por experto inscrito', 'Arts. 50 y 55', 'DO'],
    [42, 'Medios y personal del Departamento de Prevención', 'Art. 51', 'DO'],
    [43, 'Cumplimiento de las funciones del Departamento', 'Art. 52', 'CHECK'],
    [44, 'Categoría y tiempo de dedicación del experto', 'Arts. 54 y 55', 'DO'],
    [45, 'Registro de asistencia del encargado del Departamento', 'Art. 55', 'DO'],
    [46, 'Registros que mantiene el Departamento de Prevención', 'Arts. 73 y 74', 'CHECK'],
    [47, 'Indicadores en entidades sin Departamento de Prevención', 'Art. 75', 'CHECK'],
    [48, 'Encargado de Gestión del Riesgo capacitado por el Organismo Administrador', 'Art. 65', 'DO'],
    [49, 'Reglamento Interno vigente, entregado e ingresado', 'Arts. 56 a 61', 'PLAN'],
    [50, 'Remisión previa del Reglamento Interno con 30 días de anticipación', 'Art. 57 inc. 2', 'PLAN'],
    [51, 'Revisión periódica del Reglamento Interno', 'Art. 57 inc. 5', 'ACT'],
    [52, 'Contenido mínimo del Reglamento Interno', 'Art. 58', 'PLAN'],
    [53, 'Mapas de riesgos visibles', 'Art. 62', 'PLAN'],
    [54, 'Programa de vigilancia ambiental', 'Art. 67', 'DO'],
    [55, 'Programa de vigilancia de la salud', 'Art. 67', 'DO'],
    [56, 'Autorización para asistir a exámenes de control', 'Art. 68', 'DO'],
    [57, 'Traslado de puesto por enfermedad profesional', 'Art. 69', 'DO'],
    [58, 'Implementación de las medidas prescritas', 'Art. 70', 'ACT'],
    [59, 'Investigación de accidentes con enfoque de género', 'Art. 71', 'DO'],
    [60, 'Registro documental fidedigno de la actividad preventiva', 'Art. 72', 'CHECK'],
] as Array<[number, string, string, string]>).map(([numero, texto, articulo, fase]) => ({
    numero, texto, articulo, fase: fase as FaseFuf,
}));

/**
 * Sección 16: requisitos que NO son ítems del formulario.
 *
 * El FUF tiene 15 secciones y 60 ítems, y eso no se toca: es la norma. Acá viven
 * lo que el DS 44 exige sin fiscalizar en el formulario (el Art. 12) y los
 * documentos que la entidad mantiene por recomendación profesional.
 *
 * Los números 61 en adelante son internos, para agrupar. La interfaz muestra el
 * ARTÍCULO y no "FUF 61": un número de ítem inventado rompería exactamente la
 * auditabilidad que el formulario existe para dar.
 */
export const SECCION_EXTRA: SeccionFuf = {
    numero: 16,
    nombre: 'Otros requisitos y documentos de la entidad',
    desde: 61,
    hasta: 99,
    fueraDelFormulario: true,
};

export const ITEMS_EXTRA: ItemFuf[] = ([
    [61, 'Gestión de cambios en procesos, tecnologías o materiales', 'Art. 12', 'PLAN'],
    [62, 'Utilización de agentes físicos, químicos y biológicos', 'Art. 2 N.° 14 c)', 'DO'],
    [63, 'Diagnóstico de aspectos legales aplicables', 'Práctica de la entidad', 'PLAN'],
    [64, 'Registro de desviaciones e incumplimientos detectados', 'Práctica de la entidad', 'CHECK'],
    [65, 'Procedimientos de trabajo seguro', 'Práctica de la entidad', 'DO'],
    [66, 'Investigación de accidentes y enfermedades profesionales', 'Art. 71', 'CHECK'],
] as const).map(([numero, texto, articulo, fase]) => ({
    numero, texto, articulo, fase: fase as FaseFuf, fueraDelFormulario: true,
}));

/** El formulario más lo que lo acompaña. Es lo que recorre la interfaz. */
export const SECCIONES_TODAS: SeccionFuf[] = [...SECCIONES_FUF, SECCION_EXTRA];
export const ITEMS_TODOS: ItemFuf[] = [...ITEMS_FUF, ...ITEMS_EXTRA];

const POR_NUMERO = new Map(ITEMS_TODOS.map((i) => [i.numero, i]));

export const itemFuf = (numero: number): ItemFuf | null => POR_NUMERO.get(Number(numero)) || null;

/** Sección de un ítem. Los ítems 39 y 40 caen en la 8, como en el formulario. */
export const seccionDeItem = (numero: number): SeccionFuf | null => {
    const n = Number(numero);
    return SECCIONES_TODAS.find((s) => n >= s.desde && n <= s.hasta) || null;
};

export const itemsDeSeccion = (numeroSeccion: number): ItemFuf[] => {
    const s = SECCIONES_TODAS.find((x) => x.numero === Number(numeroSeccion));
    return s ? ITEMS_TODOS.filter((i) => i.numero >= s.desde && i.numero <= s.hasta) : [];
};

/**
 * Agrupa requisitos evaluados en las secciones del formulario. Las secciones sin
 * requisitos NO se omiten: un formulario al que le faltan secciones no se puede
 * recorrer junto al fiscalizador.
 */
export function agruparPorSeccion<T extends { item?: number | null }>(requisitos: T[]) {
    const porItem = new Map<number, T[]>();
    for (const r of requisitos || []) {
        const n = Number(r.item);
        if (!Number.isFinite(n)) continue;
        if (!porItem.has(n)) porItem.set(n, []);
        porItem.get(n)!.push(r);
    }
    return SECCIONES_TODAS.map((s) => ({
        fueraDelFormulario: Boolean(s.fueraDelFormulario),
        seccion: s.numero,
        nombre: s.nombre,
        items: itemsDeSeccion(s.numero).map((i) => ({ ...i, requisitos: porItem.get(i.numero) || [] })),
    }));
}
