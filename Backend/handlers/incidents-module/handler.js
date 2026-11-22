const { Router } = require('itty-router');
const { sinCache } = require('../../lib/utils/response');
const { IncidentsRepository } = require('./incidents.repository');
const { PERMISSIONS } = require('../../lib/permissions');
const { conSesion, sesionPuede } = require('../../lib/auth/sesion');
const { conNeutro } = require('../../lib/degradacion');
const { personaDeLaEmpresa, personasDeLaEmpresa } = require('../../lib/auth/pertenencia');
const { conAuditoriaSalud, anotarAccesoSalud, TIPOS: TIPOS_ACCESO_SALUD } = require('../../lib/gobernanza/auditoriaSalud');
const {
    ORDEN_TIPOS_PAPEL, esTipoPapel, MIME_PAPELES, MAX_BYTES_PAPEL, MAX_PAPELES_POR_CASO,
    papelesRequeridos, avanceDelCaso,
} = require('../../lib/casos');

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

/**
 * Quién lee qué incidentes (fila 7.5, 8 de noviembre de 2026).
 *
 * `GET /incidents` y `GET /incidents/{id}` solo exigían sesión: un trabajador
 * recibía todos los incidentes de la empresa, con el nombre del afectado, el
 * relato, la gravedad y los días perdidos, y en la ficha además el RUT y las
 * lesiones. La pantalla ya escondía el historial sin `incidentes.historial`;
 * la API no. Ahora, sin ese permiso, cada persona lee solo lo que reportó.
 */
const veHistorial = (sesion) => sesionPuede(sesion, PERMISSIONS.INCIDENTES_HISTORIAL);
const puedeLeer = (incidente, sesion) => Boolean(incidente) && (veHistorial(sesion) || incidente.reportadoPor === sesion.personaId);

/** Error 404 uniforme para lo que no es de la empresa de la sesión. */
const noEncontrado = () => jsonResponse({ success: false, error: 'Incidente no encontrado' }, 404);
const sinPermiso = (mensaje) => jsonResponse({ success: false, error: mensaje }, 403);

/**
 * Quién puede subir y adjuntar evidencia a un incidente: quien lo reportó o
 * quien gestiona incidentes (`incidentes.reportar`). Devuelve la respuesta de
 * rechazo, o null si puede.
 *
 * La usan `POST /incidents/upload-evidence` (firmar la subida) y
 * `POST /incidents/{id}/evidencias` (adjuntar la clave), para que las dos
 * rutas no se desalineen: antes la primera le firmaba a cualquiera de la
 * empresa una subida a la carpeta de cualquier incidente.
 *
 * Lo que no puede leer, ni sabe que existe: el mismo 404 que `get`. Lo que
 * puede leer (con historial) pero no gestionar: 403.
 */
const rechazoParaEvidencia = (incidente, sesion) => {
    if (!incidente) return noEncontrado();
    if (incidente.reportadoPor === sesion.personaId || sesionPuede(sesion, PERMISSIONS.INCIDENTES_REPORTAR)) return null;
    if (!puedeLeer(incidente, sesion)) return noEncontrado();
    return sinPermiso('Solo quien reportó el caso puede adjuntarle evidencia.');
};

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
    .post('/incidents/:id/evidencias', agregarEvidencias)
    .put('/incidents/:id/calificar-accidente', calificarAccidente)
    .post('/incidents/:id/viewed', markViewed)
    .post('/incidents/:id/investigations', addInvestigation)
    .put('/incidents/:id/gobernanza', updateGobernanza)
    .put('/incidents/:id/flash-completar', completarFlash)
    .put('/incidents/:id/medidas/:numero', updateMedidaEstado)
    // Papeles del caso (fase 2): subir en dos pasos y listar con descarga firmada.
    .post('/incidents/:id/documents', pedirSubidaDocumento)
    .post('/incidents/:id/documents/confirmar', confirmarDocumento)
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
    body: JSON.stringify(data.success !== undefined ? data : { success: true, data }, sinPapeles),
});

