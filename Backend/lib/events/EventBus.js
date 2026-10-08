const { InboxRepository } = require('../../handlers/inbox-module/inbox.repository');
const { ObraService } = require('../services/ObraService');
const { PersonaService } = require('../services/PersonaService');
const { EstructuraPreventivaService } = require('../services/EstructuraPreventivaService');
const EP = require('../estructura-preventiva');
const { normalizeRol } = require('../utils/validation');
const { UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient } = require('../clients/dynamodb');
const { registrarFallo } = require('../degradacion');
const { v4: uuidv4 } = require('uuid');
const { encolar, colaConfigurada } = require('../cola');

const DOCUMENTS_TABLE = process.env.DOCUMENTS_TABLE || 'Documents';

// Nombre del remitente de las notificaciones automáticas del sistema.
const SYSTEM_SENDER_NAME = 'Build & Serve';

// Roles que componen la línea de mando (destinatarios de avisos de gestión, p.ej.
// actualización de versión de un procedimiento).
const ROLES_LINEA_MANDO = new Set(['admin', 'jefe_obra', 'supervisor', 'prevencionista']);

/**
 * Simple Event Bus for dispatching system events
 * This allows decoupling of business logic from notifications
 */
class EventBus {
    constructor() {
        this.listeners = new Map();
        this.inboxRepo = new InboxRepository();
        this.obraService = new ObraService();
        this.personaService = new PersonaService();
        this.estructuraService = new EstructuraPreventivaService();
    }

    /**
     * Resuelve los personaId de la línea de mando de un tenant (admin, jefe_obra,
     * supervisor, prevencionista), excluyendo desvinculados.
     *
     * Si la lectura falla, LANZA (D-25). Antes devolvía [] y el aviso "salía"
     * sin destinatarios: una difusión que no llegó a nadie registrada como hecha.
     * Ahora el evento falla y la cola lo reintenta.
     */
    async resolverLineaMando(tenantId) {
        if (!tenantId) return [];
        const personas = await this.personaService.listByTenant(tenantId);
        return personas
            .filter(p => ROLES_LINEA_MANDO.has(normalizeRol(p.rol)))
            .map(p => p.personaId)
            .filter(Boolean);
    }

    /**
     * Resuelve los personaId de los REPRESENTANTES de las personas trabajadoras:
     * integrantes activos de los organos vigentes (comite paritario, delegado de
     * SST, departamento de prevencion) del ambito que corresponde.
     *
     * Existen porque el DS 44 no razona por rol de sistema: el Art. 7 inc. 9
     * obliga a informar la MIPER al comite, al delegado y a los dirigentes
     * sindicales, y ninguno de los tres es un `rol` de PersonasTable. Son cargos
     * electos que viven en la estructura preventiva.
     *
     * Se consultan DOS ambitos: los organos de la empresa aplican a todas las
     * obras, y los de la obra son propios de ella (el conteo del Art. 23 es por
     * lugar de trabajo). Un organo VENCIDO no notifica: su mandato expiro y sus
     * integrantes ya no representan a nadie.
     */
    async resolverRepresentantesSST(tenantId, obraId = null) {
        if (!tenantId) return [];
        // Si la lectura falla, LANZA (D-25): un representante que no recibe el
        // aviso porque la estructura no se pudo leer no es "sin representantes".
        // La publicación del documento no se bloquea: el aviso va por la cola y
        // se reintenta ahí.
        const organos = await this.estructuraService.listarOrganos(tenantId);
        const delAmbito = organos.filter((o) =>
            (o.ambito === EP.AMBITO.EMPRESA) || (obraId && o.obraId === obraId));
        const vigentes = delAmbito.filter((o) => EP.estadoOrgano(o) === EP.ESTADO_ORGANO.VIGENTE);
        if (vigentes.length === 0) return [];

        const detalles = await Promise.all(
            vigentes.map((o) => this.estructuraService.getOrgano(tenantId, o.organoId)),
        );
        const ids = detalles
            .filter(Boolean)
            .flatMap((o) => (o.miembros || [])
                .filter((m) => m.estado === 'activo' && !m.fechaTermino)
                .map((m) => m.personaId));
        return [...new Set(ids.filter(Boolean))];
    }

