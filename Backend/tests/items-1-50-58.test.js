const { test } = require('node:test');
const assert = require('node:assert/strict');

const C = require('../lib/completitud');
const D = require('../lib/distribucion');
const PRE = require('../lib/prescripciones');
const F = require('../lib/fuf');
const EP = require('../lib/estructura-preventiva');
const {
    evaluarItem1, evaluarItem50, evaluarItem58, componentesSgsst, definicionesDocumentalesPara,
} = require('../lib/completitud-documental');

const E = C.ESTADO_REQUISITO;
const AHORA = new Date('2026-09-09T12:00:00.000Z');

// ─── Catálogo del FUF ────────────────────────────────────────────────────────

test('el catálogo cubre los 60 ítems en 15 secciones, sin huecos', () => {
    assert.equal(F.SECCIONES_FUF.length, 15);
    assert.equal(F.ITEMS_FUF.length, 60);
    const nums = F.ITEMS_FUF.map((i) => i.numero);
    assert.deepEqual(nums, Array.from({ length: 60 }, (_, i) => i + 1));
});

test('cada ítem pertenece a exactamente una sección', () => {
    for (let n = 1; n <= 60; n++) {
        const secs = F.SECCIONES_FUF.filter((s) => n >= s.desde && n <= s.hasta);
        assert.equal(secs.length, 1, `el ítem ${n} cae en ${secs.length} secciones`);
    }
});

test('los ítems 39 y 40 van en la sección 8, como en el formulario', () => {
    assert.equal(F.seccionDeItem(39).numero, 8);
    assert.equal(F.seccionDeItem(40).numero, 8);
});

test('agruparPorSeccion no omite secciones sin requisitos evaluados', () => {
    const grupos = F.agruparPorSeccion([{ item: 30 }, { item: 50 }]);
    // Las 15 del formulario más la 16, que acompaña lo que el FUF no fiscaliza.
    assert.equal(grupos.length, 16, 'un formulario al que le faltan secciones no se puede recorrer');
    assert.equal(grupos.filter((g) => !g.fueraDelFormulario).length, 15);
    assert.equal(grupos.find((g) => g.seccion === 8).items.find((i) => i.numero === 30).requisitos.length, 1);
    assert.equal(grupos.find((g) => g.seccion === 11).items[0].requisitos.length, 0);
});

test('la sección 16 se declara fuera del formulario y sus ítems también', () => {
    // Un número de ítem inventado en el formulario rompe justo la auditabilidad
    // que el formulario existe para dar: se muestran por su artículo.
    const extra = F.agruparPorSeccion([]).find((g) => g.seccion === 16);
    assert.equal(extra.fueraDelFormulario, true);
    assert.ok(extra.items.every((i) => i.fueraDelFormulario === true));
    assert.equal(F.SECCIONES_FUF.length, 15, 'el FUF sigue teniendo 15 secciones');
    assert.equal(F.ITEMS_FUF.length, 60, 'y 60 ítems');
});

// ─── Distribución (componente genérico) ──────────────────────────────────────

const difManual = (tipo, fecha) => ({ origen: 'manual', destinatarioTipo: tipo, fecha, medio: 'Correo' });

test('un destinatario sin constancia queda Pendiente', () => {
    const r = D.estadoDestinatario({ tipo: D.DESTINATARIO.PERSONAS_TRABAJADORAS, difusiones: [] });
    assert.equal(r.estado, D.ESTADO_DESTINATARIO.PENDIENTE);
});

test('un destinatario que no existe en el ámbito queda NoAplica con razón', () => {
    const r = D.estadoDestinatario({
        tipo: D.DESTINATARIO.ORGANIZACION_SINDICAL, difusiones: [],
        existeEnAmbito: false, razonNoAplica: 'La entidad declaró que no hay sindicatos.',
    });
    assert.equal(r.estado, D.ESTADO_DESTINATARIO.NO_APLICA);
    assert.match(r.detalle, /declaró que no hay/);
});

