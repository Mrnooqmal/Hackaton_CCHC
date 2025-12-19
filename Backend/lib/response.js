/**
 * Utilidades para respuestas HTTP estandarizadas
 */

const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
};

const success = (data, statusCode = 200) => ({
    statusCode,
    headers,
    body: JSON.stringify({ success: true, data }),
});

const error = (message, statusCode = 400) => ({
    statusCode,
    headers,
    body: JSON.stringify({ success: false, error: message }),
});

const created = (data) => success(data, 201);

module.exports = { success, error, created, headers };
