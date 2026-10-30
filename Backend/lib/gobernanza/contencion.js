/**
 * Acciones de contención y recuperación del plan de respuesta a incidentes
 * (docs/plan-respuesta-incidentes.md). Las ejecuta el equipo de la plataforma
 * con `scripts/contencion.js`; cada una deja su registro en la auditoría con el
 * operador que la ejecutó.
 *
 *   revocarSesiones    cierra todas las sesiones de una o más personas. La
 *                      persona legítima vuelve a entrar con su contraseña.
 *   suspenderCuenta    estado `suspendido`: el autorizador niega cada petición
 *                      (a más tardar en 60 s, su caché) y no se puede iniciar
 *                      sesión. Además cierra sus sesiones y revoca sus vales de
 *                      firma sin conexión. No borra nada.
 *   reactivarCuenta    deshace la suspensión, con el estado que tenía antes.
 *   preservarEvidencia copia los registros de auditoría de una ventana, con su
 *                      huella SHA-256, ANTES de tocar nada más. Es lo primero
 *                      que se hace: contener sin preservar puede destruir la
 *                      evidencia que explica el incidente.
 *
 * Ninguna acción borra datos ni registros: la contención limita el daño; la
 * erradicación (corregir la causa, rotar llaves) y la supresión (que tiene su
 * propio flujo de dos personas) van por separado.
 */

const crypto = require('crypto');
const { UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient } = require('../clients/dynamodb');
const { revocarSesionesDe } = require('../auth/sesion');
const { formaCanonica } = require('../huella');
const auditoria = require('./auditoria');

const T = (env) => process.env[env];
const error = (mensaje, codigo) => Object.assign(new Error(mensaje), { codigo });
const MOTIVO_MIN = 10;

/** Quién ejecuta: el operador de la plataforma, identificado por su usuario de IAM. */
const actorOperador = (operador) => {
    if (!operador || String(operador).length < 3) throw error('Falta quién ejecuta la acción (--operador)', 'SIN_OPERADOR');
    return { id: `operador:${String(operador).slice(0, 80)}`, tipo: 'operador' };
};
const exigirMotivo = (motivo) => {
    const m = String(motivo || '').trim();
    if (m.length < MOTIVO_MIN) throw error(`Indica el motivo o el número de incidente (al menos ${MOTIVO_MIN} caracteres)`, 'SIN_MOTIVO');
    return m.slice(0, 100);
};

async function revocarSesiones({ tenantId, personaIds, operador, motivo, ahora = new Date() }) {
    const actor = actorOperador(operador);
    const m = exigirMotivo(motivo);
    const revocadas = await revocarSesionesDe(personaIds);
    await auditoria.registrar({
        tenantId, operacion: 'contencion.revocar_sesiones', actor, titulares: personaIds, origen: { canal: 'script' },
        detalle: { sesionesRevocadas: revocadas, motivo: m },
    }, { estricto: true, ahora, detectar: false });
    return { sesionesRevocadas: revocadas };
}

