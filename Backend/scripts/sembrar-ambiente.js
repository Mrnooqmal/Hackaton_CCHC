#!/usr/bin/env node
/**
 * Siembra un ambiente recién desplegado: una empresa, su administrador y el
 * catálogo de cargos con los kits del DS 44.
 *
 * ── Qué NO siembra, y por qué ────────────────────────────────────────────────
 *
 * No crea obras, ni personal de ejemplo, ni documentos de muestra. Un ambiente
 * sembrado con datos de demostración es un ambiente donde nadie distingue lo
 * real de lo inventado, y donde el primer informe de cumplimiento sale con
 * trabajadores que no existen. Esto deja el sistema **listo para producción**:
 * alguien entra, y lo primero que registra es cierto.
 *
 * ── Uso ──────────────────────────────────────────────────────────────────────
 *
 *   # Ensayo: valida y muestra lo que haría, sin escribir nada.
 *   AWS_PROFILE=<perfil> node scripts/sembrar-ambiente.js --stage prod --datos empresa.json
 *
 *   # Siembra real.
 *   AWS_PROFILE=<perfil> node scripts/sembrar-ambiente.js --stage prod --datos empresa.json --confirmar
 *
 * El archivo de datos es el mismo de `crear-empresa.js`: la empresa y su
 * administrador. De hecho esto es `crear-empresa.js` más el catálogo de cargos,
 * y se apoya en él para no tener dos altas que puedan divergir.
 *
 * Es **idempotente en lo que importa**: si la empresa ya existe, no la duplica;
 * si el catálogo ya está cargado, no lo pisa.
 */

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const valorDe = (flag) => {
    const i = args.indexOf(flag);
    return i !== -1 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : null;
};

const stage = valorDe('--stage');
const archivoDatos = valorDe('--datos');
const confirmar = args.includes('--confirmar');

const salir = (mensaje) => { console.error(`\n  ${mensaje}\n`); process.exit(1); };

if (args.includes('--help') || args.includes('-h') || !stage || !archivoDatos) {
    console.log(`
  Siembra un ambiente recién desplegado: empresa, administrador y catálogo de cargos.

    AWS_PROFILE=<perfil> node scripts/sembrar-ambiente.js --stage <dev|prod> --datos <archivo.json> [--confirmar]

  Sin --confirmar hace un ENSAYO: valida y no escribe nada.
`);
    process.exit(args.includes('--help') || args.includes('-h') ? 0 : 1);
}

if (!['dev', 'prod'].includes(stage)) salir(`Stage inválido: "${stage}". Debe ser dev o prod.`);
if (!process.env.AWS_PROFILE && !process.env.AWS_ACCESS_KEY_ID) {
    salir('Falta AWS_PROFILE (o credenciales en el entorno): la autorización de este script es IAM.');
}

// Las tablas se nombran igual que en serverless.yml. Se definen ANTES de cargar
// los servicios, porque los leen al importarse.
const SERVICIO = 'BuildAndServe';
process.env.AWS_REGION = process.env.AWS_REGION || 'us-east-1';
process.env.TENANTS_TABLE = `${SERVICIO}-tenants-${stage}`;
process.env.PERSONAS_TABLE = `${SERVICIO}-personas-${stage}`;
process.env.DOCUMENTS_TABLE = `${SERVICIO}-documents-${stage}`;
process.env.EVIDENCIA_BUCKET = `buildandserve-evidencia-${stage}`;
process.env.TRABAJO_BUCKET = `buildandserve-trabajo-${stage}`;
process.env.SES_SENDER_EMAIL = process.env.SES_SENDER_EMAIL || 'thecodecookers@gmail.com';

const { TenantService } = require('../lib/services/TenantService');
const { PersonaService } = require('../lib/services/PersonaService');
const { validateRut } = require('../lib/utils/validation');
const { buildDefaultCargoCatalog } = require('../lib/ds44');

const rutaDatos = path.resolve(process.cwd(), archivoDatos);
if (!fs.existsSync(rutaDatos)) salir(`No existe el archivo de datos: ${rutaDatos}`);

let datos;
try {
    datos = JSON.parse(fs.readFileSync(rutaDatos, 'utf8'));
} catch (err) {
    salir(`El archivo de datos no es un JSON válido: ${err.message}`);
}

const faltantes = ['nombre', 'rutEmpresa'].filter((c) => !datos[c]);
if (faltantes.length) salir(`Faltan campos de la empresa: ${faltantes.join(', ')}`);
if (!datos.admin) salir('Falta el bloque "admin": una empresa sin administrador no puede usarse.');
const faltantesAdmin = ['rut', 'nombre', 'email'].filter((c) => !datos.admin[c]);
if (faltantesAdmin.length) salir(`Faltan campos del administrador: ${faltantesAdmin.join(', ')}`);

