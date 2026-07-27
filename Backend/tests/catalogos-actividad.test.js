const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
    DEFAULT_CATALOGOS,
    PERMISOS_TRABAJO_DEF,
    sanitizeCatalogosActividad,
    resolveCatalogos,
    validatePlanificacion,
    validatePermisosTrabajo,
} = require('../lib/catalogos-actividad');

// ── Defaults ──
test('DEFAULT_CATALOGOS trae las 4 listas no vacías con codigo+label', () => {
    for (const key of ['temas', 'recursos', 'riesgos', 'medidas']) {
        assert.ok(Array.isArray(DEFAULT_CATALOGOS[key]) && DEFAULT_CATALOGOS[key].length > 0, key);
        for (const item of DEFAULT_CATALOGOS[key]) {
            assert.match(item.codigo, /^[A-Z0-9_]+$/);
            assert.ok(item.label.trim().length > 0);
        }
    }
});

test('PERMISOS_TRABAJO_DEF define los 3 permisos con checklist de 5 ítems', () => {
    assert.deepEqual(Object.keys(PERMISOS_TRABAJO_DEF).sort(), ['ALTURA', 'ESPACIO_CONFINADO', 'TRABAJO_CALIENTE']);
    for (const def of Object.values(PERMISOS_TRABAJO_DEF)) {
        assert.equal(def.checklist.length, 5);
    }
});

// ── sanitizeCatalogosActividad ──
test('sanitize acepta un catálogo válido y normaliza códigos', () => {
    const out = sanitizeCatalogosActividad({
        temas: [{ codigo: ' fraguado ', label: ' Fraguado ' }],
        recursos: [], riesgos: [], medidas: [],
    });
    assert.deepEqual(out.temas, [{ codigo: 'FRAGUADO', label: 'Fraguado' }]);
    assert.deepEqual(out.recursos, []);
});

test('sanitize rechaza códigos duplicados y labels vacíos', () => {
    assert.throws(() => sanitizeCatalogosActividad({
        temas: [{ codigo: 'X', label: 'a' }, { codigo: 'X', label: 'b' }],
        recursos: [], riesgos: [], medidas: [],
    }), /duplicado/i);
    assert.throws(() => sanitizeCatalogosActividad({
        temas: [{ codigo: 'X', label: '  ' }],
        recursos: [], riesgos: [], medidas: [],
    }), /label/i);
});

test('sanitize rechaza estructuras que no son listas', () => {
    assert.throws(() => sanitizeCatalogosActividad({ temas: 'no', recursos: [], riesgos: [], medidas: [] }));
});

// ── resolveCatalogos ──
test('resolveCatalogos usa el default si el tenant no tiene catálogo', () => {
    assert.deepEqual(resolveCatalogos(null), DEFAULT_CATALOGOS);
    assert.deepEqual(resolveCatalogos({ reglas: {} }), DEFAULT_CATALOGOS);
});

test('resolveCatalogos usa la lista del tenant cuando existe, y default por lista vacía', () => {
    const tenant = { reglas: { catalogosActividad: { temas: [{ codigo: 'PROPIO', label: 'Propio' }], recursos: [] } } };
    const out = resolveCatalogos(tenant);
    assert.deepEqual(out.temas, [{ codigo: 'PROPIO', label: 'Propio' }]);
    assert.deepEqual(out.recursos, DEFAULT_CATALOGOS.recursos);
});

// ── validatePlanificacion ──
const CAT = DEFAULT_CATALOGOS;

test('planificacion válida completa se normaliza', () => {
    const { value, errores } = validatePlanificacion({
        tema: { codigo: 'FRAGUADO' },
        recursos: { codigos: ['BETONERA'], otro: '' },
        riesgos: { codigos: ['CAIDA_DESNIVEL'], otro: 'otro riesgo' },
        medidas: { codigos: ['USO_EPP'] },
        tipoTrabajo: 'exterior',
        condicionClimatica: 'despejado',
        protectorSolar: true,
        observaciones: ' ok ',
    }, CAT, 'CHARLA_5MIN');
    assert.deepEqual(errores, []);
    assert.equal(value.tema.codigo, 'FRAGUADO');
    assert.equal(value.protectorSolar, true);
    assert.equal(value.observaciones, 'ok');
    assert.equal(value.riesgos.otro, 'otro riesgo');
});

