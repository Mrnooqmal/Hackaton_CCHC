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
    assert.equal(estadoAcceso({ tieneAccesoWeb: true, activacionPendiente: true, credencialInicial: true, passwordTemporal: true, passwordTemporalVence: despues }, ahora), 'inicial-vigente');
    assert.equal(estadoAcceso({ tieneAccesoWeb: true, activacionPendiente: true, credencialInicial: true, passwordTemporal: true, passwordTemporalVence: antes }, ahora), 'inicial-vencida');
    assert.equal(estadoAcceso({ tieneAccesoWeb: true, passwordTemporal: true }, ahora), 'pendiente', 'una ficha vieja con los cuatro dígitos se activa como pendiente');
    assert.equal(estadoAcceso({ tieneAccesoWeb: true, passwordTemporal: false }, ahora), 'activo');
    assert.equal(pendienteDeActivacion({ passwordTemporal: true, passwordTemporalVence: despues }), false, 'una temporal con vencimiento sin la marca no es una activación');
});

test('una contraseña restablecida se distingue de una activación y no se ofrece reactivarla', () => {
    const { estadoAcceso, reactivable } = cargarTs('accesoPersona.ts');
    const restablecida = { tieneAccesoWeb: true, passwordTemporal: true, passwordRestablecido: { por: 'p-1', en: antes } };
    assert.equal(estadoAcceso({ ...restablecida, passwordTemporalVence: despues }, ahora), 'restablecida-vigente');
    assert.equal(estadoAcceso({ ...restablecida, passwordTemporalVence: antes }, ahora), 'restablecida-vencida');
    assert.equal(reactivable('restablecida-vigente'), false);
    assert.equal(reactivable('restablecida-vencida'), false);
});

test('se ofrece reactivar el acceso inicial salvo con una temporal de 2 horas vigente', () => {
    const { reactivable } = cargarTs('accesoPersona.ts');
    for (const e of ['pendiente', 'inicial-vigente', 'inicial-vencida', 'temporal-vencida']) assert.equal(reactivable(e), true, e);
    for (const e of ['temporal-vigente', 'activo', 'sin-acceso']) assert.equal(reactivable(e), false, e);
});

test('la pantalla de activación no guarda la contraseña temporal en el navegador', () => {
    for (const archivo of ['src/components/AccesoPlataforma.tsx', 'src/pages/ActivarAccesos.tsx']) {
        const codigo = fs.readFileSync(path.join(FRONTEND, archivo), 'utf8');
        assert.ok(!/localStorage|sessionStorage|indexedDB/.test(codigo), archivo);
        assert.ok(!/console\.(log|info|warn|error)/.test(codigo), archivo);
    }
});

test('toda pantalla que habla de los cuatro dígitos del RUT dice también que vencen a los 7 días', () => {
    const malos = [];
    const recorrer = (dir) => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
            const p = path.join(dir, e.name);
            if (e.isDirectory()) recorrer(p);
            else if (/\.(tsx?|md)$/.test(e.name)) {
                const texto = fs.readFileSync(p, 'utf8');
                if (/cuatro primeros d[ií]gitos|primeros 4 d[ií]gitos|4 primeros d[ií]gitos/i.test(texto) && !/7 d[ií]as|siete d[ií]as/i.test(texto)) malos.push(path.relative(FRONTEND, p));
            }
        }
    };
    recorrer(path.join(FRONTEND, 'src'));
    assert.deepEqual(malos, []);
});
