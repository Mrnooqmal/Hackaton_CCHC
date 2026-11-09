// Los recorridos en borrador no llegan al build de producción (D-33).
//
// En dev se mantienen: es donde se revisan con la vista previa. El ambiente lo
// pasa `infra/desplegar-frontend.sh` como VITE_AMBIENTE (dev o prod), junto con
// la URL de la API. Sin la variable —un `npm run build` local, por ejemplo— se
// construye como prod: ante la duda, sin borradores. El servidor de desarrollo
// (`vite`) siempre los incluye.
//
// Cómo:
//   1. `transform` reescribe el módulo `src/ayuda/recorridos.ts` ya compilado:
//      lo evalúa, quita los borradores y lo emite como datos.
//   2. `generateBundle` revisa el bundle final: si aparece lo que identifica a
//      un borrador, el build falla. Cubre lo que el paso 1 no ve (alguien que
//      copia el texto en otro archivo). Identifica a un borrador su definición
//      (`id` seguido de `tipo`) y sus descripciones, que son frases propias. Un
//      título o un id suelto no: "Cambiar de obra" es también un botón de la app,
//      "Hallazgo, incidente o accidente" está en el manual y `id:"x"` puede ser el
//      de cualquier pestaña; buscarlos hacía fallar builds correctos.
//   3. `buildEnd` falla si el módulo de recorridos nunca pasó por aquí: un
//      cambio de nombre o de ruta no puede apagar esto en silencio.
//
// Prueba: tests/ayuda-borradores.test.mjs construye la app de verdad con un
// borrador y busca su texto en el resultado.

import type { Plugin } from 'vite';

export const MODULO_RECORRIDOS = /\/src\/ayuda\/recorridos\.ts$/;

interface Texto { es?: string }
interface Definicion { id: string; estado: string; titulo?: Texto; pasos?: { titulo?: Texto; descripcion?: Texto }[] }

export const incluyeBorradores = (comando: 'serve' | 'build', ambiente: string | undefined) => comando === 'serve' || ambiente === 'dev';

export const sinBorradores = (lista: readonly Definicion[]) => lista.filter((d) => d.estado !== 'borrador');

/** Una descripción más corta que esto puede coincidir por casualidad con un texto de la app. */
export const LARGO_DESCRIPCION_IDENTIFICA = 30;

/** Lo que delataría un borrador en el bundle: su definición y sus descripciones. */
export function huellasDeBorrador(d: Definicion): string[] {
    const textos = (d.pasos || []).map((p) => p.descripcion?.es)
        .filter((t): t is string => typeof t === 'string' && t.trim().length >= LARGO_DESCRIPCION_IDENTIFICA);
    return [`id:"${d.id}",tipo:`, `"id":"${d.id}","tipo":`, ...textos.map((t) => JSON.stringify(t).slice(1, -1))];
}

async function evaluar(codigo: string): Promise<Definicion[]> {
    try {
        const url = `data:text/javascript;base64,${Buffer.from(codigo).toString('base64')}`;
        const m = await import(/* @vite-ignore */ url);
        if (!Array.isArray(m.RECORRIDOS)) throw new Error('no exporta RECORRIDOS como arreglo');
        return m.RECORRIDOS;
    } catch (e) {
        throw new Error(`src/ayuda/recorridos.ts tiene que ser solo datos (sin importar valores de otros módulos) para poder quitar los borradores del build: ${(e as Error).message}`);
    }
}

export default function borradoresRecorridos({ ambiente = process.env.VITE_AMBIENTE }: { ambiente?: string } = {}): Plugin {
    let incluir = true;
    let visto = false;
    let borradores: Definicion[] = [];
    return {
        name: 'recorridos-sin-borradores',
        enforce: 'post',
        configResolved(config) {
            incluir = incluyeBorradores(config.command, ambiente);
        },
        async transform(codigo, id) {
            if (incluir || !MODULO_RECORRIDOS.test(id.split('?')[0])) return null;
            visto = true;
            const todos = await evaluar(codigo);
            borradores = todos.filter((d) => d.estado === 'borrador');
            return { code: `export const RECORRIDOS = ${JSON.stringify(sinBorradores(todos))};\n`, map: null };
        },
        buildEnd(error) {
            if (!incluir && !error && !visto) this.error('No pasó por aquí src/ayuda/recorridos.ts: los borradores no se pudieron quitar del build.');
        },
        generateBundle(_opciones, bundle) {
            if (incluir || borradores.length === 0) return;
            for (const archivo of Object.values(bundle)) {
                const contenido = archivo.type === 'chunk' ? archivo.code : typeof archivo.source === 'string' ? archivo.source : '';
                for (const d of borradores) {
                    const delata = huellasDeBorrador(d).find((h) => contenido.includes(h));
                    if (delata) this.error(`El recorrido en borrador "${d.id}" llegó al build de prod (${archivo.fileName}: ${delata}).`);
                }
            }
        },
    };
}
