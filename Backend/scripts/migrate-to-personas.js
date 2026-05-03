/**
 * Script de Migracion: Users + Workers -> PersonasTable
 * 
 * Ejecutar: node scripts/migrate-to-personas.js --stage dev [--dry-run]
 * 
 * Logica:
 * 1. Escanea UsersTable y WorkersTable
 * 2. Agrupa por RUT (normalizado)
 * 3. Merge: datos de User + datos de Worker = una Persona
 * 4. Escribe en PersonasTable con PK TENANT#{tenantId}, SK PERSONA#{personaId}
 * 
 * Conflictos se resuelven asi:
 * - Si existe User Y Worker con mismo RUT -> merge (User gana en password/email, Worker gana en PIN/cargo)
 * - Si solo existe User -> se crea Persona con tieneAccesoWeb=true
 * - Si solo existe Worker -> se crea Persona con tieneAccesoWeb=false
 */

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, ScanCommand, PutCommand, BatchWriteCommand } = require('@aws-sdk/lib-dynamodb');
const { v4: uuidv4 } = require('uuid');

// Config
const args = process.argv.slice(2);
const stage = args.find(a => a.startsWith('--stage'))?.split('=')[1]
    || args[args.indexOf('--stage') + 1]
    || 'dev';
const dryRun = args.includes('--dry-run');
const SERVICE_NAME = 'HackatonBackend';

const USERS_TABLE = `${SERVICE_NAME}-users-${stage}`;
const WORKERS_TABLE = `${SERVICE_NAME}-workers-${stage}`;
const PERSONAS_TABLE = `${SERVICE_NAME}-personas-${stage}`;

// Default tenant para migracion (los registros legacy no tienen tenantId)
const DEFAULT_TENANT_ID = process.env.DEFAULT_TENANT_ID || 'tenant-migracion-001';

const client = new DynamoDBClient({ region: 'us-east-1' });
const docClient = DynamoDBDocumentClient.from(client);

const normalizeRut = (rut = '') => rut.replace(/[^0-9kK-]/g, '').toUpperCase();

// ============================================================
// Scan completo de una tabla (maneja paginacion)
// ============================================================
async function scanAll(tableName) {
    const items = [];
    let ExclusiveStartKey;
    do {
        const result = await docClient.send(new ScanCommand({
            TableName: tableName,
            ExclusiveStartKey
        }));
        items.push(...(result.Items || []));
        ExclusiveStartKey = result.LastEvaluatedKey;
    } while (ExclusiveStartKey);
    return items;
}

// ============================================================
// Merge User + Worker en una Persona
// ============================================================
function mergeToPersona(user, worker) {
    const personaId = user?.userId || worker?.workerId || uuidv4();
    const rut = normalizeRut(user?.rut || worker?.rut);

    // Determinar rol
    let rol = 'trabajador';
    if (user?.rol) {
        rol = user.rol; // admin, prevencionista, etc
    } else if (worker?.cargo) {
        // Inferir rol del cargo si es posible
        const cargo = (worker.cargo || '').toLowerCase();
        if (cargo.includes('prevencion')) rol = 'prevencionista';
        else if (cargo.includes('relator')) rol = 'relator';
        else if (cargo.includes('supervisor')) rol = 'supervisor';
    }

    const persona = {
        // DynamoDB keys
        PK: `TENANT#${DEFAULT_TENANT_ID}`,
        SK: `PERSONA#${personaId}`,
        personaId,
        tenantId: DEFAULT_TENANT_ID,

        // Identidad (RUT es la llave de merge)
        rut,
        nombre: user?.nombre || worker?.nombre || '',
        apellido: user?.apellido || worker?.apellido || '',
        email: user?.email || worker?.email || null,
        telefono: user?.telefono || worker?.telefono || null,

        // Rol y cargo
        rol,
        cargo: worker?.cargo || user?.cargo || '',

        // Acceso
        tieneAccesoWeb: !!user, // Solo si tenia cuenta User
        passwordHash: user?.passwordHash || null,
        passwordTemporal: user?.passwordTemporal || false,
        pinHash: worker?.pinHash || user?.pinHash || null,

        // Estado
        habilitado: worker?.habilitado ?? user?.habilitado ?? false,
        estado: user?.estado || worker?.estado || 'activo',

        // Obra (si el worker tenia una asignada)
        obraId: worker?.obraId || null,

        // Metadata de migracion
        _migracion: {
            userId: user?.userId || null,
            workerId: worker?.workerId || null,
            fuenteOriginal: user && worker ? 'merge' : (user ? 'users' : 'workers'),
            fechaMigracion: new Date().toISOString()
        },

        createdAt: user?.createdAt || worker?.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString()
    };

    return persona;
}

