const { enviarCorreo } = require('../../lib/correo');
const { success, error } = require('../../lib/utils/response');
const { escaparHtml } = require('../../lib/escaparHtml');

/** `j***@ejemplo.cl`: el dominio sirve para diagnosticar entregas; la dirección
 *  completa es un dato personal y no va a los logs. */
const enmascararCorreo = (email) => {
    const [local, dominio] = String(email || '').split('@');
    return dominio ? `${local.slice(0, 1)}***@${dominio}` : '(sin correo)';
};

/** A una dirección que rebotó o se quejó no se le escribe (lib/correo.js). */
const SUPRIMIDA = { sent: false, error: 'La dirección está suprimida por un rebote o una queja anterior', code: 'DIRECCION_SUPRIMIDA' };

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

    const loginUrl = `${process.env.FRONTEND_URL || 'https://buildandserve.cl'}/login`;

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
    .btn-login { display: inline-block; background: #006edc; color: #ffffff; text-decoration: none;
                 font-size: 15px; font-weight: 600; padding: 14px 32px; border-radius: 10px; }
    /* Responsive: en móvil reducimos el padding lateral para que el texto no se parta */
    @media only screen and (max-width: 600px) {
      .wrapper { padding: 16px 8px !important; }
      .header { padding: 28px 20px !important; }
      .body { padding: 28px 20px !important; }
      .cred-box { padding: 16px 16px !important; }
      .footer { padding: 18px 20px !important; }
      .logo { font-size: 24px !important; }
      .btn-login { display: block !important; text-align: center !important; }
    }
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
        <p class="greeting">Hola, <strong>${escaparHtml(nombre)}</strong></p>
        <p class="intro">
          Has sido registrado en <strong>Build &amp; Serve</strong>. A continuación encontrarás
          tus credenciales de acceso al sistema.
        </p>

        <div class="cred-box">
          <p class="cred-title">Tus credenciales</p>
          <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
            <tr>
              <td style="font-size:13px;color:#64748b;padding:10px 0;border-bottom:1px solid #e8edf3;">RUT (usuario)</td>
              <td align="right" style="font-family:'Courier New',Courier,monospace;font-size:15px;font-weight:700;color:#002855;letter-spacing:0.04em;padding:10px 0;border-bottom:1px solid #e8edf3;">${escaparHtml(rut)}</td>
            </tr>
            <tr>
              <td style="font-size:13px;color:#64748b;padding:10px 0;">Contraseña temporal</td>
              <td align="right" style="font-family:'Courier New',Courier,monospace;font-size:15px;font-weight:700;color:#002855;letter-spacing:0.04em;padding:10px 0;">${escaparHtml(passwordTemporal)}</td>
            </tr>
          </table>
        </div>

        <div class="alert">
          <p><strong>Importante:</strong> Al ingresar por primera vez al sistema, deberás cambiar
          tu contraseña por seguridad. Esta contraseña temporal no podrá usarse después del
          primer inicio de sesión.</p>
        </div>

        <div style="text-align:center;margin:0 0 28px;">
          <a href="${escaparHtml(loginUrl)}" class="btn-login" style="display:inline-block;background:#006edc;color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;font-family:'Segoe UI',Helvetica,Arial,sans-serif;padding:14px 32px;border-radius:10px;">Ingresar al sistema</a>
        </div>

        <p class="steps-title">Primeros pasos</p>
        <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
          <tr>
            <td width="38" valign="top" style="padding:6px 0;">
              <table cellpadding="0" cellspacing="0" role="presentation"><tr>
                <td width="26" height="26" align="center" valign="middle" style="width:26px;height:26px;background:#002855;color:#ffffff;border-radius:13px;font-size:12px;font-weight:700;font-family:'Segoe UI',Helvetica,Arial,sans-serif;">1</td>
              </tr></table>
            </td>
            <td valign="top" style="font-size:13px;color:#475569;line-height:1.55;padding:6px 0;">Accede al sistema con el RUT y la contraseña temporal indicados arriba.</td>
          </tr>
          <tr>
            <td width="38" valign="top" style="padding:6px 0;">
              <table cellpadding="0" cellspacing="0" role="presentation"><tr>
                <td width="26" height="26" align="center" valign="middle" style="width:26px;height:26px;background:#002855;color:#ffffff;border-radius:13px;font-size:12px;font-weight:700;font-family:'Segoe UI',Helvetica,Arial,sans-serif;">2</td>
              </tr></table>
            </td>
            <td valign="top" style="font-size:13px;color:#475569;line-height:1.55;padding:6px 0;">Crea una contraseña nueva y segura cuando el sistema lo solicite.</td>
          </tr>
          <tr>
            <td width="38" valign="top" style="padding:6px 0;">
              <table cellpadding="0" cellspacing="0" role="presentation"><tr>
                <td width="26" height="26" align="center" valign="middle" style="width:26px;height:26px;background:#002855;color:#ffffff;border-radius:13px;font-size:12px;font-weight:700;font-family:'Segoe UI',Helvetica,Arial,sans-serif;">3</td>
              </tr></table>
            </td>
            <td valign="top" style="font-size:13px;color:#475569;line-height:1.55;padding:6px 0;">Completa tu perfil y el proceso de enrolamiento para habilitar tu firma digital.</td>
          </tr>
        </table>
      </div>
      <div class="footer">
        Build &amp; Serve &mdash; Plataforma de Gestión de Obras<br>
        Este es un mensaje automático. Si necesitas ayuda, responde a este correo o escribe a contacto@buildandserve.cl.
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
Este es un mensaje automático. Si necesitas ayuda, responde a este correo o escribe a contacto@buildandserve.cl.
    `.trim();

    try {
        console.log(`Enviando correo a ${enmascararCorreo(email)}`);
        const r = await enviarCorreo({ para: email, asunto: 'Bienvenido a Build & Serve — Tus credenciales de acceso', html: htmlBody, texto: textBody });
        if (!r.enviado) return SUPRIMIDA;
        console.log(`Correo enviado a ${enmascararCorreo(email)}`);
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
    /* Responsive: en móvil reducimos el padding lateral para que el texto no se parta */
    @media only screen and (max-width: 600px) {
      .wrapper { padding: 16px 8px !important; }
      .header { padding: 28px 20px !important; }
      .body { padding: 28px 20px !important; }
      .footer { padding: 18px 20px !important; }
      .logo { font-size: 24px !important; }
      .btn, .btn-login { display: block !important; text-align: center !important; }
    }
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
        <p class="greeting">Hola, <strong>${escaparHtml(nombre)}</strong></p>
        <p class="intro">
          Recibimos una solicitud para restablecer la contraseña de tu cuenta. Haz clic en el
          botón para crear una nueva contraseña. Este enlace caduca en ${escaparHtml(minutosVigencia)} minutos.
        </p>

        <div class="btn-wrap">
          <a href="${escaparHtml(resetUrl)}" class="btn" style="display:inline-block;background:#006edc;color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;font-family:'Segoe UI',Helvetica,Arial,sans-serif;padding:14px 32px;border-radius:10px;">Restablecer contraseña</a>
        </div>

        <p class="link-fallback">
          Si el botón no funciona, copia y pega este enlace en tu navegador:<br>${escaparHtml(resetUrl)}
        </p>

        <div class="alert">
          <p><strong>¿No fuiste tú?</strong> Si no solicitaste este cambio, ignora este correo:
          tu contraseña actual seguirá siendo válida.</p>
        </div>
      </div>
      <div class="footer">
        Build &amp; Serve &mdash; Plataforma de Gestión de Obras<br>
        Este es un mensaje automático. Si necesitas ayuda, responde a este correo o escribe a contacto@buildandserve.cl.
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
Este es un mensaje automático. Si necesitas ayuda, responde a este correo o escribe a contacto@buildandserve.cl.
    `.trim();

    try {
        console.log(`Enviando correo de recuperación a ${enmascararCorreo(email)}`);
        const r = await enviarCorreo({ para: email, asunto: 'Build & Serve — Restablece tu contraseña', html: htmlBody, texto: textBody });
        if (!r.enviado) return SUPRIMIDA;
        console.log(`Correo de recuperación enviado a ${enmascararCorreo(email)}`);
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
 * Envía el enlace de activación de una empresa (licencia de un solo uso).
 *
 * El enlace ES la credencial: quien lo tenga puede dar de alta la empresa. Por
 * eso el correo dice cuándo vence y que sirve una sola vez, y por eso el enlace
 * no se guarda en ninguna parte salvo en este mensaje.
 *
 * @param {string} email - destinatario, el futuro administrador
 * @param {string} enlace - URL completa con el token
 * @param {number} dias - vigencia, para decirla en el cuerpo
 * @param {string|null} nombreEmpresa - si se prellenó, para personalizar
 */
const sendOnboardingLicenseEmail = async (email, enlace, dias, nombreEmpresa = null) => {
    if (!email) return { sent: false, reason: 'no_email' };

    const para = nombreEmpresa ? ` de <strong>${escaparHtml(nombreEmpresa)}</strong>` : '';
    const htmlBody = `
<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:24px;background:#f4f5f7;font-family:Arial,Helvetica,sans-serif;color:#1f2937;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:8px;padding:32px;">
    <tr><td>
      <div style="font-size:20px;font-weight:700;color:#002855;margin-bottom:4px;">Build &amp; Serve</div>
      <div style="font-size:13px;color:#6b7280;margin-bottom:24px;">Plataforma de gestión preventiva — DS 44/2024</div>

      <h1 style="font-size:18px;margin:0 0 12px;">Activa la cuenta${para}</h1>
      <p style="font-size:14px;line-height:1.6;margin:0 0 20px;">
        Te invitamos a crear la cuenta de tu empresa. Con el botón de abajo vas a
        completar los datos de la empresa y los tuyos como administrador, y a
        elegir tu contraseña.
      </p>

      <p style="margin:0 0 24px;">
        <a href="${escaparHtml(enlace)}" style="display:inline-block;background:#002855;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:6px;font-size:14px;font-weight:600;">Activar mi empresa</a>
      </p>

      <p style="font-size:13px;line-height:1.6;color:#6b7280;margin:0 0 8px;">
        El enlace <strong>sirve una sola vez</strong> y vence en ${escaparHtml(dias)} días.
        No lo reenvíes: quien lo tenga puede completar el alta.
      </p>
      <p style="font-size:12px;color:#9ca3af;word-break:break-all;margin:16px 0 0;">
        Si el botón no funciona, copia esta dirección en tu navegador:<br>${escaparHtml(enlace)}
      </p>
    </td></tr>
  </table>
</body>
</html>`.trim();

    const textBody = `
Build & Serve — Activa la cuenta${nombreEmpresa ? ` de ${nombreEmpresa}` : ''}

Completa los datos de tu empresa y elige tu contraseña en este enlace:

${enlace}

El enlace sirve una sola vez y vence en ${dias} días. No lo reenvíes: quien lo
tenga puede completar el alta.

---
Build & Serve — Plataforma de Gestión de Obras
Este es un mensaje automático. Si necesitas ayuda, responde a este correo o escribe a contacto@buildandserve.cl.
`.trim();

    try {
        const r = await enviarCorreo({ para: email, asunto: 'Build & Serve — Activa la cuenta de tu empresa', html: htmlBody, texto: textBody });
        if (!r.enviado) return SUPRIMIDA;
        return { sent: true, email };
    } catch (err) {
        console.error('Error enviando la licencia de alta:', err);
        if (err.name === 'MessageRejected') {
            return { sent: false, error: 'Email no verificado en SES sandbox', code: 'SANDBOX_RESTRICTION' };
        }
        return { sent: false, error: err.message };
    }
};

/**
 * Aviso a una persona de que su PIN de firma fue restablecido por otra.
 *
 * Es la otra mitad del aviso en bandeja: la persona afectada es la única que
 * puede notar que no lo pidió, y puede no estar entrando a la plataforma. El
 * correo no lleva enlace ni ningún dato que sirva para configurar el PIN nuevo:
 * solo dice qué pasó, quién y cuándo, y qué hacer si no lo pidió.
 *
 * `motivo` y `porNombre` los escribe un usuario: se escapan antes de ir al HTML.
 */
const sendPinRestablecidoEmail = async (email, nombre, { porNombre, fecha, horario, motivo }) => {
    if (!email) return { sent: false, reason: 'no_email' };

    const htmlBody = `
<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:24px;background:#f4f5f7;font-family:Arial,Helvetica,sans-serif;color:#1f2937;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:8px;padding:32px;">
    <tr><td>
      <div style="font-size:20px;font-weight:700;color:#002855;margin-bottom:24px;">Build &amp; Serve</div>
      <h1 style="font-size:18px;margin:0 0 12px;">Tu PIN de firma fue restablecido</h1>
      <p style="font-size:14px;line-height:1.6;margin:0 0 16px;">
        Hola ${escaparHtml(nombre)}: <strong>${escaparHtml(porNombre)}</strong> restableció tu PIN de firma
        el ${escaparHtml(fecha)} a las ${escaparHtml(horario)}.
      </p>
      <p style="font-size:14px;line-height:1.6;margin:0 0 16px;">Motivo registrado: ${escaparHtml(motivo)}</p>
      <p style="font-size:14px;line-height:1.6;margin:0 0 16px;">
        Tu PIN anterior ya no sirve, y los vales para firmar sin conexión que tenías quedaron anulados.
        Para volver a firmar tienes que crear un PIN nuevo: tú mismo en la plataforma (Configuración, «Crear PIN de firma nuevo»), o en terreno
        con ayuda de alguien distinto de quien lo restableció. El PIN nuevo lo escribes tú; nadie más
        debe conocerlo.
      </p>
      <p style="font-size:14px;line-height:1.6;margin:0;">
        <strong>Si no pediste esto</strong>, avisa a tu empresa o al prevencionista de tu obra.
      </p>
    </td></tr>
  </table>
</body>
</html>`.trim();

    const textBody = `
Build & Serve — Tu PIN de firma fue restablecido

Hola ${nombre}: ${porNombre} restableció tu PIN de firma el ${fecha} a las ${horario}.

Motivo registrado: ${motivo}

Tu PIN anterior ya no sirve, y los vales para firmar sin conexión que tenías
quedaron anulados. Para volver a firmar tienes que crear un PIN nuevo: tú mismo
en la plataforma (Configuración, «Crear PIN de firma nuevo»), o en terreno con
ayuda de alguien distinto de quien lo restableció. El PIN nuevo lo escribes tú; nadie más debe conocerlo.

Si no pediste esto, avisa a tu empresa o al prevencionista de tu obra.

---
Build & Serve — Plataforma de Gestión de Obras
Este es un mensaje automático. Si necesitas ayuda, responde a este correo o escribe a contacto@buildandserve.cl.
`.trim();

    try {
        const r = await enviarCorreo({ para: email, asunto: 'Build & Serve — Tu PIN de firma fue restablecido', html: htmlBody, texto: textBody });
        if (!r.enviado) return SUPRIMIDA;
        return { sent: true };
    } catch (err) {
        console.error('Error enviando el aviso de PIN restablecido a', enmascararCorreo(email), '-', err.name);
        return { sent: false, error: err.name || 'error', err };
    }
};

/**
 * POST /notifications/welcome - Enviar email de bienvenida manualmente
 */
module.exports.sendWelcome = async (event) => {
    try {
        // ENDPOINT ELIMINADO — `POST /test-email`.
        //
        // Era un endpoint de prueba expuesto públicamente en producción: permitía
        // que cualquiera disparara correos desde el remitente verificado del
        // sistema. Además registraba el cuerpo completo del request en CloudWatch,
        // que incluye RUT y contraseña temporal, con retención infinita.
        //
        // La ruta se retira de `serverless.yml` en el despliegue completo. Este
        // corte cubre el intervalo. La función interna `sendWelcomeEmail`, que sí
        // usa el alta de empresa, no se toca.
        return error('Endpoint eliminado.', 410);

        // eslint-disable-next-line no-unreachable
        const body = JSON.parse(event.body || '{}');
        const { email, nombre, rut, passwordTemporal } = body;
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
module.exports.sendOnboardingLicenseEmail = sendOnboardingLicenseEmail;
module.exports.sendPinRestablecidoEmail = sendPinRestablecidoEmail;
