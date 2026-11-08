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

const FRONTEND = path.join(__dirname, '..', '..', 'Frontend');
let ts;
try { ts = require(path.join(FRONTEND, 'node_modules', 'typescript')); } catch { ts = null; }

function cargarCola() {
    assert.ok(ts, 'Falta Frontend/node_modules/typescript: corre `npm ci` en Frontend. Esta prueba no se salta.');
    const archivo = path.join(FRONTEND, 'src', 'utils', 'colaFirmas.ts');
    const { outputText } = ts.transpileModule(fs.readFileSync(archivo, 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    });
    const m = new Module(archivo);
    m._compile(outputText, archivo);
    return m.exports;
}

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

test('vales: por empresa y persona, uno por firma, y los vencidos no sirven', () => {
    const c = cargarCola();
    const a = almacen();
    c.guardarValesDe('t-1', { personaId: 'p-1', vales: ['v1', 'v2'], expiraEn: enUnaHora() }, a);
    assert.equal(c.valesDisponibles('t-1', 'p-1', a), 2);
    assert.equal(c.tomarVale('t-2', 'p-1', a), null, 'los vales de una empresa no sirven en otra');
    assert.equal(c.tomarVale('t-1', 'p-1', a), 'v1');
    assert.equal(c.valesDisponibles('t-1', 'p-1', a), 1);
    c.guardarValesDe('t-1', { personaId: 'p-2', vales: ['v3'], expiraEn: new Date(Date.now() - 1000).toISOString() }, a);
    assert.equal(c.tomarVale('t-1', 'p-2', a), null);
});

test('cerrar sesión a propósito borra los vales de todas las empresas y deja la cola', () => {
    const c = cargarCola();
    const a = almacen();
    c.guardarValesDe('t-1', { personaId: 'p-1', vales: ['v1'], expiraEn: enUnaHora() }, a);
    c.guardarValesDe('t-2', { personaId: 'p-9', vales: ['v9'], expiraEn: enUnaHora() }, a);
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
    assert.ok(s.includes('if (!agregarACola(sig)) return null;'), 'una firma que no se pudo guardar no se da por tomada');
});

test('la asistencia sin red no avanza si la firma no quedó guardada', () => {
    const s = leerFront('pages', 'Activities.tsx');
    const rama = s.slice(s.indexOf('if (!navigator.onLine) {\n            const resultado = await signActivity('));
    assert.ok(rama.length > 0, 'falta la rama sin red de la asistencia');
    const hastaAvanzar = rama.slice(0, rama.indexOf('advanceSigning(1, 0);'));
    assert.match(hastaAvanzar, /if \(!resultado\.success\) \{[\s\S]*?return;/);
});
