/**
 * Derechos del titular (Ley 21.719): la herramienta con que la constructora
 * —responsable del tratamiento— registra y responde las solicitudes de sus
 * trabajadores. Las reglas están en `lib/gobernanza/derechos.js`.
 *
 *   POST /gobernanza/solicitudes                    registrar (y bloquear si corresponde)
 *   GET  /gobernanza/solicitudes                    listar, con plazo vigente y alertas
 *   GET  /gobernanza/solicitudes/{id}               detalle con su historial
 *   POST /gobernanza/solicitudes/{id}/prorroga      registrar la prórroga (solo a tiempo)
 *   POST /gobernanza/solicitudes/{id}/respuesta     responder y cerrar
 *
 * ── Cada cambio es UNA transacción ──────────────────────────────────────────
 * La solicitud, el bloqueo de la persona y los eventos del historial se
 * escriben juntos: no puede quedar una solicitud sin su registro en el
 * historial, ni un bloqueo sin la solicitud que lo causa, ni un "bloqueo
 * aplicado" que en realidad no se aplicó.
 *
 * ── Lo inmutable ────────────────────────────────────────────────────────────
 * La fecha de recepción (y el vencimiento que se calcula de ella) se escriben
 * al crear y ninguna actualización los toca: todas las actualizaciones de este
 * archivo están en `ACTUALIZACIONES`, y una prueba verifica que ninguna los
 * nombre. Además el evento `solicitud` del historial —que nadie puede editar—
 * guarda la fecha original.
 *
 * Todo exige el permiso `empresa.derechos_titulares`, y el titular tiene que
 * ser de la empresa de la sesión.
 */

const { v4: uuidv4 } = require('uuid');
const { GetCommand, QueryCommand, TransactWriteCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient } = require('../../lib/clients/dynamodb');
const { success, error, created, cors } = require('../../lib/utils/response');
const { conSesion, sesionPuede } = require('../../lib/auth/sesion');
const { PERMISSIONS } = require('../../lib/permissions');
const { PersonaService } = require('../../lib/services/PersonaService');
const D = require('../../lib/gobernanza/derechos');

const personaService = new PersonaService();
const TABLA = () => process.env.GOBERNANZA_TABLE;
const HISTORIAL = () => process.env.GOBERNANZA_HISTORIAL_TABLE;
const PERSONAS = () => process.env.PERSONAS_TABLE;

const skSolicitud = (id) => `SOLICITUD#${id}`;

/**
 * Todas las actualizaciones de una solicitud. Ninguna nombra `recibidaEl`,
 * `registradaEl` ni `venceEl`: son inmutables (tests/derechos-api.test.js).
 */
const ACTUALIZACIONES = {
    prorroga: 'SET prorroga = :p, actualizadaEl = :ahora',
    respuesta: 'SET respuesta = :r, estado = :resuelta, actualizadaEl = :ahora',
};

/** Estado HTTP de cada rechazo de las reglas. */
const ESTADO_POR_CODIGO = {
    SIN_TITULAR: 400, DERECHO_INVALIDO: 400, CANAL_REQUERIDO: 400, RECEPCION_REQUERIDA: 400, RECEPCION_FUTURA: 400,
    PRORROGA_SIN_FECHA: 400, PRORROGA_FUTURA: 400, PRORROGA_INVALIDA: 400, MOTIVO_REQUERIDO: 400,
    RESULTADO_INVALIDO: 400, FUNDAMENTO_REQUERIDO: 400,
    PRORROGA_TARDIA: 409, PRORROGA_USADA: 409, SOLICITUD_CERRADA: 409, CAMBIO_CONCURRENTE: 409,
};

const nombreDe = (p) => [p?.nombre, p?.apellidoPaterno || p?.apellido].filter(Boolean).join(' ').trim() || null;

/** Eventos del historial como operaciones de la transacción: solo se agregan. */
const aHistorial = (eventos) => eventos.map((ev) => ({
    Put: { TableName: HISTORIAL(), Item: ev, ConditionExpression: 'attribute_not_exists(sk)' },
}));

/** Lo que el historial guarda de una solicitud: fechas y decisión, no el detalle. */
const resumenSolicitud = (s) => ({
    personaId: s.personaId, derecho: s.derecho, canal: s.canal,
    recibidaEl: s.recibidaEl, registradaEl: s.registradaEl, venceEl: s.venceEl,
});

async function obtener(tenantId, solicitudId) {
    const r = await docClient.send(new GetCommand({ TableName: TABLA(), Key: { tenantId, sk: skSolicitud(solicitudId) }, ConsistentRead: true }));
    return r.Item || null;
}

