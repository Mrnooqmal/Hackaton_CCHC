// Fase 2 del rediseño de incidentes: las reglas de los papeles de un caso.
//
// `lib/casos.js` es la fuente única de "qué papeles exige cada caso y cuánto
// falta"; `Frontend/src/utils/casos.ts` es su espejo. Esta prueba fija las
// reglas de cada tipo de caso y, con los mismos casos, exige que el espejo dé lo
// mismo: si alguien cambia una regla en un lado y no en el otro, la pantalla y el
// servidor discreparían sobre si un caso está completo.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const C = require('../lib/casos');
const { cargarTs } = require('./cargar-ts');

const claves = (inc) => C.papelesRequeridos(inc).map((p) => p.clave);
const cumplido = (inc, clave) => C.papelesRequeridos(inc).find((p) => p.clave === clave)?.cumplido;

// Un papel subido: solo importa su tipo para las reglas.
const papel = (tipo) => ({ tipo, s3Key: `tenants/t/incidentes/i/papeles/${tipo}-x.pdf` });

const CASOS = {
    hallazgoVacio: { clasificacion: 'hallazgo', tipo: 'condicion_subestandar', evidencias: [], gobernanza: { responsableId: null, plazoRespuestaISO: null, comentarioCierre: null } },
    hallazgoSinGobernanza: { clasificacion: 'hallazgo', tipo: 'accion_subestandar' },
    hallazgoCompleto: {
        clasificacion: 'hallazgo', tipo: 'condicion_subestandar', evidencias: ['k1'],
        gobernanza: { responsableId: 'p-1', plazoRespuestaISO: '2026-12-01', comentarioCierre: 'Se reparó la baranda' },
    },
    hallazgoSoloResponsable: { clasificacion: 'hallazgo', tipo: 'condicion_subestandar', evidencias: ['k1'], gobernanza: { responsableId: 'p-1', plazoRespuestaISO: null, comentarioCierre: '   ' } },
    hallazgoSinClasificacion: { tipo: 'condicion_subestandar', evidencias: ['k1'] },
    incidente: { clasificacion: 'incidente', tipo: 'incidente' },
    incidenteAltoPotencial: { clasificacion: 'incidente', tipo: 'incidente', altoPotencial: true },
    incidenteAltoPotencialConInforme: { clasificacion: 'incidente', tipo: 'incidente', altoPotencial: true, papeles: [papel('informe_investigacion')] },
    incidenteAltoPotencialTexto: { clasificacion: 'incidente', tipo: 'incidente', altoPotencial: 'true' },
    accidenteLeve: { clasificacion: 'incidente', tipo: 'accidente', gravedad: 'leve' },
    accidenteLeveCompleto: {
        clasificacion: 'incidente', tipo: 'accidente', gravedad: 'leve',
        papeles: [papel('diat'), papel('informe_investigacion'), papel('plan_medidas')],
    },
    // Medidas guardadas antes de que se definieran con el plan: cuentan como el plan cumplido.
    accidenteConMedidasAntiguas: {
        clasificacion: 'incidente', tipo: 'accidente', gravedad: 'leve', medidasCorrectivas: [{ numero: 1, medida: 'Instalar baranda', estado: 'pendiente' }],
        papeles: [papel('diat'), papel('informe_investigacion')],
    },
    accidenteConListaDeMedidasVacia: { clasificacion: 'incidente', tipo: 'accidente', gravedad: 'leve', medidasCorrectivas: [] },
    incidenteConPlan: { clasificacion: 'incidente', tipo: 'incidente', papeles: [papel('plan_medidas')] },
    incidenteAltoPotencialConPlan: { clasificacion: 'incidente', tipo: 'incidente', altoPotencial: true, papeles: [papel('plan_medidas')] },
    hallazgoConPlan: {
        clasificacion: 'hallazgo', tipo: 'condicion_subestandar', evidencias: ['k1'], papeles: [papel('plan_medidas')],
        gobernanza: { responsableId: 'p-1', plazoRespuestaISO: '2026-12-01', comentarioCierre: null },
    },
    accidenteGrave: { clasificacion: 'incidente', tipo: 'accidente', gravedad: 'grave', papeles: [papel('diat')] },
    accidenteFatal: { clasificacion: 'incidente', tipo: 'accidente', gravedad: 'fatal' },
    accidenteFatalCompleto: {
        clasificacion: 'incidente', tipo: 'accidente', gravedad: 'fatal',
        papeles: [papel('diat'), papel('informe_investigacion'), papel('plan_medidas'), papel('constancia_aviso_autoridad'), papel('diep'), papel('otro')],
    },
    accidenteConOtroNoCuenta: { clasificacion: 'incidente', tipo: 'accidente', gravedad: 'leve', papeles: [papel('otro'), papel('diep')] },
    vacio: {},
};

