/**
 * Estructura preventiva — DS 44/2024 (Arts. 23, 50, 65, 66).
 *
 * ESPEJO de Backend/lib/estructura-preventiva.js — mantener sincronizados.
 *
 * Existe en el cliente porque el cálculo de obligaciones tiene que funcionar sin
 * conexión (el sistema es offline first) y dar exactamente el mismo resultado que
 * en el servidor. Es lógica pura: no llama a la API ni guarda nada.
 *
 * PRINCIPIO RECTOR: el umbral define cuándo un órgano es OBLIGATORIO, nunca
 * cuándo está PERMITIDO. La UI jamás bloquea constituir por no llegar al umbral;
 * ofrece hacerlo y lo rotula como voluntario.
 */

export const TIPO_ORGANO = {
    COMITE_PARITARIO: 'ComiteParitario',
    DELEGADO_SST: 'DelegadoSST',
    DEPARTAMENTO_PREVENCION: 'DepartamentoPrevencion',
    ENCARGADO_GESTION_RIESGO: 'EncargadoGestionRiesgo',
} as const;
export type TipoOrgano = typeof TIPO_ORGANO[keyof typeof TIPO_ORGANO];

export const AMBITO = { EMPRESA: 'empresa', OBRA: 'obra' } as const;
export type Ambito = typeof AMBITO[keyof typeof AMBITO];

export const ORIGEN = { OBLIGATORIO: 'Obligatorio', VOLUNTARIO: 'Voluntario' } as const;
export type Origen = typeof ORIGEN[keyof typeof ORIGEN];

export const ESTADO_ORGANO = { VIGENTE: 'Vigente', VENCIDO: 'Vencido', DISUELTO: 'Disuelto' } as const;
export type EstadoOrgano = typeof ESTADO_ORGANO[keyof typeof ESTADO_ORGANO];

export const ESTAMENTO = { EMPLEADOR: 'Empleador', TRABAJADORES: 'Trabajadores', NO_APLICA: 'NoAplica' } as const;
export type Estamento = typeof ESTAMENTO[keyof typeof ESTAMENTO];

export const CALIDAD = { TITULAR: 'Titular', SUPLENTE: 'Suplente' } as const;
export type Calidad = typeof CALIDAD[keyof typeof CALIDAD];

export const CARGO_ORGANO = {
    PRESIDENTE: 'Presidente',
    SECRETARIO: 'Secretario',
    INTEGRANTE: 'Integrante',
    DELEGADO: 'Delegado',
    EXPERTO_RESPONSABLE: 'ExpertoResponsable',
    ENCARGADO: 'Encargado',
} as const;
export type CargoOrgano = typeof CARGO_ORGANO[keyof typeof CARGO_ORGANO];

export const TIPO_REUNION = { ORDINARIA: 'Ordinaria', EXTRAORDINARIA: 'Extraordinaria' } as const;
export type TipoReunion = typeof TIPO_REUNION[keyof typeof TIPO_REUNION];

export const CAUSAL_EXTRAORDINARIA = {
    PETICION_CONJUNTA: 'PeticionConjunta',
    ACCIDENTE_FATAL_O_GRAVE: 'AccidenteFatalOGrave',
    RIESGO_GRAVE_INMINENTE: 'RiesgoGraveInminente',
} as const;
export type CausalExtraordinaria = typeof CAUSAL_EXTRAORDINARIA[keyof typeof CAUSAL_EXTRAORDINARIA];

export const CAUSAL_LABEL: Record<CausalExtraordinaria, string> = {
    PeticionConjunta: 'Petición conjunta de los miembros',
    AccidenteFatalOGrave: 'Accidente del trabajo fatal o grave',
    RiesgoGraveInminente: 'Riesgo grave e inminente',
};

export const ESTADO_REUNION = { PROGRAMADA: 'Programada', REALIZADA: 'Realizada', NO_REALIZADA: 'NoRealizada' } as const;
export type EstadoReunion = typeof ESTADO_REUNION[keyof typeof ESTADO_REUNION];

