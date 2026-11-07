// Quién pregunta y de qué empresa sale de la sesión. En TODOS los handlers.
//
// Dos rutas se escaparon de la revisión anterior (`/signature-requests` y
// `/ausencias`): leían la empresa de la consulta o del cuerpo y nunca llamaban a
// `conSesion`. Se escaparon porque la revisión fue por lista de módulos, y una
// lista de módulos envejece. Esta prueba no tiene lista de módulos: recorre lo
// que hay.
//
// Dos llaves, como el cierre por omisión de `rutas-autenticadas.test.js`:
//
//   1. En ejecución: se invoca cada ruta autenticada de `serverless.yml` SIN
//      contexto de sesión, con una empresa ajena en la consulta y en el cuerpo.
//      Tiene que responder el 401 de `conSesion` y no tocar nada: ni AWS, ni la
//      red. En los módulos que atienden `{proxy+}` se sondean sus rutas internas
//      combinando los segmentos que el propio módulo compara.
//
//   2. En el código: se analiza cada archivo de `handlers/` con el parser de
//      TypeScript y se marca toda lectura de la empresa, de una persona o de un
//      actor desde el cuerpo, la consulta o el path. La empresa y el actor no
//      tienen excepción posible fuera de las rutas públicas. Una persona como
//      OBJETO del acto (a quién se le registra algo) sí, pero cada caso está
//      abajo con dónde se comprueba que sea de la empresa (404).
//
// Límite conocido: el análisis no sigue un objeto del cliente cuando se pasa
// entero a un servicio de `lib/`. Por eso los handlers que lo hacen pisan los
// campos de identidad antes de pasarlo (`body.tenantId = sesion.tenantId`), y
// los repositorios dentro de `handlers/` no pueden tener un campo de actor en
// una lista de campos aceptados del cliente (la segunda prueba lo marca).

process.env.CAMPO_HMAC_KEY = 'clave-de-prueba-hmac';
process.env.CAMPO_CIFRADO_LOCAL_KEY = require('crypto').randomBytes(32).toString('base64');

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const BACKEND = path.join(__dirname, '..');
const HANDLERS = path.join(BACKEND, 'handlers');

// ─── Rutas de serverless.yml ─────────────────────────────────────────────────

function rutasAutenticadas() {
    const lineas = fs.readFileSync(path.join(BACKEND, 'serverless.yml'), 'utf8').split('\n');
    const rutas = [];
    let handler = null;
    for (let i = 0; i < lineas.length; i++) {
        const t = lineas[i].trim();
        if (t.startsWith('handler:')) handler = t.slice(8).trim();
        if (t !== '- httpApi:') continue;
        let metodo = null; let ruta = null; let autorizador = false;
        for (let j = i + 1; j < lineas.length; j++) {
            const l = lineas[j];
            if (l.trim() === '' || !l.startsWith('          ')) break;
            const x = l.trim();
            if (x.startsWith('path:')) ruta = x.slice(5).trim();
            if (x.startsWith('method:')) metodo = x.slice(7).trim().toUpperCase();
            if (x.startsWith('authorizer:')) autorizador = true;
        }
        if (ruta && autorizador) rutas.push({ metodo, ruta, handler });
    }
    return rutas;
}

/**
 * Rutas autenticadas que resuelven el token por su cuenta y no pasan por
 * `conSesion`. Sin sesión leen la tabla de sesiones, y nada más.
 */
const RESUELVEN_EL_TOKEN = {
    'GET /auth/me': 'Devuelve la sesión del token; lo resuelve contra la tabla, sin el caché del autorizador.',
    'POST /auth/logout': 'Cierra la sesión del token que trae.',
};

// ─── Llave 1: sin sesión, ninguna ruta toca nada ─────────────────────────────

