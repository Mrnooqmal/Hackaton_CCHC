const { Router } = require('itty-router');
const { WorkersRepository } = require('./workers.repository');

const workersRepo = new WorkersRepository();
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

// Define routes
router
    .post('/workers', create)
    .get('/workers', list)
    .get('/workers/rut/:rut', getByRut)
    .get('/workers/:id', get)
    .put('/workers/:id', update)
    .post('/workers/:id/sign', sign)
    .post('/workers/:id/set-pin', setPin)
    .post('/workers/:id/complete-enrollment', completeEnrollment);

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

    if (err.statusCode) {
        status = err.statusCode;
    } else if (err.message.includes('No encontrado') || err.message.includes('not found')) {
        status = 404;
    } else if (err.message.includes('requerido') || err.message.includes('inválido')) {
        status = 400;
    } else if (err.message.includes('incorrecto') || err.message.includes('permiso')) {
        status = 401;
    }

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
async function create(request) {
    try {
        const body = parseBody(request.event);
        const result = await workersRepo.create(body);
        return jsonResponse(result, 201);
    } catch (err) {
        return errorResponse(err);
    }
}

async function list(request) {
    try {
        const { empresaId, includeUsers } = request.query || {};
        const result = await workersRepo.list({
            empresaId,
            includeUsers: includeUsers !== 'false'
        });
        return jsonResponse(result);
    } catch (err) {
        return errorResponse(err);
    }
}

async function get(request) {
    try {
        const result = await workersRepo.get(request.params.id);
        return jsonResponse(result);
    } catch (err) {
        return errorResponse(err);
    }
}

async function getByRut(request) {
    try {
        const result = await workersRepo.getByRut(request.params.rut);
        return jsonResponse(result);
    } catch (err) {
        return errorResponse(err);
    }
}

async function update(request) {
    try {
        const body = parseBody(request.event);
        const result = await workersRepo.update(request.params.id, body);
        return jsonResponse(result);
    } catch (err) {
        return errorResponse(err);
    }
}

async function sign(request) {
    try {
        const body = parseBody(request.event);
        const result = await workersRepo.sign(request.params.id, body, request.event);
        return jsonResponse(result);
    } catch (err) {
        return errorResponse(err);
    }
}

async function setPin(request) {
    try {
        const body = parseBody(request.event);
        const result = await workersRepo.setPin(request.params.id, body);
        return jsonResponse(result);
    } catch (err) {
        return errorResponse(err);
    }
}

async function completeEnrollment(request) {
    try {
        const body = parseBody(request.event);
        const result = await workersRepo.completeEnrollment(request.params.id, body, request.event);
        return jsonResponse(result);
    } catch (err) {
        return errorResponse(err);
    }
}

// Main Lambda Handler
module.exports.workersHandler = async (event) => {
    // Adapt Lambda event to itty-router request
    const path = event.rawPath || event.path;

    // Construct simplified Request-like object
    const request = {
        method: event.requestContext?.http?.method || event.httpMethod,
        url: `https://${event.headers.host}${path}`,
        params: {}, // Will be populated by router
        query: event.queryStringParameters || {},
        event // Pass full event for body parsing and context
    };

    try {
        // HACK: itty-router's `fetch` expects a standard Request.
        // We will create a fake request object that satisfies what router needs (url, method)
        const fakeReq = {
            method: request.method,
            url: request.url,
            headers: new Map(Object.entries(event.headers || {})),
            text: async () => event.body || '',
            json: async () => JSON.parse(event.body || '{}'),
            event: event, // Custom property passed through
            query: request.query
        };

        const response = await router.fetch(fakeReq);

        if (response.statusCode !== undefined) {
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