/** Nombre con el que el decreto llama a cada figura. */
export const TIPO_ORGANO_LABEL: Record<TipoOrgano, string> = {
    ComiteParitario: 'Comité Paritario de Higiene y Seguridad',
    DelegadoSST: 'Delegado de Seguridad y Salud en el Trabajo',
    DepartamentoPrevencion: 'Departamento de Prevención de Riesgos',
    EncargadoGestionRiesgo: 'Encargado en materia de Gestión del Riesgo',
};

export const TIPO_ORGANO_LABEL_CORTO: Record<TipoOrgano, string> = {
    ComiteParitario: 'Comité Paritario',
    DelegadoSST: 'Delegado SST',
    DepartamentoPrevencion: 'Departamento de Prevención',
    EncargadoGestionRiesgo: 'Encargado de Gestión del Riesgo',
};

// ─── Umbrales (Arts. 23, 50, 66) ─────────────────────────────────────────────

export const UMBRAL_CPHS = 25;
export const UMBRAL_DELEGADO_MIN = 10;
export const UMBRAL_DPR = 100;
export const ANIOS_MANDATO = 2;
export const MESES_CURSO_OPR = 6;
export const DIAS_HABILES_REGISTRO_DT = 15;

// ─── Dotación ────────────────────────────────────────────────────────────────

type PersonaMin = {
    estado?: string;
    asignaciones?: Array<{ obraId?: string; estado?: string }>;
};

/** Personas con asignación activa a la obra. No suma contratistas: fuera de alcance. */
export function dotacionDeObra(personas: PersonaMin[], obraId: string): number {
    if (!Array.isArray(personas) || !obraId) return 0;
    return personas.filter((p) => {
        if (p?.estado === 'inactivo') return false;
        return (p?.asignaciones || []).some((a) => a?.obraId === obraId && a?.estado !== 'finalizada');
    }).length;
}

export function dotacionDeEmpresa(personas: PersonaMin[]): number {
    if (!Array.isArray(personas)) return 0;
    return personas.filter((p) => p?.estado !== 'inactivo').length;
}

export type DotacionEfectiva = {
    dotacion: number;
    origen: 'calculada' | 'declarada';
    calculada: number;
    declarada: number | null;
    observacion: string | null;
};

/** La calculada manda salvo override declarado. `origen` deja ver de dónde salió. */
export function dotacionEfectiva({
    calculada = 0, declarada = null, observacion = null,
}: { calculada?: number; declarada?: number | null; observacion?: string | null }): DotacionEfectiva {
    const usa = declarada !== null && declarada !== undefined && Number.isFinite(Number(declarada));
    return {
        dotacion: usa ? Number(declarada) : Number(calculada) || 0,
        origen: usa ? 'declarada' : 'calculada',
        calculada: Number(calculada) || 0,
        declarada: usa ? Number(declarada) : null,
        observacion: usa ? observacion : null,
    };
}

// ─── Obligaciones ────────────────────────────────────────────────────────────

export type ObligacionFigura = { aplica: boolean; obligatorio: boolean; motivo: string };
export type Obligaciones = { dotacion: number; ambito: Ambito } & Record<TipoOrgano, ObligacionFigura>;

