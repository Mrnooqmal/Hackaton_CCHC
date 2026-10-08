// El borrado de la empresa desechable de las pruebas de punta a punta.
//
// Esa prueba corre también contra producción, así que lo que fijan estas
// pruebas es doble: que no quede nada de la empresa desechable (ni lo que no
// lleva `tenantId`, como la traza de una firma, ni lo que llega tarde por una
// cola), y que no se toque nada de otra empresa, ni siquiera lo que comparte
// una referencia con ella.

const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

// El archivo de pendientes va al HOME: en las pruebas, a uno desechable.
process.env.HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-home-'));

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { S3Client } = require('@aws-sdk/client-s3');
const { validateRut } = require('../lib/utils/validation');
const d = require('../scripts/e2e/empresa-desechable');

const T = '11111111-1111-4111-8111-111111111111';        // la desechable
const P = '22222222-2222-4222-8222-222222222222';        // su persona
const S = '33333333-3333-4333-8333-333333333333';        // una firma suya
const OTRA = '44444444-4444-4444-8444-444444444444';     // otra empresa
const OTRA_P = '55555555-5555-4555-8555-555555555555';
const CATALOGO = '66666666-6666-4666-8666-666666666666'; // algo compartido

const s = (v) => ({ S: v });

// ─── Dobles de DynamoDB y S3 ─────────────────────────────────────────────────

let tablas;      // nombre -> { claves, items: [] }
let objetos;     // bucket -> [{ Key, VersionId }]
let borradosS3;  // [{ Bucket, Key, VersionId, BypassGovernanceRetention }]
let alBorrar;    // gancho: simula una escritura tardía

const claveDe = (t, item) => JSON.stringify(tablas[t].claves.map((k) => item[k]));

DynamoDBClient.prototype.send = async function simulado(cmd) {
    const n = cmd.constructor.name;
    const i = cmd.input;
    if (n === 'ListTablesCommand') return { TableNames: Object.keys(tablas) };
    if (n === 'DescribeTableCommand') return { Table: { KeySchema: tablas[i.TableName].claves.map((k) => ({ AttributeName: k })) } };
    if (n === 'ScanCommand') {
        const v = i.ExpressionAttributeValues || {};
        let items = tablas[i.TableName].items;
        if (i.FilterExpression === 'PK = :pk') items = items.filter((it) => it.PK?.S === v[':pk'].S);
        else if (i.FilterExpression) {
            items = items.filter((it) => String(it.nombre?.S || '').startsWith(v[':m'].S) && String(it.PK?.S || '').startsWith(v[':t'].S));
        }
        return { Items: items.map((it) => structuredClone(it)) };
    }
    if (n === 'DeleteItemCommand') {
        const t = i.TableName;
        tablas[t].items = tablas[t].items.filter((it) => claveDe(t, it) !== claveDe(t, i.Key));
        if (alBorrar) { const f = alBorrar; alBorrar = null; f(); }
        return {};
    }
    throw new Error(`DynamoDB no simulado: ${n}`);
};

S3Client.prototype.send = async function simulado(cmd) {
    const n = cmd.constructor.name;
    const i = cmd.input;
    if (n === 'ListObjectVersionsCommand') return { Versions: structuredClone(objetos[i.Bucket] || []), IsTruncated: false };
    if (n === 'DeleteObjectCommand') {
        borradosS3.push(i);
        objetos[i.Bucket] = objetos[i.Bucket].filter((o) => !(o.Key === i.Key && o.VersionId === i.VersionId));
        return {};
    }
    throw new Error(`S3 no simulado: ${n}`);
};

const tabla = (nombre) => tablas[`BuildAndServe-${nombre}-dev`].items;

beforeEach(() => {
    alBorrar = null;
    borradosS3 = [];
    tablas = {
        'BuildAndServe-tenants-dev': { claves: ['PK', 'SK'], items: [
            { PK: s(`TENANT#${T}`), SK: s(`METADATA#${T}`), nombre: s(`${d.MARCA} 2026-01-15T10-00-00-000Z abc`) },
            { PK: s(`TENANT#${OTRA}`), SK: s(`METADATA#${OTRA}`), nombre: s('Constructora Real SpA') },
        ] },
        'BuildAndServe-personas-dev': { claves: ['PK', 'SK'], items: [
            { PK: s(`TENANT#${T}`), SK: s(`PERSONA#${P}`), personaId: s(P), cargoId: s(CATALOGO) },
            { PK: s(`TENANT#${OTRA}`), SK: s(`PERSONA#${OTRA_P}`), personaId: s(OTRA_P), cargoId: s(CATALOGO) },
        ] },
        'BuildAndServe-signatures-dev': { claves: ['signatureId'], items: [
            { signatureId: s(S), personaId: s(P) },
            // La traza no lleva empresa ni persona: solo se la encuentra por la
            // clave de la firma.
            { signatureId: s(`${S}#traza`), rut: s('cifrado') },
            { signatureId: s('77777777-7777-4777-8777-777777777777'), personaId: s(OTRA_P) },
        ] },
        // Un catálogo compartido que la persona desechable menciona por atributo.
        'BuildAndServe-catalogos-dev': { claves: ['catalogoId'], items: [
            { catalogoId: s(CATALOGO), nombre: s('Cargo compartido') },
        ] },
        // Tabla de otro ambiente: no se recorre.
        'BuildAndServe-personas-prod': { claves: ['PK', 'SK'], items: [
            { PK: s(`TENANT#${T}`), SK: s(`PERSONA#${P}`) },
        ] },
    };
    objetos = {
        'buildandserve-evidencia-dev': [
            { Key: `tenants/${T}/documentos/acta.pdf`, VersionId: 'v1' },
            { Key: `tenants/${T}/documentos/acta.pdf`, VersionId: 'v2' },
            { Key: `tenants/${OTRA}/documentos/acta.pdf`, VersionId: 'v1' },
        ],
        'buildandserve-trabajo-dev': [
            { Key: `tenants/${T}/logos/logo.png`, VersionId: 'v1' },
        ],
    };
});

