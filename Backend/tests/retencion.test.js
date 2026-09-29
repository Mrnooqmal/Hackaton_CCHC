// El plan de retención: qué vence, qué se conserva y por qué.
//
// Reglas (D-2 y decisiones del 28 de septiembre de 2026): 5 años desde el
// término del vínculo; lo grupal se conserva hasta el último involucrado; al
// vencer, los incidentes se anonimizan y el resto se suprime; la retención
// legal suspende todo; ante la duda, se conserva.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { planDeRetencion, plazoDePersona, extensionesDeBloqueo, sumarAnios, INDEFINIDO, CONFIG } = require('../lib/gobernanza/retencion');

const HOY = new Date('2032-06-01T12:00:00Z');

const persona = (personaId, extra = {}) => ({
    PK: 'TENANT#t', SK: `PERSONA#${personaId}`, personaId, estado: 'activo', rutHmac: `v1:${personaId}`, ...extra,
});
const desvinculada = (personaId, fecha, extra = {}) => persona(personaId, { estado: 'desvinculado', fechaTerminoVinculo: fecha, ...extra });

const VENCIDA = '2026-01-15T00:00:00Z';   // + 5 años = 2031-01-15 < HOY
const EN_PLAZO = '2028-03-01T00:00:00Z';  // + 5 años = 2033-03-01 > HOY

const plan = (personas, registros = {}, extra = {}) =>
    planDeRetencion({ personas, registros: { PERSONAS_TABLE: personas, ...registros }, hoy: HOY, ...extra });

const accionesDe = (p, tabla) => p.acciones.filter((a) => a.tabla === tabla);

// ─── El plazo de una persona ─────────────────────────────────────────────────

test('una persona activa, o sin fecha de término, no tiene plazo corriendo', () => {
    assert.equal(plazoDePersona(persona('a')), INDEFINIDO);
    assert.equal(plazoDePersona(persona('a', { estado: 'desvinculado' })), INDEFINIDO, 'desvinculada sin fecha: no se puede contar');
    assert.equal(plazoDePersona(persona('a', { estado: 'activo', fechaTerminoVinculo: VENCIDA })), INDEFINIDO, 'reactivada: vuelve a correr desde el nuevo término');
});

test('el plazo son cinco años desde el término del vínculo', () => {
    assert.equal(plazoDePersona(desvinculada('a', '2026-01-15')).toISOString().slice(0, 10), '2031-01-15');
    assert.equal(plazoDePersona(persona('a', { estado: 'inactivo', fechaTerminoVinculo: '2026-01-15' })).toISOString().slice(0, 10), '2031-01-15');
});

test('un término un 29 de febrero vence el 28 de febrero, no el 1 de marzo', () => {
    assert.equal(sumarAnios('2024-02-29T00:00:00Z', 5).toISOString().slice(0, 10), '2029-02-28');
});

// ─── Qué vence ───────────────────────────────────────────────────────────────

test('nadie vencido: el plan no propone nada', () => {
    const p = plan([persona('a'), desvinculada('b', EN_PLAZO)], {
        SIGNATURES_TABLE: [{ signatureId: 's1', personaId: 'b' }],
    });
    assert.deepEqual(p.acciones, []);
    assert.deepEqual(p.personas.map((x) => x.estado), ['vigente', 'en_plazo']);
});

