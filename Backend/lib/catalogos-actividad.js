// Catálogos de la planificación diaria (charlas/ART) y permisos de trabajo
// especiales. Los catálogos son configurables por tenant
// (tenant.reglas.catalogosActividad); estos son los valores de fábrica.
// Los checklists de permisos son fijos (no configurables) en esta fase.

const DEFAULT_CATALOGOS = {
    temas: [
        { codigo: 'ASEO_ORDEN', label: 'Aseo y orden' },
        { codigo: 'CARPINTERIA', label: 'Carpintería' },
        { codigo: 'FRAGUADO', label: 'Fraguado' },
        { codigo: 'HORMIGONADO', label: 'Hormigonado' },
        { codigo: 'EXCAVACIONES', label: 'Excavaciones' },
        { codigo: 'ENFIERRADURA', label: 'Enfierradura' },
        { codigo: 'ANDAMIOS', label: 'Armado y uso de andamios' },
        { codigo: 'INST_ELECTRICAS', label: 'Instalaciones eléctricas' },
        { codigo: 'TRABAJO_ALTURA', label: 'Trabajos en altura' },
        { codigo: 'IZAJE', label: 'Izaje y maniobras' },
        { codigo: 'DEMOLICION', label: 'Demolición' },
        { codigo: 'SOLDADURA', label: 'Soldadura' },
        { codigo: 'PINTURA', label: 'Pintura y terminaciones' },
        { codigo: 'MANEJO_CARGAS', label: 'Manejo manual de cargas' },
    ],
    recursos: [
        { codigo: 'BETONERA', label: 'Betonera' },
        { codigo: 'ANDAMIO', label: 'Andamio' },
        { codigo: 'ESMERIL', label: 'Esmeril angular' },
        { codigo: 'TALADRO', label: 'Taladro' },
        { codigo: 'SOLDADORA', label: 'Soldadora' },
        { codigo: 'GRUA', label: 'Grúa / equipo de izaje' },
        { codigo: 'HERRAMIENTAS_MANO', label: 'Herramientas de mano' },
        { codigo: 'PLATAFORMA_ELEVADORA', label: 'Plataforma elevadora' },
        { codigo: 'GENERADOR', label: 'Generador' },
        { codigo: 'COMPRESOR', label: 'Compresor' },
    ],
    riesgos: [
        { codigo: 'CAIDA_DESNIVEL', label: 'Caída a desnivel' },
        { codigo: 'CAIDA_NIVEL', label: 'Caída a nivel' },
        { codigo: 'GOLPES', label: 'Golpes por o contra objetos' },
        { codigo: 'ATRAPAMIENTO', label: 'Atrapamiento' },
        { codigo: 'CONTACTO_ELECTRICO', label: 'Contacto eléctrico' },
        { codigo: 'PROYECCION_PARTICULAS', label: 'Proyección de partículas' },
        { codigo: 'SOBREESFUERZO', label: 'Sobreesfuerzo' },
        { codigo: 'RUIDO', label: 'Exposición a ruido' },
        { codigo: 'POLVO_SILICE', label: 'Exposición a polvo / sílice' },
        { codigo: 'RADIACION_UV', label: 'Exposición a radiación UV' },
        { codigo: 'INCENDIO_EXPLOSION', label: 'Incendio o explosión' },
        { codigo: 'ATROPELLO', label: 'Atropello por maquinaria' },
    ],
    medidas: [
        { codigo: 'USO_EPP', label: 'Uso de EPP' },
        { codigo: 'REVISION_PLATAFORMAS', label: 'Revisión de plataformas' },
        { codigo: 'PROTOCOLOS_PTS', label: 'Aplicación de protocolos / PTS' },
        { codigo: 'CHEQUEO_HERRAMIENTAS', label: 'Chequeo de herramientas' },
        { codigo: 'SENALIZACION', label: 'Señalización y segregación de áreas' },
        { codigo: 'BLOQUEO_ENERGIAS', label: 'Bloqueo de energías (LOTO)' },
        { codigo: 'ORDEN_ASEO', label: 'Orden y aseo' },
        { codigo: 'HIDRATACION', label: 'Hidratación y pausas' },
        { codigo: 'VENTILACION', label: 'Ventilación' },
        { codigo: 'SUPERVISION', label: 'Supervisión permanente' },
    ],
};