test('hallazgo: foto, responsable y plazo, comentario de cierre', () => {
    assert.deepEqual(claves(CASOS.hallazgoVacio), ['foto', 'responsable_plazo', 'comentario_cierre']);
    assert.deepEqual(C.papelesRequeridos(CASOS.hallazgoVacio).map((p) => p.cumplido), [false, false, false]);
    assert.deepEqual(C.papelesRequeridos(CASOS.hallazgoCompleto).map((p) => p.cumplido), [true, true, true]);
    // Responsable sin plazo no cumple; un comentario en blanco tampoco.
    assert.deepEqual(C.papelesRequeridos(CASOS.hallazgoSoloResponsable).map((p) => p.cumplido), [true, false, false]);
    assert.deepEqual(claves(CASOS.hallazgoSinGobernanza), ['foto', 'responsable_plazo', 'comentario_cierre']);
    // Sin `clasificacion` (anterior al campo) se deriva del tipo.
    assert.deepEqual(claves(CASOS.hallazgoSinClasificacion), ['foto', 'responsable_plazo', 'comentario_cierre']);
    // Ninguno de los tres se cumple con un archivo: son datos del reporte.
    assert.ok(C.papelesRequeridos(CASOS.hallazgoVacio).every((p) => p.tipoDocumento === null));
    assert.deepEqual(C.avanceDelCaso(CASOS.hallazgoCompleto), { cumplidos: 3, total: 3, porcentaje: 100 });
    assert.deepEqual(C.avanceDelCaso(CASOS.hallazgoSoloResponsable), { cumplidos: 1, total: 3, porcentaje: 33 });
});

test('incidente: el informe de investigación solo si es de alto potencial; el campo ausente cuenta como no requerido', () => {
    assert.deepEqual(claves(CASOS.incidente), []);
    assert.deepEqual(claves(CASOS.incidenteAltoPotencial), ['informe_investigacion']);
    assert.equal(cumplido(CASOS.incidenteAltoPotencial, 'informe_investigacion'), false);
    assert.equal(cumplido(CASOS.incidenteAltoPotencialConInforme, 'informe_investigacion'), true);
    // Solo `true` exacto lo exige.
    assert.deepEqual(claves(CASOS.incidenteAltoPotencialTexto), []);
    assert.deepEqual(claves({ tipo: 'incidente', altoPotencial: false }), []);
});

test('accidente: DIAT, informe de investigación y plan de medidas correctivas', () => {
    assert.deepEqual(claves(CASOS.accidenteLeve), ['diat', 'informe_investigacion', 'plan_medidas']);
    assert.deepEqual(C.papelesRequeridos(CASOS.accidenteLeve).map((p) => p.cumplido), [false, false, false]);
    assert.deepEqual(C.papelesRequeridos(CASOS.accidenteLeveCompleto).map((p) => p.cumplido), [true, true, true]);
    assert.deepEqual(C.papelesRequeridos(CASOS.accidenteLeve).map((p) => p.tipoDocumento), ['diat', 'informe_investigacion', 'plan_medidas']);
    assert.equal(C.papelesRequeridos(CASOS.accidenteLeve)[2].etiqueta, 'Plan de medidas correctivas');
    // Sin el plan, el accidente no está completo (ya no basta con "una medida" como dato del caso).
    assert.equal(cumplido(CASOS.accidenteLeve, 'plan_medidas'), false);
    assert.equal(cumplido(CASOS.accidenteLeveCompleto, 'plan_medidas'), true);
    assert.equal(cumplido(CASOS.accidenteConListaDeMedidasVacia, 'plan_medidas'), false);
    // Otro papel (la DIAT, el informe, un respaldo libre) no cumple el plan.
    assert.equal(cumplido({ ...CASOS.accidenteLeve, papeles: [papel('diat'), papel('informe_investigacion'), papel('otro')] }, 'plan_medidas'), false);
    // Un respaldo libre y la DIEP no cumplen la DIAT.
    assert.equal(cumplido(CASOS.accidenteConOtroNoCuenta, 'diat'), false);
    // La DIEP no se exige en ningún caso.
    for (const inc of Object.values(CASOS)) assert.ok(!claves(inc).includes('diep'), JSON.stringify(inc));
});

test('accidente grave o fatal: además la constancia del aviso a la Inspección del Trabajo y a la SEREMI de Salud', () => {
    for (const inc of [CASOS.accidenteGrave, CASOS.accidenteFatal]) {
        assert.deepEqual(claves(inc), ['diat', 'informe_investigacion', 'plan_medidas', 'constancia_aviso_autoridad']);
    }
    assert.equal(cumplido(CASOS.accidenteGrave, 'diat'), true);
    assert.equal(cumplido(CASOS.accidenteGrave, 'constancia_aviso_autoridad'), false);
    assert.deepEqual(C.avanceDelCaso(CASOS.accidenteFatalCompleto), { cumplidos: 4, total: 4, porcentaje: 100 });
    // Un incidente grave (no accidente) no la exige.
    assert.deepEqual(claves({ tipo: 'incidente', gravedad: 'grave' }), []);
});

test('accidente con medidas guardadas antes: cuenta como el plan cumplido, para no trabar los casos existentes', () => {
    assert.equal(cumplido(CASOS.accidenteConMedidasAntiguas, 'plan_medidas'), true);
    assert.deepEqual(C.papelesRequeridos(CASOS.accidenteConMedidasAntiguas).map((p) => p.cumplido), [true, true, true]);
    assert.deepEqual(C.avanceDelCaso(CASOS.accidenteConMedidasAntiguas), { cumplidos: 3, total: 3, porcentaje: 100 });
    // El estado de esas medidas no importa: ya no hay "medidas por terminar".
    assert.equal(cumplido({ ...CASOS.accidenteConMedidasAntiguas, medidasCorrectivas: [{ numero: 1, estado: 'en_proceso' }] }, 'plan_medidas'), true);
});

