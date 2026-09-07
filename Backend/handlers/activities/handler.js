const { v4: uuidv4 } = require('uuid');
const { PutCommand, GetCommand, QueryCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient } = require('../../lib/clients/dynamodb');
const { success, error, created } = require('../../lib/utils/response');
const { fechaHoraChile, horaChileHHMM } = require('../../lib/utils/fechaChile');
const { validateRequired, generateSignatureToken } = require('../../lib/utils/validation');
const { FirmaService } = require('../../lib/services/FirmaService');
const { PersonaService } = require('../../lib/services/PersonaService');
const { TenantService } = require('../../lib/services/TenantService');
const { PERMISSIONS, personaPuede } = require('../../lib/permissions');
const { resolveCatalogos, validatePlanificacion, validatePermisosTrabajo } = require('../../lib/catalogos-actividad');
const { eventBus } = require('../../lib/events/EventBus');

const TABLE_NAME = process.env.ACTIVITIES_TABLE || 'Activities';

// Tipos de actividades según el flujo de prevención
const ACTIVITY_TYPES = {
    CHARLA_5MIN: 'Charla Diaria de 5 Minutos',
    ART: 'Análisis de Riesgos en Terreno',
    CAPACITACION: 'Capacitación',
    INDUCCION: 'Inducción',
    REUNION_COMITE: 'Reunión Comité Paritario',
    SIMULACRO: 'Simulacro de Emergencia',
    INSPECCION: 'Inspección de Seguridad',
    OTRO: 'Otra actividad',
};

// Subtipos de CAPACITACION segun el DS44 (Excel de Elementos). Permiten
// distinguir de forma estricta cada capacitacion exigida en la fase DO,
// en vez de adivinar por palabras del titulo.
const CAPACITACION_SUBTIPOS = {
    PRL_8H: 'Prevención de Riesgos Laborales (8h) — Art. 16',
    EPP: 'Uso y mantención de EPP — Art. 13',
    CPHS_ORIENTACION: 'Orientación CPHS (8h) — Art. 32',
    CPHS_20H: 'Curso 20h CPHS — Art. 32',
    DELEGADO: 'Capacitación Delegado SST — Art. 66',
    ENCARGADO: 'Encargado Gestión del Riesgo — Art. 65',
    OTRA: 'Otra capacitación',
};

// Notas mínimas de aprobación admitidas, alineadas con el catálogo de cargos
// (`sanitizeCargoCatalog` en lib/ds44.js solo acepta estas dos): 70% general
// según PR-PDO-04 y 90% para altura/SPDC. Un valor libre acá dejaría kits y
// actividades midiendo cosas distintas con el mismo nombre.
const NOTAS_MINIMAS = [70, 90];

/** Respaldo documental: el archivo con las evaluaciones ya corregidas. */
const normalizarRespaldo = (raw, subidoPor) => {
    if (!raw) return null;
    const fileKey = String(raw.fileKey || '').trim();
    if (!fileKey) throw new Error('El respaldo de la evaluación requiere fileKey');
    return {
        fileKey,
        nombre: String(raw.nombre || '').trim() || 'Evaluaciones',
        tipo: raw.tipo || null,
        tamano: Number.isFinite(Number(raw.tamano)) ? Number(raw.tamano) : null,
        subidoPor: raw.subidoPor || subidoPor || null,
        subidoEn: raw.subidoEn || new Date().toISOString(),
    };
};

/**
 * Normaliza el bloque de evaluación de una CAPACITACION.
 *
 * La plataforma NO toma la evaluación ni guarda notas por persona: la rinde y la
 * corrige el relator fuera del sistema, y acá se custodia **un solo documento**
 * con las evaluaciones de esa capacitación. Es el mismo criterio del PTP y de la
 * MIPER — el sistema no lee el archivo, solo afirma lo que puede verificar sin
 * abrirlo: que la capacitación exige evaluación, con qué nota mínima, y si el
 * respaldo está cargado o falta.
 *
 * Ausente o `exigida: false` => no se evalúa (comportamiento histórico).
 */
const normalizarEvaluacion = (raw, tipo, opts = {}) => {
    if (tipo !== 'CAPACITACION') return null;
    if (!raw || raw.exigida !== true) return { exigida: false, notaMinima: null, escala: 'porcentaje', respaldo: null };

    const nota = Number(raw.notaMinima);
    if (!NOTAS_MINIMAS.includes(nota)) {
        throw new Error(`notaMinima inválida. Válidas: ${NOTAS_MINIMAS.join(', ')}`);
    }

    // El respaldo se conserva si el request no lo trae: editar la exigencia no
    // debe borrar un archivo ya cargado.
    let respaldo = opts.previa?.respaldo || null;
    if (opts.permitirRespaldo && raw.respaldo !== undefined) {
        respaldo = normalizarRespaldo(raw.respaldo, opts.subidoPor);
    }

    return { exigida: true, notaMinima: nota, escala: 'porcentaje', respaldo };
};

// Tope de ocurrencias por serie, para evitar crear cantidades desmedidas.
const MAX_OCURRENCIAS = 180;

// Tope total de actividades generadas en una sola llamada a /activities/plan
// (suma de fechas × responsables de todos los ítems del esqueleto).
const MAX_ACTIVIDADES_PLAN = 500;

// Convierte "HH:MM" o "HH:MM:SS" a minutos desde medianoche. Devuelve null si
// el formato no es reconocible (render/validación defensivos con datos viejos).
const horaAMinutos = (hora) => {
    if (typeof hora !== 'string') return null;
    const m = hora.match(/^(\d{1,2}):(\d{2})/);
    if (!m) return null;
    return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
};

// Calcula el atraso de una firma respecto de la hora programada de la charla.
// No bloquea nada: solo etiqueta. Si falta alguna hora, atraso = false.
const calcularAtraso = (horaFirma, horaProgramada) => {
    const f = horaAMinutos(horaFirma);
    const p = horaAMinutos(horaProgramada);
    if (f === null || p === null) return { atraso: false, minutosAtraso: 0 };
    const diff = f - p;
    return { atraso: diff > 0, minutosAtraso: diff > 0 ? diff : 0 };
};

