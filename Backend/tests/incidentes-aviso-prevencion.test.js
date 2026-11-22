// Al reportar un hallazgo o un incidente, prevención de riesgos recibe el aviso.
//
// `sendIncidentNotification` y el mensaje SNS de `create` leían
// `incident.trabajador.nombre`, pero el incidente guardado solo tiene
// `trabajadorNombre` (el resto vive en la traza): lanzaba TypeError, el `catch`
// se lo tragaba y ningún prevencionista recibía nada, mientras el formulario
// decía "Se notifica al equipo de prevención de la obra".
//
// El aviso nuevo lleva lo justo para abrir el caso —tipo, obra, fecha, gravedad
// si es incidente y el enlace— y nunca el nombre ni el RUT del afectado ni el
// relato: la bandeja y SNS no están detrás del permiso de historial.

process.env.CAMPO_HMAC_KEY = 'clave-de-prueba-hmac';
process.env.CAMPO_CIFRADO_LOCAL_KEY = require('crypto').randomBytes(32).toString('base64');
process.env.CREDENCIAL_PEPPER = 'pimienta-de-prueba';

const { prepararEntorno, crearDobleTablas } = require('./doble-dynamo-tablas');
const esquemas = prepararEntorno();

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');
const { SNSClient } = require('@aws-sdk/client-sns');

const { PersonaService } = require('../lib/services/PersonaService');
const { TenantService } = require('../lib/services/TenantService');
const { ObraService } = require('../lib/services/ObraService');
const { eventBus } = require('../lib/events/EventBus');
const incidentes = require('../handlers/incidents-module/handler');
const { IncidentsRepository } = require('../handlers/incidents-module/incidents.repository');
const { DEFAULT_ROLE_PRESETS } = require('../lib/permissions');

let doble; let emitir; let consola; let snsSend; let publicados; let errores;
let A; let B; let obraA; let trabajadora; let prevA; let prevInactiva; let prevB; let supervisora;

const activar = (personaId) => {
    // Quien terminó su enrolamiento queda `activo`; `crear` la deja `pendiente`.
    const p = doble.items('PERSONAS_TABLE').find((x) => x.personaId === personaId);
    p.estado = 'activo';
};

beforeEach(async () => {
    doble = crearDobleTablas(DynamoDBDocumentClient.prototype, esquemas, { proyecciones: true });
    emitir = eventBus.emit;
    eventBus.emit = async () => {};
    errores = [];
    consola = { log: console.log, error: console.error, warn: console.warn };
    console.log = () => {}; console.warn = () => {};
    console.error = (...a) => { errores.push(a.map(String).join(' ')); };
    publicados = [];
    snsSend = SNSClient.prototype.send;
    SNSClient.prototype.send = async (cmd) => { publicados.push(cmd.input); return {}; };
    process.env.INCIDENT_NOTIFICATION_TOPIC_ARN = 'arn:aws:sns:us-east-1:000000000000:incidentes';

    A = (await new TenantService().setup({ nombre: 'Constructora A', rutEmpresa: '76.543.210-3' })).tenantId;
    B = (await new TenantService().setup({ nombre: 'Constructora B', rutEmpresa: '77.777.777-7' })).tenantId;
    obraA = (await new ObraService().crear(A, { nombre: 'Edificio Los Robles' })).obraId;
    const svc = new PersonaService();
    trabajadora = (await svc.crear(A, { rut: '11.111.111-1', nombre: 'Rosa', rol: 'trabajador' })).persona.personaId;
    supervisora = (await svc.crear(A, { rut: '9.876.543-3', nombre: 'Sara', rol: 'supervisor' })).persona.personaId;
    prevA = (await svc.crear(A, { rut: '12.345.678-5', nombre: 'Pedro', rol: 'prevencionista' })).persona.personaId;
    prevInactiva = (await svc.crear(A, { rut: '15.555.555-6', nombre: 'Inés', rol: 'prevencionista' })).persona.personaId;
    prevB = (await svc.crear(B, { rut: '22.222.222-2', nombre: 'Otro', rol: 'prevencionista' })).persona.personaId;
    activar(prevA); activar(prevB); activar(supervisora);
});
afterEach(() => {
    doble.restaurar();
    eventBus.emit = emitir;
    SNSClient.prototype.send = snsSend;
    delete process.env.INCIDENT_NOTIFICATION_TOPIC_ARN;
    Object.assign(console, consola);
});

const pedir = (personaId, permisos, metodo, ruta, body, tenantId = A) => incidentes.incidentsHandler({
    rawPath: ruta, rawQueryString: '', headers: { host: 'api.test' }, queryStringParameters: null,
    body: body === undefined ? undefined : JSON.stringify(body),
    requestContext: {
        http: { method: metodo, path: ruta },
        authorizer: { lambda: { sessionId: 's', personaId, tenantId, rol: 'x', permisos, credencialProvisional: 'false' } },
    },
});

