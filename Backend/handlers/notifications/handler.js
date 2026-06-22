const { SESClient, SendEmailCommand } = require('@aws-sdk/client-ses');
const { success, error } = require('../../lib/utils/response');

const sesClient = new SESClient({ region: 'us-east-1' });

// Email verificado en SES (DEBES VERIFICAR ESTE EMAIL EN AWS SES CONSOLE)
const SENDER_EMAIL = process.env.SES_SENDER_EMAIL || 'noreply@prevencionapp.cl';

/**
 * Envía un email de bienvenida con credenciales temporales
 * @param {string} email - Email del destinatario
 * @param {string} nombre - Nombre del usuario
 * @param {string} rut - RUT del usuario (para login)
 * @param {string} passwordTemporal - Contraseña temporal
 */
const sendWelcomeEmail = async (email, nombre, rut, passwordTemporal) => {
    if (!email) {
        console.log('No email provided, skipping notification');
        return { sent: false, reason: 'no_email' };
    }

    const htmlBody = `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body { margin: 0; padding: 0; background: #f0f4f8; font-family: 'Segoe UI', Helvetica, Arial, sans-serif; }
    .wrapper { padding: 32px 16px; }
    .card { max-width: 560px; margin: 0 auto; background: #ffffff; border-radius: 16px; overflow: hidden;
            box-shadow: 0 4px 24px rgba(0,0,0,0.10); }
    .header { background: linear-gradient(135deg, #002855 0%, #006edc 100%); padding: 36px 40px; text-align: center; }
    .logo { font-size: 28px; font-weight: 700; color: #ffffff; letter-spacing: -0.5px; margin: 0; }
    .logo-amp { color: #df3601; }
    .logo-sub { font-size: 13px; color: rgba(255,255,255,0.70); margin: 6px 0 0; font-weight: 400; }
    .body { padding: 36px 40px; }
    .greeting { font-size: 16px; color: #0f172a; margin: 0 0 12px; }
    .intro { font-size: 14px; color: #475569; line-height: 1.65; margin: 0 0 28px; }
    .cred-box { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px;
                padding: 20px 24px; margin: 0 0 28px; }
    .cred-title { font-size: 11px; font-weight: 700; color: #94a3b8; text-transform: uppercase;
                  letter-spacing: 0.08em; margin: 0 0 14px; }
    .cred-row { display: flex; justify-content: space-between; align-items: center;
                padding: 10px 0; border-bottom: 1px solid #e8edf3; }
    .cred-row:last-child { border-bottom: none; padding-bottom: 0; }
    .cred-label { font-size: 13px; color: #64748b; }
    .cred-value { font-family: 'Courier New', Courier, monospace; font-size: 15px;
                  font-weight: 700; color: #002855; letter-spacing: 0.04em; }
    .alert { background: #fff8f0; border: 1px solid #fed7a0; border-left: 4px solid #df3601;
             border-radius: 8px; padding: 14px 18px; margin: 0 0 28px; }
    .alert p { margin: 0; font-size: 13px; color: #7c2d12; line-height: 1.55; }
    .alert strong { color: #df3601; }
    .steps-title { font-size: 13px; font-weight: 700; color: #0f172a; margin: 0 0 12px; }
    .step { display: flex; gap: 14px; align-items: flex-start; margin: 10px 0; }
    .step-num { width: 26px; height: 26px; border-radius: 50%; background: #002855; color: #fff;
                font-size: 12px; font-weight: 700; display: flex; align-items: center;
                justify-content: center; flex-shrink: 0; }
    .step p { margin: 0; font-size: 13px; color: #475569; line-height: 1.55; padding-top: 3px; }
    .footer { background: #f8fafc; border-top: 1px solid #e8edf3; padding: 20px 40px;
              text-align: center; font-size: 11px; color: #94a3b8; line-height: 1.6; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="card">
      <div class="header">
        <p class="logo">Build <span class="logo-amp">&amp;</span> Serve</p>
        <p class="logo-sub">Plataforma de Gestión de Obras y Prevención de Riesgos</p>
      </div>
      <div class="body">
        <p class="greeting">Hola, <strong>${nombre}</strong></p>
        <p class="intro">
          Has sido registrado en <strong>Build &amp; Serve</strong>. A continuación encontrarás
          tus credenciales de acceso al sistema.
        </p>

        <div class="cred-box">
          <p class="cred-title">Tus credenciales</p>
          <div class="cred-row">
            <span class="cred-label">RUT (usuario)</span>
            <span class="cred-value">${rut}</span>
          </div>
          <div class="cred-row">
            <span class="cred-label">Contraseña temporal</span>
            <span class="cred-value">${passwordTemporal}</span>
          </div>
        </div>

        <div class="alert">
          <p><strong>Importante:</strong> Al ingresar por primera vez al sistema, deberás cambiar
          tu contraseña por seguridad. Esta contraseña temporal no podrá usarse después del
          primer inicio de sesión.</p>
        </div>

        <p class="steps-title">Primeros pasos</p>
        <div class="step">
          <div class="step-num">1</div>
          <p>Accede al sistema con el RUT y la contraseña temporal indicados arriba.</p>
        </div>
        <div class="step">
          <div class="step-num">2</div>
          <p>Crea una contraseña nueva y segura cuando el sistema lo solicite.</p>
        </div>
        <div class="step">
          <div class="step-num">3</div>
          <p>Completa tu perfil y el proceso de enrolamiento para habilitar tu firma digital.</p>
        </div>
      </div>
      <div class="footer">
        Build &amp; Serve &mdash; Plataforma de Gestión de Obras<br>
        Este es un mensaje automático. Por favor no respondas a este correo.
      </div>
    </div>
  </div>
</body>
</html>`.trim();

    const textBody = `
Hola ${nombre},

Has sido registrado en Build & Serve — Plataforma de Gestión de Obras y Prevención de Riesgos.

Tus credenciales de acceso:
  RUT (usuario):       ${rut}
  Contraseña temporal: ${passwordTemporal}

IMPORTANTE: Al ingresar por primera vez al sistema debes cambiar tu contraseña por seguridad.
Esta contraseña temporal no podrá usarse después del primer inicio de sesión.

Primeros pasos:
  1. Accede al sistema con el RUT y la contraseña temporal indicados arriba.
  2. Crea una contraseña nueva y segura cuando el sistema lo solicite.
  3. Completa tu perfil y el proceso de enrolamiento para habilitar tu firma digital.

---
Build & Serve — Plataforma de Gestión de Obras
Este es un mensaje automático. Por favor no respondas a este correo.
    `.trim();

    try {
        const command = new SendEmailCommand({
            Source: SENDER_EMAIL,
            Destination: {
                ToAddresses: [email]
            },
            Message: {
                Subject: {
                    Data: 'Bienvenido a Build & Serve — Tus credenciales de acceso',
                    Charset: 'UTF-8'
                },
                Body: {
                    Html: {
                        Data: htmlBody,
                        Charset: 'UTF-8'
                    },
                    Text: {
                        Data: textBody,
                        Charset: 'UTF-8'
                    }
                }
            }
        });

        console.log(`Attempting to send SES email from ${SENDER_EMAIL} to ${email}`);
        await sesClient.send(command);
        console.log(`SES Publish successful for ${email}`);
        return { sent: true, email };
    } catch (err) {
        console.error('Error sending welcome email:', err);
        // Si estamos en sandbox y el email no está verificado, devolver error específico
        if (err.name === 'MessageRejected') {
            return { sent: false, error: 'Email no verificado en SES sandbox', code: 'SANDBOX_RESTRICTION' };
        }
        return { sent: false, error: err.message };
    }
};

