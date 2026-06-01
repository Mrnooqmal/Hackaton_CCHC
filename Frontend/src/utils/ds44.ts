export type Ds44DocDefinition = {
    key: string;
    tipos: string[];
    titulo: string;
    estadoFirma?: string;
};

export type Ds44OnboardingItem = {
    key: string;
    label: string;
    tipo: string;
    articulo: string;
    kind: 'document' | 'signature' | 'persona' | 'actividad';
    optional?: boolean;
    actionLabel?: string;
    actionRoute?: string;
};

export const DS44_PHASE_LABELS: Record<string, string> = {
    plan: 'PLANIFICAR',
    hacer: 'HACER',
    verificar: 'VERIFICAR',
    actuar: 'ACTUAR'
};

// ─── FASE PLAN — 5 documentos obligatorios ────────────────────────────────────
export const DS44_PLAN_DOCS: Ds44DocDefinition[] = [
    {
        key: 'POLITICA_SSO',
        tipos: ['POLITICA_SSO'],
        titulo: 'Política de SST',
        estadoFirma: 'Representante Legal'
    },
    {
        key: 'DIAGNOSTICO_LEGAL',
        tipos: ['DIAGNOSTICO_LEGAL'],
        titulo: 'Matriz Legal aplicable',
        estadoFirma: 'Prevencionista'
    },
    {
        key: 'MIPER',
        tipos: ['MIPER', 'MATRIZ_MIPPER'],
        titulo: 'MIPER — Identificación de Peligros y Evaluación de Riesgos',
        estadoFirma: 'Prevencionista + Jefe de Obra'
    },
    {
        key: 'MAPA_RIESGOS',
        tipos: ['MAPA_RIESGOS'],
        titulo: 'Mapa de Riesgos',
        estadoFirma: 'Jefe de Obra'
    },
    {
        key: 'REGLAMENTO_INTERNO',
        tipos: ['REGLAMENTO_INTERNO'],
        titulo: 'Reglamento Interno (RIHS/RIOHS)',
        estadoFirma: 'Jefe de Obra'
    }
];

// ─── FASE DO — Documento formal de nivel obra (Art. 72) ───────────────────────
export const DS44_DO_OBRA_DOC: Ds44DocDefinition = {
    key: 'REGISTRO_ACTIVIDAD',
    tipos: ['REGISTRO_ACTIVIDAD'],
    titulo: 'Registro de Actividad Preventiva',
    estadoFirma: 'Prevencionista / Jefe de Obra'
};

// ─── FASE DO — 6 ítems de onboarding por trabajador ──────────────────────────
// Regla: se generan siempre al vincular un trabajador, independiente de la fase de la obra.
export const DS44_ONBOARDING_ITEMS: Ds44OnboardingItem[] = [
    {
        key: 'IRL',
        label: 'IRL — Información de Riesgos Laborales',
        tipo: 'IRL',
        articulo: 'Art. 15',
        kind: 'document',
        actionLabel: 'Asignar'
    },
    {
        key: 'CAPACITACION',
        label: 'Capacitación SST 8 horas',
        tipo: 'CAPACITACION',
        articulo: 'Art. 16',
        kind: 'actividad',          // grupal — se trackea por actividades, no por SignatureRequest individual
        actionLabel: 'Ver actividades',
        actionRoute: '/actividades'
    },
    {
        key: 'REGLAMENTO_INTERNO',
        label: 'Entrega RIHS/RIOHS',
        tipo: 'REGLAMENTO_INTERNO',
        articulo: 'Art. 56',
        kind: 'document',
        actionLabel: 'Asignar'
    },
    {
        key: 'ENTREGA_EPP',
        label: 'Entrega y Capacitación EPP',
        tipo: 'ENTREGA_EPP',
        articulo: 'Art. 13',
        kind: 'signature',
        actionLabel: 'Asignar'
    },
    {
        key: 'PROCEDIMIENTO_TRABAJO',
        label: 'Procedimientos de Trabajo Seguro',
        tipo: 'PROCEDIMIENTO_TRABAJO',
        articulo: 'Art. 10',
        kind: 'document',
        actionLabel: 'Asignar'
    },
    {
        key: 'INDUCCION',
        label: 'Inducción Plan de Emergencia',
        tipo: 'INDUCCION',
        articulo: 'Art. 19',
        kind: 'signature',
        actionLabel: 'Asignar'
    }
];

