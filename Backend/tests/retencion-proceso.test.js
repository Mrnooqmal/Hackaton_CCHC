// El proceso diario de retención, de punta a punta sobre dobles con los esquemas reales.
//
// Carga una empresa por sus índices (que proyectan solo claves: trae los ítems
// completos de la tabla), guarda el plan SIN datos personales y extiende los
// bloqueos de S3 que corresponde. No suprime nada.

process.env.CAMPO_HMAC_KEY = 'clave-de-prueba-hmac';
process.env.CAMPO_CIFRADO_LOCAL_KEY = require('crypto').randomBytes(32).toString('base64');

const { prepararEntorno, crearDobleTablas } = require('./doble-dynamo-tablas');
const esquemas = prepararEntorno();
process.env.EVIDENCIA_BUCKET = 'evidencia-prueba';

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { PutCommand } = require('@aws-sdk/lib-dynamodb');

const { docClient } = require('../lib/clients/dynamodb');
const { s3Client } = require('../lib/clients/s3');
const proceso = require('../handlers/gobernanza/retencion');

const HOY = new Date('2032-06-01T12:00:00Z');
const T = 't-empresa';

let doble;
let objetos;       // key → { LastModified, RetainUntilDate }
let retenciones;   // PutObjectRetention recibidos
let borrados;
let originalS3;

beforeEach(() => {
    doble = crearDobleTablas(docClient, esquemas);
    objetos = new Map();
    retenciones = [];
    borrados = [];
    originalS3 = s3Client.send;
    s3Client.send = async (cmd) => {
        const n = cmd.constructor.name;
        const i = cmd.input;
        if (n === 'ListObjectsV2Command') {
            return { Contents: [...objetos.entries()].filter(([k]) => k.startsWith(i.Prefix)).map(([Key, o]) => ({ Key, LastModified: o.LastModified })), IsTruncated: false };
        }
        if (n === 'GetObjectRetentionCommand') {
            const o = objetos.get(i.Key);
            return { Retention: o.RetainUntilDate ? { Mode: 'GOVERNANCE', RetainUntilDate: o.RetainUntilDate } : null };
        }
        if (n === 'PutObjectRetentionCommand') {
            assert.equal(i.Retention.Mode, 'GOVERNANCE');
            assert.ok(!i.BypassGovernanceRetention, 'el proceso nunca usa bypass');
            retenciones.push({ key: i.Key, hasta: i.Retention.RetainUntilDate.toISOString() });
            objetos.get(i.Key).RetainUntilDate = i.Retention.RetainUntilDate;
            return {};
        }
        if (/Delete/.test(n)) { borrados.push(i); return {}; }
        throw new Error(`S3 no simulado: ${n}`);
    };
});
afterEach(() => { doble.restaurar(); s3Client.send = originalS3; });

const poner = (env, item) => docClient.send(new PutCommand({ TableName: env, Item: item }));

async function sembrar() {
    const p = (id, extra) => poner('PERSONAS_TABLE', { PK: `TENANT#${T}`, SK: `PERSONA#${id}`, personaId: id, tenantId: T, rutHmac: `v1:${id}`, nombre: `Nombre ${id}`, ...extra });
    await p('vencida', { estado: 'desvinculado', fechaTerminoVinculo: '2026-01-15T00:00:00Z' });
    await p('activa', { estado: 'activo' });
    await poner('TENANTS_TABLE', { PK: `TENANT#${T}`, SK: 'METADATA', tenantId: T });
    await poner('SIGNATURES_TABLE', { signatureId: 's1', tenantId: T, personaId: 'vencida', personaNombre: 'Nombre vencida' });
    await poner('DOCUMENTS_TABLE', { documentId: 'd-propio', tenantId: T, asignaciones: [{ personaId: 'vencida' }], s3Key: `tenants/${T}/documentos/propio.pdf` });
    await poner('DOCUMENTS_TABLE', { documentId: 'd-acta', tenantId: T, firmas: [{ personaId: 'vencida' }, { personaId: 'activa' }], s3Key: `tenants/${T}/documentos/acta.pdf` });
    await poner('INCIDENTS_TABLE', { incidentId: 'i1', tenantId: T, fecha: '2025-05-01', afectadoRutHmac: 'v1:vencida', tipo: 'accidente', trabajadorNombre: 'Nombre vencida' });
    await poner('INBOX_TABLE', { recipientId: 'vencida', messageId: 'm1', senderId: 'system', createdAt: '2026-01-01' });
    // Bloqueos: el del acta vence pronto (y debe seguir); el del documento propio también, pero se va a suprimir.
    objetos.set(`tenants/${T}/documentos/acta.pdf`, { LastModified: new Date('2027-07-01T00:00:00Z'), RetainUntilDate: new Date('2032-07-01T00:00:00Z') });
    objetos.set(`tenants/${T}/documentos/propio.pdf`, { LastModified: new Date('2027-07-01T00:00:00Z'), RetainUntilDate: new Date('2032-07-01T00:00:00Z') });
    objetos.set(`tenants/${T}/documentos/huerfano.pdf`, { LastModified: new Date('2027-07-15T00:00:00Z'), RetainUntilDate: new Date('2032-07-15T00:00:00Z') });
    objetos.set(`tenants/${T}/documentos/reciente.pdf`, { LastModified: new Date('2031-01-01T00:00:00Z'), RetainUntilDate: new Date('2036-01-01T00:00:00Z') });
}

