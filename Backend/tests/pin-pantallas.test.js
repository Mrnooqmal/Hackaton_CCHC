// PIN de 6 dígitos en las pantallas, cambio obligatorio y página de medición.
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

test('el largo del PIN es 6, y el de antes, 4', () => {
    const pin = cargarTs('pin.ts');
    assert.equal(pin.LARGO_PIN, 6);
    assert.equal(pin.LARGO_PIN_ANTERIOR, 4);
});

test('no queda un PIN de 4 fijo en las pantallas', () => {
    const infractores = [];
    for (const archivo of archivos(path.join(FRONTEND, 'src'))) {
        const s = fs.readFileSync(archivo, 'utf8');
        s.split('\n').forEach((linea, i) => {
            if (/\b(pin|pinActual|pinConfirmacion|relatorPin|registroPin|cerrarInvPin|valor|completePin|pastedData)\.length\s*(!==|===|<|>=)\s*4\b/.test(linea)
                || (/PIN de 4 dígitos|\['', '', '', ''\]/.test(linea) && !/de antes|ya no sirve/.test(linea))) {
                infractores.push(`${path.relative(FRONTEND, archivo)}:${i + 1}  ${linea.trim()}`);
            }
        });
    }
    assert.deepEqual(infractores, []);
});

test('los componentes de PIN usan el largo común', () => {
    const casillas = leer('components', 'PinCasillas.tsx');
    assert.match(casillas, /largo = LARGO_PIN/);
    const input = leer('components', 'PinInput.tsx');
    assert.match(input, /Array\.from\(\{ length: LARGO_PIN \}/);
    assert.ok(input.includes('index === LARGO_PIN - 1'));
});

test('con un PIN de 4, la app lleva al cambio de PIN y no deja pasar a otra pantalla', () => {
    const ruta = leer('components', 'ProtectedRoute.tsx');
    const i = ruta.indexOf('.pinDebeCambiar)');
    assert.ok(i > 0, 'la ruta protegida mira pinDebeCambiar');
    assert.ok(i > ruta.indexOf('if (!user.habilitado)'), 'después del enrolamiento');
    assert.ok(i < ruta.indexOf('if (requiredRole'), 'antes de cualquier pantalla');
    assert.match(ruta.slice(i, i + 300), /<Navigate to="\/enroll-me" state=\{\{ changePin: true \}\} replace \/>/);
});

test('el cambio obligatorio: PIN actual de 4, nuevo de 6, sin "Cancelar", y al terminar deja de pedirlo', () => {
    const s = leer('pages', 'EnrollMe.tsx');
    assert.ok(s.includes('const isChangePin = Boolean((location.state as any)?.changePin) || pinDebeCambiar;'));
    assert.ok(s.includes('const largoActual = pinDebeCambiar ? LARGO_PIN_ANTERIOR : LARGO_PIN;'));
    assert.ok(s.includes('largo={largoActual}'), 'el PIN actual se escribe con su largo');
    assert.ok(s.includes('pinDebeCambiar: false'), 'al cambiarlo, la sesión deja de pedirlo');
    assert.match(s, /pinDebeCambiar\s*\?\s*<Volver texto="Cerrar sesión"/, 'no hay a dónde volver: solo cerrar sesión');
});

test('el aviso de vales no aparece a quien debe cambiar el PIN (el servidor no se los daría)', () => {
    const s = leer('components', 'firmas', 'AvisoValesTurno.tsx');
    assert.ok(s.includes('|| u.pinDebeCambiar) return null;'));
});

test('la ficha de la persona dice si su PIN es de 4', () => {
    const s = leer('components', 'PinDeFirma.tsx');
    assert.ok(s.includes('persona.pinConfigurado && persona.pinDebeCambiar ?'));
});

test('página de medición: la misma derivación de la firma, sin red, y no en producción', () => {
    const s = leer('pages', 'MedicionPin.tsx');
    assert.ok(s.includes("import { ITERACIONES, derivarLlave, cifradoDisponible } from '../utils/valesCifrados';"), 'mide la función real');
    assert.ok(s.includes('await derivarLlave(String(100000 + i), sal, ITERACIONES);'));
    assert.ok(!/from '\.\.\/api|fetch\(|apiRequest|sendBeacon|XMLHttpRequest/.test(s), 'no envía nada');
    assert.match(s, /const PRODUCCION = \['buildandserve\.cl', 'www\.buildandserve\.cl'\];/);
    assert.ok(s.indexOf('if (PRODUCCION.includes(window.location.hostname))') < s.indexOf('const medir'), 'en producción no hay botón');
    const app = leer('App.tsx');
    assert.match(app, /<Route path="\/medicion-pin" element=\{<Suspense fallback=\{null\}><MedicionPin \/><\/Suspense>\} \/>/, 'pública: el teléfono de obra no necesita cuenta');
});
