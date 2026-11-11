// Los recorridos en borrador no llegan al build de prod (vite-borradores.ts).
//
// La prueba que importa construye la app de verdad, con la configuración real
// (vite.config.ts), reemplazando solo el contenido de src/ayuda/recorridos.ts
// por uno con un publicado y un borrador, cada uno con un texto marcador, y
// busca los marcadores en lo que sale. Tarda unos segundos por build.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import borradoresRecorridos, { huellasDeBorrador, incluyeBorradores, sinBorradores } from '../vite-borradores.ts';

const RAIZ = fileURLToPath(new URL('..', import.meta.url));
const MARCA_PUBLICADO = 'marcador publicado 7f3a9c';
const MARCA_BORRADOR = 'marcador borrador 2d81e5';

const definicion = (id, estado, marca) => ({
    id, tipo: 'opcional', pantalla: 'inicio', visibleSi: {}, ambito: 'cualquiera', version: 1, reiniciarAlPublicar: false,
    estado, titulo: { es: `Título ${marca}` }, pasos: [{ titulo: { es: 'Paso uno' }, descripcion: { es: `Descripción ${marca}` } }],
});
const FUENTE = `import type { DefinicionRecorrido } from './tipos.ts';
export const RECORRIDOS: readonly DefinicionRecorrido[] = ${JSON.stringify([
    definicion('prueba-publicado', 'publicado', MARCA_PUBLICADO),
    definicion('prueba-borrador', 'borrador', MARCA_BORRADOR),
])};
`;