test('el plan de medidas no se exige en incidentes ni en hallazgos: se puede subir como respaldo, sin exigirse', () => {
    assert.deepEqual(claves(CASOS.incidenteConPlan), []);
    assert.deepEqual(claves(CASOS.incidenteAltoPotencialConPlan), ['informe_investigacion']);
    assert.deepEqual(claves(CASOS.hallazgoConPlan), ['foto', 'responsable_plazo', 'comentario_cierre']);
    for (const inc of [CASOS.incidente, CASOS.incidenteAltoPotencial, CASOS.hallazgoVacio, CASOS.hallazgoCompleto]) {
        assert.ok(!claves(inc).includes('plan_medidas'), JSON.stringify(inc));
    }
    // Subirlo no cambia el avance de un caso que no lo exige.
    assert.deepEqual(C.avanceDelCaso(CASOS.incidenteConPlan), { cumplidos: 0, total: 0, porcentaje: 100 });
    assert.deepEqual(C.avanceDelCaso(CASOS.hallazgoConPlan), { cumplidos: 2, total: 3, porcentaje: 67 });
    // El tipo existe en el catálogo, sin datos de salud, y se acepta como papel.
    assert.equal(C.esTipoPapel('plan_medidas'), true);
    assert.equal(C.tipoPapelConSalud('plan_medidas'), false);
    assert.equal(C.etiquetaTipoPapel('plan_medidas'), 'Plan de medidas correctivas');
});

test('avance: sin papeles requeridos el total es 0 y el porcentaje 100 (no se divide por cero)', () => {
    assert.deepEqual(C.avanceDelCaso(CASOS.incidente), { cumplidos: 0, total: 0, porcentaje: 100 });
    assert.deepEqual(C.avanceDelCaso(null), { cumplidos: 0, total: 0, porcentaje: 100 });
    assert.deepEqual(C.avanceDelCaso(CASOS.accidenteGrave), { cumplidos: 1, total: 4, porcentaje: 25 });
    assert.deepEqual(C.avanceDelCaso(CASOS.accidenteLeveCompleto), { cumplidos: 3, total: 3, porcentaje: 100 });
    assert.deepEqual(C.avanceDelCaso(CASOS.accidenteLeve), { cumplidos: 0, total: 3, porcentaje: 0 });
});

test('el catálogo: seis tipos, la DIAT y la DIEP con datos de salud, "otro" nunca obligatorio', () => {
    assert.deepEqual(C.ORDEN_TIPOS_PAPEL, ['diat', 'diep', 'informe_investigacion', 'plan_medidas', 'constancia_aviso_autoridad', 'otro']);
    assert.deepEqual(Object.keys(C.TIPOS_PAPEL).sort(), [...C.ORDEN_TIPOS_PAPEL].sort());
    for (const t of C.ORDEN_TIPOS_PAPEL) assert.ok(C.TIPOS_PAPEL[t].etiqueta.length > 3, t);
    assert.deepEqual(C.ORDEN_TIPOS_PAPEL.filter(C.tipoPapelConSalud), ['diat', 'diep']);
    assert.equal(C.esTipoPapel('diat'), true);
    for (const malo of ['DIAT', 'foto', '', 'constructor', '__proto__', null, undefined, 3]) assert.equal(C.esTipoPapel(malo), false, String(malo));
    for (const inc of Object.values(CASOS)) assert.ok(!C.papelesRequeridos(inc).some((p) => p.tipoDocumento === 'otro'), JSON.stringify(inc));
});

test('el espejo del frontend (utils/casos.ts) da lo mismo que lib/casos.js, caso por caso', () => {
    const E = cargarTs('casos.ts');
    for (const [nombre, inc] of Object.entries(CASOS)) {
        assert.deepEqual(E.papelesRequeridos(inc), C.papelesRequeridos(inc), nombre);
        assert.deepEqual(E.avanceDelCaso(inc), C.avanceDelCaso(inc), nombre);
        assert.equal(E.esHallazgo(inc), C.esHallazgo(inc), nombre);
    }
    assert.deepEqual(E.avanceDelCaso(null), C.avanceDelCaso(null));
    assert.deepEqual(E.TIPOS_PAPEL, C.TIPOS_PAPEL);
    assert.deepEqual(E.ORDEN_TIPOS_PAPEL, C.ORDEN_TIPOS_PAPEL);
    assert.deepEqual(E.EXTENSION_POR_MIME, C.EXTENSION_POR_MIME);
    assert.deepEqual(E.MIME_PAPELES, C.MIME_PAPELES);
    assert.equal(E.MAX_BYTES_PAPEL, C.MAX_BYTES_PAPEL);
    assert.equal(E.MAX_PAPELES_POR_CASO, C.MAX_PAPELES_POR_CASO);
    for (const t of [...C.ORDEN_TIPOS_PAPEL, 'zzz', null]) {
        assert.equal(E.etiquetaTipoPapel(t), C.etiquetaTipoPapel(t), String(t));
        assert.equal(E.tipoPapelConSalud(t), C.tipoPapelConSalud(t), String(t));
        assert.equal(E.esTipoPapel(t), C.esTipoPapel(t), String(t));
    }
});

