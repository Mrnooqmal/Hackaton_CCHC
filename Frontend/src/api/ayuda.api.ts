// Progreso de los recorridos guiados (D-33): GET /ayuda/progreso y
// PUT /ayuda/progreso/{recorridoId}.
//
// No usa `apiRequest` porque la cola sin conexión necesita el código HTTP para
// decidir si reintenta o descarta (`ayuda/cola.ts`), y `apiRequest` lo pierde.
// La empresa y la persona las pone el servidor desde la sesión: acá no viajan.

import { apiBaseUrl } from './client';
import type { ProgresoRecorrido } from '../ayuda/tipos';
import type { EntradaProgreso } from '../ayuda/fusion';

const cabeceras = (): Record<string, string> => {
    const token = localStorage.getItem('auth_token');
    return { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) };
};

export interface LecturaProgreso {
    readonly progreso: ProgresoRecorrido[];
    /** false si la persona tiene el tratamiento bloqueado: no se encola progreso. */
    readonly registrar: boolean;
}

/** null si no se pudo leer (sin red, sesión caída o error del servidor). */
export async function leerProgreso(): Promise<LecturaProgreso | null> {
    try {
        const r = await fetch(`${apiBaseUrl}/ayuda/progreso`, { headers: cabeceras() });
        if (!r.ok) return null;
        const cuerpo = await r.json();
        return cuerpo?.data ?? null;
    } catch {
        return null;
    }
}

/** Estado HTTP y código de error; estado null si no hubo respuesta. */
export async function enviarProgreso(recorridoId: string, entrada: EntradaProgreso): Promise<{ estado: number | null; codigo?: string }> {
    try {
        const r = await fetch(`${apiBaseUrl}/ayuda/progreso/${encodeURIComponent(recorridoId)}`, {
            method: 'PUT',
            headers: cabeceras(),
            body: JSON.stringify(entrada),
        });
        let codigo: string | undefined;
        if (!r.ok) {
            try { codigo = (await r.json())?.codigo; } catch { /* cuerpo sin JSON */ }
        }
        return { estado: r.status, codigo };
    } catch {
        return { estado: null };
    }
}
