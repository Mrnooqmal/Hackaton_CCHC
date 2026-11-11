#!/usr/bin/env node
/**
 * Borra una empresa ENTERA de un ambiente: sus datos en todas las tablas y sus
 * archivos (todas las versiones) en los buckets de evidencia y de trabajo.
 *
 * Es para empresas que nunca tuvieron uso real (como "TCC" en prod, creada en
 * pruebas). No es el camino de la supresión de datos de una persona: ese es el
 * lote de dos personas (D-17). Por eso lo corre el operador con sus
 * credenciales (queda en CloudTrail) y en dos pasos:
 *
 *   1. Ensayo (por omisión): recorre todo, dice qué borraría y da una huella del
 *      conjunto. No borra nada.
 *        node scripts/borrar-empresa.js --stage prod --empresa <uuid> --nombre "TCC"
 *
 *   2. Ejecución: vuelve a recorrer y borra SOLO si lo encontrado tiene la misma
 *      huella que el ensayo revisado. Si algo cambió entre medio, no borra.
 *        node scripts/borrar-empresa.js --stage prod --empresa <uuid> --nombre "TCC" --ejecutar <huella>
 *
 * ── Cómo encuentra lo de la empresa ──────────────────────────────────────────
 * Como `e2e/empresa-desechable.js`: parte del identificador de la empresa,
 * recorre todas las tablas del ambiente, marca todo elemento que lo mencione,
 * suma los UUID de la CLAVE de cada elemento marcado (personas, documentos…) y
 * repite hasta que no crecen. Solo UUID: nada corto o genérico entra.
 *
 * ── Qué impide borrar de más ─────────────────────────────────────────────────
 *   - El nombre de la empresa tiene que coincidir exactamente con `--nombre`.
 *   - Si algún elemento marcado declara OTRA empresa (`tenantId`, o una clave
 *     `TENANT#…`), se detiene y no borra nada: puede ser una persona que también
 *     está en otra empresa, y seguirla borraría datos ajenos.
 *   - La ejecución exige la huella del ensayo.
 *
 * No imprime datos personales: tablas, claves (identificadores) y conteos.
 */

