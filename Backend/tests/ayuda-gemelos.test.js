// Los estados y límites del progreso de recorridos son los mismos en el backend
// (`lib/ayuda/progreso.js`) y en el frontend (`Frontend/src/ayuda/tipos.ts`).
//
// Si divergen, el frontend manda algo que el backend rechaza con 400 y la cola
// sin conexión lo descarta: la persona vuelve a ver un recorrido que ya cerró,
// y nadie se entera. Esta prueba corre con el backend (desplegar-backend.sh la
// ejecuta con el árbol completo). Node 24 importa el .ts del frontend sin
// compilarlo.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { pathToFileURL } = require('url');

const P = require('../lib/ayuda/progreso');

const TIPOS = pathToFileURL(path.join(__dirname, '..', '..', 'Frontend', 'src', 'ayuda', 'tipos.ts')).href;

test('los estados del progreso son los mismos y en el mismo orden', async () => {
    const F = await import(TIPOS);
    assert.deepEqual([...F.ESTADOS_PROGRESO], Object.keys(P.RANGO).sort((a, b) => P.RANGO[a] - P.RANGO[b]));
    assert.deepEqual([...F.ESTADOS_PROGRESO].sort(), Object.values(P.ESTADOS).sort());
});

test('los límites del progreso coinciden', async () => {
    const F = await import(TIPOS);
    for (const [k, v] of Object.entries(P.LIMITES)) assert.equal(F.LIMITES[k], v, `LIMITES.${k}`);
});

test('el patrón del identificador de recorrido es el mismo', async () => {
    const F = await import(TIPOS);
    assert.equal(F.ID_RECORRIDO.source, P.ID_RECORRIDO.source);
    assert.equal(F.ID_RECORRIDO.flags, P.ID_RECORRIDO.flags);
});
