/**
 * Registro de auditoría de las operaciones sobre datos personales.
 *
 * Amplía la auditoría de acceso a salud (D-18, `auditoriaSalud.js`) al resto de
 * lo que hay que poder reconstruir después: ingresos fallidos, verificaciones
 * de identidad, cambios de consentimiento, solicitudes de los titulares,
 * exportaciones, rectificaciones, supresiones, cambios de rol y de permisos,
 * acciones de contención y las alertas que genera la detección. Comparte la
 * tabla (`AuditoriaAccesosTable`) y sus garantías: ningún rol puede actualizar
 * ni borrar un ítem (solo agregar y leer, ver `serverless.yml` y
 * `tests/gobernanza-permisos.test.js`) y la tabla se conserva aunque se borre
 * el stack.
 *
 * ── Qué lleva cada registro ────────────────────────────────────────────────
 *   eventoId, en               identificador y fecha y hora (UTC, ISO 8601)
 *   categoria, operacion       qué pasó, de un catálogo cerrado (`OPERACIONES`)
 *   resultado                  exito | denegado | fallido
 *   actorId, actorTipo, actorRol  quién: personaId de la sesión, `rut:<hmac>`
 *                              para un ingreso sin sesión, `sistema` u `operador`
 *   recurso                    sobre qué: { tipo, id } (identificadores internos)
 *   titulares                  de qué personas eran los datos (personaId)
 *   origen                     IP y canal (web, script, proceso)
 *   detalle                    metadatos acotados: qué campos, qué versión,
 *                              qué regla. Nunca valores.
 *   ttl                        hasta cuándo se conserva (`RETENCION_DIAS`)
 *   sello                      HMAC de todo lo anterior (`cifradoCampo.selloAuditoria`)
 *
 * ── Qué NO se registra, nunca ──────────────────────────────────────────────
 * Contraseñas, PIN, tokens de sesión o de selección, llaves, el RUT en claro,
 * correos, teléfonos, nombres, respuestas de salud, relatos de incidentes ni el
 * valor de un campo modificado (sí su nombre). `sanear` lo impide en el código:
 * rechaza el registro si el detalle trae una clave con un nombre prohibido, un
 * texto largo o algo con forma de RUT o de correo. Que una prueba lo detecte es
 * mejor que encontrarlo en una fiscalización.
 *
 * ── Integridad ─────────────────────────────────────────────────────────────
 * Tres capas: (1) IAM: ningún rol de la aplicación tiene `UpdateItem` ni
 * `DeleteItem` sobre la tabla; (2) recuperación a un punto en el tiempo de 35
 * días y `Retain`; (3) el sello: quien lograra escribir en la tabla sin la llave
 * HMAC no puede fabricar ni alterar un registro sin que `verificarSello` lo
 * note. La eliminación al vencer la hace DynamoDB por TTL, no un rol.
 *
 * ── Estricto o no ──────────────────────────────────────────────────────────
 * Con `estricto`, si el registro no se puede escribir la operación no se
 * completa (lo usan las exportaciones y la lectura de la propia auditoría:
 * entregar datos sin dejar constancia es peor que no entregarlos, mismo
 * criterio que D-18). Sin él, el fallo se mide (`registrarFallo`) y la
 * operación sigue: un ingreso fallido no puede convertirse en una caída del
 * login porque la auditoría no respondió.
 */

const crypto = require('crypto');
const { PutCommand, QueryCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient } = require('../clients/dynamodb');
const { registrarFallo } = require('../degradacion');
const { formaCanonica } = require('../huella');
const deteccion = require('./deteccion');

const TABLA = () => process.env.AUDITORIA_ACCESOS_TABLE;
const INDICE_ACTOR = 'actorId-en-index';

const CATEGORIAS = {
    SEGURIDAD: 'seguridad',
    CONSENTIMIENTO: 'consentimiento',
    DERECHOS: 'derechos',
    DATOS: 'datos',
    ADMINISTRACION: 'administracion',
    CONTENCION: 'contencion',
    ALERTA: 'alerta',
    AUDITORIA: 'auditoria',
};

