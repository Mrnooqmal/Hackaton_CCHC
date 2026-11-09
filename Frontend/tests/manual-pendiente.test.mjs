// Páginas del manual pendientes de revisión normativa (hoy, FUF y DS 44): en
// prod quedan fuera del build y los enlaces a ellas van como texto; en dev se
// ven (vite-manual-pendiente.ts y src/manual/publicacion.ts).
//
// La prueba que importa construye la app de verdad con la configuración real
// y busca en el resultado el texto de las páginas marcadas. Tarda unos
// segundos por build.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import manualPendiente, { huellasDePagina } from '../vite-manual-pendiente.ts';
import { paginaDeArchivo, pendienteNormativa, redireccionPublicada, resolverEnlace, sinFilasNoPublicadas } from '../src/manual/publicacion.ts';
import { destinoDe } from '../src/manual/redirecciones.ts';

const RAIZ = fileURLToPath(new URL('..', import.meta.url));
const BASE = join(RAIZ, 'src', 'manual', 'content');
const archivos = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? archivos(join(d, e.name)) : [join(d, e.name)]));
const PAGINAS = archivos(BASE).filter((f) => f.endsWith('.md')).map((f) => ({
    pagina: paginaDeArchivo(relative(BASE, f).split(sep).join('/')), texto: readFileSync(f, 'utf8'),
}));
const PENDIENTES = PAGINAS.filter((p) => pendienteNormativa(p.texto));
const PUBLICADAS = PAGINAS.filter((p) => !pendienteNormativa(p.texto));

/** Construye la app con VITE_AMBIENTE = `ambiente` y devuelve todo el JS generado. */
async function construir(ambiente) {
    const salida = mkdtempSync(join(tmpdir(), 'manual-build-'));
    const previo = process.env.VITE_AMBIENTE;
    if (ambiente === undefined) delete process.env.VITE_AMBIENTE; else process.env.VITE_AMBIENTE = ambiente;
    try {
        await build({ root: RAIZ, configFile: join(RAIZ, 'vite.config.ts'), logLevel: 'silent', build: { outDir: salida, emptyOutDir: true } });
        const js = [];
        const recorrer = (d) => readdirSync(d).forEach((f) => {
            const p = join(d, f);
            if (statSync(p).isDirectory()) recorrer(p); else if (p.endsWith('.js')) js.push(readFileSync(p, 'utf8'));
        });
        recorrer(salida);
        return js.join('\n');
    } finally {
        if (previo === undefined) delete process.env.VITE_AMBIENTE; else process.env.VITE_AMBIENTE = previo;
        rmSync(salida, { recursive: true, force: true });
    }
}

const enBundle = (js, linea) => js.includes(linea) || js.includes(JSON.stringify(linea).slice(1, -1));
const sinPendientes = PENDIENTES.length === 0 ? 'no hay páginas pendientes de revisión normativa' : false;

test('el build de prod no trae las páginas pendientes de revisión; sí las publicadas', { timeout: 180000, skip: sinPendientes }, async () => {
    const js = await construir('prod');
    for (const p of PENDIENTES) {
        const huellas = huellasDePagina(p.texto);
        assert.ok(huellas.length > 0, `${p.pagina}: sin líneas para buscar`);
        for (const h of huellas) assert.ok(!enBundle(js, h), `${p.pagina} llegó al build de prod: ${h}`);
    }
    const publicada = PUBLICADAS.find((p) => p.pagina === 'terreno/firmar');
    assert.ok(huellasDePagina(publicada.texto).every((h) => enBundle(js, h)), 'terreno/firmar tiene que estar');
});

test('el build de dev sí trae las páginas pendientes, para revisarlas', { timeout: 180000, skip: sinPendientes }, async () => {
    const js = await construir('dev');
    for (const p of PENDIENTES) for (const h of huellasDePagina(p.texto)) assert.ok(enBundle(js, h), `${p.pagina} falta en dev: ${h}`);
});

test('el plugin: deja pasar las publicadas, quita las pendientes y falla si su texto aparece en otro archivo', () => {
    const p = manualPendiente({ ambiente: 'prod' });
    p.configResolved({ command: 'build' });
    const fuf = join(BASE, 'fuf', 'index.md');
    assert.equal(p.load(`${join(BASE, 'terreno', 'firmar.md')}?raw`), null);
    assert.equal(p.load(fuf), null, 'sin ?raw no es la carga del manual');
    if (pendienteNormativa(readFileSync(fuf, 'utf8'))) {
        assert.equal(p.load(`${fuf}?raw`), 'export default null;\n');
        const contexto = { error: (m) => { throw new Error(m); } };
        const [linea] = huellasDePagina(readFileSync(fuf, 'utf8'));
        assert.throws(() => p.generateBundle.call(contexto, {}, { 'x.js': { type: 'chunk', fileName: 'x.js', code: JSON.stringify(linea) } }), /llegó al build de prod/);
        assert.doesNotThrow(() => p.generateBundle.call(contexto, {}, { 'x.js': { type: 'chunk', fileName: 'x.js', code: 'nada' } }));
    }
    const dev = manualPendiente({ ambiente: 'dev' });
    dev.configResolved({ command: 'build' });
    assert.equal(dev.load(`${fuf}?raw`), null, 'en dev no se quita nada');
});

test('el plugin falla si ninguna página del manual pasó por él en prod', () => {
    const p = manualPendiente({ ambiente: 'prod' });
    p.configResolved({ command: 'build' });
    assert.throws(() => p.buildEnd.call({ error: (m) => { throw new Error(m); } }), /no se pudieron quitar/);
});

