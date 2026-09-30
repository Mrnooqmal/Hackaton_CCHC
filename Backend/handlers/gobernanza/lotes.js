/**
 * Lotes de supresión (Ley 21.719, D-15): proponer, ver, aprobar y ejecutar.
 * Reglas en `lib/gobernanza/lotes.js`.
 *
 *   GET  /gobernanza/lotes                   listar
 *   POST /gobernanza/lotes                   proponer: { origen: 'retencion' } o { origen: 'solicitud', solicitudId }
 *   GET  /gobernanza/lotes/{id}              detalle legible + si sigue vigente
 *   POST /gobernanza/lotes/{id}/aprobar      { huella }
 *   POST /gobernanza/lotes/{id}/ejecutar     { huella }  (otra persona que quien aprobó)
 *
 * Esta función corre con `RolSupresion`, el ÚNICO rol del sistema que puede
 * borrar ítems de datos personales y versiones de S3 con bypass de la
 * retención. Nada más corre con él: el borrado solo puede pasar por acá, por
 * un lote aprobado y ejecutado por dos personas distintas.
 *
 * No guarda datos personales en el lote: claves, identificadores y la huella.
 * Los nombres para mostrar se resuelven al abrir el detalle.
 */

const { v4: uuidv4 } = require('uuid');
const { GetCommand, QueryCommand, BatchGetCommand, PutCommand, UpdateCommand, DeleteCommand, TransactWriteCommand } = require('@aws-sdk/lib-dynamodb');
const { ListObjectVersionsCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { docClient } = require('../../lib/clients/dynamodb');
const { s3Client } = require('../../lib/clients/s3');
const { success, error, created, cors } = require('../../lib/utils/response');
const { conSesion, sesionPuede } = require('../../lib/auth/sesion');
const { PERMISSIONS } = require('../../lib/permissions');
const { bucketDeClave, esDeLaEmpresa } = require('../../lib/almacenamiento');
const { fuente } = require('../../lib/gobernanza/inventario');
const L = require('../../lib/gobernanza/lotes');
const D = require('../../lib/gobernanza/derechos');
const { calcularPlan } = require('./retencion');

const T = (env) => process.env[env];
const skLote = (id) => `LOTE#${id}`;

const ESTADO_POR_CODIGO = {
    LOTE_VACIO: 400, LOTE_GRANDE: 400, ORIGEN_INVALIDO: 400, SIN_ACTOR: 400,
    SOLICITUD_NO_SUPRIMIBLE: 409, ESTADO_INVALIDO: 409, HUELLA_DISTINTA: 409, DESACTUALIZADO: 409, CAMBIO_CONCURRENTE: 409,
    MISMA_PERSONA: 403,
    LOTE_ALTERADO: 409,
};
const error409 = (m, c) => Object.assign(new Error(m), { codigo: c });

// ─── Contenido actual (se recalcula al proponer, aprobar y ejecutar) ─────────

async function versionesDe(tenantId, keys) {
    const res = {};
    for (const key of keys) {
        if (!esDeLaEmpresa(key, tenantId)) throw error409('Un archivo del plan no es de esta empresa.', 'ESTADO_INVALIDO');
        const versiones = [];
        let marcador; let marcadorVersion;
        do {
            const r = await s3Client.send(new ListObjectVersionsCommand({ Bucket: bucketDeClave(key), Prefix: key, KeyMarker: marcador, VersionIdMarker: marcadorVersion }));
            for (const v of [...(r.Versions || []), ...(r.DeleteMarkers || [])]) if (v.Key === key) versiones.push(v.VersionId);
            marcador = r.IsTruncated ? r.NextKeyMarker : undefined;
            marcadorVersion = r.IsTruncated ? r.NextVersionIdMarker : undefined;
        } while (marcador);
        res[key] = versiones;
    }
    return res;
}

async function empresa(tenantId) {
    const r = await docClient.send(new QueryCommand({
        TableName: T('TENANTS_TABLE'), KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
        ExpressionAttributeValues: { ':pk': `TENANT#${tenantId}`, ':sk': 'METADATA' },
    }));
    const it = (r.Items || [])[0] || {};
    return { tenantId, retencionLegal: it.retencionLegal || null };
}

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

async function contenidoActual(tenantId, ambito, { hoy = new Date() } = {}) {
    if (ambito.origen === L.ORIGENES.RETENCION) {
        const plan = await calcularPlan(await empresa(tenantId), { hoy });
        return L.contenidoDesdePlan(plan, await versionesDe(tenantId, plan.archivos.suprimir));
    }
    if (ambito.origen === L.ORIGENES.SOLICITUD) {
        const s = (await docClient.send(new GetCommand({ TableName: T('GOBERNANZA_TABLE'), Key: { tenantId, sk: `SOLICITUD#${ambito.solicitudId}` }, ConsistentRead: true }))).Item;
        const acogida = s && s.derecho === D.DERECHOS.SUPRESION && s.estado === D.ESTADOS.RESUELTA && s.respuesta?.resultado !== D.RESULTADOS.RECHAZADA;
        if (!acogida) throw error409('Solo se ejecuta la supresión de una solicitud de supresión respondida y acogida.', 'SOLICITUD_NO_SUPRIMIBLE');
        const persona = (await docClient.send(new GetCommand({ TableName: T('PERSONAS_TABLE'), Key: { PK: `TENANT#${tenantId}`, SK: `PERSONA#${s.personaId}` }, ConsistentRead: true }))).Item || null;
        const bandeja = await todo({ TableName: T('INBOX_TABLE'), KeyConditionExpression: 'recipientId = :r', ExpressionAttributeValues: { ':r': s.personaId } });
        const clavesSug = await todo({
            TableName: T('SUGGESTIONS_TABLE'), IndexName: 'tenantId-createdAt-index', KeyConditionExpression: 'tenantId = :t',
            ExpressionAttributeValues: { ':t': tenantId },
        });
        const sugerencias = [];
        for (let i = 0; i < clavesSug.length; i += 100) {
            const r = await docClient.send(new BatchGetCommand({ RequestItems: { [T('SUGGESTIONS_TABLE')]: { Keys: clavesSug.slice(i, i + 100).map((x) => ({ suggestionId: x.suggestionId })) } } }));
            sugerencias.push(...(r.Responses?.[T('SUGGESTIONS_TABLE')] || []).filter((g) => g.userId === s.personaId));
        }
        return L.contenidoDesdeSolicitud({ persona, bandeja, sugerencias });
    }
    throw error409('Origen de lote no reconocido', 'ORIGEN_INVALIDO');
}

// ─── Ejecución ──────────────────────────────────────────────────────────────

async function ejecutarOperacion(op) {
    const f = fuente(op.tabla);
    const tabla = T(op.tabla);
    if (op.accion === 'suprimir') {
        await docClient.send(new DeleteCommand({ TableName: tabla, Key: op.clave }));
    } else if (op.accion === 'anonimizar' || op.accion === 'quitar_campos') {
        const nombres = Object.fromEntries(op.campos.map((c, i) => [`#c${i}`, c]));
        await docClient.send(new UpdateCommand({
            TableName: tabla, Key: op.clave,
            UpdateExpression: `REMOVE ${Object.keys(nombres).join(', ')} SET #anon = :en`,
            // Si el ítem ya no está (suprimido antes), no se recrea vacío.
            ConditionExpression: `attribute_exists(${f.claves[0]})`,
            ExpressionAttributeNames: { ...nombres, '#anon': op.accion === 'anonimizar' ? 'anonimizadoEl' : 'camposSuprimidosEl' },
            ExpressionAttributeValues: { ':en': new Date().toISOString() },
        })).catch((err) => { if (err.name !== 'ConditionalCheckFailedException') throw err; });
    } else {
        throw new Error(`Acción desconocida: ${op.accion}`);
    }
    if (op.traza) await docClient.send(new DeleteCommand({ TableName: tabla, Key: op.traza }));
}

async function ejecutarContenido(tenantId, contenido) {
    const resultado = { operaciones: 0, versiones: 0, errores: [] };
    for (const op of contenido.operaciones) {
        try { await ejecutarOperacion(op); resultado.operaciones += 1; } catch (err) {
            resultado.errores.push({ tabla: op.tabla, clave: op.clave, error: err.name || 'Error' });
        }
    }
    for (const a of contenido.archivos) {
        if (!esDeLaEmpresa(a.key, tenantId)) { resultado.errores.push({ key: a.key, error: 'OtraEmpresa' }); continue; }
        for (const versionId of a.versiones) {
            try {
                await s3Client.send(new DeleteObjectCommand({ Bucket: bucketDeClave(a.key), Key: a.key, VersionId: versionId, BypassGovernanceRetention: true }));
                resultado.versiones += 1;
            } catch (err) {
                resultado.errores.push({ key: a.key, versionId, error: err.name || 'Error' });
            }
        }
    }
    return resultado;
}

// ─── Operaciones de la API ──────────────────────────────────────────────────

async function obtenerLote(tenantId, id) {
    return (await docClient.send(new GetCommand({ TableName: T('GOBERNANZA_TABLE'), Key: { tenantId, sk: skLote(id) }, ConsistentRead: true }))).Item || null;
}

async function marcarDesactualizado(tenantId, lote, ahora) {
    await docClient.send(new UpdateCommand({
        TableName: T('GOBERNANZA_TABLE'), Key: { tenantId, sk: lote.sk },
        UpdateExpression: 'SET estado = :d, desactualizadoEl = :ahora',
        ConditionExpression: 'estado = :e', ExpressionAttributeValues: { ':d': L.ESTADOS.DESACTUALIZADO, ':e': lote.estado, ':ahora': ahora.toISOString() },
    })).catch(() => {});
}

async function proponer(tenantId, body, actor, { ahora }) {
    const ambito = body.origen === L.ORIGENES.SOLICITUD ? { origen: L.ORIGENES.SOLICITUD, solicitudId: body.solicitudId } : { origen: body.origen };
    const contenido = await contenidoActual(tenantId, ambito, { hoy: ahora });
    L.validarTamano(contenido);
    const loteId = uuidv4();
    const lote = {
        tenantId, sk: skLote(loteId), loteId, ambito, contenido, huella: L.huellaDe(contenido),
        estado: L.ESTADOS.PROPUESTO, propuestoPor: actor, propuestoEl: ahora.toISOString(),
    };
    await docClient.send(new PutCommand({ TableName: T('GOBERNANZA_TABLE'), Item: lote, ConditionExpression: 'attribute_not_exists(sk)' }));
    return created(lote);
}

async function aprobar(tenantId, id, body, actor, { ahora }) {
    const lote = await obtenerLote(tenantId, id);
    if (!lote) return error('Lote no encontrado', 404);
    const actual = L.huellaDe(await contenidoActual(tenantId, lote.ambito, { hoy: ahora }));
    try {
        L.validarAprobacion(lote, { huellaVista: body.huella, huellaActual: actual });
    } catch (err) {
        if (err.codigo === 'DESACTUALIZADO') await marcarDesactualizado(tenantId, lote, ahora);
        throw err;
    }
    try {
        await docClient.send(new UpdateCommand({
            TableName: T('GOBERNANZA_TABLE'), Key: { tenantId, sk: lote.sk },
            UpdateExpression: 'SET estado = :a, aprobadoPor = :por, aprobadoEl = :ahora',
            ConditionExpression: 'estado = :p AND huella = :h',
            ExpressionAttributeValues: { ':a': L.ESTADOS.APROBADO, ':p': L.ESTADOS.PROPUESTO, ':h': lote.huella, ':por': actor, ':ahora': ahora.toISOString() },
        }));
    } catch (err) {
        if (err.name === 'ConditionalCheckFailedException') throw error409('El lote cambió mientras se aprobaba. Vuelve a abrirlo.', 'CAMBIO_CONCURRENTE');
        throw err;
    }
    return success({ ...lote, estado: L.ESTADOS.APROBADO, aprobadoPor: actor, aprobadoEl: ahora.toISOString() });
}

async function ejecutar(tenantId, id, body, actor, { ahora }) {
    const lote = await obtenerLote(tenantId, id);
    if (!lote) return error('Lote no encontrado', 404);
    const actual = L.huellaDe(await contenidoActual(tenantId, lote.ambito, { hoy: ahora }));
    try {
        L.validarEjecucion(lote, { huellaVista: body.huella, huellaActual: actual, actor });
    } catch (err) {
        if (err.codigo === 'DESACTUALIZADO') await marcarDesactualizado(tenantId, lote, ahora);
        throw err;
    }
    // Se toma el lote para ejecutarlo (nadie más puede empezar a la vez).
    try {
        await docClient.send(new UpdateCommand({
            TableName: T('GOBERNANZA_TABLE'), Key: { tenantId, sk: lote.sk },
            UpdateExpression: 'SET estado = :x, ejecutadoPor = :por, ejecucionIniciadaEl = :ahora',
            ConditionExpression: 'estado = :a AND huella = :h AND aprobadoPor.personaId <> :yo',
            ExpressionAttributeValues: { ':x': 'ejecutando', ':a': L.ESTADOS.APROBADO, ':h': lote.huella, ':yo': actor.personaId, ':por': actor, ':ahora': ahora.toISOString() },
        }));
    } catch (err) {
        if (err.name === 'ConditionalCheckFailedException') throw error409('El lote cambió mientras se iniciaba la ejecución.', 'CAMBIO_CONCURRENTE');
        throw err;
    }

    // Se ejecuta el contenido GUARDADO (el aprobado), que coincide con el actual.
    const resultado = await ejecutarContenido(tenantId, lote.contenido);
    const estado = resultado.errores.length ? L.ESTADOS.EJECUTADO_CON_ERRORES : L.ESTADOS.EJECUTADO;
    await docClient.send(new UpdateCommand({
        TableName: T('GOBERNANZA_TABLE'), Key: { tenantId, sk: lote.sk },
        UpdateExpression: 'SET estado = :e, ejecutadoEl = :ahora, resultado = :r',
        ExpressionAttributeValues: { ':e': estado, ':ahora': new Date().toISOString(), ':r': resultado },
    }));

    // Historial: la supresión queda como evidencia. Si vino de una solicitud, se
    // registra en esa solicitud y se levanta el bloqueo que la esperaba.
    const idHistorial = lote.ambito.origen === L.ORIGENES.SOLICITUD ? lote.ambito.solicitudId : `lote-${lote.loteId}`;
    const datosEvento = { loteId: lote.loteId, huella: lote.huella, aprobadoPor: lote.aprobadoPor, operaciones: resultado.operaciones, versiones: resultado.versiones, errores: resultado.errores.length };
    const items = [{ Put: { TableName: T('GOBERNANZA_HISTORIAL_TABLE'), Item: D.evento(tenantId, idHistorial, D.EVENTOS.SUPRESION, datosEvento, actor, { ahora }), ConditionExpression: 'attribute_not_exists(sk)' } }];
    if (lote.ambito.origen === L.ORIGENES.SOLICITUD && !resultado.errores.length) {
        const personaId = lote.contenido.personas[0];
        items.push({
            Update: {
                TableName: T('PERSONAS_TABLE'), Key: { PK: `TENANT#${tenantId}`, SK: `PERSONA#${personaId}` },
                UpdateExpression: 'DELETE solicitudesBloqueo :s', ConditionExpression: 'attribute_exists(PK)',
                ExpressionAttributeValues: { ':s': new Set([lote.ambito.solicitudId]) },
            },
        });
        items.push({ Put: { TableName: T('GOBERNANZA_HISTORIAL_TABLE'), Item: D.evento(tenantId, idHistorial, D.EVENTOS.DESBLOQUEO, { personaId }, actor, { ahora, n: 1 }), ConditionExpression: 'attribute_not_exists(sk)' } });
    }
    await docClient.send(new TransactWriteCommand({ TransactItems: items }));
    return success({ ...lote, estado, resultado, ejecutadoPor: actor });
}

async function listar(tenantId) {
    const items = await todo({
        TableName: T('GOBERNANZA_TABLE'), KeyConditionExpression: 'tenantId = :t AND begins_with(sk, :p)',
        ExpressionAttributeValues: { ':t': tenantId, ':p': 'LOTE#' },
    });
    // Sin el contenido en el listado: puede ser largo.
    const lotes = items.map(({ contenido, ...resto }) => ({ ...resto, operaciones: contenido.operaciones.length, archivos: contenido.archivos.length, personas: contenido.personas.length }))
        .sort((a, b) => b.propuestoEl.localeCompare(a.propuestoEl));
    return success({ lotes });
}

async function detalle(tenantId, id, { ahora }) {
    const lote = await obtenerLote(tenantId, id);
    if (!lote) return error('Lote no encontrado', 404);
    let vigente = null;
    if ([L.ESTADOS.PROPUESTO, L.ESTADOS.APROBADO].includes(lote.estado)) {
        vigente = L.huellaDe(await contenidoActual(tenantId, lote.ambito, { hoy: ahora }).catch(() => ({}))) === lote.huella;
    }
    // Lo que ve quien aprueba: qué es cada operación, en palabras.
    const descripciones = lote.contenido.operaciones.map((op) => ({
        ...op, que: fuente(op.tabla)?.nombre || op.tabla,
    }));
    return success({ ...lote, contenido: { ...lote.contenido, operaciones: descripciones }, vigente });
}

// ─── Ruteo ──────────────────────────────────────────────────────────────────

module.exports.atender = async (event, { ahora = new Date() } = {}) => {
    const method = event.requestContext?.http?.method || event.httpMethod;
    if (method === 'OPTIONS') return cors();
    const ses = conSesion(event);
    if (!ses.ok) return ses.respuesta;
    const sesion = ses.sesion;
    if (!sesionPuede(sesion, PERMISSIONS.EMPRESA_SUPRESION_DATOS)) return error('No tienes permiso para gestionar supresiones', 403);
    const tenantId = sesion.tenantId;
    const [, id, accion] = (event.rawPath || '').replace(/^\/gobernanza\/?/, '').split('/').filter(Boolean);
    let body = {};
    if (method === 'POST') { try { body = JSON.parse(event.body || '{}'); } catch { return error('Cuerpo inválido', 400); } }
    // Quién actúa sale de la sesión; su nombre, de su ficha (texto en claro, sin descifrar nada).
    const yo = (await docClient.send(new GetCommand({ TableName: T('PERSONAS_TABLE'), Key: { PK: `TENANT#${tenantId}`, SK: `PERSONA#${sesion.personaId}` } })).catch(() => ({}))).Item;
    const actor = { personaId: sesion.personaId, nombre: [yo?.nombre, yo?.apellidoPaterno || yo?.apellido].filter(Boolean).join(' ').trim() || null };
    try {
        if (method === 'GET' && !id) return await listar(tenantId);
        if (method === 'GET' && id && !accion) return await detalle(tenantId, id, { ahora });
        if (method === 'POST' && !id) return await proponer(tenantId, body, actor, { ahora });
        if (method === 'POST' && accion === 'aprobar') return await aprobar(tenantId, id, body, actor, { ahora });
        if (method === 'POST' && accion === 'ejecutar') return await ejecutar(tenantId, id, body, actor, { ahora });
        return error('Ruta no encontrada', 404);
    } catch (err) {
        const estado = ESTADO_POR_CODIGO[err.codigo];
        if (estado) return error(err.message, estado);
        throw err;
    }
};

module.exports.handler = async (event) => module.exports.atender(event);
module.exports._interno = { contenidoActual, ejecutarContenido };