/** Construye la app con VITE_AMBIENTE = `ambiente` y devuelve todo el JS generado. */
async function construir(ambiente, fuente = FUENTE) {
    const salida = mkdtempSync(join(tmpdir(), 'recorridos-build-'));
    const previo = process.env.VITE_AMBIENTE;
    if (ambiente === undefined) delete process.env.VITE_AMBIENTE; else process.env.VITE_AMBIENTE = ambiente;
    try {
        await build({
            root: RAIZ,
            configFile: join(RAIZ, 'vite.config.ts'),
            logLevel: 'silent',
            build: { outDir: salida, emptyOutDir: true },
            plugins: [{
                name: 'prueba-recorridos-con-borrador',
                enforce: 'pre',
                load: (id) => (/\/src\/ayuda\/recorridos\.ts$/.test(id.split('?')[0]) ? fuente : null),
            }],
        });
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

test('el build de prod no trae los borradores; sí los publicados', { timeout: 120000 }, async () => {
    const js = await construir('prod');
    assert.ok(js.includes(MARCA_PUBLICADO), 'el publicado tiene que estar');
    assert.ok(!js.includes(MARCA_BORRADOR), 'un borrador llegó al build de prod');
    assert.ok(!js.includes('prueba-borrador'));
});

test('sin VITE_AMBIENTE se construye como prod: sin borradores', { timeout: 120000 }, async () => {
    const js = await construir(undefined);
    assert.ok(js.includes(MARCA_PUBLICADO));
    assert.ok(!js.includes(MARCA_BORRADOR), 'un build sin ambiente declarado trae borradores');
});

test('el build de dev sí trae los borradores, para la vista previa', { timeout: 120000 }, async () => {
    const js = await construir('dev');
    assert.ok(js.includes(MARCA_PUBLICADO));
    assert.ok(js.includes(MARCA_BORRADOR));
});

test('incluyeBorradores: el servidor de desarrollo y el build de dev; nada más', () => {
    assert.equal(incluyeBorradores('serve', undefined), true);
    assert.equal(incluyeBorradores('build', 'dev'), true);
    for (const a of ['prod', undefined, '', 'Dev', 'desarrollo']) assert.equal(incluyeBorradores('build', a), false, String(a));
});

test('sinBorradores no toca publicados ni inactivos', () => {
    const l = [{ id: 'a', estado: 'publicado' }, { id: 'b', estado: 'borrador' }, { id: 'c', estado: 'inactivo' }];
    assert.deepEqual(sinBorradores(l).map((d) => d.id), ['a', 'c']);
});

test('si el texto de un borrador aparece en otro archivo del bundle, el build falla', async () => {
    const p = borradoresRecorridos({ ambiente: 'prod' });
    p.configResolved({ command: 'build' });
    await p.transform.call({}, `export const RECORRIDOS = ${JSON.stringify([definicion('prueba-borrador', 'borrador', MARCA_BORRADOR)])};`, '/x/src/ayuda/recorridos.ts');
    const contexto = { error: (m) => { throw new Error(m); } };
    const bundle = { 'otro.js': { type: 'chunk', fileName: 'otro.js', code: `const t = "Descripción ${MARCA_BORRADOR}";` } };
    assert.throws(() => p.generateBundle.call(contexto, {}, bundle), /llegó al build de prod/);
    assert.doesNotThrow(() => p.generateBundle.call(contexto, {}, { 'a.js': { type: 'chunk', fileName: 'a.js', code: 'nada' } }));
});

test('si el módulo de recorridos no pasa por el plugin, el build de prod falla', () => {
    const p = borradoresRecorridos({ ambiente: 'prod' });
    p.configResolved({ command: 'build' });
    assert.throws(() => p.buildEnd.call({ error: (m) => { throw new Error(m); } }), /no se pudieron quitar/);
});

test('huellasDeBorrador: la definición y las descripciones, no títulos, que también pueden ser textos de la app', () => {
    const largo = 'Un texto bastante largo, que solo puede venir de este recorrido.';
    const h = huellasDeBorrador({ id: 'x', estado: 'borrador', titulo: { es: 'Hallazgo, incidente o accidente' }, pasos: [{ titulo: { es: 'Cambiar de obra' }, descripcion: { es: largo } }, { descripcion: { es: 'Corta.' } }] });
    assert.deepEqual(h, ['id:"x",tipo:', '"id":"x","tipo":', largo]);
});

test('un título de botón o un id de pestaña igual a los de un borrador no hacen fallar el build; su definición o una descripción, sí', async () => {
    const p = borradoresRecorridos({ ambiente: 'prod' });
    p.configResolved({ command: 'build' });
    const largo = 'Una descripción larga que solo puede venir de este recorrido.';
    const borrador = { ...definicion('reportar', 'borrador', 'x'), titulo: { es: 'Cambiar de obra' }, pasos: [{ titulo: { es: 'Cambiar de obra' }, descripcion: { es: largo } }] };
    await p.transform.call({}, `export const RECORRIDOS = ${JSON.stringify([borrador])};`, '/x/src/ayuda/recorridos.ts');
    const contexto = { error: (m) => { throw new Error(m); } };
    const conCodigo = (code) => ({ 'a.js': { type: 'chunk', fileName: 'a.js', code } });
    assert.doesNotThrow(() => p.generateBundle.call(contexto, {}, conCodigo('h("button",{id:"reportar",children:"Cambiar de obra"})')));
    assert.throws(() => p.generateBundle.call(contexto, {}, conCodigo('const r={id:"reportar",tipo:"opcional"}')), /llegó al build de prod/);
    assert.throws(() => p.generateBundle.call(contexto, {}, conCodigo(`const t=${JSON.stringify(largo)}`)), /llegó al build de prod/);
});

test('los recorridos reales, todos como borrador, no chocan con ningún texto de la app en el build de prod', { timeout: 120000 }, async () => {
    const { RECORRIDOS } = await import('../src/ayuda/recorridos.ts');
    const fuente = `export const RECORRIDOS = ${JSON.stringify(RECORRIDOS.map((d) => ({ ...d, estado: 'borrador' })))};\n`;
    const js = await construir('prod', fuente);
    for (const d of RECORRIDOS) for (const h of huellasDeBorrador(d)) assert.ok(!js.includes(h), `${d.id}: ${h}`);
});
