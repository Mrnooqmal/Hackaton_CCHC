// Sobre de firma sin conexión (D-36): sin señal siempre se puede firmar.
//
// Sin vales, el equipo cifra el PIN con la llave pública del servidor, amarrado a
// la firma. Se prueba de punta a punta: el código real del frontend cifra con
// WebCrypto, y el real del servidor abre con la privada (la vía local, en vez de KMS).

const crypto = require('crypto');
const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
process.env.SOBRE_FIRMA_LOCAL_PEM = privateKey.export({ type: 'pkcs8', format: 'pem' });
process.env.CAMPO_HMAC_KEY = 'clave-de-prueba-hmac';
process.env.CAMPO_CIFRADO_LOCAL_KEY = crypto.randomBytes(32).toString('base64');
process.env.CREDENCIAL_PEPPER = 'pimienta-de-prueba';

const { prepararEntorno, crearDobleTablas } = require('./doble-dynamo-tablas');
const esquemas = prepararEntorno();

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { PutCommand, GetCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');

const { docClient } = require('../lib/clients/dynamodb');
const { cargarTs, FRONTEND } = require('./cargar-ts');
const sobreServidor = require('../lib/sobreFirma');
const { FirmaService } = require('../lib/services/FirmaService');
const { hashPin } = require('../lib/utils/validation');
const { Persona } = require('../lib/models/Persona');
const limite = require('../lib/limitePin');

const A = 't-A';
const P = 'p-1';
const PIN = '482915';
let doble;
let llave;
let n;
const sobreF = () => cargarTs('sobreFirma.ts');

const claveP = { PK: `TENANT#${A}`, SK: `PERSONA#${P}` };
const ficha = async () => Persona.fromDynamoItem((await docClient.send(new GetCommand({ TableName: 'PERSONAS_TABLE', Key: claveP }))).Item);

beforeEach(async () => {
    doble = crearDobleTablas(docClient, esquemas, { proyecciones: true });
    llave = await sobreServidor.llavePublica();
    n = 0;
    await docClient.send(new PutCommand({ TableName: 'PERSONAS_TABLE', Item: {
        ...claveP, personaId: P, tenantId: A, nombre: 'Rosa', apellido: 'Díaz', habilitado: true, estado: 'activo', cargo: 'Jornal',
        pinHash: await hashPin(PIN, P), pinLargo: 6, pinIntentosFallidos: 0, pinBloqueadaHasta: null,
    } }));
});
afterEach(() => doble.restaurar());

/** Lo que hace el equipo: cifra con el código real del frontend. */
async function sobre({ pin = PIN, obraId = 'o-1', referenciaId = 'd-1', tipo = 'documento', id, timestampLocal = new Date().toISOString(), personaId = P, tenantId = A } = {}) {
    const idFirmaLocal = id || `firma_${++n}`;
    const cifrado = await sobreF().cifrarSobre(pin, { personaId, tenantId, obraId, tipo, referenciaId, idFirmaLocal, timestampLocal }, llave);
    return { sobre: cifrado, idFirmaLocal, timestampLocal, deviceId: 'equipo-1' };
}

/** Lo que hace el servidor al sincronizar. */
const firmar = async (credencial, { obraId = 'o-1', referenciaId = 'd-1', referenciaTipo = 'document', idSincronizacion = 'sinc_uno_1' } = {}) => FirmaService.crear({
    personaId: P, tenantId: A, obraId, metodo: 'SOBRE', credencial: { ...credencial, idSincronizacion },
    tipoFirma: 'trabajador', referenciaId, referenciaTipo, persona: await ficha(),
});
const rechaza = (promesa, codigo) => assert.rejects(promesa, (e) => e.codigo === codigo);

// ─── El sobre ────────────────────────────────────────────────────────────────

test('frontend y servidor calculan el mismo hash de la firma', async () => {
    const d = { personaId: P, tenantId: A, obraId: null, referenciaId: 'd-9', idFirmaLocal: 'f', timestampLocal: '2026-11-08T10:00:00.000Z' };
    assert.equal(await sobreF().hashDeFirma({ ...d, tipo: 'encuesta' }), sobreServidor.hashDeFirma({ ...d, referenciaTipo: 'survey' }));
    assert.equal(await sobreF().hashDeFirma({ ...d, tipo: 'actividad', obraId: 'o' }), sobreServidor.hashDeFirma({ ...d, obraId: 'o', referenciaTipo: 'activity' }));
});

test('con el PIN correcto la firma entra, con su traza; lo guardado no se puede leer', async () => {
    const c = await sobre();
    assert.ok(!c.sobre.includes(PIN) && !Buffer.from(c.sobre, 'base64').toString('latin1').includes(PIN));
    const f = await firmar(c);
    assert.equal(f.metodoValidacion, 'PIN en sobre cifrado');
    assert.equal(f.requiereRevision, false);
    assert.equal(f.offline.metodo, 'sobre');
    assert.equal(f.offline.firmadaSinConexionEn, c.timestampLocal);
    assert.ok(!JSON.stringify(f).includes(PIN), 'el PIN no queda en la firma');
});

test('un sobre no sirve para otra firma: cambia cualquier dato y se rechaza sin gastar intentos', async () => {
    const c = await sobre();
    await rechaza(firmar(c, { referenciaId: 'd-otro' }), 'SOBRE_RECHAZADO');
    await rechaza(firmar(c, { obraId: 'o-2' }), 'SOBRE_RECHAZADO');
    await rechaza(firmar(c, { referenciaTipo: 'activity' }), 'SOBRE_RECHAZADO');
    await rechaza(firmar({ ...c, idFirmaLocal: 'otra' }), 'SOBRE_RECHAZADO');
    await rechaza(firmar({ ...c, timestampLocal: '2026-01-01T00:00:00.000Z' }), 'SOBRE_RECHAZADO');
    await rechaza(firmar({ ...c, sobre: 'basura' }), 'SOBRE_RECHAZADO');
    assert.equal((await ficha()).pinIntentosFallidos, 0);
    assert.ok((await firmar(c)).signatureId, 'el original sigue sirviendo');
});

test('el sobre de otra persona no sirve', async () => {
    await rechaza(firmar(await sobre({ personaId: 'p-otra' })), 'SOBRE_RECHAZADO');
});

test('el reintento de la misma firma no la duplica', async () => {
    const c = await sobre();
    const a = await firmar(c);
    const b = await firmar(c);
    assert.equal(a.signatureId, b.signatureId);
});

// ─── Un intento por sincronización y por persona ─────────────────────────────

test('diez firmas con el mismo PIN malo en una sincronización: un solo intento, y ninguna entra', async () => {
    for (let i = 0; i < 10; i += 1) {
        await rechaza(firmar(await sobre({ pin: '000000', referenciaId: `d-${i}` }), { referenciaId: `d-${i}` }), 'SOBRE_RECHAZADO');
    }
    const p = await ficha();
    assert.equal(p.pinIntentosFallidos, 1);
    assert.equal(p.pinBloqueadaHasta, null);
    assert.ok(!JSON.stringify(p.intentoSobre).includes('000000'), 'guarda huellas, no el PIN');
});

test('una firma buena entre las malas entra igual', async () => {
    await rechaza(firmar(await sobre({ pin: '000000', referenciaId: 'd-1' })), 'SOBRE_RECHAZADO');
    assert.ok((await firmar(await sobre({ referenciaId: 'd-2' }), { referenciaId: 'd-2' })).signatureId);
});

test('tres PIN distintos cuentan uno; del cuarto en adelante, cada uno cuenta', async () => {
    const malos = ['000001', '000002', '000003', '000004', '000005'];
    for (const [i, pin] of malos.entries()) {
        await rechaza(firmar(await sobre({ pin, referenciaId: `d-${i}` }), { referenciaId: `d-${i}` }), 'SOBRE_RECHAZADO');
    }
    assert.equal((await ficha()).pinIntentosFallidos, 3, 'no se puede probar PIN sin límite con la misma sincronización');
});

test('cada sincronización nueva cuenta otro: el límite sigue existiendo, y el PIN malo no vuelve a la cola', async () => {
    for (let i = 0; i < 5; i += 1) {
        await rechaza(firmar(await sobre({ pin: '000000', referenciaId: `d-${i}` }), { referenciaId: `d-${i}`, idSincronizacion: `sinc_vez_${i}` }), 'SOBRE_RECHAZADO');
    }
    const p = await ficha();
    assert.equal(p.pinIntentosFallidos, 5);
    assert.ok(p.pinBloqueadaHasta, 'al quinto, el bloqueo de siempre');
});

test('con la cuenta ya bloqueada no se mira el PIN: la firma espera en la cola (423)', async () => {
    await docClient.send(new UpdateCommand({ TableName: 'PERSONAS_TABLE', Key: claveP, UpdateExpression: 'SET pinBloqueadaHasta = :h', ExpressionAttributeValues: { ':h': new Date(Date.now() + 60000).toISOString() } }));
    await rechaza(firmar(await sobre()), 'PIN_BLOQUEADO');
});

test('si dos peticiones chocan al anotar, la que pierde cuenta: no hay intentos gratis por concurrencia', async () => {
    const persona = await ficha();
    const verificar = async () => false;
    await limite.verificarSobre(persona, '000001', verificar, 'sinc_uno_1');
    const fresca = await ficha();
    await limite.verificarSobre(fresca, '000002', verificar, 'sinc_uno_1');
    // `fresca` quedó vieja: su versión ya no es la de la tabla.
    await limite.verificarSobre(fresca, '000003', verificar, 'sinc_uno_1');
    assert.equal((await ficha()).pinIntentosFallidos, 2);
});

test('sin identificador de sincronización válido, cada fallo cuenta', async () => {
    for (let i = 0; i < 2; i += 1) {
        await rechaza(firmar(await sobre({ pin: '000000', referenciaId: `d-${i}` }), { referenciaId: `d-${i}`, idSincronizacion: 'x' }), 'SOBRE_RECHAZADO');
    }
    assert.equal((await ficha()).pinIntentosFallidos, 2);
});

test('un PIN correcto limpia el contador', async () => {
    await rechaza(firmar(await sobre({ pin: '000000', referenciaId: 'd-1' })), 'SOBRE_RECHAZADO');
    await firmar(await sobre({ referenciaId: 'd-2' }), { referenciaId: 'd-2' });
    assert.equal((await ficha()).pinIntentosFallidos, 0);
});

// ─── Revisión y desvinculación ───────────────────────────────────────────────

test('una hora futura o de hace más de 30 días entra, pero en revisión', async () => {
    const futura = new Date(Date.now() + 3600e3).toISOString();
    const f1 = await firmar(await sobre({ timestampLocal: futura, referenciaId: 'd-1' }));
    assert.equal(f1.requiereRevision, true);
    assert.match(f1.motivoRevision, /no es creíble/);
    const vieja = new Date(Date.now() - 40 * 86400e3).toISOString();
    assert.equal((await firmar(await sobre({ timestampLocal: vieja, referenciaId: 'd-2' }), { referenciaId: 'd-2' })).requiereRevision, true);
});

test('persona desvinculada: lo declarado antes entra en revisión; lo declarado después se rechaza', async () => {
    const salida = new Date(Date.now() - 3600e3).toISOString();
    await docClient.send(new UpdateCommand({ TableName: 'PERSONAS_TABLE', Key: claveP, UpdateExpression: 'SET #e = :e, desvinculacion = :d', ExpressionAttributeNames: { '#e': 'estado' }, ExpressionAttributeValues: { ':e': 'desvinculado', ':d': { fechaDesvinculacion: salida } } }));
    const antes = await firmar(await sobre({ timestampLocal: new Date(Date.now() - 7200e3).toISOString() }));
    assert.equal(antes.requiereRevision, true);
    await rechaza(firmar(await sobre({ referenciaId: 'd-2' }), { referenciaId: 'd-2' }), 'PERSONA_DESVINCULADA');
});

test('un PIN de 4 en un sobre pide cambiarlo, sin contar', async () => {
    await rechaza(firmar(await sobre({ pin: '4821' })), 'PIN_DEBE_CAMBIAR');
    assert.equal((await ficha()).pinIntentosFallidos, 0);
});

test('KMS caído: la firma no se rechaza, queda en la cola (503)', async () => {
    const pem = process.env.SOBRE_FIRMA_LOCAL_PEM;
    delete process.env.SOBRE_FIRMA_LOCAL_PEM;
    process.env.SOBRE_FIRMA_KMS_KEY_ID = 'llave';
    const { KMSClient } = require('@aws-sdk/client-kms');
    const enviar = KMSClient.prototype.send;
    KMSClient.prototype.send = async () => { throw Object.assign(new Error('caído'), { name: 'ServiceUnavailable' }); };
    try {
        await assert.rejects(sobreServidor.abrir(Buffer.from('x').toString('base64')), (e) => e.codigo === 'SOBRE_NO_DISPONIBLE');
    } finally {
        KMSClient.prototype.send = enviar;
        process.env.SOBRE_FIRMA_LOCAL_PEM = pem;
    }
    const leer = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
    for (const h of ['documents', 'activities', 'surveys']) {
        assert.match(leer('handlers', h, 'handler.js'), /codigo === 'SOBRE_NO_DISPONIBLE'[^\n]*503\)/, h);
    }
});

