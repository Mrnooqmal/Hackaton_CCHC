// Verificación de los recorridos guiados (D-33). Corre en `npm run build`,
// antes de `tsc -b`: si falla, el frontend no se construye ni se publica.
//
// Comprueba lo que los tipos no alcanzan a ver:
//   1. Cada pantalla con ruta del registro sigue declarada en App.tsx.
//   2. Cada página del manual que nombran el registro y los recorridos existe.
//   3. Cada ancla registrada la marca algún componente con `ancla('...')`, cada
//      `ancla('...')` está registrada, y nadie escribe `data-tour` a mano.
//   4. Las definiciones pasan `validarRecorridos`.
//   5. Si cambió el contenido de un recorrido, subió su versión, y
//      `src/ayuda/huellas.json` está al día.
//   6. Manual: cada enlace "Ver recorrido" (`recorrido:<id>`) nombra un
//      recorrido que existe.
//   7. En prod, una página marcada `revision: pendiente-normativa` (la sección
//      FUF y DS 44 espera revisión) no se publica (vite-manual-pendiente.ts),
//      así que cuenta como inexistente: ni el registro ni un recorrido pueden
//      llevar a ella. El ambiente es VITE_AMBIENTE, como con los borradores:
//      sin la variable, prod.
//
//   node scripts/verificar-recorridos.mjs                       verifica
//   node scripts/verificar-recorridos.mjs --actualizar-huellas  verifica y reescribe huellas.json
//
// Node 24 ejecuta los .ts de src/ayuda directamente (solo usan sintaxis que se
// puede borrar), así que esto no compila nada ni agrega dependencias.

import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { paginaDeArchivo, pendienteNormativa } from '../src/manual/publicacion.ts';

const RAIZ = fileURLToPath(new URL('..', import.meta.url));
const SRC = join(RAIZ, 'src');
const HUELLAS = join(SRC, 'ayuda', 'huellas.json');

// ─── Funciones puras (las prueban tests/ayuda-verificacion.test.mjs) ─────────

/** Rutas declaradas en App.tsx (`<Route path="...">`). */
export const rutasDeApp = (texto) => new Set([...texto.matchAll(/<Route\s+path="([^"]+)"/g)].map((m) => m[1]));

const USO_ANCLA = /\bancla\(\s*['"]([^'"]*)['"]\s*\)/g;
const DATA_TOUR = /data-tour/;
/** Los únicos que escriben `data-tour`: el registro (el atributo) y el motor (el selector). */
const DUENOS_DATA_TOUR = ['src/ayuda/registro.ts', 'src/ayuda/dom.ts'];

/**
 * Usos de anclas en el código. `archivos`: [{ ruta, texto }].
 * @returns {{ usos: Map<string, string[]>, aMano: string[] }}
 */
export function anclasEnCodigo(archivos) {
    const usos = new Map();
    const aMano = [];
    for (const { ruta, texto } of archivos) {
        // El registro define el helper y lo muestra en un comentario: no es un uso.
        if (ruta.endsWith('ayuda/registro.ts')) continue;
        for (const m of texto.matchAll(USO_ANCLA)) usos.set(m[1], [...(usos.get(m[1]) || []), ruta]);
        if (DATA_TOUR.test(texto) && !DUENOS_DATA_TOUR.some((d) => ruta.endsWith(d))) aMano.push(ruta);
    }
    return { usos, aMano };
}

/** JSON con las claves ordenadas: la misma definición da siempre el mismo texto. */
const canonico = (v) => (Array.isArray(v) ? `[${v.map(canonico).join(',')}]`
    : v && typeof v === 'object' ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonico(v[k])}`).join(',')}}`
        : JSON.stringify(v));

/** Huella del contenido de un recorrido, sin su versión. */
export const huellaDe = (def) => {
    const { version: _version, ...contenido } = def;
    return createHash('sha256').update(canonico(contenido)).digest('hex');
};

