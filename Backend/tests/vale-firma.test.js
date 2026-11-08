// Vales de firma sin conexión.
//
// Reemplazan al PIN guardado en claro en el dispositivo. Estas pruebas fijan las
// cuatro propiedades de las que depende que el reemplazo sea una mejora y no un
// cambio de sitio del problema:
//
//   1. un vale sirve UNA vez;
//   2. un vale es de una persona y no vale para otra;
//   3. un vale vencido no invalida la firma: la manda a revisión, y la firma
//      marcada no cuenta como cumplimiento hasta que alguien la confirma;
//   4. pasada la ventana de revisión, ya no entra.

process.env.CAMPO_HMAC_KEY = 'clave-de-prueba-hmac';
process.env.CAMPO_CIFRADO_LOCAL_KEY = require('crypto').randomBytes(32).toString('base64');

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const { docClient } = require('../lib/clients/dynamodb');
const { ValeFirmaService, hashVale, VENTANA_REVISION_DIAS } = require('../lib/services/ValeFirmaService');
const { FirmaService } = require('../lib/services/FirmaService');
const { cumple, aplicar } = require('./expresiones-dynamo');

const EMPRESA = 't-empresa-a';
const PERSONA = 'p-trabajador';
// Obra del turno: los vales se emiten atados a la persona y a una obra.
const OBRA = 'o-turno';

let store;
let originalSend;

beforeEach(() => {
    store = { vales: [], escrituras: [], firmas: [] };
    originalSend = docClient.send;
    docClient.send = async (cmd) => {
        const nombre = cmd.constructor.name;
        const input = cmd.input || {};

        if (nombre === 'PutCommand' && input.TableName?.includes('ales')) {
            store.vales.push(input.Item);
            return {};
        }
        if (nombre === 'PutCommand') { store.firmas.push(input.Item); return {}; }

        // El vale se resuelve por clave primaria, no por índice: `valeHash` ES la
        // partición de la tabla. Este doble falla si alguien vuelve a introducir
        // un índice sobre la misma clave.
        if (nombre === 'GetCommand' && input.TableName?.includes('ales')) {
            return { Item: store.vales.find((v) => v.valeHash === input.Key.valeHash) || undefined };
        }
        if (nombre === 'QueryCommand' && input.IndexName === 'personaId-index' && input.TableName?.includes('ales')) {
            // Lo que el índice PROYECTA de verdad (INCLUDE usedAt, D-8): ni
            // `tenantId` ni `revocadoEn` llegan por acá.
            // Y en páginas de 2, como DynamoDB cuando la respuesta pasa de 1 MB:
            // quien lee solo la primera página deja vales vivos.
            const p = input.ExpressionAttributeValues[':p'];
            const todos = store.vales.filter((v) => v.personaId === p)
                .map(({ valeHash, personaId, usedAt }) => ({ valeHash, personaId, usedAt }));
            const desde = input.ExclusiveStartKey ? todos.findIndex((v) => v.valeHash === input.ExclusiveStartKey.valeHash) + 1 : 0;
            const pagina = todos.slice(desde, desde + 2);
            return {
                Items: pagina,
                ...(desde + 2 < todos.length ? { LastEvaluatedKey: { valeHash: pagina.at(-1).valeHash } } : {}),
            };
        }
        if (nombre === 'QueryCommand' && input.IndexName === 'personaId-index') {
            // Idempotencia de FirmaService: sin firmas previas.
            return { Items: [] };
        }
        if (nombre === 'UpdateCommand' && input.TableName?.includes('ales')) {
            const i = store.vales.findIndex((v) => v.valeHash === input.Key.valeHash);
            const registro = i >= 0 ? store.vales[i] : null;
            // Semántica de DynamoDB, no comparación de texto.
            if (!cumple(registro, input.ConditionExpression, input.ExpressionAttributeValues, input.ExpressionAttributeNames)) {
                const err = new Error('The conditional request failed');
                err.name = 'ConditionalCheckFailedException';
                throw err;
            }
            if (registro) store.vales[i] = aplicar(registro, input.UpdateExpression, input.ExpressionAttributeValues, input.ExpressionAttributeNames);
            store.escrituras.push(input);
            return {};
        }
        if (nombre === 'UpdateCommand') {
            store.escrituras.push(input);
            return {};
        }
        return { Items: [] };
    };
});

