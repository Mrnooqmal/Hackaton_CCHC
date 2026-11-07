// Verificación previa al build (scripts/verificar-recorridos.mjs): anclas,
// rutas, manual y huellas de versión. `npm test` en Frontend.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
    anclasEnCodigo, calcularHuellas, huellaDe, revisarHuellas, rutasDeApp, verificarRegistro,
} from '../scripts/verificar-recorridos.mjs';

const RAIZ = fileURLToPath(new URL('..', import.meta.url));

test('rutasDeApp lee los path de las rutas', () => {
    const app = `<Route path="/obras" element={<X/>} />\n<Route path="/obras/:obraId" element={<Y/>} />`;
    assert.deepEqual([...rutasDeApp(app)], ['/obras', '/obras/:obraId']);
});

test('anclasEnCodigo encuentra los usos y el data-tour escrito a mano, sin contar el registro', () => {
    const { usos, aMano } = anclasEnCodigo([
        { ruta: 'src/A.tsx', texto: `<nav {...ancla('global.menu-lateral')}>` },
        { ruta: 'src/B.tsx', texto: `<a {...ancla("global.menu-lateral")} /> <b data-tour="global.otro" />` },
        { ruta: 'src/ayuda/registro.ts', texto: `// <div {...ancla('global.solo-comentario')}> data-tour` },
    ]);
    assert.deepEqual([...usos.entries()], [['global.menu-lateral', ['src/A.tsx', 'src/B.tsx']]]);
    assert.deepEqual(aMano, ['src/B.tsx']);
});

const registro = (extra = {}) => ({
    pantallas: { global: { ruta: null }, obras: { ruta: '/obras', manual: 'modulos/obras' } },
    anclas: ['global.boton-ayuda'],
    rutasApp: new Set(['/obras']),
    manual: new Set(['modulos/obras']),
    usos: new Map([['global.boton-ayuda', ['src/Header.tsx']]]),
    aMano: [],
    erroresDefiniciones: [],
    ...extra,
});

test('verificarRegistro: un registro coherente no tiene errores', () => {
    assert.deepEqual(verificarRegistro(registro()), []);
});

test('verificarRegistro: un ancla registrada que nadie marca rompe el build', () => {
    const e = verificarRegistro(registro({ usos: new Map() }));
    assert.match(e.join('\n'), /ancla global\.boton-ayuda: está registrada y ningún componente la marca/);
});

test('verificarRegistro: un ancla usada que no está registrada rompe el build', () => {
    const e = verificarRegistro(registro({ usos: new Map([['global.boton-ayuda', ['a']], ['obras.vieja', ['src/Obras.tsx']]]) }));
    assert.match(e.join('\n'), /ancla\('obras\.vieja'\) en src\/Obras\.tsx: no está registrada/);
});

test('verificarRegistro: una ruta que desapareció de App.tsx o un manual que no existe rompen el build', () => {
    assert.match(verificarRegistro(registro({ rutasApp: new Set() })).join('\n'), /la ruta \/obras ya no está en App\.tsx/);
    assert.match(verificarRegistro(registro({ manual: new Set() })).join('\n'), /la página del manual "modulos\/obras" no existe/);
});

test('verificarRegistro: data-tour a mano y los errores de las definiciones también', () => {
    const e = verificarRegistro(registro({ aMano: ['src/X.tsx'], erroresDefiniciones: ['recorrido x: algo'] }));
    assert.deepEqual(e, ['recorrido x: algo', 'src/X.tsx: escribe data-tour a mano; usa ancla() de src/ayuda/registro.ts.']);
});

const def = (extra = {}) => ({ id: 'obras-intro', version: 1, titulo: { es: 'Conoce Obras' }, pasos: [{ titulo: { es: 'a' }, descripcion: { es: 'b' } }], ...extra });

test('huellaDe no depende del orden de las claves ni de la versión', () => {
    const a = def();
    const b = { pasos: a.pasos, titulo: { es: 'Conoce Obras' }, version: 7, id: 'obras-intro' };
    assert.equal(huellaDe(a), huellaDe(b));
    assert.notEqual(huellaDe(a), huellaDe(def({ titulo: { es: 'Conoce Obras.' } })));
});

test('cambiar el contenido sin subir la versión bloquea; subirla solo pide actualizar huellas (falla 26)', () => {
    const guardadas = calcularHuellas([def()]);
    assert.deepEqual(revisarHuellas([def()], guardadas), { bloqueantes: [], desactualizadas: [] });

    const cambiado = def({ titulo: { es: 'Otro título' } });
    assert.match(revisarHuellas([cambiado], guardadas).bloqueantes.join(), /cambió el contenido y no la versión/);

    const r = revisarHuellas([{ ...cambiado, version: 2 }], guardadas);
    assert.deepEqual(r.bloqueantes, []);
    assert.match(r.desactualizadas.join(), /versión 2, huellas\.json tiene la 1/);

    assert.match(revisarHuellas([def({ version: 1 })], calcularHuellas([def({ version: 3 })])).bloqueantes.join(), /la versión bajó/);
});

test('un recorrido nuevo o uno borrado piden actualizar huellas, sin bloquear', () => {
    assert.match(revisarHuellas([def()], {}).desactualizadas.join(), /nuevo, falta en huellas\.json/);
    assert.match(revisarHuellas([], calcularHuellas([def()])).desactualizadas.join(), /ya no existe/);
});

test('el script real pasa sobre el proyecto tal como está', () => {
    const r = spawnSync(process.execPath, ['scripts/verificar-recorridos.mjs'], { cwd: RAIZ, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /ancla\(s\)/);
});