const CATALOGO_KEYS = ['temas', 'recursos', 'riesgos', 'medidas'];
const TIPOS_TRABAJO = ['interior', 'exterior'];
const CONDICIONES_CLIMATICAS = ['despejado', 'parcial', 'nublado', 'lluvia'];
// Tipos de actividad cuya planificación diaria exige tema tratado.
const TIPOS_CON_PLANIFICACION = ['CHARLA_5MIN', 'ART'];

const PERMISOS_TRABAJO_DEF = {
    ALTURA: {
        label: 'Trabajo en altura',
        checklist: [
            { key: 'arnes_inspeccionado', label: 'Arnés y cabo de vida inspeccionados' },
            { key: 'anclajes_definidos', label: 'Puntos de anclaje / línea de vida definidos' },
            { key: 'plataformas_revisadas', label: 'Plataformas y andamios revisados' },
            { key: 'examen_altura_vigente', label: 'Examen de altura vigente del personal' },
            { key: 'area_delimitada', label: 'Delimitación del área bajo el trabajo' },
        ],
    },
    ESPACIO_CONFINADO: {
        label: 'Espacio confinado',
        checklist: [
            { key: 'medicion_gases', label: 'Medición de gases realizada' },
            { key: 'ventilacion', label: 'Ventilación asegurada' },
            { key: 'vigia_exterior', label: 'Vigía asignado en el exterior' },
            { key: 'comunicacion_rescate', label: 'Medios de comunicación y rescate disponibles' },
            { key: 'energias_bloqueadas', label: 'Energías bloqueadas (LOTO)' },
        ],
    },
    TRABAJO_CALIENTE: {
        label: 'Trabajo en caliente',
        checklist: [
            { key: 'extintor_area', label: 'Extintor disponible en el área' },
            { key: 'combustibles_retirados', label: 'Combustibles retirados o cubiertos' },
            { key: 'pantallas_instaladas', label: 'Biombos o pantallas instalados' },
            { key: 'vigia_fuego', label: 'Vigía de fuego durante y después del trabajo' },
            { key: 'chequeo_final', label: 'Chequeo del área al finalizar' },
        ],
    },
};

const MAX_ITEMS_POR_LISTA = 100;
const MAX_LABEL = 80;
const MAX_OTRO = 200;
const MAX_UBICACION = 200;
const MAX_OBSERVACIONES = 4000;
const HORA_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

const normalizeCodigo = (raw) => String(raw || '')
    .trim().toUpperCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');

/**
 * Valida y normaliza el catálogo enviado por el tenant. Lanza Error con
 * mensaje descriptivo si la estructura es inválida (el handler lo devuelve
 * como 400).
 */
const sanitizeCatalogosActividad = (input) => {
    if (!input || typeof input !== 'object') throw new Error('Catálogo inválido: se espera un objeto con temas, recursos, riesgos y medidas');
    const out = {};
    for (const key of CATALOGO_KEYS) {
        const lista = input[key];
        if (!Array.isArray(lista)) throw new Error(`Catálogo inválido: "${key}" debe ser una lista`);
        if (lista.length > MAX_ITEMS_POR_LISTA) throw new Error(`Catálogo inválido: "${key}" supera el máximo de ${MAX_ITEMS_POR_LISTA} ítems`);
        const vistos = new Set();
        out[key] = lista.map((item) => {
            const codigo = normalizeCodigo(item?.codigo || item?.label);
            const label = String(item?.label || '').trim();
            if (!codigo) throw new Error(`Catálogo inválido: ítem de "${key}" sin código`);
            if (!label) throw new Error(`Catálogo inválido: el ítem "${codigo}" de "${key}" no tiene label`);
            if (label.length > MAX_LABEL) throw new Error(`Catálogo inválido: label de "${codigo}" supera ${MAX_LABEL} caracteres`);
            if (vistos.has(codigo)) throw new Error(`Catálogo inválido: código duplicado "${codigo}" en "${key}"`);
            vistos.add(codigo);
            return { codigo, label };
        });
    }
    return out;
};

