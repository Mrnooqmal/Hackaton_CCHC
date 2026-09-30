#!/usr/bin/env node
/**
 * Prueba de punta a punta de un ambiente desplegado.
 *
 * Es la que verifica cada despliegue (docs/estado-actual.md, "Cómo desplegar"):
 * crea una empresa desechable con `crear-empresa.js`, recorre por la API lo que
 * hace una persona real desde el frontend del ambiente, y borra todo lo de la
 * empresa al terminar, **pase lo que pase**: falle una comprobación, falle el
 * alta o se interrumpa con Ctrl+C. Si el proceso muere sin poder borrar, la
 * empresa queda anotada y la próxima ejecución empieza por borrarla.
 *
 * ── Uso ──────────────────────────────────────────────────────────────────────
 *
 *   AWS_PROFILE=adrean_cchc node scripts/prueba-punta-a-punta.js --stage dev
 *   AWS_PROFILE=adrean_cchc node scripts/prueba-punta-a-punta.js --stage prod
 *
 *   # Borrar a mano una empresa desechable que haya quedado (solo desechables):
 *   AWS_PROFILE=adrean_cchc node scripts/prueba-punta-a-punta.js --stage dev --borrar <tenantId>
 *
 * Termina con código 0 solo si todas las comprobaciones pasaron **y** el borrado
 * quedó confirmado.
 *
 * ── Qué cubre ────────────────────────────────────────────────────────────────
 *
 *   1. Primer ingreso del administrador: la contraseña inicial solo sirve para
 *      cambiarse; al cambiarla se emite una sesión nueva y la anterior queda
 *      revocada; con la nueva se crea el PIN y se completa el enrolamiento
 *      **enseguida** (el caso que fallaba: ver D-26).
 *   2. Alta de una persona trabajadora por el administrador, y su propio primer
 *      ingreso por el mismo camino.
 *   3. Permisos: la trabajadora no da de alta personas.
 *   4. CORS: el origen del ambiente se acepta y otro no.
 *   5. Las respuestas de la API no se cachean.
 *   6. Cierre de sesión.
 *
 * Los correos de bienvenida van a `atorres@thecodecookers.cl`, verificado en
 * SES: llegan aunque la cuenta siga en sandbox.
 */

const args = process.argv.slice(2);
const valorDe = (flag) => {
    const i = args.indexOf(flag);
    return i !== -1 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : null;
};
const stage = valorDe('--stage');
const borrarSolo = valorDe('--borrar');

if (!['dev', 'prod'].includes(stage)) {
    console.error('\n  Uso: node scripts/prueba-punta-a-punta.js --stage <dev|prod> [--borrar <tenantId>]\n');
    process.exit(1);
}
if (!process.env.AWS_PROFILE && !process.env.AWS_ACCESS_KEY_ID) {
    console.error('\n  Falta AWS_PROFILE: la prueba crea y borra con credenciales de AWS.\n');
    process.exit(1);
}
process.env.AWS_REGION = process.env.AWS_REGION || 'us-east-1';

const desechable = require('./e2e/empresa-desechable');
const { ambiente, crearCliente } = require('./e2e/cliente');

// ─── Comprobaciones ──────────────────────────────────────────────────────────

const resultados = [];
let interrumpido = false;

/** Registra una comprobación. Si `detener`, corta la prueba (el borrado corre igual). */
function comprobar(nombre, ok, detalle = '', { detener = false } = {}) {
    if (interrumpido) throw new Error('Interrumpida');
    resultados.push({ nombre, ok: Boolean(ok) });
    console.log(`   ${ok ? 'ok   ' : 'FALLA'} ${nombre}${!ok && detalle ? `\n         ${detalle}` : ''}`);
    if (!ok && detener) throw new Error(`Se detiene la prueba: ${nombre}`);
}

const resumen = (r) => `HTTP ${r.status} ${JSON.stringify(r.cuerpo)?.slice(0, 300)}`;

// ─── Flujos ──────────────────────────────────────────────────────────────────

const PIN = '4827';

/**
 * Primer ingreso completo de una persona: contraseña inicial, cambio, PIN y
 * enrolamiento. Devuelve el token vigente.
 */
