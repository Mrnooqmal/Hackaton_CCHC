/**
 * Retención aplicada: qué corresponde suprimir, anonimizar o conservar, y por
 * qué. Funciones puras (sin AWS): el proceso programado (`handlers/gobernanza`)
 * carga los datos, llama acá y ejecuta.
 *
 * ── Las reglas (D-2 y decisiones del 28 de septiembre de 2026) ─────────────
 *
 *  1. La evidencia de una persona se conserva hasta `aniosEvidencia` (5) años
 *     desde el término de su vínculo (`fechaTerminoVinculo`). Mientras la
 *     persona siga activa —o no tenga fecha— su plazo no corre: se conserva.
 *  2. Un registro que involucra a varias personas (acta, actividad, documento
 *     con varios firmantes) se conserva COMPLETO hasta que vence el plazo del
 *     último involucrado.
 *  3. Al vencer: los incidentes se anonimizan (se conserva el hecho para los
 *     indicadores); el resto se suprime.
 *  4. Una marca de retención legal (fiscalización o juicio abierto), en la
 *     persona o en toda la empresa, suspende todo: nada de lo que la involucra
 *     vence mientras esté puesta.
 *  5. Ante la duda, se conserva. Una persona que el registro menciona pero que
 *     no aparece (otra empresa, un id viejo) hace que el registro se conserve:
 *     no se puede probar que su plazo venció. Un archivo que ningún registro
 *     menciona también se conserva, y se reporta para revisión.
 *
 * Esto NO borra nada: produce un plan. Ejecutarlo exige la aprobación de dos
 * personas (lotes en la tabla de gobernanza).
 */

const { FUENTES, AL_VENCER, CLASE } = require('./inventario');

const INDEFINIDO = 'indefinido';

/** Configuración por omisión; se sobrescribe desde el entorno (`configDesdeEntorno`). */
const CONFIG = {
    aniosEvidencia: 5,
    // Bloqueo de objetos: cuándo extenderlo, y por cuánto, si la evidencia
    // tiene que seguir más allá del bloqueo actual.
    margenBloqueoDias: 180,
    extensionBloqueoAnios: 1,
};

const configDesdeEntorno = (env = process.env) => ({
    aniosEvidencia: Number(env.GOBERNANZA_ANIOS_EVIDENCIA || CONFIG.aniosEvidencia),
    margenBloqueoDias: Number(env.GOBERNANZA_MARGEN_BLOQUEO_DIAS || CONFIG.margenBloqueoDias),
    extensionBloqueoAnios: Number(env.GOBERNANZA_EXTENSION_BLOQUEO_ANIOS || CONFIG.extensionBloqueoAnios),
});

const ESTADOS_SIN_VINCULO = new Set(['inactivo', 'desvinculado']);

/** Suma años a una fecha en UTC; el 29 de febrero cae al 28 si hace falta. */
function sumarAnios(fecha, anios) {
    const d = new Date(fecha);
    const r = new Date(Date.UTC(d.getUTCFullYear() + anios, d.getUTCMonth(), d.getUTCDate()));
    if (r.getUTCMonth() !== d.getUTCMonth()) r.setUTCDate(0);
    return r;
}

/**
 * Hasta cuándo se conserva la evidencia de UNA persona.
 * @returns {Date|'indefinido'}
 */
function plazoDePersona(persona, config = CONFIG) {
    if (!persona) return INDEFINIDO;
    if (persona.retencionLegal) return INDEFINIDO;
    if (!ESTADOS_SIN_VINCULO.has(persona.estado) || !persona.fechaTerminoVinculo) return INDEFINIDO;
    const termino = new Date(persona.fechaTerminoVinculo);
    if (Number.isNaN(termino.getTime())) return INDEFINIDO;
    return sumarAnios(termino, config.aniosEvidencia);
}

/** El más lejano de varios plazos; `indefinido` gana a cualquier fecha. */
function plazoMayor(plazos) {
    let mayor = null;
    for (const p of plazos) {
        if (p === INDEFINIDO) return INDEFINIDO;
        if (!mayor || p > mayor) mayor = p;
    }
    return mayor;
}

const iso = (p) => (p === INDEFINIDO ? INDEFINIDO : p.toISOString().slice(0, 10));

/**
 * Plan de retención de una empresa.
 *
 * @param {object} p
 * @param {object[]} p.personas - fichas de la empresa (con `personaId`, `estado`,
 *        `fechaTerminoVinculo`, `rutHmac`, `retencionLegal`).
 * @param {Object<string, object[]>} p.registros - ítems por tabla (`PERSONAS_TABLE`, …).
 * @param {object} [p.empresa] - `{ retencionLegal }`.
 * @param {Date} [p.hoy]
 * @param {object} [p.config]
 */
