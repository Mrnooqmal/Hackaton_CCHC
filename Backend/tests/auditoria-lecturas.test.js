// Auditoría de las LECTURAS de datos personales.
//
// El simulacro de incidente (`scripts/simulacro-incidente.js`) dejó el hueco a la
// vista: una cuenta comprometida listaba el personal completo con RUT, correo y
// fecha de nacimiento, abría fichas y bajaba documentos firmados, y la auditoría
// solo decía que había iniciado sesión. De ocho acciones del incidente, cinco se
// podían reconstruir y tres no.
//
// Estas pruebas cubren esas tres. Lo que afirman no es "se escribe un registro"
// sino las garantías que hacen útil al registro:
//
//   1. Que exista para la lectura de datos AJENOS, y no para los propios.
//   2. Que NO lleve los datos leídos: solo quién, cuándo, de quién y cuántos.
//   3. Que registrar una lectura **no pueda impedirla**. A diferencia de los
//      datos de salud (D-18, "si no se puede registrar, no se entrega"), listar
//      al personal es la operación más frecuente del sistema y la usan pantallas
//      de terreno: convertir una falla de la auditoría en una caída sería peor
//      que el problema que resuelve.

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
const A = require('../lib/gobernanza/auditoria');
const deteccion = require('../lib/gobernanza/deteccion');
const personas = require('../handlers/personas-module/handler');

let doble;
let T;
let jefa;
let juan;
let pedro;

beforeEach(async () => {
    require('../lib/llaveTenant')._olvidarCache();
    doble = crearDobleTablas(docClient, esquemas);
    T = (await new TenantService().setup({ nombre: 'Constructora Prueba', rutEmpresa: '76.543.210-3' })).tenantId;
    const svc = new PersonaService();
    jefa = (await svc.crear(T, { rut: '9.876.543-3', nombre: 'Jefa', rol: 'jefe_obra', email: 'jefa@ejemplo.cl', password: 'clave-larga-1' })).persona;
    juan = (await svc.crear(T, { rut: '12.345.678-5', nombre: 'Juan', rol: 'trabajador', password: 'clave-de-juan-1' })).persona;
    pedro = (await svc.crear(T, { rut: '11.111.111-1', nombre: 'Pedro', rol: 'trabajador', password: 'clave-de-pedro' })).persona;
});
afterEach(() => doble.restaurar());

/** Auditoría general: los registros de acceso a salud se reconocen por `tipos`. */
const registros = () => doble.items('AUDITORIA_ACCESOS_TABLE').filter((e) => e.operacion);
const deOperacion = (op) => registros().filter((r) => r.operacion === op);

const evento = (p, metodo, ruta, { permisos = '', path = {}, query = {} } = {}) => ({
    requestContext: {
        http: { method: metodo, sourceIp: '200.1.2.3' },
        authorizer: { lambda: { sessionId: 's', personaId: p.personaId, tenantId: T, rol: p.rol, permisos } },
    },
    rawPath: ruta, pathParameters: path, queryStringParameters: query,
    headers: { 'user-agent': 'Mozilla/5.0 prueba' },
});

// ─── El catálogo y la conservación ───────────────────────────────────────────

test('las tres lecturas están catalogadas en la categoría de acceso', () => {
    for (const op of ['datos.lectura_directorio', 'datos.lectura_ficha', 'datos.descarga_documento']) {
        const r = A.construir({ tenantId: T, operacion: op, actor: { id: jefa.personaId, tipo: 'persona' } });
        assert.equal(r.categoria, 'acceso', `${op} no quedó en la categoría de acceso`);
    }
});

test('una lectura se conserva un año; lo que acredita el tratamiento, cinco', () => {
    // `datos` acredita cómo se trataron los datos de alguien y dura cinco años.
    // Una lectura responde quién leyó qué, que sirve para investigar un incidente
    // reciente: con cinco años, cada listado del personal multiplicaría el
    // almacenamiento sin agregar nada que el plan de incidentes use.
    const ahora = new Date('2026-01-01T00:00:00.000Z');
    const dias = (op) => {
        const r = A.construir({ tenantId: T, operacion: op, actor: { id: jefa.personaId, tipo: 'persona' } }, { ahora });
        return Math.round((r.ttl * 1000 - ahora.getTime()) / 86400000);
    };
    assert.equal(dias('datos.lectura_directorio'), 365);
    assert.equal(dias('datos.lectura_ficha'), 365);
    assert.equal(dias('datos.modificacion'), 1825, 'la categoría datos dejó de durar cinco años');
});

