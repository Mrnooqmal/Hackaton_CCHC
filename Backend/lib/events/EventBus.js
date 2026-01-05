const { InboxRepository } = require('../../handlers/inbox-module/inbox.repository');

/**
 * Simple Event Bus for dispatching system events
 * This allows decoupling of business logic from notifications
 */
class EventBus {
    constructor() {
        this.listeners = new Map();
        this.inboxRepo = new InboxRepository();
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
        const { documentId, workerIds, assignedBy, documentName, dueDate } = data;

        if (!workerIds || workerIds.length === 0) {
            console.log('No workers to notify for document assignment');
            return;
        }

        try {
            const dueDateText = dueDate ? `Vencimiento: ${dueDate}` : '';

            await this.inboxRepo.sendMessage({
                senderId: assignedBy || 'system',
                senderName: 'PrevencionApp',
                senderRol: 'system',
                recipientIds: workerIds,
                type: 'task',
                priority: 'normal',
                subject: `Nuevo documento asignado: ${documentName}`,
                content: `Se te ha asignado el documento "${documentName}". Por favor revisa y firma antes del vencimiento. ${dueDateText}`,
                linkedEntity: { type: 'document', id: documentId }
            });

            console.log(`✅ Notification sent for document ${documentId} to ${workerIds.length} workers`);
        } catch (error) {
            console.error('Error sending document notification:', error);
        }
    }

    /**
     * Send a notification to inbox for activity creation
     */
    async onActivityCreated(data) {
        const { activityId, attendeeIds, createdBy, activityName, fecha, tipo } = data;

        if (!attendeeIds || attendeeIds.length === 0) {
            console.log('No attendees to notify for activity');
            return;
        }

        try {
            await this.inboxRepo.sendMessage({
                senderId: createdBy || 'system',
                senderName: 'PrevencionApp',
                senderRol: 'system',
                recipientIds: attendeeIds,
                type: 'notification',
                priority: 'normal',
                subject: `Nueva actividad: ${activityName}`,
                content: `Se ha creado la actividad "${activityName}" (${tipo}) para el ${fecha}. Recuerda asistir y registrar tu firma.`,
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
        const { requestId, workerIds, requestedBy, documentName, priority } = data;

        if (!workerIds || workerIds.length === 0) {
            console.log('No workers to notify for signature request');
            return;
        }

        try {
            const priorityLevel = priority === 'urgent' ? 'urgent' : 'normal';

            await this.inboxRepo.sendMessage({
                senderId: requestedBy || 'system',
                senderName: 'PrevencionApp',
                senderRol: 'system',
                recipientIds: workerIds,
                type: 'task',
                priority: priorityLevel,
                subject: `Firma requerida: ${documentName}`,
                content: `Se requiere tu firma para el documento "${documentName}". Por favor firma a la brevedad.`,
                linkedEntity: { type: 'signature-request', id: requestId }
            });

            console.log(`✅ Notification sent for signature request ${requestId} to ${workerIds.length} workers`);
        } catch (error) {
            console.error('Error sending signature request notification:', error);
        }
    }

    /**
     * Send urgent notification to prevencionistas for incident report
     */
    async onIncidentReported(data) {
        const { incidentId, reportedBy, reporterName, tipo, descripcion, empresaId } = data;

        try {
            // Get all prevencionistas for this empresa
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

module.exports = { eventBus };