// ── Fase 3: siguiente paso y cierre ─────────────────────────────────

const { PERMISSIONS } = require('../lib/permissions');

const CLASIFICADO = { tipo: 'condicion_subestandar' };
const paso = (inc) => C.siguientePaso(inc).paso;
const med = (estado, numero = 1) => ({ numero, medida: 'Instalar baranda', estado });

// Un caso por tipo y etapa. El nombre dice dónde está el caso.
const ETAPAS = {
    sinClasificarHallazgo: { clasificacion: 'hallazgo', tipo: 'condicion_subestandar', evidencias: ['k'] },
    sinClasificarIncidente: { clasificacion: 'incidente', tipo: 'incidente' },
    sinClasificarAccidente: { clasificacion: 'incidente', tipo: 'accidente', gravedad: 'grave' },
    // Hallazgo clasificado: falta responsable y plazo (no es un archivo, pero cerrar lo exige).
    hallazgoSinResponsable: { clasificacion: 'hallazgo', tipo: 'condicion_subestandar', triaje: CLASIFICADO, evidencias: ['k'], gobernanza: { responsableId: null, plazoRespuestaISO: null, estadoCierre: 'en_proceso' } },
    hallazgoSinFoto: { clasificacion: 'hallazgo', tipo: 'condicion_subestandar', triaje: CLASIFICADO, evidencias: [], gobernanza: { responsableId: 'p', plazoRespuestaISO: '2026-12-01', estadoCierre: 'en_proceso' } },
    // El comentario de cierre solo se cumple al cerrar: no puede trabar el paso de cerrar.
    hallazgoListoParaCerrar: { clasificacion: 'hallazgo', tipo: 'condicion_subestandar', triaje: CLASIFICADO, evidencias: ['k'], gobernanza: { responsableId: 'p', plazoRespuestaISO: '2026-12-01', estadoCierre: 'en_proceso', comentarioCierre: null } },
    // Las medidas guardadas antes ya no tienen estado que cumplir: una "en proceso" no frena el cierre.
    hallazgoConMedidaAntigua: { clasificacion: 'hallazgo', tipo: 'condicion_subestandar', triaje: CLASIFICADO, evidencias: ['k'], gobernanza: { responsableId: 'p', plazoRespuestaISO: '2026-12-01', estadoCierre: 'en_proceso' }, medidasCorrectivas: [med('completada'), med('en_proceso', 2)] },
    hallazgoCerrado: { clasificacion: 'hallazgo', tipo: 'condicion_subestandar', triaje: CLASIFICADO, evidencias: ['k'], gobernanza: { estadoCierre: 'cerrado', comentarioCierre: 'Listo' } },
    incidenteListoParaCerrar: { clasificacion: 'incidente', tipo: 'incidente', triaje: { tipo: 'incidente' }, altoPotencial: false, estado: 'en_investigacion' },
    incidenteAltoPotencialSinInforme: { clasificacion: 'incidente', tipo: 'incidente', triaje: { tipo: 'incidente' }, altoPotencial: true, estado: 'en_investigacion' },
    incidenteAltoPotencialCompleto: { clasificacion: 'incidente', tipo: 'incidente', triaje: { tipo: 'incidente' }, altoPotencial: true, estado: 'en_investigacion', papeles: [papel('informe_investigacion')] },
    incidenteCerrado: { clasificacion: 'incidente', tipo: 'incidente', triaje: { tipo: 'incidente' }, estado: 'cerrado' },
    accidenteSinDiat: { clasificacion: 'incidente', tipo: 'accidente', gravedad: 'leve', triaje: { tipo: 'accidente' }, estado: 'en_investigacion' },
    accidenteSinPlan: { clasificacion: 'incidente', tipo: 'accidente', gravedad: 'leve', triaje: { tipo: 'accidente' }, estado: 'en_investigacion', papeles: [papel('diat'), papel('informe_investigacion')] },
    accidenteConMedidaAntiguaSinTerminar: { clasificacion: 'incidente', tipo: 'accidente', gravedad: 'leve', triaje: { tipo: 'accidente' }, estado: 'en_investigacion', papeles: [papel('diat'), papel('informe_investigacion')], medidasCorrectivas: [med('pendiente')] },
    accidenteListoParaCerrar: { clasificacion: 'incidente', tipo: 'accidente', gravedad: 'leve', triaje: { tipo: 'accidente' }, estado: 'en_investigacion', papeles: [papel('diat'), papel('informe_investigacion'), papel('plan_medidas')] },
    graveSinConstancia: { clasificacion: 'incidente', tipo: 'accidente', gravedad: 'grave', triaje: { tipo: 'accidente' }, estado: 'en_investigacion', papeles: [papel('diat'), papel('informe_investigacion'), papel('plan_medidas')] },
    accidenteCerrado: { clasificacion: 'incidente', tipo: 'accidente', gravedad: 'leve', triaje: { tipo: 'accidente' }, estado: 'cerrado' },
    // Un hallazgo con `estado` cerrado también cuenta como cerrado.
    hallazgoCerradoPorEstado: { clasificacion: 'hallazgo', tipo: 'condicion_subestandar', triaje: CLASIFICADO, estado: 'cerrado' },
};

