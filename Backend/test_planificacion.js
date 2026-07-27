/**
 * Test de generarFechasRecurrencia con exclusión de fin de semana.
 * Ejecutar: node test_planificacion.js
 */
process.env.ACTIVITIES_TABLE = 'test';
const { generarFechasRecurrencia } = require('./handlers/activities/handler');

let ok = 0, fail = 0;
const assert = (cond, msg) => {
    if (cond) { ok++; console.log(`  ✓ ${msg}`); }
    else { fail++; console.error(`  ✗ ${msg}`); }
};

console.log('— Diaria sin exclusión (comportamiento previo intacto) —');
// Lunes 2026-07-20 a domingo 2026-07-26: 7 días corridos.
let fechas = generarFechasRecurrencia('2026-07-20', '2026-07-26', 'diaria');
assert(fechas.length === 7, `7 fechas corridas (obtuvo ${fechas.length})`);
assert(fechas.includes('2026-07-25') && fechas.includes('2026-07-26'), 'incluye sábado y domingo');

console.log('— Diaria con exclusión de fin de semana —');
fechas = generarFechasRecurrencia('2026-07-20', '2026-07-26', 'diaria', true);
assert(fechas.length === 5, `5 fechas hábiles lun-vie (obtuvo ${fechas.length})`);
assert(!fechas.includes('2026-07-25'), 'excluye sábado 25');
assert(!fechas.includes('2026-07-26'), 'excluye domingo 26');
assert(fechas[0] === '2026-07-20' && fechas[4] === '2026-07-24', 'lunes a viernes correctos');

console.log('— Mes completo julio 2026 con exclusión —');
fechas = generarFechasRecurrencia('2026-07-01', '2026-07-31', 'diaria', true);
assert(fechas.length === 23, `23 días hábiles en julio 2026 (obtuvo ${fechas.length})`);
assert(fechas.every(f => {
    const d = new Date(`${f}T00:00:00`).getDay();
    return d !== 0 && d !== 6;
}), 'ninguna fecha cae en fin de semana');

console.log('— Semanal con exclusión: parte en sábado, se omite esa ocurrencia —');
// Sábado 2026-07-25, semanal hasta 2026-08-15: los sábados se saltan todos.
fechas = generarFechasRecurrencia('2026-07-25', '2026-08-15', 'semanal', true);
assert(fechas.length === 0, `serie semanal en sábado queda vacía (obtuvo ${fechas.length})`);

console.log('— Semanal con exclusión: parte en miércoles, todas válidas —');
fechas = generarFechasRecurrencia('2026-07-22', '2026-08-12', 'semanal', true);
assert(fechas.length === 4, `4 miércoles (obtuvo ${fechas.length})`);

console.log('— Rango inválido devuelve solo inicio (comportamiento previo) —');
fechas = generarFechasRecurrencia('2026-07-20', '2026-07-10', 'diaria', true);
assert(fechas.length === 1 && fechas[0] === '2026-07-20', 'rango invertido → [inicio]');

console.log(`\n${ok} OK, ${fail} fallidas`);
process.exit(fail > 0 ? 1 : 0);
