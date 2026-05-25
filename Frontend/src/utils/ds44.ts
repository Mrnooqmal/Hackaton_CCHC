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

// ─── FASE CHECK ───────────────────────────────────────────────────────────────
export const DS44_CHECK_ITEM = {
    key: 'INFORME_ANUAL',
    titulo: 'Informe Anual de Gestión Preventiva',
    descripcion: 'Solo aplica a obras/empresas con departamento de prevención (>100 trabajadores).',
    articulo: 'Fase CHECK'
};
