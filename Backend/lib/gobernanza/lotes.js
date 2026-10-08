/**
 * Lotes de supresión: la única forma de borrar datos personales, con dos
 * personas. Reglas puras; `handlers/gobernanza/lotes.js` las ejecuta.
 *
 * ── Qué se aprueba ─────────────────────────────────────────────────────────
 * El CONTENIDO exacto del lote: cada operación sobre una tabla (qué ítem, qué
 * acción, qué campos) y cada versión de cada archivo que se va a borrar, con su
 * `versionId`. De ese contenido se calcula una huella canónica (lib/huella.js).
 * Quien aprueba envía la huella de lo que vio: si no coincide con la del lote,
 * no aprobó eso.
 *
 * ── Se ejecuta exactamente lo aprobado ─────────────────────────────────────
 * Al aprobar y otra vez al ejecutar, el contenido se RECALCULA desde los datos
 * actuales. Si su huella cambió (alguien firmó un documento, apareció una
 * versión nueva de un archivo, se levantó una retención legal), el lote queda
 * desactualizado: no se aprueba ni se ejecuta, y hay que proponer uno nuevo y
 * aprobarlo de nuevo. Y lo que se ejecuta es el contenido guardado, no el
 * recalculado: coinciden, porque si no, no se ejecuta.
 *
 * ── Dos personas ────────────────────────────────────────────────────────────
 * Quien aprueba y quien ejecuta tienen que ser personas distintas. Proponer no
 * cuenta como una de las dos (el lote de retención lo propone el sistema).
 */

const { calcularHuella } = require('../huella');
const { fuente } = require('./inventario');
const { Persona } = require('../models/Persona');

const ESTADOS = {
    PROPUESTO: 'propuesto',
    APROBADO: 'aprobado',
    DESACTUALIZADO: 'desactualizado',
    EJECUTADO: 'ejecutado',
    EJECUTADO_CON_ERRORES: 'ejecutado_con_errores',
};
const ORIGENES = { RETENCION: 'retencion', SOLICITUD: 'solicitud' };

/** Un lote más grande no cabe con holgura en un ítem de DynamoDB (400 KB). */
const MAX_OPERACIONES = 400;

const error = (mensaje, codigo) => Object.assign(new Error(mensaje), { codigo });

/** ¿Tiene contenido? `null`, `''`, `false`, objetos o listas vacíos (o con solo vacíos) no;
 *  tampoco el valor por defecto del modelo (las preferencias de fábrica son iguales para todos). */
const significativo = (v) => {
    if (v === undefined || v === null || v === '' || v === false) return false;
    if (Array.isArray(v)) return v.some(significativo);
    if (typeof v === 'object') return Object.values(v).some(significativo);
    return true;
};

const ordenar = (lista, clave) => [...lista].sort((a, b) => clave(a).localeCompare(clave(b)));
const k = (op) => `${op.tabla}|${JSON.stringify(op.clave)}|${op.accion}`;

/**
 * Contenido de un lote de RETENCIÓN, desde el plan (lib/gobernanza/retencion.js)
 * y las versiones actuales de cada archivo a suprimir.
 *
 * @param {object} plan
 * @param {Object<string, string[]>} versiones - por clave de archivo, sus versionIds actuales.
 */
function contenidoDesdePlan(plan, versiones) {
    const operaciones = ordenar(plan.acciones.map((a) => ({
        tabla: a.tabla, clave: a.clave, accion: a.accion,
        ...(a.campos ? { campos: [...a.campos].sort() } : {}),
        ...(a.traza ? { traza: a.traza } : {}),
    })), k);
    const archivos = ordenar(plan.archivos.suprimir.map((key) => ({ key, versiones: [...(versiones[key] || [])].sort() })), (a) => a.key);
    const personas = [...new Set(plan.acciones.flatMap((a) => a.personas || []))].sort();
    return { operaciones, archivos, personas };
}

/**
 * Contenido de un lote por una SOLICITUD de supresión acogida: lo que no es
 * evidencia (D-2). De la ficha, los campos de conveniencia que tenga; su
 * bandeja; sus sugerencias. La evidencia queda para cuando venza su plazo.
 */
