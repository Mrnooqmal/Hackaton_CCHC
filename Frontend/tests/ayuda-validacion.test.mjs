// Validación de las definiciones de recorridos (src/ayuda/validacion.ts).
// Node 24 ejecuta el .ts directamente; `npm test` en Frontend.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validarRecorridos } from '../src/ayuda/validacion.ts';

const ctx = {
    pantallas: { global: { ruta: null }, 'menu-ayuda': { ruta: null }, obras: { ruta: '/obras' }, personas: { ruta: '/personas' } },
    anclas: new Set(['global.boton-ayuda', 'obras.boton-nueva', 'personas.tabla', 'menu-ayuda.manual']),
    permisos: new Set(['obras.ver', 'obras.crear', 'personas.ver']),
    manual: new Set(['modulos/obras', 'modulos/firmas']),
};

const paso = (extra = {}) => ({ ancla: 'obras.boton-nueva', titulo: { es: 'Crear obra' }, descripcion: { es: 'Desde aquí creas una obra nueva.' }, ...extra });
const base = (extra = {}) => ({
    id: 'obras-intro', tipo: 'opcional', pantalla: 'obras', visibleSi: { todos: ['obras.ver'] }, ambito: 'cualquiera',
    version: 1, reiniciarAlPublicar: false, estado: 'publicado', titulo: { es: 'Conoce Obras' }, pasos: [paso()], ...extra,
});
const errores = (defs) => validarRecorridos(defs, ctx);
const falla = (def, patron) => {
    const e = errores([def]);
    assert.ok(e.some((x) => patron.test(x)), `se esperaba ${patron}, salió: ${JSON.stringify(e)}`);
};

test('una definición correcta no tiene errores', () => {
    assert.deepEqual(errores([base()]), []);
    assert.deepEqual(errores([base({ manual: 'modulos/obras', pasos: [paso({ ancla: 'global.boton-ayuda', posicion: 'abajo', manual: 'modulos/firmas' }), paso({ ancla: undefined })] })]), []);
});

test('el id es un slug y no se repite', () => {
    for (const id of ['Obras', 'obras intro', 'obras_intro', '-obras', 'a'.repeat(65), 7]) falla(base({ id }), /el id tiene que ser/);
    const e = errores([base(), base()]);
    assert.ok(e.some((x) => /repetido/.test(x)));
});

test('tipo, estado, ámbito, versión y reiniciarAlPublicar se validan contra listas cerradas', () => {
    falla(base({ tipo: 'modal' }), /tipo inválido/);
    falla(base({ tipo: 3 }), /tipo inválido/);
    falla(base({ estado: 'activo' }), /estado inválido/);
    falla(base({ ambito: 'todas' }), /ámbito inválido/);
    for (const version of [0, 1.5, '1', 10001]) falla(base({ version }), /versión/);
    falla(base({ reiniciarAlPublicar: 'si' }), /reiniciarAlPublicar/);
});

test('la pantalla tiene que existir y tener ruta', () => {
    falla(base({ pantalla: 'obrass' }), /no está registrada/);
    falla(base({ pantalla: 'global', pasos: [paso({ ancla: 'global.boton-ayuda' })] }), /no es una pantalla con ruta/);
});

test('las anclas tienen que existir y ser de la pantalla, globales o del menú de ayuda con su acción', () => {
    falla(base({ pasos: [paso({ ancla: 'obras.no-existe' })] }), /no está registrada/);
    falla(base({ pasos: [paso({ ancla: 'personas.tabla' })] }), /es de la pantalla personas/);
    falla(base({ pasos: [paso({ ancla: 'menu-ayuda.manual' })] }), /exige la acción abrir_ayuda/);
    falla(base({ pasos: [paso({ accion: 'abrir_ayuda' })] }), /tiene que ser del menú de ayuda/);
    falla(base({ pasos: [paso({ ancla: undefined, accion: 'abrir_ayuda' })] }), /no señala nada/);
    assert.deepEqual(errores([base({ pasos: [paso({ ancla: 'menu-ayuda.manual', accion: 'abrir_ayuda' })] })]), []);
});

test('posición y acción son listas cerradas (falla 9)', () => {
    falla(base({ pasos: [paso({ posicion: 'centro' })] }), /posición inválida/);
    falla(base({ pasos: [paso({ accion: 'navegar' })] }), /acción inválida/);
});

