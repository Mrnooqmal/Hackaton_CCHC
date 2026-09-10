/**
 * Motor de completitud del FUF (DS 44/2024).
 *
 * ESPEJO de Frontend/src/utils/completitud.ts — mantener sincronizados.
 *
 * Es el ÚNICO lugar donde se decide si un requisito está cumplido. Antes de esto
 * el cálculo vivía inline en ObraDetalle.tsx como booleanos y porcentajes por
 * fase, sin estados normalizados y sin forma de excluir del denominador lo que no
 * aplica: una obra de 8 personas aparecía incumpliendo el comité paritario que no
 * le corresponde.
 *
 * SEIS ESTADOS, y dos de ellos no penalizan:
 *
 *   Cumplido       la evidencia existe y está completa (firmada si se exige).
 *   Parcial        la evidencia existe pero le falta algo (típicamente la firma).
 *   Pendiente      no hay evidencia y todavía hay plazo.
 *   Vencido        no hay evidencia y el plazo ya pasó.
 *   NoAplica       el requisito no es exigible a este ámbito. DERIVADO, nunca a mano.
 *   FueraDeAlcance el sistema no lo cubre por decisión de producto.
 *
 * `NoAplica` y `FueraDeAlcance` SALEN DEL DENOMINADOR. Un porcentaje que castiga
 * por no tener lo que no corresponde miente, y el usuario deja de creerle.
 *
 * `NoAplica` se DERIVA siempre del servicio de cálculo (dotación y ámbito). Si se
 * pudiera marcar a mano, el sistema estaría certificando una exención que nadie
 * comprobó.
 */

const ESTADO_REQUISITO = {
    CUMPLIDO: 'Cumplido',
    PARCIAL: 'Parcial',
    PENDIENTE: 'Pendiente',
    VENCIDO: 'Vencido',
    NO_APLICA: 'NoAplica',
    FUERA_DE_ALCANCE: 'FueraDeAlcance',
};

/** Estados que no entran al denominador del porcentaje. */
const ESTADOS_NO_PENALIZAN = new Set([ESTADO_REQUISITO.NO_APLICA, ESTADO_REQUISITO.FUERA_DE_ALCANCE]);

/**
 * Los bloques ya no se definen acá: son las QUINCE SECCIONES del formulario, y
 * viven en lib/fuf.js. Antes esto agrupaba por tema en diez bloques inventados,
 * de modo que el panel y el formulario no hablaban el mismo idioma.
 *
 * Se conserva el nombre `BLOQUE_FUF` para no romper a quien lo importe, pero su
 * contenido se deriva del catálogo: si alguien agrega una sección allá, aparece
 * acá sola.
 */
const { SECCIONES_FUF, seccionDeItem } = require('./fuf');

const BLOQUE_FUF = Object.fromEntries(
    SECCIONES_FUF.map((s) => [`S${s.numero}`, s.nombre])
);

/** Nombre de la sección del formulario a la que pertenece un ítem. */
const bloqueDeItem = (numero) => seccionDeItem(numero)?.nombre || 'Sin sección';

// ─── Evidencia documental ────────────────────────────────────────────────────

/** ¿El documento existe y tiene archivo? Sin archivo no hay documento. */
const tieneArchivo = (doc) => Boolean(doc && (doc.s3Key || doc.archivoUrl));

/**
 * ¿Le faltan firmas al documento?
 *
 * Regla del encargo (§6): un requisito NO está `Cumplido` si su documento tiene
 * firma pendiente. El estado se DERIVA del módulo de firmas (las asignaciones del
 * propio documento), no de un campo duplicado que se desincroniza.
 *
 * Un documento sin firmantes asignados no está "pendiente de firma": está sin
 * difundir, que es otra cosa y la decide cada requisito.
 */
function firmasPendientes(doc) {
    const asignaciones = Array.isArray(doc?.asignaciones) ? doc.asignaciones : [];
    if (asignaciones.length === 0) return 0;
    return asignaciones.filter((a) => a?.estado !== 'firmado' && !a?.fechaFirma).length;
}

/**
 * Estado de un requisito que se acredita con UN documento.
 *
 * @param {object|null} doc
 * @param {object} [opciones]
 * @param {boolean} [opciones.exigeFirma]  Si la norma exige firma o difusión.
 * @param {string}  [opciones.fechaLimite] ISO. Si pasó y no hay documento, Vencido.
 * @param {Date}    [opciones.ahora]
 */
function estadoPorDocumento(doc, { exigeFirma = false, fechaLimite = null, ahora = new Date() } = {}) {
    if (!tieneArchivo(doc)) {
        const vencido = fechaLimite && new Date(fechaLimite).getTime() < ahora.getTime();
        return {
            estado: vencido ? ESTADO_REQUISITO.VENCIDO : ESTADO_REQUISITO.PENDIENTE,
            detalle: vencido ? 'El plazo venció sin documento cargado.' : 'Falta cargar el documento.',
        };
    }
    if (exigeFirma) {
        const destinatarios = (doc.asignaciones || []).length;
        // Cargado pero sin nadie a quien difundirlo: la norma exige el acuse, así
        // que tener el archivo no basta.
        if (destinatarios === 0) {
            return { estado: ESTADO_REQUISITO.PARCIAL, detalle: 'Documento cargado, sin destinatarios asignados.' };
        }
        const faltan = firmasPendientes(doc);
        if (faltan > 0) {
            return {
                estado: ESTADO_REQUISITO.PARCIAL,
                detalle: `Documento cargado, ${faltan} firma(s) pendiente(s).`,
            };
        }
    }
    return { estado: ESTADO_REQUISITO.CUMPLIDO, detalle: 'Documento cargado.' };
}

