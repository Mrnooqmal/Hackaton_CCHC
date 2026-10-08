// Correo: remitente del dominio, respuestas a contacto, conjunto de
// configuración, y a una dirección que rebotó o se quejó no se le vuelve a
// escribir. La marca se guarda por HMAC, nunca la dirección.

process.env.CAMPO_HMAC_KEY = 'clave-de-prueba-hmac';
process.env.SES_CONFIGURATION_SET = 'BuildAndServe-prueba';
delete process.env.SES_SENDER_EMAIL;
delete process.env.SES_REPLY_TO;

const { prepararEntorno, crearDobleTablas } = require('./doble-dynamo-tablas');
const esquemas = prepararEntorno();

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { SESClient } = require('@aws-sdk/client-ses');

const { docClient } = require('../lib/clients/dynamodb');
const { enviarCorreo } = require('../lib/correo');
const eventos = require('../handlers/correo/eventos');
const { aMarcar } = eventos._interno;

let doble;
let enviados;
const sesOriginal = SESClient.prototype.send;
beforeEach(() => {
    doble = crearDobleTablas(docClient, esquemas);
    enviados = [];
    SESClient.prototype.send = async (cmd) => { enviados.push(cmd.input); return { MessageId: 'm-1' }; };
});
afterEach(() => { doble.restaurar(); SESClient.prototype.send = sesOriginal; });

const sns = (...mensajes) => ({ Records: mensajes.map((m) => ({ Sns: { Message: JSON.stringify(m) } })) });
const rebote = (correo, bounceType = 'Permanent') => ({
    eventType: 'Bounce', mail: { timestamp: '2026-09-29T20:00:00Z', destination: [correo] },
    bounce: { bounceType, bounceSubType: 'General', bouncedRecipients: [{ emailAddress: correo }] },
});
const queja = (correo) => ({
    eventType: 'Complaint', mail: { timestamp: '2026-09-29T21:00:00Z', destination: [correo] },
    complaint: { complaintFeedbackType: 'abuse', complainedRecipients: [{ emailAddress: correo }] },
});
const suprimidas = () => doble.items('CORREOS_SUPRIMIDOS_TABLE');

test('qué marca: rebote permanente, queja y rechazo; un rebote transitorio no', () => {
    assert.deepEqual(aMarcar(rebote('a@x.cl')).map((m) => m.motivo), ['rebote']);
    assert.deepEqual(aMarcar(rebote('a@x.cl', 'Transient')), []);
    assert.deepEqual(aMarcar(queja('a@x.cl')).map((m) => m.motivo), ['queja']);
    assert.deepEqual(aMarcar({ eventType: 'Reject', mail: { destination: ['a@x.cl'] }, reject: { reason: 'Bad content' } }).map((m) => m.motivo), ['rechazo']);
    assert.deepEqual(aMarcar({ eventType: 'Delivery', mail: { destination: ['a@x.cl'] } }), []);
    assert.deepEqual(aMarcar({ notificationType: 'Complaint', complaint: { complainedRecipients: [{ emailAddress: 'a@x.cl' }] } }).map((m) => m.motivo), ['queja'],
        'también el formato de notificaciones de identidad');
});

test('un rebote marca la dirección por HMAC, sin guardarla', async () => {
    await eventos.handler(sns(rebote('Juan.Perez@Ejemplo.cl')));
    const [m] = suprimidas();
    assert.equal(m.motivo, 'rebote');
    assert.match(m.correoHmac, /^v1:[0-9a-f]{64}$/);
    assert.ok(!JSON.stringify(suprimidas()).toLowerCase().includes('juan.perez'), 'la dirección no queda en la tabla');
    const dosAnios = Math.floor(Date.now() / 1000) + 2 * 365 * 24 * 3600;
    assert.ok(Math.abs(m.expira - dosAnios) < 60, 'vence a los dos años');
});

test('eventos repetidos: un solo registro, cuenta los eventos, conserva el primer motivo y guarda el último', async () => {
    await eventos.handler(sns(rebote('a@x.cl')));
    await eventos.handler(sns(queja('a@x.cl')));
    assert.equal(suprimidas().length, 1);
    const [m] = suprimidas();
    assert.equal(m.eventos, 2);
    assert.equal(m.motivo, 'rebote');
    assert.equal(m.ultimoMotivo, 'queja');
    assert.equal(m.desde, '2026-09-29T20:00:00Z');
});

