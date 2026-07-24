/**
 * Tenants Module - Handler
 *
 * Router para endpoints de gestión de tenants (empresas).
 */
const { TenantService } = require('../../lib/services/TenantService');
const { PersonaService } = require('../../lib/services/PersonaService');
const { sendWelcomeEmail } = require('../notifications/handler');
const { success, error, created, cors } = require('../../lib/utils/response');
const { buildDefaultCargoCatalog, sanitizeCargoCatalog } = require('../../lib/ds44');
const { sanitizeCatalogosActividad, resolveCatalogos, PERMISOS_TRABAJO_DEF } = require('../../lib/catalogos-actividad');
const { PutObjectCommand } = require('@aws-sdk/client-s3');
const { s3Client } = require('../../lib/clients/s3');

const BUCKET_NAME = process.env.DOCUMENTS_BUCKET;

const uploadTenantLogo = async (dataUrl, tenantId) => {
    const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
    const contentType = match ? match[1] : 'image/png';
    const base64Data = match ? match[2] : dataUrl;
    const buffer = Buffer.from(base64Data, 'base64');
    const key = `tenants/${tenantId}/logos/logo.png`;
    await s3Client.send(new PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: key,
        Body: buffer,
        ContentType: contentType,
    }));
    return key;
};

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

            // Gating: código de habilitación requerido para crear empresa.
            // Fase 1: PIN estático en variable de entorno. Encapsulado para migrar a
            // códigos emitidos por el super admin sin tocar el resto del flujo.
            // Si TENANT_SIGNUP_CODE no está configurado, el alta no se gatea (dev/offline).
            const expectedSignupCode = process.env.TENANT_SIGNUP_CODE;
            if (expectedSignupCode) {
                const provided = (body.codigoHabilitacion || '').trim();
                if (provided !== expectedSignupCode) {
                    return error('Código de habilitación inválido. Solicítalo al administrador de la plataforma.', 403);
                }
            }

            // Validar RUT del admin antes de crear el tenant
            if (body.admin?.rut) {
                const adminExistente = await personaService.getByRutGlobal(body.admin.rut);
                if (adminExistente) {
                    return error(`El RUT ${body.admin.rut} ya está registrado en el sistema`, 400);
                }
            }

            // Strip logoBase64 from preferencias — it goes to S3, not DynamoDB
            const logoBase64 = body.preferencias?.logoBase64;
            const cleanPreferencias = { ...(body.preferencias || {}) };
            delete cleanPreferencias.logoBase64;
            const cleanBody = { ...body, preferencias: cleanPreferencias };

            let tenant;
            try {
                tenant = await tenantService.setup(cleanBody);
            } catch (setupErr) {
                return error(setupErr.message, 400);
            }

            // Upload logo to S3 and store the key in preferencias
            if (logoBase64 && BUCKET_NAME) {
                try {
                    const logoKey = await uploadTenantLogo(logoBase64, tenant.tenantId);
                    const updatedPrefs = { ...tenant.preferencias, logoKey };
                    await tenantService.updateConfig(tenant.tenantId, { preferencias: updatedPrefs });
                    tenant.preferencias.logoKey = logoKey;
                } catch (logoErr) {
                    console.error('Logo upload failed, continuing without logo:', logoErr);
                }
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

            // Crear trabajadores iniciales (opcional) en el mismo setup, para que
            // queden persistidos de forma confiable junto al tenant/admin. Cada uno
            // se crea con el mismo servicio que el panel; los errores no bloquean.
            const trabajadoresResult = [];
            if (Array.isArray(body.trabajadores) && body.trabajadores.length > 0) {
                for (const w of body.trabajadores) {
                    const apellido = [w.apellidoPaterno, w.apellidoMaterno].filter(Boolean).join(' ').trim();
                    try {
                        const { persona, passwordTemporal: wPwd } = await personaService.crear(tenant.tenantId, {
                            rut: w.rut,
                            nombre: w.nombre,
                            apellidoPaterno: w.apellidoPaterno || '',
                            apellidoMaterno: w.apellidoMaterno || '',
                            fechaNacimiento: w.fechaNacimiento || null,
                            email: w.email || '',
                            rol: w.rol || 'Colaborador',
                            cargo: w.cargo || '',
                            tieneAccesoWeb: w.tieneAccesoWeb !== undefined ? w.tieneAccesoWeb : true
                        });
                        let emailSent = false;
                        if (persona.email && wPwd) {
                            try {
                                const nombreCompleto = [persona.nombre, persona.apellido].filter(Boolean).join(' ');
                                const r = await sendWelcomeEmail(persona.email, nombreCompleto, persona.rut, wPwd);
                                emailSent = r?.sent || false;
                            } catch (mailErr) {
                                console.error('Error sending worker welcome email:', mailErr.message);
                            }
                        }
                        // Documentos de empresa (RI/Política) a nivel tenant para el trabajador.
                        try {
                            const { ensureCompanyDocsForPersona } = require('../personas-module/handler');
                            await ensureCompanyDocsForPersona({ tenantId: tenant.tenantId, persona, solicitante: null });
                        } catch (docErr) {
                            console.error('Docs empresa (setup trabajador) falló:', docErr.message);
                        }
                        trabajadoresResult.push({ rut: persona.rut, nombre: persona.nombre, apellido, password: wPwd || undefined, emailNotificado: emailSent });
                    } catch (wErr) {
                        console.error(`Error creando trabajador ${w.rut}:`, wErr.message);
                        trabajadoresResult.push({ rut: w.rut, nombre: w.nombre, apellido, error: wErr.message });
                    }
                }
                const creados = trabajadoresResult.filter(t => !t.error).length;
                if (creados > 0) {
                    await tenantService.ajustarCantidadTrabajadores(tenant.tenantId, creados).catch((countErr) => {
                        console.error('No se pudo actualizar la cantidad de trabajadores del tenant (setup):', countErr.message);
                    });
                }
            }

            return created({
                message: 'Tenant creado exitosamente',
                tenant: tenant.toSafeFormat(),
                admin: adminResult,
                passwordTemporal,
                trabajadores: trabajadoresResult
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

            // Las preferencias se mergean con las existentes para no perder campos no
            // enviados (updateConfig reemplaza el objeto completo). Si llega un logo
            // nuevo (data URL en preferencias.logoBase64), se sube a S3 y se persiste
            // como logoKey — igual que en el setup. El base64 nunca toca DynamoDB.
            if (body.preferencias && typeof body.preferencias === 'object') {
                const existing = await tenantService.getById(tenantId);
                if (!existing) return error('Tenant no encontrado', 404);

                const logoBase64 = body.preferencias.logoBase64;
                const incoming = { ...body.preferencias };
                delete incoming.logoBase64;

                const merged = { ...(existing.preferencias || {}), ...incoming };
                if (logoBase64 && BUCKET_NAME) {
                    try {
                        merged.logoKey = await uploadTenantLogo(logoBase64, tenantId);
                    } catch (logoErr) {
                        console.error('Logo upload failed on update:', logoErr);
                    }
                }
                body.preferencias = merged;
            }

            const tenant = await tenantService.updateConfig(tenantId, body);
            return success({
                message: 'Tenant actualizado',
                tenant: tenant.toSafeFormat()
            });
        }

        // GET /tenants/{id}/cargos — Catálogo de cargos del tenant (constructor).
        // Si el tenant aún no lo tiene, devuelve la semilla EBCO (no persiste
        // hasta que el tenant guarde, para no escribir en cada lectura).
        if (method === 'GET' && tenantId && action === 'cargos') {
            const tenant = await tenantService.getById(tenantId);
            if (!tenant) return error('Tenant no encontrado', 404);
            const cargos = Array.isArray(tenant.reglas?.cargos) && tenant.reglas.cargos.length
                ? tenant.reglas.cargos
                : buildDefaultCargoCatalog();
            return success({ cargos, sembrado: !(tenant.reglas?.cargos?.length) });
        }

        // PUT /tenants/{id}/cargos — Guardar catálogo de cargos. Mergea en
        // reglas.cargos sin pisar el resto de reglas del tenant.
        if (method === 'PUT' && tenantId && action === 'cargos') {
            const body = JSON.parse(event.body || '{}');
            let cargos;
            try {
                cargos = sanitizeCargoCatalog(body.cargos);
            } catch (validationErr) {
                return error(validationErr.message, 400);
            }
            const tenant = await tenantService.getById(tenantId);
            if (!tenant) return error('Tenant no encontrado', 404);
            const oldCargos = Array.isArray(tenant.reglas?.cargos) ? tenant.reglas.cargos : [];
            const reglas = { ...(tenant.reglas || {}), cargos };
            const updated = await tenantService.updateConfig(tenantId, { reglas });

            // Broadcast retroactivo: si se subió/actualizó alguna plantilla (IRL, PTS,
            // Reglamento Interno, Política SST…), se sincroniza a los documentos de
            // onboarding ya existentes de los trabajadores que aplican y se les avisa.
            let sincronizados = 0;
            let removidos = 0;
            try {
                const { syncPlantillasToWorkers } = require('../personas-module/handler');
                const r = await syncPlantillasToWorkers({ tenantId, oldCargos, newCargos: cargos });
                sincronizados = (r?.actualizados || 0);
                removidos = (r?.removidos || 0);
            } catch (syncErr) {
                console.error('Broadcast de plantillas falló:', syncErr.message);
            }

            const partes = [];
            if (sincronizados > 0) partes.push(`${sincronizados} documento(s) sincronizado(s)`);
            if (removidos > 0) partes.push(`${removidos} documento(s) despegado(s) por plantilla eliminada`);
            return success({
                message: partes.length ? `Catálogo actualizado. ${partes.join(' y ')}.` : 'Catálogo de cargos actualizado',
                cargos: updated.reglas?.cargos || cargos,
                documentosSincronizados: sincronizados,
                documentosRemovidos: removidos
            });
        }

        // GET /tenants/{id}/catalogos-actividad — Catálogos de la planificación
        // diaria (temas/recursos/riesgos/medidas). Si el tenant no los ha
        // personalizado devuelve la semilla de fábrica sin persistirla.
        if (method === 'GET' && tenantId && action === 'catalogos-actividad') {
            const tenant = await tenantService.getById(tenantId);
            if (!tenant) return error('Tenant no encontrado', 404);
            return success({
                catalogos: resolveCatalogos(tenant),
                permisosTrabajoDef: PERMISOS_TRABAJO_DEF,
                sembrado: !(tenant.reglas?.catalogosActividad),
            });
        }

        // PUT /tenants/{id}/catalogos-actividad — Guarda los catálogos.
        // Mergea en reglas.catalogosActividad sin pisar el resto de reglas.
        if (method === 'PUT' && tenantId && action === 'catalogos-actividad') {
            const body = JSON.parse(event.body || '{}');
            let catalogos;
            try {
                catalogos = sanitizeCatalogosActividad(body.catalogos);
            } catch (validationErr) {
                return error(validationErr.message, 400);
            }
            const tenant = await tenantService.getById(tenantId);
            if (!tenant) return error('Tenant no encontrado', 404);
            const reglas = { ...(tenant.reglas || {}), catalogosActividad: catalogos };
            await tenantService.updateConfig(tenantId, { reglas });
            return success({ message: 'Catálogos guardados', catalogos });
        }

        return error('Ruta no encontrada', 404);
    } catch (err) {
        console.error('Error in tenants handler:', err);
        return error(err.message, 500);
    }
};
