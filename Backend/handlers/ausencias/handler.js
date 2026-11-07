const { PutCommand, QueryCommand, DeleteCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient } = require('../../lib/clients/dynamodb');
const { success, error, created } = require('../../lib/utils/response');
const { conSesion, sesionPuede } = require('../../lib/auth/sesion');
const { personaDeLaEmpresa, obraDeLaEmpresa } = require('../../lib/auth/pertenencia');
const { PERMISSIONS } = require('../../lib/permissions');

const TABLE_NAME = process.env.AUSENCIAS_TABLE || 'Ausencias';

// Motivos de ausencia/permiso del día (§6, ítem 5). Códigos estables.
const MOTIVOS = {
    permiso: 'Permiso',
    licencia: 'Licencia médica',
    falta: 'Falta / inasistencia',
    vacaciones: 'Vacaciones',
    otro: 'Otro',
};

const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;

// Clave de ordenamiento determinística: una ausencia por (obra, fecha, persona).
// Registrar de nuevo la misma combinación la sobrescribe (idempotente).
const buildSK = (obraId, fecha, personaId) => `${obraId}#${fecha}#${personaId}`;

/**
 * Sesión, permiso y obra, comunes a las tres rutas.
 *
 * La empresa sale de la sesión y nunca del cliente: antes se tomaba `tenantId`
 * del cuerpo o de la consulta, así que con una sesión cualquiera se leían,
 * escribían y borraban ausencias de otra empresa (con su motivo: "Licencia
 * médica"). El permiso es el de convocar actividades, que es para lo que se
 * registran: quién no cuenta como convocable hoy.
 */
async function contexto(event, obraId) {
    const ses = conSesion(event);
    if (!ses.ok) return { respuesta: ses.respuesta };
    const sesion = ses.sesion;
    if (!sesionPuede(sesion, PERMISSIONS.ACTIVIDADES_CREAR)) {
        return { respuesta: error('No tienes permiso para gestionar ausencias', 403) };
    }
    if (!obraId) return { respuesta: error('obraId es requerido') };
    if (!await obraDeLaEmpresa(obraId, sesion)) return { respuesta: error('Obra no encontrada', 404) };
    return { sesion, tenantId: sesion.tenantId };
}

/**
 * POST /ausencias — Registrar (o actualizar) la ausencia de una persona en un día.
 * Body: { obraId, fecha (YYYY-MM-DD), personaId, motivo, observacion? }
 * La empresa y quien registra salen de la sesión.
 */
module.exports.create = async (event) => {
    try {
        const body = JSON.parse(event.body || '{}');
        const { obraId, fecha } = body;
        const ctx = await contexto(event, obraId);
        if (ctx.respuesta) return ctx.respuesta;
        const { sesion, tenantId } = ctx;
        // La persona ausente es el objeto del acto: la nombra el cliente, pero
        // tiene que ser de la empresa.
        const ausenteId = body.personaId;
        const motivo = body.motivo || 'permiso';

        if (!fecha || !FECHA_RE.test(fecha)) return error('fecha (YYYY-MM-DD) es requerida');
        if (!ausenteId) return error('personaId es requerido');
        if (!MOTIVOS[motivo]) return error(`Motivo inválido. Válidos: ${Object.keys(MOTIVOS).join(', ')}`);

        const persona = await personaDeLaEmpresa(ausenteId, sesion);
        if (!persona) return error('Persona no encontrada', 404);

        const now = new Date().toISOString();
        // Quién registra es quien tiene la sesión: venía del cuerpo.
        const registrador = await personaDeLaEmpresa(sesion.personaId, sesion);
        const registradoPorNombre = registrador ? `${registrador.nombre} ${registrador.apellido || ''}`.trim() : null;

        const item = {
            tenantId,
            sk: buildSK(obraId, fecha, ausenteId),
            obraId,
            fecha,
            personaId: ausenteId,
            personaNombre: `${persona.nombre} ${persona.apellido || ''}`.trim(),
            cargo: persona.cargo || '',
            motivo,
            motivoLabel: MOTIVOS[motivo],
            observacion: typeof body.observacion === 'string' ? body.observacion.trim().slice(0, 200) : '',
            registradoPor: sesion.personaId,
            registradoPorNombre,
            createdAt: now,
            updatedAt: now,
        };

        await docClient.send(new PutCommand({ TableName: TABLE_NAME, Item: item }));
        return created(item);
    } catch (err) {
        console.error('Error creando ausencia:', err);
        return error(err.message, 500);
    }
};

/**
 * GET /ausencias?obraId=&fecha= (o &fechaDesde=&fechaHasta=)
 * Lista las ausencias de una obra en una fecha o rango.
 */
module.exports.list = async (event) => {
    try {
        const { obraId, fecha, fechaDesde, fechaHasta } = event.queryStringParameters || {};
        const ctx = await contexto(event, obraId);
        if (ctx.respuesta) return ctx.respuesta;
        const { tenantId } = ctx;

        // Query por partición del tenant + prefijo de la obra; el filtro fino de
        // fecha se aplica en memoria (dataset chico por obra/mes).
        const res = await docClient.send(new QueryCommand({
            TableName: TABLE_NAME,
            KeyConditionExpression: 'tenantId = :t AND begins_with(sk, :obra)',
            ExpressionAttributeValues: { ':t': tenantId, ':obra': `${obraId}#` },
        }));

        let items = res.Items || [];
        if (fecha) {
            items = items.filter((a) => a.fecha === fecha);
        } else if (fechaDesde || fechaHasta) {
            items = items.filter((a) =>
                (!fechaDesde || a.fecha >= fechaDesde) && (!fechaHasta || a.fecha <= fechaHasta));
        }

        return success({ ausencias: items, motivos: MOTIVOS });
    } catch (err) {
        console.error('Error listando ausencias:', err);
        return error(err.message, 500);
    }
};

/**
 * DELETE /ausencias?obraId=&fecha=&personaId=
 * Quita el registro de ausencia (la persona vuelve a contar como convocable).
 */
module.exports.remove = async (event) => {
    try {
        const consulta = event.queryStringParameters || {};
        const { obraId, fecha } = consulta;
        const ausenteId = consulta.personaId;
        const ctx = await contexto(event, obraId);
        if (ctx.respuesta) return ctx.respuesta;
        const { tenantId } = ctx;
        if (!fecha || !ausenteId) return error('fecha y personaId son requeridos');

        // La clave lleva la empresa de la sesión: una ausencia de otra empresa no
        // se puede ni nombrar.
        await docClient.send(new DeleteCommand({
            TableName: TABLE_NAME,
            Key: { tenantId, sk: buildSK(obraId, fecha, ausenteId) },
        }));

        return success({ removed: true });
    } catch (err) {
        console.error('Error eliminando ausencia:', err);
        return error(err.message, 500);
    }
};