// Regla de "registro completamente vacío" para impedir el cierre de una
// actividad sin contenido. Tiene contenido si hay descripción, ubicación,
// asistentes requeridos, algún permiso de trabajo, o una planificación con
// tema (código u "otro"). Para CHARLA_5MIN/ART se exige además el tema.
const registroTieneContenido = (activity) => {
    const plan = activity.planificacion || {};
    const tema = plan.tema || {};
    const tieneTema = !!(tema.codigo || (typeof tema.otro === 'string' && tema.otro.trim()));
    const tienePermisos = Array.isArray(activity.permisosTrabajo) && activity.permisosTrabajo.length > 0;
    const tieneBase = !!(
        (typeof activity.descripcion === 'string' && activity.descripcion.trim()) ||
        (typeof activity.ubicacion === 'string' && activity.ubicacion.trim()) ||
        (Array.isArray(activity.asistentesRequeridos) && activity.asistentesRequeridos.length > 0) ||
        tienePermisos
    );
    if (activity.tipo === 'CHARLA_5MIN' || activity.tipo === 'ART') {
        return tieneTema || tieneBase;
    }
    return tieneTema || tieneBase;
};
module.exports._registroTieneContenido = registroTieneContenido;
module.exports._calcularAtraso = calcularAtraso;

/**
 * Valida planificacion + permisosTrabajo de un body contra el catálogo del
 * tenant y las personas reales. Devuelve { planificacion, permisosTrabajo }
 * o lanza un Error cuyo message es apto para responder 400.
 */
const validarBloquesActividad = async ({ tenantId, tipo, planificacion, permisosTrabajo }) => {
    const tenantService = new TenantService();
    const personaService = new PersonaService();
    const tenant = await tenantService.getById(tenantId).catch(() => null);
    const catalogos = resolveCatalogos(tenant);

    const rPlan = validatePlanificacion(planificacion, catalogos, tipo);
    if (rPlan.errores.length) throw new Error(`Planificación inválida: ${rPlan.errores.join('; ')}`);

    // Responsables de permisos: deben ser personas existentes del tenant.
    const responsablesValidos = new Set();
    const nombres = {};
    for (const p of (Array.isArray(permisosTrabajo) ? permisosTrabajo : [])) {
        const rid = String(p?.responsableId || '').trim();
        if (!rid || responsablesValidos.has(rid)) continue;
        const persona = await personaService.getById(rid).catch(() => null);
        if (persona && persona.tenantId === tenantId) {
            responsablesValidos.add(rid);
            nombres[rid] = `${persona.nombre} ${persona.apellidoPaterno || persona.apellido || ''}`.trim();
        }
    }
    const rPerm = validatePermisosTrabajo(permisosTrabajo, responsablesValidos);
    if (rPerm.errores.length) throw new Error(`Permisos de trabajo inválidos: ${rPerm.errores.join('; ')}`);
    // Nombre denormalizado para el reporte (fuente: la persona real, no el cliente).
    for (const p of rPerm.value) p.responsableNombre = nombres[p.responsableId] || p.responsableNombre;

    return { planificacion: rPlan.value, permisosTrabajo: rPerm.value };
};

/**
 * Genera la lista de fechas (YYYY-MM-DD) de una serie recurrente entre la fecha
 * de inicio y `hasta` (inclusive), según la frecuencia. Devuelve solo la fecha
 * de inicio si no hay repetición o los parámetros son inválidos.
 *
 * Con `excluirFinDeSemana` se omiten sábados y domingos (días no trabajados en
 * obra): la fecha se salta pero el cursor sigue avanzando. Los feriados se
 * ignoran a propósito (decisión de diseño: solo se excluye el fin de semana).
 */
function generarFechasRecurrencia(inicio, hasta, frecuencia, excluirFinDeSemana = false) {
    if (frecuencia === 'unica' || !hasta) return [inicio];
    const cur = new Date(`${inicio}T00:00:00`);
    const fin = new Date(`${hasta}T00:00:00`);
    if (isNaN(cur.getTime()) || isNaN(fin.getTime()) || fin < cur) return [inicio];

    const fechas = [];
    while (cur <= fin && fechas.length < MAX_OCURRENCIAS) {
        const dia = cur.getDay(); // 0 = domingo, 6 = sábado
        if (!excluirFinDeSemana || (dia !== 0 && dia !== 6)) {
            fechas.push(cur.toISOString().split('T')[0]);
        }
        if (frecuencia === 'diaria') cur.setDate(cur.getDate() + 1);
        else if (frecuencia === 'semanal') cur.setDate(cur.getDate() + 7);
        else if (frecuencia === 'mensual') cur.setMonth(cur.getMonth() + 1);
        else break;
    }
    return fechas;
}

// Exportada para tests (ver Backend/test_planificacion.js).
module.exports.generarFechasRecurrencia = generarFechasRecurrencia;

/**
 * POST /activities - Crear nueva actividad
 */