const RELATO = 'Baranda suelta en losa 3, casi cae Juan Pérez';
const bandejaDe = (personaId) => doble.items('INBOX_TABLE').filter((m) => m.recipientId === personaId);

test('al reportar un hallazgo, el prevencionista de la empresa recibe el aviso en su bandeja', async () => {
    const res = await pedir(trabajadora, 'actividades.ver', 'POST', '/incidents', {
        clasificacion: 'hallazgo', tipo: 'condicion_subestandar', descripcion: RELATO, obraId: obraA,
    });
    assert.equal(res.statusCode, 201, res.body);
    const id = JSON.parse(res.body).data.incidentId;

    const avisos = bandejaDe(prevA);
    assert.equal(avisos.length, 1, `el prevencionista no recibió aviso. Errores: ${errores.join(' | ')}`);
    const aviso = avisos[0];
    assert.deepEqual(aviso.linkedEntity, { type: 'incident', id });
    assert.match(aviso.subject, /hallazgo/i);
    assert.match(aviso.content, /Edificio Los Robles/);
    assert.ok(!errores.some((e) => e.includes('TypeError')), errores.join(' | '));
});

test('el aviso de un incidente no lleva el nombre ni el RUT del afectado ni el relato; sí tipo, obra, fecha y gravedad', async () => {
    const res = await pedir(supervisora, 'incidentes.reportar', 'POST', '/incidents', {
        clasificacion: 'incidente', tipo: 'accidente', gravedad: 'grave', descripcion: RELATO, obraId: obraA,
        fecha: '2026-11-15', hora: '10:30:00',
        trabajador: { nombre: 'Juan Pérez', rut: '13.333.333-3', genero: 'M', cargo: 'Jornal' },
    });
    assert.equal(res.statusCode, 201, res.body);
    const id = JSON.parse(res.body).data.incidentId;

    const [aviso] = bandejaDe(prevA);
    assert.ok(aviso, `sin aviso. Errores: ${errores.join(' | ')}`);
    const texto = JSON.stringify(aviso);
    for (const prohibido of ['Juan', 'Pérez', '13.333.333', '13333333', 'Baranda', 'Jornal']) {
        assert.ok(!texto.includes(prohibido), `el aviso contiene "${prohibido}": ${texto}`);
    }
    assert.match(aviso.subject, /accidente/i);
    assert.match(aviso.content, /Edificio Los Robles/);
    assert.match(aviso.content, /15-11-2026|15\/11\/2026|2026-11-15/);
    assert.match(aviso.content, /grave/i);
    assert.equal(aviso.priority, 'high');

    // SNS: lo mismo, con identificadores y sin datos personales.
    assert.equal(publicados.length, 1);
    const sns = JSON.stringify(publicados[0]);
    for (const prohibido of ['Juan', 'Pérez', '13.333.333', '13333333', 'Baranda', 'Jornal']) {
        assert.ok(!sns.includes(prohibido), `SNS contiene "${prohibido}": ${sns}`);
    }
    assert.ok(sns.includes(id));
});

test('destinatariosDelAviso: solo los activos de la empresa pedida, nunca de otra', async () => {
    const repo = new IncidentsRepository();
    const deA = (await repo.destinatariosDelAviso(A)).map((p) => p.personaId);
    assert.deepEqual(deA, [prevA]);
    assert.ok(!deA.includes(prevB) && !deA.includes(prevInactiva) && !deA.includes(supervisora));
    assert.deepEqual((await repo.destinatariosDelAviso(B)).map((p) => p.personaId), [prevB]);
});

// ─── Destinatarios por PERMISO (incidentes.calificar_accidente), no por rol ──

/** RUT válido a partir del número, para crear personas sin repetir. */
const rutCon = (n) => {
    let suma = 0; let mult = 2;
    for (const d of String(n).split('').reverse()) { suma += Number(d) * mult; mult = mult === 7 ? 2 : mult + 1; }
    const r = 11 - (suma % 11);
    return `${n}-${r === 11 ? '0' : r === 10 ? 'K' : r}`;
};
let siguienteRut = 17000000;
const crearActiva = async (tenantId, rol, nombre) => {
    const id = (await new PersonaService().crear(tenantId, { rut: rutCon(siguienteRut++), nombre, rol })).persona.personaId;
    activar(id);
    return id;
};
const destinatarios = async (tenantId) => (await new IncidentsRepository().destinatariosDelAviso(tenantId)).map((p) => p.personaId).sort();