// ─── FASE DO (HACER) — elementos clasificados por NATURALEZA (Excel DS44) ──────
//
// El flujograma del DO tiene UN solo cajon "documento" (el Registro de Actividad
// Preventiva consolidado, Art. 72). El resto de los elementos NO son ranuras de
// PDF uniformes: tienen naturalezas distintas (procedimiento de obra,
// capacitacion=actividad, registro de gestion=read-model) y solo aplican segun
// el tamaño de la entidad, faena compartida y existencia de maquinaria/agentes.

// Contexto de aplicabilidad de la obra/entidad.
export type Ds44DoContext = {
    tamanoEntidad: number;        // Tenant.cantidadTrabajadores
    faenaCompartida?: boolean;    // Obra.faenaCompartida (Art. 20)
    tieneMaquinaria?: boolean;    // Obra.tieneMaquinaria (Art. 10)
    agentesFQB?: boolean;         // Obra.agentesFQB (Art. 2 N°14 c)
};

export type Ds44Aplicabilidad = 'aplica' | 'no_aplica' | 'verificar';

export type Ds44DoCondicion =
    | 'siempre'
    | 'faena_compartida'   // Art. 20
    | 'tiene_maquinaria'   // Art. 10
    | 'agentes_fqb'        // Art. 2 N°14 c
    | 'cphs'               // >= 26 trabajadores
    | 'delegado'           // 10 a 25 trabajadores
    | 'encargado_oa'       // <= 9 trabajadores
    | 'depto_prevencion';  // > 100 trabajadores

export type Ds44DoFuente = 'documento' | 'actividad' | 'readmodel';

export type Ds44DoElemento = {
    key: string;
    tipo: string;
    titulo: string;
    articulo: string;
    fuente: Ds44DoFuente;
    condicion: Ds44DoCondicion;
    // Para fuente 'actividad': tipos de ActivitiesTable que satisfacen el elemento.
    actividadTipos?: string[];
    // Para fuente 'actividad': subtipo exacto de CAPACITACION que satisface el elemento.
    subtipo?: string;
    // Para fuente 'readmodel': ruta del modulo que alimenta el registro.
    modulo?: string;
    // true => cuenta en el % de cumplimiento HACER de la obra.
    cuenta?: boolean;
};

// Evalua si un elemento aplica a la obra. Si falta el dato para decidir,
// devuelve 'verificar' (NO ocultar por defecto).
export function evalAplicabilidad(cond: Ds44DoCondicion, ctx: Ds44DoContext): Ds44Aplicabilidad {
    const n = ctx.tamanoEntidad;
    switch (cond) {
        case 'siempre': return 'aplica';
        case 'faena_compartida':
            return ctx.faenaCompartida === undefined ? 'verificar' : ctx.faenaCompartida ? 'aplica' : 'no_aplica';
        case 'tiene_maquinaria':
            return ctx.tieneMaquinaria === undefined ? 'verificar' : ctx.tieneMaquinaria ? 'aplica' : 'no_aplica';
        case 'agentes_fqb':
            return ctx.agentesFQB === undefined ? 'verificar' : ctx.agentesFQB ? 'aplica' : 'no_aplica';
        case 'cphs': return n >= 26 ? 'aplica' : 'no_aplica';
        case 'delegado': return (n >= 10 && n <= 25) ? 'aplica' : 'no_aplica';
        case 'encargado_oa': return n > 0 && n <= 9 ? 'aplica' : 'no_aplica';
        case 'depto_prevencion': return n > 100 ? 'aplica' : 'no_aplica';
        default: return 'aplica';
    }
}

