// Lotes de supresión: quien aprueba ve exactamente qué se suprime, se ejecuta
// exactamente lo aprobado, y lo hacen dos personas distintas.

process.env.CAMPO_HMAC_KEY = 'clave-de-prueba-hmac';
process.env.CAMPO_CIFRADO_LOCAL_KEY = require('crypto').randomBytes(32).toString('base64');
process.env.CREDENCIAL_PEPPER = 'pimienta-de-prueba';

const { prepararEntorno, crearDobleTablas } = require('./doble-dynamo-tablas');
const esquemas = prepararEntorno();
process.env.EVIDENCIA_BUCKET = 'evidencia-prueba';
process.env.TRABAJO_BUCKET = 'trabajo-prueba';

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { PutCommand } = require('@aws-sdk/lib-dynamodb');

const { docClient } = require('../lib/clients/dynamodb');
const { s3Client } = require('../lib/clients/s3');
const { PersonaService } = require('../lib/services/PersonaService');
const { TenantService } = require('../lib/services/TenantService');
const derechos = require('../handlers/gobernanza/derechos');
const lotes = require('../handlers/gobernanza/lotes');

let doble;
let versiones;   // key → [{VersionId}] en S3
let borradas;
let originalS3;
let T;
let ana;         // aprueba
let luis;        // ejecuta
let juan;        // titular

const AHORA = new Date('2026-10-07T15:00:00Z');

beforeEach(async () => {
    doble = crearDobleTablas(docClient, esquemas);
    versiones = new Map();
    borradas = [];
    originalS3 = s3Client.send;
    s3Client.send = async (cmd) => {
        const n = cmd.constructor.name;
        const i = cmd.input;
        if (n === 'ListObjectVersionsCommand') {
            const vs = [...versiones.entries()].filter(([k]) => k.startsWith(i.Prefix)).flatMap(([Key, lista]) => lista.map((VersionId) => ({ Key, VersionId })));
            return { Versions: vs, IsTruncated: false };
        }
        if (n === 'DeleteObjectCommand') {
            assert.equal(i.BypassGovernanceRetention, true, 'la evidencia está bloqueada: sin bypass no se borra');
            borradas.push(`${i.Key}@${i.VersionId}`);
            versiones.set(i.Key, (versiones.get(i.Key) || []).filter((v) => v !== i.VersionId));
            return {};
        }
        throw new Error(`S3 no simulado: ${n}`);
    };
    const tenant = await new TenantService().setup({ nombre: 'Constructora Prueba', rutEmpresa: '76.543.210-3' });
    T = tenant.tenantId;
    const svc = new PersonaService();
    ana = (await svc.crear(T, { rut: '9.876.543-3', nombre: 'Ana', apellidoPaterno: 'Rojas', rol: 'admin', email: 'ana@ejemplo.cl', password: 'clave-larga-1' })).persona;
    luis = (await svc.crear(T, { rut: '11.111.111-1', nombre: 'Luis', apellidoPaterno: 'Vera', rol: 'admin', email: 'luis@ejemplo.cl', password: 'clave-larga-2' })).persona;
    juan = (await svc.crear(T, { rut: '12.345.678-5', nombre: 'Juan', rol: 'trabajador', telefono: '912345678', contactoEmergencia: { nombre: 'María', telefono: '9 1111 2222', relacion: 'esposa' } })).persona;
});
afterEach(() => { doble.restaurar(); s3Client.send = originalS3; });

const PERMISOS = 'empresa.derechos_titulares,empresa.supresion_datos';
const evento = (quien, metodo, ruta, cuerpo, permisos = PERMISOS) => ({
    requestContext: { http: { method: metodo }, authorizer: { lambda: { sessionId: 's', personaId: quien.personaId, tenantId: T, rol: 'admin', permisos } } },
    rawPath: ruta, body: cuerpo ? JSON.stringify(cuerpo) : undefined, queryStringParameters: {},
});
const lote = (quien, metodo, ruta, cuerpo, opts = {}) => lotes.atender(evento(quien, metodo, ruta, cuerpo, opts.permisos), { ahora: opts.ahora || AHORA });
const datos = (r) => JSON.parse(r.body).data;
const ficha = (p) => doble.items('PERSONAS_TABLE').find((x) => x.personaId === p.personaId);
const poner = (env, item) => docClient.send(new PutCommand({ TableName: env, Item: item }));

/** Solicitud de supresión de Juan, respondida y acogida (queda bloqueado). */
async function supresionAcogida() {
    await poner('INBOX_TABLE', { recipientId: juan.personaId, messageId: 'm1', senderId: 'system', createdAt: '2026-01-01' });
    const s = datos(await derechos.atender(evento(ana, 'POST', '/gobernanza/solicitudes', { personaId: juan.personaId, derecho: 'supresion', canal: 'correo', recibidaEl: '2026-10-05T12:00:00Z' }), { ahora: AHORA }));
    await derechos.atender(evento(ana, 'POST', `/gobernanza/solicitudes/${s.solicitudId}/respuesta`, { resultado: 'acogida_parcial', fundamento: 'Se suprimen los datos de conveniencia; la evidencia se conserva por el DS 44.' }), { ahora: AHORA });
    return s.solicitudId;
}