async function historialDe(tenantId, solicitudId) {
    const items = [];
    let desde;
    do {
        const r = await docClient.send(new QueryCommand({
            TableName: HISTORIAL(), KeyConditionExpression: 'tenantId = :t AND begins_with(sk, :p)',
            ExpressionAttributeValues: { ':t': tenantId, ':p': `HIST#${solicitudId}#` }, ExclusiveStartKey: desde,
        }));
        items.push(...(r.Items || []));
        desde = r.LastEvaluatedKey;
    } while (desde);
    return items;
}

const conPlazo = (s, ahora, config) => ({ ...s, plazoVigente: D.plazoVigente(s).toISOString(), alertas: D.alertasDe(s, { ahora, config }) });

async function transaccion(items) {
    try {
        await docClient.send(new TransactWriteCommand({ TransactItems: items }));
    } catch (err) {
        if (err.name === 'TransactionCanceledException') {
            throw Object.assign(new Error('La solicitud cambió mientras se procesaba. Revisa su estado y vuelve a intentar.'), { codigo: 'CAMBIO_CONCURRENTE' });
        }
        throw err;
    }
}

// ─── Operaciones ────────────────────────────────────────────────────────────

async function registrar(tenantId, body, actor, { ahora, config }) {
    const titular = body.personaId ? await personaService.getById(body.personaId) : null;
    if (!titular || titular.tenantId !== tenantId) return error('La persona no es de esta empresa', 404);

    const solicitudId = uuidv4();
    const s = D.nuevaSolicitud(body, actor, { ahora, config, solicitudId });
    const eventos = [D.evento(tenantId, solicitudId, D.EVENTOS.SOLICITUD, resumenSolicitud(s), actor, { ahora, n: 0 })];
    const items = [];

    if (s.bloqueo.exigido) {
        // El bloqueo se aplica en la misma escritura que registra la solicitud:
        // "aplicado" solo si de verdad quedó aplicado.
        s.bloqueo.aplicadoEl = ahora.toISOString();
        items.push({
            Update: {
                TableName: PERSONAS(),
                Key: { PK: `TENANT#${tenantId}`, SK: `PERSONA#${s.personaId}` },
                UpdateExpression: 'ADD solicitudesBloqueo :s SET updatedAt = :ahora',
                ConditionExpression: 'attribute_exists(PK)',
                ExpressionAttributeValues: { ':s': new Set([solicitudId]), ':ahora': ahora.toISOString() },
            },
        });
        eventos.push(D.evento(tenantId, solicitudId, D.EVENTOS.BLOQUEO,
            { personaId: s.personaId, plazoHasta: s.bloqueo.plazoHasta, aplicadoEl: s.bloqueo.aplicadoEl }, actor, { ahora, n: 1 }));
    }

    items.unshift({ Put: { TableName: TABLA(), Item: { tenantId, sk: skSolicitud(solicitudId), ...s }, ConditionExpression: 'attribute_not_exists(sk)' } });
    await transaccion([...items, ...aHistorial(eventos)]);
    return created(conPlazo(s, ahora, config));
}

async function prorrogar(tenantId, solicitudId, body, actor, { ahora, config }) {
    const s = await obtener(tenantId, solicitudId);
    if (!s) return error('Solicitud no encontrada', 404);
    const p = D.prorrogar(s, body, actor, { ahora, config });
    await transaccion([
        {
            Update: {
                TableName: TABLA(), Key: { tenantId, sk: skSolicitud(solicitudId) },
                UpdateExpression: ACTUALIZACIONES.prorroga,
                // Sigue abierta, sin prórroga, y el primer plazo no ha vencido
                // AHORA (no cuando se leyó): la regla se repite en la escritura.
                ConditionExpression: 'estado = :abierta AND (attribute_not_exists(prorroga) OR prorroga = :nulo) AND venceEl >= :ahora',
                ExpressionAttributeValues: { ':p': p, ':ahora': ahora.toISOString(), ':abierta': D.ESTADOS.ABIERTA, ':nulo': null },
            },
        },
        ...aHistorial([D.evento(tenantId, solicitudId, D.EVENTOS.PRORROGA,
            { comunicadaEl: p.comunicadaEl, medio: p.medio, motivo: p.motivo, venceEl: p.venceEl, venceElOriginal: s.venceEl }, actor, { ahora })]),
    ]);
    return success(conPlazo({ ...s, prorroga: p }, ahora, config));
}