test('tema es obligatorio (codigo u otro) en CHARLA_5MIN y ART, no en otros tipos', () => {
    assert.ok(validatePlanificacion({}, CAT, 'CHARLA_5MIN').errores.length > 0);
    assert.ok(validatePlanificacion(undefined, CAT, 'ART').errores.length > 0);
    assert.deepEqual(validatePlanificacion({ observaciones: 'acta' }, CAT, 'REUNION_COMITE').errores, []);
    // Sin planificación en tipos que no la requieren → value null, sin errores.
    assert.deepEqual(validatePlanificacion(undefined, CAT, 'REUNION_COMITE'), { value: null, errores: [] });
    assert.deepEqual(validatePlanificacion({ tema: { otro: 'tema libre' } }, CAT, 'ART').errores, []);
});

test('códigos fuera del catálogo → error', () => {
    const { errores } = validatePlanificacion({
        tema: { codigo: 'NO_EXISTE' },
    }, CAT, 'CHARLA_5MIN');
    assert.ok(errores.some(e => /NO_EXISTE/.test(e)));
});

test('protectorSolar se anula si el trabajo no es exterior', () => {
    const { value } = validatePlanificacion({
        tema: { codigo: 'ASEO_ORDEN' }, tipoTrabajo: 'interior', protectorSolar: true,
    }, CAT, 'CHARLA_5MIN');
    assert.equal(value.protectorSolar, null);
});

test('enums inválidos y largos excedidos → error', () => {
    const { errores } = validatePlanificacion({
        tema: { otro: 'x'.repeat(201) }, tipoTrabajo: 'submarino', condicionClimatica: 'granizo',
        observaciones: 'x'.repeat(4001),
    }, CAT, 'CHARLA_5MIN');
    assert.ok(errores.length >= 3);
});

// ── validatePermisosTrabajo ──
const RESP = new Set(['p-1']);
const permisoBase = {
    tipo: 'ALTURA', responsableId: 'p-1', horaInicio: '08:00', horaFin: '13:00',
    ubicacion: 'Piso 4', checklist: {
        arnes_inspeccionado: 'si', anclajes_definidos: 'si', plataformas_revisadas: 'si',
        examen_altura_vigente: 'si', area_delimitada: 'na',
    },
};

test('permiso completo válido: completo=true', () => {
    const { value, errores } = validatePermisosTrabajo([permisoBase], RESP);
    assert.deepEqual(errores, []);
    assert.equal(value[0].completo, true);
});

test('checklist incompleto → completo=false pero sin error', () => {
    const p = { ...permisoBase, checklist: { arnes_inspeccionado: 'si' } };
    const { value, errores } = validatePermisosTrabajo([p], RESP);
    assert.deepEqual(errores, []);
    assert.equal(value[0].completo, false);
});

test('tipo inválido, responsable desconocido, hora malformada y tipo duplicado → errores', () => {
    assert.ok(validatePermisosTrabajo([{ ...permisoBase, tipo: 'BUCEO' }], RESP).errores.length > 0);
    assert.ok(validatePermisosTrabajo([{ ...permisoBase, responsableId: 'nadie' }], RESP).errores.length > 0);
    assert.ok(validatePermisosTrabajo([{ ...permisoBase, horaInicio: '8am' }], RESP).errores.length > 0);
    assert.ok(validatePermisosTrabajo([permisoBase, permisoBase], RESP).errores.length > 0);
});

test('claves de checklist ajenas a la definición → error; lista vacía/undefined → []', () => {
    const p = { ...permisoBase, checklist: { ...permisoBase.checklist, sabotaje: 'si' } };
    assert.ok(validatePermisosTrabajo([p], RESP).errores.length > 0);
    assert.deepEqual(validatePermisosTrabajo(undefined, RESP), { value: [], errores: [] });
});

test('rango horario invertido → error', () => {
    const p = { ...permisoBase, horaInicio: '13:00', horaFin: '08:00' };
    const { errores } = validatePermisosTrabajo([p], RESP);
    assert.ok(errores.length > 0);
});

test('horaInicio igual a horaFin → error', () => {
    const p = { ...permisoBase, horaInicio: '08:00', horaFin: '08:00' };
    const { errores } = validatePermisosTrabajo([p], RESP);
    assert.ok(errores.length > 0);
});

test('demasiados códigos seleccionados en recursos → error', () => {
    const { errores } = validatePlanificacion({
        tema: { codigo: 'FRAGUADO' },
        recursos: { codigos: Array(101).fill('BETONERA') },
    }, CAT, 'CHARLA_5MIN');
    assert.ok(errores.some((e) => /demasiados/.test(e)));
});