// ─── Proponer: el contenido exacto ─────────────────────────────────────────

test('el lote de una supresión acogida trae exactamente lo de conveniencia: campos de la ficha y su bandeja', async () => {
    const solicitudId = await supresionAcogida();
    const r = await lote(ana, 'POST', '/gobernanza/lotes', { origen: 'solicitud', solicitudId });
    assert.equal(r.statusCode, 201, r.body);
    const l = datos(r);
    assert.deepEqual(l.contenido.operaciones.map((o) => `${o.tabla}:${o.accion}`), ['INBOX_TABLE:suprimir', 'PERSONAS_TABLE:quitar_campos']);
    assert.deepEqual(l.contenido.operaciones.find((o) => o.accion === 'quitar_campos').campos, ['contactoEmergencia', 'telefono']);
    assert.match(l.huella, /^[0-9a-f]{64}$/);
    assert.equal(l.estado, 'propuesto');
});

test('una solicitud no acogida (o que no es de supresión) no genera lote', async () => {
    const s = datos(await derechos.atender(evento(ana, 'POST', '/gobernanza/solicitudes', { personaId: juan.personaId, derecho: 'supresion', canal: 'correo', recibidaEl: '2026-10-05T12:00:00Z' }), { ahora: AHORA }));
    const r = await lote(ana, 'POST', '/gobernanza/lotes', { origen: 'solicitud', solicitudId: s.solicitudId });
    assert.equal(r.statusCode, 409, 'todavía abierta');
});

test('sin el permiso de supresión no se propone, aprueba ni ejecuta nada', async () => {
    const r = await lote(ana, 'POST', '/gobernanza/lotes', { origen: 'retencion' }, { permisos: 'empresa.derechos_titulares' });
    assert.equal(r.statusCode, 403);
});

// ─── Aprobar lo que se vio ──────────────────────────────────────────────────

test('aprobar exige la huella de lo que se vio', async () => {
    const solicitudId = await supresionAcogida();
    const l = datos(await lote(ana, 'POST', '/gobernanza/lotes', { origen: 'solicitud', solicitudId }));
    assert.equal((await lote(ana, 'POST', `/gobernanza/lotes/${l.loteId}/aprobar`, { huella: 'otra' })).statusCode, 409);
    assert.equal((await lote(ana, 'POST', `/gobernanza/lotes/${l.loteId}/aprobar`, { huella: l.huella })).statusCode, 200);
});

test('si los datos cambian entre proponer y aprobar, el lote queda desactualizado y hay que proponerlo de nuevo', async () => {
    const solicitudId = await supresionAcogida();
    const l = datos(await lote(ana, 'POST', '/gobernanza/lotes', { origen: 'solicitud', solicitudId }));
    await poner('INBOX_TABLE', { recipientId: juan.personaId, messageId: 'm2', senderId: 'system', createdAt: '2026-10-06' });
    const r = await lote(ana, 'POST', `/gobernanza/lotes/${l.loteId}/aprobar`, { huella: l.huella });
    assert.equal(r.statusCode, 409);
    assert.match(JSON.parse(r.body).error, /proponerlo y aprobarlo de nuevo/);
    assert.equal(doble.items('GOBERNANZA_TABLE').find((x) => x.loteId === l.loteId).estado, 'desactualizado');
});

// ─── Ejecutar lo aprobado, otra persona ─────────────────────────────────────

test('quien aprobó no puede ejecutar: son dos personas', async () => {
    const solicitudId = await supresionAcogida();
    const l = datos(await lote(ana, 'POST', '/gobernanza/lotes', { origen: 'solicitud', solicitudId }));
    await lote(ana, 'POST', `/gobernanza/lotes/${l.loteId}/aprobar`, { huella: l.huella });
    const r = await lote(ana, 'POST', `/gobernanza/lotes/${l.loteId}/ejecutar`, { huella: l.huella });
    assert.equal(r.statusCode, 403);
    assert.ok(ficha(juan).telefono, 'nada se suprimió');
});

