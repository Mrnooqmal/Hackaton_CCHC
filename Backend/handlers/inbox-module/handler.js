const { Router } = require('itty-router');
const { InboxRepository } = require('./inbox.repository');
const { conSesion } = require('../../lib/auth/sesion');
const { PersonaService } = require('../../lib/services/PersonaService');

const inboxRepo = new InboxRepository();
const personaService = new PersonaService();
const router = Router();

/**
 * Quién es el dueño del buzón: SIEMPRE la sesión.
 *
 * Todas estas rutas recibían el `userId` por query o por cuerpo, sin comprobar
 * nada: con el id de otra persona se leía su bandeja completa, se marcaban sus
 * mensajes, se archivaban y se borraban, y se enviaba a su nombre. Los mensajes
 * no llevan empresa, así que la pertenencia la da el destinatario: por eso el id
 * tiene que venir del token y no del cliente.
 */
const sesionDe = (request) => conSesion(request.event);

// CORS Options Handler
router.options('*', () => {
    return {
        statusCode: 204,
        headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type,Authorization',
            'Access-Control-Max-Age': '86400'
        },
        body: ''
    };
});

// Define routes - Matches the paths used in client.ts
// Note: client.ts uses paths like /inbox/send, /inbox/sent, /inbox/unread-count
// The router mounts at /inbox, so we check the relative paths

router
    .post('/inbox/send', sendMessage)
    .get('/inbox/sent', getSent)
    .get('/inbox/unread-count', getUnreadCount)
    .get('/inbox/recipients', getRecipients)
    .put('/inbox/read-all', markAllAsRead)
    .get('/inbox/:messageId', getMessage)
    .delete('/inbox/:messageId', deleteMessage)
    .put('/inbox/:messageId/read', markAsRead)
    .put('/inbox/:messageId/archive', archiveMessage)
    .get('/inbox', getInbox);

router.all('*', () => jsonResponse({ error: 'Not Found' }, 404));

// Helper to parse body securely
const parseBody = (event) => {
    try {
        return event.body ? JSON.parse(event.body) : {};
    } catch {
        return {};
    }
};

// Response helpers
const jsonResponse = (data, status = 200) => ({
    statusCode: status,
    headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    },
    body: JSON.stringify({ success: true, data }),
});

const errorResponse = (err) => {
    console.error('Handler Error:', err);
    let status = 500;
    if (err.message.includes('no encontrado') || err.message.includes('not found')) status = 404;
    else if (err.message.includes('requerido') || err.message.includes('inválido')) status = 400;
    else if (err.message.includes('incorrecto') || err.message.includes('permiso')) status = 401;

    return {
        statusCode: status,
        headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type,Authorization',
        },
        body: JSON.stringify({ success: false, error: err.message }),
    };
};

// Route Handlers
async function sendMessage(request) {
    try {
        const ses = sesionDe(request);
        if (!ses.ok) return ses.respuesta;
        const sesion = ses.sesion;

        const body = parseBody(request.event);

        // Quien envía es quien tiene la sesión, con su nombre y rol reales: el
        // remitente lo ponía el cliente, así que se podía escribir a nombre del
        // prevencionista o del administrador.
        const remitente = await personaService.getById(sesion.personaId).catch(() => null);
        if (!remitente) return errorResponse(new Error('Remitente no encontrado'));

        // Y los destinatarios tienen que ser de la misma empresa.
        const destinatarios = Array.isArray(body.recipientIds) ? body.recipientIds : [];
        const validados = [];
        for (const id of destinatarios) {
            const persona = await personaService.getById(id).catch(() => null);
            if (persona && persona.tenantId === sesion.tenantId) validados.push(id);
        }
        if (destinatarios.length > 0 && validados.length === 0) {
            return errorResponse(new Error('Los destinatarios no pertenecen a tu empresa'));
        }

        const result = await inboxRepo.sendMessage({
            ...body,
            senderId: sesion.personaId,
            senderName: `${remitente.nombre} ${remitente.apellido || ''}`.trim(),
            senderRol: remitente.rol || 'usuario',
            recipientIds: validados,
        });
        return jsonResponse(result, 201);
    } catch (err) {
        return errorResponse(err);
    }
}

async function getInbox(request) {
    try {
        const ses = sesionDe(request);
        if (!ses.ok) return ses.respuesta;
        const { filter, limit } = request.query || {};
        const result = await inboxRepo.getInbox({ userId: ses.sesion.personaId, filter, limit });
        return jsonResponse(result);
    } catch (err) {
        return errorResponse(err);
    }
}

