/**
 * Progreso de recorridos guiados en DynamoDB.
 *
 * Tabla `RECORRIDOS_TABLE`: `tenantId` (HASH) y `sk = <personaId>#<recorridoId>`
 * (RANGE). La empresa va en la clave de partición, como en las tablas recientes
 * (ausencias, gobernanza), así que una consulta nunca cruza empresas; y la
 * persona encabeza la clave de orden, así que todo su progreso sale con una
 * consulta por prefijo. Quien llama pasa `tenantId` y `personaId` de la sesión.
 *
 * ── Escritura sin pisar a nadie ─────────────────────────────────────────────
 * Leer, fusionar (`fusionar`, regla pura) y escribir con condición sobre la
 * revisión leída. Si otra escritura se metió entremedio (dos pestañas, o la cola
 * sin conexión vaciándose mientras la persona sigue usando la app), la condición
 * falla, se vuelve a leer y se fusiona de nuevo. Como la fusión no depende del
 * orden, el resultado es el mismo que si hubieran llegado en fila.
 */

const { GetCommand, PutCommand, QueryCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient } = require('../clients/dynamodb');
const P = require('./progreso');

const T = () => process.env.RECORRIDOS_TABLE;
const PERSONAS = () => process.env.PERSONAS_TABLE;

const INTENTOS = 3;

const fallo = (mensaje, codigo) => Object.assign(new Error(mensaje), { codigo });

async function todo(params) {
    const items = [];
    let desde;
    do {
        const r = await docClient.send(new QueryCommand({ ...params, ExclusiveStartKey: desde }));
        items.push(...(r.Items || []));
        desde = r.LastEvaluatedKey;
    } while (desde);
    return items;
}

const dePersona = (tenantId, personaId) => ({
    TableName: T(),
    KeyConditionExpression: 'tenantId = :t AND begins_with(sk, :p)',
    ExpressionAttributeValues: { ':t': tenantId, ':p': P.prefijoPersona(personaId) },
});

/** Todo el progreso de la persona en la empresa. */
async function listar(tenantId, personaId) {
    const items = await todo(dePersona(tenantId, personaId));
    return items.map(P.vista).sort((a, b) => a.recorridoId.localeCompare(b.recorridoId));
}

/**
 * ¿La persona existe en la empresa y su tratamiento está bloqueado por una
 * solicitud del titular (Ley 21.719)? Registrar progreso nuevo es tratar sus
 * datos, así que con un bloqueo no se escribe (decisión 10 de la Fase 0).
 *
 * @returns {Promise<{existe: boolean, bloqueada: boolean}>}
 */
async function estadoPersona(tenantId, personaId) {
    const r = await docClient.send(new GetCommand({
        TableName: PERSONAS(),
        Key: { PK: `TENANT#${tenantId}`, SK: `PERSONA#${personaId}` },
        ProjectionExpression: 'personaId, solicitudesBloqueo',
    }));
    const it = r.Item;
    if (!it) return { existe: false, bloqueada: false };
    const bloqueo = it.solicitudesBloqueo;
    const n = bloqueo instanceof Set ? bloqueo.size : Array.isArray(bloqueo) ? bloqueo.length : 0;
    return { existe: true, bloqueada: n > 0 };
}

/** Cuántos recorridos tiene registrados la persona. Solo se pregunta al crear uno. */
async function contar(tenantId, personaId) {
    const items = await todo({ ...dePersona(tenantId, personaId), ProjectionExpression: 'sk' });
    return items.length;
}

/**
 * Registra un evento de progreso, ya validado (`validarEntrada`).
 *
 * @returns {Promise<{progreso: object, escrito: boolean}>} `escrito`: false si lo
 *          que llegó no cambiaba nada (repetido o de una versión anterior).
 */
async function registrar(tenantId, personaId, entrada, { ahora = new Date() } = {}) {
    const sk = P.claveOrden(personaId, entrada.recorridoId);
    for (let intento = 0; intento < INTENTOS; intento += 1) {
        const actual = (await docClient.send(new GetCommand({ TableName: T(), Key: { tenantId, sk }, ConsistentRead: true }))).Item || null;

        if (!actual && await contar(tenantId, personaId) >= P.LIMITES.RECORRIDOS_POR_PERSONA) {
            throw fallo('Se alcanzó el máximo de recorridos registrados para esta persona.', 'LIMITE_RECORRIDOS');
        }

        const { progreso, cambia } = P.fusionar(actual, entrada);
        if (!cambia) return { progreso: P.vista(actual), escrito: false };

        const rev = (actual?.rev || 0) + 1;
        const item = {
            tenantId, sk, personaId, recorridoId: entrada.recorridoId,
            ...progreso,
            rev,
            creadoEn: actual?.creadoEn || ahora.toISOString(),
            actualizadoEn: ahora.toISOString(),
        };
        try {
            await docClient.send(new PutCommand({
                TableName: T(),
                Item: item,
                ...(actual
                    ? { ConditionExpression: 'rev = :rev', ExpressionAttributeValues: { ':rev': actual.rev } }
                    : { ConditionExpression: 'attribute_not_exists(sk)' }),
            }));
            return { progreso: P.vista(item), escrito: true };
        } catch (err) {
            if (err.name !== 'ConditionalCheckFailedException') throw err;
        }
    }
    throw fallo('El progreso cambió mientras se guardaba. Vuelve a intentarlo.', 'CAMBIO_CONCURRENTE');
}

module.exports = { listar, registrar, estadoPersona, INTENTOS };
