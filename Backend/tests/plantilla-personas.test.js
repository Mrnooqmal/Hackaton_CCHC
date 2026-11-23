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

test('las instrucciones explican la contraseña inicial, que vence a los 7 días y cómo reactivarla', async () => {
    const wb = await abrir();
    const texto = [];
    wb.getWorksheet('Instrucciones').eachRow((r) => texto.push(String(r.getCell(1).value || '')));
    const siete = texto.find((t) => t.startsWith('7.'));
    assert.match(siete, /4 primeros digitos de su RUT/);
    assert.match(siete, /vence a los 7 dias/);
    assert.match(siete, /reactiva/);
    assert.match(siete, /cambiarla y crear su PIN/);
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
    ws.getCell(4, 7).value = 'Persona trabajadora';
    const libro = XLSX.read(Buffer.from(await wb.xlsx.writeBuffer()), { type: 'buffer' });
    const filas = XLSX.utils.sheet_to_json(libro.Sheets.Personas, { header: 1, defval: '' });
    assert.equal(String(filas[3][4]), '1988-03-09');
});

test('la plantilla no pide el teléfono de la persona', async () => {
    const ws = (await abrir()).getWorksheet('Personas');
    assert.ok(!ws.getRow(1).values.includes('telefono'));
});

test('el teléfono del contacto de emergencia viene en formato texto, para que Excel no le quite el + ni lo convierta en número', async () => {
    const wb = await abrir();
    const ws = wb.getWorksheet('Personas');
    const col = 13;
    assert.equal(ws.getRow(1).getCell(col).value, 'contactoEmergenciaTelefono');
    assert.equal(ws.getColumn(col).numFmt, '@');
    assert.equal(ws.getCell(300, col).numFmt, '@');
    ws.getCell(4, col).value = '+56912345678';
    const libro = XLSX.read(Buffer.from(await wb.xlsx.writeBuffer()), { type: 'buffer' });
    const filas = XLSX.utils.sheet_to_json(libro.Sheets.Personas, { header: 1, defval: '' });
    assert.equal(String(filas[3][col - 1]), '+56912345678');
});
