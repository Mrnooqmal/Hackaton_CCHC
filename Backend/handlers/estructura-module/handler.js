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
const { PERMISSIONS } = require('../../lib/permissions');
const { success, error, created, cors } = require('../../lib/utils/response');
const EP = require('../../lib/estructura-preventiva');
const { construirExport, renderHtml } = require('../../lib/completitud-export');

const { QueryCommand, GetCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient } = require('../../lib/clients/dynamodb');
const { tenantIdDeSesion, conSesion, sesionPuede } = require('../../lib/auth/sesion');
const DOCUMENTS_TABLE = process.env.DOCUMENTS_TABLE || 'Documents';

/** Documentos del tenant. La completitud los necesita para los ítems 38, 46 y 47. */
const ACTIVITIES_TABLE = process.env.ACTIVITIES_TABLE || 'Activities';

/**
 * Actividades del tenant.
 *
 * Varios requisitos NO se acreditan con un PDF: la capacitación de 8 horas del
 * Art. 16 y la de EPP del Art. 13 son actividades ejecutadas con asistentes
 * firmados. Sin esto el motor no las veía y marcaba pendientes obras que sí
 * habían capacitado.
 */
const listarActividadesTenant = async (tenantId) => {
    try {
        const res = await docClient.send(new QueryCommand({
            TableName: ACTIVITIES_TABLE,
            IndexName: 'tenantId-index',
            KeyConditionExpression: 'tenantId = :t',
            ExpressionAttributeValues: { ':t': tenantId },
        }));
        return res.Items || [];
    } catch (err) {
        // Que falte el índice o la tabla no puede tumbar el panel entero: se
        // reporta y los requisitos por actividad quedan pendientes, no en verde.
        console.error('[estructura] no se pudieron leer las actividades:', err.message);
        return [];
    }
};

const listarDocumentosTenant = async (tenantId) => {
    try {
        const res = await docClient.send(new QueryCommand({
            TableName: DOCUMENTS_TABLE,
            IndexName: 'tenantId-index',
            KeyConditionExpression: 'tenantId = :t',
            ExpressionAttributeValues: { ':t': tenantId },
        }));
        return res.Items || [];
    } catch (err) {
        console.error('[estructura] no se pudieron leer los documentos:', err.message);
        return [];
    }
};

/**
 * Arma la completitud de un ámbito.
 *
 * Existe porque el panel y el export la pedían por separado y el export había
 * quedado sin `reglas`: evaluaba el reglamento sin las organizaciones sindicales
 * y el programa de trabajo sin representante legal, así que el reporte impreso y
 * la pantalla podían decir cosas distintas del mismo requisito. Con un solo
 * armado eso no puede volver a pasar.
 */
/**
 * Lo que NO depende del ámbito: personas, documentos, actividades y el tenant.
 *
 * Se aísla para poder evaluar varias obras compartiendo estas consultas. Sin
 * esto, el resumen del panel principal repetía cuatro lecturas por obra.
 */
const contextoDelTenant = async (tenantId) => {
    const [personas, documentos, actividades, tenant] = await Promise.all([
        personaService.listByTenant(tenantId).catch(() => []),
        listarDocumentosTenant(tenantId),
        listarActividadesTenant(tenantId),
        tenantService.getById(tenantId).catch(() => null),
    ]);
    return { personas, documentos, actividades, tenantSafe: tenant ? tenant.toSafeFormat() : null };
};

const armarCompletitud = async (tenantId, ambito, obraId) => {
    const [base, obra] = await Promise.all([
        contextoDelTenant(tenantId),
        obraId ? obraService.getById(obraId).catch(() => null) : Promise.resolve(null),
    ]);
    const { personas, documentos, actividades, tenantSafe } = base;

    const completitud = await estructuraService.completitudAmbito({
        tenantId, ambito, obraId, personas, documentos,
        dotacionDeclarada: ambito === EP.AMBITO.OBRA
            ? (obra?.dotacionDeclarada ?? null)
            : (tenantSafe?.cantidadTrabajadores || null),
        reglas: tenantSafe?.reglas || {},
        actividades,
        obra,
    });
    return { completitud, tenantSafe, obra };
};

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
 * ¿Puede esta sesión administrar la estructura preventiva?
 *
 * Constituir, disolver, acreditar y registrar reuniones es el mismo acto de
 * gobierno del órgano, y lo hace el perfil que ya administra la empresa u obra
 * (ver el encabezado del módulo). Los permisos vienen resueltos en la sesión.
 *
 * Antes esto recibía un `solicitanteId` del cuerpo y **dejaba pasar si no venía
 * ninguno**: omitir el campo bastaba para constituir o disolver un comité
 * paritario. Ahora el permiso se exige siempre y el actor sale de la sesión.
 */
const puedeAdministrar = (sesion) =>
    sesionPuede(sesion, PERMISSIONS.OBRAS_CREAR) || sesionPuede(sesion, PERMISSIONS.EMPRESA_VER);

