/**
 * Estructura preventiva — DS 44/2024 (Arts. 23, 36, 39, 50, 55, 65, 66).
 *
 * ESPEJO de Frontend/src/utils/estructuraPreventiva.ts — mantener sincronizados.
 *
 * Este es el ÚNICO lugar donde se calculan los umbrales de dotación y las
 * obligaciones que derivan de ellos. Ningún otro módulo debe reimplementarlos:
 * antes de esto, `Tenant.TAMANOS` cortaba en 1-9 / 10-49 / 50-199 / 200+, cortes
 * que no corresponden a ningún umbral del decreto, y `evalAplicabilidad` del
 * frontend tenía otros distintos. Dos fuentes discrepando sobre el mismo umbral
 * es peor que una equivocada: el sistema le dice al cliente "esto no te aplica"
 * y el cliente confía.
 *
 * La lógica es PURA y determinista a propósito (patrón de lib/ptp.js): el cálculo
 * de obligaciones tiene que poder correr sin conexión en el cliente y dar el
 * mismo resultado que en Lambda.
 *
 * PRINCIPIO RECTOR: el umbral define cuándo un órgano es OBLIGATORIO, nunca
 * cuándo está PERMITIDO. Constituir bajo el umbral siempre se puede, y queda
 * registrado como voluntario. Ver `origenSegunObligacion`.
 *
 * FUERA DE ALCANCE: subcontratación. La dotación de una obra es la de la obra,
 * sin sumar contratistas ni subcontratistas, y no se modelan comités de faena
 * mixtos (eso se cubre con el documento del ítem 29).
 */

// ─── Vocabulario ─────────────────────────────────────────────────────────────

const TIPO_ORGANO = {
    COMITE_PARITARIO: 'ComiteParitario',
    DELEGADO_SST: 'DelegadoSST',
    DEPARTAMENTO_PREVENCION: 'DepartamentoPrevencion',
    ENCARGADO_GESTION_RIESGO: 'EncargadoGestionRiesgo',
};

/** Ámbito en que se cuenta la dotación. CPHS y delegado se calculan por cada uno. */
const AMBITO = { EMPRESA: 'empresa', OBRA: 'obra' };

/** Origen histórico del órgano: se fija al constituirlo y no se recalcula. */
const ORIGEN = { OBLIGATORIO: 'Obligatorio', VOLUNTARIO: 'Voluntario' };

const ESTADO_ORGANO = { VIGENTE: 'Vigente', VENCIDO: 'Vencido', DISUELTO: 'Disuelto' };

const ESTAMENTO = { EMPLEADOR: 'Empleador', TRABAJADORES: 'Trabajadores', NO_APLICA: 'NoAplica' };

const CALIDAD = { TITULAR: 'Titular', SUPLENTE: 'Suplente' };

const CARGO_ORGANO = {
    PRESIDENTE: 'Presidente',
    SECRETARIO: 'Secretario',
    INTEGRANTE: 'Integrante',
    DELEGADO: 'Delegado',
    EXPERTO_RESPONSABLE: 'ExpertoResponsable',
    ENCARGADO: 'Encargado',
};

const TIPO_REUNION = { ORDINARIA: 'Ordinaria', EXTRAORDINARIA: 'Extraordinaria' };

/** Causales del Art. 39 para convocar reunión extraordinaria. */
const CAUSAL_EXTRAORDINARIA = {
    PETICION_CONJUNTA: 'PeticionConjunta',
    ACCIDENTE_FATAL_O_GRAVE: 'AccidenteFatalOGrave',
    RIESGO_GRAVE_INMINENTE: 'RiesgoGraveInminente',
};

const ESTADO_REUNION = { PROGRAMADA: 'Programada', REALIZADA: 'Realizada', NO_REALIZADA: 'NoRealizada' };

// ─── Umbrales ────────────────────────────────────────────────────────────────
//
// Los tres cortes del decreto. Se expresan como constantes con nombre porque
// aparecen en textos de UI y en los tests: un 25 suelto en el código no dice si
// es "hasta 25" o "más de 25".