    /**
     * Resuelve el nombre de una obra a partir de su id. Devuelve null si no se
     * puede obtener (la notificación se envía igual, sin la referencia a obra).
     */
    async getObraName(obraId) {
        if (!obraId) return null;
        try {
            const obra = await this.obraService.getById(obraId);
            return obra?.nombre || null;
        } catch (err) {
            console.error('Error resolviendo nombre de obra para notificación:', err);
            return null;
        }
    }

    /**
     * Register a listener for a specific event
     * @param {string} event - Event name
     * @param {Function} callback - Callback to execute
     */
    on(event, callback) {
        if (!this.listeners.has(event)) {
            this.listeners.set(event, []);
        }
        this.listeners.get(event).push(callback);
    }

    /**
     * Emite un evento (D-25).
     *
     * Con la cola de eventos configurada, el evento se ENCOLA y la petición
     * responde: los avisos los escribe `handlers/cola/trabajador.js`, que los
     * reintenta si fallan. Notificar a la línea de mando y a los representantes
     * es parte de acreditar que se informó (Art. 7 inc. 9, Art. 57 inc. 2), así
     * que la razón de la cola es la DURABILIDAD, no la velocidad.
     *
     * Si no se puede encolar, o no hay cola (pruebas, local), se despacha en la
     * petición como antes: un fallo no tumba la operación que emitió el evento,
     * pero queda un marcador medible (`evento.encolar`, `evento.suscriptor`).
     */
    async emit(event, data) {
        const callbacks = this.listeners.get(event);
        if (!callbacks || callbacks.length === 0) {
            console.log(`No listeners for event: ${event}`);
            return;
        }
        const eventoId = uuidv4();
        if (colaConfigurada('EVENTOS')) {
            try {
                await encolar('EVENTOS', [{ tipo: 'evento', eventoId, evento: event, data, en: new Date().toISOString() }]);
                return;
            } catch (err) {
                registrarFallo('evento.encolar', err, { evento: event });
            }
        }
        await this.despachar(event, data, { eventoId, estricto: false });
    }

    /**
     * Corre los suscriptores de un evento. Cada uno recibe `{ eventoId }` para
     * escribir de forma idempotente: el mismo evento despachado dos veces (un
     * reintento de la cola) no duplica avisos ni constancias.
     *
     * `estricto` (el trabajador de la cola): si algún suscriptor falla, lanza,
     * y el mensaje vuelve a la cola. Sin `estricto` (en la petición): el fallo
     * queda como marcador y la operación sigue.
     */
    async despachar(event, data, { eventoId, estricto }) {
        const callbacks = this.listeners.get(event) || [];
        const resultados = await Promise.allSettled(callbacks.map((cb) => cb(data, { eventoId })));
        const fallas = resultados.filter((r) => r.status === 'rejected').map((r) => r.reason);
        if (!fallas.length) return;
        if (estricto) {
            const err = new Error(`${fallas.length} suscriptor(es) de ${event} fallaron: ${fallas.map((f) => f?.message).join('; ')}`);
            err.causas = fallas;
            throw err;
        }
        for (const f of fallas) {
            registrarFallo('evento.suscriptor', f, { evento: event });
            console.error(`Error in event listener for ${event}:`, f);
        }
    }

    /**
     * Send a notification to inbox for document assignment
     */
    async onDocumentAssigned(data, ctx = {}) {
        // In the new model, userIds, workerIds, and personaIds are all the same (personaId)
        const { documentId, userIds, workerIds, personaIds, assignedBy, creatorName, documentName, dueDate } = data;
        const recipientIds = personaIds || userIds || workerIds || [];

        if (!recipientIds || recipientIds.length === 0) {
            console.log('No users to notify for document assignment');
            return;
        }

        const dueDateText = dueDate ? `Vencimiento: ${dueDate}` : '';
        await this.inboxRepo.sendMessage({
            senderId: assignedBy || 'system',
            senderName: creatorName || 'Gestor SST',
            senderRol: 'system',
            recipientIds: recipientIds,
            type: 'task',
            priority: 'normal',
            subject: `Nuevo documento asignado: ${documentName}`,
            content: `Se te ha asignado el documento "${documentName}". Por favor revisa y firma antes del vencimiento. ${dueDateText}`,
            linkedEntity: { type: 'document', id: documentId },
            idempotencia: idem(ctx, 'document.assigned'),
        });
        console.log(`Notification sent for document ${documentId} to ${recipientIds.length} users`);
    }

