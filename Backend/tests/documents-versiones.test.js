process.env.CAMPO_HMAC_KEY = 'clave-de-prueba-hmac';
process.env.CAMPO_CIFRADO_LOCAL_KEY = require('crypto').randomBytes(32).toString('base64');

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { docClient } = require('../lib/clients/dynamodb');

// Reemplazar el archivo de un documento no debe destruir el anterior: la versión
// saliente se archiva en `versiones[]` y sube el contador `version`. Se mockea
// docClient.send para ejercitar el handler sin tocar DynamoDB.
const handler = require('../handlers/documents/handler');

let store;
let originalSend;

// Contexto de sesión que pone el autorizador. Los handlers de documentos exigen
// sesión y que el documento sea de la MISMA empresa, así que las pruebas firman
// sus llamadas como una persona de 't1' con permiso para subir documentos.
const SESION = {
    requestContext: {
        authorizer: {
            lambda: {
                sessionId: 's-1', personaId: 'p-editor', tenantId: 't1', rol: 'prevencionista',
                permisos: 'repositorio.subir,obra.subir_documentos',
            },
        },
    },
};

const ev = (id, body) => ({ ...SESION, pathParameters: { id }, body: JSON.stringify(body) });

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
        tenantId: 't1',
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
        tenantId: 't1',
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
    store.doc = { documentId: 'd1', tenantId: 't1', s3Key: 'obras/v1.pdf', version: 1 };

    await handler.update(ev('d1', { fechaCaducidad: '2027-01-01' }));

    const w = escrito(store.updates[0]);
    assert.equal(w.versiones, undefined, 'no se archiva nada');
    assert.equal(w.version, undefined, 'el contador no se mueve');
    assert.equal(w.fechaCaducidad, '2027-01-01');
});

test('reenviar el mismo s3Key no crea una versión duplicada', async () => {
    store.doc = { documentId: 'd1', tenantId: 't1', s3Key: 'obras/v1.pdf', version: 1 };

    await handler.update(ev('d1', { s3Key: 'obras/v1.pdf', fechaCaducidad: '2027-01-01' }));

    const w = escrito(store.updates[0]);
    assert.equal(w.versiones, undefined);
    assert.equal(w.version, undefined);
});

test('la primera subida (documento sin archivo) no genera versión previa', async () => {
    store.doc = { documentId: 'd1', tenantId: 't1', s3Key: null, version: 1 };

    await handler.update(ev('d1', { s3Key: 'obras/v1.pdf' }));

    const w = escrito(store.updates[0]);
    assert.equal(w.versiones, undefined, 'no hay nada anterior que archivar');
});

test('reemplazar el archivo cambia la clave del PDF estampado', async () => {
    // Antes el estampado vivía en una clave fija y había que acordarse de
    // anularlo acá, en `nuevaVersion` y en `nuevaVersionCorporativa`: bastaba con
    // que un cuarto camino lo olvidara para entregar como documento firmado un
    // PDF de otra versión. Ahora la clave se deriva del archivo y de las firmas,
    // así que la invalidación no depende de que nadie se olvide.
    const { claveEstampado } = require('../lib/almacenamiento');
    const firmas = [{ token: 'tok-1' }, { token: 'tok-2' }];

    const antes = claveEstampado({ tenantId: 't1', documentId: 'd1', s3KeyOriginal: 'obras/v1.pdf', firmas });
    const despues = claveEstampado({ tenantId: 't1', documentId: 'd1', s3KeyOriginal: 'obras/v2.pdf', firmas });

    assert.notEqual(antes, despues, 'otro archivo, otra clave');

    // Y el update ya no escribe ningún campo de caché.
    store.doc = { documentId: 'd1', tenantId: 't1', s3Key: 'obras/v1.pdf', version: 1 };
    await handler.update(ev('d1', { s3Key: 'obras/v2.pdf' }));
    const w = escrito(store.updates[0]);
    assert.equal('documentoFirmadoS3Key' in w, false);
    assert.equal('documentoFirmadoFirmaCount' in w, false);
});

test('una firma nueva cambia la clave del PDF estampado', async () => {
    const { claveEstampado } = require('../lib/almacenamiento');
    const base = { tenantId: 't1', documentId: 'd1', s3KeyOriginal: 'obras/v1.pdf' };

    const conDos = claveEstampado({ ...base, firmas: [{ token: 'a' }, { token: 'b' }] });
    const conTres = claveEstampado({ ...base, firmas: [{ token: 'a' }, { token: 'b' }, { token: 'c' }] });
    // Mismo conteo, firmas distintas: por eso la huella usa los tokens y no la
    // cantidad.
    const otrasDos = claveEstampado({ ...base, firmas: [{ token: 'a' }, { token: 'z' }] });

    assert.notEqual(conDos, conTres);
    assert.notEqual(conDos, otrasDos);
    assert.equal(conDos, claveEstampado({ ...base, firmas: [{ token: 'a' }, { token: 'b' }] }),
        'sin cambios, la misma clave: diez descargas simultáneas reutilizan el archivo');
});

// ── MIPER versionada (FUF ítem 6, Art. 7 inc. 9). La MIPER es un documento de la
//    fase PLAN, pero al revisarla hay que re-informarla y re-firmarla igual que un
//    procedimiento, así que entra en TIPOS_PROCEDIMIENTO y acepta /nueva-version.

