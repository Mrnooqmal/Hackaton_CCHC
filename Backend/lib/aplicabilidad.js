/**
 * ¿Le corresponde este requisito a esta obra?
 *
 * Antes vivía solo en el frontend (`utils/ds44.ts`), así que el panel de la obra
 * sabía que el procedimiento de maquinaria no aplica a una obra sin maquinaria y
 * el motor de completitud no. Un mismo requisito salía "no aplica" en una
 * pantalla y "pendiente" en la otra.
 *
 * La regla vive acá, junto a los umbrales de dotación, y la evalúa el motor: la
 * interfaz pinta lo que el servidor decidió.
 *
 * `verificar` es deliberado: cuando falta el dato para decidir NO se oculta el
 * requisito. Suponer que una obra no tiene maquinaria porque nadie lo declaró es
 * exactamente cómo se pierde una obligación.
 */

const APLICABILIDAD = {
    APLICA: 'aplica',
    NO_APLICA: 'no_aplica',
    VERIFICAR: 'verificar',
};

/** Condiciones que puede declarar una definición. */
const CONDICION = {
    SIEMPRE: 'siempre',
    FAENA_COMPARTIDA: 'faena_compartida',   // Art. 20
    TIENE_MAQUINARIA: 'tiene_maquinaria',   // Art. 10
    AGENTES_FQB: 'agentes_fqb',             // Art. 2 N.° 14 c)
};

/** Un booleano declarado por la obra: sin declarar es `verificar`, no `no aplica`. */
const porDeclaracion = (valor) => {
    if (valor === undefined || valor === null) return APLICABILIDAD.VERIFICAR;
    return valor ? APLICABILIDAD.APLICA : APLICABILIDAD.NO_APLICA;
};

/**
 * @param {string} condicion
 * @param {object} ctx  Contexto del motor: `obra` trae lo declarado en la faena.
 */
function evaluarAplicabilidad(condicion, ctx = {}) {
    const obra = ctx.obra || {};
    switch (condicion) {
        case CONDICION.FAENA_COMPARTIDA: return porDeclaracion(obra.faenaCompartida);
        case CONDICION.TIENE_MAQUINARIA: return porDeclaracion(obra.tieneMaquinaria);
        case CONDICION.AGENTES_FQB: return porDeclaracion(obra.agentesFQB);
        case CONDICION.SIEMPRE:
        default:
            return APLICABILIDAD.APLICA;
    }
}

/** Texto de por qué un requisito quedó fuera. El expediente lo exige. */
const RAZON_NO_APLICA = {
    [CONDICION.FAENA_COMPARTIDA]: 'La obra declaró que no concurren otras entidades empleadoras.',
    [CONDICION.TIENE_MAQUINARIA]: 'La obra declaró que no utiliza máquinas ni equipos motrices.',
    [CONDICION.AGENTES_FQB]: 'La obra declaró que no utiliza agentes físicos, químicos ni biológicos.',
};

const RAZON_VERIFICAR = {
    [CONDICION.FAENA_COMPARTIDA]: 'Falta declarar si concurren otras entidades empleadoras en esta faena.',
    [CONDICION.TIENE_MAQUINARIA]: 'Falta declarar si la obra utiliza máquinas o equipos motrices.',
    [CONDICION.AGENTES_FQB]: 'Falta declarar si la obra utiliza agentes físicos, químicos o biológicos.',
};

module.exports = {
    APLICABILIDAD, CONDICION, evaluarAplicabilidad, RAZON_NO_APLICA, RAZON_VERIFICAR,
};