// ─── Evaluación ──────────────────────────────────────────────────────────────

/**
 * Evalúa una lista de definiciones de requisito contra un contexto.
 *
 * Una definición es `{ id, item, bloque, titulo, ambito, evaluar(ctx) }`, donde
 * `evaluar` devuelve `{ estado, detalle }`. Cada módulo aporta las suyas: el motor
 * no conoce el dominio de nadie, solo normaliza y agrega. Eso es lo que permite
 * que el panel y el export lean exactamente lo mismo.
 */
function evaluarCompletitud(definiciones, ctx = {}) {
    const requisitos = (definiciones || []).map((def) => {
        let resultado;
        try {
            resultado = def.evaluar ? def.evaluar(ctx) : { estado: ESTADO_REQUISITO.PENDIENTE };
        } catch (err) {
            // Un requisito que revienta no puede dar por cumplido el conjunto ni
            // tumbar el panel entero: se reporta como pendiente con el motivo.
            resultado = { estado: ESTADO_REQUISITO.PENDIENTE, detalle: `No evaluable: ${err.message}` };
        }
        return {
            id: def.id,
            item: def.item ?? null,
            // La sección se DERIVA del número de ítem contra el catálogo del
            // formulario. Una definición puede forzarla, pero no debería: si
            // difiere del catálogo, el panel y el FUF dejan de coincidir.
            bloque: def.bloque || (def.item != null ? bloqueDeItem(def.item) : null),
            titulo: def.titulo || def.id,
            ambito: def.ambito || 'ambos',
            // Evidencia que sostiene el requisito, para que el repositorio la
            // muestre sin recalcular a qué ítem corresponde cada documento.
            tipos: def.tipos || [],
            modulo: def.modulo || null,
            // Desglose por destinatario, cuando el requisito se acredita
            // informando a alguien (Art. 57 inc. 2 y equivalentes). Lo calcula la
            // definición al evaluar; el motor solo lo deja pasar para que la
            // interfaz lo muestre sin volver a calcularlo. Duplicar esta regla en
            // el cliente es la forma segura de que panel y pantalla discrepen.
            distribucion: resultado?.distribucion || null,
            estado: resultado?.estado || ESTADO_REQUISITO.PENDIENTE,
            detalle: resultado?.detalle || null,
            // Justificación normativa del NoAplica: el indice del expediente la
            // exige, porque ocultar lo faltante es peor que declararlo.
            justificacion: resultado?.estado === ESTADO_REQUISITO.NO_APLICA
                ? (resultado?.detalle || 'No exigible a este ámbito.')
                : null,
        };
    });

    return { requisitos, resumen: resumirCompletitud(requisitos) };
}

/**
 * Resumen agregado. El denominador excluye lo que no penaliza, y `Parcial` cuenta
 * como medio: un documento cargado sin firmar no es lo mismo que no tenerlo, pero
 * tampoco es cumplimiento.
 */
function resumirCompletitud(requisitos) {
    const lista = Array.isArray(requisitos) ? requisitos : [];
    const porEstado = {};
    for (const e of Object.values(ESTADO_REQUISITO)) porEstado[e] = 0;
    for (const r of lista) porEstado[r.estado] = (porEstado[r.estado] || 0) + 1;

    const exigibles = lista.filter((r) => !ESTADOS_NO_PENALIZAN.has(r.estado));
    const denominador = exigibles.length;
    const puntaje = exigibles.reduce((n, r) => {
        if (r.estado === ESTADO_REQUISITO.CUMPLIDO) return n + 1;
        if (r.estado === ESTADO_REQUISITO.PARCIAL) return n + 0.5;
        return n;
    }, 0);

    return {
        total: lista.length,
        exigibles: denominador,
        excluidos: lista.length - denominador,
        cumplidos: porEstado[ESTADO_REQUISITO.CUMPLIDO],
        porEstado,
        progreso: denominador > 0 ? Math.round((puntaje / denominador) * 100) : 0,
    };
}

/** Agrupa los requisitos por bloque del FUF, conservando el resumen de cada uno. */
function agruparPorBloque(requisitos) {
    const mapa = new Map();
    for (const r of requisitos || []) {
        const clave = r.bloque || 'Sin bloque';
        if (!mapa.has(clave)) mapa.set(clave, []);
        mapa.get(clave).push(r);
    }
    return [...mapa.entries()].map(([bloque, items]) => ({
        bloque, requisitos: items, resumen: resumirCompletitud(items),
    }));
}

module.exports = {
    ESTADO_REQUISITO, ESTADOS_NO_PENALIZAN, BLOQUE_FUF, bloqueDeItem,
    tieneArchivo, firmasPendientes, estadoPorDocumento,
    evaluarCompletitud, resumirCompletitud, agruparPorBloque,
};
