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
        clasificacion: 'incidente', tipo: 'accidente', gravedad: 'leve', medidasCorrectivas: [{ numero: 1 }],
        papeles: [papel('diat'), papel('informe_investigacion')],
    },
    accidenteGrave: { clasificacion: 'incidente', tipo: 'accidente', gravedad: 'grave', papeles: [papel('diat')] },
    accidenteFatal: { clasificacion: 'incidente', tipo: 'accidente', gravedad: 'fatal' },
    accidenteFatalCompleto: {
        clasificacion: 'incidente', tipo: 'accidente', gravedad: 'fatal', medidasCorrectivas: [{ numero: 1 }],
        papeles: [papel('diat'), papel('informe_investigacion'), papel('constancia_aviso_autoridad'), papel('diep'), papel('otro')],
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

test('accidente: DIAT, informe de investigación y al menos una medida correctiva', () => {
    assert.deepEqual(claves(CASOS.accidenteLeve), ['diat', 'informe_investigacion', 'medida_correctiva']);
    assert.deepEqual(C.papelesRequeridos(CASOS.accidenteLeve).map((p) => p.cumplido), [false, false, false]);
    assert.deepEqual(C.papelesRequeridos(CASOS.accidenteLeveCompleto).map((p) => p.cumplido), [true, true, true]);
    assert.deepEqual(C.papelesRequeridos(CASOS.accidenteLeve).map((p) => p.tipoDocumento), ['diat', 'informe_investigacion', null]);
    // Un respaldo libre y la DIEP no cumplen la DIAT.
    assert.equal(cumplido(CASOS.accidenteConOtroNoCuenta, 'diat'), false);
    // La DIEP no se exige en ningún caso.
    for (const inc of Object.values(CASOS)) assert.ok(!claves(inc).includes('diep'), JSON.stringify(inc));
});

test('accidente grave o fatal: además la constancia del aviso a la Inspección del Trabajo y a la SEREMI de Salud', () => {
    for (const inc of [CASOS.accidenteGrave, CASOS.accidenteFatal]) {
        assert.deepEqual(claves(inc), ['diat', 'informe_investigacion', 'medida_correctiva', 'constancia_aviso_autoridad']);
    }
    assert.equal(cumplido(CASOS.accidenteGrave, 'diat'), true);
    assert.equal(cumplido(CASOS.accidenteGrave, 'constancia_aviso_autoridad'), false);
    assert.deepEqual(C.avanceDelCaso(CASOS.accidenteFatalCompleto), { cumplidos: 4, total: 4, porcentaje: 100 });
    // Un incidente grave (no accidente) no la exige.
    assert.deepEqual(claves({ tipo: 'incidente', gravedad: 'grave' }), []);
});

test('avance: sin papeles requeridos el total es 0 y el porcentaje 100 (no se divide por cero)', () => {
    assert.deepEqual(C.avanceDelCaso(CASOS.incidente), { cumplidos: 0, total: 0, porcentaje: 100 });
    assert.deepEqual(C.avanceDelCaso(null), { cumplidos: 0, total: 0, porcentaje: 100 });
    assert.deepEqual(C.avanceDelCaso(CASOS.accidenteGrave), { cumplidos: 1, total: 4, porcentaje: 25 });
    assert.deepEqual(C.avanceDelCaso(CASOS.accidenteLeveCompleto), { cumplidos: 3, total: 3, porcentaje: 100 });
});

test('el catálogo: cinco tipos, la DIAT y la DIEP con datos de salud, "otro" nunca obligatorio', () => {
    assert.deepEqual(C.ORDEN_TIPOS_PAPEL, ['diat', 'diep', 'informe_investigacion', 'constancia_aviso_autoridad', 'otro']);
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