afterEach(() => { docClient.send = originalSend; });

const persona = { personaId: PERSONA, tenantId: EMPRESA, rut: '12.345.678-5', nombre: 'Juan', apellido: 'Pérez', habilitado: true, cargo: 'Carpintero' };

const firmarConVale = (vale, extra = {}) => FirmaService.crear({
    personaId: PERSONA,
    tenantId: EMPRESA,
    metodo: 'VALE',
    credencial: { vale, deviceId: 'dev-terreno', timestampLocal: '2026-09-16T11:20:00.000Z', ...extra },
    tipoFirma: 'trabajador',
    referenciaId: 'd-1',
    referenciaTipo: 'document',
    persona,
});

// ─── Emisión ─────────────────────────────────────────────────────────────────

test('el vale se guarda hasheado, nunca en claro', async () => {
    const { vales } = await ValeFirmaService.emitir({ obraId: OBRA, personaId: PERSONA, tenantId: EMPRESA, cantidad: 3 });

    assert.equal(vales.length, 3);
    assert.equal(store.vales.length, 3);
    for (const guardado of store.vales) {
        assert.ok(!vales.includes(guardado.valeHash), 'lo almacenado no es el vale');
        assert.equal(guardado.valeHash.length, 64);
        assert.equal(guardado.usedAt, null);
    }
    assert.ok(store.vales.some((v) => v.valeHash === hashVale(vales[0])));
});

test('la emisión tiene tope por solicitud', async () => {
    const { vales } = await ValeFirmaService.emitir({ obraId: OBRA, personaId: PERSONA, tenantId: EMPRESA, cantidad: 500 });
    assert.equal(vales.length, 20);
});

// ─── Uso único y titularidad ─────────────────────────────────────────────────

test('un vale sirve una sola vez', async () => {
    const { vales } = await ValeFirmaService.emitir({ obraId: OBRA, personaId: PERSONA, tenantId: EMPRESA, cantidad: 1 });

    const primero = await ValeFirmaService.consumir({ vale: vales[0], personaId: PERSONA });
    const segundo = await ValeFirmaService.consumir({ vale: vales[0], personaId: PERSONA });

    assert.equal(primero.ok, true);
    assert.equal(segundo.ok, false);
    assert.equal(segundo.motivo, 'ya_usado');
});

test('el vale de una persona no firma por otra', async () => {
    const { vales } = await ValeFirmaService.emitir({ obraId: OBRA, personaId: PERSONA, tenantId: EMPRESA, cantidad: 1 });

    const r = await ValeFirmaService.consumir({ vale: vales[0], personaId: 'otra-persona' });

    assert.equal(r.ok, false);
    assert.equal(r.motivo, 'otra_persona');
    assert.equal(store.vales[0].usedAt, null, 'no se gasta el vale de quien no lo pidió');
});

test('un vale inventado no sirve', async () => {
    const r = await ValeFirmaService.consumir({ vale: 'a'.repeat(64), personaId: PERSONA });
    assert.equal(r.ok, false);
    assert.equal(r.motivo, 'no_existe');
});

// ─── La firma que se apoya en el vale ────────────────────────────────────────