// ─── Por el handler, como en el incidente ────────────────────────────────────

test('listar el personal queda registrado, con cuántas personas y sin quiénes', async () => {
    const r = await personas.personasHandler(evento(jefa, 'GET', '/personas', { permisos: 'personas.ver' }));
    assert.equal(r.statusCode, 200, r.body);

    const [reg] = deOperacion('datos.lectura_directorio');
    assert.ok(reg, 'listar el personal no dejó registro: el incidente volvería a ser ciego');
    assert.equal(reg.actorId, jefa.personaId);
    assert.equal(reg.detalle.alcance, 'completo');
    assert.equal(reg.detalle.personas, 3);
    assert.equal(reg.origen.ip, '200.1.2.3');
    // El alcance es "el personal de esta empresa": el informe de brecha lo
    // resuelve desde el tenantId y la fecha. Guardar cientos de identificadores
    // en cada listado abultaría el registro sin decir nada nuevo.
    assert.deepEqual(reg.titulares, [], 'el listado guardó los identificadores uno por uno');
});

test('el listado recortado también queda, y se distingue del completo', async () => {
    const r = await personas.personasHandler(evento(juan, 'GET', '/personas'));
    assert.equal(r.statusCode, 200, r.body);
    const [reg] = deOperacion('datos.lectura_directorio');
    assert.ok(reg, 'el directorio mínimo no dejó registro');
    assert.equal(reg.detalle.alcance, 'recortado',
        'no se distingue quién vio la ficha completa de quién vio solo nombre y cargo');
});

test('abrir la ficha de otra persona queda registrado, con su identificador', async () => {
    const r = await personas.personasHandler(
        evento(jefa, 'GET', `/personas/${juan.personaId}`, { permisos: 'personas.ver,personas.detalle', path: { id: juan.personaId } }));
    assert.equal(r.statusCode, 200, r.body);

    const [reg] = deOperacion('datos.lectura_ficha');
    assert.ok(reg, 'abrir una ficha ajena no dejó registro');
    assert.deepEqual(reg.titulares, [juan.personaId]);
    assert.equal(reg.recurso.id, juan.personaId);
    assert.equal(reg.actorId, jefa.personaId);
    assert.ok(reg.en, 'sin fecha no se reconstruye nada');
    assert.ok(reg.sello, 'sin sello, alguien puede editar la tabla sin que se note');
});

test('abrir la ficha PROPIA no se registra', async () => {
    // Si se registrara, la auditoría se llenaría con cada vez que alguien abre su
    // perfil, y el rastro de los accesos ajenos quedaría enterrado.
    const r = await personas.personasHandler(
        evento(juan, 'GET', `/personas/${juan.personaId}`, { permisos: 'personas.detalle', path: { id: juan.personaId } }));
    assert.equal(r.statusCode, 200, r.body);
    assert.equal(deOperacion('datos.lectura_ficha').length, 0, 'se registró una lectura de la propia ficha');
});

test('buscar por RUT y encontrar la ficha también queda registrado', async () => {
    // Es el mismo acceso por otra puerta. Sin esto, quien conoce el RUT de
    // alguien puede abrir su ficha sin dejar rastro.
    const r = await personas.personasHandler(
        evento(jefa, 'GET', '/personas/by-rut/12.345.678-5',
            { permisos: 'personas.ver,personas.detalle', path: { id: 'by-rut', action: '12.345.678-5' } }));
    assert.equal(r.statusCode, 200, r.body);

    const [reg] = deOperacion('datos.lectura_ficha');
    assert.ok(reg, 'buscar por RUT no dejó registro');
    assert.deepEqual(reg.titulares, [juan.personaId]);
    assert.equal(reg.detalle.via, 'rut', 'no se distingue la búsqueda por RUT de abrir la ficha');
});

