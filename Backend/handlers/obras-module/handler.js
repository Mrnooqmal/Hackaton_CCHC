/**
 * Obras Module - Handler
 * 
 * Router para endpoints de gestión de obras/proyectos.
 */
const { ObraService } = require('../../lib/services/ObraService');
const { RegistroService } = require('../../lib/services/RegistroService');
const { IncidentsRepository } = require('../incidents-module/incidents.repository');
const { TenantService } = require('../../lib/services/TenantService');
const { PERMISSIONS } = require('../../lib/permissions');
const { success, error, created, cors } = require('../../lib/utils/response');
const { tenantIdDeSesion, conSesion, sesionPuede } = require('../../lib/auth/sesion');
const { conNeutro } = require('../../lib/degradacion');

const obraService = new ObraService();
const registroService = new RegistroService();
const incidentsRepo = new IncidentsRepository();
const tenantService = new TenantService();

module.exports.obrasHandler = async (event) => {
    const method = event.requestContext?.http?.method || event.httpMethod;
    const path = (event.rawPath || event.path || event.requestContext?.http?.path || '').split('?')[0];
    const pathParts = path.split('/').filter(Boolean);
    const obrasIndex = pathParts.indexOf('obras');
    const obraId = obrasIndex !== -1 ? pathParts[obrasIndex + 1] || null : null;
    const action = obrasIndex !== -1 ? pathParts[obrasIndex + 2] || null : null;
    const subAction = obrasIndex !== -1 ? pathParts[obrasIndex + 3] || null : null;
    const subSubAction = obrasIndex !== -1 ? pathParts[obrasIndex + 4] || null : null;

    // El tenantId sale de la SESIÓN, nunca del cliente.
    //
    // Antes era `query.tenantId || authorizer.claims`, en ese orden: el valor
    // del llamante ganaba sobre el del autorizador. Con un autorizador puesto
    // y esta línea intacta, el sistema parecía seguro y seguía permitiendo
    // leer otra empresa con `?tenantId=`.
    //
    // Queda `null` en las rutas públicas de este módulo, que ya contemplan ese
    // caso.
    const tenantId = tenantIdDeSesion(event);

    // Quién pregunta, y qué puede hacer.
    const sesionRes = conSesion(event);
    const sesion = sesionRes.ok ? sesionRes.sesion : null;
    const puede = (permiso) => sesionPuede(sesion, permiso);
    // Crear, editar y avanzar de fase son la misma potestad sobre la obra.
    const puedeGestionarObras = () => puede(PERMISSIONS.OBRAS_CREAR);

    // Obra de ESTA empresa, o null.
    //
    // `ObraService.getById` resuelve por el índice global `obraId-index`: con el
    // id a mano devolvía la obra de cualquier empresa, y las escrituras usan el
    // `tenantId` de la sesión como clave, así que sin esta comprobación una
    // actualización sobre una obra ajena creaba un registro fantasma en la
    // empresa propia. 404, no 403: la existencia tampoco se informa.
    const obraDelTenant = async (id) => {
        if (!id || !tenantId) return null;
        const obra = await conNeutro('obra.pertenencia', () => obraService.getById(id), null);
        return obra && obra.tenantId === tenantId ? obra : null;
    };

    try {
        // CORS preflight
        if (method === 'OPTIONS') return cors();

        // POST /obras — Crear obra
        if (method === 'POST' && !obraId) {
            if (!sesion) return sesionRes.respuesta;
            const body = JSON.parse(event.body || '{}');

            // El permiso se exige SIEMPRE: antes solo se comprobaba si el cuerpo
            // traía `creadorId`, así que omitirlo era saltárselo.
            if (!puedeGestionarObras()) {
                return error('No tienes permiso para crear obras', 403);
            }

            const obra = await obraService.crear(tenantId, body);
            return created({
                message: 'Obra creada exitosamente',
                obra: obra.toSafeFormat()
            });
        }

        // GET /obras — Listar obras del tenant
        if (method === 'GET' && !obraId) {
            if (!sesion) return sesionRes.respuesta;
            const obras = await obraService.listByTenant(tenantId);
            return success({
                total: obras.length,
                obras: obras.map(o => o.toSafeFormat())
            });
        }

        // GET /obras/{id} — Detalle de obra
        if (method === 'GET' && obraId && !action) {
            if (!sesion) return sesionRes.respuesta;
            const obra = await obraDelTenant(obraId);
            if (!obra) return error('Obra no encontrada', 404);
            return success(obra.toSafeFormat());
        }

        // PUT /obras/{id} — Actualizar obra
        if (method === 'PUT' && obraId && !action) {
            if (!sesion) return sesionRes.respuesta;
            if (!puedeGestionarObras()) return error('No tienes permiso para editar obras', 403);
            if (!await obraDelTenant(obraId)) return error('Obra no encontrada', 404);
            const body = JSON.parse(event.body || '{}');
            const obra = await obraService.actualizar(tenantId, obraId, body);
            return success({
                message: 'Obra actualizada',
                obra: obra.toSafeFormat()
            });
        }

        // POST /obras/{id}/avanzar-fase — Avanzar fase constructiva
        if (method === 'POST' && obraId && action === 'avanzar-fase') {
            if (!sesion) return sesionRes.respuesta;
            if (!puedeGestionarObras()) return error('No tienes permiso para avanzar la fase de la obra', 403);
            if (!await obraDelTenant(obraId)) return error('Obra no encontrada', 404);
            const obra = await obraService.avanzarFase(tenantId, obraId);
            return success({
                message: `Fase avanzada a: ${obra.etapaActual}`,
                obra: obra.toSafeFormat()
            });
        }

        // POST /obras/{id}/avanzar-fase-deming — Avanzar fase ciclo Deming (PLAN→HACER→VERIFICAR→ACTUAR)
        if (method === 'POST' && obraId && action === 'avanzar-fase-deming') {
            if (!sesion) return sesionRes.respuesta;
            if (!puedeGestionarObras()) return error('No tienes permiso para avanzar la fase de la obra', 403);
            if (!await obraDelTenant(obraId)) return error('Obra no encontrada', 404);
            const obra = await obraService.avanzarFaseDeming(tenantId, obraId);
            return success({
                message: `Fase Deming avanzada a: ${obra.faseDeming}`,
                obra: obra.toSafeFormat()
            });
        }

        // POST /obras/{id}/registros/at-ep — Generar y firmar Registro AT/EP (Arts. 71-72)
        if (method === 'POST' && obraId && action === 'registros' && subAction === 'at-ep') {
            if (!sesion) return sesionRes.respuesta;
            if (!await obraDelTenant(obraId)) return error('Obra no encontrada', 404);
            const body = JSON.parse(event.body || '{}');

            // Quien firma es quien tiene la sesión, y firma con su PIN.
            //
            // El registro AT/EP es evidencia con validez legal (Arts. 71-72). El
            // cuerpo traía a quién atribuir la firma y admitía `metodo:
            // 'PRESENCIAL'`, que en FirmaService valida siempre: cualquiera podía
            // emitir un registro firmado a nombre de otro.
            if (!body.firmante?.pin) {
                return error('Debes ingresar tu PIN para firmar el registro', 400);
            }
            const firmante = { personaId: sesion.personaId, pin: body.firmante.pin };
            const contexto = {
                ipAddress: event.requestContext?.http?.sourceIp || 'unknown',
                userAgent: event.headers?.['user-agent'] || event.headers?.['User-Agent'] || 'unknown'
            };
            let resultado;
            try {
                resultado = await registroService.generarRegistroATEP({
                    tenantId,
                    obraId,
                    periodo: body.periodo || {},
                    firmante,
                    metodo: 'PIN',
                    masaLaboral: body.masaLaboral,
                    contexto
                });
            } catch (firmaErr) {
                // El límite de intentos (H-2) responde 423, no el 500 genérico
                // del catch de más abajo.
                if (firmaErr.codigo === 'PIN_BLOQUEADO') return error(firmaErr.message, 423);
                throw firmaErr;
            }
            return created({
                message: 'Registro AT/EP generado y firmado',
                ...resultado
            });
        }

        // GET /obras/{id}/expediente — Expediente consolidado para puesta a
        // disposición de fiscalizadores y del Organismo Administrador (Art. 72 inc. 1).
        // Devuelve el documento HTML imprimible con TODA la información de gestión
        // del riesgo (indicadores, actividades, EPP, MIPER, docs, incidentes, salud).
        if (method === 'GET' && obraId && action === 'expediente') {
            if (!sesion) return sesionRes.respuesta;
            const q = event.queryStringParameters || {};
            const obra = await obraDelTenant(obraId);
            if (!obra) return error('Obra no encontrada', 404);
            const tenant = await tenantService.getById(tenantId).catch(() => null);
            const { generadoEn, html } = await registroService.generarExpediente({
                tenantId,
                obraId,
                periodo: { desde: q.desde || null, hasta: q.hasta || null },
                empresaNombre: tenant?.nombre || tenant?.razonSocial || null,
                obraNombre: obra?.nombre || null,
            });
            if (q.formato === 'json') {
                return success({ generadoEn });
            }
            return {
                statusCode: 200,
                headers: {
                    'Content-Type': 'text/html; charset=utf-8',
                    'Access-Control-Allow-Origin': '*',
                    'Content-Disposition': `inline; filename="expediente-prevencion-${obraId}.html"`,
                },
                body: html,
            };
        }

        // GET /obras/{id}/check/consolidado — Read-model consolidado de la Fase CHECK
        if (method === 'GET' && obraId && action === 'check' && subAction === 'consolidado') {
            if (!sesion) return sesionRes.respuesta;
            if (!await obraDelTenant(obraId)) return error('Obra no encontrada', 404);
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
            if (!sesion) return sesionRes.respuesta;
            if (!await obraDelTenant(obraId)) return error('Obra no encontrada', 404);
            const { estado } = event.queryStringParameters || {};
            const resultado = await incidentsRepo.getMedidasByObra(tenantId, obraId, estado);
            return success(resultado);
        }

        // POST /obras/{id}/investigaciones/{incidentId}/cerrar — Genera y firma el
        // Informe Art. 71 (arbol de causas) y cierra la investigacion del incidente.
        if (method === 'POST' && obraId && action === 'investigaciones' && subAction && subSubAction === 'cerrar') {
            if (!sesion) return sesionRes.respuesta;
            if (!await obraDelTenant(obraId)) return error('Obra no encontrada', 404);
            const body = JSON.parse(event.body || '{}');

            // Mismo criterio que el registro AT/EP: el informe del Art. 71 lo firma
            // quien tiene la sesión, con su PIN.
            if (!body.firmante?.pin) {
                return error('Debes ingresar tu PIN para firmar el informe', 400);
            }
            const firmante = { personaId: sesion.personaId, pin: body.firmante.pin };

            const incident = await incidentsRepo.get(subAction);
            // El incidente se comprueba contra la obra Y contra la empresa: con solo
            // lo primero, un incidente de otra empresa con el mismo obraId pasaba.
            if (!incident || (incident.tenantId && incident.tenantId !== tenantId)) {
                return error('Incidente no encontrado', 404);
            }
            if ((incident.obraId || null) !== obraId) return error('El incidente no pertenece a esta obra', 400);

            const contexto = {
                ipAddress: event.requestContext?.http?.sourceIp || 'unknown',
                userAgent: event.headers?.['user-agent'] || event.headers?.['User-Agent'] || 'unknown'
            };
            let resultado;
            try {
                resultado = await registroService.generarInformeInvestigacion({
                    tenantId,
                    obraId,
                    incident,
                    firmante,
                    metodo: 'PIN',
                    contexto
                });
            } catch (firmaErr) {
                if (firmaErr.codigo === 'PIN_BLOQUEADO') return error(firmaErr.message, 423);
                throw firmaErr;
            }

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
