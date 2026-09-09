/**
 * Estructura Preventiva - Handler
 *
 * Router de los órganos preventivos del DS 44: comité paritario, delegado SST,
 * departamento de prevención y encargado de gestión del riesgo.
 *
 * Vive en su propio módulo y no colgando de `tenants-module` u `obras-module`
 * porque los órganos existen en AMBOS ámbitos: repartirlos entre los dos módulos
 * obligaría a duplicar el mismo servicio y las mismas validaciones en dos
 * routers. El ámbito viaja como parámetro, no como ruta.
 *
 * Autorización: constituir, editar o disolver un órgano lo hace el perfil que ya
 * administra la empresa u obra (permiso OBRAS_CREAR / EMPRESA_VER según ámbito).
 * Ser miembro de un comité NO otorga permisos: la investidura preventiva es una
 * asignación documental, no un rol del sistema (sección 5.10 del encargo).
 */

const { EstructuraPreventivaService, ErrorValidacion } = require('../../lib/services/EstructuraPreventivaService');
const { PersonaService } = require('../../lib/services/PersonaService');
const { TenantService } = require('../../lib/services/TenantService');
const { ObraService } = require('../../lib/services/ObraService');
const { PERMISSIONS, personaPuede } = require('../../lib/permissions');
const { success, error, created, cors } = require('../../lib/utils/response');
const EP = require('../../lib/estructura-preventiva');

const estructuraService = new EstructuraPreventivaService();
const personaService = new PersonaService();
const tenantService = new TenantService();
const obraService = new ObraService();

/** Traduce un ErrorValidacion de dominio a respuesta 400 con el detalle. */
const responderError = (err) => {
    if (err instanceof ErrorValidacion || err.name === 'ErrorValidacion') {
        return error(err.errores ? err.errores.join(' ') : err.message, 400);
    }
    console.error('[estructura] error no controlado:', err);
    return error(err.message, 500);
};

/**
 * Exige que el solicitante pueda administrar el ámbito. Si no se identifica
 * solicitante se deja pasar, igual que el resto de los módulos: el enforcement
 * fuerte vive en el authorizer, esto es la segunda barrera.
 */
const puedeAdministrar = async (solicitanteId, tenantId) => {
    if (!solicitanteId) return true;
    const [persona, tenant] = await Promise.all([
        personaService.getById(solicitanteId).catch(() => null),
        tenantService.getById(tenantId).catch(() => null),
    ]);
    if (!persona || persona.tenantId !== tenantId) return false;
    const tenantSafe = tenant ? tenant.toSafeFormat() : null;
    return personaPuede(persona, tenantSafe, PERMISSIONS.OBRAS_CREAR)
        || personaPuede(persona, tenantSafe, PERMISSIONS.EMPRESA_VER);
};

