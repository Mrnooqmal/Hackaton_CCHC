// Reglas puras de los recorridos: en qué pantalla se está, qué recorrido está
// vigente, quién lo ve, cuál está pendiente y en qué orden se lanzan solos.
// Sin React ni DOM: se prueban con `node --test` (tests/ayuda-reglas.test.mjs).

import { PANTALLAS } from './registro.ts';
import type { PantallaKey } from './registro.ts';
import type { Ambito, DefinicionRecorrido, EventoRecorrido, ProgresoRecorrido } from './tipos.ts';
import type { EntradaProgreso } from './fusion.ts';

// ─── Pantalla actual ─────────────────────────────────────────────────────────

const segmentos = (ruta: string) => ruta.split('/').filter(Boolean);

/** ¿El patrón (`/obras/:obraId`) calza con la ruta? Devuelve cuántos parámetros usó, o -1. */
function calce(patron: string, ruta: string): number {
    const p = segmentos(patron);
    const r = segmentos(ruta);
    if (p.length !== r.length) return -1;
    let parametros = 0;
    for (let i = 0; i < p.length; i += 1) {
        if (p[i].startsWith(':')) { parametros += 1; continue; }
        if (p[i] !== r[i]) return -1;
    }
    return parametros;
}

/**
 * Pantalla de una ruta. Si calzan varias (`/personas/nueva` y `/personas/:rut`),
 * gana la más específica: la que usa menos parámetros.
 */
export function pantallaDeRuta(ruta: string): PantallaKey | null {
    let mejor: PantallaKey | null = null;
    let menosParametros = Infinity;
    for (const [clave, p] of Object.entries(PANTALLAS) as [PantallaKey, { ruta: string | null }][]) {
        if (p.ruta === null) continue;
        const n = calce(p.ruta, ruta);
        if (n >= 0 && n < menosParametros) { mejor = clave; menosParametros = n; }
    }
    return mejor;
}

/** Página del manual de una pantalla, como ruta de la app (`/manual/modulos/firmas`), o la portada. */
export function manualDePantalla(pantalla: PantallaKey | null): string {
    const p = pantalla ? (PANTALLAS[pantalla] as { manual?: string }) : null;
    return p?.manual ? `/manual/${p.manual}` : '/manual';
}

// ─── Vigencia, en hora de Chile ──────────────────────────────────────────────

/** Fecha `AAAA-MM-DD` en America/Santiago (falla 27: la vigencia no se compara en UTC). */
export function hoyEnChile(ahora: Date = new Date()): string {
    // en-CA da AAAA-MM-DD.
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(ahora);
}

export const vigente = (def: DefinicionRecorrido, hoy: string) =>
    (def.vigenciaDesde === undefined || def.vigenciaDesde <= hoy) && (def.vigenciaHasta === undefined || hoy <= def.vigenciaHasta);

// ─── Quién lo ve ─────────────────────────────────────────────────────────────

export interface ContextoPersona {
    readonly tienePermiso: (permiso: string) => boolean;
    /** 'obra' dentro de una obra, 'empresa' en la vista de empresa. */
    readonly ambito: Exclude<Ambito, 'cualquiera'> | null;
}

export function esVisible(def: DefinicionRecorrido, ctx: ContextoPersona): boolean {
    const v = def.visibleSi;
    if (v.todos && !v.todos.every(ctx.tienePermiso)) return false;
    if (v.alguno && !v.alguno.some(ctx.tienePermiso)) return false;
    if (v.ninguno && v.ninguno.some(ctx.tienePermiso)) return false;
    return def.ambito === 'cualquiera' || def.ambito === ctx.ambito;
}

/** Publicado, vigente y visible para la persona: lo que puede aparecer en su ayuda. */
export const disponible = (def: DefinicionRecorrido, ctx: ContextoPersona, hoy: string) =>
    def.estado === 'publicado' && vigente(def, hoy) && esVisible(def, ctx);

// ─── Pendientes y cola automática ────────────────────────────────────────────

/**
 * ¿Hay que mostrarlo solo? Sin progreso, sí. Con progreso de una versión
 * anterior, solo si la nueva se publicó para volver a mostrarse. Con progreso
 * de esta versión, mientras siga en curso (al tercer cierre el servidor lo
 * pasa a omitido).
 */
export function pendiente(def: DefinicionRecorrido, progreso: ProgresoRecorrido | EntradaProgreso | undefined): boolean {
    if (!progreso) return true;
    if (progreso.version < def.version) return def.reiniciarAlPublicar;
    if (progreso.version > def.version) return false;
    return progreso.estado === 'en_progreso';
}

/**
 * Lo que se lanzaría solo en esta pantalla, en orden: primero los anuncios,
 * después los obligatorios. Los opcionales nunca se lanzan solos. Quien llama
 * muestra uno por sesión (decisión 2 de la Fase 0); el resto queda en la ayuda.
 */
export function colaAutomatica(
    defs: readonly DefinicionRecorrido[],
    pantalla: PantallaKey | null,
    progreso: ReadonlyMap<string, ProgresoRecorrido | EntradaProgreso>,
    ctx: ContextoPersona,
    hoy: string,
): DefinicionRecorrido[] {
    if (!pantalla) return [];
    const orden = { anuncio: 0, obligatorio: 1, opcional: 2 } as const;
    return defs
        .filter((d) => d.tipo !== 'opcional' && d.pantalla === pantalla && disponible(d, ctx, hoy) && pendiente(d, progreso.get(d.id)))
        .map((d, i) => ({ d, i }))
        .sort((a, b) => orden[a.d.tipo] - orden[b.d.tipo] || a.i - b.i)
        .map(({ d }) => d);
}

/** Recorridos de la pantalla para el menú de ayuda (sin los anuncios, que van en novedades). */
export const deLaPantalla = (defs: readonly DefinicionRecorrido[], pantalla: PantallaKey | null, ctx: ContextoPersona, hoy: string) =>
    defs.filter((d) => d.tipo !== 'anuncio' && d.pantalla === pantalla && disponible(d, ctx, hoy));

/** Anuncios vigentes que la persona puede ver, de cualquier pantalla. */
export const novedades = (defs: readonly DefinicionRecorrido[], ctx: ContextoPersona, hoy: string) =>
    defs.filter((d) => d.tipo === 'anuncio' && disponible(d, ctx, hoy));

// ─── Del evento del motor al progreso que se guarda ──────────────────────────

/**
 * La entrada de progreso que deja un evento, a partir de lo conocido de esa
 * versión. Recorridos: cerrar suma un cierre y lo deja en curso (al tercero el
 * servidor lo pasa a omitido). Anuncios: cerrarlos es haberlos visto, no
 * vuelven a aparecer (decisión del 6 de noviembre de 2026, al aprobar la Fase 2).
 */
export function entradaDeEvento(def: DefinicionRecorrido, previo: EntradaProgreso | undefined, ev: EventoRecorrido): EntradaProgreso {
    const base = previo && previo.version === def.version ? previo : null;
    const cierres = base?.cierres ?? 0;
    const ultimoPaso = Math.max(base?.ultimoPaso ?? 0, ev.ultimoPaso);
    if (ev.tipo === 'cerrar' && def.tipo !== 'anuncio') return { version: def.version, estado: 'en_progreso', ultimoPaso, cierres: cierres + 1 };
    return { version: def.version, estado: ev.tipo === 'omitir' ? 'omitido' : 'completado', ultimoPaso, cierres };
}