test('roles por defecto: reciben el aviso prevencionista, jefe de obra y admin; no supervisor ni trabajador', async () => {
    const jefe = await crearActiva(A, 'jefe_obra', 'Jaime');
    const admin = await crearActiva(A, 'admin', 'Ana');
    const trabajadorActivo = await crearActiva(A, 'trabajador', 'Tomás');
    const ids = await destinatarios(A);
    assert.deepEqual(ids, [prevA, jefe, admin].sort());
    assert.ok(!ids.includes(supervisora) && !ids.includes(trabajadorActivo));

    // Y de punta a punta: un reporte de la trabajadora les llega a los tres.
    const res = await pedir(trabajadora, 'actividades.ver', 'POST', '/incidents', {
        clasificacion: 'hallazgo', tipo: 'condicion_subestandar', descripcion: RELATO, obraId: obraA,
    });
    assert.equal(res.statusCode, 201, res.body);
    for (const quien of [prevA, jefe, admin]) assert.equal(bandejaDe(quien).length, 1);
    for (const quien of [supervisora, trabajadorActivo]) assert.equal(bandejaDe(quien).length, 0);
});

test('un rol personalizado con incidentes.calificar_accidente recibe el aviso; uno sin ese permiso, no', async () => {
    await new TenantService().updateConfig(A, { roles: [
        { nombre: 'Encargado SST', permisos: ['incidentes.calificar_accidente', 'incidentes.historial'] },
        { nombre: 'Bodeguero', permisos: ['actividades.ver', 'incidentes.historial'] },
    ] });
    const encargado = await crearActiva(A, 'encargado_sst', 'Elena');
    const bodeguero = await crearActiva(A, 'bodeguero', 'Bruno');
    const ids = await destinatarios(A);
    assert.ok(ids.includes(encargado), `el Encargado SST no está: ${ids}`);
    assert.ok(!ids.includes(bodeguero));
});

const sinCalificar = DEFAULT_ROLE_PRESETS.prevencionista.filter((p) => p !== 'incidentes.calificar_accidente');
const quitarPermisoAlPrevencionista = (tenantId) => new TenantService().updateConfig(tenantId, { roles: [
    { id: 'prevencionista', tipo: 'prevencionista', nombre: 'Prevencionista', permisos: sinCalificar },
] });

test('una empresa que le quitó el permiso a su rol "prevencionista": ese prevencionista SÍ recibe el aviso', async () => {
    // Decisión del usuario del 22 de noviembre de 2026: el prevencionista es el
    // responsable de prevención y siempre recibe el aviso, aunque la empresa le
    // quite el permiso a su rol. Antes esta prueba afirmaba lo contrario.
    await quitarPermisoAlPrevencionista(A);
    assert.deepEqual(await destinatarios(A), [prevA]);
    // La otra empresa no se toca: su prevencionista lo recibe como siempre.
    assert.deepEqual(await destinatarios(B), [prevB]);
});

test('el prevencionista sin el permiso recibe un solo aviso; y con el permiso, también uno solo', async () => {
    // Sin el permiso: le llega por ser prevencionista, una vez.
    await quitarPermisoAlPrevencionista(A);
    const reportar = () => pedir(trabajadora, 'actividades.ver', 'POST', '/incidents', {
        clasificacion: 'hallazgo', tipo: 'condicion_subestandar', descripcion: RELATO, obraId: obraA,
    });
    assert.equal((await reportar()).statusCode, 201);
    assert.equal(bandejaDe(prevA).length, 1);
    assert.equal((await destinatarios(A)).filter((id) => id === prevA).length, 1);

    // Con el permiso (roles por defecto): cumple las dos condiciones y sigue
    // siendo un aviso por reporte, no dos.
    await new TenantService().updateConfig(A, { roles: [
        { id: 'prevencionista', tipo: 'prevencionista', nombre: 'Prevencionista', permisos: DEFAULT_ROLE_PRESETS.prevencionista },
    ] });
    assert.equal((await destinatarios(A)).filter((id) => id === prevA).length, 1);
    assert.equal((await reportar()).statusCode, 201);
    assert.equal(bandejaDe(prevA).length, 2, 'un aviso por cada uno de los dos reportes');
});

test('el rol prevencionista escrito "Prevencionista" o con espacios también cuenta', async () => {
    await quitarPermisoAlPrevencionista(A);
    // Se escribe a mano en la tabla: así quedan los datos antiguos o importados.
    const conMayuscula = await crearActiva(A, 'prevencionista', 'Paula');
    doble.items('PERSONAS_TABLE').find((x) => x.personaId === conMayuscula).rol = '  Prevencionista ';
    assert.ok((await destinatarios(A)).includes(conMayuscula));
});