    /**
     * Send a notification to inbox for activity creation
     */
    async onActivityCreated(data, ctx = {}) {
        const { activityId, attendeeIds, createdBy, activityName, fecha, obraId } = data;

        if (!attendeeIds || attendeeIds.length === 0) {
            console.log('No attendees to notify for activity');
            return;
        }

        const obraNombre = await this.getObraName(obraId);
        const obraText = obraNombre ? ` Obra: ${obraNombre}.` : '';
        await this.inboxRepo.sendMessage({
            senderId: createdBy || 'system',
            senderName: SYSTEM_SENDER_NAME,
            senderRol: 'system',
            recipientIds: attendeeIds,
            type: 'notification',
            priority: 'normal',
            subject: `Nueva actividad: ${activityName}`,
            content: `Se ha creado la actividad "${activityName}" para el ${fecha}. Recuerda asistir y registrar tu firma.${obraText}`,
            linkedEntity: { type: 'activity', id: activityId },
            idempotencia: idem(ctx, 'activity.created'),
        });
        console.log(`Notification sent for activity ${activityId} to ${attendeeIds.length} attendees`);
    }

    /**
     * Send a notification to inbox for survey assignment
     */
    async onSurveyAssigned(data, ctx = {}) {
        // Accept both userIds (new) and workerIds (legacy) for backwards compatibility
        const { surveyId, userIds, workerIds, assignedBy, creatorName, surveyName, dueDate } = data;
        const recipientIds = userIds || workerIds || [];

        if (!recipientIds || recipientIds.length === 0) {
            console.log('No users to notify for survey');
            return;
        }

        const dueDateText = dueDate ? `Responder antes del: ${dueDate}` : '';
        await this.inboxRepo.sendMessage({
            senderId: assignedBy || 'system',
            senderName: creatorName || 'Gestor SST',
            senderRol: 'system',
            recipientIds: recipientIds,
            type: 'task',
            priority: 'normal',
            subject: `Nueva encuesta asignada: ${surveyName}`,
            content: `Se te ha asignado la encuesta "${surveyName}". ${dueDateText}`,
            linkedEntity: { type: 'survey', id: surveyId },
            idempotencia: idem(ctx, 'survey.assigned'),
        });
        console.log(`Notification sent for survey ${surveyId} to ${recipientIds.length} users`);
    }

    /**
     * Send a notification to inbox for signature request
     */
    async onSignatureRequested(data, ctx = {}) {
        // In the new model, workerIds and personaIds are the same (personaId)
        const { requestId, workerIds, personaIds, requestedBy, documentName, priority, obraId } = data;
        const recipientIds = personaIds || workerIds || [];

        if (!recipientIds || recipientIds.length === 0) {
            console.log('No recipients to notify for signature request');
            return;
        }

        const priorityLevel = priority === 'urgent' ? 'urgent' : 'normal';
        const obraNombre = await this.getObraName(obraId);
        const obraText = obraNombre ? ` Obra: ${obraNombre}.` : '';
        await this.inboxRepo.sendMessage({
            senderId: requestedBy || 'system',
            senderName: SYSTEM_SENDER_NAME,
            senderRol: 'system',
            recipientIds: recipientIds,
            type: 'task',
            priority: priorityLevel,
            subject: `Firma requerida: ${documentName}`,
            content: `Se requiere tu firma para el documento "${documentName}". Por favor firma a la brevedad.${obraText}`,
            linkedEntity: { type: 'signature-request', id: requestId },
            idempotencia: idem(ctx, 'signature.requested'),
        });
        console.log(`Notification sent for signature request ${requestId} to ${recipientIds.length} personas`);
    }

    /**
     * Notify the worker that their EPP delivery was validated and can be signed
     */
    async onEppValidado(data, ctx = {}) {
        const { personaId, entregaDocumentId, validadoPor } = data;
        if (!personaId) {
            console.log('No recipient to notify for EPP validation');
            return;
        }

        await this.inboxRepo.sendMessage({
            senderId: validadoPor || 'system',
            senderName: 'PrevencionApp',
            senderRol: 'system',
            recipientIds: [personaId],
            type: 'task',
            priority: 'normal',
            subject: 'Entrega de EPP validada',
            content: 'Tu entrega de EPP fue validada por una instancia superior. Ya puedes firmar la recepcion con tu PIN.',
            linkedEntity: { type: 'document', id: entregaDocumentId },
            idempotencia: idem(ctx, 'epp.validado'),
        });
        console.log(`Notification sent for EPP validation ${entregaDocumentId}`);
    }

