// Vales de firma cifrados con el PIN en el equipo (Frontend/src/utils/valesCifrados.ts
// y colaFirmas.ts), con el WebCrypto real de Node.
//
// Lo que se fija:
//   - sin red, firmar exige el PIN: con el bueno se descifra el vale; con otro no
//     hay firma, y al quinto seguido se borran los vales de esa persona;
//   - el equipo NO es un oráculo del PIN: AES-CTR sin etiqueta y un solo byte de
//     comprobación; un descifrado con llave equivocada no falla, da otros bytes;
//   - en el almacenamiento no queda el vale, ni el PIN, ni más de un byte que
//     dependa del PIN;
//   - sal nueva por emisión, contador distinto por vale, iteraciones guardadas;
//   - los vales en claro de antes se descartan.
//
// Pocas iteraciones en las pruebas, para que la suite sea rápida; el valor real
// se comprueba aparte.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { cargarTs, FRONTEND } = require('./cargar-ts');

const ITER = 1000;
const PIN = '482915';
const hex = (n) => n.toString(16).padStart(64, '0');
const enUnaHora = () => new Date(Date.now() + 3600e3).toISOString();

function almacen() {
    const datos = new Map();
    return {
        datos,
        getItem: (k) => (datos.has(k) ? datos.get(k) : null),
        setItem: (k, v) => { datos.set(k, String(v)); },
        removeItem: (k) => { datos.delete(k); },
        get length() { return datos.size; },
        key: (i) => [...datos.keys()][i] ?? null,
    };
}

const modulos = () => ({ c: cargarTs('colaFirmas.ts'), v: cargarTs('valesCifrados.ts') });

async function habilitar(c, v, a, { tenantId = 't-1', personaId = 'p-1', obraId = 'o-1', vales = [hex(1), hex(2), hex(3)], pin = PIN } = {}) {
    const cifrado = await v.cifrarVales(pin, vales, ITER);
    c.guardarValesDe(tenantId, { personaId, obraId, cifrado, expiraEn: enUnaHora(), intentosFallidos: 0 }, a);
    return cifrado;
}

/** Un PIN distinto cuyo byte de comprobación NO coincide (255 de cada 256). */
async function pinQueNoPasa(v, cifrado) {
    for (let i = 0; i < 1000; i += 1) {
        const p = String(100000 + i);
        if (p !== PIN && (await v.abrirLlave(p, cifrado)) === null) return p;
    }
    throw new Error('no se encontró');
}

/** Un PIN distinto que SÍ pasa la comprobación: el 1 de cada 256 aceptado. */
async function pinQuePasa(v, cifrado) {
    for (let i = 0; i < 20000; i += 1) {
        const p = String(200000 + i);
        if (p !== PIN && (await v.abrirLlave(p, cifrado)) !== null) return p;
    }
    throw new Error('no se encontró');
}

// ─── Firmar exige el PIN ─────────────────────────────────────────────────────

test('con el PIN bueno se entregan los vales en orden, uno por firma', async () => {
    const { c, v } = modulos();
    const a = almacen();
    await habilitar(c, v, a);
    assert.deepEqual(await c.tomarVale('t-1', 'p-1', 'o-1', PIN, a), { vale: hex(1) });
    assert.deepEqual(await c.tomarVale('t-1', 'p-1', 'o-1', PIN, a), { vale: hex(2) });
    assert.equal(c.valesDisponibles('t-1', 'p-1', a), 1);
});

test('con otro PIN no hay firma; al quinto seguido se borran los vales de esa persona y solo los suyos', async () => {
    const { c, v } = modulos();
    const a = almacen();
    const cifrado = await habilitar(c, v, a);
    await habilitar(c, v, a, { personaId: 'p-2' });
    await habilitar(c, v, a, { tenantId: 't-2', personaId: 'p-1' });
    const malo = await pinQueNoPasa(v, cifrado);

    for (let quedan = 4; quedan >= 1; quedan -= 1) {
        assert.deepEqual(await c.tomarVale('t-1', 'p-1', 'o-1', malo, a), { motivo: 'pin_incorrecto', quedan });
        assert.equal(c.valesDisponibles('t-1', 'p-1', a), 3, 'un PIN equivocado no gasta vales');
    }
    assert.deepEqual(await c.tomarVale('t-1', 'p-1', 'o-1', malo, a), { motivo: 'bloqueado' });
    assert.equal(c.valesDisponibles('t-1', 'p-1', a), 0);
    assert.deepEqual(await c.tomarVale('t-1', 'p-1', 'o-1', PIN, a), { motivo: 'sin_vales' }, 'ni con el PIN bueno: hay que habilitarla de nuevo');
    assert.equal(c.valesDisponibles('t-1', 'p-2', a), 3, 'otra persona, intacta');
    assert.equal(c.valesDisponibles('t-2', 'p-1', a), 3, 'otra empresa, intacta');
    assert.equal(c.MAX_INTENTOS_EQUIPO, 5);
});

