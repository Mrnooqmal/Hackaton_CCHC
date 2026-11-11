// El PIN en las pantallas (4 dígitos, D-35) y la página de medición.
//
// Sin DOM en la suite: lo que vive en el JSX se comprueba en el texto, como en
// firmas-pantallas.test.js. La lógica (largo del PIN) se carga transpilada.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { cargarTs, FRONTEND } = require('./cargar-ts');

const leer = (...p) => fs.readFileSync(path.join(FRONTEND, 'src', ...p), 'utf8');

function archivos(dir, fuera = ['manual']) {
    const r = [];
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (fuera.includes(e.name)) continue;
        const p = path.join(dir, e.name);
        if (e.isDirectory()) r.push(...archivos(p, fuera));
        else if (/\.(tsx?|css)$/.test(e.name)) r.push(p);
    }
    return r;
}

test('el largo del PIN es 4, el mismo que exige el servidor', () => {
    const pin = cargarTs('pin.ts');
    assert.equal(pin.LARGO_PIN, 4);
    assert.equal(pin.LARGO_PIN_ANTERIOR, undefined, 'no queda la convivencia de largos');
    const validation = fs.readFileSync(path.join(__dirname, '..', 'lib', 'utils', 'validation.js'), 'utf8');
    assert.match(validation, /const LARGO_PIN = 4;/);
});

test('no queda un PIN de 6 fijo en las pantallas, ni el cambio obligatorio', () => {
    const infractores = [];
    for (const archivo of archivos(path.join(FRONTEND, 'src'))) {
        const s = fs.readFileSync(archivo, 'utf8');
        s.split('\n').forEach((linea, i) => {
            if (/PIN de 6 dígitos|pinDebeCambiar|LARGO_PIN_ANTERIOR|123456/.test(linea)) {
                infractores.push(`${path.relative(FRONTEND, archivo)}:${i + 1}  ${linea.trim().slice(0, 80)}`);
            }
        });
    }
    assert.deepEqual(infractores, []);
});

test('los componentes de PIN usan el largo común', () => {
    const casillas = leer('components', 'PinCasillas.tsx');
    assert.match(casillas, /const LARGO = LARGO_PIN;/);
    const input = leer('components', 'PinInput.tsx');
    assert.match(input, /Array\.from\(\{ length: LARGO_PIN \}/);
    assert.ok(input.includes('index === LARGO_PIN - 1'));
});

test('página de medición: la misma derivación de la firma, sin red, y no en producción', () => {
    const s = leer('pages', 'MedicionPin.tsx');
    assert.ok(s.includes("import { ITERACIONES, derivarLlave, cifradoDisponible } from '../utils/valesCifrados';"), 'mide la función real');
    assert.ok(s.includes('await derivarLlave(String(1000 + i), sal, ITERACIONES);'));
    assert.ok(s.includes('Math.round(1e4 / 256)'), 'los candidatos son los de un PIN de 4');
    assert.ok(!/from '\.\.\/api|fetch\(|apiRequest|sendBeacon|XMLHttpRequest/.test(s), 'no envía nada');
    assert.match(s, /const PRODUCCION = \['buildandserve\.cl', 'www\.buildandserve\.cl'\];/);
    assert.ok(s.indexOf('if (PRODUCCION.includes(window.location.hostname))') < s.indexOf('const medir'), 'en producción no hay botón');
    const app = leer('App.tsx');
    assert.match(app, /<Route path="\/medicion-pin" element=\{<Suspense fallback=\{null\}><MedicionPin \/><\/Suspense>\} \/>/, 'pública: el teléfono de obra no necesita cuenta');
});

test('el aviso de firmas no queda tapado por los encabezados tipo banner', () => {
    const css = leer('css', 'firmas.css');
    const regla = css.slice(css.indexOf('.main-content:has(> .sincronizador-firmas)'));
    assert.ok(regla.length > 1, 'falta la regla');
    for (const clase of ['.ui-page-header--banner', '.ob-cabecera', '.ob-skel-cabecera', '.idp']) {
        assert.ok(regla.slice(0, regla.indexOf('}')).includes(`.main-content:has(> .sincronizador-firmas) ${clase}`), clase);
    }
    assert.match(regla.slice(0, regla.indexOf('}') + 1), /margin-top: 0;/);
    // Respaldo sin :has: el aviso se pinta por encima.
    const aviso = css.slice(css.indexOf('.sincronizador-firmas {'), css.indexOf('.sincronizador-firmas >'));
    assert.match(aviso, /position: relative;/);
    assert.match(aviso, /z-index: 5;/);
    // Las clases de la regla existen de verdad (si una se renombra, esto delata la regla muerta).
    assert.ok(leer('components', 'ui', 'PageHeader.tsx').includes(".ui-page-header--banner"));
    assert.ok(leer('css', 'obra.css').includes('.ob-cabecera'));
    assert.ok(leer('css', 'components.css').includes('.idp {'));
});
