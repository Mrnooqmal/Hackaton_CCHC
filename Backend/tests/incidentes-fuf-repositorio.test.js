// Fase 4 del rediseño de incidentes: enlace con el FUF y el repositorio, y los
// tres arreglos que dejó la fase 3.
//
//   - `GET /incidents/casos-resumen`: los casos de una obra sin datos personales ni
//     archivos, para el repositorio de la obra.
//   - Ítem 66 del FUF (investigación de accidentes): además del procedimiento mira
//     los accidentes de la obra y cuántos siguen sin informe de investigación.
//   - `calificar-accidente` actualiza la clasificación guardada; `PUT /incidents/{id}`
//     no acepta `evidencias`; el plazo de una medida y la fecha de un papel se
//     comparan con el día de Chile, no con el de UTC.

process.env.CAMPO_HMAC_KEY = 'clave-de-prueba-hmac';
process.env.CAMPO_CIFRADO_LOCAL_KEY = require('crypto').randomBytes(32).toString('base64');
process.env.CREDENCIAL_PEPPER = 'pimienta-de-prueba';
process.env.EVIDENCIA_BUCKET = process.env.EVIDENCIA_BUCKET || 'evidencia-de-prueba';
process.env.AWS_REGION = process.env.AWS_REGION || 'us-east-1';
process.env.AWS_ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID || 'PRUEBA_SIN_AWS';
process.env.AWS_SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY || 'PRUEBA_SIN_AWS';

const { prepararEntorno, crearDobleTablas } = require('./doble-dynamo-tablas');
const esquemas = prepararEntorno();

