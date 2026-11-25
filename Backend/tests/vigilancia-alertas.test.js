const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const { revisarSuscriptoresAlertas } = require('../lib/vigilanciaAlertas');

const TOPICO = 'arn:aws:sns:us-east-1:000000000000:BuildAndServe-alertas-operacion-dev';
const yml = fs.readFileSync(path.join(__dirname, '..', 'serverless.yml'), 'utf8');
const script = fs.readFileSync(path.join(__dirname, '..', '..', 'infra', 'desplegar-backend.sh'), 'utf8');

const clienteCon = (atributos, pedidos = []) => ({
    send: async (cmd) => { pedidos.push(cmd.input); return { Attributes: atributos }; },
});

let entorno;
beforeEach(() => {
    entorno = { ...process.env };
    process.env.ALERTAS_TOPIC_ARN = TOPICO;
    process.env.DESTINATARIO_ALERTAS = 'soporte@buildandserve.cl';
    process.env.STAGE = 'dev';
});
afterEach(() => { process.env = entorno; });

const silenciar = async (fn) => {
    const original = console.error;
    console.error = () => {};
    try { return await fn(); } finally { console.error = original; }
};

test('con una suscripción confirmada no avisa a nadie', async () => {
    const correos = [];
    const pedidos = [];
    const r = await revisarSuscriptoresAlertas({ cliente: clienteCon({ SubscriptionsConfirmed: '1', SubscriptionsPending: '0' }, pedidos), enviar: async (m) => { correos.push(m); return { enviado: true }; } });
    assert.deepEqual(r, { confirmadas: 1, pendientes: 0, avisado: false });
    assert.equal(correos.length, 0);
    assert.deepEqual(pedidos, [{ TopicArn: TOPICO }]);
});

test('sin suscripciones confirmadas escribe a soporte por correo directo, con el ambiente, el tópico y cómo arreglarlo', async () => {
    const correos = [];
    const r = await silenciar(() => revisarSuscriptoresAlertas({
        cliente: clienteCon({ SubscriptionsConfirmed: '0', SubscriptionsPending: '1' }),
        enviar: async (m) => { correos.push(m); return { enviado: true }; },
    }));
    assert.deepEqual(r, { confirmadas: 0, pendientes: 1, avisado: true });
    assert.equal(correos.length, 1);
    assert.equal(correos[0].para, 'soporte@buildandserve.cl');
    assert.match(correos[0].asunto, /\[Build & Serve dev\] Las alarmas no le llegan a nadie/);
    assert.ok(correos[0].texto.includes(TOPICO));
    assert.match(correos[0].texto, /pendientes: 1/);
    assert.match(correos[0].texto, /--authenticate-on-unsubscribe true/);
});

test('si la casilla está suprimida en SES, lo dice en vez de darlo por avisado', async () => {
    const r = await silenciar(() => revisarSuscriptoresAlertas({
        cliente: clienteCon({ SubscriptionsConfirmed: '0', SubscriptionsPending: '0' }),
        enviar: async () => ({ enviado: false, suprimida: 'rebote' }),
    }));
    assert.equal(r.avisado, false);
    assert.equal(r.suprimida, 'rebote');
});

test('sin el tópico o la casilla configurados falla en vez de dar todo por bueno', async () => {
    delete process.env.ALERTAS_TOPIC_ARN;
    await assert.rejects(() => revisarSuscriptoresAlertas({ cliente: clienteCon({ SubscriptionsConfirmed: '1' }) }), /ALERTAS_TOPIC_ARN/);
});

