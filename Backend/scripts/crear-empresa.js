#!/usr/bin/env node
/**
 * Alta de una empresa (tenant) y de su administrador.
 *
 * ── Por qué es un script y no un endpoint ────────────────────────────────────
 *
 * El alta era pública: `POST /tenants/setup` protegido por un código compartido
 * que, además, estaba vacío en los dos ambientes. Un código compartido es frágil
 * por diseño (se filtra, no se rota, no dice quién lo usó) y no había a quién
 * pedirle la autorización: todas las sesiones del sistema pertenecen a una
 * empresa, así que no existe un "administrador de la plataforma" que pueda
 * crear la primera.
 *
 * Acá la autorización es IAM: solo corre quien tiene credenciales de AWS sobre
 * las tablas, cada escritura queda en CloudTrail con nombre y hora, y no hay
 * secreto que custodiar ni superficie pública que atacar. Refleja además cómo
 * ocurre de verdad: las empresas las da de alta el dueño de la plataforma.
 *
 * ── Uso ──────────────────────────────────────────────────────────────────────
 *
 *   # 1. Ensayo: valida y muestra lo que haría, sin escribir nada.
 *   AWS_PROFILE=<perfil> node scripts/crear-empresa.js --stage prod --datos empresa.json
 *
 *   # 2. Alta real.
 *   AWS_PROFILE=<perfil> node scripts/crear-empresa.js --stage prod --datos empresa.json --confirmar
 *
 * El archivo de datos es un JSON:
 *
 *   {
 *     "nombre": "Constructora Ejemplo SpA",
 *     "rutEmpresa": "76.111.999-0",
 *     "admin": {
 *       "rut": "15.111.222-6",
 *       "nombre": "María",
 *       "apellidoPaterno": "Soto",
 *       "apellidoMaterno": "Rivas",
 *       "email": "maria.soto@ejemplo.cl"
 *     }
 *   }
 *
 * Roles, cargos, catálogos y preferencias quedan en sus valores por defecto: se
 * configuran después desde Mi Empresa, con sesión y permisos. El script hace lo
 * que solo él puede hacer —crear la empresa y su primer administrador— y nada más.
 */

const fs = require('fs');
const path = require('path');

// ─── Argumentos ──────────────────────────────────────────────────────────────

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
  Alta de una empresa y su administrador.

    AWS_PROFILE=<perfil> node scripts/crear-empresa.js --stage <dev|prod> --datos <archivo.json> [--confirmar]

  Sin --confirmar hace un ENSAYO: valida los datos, comprueba que el nombre, el
  RUT de la empresa y el RUT del administrador estén libres, y no escribe nada.
`);
    process.exit(args.includes('--help') || args.includes('-h') ? 0 : 1);
}

if (!['dev', 'prod'].includes(stage)) salir(`Stage inválido: "${stage}". Debe ser dev o prod.`);
if (!process.env.AWS_PROFILE && !process.env.AWS_ACCESS_KEY_ID) {
    salir('Falta AWS_PROFILE (o credenciales en el entorno): la autorización de este script es IAM.');
}

// ─── Entorno ─────────────────────────────────────────────────────────────────
//
// Las tablas se nombran igual que en serverless.yml (`${service}-<tabla>-<stage>`).
// Se definen ANTES de cargar los servicios, porque los leen al importarse.

const SERVICIO = 'BuildAndServe';
process.env.AWS_REGION = process.env.AWS_REGION || 'us-east-1';
process.env.TENANTS_TABLE = `${SERVICIO}-tenants-${stage}`;
process.env.PERSONAS_TABLE = `${SERVICIO}-personas-${stage}`;
process.env.DOCUMENTS_TABLE = `${SERVICIO}-documents-${stage}`;
process.env.SES_SENDER_EMAIL = process.env.SES_SENDER_EMAIL || 'thecodecookers@gmail.com';

const { TenantService } = require('../lib/services/TenantService');
const { PersonaService } = require('../lib/services/PersonaService');
const { validateRut } = require('../lib/utils/validation');

// ─── Datos ───────────────────────────────────────────────────────────────────

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

// ─── Alta ────────────────────────────────────────────────────────────────────

(async () => {
    const tenantService = new TenantService();
    const personaService = new PersonaService();

    const nombreAdmin = [datos.admin.nombre, datos.admin.apellidoPaterno, datos.admin.apellidoMaterno]
        .filter(Boolean).join(' ').trim();

    console.log(`
  Ambiente:       ${stage}   (tablas ${process.env.TENANTS_TABLE}, ${process.env.PERSONAS_TABLE})
  Perfil AWS:     ${process.env.AWS_PROFILE || '(credenciales del entorno)'}
  Empresa:        ${datos.nombre}   ${rutEmpresa.formatted}
  Administrador:  ${nombreAdmin}   ${rutAdmin.formatted}   ${datos.admin.email}
