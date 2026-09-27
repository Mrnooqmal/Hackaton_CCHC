/**
 * Forma de un mensaje de bandeja de entrada, sin escribirlo.
 *
 * `InboxRepository.sendMessage` arma y guarda los mensajes uno por uno, y para
 * casi todo eso basta. Pero hay avisos que no pueden quedar separados del acto
 * que avisan: el restablecimiento de un PIN solo lo puede notar como ilegítimo
 * la persona afectada, así que el aviso tiene que existir si y solo si el
 * restablecimiento existe. Eso exige escribir ambos en la misma transacción, y
 * para eso quien restablece necesita el mensaje ya armado, no enviado.
 *
 * Este es el único lugar donde se decide la forma de un mensaje: lo usan
 * `sendMessage` y cualquier transacción que incluya un aviso.
 */

const INBOX_TABLE = process.env.INBOX_TABLE || 'Inbox';

const MESSAGE_TYPES = ['message', 'notification', 'alert', 'task'];
const PRIORITIES = ['normal', 'high', 'urgent'];

/**
 * @param {object} p
 * @param {string} p.recipientId
 * @param {string} p.baseMessageId - uuid compartido por los destinatarios de un mismo envío.
 * @param {string} p.now - ISO; lo fija quien llama para que todo el envío tenga la misma hora.
 * @returns {object} el ítem tal como se guarda en la tabla de bandeja.
 */
function construirMensaje({
    recipientId, baseMessageId, now,
    senderId, senderName, senderRol, type, priority, subject, content, linkedEntity,
}) {
    return {
        recipientId,
        messageId: `${baseMessageId}-${recipientId.substring(0, 8)}`,
        senderId,
        senderName: senderName || 'Sistema',
        senderRol: senderRol || 'system',
        type: MESSAGE_TYPES.includes(type) ? type : 'message',
        priority: PRIORITIES.includes(priority) ? priority : 'normal',
        subject,
        content,
        read: false,
        readAt: null,
        archivedByRecipient: false,
        archivedBySender: false,
        linkedEntity: linkedEntity || null,
        createdAt: now,
        updatedAt: now,
    };
}

module.exports = { construirMensaje, INBOX_TABLE, MESSAGE_TYPES, PRIORITIES };
