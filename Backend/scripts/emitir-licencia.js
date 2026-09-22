#!/usr/bin/env node
/**
 * Emisión de licencias de alta: la invitación de un solo uso con la que una
 * empresa hace su propio onboarding por interfaz.
 *
 * ── Por qué una licencia y no un alta directa ────────────────────────────────
 *
 * `crear-empresa.js` sigue existiendo y sirve para dar de alta una empresa
 * tecleando sus datos. Pero los datos de una empresa los conoce la empresa: su
 * razón social exacta, su RUT, quién va a administrar el sistema. Con la
 * licencia, nosotros autorizamos —que es lo único que solo nosotros podemos
 * hacer— y ellos completan.
 *
 * La autorización acá es IAM, igual que en `crear-empresa.js`: corre quien tiene
 * credenciales de AWS sobre las tablas, y cada emisión queda en CloudTrail.
 *
 * ── Uso ──────────────────────────────────────────────────────────────────────
 *
 *   # Ensayo: valida y muestra lo que haría, sin escribir nada.
 *   AWS_PROFILE=<perfil> node scripts/emitir-licencia.js --stage prod \
 *       --email maria.soto@constructora.cl
 *
 *   # Emisión real, con prellenado opcional de la empresa.
 *   AWS_PROFILE=<perfil> node scripts/emitir-licencia.js --stage prod \
 *       --email maria.soto@constructora.cl \
 *       --empresa "Constructora Ejemplo SpA" --rut-empresa 76.111.999-0 \
 *       --confirmar
 *
 *   # Ver qué se emitió y en qué estado está cada licencia.
 *   AWS_PROFILE=<perfil> node scripts/emitir-licencia.js --stage prod --listar
 *
 *   # Anular una licencia que todavía no se usó.
 *   AWS_PROFILE=<perfil> node scripts/emitir-licencia.js --stage prod \
 *       --revocar <licenciaId> --confirmar
 *
 * El enlace viaja por correo. Si el envío falla —SES en sandbox, por ejemplo—
 * se imprime UNA vez en la terminal: es la única copia que existe fuera del
 * correo, porque la tabla guarda solo su hash.
 */

const SERVICIO = 'BuildAndServe';

const args = process.argv.slice(2);
const valorDe = (flag) => {
    const i = args.indexOf(flag);
    return i !== -1 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : null;
};

const stage = valorDe('--stage');
const email = valorDe('--email');
const nombreEmpresa = valorDe('--empresa');
const rutEmpresa = valorDe('--rut-empresa');
const revocarId = valorDe('--revocar');
const listar = args.includes('--listar');
const confirmar = args.includes('--confirmar');
const dias = Number(valorDe('--dias') || 7);

const salir = (mensaje) => { console.error(`\n  ${mensaje}\n`); process.exit(1); };

if (args.includes('--help') || args.includes('-h') || !stage || (!email && !listar && !revocarId)) {
    console.log(`
  Licencias de alta: invitación de un solo uso para que una empresa se dé de alta.

    AWS_PROFILE=<perfil> node scripts/emitir-licencia.js --stage <dev|prod> --email <correo> [opciones]

  Opciones:
    --empresa "<nombre>"      Prellena el nombre en el formulario.
    --rut-empresa <rut>       Prellena el RUT en el formulario.
    --dias <n>                Vigencia del enlace (por omisión 7).
    --confirmar               Escribe de verdad. Sin esto es un ensayo.
    --listar                  Muestra las licencias emitidas y su estado.
    --revocar <licenciaId>    Anula una licencia que no se haya usado.
`);
    process.exit(args.includes('--help') || args.includes('-h') ? 0 : 1);
}

if (!['dev', 'prod'].includes(stage)) salir(`Stage inválido: "${stage}". Debe ser dev o prod.`);
if (!process.env.AWS_PROFILE && !process.env.AWS_ACCESS_KEY_ID) {
    salir('Falta AWS_PROFILE (o credenciales en el entorno): la autorización de este script es IAM.');
}

process.env.AWS_REGION = process.env.AWS_REGION || 'us-east-1';
process.env.LICENCIAS_TABLE = `${SERVICIO}-licencias-${stage}`;
process.env.TENANTS_TABLE = `${SERVICIO}-tenants-${stage}`;
process.env.PERSONAS_TABLE = `${SERVICIO}-personas-${stage}`;
process.env.SES_SENDER_EMAIL = process.env.SES_SENDER_EMAIL || 'thecodecookers@gmail.com';

// La URL del frontend arma el enlace. Es la misma que usa la recuperación de
// contraseña, así que un ambiente bien configurado ya la tiene.
const FRONTEND_URL = process.env.FRONTEND_URL
    || (stage === 'prod' ? 'https://d30jksx91fodea.cloudfront.net' : 'http://localhost:5173');

const { LicenciaService } = require('../lib/services/LicenciaService');
const { validateRut } = require('../lib/utils/validation');

