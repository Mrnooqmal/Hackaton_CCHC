// Fase 3 del rediseño de incidentes: clasificar, definir medidas y cerrar.
//
//   Reportar → Clasificar (triaje) → Papeles → Medidas → Cerrar
//
// El prevencionista (`incidentes.calificar_accidente`) clasifica y cierra; quien
// gestiona (`incidentes.reportar`) define medidas. Un caso cerrado no acepta
// cambios (ni por las rutas de siempre: `PUT /incidents/{id}`, la gobernanza, las
// investigaciones) salvo reabrirlo con un motivo. Las reglas de qué falta para
// cerrar son las de `lib/casos.js`.

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

const { PersonaService } = require('../lib/services/PersonaService');
const { TenantService } = require('../lib/services/TenantService');
const { ObraService } = require('../lib/services/ObraService');
const { eventBus } = require('../lib/events/EventBus');
const { MAX_MEDIDAS_POR_CASO, MAX_TEXTO_MEDIDA } = require('../lib/casos');
const incidentes = require('../handlers/incidents-module/handler');

let doble; let emitir; let consola;
let A; let B; let obraA;
let gestora; let prevencionista; let responsable; let otraResponsable; let pendiente; let inactiva; let trabajadora; let ajena;

const activar = (personaId, estado = 'activo') => {
    // `crear` deja a la persona `pendiente`; quien terminó de enrolarse queda `activo`.
    doble.items('PERSONAS_TABLE').find((x) => x.personaId === personaId).estado = estado;
};

beforeEach(async () => {
    doble = crearDobleTablas(DynamoDBDocumentClient.prototype, esquemas, { proyecciones: true });
    emitir = eventBus.emit;
    eventBus.emit = async () => {};
    consola = { log: console.log, error: console.error, warn: console.warn };
    console.log = () => {}; console.error = () => {}; console.warn = () => {};

    A = (await new TenantService().setup({ nombre: 'Constructora A', rutEmpresa: '76.543.210-3' })).tenantId;
    B = (await new TenantService().setup({ nombre: 'Constructora B', rutEmpresa: '77.777.777-7' })).tenantId;
    obraA = (await new ObraService().crear(A, { nombre: 'Edificio Los Robles' })).obraId;
    const svc = new PersonaService();
    gestora = (await svc.crear(A, { rut: '12.345.678-5', nombre: 'Sara', rol: 'supervisor' })).persona.personaId;
    prevencionista = (await svc.crear(A, { rut: '9.876.543-3', nombre: 'Pedro', rol: 'prevencionista' })).persona.personaId;
    responsable = (await svc.crear(A, { rut: '15.555.555-6', nombre: 'Ana', apellido: 'Rojas', rol: 'supervisor' })).persona.personaId;
    otraResponsable = (await svc.crear(A, { rut: '16.666.666-K', nombre: 'Luis', rol: 'supervisor' })).persona.personaId;
    pendiente = (await svc.crear(A, { rut: '13.333.333-9', nombre: 'Nora', rol: 'supervisor' })).persona.personaId;
    inactiva = (await svc.crear(A, { rut: '14.444.444-2', nombre: 'Ines', rol: 'supervisor' })).persona.personaId;
    trabajadora = (await svc.crear(A, { rut: '11.111.111-1', nombre: 'Rosa', rol: 'trabajador' })).persona.personaId;
    ajena = (await svc.crear(B, { rut: '22.222.222-2', nombre: 'Otra', rol: 'supervisor' })).persona.personaId;
    for (const p of [gestora, prevencionista, responsable, otraResponsable, ajena]) activar(p);
    activar(inactiva, 'inactivo');
});
afterEach(() => {
    doble.restaurar();
    eventBus.emit = emitir;
    Object.assign(console, consola);
});

const GESTION = 'incidentes.reportar,incidentes.historial';
const PREVENCION = 'incidentes.reportar,incidentes.historial,incidentes.calificar_accidente';
const SOLO_CALIFICAR = 'incidentes.calificar_accidente';
const TRABAJADOR = 'actividades.ver';

const pedir = (quien, metodo, ruta, body) => incidentes.incidentsHandler({
    rawPath: ruta, rawQueryString: '', headers: { host: 'api.test' }, queryStringParameters: null,
    body: body === undefined ? undefined : JSON.stringify(body),
    requestContext: {
        http: { method: metodo, path: ruta, sourceIp: '200.1.2.3' },
        authorizer: { lambda: { sessionId: 's', personaId: quien.personaId, tenantId: quien.tenantId, rol: 'x', permisos: quien.permisos, credencialProvisional: 'false' } },
    },
});
const como = (personaId, permisos, tenantId = A) => ({ personaId, permisos, tenantId });
const gest = () => como(gestora, GESTION);
const prev = () => como(prevencionista, PREVENCION);
const datos = (res) => JSON.parse(res.body).data;
const cuerpo = (res) => JSON.parse(res.body);
const guardado = (id) => doble.items('INCIDENTS_TABLE').find((i) => i.incidentId === id);
const bandejaDe = (personaId) => doble.items('INBOX_TABLE').filter((m) => m.recipientId === personaId);
const avisosDeMedida = (personaId) => doble.items('INBOX_TABLE').filter((m) => m.subject === 'Se te asignó una medida correctiva' && (!personaId || m.recipientId === personaId));

