const { test } = require('node:test');
const assert = require('node:assert/strict');

const EP = require('../lib/estructura-preventiva');
const {
    TIPO_ORGANO: T, AMBITO, ORIGEN, ESTADO_ORGANO,
    obligacionesDeAmbito, origenSegunObligacion, perfilRegistrosIndicadores,
    dotacionDeObra, dotacionDeEmpresa, dotacionEfectiva,
    fechaTerminoMandato, estadoOrgano, hayCphsVigente, fechaLimiteCursoOpr,
} = EP;

const empresa = (dotacion, hayCphs = false) =>
    obligacionesDeAmbito({ dotacion, ambito: AMBITO.EMPRESA, hayCphsVigente: hayCphs });
const obra = (dotacion, hayCphs = false) =>
    obligacionesDeAmbito({ dotacion, ambito: AMBITO.OBRA, hayCphsVigente: hayCphs });

// ─── Cortes exigidos por el encargo: 9, 10, 25, 26, 100 y 101 ────────────────

test('corte 9: ninguna figura es obligatoria', () => {
    const o = obra(9);
    assert.equal(o[T.COMITE_PARITARIO].obligatorio, false);
    assert.equal(o[T.DELEGADO_SST].obligatorio, false);
});

test('corte 10: el delegado SST pasa a ser obligatorio', () => {
    const o = obra(10);
    assert.equal(o[T.DELEGADO_SST].obligatorio, true);
    assert.equal(o[T.COMITE_PARITARIO].obligatorio, false);
});

test('corte 25: el delegado sigue obligatorio y el CPHS todavía no', () => {
    const o = obra(25);
    assert.equal(o[T.DELEGADO_SST].obligatorio, true);
    assert.equal(o[T.COMITE_PARITARIO].obligatorio, false, 'el Art. 23 exige MÁS de 25');
});

test('corte 26: el CPHS pasa a ser obligatorio y el delegado deja de serlo', () => {
    const o = obra(26);
    assert.equal(o[T.COMITE_PARITARIO].obligatorio, true);
    assert.equal(o[T.DELEGADO_SST].obligatorio, false);
});

test('corte 100: el DPR no es obligatorio y el encargado sigue disponible', () => {
    const e = empresa(100);
    assert.equal(e[T.DEPARTAMENTO_PREVENCION].obligatorio, false, 'el Art. 50 exige MÁS de 100');
    assert.equal(e[T.ENCARGADO_GESTION_RIESGO].aplica, true);
});

test('corte 101: el DPR pasa a ser obligatorio y el encargado deja de aplicar', () => {
    const e = empresa(101);
    assert.equal(e[T.DEPARTAMENTO_PREVENCION].obligatorio, true);
    assert.equal(e[T.ENCARGADO_GESTION_RIESGO].aplica, false);
});

// ─── Anti contradicción (sección 10 del encargo) ─────────────────────────────

test('regla 2: con CPHS vigente en el ámbito, el delegado no es obligatorio', () => {
    for (const n of [10, 15, 25]) {
        assert.equal(obra(n, true)[T.DELEGADO_SST].obligatorio, false, `dotación ${n}`);
        assert.equal(obra(n, false)[T.DELEGADO_SST].obligatorio, true, `dotación ${n}`);
    }
});

test('regla 3: los ítems 46 y 47 son excluyentes', () => {
    assert.deepEqual(perfilRegistrosIndicadores(101), { perfil: 'extendido', itemFuf: 46, articulo: 'Arts. 73 y 74' });
    assert.deepEqual(perfilRegistrosIndicadores(100), { perfil: 'minimo', itemFuf: 47, articulo: 'Art. 75' });
});

test('regla 4: encargado y DPR obligatorio no coexisten como exigibles', () => {
    for (const n of [0, 1, 50, 100, 101, 500]) {
        const e = empresa(n);
        const dprExigible = e[T.DEPARTAMENTO_PREVENCION].obligatorio;
        const encargadoDisponible = e[T.ENCARGADO_GESTION_RIESGO].aplica;
        assert.ok(!(dprExigible && encargadoDisponible), `dotación ${n}: no pueden coexistir`);
    }
});

