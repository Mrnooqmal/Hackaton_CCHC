// Ejercicio de derechos por el propio titular ("Mis datos y privacidad") y su
// flujo completo: recepción, verificación de identidad, evaluación, ejecución o
// respuesta fundada, y cierre. Lo que se fija:
//   - nada sensible sin volver a escribir la contraseña, y tres errores cierran
//     las sesiones de la cuenta;
//   - la exportación trae lo del titular y nada de terceros ni interno, con
//     límite diario, y no sale si la auditoría no la registra;
//   - la rectificación se valida, se aplica en la misma escritura que la
//     respuesta, se propaga a los incidentes y no deja los valores propuestos;
//   - acoger exige identidad verificada;
//   - la supresión pasa por su lote de dos personas y alcanza la ficha de salud.

process.env.CAMPO_HMAC_KEY = 'clave-de-prueba-hmac';
process.env.CAMPO_CIFRADO_LOCAL_KEY = require('crypto').randomBytes(32).toString('base64');
process.env.CREDENCIAL_PEPPER = 'pimienta-de-prueba';
process.env.CREDENCIAL_SCRYPT_LN = '10';   // rápido en pruebas; el costo real se prueba en credenciales.test.js

const { prepararEntorno, crearDobleTablas } = require('./doble-dynamo-tablas');
const esquemas = prepararEntorno();

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { PutCommand } = require('@aws-sdk/lib-dynamodb');

const { docClient } = require('../lib/clients/dynamodb');
const { PersonaService } = require('../lib/services/PersonaService');
const { TenantService } = require('../lib/services/TenantService');
const cifradoCampo = require('../lib/cifradoCampo');
const { construirDestinatario, llaveDe, llaveSaludDe } = require('../lib/arregloSensible');
const { idEncuestaSalud } = require('../lib/health/healthSurvey');
const derechos = require('../handlers/gobernanza/derechos');
const lotes = require('../handlers/gobernanza/lotes');

let doble;
let T;
let ana;      // administradora
let berta;    // segunda persona con permiso de supresión
let juan;     // titular
let pedro;    // compañero de Juan

const CLAVE_JUAN = 'clave-de-juan-1';
const RUT_JUAN = '12.345.678-5';

beforeEach(async () => {
    require('../lib/llaveTenant')._olvidarCache();
    doble = crearDobleTablas(docClient, esquemas);
    T = (await new TenantService().setup({ nombre: 'Constructora Prueba', rutEmpresa: '76.543.210-3' })).tenantId;
    const svc = new PersonaService();
    ana = (await svc.crear(T, { rut: '9.876.543-3', nombre: 'Ana', apellidoPaterno: 'Rojas', rol: 'admin', email: 'ana@ejemplo.cl', password: 'clave-larga-1' })).persona;
    berta = (await svc.crear(T, { rut: '7.654.321-6', nombre: 'Berta', apellidoPaterno: 'Soto', rol: 'admin', password: 'clave-larga-2' })).persona;
    juan = (await svc.crear(T, { rut: RUT_JUAN, nombre: 'Juan', apellidoPaterno: 'Pérez', rol: 'trabajador', email: 'juan@ejemplo.cl', telefono: '+56 9 1234 5678', password: CLAVE_JUAN })).persona;
    pedro = (await svc.crear(T, { rut: '11.111.111-1', nombre: 'Pedro', apellidoPaterno: 'Lagos', rol: 'trabajador', password: 'clave-de-pedro-1' })).persona;
});
afterEach(() => doble.restaurar());

