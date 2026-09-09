const { ScanCommand, QueryCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient } = require('../../lib/clients/dynamodb');
const { InboxRepository } = require('../inbox-module/inbox.repository');

const ACTIVITIES_TABLE = process.env.ACTIVITIES_TABLE || 'Activities';
const AUSENCIAS_TABLE = process.env.AUSENCIAS_TABLE || 'Ausencias';

const inboxRepo = new InboxRepository();

// Fecha y hora locales de Chile (las horas de la actividad son hora local).
const partesChile = () => {
    const fmt = new Intl.DateTimeFormat('es-CL', {
        timeZone: 'America/Santiago', year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hour12: false,
    });
    const p = Object.fromEntries(fmt.formatToParts(new Date()).map((x) => [x.type, x.value]));
    return { fecha: `${p.year}-${p.month}-${p.day}`, hhmm: `${p.hour}:${p.minute}` };
};

const hhmmAMin = (s) => {
    const m = (typeof s === 'string' ? s : '').match(/^(\d{1,2}):(\d{2})/);
    return m ? parseInt(m[1], 10) * 60 + parseInt(m[2], 10) : null;
};

const responsablesDe = (a) => {
    const r = Array.isArray(a.responsables) && a.responsables.length ? a.responsables : (a.relatorId ? [a.relatorId] : []);
    return [...new Set(r.filter(Boolean))];
};

// Marca de forma idempotente un aviso ya enviado en la actividad (no repetir).
const marcarAlerta = async (activityId, campo) => {
    await docClient.send(new UpdateCommand({
        TableName: ACTIVITIES_TABLE,
        Key: { activityId },
        UpdateExpression: 'SET alertas = if_not_exists(alertas, :empty)',
        ExpressionAttributeValues: { ':empty': {} },
    })).catch(() => {});
    await docClient.send(new UpdateCommand({
        TableName: ACTIVITIES_TABLE,
        Key: { activityId },
        UpdateExpression: 'SET alertas.#c = :true',
        ExpressionAttributeNames: { '#c': campo },
        ExpressionAttributeValues: { ':true': true },
    }));
};

/**
 * Lambda programada (EventBridge, cada 30 min). Revisa las actividades de HOY y
 * genera avisos al inbox de los responsables (sin SMS: senderRol 'system' +
 * prioridad 'normal'):
 *   - Ítem 2: la actividad superó su hora de término (horaFin) y no se ha cerrado.
 *   - Ítem 4: a mediodía, aún hay convocados sin firmar (excluye ausentes).
 * Es idempotente: cada aviso se envía una sola vez por actividad/día (flags en
 * activity.alertas). Al cambiar de día, las actividades nuevas no tienen flags.
 */