test('regla 5: el mandato es de 2 años desde la elección', () => {
    const fin = fechaTerminoMandato('2026-03-10T00:00:00.000Z');
    assert.equal(new Date(fin).getUTCFullYear(), 2028);
    assert.equal(new Date(fin).getUTCMonth(), 2);
    assert.equal(new Date(fin).getUTCDate(), 10);
});

// ─── Ámbito: empresa vs obra ─────────────────────────────────────────────────

test('el CPHS se calcula por ámbito: la empresa no exime a la faena', () => {
    // Empresa con comité vigente, pero una obra de 30 personas necesita el suyo.
    assert.equal(obra(30, true)[T.COMITE_PARITARIO].obligatorio, true);
});

test('DPR y encargado no aplican a nivel obra', () => {
    const o = obra(500);
    assert.equal(o[T.DEPARTAMENTO_PREVENCION].aplica, false);
    assert.equal(o[T.ENCARGADO_GESTION_RIESGO].aplica, false);
});

// ─── Principio rector: obligación no es exclusividad ─────────────────────────

test('bajo el umbral, constituir sigue permitido y se marca voluntario', () => {
    const o = obra(5);
    assert.equal(o[T.COMITE_PARITARIO].aplica, true, 'nunca se bloquea constituir');
    assert.equal(origenSegunObligacion(o[T.COMITE_PARITARIO].obligatorio), ORIGEN.VOLUNTARIO);
    assert.equal(origenSegunObligacion(obra(26)[T.COMITE_PARITARIO].obligatorio), ORIGEN.OBLIGATORIO);
});

// ─── Dotación ────────────────────────────────────────────────────────────────

const personas = [
    { personaId: 'p1', estado: 'activo', asignaciones: [{ obraId: 'A', estado: 'activa' }] },
    { personaId: 'p2', estado: 'activo', asignaciones: [{ obraId: 'A', estado: 'activa' }] },
    { personaId: 'p3', estado: 'activo', asignaciones: [{ obraId: 'B', estado: 'activa' }] },
    { personaId: 'p4', estado: 'inactivo', asignaciones: [{ obraId: 'A', estado: 'activa' }] },
    { personaId: 'p5', estado: 'activo', asignaciones: [{ obraId: 'A', estado: 'finalizada' }] },
];

test('la dotación de obra cuenta solo asignaciones activas de personas activas', () => {
    assert.equal(dotacionDeObra(personas, 'A'), 2);
    assert.equal(dotacionDeObra(personas, 'B'), 1);
    assert.equal(dotacionDeObra(personas, 'INEXISTENTE'), 0);
    assert.equal(dotacionDeObra(null, 'A'), 0);
});

test('la dotación de empresa excluye inactivos', () => {
    assert.equal(dotacionDeEmpresa(personas), 4);
});

test('la dotación declarada sobrescribe la calculada y deja constancia del origen', () => {
    assert.deepEqual(dotacionEfectiva({ calculada: 12 }), {
        dotacion: 12, origen: 'calculada', calculada: 12, declarada: null, observacion: null,
    });
    const conOverride = dotacionEfectiva({ calculada: 12, declarada: 30, observacion: 'incluye turno noche' });
    assert.equal(conOverride.dotacion, 30);
    assert.equal(conOverride.origen, 'declarada');
    assert.equal(conOverride.observacion, 'incluye turno noche');
    assert.equal(conOverride.calculada, 12, 'la calculada se conserva para poder contrastar');
});

test('un override cambia la obligación resultante', () => {
    const calculada = dotacionEfectiva({ calculada: 9 });
    const declarada = dotacionEfectiva({ calculada: 9, declarada: 30 });
    assert.equal(obra(calculada.dotacion)[T.COMITE_PARITARIO].obligatorio, false);
    assert.equal(obra(declarada.dotacion)[T.COMITE_PARITARIO].obligatorio, true);
});

// ─── Vigencia derivada ───────────────────────────────────────────────────────

const ahora = new Date('2026-09-08T12:00:00.000Z');