test('vencido el plazo: se suprimen la ficha, sus firmas, sus documentos propios y sus archivos', () => {
    const p = plan([desvinculada('a', VENCIDA), persona('b')], {
        SIGNATURES_TABLE: [{ signatureId: 's1', personaId: 'a' }, { signatureId: 's2', personaId: 'b' }],
        DOCUMENTS_TABLE: [{ documentId: 'd1', asignaciones: [{ personaId: 'a' }], s3Key: 'tenants/t/documentos/a.pdf' }],
        AUSENCIAS_TABLE: [{ tenantId: 't', sk: 'AUS#1', personaId: 'a' }],
    });
    assert.deepEqual(accionesDe(p, 'PERSONAS_TABLE').map((a) => a.clave), [{ PK: 'TENANT#t', SK: 'PERSONA#a' }]);
    assert.deepEqual(accionesDe(p, 'SIGNATURES_TABLE').map((a) => a.clave), [{ signatureId: 's1' }], 'la firma de b no se toca');
    assert.equal(accionesDe(p, 'DOCUMENTS_TABLE')[0].accion, 'suprimir');
    assert.equal(accionesDe(p, 'AUSENCIAS_TABLE').length, 1);
    assert.deepEqual(p.archivos.suprimir, ['tenants/t/documentos/a.pdf']);
    assert.equal(accionesDe(p, 'PERSONAS_TABLE')[0].vencioEl, '2031-01-15');
});

test('dentro del plazo, nada se toca aunque la persona ya no trabaje', () => {
    const p = plan([desvinculada('a', EN_PLAZO)], { SIGNATURES_TABLE: [{ signatureId: 's1', personaId: 'a' }] });
    assert.deepEqual(p.acciones, []);
});

// ─── Lo grupal ───────────────────────────────────────────────────────────────

test('un acta con un firmante vencido y otro activo se conserva completa, y se informa por qué', () => {
    const p = plan([desvinculada('a', VENCIDA), persona('b')], {
        ACTIVITIES_TABLE: [{ activityId: 'act1', asistentes: [{ personaId: 'a' }, { personaId: 'b' }] }],
        DOCUMENTS_TABLE: [{ documentId: 'd1', firmas: [{ personaId: 'a' }, { personaId: 'b' }], s3Key: 'k/acta.pdf' }],
    });
    assert.equal(accionesDe(p, 'ACTIVITIES_TABLE').length, 0);
    assert.equal(accionesDe(p, 'DOCUMENTS_TABLE').length, 0);
    assert.deepEqual(p.conservados.map((c) => [c.tabla, c.porque, c.conservarHasta]),
        [['DOCUMENTS_TABLE', 'grupal', INDEFINIDO], ['ACTIVITIES_TABLE', 'grupal', INDEFINIDO]]);
    assert.deepEqual(p.archivos.suprimir, []);
});

test('el acta vence cuando vence el plazo del ÚLTIMO involucrado', () => {
    const p = plan([desvinculada('a', VENCIDA), desvinculada('b', '2027-02-01T00:00:00Z')], {
        ACTIVITIES_TABLE: [{ activityId: 'act1', asistentes: [{ personaId: 'a' }, { personaId: 'b' }] }],
    });
    const [a] = accionesDe(p, 'ACTIVITIES_TABLE');
    assert.equal(a.accion, 'suprimir');
    assert.equal(a.vencioEl, '2032-02-01', 'la fecha de b, la más tardía');
});

test('un firmante de versiones anteriores del documento también cuenta', () => {
    const p = plan([desvinculada('a', VENCIDA), persona('b')], {
        DOCUMENTS_TABLE: [{ documentId: 'd1', firmas: [{ personaId: 'a' }], versiones: [{ firmasArchivadas: [{ personaId: 'b' }] }] }],
    });
    assert.equal(accionesDe(p, 'DOCUMENTS_TABLE').length, 0);
});

// ─── Incidentes: se anonimizan ──────────────────────────────────────────────

test('el incidente de una persona vencida se anonimiza, no se borra, vinculado por el HMAC de su RUT', () => {
    const p = plan([desvinculada('a', VENCIDA)], {
        INCIDENTS_TABLE: [{ incidentId: 'i1', afectadoRutHmac: 'v1:a', tipo: 'accidente', diasPerdidos: 3, evidencias: ['tenants/t/incidentes/foto.jpg'] }],
    });
    const [a] = accionesDe(p, 'INCIDENTS_TABLE');
    assert.equal(a.accion, 'anonimizar');
    assert.ok(a.campos.includes('cifrado') && a.campos.includes('trabajadorNombre'));
    assert.ok(!a.campos.includes('tipo') && !a.campos.includes('diasPerdidos'), 'el hecho se conserva para los indicadores');
    assert.deepEqual(p.archivos.suprimir, ['tenants/t/incidentes/foto.jpg'], 'la evidencia fotográfica sí se va');
});

