/**
 * Migracion idempotente: copia workerId -> personaId en colecciones embebidas.
 *
 * Recorre las tablas que guardan referencias a personas dentro de arrays/objetos
 * (asignaciones, firmas, asistentes, trabajadores, afectado, ...). Para cada
 * referencia que tenga `workerId` pero NO `personaId`, copia el valor a
 * `personaId`. NO borra `workerId` (se retira en una limpieza posterior, una vez
 * confirmado que ya no quedan items sin personaId).
 *
 * Uso:
 *   STAGE=dev node Backend/scripts/migrate-workerId-to-personaId.js --dry-run
 *   STAGE=dev node Backend/scripts/migrate-workerId-to-personaId.js --apply
 *
 * Seguridad:
 *   - --dry-run (default): solo cuenta y reporta, no escribe nada.
 *   - --apply: aplica los UpdateCommand. Idempotente: una segunda corrida
 *     reporta 0 cambios.
 *   - NO ejecutar --apply en produccion sin backup previo de las tablas
 *     (point-in-time recovery o export a S3).
 */

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, ScanCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');

const SERVICE_NAME = process.env.SERVICE_NAME || 'hackatonbackendv2';
const STAGE = process.env.STAGE || process.env.STAGE_NAME || 'dev';
const REGION = process.env.AWS_REGION || 'us-east-1';

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const DRY_RUN = !APPLY; // por defecto, dry-run

const client = new DynamoDBClient({ region: REGION });
const docClient = DynamoDBDocumentClient.from(client, {
    marshallOptions: { removeUndefinedValues: true },
});

const tableName = (envKey, suffix) =>
    process.env[envKey] || `${SERVICE_NAME}-${suffix}-${STAGE}`;

/**
 * Tablas a migrar y los campos embebidos que contienen referencias a personas.
 * - arrayFields: campos que son arrays de objetos con { personaId?, workerId? }.
 * - objectFields: campos que son un unico objeto con { personaId?, workerId? }.
 */
const TARGETS = [
    {
        table: tableName('DOCUMENTS_TABLE', 'documents'),
        arrayFields: ['asignaciones', 'firmas'],
        objectFields: [],
    },
    {
        table: tableName('SIGNATURE_REQUESTS_TABLE', 'signature-requests'),
        arrayFields: ['trabajadores'],
        objectFields: [],
    },
    {
        table: tableName('ACTIVITIES_TABLE', 'activities'),
        arrayFields: ['asistentes'],
        objectFields: [],
    },
    {
        table: tableName('INCIDENTS_TABLE', 'incidents'),
        arrayFields: ['firmas'],
        objectFields: ['afectado'],
    },
];

/**
 * Normaliza una referencia a persona. Devuelve { ref, changed }.
 * Copia workerId -> personaId solo si hay workerId y falta personaId.
 */
function normalizeRef(ref) {
    if (!ref || typeof ref !== 'object') return { ref, changed: false };
    if (ref.workerId && !ref.personaId) {
        return { ref: { ...ref, personaId: ref.workerId }, changed: true };
    }
    return { ref, changed: false };
}

/**
 * Normaliza un item completo. Devuelve { item, changed, touched } con la lista
 * de campos modificados (touched) para construir el UpdateExpression.
 */
function normalizeItem(item, { arrayFields, objectFields }) {
    const touched = [];
    const next = { ...item };

    for (const field of arrayFields) {
        const arr = item[field];
        if (!Array.isArray(arr)) continue;
        let fieldChanged = false;
        const newArr = arr.map((entry) => {
            const { ref, changed } = normalizeRef(entry);
            if (changed) fieldChanged = true;
            return ref;
        });
        if (fieldChanged) {
            next[field] = newArr;
            touched.push(field);
        }
    }

    for (const field of objectFields) {
        const { ref, changed } = normalizeRef(item[field]);
        if (changed) {
            next[field] = ref;
            touched.push(field);
        }
    }

    return { item: next, changed: touched.length > 0, touched };
}

