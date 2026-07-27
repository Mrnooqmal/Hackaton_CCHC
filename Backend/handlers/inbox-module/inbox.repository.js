const { v4: uuidv4 } = require('uuid');
const { PutCommand, GetCommand, QueryCommand, UpdateCommand, DeleteCommand, ScanCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient } = require('../../lib/clients/dynamodb');
const { normalizeRol } = require('../../lib/utils/validation');
const { sendSms, toE164Chile } = require('../../lib/services/SmsService');

const INBOX_TABLE = process.env.INBOX_TABLE || 'Inbox';
const PERSONAS_TABLE = process.env.PERSONAS_TABLE || 'Personas';

// Tipos de mensaje
const MESSAGE_TYPES = ['message', 'notification', 'alert', 'task'];
const PRIORITIES = ['normal', 'high', 'urgent'];

class InboxRepository {
    constructor() {
        this.dynamo = docClient;
        this.inboxTable = INBOX_TABLE;
        this.personasTable = PERSONAS_TABLE;
    }

    async sendMessage(body) {
        const { senderId, senderName, senderRol, recipientIds, type, priority, subject, content, linkedEntity } = body;

        // Validación
        if (!senderId || !recipientIds || !Array.isArray(recipientIds) || recipientIds.length === 0) {
            throw new Error('senderId y recipientIds (array) son requeridos');
        }
        if (!subject || !content) {
            throw new Error('subject y content son requeridos');
        }

        const messageType = MESSAGE_TYPES.includes(type) ? type : 'message';
        const messagePriority = PRIORITIES.includes(priority) ? priority : 'normal';
        const now = new Date().toISOString();
        const baseMessageId = uuidv4();

        const messages = [];

        // Crear un mensaje por cada destinatario
        for (const recipientId of recipientIds) {
            const messageId = `${baseMessageId}-${recipientId.substring(0, 8)}`;

            const message = {
                recipientId,
                messageId,
                senderId,
                senderName: senderName || 'Sistema',
                senderRol: senderRol || 'system',
                type: messageType,
                priority: messagePriority,
                subject,
                content,
                read: false,
                readAt: null,
                archivedByRecipient: false,
                archivedBySender: false,
                linkedEntity: linkedEntity || null,
                createdAt: now,
                updatedAt: now
            };

            await this.dynamo.send(new PutCommand({
                TableName: this.inboxTable,
                Item: message
            }));

            messages.push(message);
        }

        // Notificación por SMS (best-effort, no bloquea ni rompe el envío al inbox).
        // Solo se dispara para mensajes de otro usuario o prioritarios; el filtrado
        // por preferencia/teléfono del destinatario ocurre dentro del método.
        await this._notifyBySms({
            recipientIds,
            senderName: senderName || 'Sistema',
            senderRol: senderRol || 'system',
            priority: messagePriority,
            subject,
            content
        }).catch(err => console.error('Error en notificación SMS:', err));

        return {
            message: `Mensaje enviado a ${recipientIds.length} destinatario(s)`,
            messageId: baseMessageId,
            count: messages.length
        };
    }

    /**
     * Envía SMS a los destinatarios que correspondan, según la política:
     *   - El mensaje proviene de otro usuario de la plataforma (senderRol !== 'system'), o
     *   - El mensaje está marcado como prioritario (priority high/urgent).
     * Y por cada destinatario:
     *   - Autorizó las notificaciones por SMS (notificacionesSms === true), y
     *   - Tiene un teléfono normalizable a E.164.
     * Las notificaciones automáticas de prioridad normal NO generan SMS (evita
     * saturar al usuario con decenas de mensajes diarios).
     */
    async _notifyBySms({ recipientIds, senderName, senderRol, priority, subject, content }) {
        const esDeUsuario = senderRol && senderRol !== 'system';
        const esPrioritario = priority === 'high' || priority === 'urgent';
        if (!esDeUsuario && !esPrioritario) return;

        // Lazy require para evitar dependencias circulares en la carga de módulos.
        const { PersonaService } = require('../../lib/services/PersonaService');
        const personaService = new PersonaService();

        const texto = this._buildSmsText({ senderName, priority, subject, content });

        await Promise.all(recipientIds.map(async (recipientId) => {
            try {
                const persona = await personaService.getById(recipientId);
                if (!persona || !persona.notificacionesSms) return;
                const phone = toE164Chile(persona.telefono);
                if (!phone) return;
                await sendSms(phone, texto);
            } catch (err) {
                console.error(`No se pudo enviar SMS a ${recipientId}:`, err.message);
            }
        }));
    }