test('siguientePaso: clasificar, papeles, cerrar y cerrado (sin paso de medidas), para cada tipo de caso', () => {
    const esperado = {
        sinClasificarHallazgo: 'clasificar', sinClasificarIncidente: 'clasificar', sinClasificarAccidente: 'clasificar',
        hallazgoSinResponsable: 'papeles', hallazgoSinFoto: 'papeles', hallazgoListoParaCerrar: 'cerrar',
        hallazgoConMedidaAntigua: 'cerrar', hallazgoCerrado: 'cerrado', hallazgoCerradoPorEstado: 'cerrado',
        incidenteListoParaCerrar: 'cerrar', incidenteAltoPotencialSinInforme: 'papeles', incidenteAltoPotencialCompleto: 'cerrar', incidenteCerrado: 'cerrado',
        accidenteSinDiat: 'papeles', accidenteSinPlan: 'papeles', accidenteConMedidaAntiguaSinTerminar: 'cerrar', accidenteListoParaCerrar: 'cerrar',
        graveSinConstancia: 'papeles', accidenteCerrado: 'cerrado',
    };
    for (const [nombre, p] of Object.entries(esperado)) assert.equal(paso(ETAPAS[nombre]), p, nombre);
    // Ningún tipo de caso pasa por un paso de medidas.
    for (const [nombre, inc] of Object.entries(ETAPAS)) assert.notEqual(paso(inc), 'medidas', nombre);
    assert.deepEqual(Object.keys(esperado).sort(), Object.keys(ETAPAS).sort(), 'cada etapa de la tabla tiene su caso');
});

test('siguientePaso: devuelve paso, título, detalle y el permiso de quien lo hace', () => {
    for (const [nombre, inc] of Object.entries(ETAPAS)) {
        const s = C.siguientePaso(inc);
        assert.deepEqual(Object.keys(s).sort(), ['detalle', 'paso', 'permiso', 'titulo'], nombre);
        assert.ok(s.titulo.length > 3 && s.detalle.length > 3, nombre);
        const permiso = { clasificar: 'incidentes.calificar_accidente', papeles: 'incidentes.reportar', cerrar: 'incidentes.calificar_accidente', cerrado: null }[s.paso];
        assert.equal(s.permiso, permiso, nombre);
    }
    assert.match(C.siguientePaso(ETAPAS.sinClasificarHallazgo).detalle, /hallazgo/i);
    assert.match(C.siguientePaso(ETAPAS.graveSinConstancia).detalle, /Constancia del aviso/);
    assert.match(C.siguientePaso(ETAPAS.hallazgoSinResponsable).detalle, /Responsable y plazo/);
    // El plan de medidas de un accidente es un papel más: se pide en el paso de papeles.
    assert.match(C.siguientePaso(ETAPAS.accidenteSinPlan).detalle, /Plan de medidas correctivas/);
    assert.equal(C.siguientePaso(ETAPAS.accidenteSinPlan).paso, 'papeles');
    assert.match(C.siguientePaso(ETAPAS.accidenteListoParaCerrar).detalle, /plan de medidas correctivas/);
    assert.doesNotMatch(C.siguientePaso(ETAPAS.incidenteListoParaCerrar).detalle, /medidas/);
    assert.doesNotMatch(C.siguientePaso(ETAPAS.hallazgoListoParaCerrar).detalle, /medidas/);
    // Una medida antigua sin terminar ya no se pide completar.
    assert.doesNotMatch(C.siguientePaso(ETAPAS.accidenteConMedidaAntiguaSinTerminar).detalle, /sin completar/);
    // Sin datos: no se cae.
    assert.equal(paso(null), 'clasificar');
    assert.equal(paso({}), 'clasificar');
});

test('siguientePaso: el comentario de cierre de un hallazgo no bloquea el paso de cerrar', () => {
    // Sin comentario es un papel requerido incumplido, pero solo se cumple al cerrar.
    assert.equal(cumplido(ETAPAS.hallazgoListoParaCerrar, 'comentario_cierre'), false);
    assert.equal(paso(ETAPAS.hallazgoListoParaCerrar), 'cerrar');
});