module.exports.create = async (event) => {
    try {
        const body = JSON.parse(event.body || '{}');
        const tenantId = body.tenantId || event.queryStringParameters?.tenantId;
        if (!tenantId) return error('tenantId es requerido');

        const validation = validateRequired(body, ['tipo', 'titulo', 'relatorId']);
        if (!validation.valid) {
            return error(`Campos requeridos faltantes: ${validation.missing.join(', ')}`);
        }

        if (!ACTIVITY_TYPES[body.tipo]) {
            return error(`Tipo de actividad inválido. Tipos válidos: ${Object.keys(ACTIVITY_TYPES).join(', ')}`);
        }

        // El subtipo solo aplica a CAPACITACION; si viene, debe ser valido.
        let subtipo = null;
        if (body.tipo === 'CAPACITACION') {
            subtipo = body.subtipo || 'OTRA';
            if (!CAPACITACION_SUBTIPOS[subtipo]) {
                return error(`Subtipo de capacitación inválido. Válidos: ${Object.keys(CAPACITACION_SUBTIPOS).join(', ')}`);
            }
        }

        // Evaluación de aprendizaje (Art. 13.4 / 16): opcional y solo para
        // CAPACITACION. Acá solo se declara la exigencia; el documento con las
        // evaluaciones corregidas se adjunta después, por PATCH.
        let evaluacion;
        try {
            // Al crear solo se declara la exigencia: el respaldo se sube después
            // de dictada la capacitación, vía PATCH.
            evaluacion = normalizarEvaluacion(body.evaluacion, body.tipo);
        } catch (evalErr) {
            return error(evalErr.message, 400);
        }

        let bloques;
        try {
            bloques = await validarBloquesActividad({
                tenantId, tipo: body.tipo,
                planificacion: body.planificacion,
                permisosTrabajo: body.permisosTrabajo,
            });
        } catch (validationErr) {
            return error(validationErr.message, 400);
        }

        const now = new Date().toISOString();

        // Periodicidad: si la actividad se repite, generamos una ocurrencia por
        // fecha (ej. una charla de 5 min cada día a las 9am). Todas comparten un
        // serieId para poder agruparlas/identificarlas. 'unica' = sin repetición.
        const FRECUENCIAS = ['unica', 'diaria', 'semanal', 'mensual'];
        const frecuencia = FRECUENCIAS.includes(body.frecuencia) ? body.frecuencia : 'unica';
        const fechaInicio = body.fecha || now.split('T')[0];
        const repetirHasta = body.repetirHasta || null;

        const fechas = generarFechasRecurrencia(fechaInicio, repetirHasta, frecuencia);
        const esSerie = frecuencia !== 'unica' && fechas.length > 1;
        const serieId = esSerie ? uuidv4() : null;

        const asistentesRequeridos = Array.isArray(body.asistentesRequeridos)
            ? body.asistentesRequeridos
            : (Array.isArray(body.attendees) ? body.attendees : []);

        // Multi-responsable: se acepta responsables[] (el relator debe estar incluido).
        // relatorId se mantiene como responsables[0] por compatibilidad con firmas.
        const responsables = Array.isArray(body.responsables) && body.responsables.length > 0
            ? [...new Set([body.relatorId, ...body.responsables.filter((r) => typeof r === 'string' && r)])]
            : [body.relatorId];

        const baseActivity = {
            tenantId,
            obraId: body.obraId || null,
            tipo: body.tipo,
            tipoDescripcion: ACTIVITY_TYPES[body.tipo],
            subtipo,
            subtipoDescripcion: subtipo ? CAPACITACION_SUBTIPOS[subtipo] : null,
            evaluacion,
            titulo: body.titulo,
            descripcion: body.descripcion || '',
            horaInicio: body.horaInicio || now.split('T')[1].substring(0, 5),
            horaFin: body.horaFin || null,
            relatorId: body.relatorId,
            responsables,
            ubicacion: body.ubicacion || '',
            asistentesRequeridos,
            asistentes: [],
            firmaRelator: null,
            estado: 'programada',
            // Toda actividad creada por este endpoint es "suelta" (no viene de un
            // esqueleto de planificación); las planificadas nacen en /activities/plan.
            origen: 'ad_hoc',
            tipoTrabajo: body.tipoTrabajo || null,
            planId: null,
            recurrencia: esSerie ? { frecuencia, repetirHasta, serieId } : { frecuencia: 'unica' },
            serieId,
            // Vínculo con el ítem del kit de onboarding (trazabilidad): si esta
            // actividad se agendó para cumplir un ítem, al asistir se cierra ese ítem.
            kitItemKey: body.kitItemKey || null,
            planificacion: bloques.planificacion,
            permisosTrabajo: bloques.permisosTrabajo,
            createdAt: now,
            updatedAt: now,
        };

        const actividades = fechas.map((fecha) => ({
            ...baseActivity,
            activityId: uuidv4(),
            fecha,
        }));

        for (const act of actividades) {
            await docClient.send(new PutCommand({ TableName: TABLE_NAME, Item: act }));
        }

        // Notificar asistentes (un solo evento por la serie/actividad, con la primera fecha).
        try {
            if (asistentesRequeridos.length > 0) {
                const primera = actividades[0];
                await eventBus.emit('activity.created', {
                    activityId: primera.activityId,
                    attendeeIds: asistentesRequeridos,
                    createdBy: body.relatorId,
                    activityName: primera.titulo,
                    fecha: primera.fecha,
                    tipo: primera.tipo,
                    obraId: primera.obraId,
                    serie: esSerie ? { serieId, ocurrencias: actividades.length } : undefined,
                });
            }
        } catch (eventError) {
            console.error('Error emitting activity.created event:', eventError);
        }

        // Compatibilidad: una sola actividad devuelve el objeto; una serie devuelve
        // la lista creada junto con la primera ocurrencia.
        if (!esSerie) return created(actividades[0]);
        return created({ serie: true, serieId, count: actividades.length, activities: actividades, first: actividades[0] });
    } catch (err) {
        console.error('Error creating activity:', err);
        return error(err.message, 500);
    }
};

/**
 * POST /activities/plan - Generar el esqueleto de planificación
 *
 * Recibe un esqueleto (lista de ítems con tipo, periodicidad y responsables) y un
 * rango de fechas, y pre-genera actividades reales en estado `borrador`, una por
 * (fecha × responsable). Cada borrador es independiente y editable: el supervisor
 * solo rellena el detalle del día (no se copia el mismo contenido a toda la serie).
 *
 * Reglas:
 * - Se excluyen sábados y domingos (días no trabajados). Feriados se ignoran.
 * - Filtrado por corresponsalía: cada ítem lleva SU propia lista de responsables
 *   (así una "inspección de andamios" se asigna solo a quienes la realizan). El
 *   `tipoTrabajo` del ítem queda en cada borrador para filtrar/visualizar.
 * - Idempotencia: si ya existe una actividad planificada del mismo (obra, fecha,
 *   tipo, responsable) —de cualquier plan anterior— no se duplica; se omite.
 */