test('un mensaje ilegible no corta el lote', async () => {
    const r = await eventos.handler({ Records: [{ Sns: { Message: '{no es json' } }, { Sns: { Message: JSON.stringify(queja('b@x.cl')) } }] });
    assert.equal(r.marcadas, 1);
});

test('envío: remitente del dominio, respuestas a contacto y con el conjunto de configuración', async () => {
    const r = await enviarCorreo({ para: 'a@x.cl', asunto: 'Hola', html: '<p>h</p>', texto: 'h' });
    assert.equal(r.enviado, true);
    const [e] = enviados;
    assert.equal(e.Source, 'Build & Serve <no-responder@buildandserve.cl>');
    assert.deepEqual(e.ReplyToAddresses, ['contacto@buildandserve.cl']);
    assert.equal(e.ConfigurationSetName, 'BuildAndServe-prueba');
    assert.deepEqual(e.Destination.ToAddresses, ['a@x.cl']);
});

test('a una dirección que rebotó o se quejó no se le escribe, con cualquier mayúscula', async () => {
    await eventos.handler(sns(queja('a@x.cl')));
    const r = await enviarCorreo({ para: ' A@X.CL ', asunto: 'Hola', texto: 'h' });
    assert.deepEqual(r, { enviado: false, suprimida: 'queja' });
    assert.equal(enviados.length, 0);
});

test('un rebote transitorio no impide el siguiente envío', async () => {
    await eventos.handler(sns(rebote('a@x.cl', 'Transient')));
    assert.equal((await enviarCorreo({ para: 'a@x.cl', asunto: 'Hola', texto: 'h' })).enviado, true);
});

test('el correo de restablecimiento a una dirección suprimida responde DIRECCION_SUPRIMIDA y no envía', async () => {
    const n = require('../handlers/notifications/handler');
    await eventos.handler(sns(rebote('a@x.cl')));
    const r = await n.sendPasswordResetEmail('a@x.cl', 'Ana', 'https://buildandserve.cl/restablecer?x=1');
    assert.equal(r.code, 'DIRECCION_SUPRIMIDA');
    assert.equal(enviados.length, 0);
});

test('nadie más envía correo: SES solo se usa desde lib/correo.js', () => {
    const raiz = path.join(__dirname, '..');
    const usos = [];
    for (const dir of ['handlers', 'lib']) {
        const recorrer = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => {
            const p = path.join(d, e.name);
            if (e.isDirectory()) return recorrer(p);
            if (p.endsWith('.js') && /client-ses|SendEmailCommand/.test(fs.readFileSync(p, 'utf8'))) usos.push(path.relative(raiz, p));
        });
        recorrer(path.join(raiz, dir));
    }
    assert.deepEqual(usos, ['lib/correo.js']);
});

const YML = fs.readFileSync(path.join(__dirname, '..', 'serverless.yml'), 'utf8');
const bloque = (nombre) => {
    const i = YML.indexOf(`    ${nombre}:\n`);
    assert.ok(i > 0, nombre);
    const resto = YML.slice(i + nombre.length + 6);
    return YML.slice(i, i + nombre.length + 6 + resto.search(/\n {4}[A-Za-z]+:\n/));
};

test('al tópico de eventos solo publica SES de esta cuenta, desde el conjunto del ambiente', () => {
    const b = bloque('PoliticaCorreoEventosTopic');
    assert.match(b, /Service: ses\.amazonaws\.com/);
    assert.match(b, /AWS:SourceAccount/);
    assert.match(b, /ArnLike:\n\s+AWS:SourceArn: !Sub 'arn:aws:ses:[^']*:configuration-set\/\$\{self:provider\.environment\.SES_CONFIGURATION_SET\}'/);
    assert.match(bloque('DestinoEventosCorreo'), /MatchingEventTypes: \[bounce, complaint, reject\]/);
});

test('solo el rol de eventos de correo puede marcar; el rol compartido solo lee', () => {
    const conEscritura = YML.split('\n').map((l, i) => ({ l, i })).filter(({ l }) => /CorreosSuprimidosTable\.Arn/.test(l))
        .map(({ i }) => YML.split('\n').slice(Math.max(0, i - 3), i).join('\n'))
        .filter((antes) => /UpdateItem|PutItem|DeleteItem/.test(antes));
    assert.equal(conEscritura.length, 1);
    assert.match(bloque('RolCorreoEventos'), /dynamodb:UpdateItem\]\n\s+Resource: !GetAtt CorreosSuprimidosTable\.Arn/);
});
