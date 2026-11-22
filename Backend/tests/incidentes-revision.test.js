// Correcciones de la revisión independiente del rediseño de incidentes.
//
// Cada prueba fija un hallazgo de la revisión:
//   - un hallazgo creado sin foto se puede cerrar después de agregarle una foto;
//   - cerrar un hallazgo por la gobernanza exige el permiso de cierre y escribe `cierre`;
//   - `PUT /incidents/{id}` ya no cambia el tipo ni la clasificación;
//   - `create` no acepta medidas correctivas ni gobernanza del cliente;
//   - el responsable de una medida tiene que poder ver el caso (`incidentes.historial`);
//   - cambiar el estado de una medida y la gobernanza escriben con bloqueo optimista;
//   - `casos-resumen` lee todas las páginas de la consulta;
//   - papeles en un caso cerrado, y papeles guardados con el contrato anterior;
//   - reabrir un hallazgo limpia el comentario de cierre.

process.env.CAMPO_HMAC_KEY = 'clave-de-prueba-hmac';
process.env.CAMPO_CIFRADO_LOCAL_KEY = require('crypto').randomBytes(32).toString('base64');
process.env.CREDENCIAL_PEPPER = 'pimienta-de-prueba';
process.env.EVIDENCIA_BUCKET = process.env.EVIDENCIA_BUCKET || 'evidencia-de-prueba';
process.env.AWS_REGION = process.env.AWS_REGION || 'us-east-1';
process.env.AWS_ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID || 'PRUEBA_SIN_AWS';
process.env.AWS_SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY || 'PRUEBA_SIN_AWS';

const { prepararEntorno, crearDobleTablas } = require('./doble-dynamo-tablas');
const esquemas = prepararEntorno();

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');

const { s3Client } = require('../lib/clients/s3');
const { PersonaService } = require('../lib/services/PersonaService');
const { TenantService } = require('../lib/services/TenantService');
const { ObraService } = require('../lib/services/ObraService');
const { eventBus } = require('../lib/events/EventBus');
const { papelesRequeridos, avanceDelCaso } = require('../lib/casos');
const { DEFAULT_ROLE_PRESETS } = require('../lib/permissions');
const incidentes = require('../handlers/incidents-module/handler');

let doble; let emitir; let consola; let enviarS3; let objetos;
let A; let B; let obraA;
let gestora; let prevencionista; let responsable; let sinHistorial; let trabajadora; let ajena;

const activar = (personaId, estado = 'activo') => {
    doble.items('PERSONAS_TABLE').find((x) => x.personaId === personaId).estado = estado;
};

beforeEach(async () => {
    doble = crearDobleTablas(DynamoDBDocumentClient.prototype, esquemas, { proyecciones: true });
    emitir = eventBus.emit;
    eventBus.emit = async () => {};
    consola = { log: console.log, error: console.error, warn: console.warn };
    console.log = () => {}; console.error = () => {}; console.warn = () => {};

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
    const svc = new PersonaService();
    gestora = (await svc.crear(A, { rut: '12.345.678-5', nombre: 'Sara', rol: 'supervisor' })).persona.personaId;
    prevencionista = (await svc.crear(A, { rut: '9.876.543-3', nombre: 'Pedro', rol: 'prevencionista' })).persona.personaId;
    responsable = (await svc.crear(A, { rut: '15.555.555-6', nombre: 'Ana', apellido: 'Rojas', rol: 'supervisor' })).persona.personaId;
    sinHistorial = (await svc.crear(A, { rut: '16.666.666-K', nombre: 'Luis', apellido: 'Mena', rol: 'trabajador' })).persona.personaId;
    trabajadora = (await svc.crear(A, { rut: '11.111.111-1', nombre: 'Rosa', rol: 'trabajador' })).persona.personaId;
    ajena = (await svc.crear(B, { rut: '22.222.222-2', nombre: 'Otra', rol: 'supervisor' })).persona.personaId;
    for (const p of [gestora, prevencionista, responsable, sinHistorial, ajena]) activar(p);
});
afterEach(() => {
    s3Client.send = enviarS3;
    doble.restaurar();
    eventBus.emit = emitir;
    Object.assign(console, consola);
});

const GESTION = 'incidentes.reportar,incidentes.historial';
const PREVENCION = 'incidentes.reportar,incidentes.historial,incidentes.calificar_accidente';
const TRABAJADOR = 'actividades.ver';
const HUELLA = Buffer.alloc(32, 7).toString('base64');
const UUID = '0b6f1c2e-3d4a-4b5c-8d9e-0f1a2b3c4d5e';

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

