/**
 * Empresa desechable para las pruebas de punta a punta: se crea con el mismo
 * script que usa el operador (`crear-empresa.js`) y se borra entera al terminar.
 *
 * ── Qué garantiza el borrado ─────────────────────────────────────────────────
 *
 * Borrar "lo de la empresa" no se puede hacer filtrando por `tenantId`: hay
 * elementos que no lo llevan. La firma, por ejemplo, guarda su traza en
 * `<signatureId>#traza`, sin empresa y fuera de todo índice; la bandeja se
 * indexa por destinatario. Por eso el borrado busca por identificador:
 *
 *   1. Parte de los identificadores conocidos (empresa y personas creadas).
 *   2. Recorre todas las tablas del ambiente y marca todo elemento que mencione
 *      alguno. De cada elemento marcado toma los UUID de su **clave** (no de sus
 *      atributos: un atributo puede apuntar a algo compartido, como un catálogo,
 *      y seguirlo borraría datos de otra empresa).
 *   3. Repite hasta que no aparezcan identificadores nuevos, y borra.
 *   4. En los dos buckets borra toda versión cuya clave mencione un
 *      identificador. El de evidencia tiene Object Lock en modo gobernanza: se
 *      borra con `BypassGovernanceRetention`, que exige ese permiso IAM.
 *   5. Espera y vuelve a recorrer todo. Hay escrituras que llegan tarde (la cola
 *      de avisos, la de estampado): si aparece algo, lo borra y vuelve a mirar.
 *      Termina bien solo con un recorrido completo en cero.
 *
 * ── Qué impide que borre una empresa real ────────────────────────────────────
 *
 *   - El nombre de toda empresa desechable empieza con `MARCA`, y el borrado se
 *     niega si la ficha de la empresa no la tiene.
 *   - Solo se buscan UUID: un identificador corto o genérico nunca entra en la
 *     búsqueda.
 *
 * ── Qué pasa si el proceso muere a la mitad ──────────────────────────────────
 *
 * Toda empresa creada se anota en un archivo de pendientes, antes de usarla, y
 * se quita recién cuando el recorrido final da cero. La próxima ejecución
 * empieza borrando lo que haya quedado anotado. Un `kill -9` deja restos por un
 * rato, no para siempre.
 *
 * Los datos leídos durante el recorrido viven solo en memoria: no se escriben a
 * disco ni se imprimen. Lo único que se imprime son tablas y conteos.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { DynamoDBClient, ListTablesCommand, DescribeTableCommand, ScanCommand, DeleteItemCommand } = require('@aws-sdk/client-dynamodb');
const { S3Client, ListObjectVersionsCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');

const ejecutar = promisify(execFile);

const SERVICIO = 'BuildAndServe';
const MARCA = 'E2E desechable';
// Donde recibe correos toda persona de prueba: verificado en SES, así que llega
// aunque la cuenta siga en sandbox.
const CORREO_PRUEBAS = 'atorres@thecodecookers.cl';
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

const region = process.env.AWS_REGION || 'us-east-1';
const dynamo = new DynamoDBClient({ region });
const s3 = new S3Client({ region });

const log = (...a) => console.log('  ', ...a);

// ─── RUT ─────────────────────────────────────────────────────────────────────

function digitoVerificador(cuerpo) {
    let suma = 0;
    let factor = 2;
    for (const d of String(cuerpo).split('').reverse()) {
        suma += Number(d) * factor;
        factor = factor === 7 ? 2 : factor + 1;
    }
    const dv = 11 - (suma % 11);
    return dv === 11 ? '0' : dv === 10 ? 'K' : String(dv);
}

const conPuntos = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');

/** RUT válido y al azar dentro de [min, max). No hay forma de saber si está
 *  libre sin preguntar: `crear-empresa.js` lo comprueba y se reintenta. */
function rutAlAzar(min, max) {
    const cuerpo = min + crypto.randomInt(max - min);
    return `${conPuntos(cuerpo)}-${digitoVerificador(cuerpo)}`;
}