const RELATO = 'Se cayó Juan Pérez desde el andamio del piso 4';
const crear = async (extra = {}) => {
    const res = await pedir(gest(), 'POST', '/incidents', {
        tipo: 'accidente', gravedad: 'grave', descripcion: RELATO, obraId: obraA, centroTrabajo: 'Torre A',
        trabajador: { nombre: 'Juan Pérez', rut: '17.777.777-3' }, ...extra,
    });
    assert.equal(res.statusCode, 201, res.body);
    return datos(res).incidentId;
};
const crearHallazgo = async (quien = como(trabajadora, TRABAJADOR), extra = {}) => {
    const res = await pedir(quien, 'POST', '/incidents', {
        clasificacion: 'hallazgo', tipo: 'condicion_subestandar', descripcion: 'Baranda suelta', obraId: obraA, ...extra,
    });
    assert.equal(res.statusCode, 201, res.body);
    return datos(res).incidentId;
};
const triaje = (id, body, quien = prev()) => pedir(quien, 'PUT', `/incidents/${id}/triaje`, body);
const hoyMas = (dias) => new Date(Date.now() + dias * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
const medida = (extra = {}) => ({ medida: 'Instalar baranda perimetral', causaRaiz: 'Sin protección en el borde', responsableId: responsable, fechaMaxEjecucion: hoyMas(10), ...extra });
const crearMedida = (id, body = medida(), quien = gest()) => pedir(quien, 'POST', `/incidents/${id}/medidas`, body);
const cerrar = (id, body = { comentarioCierre: 'Se corrigió y se verificó en terreno' }, quien = prev()) => pedir(quien, 'PUT', `/incidents/${id}/cerrar`, body);
const papel = (tipo) => ({ papelId: `p-${tipo}`, tipo, nombreArchivo: `${tipo}.pdf`, s3Key: `tenants/${A}/incidentes/x/papeles/${tipo}-x.pdf` });

/** Deja un accidente leve listo para cerrar: clasificado, con DIAT, informe y una medida completada. */
const accidenteListo = async () => {
    const id = await crear({ gravedad: 'leve' });
    assert.equal((await triaje(id, { tipo: 'accidente', gravedad: 'leve' })).statusCode, 200);
    guardado(id).papeles = [papel('diat'), papel('informe_investigacion')];
    assert.equal((await crearMedida(id)).statusCode, 201);
    const est = await pedir(gest(), 'PUT', `/incidents/${id}/medidas/1`, { estado: 'completada' });
    assert.equal(est.statusCode, 200, est.body);
    return id;
};

// ─── Triaje ──────────────────────────────────────────────────────────────────

test('triaje: guarda tipo, gravedad, quién clasificó y cuándo; el reporte pasa a investigación', async () => {
    const id = await crear({ tipo: 'incidente', gravedad: 'leve' });
    assert.equal(guardado(id).estado, 'reportado');
    const res = await triaje(id, { tipo: 'accidente', gravedad: 'grave' });
    assert.equal(res.statusCode, 200, res.body);
    const g = guardado(id);
    assert.equal(g.tipo, 'accidente');
    assert.equal(g.clasificacion, 'incidente');
    assert.equal(g.gravedad, 'grave');
    assert.equal(g.estado, 'en_investigacion');
    assert.equal(g.altoPotencial, false);
    assert.equal(g.triaje.tipo, 'accidente');
    assert.equal(g.triaje.gravedad, 'grave');
    assert.equal(g.triaje.clasificadoPor, prevencionista, 'quién clasifica sale de la sesión');
    assert.ok(!Number.isNaN(Date.parse(g.triaje.clasificadoEn)));
    assert.equal(datos(res).siguientePaso.paso, 'papeles');
    // Lo que se devuelve no incluye los papeles.
    assert.ok(!res.body.includes('"papeles":'));
});

test('triaje: las dos preguntas de alto potencial; con cualquiera en sí, el incidente es de alto potencial y exige informe', async () => {
    const casos = [[true, false, true], [false, true, true], [true, true, true], [false, false, false]];
    for (const [danoMayor, granSusto, esperado] of casos) {
        const id = await crear({ tipo: 'incidente', gravedad: 'leve' });
        const res = await triaje(id, { tipo: 'incidente', gravedad: 'leve', danoMayor, granSusto });
        assert.equal(res.statusCode, 200, res.body);
        const g = guardado(id);
        assert.equal(g.altoPotencial, esperado, `${danoMayor}/${granSusto}`);
        assert.equal(g.triaje.danoMayor, danoMayor);
        assert.equal(g.triaje.granSusto, granSusto);
        const paso = datos(await pedir(gest(), 'GET', `/incidents/${id}`)).siguientePaso.paso;
        assert.equal(paso, esperado ? 'papeles' : 'cerrar', `${danoMayor}/${granSusto}`);
    }
});

test('triaje: un incidente exige responder las dos preguntas con sí o no', async () => {
    const id = await crear({ tipo: 'incidente', gravedad: 'leve' });
    for (const mala of [{}, { danoMayor: true }, { granSusto: false }, { danoMayor: 'si', granSusto: false }, { danoMayor: 1, granSusto: 0 }]) {
        const res = await triaje(id, { tipo: 'incidente', gravedad: 'leve', ...mala });
        assert.equal(res.statusCode, 400, JSON.stringify(mala));
    }
    assert.equal(guardado(id).triaje, undefined);
});

test('triaje: la gravedad vale solo en incidentes y accidentes; en un hallazgo se ignora, y un valor inválido se rechaza', async () => {
    const hallazgo = await crearHallazgo();
    const res = await triaje(hallazgo, { tipo: 'accion_subestandar', gravedad: 'fatal', danoMayor: true, granSusto: true });
    assert.equal(res.statusCode, 200, res.body);
    const h = guardado(hallazgo);
    assert.equal(h.tipo, 'accion_subestandar');
    assert.equal(h.clasificacion, 'hallazgo');
    assert.equal(h.gravedad, 'leve', 'no se toca la gravedad de un hallazgo');
    assert.equal(h.altoPotencial, false, 'un hallazgo no es de alto potencial');
    assert.equal(h.triaje.gravedad, null);
    assert.equal(h.triaje.danoMayor, null);

    const accidente = await crear();
    const mala = await triaje(accidente, { tipo: 'accidente', gravedad: 'catastrofica' });
    assert.equal(mala.statusCode, 400, mala.body);
    const sinGravedad = await triaje(accidente, { tipo: 'accidente' });
    assert.equal(sinGravedad.statusCode, 200, 'sin gravedad se queda con la reportada');
    assert.equal(guardado(accidente).gravedad, 'grave');
    const tipoMalo = await triaje(accidente, { tipo: 'enfermedad_profesional', gravedad: 'leve' });
    assert.equal(tipoMalo.statusCode, 400);
});

test('triaje de un hallazgo: la gobernanza pasa de abierto a en_proceso; el estado del hallazgo no cambia', async () => {
    const id = await crearHallazgo();
    assert.equal(guardado(id).gobernanza.estadoCierre, 'abierto');
    const res = await triaje(id, { tipo: 'condicion_subestandar' });
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(guardado(id).gobernanza.estadoCierre, 'en_proceso');
    assert.equal(guardado(id).estado, 'reportado');
    assert.equal(guardado(id).triaje.clasificacion, 'hallazgo');
});

test('triaje de un hallazgo: puede dejar responsable y plazo; el responsable debe ser de la empresa y estar activo', async () => {
    const id = await crearHallazgo();
    const otra = await triaje(id, { tipo: 'condicion_subestandar', responsableId: ajena });
    assert.equal(otra.statusCode, 404, otra.body);
    for (const mala of [pendiente, inactiva]) {
        const res = await triaje(id, { tipo: 'condicion_subestandar', responsableId: mala });
        assert.equal(res.statusCode, 400, res.body);
    }
    const plazoMalo = await triaje(id, { tipo: 'condicion_subestandar', plazoRespuestaISO: '2026-13-45' });
    assert.equal(plazoMalo.statusCode, 400);
    assert.equal(guardado(id).triaje, undefined, 'nada se guardó');

    const ok = await triaje(id, { tipo: 'condicion_subestandar', responsableId: responsable, plazoRespuestaISO: hoyMas(7), responsableNombre: 'Un nombre falso' });
    assert.equal(ok.statusCode, 200, ok.body);
    assert.equal(guardado(id).gobernanza.responsableId, responsable);
    assert.equal(guardado(id).gobernanza.responsableNombre, 'Ana Rojas', 'el nombre sale de la ficha, no del cliente');
    assert.equal(guardado(id).gobernanza.plazoRespuestaISO, hoyMas(7));
});

test('triaje: reclasificar guarda la anterior; lo primero que queda es lo que declaró quien reportó', async () => {
    const id = await crear({ tipo: 'incidente', gravedad: 'leve' });
    await triaje(id, { tipo: 'incidente', gravedad: 'leve', danoMayor: true, granSusto: false });
    assert.equal(guardado(id).altoPotencial, true);
    await triaje(id, { tipo: 'accidente', gravedad: 'grave' });
    const g = guardado(id);
    assert.equal(g.tipo, 'accidente');
    assert.equal(g.altoPotencial, false, 'al dejar de ser incidente, el alto potencial se reinicia');
    assert.equal(g.triaje.danoMayor, null);
    assert.equal(g.triaje.anteriores.length, 2);
    assert.equal(g.triaje.anteriores[0].origen, 'reporte');
    assert.equal(g.triaje.anteriores[0].tipo, 'incidente');
    assert.equal(g.triaje.anteriores[0].clasificadoPor, gestora, 'quien reportó');
    assert.equal(g.triaje.anteriores[1].tipo, 'incidente');
    assert.equal(g.triaje.anteriores[1].danoMayor, true);
    assert.equal(g.triaje.anteriores[1].clasificadoPor, prevencionista);
    assert.equal(g.triaje.anteriores[1].anteriores, undefined, 'el historial no se anida');
    // Solo se guardan las últimas 20.
    for (let i = 0; i < 25; i++) await triaje(id, { tipo: 'accidente', gravedad: i % 2 ? 'leve' : 'grave' });
    assert.equal(guardado(id).triaje.anteriores.length, 20);
});

test('triaje: se puede reclasificar entre hallazgo e incidente; la clasificación se deriva del tipo', async () => {
    const id = await crearHallazgo();
    const res = await triaje(id, { tipo: 'accidente', gravedad: 'leve' });
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(guardado(id).clasificacion, 'incidente');
    assert.equal(guardado(id).estado, 'en_investigacion');
    const vuelta = await triaje(id, { tipo: 'condicion_subestandar' });
    assert.equal(vuelta.statusCode, 200);
    assert.equal(guardado(id).clasificacion, 'hallazgo');
    assert.equal(guardado(id).gobernanza.estadoCierre, 'en_proceso', 'quien nació incidente recibe su gobernanza');
});

test('triaje: exige incidentes.calificar_accidente (403), no se ve desde otra empresa (404) ni sin poder leer el caso (404)', async () => {
    const id = await crear();
    // Gestiona pero no clasifica.
    assert.equal((await triaje(id, { tipo: 'accidente', gravedad: 'leve' }, gest())).statusCode, 403);
    // Otra empresa: el caso no existe para ella.
    assert.equal((await triaje(id, { tipo: 'accidente', gravedad: 'leve' }, como(ajena, PREVENCION, B))).statusCode, 404);
    // Puede clasificar pero no lee el caso (sin historial y no lo reportó): 404, no 403.
    assert.equal((await triaje(id, { tipo: 'accidente', gravedad: 'leve' }, como(prevencionista, SOLO_CALIFICAR))).statusCode, 404);
    // Un trabajador sin permisos.
    assert.equal((await triaje(id, { tipo: 'accidente', gravedad: 'leve' }, como(trabajadora, TRABAJADOR))).statusCode, 404);
    assert.equal(guardado(id).triaje, undefined);
});

test('la ruta de siempre para calificar como accidente y su botón siguen funcionando', async () => {
    const id = await crear({ tipo: 'incidente', gravedad: 'leve' });
    const res = await pedir(prev(), 'PUT', `/incidents/${id}/calificar-accidente`, {});
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(guardado(id).tipo, 'accidente');
    assert.equal((await pedir(gest(), 'PUT', `/incidents/${id}/calificar-accidente`, {})).statusCode, 403);
});

test('el detalle trae el siguiente paso y el avance; el trabajador que reportó recibe el paso sin ver los papeles', async () => {
    const id = await crearHallazgo();
    const res = await pedir(como(trabajadora, TRABAJADOR), 'GET', `/incidents/${id}`);
    assert.equal(res.statusCode, 200, res.body);
    const d = datos(res);
    assert.equal(d.siguientePaso.paso, 'clasificar');
    assert.equal(d.siguientePaso.permiso, 'incidentes.calificar_accidente');
    assert.ok(d.avance);
    assert.equal(d.papeles, undefined);
});

// ─── Medidas ─────────────────────────────────────────────────────────────────

test('medida: se crea con número correlativo, estado pendiente y el nombre del responsable desde su ficha', async () => {
    const id = await crear();
    const r1 = await crearMedida(id, medida({ responsableNombre: 'Nombre inventado', jerarquia: 'ingenieria', numero: 99, estado: 'verificada' }));
    assert.equal(r1.statusCode, 201, r1.body);
    const m1 = datos(r1).medida;
    assert.equal(m1.numero, 1);
    assert.equal(m1.estado, 'pendiente');
    assert.equal(m1.responsableId, responsable);
    assert.equal(m1.responsableNombre, 'Ana Rojas');
    assert.equal(m1.jerarquia, 'ingenieria');
    assert.equal(m1.medida, 'Instalar baranda perimetral');
    assert.equal(m1.creadaPor, gestora);

    const r2 = await crearMedida(id, medida({ medida: 'Capacitar a la cuadrilla' }));
    assert.equal(datos(r2).medida.numero, 2);
    assert.equal(datos(r2).medidas.length, 2);
    assert.deepEqual(guardado(id).medidasCorrectivas.map((m) => m.numero), [1, 2]);
    // Sin jerarquía es opcional.
    assert.equal(datos(r2).medida.jerarquia, undefined);
});

test('medida: el número sigue al mayor, también con medidas anteriores a la fase (número en texto o sin él)', async () => {
    const id = await crear();
    guardado(id).medidasCorrectivas = [{ numero: '5', medida: 'Antigua', estado: 'pendiente' }, { medida: 'Sin número', estado: 'pendiente' }];
    const res = await crearMedida(id);
    assert.equal(datos(res).medida.numero, 6);
});

test('medida: el responsable debe ser de la empresa (404) y estar activo (400)', async () => {
    const id = await crear();
    assert.equal((await crearMedida(id, medida({ responsableId: ajena }))).statusCode, 404);
    assert.equal((await crearMedida(id, medida({ responsableId: 'no-existe' }))).statusCode, 404);
    assert.equal((await crearMedida(id, medida({ responsableId: pendiente }))).statusCode, 400);
    assert.equal((await crearMedida(id, medida({ responsableId: inactiva }))).statusCode, 400);
    assert.equal((await crearMedida(id, medida({ responsableId: '' }))).statusCode, 400);
    const sin = medida(); delete sin.responsableId;
    assert.equal((await crearMedida(id, sin)).statusCode, 400);
    assert.deepEqual(guardado(id).medidasCorrectivas, []);
    assert.equal(avisosDeMedida().length, 0, 'nada se avisó');
});

test('medida: validación de texto, plazo y nivel de control', async () => {
    const id = await crear();
    const malas = [
        medida({ medida: '' }), medida({ medida: '   ' }), medida({ medida: 5 }),
        medida({ medida: 'x'.repeat(MAX_TEXTO_MEDIDA + 1) }),
        medida({ causaRaiz: 'x'.repeat(MAX_TEXTO_MEDIDA + 1) }),
        medida({ fechaMaxEjecucion: 'mañana' }), medida({ fechaMaxEjecucion: '2026-02-30' }),
        medida({ fechaMaxEjecucion: hoyMas(-5) }),
        medida({ jerarquia: 'rezar' }),
    ];
    const sinPlazo = medida(); delete sinPlazo.fechaMaxEjecucion;
    const sinMedida = medida(); delete sinMedida.medida;
    for (const mala of [...malas, sinPlazo, sinMedida]) {
        const res = await crearMedida(id, mala);
        assert.equal(res.statusCode, 400, JSON.stringify(mala).slice(0, 120));
    }
    // Lo justo en el límite sí.
    assert.equal((await crearMedida(id, medida({ medida: 'x'.repeat(MAX_TEXTO_MEDIDA) }))).statusCode, 201);
    for (const j of ['eliminacion', 'sustitucion', 'ingenieria', 'administrativa', 'epp']) {
        assert.equal((await crearMedida(id, medida({ jerarquia: j }))).statusCode, 201, j);
    }
});

test('medida: tope por caso', async () => {
    const id = await crear();
    guardado(id).medidasCorrectivas = Array.from({ length: MAX_MEDIDAS_POR_CASO }, (_, i) => ({ numero: i + 1, medida: 'm', estado: 'pendiente' }));
    const res = await crearMedida(id);
    assert.equal(res.statusCode, 400, res.body);
    assert.match(cuerpo(res).error, /30 medidas/);
    assert.equal(guardado(id).medidasCorrectivas.length, MAX_MEDIDAS_POR_CASO);
});

test('medida: a la persona responsable le llega un aviso con la medida, la obra, el plazo y el enlace; nunca el relato ni el afectado', async () => {
    const id = await crear();
    const res = await crearMedida(id, medida({ fechaMaxEjecucion: '2099-12-31' }));
    assert.equal(res.statusCode, 201, res.body);
    const avisos = avisosDeMedida(responsable);
    assert.equal(avisos.length, 1);
    const [aviso] = avisos;
    assert.deepEqual(aviso.linkedEntity, { type: 'incident', id });
    assert.match(aviso.content, /Instalar baranda perimetral/);
    assert.match(aviso.content, /Edificio Los Robles/);
    assert.match(aviso.content, /31-12-2099/);
    const texto = JSON.stringify(aviso);
    for (const prohibido of ['Juan', 'Pérez', '17.777.777', '17777777', 'andamio', 'Sin protección', 'piso 4']) {
        assert.ok(!texto.includes(prohibido), `el aviso contiene "${prohibido}": ${texto}`);
    }
    // A nadie más.
    assert.equal(avisosDeMedida(gestora).length, 0);
    assert.equal(avisosDeMedida(prevencionista).length, 0);
});

test('medida: no se avisa a quien se la asigna a sí misma, y un aviso caído no bota la creación', async () => {
    const id = await crear();
    const propia = await crearMedida(id, medida({ responsableId: gestora }));
    assert.equal(propia.statusCode, 201, propia.body);
    assert.equal(avisosDeMedida(gestora).length, 0);

    // Si la bandeja falla, la medida igual queda.
    const original = DynamoDBDocumentClient.prototype.send;
    DynamoDBDocumentClient.prototype.send = async function enviar(cmd) {
        if (cmd.constructor.name === 'PutCommand' && cmd.input.TableName === process.env.INBOX_TABLE) throw new Error('bandeja caída');
        return original.call(this, cmd);
    };
    try {
        const res = await crearMedida(id, medida({ responsableId: otraResponsable }));
        assert.equal(res.statusCode, 201, res.body);
    } finally {
        DynamoDBDocumentClient.prototype.send = original;
    }
    assert.equal(guardado(id).medidasCorrectivas.length, 2);
    assert.equal(avisosDeMedida(otraResponsable).length, 0);
});

test('medida: exige incidentes.reportar (403), y 404 desde otra empresa o sin poder leer el caso', async () => {
    const id = await crear();
    assert.equal((await crearMedida(id, medida(), como(prevencionista, 'incidentes.historial'))).statusCode, 403);
    assert.equal((await crearMedida(id, medida(), como(ajena, GESTION, B))).statusCode, 404);
    assert.equal((await crearMedida(id, medida(), como(responsable, 'incidentes.reportar'))).statusCode, 404, 'sin historial no lee el caso');
    assert.equal((await crearMedida(id, medida(), como(trabajadora, TRABAJADOR))).statusCode, 404);
    assert.deepEqual(guardado(id).medidasCorrectivas, []);
});

test('medida: se edita texto, plazo, responsable y nivel mientras no esté completada', async () => {
    const id = await crear();
    await crearMedida(id, medida({ jerarquia: 'epp' }));
    const editar = (body, quien = gest(), n = 1) => pedir(quien, 'PUT', `/incidents/${id}/medidas/${n}/datos`, body);

    const r = await editar({ medida: 'Baranda y red de seguridad', fechaMaxEjecucion: hoyMas(20), jerarquia: 'ingenieria', causaRaiz: '' });
    assert.equal(r.statusCode, 200, r.body);
    let m = guardado(id).medidasCorrectivas[0];
    assert.equal(m.medida, 'Baranda y red de seguridad');
    assert.equal(m.fechaMaxEjecucion, hoyMas(20));
    assert.equal(m.jerarquia, 'ingenieria');
    assert.equal(m.causaRaiz, '');
    assert.equal(m.numero, 1);
    assert.equal(m.estado, 'pendiente');
    assert.equal(m.editadaPor, gestora);
    assert.equal(avisosDeMedida(responsable).length, 1, 'cambiar el texto no vuelve a avisar');

    // Cambiar de responsable avisa a la nueva persona; el nombre sale de la ficha.
    const cambio = await editar({ responsableId: otraResponsable, responsableNombre: 'Falso' });
    assert.equal(cambio.statusCode, 200, cambio.body);
    m = guardado(id).medidasCorrectivas[0];
    assert.equal(m.responsableId, otraResponsable);
    assert.equal(m.responsableNombre, 'Luis');
    assert.equal(avisosDeMedida(otraResponsable).length, 1);

    // Nada de otra empresa, pendientes o inactivos.
    assert.equal((await editar({ responsableId: ajena })).statusCode, 404);
    assert.equal((await editar({ responsableId: pendiente })).statusCode, 400);
    assert.equal((await editar({ responsableId: inactiva })).statusCode, 400);
    assert.equal(guardado(id).medidasCorrectivas[0].responsableId, otraResponsable);

    // Datos inválidos, sin cambios y medida inexistente.
    assert.equal((await editar({ medida: '' })).statusCode, 400);
    assert.equal((await editar({ fechaMaxEjecucion: 'x' })).statusCode, 400);
    assert.equal((await editar({ jerarquia: 'rezar' })).statusCode, 400);
    assert.equal((await editar({})).statusCode, 400);
    assert.equal((await editar({ medida: 'otra' }, gest(), 9)).statusCode, 404);
    // Quitar el nivel de control.
    assert.equal((await editar({ jerarquia: null })).statusCode, 200);
    assert.equal(guardado(id).medidasCorrectivas[0].jerarquia, null);

    // Permisos.
    assert.equal((await editar({ medida: 'x' }, como(prevencionista, 'incidentes.historial'))).statusCode, 403);
    assert.equal((await editar({ medida: 'x' }, como(ajena, GESTION, B))).statusCode, 404);
});

test('medida: una medida completada no se edita; un plazo conservado no se vuelve a exigir a futuro', async () => {
    const id = await crear();
    await crearMedida(id, medida());
    // Un plazo que ya venció (se creó con tiempo) no impide corregir el texto si el plazo no cambia.
    guardado(id).medidasCorrectivas[0].fechaMaxEjecucion = hoyMas(-30);
    const r = await pedir(gest(), 'PUT', `/incidents/${id}/medidas/1/datos`, { medida: 'Texto corregido', fechaMaxEjecucion: hoyMas(-30) });
    assert.equal(r.statusCode, 200, r.body);
    // Pero un plazo nuevo en el pasado, no.
    assert.equal((await pedir(gest(), 'PUT', `/incidents/${id}/medidas/1/datos`, { fechaMaxEjecucion: hoyMas(-3) })).statusCode, 400);

    await pedir(gest(), 'PUT', `/incidents/${id}/medidas/1`, { estado: 'completada' });
    const bloqueada = await pedir(gest(), 'PUT', `/incidents/${id}/medidas/1/datos`, { medida: 'Otro texto' });
    assert.equal(bloqueada.statusCode, 409, bloqueada.body);
    assert.equal(guardado(id).medidasCorrectivas[0].medida, 'Texto corregido');
});

test('medida: la ruta de siempre para cambiar el estado sigue funcionando y la forma del dato no cambia', async () => {
    const id = await crear();
    await crearMedida(id);
    const res = await pedir(gest(), 'PUT', `/incidents/${id}/medidas/1`, { estado: 'en_proceso' });
    assert.equal(res.statusCode, 200, res.body);
    const m = guardado(id).medidasCorrectivas[0];
    assert.equal(m.estado, 'en_proceso');
    for (const campo of ['numero', 'causaRaiz', 'medida', 'responsableId', 'responsableNombre', 'fechaMaxEjecucion', 'estado']) assert.ok(campo in m, campo);
    assert.equal((await pedir(gest(), 'PUT', `/incidents/${id}/medidas/1`, { estado: 'inventado' })).statusCode, 400);
});

// ─── Cierre ──────────────────────────────────────────────────────────────────

test('cierre: se rechaza con la lista de lo que falta, en frases legibles, y no se cierra nada', async () => {
    const id = await crear();
    const res = await cerrar(id);
    assert.equal(res.statusCode, 409, res.body);
    const { error, pendientes } = cuerpo(res);
    assert.ok(Array.isArray(pendientes) && pendientes.length > 0);
    for (const esperada of ['Clasificar el reporte (tipo y gravedad).', 'Falta: DIAT.', 'Falta: Al menos una medida correctiva.']) {
        assert.ok(pendientes.includes(esperada), `${esperada} en ${JSON.stringify(pendientes)}`);
    }
    assert.ok(pendientes.some((p) => /Constancia del aviso/.test(p)), 'es un accidente grave');
    assert.match(error, /Todavía no se puede cerrar/);
    for (const p of pendientes) assert.ok(error.includes(p), 'el mensaje trae cada pendiente');
    assert.equal(guardado(id).estado, 'reportado');
    assert.equal(guardado(id).cierre, undefined);
});

test('cierre: una medida sin completar lo impide', async () => {
    const id = await accidenteListo();
    await crearMedida(id, medida({ medida: 'Reponer señalética' }));
    const res = await cerrar(id);
    assert.equal(res.statusCode, 409, res.body);
    assert.deepEqual(cuerpo(res).pendientes, ['Una medida sigue sin completar: Reponer señalética.']);
});

test('cierre: con todo completo se cierra; queda quién, cuándo y el comentario, y el caso deja de admitir cambios', async () => {
    const id = await accidenteListo();
    assert.equal(datos(await pedir(gest(), 'GET', `/incidents/${id}`)).siguientePaso.paso, 'cerrar');
    const res = await cerrar(id, { comentarioCierre: '  Medidas verificadas en terreno  ' });
    assert.equal(res.statusCode, 200, res.body);
    const g = guardado(id);
    assert.equal(g.estado, 'cerrado');
    assert.equal(g.cierre.comentario, 'Medidas verificadas en terreno');
    assert.equal(g.cierre.cerradoPor, prevencionista, 'quién cierra sale de la sesión');
    assert.ok(!Number.isNaN(Date.parse(g.cierre.cerradoEn)));
    assert.equal(datos(res).siguientePaso.paso, 'cerrado');
    assert.ok(!res.body.includes('"papeles":'));
    assert.equal(datos(await pedir(gest(), 'GET', `/incidents/${id}`)).siguientePaso.paso, 'cerrado');
    // Cerrar de nuevo no es posible.
    assert.equal((await cerrar(id)).statusCode, 409);
});

test('cierre: un incidente sin alto potencial se cierra con solo estar clasificado', async () => {
    const id = await crear({ tipo: 'incidente', gravedad: 'leve' });
    assert.equal((await cerrar(id)).statusCode, 409, 'sin clasificar no cierra');
    await triaje(id, { tipo: 'incidente', gravedad: 'leve', danoMayor: false, granSusto: false });
    assert.equal((await cerrar(id)).statusCode, 200);
    assert.equal(guardado(id).estado, 'cerrado');
});

test('cierre: un incidente de alto potencial exige el informe de investigación', async () => {
    const id = await crear({ tipo: 'incidente', gravedad: 'leve' });
    await triaje(id, { tipo: 'incidente', gravedad: 'leve', danoMayor: true, granSusto: false });
    const res = await cerrar(id);
    assert.equal(res.statusCode, 409);
    assert.deepEqual(cuerpo(res).pendientes, ['Falta: Informe de investigación.']);
    guardado(id).papeles = [papel('informe_investigacion')];
    assert.equal((await cerrar(id)).statusCode, 200);
});

test('cierre de un hallazgo: el comentario viaja en la misma petición, y queda en la gobernanza con quién verificó y cuándo', async () => {
    const id = await crearHallazgo(como(trabajadora, TRABAJADOR), { responsableId: responsable, plazoRespuestaISO: hoyMas(5) });
    guardado(id).evidencias = [`tenants/${A}/incidentes/${id}/0b6f1c2e-3d4a-4b5c-8d9e-0f1a2b3c4d5e.jpg`];
    // Sin clasificar no cierra.
    assert.equal((await cerrar(id)).statusCode, 409);
    await triaje(id, { tipo: 'condicion_subestandar' });
    assert.equal(datos(await pedir(gest(), 'GET', `/incidents/${id}`)).siguientePaso.paso, 'cerrar', 'el comentario de cierre no bloquea el paso');
    // Sin comentario, 400.
    assert.equal((await cerrar(id, {})).statusCode, 400);
    assert.equal((await cerrar(id, { comentarioCierre: '   ' })).statusCode, 400);
    assert.equal((await cerrar(id, { comentarioCierre: 'x'.repeat(1001) })).statusCode, 400);
    const res = await cerrar(id, { comentarioCierre: 'Se reparó la baranda' });
    assert.equal(res.statusCode, 200, res.body);
    const g = guardado(id);
    assert.equal(g.gobernanza.estadoCierre, 'cerrado');
    assert.equal(g.gobernanza.comentarioCierre, 'Se reparó la baranda');
    assert.equal(g.gobernanza.verificadoPor, prevencionista);
    assert.ok(g.gobernanza.fechaVerificacion);
    assert.equal(g.cierre.cerradoPor, prevencionista);
    assert.equal(g.estado, 'reportado', 'el hallazgo no usa el estado');
});

test('cierre: un hallazgo sin foto, o sin responsable y plazo, no cierra', async () => {
    const id = await crearHallazgo();
    await triaje(id, { tipo: 'condicion_subestandar' });
    const res = await cerrar(id);
    assert.equal(res.statusCode, 409);
    assert.deepEqual(cuerpo(res).pendientes, ['Falta: Al menos una foto del hallazgo.', 'Falta: Responsable y plazo.']);
});

test('cierre y reapertura: solo con incidentes.calificar_accidente (403); 404 desde otra empresa o sin leer el caso', async () => {
    const id = await accidenteListo();
    assert.equal((await cerrar(id, undefined, gest())).statusCode, 403);
    assert.equal((await cerrar(id, undefined, como(ajena, PREVENCION, B))).statusCode, 404);
    assert.equal((await cerrar(id, undefined, como(prevencionista, SOLO_CALIFICAR))).statusCode, 404);
    assert.equal(guardado(id).estado, 'en_investigacion');
    await cerrar(id);
    const reabrir = (quien) => pedir(quien, 'PUT', `/incidents/${id}/reabrir`, { motivo: 'Faltó una medida' });
    assert.equal((await reabrir(gest())).statusCode, 403);
    assert.equal((await reabrir(como(ajena, PREVENCION, B))).statusCode, 404);
    assert.equal(guardado(id).estado, 'cerrado');
});

// Los papeles sí se pueden subir en un caso cerrado (ver tests/incidentes-revision.test.js).
test('un caso cerrado no acepta triaje, medidas, fotos, investigaciones ni gobernanza', async () => {
    const id = await accidenteListo();
    assert.equal((await cerrar(id)).statusCode, 200);
    const antes = JSON.stringify(guardado(id));

    const respuestas = {
        triaje: await triaje(id, { tipo: 'accidente', gravedad: 'fatal' }),
        medidaNueva: await crearMedida(id),
        medidaEditada: await pedir(gest(), 'PUT', `/incidents/${id}/medidas/1/datos`, { medida: 'Otra' }),
        fotoSubida: await pedir(gest(), 'POST', '/incidents/upload-evidence', { incidentId: id, fileName: 'a.jpg', fileType: 'image/jpeg', checksumSha256: Buffer.alloc(32, 7).toString('base64') }),
        gobernanza: await pedir(gest(), 'PUT', `/incidents/${id}/gobernanza`, { estadoCierre: 'abierto' }),
        foto: await pedir(gest(), 'POST', `/incidents/${id}/evidencias`, { evidencias: [`tenants/${A}/incidentes/${id}/0b6f1c2e-3d4a-4b5c-8d9e-0f1a2b3c4d5e.jpg`] }),
        update: await pedir(gest(), 'PUT', `/incidents/${id}`, { estado: 'en_investigacion' }),
        investigacion: await pedir(gest(), 'POST', `/incidents/${id}/investigations`, { tipo: 'prevencionista', hallazgos: 'a', recomendaciones: 'b', medidas: ['c'] }),
        calificar: await pedir(prev(), 'PUT', `/incidents/${id}/calificar-accidente`, {}),
    };
    for (const [nombre, res] of Object.entries(respuestas)) assert.equal(res.statusCode, 409, `${nombre}: ${res.body}`);
    assert.equal(JSON.stringify(guardado(id)), antes, 'el caso no cambió');

    // Sí se puede seguir verificando una medida completada.
    const verificar = await pedir(gest(), 'PUT', `/incidents/${id}/medidas/1`, { estado: 'verificada' });
    assert.equal(verificar.statusCode, 200, verificar.body);
    // Pero no devolverla a pendiente.
    const volver = await pedir(gest(), 'PUT', `/incidents/${id}/medidas/1`, { estado: 'pendiente' });
    assert.equal(volver.statusCode, 409);
});

test('un hallazgo cerrado tampoco acepta cambios por la gobernanza (no se reabre por ahí)', async () => {
    const id = await crearHallazgo(como(trabajadora, TRABAJADOR), { responsableId: responsable, plazoRespuestaISO: hoyMas(5) });
    guardado(id).evidencias = ['k'];
    await triaje(id, { tipo: 'condicion_subestandar' });
    assert.equal((await cerrar(id)).statusCode, 200);
    const res = await pedir(gest(), 'PUT', `/incidents/${id}/gobernanza`, { estadoCierre: 'abierto' });
    assert.equal(res.statusCode, 409, res.body);
    assert.equal(guardado(id).gobernanza.estadoCierre, 'cerrado');
});

test('PUT /incidents/{id} no cierra el caso: el cierre tiene sus reglas', async () => {
    const id = await crear();
    const res = await pedir(gest(), 'PUT', `/incidents/${id}`, { estado: 'cerrado' });
    assert.equal(res.statusCode, 400, res.body);
    assert.equal(guardado(id).estado, 'reportado');
    // Otros cambios siguen igual.
    assert.equal((await pedir(gest(), 'PUT', `/incidents/${id}`, { diasPerdidos: 3 })).statusCode, 200);
});

test('la gobernanza no cierra un hallazgo sin cumplir lo mismo que el cierre del caso', async () => {
    const id = await crearHallazgo(como(trabajadora, TRABAJADOR), { responsableId: responsable, plazoRespuestaISO: hoyMas(5) });
    // Quien cierra tiene el permiso de cierre (incidentes.calificar_accidente): sin él, ni se mira lo que falta.
    const cerrarPorGobernanza = (extra = {}) => pedir(prev(), 'PUT', `/incidents/${id}/gobernanza`, { estadoCierre: 'cerrado', comentarioCierre: 'Reparado', ...extra });

    // Sin clasificar y sin foto: 409 con la lista.
    const r1 = await cerrarPorGobernanza();
    assert.equal(r1.statusCode, 409, r1.body);
    assert.deepEqual(cuerpo(r1).pendientes, ['Clasificar el reporte (tipo y gravedad).', 'Falta: Al menos una foto del hallazgo.']);
    assert.equal(guardado(id).gobernanza.estadoCierre, 'abierto');

    // Con una medida sin completar, tampoco.
    guardado(id).evidencias = ['k'];
    await triaje(id, { tipo: 'condicion_subestandar' });
    await crearMedida(id);
    const r2 = await cerrarPorGobernanza();
    assert.equal(r2.statusCode, 409);
    assert.deepEqual(cuerpo(r2).pendientes, ['Una medida sigue sin completar: Instalar baranda perimetral.']);
    assert.equal(guardado(id).gobernanza.estadoCierre, 'en_proceso');

    // Sin comentario tampoco (ni en el guardado ni en la petición).
    await pedir(gest(), 'PUT', `/incidents/${id}/medidas/1`, { estado: 'verificada' });
    const r3 = await pedir(prev(), 'PUT', `/incidents/${id}/gobernanza`, { estadoCierre: 'cerrado' });
    assert.equal(r3.statusCode, 409);
    assert.deepEqual(cuerpo(r3).pendientes, ['Falta: Comentario de cierre.']);

    // Con todo, cierra y registra a quien verifica.
    const ok = await cerrarPorGobernanza();
    assert.equal(ok.statusCode, 200, ok.body);
    assert.equal(guardado(id).gobernanza.estadoCierre, 'cerrado');
    assert.equal(guardado(id).gobernanza.verificadoPor, prevencionista);
    assert.equal(guardado(id).cierre.cerradoPor, prevencionista, 'el cierre por gobernanza también deja `cierre`');
    // Cambiar el estado sin cerrar sigue sin exigir nada.
    const otro = await crearHallazgo();
    assert.equal((await pedir(gest(), 'PUT', `/incidents/${otro}/gobernanza`, { estadoCierre: 'en_proceso' })).statusCode, 200);
});

// ─── Reapertura ──────────────────────────────────────────────────────────────

test('reabrir: exige motivo, deja el cierre anterior registrado y el caso vuelve a admitir cambios', async () => {
    const id = await accidenteListo();
    assert.equal((await pedir(prev(), 'PUT', `/incidents/${id}/reabrir`, { motivo: 'x' })).statusCode, 409, 'no está cerrado');
    await cerrar(id, { comentarioCierre: 'Cierre inicial' });

    assert.equal((await pedir(prev(), 'PUT', `/incidents/${id}/reabrir`, {})).statusCode, 400);
    assert.equal((await pedir(prev(), 'PUT', `/incidents/${id}/reabrir`, { motivo: '  ' })).statusCode, 400);
    assert.equal((await pedir(prev(), 'PUT', `/incidents/${id}/reabrir`, { motivo: 'x'.repeat(501) })).statusCode, 400);
    assert.equal(guardado(id).estado, 'cerrado');

    const res = await pedir(prev(), 'PUT', `/incidents/${id}/reabrir`, { motivo: 'Faltó verificar una medida' });
    assert.equal(res.statusCode, 200, res.body);
    const g = guardado(id);
    assert.equal(g.estado, 'en_investigacion');
    assert.equal(g.cierre, null);
    assert.equal(g.reaperturas.length, 1);
    assert.equal(g.reaperturas[0].motivo, 'Faltó verificar una medida');
    assert.equal(g.reaperturas[0].reabiertoPor, prevencionista);
    assert.equal(g.reaperturas[0].cierreAnterior.comentario, 'Cierre inicial');
    assert.equal(datos(res).siguientePaso.paso, 'cerrar');

    assert.equal((await crearMedida(id)).statusCode, 201, 'vuelve a admitir cambios');
    assert.equal(datos(await pedir(gest(), 'GET', `/incidents/${id}`)).siguientePaso.paso, 'medidas');
});

test('reabrir un hallazgo: la gobernanza vuelve a en_proceso y se limpia la verificación', async () => {
    const id = await crearHallazgo(como(trabajadora, TRABAJADOR), { responsableId: responsable, plazoRespuestaISO: hoyMas(5) });
    guardado(id).evidencias = ['k'];
    await triaje(id, { tipo: 'condicion_subestandar' });
    await cerrar(id, { comentarioCierre: 'Listo' });
    assert.equal(guardado(id).gobernanza.estadoCierre, 'cerrado');
    const res = await pedir(prev(), 'PUT', `/incidents/${id}/reabrir`, { motivo: 'Volvió a aflojarse' });
    assert.equal(res.statusCode, 200, res.body);
    const g = guardado(id).gobernanza;
    assert.equal(g.estadoCierre, 'en_proceso');
    assert.equal(g.verificadoPor, null);
    assert.equal(g.fechaVerificacion, null);
    assert.equal(guardado(id).reaperturas[0].cierreAnterior.cerradoPor, prevencionista);
});

// ─── Arreglo de la fase 1: `create` no guarda las evidencias del cliente ──────

test('create ignora las evidencias que manda el cliente (también en el reporte flash)', async () => {
    const ajenas = [`tenants/${B}/incidentes/otro/0b6f1c2e-3d4a-4b5c-8d9e-0f1a2b3c4d5e.jpg`, '../../etc/passwd'];
    const hallazgo = await crearHallazgo(como(trabajadora, TRABAJADOR), { evidencias: ajenas });
    assert.deepEqual(guardado(hallazgo).evidencias, []);

    const flash = await pedir(gest(), 'POST', '/incidents', {
        clasificacion: 'incidente', tipo: 'incidente', esFlash: true, descripcionBreve: 'Caída leve', obraId: obraA, evidencias: ajenas,
        afectados: [{ nombre: 'Juan Pérez', rut: '17.777.777-3' }],
    });
    assert.equal(flash.statusCode, 201, flash.body);
    assert.deepEqual(guardado(datos(flash).incidentId).evidencias, []);
    assert.ok(!flash.body.includes('passwd'));
    assert.ok(!JSON.stringify(doble.items('INCIDENTS_TABLE')).includes('passwd'), 'tampoco en la parte sensible');

    // Las fotos siguen entrando por la ruta que las valida.
    const clave = `tenants/${A}/incidentes/${hallazgo}/0b6f1c2e-3d4a-4b5c-8d9e-0f1a2b3c4d5e.jpg`;
    const adj = await pedir(como(trabajadora, TRABAJADOR), 'POST', `/incidents/${hallazgo}/evidencias`, { evidencias: [clave] });
    assert.equal(adj.statusCode, 200, adj.body);
    assert.deepEqual(guardado(hallazgo).evidencias, [clave]);
});

test('el reporte rápido tampoco guarda evidencias del cliente', async () => {
    const res = await pedir(como(trabajadora, TRABAJADOR), 'POST', '/incidents/quick-report', {
        tipo: 'condicion_subestandar', centroTrabajo: 'Torre A', descripcion: 'Baranda suelta',
        evidencias: [`tenants/${B}/incidentes/otro/0b6f1c2e-3d4a-4b5c-8d9e-0f1a2b3c4d5e.jpg`],
    });
    assert.equal(res.statusCode, 201, res.body);
    const guardadoRapido = doble.items('INCIDENTS_TABLE').find((i) => i.origenReporte === 'qr_publico');
    assert.deepEqual(guardadoRapido.evidencias, []);
});
