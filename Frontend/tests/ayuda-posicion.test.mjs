// Dónde va el globo (src/ayuda/posicion.ts). La garantía: nunca tapa el
// elemento resaltado (con su halo) ni sale de la pantalla, en particular a
// 360 px de ancho. Un navegador real lo confirma en tests/e2e.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HALO, MARGEN, anchoGlobo, colocar, recolocar, seCruzan } from '../src/ayuda/posicion.ts';

const conHalo = (r) => ({ top: r.top - HALO, left: r.left - HALO, width: r.width + 2 * HALO, height: r.height + 2 * HALO });
const rectGlobo = (c, alto) => ({ top: c.top, left: c.left, width: c.width, height: alto });
const dentro = (r, v) => r.top >= 0 && r.left >= 0 && r.top + r.height <= v.height && r.left + r.width <= v.width;

test('a 360 px el globo va anclado de borde a borde, en la mitad libre, sin tapar el elemento', () => {
    const v = { width: 360, height: 640 };
    const alto = 220;
    const objetivos = [
        { top: 70, left: 300, width: 40, height: 40 },    // botón de ayuda en el header
        { top: 120, left: 16, width: 328, height: 160 }, // tarjeta arriba
        { top: 300, left: 16, width: 328, height: 60 },  // al medio
        { top: 520, left: 16, width: 200, height: 48 },  // abajo
    ];
    for (const o of objetivos) {
        const c = colocar(o, { width: anchoGlobo(v), height: alto }, v);
        const g = rectGlobo(c, alto);
        assert.equal(c.modo, 'anclado', JSON.stringify(o));
        assert.equal(c.width, 360 - 2 * MARGEN);
        assert.ok(dentro(g, v), `fuera de pantalla con ${JSON.stringify(o)}`);
        assert.ok(!seCruzan(g, conHalo(o)), `tapa el elemento ${JSON.stringify(o)}: ${JSON.stringify(c)}`);
    }
});

test('en pantalla ancha flota en la posición pedida si cabe, y si no, en la primera que quepa', () => {
    const v = { width: 1280, height: 800 };
    const g = { width: 360, height: 180 };
    const centro = { top: 300, left: 500, width: 200, height: 60 };
    assert.equal(colocar(centro, g, v, 'derecha').lado, 'derecha');
    assert.equal(colocar(centro, g, v).lado, 'abajo', 'auto prefiere abajo');
    const alFondo = { top: 700, left: 500, width: 200, height: 60 };
    assert.equal(colocar(alFondo, g, v, 'abajo').lado, 'arriba', 'abajo no cabe');
    for (const o of [centro, alFondo, { top: 10, left: 10, width: 40, height: 40 }, { top: 740, left: 1200, width: 60, height: 40 }]) {
        for (const p of ['auto', 'arriba', 'abajo', 'izquierda', 'derecha']) {
            const c = colocar(o, g, v, p);
            const r = rectGlobo(c, g.height);
            assert.ok(dentro(r, v), `${p} ${JSON.stringify(o)}`);
            assert.ok(!seCruzan(r, conHalo(o)), `${p} tapa ${JSON.stringify(o)}`);
        }
    }
});

test('si el elemento ocupa casi toda la pantalla, el globo se ancla en lugar de taparlo flotando', () => {
    const v = { width: 1024, height: 700 };
    const c = colocar({ top: 60, left: 40, width: 940, height: 330 }, { width: 360, height: 300 }, v);
    assert.equal(c.modo, 'anclado');
    assert.equal(c.borde, 'abajo');
});

test('un paso sin ancla va centrado', () => {
    const c = colocar(null, { width: 328, height: 200 }, { width: 360, height: 640 });
    assert.equal(c.modo, 'centrado');
    assert.equal(c.left, 16);
    assert.equal(c.top, 220);
});

// ─── Elementos más altos que la pantalla (revisión de Adrean, 8 de noviembre de 2026) ───
// La lista de requisitos con un grupo desplegado: el globo saltaba de abajo a
// arriba porque el borde se elegía por el centro del elemento, que queda justo en
// la mitad de la pantalla.

test('un elemento más alto que la pantalla y de todo el ancho: anclado abajo, pase lo que pase con su centro', () => {
    const v = { width: 1280, height: 720 };
    const g = { width: 360, height: 200 };
    for (let top = -1400; top <= 0; top += 7) {
        const c = colocar({ top, left: 40, width: 1200, height: 2000 }, g, v);
        assert.equal(c.modo, 'anclado', `top ${top}`);
        assert.equal(c.borde, 'abajo', `top ${top}`);
    }
    // En el teléfono, igual.
    const t = { width: 360, height: 640 };
    for (let top = -1400; top <= 0; top += 7) {
        assert.equal(colocar({ top, left: 16, width: 328, height: 2000 }, { width: anchoGlobo(t), height: 200 }, t).borde, 'abajo', `360 px, top ${top}`);
    }
});

test('un elemento más alto que la pantalla y angosto: al costado, abajo y fijo aunque la página se desplace', () => {
    const v = { width: 1280, height: 720 };
    const g = { width: 360, height: 200 };
    const posiciones = new Set();
    for (let top = -1400; top <= 0; top += 7) {
        const o = { top, left: 40, width: 600, height: 2000 };
        const c = colocar(o, g, v);
        assert.equal(c.modo, 'flotante');
        assert.equal(c.lado, 'derecha');
        assert.ok(!seCruzan(rectGlobo(c, g.height), conHalo(o)), 'no tapa el elemento');
        posiciones.add(`${c.top},${c.left}`);
    }
    assert.equal(posiciones.size, 1, `se movió: ${[...posiciones].join(' | ')}`);
});