async function primerIngreso(c, { quien, rut, personaId }) {
    const inicial = desechable.passwordInicial(rut);

    const login = await c.pedir('POST', '/auth/login', { cuerpo: { rut, password: inicial } });
    comprobar(`${quien}: entra con la contraseña inicial`, login.status === 200 && login.cuerpo?.data?.token, resumen(login), { detener: true });
    comprobar(`${quien}: el ingreso pide cambiar la contraseña`, login.cuerpo.data.requiereCambioPassword === true, resumen(login));
    const tokenInicial = login.cuerpo.data.token;

    const antes = await c.pedir('GET', `/personas/${personaId}`, { token: tokenInicial });
    comprobar(`${quien}: con la contraseña inicial no se usa el sistema (403)`, antes.status === 403, resumen(antes));

    const nueva = `Prueba-${Math.random().toString(36).slice(2, 10)}`;
    const cambio = await c.pedir('POST', '/auth/change-password', {
        token: tokenInicial,
        cuerpo: { passwordNuevo: nueva, confirmarPassword: nueva },
    });
    comprobar(`${quien}: cambia la contraseña`, cambio.status === 200, resumen(cambio), { detener: true });
    const tokenNuevo = cambio.cuerpo?.data?.token;
    comprobar(`${quien}: el cambio emite una sesión nueva`, tokenNuevo && tokenNuevo !== tokenInicial, resumen(cambio));
    const token = tokenNuevo || tokenInicial;

    // Enseguida, sin esperar: dentro de los 60 s del caché del autorizador.
    const pin = await c.pedir('POST', `/personas/${personaId}/set-pin`, { token, cuerpo: { pin: PIN } });
    comprobar(`${quien}: crea su PIN inmediatamente después del cambio`, pin.status === 200, resumen(pin));

    const enrol = await c.pedir('POST', `/personas/${personaId}/enrolamiento`, { token, cuerpo: { pin: PIN } });
    comprobar(`${quien}: completa el enrolamiento`, enrol.status === 200 && enrol.cuerpo?.data?.habilitado === true, resumen(enrol));

    // `me` resuelve el token contra la tabla, sin pasar por el caché del
    // autorizador: es la forma de ver la revocación sin esperar un minuto.
    const viejo = await c.pedir('GET', '/auth/me', { token: tokenInicial });
    comprobar(`${quien}: la sesión de la contraseña inicial quedó revocada`, viejo.status === 401, resumen(viejo));

    const me = await c.pedir('GET', '/auth/me', { token });
    comprobar(`${quien}: la sesión nueva es válida y ya no es provisional`,
        me.status === 200 && me.cuerpo?.data?.user?.passwordTemporal === false && me.cuerpo?.data?.user?.habilitado === true, resumen(me));

    return token;
}

async function recorrer(c, empresa, personasCreadas) {
    console.log('\n  Administrador');
    const tokenAdmin = await primerIngreso(c, { quien: 'admin', rut: empresa.adminRut, personaId: empresa.adminPersonaId });

    console.log('\n  Persona trabajadora');
    const rut = desechable.rutAlAzar(10_000_000, 25_000_000);
    const alta = await c.pedir('POST', '/personas', {
        token: tokenAdmin,
        cuerpo: {
            rut,
            nombre: 'Trabajadora',
            apellidoPaterno: 'De',
            apellidoMaterno: 'Prueba',
            email: desechable.CORREO_PRUEBAS,
            rol: 'trabajador',
            tieneAccesoWeb: true,
        },
    });
    const personaId = alta.cuerpo?.data?.persona?.personaId;
    if (personaId) personasCreadas.push(personaId);
    comprobar('admin: da de alta a una persona trabajadora', alta.status === 201 && personaId, resumen(alta), { detener: true });

    const tokenTrabajadora = await primerIngreso(c, { quien: 'trabajadora', rut, personaId });

    // Que no pueda LISTAR el personal todavía no se comprueba: hoy puede, y
    // restringirlo es una decisión pendiente (H-16).
    const altaAjena = await c.pedir('POST', '/personas', {
        token: tokenTrabajadora,
        cuerpo: { rut: desechable.rutAlAzar(10_000_000, 25_000_000), nombre: 'No', rol: 'trabajador' },
    });
    if (altaAjena.cuerpo?.data?.persona?.personaId) personasCreadas.push(altaAjena.cuerpo.data.persona.personaId);
    comprobar('trabajadora: no da de alta personas (403)', altaAjena.status === 403, resumen(altaAjena));
    const listaAdmin = await c.pedir('GET', '/personas', { token: tokenAdmin });
    const personas = listaAdmin.cuerpo?.data?.personas || listaAdmin.cuerpo?.data || [];
    comprobar('admin: lista el personal de su empresa (2 personas)',
        listaAdmin.status === 200 && Array.isArray(personas) && personas.length === 2, resumen(listaAdmin));
    comprobar('las respuestas llevan Cache-Control: no-store',
        /no-store/.test(listaAdmin.cabeceras.get('cache-control') || ''), listaAdmin.cabeceras.get('cache-control'));

    console.log('\n  CORS');
    const preflight = await fetch(`${c.api}/personas`, {
        method: 'OPTIONS',
        headers: { Origin: c.origen, 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'authorization' },
    });
    comprobar(`acepta el origen del ambiente (${c.origen})`, preflight.headers.get('access-control-allow-origin') === c.origen,
        `access-control-allow-origin: ${preflight.headers.get('access-control-allow-origin')}`);
    const ajeno = await fetch(`${c.api}/personas`, {
        method: 'OPTIONS',
        headers: { Origin: 'https://sitio-ajeno.example', 'Access-Control-Request-Method': 'GET' },
    });
    comprobar('no acepta un origen ajeno', !ajeno.headers.get('access-control-allow-origin'),
        `access-control-allow-origin: ${ajeno.headers.get('access-control-allow-origin')}`);

    console.log('\n  Cierre de sesión');
    const salida = await c.pedir('POST', '/auth/logout', { token: tokenTrabajadora });
    comprobar('trabajadora: cierra sesión', salida.status === 200, resumen(salida));
    const despues = await c.pedir('GET', '/auth/me', { token: tokenTrabajadora });
    comprobar('la sesión cerrada ya no vale', despues.status === 401, resumen(despues));
}