const crearAccidente = async (extra = {}) => {
    const res = await pedir(gest(), 'POST', '/incidents', {
        tipo: 'accidente', gravedad: 'grave', descripcion: 'Caída desde el andamio', obraId: obraA, centroTrabajo: 'Torre A',
        trabajador: { nombre: 'Juan Pérez', rut: '17.777.777-3' }, ...extra,
    });
    assert.equal(res.statusCode, 201, res.body);
    return datos(res).incidentId;
};
const crearHallazgo = async (quien = dePersona(), extra = {}) => {
    const res = await pedir(quien, 'POST', '/incidents', {
        clasificacion: 'hallazgo', tipo: 'condicion_subestandar', descripcion: 'Baranda suelta', obraId: obraA, ...extra,
    });
    assert.equal(res.statusCode, 201, res.body);
    return datos(res).incidentId;
};
const triaje = (id, body, quien = prev()) => pedir(quien, 'PUT', `/incidents/${id}/triaje`, body);
const cerrar = (id, body = { comentarioCierre: 'Se corrigió y se verificó en terreno' }, quien = prev()) => pedir(quien, 'PUT', `/incidents/${id}/cerrar`, body);
const medida = (extra = {}) => ({ medida: 'Instalar baranda perimetral', responsableId: responsable, fechaMaxEjecucion: hoyMas(10), ...extra });
const crearMedida = (id, body = medida(), quien = gest()) => pedir(quien, 'POST', `/incidents/${id}/medidas`, body);

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

// ─── Hallazgo 1: un hallazgo sin foto se cierra después de agregarle una ──────

test('un hallazgo creado sin foto: no cierra, y cierra después de agregarle una foto desde el detalle', async () => {
    const id = await crearHallazgo();
    assert.deepEqual(guardado(id).evidencias, [], 'sin foto al reportar');

    // El prevencionista lo clasifica y deja responsable y plazo.
    const t = await triaje(id, { tipo: 'condicion_subestandar', responsableId: responsable, plazoRespuestaISO: hoyMas(5) });
    assert.equal(t.statusCode, 200, t.body);

    const sinFoto = await cerrar(id);
    assert.equal(sinFoto.statusCode, 409, sinFoto.body);
    assert.deepEqual(cuerpo(sinFoto).pendientes, ['Falta: Al menos una foto del hallazgo.']);

    // Quien reportó sube la foto con las rutas de siempre: pide la URL y adjunta la clave.
    const subida = await pedir(dePersona(), 'POST', '/incidents/upload-evidence', { incidentId: id, fileName: 'IMG_1.jpg', fileType: 'image/jpeg', checksumSha256: HUELLA });
    assert.equal(subida.statusCode, 200, subida.body);
    const adjunto = await pedir(dePersona(), 'POST', `/incidents/${id}/evidencias`, { evidencias: [datos(subida).s3Key] });
    assert.equal(adjunto.statusCode, 200, adjunto.body);

    const ok = await cerrar(id);
    assert.equal(ok.statusCode, 200, ok.body);
    assert.equal(guardado(id).gobernanza.estadoCierre, 'cerrado');
    assert.equal(guardado(id).cierre.cerradoPor, prevencionista);
});

test('quien gestiona incidentes (incidentes.reportar) también puede subir la foto a un caso ajeno; sin cerrarlo', async () => {
    const id = await crearHallazgo();
    const subida = await pedir(gest(), 'POST', '/incidents/upload-evidence', { incidentId: id, fileName: 'a.png', fileType: 'image/png', checksumSha256: HUELLA });
    assert.equal(subida.statusCode, 200, subida.body);
    const adjunto = await pedir(gest(), 'POST', `/incidents/${id}/evidencias`, { evidencias: [datos(subida).s3Key] });
    assert.equal(adjunto.statusCode, 200, adjunto.body);
    assert.equal(guardado(id).evidencias.length, 1);
});

// ─── Hallazgo 2: cerrar por gobernanza ───────────────────────────────────────

/** Un hallazgo listo para cerrar: clasificado, con foto, responsable y plazo. */
const hallazgoListo = async () => {
    const id = await crearHallazgo(dePersona(), { responsableId: responsable, plazoRespuestaISO: hoyMas(5) });
    guardado(id).evidencias = [`tenants/${A}/incidentes/${id}/${UUID}.jpg`];
    assert.equal((await triaje(id, { tipo: 'condicion_subestandar' })).statusCode, 200);
    return id;
};

test('cerrar un hallazgo por la gobernanza sin incidentes.calificar_accidente responde 403 y no cambia nada', async () => {
    const id = await hallazgoListo();
    const antes = JSON.stringify(guardado(id));
    const res = await pedir(gest(), 'PUT', `/incidents/${id}/gobernanza`, { estadoCierre: 'cerrado', comentarioCierre: 'Reparado' });
    assert.equal(res.statusCode, 403, res.body);
    assert.equal(JSON.stringify(guardado(id)), antes);
    // Ni siquiera con el caso incompleto: el permiso se mira primero.
    const otro = await crearHallazgo();
    assert.equal((await pedir(gest(), 'PUT', `/incidents/${otro}/gobernanza`, { estadoCierre: 'cerrado', comentarioCierre: 'x' })).statusCode, 403);
});

