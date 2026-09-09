const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { docClient } = require('../lib/clients/dynamodb');
const { InboxRepository } = require('../handlers/inbox-module/inbox.repository');
const { PersonaService } = require('../lib/services/PersonaService');
const { TenantService } = require('../lib/services/TenantService');
const EP = require('../lib/estructura-preventiva');

const { revisarEstructuraPreventiva, diasEntre } = require('../handlers/scheduler/estructura-alertas');

let tabla, avisos, originalSend, originalSend2, originalList, originalTenant;
const TENANT = 't-1';

beforeEach(() => {
    tabla = new Map();
    avisos = [];

    originalSend = docClient.send;
    docClient.send = async (cmd) => {
        const name = cmd.constructor.name;
        const i = cmd.input || {};
        if (name === 'ScanCommand') return { Items: [...tabla.values()] };
        if (name === 'UpdateCommand') {
            const item = tabla.get(i.Key.sk) || { sk: i.Key.sk, tenantId: i.Key.tenantId };
            if (/alertas = if_not_exists/.test(i.UpdateExpression)) item.alertas = item.alertas || {};
            else if (/alertas\.#c/.test(i.UpdateExpression)) {
                const clave = i.ExpressionAttributeNames['#c'];
                item.alertas = { ...(item.alertas || {}), [clave]: true };
            }
            tabla.set(i.Key.sk, item);
            return { Attributes: item };
        }
        return { Items: [] };
    };

    originalSend2 = InboxRepository.prototype.sendMessage;
    InboxRepository.prototype.sendMessage = async (body) => { avisos.push(body); return { ok: true }; };

    originalList = PersonaService.prototype.listByTenant;
    PersonaService.prototype.listByTenant = async () => ([
        { personaId: 'admin-1', estado: 'activo', rol: 'admin' },
        { personaId: 'obrero-1', estado: 'activo', rol: 'trabajador' },
    ]);

    originalTenant = TenantService.prototype.getById;
    TenantService.prototype.getById = async () => ({ toSafeFormat: () => ({ tenantId: TENANT, roles: [] }) });
});

afterEach(() => {
    docClient.send = originalSend;
    InboxRepository.prototype.sendMessage = originalSend2;
    PersonaService.prototype.listByTenant = originalList;
    TenantService.prototype.getById = originalTenant;
});

const organo = (over = {}) => {
    const o = {
        tenantId: TENANT, sk: 'ORG#org-1', organoId: 'org-1', obraId: 'o-1',
        tipo: EP.TIPO_ORGANO.COMITE_PARITARIO,
        fechaEleccionODesignacion: '2026-06-01T00:00:00.000Z',
        fechaTerminoMandato: '2028-06-01T00:00:00.000Z',
        estado: EP.ESTADO_ORGANO.VIGENTE, documentos: { comprobanteDT: 'doc-dt' }, ...over,
    };
    tabla.set(o.sk, o);
    return o;
};

const miembro = (over = {}) => {
    const m = {
        tenantId: TENANT, sk: `MIE#org-1#${over.miembroId || 'm1'}`, miembroId: over.miembroId || 'm1',
        organoId: 'org-1', estamento: EP.ESTAMENTO.TRABAJADORES,
        acreditacion: { realizada: false }, ...over,
    };
    tabla.set(m.sk, m);
    return m;
};

const reunion = (over = {}) => {
    const r = {
        tenantId: TENANT, sk: `REU#org-1#${over.reunionId || 'r1'}`, reunionId: over.reunionId || 'r1',
        organoId: 'org-1', tipo: EP.TIPO_REUNION.ORDINARIA,
        periodoMes: '2026-09', fechaProgramada: '2026-09-15T12:00:00.000Z',
        estado: EP.ESTADO_REUNION.PROGRAMADA, ...over,
    };
    tabla.set(r.sk, r);
    return r;
};

const asuntos = () => avisos.map((a) => a.subject);

// ─── Término de mandato ──────────────────────────────────────────────────────

test('avisa 60 días antes del término del mandato', async () => {
    organo({ fechaTerminoMandato: '2026-11-01T00:00:00.000Z' });
    await revisarEstructuraPreventiva(new Date('2026-09-09T12:00:00.000Z')); // faltan ~53
    assert.ok(asuntos().some((s) => /vence en \d+ días/.test(s)), asuntos().join(' | '));
});

