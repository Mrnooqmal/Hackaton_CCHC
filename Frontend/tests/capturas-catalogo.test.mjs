// El catálogo de capturas del manual (tests/capturas/catalogo.mjs). Las imágenes
// salen a mano con `npm run capturas`; esto vigila, sin navegador, que el catálogo
// siga calzando con el manual y que no traiga datos de nadie.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CAPTURAS } from './capturas/catalogo.mjs';
import { AHORA, PERFILES } from './capturas/api-simulada.mjs';

const IMG = fileURLToPath(new URL('../public/manual-img', import.meta.url));
const leer = (f) => readFileSync(fileURLToPath(new URL(f, import.meta.url)), 'utf8');

test('cada captura tiene un archivo único, un perfil que existe y un texto que esperar', () => {
    const archivos = CAPTURAS.map((c) => c.archivo);
    assert.equal(new Set(archivos).size, archivos.length, 'archivos repetidos');
    for (const c of CAPTURAS) {
        assert.ok(PERFILES[c.perfil], `${c.archivo}: perfil ${c.perfil}`);
        assert.ok(c.ver?.length >= 5, `${c.archivo}: un "ver" corto deja pasar la pantalla equivocada`);
        assert.ok(c.ruta.startsWith('/'), c.archivo);
    }
});

test('una captura que no es nueva reemplaza a una imagen que el manual ya tiene', () => {
    for (const c of CAPTURAS.filter((x) => !x.nueva)) assert.ok(existsSync(`${IMG}/${c.archivo}.png`), c.archivo);
});

test('todas las imágenes de firmas salen del catálogo: ninguna queda sin poder rehacerse', () => {
    const del = new Set(CAPTURAS.map((c) => c.archivo));
    const faltan = readdirSync(`${IMG}/firmas`).filter((f) => f.endsWith('.png') && !f.endsWith('-360.png')).map((f) => `firmas/${f.replace(/\.png$/, '')}`).filter((f) => !del.has(f));
    assert.deepEqual(faltan, []);
});

test('la simulación usa datos inventados y la hora es fija', () => {
    const fuente = leer('./capturas/api-simulada.mjs') + leer('./capturas/catalogo.mjs');
    const ruts = new Set(fuente.match(/\b\d{1,2}\.\d{3}\.\d{3}-[\dkK]\b/g));
    assert.deepEqual([...ruts].sort(), ['11.111.111-1', '22.222.222-2', '33.333.333-3']);
    assert.deepEqual(fuente.match(/@[a-z0-9.-]+/gi)?.filter((d) => !/^@(example\.com|playwright)/.test(d)) ?? [], []);
    assert.ok(!/amazonaws|execute-api|buildandserve\.cl/.test(fuente), 'nada apunta a un ambiente real');
    assert.ok(Number.isFinite(AHORA.getTime()));
});

test('Preparar cuadrilla no se captura: esa pantalla se quita de la app', () => {
    assert.ok(!/preparar[\s-]+cuadrilla/i.test(leer('./capturas/catalogo.mjs')));
});