test('la anticipación se mide contra la entrada en vigencia, no contra la subida', () => {
    const dif = [difManual(D.DESTINATARIO.PERSONAS_TRABAJADORAS, '2026-08-01T00:00:00.000Z')];
    const r = D.estadoDestinatario({
        tipo: D.DESTINATARIO.PERSONAS_TRABAJADORAS, difusiones: dif,
        fechaVigencia: '2026-09-15T00:00:00.000Z', diasExigidos: 30,
    });
    assert.equal(r.estado, D.ESTADO_DESTINATARIO.ENVIADO);
    assert.equal(r.dias, 45);
});

test('enviar con menos de 30 días es FueraDePlazo, no Enviado', () => {
    const dif = [difManual(D.DESTINATARIO.PERSONAS_TRABAJADORAS, '2026-09-01T00:00:00.000Z')];
    const r = D.estadoDestinatario({
        tipo: D.DESTINATARIO.PERSONAS_TRABAJADORAS, difusiones: dif,
        fechaVigencia: '2026-09-15T00:00:00.000Z', diasExigidos: 30,
    });
    assert.equal(r.estado, D.ESTADO_DESTINATARIO.FUERA_DE_PLAZO);
    assert.equal(r.dias, 14);
});

test('enviar DESPUÉS de entrar en vigencia se declara como tal', () => {
    const dif = [difManual(D.DESTINATARIO.PERSONAS_TRABAJADORAS, '2026-10-01T00:00:00.000Z')];
    const r = D.estadoDestinatario({
        tipo: D.DESTINATARIO.PERSONAS_TRABAJADORAS, difusiones: dif,
        fechaVigencia: '2026-09-15T00:00:00.000Z', diasExigidos: 30,
    });
    assert.equal(r.estado, D.ESTADO_DESTINATARIO.FUERA_DE_PLAZO);
    assert.match(r.detalle, /DESPUÉS de entrar en vigencia/);
});

test('la constancia automática cuenta para los representantes', () => {
    // Es la que escribe EventBus al publicar una versión: informa a mando y
    // representantes, y sirve a los ítems 4 y 11.
    const auto = { origen: 'automatica', fecha: '2026-08-01T00:00:00.000Z', totales: { mando: 3, representantes: 2, firmantes: 0 } };
    assert.equal(D.estadoDestinatario({ tipo: D.DESTINATARIO.COMITE_PARITARIO, difusiones: [auto] }).estado,
        D.ESTADO_DESTINATARIO.ENVIADO);
    assert.equal(D.estadoDestinatario({ tipo: D.DESTINATARIO.ORGANIZACION_SINDICAL, difusiones: [auto] }).estado,
        D.ESTADO_DESTINATARIO.PENDIENTE, 'a los sindicatos no los informa la publicación');
});

test('los NoAplica salen del denominador de la distribución', () => {
    const r = D.evaluarDistribucion({
        difusiones: [difManual(D.DESTINATARIO.PERSONAS_TRABAJADORAS, '2026-08-01T00:00:00.000Z')],
        destinatariosExigidos: D.DESTINATARIOS_REGLAMENTO,
        existencia: { [D.DESTINATARIO.COMITE_PARITARIO]: false, [D.DESTINATARIO.ORGANIZACION_SINDICAL]: false },
        fechaVigencia: '2026-09-15T00:00:00.000Z', diasExigidos: 30,
    });
    assert.equal(r.exigibles, 1);
    assert.equal(r.excluidos, 2);
    assert.equal(r.completa, true);
});

// ─── Ítem 50 ─────────────────────────────────────────────────────────────────

const ctx50 = (over = {}) => ({
    ahora: AHORA, organos: [], organizacionesSindicales: [], sinOrganizacionesSindicales: null,
    documentos: [], ...over,
});

const riohs = (over = {}) => ({
    documentId: 'r1', tipo: 'REGLAMENTO_INTERNO', s3Key: 'r.pdf', version: 2,
    fechaEntradaVigencia: '2026-09-15T00:00:00.000Z', difusiones: [], ...over,
});

test('ítem 50: sin Reglamento cargado queda Pendiente', () => {
    assert.equal(evaluarItem50(ctx50()).estado, E.PENDIENTE);
});

test('ítem 50: sin fecha de vigencia el plazo no es medible y queda Parcial', () => {
    const r = evaluarItem50(ctx50({ documentos: [riohs({ fechaEntradaVigencia: null })] }));
    assert.equal(r.estado, E.PARCIAL);
    assert.match(r.detalle, /desde cuándo rige/);
});

