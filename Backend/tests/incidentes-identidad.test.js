// Hallazgos: quién verifica sale de la sesión, y las personas nombradas son de
// la empresa.
//
// La gobernanza de un hallazgo aceptaba `verificadoPor` y `fechaVerificacion`
// del cuerpo: el handler los pisaba con la sesión solo al cerrar, así que con
// cualquier otro estado quedaba escrito quien dijera el cliente. Y el
// responsable se aceptaba sin mirar de qué empresa era.

process.env.CAMPO_HMAC_KEY = 'clave-de-prueba-hmac';
process.env.CAMPO_CIFRADO_LOCAL_KEY = require('crypto').randomBytes(32).toString('base64');
process.env.CREDENCIAL_PEPPER = 'pimienta-de-prueba';

const { prepararEntorno, crearDobleTablas } = require('./doble-dynamo-tablas');
const esquemas = prepararEntorno();

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');

const { PersonaService } = require('../lib/services/PersonaService');
const { TenantService } = require('../lib/services/TenantService');
const { eventBus } = require('../lib/events/EventBus');
const incidentes = require('../handlers/incidents-module/handler');

let doble; let emitir;
let A; let supervisora; let companera; let ajena;

beforeEach(async () => {
    // El repositorio de incidentes construye su propio cliente: el doble va en
    // el prototipo, que comparten todos.
    doble = crearDobleTablas(DynamoDBDocumentClient.prototype, esquemas, { proyecciones: true });
    emitir = eventBus.emit;
    eventBus.emit = async () => {};
    A = (await new TenantService().setup({ nombre: 'Constructora A', rutEmpresa: '76.543.210-3' })).tenantId;
    const B = (await new TenantService().setup({ nombre: 'Constructora B', rutEmpresa: '77.777.777-7' })).tenantId;
    const svc = new PersonaService();
    supervisora = (await svc.crear(A, { rut: '12.345.678-5', nombre: 'Sara', rol: 'supervisor' })).persona.personaId;
    companera = (await svc.crear(A, { rut: '11.111.111-1', nombre: 'Rosa', rol: 'trabajador' })).persona.personaId;
    ajena = (await svc.crear(B, { rut: '22.222.222-2', nombre: 'Otra', rol: 'trabajador' })).persona.personaId;
});
afterEach(() => { doble.restaurar(); eventBus.emit = emitir; });

const pedir = (metodo, ruta, body) => incidentes.incidentsHandler({
    rawPath: ruta, rawQueryString: '', headers: { host: 'api.test' }, queryStringParameters: null,
    body: body === undefined ? undefined : JSON.stringify(body),
    requestContext: {
        http: { method: metodo, path: ruta },
        authorizer: { lambda: { sessionId: 's', personaId: supervisora, tenantId: A, rol: 'supervisor', permisos: 'incidentes.reportar', credencialProvisional: 'false' } },
    },
});

const HALLAZGO = { clasificacion: 'hallazgo', tipo: 'condicion_subestandar', descripcion: 'Baranda suelta', obraId: 'o-1' };

test('un responsable o un afectado de otra empresa responde 404 y no se guarda nada', async () => {
    const r1 = await pedir('POST', '/incidents', { ...HALLAZGO, responsableId: ajena });
    assert.equal(r1.statusCode, 404, r1.body);
    const r2 = await pedir('POST', '/incidents', { ...HALLAZGO, afectados: [{ nombre: 'Otra', personaId: ajena }] });
    assert.equal(r2.statusCode, 404, r2.body);
    assert.equal(doble.items('INCIDENTS_TABLE').length, 0);
});

test('quién verifica no lo dice el cliente: con cualquier estado, y al cerrar es la sesión', async () => {
    const creado = await pedir('POST', '/incidents', { ...HALLAZGO, responsableId: companera, afectados: [{ nombre: 'Rosa', personaId: companera }] });
    assert.equal(creado.statusCode, 201, creado.body);
    const id = doble.items('INCIDENTS_TABLE').find((i) => i.clasificacion === 'hallazgo').incidentId;

    const enProceso = await pedir('PUT', `/incidents/${id}/gobernanza`, {
        estadoCierre: 'en_proceso', verificadoPor: ajena, fechaVerificacion: '2020-01-01T00:00:00Z',
    });
    assert.equal(enProceso.statusCode, 200, enProceso.body);
    let g = doble.items('INCIDENTS_TABLE').find((i) => i.incidentId === id).gobernanza;
    assert.notEqual(g.verificadoPor, ajena);
    assert.notEqual(g.fechaVerificacion, '2020-01-01T00:00:00Z');

    const cierre = await pedir('PUT', `/incidents/${id}/gobernanza`, { estadoCierre: 'cerrado', comentarioCierre: 'Reparada', verificadoPor: ajena });
    assert.equal(cierre.statusCode, 200, cierre.body);
    g = doble.items('INCIDENTS_TABLE').find((i) => i.incidentId === id).gobernanza;
    assert.equal(g.verificadoPor, supervisora);
});

test('un responsable de otra empresa en la gobernanza responde 404', async () => {
    await pedir('POST', '/incidents', HALLAZGO);
    const id = doble.items('INCIDENTS_TABLE').find((i) => i.clasificacion === 'hallazgo').incidentId;
    const res = await pedir('PUT', `/incidents/${id}/gobernanza`, { responsableId: ajena });
    assert.equal(res.statusCode, 404, res.body);
});