test('pendientesDeCierre: lista legible de lo que falta; el comentario de la petición cuenta en un hallazgo', () => {
    assert.deepEqual(C.pendientesDeCierre(ETAPAS.accidenteListoParaCerrar, 'Cierre'), []);
    assert.deepEqual(C.pendientesDeCierre(ETAPAS.hallazgoListoParaCerrar, 'Se reparó'), []);
    // Sin comentario, el hallazgo lo echa de menos.
    assert.deepEqual(C.pendientesDeCierre(ETAPAS.hallazgoListoParaCerrar, ''), ['Falta: Comentario de cierre.']);
    const faltas = C.pendientesDeCierre(ETAPAS.sinClasificarAccidente, 'x');
    assert.ok(faltas.includes('Clasificar el reporte (tipo y gravedad).'));
    assert.ok(faltas.includes('Falta: DIAT.'));
    assert.ok(faltas.includes('Falta: Plan de medidas correctivas.'));
    assert.ok(faltas.some((f) => /Constancia del aviso/.test(f)));
    // Un accidente sin plan no cierra; con el plan, sí.
    assert.deepEqual(C.pendientesDeCierre(ETAPAS.accidenteSinPlan, 'x'), ['Falta: Plan de medidas correctivas.']);
    assert.deepEqual(C.pendientesDeCierre(ETAPAS.accidenteListoParaCerrar, 'x'), []);
    // Las medidas guardadas antes cuentan como el plan, y su estado ya no frena el cierre.
    assert.deepEqual(C.pendientesDeCierre(ETAPAS.accidenteConMedidaAntiguaSinTerminar, 'x'), []);
    assert.deepEqual(C.pendientesDeCierre({ ...ETAPAS.accidenteListoParaCerrar, medidasCorrectivas: [{ numero: 1, medida: 'Antigua' }] }, 'x'), []);
    assert.deepEqual(C.pendientesDeCierre(ETAPAS.hallazgoConMedidaAntigua, 'Se reparó'), []);
    // Incidente y hallazgo no exigen el plan, pero lo aceptan.
    assert.deepEqual(C.pendientesDeCierre(ETAPAS.incidenteListoParaCerrar, 'x'), []);
    assert.deepEqual(C.pendientesDeCierre({ ...ETAPAS.incidenteListoParaCerrar, papeles: [papel('plan_medidas')] }, 'x'), []);
    assert.deepEqual(C.pendientesDeCierre({ ...ETAPAS.hallazgoListoParaCerrar, papeles: [papel('plan_medidas')] }, 'Se reparó'), []);
});

test('estaCerrado: el hallazgo por su gobernanza (o su estado), el incidente por su estado', () => {
    assert.equal(C.estaCerrado(ETAPAS.hallazgoCerrado), true);
    assert.equal(C.estaCerrado(ETAPAS.hallazgoCerradoPorEstado), true);
    assert.equal(C.estaCerrado(ETAPAS.incidenteCerrado), true);
    assert.equal(C.estaCerrado(ETAPAS.hallazgoListoParaCerrar), false);
    assert.equal(C.estaCerrado(ETAPAS.incidenteListoParaCerrar), false);
    // La gobernanza de un incidente no lo cierra.
    assert.equal(C.estaCerrado({ clasificacion: 'incidente', gobernanza: { estadoCierre: 'cerrado' } }), false);
    assert.equal(C.estaCerrado(null), false);
});

test('los permisos del siguiente paso son los de PERMISSIONS, y los estados de las medidas antiguas son los esperados', () => {
    assert.equal(C.PERMISO_CLASIFICAR, PERMISSIONS.INCIDENTES_CALIFICAR_ACCIDENTE);
    assert.equal(C.PERMISO_GESTIONAR, PERMISSIONS.INCIDENTES_REPORTAR);
    // Las medidas ya no se crean: no hay catálogo de jerarquía ni topes de medidas.
    for (const sobrante of ['JERARQUIA_CONTROL', 'MAX_MEDIDAS_POR_CASO', 'MAX_TEXTO_MEDIDA']) assert.equal(C[sobrante], undefined, sobrante);
    assert.deepEqual(C.ESTADOS_MEDIDA, ['pendiente', 'en_proceso', 'completada', 'verificada']);
    assert.equal(C.medidaTerminada({ estado: 'completada' }), true);
    assert.equal(C.medidaTerminada({ estado: 'verificada' }), true);
    assert.equal(C.medidaTerminada({ estado: 'en_proceso' }), false);
    assert.equal(C.medidaTerminada({}), false);
});

test('el espejo del frontend da lo mismo en siguientePaso, pendientesDeCierre y estaCerrado, etapa por etapa', () => {
    const E = cargarTs('casos.ts');
    for (const [nombre, inc] of Object.entries(ETAPAS)) {
        assert.deepEqual(E.siguientePaso(inc), C.siguientePaso(inc), nombre);
        assert.deepEqual(E.pendientesDeCierre(inc, 'Comentario'), C.pendientesDeCierre(inc, 'Comentario'), nombre);
        assert.deepEqual(E.pendientesDeCierre(inc, ''), C.pendientesDeCierre(inc, ''), nombre);
        assert.equal(E.estaCerrado(inc), C.estaCerrado(inc), nombre);
    }
    for (const inc of [null, undefined, {}]) {
        assert.deepEqual(E.siguientePaso(inc), C.siguientePaso(inc));
        assert.deepEqual(E.pendientesDeCierre(inc, 'x'), C.pendientesDeCierre(inc, 'x'));
    }
    assert.equal(E.PERMISO_CLASIFICAR, C.PERMISO_CLASIFICAR);
    assert.equal(E.PERMISO_GESTIONAR, C.PERMISO_GESTIONAR);
    assert.deepEqual(E.ESTADOS_MEDIDA, C.ESTADOS_MEDIDA);
    for (const e of [...C.ESTADOS_MEDIDA, 'zzz', undefined]) assert.equal(E.medidaTerminada({ estado: e }), C.medidaTerminada({ estado: e }), String(e));
});