    /**
     * Construye el texto del SMS. Se mantiene conciso (idealmente ~1 segmento de
     * 160 caracteres) recortando el contenido; el detalle completo vive en la
     * plataforma.
     */
    _buildSmsText({ senderName, priority, subject, content }) {
        const prefijo = priority === 'urgent' ? '🚨 Build & Serve' : 'Build & Serve';
        const remitente = senderName && senderName !== 'Sistema' ? `${senderName}: ` : '';
        let texto = `${prefijo} — ${remitente}${subject}`;
        if (content) {
            const snippet = content.length > 90 ? `${content.slice(0, 87)}…` : content;
            texto += `\n${snippet}`;
        }
        texto += '\nIngresa a la plataforma para ver el detalle.';
        return texto;
    }

    async getInbox(params) {
        const { userId, filter = 'all', limit = 50 } = params;

        if (!userId) {
            throw new Error('userId es requerido');
        }

        let filterExpression = 'recipientId = :recipientId';
        const expressionValues = { ':recipientId': userId };

        if (filter === 'unread') {
            filterExpression += ' AND #read = :read';
            expressionValues[':read'] = false;
        } else if (filter === 'archived') {
            filterExpression += ' AND archivedByRecipient = :archived';
            expressionValues[':archived'] = true;
        } else {
            // Por defecto, excluir archivados
            filterExpression += ' AND (archivedByRecipient = :notArchived OR attribute_not_exists(archivedByRecipient))';
            expressionValues[':notArchived'] = false;
        }

        // La sort key de la tabla es messageId (UUID), por lo que el orden de la
        // Query NO es temporal. Se pagina la query completa del destinatario y se
        // ordena por createdAt descendente (como un correo) antes de aplicar limit.
        const items = [];
        let ExclusiveStartKey;
        do {
            const result = await this.dynamo.send(new QueryCommand({
                TableName: this.inboxTable,
                KeyConditionExpression: 'recipientId = :recipientId',
                FilterExpression: filter === 'all'
                    ? '(archivedByRecipient = :notArchived OR attribute_not_exists(archivedByRecipient))'
                    : filter === 'unread'
                        ? '#read = :read'
                        : 'archivedByRecipient = :archived',
                ExpressionAttributeValues: expressionValues,
                ExpressionAttributeNames: filter === 'unread' ? { '#read': 'read' } : undefined,
                ExclusiveStartKey
            }));
            items.push(...(result.Items || []));
            ExclusiveStartKey = result.LastEvaluatedKey;
        } while (ExclusiveStartKey);

        items.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
        const messages = items.slice(0, limit);

        return {
            messages,
            count: messages.length
        };
    }

    async getSent(params) {
        const { userId, limit = 50 } = params;

        if (!userId) {
            throw new Error('userId es requerido');
        }

        const result = await this.dynamo.send(new QueryCommand({
            TableName: this.inboxTable,
            IndexName: 'senderId-createdAt-index',
            KeyConditionExpression: 'senderId = :senderId',
            ExpressionAttributeValues: { ':senderId': userId },
            ScanIndexForward: false,
            Limit: limit
        }));

        return {
            messages: result.Items || [],
            count: result.Count || 0
        };
    }

    async getMessage(messageId, userId) {
        if (!messageId || !userId) {
            throw new Error('messageId y userId son requeridos');
        }

        const result = await this.dynamo.send(new GetCommand({
            TableName: this.inboxTable,
            Key: { recipientId: userId, messageId }
        }));

        if (!result.Item) {
            throw new Error('Mensaje no encontrado');
        }

        // Marcar como leído automáticamente al obtener
        if (!result.Item.read) {
            const now = new Date().toISOString();
            await this.dynamo.send(new UpdateCommand({
                TableName: this.inboxTable,
                Key: { recipientId: userId, messageId },
                UpdateExpression: 'SET #read = :read, readAt = :readAt',
                ExpressionAttributeNames: { '#read': 'read' },
                ExpressionAttributeValues: { ':read': true, ':readAt': now }
            }));
            result.Item.read = true;
            result.Item.readAt = now;
        }

        return result.Item;
    }

    async markAsRead(messageId, userId) {
        if (!messageId || !userId) {
            throw new Error('messageId y userId son requeridos');
        }

        const now = new Date().toISOString();
        await this.dynamo.send(new UpdateCommand({
            TableName: this.inboxTable,
            Key: { recipientId: userId, messageId },
            UpdateExpression: 'SET #read = :read, readAt = :readAt',
            ExpressionAttributeNames: { '#read': 'read' },
            ExpressionAttributeValues: { ':read': true, ':readAt': now }
        }));

        return { message: 'Mensaje marcado como leído' };
    }

    async markAllAsRead(userId) {
        if (!userId) {
            throw new Error('userId es requerido');
        }

        // Obtener mensajes no leídos
        const result = await this.dynamo.send(new QueryCommand({
            TableName: this.inboxTable,
            KeyConditionExpression: 'recipientId = :recipientId',
            FilterExpression: '#read = :read',
            ExpressionAttributeNames: { '#read': 'read' },
            ExpressionAttributeValues: { ':recipientId': userId, ':read': false }
        }));

        const now = new Date().toISOString();
        let count = 0;

        for (const message of (result.Items || [])) {
            await this.dynamo.send(new UpdateCommand({
                TableName: this.inboxTable,
                Key: { recipientId: userId, messageId: message.messageId },
                UpdateExpression: 'SET #read = :read, readAt = :readAt',
                ExpressionAttributeNames: { '#read': 'read' },
                ExpressionAttributeValues: { ':read': true, ':readAt': now }
            }));
            count++;
        }

        return { message: `${count} mensaje(s) marcado(s) como leído(s)`, count };
    }