// ─── Retención legal ────────────────────────────────────────────────────────

test('la retención legal de una persona suspende su vencimiento', () => {
    const p = plan([desvinculada('a', VENCIDA, { retencionLegal: { motivo: 'fiscalización' } })], {
        SIGNATURES_TABLE: [{ signatureId: 's1', personaId: 'a' }],
    });
    assert.deepEqual(p.acciones, []);
    assert.equal(p.personas[0].estado, 'retencion_legal');
});

test('la retención legal de la empresa suspende todo', () => {
    const p = plan([desvinculada('a', VENCIDA), desvinculada('b', VENCIDA)], {
        SIGNATURES_TABLE: [{ signatureId: 's1', personaId: 'a' }],
    }, { empresa: { retencionLegal: { motivo: 'juicio' } } });
    assert.deepEqual(p.acciones, []);
    assert.ok(p.personas.every((x) => x.estado === 'retencion_legal'));
});

test('un acta con un firmante vencido y otro en retención legal se conserva por retención legal', () => {
    const p = plan([desvinculada('a', VENCIDA), desvinculada('b', VENCIDA, { retencionLegal: { motivo: 'x' } })], {
        ACTIVITIES_TABLE: [{ activityId: 'act1', asistentes: [{ personaId: 'a' }, { personaId: 'b' }] }],
    });
    assert.equal(p.acciones.filter((a) => a.tabla === 'ACTIVITIES_TABLE').length, 0);
    assert.equal(p.conservados.find((c) => c.tabla === 'ACTIVITIES_TABLE').porque, 'retencion_legal');
});

// ─── Ante la duda, se conserva ──────────────────────────────────────────────

test('un registro que menciona a una persona que no está en la empresa se conserva', () => {
    const p = plan([desvinculada('a', VENCIDA)], {
        ACTIVITIES_TABLE: [{ activityId: 'act1', asistentes: [{ personaId: 'a' }, { personaId: 'fantasma' }] }],
    });
    assert.equal(p.acciones.filter((a) => a.tabla === 'ACTIVITIES_TABLE').length, 0);
    assert.equal(p.conservados.find((c) => c.tabla === 'ACTIVITIES_TABLE').porque, 'persona_no_identificada');
});

test('un documento de la empresa, sin personas, nunca vence por personas', () => {
    const p = plan([desvinculada('a', VENCIDA)], {
        DOCUMENTS_TABLE: [{ documentId: 'ri', tipo: 'REGLAMENTO_INTERNO', s3Key: 'k/ri.pdf' }],
    });
    assert.equal(accionesDe(p, 'DOCUMENTS_TABLE').length, 0);
    assert.equal(p.archivos.conservarHasta['k/ri.pdf'], INDEFINIDO);
});

test('un archivo que otro registro todavía usa no se suprime', () => {
    const p = plan([desvinculada('a', VENCIDA), persona('b')], {
        SIGNATURES_TABLE: [{ signatureId: 's1', personaId: 'a', documentosFirmados: [{ url: 'k/compartido.pdf' }] }],
        DOCUMENTS_TABLE: [{ documentId: 'd2', asignaciones: [{ personaId: 'b' }], s3Key: 'k/compartido.pdf' }],
    });
    assert.equal(accionesDe(p, 'SIGNATURES_TABLE').length, 1);
    assert.deepEqual(p.archivos.suprimir, []);
});