// ============================================================
// Escribir batch en DynamoDB (25 items max por request)
// ============================================================
async function writeBatch(items) {
    const BATCH_SIZE = 25;
    let written = 0;

    for (let i = 0; i < items.length; i += BATCH_SIZE) {
        const batch = items.slice(i, i + BATCH_SIZE);
        const requests = batch.map(item => ({
            PutRequest: { Item: item }
        }));

        if (!dryRun) {
            await docClient.send(new BatchWriteCommand({
                RequestItems: {
                    [PERSONAS_TABLE]: requests
                }
            }));
        }

        written += batch.length;
        console.log(`  Escritos ${written}/${items.length}`);
    }

    return written;
}

// ============================================================
// Main
// ============================================================
async function main() {
    console.log('=== Migracion Users+Workers -> PersonasTable ===');
    console.log(`Stage: ${stage}`);
    console.log(`Tenant default: ${DEFAULT_TENANT_ID}`);
    console.log(`Modo: ${dryRun ? 'DRY RUN (no escribe)' : 'PRODUCCION'}`);
    console.log('');

    // 1. Escanear tablas legacy
    console.log(`Escaneando ${USERS_TABLE}...`);
    const users = await scanAll(USERS_TABLE);
    console.log(`  ${users.length} usuarios encontrados`);

    console.log(`Escaneando ${WORKERS_TABLE}...`);
    const workers = await scanAll(WORKERS_TABLE);
    console.log(`  ${workers.length} trabajadores encontrados`);

    // 2. Indexar por RUT
    const usersByRut = new Map();
    for (const u of users) {
        const rut = normalizeRut(u.rut);
        if (rut) usersByRut.set(rut, u);
    }

    const workersByRut = new Map();
    for (const w of workers) {
        const rut = normalizeRut(w.rut);
        if (rut) workersByRut.set(rut, w);
    }

    // 3. Merge
    const allRuts = new Set([...usersByRut.keys(), ...workersByRut.keys()]);
    console.log(`\nRUTs unicos: ${allRuts.size}`);

    const personas = [];
    const stats = { merged: 0, userOnly: 0, workerOnly: 0, noRut: 0 };

    for (const rut of allRuts) {
        const user = usersByRut.get(rut);
        const worker = workersByRut.get(rut);

        if (user && worker) stats.merged++;
        else if (user) stats.userOnly++;
        else stats.workerOnly++;

        personas.push(mergeToPersona(user, worker));
    }

    // Users sin RUT (no deberian existir, pero por si acaso)
    for (const u of users) {
        if (!normalizeRut(u.rut)) {
            stats.noRut++;
            console.warn(`  WARN: User ${u.userId} sin RUT, se omite`);
        }
    }

    console.log('\n--- Estadisticas ---');
    console.log(`  Merged (User+Worker): ${stats.merged}`);
    console.log(`  Solo User:            ${stats.userOnly}`);
    console.log(`  Solo Worker:          ${stats.workerOnly}`);
    console.log(`  Sin RUT (omitidos):   ${stats.noRut}`);
    console.log(`  Total a migrar:       ${personas.length}`);

    if (dryRun) {
        console.log('\n[DRY RUN] Mostrando primeras 3 personas:');
        personas.slice(0, 3).forEach((p, i) => {
            console.log(`\n  Persona ${i + 1}:`);
            console.log(`    PK: ${p.PK}`);
            console.log(`    SK: ${p.SK}`);
            console.log(`    RUT: ${p.rut}`);
            console.log(`    Nombre: ${p.nombre} ${p.apellido}`);
            console.log(`    Rol: ${p.rol}`);
            console.log(`    AccesoWeb: ${p.tieneAccesoWeb}`);
            console.log(`    Fuente: ${p._migracion.fuenteOriginal}`);
        });
        console.log('\n[DRY RUN] No se escribio nada. Ejecuta sin --dry-run para migrar.');
        return;
    }

    // 4. Escribir
    console.log('\nEscribiendo en PersonasTable...');
    const written = await writeBatch(personas);
    console.log(`\nMigracion completada: ${written} personas escritas.`);
}

main().catch(err => {
    console.error('Error fatal:', err);
    process.exit(1);
});
