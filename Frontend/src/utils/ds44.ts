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
        // Decision reunion 2026-06-10: documento cargable con firma cruzada
        // (relator + trabajador), independiente de la modalidad de imparticion.
        key: 'CAPACITACION_SST',
        label: 'Capacitación SST 8 horas',
        tipo: 'CAPACITACION_SST',
        articulo: 'Art. 16',
        kind: 'document',
        actionLabel: 'Cargar certificado'
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
    // Accion del registro de gestion en el panel:
    //  'incidentes'  -> ver + reportar (modulo existente)
    //  'simulacro'   -> programar actividad SIMULACRO inline
    //  'investigaciones' -> ver investigaciones (proceso sobre incidente)
    //  'consulta'    -> solo enlace de consulta (dato en Persona.vigilanciaSalud)
    accion?: 'incidentes' | 'simulacro' | 'investigaciones' | 'consulta';
    // true => el modulo aun no existe; mostrar badge "Modulo pendiente", sin crear.
    moduloPendiente?: boolean;
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
    { key: 'REG_INCIDENTES', tipo: 'INCIDENTES', titulo: 'Incidentes / sucesos peligrosos', articulo: 'Art. 73', fuente: 'readmodel', condicion: 'siempre', modulo: '/incidents', accion: 'incidentes' },
    { key: 'REG_INVESTIGACIONES', tipo: 'INVESTIGACIONES', titulo: 'Investigaciones de accidentes y EP', articulo: 'Art. 71', fuente: 'readmodel', condicion: 'siempre', modulo: '/incidents', accion: 'investigaciones' },
    { key: 'REG_ENSAYO_EMERGENCIA', tipo: 'SIMULACRO', titulo: 'Prueba/ensayo anual del plan de emergencias', articulo: 'Art. 19', fuente: 'readmodel', condicion: 'siempre', modulo: '/activities', accion: 'simulacro' },
    { key: 'REG_VIGILANCIA', tipo: 'VIGILANCIA', titulo: 'Personas en vigilancia de la salud', articulo: 'Art. 73', fuente: 'readmodel', condicion: 'siempre', modulo: '/personas', accion: 'consulta', moduloPendiente: true },
    { key: 'REG_EXAMENES', tipo: 'EXAMENES', titulo: 'Mediciones ambientales / exámenes ocupacionales', articulo: 'Arts. 67-68', fuente: 'readmodel', condicion: 'siempre', modulo: '/personas', accion: 'consulta', moduloPendiente: true },
    { key: 'REG_ACTAS_CPHS', tipo: 'ACTAS_CPHS', titulo: 'Actas CPHS, acuerdos y entrega de documentación', articulo: 'Arts. 36-46', fuente: 'readmodel', condicion: 'cphs', modulo: '/activities', accion: 'consulta', moduloPendiente: true }
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

// ═══════════════════════════════════════════════════════════════════════════════
// CATÁLOGO DE CARGOS Y ONBOARDING POR CARGO (DS44 — PoC EBCO)
// ═══════════════════════════════════════════════════════════════════════════════
//
// ESPEJO de Backend/lib/ds44.js — mantener ambos sincronizados.
//
// Arquitectura de datos (decisión): el CATÁLOGO de cargos y la PLANTILLA del kit
// (qué tipos de documento exige cada cargo) viven a nivel TENANT, porque:
//   - El cargo es un atributo estable de la persona (un carpintero lo es en
//     cualquier obra; Persona.obraIds es lista → el cargo no puede ser por-obra).
//   - Los procedimientos corporativos (PR-PO-xx, RI, Política) son documentos de
//     empresa, idénticos entre obras → estandarización que el DS44 busca.
// El ARCHIVO/plantilla concreto se resuelve por ALCANCE, no por cargo:
//   - 'tenant'  → un PDF corporativo aplica a todas las obras (PR-PO, RI, Política).
//   - 'obra'    → se sube por obra porque deriva del MIPER de esa obra (IRL, Plan
//                 de Emergencias). Aquí es donde la realidad es "por obra".
//   - 'persona' → evidencia individual del trabajador (entrega EPP, examen de
//                 altura, encuestas) — no es plantilla reutilizable.
// El TenantsTable.reglas podrá sobreescribir el kit por empresa (fuera de etapa 1).

