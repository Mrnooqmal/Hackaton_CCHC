import { apiRequest } from './client';

// ========================================
// INBOX TYPES
// ========================================
export type MessageType = 'message' | 'notification' | 'alert' | 'task';
export type MessagePriority = 'normal' | 'high' | 'urgent';

export interface InboxMessage {
    recipientId: string;
    messageId: string;
    senderId: string;
    senderName: string;
    senderRol: string;
    type: MessageType;
    priority: MessagePriority;
    subject: string;
    content: string;
    read: boolean;
    readAt: string | null;
    archivedByRecipient: boolean;
    linkedEntity?: {
        type: 'activity' | 'document' | 'incident' | 'survey' | 'signature-request';
        id: string;
        title?: string;
    };
    createdAt: string;
    updatedAt: string;
}

export interface SendMessageData {
    senderId: string;
    senderName: string;
    senderRol: string;
    recipientIds: string[];
    type?: MessageType;
    priority?: MessagePriority;
    subject: string;
    content: string;
    linkedEntity?: InboxMessage['linkedEntity'];
}

export interface InboxRecipient {
    userId: string;
    nombre: string;
    apellido: string;
    nombreCompleto: string;
    rut: string;
    rol: string;
    cargo: string;
    email?: string;
}

// ========================================
// INBOX API
// ========================================
export const inboxApi = {
    send: (data: SendMessageData) =>
        apiRequest<{ message: string; messageId: string; count: number }>('/inbox/send', {
            method: 'POST',
            body: JSON.stringify(data),
        }),

    getInbox: (userId: string, filter?: 'all' | 'unread' | 'archived', limit?: number) => {
        const params = new URLSearchParams({ userId });
        if (filter) params.append('filter', filter);
        if (limit) params.append('limit', limit.toString());
        return apiRequest<{ messages: InboxMessage[]; count: number }>(`/inbox?${params}`);
    },

    getSent: (userId: string, limit?: number) => {
        const params = new URLSearchParams({ userId });
        if (limit) params.append('limit', limit.toString());
        return apiRequest<{ messages: InboxMessage[]; count: number }>(`/inbox/sent?${params}`);
    },

    getMessage: (messageId: string, userId: string) =>
        apiRequest<InboxMessage>(`/inbox/${messageId}?userId=${userId}`),

    markAsRead: (messageId: string, userId: string) =>
        apiRequest<{ message: string }>(`/inbox/${messageId}/read`, {
            method: 'PUT',
            body: JSON.stringify({ userId }),
        }),

    markAllAsRead: (userId: string) =>
        apiRequest<{ message: string; count: number }>('/inbox/read-all', {
            method: 'PUT',
            body: JSON.stringify({ userId }),
        }),

    archive: (messageId: string, userId: string) =>
        apiRequest<{ message: string }>(`/inbox/${messageId}/archive`, {
            method: 'PUT',
            body: JSON.stringify({ userId }),
        }),

    delete: (messageId: string, userId: string) =>
        apiRequest<{ message: string }>(`/inbox/${messageId}?userId=${userId}`, {
            method: 'DELETE',
        }),

    getUnreadCount: (userId: string) =>
        apiRequest<{ unreadCount: number; userId: string }>(`/inbox/unread-count?userId=${userId}`),

    getRecipients: (userId: string, empresaId?: string) => {
        const params = new URLSearchParams({ userId });
        if (empresaId) params.append('empresaId', empresaId);
        return apiRequest<{
            recipients: InboxRecipient[];
            grouped: Record<string, InboxRecipient[]>;
            total: number;
        }>(`/inbox/recipients?${params}`);
    },
};
