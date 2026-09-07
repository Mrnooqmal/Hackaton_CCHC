const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { docClient } = require('../lib/clients/dynamodb');

// Reemplazar el archivo de un documento no debe destruir el anterior: la versión
// saliente se archiva en `versiones[]` y sube el contador `version`. Se mockea
// docClient.send para ejercitar el handler sin tocar DynamoDB.
const handler = require('../handlers/documents/handler');

let store;
let originalSend;

const ev = (id, body) => ({ pathParameters: { id }, body: JSON.stringify(body) });

/**
 * Reconstruye los valores escritos por el UpdateCommand capturado, resolviendo
 * cada par `nombre = :valor` de la UpdateExpression (los placeholders de nombre
 * y de valor no siempre coinciden).
 *
 * El lado izquierdo puede venir como placeholder (`#nombre`, que hay que resolver
 * contra ExpressionAttributeNames) o como nombre literal: `update` usa siempre lo
 * primero y `nuevaVersion` mezcla ambas formas.
 */
const escrito = (input) => {
    const out = {};
    const asignaciones = input.UpdateExpression.replace(/^SET\s+/, '').split(', ');
    for (const par of asignaciones) {
        const [ph, vh] = par.split(' = ');
        const campo = ph.startsWith('#') ? input.ExpressionAttributeNames[ph] : ph;
        out[campo] = input.ExpressionAttributeValues[vh];
    }
    return out;
};

beforeEach(() => {
    store = { doc: null, updates: [], deletes: [] };
    originalSend = docClient.send;
    docClient.send = async (cmd) => {
        const name = cmd.constructor.name;
        const input = cmd.input || {};
        if (name === 'GetCommand') return { Item: store.doc };
        if (name === 'UpdateCommand') { store.updates.push(input); return { Attributes: store.doc }; }
        if (name === 'DeleteCommand') { store.deletes.push(input); return {}; }
        return {};
    };
});

afterEach(() => { docClient.send = originalSend; });

test('reemplazar el archivo archiva la versión anterior y sube el contador', async () => {
    store.doc = {
        documentId: 'd1',
        s3Key: 'obras/politica-v1.pdf',
        archivoNombre: 'politica-v1.pdf',
        version: 1,
        createdBy: 'p-1',
        creatorName: 'Ana Prevención',
        updatedAt: '2026-03-01T10:00:00.000Z',
        createdAt: '2026-02-01T10:00:00.000Z',
    };

    const res = await handler.update(ev('d1', { s3Key: 'obras/politica-v2.pdf', archivoNombre: 'politica-v2.pdf' }));
    assert.equal(res.statusCode, 200);

    const w = escrito(store.updates[0]);
    assert.equal(w.version, 2, 'el contador de versión sube');
    assert.equal(w.versiones.length, 1, 'se archiva exactamente una versión');

    const [v1] = w.versiones;
    assert.equal(v1.version, 1);
    assert.equal(v1.s3Key, 'obras/politica-v1.pdf', 'conserva el archivo anterior');
    assert.equal(v1.archivoNombre, 'politica-v1.pdf');
    assert.equal(v1.publicadaEn, '2026-03-01T10:00:00.000Z', 'conserva la fecha de subida');
    assert.equal(v1.publicadaPorNombre, 'Ana Prevención');
});

test('el historial se acumula: la segunda actualización deja dos versiones', async () => {
    store.doc = {
        documentId: 'd1',
        s3Key: 'obras/v2.pdf',
        version: 2,
        versiones: [{ version: 1, s3Key: 'obras/v1.pdf', publicadaEn: '2026-02-01T00:00:00.000Z' }],
        updatedAt: '2026-03-01T00:00:00.000Z',
    };

    await handler.update(ev('d1', { s3Key: 'obras/v3.pdf' }));

    const w = escrito(store.updates[0]);
    assert.equal(w.version, 3);
    assert.deepEqual(w.versiones.map((v) => v.version), [1, 2], 'conserva el historial previo y suma el actual');
    assert.equal(w.versiones[1].s3Key, 'obras/v2.pdf');
});

