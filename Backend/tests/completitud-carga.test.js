// Qué documento subir para que un requisito avance.
//
// La interfaz subía siempre el PRIMER tipo del requisito. En el mapa de riesgos
// (ítem 53) eso volvía a subir el mapa cuando faltaba la evidencia de que está
// publicado: se cargaron ocho mapas seguidos en dev y el estado nunca cambió.
// Estas pruebas fijan que la respuesta la da el motor, que es quien sabe qué falta.

const test = require('node:test');
const assert = require('node:assert');

const C = require('../lib/completitud');
const { definicionesOperacionPara } = require('../lib/completitud-operacion');
const { definicionesDocumentalesPara } = require('../lib/completitud-documental');
const { definicionesPara } = require('../lib/completitud-estructura');
const EP = require('../lib/estructura-preventiva');

const AHORA = new Date('2026-09-10T12:00:00.000Z');
const doc = (tipo, over = {}) => ({
    documentId: `${tipo}-${Math.random()}`, tipo, s3Key: `${tipo}.pdf`, version: 1,
    createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z',
    asignaciones: [], ...over,
});
const evaluar = (documentos, extra = {}) => C.evaluarCompletitud(
    [...definicionesPara('obra'), ...definicionesDocumentalesPara('obra'), ...definicionesOperacionPara('obra')],
    { ahora: AHORA, documentos, organos: [], obligaciones: {}, actividades: [], obra: {}, ...extra },
).requisitos;
const req = (reqs, item) => reqs.find((r) => r.item === item);

test('ítem 53: con el mapa cargado, lo que se pide es la evidencia de publicación, no otro mapa', () => {
    const r = req(evaluar([doc('MAPA_RIESGOS')]), 53);
    assert.equal(r.estado, C.ESTADO_REQUISITO.PARCIAL);
    assert.equal(r.cargar.tipo, 'PUBLICACION_MAPA_RIESGOS');
    assert.ok(r.cargar.que, 'dice qué falta en palabras');
});

test('ítem 53: sin nada cargado, se pide el mapa', () => {
    assert.equal(req(evaluar([]), 53).cargar.tipo, 'MAPA_RIESGOS');
});

test('ítem 49: con el Reglamento cargado, lo que falta es el comprobante de la DT', () => {
    const r = req(evaluar([doc('REGLAMENTO_INTERNO')]), 49);
    assert.equal(r.cargar.tipo, 'INGRESO_RIOHS_DT');
});

test('ítem 9: la aprobación es una firma; subir otro programa no la resuelve', () => {
    const r = req(evaluar([doc('PROGRAMA_TRABAJO_PREVENTIVO')]), 9);
    assert.equal(r.estado, C.ESTADO_REQUISITO.PARCIAL);
    assert.equal(r.cargar, null);
});

test('ítem 8: sin MIPER lo que falta es la MIPER, porque el plazo corre desde ella', () => {
    assert.equal(req(evaluar([]), 8).cargar.tipo, 'MIPER');
});

test('un requisito que se informa a destinatarios se resuelve registrando envíos, no subiendo', () => {
    const r = req(evaluar([doc('MIPER')]), 4);
    assert.ok(r.distribucion);
    assert.equal(r.cargar, null);
});

test('la estructura preventiva se acredita en su módulo: ningún ítem 30-48 ofrece carga directa', () => {
    const obligaciones = { [EP.TIPO_ORGANO.COMITE_PARITARIO]: { obligatorio: true } };
    const reqs = evaluar([], { obligaciones }).filter((r) => r.item >= 30 && r.item <= 48);
    assert.ok(reqs.length > 0);
    for (const r of reqs) {
        assert.equal(r.cargar, null, `FUF ${r.item}`);
        // El 37 es la excepción: se acredita subiendo la constancia de entrega,
        // pero solo cuando hay comité. Sin comité (este caso) tampoco ofrece carga.
        if (r.item !== 37) assert.equal(r.modulo, 'estructura', `FUF ${r.item}`);
    }
});

test('ítem 37: con comité vigente, se pide la constancia de entrega', () => {
    const organos = [{ organoId: 'o1', tipo: EP.TIPO_ORGANO.COMITE_PARITARIO, estado: 'Vigente',
        fechaConstitucion: '2026-06-30', fechaEleccionODesignacion: '2026-06-26', fechaTerminoMandato: '2028-06-26' }];
    const r = req(evaluar([], { organos, obligaciones: { [EP.TIPO_ORGANO.COMITE_PARITARIO]: { obligatorio: true } } }), 37);
    assert.equal(r.cargar && r.cargar.tipo, 'ENTREGA_DOCUMENTACION_CPHS', JSON.stringify(r));
});

