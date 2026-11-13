#!/usr/bin/env node
/**
 * Simulacro de incidente: cuenta comprometida, de punta a punta.
 *
 * El plan de respuesta a incidentes lo prescribe (§1.4: "una vez por trimestre,
 * un simulacro en dev con una empresa desechable: cuenta comprometida de punta a
 * punta"). Esto lo ejecuta y, sobre todo, **comprueba si los registros permiten
 * reconstruir lo ocurrido**, que es la única forma de saber si la auditoría sirve
 * antes de necesitarla de verdad.
 *
 * ── Qué hace, en orden ───────────────────────────────────────────────────────
 *
 *   1. Reconocimiento: intentos de ingreso fallidos contra una cuenta real.
 *   2. Acceso: la cuenta cede y se entra con ella.
 *   3. Exfiltración: se lee el directorio del personal, fichas individuales y el
 *      repositorio de documentos.
 *   4. Escalamiento: se otorga el rol de administrador a otra persona.
 *   5. Reconstrucción: se consulta la auditoría por actor y ventana, se verifica
 *      el sello de cada registro y se contrasta **lo que se hizo** contra **lo
 *      que quedó anotado**.
 *
 * El paso 5 es el entregable. Los pasos 1 a 4 existen para alimentarlo.
 *
 * ── Qué NO hace ──────────────────────────────────────────────────────────────
 *
 * No explota ninguna falla: entra con una contraseña que el operador le da. No
 * es una herramienta de ataque, es un generador de rastro conocido para después
 * compararlo con la auditoría. Tampoco borra nada.
 *
 * El escalamiento de rol se revierte al terminar, y si el proceso muere el
 * informe final dice qué quedó cambiado.
 *
 * ── Uso ──────────────────────────────────────────────────────────────────────
 *
 *   # Ensayo: dice lo que haría, sin tocar nada.
 *   AWS_PROFILE=<perfil> node scripts/simulacro-incidente.js --stage dev \
 *       --rut 21.574.956-8 --password Demo.2026
 *
 *   # Simulacro real.
 *   AWS_PROFILE=<perfil> node scripts/simulacro-incidente.js --stage dev \
 *       --rut 21.574.956-8 --password Demo.2026 --confirmar
 *
 *   # Solo reconstruir lo de una ventana anterior, sin generar nada.
 *   AWS_PROFILE=<perfil> node scripts/simulacro-incidente.js --stage dev \
 *       --rut ... --password ... --solo-reconstruir --desde <ISO>
 *
 * Solo corre en dev: genera ingresos fallidos y cambia un rol. En producción eso
 * contamina la auditoría real y dispara alertas de verdad.
 */

const { ambiente, crearCliente } = require('./e2e/cliente');

// ─── Argumentos ──────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const valorDe = (f) => {
    const i = args.indexOf(f);
    return i !== -1 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : null;
};
const tiene = (f) => args.includes(f);

const stage = valorDe('--stage');
const rut = valorDe('--rut');
const password = valorDe('--password');
const confirmar = tiene('--confirmar');
const soloReconstruir = tiene('--solo-reconstruir');
const desdePedido = valorDe('--desde');
const INTENTOS_FALLIDOS = Number(valorDe('--intentos') || 6);

function exigirDev(stage) {
    if (stage === 'dev') return;
    console.error('');
    console.error('  Este simulacro solo corre en dev.');
    console.error(`  --stage recibió ${stage ? `"${stage}"` : 'nada'}.`);
    console.error('');
    console.error('  Genera ingresos fallidos y cambia un rol: en producción contamina la');
    console.error('  auditoría real, dispara alertas verdaderas y deja ruido en la bandeja de');
    console.error('  quien responde por la seguridad.');
    console.error('');
    process.exit(2);
}

const log = (...a) => console.log('  ', ...a);
const paso = (t) => console.log(`\n  ${t}`);
const regla = () => console.log(`  ${'─'.repeat(74)}`);

/**
 * Lo que el simulacro hizo, para contrastarlo después con la auditoría.
 *
 * `espera` dice qué operación del catálogo debería haber quedado. `null` quiere
 * decir que hoy no se audita, y entonces la fila es el hallazgo, no un error.
 */
const hechos = [];
const anotarHecho = (accion, espera, detalle = '') => hechos.push({ accion, espera, detalle });

// ─── Fases del incidente ─────────────────────────────────────────────────────

async function reconocimiento(c) {
    paso(`1. Reconocimiento: ${INTENTOS_FALLIDOS} intentos de ingreso con contraseña equivocada`);
    for (let i = 1; i <= INTENTOS_FALLIDOS; i++) {
        const r = await c.pedir('POST', '/auth/login', {
            cuerpo: { rut, password: `incorrecta-${i}` },
        });
        if (i === 1 || i === INTENTOS_FALLIDOS) log(`intento ${i}: HTTP ${r.status}`);
    }
    anotarHecho(`${INTENTOS_FALLIDOS} ingresos fallidos`, 'auth.ingreso_fallido',
        'el quinto debería además disparar la alerta de fuerza bruta');
    anotarHecho('alerta de fuerza bruta', 'alerta.fuerza_bruta_cuenta',
        '5 fallos en 15 minutos contra la misma cuenta');
}

