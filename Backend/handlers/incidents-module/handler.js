const { Router } = require('itty-router');
const { IncidentsRepository } = require('./incidents.repository');
const { PERMISSIONS } = require('../../lib/permissions');
const { conSesion, sesionPuede } = require('../../lib/auth/sesion');
const { conNeutro } = require('../../lib/degradacion');

const incidentsRepo = new IncidentsRepository();
const router = Router();

// ─── Taxonomia reunion 2026-06-10: hallazgos vs incidentes ───────────────────
// Hallazgos: reportables por cualquier trabajador, con marco de gobernanza.
// Incidentes/accidentes: creacion restringida a quien tenga 'incidentes.reportar'.
const TIPOS_HALLAZGO = ['condicion_subestandar', 'accion_subestandar'];
const TIPOS_INCIDENTE = ['accidente', 'incidente'];

// Deriva la clasificacion desde el tipo cuando el cliente no la envia.
const derivarClasificacion = (tipo) => (TIPOS_HALLAZGO.includes(tipo) ? 'hallazgo' : 'incidente');

/**
 * Sesión de la request, o la respuesta 401 lista para devolver.
 *
 * `itty-router` no pasa el evento de Lambda a los handlers salvo por
 * `request.event`, así que la sesión se resuelve acá y no en un middleware.
 */
const sesionDe = (request) => conSesion(request.event);

/**
 * Incidente de la empresa de la sesión, o null.
 *
 * La tabla está indexada por `incidentId`: con el id se leía, se editaba, se
 * calificaba como accidente y se descargaba la documentación de un incidente de
 * cualquier empresa. Son datos de salud de una persona identificable. 404.
 */
const incidenteDelTenant = async (incidentId, sesion) => {
    const item = await conNeutro('incidente.pertenencia', () => incidentsRepo.getItem(incidentId), null);
    return item && item.tenantId === sesion.tenantId ? item : null;
};

/** Error 404 uniforme para lo que no es de la empresa de la sesión. */
const noEncontrado = () => jsonResponse({ success: false, error: 'Incidente no encontrado' }, 404);
const sinPermiso = (mensaje) => jsonResponse({ success: false, error: mensaje }, 403);

// CORS Options Handler
router.options('*', () => {
    return {
        statusCode: 204,
        headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type,Authorization',
            'Access-Control-Max-Age': '86400'
        },
        body: ''
    };
});

// Define routes
router
    .post('/incidents', create)
    .get('/incidents', list)
    .get('/incidents/stats', getStats)
    .get('/incidents/analytics', getAnalytics)
    .post('/incidents/upload-evidence', uploadEvidence)
    .post('/incidents/quick-report', quickReport)
    .get('/incidents/:id', get)
    .put('/incidents/:id', update)
    .put('/incidents/:id/calificar-accidente', calificarAccidente)
    .post('/incidents/:id/viewed', markViewed)
    .post('/incidents/:id/investigations', addInvestigation)
    .put('/incidents/:id/gobernanza', updateGobernanza)
    .put('/incidents/:id/flash-completar', completarFlash)
    .put('/incidents/:id/medidas/:numero', updateMedidaEstado)
    .post('/incidents/:id/documents', uploadDocument)
    .get('/incidents/:id/documents', getDocuments);

router.all('*', () => jsonResponse({ error: 'Not Found' }, 404));

// Helper to parse body securely
const parseBody = (event) => {
    try {
        return event.body ? JSON.parse(event.body) : {};
    } catch {
        return {};
    }
};

// ... existing code ...

// Response helpers
const jsonResponse = (data, status = 200) => ({
    statusCode: status,
    headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    },
    body: JSON.stringify(data.success !== undefined ? data : { success: true, data }),
});

const errorResponse = (err) => {
    console.error('Handler Error:', err);
    let status = 500;

    if (err.statusCode) {
        status = err.statusCode;
    } else if (err.message.includes('No encontrado') || err.message.includes('not found')) {
        status = 404;
    } else if (err.message.includes('requerido') || err.message.includes('inválido') || err.message.includes('Faltan campos')) {
        status = 400;
    }

    return {
        statusCode: status,
        headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type,Authorization',
        },
        body: JSON.stringify({ success: false, error: err.message }),
    };
};