/** Art. 23: CPHS obligatorio con MÁS de 25 personas trabajadoras. */
const UMBRAL_CPHS = 25;
/** Art. 66: delegado SST desde 10 personas (y hasta el umbral del CPHS). */
const UMBRAL_DELEGADO_MIN = 10;
/** Arts. 50 y 55: DPR obligatorio con MÁS de 100 personas trabajadoras. */
const UMBRAL_DPR = 100;

/** Años de mandato del CPHS y del delegado SST (Arts. 23 y 66). */
const ANIOS_MANDATO = 2;
/** Art. 32: plazo para el curso OPR de los electos, en meses desde la elección. */
const MESES_CURSO_OPR = 6;
/** Art. 36: plazo para registrar el acta de constitución en la DT, en días hábiles. */
const DIAS_HABILES_REGISTRO_DT = 15;

// ─── Dotación ────────────────────────────────────────────────────────────────

/**
 * Dotación de una obra: personas con asignación ACTIVA a esa obra.
 *
 * Se deriva de `Persona.asignaciones` en vez de guardarse como campo porque el
 * vínculo laboral ya vive ahí y un contador paralelo se desincroniza en cuanto
 * alguien vincula a un trabajador desde otra pantalla.
 *
 * No suma contratistas ni subcontratistas: fuera de alcance por diseño.
 */
function dotacionDeObra(personas, obraId) {
    if (!Array.isArray(personas) || !obraId) return 0;
    return personas.filter((p) => {
        if (p?.estado === 'inactivo') return false;
        const asignaciones = Array.isArray(p?.asignaciones) ? p.asignaciones : [];
        return asignaciones.some((a) => a?.obraId === obraId && a?.estado !== 'finalizada');
    }).length;
}

/** Dotación de la entidad empleadora: personas activas del tenant. */
function dotacionDeEmpresa(personas) {
    if (!Array.isArray(personas)) return 0;
    return personas.filter((p) => p?.estado !== 'inactivo').length;
}

/**
 * Dotación efectiva de un ámbito. La calculada manda, salvo que exista un
 * override declarado explícitamente (el encargo lo permite "con observación").
 *
 * Devuelve también `origen` para que la UI pueda decir de dónde salió el número:
 * un fiscalizador pregunta por la dotación y la respuesta no puede ser un campo
 * sin procedencia.
 */
function dotacionEfectiva({ calculada = 0, declarada = null, observacion = null } = {}) {
    const usaDeclarada = declarada !== null && declarada !== undefined && Number.isFinite(Number(declarada));
    return {
        dotacion: usaDeclarada ? Number(declarada) : Number(calculada) || 0,
        origen: usaDeclarada ? 'declarada' : 'calculada',
        calculada: Number(calculada) || 0,
        declarada: usaDeclarada ? Number(declarada) : null,
        observacion: usaDeclarada ? (observacion || null) : null,
    };
}

// ─── Obligaciones por ámbito ─────────────────────────────────────────────────

/**
 * Obligaciones de estructura preventiva para un ámbito.
 *
 * @param {object} p
 * @param {number} p.dotacion          Personas trabajadoras del ámbito.
 * @param {'empresa'|'obra'} p.ambito  DPR y encargado solo existen a nivel empresa.
 * @param {boolean} p.hayCphsVigente   Si en ESTE ámbito funciona un CPHS vigente.
 * @returns {object} obligación por figura, cada una con `obligatorio`, `aplica` y `motivo`.
 */