// A) PROCEDIMIENTOS — documentos de obra (se redactan una vez). NO firma por
// cada trabajador. Cuentan en el % (gating por firma si tienen firmantes asignados).
export const DS44_DO_PROCEDIMIENTOS: Ds44DoElemento[] = [
    { key: 'OPERACION_MAQUINAS', tipo: 'OPERACION_MAQUINAS', titulo: 'Trabajo seguro en máquinas, equipos y herramientas motrices', articulo: 'Art. 10', fuente: 'documento', condicion: 'tiene_maquinaria', cuenta: true },
    { key: 'PROCEDIMIENTO_AGENTES', tipo: 'PROCEDIMIENTO_AGENTES', titulo: 'Utilización de agentes físicos, químicos y biológicos', articulo: 'Art. 2 N°14 c', fuente: 'documento', condicion: 'agentes_fqb', cuenta: true },
    { key: 'PROCEDIMIENTO_EPP', tipo: 'PROCEDIMIENTO_EPP', titulo: 'Utilización, mantenimiento y recambio de EPP', articulo: 'Art. 13', fuente: 'documento', condicion: 'siempre', cuenta: true },
    { key: 'PLAN_EMERGENCIAS', tipo: 'PLAN_EMERGENCIAS', titulo: 'Plan de gestión y respuesta ante emergencias', articulo: 'Art. 19', fuente: 'documento', condicion: 'siempre', cuenta: true },
    { key: 'PROCEDIMIENTO_RIESGO_GRAVE', tipo: 'PROCEDIMIENTO_RIESGO_GRAVE', titulo: 'Procedimiento ante riesgo grave o inminente', articulo: 'Art. 18', fuente: 'documento', condicion: 'siempre', cuenta: true },
    { key: 'PROCEDIMIENTO_EVACUACION', tipo: 'PROCEDIMIENTO_EVACUACION', titulo: 'Evacuación y traslado de personas afectadas', articulo: 'Art. 19', fuente: 'documento', condicion: 'siempre', cuenta: true },
    { key: 'PROCEDIMIENTO_INVESTIGACION', tipo: 'PROCEDIMIENTO_INVESTIGACION', titulo: 'Investigación de accidentes (árbol de causas)', articulo: 'Art. 71', fuente: 'documento', condicion: 'siempre', cuenta: true },
    { key: 'GESTION_CAMBIOS', tipo: 'GESTION_CAMBIOS', titulo: 'Gestión de cambios en procesos/tecnologías/materiales', articulo: 'Art. 12', fuente: 'documento', condicion: 'siempre', cuenta: true },
    { key: 'COORDINACION_ENTIDADES', tipo: 'COORDINACION_ENTIDADES', titulo: 'Coordinación y cooperación entre entidades empleadoras', articulo: 'Art. 20', fuente: 'documento', condicion: 'faena_compartida', cuenta: true },
    { key: 'CONSULTA_REPRESENTANTES', tipo: 'CONSULTA_REPRESENTANTES', titulo: 'Consulta y participación de trabajadores', articulo: 'Arts. 17, 37, 71', fuente: 'documento', condicion: 'siempre', cuenta: true }
];

