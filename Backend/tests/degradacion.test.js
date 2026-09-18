// Un fallo de lectura no puede convertirse en una afirmación.
//
// El sistema tiene respuestas deliberadamente opacas —la recuperación de
// contraseña contesta siempre lo mismo, la pertenencia contesta 404, el
// autorizador niega ante la duda— y eso está bien. El problema es que un fallo
// REAL se ve igual que el caso previsto, y ya nos costó una caída silenciosa.
//
// La frontera que fijan estas pruebas:
//
//   - donde el valor neutro solo empobrece la respuesta, se degrada y se DEJA
//     CONSTANCIA medible;
//   - donde el valor neutro AFIRMA algo falso —"no corresponde comité", "ese
//     código está libre", "ese RUT no está repetido"—, el error se propaga y la
//     operación falla. Es preferible no poder calcular a calcular mal.

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const { conNeutro, registrarFallo, NOMBRE_METRICA } = require('../lib/degradacion');

let registrado;
let errorOriginal;

beforeEach(() => {
    registrado = [];
    errorOriginal = console.error;
    console.error = (...args) => { registrado.push(args.join(' ')); };
});

afterEach(() => { console.error = errorOriginal; });

const fallo = () => { throw new Error('DynamoDB no responde'); };

// ─── El marcador ─────────────────────────────────────────────────────────────

test('degradar deja el valor neutro y una constancia medible', async () => {
    const valor = await conNeutro('prueba.lectura', fallo, null);

    assert.equal(valor, null, 'hacia afuera, el comportamiento no cambia');
    assert.equal(registrado.length, 1);
    assert.match(registrado[0], /FALLO_DEPENDENCIA/);
});

test('la constancia se emite como métrica, no solo como texto', async () => {
    // Formato de métrica embebida: CloudWatch la convierte en métrica sin que
    // haya que declarar un filtro por cada uno de los 72 grupos de log.
    await conNeutro('prueba.lectura', fallo, []);

    const json = JSON.parse(registrado[0].replace('FALLO_DEPENDENCIA ', ''));
    assert.equal(json[NOMBRE_METRICA], 1);
    assert.equal(json.operacion, 'prueba.lectura');
    assert.equal(json._aws.CloudWatchMetrics[0].Namespace, 'BuildAndServe');
    assert.equal(json._aws.CloudWatchMetrics[0].Metrics[0].Name, NOMBRE_METRICA);
    assert.match(json.mensaje, /DynamoDB no responde/);
});

test('cuando no falla nada, no se registra nada', async () => {
    const valor = await conNeutro('prueba.lectura', async () => 'resultado', null);

    assert.equal(valor, 'resultado');
    assert.equal(registrado.length, 0);
});

test('registrar un fallo nunca puede romper la operación que protege', () => {
    const circular = {};
    circular.yo = circular; // JSON.stringify sobre esto lanza

    assert.doesNotThrow(() => registrarFallo('prueba', new Error('x'), { circular }));
});

// ─── Donde el valor neutro mentiría: se propaga ──────────────────────────────

test('la dotación no se calcula si no se puede leer el personal', async () => {
    // Es el peor caso encontrado: con la lista de personas vacía por un fallo de
    // lectura, la completitud concluía que no corresponde comité paritario y lo
    // mostraba en verde en la pantalla con la que la empresa acredita.
    const { docClient } = require('../lib/clients/dynamodb');
    const estructura = require('../handlers/estructura-module/handler');

    const original = docClient.send;
    docClient.send = async (cmd) => {
        if (cmd.constructor.name === 'QueryCommand') throw new Error('DynamoDB no responde');
        return {};
    };

    const res = await estructura.estructuraHandler({
        requestContext: {
            authorizer: { lambda: { sessionId: 's', personaId: 'p', tenantId: 't-1', rol: 'admin', permisos: 'empresa.ver' } },
            http: { method: 'GET' },
        },
        rawPath: '/estructura/completitud',
        queryStringParameters: { ambito: 'empresa' },
    });
    docClient.send = original;

    assert.equal(res.statusCode, 500, 'falla en vez de responder un cumplimiento inventado');
    assert.doesNotMatch(res.body, /"progreso"/, 'no devuelve avance calculado sobre datos incompletos');
});

test('el código de obra duplicado no pasa por un fallo de lectura', async () => {
    const { ObraService } = require('../lib/services/ObraService');
    const servicio = new ObraService();
    const original = servicio.dynamo.send;
    servicio.dynamo.send = async () => { throw new Error('DynamoDB no responde'); };

    await assert.rejects(
        () => servicio.crear('t-1', { nombre: 'Obra Norte', codigo: 'OBRA-001' }),
        /DynamoDB no responde/,
        'sin poder comprobar la unicidad, no se crea la obra',
    );
    servicio.dynamo.send = original;
});

test('la carga masiva no corre si no puede saber qué RUT ya existen', async () => {
    // Con la nómina existente vacía por un fallo, la carga crearía duplicados de
    // gente ya registrada, en silencio y en lote.
    const { docClient } = require('../lib/clients/dynamodb');
    const personas = require('../handlers/personas-module/handler');

    const original = docClient.send;
    docClient.send = async () => { throw new Error('DynamoDB no responde'); };

    const res = await personas.personasHandler({
        requestContext: {
            authorizer: { lambda: { sessionId: 's', personaId: 'p', tenantId: 't-1', rol: 'admin', permisos: 'personas.crear' } },
            http: { method: 'POST' },
        },
        rawPath: '/personas/carga-masiva/confirmar',
        body: JSON.stringify({ filas: [{ filaExcel: 2, rut: '12.345.678-5', nombre: 'Juan', rol: 'Persona trabajadora' }] }),
    });
    docClient.send = original;

    assert.equal(res.statusCode, 500);
});