// Route Handlers
async function create(request) {
    console.log('[HANDLER] Create called - Method:', request.method, 'Path:', request.url);
    try {
        const ses = sesionDe(request);
        if (!ses.ok) return ses.respuesta;
        const sesion = ses.sesion;

        const body = parseBody(request.event);
        // La empresa y quien reporta salen de la sesión.
        body.tenantId = sesion.tenantId;
        body.reportadoPor = sesion.personaId;

        const clasificacion = body.clasificacion || derivarClasificacion(body.tipo);
        body.clasificacion = clasificacion;

        // Coherencia tipo <-> clasificacion
        if (clasificacion === 'hallazgo' && !TIPOS_HALLAZGO.includes(body.tipo)) {
            return jsonResponse({ success: false, error: `Tipo invalido para hallazgo. Tipos validos: ${TIPOS_HALLAZGO.join(', ')}` }, 400);
        }
        if (clasificacion === 'incidente' && !TIPOS_INCIDENTE.includes(body.tipo)) {
            return jsonResponse({ success: false, error: `Tipo invalido para incidente. Tipos validos: ${TIPOS_INCIDENTE.join(', ')}` }, 400);
        }

        // Incidentes/accidentes: requiere permiso 'incidentes.reportar' (sensibilidad
        // legal). El permiso se mira en la sesión, no en un `solicitanteId` del
        // cuerpo que cualquiera podía rellenar con el id de un supervisor.
        if (clasificacion === 'incidente' && !sesionPuede(sesion, PERMISSIONS.INCIDENTES_REPORTAR)) {
            return sinPermiso('No tienes permiso para reportar incidentes y accidentes.');
        }

        // Gobernanza de hallazgos: responsable, plazo y verificacion de cierre.
        if (clasificacion === 'hallazgo') {
            body.gobernanza = {
                responsableId: body.responsableId || null,
                responsableNombre: body.responsableNombre || null,
                plazoRespuestaISO: body.plazoRespuestaISO || null,
                estadoCierre: 'abierto',
                verificadoPor: null,
                fechaVerificacion: null,
                comentarioCierre: null
            };
        }

        // Reporte flash: datos minimos, editable en investigacion, con leyenda legal.
        if (clasificacion === 'incidente' && body.esFlash) {
            body.reporteFlash = {
                esFlash: true,
                segunInformacionDisponible: true,
                afectados: body.afectados || [],
                descripcionBreve: String(body.descripcionBreve || '').slice(0, 500),
                severidad: body.gravedad || 'leve',
                evidencias: body.evidencias || [],
                ubicacionReferencia: body.ubicacionReferencia || '',
                creadoEn: new Date().toISOString(),
                editadoEn: null
            };
            // Completar campos minimos del incidente desde el flash.
            const primerAfectado = (body.afectados || [])[0] || {};
            body.trabajador = body.trabajador || { nombre: primerAfectado.nombre || 'Por identificar', rut: primerAfectado.rut || '', cargo: primerAfectado.cargo || '' };
            body.descripcion = body.descripcion || body.reporteFlash.descripcionBreve;
            body.centroTrabajo = body.centroTrabajo || body.ubicacionReferencia || 'Por definir';
        }

        const result = await incidentsRepo.create(body, request.event);
        console.log('[HANDLER] Create result:', result.incident?.incidentId);
        // Return incident data directly for frontend compatibility
        return jsonResponse({
            success: true,
            data: result.incident,
            message: result.message
        }, 201);
    } catch (err) {
        console.error('[HANDLER] Create error:', err.message);
        return errorResponse(err);
    }
}

async function list(request) {
    try {
        const ses = sesionDe(request);
        if (!ses.ok) return ses.respuesta;
        const { obraId, tipo, estado, fechaInicio, fechaFin } = request.query || {};
        const tenantId = ses.sesion.tenantId;
        const { items, total } = await incidentsRepo.list({ tenantId, obraId, tipo, estado, fechaInicio, fechaFin });

        // Return in format expected by frontend: data is the array, total is top-level
        return jsonResponse({
            success: true,
            data: items,
            total
        });
    } catch (err) {
        console.error('Error in list incidents:', err);
        return errorResponse(err);
    }
}

async function get(request) {
    try {
        const ses = sesionDe(request);
        if (!ses.ok) return ses.respuesta;
        if (!await incidenteDelTenant(request.params.id, ses.sesion)) return noEncontrado();
        const result = await incidentsRepo.get(request.params.id);
        return jsonResponse(result);
    } catch (err) {
        return errorResponse(err);
    }
}

async function markViewed(request) {
    try {
        const ses = sesionDe(request);
        if (!ses.ok) return ses.respuesta;
        if (!await incidenteDelTenant(request.params.id, ses.sesion)) return noEncontrado();
        // Quién lo vio es quien tiene la sesión.
        await incidentsRepo.markAsViewed(request.params.id, ses.sesion.personaId);
        return jsonResponse({ success: true });
    } catch (err) {
        return errorResponse(err);
    }
}