test('cerrar por la gobernanza con el permiso escribe `cierre` igual que el cierre del caso, y una reapertura lo guarda', async () => {
    const id = await hallazgoListo();
    const res = await pedir(prev(), 'PUT', `/incidents/${id}/gobernanza`, { estadoCierre: 'cerrado', comentarioCierre: '  Reparado y verificado  ' });
    assert.equal(res.statusCode, 200, res.body);
    const g = guardado(id);
    assert.equal(g.gobernanza.estadoCierre, 'cerrado');
    assert.equal(g.gobernanza.comentarioCierre, 'Reparado y verificado');
    assert.equal(g.gobernanza.verificadoPor, prevencionista);
    assert.deepEqual(Object.keys(g.cierre).sort(), ['cerradoEn', 'cerradoPor', 'comentario']);
    assert.equal(g.cierre.cerradoPor, prevencionista);
    assert.equal(g.cierre.comentario, 'Reparado y verificado');
    // La respuesta mantiene su forma: `incident` y `gobernanza`.
    assert.equal(datos(res).gobernanza.estadoCierre, 'cerrado');
    assert.equal(datos(res).incident.incidentId, id);

    const reabierto = await pedir(prev(), 'PUT', `/incidents/${id}/reabrir`, { motivo: 'Volvió a aflojarse' });
    assert.equal(reabierto.statusCode, 200, reabierto.body);
    assert.equal(guardado(id).reaperturas[0].cierreAnterior.comentario, 'Reparado y verificado');
    assert.equal(guardado(id).reaperturas[0].cierreAnterior.cerradoPor, prevencionista);
});

test('la gobernanza cierra solo hallazgos, valida el estado y el comentario, y no guarda quien verifica del cliente', async () => {
    const accidente = await crearAccidente();
    assert.equal((await pedir(prev(), 'PUT', `/incidents/${accidente}/gobernanza`, { estadoCierre: 'cerrado', comentarioCierre: 'x' })).statusCode, 400);
    const id = await hallazgoListo();
    assert.equal((await pedir(prev(), 'PUT', `/incidents/${id}/gobernanza`, { estadoCierre: 'inventado' })).statusCode, 400);
    assert.equal((await pedir(prev(), 'PUT', `/incidents/${id}/gobernanza`, { estadoCierre: 'cerrado', comentarioCierre: 'x'.repeat(1001) })).statusCode, 400);
    assert.equal((await pedir(prev(), 'PUT', `/incidents/${id}/gobernanza`, { comentarioCierre: { a: 1 } })).statusCode, 400);
    assert.equal(guardado(id).gobernanza.estadoCierre, 'en_proceso');
});

test('reabrir un hallazgo limpia el comentario de cierre: el papel "Comentario de cierre" deja de estar cumplido', async () => {
    const id = await hallazgoListo();
    assert.equal((await cerrar(id, { comentarioCierre: 'Listo' })).statusCode, 200);
    assert.equal(papelesRequeridos(guardado(id)).find((p) => p.clave === 'comentario_cierre').cumplido, true);
    assert.equal((await pedir(prev(), 'PUT', `/incidents/${id}/reabrir`, { motivo: 'Faltó una verificación' })).statusCode, 200);
    const g = guardado(id);
    assert.equal(g.gobernanza.comentarioCierre, null);
    assert.equal(g.reaperturas[0].cierreAnterior.comentario, 'Listo', 'el anterior queda en el historial');
    assert.equal(papelesRequeridos(g).find((p) => p.clave === 'comentario_cierre').cumplido, false);
    assert.deepEqual(avanceDelCaso(g), { cumplidos: 2, total: 3, porcentaje: 67 });
});

// ─── Hallazgo 3: PUT /incidents/{id} no cambia el tipo ni la clasificación ────

test('PUT /incidents/{id} rechaza tipo y clasificacion con 400 y manda a la clasificación; no cambia nada', async () => {
    const id = await crearAccidente();
    const antes = JSON.stringify(guardado(id));
    for (const cambio of [{ tipo: 'incidente' }, { clasificacion: 'hallazgo' }, { tipo: 'condicion_subestandar', clasificacion: 'hallazgo' }, { tipo: '' }]) {
        const res = await pedir(gest(), 'PUT', `/incidents/${id}`, cambio);
        assert.equal(res.statusCode, 400, `${JSON.stringify(cambio)}: ${res.body}`);
        assert.match(cuerpo(res).error, /triaje/);
    }
    assert.equal(JSON.stringify(guardado(id)), antes);
    // El accidente grave sigue exigiendo sus papeles.
    assert.deepEqual(papelesRequeridos(guardado(id)).map((p) => p.clave), ['diat', 'informe_investigacion', 'medida_correctiva', 'constancia_aviso_autoridad']);
    // Lo demás se edita como siempre.
    assert.equal((await pedir(gest(), 'PUT', `/incidents/${id}`, { diasPerdidos: 4 })).statusCode, 200);
    assert.equal(guardado(id).diasPerdidos, 4);
});