// B) CAPACITACIONES — se modelan como ACTIVIDADES (ActivitiesTable), NO PDF.
// El estado se lee de actividades ejecutadas con asistentes firmados.
// El match con ActivitiesTable es por `subtipo` exacto (no por palabras del titulo).
export const DS44_DO_CAPACITACIONES: Ds44DoElemento[] = [
    { key: 'CAP_PRL_8H', tipo: 'CAPACITACION', titulo: 'Capacitación 8h Prevención de Riesgos Laborales', articulo: 'Art. 16', fuente: 'actividad', condicion: 'siempre', actividadTipos: ['CAPACITACION'], subtipo: 'PRL_8H', cuenta: true },
    { key: 'CAP_EPP', tipo: 'CAPACITACION', titulo: 'Uso y mantención de EPP (mín. 1h por EPP)', articulo: 'Art. 13', fuente: 'actividad', condicion: 'siempre', actividadTipos: ['CAPACITACION'], subtipo: 'EPP', cuenta: true },
    { key: 'CAP_CPHS_ORIENTACION', tipo: 'CAPACITACION', titulo: 'Curso Orientación CPHS (8h)', articulo: 'Art. 32', fuente: 'actividad', condicion: 'cphs', actividadTipos: ['CAPACITACION'], subtipo: 'CPHS_ORIENTACION', cuenta: true },
    { key: 'CAP_CPHS_20H', tipo: 'CAPACITACION', titulo: 'Curso 20h CPHS', articulo: 'Art. 32', fuente: 'actividad', condicion: 'cphs', actividadTipos: ['CAPACITACION'], subtipo: 'CPHS_20H', cuenta: true },
    { key: 'CAP_DELEGADO', tipo: 'CAPACITACION', titulo: 'Capacitación Delegado SST', articulo: 'Art. 66', fuente: 'actividad', condicion: 'delegado', actividadTipos: ['CAPACITACION'], subtipo: 'DELEGADO', cuenta: true },
    { key: 'CAP_ENCARGADO', tipo: 'CAPACITACION', titulo: 'Capacitación Encargado Gestión del Riesgo (la entrega el OA)', articulo: 'Art. 65', fuente: 'actividad', condicion: 'encargado_oa', actividadTipos: ['CAPACITACION'], subtipo: 'ENCARGADO', cuenta: false }
];

// D) REGISTROS DE GESTIÓN — read-models que leen de modulos existentes.
// NO cuentan en el % (reflejan datos del sistema, no son documentos a "completar").
export const DS44_DO_REGISTROS_GESTION: Ds44DoElemento[] = [
    { key: 'REG_INCIDENTES', tipo: 'INCIDENTES', titulo: 'Incidentes / sucesos peligrosos', articulo: 'Art. 73', fuente: 'readmodel', condicion: 'siempre', modulo: '/incidents' },
    { key: 'REG_VIGILANCIA', tipo: 'VIGILANCIA', titulo: 'Personas en vigilancia de la salud', articulo: 'Art. 73', fuente: 'readmodel', condicion: 'siempre', modulo: '/workers' },
    { key: 'REG_EXAMENES', tipo: 'EXAMENES', titulo: 'Mediciones ambientales / exámenes ocupacionales', articulo: 'Arts. 67-68', fuente: 'readmodel', condicion: 'siempre', modulo: '/workers' },
    { key: 'REG_INVESTIGACIONES', tipo: 'INVESTIGACIONES', titulo: 'Investigaciones de accidentes y EP', articulo: 'Art. 71', fuente: 'readmodel', condicion: 'siempre', modulo: '/incidents' },
    { key: 'REG_ENSAYO_EMERGENCIA', tipo: 'SIMULACRO', titulo: 'Prueba/ensayo anual del plan de emergencias', articulo: 'Art. 19', fuente: 'readmodel', condicion: 'siempre', modulo: '/actividades' },
    { key: 'REG_ACTAS_CPHS', tipo: 'ACTAS_CPHS', titulo: 'Actas CPHS, acuerdos y entrega de documentación', articulo: 'Arts. 36-46', fuente: 'readmodel', condicion: 'cphs', modulo: '/actividades' }
];

// Eventos sobrevinientes: se crean SOLO ante el hecho. NO cuentan como faltante
// en el % de cumplimiento.
export type Ds44DoEvento = { key: string; tipo: string; titulo: string; articulo: string };
export const DS44_DO_EVENTOS: Ds44DoEvento[] = [
    { key: 'REGISTRO_RIESGO_GRAVE', tipo: 'REGISTRO_RIESGO_GRAVE', titulo: 'Registro de riesgo grave e inminente', articulo: 'Art. 18' },
    { key: 'TRASLADO_PUESTO', tipo: 'TRASLADO_PUESTO', titulo: 'Traslado de puesto por EP diagnosticada', articulo: 'Art. 69' }
];

