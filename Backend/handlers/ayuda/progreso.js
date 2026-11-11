/**
 * Progreso de los recorridos guiados (D-33).
 *
 *   GET /ayuda/progreso                  todo el progreso de quien llama, y si se le registra
 *   PUT /ayuda/progreso/{recorridoId}    { version, estado, ultimoPaso?, cierres? }
 *
 * La empresa y la persona salen SIEMPRE de la sesión (`conSesion`): ni el
 * cuerpo ni la consulta pueden nombrar a otra. El cuerpo admite solo los cuatro
 * campos de arriba; cualquier otro se rechaza con 400.
 *
 * Respuestas del PUT, que el cliente usa para decidir qué hacer con un evento
 * de su cola sin conexión:
 *   200  registrado, o ya estaba (repetido o de una versión anterior): se descarta.
 *   400  entrada inválida: no se va a aceptar nunca, se descarta.
 *   404  la persona no está en la empresa de la sesión: se descarta.
 *   409  TRATAMIENTO_BLOQUEADO (solicitud del titular) o LIMITE_RECORRIDOS:
 *        se descarta. CAMBIO_CONCURRENTE: se reintenta.
 *   5xx y sin red: se reintenta.
 *
 * Sin rutas de administración ni de depuración: las definiciones son código.
 */

const { success, error } = require('../../lib/utils/response');
const { conSesion } = require('../../lib/auth/sesion');
const P = require('../../lib/ayuda/progreso');
const repositorio = require('../../lib/ayuda/repositorio');

const ESTADO_POR_CODIGO = {
    ENTRADA_INVALIDA: 400,
    TRATAMIENTO_BLOQUEADO: 409,
    LIMITE_RECORRIDOS: 409,
    CAMBIO_CONCURRENTE: 409,
};

const conCodigo = (mensaje, codigo, estado) => ({
    ...error(mensaje, estado),
    body: JSON.stringify({ success: false, error: mensaje, codigo }),
});

async function ver(sesion) {
    const [progreso, persona] = await Promise.all([
        repositorio.listar(sesion.tenantId, sesion.personaId),
        repositorio.estadoPersona(sesion.tenantId, sesion.personaId),
    ]);
    if (!persona.existe) return error('No se encontró tu ficha', 404);
    // `registrar: false` le dice al cliente que no encole progreso nuevo: con un
    // bloqueo vigente el servidor lo rechazaría igual.
    return success({ progreso, registrar: !persona.bloqueada });
}

async function guardar(event, sesion, recorridoId) {
    let cuerpo;
    try { cuerpo = JSON.parse(event.body || '{}'); } catch { return error('Cuerpo inválido', 400); }
    const entrada = P.validarEntrada(recorridoId, cuerpo);

    const persona = await repositorio.estadoPersona(sesion.tenantId, sesion.personaId);
    if (!persona.existe) return error('No se encontró tu ficha', 404);
    if (persona.bloqueada) {
        throw Object.assign(new Error('Tus datos están bloqueados por una solicitud pendiente: no se registra progreso nuevo hasta que se resuelva.'), { codigo: 'TRATAMIENTO_BLOQUEADO' });
    }

    const { progreso, escrito } = await repositorio.registrar(sesion.tenantId, sesion.personaId, entrada);
    return success({ progreso, escrito });
}

module.exports.atender = async (event) => {
    const ses = conSesion(event);
    if (!ses.ok) return ses.respuesta;
    const sesion = ses.sesion;
    const metodo = event.requestContext?.http?.method || event.httpMethod;
    const ruta = (event.rawPath || '').replace(/\/+$/, '');

    try {
        if (metodo === 'GET' && ruta === '/ayuda/progreso') return await ver(sesion);
        if (metodo === 'PUT' && ruta.startsWith('/ayuda/progreso/')) {
            const recorridoId = event.pathParameters?.recorridoId ?? ruta.slice('/ayuda/progreso/'.length);
            return await guardar(event, sesion, recorridoId);
        }
        return error('Ruta no encontrada', 404);
    } catch (err) {
        const estado = ESTADO_POR_CODIGO[err.codigo];
        if (estado) return conCodigo(err.message, err.codigo, estado);
        // Sin datos de la persona en el log (H-11): solo identificadores.
        console.error('[ayuda/progreso] error', { tenantId: sesion.tenantId, personaId: sesion.personaId, nombre: err.name, mensaje: err.message });
        return error('No se pudo guardar el progreso', 500);
    }
};
