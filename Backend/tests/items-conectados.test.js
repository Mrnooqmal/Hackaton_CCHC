// Ítems que ya tenían soporte en la plataforma y no llegaban al formulario.
//
// Cada uno envuelve lógica que ya existía y estaba probada (el plazo del PTP, la
// aprobación por firma, el registro de participantes de la revisión). Lo que se
// verifica acá es la TRADUCCIÓN a los estados del formulario, no el cálculo de
// fondo, que tiene sus propias pruebas.

const test = require('node:test');
const assert = require('node:assert');

const C = require('../lib/completitud');
const D = require('../lib/distribucion');
const EP = require('../lib/estructura-preventiva');
const {
    evaluarItem8, evaluarItem9, evaluarItem23, evaluarItem37, evaluarItem51,
    evaluarItem60, definicionesDocumentalesPara,
} = require('../lib/completitud-documental');

const { ESTADO_REQUISITO: E } = C;
const AHORA = new Date('2026-09-10T12:00:00.000Z');

const ctx = (over = {}) => ({
    ahora: AHORA, organos: [], obligaciones: {}, documentos: [], prescripciones: [],
    organizacionesSindicales: [], sinOrganizacionesSindicales: null, representanteLegal: null,
    ...over,
});

const doc = (tipo, over = {}) => ({
    documentId: tipo, tipo, s3Key: `${tipo}.pdf`, version: 1,
    createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z',
    firmas: [], difusiones: [], ...over,
});

// ─── Alcance de los documentos por ámbito ────────────────────────────────────

test('en una obra no cuentan los documentos de otra faena', () => {
    // Era el fallo de fondo: las definiciones buscan por TIPO, así que el PTP de
    // la obra vecina daba por cumplido el de ésta.
    const docs = [
        doc('PROGRAMA_TRABAJO_PREVENTIVO', { documentId: 'otra', obraId: 'obra-B' }),
    ];
    assert.equal(C.documentosDelAmbito(docs, 'obra', 'obra-A').length, 0);
    assert.equal(C.documentosDelAmbito(docs, 'obra', 'obra-B').length, 1);
});

test('los documentos de empresa acreditan igual dentro de la obra', () => {
    // El Reglamento Interno no tiene obra y sí debe contar en cada faena.
    const docs = [doc('REGLAMENTO_INTERNO', { obraId: null })];
    assert.equal(C.documentosDelAmbito(docs, 'obra', 'obra-A').length, 1);
});

test('la entidad empleadora no se acredita con documentos de una obra', () => {
    // El caso espejo: prestarle a la casa matriz el programa de una faena dejaba
    // en verde un lugar de trabajo que no tiene nada.
    const docs = [doc('X', { obraId: 'obra-A' }), doc('Y', { obraId: null })];
    const r = C.documentosDelAmbito(docs, 'empresa', null);
    assert.equal(r.length, 1);
    assert.equal(r[0].tipo, 'Y');
});

// ─── Ítem 8: plazo del Programa de Trabajo ───────────────────────────────────

test('ítem 8: sin MIPER el plazo no ha empezado a correr', () => {
    const r = evaluarItem8(ctx());
    assert.equal(r.estado, E.PENDIENTE);
    assert.match(r.detalle, /empieza a correr/);
});

test('ítem 8: MIPER reciente y sin PTP deja el plazo vivo, no vencido', () => {
    const miper = doc('MIPER', { updatedAt: '2026-09-01T00:00:00.000Z' });
    const r = evaluarItem8(ctx({ documentos: [miper] }));
    assert.equal(r.estado, E.PENDIENTE);
    assert.match(r.detalle, /Quedan \d+ día/);
});

test('ítem 8: pasados los 30 días sin PTP queda Vencido', () => {
    const miper = doc('MIPER', { updatedAt: '2026-06-01T00:00:00.000Z' });
    const r = evaluarItem8(ctx({ documentos: [miper] }));
    assert.equal(r.estado, E.VENCIDO);
    assert.match(r.detalle, /30/);
});

test('ítem 8: PTP posterior a la MIPER queda Cumplido', () => {
    const miper = doc('MIPER', { updatedAt: '2026-06-01T00:00:00.000Z' });
    const ptp = doc('PROGRAMA_TRABAJO_PREVENTIVO', { updatedAt: '2026-06-10T00:00:00.000Z' });
    assert.equal(evaluarItem8(ctx({ documentos: [miper, ptp] })).estado, E.CUMPLIDO);
});

// ─── Ítem 9: aprobación por el representante legal ───────────────────────────

test('ítem 9: sin representante legal designado no se puede verificar', () => {
    // No es incumplimiento del PTP: falta el dato contra el que comparar.
    const r = evaluarItem9(ctx({ documentos: [doc('PROGRAMA_TRABAJO_PREVENTIVO')] }));
    assert.equal(r.estado, E.PARCIAL);
    assert.match(r.detalle, /representante legal designado/);
});