function obligacionesDeAmbito({ dotacion = 0, ambito = AMBITO.OBRA, hayCphsVigente = false } = {}) {
    const n = Number(dotacion) || 0;
    const esEmpresa = ambito === AMBITO.EMPRESA;

    // Art. 23: más de 25. El conteo es POR ÁMBITO: que la empresa tenga comité no
    // exime a una faena de 30 personas de constituir el suyo.
    const cphsObligatorio = n > UMBRAL_CPHS;

    // Art. 66: entre 10 y 25 Y que en ese lugar no funcione un CPHS. Si hay comité
    // vigente en el ámbito, el delegado deja de ser exigible (nunca ambos).
    const enRangoDelegado = n >= UMBRAL_DELEGADO_MIN && n <= UMBRAL_CPHS;
    const delegadoObligatorio = enRangoDelegado && !hayCphsVigente;

    // Arts. 50 y 55: más de 100, solo entidad empleadora.
    const dprObligatorio = esEmpresa && n > UMBRAL_DPR;

    // Art. 65: figura para entidades de HASTA 100 que la hayan designado. Nunca es
    // obligatoria; es una opción habilitada, y deja de estarlo si hay DPR exigible.
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
            obligatorio: false, // Art. 65: nunca obligatorio, es una figura designable.
            motivo: !esEmpresa
                ? 'El encargado en materia de gestión del riesgo se designa a nivel de entidad empleadora, no por obra.'
                : encargadoAplica
                    ? `Figura disponible para entidades de hasta ${UMBRAL_DPR} personas que la designen (Art. 65).`
                    : `Con más de ${UMBRAL_DPR} personas corresponde Departamento de Prevención de Riesgos (Art. 50).`,
        },
    };
}

/**
 * Origen que corresponde grabar al constituir un órgano AHORA. Queda histórico:
 * si la dotación cambia después, el órgano no cambia de origen. Que hoy sea
 * obligatorio no convierte en incumplimiento el período en que fue voluntario.
 */
function origenSegunObligacion(obligatorio) {
    return obligatorio ? ORIGEN.OBLIGATORIO : ORIGEN.VOLUNTARIO;
}

/**
 * Perfil de registros e indicadores exigible (ítems 46 y 47 del FUF).
 * Son EXCLUYENTES: nunca se piden ambos.
 */
function perfilRegistrosIndicadores(dotacionEmpresa) {
    const conDpr = (Number(dotacionEmpresa) || 0) > UMBRAL_DPR;
    return {
        perfil: conDpr ? 'extendido' : 'minimo',
        itemFuf: conDpr ? 46 : 47,
        articulo: conDpr ? 'Arts. 73 y 74' : 'Art. 75',
    };
}

// ─── Mandato y vigencia ──────────────────────────────────────────────────────

/** Fecha de término del mandato: elección + 2 años (CPHS y delegado). */
function fechaTerminoMandato(fechaEleccionISO, anios = ANIOS_MANDATO) {
    if (!fechaEleccionISO) return null;
    const d = new Date(fechaEleccionISO);
    if (Number.isNaN(d.getTime())) return null;
    const fin = new Date(d);
    fin.setFullYear(fin.getFullYear() + anios);
    return fin.toISOString();
}

/** ¿El tipo de órgano tiene mandato con vencimiento? DPR y encargado no. */
function tieneMandato(tipo) {
    return tipo === TIPO_ORGANO.COMITE_PARITARIO || tipo === TIPO_ORGANO.DELEGADO_SST;
}

/**
 * Estado derivado del órgano. `Disuelto` es una decisión explícita y manda sobre
 * todo; `Vencido` se deriva de la fecha para que nadie tenga que "cerrar" el
 * mandato a mano para que el panel diga la verdad.
 */
function estadoOrgano(organo, ahora = new Date()) {
    if (!organo) return null;
    if (organo.estado === ESTADO_ORGANO.DISUELTO) return ESTADO_ORGANO.DISUELTO;
    if (!tieneMandato(organo.tipo)) return organo.estado || ESTADO_ORGANO.VIGENTE;
    const fin = organo.fechaTerminoMandato ? new Date(organo.fechaTerminoMandato) : null;
    if (fin && !Number.isNaN(fin.getTime()) && fin.getTime() < ahora.getTime()) {
        return ESTADO_ORGANO.VENCIDO;
    }
    return ESTADO_ORGANO.VIGENTE;
}

/** ¿Hay un CPHS vigente en este conjunto de órganos de un ámbito? */
function hayCphsVigente(organos, ahora = new Date()) {
    if (!Array.isArray(organos)) return false;
    return organos.some((o) => o?.tipo === TIPO_ORGANO.COMITE_PARITARIO
        && estadoOrgano(o, ahora) === ESTADO_ORGANO.VIGENTE);
}