test('si los datos cambian entre aprobar y ejecutar, no se ejecuta nada y hay que aprobar de nuevo', async () => {
    const solicitudId = await supresionAcogida();
    const l = datos(await lote(ana, 'POST', '/gobernanza/lotes', { origen: 'solicitud', solicitudId }));
    await lote(ana, 'POST', `/gobernanza/lotes/${l.loteId}/aprobar`, { huella: l.huella });
    await poner('INBOX_TABLE', { recipientId: juan.personaId, messageId: 'm3', senderId: 'system', createdAt: '2026-10-06' });
    const r = await lote(luis, 'POST', `/gobernanza/lotes/${l.loteId}/ejecutar`, { huella: l.huella });
    assert.equal(r.statusCode, 409);
    assert.ok(ficha(juan).telefono, 'nada se suprimió');
    assert.equal(doble.items('INBOX_TABLE').filter((m) => m.recipientId === juan.personaId).length, 2);
});

test('otra persona ejecuta exactamente lo aprobado: se suprime, se registra y se levanta el bloqueo', async () => {
    const solicitudId = await supresionAcogida();
    const l = datos(await lote(ana, 'POST', '/gobernanza/lotes', { origen: 'solicitud', solicitudId }));
    await lote(ana, 'POST', `/gobernanza/lotes/${l.loteId}/aprobar`, { huella: l.huella });
    const r = await lote(luis, 'POST', `/gobernanza/lotes/${l.loteId}/ejecutar`, { huella: l.huella });
    assert.equal(r.statusCode, 200, r.body);
    const f = ficha(juan);
    assert.ok(!('telefono' in f) && !('contactoEmergencia' in f), 'campos de conveniencia fuera');
    assert.ok(f.rutCifrado && f.nombre, 'la evidencia (RUT, nombre) se conserva');
    assert.ok(!('solicitudesBloqueo' in f), 'bloqueo levantado');
    assert.equal(doble.items('INBOX_TABLE').filter((m) => m.recipientId === juan.personaId).length, 0);
    const hist = doble.items('GOBERNANZA_HISTORIAL_TABLE').filter((h) => h.solicitudId === solicitudId).map((h) => h.tipo);
    assert.ok(hist.includes('supresion') && hist.includes('desbloqueo'));
    const ev = doble.items('GOBERNANZA_HISTORIAL_TABLE').find((h) => h.tipo === 'supresion');
    assert.equal(ev.datos.huella, l.huella, 'el historial guarda qué contenido exacto se ejecutó');
    assert.equal(ev.datos.aprobadoPor.personaId, ana.personaId);
    assert.equal(ev.por.personaId, luis.personaId);
    assert.equal((await lote(luis, 'POST', `/gobernanza/lotes/${l.loteId}/ejecutar`, { huella: l.huella })).statusCode, 409, 'no se ejecuta dos veces');
});

// ─── Retención: filas, trazas y todas las versiones del archivo ─────────────

test('un lote de retención borra filas, su traza sensible y TODAS las versiones de cada archivo, con bypass', async () => {
    const venc = (await new PersonaService().crear(T, { rut: '13.131.313-6', nombre: 'Pedro', rol: 'trabajador' })).persona;
    const it = doble.items('PERSONAS_TABLE').find((x) => x.personaId === venc.personaId);
    await poner('PERSONAS_TABLE', { ...it, estado: 'desvinculado', fechaTerminoVinculo: '2020-01-01T00:00:00Z' });
    await poner('SIGNATURES_TABLE', { signatureId: 's1', tenantId: T, personaId: venc.personaId, documentosFirmados: [{ url: `tenants/${T}/documentos/a.pdf` }] });
    await poner('SIGNATURES_TABLE', { signatureId: 's1#traza', cifrado: { c: 'x' } });
    versiones.set(`tenants/${T}/documentos/a.pdf`, ['v1', 'v2']);
    versiones.set(`tenants/otra/documentos/a.pdf`, ['v9']);

    const l = datos(await lote(ana, 'POST', '/gobernanza/lotes', { origen: 'retencion' }, { ahora: new Date('2026-10-07T15:00:00Z') }));
    assert.deepEqual(l.contenido.archivos, [{ key: `tenants/${T}/documentos/a.pdf`, versiones: ['v1', 'v2'] }]);
    await lote(ana, 'POST', `/gobernanza/lotes/${l.loteId}/aprobar`, { huella: l.huella });
    const r = await lote(luis, 'POST', `/gobernanza/lotes/${l.loteId}/ejecutar`, { huella: l.huella });
    assert.equal(r.statusCode, 200, r.body);
    assert.deepEqual(borradas.sort(), [`tenants/${T}/documentos/a.pdf@v1`, `tenants/${T}/documentos/a.pdf@v2`]);
    assert.ok(!doble.items('SIGNATURES_TABLE').some((x) => x.signatureId === 's1' || x.signatureId === 's1#traza'), 'firma y traza fuera');
    assert.ok(!ficha(venc), 'la ficha vencida fuera');
    assert.ok(ficha(juan) && ficha(ana), 'nadie más tocado');
    assert.deepEqual(versiones.get('tenants/otra/documentos/a.pdf'), ['v9'], 'otra empresa intacta');
});