test('la firma con vale vigente queda válida y con su traza', async () => {
    const { vales } = await ValeFirmaService.emitir({ obraId: OBRA, personaId: PERSONA, tenantId: EMPRESA, cantidad: 1 });

    const firma = await firmarConVale(vales[0]);

    assert.equal(firma.estado, 'valida');
    assert.equal(firma.requiereRevision, false);
    assert.equal(firma.metodoValidacion, 'Vale offline');
    assert.equal(firma.offline.dispositivoUso, 'dev-terreno');
    assert.equal(firma.offline.firmadaSinConexionEn, '2026-09-16T11:20:00.000Z');
    assert.ok(firma.offline.sincronizadaEn, 'queda cuándo entró al sistema');
    assert.notEqual(firma.timestamp, firma.offline.firmadaSinConexionEn,
        'la hora declarada en terreno no reemplaza la del servidor');
});

test('sin vale válido no se registra ninguna firma', async () => {
    await assert.rejects(() => firmarConVale('vale-inventado'), /no es válido/i);
    assert.equal(store.firmas.length, 0);
});

// ─── Vale vencido: revisión, no descarte ─────────────────────────────────────

test('un vale vencido registra la firma pero la manda a revisión', async () => {
    // El turno se alargó, o el equipo no vio red en dos días: el acto ocurrió.
    const { vales } = await ValeFirmaService.emitir({ obraId: OBRA, personaId: PERSONA, tenantId: EMPRESA, cantidad: 1 });
    store.vales[0].expiresAt = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const firma = await firmarConVale(vales[0]);

    assert.equal(firma.estado, 'valida');
    assert.equal(firma.requiereRevision, true, 'no cuenta como cumplimiento hasta confirmarla');
    assert.match(firma.motivoRevision, /vencido/i);
    assert.equal(firma.offline.valeVencido, true);
    assert.ok(firma.offline.valeExpiraEn, 'el acta dice cuándo venció');
});

test('pasada la ventana de revisión el vale ya no entra', async () => {
    const { vales } = await ValeFirmaService.emitir({ obraId: OBRA, personaId: PERSONA, tenantId: EMPRESA, cantidad: 1 });
    const dias = (VENTANA_REVISION_DIAS + 1) * 24 * 60 * 60 * 1000;
    store.vales[0].expiresAt = new Date(Date.now() - dias).toISOString();

    await assert.rejects(() => firmarConVale(vales[0]), /venció hace demasiado tiempo/i);
    assert.equal(store.firmas.length, 0);
});

test('un vale vencido tampoco se puede reutilizar', async () => {
    const { vales } = await ValeFirmaService.emitir({ obraId: OBRA, personaId: PERSONA, tenantId: EMPRESA, cantidad: 1 });
    store.vales[0].expiresAt = new Date(Date.now() - 60 * 60 * 1000).toISOString();

    await firmarConVale(vales[0]);
    const segundo = await ValeFirmaService.consumir({ vale: vales[0], personaId: PERSONA });

    assert.equal(segundo.ok, false);
    assert.equal(segundo.motivo, 'ya_usado');
});

// ─── Revocación ──────────────────────────────────────────────────────────────

const vales = (lista) => lista.map((v) => store.vales.find((r) => r.valeHash === hashVale(v)));

test('revocar anula los vales sin usar, sin marcarlos como usados', async () => {
    const { vales: emitidos } = await ValeFirmaService.emitir({ obraId: OBRA, personaId: PERSONA, tenantId: EMPRESA, cantidad: 3 });

    const r = await ValeFirmaService.revocarDePersona(PERSONA, { tenantId: EMPRESA, motivo: 'pin_restablecido', por: 'p-admin' });

    assert.deepEqual(r, { revocados: 3, noAplicaban: 0, fallidos: 0 });
    for (const v of vales(emitidos)) {
        assert.ok(v.revocadoEn);
        assert.equal(v.revocadoPor, 'p-admin');
        assert.equal(v.usedAt, null, 'revocado no es usado: el acta tiene que distinguirlos');
    }
});