// ─── Enlaces: nunca rotos ────────────────────────────────────────────────────

const enProd = new Set(PUBLICADAS.map((p) => p.pagina));
const existeProd = (pagina) => enProd.has(pagina);
const existeDev = (pagina) => enProd.has(pagina) || PENDIENTES.some((p) => p.pagina === pagina);

test('un enlace a una página no publicada va como texto; en dev, como enlace', () => {
    assert.deepEqual(resolverEnlace('/fuf/firmas', existeProd, destinoDe), sinPendientes ? { tipo: 'interno', to: '/manual/fuf/firmas' } : { tipo: 'texto' });
    assert.deepEqual(resolverEnlace('/fuf/firmas', existeDev, destinoDe), { tipo: 'interno', to: '/manual/fuf/firmas' });
    assert.deepEqual(resolverEnlace('/terreno/firmar#sin-conexión', existeProd, destinoDe), { tipo: 'interno', to: '/manual/terreno/firmar#sin-conexión' });
    assert.deepEqual(resolverEnlace('/modulos/firmas#firma-asistida', existeProd, destinoDe), { tipo: 'interno', to: '/manual/obra/pedir-firmas#firma-asistida' }, 'una dirección vieja va directo a su página nueva');
    assert.deepEqual(resolverEnlace('/no-existe', existeProd, destinoDe), { tipo: 'texto' });
    assert.deepEqual(resolverEnlace('https://www.dt.gob.cl', existeProd, destinoDe), { tipo: 'externo', url: 'https://www.dt.gob.cl' });
    assert.deepEqual(resolverEnlace('#arriba', existeProd, destinoDe), { tipo: 'ancla', url: '#arriba' });
    assert.deepEqual(resolverEnlace('recorrido:reportar', existeProd, destinoDe), { tipo: 'recorrido', url: 'recorrido:reportar' });
});

test('en prod, ningún enlace de una página publicada queda roto: o lleva a una página publicada o va como texto', () => {
    for (const { pagina, texto } of PUBLICADAS) {
        for (const m of texto.matchAll(/\]\(([^)\s]+)\)/g)) {
            if (m[1].startsWith('/img/')) continue;
            const e = resolverEnlace(m[1], existeProd, destinoDe);
            if (e.tipo !== 'interno') continue;
            const destino = e.to.replace(/^\/manual\/?/, '').split('#')[0];
            assert.ok(destino === '' || existeProd(destino) || destinoDe(destino, '') !== null, `${pagina} → ${m[1]}`);
        }
    }
});

test('una dirección vieja que lleva a una página no publicada va a la portada del manual', () => {
    assert.equal(redireccionPublicada('ds44/firmas-digitales', '', existeProd, destinoDe), sinPendientes ? '/manual/fuf/firmas' : '/manual');
    assert.equal(redireccionPublicada('ds44/firmas-digitales', '', existeDev, destinoDe), '/manual/fuf/firmas');
    assert.equal(redireccionPublicada('ds44/epp', '', existeProd, destinoDe), '/manual/obra/epp');
    assert.equal(redireccionPublicada('terreno/firmar', '', existeProd, destinoDe), null, 'no es vieja');
});

test('una fila de tabla que presenta una página no publicada se quita; lo demás queda igual', () => {
    const md = 'Antes [x](/fuf).\n\n| Sección | Qué |\n| --- | --- |\n| **Empezar** | Entrar. |\n| **Roles** | Ver [roles](/roles). |\n| **FUF** | Ver [FUF](/fuf). |\n| **Firmas** | Ver [firmas](/fuf/firmas#a). |\n| ![x](/img/a.png) | Foto. |';
    const existe = (p) => p === 'roles';
    assert.equal(sinFilasNoPublicadas(md, existe), 'Antes [x](/fuf).\n\n| Sección | Qué |\n| --- | --- |\n| **Empezar** | Entrar. |\n| **Roles** | Ver [roles](/roles). |\n| ![x](/img/a.png) | Foto. |');
    assert.equal(sinFilasNoPublicadas(md, () => true), md, 'con todo publicado no cambia nada');
});

test('un enlace a una página pendiente se lee bien como texto: no nombra la página ni deja un "Ver" colgando', () => {
    const titulos = Object.fromEntries(PENDIENTES.map((p) => [p.pagina, /^#\s+(.+)$/m.exec(p.texto)?.[1] ?? p.pagina]));
    const nombres = (t) => [t, t.split(':')[0]].map((x) => x.toLowerCase());
    const hallazgos = [];
    for (const { pagina, texto } of PUBLICADAS) {
        for (const linea of texto.split('\n')) {
            if (linea.trimStart().startsWith('|')) continue; // las filas de tabla se quitan enteras
            for (const m of linea.matchAll(/([^[\]]*)\[([^\]]+)\]\(\/([^)#\s]*)[^)]*\)/g)) {
                const destino = m[3].replace(/\/+$/, '');
                if (!(destino in titulos)) continue;
                if (/\b(ver|detalle en|más en|consulta)\s*$/i.test(m[1])) hallazgos.push(`${pagina}: "${m[1].trim()}" antes del enlace a ${destino}`);
                if (nombres(titulos[destino]).some((n) => m[2].toLowerCase().includes(n)) || /^[A-ZÁÉÍÓÚ]/.test(m[2])) hallazgos.push(`${pagina}: el texto "${m[2]}" nombra la página ${destino}`);
            }
        }
    }
    assert.deepEqual(hallazgos, []);
});
