const { test } = require('node:test');
const assert = require('node:assert/strict');

const C = require('../lib/completitud');
const EP = require('../lib/estructura-preventiva');
const { definicionesPara } = require('../lib/completitud-estructura');

const E = C.ESTADO_REQUISITO;
const AHORA = new Date('2026-09-09T12:00:00.000Z');

// ─── Motor: estados y denominador ────────────────────────────────────────────

test('NoAplica y FueraDeAlcance salen del denominador y no penalizan', () => {
    const r = C.resumirCompletitud([
        { estado: E.CUMPLIDO }, { estado: E.CUMPLIDO },
        { estado: E.NO_APLICA }, { estado: E.FUERA_DE_ALCANCE },
    ]);
    assert.equal(r.total, 4);
    assert.equal(r.exigibles, 2);
    assert.equal(r.excluidos, 2);
    assert.equal(r.progreso, 100, 'dos cumplidos sobre dos exigibles es 100%');
});

test('Parcial cuenta como medio: no es tenerlo ni no tenerlo', () => {
    assert.equal(C.resumirCompletitud([{ estado: E.CUMPLIDO }, { estado: E.PARCIAL }]).progreso, 75);
    assert.equal(C.resumirCompletitud([{ estado: E.PARCIAL }, { estado: E.PARCIAL }]).progreso, 50);
});

test('Pendiente y Vencido no suman', () => {
    assert.equal(C.resumirCompletitud([{ estado: E.PENDIENTE }, { estado: E.VENCIDO }]).progreso, 0);
});

test('sin requisitos exigibles el progreso es 0 y no divide por cero', () => {
    const r = C.resumirCompletitud([{ estado: E.NO_APLICA }]);
    assert.equal(r.exigibles, 0);
    assert.equal(r.progreso, 0);
});

// ─── Evidencia documental ────────────────────────────────────────────────────

test('sin archivo el requisito está Pendiente, o Vencido si pasó el plazo', () => {
    assert.equal(C.estadoPorDocumento(null, { ahora: AHORA }).estado, E.PENDIENTE);
    assert.equal(C.estadoPorDocumento(null, { fechaLimite: '2026-01-01', ahora: AHORA }).estado, E.VENCIDO);
    assert.equal(C.estadoPorDocumento(null, { fechaLimite: '2027-01-01', ahora: AHORA }).estado, E.PENDIENTE);
});

test('un documento con firmas pendientes NO está Cumplido (regla del encargo)', () => {
    const doc = {
        s3Key: 'x.pdf',
        asignaciones: [{ personaId: 'p1', estado: 'firmado' }, { personaId: 'p2', estado: 'pendiente' }],
    };
    const r = C.estadoPorDocumento(doc, { exigeFirma: true, ahora: AHORA });
    assert.equal(r.estado, E.PARCIAL);
    assert.match(r.detalle, /1 firma/);
});

test('con todas las firmas el documento queda Cumplido', () => {
    const doc = { s3Key: 'x.pdf', asignaciones: [{ personaId: 'p1', estado: 'firmado' }] };
    assert.equal(C.estadoPorDocumento(doc, { exigeFirma: true, ahora: AHORA }).estado, E.CUMPLIDO);
});

test('un documento que exige difusión sin destinatarios queda Parcial', () => {
    const doc = { s3Key: 'x.pdf', asignaciones: [] };
    const r = C.estadoPorDocumento(doc, { exigeFirma: true, ahora: AHORA });
    assert.equal(r.estado, E.PARCIAL);
    assert.match(r.detalle, /sin destinatarios/);
});

test('si no se exige firma, basta el archivo', () => {
    const doc = { s3Key: 'x.pdf', asignaciones: [] };
    assert.equal(C.estadoPorDocumento(doc, { exigeFirma: false, ahora: AHORA }).estado, E.CUMPLIDO);
});

// ─── Motor: evaluación y robustez ────────────────────────────────────────────

test('un requisito que revienta no tumba el panel ni se da por cumplido', () => {
    const { requisitos, resumen } = C.evaluarCompletitud([
        { id: 'A', evaluar: () => { throw new Error('boom'); } },
        { id: 'B', evaluar: () => ({ estado: E.CUMPLIDO }) },
    ]);
    assert.equal(requisitos[0].estado, E.PENDIENTE);
    assert.match(requisitos[0].detalle, /No evaluable: boom/);
    assert.equal(resumen.progreso, 50);
});

