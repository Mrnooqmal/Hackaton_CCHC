// Derechos del titular: plazos que parten en la recepción, prórroga solo a tiempo, bloqueo y alertas.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const D = require('../lib/gobernanza/derechos');

const ACTOR = { personaId: 'p-admin', nombre: 'Ana Rojas' };
const AHORA = new Date('2026-10-07T15:00:00Z');   // miércoles

const nueva = (sobre = {}, opts = {}) => D.nuevaSolicitud({
    personaId: 'p-titular', derecho: D.DERECHOS.SUPRESION, canal: 'Correo a rrhh@constructora.cl',
    recibidaEl: '2026-10-05T12:00:00Z', detalle: 'Pide suprimir sus datos', ...sobre,
}, ACTOR, { ahora: AHORA, solicitudId: 'sol-1', ...opts });

const rechaza = (fn, codigo) => assert.throws(fn, (e) => e.codigo === codigo);
/** Con el bloqueo ya aplicado (lo que hace el sistema al registrarla): para mirar solo los avisos de plazo. */
const bloqueada = (s) => ({ ...s, bloqueo: { ...s.bloqueo, aplicadoEl: s.registradaEl } });

// ─── La solicitud y su fecha de recepción ───────────────────────────────────

test('el plazo de respuesta parte cuando LLEGÓ la solicitud, no cuando se ingresó', () => {
    const s = nueva();
    assert.equal(s.recibidaEl, '2026-10-05T12:00:00.000Z');
    assert.equal(s.registradaEl, AHORA.toISOString());
    assert.equal(s.venceEl.slice(0, 10), '2026-11-04', '30 días corridos desde el 5 de octubre');
});

test('quién la registra sale del actor, y el canal es obligatorio', () => {
    const s = nueva();
    assert.deepEqual(s.registradaPor, ACTOR);
    rechaza(() => nueva({ canal: '' }), 'CANAL_REQUERIDO');
});

test('la fecha de recepción es obligatoria y no puede ser futura', () => {
    rechaza(() => nueva({ recibidaEl: undefined }), 'RECEPCION_REQUERIDA');
    rechaza(() => nueva({ recibidaEl: 'no es fecha' }), 'RECEPCION_REQUERIDA');
    rechaza(() => nueva({ recibidaEl: '2026-10-09T00:00:00Z' }), 'RECEPCION_FUTURA');
});

test('una solicitud recibida hace mucho se registra con su fecha real y queda vencida: no se esconde', () => {
    const s = bloqueada(nueva({ recibidaEl: '2026-08-01T12:00:00Z' }));
    assert.equal(s.recibidaEl.slice(0, 10), '2026-08-01');
    assert.deepEqual(D.alertasDe(s, { ahora: AHORA }).map((a) => a.tipo), ['vencida']);
});

test('derecho, titular y actor son obligatorios', () => {
    rechaza(() => nueva({ derecho: 'olvido' }), 'DERECHO_INVALIDO');
    rechaza(() => nueva({ personaId: '' }), 'SIN_TITULAR');
    assert.throws(() => D.nuevaSolicitud({}, null, { ahora: AHORA }), (e) => e.codigo === 'SIN_ACTOR');
});

// ─── Bloqueo temporal ───────────────────────────────────────────────────────

test('rectificar, suprimir y oponerse exigen bloqueo dentro de 2 días hábiles desde la recepción', () => {
    for (const derecho of [D.DERECHOS.RECTIFICACION, D.DERECHOS.SUPRESION, D.DERECHOS.OPOSICION]) {
        const s = nueva({ derecho, recibidaEl: '2026-10-09T12:00:00Z' }, { ahora: new Date('2026-10-09T13:00:00Z') });   // viernes
        assert.equal(s.bloqueo.exigido, true, derecho);
        assert.equal(s.bloqueo.plazoHasta.slice(0, 10), '2026-10-13', 'viernes + 2 hábiles = martes');
    }
});

test('acceso y portabilidad no exigen bloqueo', () => {
    assert.equal(nueva({ derecho: D.DERECHOS.ACCESO }).bloqueo.exigido, false);
    assert.equal(nueva({ derecho: D.DERECHOS.PORTABILIDAD }).bloqueo.exigido, false);
});

