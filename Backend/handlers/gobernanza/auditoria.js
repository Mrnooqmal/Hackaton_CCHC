/**
 * Consulta del registro de auditoría de la empresa.
 *
 *   GET /gobernanza/auditoria?desde=&hasta=&categoria=&operacion=&actor=
 *
 * Solo con el permiso `empresa.auditoria` (por defecto, solo el
 * administrador), y solo la partición de la empresa de la sesión: un registro
 * de otra empresa no se puede pedir ni por identificador. Cada consulta queda a
 * su vez registrada, de forma estricta: si no se puede dejar constancia de quién
 * miró la auditoría, no se muestra. Cada registro viaja con su estado de
 * integridad (`integro`, `alterado` o `sin_sello`), recalculado en el momento.
 *
 * No hay rutas para modificar ni borrar registros: no existen en la API, y el
 * rol de la función tampoco tiene permiso para hacerlo en la tabla.
 */

const { success, error } = require('../../lib/utils/response');
const { conSesion, sesionPuede } = require('../../lib/auth/sesion');
const { PERMISSIONS } = require('../../lib/permissions');
const auditoria = require('../../lib/gobernanza/auditoria');

const ISO = /^\d{4}-\d{2}-\d{2}(T[\d:.]+Z?)?$/;

module.exports.atender = async (event, { ahora = new Date() } = {}) => {
    const method = event.requestContext?.http?.method || event.httpMethod;
    const ses = conSesion(event);
    if (!ses.ok) return ses.respuesta;
    const sesion = ses.sesion;
    if (method !== 'GET') return error('Ruta no encontrada', 404);
    if (!sesionPuede(sesion, PERMISSIONS.EMPRESA_AUDITORIA)) {
        // El intento también queda: quién quiso mirar sin poder.
        await auditoria.registrar({
            tenantId: sesion.tenantId, operacion: 'auditoria.consulta', resultado: 'denegado',
            actor: { id: sesion.personaId, tipo: 'persona', rol: sesion.rol }, origen: auditoria.origenDe(event),
        }, { ahora });
        return error('No tienes permiso para consultar la auditoría', 403);
    }

    const q = event.queryStringParameters || {};
    for (const campo of ['desde', 'hasta']) {
        if (q[campo] && !ISO.test(q[campo])) return error(`"${campo}" debe ser una fecha ISO`, 400);
    }
    const filtros = { desde: q.desde, hasta: q.hasta, categoria: q.categoria, operacion: q.operacion, actorId: q.actor };

    try {
        await auditoria.registrar({
            tenantId: sesion.tenantId, operacion: 'auditoria.consulta', actor: { id: sesion.personaId, tipo: 'persona', rol: sesion.rol },
            origen: auditoria.origenDe(event),
            detalle: { filtros: Object.fromEntries(Object.entries({ desde: q.desde, hasta: q.hasta, categoria: q.categoria, operacion: q.operacion }).filter(([, v]) => v)) },
        }, { estricto: true, ahora });
    } catch (err) {
        if (err.codigo === 'AUDITORIA_NO_DISPONIBLE') return error(err.message, 503);
        throw err;
    }

    const eventos = await auditoria.listar(sesion.tenantId, filtros);
    const conIntegridad = [];
    for (const ev of eventos) conIntegridad.push({ ...ev, integridad: await auditoria.verificarSello(ev) });
    const resumen = conIntegridad.reduce((acc, e) => { acc[e.integridad] = (acc[e.integridad] || 0) + 1; return acc; }, {});
    return success({ eventos: conIntegridad, total: conIntegridad.length, integridad: resumen });
};
