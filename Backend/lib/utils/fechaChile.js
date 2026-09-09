/**
 * Fecha y hora locales de Chile.
 *
 * Las firmas y registros del DS 44 se leen en hora del país, pero Lambda corre
 * con el reloj en UTC: `toTimeString()` adelantaba las firmas 3-4 horas y, a
 * partir de las 21:00, las fechaba al día siguiente. El `timestamp` ISO sigue
 * siendo la fuente de verdad para ordenar y comparar; esto es solo la lectura
 * humana que se estampa en los documentos.
 */

const TZ = 'America/Santiago';

// `hourCycle: 'h23'` evita que la medianoche salga como "24:00" (ICU con hour12:false).
const FORMATO = new Intl.DateTimeFormat('es-CL', {
    timeZone: TZ,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hourCycle: 'h23',
});

/**
 * @param {Date|string|number} [instante] Fecha a convertir (por defecto, ahora).
 * @returns {{ fecha: string, horario: string }} `YYYY-MM-DD` y `HH:MM:SS` en Chile.
 */
function fechaHoraChile(instante = new Date()) {
    const date = instante instanceof Date ? instante : new Date(instante);
    const p = Object.fromEntries(FORMATO.formatToParts(date).map((x) => [x.type, x.value]));
    return {
        fecha: `${p.year}-${p.month}-${p.day}`,
        horario: `${p.hour}:${p.minute}:${p.second}`,
    };
}

/** Solo `HH:MM` en Chile (hora de inicio/fin de actividades). */
function horaChileHHMM(instante = new Date()) {
    return fechaHoraChile(instante).horario.slice(0, 5);
}

/**
 * Días hábiles.
 *
 * SUPUESTO NORMATIVO EXPLÍCITO: se excluyen sábados y domingos, NO los feriados
 * legales. Es la misma decisión que ya toma `generarFechasRecurrencia` en el
 * módulo de actividades, y se mantiene por dos razones:
 *
 *   1. No existe calendario de feriados en el sistema, y mantenerlo año a año
 *      (con los variables y los regionales) es infraestructura que hoy nadie
 *      sostiene. Un calendario desactualizado miente con más confianza que no
 *      tenerlo.
 *   2. El error cae del lado seguro. Los feriados solo ALARGAN el plazo real,
 *      así que la fecha límite calculada aquí llega antes que la verdadera y el
 *      recordatorio avisa temprano, nunca tarde.
 *
 * Se usa para el plazo del Art. 36 (registrar el acta de constitución del comité
 * paritario en la Dirección del Trabajo dentro de 15 días hábiles desde la
 * elección). Como el plazo es legal, la UI debe mostrar la fecha como referencial
 * y no como una afirmación de cumplimiento.
 */

const MS_DIA = 86400000;

/** ¿Es sábado o domingo? Se evalúa en hora de Chile, no en UTC. */
function esFinDeSemana(fecha) {
    const { fecha: ymd } = fechaHoraChile(fecha);
    // Mediodía UTC evita que el desfase horario corra el día al convertir.
    const dia = new Date(`${ymd}T12:00:00Z`).getUTCDay();
    return dia === 0 || dia === 6;
}

/**
 * Suma `n` días hábiles a una fecha. El día de inicio no cuenta: un plazo de
 * "15 días hábiles desde la elección" empieza a correr al día hábil siguiente.
 *
 * @param {Date|string} desde
 * @param {number} n Días hábiles a sumar.
 * @returns {string|null} ISO del último día del plazo, o null si la fecha es inválida.
 */
function sumarDiasHabiles(desde, n) {
    const inicio = desde instanceof Date ? new Date(desde) : new Date(desde);
    if (Number.isNaN(inicio.getTime())) return null;
    const cantidad = Number(n);
    if (!Number.isFinite(cantidad) || cantidad < 0) return null;

    let cursor = new Date(inicio.getTime());
    let restantes = Math.floor(cantidad);
    while (restantes > 0) {
        cursor = new Date(cursor.getTime() + MS_DIA);
        if (!esFinDeSemana(cursor)) restantes -= 1;
    }
    return cursor.toISOString();
}

/**
 * Días hábiles transcurridos entre dos fechas, sin contar el día de inicio.
 * Negativo no existe: si `hasta` es anterior a `desde`, devuelve 0.
 */
function contarDiasHabiles(desde, hasta) {
    const a = desde instanceof Date ? new Date(desde) : new Date(desde);
    const b = hasta instanceof Date ? new Date(hasta) : new Date(hasta);
    if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return null;
    if (b.getTime() <= a.getTime()) return 0;

    let cursor = new Date(a.getTime());
    let habiles = 0;
    while (cursor.getTime() < b.getTime()) {
        cursor = new Date(cursor.getTime() + MS_DIA);
        if (cursor.getTime() > b.getTime()) break;
        if (!esFinDeSemana(cursor)) habiles += 1;
    }
    return habiles;
}

module.exports = { fechaHoraChile, horaChileHHMM, esFinDeSemana, sumarDiasHabiles, contarDiasHabiles, TZ };

