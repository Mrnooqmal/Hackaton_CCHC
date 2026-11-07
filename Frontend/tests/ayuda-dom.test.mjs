// Encontrar y esperar anclas (src/ayuda/dom.ts) sobre happy-dom. happy-dom no
// calcula diseño, así que el tamaño de cada elemento lo da `data-alto` (o un
// tamaño por omisión): lo que se prueba es la espera y la visibilidad por
// estilo, no la geometría, que va en tests/e2e con un navegador real.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { buscarAncla, esperarAncla, selectorDe, visible } from '../src/ayuda/dom.ts';
import { bloquear, bloqueado, suscribir } from '../src/ayuda/bloqueo.ts';

let ventana;
let doc;
beforeEach(() => {
    ventana = new Window({ width: 360, height: 640 });
    doc = ventana.document;
    ventana.HTMLElement.prototype.getBoundingClientRect = function () {
        const alto = this.dataset.alto === undefined ? 20 : Number(this.dataset.alto);
        const izquierda = this.dataset.izquierda === undefined ? 10 : Number(this.dataset.izquierda);
        return { top: 10, left: izquierda, width: alto === 0 ? 0 : 100, height: alto, right: izquierda + (alto === 0 ? 0 : 100), bottom: 10 + alto, x: izquierda, y: 10 };
    };
});

const poner = (html) => { doc.body.innerHTML = html; };

test('selectorDe arma un selector de atributo exacto', () => {
    assert.equal(selectorDe('global.boton-ayuda', doc), '[data-tour="global\\.boton-ayuda"]');
});

test('buscarAncla: devuelve la primera visible y salta las ocultas', () => {
    poner(`
        <div data-tour="global.menu-lateral" style="display:none" id="a"></div>
        <div style="display:none"><div data-tour="global.menu-lateral" id="b"></div></div>
        <div data-tour="global.menu-lateral" style="visibility:hidden" id="c"></div>
        <div data-tour="global.menu-lateral" data-alto="0" id="d"></div>
        <div data-tour="global.menu-lateral" data-izquierda="-200" id="e"></div>
        <div data-tour="global.menu-lateral" id="f"></div>`);
    assert.equal(buscarAncla('global.menu-lateral', doc)?.id, 'f');
    for (const id of ['a', 'b', 'c', 'd', 'e']) assert.equal(visible(doc.getElementById(id)), false, id);
});

test('esperarAncla: si ya está, resuelve de inmediato', async () => {
    poner('<button data-tour="global.boton-ayuda" id="x"></button>');
    assert.equal((await esperarAncla('global.boton-ayuda', doc, { espera: 50 }))?.id, 'x');
});

test('esperarAncla: espera a que se renderice (falla 2)', async () => {
    poner('<main></main>');
    ventana.setTimeout(() => { doc.querySelector('main').innerHTML = '<nav data-tour="global.menu-lateral" id="tarde"></nav>'; }, 60);
    const t0 = Date.now();
    const el = await esperarAncla('global.menu-lateral', doc, { espera: 2000 });
    assert.equal(el?.id, 'tarde');
    assert.ok(Date.now() - t0 < 1500, 'no esperó el plazo completo');
});

test('esperarAncla: espera también a que un elemento oculto se muestre', async () => {
    poner('<nav data-tour="global.menu-lateral" id="n" style="display:none"></nav>');
    ventana.setTimeout(() => { doc.getElementById('n').setAttribute('style', ''); }, 40);
    assert.equal((await esperarAncla('global.menu-lateral', doc, { espera: 2000 }))?.id, 'n');
});

test('esperarAncla: si no aparece en el plazo, null', async () => {
    poner('<main></main>');
    assert.equal(await esperarAncla('global.menu-lateral', doc, { espera: 80 }), null);
});

test('esperarAncla: cancelar resuelve null y deja de observar', async () => {
    poner('<main></main>');
    const control = new AbortController();
    const p = esperarAncla('global.menu-lateral', doc, { espera: 5000, senal: control.signal });
    control.abort();
    assert.equal(await p, null);
    doc.querySelector('main').innerHTML = '<nav data-tour="global.menu-lateral"></nav>';
});

test('bloqueo: cuenta bloqueos superpuestos, liberar es idempotente y avisa a los suscriptores', () => {
    let avisos = 0;
    const desuscribir = suscribir(() => { avisos += 1; });
    const a = bloquear();
    const b = bloquear();
    assert.equal(bloqueado(), true);
    a();
    a();
    assert.equal(bloqueado(), true, 'queda el otro');
    b();
    assert.equal(bloqueado(), false);
    assert.equal(avisos, 4);
    desuscribir();
    bloquear()();
    assert.equal(avisos, 4);
});