// ─── FASE CHECK (VERIFICAR) ───────────────────────────────────────────────────
export const DS44_CHECK_ITEM = {
    key: 'INFORME_ANUAL',
    titulo: 'Informe Anual de Gestión Preventiva',
    descripcion: 'Solo aplica a obras/empresas con departamento de prevención (>100 trabajadores).',
    articulo: 'Fase CHECK'
};

export type Ds44FaseDoc = {
    key: string;
    tipo: string;
    titulo: string;
    articulo: string;
    obligatorio: boolean;
    condicional?: 'mas_100_trabajadores';
    descripcion?: string;
};

// Documentos de la Fase CHECK. La evaluacion de desempeño es la instancia unica
// exigida; el informe anual es condicional a >100 trabajadores con Depto. Prev.
export const DS44_CHECK_DOCS: Ds44FaseDoc[] = [
    {
        key: 'EVALUACION_DESEMPENO',
        tipo: 'EVALUACION_DESEMPENO',
        titulo: 'Evaluación de desempeño del SGSST',
        articulo: 'Arts. 14, 22.4',
        obligatorio: true,
        descripcion: 'Instancia única exigida por el DS44 (duda experto #7: periodicidad).'
    },
    {
        key: 'INFORME_ANUAL_GESTION',
        tipo: 'INFORME_ANUAL_GESTION',
        titulo: 'Informe anual de gestión preventiva',
        articulo: 'Art. 52.15',
        obligatorio: false,
        condicional: 'mas_100_trabajadores',
        descripcion: 'Solo entidades >100 trabajadores con Departamento de Prevención.'
    },
    {
        key: 'REGISTRO_DESVIACIONES',
        tipo: 'REGISTRO_DESVIACIONES',
        titulo: 'Registro de desviaciones / incumplimientos',
        articulo: 'Fase CHECK',
        obligatorio: false,
        descripcion: 'Insumo de la Fase ACT (medidas correctivas).'
    }
];

// ─── FASE ACT (ACTUAR — mejora continua) ──────────────────────────────────────
// ACT consume las desviaciones de CHECK y genera medidas de mejora trazables,
// que pueden disparar la actualizacion de documentos de PLAN/DO (cierre de ciclo).
export const DS44_ACT_DOCS: Ds44FaseDoc[] = [
    {
        key: 'PLAN_MEJORA',
        tipo: 'PLAN_MEJORA',
        titulo: 'Plan de mejora / medidas correctivas',
        articulo: 'Art. 2.16, Art. 14',
        obligatorio: true,
        descripcion: 'Medidas con responsable y plazo, a partir de las desviaciones del CHECK.'
    }
];

// Actualizaciones condicionales del ciclo ACT: cada una enlaza a un documento de
// PLAN/DO que debe revisarse, cerrando el ciclo Deming hacia PLAN.
export const DS44_ACT_ACTUALIZACIONES = [
    { key: 'MIPER', titulo: 'Actualizar MIPER', articulo: 'Art. 7 inc. final', tipoOrigen: 'MIPER' },
    { key: 'PTP', titulo: 'Actualizar PTP (≤30 días desde cambio de MIPER)', articulo: 'Art. 8', tipoOrigen: 'PROCEDIMIENTO_TRABAJO' },
    { key: 'REGLAMENTO_INTERNO', titulo: 'Revisar Reglamento Interno (≥1 año)', articulo: 'Art. 57', tipoOrigen: 'REGLAMENTO_INTERNO' },
    { key: 'CAPACITACION', titulo: 'Reforzar capacitación', articulo: 'Arts. 15-16', tipoOrigen: 'PLAN_CAPACITACION' },
    { key: 'CONSULTA_CPHS', titulo: 'Consulta a CPHS', articulo: 'Art. 17', tipoOrigen: 'CONSULTA_REPRESENTANTES' }
];