test('calificar-accidente sigue funcionando por su ruta', async () => {
    const id = await crearAccidente({ tipo: 'incidente', gravedad: 'leve' });
    const res = await pedir(prev(), 'PUT', `/incidents/${id}/calificar-accidente`, {});
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(guardado(id).tipo, 'accidente');
});

// ─── Hallazgo 5: create no acepta medidas ni gobernanza del cliente ──────────

test('create fuerza medidasCorrectivas: [] y no acepta la gobernanza del cliente, en incidentes ni en hallazgos', async () => {
    const falsa = { responsableId: 'p-falso', responsableNombre: 'Nombre falso', plazoRespuestaISO: 'nunca', estadoCierre: 'cerrado', comentarioCierre: 'ya está', verificadoPor: 'p-falso' };
    const medidas = [{ numero: 1, medida: 'Se hizo', responsableId: 'p-falso', estado: 'verificada' }];

    const incidente = await crearAccidente({ medidasCorrectivas: medidas, gobernanza: falsa });
    assert.deepEqual(guardado(incidente).medidasCorrectivas, []);
    assert.equal(guardado(incidente).gobernanza, null);

    const hallazgo = await crearHallazgo(dePersona(), { medidasCorrectivas: medidas, gobernanza: falsa });
    assert.deepEqual(guardado(hallazgo).medidasCorrectivas, []);
    assert.deepEqual(guardado(hallazgo).gobernanza, {
        responsableId: null, responsableNombre: null, plazoRespuestaISO: null,
        estadoCierre: 'abierto', verificadoPor: null, fechaVerificacion: null, comentarioCierre: null,
    });

    const flash = await pedir(gest(), 'POST', '/incidents', {
        clasificacion: 'incidente', tipo: 'incidente', esFlash: true, descripcionBreve: 'Caída leve', obraId: obraA,
        afectados: [{ nombre: 'Juan Pérez', rut: '17.777.777-3' }], medidasCorrectivas: medidas, gobernanza: falsa,
    });
    assert.equal(flash.statusCode, 201, flash.body);
    assert.deepEqual(guardado(datos(flash).incidentId).medidasCorrectivas, []);
    assert.equal(guardado(datos(flash).incidentId).gobernanza, null);
});

// ─── Hallazgo 10: la misma validación de responsable y plazo en las tres rutas ─

test('responsable y plazo de un hallazgo se validan igual al crear, al clasificar y por la gobernanza', async () => {
    const existente = await crearHallazgo();
    const rutas = {
        crear: (extra) => pedir(dePersona(), 'POST', '/incidents', { clasificacion: 'hallazgo', tipo: 'condicion_subestandar', descripcion: 'Baranda', obraId: obraA, ...extra }),
        clasificar: (extra) => triaje(existente, { tipo: 'condicion_subestandar', ...extra }),
        gobernanza: (extra) => pedir(gest(), 'PUT', `/incidents/${existente}/gobernanza`, extra),
    };
    const pendiente = (await new PersonaService().crear(A, { rut: '13.333.333-9', nombre: 'Nora', rol: 'supervisor' })).persona.personaId;
    for (const [nombre, ruta] of Object.entries(rutas)) {
        assert.equal((await ruta({ responsableId: ajena })).statusCode, 404, `${nombre}: de otra empresa`);
        assert.equal((await ruta({ responsableId: pendiente })).statusCode, 400, `${nombre}: no está activa`);
        assert.equal((await ruta({ responsableId: 7 })).statusCode, 400, `${nombre}: no es texto`);
        for (const mal of ['mañana', '2026-02-30', '2026-13-01', 20261201, '2026-1-5']) {
            assert.equal((await ruta({ plazoRespuestaISO: mal })).statusCode, 400, `${nombre}: plazo ${mal}`);
        }
        const ok = await ruta({ responsableId: responsable, responsableNombre: 'Nombre inventado', plazoRespuestaISO: hoyMas(7) });
        assert.ok([200, 201].includes(ok.statusCode), `${nombre}: ${ok.body}`);
    }
    // El nombre sale de la ficha, nunca del cliente: en las tres.
    for (const it of doble.items('INCIDENTS_TABLE').filter((i) => i.clasificacion === 'hallazgo' && i.gobernanza?.responsableId)) {
        assert.equal(it.gobernanza.responsableNombre, 'Ana Rojas');
        assert.equal(it.gobernanza.plazoRespuestaISO, hoyMas(7));
    }
    // Nada se guardó con los rechazados.
    assert.equal(doble.items('INCIDENTS_TABLE').filter((i) => i.clasificacion === 'hallazgo' && !String(i.incidentId).endsWith('#traza')).length, 2);
});

// ─── Hallazgo 6: el responsable de una medida puede ver el caso ──────────────

