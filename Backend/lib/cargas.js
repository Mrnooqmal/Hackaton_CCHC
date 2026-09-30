/**
 * Carga masiva de personas en cola (D-24).
 *
 * ── Por qué ──────────────────────────────────────────────────────────────────
 * Corría entera dentro de la petición, contra el tope de 29 segundos de la API:
 * cada fila crea la persona, sus documentos de empresa, su onboarding por obra y
 * su correo. Con una nómina real se agotaba y el cliente recibía un 504 sin saber
 * cuántas filas habían entrado.
 *
 * ── Forma ────────────────────────────────────────────────────────────────────
 * Confirmar crea una CARGA (un ítem `CARGA` con contadores) y una FILA por
 * persona (`FILA#000012`), y encola un mensaje por fila: una fila que falla no
 * arrastra a las demás, y los reintentos de SQS son por fila.
 *
 * ── Garantías ────────────────────────────────────────────────────────────────
 *  - Idempotencia por (carga, RUT): el `personaId` sale de ese par y la ficha se
 *    escribe con condición. Un reintento de SQS —que ocurre solo— no crea a la
 *    misma persona dos veces.
 *  - Una fila la procesa un trabajador a la vez (arriendo con vencimiento).
 *  - Cada fila se cuenta UNA vez: el paso a `creada` o `fallida`, los contadores
 *    de la carga y el de trabajadores de la empresa van en la misma transacción,
 *    condicionada a que la fila siga `procesando`.
 *  - No hay todo-o-nada: la carga es reanudable, no transaccional.
 *  - La fase 2 (asignar supervisores) corre cuando la última fila termina, no
 *    antes: la detecta el contador, con lectura consistente.
 *  - Una fila que revienta repetidamente queda `fallida` con su motivo en vez de
 *    perderse en la cola de mensajes fallidos.
 *
 * Datos personales: la fila guarda los datos del Excel hasta crearse; al quedar
 * `creada` se le quitan (quedan en la ficha). Todo vence a los 30 días (TTL).
 */

const crypto = require('crypto');
const { GetCommand, QueryCommand, UpdateCommand, TransactWriteCommand, BatchWriteCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient } = require('./clients/dynamodb');
const { encolar } = require('./cola');

const TABLA = () => process.env.CARGAS_TABLE;
const MAX_FILAS = 1000;
const MAX_INTENTOS = 4;               // entrega número 4 de SQS: se da por fallida
const ARRIENDO_MS = 3 * 60 * 1000;    // mayor que el timeout del trabajador
const VIGENCIA_S = 30 * 24 * 3600;

const ESTADOS_CARGA = { EN_PROCESO: 'en_proceso', COMPLETADA: 'completada', CON_ERRORES: 'completada_con_errores', ENCOLADO_INCOMPLETO: 'encolado_incompleto' };
const TERMINAL = new Set(['creada', 'fallida']);

const skFila = (n) => `FILA#${String(n).padStart(6, '0')}`;
const expira = () => Math.floor(Date.now() / 1000) + VIGENCIA_S;