module.exports.plan = async (event) => {
    try {
        const body = JSON.parse(event.body || '{}');
        const tenantId = body.tenantId || event.queryStringParameters?.tenantId;
        if (!tenantId) return error('tenantId es requerido');

        const validation = validateRequired(body, ['obraId', 'rangoDesde', 'rangoHasta', 'solicitanteId']);
        if (!validation.valid) {
            return error(`Campos requeridos faltantes: ${validation.missing.join(', ')}`);
        }
        if (!Array.isArray(body.items) || body.items.length === 0) {
            return error('El esqueleto debe incluir al menos un ítem (items)');
        }

        const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;
        if (!FECHA_RE.test(body.rangoDesde) || !FECHA_RE.test(body.rangoHasta)) {
            return error('rangoDesde y rangoHasta deben tener formato YYYY-MM-DD');
        }
        if (body.rangoHasta < body.rangoDesde) {
            return error('rangoHasta debe ser igual o posterior a rangoDesde');
        }

        const personaService = new PersonaService();

        // Autorización: el solicitante debe poder planificar (actividades.planificar).
        // Se resuelve contra la definición de roles del tenant para respetar roles
        // personalizados (ej. un rol "Comité Paritario" con el permiso delegado).
        const solicitante = await personaService.getById(body.solicitanteId);
        if (!solicitante || solicitante.tenantId !== tenantId) {
            return error('Solicitante no encontrado en la empresa', 403);
        }
        let tenant = null;
        try {
            const { TenantService } = require('../../lib/services/TenantService');
            tenant = await new TenantService().getById(tenantId);
        } catch (e) {
            console.error('No se pudo cargar el tenant para resolver permisos:', e.message);
        }
        if (!personaPuede(solicitante, tenant, PERMISSIONS.ACTIVIDADES_PLANIFICAR)) {
            return error('No tienes permiso para planificar actividades', 403);
        }

        // Validación de ítems: tipo, periodicidad y responsables.
        const PERIODICIDADES = ['diaria', 'semanal', 'mensual'];
        const responsableIds = new Set();
        for (let i = 0; i < body.items.length; i++) {
            const item = body.items[i];
            if (!ACTIVITY_TYPES[item.tipo]) {
                return error(`Ítem ${i + 1}: tipo inválido. Válidos: ${Object.keys(ACTIVITY_TYPES).join(', ')}`);
            }
            if (item.tipo === 'CAPACITACION' && item.subtipo && !CAPACITACION_SUBTIPOS[item.subtipo]) {
                return error(`Ítem ${i + 1}: subtipo de capacitación inválido`);
            }
            if (!PERIODICIDADES.includes(item.periodicidad)) {
                return error(`Ítem ${i + 1}: periodicidad inválida. Válidas: ${PERIODICIDADES.join(', ')}`);
            }
            if (!Array.isArray(item.responsables) || item.responsables.length === 0) {
                return error(`Ítem ${i + 1}: debe indicar al menos un responsable`);
            }
            item.responsables.forEach((r) => responsableIds.add(r));
        }

        // Los responsables deben ser personas del tenant.
        const responsablesValidos = new Map();
        for (const pid of responsableIds) {
            const persona = await personaService.getById(pid);
            if (!persona || persona.tenantId !== tenantId) {
                return error(`Responsable ${pid} no encontrado en la empresa`);
            }
            responsablesValidos.set(pid, persona);
        }

        // Idempotencia: actividades planificadas ya existentes de esta obra, para
        // no duplicar (obra, fecha, tipo, responsable) al re-generar un plan.
        const existentesRes = await docClient.send(new QueryCommand({
            TableName: TABLE_NAME,
            IndexName: 'tenantId-index',
            KeyConditionExpression: 'tenantId = :tenantId',
            FilterExpression: 'obraId = :obraId AND origen = :origen',
            ExpressionAttributeValues: {
                ':tenantId': tenantId,
                ':obraId': body.obraId,
                ':origen': 'planificacion',
            },
        }));
        // Se indexa por el relator PLANIFICADO (no el actual): si la charla del martes
        // se reasignó a un reemplazante, re-generar el plan no debe volver a crear el
        // borrador del responsable original.
        const yaPlanificadas = new Set(
            (existentesRes.Items || []).map((a) => `${a.fecha}|${a.tipo}|${a.relatorPlanificadoId || a.relatorId}`)
        );

        const now = new Date().toISOString();
        const planId = uuidv4();
        const actividades = [];
        let omitidas = 0;

        for (const item of body.items) {
            // Siempre sin fines de semana: en obra no se planifican sábados/domingos.
            const fechas = generarFechasRecurrencia(body.rangoDesde, body.rangoHasta, item.periodicidad, true);
            const pre = item.camposPrellenados || {};
            const subtipo = item.tipo === 'CAPACITACION' ? (item.subtipo || 'OTRA') : null;

            // Qué campos vienen pre-llenados del esqueleto (la UI los distingue del
            // detalle que debe completar el supervisor).
            const prellenados = [];
            if (item.tituloBase) prellenados.push('titulo');
            if (pre.horaInicio) prellenados.push('horaInicio');
            if (pre.ubicacion) prellenados.push('ubicacion');
            if (pre.descripcion) prellenados.push('descripcion');

            for (const fecha of fechas) {
                for (const responsableId of item.responsables) {
                    if (yaPlanificadas.has(`${fecha}|${item.tipo}|${responsableId}`)) {
                        omitidas++;
                        continue;
                    }
                    actividades.push({
                        activityId: uuidv4(),
                        tenantId,
                        obraId: body.obraId,
                        tipo: item.tipo,
                        tipoDescripcion: ACTIVITY_TYPES[item.tipo],
                        subtipo,
                        subtipoDescripcion: subtipo ? CAPACITACION_SUBTIPOS[subtipo] : null,
                        titulo: item.tituloBase || ACTIVITY_TYPES[item.tipo],
                        descripcion: pre.descripcion || '',
                        fecha,
                        horaInicio: pre.horaInicio || '09:00',
                        horaFin: null,
                        relatorId: responsableId,
                        responsables: [responsableId],
                        ubicacion: pre.ubicacion || '',
                        asistentesRequeridos: [],
                        asistentes: [],
                        firmaRelator: null,
                        estado: 'borrador',
                        origen: 'planificacion',
                        tipoTrabajo: item.tipoTrabajo || null,
                        planId,
                        camposPrellenados: prellenados,
                        recurrencia: { frecuencia: item.periodicidad, repetirHasta: body.rangoHasta, planId },
                        serieId: null,
                        kitItemKey: null,
                        createdBy: body.solicitanteId,
                        createdAt: now,
                        updatedAt: now,
                    });
                    if (actividades.length > MAX_ACTIVIDADES_PLAN) {
                        return error(`El plan generaría más de ${MAX_ACTIVIDADES_PLAN} actividades. Reduce el rango de fechas o la cantidad de ítems/responsables.`);
                    }
                }
            }
        }

        for (const act of actividades) {
            await docClient.send(new PutCommand({ TableName: TABLE_NAME, Item: act }));
        }

        return created({
            planId,
            count: actividades.length,
            omitidas,
            activities: actividades,
        });
    } catch (err) {
        console.error('Error generating activity plan:', err);
        return error(err.message, 500);
    }
};

