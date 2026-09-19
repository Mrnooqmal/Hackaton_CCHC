/**
 * Sesión: resolución del token y acceso al contexto autenticado.
 *
 * Una sola pieza compartida por el autorizador de API Gateway y por los
 * handlers. Antes esta lógica vivía duplicada dentro de `auth/handler.js` (en
 * `me` y en `validateToken`) y no había forma de reutilizarla.
 *
 * Dos decisiones que conviene entender antes de tocar esto:
 *
 * 1. **El token se guarda hasheado.** Es una credencial portadora: quien lea la
 *    tabla de sesiones con el token en claro puede hacerse pasar por cualquiera.
 *    Se guarda `tokenHash` y el token en claro solo existe en el cliente. Es el
 *    mismo criterio que ya se aplicaba a los tokens de recuperación de clave.
 *
 * 2. **La búsqueda es por índice, no por `Scan`.** La resolución de token ocurre
 *    en cada request autenticado; un `Scan` escalaría con el total de sesiones
 *    de todas las empresas en cada llamada.
 */

const crypto = require('crypto');
const { QueryCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient } = require('../clients/dynamodb');
const { error } = require('../utils/response');

const SESSIONS_TABLE = process.env.SESSIONS_TABLE || 'Sessions';
const TOKEN_INDEX = 'tokenHash-index';

/** SHA-256 del token. No lleva salt a propósito: el token ya son 32 bytes
 *  aleatorios, así que no hay espacio de búsqueda que precalcular. */
const hashToken = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');

/** Extrae el token del header `Authorization: Bearer <token>`. */
function tokenDelEvento(event) {
    const header = event?.headers?.authorization || event?.headers?.Authorization;
    if (!header || !header.startsWith('Bearer ')) return null;
    const token = header.substring(7).trim();
    return token || null;
}

/**
 * Resuelve un token a su sesión vigente.
 *
 * Devuelve `null` tanto si el token no existe como si la sesión está cerrada o
 * vencida: quien pregunta no debe poder distinguir esos casos.
 */
async function sesionDesdeToken(token) {
    if (!token) return null;

    const res = await docClient.send(new QueryCommand({
        TableName: SESSIONS_TABLE,
        IndexName: TOKEN_INDEX,
        KeyConditionExpression: 'tokenHash = :th',
        ExpressionAttributeValues: { ':th': hashToken(token) },
        Limit: 1,
    }));

    const sesion = (res.Items || [])[0];
    if (!sesion) return null;
    if (sesion.activa === false) return null;
    // El TTL de DynamoDB borra la sesión con retraso, así que la expiración se
    // comprueba acá igual: la tabla no es la autoridad del vencimiento.
    if (new Date(sesion.expiresAt) < new Date()) return null;

    return sesion;
}

/**
 * Lo único que se puede hacer con una credencial provisional.
 *
 * La contraseña inicial son los primeros cuatro dígitos del RUT, y eso es una
 * decisión tomada a conciencia: en terreno mucha gente no tiene correo, y una
 * contraseña aleatoria enviada por mail deja a media obra sin poder entrar. Lo
 * que sostiene la decisión es que esa credencial no sirva para NADA salvo
 * reemplazarse.
 *
 * La restricción vivía solo en el router del frontend, o sea que no existía:
 * una llamada directa con el token del primer ingreso podía listar el personal,
 * leer documentos y hasta pedir vales para firmar sin conexión. Comprobado
 * contra el ambiente de desarrollo antes de escribir esto.
 *
 * Va acá y no en el autorizador a propósito: el autorizador cachea su respuesta
 * 60 segundos **por token**, y la clave de ese caché no incluye la ruta. Una
 * decisión por ruta tomada allá se aplicaría a la ruta equivocada.
 */
const RUTAS_CON_CREDENCIAL_PROVISIONAL = new Set([
    'POST /auth/change-password',
    // `me` y `logout` resuelven el token por su cuenta y hoy no pasan por acá.
    // Quedan declarados igual para que la política esté escrita en un solo lugar:
    // si alguna vez migran a `conSesion`, no dejan de funcionar en el primer
    // ingreso sin que nadie entienda por qué.
    'GET /auth/me',
    'POST /auth/logout',
]);