export function obligacionesDeAmbito({
    dotacion = 0, ambito = AMBITO.OBRA, hayCphsVigente = false,
}: { dotacion?: number; ambito?: Ambito; hayCphsVigente?: boolean }): Obligaciones {
    const n = Number(dotacion) || 0;
    const esEmpresa = ambito === AMBITO.EMPRESA;

    const cphsObligatorio = n > UMBRAL_CPHS;
    const enRangoDelegado = n >= UMBRAL_DELEGADO_MIN && n <= UMBRAL_CPHS;
    const delegadoObligatorio = enRangoDelegado && !hayCphsVigente;
    const dprObligatorio = esEmpresa && n > UMBRAL_DPR;
    const encargadoAplica = esEmpresa && n <= UMBRAL_DPR;

    return {
        dotacion: n,
        ambito,
        [TIPO_ORGANO.COMITE_PARITARIO]: {
            aplica: true,
            obligatorio: cphsObligatorio,
            motivo: cphsObligatorio
                ? `Más de ${UMBRAL_CPHS} personas trabajadoras en este ámbito (Art. 23).`
                : `Con ${n} personas no es obligatorio, pero puede constituirse de forma voluntaria (Art. 23).`,
        },
        [TIPO_ORGANO.DELEGADO_SST]: {
            aplica: true,
            obligatorio: delegadoObligatorio,
            motivo: delegadoObligatorio
                ? `Entre ${UMBRAL_DELEGADO_MIN} y ${UMBRAL_CPHS} personas y sin comité paritario en este lugar (Art. 66).`
                : enRangoDelegado && hayCphsVigente
                    ? 'No es exigible porque en este ámbito ya funciona un comité paritario vigente (Art. 66).'
                    : `Con ${n} personas no es obligatorio, pero puede designarse de forma voluntaria (Art. 66).`,
        },
        [TIPO_ORGANO.DEPARTAMENTO_PREVENCION]: {
            aplica: esEmpresa,
            obligatorio: dprObligatorio,
            motivo: !esEmpresa
                ? 'El Departamento de Prevención de Riesgos se determina a nivel de entidad empleadora, no por obra.'
                : dprObligatorio
                    ? `Más de ${UMBRAL_DPR} personas trabajadoras: debe dirigirlo un experto inscrito en la Seremi de Salud (Arts. 50 y 55).`
                    : `Con ${n} personas no es obligatorio, pero puede constituirse de forma voluntaria (Art. 50).`,
        },
        [TIPO_ORGANO.ENCARGADO_GESTION_RIESGO]: {
            aplica: encargadoAplica,
            obligatorio: false,
            motivo: !esEmpresa
                ? 'El encargado en materia de gestión del riesgo se designa a nivel de entidad empleadora, no por obra.'
                : encargadoAplica
                    ? `Figura disponible para entidades de hasta ${UMBRAL_DPR} personas que la designen (Art. 65).`
                    : `Con más de ${UMBRAL_DPR} personas corresponde Departamento de Prevención de Riesgos (Art. 50).`,
        },
    } as Obligaciones;
}

export const origenSegunObligacion = (obligatorio: boolean): Origen =>
    obligatorio ? ORIGEN.OBLIGATORIO : ORIGEN.VOLUNTARIO;

export function perfilRegistrosIndicadores(dotacionEmpresa: number) {
    const conDpr = (Number(dotacionEmpresa) || 0) > UMBRAL_DPR;
    return {
        perfil: conDpr ? ('extendido' as const) : ('minimo' as const),
        itemFuf: conDpr ? 46 : 47,
        articulo: conDpr ? 'Arts. 73 y 74' : 'Art. 75',
    };
}

/**
 * Frase que resume la obligación del ámbito en lenguaje llano, para el paso de
 * estructura preventiva. El encargo la pide explícitamente (§5.1).
 */
export function resumenObligacionesTexto(obligaciones: Obligaciones): string {
    const n = obligaciones.dotacion;
    const exigidas = (Object.keys(TIPO_ORGANO_LABEL) as TipoOrgano[])
        .filter((t) => obligaciones[t]?.obligatorio)
        .map((t) => TIPO_ORGANO_LABEL[t]);

    const personas = `${n} ${n === 1 ? 'persona trabajadora' : 'personas trabajadoras'}`;
    if (exigidas.length === 0) {
        return `Con ${personas} no corresponde constituir ningún órgano de forma obligatoria. Puedes constituirlos igualmente de forma voluntaria.`;
    }
    const lista = exigidas.length === 1
        ? exigidas[0]
        : `${exigidas.slice(0, -1).join(', ')} y ${exigidas[exigidas.length - 1]}`;
    return `Con ${personas} corresponde constituir ${lista}.`;
}

// ─── Mandato y vigencia ──────────────────────────────────────────────────────

export const tieneMandato = (tipo: TipoOrgano): boolean =>
    tipo === TIPO_ORGANO.COMITE_PARITARIO || tipo === TIPO_ORGANO.DELEGADO_SST;