/**
 * Catálogos efectivos de un tenant: su lista si existe y no está vacía,
 * el default de fábrica en caso contrario (lista por lista).
 */
const resolveCatalogos = (tenant) => {
    const propios = tenant?.reglas?.catalogosActividad || {};
    const out = {};
    for (const key of CATALOGO_KEYS) {
        out[key] = (Array.isArray(propios[key]) && propios[key].length) ? propios[key] : DEFAULT_CATALOGOS[key];
    }
    return out;
};

const validarSeleccion = (nombre, input, catalogo, errores) => {
    const codigos = [];
    if (Array.isArray(input?.codigos) && input.codigos.length > MAX_ITEMS_POR_LISTA) {
        errores.push(`${nombre}: demasiados códigos seleccionados`);
    } else {
        for (const c of (Array.isArray(input?.codigos) ? input.codigos : [])) {
            const cod = String(c || '').trim();
            if (!catalogo.some((i) => i.codigo === cod)) errores.push(`${nombre}: código desconocido "${cod}"`);
            else if (!codigos.includes(cod)) codigos.push(cod);
        }
    }
    let otro = input?.otro == null ? null : String(input.otro).trim() || null;
    if (otro && otro.length > MAX_OTRO) { errores.push(`${nombre}: "otro" supera ${MAX_OTRO} caracteres`); otro = null; }
    return { codigos, otro };
};

/**
 * Valida y normaliza el bloque de planificación diaria de una actividad.
 * El tema tratado (código del catálogo u "otro" libre) es obligatorio para
 * CHARLA_5MIN y ART; el resto de campos es opcional. protectorSolar solo
 * tiene sentido en trabajo exterior: en cualquier otro caso queda null.
 */
const validatePlanificacion = (input, catalogos, tipoActividad) => {
    const errores = [];
    const requiereTema = TIPOS_CON_PLANIFICACION.includes(tipoActividad);
    if (input == null) {
        if (requiereTema) errores.push('La planificación con tema tratado es obligatoria para este tipo de actividad');
        return { value: null, errores };
    }
    if (typeof input !== 'object') return { value: null, errores: ['planificacion debe ser un objeto'] };

    const temaCodigo = input.tema?.codigo ? String(input.tema.codigo).trim() : null;
    let temaOtro = input.tema?.otro ? String(input.tema.otro).trim() : null;
    if (temaCodigo && !catalogos.temas.some((t) => t.codigo === temaCodigo)) {
        errores.push(`Tema tratado: código desconocido "${temaCodigo}"`);
    }
    if (temaOtro && temaOtro.length > MAX_OTRO) { errores.push(`Tema tratado: "otro" supera ${MAX_OTRO} caracteres`); temaOtro = null; }
    if (requiereTema && !temaCodigo && !temaOtro) errores.push('El tema tratado es obligatorio (elige uno del listado o escribe otro)');

    const recursos = validarSeleccion('Recursos', input.recursos, catalogos.recursos, errores);
    const riesgos = validarSeleccion('Riesgos', input.riesgos, catalogos.riesgos, errores);
    const medidas = validarSeleccion('Medidas de prevención', input.medidas, catalogos.medidas, errores);

    const tipoTrabajo = input.tipoTrabajo == null ? null : String(input.tipoTrabajo);
    if (tipoTrabajo && !TIPOS_TRABAJO.includes(tipoTrabajo)) errores.push(`Tipo de trabajo inválido: "${tipoTrabajo}"`);
    const condicionClimatica = input.condicionClimatica == null ? null : String(input.condicionClimatica);
    if (condicionClimatica && !CONDICIONES_CLIMATICAS.includes(condicionClimatica)) errores.push(`Condición climática inválida: "${condicionClimatica}"`);

    const protectorSolar = tipoTrabajo === 'exterior' && typeof input.protectorSolar === 'boolean'
        ? input.protectorSolar : null;

    const observaciones = String(input.observaciones || '').trim();
    if (observaciones.length > MAX_OBSERVACIONES) errores.push(`Observaciones supera ${MAX_OBSERVACIONES} caracteres`);

    return {
        errores,
        value: errores.length ? null : {
            tema: { codigo: temaCodigo, otro: temaOtro },
            recursos, riesgos, medidas,
            tipoTrabajo: TIPOS_TRABAJO.includes(tipoTrabajo) ? tipoTrabajo : null,
            condicionClimatica: CONDICIONES_CLIMATICAS.includes(condicionClimatica) ? condicionClimatica : null,
            protectorSolar,
            observaciones,
        },
    };
};