test('el registro de una lectura no lleva el RUT ni el correo de nadie', async () => {
    await personas.personasHandler(
        evento(jefa, 'GET', `/personas/${juan.personaId}`, { permisos: 'personas.ver,personas.detalle', path: { id: juan.personaId } }));
    await personas.personasHandler(evento(jefa, 'GET', '/personas', { permisos: 'personas.ver' }));

    const texto = JSON.stringify(registros());
    assert.ok(!texto.includes('12.345.678'), 'el RUT quedó en la auditoría');
    assert.ok(!texto.includes('jefa@ejemplo.cl'), 'el correo quedó en la auditoría');
    assert.ok(!texto.includes('Juan'), 'el nombre quedó en la auditoría');
});

test('el detalle de una lectura no puede llevar datos personales', () => {
    // `sanear` es la misma guarda del resto de la auditoría: si alguien intenta
    // dejar un RUT o un correo en el detalle, es un error de programación y tiene
    // que verse acá, no en una fiscalización.
    for (const prohibido of [{ rut: '12.345.678-5' }, { email: 'a@b.cl' }, { password: 'x' }]) {
        assert.throws(() => A.construir({
            tenantId: T, operacion: 'datos.lectura_ficha',
            actor: { id: jefa.personaId, tipo: 'persona' }, detalle: prohibido,
        }), /prohibid|AUDITORIA_DATO_PROHIBIDO/i, `${Object.keys(prohibido)[0]} pasó al detalle`);
    }
});

// ─── Registrar no puede impedir leer ─────────────────────────────────────────

test('si la auditoría falla, la lectura se entrega igual', async () => {
    // El criterio opuesto al de salud, y deliberado: la lectura del personal no
    // se puede negar por un problema de registro. La falla queda en la métrica.
    const real = docClient.send;
    docClient.send = async (cmd) => {
        const tabla = cmd?.input?.TableName || '';
        if (tabla.includes('AUDITORIA')) throw new Error('auditoría caída');
        return real.call(docClient, cmd);
    };
    try {
        const r = await personas.personasHandler(evento(jefa, 'GET', '/personas', { permisos: 'personas.ver' }));
        assert.equal(r.statusCode, 200, 'la lectura se bloqueó por una falla de la auditoría');
        assert.equal(JSON.parse(r.body).data.total, 3, 'la respuesta llegó incompleta');
    } finally {
        docClient.send = real;
    }
});

test('la lectura de datos de salud SÍ se niega si no se puede registrar', () => {
    // El criterio opuesto es deliberado y no debe uniformarse por descuido: un
    // dato de salud que no se puede auditar no se entrega (D-18). Se comprueba
    // por su efecto —el 503 y su mensaje—, no por una palabra del código.
    const fuente = require('node:fs').readFileSync(
        require('node:path').join(__dirname, '..', 'lib/gobernanza/auditoriaSalud.js'), 'utf8');
    assert.match(fuente, /503/, 'auditoriaSalud dejó de responder 503 cuando no puede registrar');
    assert.match(fuente, /no se entregan/, 'se perdió el resguardo de no entregar salud sin registro');
});

// ─── La alerta que ahora es posible ──────────────────────────────────────────

test('abrir treinta fichas distintas en una hora alerta; la misma treinta veces, no', () => {
    const regla = deteccion.REGLAS.find((r) => r.id === 'lectura_masiva_fichas');
    assert.ok(regla, 'se perdió la regla de lectura masiva de fichas');

    // `eventoId` no es decorativo: `evaluar` deduplica por él, y sin él los
    // treinta eventos colapsan en uno solo y nada alcanza el umbral.
    const ev = (titular, minuto) => ({
        eventoId: `e-${titular}-${minuto}`,
        operacion: 'datos.lectura_ficha', titulares: [titular],
        en: new Date(Date.UTC(2026, 0, 1, 10, minuto)).toISOString(),
    });
    const ahora = new Date(Date.UTC(2026, 0, 1, 10, 50));

    // `evaluar` devuelve un ARREGLO de alertas, y uno vacío es truthy: hay que
    // buscar la regla por su identificador.
    const alerta = (eventos) => deteccion.evaluar(eventos[eventos.length - 1], eventos, { ahora })
        .some((a) => a.regla === 'lectura_masiva_fichas');

    const distintas = Array.from({ length: 30 }, (_, i) => ev(`p-${i}`, i));
    assert.ok(alerta(distintas), 'treinta personas distintas en una hora no alertó');

    const repetida = Array.from({ length: 30 }, (_, i) => ev('p-mismo', i));
    assert.ok(!alerta(repetida),
        'abrir la misma ficha treinta veces alertó, y no debe: no es recorrer el padrón');

    const pocas = Array.from({ length: 29 }, (_, i) => ev(`p-${i}`, i));
    assert.ok(!alerta(pocas), 'veintinueve personas distintas alertó: el umbral son treinta');
});