export function fechaTerminoMandato(fechaEleccionISO: string | null, anios = ANIOS_MANDATO): string | null {
    if (!fechaEleccionISO) return null;
    const d = new Date(fechaEleccionISO);
    if (Number.isNaN(d.getTime())) return null;
    const fin = new Date(d);
    fin.setFullYear(fin.getFullYear() + anios);
    return fin.toISOString();
}

type OrganoMin = { tipo: TipoOrgano; estado?: string; fechaTerminoMandato?: string | null };

/** El vencimiento se DERIVA de la fecha: nadie tiene que cerrar el mandato a mano. */
export function estadoOrgano(organo: OrganoMin | null, ahora: Date = new Date()): EstadoOrgano | null {
    if (!organo) return null;
    if (organo.estado === ESTADO_ORGANO.DISUELTO) return ESTADO_ORGANO.DISUELTO;
    if (!tieneMandato(organo.tipo)) return (organo.estado as EstadoOrgano) || ESTADO_ORGANO.VIGENTE;
    const fin = organo.fechaTerminoMandato ? new Date(organo.fechaTerminoMandato) : null;
    if (fin && !Number.isNaN(fin.getTime()) && fin.getTime() < ahora.getTime()) return ESTADO_ORGANO.VENCIDO;
    return ESTADO_ORGANO.VIGENTE;
}

export function hayCphsVigente(organos: OrganoMin[], ahora: Date = new Date()): boolean {
    if (!Array.isArray(organos)) return false;
    return organos.some((o) => o?.tipo === TIPO_ORGANO.COMITE_PARITARIO
        && estadoOrgano(o, ahora) === ESTADO_ORGANO.VIGENTE);
}

export function fechaLimiteCursoOpr(fechaEleccionISO: string | null): string | null {
    if (!fechaEleccionISO) return null;
    const d = new Date(fechaEleccionISO);
    if (Number.isNaN(d.getTime())) return null;
    const lim = new Date(d);
    lim.setMonth(lim.getMonth() + MESES_CURSO_OPR);
    return lim.toISOString();
}

// ─── Validaciones de composición (espejo de la sección 10) ───────────────────

export const COMPOSICION_CPHS = { titularesPorEstamento: 3 };

export type MiembroBorrador = {
    personaId: string;
    nombre?: string;
    estamento: Estamento;
    calidad: Calidad;
    cargo: CargoOrgano;
};

/**
 * Errores de composición del órgano. El backend valida lo mismo: esto es para
 * que el formulario avise antes de enviar, no para reemplazar esa validación.
 */
export function validarMiembros(miembros: MiembroBorrador[], tipo: TipoOrgano = TIPO_ORGANO.COMITE_PARITARIO): string[] {
    const errores: string[] = [];
    const lista = (miembros || []).filter(Boolean);

    const porPersona = new Map<string, MiembroBorrador[]>();
    for (const m of lista) {
        if (!m.personaId) { errores.push('Hay un integrante sin persona asociada.'); continue; }
        if (!porPersona.has(m.personaId)) porPersona.set(m.personaId, []);
        porPersona.get(m.personaId)!.push(m);
    }

    for (const apariciones of porPersona.values()) {
        if (apariciones.length < 2) continue;
        const nombre = apariciones[0].nombre || 'Una persona';
        const calidades = new Set(apariciones.map((m) => m.calidad));
        const estamentos = new Set(apariciones.map((m) => m.estamento));
        if (calidades.has(CALIDAD.TITULAR) && calidades.has(CALIDAD.SUPLENTE)) {
            errores.push(`${nombre} no puede ser titular y suplente del mismo órgano.`);
        } else if (estamentos.size > 1) {
            errores.push(`${nombre} no puede representar a ambos estamentos.`);
        } else {
            errores.push(`${nombre} está repetido en el órgano.`);
        }
    }

    if (tipo === TIPO_ORGANO.COMITE_PARITARIO) {
        for (const estamento of [ESTAMENTO.EMPLEADOR, ESTAMENTO.TRABAJADORES] as Estamento[]) {
            const titulares = lista.filter((m) => m.estamento === estamento && m.calidad === CALIDAD.TITULAR).length;
            if (titulares !== COMPOSICION_CPHS.titularesPorEstamento) {
                const etiqueta = estamento === ESTAMENTO.EMPLEADOR ? 'la entidad empleadora' : 'las personas trabajadoras';
                errores.push(`El comité exige ${COMPOSICION_CPHS.titularesPorEstamento} representantes titulares de ${etiqueta} (Art. 23); hay ${titulares}.`);
            }
        }
        for (const cargo of [CARGO_ORGANO.PRESIDENTE, CARGO_ORGANO.SECRETARIO] as CargoOrgano[]) {
            const cuantos = lista.filter((m) => m.cargo === cargo).length;
            if (cuantos !== 1) errores.push(`Debe haber exactamente un ${cargo.toLowerCase()}; hay ${cuantos}.`);
        }
    }

    return errores;
}

