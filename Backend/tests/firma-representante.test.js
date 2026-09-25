// Firma del representante legal: la asignación se sincroniza sola.
//
// El caso real: el Programa de Trabajo Preventivo se subió cuando la empresa no
// tenía representante designado. Al designarlo después no pasaba nada: no se le
// pedía la firma, no le llegaba aviso y no lo veía en ninguna pantalla, así que
// el ítem 9 quedaba "Incompleto" para siempre.

const test = require('node:test');
const assert = require('node:assert');
const { FirmaRepresentanteService, planificar, ROL_REPRESENTANTE, requiereFirmaRepresentante } =
    require('../lib/services/FirmaRepresentanteService');

const TENANT = 't-1';
const persona = (personaId, over = {}) => ({ personaId, tenantId: TENANT, nombre: personaId, apellido: '', rut: null, ...over });
const ptp = (over = {}) => ({
    documentId: 'ptp-1', tenantId: TENANT, tipo: 'PROGRAMA_TRABAJO_PREVENTIVO', titulo: 'Programa',
    archivoUrl: 'tenants/t-1/documentos/p.pdf', estado: 'activo', asignaciones: [], firmas: [], ...over,
});

/** Cliente DynamoDB falso: guarda los UpdateCommand y responde la query con `docs`. */
function entorno(docs, personas = {}) {
    const updates = [];
    const avisos = [];
    const cliente = {
        send: async (cmd) => {
            if (cmd.constructor.name === 'QueryCommand') return { Items: docs };
            updates.push(cmd.input);
            const doc = docs.find((d) => d.documentId === cmd.input.Key.documentId);
            if (doc) doc.asignaciones = cmd.input.ExpressionAttributeValues[':a'];
            return {};
        },
    };
    const servicio = new FirmaRepresentanteService({
        tabla: 'docs', cliente,
        personas: { getById: async (id) => personas[id] || null },
        eventos: { emit: async (evento, data) => { avisos.push({ evento, data }); } },
        // Sin KMS: la llave del sobre del RUT no es lo que se prueba acá.
        llave: async () => null,
    });
    return { servicio, updates, avisos };
}

test('solo el Programa de Trabajo Preventivo requiere la firma del representante', () => {
    assert.ok(requiereFirmaRepresentante('PROGRAMA_TRABAJO_PREVENTIVO'));
    assert.ok(!requiereFirmaRepresentante('POLITICA_SSO'));
    assert.ok(!requiereFirmaRepresentante('MIPER'));
});

test('designar al representante DESPUÉS de subir el programa le pide la firma y le avisa', async () => {
    const docs = [ptp()];
    const { servicio, avisos } = entorno(docs, { rep: persona('rep') });
    const r = await servicio.sincronizarTenant(TENANT, 'rep');

    assert.deepEqual(r, { documentos: 1, asignados: 1 });
    const a = docs[0].asignaciones.find((x) => x.personaId === 'rep');
    assert.equal(a.estado, 'pendiente');
    assert.equal(a.rol, ROL_REPRESENTANTE);
    assert.equal(avisos.length, 1);
    assert.deepEqual(avisos[0].data.userIds, ['rep']);
});

test('volver a designar al mismo no duplica la asignación ni el aviso', async () => {
    const docs = [ptp()];
    const { servicio, avisos } = entorno(docs, { rep: persona('rep') });
    await servicio.sincronizarTenant(TENANT, 'rep');
    await servicio.sincronizarTenant(TENANT, 'rep');
    assert.equal(docs[0].asignaciones.length, 1);
    assert.equal(avisos.length, 1);
});

test('cambiar de representante quita la pendiente del anterior y se la pide al nuevo', async () => {
    const docs = [ptp({ asignaciones: [{ personaId: 'viejo', estado: 'pendiente', rol: ROL_REPRESENTANTE }] })];
    const { servicio } = entorno(docs, { nuevo: persona('nuevo') });
    await servicio.sincronizarTenant(TENANT, 'nuevo');
    assert.deepEqual(docs[0].asignaciones.map((a) => a.personaId), ['nuevo']);
});

test('una asignación del anterior que NO fue como representante no se toca', () => {
    const doc = ptp({ asignaciones: [{ personaId: 'viejo', estado: 'pendiente' }] });
    const plan = planificar(doc, 'nuevo');
    assert.equal(plan.quitadas, 0);
});

test('lo ya firmado es evidencia: no se quita aunque cambie el representante', () => {
    const doc = ptp({ asignaciones: [{ personaId: 'viejo', estado: 'firmado', rol: ROL_REPRESENTANTE, fechaFirma: '2026-09-01' }] });
    const plan = planificar(doc, 'nuevo');
    assert.equal(plan.quitadas, 0);
    assert.equal(plan.falta, true);
});

test('si el representante ya firmó ese programa, no se le vuelve a pedir', () => {
    const doc = ptp({ firmas: [{ personaId: 'rep' }] });
    assert.equal(planificar(doc, 'rep').falta, false);
});

test('quitar la designación retira las pendientes de representante', async () => {
    const docs = [ptp({ asignaciones: [{ personaId: 'rep', estado: 'pendiente', rol: ROL_REPRESENTANTE }] })];
    const { servicio } = entorno(docs);
    await servicio.sincronizarTenant(TENANT, null);
    assert.deepEqual(docs[0].asignaciones, []);
});

test('un representante de otra empresa se rechaza', async () => {
    const { servicio } = entorno([ptp()], { ajeno: persona('ajeno', { tenantId: 'otra' }) });
    await assert.rejects(() => servicio.sincronizarTenant(TENANT, 'ajeno'), /persona de la empresa/);
});

test('al subir el programa con un representante ya designado, se le asigna en el acto', async () => {
    const docs = [ptp()];
    const { servicio, avisos } = entorno(docs, { rep: persona('rep') });
    const asignado = await servicio.alCrearDocumento(docs[0], { personaId: 'rep' });
    assert.equal(asignado, true);
    assert.equal(avisos.length, 1);
});

test('un programa sin archivo todavía no se asigna: no hay nada que firmar', async () => {
    const { servicio } = entorno([], { rep: persona('rep') });
    const asignado = await servicio.alCrearDocumento(ptp({ archivoUrl: null }), { personaId: 'rep' });
    assert.equal(asignado, false);
});
