/**
 * Requisitos operativos del FUF: los documentos que se generan haciendo la obra.
 *
 * Tercera fuente de definiciones, junto a `completitud-estructura.js` (órganos,
 * ítems 30-48) y `completitud-documental.js` (SGSST, reglamento, prescripciones).
 * Las tres alimentan el MISMO motor y ninguna calcula por su cuenta: describen
 * cómo se acredita su ítem y el motor normaliza.
 *
 * Está separada porque son otra familia —EPP, emergencias, vigilancia, mapas— y
 * un solo archivo con los sesenta ítems deja de poder leerse.
 *
 * LÍMITE QUE NO SE CRUZA: acá no se valida contenido. Se afirma que el documento
 * existe, de cuándo es, si está firmado y a quién se informó. Que la MIPER tenga
 * el contenido mínimo del Art. 7 no lo puede decir un sistema que no abre el PDF,
 * y por eso esos ítems se declaran no cubiertos en vez de fingir un estado.
 */

const C = require('./completitud');
const A = require('./aplicabilidad');
const ACT = require('./actividades-evidencia');

const { ESTADO_REQUISITO: E } = C;

const docsDeTipo = (ctx, tipo) => (ctx.documentos || []).filter((d) => d.tipo === tipo);
const conArchivo = (d) => Boolean(d && (d.s3Key || d.archivoUrl));
const vigenteDeTipo = (ctx, tipo) =>
    docsDeTipo(ctx, tipo).filter(conArchivo).sort((a, b) => (b.version || 0) - (a.version || 0))[0] || null;
const primeroDe = (ctx, tipos) => tipos.map((t) => vigenteDeTipo(ctx, t)).find(Boolean) || null;

/** Fecha del HECHO que el documento acredita, no la de subida. */
const fechaDelHecho = (doc) => doc?.fecha || doc?.updatedAt || doc?.createdAt || null;

/** Meses transcurridos, o null si no hay fecha con la que medir. */
function mesesDesde(fecha, ahora) {
    if (!fecha) return null;
    const ms = new Date(ahora).getTime() - new Date(fecha).getTime();
    return Number.isNaN(ms) ? null : ms / (1000 * 60 * 60 * 24 * 30.44);
}

/**
 * Requisito que se acredita con un documento vigente, sin más condiciones.
 * La mitad de los ítems operativos son exactamente esto.
 */
const porDocumento = (tipos, { falta, tiene }) => (ctx) => {
    const doc = primeroDe(ctx, tipos);
    return doc ? { estado: E.CUMPLIDO, detalle: tiene } : { estado: E.PENDIENTE, detalle: falta };
};

/**
 * Requisito con periodicidad: el documento existe Y es reciente.
 *
 * Un plan de emergencias ensayado hace tres años no acredita el ensayo anual, y
 * un documento sin fecha no se puede medir: eso es Parcial, no cumplimiento.
 */
const porPeriodicidad = (tipos, meses, { falta, articulo }) => (ctx) => {
    const doc = primeroDe(ctx, tipos);
    if (!doc) return { estado: E.PENDIENTE, detalle: falta };

    const transcurridos = mesesDesde(fechaDelHecho(doc), ctx.ahora);
    if (transcurridos === null) {
        return { estado: E.PARCIAL, detalle: 'Documento cargado sin fecha: no se puede medir la periodicidad.' };
    }
    return transcurridos > meses
        ? { estado: E.VENCIDO, detalle: `El último registro tiene ${Math.floor(transcurridos)} meses; ${articulo} admite hasta ${meses}.` }
        : { estado: E.CUMPLIDO, detalle: `Último registro hace ${Math.floor(transcurridos)} mes(es).` };
};

/**
 * Requisito que solo se activa cuando ocurre un hecho (un riesgo grave, un
 * traslado, un examen).
 *
 * Sin hechos registrados no hay nada que incumplir, y se declara la razón para
 * que no parezca un verde vacío. Mismo criterio que el ítem 58: la obligación es
 * REGISTRAR lo que pase, no tener registros.
 */
