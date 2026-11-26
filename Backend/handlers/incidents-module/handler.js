const { Router } = require('itty-router');
const { sinCache } = require('../../lib/utils/response');
const { IncidentsRepository } = require('./incidents.repository');
const { PERMISSIONS, personaPuede } = require('../../lib/permissions');
const { tenantParaPermisosEstricto } = require('../../lib/auth/permisos-empresa');
const { verificarEntrega } = require('../../lib/huellaArchivo');
const { conSesion, sesionPuede } = require('../../lib/auth/sesion');
const { conNeutro } = require('../../lib/degradacion');
const { personaDeLaEmpresa, personasDeLaEmpresa, obraDeLaEmpresa } = require('../../lib/auth/pertenencia');
const { fechaHoraChile } = require('../../lib/utils/fechaChile');
const { cortar } = require('../../lib/utils/texto');
const { conAuditoriaSalud, anotarAccesoSalud, TIPOS: TIPOS_ACCESO_SALUD } = require('../../lib/gobernanza/auditoriaSalud');
const {
    ORDEN_TIPOS_PAPEL, esTipoPapel, tipoPapelConSalud, papelesDelCaso, MIME_PAPELES, MAX_BYTES_PAPEL, MAX_PAPELES_POR_CASO, admiteOtroPapel, MAX_MOTIVO_ANULACION, PAPEL_INFORME_FIRMADO,
    papelesRequeridos, avanceDelCaso,
    PERMISO_CLASIFICAR, PERMISO_GESTIONAR,
    medidaTerminada, estaCerrado, pendientesDeCierre, siguientePaso,
    TIPOS_HALLAZGO, TIPOS_INCIDENTE, GRAVEDADES, clasificacionDelTipo, esHallazgo,
    MAX_COMENTARIO_CIERRE, MAX_MOTIVO_REAPERTURA, MAX_EVIDENCIAS_POR_ENVIO, MAX_EVIDENCIAS_TOTAL, MIME_FOTOS, EXTENSION_POR_MIME_FOTO,
} = require('../../lib/casos');
const { resumenDelCaso, evaluarCierre } = require('../../lib/casos-servidor');

const incidentsRepo = new IncidentsRepository();
const router = Router();

/** Todos los tipos de caso que existen: los dos de hallazgo y los dos de incidente. */
const TIPOS_CLASIFICABLES = [...TIPOS_HALLAZGO, ...TIPOS_INCIDENTE];

// ─── Taxonomia reunion 2026-06-10: hallazgos vs incidentes ───────────────────
// Hallazgos: reportables por cualquier trabajador, con marco de gobernanza.
// Incidentes/accidentes: creacion restringida a quien tenga 'incidentes.reportar'.
// Los tipos, las gravedades y los topes son de `lib/casos.js`, como en las pantallas.

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

/**
 * Rechazo para quien quiere gestionar un caso con `permiso`, o null si puede.
 * Lo que no puede leer ni sabe que existe: el mismo 404 que `get`. Lo que puede
 * leer pero no gestionar: 403. Sirve para clasificar, cerrar, reabrir y subir papeles.
 */
const rechazoParaGestionar = (incidente, sesion, permiso, mensaje) => {
    if (!puedeLeer(incidente, sesion)) return noEncontrado();
    if (!sesionPuede(sesion, permiso)) return sinPermiso(mensaje);
    return null;
};

/**
 * Un caso cerrado no acepta cambios (clasificación, papeles,
 * fotos, investigaciones, gobernanza): el cierre es lo que se mostraría ante una
 * fiscalización, y no puede moverse por una ruta lateral. Para volver a trabajarlo
 * está `PUT /incidents/{id}/reabrir`, que exige un motivo y queda registrado.
 * Devuelve el 409, o null si el caso está abierto.
 */
const rechazoSiCerrado = (incidente) => (estaCerrado(incidente)
    ? jsonResponse({ success: false, error: 'El caso está cerrado y no admite cambios. Reábrelo con un motivo si hay que corregirlo.' }, 409)
    : null);

/** 409 con lo que falta para cerrar, en frases listas para mostrar tal cual. */
const respuestaPendientes = (pendientes) => jsonResponse({
    success: false,
    error: `Todavía no se puede cerrar el caso. ${pendientes.join(' ')}`,
    pendientes,
}, 409);

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
    // Antes de `/incidents/:id`, o `casos-resumen` se leería como un id.
    .get('/incidents/casos-resumen', getCasosResumen)
    .post('/incidents/upload-evidence', uploadEvidence)
    .get('/incidents/:id', get)
    .put('/incidents/:id', update)
    .post('/incidents/:id/evidencias', agregarEvidencias)
    .put('/incidents/:id/calificar-accidente', calificarAccidente)
    .post('/incidents/:id/viewed', markViewed)
    .post('/incidents/:id/investigations', addInvestigation)
    .put('/incidents/:id/gobernanza', updateGobernanza)
    .put('/incidents/:id/flash-completar', completarFlash)
    .put('/incidents/:id/medidas/:numero', updateMedidaEstado)
    // Clasificación y cierre del caso (fase 3).
    .put('/incidents/:id/triaje', clasificar)
    .put('/incidents/:id/cerrar', cerrar)
    .put('/incidents/:id/reabrir', reabrir)
    // Papeles del caso (fase 2): subir en dos pasos y listar con descarga firmada.
    .post('/incidents/:id/documents', pedirSubidaDocumento)
    .post('/incidents/:id/documents/confirmar', confirmarDocumento)
    .get('/incidents/:id/documents', getDocuments)
    .get('/incidents/:id/documents/:papelId/enlace', getEnlacePapel)
    .put('/incidents/:id/documents/:papelId/anular', anularPapel);

router.all('*', () => jsonResponse({ error: 'Not Found' }, 404));