export type Ds44Cargo = {
    codigo: string;
    label: string;
    // legacy: cargos de texto libre previos al catálogo. Caen al kit genérico
    // (compatibilidad con personas ya creadas) en vez de fallar.
    legacy?: boolean;
};

// Naturaleza del ítem → determina DÓNDE vive la plantilla (ver alcance) y cómo se
// completa. Es la abstracción que el flujograma EBCO hace evidente.
export type Ds44ItemNaturaleza =
    | 'procedimiento_corporativo'   // PR-PO-xx, RI, Política: PDF de empresa
    | 'derivado_miper'              // IRL, Plan Emergencias: depende del MIPER de la obra
    | 'evidencia_individual';       // entrega EPP, examen, encuesta: por trabajador

export type Ds44PlantillaAlcance = 'tenant' | 'obra' | 'persona' | 'ninguno';

// Tipo de acción de onboarding (lo que el trabajador debe "cerrar").
export type Ds44AccionTipo =
    | 'DIFUSION_FIRMA'              // difusión + firma de toma de conocimiento
    | 'CAPACITACION_EVALUACION'    // capacitación + evaluación con nota mínima
    | 'ENTREGA_EPP'                // entrega física + firma de recepción (Art. 13)
    | 'EVIDENCIA_EXTERNA'          // certificado/examen externo (proveedor/mutualidad)
    | 'INGRESO_VIGILANCIA'         // alta en vigilancia de salud MINSAL (no es un PDF)
    | 'ENCUESTA';                  // aplicación de instrumento (psicosocial)

export type Ds44ProtocoloMinsal = 'PREXOR' | 'SILICE' | 'TMERT' | 'MMC' | 'RUV' | 'PSICOSOCIAL';

export type Ds44EppItem = { descripcion: string; critico?: boolean };

export type Ds44KitItem = {
    key: string;                   // único dentro del kit del cargo
    tipo: string;                  // tipo en DocumentsTable / SignatureRequests
    titulo: string;
    articulo?: string;
    codigoEbco?: string;           // PR-PO-08, PR-FR-85, RI 76…
    naturaleza: Ds44ItemNaturaleza;
    alcancePlantilla: Ds44PlantillaAlcance;
    accion: Ds44AccionTipo;
    // bloqueante: cuenta para el estado "apto para ingresar a terreno". NUNCA
    // bloquea el registro/vinculación del trabajador (solo informa el semáforo).
    bloqueante?: boolean;
    condicion?: 'siempre' | 'segun_miper';
    notaMinima?: 70 | 90;          // según PR-PDO-04 (70% gral) / altura-SPDC (90%)
    requiereFirmaRelator?: boolean;
    matrizEpp?: Ds44EppItem[];     // solo accion ENTREGA_EPP
    protocolo?: Ds44ProtocoloMinsal;
};

// ─── Catálogo de cargos (nivel tenant) ───────────────────────────────────────
// Los 5 cargos EBCO de la PoC + los heredados de texto libre (WorkerEnroll).
export const DS44_CARGOS: Ds44Cargo[] = [
    { codigo: 'CARPINTERO', label: 'Carpintero' },
    { codigo: 'JORNAL_ASEO', label: 'Jornal de aseo y acarreo' },
    { codigo: 'MAESTRO_TERMINACIONES', label: 'Maestro de Terminaciones' },
    { codigo: 'MAESTRO_ALBANIL', label: 'Maestro Albañil' },
    { codigo: 'TRAZADOR', label: 'Trazador' },
    // Heredados (kit genérico): preservan datos previos sin romper.
    { codigo: 'OPERARIO', label: 'Operario', legacy: true },
    { codigo: 'SOLDADOR', label: 'Soldador', legacy: true },
    { codigo: 'ELECTRICISTA', label: 'Electricista', legacy: true },
    { codigo: 'MAESTRO_OBRA', label: 'Maestro de Obra', legacy: true },
    { codigo: 'JEFE_CUADRILLA', label: 'Jefe de Cuadrilla', legacy: true },
    { codigo: 'AYUDANTE', label: 'Ayudante', legacy: true },
    { codigo: 'ALBANIL', label: 'Albañil', legacy: true },
    { codigo: 'JORNAL', label: 'Jornal', legacy: true },
    { codigo: 'OTRO', label: 'Otro', legacy: true }
];