async function update(request) {
    try {
        const ses = sesionDe(request);
        if (!ses.ok) return ses.respuesta;
        if (!await incidenteDelTenant(request.params.id, ses.sesion)) return noEncontrado();
        if (!sesionPuede(ses.sesion, PERMISSIONS.INCIDENTES_REPORTAR)) {
            return sinPermiso('No tienes permiso para editar incidentes.');
        }
        const body = parseBody(request.event);
        // `tenantId` no se reasigna por esta vía: mover un incidente de empresa no
        // es una edición, es una fuga.
        delete body.tenantId;
        const result = await incidentsRepo.update(request.params.id, body);
        // Return incident data directly for frontend compatibility
        return jsonResponse({
            success: true,
            data: result.incident,
            message: result.message
        });
    } catch (err) {
        return errorResponse(err);
    }
}

async function calificarAccidente(request) {
    try {
        const ses = sesionDe(request);
        if (!ses.ok) return ses.respuesta;
        if (!await incidenteDelTenant(request.params.id, ses.sesion)) return noEncontrado();
        if (!sesionPuede(ses.sesion, PERMISSIONS.INCIDENTES_CALIFICAR_ACCIDENTE)) {
            return sinPermiso('No tienes permiso para calificar como accidente.');
        }
        const result = await incidentsRepo.update(request.params.id, {
            tipo: 'accidente',
            clasificacion: 'incidente',
        });
        return jsonResponse({ success: true, data: result.incident, message: 'Calificado como accidente.' });
    } catch (err) {
        return errorResponse(err);
    }
}

async function uploadEvidence(request) {
    try {
        const ses = sesionDe(request);
        if (!ses.ok) return ses.respuesta;
        const body = parseBody(request.event);
        // La evidencia se adjunta a un incidente de la propia empresa; sin id se
        // sube al prefijo temporal, que no expone nada de nadie.
        if (body.incidentId && !await incidenteDelTenant(body.incidentId, ses.sesion)) return noEncontrado();
        // La empresa sale de la sesión: es la que arma el prefijo de la clave.
        const result = await incidentsRepo.uploadEvidence({ ...body, tenantId: ses.sesion.tenantId });
        return jsonResponse(result);
    } catch (err) {
        return errorResponse(err);
    }
}

async function getStats(request) {
    try {
        const ses = sesionDe(request);
        if (!ses.ok) return ses.respuesta;
        const { obraId, mes, masaLaboral } = request.query || {};
        const result = await incidentsRepo.getStats({ tenantId: ses.sesion.tenantId, obraId, mes, masaLaboral });
        return jsonResponse(result);
    } catch (err) {
        return errorResponse(err);
    }
}

async function addInvestigation(request) {
    try {
        const ses = sesionDe(request);
        if (!ses.ok) return ses.respuesta;
        if (!await incidenteDelTenant(request.params.id, ses.sesion)) return noEncontrado();
        if (!sesionPuede(ses.sesion, PERMISSIONS.INCIDENTES_REPORTAR)) {
            return sinPermiso('No tienes permiso para registrar investigaciones.');
        }
        const body = parseBody(request.event);
        const result = await incidentsRepo.addInvestigation(request.params.id, body);
        return jsonResponse(result);
    } catch (err) {
        return errorResponse(err);
    }
}

// Gestionar la gobernanza de un hallazgo o completar un reporte flash es cosa de
// supervisor hacia arriba. El actor sale de la SESIÓN: antes venía en `actorId`
// del cuerpo, así que bastaba con escribir el id de un supervisor.
const esSupervisorOSuperior = (sesion) => sesionPuede(sesion, PERMISSIONS.INCIDENTES_REPORTAR);

async function updateGobernanza(request) {
    try {
        const ses = sesionDe(request);
        if (!ses.ok) return ses.respuesta;
        if (!await incidenteDelTenant(request.params.id, ses.sesion)) return noEncontrado();
        if (!esSupervisorOSuperior(ses.sesion)) {
            return sinPermiso('Solo supervisores y roles superiores pueden gestionar la gobernanza de hallazgos.');
        }
        const body = parseBody(request.event);
        // Quien verifica el cierre es quien tiene la sesión.
        if (body.estadoCierre === 'cerrado') {
            body.verificadoPor = ses.sesion.personaId;
        }
        const result = await incidentsRepo.updateGobernanza(request.params.id, body);
        return jsonResponse(result);
    } catch (err) {
        return errorResponse(err);
    }
}

async function completarFlash(request) {
    try {
        const ses = sesionDe(request);
        if (!ses.ok) return ses.respuesta;
        if (!await incidenteDelTenant(request.params.id, ses.sesion)) return noEncontrado();
        if (!esSupervisorOSuperior(ses.sesion)) {
            return sinPermiso('Solo supervisores y roles superiores pueden completar el reporte flash.');
        }
        const body = parseBody(request.event);
        const result = await incidentsRepo.completarFlash(request.params.id, body);
        return jsonResponse(result);
    } catch (err) {
        return errorResponse(err);
    }
}

