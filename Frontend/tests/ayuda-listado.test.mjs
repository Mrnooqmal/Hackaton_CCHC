// Listado de recorridos con filtros (scripts/listar-recorridos.mjs).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { filas, filtrar, leerArgumentos, resumenVisibilidad, rutaDeVistaPrevia } from '../scripts/listar-recorridos.mjs';

const RAIZ = fileURLToPath(new URL('..', import.meta.url));
const pantallas = { inicio: { ruta: '/' }, 'obra-detalle': { ruta: '/obras/:obraId' }, global: { ruta: null } };
const def = (extra = {}) => ({
    id: 'r', tipo: 'opcional', pantalla: 'inicio', visibleSi: {}, ambito: 'cualquiera', version: 1, reiniciarAlPublicar: false,
    estado: 'publicado', titulo: { es: 'R' }, pasos: [{}], ...extra,
});
const defs = [
    def({ id: 'a', tipo: 'obligatorio', visibleSi: { todos: ['obras.ver'] } }),
    def({ id: 'b', estado: 'borrador', visibleSi: { ninguno: ['obras.crear'] } }),
    def({ id: 'c', pantalla: 'obra-detalle', visibleSi: { alguno: ['obras.crear', 'personas.ver'] } }),
];

test('filtrar por pantalla, tipo, estado y permiso, y combinados', () => {
    const ids = (f) => filtrar(defs, f).map((d) => d.id);
    assert.deepEqual(ids({}), ['a', 'b', 'c']);
    assert.deepEqual(ids({ pantalla: 'inicio' }), ['a', 'b']);
    assert.deepEqual(ids({ tipo: 'obligatorio' }), ['a']);
    assert.deepEqual(ids({ estado: 'borrador' }), ['b']);
    assert.deepEqual(ids({ permiso: 'obras.crear' }), ['b', 'c'], 'los que nombran el permiso, en cualquier condición');
    assert.deepEqual(ids({ pantalla: 'inicio', permiso: 'obras.crear' }), ['b']);
});

test('resumen de visibilidad y ruta de vista previa', () => {
    assert.equal(resumenVisibilidad({}), 'todos');
    assert.equal(resumenVisibilidad({ todos: ['a', 'b'], ninguno: ['c'] }), 'todos: a, b · ninguno: c');
    assert.equal(rutaDeVistaPrevia(defs[0], pantallas), '/?recorrido=a&previa=1');
    assert.equal(rutaDeVistaPrevia(defs[2], pantallas), '/obras/:obraId?recorrido=c&previa=1');
    assert.equal(rutaDeVistaPrevia(def({ pantalla: 'global' }), pantallas), null);
});

test('filas: vigencia legible y cantidad de pasos', () => {
    const [f] = filas([def({ vigenciaHasta: '2026-12-31', pasos: [{}, {}] })], pantallas);
    assert.equal(f.vigencia, '… a 2026-12-31');
    assert.equal(f.pasos, 2);
    assert.equal(filas([def()], pantallas)[0].vigencia, 'siempre');
});

test('argumentos: filtros conocidos, --json, y error ante lo desconocido', () => {
    assert.deepEqual(leerArgumentos(['--pantalla', 'inicio', '--json']), { filtros: { pantalla: 'inicio' }, json: true });
    assert.throws(() => leerArgumentos(['--rol', 'admin']), /Opción desconocida/);
    assert.throws(() => leerArgumentos(['--tipo']), /Falta el valor/);
});

test('el script real corre sobre el proyecto', () => {
    const r = spawnSync(process.execPath, ['scripts/listar-recorridos.mjs'], { cwd: RAIZ, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    const j = spawnSync(process.execPath, ['scripts/listar-recorridos.mjs', '--json'], { cwd: RAIZ, encoding: 'utf8' });
    assert.ok(Array.isArray(JSON.parse(j.stdout)));
});