test('un bloqueo exigido que no se aplicó a tiempo genera alerta', () => {
    const s = nueva({ recibidaEl: '2026-10-01T12:00:00Z' });
    assert.ok(D.alertasDe(s, { ahora: AHORA }).some((a) => a.tipo === 'bloqueo_pendiente'));
    const aplicado = { ...s, bloqueo: { ...s.bloqueo, aplicadoEl: '2026-10-01T12:05:00Z' } };
    assert.ok(!D.alertasDe(aplicado, { ahora: AHORA }).some((a) => a.tipo === 'bloqueo_pendiente'));
});

// ─── Prórroga: una vez, y solo si se comunicó antes de vencer ───────────────

test('la prórroga comunicada a tiempo suma 30 días al plazo original', () => {
    const s = nueva();
    const p = D.prorrogar(s, { comunicadaEl: '2026-10-20T10:00:00Z', motivo: 'Hay que reunir antecedentes de tres obras', medio: 'correo' }, ACTOR, { ahora: new Date('2026-10-20T11:00:00Z') });
    assert.equal(p.venceEl.slice(0, 10), '2026-12-04');
    assert.equal(D.plazoVigente({ ...s, prorroga: p }).toISOString().slice(0, 10), '2026-12-04');
});

test('vencido el primer plazo, el sistema NO permite registrar la prórroga', () => {
    const s = nueva();
    rechaza(() => D.prorrogar(s, { comunicadaEl: '2026-11-01T10:00:00Z', motivo: 'Se comunicó a tiempo, dice' }, ACTOR, { ahora: new Date('2026-11-05T10:00:00Z') }), 'PRORROGA_TARDIA');
});

test('tampoco vale una prórroga que dice haberse comunicado después del vencimiento', () => {
    const s = nueva();
    // Registrar en tiempo no alcanza si la comunicación fue tarde: el plazo es de la comunicación.
    rechaza(() => D.prorrogar(s, { comunicadaEl: '2026-11-05T10:00:00Z', motivo: 'Motivo suficiente aquí' }, ACTOR, { ahora: new Date('2026-11-03T10:00:00Z') }), 'PRORROGA_FUTURA');
});

test('la prórroga se usa una sola vez, y exige fecha y motivo', () => {
    const s = nueva();
    const opts = { ahora: new Date('2026-10-20T11:00:00Z') };
    const p = D.prorrogar(s, { comunicadaEl: '2026-10-20T10:00:00Z', motivo: 'Motivo suficiente aquí' }, ACTOR, opts);
    rechaza(() => D.prorrogar({ ...s, prorroga: p }, { comunicadaEl: '2026-10-20T10:00:00Z', motivo: 'Otra más, por favor' }, ACTOR, opts), 'PRORROGA_USADA');
    rechaza(() => D.prorrogar(s, { motivo: 'Motivo suficiente aquí' }, ACTOR, opts), 'PRORROGA_SIN_FECHA');
    rechaza(() => D.prorrogar(s, { comunicadaEl: '2026-10-20T10:00:00Z', motivo: 'corto' }, ACTOR, opts), 'MOTIVO_REQUERIDO');
    rechaza(() => D.prorrogar(s, { comunicadaEl: '2026-10-01T10:00:00Z', motivo: 'Motivo suficiente aquí' }, ACTOR, opts), 'PRORROGA_INVALIDA');
});

// ─── Respuesta ──────────────────────────────────────────────────────────────

test('la respuesta registra si fue dentro de plazo, considerando la prórroga', () => {
    const s = nueva();
    const r = D.responder(s, { resultado: D.RESULTADOS.ACOGIDA_PARCIAL, fundamento: 'Se suprimieron los datos de conveniencia; la evidencia se conserva hasta 2031 por el DS 44.' }, ACTOR, { ahora: new Date('2026-11-10T00:00:00Z') });
    assert.equal(r.dentroDePlazo, false);
    const p = D.prorrogar(s, { comunicadaEl: '2026-10-20T10:00:00Z', motivo: 'Motivo suficiente aquí' }, ACTOR, { ahora: new Date('2026-10-20T11:00:00Z') });
    const r2 = D.responder({ ...s, prorroga: p }, { resultado: D.RESULTADOS.ACOGIDA, fundamento: 'Se suprimieron todos los datos de conveniencia pedidos.' }, ACTOR, { ahora: new Date('2026-11-10T00:00:00Z') });
    assert.equal(r2.dentroDePlazo, true);
});