const rutaDe = (event) => {
    const metodo = event?.requestContext?.http?.method || event?.httpMethod || '';
    const ruta = (event?.rawPath || event?.path || event?.requestContext?.http?.path || '').split('?')[0];
    return `${metodo} ${ruta}`;
};

/**
 * Contexto autenticado de la request.
 *
 * Lo puebla el autorizador de API Gateway. Si no está, esta función corta con
 * 401 **aunque la ruta no tenga autorizador configurado**: es la segunda llave
 * del cierre por omisión. Una ruta nueva que se olvide de declarar el
 * autorizador queda inutilizable, no abierta.
 *
 * Devuelve un resultado en vez de lanzar, porque los handlers ya envuelven todo
 * en try/catch que responde 500 y una sesión ausente no es un error del
 * servidor.
 *
 * @returns {{ok: true, sesion: {personaId, tenantId, rol, permisos, sessionId}}
 *          | {ok: false, respuesta: object}}
 */
function conSesion(event) {
    // `enableSimpleResponses: true` deja el contexto en `authorizer.lambda`.
    const ctx = event?.requestContext?.authorizer?.lambda
        || event?.requestContext?.authorizer;

    if (!ctx || !ctx.personaId || !ctx.tenantId) {
        return { ok: false, respuesta: error('No autenticado', 401) };
    }

    // Cierre por omisión: con la contraseña sin cambiar, todo está cerrado salvo
    // la lista de arriba. Una ruta nueva no queda accesible por olvido.
    const provisional = String(ctx.credencialProvisional) === 'true';
    if (provisional && !RUTAS_CON_CREDENCIAL_PROVISIONAL.has(rutaDe(event))) {
        return {
            ok: false,
            respuesta: error('Debes cambiar tu contraseña inicial antes de usar el sistema', 403),
        };
    }

    return {
        ok: true,
        sesion: {
            sessionId: ctx.sessionId,
            personaId: ctx.personaId,
            tenantId: ctx.tenantId,
            rol: ctx.rol || null,
            credencialProvisional: provisional,
            // El autorizador serializa el arreglo porque el contexto de API
            // Gateway solo admite valores escalares.
            permisos: ctx.permisos ? String(ctx.permisos).split(',').filter(Boolean) : [],
        },
    };
}

/**
 * Empresa de la sesión, o `null` si la ruta es pública.
 *
 * Para los módulos que atienden rutas públicas y privadas tras un mismo handler
 * y necesitan el `tenantId` sin cortar la request. **No acepta el valor del
 * cliente**: ése es justamente el agujero que esto viene a cerrar.
 */
function tenantIdDeSesion(event) {
    const ctx = event?.requestContext?.authorizer?.lambda
        || event?.requestContext?.authorizer;
    return ctx?.tenantId || null;
}

/**
 * ¿La sesión trae este permiso?
 *
 * Los permisos ya vienen resueltos por el autorizador contra la definición de
 * roles de la empresa (y para `admin` vienen todos), así que preguntar acá
 * evita volver a cargar la persona y el tenant en cada handler.
 */
function sesionPuede(sesion, permiso) {
    return Boolean(sesion && Array.isArray(sesion.permisos) && sesion.permisos.includes(permiso));
}

/**
 * ¿La entidad pertenece a la empresa de la sesión?
 *
 * La comprobación que faltaba en todos los `GET /x/{id}`: conocer un
 * identificador no es ser de la empresa dueña del dato. Quien la use debe
 * responder **404**, no 403: que exista un documento o una persona con ese id en
 * otra empresa tampoco es información que corresponda dar.
 */
function esDeLaEmpresa(entidad, sesion) {
    const tenantEntidad = entidad?.tenantId;
    return Boolean(entidad && sesion?.tenantId && tenantEntidad === sesion.tenantId);
}

module.exports = {
    RUTAS_CON_CREDENCIAL_PROVISIONAL,
    SESSIONS_TABLE,
    TOKEN_INDEX,
    hashToken,
    tokenDelEvento,
    sesionDesdeToken,
    conSesion,
    tenantIdDeSesion,
    sesionPuede,
    esDeLaEmpresa,
};
