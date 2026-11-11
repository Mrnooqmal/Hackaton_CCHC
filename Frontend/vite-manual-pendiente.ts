// Las páginas del manual pendientes de revisión normativa no llegan al build de
// producción (D-33), igual que los recorridos en borrador.
//
// En dev se mantienen, para revisarlas. El ambiente es el mismo que el de los
// borradores (`incluyeBorradores`): VITE_AMBIENTE=dev o el servidor de
// desarrollo; sin la variable se construye como prod.
//
// Cómo:
//   1. `load` responde `export default null` por cada .md de src/manual/content
//      marcado `revision: pendiente-normativa` (src/manual/publicacion.ts).
//      content.ts descarta las páginas nulas: no hay página, ni menú, ni
//      buscador, y los enlaces a ella se muestran como texto.
//   2. `generateBundle` revisa el bundle final: si aparece una línea larga de
//      una página quitada, el build falla (alguien que copió el texto en otro
//      archivo).
//   3. `buildEnd` falla si ningún .md del manual pasó por aquí: un cambio de
//      ruta o de forma de carga no puede apagar esto en silencio.
//
// Prueba: tests/manual-pendiente.test.mjs construye la app de verdad.

import type { Plugin } from 'vite';
import { readFileSync } from 'node:fs';
import { incluyeBorradores } from './vite-borradores.ts';
import { pendienteNormativa } from './src/manual/publicacion.ts';

export const ARCHIVO_MANUAL = /\/src\/manual\/content\/(.+\.md)$/;

/** Líneas que delatarían una página quitada: las de texto corrido largas, sin el aviso común. */
export function huellasDePagina(texto: string): string[] {
    const cuerpo = texto.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '').replace(/:::warning\[Pendiente de revisión normativa\][\s\S]*?\n:::\n?/, '');
    return cuerpo.split('\n').map((l) => l.trim()).filter((l) => l.length >= 60 && !/^[|:#>-]/.test(l)).slice(0, 5);
}

export default function manualPendiente({ ambiente = process.env.VITE_AMBIENTE }: { ambiente?: string } = {}): Plugin {
    let incluir = true;
    let vistos = 0;
    const quitadas = new Map<string, string[]>();
    return {
        name: 'manual-sin-pendientes',
        enforce: 'pre',
        configResolved(config) {
            incluir = incluyeBorradores(config.command, ambiente);
        },
        load(id) {
            if (incluir) return null;
            const [ruta, consulta = ''] = id.split('?');
            const m = ARCHIVO_MANUAL.exec(ruta);
            if (!m || !/(^|&)raw(&|$)/.test(consulta)) return null;
            vistos++;
            const texto = readFileSync(ruta, 'utf8');
            if (!pendienteNormativa(texto)) return null;
            quitadas.set(m[1], huellasDePagina(texto));
            return 'export default null;\n';
        },
        buildEnd(error) {
            if (!incluir && !error && vistos === 0) this.error('Ninguna página del manual pasó por aquí: las pendientes de revisión normativa no se pudieron quitar del build.');
        },
        generateBundle(_opciones, bundle) {
            if (incluir || quitadas.size === 0) return;
            for (const archivo of Object.values(bundle)) {
                const contenido = archivo.type === 'chunk' ? archivo.code : typeof archivo.source === 'string' ? archivo.source : '';
                for (const [pagina, huellas] of quitadas) {
                    const delata = huellas.find((h) => contenido.includes(h) || contenido.includes(JSON.stringify(h).slice(1, -1)));
                    if (delata) this.error(`La página del manual ${pagina}, pendiente de revisión normativa, llegó al build de prod (${archivo.fileName}: ${delata}).`);
                }
            }
        },
    };
}