test('sin sesión, toda ruta autenticada responde 401 y no toca AWS ni la red', async () => {
    const { NodeHttpHandler } = require('@smithy/node-http-handler');
    const bloqueo = NodeHttpHandler.prototype.handle;
    const fetchOriginal = global.fetch;
    let salidas = [];
    NodeHttpHandler.prototype.handle = async function contar(req) {
        salidas.push(`AWS ${req.hostname.split('.')[0]}`);
        throw new Error('sin AWS');
    };
    global.fetch = async (url) => { salidas.push(`red ${String(url).slice(0, 40)}`); throw new Error('sin red'); };
    // Los módulos registran por consola cada intento fallido: miles de líneas.
    const consola = { log: console.log, error: console.error, warn: console.warn, info: console.info };
    console.log = console.error = console.warn = console.info = () => {};

    const AJENA = 't-ajena';
    const evento = (metodo, ruta) => ({
        version: '2.0', routeKey: `${metodo} ${ruta}`, rawPath: ruta, rawQueryString: `tenantId=${AJENA}`,
        headers: { authorization: 'Bearer token-cualquiera', 'content-type': 'application/json' },
        queryStringParameters: { tenantId: AJENA, empresaId: AJENA, personaId: 'p-ajena', obraId: 'o-1', fecha: '2026-10-01', rut: '12.345.678-5' },
        pathParameters: new Proxy({}, { get: (_, k) => (typeof k === 'string' ? 'x' : undefined) }),
        requestContext: { http: { method: metodo, path: ruta, sourceIp: '10.0.0.1' } },
        body: JSON.stringify({
            tenantId: AJENA, empresaId: AJENA, personaId: 'p-ajena', solicitanteId: 'p-ajena', obraId: 'o-1',
            fecha: '2026-10-01', titulo: 'x', tipo: 'OTRO', pin: '1234', audio: 'aGk=', trabajadoresIds: ['p-ajena'],
        }),
    });

    const fallas = [];
    let sondeos = 0;
    try {
        for (const r of rutasAutenticadas()) {
            if (RESUELVEN_EL_TOKEN[`${r.metodo} ${r.ruta}`]) continue;
            const punto = r.handler.lastIndexOf('.');
            const archivo = path.join(BACKEND, r.handler.slice(0, punto));
            const fn = require(archivo)[r.handler.slice(punto + 1)];
            const metodos = r.metodo === 'ANY' ? ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] : [r.metodo];

            // Ruta declarada: exactamente el 401 de `conSesion`.
            let sondas = [{ ruta: r.ruta.replace(/\{[^}]+\}/g, 'x'), exacto: r.metodo !== 'ANY' }];
            if (r.ruta.includes('{proxy+}')) {
                // Rutas internas: los segmentos que el módulo compara. Un sondeo
                // que no cae en ninguna puede responder 404/405, pero tampoco
                // puede tocar nada.
                const fuente = fs.readFileSync(`${archivo}.js`, 'utf8');
                const segs = [...new Set([...fuente.matchAll(/===\s*'([a-z][a-z0-9-]{1,30})'/g)].map((m) => m[1]))];
                const base = r.ruta.replace('/{proxy+}', '');
                sondas = [{ ruta: base, exacto: false }];
                for (const a of ['x', ...segs]) {
                    for (const p of [`${base}/${a}`, `${base}/x/${a}`, `${base}/${a}/x`, `${base}/x/${a}/x`]) sondas.push({ ruta: p, exacto: false });
                    for (const b of segs) sondas.push({ ruta: `${base}/${a}/${b}`, exacto: false }, { ruta: `${base}/x/${a}/${b}`, exacto: false });
                }
            }

            for (const metodo of metodos) {
                for (const s of sondas) {
                    salidas = [];
                    sondeos++;
                    let res;
                    try { res = await fn(evento(metodo, s.ruta)); } catch (err) { res = { statusCode: `lanzó: ${err.message}` }; }
                    const estado = res?.statusCode;
                    const ok = salidas.length === 0
                        && (estado === 401 || (!s.exacto && [404, 405, 410].includes(estado)) || (s.exacto && estado === 410));
                    if (!ok) fallas.push(`${metodo} ${s.ruta} (${r.ruta}) -> ${estado}${salidas.length ? `, ${[...new Set(salidas)].join(', ')}` : ''}`);
                }
            }
        }
    } finally {
        NodeHttpHandler.prototype.handle = bloqueo;
        global.fetch = fetchOriginal;
        Object.assign(console, consola);
    }

    assert.ok(sondeos > 1000, `se esperaban más de mil sondeos, hubo ${sondeos}`);
    assert.deepEqual([...new Set(fallas)].slice(0, 40), [],
        `Rutas que sin sesión no responden el 401 de conSesion, o tocan datos:\n  ${fallas.slice(0, 40).join('\n  ')}`);
});