test('el NoAplica siempre lleva justificación normativa', () => {
    const { requisitos } = C.evaluarCompletitud([
        { id: 'A', evaluar: () => ({ estado: E.NO_APLICA, detalle: 'No exigible bajo 25 personas.' }) },
        { id: 'B', evaluar: () => ({ estado: E.CUMPLIDO }) },
    ]);
    assert.equal(requisitos[0].justificacion, 'No exigible bajo 25 personas.');
    assert.equal(requisitos[1].justificacion, null, 'solo el NoAplica la lleva');
});

test('agruparPorBloque resume cada bloque por separado', () => {
    const grupos = C.agruparPorBloque([
        { bloque: 'X', estado: E.CUMPLIDO }, { bloque: 'X', estado: E.PENDIENTE },
        { bloque: 'Y', estado: E.CUMPLIDO },
    ]);
    assert.equal(grupos.length, 2);
    assert.equal(grupos.find((g) => g.bloque === 'X').resumen.progreso, 50);
    assert.equal(grupos.find((g) => g.bloque === 'Y').resumen.progreso, 100);
});

// ─── Requisitos de estructura preventiva ─────────────────────────────────────

const ctxBase = (over = {}) => ({
    ahora: AHORA, organos: [], miembros: [], reuniones: [], documentos: [],
    dotacion: 40,
    obligaciones: EP.obligacionesDeAmbito({ dotacion: over.dotacion ?? 40, ambito: EP.AMBITO.OBRA }),
    ...over,
});

const comiteVigente = (over = {}) => ({
    organoId: 'org-1', tipo: EP.TIPO_ORGANO.COMITE_PARITARIO,
    fechaEleccionODesignacion: '2026-06-01T00:00:00.000Z',
    fechaConstitucion: '2026-06-05T00:00:00.000Z',
    fechaTerminoMandato: '2028-06-01T00:00:00.000Z',
    estado: EP.ESTADO_ORGANO.VIGENTE, documentos: {}, ...over,
});

const evaluarObra = (ctx) => C.evaluarCompletitud(definicionesPara('obra'), ctx);
const req = (res, item) => res.requisitos.find((r) => r.item === item);

test('con dotación bajo el umbral, el comité NO penaliza: sale del denominador', () => {
    const res = evaluarObra(ctxBase({ dotacion: 8 }));
    assert.equal(req(res, 30).estado, E.NO_APLICA);
    assert.ok(req(res, 30).justificacion, 'debe declarar por qué no aplica');
});

test('obligatorio y sin constituir queda Pendiente, no NoAplica', () => {
    const res = evaluarObra(ctxBase({ dotacion: 40 }));
    assert.equal(req(res, 30).estado, E.PENDIENTE);
});

test('comité vigente cumple el ítem 30', () => {
    const res = evaluarObra(ctxBase({ organos: [comiteVigente()] }));
    assert.equal(req(res, 30).estado, E.CUMPLIDO);
});

test('constituido sin estar obligado cuenta como cumplido (voluntario)', () => {
    const res = evaluarObra(ctxBase({ dotacion: 8, organos: [comiteVigente()] }));
    assert.equal(req(res, 30).estado, E.CUMPLIDO);
    assert.match(req(res, 30).detalle, /voluntaria/);
});

test('un mandato vencido es Vencido, no Pendiente: no es lo mismo que nunca haberlo tenido', () => {
    const res = evaluarObra(ctxBase({
        organos: [comiteVigente({ fechaTerminoMandato: '2026-01-01T00:00:00.000Z' })],
    }));
    assert.equal(req(res, 30).estado, E.VENCIDO);
});

test('ítem 31: el curso OPR se mide sobre los electos', () => {
    const organo = comiteVigente();
    const miembros = [
        { organoId: 'org-1', estamento: EP.ESTAMENTO.TRABAJADORES, acreditacion: { realizada: true } },
        { organoId: 'org-1', estamento: EP.ESTAMENTO.TRABAJADORES, acreditacion: { realizada: false } },
        { organoId: 'org-1', estamento: EP.ESTAMENTO.EMPLEADOR, acreditacion: { realizada: false } },
    ];
    const res = evaluarObra(ctxBase({ organos: [organo], miembros }));
    const r = req(res, 31);
    assert.equal(r.estado, E.PARCIAL);
    assert.match(r.detalle, /1 de 2 electos/);
});