test('el aviso diario de estructura revisa el tópico, y si eso falla igual hace lo suyo', async () => {
    const vigilancia = require('../lib/vigilanciaAlertas');
    const estructura = require('../handlers/scheduler/estructura-alertas');
    const degradacion = require('../lib/degradacion');
    const originales = { r: vigilancia.revisarSuscriptoresAlertas, p: estructura.revisarEstructuraPreventiva, f: estructura.revisarEstructuraFaltante, d: degradacion.registrarFallo };
    const fallos = [];
    try {
        estructura.revisarEstructuraPreventiva = async () => ({ avisos: 0 });
        estructura.revisarEstructuraFaltante = async () => ({ avisos: 0 });
        degradacion.registrarFallo = (op) => fallos.push(op);
        const { checkEstructuraAlerts } = require('../handlers/scheduler/handler');

        vigilancia.revisarSuscriptoresAlertas = async () => ({ confirmadas: 0, pendientes: 0, avisado: true });
        const conAviso = await silenciar(() => checkEstructuraAlerts());
        assert.deepEqual(conAviso.suscriptores, { confirmadas: 0, pendientes: 0, avisado: true });

        vigilancia.revisarSuscriptoresAlertas = async () => { throw new Error('SNS no responde'); };
        const conFalla = await silenciar(() => checkEstructuraAlerts());
        assert.equal(conFalla.suscriptores, null);
        assert.deepEqual(conFalla.organos, { avisos: 0 });
        assert.deepEqual(fallos, ['alertas.suscriptores']);
    } finally {
        vigilancia.revisarSuscriptoresAlertas = originales.r;
        estructura.revisarEstructuraPreventiva = originales.p;
        estructura.revisarEstructuraFaltante = originales.f;
        degradacion.registrarFallo = originales.d;
    }
});

test('la función diaria recibe el tópico y la casilla, y puede leer solo ese tópico', () => {
    const inicio = yml.indexOf('  checkEstructuraAlerts:');
    const bloque = yml.slice(inicio, yml.indexOf('\n\n', inicio));
    assert.match(bloque, /ALERTAS_TOPIC_ARN: !Ref AlertasOperacionTopic/);
    assert.match(bloque, /DESTINATARIO_ALERTAS: \$\{self:custom\.destinatarioAlertas\}/);
    assert.match(yml, /- sns:GetTopicAttributes\n\s+Resource:\n\s+- !Ref AlertasOperacionTopic\n/);
    assert.ok(!/sns:GetTopicAttributes[\s\S]{0,80}Resource: "\*"/.test(yml), 'sin permiso sobre todos los tópicos');
});

function correrChequeoDelDespliegue(confirmadas) {
    const inicio = script.indexOf('TOPICO_ALERTAS=');
    const fin = script.indexOf('\n', script.indexOf('echo "== alarmas:'));
    assert.ok(inicio > 0 && fin > inicio, 'el chequeo está en desplegar-backend.sh');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chequeo-alarmas-'));
    fs.writeFileSync(path.join(dir, 'aws'), `#!/bin/sh\ncase "$1 $2" in\n  "cloudformation describe-stack-resource") echo "${TOPICO}" ;;\n  "sns get-topic-attributes") echo "${confirmadas}" ;;\nesac\n`, { mode: 0o755 });
    const r = spawnSync('bash', ['-c', `set -euo pipefail\nSTAGE=dev\n${script.slice(inicio, fin)}`], {
        encoding: 'utf8', env: { ...process.env, PATH: `${dir}:${process.env.PATH}` },
    });
    fs.rmSync(dir, { recursive: true, force: true });
    return r;
}

test('el despliegue del backend termina con error si el tópico de alarmas quedó sin suscriptores', () => {
    const sin = correrChequeoDelDespliegue('0');
    assert.notEqual(sin.status, 0);
    assert.match(sin.stderr, /no tiene suscripciones confirmadas \(0\)/);

    const raro = correrChequeoDelDespliegue('None');
    assert.notEqual(raro.status, 0, 'una respuesta que no es un número no se da por buena');

    const con = correrChequeoDelDespliegue('1');
    assert.equal(con.status, 0, con.stderr);
    assert.match(con.stdout, /== alarmas: 1 suscripción\(es\) confirmada\(s\)/);
    assert.ok(script.indexOf('TOPICO_ALERTAS=') > script.indexOf('echo "Desplegado $SHA'), 'se revisa después de desplegar');
});