test('actualizar metadatos sin cambiar el archivo no crea versiones', async () => {
    store.doc = { documentId: 'd1', s3Key: 'obras/v1.pdf', version: 1 };

    await handler.update(ev('d1', { fechaCaducidad: '2027-01-01' }));

    const w = escrito(store.updates[0]);
    assert.equal(w.versiones, undefined, 'no se archiva nada');
    assert.equal(w.version, undefined, 'el contador no se mueve');
    assert.equal(w.fechaCaducidad, '2027-01-01');
});

test('reenviar el mismo s3Key no crea una versión duplicada', async () => {
    store.doc = { documentId: 'd1', s3Key: 'obras/v1.pdf', version: 1 };

    await handler.update(ev('d1', { s3Key: 'obras/v1.pdf', fechaCaducidad: '2027-01-01' }));

    const w = escrito(store.updates[0]);
    assert.equal(w.versiones, undefined);
    assert.equal(w.version, undefined);
});

test('la primera subida (documento sin archivo) no genera versión previa', async () => {
    store.doc = { documentId: 'd1', s3Key: null, version: 1 };

    await handler.update(ev('d1', { s3Key: 'obras/v1.pdf' }));

    const w = escrito(store.updates[0]);
    assert.equal(w.versiones, undefined, 'no hay nada anterior que archivar');
});

test('reemplazar el archivo invalida el PDF firmado cacheado', async () => {
    store.doc = { documentId: 'd1', s3Key: 'obras/v1.pdf', version: 1, documentoFirmadoS3Key: 'stamped/v1.pdf', documentoFirmadoFirmaCount: 3 };

    await handler.update(ev('d1', { s3Key: 'obras/v2.pdf' }));

    const w = escrito(store.updates[0]);
    assert.equal(w.documentoFirmadoS3Key, null, 'el estampado correspondía al archivo viejo');
    assert.equal(w.documentoFirmadoFirmaCount, 0);
});

// ── MIPER versionada (FUF ítem 6, Art. 7 inc. 9). La MIPER es un documento de la
//    fase PLAN, pero al revisarla hay que re-informarla y re-firmarla igual que un
//    procedimiento, así que entra en TIPOS_PROCEDIMIENTO y acepta /nueva-version.

const evVersion = (id, body) => ({ pathParameters: { id }, body: JSON.stringify(body) });

test('la MIPER acepta publicar una nueva versión', async () => {
    store.doc = {
        documentId: 'd-miper', tenantId: 't1', tipo: 'MIPER', titulo: 'MIPER Obra Central',
        s3Key: 'obras/miper-v1.pdf', version: 1,
        asignaciones: [
            { personaId: 'p-1', estado: 'firmado', fechaFirma: '2026-04-01T12:00:00.000Z' },
            { personaId: 'p-2', estado: 'firmado', fechaFirma: '2026-04-02T12:00:00.000Z' },
        ],
        firmas: [{ personaId: 'p-1', token: 'tok-1' }],
    };

    const res = await handler.nuevaVersion(evVersion('d-miper', {
        s3Key: 'obras/miper-v2.pdf',
        motivo: 'Se incorporó el riesgo de sílice tras el cambio de faena',
    }));

    assert.equal(res.statusCode, 200);
    const w = escrito(store.updates[0]);
    assert.equal(w.version, 2);
    assert.equal(w.s3Key, 'obras/miper-v2.pdf');
    assert.equal(w.versiones.length, 1, 'la v1 queda archivada');
    assert.equal(w.versiones[0].s3Key, 'obras/miper-v1.pdf');
});

