/**
 * Vigencia de los documentos de obra: cuándo caducan y hace cuánto se revisaron.
 *
 * El DS 44 razona la MIPER en términos de antigüedad ("revisada al menos
 * anualmente", Art. 7 inc. 9), no de fechas absolutas. Por eso la ficha muestra
 * "hace 3 meses" en vez de una fecha: es la lectura con la que un fiscalizador
 * evalúa el documento, y hace evidente el que lleva demasiado sin tocarse.
 */

/** Meses de vigencia por defecto cuando no se elige una fecha de caducidad. */
export const MESES_VIGENCIA_DEFECTO = 12;

/**
 * Fecha de caducidad por defecto: un año desde hoy, en formato `YYYY-MM-DD`.
 *
 * `setMonth` con desbordamiento de día ajusta solo (31 de marzo + 12 meses sigue
 * siendo 31 de marzo), así que no hace falta corregirlo a mano.
 */
export function caducidadPorDefecto(desde: Date = new Date()): string {
    const fecha = new Date(desde);
    fecha.setMonth(fecha.getMonth() + MESES_VIGENCIA_DEFECTO);
    return fecha.toISOString().slice(0, 10);
}

/**
 * Antigüedad en lenguaje natural: "hoy", "hace 5 días", "hace 3 meses".
 *
 * Los meses se cuentan por calendario, no dividiendo días por 30: entre el 1 de
 * enero y el 1 de marzo hay 2 meses, aunque sean 59 días.
 *
 * @returns null si la fecha falta o no es válida (el llamador decide qué mostrar).
 */
export function tiempoRelativo(valor?: string | null, ahora: Date = new Date()): string | null {
    if (!valor) return null;
    const fecha = new Date(valor);
    if (Number.isNaN(fecha.getTime())) return null;

    const dias = Math.floor((ahora.getTime() - fecha.getTime()) / 86_400_000);
    if (dias < 0) return null;
    if (dias === 0) return 'hoy';
    if (dias === 1) return 'ayer';
    if (dias < 31) return `hace ${dias} días`;

    const meses = (ahora.getFullYear() - fecha.getFullYear()) * 12
        + (ahora.getMonth() - fecha.getMonth())
        - (ahora.getDate() < fecha.getDate() ? 1 : 0);

    if (meses < 12) return `hace ${meses} ${meses === 1 ? 'mes' : 'meses'}`;

    const anios = Math.floor(meses / 12);
    const resto = meses % 12;
    const base = `hace ${anios} ${anios === 1 ? 'año' : 'años'}`;
    return resto === 0 ? base : `${base} y ${resto} ${resto === 1 ? 'mes' : 'meses'}`;
}

/**
 * ¿La última revisión superó la vigencia esperada? Sirve para marcar en la ficha
 * un documento que sigue "sin caducar" solo porque nadie le puso fecha.
 */
export function revisionVencida(
    ultimaRevision?: string | null,
    meses: number = MESES_VIGENCIA_DEFECTO,
    ahora: Date = new Date(),
): boolean {
    if (!ultimaRevision) return false;
    const fecha = new Date(ultimaRevision);
    if (Number.isNaN(fecha.getTime())) return false;
    const limite = new Date(fecha);
    limite.setMonth(limite.getMonth() + meses);
    return limite < ahora;
}