async function getSent(request) {
    try {
        const ses = sesionDe(request);
        if (!ses.ok) return ses.respuesta;
        const { limit } = request.query || {};
        const result = await inboxRepo.getSent({ userId: ses.sesion.personaId, limit });
        return jsonResponse(result);
    } catch (err) {
        return errorResponse(err);
    }
}

async function getMessage(request) {
    try {
        const ses = sesionDe(request);
        if (!ses.ok) return ses.respuesta;
        const { messageId } = request.params;
        const result = await inboxRepo.getMessage(messageId, ses.sesion.personaId);
        return jsonResponse(result);
    } catch (err) {
        return errorResponse(err);
    }
}

async function markAsRead(request) {
    try {
        const ses = sesionDe(request);
        if (!ses.ok) return ses.respuesta;
        const { messageId } = request.params;
        const { read } = parseBody(request.event);
        const result = await inboxRepo.markAsRead(messageId, ses.sesion.personaId, read);
        return jsonResponse(result);
    } catch (err) {
        return errorResponse(err);
    }
}

async function markAllAsRead(request) {
    try {
        const ses = sesionDe(request);
        if (!ses.ok) return ses.respuesta;
        const result = await inboxRepo.markAllAsRead(ses.sesion.personaId);
        return jsonResponse(result);
    } catch (err) {
        return errorResponse(err);
    }
}

async function archiveMessage(request) {
    try {
        const ses = sesionDe(request);
        if (!ses.ok) return ses.respuesta;
        const { messageId } = request.params;
        const result = await inboxRepo.archiveMessage(messageId, ses.sesion.personaId);
        return jsonResponse(result);
    } catch (err) {
        return errorResponse(err);
    }
}

async function deleteMessage(request) {
    try {
        const ses = sesionDe(request);
        if (!ses.ok) return ses.respuesta;
        const { messageId } = request.params;
        const result = await inboxRepo.deleteMessage(messageId, ses.sesion.personaId);
        return jsonResponse(result);
    } catch (err) {
        return errorResponse(err);
    }
}

async function getUnreadCount(request) {
    try {
        const ses = sesionDe(request);
        if (!ses.ok) return ses.respuesta;
        const result = await inboxRepo.getUnreadCount(ses.sesion.personaId);
        return jsonResponse(result);
    } catch (err) {
        return errorResponse(err);
    }
}

async function getRecipients(request) {
    try {
        const ses = sesionDe(request);
        if (!ses.ok) return ses.respuesta;
        const { obraId } = request.query || {};
        // La libreta de direcciones es la de la propia empresa: `?tenantId=` (o
        // `?empresaId=`) devolvía la nómina de cualquier otra.
        const result = await inboxRepo.getRecipients({
            currentUserId: ses.sesion.personaId,
            tenantId: ses.sesion.tenantId,
            obraId
        });
        return jsonResponse(result);
    } catch (err) {
        return errorResponse(err);
    }
}


// Main Lambda Handler
module.exports.inboxHandler = async (event) => {
    // Adapt Lambda event to itty-router request
    const path = event.rawPath || event.path;

    // Construct simplified Request-like object
    const queryString = event.rawQueryString ? `?${event.rawQueryString}` : '';
    const request = {
        method: event.requestContext?.http?.method || event.httpMethod,
        url: `https://${event.headers.host}${path}${queryString}`,
        params: {}, // Will be populated by router
        query: event.queryStringParameters || {},
        event // Pass full event for body parsing and context
    };

    console.log('Inbox Handler Event:', JSON.stringify({
        path,
        method: request.method,
        query: request.query,
        url: request.url
    }));

    try {
        // HACK: itty-router's `fetch` expects a standard Request.
        // We will create a fake request object that satisfies what router needs (url, method)
        // Using same structure as users.handler.js
        const fakeReq = {
            method: request.method,
            url: request.url,
            headers: new Map(Object.entries(event.headers || {})),
            text: async () => event.body || '',
            json: async () => JSON.parse(event.body || '{}'),
            event: event, // Custom property passed through
            query: request.query // Explicitly pass query, though router might parse URL
        };

        const response = await router.fetch(fakeReq);

        if (response.statusCode !== undefined) {
            console.log('Returning custom response:', JSON.stringify(response));
            return response;
        }

        // Conversion if it returned a standard Response object
        return {
            statusCode: response.status,
            headers: Object.fromEntries(response.headers.entries()),
            body: await response.text()
        };
    } catch (err) {
        console.error('Router Error:', err);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'Internal Server Error' })
        };
    }
};
