const { test } = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');
const XLSX = require('xlsx');
const { createTemplateBuffer } = require('../handlers/personas-module/handler');

const abrir = async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await createTemplateBuffer({ roles: ['Persona trabajadora'], cargos: ['Carpintero'], obras: ['Obra Uno (OBRA-001)'] }));
    return wb;
};

test('las instrucciones no prometen los cuatro dígitos y explican la activación', async () => {
    const wb = await abrir();
    const texto = [];
    wb.getWorksheet('Instrucciones').eachRow((r) => texto.push(String(r.getCell(1).value || '')));
    const todo = texto.join('\n');
    assert.ok(!/4 digitos|4 dígitos|cuatro|primeros\s+\d|contrase[nñ]a temporal/i.test(todo), todo);
    assert.match(todo, /pendientes de activacion/);
});

test('fechaNacimiento viene en formato texto en la columna y en las filas con desplegable', async () => {
    const wb = await abrir();
    const ws = wb.getWorksheet('Personas');
    assert.equal(ws.getRow(1).getCell(5).value, 'fechaNacimiento');
    assert.equal(ws.getColumn(5).numFmt, '@');
    for (const fila of [2, 3, 4, 250, 501]) assert.equal(ws.getCell(fila, 5).numFmt, '@', `fila ${fila}`);
    assert.equal(typeof ws.getCell(2, 5).value, 'string', 'el ejemplo es texto, no una fecha');
});

test('una fecha escrita en la columna llega como AAAA-MM-DD al leer la carga', async () => {
    const wb = await abrir();
    const ws = wb.getWorksheet('Personas');
    ws.getCell(4, 1).value = '15.151.515-0';
    ws.getCell(4, 2).value = 'Ana';
    ws.getCell(4, 5).value = '1988-03-09';
    ws.getCell(4, 8).value = 'Persona trabajadora';
    const libro = XLSX.read(Buffer.from(await wb.xlsx.writeBuffer()), { type: 'buffer' });
    const filas = XLSX.utils.sheet_to_json(libro.Sheets.Personas, { header: 1, defval: '' });
    assert.equal(String(filas[3][4]), '1988-03-09');
});
