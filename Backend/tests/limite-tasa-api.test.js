// Límite de tasa de la API (checklist 2.8).
//
// Toda ruta tiene el límite por omisión del stage. Las PÚBLICAS (las de
// `rutas-autenticadas.test.js`) tienen además uno propio y estricto, y el stage
// depende de cada una de esas rutas: CloudFormation no puede declarar el límite
// de una ruta que todavía no existe (falla con "Unable to find Route by key").
//
// El límite es por ruta y por ambiente, no por IP ni por persona: frena una
// avalancha. Al atacante paciente lo frenan el límite de intentos por cuenta y
// la detección (D-9, D-31).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const yml = fs.readFileSync(path.join(__dirname, '..', 'serverless.yml'), 'utf8');
const bloque = yml.slice(yml.indexOf('    HttpApiStage:'), yml.indexOf('\n  Resources:'));

const PUBLICAS = [
    'POST /auth/login', 'POST /auth/select-tenant', 'POST /auth/forgot-password', 'POST /auth/reset-password',
    'POST /auth/validate-token', 'GET /signatures/verify/{token}', 'GET /onboarding/licencia/{token}',
    'POST /onboarding/completar', 'POST /csp/reporte',
];

/** El nombre lógico que Serverless le da a la ruta (`HttpApiRoutePostAuthSelectDashtenant`). */
const idLogico = (ruta) => {
    const [metodo, camino] = ruta.split(' ');
    const partes = camino.split('/').filter(Boolean).map((p) => {
        const m = /^\{(.+)\}$/.exec(p);
        const base = (m ? m[1] : p).replace(/-/g, 'Dash');
        return base.charAt(0).toUpperCase() + base.slice(1) + (m ? 'Var' : '');
    });
    return `HttpApiRoute${metodo.charAt(0)}${metodo.slice(1).toLowerCase()}${partes.join('')}`;
};

const limiteDe = (ruta) => {
    const i = bloque.indexOf(`'${ruta}':`);
    if (i < 0) return null;
    const trozo = bloque.slice(i, i + 200);
    return {
        rafaga: Number(/ThrottlingBurstLimit: (\d+)/.exec(trozo)?.[1]),
        tasa: Number(/ThrottlingRateLimit: (\d+)/.exec(trozo)?.[1]),
    };
};

test('el stage tiene un límite por omisión para toda la API', () => {
    const def = bloque.slice(bloque.indexOf('DefaultRouteSettings:'), bloque.indexOf('RouteSettings:', bloque.indexOf('DefaultRouteSettings:') + 25));
    assert.match(def, /ThrottlingBurstLimit: \d+/);
    assert.match(def, /ThrottlingRateLimit: \d+/);
});

test('cada ruta pública tiene su límite propio, más estricto que el de la API', () => {
    const porOmision = Number(/DefaultRouteSettings:\s+ThrottlingBurstLimit: \d+\s+ThrottlingRateLimit: (\d+)/.exec(bloque)[1]);
    for (const r of PUBLICAS) {
        const l = limiteDe(r);
        assert.ok(l, `${r}: sin límite propio`);
        assert.ok(l.tasa > 0 && l.tasa <= 20, `${r}: tasa ${l.tasa}`);
        assert.ok(l.tasa < porOmision, `${r}: no más laxo que el de la API`);
        assert.ok(l.rafaga >= l.tasa, `${r}: ráfaga menor que la tasa`);
    }
    assert.ok(limiteDe('POST /auth/forgot-password').tasa <= 2, 'la que manda correos, la más estricta');
});

test('el stage depende de cada ruta con límite propio', () => {
    const depende = bloque.slice(bloque.indexOf('DependsOn:'), bloque.indexOf('Properties:'));
    for (const r of PUBLICAS) {
        assert.ok(depende.includes(`- ${idLogico(r)}`), `${r}: falta ${idLogico(r)} en DependsOn`);
    }
});

test('las rutas públicas de la lista coinciden con las de rutas-autenticadas', () => {
    const otra = fs.readFileSync(path.join(__dirname, 'rutas-autenticadas.test.js'), 'utf8');
    const lista = otra.slice(otra.indexOf('const PUBLICAS = {'), otra.indexOf('};', otra.indexOf('const PUBLICAS = {')));
    const declaradas = [...lista.matchAll(/^\s+'([A-Z]+ [^']+)':/gm)].map((m) => m[1]).sort();
    assert.deepEqual(declaradas, [...PUBLICAS].sort(), 'una ruta pública nueva necesita su límite de tasa');
});

// ─── El frontend ante un 429 ─────────────────────────────────────────────────

const front = (...p) => fs.readFileSync(path.join(__dirname, '..', '..', 'Frontend', 'src', ...p), 'utf8');

test('un 429 o un 5xx llegan a la pantalla como reintentables, con un mensaje que se entiende', () => {
    const s = front('api', 'client.ts');
    const i = s.indexOf('if (response.status === 429 || response.status >= 500) {');
    assert.ok(i > 0);
    assert.ok(i < s.indexOf('const data = await response.json();\n        return data;'), 'antes de devolver el cuerpo tal cual');
    assert.match(s.slice(i, i + 700), /reintentable: true/);
    assert.match(s.slice(i, i + 700), /Espera unos segundos/);
});

test('al sincronizar, una respuesta reintentable deja la firma en la cola (no se descarta)', () => {
    const s = front('hooks', 'useOfflineSignature.ts');
    const rama = /\} else if \(response && (.+?)\) \{\n[^]*?quitarDeCola\(tenantId, sig\.id\);\n\s+anotarRechazada/.exec(s);
    assert.ok(rama, 'la rama que descarta y anota');
    assert.match(rama[1], /!\(response as \{ reintentable\?: boolean \}\)\.reintentable/);
});
