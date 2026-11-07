/**
 * Progreso de los recorridos guiados: reglas puras. `handlers/ayuda/progreso.js`
 * las aplica sobre la tabla y el frontend respeta las mismas (su gemelo es
 * `Frontend/src/ayuda/tipos.ts`; `tests/ayuda-gemelos.test.js` exige que
 * coincidan).
 *
 * Los recorridos son código (D-33): sus definiciones viven en el frontend,
 * versionadas en git. El servidor no las conoce ni las necesita; guarda solo qué
 * vio cada persona, en qué versión y hasta dónde llegó.
 *
 * ── El estado nunca retrocede ──────────────────────────────────────────────
 * El progreso llega desde una cola sin conexión, así que un evento viejo puede
 * llegar después de uno nuevo. La fusión es una función de lo guardado y lo que
 * llega, no del orden de llegada:
 *
 *   - versión mayor:  reinicia (el recorrido cambió y se publicó para volver a
 *                     mostrarse; el frontend decide cuándo subir la versión).
 *   - versión menor:  se ignora (un evento de una versión anterior).
 *   - misma versión:  el estado sube y nunca baja
 *                     (en_progreso < omitido < completado); los cierres y el
 *                     último paso, el máximo de ambos.
 *
 * Repetir la misma escritura deja el mismo resultado: es idempotente.
 *
 * ── Regla de la cola de obligatorios (aprobada en la Fase 0) ───────────────
 * Completar u "Omitir recorrido" lo sacan de la cola. Cerrar con la X o con Esc
 * lo deja en curso y suma un cierre; al tercero cuenta como omitido. El
 * servidor aplica la regla al fusionar, para que no dependa de que cada cliente
 * la recuerde.
 */

const ESTADOS = Object.freeze({
    EN_PROGRESO: 'en_progreso',
    OMITIDO: 'omitido',
    COMPLETADO: 'completado',
});

/** Orden de los estados: el progreso solo avanza en este sentido. */
const RANGO = Object.freeze({ en_progreso: 0, omitido: 1, completado: 2 });

const LIMITES = Object.freeze({
    /** Slug del recorrido: minúsculas, dígitos y guiones. */
    LARGO_ID: 64,
    VERSION_MAX: 10000,
    /** Pasos de un recorrido; `ultimoPaso` es un índice menor que esto. */
    PASOS_MAX: 20,
    /** Al tercer cierre sin completar, el recorrido cuenta como omitido. */
    CIERRES_PARA_OMITIR: 3,
    CIERRES_MAX: 99,
    /** Filas por persona y empresa: acota lo que una sesión puede escribir. */
    RECORRIDOS_POR_PERSONA: 200,
});

const ID_RECORRIDO = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const CAMPOS_ENTRADA = new Set(['version', 'estado', 'ultimoPaso', 'cierres']);

const fallo = (mensaje) => Object.assign(new Error(mensaje), { codigo: 'ENTRADA_INVALIDA' });

const entero = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;

/** ¿Es un identificador de recorrido válido? */
const idValido = (id) => typeof id === 'string' && id.length <= LIMITES.LARGO_ID && ID_RECORRIDO.test(id);

/**
 * Valida y normaliza lo que manda el cliente. Lista blanca: un campo que no
 * está en ella se rechaza, no se ignora (un cliente que manda `personaId` o
 * `tenantId` está mal hecho o intentando algo, y ninguno de los dos sale de
 * aquí: salen de la sesión).
 *
 * @returns {{recorridoId: string, version: number, estado: string, ultimoPaso: number, cierres: number}}
 */
function validarEntrada(recorridoId, cuerpo) {
    if (!idValido(recorridoId)) throw fallo('Identificador de recorrido inválido.');
    if (!cuerpo || typeof cuerpo !== 'object' || Array.isArray(cuerpo)) throw fallo('Cuerpo inválido.');
    const sobran = Object.keys(cuerpo).filter((k) => !CAMPOS_ENTRADA.has(k));
    if (sobran.length) throw fallo(`Campos no permitidos: ${sobran.sort().join(', ')}.`);

    const { version, estado, ultimoPaso = 0, cierres = 0 } = cuerpo;
    if (!entero(version, 1, LIMITES.VERSION_MAX)) throw fallo(`version debe ser un entero entre 1 y ${LIMITES.VERSION_MAX}.`);
    if (!Object.prototype.hasOwnProperty.call(RANGO, estado)) throw fallo(`estado debe ser uno de: ${Object.values(ESTADOS).join(', ')}.`);
    if (!entero(ultimoPaso, 0, LIMITES.PASOS_MAX - 1)) throw fallo(`ultimoPaso debe ser un entero entre 0 y ${LIMITES.PASOS_MAX - 1}.`);
    if (!entero(cierres, 0, LIMITES.CIERRES_MAX)) throw fallo(`cierres debe ser un entero entre 0 y ${LIMITES.CIERRES_MAX}.`);

    return { recorridoId, version, estado, ultimoPaso, cierres };
}

/** En curso con tres cierres o más cuenta como omitido. */
const aplicarRegla = (p) => (p.estado === ESTADOS.EN_PROGRESO && p.cierres >= LIMITES.CIERRES_PARA_OMITIR
    ? { ...p, estado: ESTADOS.OMITIDO }
    : p);

/**
 * Fusiona el progreso guardado con el que llega.
 *
 * @param {object|null} actual  lo guardado (o null si no hay nada)
 * @param {object} entrante     ya validado por `validarEntrada`
 * @returns {{progreso: object, cambia: boolean}} `cambia`: si hay que escribir
 */
function fusionar(actual, entrante) {
    const campos = (p) => ({ version: p.version, estado: p.estado, ultimoPaso: p.ultimoPaso, cierres: p.cierres });
    if (!actual) return { progreso: aplicarRegla(campos(entrante)), cambia: true };

    const guardado = campos(actual);
    if (entrante.version < guardado.version) return { progreso: guardado, cambia: false };
    if (entrante.version > guardado.version) return { progreso: aplicarRegla(campos(entrante)), cambia: true };

    const fusion = aplicarRegla({
        version: guardado.version,
        estado: RANGO[entrante.estado] > RANGO[guardado.estado] ? entrante.estado : guardado.estado,
        ultimoPaso: Math.max(guardado.ultimoPaso, entrante.ultimoPaso),
        cierres: Math.max(guardado.cierres, entrante.cierres),
    });
    const cambia = Object.keys(fusion).some((k) => fusion[k] !== guardado[k]);
    return { progreso: fusion, cambia };
}

/** Clave de ordenamiento: todo el progreso de una persona comparte el prefijo. */
const prefijoPersona = (personaId) => `${personaId}#`;
const claveOrden = (personaId, recorridoId) => `${prefijoPersona(personaId)}${recorridoId}`;

/** Lo que sale por la API: sin claves internas ni la revisión. */
const vista = (it) => ({
    recorridoId: it.recorridoId,
    version: it.version,
    estado: it.estado,
    ultimoPaso: it.ultimoPaso,
    cierres: it.cierres,
    actualizadoEn: it.actualizadoEn,
});

module.exports = {
    ESTADOS, RANGO, LIMITES, ID_RECORRIDO,
    idValido, validarEntrada, fusionar, prefijoPersona, claveOrden, vista,
};