test('ítem 34: las ordinarias vencidas sin acta dejan el requisito Vencido', () => {
    const organo = comiteVigente();
    const reuniones = [
        { organoId: 'org-1', tipo: EP.TIPO_REUNION.ORDINARIA, fechaProgramada: '2026-07-15T12:00:00.000Z', estado: EP.ESTADO_REUNION.PROGRAMADA },
        { organoId: 'org-1', tipo: EP.TIPO_REUNION.ORDINARIA, fechaProgramada: '2026-12-15T12:00:00.000Z', estado: EP.ESTADO_REUNION.PROGRAMADA },
    ];
    const res = evaluarObra(ctxBase({ organos: [organo], reuniones }));
    const r = req(res, 34);
    assert.equal(r.estado, E.VENCIDO);
    assert.match(r.detalle, /1 reunión/, 'la de diciembre aún no vence');
});

test('ítem 34: con todas las vencidas realizadas, cumple', () => {
    const reuniones = [{
        organoId: 'org-1', tipo: EP.TIPO_REUNION.ORDINARIA,
        fechaProgramada: '2026-07-15T12:00:00.000Z', estado: EP.ESTADO_REUNION.REALIZADA,
        actaDocumentoId: 'd1',
    }];
    const res = evaluarObra(ctxBase({ organos: [comiteVigente()], reuniones }));
    assert.equal(req(res, 34).estado, E.CUMPLIDO);
});

test('ítems 46 y 47 son excluyentes: uno aplica y el otro sale del denominador', () => {
    const conDpr = C.evaluarCompletitud(definicionesPara('empresa'), ctxBase({
        dotacion: 150, obligaciones: EP.obligacionesDeAmbito({ dotacion: 150, ambito: EP.AMBITO.EMPRESA }),
    }));
    assert.notEqual(req(conDpr, 46).estado, E.NO_APLICA);
    assert.equal(req(conDpr, 47).estado, E.NO_APLICA);

    const sinDpr = C.evaluarCompletitud(definicionesPara('empresa'), ctxBase({
        dotacion: 40, obligaciones: EP.obligacionesDeAmbito({ dotacion: 40, ambito: EP.AMBITO.EMPRESA }),
    }));
    assert.equal(req(sinDpr, 46).estado, E.NO_APLICA);
    assert.notEqual(req(sinDpr, 47).estado, E.NO_APLICA);
});

test('los ítems que la plataforma no cubre no se emiten', () => {
    // Decirle al usuario "fuera de alcance del sistema" dentro del sistema no le
    // deja nada que hacer: esos requisitos se acreditan fuera de la plataforma.
    const res = C.evaluarCompletitud(definicionesPara('empresa'), ctxBase());
    for (const item of [33, 42, 43, 44, 45]) {
        assert.equal(req(res, item), undefined, `el ítem ${item} no debe llegar a la vista`);
    }
});

test('los ítems no cubiertos viajan por número, para que la vista tampoco los pinte', () => {
    // Sin esta lista caerían en el "Sin cubrir" de los ítems aún no implementados,
    // que es un estado distinto y sí temporal.
    const res = C.evaluarCompletitud(definicionesPara('empresa'), ctxBase());
    assert.deepEqual([...res.itemsNoCubiertos].sort((a, b) => a - b), [33, 42, 43, 44, 45]);
});

test('lo no cubierto no altera el porcentaje: ya estaba fuera del denominador', () => {
    const res = C.evaluarCompletitud(definicionesPara('empresa'), ctxBase());
    assert.equal(res.resumen.porEstado[E.FUERA_DE_ALCANCE], 0);
    assert.equal(res.resumen.total, res.requisitos.length);
});

test('DPR y encargado no aplican al ámbito obra', () => {
    const res = evaluarObra(ctxBase());
    assert.equal(req(res, 41), undefined, 'el ítem 41 es solo de empresa');
    assert.equal(req(res, 48), undefined, 'el ítem 48 es solo de empresa');
});

