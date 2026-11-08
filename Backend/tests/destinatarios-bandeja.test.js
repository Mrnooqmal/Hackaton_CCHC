// Destinatarios de la bandeja: lo necesario para elegir a quién escribir.
//
// `/inbox/recipients` lo usa cualquier sesión para redactar un mensaje. Hasta el
// 8 de noviembre de 2026 entregaba el correo de todo el personal (revisión de
// minimización, fila 7.5) y un `rut` que siempre llegaba vacío —en la tabla está
// cifrado—, con lo que el aviso de una solicitud de firma, que cruzaba por RUT,
// no le llegaba a nadie.

process.env.CAMPO_HMAC_KEY = 'clave-de-prueba-hmac';
process.env.CAMPO_CIFRADO_LOCAL_KEY = require('crypto').randomBytes(32).toString('base64');

const { prepararEntorno, crearDobleTablas } = require('./doble-dynamo-tablas');
const esquemas = prepararEntorno();

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { docClient } = require('../lib/clients/dynamodb');
const { PersonaService } = require('../lib/services/PersonaService');
const { TenantService } = require('../lib/services/TenantService');
const { InboxRepository } = require('../handlers/inbox-module/inbox.repository');

let doble;
let tenantId;
let rosa;

beforeEach(async () => {
    doble = crearDobleTablas(docClient, esquemas, { proyecciones: true });
    tenantId = (await new TenantService().setup({ nombre: 'Constructora A', rutEmpresa: '76.543.210-3' })).tenantId;
    const svc = new PersonaService();
    rosa = (await svc.crear(tenantId, { rut: '11.111.111-1', nombre: 'Rosa', apellidoPaterno: 'Soto', rol: 'trabajador', cargo: 'Jornal', email: 'rosa@ejemplo.cl' })).persona.personaId;
    await svc.crear(tenantId, { rut: '12.345.678-5', nombre: 'Juan', apellidoPaterno: 'Pérez', rol: 'supervisor', cargo: 'Capataz', email: 'juan@ejemplo.cl' });
});
afterEach(() => doble.restaurar());

test('nombre, rol y cargo: ni correo ni RUT', async () => {
    const r = await new InboxRepository().getRecipients({ currentUserId: rosa, tenantId });
    assert.equal(r.recipients.length, 1, 'sin quien pregunta');
    const [juan] = r.recipients;
    const permitidos = new Set(['userId', 'personaId', 'nombre', 'apellido', 'nombreCompleto', 'rol', 'cargo']);
    assert.deepEqual(Object.keys(juan).filter((k) => !permitidos.has(k)), []);
    assert.ok(!JSON.stringify(r).includes('juan@ejemplo.cl'));
    assert.equal(juan.personaId, juan.userId);
});

test('el aviso de una solicitud de firma busca a los destinatarios por identificador, no por RUT', () => {
    const s = fs.readFileSync(path.join(__dirname, '..', '..', 'Frontend', 'src', 'pages', 'SignatureRequests.tsx'), 'utf8');
    assert.ok(s.includes('allRecipients.filter(r => selectedWorkers.includes(r.personaId))'));
    assert.ok(!/r\.rut/.test(s.slice(s.indexOf('const allRecipients'), s.indexOf('const allRecipients') + 600)));
});