const AHORA = new Date('2026-10-29T15:00:00Z');
const GESTION = 'empresa.derechos_titulares';
const evento = (p, metodo, ruta, cuerpo, { permisos = '', tenant = T } = {}) => ({
    requestContext: { http: { method: metodo, sourceIp: '200.1.1.1' }, authorizer: { lambda: { sessionId: 's', personaId: p.personaId, tenantId: tenant, rol: p.rol, permisos } } },
    rawPath: ruta, body: cuerpo ? JSON.stringify(cuerpo) : undefined, queryStringParameters: {}, headers: {},
});
const pedir = (p, metodo, ruta, cuerpo, opts = {}) => derechos.atender(evento(p, metodo, ruta, cuerpo, opts), { ahora: opts.ahora || AHORA });
const pedirLote = (p, metodo, ruta, cuerpo, opts = {}) => lotes.atender(evento(p, metodo, ruta, cuerpo, { permisos: 'empresa.supresion_datos', ...opts }), { ahora: opts.ahora || AHORA });
const datos = (res) => JSON.parse(res.body).data;
const auditoria = () => doble.items('AUDITORIA_ACCESOS_TABLE').filter((e) => e.operacion);
const operaciones = () => auditoria().map((e) => e.operacion);
const exportar = (password = CLAVE_JUAN, opts) => pedir(juan, 'POST', '/gobernanza/mis-datos/exportacion', { password }, opts);

// ─── Verificación de identidad ──────────────────────────────────────────────

test('sin volver a escribir la contraseña no se exporta nada', async () => {
    assert.equal((await pedir(juan, 'POST', '/gobernanza/mis-datos/exportacion', {})).statusCode, 400);
    const mal = await exportar('no-es-mi-clave');
    assert.equal(mal.statusCode, 403);
    assert.equal(JSON.parse(mal.body).data, undefined);
    assert.deepEqual(operaciones(), ['identidad.verificacion_fallida']);
    assert.ok(!JSON.stringify(auditoria()).includes('no-es-mi-clave'), 'la contraseña probada no queda en ninguna parte');
});

test('tres contraseñas mal escritas en quince minutos cierran todas las sesiones de la cuenta y generan una alerta', async () => {
    await docClient.send(new PutCommand({ TableName: 'SESSIONS_TABLE', Item: { sessionId: 'ses-juan', tokenHash: 'h1', personaId: juan.personaId, tenantId: T, activa: true, expiresAt: '2026-10-30T00:00:00Z' } }));
    for (let i = 0; i < 3; i += 1) await exportar('otra-clave', { ahora: new Date(AHORA.getTime() + i * 60000) });
    const sesion = doble.items('SESSIONS_TABLE').find((s) => s.sessionId === 'ses-juan');
    assert.equal(sesion.activa, false, 'la sesión robada queda cerrada');
    const alerta = auditoria().find((e) => e.operacion === 'alerta.verificacion_reiterada');
    assert.ok(alerta, 'queda la alerta');
    assert.equal(alerta.detalle.sesionesRevocadas, 1);
    assert.equal(auditoria().filter((e) => e.operacion === 'alerta.verificacion_reiterada').length, 1, 'una alerta por ventana, no una por intento');
});

// ─── Acceso y portabilidad ──────────────────────────────────────────────────

const sembrarRegistrosCompartidos = async () => {
    const llave = await llaveDe(T);
    await docClient.send(new PutCommand({ TableName: 'DOCUMENTS_TABLE', Item: {
        documentId: 'doc-1', tenantId: T, titulo: 'Procedimiento de altura', tipo: 'PROCEDIMIENTO', obraId: 'o-1', estado: 'activo',
        asignaciones: [
            { personaId: juan.personaId, nombre: 'Juan Pérez', estado: 'firmado', fechaAsignacion: '2026-10-01', rutCifrado: cifradoCampo.cifrarConLlaveDatos(RUT_JUAN, llave) },
            { personaId: pedro.personaId, nombre: 'Pedro Lagos', estado: 'pendiente', fechaAsignacion: '2026-10-01' },
        ],
        firmas: [{ personaId: pedro.personaId, nombre: 'Pedro Lagos', fecha: '2026-10-02' }],
    } }));
    await docClient.send(new PutCommand({ TableName: 'ACTIVITIES_TABLE', Item: {
        activityId: 'act-1', tenantId: T, titulo: 'Charla de inicio', tipo: 'CHARLA', fecha: '2026-10-03', relatorId: pedro.personaId,
        asistentes: [{ personaId: juan.personaId, nombre: 'Juan Pérez', estado: 'presente' }, { personaId: pedro.personaId, nombre: 'Pedro Lagos', estado: 'presente' }],
    } }));
    await docClient.send(new PutCommand({ TableName: 'SIGNATURES_TABLE', Item: { signatureId: 'sig-1', tenantId: T, personaId: juan.personaId, tipoFirma: 'documento', metodo: 'PIN', fecha: '2026-10-02', ipCifrada: 'x' } }));
    const juanHmac = doble.items('PERSONAS_TABLE').find((p) => p.personaId === juan.personaId).rutHmac;
    await docClient.send(new PutCommand({ TableName: 'INCIDENTS_TABLE', Item: { incidentId: 'inc-1', tenantId: T, fecha: '2026-10-04', tipo: 'accidente', gravedad: 'leve', afectadoRutHmac: juanHmac, descripcion: 'Pedro Lagos vio cómo Juan resbaló', reportadoPor: 'Pedro Lagos' } }));
};

