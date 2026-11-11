// La cola de firmas tomadas sin red no se pierde, y no cruza de empresa.
//
// Antes, la cola se borraba al caer la sesión (vencimiento de las 6 horas, un
// 401 o el cierre de sesión): un turno largo sin señal perdía todas las firmas
// tomadas. Y no tenía empresa: cualquier sesión que entrara en el equipo la
// mandaba con su token. Ahora:
//
//   - la cola es por empresa y sobrevive a todo;
//   - los vales sobreviven al vencimiento de la sesión y se borran solo con un
//     "Cerrar sesión" explícito;
//   - cada firma lleva su identificador (`idFirmaLocal`) para el reintento
//     idempotente del servidor (ver vale-firma.test.js).
//
// `Frontend/src/utils/colaFirmas.ts` se carga transpilado, con el TypeScript del
// frontend, y se prueba sobre un almacenamiento en memoria.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Module = require('module');

const { cargarTs, FRONTEND } = require('./cargar-ts');
const cargarCola = () => cargarTs('colaFirmas.ts');

/** Almacenamiento en memoria con la interfaz de localStorage. */
function almacen({ lleno = false } = {}) {
    const datos = new Map();
    return {
        datos,
        getItem: (k) => (datos.has(k) ? datos.get(k) : null),
        setItem: (k, v) => { if (lleno) throw new Error('QuotaExceededError'); datos.set(k, String(v)); },
        removeItem: (k) => { datos.delete(k); },
        get length() { return datos.size; },
        key: (i) => [...datos.keys()][i] ?? null,
    };
}

const firma = (tenantId, id, extra = {}) => ({
    id, tenantId, type: 'actividad', targetId: 'a-1', targetTitle: 'Charla', workerId: 'p-1', workerName: 'Rosa',
    vale: `vale-${id}`, timestamp: '2026-11-07T10:00:00.000Z', ...extra,
});
const enUnaHora = () => new Date(Date.now() + 3600e3).toISOString();

// ─── Cola ────────────────────────────────────────────────────────────────────

test('la cola es por empresa: cada sesión ve y quita solo lo de la suya', () => {
    const c = cargarCola();
    const a = almacen();
    assert.equal(c.agregarACola(firma('t-1', 'f1'), a), true);
    assert.equal(c.agregarACola(firma('t-2', 'f2'), a), true);
    assert.deepEqual(c.leerCola('t-1', a).map((f) => f.id), ['f1']);
    assert.deepEqual(c.leerCola('t-2', a).map((f) => f.id), ['f2']);
    c.quitarDeCola('t-1', 'f2', a);
    assert.equal(c.leerCola('t-2', a).length, 1, 'quitar en una empresa no toca la otra');
    assert.deepEqual(c.leerCola(null, a), [], 'sin sesión no hay cola que ver');
});

test('una firma sin empresa no se guarda, y una repetida no se duplica', () => {
    const c = cargarCola();
    const a = almacen();
    assert.equal(c.agregarACola(firma('', 'f1'), a), false);
    c.agregarACola(firma('t-1', 'f1'), a);
    c.agregarACola(firma('t-1', 'f1'), a);
    assert.equal(c.leerCola('t-1', a).length, 1);
});

test('con el almacenamiento lleno, agregar dice que no se guardó', () => {
    // Quien firma tiene que saberlo en el momento, no descubrirlo al sincronizar.
    const c = cargarCola();
    assert.equal(c.agregarACola(firma('t-1', 'f1'), almacen({ lleno: true })), false);
});

test('una firma escondida en la cola de otra empresa no se lee como propia', () => {
    const c = cargarCola();
    const a = almacen();
    a.setItem('firmasPendientes:t-1', JSON.stringify([firma('t-2', 'intrusa')]));
    assert.deepEqual(c.leerCola('t-1', a), []);
});

// ─── Vales ───────────────────────────────────────────────────────────────────

