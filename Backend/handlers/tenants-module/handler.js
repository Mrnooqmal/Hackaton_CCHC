/**
 * Tenants Module - Handler
 *
 * Router para endpoints de gestión de tenants (empresas).
 */
const { TenantService } = require('../../lib/services/TenantService');
const { success, error, created, cors } = require('../../lib/utils/response');
const { buildDefaultCargoCatalog, sanitizeCargoCatalog } = require('../../lib/ds44');
const { sanitizeCatalogosActividad, resolveCatalogos, PERMISOS_TRABAJO_DEF } = require('../../lib/catalogos-actividad');
const { EppCatalogoService } = require('../../lib/services/EppCatalogoService');
const { PERMISSIONS } = require('../../lib/permissions');
const { PutObjectCommand } = require('@aws-sdk/client-s3');
const { s3Client } = require('../../lib/clients/s3');
const { conSesion, sesionPuede } = require('../../lib/auth/sesion');

const almacenamiento = require('../../lib/almacenamiento');
const { FirmaRepresentanteService } = require('../../lib/services/FirmaRepresentanteService');

const uploadTenantLogo = async (dataUrl, tenantId) => {
    const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
    const contentType = match ? match[1] : 'image/png';
    const base64Data = match ? match[2] : dataUrl;
    const buffer = Buffer.from(base64Data, 'base64');
    // El logo se reemplaza cuando la empresa quiere: es material de trabajo, no
    // evidencia. En el bucket con bloqueo cada cambio habría dejado una versión
    // inmovilizada por cinco años.
    const key = `tenants/${tenantId}/${almacenamiento.CATEGORIAS.logos.carpeta}/logo.png`;
    await s3Client.send(new PutObjectCommand({
        Bucket: almacenamiento.bucketDeClave(key),
        Key: key,
        Body: buffer,
        ContentType: contentType,
    }));
    return key;
};

const tenantService = new TenantService();
const eppCatalogoService = new EppCatalogoService();