const porEvento = (tipos, { sinEventos, conEventos }) => (ctx) => {
    const docs = tipos.flatMap((t) => docsDeTipo(ctx, t)).filter(conArchivo);
    return docs.length === 0
        ? { estado: E.CUMPLIDO, detalle: sinEventos }
        : { estado: E.CUMPLIDO, detalle: `${docs.length} ${conEventos}` };
};

// ─── Ítem 6: fecha y revisión periódica de la MIPER ──────────────────────────

/** Art. 7 inc. final: la MIPER se revisa al menos una vez al año o ante cambios. */
const MESES_REVISION_MIPER = 12;

function evaluarItem6(ctx) {
    const miper = primeroDe(ctx, ['MIPER', 'MATRIZ_MIPPER']);
    if (!miper) return { estado: E.PENDIENTE, detalle: 'No hay MIPER cargada (ítem 2).' };

    const fecha = fechaDelHecho(miper);
    const meses = mesesDesde(fecha, ctx.ahora);
    if (meses === null) {
        // El Art. 7 pide que la matriz esté FECHADA. Sin fecha no falta el
        // documento: falta el dato que la vuelve medible.
        return { estado: E.PARCIAL, detalle: 'La MIPER no tiene fecha: sin ella no se puede acreditar la revisión anual.' };
    }
    return meses > MESES_REVISION_MIPER
        ? { estado: E.VENCIDO, detalle: `La última revisión de la MIPER tiene ${Math.floor(meses)} meses; el Art. 7 exige al menos una al año.` }
        : { estado: E.CUMPLIDO, detalle: `MIPER fechada, revisada hace ${Math.floor(meses)} mes(es).` };
}

// ─── Ítems 18 y 19: capacitación en EPP y su registro ────────────────────────

/**
 * Art. 13 incs. 3 y 4. Son DOS obligaciones sobre el MISMO documento, no dos
 * documentos: que la capacitación se haya hecho (inc. 3) y que quede registrada
 * con la constancia de quienes asistieron (inc. 4).
 *
 * Se separan por lo que se mira, no por el archivo: el 18 mira la fecha, el 19
 * mira las firmas. Pedir dos cargas del mismo hecho sería duplicar evidencia.
 */
/** Criterio que vincula una actividad con la capacitación de EPP (Art. 13). */
const CRITERIO_CAP_EPP = {
    tipos: ['CAPACITACION'], subtipo: 'EPP',
    titulo: 'Uso y mantención de EPP (mín. 1h por EPP)',
};

/** Criterio de la capacitación de 8 horas (Art. 16). */
const CRITERIO_CAP_PRL = {
    tipos: ['CAPACITACION'], subtipo: 'PRL_8H',
    titulo: 'Capacitación 8h Prevención de Riesgos Laborales',
};

/**
 * Bloque que la interfaz necesita para ofrecer las DOS vías: agendar la actividad
 * o cargar el certificado. Viaja dentro del requisito, como el desglose de
 * remisión, para que la pantalla no tenga que deducir nada.
 */
const bloqueAcreditacion = (r, criterio, tipos) => ({
    via: r.via,
    criterio: { subtipo: criterio.subtipo, titulo: criterio.titulo, tipos: criterio.tipos },
    tipos,
    actividades: (r.actividades || []).map((a) => ({
        actividadId: a.actividadId || a.id || null,
        titulo: a.titulo || null,
        estado: a.estado || null,
        fecha: a.fechaEjecucion || a.fecha || a.fechaProgramada || null,
        asistentes: (a.asistentes || []).length,
        firmados: (a.asistentes || []).filter((x) => x.firmado || x.fechaFirma).length,
    })),
    documentos: (r.documentos || []).map((d) => d.documentId),
});

function evaluarItem18(ctx) {
    // Dos vías: la actividad agendada en la plataforma, o el certificado de una
    // capacitación dictada fuera. Cualquiera acredita.
    const r = ACT.acreditacionDual({
        actividades: ctx.actividades, documentos: ctx.documentos,
        criterio: CRITERIO_CAP_EPP, tipos: ['CAPACITACION_EPP'],
    });
    const acreditacion = bloqueAcreditacion(r, CRITERIO_CAP_EPP, ['CAPACITACION_EPP']);

    if (r.completo) {
        return {
            estado: E.CUMPLIDO, acreditacion,
            detalle: r.via === 'actividad'
                ? 'Capacitación en EPP ejecutada con asistentes firmados.'
                : 'Capacitación en EPP acreditada con el certificado cargado.',
        };
    }
    if (r.parcial) {
        return {
            estado: E.PARCIAL, acreditacion,
            detalle: `Capacitación en EPP agendada: ${ACT.motivoIncompleto(r.actividades[0])}.`,
        };
    }
    return {
        estado: E.PENDIENTE, acreditacion,
        detalle: 'Sin capacitación en uso y mantención de EPP: agéndala o carga el certificado.',
    };
}

