const { Router } = require('itty-router');
const { InboxRepository } = require('./inbox.repository');

const inboxRepo = new InboxRepository();
const router = Router();

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
        const body = parseBody(request.event);
        const result = await inboxRepo.sendMessage(body);
        return jsonResponse(result, 201);
    } catch (err) {
        return errorResponse(err);
    }
}

async function getInbox(request) {
    try {
        const { userId, filter, limit } = request.query || {};
        const result = await inboxRepo.getInbox({ userId, filter, limit });
        return jsonResponse(result);
    } catch (err) {
        return errorResponse(err);
    }
}

async function getSent(request) {
    try {
        const { userId, limit } = request.query || {};
        const result = await inboxRepo.getSent({ userId, limit });
        return jsonResponse(result);
    } catch (err) {
        return errorResponse(err);
    }
}

async function getMessage(request) {
    try {
        const { userId } = request.query || {};
        const { messageId } = request.params;
        const result = await inboxRepo.getMessage(messageId, userId);
        return jsonResponse(result);
    } catch (err) {
        return errorResponse(err);
    }
}

async function markAsRead(request) {
    try {
        const { messageId } = request.params;
        const body = parseBody(request.event);
        const { userId } = body;
        const result = await inboxRepo.markAsRead(messageId, userId);
        return jsonResponse(result);
    } catch (err) {
        return errorResponse(err);
    }
}

async function markAllAsRead(request) {
    try {
        const body = parseBody(request.event);
        const { userId } = body;
        const result = await inboxRepo.markAllAsRead(userId);
        return jsonResponse(result);
    } catch (err) {
        return errorResponse(err);
    }
}

async function archiveMessage(request) {
    try {
        const { messageId } = request.params;
        const body = parseBody(request.event);
        const { userId } = body;
        const result = await inboxRepo.archiveMessage(messageId, userId);
        return jsonResponse(result);
    } catch (err) {
        return errorResponse(err);
    }
}

async function deleteMessage(request) {
    try {
        const { messageId } = request.params;
        const { userId } = request.query || {};
        const result = await inboxRepo.deleteMessage(messageId, userId);
        return jsonResponse(result);
    } catch (err) {
        return errorResponse(err);
    }
}

async function getUnreadCount(request) {
    try {
        const { userId } = request.query || {};
        const result = await inboxRepo.getUnreadCount(userId);
        return jsonResponse(result);
    } catch (err) {
        return errorResponse(err);
    }
}

async function getRecipients(request) {
    try {
        const { userId, empresaId } = request.query || {};
        const result = await inboxRepo.getRecipients({ currentUserId: userId, empresaId });
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
