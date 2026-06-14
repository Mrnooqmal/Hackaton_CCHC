/**
 * Tenants Module - Handler
 * 
 * Router para endpoints de gestión de tenants (empresas).
 */
const { TenantService } = require('../../lib/services/TenantService');
const { PersonaService } = require('../../lib/services/PersonaService');
const { sendWelcomeEmail } = require('../notifications/handler');
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

        // GET /tenants/validate?nombre=...&rutEmpresa=... — Verificar unicidad antes de registrar
        if (method === 'GET' && segments[0] === 'validate') {
            const qs = event.queryStringParameters || {};
            const conflictos = {};
            if (qs.nombre) {
                const slug = tenantService._generarSlug(qs.nombre);
                const existente = await tenantService.getBySlug(slug);
                if (existente) conflictos.nombre = `Ya existe una empresa con el nombre "${qs.nombre}"`;
            }
            if (qs.rutEmpresa) {
                const existente = await tenantService.getByRutEmpresa(qs.rutEmpresa);
                if (existente) conflictos.rutEmpresa = `El RUT ${qs.rutEmpresa} ya está registrado`;
            }
            return success({ conflictos, valido: Object.keys(conflictos).length === 0 });
        }

        // POST /tenants/setup — Setup inicial de empresa
        if (method === 'POST' && segments[0] === 'setup') {
            const body = JSON.parse(event.body || '{}');
            const personaService = new PersonaService();

            // Validar RUT del admin antes de crear el tenant
            if (body.admin?.rut) {
                const adminExistente = await personaService.getByRutGlobal(body.admin.rut);
                if (adminExistente) {
                    return error(`El RUT ${body.admin.rut} ya está registrado en el sistema`, 400);
                }
            }

            let tenant;
            try {
                tenant = await tenantService.setup(body);
            } catch (setupErr) {
                return error(setupErr.message, 400);
            }

            // Si se proporcionan datos del admin, crear persona admin
            let adminResult = null;
            let passwordTemporal = null;
            if (body.admin) {
                try {
                    const { persona, passwordTemporal: pwd } = await personaService.crear(tenant.tenantId, {
                        rut: body.admin.rut,
                        nombre: body.admin.nombre,
                        apellidoPaterno: body.admin.apellidoPaterno || '',
                        apellidoMaterno: body.admin.apellidoMaterno || '',
                        apellido: body.admin.apellido || '',
                        fechaNacimiento: body.admin.fechaNacimiento || null,
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

                    // Enviar email de bienvenida con credenciales
                    let emailAdmin = { sent: false, reason: 'no_credentials' };
                    if (persona.email && passwordTemporal) {
                        const nombreCompleto = [persona.nombre, persona.apellido].filter(Boolean).join(' ');
                        emailAdmin = await sendWelcomeEmail(persona.email, nombreCompleto, persona.rut, passwordTemporal);
                        console.log('Admin welcome email result:', JSON.stringify(emailAdmin));
                    }
                    adminResult = { ...persona.toSafeFormat(), emailNotificado: emailAdmin?.sent || false };
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