    /**
     * Notifica la publicación de una nueva versión de un procedimiento:
     *  - Línea de mando: aviso prioritario (difusión del cambio).
     *  - Firmantes previos: tarea de re-firma de la versión vigente.
     * El que publicó se excluye para no auto-notificarse; un firmante que además
     * es mando recibe solo el aviso de mando (no se duplica).
     *
     * Reintentable de punta a punta (D-25): cada envío tiene su clave de
     * idempotencia y la constancia de difusión se registra una sola vez por
     * evento. Si falla a mitad de camino, el reintento completa lo que faltó.
     */
    async onDocumentVersionUpdated(data, ctx = {}) {
        const {
            documentId, tenantId, obraId, documentName, version,
            motivo, publicadaPor, publicadaPorNombre, firmanteIds,
        } = data;

        const obraNombre = await this.getObraName(obraId);
        const obraText = obraNombre ? ` Obra: ${obraNombre}.` : '';
        const senderName = publicadaPorNombre || SYSTEM_SENDER_NAME;

        // 1) Línea de mando — aviso de gestión (prioridad alta).
        const mando = await this.resolverLineaMando(tenantId);
        const mandoRecipients = mando.filter(pid => pid && pid !== publicadaPor);
        if (mandoRecipients.length > 0) {
            await this.inboxRepo.sendMessage({
                senderId: publicadaPor || 'system',
                senderName,
                senderRol: 'system',
                recipientIds: mandoRecipients,
                type: 'alert',
                priority: 'high',
                subject: `Procedimiento actualizado a v${version}: ${documentName}`,
                content: `Se publicó la versión ${version} del procedimiento "${documentName}".${obraText} Motivo: ${motivo}. Difúndelo en tu línea de mando y verifica la re-firma del personal.`,
                linkedEntity: { type: 'document', id: documentId },
                idempotencia: idem(ctx, 'document.version.updated:mando'),
            });
        }

        // 2) Representantes de las personas trabajadoras (Art. 7 inc. 9, Art. 8
        // inc. 3, Art. 57 inc. 2). No se les pide firmar: se les INFORMA, que es
        // lo que exige la norma. Se excluye a quien ya recibio el aviso de mando
        // —un prevencionista puede ser ademas integrante del comite— para no
        // mandarle dos mensajes del mismo hecho.
        const representantes = await this.resolverRepresentantesSST(tenantId, obraId);
        const repRecipients = representantes.filter(
            pid => pid && pid !== publicadaPor && !mandoRecipients.includes(pid));
        if (repRecipients.length > 0) {
            await this.inboxRepo.sendMessage({
                senderId: publicadaPor || 'system',
                senderName,
                senderRol: 'system',
                recipientIds: repRecipients,
                type: 'alert',
                priority: 'normal',
                subject: `Documento actualizado a v${version}: ${documentName}`,
                content: `Se informa la versión ${version} de "${documentName}".${obraText} Motivo: ${motivo}. Se remite en tu calidad de representante de las personas trabajadoras.`,
                linkedEntity: { type: 'document', id: documentId },
                idempotencia: idem(ctx, 'document.version.updated:representantes'),
            });
        }

        // 3) Firmantes previos — tarea de re-firma (excluye a los ya avisados).
        const firmantes = (firmanteIds || []).filter(
            pid => pid && pid !== publicadaPor
                && !mandoRecipients.includes(pid) && !repRecipients.includes(pid));
        if (firmantes.length > 0) {
            await this.inboxRepo.sendMessage({
                senderId: publicadaPor || 'system',
                senderName,
                senderRol: 'system',
                recipientIds: firmantes,
                type: 'task',
                priority: 'normal',
                subject: `Nueva versión por firmar: ${documentName}`,
                content: `El procedimiento "${documentName}" se actualizó a la versión ${version}.${obraText} Debes leer y firmar nuevamente la versión vigente.`,
                linkedEntity: { type: 'document', id: documentId },
                idempotencia: idem(ctx, 'document.version.updated:firmantes'),
            });
        }

        await this.registrarDifusion({
            documentId, version, motivo, publicadaPor, eventoId: ctx.eventoId,
            mando: mandoRecipients, representantes: repRecipients, firmantes,
        });

        console.log(`Notificación de versión ${version} de ${documentId} (mando: ${mandoRecipients.length}, representantes: ${repRecipients.length}, re-firma: ${firmantes.length})`);
    }

