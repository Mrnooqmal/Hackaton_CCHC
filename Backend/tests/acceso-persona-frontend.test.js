const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { cargarTs, FRONTEND } = require('./cargar-ts');

const ahora = new Date('2026-12-03T12:00:00Z');
const antes = '2026-12-03T11:00:00Z';
const despues = '2026-12-03T13:00:00Z';

test('el estado de acceso que muestra la ficha y la lista', () => {
    const { estadoAcceso, pendienteDeActivacion } = cargarTs('accesoPersona.ts');
    assert.equal(estadoAcceso({ tieneAccesoWeb: false }, ahora), 'sin-acceso');
    assert.equal(estadoAcceso({ tieneAccesoWeb: true, activacionPendiente: true }, ahora), 'pendiente');
    assert.equal(estadoAcceso({ tieneAccesoWeb: true, activacionPendiente: true, passwordTemporal: true, passwordTemporalVence: despues }, ahora), 'temporal-vigente');
    assert.equal(estadoAcceso({ tieneAccesoWeb: true, activacionPendiente: true, passwordTemporal: true, passwordTemporalVence: antes }, ahora), 'temporal-vencida');
    assert.equal(estadoAcceso({ tieneAccesoWeb: true, passwordTemporal: true }, ahora), 'pendiente', 'una ficha vieja con los cuatro dígitos se activa como pendiente');
    assert.equal(estadoAcceso({ tieneAccesoWeb: true, passwordTemporal: false }, ahora), 'activo');
    assert.equal(pendienteDeActivacion({ passwordTemporal: true, passwordTemporalVence: despues }), false, 'una temporal con vencimiento sin la marca no es una activación');
});

test('la pantalla de activación no guarda la contraseña temporal en el navegador', () => {
    for (const archivo of ['src/components/AccesoPlataforma.tsx', 'src/pages/ActivarAccesos.tsx']) {
        const codigo = fs.readFileSync(path.join(FRONTEND, archivo), 'utf8');
        assert.ok(!/localStorage|sessionStorage|indexedDB/.test(codigo), archivo);
        assert.ok(!/console\.(log|info|warn|error)/.test(codigo), archivo);
    }
});

test('ninguna pantalla promete los cuatro dígitos del RUT como contraseña', () => {
    const malos = [];
    const recorrer = (dir) => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
            const p = path.join(dir, e.name);
            if (e.isDirectory()) recorrer(p);
            else if (/\.(tsx?|md)$/.test(e.name) && /cuatro primeros d[ií]gitos|primeros 4 d[ií]gitos|4 primeros d[ií]gitos/i.test(fs.readFileSync(p, 'utf8'))) malos.push(path.relative(FRONTEND, p));
        }
    };
    recorrer(path.join(FRONTEND, 'src'));
    assert.deepEqual(malos, []);
});
