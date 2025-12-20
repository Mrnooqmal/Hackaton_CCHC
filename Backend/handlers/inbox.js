const { v4: uuidv4 } = require('uuid');
const { PutCommand, GetCommand, QueryCommand, UpdateCommand, DeleteCommand, ScanCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient } = require('../lib/dynamodb');
const { success, error, created } = require('../lib/response');

const INBOX_TABLE = process.env.INBOX_TABLE || 'Inbox';
const USERS_TABLE = process.env.USERS_TABLE || 'Users';

// Tipos de mensaje
const MESSAGE_TYPES = ['message', 'notification', 'alert', 'task'];
const PRIORITIES = ['normal', 'high', 'urgent'];

/**
 * POST /inbox/send - Enviar mensaje a uno o más destinatarios
 */
module.exports.sendMessage = async (event) => {
    try {
        const body = JSON.parse(event.body || '{}');
        const { senderId, senderName, senderRol, recipientIds, type, priority, subject, content, linkedEntity } = body;

        // Validación
        if (!senderId || !recipientIds || !Array.isArray(recipientIds) || recipientIds.length === 0) {
            return error('senderId y recipientIds (array) son requeridos');
        }
        if (!subject || !content) {
            return error('subject y content son requeridos');
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

            await docClient.send(new PutCommand({
                TableName: INBOX_TABLE,
                Item: message
            }));

            messages.push(message);
        }

        return created({
            message: `Mensaje enviado a ${recipientIds.length} destinatario(s)`,
            messageId: baseMessageId,
            count: messages.length
        });
    } catch (err) {
        console.error('Error sending message:', err);
        return error(err.message, 500);
    }
};

/**
 * GET /inbox - Obtener mensajes recibidos (bandeja de entrada)
 */