const rapido = { espera: 0 };

// ─── Borrado ─────────────────────────────────────────────────────────────────

test('borra todo lo de la empresa desechable, incluida la traza sin empresa', async () => {
    await d.borrarEmpresa('dev', T, [], rapido);

    assert.deepEqual(tabla('tenants').map((i) => i.PK.S), [`TENANT#${OTRA}`]);
    assert.deepEqual(tabla('personas').map((i) => i.personaId.S), [OTRA_P]);
    assert.deepEqual(tabla('signatures').map((i) => i.signatureId.S), ['77777777-7777-4777-8777-777777777777'],
        'la firma y su traza se van; la de la otra empresa queda');
});

test('no sigue las referencias de los atributos: lo compartido no se borra', async () => {
    // La persona desechable menciona el catálogo en `cargoId`. Seguir ese
    // identificador borraría el catálogo, y con él lo de todas las empresas.
    await d.borrarEmpresa('dev', T, [], rapido);
    assert.equal(tabla('catalogos').length, 1);
    assert.equal(tabla('personas').length, 1, 'la persona de la otra empresa, que también lo menciona, queda');
});

test('solo recorre las tablas de su ambiente', async () => {
    await d.borrarEmpresa('dev', T, [], rapido);
    assert.equal(tablas['BuildAndServe-personas-prod'].items.length, 1);
});

test('borra toda versión de sus archivos, con la omisión de la retención de gobernanza', async () => {
    await d.borrarEmpresa('dev', T, [], rapido);

    assert.deepEqual(objetos['buildandserve-evidencia-dev'].map((o) => o.Key), [`tenants/${OTRA}/documentos/acta.pdf`]);
    assert.equal(objetos['buildandserve-trabajo-dev'].length, 0);
    assert.equal(borradosS3.length, 3, 'las dos versiones del acta y el logo');
    assert.ok(borradosS3.every((b) => b.BypassGovernanceRetention === true && b.VersionId));
});

test('lo que llega tarde (una cola) se borra en la vuelta siguiente', async () => {
    tablas['BuildAndServe-inbox-dev'] = { claves: ['recipientId', 'messageId'], items: [] };
    alBorrar = () => tabla('inbox').push({ recipientId: s(P), messageId: s('88888888-8888-4888-8888-888888888888') });

    await d.borrarEmpresa('dev', T, [], rapido);
    assert.equal(tabla('inbox').length, 0);
});

test('se niega a borrar una empresa que no es desechable, y no toca nada', async () => {
    await assert.rejects(d.borrarEmpresa('dev', OTRA, [], rapido), /no es desechable/);
    assert.equal(tabla('personas').length, 2);
    assert.equal(tabla('tenants').length, 2);
    assert.equal(borradosS3.length, 0);
});

test('se niega a borrar con un identificador que no es un UUID', async () => {
    await assert.rejects(d.borrarEmpresa('dev', 'TENANT', [], rapido), /no es un identificador/);
});

// ─── Pendientes ──────────────────────────────────────────────────────────────

test('barre las desechables de más de una hora, no las recientes ni las reales', async () => {
    const reciente = '99999999-9999-4999-8999-999999999999';
    const hace10min = new Date(Date.now() - 600e3).toISOString().replace(/[:.]/g, '-');
    tabla('tenants').push({ PK: s(`TENANT#${reciente}`), SK: s(`METADATA#${reciente}`), nombre: s(`${d.MARCA} ${hace10min} def`) });

    await d.borrarPendientes('dev', rapido);

    assert.deepEqual(tabla('tenants').map((i) => i.PK.S).sort(), [`TENANT#${OTRA}`, `TENANT#${reciente}`].sort(),
        'la vieja se borra; la de una prueba en curso y la real quedan');
});

// ─── Datos de alta ───────────────────────────────────────────────────────────

test('los RUT al azar son válidos y la contraseña inicial es la de D-13', () => {
    for (let i = 0; i < 200; i++) {
        const rut = d.rutAlAzar(10_000_000, 25_000_000);
        assert.ok(validateRut(rut).valid, rut);
    }
    assert.equal(d.passwordInicial('12.345.678-5'), '1234');
});