test('el responsable de una medida tiene que tener incidentes.historial: sin él, 400 y sin aviso', async () => {
    const id = await crearAccidente();
    const sin = await crearMedida(id, medida({ responsableId: sinHistorial }));
    assert.equal(sin.statusCode, 400, sin.body);
    assert.match(cuerpo(sin).error, /poder ver el caso/);
    assert.deepEqual(guardado(id).medidasCorrectivas, []);
    assert.equal(doble.items('INBOX_TABLE').filter((m) => m.recipientId === sinHistorial).length, 0, 'ningún aviso a quien no puede abrir el caso');

    // El supervisor (rol por defecto, con historial) y el prevencionista sí.
    assert.equal((await crearMedida(id, medida({ responsableId: responsable }))).statusCode, 201);
    assert.equal((await crearMedida(id, medida({ responsableId: prevencionista }))).statusCode, 201);
});

test('al editar una medida, el nuevo responsable también tiene que poder ver el caso', async () => {
    const id = await crearAccidente();
    assert.equal((await crearMedida(id)).statusCode, 201);
    const editar = (body) => pedir(gest(), 'PUT', `/incidents/${id}/medidas/1/datos`, body);
    const res = await editar({ responsableId: sinHistorial });
    assert.equal(res.statusCode, 400, res.body);
    assert.equal(guardado(id).medidasCorrectivas[0].responsableId, responsable);
    assert.equal((await editar({ responsableId: prevencionista })).statusCode, 200);
    assert.equal(guardado(id).medidasCorrectivas[0].responsableId, prevencionista);
});

test('si no se puede leer la empresa, el permiso se resuelve con los roles por defecto (no con nadie ni con todos)', async () => {
    const id = await crearAccidente();
    const original = TenantService.prototype.getById;
    TenantService.prototype.getById = async () => { throw new Error('DynamoDB no responde'); };
    try {
        assert.equal((await crearMedida(id, medida({ responsableId: sinHistorial }))).statusCode, 400);
        assert.equal((await crearMedida(id, medida({ responsableId: responsable }))).statusCode, 201);
    } finally {
        TenantService.prototype.getById = original;
    }
});

test('una empresa que le quitó el historial al rol supervisor: su supervisor ya no puede quedar a cargo de una medida', async () => {
    const id = await crearAccidente();
    const sinHistorialElSupervisor = DEFAULT_ROLE_PRESETS.supervisor.filter((p) => p !== 'incidentes.historial');
    await new TenantService().updateConfig(A, { roles: [
        { id: 'supervisor', tipo: 'supervisor', nombre: 'Supervisor', permisos: sinHistorialElSupervisor },
    ] });
    const res = await crearMedida(id, medida({ responsableId: responsable }));
    assert.equal(res.statusCode, 400, res.body);
});

// ─── Hallazgo 7: bloqueo optimista en el estado de una medida y en la gobernanza ─

test('cambiar el estado de una medida mantiene su respuesta ({ incident, medidas }) y 404 si no existe', async () => {
    const id = await crearAccidente();
    await crearMedida(id);
    const res = await pedir(gest(), 'PUT', `/incidents/${id}/medidas/1`, { estado: 'en_proceso' });
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(datos(res).medidas[0].estado, 'en_proceso');
    assert.equal(datos(res).incident.incidentId, id);
    assert.equal(guardado(id).medidasVerificadas, false);
    await pedir(gest(), 'PUT', `/incidents/${id}/medidas/1`, { estado: 'verificada' });
    assert.equal(guardado(id).medidasVerificadas, true);
    assert.equal((await pedir(gest(), 'PUT', `/incidents/${id}/medidas/99`, { estado: 'en_proceso' })).statusCode, 404);
});

test('cambiar el estado de una medida con una escritura concurrente responde 409 y no pisa lo que se guardó', async () => {
    const id = await crearAccidente();
    await crearMedida(id);
    const res = await conCarrera(id, () => pedir(gest(), 'PUT', `/incidents/${id}/medidas/1`, { estado: 'completada' }));
    assert.equal(res.statusCode, 409, res.body);
    assert.equal(guardado(id).medidasCorrectivas[0].estado, 'pendiente', 'no se escribió el estado');
    // Sin carrera, el mismo cambio entra.
    guardado(id).updatedAt = new Date().toISOString();
    assert.equal((await pedir(gest(), 'PUT', `/incidents/${id}/medidas/1`, { estado: 'completada' })).statusCode, 200);
});

test('la gobernanza con una escritura concurrente responde 409, sea para editar o para cerrar, y no escribe', async () => {
    const id = await hallazgoListo();
    const edicion = await conCarrera(id, () => pedir(gest(), 'PUT', `/incidents/${id}/gobernanza`, { estadoCierre: 'en_proceso', plazoRespuestaISO: hoyMas(9) }));
    assert.equal(edicion.statusCode, 409, edicion.body);
    assert.notEqual(guardado(id).gobernanza.plazoRespuestaISO, hoyMas(9));

    guardado(id).updatedAt = new Date().toISOString();
    const cierre = await conCarrera(id, () => pedir(prev(), 'PUT', `/incidents/${id}/gobernanza`, { estadoCierre: 'cerrado', comentarioCierre: 'Listo' }));
    assert.equal(cierre.statusCode, 409, cierre.body);
    assert.equal(guardado(id).gobernanza.estadoCierre, 'en_proceso');
    assert.equal(guardado(id).cierre, undefined);
});

