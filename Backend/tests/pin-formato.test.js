// El PIN es de 4 dígitos (volvió de 6 el 9 de noviembre de 2026: D-35).
//
// Lo que no tiene ese formato ni se compara con el guardado ni cuenta como
// intento, y un PIN equivocado responde 400, nunca 401: el cliente lee todo 401
// como sesión vencida y cerraba la sesión de quien firmaba.

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { docClient } = require('../lib/clients/dynamodb');
const limite = require('../lib/limitePin');
const { validatePin, hashPin, LARGO_PIN } = require('../lib/utils/validation');

let escrituras;
let original;
beforeEach(() => {
    escrituras = [];
    original = docClient.send;
    docClient.send = async (cmd) => {
        escrituras.push(cmd.input);
        return { Attributes: { pinIntentosFallidos: 1 } };
    };
});
afterEach(() => { docClient.send = original; });

const persona = () => ({ tenantId: 't1', personaId: 'p1', _pinHash: 'h', pinIntentosFallidos: 0, pinBloqueadaHasta: null });

test('el formato: 4 dígitos', async () => {
    assert.equal(LARGO_PIN, 4);
    assert.equal(validatePin('1234').valid, true);
    for (const malo of ['123', '12345', '123456', '12a4', '', null]) assert.equal(validatePin(malo).valid, false, String(malo));
    await assert.rejects(hashPin('123456', 'p1'));
    assert.match(await hashPin('1234', 'p1'), /\S/);
});

test('lo que no es un PIN de 4 no se compara ni cuenta como intento', async () => {
    for (const malo of ['123', '482915', 'abcd', '', undefined, 1234]) {
        let comparado = false;
        const r = await limite.verificarConLimite(persona(), malo, async () => { comparado = true; return true; });
        assert.equal(comparado, false, String(malo));
        assert.equal(r.ok, false);
    }
    assert.equal(escrituras.length, 0);
});

test('un PIN de 4 sigue el camino de siempre: se compara y el fallo cuenta', async () => {
    const r = await limite.verificarConLimite(persona(), '0000', async () => false);
    assert.equal(r.ok, false);
    assert.ok(escrituras.some((i) => /ADD pinIntentosFallidos/.test(i.UpdateExpression)));
});

test('un PIN equivocado no es una sesión vencida: ninguna ruta responde 401 por eso', () => {
    const leer = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
    for (const archivo of [['handlers', 'vales', 'handler.js'], ['handlers', 'signatures', 'handler.js']]) {
        assert.match(leer(...archivo), /chequeo\.bloqueada \? 423 : 400/, archivo.join('/'));
    }
    assert.match(leer('handlers', 'personas-module', 'handler.js'), /PIN_ACTUAL_INCORRECTO: 400/);
    assert.ok(!/PIN_DEBE_CAMBIAR/.test(leer('handlers', 'personas-module', 'handler.js')), 'el cambio obligatorio ya no existe');
});

// ─── Ataque lento (D-35): más de 3 bloqueos de una persona en 24 horas ───────

test('al cuarto bloqueo en 24 horas se emite la métrica; al tercero no; lo viejo no cuenta; nunca el PIN', async () => {
    const lineas = [];
    const previo = console.error;
    console.error = (...a) => lineas.push(a.join(' '));
    const hace = (h) => new Date(Date.now() - h * 3600000).toISOString();
    try {
        // Tres bloqueos recientes + este = cuarto.
        let p = { ...persona(), pinBloqueos: [hace(20), hace(10), hace(2)] };
        docClient.send = async (cmd) => { escrituras.push(cmd.input); return { Attributes: { pinIntentosFallidos: 5 } }; };
        await limite.verificarConLimite(p, '0000', async () => false);
        const linea = lineas.find((l) => l.startsWith('PIN_BLOQUEOS_24H '));
        assert.ok(linea, 'al cuarto, la métrica');
        const emf = JSON.parse(linea.slice('PIN_BLOQUEOS_24H '.length));
        assert.equal(emf.PinBloqueosPersona, 1);
        assert.equal(emf.bloqueos24h, 4);
        assert.deepEqual(emf._aws.CloudWatchMetrics[0].Metrics, [{ Name: 'PinBloqueosPersona', Unit: 'Count' }]);
        assert.ok(!linea.includes('0000'), 'la métrica no lleva el PIN');
        const escrito = escrituras.find((i) => /SET pinBloqueos = :lista/.test(i.UpdateExpression || ''));
        assert.ok(escrito, 'los bloqueos quedan en la ficha');
        assert.ok(JSON.stringify(escrito.ExpressionAttributeValues[':lista']).split('"').every((x) => !/^0000$/.test(x)), 'solo fechas');

        // Dos recientes y uno de hace 30 horas: este es el tercero, sin métrica.
        lineas.length = 0;
        p = { ...persona(), pinBloqueos: [hace(30), hace(10), hace(2)] };
        await limite.verificarConLimite(p, '0000', async () => false);
        assert.ok(!lineas.some((l) => l.startsWith('PIN_BLOQUEOS_24H ')), 'tres en 24 horas todavía se tolera');
    } finally {
        console.error = previo;
    }
    assert.equal(limite.BLOQUEOS_TOLERADOS, 3);
});

test('un PIN correcto NO borra la historia de bloqueos de 24 horas', () => {
    const s = fs.readFileSync(path.join(__dirname, '..', 'lib', 'limitePin.js'), 'utf8');
    const limpiar = s.slice(s.indexOf('async function limpiar'), s.indexOf('module.exports'));
    assert.ok(!limpiar.includes('pinBloqueos'), 'limpiar no toca pinBloqueos');
});

test('la alarma del ataque lento existe, con umbral 1 sobre PinBloqueosPersona', () => {
    const yml = fs.readFileSync(path.join(__dirname, '..', 'serverless.yml'), 'utf8');
    const b = yml.slice(yml.indexOf('    PinAtaqueLentoAlarm:'), yml.indexOf('    ValesInvalidosAlarm:'));
    assert.match(b, /MetricName: PinBloqueosPersona/);
    assert.match(b, /Threshold: 1\n/);
    assert.match(b, /Value: \$\{self:provider\.stage\}/);
    assert.match(b, /TreatMissingData: notBreaching/);
});
