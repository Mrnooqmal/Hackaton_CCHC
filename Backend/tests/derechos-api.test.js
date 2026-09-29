// La API de derechos del titular sobre DynamoDB simulado con los esquemas reales.
//
// Lo que se fija: la solicitud, el bloqueo y el historial se escriben juntos o
// no se escriben; el bloqueo se aplica de verdad (la persona desaparece de los
// listados y no puede firmar); la fecha de recepción no se edita nunca; la
// prórroga tardía no se puede registrar; el historial solo crece.

process.env.CAMPO_HMAC_KEY = 'clave-de-prueba-hmac';
process.env.CAMPO_CIFRADO_LOCAL_KEY = require('crypto').randomBytes(32).toString('base64');
process.env.CREDENCIAL_PEPPER = 'pimienta-de-prueba';

const { prepararEntorno, crearDobleTablas } = require('./doble-dynamo-tablas');
const esquemas = prepararEntorno();

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { docClient } = require('../lib/clients/dynamodb');
const { PersonaService } = require('../lib/services/PersonaService');
const { TenantService } = require('../lib/services/TenantService');
const { FirmaService } = require('../lib/services/FirmaService');
const derechos = require('../handlers/gobernanza/derechos');

let doble;
let T;
let admin;
let titular;

beforeEach(async () => {
    doble = crearDobleTablas(docClient, esquemas);
    const tenant = await new TenantService().setup({ nombre: 'Constructora Prueba', rutEmpresa: '76.543.210-3' });
    T = tenant.tenantId;
    const svc = new PersonaService();
    admin = (await svc.crear(T, { rut: '9.876.543-3', nombre: 'Ana', apellidoPaterno: 'Rojas', rol: 'admin', email: 'ana@ejemplo.cl', password: 'clave-larga-1' })).persona;
    titular = (await svc.crear(T, { rut: '12.345.678-5', nombre: 'Juan', rol: 'trabajador' })).persona;
});
afterEach(() => doble.restaurar());

const AHORA = new Date('2026-10-07T15:00:00Z');
const pedir = (metodo, ruta, cuerpo, { permisos = 'empresa.derechos_titulares', ahora = AHORA, tenant } = {}) => derechos.atender({
    requestContext: { http: { method: metodo }, authorizer: { lambda: { sessionId: 's', personaId: admin.personaId, tenantId: tenant || T, rol: 'admin', permisos } } },
    rawPath: ruta, body: cuerpo ? JSON.stringify(cuerpo) : undefined, queryStringParameters: {},
}, { ahora });
const datos = (res) => JSON.parse(res.body).data;
const historial = () => doble.items('GOBERNANZA_HISTORIAL_TABLE');
const fichaTitular = () => doble.items('PERSONAS_TABLE').find((p) => p.personaId === titular.personaId);

const SOLICITUD = () => ({ personaId: titular.personaId, derecho: 'supresion', canal: 'Correo a rrhh@constructora.cl', recibidaEl: '2026-10-05T12:00:00Z', detalle: 'Pide suprimir sus datos' });

// ─── Acceso ─────────────────────────────────────────────────────────────────

test('sin el permiso de derechos de los titulares no se ve ni se registra nada', async () => {
    assert.equal((await pedir('GET', '/gobernanza/solicitudes', null, { permisos: 'personas.ver' })).statusCode, 403);
    assert.equal((await pedir('POST', '/gobernanza/solicitudes', SOLICITUD(), { permisos: 'personas.crear' })).statusCode, 403);
});

test('un titular de otra empresa no se puede registrar', async () => {
    const res = await pedir('POST', '/gobernanza/solicitudes', { ...SOLICITUD(), personaId: 'p-de-otra' });
    assert.equal(res.statusCode, 404);
    assert.equal(historial().length, 0);
});

// ─── Registrar y bloquear, juntos ───────────────────────────────────────────

test('registrar una supresión la guarda, bloquea a la persona y deja dos eventos en el historial', async () => {
    const res = await pedir('POST', '/gobernanza/solicitudes', SOLICITUD());
    assert.equal(res.statusCode, 201, res.body);
    const s = datos(res);
    assert.equal(s.recibidaEl, '2026-10-05T12:00:00.000Z');
    assert.equal(s.registradaPor.nombre, 'Ana Rojas');
    assert.equal(s.bloqueo.aplicadoEl, AHORA.toISOString());
    assert.ok(fichaTitular().solicitudesBloqueo.has(s.solicitudId), 'la persona quedó bloqueada');
    assert.deepEqual(historial().map((h) => h.tipo).sort(), ['bloqueo', 'solicitud']);
    assert.equal(historial().find((h) => h.tipo === 'solicitud').datos.recibidaEl, '2026-10-05T12:00:00.000Z', 'el historial guarda la fecha original');
});