/**
 * Las claves `papeles` y `documentos` del incidente (los archivos del caso, con
 * su clave de S3) nunca salen en una respuesta de este módulo.
 *
 * El detalle, el listado y las respuestas de las ediciones devuelven el incidente
 * tal como está guardado, y ahí van la DIAT y la DIEP, que traen RUT y datos de
 * salud. Quien reportó un caso lo puede leer aunque no tenga `incidentes.historial`
 * y a esa persona no se le expone la DIAT; y quien sí tiene historial las descarga
 * por `GET /incidents/{id}/documents`, que firma el enlace y deja la auditoría. Por
 * eso la lista se saca acá, por defecto, y no ruta por ruta: una respuesta nueva
 * que devuelva el incidente (fases 3 y 4) tampoco la filtra por olvido. Esa ruta
 * entrega su lista bajo otro nombre (`archivos`).
 */
function sinPapeles(clave, valor) {
    return clave === 'papeles' || clave === 'documentos' ? undefined : valor;
}

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

        // Afectados elegidos del listado: llegan con su identificador, que tiene que
        // ser de la empresa.
        const idsAfectados = (Array.isArray(body.afectados) ? body.afectados : [])
            .map((a) => a?.personaId).filter(Boolean);
        if (idsAfectados.length && !await personasDeLaEmpresa(idsAfectados, sesion)) {
            return jsonResponse({ success: false, error: 'Persona no encontrada' }, 404);
        }

        // Gobernanza de hallazgos: responsable, plazo y verificacion de cierre.
        if (clasificacion === 'hallazgo') {
            // El responsable lo nombra quien reporta, pero tiene que ser de la empresa.
            if (body.responsableId && !await personaDeLaEmpresa(body.responsableId, sesion)) {
                return jsonResponse({ success: false, error: 'Persona no encontrada' }, 404);
            }
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
        const { items: todos } = await incidentsRepo.list({ tenantId, obraId, tipo, estado, fechaInicio, fechaFin });
        const items = veHistorial(ses.sesion) ? todos : todos.filter((i) => i.reportadoPor === ses.sesion.personaId);

        // Return in format expected by frontend: data is the array, total is top-level
        return jsonResponse({
            success: true,
            data: items,
            total: items.length
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
        // El mismo 404 que si no existiera: sin permiso, ni saber que está.
        if (!puedeLeer(await incidenteDelTenant(request.params.id, ses.sesion), ses.sesion)) return noEncontrado();
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

// Topes de evidencia: los mismos para quien reporta y para quien gestiona. Diez
// por envío cubre una ráfaga de fotos en terreno; veinte en total evita que un
// incidente se vuelva un depósito de archivos.
const MAX_EVIDENCIAS_POR_ENVIO = 10;
const MAX_EVIDENCIAS_TOTAL = 20;
// Lo que arma `uploadEvidence` después del prefijo: `{uuid}.{extensión}`. Deja
// fuera los documentos del caso (`diat-{uuid}.pdf`), que no son evidencia, y
// cualquier intento de salir del prefijo con `/` o `..`.
const NOMBRE_EVIDENCIA = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[^/\\]{1,40}$/i;

/**
 * Adjunta fotos a un incidente (fase 1 del rediseño, hueco 1).
 *
 * El formulario creaba el reporte y adjuntaba las fotos con `PUT /incidents/{id}`,
 * que exige `incidentes.reportar`. Un trabajador que reporta un hallazgo no lo
 * tiene: recibía 403, las fotos quedaban subidas a S3 pero fuera del reporte, y
 * la pantalla decía "reportado correctamente". Abrir el `PUT` a quien reportó le
 * habría dado también el estado, las investigaciones y los documentos; esta ruta
 * solo AGREGA claves de evidencia, y solo de este incidente y esta empresa.
 */
async function agregarEvidencias(request) {
    try {
        const ses = sesionDe(request);
        if (!ses.ok) return ses.respuesta;
        const sesion = ses.sesion;
        const incidente = await incidenteDelTenant(request.params.id, sesion);
        const rechazo = rechazoParaEvidencia(incidente, sesion);
        if (rechazo) return rechazo;

        const body = parseBody(request.event);
        const claves = Array.isArray(body.evidencias) ? [...new Set(body.evidencias)] : [];
        if (claves.length === 0) {
            return jsonResponse({ success: false, error: 'Faltan las claves de evidencia' }, 400);
        }
        if (claves.length > MAX_EVIDENCIAS_POR_ENVIO) {
            return jsonResponse({ success: false, error: `Máximo ${MAX_EVIDENCIAS_POR_ENVIO} archivos por envío` }, 400);
        }
        // La clave tiene que ser de ESTA empresa y de ESTE incidente: con la clave
        // de otro se le daría a quien reporta una URL firmada de un archivo ajeno
        // (`get` firma todo lo que haya en `evidencias`).
        const prefijo = `tenants/${sesion.tenantId}/incidentes/${incidente.incidentId}/`;
        const valida = (c) => typeof c === 'string' && c.startsWith(prefijo) && NOMBRE_EVIDENCIA.test(c.slice(prefijo.length));
        if (!claves.every(valida)) {
            return jsonResponse({ success: false, error: 'Clave de evidencia inválida para este incidente' }, 400);
        }

        const previas = Array.isArray(incidente.evidencias) ? incidente.evidencias : [];
        const nuevas = claves.filter((c) => !previas.includes(c));
        if (previas.length + nuevas.length > MAX_EVIDENCIAS_TOTAL) {
            return jsonResponse({ success: false, error: `El caso admite hasta ${MAX_EVIDENCIAS_TOTAL} archivos de evidencia` }, 400);
        }
        const result = await incidentsRepo.agregarEvidencias(incidente.incidentId, nuevas, incidente.updatedAt);
        return jsonResponse({ success: true, data: { evidencias: result.evidencias } });
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
        // Con id, la subida va a la carpeta de ese incidente: solo para quien
        // puede adjuntarle evidencia (la misma regla que al adjuntar). Sin id se
        // sube al prefijo temporal `sin-incidente`, que no expone nada de nadie y
        // que `agregarEvidencias` no acepta; el formulario actual siempre manda
        // el id, porque sube las fotos después de crear el reporte.
        if (body.incidentId !== undefined && body.incidentId !== null && body.incidentId !== '') {
            if (typeof body.incidentId !== 'string') {
                return jsonResponse({ success: false, error: 'incidentId inválido' }, 400);
            }
            const rechazo = rechazoParaEvidencia(await incidenteDelTenant(body.incidentId, ses.sesion), ses.sesion);
            if (rechazo) return rechazo;
        }
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
        // Quién verifica y cuándo no lo dice el cliente: el repositorio no los
        // acepta del cuerpo. Antes solo se pisaba `verificadoPor` al cerrar; con
        // cualquier otro estado se guardaba el del cuerpo tal cual.
        if (body.responsableId && !await personaDeLaEmpresa(body.responsableId, ses.sesion)) {
            return jsonResponse({ success: false, error: 'Persona no encontrada' }, 404);
        }
        const result = await incidentsRepo.updateGobernanza(request.params.id, body, {
            verificadoPor: body.estadoCierre === 'cerrado' ? ses.sesion.personaId : null,
        });
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

// ─── Papeles del caso (fase 2 del rediseño) ──────────────────────────────────
//
// Subir exige `incidentes.reportar` (quien gestiona incidentes); ver y descargar,
// `incidentes.historial`. Lo que no puede leer ni sabe que existe: el mismo 404
// que `get`. Lo que puede leer pero no gestionar: 403.

/** Rechazo para quien quiere subir un papel al caso, o null si puede. */
const rechazoParaSubirPapel = (incidente, sesion) => {
    if (!puedeLeer(incidente, sesion)) return noEncontrado();
    if (!sesionPuede(sesion, PERMISSIONS.INCIDENTES_REPORTAR)) {
        return sinPermiso('Solo quien gestiona incidentes puede subir papeles al caso.');
    }
    return null;
};

const cantidadDePapeles = (incidente) => (Array.isArray(incidente.papeles) ? incidente.papeles.length : 0);
const SIN_CUPO = `El caso admite hasta ${MAX_PAPELES_POR_CASO} archivos.`;

// Lo que arma `pedirSubidaPapel` después del prefijo: `{tipo}-{uuid}.{extensión}`.
// Las fotos (`{uuid}.{ext}`, sin el segmento `papeles/`) no pasan por acá, y los
// papeles no pasan por `NOMBRE_EVIDENCIA`: cada clave pertenece a un solo flujo.
const NOMBRE_PAPEL = new RegExp(
    `^(${ORDEN_TIPOS_PAPEL.join('|')})-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\\.(pdf|jpg|png|webp)$`, 'i'
);

/** Nombre para mostrar: sin separadores de ruta ni caracteres de control, de hasta 150 caracteres. */
const nombreVisible = (valor) => String(valor ?? '').replace(/[\u0000-\u001f\u007f]/g, '').replace(/[\\/]/g, '_').trim().slice(0, 150);

/** AAAA-MM-DD de un día real que no sea futuro (con un día de margen por la zona horaria). */
const fechaDocumentoValida = (valor) => {
    if (typeof valor !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(valor)) return false;
    const d = new Date(`${valor}T00:00:00Z`);
    if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== valor) return false;
    return d.getTime() <= Date.now() + 24 * 60 * 60 * 1000;
};

/** El papel tal como se le muestra a quien lo subió: sin la clave de S3 ni la huella. */
const papelVisible = ({ s3Key, huella, ...resto }) => resto;

// Paso 1: URL de subida prefirmada. No registra nada en el incidente.
async function pedirSubidaDocumento(request) {
    try {
        const ses = sesionDe(request);
        if (!ses.ok) return ses.respuesta;
        const sesion = ses.sesion;
        const incidente = await incidenteDelTenant(request.params.id, sesion);
        const rechazo = rechazoParaSubirPapel(incidente, sesion);
        if (rechazo) return rechazo;

        const body = parseBody(request.event);
        if (!esTipoPapel(body.tipo)) {
            return jsonResponse({ success: false, error: `Tipo de documento inválido. Valores válidos: ${ORDEN_TIPOS_PAPEL.join(', ')}` }, 400);
        }
        if (!MIME_PAPELES.includes(body.fileType)) {
            return jsonResponse({ success: false, error: 'Solo se aceptan archivos PDF o imágenes (JPG, PNG o WebP).' }, 400);
        }
        // El tamaño lo declara el cliente y no se firma en la URL: es una barrera
        // para quien se equivoca. Lo que S3 recibió se mide de nuevo al confirmar.
        if (body.tamano !== undefined && (!Number.isFinite(body.tamano) || body.tamano <= 0 || body.tamano > MAX_BYTES_PAPEL)) {
            return jsonResponse({ success: false, error: `El archivo debe pesar hasta ${Math.round(MAX_BYTES_PAPEL / (1024 * 1024))} MB.` }, 413);
        }
        if (cantidadDePapeles(incidente) >= MAX_PAPELES_POR_CASO) {
            return jsonResponse({ success: false, error: SIN_CUPO }, 400);
        }
        const result = await incidentsRepo.pedirSubidaPapel({
            incidentId: incidente.incidentId,
            tenantId: sesion.tenantId,
            tipo: body.tipo,
            fileType: body.fileType,
            checksumSha256: body.checksumSha256,
        });
        return jsonResponse({ success: true, data: { ...result, tipo: body.tipo } });
    } catch (err) {
        return errorResponse(err);
    }
}

// Paso 2: confirmar la subida. Con HeadObject se comprueba que el archivo existe
// y recién ahí se registra; sin esto no hay registro.
async function confirmarDocumento(request) {
    try {
        const ses = sesionDe(request);
        if (!ses.ok) return ses.respuesta;
        const sesion = ses.sesion;
        const incidente = await incidenteDelTenant(request.params.id, sesion);
        const rechazo = rechazoParaSubirPapel(incidente, sesion);
        if (rechazo) return rechazo;

        const body = parseBody(request.event);
        // La clave tiene que ser de ESTA empresa, de ESTE incidente y de la carpeta
        // de papeles: de otra forma se registraría como papel un archivo ajeno (o
        // una foto) y `get` firmaría su descarga.
        const prefijo = incidentsRepo.prefijoPapeles(sesion.tenantId, incidente.incidentId);
        const s3Key = body.s3Key;
        const partes = typeof s3Key === 'string' && s3Key.startsWith(prefijo) ? NOMBRE_PAPEL.exec(s3Key.slice(prefijo.length)) : null;
        if (!partes) {
            return jsonResponse({ success: false, error: 'Clave de documento inválida para este incidente' }, 400);
        }
        const nombreArchivo = nombreVisible(body.fileName);
        if (!nombreArchivo) {
            return jsonResponse({ success: false, error: 'Falta el nombre del archivo' }, 400);
        }
        if (body.fechaDocumento !== undefined && body.fechaDocumento !== null && body.fechaDocumento !== '' && !fechaDocumentoValida(body.fechaDocumento)) {
            return jsonResponse({ success: false, error: 'La fecha del documento debe ser un día válido (AAAA-MM-DD) que no sea futuro.' }, 400);
        }
        const yaEsta = Array.isArray(incidente.papeles) && incidente.papeles.some((x) => x.s3Key === s3Key);
        if (!yaEsta && cantidadDePapeles(incidente) >= MAX_PAPELES_POR_CASO) {
            return jsonResponse({ success: false, error: SIN_CUPO }, 400);
        }

        const { papel, yaRegistrado } = await incidentsRepo.registrarPapel(incidente, {
            s3Key,
            tipo: partes[1].toLowerCase(),
            papelId: partes[2].toLowerCase(),
            nombreArchivo,
            fechaDocumento: body.fechaDocumento || null,
            personaId: sesion.personaId,
        });
        return jsonResponse({ success: true, data: { papel: papelVisible(papel) } }, yaRegistrado ? 200 : 201);
    } catch (err) {
        return errorResponse(err);
    }
}

// Lista de papeles con enlace de descarga firmado (15 minutos) y lo que el caso
// exige. La DIAT y la DIEP traen datos de salud: su entrega queda en la
// auditoría de acceso a datos de salud, y si el registro no se puede escribir la
// respuesta no sale (`conAuditoriaSalud`, en `incidentsHandler`).
async function getDocuments(request) {
    try {
        const ses = sesionDe(request);
        if (!ses.ok) return ses.respuesta;
        const sesion = ses.sesion;
        const incidente = await incidenteDelTenant(request.params.id, sesion);
        if (!puedeLeer(incidente, sesion)) return noEncontrado();
        // Quien reportó el caso lo ve, pero sus papeles son del historial.
        if (!veHistorial(sesion)) return sinPermiso('No tienes permiso para ver los papeles del caso.');

        const { archivos, clavesConSalud } = await incidentsRepo.getDocuments(incidente);
        if (clavesConSalud.length) {
            anotarAccesoSalud({ tipo: TIPOS_ACCESO_SALUD.DESCARGA, documentos: [incidente.incidentId], claves: clavesConSalud });
        }
        return jsonResponse({
            success: true,
            data: { archivos, requeridos: papelesRequeridos(incidente), avance: avanceDelCaso(incidente) },
        });
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
// Toda salida, venga de la rama que venga (router, OPTIONS, conversión de
// Response, error 500), sale con `Cache-Control: no-store` (lib/utils/response.js).
// `conAuditoriaSalud` envuelve todo el enrutador: la única ruta que entrega datos
// de salud es la de papeles, y es la que anota el acceso.
module.exports.incidentsHandler = async (event) => sinCache(await conAuditoriaSalud(atender)(event));

const atender = async (event) => {
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