async function updateMedidaEstado(request) {
    try {
        const ses = sesionDe(request);
        if (!ses.ok) return ses.respuesta;
        if (!await incidenteDelTenant(request.params.id, ses.sesion)) return noEncontrado();
        if (!esSupervisorOSuperior(ses.sesion)) {
            return sinPermiso('No tienes permiso para actualizar las medidas correctivas.');
        }
        const body = parseBody(request.event);
        const result = await incidentsRepo.updateMedidaEstado(
            request.params.id,
            decodeURIComponent(request.params.numero),
            body.estado
        );
        return jsonResponse(result);
    } catch (err) {
        return errorResponse(err);
    }
}

async function uploadDocument(request) {
    try {
        const ses = sesionDe(request);
        if (!ses.ok) return ses.respuesta;
        if (!await incidenteDelTenant(request.params.id, ses.sesion)) return noEncontrado();
        const body = parseBody(request.event);
        const result = await incidentsRepo.uploadDocument(request.params.id, { ...body, tenantId: ses.sesion.tenantId });
        return jsonResponse(result);
    } catch (err) {
        return errorResponse(err);
    }
}

async function getDocuments(request) {
    try {
        const ses = sesionDe(request);
        if (!ses.ok) return ses.respuesta;
        if (!await incidenteDelTenant(request.params.id, ses.sesion)) return noEncontrado();
        const result = await incidentsRepo.getDocuments(request.params.id);
        return jsonResponse(result);
    } catch (err) {
        return errorResponse(err);
    }
}

async function getAnalytics(request) {
    try {
        const ses = sesionDe(request);
        if (!ses.ok) return ses.respuesta;
        const { obraId, fechaInicio, fechaFin } = request.query || {};
        const result = await incidentsRepo.getAnalytics({ tenantId: ses.sesion.tenantId, obraId, fechaInicio, fechaFin });
        return jsonResponse(result);
    } catch (err) {
        return errorResponse(err);
    }
}

async function quickReport(request) {
    try {
        const ses = sesionDe(request);
        if (!ses.ok) return ses.respuesta;
        const body = parseBody(request.event);
        body.tenantId = ses.sesion.tenantId;
        body.reportadoPor = ses.sesion.personaId;
        const result = await incidentsRepo.quickReport(body);
        return jsonResponse(result, 201);
    } catch (err) {
        return errorResponse(err);
    }
}

// Main Lambda Handler
module.exports.incidentsHandler = async (event) => {
    // Adapt Lambda event to itty-router request
    const path = event.rawPath || event.path;

    // itty-router v5 reconstruye request.query EXCLUSIVAMENTE desde el query string
    // de la URL (ignora cualquier `query` que le pasemos). Como rawPath/path no
    // incluyen el query string, hay que reanexarlo a la URL o se pierden TODOS los
    // filtros (obraId, tenantId, tipo, …) y el listado devuelve todo sin filtrar.
    const queryString = event.rawQueryString
        || (event.queryStringParameters
            ? new URLSearchParams(
                Object.entries(event.queryStringParameters).filter(([, v]) => v != null)
            ).toString()
            : '');
    const fullUrl = `https://${event.headers.host}${path}${queryString ? `?${queryString}` : ''}`;

    // Construct simplified Request-like object
    const request = {
        method: event.requestContext?.http?.method || event.httpMethod,
        url: fullUrl,
        params: {}, // Will be populated by router
        query: event.queryStringParameters || {},
        event // Pass full event for body parsing and context
    };

    console.log(`[IncidentsModule] Request: ${request.method} ${path}`);
    console.log(`[IncidentsModule] Full URL: ${request.url}`);

    try {
        // HACK: itty-router's `fetch` expects a standard Request.
        // We will create a fake request object that satisfies what router needs (url, method)
        const fakeReq = {
            method: request.method,
            url: fullUrl,
            headers: new Map(Object.entries(event.headers || {})),
            text: async () => event.body || '',
            json: async () => JSON.parse(event.body || '{}'),
            event: event, // Custom property passed through
            query: request.query
        };

        const response = await router.fetch(fakeReq);

        if (response.statusCode !== undefined) {
            return response;
        }

        // Conversion if it returned a standard Response object
        return {
            statusCode: response.status,
            headers: Object.fromEntries(response.headers.entries()),
            body: await response.text()
        };
    } catch (err) {
        console.error('Router Error:', err);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'Internal Server Error' })
        };
    }
};
