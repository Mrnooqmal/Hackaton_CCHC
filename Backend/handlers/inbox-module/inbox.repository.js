const { v4: uuidv4 } = require('uuid');
const { PutCommand, GetCommand, QueryCommand, UpdateCommand, DeleteCommand, ScanCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient } = require('../../lib/dynamodb');

const INBOX_TABLE = process.env.INBOX_TABLE || 'Inbox';
const USERS_TABLE = process.env.USERS_TABLE || 'Users';

// Tipos de mensaje
const MESSAGE_TYPES = ['message', 'notification', 'alert', 'task'];
const PRIORITIES = ['normal', 'high', 'urgent'];

class InboxRepository {
    constructor() {
        this.dynamo = docClient;
        this.inboxTable = INBOX_TABLE;
        this.usersTable = USERS_TABLE;
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

        return {
            message: `Mensaje enviado a ${recipientIds.length} destinatario(s)`,
            messageId: baseMessageId,
            count: messages.length
        };
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
            ScanIndexForward: false, // Más recientes primero
            Limit: limit
        }));

        return {
            messages: result.Items || [],
            count: result.Count || 0
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
        const { currentUserId, empresaId = 'default' } = params;

        // Obtener usuarios de la misma empresa, excluyendo al usuario actual
        const result = await this.dynamo.send(new ScanCommand({
            TableName: this.usersTable,
            FilterExpression: 'empresaId = :empresaId AND estado = :estado',
            ExpressionAttributeValues: {
                ':empresaId': empresaId,
                ':estado': 'activo'
            },
            ProjectionExpression: 'userId, nombre, apellido, rut, rol, cargo, email, avatar'
        }));

        // Filtrar al usuario actual y organizar por rol
        const users = (result.Items || [])
            .filter(u => u.userId !== currentUserId)
            .map(u => ({
                userId: u.userId,
                nombre: u.nombre,
                apellido: u.apellido || '',
                nombreCompleto: `${u.nombre} ${u.apellido || ''}`.trim(),
                rut: u.rut,
                rol: u.rol,
                cargo: u.cargo,
                email: u.email
            }));

        // Agrupar por rol
        const grouped = {
            admin: users.filter(u => u.rol === 'admin'),
            prevencionista: users.filter(u => u.rol === 'prevencionista'),
            trabajador: users.filter(u => u.rol === 'trabajador')
        };

        return {
            recipients: users,
            grouped,
            total: users.length
        };
    }
}

module.exports = { InboxRepository };