async function scanAll(table) {
    const items = [];
    let ExclusiveStartKey;
    do {
        const res = await docClient.send(new ScanCommand({
            TableName: table,
            ExclusiveStartKey,
        }));
        items.push(...(res.Items || []));
        ExclusiveStartKey = res.LastEvaluatedKey;
    } while (ExclusiveStartKey);
    return items;
}

async function applyUpdate(table, item, touched) {
    // PK/SK genericos: detectamos las claves de la tabla a partir del item.
    // Las tablas de este proyecto usan PK/SK o ids planos; usamos las claves
    // presentes en el item. Para evitar adivinar el esquema, reescribimos solo
    // los campos tocados con UpdateExpression sobre la clave detectada.
    const key = detectKey(table, item);
    const names = {};
    const values = {};
    const sets = touched.map((field, i) => {
        names[`#f${i}`] = field;
        values[`:v${i}`] = item[field];
        return `#f${i} = :v${i}`;
    });
    await docClient.send(new UpdateCommand({
        TableName: table,
        Key: key,
        UpdateExpression: `SET ${sets.join(', ')}`,
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
    }));
}

/**
 * Detecta la clave primaria del item. Soporta el patron PK/SK y los ids planos
 * por tabla del proyecto.
 */
function detectKey(table, item) {
    if (item.PK !== undefined && item.SK !== undefined) {
        return { PK: item.PK, SK: item.SK };
    }
    const candidates = ['documentId', 'requestId', 'activityId', 'incidentId', 'id'];
    for (const c of candidates) {
        if (item[c] !== undefined) return { [c]: item[c] };
    }
    throw new Error(`No se pudo detectar la clave primaria de un item en ${table}`);
}

async function migrateTable(target) {
    const { table } = target;
    let scanned = 0;
    let changedCount = 0;
    let appliedCount = 0;

    let items;
    try {
        items = await scanAll(table);
    } catch (err) {
        console.error(`  [ERROR] No se pudo escanear ${table}: ${err.message}`);
        return { table, scanned: 0, changedCount: 0, appliedCount: 0, error: err.message };
    }

    for (const item of items) {
        scanned += 1;
        const { item: next, changed, touched } = normalizeItem(item, target);
        if (!changed) continue;
        changedCount += 1;
        if (APPLY) {
            try {
                await applyUpdate(table, next, touched);
                appliedCount += 1;
            } catch (err) {
                console.error(`  [ERROR] Update fallo en ${table}: ${err.message}`);
            }
        }
    }

    return { table, scanned, changedCount, appliedCount };
}

async function main() {
    console.log('='.repeat(60));
    console.log('Migracion workerId -> personaId (colecciones embebidas)');
    console.log(`Modo: ${APPLY ? 'APPLY (escribe)' : 'DRY-RUN (solo reporta)'}`);
    console.log(`Stage: ${STAGE} | Region: ${REGION}`);
    console.log('='.repeat(60));

    const results = [];
    for (const target of TARGETS) {
        console.log(`\nTabla: ${target.table}`);
        const r = await migrateTable(target);
        results.push(r);
        console.log(`  escaneados: ${r.scanned} | a normalizar: ${r.changedCount}` +
            (APPLY ? ` | aplicados: ${r.appliedCount}` : ''));
    }

    console.log('\n' + '='.repeat(60));
    console.log('Resumen:');
    let totalChanged = 0;
    for (const r of results) {
        totalChanged += r.changedCount;
        console.log(`  ${r.table}: ${r.changedCount} items ${APPLY ? 'aplicados' : 'pendientes'}`);
    }
    console.log(`Total items con cambios: ${totalChanged}`);
    if (DRY_RUN && totalChanged > 0) {
        console.log('\nDRY-RUN: no se escribio nada. Ejecuta con --apply para persistir.');
    }
    console.log('='.repeat(60));
}

main().catch((err) => {
    console.error('Migracion abortada:', err);
    process.exit(1);
});
