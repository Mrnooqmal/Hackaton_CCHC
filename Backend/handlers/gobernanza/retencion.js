/**
 * Proceso diario de retención (D-2, Ley 21.719).
 *
 * Por cada empresa:
 *   1. Carga sus personas y los registros de cada fuente del inventario
 *      (`lib/gobernanza/inventario.js`).
 *   2. Calcula el plan (`lib/gobernanza/retencion.js`): qué venció, qué se
 *      conserva y por qué.
 *   3. Guarda el plan en la tabla de gobernanza (`PLAN#<fecha>`), sin datos
 *      personales: identificadores, claves y conteos.
 *   4. Extiende el bloqueo de S3 (Object Lock, gobernanza) de la evidencia que
 *      debe conservarse más allá de su bloqueo actual. Solo extiende; nunca
 *      acorta ni borra.
 *
 * NO suprime nada. Suprimir exige un lote aprobado por dos personas (siguiente
 * etapa); este proceso solo deja a la vista qué correspondería.
 */

const { QueryCommand, ScanCommand, BatchGetCommand, PutCommand } = require('@aws-sdk/lib-dynamodb');
const { ListObjectsV2Command, GetObjectRetentionCommand, PutObjectRetentionCommand } = require('@aws-sdk/client-s3');
const { docClient } = require('../../lib/clients/dynamodb');
const { s3Client } = require('../../lib/clients/s3');
const { registrarFallo } = require('../../lib/degradacion');
const { FUENTES, fuente } = require('../../lib/gobernanza/inventario');
const { planDeRetencion, extensionesDeBloqueo, configDesdeEntorno, INDEFINIDO, sumarAnios } = require('../../lib/gobernanza/retencion');

const tabla = (env) => process.env[env];

/** Cómo leer cada fuente por empresa: consulta por clave o por índice. */
const LECTURA = {
    PERSONAS_TABLE: (t) => ({ KeyConditionExpression: 'PK = :pk', ExpressionAttributeValues: { ':pk': `TENANT#${t}` } }),
    AUSENCIAS_TABLE: (t) => ({ KeyConditionExpression: 'tenantId = :t', ExpressionAttributeValues: { ':t': t } }),
    ESTRUCTURA_TABLE: (t) => ({ KeyConditionExpression: 'tenantId = :t', ExpressionAttributeValues: { ':t': t } }),
    DOCUMENTS_TABLE: (t) => ({ IndexName: 'tenantId-index', KeyConditionExpression: 'tenantId = :t', ExpressionAttributeValues: { ':t': t } }),
    SIGNATURES_TABLE: (t) => ({ IndexName: 'tenantId-index', KeyConditionExpression: 'tenantId = :t', ExpressionAttributeValues: { ':t': t } }),
    SIGNATURE_REQUESTS_TABLE: (t) => ({ IndexName: 'tenantId-index', KeyConditionExpression: 'tenantId = :t', ExpressionAttributeValues: { ':t': t } }),
    ACTIVITIES_TABLE: (t) => ({ IndexName: 'tenantId-index', KeyConditionExpression: 'tenantId = :t', ExpressionAttributeValues: { ':t': t } }),
    INCIDENTS_TABLE: (t) => ({ IndexName: 'tenantId-fecha-index', KeyConditionExpression: 'tenantId = :t', ExpressionAttributeValues: { ':t': t } }),
    SURVEYS_TABLE: (t) => ({ IndexName: 'tenantId-index', KeyConditionExpression: 'tenantId = :t', ExpressionAttributeValues: { ':t': t } }),
    SUGGESTIONS_TABLE: (t) => ({ IndexName: 'tenantId-createdAt-index', KeyConditionExpression: 'tenantId = :t', ExpressionAttributeValues: { ':t': t } }),
};

async function consultarTodo(params) {
    const items = [];
    let desde;
    do {
        const r = await docClient.send(new QueryCommand({ ...params, ExclusiveStartKey: desde }));
        items.push(...(r.Items || []));
        desde = r.LastEvaluatedKey;
    } while (desde);
    return items;
}