test('a igual versión, cuenta el documento más reciente: renovar el acta de ensayo la da por vigente', () => {
    const vieja = doc('ACTA_ENSAYO_EMERGENCIA', { fecha: '2025-01-15T00:00:00.000Z', createdAt: '2025-01-15T00:00:00.000Z' });
    const nueva = doc('ACTA_ENSAYO_EMERGENCIA', { fecha: '2026-08-20T00:00:00.000Z', createdAt: '2026-08-20T00:00:00.000Z' });
    // En los dos órdenes: el que devuelve la base no está garantizado.
    assert.equal(req(evaluar([vieja, nueva]), 28).estado, C.ESTADO_REQUISITO.CUMPLIDO);
    assert.equal(req(evaluar([nueva, vieja]), 28).estado, C.ESTADO_REQUISITO.CUMPLIDO);
});

test('ítem 9 sin representante: la acción es designarlo, no cargar', () => {
    const r = req(evaluar([doc('PROGRAMA_TRABAJO_PREVENTIVO')]), 9);
    assert.equal(r.accion.tipo, 'designar_representante');
});

test('ítem 9 con representante que no ha firmado: la acción es pedirle la firma sobre ESE programa', () => {
    const ptp = doc('PROGRAMA_TRABAJO_PREVENTIVO', { documentId: 'ptp-1' });
    const r = req(evaluar([ptp], { representanteLegal: { personaId: 'p-rep', nombre: 'Ana Rojas' } }), 9);
    assert.equal(r.accion.tipo, 'solicitar_firma');
    assert.equal(r.accion.documentId, 'ptp-1');
    assert.equal(r.accion.personaId, 'p-rep');
    assert.equal(r.accion.solicitada, false);
});

test('ítem 9 con la firma del representante queda completado y sin acción', () => {
    const ptp = doc('PROGRAMA_TRABAJO_PREVENTIVO', { firmas: [{ personaId: 'p-rep' }] });
    const r = req(evaluar([ptp], { representanteLegal: { personaId: 'p-rep', nombre: 'Ana Rojas' } }), 9);
    assert.equal(r.estado, C.ESTADO_REQUISITO.CUMPLIDO);
    assert.equal(r.accion, null);
});

// Firmas pendientes en cualquier otro documento: antes solo el repositorio decía
// "Firmas pendientes", sin nombrar a nadie ni ofrecer cómo pedirlas.
const pendiente = (personaId, nombre) => ({ personaId, nombre, estado: 'pendiente' });
const firmada = (personaId, nombre) => ({ personaId, nombre, estado: 'firmado', fechaFirma: '2026-09-05' });

test('un documento con firmas pendientes dice de quién y ofrece recordarlas', () => {
    const acta = doc('ACTA_ENSAYO_EMERGENCIA', {
        documentId: 'acta-1', fecha: '2026-08-20T00:00:00.000Z',
        asignaciones: [pendiente('p1', 'Ana Rojas'), firmada('p2', 'Luis Soto'), pendiente('p3', 'Eva Díaz')],
    });
    const r = req(evaluar([acta]), 28);
    assert.equal(r.accion.tipo, 'recordar_firmas');
    assert.equal(r.accion.documentId, 'acta-1');
    assert.deepEqual(r.accion.personaIds, ['p1', 'p3']);
    assert.equal(r.accion.pendientes, 2);
    assert.equal(r.accion.total, 3);
    assert.equal(r.accion.falta, 'la firma de Ana Rojas y Eva Díaz');
});

test('con todas las firmas no hay nada que recordar', () => {
    const acta = doc('ACTA_ENSAYO_EMERGENCIA', { fecha: '2026-08-20T00:00:00.000Z', asignaciones: [firmada('p1', 'Ana Rojas')] });
    assert.equal(req(evaluar([acta]), 28).accion, null);
});

test('ítem 19 con asistentes que no han firmado: se les recuerda, no se pide otro registro', () => {
    const reg = doc('CAPACITACION_EPP', { documentId: 'epp-1', asignaciones: [firmada('p1', 'A'), pendiente('p2', 'B')] });
    const r = req(evaluar([reg]), 19);
    assert.equal(r.estado, C.ESTADO_REQUISITO.PARCIAL);
    assert.equal(r.cargar, null);
    assert.equal(r.accion.tipo, 'recordar_firmas');
    assert.deepEqual(r.accion.personaIds, ['p2']);
});