/** Fecha límite del curso OPR: elección + 6 meses (Art. 32, primer semestre). */
function fechaLimiteCursoOpr(fechaEleccionISO) {
    if (!fechaEleccionISO) return null;
    const d = new Date(fechaEleccionISO);
    if (Number.isNaN(d.getTime())) return null;
    const lim = new Date(d);
    lim.setMonth(lim.getMonth() + MESES_CURSO_OPR);
    return lim.toISOString();
}

// ─── Validaciones de dominio (sección 10 del encargo) ────────────────────────
//
// Van acá y no en el formulario porque son reglas del decreto, no preferencias
// de UI: la misma regla tiene que sostenerse si alguien llama la API directo.

/** Composición exigida al comité paritario (Art. 23). */
const COMPOSICION_CPHS = { titularesPorEstamento: 3 };

/**
 * Regla 7: una persona no puede ser titular y suplente del mismo órgano, ni
 * figurar en ambos estamentos, ni repetirse.
 *
 * @returns {string[]} lista de errores; vacía si la composición es válida.
 */
function validarMiembros(miembros, tipo = TIPO_ORGANO.COMITE_PARITARIO) {
    const errores = [];
    const lista = Array.isArray(miembros) ? miembros.filter(Boolean) : [];

    const porPersona = new Map();
    for (const m of lista) {
        const pid = m?.personaId;
        if (!pid) { errores.push('Hay un integrante sin persona asociada.'); continue; }
        if (!porPersona.has(pid)) porPersona.set(pid, []);
        porPersona.get(pid).push(m);
    }

    for (const [, apariciones] of porPersona) {
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
        for (const estamento of [ESTAMENTO.EMPLEADOR, ESTAMENTO.TRABAJADORES]) {
            const titulares = lista.filter((m) => m.estamento === estamento && m.calidad === CALIDAD.TITULAR).length;
            if (titulares !== COMPOSICION_CPHS.titularesPorEstamento) {
                const etiqueta = estamento === ESTAMENTO.EMPLEADOR ? 'la entidad empleadora' : 'las personas trabajadoras';
                errores.push(
                    `El comité exige ${COMPOSICION_CPHS.titularesPorEstamento} representantes titulares de ${etiqueta} (Art. 23); hay ${titulares}.`
                );
            }
        }
        for (const cargo of [CARGO_ORGANO.PRESIDENTE, CARGO_ORGANO.SECRETARIO]) {
            const cuantos = lista.filter((m) => m.cargo === cargo).length;
            if (cuantos !== 1) errores.push(`Debe haber exactamente un ${cargo.toLowerCase()}; hay ${cuantos}.`);
        }
    }

    return errores;
}

/**
 * Reglas 5, 6 y 10 sobre las fechas de constitución de un órgano.
 *
 * @param {object} p
 * @param {string} p.fechaEleccionODesignacion
 * @param {string} [p.fechaConstitucion]
 * @param {string} [p.fechaTerminoMandato]
 * @param {string} [p.fechaCreacionAmbito] Creación de la empresa u obra (regla 10).
 * @param {Date}   [p.ahora]
 */
function validarFechasOrgano({
    tipo,
    fechaEleccionODesignacion,
    fechaConstitucion = null,
    fechaTerminoMandato = null,
    fechaCreacionAmbito = null,
    ahora = new Date(),
} = {}) {
    const errores = [];
    const eleccion = fechaEleccionODesignacion ? new Date(fechaEleccionODesignacion) : null;

    if (!eleccion || Number.isNaN(eleccion.getTime())) {
        errores.push('La fecha de elección o designación es obligatoria.');
        return errores;
    }

    // Regla 6: ninguna fecha de elección puede ser futura.
    if (eleccion.getTime() > ahora.getTime()) {
        errores.push('La fecha de elección o designación no puede ser futura.');
    }

    if (fechaConstitucion) {
        const constitucion = new Date(fechaConstitucion);
        if (Number.isNaN(constitucion.getTime())) {
            errores.push('La fecha de constitución no es válida.');
        } else {
            if (constitucion.getTime() > ahora.getTime()) {
                errores.push('La fecha de constitución no puede ser futura.');
            }
            if (constitucion.getTime() < eleccion.getTime()) {
                errores.push('La constitución no puede ser anterior a la elección.');
            }
            // Regla 10: no anterior a la creación de la empresa u obra.
            if (fechaCreacionAmbito) {
                const creacion = new Date(fechaCreacionAmbito);
                if (!Number.isNaN(creacion.getTime()) && constitucion.getTime() < creacion.getTime()) {
                    errores.push('La constitución no puede ser anterior a la creación de la empresa u obra.');
                }
            }
        }
    }

    // Regla 5: el mandato no excede 2 años desde la elección. Se permite acortarlo
    // (el encargo dice "editable solo a la baja"), nunca extenderlo.
    if (tieneMandato(tipo) && fechaTerminoMandato) {
        const termino = new Date(fechaTerminoMandato);
        const tope = new Date(eleccion);
        tope.setFullYear(tope.getFullYear() + ANIOS_MANDATO);
        if (Number.isNaN(termino.getTime())) {
            errores.push('La fecha de término del mandato no es válida.');
        } else if (termino.getTime() > tope.getTime()) {
            errores.push(`El mandato no puede exceder ${ANIOS_MANDATO} años desde la elección (Art. 23).`);
        } else if (termino.getTime() <= eleccion.getTime()) {
            errores.push('El término del mandato debe ser posterior a la elección.');
        }
    }

    return errores;
}