// Los vales se guardan cifrados con el PIN (ver vales-cifrados.test.js). Aquí,
// con pocas iteraciones para que la suite sea rápida.
const PIN = '4829';
const hex = (n) => n.toString(16).padStart(64, '0');
const conVales = async (c, a, tenantId, personaId, obraId, vales, { expiraEn = enUnaHora(), pin = PIN } = {}) => {
    const { cifrarVales } = cargarTs('valesCifrados.ts');
    c.guardarValesDe(tenantId, { personaId, obraId, cifrado: await cifrarVales(pin, vales, 1000), expiraEn }, a);
};

test('vales: por empresa y persona, uno por firma, y los vencidos no sirven', async () => {
    const c = cargarCola();
    const a = almacen();
    await conVales(c, a, 't-1', 'p-1', 'o-1', [hex(1), hex(2)]);
    assert.equal(c.valesDisponibles('t-1', 'p-1', a), 2);
    assert.deepEqual(await c.tomarVale('t-2', 'p-1', 'o-1', PIN, a), { motivo: 'sin_vales' }, 'los vales de una empresa no sirven en otra');
    assert.deepEqual(await c.tomarVale('t-1', 'p-1', 'o-1', PIN, a), { vale: hex(1) });
    assert.equal(c.valesDisponibles('t-1', 'p-1', a), 1);
    await conVales(c, a, 't-1', 'p-2', 'o-1', [hex(3)], { expiraEn: new Date(Date.now() - 1000).toISOString() });
    assert.deepEqual(await c.tomarVale('t-1', 'p-2', 'o-1', PIN, a), { motivo: 'sin_vales' });
});

test('vales de otra obra: no se toma ninguno y se dice por qué; lo de la empresa sí se firma', async () => {
    // El servidor rechazaría la firma al sincronizar y se perdería: se avisa al firmar.
    const c = cargarCola();
    const a = almacen();
    await conVales(c, a, 't-1', 'p-1', 'o-1', [hex(1)]);
    assert.deepEqual(await c.tomarVale('t-1', 'p-1', 'o-2', PIN, a), { motivo: 'otra_obra' });
    assert.equal(c.valesDisponibles('t-1', 'p-1', a), 1, 'no se gastó');
    assert.deepEqual(await c.tomarVale('t-1', 'p-1', null, PIN, a), { vale: hex(1) }, 'un documento de empresa, sin obra');
});

test('cerrar sesión a propósito borra los vales de todas las empresas y deja la cola', async () => {
    const c = cargarCola();
    const a = almacen();
    await conVales(c, a, 't-1', 'p-1', 'o-1', [hex(1)]);
    await conVales(c, a, 't-2', 'p-9', 'o-9', [hex(9)]);
    c.agregarACola(firma('t-1', 'f1'), a);
    assert.deepEqual(c.resumenDelEquipo(a), { vales: 2, firmas: 1 });

    c.borrarTodosLosVales(a);
    assert.deepEqual(c.resumenDelEquipo(a), { vales: 0, firmas: 1 });
    assert.equal(c.leerCola('t-1', a).length, 1);
});

test('las claves anteriores, sin empresa, se retiran al arrancar', () => {
    const c = cargarCola();
    const a = almacen();
    a.setItem('pendingOfflineSignatures', '[]');
    a.setItem('offlineVales', '[]');
    c.agregarACola(firma('t-1', 'f1'), a);
    c.retirarClavesAnteriores(a);
    assert.equal(a.getItem('pendingOfflineSignatures'), null);
    assert.equal(a.getItem('offlineVales'), null);
    assert.equal(c.leerCola('t-1', a).length, 1);
});

// ─── Quién llama ─────────────────────────────────────────────────────────────

const leerFront = (...p) => fs.readFileSync(path.join(FRONTEND, 'src', ...p), 'utf8');