// ─── Matrices EPP por cargo (PR-FR-85, EPP de cada PR-PO) ─────────────────────
export const DS44_EPP_MATRIZ: Record<string, Ds44EppItem[]> = {
    CARPINTERO: [
        { descripcion: 'Casco de seguridad' }, { descripcion: 'Barbiquejo' },
        { descripcion: 'Legionario' }, { descripcion: 'Lentes de seguridad' },
        { descripcion: 'Guantes de cabritilla' }, { descripcion: 'Botines de seguridad' },
        { descripcion: 'Protección auditiva' },
        { descripcion: 'Arnés de cuerpo completo', critico: true },
        { descripcion: 'Doble cabo de vida con amortiguador', critico: true },
        { descripcion: 'Bloqueador solar (PR-FR-121)' }
    ],
    JORNAL_ASEO: [
        { descripcion: 'Casco de seguridad' }, { descripcion: 'Barbiquejo' },
        { descripcion: 'Lentes de seguridad' }, { descripcion: 'Tapones auditivos' },
        { descripcion: 'Guantes multiflex' }, { descripcion: 'Botines de seguridad' },
        { descripcion: 'Bloqueador solar' }
    ],
    MAESTRO_TERMINACIONES: [
        { descripcion: 'Casco de seguridad' }, { descripcion: 'Lentes de seguridad con sello' },
        { descripcion: 'Guantes de seguridad' }, { descripcion: 'Rodilleras' },
        { descripcion: 'Botines de seguridad' }, { descripcion: 'Careta facial' },
        { descripcion: 'Respirador medio rostro (filtro según HDS)', critico: true },
        { descripcion: 'Buzo desechable' }
    ],
    MAESTRO_ALBANIL: [
        { descripcion: 'Casco de seguridad' }, { descripcion: 'Barbiquejo' },
        { descripcion: 'Lentes de seguridad' }, { descripcion: 'Guantes de seguridad' },
        { descripcion: 'Botines de seguridad' }, { descripcion: 'Protección auditiva' },
        { descripcion: 'Arnés de cuerpo completo', critico: true }
    ],
    TRAZADOR: [
        { descripcion: 'Casco de seguridad' }, { descripcion: 'Barbiquejo' },
        { descripcion: 'Lentes de seguridad' }, { descripcion: 'Guantes anticorte' },
        { descripcion: 'Botines de seguridad' },
        { descripcion: 'Arnés de cuerpo completo', critico: true },
        { descripcion: 'Caleros con tapa (EPP sílice)', critico: true },
        { descripcion: 'Bloqueador solar' }
    ]
};

const EPP_GENERICO: Ds44EppItem[] = [
    { descripcion: 'Casco de seguridad' }, { descripcion: 'Lentes de seguridad' },
    { descripcion: 'Guantes de seguridad' }, { descripcion: 'Botines de seguridad' }
];

// ─── Bloque transversal (aplica a los 5 cargos EBCO) ──────────────────────────
const itemEppDeCargo = (cargo: string): Ds44KitItem => ({
    key: 'ENTREGA_EPP', tipo: 'ENTREGA_EPP', codigoEbco: 'PR-FR-85',
    titulo: 'Entrega y capacitación de EPP', articulo: 'Art. 13',
    naturaleza: 'evidencia_individual', alcancePlantilla: 'persona',
    accion: 'ENTREGA_EPP', matrizEpp: DS44_EPP_MATRIZ[cargo] || EPP_GENERICO
});