module.exports.getInbox = async (event) => {
    try {
        const userId = event.queryStringParameters?.userId;
        const filter = event.queryStringParameters?.filter || 'all'; // all, unread, archived
        const limit = parseInt(event.queryStringParameters?.limit) || 50;

        if (!userId) {
            return error('userId es requerido');
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

        const result = await docClient.send(new QueryCommand({
            TableName: INBOX_TABLE,
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

        return success({
            messages: result.Items || [],
            count: result.Count || 0
        });
    } catch (err) {
        console.error('Error getting inbox:', err);
        return error(err.message, 500);
    }
};

/**
 * GET /inbox/sent - Obtener mensajes enviados
 */
module.exports.getSent = async (event) => {
    try {
        const userId = event.queryStringParameters?.userId;
        const limit = parseInt(event.queryStringParameters?.limit) || 50;

        if (!userId) {
            return error('userId es requerido');
        }

        const result = await docClient.send(new QueryCommand({
            TableName: INBOX_TABLE,
            IndexName: 'senderId-createdAt-index',
            KeyConditionExpression: 'senderId = :senderId',
            ExpressionAttributeValues: { ':senderId': userId },
            ScanIndexForward: false,
            Limit: limit
        }));

        return success({
            messages: result.Items || [],
            count: result.Count || 0
        });
    } catch (err) {
        console.error('Error getting sent messages:', err);
        return error(err.message, 500);
    }
};

/**
 * GET /inbox/{messageId} - Obtener detalle de un mensaje
 */
module.exports.getMessage = async (event) => {
    try {
        const messageId = event.pathParameters?.messageId;
        const userId = event.queryStringParameters?.userId;

        if (!messageId || !userId) {
            return error('messageId y userId son requeridos');
        }

        const result = await docClient.send(new GetCommand({
            TableName: INBOX_TABLE,
            Key: { recipientId: userId, messageId }
        }));

        if (!result.Item) {
            return error('Mensaje no encontrado', 404);
        }

        // Marcar como leído automáticamente al obtener
        if (!result.Item.read) {
            const now = new Date().toISOString();
            await docClient.send(new UpdateCommand({
                TableName: INBOX_TABLE,
                Key: { recipientId: userId, messageId },
                UpdateExpression: 'SET #read = :read, readAt = :readAt',
                ExpressionAttributeNames: { '#read': 'read' },
                ExpressionAttributeValues: { ':read': true, ':readAt': now }
            }));
            result.Item.read = true;
            result.Item.readAt = now;
        }

        return success(result.Item);
    } catch (err) {
        console.error('Error getting message:', err);
        return error(err.message, 500);
    }
};

/**
 * PUT /inbox/{messageId}/read - Marcar mensaje como leído
 */
module.exports.markAsRead = async (event) => {
    try {
        const messageId = event.pathParameters?.messageId;
        const body = JSON.parse(event.body || '{}');
        const { userId } = body;

        if (!messageId || !userId) {
            return error('messageId y userId son requeridos');
        }

        const now = new Date().toISOString();
        await docClient.send(new UpdateCommand({
            TableName: INBOX_TABLE,
            Key: { recipientId: userId, messageId },
            UpdateExpression: 'SET #read = :read, readAt = :readAt',
            ExpressionAttributeNames: { '#read': 'read' },
            ExpressionAttributeValues: { ':read': true, ':readAt': now }
        }));

        return success({ message: 'Mensaje marcado como leído' });
    } catch (err) {
        console.error('Error marking as read:', err);
        return error(err.message, 500);
    }
};

/**
 * PUT /inbox/read-all - Marcar todos los mensajes como leídos
 */
module.exports.markAllAsRead = async (event) => {
    try {
        const body = JSON.parse(event.body || '{}');
        const { userId } = body;

        if (!userId) {
            return error('userId es requerido');
        }

        // Obtener mensajes no leídos
        const result = await docClient.send(new QueryCommand({
            TableName: INBOX_TABLE,
            KeyConditionExpression: 'recipientId = :recipientId',
            FilterExpression: '#read = :read',
            ExpressionAttributeNames: { '#read': 'read' },
            ExpressionAttributeValues: { ':recipientId': userId, ':read': false }
        }));

        const now = new Date().toISOString();
        let count = 0;

        for (const message of (result.Items || [])) {
            await docClient.send(new UpdateCommand({
                TableName: INBOX_TABLE,
                Key: { recipientId: userId, messageId: message.messageId },
                UpdateExpression: 'SET #read = :read, readAt = :readAt',
                ExpressionAttributeNames: { '#read': 'read' },
                ExpressionAttributeValues: { ':read': true, ':readAt': now }
            }));
            count++;
        }

        return success({ message: `${count} mensaje(s) marcado(s) como leído(s)`, count });
    } catch (err) {
        console.error('Error marking all as read:', err);
        return error(err.message, 500);
    }
};

/**
 * PUT /inbox/{messageId}/archive - Archivar mensaje
 */
module.exports.archiveMessage = async (event) => {
    try {
        const messageId = event.pathParameters?.messageId;
        const body = JSON.parse(event.body || '{}');
        const { userId } = body;

        if (!messageId || !userId) {
            return error('messageId y userId son requeridos');
        }

        await docClient.send(new UpdateCommand({
            TableName: INBOX_TABLE,
            Key: { recipientId: userId, messageId },
            UpdateExpression: 'SET archivedByRecipient = :archived, updatedAt = :updatedAt',
            ExpressionAttributeValues: { ':archived': true, ':updatedAt': new Date().toISOString() }
        }));

        return success({ message: 'Mensaje archivado' });
    } catch (err) {
        console.error('Error archiving message:', err);
        return error(err.message, 500);
    }
};

/**
 * DELETE /inbox/{messageId} - Eliminar mensaje
 */
module.exports.deleteMessage = async (event) => {
    try {
        const messageId = event.pathParameters?.messageId;
        const userId = event.queryStringParameters?.userId;

        if (!messageId || !userId) {
            return error('messageId y userId son requeridos');
        }

        await docClient.send(new DeleteCommand({
            TableName: INBOX_TABLE,
            Key: { recipientId: userId, messageId }
        }));

        return success({ message: 'Mensaje eliminado' });
    } catch (err) {
        console.error('Error deleting message:', err);
        return error(err.message, 500);
    }
};

/**
 * GET /inbox/unread-count - Obtener contador de mensajes no leídos
 */
module.exports.getUnreadCount = async (event) => {
    try {
        const userId = event.queryStringParameters?.userId;

        if (!userId) {
            return error('userId es requerido');
        }

        const result = await docClient.send(new QueryCommand({
            TableName: INBOX_TABLE,
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

        return success({
            unreadCount: result.Count || 0,
            userId
        });
    } catch (err) {
        console.error('Error getting unread count:', err);
        return error(err.message, 500);
    }
};

/**
 * GET /inbox/users - Obtener lista de usuarios para enviar mensaje
 */
module.exports.getRecipients = async (event) => {
    try {
        const currentUserId = event.queryStringParameters?.userId;
        const empresaId = event.queryStringParameters?.empresaId || 'default';

        // Obtener usuarios de la misma empresa, excluyendo al usuario actual
        const result = await docClient.send(new ScanCommand({
            TableName: USERS_TABLE,
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

        return success({
            recipients: users,
            grouped,
            total: users.length
        });
    } catch (err) {
        console.error('Error getting recipients:', err);
        return error(err.message, 500);
    }
};
