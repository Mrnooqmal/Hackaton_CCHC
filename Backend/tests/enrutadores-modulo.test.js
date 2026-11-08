// Enrutadores de uploads y surveys (una función por módulo, D-16).
//
// Eran 9 funciones; cada función con ruta HTTP suma 4 recursos al stack. Ahora
// cada módulo es una función y `enrutar` elige por `event.routeKey`. Lo que se
// fija: las rutas declaradas en `serverless.yml` para la función y las de su
// tabla son exactamente las mismas (una ruta declarada sin entrada respondería
// 404; una entrada sin ruta sería código muerto), y una ruta desconocida
// responde 404 sin caer en otra.

process.env.CAMPO_HMAC_KEY = 'clave-de-prueba-hmac';
process.env.CAMPO_CIFRADO_LOCAL_KEY = require('crypto').randomBytes(32).toString('base64');

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const yml = fs.readFileSync(path.join(__dirname, '..', 'serverless.yml'), 'utf8');

/** Rutas (`MÉTODO /camino`) declaradas para la función `nombre`. */
function rutasDe(nombre) {
    const i = yml.indexOf(`\n  ${nombre}:\n`);
    assert.ok(i >= 0, `falta la función ${nombre}`);
    const resto = yml.slice(i + nombre.length + 4);
    const fin = resto.search(/\n  [A-Za-z#]/);
    const bloque = fin >= 0 ? resto.slice(0, fin) : resto;
    return [...bloque.matchAll(/path: (\S+)\s+method: (\w+)/g)].map((m) => `${m[2].toUpperCase()} ${m[1]}`).sort();
}

for (const [modulo, funcion, archivo] of [
    ['uploads', 'uploadsModule', '../handlers/uploads/handler'],
    ['surveys', 'surveysModule', '../handlers/surveys/handler'],
]) {
    test(`${modulo}: las rutas declaradas y las de la tabla son las mismas`, () => {
        const h = require(archivo);
        assert.deepEqual(Object.keys(h.RUTAS).sort(), rutasDe(funcion));
        assert.match(yml, new RegExp(`\\n  ${funcion}:\\n    handler: handlers/${modulo}/handler\\.enrutar\\n`));
        for (const [ruta, fn] of Object.entries(h.RUTAS)) assert.equal(typeof fn, 'function', ruta);
    });

    test(`${modulo}: una ruta desconocida responde 404 y no llega a ningún handler`, async () => {
        const h = require(archivo);
        for (const routeKey of [undefined, '', 'GET /otra', `PUT /${modulo}`]) {
            const r = await h.enrutar({ routeKey, requestContext: {} });
            assert.equal(r.statusCode, 404, String(routeKey));
        }
    });

    test(`${modulo}: cada ruta llega a su handler, que exige sesión`, async () => {
        const h = require(archivo);
        for (const routeKey of Object.keys(h.RUTAS)) {
            const r = await h.enrutar({ routeKey, rawPath: '/x', requestContext: { http: { method: routeKey.split(' ')[0] } }, headers: {} });
            assert.equal(r.statusCode, 401, `${routeKey}: sin sesión, 401 del handler (no 404 del enrutador)`);
        }
    });
}

test('no quedan las funciones de una ruta de estos módulos', () => {
    for (const viejo of ['getUploadUrl', 'getDownloadUrl', 'confirmUpload', 'deleteUpload', 'getBatchDownloadUrls',
        'createSurvey', 'listSurveys', 'getSurvey', 'updateSurveyResponse']) {
        assert.ok(!new RegExp(`\\n  ${viejo}:\\n`).test(yml), viejo);
    }
});