// ─── Hallazgo 8: el resumen de casos lee todas las páginas ───────────────────

/** Hace que la consulta por empresa devuelva de a `tamano` elementos, con `LastEvaluatedKey`. */
const conPaginas = async (tamano, fn) => {
    const original = DynamoDBDocumentClient.prototype.send;
    const consultas = [];
    DynamoDBDocumentClient.prototype.send = async function enviar(cmd) {
        if (cmd.constructor.name === 'QueryCommand' && cmd.input.TableName === process.env.INCIDENTS_TABLE && cmd.input.IndexName === 'tenantId-fecha-index') {
            const todo = (await original.call(this, cmd)).Items;
            const desde = cmd.input.ExclusiveStartKey?.desde || 0;
            consultas.push(desde);
            return { Items: todo.slice(desde, desde + tamano), LastEvaluatedKey: desde + tamano < todo.length ? { desde: desde + tamano } : undefined };
        }
        return original.call(this, cmd);
    };
    try { return await fn(consultas); } finally { DynamoDBDocumentClient.prototype.send = original; }
};

test('casos-resumen entrega TODOS los casos de la obra aunque la consulta venga en varias páginas', async () => {
    const ids = [];
    for (let i = 0; i < 5; i++) ids.push(await crearAccidente({ fecha: `2026-11-0${i + 1}` }));
    await crearAccidente({ obraId: (await new ObraService().crear(A, { nombre: 'Otra obra' })).obraId });
    await conPaginas(2, async (consultas) => {
        const res = await pedir(gest(), 'GET', '/incidents/casos-resumen', undefined, { obraId: obraA });
        assert.equal(res.statusCode, 200, res.body);
        assert.equal(datos(res).length, 5);
        assert.deepEqual(datos(res).map((c) => c.incidentId).sort(), [...ids].sort());
        assert.ok(consultas.length >= 3, `se siguieron las páginas: ${JSON.stringify(consultas)}`);
    });
});

test('el listado, las estadísticas y las medidas de la obra también leen todas las páginas', async () => {
    for (let i = 0; i < 5; i++) await crearAccidente({ fecha: `2026-11-0${i + 1}` });
    await conPaginas(2, async () => {
        const lista = await pedir(gest(), 'GET', '/incidents');
        assert.equal(datos(lista).length, 5);
        const stats = await pedir(gest(), 'GET', '/incidents/stats', undefined, { mes: '2026-11' });
        assert.equal(datos(stats).numeroAccidentes, 5);
    });
});

// ─── Hallazgo 9: lecturas de más ─────────────────────────────────────────────

test('las rutas de gestión no leen ni descifran la traza solo para comprobar pertenencia y estado; la ficha la lee una vez', async () => {
    const id = await crearAccidente();
    const original = DynamoDBDocumentClient.prototype.send;
    const lecturas = [];
    DynamoDBDocumentClient.prototype.send = async function enviar(cmd) {
        if (cmd.constructor.name === 'GetCommand' && cmd.input.TableName === process.env.INCIDENTS_TABLE) lecturas.push(cmd.input.Key.incidentId);
        return original.call(this, cmd);
    };
    try {
        // Una ruta de gestión: ninguna lectura de la traza.
        assert.equal((await triaje(id, { tipo: 'accidente', gravedad: 'leve' })).statusCode, 200);
        assert.deepEqual(lecturas.filter((k) => k.endsWith('#traza')), []);
        assert.equal(lecturas.filter((k) => k === id).length, 1, 'el incidente se lee una vez');
        // El detalle: el incidente una vez y su traza una vez.
        lecturas.length = 0;
        const det = await pedir(gest(), 'GET', `/incidents/${id}`);
        assert.equal(det.statusCode, 200, det.body);
        assert.deepEqual(lecturas.sort(), [id, `${id}#traza`].sort());
        assert.equal(datos(det).trabajador.rut, '17.777.777-3', 'la ficha sigue trayendo la parte sensible');
    } finally {
        DynamoDBDocumentClient.prototype.send = original;
    }
});

// ─── Hallazgo 14: papeles en un caso cerrado ─────────────────────────────────

