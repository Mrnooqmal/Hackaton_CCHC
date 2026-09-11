/**
 * Copia (duplica, sin borrar el origen) el contenido de las tablas DynamoDB
 * viejas (hackatonbackendv2 / hackatonbackendv2-testeo) hacia las tablas
 * nuevas del service BuildAndServe, como parte de la migracion de
 * infraestructura. Nunca escribe en el origen ni lo modifica.
 *
 * Uso:
 *   node scripts/copy-dynamo-tables.js --env=dev [--dry-run]
 *   node scripts/copy-dynamo-tables.js --env=prod --apply
 *   node scripts/copy-dynamo-tables.js --env=all --apply
 *
 * Seguridad:
 *   - --dry-run (default): solo escanea y cuenta, no escribe nada.
 *   - --apply: escribe los items en la tabla destino via BatchWriteItem.
 *   - Antes de escribir, si la tabla destino ya tiene items se aborta esa
 *     tabla (a menos que se pase --force), para no duplicar datos si el
 *     script se corre dos veces.
 */

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const {
    DynamoDBDocumentClient,
    ScanCommand,
    BatchWriteCommand,
} = require('@aws-sdk/lib-dynamodb');

const REGION = process.env.AWS_REGION || 'us-east-1';
const client = new DynamoDBClient({ region: REGION });
const docClient = DynamoDBDocumentClient.from(client, {
    marshallOptions: { removeUndefinedValues: true },
});

const TABLE_SUFFIXES = [
    'activities',
    'ausencias',
    'documents',
    'epp',
    'estructura-preventiva',
    'inbox',
    'incidents',
    'obras',
    'personas',
    'sessions',
    'signature-requests',
    'signatures',
    'sugerencias',
    'surveys',
    'tenants',
];

const args = process.argv.slice(2);
const envArg = (args.find((a) => a.startsWith('--env=')) || '--env=all').split('=')[1];
const APPLY = args.includes('--apply');
const FORCE = args.includes('--force');
const DRY_RUN = !APPLY;

function pairsForEnv(env) {
    if (env === 'dev') {
        return TABLE_SUFFIXES.map((s) => [`hackatonbackendv2-${s}-dev`, `BuildAndServe-${s}-dev`]);
    }
    if (env === 'prod') {
        return TABLE_SUFFIXES.map((s) => [`hackatonbackendv2-testeo-${s}-dev`, `BuildAndServe-${s}-prod`]);
    }
    if (env === 'all') {
        return [...pairsForEnv('dev'), ...pairsForEnv('prod')];
    }
    throw new Error(`--env invalido: ${env} (usar dev|prod|all)`);
}

async function scanAll(tableName) {
    const items = [];
    let ExclusiveStartKey;
    do {
        const res = await docClient.send(
            new ScanCommand({ TableName: tableName, ExclusiveStartKey })
        );
        items.push(...(res.Items || []));
        ExclusiveStartKey = res.LastEvaluatedKey;
    } while (ExclusiveStartKey);
    return items;
}

async function batchWriteAll(tableName, items) {
    const CHUNK = 25;
    for (let i = 0; i < items.length; i += CHUNK) {
        const chunk = items.slice(i, i + CHUNK);
        let requestItems = {
            [tableName]: chunk.map((Item) => ({ PutRequest: { Item } })),
        };
        let attempt = 0;
        while (requestItems[tableName] && requestItems[tableName].length > 0) {
            const res = await docClient.send(new BatchWriteCommand({ RequestItems: requestItems }));
            requestItems = res.UnprocessedItems || {};
            if (requestItems[tableName] && requestItems[tableName].length > 0) {
                attempt += 1;
                const backoff = Math.min(1000 * 2 ** attempt, 10000);
                await new Promise((r) => setTimeout(r, backoff));
            }
        }
    }
}

async function main() {
    const pairs = pairsForEnv(envArg);
    console.log(`Modo: ${DRY_RUN ? 'DRY-RUN (no escribe nada)' : 'APLICANDO CAMBIOS'} | env=${envArg}\n`);

    let totalCopied = 0;
    let totalSkipped = 0;

    for (const [src, dst] of pairs) {
        process.stdout.write(`- ${src} -> ${dst}: `);
        let srcItems;
        try {
            srcItems = await scanAll(src);
        } catch (err) {
            console.log(`ERROR leyendo origen (${err.name}): ${err.message}`);
            continue;
        }

        if (srcItems.length === 0) {
            console.log('origen vacio, nada que copiar');
            continue;
        }

        if (!DRY_RUN && !FORCE) {
            const dstItems = await scanAll(dst);
            if (dstItems.length > 0) {
                console.log(
                    `SALTADA: destino ya tiene ${dstItems.length} item(s) (usar --force para sobreescribir/duplicar de todos modos)`
                );
                totalSkipped += 1;
                continue;
            }
        }

        if (DRY_RUN) {
            console.log(`${srcItems.length} item(s) por copiar`);
            continue;
        }

        await batchWriteAll(dst, srcItems);
        console.log(`${srcItems.length} item(s) copiados`);
        totalCopied += srcItems.length;
    }

    console.log(`\nListo. Items copiados: ${totalCopied}. Tablas saltadas (destino no vacio): ${totalSkipped}.`);
}

main().catch((err) => {
    console.error('Fallo inesperado:', err);
    process.exit(1);
});
