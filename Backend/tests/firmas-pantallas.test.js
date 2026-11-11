// Parte 4 de la firma sin conexión: las pantallas.
//
// La lógica (copias locales, vales por obra) se carga transpilada con el
// TypeScript del frontend y se prueba sobre un almacenamiento en memoria. Lo que
// solo existe en el JSX (rutas, avisos, la rama sin red de la firma asistida) se
// comprueba en el texto: sin un DOM en la suite, es lo que protege que no se
// pierda en un cambio.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Module = require('module');

const { cargarTs, FRONTEND } = require('./cargar-ts');

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

/** Corre `fn` con `localStorage` global apuntando a `a`. */
function conAlmacen(a, fn) {
    const previo = global.localStorage;
    global.localStorage = a;
    try { return fn(); } finally { global.localStorage = previo; }
}

const leerFront = (...p) => fs.readFileSync(path.join(FRONTEND, 'src', ...p), 'utf8');
const enUnaHora = () => new Date(Date.now() + 3600e3).toISOString();

// ─── Copias locales ──────────────────────────────────────────────────────────

test('copia local: por empresa, con su fecha, y otra empresa no la lee', () => {
    const a = almacen();
    const c = cargarTs('copiaLocal.ts');
    conAlmacen(a, () => {
        a.setItem('tenant_id', 't-1');
        c.guardarCopia('actividades:o-1', [{ activityId: 'a-1' }]);
        const copia = c.leerCopia('actividades:o-1');
        assert.deepEqual(copia.datos, [{ activityId: 'a-1' }]);
        assert.ok(!Number.isNaN(Date.parse(copia.guardadaEn)), 'dice de cuándo es');
        a.setItem('tenant_id', 't-2');
        assert.equal(c.leerCopia('actividades:o-1'), null, 'la copia de una empresa no se muestra en otra');
        a.removeItem('tenant_id');
        c.guardarCopia('actividades:o-1', [{ activityId: 'x' }]);
        assert.equal([...a.datos.keys()].filter((k) => k.startsWith('copiaLocal:')).length, 1, 'sin empresa no se guarda');
    });
});

test('copia local: "Cerrar sesión" borra las de todas las empresas y nada más', () => {
    const a = almacen();
    const c = cargarTs('copiaLocal.ts');
    conAlmacen(a, () => {
        a.setItem('tenant_id', 't-1');
        c.guardarCopia('k', 1);
        a.setItem('tenant_id', 't-2');
        c.guardarCopia('k', 2);
        a.setItem('cola-firmas:t-1', '[]');
        c.borrarCopias();
        assert.deepEqual([...a.datos.keys()].sort(), ['cola-firmas:t-1', 'tenant_id']);
    });
});

test('el cierre de sesión explícito borra las copias; el vencimiento no', () => {
    const s = leerFront('context', 'AuthContext.tsx');
    const rama = s.slice(s.indexOf('if (cierreExplicito) {'));
    assert.ok(rama.slice(0, rama.indexOf('}')).includes('borrarCopias();'));
    assert.equal((s.match(/borrarCopias\(\)/g) || []).length, 1, 'solo en la rama del cierre explícito');
});

test('las copias guardan solo lo necesario para firmar: ni RUT, ni correo, ni salud', () => {
    for (const [archivo, clave] of [
        [['pages', 'Activities.tsx'], 'actividades:'],
        [['pages', 'MySignatures.tsx'], 'mis-firmas:'],
        [['components', 'FirmaAsistidaModal.tsx'], 'firma-asistida:'],
    ]) {
        const s = leerFront(...archivo);
        const i = s.indexOf(`guardarCopia(\`${clave}`);
        assert.ok(i >= 0, `${archivo.join('/')} guarda su copia`);
        const llamada = s.slice(i, s.indexOf(');', i));
        assert.ok(!/\brut\b|email|correo|salud/i.test(llamada), `${archivo.join('/')} no copia datos sensibles`);
    }
});

// ─── Vales por obra ──────────────────────────────────────────────────────────

