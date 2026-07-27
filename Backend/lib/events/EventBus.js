const { InboxRepository } = require('../../handlers/inbox-module/inbox.repository');
const { ObraService } = require('../services/ObraService');

// Nombre del remitente de las notificaciones automáticas del sistema.
const SYSTEM_SENDER_NAME = 'Build & Serve';

/**
 * Simple Event Bus for dispatching system events
 * This allows decoupling of business logic from notifications
 */
class EventBus {
    constructor() {
        this.listeners = new Map();
        this.inboxRepo = new InboxRepository();
        this.obraService = new ObraService();
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
     * Emit an event and trigger all registered listeners
     * @param {string} event - Event name
     * @param {object} data - Event data
     */
    async emit(event, data) {
        const callbacks = this.listeners.get(event);
        if (!callbacks || callbacks.length === 0) {
            console.log(`No listeners for event: ${event}`);
            return;
        }

        console.log(`Emitting event: ${event}`, { listenersCount: callbacks.length });

        // Execute all callbacks in parallel
        const promises = callbacks.map(callback =>
            callback(data).catch(err => {
                console.error(`Error in event listener for ${event}:`, err);
            })
        );

        await Promise.all(promises);
    }

    /**
     * Send a notification to inbox for document assignment
     */
    async onDocumentAssigned(data) {
        // In the new model, userIds, workerIds, and personaIds are all the same (personaId)
        const { documentId, userIds, workerIds, personaIds, assignedBy, creatorName, documentName, dueDate } = data;
        const recipientIds = personaIds || userIds || workerIds || [];

        if (!recipientIds || recipientIds.length === 0) {
            console.log('No users to notify for document assignment');
            return;
        }

        try {
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
                linkedEntity: { type: 'document', id: documentId }
            });

            console.log(`✅ Notification sent for document ${documentId} to ${recipientIds.length} users`);
        } catch (error) {
            console.error('Error sending document notification:', error);
        }
    }

    /**
     * Send a notification to inbox for activity creation
     */
    async onActivityCreated(data) {
        const { activityId, attendeeIds, createdBy, activityName, fecha, obraId } = data;

        if (!attendeeIds || attendeeIds.length === 0) {
            console.log('No attendees to notify for activity');
            return;
        }

        try {
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
                linkedEntity: { type: 'activity', id: activityId }
            });

            console.log(`✅ Notification sent for activity ${activityId} to ${attendeeIds.length} attendees`);
        } catch (error) {
            console.error('Error sending activity notification:', error);
        }
    }

    /**
     * Send a notification to inbox for survey assignment
     */
    async onSurveyAssigned(data) {
        // Accept both userIds (new) and workerIds (legacy) for backwards compatibility
        const { surveyId, userIds, workerIds, assignedBy, creatorName, surveyName, dueDate } = data;
        const recipientIds = userIds || workerIds || [];

        if (!recipientIds || recipientIds.length === 0) {
            console.log('No users to notify for survey');
            return;
        }

        try {
            const dueDateText = dueDate ? `Responder antes del: ${dueDate}` : '';

            await this.inboxRepo.sendMessage({
                senderId: assignedBy || 'system',
                senderName: creatorName || 'Gestor SST', // Use creator's name
                senderRol: 'system',
                recipientIds: recipientIds,
                type: 'task',
                priority: 'normal',
                subject: `Nueva encuesta asignada: ${surveyName}`,
                content: `Se te ha asignado la encuesta "${surveyName}". ${dueDateText}`,
                linkedEntity: { type: 'survey', id: surveyId }
            });

            console.log(`✅ Notification sent for survey ${surveyId} to ${recipientIds.length} users`);
        } catch (error) {
            console.error('Error sending survey notification:', error);
        }
    }

    /**
     * Send a notification to inbox for signature request
     */
    async onSignatureRequested(data) {
        // In the new model, workerIds and personaIds are the same (personaId)
        const { requestId, workerIds, personaIds, requestedBy, documentName, priority, obraId } = data;
        const recipientIds = personaIds || workerIds || [];

        if (!recipientIds || recipientIds.length === 0) {
            console.log('No recipients to notify for signature request');
            return;
        }

        try {
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
                linkedEntity: { type: 'signature-request', id: requestId }
            });

            console.log(`✅ Notification sent for signature request ${requestId} to ${recipientIds.length} personas`);
        } catch (error) {
            console.error('Error sending signature request notification:', error);
        }
    }

    /**
     * Notify the worker that their EPP delivery was validated and can be signed
     */
    async onEppValidado(data) {
        const { personaId, entregaDocumentId, validadoPor } = data;
        if (!personaId) {
            console.log('No recipient to notify for EPP validation');
            return;
        }

        try {
            await this.inboxRepo.sendMessage({
                senderId: validadoPor || 'system',
                senderName: 'PrevencionApp',
                senderRol: 'system',
                recipientIds: [personaId],
                type: 'task',
                priority: 'normal',
                subject: 'Entrega de EPP validada',
                content: 'Tu entrega de EPP fue validada por una instancia superior. Ya puedes firmar la recepcion con tu PIN.',
                linkedEntity: { type: 'document', id: entregaDocumentId }
            });

            console.log(`Notification sent for EPP validation ${entregaDocumentId} to ${personaId}`);
        } catch (error) {
            console.error('Error sending EPP validation notification:', error);
        }
    }

    /**
     * Send urgent notification to prevencionistas for incident report
     */
    async onIncidentReported(data) {
        const { incidentId, reportedBy, reporterName, tipo, descripcion, tenantId } = data;

        try {
            // Get all prevencionistas for this tenant
            // TODO: Implement getPrevencionistas helper if needed
            // For now, we'll need to pass recipientIds from the handler

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
                subject: `🚨 Nuevo incidente reportado: ${tipo}`,
                content: `Se ha reportado un incidente de tipo "${tipo}". Descripción: ${descripcion}. Requiere atención inmediata.`,
                linkedEntity: { type: 'incident', id: incidentId }
            });

            console.log(`✅ URGENT notification sent for incident ${incidentId}`);
        } catch (error) {
            console.error('Error sending incident notification:', error);
        }
    }
}

// Create singleton instance
const eventBus = new EventBus();

// Register default listeners
eventBus.on('document.assigned', (data) => eventBus.onDocumentAssigned(data));
eventBus.on('activity.created', (data) => eventBus.onActivityCreated(data));
eventBus.on('survey.assigned', (data) => eventBus.onSurveyAssigned(data));
eventBus.on('signature.requested', (data) => eventBus.onSignatureRequested(data));
eventBus.on('incident.reported', (data) => eventBus.onIncidentReported(data));
eventBus.on('epp.validado', (data) => eventBus.onEppValidado(data));

module.exports = { eventBus };
