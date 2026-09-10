// Requisitos operativos del FUF: MIPER, EPP, emergencias, vigilancia y mapas.
//
// Lo que se prueba es la REGLA de cada ítem, no el motor: que la periodicidad
// venza cuando corresponde, que un documento sin fecha no se dé por cumplido y
// que los ítems que solo se activan ante un hecho no castiguen por no tener
// hechos.

const test = require('node:test');
const assert = require('node:assert');

const C = require('../lib/completitud');
const {
    evaluarItem6, evaluarItem18, evaluarItem19, evaluarItem29, evaluarItem53,
    definicionesOperacionPara,
} = require('../lib/completitud-operacion');

const { ESTADO_REQUISITO: E } = C;
const AHORA = new Date('2026-09-10T12:00:00.000Z');

const ctx = (over = {}) => ({
    ahora: AHORA, documentos: [], organos: [], obligaciones: {},
    actividades: [], obra: {}, ...over,
});
const doc = (tipo, over = {}) => ({
    documentId: tipo, tipo, s3Key: `${tipo}.pdf`, version: 1,
    createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z',
    asignaciones: [], ...over,
});

// ─── Ítem 6: fecha y revisión de la MIPER ────────────────────────────────────

test('ítem 6: sin MIPER remite al ítem 2, no inventa un incumplimiento propio', () => {
    const r = evaluarItem6(ctx());
    assert.equal(r.estado, E.PENDIENTE);
    assert.match(r.detalle, /ítem 2/);
});

test('ítem 6: MIPER revisada hace más de un año queda Vencida', () => {
    const r = evaluarItem6(ctx({ documentos: [doc('MIPER', { fecha: '2025-01-01T00:00:00.000Z' })] }));
    assert.equal(r.estado, E.VENCIDO);
    assert.match(r.detalle, /al menos una al año/);
});

test('ítem 6: MIPER reciente queda Cumplida', () => {
    const r = evaluarItem6(ctx({ documentos: [doc('MIPER', { fecha: '2026-08-01T00:00:00.000Z' })] }));
    assert.equal(r.estado, E.CUMPLIDO);
});

// ─── Ítems 18, 19 y 23: se acreditan con ACTIVIDADES ────────────────────────

const actividad = (over = {}) => ({
    tipo: 'CAPACITACION', subtipo: 'EPP', titulo: 'Uso y mantención de EPP (mín. 1h por EPP)',
    estado: 'completada',
    asistentes: [{ personaId: 'p1', firmado: true }],
    duracion: { minimaMin: 60, declaradaMin: 60 },
    fechaEjecucion: '2026-08-01T00:00:00.000Z',
    ...over,
});

test('ítem 18: la actividad agendada acredita', () => {
    const r = evaluarItem18(ctx({ actividades: [actividad()] }));
    assert.equal(r.estado, E.CUMPLIDO);
    assert.equal(r.acreditacion.via, 'actividad');
});

test('ítem 18: el certificado de una capacitación externa también acredita', () => {
    // La puede dictar el Organismo Administrador sin pasar por la plataforma.
    // Exigir la actividad dejaría afuera a quien capacitó bien por fuera.
    const r = evaluarItem18(ctx({
        actividades: [],
        documentos: [doc('CAPACITACION_EPP', { fecha: '2026-08-01T00:00:00.000Z' })],
    }));
    assert.equal(r.estado, E.CUMPLIDO);
    assert.equal(r.acreditacion.via, 'documento');
});

test('ítem 18: sin ninguna de las dos vías, el detalle ofrece las dos', () => {
    const r = evaluarItem18(ctx());
    assert.equal(r.estado, E.PENDIENTE);
    assert.equal(r.acreditacion.via, null);
    assert.match(r.detalle, /agéndala o carga el certificado/);
});

test('ítem 18: el bloque de acreditación lleva el criterio para agendar', () => {
    // La pantalla necesita saber qué actividad crear, sin deducirlo del título.
    const r = evaluarItem18(ctx());
    assert.equal(r.acreditacion.criterio.subtipo, 'EPP');
    assert.deepEqual(r.acreditacion.tipos, ['CAPACITACION_EPP']);
});

test('ítem 18: sin actividad registrada queda Pendiente', () => {
    assert.equal(evaluarItem18(ctx({ actividades: [] })).estado, E.PENDIENTE);
});

