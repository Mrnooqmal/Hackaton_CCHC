/**
 * Obras Module - Handler
 * 
 * Router para endpoints de gestión de obras/proyectos.
 */
const { ObraService } = require('../../lib/services/ObraService');
const { RegistroService } = require('../../lib/services/RegistroService');
const { IncidentsRepository } = require('../incidents-module/incidents.repository');
const { success, error, created, cors } = require('../../lib/utils/response');

const obraService = new ObraService();
const registroService = new RegistroService();
const incidentsRepo = new IncidentsRepository();

module.exports.obrasHandler = async (event) => {
    const method = event.requestContext?.http?.method || event.httpMethod;
    const path = (event.rawPath || event.path || event.requestContext?.http?.path || '').split('?')[0];
    const pathParts = path.split('/').filter(Boolean);
    const obrasIndex = pathParts.indexOf('obras');
    const obraId = obrasIndex !== -1 ? pathParts[obrasIndex + 1] || null : null;
    const action = obrasIndex !== -1 ? pathParts[obrasIndex + 2] || null : null;
    const subAction = obrasIndex !== -1 ? pathParts[obrasIndex + 3] || null : null;
    const subSubAction = obrasIndex !== -1 ? pathParts[obrasIndex + 4] || null : null;

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

        // POST /obras/{id}/avanzar-fase-deming — Avanzar fase ciclo Deming (PLAN→HACER→VERIFICAR→ACTUAR)
        if (method === 'POST' && obraId && action === 'avanzar-fase-deming') {
            if (!tenantId) return error('tenantId es requerido');
            const obra = await obraService.avanzarFaseDeming(tenantId, obraId);
            return success({
                message: `Fase Deming avanzada a: ${obra.faseDeming}`,
                obra: obra.toSafeFormat()
            });
        }

        // POST /obras/{id}/registros/at-ep — Generar y firmar Registro AT/EP (Arts. 71-72)
        if (method === 'POST' && obraId && action === 'registros' && subAction === 'at-ep') {
            if (!tenantId) return error('tenantId es requerido');
            const body = JSON.parse(event.body || '{}');
            if (!body.firmante?.personaId) {
                return error('firmante.personaId es requerido');
            }
            const contexto = {
                ipAddress: event.requestContext?.http?.sourceIp || 'unknown',
                userAgent: event.headers?.['user-agent'] || event.headers?.['User-Agent'] || 'unknown'
            };
            const resultado = await registroService.generarRegistroATEP({
                tenantId,
                obraId,
                periodo: body.periodo || {},
                firmante: body.firmante,
                metodo: body.metodo || 'PIN',
                firmaManuscrita: body.firmaManuscrita,
                masaLaboral: body.masaLaboral,
                contexto
            });
            return created({
                message: 'Registro AT/EP generado y firmado',
                ...resultado
            });
        }

        // GET /obras/{id}/check/consolidado — Read-model consolidado de la Fase CHECK
        if (method === 'GET' && obraId && action === 'check' && subAction === 'consolidado') {
            if (!tenantId) return error('tenantId es requerido');
            const { desde, hasta } = event.queryStringParameters || {};
            const consolidado = await registroService.consolidarCheck({
                tenantId,
                obraId,
                periodo: { desde, hasta }
            });
            return success(consolidado);
        }

        // GET /obras/{id}/medidas-correctivas — Read-model de medidas (Art. 71) para ACT
        if (method === 'GET' && obraId && action === 'medidas-correctivas') {
            if (!tenantId) return error('tenantId es requerido');
            const { estado } = event.queryStringParameters || {};
            const resultado = await incidentsRepo.getMedidasByObra(tenantId, obraId, estado);
            return success(resultado);
        }

        // POST /obras/{id}/investigaciones/{incidentId}/cerrar — Genera y firma el
        // Informe Art. 71 (arbol de causas) y cierra la investigacion del incidente.
        if (method === 'POST' && obraId && action === 'investigaciones' && subAction && subSubAction === 'cerrar') {
            if (!tenantId) return error('tenantId es requerido');
            const body = JSON.parse(event.body || '{}');
            if (!body.firmante?.personaId) return error('firmante.personaId es requerido');

            const incident = await incidentsRepo.get(subAction);
            if (!incident) return error('Incidente no encontrado', 404);
            if ((incident.obraId || null) !== obraId) return error('El incidente no pertenece a esta obra', 400);

            const contexto = {
                ipAddress: event.requestContext?.http?.sourceIp || 'unknown',
                userAgent: event.headers?.['user-agent'] || event.headers?.['User-Agent'] || 'unknown'
            };
            const resultado = await registroService.generarInformeInvestigacion({
                tenantId,
                obraId,
                incident,
                firmante: body.firmante,
                metodo: body.metodo || 'PIN',
                firmaManuscrita: body.firmaManuscrita,
                contexto
            });

            // Cerrar la investigacion y enlazar el informe generado.
            await incidentsRepo.update(subAction, {
                estado: 'cerrado',
                fechaCierre: new Date().toISOString(),
                informeDocumentId: resultado.documentId
            });

            return created({
                message: 'Investigación cerrada y informe Art. 71 firmado',
                ...resultado
            });
        }

        return error('Ruta no encontrada', 404);
    } catch (err) {
        console.error('Error in obras handler:', err);
        return error(err.message, 500);
    }
};