// Helper to parse body securely
const parseBody = (event) => {
    try {
        return event.body ? JSON.parse(event.body) : {};
    } catch {
        return {};
    }
};

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
        // Las fotos se adjuntan después con `POST /incidents/{id}/evidencias`, que
        // valida cada clave. Las que vengan acá no se guardan: con una clave de otra
        // empresa, `get` firmaría la descarga de un archivo ajeno.
        delete body.evidencias;
        // Las medidas correctivas ya no son datos del caso (se definen subiendo el plan de medidas)
        // y la gobernanza la arma este handler para los hallazgos: lo que llegue en la creación
        // no se guarda, ni en un hallazgo ni en un incidente.
        delete body.medidasCorrectivas;
        delete body.gobernanza;

        // La clasificación sale SIEMPRE del tipo, nunca del cliente. Antes valía la que
        // viniera en el cuerpo, y las validaciones (y el permiso de abajo) solo corrían si
        // era exactamente 'hallazgo' o 'incidente': con `clasificacion: 'x'` y
        // `tipo: 'accidente'` se creaba un accidente sin tener `incidentes.reportar`.
        if (!body.tipo) return solicitudInvalida('El tipo de reporte es requerido');
        if (!TIPOS_CLASIFICABLES.includes(body.tipo)) {
            return solicitudInvalida(`Tipo inválido. Tipos válidos: ${TIPOS_CLASIFICABLES.join(', ')}`);
        }
        const clasificacion = clasificacionDelTipo(body.tipo);
        // Si el cliente manda una clasificación, tiene que decir lo mismo que el tipo.
        if (body.clasificacion !== undefined && body.clasificacion !== clasificacion) {
            return solicitudInvalida(`La clasificación no corresponde al tipo: un ${body.tipo} es de clasificación "${clasificacion}".`);
        }
        body.clasificacion = clasificacion;
        if (body.gravedad !== undefined && !GRAVEDADES.includes(body.gravedad)) {
            return solicitudInvalida(`Gravedad inválida. Valores válidos: ${GRAVEDADES.join(', ')}`);
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
            // El responsable lo nombra quien reporta, con la misma validación que al
            // clasificar o gestionar el hallazgo: persona activa de la empresa, con el
            // nombre de su ficha, y un plazo que sea un día real.
            const rp = await responsableYPlazo(body.responsableId, body.plazoRespuestaISO, sesion);
            if (rp.respuesta) return rp.respuesta;
            body.gobernanza = {
                responsableId: rp.datos.responsableId || null,
                responsableNombre: rp.datos.responsableNombre || null,
                plazoRespuestaISO: rp.datos.plazoRespuestaISO || null,
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
                descripcionBreve: cortar(body.descripcionBreve || '', 500),
                severidad: body.gravedad || 'leve',
                evidencias: [],
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

        const result = await incidentsRepo.create(body, request.event, { personaIdDeSesion: sesion.personaId });
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
        const item = await incidenteDelTenant(request.params.id, ses.sesion);
        if (!puedeLeer(item, ses.sesion)) return noEncontrado();
        // La ficha completa se arma con el elemento ya leído: una sola lectura, y la
        // traza (con su descifrado) solo acá, donde se entrega.
        const result = await incidentsRepo.get(request.params.id, item);
        // El siguiente paso se calcula acá, con los papeles reales: el cliente no los
        // recibe (`sinPapeles`) y no podría calcularlo él.
        return jsonResponse({ ...result, siguientePaso: siguientePaso(result), avance: avanceDelCaso(result) });
    } catch (err) {
        return errorResponse(err);
    }
}

async function markViewed(request) {
    try {
        const ses = sesionDe(request);
        if (!ses.ok) return ses.respuesta;
        // Quien no puede leer el caso tampoco lo marca como visto: el mismo 404 que `get`.
        const incidente = await incidenteDelTenant(request.params.id, ses.sesion);
        if (!puedeLeer(incidente, ses.sesion)) return noEncontrado();
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
        const incidente = await incidenteDelTenant(request.params.id, ses.sesion);
        const rechazo = rechazoParaGestionar(incidente, ses.sesion, PERMISO_GESTIONAR, 'No tienes permiso para editar incidentes.');
        if (rechazo) return rechazo;
        const cerrado = rechazoSiCerrado(incidente);
        if (cerrado) return cerrado;
        const body = parseBody(request.event);
        // Las fotos se agregan con `POST /incidents/{id}/evidencias`, que valida cada
        // clave (de esta empresa, de este incidente, con su forma y sus topes) y solo
        // agrega. Por acá la lista se reemplazaba entera y sin mirar las claves: con la
        // de otra empresa, `get` firmaría la descarga de un archivo ajeno. Nada en la
        // interfaz usa este campo; si llega, se avisa en vez de callarlo.
        if (body.evidencias !== undefined) {
            return jsonResponse({ success: false, error: 'Las fotos no se editan por acá: agrégalas con POST /incidents/{id}/evidencias.' }, 400);
        }
        // El tipo y la clasificación tampoco se cambian por acá: con solo `incidentes.reportar`
        // se podía volver un accidente grave en incidente o en hallazgo, con lo que
        // desaparecían los papeles que exige y el triaje quedaba diciendo otra cosa.
        // Clasificar es de quien tiene `incidentes.calificar_accidente`, y deja la
        // clasificación anterior en el historial.
        if (body.tipo !== undefined || body.clasificacion !== undefined) {
            return jsonResponse({ success: false, error: 'El tipo y la clasificación no se editan por acá: usa la clasificación del caso (PUT /incidents/{id}/triaje).' }, 400);
        }
        // El cierre tiene sus reglas (clasificado y papeles completos, con
        // comentario): por acá no se cierra.
        if (body.estado === 'cerrado') {
            return jsonResponse({ success: false, error: 'Para cerrar el caso usa el cierre del caso: exige papeles completos.' }, 400);
        }
        // El estado tampoco se edita por acá: cambia solo al clasificar (pasa a investigación),
        // al cerrar y al reabrir, que dejan quién y cuándo. Ninguna pantalla lo manda.
        if (body.estado !== undefined) {
            return solicitudInvalida('El estado no se edita por acá: cambia al clasificar, cerrar o reabrir el caso.');
        }
        // `tenantId` no se reasigna por esta vía: mover un incidente de empresa no
        // es una edición, es una fuga.
        delete body.tenantId;
        // Con el elemento ya leído: la escritura falla con 409 si el caso cambió desde esta lectura.
        const result = await incidentsRepo.update(incidente, body);
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

// Topes de evidencia (`MAX_EVIDENCIAS_POR_ENVIO` y `MAX_EVIDENCIAS_TOTAL`, de lib/casos):
// los mismos para quien reporta y para quien gestiona.
// Lo que arma `uploadEvidence` después del prefijo: `{uuid}.{extensión}` (la extensión sale
// del tipo de imagen, ver `EXTENSION_POR_MIME_FOTO`). Deja
// fuera los documentos del caso (`diat-{uuid}.pdf`), que no son evidencia, y
// cualquier intento de salir del prefijo con `/` o `..`.
const NOMBRE_EVIDENCIA = new RegExp(
    `^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.(${Object.values(EXTENSION_POR_MIME_FOTO).join('|')})$`, 'i'
);

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
        const cerrado = rechazoSiCerrado(incidente);
        if (cerrado) return cerrado;

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
        const result = await incidentsRepo.agregarEvidencias(incidente, nuevas);
        return jsonResponse({ success: true, data: { evidencias: result.evidencias } });
    } catch (err) {
        return errorResponse(err);
    }
}