function evaluarItem19(ctx) {
    // Art. 13 inc. 4: el REGISTRO de esas capacitaciones. Mismo hecho que el ítem
    // 18, mirando otra cosa: que conste quién asistió. Con la actividad son los
    // asistentes firmados; con el certificado, las asignaciones del documento.
    const r = ACT.acreditacionDual({
        actividades: ctx.actividades, documentos: ctx.documentos,
        criterio: CRITERIO_CAP_EPP, tipos: ['CAPACITACION_EPP'],
    });
    const acreditacion = bloqueAcreditacion(r, CRITERIO_CAP_EPP, ['CAPACITACION_EPP']);

    if (r.via === 'actividad') {
        const total = r.actividades.reduce((n, a) => n + (a.asistentes || []).length, 0);
        const firmados = r.actividades.reduce(
            (n, a) => n + (a.asistentes || []).filter((x) => x.firmado || x.fechaFirma).length, 0);
        if (total === 0) {
            return { estado: E.PARCIAL, acreditacion, detalle: 'Capacitación sin asistentes: no consta quién se capacitó.' };
        }
        return firmados === total
            ? { estado: E.CUMPLIDO, acreditacion, detalle: `${total} asistente(s) con constancia firmada.` }
            : { estado: E.PARCIAL, acreditacion, detalle: `${firmados} de ${total} asistente(s) con constancia firmada.` };
    }

    if (r.via === 'documento') {
        const doc = r.documentos[0];
        const asignaciones = doc.asignaciones || [];
        if (asignaciones.length === 0) {
            // El inciso 4 pide constancia de QUIÉNES se capacitaron. Un certificado
            // sin asistentes asignados no la deja.
            return { estado: E.PARCIAL, acreditacion, detalle: 'Certificado cargado sin asistentes asignados: no consta quién se capacitó.' };
        }
        const firmadas = asignaciones.filter((a) => a.estado === 'firmado' || a.fechaFirma).length;
        return firmadas === asignaciones.length
            ? { estado: E.CUMPLIDO, acreditacion, detalle: `${firmadas} asistente(s) con constancia firmada.` }
            : { estado: E.PARCIAL, acreditacion, detalle: `${firmadas} de ${asignaciones.length} asistente(s) con constancia firmada.` };
    }

    return { estado: E.PENDIENTE, acreditacion, detalle: 'Sin registro de capacitaciones en EPP (ítem 18).' };
}

// ─── Ítem 23: capacitación en prevención de riesgos ──────────────────────────

/** Art. 16 inc. 1: la capacitación no puede espaciarse más de 2 años. */
const ANIOS_CAPACITACION = 2;

/**
 * La capacitación de 8 horas del Art. 16 es una ACTIVIDAD ejecutada, no un
 * documento: la puede dictar un OAL externo y lo que acredita es el acta con
 * asistentes firmados y las horas declaradas.
 *
 * Se mira la fecha del HECHO —cuándo se dictó— y no la de carga, porque es contra
 * ésa que corren los dos años.
 */
