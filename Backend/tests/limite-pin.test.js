// Límite de intentos de PIN (H-2).
//
// Con scrypt, probar los 10.000 PIN de cuatro dígitos ya cuesta minutos de
// tráfico visible en vez de segundos (D-7). Pero visible no es lo mismo que
// bloqueado, y nadie está mirando ese tráfico todavía. Lo que fijan estas
// pruebas es la progresión completa: 1-4 fallos sin castigo, bloqueo desde el
// 5, escalando cada 5, reseteo en el primer acierto, y que un intento mientras
// está bloqueada no cueste ni un cálculo de scrypt.

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const { docClient } = require('../lib/clients/dynamodb');
const { verificarConLimite, verificarConLimiteOLanzar, PinBloqueadoError } = require('../lib/limitePin');

const TENANT = 't-1';
const PERSONA_ID = 'p-1';

let almacen; // ficha de la persona, tal como vive en la tabla
let escrituras;
let original;

beforeEach(() => {
    almacen = { pinIntentosFallidos: 0, pinBloqueadaHasta: null };
    escrituras = [];
    original = docClient.send;
    docClient.send = async (cmd) => {
        const input = cmd.input || {};
        const nombre = cmd.constructor.name;
        escrituras.push({ nombre, input });

        if (nombre === 'UpdateCommand') {
            const expr = input.UpdateExpression;
            const v = input.ExpressionAttributeValues || {};
            if (expr.includes('ADD pinIntentosFallidos')) {
                almacen.pinIntentosFallidos += 1;
                return { Attributes: { pinIntentosFallidos: almacen.pinIntentosFallidos } };
            }
            if (expr.includes('SET pinBloqueadaHasta = :hasta')) {
                almacen.pinBloqueadaHasta = v[':hasta'];
                return {};
            }
            if (expr.includes('REMOVE pinBloqueadaHasta')) {
                almacen.pinBloqueadaHasta = null;
                almacen.pinIntentosFallidos = 0;
                return {};
            }
        }
        return {};
    };
});

afterEach(() => { docClient.send = original; });

const persona = () => ({ tenantId: TENANT, personaId: PERSONA_ID, _pinHash: 'hash-de-prueba', ...almacen });

/** Simula N verificaciones fallidas seguidas, refrescando la ficha entre cada
 *  una (como hace cada llamador real: `getById` justo antes de verificar). */
const fallarNVeces = async (n) => {
    let ultimo;
    for (let i = 0; i < n; i++) {
        // Cada iteración simula que el bloqueo anterior, si lo hubo, ya
        // expiró: lo que se está probando es la progresión del CONTADOR, no
        // el rechazo durante un bloqueo (eso lo cubre otra prueba).
        almacen.pinBloqueadaHasta = null;
        ultimo = await verificarConLimite(persona(), '0000', async () => false);
    }
    return ultimo;
};

// ─── La progresión ───────────────────────────────────────────────────────────

test('1 a 4 fallos: no bloquea, solo cuenta', async () => {
    for (let i = 1; i <= 4; i++) {
        const r = await verificarConLimite(persona(), '0000', async () => false);
        assert.equal(r.ok, false);
        assert.equal(r.bloqueada, false, `fallo ${i} no debería bloquear`);
        assert.equal(r.mensaje, 'PIN incorrecto');
    }
    assert.equal(almacen.pinIntentosFallidos, 4);
    assert.equal(almacen.pinBloqueadaHasta, null);
});

test('el 5º fallo bloquea 1 minuto', async () => {
    const r = await fallarNVeces(5);

    assert.equal(r.bloqueada, true);
    const segundos = (new Date(r.hasta) - Date.now()) / 1000;
    assert.ok(segundos > 55 && segundos <= 60, `esperaba ~60s, dio ${segundos}`);
});

test('el 10º fallo bloquea 5 minutos', async () => {
    const r = await fallarNVeces(10);
    const segundos = (new Date(r.hasta) - Date.now()) / 1000;
    assert.ok(segundos > 295 && segundos <= 300, `esperaba ~300s, dio ${segundos}`);
});

test('el 15º fallo bloquea 15 minutos', async () => {
    const r = await fallarNVeces(15);
    const segundos = (new Date(r.hasta) - Date.now()) / 1000;
    assert.ok(segundos > 895 && segundos <= 900, `esperaba ~900s, dio ${segundos}`);
});

test('el 20º fallo bloquea 60 minutos, y ahí queda el tope', async () => {
    const r20 = await fallarNVeces(20);
    let segundos = (new Date(r20.hasta) - Date.now()) / 1000;
    assert.ok(segundos > 3595 && segundos <= 3600, `esperaba ~3600s, dio ${segundos}`);

    // Simula que el bloqueo ya venció, y sigue al 25º: mismo tope.
    almacen.pinBloqueadaHasta = new Date(Date.now() - 1000).toISOString();
    const r25 = await fallarNVeces(5);
    segundos = (new Date(r25.hasta) - Date.now()) / 1000;
    assert.ok(segundos > 3595 && segundos <= 3600, 'el tope no sigue subiendo pasado el 4º nivel');
});

