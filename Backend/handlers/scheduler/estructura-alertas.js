/**
 * Recordatorios de estructura preventiva (sección 8 del encargo).
 *
 * Corre en el scheduler ya existente y escribe en el Inbox, que es el módulo de
 * notificaciones del sistema. No se construye un canal paralelo.
 *
 * IDEMPOTENCIA: cada aviso deja una marca en `alertas` del propio órgano o
 * reunión, con una clave que incluye el período. Sin eso, un scheduler que corre
 * cada 30 minutos manda el mismo recordatorio 48 veces al día y el usuario deja
 * de leer el inbox, que es peor que no avisar.
 *
 * DESTINATARIO: el perfil administrador del ámbito. Se resuelve por permiso, no
 * por investidura: ser miembro del comité no es un rol del sistema.
 */

const { QueryCommand, ScanCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient } = require('../../lib/clients/dynamodb');
const { InboxRepository } = require('../inbox-module/inbox.repository');
const { PersonaService } = require('../../lib/services/PersonaService');
const { TenantService } = require('../../lib/services/TenantService');
const { PERMISSIONS, personaPuede } = require('../../lib/permissions');
const { sumarDiasHabiles } = require('../../lib/utils/fechaChile');
const EP = require('../../lib/estructura-preventiva');

const TABLE = process.env.ESTRUCTURA_TABLE || 'EstructuraPreventiva';

const inboxRepo = new InboxRepository();
const personaService = new PersonaService();
const tenantService = new TenantService();

const DIA_MS = 86400000;
const diasEntre = (a, b) => Math.floor((new Date(a).getTime() - new Date(b).getTime()) / DIA_MS);

/** Marca un aviso como enviado. La clave lleva el período para que se repita
 *  el siguiente, pero no dentro del mismo. */
const marcarAlerta = async (tenantId, sk, clave) => {
    await docClient.send(new UpdateCommand({
        TableName: TABLE, Key: { tenantId, sk },
        UpdateExpression: 'SET alertas = if_not_exists(alertas, :vacio)',
        ExpressionAttributeValues: { ':vacio': {} },
    })).catch(() => {});
    await docClient.send(new UpdateCommand({
        TableName: TABLE, Key: { tenantId, sk },
        UpdateExpression: 'SET alertas.#c = :si',
        ExpressionAttributeNames: { '#c': clave },
        ExpressionAttributeValues: { ':si': true },
    }));
};

const yaAvisado = (item, clave) => Boolean(item?.alertas?.[clave]);

/** Administradores del tenant: quienes pueden administrar obras o la empresa. */
const administradoresDe = async (tenantId, cache) => {
    if (cache.has(tenantId)) return cache.get(tenantId);
    let ids = [];
    try {
        const [personas, tenant] = await Promise.all([
            personaService.listByTenant(tenantId).catch(() => []),
            tenantService.getById(tenantId).catch(() => null),
        ]);
        const safe = tenant ? tenant.toSafeFormat() : null;
        ids = (personas || [])
            .filter((p) => p.estado !== 'inactivo'
                && (personaPuede(p, safe, PERMISSIONS.OBRAS_CREAR) || personaPuede(p, safe, PERMISSIONS.EMPRESA_VER)))
            .map((p) => p.personaId);
    } catch (err) {
        console.error('[estructura-alertas] no se pudo resolver destinatarios:', err.message);
    }
    cache.set(tenantId, ids);
    return ids;
};

const avisar = async ({ tenantId, destinatarios, subject, content, obraId }) => {
    if (!destinatarios || destinatarios.length === 0) return false;
    try {
        // Misma forma que usa EventBus: senderRol 'system' evita el SMS y deja el
        // aviso solo en el inbox, que es lo que corresponde a un recordatorio.
        await inboxRepo.sendMessage({
            senderId: 'system', senderName: 'Build & Serve', senderRol: 'system',
            recipientIds: destinatarios,
            type: 'alert', priority: 'normal',
            subject, content,
            linkedEntity: { type: 'estructura_preventiva', id: obraId || tenantId },
        });
        return true;
    } catch (err) {
        // Un aviso que falla no puede tumbar el resto de la pasada.
        console.error('[estructura-alertas] no se pudo enviar el aviso:', err.message);
        return false;
    }
};