/**
 * GET /activities - Listar actividades
 */
module.exports.list = async (event) => {
    try {
        const { tenantId, obraId, tipo, estado, fecha, relatorId,
            planId, responsableId, tipoTrabajo, fechaDesde, fechaHasta } = event.queryStringParameters || {};
        if (!tenantId) return error('tenantId es requerido');

        // Query por GSI tenantId-index (no Scan)
        const params = {
            TableName: TABLE_NAME,
            IndexName: 'tenantId-index',
            KeyConditionExpression: 'tenantId = :tenantId',
            ExpressionAttributeValues: { ':tenantId': tenantId }
        };

        let filterParts = [];
        const expressionAttributeNames = {};

        if (obraId) {
            filterParts.push('obraId = :obraId');
            params.ExpressionAttributeValues[':obraId'] = obraId;
        }
        if (tipo) {
            filterParts.push('tipo = :tipo');
            params.ExpressionAttributeValues[':tipo'] = tipo;
        }
        if (estado) {
            filterParts.push('estado = :estado');
            params.ExpressionAttributeValues[':estado'] = estado;
        }
        if (fecha) {
            filterParts.push('#fecha = :fecha');
            expressionAttributeNames['#fecha'] = 'fecha';
            params.ExpressionAttributeValues[':fecha'] = fecha;
        }
        // Rango de fechas (para cargar el mes del calendario en una sola llamada).
        if (fechaDesde) {
            filterParts.push('#fecha >= :fechaDesde');
            expressionAttributeNames['#fecha'] = 'fecha';
            params.ExpressionAttributeValues[':fechaDesde'] = fechaDesde;
        }
        if (fechaHasta) {
            filterParts.push('#fecha <= :fechaHasta');
            expressionAttributeNames['#fecha'] = 'fecha';
            params.ExpressionAttributeValues[':fechaHasta'] = fechaHasta;
        }
        if (relatorId) {
            filterParts.push('relatorId = :relatorId');
            params.ExpressionAttributeValues[':relatorId'] = relatorId;
        }
        // Responsable: busca en responsables[] con fallback a relatorId (registros
        // antiguos sin el campo nuevo).
        if (responsableId) {
            filterParts.push('(contains(responsables, :responsableId) OR relatorId = :responsableId)');
            params.ExpressionAttributeValues[':responsableId'] = responsableId;
        }
        if (planId) {
            filterParts.push('planId = :planId');
            params.ExpressionAttributeValues[':planId'] = planId;
        }
        if (tipoTrabajo) {
            filterParts.push('tipoTrabajo = :tipoTrabajo');
            params.ExpressionAttributeValues[':tipoTrabajo'] = tipoTrabajo;
        }

        if (filterParts.length > 0) {
            params.FilterExpression = filterParts.join(' AND ');
        }
        if (Object.keys(expressionAttributeNames).length > 0) {
            params.ExpressionAttributeNames = expressionAttributeNames;
        }

        const result = await docClient.send(new QueryCommand(params));

        const activities = (result.Items || []).sort((a, b) =>
            new Date(b.createdAt) - new Date(a.createdAt)
        );

        return success({ activities, types: ACTIVITY_TYPES, capacitacionSubtipos: CAPACITACION_SUBTIPOS });
    } catch (err) {
        console.error('Error listing activities:', err);
        return error(err.message, 500);
    }
};

/**
 * GET /activities/{id} - Obtener actividad por ID
 */
module.exports.get = async (event) => {
    try {
        const { id } = event.pathParameters || {};

        if (!id) {
            return error('ID de actividad requerido');
        }

        const result = await docClient.send(
            new GetCommand({
                TableName: TABLE_NAME,
                Key: { activityId: id },
            })
        );

        if (!result.Item) {
            return error('Actividad no encontrada', 404);
        }

        return success(result.Item);
    } catch (err) {
        console.error('Error getting activity:', err);
        return error(err.message, 500);
    }
};

/**
 * POST /activities/{id}/attendance - Registrar asistencia con firma
 */