const { test, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const { DynamoDBDocumentClient, PutCommand } = require('@aws-sdk/lib-dynamodb');

const { docClient } = require('../lib/clients/dynamodb');
const { s3Client } = require('../lib/clients/s3');
const { PersonaService } = require('../lib/services/PersonaService');
const { TenantService } = require('../lib/services/TenantService');
const { ObraService } = require('../lib/services/ObraService');
const { eventBus } = require('../lib/events/EventBus');
const C = require('../lib/completitud');
const { definicionesOperacionPara, evaluarItem66 } = require('../lib/completitud-operacion');
const { definicionesDocumentalesPara } = require('../lib/completitud-documental');
const { definicionesPara } = require('../lib/completitud-estructura');
const { resumenDelCaso } = require('../lib/casos');
const incidentes = require('../handlers/incidents-module/handler');
const estructura = require('../handlers/estructura-module/handler');

let doble; let emitir; let consola; let enviarS3; let objetos;
let A; let B; let obraA; let obraA2; let obraB;
let gestora; let prevencionista; let trabajadora; let ajena;

beforeEach(async () => {
    doble = crearDobleTablas(DynamoDBDocumentClient.prototype, esquemas, { proyecciones: true });
    emitir = eventBus.emit;
    eventBus.emit = async () => {};
    consola = { log: console.log, error: console.error, warn: console.warn };
    console.log = () => {}; console.error = () => {}; console.warn = () => {};

    // S3: solo HeadObject, con lo que la prueba haya "subido".
    objetos = new Map();
    enviarS3 = s3Client.send;
    s3Client.send = async function simulado(cmd) {
        if (cmd.constructor.name === 'HeadObjectCommand') {
            if (!objetos.has(cmd.input.Key)) throw Object.assign(new Error('NotFound'), { name: 'NotFound', $metadata: { httpStatusCode: 404 } });
            return objetos.get(cmd.input.Key);
        }
        return enviarS3.call(s3Client, cmd);
    };

    A = (await new TenantService().setup({ nombre: 'Constructora A', rutEmpresa: '76.543.210-3' })).tenantId;
    B = (await new TenantService().setup({ nombre: 'Constructora B', rutEmpresa: '77.777.777-7' })).tenantId;
    obraA = (await new ObraService().crear(A, { nombre: 'Edificio Los Robles' })).obraId;
    obraA2 = (await new ObraService().crear(A, { nombre: 'Bodega Lampa' })).obraId;
    obraB = (await new ObraService().crear(B, { nombre: 'Obra de B' })).obraId;
    const svc = new PersonaService();
    gestora = (await svc.crear(A, { rut: '12.345.678-5', nombre: 'Sara', rol: 'supervisor' })).persona.personaId;
    prevencionista = (await svc.crear(A, { rut: '9.876.543-3', nombre: 'Pedro', rol: 'prevencionista' })).persona.personaId;
    trabajadora = (await svc.crear(A, { rut: '11.111.111-1', nombre: 'Rosa', rol: 'trabajador' })).persona.personaId;
    ajena = (await svc.crear(B, { rut: '22.222.222-2', nombre: 'Otra', rol: 'supervisor' })).persona.personaId;
    for (const p of [gestora, prevencionista, ajena]) {
        doble.items('PERSONAS_TABLE').find((x) => x.personaId === p).estado = 'activo';
    }
});
afterEach(() => {
    mock.restoreAll();
    s3Client.send = enviarS3;
    doble.restaurar();
    eventBus.emit = emitir;
    Object.assign(console, consola);
});

const GESTION = 'incidentes.reportar,incidentes.historial';
const PREVENCION = 'incidentes.reportar,incidentes.historial,incidentes.calificar_accidente';
const SOLO_REPORTAR = 'incidentes.reportar';
const SOLO_HISTORIAL = 'incidentes.historial';
const TRABAJADOR = 'actividades.ver';
const HUELLA = Buffer.alloc(32, 7).toString('base64');

const sesion = (quien) => ({
    authorizer: { lambda: { sessionId: 's', personaId: quien.personaId, tenantId: quien.tenantId, rol: 'x', permisos: quien.permisos, credencialProvisional: 'false' } },
});
const pedir = (quien, metodo, ruta, body, query = null) => incidentes.incidentsHandler({
    rawPath: ruta, rawQueryString: query ? new URLSearchParams(query).toString() : '', headers: { host: 'api.test' }, queryStringParameters: query,
    body: body === undefined ? undefined : JSON.stringify(body),
    requestContext: { http: { method: metodo, path: ruta, sourceIp: '200.1.2.3' }, ...sesion(quien) },
});
const como = (personaId, permisos, tenantId = A) => ({ personaId, permisos, tenantId });
const gest = () => como(gestora, GESTION);
const prev = () => como(prevencionista, PREVENCION);
const datos = (res) => JSON.parse(res.body).data;
const guardado = (id) => doble.items('INCIDENTS_TABLE').find((i) => i.incidentId === id);
const resumen = (quien, obraId) => pedir(quien, 'GET', '/incidents/casos-resumen', undefined, obraId === undefined ? null : { obraId });

const RELATO = 'Se cayó Juan Pérez desde el andamio del piso 4';
const crear = async (extra = {}, quien = gest()) => {
    const res = await pedir(quien, 'POST', '/incidents', {
        tipo: 'accidente', gravedad: 'grave', descripcion: RELATO, obraId: obraA, centroTrabajo: 'Torre A',
        trabajador: { nombre: 'Juan Pérez', rut: '17.777.777-3' }, ...extra,
    });
    assert.equal(res.statusCode, 201, res.body);
    return datos(res).incidentId;
};
const papel = (tipo) => ({ papelId: `p-${tipo}`, tipo, nombreArchivo: `${tipo}-de-Juan-Perez.pdf`, s3Key: `tenants/${A}/incidentes/x/papeles/${tipo}-x.pdf` });

// ─── GET /incidents/casos-resumen ────────────────────────────────────────────

test('resumen: por cada caso de la obra entrega tipo, gravedad, fecha, estado, avance, papeles y si hay informe', async () => {
    const id = await crear({ fecha: '2026-11-10' });
    guardado(id).papeles = [papel('diat')];
    const res = await resumen(gest(), obraA);
    assert.equal(res.statusCode, 200, res.body);
    const lista = datos(res);
    assert.equal(lista.length, 1);
    const [c] = lista;
    assert.equal(c.incidentId, id);
    assert.equal(c.tipo, 'accidente');
    assert.equal(c.clasificacion, 'incidente');
    assert.equal(c.gravedad, 'grave');
    assert.equal(c.fecha, '2026-11-10');
    assert.equal(c.estado, 'abierto');
    assert.equal(c.clasificado, false);
    assert.equal(c.informeInvestigacion, false);
    // Accidente grave: DIAT, informe, medida correctiva y constancia; solo la DIAT está.
    assert.deepEqual(c.requeridos.map((p) => [p.clave, p.cumplido]), [
        ['diat', true], ['informe_investigacion', false], ['medida_correctiva', false], ['constancia_aviso_autoridad', false],
    ]);
    assert.deepEqual(c.avance, { cumplidos: 1, total: 4, porcentaje: 25 });
    assert.equal(JSON.parse(res.body).total, 1);
});

test('resumen: un caso cerrado sale como cerrado y un informe subido se refleja', async () => {
    const id = await crear({ gravedad: 'leve' });
    const g = guardado(id);
    g.papeles = [papel('informe_investigacion')];
    g.estado = 'cerrado';
    const [c] = datos(await resumen(gest(), obraA));
    assert.equal(c.estado, 'cerrado');
    assert.equal(c.informeInvestigacion, true);
});

test('resumen: no trae nombres, RUT, relato, papeles, nombres de archivo ni claves de S3', async () => {
    const id = await crear();
    guardado(id).papeles = [papel('diat'), papel('informe_investigacion')];
    guardado(id).evidencias = [`tenants/${A}/incidentes/${id}/0b6f1c2e-3d4a-4b5c-8d9e-0f1a2b3c4d5e.jpg`];
    const res = await resumen(gest(), obraA);
    for (const prohibido of ['Juan', 'Pérez', 'Perez', '17.777', RELATO, 'Torre A', 'papeles', 'nombreArchivo', 's3Key', 'tenants/', '.pdf', 'evidencias', 'descripcion', 'trabajador', 'reportadoPor', 'huella']) {
        assert.ok(!res.body.includes(prohibido), `no debe contener «${prohibido}»`);
    }
    assert.deepEqual(Object.keys(datos(res)[0]).sort(), [
        'avance', 'clasificacion', 'clasificado', 'estado', 'fecha', 'gravedad', 'incidentId', 'informeInvestigacion', 'requeridos', 'tipo',
    ]);
    for (const p of datos(res)[0].requeridos) assert.deepEqual(Object.keys(p).sort(), ['cumplido', 'clave', 'etiqueta'].sort());
});

test('resumen: filtra por obra y deja fuera los casos de otra empresa', async () => {
    const enA = await crear();
    const enA2 = await crear({ obraId: obraA2 });
    // Un caso de otra empresa que (por error o a propósito) apunta a la obra de A.
    await docClient.send(new PutCommand({ TableName: 'INCIDENTS_TABLE', Item: {
        incidentId: 'ajeno-1', tenantId: B, obraId: obraA, tipo: 'accidente', gravedad: 'fatal', fecha: '2026-11-01', estado: 'reportado',
    } }));
    const deB = await crear({ obraId: obraB }, como(ajena, GESTION, B));

    const idsA = datos(await resumen(gest(), obraA)).map((c) => c.incidentId);
    assert.deepEqual(idsA, [enA]);
    assert.deepEqual(datos(await resumen(gest(), obraA2)).map((c) => c.incidentId), [enA2]);
    assert.deepEqual(datos(await resumen(como(ajena, GESTION, B), obraB)).map((c) => c.incidentId), [deB]);
});

test('resumen: una obra de otra empresa responde 404, igual que si no existiera', async () => {
    await crear();
    const ajeno = await resumen(gest(), obraB);
    assert.equal(ajeno.statusCode, 404);
    const inexistente = await resumen(gest(), 'obra-que-no-existe');
    assert.equal(inexistente.statusCode, 404);
    assert.equal(ajeno.body, inexistente.body, 'no se distingue "ajena" de "inexistente"');
    // Y desde B no se ve la obra de A.
    assert.equal((await resumen(como(ajena, GESTION, B), obraA)).statusCode, 404);
});

test('resumen: exige incidentes.historial; reportar o ser quien reportó no alcanza', async () => {
    await crear();
    assert.equal((await resumen(como(gestora, SOLO_REPORTAR), obraA)).statusCode, 403);
    assert.equal((await resumen(como(trabajadora, TRABAJADOR), obraA)).statusCode, 403);
    assert.equal((await resumen(como(gestora, SOLO_HISTORIAL), obraA)).statusCode, 200);
    // Sin sesión.
    const sinSesion = await incidentes.incidentsHandler({
        rawPath: '/incidents/casos-resumen', rawQueryString: `obraId=${obraA}`, headers: { host: 'api.test' },
        queryStringParameters: { obraId: obraA }, requestContext: { http: { method: 'GET', path: '/incidents/casos-resumen' } },
    });
    assert.equal(sinSesion.statusCode, 401);
});

test('resumen: obraId es obligatorio, y la ruta no se confunde con un id de incidente', async () => {
    const sin = await resumen(gest(), undefined);
    assert.equal(sin.statusCode, 400);
    const vacio = await resumen(gest(), '');
    assert.equal(vacio.statusCode, 400);
    // Con obra válida es la ruta del resumen (200, una lista), no el detalle de un incidente "casos-resumen" (404).
    const ok = await resumen(gest(), obraA);
    assert.equal(ok.statusCode, 200);
    assert.deepEqual(datos(ok), []);
});

test('resumen: sale ordenado del caso más reciente al más antiguo', async () => {
    const viejo = await crear({ fecha: '2026-01-05' });
    const nuevo = await crear({ fecha: '2026-11-05' });
    assert.deepEqual(datos(await resumen(gest(), obraA)).map((c) => c.incidentId), [nuevo, viejo]);
});

test('resumenDelCaso: un hallazgo no lleva gravedad y un caso sin papeles requeridos no divide por cero', () => {
    const h = resumenDelCaso({ incidentId: 'h', tipo: 'condicion_subestandar', gravedad: 'leve', fecha: '2026-11-01', evidencias: ['k'] });
    assert.equal(h.clasificacion, 'hallazgo');
    assert.equal(h.gravedad, null);
    const i = resumenDelCaso({ incidentId: 'i', tipo: 'incidente', gravedad: 'leve' });
    assert.deepEqual(i.avance, { cumplidos: 0, total: 0, porcentaje: 100 });
    assert.deepEqual(i.requeridos, []);
});

// ─── Ítem 66: el motor ───────────────────────────────────────────────────────

const AHORA = new Date('2026-09-10T12:00:00.000Z');
const { ESTADO_REQUISITO: E } = C;
const doc = (tipo, over = {}) => ({
    documentId: `${tipo}-${Math.random()}`, tipo, s3Key: `${tipo}.pdf`, version: 1,
    createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z', asignaciones: [], ...over,
});
const ctx66 = (over = {}) => ({
    ahora: AHORA, documentos: [doc('PROCEDIMIENTO_INVESTIGACION')], organos: [], obligaciones: {}, actividades: [], obra: {}, ...over,
});
const accidente66 = (informe) => ({ tipo: 'accidente', informeInvestigacion: informe });
const evaluarObra = (c) => C.evaluarCompletitud(
    [...definicionesPara('obra'), ...definicionesDocumentalesPara('obra'), ...definicionesOperacionPara('obra')], c,
).requisitos;
const req = (reqs, item) => reqs.find((r) => r.item === item);

test('ítem 66: con accidentes sin informe queda Parcial y dice cuántos faltan', () => {
    const r = evaluarItem66(ctx66({ casos: [accidente66(false), accidente66(false), accidente66(true)] }));
    assert.equal(r.estado, E.PARCIAL);
    assert.match(r.detalle, /2 accidentes sin informe de investigación/);
    const uno = evaluarItem66(ctx66({ casos: [accidente66(false), accidente66(true)] }));
    assert.match(uno.detalle, /1 accidente sin informe de investigación/);
});

test('ítem 66: si todos los accidentes tienen su informe queda Cumplido', () => {
    const r = evaluarItem66(ctx66({ casos: [accidente66(true), accidente66(true)] }));
    assert.equal(r.estado, E.CUMPLIDO);
    assert.match(r.detalle, /2 accidentes con su informe de investigación/);
});

test('ítem 66: sin accidentes queda Cumplido como siempre; los incidentes y hallazgos no cuentan', () => {
    const base = evaluarItem66(ctx66());
    assert.equal(base.estado, E.CUMPLIDO);
    assert.match(base.detalle, /Sin accidentes investigados/);
    const solo = evaluarItem66(ctx66({ casos: [], documentos: [doc('PROCEDIMIENTO_INVESTIGACION')] }));
    assert.deepEqual(solo, base);
    const otros = evaluarItem66(ctx66({ casos: [
        { tipo: 'incidente', informeInvestigacion: false }, { tipo: 'condicion_subestandar', informeInvestigacion: false },
    ] }));
    assert.equal(otros.estado, E.CUMPLIDO);
});

test('ítem 66: sin procedimiento sigue Pendiente, con o sin accidentes', () => {
    for (const casos of [undefined, [], [accidente66(false)], [accidente66(true)]]) {
        const r = evaluarItem66(ctx66({ documentos: [], casos }));
        assert.equal(r.estado, E.PENDIENTE);
        assert.match(r.detalle, /Sin procedimiento de investigación/);
    }
});

test('ítem 66: las investigaciones del repositorio siguen contando en el detalle', () => {
    const docs = [doc('PROCEDIMIENTO_INVESTIGACION'), doc('INVESTIGACION_ACCIDENTE'), doc('INVESTIGACION_ACCIDENTE')];
    const sinCasos = evaluarItem66(ctx66({ documentos: docs }));
    assert.equal(sinCasos.estado, E.CUMPLIDO);
    assert.match(sinCasos.detalle, /2 investigaciones registradas/);
    const conFaltantes = evaluarItem66(ctx66({ documentos: docs, casos: [accidente66(false)] }));
    assert.equal(conFaltantes.estado, E.PARCIAL);
    assert.match(conFaltantes.detalle, /2 investigaciones registradas/);
    assert.match(conFaltantes.detalle, /1 accidente sin informe/);
});

test('ítem 66: si los casos no se pudieron leer (null) no se da por cumplido', () => {
    const r = evaluarItem66(ctx66({ casos: null }));
    assert.equal(r.estado, E.PARCIAL);
    assert.match(r.detalle, /No se pudieron revisar los accidentes/);
});

test('ítem 66 en el motor completo: Parcial con accidentes sin informe; el ítem 60 sigue contando Parcial como con respaldo', () => {
    const sin = evaluarObra(ctx66({ casos: [accidente66(false)] }));
    assert.equal(req(sin, 66).estado, E.PARCIAL);
    const con = evaluarObra(ctx66({ casos: [accidente66(true)] }));
    assert.equal(req(con, 66).estado, E.CUMPLIDO);
    // El 60 solo cuenta como "sin respaldo" lo Pendiente o Vencido: un 66 Parcial no lo mueve.
    assert.equal(req(sin, 60).estado, req(con, 60).estado);
    assert.equal(req(sin, 60).detalle, req(con, 60).detalle);
});

// ─── Ítem 66: de punta a punta por el módulo de estructura ───────────────────

const completitudDe = (quien, obraId) => estructura.estructuraHandler({
    rawPath: '/estructura/completitud', headers: { host: 'api.test' },
    queryStringParameters: { ambito: 'obra', obraId },
    requestContext: { http: { method: 'GET', path: '/estructura/completitud' }, ...sesion(quien) },
});
const item66 = async (quien, obraId) => {
    const res = await completitudDe(quien, obraId);
    assert.equal(res.statusCode, 200, res.body);
    return { res, r: req(JSON.parse(res.body).data.requisitos, 66) };
};
const ponerProcedimiento = (tenantId, obraId) => docClient.send(new PutCommand({ TableName: 'DOCUMENTS_TABLE', Item: {
    documentId: `proc-${tenantId}-${obraId}`, tenantId, obraId, tipo: 'PROCEDIMIENTO_INVESTIGACION', s3Key: 'p.pdf',
    version: 1, estado: 'activo', clasificacion: 'obra', createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z',
} }));

test('el panel del FUF cuenta los accidentes de la obra sin informe, solo de esa obra y esa empresa, sin datos personales', async () => {
    await ponerProcedimiento(A, obraA);
    const prim = await crear();
    const seg = await crear();
    const tercero = await crear();
    await crear({ obraId: obraA2 });                            // otra obra de A: no cuenta
    await crear({ obraId: obraB }, como(ajena, GESTION, B));    // otra empresa: no cuenta
    await crear({ tipo: 'incidente', gravedad: 'leve' });       // incidente: no cuenta
    guardado(tercero).papeles = [papel('informe_investigacion')];

    let { res, r } = await item66(gest(), obraA);
    assert.equal(r.estado, 'Parcial');
    assert.match(r.detalle, /2 accidentes sin informe de investigación/);
    assert.ok(!res.body.includes('Juan') && !res.body.includes(RELATO) && !res.body.includes(prim), 'ni nombres, ni relato, ni ids de caso');

    guardado(prim).papeles = [papel('informe_investigacion')];
    guardado(seg).papeles = [papel('informe_investigacion')];
    ({ r } = await item66(gest(), obraA));
    assert.equal(r.estado, 'Cumplido');
    assert.match(r.detalle, /3 accidentes con su informe de investigación/);
});

test('el panel del FUF no da por cumplido el ítem 66 si no se pueden leer los casos', async () => {
    await ponerProcedimiento(A, obraA);
    await crear();
    // El doble de DynamoDB vive en el prototipo: se tapa con una propiedad propia de
    // `docClient` y se destapa borrándola (restaurarla con `mock` dejaría una copia
    // del doble de esta prueba pegada a la instancia para las siguientes).
    const delDoble = Object.getPrototypeOf(docClient).send;
    docClient.send = async function (cmd) {
        if (cmd.input?.TableName === 'INCIDENTS_TABLE') throw new Error('DynamoDB no responde');
        return delDoble.call(this, cmd);
    };
    try {
        const { r } = await item66(gest(), obraA);
        assert.equal(r.estado, 'Parcial');
        assert.match(r.detalle, /No se pudieron revisar/);
    } finally {
        delete docClient.send;
    }
});

// ─── Arreglo 1: calificar-accidente actualiza el triaje ──────────────────────

const triaje = (id, body, quien = prev()) => pedir(quien, 'PUT', `/incidents/${id}/triaje`, body);

test('calificar-accidente: si el caso ya estaba clasificado, la clasificación guardada también pasa a accidente y queda la anterior', async () => {
    const id = await crear({ tipo: 'incidente', gravedad: 'leve' });
    assert.equal((await triaje(id, { tipo: 'incidente', gravedad: 'leve', danoMayor: true, granSusto: false })).statusCode, 200);
    assert.equal(guardado(id).altoPotencial, true);

    const res = await pedir(prev(), 'PUT', `/incidents/${id}/calificar-accidente`, {});
    assert.equal(res.statusCode, 200, res.body);
    const g = guardado(id);
    assert.equal(g.tipo, 'accidente');
    assert.equal(g.clasificacion, 'incidente');
    assert.equal(g.triaje.tipo, 'accidente', 'triaje y tipo dicen lo mismo');
    assert.equal(g.triaje.clasificacion, 'incidente');
    assert.equal(g.triaje.gravedad, 'leve');
    assert.equal(g.triaje.danoMayor, null);
    assert.equal(g.altoPotencial, false, 'un accidente no es "de alto potencial"');
    assert.equal(g.triaje.clasificadoPor, prevencionista);
    assert.equal(g.triaje.anteriores.at(-1).tipo, 'incidente', 'la clasificación anterior queda en el historial');
    assert.equal(g.triaje.anteriores.at(-1).danoMayor, true);
    assert.ok(!res.body.includes('"papeles":'));
    // Y lo que depende de tipo/triaje ya exige lo del accidente.
    const [c] = datos(await resumen(gest(), obraA));
    assert.equal(c.tipo, 'accidente');
    assert.deepEqual(c.requeridos.map((p) => p.clave).slice(0, 2), ['diat', 'informe_investigacion']);
});

test('calificar-accidente: un hallazgo clasificado conserva una gravedad válida; uno sin clasificar solo cambia el tipo', async () => {
    const id = await crear({ tipo: 'incidente', gravedad: 'grave' });
    assert.equal((await triaje(id, { tipo: 'incidente', gravedad: 'grave', danoMayor: false, granSusto: false })).statusCode, 200);
    await pedir(prev(), 'PUT', `/incidents/${id}/calificar-accidente`, {});
    assert.equal(guardado(id).triaje.gravedad, 'grave');

    const sinClasificar = await crear({ tipo: 'incidente', gravedad: 'leve' });
    assert.equal((await pedir(prev(), 'PUT', `/incidents/${sinClasificar}/calificar-accidente`, {})).statusCode, 200);
    const g = guardado(sinClasificar);
    assert.equal(g.tipo, 'accidente');
    assert.equal(g.triaje, undefined, 'no se inventa una clasificación que nadie hizo');
});

test('calificar-accidente: sigue exigiendo el permiso y no toca un caso cerrado', async () => {
    const id = await crear({ tipo: 'incidente', gravedad: 'leve' });
    assert.equal((await pedir(gest(), 'PUT', `/incidents/${id}/calificar-accidente`, {})).statusCode, 403);
    guardado(id).estado = 'cerrado';
    assert.equal((await pedir(prev(), 'PUT', `/incidents/${id}/calificar-accidente`, {})).statusCode, 409);
    assert.equal(guardado(id).tipo, 'incidente');
});

// ─── Arreglo 2: PUT /incidents/{id} no acepta evidencias ─────────────────────

test('PUT /incidents/{id} rechaza `evidencias` y no toca la lista; lo demás se sigue editando', async () => {
    const id = await crear();
    const clave = `tenants/${A}/incidentes/${id}/0b6f1c2e-3d4a-4b5c-8d9e-0f1a2b3c4d5e.jpg`;
    const adj = await pedir(gest(), 'POST', `/incidents/${id}/evidencias`, { evidencias: [clave] });
    assert.equal(adj.statusCode, 200, adj.body);

    for (const evidencias of [[`tenants/${B}/incidentes/otro/foto.jpg`], [], 'x']) {
        const res = await pedir(gest(), 'PUT', `/incidents/${id}`, { evidencias });
        assert.equal(res.statusCode, 400, JSON.stringify(evidencias));
        assert.match(JSON.parse(res.body).error, /POST \/incidents\/\{id\}\/evidencias/);
    }
    assert.deepEqual(guardado(id).evidencias, [clave], 'la lista quedó como estaba');

    const ok = await pedir(gest(), 'PUT', `/incidents/${id}`, { diasPerdidos: 4 });
    assert.equal(ok.statusCode, 200, ok.body);
    assert.equal(guardado(id).diasPerdidos, 4);
    assert.deepEqual(guardado(id).evidencias, [clave]);
});

// ─── Arreglo 3: fechas en la hora de Chile ───────────────────────────────────
//
// Chile está en UTC-3 de septiembre a abril y en UTC-4 el resto del año. Para el
// día de Chile hay un desfase con UTC entre las 21:00 y la medianoche (20:00 en
// invierno).

/** Fija el reloj (`Date.now`) en el instante dado. */
const fijarReloj = (iso) => mock.method(Date, 'now', () => new Date(iso).getTime());
const medida = (plazo) => ({
    medida: 'Instalar baranda perimetral', causaRaiz: 'Sin protección', responsableId: prevencionista, fechaMaxEjecucion: plazo,
});
const crearMedida = (id, plazo) => pedir(gest(), 'POST', `/incidents/${id}/medidas`, medida(plazo));

test('plazo de una medida a mediodía: ayer en Chile ya no vale (antes se aceptaba por el margen de UTC)', async () => {
    const id = await crear();
    fijarReloj('2026-11-22T15:00:00.000Z'); // 12:00 del 22 en Chile
    assert.equal((await crearMedida(id, '2026-11-21')).statusCode, 400);
    assert.equal((await crearMedida(id, '2026-11-22')).statusCode, 201);
    assert.equal((await crearMedida(id, '2026-11-23')).statusCode, 201);
});

test('plazo de una medida cerca de la medianoche: en UTC ya es el día siguiente, en Chile todavía es hoy', async () => {
    const id = await crear();
    fijarReloj('2026-11-23T01:30:00.000Z'); // 22:30 del 22 en Chile, 01:30 del 23 en UTC
    assert.equal((await crearMedida(id, '2026-11-21')).statusCode, 400, 'ayer en Chile');
    const hoy = await crearMedida(id, '2026-11-22');
    assert.equal(hoy.statusCode, 201, 'hoy en Chile es el 22, aunque en UTC sea el 23');
});

test('plazo de una medida en horario de invierno (UTC-4): a las 20:30 de Chile el día UTC ya cambió', async () => {
    const id = await crear();
    fijarReloj('2026-07-16T00:30:00.000Z'); // 20:30 del 15 de julio en Chile
    assert.equal((await crearMedida(id, '2026-07-14')).statusCode, 400);
    assert.equal((await crearMedida(id, '2026-07-15')).statusCode, 201);
});

const subirYConfirmar = async (id, fechaDocumento) => {
    const paso1 = await pedir(gest(), 'POST', `/incidents/${id}/documents`, { tipo: 'diat', fileType: 'application/pdf', checksumSha256: HUELLA, tamano: 2048 });
    assert.equal(paso1.statusCode, 200, paso1.body);
    const { s3Key } = datos(paso1);
    objetos.set(s3Key, { ContentType: 'application/pdf', ContentLength: 2048, ChecksumSHA256: HUELLA, VersionId: 'v1' });
    return pedir(gest(), 'POST', `/incidents/${id}/documents/confirmar`, { s3Key, fileName: 'DIAT.pdf', fechaDocumento });
};

test('fecha de un papel: no puede ser posterior al día de hoy en Chile, aunque en UTC ya haya llegado', async () => {
    const id = await crear();
    fijarReloj('2026-11-23T01:30:00.000Z'); // 22:30 del 22 en Chile
    const manana = await subirYConfirmar(id, '2026-11-23');
    assert.equal(manana.statusCode, 400, 'el 23 todavía no llega en Chile');
    assert.deepEqual(guardado(id).papeles, []);
    const hoy = await subirYConfirmar(id, '2026-11-22');
    assert.equal(hoy.statusCode, 201, hoy.body);
    assert.equal(guardado(id).papeles[0].fechaDocumento, '2026-11-22');
});

test('las medidas vencidas de una obra se miden contra el día de Chile', async () => {
    // El read-model de medidas (fases ACT y CHECK) usa el mismo criterio que el plazo.
    const { IncidentsRepository } = require('../handlers/incidents-module/incidents.repository');
    const id = await crear();
    guardado(id).medidasCorrectivas = [{ numero: 1, medida: 'x', estado: 'pendiente', fechaMaxEjecucion: '2026-11-22' }];
    const repo = new IncidentsRepository();
    fijarReloj('2026-11-23T01:30:00.000Z'); // 22:30 del 22 en Chile: el plazo del 22 vence hoy, no ha vencido
    assert.equal((await repo.getMedidasByObra(A, obraA)).resumen.vencidas, 0);
    fijarReloj('2026-11-23T04:30:00.000Z'); // 01:30 del 23 en Chile
    assert.equal((await repo.getMedidasByObra(A, obraA)).resumen.vencidas, 1);
});
