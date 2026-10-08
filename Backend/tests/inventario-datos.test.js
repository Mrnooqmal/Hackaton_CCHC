// El inventario de datos personales cubre todas las tablas, con sus claves reales.
//
// Una tabla nueva en serverless.yml sin clasificar en `lib/gobernanza/inventario.js`
// hace fallar esta prueba: no puede existir un lugar con datos de personas que el
// proceso de retención no recorra ni el registro de tratamientos declare.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { leerEsquemas } = require('./doble-dynamo-tablas');
const { FUENTES, CLASE, AL_VENCER, TABLAS_DE_GOBERNANZA } = require('../lib/gobernanza/inventario');

const esquemas = leerEsquemas();

test('toda tabla de serverless.yml está en el inventario', () => {
    const inventariadas = new Set([...FUENTES.map((f) => f.tabla), ...TABLAS_DE_GOBERNANZA]);
    const faltan = Object.keys(esquemas).filter((t) => !inventariadas.has(t));
    assert.deepEqual(faltan, [], 'tablas sin clasificar en lib/gobernanza/inventario.js');
});

test('ninguna fuente del inventario apunta a una tabla que no existe', () => {
    const sobran = [...FUENTES.map((f) => f.tabla), ...TABLAS_DE_GOBERNANZA].filter((t) => !esquemas[t]);
    assert.deepEqual(sobran, []);
});

test('la clave de cada fuente es la clave primaria real de su tabla', () => {
    for (const f of FUENTES) assert.deepEqual(f.claves, esquemas[f.tabla].clave, f.tabla);
});

test('cada fuente declara qué datos guarda, para qué, su clase y qué pasa al vencer', () => {
    const clases = new Set(Object.values(CLASE));
    const alVencer = new Set(Object.values(AL_VENCER));
    for (const f of FUENTES) {
        for (const campo of ['nombre', 'datos', 'finalidad']) assert.ok(f[campo]?.length > 3, `${f.tabla}: falta ${campo}`);
        assert.ok(clases.has(f.clase), `${f.tabla}: clase inválida`);
        assert.ok(alVencer.has(f.alVencer), `${f.tabla}: alVencer inválido`);
        if (f.alVencer === AL_VENCER.ANONIMIZAR) assert.ok(f.camposPersonales?.length, `${f.tabla}: qué campos se anonimizan`);
        assert.equal(typeof f.contieneSalud, 'boolean', `${f.tabla}: declarar si puede traer datos de salud`);
    }
});

test('las funciones de cada fuente toleran un ítem vacío o incompleto', () => {
    for (const f of FUENTES) {
        for (const it of [{}, { asignaciones: null, firmas: 'x', versiones: [{}], evidencias: [null] }]) {
            assert.ok(Array.isArray(f.personasDe(it, {})), f.tabla);
            assert.ok(Array.isArray(f.archivosDe(it)), f.tabla);
        }
    }
});
