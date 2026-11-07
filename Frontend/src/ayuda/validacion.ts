// Validación de las definiciones de recorridos (D-33). Función pura: recibe las
// definiciones y lo que existe (pantallas, anclas, permisos, páginas del
// manual) y devuelve la lista de errores, vacía si todo está bien.
//
// Los tipos ya impiden casi todo al compilar. Esto cubre lo que los tipos no
// ven: largos, textos vacíos, fechas, unicidad, claves que entran con un `as`,
// y que el manual exista. Lo corre `scripts/verificar-recorridos.mjs` antes de
// `tsc -b`, y sus pruebas están en `tests/ayuda-validacion.test.mjs`.

import {
    ACCIONES_PASO, AMBITOS, ESTADOS_RECORRIDO, ID_RECORRIDO, LIMITES, POSICIONES, TIPOS_RECORRIDO,
} from './tipos.ts';
import type { DefinicionRecorrido, Paso, Texto } from './tipos.ts';

export interface Contexto {
    /** Claves de pantalla, con su ruta (`null` si no es una ruta). */
    readonly pantallas: Readonly<Record<string, { readonly ruta: string | null }>>;
    /** Anclas registradas, como `pantalla.ancla`. */
    readonly anclas: ReadonlySet<string>;
    readonly permisos: ReadonlySet<string>;
    /** Páginas del manual, como `modulos/firmas`. */
    readonly manual: ReadonlySet<string>;
}

const CLAVES_RECORRIDO = new Set(['id', 'tipo', 'pantalla', 'visibleSi', 'ambito', 'version', 'reiniciarAlPublicar',
    'vigenciaDesde', 'vigenciaHasta', 'estado', 'titulo', 'manual', 'pasos']);
const CLAVES_PASO = new Set(['ancla', 'titulo', 'descripcion', 'posicion', 'accion', 'manual']);
const CLAVES_VISIBLE = new Set(['todos', 'alguno', 'ninguno']);
const CLAVES_TEXTO = new Set(['es']);

const FECHA = /^\d{4}-\d{2}-\d{2}$/;
/** Algo que parece una etiqueta HTML: los textos se muestran tal cual, así que no serviría y confundiría. */
const ETIQUETA = /<\s*[a-z!/]/i;

const incluye = (lista: readonly string[], v: unknown) => typeof v === 'string' && lista.includes(v);
const sobrantes = (obj: object, permitidas: Set<string>) => Object.keys(obj).filter((k) => !permitidas.has(k)).sort();

