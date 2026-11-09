// Oposición persistente y registro de la rectificación (Actividad de derechos,
// 8 de noviembre de 2026). Lo que se fija:
//   - una oposición nombra el tratamiento al que se opone; sin él no se registra;
//   - acogida, deja una marca en la ficha que el directorio de personas y los
//     destinatarios de la bandeja consultan: quien se opuso no aparece ante
//     compañeros sin `personas.ver`, y sí ante quien gestiona personas;
//   - rechazada no deja marca; el titular puede retirar la suya y solo la suya;
//   - una rectificación aplicada guarda, cifrado, el valor anterior y el nuevo
//     de cada campo; solo el detalle de la solicitud lo descifra, y abrirlo
//     queda en la auditoría.

process.env.CAMPO_HMAC_KEY = 'clave-de-prueba-hmac';
process.env.CAMPO_CIFRADO_LOCAL_KEY = require('crypto').randomBytes(32).toString('base64');
process.env.CREDENCIAL_PEPPER = 'pimienta-de-prueba';
process.env.CREDENCIAL_SCRYPT_LN = '10';

const { prepararEntorno, crearDobleTablas } = require('./doble-dynamo-tablas');
const esquemas = prepararEntorno();

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const { docClient } = require('../lib/clients/dynamodb');
const { PersonaService } = require('../lib/services/PersonaService');
const { TenantService } = require('../lib/services/TenantService');
const derechos = require('../handlers/gobernanza/derechos');
const personas = require('../handlers/personas-module/handler');
const bandeja = require('../handlers/inbox-module/handler');

let doble;
let T;
let ana;      // administradora: gestiona derechos y ve personas
let juan;     // titular
let pedro;    // compañero de Juan, sin `personas.ver`

const CLAVE_JUAN = 'clave-de-juan-1';
const RUT_JUAN = '12.345.678-5';
const DIRECTORIO = 'directorio_companeros';

beforeEach(async () => {
    require('../lib/llaveTenant')._olvidarCache();
    doble = crearDobleTablas(docClient, esquemas, { proyecciones: true });
    T = (await new TenantService().setup({ nombre: 'Constructora Prueba', rutEmpresa: '76.543.210-3' })).tenantId;
    const svc = new PersonaService();
    ana = (await svc.crear(T, { rut: '9.876.543-3', nombre: 'Ana', apellidoPaterno: 'Rojas', rol: 'admin', email: 'ana@ejemplo.cl', password: 'clave-larga-1' })).persona;
    juan = (await svc.crear(T, { rut: RUT_JUAN, nombre: 'Juan', apellidoPaterno: 'Pérez', rol: 'trabajador', password: CLAVE_JUAN })).persona;
    pedro = (await svc.crear(T, { rut: '11.111.111-1', nombre: 'Pedro', apellidoPaterno: 'Lagos', rol: 'trabajador', password: 'clave-de-pedro-1' })).persona;
});
afterEach(() => doble.restaurar());

const AHORA = new Date('2026-11-08T15:00:00Z');
const GESTION = 'empresa.derechos_titulares';
const autorizador = (p, permisos) => ({ lambda: { sessionId: 's', personaId: p.personaId, tenantId: T, rol: p.rol, permisos, credencialProvisional: 'false' } });
const pedir = (p, metodo, ruta, cuerpo, { permisos = '' } = {}) => derechos.atender({
    requestContext: { http: { method: metodo, sourceIp: '200.1.1.1' }, authorizer: autorizador(p, permisos) },
    rawPath: ruta, body: cuerpo ? JSON.stringify(cuerpo) : undefined, queryStringParameters: {}, headers: {},
}, { ahora: AHORA });
const datos = (res) => JSON.parse(res.body).data;
const operaciones = () => doble.items('AUDITORIA_ACCESOS_TABLE').filter((e) => e.operacion).map((e) => e.operacion);
const ficha = (p) => doble.items('PERSONAS_TABLE').find((x) => x.personaId === p.personaId);