test('ítem 9: cargado sin la firma del representante no está cumplido', () => {
    const r = evaluarItem9(ctx({
        documentos: [doc('PROGRAMA_TRABAJO_PREVENTIVO', { firmas: [{ personaId: 'otra' }] })],
        representanteLegal: { personaId: 'p-1', nombre: 'Ana Rivas' },
    }));
    assert.equal(r.estado, E.PARCIAL);
});

test('ítem 9: la firma del representante legal lo cumple', () => {
    const r = evaluarItem9(ctx({
        documentos: [doc('PROGRAMA_TRABAJO_PREVENTIVO', { firmas: [{ personaId: 'p-1' }] })],
        representanteLegal: { personaId: 'p-1', nombre: 'Ana Rivas' },
    }));
    assert.equal(r.estado, E.CUMPLIDO);
    assert.match(r.detalle, /Ana Rivas/);
});

// ─── Ítem 23: periodicidad de la capacitación ────────────────────────────────

test('ítem 23: capacitación de hace más de 2 años queda Vencida', () => {
    const r = evaluarItem23(ctx({
        documentos: [doc('CAPACITACION_SST', { fecha: '2024-01-01T00:00:00.000Z' })],
    }));
    assert.equal(r.estado, E.VENCIDO);
});

test('ítem 23: se mide contra la fecha del hecho, no la de subida', () => {
    // Cargada ayer, pero la capacitación fue hace tres años: sigue vencida.
    const r = evaluarItem23(ctx({
        documentos: [doc('CAPACITACION_SST', {
            fecha: '2023-01-01T00:00:00.000Z', createdAt: '2026-09-09T00:00:00.000Z',
        })],
    }));
    assert.equal(r.estado, E.VENCIDO);
});

// ─── Ítem 37: entrega de documentación al comité ─────────────────────────────

const conComite = {
    organos: [{
        tipo: EP.TIPO_ORGANO.COMITE_PARITARIO, estado: EP.ESTADO_ORGANO.VIGENTE,
        fechaTerminoMandato: '2028-01-01T00:00:00.000Z',
    }],
};

test('ítem 37: con comité pero sin constancia NO está cumplido', () => {
    // Era el falso positivo: antes bastaba con que el comité existiera.
    const r = evaluarItem37(ctx(conComite));
    assert.equal(r.estado, E.PENDIENTE);
    assert.match(r.detalle, /Sin constancia de entrega/);
});

test('ítem 37: la constancia registrada lo cumple, sin mirar qué se entregó', () => {
    const r = evaluarItem37(ctx({
        ...conComite,
        documentos: [doc('ENTREGA_DOCUMENTACION_CPHS', { fecha: '2026-08-01T00:00:00.000Z' })],
    }));
    assert.equal(r.estado, E.CUMPLIDO);
    assert.match(r.detalle, /2026-08-01/);
});

test('ítem 37: sin comité ni delegado y sin obligación, no aplica', () => {
    const r = evaluarItem37(ctx());
    assert.equal(r.estado, E.NO_APLICA);
});

test('ítem 37: obligado y sin comité lo reclama el ítem 30, no éste', () => {
    const r = evaluarItem37(ctx({
        obligaciones: { [EP.TIPO_ORGANO.COMITE_PARITARIO]: { obligatorio: true } },
    }));
    assert.equal(r.estado, E.PENDIENTE);
    assert.match(r.detalle, /ítem 30/);
});

// ─── Ítem 51: revisión anual del Reglamento ──────────────────────────────────

test('ítem 51: revisión de hace más de un año queda Vencida', () => {
    const r = evaluarItem51(ctx({
        documentos: [doc('REGLAMENTO_INTERNO', {
            ultimosParticipantesRevision: { entidades: ['COMITE_PARITARIO'], fechaRevision: '2025-01-01' },
        })],
    }));
    assert.equal(r.estado, E.VENCIDO);
});

test('ítem 51: revisar sin convocar a nadie no cumple el inciso', () => {
    // El Art. 57 pide participación, no solo una versión nueva.
    const r = evaluarItem51(ctx({
        documentos: [doc('REGLAMENTO_INTERNO', {
            ultimosParticipantesRevision: { entidades: [], fechaRevision: '2026-08-01' },
        })],
    }));
    assert.equal(r.estado, E.PARCIAL);
    assert.match(r.detalle, /participaron/);
});

test('ítem 51: revisión dentro del año con participantes queda Cumplida', () => {
    const r = evaluarItem51(ctx({
        documentos: [doc('REGLAMENTO_INTERNO', {
            ultimosParticipantesRevision: {
                entidades: ['COMITE_PARITARIO', 'SINDICATO'], fechaRevision: '2026-08-01',
            },
        })],
    }));
    assert.equal(r.estado, E.CUMPLIDO);
});