test('la exportación trae los datos del titular en JSON estructurado y deja la solicitud cerrada con su historial', async () => {
    await sembrarRegistrosCompartidos();
    const res = await exportar();
    assert.equal(res.statusCode, 200, res.body);
    const d = datos(res);
    assert.equal(d.formato, 'buildandserve.datos-titular');
    assert.equal(d.secciones.ficha.datos.rut, RUT_JUAN);
    assert.equal(d.secciones.ficha.datos.email, 'juan@ejemplo.cl');
    assert.equal(d.secciones.documentos.datos[0].miAsignacion.estado, 'firmado');
    assert.equal(d.secciones.actividades.datos[0].miAsistencia.estado, 'presente');
    assert.equal(d.secciones.firmas.datos[0].metodo, 'PIN');
    assert.equal(d.secciones.incidentes.datos[0].participacion, 'persona afectada');

    const s = doble.items('GOBERNANZA_TABLE').find((x) => x.sk.startsWith('SOLICITUD#'));
    assert.equal(s.derecho, 'portabilidad');
    assert.equal(s.verificacion.metodo, 'sesion_y_contrasena');
    assert.equal(require('../lib/gobernanza/derechos').etapaDe(s), 'cerrada');
    const tipos = doble.items('GOBERNANZA_HISTORIAL_TABLE').filter((h) => h.solicitudId === s.solicitudId).map((h) => h.tipo);
    assert.deepEqual(tipos.sort(), ['ejecucion', 'respuesta', 'solicitud', 'verificacion']);
    assert.ok(operaciones().includes('derechos.exportacion'));
});

test('la exportación no trae datos de terceros ni información interna', async () => {
    await sembrarRegistrosCompartidos();
    const texto = JSON.stringify(datos(await exportar()));
    for (const prohibido of [pedro.personaId, 'Pedro', 'Lagos', '11.111.111-1', 'passwordHash', 'pinHash', 'rutHmac', 'rutCifrado', 'ipCifrada', 'Pedro Lagos vio', '"c":', '"iv":', 'tokenHash']) {
        assert.ok(!texto.includes(prohibido), `no debe aparecer: ${prohibido}`);
    }
});

test('a la cuarta exportación en 24 horas se rechaza y se alerta', async () => {
    for (let i = 0; i < 3; i += 1) assert.equal((await exportar(CLAVE_JUAN, { ahora: new Date(AHORA.getTime() + i * 3600000) })).statusCode, 200);
    const cuarta = await exportar(CLAVE_JUAN, { ahora: new Date(AHORA.getTime() + 4 * 3600000) });
    assert.equal(cuarta.statusCode, 429);
    assert.ok(operaciones().includes('derechos.exportacion_rechazada'));
    assert.ok(operaciones().includes('alerta.exportacion_reiterada'));
    const despues = await exportar(CLAVE_JUAN, { ahora: new Date(AHORA.getTime() + 30 * 3600000) });
    assert.equal(despues.statusCode, 200, 'pasadas las 24 horas vuelve a poder');
});

