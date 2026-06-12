const { Router } = require('itty-router');
const { IncidentsRepository } = require('./incidents.repository');
const { PersonaService } = require('../../lib/services/PersonaService');

const incidentsRepo = new IncidentsRepository();
const personaService = new PersonaService();
const router = Router();

// ─── Taxonomia reunion 2026-06-10: hallazgos vs incidentes ───────────────────
// Hallazgos: reportables por cualquier trabajador, con marco de gobernanza.
// Incidentes/accidentes: creacion restringida a supervisor y roles superiores.
const TIPOS_HALLAZGO = ['condicion_subestandar', 'accion_subestandar'];
const TIPOS_INCIDENTE = ['accidente', 'incidente'];
const ROLES_CREACION_INCIDENTE = ['admin', 'jefe_obra', 'supervisor', 'prevencionista'];

// Deriva la clasificacion desde el tipo cuando el cliente no la envia.
const derivarClasificacion = (tipo) => (TIPOS_HALLAZGO.includes(tipo) ? 'hallazgo' : 'incidente');

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
        const body = parseBody(request.event);
        console.log('[HANDLER] Parsed body:', JSON.stringify(body));

        const clasificacion = body.clasificacion || derivarClasificacion(body.tipo);
        body.clasificacion = clasificacion;

        // Coherencia tipo <-> clasificacion
        if (clasificacion === 'hallazgo' && !TIPOS_HALLAZGO.includes(body.tipo)) {
            return jsonResponse({ success: false, error: `Tipo invalido para hallazgo. Tipos validos: ${TIPOS_HALLAZGO.join(', ')}` }, 400);
        }
        if (clasificacion === 'incidente' && !TIPOS_INCIDENTE.includes(body.tipo)) {
            return jsonResponse({ success: false, error: `Tipo invalido para incidente. Tipos validos: ${TIPOS_INCIDENTE.join(', ')}` }, 400);
        }

        // Incidentes/accidentes: solo supervisor y roles superiores (sensibilidad legal).
        if (clasificacion === 'incidente') {
            const solicitanteId = body.solicitanteId || null;
            const solicitante = solicitanteId ? await personaService.getById(solicitanteId).catch(() => null) : null;
            if (!solicitante || !ROLES_CREACION_INCIDENTE.includes(solicitante.rol)) {
                return jsonResponse({ success: false, error: 'Solo supervisores y roles superiores pueden reportar incidentes y accidentes.' }, 403);
            }
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
        console.log('List Incidents Request:', request.query);
        const { tenantId, tipo, estado, fechaInicio, fechaFin } = request.query || {};
        const { items, total } = await incidentsRepo.list({ tenantId, tipo, estado, fechaInicio, fechaFin });

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
        const result = await incidentsRepo.get(request.params.id);
        return jsonResponse(result);
    } catch (err) {
        return errorResponse(err);
    }
}

async function markViewed(request) {
    try {
        const body = parseBody(request.event);
        const { userId } = body;
        if (!userId) {
            return errorResponse(new Error('userId es requerido'));
        }
        await incidentsRepo.markAsViewed(request.params.id, userId);
        return jsonResponse({ success: true });
    } catch (err) {
        return errorResponse(err);
    }
}

async function update(request) {
    try {
        const body = parseBody(request.event);
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

async function uploadEvidence(request) {
    try {
        const body = parseBody(request.event);
        const result = await incidentsRepo.uploadEvidence(body);
        return jsonResponse(result);
    } catch (err) {
        return errorResponse(err);
    }
}

async function getStats(request) {
    try {
        const { tenantId, mes, masaLaboral } = request.query || {};
        const result = await incidentsRepo.getStats({ tenantId, mes, masaLaboral });
        return jsonResponse(result);
    } catch (err) {
        return errorResponse(err);
    }
}

async function addInvestigation(request) {
    try {
        const body = parseBody(request.event);
        const result = await incidentsRepo.addInvestigation(request.params.id, body);
        return jsonResponse(result);
    } catch (err) {
        return errorResponse(err);
    }
}

// Valida que el actor (body.actorId) tenga rol supervisor o superior.
async function validarActorSupervisor(body) {
    const actorId = body.actorId || null;
    const actor = actorId ? await personaService.getById(actorId).catch(() => null) : null;
    if (!actor || !ROLES_CREACION_INCIDENTE.includes(actor.rol)) {
        return null;
    }
    return actor;
}

async function updateGobernanza(request) {
    try {
        const body = parseBody(request.event);
        const actor = await validarActorSupervisor(body);
        if (!actor) {
            return jsonResponse({ success: false, error: 'Solo supervisores y roles superiores pueden gestionar la gobernanza de hallazgos.' }, 403);
        }
        // Quien verifica el cierre queda trazado con el actor.
        if (body.estadoCierre === 'cerrado' && !body.verificadoPor) {
            body.verificadoPor = actor.personaId;
        }
        const result = await incidentsRepo.updateGobernanza(request.params.id, body);
        return jsonResponse(result);
    } catch (err) {
        return errorResponse(err);
    }
}

async function completarFlash(request) {
    try {
        const body = parseBody(request.event);
        const actor = await validarActorSupervisor(body);
        if (!actor) {
            return jsonResponse({ success: false, error: 'Solo supervisores y roles superiores pueden completar el reporte flash.' }, 403);
        }
        const result = await incidentsRepo.completarFlash(request.params.id, body);
        return jsonResponse(result);
    } catch (err) {
        return errorResponse(err);
    }
}

async function updateMedidaEstado(request) {
    try {
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
        const body = parseBody(request.event);
        const result = await incidentsRepo.uploadDocument(request.params.id, body);
        return jsonResponse(result);
    } catch (err) {
        return errorResponse(err);
    }
}

async function getDocuments(request) {
    try {
        const result = await incidentsRepo.getDocuments(request.params.id);
        return jsonResponse(result);
    } catch (err) {
        return errorResponse(err);
    }
}

async function getAnalytics(request) {
    try {
        const { tenantId, fechaInicio, fechaFin } = request.query || {};
        const result = await incidentsRepo.getAnalytics({ tenantId, fechaInicio, fechaFin });
        return jsonResponse(result);
    } catch (err) {
        return errorResponse(err);
    }
}

async function quickReport(request) {
    try {
        const body = parseBody(request.event);
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

    // Construct simplified Request-like object
    const request = {
        method: event.requestContext?.http?.method || event.httpMethod,
        url: `https://${event.headers.host}${path}`,
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
            url: request.url,
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