// ─── Ítem 60: agregado del resto del formulario ──────────────────────────────

test('ítem 60: con requisitos pendientes no puede estar cumplido', () => {
    const r = evaluarItem60(ctx(), [
        { estado: E.CUMPLIDO }, { estado: E.PENDIENTE }, { estado: E.CUMPLIDO },
    ]);
    assert.equal(r.estado, E.PARCIAL);
    assert.match(r.detalle, /1 de 3/);
});

test('ítem 60: lo que no aplica no lo arrastra', () => {
    const r = evaluarItem60(ctx(), [
        { estado: E.CUMPLIDO }, { estado: E.NO_APLICA }, { estado: E.PARCIAL },
    ]);
    // Parcial no es "sin respaldo": hay documento, le falta algo.
    assert.equal(r.estado, E.CUMPLIDO);
});

test('ítem 60: no se cuenta a sí mismo', () => {
    // Si se incluyera, su propio Pendiente inicial lo dejaría Parcial para siempre.
    const { requisitos } = C.evaluarCompletitud(definicionesDocumentalesPara('empresa'), ctx());
    const item60 = requisitos.find((r) => r.item === 60);
    const otros = requisitos.filter((r) => r.item !== 60);
    const exigibles = otros.filter((r) => r.estado !== E.NO_APLICA && r.estado !== E.FUERA_DE_ALCANCE);
    assert.match(item60.detalle, new RegExp(`de ${exigibles.length} requisitos`));
});

test('ítem 60: corre después de los demás y ve sus resultados', () => {
    const { requisitos } = C.evaluarCompletitud(definicionesDocumentalesPara('empresa'), ctx());
    assert.ok(requisitos.find((r) => r.item === 60), 'el agregado debe llegar a la salida');
});

test('los ítems por lugar de trabajo no se piden a la entidad empleadora', () => {
    // La MIPER y el programa son por faena: exigir una copia a nivel casa matriz
    // sería pedir un documento que la norma no manda hacer.
    const empresa = definicionesDocumentalesPara('empresa').map((d) => d.item);
    for (const item of [4, 8, 9, 11, 23, 25]) {
        assert.ok(!empresa.includes(item), `el ítem ${item} no debe pedirse a la empresa`);
    }
    const obra = definicionesDocumentalesPara('obra').map((d) => d.item);
    for (const item of [4, 8, 9, 11, 23, 25]) {
        assert.ok(obra.includes(item), `el ítem ${item} sí debe pedirse en la obra`);
    }
});

// ─── Difusión genérica (ítems 4, 11 y 25) ────────────────────────────────────

const difManual = (tipo, fecha) => ({ origen: 'manual', destinatarioTipo: tipo, fecha, medio: 'Correo' });

test('ítem 4: sin MIPER el requisito apunta al ítem 2, no a la difusión', () => {
    const def = definicionesDocumentalesPara('obra').find((d) => d.item === 4);
    const r = def.evaluar(ctx());
    assert.equal(r.estado, E.PENDIENTE);
    assert.match(r.detalle, /ítem 2/);
});

test('ítem 4: los cuatro destinatarios del Art. 7 viajan en el desglose', () => {
    const def = definicionesDocumentalesPara('obra').find((d) => d.item === 4);
    const r = def.evaluar(ctx({ documentos: [doc('MIPER')] }));
    assert.equal(r.distribucion.resultado.detalle.length, 4);
    assert.equal(r.distribucion.articulo, 'Art. 7 inc. 9');
});

test('ítem 4: sin plazo normativo, informar tarde no existe', () => {
    // El Art. 7 no fija anticipación: o se informó o no.
    const def = definicionesDocumentalesPara('obra').find((d) => d.item === 4);
    const miper = doc('MIPER', {
        difusiones: [
            difManual(D.DESTINATARIO.PERSONAS_TRABAJADORAS, '2026-09-01T00:00:00.000Z'),
            difManual(D.DESTINATARIO.LINEA_MANDO, '2026-09-01T00:00:00.000Z'),
        ],
    });
    const r = def.evaluar(ctx({ documentos: [miper] }));
    assert.equal(r.distribucion.exigeVigencia, false);
    // Comité y sindicatos no existen en el ámbito: salen del denominador.
    assert.equal(r.estado, E.CUMPLIDO);
});

test('ítem 11: el comité es destinatario exigible cuando existe', () => {
    const def = definicionesDocumentalesPara('obra').find((d) => d.item === 11);
    const ptp = doc('PROGRAMA_TRABAJO_PREVENTIVO', {
        difusiones: [difManual(D.DESTINATARIO.PERSONAS_TRABAJADORAS, '2026-09-01T00:00:00.000Z')],
    });
    const r = def.evaluar(ctx({ ...conComite, documentos: [ptp] }));
    assert.equal(r.estado, E.PARCIAL);
    assert.match(r.detalle, /1 de 2/);
});