test('si la exportación no se puede registrar en la auditoría, no se entrega', async () => {
    const send = docClient.send;
    docClient.send = async function (cmd) {
        if (cmd.constructor.name === 'PutCommand' && cmd.input.TableName === 'AUDITORIA_ACCESOS_TABLE' && cmd.input.Item.operacion === 'derechos.exportacion') {
            throw Object.assign(new Error('Throttling'), { name: 'ProvisionedThroughputExceededException' });
        }
        return send.call(this, cmd);
    };
    try {
        const res = await exportar();
        assert.equal(res.statusCode, 503);
        assert.equal(JSON.parse(res.body).data, undefined, 'sin datos en la respuesta');
        assert.ok(!doble.items('GOBERNANZA_TABLE').some((x) => x.sk.startsWith('SOLICITUD#')), 'y no se registra como entregada');
    } finally {
        docClient.send = send;
    }
});

test('una solicitud de acceso que llegó por otro canal se exporta solo con la identidad verificada', async () => {
    const s = datos(await pedir(ana, 'POST', '/gobernanza/solicitudes', { personaId: juan.personaId, derecho: 'acceso', canal: 'Carta en oficina central', recibidaEl: '2026-10-28T12:00:00Z' }, { permisos: GESTION }));
    assert.equal(s.etapa, 'recibida');
    assert.equal((await pedir(ana, 'POST', `/gobernanza/solicitudes/${s.solicitudId}/exportacion`, {}, { permisos: GESTION })).statusCode, 409);
    const v = await pedir(ana, 'POST', `/gobernanza/solicitudes/${s.solicitudId}/verificacion`, { metodo: 'presencial_cedula' }, { permisos: GESTION });
    assert.equal(datos(v).etapa, 'verificada');
    const ok = await pedir(ana, 'POST', `/gobernanza/solicitudes/${s.solicitudId}/exportacion`, {}, { permisos: GESTION });
    assert.equal(ok.statusCode, 200, ok.body);
    assert.equal(datos(ok).secciones.ficha.datos.personaId, juan.personaId);
});

test('la verificación registra el método, nunca el número de documento', async () => {
    const s = datos(await pedir(ana, 'POST', '/gobernanza/solicitudes', { personaId: juan.personaId, derecho: 'acceso', canal: 'Carta en oficina central', recibidaEl: '2026-10-28T12:00:00Z' }, { permisos: GESTION }));
    const r = await pedir(ana, 'POST', `/gobernanza/solicitudes/${s.solicitudId}/verificacion`, { metodo: 'otro', observacion: 'Mostró cédula 12.345.678-5 en portería' }, { permisos: GESTION });
    assert.equal(r.statusCode, 400);
});

// ─── Rectificación ──────────────────────────────────────────────────────────

const pedirRectificacion = (cambios, password = CLAVE_JUAN) => pedir(juan, 'POST', '/gobernanza/mis-datos/solicitudes', { derecho: 'rectificacion', cambios, detalle: 'Mi RUT quedó mal escrito', password });

test('la rectificación valida lo pedido antes de pedir la contraseña', async () => {
    assert.equal((await pedirRectificacion({ cargo: 'JEFE' })).statusCode, 400, 'campo no rectificable');
    assert.equal((await pedirRectificacion({ rut: '12.345.678-9' })).statusCode, 400, 'RUT con dígito verificador inválido');
    assert.equal((await pedirRectificacion({ fechaNacimiento: '2012-01-01' })).statusCode, 400, 'menor de edad');
    assert.equal((await pedirRectificacion({ nombre: 'Juan' })).statusCode, 400, 'sin cambios');
    assert.equal((await pedirRectificacion({ nombre: 'J<script>' })).statusCode, 400, 'caracteres no válidos');
    assert.deepEqual(operaciones(), [], 'un error de forma no cuenta como intento de identidad');
});

