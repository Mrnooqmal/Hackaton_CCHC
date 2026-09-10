/**
 * Requisitos del FUF que se acreditan con documentos del repositorio.
 *
 * Complementa a `completitud-estructura.js`, que cubre los ítems 30 a 48. Ambos
 * aportan definiciones con la misma forma al motor de `completitud.js`: el motor
 * no conoce el dominio de nadie y sigue habiendo un solo lugar donde un ítem del
 * FUF se vincula con su evidencia.
 *
 * Por ahora: ítem 1 (SGSST), ítem 50 (remisión del Reglamento) e ítem 58
 * (prescripciones). Los demás se agregan acá con la misma forma.
 */

const C = require('./completitud');
const D = require('./distribucion');
const EP = require('./estructura-preventiva');
const PTP = require('./ptp');

const { ESTADO_REQUISITO: E } = C;

const docsDeTipo = (ctx, tipo) => (ctx.documentos || []).filter((d) => d.tipo === tipo);
const conArchivo = (d) => Boolean(d && (d.s3Key || d.archivoUrl));
/** Documento vigente de un tipo: el de mayor versión con archivo. */
const vigenteDeTipo = (ctx, tipo) =>
    docsDeTipo(ctx, tipo).filter(conArchivo).sort((a, b) => (b.version || 0) - (a.version || 0))[0] || null;

// ─── Ítem 50: remisión previa del Reglamento Interno ─────────────────────────

/**
 * Art. 57 inc. 2. Tres destinatarios, 30 días corridos de anticipación.
 *
 * El comité y el delegado son ALTERNATIVOS: el Art. 66 hace al delegado la figura
 * de los lugares sin comité, así que exigir ambos sería exigir algo imposible.
 * Se pide el que exista en el ámbito; si no existe ninguno, ese destinatario sale
 * del denominador con su razón.
 */
/**
 * Desglose de la distribución de un documento, destinatario por destinatario.
 *
 * GENÉRICO: los ítems 4, 11, 25, 37, 50 y 51 exigen el mismo hecho —documento,
 * destinatarios, fecha— con distintas listas y plazos. Devuelve todo lo que la
 * pantalla necesita para operar el requisito sin volver a calcular nada.
 *
 * `diasExigidos` puede venir en null: sin plazo normativo, o sin fecha de
 * vigencia declarada, los envíos se registran igual y solo no se mide la
 * anticipación.
 */
function distribucionPara(doc, ctx, {
    destinatarios, diasExigidos = null, articulo, exigeVigencia = false,
}) {
    const hayComite = Boolean(ctx.organos?.some(
        (o) => o.tipo === EP.TIPO_ORGANO.COMITE_PARITARIO && EP.estadoOrgano(o, ctx.ahora) === EP.ESTADO_ORGANO.VIGENTE));
    const hayDelegado = Boolean(ctx.organos?.some(
        (o) => o.tipo === EP.TIPO_ORGANO.DELEGADO_SST && EP.estadoOrgano(o, ctx.ahora) === EP.ESTADO_ORGANO.VIGENTE));
    const hayDpr = Boolean(ctx.organos?.some(
        (o) => o.tipo === EP.TIPO_ORGANO.DEPARTAMENTO_PREVENCION && EP.estadoOrgano(o, ctx.ahora) === EP.ESTADO_ORGANO.VIGENTE));
    const sindicatos = ctx.organizacionesSindicales || [];
    const declaroSinSindicatos = Boolean(ctx.sinOrganizacionesSindicales?.declarado);

    const resultado = D.evaluarDistribucion({
        difusiones: doc.difusiones || [],
        destinatariosExigidos: destinatarios,
        existencia: {
            [D.DESTINATARIO.PERSONAS_TRABAJADORAS]: true,
            // El comité y el delegado son ALTERNATIVOS: el Art. 66 hace al delegado
            // la figura de los lugares sin comité, así que exigir ambos sería exigir
            // algo imposible.
            [D.DESTINATARIO.COMITE_PARITARIO]: hayComite || hayDelegado,
            [D.DESTINATARIO.ORGANIZACION_SINDICAL]: sindicatos.length > 0,
            [D.DESTINATARIO.DEPARTAMENTO_PREVENCION]: hayDpr,
            [D.DESTINATARIO.LINEA_MANDO]: true,
        },
        razones: {
            [D.DESTINATARIO.COMITE_PARITARIO]: 'No hay comité paritario ni delegado de SST constituido en este ámbito.',
            [D.DESTINATARIO.DEPARTAMENTO_PREVENCION]: 'No hay Departamento de Prevención constituido en este ámbito.',
            [D.DESTINATARIO.ORGANIZACION_SINDICAL]: declaroSinSindicatos
                ? 'La entidad declaró que no hay organizaciones sindicales en este ámbito.'
                : 'No hay organizaciones sindicales registradas.',
        },
        fechaVigencia: exigeVigencia ? (doc.fechaEntradaVigencia || null) : null,
        diasExigidos: exigeVigencia ? diasExigidos : null,
    });

    return {
        documentoId: doc.documentId,
        tipoDocumento: doc.tipo,
        titulo: doc.titulo || null,
        fechaVigencia: doc.fechaEntradaVigencia || null,
        // La pantalla necesita saber si este requisito EXIGE fecha de vigencia
        // para poder pedirla; sin el dato solo podría mostrar el vacío.
        exigeVigencia,
        diasExigidos: diasExigidos || 0,
        articulo,
        resultado,
    };
}