module.exports.registerAttendance = async (event) => {
    try {
        const { id } = event.pathParameters || {};
        const body = JSON.parse(event.body || '{}');

        if (!id) return error('ID de actividad requerido');

        // Acepta personaId o workerId (legacy)
        const { personaId, personaIds, workerId, workerIds, incluirFirmaRelator, pin } = body;
        const personas = personaIds || (personaId ? [personaId] : workerIds || (workerId ? [workerId] : []));

        if (personas.length === 0) {
            return error('Se requiere al menos un trabajador');
        }

        // Firma con PIN del trabajador (no presencial): la asistencia se firma de
        // forma INDIVIDUAL porque un PIN solo autentica a su dueño. El cliente
        // registra un trabajador a la vez con su propio PIN.
        if (!pin) return error('Se requiere el PIN del trabajador para registrar la asistencia', 400);
        if (personas.length > 1) {
            return error('La firma con PIN es individual: registra un trabajador a la vez con su propio PIN', 400);
        }

        // Obtener actividad
        const actResult = await docClient.send(new GetCommand({
            TableName: TABLE_NAME,
            Key: { activityId: id }
        }));

        if (!actResult.Item) return error('Actividad no encontrada', 404);
        const activity = actResult.Item;

        // Se puede firmar durante todo el día: una actividad completada (cerrada)
        // sigue admitiendo firmas de rezagados. Solo se bloquea si está cancelada
        // o si aún es un borrador sin programar.
        if (activity.estado === 'cancelada') {
            return error('La actividad está cancelada y no admite firmas', 409);
        }
        if (activity.estado === 'borrador') {
            return error('La actividad es un borrador sin programar; complétala antes de firmar', 409);
        }

        const personaService = new PersonaService();
        const now = new Date();
        const nuevosAsistentes = [];
        const contexto = {
            ipAddress: event.requestContext?.http?.sourceIp || 'unknown',
            userAgent: event.headers?.['user-agent'] || 'unknown'
        };

        // Registrar cada persona
        for (const pid of personas) {
            const yaRegistrado = (activity.asistentes || []).some(a => a.personaId === pid);
            if (yaRegistrado) continue;

            const persona = await personaService.getById(pid);
            if (!persona) continue;

            // Crear firma en SignaturesTable (siempre con PIN del trabajador).
            const metodo = 'PIN';
            const firma = await FirmaService.crear({
                personaId: pid,
                tenantId: activity.tenantId,
                obraId: activity.obraId || null,
                metodo,
                credencial: pin || {},
                tipoFirma: 'actividad',
                referenciaId: id,
                referenciaTipo: 'activity',
                contexto,
                persona
            });

            // Etiqueta de atraso: se firmó después de la hora programada de la
            // charla. No bloquea; solo queda registrado para el reporte.
            // OJO: firma.horario viene en UTC (FirmaService corre en Lambda con
            // reloj UTC), pero horaInicio se ingresa en hora de Chile. Se compara
            // contra la hora local de Chile para no marcar un atraso falso.
            const horaFirmaChile = now.toLocaleTimeString('es-CL', {
                timeZone: 'America/Santiago', hour12: false, hour: '2-digit', minute: '2-digit',
            });
            const { atraso, minutosAtraso } = calcularAtraso(horaFirmaChile, activity.horaInicio);

            nuevosAsistentes.push({
                personaId: pid,
                nombre: persona.nombre,
                rut: persona.rut,
                cargo: persona.cargo || '',
                atraso,
                minutosAtraso,
                firma: {
                    token: firma.token,
                    fecha: firma.fecha,
                    horario: firma.horario,
                    timestamp: firma.timestamp
                }
            });
        }

        const asistentes = [...(activity.asistentes || []), ...nuevosAsistentes];

        // Firma del relator si se solicita
        let firmaRelator = activity.firmaRelator;
        if (incluirFirmaRelator && !firmaRelator && activity.relatorId) {
            const relator = await personaService.getById(activity.relatorId);
            if (relator) {
                firmaRelator = {
                    token: generateSignatureToken(),
                    personaId: activity.relatorId,
                    nombre: relator.nombre,
                    rut: relator.rut,
                    ...fechaHoraChile(now),
                    timestamp: now.toISOString()
                };
            }
        }

        // La firma NO cierra la actividad ni fija horaFin: registrar asistencia y
        // cerrar la charla son acciones distintas. El estado se mantiene
        // (programada / completada) y el cierre es explícito vía PATCH.
        await docClient.send(new UpdateCommand({
            TableName: TABLE_NAME,
            Key: { activityId: id },
            UpdateExpression: 'SET asistentes = :asistentes, firmaRelator = :firmaRelator, updatedAt = :updatedAt',
            ExpressionAttributeValues: {
                ':asistentes': asistentes,
                ':firmaRelator': firmaRelator,
                ':updatedAt': now.toISOString()
            }
        }));

        return success({
            message: `${nuevosAsistentes.length} asistente(s) registrado(s)`,
            totalAsistentes: asistentes.length,
            nuevosAsistentes,
            firmaRelator: incluirFirmaRelator ? firmaRelator : undefined
        });
    } catch (err) {
        console.error('Error registering attendance:', err);
        return error(err.message, 500);
    }
};

/**
 * GET /activities/stats - Estadísticas de actividades
 */
module.exports.getStats = async (event) => {
    try {
        const { tenantId, fechaInicio, fechaFin } = event.queryStringParameters || {};
        if (!tenantId) return error('tenantId es requerido');

        // Query por GSI tenantId-index
        const result = await docClient.send(new QueryCommand({
            TableName: TABLE_NAME,
            IndexName: 'tenantId-index',
            KeyConditionExpression: 'tenantId = :tenantId',
            ExpressionAttributeValues: { ':tenantId': tenantId }
        }));

        const activities = result.Items || [];

        // Filtrar por rango de fechas si se especifica
        let filteredActivities = activities;
        if (fechaInicio || fechaFin) {
            filteredActivities = activities.filter(a => {
                const fecha = new Date(a.fecha);
                if (fechaInicio && fecha < new Date(fechaInicio)) return false;
                if (fechaFin && fecha > new Date(fechaFin)) return false;
                return true;
            });
        }

        // Calcular estadísticas
        const stats = {
            total: filteredActivities.length,
            completadas: filteredActivities.filter(a => a.estado === 'completada').length,
            programadas: filteredActivities.filter(a => a.estado === 'programada').length,
            canceladas: filteredActivities.filter(a => a.estado === 'cancelada').length,
            borradores: filteredActivities.filter(a => a.estado === 'borrador').length,
            porTipo: {},
            totalAsistentes: 0,
            promedioAsistentesPorActividad: 0,
        };

        // Por tipo
        Object.keys(ACTIVITY_TYPES).forEach(tipo => {
            const delTipo = filteredActivities.filter(a => a.tipo === tipo);
            stats.porTipo[tipo] = {
                nombre: ACTIVITY_TYPES[tipo],
                total: delTipo.length,
                completadas: delTipo.filter(a => a.estado === 'completada').length,
            };
        });

        // Total asistentes
        filteredActivities.forEach(a => {
            stats.totalAsistentes += (a.asistentes || []).length;
        });

        if (stats.completadas > 0) {
            stats.promedioAsistentesPorActividad = Math.round(stats.totalAsistentes / stats.completadas * 10) / 10;
        }

        // Porcentaje de cumplimiento
        stats.porcentajeCumplimiento = stats.total > 0
            ? Math.round((stats.completadas / stats.total) * 100)
            : 0;

        return success(stats);
    } catch (err) {
        console.error('Error getting stats:', err);
        return error(err.message, 500);
    }
};

