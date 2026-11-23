// Casos borde que encontró la segunda revisión independiente del módulo de incidentes.
//
//   1  clasificación inventada al crear, y la fecha de Chile
//   2  flash-completar (gravedad validada, caso clasificado, trabajador en la traza, 409)
//   3  papeles con la clave de diciembre de 2025 (`{id}/documents/…`) y su lugar en el inventario
//   5  escrituras antiguas con control de versión (update, investigaciones) y `estado` rechazado
//   6  ítem 66: investigación anterior y "hallazgos" de tipo accidente
//   9  rutas antiguas: quien no puede leer el caso recibe 404
//   11 medidas antiguas: plazo en ISO completo y medidas sin número
//   14 cortes de texto que no parten un emoji
// (El CORS y el 413 del servidor local, en servidor-local.test.js; el espejo de las claves
// anteriores, en casos.test.js; el formulario de clasificación y el reintento de confirmar un
// papel son del navegador y no se prueban acá.)

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
const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');

const { PersonaService } = require('../lib/services/PersonaService');
const { TenantService } = require('../lib/services/TenantService');
const { ObraService } = require('../lib/services/ObraService');
const { eventBus } = require('../lib/events/EventBus');
const { FUENTES } = require('../lib/gobernanza/inventario');
const { resumenDelCaso, pendientesDeCierre, papelesDelCaso } = require('../lib/casos');
const { evaluarItem66 } = require('../lib/completitud-operacion');
const { ESTADO_REQUISITO: E } = require('../lib/completitud');
const { cortar } = require('../lib/utils/texto');
const incidentes = require('../handlers/incidents-module/handler');

const fuente = FUENTES.find((f) => f.tabla === 'INCIDENTS_TABLE');

let doble; let emitir; let consola;
let A; let obraA;
let gestora; let prevencionista; let responsable; let sinHistorial; let trabajadora;

beforeEach(async () => {
    doble = crearDobleTablas(DynamoDBDocumentClient.prototype, esquemas, { proyecciones: true });
    emitir = eventBus.emit;
    eventBus.emit = async () => {};
    consola = { log: console.log, error: console.error, warn: console.warn };
    console.log = () => {}; console.error = () => {}; console.warn = () => {};

    A = (await new TenantService().setup({ nombre: 'Constructora A', rutEmpresa: '76.543.210-3' })).tenantId;
    obraA = (await new ObraService().crear(A, { nombre: 'Edificio Los Robles' })).obraId;
    const svc = new PersonaService();
    gestora = (await svc.crear(A, { rut: '12.345.678-5', nombre: 'Sara', rol: 'supervisor' })).persona.personaId;
    prevencionista = (await svc.crear(A, { rut: '9.876.543-3', nombre: 'Pedro', rol: 'prevencionista' })).persona.personaId;
    responsable = (await svc.crear(A, { rut: '15.555.555-6', nombre: 'Ana', apellido: 'Rojas', rol: 'supervisor' })).persona.personaId;
    sinHistorial = (await svc.crear(A, { rut: '16.666.666-K', nombre: 'Luis', apellido: 'Mena', rol: 'trabajador' })).persona.personaId;
    trabajadora = (await svc.crear(A, { rut: '11.111.111-1', nombre: 'Rosa', rol: 'trabajador' })).persona.personaId;
    for (const p of [gestora, prevencionista, responsable, sinHistorial]) {
        doble.items('PERSONAS_TABLE').find((x) => x.personaId === p).estado = 'activo';
    }
});
afterEach(() => {
    mock.timers.reset();
    doble.restaurar();
    eventBus.emit = emitir;
    Object.assign(console, consola);
});

const GESTION = 'incidentes.reportar,incidentes.historial';
const PREVENCION = 'incidentes.reportar,incidentes.historial,incidentes.calificar_accidente';
const TRABAJADOR = 'actividades.ver';

