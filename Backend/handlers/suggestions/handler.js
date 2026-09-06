const { v4: uuidv4 } = require('uuid');
const { PutCommand } = require('@aws-sdk/lib-dynamodb');
const { SESClient, SendEmailCommand } = require('@aws-sdk/client-ses');
const { docClient } = require('../../lib/clients/dynamodb');
const { created, error } = require('../../lib/utils/response');
const { validateRequired } = require('../../lib/utils/validation');

const SUGGESTIONS_TABLE = process.env.SUGGESTIONS_TABLE || 'Suggestions';
const SENDER_EMAIL = process.env.SES_SENDER_EMAIL || 'noreply@buildandserve.cl';
const SUGGESTIONS_RECIPIENT = 'thecodecookers@gmail.com';

const sesClient = new SESClient({ region: 'us-east-1' });

const ROUTE_LABELS = {
    '/': 'Dashboard',
    '/personas': 'Gestión de Personas',
    '/obras': 'Gestión de Obras',
    '/documents': 'Documentos',
    '/documents-repository': 'Repositorio de Documentos',
    '/surveys': 'Encuestas',
    '/incidents': 'Incidentes',
    '/activities': 'Actividades',
    '/signature-requests': 'Solicitudes de Firma',
    '/my-signatures': 'Mis Firmas',
    '/offline-signatures': 'Firmas Offline',
    '/inbox': 'Bandeja de Entrada',
    '/settings': 'Configuración',
    '/enroll-me': 'Mi Enrolamiento',
};

function resolveInterfaceLabel(source) {
    if (!source) return 'Web App';
    if (ROUTE_LABELS[source]) return ROUTE_LABELS[source];
    // Match dynamic routes like /personas/12345678-9 or /obras/abc123
    if (source.startsWith('/personas/')) return 'Detalle de Persona';
    if (source.startsWith('/obras/')) return 'Detalle de Obra';
    if (source.startsWith('/workers/')) return 'Detalle de Trabajador';
    return source;
}

const sendSuggestionEmail = async ({ userName, interfaceLabel, message, createdAt }) => {
    const dateStr = new Date(createdAt).toLocaleString('es-CL', {
        timeZone: 'America/Santiago',
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
    });

    const subject = `Nueva sugerencia de ${userName || 'Usuario desconocido'}`;

    const textBody = `${userName || 'Usuario desconocido'} - ${interfaceLabel} - ${message} - ${dateStr}`;

    const htmlBody = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <style>
    body { margin: 0; padding: 0; background: #f0f4f8; font-family: 'Segoe UI', Helvetica, Arial, sans-serif; }
    .wrapper { padding: 32px 16px; }
    .card { max-width: 560px; margin: 0 auto; background: #ffffff; border-radius: 16px; overflow: hidden;
            box-shadow: 0 4px 24px rgba(0,0,0,0.10); }
    .header { background: linear-gradient(135deg, #002855 0%, #006edc 100%); padding: 28px 32px; }
    .logo { font-size: 22px; font-weight: 700; color: #ffffff; margin: 0; }
    .logo-amp { color: #df3601; }
    .header-sub { font-size: 13px; color: rgba(255,255,255,0.65); margin: 4px 0 0; }
    .body { padding: 28px 32px; }
    .row { display: flex; gap: 0; margin-bottom: 14px; border-bottom: 1px solid #e2e8f0; padding-bottom: 14px; }
    .row:last-child { border-bottom: none; margin-bottom: 0; padding-bottom: 0; }
    .label { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em;
             color: #94a3b8; min-width: 130px; padding-top: 2px; }
    .value { font-size: 14px; color: #0f172a; line-height: 1.55; flex: 1; }
    .message-box { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px;
                   padding: 14px 18px; font-size: 14px; color: #334155; line-height: 1.65; }
    .footer { background: #f8fafc; border-top: 1px solid #e8edf3; padding: 16px 32px;
              text-align: center; font-size: 11px; color: #94a3b8; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="card">
      <div class="header">
        <p class="logo">Build <span class="logo-amp">&amp;</span> Serve</p>
        <p class="header-sub">Nueva sugerencia recibida</p>
      </div>
      <div class="body">
        <div class="row">
          <span class="label">Usuario</span>
          <span class="value">${userName || 'Desconocido'}</span>
        </div>
        <div class="row">
          <span class="label">Interfaz</span>
          <span class="value">${interfaceLabel}</span>
        </div>
        <div class="row">
          <span class="label">Fecha y hora</span>
          <span class="value">${dateStr}</span>
        </div>
        <div class="row">
          <span class="label">Sugerencia</span>
          <span class="value"><div class="message-box">${message.replace(/\n/g, '<br>')}</div></span>
        </div>
      </div>
      <div class="footer">
        Build &amp; Serve — Plataforma de Gestión de Obras<br>
        Este es un mensaje automático generado por el sistema de sugerencias.
      </div>
    </div>
  </div>
</body>
</html>`.trim();

    try {
        await sesClient.send(new SendEmailCommand({
            Source: SENDER_EMAIL,
            Destination: { ToAddresses: [SUGGESTIONS_RECIPIENT] },
            Message: {
                Subject: { Data: subject, Charset: 'UTF-8' },
                Body: {
                    Html: { Data: htmlBody, Charset: 'UTF-8' },
                    Text: { Data: textBody, Charset: 'UTF-8' },
                },
            },
        }));
        console.log(`Suggestion email sent to ${SUGGESTIONS_RECIPIENT}`);
    } catch (err) {
        console.error('Error sending suggestion email:', err);
    }
};

module.exports.create = async (event) => {
    try {
        const body = JSON.parse(event.body || '{}');
        const tenantId = body.tenantId
            || event.queryStringParameters?.tenantId
            || event.requestContext?.authorizer?.claims?.['custom:tenantId']
            || null;
        const userId = body.userId
            || event.requestContext?.authorizer?.claims?.sub
            || null;
        const userName = body.userName || body.creatorName || null;
        const message = body.message || body.suggestion || '';
        const source = body.source || null;

        const validation = validateRequired({ tenantId, userId, message }, ['tenantId', 'userId', 'message']);
        if (!validation.valid) {
            return error(`Campos requeridos faltantes: ${validation.missing.join(', ')}`);
        }

        const now = new Date().toISOString();
        const item = {
            suggestionId: uuidv4(),
            tenantId,
            userId,
            userName,
            message,
            source,
            createdAt: now,
        };

        await docClient.send(new PutCommand({
            TableName: SUGGESTIONS_TABLE,
            Item: item,
        }));

        const interfaceLabel = resolveInterfaceLabel(source);
        await sendSuggestionEmail({ userName, interfaceLabel, message, createdAt: now });

        return created({
            suggestionId: item.suggestionId,
            createdAt: item.createdAt,
        });
    } catch (err) {
        console.error('Error creating suggestion:', err);
        return error(err.message, 500);
    }
};