test('ítem 18: un acta sin las horas declaradas no acredita el decreto', () => {
    // El Art. 13 exige una hora por EPP. Un acta firmada por todos no lo acredita
    // si nadie declaró cuánto duró.
    const r = evaluarItem18(ctx({
        actividades: [actividad({ duracion: { minimaMin: 60, declaradaMin: null } })],
    }));
    assert.equal(r.estado, E.PARCIAL);
    assert.match(r.detalle, /horas declaradas/);
});

test('ítem 18: las horas insuficientes tampoco', () => {
    const r = evaluarItem18(ctx({
        actividades: [actividad({ duracion: { minimaMin: 60, declaradaMin: 30 } })],
    }));
    assert.equal(r.estado, E.PARCIAL);
    assert.match(r.detalle, /no alcanzan el mínimo/);
});

test('ítem 18: las actividades antiguas sin duración no se castigan', () => {
    // Su carencia es del sistema, no de la obra: la regla de horas es posterior.
    const r = evaluarItem18(ctx({ actividades: [actividad({ duracion: null })] }));
    assert.equal(r.estado, E.CUMPLIDO);
});

test('ítems 18 y 19 se acreditan con el MISMO hecho, no con dos registros', () => {
    // El Art. 13 pone dos obligaciones sobre un solo hecho: que la capacitación
    // se hiciera y que conste quién asistió. Comparten vía y tipo.
    const defs = definicionesOperacionPara('obra');
    assert.deepEqual(defs.find((d) => d.item === 18).tipos, defs.find((d) => d.item === 19).tipos);
    assert.equal(defs.find((d) => d.item === 18).modulo, 'actividades');
    assert.equal(defs.find((d) => d.item === 19).modulo, 'actividades');
});

test('ítem 19: el certificado sin asistentes asignados no deja constancia', () => {
    const r = evaluarItem19(ctx({
        documentos: [doc('CAPACITACION_EPP', { asignaciones: [] })],
    }));
    assert.equal(r.estado, E.PARCIAL);
    assert.match(r.detalle, /quién se capacitó/);
});

test('ítem 23: el certificado externo acredita y su fecha manda la vigencia', () => {
    const def = definicionesOperacionPara('obra').find((d) => d.item === 23);
    const viejo = def.evaluar(ctx({
        documentos: [doc('CAPACITACION_SST', { fecha: '2024-01-01T00:00:00.000Z' })],
    }));
    assert.equal(viejo.estado, E.VENCIDO);
});

test('ítem 19: mira las firmas de los asistentes, no las horas', () => {
    const sinFirmar = actividad({
        asistentes: [{ personaId: 'p1', firmado: true }, { personaId: 'p2', firmado: false }],
    });
    const c = ctx({ actividades: [sinFirmar] });
    assert.equal(evaluarItem18(c).estado, E.CUMPLIDO, 'la capacitación se ejecutó');
    const r19 = evaluarItem19(c);
    assert.equal(r19.estado, E.PARCIAL);
    assert.match(r19.detalle, /1 de 2/);
});

test('ítem 19: una actividad sin asistentes no acredita ni por actividad ni por documento', () => {
    // Sin asistentes la actividad no acredita el ítem 18, así que tampoco hay vía:
    // el 19 queda pendiente, no parcial, porque no hay registro que revisar.
    const r = evaluarItem19(ctx({ actividades: [actividad({ asistentes: [] })] }));
    assert.equal(r.estado, E.PENDIENTE);
    assert.equal(r.acreditacion.via, null);
});

test('ítem 23: la capacitación de 8 horas vence a los 2 años', () => {
    const def = definicionesOperacionPara('obra').find((d) => d.item === 23);
    const vieja = actividad({
        subtipo: 'PRL_8H', titulo: 'Capacitación 8h Prevención de Riesgos Laborales',
        duracion: { minimaMin: 480, declaradaMin: 480 },
        fechaEjecucion: '2024-01-01T00:00:00.000Z',
    });
    assert.equal(def.evaluar(ctx({ actividades: [vieja] })).estado, E.VENCIDO);
});

test('ítem 23: no confunde la capacitación de EPP con la de 8 horas', () => {
    // El vínculo es por subtipo: si mirara cualquier CAPACITACION, una charla de
    // EPP daría por cumplido el Art. 16.
    const def = definicionesOperacionPara('obra').find((d) => d.item === 23);
    assert.equal(def.evaluar(ctx({ actividades: [actividad()] })).estado, E.PENDIENTE);
});

// ─── Aplicabilidad por obra ──────────────────────────────────────────────────

const evaluarObra = (over = {}) => C.evaluarCompletitud(
    definicionesOperacionPara('obra'), ctx(over)
).requisitos;
const req = (rs, item) => rs.find((r) => r.item === item);