/** La contraseña inicial de D-13: los cuatro primeros dígitos del RUT. */
const passwordInicial = (rut) => rut.replace(/\D/g, '').slice(0, 4);

// ─── Pendientes ──────────────────────────────────────────────────────────────

const archivoPendientes = (stage) => path.join(os.homedir(), '.cache', 'buildandserve', `e2e-pendientes-${stage}.json`);

function leerPendientes(stage) {
    try {
        return JSON.parse(fs.readFileSync(archivoPendientes(stage), 'utf8'));
    } catch {
        return [];
    }
}

function escribirPendientes(stage, lista) {
    const archivo = archivoPendientes(stage);
    fs.mkdirSync(path.dirname(archivo), { recursive: true });
    fs.writeFileSync(archivo, JSON.stringify(lista, null, 2));
}

function anotarPendiente(stage, tenantId) {
    const lista = leerPendientes(stage).filter((t) => t !== tenantId);
    escribirPendientes(stage, [...lista, tenantId]);
}

function quitarPendiente(stage, tenantId) {
    escribirPendientes(stage, leerPendientes(stage).filter((t) => t !== tenantId));
}

// ─── Alta ────────────────────────────────────────────────────────────────────

/**
 * Crea la empresa y su administrador con `crear-empresa.js --confirmar`.
 *
 * Si el alta falla a la mitad, igual devuelve el `tenantId` que alcanzó a
 * crearse (y lo deja anotado), para que el borrado no dependa de que todo haya
 * salido bien.
 *
 * @returns {{ tenantId, adminPersonaId, adminRut, nombre }}
 */
async function crearEmpresa(stage) {
    const ahora = new Date().toISOString().replace(/[:.]/g, '-');
    const nombre = `${MARCA} ${ahora} ${crypto.randomBytes(3).toString('hex')}`;

    for (let intento = 1; intento <= 5; intento++) {
        const adminRut = rutAlAzar(10_000_000, 25_000_000);
        const datos = {
            nombre,
            rutEmpresa: rutAlAzar(76_000_000, 78_000_000),
            admin: {
                rut: adminRut,
                nombre: 'Prueba',
                apellidoPaterno: 'Punta',
                apellidoMaterno: 'Apunta',
                email: CORREO_PRUEBAS,
            },
        };
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bys-e2e-'));
        const archivo = path.join(dir, 'empresa.json');
        fs.writeFileSync(archivo, JSON.stringify(datos));

        let salida = '';
        let fallo = null;
        try {
            const r = await ejecutar(process.execPath,
                [path.join(__dirname, '..', 'crear-empresa.js'), '--stage', stage, '--datos', archivo, '--confirmar'],
                { cwd: path.join(__dirname, '..', '..'), env: process.env, maxBuffer: 1024 * 1024 });
            salida = r.stdout + r.stderr;
        } catch (err) {
            salida = `${err.stdout || ''}${err.stderr || ''}`;
            fallo = err;
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }

        const tenantId = salida.match(/Empresa creada:\s+(\S+)/)?.[1] || null;
        const adminPersonaId = salida.match(/Administrador creado:\s+(\S+)/)?.[1] || null;
        if (tenantId) anotarPendiente(stage, tenantId);

        if (!fallo && tenantId && adminPersonaId) {
            return { tenantId, adminPersonaId, adminRut, nombre };
        }
        // Un RUT ocupado se detecta antes de escribir: se reintenta con otro.
        if (!tenantId && /ya est[aá] registrado|Ya existe una empresa con el RUT/.test(salida)) continue;

        const error = new Error(`El alta de la empresa desechable falló:\n${salida.trim()}`);
        error.tenantId = tenantId;
        throw error;
    }
    throw new Error('No se encontró un RUT libre en cinco intentos.');
}

// ─── Borrado ─────────────────────────────────────────────────────────────────