function evaluarItem23(ctx) {
    const r = ACT.acreditacionDual({
        actividades: ctx.actividades, documentos: ctx.documentos,
        criterio: CRITERIO_CAP_PRL, tipos: ['CAPACITACION_SST'],
    });
    const acreditacion = bloqueAcreditacion(r, CRITERIO_CAP_PRL, ['CAPACITACION_SST']);

    if (!r.completo) {
        return r.parcial
            ? { estado: E.PARCIAL, acreditacion, detalle: `Capacitación agendada: ${ACT.motivoIncompleto(r.actividades[0])}.` }
            : { estado: E.PENDIENTE, acreditacion, detalle: 'Sin capacitación en prevención de riesgos: agéndala o carga el certificado.' };
    }

    // La fecha del HECHO, sea de la actividad o del documento: es contra ésa que
    // corren los dos años, no contra la de carga.
    const fechas = [
        ...r.actividades.map((a) => a.fechaEjecucion || a.fecha || a.fechaProgramada),
        ...r.documentos.map(fechaDelHecho),
    ].filter(Boolean).sort((a, b) => String(b).localeCompare(String(a)));

    const meses = mesesDesde(fechas[0], ctx.ahora);
    if (meses === null) {
        return { estado: E.CUMPLIDO, acreditacion, detalle: 'Capacitación acreditada.' };
    }
    const limite = ANIOS_CAPACITACION * 12;
    return meses > limite
        ? { estado: E.VENCIDO, acreditacion, detalle: `La última capacitación tiene ${Math.floor(meses)} meses; el Art. 16 admite hasta ${limite}.` }
        : { estado: E.CUMPLIDO, acreditacion, detalle: `Última capacitación hace ${Math.floor(meses)} mes(es).` };
}

// ─── Ítem 29: coordinación en faena compartida ───────────────────────────────

/**
 * Art. 20. Solo es exigible cuando concurren varias entidades empleadoras en la
 * misma faena, y eso el sistema no lo puede deducir: lo declara quien administra
 * la obra.
 *
 * La condición ya no se resuelve acá: la aplica el motor con la misma regla que
 * el resto de los requisitos condicionados. Esta función solo mira la evidencia.
 *
 * NO modela contratistas ni terceros. Solo registra el documento de coordinación.
 */
function evaluarItem29(ctx) {
    const doc = primeroDe(ctx, ['COORDINACION_ENTIDADES', 'REGISTRO_COORDINACION']);
    return doc
        ? { estado: E.CUMPLIDO, detalle: 'Documento de coordinación entre entidades cargado.' }
        : { estado: E.PENDIENTE, detalle: 'Falta el documento de coordinación entre entidades empleadoras.' };
}

// ─── Ítem 53: mapas de riesgos visibles ──────────────────────────────────────

/**
 * Art. 62: los mapas deben estar VISIBLES en las dependencias. Tener el archivo
 * no es tenerlo publicado, y por eso hay un tipo aparte para la evidencia.
 */
function evaluarItem53(ctx) {
    const mapa = vigenteDeTipo(ctx, 'MAPA_RIESGOS');
    if (!mapa) return { estado: E.PENDIENTE, detalle: 'No hay mapa de riesgos cargado.' };

    return vigenteDeTipo(ctx, 'PUBLICACION_MAPA_RIESGOS')
        ? { estado: E.CUMPLIDO, detalle: 'Mapa cargado y con evidencia de publicación en las dependencias.' }
        : { estado: E.PARCIAL, detalle: 'Mapa cargado, falta la evidencia de que está publicado en las dependencias.' };
}

// ─── Definiciones ────────────────────────────────────────────────────────────