test('ítem 50: remitido a tiempo a todos los exigibles queda Cumplido', () => {
    const doc = riohs({ difusiones: [difManual(D.DESTINATARIO.PERSONAS_TRABAJADORAS, '2026-08-01T00:00:00.000Z')] });
    const r = evaluarItem50(ctx50({ documentos: [doc] }));
    assert.equal(r.estado, E.CUMPLIDO, 'sin comité ni sindicatos, el único exigible es el envío a trabajadores');
});

test('ítem 50: fuera de plazo NUNCA es Cumplido (anti contradicción 4)', () => {
    const doc = riohs({ difusiones: [difManual(D.DESTINATARIO.PERSONAS_TRABAJADORAS, '2026-09-10T00:00:00.000Z')] });
    const r = evaluarItem50(ctx50({ documentos: [doc] }));
    assert.equal(r.estado, E.PARCIAL);
    assert.match(r.detalle, /se exigen 30/);
});

test('ítem 50: el comité y el delegado son alternativos', () => {
    const delegado = {
        tipo: EP.TIPO_ORGANO.DELEGADO_SST, estado: EP.ESTADO_ORGANO.VIGENTE,
        fechaTerminoMandato: '2028-01-01T00:00:00.000Z',
    };
    const doc = riohs({ difusiones: [difManual(D.DESTINATARIO.PERSONAS_TRABAJADORAS, '2026-08-01T00:00:00.000Z')] });
    const r = evaluarItem50(ctx50({ documentos: [doc], organos: [delegado] }));
    // Con delegado vigente el destinatario "comité o delegado" SÍ es exigible y falta.
    assert.equal(r.estado, E.PARCIAL);
    assert.match(r.detalle, /1 de 2/);
});

test('ítem 50: declarar que no hay sindicatos los saca del denominador con razón', () => {
    const doc = riohs({ difusiones: [difManual(D.DESTINATARIO.PERSONAS_TRABAJADORAS, '2026-08-01T00:00:00.000Z')] });
    const r = evaluarItem50(ctx50({
        documentos: [doc],
        sinOrganizacionesSindicales: { declarado: true, fecha: '2026-01-01', personaId: 'p1' },
    }));
    assert.equal(r.estado, E.CUMPLIDO, 'no se castiga por no informar a quien no existe');
});

test('ítem 50: el desglose por destinatario viaja con la evaluación', () => {
    const doc = riohs({ difusiones: [difManual(D.DESTINATARIO.PERSONAS_TRABAJADORAS, '2026-08-01T00:00:00.000Z')] });
    const r = evaluarItem50(ctx50({ documentos: [doc] }));
    assert.ok(r.distribucion, 'la pantalla necesita el desglose para operar el requisito');
    assert.equal(r.distribucion.documentoId, 'r1');
    assert.equal(r.distribucion.diasExigidos, D.DIAS_ANTICIPACION_REGLAMENTO);
    assert.equal(r.distribucion.resultado.detalle.length, D.DESTINATARIOS_REGLAMENTO.length);
    const trabajadores = r.distribucion.resultado.detalle.find(
        (d) => d.tipo === D.DESTINATARIO.PERSONAS_TRABAJADORAS);
    assert.equal(trabajadores.estado, D.ESTADO_DESTINATARIO.ENVIADO);
});

test('ítem 50: sin fecha de vigencia el desglose viaja igual, para poder registrar envíos', () => {
    // Si el desglose solo apareciera con la fecha declarada, el requisito sería
    // inoperable justo cuando falta el dato que lo desbloquea.
    const r = evaluarItem50(ctx50({ documentos: [riohs({ fechaEntradaVigencia: null })] }));
    assert.ok(r.distribucion);
    assert.equal(r.distribucion.fechaVigencia, null);
    assert.equal(r.distribucion.exigeVigencia, true);
    assert.equal(r.distribucion.resultado.detalle.length, D.DESTINATARIOS_REGLAMENTO.length);
});