/**
 * Requisito que se acredita difundiendo un documento (ítems 4, 11 y 25).
 *
 * Fabrica el evaluador desde la lista de destinatarios: cada ítem declara a
 * quién hay que informar y el resto es idéntico. Sin plazo normativo, informar
 * tarde no existe: o se informó o no.
 */
function evaluarDifusion({ tipos, destinatarios, articulo, faltaDocumento }) {
    return (ctx) => {
        const doc = tipos.map((t) => vigenteDeTipo(ctx, t)).find(Boolean);
        if (!doc) return { estado: E.PENDIENTE, detalle: faltaDocumento };

        const dist = distribucionPara(doc, ctx, { destinatarios, articulo });
        const r = dist.resultado;
        if (r.exigibles === 0) {
            return { estado: E.NO_APLICA, detalle: 'No hay destinatarios exigibles en este ámbito.', distribucion: dist };
        }
        if (r.completa) {
            return {
                estado: E.CUMPLIDO,
                detalle: `Informado a ${r.enviados} destinatario(s).`,
                distribucion: dist,
            };
        }
        return {
            estado: r.enviados > 0 ? E.PARCIAL : E.PENDIENTE,
            detalle: `${r.enviados} de ${r.exigibles} destinatario(s) con constancia de envío.`,
            distribucion: dist,
        };
    };
}

/** Art. 57 inc. 2: tres destinatarios y 30 días corridos de anticipación. */
const distribucionReglamento = (doc, ctx) => distribucionPara(doc, ctx, {
    destinatarios: D.DESTINATARIOS_REGLAMENTO,
    diasExigidos: D.DIAS_ANTICIPACION_REGLAMENTO,
    articulo: 'Art. 57 inc. 2',
    exigeVigencia: true,
});

