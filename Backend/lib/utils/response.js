/**
 * Utilidades para respuestas HTTP estandarizadas
 */

/**
 * `no-store`: ninguna respuesta de la API se guarda en el caché del navegador
 * ni de un intermediario. Llevan datos personales (fichas, firmas, salud) y la
 * app se usa en equipos compartidos de terreno: sin esto, el JSON de una
 * persona podía quedar en el caché de disco del equipo después de cerrar
 * sesión. Toda respuesta de la API la lleva — también las que no se arman con
 * estos helpers: ver `sinCache`.
 */
const SIN_CACHE = { 'Cache-Control': 'no-store' };

const headers = {
    'Content-Type': 'application/json',
    ...SIN_CACHE,
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

/**
 * Respuesta para preflight CORS (OPTIONS).
 * Usar al inicio de handlers con method: any.
 */
const cors = () => ({
    statusCode: 204,
    headers,
    body: '',
});

/**
 * Agrega `Cache-Control: no-store` a una respuesta armada por otro camino (los
 * routers de incidentes e inbox, las descargas HTML). Se aplica a la SALIDA del
 * handler, para cubrir todas sus ramas de una vez.
 */
const sinCache = (respuesta) => (respuesta && typeof respuesta === 'object'
    ? { ...respuesta, headers: { ...(respuesta.headers || {}), ...SIN_CACHE } }
    : respuesta);

module.exports = { success, error, created, cors, headers, sinCache, SIN_CACHE };