async function acceso(c) {
    paso('2. Acceso: la cuenta cede');
    const r = await c.pedir('POST', '/auth/login', { cuerpo: { rut, password } });
    if (r.status !== 200 || !r.cuerpo?.data?.token) {
        throw new Error(`No se pudo entrar con la cuenta indicada (HTTP ${r.status}). `
            + 'Revisa --rut y --password.');
    }
    const { token } = r.cuerpo.data;
    const yo = r.cuerpo.data.user;
    log(`dentro como ${yo.nombre} ${yo.apellido || ''} (${yo.rol})`);
    anotarHecho('ingreso con éxito', 'auth.ingreso', `actor ${yo.personaId}`);
    return { token, yo };
}

async function exfiltracion(c, token) {
    paso('3. Exfiltración: se lee todo lo que la cuenta alcanza');

    const personas = await c.pedir('GET', '/personas', { token });
    const lista = personas.cuerpo?.data?.personas || personas.cuerpo?.data || [];
    log(`directorio del personal: ${Array.isArray(lista) ? lista.length : 0} personas`);
    anotarHecho(`listar el directorio (${Array.isArray(lista) ? lista.length : 0} personas)`, null,
        'GET /personas no deja registro: no existe una operación de lectura en el catálogo');

    const aLeer = (Array.isArray(lista) ? lista : []).slice(0, 3);
    for (const p of aLeer) {
        await c.pedir('GET', `/personas/${p.personaId}`, { token });
    }
    log(`fichas individuales leídas: ${aLeer.length}`);
    anotarHecho(`leer ${aLeer.length} fichas individuales`, null,
        'solo se audita si la persona tiene datos de salud reales');

    const docs = await c.pedir('GET', '/documents', { token });
    const cuantos = (docs.cuerpo?.data?.documents || []).length;
    log(`repositorio: ${cuantos} documentos`);
    anotarHecho(`listar el repositorio (${cuantos} documentos)`, null,
        'GET /documents no deja registro');

    return { lista: Array.isArray(lista) ? lista : [] };
}

async function escalamiento(c, token, lista, yo) {
    paso('4. Escalamiento: se otorga el rol de administrador');
    const victima = lista.find((p) => p.rol === 'trabajador' && p.personaId !== yo.personaId);
    if (!victima) {
        log('no hay una persona trabajadora a la que cambiarle el rol: se omite');
        return null;
    }
    const r = await c.pedir('PUT', `/personas/${victima.personaId}`, {
        token, cuerpo: { rol: 'admin' },
    });
    log(`${victima.nombre} ${victima.apellido || ''}: trabajador -> admin (HTTP ${r.status})`);
    if (r.status !== 200) {
        log('el cambio no se aplicó; la fila del informe lo dirá');
        return null;
    }
    anotarHecho('otorgar el rol de administrador', 'admin.cambio_rol',
        `sobre ${victima.personaId}`);
    anotarHecho('alerta de escalamiento de privilegios', 'alerta.escalamiento_privilegios',
        'otorgar admin alerta siempre, sin umbral');
    return victima;
}

async function revertir(c, token, victima) {
    if (!victima) return true;
    paso('Reversión del escalamiento');
    const r = await c.pedir('PUT', `/personas/${victima.personaId}`, {
        token, cuerpo: { rol: 'trabajador' },
    });
    const ok = r.status === 200;
    log(ok
        ? `${victima.personaId} vuelve a trabajador`
        : `NO se pudo revertir ${victima.personaId} (HTTP ${r.status}): queda como admin`);
    return ok;
}

// ─── Reconstrucción ──────────────────────────────────────────────────────────

/**
 * Lo que la actividad pide comprobar: con los registros en la mano, ¿se puede
 * decir qué pasó?
 *
 * Se consulta por el canal del producto (`GET /gobernanza/auditoria`), no
 * leyendo la tabla: así se comprueba también que el permiso y el registro de la
 * propia consulta funcionan.
 */