async function tablasDelAmbiente(stage) {
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

async function* recorrer(tabla) {
    let inicio;
    do {
        const r = await dynamo.send(new ScanCommand({ TableName: tabla, ExclusiveStartKey: inicio }));
        yield* r.Items || [];
        inicio = r.LastEvaluatedKey;
    } while (inicio);
}

const menciona = (texto, ids) => {
    const encontrados = texto.toLowerCase().match(UUID) || [];
    return encontrados.some((u) => ids.has(u));
};

/**
 * Todos los elementos del ambiente que mencionan algún identificador, con los
 * identificadores ampliados hasta el punto fijo.
 *
 * @returns {{ ids: Set<string>, elementos: Array<{ tabla, clave }> }}
 */
async function buscar(tablas, idsIniciales) {
    const ids = new Set([...idsIniciales].map((i) => i.toLowerCase()));
    // Se lee todo una sola vez por vuelta; cada vuelta solo sirve para ampliar
    // los identificadores, así que se repite hasta que no crecen.
    for (;;) {
        const antes = ids.size;
        const elementos = [];
        for (const { nombre, claves } of tablas) {
            for await (const item of recorrer(nombre)) {
                if (!menciona(JSON.stringify(item), ids)) continue;
                const clave = Object.fromEntries(claves.map((k) => [k, item[k]]));
                elementos.push({ tabla: nombre, clave });
                for (const k of claves) {
                    for (const u of (JSON.stringify(item[k]).toLowerCase().match(UUID) || [])) ids.add(u);
                }
            }
        }
        if (ids.size === antes) return { ids, elementos };
    }
}

async function versionesQueMencionan(bucket, ids) {
    const versiones = [];
    let KeyMarker;
    let VersionIdMarker;
    do {
        const r = await s3.send(new ListObjectVersionsCommand({ Bucket: bucket, KeyMarker, VersionIdMarker }));
        for (const v of [...(r.Versions || []), ...(r.DeleteMarkers || [])]) {
            if (menciona(v.Key, ids)) versiones.push({ Key: v.Key, VersionId: v.VersionId });
        }
        KeyMarker = r.IsTruncated ? r.NextKeyMarker : undefined;
        VersionIdMarker = r.IsTruncated ? r.NextVersionIdMarker : undefined;
    } while (KeyMarker);
    return versiones;
}

/** Se niega a seguir si el identificador no es de una empresa desechable. */
async function comprobarQueEsDesechable(stage, tenantId) {
    if (!/^[0-9a-f-]{36}$/i.test(tenantId)) throw new Error(`"${tenantId}" no es un identificador de empresa.`);
    const r = await dynamo.send(new ScanCommand({
        TableName: `${SERVICIO}-tenants-${stage}`,
        FilterExpression: 'PK = :pk',
        ExpressionAttributeValues: { ':pk': { S: `TENANT#${tenantId}` } },
        ProjectionExpression: 'nombre',
    }));
    const fichas = r.Items || [];
    // Sin ficha puede ser un alta que se cortó antes de escribirla, o un borrado
    // anterior que alcanzó a quitarla: se sigue, porque no hay nada ajeno que
    // pueda coincidir con un UUID recién generado.
    const ajena = fichas.find((f) => !String(f.nombre?.S || '').startsWith(MARCA));
    if (ajena) {
        throw new Error(`La empresa ${tenantId} no es desechable (su nombre no empieza con "${MARCA}"). No se borra nada.`);
    }
}

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Borra todo lo de la empresa y confirma con un recorrido completo en cero.
 *
 * @param {string[]} idsExtra identificadores conocidos además de la empresa
 *   (personas creadas por la prueba). La búsqueda los encontraría igual por su
 *   ficha, salvo que la ficha ya se haya borrado en una ejecución anterior.
 */
async function borrarEmpresa(stage, tenantId, idsExtra = [], { espera = 15_000 } = {}) {
    await comprobarQueEsDesechable(stage, tenantId);
    const tablas = await tablasDelAmbiente(stage);
    const buckets = [`buildandserve-evidencia-${stage}`, `buildandserve-trabajo-${stage}`];

    let ids = new Set([tenantId, ...idsExtra]);
    for (let vuelta = 1; vuelta <= 5; vuelta++) {
        const hallado = await buscar(tablas, ids);
        ids = hallado.ids;
        const porBucket = await Promise.all(buckets.map(async (b) => ({ bucket: b, versiones: await versionesQueMencionan(b, ids) })));
        const archivos = porBucket.reduce((n, b) => n + b.versiones.length, 0);

        if (hallado.elementos.length === 0 && archivos === 0) {
            if (vuelta === 1) log(`Borrado: no hay nada de la empresa ${tenantId}.`);
            else log(`Borrado confirmado: un recorrido completo de ${tablas.length} tablas y ${buckets.length} buckets no encuentra nada.`);
            quitarPendiente(stage, tenantId);
            return;
        }

        const conteo = {};
        for (const { tabla, clave } of hallado.elementos) {
            await dynamo.send(new DeleteItemCommand({ TableName: tabla, Key: clave }));
            conteo[tabla] = (conteo[tabla] || 0) + 1;
        }
        for (const { bucket, versiones } of porBucket) {
            for (const v of versiones) {
                await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: v.Key, VersionId: v.VersionId, BypassGovernanceRetention: true }));
            }
            if (versiones.length) conteo[bucket] = versiones.length;
        }
        log(`Borrado, vuelta ${vuelta}: ${Object.entries(conteo).map(([t, n]) => `${t.replace(`${SERVICIO}-`, '')} ${n}`).join(', ')}`);

        // Lo que escriben las colas llega después de la respuesta HTTP.
        await esperar(espera);
    }
    throw new Error(`Después de cinco vueltas sigue apareciendo algo de la empresa ${tenantId}. Queda anotada como pendiente.`);
}