async function suspenderCuenta({ tenantId, personaId, operador, motivo, ahora = new Date() }) {
    const actor = actorOperador(operador);
    const m = exigirMotivo(motivo);
    // Se lee el estado actual y se guarda como anterior, con la condición de que
    // no haya cambiado entremedio: reactivar no tiene que adivinarlo.
    const { GetCommand } = require('@aws-sdk/lib-dynamodb');
    const it = (await docClient.send(new GetCommand({ TableName: T('PERSONAS_TABLE'), Key: { PK: `TENANT#${tenantId}`, SK: `PERSONA#${personaId}` }, ConsistentRead: true }))).Item;
    if (!it || ['suspendido', 'desvinculado'].includes(it.estado)) throw error('La persona no existe, ya está suspendida o está desvinculada.', 'NO_SUSPENDIBLE');
    const estadoAnterior = it.estado || null;
    await docClient.send(new UpdateCommand({
        TableName: T('PERSONAS_TABLE'), Key: { PK: `TENANT#${tenantId}`, SK: `PERSONA#${personaId}` },
        UpdateExpression: 'SET suspension = :s, estado = :susp, updatedAt = :ahora',
        ConditionExpression: estadoAnterior ? 'estado = :antes' : 'attribute_not_exists(estado)',
        ExpressionAttributeValues: {
            ':susp': 'suspendido', ':ahora': ahora.toISOString(),
            ':s': { motivo: m, en: ahora.toISOString(), por: actor.id, estadoAnterior },
            ...(estadoAnterior ? { ':antes': estadoAnterior } : {}),
        },
    })).catch((err) => {
        if (err.name === 'ConditionalCheckFailedException') throw error('El estado de la persona cambió mientras se suspendía. Vuelve a intentarlo.', 'NO_SUSPENDIBLE');
        throw err;
    });
    const sesionesRevocadas = await revocarSesionesDe([personaId]);
    const { ValeFirmaService } = require('../services/ValeFirmaService');
    const vales = await ValeFirmaService.revocarDePersona(personaId, { tenantId, motivo: `Contención: ${m}`, por: actor.id });
    await auditoria.registrar({
        tenantId, operacion: 'contencion.suspender_cuenta', actor, recurso: { tipo: 'persona', id: personaId }, titulares: [personaId],
        origen: { canal: 'script' }, detalle: { motivo: m, estadoAnterior, sesionesRevocadas, valesRevocados: vales.revocados },
    }, { estricto: true, ahora, detectar: false });
    return { estadoAnterior, sesionesRevocadas, valesRevocados: vales.revocados };
}

async function reactivarCuenta({ tenantId, personaId, operador, motivo, ahora = new Date() }) {
    const actor = actorOperador(operador);
    const m = exigirMotivo(motivo);
    const { GetCommand } = require('@aws-sdk/lib-dynamodb');
    const it = (await docClient.send(new GetCommand({ TableName: T('PERSONAS_TABLE'), Key: { PK: `TENANT#${tenantId}`, SK: `PERSONA#${personaId}` }, ConsistentRead: true }))).Item;
    if (!it || it.estado !== 'suspendido' || !it.suspension) throw error('La persona no está suspendida por contención.', 'NO_SUSPENDIDA');
    const estado = it.suspension.estadoAnterior || 'activo';
    await docClient.send(new UpdateCommand({
        TableName: T('PERSONAS_TABLE'), Key: { PK: `TENANT#${tenantId}`, SK: `PERSONA#${personaId}` },
        UpdateExpression: 'SET estado = :e, updatedAt = :ahora REMOVE suspension',
        ConditionExpression: 'estado = :susp', ExpressionAttributeValues: { ':e': estado, ':susp': 'suspendido', ':ahora': ahora.toISOString() },
    }));
    await auditoria.registrar({
        tenantId, operacion: 'contencion.reactivar_cuenta', actor, recurso: { tipo: 'persona', id: personaId }, titulares: [personaId],
        origen: { canal: 'script' }, detalle: { motivo: m, estado },
    }, { estricto: true, ahora, detectar: false });
    return { estado };
}

/**
 * Copia de la auditoría de una ventana, con su huella. La huella permite
 * demostrar después que la copia que se analizó es la que se tomó.
 */
async function preservarEvidencia({ tenantId, desde, hasta, operador, motivo, ahora = new Date() }) {
    const actor = actorOperador(operador);
    const m = exigirMotivo(motivo);
    const eventos = await auditoria.listar(tenantId, { desde, hasta, limite: 100000 });
    const integridad = {};
    for (const e of eventos) {
        const estado = await auditoria.verificarSello(e);
        integridad[estado] = (integridad[estado] || 0) + 1;
    }
    const paquete = { tenantId, desde: desde || null, hasta: hasta || null, tomadoEl: ahora.toISOString(), tomadoPor: actor.id, motivo: m, eventos };
    const huella = crypto.createHash('sha256').update(formaCanonica(paquete)).digest('hex');
    await auditoria.registrar({
        tenantId, operacion: 'contencion.preservar_evidencia', actor, origen: { canal: 'script' },
        detalle: { eventos: eventos.length, huella, motivo: m, ...integridad },
    }, { estricto: true, ahora, detectar: false });
    return { paquete, huella, integridad };
}

module.exports = { revocarSesiones, suspenderCuenta, reactivarCuenta, preservarEvidencia };