const crypto = require('crypto');
const { DynamoDBClient, ListTablesCommand, DescribeTableCommand, ScanCommand, DeleteItemCommand } = require('@aws-sdk/client-dynamodb');
const { S3Client, ListObjectVersionsCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { unmarshall } = require('@aws-sdk/util-dynamodb');

const SERVICIO = 'BuildAndServe';
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

function argumentos(argv) {
    const a = {};
    for (let i = 0; i < argv.length; i++) {
        if (argv[i].startsWith('--')) a[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
    }
    return a;
}

const uuids = (texto) => (String(texto).toLowerCase().match(UUID) || []);

/** ¿El elemento declara pertenecer a OTRA empresa? */
function empresaAjena(item, tenantId) {
    const plano = unmarshall(item);
    const declaradas = new Set();
    if (typeof plano.tenantId === 'string') declaradas.add(plano.tenantId.toLowerCase());
    for (const k of ['PK', 'SK', 'pk', 'sk']) {
        const m = /^TENANT#([0-9a-f-]{36})/i.exec(String(plano[k] || ''));
        if (m) declaradas.add(m[1].toLowerCase());
    }
    return [...declaradas].find((t) => t !== tenantId.toLowerCase()) || null;
}

async function tablasDelAmbiente(dynamo, stage) {
    const nombres = [];
    let inicio;
    do {
        const r = await dynamo.send(new ListTablesCommand({ ExclusiveStartTableName: inicio }));
        nombres.push(...r.TableNames);
        inicio = r.LastEvaluatedTableName;
    } while (inicio);
    const propias = nombres.filter((t) => t.startsWith(`${SERVICIO}-`) && t.endsWith(`-${stage}`));
    return Promise.all(propias.map(async (nombre) => {
        const d = await dynamo.send(new DescribeTableCommand({ TableName: nombre }));
        return { nombre, claves: d.Table.KeySchema.map((k) => k.AttributeName) };
    }));
}

async function* recorrer(dynamo, tabla) {
    let inicio;
    do {
        const r = await dynamo.send(new ScanCommand({ TableName: tabla, ExclusiveStartKey: inicio }));
        yield* r.Items || [];
        inicio = r.LastEvaluatedKey;
    } while (inicio);
}

/** Todo lo que menciona a la empresa o a lo suyo, hasta el punto fijo. */
async function buscar(dynamo, s3, tablas, buckets, tenantId) {
    const ids = new Set([tenantId.toLowerCase()]);
    for (;;) {
        const antes = ids.size;
        const elementos = [];
        const ajenos = [];
        for (const { nombre, claves } of tablas) {
            for await (const item of recorrer(dynamo, nombre)) {
                if (!uuids(JSON.stringify(item)).some((u) => ids.has(u))) continue;
                const clave = Object.fromEntries(claves.map((k) => [k, item[k]]));
                const otra = empresaAjena(item, tenantId);
                if (otra) { ajenos.push({ tabla: nombre, clave: unmarshall(clave), empresa: otra }); continue; }
                elementos.push({ tabla: nombre, clave });
                for (const k of claves) for (const u of uuids(JSON.stringify(item[k]))) ids.add(u);
            }
        }
        if (ids.size === antes) {
            const archivos = [];
            for (const bucket of buckets) {
                let KeyMarker; let VersionIdMarker;
                do {
                    const r = await s3.send(new ListObjectVersionsCommand({ Bucket: bucket, KeyMarker, VersionIdMarker }));
                    for (const v of [...(r.Versions || []), ...(r.DeleteMarkers || [])]) {
                        if (uuids(v.Key).some((u) => ids.has(u))) archivos.push({ bucket, Key: v.Key, VersionId: v.VersionId, Size: v.Size || 0 });
                    }
                    KeyMarker = r.IsTruncated ? r.NextKeyMarker : undefined;
                    VersionIdMarker = r.IsTruncated ? r.NextVersionIdMarker : undefined;
                } while (KeyMarker);
            }
            return { ids, elementos, ajenos, archivos };
        }
    }
}

/** Huella del conjunto: si cambia algo entre el ensayo y la ejecución, cambia. */
function huellaDe({ elementos, archivos }) {
    const lineas = [
        ...elementos.map((e) => `${e.tabla} ${JSON.stringify(unmarshall(e.clave), Object.keys(unmarshall(e.clave)).sort())}`),
        ...archivos.map((a) => `${a.bucket} ${a.Key} ${a.VersionId}`),
    ].sort();
    return crypto.createHash('sha256').update(lineas.join('\n')).digest('hex').slice(0, 16);
}

async function main() {
    const a = argumentos(process.argv.slice(2));
    const { stage, empresa: tenantId, nombre } = a;
    if (!['dev', 'prod'].includes(stage) || !/^[0-9a-f-]{36}$/i.test(tenantId || '') || !nombre || nombre === true) {
        console.error('Uso: node scripts/borrar-empresa.js --stage dev|prod --empresa <uuid> --nombre "<nombre exacto>" [--ejecutar <huella>]');
        process.exit(2);
    }
    const region = process.env.AWS_REGION || 'us-east-1';
    const dynamo = new DynamoDBClient({ region });
    const s3 = new S3Client({ region });

    // La ficha de la empresa, y su nombre exacto.
    const ficha = await dynamo.send(new ScanCommand({
        TableName: `${SERVICIO}-tenants-${stage}`,
        FilterExpression: 'PK = :pk AND begins_with(SK, :m)',
        ExpressionAttributeValues: { ':pk': { S: `TENANT#${tenantId}` }, ':m': { S: 'METADATA#' } },
        ProjectionExpression: 'nombre',
    }));
    const nombreReal = ficha.Items?.[0]?.nombre?.S;
    if (nombreReal === undefined) { console.error(`No hay ficha de la empresa ${tenantId} en ${stage}. No se borra nada.`); process.exit(1); }
    if (nombreReal !== nombre) { console.error(`La empresa ${tenantId} se llama "${nombreReal}", no "${nombre}". No se borra nada.`); process.exit(1); }

    const tablas = await tablasDelAmbiente(dynamo, stage);
    const buckets = [`buildandserve-evidencia-${stage}`, `buildandserve-trabajo-${stage}`];
    const hallado = await buscar(dynamo, s3, tablas, buckets, tenantId);
    const huella = huellaDe(hallado);

    console.log(`\n  Empresa "${nombreReal}" (${tenantId}) en ${stage}`);
    console.log(`  Recorridas ${tablas.length} tablas y ${buckets.length} buckets.\n`);
    if (hallado.ajenos.length) {
        console.log('  ALTO: estos elementos mencionan a la empresa pero declaran OTRA. No se borra nada:');
        for (const x of hallado.ajenos) console.log(`    ${x.tabla}  ${JSON.stringify(x.clave)}  (empresa ${x.empresa})`);
        process.exit(1);
    }
    const porTabla = {};
    for (const e of hallado.elementos) (porTabla[e.tabla] = porTabla[e.tabla] || []).push(unmarshall(e.clave));
    console.log(`  Elementos (${hallado.elementos.length}):`);
    for (const [t, claves] of Object.entries(porTabla)) {
        console.log(`    ${t.replace(`${SERVICIO}-`, '')}: ${claves.length}`);
        for (const c of claves) console.log(`      ${JSON.stringify(c)}`);
    }
    const bytes = hallado.archivos.reduce((n, x) => n + x.Size, 0);
    console.log(`  Archivos (${hallado.archivos.length} versiones, ${(bytes / 1048576).toFixed(1)} MB):`);
    for (const x of hallado.archivos) console.log(`    ${x.bucket}  ${x.Key}  (${x.VersionId})`);
    console.log(`\n  Huella: ${huella}`);

    if (!a.ejecutar) {
        console.log('  Ensayo: no se borró nada. Para borrar exactamente esto, repite con --ejecutar <huella>.\n');
        return;
    }
    if (a.ejecutar !== huella) {
        console.error(`  La huella revisada (${a.ejecutar}) no es la de ahora (${huella}): algo cambió. No se borra nada; vuelve a ensayar.`);
        process.exit(1);
    }
    for (const e of hallado.elementos) await dynamo.send(new DeleteItemCommand({ TableName: e.tabla, Key: e.clave }));
    for (const x of hallado.archivos) {
        await s3.send(new DeleteObjectCommand({ Bucket: x.bucket, Key: x.Key, VersionId: x.VersionId, BypassGovernanceRetention: true }));
    }
    const despues = await buscar(dynamo, s3, tablas, buckets, tenantId);
    const quedan = despues.elementos.length + despues.archivos.length;
    if (quedan) { console.error(`  Quedan ${quedan} elementos o archivos: vuelve a ensayar.`); process.exit(1); }
    console.log(`  Borrado: ${hallado.elementos.length} elementos y ${hallado.archivos.length} versiones de archivos. Un nuevo recorrido no encuentra nada.\n`);
}

if (require.main === module) {
    main().catch((err) => { console.error(err.message); process.exit(1); });
}

module.exports = { empresaAjena, huellaDe, uuids };
