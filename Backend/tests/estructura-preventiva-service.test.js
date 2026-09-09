const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { docClient } = require('../lib/clients/dynamodb');
const { EstructuraPreventivaService, ErrorValidacion } = require('../lib/services/EstructuraPreventivaService');
const EP = require('../lib/estructura-preventiva');

// Tabla en memoria: mapa sk -> item. Reproduce el comportamiento de las claves y
// del begins_with sin tocar DynamoDB (mismo enfoque que activities-handler.test).
let tabla;
let originalSend;
const TENANT = 't-1';

beforeEach(() => {
    tabla = new Map();
    originalSend = docClient.send;
    docClient.send = async (cmd) => {
        const name = cmd.constructor.name;
        const i = cmd.input || {};
        if (name === 'PutCommand') { tabla.set(i.Item.sk, { ...i.Item }); return {}; }
        if (name === 'GetCommand') { return { Item: tabla.get(i.Key.sk) || undefined }; }
        if (name === 'DeleteCommand') { tabla.delete(i.Key.sk); return {}; }
        if (name === 'QueryCommand') {
            const prefijo = i.ExpressionAttributeValues[':p'];
            return { Items: [...tabla.values()].filter((it) => String(it.sk).startsWith(prefijo)) };
        }
        if (name === 'UpdateCommand') {
            const actual = tabla.get(i.Key.sk);
            if (!actual && String(i.ConditionExpression || '').includes('attribute_exists')) {
                const e = new Error('ConditionalCheckFailedException');
                e.name = 'ConditionalCheckFailedException';
                throw e;
            }
            const item = actual || { sk: i.Key.sk, tenantId: i.Key.tenantId };
            // Aplicación simplificada del SET: alcanza para verificar qué campos se tocan.
            for (const [ph, val] of Object.entries(i.ExpressionAttributeValues || {})) {
                const m = new RegExp(`([\\w.#]+) = ${ph.replace('$', '\\$')}(?![\\w])`).exec(i.UpdateExpression);
                if (!m) continue;
                let clave = m[1];
                if (clave.startsWith('#')) clave = (i.ExpressionAttributeNames || {})[clave] || clave;
                if (clave.includes('.')) {
                    const [raiz, hijoRaw] = clave.split('.');
                    const hijo = hijoRaw.startsWith('#') ? (i.ExpressionAttributeNames || {})[hijoRaw] : hijoRaw;
                    item[raiz] = { ...(item[raiz] || {}), [hijo]: val };
                } else {
                    item[clave] = val;
                }
            }
            tabla.set(i.Key.sk, item);
            return { Attributes: item };
        }
        return { Items: [] };
    };
});

afterEach(() => { docClient.send = originalSend; });

const svc = () => new EstructuraPreventivaService();
const AHORA = new Date('2026-09-08T12:00:00.000Z');

const comite = () => [
    { personaId: 'e1', nombre: 'Ana', estamento: EP.ESTAMENTO.EMPLEADOR, calidad: EP.CALIDAD.TITULAR, cargo: EP.CARGO_ORGANO.PRESIDENTE },
    { personaId: 'e2', nombre: 'Beto', estamento: EP.ESTAMENTO.EMPLEADOR, calidad: EP.CALIDAD.TITULAR, cargo: EP.CARGO_ORGANO.INTEGRANTE },
    { personaId: 'e3', nombre: 'Cata', estamento: EP.ESTAMENTO.EMPLEADOR, calidad: EP.CALIDAD.TITULAR, cargo: EP.CARGO_ORGANO.INTEGRANTE },
    { personaId: 't1', nombre: 'Dani', estamento: EP.ESTAMENTO.TRABAJADORES, calidad: EP.CALIDAD.TITULAR, cargo: EP.CARGO_ORGANO.SECRETARIO },
    { personaId: 't2', nombre: 'Eva', estamento: EP.ESTAMENTO.TRABAJADORES, calidad: EP.CALIDAD.TITULAR, cargo: EP.CARGO_ORGANO.INTEGRANTE },
    { personaId: 't3', nombre: 'Fito', estamento: EP.ESTAMENTO.TRABAJADORES, calidad: EP.CALIDAD.TITULAR, cargo: EP.CARGO_ORGANO.INTEGRANTE },
];

const constituirCphs = (over = {}) => svc().constituirOrgano({
    tenantId: TENANT, ambito: EP.AMBITO.OBRA, obraId: 'o-1',
    tipo: EP.TIPO_ORGANO.COMITE_PARITARIO,
    fechaEleccionODesignacion: '2026-01-10T00:00:00.000Z',
    fechaConstitucion: '2026-01-15T00:00:00.000Z',
    miembros: comite(), dotacion: 40, creadoPor: 'admin-1', ahora: AHORA,
    ...over,
});

