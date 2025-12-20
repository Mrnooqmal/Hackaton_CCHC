const { SESClient, SendEmailCommand } = require('@aws-sdk/client-ses');
const { success, error } = require('../lib/response');

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
<html>
<head>
    <meta charset="UTF-8">
    <style>
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: #1a1a1a; color: #e0e0e0; padding: 20px; }
        .container { max-width: 600px; margin: 0 auto; background: #252525; border-radius: 16px; overflow: hidden; }
        .header { background: linear-gradient(135deg, #4CAF50, #2E7D32); padding: 30px; text-align: center; }
        .header h1 { color: white; margin: 0; font-size: 24px; }
        .header p { color: rgba(255,255,255,0.8); margin: 10px 0 0; }
        .content { padding: 30px; }
        .credentials { background: #1a1a1a; border-radius: 12px; padding: 20px; margin: 20px 0; border-left: 4px solid #4CAF50; }
        .credential-item { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #333; }
        .credential-item:last-child { border-bottom: none; }
        .credential-label { color: #888; }
        .credential-value { color: #4CAF50; font-weight: bold; font-family: monospace; font-size: 18px; }
        .steps { margin: 20px 0; }
        .step { display: flex; gap: 15px; margin: 15px 0; }
        .step-number { width: 30px; height: 30px; background: #4CAF50; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: bold; flex-shrink: 0; }
        .warning { background: #ff9800; color: #000; padding: 15px; border-radius: 8px; margin: 20px 0; }
        .footer { padding: 20px; text-align: center; color: #666; font-size: 12px; border-top: 1px solid #333; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🛡️ PrevencionApp</h1>
            <p>Sistema de Gestión de Prevención de Riesgos</p>
        </div>
        <div class="content">
            <p>Hola <strong>${nombre}</strong>,</p>
            <p>Se ha creado tu cuenta en el sistema. A continuación encontrarás tus credenciales de acceso:</p>
            
            <div class="credentials">
                <div class="credential-item">
                    <span class="credential-label">RUT (Usuario)</span>
                    <span class="credential-value">${rut}</span>
                </div>
                <div class="credential-item">
                    <span class="credential-label">Contraseña Temporal</span>
                    <span class="credential-value">${passwordTemporal}</span>
                </div>
            </div>
            
            <h3>🔐 Pasos para activar tu cuenta:</h3>
            <div class="steps">
                <div class="step">
                    <div class="step-number">1</div>
                    <div>Ingresa a la plataforma con las credenciales anteriores</div>
                </div>
                <div class="step">
                    <div class="step-number">2</div>
                    <div>Cambia tu contraseña por una segura de tu elección</div>
                </div>
                <div class="step">
                    <div class="step-number">3</div>
                    <div>Completa el proceso de enrolamiento creando tu PIN de firma digital (4 dígitos)</div>
                </div>
            </div>
            
            <div class="warning">
                ⚠️ <strong>IMPORTANTE:</strong> Esta contraseña es temporal y deberás cambiarla en tu primer acceso.
            </div>
        </div>
        <div class="footer">
            PrevencionApp - Sistema de Gestión DS 44<br>
            Este es un mensaje automático, no responder a este correo.
        </div>
    </div>
</body>
</html>
    `.trim();

    const textBody = `
¡Bienvenido a PrevencionApp!

Hola ${nombre},

Se ha creado tu cuenta en el Sistema de Gestión de Prevención de Riesgos.

📋 Tus credenciales de acceso:
━━━━━━━━━━━━━━━━━━━━━━━━━━━
RUT: ${rut}
CONTRASEÑA TEMPORAL: ${passwordTemporal}
━━━━━━━━━━━━━━━━━━━━━━━━━━━

🔐 Pasos para activar tu cuenta:
1. Ingresa a la plataforma con las credenciales anteriores
2. Cambia tu contraseña por una segura
3. Completa el proceso de enrolamiento creando tu PIN de firma digital

⚠️ IMPORTANTE: Esta contraseña es temporal y deberás cambiarla en tu primer acceso.

---
PrevencionApp - Sistema de Gestión DS 44
Este es un mensaje automático, no responder a este correo.
    `.trim();

    try {
        const command = new SendEmailCommand({
            Source: SENDER_EMAIL,
            Destination: {
                ToAddresses: [email]
            },
            Message: {
                Subject: {
                    Data: 'Bienvenido a PrevencionApp - Tus credenciales de acceso',
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