test('un prevencionista inactivo no recibe el aviso, aunque el rol lo traiga siempre', async () => {
    await quitarPermisoAlPrevencionista(A);
    const ids = await destinatarios(A);
    assert.ok(!ids.includes(prevInactiva));
    const res = await pedir(trabajadora, 'actividades.ver', 'POST', '/incidents', {
        clasificacion: 'hallazgo', tipo: 'condicion_subestandar', descripcion: RELATO, obraId: obraA,
    });
    assert.equal(res.statusCode, 201, res.body);
    assert.equal(bandejaDe(prevInactiva).length, 0);
});

test('el prevencionista sin el permiso que reporta no se avisa a sí mismo', async () => {
    await quitarPermisoAlPrevencionista(A);
    const res = await pedir(prevA, 'incidentes.reportar', 'POST', '/incidents', {
        clasificacion: 'hallazgo', tipo: 'condicion_subestandar', descripcion: RELATO, obraId: obraA,
    });
    assert.equal(res.statusCode, 201, res.body);
    assert.equal(bandejaDe(prevA).length, 0);
});

test('supervisor y trabajador siguen sin recibir el aviso aunque el prevencionista no tenga el permiso', async () => {
    await quitarPermisoAlPrevencionista(A);
    const trabajadorActivo = await crearActiva(A, 'trabajador', 'Tomás');
    const ids = await destinatarios(A);
    assert.ok(!ids.includes(supervisora) && !ids.includes(trabajadorActivo));
});

test('si la definición de roles no se puede leer, se avisa con los roles por defecto y queda constancia', async () => {
    await new TenantService().updateConfig(A, { roles: [
        { id: 'prevencionista', tipo: 'prevencionista', nombre: 'Prevencionista', permisos: [] },
    ] });
    const original = DynamoDBDocumentClient.prototype.send;
    DynamoDBDocumentClient.prototype.send = async function (cmd) {
        if (cmd.input?.TableName === 'TENANTS_TABLE') throw new Error('tenants caído');
        return original.call(this, cmd);
    };
    let ids;
    try {
        ids = await destinatarios(A);
    } finally {
        DynamoDBDocumentClient.prototype.send = original;
    }
    // Con los presets, el prevencionista vuelve a tener el permiso.
    assert.deepEqual(ids, [prevA]);
    assert.ok(errores.some((e) => e.includes('FALLO_DEPENDENCIA') && e.includes('incidente.aviso.roles')), errores.join(' | '));
});

test('ni a otra empresa ni a quien reportó: el prevencionista que reporta no se avisa a sí mismo', async () => {
    await pedir(trabajadora, 'actividades.ver', 'POST', '/incidents', {
        clasificacion: 'hallazgo', tipo: 'accion_subestandar', descripcion: RELATO, obraId: obraA,
    });
    assert.equal(bandejaDe(prevB).length, 0);

    const res = await pedir(prevA, 'incidentes.reportar', 'POST', '/incidents', {
        clasificacion: 'hallazgo', tipo: 'condicion_subestandar', descripcion: RELATO, obraId: obraA,
    });
    assert.equal(res.statusCode, 201, res.body);
    assert.equal(bandejaDe(prevA).length, 1, 'solo el aviso del primer reporte, el de la trabajadora');
});

test('si avisar falla, el reporte se crea igual y queda constancia medible (FALLO_DEPENDENCIA)', async () => {
    const original = DynamoDBDocumentClient.prototype.send;
    DynamoDBDocumentClient.prototype.send = async function (cmd) {
        if (cmd.input?.TableName === 'INBOX_TABLE') throw new Error('bandeja caída');
        return original.call(this, cmd);
    };
    try {
        const res = await pedir(trabajadora, 'actividades.ver', 'POST', '/incidents', {
            clasificacion: 'hallazgo', tipo: 'condicion_subestandar', descripcion: RELATO, obraId: obraA,
        });
        assert.equal(res.statusCode, 201, res.body);
    } finally {
        DynamoDBDocumentClient.prototype.send = original;
    }
    assert.ok(errores.some((e) => e.includes('FALLO_DEPENDENCIA') && e.includes('incidente.aviso')), errores.join(' | '));
    assert.ok(!errores.some((e) => e.includes('Baranda')), 'el relato no va al log');
});

test('quickReport avisa con la misma forma: sin relato', async () => {
    const res = await pedir(trabajadora, 'actividades.ver', 'POST', '/incidents/quick-report', {
        tipo: 'condicion_subestandar', centroTrabajo: 'Losa 3', descripcion: RELATO, obraId: obraA,
    });
    assert.equal(res.statusCode, 201, res.body);
    const [aviso] = bandejaDe(prevA);
    assert.ok(aviso, `sin aviso. Errores: ${errores.join(' | ')}`);
    assert.ok(!JSON.stringify(aviso).includes('Baranda'));
    assert.equal(aviso.linkedEntity.type, 'incident');
    assert.ok(!JSON.stringify(publicados).includes('Baranda'));
});