test('acertar vuelve el contador a cero; habilitar de nuevo también', async () => {
    const { c, v } = modulos();
    const a = almacen();
    const cifrado = await habilitar(c, v, a, { vales: [hex(1), hex(2), hex(3), hex(4), hex(5), hex(6)] });
    const malo = await pinQueNoPasa(v, cifrado);
    for (let i = 0; i < 4; i += 1) await c.tomarVale('t-1', 'p-1', 'o-1', malo, a);
    assert.ok('vale' in await c.tomarVale('t-1', 'p-1', 'o-1', PIN, a));
    assert.deepEqual(await c.tomarVale('t-1', 'p-1', 'o-1', malo, a), { motivo: 'pin_incorrecto', quedan: 4 });

    await habilitar(c, v, a);
    const k = JSON.parse(a.getItem('valesFirma:t-1')).find((x) => x.personaId === 'p-1');
    assert.equal(k.intentosFallidos, 0);
});

test('dos firmas a la vez con el PIN bueno no toman el mismo vale', async () => {
    const { c, v } = modulos();
    const a = almacen();
    await habilitar(c, v, a);
    const [x, y] = await Promise.all([
        c.tomarVale('t-1', 'p-1', 'o-1', PIN, a),
        c.tomarVale('t-1', 'p-1', 'o-1', PIN, a),
    ]);
    assert.notEqual(x.vale, y.vale);
    assert.equal(c.valesDisponibles('t-1', 'p-1', a), 1);
});

test('el 1 de 256: un PIN equivocado que pasa la comprobación entrega bytes que no son el vale', async () => {
    const { c, v } = modulos();
    const a = almacen();
    const cifrado = await habilitar(c, v, a);
    const colado = await pinQuePasa(v, cifrado);
    const r = await c.tomarVale('t-1', 'p-1', 'o-1', colado, a);
    assert.ok('vale' in r);
    assert.match(r.vale, /^[0-9a-f]{64}$/, 'tiene la forma de un vale');
    assert.notEqual(r.vale, hex(1), 'pero no es el vale: el servidor lo rechazará y se avisará con nombre');
});

// ─── El equipo no es un oráculo del PIN ──────────────────────────────────────

test('descifrar con una llave equivocada no falla: da otros 32 bytes', async () => {
    const { v } = modulos();
    const cifrado = await v.cifrarVales(PIN, [hex(7)], ITER);
    const sal = Uint8Array.from(Buffer.from(cifrado.sal, 'base64'));
    const otra = await v.derivarLlave('000000', sal, ITER);
    const r = await v.descifrarVale(otra, cifrado.vales[0]);
    assert.match(r, /^[0-9a-f]{64}$/);
    assert.notEqual(r, hex(7));
});

test('lo guardado: ni el vale, ni el PIN, y un solo byte que dependa del PIN', async () => {
    const { c, v } = modulos();
    const a = almacen();
    const vale = 'ab'.repeat(32);
    await habilitar(c, v, a, { vales: [vale] });
    const crudo = a.getItem('valesFirma:t-1');
    assert.ok(!crudo.includes(vale), 'el vale no está en hex');
    assert.ok(!crudo.includes(Buffer.from(vale, 'hex').toString('base64')), 'ni en base64');
    assert.ok(!crudo.includes(PIN), 'ni el PIN');
    const [entrada] = JSON.parse(crudo);
    assert.deepEqual(Object.keys(entrada.cifrado).sort(), ['comprobacion', 'iteraciones', 'sal', 'v', 'vales']);
    assert.ok(Number.isInteger(entrada.cifrado.comprobacion) && entrada.cifrado.comprobacion >= 0 && entrada.cifrado.comprobacion <= 255, 'la comprobación es UN byte');
    assert.deepEqual(Object.keys(entrada.cifrado.vales[0]).sort(), ['c', 'iv'], 'sin etiqueta de autenticación');
    assert.equal(Buffer.from(entrada.cifrado.vales[0].c, 'base64').length, 32, 'los 32 bytes crudos, no el texto hex');
});

