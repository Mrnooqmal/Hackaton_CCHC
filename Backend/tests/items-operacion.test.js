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
    ahora: AHORA, documentos: [], organos: [], obligaciones: {}, faenaCompartida: null, ...over,
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

// ─── Ítems 18 y 19: capacitación en EPP y su registro ────────────────────────

test('ítem 18 y 19 se acreditan con el MISMO documento, no con dos cargas', () => {
    // El Art. 13 pone dos obligaciones sobre un solo hecho: que la capacitación
    // se hiciera y que conste quién asistió. Pedir dos archivos sería duplicar.
    const defs = definicionesOperacionPara('obra');
    const t18 = defs.find((d) => d.item === 18).tipos;
    const t19 = defs.find((d) => d.item === 19).tipos;
    assert.deepEqual(t18, t19);
    assert.deepEqual(t18, ['CAPACITACION_EPP']);
});

test('ítem 18: mira la fecha; un registro sin fecha no acredita que ocurriera', () => {
    const sinFecha = doc('CAPACITACION_EPP', { fecha: null, updatedAt: null, createdAt: null });
    assert.equal(evaluarItem18(ctx({ documentos: [sinFecha] })).estado, E.PARCIAL);
});

test('ítem 19: mira las firmas de los asistentes, no la fecha', () => {
    const capacitacion = doc('CAPACITACION_EPP', {
        fecha: '2026-08-01T00:00:00.000Z',
        asignaciones: [
            { personaId: 'p1', estado: 'firmado' },
            { personaId: 'p2', estado: 'pendiente' },
        ],
    });
    const c = ctx({ documentos: [capacitacion] });
    assert.equal(evaluarItem18(c).estado, E.CUMPLIDO, 'la capacitación ocurrió');
    assert.equal(evaluarItem19(c).estado, E.PARCIAL, 'falta la constancia de un asistente');
});

test('ítem 19: un acta sin asistentes no deja constancia de quién se capacitó', () => {
    const r = evaluarItem19(ctx({ documentos: [doc('CAPACITACION_EPP')] }));
    assert.equal(r.estado, E.PARCIAL);
    assert.match(r.detalle, /quién se capacitó/);
});

// ─── Ítem 29: faena compartida ───────────────────────────────────────────────

test('ítem 29: sin declarar si la faena es compartida, no se deja pendiente', () => {
    // Sería un incumplimiento imposible de cerrar para las obras donde no
    // concurre nadie más.
    const r = evaluarItem29(ctx());
    assert.equal(r.estado, E.NO_APLICA);
    assert.match(r.detalle, /No se ha declarado/);
});

test('ítem 29: declarada como compartida y sin documento, sí queda Pendiente', () => {
    const r = evaluarItem29(ctx({ faenaCompartida: true }));
    assert.equal(r.estado, E.PENDIENTE);
});

test('ítem 29: declarar que no concurren otras entidades lo saca con su razón', () => {
    const r = evaluarItem29(ctx({ faenaCompartida: false }));
    assert.equal(r.estado, E.NO_APLICA);
    assert.match(r.detalle, /no concurren/);
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
