// El token de firma: lo único que lo protege es que no se pueda adivinar.
//
// Es la clave con que cualquiera verifica una firma en la ruta pública de
// verificación. Hasta el 26 de septiembre de 2026 terminaba en un "checksum" que
// nadie verificaba y que dependía de `PIN_SALT`, a veces ausente. Se quitó, y
// estas pruebas fijan que no vuelva algo que parezca una verificación sin serlo,
// y que el token no pierda aleatoriedad.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { generateSignatureToken } = require('../lib/utils/validation');

test('el formato es SIG-[timestamp]-[96 bits aleatorios], sin checksum', () => {
    const token = generateSignatureToken();
    assert.match(token, /^SIG-[0-9A-Z]+-[0-9A-F]{24}$/);
    assert.equal(token.split('-').length, 3, 'tres partes: ya no hay un cuarto segmento de "checksum"');
});

test('no depende de PIN_SALT: con o sin ella, la forma es la misma', () => {
    const original = process.env.PIN_SALT;
    try {
        delete process.env.PIN_SALT;
        const sin = generateSignatureToken();
        process.env.PIN_SALT = 'otra-sal';
        const con = generateSignatureToken();
        assert.equal(sin.split('-')[2].length, con.split('-')[2].length);
    } finally {
        if (original === undefined) delete process.env.PIN_SALT; else process.env.PIN_SALT = original;
    }
});

test('diez mil tokens seguidos no se repiten ni en la parte aleatoria', () => {
    const aleatorias = new Set();
    for (let i = 0; i < 10000; i++) aleatorias.add(generateSignatureToken().split('-')[2]);
    assert.equal(aleatorias.size, 10000);
});