module.exports.estructuraHandler = async (event) => {
    const method = event.requestContext?.http?.method || event.httpMethod;
    const path = (event.rawPath || event.path || event.requestContext?.http?.path || '').split('?')[0];
    const parts = path.split('/').filter(Boolean);
    const base = parts.indexOf('estructura');
    const seg = (n) => (base !== -1 ? parts[base + n] || null : null);

    const recurso = seg(1);            // 'resumen' | 'organos'
    const organoId = seg(2);
    const sub = seg(3);                // 'reuniones' | 'miembros' | 'documentos' | 'disolver'
    const subId = seg(4);
    const accion = seg(5);

    const q = event.queryStringParameters || {};
    const tenantId = q.tenantId
        || event.requestContext?.authorizer?.claims?.['custom:tenantId']
        || null;

    try {
        if (method === 'OPTIONS') return cors();
        if (!tenantId) return error('tenantId es requerido');

        const body = event.body ? JSON.parse(event.body) : {};

        // ── GET /estructura/resumen ──────────────────────────────────────────
        // Dotación, obligación por figura, órganos y destinatarios del ámbito.
        // Es lo que alimenta el paso de estructura preventiva en empresa y obra.
        if (method === 'GET' && recurso === 'resumen') {
            const ambito = q.ambito === EP.AMBITO.OBRA ? EP.AMBITO.OBRA : EP.AMBITO.EMPRESA;
            const obraId = q.obraId || null;
            if (ambito === EP.AMBITO.OBRA && !obraId) return error('obraId es requerido para el ámbito obra');

            const personas = await personaService.listByTenant(tenantId).catch(() => []);

            // La dotación declarada (override manual) vive donde ya se guarda el
            // ámbito: en la obra o en la empresa. No se crea histórico aparte.
            let declarada = null;
            let observacion = null;
            let fechaCreacionAmbito = null;
            if (ambito === EP.AMBITO.OBRA) {
                const obra = await obraService.getById(obraId).catch(() => null);
                declarada = obra?.dotacionDeclarada ?? null;
                observacion = obra?.dotacionObservacion ?? null;
                fechaCreacionAmbito = obra?.createdAt ?? null;
            } else {
                const tenant = await tenantService.getById(tenantId).catch(() => null);
                const safe = tenant ? tenant.toSafeFormat() : null;
                declarada = safe?.cantidadTrabajadores || null;
                fechaCreacionAmbito = safe?.createdAt ?? null;
            }

            const resumen = await estructuraService.resumenAmbito({
                tenantId, ambito, obraId, personas,
                dotacionDeclarada: declarada, dotacionObservacion: observacion,
                fechaCreacionAmbito,
            });
            return success(resumen);
        }

        // ── GET /estructura/organos ──────────────────────────────────────────
        if (method === 'GET' && recurso === 'organos' && !organoId) {
            const organos = await estructuraService.listarOrganos(tenantId, {
                ambito: q.ambito || null, obraId: q.obraId || null,
            });
            return success({ total: organos.length, organos });
        }

        // ── GET /estructura/organos/{id} ─────────────────────────────────────
        if (method === 'GET' && recurso === 'organos' && organoId && !sub) {
            const organo = await estructuraService.getOrgano(tenantId, organoId);
            if (!organo) return error('Órgano no encontrado', 404);
            return success(organo);
        }

        // ── POST /estructura/organos ─────────────────────────────────────────
        if (method === 'POST' && recurso === 'organos' && !organoId) {
            if (!(await puedeAdministrar(body.solicitanteId, tenantId))) {
                return error('No tienes permiso para constituir órganos preventivos', 403);
            }

            // La dotación y la existencia de CPHS vigente NO se reciben del cliente:
            // se recalculan acá. Son las que fijan si el órgano nace obligatorio o
            // voluntario, y ese dato no puede depender de lo que mande el navegador.
            const ambito = body.ambito === EP.AMBITO.OBRA ? EP.AMBITO.OBRA : EP.AMBITO.EMPRESA;
            const obraId = body.obraId || null;
            const personas = await personaService.listByTenant(tenantId).catch(() => []);
            const organosAmbito = await estructuraService.listarOrganos(tenantId, { ambito, obraId });

            let declarada = null;
            let fechaCreacionAmbito = null;
            if (ambito === EP.AMBITO.OBRA) {
                const obra = await obraService.getById(obraId).catch(() => null);
                declarada = obra?.dotacionDeclarada ?? null;
                fechaCreacionAmbito = obra?.createdAt ?? null;
            } else {
                const tenant = await tenantService.getById(tenantId).catch(() => null);
                const safe = tenant ? tenant.toSafeFormat() : null;
                declarada = safe?.cantidadTrabajadores || null;
                fechaCreacionAmbito = safe?.createdAt ?? null;
            }
            const calculada = ambito === EP.AMBITO.OBRA
                ? EP.dotacionDeObra(personas, obraId)
                : EP.dotacionDeEmpresa(personas);
            const { dotacion } = EP.dotacionEfectiva({ calculada, declarada });

            const organo = await estructuraService.constituirOrgano({
                tenantId, ambito, obraId,
                tipo: body.tipo,
                fechaEleccionODesignacion: body.fechaEleccionODesignacion,
                fechaConstitucion: body.fechaConstitucion || null,
                fechaTerminoMandato: body.fechaTerminoMandato || null,
                miembros: body.miembros || [],
                dotacion,
                hayCphsVigente: EP.hayCphsVigente(organosAmbito),
                fechaCreacionAmbito,
                creadoPor: body.solicitanteId || null,
            });
            return created({ message: 'Órgano preventivo constituido', organo });
        }

        // ── POST /estructura/organos/{id}/disolver ───────────────────────────
        if (method === 'POST' && organoId && sub === 'disolver') {
            if (!(await puedeAdministrar(body.solicitanteId, tenantId))) {
                return error('No tienes permiso para disolver órganos preventivos', 403);
            }
            const res = await estructuraService.disolverOrgano({
                tenantId, organoId, motivo: body.motivo || null,
            });
            return success({ message: 'Órgano disuelto', ...res });
        }

        // ── PUT /estructura/organos/{id}/miembros/{miembroId}/acreditacion ───
        // Curso OPR (Art. 32), capacitación del OAL (Art. 65) y registro Seremi
        // (Art. 55) comparten este endpoint: los tres son check más documento.
        if (method === 'PUT' && organoId && sub === 'miembros' && subId && accion === 'acreditacion') {
            const miembro = await estructuraService.actualizarAcreditacion(
                tenantId, organoId, subId, body.acreditacion || body
            );
            return success({ message: 'Acreditación actualizada', miembro });
        }

        // ── POST /estructura/organos/{id}/documentos ─────────────────────────
        if (method === 'POST' && organoId && sub === 'documentos') {
            const organo = await estructuraService.vincularDocumento({
                tenantId, organoId, clave: body.clave, documentoId: body.documentoId,
            });
            return success({ message: 'Documento vinculado', organo });
        }

        // ── POST /estructura/organos/{id}/reuniones ──────────────────────────
        // Solo extraordinarias: las ordinarias se generan al constituir.
        if (method === 'POST' && organoId && sub === 'reuniones' && !subId) {
            const reunion = await estructuraService.crearReunionExtraordinaria({
                tenantId, organoId,
                causal: body.causal,
                fechaProgramada: body.fechaProgramada || null,
                registradoPor: body.solicitanteId || null,
            });
            return created({ message: 'Reunión extraordinaria creada', reunion });
        }

        // ── PUT /estructura/organos/{id}/reuniones/{reunionId} ───────────────
        // Registrar realizada (fecha + acta) o reagendar dentro del mes.
        if (method === 'PUT' && organoId && sub === 'reuniones' && subId && !accion) {
            if (body.fechaRealizada || body.actaDocumentoId) {
                const reunion = await estructuraService.registrarReunionRealizada({
                    tenantId, organoId, reunionId: subId,
                    fechaRealizada: body.fechaRealizada,
                    actaDocumentoId: body.actaDocumentoId,
                    registradoPor: body.solicitanteId || null,
                });
                return success({ message: 'Reunión registrada', reunion });
            }
            if (body.fechaProgramada) {
                const reunion = await estructuraService.reagendarReunion({
                    tenantId, organoId, reunionId: subId, fechaProgramada: body.fechaProgramada,
                });
                return success({ message: 'Reunión reagendada', reunion });
            }
            return error('Indica fechaRealizada con actaDocumentoId, o fechaProgramada para reagendar');
        }

        // ── POST .../reuniones/{id}/comunicacion-acuerdos (ítem 36) ──────────
        if (method === 'POST' && organoId && sub === 'reuniones' && subId && accion === 'comunicacion-acuerdos') {
            const reunion = await estructuraService.registrarComunicacionAcuerdos({
                tenantId, organoId, reunionId: subId,
                documentoId: body.documentoId, fecha: body.fecha || null,
            });
            return success({ message: 'Comunicación de acuerdos registrada', reunion });
        }

        return error('Ruta no encontrada', 404);
    } catch (err) {
        return responderError(err);
    }
};
