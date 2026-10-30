// Consentimiento por finalidad (Ley 21.719, art. 12): se registra por
// separado para cada finalidad, con fecha, versión del texto y estado; se
// revoca tan fácil como se otorga; la revocación tiene efecto real en los
// procesos que dependen de él; y otorgar una finalidad no habilita otra.

process.env.CAMPO_HMAC_KEY = 'clave-de-prueba-hmac';
process.env.CAMPO_CIFRADO_LOCAL_KEY = require('crypto').randomBytes(32).toString('base64');
process.env.CREDENCIAL_PEPPER = 'pimienta-de-prueba';

const { prepararEntorno, crearDobleTablas } = require('./doble-dynamo-tablas');
const esquemas = prepararEntorno();

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { PutCommand } = require('@aws-sdk/lib-dynamodb');

const { docClient } = require('../lib/clients/dynamodb');
const { PersonaService } = require('../lib/services/PersonaService');
const { TenantService } = require('../lib/services/TenantService');
const C = require('../lib/gobernanza/consentimiento');
const derechos = require('../handlers/gobernanza/derechos');

let doble;
let T;
let juan;
let ana;

beforeEach(async () => {
    require('../lib/llaveTenant')._olvidarCache();
    doble = crearDobleTablas(docClient, esquemas);
    T = (await new TenantService().setup({ nombre: 'Constructora Prueba', rutEmpresa: '76.543.210-3' })).tenantId;
    const svc = new PersonaService();
    ana = (await svc.crear(T, { rut: '9.876.543-3', nombre: 'Ana', apellidoPaterno: 'Rojas', rol: 'admin', email: 'ana@ejemplo.cl', password: 'clave-larga-1' })).persona;
    juan = (await svc.crear(T, { rut: '12.345.678-5', nombre: 'Juan', apellidoPaterno: 'Pérez', rol: 'trabajador', password: 'clave-de-juan-1' })).persona;
});
afterEach(() => doble.restaurar());

const AHORA = new Date('2026-10-29T15:00:00Z');
const evento = (p, metodo, ruta, cuerpo, { permisos = '' } = {}) => ({
    requestContext: { http: { method: metodo, sourceIp: '200.1.1.1' }, authorizer: { lambda: { sessionId: 's', personaId: p.personaId, tenantId: T, rol: p.rol, permisos } } },
    rawPath: ruta, body: cuerpo ? JSON.stringify(cuerpo) : undefined, queryStringParameters: {}, pathParameters: {}, headers: {},
});
const pedir = (p, metodo, ruta, cuerpo, opts = {}) => derechos.atender(evento(p, metodo, ruta, cuerpo, opts), { ahora: opts.ahora || AHORA });
const datos = (res) => JSON.parse(res.body).data;
const otorgar = (p, finalidad, extra = {}) => pedir(p, 'POST', `/gobernanza/mis-datos/consentimientos/${finalidad}`, { accion: 'otorgar', version: C.FINALIDADES[finalidad].versionActual, ...extra });
const revocar = (p, finalidad, opts) => pedir(p, 'POST', `/gobernanza/mis-datos/consentimientos/${finalidad}`, { accion: 'revocar' }, opts);
const ficha = (p) => doble.items('PERSONAS_TABLE').find((x) => x.personaId === p.personaId);
const historial = () => doble.items('GOBERNANZA_HISTORIAL_TABLE').filter((h) => h.sk.startsWith('CONS#'));

// ─── Reglas puras ───────────────────────────────────────────────────────────

test('cada finalidad tiene su texto versionado, y la vigencia exige la versión actual', () => {
    for (const [id, f] of Object.entries(C.FINALIDADES)) {
        assert.ok(f.versiones[f.versionActual]?.texto.length > 100, `${id}: texto informado completo`);
    }
    assert.equal(C.consentimientoVigente({ consentimientos: ['foto_perfil@v1'] }, 'foto_perfil'), true);
    assert.equal(C.consentimientoVigente({ consentimientos: ['foto_perfil@v0'] }, 'foto_perfil'), false, 'una versión anterior no vale');
});

test('otorgar una finalidad no habilita ninguna otra', () => {
    const p = { consentimientos: ['foto_perfil@v1'] };
    assert.equal(C.consentimientoVigente(p, 'foto_perfil'), true);
    assert.equal(C.consentimientoVigente(p, 'ficha_basica_salud'), false);
    assert.equal(C.consentimientoVigente(p, 'dictado_voz_ia'), false);
    assert.equal(C.consentimientoVigente(p, '*'), false);
});

test('no se otorga sobre un texto que ya no es el vigente', () => {
    assert.throws(() => C.otorgar(null, { finalidad: 'foto_perfil', version: 'v0' }, { personaId: 'p' }), (e) => e.codigo === 'VERSION_DESACTUALIZADA');
});