test('rectificación de punta a punta: pedida, bloqueada, acogida, aplicada, propagada y sin los valores propuestos', async () => {
    await sembrarRegistrosCompartidos();
    const pedida = await pedirRectificacion({ rut: '12.345.679-3', apellidoPaterno: 'Peres' });
    assert.equal(pedida.statusCode, 201, pedida.body);
    const sol = datos(pedida);
    assert.equal(sol.etapa, 'verificada');
    assert.deepEqual(sol.camposPedidos, ['apellidoPaterno', 'rut']);

    // Guardado cifrado: el RUT nuevo no aparece en claro en la tabla ni en el historial.
    assert.ok(!JSON.stringify(doble.items('GOBERNANZA_TABLE')).includes('12.345.679-3'));
    assert.ok(!JSON.stringify(doble.items('GOBERNANZA_HISTORIAL_TABLE')).includes('12.345.679-3'));
    assert.ok(doble.items('PERSONAS_TABLE').find((p) => p.personaId === juan.personaId).solicitudesBloqueo, 'bloqueada mientras se resuelve');

    // Quien gestiona ve lo propuesto para decidir.
    const detalle = datos(await pedir(ana, 'GET', `/gobernanza/solicitudes/${sol.solicitudId}`, null, { permisos: GESTION }));
    assert.deepEqual(detalle.cambiosPropuestos, { rut: '12.345.679-3', apellidoPaterno: 'Peres' });

    const hmacAnterior = doble.items('INCIDENTS_TABLE')[0].afectadoRutHmac;
    const r = await pedir(ana, 'POST', `/gobernanza/solicitudes/${sol.solicitudId}/respuesta`, { resultado: 'acogida', fundamento: 'Se verificó con la cédula que el RUT estaba mal digitado.' }, { permisos: GESTION });
    assert.equal(r.statusCode, 200, r.body);
    assert.equal(datos(r).etapa, 'cerrada');
    assert.equal(datos(r).propagacion.incidentesRevinculados, 1);

    const corregida = await new PersonaService().getById(juan.personaId);
    assert.equal(corregida.rut, '12.345.679-3');
    assert.equal(corregida.apellidoPaterno, 'Peres');
    assert.equal(corregida.tratamientoBloqueado ?? corregida.solicitudesBloqueo.length > 0, false, 'el bloqueo se levanta');
    assert.notEqual(doble.items('INCIDENTS_TABLE')[0].afectadoRutHmac, hmacAnterior, 'el incidente sigue vinculado a la persona');
    assert.equal(doble.items('INCIDENTS_TABLE')[0].afectadoRutHmac, await cifradoCampo.hmacRut('12.345.679-3'));

    const guardada = doble.items('GOBERNANZA_TABLE').find((x) => x.sk === `SOLICITUD#${sol.solicitudId}`);
    assert.equal(guardada.cambiosCifrados, undefined, 'los valores propuestos dejan de existir');
    assert.deepEqual(guardada.ejecucion.detalle.campos, ['apellidoPaterno', 'rut']);
    assert.ok(operaciones().includes('derechos.rectificacion_aplicada'));
});

test('la rectificación no acepta un RUT que ya tiene otra persona de la empresa', async () => {
    const sol = datos(await pedirRectificacion({ rut: '11.111.111-1' }));
    const r = await pedir(ana, 'POST', `/gobernanza/solicitudes/${sol.solicitudId}/respuesta`, { resultado: 'acogida', fundamento: 'Se intenta aplicar el RUT pedido por el titular.' }, { permisos: GESTION });
    assert.equal(r.statusCode, 409);
    assert.equal((await new PersonaService().getById(juan.personaId)).rut, RUT_JUAN, 'nada cambió');
});

test('acoger una solicitud sin identidad verificada se rechaza; rechazarla por eso, no', async () => {
    const s = datos(await pedir(ana, 'POST', '/gobernanza/solicitudes', { personaId: juan.personaId, derecho: 'supresion', canal: 'Llamado telefónico', recibidaEl: '2026-10-28T12:00:00Z' }, { permisos: GESTION }));
    const acoger = await pedir(ana, 'POST', `/gobernanza/solicitudes/${s.solicitudId}/respuesta`, { resultado: 'acogida', fundamento: 'Se acoge la supresión de lo que corresponde.' }, { permisos: GESTION });
    assert.equal(acoger.statusCode, 409);
    const rechazar = await pedir(ana, 'POST', `/gobernanza/solicitudes/${s.solicitudId}/respuesta`, { resultado: 'rechazada', fundamento: 'No fue posible verificar la identidad de quien llamó.' }, { permisos: GESTION });
    assert.equal(rechazar.statusCode, 200);
});