/** Ítems completos a partir de claves: los índices pueden proyectar solo claves (D-8). */
async function completos(env, claves) {
    const f = fuente(env);
    const unicos = [...new Map(claves.map((it) => [JSON.stringify(f.clave(it)), f.clave(it)])).values()];
    const res = [];
    for (let i = 0; i < unicos.length; i += 100) {
        let pedido = { [tabla(env)]: { Keys: unicos.slice(i, i + 100) } };
        for (let intento = 0; intento < 5 && pedido && Object.keys(pedido).length; intento += 1) {
            const r = await docClient.send(new BatchGetCommand({ RequestItems: pedido }));
            res.push(...(r.Responses?.[tabla(env)] || []));
            pedido = r.UnprocessedKeys;
        }
        if (pedido && Object.keys(pedido).length) throw new Error(`BatchGet sin terminar en ${env}`);
    }
    return res;
}

/** Registros de una empresa, por fuente. La bandeja se lee solo de quien la necesita. */
async function cargarEmpresa(tenantId) {
    const registros = {};
    for (const [env, params] of Object.entries(LECTURA)) {
        const p = params(tenantId);
        const encontrados = await consultarTodo({ TableName: tabla(env), ...p });
        registros[env] = p.IndexName ? await completos(env, encontrados) : encontrados;
    }
    registros.PERSONAS_TABLE = registros.PERSONAS_TABLE.filter((it) => String(it.SK || '').startsWith('PERSONA#'));
    return registros;
}

/** La bandeja no tiene empresa: se carga por destinatario, solo de las personas vencidas. */
async function cargarBandeja(personaIds) {
    const items = [];
    for (const id of personaIds) {
        items.push(...await consultarTodo({ TableName: tabla('INBOX_TABLE'), KeyConditionExpression: 'recipientId = :r', ExpressionAttributeValues: { ':r': id } }));
    }
    return items;
}

/** Candidatos a extender: objetos cuyo bloqueo por omisión (carga + años del bucket) vence pronto. */
async function extenderBloqueos({ bucket, tenantId, conservarHasta, aSuprimir = [], hoy, config, aniosBloqueoBucket }) {
    const limite = new Date(hoy.getTime() + config.margenBloqueoDias * 86400000);
    const candidatos = [];
    let token;
    do {
        const r = await s3Client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: `tenants/${tenantId}/`, ContinuationToken: token }));
        for (const o of r.Contents || []) {
            // Aproximación barata antes de preguntar por cada objeto: el bloqueo por
            // omisión vence a los N años de la carga. Solo esos se consultan.
            if (sumarAnios(o.LastModified, aniosBloqueoBucket) <= limite) candidatos.push(o.Key);
        }
        token = r.IsTruncated ? r.NextContinuationToken : undefined;
    } while (token);

    const objetos = [];
    for (const key of candidatos) {
        const ret = await s3Client.send(new GetObjectRetentionCommand({ Bucket: bucket, Key: key })).catch((err) => {
            if (err.name === 'NoSuchObjectLockConfiguration') return { Retention: null };
            throw err;
        });
        objetos.push({ key, retenerHasta: ret.Retention?.RetainUntilDate ? new Date(ret.Retention.RetainUntilDate).toISOString() : null });
    }

    // Lo que el plan va a suprimir no se extiende. Un archivo que ningún registro
    // menciona se conserva (regla 5): indefinido.
    const suprimibles = new Set(aSuprimir);
    const plazoDe = (key) => {
        if (suprimibles.has(key)) return null;
        if (!(key in conservarHasta)) return INDEFINIDO;
        const v = conservarHasta[key];
        return v === INDEFINIDO ? INDEFINIDO : new Date(v);
    };
    const extensiones = extensionesDeBloqueo(objetos, plazoDe, { hoy, config });
    for (const e of extensiones) {
        await s3Client.send(new PutObjectRetentionCommand({
            Bucket: bucket, Key: e.key, Retention: { Mode: 'GOVERNANCE', RetainUntilDate: new Date(e.hasta) },
        }));
    }
    return { revisados: candidatos.length, extensiones };
}

const contar = (lista, clave) => lista.reduce((acc, x) => { const k = clave(x); acc[k] = (acc[k] || 0) + 1; return acc; }, {});

/** Plan y bloqueos de UNA empresa. Exportada para las pruebas. */
/**
 * Solo el cálculo: carga la empresa y devuelve el plan, sin guardar nada ni
 * tocar bloqueos. Lo usan este proceso y los lotes de supresión, que lo
 * recalculan al aprobar y al ejecutar para verificar que nada cambió.
 */