// ─── Mientras está bloqueada ──────────────────────────────────────────────────

test('un intento durante el bloqueo no corre scrypt ni toca el contador', async () => {
    await fallarNVeces(5); // bloquea
    const escriturasAntes = escrituras.length;

    let sePidioVerificar = false;
    const r = await verificarConLimite(persona(), '0000', async () => { sePidioVerificar = true; return false; });

    assert.equal(r.bloqueada, true);
    assert.equal(sePidioVerificar, false, 'no debe correr scrypt estando bloqueada');
    assert.equal(escrituras.length, escriturasAntes, 'no debe escribir nada nuevo');
    assert.equal(almacen.pinIntentosFallidos, 5, 'el contador no avanza mientras está bloqueada');
});

test('el mensaje de bloqueo dice cuánto falta, sin ocultar nada', async () => {
    const r = await fallarNVeces(5);
    assert.match(r.mensaje, /bloqueada temporalmente/i);
    assert.match(r.mensaje, /\d+ minutos?/);
});

// ─── Reseteo en el primer acierto ─────────────────────────────────────────────

test('un PIN correcto resetea el contador', async () => {
    await fallarNVeces(4);
    assert.equal(almacen.pinIntentosFallidos, 4);

    const r = await verificarConLimite(persona(), '1234', async () => true);

    assert.equal(r.ok, true);
    assert.equal(almacen.pinIntentosFallidos, 0);
    assert.equal(almacen.pinBloqueadaHasta, null);
});

test('un PIN correcto no se puede probar mientras está bloqueada', async () => {
    await fallarNVeces(5);

    let sePidioVerificar = false;
    const r = await verificarConLimite(persona(), '1234', async () => { sePidioVerificar = true; return true; });

    assert.equal(r.ok, false, 'ni siquiera el PIN correcto entra durante el bloqueo');
    assert.equal(sePidioVerificar, false);
});

// ─── El envoltorio que lanza (PersonaService) ─────────────────────────────────

test('verificarConLimiteOLanzar lanza PinBloqueadoError con 423', async () => {
    await fallarNVeces(4);

    await assert.rejects(
        () => verificarConLimiteOLanzar(persona(), '0000', async () => false),
        (err) => {
            assert.ok(err instanceof PinBloqueadoError);
            assert.equal(err.codigo, 'PIN_BLOQUEADO');
            assert.equal(err.statusCode, 423);
            assert.match(err.message, /minutos?/);
            return true;
        },
    );
});

test('verificarConLimiteOLanzar no lanza si el PIN es solo incorrecto (no bloqueada)', async () => {
    const ok = await verificarConLimiteOLanzar(persona(), '0000', async () => false);
    assert.equal(ok, false);
});

// ─── La escritura usa la clave real de la tabla de personas ──────────────────

test('las escrituras usan PK/SK de personas, no un esquema inventado', async () => {
    await fallarNVeces(1);

    const escritura = escrituras.find((e) => e.nombre === 'UpdateCommand');
    assert.deepEqual(escritura.input.Key, { PK: `TENANT#${TENANT}`, SK: `PERSONA#${PERSONA_ID}` });
});

// ─── Métrica: separada de FallosDependencia, y solo en el momento del bloqueo ──

test('el bloqueo deja constancia medible, distinta de FALLO_DEPENDENCIA', async () => {
    const registrado = [];
    const original2 = console.error;
    console.error = (...a) => registrado.push(a.join(' '));

    await fallarNVeces(4);
    assert.equal(registrado.length, 0, 'antes del 5º fallo no hay nada que registrar');

    await fallarNVeces(1); // 5º
    console.error = original2;

    assert.equal(registrado.length, 1);
    assert.match(registrado[0], /PIN_BLOQUEADO/);
    assert.doesNotMatch(registrado[0], /FALLO_DEPENDENCIA/);
    const json = JSON.parse(registrado[0].replace('PIN_BLOQUEADO ', ''));
    assert.equal(json.PinBloqueado, 1);
    assert.equal(json._aws.CloudWatchMetrics[0].Namespace, 'BuildAndServe');
    assert.equal(json._aws.CloudWatchMetrics[0].Metrics[0].Name, 'PinBloqueado');
    // Sin dimensión por persona: la alarma agrega a nivel de empresa/stage.
    assert.deepEqual(json._aws.CloudWatchMetrics[0].Dimensions, [['stage']]);
});

test('un fallo que no cruza un múltiplo de 5 no emite métrica', async () => {
    const registrado = [];
    const original2 = console.error;
    console.error = (...a) => registrado.push(a.join(' '));

    await fallarNVeces(3);

    console.error = original2;
    assert.equal(registrado.length, 0);
});