/** Catálogo cerrado: una operación que no está acá no se puede registrar. */
const OPERACIONES = {
    'auth.ingreso': CATEGORIAS.SEGURIDAD,
    'auth.ingreso_fallido': CATEGORIAS.SEGURIDAD,
    'identidad.verificada': CATEGORIAS.SEGURIDAD,
    'identidad.verificacion_fallida': CATEGORIAS.SEGURIDAD,
    'consentimiento.otorgado': CATEGORIAS.CONSENTIMIENTO,
    'consentimiento.revocado': CATEGORIAS.CONSENTIMIENTO,
    'consentimiento.denegado': CATEGORIAS.CONSENTIMIENTO,
    'derechos.solicitud': CATEGORIAS.DERECHOS,
    'derechos.verificacion': CATEGORIAS.DERECHOS,
    'derechos.prorroga': CATEGORIAS.DERECHOS,
    'derechos.respuesta': CATEGORIAS.DERECHOS,
    'derechos.exportacion': CATEGORIAS.DERECHOS,
    'derechos.exportacion_rechazada': CATEGORIAS.DERECHOS,
    'derechos.rectificacion_aplicada': CATEGORIAS.DERECHOS,
    'derechos.supresion_ejecutada': CATEGORIAS.DERECHOS,
    'datos.modificacion': CATEGORIAS.DATOS,
    'admin.cambio_rol': CATEGORIAS.ADMINISTRACION,
    'admin.roles_empresa': CATEGORIAS.ADMINISTRACION,
    'contencion.revocar_sesiones': CATEGORIAS.CONTENCION,
    'contencion.suspender_cuenta': CATEGORIAS.CONTENCION,
    'contencion.reactivar_cuenta': CATEGORIAS.CONTENCION,
    'contencion.revocar_vales': CATEGORIAS.CONTENCION,
    'contencion.preservar_evidencia': CATEGORIAS.CONTENCION,
    'auditoria.consulta': CATEGORIAS.AUDITORIA,
    'auditoria.verificacion': CATEGORIAS.AUDITORIA,
};
for (const r of deteccion.REGLAS) OPERACIONES[`alerta.${r.id}`] = CATEGORIAS.ALERTA;

const RESULTADOS = new Set(['exito', 'denegado', 'fallido']);
const ACTORES = new Set(['persona', 'cuenta', 'sistema', 'operador']);

/**
 * Plazo de conservación por categoría, en días. Los eventos de seguridad
 * (ingresos, verificaciones) sirven para investigar un incidente reciente: un
 * año. Las alertas, dos. Lo que acredita cómo se trataron los datos de una
 * persona (consentimientos, solicitudes, exportaciones, cambios), cinco: el
 * mismo plazo de la evidencia (D-2). Configurables, como los plazos de D-15.
 */
const RETENCION_DIAS = {
    [CATEGORIAS.SEGURIDAD]: 365,
    [CATEGORIAS.ALERTA]: 730,
    otras: 1825,
};
const retencionDias = (categoria, env = process.env) => {
    const porEnv = {
        [CATEGORIAS.SEGURIDAD]: env.AUDITORIA_RETENCION_DIAS_SEGURIDAD,
        [CATEGORIAS.ALERTA]: env.AUDITORIA_RETENCION_DIAS_ALERTA,
    }[categoria] || env.AUDITORIA_RETENCION_DIAS;
    return Number(porEnv || RETENCION_DIAS[categoria] || RETENCION_DIAS.otras);
};

// ─── Lo que no puede entrar ─────────────────────────────────────────────────

const CLAVE_PROHIBIDA = /pass|contrase|^pin|pin$|token|secret|llave|key|rut|correo|e?mail|telefono|fono|nacimiento|direccion|salud|diagnost|respuesta|relato|descripcion|texto|valor|contenido|nombre|cifrad/i;
const PARECE_RUT = /^\d{1,2}\.?\d{3}\.?\d{3}-?[\dkK]$/;
const PARECE_CORREO = /^[^@\s]+@[^@\s]+$/;
const LARGO_MAXIMO = 120;