const kitTransversal = (cargo: string): Ds44KitItem[] => [
    { key: 'RI_76', tipo: 'REGLAMENTO_INTERNO', codigoEbco: 'RI 76', titulo: 'Reglamento Interno (RIHS/RIOHS)', articulo: 'Art. 156 CT', naturaleza: 'procedimiento_corporativo', alcancePlantilla: 'tenant', accion: 'DIFUSION_FIRMA' },
    { key: 'POLITICA_SST', tipo: 'POLITICA_SSO', titulo: 'Política SST', naturaleza: 'procedimiento_corporativo', alcancePlantilla: 'tenant', accion: 'DIFUSION_FIRMA' },
    { key: 'PLAN_EMERGENCIAS', tipo: 'PLAN_EMERGENCIAS', codigoEbco: 'PR-PDO-07.01', titulo: 'Plan de Emergencias de la Obra', articulo: 'Art. 19', naturaleza: 'derivado_miper', alcancePlantilla: 'obra', accion: 'DIFUSION_FIRMA' },
    { key: 'IRL', tipo: 'IRL', titulo: 'IRL — Información de Riesgos Laborales del cargo', articulo: 'Art. 15', naturaleza: 'derivado_miper', alcancePlantilla: 'obra', accion: 'CAPACITACION_EVALUACION', notaMinima: 70, bloqueante: true },
    itemEppDeCargo(cargo),
    { key: 'ENCUESTA_PSICOSOCIAL', tipo: 'ENCUESTA_PSICOSOCIAL', titulo: 'Encuesta Psicosocial CEAL-SM / SUSESO', naturaleza: 'evidencia_individual', alcancePlantilla: 'persona', accion: 'ENCUESTA', protocolo: 'PSICOSOCIAL' }
];

// Atajos para procedimientos corporativos PR-PO (capacitación + evaluación).
const pp = (key: string, codigoEbco: string, titulo: string, articulo: string, notaMinima: 70 | 90 = 70): Ds44KitItem =>
    ({ key, tipo: key, codigoEbco, titulo, articulo, naturaleza: 'procedimiento_corporativo', alcancePlantilla: 'tenant', accion: 'CAPACITACION_EVALUACION', notaMinima });
const dif = (key: string, codigoEbco: string, titulo: string, articulo: string): Ds44KitItem =>
    ({ key, tipo: key, codigoEbco, titulo, articulo, naturaleza: 'procedimiento_corporativo', alcancePlantilla: 'tenant', accion: 'DIFUSION_FIRMA' });
const ext = (key: string, titulo: string, articulo: string, bloqueante = false): Ds44KitItem =>
    ({ key, tipo: key, titulo, articulo, naturaleza: 'evidencia_individual', alcancePlantilla: 'persona', accion: 'EVIDENCIA_EXTERNA', bloqueante });
const minsal = (protocolo: Ds44ProtocoloMinsal, titulo: string): Ds44KitItem =>
    ({ key: `VIGILANCIA_${protocolo}`, tipo: `VIGILANCIA_${protocolo}`, titulo, articulo: 'Protocolo MINSAL', naturaleza: 'evidencia_individual', alcancePlantilla: 'persona', accion: 'INGRESO_VIGILANCIA', protocolo });