/**
 * Valida y normaliza los permisos de trabajo especiales embebidos en una
 * actividad. `responsablesValidos` es el set de personaIds del tenant ya
 * verificados por el handler. `completo` lo calcula SIEMPRE el backend:
 * checklist íntegramente respondido + responsable + horario.
 */
const validatePermisosTrabajo = (input, responsablesValidos) => {
    const errores = [];
    if (input == null) return { value: [], errores };
    if (!Array.isArray(input)) return { value: [], errores: ['permisosTrabajo debe ser una lista'] };
    const tiposVistos = new Set();
    const value = [];
    for (const p of input) {
        const tipo = String(p?.tipo || '');
        const def = PERMISOS_TRABAJO_DEF[tipo];
        if (!def) { errores.push(`Permiso de trabajo desconocido: "${tipo}"`); continue; }
        if (tiposVistos.has(tipo)) { errores.push(`Permiso duplicado: "${tipo}"`); continue; }
        tiposVistos.add(tipo);

        const responsableId = String(p?.responsableId || '').trim();
        if (!responsableId) errores.push(`${def.label}: falta el responsable`);
        else if (!responsablesValidos.has(responsableId)) errores.push(`${def.label}: el responsable no pertenece a la empresa`);

        const horaInicio = String(p?.horaInicio || '').trim();
        const horaFin = String(p?.horaFin || '').trim();
        if (horaInicio && !HORA_RE.test(horaInicio)) errores.push(`${def.label}: hora de inicio inválida`);
        if (horaFin && !HORA_RE.test(horaFin)) errores.push(`${def.label}: hora de término inválida`);
        if (HORA_RE.test(horaInicio) && HORA_RE.test(horaFin) && horaFin <= horaInicio) {
            errores.push(`${def.label}: la hora de término debe ser posterior a la de inicio`);
        }

        const ubicacion = String(p?.ubicacion || '').trim();
        if (ubicacion.length > MAX_UBICACION) errores.push(`${def.label}: ubicación supera ${MAX_UBICACION} caracteres`);

        const checklist = {};
        const keysDef = def.checklist.map((i) => i.key);
        for (const [k, v] of Object.entries(p?.checklist || {})) {
            if (!keysDef.includes(k)) { errores.push(`${def.label}: ítem de checklist desconocido "${k}"`); continue; }
            if (!['si', 'no', 'na'].includes(v)) { errores.push(`${def.label}: respuesta inválida en "${k}"`); continue; }
            checklist[k] = v;
        }

        const completo = Boolean(
            responsableId && responsablesValidos.has(responsableId)
            && HORA_RE.test(horaInicio) && HORA_RE.test(horaFin)
            && keysDef.every((k) => checklist[k])
        );

        value.push({
            tipo, responsableId,
            responsableNombre: String(p?.responsableNombre || '').trim(),
            horaInicio, horaFin, ubicacion, checklist, completo,
        });
    }
    return { value: errores.length ? [] : value, errores };
};

module.exports = {
    DEFAULT_CATALOGOS,
    PERMISOS_TRABAJO_DEF,
    TIPOS_CON_PLANIFICACION,
    sanitizeCatalogosActividad,
    resolveCatalogos,
    validatePlanificacion,
    validatePermisosTrabajo,
};