test('no hay titulares menores de edad: ni se registran, ni consienten', () => {
    const hoy = new Date('2026-10-29T12:00:00Z');
    assert.match(C.problemaEdadMinima('2010-05-01', hoy), /menor de 18/);
    assert.equal(C.problemaEdadMinima('2008-10-29', hoy), null, 'cumple 18 hoy');
    assert.match(C.problemaEdadMinima('2008-10-30', hoy), /menor de 18/, 'cumple 18 mañana');
    assert.equal(C.problemaEdadMinima(null, hoy), null, 'sin fecha no hay nada que comprobar');
    assert.throws(() => C.otorgar(null, { finalidad: 'foto_perfil', version: 'v1' }, { personaId: 'p', fechaNacimiento: '2012-01-01' }, { ahora: hoy }),
        (e) => e.codigo === 'MENOR_DE_EDAD');
});

test('el alta de una persona menor de 18 años se rechaza con 400', async () => {
    await assert.rejects(new PersonaService().crear(T, { rut: '11.111.111-1', nombre: 'Pedro', rol: 'trabajador', fechaNacimiento: '2011-03-03' }),
        (e) => e.statusCode === 400 && /menor de 18/.test(e.message));
});

// ─── Registro, consulta y revocación ────────────────────────────────────────

test('otorgar registra finalidad, versión, fecha y canal; marca la ficha y deja un evento, en una transacción', async () => {
    const res = await otorgar(juan, 'ficha_basica_salud');
    assert.equal(res.statusCode, 200, res.body);
    const r = doble.items('GOBERNANZA_TABLE').find((x) => x.sk === `CONSENT#${juan.personaId}#ficha_basica_salud`);
    assert.equal(r.estado, 'otorgado');
    assert.equal(r.version, 'v1');
    assert.equal(r.otorgadoEl, AHORA.toISOString());
    assert.equal(r.canal, 'web');
    assert.deepEqual([...ficha(juan).consentimientos], ['ficha_basica_salud@v1']);
    assert.deepEqual(historial().map((h) => h.tipo), ['consentimiento_otorgado']);
    const tx = doble.escrituras.filter((e) => e.tabla === 'GOBERNANZA_HISTORIAL_TABLE');
    assert.ok(tx.every((e) => e.nombre === 'Put'), 'el historial solo crece');
});

test('cada finalidad se decide por separado', async () => {
    await otorgar(juan, 'foto_perfil');
    const v = datos(await pedir(juan, 'GET', '/gobernanza/mis-datos/consentimientos'));
    const estado = Object.fromEntries(v.finalidades.map((f) => [f.finalidad, f.estado]));
    assert.deepEqual(estado, { ficha_basica_salud: 'sin_decision', foto_perfil: 'otorgado', dictado_voz_ia: 'sin_decision' });
    assert.ok(v.basesSinConsentimiento.length >= 3, 'informa lo que se trata sin consentimiento y por qué');
});

test('revocar no pide contraseña, guarda la fecha y conserva el otorgamiento en el historial', async () => {
    await otorgar(juan, 'foto_perfil');
    const res = await revocar(juan, 'foto_perfil', { ahora: new Date('2026-11-02T10:00:00Z') });
    assert.equal(res.statusCode, 200, res.body);
    const r = doble.items('GOBERNANZA_TABLE').find((x) => x.sk === `CONSENT#${juan.personaId}#foto_perfil`);
    assert.equal(r.estado, 'revocado');
    assert.equal(r.otorgadoEl, AHORA.toISOString(), 'el otorgamiento original no se borra');
    assert.equal(r.revocadoEl, '2026-11-02T10:00:00.000Z');
    assert.ok(!('consentimientos' in ficha(juan)), 'la ficha ya no lo marca');
    const h = datos(await pedir(juan, 'GET', '/gobernanza/mis-datos/consentimientos')).historial;
    assert.deepEqual(h.map((x) => x.tipo), ['consentimiento_revocado', 'consentimiento_otorgado']);
});

test('revocar una finalidad deja intactas las demás', async () => {
    await otorgar(juan, 'foto_perfil');
    await otorgar(juan, 'dictado_voz_ia');
    await revocar(juan, 'foto_perfil');
    assert.deepEqual([...ficha(juan).consentimientos], ['dictado_voz_ia@v1']);
});

test('no se otorga dos veces lo mismo ni se revoca lo que no está otorgado', async () => {
    await otorgar(juan, 'foto_perfil');
    assert.equal((await otorgar(juan, 'foto_perfil')).statusCode, 409);
    assert.equal((await revocar(juan, 'dictado_voz_ia')).statusCode, 409);
    assert.equal((await pedir(juan, 'POST', '/gobernanza/mis-datos/consentimientos/marketing', { accion: 'otorgar', version: 'v1' })).statusCode, 404, 'finalidad inexistente');
});