test('el órgano vence solo por fecha, sin cerrarlo a mano', () => {
    const vigente = { tipo: T.COMITE_PARITARIO, fechaTerminoMandato: '2027-01-01T00:00:00.000Z' };
    const vencido = { tipo: T.COMITE_PARITARIO, fechaTerminoMandato: '2026-01-01T00:00:00.000Z' };
    assert.equal(estadoOrgano(vigente, ahora), ESTADO_ORGANO.VIGENTE);
    assert.equal(estadoOrgano(vencido, ahora), ESTADO_ORGANO.VENCIDO);
});

test('disolver manda sobre la fecha', () => {
    const disuelto = { tipo: T.COMITE_PARITARIO, estado: ESTADO_ORGANO.DISUELTO, fechaTerminoMandato: '2027-01-01T00:00:00.000Z' };
    assert.equal(estadoOrgano(disuelto, ahora), ESTADO_ORGANO.DISUELTO);
});

test('DPR y encargado no vencen por mandato', () => {
    const dpr = { tipo: T.DEPARTAMENTO_PREVENCION, estado: ESTADO_ORGANO.VIGENTE, fechaTerminoMandato: null };
    assert.equal(estadoOrgano(dpr, ahora), ESTADO_ORGANO.VIGENTE);
    assert.equal(EP.tieneMandato(T.DEPARTAMENTO_PREVENCION), false);
    assert.equal(EP.tieneMandato(T.COMITE_PARITARIO), true);
});

test('hayCphsVigente ignora comités vencidos y disueltos', () => {
    const vencido = { tipo: T.COMITE_PARITARIO, fechaTerminoMandato: '2026-01-01T00:00:00.000Z' };
    const vigente = { tipo: T.COMITE_PARITARIO, fechaTerminoMandato: '2027-01-01T00:00:00.000Z' };
    assert.equal(hayCphsVigente([vencido], ahora), false);
    assert.equal(hayCphsVigente([vencido, vigente], ahora), true);
    assert.equal(hayCphsVigente([], ahora), false);
});

test('el curso OPR vence a los 6 meses de la elección (Art. 32)', () => {
    const lim = fechaLimiteCursoOpr('2026-03-10T00:00:00.000Z');
    assert.equal(new Date(lim).getUTCMonth(), 8, 'marzo + 6 meses = septiembre');
    assert.equal(new Date(lim).getUTCFullYear(), 2026);
});

// ─── Validaciones de dominio (sección 10) ─────────────────────────────────────

const { validarMiembros, validarFechasOrgano, validarReunionRealizada, generarPeriodosOrdinarios,
    ESTAMENTO: EST, CALIDAD: CAL, CARGO_ORGANO: CG } = EP;

const comiteValido = () => [
    { personaId: 'e1', nombre: 'Ana', estamento: EST.EMPLEADOR, calidad: CAL.TITULAR, cargo: CG.PRESIDENTE },
    { personaId: 'e2', nombre: 'Beto', estamento: EST.EMPLEADOR, calidad: CAL.TITULAR, cargo: CG.INTEGRANTE },
    { personaId: 'e3', nombre: 'Cata', estamento: EST.EMPLEADOR, calidad: CAL.TITULAR, cargo: CG.INTEGRANTE },
    { personaId: 't1', nombre: 'Dani', estamento: EST.TRABAJADORES, calidad: CAL.TITULAR, cargo: CG.SECRETARIO },
    { personaId: 't2', nombre: 'Eva', estamento: EST.TRABAJADORES, calidad: CAL.TITULAR, cargo: CG.INTEGRANTE },
    { personaId: 't3', nombre: 'Fito', estamento: EST.TRABAJADORES, calidad: CAL.TITULAR, cargo: CG.INTEGRANTE },
];

test('regla 7: un comité bien compuesto no arroja errores', () => {
    assert.deepEqual(validarMiembros(comiteValido()), []);
});

test('regla 7: nadie puede ser titular y suplente a la vez', () => {
    const m = [...comiteValido(),
        { personaId: 'e1', nombre: 'Ana', estamento: EST.EMPLEADOR, calidad: CAL.SUPLENTE, cargo: CG.INTEGRANTE }];
    const errores = validarMiembros(m);
    assert.ok(errores.some((e) => /titular y suplente/.test(e)), errores.join(' | '));
});