// ─── Kits específicos por cargo (fieles a las tablas EBCO) ────────────────────
const ESPECIFICOS: Record<string, Ds44KitItem[]> = {
    CARPINTERO: [
        ext('EXAMEN_ALTURA', 'Examen de altura física vigente', 'Examen ocupacional', true),
        pp('PR_PO_08', 'PR-PO-08', 'Trabajos en Altura', 'Art. 16', 90),
        pp('PR_PO_11', 'PR-PO-11', 'Moldajes y Descimbre', 'Anexo 8.1', 70),
        pp('PR_PO_23', 'PR-PO-23', 'Instalación de Sistemas de Seguridad', 'Cargo instalador', 70),
        pp('PR_PO_24', 'PR-PO-24', 'Plataformas de Trabajo', 'Art. 16', 70),
        pp('PR_PO_41', 'PR-PO-41', 'SPDC y Protecciones Colectivas', 'Art. 16', 90),
        pp('PR_PO_02', 'PR-PO-02', 'Vehículos y Maquinarias', 'Anexo 8.5', 70),
        dif('PR_PO_14', 'PR-PO-14', 'Orden y Aseo', 'Art. 16'),
        ext('CERT_MOLDAJES', 'Certificado proveedor de moldajes', 'Evidencia externa'),
        ext('CAP_ALZAHOMBRE', 'Capacitación alzahombre (proveedor)', 'Evidencia externa'),
        minsal('PREXOR', 'Vigilancia PREXOR'), minsal('TMERT', 'Vigilancia TMERT'),
        minsal('MMC', 'Vigilancia MMC'), minsal('RUV', 'Vigilancia RUV')
    ],
    JORNAL_ASEO: [
        pp('PR_PO_14', 'PR-PO-14', 'Orden y Aseo', 'Anexo 8.1', 70),
        dif('PR_PO_02', 'PR-PO-02', 'Vehículos y Maquinarias', 'Difusión'),
        dif('PR_PO_24', 'PR-PO-24', 'Plataformas de Trabajo', 'Difusión'),
        pp('PROC_DESCARGA_MIXER', 'PROC. ESPECÍFICO', 'Descarga de mixer', 'Procedimiento específico', 70),
        pp('CAP_LEY_KARIN', 'LEY KARIN', 'Capacitación Ley Karin', 'Ley 21.643', 70),
        minsal('RUV', 'Vigilancia RUV (PR-PMIN-12)'), minsal('TMERT', 'Vigilancia TMERT-MMC')
    ],
    MAESTRO_TERMINACIONES: [
        ext('EXAMEN_ALTURA', 'Examen de altura física vigente', 'Examen ocupacional', true),
        pp('PR_PO_22', 'PR-PO-22', 'Revestimiento', 'Procedimiento del cargo', 70),
        pp('PR_PO_08', 'PR-PO-08', 'Trabajos en Altura', 'SPDC anual', 90),
        pp('PR_PO_24', 'PR-PO-24', 'Plataformas de Trabajo', 'Art. 16', 70),
        pp('PR_PO_41', 'PR-PO-41', 'SPDC y Protecciones Colectivas', 'Art. 16', 90),
        dif('PR_PO_14', 'PR-PO-14', 'Orden y Aseo', 'Art. 16'),
        dif('PR_PO_02', 'PR-PO-02', 'Vehículos y Maquinarias', 'Difusión'),
        dif('HDS_QUIMICOS', 'HDS', 'HDS + ficha técnica por producto químico', 'Crítico: EPP respiratorio'),
        pp('CAP_HERRAMIENTAS', 'CAP. HERRAMIENTAS', 'Herramientas autorizadas (cuchillo retráctil)', 'Capacitación', 70),
        minsal('RUV', 'Vigilancia RUV'), minsal('PSICOSOCIAL', 'Vigilancia Psicosocial')
    ],
    MAESTRO_ALBANIL: [
        ext('EXAMEN_ALTURA', 'Examen de altura física vigente', 'Examen ocupacional', true),
        pp('PR_PO_08', 'PR-PO-08', 'Trabajos en Altura', 'SPDC anual', 90),
        pp('PR_PO_24', 'PR-PO-24', 'Plataformas de Trabajo (banquillos/escala 3 peldaños)', 'Art. 16', 70),
        pp('PR_PO_41', 'PR-PO-41', 'SPDC y Protecciones Colectivas', 'Art. 16', 90),
        pp('PR_PO_02', 'PR-PO-02', 'Vehículos y Maquinarias', 'Distancia con maquinaria', 70),
        dif('PR_PO_23', 'PR-PO-23', 'Instalación de Sistemas de Seguridad (usuario)', 'Usuario de anclajes'),
        dif('PR_PO_14', 'PR-PO-14', 'Orden y Aseo', 'Art. 16'),
        pp('CAP_LEY_KARIN', 'LEY KARIN', 'Capacitación Ley Karin', 'Ley 21.643', 70),
        minsal('PSICOSOCIAL', 'Vigilancia Psicosocial'), minsal('MMC', 'Vigilancia MMC')
    ],
    TRAZADOR: [
        ext('EXAMEN_ALTURA', 'Examen de altura física vigente', 'Examen ocupacional', true),
        pp('PR_PO_08', 'PR-PO-08', 'Trabajos en Altura (montaje pilares)', 'SPDC anual', 90),
        pp('PR_PO_41', 'PR-PO-41', 'SPDC y Protecciones Colectivas', 'Art. 16', 90),
        pp('PR_PO_02', 'PR-PO-02', 'Vehículos y Maquinarias', 'Art. 16', 70),
        dif('PR_PO_23', 'PR-PO-23', 'Instalación de Sistemas de Seguridad (banderas/fase amarilla)', 'Usuario'),
        dif('PR_PO_24', 'PR-PO-24', 'Plataformas de Trabajo', 'Difusión'),
        dif('PR_PO_14', 'PR-PO-14', 'Orden y Aseo', 'Art. 16'),
        pp('FICHA_PORTAESTACAS', 'FICHA N°1', 'Portaestacas / guantes anticorte', 'Capacitación', 70),
        dif('PR_PO_21_36_38', 'PR-PO-21/36/38', 'Vías despejadas, montaje pilares', 'Difusión'),
        minsal('SILICE', 'Vigilancia SÍLICE (candidato PREXOR)'), minsal('RUV', 'Vigilancia RUV')
    ]
};