// ─── Llave 2: el código no lee identidad del cliente ─────────────────────────

let ts;
try { ts = require(path.join(BACKEND, '..', 'Frontend', 'node_modules', 'typescript')); } catch { ts = null; }

const ES_EMPRESA = (c) => c === 'tenantId' || c === 'empresaId';
// Quien realiza el acto. `createdBy`, `registradoPor`, `solicitanteId`…
const ES_ACTOR = (c) => /Por$/.test(c) || /^(solicitante|creador|actor|autor|user|usuario|sender|remitente|registrador)Id$/.test(c)
    || c === 'createdBy' || c === 'updatedBy';
// Una persona nombrada por el cliente: puede ser el objeto del acto.
const ES_PERSONA = (c) => c === 'personaId' || /^(relator|responsable|firmante|trabajador|worker|titular|asistente)Id$/.test(c);
const CAMPO = (c) => ES_EMPRESA(c) || ES_ACTOR(c) || ES_PERSONA(c);

/**
 * Lecturas permitidas, por `archivo#función#campo`, con su razón. Solo personas
 * como objeto del acto, o rutas públicas que se autentican con otra credencial.
 * La empresa y el actor desde el cliente no tienen razón posible.
 */
const PERMITIDAS = {
    'auth/handler.js#module.exports.selectTenant#tenantId': 'Ruta pública, segundo paso del ingreso: la empresa elegida se valida contra las del token de selección de un solo uso.',
    'auth/handler.js#module.exports.resetPassword#personaId': 'Ruta pública: el token de recuperación de un solo uso es la credencial, y se compara con el de esa persona.',
    'activities/handler.js#module.exports.create#relatorId': 'Relator nombrado por quien crea: personasDeLaEmpresa, 404.',
    'activities/handler.js#module.exports.patch#relatorId': 'Relator reasignado: personaDeLaEmpresa contra la empresa de la actividad, 404.',
    'activities/handler.js#module.exports.list#relatorId': 'Filtro de una consulta ya acotada a la empresa de la sesión.',
    'activities/handler.js#module.exports.list#responsableId': 'Filtro de una consulta ya acotada a la empresa de la sesión.',
    'activities/handler.js#module.exports.registerAttendance#personaId': 'Quien firma su asistencia: es la sesión o, con firma asistida, otra persona de la empresa de la actividad (404). El PIN es suyo.',
    'activities/handler.js#module.exports.registerAttendance#workerId': 'Nombre anterior de personaId, mismo caso.',
    'ausencias/handler.js#module.exports.create#personaId': 'La persona ausente: personaDeLaEmpresa, 404.',
    'ausencias/handler.js#module.exports.remove#personaId': 'La persona ausente: la clave lleva la empresa de la sesión, no se puede nombrar una ajena.',
    'documents/handler.js#module.exports.create#relatorId': 'Relator del documento: personaDeLaEmpresa, 404.',
    'documents/handler.js#module.exports.sign#personaId': 'Quien firma: la sesión o, con firma asistida, una persona de la empresa del documento (404). El PIN es suyo.',
    'documents/handler.js#module.exports.signAssisted#firmanteId': 'El trabajador que firma con su PIN en el dispositivo de quien asiste; de la misma empresa (404).',
    'incidents-module/handler.js#create#responsableId': 'Responsable del hallazgo: personaDeLaEmpresa, 404.',
    'incidents-module/handler.js#updateGobernanza#responsableId': 'Responsable del hallazgo: personaDeLaEmpresa, 404.',
    'signature-requests/handler.js#module.exports.getPendingByWorker#workerId': 'La propia persona o quien ve fichas (personas.detalle), y de la empresa: personaConsultable, 404.',
    'signature-requests/handler.js#module.exports.getHistoryByWorker#workerId': 'La propia persona o quien ve fichas (personas.detalle), y de la empresa: personaConsultable, 404.',
    'signatures/handler.js#module.exports.getByWorker#workerId': 'La propia persona o quien ve fichas (personas.detalle); el resultado se acota a la empresa de la sesión.',
    'surveys/handler.js#module.exports.updateResponseStatus#workerId': 'Quien responde: la sesión o, con firma asistida, un destinatario de una encuesta de la empresa (404). Firma con su PIN.',
    'signatures/handler.js#module.exports.create#personaId': 'Quien firma: la sesión o, con firma asistida, una persona de la empresa (404). El PIN es suyo.',
    'vales/handler.js#module.exports.emitir#personaId': 'Para quién son los vales: la sesión o, con firma asistida, una persona de la empresa. Desbloquearlos exige su PIN.',
};