function planDeRetencion({ personas = [], registros = {}, empresa = {}, hoy = new Date(), config = CONFIG }) {
    const porId = new Map(personas.map((x) => [x.personaId, x]));
    const ctx = { personaPorRutHmac: Object.fromEntries(personas.filter((x) => x.rutHmac).map((x) => [x.rutHmac, x.personaId])) };
    const plazo = new Map(personas.map((x) => [x.personaId, empresa.retencionLegal ? INDEFINIDO : plazoDePersona(x, config)]));

    const plan = {
        generadoEn: hoy.toISOString(),
        retencionLegalEmpresa: Boolean(empresa.retencionLegal),
        personas: personas.map((x) => {
            const pl = plazo.get(x.personaId);
            const estado = x.retencionLegal || empresa.retencionLegal ? 'retencion_legal'
                : pl === INDEFINIDO ? 'vigente' : pl <= hoy ? 'vencida' : 'en_plazo';
            return { personaId: x.personaId, estado, conservarHasta: iso(pl) };
        }),
        acciones: [],
        conservados: [],
        // `conservarHasta`: por archivo, el plazo más lejano de los registros que
        // lo mencionan. Es lo que usa la extensión de bloqueos de S3.
        archivos: { suprimir: [], conservarHasta: {} },
    };

    const archivosASuprimir = new Set();
    const archivosAConservar = new Map();
    const conservar = (k, hasta) => {
        const previo = archivosAConservar.get(k);
        archivosAConservar.set(k, previo === undefined ? hasta : plazoMayor([previo, hasta]));
    };

    for (const fuente of FUENTES) {
        if (fuente.alVencer === AL_VENCER.EMPRESA || fuente.alVencer === AL_VENCER.TTL || fuente.clase === CLASE.OPERACIONAL) {
            for (const it of registros[fuente.tabla] || []) fuente.archivosDe(it).forEach((k) => conservar(k, INDEFINIDO));
            continue;
        }
        for (const it of registros[fuente.tabla] || []) {
            const involucradas = [...new Set(fuente.personasDe(it, ctx))];
            const archivos = fuente.archivosDe(it);
            // Sin personas identificables: no vence por personas (regla 5).
            if (involucradas.length === 0) { archivos.forEach((k) => conservar(k, INDEFINIDO)); continue; }

            const hasta = plazoMayor(involucradas.map((id) => (plazo.has(id) ? plazo.get(id) : INDEFINIDO)));
            const clave = fuente.clave(it);
            const vencidaAlguna = involucradas.some((id) => plazo.get(id) !== INDEFINIDO && plazo.get(id) <= hoy);

            if (hasta !== INDEFINIDO && hasta <= hoy) {
                const accion = fuente.alVencer === AL_VENCER.ANONIMIZAR ? 'anonimizar' : 'suprimir';
                plan.acciones.push({ tabla: fuente.tabla, clave, accion, personas: involucradas, vencioEl: iso(hasta),
                    ...(accion === 'anonimizar' ? { campos: fuente.camposPersonales } : {}),
                    // La parte sensible aparte (lib/traza-sensible.js) se borra
                    // en ambos casos: suprimir y anonimizar.
                    ...(fuente.traza ? { traza: { [fuente.traza]: `${it[fuente.traza]}#traza` } } : {}) });
                archivos.forEach((k) => archivosASuprimir.add(k));
            } else {
                archivos.forEach((k) => conservar(k, hasta));
                // Se informa lo que involucra a alguien vencido y sin embargo se
                // conserva, con la razón: es lo que se le responde al titular.
                if (vencidaAlguna) {
                    const legal = involucradas.some((id) => porId.get(id)?.retencionLegal) || empresa.retencionLegal;
                    const desconocida = involucradas.some((id) => !porId.has(id));
                    plan.conservados.push({
                        tabla: fuente.tabla, clave, conservarHasta: iso(hasta),
                        porque: legal ? 'retencion_legal' : desconocida ? 'persona_no_identificada' : 'grupal',
                    });
                }
            }
        }
    }

    // Un archivo que otro registro todavía necesita no se suprime.
    for (const k of archivosASuprimir) if (!archivosAConservar.has(k)) plan.archivos.suprimir.push(k);
    for (const [k, hasta] of archivosAConservar) plan.archivos.conservarHasta[k] = iso(hasta);
    return plan;
}

/**
 * Bloqueos de S3 (Object Lock, modo gobernanza) que hay que extender.
 *
 * El bloqueo cuenta desde la carga; la obligación, desde el término del vínculo
 * (D-2). Un objeto cuyo bloqueo vence dentro de `margenBloqueoDias` y que debe
 * conservarse más allá se extiende: hasta el plazo exacto si se conoce, o un
 * año más si es indefinido. Nunca se acorta (en gobernanza, acortar exige
 * bypass, y este proceso no lo tiene).
 *
 * @param {Array<{key: string, retenerHasta: string|null}>} objetos - con su bloqueo actual (ISO o null).
 * @param {(key: string) => Date|'indefinido'|null} conservarHasta - hasta cuándo debe conservarse cada archivo.
 */
function extensionesDeBloqueo(objetos, conservarHasta, { hoy = new Date(), config = CONFIG } = {}) {
    const limite = new Date(hoy.getTime() + config.margenBloqueoDias * 86400000);
    const extensiones = [];
    for (const o of objetos) {
        const actual = o.retenerHasta ? new Date(o.retenerHasta) : null;
        if (actual && actual > limite) continue;             // todavía lejos de vencer
        const debe = conservarHasta(o.key);
        if (debe === null) continue;                          // se va a suprimir: no se extiende
        const base = actual && actual > hoy ? actual : hoy;
        const nuevo = debe === INDEFINIDO
            ? sumarAnios(base, config.extensionBloqueoAnios)
            : (debe > (actual || new Date(0)) ? debe : null);
        // Solo hacia adelante: ni más corto que el actual, ni en el pasado (un
        // plazo ya vencido no se bloquea: se va a suprimir cuando se apruebe).
        if (nuevo && nuevo > hoy && (!actual || nuevo > actual)) extensiones.push({ key: o.key, desde: actual ? actual.toISOString() : null, hasta: nuevo.toISOString() });
    }
    return extensiones;
}

module.exports = {
    planDeRetencion, plazoDePersona, plazoMayor, extensionesDeBloqueo, sumarAnios,
    configDesdeEntorno, CONFIG, INDEFINIDO,
};
