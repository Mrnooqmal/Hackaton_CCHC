// El listado del personal, sin `personas.ver`, trae solo lo necesario para
// elegir a alguien (H-16).
//
// `GET /personas` solo exigía sesión: una trabajadora recién enrolada recibía la
// ficha de todo el personal de su empresa, con RUT, correo y fecha de
// nacimiento. No se corta el listado, porque pantallas de terreno lo usan para
// elegir a una persona (el afectado de un hallazgo, los citados a una charla);
// se recorta.

process.env.CAMPO_HMAC_KEY = 'clave-de-prueba-hmac';
process.env.CAMPO_CIFRADO_LOCAL_KEY = require('crypto').randomBytes(32).toString('base64');
process.env.CREDENCIAL_PEPPER = 'pimienta-de-prueba';

const { prepararEntorno, crearDobleTablas } = require('./doble-dynamo-tablas');
const esquemas = prepararEntorno();

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const { docClient } = require('../lib/clients/dynamodb');
const { PersonaService } = require('../lib/services/PersonaService');
const { TenantService } = require('../lib/services/TenantService');
const personas = require('../handlers/personas-module/handler');

let doble;
let tenantId;
let trabajadora;

beforeEach(async () => {
    doble = crearDobleTablas(docClient, esquemas, { proyecciones: true });
    tenantId = (await new TenantService().setup({ nombre: 'Constructora A', rutEmpresa: '76.543.210-3' })).tenantId;
    const svc = new PersonaService();
    trabajadora = (await svc.crear(tenantId, {
        rut: '11.111.111-1', nombre: 'Rosa', apellidoPaterno: 'Soto', rol: 'trabajador', cargo: 'Jornal',
        email: 'rosa@ejemplo.cl', fechaNacimiento: '1990-01-01',
    })).persona.personaId;
    await svc.crear(tenantId, {
        rut: '12.345.678-5', nombre: 'Juan', apellidoPaterno: 'Pérez', rol: 'supervisor', cargo: 'Capataz',
        email: 'juan@ejemplo.cl', fechaNacimiento: '1985-05-05',
    });
});
afterEach(() => doble.restaurar());

const listar = (permisos) => personas.personasHandler({
    requestContext: {
        http: { method: 'GET', path: '/personas' },
        authorizer: { lambda: { sessionId: 's', personaId: trabajadora, tenantId, rol: 'trabajador', permisos, credencialProvisional: 'false' } },
    },
    rawPath: '/personas',
    queryStringParameters: {},
    headers: {},
});

test('sin personas.ver: identificador, nombre y cargo, y nada más', async () => {
    const res = await listar('actividades.ver');
    assert.equal(res.statusCode, 200, res.body);
    const lista = JSON.parse(res.body).data.personas;
    assert.equal(lista.length, 2, 'el listado no se corta: sirve para elegir a alguien');
    const permitidos = new Set(['personaId', 'nombre', 'apellidoPaterno', 'apellidoMaterno', 'apellido', 'cargo']);
    for (const p of lista) {
        const sobran = Object.keys(p).filter((k) => !permitidos.has(k));
        assert.deepEqual(sobran, [], `campos de más para quien no tiene personas.ver: ${sobran.join(', ')}`);
    }
    const juan = lista.find((p) => p.nombre === 'Juan');
    assert.equal(juan.cargo, 'Capataz');
    assert.ok(!JSON.stringify(lista).includes('12.345.678'), 'el RUT no viaja');
});

test('con personas.ver: la ficha completa', async () => {
    const lista = JSON.parse((await listar('personas.ver')).body).data.personas;
    const juan = lista.find((p) => p.nombre === 'Juan');
    assert.equal(juan.rut, '12.345.678-5');
    assert.equal(juan.email, 'juan@ejemplo.cl');
});
