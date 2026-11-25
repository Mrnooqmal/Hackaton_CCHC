process.env.CAMPO_HMAC_KEY = 'clave-de-prueba-hmac';
process.env.CAMPO_CIFRADO_LOCAL_KEY = require('crypto').randomBytes(32).toString('base64');
process.env.CREDENCIAL_PEPPER = 'pimienta-de-prueba';

const { prepararEntorno, crearDobleTablas } = require('./doble-dynamo-tablas');
const esquemas = prepararEntorno();

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const XLSX = require('xlsx');
const ExcelJS = require('exceljs');
const { ScanCommand } = require('@aws-sdk/lib-dynamodb');

const { docClient } = require('../lib/clients/dynamodb');
const { PersonaService } = require('../lib/services/PersonaService');
const { TenantService } = require('../lib/services/TenantService');
const { ALL_PERMISSION_KEYS } = require('../lib/permissions');
const personas = require('../handlers/personas-module/handler');

const CABECERAS_VIEJAS = [
    'rut', 'nombre', 'apellidoPaterno', 'apellidoMaterno', 'fechaNacimiento', 'email', 'telefono', 'rol', 'cargo',
    'obra', 'supervisor', 'nivelEscolar', 'contactoEmergenciaNombre', 'contactoEmergenciaTelefono',
    'contactoEmergenciaRelacion', 'cursos',
];

let doble;
let tenantId;
let adminId;

beforeEach(async () => {
    doble = crearDobleTablas(docClient, esquemas, { proyecciones: true });
    tenantId = (await new TenantService().setup({ nombre: 'Constructora A', rutEmpresa: '76.543.210-3' })).tenantId;
    adminId = (await new PersonaService().crear(tenantId, {
        rut: '9.876.543-3', nombre: 'Admin', rol: 'admin', tieneAccesoWeb: true, password: 'Clave-admin-1',
    })).persona.personaId;
});
afterEach(() => doble.restaurar());

const pedir = async (rawPath, cuerpo) => {
    const res = await personas.personasHandler({
        requestContext: {
            http: { method: 'POST', sourceIp: '10.0.0.1' },
            authorizer: { lambda: { sessionId: 's-admin', personaId: adminId, tenantId, rol: 'admin', permisos: ALL_PERMISSION_KEYS.join(',') } },
        },
        rawPath,
        body: JSON.stringify(cuerpo),
    });
    return { status: res.statusCode, cuerpo: JSON.parse(res.body) };
};

const plantillaVieja = () => {
    const filas = [
        CABECERAS_VIEJAS,
        ['17.171.717-5', 'Ana', 'Paz', 'Rojas', '1990-05-12', '', 56911112222, 'Persona trabajadora', '', '', '', 'Media completa', 'Luis Paz', 56977778888, 'Hermano', ''],
        ['18.181.818-2', 'Leo', 'Mora', '', '', '', '+56 9 3333 4444', 'Persona trabajadora', '', '', '', '', 'Rosa Mora', '+56 9 5555 6666', 'Madre', ''],
    ];
    const libro = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(libro, XLSX.utils.aoa_to_sheet(filas), 'Personas');
    return XLSX.write(libro, { type: 'base64', bookType: 'xlsx' });
};

test('la plantilla vieja, con telefono y contactoEmergenciaTelefono llenos, se valida sin errores ni advertencias', async () => {
    const r = await pedir('/personas/carga-masiva/validar', { fileBase64: plantillaVieja() });
    assert.equal(r.status, 200, JSON.stringify(r.cuerpo));
    assert.deepEqual(r.cuerpo.data.resumen, { total: 2, ok: 2, advertencias: 0, errores: 0 });
    for (const f of r.cuerpo.data.filas) {
        assert.ok(!('telefono' in f), 'la columna telefono no llega a la fila');
        assert.deepEqual(f.errores || [], []);
        assert.deepEqual(f.advertencias || [], []);
    }
    assert.deepEqual(r.cuerpo.data.filas.map((f) => f.contactoEmergenciaTelefono), ['56977778888', '+56 9 5555 6666']);
});

test('la plantilla vieja crea a las personas sin guardar su teléfono, y guarda el del contacto de emergencia', async () => {
    const cola = require('./doble-cola').crearDobleCola();
    try {
        const validada = await pedir('/personas/carga-masiva/validar', { fileBase64: plantillaVieja() });
        const confirmar = await pedir('/personas/carga-masiva/confirmar', { filas: validada.cuerpo.data.filas, sendWelcomeEmail: false });
        assert.equal(confirmar.status, 202, JSON.stringify(confirmar.cuerpo));
        await cola.drenar();
    } finally {
        cola.restaurar();
    }
    const fichas = ((await docClient.send(new ScanCommand({ TableName: 'PERSONAS_TABLE' }))).Items || [])
        .filter((i) => i.rol === 'Persona trabajadora');
    assert.equal(fichas.length, 2);
    for (const f of fichas) assert.ok(!('telefono' in f), `${f.nombre}: sin teléfono propio`);
    const contactos = Object.fromEntries(fichas.map((f) => [f.nombre, f.contactoEmergencia?.telefono]));
    assert.deepEqual(contactos, { Ana: '56977778888', Leo: '+56 9 5555 6666' });
});

test('la plantilla que genera el sistema ya no trae telefono, y sí el teléfono del contacto de emergencia', async () => {
    const libro = new ExcelJS.Workbook();
    await libro.xlsx.load(await personas.createTemplateBuffer({ roles: ['Persona trabajadora'], cargos: [], obras: [] }));
    const cabeceras = libro.getWorksheet('Personas').getRow(1).values.filter(Boolean).map(String);
    assert.ok(!cabeceras.includes('telefono'), cabeceras.join(', '));
    assert.ok(cabeceras.includes('contactoEmergenciaTelefono'), cabeceras.join(', '));
});