async function calcularPlan(empresa, { hoy = new Date(), config = configDesdeEntorno() } = {}) {
    const registros = await cargarEmpresa(empresa.tenantId);
    const previo = planDeRetencion({ personas: registros.PERSONAS_TABLE, registros, empresa, hoy, config });
    const vencidas = previo.personas.filter((p) => p.estado === 'vencida').map((p) => p.personaId);
    if (!vencidas.length) return previo;
    registros.INBOX_TABLE = await cargarBandeja(vencidas);
    return planDeRetencion({ personas: registros.PERSONAS_TABLE, registros, empresa, hoy, config });
}

async function procesarEmpresa(empresa, { hoy = new Date(), config = configDesdeEntorno() } = {}) {
    const tenantId = empresa.tenantId;
    const plan = await calcularPlan(empresa, { hoy, config });
    const vencidas = plan.personas.filter((p) => p.estado === 'vencida').map((p) => p.personaId);

    const bloqueos = await extenderBloqueos({
        bucket: process.env.EVIDENCIA_BUCKET, tenantId, conservarHasta: plan.archivos.conservarHasta, aSuprimir: plan.archivos.suprimir, hoy, config,
        aniosBloqueoBucket: Number(process.env.GOBERNANZA_ANIOS_BLOQUEO_BUCKET || 5),
    });

    const fecha = hoy.toISOString().slice(0, 10);
    const item = {
        tenantId,
        sk: `PLAN#${fecha}`,
        generadoEn: plan.generadoEn,
        resumen: {
            personas: contar(plan.personas, (p) => p.estado),
            acciones: contar(plan.acciones, (a) => `${a.tabla}:${a.accion}`),
            conservados: contar(plan.conservados, (c) => c.porque),
            archivosASuprimir: plan.archivos.suprimir.length,
            bloqueosRevisados: bloqueos.revisados,
            bloqueosExtendidos: bloqueos.extensiones.length,
        },
        // Solo identificadores y claves: el plan es la prueba de lo que se hizo y
        // se conserva después de suprimir, así que no puede traer datos personales.
        personasVencidas: vencidas,
        acciones: plan.acciones.map(({ tabla: t, clave, accion, vencioEl, traza }) => ({ tabla: t, clave, accion, vencioEl, ...(traza ? { traza } : {}) })),
        archivosASuprimir: plan.archivos.suprimir,
        bloqueosExtendidos: bloqueos.extensiones,
        // El plan de hoy reemplaza al de ayer; se guardan los de un año.
        ttl: Math.floor(sumarAnios(hoy, 1).getTime() / 1000),
    };
    await docClient.send(new PutCommand({ TableName: tabla('GOBERNANZA_TABLE'), Item: item }));
    return { plan, item };
}

/** Empresas y su marca de retención legal (sin descifrar nada). */
async function empresas() {
    const res = [];
    let desde;
    do {
        const r = await docClient.send(new ScanCommand({
            TableName: tabla('TENANTS_TABLE'),
            FilterExpression: 'begins_with(PK, :pk) AND begins_with(SK, :sk)',
            ExpressionAttributeValues: { ':pk': 'TENANT#', ':sk': 'METADATA' },
            ProjectionExpression: 'tenantId, retencionLegal',
            ExclusiveStartKey: desde,
        }));
        res.push(...(r.Items || []));
        desde = r.LastEvaluatedKey;
    } while (desde);
    return res.filter((e) => e.tenantId);
}

module.exports.retencionDiaria = async () => {
    const resultado = { empresas: 0, conAcciones: 0, bloqueosExtendidos: 0, fallidas: 0 };
    for (const empresa of await empresas()) {
        resultado.empresas += 1;
        try {
            const { item } = await procesarEmpresa(empresa);
            if (item.acciones.length) resultado.conAcciones += 1;
            resultado.bloqueosExtendidos += item.bloqueosExtendidos.length;
        } catch (err) {
            // Una empresa que falla no detiene a las demás, pero se mide: un plan
            // que no se calcula es un bloqueo que no se extiende.
            resultado.fallidas += 1;
            registrarFallo('gobernanza.retencion', err, { tenantId: empresa.tenantId });
        }
    }
    console.log('[retencion-diaria]', JSON.stringify(resultado));
    return resultado;
};

module.exports.calcularPlan = calcularPlan;
module.exports._interno = { procesarEmpresa, cargarEmpresa, extenderBloqueos, LECTURA, FUENTES };