    async archiveMessage(messageId, userId) {
        if (!messageId || !userId) {
            throw new Error('messageId y userId son requeridos');
        }

        await this.dynamo.send(new UpdateCommand({
            TableName: this.inboxTable,
            Key: { recipientId: userId, messageId },
            UpdateExpression: 'SET archivedByRecipient = :archived, updatedAt = :updatedAt',
            ExpressionAttributeValues: { ':archived': true, ':updatedAt': new Date().toISOString() }
        }));

        return { message: 'Mensaje archivado' };
    }

    async deleteMessage(messageId, userId) {
        if (!messageId || !userId) {
            throw new Error('messageId y userId son requeridos');
        }

        await this.dynamo.send(new DeleteCommand({
            TableName: this.inboxTable,
            Key: { recipientId: userId, messageId }
        }));

        return { message: 'Mensaje eliminado' };
    }

    async getUnreadCount(userId) {
        if (!userId) {
            throw new Error('userId es requerido');
        }

        const result = await this.dynamo.send(new QueryCommand({
            TableName: this.inboxTable,
            KeyConditionExpression: 'recipientId = :recipientId',
            FilterExpression: '#read = :read AND (archivedByRecipient = :notArchived OR attribute_not_exists(archivedByRecipient))',
            ExpressionAttributeNames: { '#read': 'read' },
            ExpressionAttributeValues: {
                ':recipientId': userId,
                ':read': false,
                ':notArchived': false
            },
            Select: 'COUNT'
        }));

        return {
            unreadCount: result.Count || 0,
            userId
        };
    }

    async getRecipients(params) {
        const { currentUserId, tenantId, obraId } = params;
        if (!tenantId) throw new Error('tenantId es requerido');

        // Obtener personas del tenant que puedan recibir mensajes. Se incluyen
        // 'activo' y 'pendiente' (no enrolado aún); se excluyen inactivo,
        // suspendido y desvinculado.
        const expressionValues = {
            ':pk': `TENANT#${tenantId}`,
            ':prefix': 'PERSONA#',
            ':activo': 'activo',
            ':pendiente': 'pendiente'
        };
        const expressionNames = { '#estado': 'estado' };
        const filterParts = ['(#estado = :activo OR #estado = :pendiente)'];

        if (obraId) {
            filterParts.push('contains(obraIds, :obraId)');
            expressionValues[':obraId'] = obraId;
        }

        // DynamoDB devuelve hasta 1 MB por llamada. En tablas grandes se necesita
        // paginar siguiendo LastEvaluatedKey.
        let allItems = [];
        let lastKey = undefined;
        do {
            const result = await this.dynamo.send(new QueryCommand({
                TableName: this.personasTable,
                KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
                FilterExpression: filterParts.join(' AND '),
                ExpressionAttributeValues: expressionValues,
                ExpressionAttributeNames: expressionNames,
                ...(lastKey ? { ExclusiveStartKey: lastKey } : {})
            }));
            allItems = allItems.concat(result.Items || []);
            lastKey = result.LastEvaluatedKey;
        } while (lastKey);

        // Cargo del destinatario: cuando se filtra por obra usamos el cargo de la
        // asignación en esa obra (multi-cargo); si no, el cargo principal.
        const cargoEnObra = (u) => {
            if (obraId && Array.isArray(u.asignaciones)) {
                const a = u.asignaciones.find(x => x.obraId === obraId);
                if (a && Array.isArray(a.cargos) && a.cargos.length) {
                    return a.cargos.join(', ');
                }
            }
            return u.cargo || '';
        };

        const users = allItems
            .filter(u => u.personaId !== currentUserId)
            .map(u => ({
                userId: u.personaId,
                personaId: u.personaId,
                nombre: u.nombre,
                apellido: u.apellido || '',
                nombreCompleto: `${u.nombre} ${u.apellido || ''}`.trim(),
                rut: u.rut,
                rol: u.rol,
                cargo: cargoEnObra(u),
                email: u.email
            }));

        const grouped = {
            admin: users.filter(u => normalizeRol(u.rol) === 'admin'),
            prevencionista: users.filter(u => normalizeRol(u.rol) === 'prevencionista'),
            supervisor: users.filter(u => normalizeRol(u.rol) === 'supervisor'),
            trabajador: users.filter(u => normalizeRol(u.rol) === 'trabajador'),
            relator: users.filter(u => normalizeRol(u.rol) === 'relator')
        };

        return { recipients: users, grouped, total: users.length };
    }
}

module.exports = { InboxRepository };