test('ítem 50: el motor deja pasar el desglose hasta el requisito', () => {
    const doc = riohs();
    const { requisitos } = C.evaluarCompletitud(
        definicionesDocumentalesPara('empresa'),
        { ahora: AHORA, documentos: [doc], organos: [], obligaciones: {}, prescripciones: [] }
    );
    const item50 = requisitos.find((r) => r.item === 50);
    assert.ok(item50.distribucion, 'sin esto la interfaz tendría que recalcular la regla');
    assert.equal(item50.distribucion.articulo, 'Art. 57 inc. 2');
});

test('ítem 58: no trae desglose de distribución porque no se acredita informando', () => {
    const { requisitos } = C.evaluarCompletitud(
        definicionesDocumentalesPara('empresa'),
        { ahora: AHORA, documentos: [], organos: [], obligaciones: {}, prescripciones: [] }
    );
    assert.equal(requisitos.find((r) => r.item === 58).distribucion, null);
});

// ─── Ítem 1 ──────────────────────────────────────────────────────────────────

const doc = (tipo) => ({ documentId: tipo, tipo, s3Key: `${tipo}.pdf`, version: 1 });

test('ítem 1: los cinco componentes del Art. 22 se evalúan por separado', () => {
    const comps = componentesSgsst({ ahora: AHORA, documentos: [], obligaciones: {}, organos: [] });
    assert.equal(comps.length, 5);
    assert.deepEqual(comps.map((c) => c.clave), ['a', 'b', 'c', 'd', 'e']);
});

test('ítem 1: solo la Política es documento propio; el resto se referencia', () => {
    const comps = componentesSgsst({ ahora: AHORA, documentos: [], obligaciones: {}, organos: [] });
    assert.equal(comps.find((c) => c.clave === 'a').propio, true);
    assert.equal(comps.find((c) => c.clave === 'b').propio, false, 'la estructura se lee de su módulo, no se copia');
    assert.equal(comps.find((c) => c.clave === 'c').propio, false, 'MIPER y PTP se referencian');
});

test('ítem 1: no puede estar Cumplido si falta un componente (anti contradicción 7)', () => {
    const ctx = {
        ahora: AHORA, obligaciones: {}, organos: [],
        documentos: [doc('POLITICA_SSO'), doc('MIPER'), doc('PROGRAMA_TRABAJO_PREVENTIVO'), doc('EVALUACION_DESEMPENO')],
    };
    const r = evaluarItem1(ctx);
    assert.equal(r.estado, E.PARCIAL, 'falta el literal e)');
    assert.match(r.detalle, /4 de 5/);
});

test('ítem 1: con los cinco componentes queda Cumplido', () => {
    const ctx = {
        ahora: AHORA, obligaciones: {}, organos: [],
        documentos: ['POLITICA_SSO', 'MIPER', 'PROGRAMA_TRABAJO_PREVENTIVO', 'EVALUACION_DESEMPENO', 'PLAN_MEJORA'].map(doc),
    };
    assert.equal(evaluarItem1(ctx).estado, E.CUMPLIDO);
});

test('ítem 1: los cinco literales viajan con el requisito', () => {
    // Una sola fila del formulario, cinco obligaciones distintas: un badge único
    // no dice cuál falta.
    const r = evaluarItem1({ ahora: AHORA, documentos: [], obligaciones: {}, organos: [] });
    assert.equal(r.subrequisitos.length, 5);
    assert.deepEqual(r.subrequisitos.map((c) => c.clave), ['a', 'b', 'c', 'd', 'e']);
    assert.ok(r.subrequisitos.every((c) => c.titulo && c.estado));
});

test('ítem 1: el literal c) se cumple con la MIPER y el programa de las obras', () => {
    // El sistema de gestión es de la entidad y abarca sus lugares de trabajo.
    // Pedir una copia a nivel casa matriz sería exigir un documento que la norma
    // no manda hacer; por eso este componente mira todo el tenant.
    const deObra = (tipo) => ({ documentId: tipo, tipo, s3Key: `${tipo}.pdf`, version: 1, obraId: 'obra-A' });
    const comps = componentesSgsst({
        ahora: AHORA,
        documentos: [],                                    // nada a nivel empresa
        documentosTenant: [deObra('MIPER'), deObra('PROGRAMA_TRABAJO_PREVENTIVO')],
        obligaciones: {}, organos: [],
    });
    assert.equal(comps.find((c) => c.clave === 'c').estado, E.CUMPLIDO);
});

