/**
 * Test de generarFechasRecurrencia con exclusión de fin de semana.
 * Ejecutar: node test_planificacion.js
 */
process.env.ACTIVITIES_TABLE = 'test';
const handler = require('./handlers/activities/handler');
const { generarFechasRecurrencia, _calcularAtraso: calcularAtraso, _registroTieneContenido: registroTieneContenido } = handler;

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

console.log('— Etiqueta de atraso de firmas —');
let a = calcularAtraso('09:15', '09:00');
assert(a.atraso === true && a.minutosAtraso === 15, 'firma 15 min tarde → atraso 15');
a = calcularAtraso('09:00', '09:00');
assert(a.atraso === false && a.minutosAtraso === 0, 'firma en punto → sin atraso');
a = calcularAtraso('08:50', '09:00');
assert(a.atraso === false && a.minutosAtraso === 0, 'firma anticipada → sin atraso');
a = calcularAtraso('09:05:30', '09:00');
assert(a.atraso === true && a.minutosAtraso === 5, 'acepta HH:MM:SS → atraso 5');
a = calcularAtraso(undefined, '09:00');
assert(a.atraso === false && a.minutosAtraso === 0, 'hora de firma faltante → sin atraso (defensivo)');
a = calcularAtraso('09:10', null);
assert(a.atraso === false && a.minutosAtraso === 0, 'hora programada faltante → sin atraso (defensivo)');

console.log('— Registro con contenido (guarda de cierre) —');
assert(registroTieneContenido({ tipo: 'CHARLA_5MIN', descripcion: 'Charla de andamios' }) === true,
    'con descripción → tiene contenido');
assert(registroTieneContenido({ tipo: 'CHARLA_5MIN', planificacion: { tema: { codigo: 'ANDAMIOS' } } }) === true,
    'con tema de planificación → tiene contenido');
assert(registroTieneContenido({ tipo: 'CHARLA_5MIN', planificacion: { tema: { otro: 'Tema libre' } } }) === true,
    'con tema "otro" → tiene contenido');
assert(registroTieneContenido({ tipo: 'INSPECCION', asistentesRequeridos: ['p1'] }) === true,
    'con asistentes requeridos → tiene contenido');
assert(registroTieneContenido({ tipo: 'CHARLA_5MIN', permisosTrabajo: [{ tipo: 'ALTURA' }] }) === true,
    'con permiso de trabajo → tiene contenido');
assert(registroTieneContenido({ tipo: 'CHARLA_5MIN' }) === false,
    'sin ningún dato → registro vacío');
assert(registroTieneContenido({ tipo: 'CHARLA_5MIN', descripcion: '   ', planificacion: { tema: { otro: '  ' } } }) === false,
    'solo espacios en blanco → registro vacío');

console.log(`\n${ok} OK, ${fail} fallidas`);
process.exit(fail > 0 ? 1 : 0);