const errorProgramacion = (m) => Object.assign(new Error(`auditoria: ${m}`), { codigo: 'AUDITORIA_DATO_PROHIBIDO' });

/** Devuelve el detalle tal cual si no trae nada prohibido; si trae, lanza. */
function sanear(detalle, ruta = 'detalle') {
    if (detalle === null || detalle === undefined) return {};
    if (Array.isArray(detalle)) return detalle.map((v, i) => sanearValor(v, `${ruta}[${i}]`));
    if (typeof detalle !== 'object') throw errorProgramacion(`${ruta} debe ser un objeto`);
    const limpio = {};
    for (const [k, v] of Object.entries(detalle)) {
        if (CLAVE_PROHIBIDA.test(k)) throw errorProgramacion(`${ruta}.${k}: nombre de campo prohibido en un registro de auditoría`);
        if (v === undefined) continue;
        limpio[k] = sanearValor(v, `${ruta}.${k}`);
    }
    return limpio;
}

function sanearValor(v, ruta) {
    if (v === null || typeof v === 'number' || typeof v === 'boolean') return v;
    if (typeof v === 'string') {
        if (v.length > LARGO_MAXIMO) throw errorProgramacion(`${ruta}: texto de más de ${LARGO_MAXIMO} caracteres`);
        if (PARECE_RUT.test(v.trim())) throw errorProgramacion(`${ruta}: parece un RUT`);
        if (PARECE_CORREO.test(v.trim())) throw errorProgramacion(`${ruta}: parece un correo`);
        return v;
    }
    if (typeof v === 'object') return sanear(v, ruta);
    throw errorProgramacion(`${ruta}: tipo no admitido`);
}

// ─── Construcción y sello ───────────────────────────────────────────────────

/** Contexto de origen de una petición HTTP: IP y canal. Nada más. */
function origenDe(event, canal = 'web') {
    return { ip: event?.requestContext?.http?.sourceIp || null, canal };
}

/**
 * Arma un registro (sin sello). Puro: valida el catálogo, el actor y el
 * detalle, y calcula el TTL.
 */
function construir({
    tenantId, operacion, resultado = 'exito', actor, recurso = null, titulares = [], origen = null, detalle = {},
}, { ahora = new Date(), eventoId = crypto.randomUUID() } = {}) {
    const categoria = OPERACIONES[operacion];
    if (!categoria) throw errorProgramacion(`operación no catalogada: ${operacion}`);
    if (!RESULTADOS.has(resultado)) throw errorProgramacion(`resultado inválido: ${resultado}`);
    const tipoActor = actor?.tipo || 'persona';
    if (!ACTORES.has(tipoActor)) throw errorProgramacion(`tipo de actor inválido: ${tipoActor}`);
    if (!actor?.id) throw errorProgramacion('falta el actor');
    const en = ahora.toISOString();
    return {
        tenantId: tenantId || 'sin-empresa',
        // `EV#` separa estos registros de los de acceso a salud (que empiezan con
        // la fecha) dentro de la misma partición.
        sk: `EV#${en}#${eventoId}`,
        eventoId,
        en,
        categoria,
        operacion,
        resultado,
        actorId: String(actor.id),
        actorTipo: tipoActor,
        actorRol: actor.rol || null,
        recurso: recurso ? { tipo: String(recurso.tipo), id: recurso.id ? String(recurso.id) : null } : null,
        titulares: [...new Set((titulares || []).filter(Boolean).map(String))],
        origen: origen ? { ip: origen.ip || null, canal: origen.canal || null } : null,
        detalle: sanear(detalle),
        ttl: Math.floor((ahora.getTime() + retencionDias(categoria) * 86400000) / 1000),
    };
}

/** Lo que se sella: todo el registro salvo el sello mismo. */
const canonico = (registro) => {
    const { sello, ...resto } = registro;
    return formaCanonica(resto);
};

