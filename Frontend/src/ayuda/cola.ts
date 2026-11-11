// Cola sin conexión del progreso de recorridos (falla 14).
//
// No hay una cola genérica en la app que reutilizar: la de firmas es específica
// y lleva vales (credenciales). Esta sigue el mismo patrón —una clave en
// `localStorage`, envío al volver la red y al arrancar, borrado al cerrar
// sesión (`AuthContext.limpiarDatosLocales`)— y guarda lo mínimo: por persona y
// recorrido, solo el último estado fusionado (versión, estado, último paso,
// cierres). Ni nombres ni textos.
//
// La identidad (`empresa|persona`) va en la clave porque el servidor registra
// el progreso a nombre de la SESIÓN, no de lo que diga la cola: un pendiente de
// otra persona enviado con mi sesión quedaría como mío. Por eso al vaciar se
// descartan los pendientes de otra identidad (en un equipo compartido, alguien
// cuya sesión venció sin cerrarla). Es dato de conveniencia: perderlo solo
// significa volver a ver una ayuda.

import { fusionar } from './fusion.ts';
import type { EntradaProgreso } from './fusion.ts';

export const CLAVE_COLA = 'recorridosPendientes';

/** Almacenamiento mínimo (localStorage o un doble en pruebas). */
export interface Almacen {
    getItem(clave: string): string | null;
    setItem(clave: string, valor: string): void;
}

type Pendientes = Record<string, Record<string, EntradaProgreso>>;

/** Qué hacer con un pendiente según la respuesta del servidor. */
export type Resultado = 'ok' | 'descartar' | 'reintentar';

/**
 * 2xx: registrado (o ya estaba). 409 por concurrencia, 401 (sesión caída), 5xx
 * y sin red: reintentar. Cualquier otro 4xx (entrada inválida, persona
 * bloqueada, tope alcanzado): no se va a aceptar nunca, se descarta.
 */
export function clasificar(estado: number | null, codigo?: string): Resultado {
    if (estado === null) return 'reintentar';
    if (estado >= 200 && estado < 300) return 'ok';
    if (estado === 401 || estado === 408 || estado === 429) return 'reintentar';
    if (estado === 409 && codigo === 'CAMBIO_CONCURRENTE') return 'reintentar';
    if (estado >= 400 && estado < 500) return 'descartar';
    return 'reintentar';
}

export const identidad = (tenantId: string, personaId: string) => `${tenantId}|${personaId}`;

function leer(almacen: Almacen): Pendientes {
    try {
        const crudo = almacen.getItem(CLAVE_COLA);
        const v = crudo ? JSON.parse(crudo) : {};
        return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
    } catch {
        return {};
    }
}

function escribir(almacen: Almacen, p: Pendientes) {
    try {
        almacen.setItem(CLAVE_COLA, JSON.stringify(p));
    } catch {
        // Almacenamiento lleno o bloqueado: se sigue sin cola. Lo peor que pasa
        // es que una ayuda vuelva a aparecer.
    }
}

/** Agrega un evento, fusionado con lo que ya estuviera pendiente para ese recorrido. */
export function encolar(almacen: Almacen, quien: string, recorridoId: string, entrada: EntradaProgreso) {
    const p = leer(almacen);
    const deQuien = { ...(p[quien] || {}) };
    deQuien[recorridoId] = fusionar(deQuien[recorridoId] || null, entrada).progreso;
    escribir(almacen, { ...p, [quien]: deQuien });
}

export const pendientesDe = (almacen: Almacen, quien: string): Readonly<Record<string, EntradaProgreso>> => leer(almacen)[quien] || {};

/**
 * Envía los pendientes de `quien`, de a uno, y deja en la cola solo los que hay
 * que reintentar. Descarta los de cualquier otra identidad.
 *
 * @param enviar devuelve el estado HTTP (o null sin red) y el código de error si lo hubo
 * @returns cuántos se enviaron, descartaron y quedaron
 */
export async function vaciar(
    almacen: Almacen,
    quien: string,
    enviar: (recorridoId: string, entrada: EntradaProgreso) => Promise<{ estado: number | null; codigo?: string }>,
): Promise<{ enviados: number; descartados: number; quedan: number }> {
    const antes = leer(almacen);
    const inicial = antes[quien] || {};
    let enviados = 0;
    let descartados = 0;
    const resueltos = new Map<string, EntradaProgreso>();
    for (const [id, entrada] of Object.entries(inicial)) {
        let r: { estado: number | null; codigo?: string };
        try { r = await enviar(id, entrada); } catch { r = { estado: null }; }
        const que = clasificar(r.estado, r.codigo);
        if (que === 'reintentar') continue;
        if (que === 'ok') enviados += 1; else descartados += 1;
        resueltos.set(id, entrada);
    }
    // Se relee: mientras se enviaba pudo encolarse algo nuevo. Se quita solo lo
    // que se resolvió y no cambió desde que se mandó.
    const ahora = leer(almacen);
    const queda: Record<string, EntradaProgreso> = {};
    for (const [id, entrada] of Object.entries(ahora[quien] || {})) {
        const enviado = resueltos.get(id);
        if (enviado && JSON.stringify(enviado) === JSON.stringify(entrada)) continue;
        queda[id] = entrada;
    }
    const nuevo = Object.keys(queda).length ? { [quien]: queda } : {};
    // Sin nada que cambiar no se escribe: no deja una clave vacía en el equipo.
    if (JSON.stringify(nuevo) !== JSON.stringify(ahora) || JSON.stringify(ahora) !== JSON.stringify(antes)) escribir(almacen, nuevo);
    return { enviados, descartados, quedan: Object.keys(queda).length };
}