function evaluarItem50(ctx) {
    const doc = vigenteDeTipo(ctx, 'REGLAMENTO_INTERNO');
    if (!doc) {
        return { estado: E.PENDIENTE, detalle: 'No hay Reglamento Interno cargado (ítem 49).' };
    }
    if (!doc.fechaEntradaVigencia) {
        // Sin fecha de vigencia el plazo no es medible. No es cumplimiento ni
        // incumplimiento: es un dato que falta, y decirlo es más útil que un rojo.
        // El desglose viaja igual, sin plazo: la interfaz necesita poder pedir la
        // fecha y registrar envíos aunque todavía no se pueda medir la
        // anticipación. Un requisito que no se puede operar hasta estar completo
        // no se completa nunca.
        return {
            estado: E.PARCIAL,
            detalle: 'Falta declarar desde cuándo rige el Reglamento: sin esa fecha no se puede medir la anticipación del Art. 57.',
            distribucion: distribucionReglamento(doc, ctx),
        };
    }

    const dist = distribucionReglamento(doc, ctx);
    const r = dist.resultado;

    if (r.exigibles === 0) {
        return { estado: E.NO_APLICA, detalle: 'No hay destinatarios exigibles en este ámbito.', distribucion: dist };
    }
    if (r.completa) {
        return {
            estado: E.CUMPLIDO,
            detalle: `Remitido con la anticipación exigida a ${r.enviados} destinatario(s).`,
            distribucion: dist,
        };
    }
    // Anti contradicción 4: enviar con menos de 30 días NUNCA es Cumplido.
    if (r.fueraDePlazo > 0) {
        const peor = r.detalle.find((d) => d.estado === D.ESTADO_DESTINATARIO.FUERA_DE_PLAZO);
        return {
            estado: E.PARCIAL,
            detalle: peor?.detalle || 'Remitido fuera del plazo del Art. 57.',
            distribucion: dist,
        };
    }
    return {
        estado: r.enviados > 0 ? E.PARCIAL : E.PENDIENTE,
        detalle: `${r.enviados} de ${r.exigibles} destinatario(s) con constancia de envío.`,
        distribucion: dist,
    };
}

// ─── Ítem 1: Sistema de Gestión de SST ───────────────────────────────────────

/**
 * Art. 22: cinco componentes mínimos. Cuatro ya los resuelven otros ítems y este
 * ítem los REFERENCIA, no los reimplementa ni guarda copias.
 *
 * El literal a) es el único con documento propio: la Política de SST.
 */
function componentesSgsst(ctx) {
    const politica = vigenteDeTipo(ctx, 'POLITICA_SSO');

    // b) Estructura organizacional: se lee del módulo de estructura preventiva.
    const obligatorias = Object.values(EP.TIPO_ORGANO).filter((t) => ctx.obligaciones?.[t]?.obligatorio);
    const constituidas = obligatorias.filter((t) => ctx.organos?.some(
        (o) => o.tipo === t && EP.estadoOrgano(o, ctx.ahora) === EP.ESTADO_ORGANO.VIGENTE));
    const estructuraOk = obligatorias.length === 0 || constituidas.length === obligatorias.length;

    // c) Diagnóstico y planificación: MIPER + Programa de Trabajo Preventivo.
    //
    // Único componente que mira los documentos de TODA la entidad y no solo los
    // de la casa matriz: la MIPER y el programa son por lugar de trabajo, y el
    // sistema de gestión abarca todos. Exigir una copia a nivel empresa sería
    // pedir un documento que la norma no manda hacer.
    const ctxTodos = { ...ctx, documentos: ctx.documentosTenant || ctx.documentos };
    const miper = vigenteDeTipo(ctxTodos, 'MIPER') || vigenteDeTipo(ctxTodos, 'MATRIZ_MIPPER');
    const ptp = vigenteDeTipo(ctxTodos, 'PROGRAMA_TRABAJO_PREVENTIVO');

    // d) Evaluación del desempeño: la evaluación anual (ítem 20).
    const evaluacion = vigenteDeTipo(ctx, 'EVALUACION_DESEMPENO') || vigenteDeTipo(ctx, 'AUDITORIA_SGSST');

    // e) Mejora continua: plan de mejora de la fase ACT.
    const mejora = vigenteDeTipo(ctx, 'PLAN_MEJORA') || vigenteDeTipo(ctx, 'ACCIONES_MEJORA_SGSST');

    return [
        {
            clave: 'a', literal: 'a) Política de Seguridad y Salud en el Trabajo',
            estado: politica ? E.CUMPLIDO : E.PENDIENTE,
            propio: true, tipo: 'POLITICA_SSO',
            detalle: politica ? 'Política cargada.' : 'Falta cargar la Política de SST.',
            enlace: null,
        },
        {
            clave: 'b', literal: 'b) Estructura organizacional para la gestión preventiva',
            estado: estructuraOk ? E.CUMPLIDO : E.PARCIAL,
            propio: false,
            detalle: obligatorias.length === 0
                ? 'Sin órganos obligatorios según la dotación.'
                : `${constituidas.length} de ${obligatorias.length} órgano(s) obligatorio(s) constituido(s).`,
            enlace: 'estructura-preventiva',
        },
        {
            clave: 'c', literal: 'c) Diagnóstico, planificación y programación de la actividad preventiva',
            estado: miper && ptp ? E.CUMPLIDO : (miper || ptp) ? E.PARCIAL : E.PENDIENTE,
            propio: false,
            detalle: miper && ptp ? 'MIPER y Programa de Trabajo Preventivo cargados.'
                : miper ? 'Falta el Programa de Trabajo Preventivo.'
                    : ptp ? 'Falta la MIPER.' : 'Faltan la MIPER y el Programa de Trabajo Preventivo.',
            enlace: 'plan',
        },
        {
            clave: 'd', literal: 'd) Evaluación o auditoría periódica del desempeño del SGSST',
            estado: evaluacion ? E.CUMPLIDO : E.PENDIENTE,
            propio: true, tipo: 'AUDITORIA_SGSST',
            detalle: evaluacion ? 'Evaluación del desempeño cargada.' : 'Falta la evaluación o auditoría del SGSST.',
            enlace: 'verificar',
        },
        {
            clave: 'e', literal: 'e) Acciones de mejora continua o correctivas',
            estado: mejora ? E.CUMPLIDO : E.PENDIENTE,
            propio: true, tipo: 'ACCIONES_MEJORA_SGSST',
            detalle: mejora ? 'Acciones de mejora cargadas.' : 'Faltan las acciones de mejora continua o correctivas.',
            enlace: 'actuar',
        },
    ];
}