const rutEmpresa = validateRut(datos.rutEmpresa);
if (!rutEmpresa.valid) salir(`El RUT de la empresa no es válido: ${datos.rutEmpresa}`);
const rutAdmin = validateRut(datos.admin.rut);
if (!rutAdmin.valid) salir(`El RUT del administrador no es válido: ${datos.admin.rut}`);

(async () => {
    const tenantService = new TenantService();
    const personaService = new PersonaService();

    const nombreAdmin = [datos.admin.nombre, datos.admin.apellidoPaterno, datos.admin.apellidoMaterno]
        .filter(Boolean).join(' ').trim();
    const cargos = buildDefaultCargoCatalog();
    const itemsKit = cargos.reduce((n, c) => n + (c.kit || []).length, 0);

    console.log(`
  Ambiente:       ${stage}
  Perfil AWS:     ${process.env.AWS_PROFILE || '(credenciales del entorno)'}
  Empresa:        ${datos.nombre}   ${rutEmpresa.formatted}
  Administrador:  ${nombreAdmin}   ${rutAdmin.formatted}   ${datos.admin.email}
  Catálogo:       ${cargos.length} cargos, ${itemsKit} ítems de kit DS 44
`);

    const slug = tenantService._generarSlug(datos.nombre);
    let tenant = await tenantService.getBySlug(slug);
    const adminExistente = await personaService.getByRutGlobal(rutAdmin.formatted);

    if (tenant) console.log('  La empresa ya existe: no se vuelve a crear.');
    if (adminExistente) console.log('  El RUT del administrador ya está registrado: no se vuelve a crear.');

    if (!confirmar) {
        console.log('\n  Ensayo: no se escribió nada. Repite con --confirmar para sembrar.\n');
        return;
    }

    // 1. Empresa.
    if (!tenant) {
        tenant = await tenantService.setup({ nombre: datos.nombre, rutEmpresa: rutEmpresa.formatted });
        console.log(`  Empresa creada:       ${tenant.tenantId}`);
    }

    // 2. Catálogo de cargos con los kits del DS 44. Es lo que hace que, al
    //    vincular a alguien, el sistema sepa qué documentos exigirle. Sin esto la
    //    empresa arranca sin onboarding y hay que armarlo a mano.
    const reglas = { ...(tenant.reglas || {}) };
    if (Array.isArray(reglas.cargos) && reglas.cargos.length) {
        console.log('  El catálogo de cargos ya estaba cargado: no se pisa.');
    } else {
        reglas.cargos = cargos;
        tenant = await tenantService.updateConfig(tenant.tenantId, { reglas });
        console.log(`  Catálogo sembrado:    ${cargos.length} cargos`);
    }

    // 3. Administrador.
    let persona = adminExistente;
    let passwordTemporal = null;
    if (!persona) {
        const alta = await personaService.crear(tenant.tenantId, {
            rut: rutAdmin.formatted,
            nombre: datos.admin.nombre,
            apellidoPaterno: datos.admin.apellidoPaterno || '',
            apellidoMaterno: datos.admin.apellidoMaterno || '',
            email: datos.admin.email,
            rol: 'admin',
            tieneAccesoWeb: true,
        });
        persona = alta.persona;
        passwordTemporal = alta.passwordTemporal;
        console.log(`  Administrador creado: ${persona.personaId}`);
    }

    await tenantService.updateConfig(tenant.tenantId, { adminPersonaId: persona.personaId });
    await tenantService.activar(tenant.tenantId);
    console.log('  Empresa activada');

    // 4. Credenciales por correo; en pantalla solo si el envío falla.
    let enviado = false;
    if (passwordTemporal) {
        try {
            const { sendWelcomeEmail } = require('../handlers/notifications/handler');
            const resultado = await sendWelcomeEmail(persona.email, nombreAdmin, persona.rut, passwordTemporal);
            enviado = Boolean(resultado?.sent);
        } catch (err) {
            console.error(`  Aviso: el correo de bienvenida falló (${err.message})`);
        }
    }

    console.log('\n  Ambiente sembrado.');
    if (passwordTemporal && enviado) {
        console.log(`  La contraseña temporal viajó a ${persona.email} y se cambia en el primer ingreso.\n`);
    } else if (passwordTemporal) {
        console.log('\n  El correo NO se envió. Entrega estas credenciales por un canal seguro y bórralas de tu terminal:');
        console.log(`    RUT:                 ${persona.rut}`);
        console.log(`    Contraseña temporal: ${passwordTemporal}`);
        console.log('  Se cambia obligatoriamente en el primer ingreso.\n');
    } else {
        console.log('  El administrador ya existía: conserva su contraseña.\n');
    }
})().catch((err) => {
    console.error(`\n  Falló la siembra: ${err.message}\n`);
    process.exit(1);
});