test('un vale revocado no firma, y el motivo lo dice', async () => {
    const { vales: [vale] } = await ValeFirmaService.emitir({ obraId: OBRA, personaId: PERSONA, tenantId: EMPRESA, cantidad: 1 });
    await ValeFirmaService.revocarDePersona(PERSONA, { tenantId: EMPRESA, motivo: 'pin_restablecido' });
    const r = await ValeFirmaService.consumir({ vale, personaId: PERSONA });
    assert.equal(r.ok, false);
    assert.equal(r.motivo, 'revocado');
});

test('revocar no toca un vale ya usado: su registro de uso queda intacto', async () => {
    const { vales: [usado, libre] } = await ValeFirmaService.emitir({ obraId: OBRA, personaId: PERSONA, tenantId: EMPRESA, cantidad: 2 });
    await ValeFirmaService.consumir({ vale: usado, personaId: PERSONA });
    const usoOriginal = vales([usado])[0].usedAt;

    const r = await ValeFirmaService.revocarDePersona(PERSONA, { tenantId: EMPRESA });

    assert.equal(r.revocados, 1);
    assert.equal(r.noAplicaban, 1);
    assert.equal(vales([usado])[0].usedAt, usoOriginal);
    assert.ok(!('revocadoEn' in vales([usado])[0]));
    assert.ok(vales([libre])[0].revocadoEn);
});

test('si un vale se usa entre la consulta y la revocación, su uso no se pisa', async () => {
    const { vales: [vale] } = await ValeFirmaService.emitir({ obraId: OBRA, personaId: PERSONA, tenantId: EMPRESA, cantidad: 1 });
    const anterior = docClient.send;
    docClient.send = async (cmd) => {
        const res = await anterior(cmd);
        if (cmd.constructor.name === 'QueryCommand' && cmd.input.TableName?.includes('ales')) {
            docClient.send = anterior;
            await ValeFirmaService.consumir({ vale, personaId: PERSONA });   // se usa justo ahora
        }
        return res;
    };
    const r = await ValeFirmaService.revocarDePersona(PERSONA, { tenantId: EMPRESA });
    docClient.send = anterior;
    assert.equal(r.revocados, 0);
    const [registro] = vales([vale]);
    assert.ok(registro.usedAt);
    assert.ok(!('revocadoEn' in registro));
});

test('con más vales de los que caben en una página, se anulan todos', async () => {
    await ValeFirmaService.emitir({ obraId: OBRA, personaId: PERSONA, tenantId: EMPRESA, cantidad: 5 });
    const r = await ValeFirmaService.revocarDePersona(PERSONA, { tenantId: EMPRESA });
    assert.equal(r.revocados, 5);
});

test('revocar en una empresa no toca los vales de la misma persona en otra', async () => {
    const { vales: [deOtra] } = await ValeFirmaService.emitir({ obraId: OBRA, personaId: PERSONA, tenantId: 't-empresa-b', cantidad: 1 });
    const r = await ValeFirmaService.revocarDePersona(PERSONA, { tenantId: EMPRESA });
    assert.equal(r.revocados, 0);
    assert.ok(!('revocadoEn' in vales([deOtra])[0]));
});

test('si revocar y consumir llegan a la vez, gana uno solo: nunca queda usado Y revocado', async () => {
    const { vales: [vale] } = await ValeFirmaService.emitir({ obraId: OBRA, personaId: PERSONA, tenantId: EMPRESA, cantidad: 1 });
    // consumir ya leyó el vale (libre); antes de escribir, se revoca.
    const anterior = docClient.send;
    docClient.send = async (cmd) => {
        if (cmd.constructor.name === 'UpdateCommand' && cmd.input.UpdateExpression.includes('deviceIdUso')) {
            docClient.send = anterior;
            await ValeFirmaService.revocarDePersona(PERSONA, { tenantId: EMPRESA });
        }
        return anterior(cmd);
    };
    const r = await ValeFirmaService.consumir({ vale, personaId: PERSONA });
    docClient.send = anterior;

    assert.equal(r.ok, false);
    assert.equal(r.motivo, 'revocado');
    const [registro] = vales([vale]);
    assert.ok(registro.revocadoEn);
    assert.equal(registro.usedAt, null);
});