/**
 * Autorización común de las vías de gestión de una actividad (PATCH y registro
 * de evaluaciones): el relator, cualquiera de `responsables[]`, o quien tenga el
 * permiso de crear actividades. Devuelve `{ error }` con la respuesta lista, o
 * `{ solicitanteId, solicitante, personaService }` si pasa.
 */
const autorizarGestionActividad = async (event, body, activity) => {
    const solicitanteId = body.solicitanteId || event.requestContext?.authorizer?.claims?.sub || null;
    if (!solicitanteId) return { error: error('solicitanteId es requerido', 400) };

    const personaService = new PersonaService();
    const solicitante = await personaService.getById(solicitanteId).catch(() => null);
    if (!solicitante || solicitante.tenantId !== activity.tenantId) {
        return { error: error('No autorizado para editar esta actividad', 403) };
    }

    // Responsable = relator o cualquiera de responsables[] (multi-asignación).
    const esResponsable = solicitante.personaId === activity.relatorId
        || (Array.isArray(activity.responsables) && activity.responsables.includes(solicitante.personaId));
    if (!esResponsable) {
        const tenant = await new TenantService().getById(activity.tenantId).catch(() => null);
        if (!personaPuede(solicitante, tenant, PERMISSIONS.ACTIVIDADES_CREAR)) {
            return { error: error('No autorizado para editar esta actividad', 403) };
        }
    }

    return { solicitanteId, solicitante, personaService };
};

/**
 * PATCH /activities/{id} - Completar el registro post-charla y/o un borrador
 * planificado.
 *
 * - planificacion / permisosTrabajo: siempre editables (registro post-charla),
 *   validados contra el catálogo del tenant.
 * - Campos de CONTENIDO (titulo, descripcion, horas, ubicación, asistentes
 *   requeridos, subtipo, tipoTrabajo, fecha): solo editables mientras NO haya
 *   firmas registradas. Con firmas, solo descripcion (más los bloques de arriba).
 * - Un `borrador` (generado por /activities/plan) pasa a `programada` al
 *   completarse, notificando a los asistentes requeridos.
 * - `estado: 'completada'` = CIERRE EXPLÍCITO: requiere al menos una firma y un
 *   registro con contenido; fija horaFin. Una actividad cerrada sigue admitiendo
 *   firmas de rezagados (eso lo maneja registerAttendance, no esta vía).
 * - Las asistencias y firmas son registro de auditoría y NO se tocan por esta
 *   vía. Autorizado: el relator/responsables de la actividad o quien tenga el
 *   permiso de crear actividades.
 */