test('las definiciones vienen ordenadas por número de ítem', () => {
    const items = definicionesPara('empresa').map((d) => d.item);
    assert.deepEqual(items, [...items].sort((a, b) => a - b));
});

// ─── Export del FUF ──────────────────────────────────────────────────────────

const { construirExport, renderHtml } = require('../lib/completitud-export');

const completitudDemo = (over = {}) => {
    const ctx = ctxBase(over.ctx || {});
    const ev = C.evaluarCompletitud(definicionesPara('obra'), ctx);
    return {
        ambito: 'obra', obraId: 'o-1',
        dotacion: { dotacion: ctx.dotacion, origen: 'calculada', calculada: ctx.dotacion, declarada: null },
        limiteRegistroDT: '2026-06-22T12:00:00.000Z',
        organos: over.organos || [],
        ...ev,
        bloques: C.agruparPorBloque(ev.requisitos),
    };
};

test('el export lee lo mismo que el panel, no recalcula', () => {
    const comp = completitudDemo();
    const exp = construirExport(comp, { nombreObra: 'Obra Norte' });
    assert.equal(exp.resumen.progreso, comp.resumen.progreso);
    assert.equal(exp.resumen.exigibles, comp.resumen.exigibles);
    assert.deepEqual(
        exp.bloques.flatMap((b) => b.requisitos.map((r) => r.id)),
        comp.requisitos.map((r) => r.id)
    );
});

test('los NoAplica se DECLARAN con su justificación, no se omiten', () => {
    // Dotación bajo el umbral: el comité no aplica y debe aparecer igual.
    const comp = completitudDemo({ ctx: { dotacion: 8, obligaciones: EP.obligacionesDeAmbito({ dotacion: 8, ambito: EP.AMBITO.OBRA }) } });
    const html = renderHtml(construirExport(comp, { nombreObra: 'Obra Chica' }));
    assert.match(html, /No aplica/);
    assert.match(html, /No exigible con la dotación/);
});

test('el export tampoco declara lo que la plataforma no cubre', () => {
    // El reporte va a manos del fiscalizador: una fila que dice qué no hace el
    // sistema no acredita ni desacredita nada.
    const html = renderHtml(construirExport(completitudDemo(), {}));
    assert.doesNotMatch(html, /Fuera de alcance/);
});

test('un órgano voluntario se rotula como tal (§2)', () => {
    const comp = completitudDemo({
        organos: [{ tipo: 'ComiteParitario', origen: 'Voluntario', estado: 'Vigente' }],
    });
    const html = renderHtml(construirExport(comp, {}));
    assert.match(html, /constituidos de forma voluntaria/i);
    assert.match(html, /no constituyó incumplimiento/);
});

test('sin órganos voluntarios no aparece esa nota', () => {
    const comp = completitudDemo({
        organos: [{ tipo: 'ComiteParitario', origen: 'Obligatorio', estado: 'Vigente' }],
    });
    assert.ok(!/constituidos de forma voluntaria/i.test(renderHtml(construirExport(comp, {}))));
});

test('el export declara que es un reporte de estado, no evidencia acreditante', () => {
    const html = renderHtml(construirExport(completitudDemo(), {}));
    assert.match(html, /reporte de estado/);
    assert.match(html, /no acredita por sí mismo/);
});

test('el plazo de la DT se rotula referencial', () => {
    const html = renderHtml(construirExport(completitudDemo(), {}));
    assert.match(html, /referencial/);
    assert.match(html, /no los feriados legales/);
});

test('el export escapa el HTML de los datos', () => {
    const comp = completitudDemo();
    const html = renderHtml(construirExport(comp, { nombreObra: '<script>alert(1)</script>' }));
    assert.ok(!html.includes('<script>alert(1)</script>'));
    assert.match(html, /&lt;script&gt;/);
});

test('el export declara el denominador y lo excluido', () => {
    const comp = completitudDemo({ ctx: { dotacion: 8, obligaciones: EP.obligacionesDeAmbito({ dotacion: 8, ambito: EP.AMBITO.OBRA }) } });
    const exp = construirExport(comp, {});
    const html = renderHtml(exp);
    assert.ok(exp.resumen.excluidos > 0);
    assert.match(html, /requisito\(s\) exigible\(s\)/);
    assert.match(html, /no penalizan/);
});