/**
 * Envía un email de recuperación de contraseña con un enlace de un solo uso.
 * @param {string} email - Email del destinatario
 * @param {string} nombre - Nombre del usuario
 * @param {string} resetUrl - Enlace temporal para restablecer la contraseña
 * @param {number} minutosVigencia - Minutos de validez del enlace (para el texto)
 */
const sendPasswordResetEmail = async (email, nombre, resetUrl, minutosVigencia = 30) => {
    if (!email) {
        console.log('No email provided, skipping password reset notification');
        return { sent: false, reason: 'no_email' };
    }

    const htmlBody = `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body { margin: 0; padding: 0; background: #f0f4f8; font-family: 'Segoe UI', Helvetica, Arial, sans-serif; }
    .wrapper { padding: 32px 16px; }
    .card { max-width: 560px; margin: 0 auto; background: #ffffff; border-radius: 16px; overflow: hidden;
            box-shadow: 0 4px 24px rgba(0,0,0,0.10); }
    .header { background: linear-gradient(135deg, #002855 0%, #006edc 100%); padding: 36px 40px; text-align: center; }
    .logo { font-size: 28px; font-weight: 700; color: #ffffff; letter-spacing: -0.5px; margin: 0; }
    .logo-amp { color: #df3601; }
    .logo-sub { font-size: 13px; color: rgba(255,255,255,0.70); margin: 6px 0 0; font-weight: 400; }
    .body { padding: 36px 40px; }
    .greeting { font-size: 16px; color: #0f172a; margin: 0 0 12px; }
    .intro { font-size: 14px; color: #475569; line-height: 1.65; margin: 0 0 28px; }
    .btn-wrap { text-align: center; margin: 0 0 28px; }
    .btn { display: inline-block; background: #006edc; color: #ffffff; text-decoration: none;
           font-size: 15px; font-weight: 600; padding: 14px 32px; border-radius: 10px; }
    .link-fallback { font-size: 12px; color: #94a3b8; line-height: 1.6; margin: 0 0 28px; word-break: break-all; }
    .alert { background: #fff8f0; border: 1px solid #fed7a0; border-left: 4px solid #df3601;
             border-radius: 8px; padding: 14px 18px; margin: 0 0 28px; }
    .alert p { margin: 0; font-size: 13px; color: #7c2d12; line-height: 1.55; }
    .alert strong { color: #df3601; }
    .footer { background: #f8fafc; border-top: 1px solid #e8edf3; padding: 20px 40px;
              text-align: center; font-size: 11px; color: #94a3b8; line-height: 1.6; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="card">
      <div class="header">
        <p class="logo">Build <span class="logo-amp">&amp;</span> Serve</p>
        <p class="logo-sub">Plataforma de Gestión de Obras y Prevención de Riesgos</p>
      </div>
      <div class="body">
        <p class="greeting">Hola, <strong>${nombre}</strong></p>
        <p class="intro">
          Recibimos una solicitud para restablecer la contraseña de tu cuenta. Haz clic en el
          botón para crear una nueva contraseña. Este enlace caduca en ${minutosVigencia} minutos.
        </p>

        <div class="btn-wrap">
          <a href="${resetUrl}" class="btn">Restablecer contraseña</a>
        </div>

        <p class="link-fallback">
          Si el botón no funciona, copia y pega este enlace en tu navegador:<br>${resetUrl}
        </p>

        <div class="alert">
          <p><strong>¿No fuiste tú?</strong> Si no solicitaste este cambio, ignora este correo:
          tu contraseña actual seguirá siendo válida.</p>
        </div>
      </div>
      <div class="footer">
        Build &amp; Serve &mdash; Plataforma de Gestión de Obras<br>
        Este es un mensaje automático. Por favor no respondas a este correo.
      </div>
    </div>
  </div>
</body>
</html>`.trim();

    const textBody = `
Hola ${nombre},

Recibimos una solicitud para restablecer la contraseña de tu cuenta en Build & Serve.

Abre este enlace para crear una nueva contraseña (caduca en ${minutosVigencia} minutos):
${resetUrl}

¿No fuiste tú? Si no solicitaste este cambio, ignora este correo: tu contraseña actual
seguirá siendo válida.

---
Build & Serve — Plataforma de Gestión de Obras
Este es un mensaje automático. Por favor no respondas a este correo.
    `.trim();

    try {
        const command = new SendEmailCommand({
            Source: SENDER_EMAIL,
            Destination: { ToAddresses: [email] },
            Message: {
                Subject: {
                    Data: 'Build & Serve — Restablece tu contraseña',
                    Charset: 'UTF-8'
                },
                Body: {
                    Html: { Data: htmlBody, Charset: 'UTF-8' },
                    Text: { Data: textBody, Charset: 'UTF-8' }
                }
            }
        });

        console.log(`Attempting to send SES password reset email from ${SENDER_EMAIL} to ${email}`);
        await sesClient.send(command);
        console.log(`SES password reset email sent for ${email}`);
        return { sent: true, email };
    } catch (err) {
        console.error('Error sending password reset email:', err);
        if (err.name === 'MessageRejected') {
            return { sent: false, error: 'Email no verificado en SES sandbox', code: 'SANDBOX_RESTRICTION' };
        }
        return { sent: false, error: err.message };
    }
};

/**
 * POST /notifications/welcome - Enviar email de bienvenida manualmente
 */
module.exports.sendWelcome = async (event) => {
    try {
        const body = JSON.parse(event.body || '{}');
        const { email, nombre, rut, passwordTemporal } = body;
        console.log('Received notification request body:', body);
        if (!email || !nombre || !rut || !passwordTemporal) {
            console.error('Missing required fields in notification request');
            return error('Faltan campos requeridos: email, nombre, rut, passwordTemporal');
        }

        const result = await sendWelcomeEmail(email, nombre, rut, passwordTemporal);

        if (result.sent) {
            return success({ message: 'Email enviado exitosamente', email });
        } else {
            return error(`No se pudo enviar el email: ${result.reason || result.error}`, 500);
        }
    } catch (err) {
        console.error('Error in sendWelcome:', err);
        return error(err.message, 500);
    }
};

module.exports.sendWelcomeEmail = sendWelcomeEmail;
module.exports.sendPasswordResetEmail = sendPasswordResetEmail;