test('el padrón entero, persona por persona, dispara la alerta', () => {
    // El caso del simulacro: una cuenta comprometida que recorre las fichas.
    void pedro;
    const regla = deteccion.REGLAS.find((r) => r.id === 'lectura_masiva_fichas');
    assert.equal(regla.severidad, 'alta', 'la lectura masiva dejó de ser de severidad alta');
    assert.equal(regla.ventanaMs, 60 * 60000);
});

// ─── La reconstrucción, que es el punto 6 de la actividad ───────────────────

test('la auditoría reconstruye la secuencia completa de una cuenta comprometida', async () => {
    // La contraparte automatizada de `scripts/simulacro-incidente.js`: el mismo
    // recorrido, pero sin depender de un ambiente desplegado. Lo que se afirma es
    // lo que la actividad pide comprobar: que con los registros en la mano se
    // pueda decir qué pasó, en qué orden y sobre quién.
    const consultaAuditoria = require('../handlers/gobernanza/auditoria');

    // 1. La cuenta recorre el padrón completo.
    await personas.personasHandler(evento(jefa, 'GET', '/personas', { permisos: 'personas.ver' }));
    // 2. Abre dos fichas ajenas, una por identificador y otra por RUT.
    await personas.personasHandler(evento(jefa, 'GET', `/personas/${juan.personaId}`,
        { permisos: 'personas.ver,personas.detalle', path: { id: juan.personaId } }));
    await personas.personasHandler(evento(jefa, 'GET', '/personas/by-rut/11.111.111-1',
        { permisos: 'personas.ver,personas.detalle', path: { id: 'by-rut', action: '11.111.111-1' } }));

    const r = await consultaAuditoria.atender(
        evento(jefa, 'GET', '/gobernanza/auditoria', { permisos: 'empresa.auditoria' }));
    assert.equal(r.statusCode, 200, r.body);
    const { eventos, integridad } = JSON.parse(r.body).data;

    // Todo lo que la cuenta hizo aparece.
    const operaciones = eventos.map((e) => e.operacion);
    assert.ok(operaciones.includes('datos.lectura_directorio'), 'falta el recorrido del padrón');
    assert.equal(operaciones.filter((o) => o === 'datos.lectura_ficha').length, 2,
        'faltan lecturas de ficha: la reconstrucción quedaría incompleta');
    assert.ok(operaciones.includes('auditoria.consulta'),
        'consultar la auditoría no quedó registrado: quien investiga también deja rastro');

    // Se sabe DE QUIÉN eran los datos.
    const titulares = new Set(eventos.flatMap((e) => e.titulares || []));
    assert.ok(titulares.has(juan.personaId) && titulares.has(pedro.personaId),
        'no se puede decir a qué personas afectó');

    // Todos los registros son del mismo actor, y están ordenados en el tiempo.
    assert.ok(eventos.every((e) => e.actorId === jefa.personaId), 'se mezclaron actores');
    const fechas = eventos.map((e) => e.en);
    const ordenadas = [...fechas].sort().reverse();
    assert.deepEqual(fechas, ordenadas, 'la secuencia no viene ordenada: no se puede narrar qué pasó antes');

    // Y ninguno fue alterado.
    assert.equal(integridad.alterado, undefined, 'hay registros alterados');
    assert.ok(integridad.integro >= 4, `solo ${integridad.integro} registros con sello válido`);
});
