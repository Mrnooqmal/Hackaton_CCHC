/**
 * Tenants Module - Handler
 * 
 * Router para endpoints de gestión de tenants (empresas).
 */
const { TenantService } = require('../../lib/services/TenantService');
const { PersonaService } = require('../../lib/services/PersonaService');
const { success, error, created, cors } = require('../../lib/utils/response');

const tenantService = new TenantService();

module.exports.tenantsHandler = async (event) => {
    const method = event.requestContext?.http?.method || event.httpMethod;
    const path = event.rawPath || event.path || '';

    // Extraer segmentos: /tenants, /tenants/{id}, /tenants/{id}/action
    const segments = path.replace(/^\/tenants\/?/, '').split('/').filter(Boolean);
    const tenantId = segments[0] || null;
    const action = segments[1] || null;

    try {
        // CORS preflight
        if (method === 'OPTIONS') return cors();

        // POST /tenants/setup — Setup inicial de empresa
        if (method === 'POST' && segments[0] === 'setup') {
            const body = JSON.parse(event.body || '{}');
            const tenant = await tenantService.setup(body);

            // Si se proporcionan datos del admin, crear persona admin
            let adminResult = null;
            let passwordTemporal = null;
            if (body.admin) {
                try {
                    const personaService = new PersonaService();
                    const { persona, passwordTemporal: pwd } = await personaService.crear(tenant.tenantId, {
                        rut: body.admin.rut,
                        nombre: body.admin.nombre,
                        apellido: body.admin.apellido || '',
                        email: body.admin.email,
                        rol: 'admin',
                        tieneAccesoWeb: true
                    });
                    passwordTemporal = pwd;
                    // Vincular admin al tenant
                    await tenantService.updateConfig(tenant.tenantId, {
                        adminPersonaId: persona.personaId
                    });
                    // Activar tenant
                    await tenantService.activar(tenant.tenantId);
                    adminResult = persona.toSafeFormat();
                } catch (adminErr) {
                    console.error('Error creating admin persona:', adminErr);
                }
            }

            return created({
                message: 'Tenant creado exitosamente',
                tenant: tenant.toSafeFormat(),
                admin: adminResult,
                passwordTemporal
            });
        }

        // GET /tenants — Listar tenants
        if (method === 'GET' && !tenantId) {
            const estado = event.queryStringParameters?.estado || 'all';
            let tenants;
            if (estado === 'all') {
                tenants = await tenantService.listAll();
            } else {
                tenants = await tenantService.listByEstado(estado);
            }
            return success({
                total: tenants.length,
                tenants: tenants.map(t => t.toSafeFormat())
            });
        }

        // GET /tenants/{id} — Obtener tenant
        if (method === 'GET' && tenantId && !action) {
            const tenant = await tenantService.getById(tenantId);
            if (!tenant) return error('Tenant no encontrado', 404);
            return success(tenant.toSafeFormat());
        }

        // PUT /tenants/{id} — Actualizar configuración
        if (method === 'PUT' && tenantId && !action) {
            const body = JSON.parse(event.body || '{}');
            const tenant = await tenantService.updateConfig(tenantId, body);
            return success({
                message: 'Tenant actualizado',
                tenant: tenant.toSafeFormat()
            });
        }

        return error('Ruta no encontrada', 404);
    } catch (err) {
        console.error('Error in tenants handler:', err);
        return error(err.message, 500);
    }
};