test('regla 7: nadie puede representar a ambos estamentos', () => {
    const m = [...comiteValido(),
        { personaId: 'e1', nombre: 'Ana', estamento: EST.TRABAJADORES, calidad: CAL.TITULAR, cargo: CG.INTEGRANTE }];
    const errores = validarMiembros(m);
    assert.ok(errores.some((e) => /ambos estamentos/.test(e)), errores.join(' | '));
});

test('el comité exige 3 titulares por estamento (Art. 23)', () => {
    const m = comiteValido().filter((x) => x.personaId !== 't3');
    const errores = validarMiembros(m);
    assert.ok(errores.some((e) => /3 representantes titulares/.test(e)), errores.join(' | '));
});

test('el comité exige un presidente y un secretario', () => {
    const m = comiteValido().map((x) => ({ ...x, cargo: CG.INTEGRANTE }));
    const errores = validarMiembros(m);
    assert.ok(errores.some((e) => /presidente/.test(e)));
    assert.ok(errores.some((e) => /secretario/.test(e)));
});

test('regla 6: ninguna fecha de elección o constitución puede ser futura', () => {
    const ahora = new Date('2026-09-08T12:00:00Z');
    assert.ok(validarFechasOrgano({ tipo: T.COMITE_PARITARIO, fechaEleccionODesignacion: '2027-01-01', ahora })
        .some((e) => /no puede ser futura/.test(e)));
    assert.ok(validarFechasOrgano({
        tipo: T.COMITE_PARITARIO, fechaEleccionODesignacion: '2026-01-10',
        fechaConstitucion: '2027-01-01', ahora,
    }).some((e) => /constitución no puede ser futura/.test(e)));
});

test('regla 5: el mandato no puede exceder 2 años desde la elección', () => {
    const ahora = new Date('2026-09-08T12:00:00Z');
    const base = { tipo: T.COMITE_PARITARIO, fechaEleccionODesignacion: '2026-01-10', ahora };
    assert.deepEqual(validarFechasOrgano({ ...base, fechaTerminoMandato: '2028-01-10' }), [],
        'exactamente 2 años es válido');
    assert.ok(validarFechasOrgano({ ...base, fechaTerminoMandato: '2029-01-10' })
        .some((e) => /no puede exceder 2 años/.test(e)), 'más de 2 años se rechaza');
    assert.deepEqual(validarFechasOrgano({ ...base, fechaTerminoMandato: '2027-06-01' }), [],
        'acortar el mandato sí se permite');
});

test('regla 10: la constitución no puede ser anterior a la creación del ámbito', () => {
    const errores = validarFechasOrgano({
        tipo: T.COMITE_PARITARIO,
        fechaEleccionODesignacion: '2026-01-10',
        fechaConstitucion: '2026-01-15',
        fechaCreacionAmbito: '2026-03-01',
        ahora: new Date('2026-09-08T12:00:00Z'),
    });
    assert.ok(errores.some((e) => /anterior a la creación/.test(e)), errores.join(' | '));
});

test('regla 8: no se marca una reunión realizada sin acta', () => {
    const ahora = new Date('2026-09-08T12:00:00Z');
    assert.ok(validarReunionRealizada({ fechaRealizada: '2026-09-01', ahora })
        .some((e) => /sin el acta/.test(e)));
    assert.deepEqual(validarReunionRealizada({ fechaRealizada: '2026-09-01', actaDocumentoId: 'doc-1', ahora }), []);
    assert.ok(validarReunionRealizada({ fechaRealizada: '2027-01-01', actaDocumentoId: 'doc-1', ahora })
        .some((e) => /no puede ser futura/.test(e)));
});

test('las reuniones ordinarias se generan una por mes del mandato (Art. 39)', () => {
    const periodos = generarPeriodosOrdinarios('2026-01-10T00:00:00Z', '2028-01-10T00:00:00Z');
    const meses = periodos.map((p) => p.periodoMes);
    assert.equal(new Set(meses).size, meses.length, 'una sola ordinaria por mes');
    assert.equal(meses[0], '2026-01');
    assert.ok(meses.length >= 24 && meses.length <= 25, `esperaba ~24 meses, hubo ${meses.length}`);
    assert.ok(periodos.every((p) => p.fechaProgramada >= '2026-01-10' && p.fechaProgramada <= '2028-01-10'));
});