/** Cuándo se creó una empresa desechable, según su nombre. */
function fechaDeNombre(nombre) {
    const m = /(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z/.exec(nombre || '');
    return m ? new Date(`${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z`) : null;
}

/**
 * Borra lo que haya quedado de ejecuciones anteriores que murieron.
 *
 * Dos fuentes: lo anotado en este equipo, y toda empresa del ambiente con la
 * marca y más de una hora de vida. La segunda cubre lo que la primera no ve: un
 * proceso que murió entre que la empresa se escribió y que se anotó, o una
 * ejecución desde otro equipo. La hora de margen es para no borrarle la empresa
 * a una prueba que está corriendo en paralelo.
 */
async function borrarPendientes(stage, opciones = {}) {
    const huerfanas = [];
    let inicio;
    do {
        const r = await dynamo.send(new ScanCommand({
            TableName: `${SERVICIO}-tenants-${stage}`,
            FilterExpression: 'begins_with(nombre, :m) AND begins_with(PK, :t)',
            ExpressionAttributeValues: { ':m': { S: MARCA }, ':t': { S: 'TENANT#' } },
            ProjectionExpression: 'PK, nombre',
            ExclusiveStartKey: inicio,
        }));
        for (const it of r.Items || []) {
            const creada = fechaDeNombre(it.nombre?.S);
            if (creada && Date.now() - creada.getTime() > 3600e3) huerfanas.push(it.PK.S.slice('TENANT#'.length));
        }
        inicio = r.LastEvaluatedKey;
    } while (inicio);

    for (const tenantId of new Set([...leerPendientes(stage), ...huerfanas])) {
        log(`Quedó de una ejecución anterior: ${tenantId}`);
        await borrarEmpresa(stage, tenantId, [], opciones);
    }
}

module.exports = {
    MARCA,
    CORREO_PRUEBAS,
    rutAlAzar,
    digitoVerificador,
    passwordInicial,
    crearEmpresa,
    borrarEmpresa,
    borrarPendientes,
    leerPendientes,
    fechaDeNombre,
};