test('recolocar mantiene el lado o el borde elegido y solo sigue al elemento', () => {
    const v = { width: 1280, height: 800 };
    const g = { width: 360, height: 180 };
    const o = { top: 300, left: 500, width: 200, height: 60 };
    const abajo = colocar(o, g, v);
    assert.equal(abajo.lado, 'abajo');
    // La página se desplazó y abajo ya no cabe: colocar elegiría arriba; recolocar no salta.
    const movido = { ...o, top: 700 };
    assert.equal(colocar(movido, g, v).lado, 'arriba');
    const r = recolocar(abajo, movido, g, v);
    assert.equal(r.modo, 'flotante');
    assert.equal(r.lado, 'abajo');
    assert.ok(r.top + g.height <= v.height - MARGEN, 'queda dentro de la pantalla');
    // Anclado arriba se queda arriba, con el alto nuevo del globo, mientras no
    // tape el elemento (si lo tapa, pasa abajo: ver la prueba del 11 de noviembre).
    const arriba = { modo: 'anclado', borde: 'arriba', top: MARGEN, left: MARGEN, width: 1248 };
    const r2 = recolocar(arriba, { top: 400, left: 0, width: 100, height: 100 }, { width: 360, height: 260 }, v);
    assert.equal(r2.borde, 'arriba');
    assert.equal(r2.top, MARGEN);
});

// ─── Prueba en terreno del 11 de noviembre de 2026 (Mis firmas, paso 2) ───
// En el teléfono el globo medía lo que pedía su texto y, anclado abajo, tapaba
// la parte de abajo del elemento. Ahora no pasa de la mitad libre.

test('a 360 px el globo anclado no pasa del espacio libre: un texto largo se desplaza dentro y no tapa el elemento', () => {
    const v = { width: 360, height: 640 };
    const casos = [
        { o: { top: 120, left: 16, width: 328, height: 200 }, borde: 'abajo' },  // tarjeta arriba, globo alto
        { o: { top: 360, left: 16, width: 328, height: 200 }, borde: 'arriba' }, // tarjeta abajo
    ];
    for (const { o, borde } of casos) {
        const g = { width: anchoGlobo(v), height: 360 };
        const c = colocar(o, g, v);
        assert.equal(c.modo, 'anclado');
        assert.equal(c.borde, borde);
        assert.ok(c.altoMax && c.altoMax < g.height, `limita el alto: ${JSON.stringify(c)}`);
        const r = rectGlobo(c, Math.min(g.height, c.altoMax));
        assert.ok(dentro(r, v), `fuera de pantalla: ${JSON.stringify(c)}`);
        assert.ok(!seCruzan(r, conHalo(o)), `tapa el elemento: ${JSON.stringify(c)}`);
        // Con su alto ya limitado (lo que mide el motor después), queda igual.
        const r2 = recolocar(c, o, { width: g.width, height: c.altoMax }, v);
        assert.deepEqual(r2, c);
    }
    // Un globo corto no se toca.
    const corto = colocar(casos[0].o, { width: anchoGlobo(v), height: 180 }, v);
    assert.equal(corto.top, 640 - MARGEN - 180);
});

test('sin espacio libre legible (elemento más alto que la mitad o que la pantalla) no se limita el alto', () => {
    const v = { width: 360, height: 640 };
    for (const o of [{ top: 60, left: 16, width: 328, height: 520 }, { top: -200, left: 16, width: 328, height: 2000 }]) {
        const c = colocar(o, { width: anchoGlobo(v), height: 220 }, v);
        assert.equal(c.modo, 'anclado');
        assert.equal(c.altoMax, undefined, JSON.stringify(o));
    }
});

test('anclado con la página todavía desplazándose: si el borde elegido termina tapando el elemento, pasa al otro', () => {
    // Lo que se vio en el teléfono: el borde se eligió con la tarjeta abajo (en
    // pleno desplazamiento) y quedó arriba tapándola cuando subió.
    const v = { width: 360, height: 640 };
    const g = { width: anchoGlobo(v), height: 336 };
    const antes = colocar({ top: 380, left: 14, width: 332, height: 242 }, g, v);
    assert.equal(antes.borde, 'arriba');
    const tarjeta = { top: 96, left: 14, width: 332, height: 242 };
    const r = recolocar(antes, tarjeta, g, v);
    assert.equal(r.borde, 'abajo');
    assert.ok(!seCruzan(rectGlobo(r, Math.min(g.height, r.altoMax ?? g.height)), conHalo(tarjeta)), JSON.stringify(r));
    // Y si el borde elegido no tapa, no se cambia aunque el centro cruce la mitad.
    const corto = { width: anchoGlobo(v), height: 150 };
    const arriba = colocar({ top: 400, left: 14, width: 332, height: 80 }, corto, v);
    assert.equal(arriba.borde, 'arriba');
    assert.equal(recolocar(arriba, { top: 300, left: 14, width: 332, height: 80 }, corto, v).borde, 'arriba');
});
