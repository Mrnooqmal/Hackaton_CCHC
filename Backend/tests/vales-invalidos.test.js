// Vales inválidos presentados a nombre de una persona: al quinto se anulan los suyos.
//
// En el equipo, los vales quedan cifrados con una llave derivada del PIN, sin
// etiqueta de verificación y con un byte de comprobación. Quien copie el
// almacenamiento descarta PIN fuera de la app, pero le quedan candidatos que
// solo puede confirmar presentando vales aquí. Este servidor es el único que
// sabe si un vale existe, y por eso es quien pone el tope.
//
// Con el doble de tablas de esquemas reales: las condiciones se evalúan como en
// DynamoDB (la de `attribute_exists(PK)` es la que impide contar para una persona
// de otra empresa o inventada).

process.env.CAMPO_HMAC_KEY = 'clave-de-prueba-hmac';
process.env.CAMPO_CIFRADO_LOCAL_KEY = require('crypto').randomBytes(32).toString('base64');

const { prepararEntorno, crearDobleTablas } = require('./doble-dynamo-tablas');
const esquemas = prepararEntorno();

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { PutCommand } = require('@aws-sdk/lib-dynamodb');

const { docClient } = require('../lib/clients/dynamodb');
const {
    ValeFirmaService, MAX_VALES_INVALIDOS, MOTIVO_VALES_INVALIDOS, MOTIVOS,
} = require('../lib/services/ValeFirmaService');
const { FirmaService } = require('../lib/services/FirmaService');

const A = 't-A';
const B = 't-B';
const OBRA = 'o-1';
let doble;

const persona = (personaId, tenantId) => ({
    PK: `TENANT#${tenantId}`, SK: `PERSONA#${personaId}`, personaId, tenantId,
    nombre: 'Rosa', apellido: 'Díaz', habilitado: true, cargo: 'Jornal',
});

beforeEach(async () => {
    doble = crearDobleTablas(docClient, esquemas, { proyecciones: true });
    for (const p of [persona('p-1', A), persona('p-2', A), persona('p-9', B)]) {
        await docClient.send(new PutCommand({ TableName: 'PERSONAS_TABLE', Item: p }));
    }
});
afterEach(() => doble.restaurar());

const fila = (personaId, tenantId) => doble.items('PERSONAS_TABLE').find((x) => x.personaId === personaId && x.tenantId === tenantId);
const basura = () => crypto.randomBytes(32).toString('hex');
const valesDe = (personaId) => doble.items('VALES_TABLE').filter((v) => v.personaId === personaId);

const firmar = (personaId, vale, n) => FirmaService.crear({
    personaId, tenantId: A, obraId: OBRA, metodo: 'VALE',
    credencial: { vale, deviceId: 'equipo-1', timestampLocal: new Date().toISOString(), idFirmaLocal: `local-${n}` },
    tipoFirma: 'trabajador', referenciaId: `d-${n}`, referenciaTipo: 'document',
    persona: { ...persona(personaId, A) },
});

test('cuatro vales inválidos solo cuentan; al quinto se anulan los vigentes de esa persona', async () => {
    const { vales } = await ValeFirmaService.emitir({ personaId: 'p-1', tenantId: A, obraId: OBRA });
    await ValeFirmaService.emitir({ personaId: 'p-2', tenantId: A, obraId: OBRA });
    // Uno gastado antes: queda como estaba (la firma ya existe).
    assert.equal((await ValeFirmaService.consumir({ vale: vales[0], personaId: 'p-1', tenantId: A, obraId: OBRA })).ok, true);

    for (let i = 1; i < MAX_VALES_INVALIDOS; i += 1) {
        const r = await ValeFirmaService.consumir({ vale: basura(), personaId: 'p-1', tenantId: A, obraId: OBRA });
        assert.deepEqual([r.ok, r.motivo, r.anulados], [false, MOTIVOS.NO_EXISTE, false]);
    }
    assert.equal(fila('p-1', A).valesInvalidos, 4);
    assert.ok(valesDe('p-1').every((v) => !v.revocadoEn), 'antes del quinto no se anula nada');

    const quinto = await ValeFirmaService.consumir({ vale: basura(), personaId: 'p-1', tenantId: A, obraId: OBRA });
    assert.equal(quinto.anulados, true);
    const propios = valesDe('p-1');
    assert.equal(propios.filter((v) => v.motivoRevocacion === MOTIVO_VALES_INVALIDOS).length, 4, 'los 4 vigentes');
    assert.ok(propios.find((v) => v.usedAt && !v.revocadoEn), 'el gastado no se toca');
    assert.ok(valesDe('p-2').every((v) => !v.revocadoEn), 'los de otra persona, intactos');
    assert.equal(fila('p-2', A).valesInvalidos, 0);
});