// Kit genérico (cargos legacy / OTRO): equivale al onboarding actual, para no
// romper datos previos. Mantiene IRL, RI, capacitación, PTS, EPP e inducción.
export const DS44_KIT_GENERICO: Ds44KitItem[] = [
    { key: 'IRL', tipo: 'IRL', titulo: 'IRL — Información de Riesgos Laborales', articulo: 'Art. 15', naturaleza: 'derivado_miper', alcancePlantilla: 'obra', accion: 'CAPACITACION_EVALUACION', notaMinima: 70, bloqueante: true },
    { key: 'CAPACITACION_SST', tipo: 'CAPACITACION_SST', titulo: 'Capacitación SST 8 horas', articulo: 'Art. 16', naturaleza: 'procedimiento_corporativo', alcancePlantilla: 'obra', accion: 'CAPACITACION_EVALUACION', notaMinima: 70, requiereFirmaRelator: true },
    { key: 'RI_76', tipo: 'REGLAMENTO_INTERNO', titulo: 'Entrega RIHS/RIOHS', articulo: 'Art. 56', naturaleza: 'procedimiento_corporativo', alcancePlantilla: 'tenant', accion: 'DIFUSION_FIRMA' },
    { key: 'PROCEDIMIENTO_TRABAJO', tipo: 'PROCEDIMIENTO_TRABAJO', titulo: 'Procedimientos de Trabajo Seguro', articulo: 'Art. 10', naturaleza: 'procedimiento_corporativo', alcancePlantilla: 'obra', accion: 'DIFUSION_FIRMA' },
    { key: 'ENTREGA_EPP', tipo: 'ENTREGA_EPP', titulo: 'Entrega y Capacitación EPP', articulo: 'Art. 13', naturaleza: 'evidencia_individual', alcancePlantilla: 'persona', accion: 'ENTREGA_EPP', matrizEpp: EPP_GENERICO },
    { key: 'INDUCCION', tipo: 'INDUCCION', titulo: 'Inducción Plan de Emergencia', articulo: 'Art. 19', naturaleza: 'evidencia_individual', alcancePlantilla: 'persona', accion: 'DIFUSION_FIRMA' }
];