module.exports.patch = async (event) => {
    try {
        const { id } = event.pathParameters || {};
        if (!id) return error('ID de actividad requerido');
        const body = JSON.parse(event.body || '{}');

        const actResult = await docClient.send(new GetCommand({ TableName: TABLE_NAME, Key: { activityId: id } }));
        if (!actResult.Item) return error('Actividad no encontrada', 404);
        const activity = actResult.Item;

        const auth = await autorizarGestionActividad(event, body, activity);
        if (auth.error) return auth.error;
        const { solicitanteId, personaService } = auth;

        const updates = {};

        // Bloques del registro post-charla: se validan contra el catálogo solo si
        // el request los trae (una edición de contenido puro no debe fallar por
        // una planificación previa incompleta).
        if (body.planificacion !== undefined || body.permisosTrabajo !== undefined) {
            let bloques;
            try {
                bloques = await validarBloquesActividad({
                    tenantId: activity.tenantId, tipo: activity.tipo,
                    planificacion: body.planificacion !== undefined ? body.planificacion : activity.planificacion,
                    permisosTrabajo: body.permisosTrabajo !== undefined ? body.permisosTrabajo : activity.permisosTrabajo,
                });
            } catch (validationErr) {
                return error(validationErr.message, 400);
            }
            updates.planificacion = bloques.planificacion;
            updates.permisosTrabajo = bloques.permisosTrabajo;
        }

        // Campos de contenido: congelados una vez que hay firmas (auditoría),
        // salvo la descripción, que puede completarse después de la charla.
        const tieneFirmas = (activity.asistentes || []).length > 0 || !!activity.firmaRelator;
        const CAMPOS_CONTENIDO = ['titulo', 'descripcion', 'ubicacion', 'horaInicio', 'horaFin',
            'fecha', 'asistentesRequeridos', 'subtipo', 'tipoTrabajo'];
        const editables = tieneFirmas ? ['descripcion'] : CAMPOS_CONTENIDO;
        for (const campo of editables) {
            if (body[campo] === undefined) continue;
            updates[campo] = body[campo];
        }

        // Validaciones puntuales del contenido.
        if (updates.fecha !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(updates.fecha)) {
            return error('fecha debe tener formato YYYY-MM-DD');
        }
        if (updates.asistentesRequeridos !== undefined && !Array.isArray(updates.asistentesRequeridos)) {
            return error('asistentesRequeridos debe ser una lista');
        }
        if (updates.subtipo !== undefined) {
            if (activity.tipo !== 'CAPACITACION') delete updates.subtipo;
            else if (!CAPACITACION_SUBTIPOS[updates.subtipo]) return error('Subtipo de capacitación inválido');
            else updates.subtipoDescripcion = CAPACITACION_SUBTIPOS[updates.subtipo];
        }

        // Evaluación de aprendizaje: NO se congela con las firmas como el resto del
        // contenido. La capacitación se rinde y se corrige fuera del sistema, así
        // que el respaldo se sube días después, con la asistencia ya firmada y la
        // actividad muchas veces cerrada; congelarlo con las firmas dejaría el
        // documento sin forma de entrar.
        if (body.evaluacion !== undefined) {
            if (activity.tipo !== 'CAPACITACION') {
                return error('Solo una CAPACITACION admite evaluación de aprendizaje', 400);
            }
            const previa = activity.evaluacion || null;
            // Apagar la exigencia con un respaldo ya cargado dejaría huérfano el
            // documento que prueba la evaluación: se exige quitarlo primero.
            if (body.evaluacion?.exigida !== true && previa?.respaldo) {
                return error('No se puede desactivar la evaluación: hay un respaldo cargado', 409);
            }
            try {
                updates.evaluacion = normalizarEvaluacion(body.evaluacion, activity.tipo, {
                    previa,
                    permitirRespaldo: true,
                    subidoPor: solicitanteId,
                });
            } catch (evalErr) {
                return error(evalErr.message, 400);
            }
        }

        // Relator: reasignable mientras NO haya firmas (quien dicta la charla cambia
        // por licencia/vacaciones/reemplazo). Con firmas ya es parte del acta y se
        // congela igual que el resto del contenido.
        // Al reasignar un borrador del plan se conserva `relatorPlanificadoId` (a quién
        // se le había asignado originalmente): es el dato que sostiene la trazabilidad
        // frente a una fiscalización, y además mantiene idempotente a /activities/plan.
        if (body.relatorId !== undefined && body.relatorId !== activity.relatorId) {
            if (tieneFirmas) {
                return error('No se puede cambiar el relator: la actividad ya tiene firmas registradas', 409);
            }
            if (!body.relatorId) return error('El relator no puede quedar vacío');
            const nuevoRelator = await personaService.getById(body.relatorId).catch(() => null);
            if (!nuevoRelator || nuevoRelator.tenantId !== activity.tenantId) {
                return error('El relator indicado no pertenece a la empresa');
            }
            updates.relatorId = body.relatorId;
            // responsables[0] = relator (invariante que asume create/firmas). El
            // relator saliente deja de ser responsable; los demás se conservan.
            const previos = Array.isArray(activity.responsables) && activity.responsables.length
                ? activity.responsables
                : (activity.relatorId ? [activity.relatorId] : []);
            updates.responsables = [...new Set([
                body.relatorId,
                ...previos.filter((r) => r && r !== activity.relatorId),
            ])];
            if (activity.origen === 'planificacion' && !activity.relatorPlanificadoId && activity.relatorId) {
                updates.relatorPlanificadoId = activity.relatorId;
            }
        }

        // Cambio de estado. `completada` = CIERRE EXPLÍCITO de la actividad, con
        // guardas: exige al menos una firma y un registro con contenido. El resto
        // son transiciones administrativas (borrador/programada/cancelada).
        const ESTADOS_PATCH = ['borrador', 'programada', 'completada', 'cancelada'];
        if (body.estado !== undefined) {
            if (!ESTADOS_PATCH.includes(body.estado)) {
                return error(`Estado inválido. Válidos vía edición: ${ESTADOS_PATCH.join(', ')}`);
            }
            if (body.estado === 'completada') {
                // Proyección: aplica los cambios de este mismo request antes de validar
                // (se puede completar el registro y cerrar en una sola llamada).
                const proyectada = { ...activity, ...updates };
                if ((proyectada.asistentes || []).length === 0) {
                    return error('No se puede cerrar la actividad sin al menos una firma registrada', 409);
                }
                if (!registroTieneContenido(proyectada)) {
                    return error('No se puede cerrar la actividad con el registro vacío: completa el detalle antes de cerrar', 409);
                }
                updates.estado = 'completada';
                // horaFin real = hora de cierre, en hora de Chile (igual que horaInicio).
                updates.horaFin = horaChileHHMM();
            } else {
                if (activity.estado === 'completada') {
                    return error('No se puede cambiar el estado de una actividad completada');
                }
                updates.estado = body.estado;
            }
        } else if (activity.estado === 'borrador' && Object.keys(updates).length > 0) {
            // Al completar un borrador sin estado explícito, pasa a programada.
            updates.estado = 'programada';
        }

        if (Object.keys(updates).length === 0) {
            return error('No se envió ningún campo editable');
        }
        updates.updatedAt = new Date().toISOString();

        // UpdateExpression dinámico (alias para palabras reservadas como fecha/estado).
        const setParts = [];
        const names = {};
        const values = {};
        Object.entries(updates).forEach(([campo, valor], i) => {
            setParts.push(`#f${i} = :v${i}`);
            names[`#f${i}`] = campo;
            values[`:v${i}`] = valor;
        });

        await docClient.send(new UpdateCommand({
            TableName: TABLE_NAME,
            Key: { activityId: id },
            UpdateExpression: `SET ${setParts.join(', ')}`,
            ExpressionAttributeNames: names,
            ExpressionAttributeValues: values,
        }));

        const actualizada = { ...activity, ...updates };

        // Si un borrador quedó programado con asistentes requeridos, se notifica
        // igual que al crear una actividad (aviso en el inbox de cada asistente).
        try {
            const requeridos = actualizada.asistentesRequeridos || [];
            if (activity.estado === 'borrador' && actualizada.estado === 'programada' && requeridos.length > 0) {
                await eventBus.emit('activity.created', {
                    activityId: id,
                    attendeeIds: requeridos,
                    createdBy: solicitanteId,
                    activityName: actualizada.titulo,
                    fecha: actualizada.fecha,
                    tipo: actualizada.tipo,
                    obraId: actualizada.obraId,
                });
            }
        } catch (eventError) {
            console.error('Error emitting activity.created event (patch):', eventError);
        }

        return success(actualizada);
    } catch (err) {
        console.error('Error patching activity:', err);
        return error(err.message, 500);
    }
};