/** Quiénes ve `quien` en el directorio de personas. */
async function directorio(quien, permisos) {
    const res = await personas.personasHandler({
        requestContext: { http: { method: 'GET', path: '/personas' }, authorizer: autorizador(quien, permisos) },
        rawPath: '/personas', queryStringParameters: {}, headers: {},
    });
    assert.equal(res.statusCode, 200, res.body);
    return JSON.parse(res.body).data.personas.map((p) => p.personaId);
}

/** A quiénes puede escribir `quien` desde la bandeja. */
async function destinatarios(quien, permisos) {
    const res = await bandeja.inboxHandler({
        requestContext: { http: { method: 'GET', path: '/inbox/recipients' }, authorizer: autorizador(quien, permisos) },
        rawPath: '/inbox/recipients', queryStringParameters: {}, headers: { host: 'api.prueba' },
    });
    assert.equal(res.statusCode, 200, res.body);
    return JSON.parse(res.body).data.recipients.map((r) => r.personaId);
}

const pedirOposicion = (cuerpo = {}) => pedir(juan, 'POST', '/gobernanza/mis-datos/solicitudes', { derecho: 'oposicion', tratamiento: DIRECTORIO, password: CLAVE_JUAN, ...cuerpo });
const responder = (solicitudId, resultado, fundamento = 'Se revisó la solicitud y se resuelve con el fundamento indicado al titular.') =>
    pedir(ana, 'POST', `/gobernanza/solicitudes/${solicitudId}/respuesta`, { resultado, fundamento }, { permisos: GESTION });

// ─── Oposición ──────────────────────────────────────────────────────────────

test('una oposición sin tratamiento, o con uno inventado, no se registra ni cuenta como intento de identidad', async () => {
    assert.equal((await pedirOposicion({ tratamiento: undefined })).statusCode, 400);
    assert.equal((await pedirOposicion({ tratamiento: 'marketing' })).statusCode, 400);
    assert.deepEqual(operaciones(), [], 'el error de forma se detecta antes de pedir la contraseña');
    assert.equal(doble.items('GOBERNANZA_TABLE').filter((x) => String(x.sk).startsWith('SOLICITUD#')).length, 0);

    const empresa = await pedir(ana, 'POST', '/gobernanza/solicitudes', { personaId: juan.personaId, derecho: 'oposicion', canal: 'Carta en oficina central', recibidaEl: '2026-11-07T12:00:00Z' }, { permisos: GESTION });
    assert.equal(empresa.statusCode, 400, 'tampoco por el canal de la empresa');
});