const subirPapel = async (quien, id, { tipo = 'informe_investigacion', fileType = 'application/pdf', fileName = 'informe.pdf' } = {}) => {
    const paso1 = await pedir(quien, 'POST', `/incidents/${id}/documents`, { tipo, fileType, checksumSha256: HUELLA, tamano: 2048 });
    if (paso1.statusCode !== 200) return { paso1 };
    const { s3Key } = datos(paso1);
    objetos.set(s3Key, { ContentType: fileType, ContentLength: 2048, ChecksumSHA256: HUELLA, VersionId: 'v1' });
    const paso2 = await pedir(quien, 'POST', `/incidents/${id}/documents/confirmar`, { s3Key, fileName });
    return { paso1, paso2, s3Key };
};

/** Un accidente antiguo ya cerrado, sin informe. */
const accidenteCerrado = async () => {
    const id = await crearAccidente({ gravedad: 'leve' });
    const g = guardado(id);
    g.estado = 'cerrado';
    g.cierre = { comentario: 'Cierre anterior', cerradoPor: prevencionista, cerradoEn: '2026-01-01T00:00:00.000Z' };
    return id;
};

test('a un caso cerrado se le puede subir un papel (con incidentes.reportar); el cierre no se toca y queda quién lo subió', async () => {
    const id = await accidenteCerrado();
    const cierreAntes = JSON.stringify(guardado(id).cierre);
    const { paso2 } = await subirPapel(gest(), id);
    assert.equal(paso2.statusCode, 201, paso2.body);
    const g = guardado(id);
    assert.equal(g.papeles.length, 1);
    assert.equal(g.papeles[0].subidoPor, gestora);
    assert.ok(!Number.isNaN(Date.parse(g.papeles[0].subidoEn)));
    assert.equal(g.estado, 'cerrado');
    assert.equal(JSON.stringify(g.cierre), cierreAntes);
    assert.equal(papelesRequeridos(g).find((p) => p.clave === 'informe_investigacion').cumplido, true);
});

test('en un caso cerrado, subir papeles sigue pidiendo incidentes.reportar (403) y las fotos y las medidas siguen cerradas (409)', async () => {
    const id = await accidenteCerrado();
    const soloHistorial = como(prevencionista, 'incidentes.historial');
    assert.equal((await subirPapel(soloHistorial, id)).paso1.statusCode, 403);
    assert.equal((await subirPapel(como(ajena, GESTION, B), id)).paso1.statusCode, 404);
    assert.equal((await subirPapel(como(trabajadora, TRABAJADOR), id)).paso1.statusCode, 404);
    assert.equal((await pedir(gest(), 'POST', `/incidents/${id}/evidencias`, { evidencias: [`tenants/${A}/incidentes/${id}/${UUID}.jpg`] })).statusCode, 409);
    assert.equal((await crearMedida(id)).statusCode, 409);
    assert.equal(guardado(id).papeles.length, 0);
});

// ─── Hallazgo 15: papeles guardados con el contrato anterior ─────────────────

test('la DIAT guardada como documentos.diat cuenta, se ve en la lista de papeles con descarga firmada y no sale por otras respuestas', async () => {
    const id = await crearAccidente({ gravedad: 'leve' });
    const claveAnterior = `tenants/${A}/incidentes/${id}/diat-${UUID}.pdf`;
    guardado(id).documentos = { diat: { s3Key: claveAnterior, fileName: 'DIAT-Juan-Perez.pdf', fileType: 'application/pdf', uploadedAt: '2026-05-01T12:00:00.000Z' } };

    assert.equal(papelesRequeridos(guardado(id)).find((p) => p.clave === 'diat').cumplido, true);
    const lista = await pedir(gest(), 'GET', `/incidents/${id}/documents`);
    assert.equal(lista.statusCode, 200, lista.body);
    const { archivos, requeridos } = datos(lista);
    assert.equal(requeridos.find((p) => p.clave === 'diat').cumplido, true);
    assert.equal(archivos.length, 1);
    assert.equal(archivos[0].tipo, 'diat');
    assert.equal(archivos[0].nombreArchivo, 'DIAT-Juan-Perez.pdf');
    assert.equal(archivos[0].contieneSalud, true, 'la DIAT anterior queda en la auditoría de salud igual que las nuevas');
    assert.match(archivos[0].url, /X-Amz-Signature=/, 'descarga firmada, no una URL directa');
    assert.equal(archivos[0].s3Key, undefined, 'la clave de S3 no sale como dato (solo dentro del enlace firmado)');
    assert.equal(archivos[0].huella, undefined);
    assert.ok(!lista.body.includes('"documentos"'));

    // Ninguna otra respuesta la entrega.
    const detalle = await pedir(gest(), 'GET', `/incidents/${id}`);
    assert.ok(!detalle.body.includes('DIAT-Juan-Perez') && !detalle.body.includes(claveAnterior) && !detalle.body.includes('"documentos"'));
    const resumen = await pedir(gest(), 'GET', '/incidents/casos-resumen', undefined, { obraId: obraA });
    assert.ok(!resumen.body.includes('DIAT-Juan-Perez') && !resumen.body.includes(claveAnterior));
});