// ─── Integración: los cuatro puntos reales, de punta a punta ─────────────────
//
// Lo de arriba prueba el módulo aislado. Esto prueba que quedó ENGANCHADO en
// los cuatro lugares que verifican un PIN: que llegar al 5º intento fallido por
// cualquiera de ellos responde 423, y no un 401 más.

const vales = require('../handlers/vales/handler');
const firmas = require('../handlers/signatures/handler');
const personas = require('../handlers/personas-module/handler');

const TENANT_INT = 't-empresa-a';
const PERSONA_INT = 'p-trabajador';

const fichaBase = () => ({
    PK: `TENANT#${TENANT_INT}`, SK: `PERSONA#${PERSONA_INT}`,
    personaId: PERSONA_INT, tenantId: TENANT_INT,
    rut: '12.345.678-5', nombre: 'Juan', apellido: 'Pérez', cargo: 'Maestro',
    rol: 'trabajador', estado: 'activo', habilitado: true,
    pinHash: 'hash-invalido-a-propósito', // cualquier PIN da "incorrecto"
    pinIntentosFallidos: 0, pinBloqueadaHasta: null,
});

const sesionInt = (extra = {}) => ({
    requestContext: {
        http: { method: 'POST' },
        authorizer: { lambda: {
            sessionId: 's-1', personaId: PERSONA_INT, tenantId: TENANT_INT,
            rol: 'trabajador', permisos: 'firmas.crear',
            ...extra,
        } },
    },
});

/** Monta un doble mínimo: una sola ficha de persona que vive en `estado`, y
 *  las escrituras de contador/bloqueo actualizan esa misma ficha, tal como
 *  hace la tabla real (mismo PK/SK). */
const montarDobleIntegracion = () => {
    const estado = { ficha: fichaBase() };
    const anterior = docClient.send;
    docClient.send = async (cmd) => {
        const nombre = cmd.constructor.name;
        const input = cmd.input || {};
        if (nombre === 'QueryCommand') return { Items: [{ PK: estado.ficha.PK, SK: estado.ficha.SK }] };
        if (nombre === 'GetCommand') return { Item: { ...estado.ficha } };
        if (nombre === 'UpdateCommand') {
            const expr = input.UpdateExpression;
            const v = input.ExpressionAttributeValues || {};
            if (expr.includes('ADD pinIntentosFallidos')) {
                estado.ficha.pinIntentosFallidos = (estado.ficha.pinIntentosFallidos || 0) + 1;
                return { Attributes: { pinIntentosFallidos: estado.ficha.pinIntentosFallidos } };
            }
            if (expr.includes('SET pinBloqueadaHasta = :hasta')) {
                estado.ficha.pinBloqueadaHasta = v[':hasta'];
                return {};
            }
            if (expr.includes('REMOVE pinBloqueadaHasta')) {
                estado.ficha.pinBloqueadaHasta = null;
                estado.ficha.pinIntentosFallidos = 0;
                return {};
            }
        }
        return {};
    };
    return { estado, restaurar: () => { docClient.send = anterior; } };
};

test('POST /firmas/vales: el 5º PIN incorrecto responde 423, no 401', async () => {
    const { restaurar } = montarDobleIntegracion();
    let ultimo;
    for (let i = 0; i < 5; i++) {
        ultimo = await vales.emitir({
            ...sesionInt(),
            body: JSON.stringify({ pin: '0000', cantidad: 1 }),
        });
    }
    restaurar();

    assert.equal(ultimo.statusCode, 423);
    assert.match(JSON.parse(ultimo.body).error, /bloqueada temporalmente/i);
});

test('POST /signatures: el 5º PIN incorrecto responde 423', async () => {
    const { restaurar } = montarDobleIntegracion();
    let ultimo;
    for (let i = 0; i < 5; i++) {
        ultimo = await firmas.create({
            ...sesionInt(),
            body: JSON.stringify({ personaId: PERSONA_INT, pin: '0000', requestId: 'r-1' }),
        });
    }
    restaurar();

    assert.equal(ultimo.statusCode, 423);
});

test('POST /personas/{id}/set-pin: el 5º pinActual incorrecto responde 423, no 500', async () => {
    const { estado, restaurar } = montarDobleIntegracion();
    estado.ficha.pinHash = 'algo'; // yaTienePin = true, exige pinActual
    let ultimo;
    for (let i = 0; i < 5; i++) {
        ultimo = await personas.personasHandler({
            requestContext: {
                http: { method: 'POST' },
                authorizer: { lambda: {
                    sessionId: 's-1', personaId: PERSONA_INT, tenantId: TENANT_INT,
                    rol: 'trabajador', permisos: 'personas.ver',
                } },
            },
            rawPath: `/personas/${PERSONA_INT}/set-pin`,
            body: JSON.stringify({ pin: '9999', pinActual: '0000' }),
        });
    }
    restaurar();

    // No 500: el catch específico de PIN_BLOQUEADO tiene que ganarle al catch
    // genérico del handler, que convertiría esto en un error de servidor.
    assert.equal(ultimo.statusCode, 423);
});