async function reconstruir(c, token, desde) {
    paso('5. Reconstrucción desde la auditoría');
    const r = await c.pedir('GET', `/gobernanza/auditoria?desde=${encodeURIComponent(desde)}`, { token });
    if (r.status !== 200) {
        log(`no se pudo consultar la auditoría (HTTP ${r.status}): ${JSON.stringify(r.cuerpo).slice(0, 200)}`);
        return null;
    }
    const eventos = r.cuerpo?.data?.eventos || [];
    const lista = Array.isArray(eventos) ? eventos : [];
    const integridad = r.cuerpo?.data?.integridad || {};
    log(`registros en la ventana: ${lista.length}`);
    // El servidor verifica el sello HMAC de cada registro al entregarlo. Un
    // "alterado" aquí significa que alguien editó la tabla sin la llave.
    log(`sellos: ${Object.entries(integridad).map(([k, v]) => `${v} ${k}`).join(', ') || 'sin datos'}`);

    if (lista.length) {
        regla();
        console.log('   fecha                     operación                        resultado  sello');
        regla();
        for (const e of lista) {
            const fecha = String(e.en || e.fecha || '').slice(0, 24).padEnd(25);
            const op = String(e.operacion || (e.tipos ? `salud.${e.tipos.join('/')}` : '(sin operación)')).padEnd(32);
            const res = String(e.resultado || '-').padEnd(10);
            // Lo calcula el servidor al entregar cada registro: 'integro',
            // 'alterado' o 'sin_sello'.
            const sello = { integro: 'válido', alterado: 'ALTERADO', sin_sello: 'sin sello' }[e.integridad] || '-';
            console.log(`   ${fecha} ${op} ${res} ${sello}`);
        }
        regla();
    }
    return lista;
}

/** La tabla que responde el punto 6: lo que se hizo contra lo que quedó. */
function contrastar(lista) {
    paso('Contraste: lo que se hizo contra lo que quedó registrado');
    const presentes = new Set(lista.map((e) => e.operacion).filter(Boolean));
    regla();
    console.log('   acción del incidente                            ¿reconstruible?');
    regla();
    let reconstruibles = 0;
    let ciegas = 0;
    for (const h of hechos) {
        let estado;
        if (h.espera === null) {
            estado = 'NO — no se audita';
            ciegas += 1;
        } else if (presentes.has(h.espera)) {
            estado = `sí — ${h.espera}`;
            reconstruibles += 1;
        } else {
            estado = `FALTA — se esperaba ${h.espera}`;
        }
        console.log(`   ${h.accion.slice(0, 46).padEnd(48)}${estado}`);
        if (h.detalle) console.log(`     ${h.detalle}`);
    }
    regla();
    log(`${reconstruibles} acciones reconstruibles, ${ciegas} sin rastro de ${hechos.length}`);
    return { reconstruibles, ciegas, total: hechos.length };
}

// ─── Entrada ─────────────────────────────────────────────────────────────────

async function main() {
    console.log('\n  Simulacro de incidente: cuenta comprometida\n');
    exigirDev(stage);
    if (!rut || !password) {
        console.error('  Faltan --rut y --password de la cuenta que se va a "comprometer".\n');
        process.exit(2);
    }

    const { api, origen } = ambiente(stage);
    const c = crearCliente({ api, origen });
    log(`API:    ${api}`);
    log(`Cuenta: ${rut}`);

    if (!confirmar && !soloReconstruir) {
        paso('Ensayo: esto es lo que haría');
        log(`${INTENTOS_FALLIDOS} ingresos fallidos contra ${rut}`);
        log('un ingreso con éxito');
        log('lectura del directorio, de tres fichas y del repositorio');
        log('otorgar el rol de administrador a una persona trabajadora, y revertirlo');
        log('consultar la auditoría de la ventana y contrastar');
        log('');
        log('No se escribió nada. Para correrlo de verdad, agrega --confirmar.');
        console.log('');
        return;
    }

    const desde = desdePedido || new Date(Date.now() - 60_000).toISOString();

    if (soloReconstruir) {
        const { token } = await acceso(c);
        const lista = await reconstruir(c, token, desde);
        if (lista) contrastar(lista);
        console.log('');
        return;
    }

    await reconocimiento(c);
    const { token, yo } = await acceso(c);
    const { lista } = await exfiltracion(c, token);
    let victima = null;
    let revertido = true;
    try {
        victima = await escalamiento(c, token, lista, yo);
    } finally {
        if (victima) revertido = await revertir(c, token, victima);
    }

    // Las escrituras de la auditoría no son sincrónicas con la respuesta: se
    // consulta después de un momento para no leer antes de que lleguen.
    await new Promise((r) => setTimeout(r, 4000));

    const eventos = await reconstruir(c, token, desde);
    const resumen = eventos ? contrastar(eventos) : null;

    paso('Cierre del simulacro');
    log(`Ventana: desde ${desde}`);
    if (!revertido) log('ATENCIÓN: el escalamiento de rol quedó sin revertir.');
    if (resumen) {
        log(`Reconstruible: ${resumen.reconstruibles} de ${resumen.total} acciones.`);
        if (resumen.ciegas) {
            log(`Sin rastro: ${resumen.ciegas}. Son lecturas de datos personales que hoy no`);
            log('se auditan; el informe de brecha las trata como cota superior.');
        }
    }
    console.log('');
}

if (require.main === module) {
    main().catch((err) => {
        console.error(`\n  Error: ${err.message}\n`);
        process.exit(1);
    });
}

module.exports = { exigirDev };