test('cada persona solo decide sobre sus propios consentimientos: el cuerpo no cambia el titular', async () => {
    await pedir(ana, 'POST', '/gobernanza/mis-datos/consentimientos/foto_perfil', { accion: 'otorgar', version: 'v1', personaId: juan.personaId });
    assert.ok(!('consentimientos' in ficha(juan)));
    assert.deepEqual([...ficha(ana).consentimientos], ['foto_perfil@v1']);
});

// ─── La revocación se refleja en los procesos ───────────────────────────────

test('foto de perfil: sin consentimiento no se guarda una nueva, y al revocarlo deja de mostrarse', async () => {
    const personas = require('../handlers/personas-module/handler');
    const subir = () => personas.personasHandler({ ...evento(juan, 'PUT', `/personas/${juan.personaId}`, { fotoPerfil: 'data:image/png;base64,AAAA' }), pathParameters: { id: juan.personaId } });
    assert.equal((await subir()).statusCode, 409);
    await otorgar(juan, 'foto_perfil');
    const ok = await subir();
    assert.equal(ok.statusCode, 200, ok.body);
    assert.equal(datos(ok).persona.fotoPerfil, 'data:image/png;base64,AAAA');
    await revocar(juan, 'foto_perfil');
    const despues = await new PersonaService().getById(juan.personaId);
    assert.equal(despues.toSafeFormat().fotoPerfil, null, 'ninguna respuesta la entrega');
});

test('ficha básica de salud: sin consentimiento no se puede responder, y al revocarlo las respuestas dejan de mostrarse', async () => {
    const encuestas = require('../handlers/surveys/handler');
    const { idEncuestaSalud } = require('../lib/health/healthSurvey');
    const id = idEncuestaSalud(T);
    await docClient.send(new PutCommand({ TableName: 'SURVEYS_TABLE', Item: {
        surveyId: id, tenantId: T, titulo: 'Ficha', preguntas: [],
        recipients: [{ personaId: juan.personaId, workerId: juan.personaId, estado: 'respondida', responses: [{ p: 1, r: 'alergia' }] }],
    } }));
    const responder = await encuestas.updateResponseStatus({ ...evento(juan, 'POST', `/surveys/${id}/responses/${juan.personaId}`, { estado: 'respondida', pin: '1234', responses: [] }), pathParameters: { id, workerId: juan.personaId } });
    assert.equal(responder.statusCode, 403, 'sin consentimiento no se recibe ni un dato');

    const ver = async () => datos(await encuestas.get({ ...evento(ana, 'GET', `/surveys/${id}`, null, { permisos: 'encuestas.crear,persona.vigilancia_salud' }), pathParameters: { id } })).recipients[0];
    await otorgar(juan, 'ficha_basica_salud');
    assert.deepEqual((await ver()).responses, [{ p: 1, r: 'alergia' }]);
    await revocar(juan, 'ficha_basica_salud');
    const retenida = await ver();
    assert.equal(retenida.responses, undefined);
    assert.equal(retenida.respuestasRetenidas, 'sin_consentimiento');
});

test('dictado por voz: sin consentimiento vigente el audio no sale a terceros', async () => {
    const ai = require('../handlers/ai/handler');
    const gemini = require('../lib/ai/gemini');
    const original = gemini.transcribeAudio;
    let enviados = 0;
    gemini.transcribeAudio = async () => { enviados += 1; return 'texto'; };
    try {
        const ev = () => evento(juan, 'POST', '/ai/transcribe', { audio: 'AAAA', mimeType: 'audio/webm' });
        assert.equal((await ai.transcribeAudio(ev())).statusCode, 403);
        assert.equal(enviados, 0);
        await otorgar(juan, 'dictado_voz_ia');
        assert.equal((await ai.transcribeAudio(ev())).statusCode, 200);
        await revocar(juan, 'dictado_voz_ia');
        assert.equal((await ai.transcribeAudio(ev())).statusCode, 403);
        assert.equal(enviados, 1, 'solo mientras estuvo vigente');
    } finally {
        gemini.transcribeAudio = original;
    }
});

test('el historial de consentimientos no guarda el dato que el consentimiento habilita', async () => {
    await otorgar(juan, 'ficha_basica_salud');
    const texto = JSON.stringify(historial());
    assert.ok(!/alerg|diabet|12\.345\.678/.test(texto));
    assert.deepEqual(Object.keys(historial()[0].datos).sort(), ['canal', 'finalidad', 'version']);
});
