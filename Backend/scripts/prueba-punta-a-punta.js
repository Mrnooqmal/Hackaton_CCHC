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
 *   3. Permisos: la trabajadora no da de alta personas, ve el listado del
 *      personal recortado (H-16) y no ve el historial de firmas de otra (H-17).
 *   4. CORS: el origen del ambiente se acepta y otro no; en prod, tampoco la URL
 *      de CloudFront (D-34).
 *   5. Las respuestas de la API no se cachean.
 *   6. Cierre de sesión.
 *   7. Firma sin conexión con vales, por la API: pedirlos para la obra del
 *      turno, sincronizar una asistencia firmada con vale, reintentar la misma
 *      firma, un vale de otra obra, y desvincular (la firma tardía entra en
 *      revisión; con PIN ya no firma).
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

const crypto = require('crypto');
const sobreFirma = require('../lib/sobreFirma');
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

// PIN de 4 dígitos (volvió de 6 el 9 de noviembre de 2026, D-35).
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

    // Un PIN que no es de 4 dígitos no se acepta (y volvió a 4: D-35).
    const largo = await c.pedir('POST', `/personas/${personaId}/set-pin`, { token, cuerpo: { pin: '482791' } });
    comprobar(`${quien}: un PIN de 6 dígitos no se acepta (400)`, largo.status === 400 && /4 dígitos/.test(largo.cuerpo?.error || ''), resumen(largo));

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

    // Sin personas.ver el listado llega recortado: nombre, cargo e identificador (H-16).
    const listaRecortada = await c.pedir('GET', '/personas', { token: tokenTrabajadora });
    const recortadas = listaRecortada.cuerpo?.data?.personas || [];
    comprobar('trabajadora: el listado del personal llega sin RUT ni correo',
        listaRecortada.status === 200 && recortadas.length === 2 && recortadas.every((p) => !('rut' in p) && !('email' in p)),
        resumen(listaRecortada));
    // El historial de firmas de otra persona es parte de su ficha (H-17).
    const historialAjeno = await c.pedir('GET', `/signature-requests/history/${empresa.adminPersonaId}`, { token: tokenTrabajadora });
    comprobar('trabajadora: no ve el historial de firmas de otra persona (404)', historialAjeno.status === 404, resumen(historialAjeno));
    // Minimización (fila 7.5): la ficha ajena, la búsqueda por RUT, los
    // destinatarios de la bandeja y los incidentes, sin datos de otros.
    const fichaAjena = await c.pedir('GET', `/personas/${empresa.adminPersonaId}`, { token: tokenTrabajadora });
    comprobar('trabajadora: la ficha de otra persona llega como en el listado (sin RUT ni correo)',
        fichaAjena.status === 200 && !('rut' in (fichaAjena.cuerpo?.data || {})) && !('email' in (fichaAjena.cuerpo?.data || {})), resumen(fichaAjena));
    const validar = await c.pedir('GET', '/personas/validate?rut=11.111.111-1', { token: tokenTrabajadora });
    comprobar('trabajadora: no consulta si un RUT está registrado (403)', validar.status === 403, resumen(validar));
    const destinatarios = await c.pedir('GET', '/inbox/recipients', { token: tokenTrabajadora });
    comprobar('trabajadora: los destinatarios de la bandeja llegan sin correo ni RUT',
        destinatarios.status === 200 && (destinatarios.cuerpo?.data?.recipients || []).every((r) => !('email' in r) && !('rut' in r)), resumen(destinatarios));
    const incidentesAjenos = await c.pedir('GET', '/incidents', { token: tokenTrabajadora });
    comprobar('trabajadora: sin historial de incidentes, solo ve lo que reportó (nada)',
        incidentesAjenos.status === 200 && (incidentesAjenos.cuerpo?.data || []).length === 0, resumen(incidentesAjenos));
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
    if (stage === 'prod') {
        // D-34: la URL de CloudFront de producción ya no es un origen de la app.
        const viejo = await fetch(`${c.api}/personas`, {
            method: 'OPTIONS',
            headers: { Origin: 'https://d30jksx91fodea.cloudfront.net', 'Access-Control-Request-Method': 'GET' },
        });
        comprobar('no acepta la URL de CloudFront de producción', !viejo.headers.get('access-control-allow-origin'),
            `access-control-allow-origin: ${viejo.headers.get('access-control-allow-origin')}`);
    }

    console.log('\n  Cierre de sesión');
    const salida = await c.pedir('POST', '/auth/logout', { token: tokenTrabajadora });
    comprobar('trabajadora: cierra sesión', salida.status === 200, resumen(salida));
    const despues = await c.pedir('GET', '/auth/me', { token: tokenTrabajadora });
    comprobar('la sesión cerrada ya no vale', despues.status === 401, resumen(despues));

    await firmaSinConexion(c, empresa, tokenAdmin, personaId);
}