`);

    // Las mismas comprobaciones de unicidad que hacía el endpoint, antes de escribir.
    const slug = tenantService._generarSlug(datos.nombre);
    const conflictos = [];
    if (await tenantService.getBySlug(slug)) conflictos.push(`Ya existe una empresa con el nombre "${datos.nombre}"`);
    if (await tenantService.getByRutEmpresa(rutEmpresa.formatted)) conflictos.push(`Ya existe una empresa con el RUT ${rutEmpresa.formatted}`);
    if (await personaService.getByRutGlobal(rutAdmin.formatted)) conflictos.push(`El RUT ${rutAdmin.formatted} ya está registrado como persona en el sistema`);

    if (conflictos.length) {
        console.error('  No se puede crear:');
        conflictos.forEach((c) => console.error(`    - ${c}`));
        console.error('');
        process.exit(1);
    }

    if (!confirmar) {
        console.log('  Ensayo: los datos son válidos y no hay conflictos. No se escribió nada.');
        console.log('  Para crear la empresa, repite el comando con --confirmar.\n');
        return;
    }

    // 1. Empresa (queda en estado 'setup' hasta que exista su administrador).
    const tenant = await tenantService.setup({
        nombre: datos.nombre,
        rutEmpresa: rutEmpresa.formatted,
    });
    console.log(`  Empresa creada:       ${tenant.tenantId}`);

    // 2. Administrador.
    const { persona, passwordTemporal } = await personaService.crear(tenant.tenantId, {
        rut: rutAdmin.formatted,
        nombre: datos.admin.nombre,
        apellidoPaterno: datos.admin.apellidoPaterno || '',
        apellidoMaterno: datos.admin.apellidoMaterno || '',
        email: datos.admin.email,
        rol: 'admin',
        tieneAccesoWeb: true,
    });
    console.log(`  Administrador creado: ${persona.personaId}`);

    // 3. Vincular y activar: una empresa sin administrador vinculado queda inservible.
    await tenantService.updateConfig(tenant.tenantId, { adminPersonaId: persona.personaId });
    await tenantService.activar(tenant.tenantId);
    console.log('  Empresa activada');

    // 4. Credenciales: viajan por correo, no por la salida del script. Solo se
    //    imprimen si el envío falló, porque si no el administrador no puede entrar.
    let enviado = false;
    try {
        const { sendWelcomeEmail } = require('../handlers/notifications/handler');
        const resultado = await sendWelcomeEmail(persona.email, nombreAdmin, persona.rut, passwordTemporal);
        enviado = Boolean(resultado?.sent);
    } catch (err) {
        console.error(`  Aviso: el correo de bienvenida falló (${err.message})`);
    }

    if (enviado) {
        console.log(`  Correo de bienvenida enviado a ${persona.email}`);
        console.log('\n  Listo. La contraseña temporal viajó por correo y debe cambiarse en el primer ingreso.\n');
    } else {
        console.log(`\n  El correo NO se envió. Entrega estas credenciales por un canal seguro y bórralas de tu terminal:`);
        console.log(`    RUT:                 ${persona.rut}`);
        console.log(`    Contraseña temporal: ${passwordTemporal}`);
        console.log('  Se cambia obligatoriamente en el primer ingreso.\n');
    }
})().catch((err) => {
    console.error(`\n  Falló el alta: ${err.message}\n`);
    process.exit(1);
});
