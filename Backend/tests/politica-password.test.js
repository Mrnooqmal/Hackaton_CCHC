// H-21: una sola política de contraseña para el alta, el cambio y el restablecimiento.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { problemaPassword, MIN_PASSWORD } = require('../lib/utils/politicaPassword');

test('exige 8 caracteres con letras y números', () => {
    assert.equal(MIN_PASSWORD, 8);
    assert.match(problemaPassword('abc12'), /al menos 8/);
    assert.match(problemaPassword('abcdefgh'), /letras y números/);
    assert.match(problemaPassword('12345678'), /letras y números/);
    assert.equal(problemaPassword('obra2026'), null);
});

test('el alta de empresa y las rutas de contraseña usan la misma política', () => {
    const auth = fs.readFileSync(path.join(__dirname, '..', 'handlers', 'auth', 'handler.js'), 'utf8');
    assert.equal((auth.match(/problemaPassword\(passwordNuevo\)/g) || []).length, 2, 'cambio y restablecimiento');
    assert.ok(!/length < 6/.test(auth), 'no debe quedar la regla de 6 caracteres');
    const alta = fs.readFileSync(path.join(__dirname, '..', 'lib', 'services', 'AltaEmpresaService.js'), 'utf8');
    assert.match(alta, /require\('\.\.\/utils\/politicaPassword'\)/);
});
