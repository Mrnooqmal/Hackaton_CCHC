/**
 * Obras Module - Handler
 * 
 * Router para endpoints de gestión de obras/proyectos.
 */
const { ObraService } = require('../../lib/services/ObraService');
const { success, error, created, cors } = require('../../lib/response');

const obraService = new ObraService();

module.exports.obrasHandler = async (event) => {
    const method = event.requestContext?.http?.method || event.httpMethod;
    const path = event.rawPath || event.path || '';

    const segments = path.replace(/^\/obras\/?/, '').split('/').filter(Boolean);
    const obraId = segments[0] || null;
    const action = segments[1] || null;

    // tenantId debe venir del JWT o query param (temporalmente)
    const tenantId = event.queryStringParameters?.tenantId
        || event.requestContext?.authorizer?.claims?.['custom:tenantId']
        || null;

    try {
        // CORS preflight
        if (method === 'OPTIONS') return cors();

        // POST /obras — Crear obra
        if (method === 'POST' && !obraId) {
            if (!tenantId) return error('tenantId es requerido');
            const body = JSON.parse(event.body || '{}');
            const obra = await obraService.crear(tenantId, body);
            return created({
                message: 'Obra creada exitosamente',
                obra: obra.toSafeFormat()
            });
        }

        // GET /obras — Listar obras del tenant
        if (method === 'GET' && !obraId) {
            if (!tenantId) return error('tenantId es requerido');
            const obras = await obraService.listByTenant(tenantId);
            return success({
                total: obras.length,
                obras: obras.map(o => o.toSafeFormat())
            });
        }

        // GET /obras/{id} — Detalle de obra
        if (method === 'GET' && obraId && !action) {
            const obra = await obraService.getById(obraId);
            if (!obra) return error('Obra no encontrada', 404);
            return success(obra.toSafeFormat());
        }

        // PUT /obras/{id} — Actualizar obra
        if (method === 'PUT' && obraId && !action) {
            if (!tenantId) return error('tenantId es requerido');
            const body = JSON.parse(event.body || '{}');
            const obra = await obraService.actualizar(tenantId, obraId, body);
            return success({
                message: 'Obra actualizada',
                obra: obra.toSafeFormat()
            });
        }

        // POST /obras/{id}/avanzar-fase — Avanzar fase constructiva
        if (method === 'POST' && obraId && action === 'avanzar-fase') {
            if (!tenantId) return error('tenantId es requerido');
            const obra = await obraService.avanzarFase(tenantId, obraId);
            return success({
                message: `Fase avanzada a: ${obra.etapaActual}`,
                obra: obra.toSafeFormat()
            });
        }

        return error('Ruta no encontrada', 404);
    } catch (err) {
        console.error('Error in obras handler:', err);
        return error(err.message, 500);
    }
};
