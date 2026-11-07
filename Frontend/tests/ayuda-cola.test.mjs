// Cola sin conexión del progreso (src/ayuda/cola.ts): fusiona sin retroceder,
// reintenta lo transitorio, descarta lo que no se va a aceptar y nunca manda
// el progreso de otra persona con la sesión actual.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CLAVE_COLA, clasificar, encolar, identidad, pendientesDe, vaciar } from '../src/ayuda/cola.ts';

const almacen = () => {
    const m = new Map();
    return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v), m };
};
const ANA = identidad('t1', 'ana');
const BETO = identidad('t1', 'beto');
const e = (extra = {}) => ({ version: 1, estado: 'en_progreso', ultimoPaso: 0, cierres: 0, ...extra });

test('clasificar: 2xx listo; 401, 408, 429, 5xx, sin red y conflicto concurrente se reintentan; el resto de 4xx se descarta', () => {
    assert.equal(clasificar(200), 'ok');
    for (const s of [null, 401, 408, 429, 500, 502, 503]) assert.equal(clasificar(s), 'reintentar', String(s));
    assert.equal(clasificar(409, 'CAMBIO_CONCURRENTE'), 'reintentar');
    for (const [s, c] of [[400], [403], [404], [409, 'TRATAMIENTO_BLOQUEADO'], [409, 'LIMITE_RECORRIDOS']]) assert.equal(clasificar(s, c), 'descartar', `${s} ${c}`);
});

test('encolar fusiona: un evento viejo no hace retroceder un completado pendiente', () => {
    const a = almacen();
    encolar(a, ANA, 'intro', e({ estado: 'completado', ultimoPaso: 3 }));
    encolar(a, ANA, 'intro', e({ cierres: 1 }));
    assert.deepEqual(pendientesDe(a, ANA).intro, { version: 1, estado: 'completado', ultimoPaso: 3, cierres: 1 });
});

test('encolar guarda solo versión, estado, último paso y cierres', () => {
    const a = almacen();
    encolar(a, ANA, 'intro', e({ titulo: 'no va', personaId: 'no va' }));
    assert.deepEqual(Object.keys(pendientesDe(a, ANA).intro).sort(), ['cierres', 'estado', 'ultimoPaso', 'version']);
});

test('vaciar: lo aceptado y lo descartado salen; lo transitorio y sin red se quedan', async () => {
    const a = almacen();
    encolar(a, ANA, 'ok', e());
    encolar(a, ANA, 'malo', e());
    encolar(a, ANA, 'caido', e());
    encolar(a, ANA, 'sin-red', e());
    const respuestas = { ok: { estado: 200 }, malo: { estado: 400, codigo: 'ENTRADA_INVALIDA' }, caido: { estado: 503 } };
    const r = await vaciar(a, ANA, async (id) => {
        if (id === 'sin-red') throw new TypeError('Failed to fetch');
        return respuestas[id];
    });
    assert.deepEqual(r, { enviados: 1, descartados: 1, quedan: 2 });
    assert.deepEqual(Object.keys(pendientesDe(a, ANA)).sort(), ['caido', 'sin-red']);
});

test('vaciar no manda el progreso de otra persona con la sesión actual, y lo descarta', async () => {
    const a = almacen();
    encolar(a, BETO, 'intro', e({ estado: 'completado' }));
    encolar(a, ANA, 'intro', e());
    const enviados = [];
    await vaciar(a, ANA, async (id, entrada) => { enviados.push([id, entrada.estado]); return { estado: 200 }; });
    assert.deepEqual(enviados, [['intro', 'en_progreso']], 'solo lo de Ana');
    assert.deepEqual(pendientesDe(a, BETO), {}, 'lo de Beto ya no está en el equipo');
});

test('vaciar respeta lo que se encola mientras está enviando', async () => {
    const a = almacen();
    encolar(a, ANA, 'intro', e({ ultimoPaso: 1 }));
    await vaciar(a, ANA, async () => {
        encolar(a, ANA, 'intro', e({ estado: 'completado', ultimoPaso: 2 }));
        encolar(a, ANA, 'otro', e());
        return { estado: 200 };
    });
    assert.deepEqual(pendientesDe(a, ANA).intro, { version: 1, estado: 'completado', ultimoPaso: 2, cierres: 0 }, 'el completado nuevo no se pierde');
    assert.ok(pendientesDe(a, ANA).otro);
});

test('un almacenamiento roto o bloqueado no rompe nada', async () => {
    const roto = { getItem: () => { throw new Error('SecurityError'); }, setItem: () => { throw new Error('QuotaExceeded'); } };
    assert.doesNotThrow(() => encolar(roto, ANA, 'intro', e()));
    assert.deepEqual(pendientesDe(roto, ANA), {});
    assert.deepEqual(await vaciar(roto, ANA, async () => ({ estado: 200 })), { enviados: 0, descartados: 0, quedan: 0 });
    const basura = almacen();
    basura.setItem(CLAVE_COLA, '{no es json');
    assert.deepEqual(pendientesDe(basura, ANA), {});
});

test('vaciar sin nada pendiente no escribe en el equipo', async () => {
    const a = almacen();
    await vaciar(a, ANA, async () => ({ estado: 200 }));
    assert.equal(a.m.has(CLAVE_COLA), false);
});