test('la acción específica del requisito manda sobre la genérica (ítem 9)', () => {
    const ptp = doc('PROGRAMA_TRABAJO_PREVENTIVO', { asignaciones: [pendiente('otro', 'X')] });
    assert.equal(req(evaluar([ptp]), 9).accion.tipo, 'designar_representante');
});

// ─── Pendiente de firma ──────────────────────────────────────────────────────
//
// Un documento con firmantes asignados no acredita lo que dice hasta que firman:
// el requisito deja de figurar como completado y pasa a "pendiente de firma".

test('con firmas pendientes el requisito no queda completado: pasa a pendiente de firma', () => {
    const acta = doc('ACTA_ENSAYO_EMERGENCIA', {
        documentId: 'acta-1', fecha: '2026-08-20T00:00:00.000Z',
        asignaciones: [pendiente('p1', 'Ana Rojas'), firmada('p2', 'Luis Soto')],
    });
    const r = req(evaluar([acta]), 28);
    assert.equal(r.estado, C.ESTADO_REQUISITO.PARCIAL);
    assert.equal(r.pendienteFirma, true);
    assert.equal(r.cargar, null, 'lo que falta son firmas, no otro archivo');
    assert.equal(r.accion.tipo, 'recordar_firmas');
    assert.match(r.detalle, /Firmaron 1 de 2/);
});

test('cuando todos firman vuelve a completado', () => {
    const acta = doc('ACTA_ENSAYO_EMERGENCIA', { fecha: '2026-08-20T00:00:00.000Z', asignaciones: [firmada('p1', 'Ana Rojas')] });
    const r = req(evaluar([acta]), 28);
    assert.equal(r.estado, C.ESTADO_REQUISITO.CUMPLIDO);
    assert.equal(r.pendienteFirma, false);
});

test('un documento sin firmantes asignados no cambia: sigue completado', () => {
    const acta = doc('ACTA_ENSAYO_EMERGENCIA', { fecha: '2026-08-20T00:00:00.000Z' });
    assert.equal(req(evaluar([acta]), 28).estado, C.ESTADO_REQUISITO.CUMPLIDO);
});

test('pendiente de firma pesa como incompleto en el porcentaje', () => {
    const acta = (asignaciones) => doc('ACTA_ENSAYO_EMERGENCIA', { fecha: '2026-08-20T00:00:00.000Z', asignaciones });
    const reqs = evaluar([acta([pendiente('p1', 'Ana')])]);
    const resumen = C.resumirCompletitud(reqs.filter((r) => r.item === 28));
    assert.equal(resumen.progreso, 50);
});

test('un incompleto por otra causa no se llama pendiente de firma aunque haya firmas por recoger', () => {
    // Ítem 53: falta la evidencia de publicación; que el mapa tenga firmas
    // pendientes no cambia qué es lo que falta.
    const mapa = doc('MAPA_RIESGOS', { asignaciones: [pendiente('p1', 'Ana')] });
    const r = req(evaluar([mapa]), 53);
    assert.equal(r.estado, C.ESTADO_REQUISITO.PARCIAL);
    assert.equal(r.pendienteFirma, false);
    assert.equal(r.cargar.tipo, 'PUBLICACION_MAPA_RIESGOS');
});

test('ítems 9 y 19: esperando solo la firma, se marcan pendiente de firma', () => {
    const ptp = doc('PROGRAMA_TRABAJO_PREVENTIVO', { asignaciones: [pendiente('p-rep', 'Ana Rojas')] });
    const r9 = req(evaluar([ptp], { representanteLegal: { personaId: 'p-rep', nombre: 'Ana Rojas' } }), 9);
    assert.equal(r9.pendienteFirma, true);
    const sinPedir = req(evaluar([doc('PROGRAMA_TRABAJO_PREVENTIVO')], { representanteLegal: { personaId: 'p-rep', nombre: 'Ana Rojas' } }), 9);
    assert.equal(sinPedir.pendienteFirma, false, 'sin pedirla, falta una acción de quien gestiona');
    const reg = doc('CAPACITACION_EPP', { asignaciones: [firmada('p1', 'A'), pendiente('p2', 'B')] });
    assert.equal(req(evaluar([reg]), 19).pendienteFirma, true);
});