// ── Reglas compartidas: tipos, topes, fotos y papeles del contrato anterior ──

test('tipos, gravedades y topes: una sola definición en lib/casos.js, y el espejo del frontend dice lo mismo', () => {
    const E = cargarTs('casos.ts');
    assert.deepEqual(C.TIPOS_HALLAZGO, ['condicion_subestandar', 'accion_subestandar']);
    assert.deepEqual(C.TIPOS_INCIDENTE, ['accidente', 'incidente']);
    assert.deepEqual(C.GRAVEDADES, ['leve', 'grave', 'fatal']);
    assert.deepEqual(E.TIPOS_HALLAZGO, C.TIPOS_HALLAZGO);
    assert.deepEqual(E.TIPOS_INCIDENTE, C.TIPOS_INCIDENTE);
    assert.deepEqual(E.GRAVEDADES, C.GRAVEDADES);
    for (const tope of ['MAX_MEDIDAS_INMEDIATAS', 'MAX_COMENTARIO_CIERRE', 'MAX_MOTIVO_REAPERTURA', 'MAX_EVIDENCIAS_POR_ENVIO', 'MAX_EVIDENCIAS_TOTAL',
        'MAX_PAPELES_POR_CASO', 'MAX_BYTES_PAPEL']) {
        assert.equal(typeof C[tope], 'number', tope);
        assert.equal(E[tope], C[tope], `${tope}: el frontend y el backend tienen que coincidir`);
    }
    assert.deepEqual(E.EXTENSION_POR_MIME_FOTO, C.EXTENSION_POR_MIME_FOTO);
    assert.deepEqual(E.MIME_FOTOS, C.MIME_FOTOS);
    assert.deepEqual(E.EXTENSION_POR_MIME, C.EXTENSION_POR_MIME);
    assert.deepEqual(C.MIME_FOTOS, ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']);
    for (const tipo of [...C.TIPOS_HALLAZGO, ...C.TIPOS_INCIDENTE, 'otro', '', null, undefined]) {
        assert.equal(E.clasificacionDelTipo(tipo), C.clasificacionDelTipo(tipo), String(tipo));
    }
    assert.equal(C.clasificacionDelTipo('accion_subestandar'), 'hallazgo');
    assert.equal(C.clasificacionDelTipo('accidente'), 'incidente');
});

test('ningún otro archivo del módulo redefine esas reglas: todos usan lib/casos.js o su espejo', () => {
    const fs = require('fs');
    const path = require('path');
    const raiz = path.join(__dirname, '..', '..');
    const leer = (...p) => fs.readFileSync(path.join(raiz, ...p), 'utf8');
    const redefinicion = /(?:const|let|var)\s+(TIPOS_HALLAZGO|TIPOS_INCIDENTE|GRAVEDADES|HALLAZGOS|MAX_COMENTARIO_CIERRE|MAX_MOTIVO_REAPERTURA|MAX_MEDIDAS_INMEDIATAS|MAX_EVIDENCIAS_POR_ENVIO|MAX_EVIDENCIAS_TOTAL|MAX_FOTOS)\s*=\s*[\d[]/;
    const archivos = [
        ['Backend', 'handlers', 'incidents-module', 'handler.js'],
        ['Backend', 'handlers', 'incidents-module', 'incidents.repository.js'],
        ['Frontend', 'src', 'api', 'incidents.api.ts'],
        ['Frontend', 'src', 'components', 'CierreDelCaso.tsx'],
        ['Frontend', 'src', 'components', 'MedidasAnteriores.tsx'],
        ['Frontend', 'src', 'components', 'ClasificacionDelCaso.tsx'],
        ['Frontend', 'src', 'components', 'PapelesDelCaso.tsx'],
        ['Frontend', 'src', 'components', 'AgregarFotosAlCaso.tsx'],
        ['Frontend', 'src', 'pages', 'IncidentDetalle.tsx'],
        ['Frontend', 'src', 'pages', 'IncidentReportar.tsx'],
        ['Frontend', 'src', 'pages', 'Incidents.tsx'],
    ];
    for (const a of archivos) {
        const fuente = leer(...a);
        assert.doesNotMatch(fuente, redefinicion, `${a.join('/')} redefine una regla que vive en casos`);
        // `esHallazgo` y el cierre se importan, no se reescriben.
        assert.doesNotMatch(fuente, /const\s+esHallazgo\s*=/, `${a.join('/')} reescribe esHallazgo`);
    }
    // `incidenteCerrado` deriva de `estaCerrado`: una sola regla de cierre.
    assert.match(leer('Frontend', 'src', 'utils', 'incidentes.ts'), /incidenteCerrado[^\n]*estaCerrado\(/);
    // El handler no repite la comprobación de gestionar/subir.
    assert.doesNotMatch(leer('Backend', 'handlers', 'incidents-module', 'handler.js'), /rechazoParaSubirPapel/);
});

test('papelesDelCaso: los papeles del contrato anterior (documentos.diat / diep) cuentan y se leen sin migrar nada', () => {
    const E = cargarTs('casos.ts');
    const base = { tenantId: 'T1', incidentId: 'I1' };
    const anterior = (tipo, clave, extra = {}) => ({ [tipo]: { s3Key: clave, fileName: `${tipo}.pdf`, fileType: 'application/pdf', uploadedAt: '2026-05-01T12:00:00.000Z', ...extra } });
    const CLAVE = (tipo) => `tenants/T1/incidentes/I1/${tipo}-0b6f1c2e-3d4a-4b5c-8d9e-0f1a2b3c4d5e.pdf`;
    const accidente = { ...base, clasificacion: 'incidente', tipo: 'accidente', gravedad: 'leve' };
    const casos = {
        diatAnterior: { ...accidente, documentos: anterior('diat', CLAVE('diat')) },
        diatYDiep: { ...accidente, documentos: { ...anterior('diat', CLAVE('diat')), ...anterior('diep', CLAVE('diep')) } },
        claveAjena: { ...accidente, documentos: anterior('diat', 'tenants/OTRA/incidentes/I1/diat-x.pdf') },
        claveDeOtroIncidente: { ...accidente, documentos: anterior('diat', 'tenants/T1/incidentes/I2/diat-x.pdf') },
        claveConPuntos: { ...accidente, documentos: anterior('diat', 'tenants/T1/incidentes/I1/../I2/diat-x.pdf') },
        claveNoTexto: { ...accidente, documentos: anterior('diat', 42) },
        // El formato de diciembre de 2025 a septiembre de 2026: `{id}/documents/…`, sin empresa.
        claveAnteriorSinEmpresa: { ...accidente, documentos: anterior('diat', 'I1/documents/diat-0b6f1c2e-3d4a-4b5c-8d9e-0f1a2b3c4d5e.pdf') },
        claveAnteriorDeOtroIncidente: { ...accidente, documentos: anterior('diat', 'I2/documents/diat-0b6f1c2e-3d4a-4b5c-8d9e-0f1a2b3c4d5e.pdf') },
        claveAnteriorConPuntos: { ...accidente, documentos: anterior('diat', 'I1/documents/../I2/documents/diat-x.pdf') },
        claveAnteriorOtraCarpeta: { ...accidente, documentos: anterior('diat', 'I1/fotos/diat-x.pdf') },
        otroTipoNoCuenta: { ...accidente, documentos: anterior('informe_investigacion', CLAVE('informe')) },
        sinIdentidad: { clasificacion: 'incidente', tipo: 'accidente', gravedad: 'leve', documentos: anterior('diat', CLAVE('diat')) },
        documentosVacios: { ...accidente, documentos: {} },
        nuevoYAnterior: { ...accidente, documentos: anterior('diat', CLAVE('diat')), papeles: [{ tipo: 'diat', s3Key: CLAVE('diat') }, papel('informe_investigacion')] },
    };
    assert.equal(cumplido(casos.diatAnterior, 'diat'), true, 'la DIAT anterior cuenta');
    assert.equal(cumplido(casos.diatYDiep, 'diat'), true);
    assert.equal(cumplido(casos.claveAnteriorSinEmpresa, 'diat'), true, 'la clave de 2025 sin empresa cuenta');
    for (const n of ['claveAnteriorDeOtroIncidente', 'claveAnteriorConPuntos', 'claveAnteriorOtraCarpeta']) {
        assert.equal(cumplido(casos[n], 'diat'), false, n);
    }
    for (const n of ['claveAjena', 'claveDeOtroIncidente', 'claveConPuntos', 'claveNoTexto', 'otroTipoNoCuenta', 'sinIdentidad', 'documentosVacios']) {
        assert.equal(cumplido(casos[n], 'diat'), false, n);
    }
    // Cada archivo sale una vez, y el papel anterior sale con la forma de un papel nuevo.
    assert.deepEqual(C.papelesDelCaso(casos.nuevoYAnterior).map((p) => p.tipo), ['diat', 'informe_investigacion']);
    const [leg] = C.papelesDelCaso(casos.diatAnterior);
    assert.deepEqual(Object.keys(leg).sort(), ['fechaDocumento', 'huella', 'legado', 'nombreArchivo', 'papelId', 's3Key', 'subidoEn', 'subidoPor', 'tamano', 'tipo', 'tipoMime']);
    assert.equal(leg.legado, true);
    assert.equal(leg.tipo, 'diat');
    assert.equal(leg.nombreArchivo, 'diat.pdf');
    assert.deepEqual(C.papelesDelCaso(null), []);
    assert.deepEqual(C.papelesDelCaso({ papeles: 'no es lista' }), []);
    // El espejo da lo mismo, caso por caso.
    for (const [nombre, inc] of Object.entries(casos)) {
        assert.deepEqual(E.papelesDelCaso(inc), C.papelesDelCaso(inc), nombre);
        assert.deepEqual(E.papelesRequeridos(inc), C.papelesRequeridos(inc), nombre);
        assert.deepEqual(E.avanceDelCaso(inc), C.avanceDelCaso(inc), nombre);
    }
    // Y el resumen para el FUF también ve el informe anterior.
    assert.equal(require('../lib/casos-servidor').resumenDelCaso({ ...accidente, documentos: anterior('diat', CLAVE('diat')) }).requeridos[0].cumplido, true);
});