test('si la consulta de vales falla, revocar lanza: no dice "0 revocados" como si no hubiera', async () => {
    const anterior = docClient.send;
    docClient.send = async (cmd) => {
        if (cmd.constructor.name === 'QueryCommand') throw Object.assign(new Error('caído'), { name: 'InternalServerError' });
        return anterior(cmd);
    };
    await assert.rejects(ValeFirmaService.revocarDePersona(PERSONA, { tenantId: EMPRESA }));
    docClient.send = anterior;
});

test('un vale que no se pudo anular se cuenta como fallido, no como anulado', async () => {
    await ValeFirmaService.emitir({ obraId: OBRA, personaId: PERSONA, tenantId: EMPRESA, cantidad: 2 });
    const anterior = docClient.send;
    let primera = true;
    docClient.send = async (cmd) => {
        if (cmd.constructor.name === 'UpdateCommand' && primera) {
            primera = false;
            throw Object.assign(new Error('throttling'), { name: 'ProvisionedThroughputExceededException' });
        }
        return anterior(cmd);
    };
    const r = await ValeFirmaService.revocarDePersona(PERSONA, { tenantId: EMPRESA });
    docClient.send = anterior;
    assert.deepEqual(r, { revocados: 1, noAplicaban: 0, fallidos: 1 });
});

// ─── Armado de la escritura sobre el documento ───────────────────────────────

test('firmar un documento sin estar asignado no rompe la escritura', async () => {
    // DynamoDB rechaza la escritura completa si sobra un nombre en
    // ExpressionAttributeNames. Pasaba al firmar un documento donde la persona no
    // tiene asignación pendiente —el relator, o un rezagado cuya asignación ya
    // estaba firmada— y el error salía como un 500 ilegible.
    const partes = FirmaService.buildFirmaUpdateParts({
        documentData: { asignaciones: [] },
        nuevasFirmas: [{ token: 't', personaId: PERSONA }],
        asignacionUpdates: [{ personaId: PERSONA }],
    });

    // Sin asignaciones que tocar no hay nombres que declarar —el parámetro se
    // omite entero, porque DynamoDB también rechaza el mapa vacío— y tampoco
    // puede sobrar ningún valor.
    assert.equal(partes.names, undefined);
    const expresion = partes.setClauses.join(' ');
    for (const valor of Object.keys(partes.values)) {
        assert.ok(expresion.includes(valor), `${valor} se declara pero no se usa`);
    }
});

test('la idempotencia se comprueba antes de gastar el vale', async () => {
    // Un reintento de sincronización no puede quemar un vale nuevo por una firma
    // que el servidor ya registró.
    const { vales } = await ValeFirmaService.emitir({ obraId: OBRA, personaId: PERSONA, tenantId: EMPRESA, cantidad: 1 });
    const anterior = docClient.send;
    docClient.send = async (cmd) => {
        if (cmd.constructor.name === 'QueryCommand' && cmd.input.IndexName === 'personaId-index'
            && cmd.input.FilterExpression) {
            return { Items: [{ signatureId: 'ya-existe', personaId: PERSONA, estado: 'valida' }] };
        }
        return anterior(cmd);
    };

    const firma = await firmarConVale(vales[0]);
    docClient.send = anterior;

    assert.equal(firma.signatureId, 'ya-existe', 'devuelve la firma existente');
    assert.equal(store.vales[0].usedAt, null, 'el vale sigue disponible');
});

test('con asignación pendiente sí se declara y se usa el nombre de estado', async () => {
    const partes = FirmaService.buildFirmaUpdateParts({
        documentData: { asignaciones: [{ personaId: PERSONA, estado: 'pendiente' }] },
        nuevasFirmas: [{ token: 't', personaId: PERSONA }],
        asignacionUpdates: [{ personaId: PERSONA }],
    });

    assert.equal(partes.names['#estado'], 'estado');
    assert.ok(partes.setClauses.some((c) => c.includes('#estado')));
    const expresion = partes.setClauses.join(' ');
    for (const valor of Object.keys(partes.values)) {
        assert.ok(expresion.includes(valor), `${valor} se declara pero no se usa`);
    }
});