test('una versión nueva del archivo entre aprobar y ejecutar obliga a aprobar de nuevo', async () => {
    const venc = (await new PersonaService().crear(T, { rut: '13.131.313-6', nombre: 'Pedro', rol: 'trabajador' })).persona;
    const it = doble.items('PERSONAS_TABLE').find((x) => x.personaId === venc.personaId);
    await poner('PERSONAS_TABLE', { ...it, estado: 'desvinculado', fechaTerminoVinculo: '2020-01-01T00:00:00Z' });
    await poner('SIGNATURES_TABLE', { signatureId: 's1', tenantId: T, personaId: venc.personaId, documentosFirmados: [{ url: `tenants/${T}/documentos/a.pdf` }] });
    versiones.set(`tenants/${T}/documentos/a.pdf`, ['v1']);
    const l = datos(await lote(ana, 'POST', '/gobernanza/lotes', { origen: 'retencion' }));
    await lote(ana, 'POST', `/gobernanza/lotes/${l.loteId}/aprobar`, { huella: l.huella });
    versiones.set(`tenants/${T}/documentos/a.pdf`, ['v1', 'v2']);
    assert.equal((await lote(luis, 'POST', `/gobernanza/lotes/${l.loteId}/ejecutar`, { huella: l.huella })).statusCode, 409);
    assert.deepEqual(borradas, []);
});

test('el detalle dice qué es cada operación y si el lote sigue vigente', async () => {
    const solicitudId = await supresionAcogida();
    const l = datos(await lote(ana, 'POST', '/gobernanza/lotes', { origen: 'solicitud', solicitudId }));
    const d = datos(await lote(luis, 'GET', `/gobernanza/lotes/${l.loteId}`));
    assert.equal(d.vigente, true);
    assert.deepEqual(d.contenido.operaciones.map((o) => o.que), ['Bandeja de mensajes', 'Ficha de la persona']);
});

// ─── Carreras y alteraciones ────────────────────────────────────────────────

/** Aprueba (Ana) y devuelve el lote, listo para ejecutar. */
async function aprobado() {
    const solicitudId = await supresionAcogida();
    const l = datos(await lote(ana, 'POST', '/gobernanza/lotes', { origen: 'solicitud', solicitudId }));
    await lote(ana, 'POST', `/gobernanza/lotes/${l.loteId}/aprobar`, { huella: l.huella });
    return l;
}
const itemLote = (l) => doble.tablas.GOBERNANZA_TABLE.get(JSON.stringify([T, `LOTE#${l.loteId}`]));

/** Justo después de leer el lote, cambia algo en la tabla (lo que haría otra petición a la vez). */
function trasLeerLote(l, cambio) {
    const enviar = docClient.send;
    let hecho = false;
    docClient.send = async (cmd) => {
        const r = await enviar(cmd);
        if (!hecho && cmd.constructor.name === 'GetCommand' && cmd.input.Key?.sk === `LOTE#${l.loteId}`) { hecho = true; cambio(itemLote(l)); }
        return r;
    };
    return () => { docClient.send = enviar; };
}

test('un contenido alterado en la tabla, con la huella original, no se ejecuta', async () => {
    const l = await aprobado();
    const it = itemLote(l);
    it.contenido = { ...it.contenido, operaciones: [...it.contenido.operaciones, { tabla: 'PERSONAS_TABLE', clave: { PK: `TENANT#${T}`, SK: `PERSONA#${ana.personaId}` }, accion: 'suprimir' }] };
    const r = await lote(luis, 'POST', `/gobernanza/lotes/${l.loteId}/ejecutar`, { huella: l.huella });
    assert.equal(r.statusCode, 409);
    assert.ok(ficha(ana), 'Ana sigue ahí');
    assert.ok(ficha(juan).telefono, 'nada se ejecutó');
});

test('si otra ejecución empieza entre la lectura y la escritura, esta no procede', async () => {
    const l = await aprobado();
    const soltar = trasLeerLote(l, (it) => { it.estado = 'ejecutando'; });
    const r = await lote(luis, 'POST', `/gobernanza/lotes/${l.loteId}/ejecutar`, { huella: l.huella });
    soltar();
    assert.equal(r.statusCode, 409);
    assert.ok(ficha(juan).telefono, 'no se ejecutó dos veces');
});

test('si el lote pasa a estar aprobado por quien ejecuta, la escritura lo rechaza', async () => {
    const l = await aprobado();
    const soltar = trasLeerLote(l, (it) => { it.aprobadoPor = { personaId: luis.personaId }; });
    const r = await lote(luis, 'POST', `/gobernanza/lotes/${l.loteId}/ejecutar`, { huella: l.huella });
    soltar();
    assert.equal(r.statusCode, 409);
    assert.ok(ficha(juan).telefono);
});