test('cada titular ve solo sus solicitudes; sin el permiso no se gestiona ninguna', async () => {
    await pedirRectificacion({ apellidoPaterno: 'Peres' });
    assert.equal(datos(await pedir(juan, 'GET', '/gobernanza/mis-datos/solicitudes')).solicitudes.length, 1);
    assert.equal(datos(await pedir(pedro, 'GET', '/gobernanza/mis-datos/solicitudes')).solicitudes.length, 0);
    assert.equal((await pedir(juan, 'GET', '/gobernanza/solicitudes')).statusCode, 403);
});

test('el autoservicio no acepta pedir acceso por la vía de solicitudes ni un derecho inventado', async () => {
    assert.equal((await pedir(juan, 'POST', '/gobernanza/mis-datos/solicitudes', { derecho: 'acceso', password: CLAVE_JUAN })).statusCode, 400);
    assert.equal((await pedir(juan, 'POST', '/gobernanza/mis-datos/solicitudes', { derecho: 'olvido', password: CLAVE_JUAN })).statusCode, 400);
});

// ─── Supresión ──────────────────────────────────────────────────────────────

test('supresión de punta a punta: la pide el titular, se acoge y la ejecutan dos personas; alcanza su ficha de salud', async () => {
    const [llave, llaveSalud] = await Promise.all([llaveDe(T), llaveSaludDe(T)]);
    await docClient.send(new PutCommand({ TableName: 'SURVEYS_TABLE', Item: {
        surveyId: idEncuestaSalud(T), tenantId: T, titulo: 'Ficha', updatedAt: '2026-10-01T00:00:00Z',
        recipients: [
            construirDestinatario(juan, { responses: [{ q: 1, v: 'asma' }], estado: 'respondida' }, llave, llaveSalud),
            construirDestinatario(pedro, { responses: [{ q: 1, v: 'no' }], estado: 'respondida' }, llave, llaveSalud),
        ],
    } }));
    const pedida = await pedir(juan, 'POST', '/gobernanza/mis-datos/solicitudes', { derecho: 'supresion', detalle: 'Ya no trabajo con ustedes', password: CLAVE_JUAN });
    assert.equal(pedida.statusCode, 201, pedida.body);
    const { solicitudId } = datos(pedida);

    await pedir(ana, 'POST', `/gobernanza/solicitudes/${solicitudId}/respuesta`, { resultado: 'acogida_parcial', fundamento: 'Se suprime lo voluntario; la evidencia del DS 44 se conserva cinco años.' }, { permisos: GESTION });
    assert.equal(datos(await pedir(juan, 'GET', '/gobernanza/mis-datos/solicitudes')).solicitudes[0].etapa, 'respondida', 'falta ejecutar');

    const lote = datos(await pedirLote(ana, 'POST', '/gobernanza/lotes', { origen: 'solicitud', solicitudId }));
    assert.ok(lote.contenido.operaciones.some((op) => op.accion === 'quitar_respuestas' && op.personaId === juan.personaId));
    await pedirLote(ana, 'POST', `/gobernanza/lotes/${lote.loteId}/aprobar`, { huella: lote.huella });
    const ej = await pedirLote(berta, 'POST', `/gobernanza/lotes/${lote.loteId}/ejecutar`, { huella: lote.huella });
    assert.equal(ej.statusCode, 200, ej.body);

    const ficha = doble.items('SURVEYS_TABLE')[0];
    const deJuan = ficha.recipients.find((r) => r.personaId === juan.personaId);
    const dePedro = ficha.recipients.find((r) => r.personaId === pedro.personaId);
    assert.equal(deJuan.responsesCifradas, undefined, 'sus respuestas de salud se suprimieron');
    assert.ok(deJuan.respuestasSuprimidasEl);
    assert.notEqual(dePedro.responsesCifradas, undefined, 'las de su compañero quedan');
    assert.equal(datos(await pedir(juan, 'GET', '/gobernanza/mis-datos/solicitudes')).solicitudes[0].etapa, 'cerrada');
    assert.ok(operaciones().includes('derechos.supresion_ejecutada'));
});
