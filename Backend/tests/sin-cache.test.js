// Ninguna respuesta de la API se guarda en caché: Cache-Control: no-store en TODAS.
//
// Las respuestas llevan datos personales y la app se usa en equipos compartidos
// de terreno. Sin `no-store`, el JSON de una ficha podía quedar en el caché de
// disco del navegador después de cerrar sesión.
//
// No se revisa el código buscando patrones: se INVOCA cada función HTTP
// declarada en serverless.yml con un evento sin sesión (y el preflight OPTIONS)
// y se mira la respuesta. Una función nueva que arme su respuesta a mano sin la
// cabecera hace fallar esta prueba sin que nadie tenga que acordarse de listarla.

process.env.CAMPO_HMAC_KEY = 'clave-de-prueba-hmac';
process.env.CAMPO_CIFRADO_LOCAL_KEY = require('crypto').randomBytes(32).toString('base64');

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { docClient } = require('../lib/clients/dynamodb');

/** [nombre, archivo, export] de cada función con evento httpApi. */
const funcionesHttp = () => {
    const yml = fs.readFileSync(path.join(__dirname, '..', 'serverless.yml'), 'utf8');
    const f = yml.slice(yml.indexOf('\nfunctions:'), yml.indexOf('\nresources:'));
    const bloques = f.split(/\n {2}(\w+):\n/).slice(1);
    const res = [];
    for (let i = 0; i < bloques.length; i += 2) {
        const cuerpo = bloques[i + 1];
        if (!cuerpo.includes('httpApi')) continue;
        const h = /handler: (\S+)/.exec(cuerpo)[1];
        const punto = h.lastIndexOf('.');
        res.push([bloques[i], h.slice(0, punto), h.slice(punto + 1)]);
    }
    return res;
};

const evento = (metodo) => ({
    version: '2.0', routeKey: `${metodo} /x`, rawPath: '/x', headers: {}, queryStringParameters: {},
    requestContext: { http: { method: metodo, path: '/x', sourceIp: '127.0.0.1' } },
});

const cabecera = (r) => {
    const h = r?.headers || {};
    const k = Object.keys(h).find((x) => x.toLowerCase() === 'cache-control');
    return k ? h[k] : undefined;
};

test('cada función HTTP responde con Cache-Control: no-store, también sin sesión y en OPTIONS', async () => {
    // Sin sesión casi todas responden antes de tocar datos; las que igual leen
    // algo reciben un DynamoDB vacío (nunca el real: `sin-aws.js`).
    const original = docClient.send;
    docClient.send = async () => ({ Items: [], Item: undefined });
    const faltan = [];
    const funciones = funcionesHttp();
    try {
        for (const [nombre, archivo, exp] of funciones) {
            const fn = require(path.join(__dirname, '..', archivo))[exp];
            assert.equal(typeof fn, 'function', `${nombre}: ${archivo}.${exp} no existe`);
            for (const metodo of ['GET', 'OPTIONS']) {
                let r;
                try { r = await fn(evento(metodo)); } catch (err) { r = { error: err.message }; }
                if (cabecera(r) !== 'no-store') faltan.push(`${nombre} ${metodo} → ${r?.statusCode ?? r?.error}`);
            }
        }
    } finally {
        docClient.send = original;
    }
    assert.ok(funciones.length >= 60, `se esperaban las funciones HTTP de serverless.yml, se leyeron ${funciones.length}`);
    assert.deepEqual(faltan, [], 'respuestas sin Cache-Control: no-store');
});