test('sal nueva en cada emisión, contador distinto en cada vale, iteraciones guardadas y usadas', async () => {
    const { v } = modulos();
    const x = await v.cifrarVales(PIN, [hex(1), hex(2), hex(3)], ITER);
    const y = await v.cifrarVales(PIN, [hex(1)], ITER);
    assert.notEqual(x.sal, y.sal);
    assert.equal(Buffer.from(x.sal, 'base64').length, 16);
    assert.equal(new Set(x.vales.map((e) => e.iv)).size, 3);
    assert.equal(x.iteraciones, ITER);
    const llave = await v.abrirLlave(PIN, x);
    assert.ok(llave);
    assert.equal(await v.descifrarVale(llave, x.vales[1]), hex(2));
    // Si se usaran otras iteraciones que las guardadas, el PIN bueno no abriría.
    const alterado = { ...x, iteraciones: ITER + 1 };
    const conOtras = await v.abrirLlave(PIN, alterado);
    if (conOtras) assert.notEqual(await v.descifrarVale(conOtras, x.vales[1]), hex(2));
});

test('las iteraciones de verdad: 600.000, fijadas con la medición del 8 de noviembre de 2026 (D-35)', () => {
    const { v } = modulos();
    assert.equal(v.ITERACIONES, 600000, 'si cambian, se registra en D-35 con su medición');
});

// ─── Lo de antes y los avisos ────────────────────────────────────────────────

test('los vales en claro de antes no se usan y se retiran al arrancar', async () => {
    const { c, v } = modulos();
    const a = almacen();
    a.setItem('valesFirma:t-1', JSON.stringify([{ personaId: 'p-viejo', obraId: 'o-1', vales: [hex(5)], expiraEn: enUnaHora() }]));
    assert.equal(c.valesDisponibles('t-1', 'p-viejo', a), 0, 'no se leen');
    assert.deepEqual(await c.tomarVale('t-1', 'p-viejo', 'o-1', PIN, a), { motivo: 'sin_vales' });
    await habilitar(c, v, a);
    a.setItem('valesFirma:t-1', JSON.stringify([...JSON.parse(a.getItem('valesFirma:t-1')),
        { personaId: 'p-viejo', obraId: 'o-1', vales: [hex(5)], expiraEn: enUnaHora() }]));
    c.retirarClavesAnteriores(a);
    const quedan = JSON.parse(a.getItem('valesFirma:t-1'));
    assert.deepEqual(quedan.map((x) => x.personaId), ['p-1']);
    assert.ok(!a.getItem('valesFirma:t-1').includes(hex(5)));
});

test('firmas rechazadas al sincronizar: por empresa, con nombre, hasta que alguien las vea', () => {
    const { c } = modulos();
    const a = almacen();
    c.anotarRechazada('t-1', { id: 'f1', workerName: 'Rosa Díaz', targetTitle: 'Charla', motivo: 'El vale de firma no es válido.', en: 'x' }, a);
    c.anotarRechazada('t-1', { id: 'f1', workerName: 'Rosa Díaz', targetTitle: 'Charla', motivo: 'repetida', en: 'x' }, a);
    assert.equal(c.leerRechazadas('t-1', a).length, 1, 'una por firma');
    assert.deepEqual(c.leerRechazadas('t-2', a), []);
    c.borrarTodosLosVales(a);
    assert.equal(c.leerRechazadas('t-1', a).length, 1, 'cerrar sesión no las borra');
    c.olvidarRechazadas('t-1', a);
    assert.deepEqual(c.leerRechazadas('t-1', a), []);
});

// ─── Quién llama ─────────────────────────────────────────────────────────────

const leerFront = (...p) => fs.readFileSync(path.join(FRONTEND, 'src', ...p), 'utf8');

test('la renovación comprueba WebCrypto antes de pedir vales, y cifra con el PIN aceptado', () => {
    const s = leerFront('utils', 'valesTurno.ts');
    assert.ok(s.indexOf('!cifradoDisponible()') < s.indexOf('signaturesApi.emitirVales('), 'sin WebCrypto ni siquiera se piden');
    assert.ok(s.includes('await cifrarVales(pin, res.data.vales)'));
    assert.ok(!/vales: res\.data\.vales/.test(s), 'nunca se guardan en claro');
    const h = leerFront('hooks', 'useOfflineSignature.ts');
    assert.ok(h.includes('await tomarVale(tenantId, workerId, obraId, pin)'));
    assert.equal((h.match(/guardarParaDespues\('(documento|actividad|encuesta)',[^)]*\bpin\b/g) || []).length, 9, 'las nueve rutas sin red pasan el PIN');
});

test('sin WebCrypto no hay cifrado disponible', () => {
    const { v } = modulos();
    const d = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
    Object.defineProperty(globalThis, 'crypto', { value: {}, configurable: true, writable: true });
    try {
        assert.equal(v.cifradoDisponible(), false);
    } finally {
        Object.defineProperty(globalThis, 'crypto', d);
    }
    assert.equal(v.cifradoDisponible(), true);
});
