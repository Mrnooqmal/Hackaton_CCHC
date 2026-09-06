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

module.exports = { fechaHoraChile, horaChileHHMM, TZ };