/** Anti contradicción 7: el ítem 1 no puede estar Cumplido si falta un componente. */
function evaluarItem1(ctx) {
    const comps = componentesSgsst(ctx);
    const cumplidos = comps.filter((c) => c.estado === E.CUMPLIDO).length;
    // Los cinco literales viajan con el requisito: el ítem 1 es una sola fila del
    // formulario pero cinco obligaciones distintas, y verlo como un badge único no
    // dice cuál falta. Es el mismo desglose que muestra el panel del SGSST, no una
    // segunda evaluación.
    const subrequisitos = comps.map((c) => ({
        clave: c.clave, titulo: c.literal, estado: c.estado, detalle: c.detalle,
        modulo: c.propio ? null : c.enlace,
    }));
    if (cumplidos === comps.length) {
        return { estado: E.CUMPLIDO, detalle: 'Los cinco componentes del Art. 22 están cubiertos.', subrequisitos };
    }
    return {
        estado: cumplidos > 0 ? E.PARCIAL : E.PENDIENTE,
        detalle: `${cumplidos} de ${comps.length} componentes del Art. 22 cubiertos.`,
        subrequisitos,
    };
}

// ─── Ítem 58: implementación de medidas prescritas ───────────────────────────

/**
 * Art. 70. La obligación es IMPLEMENTAR lo que se prescriba, así que sin
 * prescripciones registradas no hay nada que incumplir (duda D6, default del
 * encargo). Se declara la razón para que no parezca un verde vacío.
 */
function evaluarItem58(ctx) {
    const pres = ctx.prescripciones || [];
    if (pres.length === 0) {
        return { estado: E.CUMPLIDO, detalle: 'Sin prescripciones registradas en el período.' };
    }
    const vencidas = pres.filter((p) => p.estado === 'Vencida').length;
    const pendientes = pres.filter((p) => p.estado === 'Pendiente').length;
    const implementadas = pres.filter((p) => p.estado === 'Implementada').length;

    if (vencidas > 0) {
        return { estado: E.VENCIDO, detalle: `${vencidas} prescripción(es) con el plazo vencido sin implementar.` };
    }
    if (pendientes > 0) {
        return {
            estado: implementadas > 0 ? E.PARCIAL : E.PENDIENTE,
            detalle: `${implementadas} de ${pres.length} prescripción(es) implementada(s).`,
        };
    }
    return { estado: E.CUMPLIDO, detalle: `${implementadas} prescripción(es) implementada(s) con evidencia.` };
}

// ─── Ítems 8 y 9: Programa de Trabajo Preventivo ─────────────────────────────

