// PIN de 6 dígitos (8 de noviembre de 2026).
//
// Para firmar y para pedir vales solo se acepta un PIN de 6. Uno de 4 —el de
// antes— solo sirve para cambiarlo: fuera de eso ni siquiera se compara con el
// guardado (no es un oráculo del PIN viejo) ni cuenta como intento, y la
// respuesta dice qué hacer (409, PIN_DEBE_CAMBIAR).

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

test('el formato: 6 dígitos', async () => {
    assert.equal(LARGO_PIN, 6);
    assert.equal(validatePin('123456').valid, true);
    for (const malo of ['1234', '12345', '1234567', '12345a', '', null]) assert.equal(validatePin(malo).valid, false, String(malo));
    await assert.rejects(hashPin('1234', 'p1'));
    assert.match(await hashPin('123456', 'p1'), /\S/);
});

test('un PIN de 4 para firmar: no se compara, no cuenta, y dice que hay que cambiarlo', async () => {
    let comparado = false;
    const r = await limite.verificarConLimite(persona(), '4821', async () => { comparado = true; return true; });
    assert.equal(comparado, false, 'ni con el PIN de 4 correcto: no se compara');
    assert.equal(escrituras.length, 0, 'no cuenta como intento');
    assert.deepEqual([r.ok, r.debeCambiar, r.bloqueada], [false, true, false]);
    assert.match(r.mensaje, /6 dígitos/);
    await assert.rejects(limite.verificarConLimiteOLanzar(persona(), '4821', async () => true),
        (e) => e.codigo === 'PIN_DEBE_CAMBIAR' && e.statusCode === 409);
});

test('para cambiarlo, el de 4 sí se compara', async () => {
    let comparado = null;
    const r = await limite.verificarConLimite(persona(), '4821', async (pin) => { comparado = pin; return true; }, { permitirAnterior: true });
    assert.equal(comparado, '4821');
    assert.equal(r.ok, true);
});

test('lo que no es un PIN no llega a compararse ni cuenta', async () => {
    for (const malo of ['12345', 'abcdef', '', undefined, 123456]) {
        let comparado = false;
        const r = await limite.verificarConLimite(persona(), malo, async () => { comparado = true; return true; }, { permitirAnterior: true });
        assert.equal(comparado, false, String(malo));
        assert.equal(r.ok, false);
        assert.equal(r.debeCambiar, false);
    }
    assert.equal(escrituras.length, 0);
});

test('un PIN de 6 sigue el camino de siempre: se compara y el fallo cuenta', async () => {
    const r = await limite.verificarConLimite(persona(), '000000', async () => false);
    assert.equal(r.ok, false);
    assert.ok(escrituras.some((i) => /ADD pinIntentosFallidos/.test(i.UpdateExpression)));
});

test('estando bloqueada, ni un PIN de 4 dice otra cosa que el bloqueo', async () => {
    const p = { ...persona(), pinBloqueadaHasta: new Date(Date.now() + 60000).toISOString() };
    const r = await limite.verificarConLimite(p, '4821', async () => true);
    assert.equal(r.bloqueada, true);
});

test('todas las rutas que firman con PIN responden 409 a PIN_DEBE_CAMBIAR', () => {
    const leer = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
    for (const [archivo, n] of [
        [['handlers', 'activities', 'handler.js'], 1],
        [['handlers', 'documents', 'handler.js'], 2],
        [['handlers', 'surveys', 'handler.js'], 1],
        [['handlers', 'obras-module', 'handler.js'], 2],
        [['handlers', 'personas-module', 'handler.js'], 1],
    ]) {
        const s = leer(...archivo);
        assert.equal((s.match(/codigo === 'PIN_DEBE_CAMBIAR'\) return error\(\w+\.message, 409\)/g) || []).length, n, archivo.join('/'));
        assert.equal((s.match(/codigo === 'PIN_BLOQUEADO'\) return error/g) || []).length, n, `${archivo.join('/')}: cada sitio del bloqueo tiene también el de cambiar`);
    }
    assert.match(leer('handlers', 'personas-module', 'handler.js'), /PIN_DEBE_CAMBIAR: 409/);
    for (const archivo of [['handlers', 'vales', 'handler.js'], ['handlers', 'signatures', 'handler.js']]) {
        assert.match(leer(...archivo), /chequeo\.bloqueada \? 423 : \(chequeo\.debeCambiar \? 409 : 400\)/, archivo.join('/'));
    }
});

test('la ficha dice si hay que cambiar el PIN', () => {
    const { Persona } = require('../lib/models/Persona');
    const base = { personaId: 'p1', tenantId: 't1', nombre: 'R' };
    assert.equal(new Persona({ ...base, pinHash: 'h' }).toSafeFormat().pinDebeCambiar, true, 'de 4, de antes');
    assert.equal(new Persona({ ...base, pinHash: 'h', pinLargo: 6 }).toSafeFormat().pinDebeCambiar, false);
    assert.equal(new Persona({ ...base }).toSafeFormat().pinDebeCambiar, false, 'sin PIN no hay que cambiar nada');
    assert.match(fs.readFileSync(path.join(__dirname, '..', 'lib', 'models', 'Persona.js'), 'utf8'), /pinLargo: this\.pinLargo,/, 'se guarda con la ficha');
});