/** Regla 8: una reunión no se marca realizada sin acta, ni con fecha futura. */
function validarReunionRealizada({ fechaRealizada, actaDocumentoId, ahora = new Date() } = {}) {
    const errores = [];
    if (!actaDocumentoId) {
        errores.push('No se puede marcar la reunión como realizada sin el acta adjunta.');
    }
    if (!fechaRealizada) {
        errores.push('La fecha efectiva de la reunión es obligatoria.');
    } else {
        const f = new Date(fechaRealizada);
        if (Number.isNaN(f.getTime())) errores.push('La fecha de la reunión no es válida.');
        else if (f.getTime() > ahora.getTime()) errores.push('La fecha de la reunión no puede ser futura.');
    }
    return errores;
}

/**
 * Reuniones ordinarias mensuales desde la constitución hasta el término del
 * mandato (Art. 39). Una por mes y órgano: es lo que permite medir la
 * periodicidad del ítem 34 y saber cuál falta.
 *
 * @returns {Array<{ periodoMes: string, fechaProgramada: string }>}
 */
function generarPeriodosOrdinarios(desdeISO, hastaISO) {
    const desde = desdeISO ? new Date(desdeISO) : null;
    const hasta = hastaISO ? new Date(hastaISO) : null;
    if (!desde || !hasta || Number.isNaN(desde.getTime()) || Number.isNaN(hasta.getTime())) return [];
    if (hasta.getTime() <= desde.getTime()) return [];

    const periodos = [];
    const cursor = new Date(Date.UTC(desde.getUTCFullYear(), desde.getUTCMonth(), 1));
    const fin = new Date(Date.UTC(hasta.getUTCFullYear(), hasta.getUTCMonth(), 1));

    while (cursor.getTime() <= fin.getTime()) {
        const anio = cursor.getUTCFullYear();
        const mes = cursor.getUTCMonth();
        const periodoMes = `${anio}-${String(mes + 1).padStart(2, '0')}`;
        // Se programa a mitad de mes: deja margen para reagendar dentro del mes
        // sin caer en fin de semana ni pegarse al cierre.
        const programada = new Date(Date.UTC(anio, mes, 15, 12, 0, 0));
        // El primer y el último mes solo cuentan si la reunión cae dentro del mandato.
        if (programada.getTime() >= desde.getTime() && programada.getTime() <= hasta.getTime()) {
            periodos.push({ periodoMes, fechaProgramada: programada.toISOString() });
        }
        cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    }
    return periodos;
}

// ─── Documentos por período (ítems 38, 46 y 47) ──────────────────────────────
//
// El programa de trabajo del comité y los registros e indicadores de SST son lo
// mismo desde el punto de vista del sistema: un documento que se carga UNA VEZ
// POR PERÍODO y que vence al terminar ese período. No se modelan como entidades
// propias porque su contenido es del usuario; solo se sigue si está y si vigente.