const fmt = (s, n) => String(s ?? '—').padEnd(n).slice(0, n);

(async () => {
    // ── Listado ──────────────────────────────────────────────────────────────
    if (listar) {
        const licencias = await LicenciaService.listar();
        if (!licencias.length) {
            console.log('\n  No hay licencias emitidas en este ambiente.\n');
            return;
        }
        console.log(`\n  Licencias en ${stage}:\n`);
        console.log(`  ${fmt('licenciaId', 38)} ${fmt('correo', 34)} ${fmt('estado', 10)} ${fmt('vence', 12)} empresa`);
        console.log(`  ${'-'.repeat(38)} ${'-'.repeat(34)} ${'-'.repeat(10)} ${'-'.repeat(12)} -------`);
        for (const l of licencias) {
            console.log(`  ${fmt(l.licenciaId, 38)} ${fmt(l.email, 34)} ${fmt(LicenciaService.estadoVisible(l), 10)} ${fmt(String(l.expiresAt).slice(0, 10), 12)} ${l.tenantId || (l.prellenado?.nombre || '')}`);
        }
        console.log('');
        return;
    }

    // ── Revocación ───────────────────────────────────────────────────────────
    if (revocarId) {
        const licencias = await LicenciaService.listar();
        const objetivo = licencias.find((l) => l.licenciaId === revocarId);
        if (!objetivo) salir(`No existe una licencia con id ${revocarId} en ${stage}.`);

        const estado = LicenciaService.estadoVisible(objetivo);
        console.log(`
  Ambiente:   ${stage}
  Licencia:   ${objetivo.licenciaId}
  Correo:     ${objetivo.email}
  Estado:     ${estado}
`);
        if (estado === 'usada') salir('Esa licencia ya se usó: la empresa existe. Revocarla no la deshace.');
        if (!confirmar) {
            console.log('  Ensayo: no se escribió nada. Repite con --confirmar para revocar.\n');
            return;
        }

        const res = await LicenciaService.revocar(revocarId);
        if (!res.ok) salir(`No se pudo revocar (${res.motivo}).`);
        console.log('  Licencia revocada. El enlace deja de servir de inmediato.\n');
        return;
    }

    // ── Emisión ──────────────────────────────────────────────────────────────
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) salir(`El correo no parece válido: ${email}`);
    if (!Number.isInteger(dias) || dias < 1 || dias > 30) salir('La vigencia debe estar entre 1 y 30 días.');

    let rutFormateado = null;
    if (rutEmpresa) {
        const v = validateRut(rutEmpresa);
        if (!v.valid) salir(`El RUT de la empresa no es válido: ${rutEmpresa}`);
        rutFormateado = v.formatted;
    }

    console.log(`
  Ambiente:    ${stage}   (tabla ${process.env.LICENCIAS_TABLE})
  Perfil AWS:  ${process.env.AWS_PROFILE || '(credenciales del entorno)'}
  Correo:      ${email}
  Prellenado:  ${nombreEmpresa || '(sin nombre)'}   ${rutFormateado || '(sin RUT)'}
  Vigencia:    ${dias} días
  Destino:     ${FRONTEND_URL}/onboarding
`);

    if (!confirmar) {
        console.log('  Ensayo: los datos son válidos y no se escribió nada.');
        console.log('  Para emitir la licencia, repite el comando con --confirmar.\n');
        return;
    }

    const emitidaPor = process.env.AWS_PROFILE || process.env.USER || 'operador';
    const { token, licenciaId, expiraEn } = await LicenciaService.emitir({
        email,
        prellenado: { nombre: nombreEmpresa, rutEmpresa: rutFormateado },
        emitidaPor,
        diasVigencia: dias,
    });

    const enlace = `${FRONTEND_URL}/onboarding?token=${token}`;

    let enviado = false;
    try {
        const { sendOnboardingLicenseEmail } = require('../handlers/notifications/handler');
        const resultado = await sendOnboardingLicenseEmail(email, enlace, dias, nombreEmpresa);
        enviado = Boolean(resultado?.sent);
    } catch (err) {
        console.error(`  Aviso: el correo falló (${err.message})`);
    }

    console.log(`  Licencia emitida:  ${licenciaId}`);
    console.log(`  Vence:             ${expiraEn}`);

    if (enviado) {
        console.log(`  Enlace enviado a:  ${email}`);
        console.log('\n  Listo. El enlace sirve una sola vez y no se puede recuperar desde acá:');
        console.log('  la tabla guarda solo su hash. Si se pierde, revoca y emite otra.\n');
    } else {
        console.log(`\n  El correo NO se envió. Esta es la ÚNICA copia del enlace; entrégala por un`);
        console.log('  canal seguro y bórrala de tu terminal:\n');
        console.log(`    ${enlace}\n`);
    }
})().catch((err) => {
    console.error(`\n  Falló: ${err.message}\n`);
    process.exit(1);
});