test('el bloqueo es real: la persona sale de los listados y no puede firmar', async () => {
    await pedir('POST', '/gobernanza/solicitudes', SOLICITUD());
    const lista = await new PersonaService().listByTenant(T);
    assert.ok(!lista.some((p) => p.personaId === titular.personaId), 'fuera de los listados operativos');
    const conBloqueadas = await new PersonaService().listByTenant(T, { incluirBloqueadas: true });
    assert.ok(conBloqueadas.some((p) => p.personaId === titular.personaId), 'pero sí donde es obligación legal');
    const persona = await new PersonaService().getById(titular.personaId);
    await assert.rejects(FirmaService.crear({ personaId: titular.personaId, persona, credencial: '1234', metodo: 'PIN', tipoFirma: 'documento' }),
        (e) => e.codigo === 'TRATAMIENTO_BLOQUEADO');
});

test('acceso y portabilidad no bloquean', async () => {
    const res = await pedir('POST', '/gobernanza/solicitudes', { ...SOLICITUD(), derecho: 'acceso' });
    assert.equal(res.statusCode, 201);
    assert.ok(!('solicitudesBloqueo' in fichaTitular()));
    assert.deepEqual(historial().map((h) => h.tipo), ['solicitud']);
});

test('una fecha de recepción futura se rechaza y no deja rastro', async () => {
    const res = await pedir('POST', '/gobernanza/solicitudes', { ...SOLICITUD(), recibidaEl: '2026-10-20T00:00:00Z' });
    assert.equal(res.statusCode, 400);
    assert.equal(historial().length, 0);
    assert.equal(doble.items('GOBERNANZA_TABLE').length, 0);
});

// ─── Lo inmutable ───────────────────────────────────────────────────────────

