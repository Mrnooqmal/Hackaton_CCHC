// Reglas puras de los recorridos (src/ayuda/reglas.ts): pantalla de una ruta,
// vigencia en hora de Chile, visibilidad por permiso y ámbito, pendientes y
// orden de la cola automática.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    colaAutomatica, deLaPantalla, entradaDeEvento, esVisible, hoyEnChile, manualDePantalla, novedades, pantallaDeRuta, pendiente, vigente,
} from '../src/ayuda/reglas.ts';

test('pantallaDeRuta: gana la ruta más específica y lo que no es pantalla da null', () => {
    assert.equal(pantallaDeRuta('/'), 'inicio');
    assert.equal(pantallaDeRuta('/personas'), 'personas');
    assert.equal(pantallaDeRuta('/personas/nueva'), 'persona-nueva', 'no la confunde con /personas/:rut');
    assert.equal(pantallaDeRuta('/personas/12345678-5'), 'persona-detalle');
    assert.equal(pantallaDeRuta('/obras/abc/'), 'obra-detalle', 'tolera la barra final');
    assert.equal(pantallaDeRuta('/prescripciones/p1/implementar'), 'prescripcion-implementar');
    assert.equal(pantallaDeRuta('/workers/1-9'), 'persona-detalle-legado');
    assert.equal(pantallaDeRuta('/manual/modulos/firmas'), null);
    assert.equal(pantallaDeRuta('/login'), null);
});

test('manualDePantalla: la página del registro, o la portada', () => {
    assert.equal(manualDePantalla('mis-firmas'), '/manual/modulos/firmas');
    assert.equal(manualDePantalla('crear'), '/manual', 'sin página propia');
    assert.equal(manualDePantalla(null), '/manual');
});

test('hoyEnChile: la fecha es la de Chile, no la de UTC (falla 27)', () => {
    // 6 de noviembre, 23:30 en Santiago (UTC-3 en horario de verano) = 7 de noviembre en UTC.
    assert.equal(hoyEnChile(new Date('2026-11-07T02:30:00Z')), '2026-11-06');
    // Invierno (UTC-4): 30 de junio, 22:00 en Santiago.
    assert.equal(hoyEnChile(new Date('2026-07-01T02:00:00Z')), '2026-06-30');
});

const def = (extra = {}) => ({
    id: 'r', tipo: 'obligatorio', pantalla: 'obras', visibleSi: {}, ambito: 'cualquiera', version: 2,
    reiniciarAlPublicar: false, estado: 'publicado', titulo: { es: 'R' }, pasos: [], ...extra,
});

test('vigente: los dos extremos cuentan', () => {
    const d = def({ vigenciaDesde: '2026-11-01', vigenciaHasta: '2026-11-30' });
    assert.equal(vigente(d, '2026-10-31'), false);
    assert.equal(vigente(d, '2026-11-01'), true);
    assert.equal(vigente(d, '2026-11-30'), true);
    assert.equal(vigente(d, '2026-12-01'), false);
    assert.equal(vigente(def(), '1999-01-01'), true, 'sin fechas, siempre');
});

const persona = (permisos, ambito = 'obra') => ({ tienePermiso: (p) => permisos.includes(p), ambito });

test('esVisible: por permiso (todos, alguno, ninguno) y por ámbito, no por rol', () => {
    assert.equal(esVisible(def({ visibleSi: { todos: ['obras.ver', 'obras.crear'] } }), persona(['obras.ver'])), false);
    assert.equal(esVisible(def({ visibleSi: { todos: ['obras.ver', 'obras.crear'] } }), persona(['obras.ver', 'obras.crear'])), true);
    assert.equal(esVisible(def({ visibleSi: { alguno: ['obras.crear', 'personas.ver'] } }), persona(['personas.ver'])), true);
    assert.equal(esVisible(def({ visibleSi: { alguno: ['obras.crear'] } }), persona([])), false);
    // Recorrido de terreno: lo ve quien NO gestiona obras; un trabajador sí, un prevencionista no.
    const terreno = def({ visibleSi: { ninguno: ['obras.crear'] } });
    assert.equal(esVisible(terreno, persona(['actividades.ver'])), true);
    assert.equal(esVisible(terreno, persona(['obras.crear', 'actividades.ver'])), false);
    assert.equal(esVisible(def({ ambito: 'empresa' }), persona([], 'obra')), false);
    assert.equal(esVisible(def({ ambito: 'empresa' }), persona([], 'empresa')), true);
    assert.equal(esVisible(def({ ambito: 'obra' }), persona([], null)), false, 'sin ámbito elegido no aplica');
});

test('pendiente: sin progreso sí; cerrar lo deja pendiente; completar u omitir lo sacan (falla 3)', () => {
    const d = def();
    assert.equal(pendiente(d, undefined), true);
    assert.equal(pendiente(d, { version: 2, estado: 'en_progreso', ultimoPaso: 0, cierres: 1 }), true);
    assert.equal(pendiente(d, { version: 2, estado: 'omitido', ultimoPaso: 0, cierres: 3 }), false);
    assert.equal(pendiente(d, { version: 2, estado: 'completado', ultimoPaso: 4, cierres: 0 }), false);
});