test('al caer la sesión no se borra la cola, y los vales solo con un cierre explícito', () => {
    const s = leerFront('context', 'AuthContext.tsx');
    const fn = s.slice(s.indexOf('const limpiarDatosLocales'), s.indexOf('const AuthContext = createContext'));
    assert.ok(!/firmasPendientes|pendingOfflineSignatures|leerCola|quitarDeCola/.test(fn), 'la limpieza no puede tocar la cola');
    assert.match(fn, /if \(cierreExplicito\) \{\s*borrarTodosLosVales\(\);/, 'los vales se borran solo en el cierre explícito');
    const llamadas = [...s.matchAll(/limpiarDatosLocales\(\{ cierreExplicito: (true|false) \}\)/g)].map((m) => m[1]);
    assert.deepEqual(llamadas, ['false', 'false', 'true'], 'sesión caída y vencimiento conservan los vales; solo el logout los borra');
    const logout = s.slice(s.indexOf('const logout = async'), s.indexOf('const updateUser'));
    assert.ok(logout.includes('cierreExplicito: true'));
});

test('el hook guarda por empresa y manda idFirmaLocal al sincronizar', () => {
    const s = leerFront('hooks', 'useOfflineSignature.ts');
    assert.ok(!/localStorage\.(getItem|setItem|removeItem)\('(pendingOfflineSignatures|offlineVales)'/.test(s), 'sin las claves anteriores');
    assert.ok(s.includes('const pending = leerCola(tenantId);'), 'sincroniza solo la cola de la empresa de la sesión');
    assert.ok(s.includes('idFirmaLocal: sig.id,'), 'cada envío lleva el identificador de la firma');
    assert.ok(s.includes('quitarDeCola(tenantId, sig.id)'));
    assert.match(s, /if \(!agregarACola\(sig\)\) return \{ error:/, 'una firma que no se pudo guardar no se da por tomada');
});

test('la asistencia sin red no avanza si la firma no quedó guardada', () => {
    const s = leerFront('pages', 'Activities.tsx');
    const rama = s.slice(s.indexOf('if (!navigator.onLine) {\n            const resultado = await signActivity('));
    assert.ok(rama.length > 0, 'falta la rama sin red de la asistencia');
    const hastaAvanzar = rama.slice(0, rama.indexOf('advanceSigning(1, 0);'));
    assert.match(hastaAvanzar, /if \(!resultado\.success\) \{[\s\S]*?return;/);
});

// ─── Ficha de salud y obra en las pantallas ──────────────────────────────────

test('la Ficha Básica de Salud no se guarda para responder sin red, y borra una copia anterior', () => {
    const a = almacen();
    const previo = global.localStorage;
    global.localStorage = a;
    try {
        const e = cargarTs('encuestas.ts');
        a.setItem('encuesta-preguntas:salud-1', '{"viejo":true}');
        e.guardarPreguntasEnCache({ surveyId: 'salud-1', titulo: 'Ficha', esFichaSalud: true, preguntas: [{ questionId: 'q1' }] });
        assert.equal(a.getItem('encuesta-preguntas:salud-1'), null);
        e.guardarPreguntasEnCache({ surveyId: 'enc-1', titulo: 'Clima', obraId: 'o-1', preguntas: [{ questionId: 'q1' }] });
        assert.equal(JSON.parse(a.getItem('encuesta-preguntas:enc-1')).obraId, 'o-1', 'la copia lleva la obra, que ata el vale');
    } finally {
        global.localStorage = previo;
    }
});

test('las pantallas pasan la obra de lo que se firma, y la ficha de salud no se firma sin red', () => {
    const act = leerFront('pages', 'Activities.tsx');
    assert.equal((act.match(/signActivity\([\s\S]*?\.obraId \|\| null,?\s*\)/g) || []).length, 3, 'las tres firmas de asistencia pasan la obra de la actividad');
    const red = act.slice(act.indexOf('if (response.sinRed) {'));
    assert.match(red.slice(0, red.indexOf('advanceSigning(1, 0);')), /if \(!resultado\.success\) \{[\s\S]*?return;/,
        'la caída a sin red por error de red tampoco avanza sin guardar');
    const enc = leerFront('pages', 'SurveyResponder.tsx');
    assert.match(enc, /if \(encuesta\.esFichaSalud && !navigator\.onLine\) \{[\s\S]*?return;/);
    assert.ok(enc.includes('encuesta.obraId ?? null'));
    const turno = leerFront('utils', 'valesTurno.ts');
    assert.ok(turno.includes('signaturesApi.emitirVales({ personaId, obraId, pin, cantidad: 5,'), '5 vales, para la obra activa');
});