test('oposición de punta a punta: acogida deja la marca, y el directorio y la bandeja dejan de mostrarlo a sus compañeros', async () => {
    assert.ok((await directorio(pedro, 'actividades.ver')).includes(juan.personaId), 'antes, Pedro lo ve');

    const pedida = await pedirOposicion();
    assert.equal(pedida.statusCode, 201, pedida.body);
    const sol = datos(pedida);
    assert.equal(sol.tratamiento, DIRECTORIO);

    const r = await responder(sol.solicitudId, 'acogida', 'El directorio de compañeros se basa en interés legítimo; se acoge la oposición.');
    assert.equal(r.statusCode, 200, r.body);
    assert.equal(datos(r).etapa, 'cerrada');

    assert.ok(ficha(juan).oposiciones.has(DIRECTORIO), 'la marca quedó en la ficha');
    assert.ok(!('solicitudesBloqueo' in ficha(juan)), 'el bloqueo temporal se levanta: la marca toma su lugar');
    const guardada = doble.items('GOBERNANZA_TABLE').find((x) => x.sk === `SOLICITUD#${sol.solicitudId}`);
    assert.deepEqual(guardada.ejecucion.detalle, { oposicion: DIRECTORIO });
    assert.ok(doble.items('GOBERNANZA_HISTORIAL_TABLE').some((h) => h.solicitudId === sol.solicitudId && h.tipo === 'ejecucion' && h.datos.oposicion === DIRECTORIO));
    assert.ok(operaciones().includes('derechos.oposicion_aplicada'));

    // El tratamiento ya no se hace ante compañeros sin `personas.ver`...
    assert.ok(!(await directorio(pedro, 'actividades.ver')).includes(juan.personaId), 'Pedro ya no lo ve en el directorio');
    assert.ok(!(await destinatarios(pedro, 'actividades.ver')).includes(juan.personaId), 'ni entre los destinatarios de la bandeja');
    // ...pero sí ante quien gestiona personas (contrato y obligación legal), y Juan se sigue viendo a sí mismo.
    assert.ok((await directorio(ana, 'personas.ver')).includes(juan.personaId));
    assert.ok((await destinatarios(ana, 'personas.ver')).includes(juan.personaId));
    assert.ok((await directorio(juan, 'actividades.ver')).includes(juan.personaId));
    assert.ok((await directorio(juan, 'actividades.ver')).includes(pedro.personaId), 'Juan sigue viendo a los demás');

    const vista = datos(await pedir(juan, 'GET', '/gobernanza/mis-datos/solicitudes'));
    assert.deepEqual(vista.oposiciones.map((o) => [o.tratamiento, o.vigente]), [[DIRECTORIO, true]]);

    const otra = await pedirOposicion();
    assert.equal(otra.statusCode, 409, 'no se pide dos veces lo que ya está vigente');
});

test('una oposición rechazada no deja marca y la persona sigue en el directorio', async () => {
    const sol = datos(await pedirOposicion());
    await responder(sol.solicitudId, 'rechazada');
    assert.ok(!('oposiciones' in ficha(juan)));
    assert.ok((await directorio(pedro, 'actividades.ver')).includes(juan.personaId));
});

test('el titular retira su oposición y vuelve a aparecer; nadie más puede retirarla por él', async () => {
    const sol = datos(await pedirOposicion());
    await responder(sol.solicitudId, 'acogida');
    const ruta = `/gobernanza/mis-datos/oposiciones/${DIRECTORIO}`;

    assert.equal((await pedir(pedro, 'POST', ruta, { accion: 'retirar', personaId: juan.personaId })).statusCode, 409, 'la sesión manda: Pedro no tiene oposición que retirar');
    assert.ok(ficha(juan).oposiciones.has(DIRECTORIO), 'la de Juan sigue');
    assert.equal((await pedir(juan, 'POST', '/gobernanza/mis-datos/oposiciones/marketing', { accion: 'retirar' })).statusCode, 400);

    const r = await pedir(juan, 'POST', ruta, { accion: 'retirar' });
    assert.equal(r.statusCode, 200, r.body);
    assert.deepEqual(datos(r).oposiciones.map((o) => o.vigente), [false]);
    assert.ok(!ficha(juan).oposiciones?.has(DIRECTORIO), 'la marca se borró');
    assert.ok((await directorio(pedro, 'actividades.ver')).includes(juan.personaId), 'Pedro vuelve a verlo');
    assert.ok(operaciones().includes('derechos.oposicion_retirada'));
    assert.equal((await pedir(juan, 'POST', ruta, { accion: 'retirar' })).statusCode, 409, 'retirar dos veces no hace nada');
});

test('la copia de los datos del titular informa sus oposiciones vigentes', async () => {
    const sol = datos(await pedirOposicion());
    await responder(sol.solicitudId, 'acogida');
    const copia = datos(await pedir(juan, 'POST', '/gobernanza/mis-datos/exportacion', { password: CLAVE_JUAN }));
    assert.deepEqual(copia.secciones.solicitudes.oposicionesVigentes, [DIRECTORIO]);
    assert.equal(copia.secciones.solicitudes.datos.find((s) => s.derecho === 'oposicion').tratamiento, DIRECTORIO);
});