/** Período anual al que pertenece una fecha. Por defecto, el año calendario. */
const periodoAnual = (fecha = new Date()) => String(new Date(fecha).getUTCFullYear());

/**
 * Estado de un documento periódico frente al período exigido.
 *
 * `Vencido` significa que el período ya pasó y no se cargó nada, que es distinto
 * de `Pendiente` (el período corre y todavía hay tiempo). Un fiscalizador
 * distingue las dos cosas y el panel también debe hacerlo.
 *
 * @param {Array<{periodo?: string}>} documentos Documentos del tipo, de cualquier período.
 * @param {string} periodoExigido  Ej. '2026'.
 * @returns {{ estado: 'Pendiente'|'Cargado'|'Vencido', periodo: string, documento: object|null }}
 */
function estadoDocumentoPeriodico(documentos, periodoExigido, ahora = new Date()) {
    const periodo = String(periodoExigido || periodoAnual(ahora));
    const lista = Array.isArray(documentos) ? documentos : [];
    const documento = lista.find((d) => String(d?.periodo || '') === periodo) || null;

    if (documento) return { estado: 'Cargado', periodo, documento };

    const periodoActual = periodoAnual(ahora);
    const estado = Number(periodo) < Number(periodoActual) ? 'Vencido' : 'Pendiente';
    return { estado, periodo, documento: null };
}

/**
 * Funciones mínimas del CPHS (Art. 47). Se listan como TEXTO INFORMATIVO en la
 * pantalla de carga del programa de trabajo: el sistema no verifica que el
 * archivo las cubra, y construir un checklist daría una falsa sensación de
 * validación sobre algo que nadie comprobó.
 */
const FUNCIONES_CPHS_ART47 = [
    'Asesorar e instruir a las personas trabajadoras en el uso correcto de los elementos de protección personal.',
    'Vigilar el cumplimiento de las medidas de prevención, higiene y seguridad.',
    'Investigar las causas de los accidentes del trabajo y enfermedades profesionales.',
    'Decidir si el accidente o la enfermedad se debió a negligencia inexcusable de la persona trabajadora.',
    'Indicar la adopción de las medidas de higiene y seguridad que sirvan para la prevención de riesgos.',
    'Cumplir las demás funciones que le encomiende el Organismo Administrador.',
    'Promover la realización de cursos de capacitación profesional.',
    'Informar a la entidad empleadora ante la existencia de un riesgo grave e inminente.',
];

/**
 * Qué debe contener el documento de registros e indicadores según el tramo.
 * Es texto de ayuda, no validación: el sistema exige UNO de los dos perfiles
 * (nunca ambos) y no lee el archivo.
 */
const CONTENIDO_REGISTROS_INDICADORES = {
    // Ítem 46 — con Departamento de Prevención (Arts. 73 y 74).
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
    // Ítem 47 — sin obligación de Departamento de Prevención (Art. 75).
    minimo: [
        'Tasa anual de accidentabilidad por accidentes del trabajo.',
        'Accidentes del trabajo y de trayecto.',
        'Enfermedades profesionales.',
    ],
};

module.exports = {
    TIPO_ORGANO, AMBITO, ORIGEN, ESTADO_ORGANO, ESTAMENTO, CALIDAD, CARGO_ORGANO,
    TIPO_REUNION, CAUSAL_EXTRAORDINARIA, ESTADO_REUNION,
    UMBRAL_CPHS, UMBRAL_DELEGADO_MIN, UMBRAL_DPR,
    ANIOS_MANDATO, MESES_CURSO_OPR, DIAS_HABILES_REGISTRO_DT,
    dotacionDeObra, dotacionDeEmpresa, dotacionEfectiva,
    obligacionesDeAmbito, origenSegunObligacion, perfilRegistrosIndicadores,
    fechaTerminoMandato, tieneMandato, estadoOrgano, hayCphsVigente, fechaLimiteCursoOpr,
    COMPOSICION_CPHS, validarMiembros, validarFechasOrgano, validarReunionRealizada,
    generarPeriodosOrdinarios,
    periodoAnual, estadoDocumentoPeriodico,
    FUNCIONES_CPHS_ART47, CONTENIDO_REGISTROS_INDICADORES,
};