// ─── Reintento de la misma firma (idFirmaLocal) ─────────────────────────────
//
// El vale se gasta antes de escribir la firma. Si la escritura falla justo
// después, el reintento recibía "ya usado" y la firma tomada en terreno se
// perdía. Ahora el equipo identifica cada firma (`idFirmaLocal`), el servidor lo
// anota al gastar el vale, y un reintento con el mismo identificador sigue.

/** Hace fallar la próxima escritura de la firma (no la de su traza). */
const fallarProximaFirma = () => {
    const anterior = docClient.send;
    let fallo = false;
    docClient.send = async (cmd) => {
        if (!fallo && cmd.constructor.name === 'PutCommand' && !cmd.input.TableName?.includes('ales')
            && !String(cmd.input.Item?.signatureId || '').includes('#')) {
            fallo = true;
            throw new Error('falla simulada al escribir la firma');
        }
        return anterior(cmd);
    };
    return () => { docClient.send = anterior; };
};
const firmasEscritas = () => store.firmas.filter((f) => f.estado === 'valida');

test('si la firma falla después de gastar el vale, el reintento de la misma firma entra una vez', async () => {
    const { vales } = await ValeFirmaService.emitir({ obraId: OBRA, personaId: PERSONA, tenantId: EMPRESA, cantidad: 1 });
    const restaurar = fallarProximaFirma();
    await assert.rejects(() => firmarConVale(vales[0], { idFirmaLocal: 'local-1' }), /falla simulada/);
    restaurar();
    assert.ok(store.vales[0].usedAt, 'el vale quedó gastado por el primer intento');
    assert.equal(firmasEscritas().length, 0);

    const firma = await firmarConVale(vales[0], { idFirmaLocal: 'local-1' });
    assert.equal(firma.estado, 'valida');
    assert.equal(firma.offline.idFirmaLocal, 'local-1');
    assert.equal(firmasEscritas().length, 1, 'exactamente una firma');
});

test('con otro idFirmaLocal, o sin él, un vale gastado sigue sin servir', async () => {
    const { vales } = await ValeFirmaService.emitir({ obraId: OBRA, personaId: PERSONA, tenantId: EMPRESA, cantidad: 1 });
    await firmarConVale(vales[0], { idFirmaLocal: 'local-1' });
    await assert.rejects(() => firmarConVale(vales[0], { idFirmaLocal: 'local-2' }), /ya se usó/);
    await assert.rejects(() => firmarConVale(vales[0]), /ya se usó/);
});

test('dos envíos a la vez de la misma firma no se rechazan entre sí', async () => {
    const { vales } = await ValeFirmaService.emitir({ obraId: OBRA, personaId: PERSONA, tenantId: EMPRESA, cantidad: 1 });
    const [a, b] = await Promise.all([
        ValeFirmaService.consumir({ vale: vales[0], personaId: PERSONA, tenantId: EMPRESA, idFirmaLocal: 'local-1' }),
        ValeFirmaService.consumir({ vale: vales[0], personaId: PERSONA, tenantId: EMPRESA, idFirmaLocal: 'local-1' }),
    ]);
    assert.equal(a.ok && b.ok, true);
    assert.equal([a, b].filter((r) => r.reintento).length, 1, 'uno gasta el vale y el otro es el reintento');
});