module.exports.tenantsHandler = async (event) => {
    const method = event.requestContext?.http?.method || event.httpMethod;
    const path = event.rawPath || event.path || '';

    // Extraer segmentos: /tenants, /tenants/{id}, /tenants/{id}/action
    const segments = path.replace(/^\/tenants\/?/, '').split('/').filter(Boolean);
    const tenantId = segments[0] || null;
    const action = segments[1] || null;

    const sesionRes = conSesion(event);
    const sesion = sesionRes.ok ? sesionRes.sesion : null;
    const puede = (permiso) => sesionPuede(sesion, permiso);

    /**
     * La empresa del path tiene que ser la de la sesión.
     *
     * Este módulo tomaba el `tenantId` del primer segmento de la ruta y no lo
     * comparaba con nada: con la sesión de una empresa cualquiera se leía y se
     * escribía la configuración de otra —roles y permisos incluidos, que es el
     * control de acceso de esa empresa—, su catálogo de cargos y su EPP. Es la
     * misma fuga lateral ya cerrada en personas, documentos y firmas, y por eso
     * responde igual: 404.
     */
    const empresaAjena = () => tenantId && sesion && tenantId !== sesion.tenantId;

    try {
        // CORS preflight
        if (method === 'OPTIONS') return cors();

        if (!sesion) return sesionRes.respuesta;
        if (empresaAjena()) return error('Empresa no encontrada', 404);

        // GET /tenants/validate?nombre=...&rutEmpresa=... — Verificar unicidad antes de registrar
        //
        // Servía al formulario público de alta. Ese formulario ya no existe y la
        // comprobación de unicidad la hace `scripts/crear-empresa.js` antes de
        // escribir, así que la consulta se conserva solo CON SESIÓN: sin ella era
        // un oráculo que confirmaba a cualquiera si una empresa está en el sistema.
        if (method === 'GET' && segments[0] === 'validate') {
            const ses = conSesion(event);
            if (!ses.ok) return ses.respuesta;

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

        // POST /tenants/setup — RETIRADO.
        //
        // El alta de empresas dejó de ser un endpoint: la hace el operador con
        // `scripts/crear-empresa.js`, autorizado por IAM y auditado en CloudTrail
        // (ver el comentario en serverless.yml). La ruta pública ya no existe,
        // pero esta rama se elimina igual porque el catch-all `/tenants/{proxy+}`
        // la seguiría alcanzando con cualquier sesión válida: dejarla habría
        // convertido a cualquier usuario de cualquier empresa en creador de
        // empresas.

        // GET /tenants — La empresa de la sesión.
        //
        // Devolvía TODAS las empresas de la plataforma (nombre, RUT, dotación,
        // estado) a cualquier sesión: el listado de la cartera de clientes al
        // alcance de cualquier usuario de cualquier empresa. No existe un rol de
        // plataforma que necesite esa lista desde la API; el operador la consulta
        // con sus credenciales de AWS.
        if (method === 'GET' && !tenantId) {
            const propio = await tenantService.getById(sesion.tenantId);
            return success({
                total: propio ? 1 : 0,
                tenants: propio ? [propio.toSafeFormat()] : [],
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

            // Permiso por campo: `roles` ES el control de acceso de la empresa
            // (quién puede ver la ficha de salud, desvincular gente o firmar), así
            // que no puede compartir puerta con cambiar el logo.
            if (body.roles !== undefined && !puede(PERMISSIONS.EMPRESA_ROLES)) {
                return error('No tienes permiso para modificar los roles de la empresa', 403);
            }
            if (body.preferencias !== undefined && !puede(PERMISSIONS.EMPRESA_IDENTIDAD)) {
                return error('No tienes permiso para modificar la identidad de la empresa', 403);
            }
            // `reglas` por esta ruta son el representante legal y las
            // organizaciones sindicales (Art. 8 inc. 1, Art. 57 inc. 2), que viven
            // en la pestaña Identidad. Cargos y catálogos tienen ruta propia.
            if (body.reglas !== undefined && !puede(PERMISSIONS.EMPRESA_IDENTIDAD)) {
                return error('No tienes permiso para modificar la configuración de la empresa', 403);
            }
            // `settings` gobierna límites y retención: queda solo para el
            // administrador, que los tiene todos.
            if (body.settings !== undefined && !puede(PERMISSIONS.EMPRESA_ROLES)) {
                return error('No tienes permiso para modificar los ajustes de la empresa', 403);
            }

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
                if (logoBase64) {
                    try {
                        merged.logoKey = await uploadTenantLogo(logoBase64, tenantId);
                    } catch (logoErr) {
                        console.error('Logo upload failed on update:', logoErr);
                    }
                }
                body.preferencias = merged;
            }

            // `reglas` se mergea por el mismo motivo que `preferencias`: updateConfig
            // reemplaza el objeto entero, así que guardar solo el representante legal
            // borraría fasesObligatorias, limiteObras y requiereFirmaPin.
            // Si llega el representante legal, se valida que sea de la empresa ANTES
            // de guardarlo, y después se sincronizan sus firmas pendientes.
            const tocaRepresentante = Boolean(body.reglas && typeof body.reglas === 'object'
                && Object.prototype.hasOwnProperty.call(body.reglas, 'representanteLegal'));
            const firmasRep = new FirmaRepresentanteService();
            const nuevoRepId = tocaRepresentante ? (body.reglas.representanteLegal?.personaId || null) : null;
            const personaRep = nuevoRepId ? await firmasRep.personaDelTenant(tenantId, nuevoRepId) : null;
            if (nuevoRepId && !personaRep) {
                return error('El representante legal debe ser una persona de la empresa.', 400);
            }
            // Del representante se guarda quién es, no su RUT: nada lo usa y el
            // navegador lo mandaba en claro, contra el cifrado de campo (D-10). El
            // RUT sigue en la ficha de la persona, cifrado. El nombre sale de esa
            // ficha y no de lo que diga el cliente.
            if (tocaRepresentante) {
                body.reglas.representanteLegal = personaRep
                    ? { personaId: personaRep.personaId, nombre: `${personaRep.nombre} ${personaRep.apellido || ''}`.trim() }
                    : null;
            }

            if (body.reglas && typeof body.reglas === 'object') {
                const existing = await tenantService.getById(tenantId);
                if (!existing) return error('Tenant no encontrado', 404);
                body.reglas = { ...(existing.reglas || {}), ...body.reglas };
            }

            const tenant = await tenantService.updateConfig(tenantId, body);

            // Designar (o volver a designar) al representante le asigna los
            // documentos que tiene que firmar y le quita la pendiente al anterior.
            // Antes no pasaba nada: el programa quedaba "Incompleto" y el
            // representante no lo veía en ninguna pantalla.
            let firmasRepresentante = null;
            if (tocaRepresentante) {
                try {
                    firmasRepresentante = await firmasRep.sincronizarTenant(tenantId, nuevoRepId);
                } catch (syncErr) {
                    console.error('[tenants] no se pudieron sincronizar las firmas del representante:', syncErr.message);
                }
            }
            return success({
                message: 'Tenant actualizado',
                tenant: tenant.toSafeFormat(),
                firmasRepresentante,
            });
        }

        // ── Catálogo de EPP del tenant (DS44 Art. 13) ──────────────────────
        // El eppId viaja como tercer segmento: /tenants/{id}/epp/{eppId}
        if (tenantId && action === 'epp') {
            const eppId = segments[2] || null;
            // Leer el catálogo lo necesita cualquiera que registre una entrega;
            // mantenerlo es del perfil que responde por el EPP (Art. 13).
            if (method !== 'GET' && !puede(PERMISSIONS.EMPRESA_EPP)) {
                return error('No tienes permiso para modificar el catálogo de EPP', 403);
            }

            if (method === 'GET') {
                const epp = await eppCatalogoService.list(tenantId);
                return success({ epp });
            }

            if (method === 'POST') {
                const body = JSON.parse(event.body || '{}');
                try {
                    const item = await eppCatalogoService.create(tenantId, body);
                    return created({ message: 'Elemento de EPP creado', epp: item });
                } catch (validationErr) {
                    return error(validationErr.message, 400);
                }
            }

            if (method === 'PUT' && eppId) {
                const body = JSON.parse(event.body || '{}');
                try {
                    const item = await eppCatalogoService.update(tenantId, eppId, body);
                    return success({ message: 'Elemento de EPP actualizado', epp: item });
                } catch (validationErr) {
                    const noExiste = /no encontrado/i.test(validationErr.message);
                    return error(validationErr.message, noExiste ? 404 : 400);
                }
            }

            if (method === 'DELETE' && eppId) {
                try {
                    await eppCatalogoService.remove(tenantId, eppId);
                    return success({ message: 'Elemento de EPP eliminado', eppId });
                } catch (validationErr) {
                    return error(validationErr.message, 404);
                }
            }
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
            if (!puede(PERMISSIONS.EMPRESA_CARGOS) && !puede(PERMISSIONS.CARGOS_GESTIONAR)) {
                return error('No tienes permiso para modificar el catálogo de cargos', 403);
            }
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
            if (!puede(PERMISSIONS.CARGOS_GESTIONAR) && !puede(PERMISSIONS.ACTIVIDADES_PLANIFICAR)) {
                return error('No tienes permiso para modificar los catálogos de actividad', 403);
            }
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