function fechaValida(f: unknown): f is string {
    if (typeof f !== 'string' || !FECHA.test(f)) return false;
    const d = new Date(`${f}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === f;
}

function validarTexto(t: Texto | undefined, largo: number, donde: string, errores: string[]) {
    if (!t || typeof t !== 'object') { errores.push(`${donde}: falta el texto.`); return; }
    const extra = sobrantes(t, CLAVES_TEXTO);
    if (extra.length) errores.push(`${donde}: idiomas no soportados (${extra.join(', ')}).`);
    const es = typeof t.es === 'string' ? t.es.trim() : '';
    if (!es) errores.push(`${donde}: el texto en español está vacío.`);
    else if (es.length > largo) errores.push(`${donde}: el texto tiene ${es.length} caracteres; el máximo es ${largo}.`);
    if (ETIQUETA.test(es)) errores.push(`${donde}: el texto parece traer HTML; se muestra como texto plano.`);
}

function validarManual(slug: unknown, ctx: Contexto, donde: string, errores: string[]) {
    if (slug === undefined) return;
    if (typeof slug !== 'string' || !ctx.manual.has(slug)) errores.push(`${donde}: la página del manual "${String(slug)}" no existe.`);
}

function validarPaso(def: DefinicionRecorrido, paso: Paso, i: number, ctx: Contexto, errores: string[]) {
    const donde = `recorrido ${def.id}, paso ${i + 1}`;
    if (!paso || typeof paso !== 'object') { errores.push(`${donde}: no es un paso.`); return; }
    const extra = sobrantes(paso, CLAVES_PASO);
    if (extra.length) errores.push(`${donde}: claves no permitidas (${extra.join(', ')}).`);
    validarTexto(paso.titulo, LIMITES.LARGO_TITULO, `${donde}, título`, errores);
    validarTexto(paso.descripcion, LIMITES.LARGO_DESCRIPCION, `${donde}, descripción`, errores);
    if (paso.posicion !== undefined && !incluye(POSICIONES, paso.posicion)) errores.push(`${donde}: posición inválida "${String(paso.posicion)}".`);
    if (paso.accion !== undefined && !incluye(ACCIONES_PASO, paso.accion)) errores.push(`${donde}: acción inválida "${String(paso.accion)}".`);
    validarManual(paso.manual, ctx, donde, errores);

    if (def.tipo === 'anuncio' && paso.ancla !== undefined) errores.push(`${donde}: un anuncio no resalta elementos; quita el ancla.`);
    if (paso.ancla === undefined) {
        if (paso.accion === 'abrir_ayuda') errores.push(`${donde}: abrir la ayuda sin un ancla del menú de ayuda no señala nada.`);
        return;
    }
    if (!ctx.anclas.has(paso.ancla)) { errores.push(`${donde}: el ancla "${String(paso.ancla)}" no está registrada.`); return; }
    const pantalla = paso.ancla.slice(0, paso.ancla.indexOf('.'));
    if (paso.accion === 'abrir_ayuda') {
        if (pantalla !== 'menu-ayuda') errores.push(`${donde}: con la acción abrir_ayuda, el ancla tiene que ser del menú de ayuda.`);
    } else if (pantalla === 'menu-ayuda') {
        errores.push(`${donde}: un ancla del menú de ayuda exige la acción abrir_ayuda.`);
    } else if (pantalla !== 'global' && pantalla !== def.pantalla) {
        errores.push(`${donde}: el ancla "${paso.ancla}" es de la pantalla ${pantalla}, no de ${def.pantalla}.`);
    }
}

function validarRecorrido(def: DefinicionRecorrido, ctx: Contexto, errores: string[]) {
    const donde = `recorrido ${typeof def?.id === 'string' ? def.id : '(sin id)'}`;
    if (!def || typeof def !== 'object') { errores.push(`${donde}: no es una definición.`); return; }
    const extra = sobrantes(def, CLAVES_RECORRIDO);
    if (extra.length) errores.push(`${donde}: claves no permitidas (${extra.join(', ')}).`);

    if (typeof def.id !== 'string' || def.id.length > LIMITES.LARGO_ID || !ID_RECORRIDO.test(def.id)) {
        errores.push(`${donde}: el id tiene que ser minúsculas, dígitos y guiones, hasta ${LIMITES.LARGO_ID} caracteres.`);
    }
    if (!incluye(TIPOS_RECORRIDO, def.tipo)) errores.push(`${donde}: tipo inválido "${String(def.tipo)}".`);
    if (!incluye(ESTADOS_RECORRIDO, def.estado)) errores.push(`${donde}: estado inválido "${String(def.estado)}".`);
    if (!incluye(AMBITOS, def.ambito)) errores.push(`${donde}: ámbito inválido "${String(def.ambito)}".`);
    if (!Number.isInteger(def.version) || def.version < 1 || def.version > LIMITES.VERSION_MAX) {
        errores.push(`${donde}: la versión tiene que ser un entero entre 1 y ${LIMITES.VERSION_MAX}.`);
    }
    if (typeof def.reiniciarAlPublicar !== 'boolean') errores.push(`${donde}: falta reiniciarAlPublicar (true o false).`);

    const pantalla = ctx.pantallas[def.pantalla];
    if (!pantalla) errores.push(`${donde}: la pantalla "${String(def.pantalla)}" no está registrada.`);
    else if (pantalla.ruta === null) errores.push(`${donde}: "${def.pantalla}" no es una pantalla con ruta; un recorrido vive en una pantalla real.`);

    const v = def.visibleSi;
    if (!v || typeof v !== 'object') {
        errores.push(`${donde}: falta visibleSi (puede ser {} para mostrarlo a todos).`);
    } else {
        const extraV = sobrantes(v, CLAVES_VISIBLE);
        if (extraV.length) errores.push(`${donde}: visibleSi con claves no permitidas (${extraV.join(', ')}).`);
        for (const k of ['todos', 'alguno', 'ninguno'] as const) {
            const lista = v[k];
            if (lista === undefined) continue;
            if (!Array.isArray(lista) || lista.length === 0) { errores.push(`${donde}: visibleSi.${k} tiene que ser una lista con al menos un permiso.`); continue; }
            for (const p of lista) if (!ctx.permisos.has(p)) errores.push(`${donde}: visibleSi.${k} nombra un permiso que no existe: "${String(p)}".`);
        }
        const exigidos = new Set([...(v.todos || []), ...(v.alguno || [])]);
        const choque = (v.ninguno || []).filter((p) => exigidos.has(p));
        if (choque.length) errores.push(`${donde}: visibleSi exige y excluye a la vez ${choque.join(', ')}: nadie lo vería.`);
    }

    for (const k of ['vigenciaDesde', 'vigenciaHasta'] as const) {
        if (def[k] !== undefined && !fechaValida(def[k])) errores.push(`${donde}: ${k} tiene que ser una fecha AAAA-MM-DD válida.`);
    }
    if (fechaValida(def.vigenciaDesde) && fechaValida(def.vigenciaHasta) && def.vigenciaDesde > def.vigenciaHasta) {
        errores.push(`${donde}: vigenciaDesde es posterior a vigenciaHasta.`);
    }
    if (def.tipo === 'anuncio' && def.vigenciaHasta === undefined) errores.push(`${donde}: un anuncio necesita vigenciaHasta, o queda como novedad para siempre.`);

    validarTexto(def.titulo, LIMITES.LARGO_TITULO, `${donde}, título`, errores);
    validarManual(def.manual, ctx, donde, errores);

    if (!Array.isArray(def.pasos) || def.pasos.length === 0) { errores.push(`${donde}: necesita al menos un paso.`); return; }
    if (def.pasos.length > LIMITES.PASOS_MAX) errores.push(`${donde}: tiene ${def.pasos.length} pasos; el máximo es ${LIMITES.PASOS_MAX}.`);
    def.pasos.forEach((paso, i) => validarPaso(def, paso, i, ctx, errores));
}

/** Errores de todas las definiciones; vacío si están bien. */
export function validarRecorridos(lista: readonly DefinicionRecorrido[], ctx: Contexto): string[] {
    const errores: string[] = [];
    const vistos = new Set<string>();
    for (const def of lista) {
        validarRecorrido(def, ctx, errores);
        if (typeof def?.id === 'string') {
            if (vistos.has(def.id)) errores.push(`recorrido ${def.id}: el id está repetido.`);
            vistos.add(def.id);
        }
    }
    return errores;
}