const planGuardado = () => doble.items('GOBERNANZA_TABLE').find((x) => x.sk === `PLAN#${HOY.toISOString().slice(0, 10)}`);

test('el plan se calcula sobre los ítems completos y propone lo que venció', async () => {
    await sembrar();
    await proceso._interno.procesarEmpresa({ tenantId: T }, { hoy: HOY });
    const plan = planGuardado();
    assert.ok(plan, 'se guardó el plan del día');
    const acciones = plan.acciones.map((a) => `${a.tabla}:${a.accion}`).sort();
    assert.deepEqual(acciones, [
        'DOCUMENTS_TABLE:suprimir', 'INBOX_TABLE:suprimir', 'INCIDENTS_TABLE:anonimizar', 'PERSONAS_TABLE:suprimir', 'SIGNATURES_TABLE:suprimir',
    ]);
    assert.deepEqual(plan.personasVencidas, ['vencida']);
    assert.deepEqual(plan.archivosASuprimir, [`tenants/${T}/documentos/propio.pdf`]);
    assert.equal(plan.resumen.conservados.grupal, 1, 'el acta con un firmante activo');
});

test('el plan guardado no lleva datos personales: solo identificadores y claves', async () => {
    await sembrar();
    await proceso._interno.procesarEmpresa({ tenantId: T }, { hoy: HOY });
    const texto = JSON.stringify(planGuardado());
    assert.ok(!texto.includes('Nombre vencida'), 'ni nombres');
    assert.ok(!texto.includes('v1:vencida'), 'ni el HMAC del RUT');
});

test('extiende el bloqueo de lo que debe seguir (el acta y el archivo huérfano), no el de lo que vence', async () => {
    await sembrar();
    await proceso._interno.procesarEmpresa({ tenantId: T }, { hoy: HOY });
    const extendidos = retenciones.map((r) => r.key).sort();
    assert.deepEqual(extendidos, [`tenants/${T}/documentos/acta.pdf`, `tenants/${T}/documentos/huerfano.pdf`]);
    assert.equal(retenciones.find((r) => r.key.endsWith('acta.pdf')).hasta.slice(0, 10), '2033-07-01', 'un año más: su plazo es indefinido');
});

test('no suprime nada: ni filas, ni objetos', async () => {
    await sembrar();
    const antes = Object.fromEntries(Object.keys(esquemas).map((t) => [t, doble.items(t).length]));
    const escriturasAntes = doble.escrituras.length;
    await proceso._interno.procesarEmpresa({ tenantId: T }, { hoy: HOY });
    for (const t of Object.keys(esquemas)) {
        if (t === 'GOBERNANZA_TABLE') continue;
        assert.equal(doble.items(t).length, antes[t], `${t} cambió`);
    }
    assert.deepEqual(borrados, []);
    assert.equal(doble.escrituras.slice(escriturasAntes).filter((e) => e.tabla !== 'GOBERNANZA_TABLE').length, 0, 'solo escribe en la tabla de gobernanza');
});

test('con retención legal en la empresa, nada vence y el plan lo dice', async () => {
    await sembrar();
    await proceso._interno.procesarEmpresa({ tenantId: T, retencionLegal: { motivo: 'fiscalización' } }, { hoy: HOY });
    const plan = planGuardado();
    assert.deepEqual(plan.acciones, []);
    assert.equal(plan.resumen.personas.retencion_legal, 2);
});

test('el proceso diario recorre las empresas, y una que falla no detiene a las demás: se mide', async () => {
    await sembrar();
    await poner('TENANTS_TABLE', { PK: 'TENANT#rota', SK: 'METADATA', tenantId: 'rota' });
    const enviar = docClient.send;
    docClient.send = async (cmd) => {
        if (cmd.input?.ExpressionAttributeValues?.[':pk'] === 'TENANT#rota') throw Object.assign(new Error('throttling'), { name: 'ThrottlingException' });
        return enviar(cmd);
    };
    const errores = [];
    const originalError = console.error;
    console.error = (...a) => errores.push(a.join(' '));
    let r;
    try { r = await proceso.retencionDiaria(); } finally { console.error = originalError; docClient.send = enviar; }
    assert.equal(r.empresas, 2);
    assert.equal(r.fallidas, 1);
    assert.ok(doble.items('GOBERNANZA_TABLE').some((x) => x.tenantId === T), 'la empresa sana tiene su plan');
    assert.ok(errores.some((l) => l.includes('gobernanza.retencion')), 'el fallo queda como métrica');
});