test('avisa cuando el mandato ya venció', async () => {
    organo({ fechaTerminoMandato: '2026-09-01T00:00:00.000Z' });
    await revisarEstructuraPreventiva(new Date('2026-09-09T12:00:00.000Z'));
    assert.ok(asuntos().some((s) => /Mandato vencido/.test(s)), asuntos().join(' | '));
});

test('no avisa si al mandato le queda más de 60 días', async () => {
    organo({ fechaTerminoMandato: '2027-06-01T00:00:00.000Z' });
    await revisarEstructuraPreventiva(new Date('2026-09-09T12:00:00.000Z'));
    assert.equal(avisos.length, 0);
});

// ─── Idempotencia: lo que se rompe en silencio ───────────────────────────────

test('el mismo aviso no se repite en pasadas sucesivas', async () => {
    organo({ fechaTerminoMandato: '2026-11-01T00:00:00.000Z' });
    const ahora = new Date('2026-09-09T12:00:00.000Z');
    await revisarEstructuraPreventiva(ahora);
    const primera = avisos.length;
    assert.ok(primera > 0);

    // El scheduler corre de nuevo: no debe volver a avisar lo mismo.
    await revisarEstructuraPreventiva(ahora);
    assert.equal(avisos.length, primera, 'un recordatorio repetido hace que dejen de leerse todos');
});

// ─── Registro en la Dirección del Trabajo ────────────────────────────────────

test('avisa si falta el comprobante de registro en la DT pasados 10 días hábiles', async () => {
    organo({ documentos: {}, fechaEleccionODesignacion: '2026-08-03T00:00:00.000Z' });
    await revisarEstructuraPreventiva(new Date('2026-09-09T12:00:00.000Z'));
    assert.ok(asuntos().some((s) => /Dirección del Trabajo/.test(s)), asuntos().join(' | '));
});

test('no avisa del registro DT si el comprobante ya está cargado', async () => {
    organo({ documentos: { comprobanteDT: 'doc-1' }, fechaEleccionODesignacion: '2026-08-03T00:00:00.000Z' });
    await revisarEstructuraPreventiva(new Date('2026-09-09T12:00:00.000Z'));
    assert.ok(!asuntos().some((s) => /Dirección del Trabajo/.test(s)));
});

test('el aviso del registro DT declara que la fecha es referencial', async () => {
    organo({ documentos: {}, fechaEleccionODesignacion: '2026-08-03T00:00:00.000Z' });
    await revisarEstructuraPreventiva(new Date('2026-09-09T12:00:00.000Z'));
    const aviso = avisos.find((a) => /Dirección del Trabajo/.test(a.subject));
    assert.match(aviso.content, /referencial/, 'el plazo no considera feriados y debe decirlo');
});

// ─── Curso OPR ───────────────────────────────────────────────────────────────

test('avisa del curso OPR pendiente dentro del primer semestre', async () => {
    organo({ fechaEleccionODesignacion: '2026-05-01T00:00:00.000Z' });
    miembro();
    // Límite: 2026-11-01. A 2026-09-25 faltan ~37 días → hito de mes 4.
    await revisarEstructuraPreventiva(new Date('2026-09-25T12:00:00.000Z'));
    assert.ok(asuntos().some((s) => /curso de orientación/i.test(s)), asuntos().join(' | '));
});

test('avisa distinto cuando el plazo del curso OPR ya venció', async () => {
    organo({ fechaEleccionODesignacion: '2026-01-01T00:00:00.000Z', fechaTerminoMandato: '2028-01-01T00:00:00.000Z' });
    miembro();
    await revisarEstructuraPreventiva(new Date('2026-09-09T12:00:00.000Z'));
    assert.ok(asuntos().some((s) => /Venció el plazo del curso/.test(s)), asuntos().join(' | '));
});

test('no avisa del curso OPR si todos los electos están acreditados', async () => {
    organo({ fechaEleccionODesignacion: '2026-05-01T00:00:00.000Z' });
    miembro({ acreditacion: { realizada: true } });
    await revisarEstructuraPreventiva(new Date('2026-09-25T12:00:00.000Z'));
    assert.ok(!asuntos().some((s) => /curso de orientación/i.test(s)));
});