test('constituir un CPHS crea órgano, integrantes y reuniones ordinarias', async () => {
    const r = await constituirCphs();
    assert.equal(r.tipo, EP.TIPO_ORGANO.COMITE_PARITARIO);
    assert.equal(r.miembros.length, 6);
    assert.ok(r.reuniones.length >= 24, `esperaba ~24 ordinarias, hubo ${r.reuniones.length}`);
    assert.ok(r.reuniones.every((x) => x.estado === EP.ESTADO_REUNION.PROGRAMADA));
    const meses = r.reuniones.map((x) => x.periodoMes);
    assert.equal(new Set(meses).size, meses.length, 'una sola ordinaria por mes (Art. 39)');
});

test('el mandato se calcula a 2 años si no se indica', async () => {
    const r = await constituirCphs();
    assert.equal(r.fechaTerminoMandato.slice(0, 10), '2028-01-10');
});

test('sobre el umbral el origen queda Obligatorio y guarda la dotación', async () => {
    const r = await constituirCphs({ dotacion: 40 });
    assert.equal(r.origen, EP.ORIGEN.OBLIGATORIO);
    assert.equal(r.dotacionAlConstituir, 40);
});

test('bajo el umbral se puede constituir igual y queda Voluntario', async () => {
    const r = await constituirCphs({ dotacion: 5 });
    assert.equal(r.origen, EP.ORIGEN.VOLUNTARIO, 'el umbral nunca bloquea constituir');
});

test('regla 1: no coexisten dos órganos vigentes del mismo tipo en el ámbito', async () => {
    await constituirCphs();
    await assert.rejects(() => constituirCphs(), (e) => {
        assert.ok(e instanceof ErrorValidacion);
        assert.match(e.message, /Ya existe un órgano vigente/);
        return true;
    });
});

test('el mismo tipo sí se constituye en otro ámbito', async () => {
    await constituirCphs({ obraId: 'o-1' });
    const otra = await constituirCphs({ obraId: 'o-2' });
    assert.equal(otra.obraId, 'o-2');
});

test('una composición inválida impide constituir y no deja el órgano a medias', async () => {
    await assert.rejects(() => constituirCphs({ miembros: comite().slice(0, 3) }), ErrorValidacion);
    assert.equal((await svc().listarOrganos(TENANT)).length, 0);
});

test('getOrgano devuelve integrantes y reuniones; listarOrganos no los arrastra', async () => {
    const creado = await constituirCphs();
    const leido = await svc().getOrgano(TENANT, creado.organoId);
    assert.equal(leido.miembros.length, 6);
    assert.ok(leido.reuniones.length >= 24);

    const lista = await svc().listarOrganos(TENANT);
    assert.equal(lista.length, 1);
    assert.equal(lista[0].miembros, undefined);
    assert.equal(lista[0].reuniones, undefined);
});

test('regla 8: sin acta no se marca la reunión como realizada', async () => {
    const r = await constituirCphs();
    await assert.rejects(() => svc().registrarReunionRealizada({
        tenantId: TENANT, organoId: r.organoId, reunionId: r.reuniones[0].reunionId,
        fechaRealizada: '2026-02-15T00:00:00.000Z', actaDocumentoId: null, ahora: AHORA,
    }), ErrorValidacion);
});

test('con acta, la reunión queda realizada', async () => {
    const r = await constituirCphs();
    const out = await svc().registrarReunionRealizada({
        tenantId: TENANT, organoId: r.organoId, reunionId: r.reuniones[0].reunionId,
        fechaRealizada: '2026-02-15T00:00:00.000Z', actaDocumentoId: 'doc-acta-1', ahora: AHORA,
    });
    assert.equal(out.estado, EP.ESTADO_REUNION.REALIZADA);
    assert.equal(out.actaDocumentoId, 'doc-acta-1');
});

test('la extraordinaria exige causal válida y no ocupa periodo mensual', async () => {
    const r = await constituirCphs();
    await assert.rejects(() => svc().crearReunionExtraordinaria({
        tenantId: TENANT, organoId: r.organoId, causal: 'PORQUE_SI',
    }), ErrorValidacion);

    const extra = await svc().crearReunionExtraordinaria({
        tenantId: TENANT, organoId: r.organoId,
        causal: EP.CAUSAL_EXTRAORDINARIA.ACCIDENTE_FATAL_O_GRAVE,
        fechaProgramada: '2026-03-02T00:00:00.000Z',
    });
    assert.equal(extra.tipo, EP.TIPO_REUNION.EXTRAORDINARIA);
    assert.equal(extra.periodoMes, null, 'no cuenta para la periodicidad mensual');
});

test('una ordinaria solo se reagenda dentro de su mes', async () => {
    const r = await constituirCphs();
    const feb = r.reuniones.find((x) => x.periodoMes === '2026-02');
    await assert.rejects(() => svc().reagendarReunion({
        tenantId: TENANT, organoId: r.organoId, reunionId: feb.reunionId,
        fechaProgramada: '2026-03-05T12:00:00.000Z',
    }), ErrorValidacion);

    const ok = await svc().reagendarReunion({
        tenantId: TENANT, organoId: r.organoId, reunionId: feb.reunionId,
        fechaProgramada: '2026-02-20T12:00:00.000Z',
    });
    assert.equal(ok.fechaProgramada.slice(0, 10), '2026-02-20');
});