// Kits precomputados por código de cargo (transversal + específicos).
export const DS44_CARGO_KITS: Record<string, Ds44KitItem[]> = {
    CARPINTERO: [...kitTransversal('CARPINTERO'), ...ESPECIFICOS.CARPINTERO],
    JORNAL_ASEO: [...kitTransversal('JORNAL_ASEO'), ...ESPECIFICOS.JORNAL_ASEO],
    MAESTRO_TERMINACIONES: [...kitTransversal('MAESTRO_TERMINACIONES'), ...ESPECIFICOS.MAESTRO_TERMINACIONES],
    MAESTRO_ALBANIL: [...kitTransversal('MAESTRO_ALBANIL'), ...ESPECIFICOS.MAESTRO_ALBANIL],
    TRAZADOR: [...kitTransversal('TRAZADOR'), ...ESPECIFICOS.TRAZADOR]
};

// ─── Helpers de catálogo / migración ─────────────────────────────────────────
const CARGO_LABEL_INDEX: Record<string, string> = (() => {
    const idx: Record<string, string> = {};
    DS44_CARGOS.forEach((c) => { idx[c.codigo] = c.label; });
    return idx;
})();

export function getCargoLabel(codigo?: string | null): string {
    if (!codigo) return '';
    return CARGO_LABEL_INDEX[codigo] || codigo;
}

// Normaliza texto libre / etiqueta / código a un código del catálogo. Mapea los
// alias EBCO ("carpintero de seguridad" → CARPINTERO; "maestro pintor" →
// terminaciones) y cae a OTRO si no reconoce. Usado en migración y carga masiva.
export function normalizeCargoCodigo(input?: string | null): string {
    if (!input) return 'OTRO';
    const raw = String(input).trim();
    if (CARGO_LABEL_INDEX[raw]) return raw; // ya es un código válido
    const n = raw.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    if (n.includes('carpintero')) return 'CARPINTERO';
    if (n.includes('jornal') && (n.includes('aseo') || n.includes('acarreo'))) return 'JORNAL_ASEO';
    if (n.includes('terminacion') || n.includes('pintor') || n.includes('revestimiento')) return 'MAESTRO_TERMINACIONES';
    if (n.includes('albanil') || (n.includes('maestro') && n.includes('alban'))) return 'MAESTRO_ALBANIL';
    if (n.includes('trazador') || n.includes('topograf')) return 'TRAZADOR';
    // Coincidencia directa por etiqueta de cualquier cargo (incl. legacy)
    const byLabel = DS44_CARGOS.find((c) => c.label.toLowerCase() === n);
    if (byLabel) return byLabel.codigo;
    if (n.includes('jornal')) return 'JORNAL';
    if (n.includes('operario')) return 'OPERARIO';
    if (n.includes('soldador')) return 'SOLDADOR';
    if (n.includes('electricista')) return 'ELECTRICISTA';
    if (n.includes('ayudante')) return 'AYUDANTE';
    return 'OTRO';
}

export function isCargoLegacy(codigo?: string | null): boolean {
    const c = DS44_CARGOS.find((x) => x.codigo === codigo);
    return Boolean(c?.legacy);
}

// Resuelve el kit de onboarding de un cargo. Cargos EBCO → kit específico;
// legacy / OTRO / desconocido → kit genérico (compatibilidad).
export function resolveCargoKit(codigo?: string | null): Ds44KitItem[] {
    if (codigo && DS44_CARGO_KITS[codigo]) return DS44_CARGO_KITS[codigo];
    return DS44_KIT_GENERICO;
}