test('un reintento después del vencimiento no manda a revisión una firma tomada a tiempo', async () => {
    // Cuenta cuándo se gastó el vale, no cuándo llega el reintento.
    const { vales } = await ValeFirmaService.emitir({ obraId: OBRA, personaId: PERSONA, tenantId: EMPRESA, cantidad: 1 });
    const restaurar = fallarProximaFirma();
    await assert.rejects(() => firmarConVale(vales[0], { idFirmaLocal: 'local-1' }), /falla simulada/);
    restaurar();
    store.vales[0].expiresAt = new Date(Date.now() - 60 * 1000).toISOString();
    store.vales[0].usedAt = new Date(Date.now() - 2 * 60 * 1000).toISOString();

    const firma = await firmarConVale(vales[0], { idFirmaLocal: 'local-1' });
    assert.equal(firma.requiereRevision, false);
});

test('un vale de otra empresa no firma, y no se gasta', async () => {
    const { vales } = await ValeFirmaService.emitir({ obraId: OBRA, personaId: PERSONA, tenantId: 't-otra', cantidad: 1 });
    await assert.rejects(() => firmarConVale(vales[0], { idFirmaLocal: 'local-1' }), /no es válido/);
    assert.equal(store.vales[0].usedAt, null);
    const r = await ValeFirmaService.consumir({ vale: vales[0], personaId: PERSONA, tenantId: EMPRESA });
    assert.equal(r.motivo, 'otra_empresa');
});

// ─── Vales atados a persona y obra ───────────────────────────────────────────
//
// El vale de la obra X sirve para lo de la obra X y para lo que no tiene obra
// (documentos de empresa como el Reglamento Interno). No para otra obra.

test('sin obra no se emiten vales, y por omisión se emiten 5', async () => {
    await assert.rejects(() => ValeFirmaService.emitir({ personaId: PERSONA, tenantId: EMPRESA }), /obra/);
    const { vales } = await ValeFirmaService.emitir({ obraId: OBRA, personaId: PERSONA, tenantId: EMPRESA });
    assert.equal(vales.length, 5);
    assert.ok(store.vales.every((v) => v.obraId === OBRA), 'cada vale guarda su obra');
});

test('el vale de una obra firma en esa obra y en lo que no tiene obra', async () => {
    const { vales } = await ValeFirmaService.emitir({ obraId: OBRA, personaId: PERSONA, tenantId: EMPRESA, cantidad: 2 });
    const enSuObra = await ValeFirmaService.consumir({ vale: vales[0], personaId: PERSONA, tenantId: EMPRESA, obraId: OBRA });
    const sinObra = await ValeFirmaService.consumir({ vale: vales[1], personaId: PERSONA, tenantId: EMPRESA, obraId: null });
    assert.equal(enSuObra.ok, true);
    assert.equal(sinObra.ok, true);
});

test('el vale de una obra no firma en otra, y no se gasta', async () => {
    const { vales } = await ValeFirmaService.emitir({ obraId: OBRA, personaId: PERSONA, tenantId: EMPRESA, cantidad: 1 });
    const r = await ValeFirmaService.consumir({ vale: vales[0], personaId: PERSONA, tenantId: EMPRESA, obraId: 'o-otra' });
    assert.equal(r.motivo, 'otra_obra');
    assert.equal(store.vales[0].usedAt, null);
    await assert.rejects(() => FirmaService.crear({
        personaId: PERSONA, tenantId: EMPRESA, obraId: 'o-otra', metodo: 'VALE',
        credencial: { vale: vales[0], idFirmaLocal: 'local-1' }, tipoFirma: 'actividad',
        referenciaId: 'a-1', referenciaTipo: 'activity', persona,
    }), /otra obra/);
});

test('un vale sin obra (anterior a esta regla) no se acepta', async () => {
    const { vales } = await ValeFirmaService.emitir({ obraId: OBRA, personaId: PERSONA, tenantId: EMPRESA, cantidad: 1 });
    delete store.vales[0].obraId;
    const r = await ValeFirmaService.consumir({ vale: vales[0], personaId: PERSONA, tenantId: EMPRESA, obraId: null });
    assert.equal(r.motivo, 'otra_obra');
});