// ─── Documentos por período (ítems 38, 46 y 47) ──────────────────────────────
//
// El programa de trabajo del comité y los registros e indicadores de SST son lo
// mismo para el sistema: un documento que se carga una vez por período y vence al
// terminar ese período. No son entidades propias; su contenido es del usuario.

export type EstadoPeriodico = 'Pendiente' | 'Cargado' | 'Vencido';

/** Período anual de una fecha. Por defecto, el año calendario. */
export const periodoAnual = (fecha: Date = new Date()): string =>
    String(new Date(fecha).getUTCFullYear());

/**
 * `Vencido` es que el período ya cerró sin documento, distinto de `Pendiente`
 * (el período corre y aún hay tiempo). Un fiscalizador distingue las dos cosas.
 */
export function estadoDocumentoPeriodico<T extends { periodo?: string | null }>(
    documentos: T[], periodoExigido?: string, ahora: Date = new Date()
): { estado: EstadoPeriodico; periodo: string; documento: T | null } {
    const periodo = String(periodoExigido || periodoAnual(ahora));
    const documento = (documentos || []).find((d) => String(d?.periodo || '') === periodo) || null;
    if (documento) return { estado: 'Cargado', periodo, documento };
    const actual = periodoAnual(ahora);
    return { estado: Number(periodo) < Number(actual) ? 'Vencido' : 'Pendiente', periodo, documento: null };
}

/**
 * Funciones mínimas del CPHS (Art. 47), como TEXTO INFORMATIVO en la pantalla de
 * carga del programa de trabajo. El sistema no verifica que el archivo las cubra:
 * un checklist daría falsa sensación de validación sobre algo que nadie comprobó.
 */
export const FUNCIONES_CPHS_ART47: string[] = [
    'Asesorar e instruir a las personas trabajadoras en el uso correcto de los elementos de protección personal.',
    'Vigilar el cumplimiento de las medidas de prevención, higiene y seguridad.',
    'Investigar las causas de los accidentes del trabajo y enfermedades profesionales.',
    'Decidir si el accidente o la enfermedad se debió a negligencia inexcusable de la persona trabajadora.',
    'Indicar la adopción de las medidas de higiene y seguridad que sirvan para la prevención de riesgos.',
    'Cumplir las demás funciones que le encomiende el Organismo Administrador.',
    'Promover la realización de cursos de capacitación profesional.',
    'Informar a la entidad empleadora ante la existencia de un riesgo grave e inminente.',
];

/** Contenido esperado del documento de registros e indicadores, por perfil. */
export const CONTENIDO_REGISTROS_INDICADORES: Record<'extendido' | 'minimo', string[]> = {
    extendido: [
        'Incidentes o sucesos peligrosos.',
        'Accidentes del trabajo y de trayecto.',
        'Enfermedades profesionales.',
        'Personas trabajadoras en vigilancia de la salud.',
        'Tasa de accidentabilidad.',
        'Tasa mensual de frecuencia.',
        'Tasa semestral de gravedad.',
        'Todo lo anterior diferenciado por sexo.',
    ],
    minimo: [
        'Tasa anual de accidentabilidad por accidentes del trabajo.',
        'Accidentes del trabajo y de trayecto.',
        'Enfermedades profesionales.',
    ],
};