const DEFINICIONES_OPERACION = [
    {
        id: 'FUF-2', item: 2, ambito: 'obra',
        titulo: 'Existencia de la MIPER con cobertura de todos los puestos',
        tipos: ['MIPER', 'MATRIZ_MIPPER'],
        // Que CUBRA todos los puestos es contenido y no se afirma acá: se acredita
        // la existencia, que es lo que el sistema sí puede sostener.
        evaluar: porDocumento(['MIPER', 'MATRIZ_MIPPER'], {
            falta: 'No hay MIPER cargada.',
            tiene: 'MIPER cargada.',
        }),
    },
    {
        id: 'FUF-6', item: 6, ambito: 'obra',
        titulo: 'Fecha y revisión periódica de la MIPER',
        tipos: ['MIPER', 'MATRIZ_MIPPER'],
        evaluar: evaluarItem6,
    },
    {
        id: 'FUF-12', item: 12, ambito: 'obra',
        titulo: 'Máquinas, equipos y elementos de trabajo',
        tipos: ['OPERACION_MAQUINAS'],
        // Art. 10: exigirle esto a una obra sin maquinaria es un rojo que nadie
        // puede cerrar. Lo declara la obra; sin declarar se pide igual y se avisa.
        condicion: A.CONDICION.TIENE_MAQUINARIA,
        evaluar: porDocumento(['OPERACION_MAQUINAS'], {
            falta: 'Sin información ni procedimientos de operación segura de máquinas y equipos.',
            tiene: 'Procedimiento de operación segura cargado.',
        }),
    },
    {
        id: 'FUF-17', item: 17, ambito: 'obra',
        titulo: 'Procedimiento de gestión de EPP',
        tipos: ['PROCEDIMIENTO_EPP'],
        evaluar: porDocumento(['PROCEDIMIENTO_EPP'], {
            falta: 'Sin procedimiento de provisión, uso y reposición de EPP.',
            tiene: 'Procedimiento de gestión de EPP cargado.',
        }),
    },
    {
        id: 'FUF-18', item: 18, ambito: 'obra',
        titulo: 'Capacitación en uso y mantención de EPP',
        // Dos vías: actividad agendada o certificado cargado. Las dos acreditan.
        tipos: ['CAPACITACION_EPP'],
        modulo: 'actividades',
        evaluar: evaluarItem18,
    },
    {
        id: 'FUF-19', item: 19, ambito: 'obra',
        titulo: 'Registro de las capacitaciones en EPP',
        tipos: ['CAPACITACION_EPP'],
        modulo: 'actividades',
        evaluar: evaluarItem19,
    },
    {
        // La evaluación del desempeño es del sistema de gestión, que es de la
        // entidad: el mismo documento que sostiene el literal d) del ítem 1.
        id: 'FUF-20', item: 20, ambito: 'ambos',
        titulo: 'Evaluación anual del cumplimiento del Programa de Trabajo Preventivo',
        // El informe anual de gestión es el Art. 52.15, que este ítem ya cita.
        tipos: ['EVALUACION_DESEMPENO', 'AUDITORIA_SGSST', 'INFORME_ANUAL_GESTION'],
        evaluar: porPeriodicidad(['EVALUACION_DESEMPENO', 'AUDITORIA_SGSST', 'INFORME_ANUAL_GESTION'], 12, {
            falta: 'Sin evaluación del cumplimiento del Programa de Trabajo Preventivo.',
            articulo: 'el Art. 14',
        }),
    },
    {
        id: 'FUF-21', item: 21, ambito: 'obra',
        titulo: 'Oportunidad de la información de riesgos laborales',
        tipos: ['INFO_RIESGOS_LABORALES'],
        // Que la entrega haya sido PREVIA al inicio de labores de cada persona se
        // acredita con la fecha del registro y la asignación, no comparando
        // contratos: la plataforma no afirma lo que no puede comprobar.
        evaluar: porDocumento(['INFO_RIESGOS_LABORALES'], {
            falta: 'Sin registro de la información de riesgos entregada.',
            tiene: 'Información de riesgos laborales registrada.',
        }),
    },
    {
        id: 'FUF-23', item: 23, ambito: 'obra',
        titulo: 'Ejecución de la capacitación en prevención de riesgos',
        // Dos vías: actividad agendada o certificado cargado. Las dos acreditan.
        tipos: ['CAPACITACION_SST'],
        modulo: 'actividades',
        evaluar: evaluarItem23,
    },
    {
        id: 'FUF-26', item: 26, ambito: 'obra',
        titulo: 'Actuación ante riesgo grave e inminente',
        tipos: ['REGISTRO_RIESGO_GRAVE', 'PROCEDIMIENTO_RIESGO_GRAVE'],
        evaluar: porEvento(['REGISTRO_RIESGO_GRAVE'], {
            sinEventos: 'Sin eventos de riesgo grave e inminente registrados en el período.',
            conEventos: 'evento(s) de riesgo grave registrado(s) con su evidencia.',
        }),
    },
    {
        id: 'FUF-27', item: 27, ambito: 'obra',
        titulo: 'Existencia del plan de gestión ante emergencias',
        // El plan y sus procedimientos derivados son el mismo requisito del
        // Art. 19: pedirlos como documentos sueltos duplicaba la exigencia.
        tipos: ['PLAN_EMERGENCIAS', 'PROCEDIMIENTO_EVACUACION', 'INDUCCION_EMERGENCIA'],
        evaluar: porDocumento(['PLAN_EMERGENCIAS'], {
            falta: 'No hay plan de gestión y respuesta ante emergencias.',
            tiene: 'Plan de emergencias cargado.',
        }),
    },
    {
        id: 'FUF-28', item: 28, ambito: 'obra',
        titulo: 'Prueba de ensayo anual del plan de emergencias',
        tipos: ['ACTA_ENSAYO_EMERGENCIA'],
        evaluar: porPeriodicidad(['ACTA_ENSAYO_EMERGENCIA'], 12, {
            falta: 'Sin acta del ensayo del plan de emergencias.',
            articulo: 'el Art. 19',
        }),
    },
    {
        id: 'FUF-29', item: 29, ambito: 'obra',
        titulo: 'Coordinación en faena compartida',
        tipos: ['COORDINACION_ENTIDADES', 'REGISTRO_COORDINACION'],
        condicion: A.CONDICION.FAENA_COMPARTIDA,
        evaluar: evaluarItem29,
    },
    {
        id: 'FUF-53', item: 53, ambito: 'obra',
        titulo: 'Mapas de riesgos visibles',
        tipos: ['MAPA_RIESGOS', 'PUBLICACION_MAPA_RIESGOS'],
        evaluar: evaluarItem53,
    },
    {
        id: 'FUF-54', item: 54, ambito: 'ambos',
        titulo: 'Programa de vigilancia ambiental',
        tipos: ['VIGILANCIA_AMBIENTAL'],
        evaluar: porDocumento(['VIGILANCIA_AMBIENTAL'], {
            falta: 'Sin programa de vigilancia ambiental.',
            tiene: 'Programa de vigilancia ambiental cargado.',
        }),
    },
    {
        id: 'FUF-55', item: 55, ambito: 'ambos',
        titulo: 'Programa de vigilancia de la salud',
        tipos: ['VIGILANCIA_SALUD'],
        evaluar: porDocumento(['VIGILANCIA_SALUD'], {
            falta: 'Sin programa de vigilancia de la salud.',
            tiene: 'Programa de vigilancia de la salud cargado.',
        }),
    },
    {
        id: 'FUF-56', item: 56, ambito: 'obra',
        titulo: 'Autorización para asistir a exámenes de control',
        tipos: ['EXAMEN_OCUPACIONAL'],
        evaluar: porEvento(['EXAMEN_OCUPACIONAL'], {
            sinEventos: 'Sin exámenes de control registrados en el período.',
            conEventos: 'examen(es) de control con su autorización registrada.',
        }),
    },

    // ── Sección 16: otros requisitos y documentos de la entidad ──
    //
    // No son ítems del formulario y no llevan número de FUF: la interfaz los
    // muestra por su artículo. Están acá porque el DS 44 igual los exige (el
    // Art. 12) o porque la entidad decidió mantenerlos por recomendación
    // profesional, y dejarlos fuera del índice los volvía invisibles.
    //
    // Cuentan para el porcentaje como cualquier otro requisito: son documentos
    // que la entidad se comprometió a tener.
    {
        id: 'EXTRA-61', item: 61, ambito: 'obra',
        titulo: 'Gestión de cambios en procesos, tecnologías o materiales',
        tipos: ['GESTION_CAMBIOS'],
        evaluar: porDocumento(['GESTION_CAMBIOS'], {
            falta: 'Sin procedimiento de gestión de cambios (Art. 12).',
            tiene: 'Procedimiento de gestión de cambios cargado.',
        }),
    },
    {
        id: 'EXTRA-62', item: 62, ambito: 'obra',
        titulo: 'Utilización de agentes físicos, químicos y biológicos',
        tipos: ['PROCEDIMIENTO_AGENTES'],
        condicion: A.CONDICION.AGENTES_FQB,
        evaluar: porDocumento(['PROCEDIMIENTO_AGENTES'], {
            falta: 'Sin procedimiento de utilización de agentes físicos, químicos o biológicos.',
            tiene: 'Procedimiento de agentes cargado.',
        }),
    },
    {
        id: 'EXTRA-63', item: 63, ambito: 'empresa',
        titulo: 'Diagnóstico de aspectos legales aplicables',
        tipos: ['DIAGNOSTICO_LEGAL'],
        evaluar: porDocumento(['DIAGNOSTICO_LEGAL'], {
            falta: 'Sin diagnóstico de aspectos legales aplicables.',
            tiene: 'Diagnóstico legal cargado.',
        }),
    },
    {
        id: 'EXTRA-64', item: 64, ambito: 'obra',
        titulo: 'Registro de desviaciones e incumplimientos detectados',
        tipos: ['REGISTRO_DESVIACIONES'],
        evaluar: porEvento(['REGISTRO_DESVIACIONES'], {
            sinEventos: 'Sin desviaciones registradas en el período.',
            conEventos: 'desviación(es) registrada(s).',
        }),
    },
    {
        id: 'EXTRA-65', item: 65, ambito: 'obra',
        titulo: 'Procedimientos de trabajo seguro',
        tipos: ['PROCEDIMIENTO_TRABAJO'],
        evaluar: porDocumento(['PROCEDIMIENTO_TRABAJO'], {
            falta: 'Sin procedimientos de trabajo seguro cargados.',
            tiene: 'Procedimientos de trabajo seguro cargados.',
        }),
    },
    {
        id: 'EXTRA-66', item: 66, ambito: 'obra',
        titulo: 'Investigación de accidentes y enfermedades profesionales',
        tipos: ['PROCEDIMIENTO_INVESTIGACION', 'INVESTIGACION_ACCIDENTE'],
        // El procedimiento es exigible siempre; las investigaciones dependen de
        // que haya ocurrido algo, y no tenerlas no es un incumplimiento.
        evaluar: (ctx) => {
            const proc = vigenteDeTipo(ctx, 'PROCEDIMIENTO_INVESTIGACION');
            const casos = docsDeTipo(ctx, 'INVESTIGACION_ACCIDENTE').filter(conArchivo);
            if (!proc) {
                return { estado: E.PENDIENTE, detalle: 'Sin procedimiento de investigación de accidentes (Art. 71).' };
            }
            return {
                estado: E.CUMPLIDO,
                detalle: casos.length === 0
                    ? 'Procedimiento cargado. Sin accidentes investigados en el período.'
                    : `Procedimiento cargado y ${casos.length} investigación(es) registrada(s).`,
            };
        },
    },

    // ── Fuera del alcance de la plataforma ──
    //
    // Piden verificar QUÉ DICE el documento: que la MIPER alcance ciertos
    // factores, que el Programa tenga ciertos capítulos, que el Reglamento cubra
    // ciertas materias. Eso exige leer el archivo, y el sistema no lo hace.
    //
    // Se declaran acá, y el motor no los emite: quedan fuera del panel, del
    // repositorio y del export. Su cumplimiento se acredita con el documento en
    // la mano y es responsabilidad de quien lleva la prevención.
    ...[
        [3, 'Alcance de los factores de riesgo en la MIPER'],
        [5, 'Contenido mínimo de la MIPER'],
        [10, 'Contenido mínimo del Programa de Trabajo Preventivo'],
        [13, 'Prelación de las medidas de control'],
        [15, 'Adecuación del EPP al riesgo que cubre'],
        [22, 'Contenido mínimo de la información de riesgos laborales'],
        [24, 'Contenidos mínimos de la capacitación'],
        [52, 'Contenido mínimo del Reglamento Interno'],
    ].map(([item, titulo]) => ({
        id: `FUF-${item}`, item, ambito: 'ambos', titulo,
        evaluar: () => ({
            estado: E.FUERA_DE_ALCANCE,
            detalle: 'Se verifica sobre el contenido del documento, que la plataforma no interpreta.',
        }),
    })),
];

const definicionesOperacionPara = (ambito) =>
    DEFINICIONES_OPERACION
        .filter((d) => d.ambito === 'ambos' || d.ambito === ambito)
        .sort((a, b) => a.item - b.item);

module.exports = {
    DEFINICIONES_OPERACION, definicionesOperacionPara,
    evaluarItem6, evaluarItem18, evaluarItem19, evaluarItem23, evaluarItem29, evaluarItem53,
    porDocumento, porPeriodicidad, porEvento,
};