test('un papel anterior con la clave de otra empresa o de otro incidente no se acepta (no se firma la descarga de un archivo ajeno)', async () => {
    const id = await crearAccidente({ gravedad: 'leve' });
    const otro = await crearAccidente();
    for (const clave of [`tenants/${B}/incidentes/${id}/diat-${UUID}.pdf`, `tenants/${A}/incidentes/${otro}/diat-${UUID}.pdf`,
        `tenants/${A}/incidentes/${id}/../${otro}/diat-${UUID}.pdf`, 'cualquier/cosa.pdf', 42]) {
        guardado(id).documentos = { diat: { s3Key: clave, fileName: 'x.pdf', fileType: 'application/pdf', uploadedAt: '2026-05-01T00:00:00.000Z' } };
        assert.equal(papelesRequeridos(guardado(id)).find((p) => p.clave === 'diat').cumplido, false, String(clave));
        const lista = await pedir(gest(), 'GET', `/incidents/${id}/documents`);
        assert.deepEqual(datos(lista).archivos, [], String(clave));
    }
});

test('un papel anterior no se duplica con el nuevo del mismo tipo: cada archivo sale una vez', async () => {
    const id = await crearAccidente({ gravedad: 'leve' });
    guardado(id).documentos = { diat: { s3Key: `tenants/${A}/incidentes/${id}/diat-${UUID}.pdf`, fileName: 'vieja.pdf', fileType: 'application/pdf', uploadedAt: '2026-05-01T00:00:00.000Z' } };
    const { paso2 } = await subirPapel(gest(), id, { tipo: 'diat', fileName: 'nueva.pdf' });
    assert.equal(paso2.statusCode, 201, paso2.body);
    const { archivos } = datos(await pedir(gest(), 'GET', `/incidents/${id}/documents`));
    assert.deepEqual(archivos.map((a) => a.nombreArchivo).sort(), ['nueva.pdf', 'vieja.pdf']);
});

// ─── Hallazgo 6 (pantalla): el selector ofrece solo a quien el servidor acepta ─

const personasHandler = require('../handlers/personas-module/handler').personasHandler;
const listarPersonas = (quien, query) => personasHandler({
    rawPath: '/personas', headers: { host: 'api.test' }, queryStringParameters: query,
    requestContext: {
        http: { method: 'GET', path: '/personas', sourceIp: '200.1.2.3' },
        authorizer: { lambda: { sessionId: 's', personaId: quien.personaId, tenantId: quien.tenantId, rol: 'x', permisos: quien.permisos, credencialProvisional: 'false' } },
    },
});

test('GET /personas?conPermiso=incidentes.historial ofrece solo a quien puede ver el caso (lo mismo que acepta una medida)', async () => {
    const res = await listarPersonas(gest(), { conPermiso: 'incidentes.historial' });
    assert.equal(res.statusCode, 200, res.body);
    const ids = datos(res).personas.map((p) => p.personaId);
    for (const quien of [gestora, responsable, prevencionista]) assert.ok(ids.includes(quien), `falta ${quien}`);
    for (const nadie of [sinHistorial, trabajadora, ajena]) assert.ok(!ids.includes(nadie), `sobra ${nadie}`);
    // Y cada una de las ofrecidas es aceptada como responsable de una medida.
    const id = await crearAccidente();
    for (const personaId of ids.filter((x) => [gestora, responsable, prevencionista].includes(x))) {
        assert.equal((await crearMedida(id, medida({ responsableId: personaId }))).statusCode, 201, personaId);
    }
});

test('el filtro por permiso solo existe para incidentes.historial y solo para quien gestiona incidentes', async () => {
    assert.equal((await listarPersonas(gest(), { conPermiso: 'obras.crear' })).statusCode, 400);
    assert.equal((await listarPersonas(gest(), { conPermiso: '__proto__' })).statusCode, 400);
    assert.equal((await listarPersonas(dePersona(), { conPermiso: 'incidentes.historial' })).statusCode, 400);
    // Sin el filtro, el listado sigue igual.
    assert.equal((await listarPersonas(dePersona(), null)).statusCode, 200);
});

test('lo que ofrece el selector (estado=activo y conPermiso) excluye a quien no terminó de enrolarse, aunque su rol tenga el permiso', async () => {
    const pendiente = (await new PersonaService().crear(A, { rut: '13.333.333-9', nombre: 'Nora', rol: 'supervisor' })).persona.personaId;
    const res = await listarPersonas(gest(), { estado: 'activo', conPermiso: 'incidentes.historial' });
    assert.equal(res.statusCode, 200, res.body);
    const ids = datos(res).personas.map((p) => p.personaId);
    assert.ok(ids.includes(responsable));
    assert.ok(!ids.includes(pendiente), 'una persona pendiente no se ofrece');
    // Y el servidor tampoco la acepta como responsable.
    const id = await crearAccidente();
    assert.equal((await crearMedida(id, medida({ responsableId: pendiente }))).statusCode, 400);
});