test('pendiente: una versión nueva vuelve a mostrarse solo con reiniciarAlPublicar', () => {
    const visto = { version: 1, estado: 'completado', ultimoPaso: 3, cierres: 0 };
    assert.equal(pendiente(def({ reiniciarAlPublicar: true }), visto), true);
    assert.equal(pendiente(def({ reiniciarAlPublicar: false }), visto), false);
    assert.equal(pendiente(def(), { ...visto, version: 3 }), false, 'progreso de una versión más nueva (bundle viejo)');
});

test('colaAutomatica: anuncios primero, después obligatorios, nunca opcionales; solo publicados, vigentes, visibles y de esta pantalla', () => {
    const defs = [
        def({ id: 'obl-1' }),
        def({ id: 'opc', tipo: 'opcional' }),
        def({ id: 'anuncio', tipo: 'anuncio', vigenciaHasta: '2026-12-31' }),
        def({ id: 'obl-2' }),
        def({ id: 'borrador', estado: 'borrador' }),
        def({ id: 'inactivo', estado: 'inactivo' }),
        def({ id: 'vencido', vigenciaHasta: '2026-10-01' }),
        def({ id: 'otra-pantalla', pantalla: 'personas' }),
        def({ id: 'sin-permiso', visibleSi: { todos: ['obras.crear'] } }),
        def({ id: 'completado' }),
    ];
    const progreso = new Map([['completado', { version: 2, estado: 'completado', ultimoPaso: 0, cierres: 0 }]]);
    const cola = colaAutomatica(defs, 'obras', progreso, persona(['obras.ver']), '2026-11-06');
    assert.deepEqual(cola.map((d) => d.id), ['anuncio', 'obl-1', 'obl-2']);
    assert.deepEqual(colaAutomatica(defs, null, progreso, persona([]), '2026-11-06'), []);
    assert.equal(Object.isFrozen(defs) || defs.length === 10, true, 'no ordena el arreglo original (falla 10)');
    assert.equal(defs[0].id, 'obl-1');
});

test('deLaPantalla y novedades: lo que muestra el menú de ayuda', () => {
    const defs = [def({ id: 'obl' }), def({ id: 'opc', tipo: 'opcional' }), def({ id: 'nov', tipo: 'anuncio', pantalla: 'inicio' }), def({ id: 'borr', tipo: 'opcional', estado: 'borrador' })];
    assert.deepEqual(deLaPantalla(defs, 'obras', persona([]), '2026-11-06').map((d) => d.id), ['obl', 'opc'], 'completados incluidos: se pueden volver a ver');
    assert.deepEqual(novedades(defs, persona([]), '2026-11-06').map((d) => d.id), ['nov'], 'de cualquier pantalla');
});

test('entradaDeEvento: en un recorrido, cerrar suma un cierre y lo deja en curso; omitir y completar, su estado', () => {
    const d = def();
    assert.deepEqual(entradaDeEvento(d, undefined, { tipo: 'cerrar', ultimoPaso: 1 }), { version: 2, estado: 'en_progreso', ultimoPaso: 1, cierres: 1 });
    assert.deepEqual(entradaDeEvento(d, { version: 2, estado: 'en_progreso', ultimoPaso: 3, cierres: 2 }, { tipo: 'cerrar', ultimoPaso: 0 }),
        { version: 2, estado: 'en_progreso', ultimoPaso: 3, cierres: 3 });
    assert.deepEqual(entradaDeEvento(d, undefined, { tipo: 'omitir', ultimoPaso: 0 }), { version: 2, estado: 'omitido', ultimoPaso: 0, cierres: 0 });
    assert.deepEqual(entradaDeEvento(d, undefined, { tipo: 'completar', ultimoPaso: 4 }), { version: 2, estado: 'completado', ultimoPaso: 4, cierres: 0 });
    assert.deepEqual(entradaDeEvento(d, { version: 1, estado: 'en_progreso', ultimoPaso: 5, cierres: 2 }, { tipo: 'cerrar', ultimoPaso: 0 }),
        { version: 2, estado: 'en_progreso', ultimoPaso: 0, cierres: 1 }, 'lo de una versión anterior no cuenta');
});

test('entradaDeEvento: cerrar un anuncio lo marca como visto, sin sumar cierres', () => {
    const anuncio = def({ tipo: 'anuncio', vigenciaHasta: '2026-12-31' });
    assert.deepEqual(entradaDeEvento(anuncio, undefined, { tipo: 'cerrar', ultimoPaso: 0 }), { version: 2, estado: 'completado', ultimoPaso: 0, cierres: 0 });
    assert.equal(pendiente(anuncio, entradaDeEvento(anuncio, undefined, { tipo: 'cerrar', ultimoPaso: 0 })), false);
});