/**
 * Art. 8 inc. 1: el PTP se confecciona dentro de 30 días corridos desde la MIPER.
 *
 * No reimplementa el plazo: `ptp.js` ya lo deriva de las fechas de los dos
 * documentos y está probado. Acá solo se traduce ese estado a los del formulario.
 */
function evaluarItem8(ctx) {
    const ptp = vigenteDeTipo(ctx, 'PROGRAMA_TRABAJO_PREVENTIVO');
    const miper = vigenteDeTipo(ctx, 'MIPER') || vigenteDeTipo(ctx, 'MATRIZ_MIPPER');
    const r = PTP.estadoPtp(ptp, miper, ctx.ahora);

    // Sin MIPER el plazo no ha empezado a correr: no es incumplimiento del ítem 8,
    // es que todavía no es exigible. Lo que falta lo reclama el ítem 2.
    if (r.estado === 'sin_miper') return { estado: E.PENDIENTE, detalle: r.detalle };
    if (r.estado === 'vigente') return { estado: E.CUMPLIDO, detalle: r.detalle };
    if (r.vencido) {
        return { estado: E.VENCIDO, detalle: `${r.detalle} Pasaron ${r.dias} días de los ${PTP.PLAZO_PTP_DIAS} que da el Art. 8.` };
    }
    return {
        estado: r.estado === 'desactualizado' ? E.PARCIAL : E.PENDIENTE,
        detalle: `${r.detalle} Quedan ${r.diasRestantes} día(s) del plazo.`,
    };
}

/**
 * Art. 8: el PTP debe estar por escrito y aprobado por el representante legal.
 *
 * La aprobación es la FIRMA sobre el documento, resuelta por el módulo de firmas.
 * Un campo "aprobado" aparte se desincroniza y no acredita nada.
 */
function evaluarItem9(ctx) {
    const ptp = vigenteDeTipo(ctx, 'PROGRAMA_TRABAJO_PREVENTIVO');
    if (!ptp) return { estado: E.PENDIENTE, detalle: 'No hay Programa de Trabajo Preventivo cargado.' };

    const repre = ctx.representanteLegal || null;
    if (!repre?.personaId) {
        return {
            estado: E.PARCIAL,
            detalle: 'Programa cargado, pero no hay representante legal designado contra quien verificar la aprobación.',
        };
    }
    return PTP.aprobadoPorRepresentanteLegal(ptp, repre)
        ? { estado: E.CUMPLIDO, detalle: `Programa firmado por ${repre.nombre || 'el representante legal'}.` }
        : { estado: E.PARCIAL, detalle: 'Programa cargado, falta la firma del representante legal.' };
}

// ─── Ítem 23: periodicidad de la capacitación ────────────────────────────────

/** Art. 16 inc. 1: la capacitación no puede espaciarse más de 2 años. */
const ANIOS_CAPACITACION = 2;

function evaluarItem23(ctx) {
    const doc = vigenteDeTipo(ctx, 'CAPACITACION_SST') || vigenteDeTipo(ctx, 'CAPACITACION');
    if (!doc) return { estado: E.PENDIENTE, detalle: 'Sin registro de capacitación en prevención de riesgos.' };

    // La fecha del HECHO, no la de subida: una capacitación de marzo cargada en
    // septiembre acredita marzo, y es contra ésa que corre la periodicidad.
    const fecha = doc.fecha || doc.updatedAt || doc.createdAt;
    const meses = fecha
        ? (new Date(ctx.ahora) - new Date(fecha)) / (1000 * 60 * 60 * 24 * 30.44)
        : null;
    if (meses === null || Number.isNaN(meses)) {
        return { estado: E.PARCIAL, detalle: 'Registro cargado sin fecha: no se puede medir la periodicidad.' };
    }
    const limite = ANIOS_CAPACITACION * 12;
    return meses > limite
        ? { estado: E.VENCIDO, detalle: `La última capacitación registrada tiene ${Math.floor(meses)} meses; el Art. 16 admite hasta ${limite}.` }
        : { estado: E.CUMPLIDO, detalle: `Última capacitación hace ${Math.floor(meses)} mes(es).` };
}