async function sellar(registro) {
    const { selloAuditoria } = require('../cifradoCampo');
    return { ...registro, sello: await selloAuditoria(canonico(registro)) };
}

/**
 * Estado de integridad de un registro leído de la tabla.
 * `sin_sello`: registro de acceso a salud anterior a esta versión (D-18).
 */
async function verificarSello(registro) {
    if (!registro?.sello) return 'sin_sello';
    const { selloAuditoria } = require('../cifradoCampo');
    const esperado = await selloAuditoria(canonico(registro));
    const a = Buffer.from(String(registro.sello));
    const b = Buffer.from(esperado);
    return a.length === b.length && crypto.timingSafeEqual(a, b) ? 'integro' : 'alterado';
}

// ─── Escritura ──────────────────────────────────────────────────────────────

const errorNoDisponible = () => Object.assign(
    new Error('No se pudo registrar la operación en la auditoría; por resguardo, no se completó. Intenta de nuevo.'),
    { codigo: 'AUDITORIA_NO_DISPONIBLE' },
);

/**
 * Registra un evento. Devuelve el registro guardado, o null si falló sin
 * `estricto`. Después de escribir, evalúa la detección (nunca la hace fallar).
 */
async function registrar(datos, { estricto = false, ahora = new Date(), detectar: conDeteccion = true } = {}) {
    let registro;
    try {
        registro = await sellar(construir(datos, { ahora }));
        await docClient.send(new PutCommand({ TableName: TABLA(), Item: registro, ConditionExpression: 'attribute_not_exists(sk)' }));
    } catch (err) {
        if (err.codigo === 'AUDITORIA_DATO_PROHIBIDO') throw err;   // error de programación: que se vea
        registrarFallo('auditoria.registro', err, { operacion: datos?.operacion || null });
        if (estricto) throw errorNoDisponible();
        return null;
    }
    if (conDeteccion) {
        try {
            await detectar(registro, { ahora });
        } catch (err) {
            registrarFallo('auditoria.deteccion', err, { operacion: registro.operacion });
        }
    }
    return registro;
}

/** Los eventos más recientes de un actor (el índice ordena por fecha). */
async function recientesDe(actorId, limite = 100) {
    const r = await docClient.send(new QueryCommand({
        TableName: TABLA(), IndexName: INDICE_ACTOR,
        KeyConditionExpression: 'actorId = :a', ExpressionAttributeValues: { ':a': String(actorId) },
        ScanIndexForward: false, Limit: limite,
    }));
    return r.Items || [];
}

/** Métrica embebida (EMF) para la alarma `EventoSospechoso` de CloudWatch. */
function metricaSospechoso(alerta, contexto) {
    try {
        // Campo a campo, como `degradacion`: identificadores y la regla, nada más.
        const linea = {
            _aws: {
                Timestamp: Date.now(),
                CloudWatchMetrics: [{ Namespace: 'BuildAndServe', Dimensions: [['stage'], ['stage', 'regla']], Metrics: [{ Name: 'EventoSospechoso', Unit: 'Count' }] }],
            },
            stage: process.env.STAGE || process.env.AWS_LAMBDA_FUNCTION_NAME?.split('-')[1] || 'desconocido',
            regla: alerta.regla,
            severidad: alerta.severidad,
            EventoSospechoso: 1,
            tenantId: contexto.tenantId || null,
        };
        console.warn('EVENTO_SOSPECHOSO', JSON.stringify(linea));
    } catch { /* medir no puede romper nada */ }
}

