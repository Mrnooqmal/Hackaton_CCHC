// Dónde va el globo (src/ayuda/posicion.ts). La garantía: nunca tapa el
// elemento resaltado (con su halo) ni sale de la pantalla, en particular a
// 360 px de ancho. Un navegador real lo confirma en tests/e2e.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HALO, MARGEN, anchoGlobo, colocar, seCruzan } from '../src/ayuda/posicion.ts';

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