// ─── Ítem 37: entrega de documentación preventiva al comité ──────────────────

/**
 * Art. 46 inc. 3. Es una CONSTANCIA de entrega, no una validación de qué se
 * entregó: el sistema no abre los archivos. Se pueden registrar varias entregas
 * a lo largo del tiempo; cada una es un documento de su tipo con su fecha.
 *
 * Reemplaza a la definición anterior, que acreditaba con la mera existencia del
 * comité y podía marcar cumplimiento sin que se hubiera entregado nada.
 */
function evaluarItem37(ctx) {
    const obligatorio = ctx.obligaciones?.[EP.TIPO_ORGANO.COMITE_PARITARIO]?.obligatorio;
    const hayComite = ctx.organos?.some(
        (o) => o.tipo === EP.TIPO_ORGANO.COMITE_PARITARIO && EP.estadoOrgano(o, ctx.ahora) === EP.ESTADO_ORGANO.VIGENTE);
    const hayDelegado = ctx.organos?.some(
        (o) => o.tipo === EP.TIPO_ORGANO.DELEGADO_SST && EP.estadoOrgano(o, ctx.ahora) === EP.ESTADO_ORGANO.VIGENTE);

    if (!hayComite && !hayDelegado) {
        // Sin destinatario no hay entrega posible. Si además no era obligatorio,
        // no aplica; si lo era, lo reclama el ítem 30, no éste.
        return obligatorio
            ? { estado: E.PENDIENTE, detalle: 'No hay comité constituido a quien entregar la documentación (ítem 30).' }
            : { estado: E.NO_APLICA, detalle: 'No hay comité paritario ni delegado de SST en este ámbito.' };
    }

    const entregas = docsDeTipo(ctx, 'ENTREGA_DOCUMENTACION_CPHS').filter(conArchivo);
    if (entregas.length === 0) {
        return { estado: E.PENDIENTE, detalle: 'Sin constancia de entrega de documentación preventiva al comité.' };
    }
    const ultima = entregas
        .map((d) => d.fecha || d.updatedAt || d.createdAt)
        .filter(Boolean)
        .sort((a, b) => String(b).localeCompare(String(a)))[0];
    return {
        estado: E.CUMPLIDO,
        detalle: `${entregas.length} constancia(s) de entrega registrada(s)${ultima ? `, la última el ${String(ultima).slice(0, 10)}` : ''}.`,
    };
}

// ─── Ítem 51: revisión periódica del Reglamento Interno ──────────────────────

/** Art. 57 inc. 5: revisión al menos anual, con participación de los órganos. */
const MESES_REVISION_RIOHS = 12;

/**
 * Usa el registro de participantes que ya escribe el versionado del Reglamento.
 * NO tiene versionado propio: la revisión es una versión nueva del mismo
 * documento, y montar un historial aparte daría dos verdades sobre el mismo texto.
 */
function evaluarItem51(ctx) {
    const doc = vigenteDeTipo(ctx, 'REGLAMENTO_INTERNO');
    if (!doc) return { estado: E.PENDIENTE, detalle: 'No hay Reglamento Interno cargado (ítem 49).' };

    const fecha = doc.ultimosParticipantesRevision?.fechaRevision || doc.updatedAt || doc.createdAt;
    const meses = fecha ? (new Date(ctx.ahora) - new Date(fecha)) / (1000 * 60 * 60 * 24 * 30.44) : null;
    const entidades = doc.ultimosParticipantesRevision?.entidades || [];

    if (meses === null || Number.isNaN(meses)) {
        return { estado: E.PARCIAL, detalle: 'No hay fecha con la que medir la última revisión.' };
    }
    if (meses > MESES_REVISION_RIOHS) {
        return { estado: E.VENCIDO, detalle: `La última revisión tiene ${Math.floor(meses)} meses; el Art. 57 exige al menos una al año.` };
    }
    // Revisar dentro del año pero sin nadie convocado no cumple el inciso: la
    // norma pide participación, no solo una versión nueva.
    if (entidades.length === 0) {
        return { estado: E.PARCIAL, detalle: 'Revisión dentro del año, sin registro de los órganos que participaron.' };
    }
    return { estado: E.CUMPLIDO, detalle: `Revisada hace ${Math.floor(meses)} mes(es), con ${entidades.length} órgano(s) participante(s).` };
}