export const calcularHuellas = (recorridos) =>
    Object.fromEntries([...recorridos].sort((a, b) => a.id.localeCompare(b.id)).map((d) => [d.id, {
        version: d.version, huella: huellaDe(d), ...(d.estado === 'borrador' ? { borrador: true } : {}),
    }]));

/**
 * Compara las definiciones con las huellas guardadas.
 * @returns {{ bloqueantes: string[], desactualizadas: string[] }}
 *   bloqueantes: contenido cambiado sin subir la versión, o versión que bajó.
 *   desactualizadas: se arreglan con --actualizar-huellas.
 */
export function revisarHuellas(recorridos, guardadas) {
    const bloqueantes = [];
    const desactualizadas = [];
    const actuales = calcularHuellas(recorridos);
    for (const [id, a] of Object.entries(actuales)) {
        const g = guardadas[id];
        if (!g) { desactualizadas.push(`recorrido ${id}: nuevo, falta en huellas.json.`); continue; }
        if (a.version < g.version) bloqueantes.push(`recorrido ${id}: la versión bajó de ${g.version} a ${a.version}.`);
        // Un borrador no lo ha visto nadie: se corrige sin subir la versión, y
        // publicarlo tampoco la sube. Desde que se publica, sí.
        else if (a.version === g.version && a.huella !== g.huella && g.borrador) desactualizadas.push(`recorrido ${id}: borrador modificado.`);
        else if (a.version === g.version && a.huella !== g.huella) bloqueantes.push(`recorrido ${id}: cambió el contenido y no la versión (${a.version}). Súbela.`);
        else if (a.version > g.version) desactualizadas.push(`recorrido ${id}: versión ${a.version}, huellas.json tiene la ${g.version}.`);
        else if (Boolean(a.borrador) !== Boolean(g.borrador)) desactualizadas.push(`recorrido ${id}: cambió si es borrador.`);
    }
    for (const id of Object.keys(guardadas)) if (!actuales[id]) desactualizadas.push(`recorrido ${id}: ya no existe y sigue en huellas.json.`);
    return { bloqueantes, desactualizadas };
}

/**
 * Todo lo que no es huellas. Devuelve la lista de errores.
 * @param {object} p
 * @param {Record<string, {ruta: string|null, manual?: string}>} p.pantallas
 * @param {string[]} p.anclas          registradas, `pantalla.ancla`
 * @param {Set<string>} p.rutasApp
 * @param {Set<string>} p.manual
 * @param {Map<string, string[]>} p.usos
 * @param {string[]} p.aMano
 * @param {string[]} p.erroresDefiniciones  de validarRecorridos
 */
export function verificarRegistro({ pantallas, anclas, rutasApp, manual, usos, aMano, erroresDefiniciones }) {
    const errores = [...erroresDefiniciones];
    for (const [clave, p] of Object.entries(pantallas)) {
        if (p.ruta !== null && !rutasApp.has(p.ruta)) errores.push(`pantalla ${clave}: la ruta ${p.ruta} ya no está en App.tsx.`);
        if (p.manual !== undefined && !manual.has(p.manual)) errores.push(`pantalla ${clave}: la página del manual "${p.manual}" no existe.`);
    }
    for (const a of anclas) if (!usos.has(a)) errores.push(`ancla ${a}: está registrada y ningún componente la marca con ancla('${a}').`);
    const registradas = new Set(anclas);
    for (const [a, donde] of usos) if (!registradas.has(a)) errores.push(`ancla('${a}') en ${donde.join(', ')}: no está registrada en src/ayuda/registro.ts.`);
    for (const r of aMano) errores.push(`${r}: escribe data-tour a mano; usa ancla() de src/ayuda/registro.ts.`);
    return errores;
}

/** Frontmatter `revision: pendiente-normativa` (src/manual/publicacion.ts). */
export { pendienteNormativa };

/** Si una página se publica en el ambiente: en prod, no las pendientes de revisión normativa. */
export const sepublica = (texto, ambiente) => ambiente === 'dev' || !pendienteNormativa(texto);