/**
 * ¿El documento que se quiere usar como evidencia es de esta empresa?
 *
 * Las actas, los certificados y las comunicaciones de acuerdos se vinculan por
 * `documentId`, y un requisito del FUF se da por cumplido cuando el vínculo
 * existe. Sin esta comprobación se podía acreditar un órgano con el acta de otra
 * empresa: el identificador es adivinable y el cumplimiento, auditable.
 */
const documentoEsDelTenant = async (documentoId, tenantId) => {
    if (!documentoId) return true;   // el vínculo es opcional en varios flujos
    const res = await docClient.send(new GetCommand({
        TableName: DOCUMENTS_TABLE,
        Key: { documentId: documentoId },
    })).catch(() => null);
    return Boolean(res?.Item && res.Item.tenantId === tenantId);
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
    // El tenantId sale de la SESIÓN, nunca del cliente. Ver la nota en
    // `personas-module`: el orden anterior dejaba ganar al valor del llamante.
    const tenantId = tenantIdDeSesion(event);
    const sesionRes = conSesion(event);
    const sesion = sesionRes.ok ? sesionRes.sesion : null;

    try {
        if (method === 'OPTIONS') return cors();
        if (!sesion) return sesionRes.respuesta;

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

        // ── GET /estructura/completitud ──────────────────────────────────────
        // Estado de los requisitos del FUF del ámbito. Lee las mismas definiciones
        // que leerá el export: una sola fuente para panel y expediente.
        if (method === 'GET' && recurso === 'completitud' && !organoId) {
            const ambito = q.ambito === EP.AMBITO.OBRA ? EP.AMBITO.OBRA : EP.AMBITO.EMPRESA;
            const obraId = q.obraId || null;
            if (ambito === EP.AMBITO.OBRA && !obraId) return error('obraId es requerido para el ámbito obra');

            const { completitud } = await armarCompletitud(tenantId, ambito, obraId);
            return success(completitud);
        }

        // ── GET /estructura/completitud/resumen ──────────────────────────────
        //
        // Avance de TODAS las obras del tenant, más el de la entidad, en una sola
        // pasada. El panel principal lo calculaba por su cuenta contando documentos
        // de una lista propia: dos números para lo mismo, y el de la portada era el
        // que no coincidía con el del formulario.
        //
        // Comparte las consultas pesadas entre obras: sin esto serían cuatro
        // lecturas del tenant por cada faena.
        if (method === 'GET' && recurso === 'completitud' && organoId === 'resumen') {
            const base = await contextoDelTenant(tenantId);
            const obras = await obraService.listByTenant(tenantId).catch(() => []);

            const evaluar = (ambito, obra) => estructuraService.completitudAmbito({
                tenantId, ambito,
                obraId: obra?.obraId || null,
                personas: base.personas,
                documentos: base.documentos,
                actividades: base.actividades,
                dotacionDeclarada: obra
                    ? (obra.dotacionDeclarada ?? null)
                    : (base.tenantSafe?.cantidadTrabajadores || null),
                reglas: base.tenantSafe?.reglas || {},
                obra: obra || null,
            });

            const soloResumen = (c) => ({
                progreso: c.resumen.progreso,
                cumplidos: c.resumen.cumplidos,
                exigibles: c.resumen.exigibles,
                excluidos: c.resumen.excluidos,
            });

            const [empresa, ...porObra] = await Promise.all([
                evaluar(EP.AMBITO.EMPRESA, null),
                ...obras.map((o) => evaluar(EP.AMBITO.OBRA, o)),
            ]);

            return success({
                empresa: soloResumen(empresa),
                obras: Object.fromEntries(
                    obras.map((o, i) => [o.obraId, soloResumen(porObra[i])])
                ),
            });
        }

        // ── GET /estructura/completitud/export ───────────────────────────────
        // Reporte imprimible del estado del FUF. Lee las MISMAS definiciones que
        // el panel: si divergen, es que alguien reimplementó el cálculo.
        if (method === 'GET' && recurso === 'completitud' && organoId === 'export') {
            const ambito = q.ambito === EP.AMBITO.OBRA ? EP.AMBITO.OBRA : EP.AMBITO.EMPRESA;
            const obraId = q.obraId || null;
            if (ambito === EP.AMBITO.OBRA && !obraId) return error('obraId es requerido para el ámbito obra');

            const { completitud, tenantSafe, obra } = await armarCompletitud(tenantId, ambito, obraId);

            const exp = construirExport(completitud, {
                nombreEmpresa: tenantSafe?.nombre || null,
                nombreObra: obra?.nombre || null,
            });

            // `formato=html` devuelve el documento listo para imprimir; por defecto
            // se devuelve la estructura, para que otros formatos la reutilicen.
            if (q.formato === 'html') {
                return {
                    statusCode: 200,
                    headers: {
                        'Content-Type': 'text/html; charset=utf-8',
                        'Access-Control-Allow-Origin': '*',
                        'Content-Disposition': `inline; filename="cumplimiento-fuf-${ambito}${obraId ? '-' + obraId : ''}.html"`,
                    },
                    body: renderHtml(exp),
                };
            }
            return success(exp);
        }

        // ── Prescripciones de medidas (Art. 70, ítem 58) ─────────────────────
        if (recurso === 'prescripciones') {
            const prescripcionId = organoId; // segundo segmento de la ruta

            if (method === 'GET' && !prescripcionId) {
                const lista = await estructuraService.listarPrescripciones(tenantId, { obraId: q.obraId || null });
                return success({ total: lista.length, prescripciones: lista });
            }
            if (method === 'POST' && !prescripcionId) {
                if (!puedeAdministrar(sesion)) {
                    return error('No tienes permiso para registrar prescripciones', 403);
                }
                const creada = await estructuraService.crearPrescripcion({
                    tenantId, ...body, registradoPor: sesion.personaId,
                });
                return created({ message: 'Prescripción registrada', prescripcion: creada });
            }
            if (method === 'PUT' && prescripcionId) {
                if (!puedeAdministrar(sesion)) {
                    return error('No tienes permiso para modificar prescripciones', 403);
                }
                const actualizada = await estructuraService.actualizarPrescripcion({
                    tenantId, prescripcionId, cambios: body,
                });
                return success({ message: 'Prescripción actualizada', prescripcion: actualizada });
            }
            if (method === 'DELETE' && prescripcionId) {
                if (!puedeAdministrar(sesion)) {
                    return error('No tienes permiso para eliminar prescripciones', 403);
                }
                await estructuraService.eliminarPrescripcion(tenantId, prescripcionId);
                return success({ message: 'Prescripción eliminada' });
            }
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
            if (!puedeAdministrar(sesion)) {
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
                creadoPor: sesion.personaId,
            });
            return created({ message: 'Órgano preventivo constituido', organo });
        }

        // ── POST /estructura/organos/{id}/disolver ───────────────────────────
        if (method === 'POST' && organoId && sub === 'disolver') {
            if (!puedeAdministrar(sesion)) {
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
            if (!puedeAdministrar(sesion)) {
                return error('No tienes permiso para acreditar miembros del órgano', 403);
            }
            const miembro = await estructuraService.actualizarAcreditacion(
                tenantId, organoId, subId, body.acreditacion || body
            );
            return success({ message: 'Acreditación actualizada', miembro });
        }

        // ── POST /estructura/organos/{id}/documentos ─────────────────────────
        if (method === 'POST' && organoId && sub === 'documentos') {
            if (!puedeAdministrar(sesion)) {
                return error('No tienes permiso para vincular documentos al órgano', 403);
            }
            if (!(await documentoEsDelTenant(body.documentoId, tenantId))) {
                return error('Documento no encontrado', 404);
            }
            const organo = await estructuraService.vincularDocumento({
                tenantId, organoId, clave: body.clave, documentoId: body.documentoId,
            });
            return success({ message: 'Documento vinculado', organo });
        }

        // ── POST /estructura/organos/{id}/reuniones ──────────────────────────
        // Solo extraordinarias: las ordinarias se generan al constituir.
        if (method === 'POST' && organoId && sub === 'reuniones' && !subId) {
            if (!puedeAdministrar(sesion)) {
                return error('No tienes permiso para convocar reuniones del órgano', 403);
            }
            const reunion = await estructuraService.crearReunionExtraordinaria({
                tenantId, organoId,
                causal: body.causal,
                fechaProgramada: body.fechaProgramada || null,
                registradoPor: sesion.personaId,
            });
            return created({ message: 'Reunión extraordinaria creada', reunion });
        }

        // ── PUT /estructura/organos/{id}/reuniones/{reunionId} ───────────────
        // Registrar realizada (fecha + acta) o reagendar dentro del mes.
        if (method === 'PUT' && organoId && sub === 'reuniones' && subId && !accion) {
            if (!puedeAdministrar(sesion)) {
                return error('No tienes permiso para registrar reuniones del órgano', 403);
            }
            if (!(await documentoEsDelTenant(body.actaDocumentoId, tenantId))) {
                return error('Documento no encontrado', 404);
            }
            if (body.fechaRealizada || body.actaDocumentoId) {
                const reunion = await estructuraService.registrarReunionRealizada({
                    tenantId, organoId, reunionId: subId,
                    fechaRealizada: body.fechaRealizada,
                    actaDocumentoId: body.actaDocumentoId,
                    registradoPor: sesion.personaId,
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
            if (!puedeAdministrar(sesion)) {
                return error('No tienes permiso para registrar la comunicación de acuerdos', 403);
            }
            if (!(await documentoEsDelTenant(body.documentoId, tenantId))) {
                return error('Documento no encontrado', 404);
            }
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