/** Avisa en la bandeja a quienes revisan la auditoría de esa empresa. */
async function avisar(tenantId, alerta) {
    if (!tenantId || tenantId === 'sin-empresa') return 0;
    const { PersonaService } = require('../services/PersonaService');
    const { TenantService } = require('../services/TenantService');
    const { InboxRepository } = require('../../handlers/inbox-module/inbox.repository');
    const { personaPuede, PERMISSIONS } = require('../permissions');
    const [personas, tenant] = await Promise.all([
        new PersonaService().listByTenant(tenantId, { incluirBloqueadas: true }),
        new TenantService().getById(tenantId),
    ]);
    const safe = tenant ? tenant.toSafeFormat() : null;
    const ids = personas.filter((p) => personaPuede(p, safe, PERMISSIONS.EMPRESA_AUDITORIA)).map((p) => p.personaId);
    if (!ids.length) return 0;
    await new InboxRepository().sendMessage({
        senderId: 'system', senderName: 'Sistema', senderRol: 'system', recipientIds: ids,
        type: 'alert', priority: alerta.severidad === 'alta' ? 'urgent' : 'high',
        subject: 'Alerta de seguridad', content: `${alerta.descripcion} Revísala en Mi Empresa, pestaña Auditoría.`,
        linkedEntity: { type: 'alerta_auditoria', id: alerta.regla },
    });
    return ids.length;
}

/**
 * Evalúa la detección para un registro recién escrito y ejecuta lo que
 * corresponda: registro de la alerta, métrica, aviso y, si la regla lo pide,
 * contención automática.
 */
async function detectar(registro, { ahora = new Date() } = {}) {
    if (registro.categoria === CATEGORIAS.ALERTA) return [];
    const recientes = await recientesDe(registro.actorId);
    const alertas = deteccion.evaluar(registro, recientes, { ahora });
    for (const a of alertas) {
        metricaSospechoso(a, { tenantId: registro.tenantId });
        let contencion = null;
        if (a.accion === 'revocar_sesiones' && registro.actorTipo === 'persona') {
            const { revocarSesionesDe } = require('../auth/sesion');
            const revocadas = await revocarSesionesDe([registro.actorId]);
            contencion = { accion: a.accion, sesionesRevocadas: revocadas };
        }
        await registrar({
            tenantId: registro.tenantId,
            operacion: `alerta.${a.regla}`,
            actor: { id: registro.actorId, tipo: registro.actorTipo, rol: registro.actorRol },
            recurso: { tipo: 'evento', id: registro.eventoId },
            titulares: registro.titulares,
            origen: registro.origen,
            detalle: { severidad: a.severidad, conteo: a.conteo, umbral: a.umbral, ventanaMin: a.ventanaMin, ...(contencion || {}) },
        }, { ahora, detectar: false });
        await avisar(registro.tenantId, a).catch((err) => registrarFallo('auditoria.aviso', err, { regla: a.regla }));
    }
    return alertas;
}

// ─── Lectura ────────────────────────────────────────────────────────────────

/**
 * Registros de una empresa, del más reciente al más antiguo. Incluye los de
 * acceso a salud (D-18), que se reconocen por no tener `operacion`.
 */
async function listar(tenantId, { desde, hasta, categoria, operacion, actorId, limite = 300 } = {}) {
    const items = [];
    let inicio;
    do {
        const r = await docClient.send(new QueryCommand({
            TableName: TABLA(), KeyConditionExpression: 'tenantId = :t', ExpressionAttributeValues: { ':t': tenantId },
            ScanIndexForward: false, ExclusiveStartKey: inicio,
        }));
        items.push(...(r.Items || []));
        inicio = r.LastEvaluatedKey;
    } while (inicio && items.length < 5000);
    const cat = (it) => it.categoria || 'salud';
    return items
        .filter((it) => !desde || it.en >= desde)
        .filter((it) => !hasta || it.en <= hasta)
        .filter((it) => !categoria || cat(it) === categoria)
        .filter((it) => !operacion || it.operacion === operacion)
        .filter((it) => !actorId || it.actorId === actorId)
        .sort((a, b) => b.en.localeCompare(a.en))
        .slice(0, limite)
        .map((it) => ({ ...it, categoria: cat(it) }));
}

module.exports = {
    CATEGORIAS, OPERACIONES, RETENCION_DIAS, retencionDias,
    sanear, construir, canonico, sellar, verificarSello, origenDe,
    registrar, detectar, recientesDe, listar, avisar,
};