// ─── Registro de la rectificación ───────────────────────────────────────────

test('la rectificación aplicada guarda el valor anterior y el nuevo, cifrados, con quién y cuándo', async () => {
    const pedida = await pedir(juan, 'POST', '/gobernanza/mis-datos/solicitudes', { derecho: 'rectificacion', cambios: { rut: '12.345.679-3', apellidoPaterno: 'Peres' }, password: CLAVE_JUAN });
    assert.equal(pedida.statusCode, 201, pedida.body);
    const { solicitudId } = datos(pedida);
    const r = await responder(solicitudId, 'acogida', 'Se verificó con la cédula que el RUT y el apellido estaban mal digitados.');
    assert.equal(r.statusCode, 200, r.body);
    assert.equal(datos(r).ejecucion.valoresCifrados, undefined, 'la respuesta no lleva el sobre');

    const guardada = doble.items('GOBERNANZA_TABLE').find((x) => x.sk === `SOLICITUD#${solicitudId}`);
    assert.ok(guardada.ejecucion.valoresCifrados, 'el registro del cambio quedó en la solicitud');
    assert.equal(guardada.ejecucion.por.personaId, ana.personaId, 'quién lo aplicó');
    assert.equal(guardada.ejecucion.en, AHORA.toISOString(), 'cuándo');
    // Ni el valor anterior ni el nuevo quedan en claro, en la solicitud ni en el
    // historial. ("Pérez" no se busca: ya está en `registradaPor`, el nombre de
    // quien presentó la solicitud, desde antes de este cambio.)
    for (const tabla of ['GOBERNANZA_TABLE', 'GOBERNANZA_HISTORIAL_TABLE', 'AUDITORIA_ACCESOS_TABLE']) {
        const crudo = JSON.stringify(doble.items(tabla));
        for (const valor of [RUT_JUAN, '12.345.679-3', 'Peres']) assert.ok(!crudo.includes(valor), `${valor} en claro en ${tabla}`);
    }

    // Quien gestiona lo ve descifrado en el detalle, y abrirlo queda en la auditoría.
    const detalle = datos(await pedir(ana, 'GET', `/gobernanza/solicitudes/${solicitudId}`, null, { permisos: GESTION }));
    assert.deepEqual(detalle.cambiosAplicados, [
        { campo: 'apellidoPaterno', anterior: 'Pérez', nuevo: 'Peres' },
        { campo: 'rut', anterior: RUT_JUAN, nuevo: '12.345.679-3' },
    ]);
    assert.equal(detalle.ejecucion.valoresCifrados, undefined);
    assert.ok(operaciones().includes('derechos.rectificacion_consultada'));

    // El listado y la vista del titular no llevan el sobre.
    const lista = datos(await pedir(ana, 'GET', '/gobernanza/solicitudes', null, { permisos: GESTION })).solicitudes;
    assert.ok(!JSON.stringify(lista).includes('valoresCifrados'));
    assert.ok(!JSON.stringify(datos(await pedir(juan, 'GET', '/gobernanza/mis-datos/solicitudes'))).includes('valoresCifrados'));
});

test('una rectificación rechazada no guarda valores', async () => {
    const { solicitudId } = datos(await pedir(juan, 'POST', '/gobernanza/mis-datos/solicitudes', { derecho: 'rectificacion', cambios: { apellidoPaterno: 'Peres' }, password: CLAVE_JUAN }));
    await responder(solicitudId, 'rechazada', 'El apellido registrado coincide con la cédula presentada por el titular.');
    const guardada = doble.items('GOBERNANZA_TABLE').find((x) => x.sk === `SOLICITUD#${solicitudId}`);
    assert.equal(guardada.ejecucion, undefined);
    assert.equal(datos(await pedir(ana, 'GET', `/gobernanza/solicitudes/${solicitudId}`, null, { permisos: GESTION })).cambiosAplicados, null);
});