function contenidoDesdeSolicitud({ persona, bandeja = [], sugerencias = [] }) {
    const ficha = fuente('PERSONAS_TABLE');
    // Solo lo que tiene contenido: quitar un `false` o unas preferencias por
    // defecto no suprime nada y ensucia lo que ve quien aprueba.
    const defecto = new Persona({});
    const esDefecto = (c) => JSON.stringify(persona[c]) === JSON.stringify(defecto[c]);
    const presentes = ficha.camposConveniencia.filter((c) => persona && significativo(persona[c]) && !esDefecto(c));
    const operaciones = [];
    if (presentes.length) {
        operaciones.push({ tabla: 'PERSONAS_TABLE', clave: ficha.clave(persona), accion: 'quitar_campos', campos: [...presentes].sort() });
    }
    for (const m of bandeja) operaciones.push({ tabla: 'INBOX_TABLE', clave: fuente('INBOX_TABLE').clave(m), accion: 'suprimir' });
    for (const g of sugerencias) operaciones.push({ tabla: 'SUGGESTIONS_TABLE', clave: fuente('SUGGESTIONS_TABLE').clave(g), accion: 'suprimir' });
    return { operaciones: ordenar(operaciones, k), archivos: [], personas: persona ? [persona.personaId] : [] };
}

/** Huella canónica del contenido: lo que se aprueba. */
const huellaDe = (contenido) => calcularHuella(contenido).valor;

function validarTamano(contenido) {
    const n = contenido.operaciones.length + contenido.archivos.reduce((t, a) => t + a.versiones.length, 0);
    if (n === 0) throw error('No hay nada que suprimir.', 'LOTE_VACIO');
    if (n > MAX_OPERACIONES) {
        throw error(`El lote tiene ${n} operaciones; el máximo es ${MAX_OPERACIONES}. Hay que dividirlo.`, 'LOTE_GRANDE');
    }
}

/**
 * ¿Se puede aprobar? `huellaVista`: la que vio quien aprueba. `huellaActual`:
 * la del contenido recalculado ahora.
 */
/**
 * El contenido GUARDADO tiene que seguir teniendo la huella guardada: es lo que
 * se ejecuta. Otros roles pueden actualizar ítems de la tabla de gobernanza, así
 * que un contenido alterado con la huella original se descubre acá.
 */
function contenidoIntegro(lote) {
    if (!lote.contenido || huellaDe(lote.contenido) !== lote.huella) {
        throw error('El contenido guardado del lote no coincide con su huella: fue alterado. No se aprueba ni se ejecuta.', 'LOTE_ALTERADO');
    }
}

function validarAprobacion(lote, { huellaVista, huellaActual }) {
    if (lote.estado !== ESTADOS.PROPUESTO) throw error(`El lote está ${lote.estado}: no se puede aprobar.`, 'ESTADO_INVALIDO');
    contenidoIntegro(lote);
    if (huellaVista !== lote.huella) throw error('Lo que estás aprobando no es el contenido del lote. Vuelve a abrirlo.', 'HUELLA_DISTINTA');
    if (huellaActual !== lote.huella) throw error('Los datos cambiaron desde que se propuso el lote: hay que proponerlo y aprobarlo de nuevo.', 'DESACTUALIZADO');
}

function validarEjecucion(lote, { huellaVista, huellaActual, actor }) {
    if (lote.estado !== ESTADOS.APROBADO) throw error(`El lote está ${lote.estado}: no se puede ejecutar.`, 'ESTADO_INVALIDO');
    contenidoIntegro(lote);
    if (!actor?.personaId) throw error('Falta quién ejecuta', 'SIN_ACTOR');
    if (lote.aprobadoPor?.personaId === actor.personaId) {
        throw error('Aprobaste este lote: lo tiene que ejecutar otra persona.', 'MISMA_PERSONA');
    }
    if (huellaVista !== lote.huella) throw error('Lo que estás ejecutando no es el contenido aprobado. Vuelve a abrirlo.', 'HUELLA_DISTINTA');
    if (huellaActual !== lote.huella) throw error('Los datos cambiaron desde la aprobación: hay que proponer el lote y aprobarlo de nuevo.', 'DESACTUALIZADO');
}

module.exports = {
    ESTADOS, ORIGENES, MAX_OPERACIONES,
    contenidoDesdePlan, contenidoDesdeSolicitud, huellaDe, validarTamano, validarAprobacion, validarEjecucion,
};