// ─── Principal ───────────────────────────────────────────────────────────────

(async () => {
    if (borrarSolo) {
        await desechable.borrarEmpresa(stage, borrarSolo);
        return 0;
    }

    const amb = ambiente(stage);
    const c = crearCliente(amb);
    console.log(`\n  Prueba de punta a punta en ${stage}\n  API:    ${amb.api}\n  Origen: ${amb.origen}\n`);

    await desechable.borrarPendientes(stage);

    let empresa = null;
    let tenantId = null;
    const personasCreadas = [];
    let errorPrueba = null;
    let errorBorrado = null;

    // Ctrl+C o un kill: se deja de recorrer y se borra igual. El segundo Ctrl+C
    // sí corta, pero la empresa ya está anotada como pendiente.
    const alInterrumpir = (senal) => {
        if (interrumpido) process.exit(130);
        interrumpido = true;
        console.error(`\n  ${senal}: se interrumpe la prueba y se borra la empresa. Otro ${senal} corta sin borrar.`);
        errorPrueba = errorPrueba || new Error(`Interrumpida (${senal})`);
    };
    process.on('SIGINT', () => alInterrumpir('SIGINT'));
    process.on('SIGTERM', () => alInterrumpir('SIGTERM'));

    try {
        empresa = await desechable.crearEmpresa(stage);
        tenantId = empresa.tenantId;
        personasCreadas.push(empresa.adminPersonaId);
        console.log(`  Empresa desechable: ${empresa.nombre} (${tenantId})`);
        await recorrer(c, empresa, personasCreadas);
    } catch (err) {
        errorPrueba = err;
        tenantId = tenantId || err.tenantId || null;
    } finally {
        console.log('');
        if (tenantId) {
            try {
                await desechable.borrarEmpresa(stage, tenantId, personasCreadas);
            } catch (err) {
                errorBorrado = err;
            }
        }
    }

    const fallas = resultados.filter((r) => !r.ok);
    console.log(`\n  ${resultados.length - fallas.length} de ${resultados.length} comprobaciones pasaron.`);
    if (errorPrueba) console.error(`  La prueba se detuvo: ${errorPrueba.message}`);
    if (errorBorrado) console.error(`  EL BORRADO NO QUEDÓ CONFIRMADO: ${errorBorrado.message}`);
    const ok = !errorPrueba && !errorBorrado && fallas.length === 0 && resultados.length > 0;
    console.log(ok ? '  Resultado: OK\n' : '  Resultado: FALLA\n');
    return ok ? 0 : 1;
})().then((codigo) => process.exit(codigo), (err) => {
    console.error(`\n  Error: ${err.message}\n`);
    process.exit(1);
});
