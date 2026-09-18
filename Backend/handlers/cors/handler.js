/**
 * Respuesta al preflight CORS de las rutas de módulo.
 *
 * ── Por qué existe ───────────────────────────────────────────────────────────
 *
 * API Gateway responde solo los preflight `OPTIONS` para los que NO hay una ruta
 * declarada. Los módulos que atienden todo un prefijo lo declaran con `method:
 * any` (personas, obras, tenants, estructura, incidents, inbox), así que ese
 * `any` también captura el `OPTIONS`… y con el autorizador puesto, el preflight
 * empezó a responder **401**, porque un preflight jamás lleva cabecera
 * `Authorization` (el navegador la manda recién en la petición real).
 *
 * Un preflight rechazado no es un 401 que la aplicación pueda leer: el navegador
 * bloquea la petición entera y el `fetch` falla con "Failed to fetch". Por eso el
 * síntoma no se parecía en nada a un problema de sesión.
 *
 * Estas rutas `OPTIONS` se declaran explícitamente y SIN autorizador —una ruta
 * con método exacto gana sobre `ANY`— y responden lo único que un preflight
 * necesita: 204 y las cabeceras de CORS. No leen el cuerpo, no tocan datos y no
 * revelan si el recurso existe: responden igual para cualquier ruta del módulo.
 *
 * Se hace en una función propia y mínima, en vez de dejar que el preflight
 * despierte al router del módulo, para no pagar el arranque en frío de un handler
 * pesado (con sus clientes de DynamoDB) por una petición que no hace nada.
 */

const { cors } = require('../../lib/utils/response');

module.exports.preflight = async () => cors();
