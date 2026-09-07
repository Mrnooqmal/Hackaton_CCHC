const { test } = require('node:test');
const assert = require('node:assert/strict');

const { PLAZO_PTP_DIAS, estadoPtp, aprobadoPorRepresentanteLegal } = require('../lib/ptp');

const AHORA = new Date('2026-09-06T12:00:00.000Z');
/** Un instante N días antes de AHORA. */
const haceDias = (n) => new Date(AHORA.getTime() - n * 86400000).toISOString();

/** Documento con archivo cargado, publicado hace N días. */
const doc = (dias, extra = {}) => ({ s3Key: 'obras/archivo.pdf', publicadaEn: haceDias(dias), ...extra });

// ── Plazo del Art. 8 inc. 1 ───────────────────────────────────────────────────
// El estado sale de comparar las FECHAS de los dos documentos: el PTP lo redacta
// la empresa y el sistema no puede leer el PDF para saber de qué MIPER deriva.

test('sin MIPER el plazo todavía no corre', () => {
    const r = estadoPtp(null, null, AHORA);
    assert.equal(r.estado, 'sin_miper');
    assert.equal(r.vencido, false);
});

test('una MIPER sin archivo cargado no arranca el plazo', () => {
    const r = estadoPtp(null, { version: 1, publicadaEn: haceDias(50), s3Key: null }, AHORA);
    assert.equal(r.estado, 'sin_miper', 'el requisito existe pero el documento no está');
});

test('con MIPER y sin PTP el plazo corre desde la MIPER', () => {
    const r = estadoPtp(null, doc(10), AHORA);
    assert.equal(r.estado, 'faltante');
    assert.equal(r.dias, 10);
    assert.equal(r.diasRestantes, PLAZO_PTP_DIAS - 10);
    assert.equal(r.vencido, false);
});

test('sin PTP a los 31 días el plazo está vencido', () => {
    const r = estadoPtp(null, doc(31), AHORA);
    assert.equal(r.estado, 'faltante');
    assert.equal(r.vencido, true);
});

test('justo a los 30 días todavía no está vencido', () => {
    const r = estadoPtp(null, doc(PLAZO_PTP_DIAS), AHORA);
    assert.equal(r.vencido, false, 'el plazo es "dentro de 30 días", no "antes de 30"');
});

test('un PTP anterior a la última revisión de la MIPER queda desactualizado', () => {
    const r = estadoPtp(doc(20), doc(5), AHORA);
    assert.equal(r.estado, 'desactualizado');
    assert.equal(r.dias, 5, 'el reloj se reinicia con la revisión de la MIPER');
});

test('un PTP desactualizado hace más de 30 días está vencido', () => {
    const r = estadoPtp(doc(90), doc(45), AHORA);
    assert.equal(r.estado, 'desactualizado');
    assert.equal(r.vencido, true);
});

test('un PTP posterior a la MIPER está al día', () => {
    const r = estadoPtp(doc(5), doc(200), AHORA);
    assert.equal(r.estado, 'vigente');
    assert.equal(r.vencido, false, 'la antigüedad de la MIPER no vence por sí sola al PTP');
});

test('un documento PTP sin archivo cuenta como faltante', () => {
    const r = estadoPtp({ publicadaEn: haceDias(1), s3Key: null }, doc(40), AHORA);
    assert.equal(r.estado, 'faltante');
    assert.equal(r.vencido, true);
});

test('una MIPER antigua sin historial usa updatedAt como fecha de confección', () => {
    const r = estadoPtp(null, { s3Key: 'obras/m.pdf', updatedAt: haceDias(3) }, AHORA);
    assert.equal(r.estado, 'faltante');
    assert.equal(r.dias, 3);
});

// ── Aprobación: la firma real del representante legal (Art. 8 inc. 1) ─────────

test('está aprobado si el representante legal firmó el documento', () => {
    const ptpDoc = doc(1, { firmas: [{ personaId: 'otro' }, { personaId: 'rl-1' }] });
    assert.equal(aprobadoPorRepresentanteLegal(ptpDoc, { personaId: 'rl-1' }), true);
});

test('no está aprobado si firmaron otros pero no el representante legal', () => {
    const ptpDoc = doc(1, { firmas: [{ personaId: 'p1' }, { personaId: 'p2' }] });
    assert.equal(aprobadoPorRepresentanteLegal(ptpDoc, { personaId: 'rl-1' }), false);
});

test('sin representante legal designado no puede haber aprobación', () => {
    const ptpDoc = doc(1, { firmas: [{ personaId: 'p1' }] });
    assert.equal(aprobadoPorRepresentanteLegal(ptpDoc, null), false);
});