test('ítem 1: los demás literales NO miran los documentos de las obras', () => {
    // La Política es de la entidad: una cargada dentro de una obra no la acredita.
    const comps = componentesSgsst({
        ahora: AHORA,
        documentos: [],
        documentosTenant: [{ documentId: 'p', tipo: 'POLITICA_SSO', s3Key: 'p.pdf', version: 1, obraId: 'obra-A' }],
        obligaciones: {}, organos: [],
    });
    assert.equal(comps.find((c) => c.clave === 'a').estado, E.PENDIENTE);
});

// ─── Ítem 58 ─────────────────────────────────────────────────────────────────

const presc = (over = {}) => ({
    origen: PRE.ORIGEN_PRESCRIPCION.ORGANISMO_FISCALIZADOR,
    fechaPrescripcion: '2026-06-01T00:00:00.000Z',
    descripcion: 'Instalar barandas en el nivel 3',
    ...over,
});

test('el estado de una prescripción es derivado, no marcable', () => {
    assert.equal(PRE.estadoPrescripcion(presc(), AHORA), PRE.ESTADO_PRESCRIPCION.PENDIENTE);
    assert.equal(PRE.estadoPrescripcion(presc({ plazoImplementacion: '2026-07-01T00:00:00.000Z' }), AHORA),
        PRE.ESTADO_PRESCRIPCION.VENCIDA, 'vencida sale del plazo, no de un campo');
    assert.equal(PRE.estadoPrescripcion(presc({
        fechaImplementacion: '2026-06-20T00:00:00.000Z', evidenciaImplementacionDocumentoId: 'd1',
    }), AHORA), PRE.ESTADO_PRESCRIPCION.IMPLEMENTADA);
});

test('no se puede dar por implementada sin evidencia (anti contradicción 2)', () => {
    const errores = PRE.validarPrescripcion(presc({ fechaImplementacion: '2026-06-20T00:00:00.000Z' }), AHORA);
    assert.ok(errores.some((e) => /sin evidencia/.test(e)), errores.join(' | '));
});

test('ni sin fecha de implementación', () => {
    const errores = PRE.validarPrescripcion(presc({ evidenciaImplementacionDocumentoId: 'd1' }), AHORA);
    assert.ok(errores.some((e) => /sin fecha de implementación/.test(e)), errores.join(' | '));
});

test('ninguna fecha puede ser futura (anti contradicción 5)', () => {
    assert.ok(PRE.validarPrescripcion(presc({ fechaPrescripcion: '2027-01-01T00:00:00.000Z' }), AHORA)
        .some((e) => /no puede ser futura/.test(e)));
});

test('la implementación no puede ser anterior a la prescripción', () => {
    const errores = PRE.validarPrescripcion(presc({
        fechaImplementacion: '2026-01-01T00:00:00.000Z', evidenciaImplementacionDocumentoId: 'd1',
    }), AHORA);
    assert.ok(errores.some((e) => /anterior a la prescripción/.test(e)));
});

test('un origen fuera del Art. 70 se rechaza', () => {
    assert.ok(PRE.validarPrescripcion(presc({ origen: 'ElJefe' }), AHORA).some((e) => /Origen inválido/.test(e)));
});

test('ítem 58: sin prescripciones registradas queda Cumplido con la razón (D6)', () => {
    const r = evaluarItem58({ prescripciones: [] });
    assert.equal(r.estado, E.CUMPLIDO);
    assert.match(r.detalle, /Sin prescripciones registradas/);
});

test('ítem 58: una vencida sin implementar deja el ítem Vencido', () => {
    const r = evaluarItem58({ prescripciones: [{ estado: 'Vencida' }, { estado: 'Implementada' }] });
    assert.equal(r.estado, E.VENCIDO);
});

test('ítem 58: pendientes con algo implementado es Parcial', () => {
    const r = evaluarItem58({ prescripciones: [{ estado: 'Pendiente' }, { estado: 'Implementada' }] });
    assert.equal(r.estado, E.PARCIAL);
    assert.match(r.detalle, /1 de 2/);
});

test('ítem 58: todas implementadas es Cumplido', () => {
    assert.equal(evaluarItem58({ prescripciones: [{ estado: 'Implementada' }] }).estado, E.CUMPLIDO);
});