// ─── Ítem 60: registro documental fidedigno ──────────────────────────────────

/**
 * Art. 72. Ítem paraguas: no tiene evidencia propia y por eso se DERIVA del
 * resto del formulario. Es `agregado`, así que corre en la segunda pasada y
 * recibe los requisitos ya resueltos.
 *
 * El repositorio seccionado es lo que lo responde; construir un segundo
 * consolidado sería duplicar el índice que ya existe.
 */
function evaluarItem60(_ctx, requisitos = []) {
    const exigibles = (requisitos || []).filter(
        (r) => r.estado !== E.NO_APLICA && r.estado !== E.FUERA_DE_ALCANCE);
    if (exigibles.length === 0) {
        return { estado: E.NO_APLICA, detalle: 'No hay requisitos exigibles en este ámbito.' };
    }
    const sinRespaldo = exigibles.filter((r) => r.estado === E.PENDIENTE || r.estado === E.VENCIDO);
    if (sinRespaldo.length === 0) {
        return { estado: E.CUMPLIDO, detalle: `Los ${exigibles.length} requisitos exigibles tienen respaldo en el repositorio.` };
    }
    return {
        estado: E.PARCIAL,
        detalle: `${sinRespaldo.length} de ${exigibles.length} requisitos exigibles sin respaldo cargado.`,
    };
}