test('responder exige resultado y un fundamento que diga qué se hizo, y cierra una sola vez', () => {
    const s = nueva();
    rechaza(() => D.responder(s, { resultado: 'quizas', fundamento: 'x'.repeat(30) }, ACTOR, { ahora: AHORA }), 'RESULTADO_INVALIDO');
    rechaza(() => D.responder(s, { resultado: D.RESULTADOS.ACOGIDA, fundamento: 'listo' }, ACTOR, { ahora: AHORA }), 'FUNDAMENTO_REQUERIDO');
    rechaza(() => D.responder({ ...s, estado: D.ESTADOS.RESUELTA }, { resultado: D.RESULTADOS.ACOGIDA, fundamento: 'x'.repeat(30) }, ACTOR, { ahora: AHORA }), 'SOLICITUD_CERRADA');
    rechaza(() => D.prorrogar({ ...s, estado: D.ESTADOS.RESUELTA }, { comunicadaEl: AHORA.toISOString(), motivo: 'Motivo suficiente' }, ACTOR, { ahora: AHORA }), 'SOLICITUD_CERRADA');
});

// ─── Alertas ────────────────────────────────────────────────────────────────

test('avisa cuando faltan 5 días o menos, y ofrece la prórroga mientras todavía vale', () => {
    const s = bloqueada(nueva());
    const tipos = D.alertasDe(s, { ahora: new Date('2026-11-01T12:00:00Z') }).map((a) => a.tipo);
    assert.deepEqual(tipos, ['por_vencer', 'prorroga_posible']);
    assert.deepEqual(D.alertasDe(s, { ahora: new Date('2026-10-10T12:00:00Z') }), [], 'lejos del plazo: nada');
});

test('con la prórroga registrada, el aviso usa el plazo prorrogado', () => {
    const s = bloqueada(nueva());
    const p = D.prorrogar(s, { comunicadaEl: '2026-10-20T10:00:00Z', motivo: 'Motivo suficiente aquí' }, ACTOR, { ahora: new Date('2026-10-20T11:00:00Z') });
    assert.deepEqual(D.alertasDe({ ...s, prorroga: p }, { ahora: new Date('2026-11-05T12:00:00Z') }), []);
});

test('una solicitud resuelta no genera alertas', () => {
    assert.deepEqual(D.alertasDe({ ...nueva(), estado: D.ESTADOS.RESUELTA }, { ahora: new Date('2027-01-01') }), []);
});

// ─── Historial ──────────────────────────────────────────────────────────────

test('cada evento del historial tiene clave propia e irrepetible, y quién lo hizo', () => {
    const a = D.evento('t', 'sol-1', D.EVENTOS.SOLICITUD, {}, ACTOR, { ahora: AHORA, n: 0 });
    const b = D.evento('t', 'sol-1', D.EVENTOS.BLOQUEO, {}, ACTOR, { ahora: AHORA, n: 1 });
    assert.notEqual(a.sk, b.sk);
    assert.ok(a.sk.startsWith('HIST#sol-1#'));
    assert.deepEqual(a.por, ACTOR);
    assert.deepEqual(D.evento('t', 'sol-1', D.EVENTOS.ALERTA, {}, null, { ahora: AHORA }).por, { sistema: true });
    assert.throws(() => D.evento('t', 'sol-1', 'borrado', {}, ACTOR), (e) => e.codigo === 'EVENTO_INVALIDO');
});

test('los plazos son configurables', () => {
    const c = D.configDesdeEntorno({ GOBERNANZA_PLAZO_RESPUESTA_DIAS: '15', GOBERNANZA_PRORROGA_DIAS: '10', GOBERNANZA_BLOQUEO_DIAS_HABILES: '3' });
    const s = D.nuevaSolicitud({ personaId: 'p', derecho: 'supresion', canal: 'presencial', recibidaEl: '2026-10-05T12:00:00Z' }, ACTOR, { ahora: AHORA, config: c });
    assert.equal(s.venceEl.slice(0, 10), '2026-10-20');
});
