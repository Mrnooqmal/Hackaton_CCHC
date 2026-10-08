// Informe de brecha: qué datos, de qué personas, de qué empresas, a partir del
// inventario y de la auditoría de accesos a salud.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { informeDeBrecha, fuentesLegibles } = require('../lib/gobernanza/brecha');

const A = 'empresa-a';
const B = 'empresa-b';
const persona = (id, emp, extra = {}) => ({ PK: `TENANT#${emp}`, SK: `PERSONA#${id}`, personaId: id, tenantId: emp, rutHmac: `v1:${id}`, ...extra });

test('una tabla expuesta: qué categoría, cuántas personas y de qué empresas', () => {
    const inf = informeDeBrecha({
        alcance: { tablas: ['PERSONAS_TABLE'] },
        tablas: [{ tabla: 'PERSONAS_TABLE', items: [persona('p1', A), persona('p2', A), persona('p3', B)] }],
    });
    assert.deepEqual(inf.empresas, [A, B]);
    assert.deepEqual(inf.personasPorEmpresa, { [A]: ['p1', 'p2'], [B]: ['p3'] });
    assert.equal(inf.totales.personas, 3);
    const [c] = inf.categorias;
    assert.equal(c.nombre, 'Ficha de la persona');
    assert.equal(c.salud, true, 'la ficha puede traer vigilancia de salud');
    assert.equal(inf.datosDeSalud, true);
});

test('una tabla sin salud (bandeja) no marca salud expuesta', () => {
    const inf = informeDeBrecha({ alcance: {}, tablas: [{ tabla: 'INBOX_TABLE', items: [{ recipientId: 'p1', messageId: 'm', tenantId: A }] }] });
    assert.equal(inf.datosDeSalud, false);
});

test('un incidente se vincula a la persona afectada por el HMAC de su RUT', () => {
    const inf = informeDeBrecha({
        alcance: {},
        tablas: [{ tabla: 'INCIDENTS_TABLE', items: [{ incidentId: 'i1', tenantId: A, afectadoRutHmac: 'v1:p9' }] }],
        ctxPorEmpresa: { [A]: { personaPorRutHmac: { 'v1:p9': 'p9' } } },
    });
    assert.deepEqual(inf.personasPorEmpresa[A], ['p9']);
});

test('cuenta comprometida: la salud confirmada sale de la auditoría, y el resto es una cota superior declarada', () => {
    const inf = informeDeBrecha({
        alcance: { actores: ['atacada'] }, potencial: true,
        accesos: [
            { tenantId: A, en: '2026-09-10T10:00:00Z', actorId: 'atacada', tipos: ['ficha_salud'], titulares: ['p1', 'p2'], documentos: [] },
            { tenantId: A, en: '2026-09-11T10:00:00Z', actorId: 'atacada', tipos: ['descarga_documento_salud'], titulares: ['p2'], documentos: ['ex-1'] },
        ],
        tablas: [{ tabla: 'PERSONAS_TABLE', items: [persona('p1', A), persona('p2', A), persona('p5', A)] }],
    });
    assert.match(inf.naturaleza, /POTENCIAL/);
    assert.deepEqual(inf.saludConfirmada, {
        accesos: 2, tipos: ['descarga_documento_salud', 'ficha_salud'], documentos: ['ex-1'], titulares: 2,
        primero: '2026-09-10T10:00:00Z', ultimo: '2026-09-11T10:00:00Z',
    });
    assert.deepEqual(inf.personasPorEmpresa[A], ['p1', 'p2', 'p5'], 'lo confirmado más lo que podía leer');
});

test('archivos expuestos: de quién son según los registros que los mencionan (sin exponer esas tablas)', () => {
    const inf = informeDeBrecha({
        alcance: { prefijo: `tenants/${A}/documentos/` },
        archivos: [`tenants/${A}/documentos/examen.pdf`, `tenants/${A}/documentos/huerfano.pdf`],
        contexto: [{ tabla: 'DOCUMENTS_TABLE', items: [{ documentId: 'd1', tenantId: A, s3Key: `tenants/${A}/documentos/examen.pdf`, asignaciones: [{ personaId: 'p1' }] }] }],
    });
    assert.deepEqual(inf.categorias, [], 'la tabla de documentos no se filtró: es contexto');
    assert.deepEqual(inf.archivos.find((a) => a.key.endsWith('examen.pdf')).personas, ['p1']);
    assert.equal(inf.archivos.find((a) => a.key.endsWith('huerfano.pdf')).sinRegistro, true);
    assert.deepEqual(inf.personasPorEmpresa[A], ['p1']);
});

test('el informe no trae datos personales: solo identificadores y categorías', () => {
    const inf = informeDeBrecha({
        alcance: {},
        tablas: [{ tabla: 'PERSONAS_TABLE', items: [persona('p1', A, { nombre: 'Juan Pérez', email: 'juan@x.cl', telefono: '912345678' })] }],
    });
    const texto = JSON.stringify(inf);
    for (const dato of ['Juan Pérez', 'juan@x.cl', '912345678', 'v1:p1']) assert.ok(!texto.includes(dato), dato);
});

test('lo que una cuenta puede leer excluye lo operacional (sesiones, vales, licencias)', () => {
    const t = fuentesLegibles();
    assert.ok(t.includes('PERSONAS_TABLE') && t.includes('DOCUMENTS_TABLE'));
    assert.ok(!t.includes('SESSIONS_TABLE') && !t.includes('VALES_TABLE'));
});

test('solo con accesos auditados (sin tablas), la salud confirmada basta para marcar datos de salud', () => {
    const inf = informeDeBrecha({
        alcance: { actores: ['atacada'] },
        accesos: [{ tenantId: A, en: '2026-09-10T10:00:00Z', actorId: 'atacada', tipos: ['ficha_salud'], titulares: ['p1'], documentos: [] }],
    });
    assert.equal(inf.datosDeSalud, true);
    assert.deepEqual(inf.personasPorEmpresa, { [A]: ['p1'] });
    assert.deepEqual(inf.empresas, [A]);
});