const DEFINICIONES_DOCUMENTALES = [
    {
        id: 'FUF-1', item: 1, ambito: 'empresa',
        titulo: 'Sistema de Gestión de SST con su contenido mínimo',
        // `tipos` los declara la definición porque es la que los mira para evaluar.
        // El repositorio los usa para mostrar la evidencia que sostiene el ítem sin
        // tener que adivinar la correspondencia.
        tipos: ['POLITICA_SSO', 'MIPER', 'PROGRAMA_TRABAJO_PREVENTIVO', 'EVALUACION_DESEMPENO',
            'AUDITORIA_SGSST', 'PLAN_MEJORA', 'ACCIONES_MEJORA_SGSST'],
        evaluar: evaluarItem1,
    },
    {
        // La MIPER es por lugar de trabajo (Art. 7): no hay una de la entidad.
        id: 'FUF-4', item: 4, ambito: 'obra',
        titulo: 'Disponibilidad y difusión de la MIPER',
        tipos: ['MIPER', 'MATRIZ_MIPPER'],
        evaluar: evaluarDifusion({
            tipos: ['MIPER', 'MATRIZ_MIPPER'],
            // Art. 7 inc. 9: a las personas trabajadoras, al comité o delegado, a
            // las organizaciones sindicales y a la línea de mando.
            destinatarios: [
                D.DESTINATARIO.PERSONAS_TRABAJADORAS,
                D.DESTINATARIO.COMITE_PARITARIO,
                D.DESTINATARIO.ORGANIZACION_SINDICAL,
                D.DESTINATARIO.LINEA_MANDO,
            ],
            articulo: 'Art. 7 inc. 9',
            faltaDocumento: 'No hay MIPER cargada (ítem 2).',
        }),
    },
    {
        // El programa deriva de la MIPER, así que también es por lugar de trabajo.
        id: 'FUF-8', item: 8, ambito: 'obra',
        titulo: 'Programa de Trabajo Preventivo dentro de 30 días desde la MIPER',
        tipos: ['PROGRAMA_TRABAJO_PREVENTIVO', 'MIPER', 'MATRIZ_MIPPER'],
        evaluar: evaluarItem8,
    },
    {
        // Mismo alcance que el ítem 8.
        id: 'FUF-9', item: 9, ambito: 'obra',
        titulo: 'Programa de Trabajo Preventivo escrito y aprobado',
        tipos: ['PROGRAMA_TRABAJO_PREVENTIVO'],
        evaluar: evaluarItem9,
    },
    {
        // Mismo alcance que el ítem 8.
        id: 'FUF-11', item: 11, ambito: 'obra',
        titulo: 'Difusión del Programa de Trabajo Preventivo y remisión al comité',
        tipos: ['PROGRAMA_TRABAJO_PREVENTIVO'],
        evaluar: evaluarDifusion({
            tipos: ['PROGRAMA_TRABAJO_PREVENTIVO'],
            // Art. 8 inc. 3: difundido a las personas trabajadoras y remitido al comité.
            destinatarios: [D.DESTINATARIO.PERSONAS_TRABAJADORAS, D.DESTINATARIO.COMITE_PARITARIO],
            articulo: 'Art. 8 inc. 3',
            faltaDocumento: 'No hay Programa de Trabajo Preventivo cargado (ítem 8).',
        }),
    },
    {
        // La capacitación se ejecuta en el lugar de trabajo.
        id: 'FUF-23', item: 23, ambito: 'obra',
        titulo: 'Ejecución de la capacitación en prevención de riesgos',
        tipos: ['CAPACITACION_SST', 'CAPACITACION'],
        evaluar: evaluarItem23,
    },
    {
        // La consulta es a las personas trabajadoras de cada faena.
        id: 'FUF-25', item: 25, ambito: 'obra',
        titulo: 'Consulta y participación de las personas trabajadoras',
        tipos: ['CONSULTA_REPRESENTANTES', 'REGISTRO_CONSULTA'],
        evaluar: evaluarDifusion({
            tipos: ['REGISTRO_CONSULTA', 'CONSULTA_REPRESENTANTES'],
            // Arts. 17, 37 y 71: representantes, comité y Departamento de Prevención.
            destinatarios: [
                D.DESTINATARIO.PERSONAS_TRABAJADORAS,
                D.DESTINATARIO.COMITE_PARITARIO,
                D.DESTINATARIO.DEPARTAMENTO_PREVENCION,
            ],
            articulo: 'Arts. 17, 37 y 71',
            faltaDocumento: 'Sin registro de consulta a las personas trabajadoras.',
        }),
    },
    {
        id: 'FUF-37', item: 37, ambito: 'ambos',
        titulo: 'Entrega de documentación preventiva al comité',
        tipos: ['ENTREGA_DOCUMENTACION_CPHS'],
        evaluar: evaluarItem37,
    },
    {
        id: 'FUF-50', item: 50, ambito: 'ambos',
        titulo: 'Remisión previa del Reglamento Interno con 30 días de anticipación',
        tipos: ['REGLAMENTO_INTERNO'],
        evaluar: evaluarItem50,
    },
    {
        id: 'FUF-58', item: 58, ambito: 'ambos',
        titulo: 'Implementación de las medidas prescritas',
        // Las prescripciones no son documentos del repositorio: viven en su propia
        // entidad y traen adjuntos. El repositorio enlaza al módulo, no los indexa.
        tipos: [],
        modulo: 'prescripciones',
        evaluar: evaluarItem58,
    },
    {
        id: 'FUF-51', item: 51, ambito: 'ambos',
        titulo: 'Revisión periódica del Reglamento Interno',
        tipos: ['REGLAMENTO_INTERNO'],
        evaluar: evaluarItem51,
    },
    {
        id: 'FUF-60', item: 60, ambito: 'ambos',
        titulo: 'Registro documental fidedigno de la actividad preventiva',
        // Sin tipos propios: se responde con el índice del repositorio, no con un
        // documento aparte. `agregado` lo manda a la segunda pasada del motor.
        tipos: [],
        agregado: true,
        evaluar: evaluarItem60,
    },
];

const definicionesDocumentalesPara = (ambito) =>
    DEFINICIONES_DOCUMENTALES.filter((d) => d.ambito === 'ambos' || d.ambito === ambito);

module.exports = {
    DEFINICIONES_DOCUMENTALES, definicionesDocumentalesPara,
    componentesSgsst,
    evaluarItem1, evaluarItem8, evaluarItem9, evaluarItem23, evaluarItem37,
    evaluarItem50, evaluarItem51, evaluarItem58, evaluarItem60,
    // Expuestos para las pruebas y para que otros ítems reutilicen la mecánica.
    distribucionPara, evaluarDifusion,
};