async function responder(tenantId, solicitudId, body, actor, { ahora, config }) {
    const s = await obtener(tenantId, solicitudId);
    if (!s) return error('Solicitud no encontrada', 404);
    const r = D.responder(s, body, actor, { ahora });
    const eventos = [D.evento(tenantId, solicitudId, D.EVENTOS.RESPUESTA,
        { resultado: r.resultado, fundamento: r.fundamento, medio: r.medio, dentroDePlazo: r.dentroDePlazo, plazoVigente: D.plazoVigente(s).toISOString() },
        actor, { ahora, n: 0 })];
    const items = [{
        Update: {
            TableName: TABLA(), Key: { tenantId, sk: skSolicitud(solicitudId) },
            UpdateExpression: ACTUALIZACIONES.respuesta,
            ConditionExpression: 'estado = :abierta',
            ExpressionAttributeValues: { ':r': r, ':resuelta': D.ESTADOS.RESUELTA, ':abierta': D.ESTADOS.ABIERTA, ':ahora': ahora.toISOString() },
        },
    }];

    // Una supresión acogida mantiene el bloqueo hasta que se ejecute (lote con
    // aprobación de dos personas). El resto lo levanta al responder.
    const suprimir = s.derecho === D.DERECHOS.SUPRESION && r.resultado !== D.RESULTADOS.RECHAZADA;
    if (s.bloqueo?.exigido && s.bloqueo.aplicadoEl && !suprimir) {
        items.push({
            Update: {
                TableName: PERSONAS(),
                Key: { PK: `TENANT#${tenantId}`, SK: `PERSONA#${s.personaId}` },
                UpdateExpression: 'DELETE solicitudesBloqueo :s SET updatedAt = :ahora',
                ConditionExpression: 'attribute_exists(PK)',
                ExpressionAttributeValues: { ':s': new Set([solicitudId]), ':ahora': ahora.toISOString() },
            },
        });
        eventos.push(D.evento(tenantId, solicitudId, D.EVENTOS.DESBLOQUEO, { personaId: s.personaId }, actor, { ahora, n: 1 }));
    }
    await transaccion([...items, ...aHistorial(eventos)]);
    return success(conPlazo({ ...s, respuesta: r, estado: D.ESTADOS.RESUELTA }, ahora, config));
}

async function listar(tenantId, query, { ahora, config }) {
    const items = [];
    let desde;
    do {
        const r = await docClient.send(new QueryCommand({
            TableName: TABLA(), KeyConditionExpression: 'tenantId = :t AND begins_with(sk, :p)',
            ExpressionAttributeValues: { ':t': tenantId, ':p': 'SOLICITUD#' }, ExclusiveStartKey: desde,
        }));
        items.push(...(r.Items || []));
        desde = r.LastEvaluatedKey;
    } while (desde);
    const filtradas = query.estado ? items.filter((s) => s.estado === query.estado) : items;
    const ordenadas = filtradas.map((s) => conPlazo(s, ahora, config)).sort((a, b) => a.plazoVigente.localeCompare(b.plazoVigente));
    return success({ solicitudes: ordenadas, total: ordenadas.length });
}

// ─── Ruteo ──────────────────────────────────────────────────────────────────

module.exports.atender = async (event, { ahora = new Date(), config = D.configDesdeEntorno() } = {}) => {
    const method = event.requestContext?.http?.method || event.httpMethod;
    if (method === 'OPTIONS') return cors();
    const ses = conSesion(event);
    if (!ses.ok) return ses.respuesta;
    const sesion = ses.sesion;
    if (!sesionPuede(sesion, PERMISSIONS.EMPRESA_DERECHOS_TITULARES)) {
        return error('No tienes permiso para gestionar las solicitudes de los titulares', 403);
    }
    const tenantId = sesion.tenantId;
    const partes = (event.rawPath || event.path || '').replace(/^\/gobernanza\/?/, '').split('/').filter(Boolean);
    const [recurso, id, accion] = partes;
    if (recurso !== 'solicitudes') return error('Ruta no encontrada', 404);

    let body = {};
    if (method === 'POST') {
        try { body = JSON.parse(event.body || '{}'); } catch { return error('Cuerpo inválido', 400); }
    }

    try {
        if (method === 'GET' && !id) return await listar(tenantId, event.queryStringParameters || {}, { ahora, config });
        if (method === 'GET' && id && !accion) {
            const s = await obtener(tenantId, id);
            if (!s) return error('Solicitud no encontrada', 404);
            const historial = await historialDe(tenantId, id);
            return success({ ...conPlazo(s, ahora, config), historial });
        }

        // Quién actúa sale de la sesión; su nombre, de su ficha.
        const yo = await personaService.getById(sesion.personaId).catch(() => null);
        const actor = { personaId: sesion.personaId, nombre: nombreDe(yo) };

        if (method === 'POST' && !id) return await registrar(tenantId, body, actor, { ahora, config });
        if (method === 'POST' && id && accion === 'prorroga') return await prorrogar(tenantId, id, body, actor, { ahora, config });
        if (method === 'POST' && id && accion === 'respuesta') return await responder(tenantId, id, body, actor, { ahora, config });
        return error('Ruta no encontrada', 404);
    } catch (err) {
        const estado = ESTADO_POR_CODIGO[err.codigo];
        if (estado) return error(err.message, estado);
        throw err;
    }
};

