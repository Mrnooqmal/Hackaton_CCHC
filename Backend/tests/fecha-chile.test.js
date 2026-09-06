const { test } = require('node:test');
const assert = require('node:assert/strict');
const { fechaHoraChile, horaChileHHMM } = require('../lib/utils/fechaChile');

// Lambda corre con el reloj en UTC. Las firmas se estampaban con esa hora, así
// que aparecían 3-4 horas adelantadas y, pasadas las 21:00, con la fecha del día
// siguiente. Estos tests fijan la lectura en hora de Chile.

test('una firma de las 18:06 en Chile no se estampa como 21:06', () => {
    const { fecha, horario } = fechaHoraChile('2026-09-06T21:06:00Z');
    assert.equal(horario, '18:06:00');
    assert.equal(fecha, '2026-09-06');
});

test('firmar de noche no adelanta la fecha al día siguiente', () => {
    // 22:00 del 6 de septiembre en Chile es el 7 a las 01:00 UTC.
    const { fecha, horario } = fechaHoraChile('2026-09-07T01:00:00Z');
    assert.equal(fecha, '2026-09-06', 'la firma pertenece al día en que se firmó');
    assert.equal(horario, '22:00:00');
});

test('la medianoche se escribe 00:00:00 y no 24:00:00', () => {
    const { fecha, horario } = fechaHoraChile('2026-09-07T03:00:00Z');
    assert.equal(horario, '00:00:00');
    assert.equal(fecha, '2026-09-07');
});

test('sigue el horario de verano: UTC-3 en enero, UTC-4 en julio', () => {
    assert.equal(fechaHoraChile('2026-01-15T14:30:00Z').horario, '11:30:00', 'verano: UTC-3');
    assert.equal(fechaHoraChile('2026-07-15T14:30:00Z').horario, '10:30:00', 'invierno: UTC-4');
});

test('acepta Date, string ISO y epoch', () => {
    const esperado = { fecha: '2026-09-06', horario: '18:06:00' };
    const iso = '2026-09-06T21:06:00Z';
    assert.deepEqual(fechaHoraChile(new Date(iso)), esperado);
    assert.deepEqual(fechaHoraChile(iso), esperado);
    assert.deepEqual(fechaHoraChile(new Date(iso).getTime()), esperado);
});

test('horaChileHHMM entrega solo hora y minutos', () => {
    assert.equal(horaChileHHMM('2026-09-06T21:06:00Z'), '18:06');
});