/**
 * Firma sin conexión con vales, por la API (sin pantallas). El administrador
 * hace de supervisor: habilita a la trabajadora en su equipo con el PIN de ella y
 * después sincroniza lo que se firmó sin red. Va al final porque desvincula a la
 * trabajadora.
 */
async function firmaSinConexion(c, empresa, token, trabajadora) {
    console.log('\n  Firma sin conexión (vales)');
    const crearObra = async (nombre) => {
        const r = await c.pedir('POST', '/obras', { token, cuerpo: { nombre } });
        comprobar(`admin: crea la obra "${nombre}"`, r.status === 201, resumen(r), { detener: true });
        return r.cuerpo.data.obra.obraId;
    };
    const obraA = await crearObra('Obra A E2E');
    const obraB = await crearObra('Obra B E2E');
    const asignar = await c.pedir('POST', `/personas/${trabajadora}/asignaciones`, { token, cuerpo: { obraId: obraA, cargos: [] } });
    comprobar('admin: asigna a la trabajadora a la obra A', asignar.status === 200, resumen(asignar), { detener: true });

    const crearActividad = async (obraId, titulo) => {
        const r = await c.pedir('POST', '/activities', { token, cuerpo: {
            tipo: 'OTRO', titulo, obraId, relatorId: empresa.adminPersonaId, asistentesRequeridos: [trabajadora],
        } });
        comprobar(`admin: crea la actividad "${titulo}"`, r.status === 201, resumen(r), { detener: true });
        const datos = r.cuerpo.data;
        return (Array.isArray(datos) ? datos[0] : (datos.actividades?.[0] || datos.activity || datos)).activityId;
    };
    const a1 = await crearActividad(obraA, 'Charla A1');
    const a2 = await crearActividad(obraA, 'Charla A2');
    const a3 = await crearActividad(obraA, 'Charla A3');
    const b1 = await crearActividad(obraB, 'Charla B1');

    // Habilitar: el supervisor pide los vales de la trabajadora para la obra del turno.
    const sinAsignar = await c.pedir('POST', '/firmas/vales', { token, cuerpo: { personaId: trabajadora, obraId: obraB, pin: PIN } });
    comprobar('vales para una obra a la que no está asignada: 404', sinAsignar.status === 404, resumen(sinAsignar));
    const emision = await c.pedir('POST', '/firmas/vales', { token, cuerpo: { personaId: trabajadora, obraId: obraA, pin: PIN, deviceId: 'e2e' } });
    const vales = emision.cuerpo?.data?.vales || [];
    comprobar('admin: habilita a la trabajadora en la obra A (5 vales)', emision.status === 200 && vales.length === 5 && emision.cuerpo.data.obraId === obraA, resumen(emision), { detener: true });

    const asistir = (actividad, cuerpo) => c.pedir('POST', `/activities/${actividad}/attendance`, {
        token, cuerpo: { personaId: trabajadora, deviceId: 'e2e', timestampLocal: new Date().toISOString(), ...cuerpo },
    });

    const primera = await asistir(a1, { vale: vales[0], idFirmaLocal: 'e2e-1' });
    comprobar('sincroniza una asistencia firmada con vale', primera.status === 200 && primera.cuerpo.data.totalAsistentes === 1, resumen(primera));
    const reintento = await asistir(a1, { vale: vales[0], idFirmaLocal: 'e2e-1' });
    comprobar('el reintento de la misma firma no la duplica', reintento.status === 200 && reintento.cuerpo.data.totalAsistentes === 1, resumen(reintento));

    const otraObra = await asistir(b1, { vale: vales[1], idFirmaLocal: 'e2e-2' });
    comprobar('un vale de la obra A no firma en la obra B (400, "otra obra")',
        otraObra.status === 400 && /otra obra/.test(otraObra.cuerpo?.error || ''), resumen(otraObra));

    // Un PIN equivocado no es una sesión vencida: responde 400, nunca 401, porque el
    // cliente lee todo 401 como sesión caída y cerraba la sesión de quien firmaba.
    const pinMalo = await c.pedir('POST', '/firmas/vales', { token, cuerpo: { personaId: trabajadora, obraId: obraA, pin: '0000' } });
    comprobar('un PIN equivocado al pedir vales responde 400, no 401', pinMalo.status === 400, resumen(pinMalo));
    const sesionViva = await c.pedir('GET', '/auth/me', { token });
    comprobar('...y la sesión sigue viva', sesionViva.status === 200, resumen(sesionViva));

    // El sobre (D-37): sin vales, el PIN va cifrado con la llave pública de KMS.
    const llave = sesionViva.cuerpo?.data?.user?.llaveSobreFirma;
    comprobar('la sesión entrega la llave pública de los sobres', typeof llave === 'string' && llave.length > 100, 'sin llave', { detener: true });
    const a4 = await crearActividad(obraA, 'Charla A4');
    const sobreDe = (pin, idFirmaLocal, timestampLocal) => {
        const h = sobreFirma.hashDeFirma({ personaId: trabajadora, tenantId: empresa.tenantId, obraId: obraA, referenciaTipo: 'activity', referenciaId: a4, idFirmaLocal, timestampLocal });
        return crypto.publicEncrypt({ key: crypto.createPublicKey({ key: Buffer.from(llave, 'base64'), format: 'der', type: 'spki' }), padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
            Buffer.from(JSON.stringify({ p: pin, h }))).toString('base64');
    };
    const hora = new Date().toISOString();
    const conSobre = (pin, id, cuerpoExtra = {}) => c.pedir('POST', `/activities/${a4}/attendance`, { token, cuerpo: {
        personaId: trabajadora, deviceId: 'e2e', timestampLocal: hora, idFirmaLocal: id, idSincronizacion: 'sinc_e2e_0001', sobre: sobreDe(pin, id, hora), ...cuerpoExtra,
    } });
    const sobreMalo = await conSobre('0000', 'e2e-sobre-malo');
    comprobar('un sobre con el PIN equivocado se rechaza (400)', sobreMalo.status === 400 && /PIN/.test(sobreMalo.cuerpo?.error || ''), resumen(sobreMalo));
    const sobreAjeno = await conSobre(PIN, 'e2e-sobre-otro', { idFirmaLocal: 'e2e-otra-firma' });
    comprobar('un sobre no sirve para otra firma (400)', sobreAjeno.status === 400, resumen(sobreAjeno));
    const sobreBueno = await conSobre(PIN, 'e2e-sobre-bueno');
    comprobar('un sobre con el PIN correcto se abre en KMS y firma', sobreBueno.status === 200 && sobreBueno.cuerpo.data.totalAsistentes === 1, resumen(sobreBueno));

    // Cinco vales inexistentes a su nombre (lo que produce un PIN equivocado al
    // descifrar en el equipo): al quinto se anulan sus vales vigentes.
    const basura = () => crypto.randomBytes(32).toString('hex');
    let ultimo;
    for (let i = 0; i < 5; i += 1) ultimo = await asistir(a3, { vale: basura(), idFirmaLocal: `e2e-basura-${i}` });
    comprobar('cinco vales inválidos: el quinto anula los vales de la persona',
        ultimo.status === 400 && /se anularon las firmas sin conexión/.test(ultimo.cuerpo?.error || ''), resumen(ultimo));
    const anulado = await asistir(a2, { vale: vales[2], idFirmaLocal: 'e2e-anulado' });
    comprobar('...y un vale que era bueno ya no firma', anulado.status === 400 && /intentos con vales inválidos/.test(anulado.cuerpo?.error || ''), resumen(anulado));
    const otraVez = await c.pedir('POST', '/firmas/vales', { token, cuerpo: { personaId: trabajadora, obraId: obraA, pin: PIN, deviceId: 'e2e' } });
    const vales2 = otraVez.cuerpo?.data?.vales || [];
    comprobar('admin: la vuelve a habilitar con su PIN', otraVez.status === 200 && vales2.length === 5, resumen(otraVez), { detener: true });

    const baja = await c.pedir('DELETE', `/personas/${trabajadora}`, { token });
    comprobar('admin: desvincula a la trabajadora', baja.status === 200, resumen(baja), { detener: true });

    const tardia = await asistir(a2, { vale: vales2[0], idFirmaLocal: 'e2e-3' });
    comprobar('una firma con vale sincronizada después de desvincular entra', tardia.status === 200 && tardia.cuerpo.data.totalAsistentes === 1, resumen(tardia));
    const firmas = await c.pedir('GET', `/signatures/worker/${trabajadora}`, { token });
    const lista = firmas.cuerpo?.data?.firmas || firmas.cuerpo?.data?.signatures || firmas.cuerpo?.data || [];
    const deA2 = (Array.isArray(lista) ? lista : []).find((f) => f.referenciaId === a2);
    const deA1 = (Array.isArray(lista) ? lista : []).find((f) => f.referenciaId === a1);
    comprobar('...y queda en revisión; la anterior a la desvinculación no',
        deA2?.requiereRevision === true && deA1 && deA1.requiereRevision === false, resumen(firmas));

    const conPin = await asistir(a3, { pin: PIN });
    comprobar('una persona desvinculada ya no firma con PIN (400)', conPin.status === 400 && /desvinculada/.test(conPin.cuerpo?.error || ''), resumen(conPin));
    const mas = await c.pedir('POST', '/firmas/vales', { token, cuerpo: { personaId: trabajadora, obraId: obraA, pin: PIN } });
    comprobar('una persona desvinculada no recibe vales', mas.status === 400 || mas.status === 404, resumen(mas));

    // La pantalla "Firmas en revisión": la lista y la confirmación.
    const enRevision = await c.pedir('GET', '/signatures/revision', { token });
    const pendientes = enRevision.cuerpo?.data?.firmas || [];
    const aRevisar = pendientes.find((f) => f.referenciaId === a2);
    comprobar('firmas en revisión: lista la firma tardía, con su motivo y sus fechas',
        enRevision.status === 200 && Boolean(aRevisar?.motivoRevision) && Boolean(aRevisar?.offline?.valeAnuladoEn)
            && !pendientes.some((f) => f.referenciaId === a1), resumen(enRevision));
    if (aRevisar) {
        const confirmar = await c.pedir('PUT', `/signatures/${aRevisar.signatureId}/revision`, { token, cuerpo: { decision: 'confirmada' } });
        comprobar('admin: confirma la firma en revisión', confirmar.status === 200, resumen(confirmar));
        const despues = await c.pedir('GET', '/signatures/revision', { token });
        comprobar('...y sale de la lista', despues.status === 200
            && !(despues.cuerpo?.data?.firmas || []).some((f) => f.signatureId === aRevisar.signatureId), resumen(despues));
    }
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