test('ninguna actualización de solicitudes toca la fecha de recepción ni el vencimiento', () => {
    for (const expr of Object.values(derechos._interno.ACTUALIZACIONES)) {
        assert.ok(!/recibidaEl|registradaEl|venceEl|registradaPor/.test(expr), expr);
    }
    // Y no hay otras actualizaciones de la tabla fuera de ese catálogo.
    const fuente = fs.readFileSync(path.join(__dirname, '../handlers/gobernanza/derechos.js'), 'utf8');
    const expresiones = [...fuente.matchAll(/UpdateExpression:\s*(['`])(.*?)\1/g)].map((m) => m[2]);
    for (const e of expresiones) assert.ok(!/recibidaEl|registradaEl|\bvenceEl\b/.test(e), `actualización que toca un campo inmutable: ${e}`);
});

test('el historial solo recibe ítems nuevos: nunca una actualización ni un borrado', async () => {
    const { solicitudId } = datos(await pedir('POST', '/gobernanza/solicitudes', SOLICITUD()));
    await pedir('POST', `/gobernanza/solicitudes/${solicitudId}/prorroga`, { comunicadaEl: '2026-10-20T10:00:00Z', motivo: 'Faltan antecedentes de tres obras' }, { ahora: new Date('2026-10-20T11:00:00Z') });
    await pedir('POST', `/gobernanza/solicitudes/${solicitudId}/respuesta`, { resultado: 'acogida_parcial', fundamento: 'Se suprimió lo de conveniencia; la evidencia se conserva por el DS 44.' }, { ahora: new Date('2026-10-25T11:00:00Z') });
    const sobreHistorial = doble.escrituras.filter((e) => e.tabla === 'GOBERNANZA_HISTORIAL_TABLE');
    assert.ok(sobreHistorial.length >= 4);
    assert.ok(sobreHistorial.every((e) => e.nombre === 'Put'), 'solo Put');
    assert.deepEqual(historial().map((h) => h.tipo).sort(), ['bloqueo', 'prorroga', 'respuesta', 'solicitud']);
});

// ─── Prórroga ───────────────────────────────────────────────────────────────

test('la prórroga a tiempo queda, con su evento', async () => {
    const { solicitudId } = datos(await pedir('POST', '/gobernanza/solicitudes', SOLICITUD()));
    const res = await pedir('POST', `/gobernanza/solicitudes/${solicitudId}/prorroga`, { comunicadaEl: '2026-10-20T10:00:00Z', motivo: 'Faltan antecedentes de tres obras', medio: 'correo' }, { ahora: new Date('2026-10-20T11:00:00Z') });
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(datos(res).plazoVigente.slice(0, 10), '2026-12-04');
    const ev = historial().find((h) => h.tipo === 'prorroga');
    assert.equal(ev.datos.venceElOriginal.slice(0, 10), '2026-11-04');
});

test('vencido el primer plazo, la prórroga NO se registra: ni en la solicitud ni en el historial', async () => {
    const { solicitudId } = datos(await pedir('POST', '/gobernanza/solicitudes', SOLICITUD()));
    const antes = historial().length;
    const res = await pedir('POST', `/gobernanza/solicitudes/${solicitudId}/prorroga`, { comunicadaEl: '2026-11-01T10:00:00Z', motivo: 'Dice que se comunicó a tiempo' }, { ahora: new Date('2026-11-06T10:00:00Z') });
    assert.equal(res.statusCode, 409);
    assert.equal(historial().length, antes);
    assert.equal(doble.items('GOBERNANZA_TABLE').find((x) => x.solicitudId === solicitudId).prorroga, null);
});

test('la escritura repite la regla: si el plazo venció entre la lectura y la escritura, no procede', async () => {
    const { solicitudId } = datos(await pedir('POST', '/gobernanza/solicitudes', SOLICITUD()));
    // Las reglas se evalúan con un reloj "antes del vencimiento", pero la escritura
    // compara contra ese mismo instante: se simula un reloj adelantado solo en la escritura.
    const enviar = docClient.send;
    docClient.send = async (cmd) => {
        if (cmd.constructor.name === 'TransactWriteCommand') {
            const u = cmd.input.TransactItems[0].Update;
            if (u?.UpdateExpression?.includes('prorroga')) u.ExpressionAttributeValues[':ahora'] = '2026-11-05T00:00:00.000Z';
        }
        return enviar(cmd);
    };
    const res = await pedir('POST', `/gobernanza/solicitudes/${solicitudId}/prorroga`, { comunicadaEl: '2026-10-20T10:00:00Z', motivo: 'Faltan antecedentes de tres obras' }, { ahora: new Date('2026-10-20T11:00:00Z') });
    docClient.send = enviar;
    assert.equal(res.statusCode, 409);
});

test('la prórroga se usa una sola vez', async () => {
    const { solicitudId } = datos(await pedir('POST', '/gobernanza/solicitudes', SOLICITUD()));
    const opts = { ahora: new Date('2026-10-20T11:00:00Z') };
    const cuerpo = { comunicadaEl: '2026-10-20T10:00:00Z', motivo: 'Faltan antecedentes de tres obras' };
    assert.equal((await pedir('POST', `/gobernanza/solicitudes/${solicitudId}/prorroga`, cuerpo, opts)).statusCode, 200);
    assert.equal((await pedir('POST', `/gobernanza/solicitudes/${solicitudId}/prorroga`, cuerpo, opts)).statusCode, 409);
});

// ─── Respuesta y desbloqueo ─────────────────────────────────────────────────

test('responder una oposición la cierra y levanta el bloqueo', async () => {
    const { solicitudId } = datos(await pedir('POST', '/gobernanza/solicitudes', { ...SOLICITUD(), derecho: 'oposicion' }));
    const res = await pedir('POST', `/gobernanza/solicitudes/${solicitudId}/respuesta`, { resultado: 'rechazada', fundamento: 'El tratamiento es exigido por el DS 44; se explicó al titular por escrito.' });
    assert.equal(res.statusCode, 200, res.body);
    assert.ok(!('solicitudesBloqueo' in fichaTitular()), 'desbloqueada');
    assert.ok(historial().some((h) => h.tipo === 'desbloqueo'));
});

test('una supresión acogida mantiene el bloqueo hasta que se ejecute', async () => {
    const { solicitudId } = datos(await pedir('POST', '/gobernanza/solicitudes', SOLICITUD()));
    await pedir('POST', `/gobernanza/solicitudes/${solicitudId}/respuesta`, { resultado: 'acogida', fundamento: 'Se suprimirán los datos de conveniencia en el próximo lote aprobado.' });
    assert.ok(fichaTitular().solicitudesBloqueo.has(solicitudId));
});

test('con dos solicitudes abiertas, responder una no desbloquea: sigue bloqueada por la otra', async () => {
    const a = datos(await pedir('POST', '/gobernanza/solicitudes', { ...SOLICITUD(), derecho: 'oposicion' }));
    const b = datos(await pedir('POST', '/gobernanza/solicitudes', { ...SOLICITUD(), derecho: 'rectificacion' }));
    await pedir('POST', `/gobernanza/solicitudes/${a.solicitudId}/respuesta`, { resultado: 'rechazada', fundamento: 'El tratamiento es exigido por el DS 44; se explicó al titular.' });
    assert.deepEqual([...fichaTitular().solicitudesBloqueo], [b.solicitudId]);
});

test('responder dos veces: la segunda se rechaza y no deja otro evento', async () => {
    const { solicitudId } = datos(await pedir('POST', '/gobernanza/solicitudes', { ...SOLICITUD(), derecho: 'acceso' }));
    const cuerpo = { resultado: 'acogida', fundamento: 'Se entregó copia de sus datos por correo.' };
    assert.equal((await pedir('POST', `/gobernanza/solicitudes/${solicitudId}/respuesta`, cuerpo)).statusCode, 200);
    const antes = historial().length;
    assert.equal((await pedir('POST', `/gobernanza/solicitudes/${solicitudId}/respuesta`, cuerpo)).statusCode, 409);
    assert.equal(historial().length, antes);
});

test('el detalle trae la solicitud con su historial completo, en orden', async () => {
    const { solicitudId } = datos(await pedir('POST', '/gobernanza/solicitudes', SOLICITUD()));
    const d = datos(await pedir('GET', `/gobernanza/solicitudes/${solicitudId}`));
    assert.deepEqual(d.historial.map((h) => h.tipo), ['solicitud', 'bloqueo']);
    assert.equal(d.plazoVigente.slice(0, 10), '2026-11-04');
});

// ─── Avisos ─────────────────────────────────────────────────────────────────

test('el aviso diario avisa a quien tiene el permiso, queda en el historial y no se repite el mismo día', async () => {
    await pedir('POST', '/gobernanza/solicitudes', SOLICITUD());
    const ahora = new Date('2026-11-01T12:00:00Z');   // faltan 3 días
    const r1 = await derechos.alertasDiarias({ ahora });
    assert.equal(r1.avisos, 2, 'por vencer + prórroga todavía posible');
    const mensajes = doble.items('INBOX_TABLE');
    assert.ok(mensajes.length >= 2 && mensajes.every((m) => m.recipientId === admin.personaId));
    assert.equal(historial().filter((h) => h.tipo === 'alerta').length, 2);
    const enBandeja = doble.items('INBOX_TABLE').length;
    const r2 = await derechos.alertasDiarias({ ahora });
    assert.equal(r2.avisos, 0, 'el mismo día no se repite');
    assert.equal(r2.fallidos, 0, 'no se repite porque ya se avisó, no porque falló');
    assert.equal(doble.items('INBOX_TABLE').length, enBandeja, 'ningún mensaje repetido');
});

test('si el bloqueo no se puede aplicar, no queda ni la solicitud ni su historial: todo o nada', async () => {
    // La ficha se leyó, pero desaparece antes de escribir: la condición del bloqueo falla.
    const original = PersonaService.prototype.getById;
    PersonaService.prototype.getById = async function (id) {
        const p = await original.call(this, id);
        if (id === titular.personaId) doble.tablas.PERSONAS_TABLE.delete(JSON.stringify([`TENANT#${T}`, `PERSONA#${id}`]));
        return p;
    };
    try {
        const res = await pedir('POST', '/gobernanza/solicitudes', SOLICITUD());
        assert.equal(res.statusCode, 409);
    } finally { PersonaService.prototype.getById = original; }
    assert.equal(doble.items('GOBERNANZA_TABLE').length, 0, 'sin solicitud');
    assert.equal(historial().length, 0, 'sin historial');
});

test('si otra persona responde entre la lectura y la escritura, la segunda respuesta no procede', async () => {
    const { solicitudId } = datos(await pedir('POST', '/gobernanza/solicitudes', { ...SOLICITUD(), derecho: 'acceso' }));
    const enviar = docClient.send;
    docClient.send = async (cmd) => {
        const r = await enviar(cmd);
        if (cmd.constructor.name === 'GetCommand' && cmd.input.Key?.sk === `SOLICITUD#${solicitudId}`) {
            // Justo después de leerla abierta, alguien más la cierra.
            const it = doble.tablas.GOBERNANZA_TABLE.get(JSON.stringify([T, `SOLICITUD#${solicitudId}`]));
            it.estado = 'resuelta';
        }
        return r;
    };
    const antes = historial().length;
    const res = await pedir('POST', `/gobernanza/solicitudes/${solicitudId}/respuesta`, { resultado: 'acogida', fundamento: 'Se entregó copia de sus datos por correo.' });
    docClient.send = enviar;
    assert.equal(res.statusCode, 409);
    assert.equal(historial().length, antes, 'sin evento de una respuesta que no ocurrió');
});