// ─── La infraestructura y la sesión ──────────────────────────────────────────

test('la llave: RSA 2048 para cifrar, con alias, Retain y solo los permisos necesarios', () => {
    const yml = fs.readFileSync(path.join(__dirname, '..', 'serverless.yml'), 'utf8');
    const b = yml.slice(yml.indexOf('    ClaveSobreFirma:'), yml.indexOf('    ClaveDatosAlias:'));
    assert.match(b, /KeySpec: RSA_2048/);
    assert.match(b, /KeyUsage: ENCRYPT_DECRYPT/);
    assert.match(b, /DeletionPolicy: Retain/);
    assert.match(b, /ClaveSobreFirmaAlias:/);
    assert.match(yml, /- kms:GetPublicKey\n\s+- kms:Decrypt\n\s+Resource:\n\s+- !GetAtt ClaveSobreFirma\.Arn/);
    assert.match(yml, /SOBRE_FIRMA_KMS_KEY_ID: !Ref ClaveSobreFirma/);
});

test('la sesión entrega la llave pública, y el PIN descifrado no se registra', () => {
    const auth = fs.readFileSync(path.join(__dirname, '..', 'handlers', 'auth', 'handler.js'), 'utf8');
    assert.ok(auth.includes('llaveSobreFirma: await sobreFirma.llavePublica()'));
    const lib = fs.readFileSync(path.join(__dirname, '..', 'lib', 'sobreFirma.js'), 'utf8');
    assert.ok(!/console\.\w+\([^)]*\b(claro|pin|abierto)\b/.test(lib));
});

test('un PIN equivocado no es una sesión vencida: ninguna ruta responde 401 por eso', () => {
    const leer = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
    assert.ok(!/chequeo\.bloqueada \? 423 : [^;]*401/.test(leer('handlers', 'vales', 'handler.js')));
    assert.ok(!/chequeo\.bloqueada \? 423 : [^;]*401/.test(leer('handlers', 'signatures', 'handler.js')));
    assert.match(leer('handlers', 'personas-module', 'handler.js'), /PIN_ACTUAL_INCORRECTO: 400/);
});