test('el procedimiento de maquinaria no se le exige a una obra sin maquinaria', () => {
    // Era el rojo imposible de cerrar: la vista de obra ya lo sabía y el motor no.
    const r = req(evaluarObra({ obra: { tieneMaquinaria: false } }), 12);
    assert.equal(r.estado, E.NO_APLICA);
    assert.match(r.justificacion, /no utiliza máquinas/);
});

test('con maquinaria declarada sí se exige', () => {
    assert.equal(req(evaluarObra({ obra: { tieneMaquinaria: true } }), 12).estado, E.PENDIENTE);
});

test('sin declarar, el requisito se pide igual y se avisa que falta el dato', () => {
    // Suponer que la obra no tiene maquinaria porque nadie lo declaró es
    // exactamente cómo se pierde una obligación.
    const r = req(evaluarObra({ obra: {} }), 12);
    assert.equal(r.estado, E.PENDIENTE);
    assert.match(r.detalle, /Falta declarar/);
});

test('la coordinación no se exige donde no concurren otras entidades', () => {
    const r = req(evaluarObra({ obra: { faenaCompartida: false } }), 29);
    assert.equal(r.estado, E.NO_APLICA);
    assert.match(r.justificacion, /no concurren/);
});

test('declarada como faena compartida, la coordinación sí se exige', () => {
    assert.equal(req(evaluarObra({ obra: { faenaCompartida: true } }), 29).estado, E.PENDIENTE);
});

// ─── Ítem 53: mapas visibles ─────────────────────────────────────────────────

test('ítem 53: tener el mapa no es tenerlo publicado', () => {
    const r = evaluarItem53(ctx({ documentos: [doc('MAPA_RIESGOS')] }));
    assert.equal(r.estado, E.PARCIAL);
    assert.match(r.detalle, /publicado en las dependencias/);
});

test('ítem 53: con evidencia de publicación queda Cumplido', () => {
    const r = evaluarItem53(ctx({
        documentos: [doc('MAPA_RIESGOS'), doc('PUBLICACION_MAPA_RIESGOS')],
    }));
    assert.equal(r.estado, E.CUMPLIDO);
});

// ─── Periodicidad y eventos ──────────────────────────────────────────────────

test('ítem 28: el ensayo del plan vence al año', () => {
    const def = definicionesOperacionPara('obra').find((d) => d.item === 28);
    const viejo = def.evaluar(ctx({
        documentos: [doc('ACTA_ENSAYO_EMERGENCIA', { fecha: '2025-01-01T00:00:00.000Z' })],
    }));
    assert.equal(viejo.estado, E.VENCIDO);
});

test('ítem 26: sin eventos de riesgo grave no hay nada que incumplir', () => {
    // La obligación es REGISTRAR lo que pase, no tener registros. Se declara la
    // razón para que no parezca un verde vacío.
    const def = definicionesOperacionPara('obra').find((d) => d.item === 26);
    const r = def.evaluar(ctx());
    assert.equal(r.estado, E.CUMPLIDO);
    assert.match(r.detalle, /Sin eventos/);
});

// ─── Lo que la plataforma no interpreta ──────────────────────────────────────

test('los ítems de contenido mínimo no llegan a la vista', () => {
    // Piden verificar QUÉ DICE el documento. El sistema no abre el archivo, así
    // que declararlos sería fingir un estado.
    const { requisitos, itemsNoCubiertos } = C.evaluarCompletitud(
        definicionesOperacionPara('obra'), ctx()
    );
    for (const item of [3, 5, 10, 13, 15, 22, 24, 52]) {
        assert.equal(requisitos.find((r) => r.item === item), undefined, `ítem ${item}`);
        assert.ok(itemsNoCubiertos.includes(item), `ítem ${item} debe viajar como no cubierto`);
    }
});

test('cada ítem tiene UNA sola definición en todo el catálogo', () => {
    // Dos definiciones del mismo ítem mostrarían dos filas para la misma
    // obligación, y el usuario no sabría cuál mirar.
    const est = require('../lib/completitud-estructura');
    const docu = require('../lib/completitud-documental');
    for (const ambito of ['empresa', 'obra']) {
        const items = [
            ...est.definicionesPara(ambito),
            ...docu.definicionesDocumentalesPara(ambito),
            ...definicionesOperacionPara(ambito),
        ].map((d) => d.item);
        const duplicados = items.filter((x, i) => items.indexOf(x) !== i);
        assert.deepEqual(duplicados, [], `${ambito}: ítems duplicados ${duplicados}`);
    }
});