test('vales disponibles: con obra, solo cuentan los de esa obra', async () => {
    const c = cargarTs('colaFirmas.ts');
    const { cifrarVales } = cargarTs('valesCifrados.ts');
    const a = almacen();
    const cifrado = await cifrarVales('4829', ['a'.repeat(64), 'b'.repeat(64)], 1000);
    c.guardarValesDe('t-1', { personaId: 'p-1', obraId: 'o-1', cifrado, expiraEn: enUnaHora() }, a);
    assert.equal(c.valesDisponibles('t-1', 'p-1', a, 'o-1'), 2);
    assert.equal(c.valesDisponibles('t-1', 'p-1', a, 'o-2'), 0, 'los de otra obra no sirven ahí');
    assert.equal(c.valesDisponibles('t-1', 'p-1', a), 2, 'sin obra, todos');
    assert.deepEqual({ ...c.valesDePersona('t-1', 'p-1', a), expiraEn: undefined }, { personaId: 'p-1', obraId: 'o-1', cantidad: 2, expiraEn: undefined }, 'resumen sin los vales');
    assert.equal(c.valesDePersona('t-2', 'p-1', a), null, 'ni los de otra empresa');
});

// ─── Pantallas ───────────────────────────────────────────────────────────────

test('rutas y menú: firmas en revisión con firmas.crear; el sincronizador, en toda sesión', () => {
    const app = leerFront('App.tsx');
    assert.match(app, /path="\/firmas\/revision"[\s\S]{0,200}PERMISSIONS\.FIRMAS_CREAR/);
    assert.ok(app.includes('{user && <SincronizadorFirmas />}'), 'se sincroniza en cualquier pantalla con sesión');
    const menu = leerFront('components', 'Sidebar.tsx');
    assert.match(menu, /'\/firmas\/revision'[^}]*permission: PERMISSIONS\.FIRMAS_CREAR/);
});

test('habilitar no es un paso: no hay aviso al entrar ni pantalla de cuadrilla', () => {
    const app = leerFront('App.tsx');
    const menu = leerFront('components', 'Sidebar.tsx');
    for (const s of [app, menu]) {
        assert.ok(!/AvisoValesTurno|PrepararCuadrilla|preparar-cuadrilla/.test(s));
    }
    for (const archivo of [['components', 'firmas', 'AvisoValesTurno.tsx'], ['components', 'firmas', 'HabilitarValesModal.tsx'], ['pages', 'PrepararCuadrilla.tsx']]) {
        assert.ok(!fs.existsSync(path.join(FRONTEND, 'src', ...archivo)), archivo.join('/'));
    }
});

test('cerrar sesión avisa cuántas firmas quedan por enviar, con el plural correcto', () => {
    const s = leerFront('components', 'Sidebar.tsx');
    assert.ok(s.includes('const { firmas } = resumenDelEquipo();'));
    assert.ok(s.includes('message={mensajeCierre()}'));
    assert.ok(s.includes("'hay 1 firma por enviar'"));
});

test('firma asistida sin red: el PIN del trabajador firma, para la obra del documento', () => {
    const s = leerFront('components', 'FirmaAsistidaModal.tsx');
    const rama = s.slice(s.indexOf('if (!navigator.onLine) {\n            const nombre'));
    assert.ok(rama.length > 0, 'falta la rama sin red');
    const cuerpo = rama.slice(0, rama.indexOf('return;\n        }') + 1);
    assert.ok(cuerpo.includes('signDocument(selectedDocId,'));
    assert.ok(cuerpo.includes('selectedWorker.personaId, nombre, pin, selectedDoc?.obraId || null)'));
    assert.match(cuerpo, /if \(!r\.success\) \{[^}]*return; \}/, 'si no quedó guardada, no se da por firmada');
});

test('mis firmas: los documentos van por el hook, que firma con o sin red', () => {
    const s = leerFront('pages', 'MySignatures.tsx');
    assert.ok(s.includes('signDocument('));
});