    /**
     * Deja constancia en el documento de a quien se informo y cuando.
     *
     * El fiscalizador no pregunta si el sistema "puede" notificar: pide la prueba
     * de que se informo, a quienes y en que fecha (Art. 7 inc. 9, Art. 8 inc. 3).
     * Se guarda en el propio documento y no en una tabla aparte porque la
     * constancia solo tiene sentido junto a la version que se difundio.
     *
     * Una sola vez por evento: el `eventoId` queda en `difusionEventos` en la
     * misma escritura, y un reintento que la encuentra no agrega otra. Si la
     * escritura falla, LANZA: sin constancia el evento no está terminado y la
     * cola lo reintenta (D-25).
     */
    async registrarDifusion({ documentId, version, motivo, publicadaPor, eventoId = null, mando = [], representantes = [], firmantes = [] }) {
        if (!documentId) return;
        const constancia = {
            // `automatica`: la generó el sistema al publicar. Las declaradas por el
            // usuario (Art. 57 inc. 2) llevan `manual` y su destinatario tipificado.
            origen: 'automatica',
            fecha: new Date().toISOString(),
            version: version || null,
            motivo: motivo || null,
            publicadaPor: publicadaPor || null,
            destinatarios: { mando, representantes, firmantes },
            totales: {
                mando: mando.length,
                representantes: representantes.length,
                firmantes: firmantes.length,
            },
        };
        const conEvento = Boolean(eventoId);
        try {
            await docClient.send(new UpdateCommand({
                TableName: DOCUMENTS_TABLE,
                Key: { documentId },
                UpdateExpression: `SET difusiones = list_append(if_not_exists(difusiones, :vacio), :d), updatedAt = :now${conEvento ? ' ADD difusionEventos :evs' : ''}`,
                ...(conEvento ? { ConditionExpression: 'attribute_not_exists(difusionEventos) OR NOT contains(difusionEventos, :ev)' } : {}),
                ExpressionAttributeValues: {
                    ':d': [constancia],
                    ':vacio': [],
                    ':now': constancia.fecha,
                    ...(conEvento ? { ':evs': new Set([eventoId]), ':ev': eventoId } : {}),
                },
            }));
        } catch (err) {
            // Ya estaba: la registró un intento anterior del mismo evento.
            if (conEvento && err.name === 'ConditionalCheckFailedException') return;
            throw err;
        }
    }

    /**
     * Send urgent notification to prevencionistas for incident report
     */
    async onIncidentReported(data, ctx = {}) {
        const { incidentId, reportedBy, reporterName, tipo, descripcion } = data;

        if (!data.recipientIds || data.recipientIds.length === 0) {
            console.log('No prevencionistas to notify for incident');
            return;
        }

        await this.inboxRepo.sendMessage({
            senderId: reportedBy || 'system',
            senderName: reporterName || 'Sistema',
            senderRol: 'system',
            recipientIds: data.recipientIds,
            type: 'alert',
            priority: 'urgent',
            subject: `Nuevo incidente reportado: ${tipo}`,
            content: `Se ha reportado un incidente de tipo "${tipo}". Descripción: ${descripcion}. Requiere atención inmediata.`,
            linkedEntity: { type: 'incident', id: incidentId },
            idempotencia: idem(ctx, 'incident.reported'),
        });
        console.log(`URGENT notification sent for incident ${incidentId}`);
    }
}

/** Clave de idempotencia de un envío dentro de un evento (null fuera de un evento). */
const idem = (ctx, clave) => (ctx && ctx.eventoId ? `${ctx.eventoId}:${clave}` : null);

// Create singleton instance
const eventBus = new EventBus();

// Register default listeners
eventBus.on('document.assigned', (data, ctx) => eventBus.onDocumentAssigned(data, ctx));
eventBus.on('activity.created', (data, ctx) => eventBus.onActivityCreated(data, ctx));
eventBus.on('survey.assigned', (data, ctx) => eventBus.onSurveyAssigned(data, ctx));
eventBus.on('signature.requested', (data, ctx) => eventBus.onSignatureRequested(data, ctx));
eventBus.on('incident.reported', (data, ctx) => eventBus.onIncidentReported(data, ctx));
eventBus.on('epp.validado', (data, ctx) => eventBus.onEppValidado(data, ctx));
eventBus.on('document.version.updated', (data, ctx) => eventBus.onDocumentVersionUpdated(data, ctx));

module.exports = { eventBus };