test('sesiones, vales, licencias, la empresa y las obras no entran al plan', () => {
    const p = plan([desvinculada('a', VENCIDA)], {
        SESSIONS_TABLE: [{ sessionId: 's', personaId: 'a' }],
        VALES_TABLE: [{ valeHash: 'v', personaId: 'a' }],
        TENANTS_TABLE: [{ PK: 'TENANT#t', SK: 'METADATA' }],
    });
    assert.deepEqual(p.acciones.map((a) => a.tabla), ['PERSONAS_TABLE']);
});

// ─── Bloqueos de S3 ─────────────────────────────────────────────────────────

const bloqueos = (objetos, conservar) => extensionesDeBloqueo(objetos, conservar, { hoy: HOY, config: CONFIG });

test('un bloqueo lejano a vencer no se toca', () => {
    assert.deepEqual(bloqueos([{ key: 'k', retenerHasta: '2036-01-01T00:00:00Z' }], () => INDEFINIDO), []);
});

test('un bloqueo por vencer de evidencia que sigue vigente se extiende un año', () => {
    const [e] = bloqueos([{ key: 'k', retenerHasta: '2032-07-01T00:00:00Z' }], () => INDEFINIDO);
    assert.equal(e.hasta.slice(0, 10), '2033-07-01');
});

test('si el plazo exacto se conoce y es posterior, se extiende hasta ese día', () => {
    const [e] = bloqueos([{ key: 'k', retenerHasta: '2032-07-01T00:00:00Z' }], () => new Date('2034-03-10T00:00:00Z'));
    assert.equal(e.hasta.slice(0, 10), '2034-03-10');
});

test('nunca se acorta un bloqueo, ni se extiende lo que se va a suprimir', () => {
    assert.deepEqual(bloqueos([{ key: 'k', retenerHasta: '2032-07-01T00:00:00Z' }], () => new Date('2032-06-15T00:00:00Z')), []);
    assert.deepEqual(bloqueos([{ key: 'k', retenerHasta: '2032-07-01T00:00:00Z' }], () => null), []);
});

test('un objeto sin bloqueo que debe conservarse queda bloqueado desde hoy', () => {
    const [e] = bloqueos([{ key: 'k', retenerHasta: null }], () => INDEFINIDO);
    assert.equal(e.desde, null);
    assert.equal(e.hasta.slice(0, 10), '2033-06-01');
});

test('un plazo que ya venció no se bloquea, aunque el bloqueo actual también haya vencido', () => {
    assert.deepEqual(bloqueos([{ key: 'k', retenerHasta: '2030-01-01T00:00:00Z' }], () => new Date('2031-01-15T00:00:00Z')), []);
});

test('cada archivo conservado lleva el plazo más lejano de los registros que lo mencionan', () => {
    const p = plan([desvinculada('a', EN_PLAZO), desvinculada('b', '2029-01-01T00:00:00Z')], {
        SIGNATURES_TABLE: [{ signatureId: 's1', personaId: 'a', documentosFirmados: [{ url: 'k/x.pdf' }] },
            { signatureId: 's2', personaId: 'b', documentosFirmados: [{ url: 'k/x.pdf' }] }],
    });
    assert.equal(p.archivos.conservarHasta['k/x.pdf'], '2034-01-01', 'el de b, el más tardío');
});

test('suprimir una firma o anonimizar un incidente incluye borrar su traza (RUT, IP, género)', () => {
    const p = plan([desvinculada('a', VENCIDA)], {
        SIGNATURES_TABLE: [{ signatureId: 's1', personaId: 'a' }],
        INCIDENTS_TABLE: [{ incidentId: 'i1', afectadoRutHmac: 'v1:a' }],
    });
    assert.deepEqual(accionesDe(p, 'SIGNATURES_TABLE')[0].traza, { signatureId: 's1#traza' });
    assert.deepEqual(accionesDe(p, 'INCIDENTS_TABLE')[0].traza, { incidentId: 'i1#traza' });
    assert.equal(accionesDe(p, 'PERSONAS_TABLE')[0].traza, undefined);
});
