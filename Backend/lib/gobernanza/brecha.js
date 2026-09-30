/**
 * Informe de brecha: ante un incidente, qué datos personales, de qué personas y
 * de qué empresas quedaron expuestos. Funciones puras sobre el inventario
 * (`inventario.js`) y la auditoría de accesos a salud (`auditoriaSalud.js`); el
 * script `scripts/informe-brecha.js` carga los datos y arma el informe.
 *
 * Tres alcances, que se pueden combinar:
 *
 *   - CUENTA comprometida (personas y ventana de tiempo):
 *       · CONFIRMADO: los accesos a datos de salud que esa cuenta hizo en la
 *         ventana, según la auditoría;
 *       · POTENCIAL: todo lo que esa cuenta podía leer en su empresa. Las
 *         lecturas que no son de salud no se auditan, así que eso es una cota
 *         superior y el informe lo dice.
 *   - TABLA expuesta (un respaldo filtrado, un acceso indebido a la tabla):
 *     todo lo que la tabla tiene, por empresa y persona.
 *   - ARCHIVOS expuestos (un prefijo de S3): los archivos y los registros que
 *     los mencionan, para saber de quién son.
 *
 * El informe no trae datos personales más allá de identificadores: los
 * nombres los resuelve quien lo lee, con acceso, si hace falta.
 */

const { FUENTES, fuente, CLASE } = require('./inventario');

const categoria = (f) => ({ tabla: f.tabla, nombre: f.nombre, datos: f.datos, clase: f.clase, salud: f.contieneSalud });

/** Personas y empresas que aparecen en ítems de una fuente. */
function exposicionDeFuente(f, items, ctx = {}) {
    const personas = new Map();   // personaId → empresa
    const empresas = new Set();
    for (const it of items) {
        const empresa = it.tenantId || String(it.PK || '').replace(/^TENANT#/, '') || null;
        if (empresa) empresas.add(empresa);
        for (const p of f.personasDe(it, ctx[empresa] || {})) personas.set(p, empresa);
    }
    return { categoria: categoria(f), personas, empresas, registros: items.length };
}

/** Accesos a salud confirmados por la auditoría (ítems de AuditoriaAccesosTable). */
function exposicionPorAccesos(accesos) {
    const titulares = new Map();
    const empresas = new Set();
    const documentos = new Set();
    const tipos = new Set();
    let desde = null;
    let hasta = null;
    for (const a of accesos) {
        empresas.add(a.tenantId);
        for (const t of a.titulares || []) titulares.set(t, a.tenantId);
        for (const d of a.documentos || []) documentos.add(d);
        for (const t of a.tipos || []) tipos.add(t);
        if (!desde || a.en < desde) desde = a.en;
        if (!hasta || a.en > hasta) hasta = a.en;
    }
    return { accesos: accesos.length, titulares, empresas, documentos, tipos, primero: desde, ultimo: hasta };
}

/**
 * Arma el informe a partir de las piezas ya cargadas.
 *
 * @param {object} p
 * @param {object} p.alcance - lo que se declaró comprometido (se copia al informe).
 * @param {Array<{tabla: string, items: object[]}>} [p.tablas] - exposición por tabla (o, para
 *        una cuenta, lo que podía leer).
 * @param {object[]} [p.accesos] - auditoría de salud de la cuenta en la ventana.
 * @param {string[]} [p.archivos] - claves de S3 expuestas.
 * @param {Array<{tabla: string, items: object[]}>} [p.contexto] - tablas que NO se expusieron,
 *        cargadas solo para saber de quién es cada archivo expuesto.
 * @param {Object<string, object>} [p.ctxPorEmpresa] - contexto por empresa para vincular (p. ej. HMAC del RUT → persona).
 */
function informeDeBrecha({ alcance, tablas = [], contexto = [], accesos = null, archivos = [], ctxPorEmpresa = {}, potencial = false }) {
    const porFuente = tablas.map(({ tabla, items }) => {
        const f = fuente(tabla);
        if (!f) return { categoria: { tabla, nombre: tabla, datos: 'Tabla sin clasificar en el inventario', clase: 'desconocida', salud: false }, personas: new Map(), empresas: new Set(), registros: items.length };
        return exposicionDeFuente(f, items, ctxPorEmpresa);
    });

    // Archivos: de quién son, según los registros que los mencionan.
    const duenosDeArchivo = new Map();
    for (const { tabla, items } of [...tablas, ...contexto]) {
        const f = fuente(tabla);
        if (!f) continue;
        for (const it of items) for (const k of f.archivosDe(it)) {
            if (!archivos.includes(k)) continue;
            const empresa = it.tenantId || String(it.PK || '').replace(/^TENANT#/, '') || null;
            const previos = duenosDeArchivo.get(k) || { empresa, personas: new Set() };
            f.personasDe(it, ctxPorEmpresa[empresa] || {}).forEach((x) => previos.personas.add(x));
            duenosDeArchivo.set(k, previos);
        }
    }

    const personas = new Map();
    const empresas = new Set();
    for (const e of porFuente) {
        e.empresas.forEach((x) => empresas.add(x));
        for (const [p, emp] of e.personas) personas.set(p, emp);
    }
    for (const [, d] of duenosDeArchivo) {
        if (d.empresa) empresas.add(d.empresa);
        d.personas.forEach((p) => personas.set(p, d.empresa));
    }

    const confirmado = accesos ? exposicionPorAccesos(accesos) : null;
    if (confirmado) {
        confirmado.empresas.forEach((x) => empresas.add(x));
        for (const [p, emp] of confirmado.titulares) personas.set(p, emp);
    }

    const porEmpresa = {};
    for (const [p, emp] of personas) (porEmpresa[emp || 'sin-empresa'] ||= []).push(p);
    Object.values(porEmpresa).forEach((l) => l.sort());

    return {
        generadoEn: new Date().toISOString(),
        alcance,
        naturaleza: potencial
            ? 'POTENCIAL: lo que la cuenta podía leer. Solo los accesos a salud están auditados; el resto es una cota superior.'
            : 'EXPUESTO: lo que el alcance declarado contiene.',
        categorias: porFuente.filter((e) => e.registros > 0).map((e) => ({
            ...e.categoria, registros: e.registros, personas: e.personas.size, empresas: e.empresas.size,
        })),
        datosDeSalud: porFuente.some((e) => e.registros > 0 && e.categoria.salud) || Boolean(confirmado?.accesos),
        saludConfirmada: confirmado && {
            accesos: confirmado.accesos, tipos: [...confirmado.tipos].sort(), documentos: [...confirmado.documentos].sort(),
            titulares: confirmado.titulares.size, primero: confirmado.primero, ultimo: confirmado.ultimo,
        },
        archivos: [...duenosDeArchivo.entries()].map(([key, d]) => ({ key, empresa: d.empresa, personas: [...d.personas].sort() }))
            .concat(archivos.filter((k) => !duenosDeArchivo.has(k)).map((key) => ({ key, empresa: key.split('/')[1] || null, personas: [], sinRegistro: true }))),
        empresas: [...empresas].sort(),
        personasPorEmpresa: porEmpresa,
        totales: { empresas: empresas.size, personas: personas.size },
    };
}

/** Las fuentes con datos de personas que una cuenta de la empresa puede leer (cota superior). */
const fuentesLegibles = () => FUENTES.filter((f) => f.clase !== CLASE.OPERACIONAL).map((f) => f.tabla);

module.exports = { informeDeBrecha, exposicionPorAccesos, exposicionDeFuente, fuentesLegibles };
