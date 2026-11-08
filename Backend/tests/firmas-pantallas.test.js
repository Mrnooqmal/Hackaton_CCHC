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

const FRONTEND = path.join(__dirname, '..', '..', 'Frontend');
let ts;
try { ts = require(path.join(FRONTEND, 'node_modules', 'typescript')); } catch { ts = null; }

function cargarTs(nombre) {
    assert.ok(ts, 'Falta Frontend/node_modules/typescript: corre `npm ci` en Frontend. Esta prueba no se salta.');
    const archivo = path.join(FRONTEND, 'src', 'utils', nombre);
    const { outputText } = ts.transpileModule(fs.readFileSync(archivo, 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    });
    const m = new Module(archivo);
    m._compile(outputText, archivo);
    return m.exports;
}

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

test('vales disponibles: con obra, solo cuentan los de esa obra', () => {
    const c = cargarTs('colaFirmas.ts');
    const a = almacen();
    c.guardarValesDe('t-1', { personaId: 'p-1', obraId: 'o-1', vales: ['v1', 'v2'], expiraEn: enUnaHora() }, a);
    assert.equal(c.valesDisponibles('t-1', 'p-1', a, 'o-1'), 2);
    assert.equal(c.valesDisponibles('t-1', 'p-1', a, 'o-2'), 0, 'los de otra obra no sirven ahí');
    assert.equal(c.valesDisponibles('t-1', 'p-1', a), 2, 'sin obra, todos');
    assert.equal(c.valesDePersona('t-1', 'p-1', a).obraId, 'o-1');
    assert.equal(c.valesDePersona('t-2', 'p-1', a), null, 'ni los de otra empresa');
});

// ─── Pantallas ───────────────────────────────────────────────────────────────

test('rutas y menú: preparar cuadrilla con firma asistida, revisión con firmas.crear', () => {
    const app = leerFront('App.tsx');
    assert.match(app, /path="\/firmas\/preparar-cuadrilla"[\s\S]{0,200}PERMISSIONS\.OBRA_FIRMA_ASISTIDA/);
    assert.match(app, /path="\/firmas\/revision"[\s\S]{0,200}PERMISSIONS\.FIRMAS_CREAR/);
    assert.ok(app.includes('{user && <SincronizadorFirmas />}'), 'se sincroniza en cualquier pantalla con sesión');
    assert.ok(app.includes('{user && <AvisoValesTurno />}'));
    const menu = leerFront('components', 'Sidebar.tsx');
    assert.match(menu, /'\/firmas\/preparar-cuadrilla'[^}]*permission: PERMISSIONS\.OBRA_FIRMA_ASISTIDA/);
    assert.match(menu, /'\/firmas\/revision'[^}]*permission: PERMISSIONS\.FIRMAS_CREAR/);
});

test('cerrar sesión avisa cuántos vales se pierden y cuántas firmas quedan por enviar', () => {
    const s = leerFront('components', 'Sidebar.tsx');
    assert.ok(s.includes('const { vales, firmas } = resumenDelEquipo();'));
    assert.ok(s.includes('message={mensajeCierre()}'));
});

test('el aviso de vales sale solo con señal, en una obra asignada y con menos de 3', () => {
    const s = leerFront('components', 'firmas', 'AvisoValesTurno.tsx');
    assert.ok(s.includes('const MINIMO = 3;'));
    assert.match(s, /!isOnline \|\| scope !== 'obra'/);
    assert.ok(s.includes("(u.obraIds || []).includes(selectedObraId)"), 'solo en obras de la persona');
    assert.ok(s.includes('valesDe(personaId, selectedObraId)'), 'cuenta los vales de esa obra');
});

test('el sincronizador no corre dos envíos a la vez', () => {
    const hook = leerFront('hooks', 'useOfflineSignature.ts');
    assert.match(hook, /let sincronizacionEnCurso[^;]*;/, 'candado a nivel de módulo, compartido entre pantallas');
    const s = leerFront('components', 'firmas', 'SincronizadorFirmas.tsx');
    assert.ok(s.includes('if (!navigator.onLine || avisando.current) return;'));
});

test('firma asistida sin red: usa el vale del trabajador y la obra, y no simula comprobar el PIN', () => {
    const s = leerFront('components', 'FirmaAsistidaModal.tsx');
    const rama = s.slice(s.indexOf('if (!navigator.onLine) {\n            const nombre'));
    assert.ok(rama.length > 0, 'falta la rama sin red');
    const cuerpo = rama.slice(0, rama.indexOf('return;\n        }') + 1);
    assert.ok(cuerpo.includes('signDocument(selectedDocId,'), 'firma con el vale, vía la cola');
    assert.ok(cuerpo.includes('selectedWorker.personaId, nombre, pin, obraId)'), 'a nombre del trabajador y para la obra');
    assert.match(cuerpo, /if \(!r\.success\) \{[^}]*return; \}/, 'si no quedó guardada, no se da por firmada');
    assert.ok(s.includes('Sin señal: el PIN no se puede comprobar ahora.'), 'dice la verdad sobre el PIN sin red');
});

test('mis firmas: las solicitudes de firma piden red; los documentos van por la cola', () => {
    const s = leerFront('pages', 'MySignatures.tsx');
    assert.ok(s.includes('signDocument('), 'los documentos usan el hook (con vale sin red)');
});