function archivosDe(dir) {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory()
        ? archivosDe(path.join(dir, e.name))
        : e.name.endsWith('.js') ? [path.join(dir, e.name)] : []));
}

/** Toda lectura de un campo de identidad desde lo que manda el cliente. */
function lecturasDeIdentidad() {
    const lecturas = [];
    for (const archivo of archivosDe(HANDLERS)) {
        const rel = path.relative(HANDLERS, archivo).split(path.sep).join('/');
        const sf = ts.createSourceFile(archivo, fs.readFileSync(archivo, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
        const desnudo = (e) => { while (e && (ts.isParenthesizedExpression(e) || ts.isAwaitExpression(e))) e = e.expression; return e; };

        // Fuentes: event.body, event.queryStringParameters, event.pathParameters,
        // request.query / request.params (itty-router), y parseBody(...).
        const esFuente = (e) => {
            e = desnudo(e);
            if (!e) return false;
            if (ts.isCallExpression(e)) {
                const n = e.expression.getText();
                if (n === 'JSON.parse') return esFuente(e.arguments[0]);
                if (/^parse\w*Body$/i.test(n)) return true;
            }
            if (ts.isBinaryExpression(e) && [ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken].includes(e.operatorToken.kind)) {
                return esFuente(e.left);
            }
            if (ts.isPropertyAccessExpression(e)) {
                const campo = e.name.text;
                if (['body', 'queryStringParameters', 'pathParameters', 'multiValueQueryStringParameters'].includes(campo)) return true;
                if (['query', 'params'].includes(campo) && /^(request|req)$/.test(e.expression.getText())) return true;
            }
            return false;
        };
        // Alias: `const body = JSON.parse(event.body)`, `const q = event.queryStringParameters || {}`.
        const alias = new Set();
        const marcarAlias = (n) => {
            if (ts.isVariableDeclaration(n) && n.initializer && ts.isIdentifier(n.name)) {
                const ini = desnudo(n.initializer);
                if (esFuente(ini) || (ts.isIdentifier(ini) && alias.has(ini.text))) alias.add(n.name.text);
            }
            ts.forEachChild(n, marcarAlias);
        };
        marcarAlias(sf);
        const delCliente = (e) => {
            e = desnudo(e);
            if (ts.isIdentifier(e)) return alias.has(e.text);
            if (ts.isBinaryExpression(e) && ts.isIdentifier(desnudo(e.left))) return alias.has(desnudo(e.left).text) || esFuente(e);
            return esFuente(e);
        };
        const funcionDe = (n) => {
            for (let x = n; x; x = x.parent) {
                if (!ts.isFunctionLike(x)) continue;
                if (x.name) return x.name.getText();
                const p = x.parent;
                if (p && ts.isVariableDeclaration(p)) return p.name.getText();
                if (p && ts.isBinaryExpression(p)) return p.left.getText();
                if (p && ts.isPropertyAssignment(p)) return p.name.getText();
            }
            return '(módulo)';
        };
        // Escribir el campo (pisarlo con el de la sesión) o borrarlo no es leerlo.
        const esEscritura = (n) => {
            const p = n.parent;
            return (ts.isBinaryExpression(p) && p.left === n && p.operatorToken.kind === ts.SyntaxKind.EqualsToken)
                || ts.isDeleteExpression(p);
        };
        const anotar = (campo, nodo, tipo = 'lectura') => lecturas.push({
            clave: `${rel}#${funcionDe(nodo)}#${campo}`, campo, tipo,
            donde: `${rel}:${sf.getLineAndCharacterOfPosition(nodo.getStart()).line + 1}`,
        });

        const visitar = (n) => {
            if (ts.isPropertyAccessExpression(n) && CAMPO(n.name.text) && delCliente(n.expression) && !esEscritura(n)) anotar(n.name.text, n);
            if (ts.isElementAccessExpression(n) && ts.isStringLiteral(n.argumentExpression) && CAMPO(n.argumentExpression.text)
                && delCliente(n.expression) && !esEscritura(n)) anotar(n.argumentExpression.text, n);
            if (ts.isVariableDeclaration(n) && n.initializer && ts.isObjectBindingPattern(n.name) && delCliente(n.initializer)) {
                for (const el of n.name.elements) {
                    const campo = (el.propertyName || el.name).getText();
                    if (CAMPO(campo)) anotar(campo, el);
                }
            }
            // Una lista de campos que se aceptan del cliente con la empresa o un
            // actor adentro (así entraba `verificadoPor` en la gobernanza). Se
            // reconoce por el nombre de la variable que la guarda.
            if (ts.isArrayLiteralExpression(n) && n.elements.every(ts.isStringLiteral)
                && ts.isVariableDeclaration(n.parent) && /campo|permitid|editable|aceptad|allowed|fields/i.test(n.parent.name.getText())) {
                for (const el of n.elements) {
                    if (ES_EMPRESA(el.text) || ES_ACTOR(el.text)) anotar(el.text, el, 'lista de campos aceptados');
                }
            }
            ts.forEachChild(n, visitar);
        };
        visitar(sf);
    }
    return lecturas;
}

test('ningún handler lee la empresa, un actor o una persona del cliente sin una razón declarada', { skip: false }, () => {
    assert.ok(ts, 'Falta Frontend/node_modules/typescript: corre `npm ci` en Frontend. Esta prueba de seguridad no se salta.');
    const sinRazon = lecturasDeIdentidad().filter((l) => !PERMITIDAS[l.clave]);
    assert.deepEqual(sinRazon.map((l) => `${l.donde}  ${l.campo} (${l.tipo}, ${l.clave})`), [],
        'La empresa y quien actúa salen de la sesión (`conSesion`), nunca del cuerpo ni de la consulta. Si es una persona '
        + 'como objeto del acto, comprueba que sea de la empresa (lib/auth/pertenencia.js, 404) y declárala en PERMITIDAS con dónde se comprueba.');
});

test('las excepciones son solo personas como objeto del acto o rutas públicas', () => {
    for (const clave of Object.keys(PERMITIDAS)) {
        const campo = clave.split('#').pop();
        const publica = clave.startsWith('auth/handler.js#');
        assert.ok(publica || ES_PERSONA(campo), `${clave}: la empresa o un actor del cliente no admiten excepción`);
    }
});

test('ninguna excepción declarada sobra', () => {
    // Una lista de permisos que envejece esconde la superficie real.
    assert.ok(ts, 'Falta Frontend/node_modules/typescript.');
    const vistas = new Set(lecturasDeIdentidad().map((l) => l.clave));
    assert.deepEqual(Object.keys(PERMITIDAS).filter((c) => !vistas.has(c)), []);
});

test('el análisis encuentra lo que tiene que encontrar', () => {
    // Si el parser o las fuentes dejan de reconocer algo, las pruebas de arriba
    // pasarían sin mirar. Se fija contra lecturas que existen a propósito.
    assert.ok(ts, 'Falta Frontend/node_modules/typescript.');
    const claves = new Set(lecturasDeIdentidad().map((l) => l.clave));
    for (const c of ['auth/handler.js#module.exports.selectTenant#tenantId', 'vales/handler.js#module.exports.emitir#personaId',
        'activities/handler.js#module.exports.list#responsableId']) {
        assert.ok(claves.has(c), `el análisis ya no ve ${c}`);
    }
});