test('sin mandato válido no se generan periodos', () => {
    assert.deepEqual(generarPeriodosOrdinarios(null, '2028-01-10'), []);
    assert.deepEqual(generarPeriodosOrdinarios('2028-01-10', '2026-01-10'), []);
});

// ─── Documentos por período: ítems 38, 46 y 47 ───────────────────────────────

const { periodoAnual, estadoDocumentoPeriodico, FUNCIONES_CPHS_ART47,
    CONTENIDO_REGISTROS_INDICADORES } = EP;

test('el período por defecto es el año calendario', () => {
    assert.equal(periodoAnual(new Date('2026-09-09T12:00:00Z')), '2026');
    assert.equal(periodoAnual(new Date('2026-01-01T00:00:00Z')), '2026');
});

test('un documento del período exigido queda Cargado', () => {
    const docs = [{ periodo: '2026', documentId: 'd1' }];
    const r = estadoDocumentoPeriodico(docs, '2026', new Date('2026-09-09T12:00:00Z'));
    assert.equal(r.estado, 'Cargado');
    assert.equal(r.documento.documentId, 'd1');
});

test('sin documento y con el período corriendo, queda Pendiente', () => {
    const r = estadoDocumentoPeriodico([], '2026', new Date('2026-09-09T12:00:00Z'));
    assert.equal(r.estado, 'Pendiente');
    assert.equal(r.documento, null);
});

test('sin documento y con el período ya cerrado, queda Vencido', () => {
    // Vencido y Pendiente no son lo mismo: uno ya no tiene remedio en su período.
    const r = estadoDocumentoPeriodico([], '2025', new Date('2026-09-09T12:00:00Z'));
    assert.equal(r.estado, 'Vencido');
});

test('un documento de otro período no cubre el exigido', () => {
    const docs = [{ periodo: '2025', documentId: 'viejo' }];
    const r = estadoDocumentoPeriodico(docs, '2026', new Date('2026-09-09T12:00:00Z'));
    assert.equal(r.estado, 'Pendiente');
    assert.equal(r.documento, null);
});

test('las funciones del Art. 47 son texto informativo, no un checklist', () => {
    assert.ok(Array.isArray(FUNCIONES_CPHS_ART47));
    assert.equal(FUNCIONES_CPHS_ART47.length, 8);
    assert.ok(FUNCIONES_CPHS_ART47.some((f) => /negligencia inexcusable/i.test(f)));
    assert.ok(FUNCIONES_CPHS_ART47.every((f) => typeof f === 'string'));
});

test('los ítems 46 y 47 piden contenidos distintos y excluyentes', () => {
    const ext = CONTENIDO_REGISTROS_INDICADORES.extendido;
    const min = CONTENIDO_REGISTROS_INDICADORES.minimo;
    assert.ok(ext.length > min.length);
    assert.ok(ext.some((c) => /diferenciado por sexo/i.test(c)), 'el perfil extendido exige desagregación por sexo');
    assert.ok(ext.some((c) => /frecuencia/i.test(c)) && ext.some((c) => /gravedad/i.test(c)));
    assert.ok(!min.some((c) => /frecuencia mensual|gravedad semestral/i.test(c)),
        'el perfil mínimo NO exige frecuencia mensual ni gravedad semestral');
    assert.ok(min.some((c) => /tasa anual de accidentabilidad/i.test(c)));
});

test('el perfil exigible se deriva del tramo, uno u otro nunca ambos', () => {
    const conDpr = EP.perfilRegistrosIndicadores(150);
    const sinDpr = EP.perfilRegistrosIndicadores(80);
    assert.equal(CONTENIDO_REGISTROS_INDICADORES[conDpr.perfil].length, 8);
    assert.equal(CONTENIDO_REGISTROS_INDICADORES[sinDpr.perfil].length, 3);
    assert.notEqual(conDpr.itemFuf, sinDpr.itemFuf);
});