const evVersion = (id, body) => ({ ...SESION, pathParameters: { id }, body: JSON.stringify(body) });

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
    };

    await handler.nuevaVersion(evVersion('d-miper', { s3Key: 'obras/miper-v2.pdf', motivo: 'Revisión anual' }));

    const w = escrito(store.updates[0]);
    assert.deepEqual(w.asignaciones.map((a) => a.estado), ['pendiente', 'pendiente']);
    assert.deepEqual(w.asignaciones.map((a) => a.fechaFirma), [null, null]);
    assert.deepEqual(w.firmas, [], 'las firmas de la v1 no valen sobre el archivo nuevo');
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

    const res = await handler.remove({ ...SESION, pathParameters: { id: 'd1' }, queryStringParameters: null });

    assert.equal(res.statusCode, 200);
    assert.equal(store.deletes.length, 1, 'se envió el DeleteCommand');
    assert.deepEqual(store.deletes[0].Key, { documentId: 'd1' });
});

test('no elimina un documento ya firmado', async () => {
    store.doc = { documentId: 'd1', tenantId: 't1', firmas: [{ personaId: 'p1', token: 'abc' }] };

    const res = await handler.remove({ ...SESION, pathParameters: { id: 'd1' }, queryStringParameters: null });

    assert.equal(res.statusCode, 409);
    assert.equal(store.deletes.length, 0, 'no se borra nada');
    assert.match(JSON.parse(res.body).error, /firmas/i);
});

test('devuelve 404 si el documento no existe', async () => {
    store.doc = null;

    const res = await handler.remove({ ...SESION, pathParameters: { id: 'inexistente' }, queryStringParameters: null });

    assert.equal(res.statusCode, 404);
    assert.equal(store.deletes.length, 0);
});

// ─── Firmantes de la versión nueva ───────────────────────────────────────────
//
// Al publicar una versión se puede cambiar quién la firma. Sin `firmantes` se
// conservan las mismas personas; con la lista, esa lista manda.

const { PersonaService } = require('../lib/services/PersonaService');
const { eventBus } = require('../lib/events/EventBus');

const conFirmantes = async (doc, body, personas = {}) => {
    store.doc = doc;
    const getById = PersonaService.prototype.getById;
    const emit = eventBus.emit;
    const avisos = [];
    PersonaService.prototype.getById = async (id) => personas[id] || null;
    eventBus.emit = async (evento, data) => { avisos.push({ evento, data }); };
    try {
        const res = await handler.nuevaVersion(ev(doc.documentId, { s3Key: 'obras/miper-v2.pdf', motivo: 'Revisión anual', versionEsperada: 1, ...body }));
        return { res, avisos, w: store.updates.length ? escrito(store.updates[0]) : null };
    } finally {
        PersonaService.prototype.getById = getById;
        eventBus.emit = emit;
    }
};
const miper = (asignaciones) => ({
    documentId: 'm1', tenantId: 't1', tipo: 'MIPER', titulo: 'MIPER', s3Key: 'obras/miper-v1.pdf', version: 1, asignaciones,
});
const asig = (personaId, estado = 'firmado') => ({ personaId, nombre: personaId, estado, fechaFirma: estado === 'firmado' ? '2026-08-01' : null });

test('sin firmantes, la versión nueva la re-firman las mismas personas', async () => {
    const { res, w } = await conFirmantes(miper([asig('ana'), asig('luis')]), {});
    assert.equal(res.statusCode, 200);
    assert.deepEqual(w.asignaciones.map((a) => [a.personaId, a.estado]), [['ana', 'pendiente'], ['luis', 'pendiente']]);
});

test('con firmantes, se quita a quien sale y se agrega a quien entra', async () => {
    const { res, w, avisos } = await conFirmantes(
        miper([asig('ana'), asig('luis')]),
        { firmantes: ['ana', 'eva'] },
        { eva: { personaId: 'eva', tenantId: 't1', nombre: 'Eva', apellido: 'Díaz', rut: null } },
    );
    assert.equal(res.statusCode, 200);
    assert.deepEqual(w.asignaciones.map((a) => [a.personaId, a.estado]), [['ana', 'pendiente'], ['eva', 'pendiente']]);
    // Lo que Luis firmó de la v1 queda en el historial.
    assert.deepEqual(w.versiones[0].asignacionesArchivadas.map((a) => a.personaId), ['ana', 'luis']);
    const reFirma = avisos.find((a) => a.evento === 'document.version.updated');
    assert.deepEqual(reFirma.data.firmanteIds, ['ana'], 'la re-firma es solo para quien firmaba la anterior');
    const asignado = avisos.find((a) => a.evento === 'document.assigned');
    assert.deepEqual(asignado.data.userIds, ['eva'], 'la persona agregada recibe el aviso de asignación');
});

test('un firmante de otra empresa se rechaza y no se publica nada', async () => {
    const { res } = await conFirmantes(miper([asig('ana')]), { firmantes: ['ajeno'] },
        { ajeno: { personaId: 'ajeno', tenantId: 'otra', nombre: 'X' } });
    assert.equal(res.statusCode, 400);
    assert.equal(store.updates.length, 0);
});