test('claves fuera de la lista blanca se rechazan en el recorrido, el paso, visibleSi y los textos (falla 9)', () => {
    falla(base({ config: { allowClose: false } }), /claves no permitidas \(config\)/);
    falla(base({ pasos: [paso({ popover: { html: true } })] }), /claves no permitidas \(popover\)/);
    falla(base({ visibleSi: { rol: ['admin'] } }), /visibleSi con claves no permitidas/);
    falla(base({ titulo: { es: 'Hola', en: 'Hi' } }), /idiomas no soportados/);
});

test('textos: obligatorios, sin solo espacios, con largo máximo y sin HTML (fallas 8 y 32)', () => {
    falla(base({ titulo: { es: '   ' } }), /título: el texto en español está vacío/);
    falla(base({ pasos: [paso({ descripcion: { es: '' } })] }), /descripción: el texto en español está vacío/);
    falla(base({ pasos: [paso({ descripcion: undefined })] }), /descripción: falta el texto/);
    falla(base({ titulo: { es: 'x'.repeat(81) } }), /máximo es 80/);
    falla(base({ pasos: [paso({ descripcion: { es: 'x'.repeat(301) } })] }), /máximo es 300/);
    for (const t of ['<b>Hola</b>', 'Ver <script>alert(1)</script>', 'a < img src=x onerror=1>', '</p>']) falla(base({ pasos: [paso({ descripcion: { es: t } })] }), /parece traer HTML/);
    assert.deepEqual(errores([base({ pasos: [paso({ descripcion: { es: 'Si el avance es < 50 %, revisa los pendientes.' } })] })]), [], 'un "<" suelto no es HTML');
});

test('pasos: al menos uno y como máximo veinte', () => {
    falla(base({ pasos: [] }), /al menos un paso/);
    falla(base({ pasos: Array.from({ length: 21 }, () => paso()) }), /21 pasos; el máximo es 20/);
});

test('visibleSi: permisos que existen, listas no vacías y sin contradicciones', () => {
    falla(base({ visibleSi: undefined }), /falta visibleSi/);
    falla(base({ visibleSi: { alguno: [] } }), /al menos un permiso/);
    falla(base({ visibleSi: { todos: ['obras.borrar'] } }), /permiso que no existe/);
    falla(base({ visibleSi: { todos: ['obras.ver'], ninguno: ['obras.ver'] } }), /exige y excluye/);
    assert.deepEqual(errores([base({ visibleSi: {} })]), [], '{} lo ve todo el mundo');
    assert.deepEqual(errores([base({ visibleSi: { ninguno: ['obras.crear'] } })]), []);
});

test('vigencias: fechas reales, en orden, y un anuncio siempre tiene término (falla 25)', () => {
    for (const f of ['2026-13-01', '2026-02-30', '30-10-2026', '2026-1-5']) falla(base({ vigenciaDesde: f }), /vigenciaDesde tiene que ser una fecha/);
    falla(base({ vigenciaDesde: '2026-11-10', vigenciaHasta: '2026-11-01' }), /posterior/);
    assert.deepEqual(errores([base({ vigenciaDesde: '2026-11-01', vigenciaHasta: '2026-11-01' })]), [], 'un solo día vale');
    const anuncio = { tipo: 'anuncio', pasos: [paso({ ancla: undefined })] };
    falla(base(anuncio), /un anuncio necesita vigenciaHasta/);
    falla(base({ ...anuncio, vigenciaHasta: '2026-12-31', pasos: [paso()] }), /un anuncio no resalta elementos/);
    assert.deepEqual(errores([base({ ...anuncio, vigenciaHasta: '2026-12-31' })]), []);
});

test('las páginas del manual tienen que existir', () => {
    falla(base({ manual: 'modulos/no-existe' }), /página del manual "modulos\/no-existe" no existe/);
    falla(base({ pasos: [paso({ manual: 'modulos/firmas#mis-firmas' })] }), /no existe/);
});

test('validar no modifica las definiciones (falla 10)', () => {
    const def = base({ pasos: [paso({ ancla: 'global.boton-ayuda' }), paso()] });
    const antes = JSON.stringify(def);
    validarRecorridos(Object.freeze([Object.freeze(def)]), ctx);
    assert.equal(JSON.stringify(def), antes);
});