/**
 * Revisión del manual. `paginas`: [{ slug, texto }]. `idsRecorridos`: los que
 * existen.
 */
export function revisarManual({ paginas, idsRecorridos }) {
    const errores = [];
    const existen = new Set(idsRecorridos);
    for (const { slug, texto } of paginas) {
        for (const m of texto.matchAll(/\]\(recorrido:([^)\s]*)\)/g)) {
            if (!existen.has(m[1])) errores.push(`manual ${slug}: "Ver recorrido" nombra un recorrido que no existe: ${m[1]}.`);
        }
    }
    return errores;
}

// ─── Lectura del proyecto ────────────────────────────────────────────────────

const archivos = (dir, exts) => readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = join(dir, d.name);
    if (d.isDirectory()) return archivos(p, exts);
    return exts.some((x) => d.name.endsWith(x)) ? [p] : [];
});

/** Páginas del manual que se publican en el ambiente (las pendientes de revisión, solo en dev). */
const paginasDelManual = (ambiente) => {
    const base = join(SRC, 'manual', 'content');
    return new Set(archivos(base, ['.md'])
        .filter((f) => sepublica(readFileSync(f, 'utf8'), ambiente))
        .map((f) => paginaDeArchivo(relative(base, f).split(sep).join('/'))));
};

async function principal() {
    const actualizar = process.argv.includes('--actualizar-huellas');
    const { PANTALLAS, todasLasAnclas } = await import('../src/ayuda/registro.ts');
    const { RECORRIDOS } = await import('../src/ayuda/recorridos.ts');
    const { validarRecorridos } = await import('../src/ayuda/validacion.ts');
    const { PERMISSIONS } = await import('../src/permissions.ts');

    const manual = paginasDelManual(process.env.VITE_AMBIENTE);
    const anclas = todasLasAnclas();
    const codigo = archivos(SRC, ['.ts', '.tsx']).map((f) => ({ ruta: relative(RAIZ, f).split(sep).join('/'), texto: readFileSync(f, 'utf8') }));
    const { usos, aMano } = anclasEnCodigo(codigo);

    const errores = verificarRegistro({
        pantallas: PANTALLAS,
        anclas,
        rutasApp: rutasDeApp(readFileSync(join(SRC, 'App.tsx'), 'utf8')),
        manual,
        usos,
        aMano,
        erroresDefiniciones: validarRecorridos(RECORRIDOS, {
            pantallas: PANTALLAS, anclas: new Set(anclas), permisos: new Set(Object.values(PERMISSIONS)), manual,
        }),
    });

    const guardadas = JSON.parse(readFileSync(HUELLAS, 'utf8'));
    const { bloqueantes, desactualizadas } = revisarHuellas(RECORRIDOS, guardadas);
    errores.push(...bloqueantes);
    const base = join(SRC, 'manual', 'content');
    errores.push(...revisarManual({
        paginas: archivos(base, ['.md']).map((f) => ({ slug: relative(base, f).split(sep).join('/'), texto: readFileSync(f, 'utf8') })),
        idsRecorridos: RECORRIDOS.map((d) => d.id),
    }));
    if (!actualizar) errores.push(...desactualizadas.map((e) => `${e} Corre npm run recorridos:huellas.`));

    if (errores.length) {
        console.error(`Recorridos guiados: ${errores.length} problema(s).\n  ${errores.join('\n  ')}`);
        process.exit(1);
    }
    if (actualizar && desactualizadas.length) {
        writeFileSync(HUELLAS, `${JSON.stringify(calcularHuellas(RECORRIDOS), null, 2)}\n`);
        console.log(`huellas.json actualizado:\n  ${desactualizadas.join('\n  ')}`);
    }
    console.log(`Recorridos guiados: ${RECORRIDOS.length} recorrido(s), ${anclas.length} ancla(s) y ${Object.keys(PANTALLAS).length} pantalla(s) verificados.`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await principal();