/** personaId determinista de (carga, RUT), con forma de UUID. */
function personaIdDe(cargaId, rutKey) {
    const h = crypto.createHash('sha256').update(`carga:${cargaId}:${rutKey}`).digest('hex');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${((parseInt(h[16], 16) & 3) | 8).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/** Error que la cola debe reintentar (no es culpa de la fila). */
class Reintentar extends Error {}

// ─── Crear ──────────────────────────────────────────────────────────────────

/**
 * @param {object} p
 * @param {Array<{fila, valida: boolean, motivo?, tipoFallo?, rutKey, obraIds, supervisorRutKey}>} p.filas - ya validadas.
 */
async function crearCarga({ tenantId, iniciadaPor, filas, enviarCorreo }) {
    if (!filas.length) throw Object.assign(new Error('No hay filas para cargar'), { status: 400 });
    if (filas.length > MAX_FILAS) throw Object.assign(new Error(`Una carga admite hasta ${MAX_FILAS} filas; divide la planilla.`), { status: 400 });

    const cargaId = crypto.randomUUID();
    const ahora = new Date().toISOString();
    const invalidas = filas.filter((f) => !f.valida);
    const meta = {
        cargaId, sk: 'CARGA', tenantId, creadaEn: ahora, iniciadaPor,
        total: filas.length, procesadas: invalidas.length, creadas: 0, fallidas: invalidas.length,
        estado: invalidas.length === filas.length ? ESTADOS_CARGA.CON_ERRORES : ESTADOS_CARGA.EN_PROCESO,
        enviarCorreo: Boolean(enviarCorreo), expira: expira(),
    };
    // La clave sale de la posición, no del número de fila que manda el cliente:
    // dos filas con el mismo número no se pisan.
    const items = filas.map((f, i) => ({
        cargaId, sk: skFila(i + 1), filaExcel: f.fila.filaExcel, rutKey: f.rutKey,
        rut: f.fila.rut || null,
        estado: f.valida ? 'pendiente' : 'fallida',
        ...(f.valida ? {} : { motivo: f.motivo, tipoFallo: f.tipoFallo || 'error', reintentable: false }),
        datos: f.fila, obraIds: f.obraIds || [], supervisorRutKey: f.supervisorRutKey || null,
        intentos: 0, expira: expira(),
    }));

    // Primero todo en la tabla; recién después a la cola. Si encolar falla, la
    // carga existe y "reanudar" vuelve a encolar lo pendiente.
    for (const lote of trozos([meta, ...items], 25)) {
        let pendientes = lote.map((Item) => ({ PutRequest: { Item } }));
        for (let i = 0; i < 5 && pendientes.length; i++) {
            const r = await docClient.send(new BatchWriteCommand({ RequestItems: { [TABLA()]: pendientes } }));
            pendientes = r.UnprocessedItems?.[TABLA()] || [];
        }
        if (pendientes.length) throw new Error('No se pudo guardar la carga');
    }

    const validas = items.filter((i) => i.estado === 'pendiente');
    try {
        await encolar('CARGAS', validas.map((i) => ({ tipo: 'carga.fila', cargaId, sk: i.sk })));
    } catch (err) {
        await docClient.send(new UpdateCommand({
            TableName: TABLA(), Key: { cargaId, sk: 'CARGA' },
            UpdateExpression: 'SET estado = :e', ExpressionAttributeValues: { ':e': ESTADOS_CARGA.ENCOLADO_INCOMPLETO },
        }));
        return { cargaId, encoladoIncompleto: true };
    }
    if (!validas.length) await verificarTermino(cargaId);
    return { cargaId, encoladoIncompleto: false };
}

// ─── Procesar una fila ──────────────────────────────────────────────────────

/**
 * @param {{cargaId: string, sk: string}} msg
 * @param {object} deps - { personaService, crearFicha, despuesDeCrear, enviarBienvenida, tenantsTable }
 * @param {{intento: number}} entrega - número de entrega de SQS (ApproximateReceiveCount).
 */
async function procesarFila({ cargaId, sk }, deps, { intento = 1 } = {}) {
    const [meta, fila] = await Promise.all([leer(cargaId, 'CARGA'), leer(cargaId, sk)]);
    if (!meta || !fila) return;                        // venció o no existe: nada que hacer
    if (TERMINAL.has(fila.estado)) return verificarTermino(cargaId);

    // Arriendo: una fila, un trabajador a la vez.
    const ahora = Date.now();
    try {
        await docClient.send(new UpdateCommand({
            TableName: TABLA(), Key: { cargaId, sk },
            UpdateExpression: 'SET estado = :p, arriendoHasta = :h ADD intentos :uno',
            ConditionExpression: 'estado = :pendiente OR (estado = :p AND arriendoHasta < :ahora)',
            ExpressionAttributeValues: { ':p': 'procesando', ':pendiente': 'pendiente', ':h': ahora + ARRIENDO_MS, ':ahora': ahora, ':uno': 1 },
        }));
    } catch (err) {
        if (err.name === 'ConditionalCheckFailedException') {
            const actual = await leer(cargaId, sk);
            if (actual && TERMINAL.has(actual.estado)) return verificarTermino(cargaId);
            throw new Reintentar('La fila la está procesando otro trabajador');
        }
        throw err;
    }

    const personaId = personaIdDe(cargaId, fila.rutKey);
    let persona;
    let passwordTemporal = null;
    let aviso = null;
    try {
        persona = await deps.fichaPorId(meta.tenantId, personaId);
        if (!persona) {
            try {
                ({ persona, passwordTemporal } = await deps.crearFicha(meta.tenantId, fila.datos, { personaId, obraIds: fila.obraIds }));
            } catch (err) {
                // ¿La creó un intento anterior de esta misma carga?
                persona = await deps.fichaPorId(meta.tenantId, personaId);
                if (!persona) throw err;
            }
        }
        try {
            await deps.despuesDeCrear({ tenantId: meta.tenantId, persona, fila });
        } catch (err) {
            // La persona existe: si los documentos siguen fallando en el último
            // intento, la fila cuenta como creada y queda el aviso, en vez de
            // "fallida" con una persona que sí está en el sistema.
            if (intento < MAX_INTENTOS) throw err;
            aviso = `Creada, pero sin sus documentos de onboarding: ${String(err.message).slice(0, 200)}`;
        }
    } catch (err) {
        const permanente = /Ya existe una persona/i.test(err.message)
            ? { motivo: 'Ya existe una persona con este RUT', tipoFallo: 'duplicado', reintentable: false }
            : /inv[aá]lido|requerid|faltante/i.test(err.message)
                ? { motivo: err.message, tipoFallo: 'error', reintentable: false }
                : null;
        if (permanente) return terminar(meta, fila, 'fallida', permanente);
        if (intento >= MAX_INTENTOS) {
            return terminar(meta, fila, 'fallida', { motivo: `No se pudo crear tras ${intento} intentos: ${err.message}`, tipoFallo: 'error', reintentable: true });
        }
        // Transitorio: se libera la fila y la cola reintenta.
        await liberar(cargaId, sk, err);
        throw err;
    }

    let contada;
    try {
        contada = await terminar(meta, fila, 'creada', { personaId: persona.personaId, aviso }, deps.tenantsTable);
    } catch (err) {
        // No se pudo contar: se libera la fila para que el reintento no choque
        // con su propio arriendo. La ficha ya existe y el reintento la encuentra.
        await liberar(cargaId, sk, err);
        throw err;
    }
    if (contada && meta.enviarCorreo && persona.email) {
        // Después de contar: un reintento no manda dos bienvenidas. Si la
        // contraseña vino de un intento anterior, es la inicial de D-13.
        const r = await deps.enviarBienvenida(persona, passwordTemporal).catch((e) => ({ sent: false, error: e.message }));
        await docClient.send(new UpdateCommand({
            TableName: TABLA(), Key: { cargaId, sk },
            UpdateExpression: 'SET correo = :c', ExpressionAttributeValues: { ':c': r?.sent ? 'enviado' : (r?.code === 'DIRECCION_SUPRIMIDA' ? 'suprimido' : 'fallido') },
        })).catch(() => null);
    }
}

/** Devuelve la fila a `pendiente` para que la cola la reintente. */
async function liberar(cargaId, sk, err) {
    await docClient.send(new UpdateCommand({
        TableName: TABLA(), Key: { cargaId, sk },
        UpdateExpression: 'SET estado = :pendiente, ultimoError = :e REMOVE arriendoHasta',
        ConditionExpression: 'estado = :p',
        ExpressionAttributeValues: { ':pendiente': 'pendiente', ':p': 'procesando', ':e': String(err?.message).slice(0, 300) },
    })).catch(() => null);
}

/**
 * Pasa la fila a `creada` o `fallida` y la cuenta, todo en una transacción
 * condicionada a que siga `procesando`. Devuelve false si otro ya la cerró.
 */
async function terminar(meta, fila, estado, extra = {}, tenantsTable = null) {
    const { cargaId, sk } = fila;
    const creada = estado === 'creada';
    const operaciones = [
        {
            Update: {
                TableName: TABLA(), Key: { cargaId, sk },
                UpdateExpression: creada
                    // Creada: los datos del Excel ya viven en la ficha.
                    ? `SET estado = :e, personaId = :pid, terminadaEn = :t${extra.aviso ? ', aviso = :av' : ''} REMOVE datos, rut, arriendoHasta, ultimoError, motivo, tipoFallo, reintentable`
                    : 'SET estado = :e, motivo = :m, tipoFallo = :tf, reintentable = :r, terminadaEn = :t REMOVE arriendoHasta',
                ConditionExpression: 'estado = :p',
                ExpressionAttributeValues: {
                    ':e': estado, ':t': new Date().toISOString(), ':p': 'procesando',
                    ...(creada ? { ':pid': extra.personaId, ...(extra.aviso ? { ':av': extra.aviso } : {}) } : { ':m': extra.motivo, ':tf': extra.tipoFallo, ':r': Boolean(extra.reintentable) }),
                },
            },
        },
        {
            Update: {
                TableName: TABLA(), Key: { cargaId, sk: 'CARGA' },
                UpdateExpression: creada ? 'ADD procesadas :uno, creadas :uno' : 'ADD procesadas :uno, fallidas :uno',
                ExpressionAttributeValues: { ':uno': 1 },
            },
        },
    ];
    if (creada && tenantsTable) {
        operaciones.push({
            Update: {
                TableName: tenantsTable, Key: { PK: `TENANT#${meta.tenantId}`, SK: `METADATA#${meta.tenantId}` },
                UpdateExpression: 'ADD cantidadTrabajadores :uno SET updatedAt = :t',
                ExpressionAttributeValues: { ':uno': 1, ':t': new Date().toISOString() },
            },
        });
    }
    try {
        await docClient.send(new TransactWriteCommand({ TransactItems: operaciones }));
    } catch (err) {
        if (err.name === 'TransactionCanceledException' && err.CancellationReasons?.[0]?.Code === 'ConditionalCheckFailed') return false;
        throw err;
    }
    await verificarTermino(cargaId);
    return true;
}

/** Si ya terminó la última fila, encola la fase 2 (una vez; duplicarla no daña). */
async function verificarTermino(cargaId) {
    const meta = await leer(cargaId, 'CARGA');
    if (!meta || meta.procesadas < meta.total || meta.fase2EncoladaEn) return;
    await encolar('CARGAS', [{ tipo: 'carga.fase2', cargaId }]);
    await docClient.send(new UpdateCommand({
        TableName: TABLA(), Key: { cargaId, sk: 'CARGA' },
        UpdateExpression: 'SET fase2EncoladaEn = :t', ConditionExpression: 'attribute_not_exists(fase2EncoladaEn)',
        ExpressionAttributeValues: { ':t': new Date().toISOString() },
    })).catch((err) => { if (err.name !== 'ConditionalCheckFailedException') throw err; });
}

// ─── Fase 2: supervisores ───────────────────────────────────────────────────

/**
 * Asigna el supervisor de cada persona creada: uno que ya existía en la empresa
 * o uno creado en esta misma carga. Idempotente (fija, no agrega).
 * @param {object} deps - { supervisoresExistentes(tenantId): Map<rutKey, personaId>, asignarSupervisor({tenantId, personaId, obraId, supervisorId}) }
 */
async function fase2({ cargaId }, deps) {
    const meta = await leer(cargaId, 'CARGA');
    if (!meta || meta.procesadas < meta.total) return;
    const filas = await filasDe(cargaId);
    const creadasPorRut = new Map(filas.filter((f) => f.estado === 'creada').map((f) => [f.rutKey, f.personaId]));
    const pendientes = filas.filter((f) => f.estado === 'creada' && f.supervisorRutKey && f.obraIds?.length);
    if (pendientes.length) {
        const existentes = await deps.supervisoresExistentes(meta.tenantId);
        for (const f of pendientes) {
            const supervisorId = existentes.get(f.supervisorRutKey) || creadasPorRut.get(f.supervisorRutKey);
            if (!supervisorId) continue;
            for (const obraId of f.obraIds) await deps.asignarSupervisor({ tenantId: meta.tenantId, personaId: f.personaId, obraId, supervisorId });
        }
    }
    await docClient.send(new UpdateCommand({
        TableName: TABLA(), Key: { cargaId, sk: 'CARGA' },
        UpdateExpression: 'SET estado = :e, terminadaEn = :t',
        ConditionExpression: 'procesadas = #total',
        ExpressionAttributeNames: { '#total': 'total' },
        ExpressionAttributeValues: { ':e': meta.fallidas > 0 ? ESTADOS_CARGA.CON_ERRORES : ESTADOS_CARGA.COMPLETADA, ':t': new Date().toISOString() },
    })).catch((err) => { if (err.name !== 'ConditionalCheckFailedException') throw err; });
}

// ─── Consultar y reintentar ─────────────────────────────────────────────────

/** Estado para la pantalla: contadores y filas fallidas con su motivo. */
async function estadoDe(cargaId, tenantId) {
    const meta = await leer(cargaId, 'CARGA');
    if (!meta || meta.tenantId !== tenantId) return null;
    const filas = await filasDe(cargaId);
    return {
        cargaId, estado: meta.estado, creadaEn: meta.creadaEn, terminadaEn: meta.terminadaEn || null,
        iniciadaPor: meta.iniciadaPor, total: meta.total, procesadas: meta.procesadas,
        creadas: meta.creadas, fallidas: meta.fallidas,
        filasFallidas: filas.filter((f) => f.estado === 'fallida')
            .map((f) => ({ fila: f.filaExcel, rut: f.rut, motivo: f.motivo, tipoFallo: f.tipoFallo, reintentable: Boolean(f.reintentable) })),
        correosFallidos: filas.filter((f) => f.correo === 'fallido' || f.correo === 'suprimido').map((f) => ({ fila: f.filaExcel, rut: f.rut, correo: f.correo })),
        avisos: filas.filter((f) => f.aviso).map((f) => ({ fila: f.filaExcel, rut: f.rut, aviso: f.aviso })),
    };
}

async function listarDeEmpresa(tenantId, limite = 10) {
    const r = await docClient.send(new QueryCommand({
        TableName: TABLA(), IndexName: 'tenantId-creadaEn-index',
        KeyConditionExpression: 'tenantId = :t', ExpressionAttributeValues: { ':t': tenantId },
        ScanIndexForward: false, Limit: limite,
    }));
    return (r.Items || []).map(({ cargaId, estado, creadaEn, total, procesadas, creadas, fallidas, iniciadaPor }) => ({ cargaId, estado, creadaEn, total, procesadas, creadas, fallidas, iniciadaPor }));
}

/**
 * Vuelve a encolar las filas que fallaron por algo transitorio y las que se
 * quedaron sin encolar. Las que fallaron por datos (RUT inválido, duplicado)
 * no: se corrigen en el Excel.
 */
async function reintentar(cargaId, tenantId) {
    const meta = await leer(cargaId, 'CARGA');
    if (!meta || meta.tenantId !== tenantId) return null;
    const filas = await filasDe(cargaId);
    const aEncolar = [];
    for (const f of filas) {
        if (f.estado === 'pendiente') { aEncolar.push(f.sk); continue; }
        if (f.estado !== 'fallida' || !f.reintentable) continue;
        try {
            await docClient.send(new TransactWriteCommand({
                TransactItems: [
                    {
                        Update: {
                            TableName: TABLA(), Key: { cargaId, sk: f.sk },
                            UpdateExpression: 'SET estado = :p, intentos = :cero REMOVE motivo, tipoFallo, reintentable, terminadaEn',
                            ConditionExpression: 'estado = :f AND reintentable = :si',
                            ExpressionAttributeValues: { ':p': 'pendiente', ':f': 'fallida', ':si': true, ':cero': 0 },
                        },
                    },
                    {
                        Update: {
                            TableName: TABLA(), Key: { cargaId, sk: 'CARGA' },
                            UpdateExpression: 'ADD procesadas :menos, fallidas :menos SET estado = :e REMOVE fase2EncoladaEn, terminadaEn',
                            ExpressionAttributeValues: { ':menos': -1, ':e': ESTADOS_CARGA.EN_PROCESO },
                        },
                    },
                ],
            }));
            aEncolar.push(f.sk);
        } catch (err) {
            if (err.name !== 'TransactionCanceledException') throw err;
        }
    }
    if (aEncolar.length) {
        await docClient.send(new UpdateCommand({
            TableName: TABLA(), Key: { cargaId, sk: 'CARGA' },
            UpdateExpression: 'SET estado = :e', ExpressionAttributeValues: { ':e': ESTADOS_CARGA.EN_PROCESO },
        }));
        await encolar('CARGAS', aEncolar.map((sk) => ({ tipo: 'carga.fila', cargaId, sk })));
    }
    return { reencoladas: aEncolar.length };
}

// ─── Apoyo ──────────────────────────────────────────────────────────────────

async function leer(cargaId, sk) {
    const r = await docClient.send(new GetCommand({ TableName: TABLA(), Key: { cargaId, sk }, ConsistentRead: true }));
    return r.Item || null;
}

async function filasDe(cargaId) {
    const items = [];
    let desde;
    do {
        const r = await docClient.send(new QueryCommand({
            TableName: TABLA(), KeyConditionExpression: 'cargaId = :c AND begins_with(sk, :f)',
            ExpressionAttributeValues: { ':c': cargaId, ':f': 'FILA#' }, ConsistentRead: true, ExclusiveStartKey: desde,
        }));
        items.push(...(r.Items || []));
        desde = r.LastEvaluatedKey;
    } while (desde);
    return items;
}

function trozos(a, n) { const r = []; for (let i = 0; i < a.length; i += n) r.push(a.slice(i, i + n)); return r; }

module.exports = {
    crearCarga, procesarFila, fase2, estadoDe, listarDeEmpresa, reintentar, verificarTermino,
    personaIdDe, Reintentar, ESTADOS_CARGA, MAX_FILAS, MAX_INTENTOS,
};