test('después de anular, un vale que era bueno se rechaza diciendo por qué', async () => {
    const { vales } = await ValeFirmaService.emitir({ personaId: 'p-1', tenantId: A, obraId: OBRA });
    for (let i = 0; i < MAX_VALES_INVALIDOS - 1; i += 1) {
        await assert.rejects(firmar('p-1', basura(), i), (e) => e.codigo === 'VALE_RECHAZADO' && /no es válido\.$/.test(e.message));
    }
    await assert.rejects(firmar('p-1', basura(), 9), (e) => e.codigo === 'VALE_RECHAZADO' && /se anularon las firmas sin conexión/.test(e.message));
    await assert.rejects(firmar('p-1', vales[1], 10), (e) => e.codigo === 'VALE_RECHAZADO' && /intentos con vales inválidos/.test(e.message));
});

test('un vale bueno antes del corte entra, y no regala intentos: el contador sigue', async () => {
    const { vales } = await ValeFirmaService.emitir({ personaId: 'p-1', tenantId: A, obraId: OBRA });
    for (let i = 0; i < 3; i += 1) await ValeFirmaService.consumir({ vale: basura(), personaId: 'p-1', tenantId: A, obraId: OBRA });
    const bueno = await firmar('p-1', vales[0], 1);
    assert.ok(bueno.signatureId, 'la firma con un vale válido entra');
    assert.equal(fila('p-1', A).valesInvalidos, 3, 'acertar no reinicia el contador');
    await ValeFirmaService.consumir({ vale: basura(), personaId: 'p-1', tenantId: A, obraId: OBRA });
    const quinto = await ValeFirmaService.consumir({ vale: basura(), personaId: 'p-1', tenantId: A, obraId: OBRA });
    assert.equal(quinto.anulados, true);
});

test('emitir vales nuevos (que exige el PIN con red) vuelve el contador a cero', async () => {
    for (let i = 0; i < 4; i += 1) await ValeFirmaService.consumir({ vale: basura(), personaId: 'p-1', tenantId: A, obraId: OBRA });
    await ValeFirmaService.emitir({ personaId: 'p-1', tenantId: A, obraId: OBRA });
    assert.equal(fila('p-1', A).valesInvalidos, 0);
    const r = await ValeFirmaService.consumir({ vale: basura(), personaId: 'p-1', tenantId: A, obraId: OBRA });
    assert.equal(r.anulados, false, 'empieza de nuevo: el siguiente es el primero');
});

test('no se cuenta para una persona de otra empresa ni para una inventada, y no se crean filas', async () => {
    const antes = doble.items('PERSONAS_TABLE').length;
    await ValeFirmaService.emitir({ personaId: 'p-9', tenantId: B, obraId: OBRA });
    for (let i = 0; i < MAX_VALES_INVALIDOS; i += 1) {
        await ValeFirmaService.consumir({ vale: basura(), personaId: 'p-9', tenantId: A, obraId: OBRA });
        await ValeFirmaService.consumir({ vale: basura(), personaId: 'p-inventada', tenantId: A, obraId: OBRA });
    }
    assert.equal(doble.items('PERSONAS_TABLE').length, antes, 'sin filas fantasma');
    assert.equal(fila('p-9', B).valesInvalidos, 0, 'la sesión de la empresa A no toca a la persona de B');
    assert.ok(valesDe('p-9').every((v) => !v.revocadoEn));
});

test('sin empresa no se cuenta (nunca se adivina la empresa)', async () => {
    const r = await ValeFirmaService.registrarInvalido({ personaId: 'p-1', tenantId: null });
    assert.deepEqual(r, { invalidos: 0, anulados: false });
    assert.equal(fila('p-1', A).valesInvalidos, undefined);
});