module.exports.handler = async (event) => module.exports.atender(event);

// ─── Aviso diario de plazos ─────────────────────────────────────────────────

const TEXTO_ALERTA = {
    por_vencer: (d) => `Quedan ${d} día(s) para responder una solicitud de un titular.`,
    vencida: () => 'Venció el plazo para responder una solicitud de un titular.',
    prorroga_posible: (d) => `Si hace falta prorrogar una solicitud, hay que comunicarlo al titular en los próximos ${d} día(s): después no vale.`,
    bloqueo_pendiente: () => 'Una solicitud exige bloquear los datos del titular y el bloqueo no está aplicado.',
};

/**
 * Por cada empresa, avisa a quienes tienen el permiso de derechos de los
 * titulares. Una vez por día y tipo (la clave queda en `alertas` de la
 * solicitud), y cada aviso queda en el historial: también es evidencia de que
 * el plazo se vigiló.
 */
module.exports.alertasDiarias = async ({ ahora = new Date(), config = D.configDesdeEntorno() } = {}) => {
    const { ScanCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
    const { InboxRepository } = require('../inbox-module/inbox.repository');
    const { TenantService } = require('../../lib/services/TenantService');
    const { personaPuede } = require('../../lib/permissions');
    const { registrarFallo } = require('../../lib/degradacion');
    const inbox = new InboxRepository();
    const tenantService = new TenantService();
    const resultado = { solicitudes: 0, avisos: 0, fallidos: 0 };

    let desde;
    const abiertas = [];
    do {
        const r = await docClient.send(new ScanCommand({
            TableName: TABLA(), FilterExpression: 'begins_with(sk, :p) AND estado = :abierta',
            ExpressionAttributeValues: { ':p': 'SOLICITUD#', ':abierta': D.ESTADOS.ABIERTA }, ExclusiveStartKey: desde,
        }));
        abiertas.push(...(r.Items || []));
        desde = r.LastEvaluatedKey;
    } while (desde);

    const destinatarios = new Map();
    for (const s of abiertas) {
        resultado.solicitudes += 1;
        const pendientes = D.alertasDe(s, { ahora, config }).filter((a) => !s.alertas?.[a.clave]);
        if (!pendientes.length) continue;
        try {
            if (!destinatarios.has(s.tenantId)) {
                const [personas, tenant] = await Promise.all([personaService.listByTenant(s.tenantId), tenantService.getById(s.tenantId)]);
                const safe = tenant ? tenant.toSafeFormat() : null;
                destinatarios.set(s.tenantId, personas.filter((p) => personaPuede(p, safe, PERMISSIONS.EMPRESA_DERECHOS_TITULARES)).map((p) => p.personaId));
            }
            const ids = destinatarios.get(s.tenantId);
            for (const [n, a] of pendientes.entries()) {
                if (ids.length) {
                    await inbox.sendMessage({
                        senderId: 'system', senderName: 'Sistema', senderRol: 'system', recipientIds: ids,
                        type: 'alert', priority: a.tipo === 'vencida' || a.tipo === 'bloqueo_pendiente' ? 'urgent' : 'high',
                        subject: 'Solicitud de un titular: plazo', content: TEXTO_ALERTA[a.tipo](a.dias),
                        linkedEntity: { type: 'solicitud_titular', id: s.solicitudId },
                    });
                }
                await docClient.send(new UpdateCommand({
                    TableName: TABLA(), Key: { tenantId: s.tenantId, sk: s.sk },
                    UpdateExpression: 'SET alertas = if_not_exists(alertas, :vacio)',
                    ExpressionAttributeValues: { ':vacio': {} },
                }));
                await docClient.send(new UpdateCommand({
                    TableName: TABLA(), Key: { tenantId: s.tenantId, sk: s.sk },
                    UpdateExpression: 'SET alertas.#c = :en', ExpressionAttributeNames: { '#c': a.clave },
                    ExpressionAttributeValues: { ':en': ahora.toISOString() },
                }));
                await docClient.send(new TransactWriteCommand({ TransactItems: aHistorial([
                    D.evento(s.tenantId, s.solicitudId, D.EVENTOS.ALERTA, { tipo: a.tipo, dias: a.dias ?? null, avisados: ids.length }, null, { ahora, n }),
                ]) }));
                resultado.avisos += 1;
            }
        } catch (err) {
            resultado.fallidos += 1;
            registrarFallo('gobernanza.alertas', err, { tenantId: s.tenantId });
        }
    }
    console.log('[alertas-derechos]', JSON.stringify(resultado));
    return resultado;
};

module.exports._interno = { ACTUALIZACIONES, ESTADO_POR_CODIGO };