/**
 * Revisa órganos y reuniones y emite los recordatorios que correspondan.
 *
 * Se hace un Scan de la tabla de estructura porque los avisos son globales (no
 * hay un tenant que consultar): es la misma decisión que ya toma
 * `checkActivityAlerts` con las actividades del día, y el volumen es del mismo
 * orden — decenas de órganos por tenant, no millones de filas.
 */
async function revisarEstructuraPreventiva(ahora = new Date()) {
    const resumen = { revisados: 0, avisos: 0 };
    const cacheAdmins = new Map();

    const res = await docClient.send(new ScanCommand({ TableName: TABLE }));
    const items = res.Items || [];
    const organos = items.filter((i) => String(i.sk).startsWith('ORG#'));
    const reuniones = items.filter((i) => String(i.sk).startsWith('REU#'));
    const miembros = items.filter((i) => String(i.sk).startsWith('MIE#'));

    for (const organo of organos) {
        resumen.revisados += 1;
        const estado = EP.estadoOrgano(organo, ahora);
        if (estado === EP.ESTADO_ORGANO.DISUELTO) continue;

        const destinatarios = await administradoresDe(organo.tenantId, cacheAdmins);
        const etiqueta = EP.TIPO_ORGANO_LABEL?.[organo.tipo] || organo.tipo;
        const enviar = (clave, subject, content) => avisar({
            tenantId: organo.tenantId, destinatarios, subject, content, obraId: organo.obraId,
        }).then(async (ok) => {
            if (ok) { await marcarAlerta(organo.tenantId, organo.sk, clave); resumen.avisos += 1; }
        });

        // ── Término de mandato: 60, 30 y 0 días antes ────────────────────────
        if (EP.tieneMandato(organo.tipo) && organo.fechaTerminoMandato) {
            const faltan = diasEntre(organo.fechaTerminoMandato, ahora);
            // Ventanas explícitas. El hito 0 NO tiene borde inferior a propósito:
            // un mandato ya vencido tiene que seguir avisando hasta que se renueve.
            // Con un borde (faltan > -1) el aviso solo salía el día exacto y se
            // perdía para siempre si ese día el scheduler no corría.
            const ventanas = [
                { hito: 60, dentro: faltan > 30 && faltan <= 60 },
                { hito: 30, dentro: faltan > 0 && faltan <= 30 },
                { hito: 0, dentro: faltan <= 0 },
            ];
            for (const { hito, dentro } of ventanas) {
                const clave = `mandato_${hito}`;
                if (dentro && !yaAvisado(organo, clave)) {
                    await enviar(clave,
                        hito === 0 ? `Mandato vencido: ${etiqueta}` : `El mandato del ${etiqueta} vence en ${faltan} días`,
                        hito === 0
                            ? `El mandato terminó el ${String(organo.fechaTerminoMandato).slice(0, 10)}. Corresponde una nueva elección.`
                            : `El mandato termina el ${String(organo.fechaTerminoMandato).slice(0, 10)}. Conviene agendar la elección.`);
                    break;
                }
            }
        }

        // ── Registro en la DT: a los 10 días hábiles de la elección ──────────
        // El plazo legal son 15 días hábiles (Art. 36); se avisa antes para que
        // quede margen. El cálculo excluye fin de semana pero no feriados, así
        // que la fecha llega antes que la real: avisa temprano, nunca tarde.
        if (organo.tipo === EP.TIPO_ORGANO.COMITE_PARITARIO
            && !organo.documentos?.comprobanteDT
            && !yaAvisado(organo, 'registro_dt')) {
            const aviso = sumarDiasHabiles(organo.fechaEleccionODesignacion, 10);
            const limite = sumarDiasHabiles(organo.fechaEleccionODesignacion, EP.DIAS_HABILES_REGISTRO_DT);
            if (aviso && new Date(aviso).getTime() <= ahora.getTime()) {
                await enviar('registro_dt',
                    'Falta el comprobante de registro del comité en la Dirección del Trabajo',
                    `El acta de constitución debe registrarse dentro de ${EP.DIAS_HABILES_REGISTRO_DT} días hábiles desde la elección. `
                    + `Fecha límite estimada: ${String(limite).slice(0, 10)} (referencial: no considera feriados).`);
            }
        }

        // ── Curso OPR: a los 4 y 5 meses, y alerta pasado el sexto ───────────
        if (organo.tipo === EP.TIPO_ORGANO.COMITE_PARITARIO && estado === EP.ESTADO_ORGANO.VIGENTE) {
            const pendientes = miembros.filter(
                (m) => m.organoId === organo.organoId
                    && m.estamento === EP.ESTAMENTO.TRABAJADORES
                    && !m.acreditacion?.realizada
            );
            if (pendientes.length > 0) {
                const limite = EP.fechaLimiteCursoOpr(organo.fechaEleccionODesignacion);
                const faltan = limite ? diasEntre(limite, ahora) : null;
                const hito = faltan === null ? null
                    : faltan < 0 ? 'vencido'
                        : faltan <= 30 ? 'mes5'
                            : faltan <= 60 ? 'mes4' : null;
                const clave = hito ? `opr_${hito}` : null;
                if (clave && !yaAvisado(organo, clave)) {
                    await enviar(clave,
                        hito === 'vencido'
                            ? 'Venció el plazo del curso de orientación en prevención'
                            : `${pendientes.length} integrante(s) sin el curso de orientación en prevención`,
                        `Los integrantes electos deben realizarlo durante el primer semestre del mandato (Art. 32). `
                        + `Fecha límite: ${String(limite).slice(0, 10)}.`);
                }
            }
        }

        // ── Programa de trabajo del comité vencido ───────────────────────────
        // (Se evalúa contra documentos en el panel; aquí solo el aviso de cierre
        // de período, que es lo que el scheduler puede saber sin leer documentos.)
        if (organo.tipo === EP.TIPO_ORGANO.COMITE_PARITARIO && estado === EP.ESTADO_ORGANO.VIGENTE) {
            const periodo = EP.periodoAnual(ahora);
            const finPeriodo = new Date(Date.UTC(Number(periodo), 11, 1));
            const clave = `programa_${periodo}`;
            if (ahora.getTime() >= finPeriodo.getTime() && !yaAvisado(organo, clave)) {
                await enviar(clave,
                    `El programa de trabajo del comité ${periodo} vence este mes`,
                    'Si aún no se ha cargado el programa de trabajo del período, conviene hacerlo antes del cierre.');
            }
        }
    }

    // ── Reunión ordinaria del mes sin acta ──────────────────────────────────
    // Se avisa el día 20 y el último día del mes: son los dos momentos en que
    // todavía se puede realizar la reunión dentro del período.
    const dia = ahora.getUTCDate();
    const ultimoDia = new Date(Date.UTC(ahora.getUTCFullYear(), ahora.getUTCMonth() + 1, 0)).getUTCDate();
    if (dia === 20 || dia === ultimoDia) {
        const periodoMes = `${ahora.getUTCFullYear()}-${String(ahora.getUTCMonth() + 1).padStart(2, '0')}`;
        const clave = `sin_acta_${periodoMes}_${dia === 20 ? 'd20' : 'cierre'}`;
        for (const r of reuniones) {
            if (r.tipo !== EP.TIPO_REUNION.ORDINARIA) continue;
            if (r.periodoMes !== periodoMes) continue;
            if (r.estado === EP.ESTADO_REUNION.REALIZADA) continue;
            if (yaAvisado(r, clave)) continue;

            const destinatarios = await administradoresDe(r.tenantId, cacheAdmins);
            const ok = await avisar({
                tenantId: r.tenantId, destinatarios,
                subject: `Reunión ordinaria del comité de ${periodoMes} sin acta`,
                content: 'Las reuniones ordinarias son mensuales (Art. 39). Registra la reunión con su acta antes del cierre del mes.',
            });
            if (ok) { await marcarAlerta(r.tenantId, r.sk, clave); resumen.avisos += 1; }
        }
    }

    return resumen;
}

/**
 * Estructura obligatoria declarada pero no constituida. Semanal (lunes) para no
 * repetir el mismo aviso todos los días sobre algo que tarda semanas en resolverse.
 */
async function revisarEstructuraFaltante(ahora = new Date()) {
    if (ahora.getUTCDay() !== 1) return { revisados: 0, avisos: 0 };
    // Requiere recorrer tenants y obras: se implementa junto con el panel de
    // completitud transversal, que ya calcula exactamente esta condición.
    return { revisados: 0, avisos: 0, nota: 'pendiente: depende del recorrido de ámbitos' };
}

module.exports = { revisarEstructuraPreventiva, revisarEstructuraFaltante, diasEntre };
