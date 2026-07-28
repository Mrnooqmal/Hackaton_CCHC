const { PutCommand, QueryCommand, DeleteCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient } = require('../../lib/clients/dynamodb');
const { success, error, created } = require('../../lib/utils/response');
const { PersonaService } = require('../../lib/services/PersonaService');

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
 * POST /ausencias — Registrar (o actualizar) la ausencia de una persona en un día.
 * Body: { tenantId, obraId, fecha (YYYY-MM-DD), personaId, motivo, observacion?, solicitanteId? }
 */
module.exports.create = async (event) => {
    try {
        const body = JSON.parse(event.body || '{}');
        const tenantId = body.tenantId || event.queryStringParameters?.tenantId;
        const { obraId, fecha, personaId } = body;
        const motivo = body.motivo || 'permiso';

        if (!tenantId) return error('tenantId es requerido');
        if (!obraId) return error('obraId es requerido');
        if (!fecha || !FECHA_RE.test(fecha)) return error('fecha (YYYY-MM-DD) es requerida');
        if (!personaId) return error('personaId es requerido');
        if (!MOTIVOS[motivo]) return error(`Motivo inválido. Válidos: ${Object.keys(MOTIVOS).join(', ')}`);

        // La persona debe existir y ser del tenant (aislamiento multi-tenant).
        const personaService = new PersonaService();
        const persona = await personaService.getById(personaId).catch(() => null);
        if (!persona || persona.tenantId !== tenantId) {
            return error('La persona no pertenece a este tenant', 404);
        }

        const now = new Date().toISOString();
        const solicitanteId = body.solicitanteId || event.requestContext?.authorizer?.claims?.sub || null;
        let registradoPorNombre = null;
        if (solicitanteId) {
            const s = await personaService.getById(solicitanteId).catch(() => null);
            registradoPorNombre = s ? `${s.nombre} ${s.apellido || ''}`.trim() : null;
        }

        const item = {
            tenantId,
            sk: buildSK(obraId, fecha, personaId),
            obraId,
            fecha,
            personaId,
            personaNombre: `${persona.nombre} ${persona.apellido || ''}`.trim(),
            cargo: persona.cargo || '',
            motivo,
            motivoLabel: MOTIVOS[motivo],
            observacion: typeof body.observacion === 'string' ? body.observacion.trim().slice(0, 200) : '',
            registradoPor: solicitanteId,
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
 * GET /ausencias?tenantId=&obraId=&fecha= (o &fechaDesde=&fechaHasta=)
 * Lista las ausencias de una obra en una fecha o rango.
 */
module.exports.list = async (event) => {
    try {
        const q = event.queryStringParameters || {};
        const tenantId = q.tenantId;
        const { obraId, fecha, fechaDesde, fechaHasta } = q;
        if (!tenantId) return error('tenantId es requerido');
        if (!obraId) return error('obraId es requerido');

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
 * DELETE /ausencias?tenantId=&obraId=&fecha=&personaId=
 * Quita el registro de ausencia (la persona vuelve a contar como convocable).
 */
module.exports.remove = async (event) => {
    try {
        const q = event.queryStringParameters || {};
        const tenantId = q.tenantId;
        const { obraId, fecha, personaId } = q;
        if (!tenantId) return error('tenantId es requerido');
        if (!obraId || !fecha || !personaId) return error('obraId, fecha y personaId son requeridos');

        await docClient.send(new DeleteCommand({
            TableName: TABLE_NAME,
            Key: { tenantId, sk: buildSK(obraId, fecha, personaId) },
        }));

        return success({ removed: true });
    } catch (err) {
        console.error('Error eliminando ausencia:', err);
        return error(err.message, 500);
    }
};