test('publicar una versión de la MIPER obliga a re-firmar', async () => {
    store.doc = {
        documentId: 'd-miper', tenantId: 't1', tipo: 'MIPER', titulo: 'MIPER Obra Central',
        s3Key: 'obras/miper-v1.pdf', version: 1,
        asignaciones: [
            { personaId: 'p-1', estado: 'firmado', fechaFirma: '2026-04-01T12:00:00.000Z' },
            { personaId: 'p-2', estado: 'firmado', fechaFirma: '2026-04-02T12:00:00.000Z' },
        ],
        firmas: [{ personaId: 'p-1', token: 'tok-1' }],
        documentoFirmadoS3Key: 'stamped/miper-v1.pdf',
    };

    await handler.nuevaVersion(evVersion('d-miper', { s3Key: 'obras/miper-v2.pdf', motivo: 'Revisión anual' }));

    const w = escrito(store.updates[0]);
    assert.deepEqual(w.asignaciones.map((a) => a.estado), ['pendiente', 'pendiente']);
    assert.deepEqual(w.asignaciones.map((a) => a.fechaFirma), [null, null]);
    assert.deepEqual(w.firmas, [], 'las firmas de la v1 no valen sobre el archivo nuevo');
    assert.equal(w.documentoFirmadoS3Key, null, 'el estampado correspondía a la v1');
    assert.deepEqual(
        w.versiones[0].firmasArchivadas,
        [{ personaId: 'p-1', token: 'tok-1' }],
        'las firmas de la v1 quedan en el snapshot para auditoría',
    );
});

test('MATRIZ_MIPPER (alias histórico) también se versiona', async () => {
    store.doc = { documentId: 'd-old', tenantId: 't1', tipo: 'MATRIZ_MIPPER', s3Key: 'obras/matriz-v1.pdf', version: 1 };

    const res = await handler.nuevaVersion(evVersion('d-old', { s3Key: 'obras/matriz-v2.pdf', motivo: 'Actualización' }));

    assert.equal(res.statusCode, 200);
});

test('un documento no versionable sigue rechazando /nueva-version', async () => {
    store.doc = { documentId: 'd-mapa', tenantId: 't1', tipo: 'MAPA_RIESGOS', s3Key: 'obras/mapa-v1.pdf', version: 1 };

    const res = await handler.nuevaVersion(evVersion('d-mapa', { s3Key: 'obras/mapa-v2.pdf', motivo: 'Cambio' }));

    assert.equal(res.statusCode, 400);
    assert.equal(store.updates.length, 0);
});

test('publicar una versión exige motivo', async () => {
    store.doc = { documentId: 'd-miper', tenantId: 't1', tipo: 'MIPER', s3Key: 'obras/miper-v1.pdf', version: 1 };

    const res = await handler.nuevaVersion(evVersion('d-miper', { s3Key: 'obras/miper-v2.pdf' }));

    assert.equal(res.statusCode, 400);
    assert.match(JSON.parse(res.body).error, /motivo/i);
});

// ── Eliminar un documento (requisitos con varios documentos, ej. planes de
//    emergencia). Una firma es un registro con validez legal: no se borra.
test('elimina un documento sin firmas', async () => {
    store.doc = { documentId: 'd1', tenantId: 't1', titulo: 'Plan de evacuación torre A', firmas: [] };

    const res = await handler.remove({ pathParameters: { id: 'd1' }, queryStringParameters: null });

    assert.equal(res.statusCode, 200);
    assert.equal(store.deletes.length, 1, 'se envió el DeleteCommand');
    assert.deepEqual(store.deletes[0].Key, { documentId: 'd1' });
});

test('no elimina un documento ya firmado', async () => {
    store.doc = { documentId: 'd1', tenantId: 't1', firmas: [{ personaId: 'p1', token: 'abc' }] };

    const res = await handler.remove({ pathParameters: { id: 'd1' }, queryStringParameters: null });

    assert.equal(res.statusCode, 409);
    assert.equal(store.deletes.length, 0, 'no se borra nada');
    assert.match(JSON.parse(res.body).error, /firmas/i);
});

test('devuelve 404 si el documento no existe', async () => {
    store.doc = null;

    const res = await handler.remove({ pathParameters: { id: 'inexistente' }, queryStringParameters: null });

    assert.equal(res.statusCode, 404);
    assert.equal(store.deletes.length, 0);
});