async function calificarAccidente(request) {
    try {
        const ses = sesionDe(request);
        if (!ses.ok) return ses.respuesta;
        const incidente = await incidenteDelTenant(request.params.id, ses.sesion);
        const rechazo = rechazoParaGestionar(incidente, ses.sesion, PERMISSIONS.INCIDENTES_CALIFICAR_ACCIDENTE, 'No tienes permiso para calificar como accidente.');
        if (rechazo) return rechazo;
        const cerrado = rechazoSiCerrado(incidente);
        if (cerrado) return cerrado;
        // Si el prevencionista ya clasificó el caso, la clasificación guardada
        // (`triaje`) tiene que decir lo mismo que `tipo`: lo que leen los papeles y el
        // cierre sale de los dos, y con un `triaje` que dice "incidente" sobre un caso
        // que ahora es accidente la pantalla mostraría una cosa y exigiría otra. Se
        // reclasifica por la misma vía de `PUT /incidents/{id}/triaje`, que deja la
        // clasificación anterior en el historial. Un caso sin clasificar sigue como
        // siempre: solo cambia el tipo.
        if (incidente.triaje && incidente.triaje.tipo !== 'accidente') {
            const incident = await incidentsRepo.clasificar(incidente, {
                tipo: 'accidente',
                gravedad: GRAVEDADES.includes(incidente.gravedad) ? incidente.gravedad : 'leve',
            }, ses.sesion.personaId);
            return jsonResponse({ success: true, data: incident, message: 'Calificado como accidente.' });
        }
        const result = await incidentsRepo.update(incidente, {
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
        // La subida va a la carpeta de un incidente, y solo para quien puede
        // adjuntarle evidencia (la misma regla que al adjuntar). Sin id se firmaba una
        // subida a `incidentes/sin-incidente/`, en el bucket que no deja borrar durante
        // 5 años, que `agregarEvidencias` nunca acepta: un archivo sin dueño guardado
        // años. Todo el flujo (formulario y detalle) sube después de crear el reporte, así
        // que siempre tiene id.
        if (typeof body.incidentId !== 'string' || !body.incidentId) {
            return solicitudInvalida('incidentId es requerido.');
        }
        const incidente = await incidenteDelTenant(body.incidentId, ses.sesion);
        const rechazo = rechazoParaEvidencia(incidente, ses.sesion);
        if (rechazo) return rechazo;
        // En un caso cerrado no se agregan fotos: firmar la subida dejaría el archivo
        // huérfano en el bucket.
        const cerrado = rechazoSiCerrado(incidente);
        if (cerrado) return cerrado;
        // Solo imágenes: lo que se firma queda 5 años en el bucket de evidencia.
        if (!MIME_FOTOS.includes(body.fileType)) {
            return solicitudInvalida('Solo se aceptan fotos (JPG, PNG, WebP o HEIC).');
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
        const incidente = await incidenteDelTenant(request.params.id, ses.sesion);
        const rechazo = rechazoParaGestionar(incidente, ses.sesion, PERMISO_GESTIONAR, 'No tienes permiso para registrar investigaciones.');
        if (rechazo) return rechazo;
        // Registrar una investigación pone el caso "en investigación": en uno cerrado lo reabriría sin motivo.
        const cerrado = rechazoSiCerrado(incidente);
        if (cerrado) return cerrado;
        const body = parseBody(request.event);
        const result = await incidentsRepo.addInvestigation(incidente, body);
        return jsonResponse(result);
    } catch (err) {
        return errorResponse(err);
    }
}

async function updateGobernanza(request) {
    try {
        const ses = sesionDe(request);
        if (!ses.ok) return ses.respuesta;
        const sesion = ses.sesion;
        const incidente = await incidenteDelTenant(request.params.id, sesion);
        const rechazo = rechazoParaGestionar(incidente, sesion, PERMISO_GESTIONAR, 'Solo supervisores y roles superiores pueden gestionar la gobernanza de hallazgos.');
        if (rechazo) return rechazo;
        // Un hallazgo cerrado no se reabre ni se edita por acá (sería una puerta
        // lateral al cierre): `PUT /incidents/{id}/reabrir`.
        const cerrado = rechazoSiCerrado(incidente);
        if (cerrado) return cerrado;
        if (!esHallazgo(incidente)) return solicitudInvalida('La gobernanza solo aplica a hallazgos.');

        const body = parseBody(request.event);
        const ESTADOS = ['abierto', 'en_proceso', 'cerrado'];
        if (body.estadoCierre !== undefined && !ESTADOS.includes(body.estadoCierre)) {
            return solicitudInvalida(`Estado de cierre inválido. Válidos: ${ESTADOS.join(', ')}`);
        }
        if (body.comentarioCierre !== undefined && body.comentarioCierre !== null && typeof body.comentarioCierre !== 'string') {
            return solicitudInvalida('El comentario de cierre no es válido.');
        }
        // Responsable y plazo: la misma validación que en la creación y en la
        // clasificación. Quién verifica y cuándo no lo dice el cliente (antes se
        // guardaban los del cuerpo tal cual, salvo al cerrar), y el nombre del
        // responsable sale de su ficha.
        // Si el responsable es el que ya tiene, no se vuelve a validar: la pantalla manda el
        // formulario completo en cada guardado, y quien quedó inactivo después de asignado
        // no puede impedir editar el resto.
        const rp = await responsableYPlazo(
            body.responsableId === incidente.gobernanza?.responsableId ? undefined : body.responsableId,
            body.plazoRespuestaISO,
            sesion
        );
        if (rp.respuesta) return rp.respuesta;

        // Cerrar un hallazgo por acá es cerrar el caso: exige el mismo permiso que
        // `PUT /incidents/{id}/cerrar` (incidentes.calificar_accidente) y pasa por la misma
        // función de cierre, que deja `cierre` (quién, cuándo, comentario). Antes bastaba
        // `incidentes.reportar`, y el cierre quedaba sin `cierre`: una reapertura guardaba
        // `cierreAnterior: null`. Lo demás de la gobernanza sigue con `incidentes.reportar`.
        if (body.estadoCierre === 'cerrado') {
            if (!sesionPuede(sesion, PERMISO_CLASIFICAR)) {
                return sinPermiso('Solo quien clasifica incidentes puede cerrar el caso.');
            }
            // El comentario, el responsable y el plazo que vienen en esta petición cuentan:
            // se guardan junto con el cierre.
            const propuesta = { ...incidente, gobernanza: { ...(incidente.gobernanza || {}), ...rp.datos } };
            if (body.comentarioCierre !== undefined) propuesta.gobernanza.comentarioCierre = body.comentarioCierre;
            const comentario = typeof propuesta.gobernanza.comentarioCierre === 'string' ? propuesta.gobernanza.comentarioCierre.trim() : '';
            const pendientes = pendientesDeCierre(propuesta, comentario);
            if (pendientes.length > 0) return respuestaPendientes(pendientes);
            if (comentario.length > MAX_COMENTARIO_CIERRE) {
                return solicitudInvalida(`El comentario de cierre admite hasta ${MAX_COMENTARIO_CIERRE} caracteres.`);
            }
            const incident = await incidentsRepo.cerrar(incidente, comentario, sesion.personaId, rp.datos);
            return jsonResponse({ success: true, data: { incident, gobernanza: incident.gobernanza } });
        }

        const cambios = { ...rp.datos };
        if (body.estadoCierre !== undefined) cambios.estadoCierre = body.estadoCierre;
        if (body.comentarioCierre !== undefined) {
            const comentario = body.comentarioCierre === null ? null : body.comentarioCierre.trim();
            if (comentario && comentario.length > MAX_COMENTARIO_CIERRE) {
                return solicitudInvalida(`El comentario de cierre admite hasta ${MAX_COMENTARIO_CIERRE} caracteres.`);
            }
            cambios.comentarioCierre = comentario || null;
        }
        const result = await incidentsRepo.updateGobernanza(incidente, cambios);
        return jsonResponse(result);
    } catch (err) {
        return errorResponse(err);
    }
}

const esObjeto = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const MAX_AFECTADOS_FLASH = 50;

/**
 * Valida lo que trae `flash-completar` y deja solo los campos que la ruta sabe escribir.
 * La gravedad se valida contra `GRAVEDADES`; y si el caso ya está clasificado (`triaje`),
 * la gravedad es de la clasificación: por acá no se cambia (antes esta ruta la pisaba por
 * fuera de ella, y el caso quedaba diciendo dos cosas). Devuelve `{ error }` o `{ datos }`.
 */
const validarCompletarFlash = (body, incidente) => {
    const datos = {};
    if (body.gravedad !== undefined) {
        if (!GRAVEDADES.includes(body.gravedad)) return { error: `Gravedad inválida. Valores válidos: ${GRAVEDADES.join(', ')}` };
        if (incidente.triaje) {
            if (body.gravedad !== incidente.gravedad) {
                return { error: 'La gravedad ya la fijó la clasificación del caso: para cambiarla reclasifícalo (PUT /incidents/{id}/triaje).' };
            }
        } else {
            datos.gravedad = body.gravedad;
        }
    }
    for (const campo of ['descripcion', 'descripcionBreve', 'ubicacionReferencia']) {
        if (body[campo] === undefined) continue;
        if (typeof body[campo] !== 'string') return { error: `El campo ${campo} no es válido.` };
        datos[campo] = body[campo];
    }
    if (body.diasPerdidos !== undefined) {
        if (!Number.isInteger(body.diasPerdidos) || body.diasPerdidos < 0) return { error: 'Los días perdidos deben ser un número entero, cero o más.' };
        datos.diasPerdidos = body.diasPerdidos;
    }
    if (body.afectados !== undefined) {
        if (!Array.isArray(body.afectados) || body.afectados.length > MAX_AFECTADOS_FLASH || !body.afectados.every(esObjeto)) {
            return { error: `Los afectados no son válidos (hasta ${MAX_AFECTADOS_FLASH}).` };
        }
        datos.afectados = body.afectados;
    }
    if (body.trabajador !== undefined) {
        if (!esObjeto(body.trabajador)) return { error: 'El trabajador no es válido.' };
        const texto = (v) => (typeof v === 'string' ? v : '');
        datos.trabajador = {
            nombre: texto(body.trabajador.nombre), rut: texto(body.trabajador.rut),
            genero: texto(body.trabajador.genero), cargo: texto(body.trabajador.cargo),
        };
    }
    return { datos };
};

async function completarFlash(request) {
    try {
        const ses = sesionDe(request);
        if (!ses.ok) return ses.respuesta;
        const incidente = await incidenteDelTenant(request.params.id, ses.sesion);
        const rechazo = rechazoParaGestionar(incidente, ses.sesion, PERMISO_GESTIONAR, 'Solo supervisores y roles superiores pueden completar el reporte flash.');
        if (rechazo) return rechazo;
        const cerrado = rechazoSiCerrado(incidente);
        if (cerrado) return cerrado;
        const validado = validarCompletarFlash(parseBody(request.event), incidente);
        if (validado.error) return solicitudInvalida(validado.error);
        // Con el elemento ya leído: la escritura falla con 409 si el caso cambió desde esta lectura.
        const result = await incidentsRepo.completarFlash(incidente, validado.datos);
        return jsonResponse(result);
    } catch (err) {
        return errorResponse(err);
    }
}

async function updateMedidaEstado(request) {
    try {
        const ses = sesionDe(request);
        if (!ses.ok) return ses.respuesta;
        const incidente = await incidenteDelTenant(request.params.id, ses.sesion);
        const rechazo = rechazoParaGestionar(incidente, ses.sesion, PERMISO_GESTIONAR, 'No tienes permiso para actualizar las medidas correctivas.');
        if (rechazo) return rechazo;
        const body = parseBody(request.event);
        // En un caso cerrado solo se puede seguir confirmando lo hecho (completada ->
        // verificada); devolver una medida a pendiente dejaría un cierre falso.
        if (estaCerrado(incidente) && !medidaTerminada({ estado: body.estado })) {
            return jsonResponse({ success: false, error: 'El caso está cerrado: sus medidas solo pueden quedar completadas o verificadas.' }, 409);
        }
        // Con el elemento ya leído: la escritura falla con 409 si el caso cambió desde
        // esta lectura, en vez de pisar lo que otra persona acaba de guardar.
        const result = await incidentsRepo.updateMedidaEstado(
            incidente,
            decodeURIComponent(request.params.numero),
            body.estado
        );
        return jsonResponse(result);
    } catch (err) {
        return errorResponse(err);
    }
}

// ─── Clasificación y cierre (fase 3 del rediseño) ────────────────────────────
//
// Clasificar y cerrar son de quien tiene `incidentes.calificar_accidente` (el
// prevencionista).
// Lo que no puede leer ni sabe que existe: el mismo 404 que `get`. Lo que puede
// leer pero no gestionar: 403. Un caso cerrado no acepta nada de esto (409) salvo
// reabrirlo.

/** AAAA-MM-DD de un día real. */
const diaValido = (valor) => {
    if (typeof valor !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(valor)) return false;
    const d = new Date(`${valor}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === valor;
};
/**
 * Hoy en AAAA-MM-DD, en la hora de Chile. Lambda corre en UTC: pasadas las 21:00 de
 * Chile (20:00 en horario de invierno) el día UTC ya es el siguiente, y comparar
 * contra él aceptaba como "hoy" o "no futuro" una fecha que en Chile aún no llega.
 * Lee `Date.now()` para que las pruebas puedan fijar la hora.
 */
const hoyChile = () => fechaHoraChile(Date.now()).fecha;

/**
 * La persona responsable tiene que ser de la empresa (404 si no: el mismo mensaje
 * que para cualquier identificador ajeno) y estar ACTIVA: quien no terminó de
 * enrolarse o ya no está en la empresa no puede quedar a cargo de nada.
 */
const responsableActivo = async (personaId, sesion) => {
    const persona = await personaDeLaEmpresa(personaId, sesion);
    if (!persona) return { respuesta: jsonResponse({ success: false, error: 'Persona no encontrada' }, 404) };
    if (persona.estado !== 'activo') {
        return { respuesta: jsonResponse({ success: false, error: 'La persona responsable tiene que estar activa.' }, 400) };
    }
    return { persona, nombre: `${persona.nombre || ''} ${persona.apellido || ''}`.trim() };
};

/**
 * Responsable y plazo de un HALLAZGO, validados igual en la creación, la
 * clasificación y la gobernanza (cada ruta lo hacía a su manera: en una, un plazo que
 * no era fecha cumplía el requisito de cierre, y el nombre del responsable lo escribía
 * el cliente).
 *
 *  - Responsable: persona activa de la empresa (404 si no es de la empresa, 400 si no
 *    está activa); el nombre se lee de su ficha, nunca del cuerpo.
 *  - Plazo: un día real, AAAA-MM-DD. No se rechaza uno pasado: un hallazgo se puede
 *    asignar con el plazo ya vencido (por ejemplo, uno que se registra tarde).
 *  - `undefined` = no viene, no cambia. `null` o vacío = quitar.
 *
 * Devuelve `{ respuesta }` si hay que rechazar, o `{ datos }` con lo que cambia.
 */
const responsableYPlazo = async (responsableId, plazo, sesion) => {
    const datos = {};
    if (responsableId !== undefined) {
        if (responsableId === null || responsableId === '') {
            datos.responsableId = null;
            datos.responsableNombre = null;
        } else if (typeof responsableId !== 'string') {
            return { respuesta: solicitudInvalida('La persona responsable no es válida.') };
        } else {
            const r = await responsableActivo(responsableId, sesion);
            if (r.respuesta) return r;
            const tenantSafe = await tenantParaPermisosEstricto(sesion.tenantId);
            if (!personaPuede(r.persona, tenantSafe, PERMISSIONS.INCIDENTES_HISTORIAL)) {
                return { respuesta: solicitudInvalida('La persona responsable tiene que poder ver el historial de incidentes.') };
            }
            datos.responsableId = responsableId;
            datos.responsableNombre = r.nombre;
        }
    }
    if (plazo !== undefined) {
        if (plazo === null || plazo === '') {
            datos.plazoRespuestaISO = null;
        } else if (!diaValido(plazo)) {
            return { respuesta: solicitudInvalida('El plazo debe ser una fecha válida (AAAA-MM-DD).') };
        } else {
            datos.plazoRespuestaISO = plazo;
        }
    }
    return { datos };
};

const solicitudInvalida = (error) => jsonResponse({ success: false, error }, 400);

/**
 * Triaje: el prevencionista confirma el tipo y, en incidentes y accidentes, la
 * gravedad. Para un incidente responde las dos preguntas de la guía de Mutual
 * (`danoMayor`, `granSusto`): si alguna es sí, es de alto potencial y exige informe
 * de investigación. En un hallazgo puede además dejar quién lo corrige y en qué
 * plazo. Se puede reclasificar mientras el caso esté abierto; lo anterior queda en
 * `triaje.anteriores`.
 */
async function clasificar(request) {
    try {
        const ses = sesionDe(request);
        if (!ses.ok) return ses.respuesta;
        const sesion = ses.sesion;
        const incidente = await incidenteDelTenant(request.params.id, sesion);
        const rechazo = rechazoParaGestionar(incidente, sesion, PERMISO_CLASIFICAR, 'Solo quien clasifica incidentes puede clasificar el caso.');
        if (rechazo) return rechazo;
        const cerrado = rechazoSiCerrado(incidente);
        if (cerrado) return cerrado;

        const body = parseBody(request.event);
        if (!TIPOS_CLASIFICABLES.includes(body.tipo)) {
            return solicitudInvalida(`Tipo inválido. Valores válidos: ${TIPOS_CLASIFICABLES.join(', ')}`);
        }
        const datos = { tipo: body.tipo };
        if (TIPOS_HALLAZGO.includes(body.tipo)) {
            // La gravedad y las preguntas de alto potencial no aplican a un hallazgo: se ignoran.
            // El responsable que ya tiene no se vuelve a validar (como en la gobernanza).
            const rp = await responsableYPlazo(
                body.responsableId === incidente.gobernanza?.responsableId ? undefined : body.responsableId,
                body.plazoRespuestaISO,
                sesion
            );
            if (rp.respuesta) return rp.respuesta;
            Object.assign(datos, rp.datos);
        } else {
            if (body.gravedad !== undefined && !GRAVEDADES.includes(body.gravedad)) {
                return solicitudInvalida(`Gravedad inválida. Valores válidos: ${GRAVEDADES.join(', ')}`);
            }
            datos.gravedad = body.gravedad ?? (GRAVEDADES.includes(incidente.gravedad) ? incidente.gravedad : 'leve');
            if (body.tipo === 'incidente') {
                if (typeof body.danoMayor !== 'boolean' || typeof body.granSusto !== 'boolean') {
                    return solicitudInvalida('Responde las dos preguntas del incidente (daño mayor y gran susto) con sí o no.');
                }
                datos.danoMayor = body.danoMayor;
                datos.granSusto = body.granSusto;
            }
        }

        const incident = await incidentsRepo.clasificar(incidente, datos, sesion.personaId);
        return jsonResponse({ success: true, data: { incident, siguientePaso: siguientePaso(incident) }, message: 'Caso clasificado.' });
    } catch (err) {
        return errorResponse(err);
    }
}

/**
 * Cierra el caso. Exige el comentario de cierre, que el caso esté clasificado, que
 * los papeles estén completos (contando el comentario de esta petición, que en un
 * hallazgo es uno de ellos, y el plan de medidas correctivas de un accidente).
 * Si falta algo, 409 con la lista, en frases listas para mostrar.
 */
async function cerrar(request) {
    try {
        const ses = sesionDe(request);
        if (!ses.ok) return ses.respuesta;
        const sesion = ses.sesion;
        const incidente = await incidenteDelTenant(request.params.id, sesion);
        const rechazo = rechazoParaGestionar(incidente, sesion, PERMISO_CLASIFICAR, 'Solo quien clasifica incidentes puede cerrar el caso.');
        if (rechazo) return rechazo;
        const body = parseBody(request.event);
        const cierre = evaluarCierre(incidente, body.comentarioCierre);
        if (cierre.pendientes) return respuestaPendientes(cierre.pendientes);
        if (cierre.error) return jsonResponse({ success: false, error: cierre.error }, cierre.estado);

        const incident = await incidentsRepo.cerrar(incidente, cierre.comentario, sesion.personaId);
        return jsonResponse({ success: true, data: { incident, siguientePaso: siguientePaso(incident) }, message: 'Caso cerrado.' });
    } catch (err) {
        return errorResponse(err);
    }
}

// Reabre un caso cerrado, con un motivo obligatorio. El cierre anterior queda en `reaperturas`.
async function reabrir(request) {
    try {
        const ses = sesionDe(request);
        if (!ses.ok) return ses.respuesta;
        const sesion = ses.sesion;
        const incidente = await incidenteDelTenant(request.params.id, sesion);
        const rechazo = rechazoParaGestionar(incidente, sesion, PERMISO_CLASIFICAR, 'Solo quien clasifica incidentes puede reabrir el caso.');
        if (rechazo) return rechazo;
        if (!estaCerrado(incidente)) {
            return jsonResponse({ success: false, error: 'El caso no está cerrado.' }, 409);
        }
        const body = parseBody(request.event);
        const motivo = typeof body.motivo === 'string' ? body.motivo.trim() : '';
        if (!motivo) return solicitudInvalida('El motivo para reabrir el caso es obligatorio.');
        if (motivo.length > MAX_MOTIVO_REAPERTURA) {
            return solicitudInvalida(`El motivo admite hasta ${MAX_MOTIVO_REAPERTURA} caracteres.`);
        }
        const incident = await incidentsRepo.reabrir(incidente, motivo, sesion.personaId);
        return jsonResponse({ success: true, data: { incident, siguientePaso: siguientePaso(incident) }, message: 'Caso reabierto.' });
    } catch (err) {
        return errorResponse(err);
    }
}

// ─── Papeles del caso (fase 2 del rediseño) ──────────────────────────────────
//
// Subir exige `incidentes.reportar` (quien gestiona incidentes); ver y descargar,
// `incidentes.historial`. Lo que no puede leer ni sabe que existe: el mismo 404
// que `get`. Lo que puede leer pero no gestionar: 403 (`rechazoParaGestionar`).
//
// Subir un papel SÍ se permite en un caso cerrado, a diferencia de las fotos y la
// clasificación. Completar el respaldo documental de un caso ya cerrado
// es justo lo que pide el repositorio (por ejemplo, el informe de investigación de un
// accidente anterior al rediseño): exigir reabrirlo obligaba a deshacer un cierre
// verdadero para agregar un archivo. Los papeles solo se agregan (nada se pisa ni se
// borra), cada uno guarda quién lo subió y cuándo, y no tocan `cierre` ni el estado.
const PAPEL_SIN_PERMISO = 'Solo quien gestiona incidentes puede subir papeles al caso.';

const SIN_CUPO = `El caso admite hasta ${MAX_PAPELES_POR_CASO} archivos.`;

// Lo que arma `pedirSubidaPapel` después del prefijo: `{tipo}-{uuid}.{extensión}`.
// Las fotos (`{uuid}.{ext}`, sin el segmento `papeles/`) no pasan por acá, y los
// papeles no pasan por `NOMBRE_EVIDENCIA`: cada clave pertenece a un solo flujo.
const NOMBRE_PAPEL = new RegExp(
    `^(${ORDEN_TIPOS_PAPEL.join('|')})-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\\.(pdf|jpg|png|webp)$`, 'i'
);

/** Nombre para mostrar: sin separadores de ruta ni caracteres de control, de hasta 150 caracteres. */
// Por caracteres completos: un corte a mitad de un emoji dejaba una mitad suelta en el nombre.
const nombreVisible = (valor) => cortar(String(valor ?? '').replace(/[\u0000-\u001f\u007f]/g, '').replace(/[\\/]/g, '_').trim(), 150).trim();

/** AAAA-MM-DD de un día real que no sea futuro, según el día de hoy en Chile. */
const fechaDocumentoValida = (valor) => diaValido(valor) && valor <= hoyChile();

/** El papel tal como se le muestra a quien lo subió: sin la clave de S3 ni la huella. */
const papelVisible = ({ s3Key, huella, ...resto }) => resto;

// Paso 1: URL de subida prefirmada. No registra nada en el incidente.
async function pedirSubidaDocumento(request) {
    try {
        const ses = sesionDe(request);
        if (!ses.ok) return ses.respuesta;
        const sesion = ses.sesion;
        const incidente = await incidenteDelTenant(request.params.id, sesion);
        const rechazo = rechazoParaGestionar(incidente, sesion, PERMISO_GESTIONAR, PAPEL_SIN_PERMISO);
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
        if (!admiteOtroPapel(incidente.papeles)) {
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
        const rechazo = rechazoParaGestionar(incidente, sesion, PERMISO_GESTIONAR, PAPEL_SIN_PERMISO);
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
        if (!yaEsta && !admiteOtroPapel(incidente.papeles)) {
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

async function anularPapel(request) {
    try {
        const ses = sesionDe(request);
        if (!ses.ok) return ses.respuesta;
        const sesion = ses.sesion;
        const incidente = await incidenteDelTenant(request.params.id, sesion);
        const rechazo = rechazoParaGestionar(incidente, sesion, PERMISO_GESTIONAR, 'Solo quien gestiona incidentes puede anular papeles del caso.');
        if (rechazo) return rechazo;
        if (!veHistorial(sesion)) return sinPermiso('No tienes permiso para ver los papeles del caso.');
        if (estaCerrado(incidente)) {
            return jsonResponse({ success: false, error: 'El caso está cerrado. Reábrelo para anular un papel.' }, 409);
        }

        const papelId = decodeURIComponent(request.params.papelId);
        const papel = (Array.isArray(incidente.papeles) ? incidente.papeles : []).find((p) => p.papelId === papelId);
        if (!papel) return jsonResponse({ success: false, error: 'Papel no encontrado' }, 404);
        if (papel.anulado) return jsonResponse({ success: false, error: 'Ese papel ya está anulado.' }, 409);

        const body = parseBody(request.event);
        const motivo = typeof body.motivo === 'string' ? body.motivo.trim() : '';
        if (!motivo) return solicitudInvalida('El motivo para anular el papel es obligatorio.');
        if (motivo.length > MAX_MOTIVO_ANULACION) {
            return solicitudInvalida(`El motivo admite hasta ${MAX_MOTIVO_ANULACION} caracteres.`);
        }

        const anulado = await incidentsRepo.anularPapel(incidente, papelId, motivo, sesion.personaId);
        return jsonResponse({ success: true, data: { papel: anulado } });
    } catch (err) {
        return errorResponse(err);
    }
}

// Lista de papeles y lo que el caso exige. No entrega archivos ni enlaces: eso es
// `getEnlacePapel`, que es lo que se audita. Abrir la página del caso lista, y no es una descarga.
async function getDocuments(request) {
    try {
        const ses = sesionDe(request);
        if (!ses.ok) return ses.respuesta;
        const sesion = ses.sesion;
        const incidente = await incidenteDelTenant(request.params.id, sesion);
        if (!puedeLeer(incidente, sesion)) return noEncontrado();
        // Quien reportó el caso lo ve, pero sus papeles son del historial.
        if (!veHistorial(sesion)) return sinPermiso('No tienes permiso para ver los papeles del caso.');

        const { archivos, informeNoDisponible } = await incidentsRepo.getDocuments(incidente);
        return jsonResponse({
            success: true,
            data: { archivos, informeNoDisponible, requeridos: papelesRequeridos(incidente), avance: avanceDelCaso(incidente) },
        });
    } catch (err) {
        return errorResponse(err);
    }
}

// Enlace de descarga firmado (15 minutos) de UN papel. La DIAT y la DIEP traen datos de
// salud: pedir su enlace queda en la auditoría de acceso a datos de salud, con la persona
// afectada como titular, y si el registro no se puede escribir la respuesta no sale
// (`conAuditoriaSalud`, en `incidentsHandler`). Los demás papeles se firman sin auditoría.
async function getEnlacePapel(request) {
    try {
        const ses = sesionDe(request);
        if (!ses.ok) return ses.respuesta;
        const sesion = ses.sesion;
        const incidente = await incidenteDelTenant(request.params.id, sesion);
        if (!puedeLeer(incidente, sesion)) return noEncontrado();
        if (!veHistorial(sesion)) return sinPermiso('No tienes permiso para ver los papeles del caso.');

        const papelId = decodeURIComponent(request.params.papelId);
        const papel = papelId === PAPEL_INFORME_FIRMADO
            ? await incidentsRepo.informeFirmado(incidente)
            : papelesDelCaso(incidente).find((p) => p.papelId === papelId);
        if (!papel) return jsonResponse({ success: false, error: 'Papel no encontrado' }, 404);
        if (papel.firmado && await verificarEntrega(papel.documento, papel.s3Key) === 'alterada') {
            return jsonResponse({ success: false, error: 'El archivo guardado no coincide con su huella de integridad registrada. No se entrega.' }, 409);
        }

        const { url } = await incidentsRepo.enlaceDePapel(papel);
        if (papel.firmado || tipoPapelConSalud(papel.tipo)) {
            const titular = await incidentsRepo.personaDelAfectado(sesion.tenantId, incidente.afectadoRutHmac);
            anotarAccesoSalud({
                tipo: TIPOS_ACCESO_SALUD.DESCARGA,
                titulares: titular ? [titular] : [],
                documentos: [incidente.incidentId, ...(papel.firmado ? [papel.documento.documentId] : [])],
                claves: [papel.s3Key],
            });
        }
        return jsonResponse({ success: true, data: { url } });
    } catch (err) {
        return errorResponse(err);
    }
}

/**
 * Resumen de los casos de una obra, sin datos personales (fase 4 del rediseño).
 *
 * Alimenta la lista "Casos de incidentes y accidentes" del repositorio de la obra
 * con, por cada caso: tipo, gravedad, fecha, si está abierto o cerrado, cuántos
 * papeles lleva (`avance`), cuáles exige y si cada uno está cumplido, y si tiene el
 * informe de investigación. NO entrega nombres, RUT, relato, archivos ni claves de
 * S3: eso sigue saliendo solo por `GET /incidents/{id}/documents`, que firma y
 * audita. El cálculo es del servidor porque solo él ve `papeles`.
 *
 * Permiso: `incidentes.historial`. El resumen no trae personas, pero es la lista de
 * los accidentes de la obra con su fecha y gravedad, y la regla del módulo es que
 * eso lo ve quien ve el historial (sin él, cada persona ve solo lo que reportó). El
 * ítem 66 del FUF, que sí lo lee todo el que abre el panel, no pasa por acá: lo
 * calcula el módulo de estructura con los mismos datos y solo entrega un conteo.
 * La obra tiene que ser de la empresa de la sesión; si no, 404 (como un incidente
 * ajeno).
 */
async function getCasosResumen(request) {
    try {
        const ses = sesionDe(request);
        if (!ses.ok) return ses.respuesta;
        const sesion = ses.sesion;
        if (!veHistorial(sesion)) return sinPermiso('No tienes permiso para ver los casos de la obra.');
        const { obraId } = request.query || {};
        if (typeof obraId !== 'string' || !obraId) return solicitudInvalida('obraId es requerido.');
        if (!await obraDeLaEmpresa(obraId, sesion)) {
            return jsonResponse({ success: false, error: 'Obra no encontrada' }, 404);
        }
        // `list` ya los entrega del más reciente al más antiguo, y pagina: lee TODOS
        // los casos de la empresa, no solo la primera página de la consulta.
        const { items } = await incidentsRepo.list({ tenantId: sesion.tenantId, obraId });
        const casos = items.map(resumenDelCaso);
        return jsonResponse({ success: true, data: casos, total: casos.length });
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