module.exports.checkActivityAlerts = async () => {
    const { fecha: hoy, hhmm } = partesChile();
    const ahoraMin = hhmmAMin(hhmm);
    const enVentanaMediodia = ahoraMin !== null && ahoraMin >= 12 * 60 && ahoraMin < 12 * 60 + 30;

    // Actividades de hoy que siguen abiertas (no completada/cancelada/borrador).
    const res = await docClient.send(new ScanCommand({
        TableName: ACTIVITIES_TABLE,
        FilterExpression: '#f = :hoy',
        ExpressionAttributeNames: { '#f': 'fecha' },
        ExpressionAttributeValues: { ':hoy': hoy },
    }));
    const actividades = (res.Items || []).filter(
        (a) => a.estado !== 'completada' && a.estado !== 'cancelada' && a.estado !== 'borrador');

    // Cache de ausentes por (tenant, obra) para no re-consultar por actividad.
    const cacheAusentes = new Map();
    const getAusentes = async (tenantId, obraId) => {
        const key = `${tenantId}#${obraId}`;
        if (cacheAusentes.has(key)) return cacheAusentes.get(key);
        let set = new Set();
        try {
            const r = await docClient.send(new QueryCommand({
                TableName: AUSENCIAS_TABLE,
                KeyConditionExpression: 'tenantId = :t AND begins_with(sk, :o)',
                ExpressionAttributeValues: { ':t': tenantId, ':o': `${obraId}#${hoy}#` },
            }));
            set = new Set((r.Items || []).map((x) => x.personaId));
        } catch (e) {
            console.error('Error consultando ausencias:', e.message);
        }
        cacheAusentes.set(key, set);
        return set;
    };

    let avisosHoraLimite = 0;
    let avisosMediodia = 0;

    for (const a of actividades) {
        const alertas = a.alertas || {};
        const recipientIds = responsablesDe(a);
        if (recipientIds.length === 0) continue;

        // Ítem 2 — hora de término superada sin cerrar.
        const finMin = hhmmAMin(a.horaFin);
        if (finMin !== null && ahoraMin !== null && ahoraMin >= finMin && !alertas.horaLimiteAvisada) {
            try {
                await inboxRepo.sendMessage({
                    senderId: 'system', senderName: 'Sistema', senderRol: 'system',
                    recipientIds, type: 'alert', priority: 'normal',
                    subject: `Actividad sin cerrar: ${a.titulo}`,
                    content: `La actividad "${a.titulo}" superó su hora de término (${a.horaFin}) y aún no ha sido cerrada. Ciérrala cuando corresponda (puede firmarse durante todo el día).`,
                    linkedEntity: { type: 'activity', id: a.activityId },
                });
                await marcarAlerta(a.activityId, 'horaLimiteAvisada');
                avisosHoraLimite++;
            } catch (e) {
                console.error('Error enviando aviso de hora límite:', e.message);
            }
        }

        // Ítem 4 — a mediodía, convocados sin firmar (excluyendo ausentes).
        if (enVentanaMediodia && !alertas.mediodiaAvisada) {
            const requeridos = Array.isArray(a.asistentesRequeridos) ? a.asistentesRequeridos : [];
            if (requeridos.length > 0) {
                const firmaron = new Set((a.asistentes || []).map((x) => x.personaId || x.workerId).filter(Boolean));
                const ausentes = await getAusentes(a.tenantId, a.obraId);
                const pendientes = requeridos.filter((id) => !firmaron.has(id) && !ausentes.has(id));
                if (pendientes.length > 0) {
                    try {
                        await inboxRepo.sendMessage({
                            senderId: 'system', senderName: 'Sistema', senderRol: 'system',
                            recipientIds, type: 'alert', priority: 'normal',
                            subject: `Pendientes de firmar: ${a.titulo}`,
                            content: `${pendientes.length} trabajador(es) convocados aún no firman la charla "${a.titulo}" de hoy. Gestiona su firma o márcalos como ausentes.`,
                            linkedEntity: { type: 'activity', id: a.activityId },
                        });
                        avisosMediodia++;
                    } catch (e) {
                        console.error('Error enviando aviso de mediodía:', e.message);
                    }
                }
                // Se marca aunque no hubiera pendientes, para no re-evaluar en el día.
                await marcarAlerta(a.activityId, 'mediodiaAvisada').catch(() => {});
            }
        }
    }

    console.log(`checkActivityAlerts hoy=${hoy} hhmm=${hhmm} horaLimite=${avisosHoraLimite} mediodia=${avisosMediodia}`);
    return { hoy, hhmm, avisosHoraLimite, avisosMediodia };
};

/**
 * Lambda programada diaria: recordatorios de estructura preventiva (sección 8).
 *
 * Va aparte de `checkActivityAlerts` porque su cadencia es distinta: las alertas
 * de actividades miran el día en curso cada 30 minutos, mientras que éstas son
 * hitos de calendario (mandatos, plazos, cierres de mes) que solo cambian una vez
 * al día. Correrlas cada media hora sería 48 veces el mismo trabajo.
 */
module.exports.checkEstructuraAlerts = async () => {
    const { revisarEstructuraPreventiva } = require('./estructura-alertas');
    try {
        const resumen = await revisarEstructuraPreventiva(new Date());
        console.log('[estructura-alertas]', JSON.stringify(resumen));
        return resumen;
    } catch (err) {
        console.error('[estructura-alertas] fallo la pasada:', err);
        throw err;
    }
};