// ─── Reunión ordinaria sin acta ──────────────────────────────────────────────

test('avisa el día 20 si la ordinaria del mes no tiene acta', async () => {
    organo();
    reunion();
    await revisarEstructuraPreventiva(new Date('2026-09-20T12:00:00.000Z'));
    assert.ok(asuntos().some((s) => /sin acta/.test(s)), asuntos().join(' | '));
});

test('no avisa un día cualquiera del mes', async () => {
    organo();
    reunion();
    await revisarEstructuraPreventiva(new Date('2026-09-11T12:00:00.000Z'));
    assert.ok(!asuntos().some((s) => /sin acta/.test(s)));
});

test('no avisa si la reunión del mes ya se realizó', async () => {
    organo();
    reunion({ estado: EP.ESTADO_REUNION.REALIZADA, actaDocumentoId: 'd1' });
    await revisarEstructuraPreventiva(new Date('2026-09-20T12:00:00.000Z'));
    assert.ok(!asuntos().some((s) => /sin acta/.test(s)));
});

test('el aviso del día 20 y el del cierre son distintos y ambos llegan', async () => {
    organo();
    reunion();
    await revisarEstructuraPreventiva(new Date('2026-09-20T12:00:00.000Z'));
    const tras20 = avisos.filter((a) => /sin acta/.test(a.subject)).length;
    await revisarEstructuraPreventiva(new Date('2026-09-30T12:00:00.000Z')); // último día
    const trasCierre = avisos.filter((a) => /sin acta/.test(a.subject)).length;
    assert.equal(tras20, 1);
    assert.equal(trasCierre, 2, 'el recordatorio de cierre es otro hito, no una repetición');
});

// ─── Órganos disueltos ───────────────────────────────────────────────────────

test('un órgano disuelto no genera avisos', async () => {
    organo({ estado: EP.ESTADO_ORGANO.DISUELTO, fechaTerminoMandato: '2026-09-01T00:00:00.000Z', documentos: {} });
    await revisarEstructuraPreventiva(new Date('2026-09-09T12:00:00.000Z'));
    assert.equal(avisos.length, 0, 'alertar sobre un comité que ya no existe es ruido');
});

// ─── Destinatarios ───────────────────────────────────────────────────────────

test('los avisos van al perfil administrador, no a toda la dotación', async () => {
    organo({ fechaTerminoMandato: '2026-09-01T00:00:00.000Z' });
    await revisarEstructuraPreventiva(new Date('2026-09-09T12:00:00.000Z'));
    assert.ok(avisos.length > 0);
    assert.deepEqual(avisos[0].recipientIds, ['admin-1']);
    assert.equal(avisos[0].senderRol, 'system', 'senderRol system evita el SMS');
});

test('diasEntre cuenta en días completos y admite negativos', () => {
    assert.equal(diasEntre('2026-09-19T12:00:00Z', '2026-09-09T12:00:00Z'), 10);
    assert.equal(diasEntre('2026-09-01T12:00:00Z', '2026-09-09T12:00:00Z'), -8);
});

test('un mandato vencido hace meses sigue avisando (no solo el día exacto)', async () => {
    // Regresión: el hito de 0 días tenía borde inferior, así que el aviso solo
    // salía el día del vencimiento. Si el scheduler no corría ese día, se perdía.
    organo({ fechaTerminoMandato: '2026-03-01T00:00:00.000Z' });
    await revisarEstructuraPreventiva(new Date('2026-09-09T12:00:00.000Z')); // 6 meses después
    assert.ok(asuntos().some((s) => /Mandato vencido/.test(s)), asuntos().join(' | '));
});

test('las ventanas de 60 y 30 días no se solapan', async () => {
    organo({ fechaTerminoMandato: '2026-10-04T00:00:00.000Z' }); // faltan ~25 → solo hito 30
    await revisarEstructuraPreventiva(new Date('2026-09-09T12:00:00.000Z'));
    const deMandato = avisos.filter((a) => /mandato/i.test(a.subject));
    assert.equal(deMandato.length, 1, 'un solo aviso por pasada, no uno por hito');
});