test('regla 11: al disolver se cancelan las futuras, la evidencia pasada no se toca', async () => {
    const r = await constituirCphs();
    const ahora = new Date('2026-06-15T12:00:00.000Z');
    const feb = r.reuniones.find((x) => x.periodoMes === '2026-02');
    await svc().registrarReunionRealizada({
        tenantId: TENANT, organoId: r.organoId, reunionId: feb.reunionId,
        fechaRealizada: '2026-02-15T00:00:00.000Z', actaDocumentoId: 'doc-acta-1', ahora,
    });

    const res = await svc().disolverOrgano({ tenantId: TENANT, organoId: r.organoId, ahora });
    assert.ok(res.canceladas > 0);

    const leido = await svc().getOrgano(TENANT, r.organoId);
    assert.equal(leido.estado, EP.ESTADO_ORGANO.DISUELTO);
    assert.equal(leido.reuniones.find((x) => x.periodoMes === '2026-02').estado, EP.ESTADO_REUNION.REALIZADA);
    const futuras = leido.reuniones.filter((x) => new Date(x.fechaProgramada) > ahora);
    assert.ok(futuras.length > 0 && futuras.every((x) => x.estado === EP.ESTADO_REUNION.NO_REALIZADA));
});

test('disuelto el órgano, se puede constituir uno nuevo en el ámbito', async () => {
    const r = await constituirCphs();
    await svc().disolverOrgano({ tenantId: TENANT, organoId: r.organoId, ahora: new Date('2026-06-15T12:00:00.000Z') });
    const nuevo = await constituirCphs();
    assert.notEqual(nuevo.organoId, r.organoId);
});

test('la acreditación del integrante es un check más un documento', async () => {
    const r = await constituirCphs();
    const out = await svc().actualizarAcreditacion(TENANT, r.organoId, r.miembros[0].miembroId, {
        realizada: true, documentoId: 'doc-opr-1', fecha: '2026-05-01',
    });
    assert.equal(out.acreditacion.realizada, true);
    assert.equal(out.acreditacion.documentoId, 'doc-opr-1');
});

test('resumenAmbito entrega dotación, obligaciones y destinatarios vigentes', async () => {
    const r = await constituirCphs();
    const personas = Array.from({ length: 40 }, (_, i) => ({
        personaId: `p${i}`, estado: 'activo', asignaciones: [{ obraId: 'o-1', estado: 'activa' }],
    }));
    const resumen = await svc().resumenAmbito({
        tenantId: TENANT, ambito: EP.AMBITO.OBRA, obraId: 'o-1', personas, ahora: AHORA,
    });
    assert.equal(resumen.dotacion.dotacion, 40);
    assert.equal(resumen.dotacion.origen, 'calculada');
    assert.equal(resumen.obligaciones[EP.TIPO_ORGANO.COMITE_PARITARIO].obligatorio, true);
    assert.equal(resumen.destinatarios.length, 1);
    assert.equal(resumen.destinatarios[0].organoId, r.organoId);
    assert.deepEqual(resumen.destinatarios[0].personaIds.sort(), ['e1', 'e2', 'e3', 't1', 't2', 't3']);
});

test('con CPHS vigente, el delegado deja de ser obligatorio en el resumen', async () => {
    await constituirCphs({ dotacion: 20 });
    const personas = Array.from({ length: 20 }, (_, i) => ({
        personaId: `p${i}`, estado: 'activo', asignaciones: [{ obraId: 'o-1', estado: 'activa' }],
    }));
    const resumen = await svc().resumenAmbito({
        tenantId: TENANT, ambito: EP.AMBITO.OBRA, obraId: 'o-1', personas, ahora: AHORA,
    });
    assert.equal(resumen.obligaciones[EP.TIPO_ORGANO.DELEGADO_SST].obligatorio, false);
    assert.match(resumen.obligaciones[EP.TIPO_ORGANO.DELEGADO_SST].motivo, /comité paritario vigente/);
});

test('el DPR no genera reuniones ni vence por mandato', async () => {
    const r = await svc().constituirOrgano({
        tenantId: TENANT, ambito: EP.AMBITO.EMPRESA, tipo: EP.TIPO_ORGANO.DEPARTAMENTO_PREVENCION,
        fechaEleccionODesignacion: '2026-01-10T00:00:00.000Z',
        miembros: [{ personaId: 'x1', nombre: 'Experta', estamento: EP.ESTAMENTO.NO_APLICA, calidad: EP.CALIDAD.TITULAR, cargo: EP.CARGO_ORGANO.EXPERTO_RESPONSABLE }],
        dotacion: 150, ahora: AHORA,
    });
    assert.equal(r.fechaTerminoMandato, null);
    assert.equal(r.reuniones.length, 0);
    assert.equal(r.origen, EP.ORIGEN.OBLIGATORIO);
});

test('un órgano de ámbito obra exige obraId', async () => {
    await assert.rejects(() => constituirCphs({ obraId: null }), ErrorValidacion);
});