const pedir = (quien, metodo, ruta, body, query = null) => incidentes.incidentsHandler({
    rawPath: ruta, rawQueryString: query ? new URLSearchParams(query).toString() : '', headers: { host: 'api.test' }, queryStringParameters: query,
    body: body === undefined ? undefined : JSON.stringify(body),
    requestContext: {
        http: { method: metodo, path: ruta, sourceIp: '200.1.2.3' },
        authorizer: { lambda: { sessionId: 's', personaId: quien.personaId, tenantId: quien.tenantId, rol: 'x', permisos: quien.permisos, credencialProvisional: 'false' } },
    },
});
const como = (personaId, permisos, tenantId = A) => ({ personaId, permisos, tenantId });
const gest = () => como(gestora, GESTION);
const prev = () => como(prevencionista, PREVENCION);
const dePersona = () => como(trabajadora, TRABAJADOR);
const datos = (res) => JSON.parse(res.body).data;
const cuerpo = (res) => JSON.parse(res.body);
const guardado = (id) => doble.items('INCIDENTS_TABLE').find((i) => i.incidentId === id);
const hoyMas = (dias) => new Date(Date.now() + dias * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
const incidentesGuardados = () => doble.items('INCIDENTS_TABLE').filter((i) => !String(i.incidentId).endsWith('#traza'));

const crearAccidente = async (extra = {}) => {
    const res = await pedir(gest(), 'POST', '/incidents', {
        tipo: 'accidente', gravedad: 'grave', descripcion: 'Caída desde el andamio', obraId: obraA, centroTrabajo: 'Torre A',
        trabajador: { nombre: 'Juan Pérez', rut: '17.777.777-3' }, ...extra,
    });
    assert.equal(res.statusCode, 201, res.body);
    return datos(res).incidentId;
};
const crearFlash = async () => {
    const res = await pedir(gest(), 'POST', '/incidents', {
        tipo: 'incidente', esFlash: true, descripcionBreve: 'Caída leve', obraId: obraA, ubicacionReferencia: 'Piso 3', gravedad: 'leve',
        afectados: [{ nombre: 'Juan Pérez', rut: '17.777.777-3', cargo: 'Enfierrador' }],
    });
    assert.equal(res.statusCode, 201, res.body);
    return datos(res).incidentId;
};
const crearHallazgo = async (quien = dePersona(), extra = {}) => {
    const res = await pedir(quien, 'POST', '/incidents', {
        tipo: 'condicion_subestandar', descripcion: 'Baranda suelta', obraId: obraA, ...extra,
    });
    assert.equal(res.statusCode, 201, res.body);
    return datos(res).incidentId;
};

/** Simula otra escritura sobre el incidente entre la lectura del handler y su escritura. */
const conCarrera = async (id, fn) => {
    const original = DynamoDBDocumentClient.prototype.send;
    DynamoDBDocumentClient.prototype.send = async function enviar(cmd) {
        if (cmd.constructor.name === 'UpdateCommand' && cmd.input.TableName === process.env.INCIDENTS_TABLE
            && String(cmd.input.ConditionExpression || '').includes('updatedAt')) {
            guardado(id).updatedAt = '2099-01-01T00:00:00.000Z';
        }
        return original.call(this, cmd);
    };
    try { return await fn(); } finally { DynamoDBDocumentClient.prototype.send = original; }
};

// ─── 1. La clasificación sale del tipo ────────────────────────────────────────

test('crear: una clasificación inventada no esquiva el permiso ni las validaciones', async () => {
    const malos = [
        // Sin permiso, un accidente con una clasificación que no es ni hallazgo ni incidente.
        { clasificacion: 'otra', tipo: 'accidente', gravedad: 'grave' },
        // Un accidente "clasificado" como hallazgo, y un hallazgo "clasificado" como incidente.
        { clasificacion: 'hallazgo', tipo: 'accidente', gravedad: 'grave' },
        { clasificacion: 'incidente', tipo: 'condicion_subestandar' },
        // Un tipo que no existe, con y sin clasificación.
        { clasificacion: 'otra', tipo: 'inventado' },
        { tipo: 'inventado' },
        // Una gravedad que no existe.
        { tipo: 'condicion_subestandar', gravedad: 'catastrofica' },
    ];
    for (const extra of malos) {
        const res = await pedir(dePersona(), 'POST', '/incidents', { descripcion: 'Algo', obraId: obraA, ...extra });
        assert.equal(res.statusCode, 400, JSON.stringify(extra));
    }
    // Con permiso tampoco: la clasificación inventada se rechaza igual.
    const res = await pedir(gest(), 'POST', '/incidents', { clasificacion: 'otra', tipo: 'accidente', gravedad: 'leve', descripcion: 'Algo', obraId: obraA });
    assert.equal(res.statusCode, 400);
    assert.equal(incidentesGuardados().length, 0, 'ningún intento dejó un caso guardado');
});

test('crear: quien no tiene incidentes.reportar no crea un accidente ni un incidente, con la clasificación que declare', async () => {
    for (const body of [
        { tipo: 'accidente', gravedad: 'leve' }, { tipo: 'incidente' },
        { clasificacion: 'incidente', tipo: 'accidente', gravedad: 'grave' },
    ]) {
        const res = await pedir(dePersona(), 'POST', '/incidents', { descripcion: 'Algo', obraId: obraA, ...body });
        assert.equal(res.statusCode, 403, JSON.stringify(body));
    }
    assert.equal(incidentesGuardados().length, 0);
});

test('crear: la clasificación se deriva del tipo, y la del cliente, si coincide, se acepta', async () => {
    const h = guardado(await crearHallazgo());
    assert.equal(h.clasificacion, 'hallazgo');
    assert.equal(h.gobernanza.estadoCierre, 'abierto');
    const h2 = guardado(await crearHallazgo(dePersona(), { clasificacion: 'hallazgo', tipo: 'accion_subestandar' }));
    assert.equal(h2.clasificacion, 'hallazgo');
    assert.equal(guardado(await crearAccidente()).clasificacion, 'incidente');
});

// ─── 1. Fecha de Chile ───────────────────────────────────────────────────────

test('create: la fecha y la hora son las de Chile, no las del reloj UTC', async () => {
    // 01:30 UTC del 23 de noviembre de 2026 = 22:30 del 22 en Chile (verano, UTC-3).
    mock.timers.enable({ apis: ['Date'], now: new Date('2026-11-23T01:30:00.000Z') });
    const id = await crearHallazgo();
    assert.equal(guardado(id).fecha, '2026-11-22');
    assert.equal(guardado(id).hora, '22:30:00');
    assert.equal(guardado(id).createdAt, '2026-11-23T01:30:00.000Z', 'createdAt sigue siendo el instante UTC');
});

// ─── 2. flash-completar ──────────────────────────────────────────────────────

const flash = (id, body, quien = gest()) => pedir(quien, 'PUT', `/incidents/${id}/flash-completar`, body);

test('flash-completar funciona con el reporte flash que vive en la traza, y deja al afectado en la traza', async () => {
    const id = await crearFlash();
    const res = await flash(id, {
        descripcion: 'Caída desde 2 metros', gravedad: 'grave', diasPerdidos: 3, descripcionBreve: 'Caída con lesión',
        trabajador: { nombre: 'Juan Pérez Soto', rut: '17.777.777-3', cargo: 'Enfierrador', genero: 'M' },
    });
    assert.equal(res.statusCode, 200, res.body);
    const item = guardado(id);
    assert.equal(item.gravedad, 'grave');
    assert.equal(item.descripcion, 'Caída desde 2 metros');
    assert.equal(item.diasPerdidos, 3);
    assert.equal(item.trabajadorNombre, 'Juan Pérez Soto');
    assert.ok(item.afectadoRutHmac, 'el vínculo por HMAC se recalcula');
    assert.equal(item.trabajador, undefined, 'el RUT no se escribe en el elemento listado');
    assert.equal(item.reporteFlash, undefined);
    // La respuesta no lleva nada sensible.
    assert.doesNotMatch(res.body, /17\.777\.777|reporteFlash|trabajador"/);
    // El detalle (con la traza) ve el flash completado y al trabajador.
    const detalle = datos(await pedir(prev(), 'GET', `/incidents/${id}`));
    assert.equal(detalle.reporteFlash.descripcionBreve, 'Caída con lesión');
    assert.equal(detalle.reporteFlash.severidad, 'grave');
    assert.equal(detalle.reporteFlash.esFlash, true);
    assert.ok(detalle.reporteFlash.editadoEn);
    assert.equal(detalle.trabajador.rut, '17.777.777-3');
    assert.equal(detalle.trabajador.nombre, 'Juan Pérez Soto');
});

test('flash-completar: la gravedad se valida, y un caso ya clasificado no la cambia por esta ruta', async () => {
    const id = await crearFlash();
    for (const mala of ['mortal', '', 3, null]) {
        assert.equal((await flash(id, { gravedad: mala })).statusCode, 400, String(mala));
    }
    assert.equal(guardado(id).gravedad, 'leve');

    // Clasificado: la gravedad es de la clasificación.
    const t = await pedir(prev(), 'PUT', `/incidents/${id}/triaje`, { tipo: 'incidente', gravedad: 'leve', danoMayor: false, granSusto: false });
    assert.equal(t.statusCode, 200, t.body);
    const res = await flash(id, { gravedad: 'fatal' });
    assert.equal(res.statusCode, 400);
    assert.match(cuerpo(res).error, /clasificación/);
    assert.equal(guardado(id).gravedad, 'leve');
    // La misma gravedad no es un cambio, y lo demás se completa igual.
    const igual = await flash(id, { gravedad: 'leve', descripcion: 'Descripción completa' });
    assert.equal(igual.statusCode, 200, igual.body);
    assert.equal(guardado(id).descripcion, 'Descripción completa');
    // Reclasificando sí cambia.
    assert.equal((await pedir(prev(), 'PUT', `/incidents/${id}/triaje`, { tipo: 'accidente', gravedad: 'fatal' })).statusCode, 200);
    assert.equal(guardado(id).gravedad, 'fatal');
});

test('flash-completar: valida el resto de los campos y exige que el caso sea un reporte flash', async () => {
    const id = await crearFlash();
    for (const malo of [{ diasPerdidos: -1 }, { diasPerdidos: 1.5 }, { diasPerdidos: '3' }, { descripcion: 5 }, { afectados: 'x' }, { afectados: [1] }, { trabajador: 'Juan' }]) {
        assert.equal((await flash(id, malo)).statusCode, 400, JSON.stringify(malo));
    }
    const normal = await crearAccidente();
    const res = await flash(normal, { descripcion: 'x' });
    assert.equal(res.statusCode, 400);
    assert.match(cuerpo(res).error, /reporte flash/);
});

test('flash-completar: si el caso cambió desde la lectura responde 409 y no toca la traza', async () => {
    const id = await crearFlash();
    const antes = JSON.stringify(doble.items('INCIDENTS_TABLE').find((i) => i.incidentId === `${id}#traza`));
    const res = await conCarrera(id, () => flash(id, { descripcion: 'Otra descripción', trabajador: { nombre: 'Otro', rut: '17.777.777-3' } }));
    assert.equal(res.statusCode, 409, res.body);
    assert.notEqual(guardado(id).descripcion, 'Otra descripción');
    assert.equal(JSON.stringify(doble.items('INCIDENTS_TABLE').find((i) => i.incidentId === `${id}#traza`)), antes);
});

// ─── 3. Papeles con la clave de diciembre de 2025 ─────────────────────────────

const UUID = '0b6f1c2e-3d4a-4b5c-8d9e-0f1a2b3c4d5e';

test('un papel guardado con la clave anterior ({id}/documents/…) se lee, se firma contra el bucket de evidencia y cuenta para el caso', async () => {
    const id = await crearAccidente();
    const clave = `${id}/documents/diat-${UUID}.pdf`;
    guardado(id).documentos = { diat: { s3Key: clave, fileName: 'diat.pdf', fileType: 'application/pdf', uploadedAt: '2026-03-01T12:00:00.000Z' } };

    const res = await pedir(prev(), 'GET', `/incidents/${id}/documents`);
    assert.equal(res.statusCode, 200, res.body);
    const { archivos, requeridos } = datos(res);
    assert.equal(archivos.length, 1);
    assert.equal(archivos[0].tipo, 'diat');
    assert.equal(archivos[0].legado, true);
    assert.equal(archivos[0].contieneSalud, true);
    assert.equal(archivos[0].s3Key, undefined, 'la clave no sale');
    assert.match(archivos[0].url, /evidencia-de-prueba/, 'el bucket es el de evidencia, no el de trabajo');
    assert.match(archivos[0].url, new RegExp(`${id}/documents/diat-`));
    assert.equal(requeridos.find((r) => r.clave === 'diat').cumplido, true);

    // Las claves de otro incidente o con `..` siguen sin aceptarse.
    for (const mala of [`OTRO/documents/diat-${UUID}.pdf`, `${id}/documents/../${id}/x.pdf`, `${id}/otra-carpeta/diat.pdf`]) {
        guardado(id).documentos = { diat: { s3Key: mala, fileName: 'diat.pdf' } };
        assert.equal(datos(await pedir(prev(), 'GET', `/incidents/${id}/documents`)).archivos.length, 0, mala);
    }
});

test('papelesDelCaso: la clave anterior del incidente cuenta; la de otro incidente, no', () => {
    const base = { tenantId: 'T1', incidentId: 'I1', tipo: 'accidente' };
    const doc = (s3Key) => ({ diat: { s3Key, fileName: 'd.pdf' } });
    assert.equal(papelesDelCaso({ ...base, documentos: doc(`I1/documents/diat-${UUID}.pdf`) }).length, 1);
    assert.equal(papelesDelCaso({ ...base, documentos: doc(`I2/documents/diat-${UUID}.pdf`) }).length, 0);
    assert.equal(papelesDelCaso({ ...base, documentos: doc('I1/documents/../I2/diat.pdf') }).length, 0);
});

test('inventario: los archivos del contrato anterior (documentos.diat y diep) entran en la retención y la supresión', () => {
    const archivos = fuente.archivosDe({
        evidencias: ['tenants/A/incidentes/I1/foto.png'],
        papeles: [{ s3Key: 'tenants/A/incidentes/I1/papeles/informe_investigacion-x.pdf' }],
        documentos: {
            diat: { s3Key: 'I1/documents/diat-x.pdf' },
            diep: { s3Key: 'tenants/A/incidentes/I1/diep-x.pdf' },
            otro: { s3Key: 'no-cuenta.pdf' },
        },
    });
    assert.deepEqual(archivos.sort(), [
        'I1/documents/diat-x.pdf', 'tenants/A/incidentes/I1/diep-x.pdf',
        'tenants/A/incidentes/I1/foto.png', 'tenants/A/incidentes/I1/papeles/informe_investigacion-x.pdf',
    ].sort());
    // Sin ellos, o con valores raros, no falla ni agrega nada.
    assert.deepEqual(fuente.archivosDe({ documentos: { diat: null, diep: { s3Key: 42 } } }), []);
    assert.deepEqual(fuente.archivosDe({}), []);
});

// ─── 5. Escrituras con control de versión ────────────────────────────────────

test('PUT /incidents/{id}: si el caso cambió desde la lectura responde 409 y no pisa lo guardado', async () => {
    const id = await crearAccidente();
    const res = await conCarrera(id, () => pedir(gest(), 'PUT', `/incidents/${id}`, { diasPerdidos: 9 }));
    assert.equal(res.statusCode, 409, res.body);
    assert.equal(guardado(id).diasPerdidos, 0);
    // Sin carrera, funciona y conserva el resto de las investigaciones.
    const ok = await pedir(gest(), 'PUT', `/incidents/${id}`, { diasPerdidos: 9, medidasInmediatas: 'Se detuvo la faena' });
    assert.equal(ok.statusCode, 200, ok.body);
    assert.equal(guardado(id).diasPerdidos, 9);
    assert.equal(guardado(id).medidasInmediatas, 'Se detuvo la faena');
});

test('PUT /incidents/{id}: el estado no se acepta (400), cerrado con su mensaje; las ediciones de investigación siguen funcionando', async () => {
    const id = await crearAccidente();
    for (const estado of ['cerrado', 'en_investigacion', 'reportado', 'lo-que-sea']) {
        assert.equal((await pedir(gest(), 'PUT', `/incidents/${id}`, { estado })).statusCode, 400, estado);
    }
    assert.equal(guardado(id).estado, 'reportado');
    const inv = { investigador: 'Sara', rolInvestigador: 'prevencionista', hallazgos: 'Faltaba línea de vida', recomendaciones: 'Instalarla', medidas: 'Línea de vida' };
    const ok = await pedir(gest(), 'PUT', `/incidents/${id}`, { investigacionPrevencionista: inv });
    assert.equal(ok.statusCode, 200, ok.body);
    assert.equal(guardado(id).investigaciones.prevencionista.hallazgos, 'Faltaba línea de vida');
    assert.equal(guardado(id).investigaciones.jefeDirecto, null, 'las otras investigaciones se conservan');
});

test('calificar-accidente sin clasificación: si el caso cambió responde 409', async () => {
    const id = await crearAccidente({ tipo: 'incidente', gravedad: 'leve' });
    const res = await conCarrera(id, () => pedir(prev(), 'PUT', `/incidents/${id}/calificar-accidente`, {}));
    assert.equal(res.statusCode, 409, res.body);
    assert.equal(guardado(id).tipo, 'incidente');
    assert.equal((await pedir(prev(), 'PUT', `/incidents/${id}/calificar-accidente`, {})).statusCode, 200);
    assert.equal(guardado(id).tipo, 'accidente');
});

const INVESTIGACION = { tipo: 'prevencionista', investigador: 'Sara', hallazgos: 'Faltaba línea de vida', recomendaciones: 'Instalarla', medidas: 'Línea de vida' };

test('investigaciones: si el caso cambió desde la lectura responde 409; sin carrera, registra y pasa a investigación', async () => {
    const id = await crearAccidente();
    const res = await conCarrera(id, () => pedir(gest(), 'POST', `/incidents/${id}/investigations`, INVESTIGACION));
    assert.equal(res.statusCode, 409, res.body);
    assert.equal(guardado(id).investigaciones.prevencionista, null);
    assert.equal(guardado(id).estado, 'reportado');
    const ok = await pedir(gest(), 'POST', `/incidents/${id}/investigations`, INVESTIGACION);
    assert.equal(ok.statusCode, 200, ok.body);
    assert.equal(guardado(id).investigaciones.prevencionista.hallazgos, 'Faltaba línea de vida');
    assert.equal(guardado(id).estado, 'en_investigacion');
    // Los datos que faltan siguen siendo un 400, no un 500.
    assert.equal((await pedir(gest(), 'POST', `/incidents/${id}/investigations`, { tipo: 'prevencionista' })).statusCode, 400);
});

// ─── 6. Ítem 66 ──────────────────────────────────────────────────────────────

test('resumenDelCaso: una investigación registrada con el flujo anterior cuenta como investigada; sin contenido, no', () => {
    const accidente = { incidentId: 'a', tipo: 'accidente', clasificacion: 'incidente', gravedad: 'leve' };
    const inv = (extra) => ({ investigador: 'Sara', estado: 'completada', ...extra });
    assert.equal(resumenDelCaso(accidente).informeInvestigacion, false);
    for (const quien of ['prevencionista', 'jefeDirecto', 'comiteParitario']) {
        const r = resumenDelCaso({ ...accidente, investigaciones: { [quien]: inv({ hallazgos: 'Se cayó' }) } });
        assert.equal(r.informeInvestigacion, true, quien);
    }
    // Sin contenido: el objeto vacío o solo con quién investigó no cuenta.
    assert.equal(resumenDelCaso({ ...accidente, investigaciones: { prevencionista: inv({}), jefeDirecto: null, comiteParitario: null } }).informeInvestigacion, false);
    assert.equal(resumenDelCaso({ ...accidente, investigaciones: { prevencionista: inv({ hallazgos: '   ', recomendaciones: '' }) } }).informeInvestigacion, false);
    // El papel sigue contando.
    assert.equal(resumenDelCaso({ ...accidente, papeles: [{ tipo: 'informe_investigacion', s3Key: 'k' }] }).informeInvestigacion, true);
    // Y no cambia lo que exige el caso: el cierre sigue pidiendo el papel.
    assert.equal(resumenDelCaso({ ...accidente, investigaciones: { prevencionista: inv({ hallazgos: 'x' }) } }).requeridos.find((r) => r.clave === 'informe_investigacion').cumplido, false);
});

test('ítem 66: solo cuentan los accidentes reales; un "hallazgo" de tipo accidente no, y el texto no habla de un período', () => {
    const ctx = (casos) => ({
        ahora: new Date('2026-09-10T12:00:00.000Z'), organos: [], obligaciones: {}, actividades: [], obra: {}, casos,
        documentos: [{ documentId: 'p', tipo: 'PROCEDIMIENTO_INVESTIGACION', s3Key: 'p.pdf', version: 1, createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z', asignaciones: [] }],
    });
    const hallazgoDeTipoAccidente = resumenDelCaso({ incidentId: 'h', tipo: 'accidente', clasificacion: 'hallazgo' });
    assert.equal(hallazgoDeTipoAccidente.clasificacion, 'hallazgo');
    const sin = evaluarItem66(ctx([hallazgoDeTipoAccidente]));
    assert.equal(sin.estado, E.CUMPLIDO);
    assert.match(sin.detalle, /Sin accidentes registrados/);
    assert.doesNotMatch(sin.detalle, /período/);
    // Un accidente real sin informe sí queda Parcial; con investigación anterior, Cumplido.
    const real = { incidentId: 'a', tipo: 'accidente', clasificacion: 'incidente' };
    const parcial = evaluarItem66(ctx([hallazgoDeTipoAccidente, resumenDelCaso(real)]));
    assert.equal(parcial.estado, E.PARCIAL);
    assert.match(parcial.detalle, /1 accidente sin informe/);
    const investigado = resumenDelCaso({ ...real, investigaciones: { comiteParitario: { hallazgos: 'Se cayó' } } });
    assert.equal(evaluarItem66(ctx([hallazgoDeTipoAccidente, investigado])).estado, E.CUMPLIDO);
});

test('casos-resumen: el accidente investigado con el flujo anterior sale con su informe, y sin datos personales', async () => {
    const id = await crearAccidente();
    assert.equal((await pedir(gest(), 'POST', `/incidents/${id}/investigations`, INVESTIGACION)).statusCode, 200);
    const res = await pedir(gest(), 'GET', '/incidents/casos-resumen', undefined, { obraId: obraA });
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(datos(res)[0].informeInvestigacion, true);
    assert.doesNotMatch(res.body, /Faltaba línea de vida|17\.777\.777|Juan/);
});

// ─── 9. Rutas antiguas: quien no puede leer el caso ──────────────────────────

test('las rutas antiguas responden 404 a quien tiene el permiso pero no puede leer el caso', async () => {
    const id = await crearAccidente();
    // Permisos de gestión y clasificación, pero ni historial ni es quien reportó.
    const intruso = como(sinHistorial, 'incidentes.reportar,incidentes.calificar_accidente');
    const antes = JSON.stringify(guardado(id));
    const rutas = [
        ['PUT', `/incidents/${id}`, { diasPerdidos: 2 }],
        ['PUT', `/incidents/${id}/calificar-accidente`, {}],
        ['PUT', `/incidents/${id}/gobernanza`, { estadoCierre: 'en_proceso' }],
        ['PUT', `/incidents/${id}/flash-completar`, { descripcion: 'x' }],
        ['PUT', `/incidents/${id}/medidas/1`, { estado: 'completada' }],
        ['POST', `/incidents/${id}/investigations`, INVESTIGACION],
        ['POST', `/incidents/${id}/viewed`, {}],
    ];
    for (const [metodo, ruta, body] of rutas) {
        const res = await pedir(intruso, metodo, ruta, body);
        assert.equal(res.statusCode, 404, `${metodo} ${ruta}`);
    }
    assert.equal(JSON.stringify(guardado(id)), antes, 'nada cambió ni se marcó como visto');
    // Con historial pero sin el permiso de la ruta: 403, como antes.
    const soloHistorial = como(sinHistorial, 'incidentes.historial');
    assert.equal((await pedir(soloHistorial, 'PUT', `/incidents/${id}`, { diasPerdidos: 2 })).statusCode, 403);
    assert.equal((await pedir(soloHistorial, 'PUT', `/incidents/${id}/calificar-accidente`, {})).statusCode, 403);
    // Y quien sí puede leer lo marca como visto.
    assert.equal((await pedir(prev(), 'POST', `/incidents/${id}/viewed`, {})).statusCode, 200);
    assert.deepEqual([...guardado(id).viewedBy], [prevencionista]);
});

// ─── 11. Medidas antiguas ────────────────────────────────────────────────────

test('una medida antigua con el plazo en ISO completo sigue leyéndose por obra (vencida por día) y se le cambia el estado', async () => {
    const id = await crearAccidente();
    guardado(id).medidasCorrectivas = [{
        numero: 1, medida: 'Instalar baranda', responsableId: responsable, responsableNombre: 'Ana Rojas',
        fechaMaxEjecucion: '2020-01-05T10:00:00.000Z', estado: 'pendiente',
    }];
    const { IncidentsRepository } = require('../handlers/incidents-module/incidents.repository');
    const lectura = await new IncidentsRepository().getMedidasByObra(A, obraA);
    assert.equal(lectura.medidas.length, 1);
    assert.equal(lectura.medidas[0].medida, 'Instalar baranda');
    assert.equal(lectura.medidas[0].vencida, true);
    assert.equal(lectura.resumen.vencidas, 1);
    const res = await pedir(gest(), 'PUT', `/incidents/${id}/medidas/1`, { estado: 'completada' });
    assert.equal(res.statusCode, 200, res.body);
    assert.equal((await new IncidentsRepository().getMedidasByObra(A, obraA)).resumen.vencidas, 0, 'una medida completada ya no está vencida');
    // Editar el texto o el plazo ya no es posible: la ruta no existe.
    assert.equal((await pedir(gest(), 'PUT', `/incidents/${id}/medidas/1/datos`, { medida: 'Otro' })).statusCode, 404);
});

test('medidas sin número: salen numeradas sin chocar con las existentes, y una acción afecta solo a la suya', async () => {
    const id = await crearAccidente();
    guardado(id).medidasCorrectivas = [
        { medida: 'Sin número A', estado: 'pendiente', fechaMaxEjecucion: hoyMas(5) },
        { numero: 3, medida: 'Con número', estado: 'pendiente', fechaMaxEjecucion: hoyMas(5) },
        { medida: 'Sin número B', estado: 'pendiente', fechaMaxEjecucion: hoyMas(5) },
    ];
    const detalle = datos(await pedir(prev(), 'GET', `/incidents/${id}`));
    assert.deepEqual(detalle.medidasCorrectivas.map((m) => m.numero), [4, 3, 5]);
    // Estable: leerlo otra vez da los mismos números.
    assert.deepEqual(datos(await pedir(prev(), 'GET', `/incidents/${id}`)).medidasCorrectivas.map((m) => m.numero), [4, 3, 5]);
    // El listado y la lectura por obra también.
    assert.deepEqual(datos(await pedir(prev(), 'GET', '/incidents')).find((i) => i.incidentId === id).medidasCorrectivas.map((m) => m.numero), [4, 3, 5]);

    // Cambiar el estado de una sola no toca a las demás.
    const res = await pedir(gest(), 'PUT', `/incidents/${id}/medidas/5`, { estado: 'completada' });
    assert.equal(res.statusCode, 200, res.body);
    assert.deepEqual(guardado(id).medidasCorrectivas.map((m) => [m.numero, m.estado]), [[4, 'pendiente'], [3, 'pendiente'], [5, 'completada']]);
});

// ─── 14. Cortes de texto ─────────────────────────────────────────────────────

const solitaria = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

test('cortar: por caracteres completos, sin partir un emoji', () => {
    assert.equal(cortar('abc', 5), 'abc');
    assert.equal(cortar('abcdef', 3), 'abc');
    assert.equal(cortar(`${'a'.repeat(9)}😀😀`, 10), `${'a'.repeat(9)}😀`);
    assert.equal(cortar(undefined, 3), '');
    assert.doesNotMatch(cortar('a😀'.repeat(50), 51), solitaria);
    // El corte común sí partiría el emoji.
    assert.match(`${'a'.repeat(9)}😀`.slice(0, 10), solitaria);
});

test('las medidas inmediatas se cortan en su tope sin partir un emoji', async () => {
    const texto = `${'a'.repeat(999)}😀😀`;
    const id = await crearAccidente({ medidasInmediatas: texto });
    const guardada = guardado(id).medidasInmediatas;
    assert.equal(Array.from(guardada).length, 1000);
    assert.doesNotMatch(guardada, solitaria);
});

test('el nombre del archivo de un papel se corta por caracteres completos', async () => {
    const id = await crearAccidente();
    const clave = `tenants/${A}/incidentes/${id}/papeles/diat-${UUID}.pdf`;
    const { s3Client } = require('../lib/clients/s3');
    const original = s3Client.send;
    s3Client.send = async function simulado(cmd) {
        if (cmd.constructor.name === 'HeadObjectCommand') return { ContentType: 'application/pdf', ContentLength: 100, ChecksumSHA256: 'x', VersionId: 'v' };
        return original.call(s3Client, cmd);
    };
    try {
        const res = await pedir(gest(), 'POST', `/incidents/${id}/documents/confirmar`, { s3Key: clave, fileName: `${'a'.repeat(149)}😀😀.pdf` });
        assert.equal(res.statusCode, 201, res.body);
        const nombre = guardado(id).papeles[0].nombreArchivo;
        assert.doesNotMatch(nombre, solitaria);
        assert.equal(Array.from(nombre).length, 150);
    } finally { s3Client.send = original; }
});
