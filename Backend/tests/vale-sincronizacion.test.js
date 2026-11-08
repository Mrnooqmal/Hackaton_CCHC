// Una firma tomada sin red la puede sincronizar cualquier sesión de la empresa.
//
// La cola de firmas sin conexión sobrevive al cierre de sesión: el supervisor
// toma la asistencia de su cuadrilla sin señal, su sesión vence, y quien entre
// después en ese equipo la sincroniza. Antes, firmar por otra persona exigía el
// permiso de firma asistida aunque la firma viniera con vale, así que esa
// sincronización fallaba con 403 si quien entraba no lo tenía.
//
// Con un vale y sin PIN, la puerta de permisos se abre: el vale prueba el
// consentimiento (la persona lo desbloqueó con su PIN) y FirmaService lo rechaza
// si es de otra persona o de otra empresa (ver vale-firma.test.js). Con PIN sigue
// exigiendo firma asistida.
//
// El doble no encuentra nada: pasar la puerta se ve como el 404 del recurso, no
// pasarla como el 403 del permiso.

process.env.CAMPO_HMAC_KEY = 'clave-de-prueba-hmac';
process.env.CAMPO_CIFRADO_LOCAL_KEY = require('crypto').randomBytes(32).toString('base64');

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const { docClient } = require('../lib/clients/dynamodb');
const documentos = require('../handlers/documents/handler');
const actividades = require('../handlers/activities/handler');
const encuestas = require('../handlers/surveys/handler');

let original;
beforeEach(() => {
    original = docClient.send;
    docClient.send = async () => ({ Items: [] });
});
afterEach(() => { docClient.send = original; });

/** Sesión de la empresa SIN firma asistida, firmando por otra persona. */
const ev = (path, body) => ({
    requestContext: {
        http: { method: 'POST', sourceIp: '10.0.0.1' },
        authorizer: { lambda: { sessionId: 's', personaId: 'p-quien-sincroniza', tenantId: 't-1', rol: 'trabajador', permisos: 'actividades.ver', credencialProvisional: 'false' } },
    },
    pathParameters: path,
    queryStringParameters: {},
    headers: {},
    body: JSON.stringify(body),
});

const CON_VALE = { vale: 'v'.repeat(64), idFirmaLocal: 'local-1', deviceId: 'dev-1', timestampLocal: '2026-11-07T10:00:00.000Z' };

const casos = [
    ['documento', () => documentos.sign, { id: 'd-1' }, { personaId: 'p-otra', tipoFirma: 'trabajador' }],
    ['asistencia', () => actividades.registerAttendance, { id: 'a-1' }, { personaId: 'p-otra' }],
    ['encuesta', () => encuestas.updateResponseStatus, { id: 'e-1', workerId: 'p-otra' }, { estado: 'respondida' }],
];

for (const [nombre, fn, path, cuerpo] of casos) {
    test(`${nombre}: con vale, una sesión de la empresa sin firma asistida pasa la puerta de permisos`, async () => {
        const res = await fn()(ev(path, { ...cuerpo, ...CON_VALE }));
        assert.notEqual(res.statusCode, 403, res.body);
        assert.equal(res.statusCode, 404, `llega a buscar el ${nombre}: ${res.body}`);
    });

    test(`${nombre}: con PIN, firmar por otra persona sigue exigiendo firma asistida`, async () => {
        const res = await fn()(ev(path, { ...cuerpo, pin: '1234' }));
        assert.equal(res.statusCode, 403, res.body);
    });

    test(`${nombre}: con PIN y vale a la vez, manda el PIN y se exige firma asistida`, async () => {
        // Mandar un vale de relleno no puede servir para saltarse el permiso de
        // una firma con PIN.
        const res = await fn()(ev(path, { ...cuerpo, ...CON_VALE, pin: '1234' }));
        assert.equal(res.statusCode, 403, res.body);
    });
}
