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
 * Desglose de la remisión del Reglamento, destinatario por destinatario.
 *
 * Devuelve TODO lo que la pantalla necesita para operar el requisito sin volver
 * a calcular nada: el estado de cada destinatario, el documento sobre el que se
 * registran las constancias y el plazo exigido. La regla vive en un solo lugar.
 *
 * `diasExigidos` puede venir en null: sin fecha de vigencia declarada el plazo no
 * es medible, pero los envíos sí se pueden registrar.
 */
function distribucionDe(doc, ctx, diasExigidos) {
    const hayComite = Boolean(ctx.organos?.some(
        (o) => o.tipo === EP.TIPO_ORGANO.COMITE_PARITARIO && EP.estadoOrgano(o, ctx.ahora) === EP.ESTADO_ORGANO.VIGENTE));
    const hayDelegado = Boolean(ctx.organos?.some(
        (o) => o.tipo === EP.TIPO_ORGANO.DELEGADO_SST && EP.estadoOrgano(o, ctx.ahora) === EP.ESTADO_ORGANO.VIGENTE));
    const sindicatos = ctx.organizacionesSindicales || [];
    const declaroSinSindicatos = Boolean(ctx.sinOrganizacionesSindicales?.declarado);

    const resultado = D.evaluarDistribucion({
        difusiones: doc.difusiones || [],
        destinatariosExigidos: D.DESTINATARIOS_REGLAMENTO,
        existencia: {
            [D.DESTINATARIO.PERSONAS_TRABAJADORAS]: true,
            [D.DESTINATARIO.COMITE_PARITARIO]: hayComite || hayDelegado,
            [D.DESTINATARIO.ORGANIZACION_SINDICAL]: sindicatos.length > 0,
        },
        razones: {
            [D.DESTINATARIO.COMITE_PARITARIO]: 'No hay comité paritario ni delegado de SST constituido en este ámbito.',
            [D.DESTINATARIO.ORGANIZACION_SINDICAL]: declaroSinSindicatos
                ? 'La entidad declaró que no hay organizaciones sindicales en este ámbito.'
                : 'No hay organizaciones sindicales registradas.',
        },
        fechaVigencia: doc.fechaEntradaVigencia || null,
        diasExigidos,
    });

    return {
        documentoId: doc.documentId,
        tipoDocumento: doc.tipo,
        titulo: doc.titulo || null,
        fechaVigencia: doc.fechaEntradaVigencia || null,
        // La pantalla necesita saber que este requisito EXIGE una fecha de
        // vigencia para poder pedirla; sin el dato solo podría mostrar el vacío.
        exigeVigencia: true,
        diasExigidos: D.DIAS_ANTICIPACION_REGLAMENTO,
        articulo: 'Art. 57 inc. 2',
        resultado,
    };
}

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
            distribucion: distribucionDe(doc, ctx, null),
        };
    }

    const dist = distribucionDe(doc, ctx, D.DIAS_ANTICIPACION_REGLAMENTO);
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
    const miper = vigenteDeTipo(ctx, 'MIPER') || vigenteDeTipo(ctx, 'MATRIZ_MIPPER');
    const ptp = vigenteDeTipo(ctx, 'PROGRAMA_TRABAJO_PREVENTIVO');

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
    if (cumplidos === comps.length) return { estado: E.CUMPLIDO, detalle: 'Los cinco componentes del Art. 22 están cubiertos.' };
    return {
        estado: cumplidos > 0 ? E.PARCIAL : E.PENDIENTE,
        detalle: `${cumplidos} de ${comps.length} componentes del Art. 22 cubiertos.`,
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
];

const definicionesDocumentalesPara = (ambito) =>
    DEFINICIONES_DOCUMENTALES.filter((d) => d.ambito === 'ambos' || d.ambito === ambito);

module.exports = {
    DEFINICIONES_DOCUMENTALES, definicionesDocumentalesPara,
    componentesSgsst, evaluarItem1, evaluarItem50, evaluarItem58,
};
